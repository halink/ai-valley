import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Resource,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {waterSupplyOpportunities} from '../src/server/water-supply-opportunities.js';
import {formalOpportunities} from '../src/server/formal-opportunities.js';
import {initializeWaterSupply} from '../src/world/water-supply.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {DAY} from '../src/world/time.js';

function fixture(){
 const w=createWorld(),r=w.residents[0];w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={width:40,height:40,tiles:Array(1600).fill('grass'),entrance:{x:0,y:0},name:'合成泉水观察'};
 const wall={...w.buildings[0],id:'sight-wall',at:{x:22,y:19},width:1,height:3,door:{x:22,y:22}};
 w.buildings=[];w.residents=[r];w.plots=[];w.graves=[];w.events=[];
 const spring:Resource={id:'visible-test-spring',kind:'spring' as const,at:{x:24,y:20},amount:180,max:180,regrowthDays:0,lastHarvest:0};w.resources=[spring];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,knownBuildings:[],knownResources:[spring.id],knownPeople:[],inventory:{water:0,wood:4,stone:4},memories:[],activity:null,plan:null,lastFailure:null,hunger:20,energy:100,health:100});
 initializeWaterSupply(w);const vessel={id:'spring-test-vessel',ownerId:r.id,buildingId:null,capacity:6 as const,amount:0,quality:'safe' as const,createdAt:w.minute};w.waterSupply!.vessels.push(vessel);
 return {w,r,spring,wall,vessel};
}
const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
function plan(w:World,r:Resident,actions:Action[]){return {id:`spring:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择核实泉水',actions};}
function queue(w:World,r:Resident,a:Action){const p=plan(w,r,[a]);assert.equal(submitPlan(w,p).ok,true);return p;}
function choose(w:World,r:Resident,match:(a:Action)=>boolean){const p=prepared(w,r),c=p.choices.find(c=>match(c.action));assert.ok(c,'present in final actual menu');assert.ok(p.messages[0].content.includes(c.id+'. '+c.label));return parseChoice(JSON.stringify({choice:c.id}),p.choices).actions[0];}
function finish(w:World,r:Resident){let ticks=500;while(r.plan||r.activity){assert.ok(ticks--,'action finishes');stepWorld(w,1);}}
const gathers=(id:string)=>(a:Action)=>a.type==='gather'&&a.resourceId===id;
const visits=(at:{x:number;y:number})=>(a:Action)=>a.type==='move'&&a.to.x===at.x&&a.to.y===at.y;

test('seed 5401: house-occluded known spring stock cannot change final menu or prompt',()=>{
 const w=createFrontierWorld(),r=w.residents.find(r=>r.name==='葛慈')!,s=w.resources.find(s=>s.id==='spring-419-233')!;
 assert.ok(Math.hypot(r.at.x-s.at.x,r.at.y-s.at.y)<=12);assert.equal(r.inside,null);assert.ok(r.knownResources.includes(s.id));
 const before=prepared(w,r);for(const amount of [1,0]){s.amount=amount;const after=prepared(w,r);assert.deepEqual(after.messages,before.messages);assert.deepEqual(after.choices,before.choices);}
});

test('hidden spring quantities and flood records leave context, actual menu and prompt unchanged',()=>{
 const cases:Record<string,(f:ReturnType<typeof fixture>)=>void>={wall:f=>f.w.buildings=[f.wall],cliff:f=>f.w.map.tiles[20*40+22]='cliff',far:f=>f.spring.at.x=33,indoor:f=>f.r.inside='room',roomCoordinate:f=>f.r.roomAt={x:1,y:1},sleeping:f=>f.r.activity={planId:'sleep',action:{type:'sleep',minutes:60},startedAt:0,remaining:60,path:[],target:f.r.at,definition:'action/routine@1'},unknown:f=>f.r.knownResources=[],offMap:f=>f.r.at.x=-1};
 for(const [name,setup] of Object.entries(cases)){
  const f=fixture();setup(f);const {w,r,spring}=f,before=structuredClone(decisionContext(w,r)),p=prepared(w,r);
  for(const amount of [1,0]){spring.amount=amount;spring.floodDamage={disasterId:'hidden-flood',at:w.minute,clearedAt:null};assert.deepEqual(decisionContext(w,r),before,name);assert.deepEqual(prepared(w,r).messages,p.messages,name);assert.deepEqual(prepared(w,r).choices,p.choices,name);}
  assert.ok(!waterSupplyOpportunities(w,r).some(c=>c.action.type==='waterSupply'&&c.action.operation==='fillSpring'),name);
 }
});

test('a near hidden address stays visitable, and explicit travel then gathering really supplies irrigation',()=>{
 const {w,r,spring,wall}=fixture();w.buildings=[wall];w.plots=[{id:'watered-test-field',ownerId:r.id,at:{x:25,y:20},crop:{definition:'crop/turnip@1',growth:1,planted:0,wateredDay:-1,lastGrowthDay:0}}];
 assert.ok(formalOpportunities(w,r,[]).some(c=>visits(spring.at)(c.action)),'near hidden spring needs a historical-address path');
 queue(w,r,choose(w,r,visits(spring.at)));finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.inventory.water,0);assert.equal(spring.amount,180);
 queue(w,r,choose(w,r,gathers(spring.id)));finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.inventory.water,3);assert.equal(spring.amount,177);assert.equal(w.plots[0].crop!.wateredDay,-1);
 queue(w,r,choose(w,r,a=>a.type==='water'));finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.inventory.water,2);assert.equal(w.plots[0].crop!.wateredDay,Math.floor(w.minute/DAY));
});

test('visible stock produces accurate gather and bucket quantities; depleted sources offer no transfer',()=>{
 const {w,r,spring}=fixture();
 for(const amount of [180,1,0]){spring.amount=amount;const p=prepared(w,r),g=p.choices.find(c=>gathers(spring.id)(c.action)),b=waterSupplyOpportunities(w,r).find(c=>c.action.type==='waterSupply'&&c.action.operation==='fillSpring');if(!amount){assert.equal(g,undefined);assert.equal(b,undefined);}else{assert.equal(g?.action.type==='gather'&&g.action.quantity,Math.min(3,amount));assert.equal(b?.action.type==='waterSupply'&&b.action.operation==='fillSpring'&&b.action.quantity,Math.min(3,amount));}}
});

test('stale gather choices cannot probe hidden stock before actual arrival',()=>{
 const {w,r,spring,wall}=fixture(),a=choose(w,r,gathers(spring.id));w.buildings=[wall];
 for(const amount of [180,1,0]){spring.amount=amount;assert.equal(planStartError(w,plan(w,r,[a])),null,'no live remote stock validation');}
 queue(w,r,a);stepWorld(w,1);assert.ok(r.activity);assert.equal(r.lastFailure,null);finish(w,r);assert.match(r.lastFailure!,/资源/);assert.equal(r.inventory.water,0);assert.ok(Math.abs(r.at.x-spring.at.x)+Math.abs(r.at.y-spring.at.y)<=1);
});

test('arrival-time depletion, competing gather and in-memory reload preserve finite stock',()=>{
 const {w,r,spring}=fixture();r.at={x:23,y:20};spring.amount=3;
 const other=structuredClone(r);other.id='spring-other';other.name='另一位';w.residents.push(other);
 queue(w,r,choose(w,r,gathers(spring.id)));queue(w,other,choose(w,other,gathers(spring.id)));
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();
 const [a,b]=restored.residents;finish(restored,a);finish(restored,b);
 assert.equal(restored.resources[0].amount,0);assert.equal((a.inventory.water??0)+(b.inventory.water??0),3);assert.equal([a,b].filter(x=>x.lastFailure===null).length,1);
});

test('an indoor resident independently exits the real room, visits the address and gathers only at the spring',async()=>{
 const {initializeRooms}=await import('../src/world/rooms.js'),{roomLayout}=await import('../src/shared/rooms.js');
 const {w,r,spring,wall}=fixture();w.buildings=[wall];wall.residents=[r.id];r.homeId=wall.id;r.knownBuildings=[wall.id];initializeRooms(w);r.at={...wall.door};r.inside=wall.id;r.roomAt={...roomLayout(w,wall).entry};
 const before=prepared(w,r);assert.ok(!before.choices.some(c=>gathers(spring.id)(c.action)));
 spring.amount=1;assert.deepEqual(prepared(w,r).messages,before.messages);spring.amount=180;
 queue(w,r,choose(w,r,visits(spring.at)));stepWorld(w,1);assert.equal(r.inventory.water,0);finish(w,r);
 assert.equal(r.inside,null);assert.equal(r.roomAt,null);assert.equal(r.lastFailure,null);assert.equal(spring.amount,180);
 queue(w,r,choose(w,r,gathers(spring.id)));finish(w,r);assert.equal(r.inventory.water,3);assert.equal(spring.amount,177);
});

test('actual bucket menu uses finite supply and rejects stale hidden fill without revealing amount',()=>{
 const {w,r,spring,wall,vessel}=fixture();
 const isFill=(a:Action)=>a.type==='waterSupply'&&a.operation==='fillSpring';
 let selected:Action|undefined;
 for(let i=0;i<12&&!selected;i++){const p=prepared(w,r);if(p.choices.some(c=>isFill(c.action)))selected=choose(w,r,isFill);else w.minute+=30;}
 assert.ok(selected);w.buildings=[wall];
 for(const amount of [180,1,0]){spring.amount=amount;assert.match(planStartError(w,plan(w,r,[selected]))!,/实际看到/);}
 w.buildings=[];spring.amount=3;queue(w,r,choose(w,r,isFill));finish(w,r);assert.equal(r.lastFailure,null);assert.equal(vessel.amount,3);assert.equal(spring.amount,0);assert.equal(r.inventory.water,0);
});

test('spring discovery needs actual sight and never creates water or a plan',()=>{
 const {w,r,spring,wall}=fixture();w.buildings=[wall];r.knownResources=[];stepWorld(w,1);assert.ok(!r.knownResources.includes(spring.id));
 w.buildings=[];stepWorld(w,1);assert.ok(r.knownResources.includes(spring.id));assert.ok(prepared(w,r).choices.some(c=>gathers(spring.id)(c.action)));
 assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(r.inventory.water,0);assert.equal(spring.amount,180);
});

test('spring context is a detached current snapshot, and hidden state remains hidden after memory-store reload',()=>{
 const {w,r,spring,wall}=fixture(),snapshot=decisionContext(w,r),before=prepareModelDecision(snapshot,undefined,GLM_MODEL);spring.at.x++;spring.amount=1;
 assert.equal(snapshot.resources[0].at.x,24);assert.equal(snapshot.resources[0].amount,180);assert.deepEqual(prepareModelDecision(snapshot,undefined,GLM_MODEL).messages,before.messages);
 w.buildings=[wall];const store=new WorldStore(':memory:');store.commit(w,null);const loaded=store.load()!;store.close();const actor=loaded.residents[0],p=prepared(loaded,actor);loaded.resources[0].amount=0;assert.deepEqual(prepared(loaded,actor).messages,p.messages);assert.deepEqual(prepared(loaded,actor).choices,p.choices);
});
