import type {World} from '../shared/types.js';
/** Read-only status, sampled at server wall time. No configuration or raw errors. */
export function mvpObservation(world:World,requestActorIds:readonly string[],blockedUntil:readonly number[],unresolved=false,now=Date.now()){
 const error=world.metrics.lastError;
 const lastFailure=unresolved?'unresolved_request':error===null?null:error==='model_http_429'?'http_429':/^model_http_\d{3}$/.test(error)?'http_error':/^model_(timeout_or_invalid_response|stream_error)$/.test(error)?'invalid_response':'other_failure';
 const active=blockedUntil.filter(until=>Number.isFinite(until)&&until>now);
 const ids=[...new Set(requestActorIds)];
 return {observedAt:now,paused:world.clock.paused,model:{configured:world.metrics.configured,requestActorIds:ids,requestCount:ids.length,
  cooldownProviders:active.length,cooldownRemainingMs:Math.max(0,...active.map(until=>until-now)),lastFailure}};
}
