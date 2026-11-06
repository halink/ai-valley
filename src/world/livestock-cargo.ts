import type {Inventory,Item,Resident,World,Vec} from '../shared/types.js';
import type {AnimalKind,LivestockCargo} from '../shared/industry.js';
import type {FoodRoute} from './food-routes.js';
import {industryDefinition} from './industry-rules.js';import {animalYears} from '../shared/industry-rules.js';
import {estateParcels} from './estate-custody.js';import {roomLayout} from '../shared/rooms.js';import {nearLocation} from './proximity.js';import {emitEvent,emitLedgerEvent} from './events.js';import {DAY,YEAR} from './time.js';
import {animalNames} from './livestock-life.js';
const animalCrates={chicken:'chickCrate',goat:'goatCrate',sheep:'sheepCrate',duck:'duckCrate',cow:'cowCrate'} as const;
export const livestockItems={chickCrate:'chicken',goatCrate:'goat',sheepCrate:'sheep',duckCrate:'duck',cowCrate:'cow'} as const;
export const animalCrate=(kind:AnimalKind)=>animalCrates[kind];
type Location=NonNullable<LivestockCargo['deathLocation']>;
const named=(at:Vec,inside:string|null=null,roomAt:Vec|null=null,label='实际货物所在处'):Location=>({at:{...at},inside,roomAt:roomAt?{...roomAt}:null,origin:null,label});
const origin=(id:string):Location=>({at:null,inside:null,roomAt:null,origin:id,label:'镇外商行原库'});
export function crateLocation(w:World,c:LivestockCargo):Location|null {
 const id=c.container;
 if(id.startsWith('person:')){const who=id.slice(7),r=w.residents.find(r=>r.id===who)??w.migration?.contacts.find(t=>t.id===who)?.person;if(r&&r.residency!=='outside')return named(r.at,r.inside,r.roomAt??null,'随身运输笼');if(w.foreignTrade?.merchants.some(m=>m.id===who))return origin(who);return null;}
 const stock=estateParcels(w).find(p=>p.id===id);if(stock)return named(stock.location.at,stock.location.inside,stock.location.roomAt,'原址封存运输笼');
 if(id.startsWith('estate:')){const e=w.estates.find(e=>e.personId===id.slice(7));return e?.location?named(e.location.at,e.location.inside,e.location.roomAt,'逝者随身运输笼'):null;}
 if(id.startsWith('offer:')){const o=w.foreignTrade?.offers.find(o=>'offer:'+o.id===id);return o?o.initiatedBy==='merchant'?origin(o.merchantId):named(o.stationAt??w.foreignTrade!.station,null,null,'驿站出口预留货物'):null;}
 if(id.startsWith('shipment:')){const s=w.foreignTrade?.shipments.find(s=>'shipment:'+s.id===id);if(!s)return null;if(s.route?.at)return named(s.route.at,null,null,'实际运输车辆或交接货物');if(s.status==='ready'||s.status==='arrived')return named(s.stationAt??w.foreignTrade!.station,null,null,'实际交接处');return {at:null,inside:null,roomAt:null,origin:null,label:'镇外运输途中'};}
 let buildingId:string|undefined;
 if(id.startsWith('business:'))buildingId=w.economy?.businesses.find(b=>'business:'+b.id===id)?.buildingId;
 if(id.startsWith('listing:')){const l=w.economy?.listings.find(l=>'listing:'+l.id===id);buildingId=w.economy?.businesses.find(b=>b.id===l?.businessId)?.buildingId;}
 if(id.startsWith('public:'))buildingId=id.slice(7);
 if(id.startsWith('family-stock:')||id.startsWith('family-gift:')){const pool=w.household?.pools.find(p=>p.credits.some(t=>'family-stock:'+p.id+':'+t.ownerId===id)||w.household?.gifts.some(g=>g.poolId===p.id&&g.segments.some(t=>'family-gift:'+g.id+':'+t.ownerId===id)));buildingId=pool?.buildingId;}
 const b=w.buildings.find(b=>b.id===buildingId);return b?named(b.door,b.id,roomLayout(w,b).entry,'场所内运输笼'):null;
}
/** Only the explicit one-time source registration and legacy physical stocks receive identities. */
function registerCrate(w:World,container:string,kind:AnimalKind){
 const state=w.industry!,serial=state.nextSerial++,binding=industryDefinition(w);
 const crate:LivestockCargo={definition:binding.definition,id:'animal-cargo:'+w.id+':'+serial,container,kind,
  sex:serial%2?'female':'male',bornAt:w.minute-(kind==='chicken'?0:binding.rules.animalAdultDays*DAY),
  hunger:20,thirst:20,health:100,status:'crated',lastMinute:w.minute,releasedAt:null,deathAt:null};
 state.livestockCargo!.push(crate);
 return crate;
}
export function initializeLivestockCargo(w:World,containers:Map<string,Inventory>){
 const state=w.industry;if(!state||state.livestockCargo)return;
 state.livestockCargo=[];
 for(const [container,bag]of containers)for(const [item,kind]of Object.entries(livestockItems)){
  for(let i=0;i<(bag[item as Item]??0);i++)registerCrate(w,container,kind);
 }
}

/** Finite outside breeder stock, registered once and subject to the same husbandry and transport as old stock. */
export function initializeRegionalLivestock(w:World){
 const state=w.industry;
 if(w.scenario!=='frontier'||!state?.livestockCargo||state.sources.regionalLivestockAt!==undefined||!w.foreignTrade?.merchants.length)return;
 state.sources.regionalLivestockAt=w.minute;
 for(const [kind,origin,quantity] of [['duck','foreign-coast',3],['cow','foreign-west',2]] as const){
  const merchant=w.foreignTrade.merchants.find(m=>m.id===origin&&m.person.status==='alive');
  if(!merchant)continue;
  const item=animalCrate(kind),ids:string[]=[];
  merchant.person.inventory[item]=(merchant.person.inventory[item]??0)+quantity;
  state.sources.livestockCrates[item]=(state.sources.livestockCrates[item]??0)+quantity;
  for(let i=0;i<quantity;i++)ids.push(registerCrate(w,'person:'+origin,kind).id);
  const text=`${merchant.name}登记了 ${quantity} 只来自当地牧户的${animalNames[kind]}，尚在镇外，需要自行照料和商谈运输。`;
  const event=emitLedgerEvent(w,{kind:'production',actors:[origin],animalIds:ids,place:{...w.map.entrance},text});
  merchant.person.memories.push({eventId:event.id,receivedAt:w.minute,source:'self',text});merchant.person.revision++;
 }
}
/** Identity follows the original physical stock, including zero-net swaps and source-specific estate splits. */
export function reconcileLivestockCargo(w:World,before:Map<string,Inventory>,after:Map<string,Inventory>,routes:FoodRoute[]){const s=w.industry;if(!s?.livestockCargo)return;for(const [item,kind]of Object.entries(livestockItems)){
 const remaining=s.livestockCargo.filter(c=>c.kind===kind&&c.status==='crated'),original=new Map(remaining.map(c=>[c.id,c.container])),used=new Set<string>();const move=(from:string,to:string,n:number)=>{const list=remaining.filter(c=>original.get(c.id)===from&&!used.has(c.id)).slice(0,n);if(list.length!==n)throw new Error('missing_actual_livestock_identity');for(const c of list){used.add(c.id);c.container=to;}};
 for(const t of routes){const n=t.goods[item as Item]??0;if(n>0&&t.from!==t.to)move(t.from,t.to,n);}
 const overflow:LivestockCargo[]=[];for(const id of new Set([...before.keys(),...after.keys()])){const held=remaining.filter(c=>c.container===id),expected=after.get(id)?.[item as Item]??0;if(held.length>expected){const extra=held.filter(c=>!used.has(c.id)).slice(0,held.length-expected);if(extra.length!==held.length-expected)throw new Error('conflicting_livestock_custody');overflow.push(...extra);}}
 for(const id of after.keys()){const wanted=(after.get(id)?.[item as Item]??0)-remaining.filter(c=>c.container===id).length;for(let i=0;i<wanted;i++){const c=overflow.shift();if(!c)throw new Error('livestock_requires_actual_source');c.container=id;}}
 if(overflow.length)throw new Error('livestock_disappeared_without_release_or_death');
 }}
export function cratedAnimal(w:World,container:string,kind:AnimalKind,id?:string){return w.industry?.livestockCargo?.find(c=>c.status==='crated'&&c.container===container&&c.kind===kind&&(!id||c.id===id));}
export function canReachCrate(w:World,r:Resident,c:LivestockCargo){const l=crateLocation(w,c);return !!l?.at&&nearLocation(w,r,{at:l.at,inside:l.inside,roomAt:l.roomAt},1);}
export function crateAtOrigin(w:World,c:LivestockCargo,id:string){return c.status==='crated'&&crateLocation(w,c)?.origin===id;}
export function careForCrate(w:World,c:LivestockCargo,water:boolean){if(c.status!=='crated')return;const rules=industryDefinition(w,c.definition).rules;if(water)c.thirst=Math.max(0,c.thirst-rules.animalWaterRelief);else c.hunger=Math.max(0,c.hunger-rules.animalFeedRelief);}
export function advanceLivestockCargo(w:World,containers:Map<string,Inventory>){for(const c of w.industry?.livestockCargo??[]){if(c.status!=='crated')continue;const r=industryDefinition(w,c.definition).rules,dt=Math.max(0,w.minute-c.lastMinute),dangerAfter=Math.min(Math.max(0,r.animalDanger-c.hunger)*r.animalHungerMinutes,Math.max(0,r.animalDanger-c.thirst)*r.animalThirstMinutes);c.lastMinute=w.minute;c.hunger=Math.min(100,c.hunger+dt/r.animalHungerMinutes);c.thirst=Math.min(100,c.thirst+dt/r.animalThirstMinutes);c.health=Math.max(0,c.health-Math.max(0,dt-dangerAfter)*r.animalHealthDrain);if(c.health>0&&w.minute-c.bornAt<animalYears(r,c.kind)*YEAR)continue;const bag=containers.get(c.container),item=animalCrate(c.kind);if(!bag||!(bag[item]!>0))throw new Error('dead_livestock_missing_container');bag[item]=bag[item]!-1;c.status='dead';c.deathAt=w.minute;c.deathLocation=crateLocation(w,c)??{at:null,inside:null,roomAt:null,origin:null,label:'原物理货物处'};w.industry!.totals.animalDeaths++;const l=c.deathLocation,text=`运输笼内一只${animalNames[c.kind]}因${c.health<=0?'长期缺乏饲水':'衰老'}死亡，实际活畜货物减少一只，身份与经历保留。`;if(l.at)emitEvent(w,{kind:'production',actors:[],animalIds:[c.id],place:l.at,roomId:l.inside,roomAt:l.roomAt,text});else{const e=emitLedgerEvent(w,{kind:'production',actors:[],animalIds:[c.id],place:w.map.entrance,text});const m=w.foreignTrade?.merchants.find(m=>m.id===l.origin);if(m){m.person.memories.push({eventId:e.id,receivedAt:w.minute,source:'witness',text});m.person.revision++;m.person.decisionDue=Math.min(m.person.decisionDue,w.minute);}}}}
