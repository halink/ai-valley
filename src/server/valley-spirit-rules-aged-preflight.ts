import type {World} from '../shared/types.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import type {openRulesGeographyQueue,RulesGeographyQueueOptions} from './valley-spirit-rules-geography-queue.js';
import type {readRulesNativeFruitLot} from './valley-spirit-rules-fruit-renewal.js';

type QueueReview=ReturnType<ReturnType<typeof openRulesGeographyQueue>['review']>;
type Lot=NonNullable<ReturnType<typeof readRulesNativeFruitLot>>;
export const unavailableAgedRulesPreflight=()=>({status:'unavailable' as const,executionAuthorized:false as const});
/** Read-only join, not an application of an effect or a statement of eligibility.
 * Neither the ordinary scalar source nor the sealed fixture grants a ground
 * writer, resident discovery or pickup in this lane. */
export function inspectRulesAgedFruitBasis(w:World,pin:RulesGeographyQueueOptions,review:QueueReview,lot:Lot){
 const unavailable=unavailableAgedRulesPreflight();
 if(review.status!=='geography_only'||review.recordedProposal.executionAuthorized!==false||w.clock.paused||
  w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||!w.mvpClimate||
  Object.hasOwn(w.mvpClimate,'spiritEffects')||Object.hasOwn(w.mvpClimate,'spiritFruitSettlement'))return unavailable;
 const now=minuteToClimateUs(w.minute),p=review.recordedProposal;
 if(w.id!==pin.worldId||p.worldId!==w.id||lot.worldId!==w.id||lot.sourceId!==pin.site.sourceId||
  p.headRevision!==w.revision||lot.revision!==w.revision||BigInt(p.atUs)!==BigInt(now)||lot.atUs!==now||
  BigInt(now)>=BigInt(p.untilUs)||BigInt(lot.lot.bornUs)>BigInt(now)||BigInt(lot.lot.expiresUs)<=BigInt(now)||lot.lot.quantity!==1)
  return unavailable;
 const geo=inspectMvpGroundFruitGeography(w,lot.sourceId,pin.site.target);
 if(!geo||geo.source.resourceInstanceId!==p.sourceResourceInstanceId||geo.targetId!==p.targetId)return unavailable;
 return Object.freeze({status:'blocked' as const,reason:'ordinary_ground_custody_not_installed' as const,
  missing:Object.freeze(['ordinary-aged-ground-placement','ordinary-aged-ground-capacity','ordinary-aged-ground-discovery','ordinary-aged-ground-pickup'] as const),
  worldId:w.id,revision:w.revision,atUs:now,proposalId:p.proposalId,opportunityId:p.opportunityId,
  permissionVersion:p.permissionVersion,sourceResourceInstanceId:p.sourceResourceInstanceId,targetId:p.targetId,
  sourceLot:Object.freeze({...lot.lot}),conservationProjection:null,sandboxEligible:false,executionAuthorized:false,
 } as const);
}
