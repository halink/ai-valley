import {createHash} from 'node:crypto';
import type {World} from '../shared/types.js';
import type {MvpGroundFruit} from '../shared/mvp-ground-fruit.js';
import {minuteToClimateUs,parseClimateUs} from '../world/mvp-climate.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import type {GroundDiscoveryHead,OrdinaryAgedGroundDiscoveryRead} from '../world/mvp-ordinary-aged-ground-discovery.js';
import {prepareStoppedOrdinaryAgedGroundMinute} from './godot-mvp.js';
import {prepareOrdinaryAgedGroundPickup} from './valley-spirit-ordinary-aged-pickup.js';
import type {inspectOrdinaryAgedG1Advisory} from './valley-spirit-ordinary-aged-g1-review.js';

type Advice=NonNullable<ReturnType<typeof inspectOrdinaryAgedG1Advisory>>;
type Lot=NonNullable<ReturnType<OrdinaryAgedGroundDiscoveryRead['readExactActiveLot']>>;
type Site=Readonly<{sourceId:string;target:Readonly<{x:number;y:number}>}>;
const UNIT=1_000_000n;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const blocked=(status:'unavailable'|'near_expiry'|'not_observed'|'pickup_not_verified')=>
 Object.freeze({status,executionAuthorized:false as const});
function matches(k:GroundDiscoveryHead,w:World){
 return k.worldId===w.id&&k.revision===w.revision&&k.atUs===minuteToClimateUs(w.minute);
}

/** Private pure rehearsal from already certified evidence. Two bounded native
 * minutes only. Native protocol-shaped observations and draft never leave
 * this closure; none are durable, nor can open a placement/pickup writer. */
export function rehearseOrdinaryAgedG1(current:World,site:Site,advice:Advice,reviewUntilUs:string){
 try{
  const {candidate:p,comparison}=advice,now=minuteToClimateUs(current.minute);
  const geo=inspectMvpGroundFruitGeography(current,site.sourceId,site.target);
  const original=resolveMvpRainEpisode(current,p.rainEventId);
  const aged=comparison.before.source;
  if(current.id!==p.worldId||current.clock.paused||!current.mvpClimate||!geo||!original||
   Number(now)!==p.validFromMicroMinute||parseClimateUs(now)>=parseClimateUs(reviewUntilUs)||
   geo.source.resourceInstanceId!==p.sourceResourceInstanceId||geo.targetId!==p.targetId||
   geo.source.ownerId!==aged.ownerId||comparison.after.ground!==aged)return blocked('unavailable');
  // Only the physical lot expiry limits hypothetical minutes. The real start
  // and final recapture verify review and proposal currency at the actual head.
  if(parseClimateUs(now)+2n*UNIT>=parseClimateUs(aged.expiresUs))return blocked('near_expiry');
  const copy=structuredClone(current);
  const source=copy.resources.find(r=>r.id===site.sourceId);
  if(!source||source.amount!==geo.source.ripeAvailable||source.amount<1)return blocked('unavailable');
  const sourceBefore=source.amount;
  source.amount--;
  const receiptDigest=digest(['private-g1-rehearsal/v1',p.opportunityId,current.revision,now,aged.id]);
  const fruit:MvpGroundFruit={kind:'fallen-fruit',amount:1,ownerId:'commons',effectId:'g1-rehearsal:'+receiptDigest,
   sourceResourceId:source.id,sourceResourceInstanceId:p.sourceResourceInstanceId,sourceAt:{...source.at},
   rainEventId:p.rainEventId,at:{...site.target},placedUs:now};
  // This adapter is local only. The native read checks actual cloned positions,
  // time and intrinsic lot shape, not a synthesized knowledge receipt.
  const lot=(h:Readonly<GroundDiscoveryHead>):Lot=>({
   ...h,schema:'ordinary-active-aged-ground-observation/v1',fruit,receiptDigest,bornUs:aged.bornUs,expiresUs:aged.expiresUs,
  });
  const observed=prepareStoppedOrdinaryAgedGroundMinute(copy,{readExactActiveLot:h=>matches(h,copy)?lot(h):null});
  if(!observed)return blocked('unavailable');
  if(!observed.observed.length)return blocked('not_observed');
  const pickup=prepareOrdinaryAgedGroundPickup(observed.draft,{readExactPickupEvidence:h=>
   matches(h,observed.draft)?{lot:lot(h),discoveries:observed.observed}:null});
  if(!pickup)return blocked('pickup_not_verified');
  const witness=pickup.completion;
  if(witness.receiptDigest!==receiptDigest||witness.effectId!==fruit.effectId||witness.bornUs!==aged.bornUs||
   witness.expiresUs!==aged.expiresUs||witness.baseRevision!==observed.draft.revision||
   parseClimateUs(witness.settledUs)!==parseClimateUs(now)+2n*UNIT||
   !observed.observed.some(o=>o.residentId===witness.residentId&&o.discoveryId===witness.discoveryId))return blocked('unavailable');
  // Report only the isolated native choice. The engine completion deliberately
  // does not credit inventory; actual settlement belongs to a governing writer.
  return Object.freeze({status:'validated_detached' as const,nativeDiscovery:true as const,nativePickupChoice:true as const,
   sourceDebitInCopy:sourceBefore-source.amount,groundCopyQuantity:fruit.amount,residentInventoryCredited:false as const,
   ordinaryPlacementAuthorized:false as const,executionAuthorized:false as const});
 }catch{return blocked('unavailable');}
}
