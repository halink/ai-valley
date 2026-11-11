import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeEmployment,completeEmployment,employmentWorkError,advanceEmployment} from '../src/world/employment.js';
import {completeEconomy,moveCoins,totalCoins} from '../src/world/economy.js';
import {advanceFood,initializeFood} from '../src/world/food.js';
import {WorldStore} from '../src/server/store.js';
import {bindRecipeSnapshot} from '../src/world/industry-definitions.js';
import {DAY,YEAR} from '../src/world/time.js';
import type {EmploymentAction} from '../src/shared/employment.js';

// Every world and SQLite database in this review is synthetic and in memory.
function fixture(){
 const w=createWorld();w.mode='formal';const [owner,worker]=w.residents;
 const home=w.buildings.find(b=>b.ownerId===owner.id)!;
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...home.door};r.inside=null;r.coins=100;r.health=100;r.energy=100;}
 initializeEmployment(w);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:home.id,name:'守恒审查食铺'}),null);
 const shop=w.economy!.businesses[0];assert.ok(moveCoins(w,`resident:${owner.id}`,`business:${shop.id}`,60,'合成测试注资','review-capital'));
 shop.inventory={turnip:6,water:4};
 const custom=structuredClone(w.definitions['recipe/meal@1']);custom.version=8;custom.cost={turnip:3,water:2};custom.minutes=7;custom.data.yield=2;
 w.definitions['recipe/meal@8']=custom;w.activeDefinitions['recipe/meal']='recipe/meal@8';
 const terms={role:'cook' as const,wage:6,days:2,startMinute:600,durationMinutes:60};
 assert.equal(completeEmployment(w,owner,{type:'employment',operation:'post',businessId:shop.id,terms}),null);
 const post=w.employment!.posts[0];
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'apply',postId:post.id}),null);
 assert.equal(completeEmployment(w,owner,{type:'employment',operation:'select',postId:post.id,applicantId:worker.id}),null);
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'accept',postId:post.id}),null);
 const c=w.employment!.contracts[0];w.minute=c.startDay*DAY+600;
 // Change the currently active recipe after acceptance: this is not a contract amendment.
 w.activeDefinitions['recipe/meal']='recipe/meal@1';
 const action:EmploymentAction={type:'employment',operation:'work',contractId:c.id,minutes:60};
 worker.activity={planId:'review-work',action,startedAt:w.minute,remaining:60,path:[],target:{...home.door},definition:'action/routine@1'};
 return {w,worker,owner,shop,c,action};
}

test('review: historical recipe repair never replenishes damaged held ingredients or follows active definitions',()=>{
 const {w,worker,shop,c,action}=fixture();const promised=structuredClone(c.recipe!);
 w.minute++;assert.equal(employmentWorkError(w,worker,action,1),null);
 c.recipe!.input.turnip=0;c.batch!.inventory.turnip=0; // persisted legacy alias corruption
 const held=structuredClone(c.batch!.inventory),stock=structuredClone(shop.inventory),money=totalCoins(w);
 initializeEmployment(w);
 assert.deepEqual(c.recipe,promised);assert.deepEqual(c.batch!.inventory,held);assert.deepEqual(shop.inventory,stock);assert.equal(totalCoins(w),money);
 advanceFood(w);assert.equal(c.batch,null);assert.equal(shop.inventory.turnip,3);assert.equal(shop.inventory.water,4);assert.equal(shop.inventory.meal??0,0);
 initializeEmployment(w);advanceFood(w);assert.equal(shop.inventory.water,4);
});

test('review: restoring a contaminated recipe and cancellation are idempotent through SQLite',()=>{
 const f=fixture();f.w.minute++;assert.equal(employmentWorkError(f.w,f.worker,f.action,1),null);
 f.c.recipe!.input.turnip=0;f.c.batch!.inventory.turnip=0;
 const store=new WorldStore(':memory:');let w;try{store.commit(f.w,null);w=store.load()!;}finally{store.close();}
 const c=w.employment!.contracts[0],shop=w.economy!.businesses[0],worker=w.residents.find(r=>r.id===f.worker.id)!;
 const money=totalCoins(w),snapshot=structuredClone(w.definitions[c.recipeDefinition!]!);
 initializeEmployment(w);assert.deepEqual(c.recipe!.input,{turnip:3,water:2});assert.equal(c.batch!.inventory.turnip,0);
 advanceFood(w);assert.equal(c.batch,null);assert.equal(shop.inventory.turnip,3);assert.equal(shop.inventory.water,4);
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'quit',contractId:c.id}),null);
 const after=structuredClone(shop.inventory),coins=shop.coins;advanceEmployment(w);advanceEmployment(w);
 assert.deepEqual(shop.inventory,after);assert.equal(shop.coins,coins);assert.equal(totalCoins(w),money);assert.deepEqual(w.definitions[c.recipeDefinition!]!,snapshot);
});

test('review: successful batch uses agreed output and replay cannot produce or charge twice',()=>{
 const {w,worker,shop,c,action}=fixture(),money=totalCoins(w);
 w.minute+=7;assert.equal(employmentWorkError(w,worker,action,7),null);
 assert.equal(shop.inventory.meal,2);assert.equal(shop.inventory.turnip,3);assert.equal(shop.inventory.water,2);assert.equal(c.batch,null);
 const attendance=structuredClone(c.attendance),stock=structuredClone(shop.inventory),paid=c.paid;
 assert.equal(employmentWorkError(w,worker,action,7),null);
 assert.equal(completeEmployment(w,worker,action),null);assert.equal(completeEmployment(w,worker,action),null);
 assert.deepEqual(c.attendance,attendance);assert.deepEqual(shop.inventory,stock);assert.equal(c.paid,paid);assert.equal(totalCoins(w),money);
});

test('review: food expiry cannot mutate the accepted definition and quit refunds only surviving stock',()=>{
 const {w,worker,shop,c,action}=fixture();w.minute++;assert.equal(employmentWorkError(w,worker,action,1),null);
 const recipe=structuredClone(c.recipe!),definition=structuredClone(w.definitions[c.recipeDefinition!]!);
 initializeFood(w);for(const lot of w.food!.lots[`employment:${c.id}`].turnip!)lot.expiresAt=w.minute;
 advanceFood(w);
 assert.deepEqual(c.recipe,recipe);assert.deepEqual(w.definitions[c.recipeDefinition!]!,definition);assert.equal(c.batch,null);
 assert.equal(shop.inventory.turnip,3);assert.equal(shop.inventory.water,4);assert.equal(shop.inventory.meal??0,0);
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'quit',contractId:c.id}),null);
 assert.equal(shop.inventory.turnip,3);assert.equal(shop.inventory.water,4);assert.equal(w.food!.spoiled.turnip,3);
});

test('review: exact originating post can recover old promises without a contract definition',()=>{
 const {w,c}=fixture();const original=structuredClone(c.recipe!);
 delete c.recipeDefinition;c.recipe!.input.turnip=0;
 initializeEmployment(w);
 assert.deepEqual(c.recipe,original);assert.ok(c.recipeDefinition);
 assert.deepEqual(w.definitions[c.recipeDefinition!]!.cost,original.input);
});

test('review: zeroed recipe without any historical evidence cannot mint meals or wages',()=>{
 const {w,worker,shop,c,action}=fixture();
 delete c.recipeDefinition;c.recipe!.input.turnip=0;w.employment!.posts=[];
 shop.inventory={water:4};const stock=structuredClone(shop.inventory),money=totalCoins(w);
 initializeEmployment(w);w.minute+=7;
 assert.ok(employmentWorkError(w,worker,action,7),'unknown lost ingredients must block processing');
 assert.deepEqual(shop.inventory,stock);assert.equal(c.paid,0);assert.equal(c.attendance.length,0);assert.equal(c.batch,null);assert.equal(totalCoins(w),money);
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'quit',contractId:c.id}),null);
 assert.deepEqual(shop.inventory,stock);assert.equal(totalCoins(w),money);
});

test('review: work hook rejects depleted in-progress input even before food cleanup runs',()=>{
 const {w,worker,shop,c,action}=fixture();w.minute++;assert.equal(employmentWorkError(w,worker,action,1),null);
 c.batch!.inventory.turnip=0;c.batch!.progress=c.batch!.minutes-1;
 const paid=c.paid,worked=c.attendance[0].worked;w.minute++;
 assert.ok(employmentWorkError(w,worker,action,1));
 assert.equal(c.paid,paid);assert.equal(c.attendance[0].worked,worked);assert.equal(shop.inventory.meal??0,0);
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'quit',contractId:c.id}),null);
 assert.equal(shop.inventory.turnip,3);assert.equal(shop.inventory.water,4);
});


test('review: a legacy definition created from already-zeroed input is not evidence of valid food production',()=>{
 const {w,worker,shop,c,action}=fixture();c.recipe!.input.turnip=0;w.employment!.posts=[];
 c.recipeDefinition=bindRecipeSnapshot(w,c.recipe!); // what the old initializer did to unbound damaged saves
 shop.inventory={water:4};const stock=structuredClone(shop.inventory),money=totalCoins(w);
 initializeEmployment(w);w.minute+=7;
 assert.ok(employmentWorkError(w,worker,action,7));
 assert.deepEqual(shop.inventory,stock);assert.equal(c.paid,0);assert.equal(c.batch,null);assert.equal(totalCoins(w),money);
});

test('review: direct food advancement isolates old live aliases before expiring held ingredients',()=>{
 const {w,worker,shop,c,action}=fixture();w.minute++;assert.equal(employmentWorkError(w,worker,action,1),null);
 c.batch!.inventory=c.recipe!.input;c.batch!.output=c.recipe!.output;
 const original=structuredClone(c.recipe!);initializeFood(w);
 assert.notEqual(c.batch!.inventory,c.recipe!.input);assert.notEqual(c.batch!.output,c.recipe!.output);
 for(const lot of w.food!.lots[`employment:${c.id}`].turnip!)lot.expiresAt=w.minute;
 advanceFood(w);assert.deepEqual(c.recipe,original);assert.equal(c.batch,null);
 assert.equal(shop.inventory.turnip,3);assert.equal(shop.inventory.water,4);assert.equal(shop.inventory.meal??0,0);
});

test('review: an inflated unfinished output is rejected and only real inputs are refunded',()=>{
 const {w,worker,shop,c,action}=fixture();w.minute++;assert.equal(employmentWorkError(w,worker,action,1),null);
 c.batch!.output.meal=99;const worked=c.attendance[0].worked,paid=c.paid;w.minute+=6;
 assert.ok(employmentWorkError(w,worker,action,6));
 assert.equal(c.batch,null);assert.equal(c.attendance[0].worked,worked);assert.equal(c.paid,paid);
 assert.equal(shop.inventory.turnip,6);assert.equal(shop.inventory.water,4);assert.equal(shop.inventory.meal??0,0);assert.equal(c.recipe!.output.meal,2);
});
