/** Cooperative single-host account registry. Every supervised launch for an
 * account (including different keys/world directories) MUST use the same private
 * registry and stable accountScope, not a hash of its API key. These labels do
 * not authenticate an account; independent hosts/registries bypass this guard.
 * No credentials, PID stealing, lease expiry or automatic unknown retry. */
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fsyncSync,fstatSync,lstatSync} from 'node:fs';
import {isAbsolute,resolve,join,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SharedModelAccountLedger,type SharedModelAccountPolicy} from './shared-model-account.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
export type AccountOwnershipOptions={registryDirectory:string;accountScope:string;runId:string};
type Registry={db:DatabaseSync;lock:RuntimeOwnership;close:()=>void};
const label=(s:string)=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(s);
function openRegistry(options:AccountOwnershipOptions):Registry{
 if(!label(options.accountScope)||!label(options.runId)||!isAbsolute(options.registryDirectory)
  ||resolve(options.registryDirectory)!==options.registryDirectory)throw Error('model_account_scope_invalid');
 const name=createHash('sha256').update('siliconflow\0'+options.accountScope).digest('hex')+'.sqlite';
 const lock=acquireRuntimeOwnership(join(options.registryDirectory,name));let db:DatabaseSync|undefined;
 try{
  const directory=openSync(dirname(lock.database),constants.O_RDONLY|constants.O_DIRECTORY);
  try{const st=fstatSync(directory);if(st.uid!==process.getuid?.()||(st.mode&0o777)!==0o700)throw Error('model_account_registry_private_directory_required');}finally{closeSync(directory);}
  let fresh=false,fd:number;
  try{fd=openSync(lock.database,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);fresh=true;}
  catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;fd=openSync(lock.database,constants.O_RDONLY|constants.O_NOFOLLOW);}
  try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('model_account_registry_unsafe');if(fresh)fsyncSync(fd);}finally{closeSync(fd);}
  if(fresh){const parent=openSync(dirname(lock.database),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}}
  db=new DatabaseSync(lock.database);
  db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
  if(fresh)db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE account_meta(scope TEXT PRIMARY KEY, active_run TEXT);
   CREATE TABLE account_runs(run TEXT PRIMARY KEY, resolution TEXT, evidence TEXT);
   COMMIT;`);
  if((db.prepare('PRAGMA quick_check').get() as {quick_check:string}).quick_check!=='ok'
   ||(db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous!==2)throw Error('model_account_registry_invalid');
  if(fresh)db.prepare('INSERT INTO account_meta(scope,active_run) VALUES (?,NULL)').run(options.accountScope);
  const rows=db.prepare('SELECT scope,active_run FROM account_meta').all() as {scope:string;active_run:string|null}[];
  if(rows.length!==1||rows[0].scope!==options.accountScope)throw Error('model_account_registry_invalid');
  lock.assertOwned();const owned=db,identity=lstatSync(lock.database);
  const originalAssert=lock.assertOwned.bind(lock);lock.assertOwned=()=>{originalAssert();const current=lstatSync(lock.database);
   if(current.dev!==identity.dev||current.ino!==identity.ino||!current.isFile()||current.nlink!==1
    ||current.uid!==process.getuid?.()||(current.mode&0o077)!==0)throw Error('model_account_registry_changed');};
  return {db:owned,lock,close:()=>{try{owned.close();}finally{lock.release();}}};
 }catch(e){try{db?.close();}finally{lock.release();}throw e;}
}
export interface ProductionModelAccountOwnership{
 readonly accountScope:string;readonly runId:string;
 assertOwned():void;
 /** Call only after child termination AND durable pending-free world/journal
  * acknowledgement. A successful local abort is not proof of remote nonexecution. */
 closeClean():void;
 /** Release OS resources but deliberately retain unresolved durable reservation. */
 abandon():void;
}
type QuotaChild={sealed:()=>boolean;abandon:()=>void};
const QUOTA_MARKER_SQL='CREATE TABLE account_quota_binding (slot INTEGER PRIMARY KEY CHECK(slot=1), version INTEGER NOT NULL, attachment TEXT NOT NULL)';
function quotaEnrolled(db:DatabaseSync):string|null{
 const table=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='account_quota_binding'").get();
 if(!table)return null;
 if(table.type!=='table'||table.sql!==QUOTA_MARKER_SQL)throw Error('model_account_quota_marker_invalid');
 const rows=db.prepare('SELECT slot,version,attachment FROM account_quota_binding LIMIT 2').all();
 if(rows.length!==1||rows[0].slot!==1||rows[0].version!==1||typeof rows[0].attachment!=='string'||!/^[0-9a-f]{64}$/.test(rows[0].attachment))throw Error('model_account_quota_marker_invalid');
 return rows[0].attachment;
}
type OwnerState={registryDirectory:string;scope:string;directory:{dev:number;ino:number};assert:()=>void;marker:()=>string|null;enroll:(binding:string)=>void;claim:(request:string,register:boolean)=>boolean;hasRecovery:(request:string)=>boolean;quota?:QuotaChild;};
const quotaHandles=new WeakSet<object>();
const owners=new WeakMap<ProductionModelAccountOwnership,OwnerState>();

function quotaPath(registry:string,scope:string):string{
 const name=createHash('sha256').update('siliconflow-shared-quota-v1\0'+scope).digest('hex')+'.quota.sqlite';
 return join(registry,name);
}
function scopedRequest(scope:string,request:string):string{
 if(typeof request!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,126}$/.test(request))throw Error('model_account_quota_request_invalid');
 return 'production-run-'+createHash('sha256').update(JSON.stringify([scope,request])).digest('hex');
}
/** Disconnected same-host bridge. This is a cooperating registry's account
 * scope, not a provider login/billing attestation and not permission to send.
 * No paths, policy IDs or synthetic provider claims are supplied by the worker.
 * Only the current branded in-process ownership lease may attach it. */
export function attachProductionAccountQuotaRehearsal(ownership:ProductionModelAccountOwnership,input:{
 mode:'disconnected-rehearsal';policy:SharedModelAccountPolicy;create:boolean;now:number;
}){
 const state=owners.get(ownership);
 if(!state||state.quota||input?.mode!=='disconnected-rehearsal'||input.policy?.accountId!==state.scope)throw Error('model_account_quota_binding_invalid');
 const assert=()=>{
  state.assert();
  const d=lstatSync(state.registryDirectory);
  if(!d.isDirectory()||d.isSymbolicLink()||d.dev!==state.directory.dev||d.ino!==state.directory.ino||
     d.uid!==process.getuid?.()||(d.mode&0o777)!==0o700)throw Error('model_account_quota_registry_changed');
 };
 assert();
 if(input.create&&state.marker())throw Error('model_account_quota_create_after_enrollment');
 const ledger=new SharedModelAccountLedger(quotaPath(state.registryDirectory,state.scope),input.policy,{create:input.create,now:input.now});
 const scoped=(request:string)=>scopedRequest(state.scope,request);
 let sealed=false,closed=false;
 const current=()=>{assert();if(closed)throw Error('model_account_quota_handle_closed');};
 const abandon=()=>{if(!closed){closed=true;ledger.close();}};
 try{current();state.enroll(ledger.offlineFixtureBinding());}catch(e){abandon();throw e;}
 state.quota={sealed:()=>sealed,abandon};
 const handle=Object.freeze({
  kind:'disconnected-production-account-quota' as const,
  accountScope:state.scope,runId:ownership.runId,
  reserve(request:Parameters<SharedModelAccountLedger['reserve']>[0],at:number){
   current();
   const key=scoped(request.requestId);
   if(!state.claim(key,true))return {status:'duplicate' as const};
   const admitted=ledger.reserve({...request,requestId:key},at);
   return admitted.status==='reserved'?{...admitted,requestId:request.requestId}:admitted;
  },
  setResidentWaiting(...args:Parameters<SharedModelAccountLedger['setResidentWaiting']>){current();return ledger.setResidentWaiting(...args);},
  markHandoff(request:string,...args: [at:number]){current();const key=scoped(request);return state.claim(key,false)&&ledger.markHandoff(key,...args);},
  cancelProvenUnsent(request:string,...args: [at:number]){current();const key=scoped(request);return state.claim(key,false)&&ledger.cancelProvenUnsent(key,...args);},
  confirmCompletion(request:string,...args: [at:number,usage?:{inputTokens:number;outputTokens:number}]){current();const key=scoped(request);return state.claim(key,false)&&ledger.confirmCompletion(key,...args);},
  proveOfflineAlmanacCompletion(request:string,completedAt:number,inputTokens:number,outputTokens:number){
   current();
   const key=scoped(request),binding=ledger.offlineFixtureBinding();
   if(state.marker()!==binding||!state.claim(key,false)||state.hasRecovery(key))return null;
   const phase=ledger.requestState(key),charge=ledger.completedCharge(key);
   if(phase?.phase!=='complete'||phase.purpose!=='valley-spirit-almanac'||!charge||
      charge.endedAt!==completedAt||charge.inputTokens!==inputTokens||charge.outputTokens!==outputTokens)return null;
   current();
   return Object.freeze({binding,runId:ownership.runId,completedAt,inputTokens,outputTokens});
  },
  summary(at:number){current();return ledger.summary(at);},
  matchesPolicy(policy:SharedModelAccountPolicy){current();return ledger.matchesPolicy(policy);},
  /** Confirms only this local quota handle is pending free. The existing
   * supervisor must still separately verify child, world and journal clean. */
  sealPendingFree(at:number){
   current();
   const s=ledger.summary(at);
   if(s.held||s.unknown||s.waitingResidents)throw Error('model_account_quota_unresolved');
   ledger.close();closed=true;sealed=true;
  },
 });
 quotaHandles.add(handle);quotaHolder.set(handle,ownership);return handle;
}
export type ProductionAccountQuotaRehearsal=ReturnType<typeof attachProductionAccountQuotaRehearsal>;
const quotaHolder=new WeakMap<object,ProductionModelAccountOwnership>();
/** Checks original host/handle object identity, not caller-reported scopes. */
export function ownsProductionAccountQuotaRehearsal(owner:ProductionModelAccountOwnership,quota:ProductionAccountQuotaRehearsal):boolean{
 return isProductionAccountQuotaRehearsal(quota)&&quotaHolder.get(quota)===owner&&owners.has(owner);
}
export function isProductionAccountQuotaRehearsal(value:unknown):value is ProductionAccountQuotaRehearsal{
 return value!==null&&typeof value==='object'&&quotaHandles.has(value);
}
export function acquireProductionModelAccountOwnership(options:AccountOwnershipOptions):ProductionModelAccountOwnership{
 options={...options};
 const r=openRegistry(options);let closed=false,enrolled:string|null=null;
 try{
  enrolled=quotaEnrolled(r.db);
  const row=r.db.prepare('SELECT active_run FROM account_meta').get() as {active_run:string|null};
  if(row.active_run!==null)throw Error('model_account_unresolved_run');
  r.db.exec('BEGIN IMMEDIATE');
  try{r.db.prepare('INSERT INTO account_runs(run,resolution,evidence) VALUES (?,NULL,NULL)').run(options.runId);
   r.db.prepare('UPDATE account_meta SET active_run=?').run(options.runId);r.db.exec('COMMIT');
  }catch(e){r.db.exec('ROLLBACK');throw e;}
 }catch(e){r.close();throw e;}
 const assertOwned=()=>{if(closed)throw Error('model_account_ownership_closed');r.lock.assertOwned();
  if((r.db.prepare('SELECT active_run FROM account_meta').get() as {active_run:string|null}).active_run!==options.runId)throw Error('model_account_ownership_changed');};
 let state:OwnerState;
 try{
  const directory=openSync(dirname(r.lock.database),constants.O_RDONLY|constants.O_DIRECTORY);
  try{
   const st=fstatSync(directory);
   state={registryDirectory:options.registryDirectory,scope:options.accountScope,directory:{dev:st.dev,ino:st.ino},assert:()=>{
     assertOwned();
     if(quotaEnrolled(r.db)!==enrolled)throw Error('model_account_quota_marker_changed');
    },
    marker:()=>enrolled,
    claim(request,register){assertOwned();return quotaClaim(r.db,request,options.runId,register);},
    hasRecovery(request){assertOwned();return checkedRecoveryTable(r.db)&&!!r.db.prepare('SELECT 1 FROM account_quota_recovery WHERE request=?').get(request);},
    enroll(binding){
     assertOwned();
     if(quotaEnrolled(r.db)!==enrolled)throw Error('model_account_quota_marker_changed');
     if(enrolled&&binding!==enrolled)throw Error('model_account_quota_file_binding_mismatch');
     if(!enrolled){
      r.db.exec('BEGIN IMMEDIATE');
      try{r.db.exec(QUOTA_MARKER_SQL);r.db.prepare('INSERT INTO account_quota_binding VALUES (1,1,?)').run(binding);r.db.exec('COMMIT');enrolled=binding;}
      catch(error){r.db.exec('ROLLBACK');throw error;}
     }
    },
   };
   quotaEnrolled(r.db);
  }finally{closeSync(directory);}
 }catch(error){r.close();throw error;}
 const ensureQuota=()=>{
  assertOwned();
  if(quotaEnrolled(r.db)!==enrolled)throw Error('model_account_quota_marker_changed');
  if(enrolled&&!state.quota)throw Error('model_account_quota_attachment_required');
 };
 const result:ProductionModelAccountOwnership=Object.freeze({accountScope:options.accountScope,runId:options.runId,assertOwned:ensureQuota,
  closeClean(){ensureQuota();if(state.quota&&!state.quota.sealed())throw Error('model_account_quota_not_sealed');
   r.db.exec('BEGIN IMMEDIATE');try{
   r.db.prepare("UPDATE account_runs SET resolution='clean-local-completion' WHERE run=?").run(options.runId);
   r.db.exec('UPDATE account_meta SET active_run=NULL; COMMIT');
  }catch(e){r.db.exec('ROLLBACK');throw e;}closed=true;r.close();},
  abandon(){if(closed)return;closed=true;try{state.quota?.abandon();}finally{r.close();}}});
 owners.set(result,state);
 return result;
}
/** Trusted administrative recovery, never called automatically on restart. This
 * records the caller's externally verified disposition; software cannot prove
 * a vendor response or cost from an evidence string. Does not retry or acknowledge
 * a world decision. The original journal remains blocked pending its own review. */
export function reconcileProductionModelAccountOwnership(options:AccountOwnershipOptions&{
 resolution:'provider-confirmed-not-executed'|'provider-confirmed-completed';evidenceReference:string;
}){
 if(!['provider-confirmed-not-executed','provider-confirmed-completed'].includes(options.resolution)
  ||!/^sha256:[0-9a-f]{64}$/.test(options.evidenceReference))throw Error('model_account_reconciliation_invalid');
 const r=openRegistry(options);
 try{
  if((r.db.prepare('SELECT active_run FROM account_meta').get() as {active_run:string|null}).active_run!==options.runId)throw Error('model_account_reconciliation_run_mismatch');
  if(checkedRecoveryTable(r.db)&&r.db.prepare('SELECT 1 FROM account_quota_recovery WHERE recorded<>1 LIMIT 1').get())
   throw Error('model_account_quota_recovery_incomplete');
  r.db.exec('BEGIN IMMEDIATE');try{
   r.db.prepare('UPDATE account_runs SET resolution=?,evidence=? WHERE run=?').run(options.resolution,options.evidenceReference,options.runId);
   r.db.exec('UPDATE account_meta SET active_run=NULL; COMMIT');
  }catch(e){r.db.exec('ROLLBACK');throw e;}
 }finally{r.close();}
}


const QUOTA_CLAIM_SQL='CREATE TABLE account_quota_claim (request TEXT PRIMARY KEY, run TEXT NOT NULL, FOREIGN KEY(run) REFERENCES account_runs(run))';
function quotaClaim(db:DatabaseSync,request:string,run:string,register:boolean):boolean{
 const schema=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='account_quota_claim'").get();
 if(!schema&&!register)return false;
 if(schema&&(schema.type!=='table'||schema.sql!==QUOTA_CLAIM_SQL||db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name='account_quota_claim' AND type='trigger'").get()))throw Error('model_account_quota_claim_schema');
 if(schema){
  const prior=db.prepare('SELECT run FROM account_quota_claim WHERE request=?').get(request);
  if(prior)return prior.run===run;
  if(!register)return false;
  if(Number(db.prepare('SELECT count(*) AS n FROM account_quota_claim').get()?.n)>=4096)throw Error('model_account_quota_claim_limit');
 }
 // Pin before a quota row can be allocated. A crash between stores may leave
 // an unconsumed claim; its identity cannot be reused by a different run.
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!schema)db.exec(QUOTA_CLAIM_SQL);
  db.prepare('INSERT INTO account_quota_claim VALUES (?,?)').run(request,run);
  db.exec('COMMIT');
  return true;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
const QUOTA_RECOVERY_SQL='CREATE TABLE account_quota_recovery (request TEXT PRIMARY KEY, evidence TEXT NOT NULL, completed_at INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, recorded INTEGER NOT NULL)';
function checkedRecoveryTable(db:DatabaseSync){
 const table=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='account_quota_recovery'").get();
 if(table&&(table.type!=='table'||table.sql!==QUOTA_RECOVERY_SQL||db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name='account_quota_recovery' AND type='trigger'").get()))throw Error('model_account_quota_recovery_schema');
 return !!table;
}
const safeToken=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=100_000_000;

/** Operator-only disconnected recovery. Evidence is a reference to prior
 * independent account review, not vendor authentication. Never creates a run,
 * reaches transport, releases the process owner, or refunds an unknown send. */
export function recordRehearsalQuotaCompletion(options:AccountOwnershipOptions&{
 mode:'disconnected-rehearsal';policy:SharedModelAccountPolicy;requestId:string;evidenceReference:string;
 completedAt:number;usage:{inputTokens:number;outputTokens:number};
}):'recorded'|'already-recorded' {
 if(options?.mode!=='disconnected-rehearsal'||options.policy?.accountId!==options.accountScope||
  !/^sha256:[0-9a-f]{64}$/.test(options.evidenceReference)||!Number.isSafeInteger(options.completedAt)||options.completedAt<0||
  !safeToken(options.usage?.inputTokens)||!safeToken(options.usage?.outputTokens))throw Error('model_account_quota_recovery_invalid');
 const request=scopedRequest(options.accountScope,options.requestId);
 const r=openRegistry(options);
 let ledger:SharedModelAccountLedger|undefined;
 try{
  r.lock.assertOwned();
  if(r.db.prepare('SELECT active_run FROM account_meta').get()?.active_run!==options.runId)throw Error('model_account_quota_recovery_run_mismatch');
  const binding=quotaEnrolled(r.db);
  if(!binding)throw Error('model_account_quota_not_enrolled');
  ledger=new SharedModelAccountLedger(quotaPath(options.registryDirectory,options.accountScope),options.policy,{create:false,now:options.completedAt});
  if(ledger.offlineFixtureBinding()!==binding)throw Error('model_account_quota_file_binding_mismatch');
  if(!quotaClaim(r.db,request,options.runId,false))throw Error('model_account_quota_recovery_request_mismatch');
  const requestState=ledger.requestState(request);
  if(!requestState||!['sent-unknown','complete'].includes(requestState.phase))throw Error('model_account_quota_recovery_request_mismatch');
  const table=checkedRecoveryTable(r.db);
  const existing=table?r.db.prepare('SELECT evidence,completed_at,input_tokens,output_tokens,recorded FROM account_quota_recovery WHERE request=?').get(request):null;
  const {inputTokens,outputTokens}=options.usage;
  if(existing&&(existing.evidence!==options.evidenceReference||existing.completed_at!==options.completedAt||
      existing.input_tokens!==inputTokens||existing.output_tokens!==outputTokens||![0,1].includes(Number(existing.recorded))))throw Error('model_account_quota_recovery_conflict');
  if(!existing){
   if(requestState.phase!=='sent-unknown')throw Error('model_account_quota_recovery_request_mismatch');
   r.db.exec('BEGIN IMMEDIATE');
   try{
    if(!table)r.db.exec(QUOTA_RECOVERY_SQL);
    r.db.prepare('INSERT INTO account_quota_recovery VALUES (?,?,?,?,?,0)').run(request,options.evidenceReference,options.completedAt,inputTokens,outputTokens);
    r.db.exec('COMMIT');
   }catch(error){r.db.exec('ROLLBACK');throw error;}
  }
  r.lock.assertOwned();
  if(requestState.phase==='sent-unknown'){
   if(existing?.recorded===1||!ledger.confirmCompletion(request,options.completedAt,{inputTokens,outputTokens}))throw Error('model_account_quota_recovery_unresolved');
  }
  const completed=ledger.completedCharge(request);
  if(completed?.endedAt!==options.completedAt||completed.inputTokens!==inputTokens||completed.outputTokens!==outputTokens)throw Error('model_account_quota_recovery_completion_conflict');
  if(existing?.recorded===1)return 'already-recorded';
  r.lock.assertOwned();
  if(r.db.prepare('UPDATE account_quota_recovery SET recorded=1 WHERE request=? AND recorded=0').run(request).changes!==1)throw Error('model_account_quota_recovery_conflict');
  return 'recorded';
 }finally{try{ledger?.close();}finally{r.close();}}
}
