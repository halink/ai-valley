import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {goods,itemKeys} from '../src/shared/items.js';
import {focusNames} from '../src/shared/agency.js';
import type {Action,DecisionContext,Resident,World} from '../src/shared/types.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {initializeFood} from '../src/world/food.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {YEAR} from '../src/world/time.js';

const foods=itemKeys.filter(i=>goods[i].food>0);
function fixture(){
 const w=createWorld(5401),r=w.residents[0],other=w.residents[1];w.mode='formal';w.minute=(foods.length-1)*30;w.clock.paused=false;w.resources=[];
 for(const p of w.residents){p.inventory={};p.bornAt=w.minute-30*YEAR;p.hunger=20;p.energy=p.health=100;p.plan=p.activity=null;}
 r.at={...w.buildings.find(b=>b.id===r.homeId)!.door};r.inventory=Object.fromEntries(foods.map(i=>[i,3]));r.inventory.water=3;
 initializeFood(w);decisionContext(w,r);return {w,r,other};
}
const prepared=(c:DecisionContext)=>prepareModelDecision(c,undefined,GLM_MODEL);
const direct=(a:Action)=>a.type==='eat'||a.type==='cook';
function selected(w:World,r:Resident,type:'eat'|'cook',item?:string){
 const p=prepared(decisionContext(w,r)),choice=p.choices.find(c=>c.action.type===type&&(c.action.type!=='eat'||c.action.item===item));
 if(choice){assert.match(choice.id,/^\d+$/);assert.ok(p.messages.some(m=>m.content.includes(choice.id+'. '+choice.label)));return parseChoice(JSON.stringify({choice:choice.id}),p.choices).actions[0];}
 assert.fail(`Missing final numbered ${type} ${item??''}`);
}
function run(w:World,r:Resident,a:Action){
 const result=submitPlan(w,{id:`independent-food:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Explicit offline numbered choice',actions:[a]});
 if(result.ok){let budget=300;while(r.plan||r.activity){assert.ok(budget--);stepWorld(w,1);}}
 return result;
}

test('independent direct food review: every owned food and cooking survive saturated focuses without mutating context',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);
 for(let i=0;i<160;i++)c.formal!.opportunities.push({id:`review-work.${i}`,label:`Synthetic work ${i}`,action:{type:'employment',operation:'work',contractId:`review-${i}`}});
 for(const focus of Object.keys(focusNames) as Array<keyof typeof focusNames>){
  c.actor.agency={focus,goals:[],routines:[],nextSerial:1};const seen=new Set<string>();
  for(let i=0;i<foods.length;i++){
   c.minute=600+i*30;const before=structuredClone(c),p=prepared(c);assert.deepEqual(c,before);assert.ok(p.choices.length<=59);
   assert.equal(new Set(p.choices.map(c=>c.id)).size,p.choices.length);
   for(const choice of p.choices){if(choice.action.type==='eat')seen.add(choice.action.item);}
   assert.ok(p.choices.some(c=>c.action.type==='cook'),`cook remains visible at ${c.minute}, focus ${focus}`);
  }
  assert.deepEqual([...seen].sort(),[...foods].sort(),focus);
 }
});

test('independent direct food review: last catalog food executes only after explicit numbered selection',()=>{
 const {w,r}=fixture(),item=foods.at(-1)!,before=structuredClone(w),a=selected(w,r,'eat',item);assert.deepEqual(w,before);
 assert.equal(run(w,r,a).ok,true);assert.equal(r.lastFailure,null);assert.equal(r.inventory[item],2);assert.ok(r.hunger<20);
 assert.equal(r.inventory.turnip,3);assert.equal(r.inventory.water,3);assert.equal(w.metrics.requests,0);
});

test('independent direct food review: cooking converts exact inputs without eating the result',()=>{
 const {w,r}=fixture(),a=selected(w,r,'cook'),before=r.hunger;
 assert.equal(run(w,r,a).ok,true);assert.equal(r.lastFailure,null);assert.equal(r.inventory.turnip,1);assert.equal(r.inventory.water,2);assert.equal(r.inventory.meal,4);assert.ok(r.hunger>=before);
});

test('independent direct food review: stale ingredients and revoked kitchen rights fail without resources or nutrition',()=>{
 for(const change of ['ingredients','rights'] as const){
  const {w,r}=fixture(),a=selected(w,r,'cook');
  if(change==='ingredients')r.inventory.water=0;else {const home=w.buildings.find(b=>b.id===r.homeId)!;home.residents=[];home.ownerId='someone-else';r.homeId=null;}
  const before=structuredClone(r.inventory);const result=run(w,r,a);assert.ok(!result.ok||r.lastFailure);assert.deepEqual(r.inventory,before);assert.ok(r.hunger>=20);
 }
});

test('independent direct food review: food that expires during eating gives no meal or relief',()=>{
 const {w,r}=fixture(),item=foods.at(-1)!,a=selected(w,r,'eat',item);
 w.food!.lots['person:'+r.id][item]!.forEach(l=>l.expiresAt=w.minute+1);
 assert.equal(run(w,r,a).ok,true);assert.ok(r.lastFailure);assert.equal(r.inventory[item],0);assert.ok(r.hunger>=20);assert.equal(r.inventory.meal,3);
});

test('independent direct food review: unknown own batches are not fabricated and other private stock never affects prompt',()=>{
 const {w,r,other}=fixture();delete w.food!.lots['person:'+r.id];const before=structuredClone(w),p=prepared(decisionContext(w,r));assert.deepEqual(w,before);
 other.inventory={driedFish:999,meal:333};w.food!.lots['person:'+other.id]={meal:[{quantity:333,producedAt:0,expiresAt:999999,definition:'food/life@1'}]};
 assert.deepEqual(prepared(decisionContext(w,r)),p);assert.equal(w.food!.lots['person:'+r.id],undefined);assert.doesNotMatch(JSON.stringify(p),/999999/);
});

test('independent direct food review: age and expression-only restrictions cannot be bypassed by restored food slots',()=>{
 const {w,r}=fixture();r.bornAt=w.minute-12*YEAR;let c=decisionContext(w,r);assert.ok(prepared(c).choices.some(c=>c.action.type==='eat'));assert.ok(!prepared(c).choices.some(c=>c.action.type==='cook'));
 r.bornAt=w.minute-4*YEAR;c=decisionContext(w,r);assert.ok(!prepared(c).choices.some(c=>direct(c.action)));
 r.bornAt=w.minute-30*YEAR;
 for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','passenger','familyTravelling'] as const){c=decisionContext(w,r);c.formal![flag]=true;assert.ok(!prepared(c).choices.some(c=>direct(c.action)),flag);}
});

test('independent direct food review: many kitchens rotate once while live stops and emergency choices survive',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);const kitchens=new Set<string>();
 for(let i=0;i<8;i++)c.formal!.opportunities.push({id:`premises.cook.review-${i}`,label:`Synthetic licensed kitchen ${i}`,action:{type:'cook',buildingId:`review-kitchen-${i}`,quantity:1}});
 for(let i=0;i<160;i++)c.formal!.opportunities.push({id:`review-commitment-${i}`,label:'Synthetic work',action:{type:'employment',operation:'work',contractId:`review-contract-${i}`}});
 c.formal!.opportunities.push({id:'care.stop.review',label:'Stop synthetic care now',action:{type:'health',operation:'cancelRescue',transportId:'review-transport'}});
 c.formal!.opportunities.push({id:'review-ration',label:'Synthetic validated emergency ration',action:{type:'production',operation:'emergencyEstateRation'}});
 for(const focus of ['daily','farming','care'] as const){
  c.actor.agency={focus,goals:[],routines:[],nextSerial:1};kitchens.clear();
  for(let i=0;i<9;i++){
   c.minute=600+30*i;const p=prepared(c),cooks=p.choices.filter(c=>c.action.type==='cook');assert.equal(cooks.length,1);
   const a=cooks[0].action;assert.equal(a.type,'cook');if(a.type==='cook')kitchens.add(a.buildingId!);
   assert.ok(p.choices.some(c=>c.label==='Stop synthetic care now'));assert.ok(p.choices.some(c=>c.action.type==='production'&&c.action.operation==='emergencyEstateRation'));
   assert.ok(p.choices.length<=60,'59 ordinary plus one live stop');
  }
  assert.equal(kitchens.size,9,`all distinct kitchens eventually visible: ${focus}`);
 }
});

test('independent direct food review: sparse or fractional inventory creates no phantom meals or cooking inputs',()=>{
 const {w,r}=fixture();r.inventory={meal:0.5,turnip:1,water:0,wood:999};
 for(let i=0;i<21;i++){
  const c=decisionContext(w,r);c.minute+=i*30;const p=prepared(c),a=p.choices.filter(c=>direct(c.action)).map(c=>c.action);
  assert.deepEqual(a,[{type:'eat',item:'turnip'}]);
 }
 assert.deepEqual(r.inventory,{meal:0.5,turnip:1,water:0,wood:999});assert.equal(r.plan,null);assert.equal(r.activity,null);
});
