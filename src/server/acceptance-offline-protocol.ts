import {createHash} from 'node:crypto';
import {acceptanceSourceFiles} from './acceptance-run-directory.js';
import {NINE_RESIDENT_PLAN,prepareNineResidentAcceptance} from './nine-resident-acceptance.js';
import {DEEPSEEK_MODEL} from './model-completion.js';
import {FREE_CANDIDATE_PROPOSAL,FREE_CANDIDATE_PROTOCOL_HASH} from './acceptance-free-transport.js';
import {object,enumeration,integer,number,nullable,fingerprint} from './acceptance-evidence-schema.js';
export const OFFLINE_SCENARIOS=['endpoint','signal','crash','init_block','sync_block','writer_failure','cost_unknown','late_reply','guard_probe','reload_mismatch'] as const;
export type OfflineScenario=typeof OFFLINE_SCENARIOS[number];
export const checkedOfflineWorkerClose=object({schema:enumeration(1),scenario:enumeration(...OFFLINE_SCENARIOS),
 realModelExecuted:enumeration(false),acceptancePassed:enumeration(null),modelCalls:integer,lateIgnored:nullable(enumeration(true,false)),
 loadedMinute:nullable(number),loadedRevision:nullable(integer),runtimeMinute:nullable(number),runtimeRevision:nullable(integer),
 reloadVerified:enumeration(true,false),loadedWorldFingerprint:nullable(fingerprint),runtimeWorldFingerprint:nullable(fingerprint)});
/** Key-order independent JSON persistence comparison; not a signature. */
export function persistedWorldFingerprint(value:unknown){
 const sort=(input:any):any=>Array.isArray(input)?input.map(sort):input&&typeof input==='object'
  ?Object.fromEntries(Object.keys(input).sort().map(key=>[key,sort(input[key])])):input;
 return createHash('sha256').update(JSON.stringify(sort(JSON.parse(JSON.stringify(value))))).digest('hex');
}
export const OFFLINE_PROTOCOL=Object.freeze({schema:1,executionKind:'offline-wiring-rehearsal',realModelExecuted:false,
 acceptancePassed:null,readyForRealRun:false,seed:NINE_RESIDENT_PLAN.seed,fromMinute:480,endGameMinute:482.5,
 dayMinutes:20,modelSlots:16,model:DEEPSEEK_MODEL,maxRequests:24,maxWallMs:20_000,
 supervisor:Object.freeze({maxWallMs:30_000,termGraceMs:1000,killWaitMs:1500}),
 deviations:Object.freeze(['Injected deterministic wait responses, no provider or credentials',
  'Synthetic free candidate is DeepSeek only; proposed Qwen primary is unchanged and blocked for real execution',
  'Only 2.5 game minutes, not the proposed 21600-minute acceptance',
  'Manual offline ticks with simulated wall progress; external supervisor uses actual monotonic time'])} as const);
export function sourceManifest(root:string){
 const sourceFiles=acceptanceSourceFiles(root).map(({path,bytes})=>({path,sha256:createHash('sha256').update(bytes).digest('hex')}));
 return {sourceFiles,sourceFingerprint:createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex')};
}
export function offlineManifest(root:string,scenario:OfflineScenario){
 if(!OFFLINE_SCENARIOS.includes(scenario))throw new Error('offline_scenario_required');
 const source=sourceManifest(root);
 return {...prepareNineResidentAcceptance(source.sourceFingerprint),...source,type:'nine-resident-offline-wiring',
  executionKind:OFFLINE_PROTOCOL.executionKind,offlineProtocol:OFFLINE_PROTOCOL,scenario,
  freeCandidateContract:{proposal:FREE_CANDIDATE_PROPOSAL,protocolHash:FREE_CANDIDATE_PROTOCOL_HASH,
   executedByThisEntry:false,gameDataSupported:false,liveTransportAvailable:false,realPriceEvidence:null,realDataApproval:null},
  startedWallTimeMs:Date.now(),environment:{node:process.version,platform:process.platform,arch:process.arch},
  realRunGate:{authorized:false,provider:null,sharedData:null,spendingCap:null,priceEvidence:null,
   blockedReasons:['Real provider, data transmission, duration and spending authorization are required',
    'Proposed Qwen primary is outside the current free-model allowlist',
    'Real free availability and billing evidence have not been verified',
    'No live model transport or credentials are connected by this entry',
    'Exact midnight inventory/population capture and full life acceptance remain unimplemented']}};
}
