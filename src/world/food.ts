import {initializeLivestockCargo,initializeRegionalLivestock,reconcileLivestockCargo,advanceLivestockCargo} from './livestock-cargo.js';
import {animalProducts} from './livestock-life.js';
import {beginFoodRoutes,finishFoodRoutes} from './food-routes.js';
import {initializeEstateCustody,estateParcels,estateStock,estateLocation,estateBuildingLocation} from './estate-custody.js';
import {goods,itemKeys} from '../shared/items.js';
import type {FoodLot} from '../shared/food.js';
import type {Inventory,Item,World} from '../shared/types.js';
import {DAY} from './time.js';

/** Only physical stocks appear here. Aggregate public accounts are deliberately excluded. */
export function foodContainers(w:World):Map<string,Inventory>{
 initializeEstateCustody(w);const all=new Map<string,Inventory>();
 for(const p of estateParcels(w))all.set(p.id,p.inventory);
 for(const c of w.migration?.contacts??[])if(c.person)all.set(`person:${c.id}`,c.person.inventory);
 for(const r of w.residents)all.set(`person:${r.id}`,r.inventory);
 for(const e of w.culture?.events??[]){all.set('culture-prep:'+e.id,e.preparation.held);for(const c of e.contributions)all.set('culture-food:'+e.id+':'+c.id,c.inventory);}
 for(const p of w.household?.pools??[])for(const c of p.credits)all.set('family-stock:'+p.id+':'+c.ownerId,c.inventory);
 for(const g of w.household?.gifts??[])if(g.status==='ready')for(const c of g.segments)all.set('family-gift:'+g.id+':'+c.ownerId,c.inventory);
 for(const e of w.estates)all.set(`estate:${e.personId}`,e.inventory);
 for(const b of w.economy?.businesses??[])all.set(`business:${b.id}`,b.inventory);
 for(const [id,bag]of Object.entries(w.civic?.stores??{}))all.set(`public:${id}`,bag);
 // Accessors let expiry change reserved quantities without reconstructing goods.
 const single=(id:string,item:Item,obj:object,field:string)=>{const bag={} as Inventory;Object.defineProperty(bag,item,{enumerable:true,get:()=>Reflect.get(obj,field),set:(n)=>Reflect.set(obj,field,n)});all.set(id,bag);};
 for(const l of w.economy?.listings??[])if(l.side==='sale'&&l.status==='open')single(`listing:${l.id}`,l.item,l,'quantity');
 for(const m of w.foreignTrade?.merchants??[])all.set(`person:${m.id}`,m.person.inventory);
 for(const o of w.foreignTrade?.offers??[])if(o.stock>0)single(`offer:${o.id}`,o.item,o,'stock');
 for(const s of w.foreignTrade?.shipments??[])if(s.goods>0)single(`shipment:${s.id}`,s.item,s,'goods');
 for(const t of w.industry?.trees??[])if(t.status!=='cut')single('orchard-stock:'+t.id,'fruit',t,'fruit');
 for(const n of w.industry?.animals??[])if(n.product>0&&n.kind!=='sheep')single('animal-stock:'+n.id,animalProducts[n.kind],n,'product');
 for(const c of w.employment?.contracts??[])if(c.batch)all.set(`employment:${c.id}`,c.batch.inventory);
 for(const b of w.industry?.batches??[])if(b.status==='working')all.set(`craft:${b.id}`,b.input);
 return all;
}
const perishable=itemKeys.filter(i=>goods[i].life>0);
const qty=(bag:Inventory|undefined,i:Item)=>Math.max(0,bag?.[i]??0);
function fresh(w:World,i:Item,quantity:number):FoodLot{
 const key=w.activeDefinitions['food/life']??'food/life@1';
 const definition=w.definitions[key],days=(definition?.data.days as Record<string,number>|undefined)?.[i];
 const additive=i==='gameMeat'?'food/life/game-meat@1':i==='duckEgg'?'food/life/duck-egg@1':undefined;
 // Existing food definitions predate hunted meat and duck eggs.
 if(additive&&definition?.id==='food/life'&&days===undefined){
  return {quantity,producedAt:w.minute,expiresAt:w.minute+goods[i].life*DAY,definition:additive};
 }
 if(!definition||definition.id!=='food/life'||!Number.isFinite(days)||days!<0)throw new Error('invalid_food_life_definition');
 return {quantity,producedAt:w.minute,expiresAt:w.minute+days!*DAY,definition:key};
}
export function initializeFood(w:World):void{
 if(w.mode!=='formal')return;
 w.definitions['food/life@1']??={id:'food/life',version:1,kind:'life',dependencies:[],data:{days:Object.fromEntries(perishable.filter(i=>i!=='gameMeat').map(i=>[i,goods[i].life])),nutrition:Object.fromEntries(itemKeys.filter(i=>i!=='gameMeat'&&i!=='spearKit').map(i=>[i,goods[i].food]))}};
 w.definitions['food/life/game-meat@1']??={id:'food/life/game-meat',version:1,kind:'life',dependencies:[],data:{days:{gameMeat:goods.gameMeat.life},nutrition:{gameMeat:goods.gameMeat.food}}};
 w.definitions['food/life/duck-egg@1']??={id:'food/life/duck-egg',version:1,kind:'life',dependencies:[],data:{days:{duckEgg:goods.duckEgg.life},nutrition:{duckEgg:goods.duckEgg.food}}};
 w.food??={registeredAt:w.minute,lots:{},spoiled:{},lastMinute:w.minute};
 const containers=foodContainers(w);initializeLivestockCargo(w,containers);initializeRegionalLivestock(w);
 for(const [id,bag]of containers){const ledger=w.food.lots[id]??={};for(const i of perishable){const n=qty(bag,i),lots=ledger[i]??=[];const held=lots.reduce((s,l)=>s+l.quantity,0);if(n>held)lots.push(fresh(w,i,n-held));else if(n<held)take(lots,held-n);if(!lots.length)delete ledger[i];}if(!Object.keys(ledger).length)delete w.food.lots[id];}
 for(const id of Object.keys(w.food.lots))if(!containers.has(id))delete w.food.lots[id];
}
function take(lots:FoodLot[],n:number):FoodLot[]{const out:FoodLot[]=[];lots.sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt);while(n>1e-9&&lots.length){const l=lots[0],q=Math.min(n,l.quantity);out.push({...l,quantity:q});l.quantity-=q;n-=q;if(l.quantity<1e-9)lots.shift();}return out;}
function merge(lots:FoodLot[],l:FoodLot){const same=lots.find(a=>a.producedAt===l.producedAt&&a.expiresAt===l.expiresAt&&a.definition===l.definition);if(same)same.quantity+=l.quantity;else lots.push({...l});}
const active=new WeakSet<World>();
/** A single authorized physical transfer or production receipt, never an entire multi-owner tick. */
export function foodTransaction<T>(w:World,fn:()=>T):T{
 if(w.mode!=='formal'||active.has(w))return fn();
 initializeFood(w);const before=new Map([...foodContainers(w)].map(([id,bag])=>[id,{...bag}]));active.add(w);beginFoodRoutes(w);
 try{return fn();}finally{try{
  const after=foodContainers(w),ids=new Set([...before.keys(),...after.keys()]);
  const routes=finishFoodRoutes(w);reconcileLivestockCargo(w,before,after,routes);
  for(const i of perishable){const moved:FoodLot[]=[],expected=new Map([...ids].map(id=>[id,qty(before.get(id),i)])),available=new Map(expected),deliveries:Array<{to:string;lots:FoodLot[]}>=[];
   // Take every declared source before delivering any of them. Equal simultaneous swaps
   // exchange the original lots instead of sending the newly received food back again.
   for(const route of routes){const quantity=route.goods[i]??0;if(quantity<=0||route.from===route.to)continue;if(quantity>(available.get(route.from)??0)+1e-9)throw new Error('food_route_exceeds_original_stock');available.set(route.from,(available.get(route.from)??0)-quantity);const lots=take(w.food!.lots[route.from]?.[i]??[],quantity);deliveries.push({to:route.to,lots});expected.set(route.from,(expected.get(route.from)??0)-quantity);expected.set(route.to,(expected.get(route.to)??0)+quantity);}
   for(const delivery of deliveries){const ledger=w.food!.lots[delivery.to]??={},target=ledger[i]??=[];for(const lot of delivery.lots)merge(target,lot);}
   const out=new Map<string,number>(),into=new Map<string,number>();for(const id of ids){const delta=(expected.get(id)??0)-qty(after.get(id),i);if(delta>1e-9)out.set(id,delta);else if(delta< -1e-9)into.set(id,-delta);}
   for(const [id,n]of out)moved.push(...take(w.food!.lots[id]?.[i]??[],n));moved.sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt);
   for(const [id,quantity]of into){let n=quantity;const ledger=w.food!.lots[id]??={},lots=ledger[i]??=[];const transferred=take(moved,n);for(const l of transferred){merge(lots,l);n-=l.quantity;}if(n>1e-9)merge(lots,fresh(w,i,n));}
  }

  for(const [id,ledger]of Object.entries(w.food!.lots)){for(const i of perishable)if(!ledger[i]?.length)delete ledger[i];if(!after.has(id)||!Object.keys(ledger).length)delete w.food!.lots[id];}
 }finally{active.delete(w);finishFoodRoutes(w);}
 }
}
/** Aging is world time only. Destruction reduces actual cargo/escrow/batch stock, never balances. */
export function advanceFood(w:World):void{
 initializeFood(w);if(!w.food)return;w.food.lastMinute=w.minute;const containers=foodContainers(w);advanceLivestockCargo(w,containers);
 for(const [id,ledger]of Object.entries(w.food.lots)){const bag=containers.get(id);if(!bag)continue;
  for(const i of perishable){const lots=ledger[i];if(!lots)continue;const lost=lots.filter(l=>l.expiresAt<=w.minute).reduce((s,l)=>s+l.quantity,0);if(!lost)continue;bag[i]=Math.max(0,qty(bag,i)-lost);ledger[i]=lots.filter(l=>l.expiresAt>w.minute);w.food.spoiled[i]=(w.food.spoiled[i]??0)+lost;
   if(id.startsWith('public:')&&w.economy)w.economy.treasuryStock[i]=Math.max(0,(w.economy.treasuryStock[i]??0)-lost);
   if(id.startsWith('person:')){const r=w.residents.find(r=>id===`person:${r.id}`)??w.foreignTrade?.merchants.find(m=>id===`person:${m.id}`)?.person;if(r){r.revision++;r.decisionDue=Math.min(r.decisionDue,w.minute);}}
  }
 }
 for(const b of w.industry?.batches??[])if(b.status==='working'&&Object.entries(b.recipe.input).some(([i,n])=>(b.input[i as Item]??0)<n!))foodTransaction(w,()=>{const owner=w.residents.find(r=>r.id===b.ownerId),bag=owner?.status==='dead'?estateStock(w,owner.id,'craft:'+b.id,estateBuildingLocation(w,b.buildingId,'原加工工位保全原料',true,b.recipe.station??undefined)):owner?.inventory;if(bag)for(const [i,n]of Object.entries(b.input))bag[i as Item]=(bag[i as Item]??0)+n!;b.input={};b.status='cancelled';});
 for(const c of w.employment?.contracts??[])if(c.batch){const expected=c.recipe?.input??(c.terms.role==='cook'?{turnip:2,water:1}:{turnip:1});if(Object.entries(expected).some(([i,n])=>(c.batch!.inventory[i as Item]??0)<n!))foodTransaction(w,()=>{const shop=w.economy?.businesses.find(b=>b.id===c.businessId);if(shop){for(const [i,n]of Object.entries(c.batch!.inventory))shop.inventory[i as Item]=(shop.inventory[i as Item]??0)+n!;c.batch=null;}});}
}

/** Nutrition belongs to the physical lots being eaten, including older definitions. */
export function foodValue(w:World,container:string,item:Item,quantity=1){let left=quantity,total=0;for(const lot of [...(w.food?.lots[container]?.[item]??[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt)){const q=Math.min(left,lot.quantity),value=(w.definitions[lot.definition]?.data.nutrition as Record<string,number>|undefined)?.[item]??goods[item].food;total+=q*value;left-=q;if(left<=0)break;}return total+left*goods[item].food;}
