/** Opt-in evidence transport only. No database, environment, model or runtime startup. */
import {constants,openSync,closeSync,fstatSync,mkdirSync,writeSync,readSync,fsyncSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {AcceptanceDirectoryTarget} from './acceptance-run-directory.js';
import {NINE_RESIDENT_PLAN,evidenceHash,auditDecisionWaitEvidence,auditRuntimeFoodEvidence} from './nine-resident-acceptance.js';
import type {DecisionWaitEvent} from './decision-wait-evidence.js';
import type {AcceptanceStopStatus} from './acceptance-stop-control.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {checkedWaitEvent,checkedFoodEvent,checkedStatuses,checkedAcceptanceControl,object,enumeration,identifier,fingerprint,integer,number,nullable,stopReason,
 type EvidenceStatuses,type StopReason} from './acceptance-evidence-schema.js';

const FORMAT=1,MAX_FILE_BYTES=128*1024*1024,MAX_LINE_BYTES=1024*1024;
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)?v:(()=>{throw new Error('invalid_evidence_schema');})();
const wallTime=()=>{try{const n=Date.now();return Number.isFinite(n)&&n>=0?n:null;}catch{return null;}};
const startCheck=object({schema:enumeration(FORMAT),type:enumeration('acceptance_evidence_start'),runId:uuid,
 protocol:enumeration(NINE_RESIDENT_PLAN.protocol),proposedPlanFingerprint:fingerprint,sourceFingerprint:fingerprint,
 worldId:identifier,fromMinute:number,previousRunId:nullable(uuid),startedWallTimeMs:nullable(number),
 executionKind:enumeration('evidence-capture-only'),realModelExecuted:enumeration(null),acceptancePassed:enumeration(null)});
type Start={schema:1;type:'acceptance_evidence_start';runId:string;protocol:string;proposedPlanFingerprint:string;sourceFingerprint:string;
 worldId:string;fromMinute:number;previousRunId:string|null;startedWallTimeMs:number|null;executionKind:'evidence-capture-only';realModelExecuted:null;acceptancePassed:null};
const finalCheck=object({reason:stopReason,statuses:checkedStatuses,sourceFingerprintAfter:fingerprint});
type Final={reason:StopReason;statuses:EvidenceStatuses;sourceFingerprintAfter:string};
type Kind='decision_wait'|'direct_eating'|'checkpoint'|'acceptance_control'|'close_status';
type Payload=DecisionWaitEvent|RuntimeFoodEvent|EvidenceStatuses|AcceptanceStopStatus|Final;
type Row={schema:1;runId:string;sequence:number;previousHash:string;kind:Kind;payload:Payload;hash:string};
const payloadChecks={decision_wait:checkedWaitEvent,direct_eating:checkedFoodEvent,checkpoint:checkedStatuses,acceptance_control:checkedAcceptanceControl,close_status:finalCheck};
function checkedRow(input:unknown):Row{
 const kind=Object.getOwnPropertyDescriptor(input??{},'kind')?.value;
 if(typeof kind!=='string'||!Object.hasOwn(payloadChecks,kind))throw new Error('invalid_evidence_schema');
 return object({schema:enumeration(FORMAT),runId:uuid,sequence:integer,previousHash:fingerprint,kind:enumeration(kind),
  payload:payloadChecks[kind as Kind],hash:fingerprint})(input) as Row;
}
const sealCheck=object({schema:enumeration(FORMAT),type:enumeration('acceptance_evidence_close'),runId:uuid,
 records:integer,lastHash:fingerprint,journalBytes:integer,journalSha256:fingerprint,startSha256:fingerprint,
 endedWallTimeMs:nullable(number),reason:stopReason,sourceFingerprintAfter:fingerprint});
type Seal={schema:1;type:'acceptance_evidence_close';runId:string;records:number;lastHash:string;journalBytes:number;
 journalSha256:string;startSha256:string;endedWallTimeMs:number|null;reason:StopReason;sourceFingerprintAfter:string};
export type EvidenceWriterFailure='invalid_input'|'write_failed'|'sync_failed'|'close_failed'|'readback_failed'|'aborted';
const failureCheck=object({schema:enumeration(FORMAT),type:enumeration('acceptance_evidence_failure'),runId:uuid,
 code:enumeration('invalid_input','write_failed','sync_failed','close_failed','readback_failed','aborted'),attemptedRecord:integer,durableRecords:integer});
export class EvidenceWriterError extends Error{constructor(public readonly code:string){super(code);this.name='EvidenceWriterError';}}
const failureCode=(error:unknown,fallback:EvidenceWriterFailure):EvidenceWriterFailure=>error instanceof EvidenceWriterError
 &&['invalid_input','write_failed','sync_failed','close_failed','readback_failed','aborted'].includes(error.code)?error.code as EvidenceWriterFailure:fallback;

// Use directory descriptors as anchors. Reject every symlink in the input path,
// including ancestors; /proc/self/fd is our own Linux descriptor bridge, not user input.
function pathParts(directory:string){
 if(process.platform!=='linux'||!constants.O_NOFOLLOW||!constants.O_DIRECTORY)throw new EvidenceWriterError('unsupported_secure_filesystem');
 if(typeof directory!=='string'||!isAbsolute(directory)||directory.includes('\0'))throw new EvidenceWriterError('unsafe_directory');
 const parts=directory.split('/').slice(1);
 if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||['runtime','secrets','.git'].includes(p)||p.startsWith('.env')))throw new EvidenceWriterError('unsafe_directory');
 return parts;
}
const child=(fd:number,name:string)=>`/proc/self/fd/${fd}/${name}`;
function directoryFd(directory:string|AcceptanceDirectoryTarget,create=false){
 if(directory instanceof AcceptanceDirectoryTarget){
  try{return directory.open(create);}catch{throw new EvidenceWriterError(create?'new_directory_required':'unsafe_or_missing_directory');}
 }
 const parts=pathParts(directory);let fd=-1;
 try{
  fd=openSync('/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  for(let i=0;i<parts.length;i++){
   if(create&&i===parts.length-1){mkdirSync(child(fd,parts[i]),{mode:0o700});fsyncSync(fd);}
   const next=openSync(child(fd,parts[i]),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   closeSync(fd);fd=next;
  }
  return fd;
 }catch{if(fd>=0)try{closeSync(fd);}catch{}throw new EvidenceWriterError(create?'new_directory_required':'unsafe_or_missing_directory');}
}
function newFile(fd:number,name:string){return openSync(child(fd,name),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
function readFile(fd:number,name:string,optional=false):Buffer|null{
 let file=-1;
 try{
  file=openSync(child(fd,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=fstatSync(file);if(!info.isFile()||info.nlink!==1||info.size>MAX_FILE_BYTES)throw new Error('unsafe_file');
  const data=Buffer.alloc(info.size+1);let offset=0;
  while(offset<data.length){const n=readSync(file,data,offset,data.length-offset,offset);if(n===0)break;offset+=n;}
  if(offset!==info.size)throw new Error('file_changed_or_oversized');return data.subarray(0,offset);
 }catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new EvidenceWriterError('invalid_or_unreadable_evidence');}
 finally{if(file>=0)closeSync(file);}
}
function json(bytes:Buffer|null){if(!bytes)throw new Error('missing_file');return JSON.parse(bytes.toString('utf8'));}

/** Fault injection is for offline tests, not a weaker persistence mode. Read-back
 * uses real file descriptors and catches even a write hook that silently drops bytes. */
export type EvidenceWriterIo={writeSync:typeof writeSync;fsyncSync:typeof fsyncSync;closeSync:typeof closeSync};
export type EvidenceWriterOptions={directory:string|AcceptanceDirectoryTarget;sourceFingerprint:string;worldId:string;fromMinute:number;previousRunId?:string|null;
 io?:Partial<EvidenceWriterIo>};
export class AcceptanceEvidenceWriter{
 private directory=-1;private journal=-1;private sequence=0;private durableRecords=0;private lastHash:string;
 private phase:'open'|'closed'|'failed'='open';private failure:EvidenceWriterFailure|null=null;private attemptedRecord=0;
 private start:Start;private startBytes:Buffer;private io:EvidenceWriterIo;private bytes=0;
 constructor(options:EvidenceWriterOptions){
  try{this.start=startCheck({schema:1,type:'acceptance_evidence_start',runId:randomUUID(),protocol:NINE_RESIDENT_PLAN.protocol,
   proposedPlanFingerprint:evidenceHash(NINE_RESIDENT_PLAN),sourceFingerprint:options.sourceFingerprint,worldId:options.worldId,fromMinute:options.fromMinute,
   previousRunId:options.previousRunId??null,startedWallTimeMs:wallTime(),executionKind:'evidence-capture-only',realModelExecuted:null,acceptancePassed:null}) as Start;
  }catch{throw new EvidenceWriterError('invalid_input');}
  this.startBytes=Buffer.from(JSON.stringify(this.start)+'\n');this.lastHash=hash(this.startBytes);
  this.io={writeSync,fsyncSync,closeSync,...options.io};
  this.directory=directoryFd(options.directory,true);
  try{
   this.writeNew('run-start.json',this.startBytes);
   this.journal=newFile(this.directory,'evidence.jsonl');this.sync(this.journal);this.sync(this.directory);
  }catch(error){this.fail(failureCode(error,'write_failed'));this.release();throw new EvidenceWriterError(this.failure!);}
 }
 identity(){return Object.freeze({worldId:this.start.worldId,fromMinute:this.start.fromMinute,sourceFingerprint:this.start.sourceFingerprint});}
 status(){return {runId:this.start.runId,phase:this.phase,failure:this.failure,attemptedRecord:this.attemptedRecord,
  durableRecords:this.durableRecords,lastHash:this.lastHash};}
 private requireOpen(){if(this.phase!=='open')throw new EvidenceWriterError(this.phase==='failed'?'writer_failed':'writer_closed');}
 private sync(fd:number){try{this.io.fsyncSync(fd);}catch{throw new EvidenceWriterError('sync_failed');}}
 private write(fd:number,bytes:Buffer){
  let offset=0;
  while(offset<bytes.length){let n:number;try{n=this.io.writeSync(fd,bytes,offset,bytes.length-offset,null);}catch{throw new EvidenceWriterError('write_failed');}
   if(!Number.isSafeInteger(n)||n<=0||n>bytes.length-offset)throw new EvidenceWriterError('write_failed');offset+=n;}
 }
 private closeFile(fd:number){try{this.io.closeSync(fd);}catch{throw new EvidenceWriterError('close_failed');}}
 private writeNew(name:string,bytes:Buffer){
  let fd=-1;
  try{fd=newFile(this.directory,name);this.write(fd,bytes);this.sync(fd);this.closeFile(fd);fd=-1;this.sync(this.directory);}
  finally{if(fd>=0)try{closeSync(fd);}catch{}}
 }
 private fail(code:EvidenceWriterFailure){
  if(this.phase==='failed')return;this.phase='failed';this.failure=code;
  // Best effort only. Disk failures can also prevent this marker; missing seal is
  // independently incomplete. Never serialize the original exception or stack.
  const bytes=Buffer.from(JSON.stringify({schema:1,type:'acceptance_evidence_failure',runId:this.start.runId,code,
   attemptedRecord:this.attemptedRecord,durableRecords:this.durableRecords})+'\n');
  let fd=-1;try{fd=newFile(this.directory,'failure.json');let n=0;while(n<bytes.length){const count=writeSync(fd,bytes,n,bytes.length-n,null);if(count<=0)break;n+=count;}
   fsyncSync(fd);fsyncSync(this.directory);
  }catch{}finally{if(fd>=0)try{closeSync(fd);}catch{}}
 }
 private append(kind:Kind,input:unknown){
  this.requireOpen();this.attemptedRecord=this.sequence+1;
  try{
   let payload:Payload;try{payload=payloadChecks[kind](input) as Payload;}catch{throw new EvidenceWriterError('invalid_input');}
   const body={schema:1 as const,runId:this.start.runId,sequence:this.attemptedRecord,previousHash:this.lastHash,kind,payload};
   const row={...body,hash:evidenceHash(body)},bytes=Buffer.from(JSON.stringify(row)+'\n');
   if(bytes.length>MAX_LINE_BYTES||this.bytes+bytes.length>MAX_FILE_BYTES)throw new EvidenceWriterError('write_failed');
   this.write(this.journal,bytes);this.sync(this.journal);
   this.sequence=this.attemptedRecord;this.durableRecords=this.sequence;this.lastHash=row.hash;this.bytes+=bytes.length;
  }catch(error){this.fail(failureCode(error,'write_failed'));this.release();throw new EvidenceWriterError(this.failure!);}
 }
 observeDecisionWait=(event:DecisionWaitEvent):void=>{this.append('decision_wait',event);};
 observeDirectEating=(event:RuntimeFoodEvent):void=>{this.append('direct_eating',event);};
 observeAcceptanceControl=(status:AcceptanceStopStatus):void=>{this.append('acceptance_control',status);};
 checkpoint(statuses:EvidenceStatuses):void{this.append('checkpoint',statuses);}
 close(final:Final){
  this.requireOpen();this.append('close_status',final);
  try{
   this.closeFile(this.journal);this.journal=-1;
   const bytes=readFile(this.directory,'evidence.jsonl')!;
   const parsed=parseJournal(bytes,this.start,this.lastHash);
   if(parsed.issues.length||parsed.rows.length!==this.sequence||bytes.length!==this.bytes)throw new EvidenceWriterError('readback_failed');
   const seal:Seal={schema:1,type:'acceptance_evidence_close',runId:this.start.runId,records:this.sequence,lastHash:this.lastHash,
    journalBytes:bytes.length,journalSha256:hash(bytes),startSha256:hash(this.startBytes),endedWallTimeMs:wallTime(),
    reason:final.reason,sourceFingerprintAfter:final.sourceFingerprintAfter};
   this.writeNew('run-close.json',Buffer.from(JSON.stringify(seal)+'\n'));
   const report=inspect(this.directory);
   if(report.issues.some(issue=>['invalid_or_missing_close','journal_seal_mismatch','invalid_or_missing_start','invalid_or_unreadable_evidence'].includes(issue)))throw new EvidenceWriterError('readback_failed');
   this.phase='closed';this.release();return report;
  }catch(error){this.fail(failureCode(error,'readback_failed'));this.release();throw new EvidenceWriterError(this.failure!);}
 }
 /** Abort releases descriptors, preserving an unsealed journal for read-only recovery. */
 abort(){if(this.phase==='open')this.fail('aborted');this.release();}
 private release(){for(const fd of [this.journal,this.directory])if(fd>=0)try{closeSync(fd);}catch{}this.journal=-1;this.directory=-1;}
}

function parseJournal(bytes:Buffer,start:Start,expectedLastHash?:string){
 const rows:Row[]=[],issues:string[]=[];let previousHash=hash(Buffer.from(JSON.stringify(start)+'\n'));
 const text=bytes.toString('utf8'),lines=text.split('\n');
 if(lines.pop()!=='')issues.push('truncated_journal');
 for(const line of lines){
  try{
   if(Buffer.byteLength(line)>MAX_LINE_BYTES)throw new Error('oversized_line');
   const row=checkedRow(JSON.parse(line)),{hash:claimed,...body}=row;
   if(row.runId!==start.runId||row.sequence!==rows.length+1||row.previousHash!==previousHash||claimed!==evidenceHash(body))throw new Error('broken_journal_chain');
   if(rows.at(-1)?.kind==='close_status')throw new Error('rows_after_close');
   rows.push(row);previousHash=claimed;
  }catch{issues.push('invalid_journal_record');break;}
 }
 if(expectedLastHash!==undefined&&previousHash!==expectedLastHash)issues.push('journal_hash_mismatch');
 return {rows,issues,lastHash:previousHash};
}
function inspect(directory:number){
 const issues=new Set<string>();let start:Start|null=null,seal:Seal|null=null,rows:Row[]=[],lastHash:string|null=null,startBytes:Buffer|null=null,journalBytes:Buffer|null=null;
 try{startBytes=readFile(directory,'run-start.json');start=startCheck(json(startBytes)) as Start;
  if(start.proposedPlanFingerprint!==evidenceHash(NINE_RESIDENT_PLAN))issues.add('protocol_mismatch');
 }catch{issues.add('invalid_or_missing_start');}
 try{seal=sealCheck(json(readFile(directory,'run-close.json',true))) as Seal;}catch{issues.add('invalid_or_missing_close');}
 try{const failure=readFile(directory,'failure.json',true);if(failure){failureCheck(json(failure));issues.add('writer_failure');}}
 catch{issues.add('invalid_failure_marker');}
 try{
  journalBytes=readFile(directory,'evidence.jsonl');
  if(start){const parsed=parseJournal(journalBytes!,start);rows=parsed.rows;lastHash=parsed.lastHash;for(const issue of parsed.issues)issues.add(issue);}
 }catch{issues.add('invalid_or_unreadable_evidence');}
 const finalRow=rows.at(-1),final=finalRow?.kind==='close_status'?finalRow.payload as Final:null;
 if(!final)issues.add('missing_final_status');
 if(!seal||!start||seal.runId!==start.runId||seal.records!==rows.length||seal.lastHash!==lastHash||seal.startSha256!==hash(startBytes??'')
  ||seal.journalBytes!==journalBytes?.length||seal.journalSha256!==hash(journalBytes??'')||seal.reason!==final?.reason||seal.sourceFingerprintAfter!==final?.sourceFingerprintAfter)issues.add('journal_seal_mismatch');
 if(start&&final&&start.sourceFingerprint!==final.sourceFingerprintAfter)issues.add('source_changed');
 const wait=rows.filter(r=>r.kind==='decision_wait').map(r=>r.payload as DecisionWaitEvent),food=rows.filter(r=>r.kind==='direct_eating').map(r=>r.payload as RuntimeFoodEvent);
 const waiting=auditDecisionWaitEvidence(wait,final?.statuses.decisionWaiting??null),eating=auditRuntimeFoodEvidence(food,final?.statuses.directEating??null);
 if(!waiting.complete)issues.add('incomplete_decision_waiting');if(!eating.complete)issues.add('incomplete_direct_eating');
 if(eating.totals&&![eating.totals.nutrition,eating.totals.hungerRelief,eating.totals.completedActions,...Object.values(eating.totals.units)].every(Number.isFinite))issues.add('non_finite_aggregate');
 const firstFood=food[0],lastFood=food.at(-1);
 if(!start||firstFood?.type!=='food_session_started'||firstFood.worldId!==start.worldId||firstFood.fromMinute!==start.fromMinute
  ||wait[0]?.at.gameMinute!==start.fromMinute||lastFood?.type!=='food_session_stopped'||wait.at(-1)?.at.gameMinute!==lastFood.toMinute)issues.add('channel_scope_mismatch');
 const controls=rows.filter(r=>r.kind==='acceptance_control').map(r=>r.payload as AcceptanceStopStatus);
 const lastControl=controls.at(-1)??null,stoppedControl=lastControl?.phase==='stopped'?lastControl:null;
 if(controls.length){
  if(!stoppedControl)issues.add('missing_final_control');
  if(controls.slice(0,-1).some(c=>c.phase==='stopped'))issues.add('control_after_stop');
  for(const control of controls){
   const unfinished=control.unfinishedRequests;
   if(control.fromMinute!==start?.fromMinute||control.throughMinute===null||control.throughMinute<start!.fromMinute
    ||control.targetMinute!==controls[0].targetMinute||control.maxWallMs!==controls[0].maxWallMs||control.maxRequests!==controls[0].maxRequests
    ||control.requestReservations>control.maxRequests||control.dispatchedRequests>control.requestReservations
    ||control.settledResponses+control.interruptedRequests>control.dispatchedRequests
    ||control.unknownCostRequests>control.dispatchedRequests||control.interruptedRequests>control.unknownCostRequests
    ||(control.unknownCostRequests>0)!==(control.confirmedCostUsd===null)
    ||new Set(unfinished.map(r=>r.id)).size!==unfinished.length||unfinished.some(r=>r.id>control.requestReservations)
    ||unfinished.filter(r=>r.dispatched).length!==control.interruptedRequests
    ||control.gameScopeComplete!==(control.endpoint!==null))issues.add('invalid_control_accounting');
   if(control.endpoint&&(control.endpoint.worldId!==start?.worldId||control.endpoint.gameMinute!==control.targetMinute
    ||control.endpoint.gameMinute!==control.throughMinute))issues.add('control_endpoint_mismatch');
  }
  if(stoppedControl){
   if(stoppedControl.reason!==final?.reason||stoppedControl.throughMinute!==(lastFood?.type==='food_session_stopped'?lastFood.toMinute:null)
    ||stoppedControl.dispatchedRequests!==stoppedControl.settledResponses+stoppedControl.interruptedRequests)issues.add('control_close_mismatch');
   if(stoppedControl.issues.length||['runtime_failed','evidence_failed','endpoint_observer_failed'].includes(stoppedControl.reason??''))issues.add('control_failure');
   const expected=stoppedControl.reason==='game_endpoint'&&stoppedControl.endpoint!==null&&stoppedControl.elapsedMs!==null
    &&stoppedControl.elapsedMs<stoppedControl.maxWallMs&&stoppedControl.issues.length===0&&stoppedControl.unknownCostRequests===0;
   if(stoppedControl.controlComplete!==expected)issues.add('invalid_control_completion');
  }
 }
 const complete=issues.size===0;
 return {schema:1,runId:start?.runId??null,complete,issues:[...issues],validPrefixRecords:rows.length,
  recoveredWithoutMutation:true,reason:final?.reason??stoppedControl?.reason??null,previousRunId:start?.previousRunId??null,
  fromMinute:start?.fromMinute??null,toMinute:complete?eating.toMinute:null,
  decisionWaiting:{...waiting,complete:complete&&waiting.complete,counts:complete?waiting.counts:null,monotonicDurationsValid:complete&&waiting.monotonicDurationsValid},
  directEating:{...eating,foodOwnershipChanges:{...eating.foodOwnershipChanges,complete:complete&&eating.foodOwnershipChanges.complete,totals:complete?eating.foodOwnershipChanges.totals:null},foodTransfers:{...eating.foodTransfers,complete:complete&&eating.foodTransfers.complete,totals:complete?eating.foodTransfers.totals:null},foodLosses:{...eating.foodLosses,complete:complete&&eating.foodLosses.complete,totals:complete?eating.foodLosses.totals:null},foodFlows:{...eating.foodFlows,complete:complete&&eating.foodFlows.complete,totals:complete?eating.foodFlows.totals:null},
   careMeals:{...eating.careMeals,complete:complete&&eating.careMeals.complete,totals:complete?eating.careMeals.totals:null},
   childCareMeals:{...eating.childCareMeals,complete:complete&&eating.childCareMeals.complete,totals:complete?eating.childCareMeals.totals:null},
   emergencyCareMeals:{...eating.emergencyCareMeals,complete:complete&&eating.emergencyCareMeals.complete,totals:complete?eating.emergencyCareMeals.totals:null},
   journeyMeals:{...eating.journeyMeals,complete:complete&&eating.journeyMeals.complete,totals:complete?eating.journeyMeals.totals:null},
   familyJourneyMeals:{...eating.familyJourneyMeals,complete:complete&&eating.familyJourneyMeals.complete,totals:complete?eating.familyJourneyMeals.totals:null},
   publicDutyMeals:{...eating.publicDutyMeals,complete:complete&&eating.publicDutyMeals.complete,totals:complete?eating.publicDutyMeals.totals:null},
   longCareMeals:{...eating.longCareMeals,complete:complete&&eating.longCareMeals.complete,totals:complete?eating.longCareMeals.totals:null},
   complete:complete&&eating.complete,totals:complete?eating.totals:null,observedGameMinutes:complete?eating.observedGameMinutes:null},
  foodOwnershipChanges:{...eating.foodOwnershipChanges,complete:complete&&eating.foodOwnershipChanges.complete,totals:complete?eating.foodOwnershipChanges.totals:null,
   issues:complete?eating.foodOwnershipChanges.issues:[...eating.foodOwnershipChanges.issues,'incomplete_persisted_evidence']},
  foodTransfers:{...eating.foodTransfers,complete:complete&&eating.foodTransfers.complete,totals:complete?eating.foodTransfers.totals:null,
   issues:complete?eating.foodTransfers.issues:[...eating.foodTransfers.issues,'incomplete_persisted_evidence']},
  foodLosses:{...eating.foodLosses,complete:complete&&eating.foodLosses.complete,totals:complete?eating.foodLosses.totals:null,
   issues:complete?eating.foodLosses.issues:[...eating.foodLosses.issues,'incomplete_persisted_evidence']},
  foodFlows:{...eating.foodFlows,complete:complete&&eating.foodFlows.complete,totals:complete?eating.foodFlows.totals:null,
   issues:complete?eating.foodFlows.issues:[...eating.foodFlows.issues,'incomplete_persisted_evidence']},
  careMeals:{...eating.careMeals,complete:complete&&eating.careMeals.complete,totals:complete?eating.careMeals.totals:null,
   issues:complete?eating.careMeals.issues:[...eating.careMeals.issues,'incomplete_persisted_evidence']},
  childCareMeals:{...eating.childCareMeals,complete:complete&&eating.childCareMeals.complete,totals:complete?eating.childCareMeals.totals:null,
   issues:complete?eating.childCareMeals.issues:[...eating.childCareMeals.issues,'incomplete_persisted_evidence']},
  emergencyCareMeals:{...eating.emergencyCareMeals,complete:complete&&eating.emergencyCareMeals.complete,totals:complete?eating.emergencyCareMeals.totals:null,
   issues:complete?eating.emergencyCareMeals.issues:[...eating.emergencyCareMeals.issues,'incomplete_persisted_evidence']},
  journeyMeals:{...eating.journeyMeals,complete:complete&&eating.journeyMeals.complete,totals:complete?eating.journeyMeals.totals:null,
   issues:complete?eating.journeyMeals.issues:[...eating.journeyMeals.issues,'incomplete_persisted_evidence']},
  familyJourneyMeals:{...eating.familyJourneyMeals,complete:complete&&eating.familyJourneyMeals.complete,totals:complete?eating.familyJourneyMeals.totals:null,
   issues:complete?eating.familyJourneyMeals.issues:[...eating.familyJourneyMeals.issues,'incomplete_persisted_evidence']},
  publicDutyMeals:{...eating.publicDutyMeals,complete:complete&&eating.publicDutyMeals.complete,totals:complete?eating.publicDutyMeals.totals:null,
   issues:complete?eating.publicDutyMeals.issues:[...eating.publicDutyMeals.issues,'incomplete_persisted_evidence']},
  longCareMeals:{...eating.longCareMeals,complete:complete&&eating.longCareMeals.complete,totals:complete?eating.longCareMeals.totals:null,
   issues:complete?eating.longCareMeals.issues:[...eating.longCareMeals.issues,'incomplete_persisted_evidence']},
  acceptanceControl:{lastObservedStatus:lastControl,finalStatus:stoppedControl,verified:complete&&stoppedControl!==null,
   gameScopeComplete:complete&&stoppedControl?.gameScopeComplete===true,controlComplete:complete&&stoppedControl?.controlComplete===true,
   // Crash prefixes never turn request/cost unknowns into zero. Raw observations remain inspectable.
   interruptedRequests:complete&&stoppedControl?stoppedControl.interruptedRequests:null,
   unknownCostRequests:complete&&stoppedControl?stoppedControl.unknownCostRequests:null,
   confirmedCostUsd:complete&&stoppedControl?stoppedControl.confirmedCostUsd:null,
   remoteCancellationConfirmed:false,freeModelAvailabilityVerified:false,acceptancePassed:null},
  realModelExecuted:null,acceptancePassed:null,foodProduction:null,foodConsumption:null,grossHealthDamage:null,downtimeMs:null};
}
/** Read-only salvage and verification. Never repairs/appends a prior run, opens a
 * database, reconstructs missing events, or treats a crash as a successful close. */
export function readAcceptanceEvidence(directory:string|AcceptanceDirectoryTarget){const fd=directoryFd(directory);try{return inspect(fd);}finally{closeSync(fd);}}
