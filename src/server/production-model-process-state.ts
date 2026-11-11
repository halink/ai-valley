/** Fixed synthetic fixture preparation. No runtime import, network or secret. */
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {WorldStore} from './store.js';
import {createFrontierWorld} from '../world/formal-seed.js';
import {sourceManifest,persistedWorldFingerprint as fingerprint} from './acceptance-offline-protocol.js';
import {syntheticPriceSessionContract,SyntheticPriceSession,type SyntheticPriceSessionContract} from './production-model-price-session.js';
import {productionCandidateContract,ProductionModelJournal,type ProductionCandidateContract} from './production-model-journal.js';
import {SyntheticProcessDirectory,SYNTHETIC_PROCESS_MARKER} from './production-model-process-storage.js';
export type SyntheticProcessManifest={kind:typeof SYNTHETIC_PROCESS_MARKER;bootId:string;contract:SyntheticPriceSessionContract;
 modelContract:ProductionCandidateContract;initialWorldFingerprint:string;initialSessionHash:string;initialJournalHash:string};
export const bootIdentity=()=>readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
export const monotonicStamp=()=>process.hrtime.bigint().toString();
export function createSyntheticProcessState(directory:SyntheticProcessDirectory,root:string):SyntheticProcessManifest{
 const source=sourceManifest(root).sourceFingerprint,store=new WorldStore(directory.database('world.sqlite',true));let md:DatabaseSync|undefined,sd:DatabaseSync|undefined;
 try{
  store.commit(createFrontierWorld(5401),null);const world=store.loadForRuntime()!,worldFingerprint=fingerprint(world),now=Date.now();
  const common={runId:randomUUID(),worldId:world.id,createdAtMs:now,deadlineAtMs:now+21_600_000,maxRequests:20000,requestTimeoutMs:5000};
  const contract=syntheticPriceSessionContract({...common,sourceFingerprint:source,fixtureScopeHash:worldFingerprint,commitGraceMs:1000,maxSegments:720,maxEpochs:720,maxAuditRecords:60002});
  const modelContract=productionCandidateContract(common);md=new DatabaseSync(directory.database('model.sqlite',true));sd=new DatabaseSync(directory.database('session.sqlite',true));
  const journal=new ProductionModelJournal(md,modelContract,{create:true,worldFingerprint}),session=new SyntheticPriceSession(sd,contract,{create:true,worldFingerprint,nowMs:now});
  const manifest:SyntheticProcessManifest={kind:SYNTHETIC_PROCESS_MARKER,bootId:bootIdentity(),contract,modelContract,initialWorldFingerprint:worldFingerprint,
   initialSessionHash:session.status().auditHash,initialJournalHash:journal.status().auditHash};directory.writeJson('manifest.json',manifest);return manifest;
 }finally{store.close();md?.close();sd?.close();}
}
export function processManifest(directory:SyntheticProcessDirectory,root:string){
 const manifest=directory.readJson('manifest.json') as SyntheticProcessManifest;
 if(manifest.kind!==SYNTHETIC_PROCESS_MARKER||manifest.bootId!==bootIdentity()||manifest.contract?.sourceFingerprint!==sourceManifest(root).sourceFingerprint
  ||manifest.contract.executionKind!=='synthetic-price-session-v1'||manifest.modelContract?.executionKind!=='synthetic-production-candidate')throw Error('synthetic_process_identity_mismatch');
 return manifest;
}
export function openSyntheticProcessState(directory:SyntheticProcessDirectory,manifest:SyntheticProcessManifest,expected?:{sessionHash:string;journalHash:string;worldFingerprint:string}){
 let store:WorldStore|undefined,md:DatabaseSync|undefined,sd:DatabaseSync|undefined;
 try{
  md=new DatabaseSync(directory.database('model.sqlite'));sd=new DatabaseSync(directory.database('session.sqlite'));
  const mt=(md.prepare('SELECT hash FROM production_model_audit ORDER BY sequence DESC LIMIT 1').get() as {hash:string}).hash;
  const st=(sd.prepare('SELECT hash FROM synthetic_price_session_audit ORDER BY sequence DESC LIMIT 1').get() as {hash:string}).hash;
  if(expected&&(mt!==expected.journalHash||st!==expected.sessionHash))throw Error('synthetic_process_audit_rollback');
  store=new WorldStore(directory.database('world.sqlite'));const world=store.loadForRuntime();if(!world)throw Error('synthetic_process_world_missing');
  const worldFingerprint=fingerprint(world);if(expected&&worldFingerprint!==expected.worldFingerprint)throw Error('synthetic_process_world_mismatch');
  const journal=new ProductionModelJournal(md,manifest.modelContract,{create:false,worldFingerprint});
  const session=new SyntheticPriceSession(sd,manifest.contract,{create:false,worldFingerprint,nowMs:Date.now()});
  const j=journal.status(),s=session.status();
  if(j.failure||s.failure||j.pending||s.pending||s.segment||j.runtimeStop||j.attempts!==s.attempts||j.completed!==s.completed)throw Error('synthetic_process_unresolved');
  const ownedStore=store,ownedModel=md,ownedSession=sd;
  return {store,journal,session,close(){ownedStore.close();ownedModel.close();ownedSession.close();}};
 }catch(error){store?.close();md?.close();sd?.close();throw error;}
}
