/** Disconnected production safety candidate. Caller supplies an isolated SQLite
 * handle; this module never opens a path, reads credentials, or sends traffic.
 * FULL commits precede dispatch. Unknown intents are deliberately not resumable.
 * A separate world commit must precede acknowledgeWorldCommit; there is no claim
 * of an atomic transaction across these two databases. */
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {ACCEPTANCE_STOP_REASONS,type AcceptanceStopReason} from './acceptance-stop-control.js';

export const modelEvidenceHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
export type ProductionCandidateContract=Readonly<{schema:1;executionKind:'synthetic-production-candidate'|'gated-production-http-candidate';admissionHash?:string;runId:string;worldId:string;
 provider:'siliconflow';model:typeof P.model;endpoint:typeof P.endpoint;maxRequests:number;createdAtMs:number;deadlineAtMs:number;requestTimeoutMs:number;
 modelSlots:1;retries:0;fallback:null;spendingLimitCny:0}>;
export function productionCandidateContract(input:{runId:string;worldId:string;maxRequests:number;createdAtMs:number;deadlineAtMs:number;requestTimeoutMs:number}):ProductionCandidateContract{
 const {runId,worldId,maxRequests,createdAtMs,deadlineAtMs,requestTimeoutMs}=input;
 if(!/^[a-zA-Z0-9_-]{1,96}$/.test(runId)||!/^[a-zA-Z0-9:_-]{1,160}$/.test(worldId)
  ||!count(maxRequests)||maxRequests<1||maxRequests>20_000||!count(createdAtMs)||!count(deadlineAtMs)
  ||deadlineAtMs<=createdAtMs||deadlineAtMs-createdAtMs>6*60*60_000
  ||!count(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>150_000||requestTimeoutMs>deadlineAtMs-createdAtMs)throw new Error('production_contract_invalid');
 return Object.freeze({schema:1,executionKind:'synthetic-production-candidate',runId,worldId,...P,maxRequests,createdAtMs,deadlineAtMs,requestTimeoutMs});
}
export function productionGatedCandidateContract(input:Parameters<typeof productionCandidateContract>[0]&{admissionHash:string}):ProductionCandidateContract{
 if(!digest(input.admissionHash))throw new Error('production_admission_invalid');
 return Object.freeze({...productionCandidateContract(input),executionKind:'gated-production-http-candidate',admissionHash:input.admissionHash});
}
function canonicalContract(contract:ProductionCandidateContract){
 return contract.executionKind==='gated-production-http-candidate'
  ?productionGatedCandidateContract({...contract,admissionHash:contract.admissionHash!}):productionCandidateContract(contract);
}
type Pending={id:number;phase:'intent'|'response';requestHash:string;responseHash:string|null};
export const CLEAN_RUNTIME_STOP_REASONS=Object.freeze(['game_endpoint','wall_limit','request_limit','manual_stop','signal'] as const);
type State={attempts:number;completed:number;pending:Pending|null;failure:string|null;lastObservedAtMs:number;worldFingerprint:string;
 runtimeStop:{reason:AcceptanceStopReason}|null};
type Event={type:'created';contract:ProductionCandidateContract;worldFingerprint:string}
 |{type:'intent';id:number;requestHash:string;at:number}
 |{type:'response';id:number;responseHash:string;at:number}
 |{type:'world_committed';id:number;worldFingerprint:string;at:number}
 |{type:'world_checkpoint';worldFingerprint:string;at:number}
 |{type:'runtime_stop_started';reason:AcceptanceStopReason;at:number}
 |{type:'runtime_stop_finished';worldFingerprint:string;failed:boolean;at:number}
 |{type:'blocked';reason:string};
type Row={sequence:number;previous_hash:string;body:string;hash:string};
const reason=(value:unknown):value is string=>typeof value==='string'&&/^[a-z_0-9]{1,96}$/.test(value);
const ownedHandles=new WeakSet<DatabaseSync>();
export class ProductionModelJournal{
 private sequence=0;private lastHash:string;private state!:State;private unusable=false;
 readonly contract:ProductionCandidateContract;
 constructor(private db:DatabaseSync,contract:ProductionCandidateContract,options:{create:boolean;worldFingerprint:string}){
  this.contract=canonicalContract(contract);
  if(modelEvidenceHash(contract)!==modelEvidenceHash(this.contract)||!digest(options.worldFingerprint))throw new Error('production_contract_invalid');
  this.lastHash=modelEvidenceHash(this.contract);
  if(ownedHandles.has(db))throw new Error('production_journal_owner_active');
  // Unlike a per-transaction compare-and-swap, EXCLUSIVE locking mode retains
  // the file lock after COMMIT. A second process cannot block/reopen this run
  // between the durable intent and transport invocation. The caller must close
  // this handle to release ownership, including after constructor failure.
  try{db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT');}
  catch{throw new Error('production_journal_owner_active');}
  ownedHandles.add(db);
  if((db.prepare('PRAGMA journal_mode').get() as {journal_mode:string}).journal_mode!=='delete'
   ||(db.prepare('PRAGMA locking_mode').get() as {locking_mode:string}).locking_mode!=='exclusive'
   ||(db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous!==2)throw new Error('production_journal_durability_unavailable');
  if(options.create){
   // Never overwrite or reset an existing ledger, even with the same run id.
   db.exec('CREATE TABLE production_model_audit(sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL)');
   this.append({type:'created',contract:this.contract,worldFingerprint:options.worldFingerprint});
  }else{
   if((db.prepare('PRAGMA quick_check').get() as {quick_check:string})?.quick_check!=='ok')throw new Error('production_journal_invalid');
   const n=(db.prepare('SELECT count(*) AS n FROM production_model_audit').get() as {n:number}).n;
   if(!count(n)||n<1||n>60_002)throw new Error('production_journal_invalid');
   for(const row of db.prepare('SELECT sequence,previous_hash,body,hash FROM production_model_audit ORDER BY sequence').iterate() as Iterable<Row>){
    if(row.body.length>4096||row.sequence!==this.sequence+1||row.previous_hash!==this.lastHash
     ||modelEvidenceHash({sequence:row.sequence,previousHash:row.previous_hash,body:row.body})!==row.hash)throw new Error('production_journal_invalid');
    this.state=this.reduce(JSON.parse(row.body));this.sequence=row.sequence;this.lastHash=row.hash;
   }
   if(this.state.worldFingerprint!==options.worldFingerprint)throw new Error('production_world_mismatch');
   if(this.state.pending&&!this.state.failure)this.block('unresolved_request_no_retry');
   if(this.state.runtimeStop&&!this.state.failure)this.block('runtime_stop_unresolved');
  }
 }
 private reduce(e:Event):State{
  if(e.type==='created'){
   if(this.sequence!==0||modelEvidenceHash(e.contract)!==modelEvidenceHash(this.contract)||!digest(e.worldFingerprint))throw new Error('production_journal_invalid');
   return {attempts:0,completed:0,pending:null,failure:null,lastObservedAtMs:this.contract.createdAtMs,worldFingerprint:e.worldFingerprint,runtimeStop:null};
  }
  if(!this.state)throw new Error('production_journal_invalid');
  const s=structuredClone(this.state);
  if(e.type==='blocked'){
   if(!reason(e.reason)||s.failure)throw new Error('production_journal_invalid');s.failure=e.reason;return s;
  }
  if(s.failure||!count(e.at)||e.at<s.lastObservedAtMs||e.at>=this.contract.deadlineAtMs)throw new Error('production_journal_invalid');
  if(s.runtimeStop&&e.type!=='world_checkpoint'&&e.type!=='runtime_stop_finished')throw new Error('production_journal_invalid');
  s.lastObservedAtMs=e.at;
  if(e.type==='intent'){
   if(s.pending||e.id!==s.attempts+1||e.id>this.contract.maxRequests||!digest(e.requestHash))throw new Error('production_journal_invalid');
   s.attempts=e.id;s.pending={id:e.id,phase:'intent',requestHash:e.requestHash,responseHash:null};
  }else if(e.type==='response'){
   if(s.pending?.id!==e.id||s.pending.phase!=='intent'||!digest(e.responseHash))throw new Error('production_journal_invalid');
   s.pending.phase='response';s.pending.responseHash=e.responseHash;
  }else if(e.type==='world_committed'){
   if(s.pending?.id!==e.id||s.pending.phase!=='response'||!digest(e.worldFingerprint))throw new Error('production_journal_invalid');
   s.completed++;s.pending=null;s.worldFingerprint=e.worldFingerprint;
  }else if(e.type==='world_checkpoint'){
   // Offline runtime wiring only. Ordinary ticks/start/stop must not acknowledge
   // a response, even when they occur between response and decision adoption.
   if(this.contract.executionKind!=='synthetic-production-candidate'||!digest(e.worldFingerprint))throw new Error('production_journal_invalid');
   s.worldFingerprint=e.worldFingerprint;
  }else if(e.type==='runtime_stop_started'){
   if(this.contract.executionKind!=='synthetic-production-candidate'||!ACCEPTANCE_STOP_REASONS.includes(e.reason))throw new Error('production_journal_invalid');
   s.runtimeStop={reason:e.reason};
  }else if(e.type==='runtime_stop_finished'){
   if(this.contract.executionKind!=='synthetic-production-candidate'||!s.runtimeStop||typeof e.failed!=='boolean'
    ||!digest(e.worldFingerprint)||e.worldFingerprint!==s.worldFingerprint)throw new Error('production_journal_invalid');
   if(!e.failed&&(s.pending||!CLEAN_RUNTIME_STOP_REASONS.some(reason=>reason===s.runtimeStop!.reason)))throw new Error('production_journal_invalid');
   s.runtimeStop=null;if(e.failed)s.failure='runtime_control_failed';
  }else throw new Error('production_journal_invalid');
  return s;
 }
 private append(event:Event){
  if(this.unusable)throw new Error('production_journal_unusable');
  const next=this.reduce(event),body=JSON.stringify(event),sequence=this.sequence+1,previousHash=this.lastHash,
   hash=modelEvidenceHash({sequence,previousHash,body});
  if(sequence>60_002)throw new Error('production_journal_limit');
  try{
   this.db.exec('BEGIN IMMEDIATE');
   const current=this.db.prepare('SELECT sequence,hash FROM production_model_audit ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;hash:string}|undefined;
   if((current?.sequence??0)!==this.sequence||current&&current.hash!==this.lastHash)throw new Error('production_journal_stale');
   this.db.prepare('INSERT INTO production_model_audit(sequence,previous_hash,body,hash) VALUES(?,?,?,?)').run(sequence,previousHash,body,hash);
   this.db.exec('COMMIT');
  }catch(error){this.unusable=true;try{this.db.exec('ROLLBACK');}catch{}throw error;}
  this.state=next;this.sequence=sequence;this.lastHash=hash;
 }
 check(at:number){
  if(this.unusable)throw new Error('production_journal_unusable');
  // The caller owns the handle, so detect accidental close, mode downgrade or
  // out-of-band writes before dispatch as well as before each transition.
  try{
   const current=this.db.prepare('SELECT sequence,hash FROM production_model_audit ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;hash:string}|undefined;
   if((this.db.prepare('PRAGMA locking_mode').get() as {locking_mode:string}).locking_mode!=='exclusive'
    ||(this.db.prepare('PRAGMA journal_mode').get() as {journal_mode:string}).journal_mode!=='delete'
    ||(this.db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous!==2
    ||current?.sequence!==this.sequence||current.hash!==this.lastHash)throw new Error('owner_lost');
  }catch{this.unusable=true;throw new Error('production_journal_owner_lost');}
  if(this.state.failure)throw new Error(this.state.failure);
  if(!count(at)||at<this.state.lastObservedAtMs){this.block('clock_invalid');throw new Error('clock_invalid');}
  if(at>=this.contract.deadlineAtMs){this.block('wall_limit');throw new Error('wall_limit');}
 }
 intent(requestHash:string,at:number){
  this.check(at);
  if(this.state.pending){this.block('unresolved_request_no_retry');throw new Error('unresolved_request_no_retry');}
  if(this.state.attempts>=this.contract.maxRequests){this.block('request_limit');throw new Error('request_limit');}
  const id=this.state.attempts+1;this.append({type:'intent',id,requestHash,at});return id;
 }
 response(id:number,responseHash:string,at:number){this.check(at);this.append({type:'response',id,responseHash,at});}
 acknowledgeWorldCommit(id:number,worldFingerprint:string,at:number){this.check(at);this.append({type:'world_committed',id,worldFingerprint,at});}
 checkpointWorld(worldFingerprint:string,at:number){
  if(this.contract.executionKind!=='synthetic-production-candidate')throw new Error('production_checkpoint_offline_only');
  this.check(at);this.append({type:'world_checkpoint',worldFingerprint,at});
 }
 beginRuntimeStop(reason:AcceptanceStopReason,at:number){
  if(this.contract.executionKind!=='synthetic-production-candidate')throw new Error('production_checkpoint_offline_only');
  this.check(at);this.append({type:'runtime_stop_started',reason,at});
 }
 finishRuntimeStop(worldFingerprint:string,failed:boolean,at:number){
  if(this.contract.executionKind!=='synthetic-production-candidate')throw new Error('production_checkpoint_offline_only');
  this.check(at);this.append({type:'runtime_stop_finished',worldFingerprint,failed,at});
 }
 block(failure:string){if(!this.state.failure)this.append({type:'blocked',reason:reason(failure)?failure:'model_failed'});}
 status(){return {...structuredClone(this.state),auditRecords:this.sequence,auditHash:this.lastHash,
  persistenceHealthy:!this.unusable,actualProviderCostCny:null,realModelExecuted:this.contract.executionKind==='synthetic-production-candidate'||this.state.attempts===0?false:null,liveExecutionEnabled:false,acceptancePassed:null} as const;}
}
