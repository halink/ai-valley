/** Held-only local process integration, never a provider adapter. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {AcceptanceProcessSupervisor,type SupervisedProcess,type SupervisedProcessEvent} from './acceptance-process-supervisor.js';
import {persistedWorldFingerprint} from './acceptance-offline-protocol.js';
import {createDryDeploymentTrust,DRY_DEPLOYMENT_ROLES} from './dry-deployment-trust.js';
import {createProviderSourceCustodyDryCheck,PROVIDER_CUSTODY_ROLES} from './production-model-source-custody.js';
import {ProductionModelJournal,type ProductionCandidateContract} from './production-model-journal.js';
import {acquirePinnedProductionModelAccountOwnership,type AccountOwnershipOptions} from './production-model-account-ownership.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {preflightWorldSave} from './save-preflight.js';
import {WorldStore} from './store.js';

type Trust=NonNullable<Parameters<typeof createDryDeploymentTrust>[0]>;
type Chain=Parameters<ReturnType<typeof createDryDeploymentTrust>['inspectProvider']>[0];
type CustodyRole=(typeof PROVIDER_CUSTODY_ROLES)[number];
type CustodyEnvelope=Readonly<{utf8:string;signature:string}>;
type ReviewedSources=Readonly<{mode:'reviewer-signed-sources/v1';
 files:Readonly<Record<CustodyRole,string>>;reviewerSpkis:Readonly<Record<CustodyRole,string>>}>;
type Boot=Readonly<{worldPath:string;journalPath:string;account:AccountOwnershipOptions;contract:ProductionCandidateContract;
 trust:Omit<Trust,'clock'>;registryIdentity:string;evidenceJson:string;maxWallMs?:number;reviewedSources?:ReviewedSources}>;
const MAX_FILE=32*1024*1024,MAX_WALL=3000;
const fixedWorker='setTimeout(()=>{process.exitCode=0},400);';
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const hash=(v:unknown)=>sha(JSON.stringify(v));
const failure=(reason:string):never=>{throw Error(reason);};
const errorCode=(e:unknown)=>(e as NodeJS.ErrnoException|null)?.code;
const statKey=(s:ReturnType<typeof fstatSync>)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeMs,s.ctimeMs].join(':');
const occupied=(path:string)=>{
 try{lstatSync(path);return true;}catch(e){if(errorCode(e)==='ENOENT')return false;throw e;}
};
function assertImmutable(lock:RuntimeOwnership){
 lock.assertOwned();
 if(['-wal','-shm','-journal'].some(s=>occupied(lock.database+s)))failure('held_pending_sqlite_sidecar');
}
/** Open only the original source fd read-only. Existing semantic replay may
 * migrate or mark blocked and therefore must use private copies only. */
function snapshot(lock:RuntimeOwnership,kind:'world'|'journal',copy?:string){
 assertImmutable(lock);
 const fd=openSync(lock.database,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const info=fstatSync(fd),before=statKey(info);
  if(!info.isFile()||info.uid!==process.getuid?.()||info.nlink!==1||(info.mode&0o077)!==0||info.size<100||info.size>MAX_FILE)
   return failure('held_unsafe_artifact');
  const bytes=Buffer.allocUnsafe(info.size);
  for(let n=0;n<bytes.length;){
   const count=readSync(fd,bytes,n,bytes.length-n,n);
   if(!count)return failure('held_artifact_changed');
   n+=count;
  }
  if(bytes.subarray(0,16).toString('latin1')!=='SQLite format 3\0'||bytes[18]!==bytes[19]||
    !(bytes[18]===1||kind==='world'&&bytes[18]===2))return failure('held_sqlite_header_invalid');
  assertImmutable(lock);
  if(statKey(fstatSync(fd))!==before||statKey(lstatSync(lock.database))!==before)return failure('held_artifact_changed');
  if(copy)writeFileSync(copy,bytes,{mode:0o600,flag:'wx'});
  return [info.dev,info.ino,createHash('sha256').update(bytes).digest('hex')] as const;
 }finally{closeSync(fd);}
}
const origin=(w:ReturnType<typeof snapshot>,j:ReturnType<typeof snapshot>)=>hash(['held-supervisor-artifacts/v1',w,j]);
function verifyClones(dir:string,contract:ProductionCandidateContract){
 const worldPath=join(dir,'world.db'),journalPath=join(dir,'journal.db');
 preflightWorldSave(worldPath,{requireWorld:true});
 const store=new WorldStore(worldPath);
 try{
  const w=store.loadForRuntime();
  if(!w||w.id!==contract.worldId||w.mode!=='formal'||!w.clock.paused||w.metrics.inFlight.length)return failure('held_world_not_closed');
  const db=new DatabaseSync(journalPath);
  try{
   const s=new ProductionModelJournal(db,contract,{create:false,worldFingerprint:persistedWorldFingerprint(w)}).status();
   if(s.pending||s.failure||s.runtimeStop||s.attempts!==0||s.completed!==0)return failure('held_journal_not_closed');
  }finally{db.close();}
 }finally{store.close();}
}
/** Empty environment, no stdio/IPC, provider, request paths or imports.
 * Node permission mode is not a network sandbox. Fixed code will not network. */
function launchHeld(observe:(event:SupervisedProcessEvent)=>void):SupervisedProcess{
 const child=spawn('/proc/self/exe',['--permission','--no-warnings','--eval',fixedWorker],{
  cwd:'/',env:{},shell:false,detached:true,stdio:'ignore',windowsHide:true,
 });
 const pid=child.pid;
 let spawned=false,exited=false,absent=false;
 const onSpawn=()=>{spawned=true;observe({type:'spawned'});};
 const onError=()=>observe({type:spawned||pid!==undefined?'transport_error':'spawn_failed'});
 const onExit=(code:number|null,signal:string|null)=>{exited=true;observe({type:'exit',code,signal});};
 child.once('spawn',onSpawn);child.on('error',onError);child.once('exit',onExit);
 const probe=()=>{
  if(absent)return 'absent';
  if(!pid||!Number.isSafeInteger(pid)||pid<2)return 'unknown';
  try{process.kill(-pid,0);return 'present';}
  catch(e){if(errorCode(e)==='ESRCH'){if(exited)absent=true;return 'absent';}return 'unknown';}
 };
 return {
  groupState:probe,
  signalGroup(signal){
   const status=probe();
   if(status==='absent')return 'not_found';
   // Target the actual child handle, never a numeric group signal. Static
   // code cannot fork; any unexpected surviving group keeps closure blocked.
   if(exited||!pid||status!=='present')return 'unknown';
   try{return child.kill(signal)?'sent':'not_found';}
   catch(e){return errorCode(e)==='ESRCH'?'not_found':'unknown';}
  },
  dispose(){
   child.removeListener('spawn',onSpawn);child.removeListener('exit',onExit);
   child.on('error',()=>{});child.removeListener('error',onError);child.unref();
  },
 };
}
const validPath=(p:unknown):p is string=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0')&&resolve(p)===p;
function roleMap(v:unknown):v is Record<CustodyRole,unknown>{
 return !!v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&
 Reflect.ownKeys(v).length===PROVIDER_CUSTODY_ROLES.length&&PROVIDER_CUSTODY_ROLES.every(k=>Object.hasOwn(v,k));
}
function captureReviewedSource(path:string){
 let fd:number;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch{return failure('held_source_unavailable');}
 try{
  const before=fstatSync(fd);
  if(!before.isFile()||before.uid!==process.getuid?.()||before.nlink!==1||(before.mode&0o077)!==0||before.size<1||before.size>2304)
   return failure('held_source_unsafe');
  const bytes=Buffer.allocUnsafe(before.size);
  for(let n=0;n<bytes.length;){
   const count=readSync(fd,bytes,n,bytes.length-n,n);
   if(!count)return failure('held_source_unavailable');
   n+=count;
  }
  if(statKey(fstatSync(fd))!==statKey(before)||statKey(lstatSync(path))!==statKey(before)||bytes.some(b=>b<32||b>126))
   return failure('held_source_unavailable');
  const text=bytes.toString('ascii');
  let v:unknown;try{v=JSON.parse(text);}catch{return failure('held_source_envelope_invalid');}
  if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length!==2||
   !Object.hasOwn(v,'utf8')||!Object.hasOwn(v,'signature'))return failure('held_source_envelope_invalid');
  const {utf8,signature}=v as Record<string,unknown>;
  if(typeof utf8!=='string'||typeof signature!=='string'||text!==JSON.stringify({utf8,signature}))
   return failure('held_source_envelope_invalid');
  return {envelope:{utf8,signature},digest:sha(bytes)};
 }finally{closeSync(fd);}
}
const unavailable=(reason:string)=>({started:false as const,spawnAttempted:false as const,account:'unchanged' as const,reason,liveAuthorized:false as const,
 remoteCancellationConfirmed:false as const,realModelExecuted:null,actualProviderCostCny:null});
/** Trusted boot-only. The attempt takes only a signed envelope; no caller
 * process options, paths, account control, worker selection or transport. */
export function createHeldProductionModelSupervisor(boot?:Boot){
 const config=(()=>{
  try{
   if(!boot||process.platform!=='linux'||![boot.worldPath,boot.journalPath,boot.account.registryDirectory].every(validPath)||boot.worldPath===boot.journalPath||
    boot.account.runId!==boot.contract.runId||boot.contract.executionKind!=='gated-production-http-candidate'||typeof boot.evidenceJson!=='string'||
    boot.evidenceJson.length>4096||typeof boot.registryIdentity!=='string'||boot.registryIdentity.length!==64||!/^[0-9a-f]{64}$/.test(boot.registryIdentity)||!Number.isSafeInteger(boot.maxWallMs??MAX_WALL)||(boot.maxWallMs??MAX_WALL)<1||
    (boot.maxWallMs??MAX_WALL)>MAX_WALL)return null;
   const data=structuredClone(boot);
   const reviewed=data.reviewedSources;
   if(reviewed!==undefined){
    if(reviewed?.mode!=='reviewer-signed-sources/v1'||!roleMap(reviewed.files)||!roleMap(reviewed.reviewerSpkis)||
     !PROVIDER_CUSTODY_ROLES.every(k=>validPath(reviewed.files[k])&&typeof reviewed.reviewerSpkis[k]==='string')||
     new Set(PROVIDER_CUSTODY_ROLES.map(k=>reviewed.files[k])).size!==PROVIDER_CUSTODY_ROLES.length)
     return null;
   }
   return data;
  }catch{return null;}
 })();
 let started=false,supervisor:AcceptanceProcessSupervisor|undefined;
 return Object.freeze({
  interrupt(reason:'SIGINT'|'SIGTERM'|'parent_disconnect'){supervisor?.interrupt(reason);},
  async start(envelope:Chain){
   if(!config||process.allowedNodeEnvironmentFlags.has('--permission')===false)return unavailable('held_trusted_boot_or_permissions_unavailable');
   if(started)return unavailable('held_single_use');
   started=true;
   const startedAt=performance.now();
   let wallFloor=Date.now();
   let world:RuntimeOwnership|undefined,journal:RuntimeOwnership|undefined;
   let account:ReturnType<typeof acquirePinnedProductionModelAccountOwnership>|undefined;
   let dir:string|undefined,clean=false,spawnAttempted=false,spawnObserved=false;
   const failClosed=(reason:string)=>({...unavailable(reason),started:spawnObserved,spawnAttempted,account:account?'unresolved' as const:'unchanged' as const});
   try{
    const attestation=(v:unknown)=>{
     if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==2)return failure('held_envelope_invalid');
     const utf8=Object.getOwnPropertyDescriptor(v,'utf8')?.value,signature=Object.getOwnPropertyDescriptor(v,'signature')?.value;
     if(typeof utf8!=='string'||utf8.length>1024||typeof signature!=='string'||signature.length!==86)return failure('held_envelope_invalid');
     return {utf8,signature};
    };
    if(!envelope||Object.getPrototypeOf(envelope)!==Object.prototype||Reflect.ownKeys(envelope).length!==2)return failClosed('held_envelope_invalid');
    const chain={delegation:attestation(Object.getOwnPropertyDescriptor(envelope,'delegation')?.value),
     permit:attestation(Object.getOwnPropertyDescriptor(envelope,'permit')?.value)};
    world=acquireRuntimeOwnership(config.worldPath,{existingOnly:true});
    journal=acquireRuntimeOwnership(config.journalPath,{existingOnly:true});
    const w=world,j=journal;
    dir=mkdtempSync(join(tmpdir(),'ai-valley-held-worker-'));
    const captured=origin(snapshot(w,'world',join(dir,'world.db')),snapshot(j,'journal',join(dir,'journal.db')));
    if(captured!==config.trust.scope.originDigest)return failClosed('held_artifact_pin_mismatch');
    verifyClones(dir,config.contract);
    rmSync(dir,{recursive:true,force:true});dir=undefined;
    const confirm=()=>origin(snapshot(w,'world'),snapshot(j,'journal'))===captured;
    if(!confirm())return failClosed('held_artifact_changed');
    const clock=()=>{
     const now=Date.now();if(now<wallFloor)return NaN;wallFloor=now;return now;
    };
    const oldBinding=hash(['held-supervisor-account/v1',config.account.registryDirectory,config.account.accountScope,config.registryIdentity]);
    const reviewed=config.reviewedSources;
    const custody=reviewed?createProviderSourceCustodyDryCheck({
     accountIdentityDigest:config.registryIdentity,contract:config.contract,admissionJson:config.evidenceJson,
     launchRootSpkis:DRY_DEPLOYMENT_ROLES.map(role=>config.trust.roots[role]) as [string,string],
     reviewerSpkis:reviewed.reviewerSpkis,clock,
    }):null;
    const reviewedBinding=()=>{
     if(!reviewed||!custody)return oldBinding;
     const envelopes={} as Record<CustodyRole,CustodyEnvelope>;
     const manifest=PROVIDER_CUSTODY_ROLES.map(role=>{
      const source=captureReviewedSource(reviewed.files[role]);
      envelopes[role]=source.envelope;
      return [role,source.digest,reviewed.reviewerSpkis[role]];
     });
     if(custody.inspect(envelopes).status!=='reviewer-signed-source-records-matched')return failure('held_source_custody_denied');
     return hash(['held-supervisor-reviewed-account/v1',reviewed.mode,oldBinding,manifest]);
    };
    // Bind the signed launch to these reviewed bytes, not merely the previous
    // aggregate admission record. The optional branch cannot accept v1 legacy
    // signatures or a replacement signed envelope/file set at the same path.
    const binding=reviewedBinding();
    const admit=()=>createDryDeploymentTrust({...config.trust,clock}).inspectProvider(chain,config.contract,config.evidenceJson,binding);
    if(!admit().admitted)return failClosed('held_admission_denied');
    // Only inspect delegated SPKI after the original dry launch signature
    // authenticates this exact immutable delegation snapshot.
    if(reviewed){
     const delegate=(JSON.parse(chain.delegation.utf8) as unknown[])[6];
     if(PROVIDER_CUSTODY_ROLES.some(role=>reviewed.reviewerSpkis[role]===delegate))return failClosed('held_source_launch_signer_reuse');
    }
    account=acquirePinnedProductionModelAccountOwnership(config.account,config.registryIdentity);
    account.assertOwned();
    if(!confirm())return failClosed('held_artifact_changed');
    const remain=Math.floor(Math.min((config.maxWallMs??MAX_WALL)-(performance.now()-startedAt),config.contract.deadlineAtMs-Date.now()));
    if(remain<1)return failClosed('held_pre_spawn_deadline');
    supervisor=new AcceptanceProcessSupervisor({maxWallMs:remain,termGraceMs:120,killWaitMs:160,pollMs:10});
    let sourceRecheckFailed=false;
    const processReport=await supervisor.start(observe=>{
     if(reviewed){
      try{
       if(reviewedBinding()!==binding)throw Error('held_source_manifest_changed');
      }catch(error){sourceRecheckFailed=true;throw error;}
     }
     if(!admit().admitted)throw Error('held_admission_expired');
     if(reviewed&&performance.now()-startedAt>=(config.maxWallMs??MAX_WALL))throw Error('held_pre_spawn_deadline');
     spawnAttempted=true;
     return launchHeld(observe);
    });
    spawnObserved=processReport.spawnObserved;
    if(processReport.cleanupComplete&&spawnObserved&&processReport.outcome==='exited_zero'&&processReport.trigger==='child_exit'&&!processReport.issues.length&&confirm()){
     account.assertOwned();account.closeClean();clean=true;
    }
    return {...unavailable(clean?'held_local_clean':sourceRecheckFailed?'held_source_recheck_failed':'held_local_not_clean'),started:spawnObserved,spawnAttempted,account:clean?'clean-local-only' as const:'unresolved' as const,process:processReport};
   }catch(e){
    const msg=e instanceof Error?e.message:'';
    return failClosed(/^(?:held|model_account)_[a-z_]{1,48}$/.test(msg)?msg:'held_guard_failed');
   }finally{
    try{if(!clean)account?.abandon();}finally{
     try{if(dir)rmSync(dir,{recursive:true,force:true});}finally{
      try{journal?.release();}finally{world?.release();}
     }
    }
   }
  },
 });
}
