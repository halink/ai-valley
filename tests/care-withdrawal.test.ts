import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Plan,Resident,Tile,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {executeSocialAction} from '../src/world/social.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {ModelResult} from '../src/server/decisions.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(414);w.mode='formal';w.clock.paused=false;
 w.map={name:'一次照护撤回隔离世界',width:24,height:18,tiles:Array<Tile>(432).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents)Object.assign(r,{at:{x:11,y:8},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,status:'alive',residency:'resident',health:100,energy:100,hunger:0,canDecide:true,canExpress:true,refusesCare:false,inventory:{water:9,meal:10},skills:{farming:1,building:1,care:2},knownBuildings:[],knownResources:[],guardianIds:[],plan:null,activity:null,lastFailure:null,decisionDue:w.minute});
 const [helper,patient,remote]=w.residents;patient.hunger=80;remote.at={x:1,y:16};
 for(const r of w.residents)r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);
 return {w,helper,patient,remote};
}
let serial=0;
const plan=(w:World,r:Resident,actions:Action[]):Plan=>({id:'care-withdrawal:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人一次决定',actions});
function choose(w:World,r:Resident,predicate:(a:Action)=>boolean){const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>predicate(c.action));assert.ok(choice,'the actual final menu must retain this choice');return parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];}
function run(w:World,r:Resident,a:Action){const result=submitPlan(w,plan(w,r,[a]));assert.equal(result.ok,true,result.error);let limit=500;while(r.activity||r.plan){assert.ok(limit-->0);stepWorld(w,.25);}assert.equal(r.lastFailure,null);}
function accept(f:ReturnType<typeof fixture>){
 run(f.w,f.helper,choose(f.w,f.helper,a=>a.type==='propose'&&a.proposal==='care'&&a.targetId===f.patient.id));
 const p=f.w.proposals.at(-1)!;
 run(f.w,f.patient,choose(f.w,f.patient,a=>a.type==='respond'&&a.proposalId===p.id&&a.accept));
 assert.equal(p.status,'accepted');return p;
}
const provisionCount=(w:World)=>w.events.filter(e=>e.kind==='care'&&e.audit?.scope?.includes('basic-care')).length;

test('care withdrawal: actual final menu accepts, withdraws immediately, and blocks the queued provision',()=>{
 const f=fixture(),p=accept(f);
 const care=choose(f.w,f.helper,a=>a.type==='care'&&a.targetId===f.patient.id);
 const stop=choose(f.w,f.patient,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept);
 assert.equal(submitPlan(f.w,plan(f.w,f.helper,[care])).ok,true);
 const before={inventory:{...f.helper.inventory},hunger:f.patient.hunger,health:f.patient.health};
 assert.equal(submitPlan(f.w,plan(f.w,f.patient,[stop])).ok,true);
 assert.equal(p.status,'declined','a stop takes effect at submission, not after a walk or three minutes');
 assert.equal(f.patient.activity,null);assert.equal(f.patient.plan,null);
 stepWorld(f.w,35);
 assert.deepEqual(f.helper.inventory,before.inventory);assert.equal(provisionCount(f.w),0);assert.equal(f.patient.health,before.health);assert.ok(f.patient.hunger>=before.hunger);
 assert.equal(f.patient.refusesCare,false,'one proposal is not a permanent/global care ban');
});

test('care withdrawal: en route, during work and the final quarter minute revalidate the same proposal',()=>{
 for(const phase of ['travel','work','completion'] as const)for(const reverse of [false,true]){
  const f=fixture(),p=accept(f);if(reverse)f.w.residents.reverse();
  const care=choose(f.w,f.helper,a=>a.type==='care'&&a.targetId===f.patient.id);
  if(phase==='travel')f.helper.at={x:3,y:8};
  assert.equal(submitPlan(f.w,plan(f.w,f.helper,[care])).ok,true);
  stepWorld(f.w,phase==='completion'?29.75:.25);assert.ok(f.helper.activity);
  if(phase==='travel')assert.ok(f.helper.activity.path.length);
  const stock={...f.helper.inventory},at={...f.helper.at};
  run(f.w,f.patient,choose(f.w,f.patient,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept));
  stepWorld(f.w,.25);
  assert.equal(f.helper.activity,null);assert.deepEqual(f.helper.inventory,stock);assert.equal(provisionCount(f.w),0);if(phase==='travel')assert.deepEqual(f.helper.at,at);
 }
});

test('care withdrawal: a delivered single episode cannot be undone or consumed twice',()=>{
 const f=fixture(),p=accept(f),care=choose(f.w,f.helper,a=>a.type==='care'&&a.targetId===f.patient.id);
 const stop=choose(f.w,f.patient,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept),stock={...f.helper.inventory};
 run(f.w,f.helper,care);assert.equal(p.status,'expired');assert.equal(provisionCount(f.w),1);assert.equal(f.helper.inventory.meal,stock.meal!-1);assert.equal(f.helper.inventory.water,stock.water!-1);
 assert.equal(submitPlan(f.w,plan(f.w,f.patient,[stop])).ok,false);
 assert.equal(executeSocialAction(f.w,f.helper,care).ok,false);assert.equal(provisionCount(f.w),1);
 assert.ok(!decisionChoices(decisionContext(f.w,f.patient)).some(c=>c.action.type==='respond'&&c.action.proposalId===p.id));
});

test('care withdrawal: an expressive recipient can stop without gaining unrelated decision power',()=>{
 const f=fixture(),p=accept(f);f.patient.canDecide=false;
 const menu=decisionChoices(decisionContext(f.w,f.patient));assert.ok(menu.some(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&!c.action.accept));
 assert.ok(menu.every(c=>c.action.type==='wait'||c.action.type==='respond'&&!c.action.accept));
 const stop=choose(f.w,f.patient,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept);
 const before=structuredClone(f.w);assert.equal(planStartError(f.w,plan(f.w,f.patient,[stop])),null);assert.deepEqual(f.w,before);
 assert.equal(submitPlan(f.w,plan(f.w,f.patient,[{type:'eat',item:'meal'}])).ok,false);
 assert.equal(submitPlan(f.w,plan(f.w,f.patient,[stop])).ok,true);assert.equal(p.status,'declined');assert.equal(f.patient.canDecide,false);
});

test('care withdrawal: SQLite reload preserves refusal and rejects old unbound consent work',()=>{
 for(const legacy of [false,true]){
  const f=fixture(),p=accept(f),care=choose(f.w,f.helper,a=>a.type==='care'&&a.targetId===f.patient.id);
  assert.equal(submitPlan(f.w,plan(f.w,f.helper,[care])).ok,true);stepWorld(f.w,.25);
  if(legacy)delete (f.helper.activity!.action as Action&{proposalId?:string}).proposalId;
  else run(f.w,f.patient,choose(f.w,f.patient,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept));
  const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,helper=w.residents.find(r=>r.id===f.helper.id)!,stock={...helper.inventory};stepWorld(w,35);assert.deepEqual(helper.inventory,stock);assert.equal(provisionCount(w),0);assert.ok(helper.lastFailure);assert.equal(w.proposals.find(v=>v.id===p.id)!.status,legacy?'accepted':'declined');}finally{store.close();}
 }
});

test('care withdrawal: a busy recipient retains only stop controls without replacing their chosen work',()=>{
 const f=fixture(),p=accept(f);
 assert.equal(submitPlan(f.w,plan(f.w,f.patient,[{type:'wait',minutes:120}])).ok,true);stepWorld(f.w,.25);
 const ownPlan=structuredClone(f.patient.plan),activity=structuredClone(f.patient.activity);
 const menu=decisionChoices(decisionContext(f.w,f.patient));assert.ok(menu.every(c=>c.action.type==='wait'||c.action.type==='respond'&&!c.action.accept));
 const wait=choose(f.w,f.patient,a=>a.type==='wait');assert.equal(submitPlan(f.w,plan(f.w,f.patient,[wait])).ok,true);assert.deepEqual(f.patient.plan,ownPlan);assert.deepEqual(f.patient.activity,activity);
 const stop=choose(f.w,f.patient,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept);assert.equal(submitPlan(f.w,plan(f.w,f.patient,[stop])).ok,true);assert.equal(p.status,'declined');assert.deepEqual(f.patient.plan,ownPlan);assert.deepEqual(f.patient.activity,activity);
});

test('care withdrawal: real runtime schedules an expressive recipient and applies the final-menu stop',async()=>{
 for(const busy of [false,true]){
  const f=fixture(),p=accept(f);f.patient.canDecide=false;
  if(busy)f.patient.plan=plan(f.w,f.patient,[{type:'wait',minutes:120}]);
  const store=new WorldStore(':memory:');store.commit(f.w,null);let called=false;
  const runtime=new ValleyRuntime(store,'offline-test-key',async(_key,context)=>{
   if(context.actor.id!==f.patient.id)return new Promise<ModelResult>(()=>{});
   called=true;const menu=decisionChoices(context),choice=menu.find(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&!c.action.accept);assert.ok(choice);
   assert.ok(menu.every(c=>c.action.type==='wait'||c.action.type==='respond'&&!c.action.accept));
   return {decision:parseChoice(JSON.stringify({choice:choice.id}),menu),inputTokens:1,outputTokens:1,latencyMs:1};
  });
  try{runtime.start();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.equal(called,true);assert.equal(runtime.world.proposals.find(v=>v.id===p.id)!.status,'declined');assert.equal(runtime.world.residents.find(r=>r.id===f.patient.id)!.canDecide,false);assert.equal(provisionCount(runtime.world),0);}finally{runtime.stop();store.close();}
 }
});
