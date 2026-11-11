/** Launch allocation is separate from model requests. Every reserved launch is
 * charged before spawn; an unfinished launch is never retried or refunded. */
import type {DatabaseSync} from 'node:sqlite';
import {syntheticRecord as record,syntheticRecordHash as hash,syntheticDigest as digest,syntheticCount as count} from './production-model-price-evidence.js';
import {syntheticPriceSessionContract,type SyntheticPriceSessionContract} from './production-model-price-session.js';
export type SyntheticLaunchReceipt={schema:1;kind:'synthetic-price-launch';contractHash:string;id:number;worldFingerprint:string;
 attempts:number;completed:number;previousSessionHash:string;sessionHash:string;journalHash:string;evidenceHash:string;startedAtMs:number;deadlineAtMs:number;
 startedMonotonicNs:string;deadlineMonotonicNs:string;bootId:string};
type State={launches:number;finished:number;reservedWallMs:number;attempts:number;completed:number;worldFingerprint:string;
 sessionHash:string;journalHash:string;lastReportHash:string|null;lastAtMs:number;lastMonotonicNs:string;pending:SyntheticLaunchReceipt|null;failure:string|null};
type Event={type:'created';worldFingerprint:string;sessionHash:string;journalHash:string;at:number;monotonicNs:string;bootId:string;contractHash:string}
 |{type:'reserved';receipt:SyntheticLaunchReceipt}|{type:'finished';id:number;worldFingerprint:string;attempts:number;completed:number;sessionHash:string;journalHash:string;reportHash:string;at:number;monotonicNs:string}
 |{type:'blocked';reason:string};
const ns=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,23})$/.test(v);
const reason=(v:unknown):v is string=>typeof v==='string'&&/^[a-z_]{1,80}$/.test(v);
const owners=new WeakSet<DatabaseSync>();
export class SyntheticLaunchLedger{
 private sequence=0;private tip:string;private state!:State;private unusable=false;
 readonly contractHash:string;readonly contract:SyntheticPriceSessionContract;
 constructor(private db:DatabaseSync,contract:SyntheticPriceSessionContract,readonly bootId:string,
  options:{create:boolean;worldFingerprint:string;sessionHash:string;journalHash:string;nowMs:number;monotonicNs:string}){
  const fields=['runId','worldId','sourceFingerprint','fixtureScopeHash','createdAtMs','deadlineAtMs','maxRequests','requestTimeoutMs','commitGraceMs','maxSegments','maxEpochs','maxAuditRecords'] as const;
  const snapshot=record(contract,['schema','executionKind',...fields,'provider','model','endpoint','segmentWallMs','modelSlots','retries','fallback','spendingLimitCny']);
  this.contract=syntheticPriceSessionContract(Object.fromEntries(fields.map(k=>[k,snapshot[k]])) as Parameters<typeof syntheticPriceSessionContract>[0]);
  if(hash(snapshot)!==hash(this.contract))throw Error('launch_contract_invalid');this.contractHash=hash(this.contract);this.tip=this.contractHash;
  if(owners.has(db)||!digest(options.worldFingerprint)||!ns(options.monotonicNs)||!count(options.nowMs)||!/^[0-9a-f-]{36}$/.test(bootId))throw Error('launch_options_invalid');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
  if(options.create?tables.length!==0:tables.length!==1||tables[0].name!=='synthetic_launch_audit')throw Error('launch_isolated_database_required');
  db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE; PRAGMA trusted_schema=OFF; BEGIN EXCLUSIVE; COMMIT');owners.add(db);
  if(options.create){db.exec('CREATE TABLE synthetic_launch_audit(sequence INTEGER PRIMARY KEY,previous_hash TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL)');
   this.append({type:'created',worldFingerprint:options.worldFingerprint,sessionHash:options.sessionHash,journalHash:options.journalHash,at:options.nowMs,monotonicNs:options.monotonicNs,bootId,contractHash:this.contractHash});
  }else{
   if((db.prepare('PRAGMA quick_check').get() as {quick_check:string}).quick_check!=='ok')throw Error('launch_database_invalid');
   for(const row of db.prepare('SELECT sequence,previous_hash,body,hash FROM synthetic_launch_audit ORDER BY sequence').iterate() as Iterable<{sequence:number;previous_hash:string;body:string;hash:string}>){
    if(this.sequence>=4096||row.sequence!==this.sequence+1||row.previous_hash!==this.tip||typeof row.body!=='string'||row.body.length>8192||hash({sequence:row.sequence,previousHash:row.previous_hash,body:row.body})!==row.hash)throw Error('launch_audit_invalid');
    this.state=this.reduce(JSON.parse(row.body));this.sequence=row.sequence;this.tip=row.hash;
   }
   if(!this.state)throw Error('launch_audit_invalid');
   if(this.state.pending&&!this.state.failure)this.fail('launch_unresolved_no_retry');
   if(!this.state.failure)this.check(options.nowMs,options.monotonicNs);
  }
 }
 private reduce(input:unknown):State{
  const type=(input as Event)?.type,keys={created:['type','worldFingerprint','sessionHash','journalHash','at','monotonicNs','bootId','contractHash'],reserved:['type','receipt'],
   finished:['type','id','worldFingerprint','attempts','completed','sessionHash','journalHash','reportHash','at','monotonicNs'],blocked:['type','reason']}[type];
  if(!keys)throw Error('launch_event_invalid');const e=record(input,keys) as unknown as Event;
  if(e.type==='created'){
   if(this.sequence||e.contractHash!==this.contractHash||e.bootId!==this.bootId||![e.worldFingerprint,e.sessionHash,e.journalHash].every(digest)||!count(e.at)||e.at<this.contract.createdAtMs||e.at>=this.contract.deadlineAtMs||!ns(e.monotonicNs))throw Error('launch_created_invalid');
   return {launches:0,finished:0,reservedWallMs:0,attempts:0,completed:0,worldFingerprint:e.worldFingerprint,sessionHash:e.sessionHash,journalHash:e.journalHash,lastReportHash:null,lastAtMs:e.at,lastMonotonicNs:e.monotonicNs,pending:null,failure:null};
  }
  if(!this.state||this.state.failure)throw Error('launch_blocked');const s=structuredClone(this.state);
  if(e.type==='blocked'){if(!reason(e.reason))throw Error('launch_reason_invalid');s.failure=e.reason;return s;}
  if(e.type==='reserved'){
   const r=record(e.receipt,['schema','kind','contractHash','id','worldFingerprint','attempts','completed','previousSessionHash','sessionHash','journalHash','evidenceHash','startedAtMs','deadlineAtMs','startedMonotonicNs','deadlineMonotonicNs','bootId']) as SyntheticLaunchReceipt;
   if(s.pending||r.schema!==1||r.kind!=='synthetic-price-launch'||r.contractHash!==this.contractHash||r.bootId!==this.bootId||r.id!==s.launches+1
    ||r.id>this.contract.maxSegments||r.id*30000>21_600_000||r.worldFingerprint!==s.worldFingerprint||r.attempts!==s.attempts||r.completed!==s.completed
    ||r.previousSessionHash!==s.sessionHash||r.journalHash!==s.journalHash||s.attempts>=this.contract.maxRequests||![r.sessionHash,r.journalHash,r.evidenceHash].every(digest)||!count(r.startedAtMs)||r.startedAtMs<s.lastAtMs
    ||r.deadlineAtMs!==r.startedAtMs+30000||r.deadlineAtMs>this.contract.deadlineAtMs||r.startedAtMs+this.contract.requestTimeoutMs+this.contract.commitGraceMs>=r.deadlineAtMs
    ||!ns(r.startedMonotonicNs)||!ns(r.deadlineMonotonicNs)||BigInt(r.startedMonotonicNs)<BigInt(s.lastMonotonicNs)
    ||BigInt(r.deadlineMonotonicNs)!==BigInt(r.startedMonotonicNs)+BigInt(r.deadlineAtMs-r.startedAtMs)*1_000_000n)throw Error('launch_reservation_invalid');
   s.launches=r.id;s.reservedWallMs=r.id*30000;s.pending=structuredClone(r);s.lastAtMs=r.startedAtMs;s.lastMonotonicNs=r.startedMonotonicNs;return s;
  }
  if(!s.pending||e.id!==s.pending.id||![e.worldFingerprint,e.sessionHash,e.journalHash,e.reportHash].every(digest)||!count(e.attempts)||!count(e.completed)||e.attempts<s.attempts||e.completed<s.completed
   ||e.attempts!==e.completed||e.attempts>this.contract.maxRequests||e.attempts-s.attempts>128||!count(e.at)||e.at<s.lastAtMs||e.at>=this.contract.deadlineAtMs
   ||!ns(e.monotonicNs)||BigInt(e.monotonicNs)<BigInt(s.lastMonotonicNs))throw Error('launch_finish_invalid');
  s.finished=e.id;s.attempts=e.attempts;s.completed=e.completed;s.worldFingerprint=e.worldFingerprint;s.sessionHash=e.sessionHash;s.journalHash=e.journalHash;s.lastReportHash=e.reportHash;s.lastAtMs=e.at;s.lastMonotonicNs=e.monotonicNs;s.pending=null;return s;
 }
 private owned(){
  if(this.unusable)throw Error('launch_unusable');
  try{
  const row=this.db.prepare('SELECT sequence,hash FROM synthetic_launch_audit ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;hash:string}|undefined;
  if((this.db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous!==2||(this.db.prepare('PRAGMA journal_mode').get() as {journal_mode:string}).journal_mode!=='delete'
   ||(this.db.prepare('PRAGMA locking_mode').get() as {locking_mode:string}).locking_mode!=='exclusive'||(row?.sequence??0)!==this.sequence||row&&row.hash!==this.tip)throw Error('launch_owner_lost');
  }catch{this.unusable=true;throw Error('launch_owner_lost');}
 }
 private append(e:Event){
  this.owned();if(this.sequence>=4096)throw Error('launch_audit_limit');const next=this.reduce(e),body=JSON.stringify(e),sequence=this.sequence+1,previousHash=this.tip,digest=hash({sequence,previousHash,body});
  try{this.db.exec('BEGIN IMMEDIATE');this.db.prepare('INSERT INTO synthetic_launch_audit VALUES(?,?,?,?)').run(sequence,previousHash,body,digest);this.db.exec('COMMIT');}
  catch(error){this.unusable=true;try{this.db.exec('ROLLBACK');}catch{}throw error;}
  this.state=next;this.sequence=sequence;this.tip=digest;
 }
 check(at:number,monotonicNs:string){this.owned();if(this.state.failure)throw Error(this.state.failure);
  if(!count(at)||at<this.state.lastAtMs||at>=this.contract.deadlineAtMs||!ns(monotonicNs)||BigInt(monotonicNs)<BigInt(this.state.lastMonotonicNs)){this.fail('launch_time_invalid');throw Error('launch_time_invalid');}}
 reserve(input:Omit<SyntheticLaunchReceipt,'schema'|'kind'|'contractHash'|'id'|'bootId'>){this.check(input.startedAtMs,input.startedMonotonicNs);
  const receipt:SyntheticLaunchReceipt={schema:1,kind:'synthetic-price-launch',contractHash:this.contractHash,id:this.state.launches+1,bootId:this.bootId,...input};
  this.append({type:'reserved',receipt});return structuredClone(receipt);}
 finish(input:Omit<Extract<Event,{type:'finished'}>,'type'>){this.check(input.at,input.monotonicNs);this.append({type:'finished',...input});}
 fail(code:string){if(!this.state.failure)this.append({type:'blocked',reason:reason(code)?code:'launch_failed'});}
 status(){return {...structuredClone(this.state),auditHash:this.tip,auditRecords:this.sequence,persistenceHealthy:!this.unusable,realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,readyForProduction:false,acceptancePassed:null};}
}
