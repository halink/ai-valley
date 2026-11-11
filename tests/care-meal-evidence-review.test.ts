import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {executeSocialAction} from '../src/world/social.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {initializeFood} from '../src/world/food.js';
import {captureDirectEating,foodFlowInputs,type CareMealReceipt} from '../src/world/food-consumption-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import type {Action,Proposal,Resident,World} from '../src/shared/types.js';

function receipt():CareMealReceipt{return {action:'care',at:481,providerId:'provider',beneficiaryId:'patient',eventId:'care-event',planId:'plan',container:'person:provider',definition:'action/routine@1',proposalId:'consent',authority:'consent',inputs:[{item:'meal',quantity:1,nutrition:41,lots:[{quantity:1,producedAt:400,expiresAt:900,definition:'food/life@1',nutrition:41}]},{item:'water',quantity:1,nutrition:0,lots:[]}],hungerBefore:70,hungerAfter:48,hungerRelief:22};}
function session(careMeals:CareMealReceipt[]|undefined){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('review-world',480);food.committed({worldId:'review-world',fromMinute:480,toMinute:481,receipts:[],foodFlows:[],...(careMeals===undefined?{}:{careMeals})},1);food.stop('review-world',481);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.resources=[];w.plots=[];w.buildings=[];
 for(const r of w.residents){r.at={x:30,y:30};r.inside=null;r.roomAt=null;r.homeId=null;r.plan=null;r.activity=null;r.canDecide=r.canExpress=true;r.health=80;r.energy=100;r.hunger=50;r.skills.care=2;r.inventory={meal:5,water:5};}
 const [provider,patient]=w.residents;
 const p:Proposal={id:'review-care',actorId:provider.id,targetId:patient.id,kind:'care',status:'accepted',createdAt:w.minute,expiresAt:w.minute+1440,definition:w.activeDefinitions['action/routine']};w.proposals.push(p);
 initializeFood(w);return {w,provider,patient,p};
}
function submit(w:World,r:Resident,action:Action){assert.equal(submitPlan(w,{id:`review:${r.id}:${w.minute}:${r.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Synthetic care review',actions:[action]}).ok,true);}

test('care review: fixed 22 relief cannot be replaced by a self-consistent fabricated delta',()=>{
 for(const relief of [0,21,23,70]){const r=receipt();r.hungerAfter=r.hungerBefore-relief;r.hungerRelief=relief;assert.equal(session([r]).report.careMeals.totals,null,`relief=${relief}`);}
 const r=receipt();r.hungerBefore=7;r.hungerAfter=0;r.hungerRelief=7;assert.equal(session([r]).report.careMeals.complete,true);
});

test('care review: missing coverage and unknown nutrition are distinct from observed zero',()=>{
 assert.equal(session(undefined).report.careMeals.totals,null);
 assert.deepEqual(session([]).report.careMeals.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
 const r=receipt();r.inputs[0].lots=null;r.inputs[0].nutrition=null;
 const result=session([r]).report;assert.equal(result.careMeals.complete,true);assert.equal(result.careMeals.totals!.nutrition,null);assert.equal(result.careMeals.totals!.hungerRelief,22);assert.equal(result.totals!.completedActions,0);assert.equal(result.foodConsumption,null);
 const s=session([r]);assert.equal(auditRuntimeFoodEvidence(s.events.slice(1),s.food.status()).careMeals.totals,null);
});

test('care review: strict writer boundary rejects nested extras, holes, symbols and getters without executing them',()=>{
 const base=session([receipt()]).events[1];
 for(const level of ['receipt','amount','lot']){const e:any=structuredClone(base),r=e.careMeals[0];(level==='receipt'?r:level==='amount'?r.inputs[0]:r.inputs[0].lots[0]).prompt='SYNTHETIC_PRIVATE';assert.throws(()=>checkedFoodEvent(e),/invalid_evidence_schema/);}
 let calls=0;for(const edit of [(e:any)=>{Object.defineProperty(e.careMeals[0],'hungerBefore',{get(){calls++;return 70;}});},(e:any)=>{delete e.careMeals[0];},(e:any)=>{e.careMeals[0][Symbol('extra')]=1;},(e:any)=>{e.careMeals[0].inputs[0].quantity=NaN;}]){const e=structuredClone(base);edit(e);assert.throws(()=>checkedFoodEvent(e));}assert.equal(calls,0);
 const legacy:any=structuredClone(base);delete legacy.careMeals;assert.deepEqual(checkedFoodEvent(legacy),legacy);
});

test('care review: impossible identities, duplicate events and unproven batch nutrition fail closed',()=>{
 for(const edit of [(r:CareMealReceipt)=>{r.beneficiaryId=r.providerId;},(r:CareMealReceipt)=>{r.container='person:patient';},(r:CareMealReceipt)=>{r.proposalId=null;},(r:CareMealReceipt)=>{r.inputs[0].lots=null;},(r:CareMealReceipt)=>{r.inputs[0].lots![0].nutrition=null;},(r:CareMealReceipt)=>{r.inputs[0].lots![0].expiresAt=r.at;},(r:CareMealReceipt)=>{r.inputs[0].lots![0].producedAt=r.at+1;},(r:CareMealReceipt)=>{r.inputs[1].nutrition=1;}]){const r=receipt();edit(r);assert.equal(session([r]).report.careMeals.totals,null);}
 assert.equal(session([receipt(),receipt()]).report.careMeals.totals,null);
});

test('care review: missing original definition stays unknown without mutation or relief back-calculation',()=>{
 const {w,provider}=fixture(),key='person:'+provider.id;w.food!.lots[key].meal![0].definition='food/missing@1';
 const before=structuredClone(w);let inputs:ReturnType<typeof foodFlowInputs>;
 captureDirectEating(w,()=>{inputs=foodFlowInputs(w,key,{meal:1,water:1},1);});
 assert.deepEqual(w,before);assert.equal(inputs![0].nutrition,null);assert.equal(inputs![0].lots![0].nutrition,null);assert.equal(inputs![1].nutrition,0);
});

test('care review: final-tick withdrawal and competing use of the same consent emit no phantom second debit',()=>{
 for(const withdrawn of [false,true]){
  const {w,provider,patient,p}=fixture();submit(w,provider,{type:'care',targetId:patient.id,proposalId:p.id});stepWorld(w,1);assert.ok(provider.activity);provider.activity.remaining=1;
  if(withdrawn)submit(w,patient,{type:'respond',proposalId:p.id,accept:false});
  const before=provider.inventory.meal!;const observed=stepWorldWithFoodEvidence(w,1);
  assert.equal(observed.careMeals!.length,withdrawn?0:1);assert.equal(provider.inventory.meal,before-(withdrawn?0:1));assert.equal(observed.receipts.length,0);
  if(!withdrawn){const r=observed.careMeals![0];assert.equal(r.providerId,provider.id);assert.equal(r.beneficiaryId,patient.id);assert.equal(r.hungerRelief,22);assert.equal(r.inputs[0].quantity,1);assert.equal(r.inputs[1].quantity,1);assert.equal(p.status,'expired');}
  const remaining=structuredClone(provider.inventory);const duplicate=captureDirectEating(w,()=>{assert.equal(executeSocialAction(w,provider,{type:'care',targetId:patient.id,proposalId:p.id}).ok,false);});assert.deepEqual(duplicate.careMeals,[]);assert.deepEqual(provider.inventory,remaining);
  assert.equal(stepWorldWithFoodEvidence(w,1).careMeals!.length,0);
 }
});

test('care review: observation is state-neutral and committed receipts are detached deeply frozen copies',()=>{
 const {w,provider,patient,p}=fixture();submit(w,provider,{type:'care',targetId:patient.id,proposalId:p.id});stepWorld(w,1);provider.activity!.remaining=1;
 const plain=structuredClone(w);stepWorld(plain,1);const observed=stepWorldWithFoodEvidence(w,1);assert.deepEqual(w,plain);assert.equal(JSON.stringify(w).includes('careMeals'),false);
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(w.id,observed.fromMinute);food.committed(observed,w.revision);
 const event=events[1];assert.equal(event.type,'food_step_committed');if(event.type!=='food_step_committed')return;
 const copy=event.careMeals![0];assert.ok(Object.isFrozen(copy.inputs[0].lots![0]));observed.careMeals![0].inputs[0].quantity=999;assert.equal(copy.inputs[0].quantity,1);
});

test('care review: sealed writer round-trip retains independent care totals; missing seal clears both exposed copies',t=>{
 const root=mkdtempSync(join(testTmpdir(),'care-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'run'),fingerprint='a'.repeat(64);
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'review-world',fromMinute:480});t.after(()=>writer.abort());
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(480);food.start('review-world',480);food.committed({worldId:'review-world',fromMinute:480,toMinute:481,receipts:[],foodFlows:[],careMeals:[receipt()]},1);wait.stop(481);food.stop('review-world',481);
 const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});assert.equal(report.complete,true);assert.equal(report.careMeals.totals!.nutrition,41);assert.equal(report.careMeals.totals!.hungerRelief,22);assert.deepEqual(readAcceptanceEvidence(directory),report);
 unlinkSync(join(directory,'run-close.json'));const broken=readAcceptanceEvidence(directory);assert.equal(broken.careMeals.totals,null);assert.equal(broken.directEating.careMeals.totals,null);
});

test('care review: actual completion on failed durable commit remains unpublished and retries once',async t=>{
 const {ValleyRuntime}=await import('../src/server/runtime.js');const {WorldStore}=await import('../src/server/store.js');const {QWEN_MODEL}=await import('../src/server/model-completion.js');
 t.mock.timers.enable({apis:['setInterval']});t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network');});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const {w,provider,patient,p}=fixture();submit(w,provider,{type:'care',targetId:patient.id,proposalId:p.id});stepWorld(w,1);provider.activity!.remaining=1;
 for(const r of w.residents){r.lastDecisionAt=w.minute;r.decisionDue=w.minute+1000;}
 const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const events:RuntimeFoodEvent[]=[],runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('No model');},{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});t.after(()=>runtime.stop());runtime.start();
 let attempted=false;
 const original=store.commit.bind(store),mock=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{if(args[0].proposals.find(v=>v.id===p.id)?.status==='expired'){attempted=true;throw new Error('Synthetic care commit failure');}return original(...args);});
 for(let i=0;i<20&&!attempted;i++){const before=structuredClone(runtime.world),count=events.length;try{runtime.tick(now+=1000);}catch(error){assert.match(String(error),/care commit failure/);assert.equal(events.length,count);assert.deepEqual(runtime.world,before);}}assert.equal(attempted,true);assert.equal(store.loadForRuntime()!.proposals.find(v=>v.id===p.id)!.status,'accepted');
 mock.mock.restore();runtime.tick(now+=1000);runtime.stop();const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());assert.equal(report.careMeals.complete,true);assert.equal(report.careMeals.totals!.completedActions,1);assert.equal(report.careMeals.totals!.units.meal,1);assert.equal(store.loadForRuntime()!.proposals.find(v=>v.id===p.id)!.status,'expired');
});


test('care review: one missing minute permanently prevents a daily zero claim despite later observed empty minutes',()=>{
 const {w}=fixture(),observer=createIsolationEvidence(w);const first=stepWorldWithFoodEvidence(w,1);delete first.careMeals;observer.sample(w,first);
 const next=stepWorldWithFoodEvidence(w,1);assert.deepEqual(next.careMeals,[]);observer.sample(w,next);const row=observer.finish(w)!;
 assert.equal(row.careMeals.observedMinutes,1);assert.equal(row.careMeals.unobservedMinutes,1);assert.equal(row.careMeals.totals,null);assert.equal(row.directEating.totals!.completedActions,0);assert.equal(row.foodConsumption.value,null);
});
