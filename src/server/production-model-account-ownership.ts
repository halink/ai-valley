/** Cooperative single-host account registry. Every supervised launch for an
 * account (including different keys/world directories) MUST use the same private
 * registry and stable accountScope, not a hash of its API key. These labels do
 * not authenticate an account; independent hosts/registries bypass this guard.
 * No credentials, PID stealing, lease expiry or automatic unknown retry. */
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fsyncSync,fstatSync,lstatSync} from 'node:fs';
import {isAbsolute,resolve,join,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
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
export function acquireProductionModelAccountOwnership(options:AccountOwnershipOptions):ProductionModelAccountOwnership{
 const r=openRegistry(options);let closed=false;
 try{
  const row=r.db.prepare('SELECT active_run FROM account_meta').get() as {active_run:string|null};
  if(row.active_run!==null)throw Error('model_account_unresolved_run');
  r.db.exec('BEGIN IMMEDIATE');
  try{r.db.prepare('INSERT INTO account_runs(run,resolution,evidence) VALUES (?,NULL,NULL)').run(options.runId);
   r.db.prepare('UPDATE account_meta SET active_run=?').run(options.runId);r.db.exec('COMMIT');
  }catch(e){r.db.exec('ROLLBACK');throw e;}
 }catch(e){r.close();throw e;}
 const assertOwned=()=>{if(closed)throw Error('model_account_ownership_closed');r.lock.assertOwned();
  if((r.db.prepare('SELECT active_run FROM account_meta').get() as {active_run:string|null}).active_run!==options.runId)throw Error('model_account_ownership_changed');};
 return {accountScope:options.accountScope,runId:options.runId,assertOwned,
  closeClean(){assertOwned();r.db.exec('BEGIN IMMEDIATE');try{
   r.db.prepare("UPDATE account_runs SET resolution='clean-local-completion' WHERE run=?").run(options.runId);
   r.db.exec('UPDATE account_meta SET active_run=NULL; COMMIT');
  }catch(e){r.db.exec('ROLLBACK');throw e;}closed=true;r.close();},
  abandon(){if(closed)return;closed=true;r.close();}};
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
  r.db.exec('BEGIN IMMEDIATE');try{
   r.db.prepare('UPDATE account_runs SET resolution=?,evidence=? WHERE run=?').run(options.resolution,options.evidenceReference,options.runId);
   r.db.exec('UPDATE account_meta SET active_run=NULL; COMMIT');
  }catch(e){r.db.exec('ROLLBACK');throw e;}
 }finally{r.close();}
}
