import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {acquireRuntimeOwnership,assertExistingRollbackSqliteHeader,type RuntimeOwnership} from './runtime-lock.js';

export type ModelAccountPurpose='resident'|'valley-spirit-almanac';
export interface ModelAccountCapacity {rpm:number;tpm:number;slots:number;}
export interface SharedModelAccountPolicy {
 accountId:string;
 limit:ModelAccountCapacity;
 residentFloor:ModelAccountCapacity;
 almanacCap:ModelAccountCapacity;
 almanacCooldownMs:number;
}
type Phase='held'|'sent-unknown'|'complete'|'cancelled';
interface Request {
 id:string;purpose:ModelAccountPurpose;phase:Phase;
 at:number;handoffAt:number|null;endedAt:number|null;
 input:number;output:number;usedInput:number|null;usedOutput:number|null;
}
interface State {schema:1;now:number;waiters:string[];requests:Request[];}
const MAX_REQUESTS=4096,MAX_WAITERS=512,MAX_STATE_BYTES=2*1024*1024,WINDOW=60_000;
const DIMENSIONS=['rpm','tpm','slots'] as const;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,126}$/.test(v);
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const pos=(v:unknown):v is number=>count(v)&&v>0;
const token=(v:unknown):v is number=>count(v)&&v<=100_000_000;
const purpose=(v:unknown):v is ModelAccountPurpose=>v==='resident'||v==='valley-spirit-almanac';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const shape=(v:unknown,keys:readonly string[])=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
const cap=(v:ModelAccountCapacity)=>shape(v,DIMENSIONS)&&DIMENSIONS.every(k=>pos(v[k])&&v[k]<=100_000_000);
const trustedPolicy=(v:SharedModelAccountPolicy):SharedModelAccountPolicy=>{
 if(!shape(v,['accountId','limit','residentFloor','almanacCap','almanacCooldownMs'])||!id(v.accountId)||!cap(v.limit)||!cap(v.residentFloor)||!cap(v.almanacCap)||!pos(v.almanacCooldownMs)||
 !DIMENSIONS.every(k=>v.residentFloor[k]<v.limit[k]&&v.almanacCap[k]<=v.limit[k]-v.residentFloor[k]))throw Error('model_account_policy_invalid');
 const canonical=(c:ModelAccountCapacity)=>({rpm:c.rpm,tpm:c.tpm,slots:c.slots});
 return {accountId:v.accountId,limit:canonical(v.limit),residentFloor:canonical(v.residentFloor),almanacCap:canonical(v.almanacCap),almanacCooldownMs:v.almanacCooldownMs};
};
function decode(value:unknown):State {
 const s=value as State;
 if(!shape(value,['schema','now','waiters','requests'])||s.schema!==1||!count(s.now)||!Array.isArray(s.waiters)||s.waiters.length>MAX_WAITERS||s.waiters.some(w=>!id(w))||
  new Set(s.waiters).size!==s.waiters.length||!Array.isArray(s.requests)||s.requests.length>MAX_REQUESTS)throw Error('model_account_state_invalid');
 const seen=new Set<string>();
 let last=-1;
 for(const r of s.requests){
  if(!shape(r,['id','purpose','phase','at','handoffAt','endedAt','input','output','usedInput','usedOutput'])||!id(r.id)||seen.has(r.id)||!purpose(r.purpose)||
   !count(r.at)||r.at<last||r.at>s.now||!token(r.input)||!token(r.output)||r.input+r.output===0)throw Error('model_account_request_invalid');
  const timestamp=(v:unknown,lower:number)=>count(v)&&v>=lower&&v<=s.now;
  switch(r.phase){
   case 'held': if(r.handoffAt!==null||r.endedAt!==null||r.usedInput!==null||r.usedOutput!==null)throw Error('model_account_request_invalid');break;
   case 'sent-unknown': if(!timestamp(r.handoffAt,r.at)||r.endedAt!==null||r.usedInput!==null||r.usedOutput!==null)throw Error('model_account_request_invalid');break;
   case 'complete': if(r.handoffAt===null||!timestamp(r.handoffAt,r.at)||!timestamp(r.endedAt,r.handoffAt)||
     !((r.usedInput===null&&r.usedOutput===null)||(token(r.usedInput)&&token(r.usedOutput))))throw Error('model_account_request_invalid');break;
   case 'cancelled': if(r.handoffAt!==null||!timestamp(r.endedAt,r.at)||r.usedInput!==null||r.usedOutput!==null)throw Error('model_account_request_invalid');break;
   default: throw Error('model_account_request_invalid');
  }
  seen.add(r.id);last=r.at;
 }
 return s;
}
function capacity(s:State,at:number,only?:ModelAccountPurpose):ModelAccountCapacity {
 const aggregate={rpm:0,tpm:0,slots:0};
 for(const r of s.requests){
  if(r.phase==='cancelled'||only&&r.purpose!==only)continue;
  const active=r.phase!=='complete';
  // Keep unresolved request/token exposure across windows and restart. Once
  // finished, use the later observed completion to age it out conservatively.
  if(active||r.endedAt!>at-WINDOW){
   aggregate.rpm++;
   aggregate.tpm+=(r.usedInput??r.input)+(r.usedOutput??r.output);
   if(active)aggregate.slots++;
  }
 }
 return aggregate;
}
const room=(used:ModelAccountCapacity,limit:ModelAccountCapacity,requestedTokens:number)=>used.rpm<limit.rpm&&used.slots<limit.slots&&requestedTokens<=limit.tpm-used.tpm;
const sqliteParts=(db:DatabaseSync)=>db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
const REQ='shared_model_account';
function load(db:DatabaseSync,policyText:string):State {
 const parts=sqliteParts(db);
 if(parts.length!==1||parts[0].name!==REQ||parts[0].type!=='table')throw Error('model_account_schema_invalid');
 const columns=db.prepare('PRAGMA table_info(shared_model_account)').all();
 const want=[['singleton','INTEGER',1,0],['schema_version','INTEGER',0,1],['policy_json','TEXT',0,1],['state_json','TEXT',0,1]] as const;
 if(columns.length!==want.length||columns.some((c,i)=>c.name!==want[i][0]||c.type!==want[i][1]||c.pk!==want[i][2]||c.notnull!==want[i][3]))throw Error('model_account_schema_invalid');
 const rows=db.prepare("SELECT singleton,schema_version,CASE WHEN length(CAST(policy_json AS BLOB)) <= 4096 THEN policy_json ELSE NULL END AS policy_json,CASE WHEN length(CAST(state_json AS BLOB)) <= ? THEN state_json ELSE NULL END AS state_json FROM shared_model_account LIMIT 2").all(MAX_STATE_BYTES);
 if(rows.length!==1||rows[0].singleton!==1||rows[0].schema_version!==1||rows[0].policy_json!==policyText||typeof rows[0].state_json!=='string')throw Error('model_account_state_or_policy_invalid');
 return decode(JSON.parse(rows[0].state_json));
}
const exists=(file:string)=>{try{return lstatSync(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
const noJournal=(path:string)=>{for(const suffix of ['-wal','-shm','-journal'])if(exists(path+suffix))throw Error('model_account_pending_journal');};
/** One exact historical row, under the existing ledger lease; never opens a
 * writable data connection, updates clocks/budgets or treats totals as proof. */
export function verifyHistoricalAlmanacLedger(database:string,policy:SharedModelAccountPolicy,binding:string,
 requestId:string,completedAt:number,inputTokens:number,outputTokens:number):boolean{
 if(!id(requestId)||!count(completedAt)||!token(inputTokens)||!token(outputTokens))return false;
 const policyText=JSON.stringify(trustedPolicy(policy)),owner=acquireRuntimeOwnership(database,{existingOnly:true});
 let db:DatabaseSync|undefined;
 try{
  owner.assertOwned();noJournal(owner.database);
  const file=lstatSync(owner.database),parent=lstatSync(dirname(owner.database)+'/.');
  if(!file.isFile()||file.nlink!==1||file.uid!==process.getuid?.()||(file.mode&0o022)!==0||
     !parent.isDirectory()||parent.uid!==file.uid||(parent.mode&0o777)!==0o700||
     createHash('sha256').update(JSON.stringify([policyText,file.dev,file.ino])).digest('hex')!==binding)return false;
  assertExistingRollbackSqliteHeader(owner.database);
  db=new DatabaseSync('file:'+owner.database+'?immutable=1',{readOnly:true});
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN');
  const state=load(db,policyText),r=state.requests.find(row=>row.id===requestId);
  owner.assertOwned();noJournal(owner.database);assertExistingRollbackSqliteHeader(owner.database);db.exec('COMMIT');
  return r?.phase==='complete'&&r.purpose==='valley-spirit-almanac'&&r.endedAt===completedAt&&
   r.usedInput===inputTokens&&r.usedOutput===outputTokens;
 }finally{try{db?.close();}finally{owner.release();}}
}
export type SharedModelAccountAdmission =
 {status:'reserved';requestId:string}|
 {status:'resident-priority'|'account-capacity'|'almanac-capacity'|'almanac-cooldown'|'duplicate'|'ledger-capacity'};
/** A dedicated one-account database and single descriptor-anchored lease.
 * No provider, simulated clock, token estimator, policy source, or credentials
 * are inferred. Only the account owner may call these internal methods. */
export class SharedModelAccountLedger {
 private readonly owner:RuntimeOwnership;
 private readonly db:DatabaseSync;
 private readonly policy:SharedModelAccountPolicy;
 private readonly policyText:string;
 private closed=false;
 private expected:string;
 private readonly identity:{dev:number;ino:number};
 constructor(database:string,policy:SharedModelAccountPolicy,options:{create:boolean;now:number}){
  this.policy=trustedPolicy(policy);this.policyText=JSON.stringify(this.policy);
  if(!options||typeof options.create!=='boolean'||!count(options.now))throw Error('model_account_open_invalid');
  const owner=acquireRuntimeOwnership(database);
  let db:DatabaseSync|undefined;
  try{
   owner.assertOwned();noJournal(owner.database);
   if(options.create){
    if(exists(owner.database))throw Error('model_account_explicit_create_existing');
   }else{
    const file=exists(owner.database);if(!file||file.size===0)throw Error('model_account_missing');
    const ro=new DatabaseSync(owner.database,{readOnly:true});
    try{
     ro.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
     const previous=load(ro,this.policyText);
     if(options.now<previous.now)throw Error('model_account_clock_rollback');
    }finally{ro.close();}
   }
   db=new DatabaseSync(owner.database);
   db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
   if(db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')throw Error('model_account_journal_mode');
   if(options.create){
    db.exec("BEGIN IMMEDIATE; CREATE TABLE shared_model_account(singleton INTEGER PRIMARY KEY,schema_version INTEGER NOT NULL,policy_json TEXT NOT NULL,state_json TEXT NOT NULL)");
    db.prepare('INSERT INTO shared_model_account VALUES (1,1,?,?)').run(this.policyText,JSON.stringify({schema:1,now:options.now,waiters:[],requests:[]}));
    owner.assertOwned();db.exec('COMMIT');
   }
   this.expected=JSON.stringify(load(db,this.policyText));
   const file=lstatSync(owner.database);
   this.identity={dev:file.dev,ino:file.ino};this.db=db;this.owner=owner;
  }catch(e){try{db?.close();}finally{owner.release();}throw e;}
 }
 private assertOwned(){
  this.owner.assertOwned();
  const f=lstatSync(this.owner.database);
  if(f.dev!==this.identity.dev||f.ino!==this.identity.ino)throw Error('model_account_database_replaced');
 }
 private read(){
  if(this.closed)throw Error('model_account_closed');
  this.assertOwned();const s=load(this.db,this.policyText);
  if(JSON.stringify(s)!==this.expected)throw Error('model_account_database_changed');
  return s;
 }
 matchesPolicy(policy:SharedModelAccountPolicy):boolean{return JSON.stringify(trustedPolicy(policy))===this.policyText;}
 private update<T>(at:number,change:(s:State)=>T):T {
  if(!count(at)||this.closed)throw Error('model_account_time_invalid');
  this.assertOwned();this.db.exec('BEGIN IMMEDIATE');
  try{
   const s=this.read();if(at<s.now)throw Error('model_account_clock_rollback');
   s.now=at;const result=change(s);decode(s);
   if(bytes(s)>MAX_STATE_BYTES)throw Error('model_account_state_full');
   const encoded=JSON.stringify(s);
   this.db.prepare('UPDATE shared_model_account SET state_json=? WHERE singleton=1').run(encoded);
   this.assertOwned();this.db.exec('COMMIT');this.expected=encoded;return result;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 setResidentWaiting(residentDecisionId:string,waiting:boolean,at:number):void {
  if(!id(residentDecisionId)||typeof waiting!=='boolean')throw Error('model_account_wait_invalid');
  this.update(at,s=>{
   const key=s.waiters.indexOf(residentDecisionId);
   if(waiting&&key<0){if(s.waiters.length>=MAX_WAITERS)throw Error('model_account_wait_full');s.waiters.push(residentDecisionId);}
   else if(!waiting&&key>=0)s.waiters.splice(key,1);
  });
 }
 reserve(request:{requestId:string;purpose:ModelAccountPurpose;inputTokens:number;outputTokens:number;residentDecisionId?:string},at:number):SharedModelAccountAdmission {
  const {requestId,purpose:category,inputTokens,outputTokens,residentDecisionId}=request;
  if(!id(requestId)||!purpose(category)||!token(inputTokens)||!token(outputTokens)||inputTokens+outputTokens===0||
   residentDecisionId!==undefined&&(category!=='resident'||!id(residentDecisionId)))throw Error('model_account_reservation_invalid');
  const tokens=inputTokens+outputTokens;
  return this.update(at,s=>{
   if(s.requests.some(r=>r.id===requestId))return {status:'duplicate'};
   if(s.requests.length>=MAX_REQUESTS)return {status:'ledger-capacity'};
   const p=this.policy,used=capacity(s,at);
   if(category==='valley-spirit-almanac'){
    if(s.waiters.length)return {status:'resident-priority'};
    if(s.requests.some(r=>r.purpose===category&&r.at>at-p.almanacCooldownMs))return {status:'almanac-cooldown'};
    if(!room(capacity(s,at,category),p.almanacCap,tokens))return {status:'almanac-capacity'};
    const aboveFloor=(k:keyof ModelAccountCapacity)=>p.limit[k]-p.residentFloor[k];
    if(!room(used,{rpm:aboveFloor('rpm'),tpm:aboveFloor('tpm'),slots:aboveFloor('slots')},tokens))return {status:'account-capacity'};
   }
   if(!room(used,p.limit,tokens))return {status:'account-capacity'};
   s.requests.push({id:requestId,purpose:category,phase:'held',at,handoffAt:null,endedAt:null,input:inputTokens,output:outputTokens,usedInput:null,usedOutput:null});
   if(residentDecisionId)s.waiters=s.waiters.filter(w=>w!==residentDecisionId);
   return {status:'reserved',requestId};
  });
 }
 /** Must durably succeed before anyone hands bytes to a transport. From then
  * an exception, lost reply, local abort or process death does not mean unsent. */
 markHandoff(requestId:string,at:number):boolean {
  return this.update(at,s=>{
   const r=s.requests.find(r=>r.id===requestId);if(r?.phase!=='held')return false;
   r.phase='sent-unknown';r.handoffAt=at;return true;
  });
 }
 /** Recovery can cancel a held row because no process was authorized to send
  * from that phase. No cancellation is possible once handoff is recorded. */
 cancelProvenUnsent(requestId:string,at:number):boolean {
  return this.update(at,s=>{
   const r=s.requests.find(r=>r.id===requestId);if(r?.phase!=='held')return false;
   r.phase='cancelled';r.endedAt=at;return true;
  });
 }
 /** A trusted account supervisor/adapter has proven external completion and
  * settled usage. Missing usage retains the original reservation estimate. */
 confirmCompletion(requestId:string,at:number,usage?:{inputTokens:number;outputTokens:number}):boolean {
  if(usage!==undefined&&(!token(usage.inputTokens)||!token(usage.outputTokens)))throw Error('model_account_usage_invalid');
  return this.update(at,s=>{
   const r=s.requests.find(r=>r.id===requestId);if(r?.phase!=='sent-unknown')return false;
   r.phase='complete';r.endedAt=at;r.usedInput=usage?.inputTokens??null;r.usedOutput=usage?.outputTokens??null;return true;
  });
 }
 accountIdentity():string{return this.policy.accountId;}
 /** Offline fixture scope. A different file/inode or policy cannot reopen a
  * bound fixture world. This does not attest production-account identity. */
 offlineFixtureBinding():string{
  this.read();
  return createHash('sha256').update(JSON.stringify([this.policyText,this.identity.dev,this.identity.ino])).digest('hex');
 }
 /** Internal recovery lookup. No response text or private resident state. */
 requestStates(requestIds:readonly string[]):Map<string,{phase:Phase;purpose:ModelAccountPurpose}> {
  if(!Array.isArray(requestIds)||requestIds.length>MAX_REQUESTS||requestIds.some(s=>!id(s)))throw Error('model_account_request_id_invalid');
  const wanted=new Set(requestIds);
  return new Map(this.read().requests.filter(r=>wanted.has(r.id)).map(r=>[r.id,{phase:r.phase,purpose:r.purpose}]));
 }
 requestState(requestId:string):{phase:Phase;purpose:ModelAccountPurpose}|null {
  if(!id(requestId))throw Error('model_account_request_id_invalid');
  const r=this.read().requests.find(row=>row.id===requestId);
  return r?{phase:r.phase,purpose:r.purpose}:null;
 }
 /** Recovery comparison only; reported fields are null when no usage arrived. */
 completedCharge(requestId:string){
  if(!id(requestId))throw Error('model_account_request_id_invalid');
  const r=this.read().requests.find(row=>row.id===requestId);
  return r?.phase==='complete'?{endedAt:r.endedAt,inputTokens:r.usedInput,outputTokens:r.usedOutput}:null;
 }
 summary(at:number) {
  const s=this.read();
  if(!count(at)||at<s.now)throw Error('model_account_clock_rollback');
  return {schemaVersion:1 as const,accountId:this.policy.accountId,account:capacity(s,at),almanac:capacity(s,at,'valley-spirit-almanac'),
   waitingResidents:s.waiters.length,unknown:s.requests.filter(r=>r.phase==='sent-unknown').length,held:s.requests.filter(r=>r.phase==='held').length};
 }
 close(){if(this.closed)return;this.db.close();this.closed=true;this.owner.release();}
}
