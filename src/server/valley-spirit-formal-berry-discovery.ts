import {createHash} from 'node:crypto';
import type {Vec,World} from '../shared/types.js';
import {formalBerryCommonGround} from '../world/formal-berry-location.js';
import {canSeeOutdoorPoint} from '../world/outdoor-observation.js';
import {passenger} from '../world/medical-transport.js';
import {findPath,distance} from '../world/navigation.js';
import {activeCases} from '../world/health.js';
import {validateFormalGroundBerryFoodBirth,type FormalBerryFixtureEffect} from './valley-spirit-formal-berry-authority.js';

const SIGHT=12,MAX=4;
interface Seen {
 readonly kind:'observed-ground-berry';
 readonly observationId:string;
 readonly at:Readonly<Vec>;
 readonly item:'berry';
 readonly quantity:1;
 readonly executionAuthorized:false;
}

/** Pure private projection from store-owned, already-validated receipt rows.
 * It is not an action option, a durable discovery or a view for another actor. */
export function projectDeveloperFormalBerryDiscovery(
 w:World,rows:readonly FormalBerryFixtureEffect[],residentId:string,
):readonly Seen[]{
 try{
  if(w.mode!=='formal'||w.clock.paused||Object.hasOwn(w,'simulationOnly')||!w.formalBerryFixtureAnchor)return [];
  const people=w.residents.filter(r=>r.id===residentId);
  const r=people.length===1?people[0]:undefined;
  if(!r||r.regionalLocation||passenger(w,r.id)||!(r.energy>0)||!(r.health>0)||
   activeCases(w,r.id).some(c=>{
    const critical=c.rules?.criticalSeverity??(w.definitions[c.definition??'health/rules@1']?.data.criticalSeverity);
    return c.stage==='critical'||!Number.isFinite(c.severity)||typeof critical!=='number'||!Number.isFinite(critical)||c.severity>=critical;
   }))return [];
  const location=formalBerryCommonGround(w);if(location.unsafe(r.at))return [];
  const view:Seen[]=[];
  const nearby=rows.filter(effect=>effect.foodBirth&&validateFormalGroundBerryFoodBirth(w,effect)&&
   w.minute>=effect.foodBirth.producedAt&&w.minute<effect.foodBirth.expiresAt&&distance(r.at,effect.receipt.target)<=SIGHT)
   .sort((a,b)=>distance(r.at,a.receipt.target)-distance(r.at,b.receipt.target)||a.receipt.target.y-b.receipt.target.y||
    a.receipt.target.x-b.receipt.target.x||a.receipt.draftId.localeCompare(b.receipt.draftId));
  const checked=new Map<string,boolean>();
  for(const {receipt} of nearby){
   const at=receipt.target,key=`${at.x}:${at.y}`;
   let visible=checked.get(key);
   if(visible===undefined){
    visible=canSeeOutdoorPoint(w,r,at,SIGHT)&&location.landing(at)&&
     findPath(w,r.at,at,false,SIGHT,(_from,to)=>!location.unsafe(to))!==null;
    checked.set(key,visible);
   }
   if(!visible)continue;
   const observationId='formal-berry-seen:'+createHash('sha256').update(JSON.stringify([w.id,r.id,receipt.draftId])).digest('hex');
   view.push(Object.freeze({kind:'observed-ground-berry',observationId,at:Object.freeze({...at}),item:'berry',quantity:1,executionAuthorized:false}));
   if(view.length>=MAX)break;
  }
  return Object.freeze(view);
 }catch{return [];}
}
