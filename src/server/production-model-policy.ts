import {DEEPSEEK_MODEL,SILICONFLOW_COMPLETIONS_ENDPOINT} from './model-completion.js';

/** Model identity is an eligibility restriction, never evidence of today's price. */
export const PRODUCTION_MODEL_CANDIDATE=Object.freeze({provider:'siliconflow',model:DEEPSEEK_MODEL,
 endpoint:SILICONFLOW_COMPLETIONS_ENDPOINT,modelSlots:1,retries:0,fallback:null,spendingLimitCny:0} as const);
export type ProductionModelPolicy=Readonly<{state:'no-model'|'blocked';reason:string;
 provider:typeof PRODUCTION_MODEL_CANDIDATE.provider;model:typeof DEEPSEEK_MODEL;
 liveExecutionEnabled:false;actualProviderCostCny:null}>;
const disabledPolicies=new WeakSet<ProductionModelPolicy>();

/** Deliberately reads only non-secret settings. A key, environment assertion of
 * zero pricing, or old probe approval cannot open a new production budget.
 * There is no live enable switch until remote uncertainty and price/permission
 * prerequisites have a separately reviewed implementation. */
export function readProductionModelPolicy(env:Readonly<Record<string,string|undefined>>):ProductionModelPolicy{
 const mode=env.VALLEY_MODEL_MODE;
 let state:ProductionModelPolicy['state']='no-model',reason='model_execution_disabled';
 if(mode!==undefined&&mode!==''&&mode!=='disabled'){
  state='blocked';
  reason=mode!=='siliconflow-free-only'?'unsupported_model_mode'
   :env.VALLEY_MODEL_PROVIDER!=='siliconflow'?'single_siliconflow_provider_required'
   :env.VALLEY_MODEL_ID!==DEEPSEEK_MODEL?'exact_candidate_model_required'
   :'production_live_authorization_and_free_status_unverified';
 }
 const policy=Object.freeze({state,reason,provider:'siliconflow',model:DEEPSEEK_MODEL,liveExecutionEnabled:false,actualProviderCostCny:null} as const);
 disabledPolicies.add(policy);return policy;
}

/** An immutable in-process configuration result, not evidence of permission or
 * price. Serialized/spread objects cannot supply a replacement startup policy.
 * This is an accidental-wiring boundary for trusted code, not an OS sandbox. */
export function requireDisabledProductionModelPolicy(policy?:ProductionModelPolicy):ProductionModelPolicy{
 if(policy===undefined)return readProductionModelPolicy({});
 if(!disabledPolicies.has(policy))throw new Error('formal_model_policy_untrusted');
 return policy;
}
