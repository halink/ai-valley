import {createHash} from 'node:crypto';
import type {Vec,World} from '../shared/types.js';
import {formalBerryCommonGround} from '../world/formal-berry-location.js';
import {canSeeOutdoorPoint} from '../world/outdoor-observation.js';
import {passenger} from '../world/medical-transport.js';
import {findPath,distance} from '../world/navigation.js';
import {activeCases} from '../world/health.js';
import {goods} from '../shared/items.js';
import {DAY} from '../world/time.js';
import type {FormalBerryFixtureEffect} from './valley-spirit-formal-berry-authority.js';

const SIGHT=12,MAX=4;
interface Seen {
 readonly kind:'observed-ground-berry';
 readonly observationId:string;
 readonly at:Readonly<Vec>;
 readonly item:'berry';
 readonly quantity:1;
 readonly executionAuthorized:false;
}

/** The current fixture birth schema did not store a dated food lot. Accept
 * only the unambiguous single baseline definition; an installed alternative
 * makes freshness unknown, even if the active pointer later goes back. */
function baselineLife(w:World):number|null {
 const key='food/life@1',def=w.definitions[key];
 const contenders=Object.values(w.definitions).filter(d=>d.id==='food/life');
 const days=(def?.data.days as Record<string,unknown>|undefined)?.berry;
 return (w.activeDefinitions['food/life']??key)===key&&contenders.length===1&&
  def?.id==='food/life'&&def.version===1&&def.kind==='life'&&days===goods.berry.life?goods.berry.life*DAY:null;
}

/** Pure private projection from store-owned, already-validated receipt rows.
 * It is not an action option, a durable discovery or a view for another actor. */
export function projectDeveloperFormalBerryDiscovery(
 w:World,rows:readonly FormalBerryFixtureEffect[],residentId:string,
):readonly Seen[]{
 try{
  if(w.mode!=='formal'||w.clock.paused||Object.hasOwn(w,'simulationOnly')||!w.formalBerryFixtureAnchor)return [];
  const life=baselineLife(w);if(life===null)return [];
  const people=w.residents.filter(r=>r.id===residentId);
  const r=people.length===1?people[0]:undefined;
  if(!r||r.regionalLocation||passenger(w,r.id)||!(r.energy>0)||!(r.health>0)||
   activeCases(w,r.id).some(c=>{
    const critical=c.rules?.criticalSeverity??(w.definitions[c.definition??'health/rules@1']?.data.criticalSeverity);
    return c.stage==='critical'||!Number.isFinite(c.severity)||typeof critical!=='number'||!Number.isFinite(critical)||c.severity>=critical;
   }))return [];
  const location=formalBerryCommonGround(w);if(location.unsafe(r.at))return [];
  const view:Seen[]=[];
  const nearby=rows.filter(({receipt})=>w.minute>=receipt.placedMinute&&w.minute<receipt.placedMinute+life&&distance(r.at,receipt.target)<=SIGHT)
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
