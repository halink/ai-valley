/** Non-authoritative, bounded diagnostics for fixed OFFLINE synthetic fixtures.
 * Never serialize an error, prompt, path, world, hash, or arbitrary IPC object. */
import {SYNTHETIC_NINE_IDS,SYNTHETIC_REHEARSAL_CHECKS} from './production-model-process-rehearsal.js';
const stages=['worker_initialize','worker_observe','worker_close','worker_rehearsal','worker_report_write','guardian_prepare','guardian_supervise','guardian_reconcile','guardian_report_write'] as const;
const reasons=['unknown','runtime_not_clean','synthetic_continuity_evidence_invalid','synthetic_process_not_clean','synthetic_worker_identity_unknown','synthetic_worker_group_present','synthetic_process_seal_mismatch','synthetic_launch_blocked','synthetic_process_report_mismatch','synthetic_process_audit_rollback','synthetic_process_unresolved','synthetic_process_identity_mismatch','synthetic_launch_expired','synthetic_launch_state_mismatch','synthetic_observation_unmatched','synthetic_request_observation_unmatched','synthetic_choice_missing'] as const;
const triggers=['child_exit','wall_limit','parent_signal','parent_disconnect','launch_failed','transport_error','clock_invalid','timer_failed'] as const;
const issues=['launch_failed','transport_error','clock_invalid','timer_failed','signal_failed','probe_failed','dispose_failed','exit_unobserved','group_unconfirmed'] as const;
const signals=['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBUS','SIGHUP','SIGPIPE'] as const;
// Data properties only: even a getter supplied in an untrusted message is not run.
const field=(value:unknown,key:string):unknown=>{try{return value!==null&&(typeof value==='object'||typeof value==='function')?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;}catch{return undefined;}};
const select=<T extends string>(value:unknown,allowed:readonly T[]):T|null=>typeof value==='string'&&allowed.includes(value as T)?value as T:null;
const number=(value:unknown,max=1_000_000_000,min=0):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
const count=(value:unknown,max=20000):number|null=>Number.isSafeInteger(value)?number(value,max):null;
const bool=(value:unknown):boolean|null=>typeof value==='boolean'?value:null;
const array=(value:unknown):unknown[]=>{
 const result:unknown[]=[];if(!Array.isArray(value))return result;
 const length=count(field(value,'length'),Number.MAX_SAFE_INTEGER)??0;
 for(let i=0;i<Math.min(length,129);i++)result.push(field(value,String(i)));return result;
};
const difference=(a:unknown,b:unknown)=>{const x=number(a,Number.MAX_SAFE_INTEGER),y=number(b,Number.MAX_SAFE_INTEGER);return x===null||y===null?null:number(x-y,1_000_000_000,-1_000_000_000);};
const monoDifference=(a:unknown,b:unknown)=>{
 if(typeof a!=='string'||typeof b!=='string'||!/^\d{1,24}$/.test(a)||!/^\d{1,24}$/.test(b))return null;
 return number(Number(BigInt(a)-BigInt(b))/1e6,1_000_000_000,-1_000_000_000);
};
/** Re-sanitize at each IPC/artifact boundary. No extra input fields survive. */
export function sanitizeSyntheticDiagnostic(value:unknown){
 const f=(key:string)=>field(value,key);
 return {schema:1,kind:'synthetic-process-failure-diagnostic',stage:select(f('stage'),stages),reason:select(f('reason'),reasons)??'unknown',
  check:select(f('check'),SYNTHETIC_REHEARSAL_CHECKS),launchId:count(f('launchId'),720),sealed:bool(f('sealed')),runtimeFailed:bool(f('runtimeFailed')),
  sessionAttempts:count(f('sessionAttempts')),sessionCompleted:count(f('sessionCompleted')),sessionPending:bool(f('sessionPending')),
  modelAttempts:count(f('modelAttempts')),modelCompleted:count(f('modelCompleted')),modelPending:bool(f('modelPending')),
  requests:count(f('requests'),128),ticks:count(f('ticks'),128),actorMask:count(f('actorMask'),511),gameMinutes:number(f('gameMinutes'),1000),
  observedFromCutoffMs:number(f('observedFromCutoffMs'),1e9,-1e9),observedMonoFromCutoffMs:number(f('observedMonoFromCutoffMs'),1e9,-1e9),
  finishedFromCutoffMs:number(f('finishedFromCutoffMs'),1e9,-1e9),finishedMonoFromCutoffMs:number(f('finishedMonoFromCutoffMs'),1e9,-1e9),
  watchdogExitCode:count(f('watchdogExitCode'),255),watchdogSignal:select(f('watchdogSignal'),signals),workerExitCode:count(f('workerExitCode'),255),workerSignal:select(f('workerSignal'),signals),
  trigger:select(f('trigger'),triggers),cleanupComplete:bool(f('cleanupComplete')),groupState:select(f('groupState'),['absent','present','unknown'] as const),
  issues:[...new Set(array(f('issues')).map(v=>select(v,issues)).filter((v):v is typeof issues[number]=>v!==null))],
  watchdogError:bool(f('watchdogError')),outerTimedOut:bool(f('outerTimedOut')),
  realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,readyForProduction:false,acceptancePassed:null};
}
export function syntheticFailureDiagnostic(input:{stage:string;error?:unknown;reason?:string;receipt?:unknown;status?:unknown;report?:unknown;observation?:unknown;watchdogExit?:unknown;watchdogError?:boolean;outerTimedOut?:boolean}){
 const {receipt,status,report}=input,session=field(status,'session'),model=field(status,'journal'),requests=array(field(report,'requests'));
 const last=requests.at(-1),deadline=field(receipt,'deadlineAtMs'),mono=field(receipt,'deadlineMonotonicNs');
 let mask=0;for(const r of requests){const i=SYNTHETIC_NINE_IDS.indexOf(field(r,'actorId') as string);if(i>=0)mask|=1<<i;}
 const process=field(input.observation,'process'),exit=field(process,'exit');
 const offset=(value:unknown)=>{const d=difference(value,deadline);return d===null?null:d+6000;};
 const monoOffset=(value:unknown)=>{const d=monoDifference(value,mono);return d===null?null:d+6000;};
 return sanitizeSyntheticDiagnostic({stage:input.stage,reason:input.reason??field(input.error,'message'),check:field(input.error,'syntheticCheck'),launchId:field(receipt,'id'),
  sealed:field(status,'sealed'),runtimeFailed:status?field(status,'failure')!==null:undefined,
  sessionAttempts:field(session,'attempts'),sessionCompleted:field(session,'completed'),sessionPending:session?field(session,'pending')!==null:undefined,
  modelAttempts:field(model,'attempts'),modelCompleted:field(model,'completed'),modelPending:model?field(model,'pending')!==null:undefined,
  requests:report?requests.length:undefined,ticks:Array.isArray(field(report,'ticks'))?field(field(report,'ticks'),'length'):undefined,actorMask:report?mask:undefined,
  gameMinutes:difference(field(field(report,'after'),'minute'),field(field(report,'before'),'minute')),
  observedFromCutoffMs:offset(field(last,'observedAtMs')),observedMonoFromCutoffMs:monoOffset(field(last,'observedMonotonicNs')),
  finishedFromCutoffMs:offset(field(report,'finishedAtMs')),finishedMonoFromCutoffMs:monoOffset(field(report,'finishedMonotonicNs')),
  watchdogExitCode:field(input.watchdogExit,'code'),watchdogSignal:field(input.watchdogExit,'signal'),workerExitCode:field(exit,'code'),workerSignal:field(exit,'signal'),
  trigger:field(process,'trigger'),cleanupComplete:field(process,'cleanupComplete'),groupState:field(process,'groupState'),issues:field(process,'issues'),
  watchdogError:input.watchdogError,outerTimedOut:input.outerTimedOut});
}
