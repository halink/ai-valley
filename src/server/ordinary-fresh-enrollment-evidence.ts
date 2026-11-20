/** Test-only persisted evidence reader. Neither boot nor verdict enrolls a save. */
import {createHash,randomBytes} from 'node:crypto';
import type {World} from '../shared/types.js';
import {canonicalDryEd25519PublicKey,verifyCanonicalDrySignedTuple} from './dry-deployment-trust.js';
import {assertMvpWorld} from './godot-mvp-persistent.js';
import {assertMvpClimateWorld} from '../world/mvp-climate-state.js';
import {acquireRuntimeOwnership} from './runtime-lock.js';
import {preflightWorldSave} from './save-preflight.js';
import {ordinaryG1DecisionSaveScope} from './valley-spirit-ordinary-g1-decision.js';

export const ORDINARY_FRESH_ENROLLMENT_EVIDENCE_DOMAIN='ai-valley-ordinary-g2-fresh-enrollment-evidence/v1';
const DOMAIN=ORDINARY_FRESH_ENROLLMENT_EVIDENCE_DOMAIN, MAX_STATUS_MS=60_000;
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const name=(v:unknown,max=96)=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9_-]+$/.test(v);
const int=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&!Object.is(-0,v);
type Signed=Readonly<{utf8:string;signature:string}>;
type Scope=Readonly<{environment:string;worldId:string;instanceId:string;originalScope:string;generation:number;policyDigest:string;epochFloor:number}>;
type Boot=Readonly<{database:string;scope:Scope;clock:()=>number;genesisRootSpki:string;registryRootSpki:string;
 provisionedGenesis:Signed;source:Readonly<{mode:'injected-signed-test-status-only';readLatest:(challenge:string)=>Signed|null}>}>;
type Reason='external-provision-status-unavailable'|'invalid-boot-or-genesis'|'original-scope-mismatch'|'ordinary-snapshot-unavailable'|
 'genesis-registry-mismatch'|'registry-stale-or-invalid'|'registry-not-eligible'|'checkpoint-disagreement'|'unsupported-consumed-history';
const unavailable=(reason:Reason)=>Object.freeze({status:'unavailable' as const,reason,testEvidenceOnly:true as const,
 liveAuthorized:false as const,migrationPolicyAvailable:false as const,externalProvisioningImplemented:false as const});
const ok=()=>Object.freeze({status:'signed-fresh-enrollment-test-evidence-only' as const,testEvidenceOnly:true as const,
 liveAuthorized:false as const,migrationPolicyAvailable:false as const,externalProvisioningImplemented:false as const});
type Snapshot=Readonly<{revision:number;rawDigest:string}>;
const same=(a:Snapshot|null,b:Snapshot|null)=>!!a&&!!b&&a.revision===b.revision&&a.rawDigest===b.rawDigest;
function snapshotSaved(database:string,worldId:string){
 let found:Snapshot|null=null;
 preflightWorldSave(database,{requireWorld:true,validateWorld(v){
  const w=v as unknown as World;
  assertMvpWorld(w);assertMvpClimateWorld(w);
  if(w.id!==worldId||w.clock.paused||Object.hasOwn(w,'simulationOnly')||Object.hasOwn(w,'mvpSeasonalModelVersion'))throw Error('ordinary_scope');
 },inspectOptionalAlmanac(db,w){
  // Existing preflight has already rejected all unknown development and
  // sealed scopes; accept ordinary exact inline compressed storage only.
  const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all(),row=rows[0];
  if(rows.length===1&&row.id===worldId&&row.revision===w.revision&&int(row.revision)&&row.state instanceof Uint8Array&&!Object.hasOwn(w,'terrainKey'))
   found={revision:row.revision,rawDigest:hash(row.state)};
 }});
 return found as Snapshot|null;
}
const exactData=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&
 Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return !!d&&'value' in d;});
function safeBoot(input:Boot|undefined){
 if(!input)return null;
 try{
  if(!exactData(input,['database','scope','clock','genesisRootSpki','registryRootSpki','provisionedGenesis','source'])||
   !exactData(input.scope,['environment','worldId','instanceId','originalScope','generation','policyDigest','epochFloor'])||
   !exactData(input.source,['mode','readLatest'])||!exactData(input.provisionedGenesis,['utf8','signature']))return null;
  const s={...input.scope};
  if(typeof input.database!=='string'||!input.database||input.database===':memory:'||typeof input.clock!=='function'||
    input.source.mode!=='injected-signed-test-status-only'||typeof input.source.readLatest!=='function'||
    !name(s.environment)||!name(s.worldId,160)||!hex(s.instanceId)||!hex(s.originalScope)||!hex(s.policyDigest)||
    !int(s.generation,1)||!int(s.epochFloor,1))return null;
  const g=canonicalDryEd25519PublicKey(input.genesisRootSpki),r=canonicalDryEd25519PublicKey(input.registryRootSpki);
  if(g.spki===r.spki)return null;
  const base=[s.environment,s.worldId,s.instanceId,s.originalScope,s.generation,s.policyDigest];
  const genesis=verifyCanonicalDrySignedTuple(input.provisionedGenesis,g.key,12);
  if(genesis[0]!==DOMAIN||genesis[1]!=='fresh-only-provisioned-genesis'||base.some((b,i)=>genesis[i+2]!==b)||
   !int(genesis[8])||!hex(genesis[9])||genesis[10]!==s.epochFloor||!int(genesis[11]))return null;
  return {scope:Object.freeze(s),database:input.database,clock:input.clock,readLatest:input.source.readLatest,registry:r.key,
   base,genesisRevision:genesis[8],genesisDigest:genesis[9],genesisIssuedAt:genesis[11],genesisEnvelopeDigest:hash(input.provisionedGenesis.utf8)};
 }catch{return null;}
}
/** This entry does not accept a request or raw save digest. Trusted boot pins
 * both independent roots and test status source once. No built-in source. */
export function createOrdinaryFreshEnrollmentEvidence(boot?:Boot){
 const config=safeBoot(boot);
 let lastClock=-1,lastHead:Snapshot|null=null,active=false;
 const inspect=()=>{
  if(!config)return unavailable(boot?'invalid-boot-or-genesis':'external-provision-status-unavailable');
  if(active)return unavailable('registry-stale-or-invalid');
  let owner:ReturnType<typeof acquireRuntimeOwnership>|undefined;
  try{
   active=true;
   owner=acquireRuntimeOwnership(config.database,{existingOnly:true});owner.assertOwned();
   const original=owner.database,s=config.scope;
   if(ordinaryG1DecisionSaveScope(original)!==s.originalScope)return unavailable('original-scope-mismatch');
   const before=snapshotSaved(original,s.worldId);
   if(!before)return unavailable('ordinary-snapshot-unavailable');
   if(before.revision<config.genesisRevision||before.revision===config.genesisRevision&&before.rawDigest!==config.genesisDigest)
    return unavailable('checkpoint-disagreement');
   const now=config.clock();
   if(!int(now)||now<lastClock||now<config.genesisIssuedAt)return unavailable('registry-stale-or-invalid');
   lastClock=now;
   const challenge=randomBytes(32).toString('hex'),wire=config.readLatest(challenge);
   if(!wire)return unavailable('external-provision-status-unavailable');
   let record:unknown[];
   try{record=verifyCanonicalDrySignedTuple(wire,config.registry,18);}catch{return unavailable('registry-stale-or-invalid');}
   const end=config.clock();
   if(!int(end)||end<now||end-now>MAX_STATUS_MS||record[0]!==DOMAIN||record[1]!=='signed-current-registry-test-status'||
    record[15]!==challenge||!int(record[16])||!int(record[17])||record[16]<now||record[16]>end||end>=record[17]||
    record[17]-record[16]>MAX_STATUS_MS)return unavailable('registry-stale-or-invalid');
   lastClock=end;
   if(config.base.some((b,i)=>record[i+2]!==b)||record[8]!==config.genesisEnvelopeDigest||record[12]!==s.epochFloor)
    return unavailable('genesis-registry-mismatch');
   if(record[9]!=='fresh-provisioned-checkpoint')return unavailable('registry-not-eligible');
   // No production custody exists. An empty explicit set is the only
   // currently verifiable consumed-opportunity history; never infer one.
   if(record[13]!==0||record[14]!==hash('[]'))return unavailable('unsupported-consumed-history');
   if(record[10]!==before.revision||record[11]!==before.rawDigest||
    lastHead&&(before.revision<lastHead.revision||before.revision===lastHead.revision&&before.rawDigest!==lastHead.rawDigest))
    return unavailable('checkpoint-disagreement');
   owner.assertOwned();
   if(ordinaryG1DecisionSaveScope(original)!==s.originalScope)return unavailable('original-scope-mismatch');
   if(!same(before,snapshotSaved(original,s.worldId)))return unavailable('checkpoint-disagreement');
   owner.assertOwned();
   const final=config.clock();
   if(!int(final)||final<end||final-now>MAX_STATUS_MS||final>=record[17])return unavailable('registry-stale-or-invalid');
   lastClock=final;
   lastHead=before;
   return ok();
  }catch{
   return unavailable('ordinary-snapshot-unavailable');
  }finally{active=false;owner?.release();}
 };
 return Object.freeze({inspect:()=>{try{return inspect();}catch{return unavailable('ordinary-snapshot-unavailable');}}});
}
