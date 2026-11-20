/** Held-only local process integration, never a provider adapter. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {AcceptanceProcessSupervisor,type SupervisedProcess,type SupervisedProcessEvent} from './acceptance-process-supervisor.js';
import {persistedWorldFingerprint} from './acceptance-offline-protocol.js';
import {createDryDeploymentTrust} from './dry-deployment-trust.js';
import {ProductionModelJournal,type ProductionCandidateContract} from './production-model-journal.js';
import {acquirePinnedProductionModelAccountOwnership,type AccountOwnershipOptions} from './production-model-account-ownership.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {preflightWorldSave} from './save-preflight.js';
import {WorldStore} from './store.js';

type Trust=NonNullable<Parameters<typeof createDryDeploymentTrust>[0]>;
type Chain=Parameters<ReturnType<typeof createDryDeploymentTrust>['inspectProvider']>[0];
type Boot=Readonly<{worldPath:string;journalPath:string;account:AccountOwnershipOptions;contract:ProductionCandidateContract;
 trust:Omit<Trust,'clock'>;registryIdentity:string;evidenceJson:string;maxWallMs?:number}>;
const MAX_FILE=32*1024*1024,MAX_WALL=3000;
const fixedWorker='setTimeout(()=>{process.exitCode=0},400);';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
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
   return structuredClone(boot);
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
    // Fixed boot roots and evidence are rechecked at the actual spawn
    // boundary. Only this one-shot instance can attempt the reserved run.
    const admit=()=>createDryDeploymentTrust({...config.trust,clock:()=>{
     const now=Date.now();if(now<wallFloor)return NaN;wallFloor=now;return now;
    }}).inspectProvider(chain,config.contract,
     config.evidenceJson,hash(['held-supervisor-account/v1',config.account.registryDirectory,config.account.accountScope,config.registryIdentity]));
    if(!admit().admitted)return failClosed('held_admission_denied');
    account=acquirePinnedProductionModelAccountOwnership(config.account,config.registryIdentity);
    account.assertOwned();
    if(!confirm())return failClosed('held_artifact_changed');
    const remain=Math.floor(Math.min((config.maxWallMs??MAX_WALL)-(performance.now()-startedAt),config.contract.deadlineAtMs-Date.now()));
    if(remain<1)return failClosed('held_pre_spawn_deadline');
    supervisor=new AcceptanceProcessSupervisor({maxWallMs:remain,termGraceMs:120,killWaitMs:160,pollMs:10});
    const processReport=await supervisor.start(observe=>{
     if(!admit().admitted)throw Error('held_admission_expired');
     spawnAttempted=true;
     return launchHeld(observe);
    });
    spawnObserved=processReport.spawnObserved;
    if(processReport.cleanupComplete&&spawnObserved&&processReport.outcome==='exited_zero'&&processReport.trigger==='child_exit'&&!processReport.issues.length&&confirm()){
     account.assertOwned();account.closeClean();clean=true;
    }
    return {...unavailable(clean?'held_local_clean':'held_local_not_clean'),started:spawnObserved,spawnAttempted,account:clean?'clean-local-only' as const:'unresolved' as const,process:processReport};
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
