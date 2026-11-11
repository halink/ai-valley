import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World,Proposal} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {executeSocialAction} from '../src/world/social.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {initializeFood} from '../src/world/food.js';
import {YEAR} from '../src/world/time.js';
import {WorldStore} from '../src/server/store.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.resources=[];w.plots=[];w.buildings=[];
 for(const r of w.residents){r.at={x:30,y:30};r.inside=null;r.roomAt=null;r.homeId=null;r.plan=null;r.activity=null;r.canDecide=r.canExpress=true;r.health=80;r.energy=100;r.hunger=50;r.skills.care=2;r.inventory={meal:5,water:5};}
 const [provider,patient,stranger]=w.residents;
 const p:Proposal={id:'review-care',actorId:provider.id,targetId:patient.id,kind:'care',status:'accepted',createdAt:w.minute,expiresAt:w.minute+1440,definition:w.activeDefinitions['action/routine']};w.proposals.push(p);
 return {w,provider,patient,stranger,p};
}
const stop=(p:Proposal):Action=>({type:'respond',proposalId:p.id,accept:false});
const care=(r:Resident,p?:Proposal):Action=>({type:'care',targetId:r.id,...(p?{proposalId:p.id}:{})} as Action);
function submit(w:World,r:Resident,actions:Action[]){return submitPlan(w,{id:`review:${r.id}:${r.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立停止这一次照护',actions});}

test('review: real menus retain accepted care withdrawal and bind provider action to exact consent',()=>{
 const {w,provider,patient,p}=fixture();
 assert.ok(decisionChoices(decisionContext(w,patient)).some(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&!c.action.accept));
 const a=decisionChoices(decisionContext(w,provider)).find(c=>c.action.type==='care'&&c.action.targetId===patient.id)?.action;
 assert.equal((a as Action&{proposalId?:string})?.proposalId,p.id);
});

test('review: expressive patient stops immediately without deciding, travelling, or informing distant provider',()=>{
 const {w,provider,patient,p}=fixture();provider.at={x:60,y:40};provider.canDecide=false;patient.canDecide=false;
 const at=structuredClone(patient.at),memories=structuredClone(provider.memories);
 assert.equal(submit(w,patient,[stop(p)]).ok,true);assert.equal(p.status,'declined');assert.deepEqual(patient.at,at);assert.equal(patient.activity,null);assert.equal(patient.refusesCare,false);assert.deepEqual(provider.memories,memories);
 assert.equal(submit(w,patient,[{type:'eat',item:'meal'}]).ok,false);
});

test('review: mixed stop plan is rejected atomically and unrelated resident cannot revoke',()=>{
 const {w,patient,stranger,p}=fixture();
 assert.equal(submit(w,patient,[stop(p),{type:'eat',item:'meal'}]).ok,false);assert.equal(p.status,'accepted');
 assert.equal(executeSocialAction(w,stranger,stop(p)).ok,false);assert.equal(p.status,'accepted');
});

test('review: a stale bound care never falls through to another consent or emergency',()=>{
 for(const emergency of [false,true]){
  const {w,provider,patient,p}=fixture();p.status='declined';w.proposals.push({...p,id:'independent-consent',status:'accepted'});
  if(emergency){patient.canDecide=false;patient.canExpress=false;patient.health=10;}
  const inv=structuredClone(provider.inventory),health=patient.health;
  assert.equal(executeSocialAction(w,provider,care(patient,p)).ok,false);assert.deepEqual(provider.inventory,inv);assert.equal(patient.health,health);
 }
});

test('review: withdrawing one agreement preserves a separately accepted agreement',()=>{
 const {w,provider,patient,p}=fixture();const other={...p,id:'another-specific-care'};w.proposals.push(other);
 assert.equal(submit(w,patient,[stop(p)]).ok,true);assert.equal(p.status,'declined');assert.equal(other.status,'accepted');assert.equal(patient.refusesCare,false);
 assert.equal(executeSocialAction(w,provider,care(patient,other)).ok,true);assert.equal(other.status,'expired');assert.equal(provider.inventory.meal,4);
});

test('review: stop wins against the final work tick and duplicate completion spends nothing',()=>{
 const {w,provider,patient,p}=fixture();assert.equal(submit(w,provider,[care(patient,p)]).ok,true);stepWorld(w,1);assert.ok(provider.activity);provider.activity.remaining=1;
 assert.equal(submit(w,patient,[stop(p)]).ok,true);const inv=structuredClone(provider.inventory);stepWorld(w,1);
 assert.deepEqual(provider.inventory,inv);assert.equal(executeSocialAction(w,provider,care(patient,p)).ok,false);assert.deepEqual(provider.inventory,inv);
});

test('review: reload never upgrades an unbound legacy care activity to current accepted authority',()=>{
 const {w,provider,patient,p}=fixture();
 provider.activity={planId:'legacy-unbound',action:care(patient),startedAt:w.minute,remaining:1,path:[],target:{...patient.at},definition:w.activeDefinitions['action/routine']};
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!,helper=loaded.residents.find(r=>r.id===provider.id)!;const inv=structuredClone(helper.inventory);stepWorld(loaded,1);assert.deepEqual(helper.inventory,inv);assert.equal(loaded.proposals.find(x=>x.id===p.id)!.status,'accepted');}finally{store.close();}
});

test('review: accepted non-care commitments cannot be revoked through the narrow care stop',()=>{
 const {w,patient,p}=fixture();p.kind='child';assert.equal(executeSocialAction(w,patient,stop(p)).ok,false);assert.equal(p.status,'accepted');
});


test('review: expression loss, death, departure, expiry and completed consent fail without mutations',()=>{
 for(const change of ['mute','dead','outside','expired','completed'] as const){
  const {w,patient,p}=fixture();if(change==='mute')patient.canExpress=false;if(change==='dead')patient.status='dead';if(change==='outside')patient.residency='outside';if(change==='expired')p.expiresAt=w.minute;if(change==='completed')p.status='expired';
  const before=structuredClone(w);assert.equal(submit(w,patient,[stop(p)]).ok,false,change);assert.deepEqual(w,before,change);
 }
});

test('review: invalid bound identifiers and mismatched parties never consume care supplies',()=>{
 for(const change of ['missing','wrong-provider','wrong-patient','non-care','expired','null'] as const){
  const {w,provider,patient,stranger,p}=fixture();const a=care(patient,p) as Action&{proposalId:unknown};
  if(change==='missing')a.proposalId='missing';if(change==='null')a.proposalId=null;if(change==='wrong-provider')p.actorId=stranger.id;if(change==='wrong-patient')p.targetId=stranger.id;if(change==='non-care')p.kind='dating';if(change==='expired')p.expiresAt=w.minute;
  initializeFood(w);const before=structuredClone(w);assert.equal(executeSocialAction(w,provider,a as Action).ok,false,change);assert.deepEqual(w,before,change);
 }
});

test('review: parser rejects hidden authority and extra mixed fields rather than accepting model replacements',()=>{
 const {w,provider,patient,p}=fixture();const choices=decisionChoices(decisionContext(w,provider));const selected=choices.find(c=>c.action.type==='care')!;assert.ok(selected);
 for(const injected of [{proposalId:'forged'},{targetId:provider.id},{accept:false},{actions:[stop(p)]},{authority:'emergency'}])assert.throws(()=>parseChoice(JSON.stringify({choice:selected.id,...injected}),choices));
 assert.equal((parseChoice(JSON.stringify({choice:selected.id}),choices).actions[0] as Action&{proposalId?:string}).proposalId,p.id);
});

test('review: capable young recipients retain a normal-menu stop without gaining other action permissions',()=>{
 const {w,patient,p}=fixture();patient.bornAt=w.minute-4*YEAR;
 assert.ok(decisionChoices(decisionContext(w,patient)).some(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&!c.action.accept));
 assert.equal(submit(w,patient,[stop(p)]).ok,true);
});

test('review: capable idle recipients keep care stop in ferry, escort and family-travel menu branches',()=>{
 for(const branch of ['aboard','passenger','familyTravelling'] as const){
  const {w,patient,p}=fixture();const context=decisionContext(w,patient);context.formal![branch]=true;
  assert.ok(decisionChoices(context).some(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&!c.action.accept),branch);
 }
});

test('review: each outstanding care stop survives a crowded normal menu',()=>{
 const {w,patient,p}=fixture();for(let i=0;i<35;i++)w.proposals.push({...p,id:'review-crowd-'+i});
 const stops=new Set(decisionChoices(decisionContext(w,patient)).flatMap(c=>c.action.type==='respond'&&!c.action.accept?[c.action.proposalId]:[]));
 for(const proposal of w.proposals)assert.ok(stops.has(proposal.id),proposal.id);
});

test('review: actual runtime schedules an expressive impaired patient and commits only the chosen stop',async()=>{
 const {w,patient,p}=fixture();patient.canDecide=false;patient.decisionDue=w.minute;for(const r of w.residents)if(r!==patient)r.decisionDue=w.minute+1000;
 const store=new WorldStore(':memory:');store.commit(w,null);let calls=0;
 const runtime=new ValleyRuntime(store,'review-local-fake-key',async(_key,context)=>{if(context.actor.id!==patient.id)return new Promise<import('../src/server/decisions.js').ModelResult>(()=>{});calls++;const choices=decisionChoices(context);const c=choices.find(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&!c.action.accept)!;assert.ok(c);assert.ok(choices.every(c=>c.action.type==='wait'||c.action.type==='respond'));return {decision:{intention:'本人停止一次照护',actions:[c.action]},inputTokens:1,outputTokens:1,latencyMs:1};});
 for(const r of runtime.world.residents)r.decisionDue=r.id===patient.id?runtime.world.minute:runtime.world.minute+1000;
 try{runtime.start();for(let i=0;i<5;i++)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(runtime.world.proposals.find(c=>c.id===p.id)!.status,'declined');assert.equal(runtime.world.residents.find(r=>r.id===patient.id)!.canDecide,false);}finally{runtime.stop();store.close();}
});


test('review: injected mixed stop fields cannot acquire unrelated authority',()=>{
 for(const fields of [{targetId:'other'},{operation:'visit'},{authority:'emergency'},{actions:[{type:'eat',item:'meal'}]},{accept:true}]){
  const {w,patient,p}=fixture();patient.canDecide=false;const before=structuredClone(w);
  assert.equal(submit(w,patient,[{...stop(p),...fields} as Action]).ok,false);assert.deepEqual(w,before);
 }
});

test('review: successful completed provision cannot be rolled back or repeated by stale stop or care',()=>{
 const {w,provider,patient,p}=fixture();assert.equal(executeSocialAction(w,provider,care(patient,p)).ok,true);const health=patient.health,inv=structuredClone(provider.inventory),events=w.events.length;
 assert.equal(submit(w,patient,[stop(p)]).ok,false);assert.equal(executeSocialAction(w,provider,care(patient,p)).ok,false);assert.equal(p.status,'expired');assert.equal(patient.health,health);assert.deepEqual(provider.inventory,inv);assert.equal(w.events.length,events);
});
