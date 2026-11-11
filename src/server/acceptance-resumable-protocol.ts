/** Candidate long-run contract. The executable below is OFFLINE ONLY. Publishing
 * a protocol is not authorization, price verification, billing, or acceptance. */
import {DEEPSEEK_MODEL,SILICONFLOW_COMPLETIONS_ENDPOINT} from './model-completion.js';
import {persistedWorldFingerprint} from './acceptance-offline-protocol.js';
export const RESUMABLE_PROTOCOL=Object.freeze({schema:1,protocol:'nine-resumable-offline-v1',
 executionKind:'offline-resumable-rehearsal',seed:5401,fromMinute:480,endGameMinute:480+15*1440,
 model:DEEPSEEK_MODEL,endpoint:SILICONFLOW_COMPLETIONS_ENDPOINT,modelSlots:1,retries:0,fallback:null,
 spendingLimitCny:0,actualProviderCostCny:null,maxRequests:20_000,maxReservedWallMs:6*60*60_000,
 segmentWallMs:30_000,segmentGameMinutes:60,segmentRequests:128,maxSegments:720,
 supervisor:Object.freeze({maxWallMs:30_000,termGraceMs:1500,killWaitMs:1500}),
 liveExecutionEnabled:false,realModelExecuted:false,acceptancePassed:null} as const);
export const RESUMABLE_PROTOCOL_HASH=persistedWorldFingerprint(RESUMABLE_PROTOCOL);
export const RESUMABLE_LIVE_BLOCKERS=Object.freeze([
 'Previous real request has no confirmed response; provider execution and billing remain unknown.',
 'Do not retry that request. User billing reconciliation and explicit new-run authorization remain pending.',
 'No live transport, credential reader, environment loader, browser, proxy or network route is connected here.',
 'Fresh official exact-model zero pricing and per-segment authorization are required before any future live implementation.',
 'Offline game time, request accounting and restart tests are not a real fifteen-day acceptance.'
]);
