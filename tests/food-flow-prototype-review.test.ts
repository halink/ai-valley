import test from 'node:test';
import assert from 'node:assert/strict';
import {prototypeFlowFixture,queuePrototypeFlow,finishPrototypeFlow,prototypeReceipts,reloadPrototype} from './helpers/food-flow-prototype.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE,type FoodFlowReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {checkedFoodFlow,recordPrototypeFlow,type PrototypeFlowHistory} from '../src/server/acceptance-evidence-schema.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';

type Trial=Extract<FoodFlowReceipt,{action:'prototype_trial'}>;
function receipt(phase:Trial['phase']='started'):Trial{return {type:'processed',action:'prototype_trial',phase,at:phase==='started'?10:11,residentId:'review-person',eventId:'review-'+phase,planId:'review-plan',container:'person:review-person',definition:'invention/air-drying@1',trialId:'review-trial',prototypeId:'review-prototype',designId:'review-design',buildingId:'review-building',startedAt:10,inputItem:'fish',inputQuantity:2,failureReason:phase==='failed'?'rain':phase==='abandoned'?'abandoned':null,inputs:phase==='started'?[{item:'fish',quantity:2,nutrition:null,lots:null}]:[],outputs:phase==='succeeded'?[{item:'driedFish',quantity:1,nutrition:40,lots:[{quantity:1,producedAt:11,expiresAt:100,definition:'food/base@1',nutrition:40}]}]:[]};}
function observation(f:Trial):DirectEatingObservation{return {worldId:'review-world',fromMinute:f.at-1,toMinute:f.at,receipts:[],foodFlows:[f],foodFlowCoverage:FOOD_FLOW_COVERAGE};}
function audit(observations:DirectEatingObservation[]){const events:RuntimeFoodEvent[]=[],runtime=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});runtime.start('review-world',observations[0].fromMinute);observations.forEach((o,i)=>runtime.committed(o,i+1));runtime.stop('review-world',observations.at(-1)!.toMinute);return auditRuntimeFoodEvidence(events,runtime.status());}

test('independent prototype review: schema rejects invented legs, fractional batches, unknown trial definitions and getters',()=>{
 let reads=0;
 const bad:Array<(f:Trial)=>void>=[f=>{f.inputQuantity=2.5;f.inputs[0].quantity=2.5;},f=>{f.definition='invention/air-drying@2';},f=>{f.startedAt=9;},f=>{f.failureReason='rain';},f=>{f.outputs=receipt('succeeded').outputs;},f=>{Object.defineProperty(f.inputs[0],'lots',{get(){reads++;return null;}});},f=>{Object.defineProperty(f,Symbol('hidden'),{value:true});}];
 for(const mutate of bad){const f=receipt();mutate(f);assert.throws(()=>checkedFoodFlow(f));}assert.equal(reads,0);
 for(const phase of ['succeeded','failed','abandoned'] as const){const f=receipt(phase);assert.deepEqual(checkedFoodFlow(f),f);f.inputs=receipt().inputs;assert.throws(()=>checkedFoodFlow(f));}
 const f=receipt('succeeded');f.outputs[0].lots=null;f.outputs[0].nutrition=null;assert.throws(()=>checkedFoodFlow(f));
});

test('independent prototype review: lifecycle rejects changed persisted identities and repeated phases; terminal-only is valid',()=>{
 for(const key of ['residentId','container','definition','prototypeId','designId','buildingId','startedAt','inputItem','inputQuantity'] as const){const history:PrototypeFlowHistory=new Map();recordPrototypeFlow(history,receipt());const f=receipt('failed');(f as unknown as Record<string,unknown>)[key]=typeof f[key]==='number'?Number(f[key])+1:'changed';assert.throws(()=>recordPrototypeFlow(history,f),/identity/);}
 for(const phase of ['started','succeeded','failed','abandoned'] as const){const history:PrototypeFlowHistory=new Map();const f=receipt(phase);recordPrototypeFlow(history,f);assert.throws(()=>recordPrototypeFlow(history,{...f,eventId:'different-event'}),/Duplicate/);}
 const history:PrototypeFlowHistory=new Map();recordPrototypeFlow(history,receipt('failed'));assert.equal(history.size,1);
});

for(const ordering of ['same-step','trial-first','intake-first'] as const)test(`independent prototype review: cross-slice event collision (${ordering}) invalidates totals`,()=>{
 const f=receipt(),o=observation(f),next=observation({...receipt('failed'),eventId:f.eventId});
 const eat=(at:number)=>({at,residentId:f.residentId,eventId:f.eventId,planId:f.planId,container:f.container,item:'fish' as const,quantity:1,nutrition:20,hungerRelief:20});
 if(ordering==='same-step')o.receipts=[eat(10)];else if(ordering==='trial-first'){next.foodFlows=[];next.receipts=[eat(11)];}else{o.foodFlows=[];o.receipts=[eat(10)];}
 const report=audit(ordering==='same-step'?[o]:[o,next]);assert.equal(report.foodFlows.complete,false);assert.equal(report.foodFlows.totals,null);assert.ok(report.foodFlows.issues.includes('duplicate_flow_receipt'));
});

test('independent prototype review: duplicate terminal with a new event cannot count twice; old coverage remains unknown',()=>{
 const first=receipt('failed'),second={...receipt('abandoned'),at:12};
 const duplicate=audit([observation(first),observation(second)]);assert.equal(duplicate.foodFlows.complete,false);assert.ok(duplicate.foodFlows.issues.includes('invalid_prototype_trial_sequence'));
 const old=observation(receipt());old.foodFlowCoverage='gather_harvest_cook_fish_hunt_v1';const report=audit([old]);assert.equal(report.foodFlows.complete,false);assert.equal(report.foodFlows.totals,null);
 const terminal=audit([observation(first)]);assert.equal(terminal.foodFlows.complete,true,terminal.foodFlows.issues.join(','));assert.deepEqual(terminal.foodFlows.totals!.processingInputs.units,{});
});

test('independent prototype review: same-capture repaired original ledger stays unknown; observer changes no world state',()=>{
 const {w,r}=prototypeFlowFixture();queuePrototypeFlow(w,r);let start:Trial|undefined;let o:DirectEatingObservation;
 for(let n=0;n<100&&!start;n++){delete w.food!.lots['person:'+r.id]?.fish;const off=structuredClone(w);o=stepWorldWithFoodEvidence(w,1);stepWorld(off,1);assert.deepEqual(w,off);start=prototypeReceipts([o])[0];}
assert.ok(start);assert.equal(start.phase,'started');assert.equal(start.inputs[0].lots,null);assert.equal(start.inputs[0].nutrition,null);assert.deepEqual(start.outputs,[]);assert.deepEqual(checkedFoodFlow(start),start);
 assert.equal(o!.foodFlows!.filter(f=>f.action==='industry_craft').length,0);
});

test('independent prototype review: speculative copies cannot leak trial receipts into parent capture',()=>{
 const {w,r}=prototypeFlowFixture();queuePrototypeFlow(w,r);const before=structuredClone(w),copy=copyForSimulation(w);
 const o=captureDirectEating(w,()=>{const actor=copy.residents.find(a=>a.id===r.id)!;finishPrototypeFlow(copy,actor);});assert.deepEqual(o.foodFlows,[]);assert.deepEqual(w,before);
});

test('independent prototype review: persisted in-flight identity yields only terminal outcome after reload',()=>{
 const {w,r}=prototypeFlowFixture();queuePrototypeFlow(w,r);let start:Trial|undefined;for(let n=0;n<100&&!start;n++)start=prototypeReceipts([stepWorldWithFoodEvidence(w,1)])[0];assert.ok(start);
 const loaded=reloadPrototype(w),actor=loaded.residents.find(a=>a.id===r.id)!,prior=actor.inventory.fish;
 const observations=finishPrototypeFlow(loaded,actor),flows=prototypeReceipts(observations);assert.equal(flows.length,1);const end=flows[0];assert.equal(end.phase,'succeeded');assert.equal(end.trialId,start.trialId);assert.equal(end.startedAt,start.startedAt);assert.deepEqual(end.inputs,[]);assert.equal(actor.inventory.fish,prior);assert.deepEqual(checkedFoodFlow(end),end);
 assert.equal(observations.flatMap(o=>o.foodFlows??[]).filter(f=>f.action==='industry_craft').length,0);
 if(end.phase==='succeeded'){assert.ok(end.outputs[0].lots!.every(l=>l.producedAt===end.at));assert.equal(end.outputs[0].quantity,actor.inventory.driedFish);}
});


test('independent prototype review: unknown original food definition stays unknown and detached from later definition repair',()=>{
 const {w,r}=prototypeFlowFixture();queuePrototypeFlow(w,r);const key='food/review-missing@1';
 for(const lot of w.food!.lots['person:'+r.id].fish!)lot.definition=key;
 let start:Trial|undefined;for(let n=0;n<100&&!start;n++)start=prototypeReceipts([stepWorldWithFoodEvidence(w,1)])[0];assert.ok(start);
 assert.ok(start.inputs[0].lots?.length);assert.equal(start.inputs[0].nutrition,null);assert.ok(start.inputs[0].lots!.every(l=>l.definition===key&&l.nutrition===null));assert.deepEqual(checkedFoodFlow(start),start);
 const saved=structuredClone(start);w.definitions[key]={id:'food/review-missing',version:1,kind:'life',dependencies:[],data:{nutrition:{fish:999}}};assert.deepEqual(start,saved);
});
