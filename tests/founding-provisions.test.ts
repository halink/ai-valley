import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {goods,itemKeys} from '../src/shared/items.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {advanceFood,foodValue,initializeFood} from '../src/world/food.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {findPath} from '../src/world/navigation.js';
import {physiology} from '../src/world/physiology.js';
import {DAY} from '../src/world/time.js';

test('each new frontier founder personally carries at least three days of real, unexpired nutrition',()=>{
 for(const seed of [5401,12,937]){
  const w=createFrontierWorld(seed),through=w.minute+3*DAY;
  assert.equal(w.residents.length,9);
  assert.equal(w.food!.registeredAt,w.minute);
  let personDays=0;
  const counted=new Set<string>();
  for(const r of w.residents){
   const container='person:'+r.id;
   assert.ok(!counted.has(container),'a physical stock is counted only once');
   counted.add(container);
   const daily=physiology(w,r).hungerPerMinute*DAY;
   let nutrition=0;
   for(const item of itemKeys.filter(item=>goods[item].food>0)){
    const quantity=r.inventory[item]??0;
    if(!quantity)continue;
    const lots=w.food!.lots[container]?.[item]??[];
    assert.equal(lots.reduce((sum,lot)=>sum+lot.quantity,0),quantity);
    assert.ok(lots.every(lot=>lot.producedAt===w.minute&&lot.expiresAt>=through),`${r.name}'s ${item} must remain edible throughout the first three days`);
    nutrition+=foodValue(w,container,item,quantity);
   }
   assert.ok(nutrition>=daily*3,`${r.name} has ${nutrition/daily} days`);
   personDays+=nutrition/daily;
  }
  // No public accounting balance, other resident's pantry, animal product,
  // unharvested crop, wild berry, shop or incoming shipment enters this sum.
  assert.ok(personDays>=27,`${personDays} person-days across nine independent inventories`);
 }
});

test('all nine founders, including children, can eat their provisions through the normal decision menu',()=>{
 const w=createFrontierWorld();w.clock.paused=false;
 const initial=w.residents.map(r=>({...r.inventory}));
 for(const r of w.residents){
  r.hunger=70;
  const choice=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='eat'&&c.action.item==='meal');
  assert.ok(choice,`${r.name} can select their own meal`);
  const result=submitPlan(w,{id:'founding-meal:'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
   definition:w.activeDefinitions['action/routine'],intention:'本人选择吃随身口粮',actions:[choice.action]});
  assert.ok(result.ok,result.error);
 }
 for(let n=0;n<60&&w.residents.some(r=>r.plan||r.activity);n++)stepWorld(w,1);
 for(const [index,r] of w.residents.entries()){
  assert.equal(r.lastFailure,null,r.name);
  assert.equal(r.plan,null);assert.equal(r.activity,null);
  assert.equal(r.inventory.meal,initial[index].meal!-1);
  assert.equal(r.inventory.berry,initial[index].berry);
  assert.equal(r.inventory.turnip,initial[index].turnip);
  assert.ok(!w.food!.lots['person:'+r.id]?.meal?.length);
  assert.ok(r.hunger<40,'actual nutrition lowers hunger');
 }
});

test('founding food ages from arrival and still spoils after serialization without replenishment',()=>{
 const original=createFrontierWorld(),arrival=original.minute;
 const w=JSON.parse(JSON.stringify(original)) as typeof original;
 const r=w.residents[0],key='person:'+r.id;
 w.minute=arrival+2*DAY;initializeFood(w);
 assert.equal(w.food!.lots[key].meal![0].producedAt,arrival);
 assert.equal(w.food!.lots[key].meal![0].expiresAt,arrival+3*DAY);
 w.minute=arrival+3*DAY;advanceFood(w);
 assert.equal(r.inventory.meal,0);assert.equal(r.inventory.turnip,5);
 w.minute=arrival+4*DAY;advanceFood(w);
 assert.equal(r.inventory.berry,0);assert.equal(r.inventory.turnip,5);
 w.minute=arrival+14*DAY;advanceFood(w);
 assert.equal(r.inventory.turnip,0);
 const spoiled=structuredClone(w.food!.spoiled);
 initializeFood(w);advanceFood(w);
 assert.deepEqual(w.food!.spoiled,spoiled);
 assert.equal(r.inventory.meal,0);assert.equal(r.inventory.berry,0);assert.equal(r.inventory.turnip,0);
});

test('loading and restarting an existing frontier preserves depleted provisions, identities, property and time',()=>{
 const w=createFrontierWorld();
 // Reconstruct the prior opening stock, then consume one person's entire supply.
 for(const r of w.residents)r.inventory.turnip=2;
 Object.assign(w.residents[0].inventory,{berry:0,meal:0,turnip:0});
 initializeFood(w);w.minute+=DAY;
 const before={minute:w.minute,people:w.residents.map(r=>({id:r.id,bornAt:r.bornAt,parents:r.parents,homeId:r.homeId,inventory:r.inventory})),
  buildings:w.buildings.map(b=>({id:b.id,ownerId:b.ownerId,residents:b.residents})),lots:structuredClone(w.food!.lots)};
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);
  for(let restart=0;restart<2;restart++){
   const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
   try{
    const loaded=runtime.world;
    assert.equal(loaded.minute,before.minute);
    assert.deepEqual(loaded.residents.map(r=>({id:r.id,bornAt:r.bornAt,parents:r.parents,homeId:r.homeId,inventory:r.inventory})),before.people);
    assert.deepEqual(loaded.buildings.map(b=>({id:b.id,ownerId:b.ownerId,residents:b.residents})),before.buildings);
    for(const r of loaded.residents)assert.deepEqual(loaded.food!.lots['person:'+r.id],before.lots['person:'+r.id]);
   }finally{runtime.stop();}
  }
 }finally{store.close();}
});

test('new founders can choose nearby renewable berries, with a real fishing alternative when bushes are depleted',()=>{
 const w=createFrontierWorld();
 for(const r of w.residents){
  const choice=decisionChoices(decisionContext(w,r)).find(({action})=>action.type==='gather'&&w.resources.some(b=>b.id===action.resourceId&&b.kind==='bush'&&b.amount>0&&b.regrowthDays>0));
  assert.ok(choice,`${r.name} knows a currently usable berry source`);
  assert.equal(choice.action.type,'gather');
  if(choice.action.type!=='gather')throw new Error('expected gathering');
  const action=choice.action,bush=w.resources.find(b=>b.id===action.resourceId)!;
  const path=findPath(w,r.at,bush.at,true);
  assert.ok(path&&path.length<30,'gathering is reachable well before the three-day reserve expires');
 }
 for(const bush of w.resources.filter(b=>b.kind==='bush'))bush.amount=0;
 const fisher=w.residents.find(r=>r.id==='founder-3-2')!;
 const alternate=decisionChoices(decisionContext(w,fisher)).find(c=>c.action.type==='industry'&&c.action.operation==='fish');
 assert.ok(alternate,'existing gear and actual river stock offer a different food source');
 const shore=w.industry!.frontierShore!;
 assert.ok(findPath(w,fisher.at,shore)!.length<30);
});
