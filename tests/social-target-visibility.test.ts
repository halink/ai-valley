import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeSocial} from '../src/world/social-life.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {canSeeOutdoorPoint} from '../src/world/outdoor-observation.js';
import {canApproachSocialTarget,canContactSocialTarget} from '../src/world/social-observation.js';
import {pastureEdgeOpen} from '../src/shared/pasture-access.js';
import {emitEvent} from '../src/world/events.js';
import {WorldStore} from '../src/server/store.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';

function fixture(){
 const w=createWorld(5401);w.mode='formal';w.clock.paused=false;w.map.tiles.fill('grass');w.resources=[];w.buildings=[];w.plots=[];w.graves=[];
 w.residents=w.residents.slice(0,2);const [a,b]=w.residents;
 for(const p of [a,b])Object.assign(p,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{meal:5,water:5},health:100,energy:100,hunger:20,canDecide:true,canExpress:true,plan:null,activity:null,relations:[],memories:[],knownBuildings:[],knownResources:[]});
 b.at={x:23,y:20};a.knownPeople=[b.id];b.knownPeople=[a.id];initializeRooms(w);initializeIndustry(w);initializeSocial(w);
 a.relations=[{targetId:b.id,affection:3,trust:4,conflict:1,evidence:[]}];decisionContext(w,a);return {w,a,b};
}
const prepare=(w:World,a:Resident)=>prepareModelDecision(decisionContext(w,a),undefined,GLM_MODEL);
const precise=(x:Action,id:string)=>['talk','offer','care','propose','learn'].includes(x.type)&&'targetId'in x&&x.targetId===id||x.type==='accept'||x.type==='respond'&&x.accept;
let serial=0;
function selected(w:World,a:Resident,match:(x:Action)=>boolean,fields:Record<string,unknown>={}){
 const p=prepare(w,a),row=p.choices.find(c=>match(c.action));assert.ok(row,'normal final numbered choice');assert.match(row.id,/^\d+$/);assert.ok(p.messages.some(m=>m.content.includes(row.id+'. '+row.label)));
 return parseChoice(JSON.stringify({choice:row.id,...fields}),p.choices);
}
function queue(w:World,a:Resident,d:ReturnType<typeof selected>){assert.equal(submitPlan(w,{id:'social-view:'+ ++serial,actorId:a.id,actorRevision:a.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d}).ok,true);}
function finish(w:World,a:Resident){let left=100;while(a.plan||a.activity){assert.ok(left-->0);stepWorld(w,1);}}
function fence(w:World,b:Resident){
 const barn={...createWorld(5401).buildings[0],id:'synthetic-barn',kind:'barn' as const,at:{x:3,y:3},door:{x:6,y:8},residents:[]};w.buildings=[barn];
 w.industry!.pastures=[{id:'synthetic-fence',ownerId:b.id,barnId:barn.id,tiles:[{...b.at}],forage:10,capacity:4,lastMinute:w.minute,gate:{inside:{...b.at},outside:{x:b.at.x,y:b.at.y+1}},fenced:true,status:'open',expiresAt:w.minute+10000,fence:{condition:100,lastMinute:w.minute,woodUsed:0,repairs:0}}];
}

for(const barrier of ['cliff','tree','rock','building','diagonal'] as const)test(`precise social targets: ${barrier} occlusion filters real menus for all models without changing other choices`,t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Offline test must not call models');});
 const {w,a,b}=fixture();
 if(barrier==='cliff')w.map.tiles[20*w.map.width+21]='cliff';
 if(barrier==='tree'||barrier==='rock')w.resources.push({id:'opaque',kind:barrier,at:{x:21,y:20},amount:1,max:1,regrowthDays:0,lastHarvest:0});
 if(barrier==='building')w.buildings=[{...createWorld().buildings[0],id:'opaque',at:{x:21,y:20},width:1,height:1,door:{x:21,y:21},residents:[]}];
 if(barrier==='diagonal'){b.at={x:21,y:21};w.map.tiles[20*w.map.width+21]='cliff';}
 assert.equal(canSeeOutdoorPoint(w,a,b.at,10),false);const before=structuredClone(w);
 for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){
  const c=decisionContext(w,a),p=prepareModelDecision(c,undefined,model);assert.ok(!c.people.some(p=>p.id===b.id));assert.ok(!c.relationshipMemories!.people.some(p=>p.targetId===b.id));assert.ok(!p.choices.some(c=>precise(c.action,b.id)));
  for(const type of ['wait','eat','move'])assert.ok(p.choices.some(c=>c.action.type===type),type);
 }
 assert.deepEqual(w,before);assert.equal(w.metrics.requests,0);
});

test('transparent water separation keeps the visible personal recollection but no reachable direct social actions',()=>{
 const {w,a,b}=fixture();for(let y=0;y<w.map.height;y++)w.map.tiles[y*w.map.width+21]='water';
 assert.equal(canSeeOutdoorPoint(w,a,b.at,10),true);const c=decisionContext(w,a);assert.ok(c.people.some(p=>p.id===b.id&&p.interactionEligible===false));assert.ok(c.relationshipMemories!.people.some(p=>p.targetId===b.id));assert.ok(!prepare(w,a).choices.some(c=>precise(c.action,b.id)));
});

test('heard hidden speech remains eligible personal interpretation, not a current visual target or automatic relationship change',()=>{
 const {w,a,b}=fixture();a.knownPeople=[];w.map.tiles[20*w.map.width+21]='cliff';
 const e=emitEvent(w,{kind:'conversation',actors:[b.id],place:{...b.at},text:'隔壁传来的原话',speechText:'我愿意解释',speechTone:'neutral'});
 assert.ok(e.witnesses.includes(a.id));assert.ok(a.knownPeople.includes(b.id));const before=structuredClone(w),p=prepare(w,a);
 assert.ok(p.choices.some(c=>c.action.type==='social'&&c.action.operation==='interpret'&&c.action.targetId===b.id&&c.action.eventId===e.id));assert.ok(!p.choices.some(c=>precise(c.action,b.id)));assert.deepEqual(w,before);
});

for(const tone of ['neutral','friendly','hostile'] as const)test(`visible reachable ${tone} choice really approaches, speaks its own words and preserves relationship scores through SQLite`,()=>{
 const {w,a,b}=fixture(),before=structuredClone(a.relations[0]),text='本人明确说出的'+tone;
 queue(w,a,selected(w,a,x=>x.type==='talk'&&x.targetId===b.id&&x.tone===tone,{text}));finish(w,a);assert.equal(a.lastFailure,null);assert.equal(canContactSocialTarget(w,a,b),true);
 const events=w.events.filter(e=>e.kind==='conversation');assert.equal(events.length,1);assert.equal(events[0].speechText,text);assert.equal(events[0].speechTone,tone);for(const key of ['affection','trust','conflict'] as const)assert.equal(a.relations[0][key],before[key]);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load(true)!;assert.equal(loaded.events.find(e=>e.id===events[0].id)!.speechText,text);assert.deepEqual(prepare(loaded,loaded.residents.find(p=>p.id===a.id)!),prepare(w,a));}finally{store.close();}
});

test('visible target across a fence is approached through its real gate before numbered speech completes',()=>{
 const {w,a,b}=fixture();b.at={x:21,y:20};fence(w,b);assert.equal(pastureEdgeOpen(w,a.at,b.at),false);assert.equal(canApproachSocialTarget(w,a,b),true);
 queue(w,a,selected(w,a,x=>x.type==='talk'&&x.tone==='neutral',{text:'我走到门口再说。'}));let left=100,steps=0;
 while(a.plan||a.activity){assert.ok(left-->0);const from={...a.at};stepWorld(w,1);if(from.x!==a.at.x||from.y!==a.at.y){assert.equal(pastureEdgeOpen(w,from,a.at),true);steps++;}}
 assert.ok(steps>=2);assert.deepEqual(a.at,{x:21,y:21});assert.equal(a.lastFailure,null);assert.equal(w.events.filter(e=>e.kind==='conversation').length,1);
});

test('an already numbered speech or barter cannot complete after a new closed fence blocks physical contact',()=>{
 for(const kind of ['talk','offer','accept'] as const){
  const {w,a,b}=fixture();b.at={x:21,y:20};w.offers=[{id:'stale-offer',actorId:b.id,targetId:a.id,give:{meal:1},want:{water:1},expiresAt:w.minute+100,status:'open',definition:'trade/barter@1'}];
  const d=selected(w,a,x=>x.type===kind,kind==='talk'?{text:'不能穿过围栏说出'}:kind==='offer'?{give:{meal:1},want:{water:1}}:{});queue(w,a,d);stepWorld(w,1);assert.ok(a.activity);
  fence(w,b);for(const p of [{x:21,y:21},{x:22,y:20},{x:21,y:19}])w.map.tiles[p.y*w.map.width+p.x]='water';const stock=structuredClone([a.inventory,b.inventory]),relations=structuredClone([a.relations,b.relations]);finish(w,a);
  assert.ok(a.lastFailure,kind);assert.ok(!w.events.some(e=>e.kind==='conversation'||e.kind==='trade'));assert.equal(w.offers.length,1);assert.equal(w.offers[0].status,'open');assert.deepEqual([a.inventory,b.inventory],stock);assert.deepEqual([a.relations,b.relations],relations);
 }
});

test('ordinary care and proposal replies require seen contact while own withdrawal and separation remain independent',()=>{
 const {w,a,b}=fixture();b.at={x:21,y:21};a.skills.care=2;b.health=19;b.canDecide=b.canExpress=false;a.relations[0].partner='dating';
 w.proposals=[{id:'own',actorId:a.id,targetId:b.id,kind:'care',createdAt:w.minute,expiresAt:w.minute+100,status:'open',definition:'action/routine@1'}];
 assert.ok(prepare(w,a).choices.some(c=>c.action.type==='care'));w.map.tiles[20*w.map.width+21]='cliff';const before=structuredClone(w),p=prepare(w,a);
 assert.ok(!p.choices.some(c=>precise(c.action,b.id)));assert.ok(p.choices.some(c=>c.action.type==='respond'&&!c.action.accept&&c.action.proposalId==='own'));assert.ok(p.choices.some(c=>c.action.type==='separate'&&c.action.targetId===b.id));assert.deepEqual(w,before);
});

test('faraway merchant letter proposals retain their separate numbered path without a face-to-face person',()=>{
 const w=createFormalWorld(5401),a=w.residents[0];w.clock.paused=false;a.at={...w.map.entrance};a.inside=null;a.roomAt=null;a.coins=600;a.inventory={water:10,wood:10,meal:10};initializeForeignTrade(w);
 const c=decisionContext(w,a),p=prepareModelDecision(c,undefined,GLM_MODEL),row=p.choices.find(c=>c.action.type==='foreignTrade'&&c.action.operation==='propose');assert.ok(row);assert.ok(!c.people.some(p=>p.id===w.foreignTrade!.merchants[0].person.id));
 const d=parseChoice(JSON.stringify({choice:row.id,quantity:1,price:1}),p.choices);queue(w,a,d);finish(w,a);assert.equal(a.lastFailure,null);assert.ok(w.foreignTrade!.offers.some(o=>o.residentId===a.id&&o.initiatedBy==='resident'));assert.equal(w.metrics.requests,0);
});
