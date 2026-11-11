import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync,fsyncSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {createWorld} from '../src/world/seed.js';
import {initializeFood} from '../src/world/food.js';
import {YEAR} from '../src/world/time.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {captureDirectEating,foodFlowInputs,type ChildCareMealReceipt} from '../src/world/food-consumption-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';

function receipt():ChildCareMealReceipt{return {action:'tendChild',at:481,providerId:'guardian',beneficiaryId:'child',eventId:'feeding',planId:'plan',container:'person:guardian',definition:'action/routine@1',authority:'guardian',inputs:[{item:'turnip',quantity:1,nutrition:13,lots:[{quantity:1,producedAt:400,expiresAt:900,definition:'food/life@1',nutrition:13}]},{item:'water',quantity:1,nutrition:0,lots:[]}],hungerBefore:70,hungerAfter:22,hungerRelief:48};}
function session(childCareMeals:ChildCareMealReceipt[]|undefined){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('child-review',480);food.committed({worldId:'child-review',fromMinute:480,toMinute:481,receipts:[],foodFlows:[],careMeals:[],...(childCareMeals===undefined?{}:{childCareMeals})},1);food.stop('child-review',481);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}
function fixture(){
 const w=createWorld(903);w.mode='formal';w.clock.paused=false;w.buildings=[];w.resources=[];w.plots=[];
 w.map={name:'Independent feeding review',width:20,height:20,tiles:Array(400).fill('grass'),entrance:{x:1,y:1}};
 for(const r of w.residents)Object.assign(r,{at:{x:10,y:10},inside:null,roomAt:null,homeId:null,plan:null,activity:null,bornAt:w.minute-25*YEAR,canDecide:true,canExpress:true,refusesCare:false,hunger:0,energy:100,health:100,inventory:{turnip:5,water:5},guardianIds:[]});
 const [provider,child]=w.residents;child.bornAt=w.minute-2*YEAR;child.guardianIds=[provider.id];child.hunger=70;
 provider.knownPeople=[child.id];initializeFood(w);return {w,provider,child};
}
function queue(f:ReturnType<typeof fixture>){
 const menu=decisionChoices(decisionContext(f.w,f.provider)),choice=menu.find(c=>c.action.type==='tendChild'&&c.action.targetId===f.child.id);assert.ok(choice);
 const actions=parseChoice(JSON.stringify({choice:choice.id}),menu).actions;
 assert.equal(submitPlan(f.w,{id:'independent-child-review',actorId:f.provider.id,actorRevision:f.provider.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'Offline review',actions}).ok,true);
}

test('child care review: threshold and fixed relief validate independently of a self-consistent hunger delta',()=>{
 for(const before of [0,11.999,100.001]){const r=receipt();r.hungerBefore=before;r.hungerAfter=Math.max(0,before-48);r.hungerRelief=before-r.hungerAfter;assert.equal(session([r]).report.childCareMeals.totals,null);}
 for(const before of [12,47.999,48,48.001,100]){const r=receipt();r.hungerBefore=before;r.hungerAfter=Math.max(0,before-48);r.hungerRelief=before-r.hungerAfter;assert.equal(session([r]).report.childCareMeals.complete,true);}
 for(const relief of [0,22,47,49,70]){const r=receipt();r.hungerAfter=70-relief;r.hungerRelief=relief;assert.equal(session([r]).report.childCareMeals.totals,null);}
});

test('child care review: only one meal-or-turnip and personal water can form this debit',()=>{
 for(const edit of [(r:ChildCareMealReceipt)=>{r.inputs[0].item='berry';},(r:ChildCareMealReceipt)=>{r.inputs[1]=structuredClone(r.inputs[0]);r.inputs[1].item='meal';},(r:ChildCareMealReceipt)=>{r.inputs.push(structuredClone(r.inputs[0]));},(r:ChildCareMealReceipt)=>{r.inputs[1].quantity=6;},(r:ChildCareMealReceipt)=>{r.inputs[1].lots=null;},(r:ChildCareMealReceipt)=>{r.inputs[1].nutrition=1;},(r:ChildCareMealReceipt)=>{r.container='vessel:guardian';},(r:ChildCareMealReceipt)=>{r.beneficiaryId=r.providerId;}]){const r=receipt();edit(r);assert.equal(session([r]).report.childCareMeals.totals,null);}
 for(const item of ['meal','turnip'] as const){const r=receipt();r.inputs[0].item=item;assert.deepEqual(session([r]).report.childCareMeals.totals,{units:{[item]:1,water:1},nutrition:13,hungerRelief:48,completedActions:1});}
});

test('child care review: old optional omission is unknown, not an observed empty child care slice',()=>{
 const old=session(undefined);assert.deepEqual(checkedFoodEvent(old.events[1]),old.events[1]);assert.equal(old.report.complete,true);assert.equal(old.report.childCareMeals.totals,null);assert.equal(old.report.careMeals.totals!.completedActions,0);
 assert.deepEqual(session([]).report.childCareMeals.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
 const s=session([]);for(const events of [s.events.slice(1),s.events.slice(0,-1)])assert.equal(auditRuntimeFoodEvidence(events,s.food.status()).childCareMeals.totals,null);
});

test('child care review: duplicate identities across child, ordinary care, eating and processing slices fail closed',()=>{
 assert.equal(session([receipt(),receipt()]).report.childCareMeals.totals,null);
 for(const kind of ['careMeals','receipts','foodFlows'] as const){const s=session([receipt()]),events=structuredClone(s.events);const step=events[1] as {-readonly [K in keyof Extract<RuntimeFoodEvent,{type:'food_step_committed'}>]:Extract<RuntimeFoodEvent,{type:'food_step_committed'}>[K]};assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
  if(kind==='careMeals')step.careMeals=[{...receipt(),action:'care',proposalId:null,hungerAfter:48,hungerRelief:22}];
  if(kind==='receipts')step.receipts=[{at:481,residentId:'guardian',eventId:'feeding',planId:'eat-plan',container:'person:guardian',item:'meal',quantity:1,nutrition:13,hungerRelief:13}];
  if(kind==='foodFlows')step.foodFlows=[{type:'processed',action:'cook',at:481,residentId:'guardian',eventId:'feeding',planId:'cook-plan',container:'person:guardian',definition:'action/routine@1',inputs:[],outputs:[]}];
  const result=auditRuntimeFoodEvidence(events,s.food.status());assert.equal(result.childCareMeals.totals,null);if(kind==='careMeals')assert.equal(result.careMeals.totals,null);
 }
});

test('child care review: every nested whitelist rejects secrets, getters and symbols before reading values',()=>{
 const base=session([receipt()]).events[1];let calls=0;
 for(const level of ['event','receipt','amount','lot'])for(const mutation of ['extra','getter','symbol']){
  const e:any=structuredClone(base),r=e.childCareMeals[0],target=level==='event'?e:level==='receipt'?r:level==='amount'?r.inputs[0]:r.inputs[0].lots[0];
  if(mutation==='extra')target.privateText='SYNTHETIC_PRIVATE';
  if(mutation==='symbol')target[Symbol('hidden')]='SYNTHETIC_PRIVATE';
  if(mutation==='getter')Object.defineProperty(target,Object.keys(target)[0],{get(){calls++;return 'SYNTHETIC_PRIVATE';}});
  assert.throws(()=>checkedFoodEvent(e),/invalid_evidence_schema/);
 }
 for(const edit of [(e:any)=>{delete e.childCareMeals[0];},(e:any)=>{e.childCareMeals[0].inputs[0].quantity=Infinity;},(e:any)=>{e.childCareMeals[0].proposalId='invented';},(e:any)=>{e.childCareMeals[0].authority='emergency';}]){const e=structuredClone(base);edit(e);assert.throws(()=>checkedFoodEvent(e));}
 assert.equal(calls,0);
});

test('child care review: unknown original lots never inherit current nutrition or fixed relief',()=>{
 const f=fixture(),key='person:'+f.provider.id;
 for(const kind of ['definition','insufficient','missing'] as const){const w=structuredClone(f.w);if(kind==='definition')w.food!.lots[key].turnip![0].definition='missing/original@1';if(kind==='insufficient')w.food!.lots[key].turnip![0].quantity=.5;if(kind==='missing')delete w.food;
  const before=structuredClone(w);let amounts:ReturnType<typeof foodFlowInputs>;captureDirectEating(w,()=>{amounts=foodFlowInputs(w,key,{turnip:1,water:1},1);});assert.deepEqual(w,before);assert.equal(amounts![0].nutrition,null);assert.equal(amounts![1].nutrition,0);
  const r=receipt();r.inputs=amounts!;assert.equal(session([r]).report.childCareMeals.totals!.nutrition,null);assert.equal(session([r]).report.childCareMeals.totals!.hungerRelief,48);
 }
 for(const edit of [(r:ChildCareMealReceipt)=>{r.inputs[0].lots=null;},(r:ChildCareMealReceipt)=>{r.inputs[0].lots![0].quantity=.5;},(r:ChildCareMealReceipt)=>{r.inputs[0].lots![0].expiresAt=r.at;},(r:ChildCareMealReceipt)=>{r.inputs[0].lots![0].producedAt=r.at+1;},(r:ChildCareMealReceipt)=>{r.inputs[0].lots![0].nutrition=null;}]){const r=receipt();edit(r);assert.equal(session([r]).report.childCareMeals.totals,null);}
});

test('child care review: final-menu execution records only success and leaves observed versus unobserved worlds identical',()=>{
 for(const refused of [false,true]){const f=fixture();queue(f);stepWorld(f.w,19.75);assert.ok(f.provider.activity);f.child.refusesCare=refused;
  const plain=structuredClone(f.w),stock=structuredClone(f.provider.inventory);const observation=stepWorldWithFoodEvidence(f.w,.25);stepWorld(plain,.25);assert.deepEqual(f.w,plain);assert.equal(observation.childCareMeals!.length,refused?0:1);assert.equal(f.provider.inventory.turnip,stock.turnip!-(refused?0:1));assert.equal(f.provider.inventory.water,stock.water!-(refused?0:1));assert.equal(JSON.stringify(f.w).includes('childCareMeals'),false);
  if(!refused){const r=observation.childCareMeals![0],event=f.w.events.find(e=>e.id===r.eventId)!;assert.deepEqual(event.audit!.resources,{turnip:1,water:1});assert.equal(r.authority,'guardian');assert.equal(r.hungerRelief,48);assert.equal(r.beneficiaryId,f.child.id);assert.deepEqual(observation.careMeals,[]);}
 }
});

test('child care review: writer sealed roundtrip and missing seal clear both exposed child totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'child-care-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'sealed'),fingerprint='a'.repeat(64);
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'child-review',fromMinute:480});t.after(()=>writer.abort());
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(480);food.start('child-review',480);food.committed({worldId:'child-review',fromMinute:480,toMinute:481,receipts:[],foodFlows:[],careMeals:[],childCareMeals:[receipt()]},1);wait.stop(481);food.stop('child-review',481);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});assert.equal(result.complete,true);assert.equal(result.childCareMeals.totals!.nutrition,13);assert.equal(result.childCareMeals.totals!.hungerRelief,48);assert.deepEqual(readAcceptanceEvidence(directory),result);
 unlinkSync(join(directory,'run-close.json'));const broken=readAcceptanceEvidence(directory);assert.equal(broken.childCareMeals.totals,null);assert.equal(broken.directEating.childCareMeals.totals,null);
});

test('child care review: sync failure after a food row keeps evidence unknown without persisting error text',t=>{
 const root=mkdtempSync(join(testTmpdir(),'child-care-review-sync-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'failure');let fail=false;
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:'child-review',fromMinute:480,io:{fsyncSync:fd=>{if(fail)throw new Error('SYNTHETIC_PRIVATE');fsyncSync(fd);}}});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});food.start('child-review',480);fail=true;
 food.committed({worldId:'child-review',fromMinute:480,toMinute:481,receipts:[],foodFlows:[],careMeals:[],childCareMeals:[receipt()]},1);
 assert.equal(food.status().phase,'failed');assert.equal(writer.status().failure,'sync_failed');const report=readAcceptanceEvidence(directory);assert.equal(report.complete,false);assert.equal(report.childCareMeals.totals,null);assert.equal(report.directEating.childCareMeals.totals,null);assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE'),false);
});
