import {mvpFallenFruitDiscoveryId} from '../shared/valley-spirit-fairness.js';
import type {MvpGroundFruit} from '../shared/mvp-ground-fruit.js';
import type {Resident,Vec,World} from '../shared/types.js';
import {minuteToClimateUs} from './mvp-climate.js';
import {mvpThirst} from './mvp-drinking.js';
import {canAccessMvpGroundFruitTile} from './mvp-ground-fruit.js';
import {validateMvpSpiritEffects} from './mvp-spirit-effects.js';
import {passenger} from './medical-transport.js';
import {distance,findPath,same} from './navigation.js';
import {canObserveOutdoors,canSeeOutdoorPoint} from './outdoor-observation.js';
import {inLand,reservedLandRights} from '../shared/land-rights.js';

// Reuse the existing bounded local resource observation range. Neither seeing
// a lot nor this small diagnostic result affects plans, memories, or stock.
const SIGHT_AND_ROUTE_STEPS=12;
const MAX_SIGHTINGS=4;
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const stable=(a:string,b:string)=>a<b?-1:a>b?1:0;

export interface MvpFallenFruitSighting {
 readonly schemaVersion:1;
 /** Stable first-discovery key for a future private per-resident observation ledger;
  * the view itself isn't a durable discovery event. */
 readonly discoveryId:string;
 readonly residentId:string;
 readonly effectId:string; // internal lot identity; no proposal, rain or private world fields
 readonly worldId:string;
 readonly observedAtUs:string;
 readonly observedAtRevision:number;
 readonly at:Readonly<Vec>;
 readonly item:'fruit';
 readonly quantity:1;
 readonly custody:'commons';
}
export interface MvpFallenFruitPickupIntent {
 readonly schemaVersion:1;
 /** Handler still must atomically prove the same lot is present and record the actual pickup. */
 readonly type:'mvp-fallen-fruit-pickup-intent';
 readonly worldId:string;
 readonly residentId:string;
 readonly residentRevision:number;
 readonly discoveryId:string;
 readonly effectId:string;
 readonly at:Readonly<Vec>;
 readonly observedAtUs:string;
 readonly placedUs:string;
 readonly expectedCustody:'commons';
 readonly item:'fruit';
 readonly quantity:1;
}
export type MvpFallenFruitDecisionSlot = 'idle-fallback'|'ordinary-action';

function context(w:World,residentId:string):{resident:Resident;items:readonly MvpGroundFruit[]}|undefined {
 if(Object.hasOwn(w,'simulationOnly')||w.mode!=='validation'||!natural(w.revision)||!w.mvpClimate?.spiritEffects||
  w.mvpClimate.lastUs!==minuteToClimateUs(w.minute))return;
 const matches=w.residents.filter(r=>r.id===residentId);
 if(matches.length!==1)return;
 const resident=matches[0];
 if(!natural(resident.revision)||resident.regionalLocation||!canObserveOutdoors(w,resident)||passenger(w,resident.id)||!(resident.health>0))return;
 validateMvpSpiritEffects(w);
 return {resident,items:w.mvpClimate.spiritEffects.ground.items};
}

function observes(w:World,r:Resident,lot:MvpGroundFruit):boolean {
 if(!canSeeOutdoorPoint(w,r,lot.at,SIGHT_AND_ROUTE_STEPS)||!canAccessMvpGroundFruitTile(w,lot.at))return false;
 const restricted=reservedLandRights(w);
 return findPath(w,r.at,lot.at,false,SIGHT_AND_ROUTE_STEPS,(_from,to)=>
  !restricted.some(right=>inLand({...right.at,width:right.width,height:right.height},to)))!==null;
}

function sighting(w:World,r:Resident,lot:MvpGroundFruit):MvpFallenFruitSighting {
 return Object.freeze({
  schemaVersion:1,discoveryId:mvpFallenFruitDiscoveryId(w.id,r.id,lot.effectId),residentId:r.id,effectId:lot.effectId,
  worldId:w.id,observedAtUs:minuteToClimateUs(w.minute),observedAtRevision:w.revision,
  at:Object.freeze({...lot.at}),item:'fruit',quantity:1,custody:lot.ownerId,
 });
}

/** Private view for exactly one resident from the committed fixture head.
 * No rain/ownership archive lookup gives a resident knowledge, and neither
 * another resident's view nor a future lot is discoverable here. */
export function observeMvpFallenFruit(w:World,residentId:string):readonly MvpFallenFruitSighting[] {
 try{
  const head=context(w,residentId);
  if(!head)return [];
  const {resident,items}=head;
  const nearby=items.filter(lot=>distance(resident.at,lot.at)<=SIGHT_AND_ROUTE_STEPS)
   .sort((a,b)=>distance(resident.at,a.at)-distance(resident.at,b.at)||a.at.y-b.at.y||a.at.x-b.at.x||stable(a.effectId,b.effectId));
  const observed:MvpFallenFruitSighting[]=[];
  for(const lot of nearby)if(observes(w,resident,lot)){
   observed.push(sighting(w,resident,lot));
   if(observed.length>=MAX_SIGHTINGS)break;
  }
  return Object.freeze(observed);
 }catch{return [];}
}

function needsPermit(w:World,r:Resident):boolean {
 const thirst=mvpThirst(w,r);
 // Existing MVP priorities: don't displace hunger, water, rest, current plans
 // or temporary physiological protection. Take only on the current tile, so
 // no fruit-induced detour, schedule, reservoir or auto-eating exists.
 return w.clock.paused===false&&r.plan===null&&r.activity===null&&!r.decisionProtection&&
   !w.health?.transports.some(t=>t.carrierId===r.id&&t.phase==='carrying')&&
   Number.isFinite(r.hunger)&&r.hunger>=0&&r.hunger<35&&
   Number.isFinite(r.energy)&&r.energy>=70&&r.energy<=100&&
   thirst!==undefined&&Number.isFinite(thirst)&&thirst>=0&&thirst<50-1e-9;
}

/** Replaces only a trusted ordinary chooser's final idle fallback, never an
 * arbitrary wait from barter/shelter/rest/commitments. A visible distant lot
 * yields no movement intent. Future rules must use a typed settlement path. */
export function chooseMvpFallenFruitPickup(
 w:World,residentId:string,slot:MvpFallenFruitDecisionSlot,
):MvpFallenFruitPickupIntent|null {
 if(slot!=='idle-fallback')return null;
 try{
  const head=context(w,residentId);
  if(!head||!needsPermit(w,head.resident))return null;
  const {resident,items}=head;
  const lot=items.filter(candidate=>same(candidate.at,resident.at)).sort((a,b)=>stable(a.effectId,b.effectId))
   .find(candidate=>observes(w,resident,candidate));
  if(!lot)return null;
  const proof=sighting(w,resident,lot);
  return Object.freeze({
   schemaVersion:1,type:'mvp-fallen-fruit-pickup-intent',worldId:w.id,residentId,residentRevision:resident.revision,
   discoveryId:proof.discoveryId,effectId:proof.effectId,at:proof.at,observedAtUs:proof.observedAtUs,placedUs:lot.placedUs,
   expectedCustody:proof.custody,item:'fruit',quantity:1,
  });
 }catch{return null;}
}
