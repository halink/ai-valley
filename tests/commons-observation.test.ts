import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {roomLayout,roomPath} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeCommons,commonsFoodOptions,hasTimelyCommonsFood} from '../src/world/commons.js';
import {initializeFood} from '../src/world/food.js';
import {reserveContainer} from '../src/world/public-food-reserves.js';
import {initializeRooms} from '../src/world/rooms.js';
import {residentFoodCoverage} from '../src/world/food-coverage.js';
import {findPath} from '../src/world/navigation.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

// Synthetic geometry reproduces the audited seed-5401 four-tile sight leak.
// No runtime saves, models, network or automatic resident decisions are used.
function fixture(stock=3,reserveStock=0){
 const w=createWorld(5401);w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};
 w.resources=[];w.plots=[];w.graves=[];w.events=[];w.estates=[];
 const b=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 Object.assign(b,{at:{x:12,y:6},width:4,height:4,door:{x:14,y:10},residents:[],capacity:2});w.buildings=[b];
 w.residents=w.residents.slice(0,2);const [r,other]=w.residents;
 for(const p of w.residents)Object.assign(p,{at:{...b.door},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-10*YEAR,health:100,energy:100,hunger:30,knownBuildings:[b.id],knownPeople:[],knownResources:[],memories:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,lastFailure:null});
 other.at={x:25,y:20};
 initializeCivic(w);initializeRooms(w);initializeCommons(w);
 w.civic!.stores={[b.id]:{turnip:stock}};w.civic!.budgets=[];w.civic!.proposals=[];
 w.civic!.reserves=[{id:'observation-reserve',proposalId:'old-public-notice',buildingId:b.id,item:'turnip',quantityLimit:20,unitPrice:0,dailyNutrition:40,startsAt:0,expiresAt:w.minute+2*DAY,status:'active',supplyAccount:'reserve-observation',suppliesLimit:0,spent:0,refunded:0,inventory:{turnip:reserveStock},stocked:reserveStock,purchased:0,opened:reserveStock,withdrawn:0,receipts:[]}];
 w.economy!.treasuryStock={turnip:stock+reserveStock};initializeFood(w);
 return {w,b,r,other};
}
const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
const pickup=(a:Action)=>a.type==='commons'&&a.operation==='takeFood';
const inspect=(a:Action)=>a.type==='commons'&&a.operation==='inspectFood';
function visit(f:ReturnType<typeof fixture>,a:Action){return a.type==='move'&&a.to.x===f.b.door.x&&a.to.y===f.b.door.y;}
function selected(w:World,r:Resident,match:(a:Action)=>boolean){const p=prepared(w,r),c=p.choices.find(c=>match(c.action));assert.ok(c,'choice must survive the actual final numbered menu');assert.ok(p.messages.some(m=>m.content.includes(c.id+'. '+c.label)));return parseChoice(JSON.stringify({choice:c.id}),p.choices).actions[0];}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`commons-observation:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人明确选择查看或领取并另选进食',actions:[a]});}
function finish(w:World,r:Resident){let n=500;while(r.activity||r.plan){assert.ok(n-->0,'explicit choice finishes within a bounded number of ticks');stepWorld(w,1);}}
function hide(f:ReturnType<typeof fixture>){f.r.at={x:10,y:10};f.w.map.tiles[10*f.w.map.width+12]='cliff';}
function trap(w:World,r:Resident){for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(r.at.y+dy)*w.map.width+r.at.x+dx]='cliff';}
function table(f:ReturnType<typeof fixture>,r=f.r){r.at={...f.b.door};r.inside=f.b.id;r.roomAt={...roomLayout(f.w,f.b).slots.find(s=>s.key==='table')!.at};}
function noVerifiedFood(w:World,r:Resident){assert.equal(commonsFoodOptions(w,r).length,0);assert.equal(prepared(w,r).choices.some(c=>pickup(c.action)),false);assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);assert.equal(residentFoodCoverage(w,r).sourceLabel,null);assert.equal(hasTimelyCommonsFood(w,r),false);}

test('seed 5401 geometry: cliff-hidden public stores and reserves cannot change the actual menu or prompt',()=>{
 const f=fixture(3,3),{w,r,b}=f;hide(f);
 assert.equal(Math.abs(r.at.x-b.door.x)+Math.abs(r.at.y-b.door.y),4);
 assert.ok(findPath(w,r.at,b.door),'a detour is not proof of sight');
 prepared(w,r); // Register legacy lazy context definitions before the read-only check.
 const before=structuredClone(w),p=prepared(w,r);noVerifiedFood(w,r);assert.deepEqual(w,before,'all observation and prediction is read-only');
 for(const quantity of [1,0,99]){
  w.civic!.stores[b.id].turnip=quantity;w.civic!.reserves![0].inventory.turnip=quantity;w.economy!.treasuryStock.turnip=2*quantity;
  for(const id of ['public:'+b.id,reserveContainer('observation-reserve')])for(const lot of w.food!.lots[id]?.turnip??[])lot.quantity=quantity;
  assert.deepEqual(prepared(w,r),p,'unseen quantity must not affect numbered choices or prompt text');noVerifiedFood(w,r);
 }
});

test('known hidden address remains a stock-independent visit, with pickup only after explicit travel',()=>{
 for(const stock of [0,3]){
  const f=fixture(stock),{w,r,b}=f;hide(f);const move=selected(w,r,a=>visit(f,a));
  assert.equal(queue(w,r,move).ok,true);finish(w,r);assert.equal(r.lastFailure,null);assert.deepEqual(r.at,b.door);assert.equal(r.inventory.turnip,undefined);assert.equal(w.civic!.stores[b.id].turnip,stock);
  if(!stock){noVerifiedFood(w,r);continue;}
  const take=selected(w,r,pickup);assert.equal(queue(w,r,take).ok,true);stepWorld(w,1);assert.equal(r.inventory.turnip,undefined);finish(w,r);
  assert.equal(r.lastFailure,null);assert.equal(r.inventory.turnip,1);assert.equal(w.civic!.stores[b.id].turnip,stock-1);assert.ok(r.hunger>30,'pickup is not eating');
  const eat=selected(w,r,a=>a.type==='eat'&&a.item==='turnip');assert.equal(queue(w,r,eat).ok,true);finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.inventory.turnip,0);assert.ok(r.hunger<30);
 }
});

test('a completely trapped actor has neither verified commons food nor an impossible pickup or table inspection',()=>{
 const f=fixture(3,3);f.r.at={x:10,y:10};trap(f.w,f.r);assert.equal(findPath(f.w,f.r.at,f.b.door),null);noVerifiedFood(f.w,f.r);
 assert.equal(prepared(f.w,f.r).choices.some(c=>inspect(c.action)),false);
});

test('indoor table inspection uses actual room sight and route rather than the outdoor door coordinate',()=>{
 const f=fixture(),{w,r,b}=f,layout=roomLayout(w,b),at=layout.slots.find(s=>s.key==='table')!.at;
 table(f);assert.ok(prepared(w,r).choices.some(c=>pickup(c.action)));assert.ok(residentFoodCoverage(w,r).reachableNutrition>0);
 r.roomAt={...layout.slots.find(s=>s.key==='kitchen')!.at};assert.ok(roomPath(layout,r.roomAt,at),'furniture permits a detour but blocks direct sight');noVerifiedFood(w,r);
 r.roomAt={...layout.entry};assert.ok(prepared(w,r).choices.some(c=>pickup(c.action)),'entry below table has clear sight and an actual route');
 for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const body=structuredClone(f.other);body.id=`table-block:${dx}:${dy}`;body.status='dead';body.inside=b.id;body.roomAt={x:at.x+dx,y:at.y+dy};body.body={reservedBy:null,carriedBy:null,storedAt:b.id};w.residents.push(body);}
 assert.equal(roomPath(roomLayout(w,b),r.roomAt,at),null);noVerifiedFood(w,r);
});

test('stale public notices do not turn a hidden reserve into verified live stock, including SQLite reload',()=>{
 const f=fixture(0,3),{w,r}=f;hide(f);r.memories.push({eventId:'old-public-notice',receivedAt:w.minute-DAY,source:'heard',text:'公共共屋曾公告有三份芜菁储备；这是过去的消息。'});
 const store=new WorldStore(':memory:');try{store.commit(w,null);const restored=store.load()!,actor=restored.residents.find(p=>p.id===r.id)!;noVerifiedFood(restored,actor);const p=prepared(restored,actor);restored.civic!.reserves![0].inventory.turnip=0;assert.deepEqual(prepared(restored,actor),p);}finally{store.close();}
});

test('dynamic obstruction invalidates a saved pickup without consuming or teleporting food',()=>{
 const f=fixture(),{w,r,b}=f;r.at={x:10,y:10};const a=selected(w,r,pickup);trap(w,r);const start={...r.at},stock=w.civic!.stores[b.id].turnip;
 noVerifiedFood(w,r);const result=queue(w,r,a);if(result.ok)finish(w,r);
 assert.ok(!result.ok||r.lastFailure);assert.deepEqual(r.at,start);assert.equal(r.inventory.turnip,undefined);assert.equal(w.civic!.stores[b.id].turnip,stock);assert.equal(w.commons!.receipts.length,0);
});

test('competing final-menu pickups after SQLite reload cannot duplicate the final real unit',()=>{
 for(const reserve of [false,true]){
  const f=fixture(reserve?0:1,reserve?1:0),{w,r,other,b}=f;other.at={...b.door};const a=selected(w,r,pickup),second=selected(w,other,pickup);
  assert.equal(queue(w,r,a).ok,true);assert.equal(queue(w,other,second).ok,true);
  const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!,[first,last]=loaded.residents;finish(loaded,first);finish(loaded,last);
   assert.equal((first.inventory.turnip??0)+(last.inventory.turnip??0),1);assert.equal(loaded.commons!.receipts.length,1);assert.equal(loaded.economy!.treasuryStock.turnip,0);assert.ok([first,last].some(p=>p.lastFailure));
  }finally{store.close();}
 }
});

test('verified food prediction includes collection and later consumption, preserving original batch expiry',()=>{
 const f=fixture(1),{w,r,b}=f;const lot=w.food!.lots['public:'+b.id].turnip![0],expiry=lot.expiresAt;
 const before=structuredClone(w),coverage=residentFoodCoverage(w,r);assert.ok(coverage.collectionMinutes!>5);assert.equal(coverage.reachableNutrition,20);assert.equal(hasTimelyCommonsFood(w,r),true);assert.deepEqual(w,before);
 lot.expiresAt=w.minute+2;assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);assert.equal(hasTimelyCommonsFood(w,r),false);lot.expiresAt=expiry;
 const a=selected(w,r,pickup);assert.equal(queue(w,r,a).ok,true);finish(w,r);assert.equal(r.lastFailure,null);assert.equal(w.food!.lots['person:'+r.id].turnip![0].expiresAt,expiry);assert.ok(r.hunger>30);
 w.food!.lots['person:'+r.id].turnip![0].expiresAt=w.minute+1;const eat=selected(w,r,a=>a.type==='eat'&&a.item==='turnip');assert.equal(queue(w,r,eat).ok,true);finish(w,r);assert.ok(r.lastFailure);assert.equal(r.inventory.turnip,0);assert.ok(r.hunger>=30,'expiry during eating must not count as consumed nutrition');
});


test('explicit indoor inspection reaches the real table without taking food, consuming allowance or satisfying hunger',()=>{
 const f=fixture(1,1),{w,r,b}=f;r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='kitchen')!.at};
 noVerifiedFood(w,r);const a=selected(w,r,inspect),receipts=w.commons!.receipts.length,stock=w.civic!.stores[b.id].turnip,reserveStock=w.civic!.reserves![0].inventory.turnip;
 const menu=prepared(w,r);w.civic!.stores[b.id].turnip=0;w.civic!.reserves![0].inventory.turnip=0;assert.deepEqual(prepared(w,r),menu,'inspection availability cannot depend on hidden shelf quantities');w.civic!.stores[b.id].turnip=stock;w.civic!.reserves![0].inventory.turnip=reserveStock;
 assert.equal(queue(w,r,a).ok,true);finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.inside,b.id);assert.deepEqual(r.roomAt,roomLayout(w,b).slots.find(s=>s.key==='table')!.at);
 assert.equal(r.inventory.turnip,undefined);assert.equal(w.civic!.stores[b.id].turnip,stock);assert.equal(w.civic!.reserves![0].inventory.turnip,reserveStock);assert.equal(w.commons!.receipts.length,receipts);assert.ok(r.hunger>=30);
 assert.ok(prepared(w,r).choices.some(c=>pickup(c.action)));assert.ok(residentFoodCoverage(w,r).reachableNutrition>0);
});


test('hidden exterior inspection visits the real table independently of whether any food exists',()=>{
 for(const stock of [0,3]){
  const f=fixture(stock),{w,r,b}=f;hide(f);noVerifiedFood(w,r);const a=selected(w,r,inspect);
  assert.equal(queue(w,r,a).ok,true);finish(w,r);assert.equal(r.lastFailure,null);assert.deepEqual(r.at,b.door);assert.equal(r.inside,b.id);assert.deepEqual(r.roomAt,roomLayout(w,b).slots.find(s=>s.key==='table')!.at);
  assert.equal(r.inventory.turnip,undefined);assert.equal(w.civic!.stores[b.id].turnip,stock);assert.equal(w.commons!.receipts.length,0);assert.ok(r.hunger>=30);
  assert.equal(prepared(w,r).choices.some(c=>pickup(c.action)),stock>0);
 }
});

test('an indoor obstruction on the next saved path step stops an underway inspection or pickup',()=>{
 for(const operation of ['inspectFood','takeFood'] as const){
  const f=fixture(3),{w,r,b,other}=f;r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key=== (operation==='inspectFood'?'kitchen':'table'))!.at};
  if(operation==='takeFood')r.roomAt={...roomLayout(w,b).entry};
  const a=selected(w,r,operation==='inspectFood'?inspect:pickup);assert.equal(queue(w,r,a).ok,true);stepWorld(w,1);
  assert.ok(r.activity?.room?.path.length,'choice is underway with a saved indoor path');
  const next={...r.activity.room.path[0]},previous={...r.roomAt!};assert.notDeepEqual(previous,next);
  const body=structuredClone(other);body.id='dynamic-next-step-body';body.status='dead';body.at={...b.door};body.inside=b.id;body.roomAt={...next};body.body={reservedBy:null,carriedBy:null,storedAt:b.id};w.residents.push(body);
  assert.ok(roomLayout(w,b).blocked.some(p=>p.x===next.x&&p.y===next.y));
  let ticks=500;while(r.activity||r.plan){assert.ok(ticks-->0);stepWorld(w,1);assert.notDeepEqual(r.roomAt,next,'never crosses a newly blocked saved room step');}
  assert.ok(r.lastFailure);assert.deepEqual(r.roomAt,previous);assert.equal(r.inventory.turnip,undefined);assert.equal(w.civic!.stores[b.id].turnip,3);assert.equal(w.commons!.receipts.length,0);
 }
});
