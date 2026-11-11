import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,decisionChoices,prepareModelDecision} from '../src/server/decisions.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {directFoodChoices,MAX_DIRECT_EAT_CHOICES} from '../src/server/direct-food-choices.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {goods,itemKeys} from '../src/shared/items.js';
import type {Action,DecisionContext,Item,Resident,World} from '../src/shared/types.js';
import {foodTransaction} from '../src/world/food.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {captureDirectEating,type DirectEatingReceipt} from '../src/world/food-consumption-evidence.js';
import {WorldStore} from '../src/server/store.js';

const foods=itemKeys.filter(item=>goods[item].food>0);
function fixture(size:number){
 const w=createFrontierWorld(5401),r=w.residents[0];w.clock.paused=false;
 // Deliberately enlarged synthetic inventory. This is not the natural seed.
 foodTransaction(w,()=>{r.inventory={water:4};for(const item of foods.slice(0,size))r.inventory[item]=3;});
 decisionContext(w,r);return {w,r};
}
const eatItems=(rows:ActionChoice[])=>rows.flatMap(c=>c.action.type==='eat'?[c.action.item]:[]);
function crowd(c:DecisionContext){
 for(let i=0;i<160;i++){
  c.formal!.opportunities.push({id:`direct-food-work-${i}`,label:'Synthetic scheduled work',action:{type:'employment',operation:'work',contractId:`work-${i}`}});
  c.formal!.opportunities.push({id:`direct-food-reply-${i}`,label:'Synthetic permission reply',action:{type:'respond',proposalId:`proposal-${Math.floor(i/2)}`,accept:i%2===0}});
 }
}
let serial=0;
function execute(w:World,r:Resident,c:ActionChoice,fields:Record<string,unknown>={}){
 const menu=decisionChoices(decisionContext(w,r)),current=menu.find(o=>JSON.stringify(o.action)===JSON.stringify(c.action));assert.ok(current,'select an actual current final menu action');
 const chosen=parseChoice(JSON.stringify({choice:current.id,...fields}),menu),receipts:DirectEatingReceipt[]=[];
 assert.equal(submitPlan(w,{id:`food-menu:${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:chosen.intention,actions:chosen.actions}).ok,true);
 let budget=500;while(r.plan||r.activity){assert.ok(budget--);receipts.push(...captureDirectEating(w,()=>stepWorld(w,1)).receipts);}
 assert.equal(r.lastFailure,null);return receipts;
}
function findWithActualWait(w:World,r:Resident,predicate:(a:Action)=>boolean){
 for(let window=0;window<foods.length;window++){
  const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>predicate(c.action));if(choice)return choice;
  execute(w,r,menu.find(c=>c.action.type==='wait')!,{minutes:30});
 }
 assert.fail('candidate was not exposed during actual elapsed waiting');
}

for(const size of new Set([12,20,foods.length]))test(`synthetic seed5401 ${size} carried foods rotate before both caps, with one cooked-meal option`,()=>{
 const {w,r}=fixture(size),c=decisionContext(w,r);crowd(c);const seen=new Set<Item>();
 for(let window=0;window<size;window++){
  c.minute=480+window*30;const before=structuredClone(c),basic=buildChoices({...c,formal:{...c.formal!,opportunities:[]}}),p=prepareModelDecision(c,undefined,GLM_MODEL);
  assert.ok(basic.length<=32);assert.equal(eatItems(basic).length,4);assert.ok(basic.some(c=>c.action.type==='cook'));
  assert.equal(eatItems(p.choices).length,4);assert.equal(p.choices.filter(c=>c.action.type==='cook').length,1);assert.ok(p.choices.length<=59);
  for(const item of eatItems(p.choices))seen.add(item);
  for(const choice of p.choices)assert.ok(p.messages[0].content.includes(choice.id+'. '+choice.label));
  assert.deepEqual(c,before);
 }
 assert.deepEqual([...seen].sort(),foods.slice(0,size).sort());
});

test('all full basic categories still fit four rotating eats and cooking in the original 32-row budget',()=>{
 const {w,r}=fixture(foods.length),c=decisionContext(w,r);delete c.formal;c.actor.at={x:20,y:20};c.bounds={width:60,height:60};c.actor.inventory.seed=1;c.season='spring';
 c.buildings=[{id:r.homeId!,name:'Known home',kind:'home',ownerId:r.id,door:{x:21,y:20}},{id:'lodge-a',name:'Known public kitchen A',kind:'lodge',ownerId:'commons',door:{x:22,y:20}},{id:'lodge-b',name:'Known public kitchen B',kind:'lodge',ownerId:'commons',door:{x:23,y:20}}];
 c.people=Array.from({length:3},(_,i)=>({id:`peer-${i}`,name:`Peer ${i}`,at:{x:20+i,y:21},status:'alive' as const,intention:'',relation:null}));
 c.resources=(['tree','rock','bush','spring'] as const).map((kind,i)=>({id:kind,kind,at:{x:20+i,y:22},amount:10,max:10,regrowthDays:1,lastHarvest:0}));
 c.plots=[null,1,4].map((growth,i)=>({id:`plot-${i}`,ownerId:r.id,at:{x:22+i,y:23},crop:growth===null?null:{definition:'crop/turnip@1',growth,wateredDay:-1,planted:0,lastGrowthDay:0}}));c.knownLand=c.plots.map(p=>({id:p.id,at:p.at}));
 c.offers=Array.from({length:2},(_,i)=>({id:`offer-${i}`,actorId:`peer-${i}`,targetId:r.id,give:{wood:1},want:{turnip:1},status:'open' as const,expiresAt:c.minute+10000,definition:'action/routine@1'}));
 for(let i=0;i<foods.length;i++){
  c.minute=480+30*i;const rows=buildChoices(c);assert.equal(rows.length,32);assert.equal(eatItems(rows).length,MAX_DIRECT_EAT_CHOICES);assert.equal(rows.filter(c=>c.action.type==='cook').length,1);
  for(const type of ['wait','sleep','gather','plant','water','harvest','move','talk','offer','accept'])assert.ok(rows.some(c=>c.action.type===type),type);
 }
});

test('restored cooking preserves every baseline non-reflection choice under saturation',()=>{
 const {w,r}=fixture(20),c=decisionContext(w,r);crowd(c);
 for(let i=0;i<20;i++){
  c.minute=480+30*i;const all=buildChoices(c),baseline=focusedChoices(c,all.filter(c=>c.action.type!=='cook')),after=focusedChoices(c,all);
  for(const row of baseline.filter(c=>!(c.action.type==='agency'&&c.action.operation==='reflect')))assert.ok(after.includes(row),row.id);
  assert.equal(after.filter(c=>c.action.type==='cook').length,1);assert.ok(after.length<=59);
 }
});

test('rotation uses only full personal portions and is independent of inventory insertion order, hunger and private batch metadata',()=>{
 const {w,r}=fixture(foods.length),c=decisionContext(w,r),before=directFoodChoices(c);
 c.actor.inventory=Object.fromEntries(Object.entries(c.actor.inventory).reverse());c.actor.hunger=99;c.actor.health=1;
 if(c.formal!.foodCoverage){c.formal!.foodCoverage.lots=[];c.formal!.foodCoverage.unknownExpiry=true;}
 assert.deepEqual(directFoodChoices(c),before);
 c.actor.inventory={wood:100,gameMeat:100,water:0,turnip:.5,meal:0};assert.deepEqual(directFoodChoices(c),[]);assert.ok(!buildChoices(c).some(c=>c.action.type==='cook'));
 c.actor.inventory={turnip:2,water:0};assert.deepEqual(eatItems(buildChoices(c)),['turnip']);assert.ok(!buildChoices(c).some(c=>c.action.type==='cook'));
 c.actor.inventory.water=1;assert.ok(decisionChoices(c).some(c=>c.action.type==='cook'));delete c.actor.inventory.turnip;assert.ok(!decisionChoices(c).some(c=>c.action.type==='cook'));
});

test('synthetic 12-food seed actually cooks through the current numbered menu without auto-eating',()=>{
 const {w,r}=fixture(12),before={...r.inventory},hunger=r.hunger,choice=findWithActualWait(w,r,a=>a.type==='cook');
 const receipts=execute(w,r,choice);assert.deepEqual(receipts,[]);assert.equal(r.inventory.turnip,before.turnip!-2);assert.equal(r.inventory.water,before.water!-1);assert.equal(r.inventory.meal,before.meal!+1);assert.ok(r.hunger>hunger);
});

for(const item of foods.slice(12,20))test(`synthetic 20-food seed actually exposes and eats tail food ${item} after ordinary elapsed waits`,t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No model or network is allowed');});
 const {w,r}=fixture(20),choice=findWithActualWait(w,r,a=>a.type==='eat'&&a.item===item),before=r.inventory[item]!;
 const receipts=execute(w,r,choice);assert.equal(r.inventory[item],before-1);assert.equal(receipts.length,1);assert.equal(receipts[0].item,item);assert.equal(receipts[0].quantity,1);assert.equal(receipts[0].nutrition,goods[item].food);assert.equal(w.metrics.requests,0);
});

test('synthetic food vocabulary and final numbered menus survive an isolated in-memory reload',()=>{
 const {w,r}=fixture(20),before=decisionChoices(decisionContext(w,r)),store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(a=>a.id===r.id)!;assert.deepEqual(decisionChoices(decisionContext(loaded,actor)),before);assert.deepEqual(loaded.food,w.food);}
 finally{store.close();}
});
