import type {WorldStore} from './store.js';
/** Shared by default-disconnected runtime bridges (including reviewed integration).
 * Process-local guard only; it is not account-wide or cross-process ownership. */
export const offlineProductionRuntimeOwners=new WeakSet<WorldStore>();
