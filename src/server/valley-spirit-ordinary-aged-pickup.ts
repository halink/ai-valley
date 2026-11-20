import type {World} from '../shared/types.js';
import {mvpFallenFruitDiscoveryId} from '../shared/valley-spirit-fairness.js';
import {parseClimateUs} from '../world/mvp-climate.js';
import {type NativeAgedPickupSelection} from '../world/mvp-aged-fruit-native-pickup.js';
import {canPerceiveMvpCommonFruitPoint,mvpFallenFruitOptionalActionPermitted} from '../world/mvp-fallen-fruit-resident.js';
import {same} from '../world/navigation.js';
import {validPoint} from '../world/outdoor-observation.js';
import {readOrdinaryAgedGroundObservationHead,type GroundDiscoveryHead,type NativeOrdinaryAgedDiscovery,
 type OrdinaryAgedGroundDiscoveryRead} from '../world/mvp-ordinary-aged-ground-discovery.js';
import {prepareSealedMvpEcologyMinute} from './godot-mvp.js';

type ActiveLot=NonNullable<ReturnType<OrdinaryAgedGroundDiscoveryRead['readExactActiveLot']>>;
interface PickupEvidence {
 readonly lot:ActiveLot;readonly discoveries:readonly NativeOrdinaryAgedDiscovery[];
}
export interface OrdinaryAgedGroundPickupRead{
 /** Verify the active lot and all durable native discoveries from one
  * owning snapshot at the supplied committed head. Raw observations fail
  * the owning contract even when they have the same wire shape. */
 readonly readExactPickupEvidence:(head:Readonly<GroundDiscoveryHead>)=>Readonly<PickupEvidence>|null;
}

/** Detached one ordinary chooser/engine minute. It is not a commit port.
 * A verified owning read is still required at future settlement; neither
 * this result nor the injected reader permits inserting scalar held food. */
export function prepareOrdinaryAgedGroundPickup(current:World,owner:OrdinaryAgedGroundPickupRead,ordinaryFruitFlow?:true){
 try{
  let rows:readonly NativeOrdinaryAgedDiscovery[]|undefined;
  const evidence=readOrdinaryAgedGroundObservationHead(current,{readExactActiveLot(head){
   const verified=structuredClone(owner.readExactPickupEvidence(head));
   if(!verified||Object.keys(verified).length!==2||!Array.isArray(verified.discoveries)||verified.discoveries.length>64)return null;
   rows=verified.discoveries;
   return verified.lot;
  }});
  if(!evidence||!rows)return null;
  const {h,r,before}=evidence;
  const discoveries=new Map<string,NativeOrdinaryAgedDiscovery>();
  for(const d of rows){
   if(!d||Object.keys(d).length!==11||d.schema!=='native-ordinary-aged-ground-observation/v1'||d.worldId!==h.worldId||d.receiptDigest!==r.receiptDigest||
    d.effectId!==r.fruit.effectId||!d.observerAt||!validPoint(current,d.observerAt)||typeof d.residentId!=='string'||!d.residentId||d.residentId.length>200||discoveries.has(d.residentId)||
    d.discoveryId!==mvpFallenFruitDiscoveryId(h.worldId,d.residentId,d.effectId)||!same(d.target,r.fruit.at)||
    !Number.isSafeInteger(d.fromRevision)||d.fromRevision<0||!Number.isSafeInteger(d.observedRevision)||
    d.fromRevision>d.observedRevision||d.observedRevision>h.revision||d.fromRevision>=h.revision||
    parseClimateUs(d.atUs)<parseClimateUs(r.fruit.placedUs)||parseClimateUs(d.atUs)>before)return null;
   discoveries.set(d.residentId,d);
  }
  const intents=new Map<string,NativeAgedPickupSelection>();
  for(const actor of current.residents){
   const d=discoveries.get(actor.id);
   if(!d||actor.plan||actor.activity||!same(actor.at,r.fruit.at)||
    !mvpFallenFruitOptionalActionPermitted(current,actor)||!canPerceiveMvpCommonFruitPoint(current,actor.id,r.fruit.at))continue;
   intents.set(actor.id,{residentId:actor.id,residentRevision:actor.revision,effectId:r.fruit.effectId,discoveryId:d.discoveryId,
    point:r.fruit.at,fromUs:h.atUs,expiresUs:r.expiresUs});
  }
  if(!intents.size)return null;
  // The native chooser sees all eligible residents and decides in roster
  // order, only at the ordinary idle fallback. No requested actor/action.
  const next=prepareSealedMvpEcologyMinute(current,true,undefined,intents,undefined,undefined,ordinaryFruitFlow);
  if(!next?.completion)return null;
  const {draft,completion}=next,s=intents.get(completion.residentId);
  const opening=current.residents.find(a=>a.id===completion.residentId),closing=draft.residents.find(a=>a.id===completion.residentId);
  if(!s||!opening||!closing||!same(closing.at,r.fruit.at)||closing.inside!==null||closing.status!=='alive'||closing.residency==='outside'||closing.regionalLocation||closing.activity||closing.plan||
   JSON.stringify(opening.inventory)!==JSON.stringify(closing.inventory)||!draft.processed.includes('plan:'+completion.planId)||
   completion.startedAt!==draft.minute||completion.settledUs!==draft.mvpClimate?.lastUs||
   parseClimateUs(completion.settledUs)!==before+1_000_000n||parseClimateUs(completion.settledUs)>=parseClimateUs(r.expiresUs))return null;
  return {draft,nativeCustody:{mealWitnesses:next.mealWitnesses,speech:next.speech,renewal:next.renewal,fruitFlow:next.fruitFlow},completion:Object.freeze({
   schema:'native-ordinary-aged-ground-pickup-completion/v1' as const,worldId:h.worldId,baseRevision:h.revision,
   draftRevision:draft.revision,effectId:r.fruit.effectId,receiptDigest:r.receiptDigest,residentId:completion.residentId,
   discoveryId:s.discoveryId,planId:completion.planId,settledUs:completion.settledUs,bornUs:r.bornUs,expiresUs:r.expiresUs,
  })};
 }catch{return null;}
}
