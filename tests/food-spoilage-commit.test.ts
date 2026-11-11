import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import type {World} from '../src/shared/types.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeCivic} from '../src/world/civic.js';
import {advanceFood,initializeFood} from '../src/world/food.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';

const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
const stock='spoilage-test',container='public:'+stock;
function fixture(){
 const w=createFrontierWorld();w.clock.paused=false;
 w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const beast of w.frontierHazards!.beasts){beast.nextMoveAt=w.minute+10000;beast.cooldownUntil=w.minute+10000;}
 for(const r of w.residents){r.hunger=10;r.health=r.energy=100;r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 initializeCivic(w);w.civic!.stores[stock]={berry:3,milk:2};
 for(const [item,n] of [['berry',3],['milk',2]] as const)w.economy!.treasuryStock[item]=(w.economy!.treasuryStock[item]??0)+n;
 initializeFood(w);
 w.definitions['food/loss-test@1']={id:'food/loss-test',version:1,kind:'life',dependencies:[],data:{nutrition:{berry:7,milk:11}}};
 for(const lots of Object.values(w.food!.lots[container]))for(const lot of lots!){lot.producedAt=w.minute;lot.expiresAt=w.minute+1;lot.definition='food/loss-test@1';}
 return w;
}
function offline(t:TestContext){
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,fetchCalls=0,modelCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('No network');});
 const model=async()=>{modelCalls++;throw new Error('No model');};
 t.after(()=>{assert.equal(fetchCalls,0);assert.equal(modelCalls,0);});
 return {model,next:()=>now+=1000};
}
function createRuntime(t:TestContext,w:World,model:ReturnType<typeof offline>['model'],events?:RuntimeFoodEvent[]){
 const store=new WorldStore(':memory:');store.commit(structuredClone(w),null);t.after(()=>store.close());
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',...(events?{directEatingEvidence:{observe:(e:RuntimeFoodEvent)=>{events.push(e);}}}:{})});
 t.after(()=>runtime.stop());runtime.start();return {store,runtime};
}
function assertSpoiled(w:World){
 assert.equal(w.civic!.stores[stock].berry,0);assert.equal(w.civic!.stores[stock].milk,0);
 assert.equal(w.food!.spoiled.berry,3);assert.equal(w.food!.spoiled.milk,2);
 assert.equal(w.food!.lots[container]?.berry?.length??0,0);assert.equal(w.food!.lots[container]?.milk?.length??0,0);
}
function assertLosses(events:RuntimeFoodEvent[],runtime:ValleyRuntime){
 const losses=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus()).foodLosses;
 assert.equal(losses.complete,true,losses.issues.join(', '));assert.equal(losses.observedReceipts.length,2);
 assert.deepEqual(losses.totals,{units:{berry:3,milk:2},nutrition:43});
 for(const receipt of losses.observedReceipts){
  assert.equal(receipt.type,'loss');assert.equal(receipt.cause,'spoilage');assert.equal(receipt.container,container);
  assert.equal(receipt.containerType,'public');assert.ok(receipt.amount.lots?.length);
  assert.equal(receipt.amount.nutrition,receipt.amount.item==='berry'?21:22);
  for(const lot of receipt.amount.lots!){assert.equal(lot.definition,'food/loss-test@1');assert.ok(lot.expiresAt<=receipt.at);}
 }
 for(const event of events)if(event.type==='food_step_committed'){
  assert.equal(event.foodLossCoverage,'advance_food_spoilage_v1');assert.deepEqual(event.receipts,[]);
  assert.deepEqual(event.foodLosses!.map(l=>l.occurrence),event.foodLosses!.map((_,i)=>i+1));
 }
 return losses;
}

test('real SQLite failure rolls back the complete spoilage draft and all tables; retry publishes exactly once and reload never replays',t=>{
 const {model,next}=offline(t),events:RuntimeFoodEvent[]=[];
 const {store,runtime}=createRuntime(t,fixture(),model,events);
 const db=(store as unknown as {db:DatabaseSync}).db;
 const tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length;
 db.exec("CREATE TEMP TRIGGER reject_spoilage BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_spoilage_sql_failure'); END");
 assert.throws(()=>runtime.tick(next()),/synthetic_spoilage_sql_failure/);
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);assert.deepEqual(snapshot(),sqlBefore);
 assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);
 db.exec('DROP TRIGGER reject_spoilage');runtime.tick(next());assertSpoiled(runtime.world);
 for(let i=0;i<3;i++)runtime.tick(next());runtime.stop();assertLosses(events,runtime);assertSpoiled(store.loadForRuntime()!);
 assert.doesNotMatch(JSON.stringify(store.loadForRuntime()),/"(?:foodLosses|foodLossCoverage|observedReceipts)"\s*:/);
 const restartedEvents:RuntimeFoodEvent[]=[];
 const restarted=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{restartedEvents.push(e);}}});
 t.after(()=>restarted.stop());restarted.start();for(let i=0;i<3;i++)restarted.tick(next());restarted.stop();assertSpoiled(restarted.world);
 const report=auditRuntimeFoodEvidence(restartedEvents,restarted.directEatingEvidenceStatus()).foodLosses;
 assert.equal(report.complete,true,report.issues.join(', '));assert.deepEqual(report.observedReceipts,[]);
});

test('enabled and disabled spoilage evidence preserve the whole world, decision menus and durable save',t=>{
 const {model,next}=offline(t),w=fixture(),events:RuntimeFoodEvent[]=[];
 const disabled=createRuntime(t,w,model),enabled=createRuntime(t,w,model,events);
 for(let i=0;i<4;i++){const now=next();disabled.runtime.tick(now);enabled.runtime.tick(now);}
 disabled.runtime.stop();enabled.runtime.stop();assertSpoiled(enabled.runtime.world);
 assert.equal(disabled.runtime.directEatingEvidenceStatus(),null);assert.deepEqual(disabled.runtime.world,enabled.runtime.world);
 assert.deepEqual(disabled.store.loadForRuntime(),enabled.store.loadForRuntime());
 for(const r of disabled.runtime.world.residents){
  const other=enabled.runtime.world.residents.find(x=>x.id===r.id)!;
  assert.deepEqual(decisionChoices(decisionContext(disabled.runtime.world,r)),decisionChoices(decisionContext(enabled.runtime.world,other)));
 }
 assertLosses(events,enabled.runtime);
});

test('a real competing store revision rejects spoiled drafts without publishing or overwriting the winning save',t=>{
 const {model,next}=offline(t),events:RuntimeFoodEvent[]=[];
 const {store,runtime}=createRuntime(t,fixture(),model,events);
 const before=structuredClone(runtime.world),status=runtime.directEatingEvidenceStatus(),count=events.length;
 const winner=store.loadForRuntime()!,revision=winner.revision;winner.revision++;store.commit(winner,revision);
 const saved=store.loadForRuntime();assert.throws(()=>runtime.tick(next()),/stale_world_revision/);
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);
 assert.equal(events.length,count);assert.deepEqual(runtime.directEatingEvidenceStatus(),status);
});

test('expiry wins over pending eat and forecast-copy spoilage never leaks into the real observation',t=>{
 offline(t);const w=fixture(),r=w.residents[0];r.inventory.meal=1;initializeFood(w);
 const container='person:'+r.id;
 for(const lot of w.food!.lots[container].meal!){lot.expiresAt=w.minute+1;}
 const result=submitPlan(w,{id:'spoilage-pending-eat',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'Offline expiry race',actions:[{type:'eat',item:'meal'}]});
 assert.ok(result.ok,result.error);
 const observation=stepWorldWithFoodEvidence(w,6);
 assert.equal(r.inventory.meal,0);assert.ok(r.lastFailure);assert.deepEqual(observation.receipts,[]);
 assert.equal(observation.foodLosses!.filter(l=>l.container===container&&l.amount.item==='meal').length,1);
 const actual=fixture(),copy=structuredClone(actual),original=structuredClone(actual);
 const noLeak=captureDirectEating(actual,()=>{copy.minute++;advanceFood(copy);});
 assertSpoiled(copy);assert.deepEqual(actual,original);assert.deepEqual(noLeak.foodLosses,[]);
 const real=stepWorldWithFoodEvidence(actual,1);assert.equal(real.foodLosses!.length,2);
 assert.deepEqual(stepWorldWithFoodEvidence(actual,1).foodLosses,[]);
});

test('legacy expired lots with unknown nutrition keep physical losses and preserve null through commit and audit',t=>{
 const {model,next}=offline(t),w=fixture(),events:RuntimeFoodEvent[]=[];
 delete (w.definitions['food/loss-test@1'].data.nutrition as Record<string,number>).milk;
 const {store,runtime}=createRuntime(t,w,model,events);runtime.tick(next());runtime.stop();assertSpoiled(runtime.world);
 const losses=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus()).foodLosses;
 assert.equal(losses.complete,true,losses.issues.join(', '));assert.deepEqual(losses.totals,{units:{berry:3,milk:2},nutrition:null});
 const milk=losses.observedReceipts.find(l=>l.amount.item==='milk')!;
 assert.equal(milk.amount.nutrition,null);assert.equal(milk.amount.lots![0].nutrition,null);
 assert.equal(losses.observedReceipts.find(l=>l.amount.item==='berry')!.amount.nutrition,21);
 assertSpoiled(store.loadForRuntime()!);
});
