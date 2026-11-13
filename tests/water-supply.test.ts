import {initializeHealth} from '../src/world/health.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {WaterSupplyAction,WaterVessel} from '../src/shared/water-supply.js';
import {createWorld} from '../src/world/seed.js';
import {roomLayout} from '../src/shared/rooms.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeWaterSupply,completeWaterSupply,waterSupplyReason,waterReceiptId,waterDrunkToday,surfaceWaterId,isSurfaceWater,registerWaterGeography} from '../src/world/water-supply.js';
import {waterSupplyOpportunities} from '../src/server/water-supply-opportunities.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';

import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:32,tiles:Array(40*32).fill('grass'),entrance:{x:0,y:12}};w.plots=[];w.graves=[];
 const hall=w.buildings.find(b=>b.kind==='lodge')!;hall.at={x:16,y:6};hall.width=8;hall.height=6;hall.door={x:20,y:12};hall.residents=[];w.buildings=[hall];
 const spring={id:'supply-spring',kind:'spring' as const,at:{x:10,y:12},amount:12,max:12,regrowthDays:0,lastHarvest:0};w.resources=[spring];
 for(const r of w.residents){r.at={...hall.door};r.inside=null;r.roomAt=null;r.homeId=null;r.parents=[];r.guardianIds=[];r.inventory={wood:20,water:3};r.bornAt=w.minute-30*YEAR;r.health=r.energy=100;r.hunger=0;r.knownBuildings=[hall.id];r.knownResources=[spring.id];r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.activity=null;r.plan=null;}
 initializeCivic(w);initializeRooms(w);initializeWaterSupply(w);
 const [r,other,child]=w.residents;child.bornAt=w.minute-3*YEAR;child.guardianIds=[r.id];child.canDecide=false;
 return {w,hall,spring,r,other,child};
}
type Fields=WaterSupplyAction extends infer A?A extends WaterSupplyAction?Omit<A,'type'|'receiptId'>:never:never;
const action=(w:World,r:Resident,fields:Fields):WaterSupplyAction=>({type:'waterSupply',receiptId:waterReceiptId(w,r),...fields});
function atSlot(f:ReturnType<typeof fixture>,r=f.r,key='table'){r.at={...f.hall.door};r.inside=f.hall.id;r.roomAt={...roomLayout(f.w,f.hall).slots.find(s=>s.key===key)!.at};}
function bucket(f:ReturnType<typeof fixture>,r=f.r,amount=0,quality:WaterVessel['quality']='safe'){
 const v:WaterVessel={id:'fixture-vessel:'+r.id+':'+f.w.waterSupply!.vessels.length,ownerId:r.id,buildingId:null,capacity:6,amount,quality,createdAt:f.w.minute};f.w.waterSupply!.vessels.push(v);return v;
}
function queue(w:World,r:Resident,a:Action){const p={id:`water-test:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择供水',actions:[a]};assert.equal(submitPlan(w,p).ok,true);return p;}
function finish(w:World,r:Resident){let n=600;while(r.plan||r.activity){assert.ok(n--,'action finishes');stepWorld(w,1);}}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);assert.equal(r.lastFailure,null);}

test('legacy initialization and reload add no water, vessels, authority, thirst or extra body loss',()=>{
 const f=fixture(),{w,r}=f;delete w.waterSupply;const original=structuredClone(w),inventory=structuredClone(r.inventory),resources=structuredClone(w.resources),stores=structuredClone(w.civic!.stores);
 initializeWaterSupply(w);initializeWaterSupply(w);assert.deepEqual(r.inventory,inventory);assert.deepEqual(w.resources,resources);assert.deepEqual(w.civic!.stores,stores);assert.equal(w.waterSupply!.vessels.length,0);assert.equal(w.waterSupply!.surfaceSources.length,0);assert.equal('thirst'in r,false);
 const restored=JSON.parse(JSON.stringify(w)) as World;initializeWaterSupply(restored);assert.deepEqual(restored.waterSupply,w.waterSupply);
 stepWorld(w,60);stepWorld(original,60);assert.deepEqual(w.residents.map(p=>[p.hunger,p.energy,p.health]),original.residents.map(p=>[p.hunger,p.energy,p.health]));
});

test('normal model menu crafts a real empty bucket at the table, then spring filling and drinking use real finite water',()=>{
 const f=fixture(),{w,r,hall,spring}=f;const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>c.action.type==='waterSupply'&&c.action.operation==='craft');assert.ok(choice);
 const a=parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];const wood=r.inventory.wood!,start=w.minute;
 run(w,r,a);const v=w.waterSupply!.vessels[0];assert.equal(v.amount,0);assert.equal(r.inventory.wood,wood-2);assert.ok(w.minute>=start+30);assert.equal(r.inside,hall.id);assert.deepEqual(r.roomAt,roomLayout(w,hall).slots.find(s=>s.key==='table')!.at);
 r.inside=null;r.roomAt=null;r.at={x:12,y:12};run(w,r,action(w,r,{operation:'fillSpring',vesselId:v.id,sourceId:spring.id,quantity:3}));assert.equal(spring.amount,9);assert.equal(v.amount,3);
 atSlot(f);const location=structuredClone({at:r.at,inside:r.inside,roomAt:r.roomAt}),health=r.health;run(w,r,action(w,r,{operation:'drink',vesselId:v.id}));assert.equal(v.amount,2);assert.equal(waterDrunkToday(w,r.id),1);assert.deepEqual({at:r.at,inside:r.inside,roomAt:r.roomAt},location);assert.equal(r.health,health);
});

test('raw river water is surveyed once, collected, boiled at the actual kitchen and conserved into legacy uses',()=>{
 const f=fixture(),{w,r,hall}=f,v=bucket(f),at={x:8,y:16};w.map.tiles[at.y*w.map.width+at.x]='water';r.at={x:9,y:16};
 run(w,r,action(w,r,{operation:'survey',at}));const s=w.waterSupply!.surfaceSources[0];assert.equal(s.initial,24);assert.equal(v.amount,0);
 assert.match(waterSupplyReason(w,r,action(w,r,{operation:'survey',at}))!,/已经登记/);
 run(w,r,action(w,r,{operation:'fillSurface',vesselId:v.id,sourceId:s.id,quantity:3}));assert.equal(s.amount,21);assert.equal(v.amount,3);assert.equal(v.quality,'raw');
 for(const operation of ['drink','decant'] as const)assert.match(waterSupplyReason(w,r,action(w,r,{operation,vesselId:v.id}))!,/原水/);
 const wood=r.inventory.wood!,legacy=r.inventory.water!,start=w.minute;run(w,r,action(w,r,{operation:'boil',vesselId:v.id,buildingId:hall.id}));assert.equal(v.quality,'safe');assert.equal(v.amount,3);assert.equal(r.inventory.wood,wood-1);assert.ok(w.minute>=start+30);assert.deepEqual(r.roomAt,roomLayout(w,hall).slots.find(s=>s.key==='kitchen')!.at);
 run(w,r,action(w,r,{operation:'decant',vesselId:v.id}));assert.equal(v.amount,0);assert.equal(r.inventory.water,legacy+3);assert.equal(s.amount+v.amount+r.inventory.water!-legacy,24);
 const after=JSON.parse(JSON.stringify(w)) as World;initializeWaterSupply(after);assert.equal(after.waterSupply!.surfaceSources[0].amount,21);
});

test('saltwater, duplicate surveys and changed terrain cannot produce potable supply',()=>{
 const f=fixture(),{w,r,other}=f,coast={x:30,y:27};w.map.tiles[coast.y*w.map.width+coast.x]='water';r.at={x:29,y:27};
 assert.match(completeWaterSupply(w,r,action(w,r,{operation:'survey',at:coast}))!,/真实水岸/);assert.equal(w.waterSupply!.surfaceSources.length,0);
 const at={x:8,y:16};w.map.tiles[at.y*w.map.width+at.x]='water';r.at={x:9,y:16};assert.equal(completeWaterSupply(w,r,action(w,r,{operation:'survey',at})),null);
 other.at={x:7,y:16};assert.match(completeWaterSupply(w,other,action(w,other,{operation:'survey',at}))!,/已经登记/);assert.equal(w.waterSupply!.surfaceSources.length,1);
 const v=bucket(f);w.map.tiles[at.y*w.map.width+at.x]='grass';assert.match(completeWaterSupply(w,r,action(w,r,{operation:'fillSurface',sourceId:surfaceWaterId(at),vesselId:v.id,quantity:1}))!,/改变/);assert.equal(v.amount,0);
});

test('load, decant, finite capacity, foreign ownership and invalid quantities cannot duplicate water',()=>{
 const f=fixture(),{w,r,other}=f,v=bucket(f);const sum=()=>v.amount+(r.inventory.water??0);const initial=sum();
 assert.equal(completeWaterSupply(w,r,action(w,r,{operation:'load',vesselId:v.id,quantity:3})),null);assert.equal(sum(),initial);
 assert.equal(completeWaterSupply(w,r,action(w,r,{operation:'decant',vesselId:v.id})),null);assert.equal(sum(),initial);
 for(const quantity of [0,-1,1.2,Infinity,NaN,7])assert.match(completeWaterSupply(w,r,action(w,r,{operation:'load',vesselId:v.id,quantity}))!,/水量无效/);
 assert.match(completeWaterSupply(w,other,action(w,other,{operation:'drink',vesselId:v.id}))!,/自有/);
 v.amount=5;assert.match(completeWaterSupply(w,r,action(w,r,{operation:'load',vesselId:v.id,quantity:2}))!,/容量/);v.quality='raw';assert.match(completeWaterSupply(w,r,action(w,r,{operation:'load',vesselId:v.id,quantity:1}))!,/混装/);
});

test('blocked original spring route fails without payment; a physically reachable alternate spring works in every season',()=>{
 for(const day of [0,28,56,84]){
  const f=fixture(),{w,r,spring}=f,v=bucket(f);w.minute=day*DAY+600;r.bornAt=w.minute-30*YEAR;r.at={x:12,y:12};
  for(const at of [{x:9,y:12},{x:11,y:12},{x:10,y:11},{x:10,y:13}])w.map.tiles[at.y*w.map.width+at.x]='cliff';
  const a=action(w,r,{operation:'fillSpring',vesselId:v.id,sourceId:spring.id,quantity:2}),p={id:'blocked',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'取水',actions:[a]};
  assert.match(planStartError(w,p)!,/实际看到/);queue(w,r,a);finish(w,r);assert.match(r.lastFailure!,/实际看到/);assert.equal(v.amount,0);assert.equal(spring.amount,12);
  const alternate={...spring,id:'alternate',at:{x:14,y:12}};w.resources.push(alternate);r.knownResources.push(alternate.id);
  run(w,r,action(w,r,{operation:'fillSpring',vesselId:v.id,sourceId:alternate.id,quantity:2}));assert.equal(v.amount,2);assert.equal(alternate.amount,10);assert.equal(spring.amount,12);
 }
});

test('a route blocked mid-trip and an indoor door-only boil do not consume stock or fuel',()=>{
 const f=fixture(),{w,r,spring,hall}=f,v=bucket(f);r.at={x:14,y:12};queue(w,r,action(w,r,{operation:'fillSpring',vesselId:v.id,sourceId:spring.id,quantity:2}));stepWorld(w,1);const next=r.activity!.path[0];assert.ok(next);w.map.tiles[next.y*w.map.width+next.x]='cliff';finish(w,r);assert.match(r.lastFailure!,/实际看到/);assert.equal(spring.amount,12);assert.equal(v.amount,0);
 v.amount=2;v.quality='raw';r.at={...hall.door};r.inside=null;const wood=r.inventory.wood!;assert.match(completeWaterSupply(w,r,action(w,r,{operation:'boil',vesselId:v.id,buildingId:hall.id}))!,/灶台/);assert.equal(r.inventory.wood,wood);assert.equal(v.quality,'raw');
});

test('kitchen damage, permission loss, missing fuel and a competing work claim stop boiling',()=>{
 for(const change of ['damage','permission','fuel','claim'] as const){
  const f=fixture(),{w,r,hall,other}=f,v=bucket(f,r,2,'raw');atSlot(f,r,'kitchen');const a=action(w,r,{operation:'boil',vesselId:v.id,buildingId:hall.id});queue(w,r,a);stepWorld(w,1);const wood=r.inventory.wood!;
  if(change==='damage')hall.condition=0;else if(change==='permission')hall.ownerId=other.id;else if(change==='fuel')r.inventory.wood=0;else {
   atSlot(f,other,'kitchen');other.inventory={turnip:6,water:6};queue(w,other,{type:'cook',quantity:3,buildingId:hall.id});stepWorld(w,1);
   // The earlier boil owns the shared kitchen; the later competing cook must fail.
   assert.match(other.lastFailure!,/工位/);finish(w,r);assert.equal(v.quality,'safe');continue;
  }
  finish(w,r);assert.ok(r.lastFailure);assert.equal(v.quality,'raw');assert.equal(v.amount,2);assert.equal(r.inventory.wood,change==='fuel'?0:wood);
 }
});

test('guardians serve only their physically present consenting 1–5 year old children, never by doorway coincidence',()=>{
 const f=fixture(),{w,r,other,child}=f,v=bucket(f,r,6);atSlot(f);child.at={...r.at};child.inside=r.inside;child.roomAt={...r.roomAt!};
 const service=()=>action(w,r,{operation:'serveChild',vesselId:v.id,targetId:child.id});const a=service();const health=child.health;run(w,r,a);assert.equal(v.amount,5);assert.equal(waterDrunkToday(w,child.id),1);assert.equal(child.health,health);
 child.refusesCare=true;assert.match(completeWaterSupply(w,r,service())!,/权限/);child.refusesCare=false;
 child.guardianIds=[other.id];assert.match(completeWaterSupply(w,r,service())!,/权限/);child.guardianIds=[r.id];
 child.inside=null;assert.match(completeWaterSupply(w,r,service())!,/位置/);child.inside=r.inside;child.roomAt={x:1,y:4};assert.match(completeWaterSupply(w,r,service())!,/位置/);child.roomAt={...r.roomAt!};
 child.bornAt=w.minute-.2*YEAR;assert.match(completeWaterSupply(w,r,service())!,/1至5/);child.bornAt=w.minute-6*YEAR;assert.match(completeWaterSupply(w,r,service())!,/1至5/);
 assert.equal(v.amount,5);assert.equal(w.waterSupply!.receipts.length,1);
});

test('guardian withdrawal during service stops without water loss and dead/outside owners keep their vessels',()=>{
 const f=fixture(),{w,r,child}=f,v=bucket(f,r,4);child.at={...r.at};queue(w,r,action(w,r,{operation:'serveChild',vesselId:v.id,targetId:child.id}));stepWorld(w,1);child.guardianIds=[];finish(w,r);assert.ok(r.lastFailure);assert.equal(v.amount,4);
 for(const status of ['dead','outside'] as const){r.status=status==='dead'?'dead':'alive';r.residency=status==='outside'?'outside':'resident';assert.ok(waterSupplyReason(w,r,action(w,r,{operation:'drink',vesselId:v.id})));initializeWaterSupply(w);assert.equal(v.ownerId,r.id);assert.equal(v.amount,4);}
});

test('donated vessels serve visitors at real tables, conserve stock and never unlock unrelated public water',()=>{
 const f=fixture(),{w,r,other,hall}=f,v=bucket(f,r,6);w.civic!.stores[hall.id]={water:50};w.economy!.treasuryStock.water=50;
 atSlot(f);assert.equal(completeWaterSupply(w,r,action(w,r,{operation:'donate',vesselId:v.id,buildingId:hall.id})),null);assert.equal(v.ownerId,'commons');assert.equal(v.buildingId,hall.id);assert.equal(v.amount,6);other.residency='visitor';other.bornAt=w.minute-6*YEAR;other.inventory={};
 const a=action(w,other,{operation:'drinkPublic',vesselId:v.id,buildingId:hall.id});assert.match(completeWaterSupply(w,other,a)!,/桌台/);run(w,other,a);assert.equal(v.amount,5);assert.equal(waterDrunkToday(w,other.id),1);assert.equal(w.civic!.stores[hall.id].water,50);assert.equal(w.economy!.treasuryStock.water,50);
 assert.equal(completeWaterSupply(w,other,action(w,other,{operation:'drinkPublic',vesselId:v.id,buildingId:hall.id})),null);assert.match(completeWaterSupply(w,other,action(w,other,{operation:'drinkPublic',vesselId:v.id,buildingId:hall.id}))!,/24小时/);assert.equal(v.amount,4);
 assert.match(waterSupplyReason(w,other,action(w,other,{operation:'donate',vesselId:v.id,buildingId:hall.id}))!,/成年人/);

});

test('public allowance spans vessels and lodges across persistence and expires without refill',()=>{
 const f=fixture(),{w,r,other,hall}=f,v=bucket(f,r,6);atSlot(f);completeWaterSupply(w,r,action(w,r,{operation:'donate',vesselId:v.id,buildingId:hall.id}));atSlot(f,other);
 for(let i=0;i<2;i++)assert.equal(completeWaterSupply(w,other,action(w,other,{operation:'drinkPublic',vesselId:v.id,buildingId:hall.id})),null);
 const second={...hall,id:'second-lodge'};w.buildings.push(second);other.knownBuildings.push(second.id);const v2={...v,id:'second-public',buildingId:second.id,amount:6};w.waterSupply!.vessels.push(v2);
 assert.match(waterSupplyReason(w,other,action(w,other,{operation:'drinkPublic',vesselId:v2.id,buildingId:second.id}))!,/24小时/);
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();initializeWaterSupply(restored);assert.equal(waterDrunkToday(restored,restored.residents[1].id),2);
 w.minute+=DAY;assert.equal(waterSupplyReason(w,other,action(w,other,{operation:'drinkPublic',vesselId:v.id,buildingId:hall.id})),null);assert.equal(v.amount,4);assert.equal(v2.amount,6);
});

test('same receipt is idempotent after reload, altered payload is rejected, and competing fills cannot spend the last unit twice',()=>{
 const f=fixture(),{w,r,other,spring}=f,v=bucket(f),v2=bucket(f,other);spring.amount=1;r.at={x:11,y:12};other.at={x:9,y:12};
 const a=action(w,r,{operation:'fillSpring',vesselId:v.id,sourceId:spring.id,quantity:1}),b=action(w,other,{operation:'fillSpring',vesselId:v2.id,sourceId:spring.id,quantity:1});assert.equal(completeWaterSupply(w,r,a),null);assert.match(completeWaterSupply(w,other,b)!,/不足/);assert.equal(spring.amount,0);assert.equal(v.amount,1);assert.equal(v2.amount,0);
 const restored=JSON.parse(JSON.stringify(w)) as World,actor=restored.residents[0];initializeWaterSupply(restored);assert.equal(completeWaterSupply(restored,actor,a),null);assert.equal(restored.waterSupply!.vessels[0].amount,1);assert.equal(restored.waterSupply!.receipts.length,1);
 assert.match(completeWaterSupply(restored,actor,{...a,operation:'drink'} as WaterSupplyAction)!,/不对应/);assert.equal(restored.waterSupply!.vessels[0].amount,1);
});

test('normal menus expose local supply steps but reveal no distant public stock or private vessel',()=>{
 const f=fixture(),{w,r,other,hall,spring}=f,v=bucket(f,r,3),privateVessel=bucket(f,other,6);r.at={x:12,y:12};
 let choices=waterSupplyOpportunities(w,r);assert.ok(choices.some(c=>c.action.type==='waterSupply'&&c.action.operation==='fillSpring'));assert.ok(choices.some(c=>c.action.type==='waterSupply'&&c.action.operation==='drink'));assert.ok(!choices.some(c=>'vesselId'in c.action&&c.action.vesselId===privateVessel.id));
 atSlot(f,other);completeWaterSupply(w,other,action(w,other,{operation:'donate',vesselId:privateVessel.id,buildingId:hall.id}));r.at={x:1,y:1};choices=waterSupplyOpportunities(w,r);assert.ok(!choices.some(c=>c.action.type==='waterSupply'&&c.action.operation==='drinkPublic'));assert.ok(!choices.some(c=>c.action.type==='waterSupply'&&c.action.operation==='fillSpring'));assert.equal(spring.amount,12);
 r.at={...hall.door};const seen=new Set<string>();for(let i=0;i<8;i++){w.minute=600+i*30;for(const c of decisionChoices(decisionContext(w,r)))if(c.action.type==='waterSupply')seen.add(c.action.operation);}assert.ok(seen.has('drink'));assert.ok(seen.has('drinkPublic'));assert.ok(seen.has('donate'));assert.ok(seen.has('refillPublic')===false,'full public vessel cannot be overfilled');assert.equal(v.amount,3);
});

test('refilling an already donated bucket conserves quantities and guards capacity at completion',()=>{
 const f=fixture(),{w,r,hall}=f,donated=bucket(f,r,2),carried=bucket(f,r,5);atSlot(f);completeWaterSupply(w,r,action(w,r,{operation:'donate',vesselId:donated.id,buildingId:hall.id}));
 const a=action(w,r,{operation:'refillPublic',vesselId:carried.id,publicVesselId:donated.id,buildingId:hall.id,quantity:3});assert.equal(completeWaterSupply(w,r,a),null);assert.equal(donated.amount,5);assert.equal(carried.amount,2);
 assert.match(completeWaterSupply(w,r,action(w,r,{operation:'refillPublic',vesselId:carried.id,publicVesselId:donated.id,buildingId:hall.id,quantity:2}))!,/容量/);assert.equal(donated.amount+carried.amount,7);
});

test('multi-step water choices get consecutive receipts once, survive reload, and reject stale replays',()=>{
 const f=fixture(),{w,r}=f,v=bucket(f,r,1),choices=waterSupplyOpportunities(w,r),load=choices.find(c=>c.action.type==='waterSupply'&&c.action.operation==='load')!,drink=choices.find(c=>c.action.type==='waterSupply'&&c.action.operation==='drink')!;
 const decision=parseChoice(JSON.stringify({steps:[{choice:load.id},{choice:drink.id}]}),choices,3);
 const p={id:'two-water',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision};
 assert.equal(submitPlan(w,p).ok,true);while(w.waterSupply!.receipts.length===0)stepWorld(w,1);assert.equal(v.amount,4);assert.equal(r.plan!.actions[0].type,'waterSupply');assert.equal((r.plan!.actions[0] as WaterSupplyAction).receiptId,`water:${r.id}:1`);
 const saved=JSON.parse(JSON.stringify(w)) as World,person=saved.residents[0];finish(saved,person);assert.equal(person.lastFailure,null);assert.equal(saved.waterSupply!.vessels[0].amount,3);assert.equal(saved.waterSupply!.receipts.length,2);
 assert.equal(submitPlan(saved,p).ok,true);assert.equal(saved.waterSupply!.receipts.length,2);assert.equal(person.plan,null);
 const stale=submitPlan(saved,{...p,id:'stale-water',actorRevision:person.revision,createdAt:saved.minute});assert.equal(stale.ok,false);assert.match(stale.error!,/旧回执/);
});

test('water geography remains freshwater or saltwater through append-only map expansion and reload',()=>{
 const f=fixture(),{w}=f,coast={x:30,y:27},river={x:10,y:15};w.map.tiles[coast.y*w.map.width+coast.x]='water';w.map.tiles[river.y*w.map.width+river.x]='water';assert.equal(isSurfaceWater(w,coast),false);assert.equal(isSurfaceWater(w,river),true);
 const tiles:Array<World['map']['tiles'][number]>=Array(80*64).fill('grass');for(let y=0;y<32;y++)for(let x=0;x<40;x++)tiles[y*80+x]=w.map.tiles[y*40+x];registerWaterGeography(w,80,64);w.map={...w.map,width:80,height:64,tiles};
 assert.equal(isSurfaceWater(w,coast),false);assert.equal(isSurfaceWater(w,river),true);const saved=JSON.parse(JSON.stringify(w)) as World;initializeWaterSupply(saved);assert.equal(isSurfaceWater(saved,coast),false);
});

test('leased kitchen and table work honor actual windows including the final work minute',()=>{
 for(const operation of ['boil','craft'] as const){
  const f=fixture(),{w,r,other,hall}=f,v=bucket(f,r,2,'raw');hall.kind='workshop';hall.ownerId=other.id;
  const lease={id:'water-lease',buildingId:hall.id,ownerId:other.id,tenantId:r.id,terms:{days:1,rentPerDay:0,deposit:0,station:operation==='boil'?'kitchen' as const:'table' as const,startMinute:600,durationMinutes:30},offeredAt:w.minute-1,offerExpiresAt:w.minute+DAY,acceptedAt:w.minute,endsAt:w.minute+DAY,status:'active' as const,endedAt:null,reason:null,account:'fixture-water-lease',prepaid:0,paid:0,refunded:0};w.economy!.leases=[lease];atSlot(f,r,operation==='boil'?'kitchen':'table');
  const a=action(w,r,operation==='boil'?{operation,vesselId:v.id,buildingId:hall.id}:{operation,buildingId:hall.id});run(w,r,a);assert.equal(w.minute,630);assert.equal(operation==='boil'?v.quality:w.waterSupply!.vessels.length,operation==='boil'?'safe':2);
  const next=action(w,r,operation==='boil'?{operation,vesselId:v.id,buildingId:hall.id}:{operation,buildingId:hall.id});assert.match(waterSupplyReason(w,r,next)!,/时段/);
 }
});

test('water steps separated by another action retain sequence, and interrupted second work does not spend twice',()=>{
 for(const interrupted of [false,true]){
  const f=fixture(),{w,r}=f,v=bucket(f,r,3),drink=action(w,r,{operation:'drink',vesselId:v.id});
  const p={id:'separated-water:'+interrupted,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'两次饮水之间停留',actions:[drink,{type:'wait' as const,minutes:2},drink]};assert.equal(submitPlan(w,p).ok,true);
  for(let ticks=0;w.waterSupply!.receipts.length===0;ticks++){assert.ok(ticks<30,'first water step completes');stepWorld(w,1);}
  if(interrupted){v.amount=0;finish(w,r);assert.match(r.lastFailure!,/安全水/);assert.equal(w.waterSupply!.receipts.length,1);v.amount=1;run(w,r,action(w,r,{operation:'drink',vesselId:v.id}));assert.equal(v.amount,0);}
  else{finish(w,r);assert.equal(r.lastFailure,null);assert.equal(v.amount,1);}
  assert.equal(w.waterSupply!.receipts.length,2);assert.equal(waterDrunkToday(w,r.id),2);
 }
});

test('a guardian on shore cannot serve an onboard or medically carried child from matching map coordinates',()=>{
 const f=fixture(),{w,r,other,child,hall}=f,v=bucket(f,r,2);child.at={...r.at};const a=action(w,r,{operation:'serveChild',vesselId:v.id,targetId:child.id});
 w.ferries={boats:[],builds:[],trips:[{id:'test-trip',boatId:'test-boat',operatorId:other.id,sourceId:'source',destinationId:'destination',headingId:'destination',fare:0,departAt:w.minute,expiresAt:w.minute+60,capacity:3,phase:'posted',seats:[],aboard:[child.id],pilotId:other.id,path:[],progress:0,returned:false,arrivedAt:null,reason:null}],nextSerial:0,totals:{built:0,voyages:0,fares:0,refunds:0}};
 assert.match(completeWaterSupply(w,r,a)!,/运输/);assert.equal(v.amount,2);w.ferries.trips=[];
 initializeHealth(w);w.health!.transports.push({id:'test-transport',carrierId:other.id,patientId:child.id,buildingId:hall.id,bed:0,basis:'guardian',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});assert.match(completeWaterSupply(w,r,a)!,/运输/);assert.equal(v.amount,2);
});
