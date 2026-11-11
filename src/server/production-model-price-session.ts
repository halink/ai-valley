/** Purely offline, synthetic-only epoch/session ledger. Caller supplies a new
 * isolated SQLite handle and simulated timestamps. No transport or runtime is
 * wired; a returned intent is NOT a live dispatch capability. */
import type {DatabaseSync} from 'node:sqlite';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {syntheticCount as count,syntheticDigest as digest,syntheticRecord as record,syntheticRecordHash as hash,
 inspectSyntheticPriceEvidence,parseSyntheticPriceRecord,type SyntheticPriceEvidence,type SyntheticPriceRecord} from './production-model-price-evidence.js';
export const SYNTHETIC_PRICE_SESSION_LIMITS=Object.freeze({maxRequests:20_000,maxWallMs:21_600_000,maxSegments:720,
 maxEpochs:720,segmentWallMs:30_000,segmentRequests:128,maxAuditRecords:60_002} as const);
const L=SYNTHETIC_PRICE_SESSION_LIMITS;
export type SyntheticPriceSessionContract=Readonly<{schema:1;executionKind:'synthetic-price-session-v1';runId:string;worldId:string;
 sourceFingerprint:string;fixtureScopeHash:string;provider:typeof P.provider;model:typeof P.model;endpoint:typeof P.endpoint;
 createdAtMs:number;deadlineAtMs:number;maxRequests:number;requestTimeoutMs:number;commitGraceMs:number;
 maxSegments:number;maxEpochs:number;maxAuditRecords:number;segmentWallMs:30_000;modelSlots:1;retries:0;fallback:null;spendingLimitCny:0}>;
type ContractInput=Pick<SyntheticPriceSessionContract,'runId'|'worldId'|'sourceFingerprint'|'fixtureScopeHash'|'createdAtMs'|'deadlineAtMs'|
 'maxRequests'|'requestTimeoutMs'|'commitGraceMs'|'maxSegments'|'maxEpochs'|'maxAuditRecords'>;
const inputKeys=['runId','worldId','sourceFingerprint','fixtureScopeHash','createdAtMs','deadlineAtMs','maxRequests','requestTimeoutMs',
 'commitGraceMs','maxSegments','maxEpochs','maxAuditRecords'] as const;
export function syntheticPriceSessionContract(input:ContractInput):SyntheticPriceSessionContract{
 const r=record(input,inputKeys) as ContractInput;
 if(typeof r.runId!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(r.runId)||typeof r.worldId!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(r.worldId)
  ||!digest(r.sourceFingerprint)||!digest(r.fixtureScopeHash)||!count(r.createdAtMs)||!count(r.deadlineAtMs)||r.deadlineAtMs<=r.createdAtMs
  ||r.deadlineAtMs-r.createdAtMs>L.maxWallMs||!count(r.maxRequests)||r.maxRequests<1||r.maxRequests>L.maxRequests
  ||!count(r.requestTimeoutMs)||r.requestTimeoutMs<1||!count(r.commitGraceMs)||r.commitGraceMs<1
  ||r.requestTimeoutMs+r.commitGraceMs>=L.segmentWallMs||!count(r.maxSegments)||r.maxSegments<1||r.maxSegments>L.maxSegments
  ||!count(r.maxEpochs)||r.maxEpochs<1||r.maxEpochs>L.maxEpochs||!count(r.maxAuditRecords)||r.maxAuditRecords<16||r.maxAuditRecords>L.maxAuditRecords)
  throw new Error('synthetic_session_contract_invalid');
 return Object.freeze({schema:1,executionKind:'synthetic-price-session-v1',...r,provider:P.provider,model:P.model,endpoint:P.endpoint,
  segmentWallMs:L.segmentWallMs,modelSlots:1,retries:0,fallback:null,spendingLimitCny:0});
}
function contract(input:unknown){
 const keys=['schema','executionKind',...inputKeys,'provider','model','endpoint','segmentWallMs','modelSlots','retries','fallback','spendingLimitCny'];
 const r=record(input,keys),value=syntheticPriceSessionContract(Object.fromEntries(inputKeys.map(key=>[key,r[key]])) as ContractInput);
 if(keys.some(key=>r[key]!==value[key as keyof SyntheticPriceSessionContract]))throw new Error('synthetic_session_contract_invalid');return value;
}
type Segment={id:number;deadlineAtMs:number;admissionCutoffMs:number;attempts:number;epoch:number;evidenceHash:string};
type Pending={id:number;phase:'intent'|'response';requestHash:string;responseHash:string|null;segment:number;epoch:number;evidenceHash:string;deadlineAtMs:number};
export type SyntheticWorldCheckpoint=Readonly<{worldId:string;fingerprint:string}>;
function checkedWorld(input:SyntheticWorldCheckpoint):SyntheticWorldCheckpoint{
 const value=record(input,['worldId','fingerprint']);
 if(typeof value.worldId!=='string'||!digest(value.fingerprint))throw new Error('synthetic_checkpoint_rejected');
 return value as SyntheticWorldCheckpoint;
}
type State={phase:'awaiting_price'|'ready'|'running'|'draining'|'blocked';failure:string|null;lastObservedAtMs:number;
 worldFingerprint:string;epochs:number;evidence:SyntheticPriceRecord|null;evidenceHash:string|null;
 segments:number;reservedWallMs:number;attempts:number;completed:number;segment:Segment|null;pending:Pending|null};
type Event={type:'created';contract:SyntheticPriceSessionContract;worldFingerprint:string;at:number}
 |{type:'price_installed';evidence:SyntheticPriceRecord;at:number}
 |{type:'price_wait'|'checked'|'segment_started'|'drain_started';at:number}
 |{type:'intent';requestHash:string;at:number}
 |{type:'response';id:number;responseHash:string;at:number}
 |{type:'acknowledged';id:number;worldId:string;worldFingerprint:string;at:number}
 |{type:'world_checkpoint'|'segment_finished';worldId:string;worldFingerprint:string;at:number}
 |{type:'blocked';reason:string};
type Row={sequence:number;previous_hash:string;body:string;hash:string};
const eventKeys:Record<Event['type'],readonly string[]>={created:['type','contract','worldFingerprint','at'],price_installed:['type','evidence','at'],
 price_wait:['type','at'],checked:['type','at'],segment_started:['type','at'],drain_started:['type','at'],intent:['type','requestHash','at'],
 response:['type','id','responseHash','at'],acknowledged:['type','id','worldId','worldFingerprint','at'],world_checkpoint:['type','worldId','worldFingerprint','at'],
 segment_finished:['type','worldId','worldFingerprint','at'],blocked:['type','reason']};
const owners=new WeakSet<DatabaseSync>();
const reason=(v:unknown):v is string=>typeof v==='string'&&/^[a-z_]{1,80}$/.test(v);
export class SyntheticPriceSession {
 readonly contract:SyntheticPriceSessionContract;readonly contractHash:string;
 private state!:State;private sequence=0;private lastHash:string;private unusable=false;
 constructor(private db:DatabaseSync,input:SyntheticPriceSessionContract,options:{create:boolean;worldFingerprint:string;nowMs:number}){
  this.contract=contract(input);this.contractHash=hash(this.contract);this.lastHash=this.contractHash;
  if(!digest(options.worldFingerprint)||!count(options.nowMs))throw new Error('synthetic_session_options_invalid');
  if(owners.has(db))throw new Error('synthetic_session_owner_active');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
  if(options.create?tables.length!==0:tables.length!==1||tables[0].name!=='synthetic_price_session_audit')throw new Error('synthetic_session_isolated_handle_required');
  try{db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT');}
  catch{throw new Error('synthetic_session_owner_active');}
  owners.add(db);
  this.assertModes();
  if(options.create){
   if(options.nowMs<this.contract.createdAtMs||options.nowMs>=this.contract.deadlineAtMs)throw new Error('synthetic_session_time_invalid');
   db.exec('CREATE TABLE synthetic_price_session_audit(sequence INTEGER PRIMARY KEY,previous_hash TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL)');
   this.append({type:'created',contract:this.contract,worldFingerprint:options.worldFingerprint,at:options.nowMs});
  }else{
   if((db.prepare('PRAGMA quick_check').get() as {quick_check:string})?.quick_check!=='ok')throw new Error('synthetic_session_audit_invalid');
   const n=(db.prepare('SELECT count(*) AS n FROM synthetic_price_session_audit').get() as {n:number}).n;
   if(!count(n)||n<1||n>this.contract.maxAuditRecords)throw new Error('synthetic_session_audit_invalid');
   for(const row of db.prepare('SELECT sequence,previous_hash,body,hash FROM synthetic_price_session_audit ORDER BY sequence').iterate() as Iterable<Row>){
    if(typeof row.body!=='string'||row.body.length>8192||row.sequence!==this.sequence+1||row.previous_hash!==this.lastHash
     ||hash({sequence:row.sequence,previousHash:row.previous_hash,body:row.body})!==row.hash)throw new Error('synthetic_session_audit_invalid');
    this.state=this.reduce(JSON.parse(row.body));this.sequence=row.sequence;this.lastHash=row.hash;
   }
   if(this.state.worldFingerprint!==options.worldFingerprint)throw new Error('synthetic_session_world_mismatch');
   if(!this.state.failure&&(this.state.pending||this.state.segment))this.block(this.state.pending?'unresolved_request_no_retry':'segment_unsealed_no_resume');
   if(!this.state.failure)this.poll(options.nowMs);
  }
 }
 private assertModes(){
  if((this.db.prepare('PRAGMA journal_mode').get() as {journal_mode:string}).journal_mode!=='delete'
   ||(this.db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous!==2
   ||(this.db.prepare('PRAGMA locking_mode').get() as {locking_mode:string}).locking_mode!=='exclusive')throw new Error('synthetic_session_durability_unavailable');
 }
 private reduce(value:unknown):State{
  if(!value||typeof value!=='object')throw new Error('synthetic_session_event_invalid');
  const type=(value as Event).type;if(!Object.hasOwn(eventKeys,type))throw new Error('synthetic_session_event_invalid');
  const keys=eventKeys[type];
  const e=record(value,keys) as unknown as Event,c=this.contract;
  if(e.type==='created'){
   if(this.sequence!==0||hash(contract(e.contract))!==this.contractHash||!digest(e.worldFingerprint)||!count(e.at)||e.at<c.createdAtMs||e.at>=c.deadlineAtMs)throw new Error('synthetic_session_event_invalid');
   return {phase:'awaiting_price',failure:null,lastObservedAtMs:e.at,worldFingerprint:e.worldFingerprint,epochs:0,evidence:null,evidenceHash:null,
    segments:0,reservedWallMs:0,attempts:0,completed:0,segment:null,pending:null};
  }
  if(!this.state||this.state.failure)throw new Error('synthetic_session_event_invalid');
  const s=structuredClone(this.state);
  if(e.type==='blocked'){if(!reason(e.reason))throw new Error('synthetic_session_event_invalid');s.failure=e.reason;s.phase='blocked';return s;}
  if(!count(e.at)||e.at<s.lastObservedAtMs||e.at>=c.deadlineAtMs)throw new Error('synthetic_session_time_invalid');s.lastObservedAtMs=e.at;
  if(s.segment&&(e.at>=s.segment.deadlineAtMs||s.evidence&&e.at>=s.evidence.validUntilMs)
   ||s.pending&&e.at>=s.pending.deadlineAtMs+(s.pending.phase==='response'?c.commitGraceMs:0))throw new Error('synthetic_session_time_invalid');
  const fresh=()=>s.evidence!==null&&e.at>=s.evidence.observedAtMs&&e.at<s.evidence.validUntilMs;
  if(e.type==='price_installed'){
   const evidence=parseSyntheticPriceRecord(e.evidence);
   if(s.segment||s.pending||!['ready','awaiting_price'].includes(s.phase)||s.epochs>=c.maxEpochs||evidence.scopeHash!==this.contractHash
    ||evidence.sequence!==s.epochs+1||evidence.previousEvidenceHash!==s.evidenceHash||e.at<evidence.observedAtMs||e.at>=evidence.validUntilMs
    ||s.evidence&&evidence.observedAtMs<=s.evidence.observedAtMs)throw new Error('synthetic_price_renewal_rejected');
   s.evidence=evidence;s.evidenceHash=hash(evidence);s.epochs++;s.phase='ready';
  }else if(e.type==='price_wait'){
   if(s.segment||s.pending||!['ready','awaiting_price'].includes(s.phase))throw new Error('synthetic_price_renewal_rejected');s.phase='awaiting_price';
  }else if(e.type==='segment_started'){
   const deadline=Math.min(e.at+L.segmentWallMs,c.deadlineAtMs,s.evidence?.validUntilMs??0),cutoff=deadline-c.requestTimeoutMs-c.commitGraceMs;
   if(s.phase!=='ready'||s.segment||s.pending||!fresh()||e.at>=cutoff||s.segments>=c.maxSegments||s.attempts>=c.maxRequests
    ||s.reservedWallMs+L.segmentWallMs>L.maxWallMs)throw new Error('synthetic_segment_rejected');
   s.segments++;s.reservedWallMs+=L.segmentWallMs;s.phase='running';
   s.segment={id:s.segments,deadlineAtMs:deadline,admissionCutoffMs:cutoff,attempts:0,epoch:s.epochs,evidenceHash:s.evidenceHash!};
  }else if(e.type==='drain_started'){
   if(s.phase!=='running'||!s.segment||e.at>=s.segment.deadlineAtMs)throw new Error('synthetic_segment_rejected');s.phase='draining';
  }else if(e.type==='intent'){
   if(s.phase!=='running'||!s.segment||s.pending||!fresh()||e.at>=s.segment.admissionCutoffMs||!digest(e.requestHash)
    ||s.attempts>=c.maxRequests||s.segment.attempts>=L.segmentRequests)throw new Error('synthetic_request_rejected');
   s.attempts++;s.segment.attempts++;s.pending={id:s.attempts,phase:'intent',requestHash:e.requestHash,responseHash:null,
    segment:s.segment.id,epoch:s.epochs,evidenceHash:s.evidenceHash!,deadlineAtMs:e.at+c.requestTimeoutMs};
  }else if(e.type==='response'){
   if(!s.segment||!s.pending||s.pending.phase!=='intent'||s.pending.id!==e.id||!fresh()||e.at>=s.pending.deadlineAtMs
    ||e.at>=s.segment.deadlineAtMs||!digest(e.responseHash))throw new Error('synthetic_response_rejected');
   s.pending.phase='response';s.pending.responseHash=e.responseHash;
  }else if(e.type==='acknowledged'){
   if(!s.segment||!s.pending||s.pending.phase!=='response'||s.pending.id!==e.id||!fresh()||e.at>=s.pending.deadlineAtMs+c.commitGraceMs
    ||e.at>=s.segment.deadlineAtMs||e.worldId!==c.worldId||!digest(e.worldFingerprint))throw new Error('synthetic_ack_rejected');
   s.completed++;s.pending=null;s.worldFingerprint=e.worldFingerprint;
  }else if(e.type==='world_checkpoint'){
   if(!s.segment||e.worldId!==c.worldId||!digest(e.worldFingerprint))throw new Error('synthetic_checkpoint_rejected');s.worldFingerprint=e.worldFingerprint;
  }else if(e.type==='segment_finished'){
   if(s.phase!=='draining'||!s.segment||s.pending||e.at>=s.segment.deadlineAtMs||e.worldId!==c.worldId||e.worldFingerprint!==s.worldFingerprint)throw new Error('synthetic_segment_rejected');
   s.segment=null;s.phase=fresh()?'ready':'awaiting_price';
  }else if(e.type!=='checked')throw new Error('synthetic_session_event_invalid');
  return s;
 }
 private append(event:Event){
  if(this.unusable)throw new Error('synthetic_session_unusable');
  if(this.sequence>=this.contract.maxAuditRecords||(event.type!=='blocked'&&this.sequence>=this.contract.maxAuditRecords-1))throw new Error('synthetic_audit_limit');
  const next=this.reduce(event),body=JSON.stringify(event),sequence=this.sequence+1,previousHash=this.lastHash,digest=hash({sequence,previousHash,body});
  try{this.db.exec('BEGIN IMMEDIATE');
   const tip=this.db.prepare('SELECT sequence,hash FROM synthetic_price_session_audit ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;hash:string}|undefined;
   if((tip?.sequence??0)!==this.sequence||tip&&tip.hash!==this.lastHash)throw new Error('synthetic_session_stale');
   this.db.prepare('INSERT INTO synthetic_price_session_audit(sequence,previous_hash,body,hash) VALUES(?,?,?,?)').run(sequence,previousHash,body,digest);this.db.exec('COMMIT');
  }catch(error){this.unusable=true;try{this.db.exec('ROLLBACK');}catch{}throw error;}
  this.state=next;this.sequence=sequence;this.lastHash=digest;
 }
 private owned(){
  if(this.unusable)throw new Error('synthetic_session_unusable');
  try{this.assertModes();const tip=this.db.prepare('SELECT sequence,hash FROM synthetic_price_session_audit ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;hash:string};
   if(tip?.sequence!==this.sequence||tip?.hash!==this.lastHash)throw new Error('synthetic_session_stale');
  }catch{this.unusable=true;throw new Error('synthetic_session_owner_lost');}
 }
 private guard(at:number){
  this.owned();if(this.state.failure)throw new Error(this.state.failure);
  let failure:string|null=null;const s=this.state;
  if(!count(at)||at<s.lastObservedAtMs)failure='clock_invalid';
  else if(at>=this.contract.deadlineAtMs)failure='global_deadline';
  else if(s.segment&&s.evidence&&at>=s.evidence.validUntilMs)failure='price_expired_in_segment';
  else if(s.pending&&at>=s.pending.deadlineAtMs+(s.pending.phase==='response'?this.contract.commitGraceMs:0))failure='request_deadline';
  else if(s.segment&&at>=s.segment.deadlineAtMs)failure='segment_deadline';
  if(failure){this.block(failure);throw new Error(failure);}
 }
 private act<T>(at:number,operation:()=>T):T{
  try{this.guard(at);return operation();}catch(error){
   if(!this.unusable&&!this.state.failure){const message=error instanceof Error&&/^[a-z_]{1,80}$/.test(error.message)?error.message:'synthetic_operation_failed';this.block(message);}
   throw error;
  }
 }
 private block(code:string){if(this.state.failure)return;try{this.append({type:'blocked',reason:reason(code)?code:'synthetic_operation_failed'});}catch{this.unusable=true;throw new Error('synthetic_failure_not_persisted');}}
 installPrice(evidence:SyntheticPriceEvidence,at:number){return this.act(at,()=>{const value=inspectSyntheticPriceEvidence(evidence);
  this.append({type:'price_installed',evidence:value,at});return this.state.epochs;});}
 beginSegment(at:number):number|null{return this.act(at,()=>{
  const s=this.state,c=this.contract;
  if(s.segment||s.pending)throw new Error('synthetic_segment_rejected');
  if(s.attempts>=c.maxRequests||s.segments>=c.maxSegments||s.reservedWallMs+L.segmentWallMs>L.maxWallMs)throw new Error('synthetic_budget_exhausted');
  if(at+c.requestTimeoutMs+c.commitGraceMs>=c.deadlineAtMs)throw new Error('global_deadline');
  if(!s.evidence||at+c.requestTimeoutMs+c.commitGraceMs>=s.evidence.validUntilMs){this.append({type:'price_wait',at});return null;}
  this.append({type:'segment_started',at});return this.state.segments;
 });}
 beginRequest(requestHash:string,at:number):number|null{return this.act(at,()=>{
  if(this.state.phase==='draining'){this.append({type:'checked',at});return null;}
  if(this.state.phase==='running'&&this.state.segment&&at>=this.state.segment.admissionCutoffMs){this.append({type:'drain_started',at});return null;}
  this.append({type:'intent',requestHash,at});return this.state.attempts;
 });}
 recordResponse(id:number,responseHash:string,at:number){this.act(at,()=>this.append({type:'response',id,responseHash,at}));}
 acknowledgeWorldCommit(id:number,world:SyntheticWorldCheckpoint,at:number){this.act(at,()=>{const w=checkedWorld(world);this.append({type:'acknowledged',id,worldId:w.worldId,worldFingerprint:w.fingerprint,at});});}
 checkpointWorld(world:SyntheticWorldCheckpoint,at:number){this.act(at,()=>{const w=checkedWorld(world);this.append({type:'world_checkpoint',worldId:w.worldId,worldFingerprint:w.fingerprint,at});});}
 beginDrain(at:number){this.act(at,()=>this.append({type:'drain_started',at}));}
 finishSegment(world:SyntheticWorldCheckpoint,at:number){this.act(at,()=>{const w=checkedWorld(world);this.append({type:'segment_finished',worldId:w.worldId,worldFingerprint:w.fingerprint,at});});}
 poll(at:number){this.act(at,()=>{
  if(this.state.phase==='running'&&this.state.segment&&at>=this.state.segment.admissionCutoffMs)this.append({type:'drain_started',at});
  else if(!this.state.segment&&this.state.evidence&&at>=this.state.evidence.validUntilMs)this.append({type:'price_wait',at});
  else this.append({type:'checked',at});
 });return this.status();}
 fail(code:'runtime_failed'|'evidence_failed'|'billing_unknown'|'nonzero_cost'|'source_unknown'|'manual_abandonment'){
  this.owned();this.block(['runtime_failed','evidence_failed','billing_unknown','nonzero_cost','source_unknown','manual_abandonment'].includes(code)?code:'external_failure');
 }
 status(){return {...structuredClone(this.state),contract:this.contract,contractHash:this.contractHash,auditRecords:this.sequence,auditHash:this.lastHash,
  persistenceHealthy:!this.unusable,executionKind:'synthetic-price-session-v1',sourceAuthenticityVerified:false,liveExecutionEnabled:false,
  realModelExecuted:false,actualProviderCostCny:null,readyForProduction:false,requiresExternalTimer:true,acceptancePassed:null} as const;}
}
