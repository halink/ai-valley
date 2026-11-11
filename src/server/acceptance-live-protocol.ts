/** Explicit live probe only, not an unconditional or resumable 15-day runner. */
import {DEEPSEEK_MODEL,SILICONFLOW_COMPLETIONS_ENDPOINT} from './model-completion.js';
export const LIVE_PROBE_PROTOCOL=Object.freeze({schema:1,protocol:'nine-siliconflow-live-probe-v1',
 provider:'siliconflow',model:DEEPSEEK_MODEL,endpoint:SILICONFLOW_COMPLETIONS_ENDPOINT,
 seed:5401,fromMinute:480,endGameMinute:540,dayMinutes:20,modelSlots:1,
 maxRequests:9,maxWallMs:180_000,requestTimeoutMs:45_000,maxResponseBytes:64_000,
 supervisor:Object.freeze({maxWallMs:195_000,termGraceMs:1500,killWaitMs:1500}),
 retries:0,fallback:null,spendingLimitCny:0,costBasis:'published-official-free-price',actualBilledCostCny:null,
 dataScope:'fictional-character-state-memories-relationships-and-actions',
 pricingUrl:'https://www.siliconflow.cn/pricing',policyUrl:'https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation',
 maxPriceAgeMs:15*60_000,acceptancePassed:null} as const);
