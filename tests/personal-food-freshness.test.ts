import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,modelLimits} from '../src/server/model-completion.js';
import {personalFoodFreshnessNote,MAX_PERSONAL_FOOD_ITEMS} from '../src/server/personal-food-freshness.js';
import {personalFoodFreshness} from '../src/world/personal-food-freshness.js';
import {foodCoverageNote} from '../src/world/food-coverage.js';
import {initializeFood,advanceFood,foodValue} from '../src/world/food.js';
import {goods,itemKeys} from '../src/shared/items.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {parseChoice} from '../src/server/affordances.js';
import {captureDirectEating,type DirectEatingReceipt} from '../src/world/food-consumption-evidence.js';
import type {FoodLot} from '../src/shared/food.js';
import type {Resident,World} from '../src/shared/types.js';

const foods=itemKeys.filter(item=>goods[item].food>0);
const lot=(quantity:number,expiresAt:number,definition='food/life@1',producedAt=0):FoodLot=>({quantity,expiresAt,producedAt,definition});
function fixture(){
 const w=createFrontierWorld(5401),r=w.residents[0];w.clock.paused=false;
 // Explicit synthetic audit inventory, not the unmodified nine-resident opening.
 r.inventory={berry:5,turnip:3,water:4};initializeFood(w);decisionContext(w,r);
 w.food!.lots['person:'+r.id]={berry:[lot(5,w.minute+1440)],turnip:[lot(3,w.minute+2880)]};return {w,r};
}
const prepare=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
const ownNote=(w:World,r:Resident)=>{const c=decisionContext(w,r),p=prepareModelDecision(c,undefined,GLM_MODEL);return personalFoodFreshnessNote(c,p.choices);};

test('seed5401 equal carried portions and ration total now expose opposite expiries in the actual final prompt',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No network or model calls');});
 const {w,r}=fixture(),first=structuredClone(decisionContext(w,r)),a=prepareModelDecision(first,undefined,GLM_MODEL);
 w.food!.lots['person:'+r.id].berry![0].expiresAt=w.minute+2880;w.food!.lots['person:'+r.id].turnip![0].expiresAt=w.minute+1440;
 const second=decisionContext(w,r),b=prepareModelDecision(second,undefined,GLM_MODEL);
 assert.deepEqual(first.actor,second.actor);assert.deepEqual(a.choices,b.choices);
 assert.equal(first.formal!.foodCoverage!.carriedNutrition,120);assert.equal(first.formal!.foodCoverage!.days,second.formal!.foodCoverage!.days);
 assert.equal(foodCoverageNote(first.formal!.foodCoverage!),foodCoverageNote(second.formal!.foodCoverage!));
 assert.notDeepEqual(a.messages,b.messages);assert.match(a.messages[0].content,/浆果：持有5份；最早到期部分5份（第1920游戏分钟到期，尚余1440游戏分钟；合计营养60）/);
 assert.match(b.messages[0].content,/根菜：持有3份；最早到期部分3份（第1920游戏分钟到期，尚余1440游戏分钟；合计营养60）/);
 assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(w.metrics.requests,0);
});

test('same-day batches aggregate only equal expiry and preserve old nutritional definitions',()=>{
 const {w,r}=fixture();r.inventory={berry:4};w.definitions['food/review@1']={id:'food/review',version:1,kind:'life',dependencies:[],data:{nutrition:{berry:30}}};
 w.food!.lots['person:'+r.id]={berry:[lot(2,610),lot(.5,540),lot(.5,540,'food/review@1'),lot(1,600)]};
 const row=personalFoodFreshness(w,r).items[0];assert.deepEqual(row.earliest,{quantity:1,expiresAt:540,nutrition:21});assert.deepEqual(row.later,{quantity:3,nutrition:36});assert.equal(foodValue(w,'person:'+r.id,'berry'),21);
 const p=prepare(w,r);assert.match(p.messages[0].content,/第540游戏分钟到期，尚余60游戏分钟；合计营养21/);assert.match(p.messages[0].content,/更晚到期3份（合计营养36，后续时点未展开）/);
 w.food!.lots['person:'+r.id].berry![1].expiresAt=541;assert.notDeepEqual(prepare(w,r).messages,p.messages,'same day is not enough precision');
});

test('expired, five-minute expiry, malformed and absent batches remain distinct without refreshing stock',()=>{
 const {w,r}=fixture();r.inventory={berry:5,turnip:2};w.food!.lots['person:'+r.id]={berry:[lot(1,w.minute),lot(1,w.minute+5),lot(1,NaN)]};
 const before=structuredClone(w),c=decisionContext(w,r),p=prepareModelDecision(c,undefined,GLM_MODEL),rows=c.formal!.personalFoodFreshness!.items;
 assert.equal(rows[0].expiredQuantity,1);assert.equal(rows[0].earliest!.quantity,1);assert.equal(rows[0].unknownQuantity,3);assert.equal(rows[1].unknownQuantity,2);
 assert.match(p.messages[0].content,/尚余5游戏分钟/);assert.match(p.messages[0].content,/已到期1份，不计新鲜口粮/);assert.match(p.messages[0].content,/时效未知3份/);assert.deepEqual(w,before);
 delete w.food;const noLedger=structuredClone(w);assert.match(ownNote(w,r),/时效未知5份/);assert.deepEqual(w,noLedger);
});

test('real inventory caps a stale ledger and nonfood or empty stock cannot reveal phantom batches',()=>{
 const {w,r}=fixture();r.inventory={berry:2,turnip:0,gameMeat:12,water:4};w.food!.lots['person:'+r.id]={berry:[lot(5,600)],turnip:[lot(999,700)]};
 const rows=personalFoodFreshness(w,r).items;assert.equal(rows.length,1);assert.equal(rows[0].earliest!.quantity,2);assert.equal(rows[0].earliest!.nutrition,24);
 r.inventory={water:4,wood:1};const p=prepare(w,r);assert.match(p.messages[0].content,/没有持有可直接食用的食品/);assert.doesNotMatch(ownNote(w,r),/最早到期|999/);
});

test('new observations are immutable snapshots and do not alter choices or world state',()=>{
 const {w,r}=fixture(),before=structuredClone(w),c=decisionContext(w,r),saved=structuredClone(c),p=prepareModelDecision(c,undefined,GLM_MODEL);
 assert.deepEqual(w,before);assert.deepEqual(c,saved);w.food!.lots['person:'+r.id].berry![0].expiresAt++;
 assert.deepEqual(prepareModelDecision(c,undefined,GLM_MODEL),p);
 const without=structuredClone(c);delete without.formal!.personalFoodFreshness;assert.deepEqual(prepareModelDecision(without,undefined,GLM_MODEL).choices,p.choices);
});

test('known and unregistered personal quantities survive isolated SQLite reload without guessed freshness',()=>{
 const {w,r}=fixture();w.food!.lots['person:'+r.id].berry![0].quantity=2;const p=prepare(w,r),food=structuredClone(w.food),store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(a=>a.id===r.id)!;assert.deepEqual(prepare(loaded,actor),p);assert.deepEqual(loaded.food,food);assert.match(ownNote(loaded,actor),/时效未知3份/);}
 finally{store.close();}
});

test('only an actual numbered eat executes and consumes the oldest batch with its original nutrition',()=>{
 const {w,r}=fixture();r.inventory={berry:2};r.hunger=80;w.food!.lots['person:'+r.id]={berry:[lot(1,800),lot(1,600,'food/old@1')]};
 w.definitions['food/old@1']={id:'food/old',version:1,kind:'life',dependencies:[],data:{nutrition:{berry:7}}};
 const p=prepare(w,r),choice=p.choices.find(c=>c.action.type==='eat'&&c.action.item==='berry')!;assert.match(p.messages[0].content,/合计营养7/);
 const parsed=parseChoice(JSON.stringify({choice:choice.id}),p.choices),receipts:DirectEatingReceipt[]=[];
 assert.equal(submitPlan(w,{id:'freshness-numbered-eat',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:parsed.intention,actions:parsed.actions}).ok,true);
 for(let i=0;i<20&&(r.plan||r.activity);i++)receipts.push(...captureDirectEating(w,()=>stepWorld(w,1)).receipts);
 assert.equal(r.lastFailure,null);assert.equal(r.inventory.berry,1);assert.equal(receipts.length,1);assert.equal(receipts[0].quantity,1);assert.equal(receipts[0].nutrition,7);assert.match(ownNote(w,r),/第800游戏分钟到期/);
});

test('a displayed expiry cannot prevent actual spoilage or execute eating automatically',()=>{
 const {w,r}=fixture();r.inventory={berry:1};w.food!.lots['person:'+r.id]={berry:[lot(1,w.minute+1)]};const p=prepare(w,r);
 assert.match(p.messages[0].content,/尚余1游戏分钟/);stepWorld(w,1);assert.equal(r.inventory.berry,0);assert.equal(w.food!.spoiled.berry,1);assert.equal(r.plan,null);assert.equal(r.activity,null);assert.match(ownNote(w,r),/没有持有可直接食用的食品/);
 advanceFood(w);assert.equal(w.food!.spoiled.berry,1);
});

test('all supported models retain bounded carried-food facts with many batches and saturated family notes and menus',()=>{
 const {w,r}=fixture();r.inventory={};w.food!.lots['person:'+r.id]={};
 for(const item of foods){r.inventory[item]=200;w.food!.lots['person:'+r.id][item]=Array.from({length:200},(_,i)=>lot(1,w.minute+100+i));}
 for(let window=0;window<foods.length;window++){
  w.minute=480+window*30;const c=decisionContext(w,r);c.formal!.familyNotes='冗长家庭记录。'.repeat(5000);
  for(let i=0;i<160;i++)c.formal!.opportunities.push({id:'freshness-work-'+i,label:'Synthetic scheduled work',action:{type:'employment',operation:'work',contractId:'work-'+i}});
  for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){
   const p=prepareModelDecision(c,undefined,model),note=personalFoodFreshnessNote(c,p.choices);assert.ok((note.match(/：持有/g)??[]).length<=MAX_PERSONAL_FOOD_ITEMS);assert.match(note,/种本人食品未在本次摘要展开/);
   assert.ok(Buffer.byteLength(note)<7000);assert.ok(p.inputBytes<modelLimits[model].inputBytes);assert.ok(p.messages[0].content.includes(note));
   for(const choice of p.choices)if(choice.action.type==='eat')assert.ok(note.includes(goods[choice.action.item].name+'：持有'),choice.action.item);
   assert.ok(p.choices.length<=59);
  }
 }
});
