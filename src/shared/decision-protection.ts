/** A crisis is retained after the hold ends, so retries/restarts cannot renew it. */
export interface DecisionProtection {
 startedAt:number;
 expiresAt:number;
 endedAt:number|null;
 reason:'decision'|'expired'|'unavailable'|'incapable'|'recovered'|null;
 recoveredAt:number|null;
 localDecisionsAtStart:number;
 regionalDecisionsAtStart?:number;
 before:{health:number;hunger:number;energy:number};
 prevented:{hunger:number;exhaustion:number};
 losses:{hunger:number;exhaustion:number;illnessOrInjury:number;hazard:number};
}
