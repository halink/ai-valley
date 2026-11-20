import type {WorldStore} from './store.js';
/** Shared by default-disconnected runtime bridges (including reviewed integration).
 * Process-local guard only; it is not account-wide or cross-process ownership. */
export const offlineProductionRuntimeOwners=new WeakSet<WorldStore>();

import type {ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
const formal=new WeakSet<ProductionAccountQuotaRehearsal>();
const seasonal=new WeakSet<ProductionAccountQuotaRehearsal>();
export function canonicalSeasonalQuotaClaimed(quota:ProductionAccountQuotaRehearsal){return seasonal.has(quota);}
export function formalResidentQuotaClaimed(quota:ProductionAccountQuotaRehearsal){return formal.has(quota);}
export function rememberFormalResidentQuota(quota:ProductionAccountQuotaRehearsal){formal.add(quota);}
/** Neither offline resident runtime may replace the other's demand sentinel.
 * This reserves only local use of an already leased canonical account. */
export function claimSeasonalResidentQuota(quota:ProductionAccountQuotaRehearsal):()=>void{
 if(formal.has(quota)||seasonal.has(quota))throw Error('seasonal_model_canonical_quota_already_claimed');
 seasonal.add(quota);
 return ()=>{seasonal.delete(quota);};
}
