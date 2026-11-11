import type {WorldStore} from './store.js';
/** Shared only by the two default-disconnected synthetic runtime bridges. */
export const offlineProductionRuntimeOwners=new WeakSet<WorldStore>();
