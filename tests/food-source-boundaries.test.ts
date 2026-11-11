import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Resource,World} from '../src/shared/types.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,type ModelName} from '../src/server/model-completion.js';
import {foodSourceOpportunities} from '../src/server/food-source-opportunities.js';
import {WorldStore} from '../src/server/store.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {createWorld} from '../src/world/seed.js';
import {initializeIndustry} from '../src/world/industry.js';
import {distance,walkable} from '../src/world/navigation.js';
import {pastureEdgeOpen} from '../src/shared/pasture-access.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(5401),r=w.residents[0];w.mode='formal';w.minute=600;w.clock.paused=false;
 w.map={width:50,height:50,tiles:Array(2500).fill('grass'),entrance:{x:0,y:0},name:'离线食源视野与接触'};
 const wall={...w.buildings[0],id:'berry-wall',at:{x:22,y:19},width:1,height:3,door:{x:22,y:22}};
 w.residents=[r];w.buildings=[];w.plots=[];w.graves=[];w.events=[];
 const source:Resource={id:'boundary-berries',kind:'bush',at:{x:24,y:20},amount:9,max:9,regrowthDays:0,lastHarvest:0};w.resources=[source];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,knownResources:[source.id],knownBuildings:[],knownPeople:[],inventory:{},memories:[],relations:[],activity:null,plan:null,lastFailure:null,hunger:20,energy:100,health:100,bornAt:w.minute-25*YEAR,canDecide:true,canExpress:true});
 initializeIndustry(w);decisionContext(w,r);return {w,r,source,wall};
}
const prepared=(w:World,r:Resident,model:ModelName=GLM_MODEL)=>prepareModelDecision(decisionContext(w,r),undefined,model);
const models:ModelName[]=[GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL];
const gather=(id:string)=>(a:Action)=>a.type==='gather'&&a.resourceId===id;
let serial=0;
function plan(w:World,r:Resident,actions:Action[]){return {id:'berry-boundary:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择核实与采集',actions};}
function select(w:World,r:Resident,match:(a:Action)=>boolean){
 const p=prepared(w,r),c=p.choices.find(c=>match(c.action));assert.ok(c,'actual final numbered menu contains choice');assert.match(c.id,/^\d+$/);
 assert.ok(p.messages.some(m=>m.content.includes(c.id+'. '+c.label)),'choice appears in actual model prompt');return parseChoice(JSON.stringify({choice:c.id}),p.choices).actions;
}
function queue(w:World,r:Resident,actions:Action[]){const p=plan(w,r,actions);assert.equal(submitPlan(w,p).ok,true);return p;}
function finish(w:World,r:Resident){let ticks=1000;while(r.plan||r.activity){assert.ok(ticks--,'bounded physical completion');stepWorld(w,.25);}}
function fence(f:ReturnType<typeof fixture>){
 const {w,r,source}=f;r.at={x:23,y:20};
 const p={id:'berry-pasture',barnId:'none',forage:0,capacity:1,lastMinute:w.minute,fenced:true,status:'open' as const,tiles:[{...source.at}],gate:{inside:{...source.at},outside:{x:25,y:20}}};
 w.industry!.pastures=[p];return p;
}

for(const blocker of ['wall','cliff'] as const)test(`berries: ${blocker} cannot add legacy known IDs or expose live stock after a heard clue`,()=>{
 const {w,r,source,wall}=fixture();r.knownResources=[];
 r.foodSourceKnowledge={seen:{},heard:[{resourceId:source.id,at:{...source.at},observedAt:500,speakerId:'witness',speakerName:'旧址证人',receivedAt:550,eventId:'heard-berry-clue'}],shared:[]};
 if(blocker==='wall')w.buildings=[wall];else w.map.tiles[20*50+22]='cliff';
 const heard=structuredClone(r.foodSourceKnowledge.heard);stepWorld(w,.25);
 assert.ok(!r.knownResources.includes(source.id));assert.equal(r.foodSourceKnowledge.seen[source.id],undefined);assert.deepEqual(r.foodSourceKnowledge.heard,heard);
 assert.deepEqual(decisionContext(w,r).resources,[]);assert.ok(!prepared(w,r).choices.some(c=>gather(source.id)(c.action)));
 w.buildings=[];w.map.tiles[20*50+22]='grass';stepWorld(w,.25);
 assert.ok(r.knownResources.includes(source.id));assert.ok(r.foodSourceKnowledge.seen[source.id]);assert.equal(source.amount,9);assert.deepEqual(r.inventory,{});
});

for(const blocker of ['wall','cliff','tree','rock','roomCoordinate','sleep'] as const)test(`berries: ${blocker} leaves old-address context and all final model prompts independent of hidden stock`,()=>{
 const {w,r,source,wall}=fixture();
 if(blocker==='wall')w.buildings=[wall];if(blocker==='cliff')w.map.tiles[20*50+22]='cliff';
 if(blocker==='tree'||blocker==='rock')w.resources.push({...source,id:'opaque-blocker',kind:blocker,at:{x:22,y:20},amount:1});
 if(blocker==='roomCoordinate')r.roomAt={x:1,y:1};
 if(blocker==='sleep')r.activity={planId:'sleep',action:{type:'sleep',minutes:60},startedAt:w.minute,remaining:60,path:[],target:{...r.at},definition:w.activeDefinitions['action/routine']};
 const before=structuredClone(decisionContext(w,r)),prompts=models.map(m=>prepared(w,r,m));
 assert.deepEqual(before.resources,[]);assert.ok(!prompts[0].choices.some(c=>gather(source.id)(c.action)));
 for(const amount of [0,1,100]){source.amount=amount;source.max=777;source.regrowthDays=313;source.lastHarvest=599;
  assert.deepEqual(decisionContext(w,r),before);for(const [i,m] of models.entries())assert.deepEqual(prepared(w,r,m),prompts[i]);
 }
 assert.deepEqual(r.knownResources,[source.id],'old address is retained, never reclassified as current evidence');
});

test('berries: old hidden address is independently visited, inspected, gathered and eaten through final choices',()=>{
 const {w,r,source,wall}=fixture();w.buildings=[wall];
 queue(w,r,select(w,r,a=>a.type==='move'&&distance(a.to,source.at)<=1));finish(w,r);
 assert.equal(r.lastFailure,null);assert.equal(source.amount,9);assert.deepEqual(r.inventory,{});assert.ok(r.foodSourceKnowledge?.seen[source.id]);
 queue(w,r,select(w,r,gather(source.id)));finish(w,r);assert.equal(r.lastFailure,null);assert.equal(source.amount,6);assert.equal(r.inventory.berry,3);
 queue(w,r,select(w,r,a=>a.type==='eat'&&a.item==='berry'));finish(w,r);assert.equal(r.inventory.berry,2);assert.equal(source.amount,6);assert.equal(w.metrics.requests,0);
});

test('berries: actual sharing and interrupted old-address travel never discover a patch through a wall',()=>{
 const {w,r,source,wall}=fixture(),speaker=structuredClone(r);speaker.id='berry-witness';speaker.name='浆果证人';speaker.at={x:25,y:20};speaker.knownPeople=[r.id];
 r.at={x:10,y:20};r.knownResources=[];r.knownPeople=[speaker.id];w.residents.push(speaker);w.buildings=[wall];
 stepWorld(w,.25);assert.ok(speaker.foodSourceKnowledge?.seen[source.id]);assert.equal(r.foodSourceKnowledge?.seen[source.id],undefined);
 speaker.at={x:9,y:20};queue(w,speaker,select(w,speaker,a=>a.type==='shareFoodSource'&&a.targetId===r.id));finish(w,speaker);
 assert.equal(r.foodSourceKnowledge?.heard.length,1);assert.deepEqual(r.knownResources,[]);
 queue(w,r,select(w,r,a=>a.type==='move'&&distance(a.to,source.at)<=1));
 let ticks=500;while(r.at.x<17){assert.ok(ticks--);stepWorld(w,.25);}
 assert.deepEqual(r.at,{x:17,y:20});assert.deepEqual(r.knownResources,[]);assert.equal(r.foodSourceKnowledge?.seen[source.id],undefined);
 const next=r.activity!.path[0];assert.ok(next);w.map.tiles[next.y*w.map.width+next.x]='cliff';finish(w,r);assert.ok(r.lastFailure);
 const context=structuredClone(decisionContext(w,r)),before=prepared(w,r);assert.deepEqual(context.resources,[]);assert.ok(!before.choices.some(c=>gather(source.id)(c.action)));
 source.amount=0;source.regrowthDays=999;assert.deepEqual(decisionContext(w,r),context);assert.deepEqual(prepared(w,r),before);
 assert.deepEqual(r.inventory,{});assert.equal(r.foodSourceKnowledge?.heard.length,1);
});

test('berries: a stale gather cannot probe hidden stock, and depletion fails only after actual arrival',()=>{
 const {w,r,source,wall}=fixture(),actions=select(w,r,gather(source.id));w.buildings=[wall];
 for(const amount of [9,1,0]){source.amount=amount;assert.equal(planStartError(w,plan(w,r,actions)),null);}
 queue(w,r,actions);stepWorld(w,.25);assert.ok(r.activity);assert.equal(r.lastFailure,null);finish(w,r);
 assert.match(r.lastFailure!,/资源/);assert.ok(distance(r.at,source.at)<=1);assert.equal(source.amount,0);assert.deepEqual(r.inventory,{});
});

test('berries: transparent fence keeps true stock visible but gather must walk around to its gate',()=>{
 const f=fixture(),{w,r,source}=f;fence(f);const at={...r.at};
 assert.equal(pastureEdgeOpen(w,r.at,source.at),false);assert.equal(decisionContext(w,r).resources[0].amount,9);
 queue(w,r,select(w,r,gather(source.id)));stepWorld(w,.25);assert.ok(r.activity?.path.length,'blocked adjacent reach is a real walking route');
 assert.equal(source.amount,9);assert.deepEqual(r.inventory,{});finish(w,r);
 assert.equal(r.lastFailure,null);assert.notDeepEqual(r.at,at);assert.equal(pastureEdgeOpen(w,r.at,source.at),true);assert.equal(source.amount,6);assert.equal(r.inventory.berry,3);
});

test('berries: a sealed gate offers no gather and a stale numbered gather fails without taking fruit',()=>{
 const f=fixture(),{w,r,source}=f;fence(f);const actions=select(w,r,gather(source.id));w.map.tiles[20*50+25]='cliff';
 assert.equal(decisionContext(w,r).resources[0].amount,9,'the fence remains transparent');assert.ok(!prepared(w,r).choices.some(c=>gather(source.id)(c.action)));
 const at={...r.at};queue(w,r,actions);finish(w,r);assert.ok(r.lastFailure);assert.deepEqual(r.at,at);assert.equal(source.amount,9);assert.deepEqual(r.inventory,{});
});

test('berries: gate changes in the final quarter-minute fail atomically after in-memory reload',()=>{
 const f=fixture(),{w,r,source}=f,p=fence(f);p.gate.outside={...r.at};
 queue(w,r,select(w,r,gather(source.id)));while(!r.activity||r.activity.remaining>.25)stepWorld(w,.25);
 assert.equal(r.activity.path.length,0);p.gate.outside={x:25,y:20};
 const store=new WorldStore(':memory:');let loaded:World;try{store.commit(w,null);loaded=store.load()!;}finally{store.close();}
 const actor=loaded.residents[0];finish(loaded,actor);assert.ok(actor.lastFailure);assert.deepEqual(actor.inventory,{});assert.equal(loaded.resources[0].amount,9);
 assert.ok(!loaded.events.some(e=>e.text.includes('采集了')));assert.equal(source.amount,9);
});

test('berries: source cell need not be walkable and the existing twelve-cell Euclidean view is preserved',()=>{
 const {w,r,source}=fixture();source.at={x:28,y:28};assert.equal(distance(r.at,source.at),16);assert.equal(decisionContext(w,r).resources[0].id,source.id);
 source.at={x:24,y:20};r.at={x:23,y:20};w.map.tiles[20*50+24]='water';assert.equal(walkable(w,source.at,r.at),false);
 queue(w,r,select(w,r,gather(source.id)));finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.inventory.berry,3);assert.equal(source.amount,6);
});

test('berries: old hidden IDs survive reload without inventing sight and menu queries remain read-only',()=>{
 const {w,r,wall}=fixture();w.buildings=[wall];delete r.foodSourceKnowledge;
 const store=new WorldStore(':memory:');let loaded:World;try{store.commit(w,null);loaded=store.load()!;}finally{store.close();}
 const actor=loaded.residents[0];decisionContext(loaded,actor);const before=structuredClone(loaded),p=prepared(loaded,actor);
 foodSourceOpportunities(loaded,actor);assert.deepEqual(loaded,before);assert.equal(actor.foodSourceKnowledge,undefined);assert.deepEqual(actor.knownResources,['boundary-berries']);
 loaded.resources[0].amount=0;loaded.resources[0].regrowthDays=777;assert.deepEqual(prepared(loaded,actor),p);
});
