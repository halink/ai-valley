/** Durable offline session accounting. An unresolved intent never becomes a
 * retry. Independent owner SQLite lock is held for process lifetime; the audit
 * database commits each event separately with synchronous=FULL. */
import {DatabaseSync} from 'node:sqlite';
import {AcceptanceRunDirectory} from './acceptance-run-directory.js';
import {persistedWorldFingerprint as hash} from './acceptance-offline-protocol.js';
import {RESUMABLE_PROTOCOL as P,RESUMABLE_PROTOCOL_HASH} from './acceptance-resumable-protocol.js';
export type ResumeState={schema:1;protocolHash:string;sourceFingerprint:string;worldId:string;
 phase:'active'|'paused'|'blocked'|'completed';segments:number;reservedWallMs:number;attempts:number;
 worldFingerprint:string|null;revision:number|null;minute:number;successes:number;
 pending:null|{id:number;phase:'intent'|'response';requestHash:string;beforeSuccesses:number};
 failure:string|null;unsealedSegments:number;lastEvidenceRunId:string|null;lastEvidenceHash:string|null};
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
function checked(value:unknown):ResumeState{
 const s=value as ResumeState;
 if(!s||s.schema!==1||s.protocolHash!==RESUMABLE_PROTOCOL_HASH||!digest(s.sourceFingerprint)||typeof s.worldId!=='string'
  ||!['active','paused','blocked','completed'].includes(s.phase)||!count(s.segments)||s.segments>P.maxSegments
  ||s.reservedWallMs!==s.segments*P.segmentWallMs||s.reservedWallMs>P.maxReservedWallMs||!count(s.attempts)||s.attempts>P.maxRequests
  ||s.worldFingerprint!==null&&!digest(s.worldFingerprint)||s.revision!==null&&!count(s.revision)
  ||!Number.isFinite(s.minute)||s.minute<P.fromMinute||s.minute>P.endGameMinute||!count(s.successes)||s.successes>s.attempts
  ||!count(s.unsealedSegments)||s.unsealedSegments>s.segments||s.failure!==null&&!/^[a-z_]{1,80}$/.test(s.failure)
  ||s.lastEvidenceHash!==null&&!digest(s.lastEvidenceHash)
  ||s.lastEvidenceRunId!==null&&!/^[0-9a-f-]{36}$/.test(s.lastEvidenceRunId))throw new Error('resumable_state_invalid');
 if(s.pending&&(!count(s.pending.id)||s.pending.id!==s.attempts||!['intent','response'].includes(s.pending.phase)
  ||!digest(s.pending.requestHash)||s.pending.beforeSuccesses!==s.successes))throw new Error('resumable_pending_invalid');
 return structuredClone(s);
}
export class ResumableJournal{
 private owner:DatabaseSync;private db!:DatabaseSync;private state!:ResumeState;private sequence=0;private lastHash=RESUMABLE_PROTOCOL_HASH;private closed=false;private evidence:Array<{segment:number;runId:string;reportHash:string;throughMinute:number}>=[];
 constructor(private directory:AcceptanceRunDirectory,options:{create:boolean;sourceFingerprint:string;worldId?:string}){
  this.owner=new DatabaseSync(directory.database('owner.sqlite',options.create));
  try{this.owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');}catch{this.owner.close();throw new Error('resumable_owner_active');}
  try{
   this.db=new DatabaseSync(directory.database('resumable.sqlite',options.create));
   this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF');
   if(options.create){
    this.db.exec('CREATE TABLE audit(sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL)');
    this.state=checked({schema:1,protocolHash:RESUMABLE_PROTOCOL_HASH,sourceFingerprint:options.sourceFingerprint,worldId:options.worldId,
     phase:'paused',segments:0,reservedWallMs:0,attempts:0,worldFingerprint:null,revision:null,minute:P.fromMinute,successes:0,pending:null,failure:null,unsealedSegments:0,lastEvidenceRunId:null,lastEvidenceHash:null});
    this.append('created',this.state);
   }else{
    if((this.db.prepare('PRAGMA quick_check').get() as any)?.quick_check!=='ok')throw new Error('resumable_database_invalid');
    const count=(this.db.prepare('SELECT count(*) AS n FROM audit').get() as {n:number}).n;
    if(!count||count>250_000)throw new Error('resumable_audit_invalid');let attempts=0,segments=0;
    for(const row of this.db.prepare('SELECT sequence,previous_hash,body,hash FROM audit ORDER BY sequence').iterate() as Iterable<{sequence:number;previous_hash:string;body:string;hash:string}>){
     if(row.body.length>8192||row.sequence!==this.sequence+1||row.previous_hash!==this.lastHash||hash({sequence:row.sequence,previousHash:row.previous_hash,body:row.body})!==row.hash)throw new Error('resumable_audit_invalid');
     const event=JSON.parse(row.body);if(!/^[a-z_]+$/.test(event.type)||event.type==='created'&&row.sequence!==1)throw new Error('resumable_audit_invalid');
     const next=checked(event.state);if(event.type==='request_intent')attempts++;if(event.type==='segment_started')segments++;
     if(next.attempts!==attempts||next.segments!==segments||next.sourceFingerprint!==options.sourceFingerprint
      ||this.state&&(next.worldId!==this.state.worldId||next.successes<this.state.successes||next.minute<this.state.minute))throw new Error('resumable_history_mismatch');
     if(event.type==='segment_closed')this.rememberEvidence(next);
     this.state=next;this.sequence=row.sequence;this.lastHash=row.hash;
    }
   }
  }catch(error){try{this.db!?.close();}finally{this.owner.close();}throw error;}
 }
 private append(type:string,state:ResumeState){
  if(this.sequence>=250_000)throw new Error('resumable_audit_limit');
  const next=checked(state),body=JSON.stringify({type,state:next}),sequence=this.sequence+1,previousHash=this.lastHash,
   digest=hash({sequence,previousHash,body});
  this.db.exec('BEGIN IMMEDIATE');
  try{this.db.prepare('INSERT INTO audit(sequence,previous_hash,body,hash) VALUES(?,?,?,?)').run(sequence,previousHash,body,digest);this.db.exec('COMMIT');}
  catch(error){this.db.exec('ROLLBACK');throw error;}
  this.sequence=sequence;this.lastHash=digest;this.state=next;if(type==='segment_closed')this.rememberEvidence(next);
 }
 private rememberEvidence(state:ResumeState){
  if(!state.lastEvidenceRunId||!state.lastEvidenceHash)throw new Error('resumable_evidence_reference_missing');
  this.evidence.push({segment:state.segments,runId:state.lastEvidenceRunId,reportHash:state.lastEvidenceHash,throughMinute:state.minute});
 }
 closedEvidence(){return structuredClone(this.evidence);}
 status(){return {...structuredClone(this.state),auditRecords:this.sequence,auditHash:this.lastHash,realModelExecuted:false,actualProviderCostCny:null,acceptancePassed:null};}
 verifyWorld(world:{id:string;minute:number;revision:number;metrics:{successes:number}},fingerprint:string){
  if(this.state.worldId!==world.id||this.state.worldFingerprint!==fingerprint||this.state.revision!==world.revision
   ||this.state.minute!==world.minute||this.state.successes!==world.metrics.successes)throw new Error('resumable_world_mismatch');
 }
 beginSegment(){
  const s=this.state;
  if(s.pending)throw new Error('unresolved_request_no_retry');
  if(s.phase==='blocked'||s.failure)throw new Error('resumable_run_blocked');
  if(s.phase==='completed'||s.minute>=P.endGameMinute)throw new Error('resumable_already_completed');
  if(s.attempts>=P.maxRequests||s.segments>=P.maxSegments||s.reservedWallMs+P.segmentWallMs>P.maxReservedWallMs)throw new Error('resumable_budget_exhausted');
  // Charge the entire absolute segment budget BEFORE starting it. Crashes and
  // fast restarts never refund time or create a fresh global request allowance.
  this.append('segment_started',{...s,phase:'active',segments:s.segments+1,reservedWallMs:s.reservedWallMs+P.segmentWallMs,
   unsealedSegments:s.unsealedSegments+(s.phase==='active'?1:0)});
  return this.state.segments;
 }
 intent(requestHash:string){
  const s=this.state;
  if(s.phase!=='active'||s.pending||s.attempts>=P.maxRequests||!digest(requestHash))throw new Error('resumable_request_rejected');
  const id=s.attempts+1;this.append('request_intent',{...s,attempts:id,pending:{id,phase:'intent',requestHash,beforeSuccesses:s.successes}});return id;
 }
 response(id:number){
  if(this.state.phase!=='active'||this.state.pending?.id!==id||this.state.pending.phase!=='intent')throw new Error('resumable_late_response');
  this.append('response_observed',{...this.state,pending:{...this.state.pending,phase:'response'}});
 }
 checkpoint(world:{id:string;minute:number;revision:number;metrics:{successes:number}},fingerprint:string,reconciledLocalInFlight=false){
  const s=this.state;if(world.id!==s.worldId||!digest(fingerprint)||world.minute<s.minute||world.revision<(s.revision??0))throw new Error('resumable_world_mismatch');
  let pending=s.pending;
  if(world.metrics.successes!==s.successes){
   if(s.phase!=='active'||!pending||pending.phase!=='response'||world.metrics.successes!==pending.beforeSuccesses+1)throw new Error('resumable_commit_unmatched');
   pending=null;
  }
  this.append(reconciledLocalInFlight?'local_inflight_reconciled':pending===s.pending?'world_committed':'request_committed',{...s,pending,worldFingerprint:fingerprint,revision:world.revision,minute:world.minute,successes:world.metrics.successes});
 }
 finish(evidenceRunId:string,evidenceHash:string){
  const s=this.state;if(s.phase!=='active'||s.pending)throw new Error('unresolved_request_no_retry');
  this.append('segment_closed',{...s,phase:s.minute===P.endGameMinute?'completed':'paused',lastEvidenceRunId:evidenceRunId,lastEvidenceHash:evidenceHash});
 }
 fail(reason:string){
  if(!/^[a-z_]{1,80}$/.test(reason))reason='resumable_failure';
  if(this.state.phase!=='blocked')this.append('blocked',{...this.state,phase:'blocked',failure:reason});
 }
 close(){if(this.closed)return;this.closed=true;try{this.db.close();}finally{this.owner.close();}}
}
