import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Vec,World} from '../src/shared/types.js';
import type {FrontierDisaster} from '../src/shared/frontier-hazards.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision,parseModelCompletion} from '../src/server/decisions.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,type ModelName} from '../src/server/model-completion.js';
import {frontierHazardOpportunities} from '../src/server/frontier-hazard-opportunities.js';
import {frontierRetreatStepAllowed,seenFrontierDangers} from '../src/world/frontier-hazards.js';
import {distance,findPath} from '../src/world/navigation.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';

// Explicitly synthetic geometry and an already-issued attack warning. Keep the
// formal nine identities, final numbered input and real physics/health engine.
function fixture(health=100){
 const w=createFrontierWorld(5401);w.clock.paused=false;
 const r=w.residents[0],b=w.buildings.find(b=>b.id==='frontier-hall')!;
 Object.assign(b,{at:{x:14,y:5},width:6,height:4,door:{x:17,y:9},capacity:12,condition:100,residents:[]});
 w.buildings=[b];w.map.tiles=w.map.tiles.map(()=> 'grass');w.resources=[];w.plots=[];
 for(const p of w.residents)Object.assign(p,{plan:null,activity:null,at:{x:30,y:30},inside:null,roomAt:null,decisionDue:w.minute+10000});
 Object.assign(r,{at:{x:9,y:9},knownBuildings:[b.id],homeId:null,health,hunger:10,energy:80,lastFailure:null});
 const boar=w.frontierHazards!.beasts.find(x=>x.species==='boar')!;
 Object.assign(boar,{at:{x:13,y:9},den:{x:13,y:9},nextMoveAt:w.minute+1000,cooldownUntil:w.minute+1000,alert:{residentId:r.id,attackAt:w.minute+2}});
 w.frontierHazards!.beasts=[boar];w.frontierHazards!.disasters=[];w.frontierHazards!.nextDisasterAt=w.minute+10000;
 return {w,r,b,boar};
}
const isShelter=(a:Action)=>a.type==='frontierHazard'&&a.operation==='shelter';
const choices=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
function selected(w:World,r:Resident,model:ModelName=GLM_MODEL){
 const context=decisionContext(w,r),prepared=prepareModelDecision(context,undefined,model),row=prepared.choices.find(c=>isShelter(c.action));
 assert.ok(row,'actual final shelter choice');assert.match(row.id,/^\d+$/);
 assert.ok(prepared.messages.some(m=>m.content.includes(row.id+'. '+row.label)));
 return parseModelCompletion(context,prepared,{content:JSON.stringify({choice:row.id}),finish:'stop'},0).decision;
}
let serial=0;
function queue(w:World,r:Resident,actions:Action[]){return submitPlan(w,{id:'shelter-route:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人沿合法路线进入选定共屋避险',actions:structuredClone(actions)});}
function finish(w:World,r:Resident,dt=.25,check:()=>void=()=>{}){let n=500;while(r.plan||r.activity){assert.ok(n-->0,'bounded actual movement');stepWorld(w,dt);check();}}
const completed=(w:World,r:Resident)=>w.events.filter(e=>e.actors.includes(r.id)&&e.text.includes('自行进入')&&e.text.includes('避险'));
function corridor(w:World){w.map.tiles.fill('cliff');for(let x=9;x<=17;x++)w.map.tiles[9*w.map.width+x]='grass';}
function warning(w:World,at:Vec):FrontierDisaster{return {id:'new-visible-warning',kind:'windstorm',at:{...at},radius:0,phase:'warning',warningAt:w.minute,startsAt:w.minute+100,endsAt:w.minute+200,intensity:2,warned:[],exposure:{}};}

for(const [dt,health] of [[.25,100],[1.2,25]] as const)test(`shelter final numbered route avoids a known boar at ${dt}-minute steps with health ${health}`,()=>{
 const {w,r,b,boar}=fixture(health),start={...r.at},inventory=structuredClone(r.inventory),home=r.homeId,residents=[...b.residents];
 assert.equal(w.residents.length,9);assert.equal(distance(r.at,boar.at),4);
 assert.equal(findPath(w,r.at,b.door)!.length,8);
 assert.equal(findPath(w,r.at,b.door,false,48,frontierRetreatStepAllowed(w,r))!.length,16);
 const decision=selected(w,r);assert.equal(queue(w,r,decision.actions).ok,true);assert.deepEqual(r.at,start);
 finish(w,r,dt,()=>assert.ok(distance(r.at,boar.at)>3,'never enter the already-seen danger'));
 assert.equal(r.lastFailure,null);assert.equal(r.status,'alive');assert.equal(r.health,health);assert.equal(r.inside,b.id);assert.deepEqual(r.at,b.door);
 assert.equal(completed(w,r).length,1);assert.deepEqual(r.inventory,inventory);assert.equal(r.homeId,home);assert.deepEqual(b.residents,residents);
 assert.equal(w.frontierHazards!.weather!.enabled,false);assert.equal(w.metrics.requests,0);
});

test('shelter warning alone neither moves the resident nor causes the original crossing injury',()=>{
 const {w,r}=fixture(25),start={...r.at};selected(w,r);assert.equal(r.plan,null);assert.equal(queue(w,r,[{type:'wait',minutes:4}]).ok,true);finish(w,r);
 assert.equal(r.status,'alive');assert.equal(r.health,25);assert.deepEqual(r.at,start);assert.equal(completed(w,r).length,0);
});

for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const)test(`shelter danger-aware opportunity survives the ${model} final numbered input without mutation`,()=>{
 const {w,r}=fixture();selected(w,r,model);const before=structuredClone(w);selected(w,r,model);assert.deepEqual(w,before);
});

test('shelter is absent when its only path enters known danger, and an old selected reply cannot start it',()=>{
 const {w,r,b}=fixture(),old=selected(w,r),start={...r.at};corridor(w);
 assert.ok(findPath(w,r.at,b.door));assert.equal(findPath(w,r.at,b.door,false,48,frontierRetreatStepAllowed(w,r)),null);
 assert.ok(!choices(w,r).choices.some(c=>isShelter(c.action)));
 assert.equal(queue(w,r,old.actions).ok,true);finish(w,r);
 assert.deepEqual(r.at,start);assert.match(r.lastFailure!,/可达路线/);assert.equal(completed(w,r).length,0);
});

test('shelter chooses an independently reachable known building when a nearer one requires entering danger',()=>{
 const {w,r,b}=fixture();corridor(w);
 const other={...structuredClone(b),id:'other-shelter',name:'另一个已有共屋',at:{x:0,y:5},door:{x:1,y:9},width:2,height:4};
 w.buildings.push(other);r.knownBuildings.push(other.id);
 // Make the unsafe original nearer, without changing the actor's right to it.
 b.door={x:14,y:9};b.at={x:14,y:5};
 for(let x=1;x<=9;x++)w.map.tiles[9*w.map.width+x]='grass';
 const row=frontierHazardOpportunities(w,r).find(c=>isShelter(c.action));assert.ok(row);
 assert.equal((row.action as Extract<Action,{type:'frontierHazard';operation:'shelter'}>).buildingId,other.id);
});

test('a person already inside a known danger may leave it on the way to their chosen shelter without re-entering',()=>{
 const {w,r,b,boar}=fixture();r.at={x:10,y:9};delete boar.alert;
 const decision=selected(w,r);assert.equal(queue(w,r,decision.actions).ok,true);let left=false;
 finish(w,r,.25,()=>{const outside=distance(r.at,boar.at)>3;if(left)assert.ok(outside,'no re-entry after leaving');left ||= outside;});
 assert.equal(left,true);assert.equal(r.lastFailure,null);assert.equal(r.inside,b.id);assert.equal(completed(w,r).length,1);
});

for(const change of ['visible warning','tree'] as const)test(`a ${change} appearing on a selected shelter route stops movement before the blocked step`,()=>{
 const {w,r}=fixture();assert.equal(queue(w,r,selected(w,r).actions).ok,true);stepWorld(w,.25);
 assert.ok(r.activity?.path.length);const next={...r.activity.path[0]},start={...r.at},remaining=r.activity.remaining;
 if(change==='visible warning')w.frontierHazards!.disasters.push(warning(w,next));
 else w.resources.push({id:'new-route-tree',kind:'tree',at:next,amount:1,max:1,regrowthDays:0,lastHarvest:w.minute});
 stepWorld(w,.75);assert.deepEqual(r.at,start);assert.match(r.lastFailure!,/阻挡/);assert.equal(r.activity,null);assert.equal(r.plan,null);assert.equal(completed(w,r).length,0);assert.equal(remaining,1);
});

test('unseen distant wildlife does not alter the personal shelter choice or its safe path',()=>{
 const {w,r,b,boar}=fixture(),initial=selected(w,r),path=findPath(w,r.at,b.door,false,48,frontierRetreatStepAllowed(w,r));
 const hidden={...structuredClone(boar),id:'unseen-boar',at:{x:35,y:9},den:{x:35,y:9}};delete hidden.alert;w.frontierHazards!.beasts.push(hidden);
 assert.ok(!seenFrontierDangers(w,r).some(d=>d.id===hidden.id));assert.deepEqual(selected(w,r),initial);
 assert.deepEqual(findPath(w,r.at,b.door,false,48,frontierRetreatStepAllowed(w,r)),path);
 assert.ok(!JSON.stringify(decisionContext(w,r)).includes(hidden.id));
});

test('SQLite preserves a fractional shelter route and rechecks an unsafe saved legacy path rather than following it',()=>{
 const {w,r,b,boar}=fixture();assert.equal(queue(w,r,selected(w,r).actions).ok,true);stepWorld(w,.25);
 const store=new WorldStore(':memory:');try{
  store.commit(w,null);const loaded=store.load()!,p=loaded.residents.find(p=>p.id===r.id)!;assert.deepEqual(p.activity,r.activity);
  finish(loaded,p,1.2,()=>assert.ok(distance(p.at,boar.at)>3));assert.equal(p.inside,b.id);assert.equal(p.health,100);assert.equal(completed(loaded,p).length,1);
  const old=store.load()!,q=old.residents.find(p=>p.id===r.id)!;q.activity!.path=findPath(old,q.at,b.door)!;const start={...q.at};
  const prior=old.revision;old.revision++;store.commit(old,prior);const restored=store.load()!,actor=restored.residents.find(p=>p.id===r.id)!;
  stepWorld(restored,.75);assert.deepEqual(actor.at,start);assert.match(actor.lastFailure!,/阻挡/);assert.equal(actor.activity,null);assert.equal(completed(restored,actor).length,0);
 }finally{store.close();}
});

for(const change of ['capacity','permission','condition'] as const)test(`shelter still revalidates ${change} at the final quarter-minute without relocating the destination`,()=>{
 const {w,r,b}=fixture();assert.equal(queue(w,r,selected(w,r).actions).ok,true);
 let n=200;while(!r.activity||r.activity.path.length){assert.ok(n-->0);stepWorld(w,.25);}assert.deepEqual(r.at,b.door);stepWorld(w,.75);assert.equal(r.activity!.remaining,.25);
 if(change==='capacity')b.capacity=0;if(change==='permission')b.ownerId=w.residents[1].id;if(change==='condition')b.condition=0;
 stepWorld(w,.25);assert.equal(r.inside,null);assert.deepEqual(r.at,b.door);assert.match(r.lastFailure!,/遮蔽/);assert.equal(completed(w,r).length,0);
});
