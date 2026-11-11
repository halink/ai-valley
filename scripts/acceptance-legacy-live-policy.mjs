// Retired live entrypoints cannot authenticate prior request/billing evidence.
// This is deliberately not a configurable flag or an alternate live admission.
export const LEGACY_LIVE_PROBE_DISABLED='legacy_live_probe_disabled_pending_reconciliation';
export function rejectLegacyLiveProbe(){throw new Error(LEGACY_LIVE_PROBE_DISABLED);}
export function assertLegacySyntheticScenario(scenario){
 if(scenario==='live')rejectLegacyLiveProbe();
 if(!['synthetic','stall_headers','init_block','sync_block','http_failure'].includes(scenario))throw new Error('live_bootstrap_required');
}
