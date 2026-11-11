import {commonsFoodOptions,commonsFoodContainer,commonsTarget} from './commons.js';
import type {Action,Activity,Inventory,Item,Resident,Vec,World} from '../shared/types.js';
import type {ReachableFoodLot,ResidentFoodCoverage,SettlementFoodCoverage} from '../shared/food-coverage.js';
import {goods,itemKeys} from '../shared/items.js';
import {actionRoom,roomLayout,roomPath} from '../shared/rooms.js';
import {physiologyDefaults} from '../shared/physiology.js';
import {ageAllowsAction} from './family.js';
import {ownedEstateParcels} from './estate-custody.js';
import {economyTarget} from './economy.js';
import {householdTarget} from './household.js';
import {productionTarget,emergencyEstateOptions} from './production.js';
import {movementRate} from './health.js';
import {aboardFerry} from './ferry.js';
import {passenger} from './medical-transport.js';
import {distance,findPath} from './navigation.js';
import {DAY} from './time.js';

type Route={target:Vec;duration:number;error?:string};
type Stock={containerId:string;inventory:Inventory;portionOffset?:Inventory};
type Source={label:string;stocks:Stock[];actions:Action[];routes:Route[];validUntil?:number;requiresWholeStock?:boolean;requiredRoom?:string|null};
const edible=itemKeys.filter(item=>goods[item].food>0);
const finitePositive=(n:number|undefined)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:0;

/** Do not initialize or repair world state while answering a read-only query. */
export function foodDailyNeed(w:World,r:Resident):number {
 const rate=w.definitions[r.physiologyDefinition??'life/physiology@1']?.data.hungerPerMinute;
 return finitePositive(typeof rate==='number'?rate:physiologyDefaults.hungerPerMinute)*DAY;
}

function stocks(w:World,r:Resident):Source[] {
 const out:Source[]=[];
 const add=(label:string,stock:Stock[],actions:Action[],routes:Route[],validUntil?:number,requiresWholeStock=true,requiredRoom?:string|null)=>{
  if(actions.length&&actions.every(a=>ageAllowsAction(w,r,a))&&routes.every(route=>!route.error))out.push({label,stocks:stock,actions,routes,validUntil,requiresWholeStock,requiredRoom});
 };
 for(const a of commonsFoodOptions(w,r)){
  if(a.operation==='takeFood')add(a.reserveId?'共屋按已通过储备议案可领的一份现有口粮':'共屋按开拓公约可领的一份现有口粮',[{containerId:commonsFoodContainer(a),inventory:{[a.item]:1}}],[a],[commonsTarget(w,r,a)],a.reserveId?w.civic?.reserves?.find(p=>p.id===a.reserveId)?.expiresAt:undefined,true,a.buildingId);
 }
 for(const p of ownedEstateParcels(w,r)){
  const a:Action={type:'production',operation:'collectEstate',parcelId:p.id};
  add(p.location.label??'已登记归本人的原址遗产',[{containerId:p.id,inventory:p.inventory}],[a],[productionTarget(w,r,a)],undefined,false,p.location.inside);
 }
 for(const option of emergencyEstateOptions(w,r)){
  add('本人未领取继承份额中的一次有限救急口粮',[{containerId:option.containerId,inventory:option.inventory,portionOffset:option.portionOffset}],[option.action],[productionTarget(w,r,option.action)],option.expiresAt,true,option.location.inside);
 }
 // Personal ownership reveals the address, not a remote live stock count.
 for(const b of w.economy?.businesses??[]){
  const place=w.buildings.find(p=>p.id===b.buildingId);
  if(b.ownerId!==r.id||!place||!r.knownBuildings.includes(place.id)||distance(r.at,place.door)>8||r.inside!==null&&r.inside!==place.id)continue;
  const actions:Action[]=[],routes:Route[]=[],inventory:Inventory={};
  for(const item of edible){const quantity=Math.min(100,Math.floor(finitePositive(b.inventory[item])));if(!quantity)continue;
   const a:Action={type:'economy',operation:'retrieve',businessId:b.id,item,quantity},route=economyTarget(w,r,a);
   if(!route.error){inventory[item]=quantity;actions.push(a);routes.push(route);}
  }
  add(b.name,[{containerId:'business:'+b.id,inventory}],actions,routes);
 }
 for(const p of w.household?.pools??[]){
  // A distant shared pantry is not a live inventory feed.
  if(r.inside!==null||distance(r.at,p.at)>8)continue;
  const own=p.credits.find(c=>c.ownerId===r.id);if(!own)continue;
  const actions:Action[]=[],routes:Route[]=[],inventory:Inventory={};
  for(const item of edible){const quantity=Math.min(20,Math.floor(finitePositive(own.inventory[item])));if(!quantity)continue;
   const a:Action={type:'household',operation:'withdraw',poolId:p.id,item,quantity,amount:0},route=householdTarget(w,r,a);
   if(!route.error){inventory[item]=quantity;actions.push(a);routes.push(route);}
  }
  add(p.name,[{containerId:'family-stock:'+p.id+':'+r.id,inventory}],actions,routes);
 }
 for(const g of w.household?.gifts??[]){
  const p=w.household!.pools.find(p=>p.id===g.poolId);
  if(!p||p.status!=='open'||g.status!=='ready'||g.recipientId!==r.id||g.segments.some((s,i)=>Object.entries(g.costs[i]?.inventory??{}).some(([item,n])=>(s.inventory[item as Item]??0)<n!)))continue;
  const a:Action={type:'household',operation:'acceptGift',giftId:g.id},route=householdTarget(w,r,a);
  add('已获双方同意的具体赠与',g.segments.map(s=>({containerId:'family-gift:'+g.id+':'+s.ownerId,inventory:s.inventory})),[a],[route],g.expiresAt);
 }
 return out;
}

/** Route to one real pickup, including indoor movement and every collection action. */
function collectionMinutes(w:World,r:Resident,source:Source):number|null {
 if(aboardFerry(w,r.id)||passenger(w,r.id))return null;
 // Health rule lookup can register a legacy default; isolate that small map only.
 const rate=movementRate({...w,definitions:{...w.definitions}},r);
 if(!(rate>0))return null;
 let current={...r,at:{...r.at},roomAt:r.roomAt?{...r.roomAt}:null},minutes=0;
 for(const [index,route] of source.routes.entries()){
  const action=source.actions[index],path=findPath(w,current.at,route.target);if(path===null)return null;
  const activity:Activity={planId:'food-coverage',action,startedAt:w.minute,remaining:route.duration,path,target:route.target,definition:w.activeDefinitions['action/routine'],travelProgress:0};
  const work=w.rooms?actionRoom(w,current,activity):null;
  // actionRoom also returns null when an indoor target has NO viable standing
  // place. That must not turn a sealed indoor parcel into an outdoor pickup.
  if(source.requiredRoom&&(!work||work.building.id!==source.requiredRoom))return null;
  if(w.rooms&&current.inside&&(path.length||work?.building.id!==current.inside)){
   const b=w.buildings.find(b=>b.id===current.inside);if(!b)return null;
   const layout=roomLayout(w,b),exit=roomPath(layout,current.roomAt??layout.entry,layout.entry);if(exit===null)return null;
   minutes+=Math.ceil(exit.length/rate)+1;current.inside=null;current.roomAt=null;
  }
  minutes+=Math.ceil(path.reduce((sum,p)=>sum+(w.map.tiles[p.y*w.map.width+p.x]==='road'?.75:1),0)/rate)+(path.length?1:0);
  current.at={...route.target};
  if(work){
   const layout=roomLayout(w,work.building),from=current.inside===work.building.id?current.roomAt??layout.entry:layout.entry;
   const inside=roomPath(layout,from,work.target);if(inside===null)return null;
   if(w.rooms!.claims.some(c=>c.buildingId===work.building.id&&c.key===work.key&&c.group!==work.group))return null;
   minutes+=Math.ceil(inside.length/rate)+(inside.length?1:0);current.inside=work.building.id;current.roomAt={...work.target};
  }else {current.inside=null;current.roomAt=null;}
  minutes+=route.duration+1;
 }
 return minutes;
}

function foodLots(w:World,stock:Stock,availableAt:number):{lots:ReachableFoodLot[];unknown:boolean}{
 const lots:ReachableFoodLot[]=[];let unknown=false;
 for(const item of edible){
  const start=lots.length;
  let remaining=Math.floor(finitePositive(stock.inventory[item])),skip=finitePositive(stock.portionOffset?.[item]);if(!remaining)continue;
  // The stock is the upper bound, even if a stale ledger happens to contain more.
  const registered=(w.food?.lots[stock.containerId]?.[item]??[]).map((lot,index)=>({lot,index})).sort((a,b)=>a.lot.expiresAt-b.lot.expiresAt||a.lot.producedAt-b.lot.producedAt);
  for(const {lot,index}of registered){
   const offset=Math.min(skip,finitePositive(lot.quantity));skip-=offset;
   const quantity=Math.min(remaining,finitePositive(lot.quantity)-offset);remaining-=quantity;
   if(quantity<=0||!Number.isFinite(lot.expiresAt)||lot.expiresAt<=availableAt)continue;
   const saved=(w.definitions[lot.definition]?.data.nutrition as Record<string,number>|undefined)?.[item];
   const nutrition=quantity*finitePositive(saved??goods[item].food);
   if(nutrition)lots.push({containerId:stock.containerId,item,lotIndex:index,offset,quantity,nutrition,availableAt,expiresAt:lot.expiresAt});
  }
  if(remaining>1e-9)unknown=true;
  // Eating requires a complete unit. A surviving fractional remnant alone is
  // not a meal, although one unit may span several original physical lots.
  let whole=Math.floor(lots.slice(start).reduce((n,l)=>n+l.quantity,0)+1e-9);
  const usable=lots.splice(start).flatMap(lot=>{const quantity=Math.min(whole,lot.quantity);whole-=quantity;return quantity>0?[{...lot,quantity,nutrition:lot.nutrition*quantity/lot.quantity}]:[];});
  lots.push(...usable);
 }
 return {lots,unknown};
}

/** Fixed-quantity withdrawals and gifts fail as a whole if any promised
 * perishable (including non-edible ingredients) is lost before collection. */
function wholeStockSurvives(w:World,stock:Stock,at:number):boolean {
 for(const item of itemKeys.filter(i=>goods[i].life>0)){
  let needed=finitePositive(stock.inventory[item]),skip=finitePositive(stock.portionOffset?.[item]);
  if(!needed)continue;
  for(const lot of [...(w.food?.lots[stock.containerId]?.[item]??[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt)){
   const offset=Math.min(skip,finitePositive(lot.quantity));skip-=offset;
   const quantity=Math.min(needed,finitePositive(lot.quantity)-offset);
   if(quantity>0&&(!Number.isFinite(lot.expiresAt)||lot.expiresAt<=at))return false;
   needed-=quantity;if(needed<=1e-9)break;
  }
  if(needed>1e-9)return false;
 }
 return true;
}

/** Maximum daily nutritional demand these lots can serve before spoiling.
 * Time intervals keep overlapping expiry windows from each claiming the same demand.
 * This is a food equivalent, not a discrete meal or survival forecast. */
export function usableFoodNutrition(lots:ReachableFoodLot[],rate:number,now:number):number {
 if(!(rate>0)||!lots.length)return 0;
 const points=[...new Set([now,...lots.flatMap(l=>[l.availableAt,l.expiresAt])])].filter(t=>t>=now).sort((a,b)=>a-b);
 const pending=lots.map(l=>({...l,left:l.nutrition})).sort((a,b)=>a.expiresAt-b.expiresAt);
 let total=0;
 for(let i=0;i<points.length-1;i++){
  const start=points[i],end=points[i+1];let capacity=(end-start)*rate;
  for(const lot of pending){if(lot.availableAt>start||lot.expiresAt<=start||lot.left<=0)continue;
   const n=Math.min(capacity,lot.left);lot.left-=n;capacity-=n;total+=n;if(capacity<=1e-9)break;
  }
 }
 return total;
}

/** Conservative reserve: carried food plus at most ONE independently reachable
 * pickup. Do not add mutually competing trips, pending purchases or future help. */
export function residentFoodCoverage(w:World,r:Resident):ResidentFoodCoverage {
 const dailyNeed=foodDailyNeed(w,r),needsCare=!r.canDecide||!r.canExpress||!ageAllowsAction(w,r,{type:'eat',item:'meal'});
 const result:ResidentFoodCoverage={residentId:r.id,dailyNeed,carriedNutrition:0,reachableNutrition:0,usableNutrition:0,days:0,lowFood:false,needsCare,unknownExpiry:false,sourceLabel:null,collectionMinutes:null,lots:[]};
 if(w.mode!=='formal'||r.status!=='alive'||r.residency==='outside')return result;
 if(passenger(w,r.id)){result.accessBlocked='medicalTransport';result.lowFood=true;return result;}
 if(needsCare){result.lowFood=true;return result;}
 const carried=foodLots(w,{containerId:'person:'+r.id,inventory:r.inventory},w.minute+5);
 result.lots=carried.lots;result.unknownExpiry=carried.unknown;result.carriedNutrition=carried.lots.reduce((n,l)=>n+l.nutrition,0);
 result.usableNutrition=usableFoodNutrition(carried.lots,dailyNeed/DAY,w.minute);
 for(const source of stocks(w,r)){
  // Non-food custody must not trigger a map search on every decision.
  if(!source.stocks.some(s=>edible.some(item=>(s.inventory[item]??0)>=1&&(w.food?.lots[s.containerId]?.[item]??[]).some(l=>l.quantity>0&&l.expiresAt>w.minute))))continue;
  const minutes=collectionMinutes(w,r,source);if(minutes===null||source.validUntil!==undefined&&w.minute+minutes>=source.validUntil)continue;
  if(source.requiresWholeStock&&source.stocks.some(s=>!wholeStockSurvives(w,s,w.minute+minutes)))continue;
  const discovered=source.stocks.map(s=>foodLots(w,s,w.minute+minutes+5));
  const candidates=[...carried.lots,...discovered.flatMap(s=>s.lots)],usable=usableFoodNutrition(candidates,dailyNeed/DAY,w.minute);
  if(usable<=result.usableNutrition+1e-9)continue;
  result.lots=candidates;result.usableNutrition=usable;result.sourceLabel=source.label;result.collectionMinutes=minutes;
  result.unknownExpiry=carried.unknown||discovered.some(s=>s.unknown);
 }
 result.reachableNutrition=result.lots.reduce((n,l)=>n+l.nutrition,0);
 result.days=dailyNeed>0?result.usableNutrition/dailyNeed:0;result.lowFood=dailyNeed>0&&result.days<2-1e-9;
 return result;
}

export function foodCoverageNote(coverage:ResidentFoodCoverage):string {
 if(coverage.accessBlocked==='medicalTransport')return '口粮提醒：本人正在被护送，暂不能独立进食，随身食品不计入当前可自主取食余量。结束护送和实际照护仍须另行执行。';
 if(coverage.needsCare)return '本人尚不能独立取食，需要实际照护者；不把别人的物资或未来援助算作已有口粮。';
 const days=Math.floor(coverage.days*100)/100;
 return `${coverage.lowFood?'口粮提醒：已核实的可达食物估算不足两天。':''}按本人日常消耗、批次保质期及取货路程，已核实口粮约${days}天${coverage.sourceLabel?`（随身食物及一处可自行领取的存货，取货约${Math.ceil(coverage.collectionMinutes!)}分钟）`:'（随身食物）'}。${coverage.unknownExpiry?'另有保质期未登记的食品，未计入。':''}这不是及时进食或获救的保证；不计未来产出、购物、他人私粮和未同意的援助。`;
}

export function settlementFoodCoverage(w:World):SettlementFoodCoverage {
 const residents=w.residents.filter(r=>r.status==='alive'&&r.residency!=='outside').map(r=>residentFoodCoverage(w,r));
 const union=new Map<string,ReachableFoodLot[]>();
 for(const r of residents)for(const lot of r.lots){const key=JSON.stringify([lot.containerId,lot.item,lot.lotIndex]);const rows=union.get(key)??[];rows.push(lot);union.set(key,rows);}
 let uniqueNutrition=0;
 for(const rows of union.values()){
  let end=0;for(const lot of rows.sort((a,b)=>a.offset-b.offset)){const next=lot.offset+lot.quantity;uniqueNutrition+=Math.max(0,next-Math.max(end,lot.offset))*lot.nutrition/lot.quantity;end=Math.max(end,next);}
 }
 const dailyNeed=residents.reduce((sum,r)=>sum+r.dailyNeed,0);
 return {residents,uniqueNutrition,dailyNeed,stockDays:dailyNeed>0?uniqueNutrition/dailyNeed:0};
}
