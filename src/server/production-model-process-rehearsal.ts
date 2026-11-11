/** Observations for the fixed synthetic nine-person process rehearsal only.
 * These are not model answers, price authority, billing receipts or a sandbox. */
import type {World} from '../shared/types.js';
import {persistedWorldFingerprint as fingerprint} from './acceptance-offline-protocol.js';
import {syntheticRecordHash as hash} from './production-model-price-evidence.js';
import type {SyntheticLaunchReceipt} from './production-model-process-ledger.js';
import {foundingHouseholds} from '../world/founders.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
export const SYNTHETIC_NINE_IDS=Object.freeze(Array.from({length:3},(_,h)=>Array.from({length:3},(_,m)=>`founder-${h+1}-${m+1}`)).flat());
const roster=new Map<string,string>(foundingHouseholds.slice(0,3).flatMap((h,i)=>h.people.map((p,m)=>[`founder-${i+1}-${m+1}`,p[0]] as const)));
export function rehearsalSnapshot(world:World){
 return {worldId:world.id,minute:world.minute,revision:world.revision,worldFingerprint:fingerprint(world),
  requests:world.metrics.requests,successes:world.metrics.successes,failures:world.metrics.failures,localDecisions:world.metrics.localDecisions??0,
  inFlight:[...world.metrics.inFlight],dayMinutes:world.clock.realMinutesPerDay,
  residents:world.residents.map(p=>({id:p.id,name:p.name,lastDecisionAt:p.lastDecisionAt,status:p.status,
   recentActions:(p.recentActions??[]).map(a=>({...a}))}))};
}
export type RehearsalSnapshot=ReturnType<typeof rehearsalSnapshot>;
export type RehearsalRequest={id:number;actorId:string;requestBody:string;reply:{content:string;finish:'stop';usage:{prompt_tokens:1;completion_tokens:1}};requestHash:string;responseHash:string;observedAtMs:number;
 observedMonotonicNs:string;acknowledgedAtMs:number|null;acknowledgedMonotonicNs:string|null;worldFingerprint:string|null;revision:number|null;minute:number|null};
export type RehearsalTick={atMs:number;monotonicNs:string;minute:number;revision:number};
export type SyntheticRehearsalReport={schema:1;kind:'synthetic-nine-continuity-segment';id:number;receiptHash:string;runId:string;
 sourceFingerprint:string;originalDeadlineAtMs:number;evidenceHash:string;before:RehearsalSnapshot;ready:RehearsalSnapshot;after:RehearsalSnapshot;
 startedAtMs:number;finishedAtMs:number;startedMonotonicNs:string;finishedMonotonicNs:string;
 ticks:RehearsalTick[];requests:RehearsalRequest[];stopReason:string|null;
 realModelExecuted:false;liveExecutionEnabled:false;actualProviderCostCny:null;readyForProduction:false;acceptancePassed:null};
export const SYNTHETIC_REHEARSAL_CHECKS=Object.freeze(['identity','roster','world_progress','lifecycle_time','observation_count','tick','counters','report_size','request_hash','request_identity','request_timing','actor_coverage'] as const);
export type SyntheticRehearsalCheck=typeof SYNTHETIC_REHEARSAL_CHECKS[number];
const valid=(condition:unknown,check:SyntheticRehearsalCheck):void=>{if(!condition){
 const error=new Error('synthetic_continuity_evidence_invalid');Object.defineProperty(error,'syntheticCheck',{value:check});throw error;
}};
/** Fixed bounded protocol check. Guardian separately verifies real OS exit and
 * independently reopens durable state. This report alone never authorizes resume. */
export function checkSyntheticRehearsal(report:SyntheticRehearsalReport,receipt:SyntheticLaunchReceipt,
 context:{runId:string;sourceFingerprint:string;originalDeadlineAtMs:number;attempts:number;completed:number;after:RehearsalSnapshot}){
 valid(report.schema===1&&report.kind==='synthetic-nine-continuity-segment'&&report.id===receipt.id&&report.receiptHash===hash(receipt)
  &&report.runId===context.runId&&report.sourceFingerprint===context.sourceFingerprint&&report.originalDeadlineAtMs===context.originalDeadlineAtMs
  &&report.evidenceHash===receipt.evidenceHash&&report.realModelExecuted===false&&report.liveExecutionEnabled===false
  &&report.actualProviderCostCny===null&&report.readyForProduction===false&&report.acceptancePassed===null,'identity');
 const {before,ready,after}=report;
 for(const w of [before,ready,after])valid(w.worldId===after.worldId&&w.residents.length===9
  &&JSON.stringify(w.residents.map(p=>p.id).sort())===JSON.stringify([...SYNTHETIC_NINE_IDS].sort())&&w.residents.every(p=>p.status==='alive'&&p.name===roster.get(p.id)),'roster');
 valid(before.worldFingerprint===receipt.worldFingerprint&&hash(after)===hash(context.after)
  &&ready.minute===before.minute&&ready.revision>before.revision&&after.revision>ready.revision&&after.minute-before.minute>=10
  &&ready.dayMinutes===20&&after.dayMinutes===20&&after.inFlight.length===0&&report.stopReason==='manual_stop','world_progress');
 valid(report.startedAtMs>=receipt.startedAtMs&&report.finishedAtMs>=receipt.deadlineAtMs-6000&&report.finishedAtMs>=report.startedAtMs&&report.finishedAtMs<receipt.deadlineAtMs
  &&BigInt(report.startedMonotonicNs)>=BigInt(receipt.startedMonotonicNs)&&BigInt(report.finishedMonotonicNs)>=BigInt(report.startedMonotonicNs)
  &&BigInt(report.finishedMonotonicNs)>=BigInt(receipt.deadlineMonotonicNs)-6000000000n
  &&BigInt(report.finishedMonotonicNs)<BigInt(receipt.deadlineMonotonicNs),'lifecycle_time');
 valid(report.ticks.length>=5&&report.ticks.length<=128&&report.requests.length>=9&&report.requests.length<=128,'observation_count');
 let minute=before.minute,revision=ready.revision,mono=BigInt(report.startedMonotonicNs),wall=report.startedAtMs;
 for(const t of report.ticks){valid(t.minute>minute&&t.minute-minute<=2.400001&&t.revision>revision&&BigInt(t.monotonicNs)>mono
   &&BigInt(t.monotonicNs)<=BigInt(report.finishedMonotonicNs)&&t.atMs>wall&&t.atMs<=report.finishedAtMs,'tick');
  minute=t.minute;revision=t.revision;mono=BigInt(t.monotonicNs);wall=t.atMs;}
 valid(minute===after.minute&&report.requests.length===context.attempts-receipt.attempts&&context.attempts===context.completed
  &&after.successes-before.successes===report.requests.length&&after.localDecisions-before.localDecisions===report.requests.length
  &&after.failures===before.failures&&after.requests-before.requests>=report.requests.length,'counters');
 const actors=new Set<string>();let previousAck=BigInt(report.startedMonotonicNs);
 valid(Buffer.byteLength(JSON.stringify(report))<=900_000,'report_size');
 for(const [i,r] of report.requests.entries()){
  valid(typeof r.requestBody==='string'&&Buffer.byteLength(r.requestBody)<=41024&&hash(r.requestBody)===r.requestHash&&hash(r.reply)===r.responseHash,'request_hash');
  const body=JSON.parse(r.requestBody),answer=JSON.parse(r.reply.content),choice=body.messages?.map((m:{content:string})=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];
  valid(body.model===P.model&&body.messages?.length===1&&body.messages[0].role==='user'
   &&body.messages[0].content.startsWith(`只输出一个 JSON 对象，直接选择实际列出的编号；没有要求的字段不填写。\n你是居民${roster.get(r.actorId)}，`)
   &&choice&&answer.choice===choice&&answer.minutes===15&&r.reply.finish==='stop'&&r.reply.usage.prompt_tokens===1&&r.reply.usage.completion_tokens===1,'request_identity');
  valid(r.id===receipt.attempts+i+1&&SYNTHETIC_NINE_IDS.includes(r.actorId)&&/^[0-9a-f]{64}$/.test(r.requestHash)&&/^[0-9a-f]{64}$/.test(r.responseHash)
   &&r.acknowledgedAtMs!==null&&r.acknowledgedMonotonicNs!==null&&r.worldFingerprint!==null&&/^[0-9a-f]{64}$/.test(r.worldFingerprint)
   &&r.revision!==null&&r.minute!==null&&r.minute>=before.minute&&r.minute<=after.minute&&r.observedAtMs>=report.startedAtMs
   &&r.observedAtMs<receipt.deadlineAtMs-6000&&r.acknowledgedAtMs!>=r.observedAtMs&&r.acknowledgedAtMs!<=report.finishedAtMs
   &&BigInt(r.observedMonotonicNs)>=previousAck&&BigInt(r.observedMonotonicNs)<BigInt(receipt.deadlineMonotonicNs)-6000000000n
   &&BigInt(r.acknowledgedMonotonicNs!)>=BigInt(r.observedMonotonicNs)&&BigInt(r.acknowledgedMonotonicNs!)<=BigInt(report.finishedMonotonicNs),'request_timing');
  previousAck=BigInt(r.acknowledgedMonotonicNs!);actors.add(r.actorId);
 }
 valid(actors.size===9&&after.residents.every(p=>p.lastDecisionAt>=before.minute),'actor_coverage');
 return {requests:report.requests.length,actors:[...actors].sort(),ticks:report.ticks.length,fromMinute:before.minute,toMinute:after.minute};
}
