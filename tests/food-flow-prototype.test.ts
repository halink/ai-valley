import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prototypeDrawing,prototypeFlowFixture,prototypeChoices,selectPrototypeAction,submitPrototypeActions,queuePrototypeFlow,finishPrototypeFlow,prototypeReceipts,reloadPrototype} from './helpers/food-flow-prototype.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {completeDesign} from '../src/world/resident-designs.js';
import {DAY} from '../src/world/time.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';
import type {Action} from '../src/shared/types.js';

// Started is the sole physical debit; terminal rows report outcomes, never another loss.
test('final numbered prototype menus spend nothing on acceptance and record one original-input debit and dried-fish output',()=>{
 const {w,r,d,p}=prototypeFlowFixture(),original=structuredClone(w.food!.lots['person:'+r.id].fish!),fish=r.inventory.fish!,plan=queuePrototypeFlow(w,r);
 assert.equal(r.inventory.fish,fish);assert.equal(w.designs!.trials?.length??0,0);
 const observations=finishPrototypeFlow(w,r),flows=prototypeReceipts(observations);assert.equal(flows.length,2);
 const [start,end]=flows,t=w.designs!.trials![0];assert.deepEqual(flows.map(f=>f.phase),['started','succeeded']);
 for(const f of flows){assert.deepEqual(checkedFoodFlow(f),f);assert.equal(f.type,'processed');assert.equal(f.definition,'invention/air-drying@1');assert.equal(f.planId,plan.id);assert.equal(f.residentId,r.id);assert.equal(f.container,'person:'+r.id);assert.equal(f.designId,d.id);assert.equal(f.prototypeId,p.id);assert.equal(f.trialId,t.id);assert.equal(f.buildingId,t.buildingId);assert.equal(f.startedAt,t.startedAt);assert.equal(f.inputItem,'fish');assert.equal(f.inputQuantity,2);assert.equal(f.failureReason,null);assert.equal(w.events.find(e=>e.id===f.eventId)!.at,f.at);}
 assert.equal(start.inputs.length,1);assert.equal(start.inputs[0].quantity,2);assert.deepEqual(start.inputs[0].lots!.map(({nutrition,...lot})=>lot),[{...original[0],quantity:2}]);assert.deepEqual(start.outputs,[]);
 assert.deepEqual(end.inputs,[]);assert.equal(end.outputs.length,1);assert.equal(end.outputs[0].item,'driedFish');assert.equal(end.outputs[0].quantity,1);assert.equal(end.outputs[0].lots!.reduce((n,l)=>n+l.quantity,0),1);
 assert.equal(r.inventory.fish,fish-2);assert.equal(r.inventory.driedFish,1);assert.ok(observations.every(o=>o.foodFlowCoverage===FOOD_FLOW_COVERAGE));
 const before=structuredClone(w);assert.ok(submitPlan(w,plan).ok);assert.deepEqual(w,before);assert.deepEqual(prototypeReceipts([stepWorldWithFoodEvidence(w,1)]),[]);
});

for(const mode of ['rain','overload','night','expired'] as const)test(`prototype ${mode} outcome never repeats the already-spent raw-food debit`,()=>{
 const {w,r}=prototypeFlowFixture(mode==='overload'?{batchSize:4}:mode==='night'?{trialMinutes:60}:{});
 if(mode==='rain')w.weather='rain';if(mode==='night')w.minute=Math.floor(w.minute/DAY)*DAY+22*60;
 if(mode==='expired')w.food!.lots['person:'+r.id].fish![0].expiresAt=w.minute+60;
 queuePrototypeFlow(w,r);const flows=prototypeReceipts(finishPrototypeFlow(w,r));assert.deepEqual(flows.map(f=>f.phase),['started','failed']);
 assert.equal(flows[0].inputs[0].quantity,mode==='overload'?4:2);assert.deepEqual(flows[1].inputs,[]);assert.deepEqual(flows[1].outputs,[]);assert.equal(flows[1].failureReason,mode==='night'?'sunlight':mode);assert.equal(r.inventory.driedFish??0,0);
 for(const f of flows)assert.deepEqual(checkedFoodFlow(f),f);
});

test('interruption and SQLite resumption preserve original trial identity with no second start or debit',()=>{
 const {w,r}=prototypeFlowFixture(),plan=queuePrototypeFlow(w,r),seen=[];
 while(!w.designs!.trials?.length)seen.push(stepWorldWithFoodEvidence(w,1));
 const t=structuredClone(w.designs!.trials![0]),fish=r.inventory.fish;
 r.canExpress=false;seen.push(stepWorldWithFoodEvidence(w,1));r.canExpress=true;
 const loaded=reloadPrototype(w),actor=loaded.residents.find(a=>a.id===r.id)!;
 const action=selectPrototypeAction(loaded,actor,a=>a.type==='design'&&a.operation==='trial');assert.ok(action.type==='design'&&action.operation==='trial'&&action.trialId===t.id);
 const resumed=submitPrototypeActions(loaded,actor,[action]);seen.push(...finishPrototypeFlow(loaded,actor));
 const flows=prototypeReceipts(seen);assert.deepEqual(flows.map(f=>f.phase),['started','succeeded']);assert.equal(flows[0].planId,plan.id);assert.equal(flows[1].planId,resumed.id);assert.equal(flows[1].trialId,t.id);assert.equal(flows[1].startedAt,t.startedAt);assert.deepEqual(flows[1].inputs,[]);assert.equal(actor.inventory.fish,fish);assert.deepEqual(loaded.designs!.trials![0].sourceLots,t.sourceLots);
 assert.deepEqual(prototypeReceipts([stepWorldWithFoodEvidence(reloadPrototype(loaded),2)]),[]);
});

test('abandonment after reload emits only an outcome and never refunds, double-debits or repeats completion',()=>{
 const {w,r}=prototypeFlowFixture();queuePrototypeFlow(w,r);const seen=[];while(!w.designs!.trials?.length)seen.push(stepWorldWithFoodEvidence(w,1));
 r.canExpress=false;seen.push(stepWorldWithFoodEvidence(w,1));r.canExpress=true;
 const loaded=reloadPrototype(w),actor=loaded.residents.find(a=>a.id===r.id)!,before=structuredClone(actor.inventory);
 submitPrototypeActions(loaded,actor,[selectPrototypeAction(loaded,actor,a=>a.type==='design'&&a.operation==='abandonPrototype')]);
 while(actor.activity?.remaining!==1)seen.push(stepWorldWithFoodEvidence(loaded,1));const activity=structuredClone(actor.activity!);
 seen.push(...finishPrototypeFlow(loaded,actor));const flows=prototypeReceipts(seen);assert.deepEqual(flows.map(f=>f.phase),['started','abandoned']);assert.equal(flows[1].failureReason,'abandoned');assert.deepEqual(flows[1].inputs,[]);assert.deepEqual(flows[1].outputs,[]);assert.deepEqual(actor.inventory,before);
 actor.activity=activity;const replay=captureDirectEating(loaded,()=>completeDesign(loaded,actor,activity.action as Extract<Action,{type:'design'}>));actor.activity=null;
 assert.deepEqual(prototypeReceipts([replay]),[]);assert.deepEqual(actor.inventory,before);
});

test('fractional earliest-expiry prototype inputs keep original nutrition versions across active definition changes',()=>{
 const {w,r}=prototypeFlowFixture();r.inventory.fish=2;
 const early={quantity:.5,producedAt:400,expiresAt:2000,definition:'food/prototype-original@1'},late={quantity:1.5,producedAt:420,expiresAt:3000,definition:'food/life@1'};
 w.definitions[early.definition]={id:'food/prototype-original',version:1,kind:'life',dependencies:[],data:{nutrition:{fish:7}}};w.food!.lots['person:'+r.id].fish=structuredClone([late,early]);
 const oldNutrition=(w.definitions[late.definition].data.nutrition as Record<string,number>).fish;
 const life=structuredClone(w.definitions['food/life@1']);life.version=88;life.data={...life.data,nutrition:{fish:999,driedFish:999}};w.definitions['food/life@88']=life;w.activeDefinitions['food/life']='food/life@88';
 queuePrototypeFlow(w,r);const flows=prototypeReceipts(finishPrototypeFlow(w,r));assert.deepEqual(flows[0].inputs[0].lots,[{...early,nutrition:3.5},{...late,nutrition:1.5*oldNutrition}]);assert.equal(flows[0].inputs[0].nutrition,3.5+1.5*oldNutrition);assert.equal(flows[1].phase,'succeeded');
});

for(const mode of ['missing','short','surplus','invalid-definition','future','unknown-nutrition','zero-nutrition'] as const)test(`prototype ${mode} original metadata never invents input proof`,()=>{
 const {w,r}=prototypeFlowFixture();queuePrototypeFlow(w,r);
 // Trial leaves the desk before starting. Change metadata at its real start boundary.
 while(r.inside)stepWorld(w,1);
 const ledger=w.food!.lots['person:'+r.id];if(mode==='missing')delete ledger.fish;
 else if(mode==='short')ledger.fish![0].quantity=1;else if(mode==='surplus')ledger.fish![0].quantity=21;
 else if(mode==='invalid-definition')ledger.fish![0].definition='private invalid definition';else if(mode==='future')ledger.fish![0].producedAt=w.minute+100;
 else {ledger.fish![0].definition='food/unknown-prototype@1';if(mode==='zero-nutrition')w.definitions['food/unknown-prototype@1']={id:'food/unknown-prototype',version:1,kind:'life',dependencies:[],data:{nutrition:{fish:0}}};}
 const f=prototypeReceipts(finishPrototypeFlow(w,r))[0];assert.equal(f.phase,'started');assert.equal(f.inputs[0].quantity,2);assert.equal(f.inputs[0].nutrition,mode==='zero-nutrition'?0:null);
 if(mode==='unknown-nutrition'||mode==='zero-nutrition')assert.ok(f.inputs[0].lots?.length);else assert.equal(f.inputs[0].lots,null);assert.deepEqual(checkedFoodFlow(f),f);
});

test('prototype forecast and other-world collectors are isolated, while default-off stepping is state-neutral',()=>{
 const {w,r}=prototypeFlowFixture();queuePrototypeFlow(w,r);const before=structuredClone(w),other=copyForSimulation(w);
 const outer=captureDirectEating(w,()=>{prototypeChoices(w,r);hasTimelySelfRescue(w,r,[{type:'eat',item:'fish'}]);const flows=prototypeReceipts(finishPrototypeFlow(other,other.residents.find(a=>a.id===r.id)!));assert.equal(flows.length,2);});
 assert.deepEqual(outer.foodFlows,[]);assert.deepEqual(w,before);
 const disabled=structuredClone(w),actor=disabled.residents.find(a=>a.id===r.id)!;const seen=finishPrototypeFlow(w,r);while(actor.plan||actor.activity)stepWorld(disabled,1);
 assert.equal(prototypeReceipts(seen).length,2);assert.deepEqual(w,disabled);assert.equal(JSON.stringify(w).includes('foodFlowCoverage'),false);
});

test('separate final-menu trials have unique events and trial ids rather than plan-wide deduplication',()=>{
 const {w,r}=prototypeFlowFixture({trialMinutes:60});queuePrototypeFlow(w,r);const first=prototypeReceipts(finishPrototypeFlow(w,r));
 submitPrototypeActions(w,r,[selectPrototypeAction(w,r,a=>a.type==='design'&&a.operation==='trial')]);const second=prototypeReceipts(finishPrototypeFlow(w,r));
 assert.equal(first.length,2);assert.equal(second.length,2);assert.notEqual(first[0].trialId,second[0].trialId);assert.equal(new Set([...first,...second].map(f=>f.eventId)).size,4);assert.equal(r.inventory.fish,16);
});


test('two residents concurrently working actual prototypes retain distinct trial and event receipts',()=>{
 const {w,r}=prototypeFlowFixture({trialMinutes:60}),other=w.residents.find(a=>a.id!==r.id&&a.canExpress&&a.skills.building>=1)!;assert.ok(other);
 other.inventory={wood:20,fiber:20,fish:20};
 submitPrototypeActions(w,other,[selectPrototypeAction(w,other,a=>a.type==='design'&&a.operation==='draw'&&a.kind==='prototype',{drawing:{...prototypeDrawing,trialMinutes:60}})]);finishPrototypeFlow(w,other);
 submitPrototypeActions(w,other,[selectPrototypeAction(w,other,a=>a.type==='design'&&a.operation==='assemble')]);finishPrototypeFlow(w,other);
 const a=selectPrototypeAction(w,r,a=>a.type==='design'&&a.operation==='trial'),b=selectPrototypeAction(w,other,a=>a.type==='design'&&a.operation==='trial');
 submitPrototypeActions(w,r,[a]);submitPrototypeActions(w,other,[b]);const seen=[];
 for(let n=0;r.plan||r.activity||other.plan||other.activity;n++){assert.ok(n<1000);seen.push(stepWorldWithFoodEvidence(w,1));}
 const flows=prototypeReceipts(seen);assert.equal(flows.length,4);assert.equal(new Set(flows.map(f=>f.eventId)).size,4);assert.equal(new Set(flows.map(f=>f.trialId)).size,2);
 for(const actor of [r,other]){const own=flows.filter(f=>f.residentId===actor.id);assert.deepEqual(own.map(f=>f.phase),['started','failed']);assert.equal(own[0].inputs[0].quantity,2);assert.deepEqual(own[1].inputs,[]);assert.equal(actor.inventory.fish,18);}
});
