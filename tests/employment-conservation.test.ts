import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Inventory,Resident,World} from '../src/shared/types.js';
import {goods,itemKeys} from '../src/shared/items.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {moveCoins,totalCoins} from '../src/world/economy.js';
import {initializeEmployment,employmentWorkError,completeEmployment} from '../src/world/employment.js';
import {initializeFood,foodContainers,foodTransaction} from '../src/world/food.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';
import {atWorkstation} from './helpers/workspaces.js';

function submit(w:World,r:Resident,a:Action){
 atWorkstation(w,r,a);
 const result=submitPlan(w,{id:`conservation:${r.id}:${w.minute}:${r.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定执行',actions:[a]});
 assert.equal(result.ok,true,JSON.stringify(result));
}
function run(w:World,r:Resident,a:Action){submit(w,r,a);for(let n=0;r.plan||r.activity;n++){assert.ok(n<300);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function fixture(input?:Inventory){
 const w=createWorld();w.mode='formal';w.clock.paused=false;const [owner,worker]=w.residents,home=w.buildings.find(b=>b.ownerId===owner.id)!;
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=100;r.health=100;r.energy=100;r.hunger=10;r.knownBuildings.push(home.id);}
 stepWorld(w,1);
 run(w,owner,{type:'economy',operation:'open',buildingId:home.id,name:'守恒食铺'});
 const b=w.economy!.businesses[0];assert.ok(moveCoins(w,`resident:${owner.id}`,`business:${b.id}`,60,'合成测试出资','conservation-capital'));
 if(input){w.definitions['recipe/meal@2']={...structuredClone(w.definitions['recipe/meal@1']),version:2,cost:input};w.activeDefinitions['recipe/meal']='recipe/meal@2';}
 run(w,owner,{type:'employment',operation:'post',businessId:b.id,terms:{role:'cook',wage:12,days:2,startMinute:600,durationMinutes:120}});
 const p=w.employment!.posts[0];
 run(w,worker,{type:'employment',operation:'apply',postId:p.id});
 run(w,owner,{type:'employment',operation:'select',postId:p.id,applicantId:worker.id});
 run(w,worker,{type:'employment',operation:'accept',postId:p.id});
 const c=w.employment!.contracts[0];w.minute=c.startDay*DAY+c.terms.startMinute;owner.inside=null;owner.roomAt=null;
 b.inventory={turnip:4,water:2};initializeFood(w);
 return {w,owner,worker,b,c,p};
}
function start(f:ReturnType<typeof fixture>,minutes=40){submit(f.w,f.worker,{type:'employment',operation:'work',contractId:f.c.id,minutes});}
function reload(f:ReturnType<typeof fixture>){const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!;return {w,owner:w.residents.find(r=>r.id===f.owner.id)!,worker:w.residents.find(r=>r.id===f.worker.id)!,b:w.economy!.businesses.find(b=>b.id===f.b.id)!,c:w.employment!.contracts[0],p:w.employment!.posts[0]};}finally{store.close();}}
function lotsMatch(w:World){const containers=foodContainers(w);for(const [id,bag]of containers)for(const item of itemKeys.filter(i=>goods[i].life>0))assert.equal((w.food!.lots[id]?.[item]??[]).reduce((n,l)=>n+l.quantity,0),bag[item]??0,`${id}/${item}`);for(const id of Object.keys(w.food!.lots))assert.ok(containers.has(id),id);}

test('employment conservation: actual open/post/apply/select/accept/work separates physical input and output from signed snapshots',()=>{
 const f=fixture(),original=structuredClone(f.c.recipe);start(f);
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).foodFlows,[],'employment reservation is not industry craft conversion');
 assert.notEqual(f.c.batch!.inventory,f.c.recipe!.input);assert.notEqual(f.c.batch!.output,f.c.recipe!.output);
 assert.deepEqual(f.c.recipe,original);assert.deepEqual(f.c.batch!.inventory,{turnip:2,water:1});lotsMatch(f.w);
 const flows=stepWorldWithFoodEvidence(f.w,39).foodFlows!;
 assert.equal(flows.length,2);assert.ok(flows.every(flow=>flow.action==='employment_processing'),'employment output is distinct from cook or industry craft');
 assert.equal(f.b.inventory.meal,2);assert.equal(f.c.batch,null);assert.equal(f.c.attendance[0].worked,40);assert.deepEqual(f.c.recipe,original);lotsMatch(f.w);
 const snapshot=JSON.stringify(f.w);assert.equal(completeEmployment(f.w,f.worker,{type:'employment',operation:'work',contractId:f.c.id,minutes:40}),null);assert.equal(JSON.stringify(f.w),snapshot);
});

for(const restart of [false,true])test(`employment conservation: second-minute expiry cannot turn 40 minutes and water into meals, reload=${restart}`,()=>{
 let f=fixture();f.b.inventory={turnip:2,water:2};initializeFood(f.w);f.w.food!.lots[`business:${f.b.id}`].turnip![0].expiresAt=f.w.minute+2;
 const original=structuredClone(f.c.recipe),money=totalCoins(f.w);start(f);stepWorld(f.w,1);if(restart)f=reload(f);stepWorld(f.w,39);
 assert.equal(f.b.inventory.meal??0,0);assert.equal(f.b.inventory.turnip??0,0);assert.equal(f.b.inventory.water,2);assert.equal(f.c.batch,null);
 assert.deepEqual(f.c.recipe,original);assert.deepEqual(f.p.recipe,original);assert.equal(f.w.food!.spoiled.turnip,2);assert.equal(f.c.attendance[0].worked,1);assert.match(f.worker.lastFailure!,/材料/);assert.equal(totalCoins(f.w),money);lotsMatch(f.w);
 // Later rounds must still require the original ingredients; actual replacement stock is explicit.
 start(f,20);stepWorld(f.w,20);assert.equal(f.b.inventory.meal??0,0);assert.deepEqual(f.c.recipe,original);
 foodTransaction(f.w,()=>{f.b.inventory.turnip=2;});run(f.w,f.worker,{type:'employment',operation:'work',contractId:f.c.id,minutes:20});
 assert.equal(f.b.inventory.meal,1);assert.equal(f.b.inventory.turnip,0);assert.equal(f.b.inventory.water,1);assert.deepEqual(f.c.recipe,original);lotsMatch(f.w);
});

test('employment conservation: healthy partial batch reload retains original recipe despite new active content',()=>{
 let f=fixture();const original=structuredClone(f.c.recipe),money=totalCoins(f.w);start(f);stepWorld(f.w,7);f=reload(f);
 f.w.definitions['recipe/meal@2']={...structuredClone(f.w.definitions['recipe/meal@1']),version:2,cost:{turnip:8,water:4},minutes:80,data:{yield:9}};f.w.activeDefinitions['recipe/meal']='recipe/meal@2';
 stepWorld(f.w,33);assert.equal(f.b.inventory.meal,2);assert.equal(f.c.batch,null);assert.deepEqual(f.c.recipe,original);assert.equal(totalCoins(f.w),money);lotsMatch(f.w);
});

test('employment conservation: old poisoned snapshot restores historical requirements without restoring lost physical stock',()=>{
 let f=fixture();const original=structuredClone(f.c.recipe);start(f);stepWorld(f.w,1);
 // Reproduce the persisted pre-fix damage: physical stock and the mutable recipe both lost two turnips.
 foodTransaction(f.w,()=>{f.c.batch!.inventory.turnip=0;});f.c.recipe!.input.turnip=0;f.c.batch!.progress=19;f=reload(f);
 initializeEmployment(f.w);assert.deepEqual(f.c.recipe,original);assert.equal(f.c.batch!.inventory.turnip,0);
 stepWorld(f.w,1);assert.equal(f.b.inventory.meal??0,0);assert.ok(!f.c.batch||f.c.batch.progress===1);assert.equal(f.c.recipe!.input.turnip,2);lotsMatch(f.w);
});

test('employment conservation: work hook independently refuses incomplete fully-worked input without minting wages or output',()=>{
 const f=fixture();start(f);stepWorld(f.w,1);foodTransaction(f.w,()=>{f.c.batch!.inventory.turnip=0;});f.c.batch!.progress=20;
 const worked=f.c.attendance[0].worked,paid=f.c.paid,meals=f.b.inventory.meal??0;f.w.minute++;
 assert.match(employmentWorkError(f.w,f.worker,f.worker.activity!.action as never,1)!,/材料|批次/);
 assert.equal(f.c.attendance[0].worked,worked);assert.equal(f.c.paid,paid);assert.equal(f.b.inventory.meal??0,meals);assert.equal(f.c.recipe!.input.turnip,2);lotsMatch(f.w);
});

test('employment conservation: one spoiled batch cannot donate its work to a fresh replacement batch',()=>{
 const f=fixture(),key=`business:${f.b.id}`,lot=f.w.food!.lots[key].turnip![0];
 f.w.food!.lots[key].turnip=[{...lot,quantity:2,expiresAt:f.w.minute+2},{...lot,quantity:2,expiresAt:f.w.minute+200}];
 start(f);stepWorld(f.w,40);
 assert.equal(f.b.inventory.meal,1);assert.equal(f.b.inventory.water,1);assert.equal(f.b.inventory.turnip,0);assert.equal(f.c.batch,null);
 assert.equal(f.c.attendance[0].worked,21);assert.equal(f.c.attendance[0].produced,1);assert.equal(f.w.food!.spoiled.turnip,2);assert.equal(f.c.recipe!.input.turnip,2);lotsMatch(f.w);
});

test('employment conservation: surviving perishable input retains its actual old lot when a sibling ingredient expires',()=>{
 const f=fixture({turnip:2,fruit:1,water:1});f.b.inventory={turnip:2,fruit:1,water:1};initializeFood(f.w);
 const key=`business:${f.b.id}`,fruit=f.w.food!.lots[key].fruit![0];fruit.producedAt=f.w.minute-100;fruit.expiresAt=f.w.minute+100;
 const original=structuredClone(fruit);f.w.food!.lots[key].turnip![0].expiresAt=f.w.minute+2;
 start(f);stepWorld(f.w,40);
 assert.equal(f.b.inventory.meal??0,0);assert.equal(f.b.inventory.fruit,1);assert.equal(f.b.inventory.water,1);assert.equal(f.b.inventory.turnip,0);
 assert.deepEqual(f.w.food!.lots[key].fruit,[original]);assert.equal(f.c.batch,null);lotsMatch(f.w);
});
