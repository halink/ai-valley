import type {World,Resident,Resource} from '../shared/types.js';
import {calendar} from '../world/time.js';
import {cropObservation,visibleOwnPlots} from '../world/crop-observation.js';
import {canInspectBerry} from '../world/berry-observation.js';
import {canInspectSpring} from '../world/spring-observation.js';
import {canObserveOutdoors,clearSight,validPoint} from '../world/outdoor-observation.js';
import {knownBuildings} from '../world/building-knowledge.js';
import {mvpDrinkReason,mvpThirst} from '../world/mvp-drinking.js';
import {seasonalPersonalContext} from './mvp-seasonal-context.js';
import type {DecisionContext} from '../shared/types.js';
import {itemKeys} from '../shared/items.js';

function resourceSeen(w:World,r:Resident,s:Resource):boolean {
 if(s.kind==='bush')return canInspectBerry(w,r,s);
 if(s.kind==='spring')return canInspectSpring(w,r,s);
 // A standing tree/rock can be seen at the END of the sight ray, but it
 // blocks sight toward other points. Remove only the target from the ray.
 return canObserveOutdoors(w,r)&&validPoint(w,s.at)&&Math.hypot(r.at.x-s.at.x,r.at.y-s.at.y)<=12
  &&clearSight({...w,resources:w.resources.filter(v=>v.id!==s.id)},r.at,s.at);
}
export const MODEL_CONTEXT_VERSION=1;
export const MODEL_MENU_VERSION=1;
/** Bounded first slice: no dialogue, trade, private memories/intentions from
 * another person, food forecasts, global weather or open-ended action text. */
export function seasonalModelContext(w:World,r:Resident):DecisionContext {
 const local=seasonalPersonalContext(w,r);
 if(!local)throw Error('seasonal_model_context_unavailable');
 const visible=w.resources.filter(s=>r.knownResources.includes(s.id)&&resourceSeen(w,r,s));
 const known=w.resources.filter(s=>r.knownResources.includes(s.id)).map(s=>({id:s.id,kind:s.kind,at:{...s.at},...(s.foodItem==='fruit'?{foodItem:s.foodItem}:{})}));
 return {mvpSeasonal:local,mvpSingleStep:true,
  ...(local.hall?.seedStock&&w.mvpSeeds?{mvpSeeds:{buildingId:local.hall.id,stock:w.mvpSeeds.stock,claimed:w.mvpSeeds.claimed[r.id]??0,saved:w.mvpSeeds.saved[r.id]??0}}:{}),
  actor:{id:r.id,name:r.name,traits:[...r.traits],at:{...r.at},homeId:r.homeId,
  hunger:Math.round(r.hunger),energy:Math.round(r.energy),health:Math.round(r.health),inventory:Object.fromEntries(itemKeys.filter(i=>(r.inventory[i]??0)>0).map(i=>[i,r.inventory[i]])),
  skills:{farming:r.skills.farming,building:r.skills.building,care:r.skills.care},intention:'',lastFailure:r.lastFailure===null?null:'所选行动未成；请亲自复查有关地点或物资。',barterEligible:false},
  people:[],offers:[],proposals:[],memories:[],buildings:knownBuildings(w,r).map(({id,kind,name,door,ownerId})=>({id,kind,name,door,...(ownerId!==undefined?{ownerId}:{})})),
  resources:visible.map(s=>({id:s.id,at:{...s.at},kind:s.kind,amount:s.amount,...(s.foodItem==='fruit'?{foodItem:s.foodItem}:{}),...(s.kind==='spring'?{waterBlocked:s.floodDamage?.clearedAt===null}:{})})),
  // The existing turnip menu needs a visible growth marker and watered day;
  // re-express exactly those legacy observations, not live crop internals.
  plots:visibleOwnPlots(w,r).filter(p=>!p.crop?.mvpCrop).map(p=>{const observed=cropObservation(w,p);return {id:p.id,at:{...p.at},ownerId:r.id,observed,crop:p.crop?{definition:p.crop.definition,growth:observed.stage==='mature'?4:0,wateredDay:observed.wateredToday?Math.floor(w.minute/1440):-1}:null};}),
  knownLand:w.plots.filter(p=>p.ownerId===r.id).map(p=>({id:p.id,at:{...p.at}})),
  mvpKnownSources:known,mvpDrinking:{thirst:mvpThirst(w,r)??0,canDrink:mvpDrinkReason(w,r)===null},
  minute:w.minute,season:calendar(w.minute).season,weather:'sun',bounds:{width:w.map.width,height:w.map.height}};
}
