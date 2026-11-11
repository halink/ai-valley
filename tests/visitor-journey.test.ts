import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Resident,World} from '../src/shared/types.js';
import type {VisitorJourneyAction} from '../src/shared/visitor-journey.js';
import {ordinaryVisitorJourney} from '../src/shared/visitor-journey.js';
import {createWorld} from '../src/world/seed.js';
import {initializeMigration,applyOutsideDecision,outsideCandidate,outsideDecisionContext,advanceMigration} from '../src/world/migration.js';
import {initializeFood,advanceFood,foodContainers} from '../src/world/food.js';
import {addHealthCase,movementRate} from '../src/world/health.js';
import {hasTimelyVisitorJourneyRescue,visitorJourneyFood} from '../src/world/visitor-journey.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {decisionChoices,type ModelResult} from '../src/server/decisions.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {physiology} from '../src/world/physiology.js';
import {parseChoice} from '../src/server/affordances.js';
import {residentActivity} from '../src/client/resident-status.js';
import {censusPanel} from '../src/client/community.js';
import {atEstateLocation} from '../src/world/estate-custody.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.map={...w.map,width:20,height:12,tiles:Array(240).fill('grass'),entrance:{x:0,y:6}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents){r.inventory={};r.decisionDue=Number.MAX_SAFE_INTEGER;r.lastDecisionAt=w.minute;}
 initializeMigration(w);initializeFood(w);const c=w.migration!.contacts[0],r=c.person!;
 assert.ok(applyOutsideDecision(w,r.id,r.revision,{intention:'本人选择分段探访',actions:[{type:'travelToValley'}]}).ok);
 return {w,c,r,j:c.journey!.staged!};
}
function choose(w:World,r:Resident,operation:VisitorJourneyAction['operation'],item?:VisitorJourneyAction['item']){
 const choices=decisionChoices(outsideDecisionContext(w,r)),choice=choices.find(c=>c.action.type==='visitorJourney'&&c.action.operation===operation&&(item===undefined||c.action.item===item));assert.ok(choice,operation);
 assert.ok(applyOutsideDecision(w,r.id,r.revision,parseChoice(JSON.stringify({choice:choice.id}),choices)).ok);
}
function waitAtStage(f:ReturnType<typeof fixture>){stepWorld(f.w,f.j.stageRemaining);assert.equal(f.j.status,'waiting');}
const protectedStep=(w:World,n:number)=>stepWorld(w,n,{decisionChoices:()=>[]});

test('normal outside choices advance only the chosen stage, preserve identity and locate the visitor outside the town',()=>{
 const f=fixture(),{w,r,c,j}=f,coins=r.coins,stock={...r.inventory},population=w.residents.length;
 assert.equal(j.progress,j.duration);assert.deepEqual(r.at,{x:-1,y:-1});assert.equal(w.residents.some(p=>p.id===r.id),false);
 stepWorld(w,5);assert.equal(j.progress,j.duration-5);assert.equal(r.regionalLocation!.progress,j.progress);assert.ok(r.hunger>18);assert.equal(r.coins,coins);assert.deepEqual(r.inventory,stock);
 stepWorld(w,100);assert.equal(j.progress,j.duration/2);assert.equal(j.status,'waiting');assert.equal(outsideCandidate(w).includes(r),true);assert.equal(w.residents.length,population);assert.equal(c.person,r);
 const before=JSON.stringify(w),context=outsideDecisionContext(w,r);assert.deepEqual(context.people,[]);assert.deepEqual(context.buildings,[]);assert.deepEqual(context.actor.at,{x:-1,y:-1});assert.equal(JSON.stringify(w),before);
 choose(w,r,'continue');stepWorld(w,j.stageRemaining-1);assert.equal(r.residency,'outside');stepWorld(w,1);assert.equal(r.residency,'visitor');assert.equal(w.residents.find(p=>p.id===r.id),r);assert.equal(c.person,undefined);assert.equal(r.regionalLocation,undefined);assert.deepEqual(r.at,w.map.entrance);assert.equal(r.homeId,null);
 stepWorld(w,2);assert.equal(w.residents.filter(p=>p.id===r.id).length,1);assert.equal(w.events.filter(e=>e.populationChange==='visit'&&e.actors[0]===r.id).length,1);
});

test('the shortest route can be abandoned halfway only by walking the actual return distance',()=>{
 const f=fixture(),{w,r,c,j}=f;waitAtStage(f);const at=j.progress,inventory={...r.inventory};choose(w,r,'turnBack');assert.equal(j.progress,at);assert.equal(c.phase,'travelling');stepWorld(w,at-1);assert.equal(c.phase,'travelling');assert.equal(r.residency,'outside');stepWorld(w,1);assert.equal(c.phase,'home');assert.equal(c.journey,null);assert.equal(r.regionalLocation!.progress,j.duration);assert.deepEqual(r.at,{x:-1,y:-1});assert.deepEqual(r.inventory,inventory);assert.equal(w.residents.some(p=>p.id===r.id),false);assert.equal(w.events.some(e=>e.populationChange==='visit'&&e.actors[0]===r.id),false);
});

test('food and sitting rest require separate choices, elapsed work, original finite lots and no automatic continuation',()=>{
 const f=fixture(),{w,r,j}=f;waitAtStage(f);r.hunger=80;r.energy=10;const meals=r.inventory.meal!,progress=j.progress,lot=structuredClone(w.food!.lots['person:'+r.id].meal![0]);choose(w,r,'eat','meal');stepWorld(w,4);assert.equal(r.inventory.meal,meals);assert.equal(j.progress,progress);stepWorld(w,1);assert.equal(r.inventory.meal,meals-1);assert.ok(r.hunger<80);assert.equal(j.status,'waiting');assert.equal(j.pause,undefined);assert.equal(w.food!.lots['person:'+r.id].meal![0].producedAt,lot.producedAt);assert.equal(w.food!.lots['person:'+r.id].meal![0].expiresAt,lot.expiresAt);
 choose(w,r,'rest');const energy=r.energy;stepWorld(w,30);assert.ok(r.energy>energy);assert.equal(j.pause,undefined);stepWorld(w,60);assert.equal(j.progress,progress);assert.equal(r.homeId,null);assert.equal(r.inventory.meal,meals-1);
});

test('food expiry during a meal is actual loss, invalidates stale decisions, and never creates a replacement',()=>{
 const f=fixture(),{w,r,j}=f;waitAtStage(f);for(const lots of Object.values(w.food!.lots['person:'+r.id]))for(const lot of lots??[])lot.expiresAt=w.minute+3;r.hunger=80;
 choose(w,r,'eat','meal');stepWorld(w,5);assert.equal(r.inventory.meal,0);assert.ok(r.hunger>80);assert.match(j.reason!,/腐败/);assert.ok(w.food!.spoiled.meal!>0);const snapshot=JSON.stringify(w);assert.equal(visitorJourneyFood(w,r,'meal'),false);assert.equal(JSON.stringify(w),snapshot);
 const stale=r.revision;choose(w,r,'rest');const after=JSON.stringify(w);assert.equal(applyOutsideDecision(w,r.id,stale,{intention:'旧回复',actions:[{type:'visitorJourney',operation:'continue',journeyId:j.id}]}).ok,false);assert.equal(JSON.stringify(w),after);
});

test('unknown dates are not made fresh by journey menus, and a route action cannot be smuggled into local plans',()=>{
 const f=fixture(),{w,r,j}=f;waitAtStage(f);delete w.food!.lots['person:'+r.id];const before=JSON.stringify(w);assert.equal(outsideDecisionContext(w,r).outside!.choices.some(c=>c.action.type==='visitorJourney'&&c.action.operation==='eat'),false);assert.equal(JSON.stringify(w),before);
 assert.equal(applyOutsideDecision(w,r.id,r.revision,{intention:'未经核对进食',actions:[{type:'visitorJourney',operation:'eat',journeyId:j.id,item:'meal'}]}).ok,false);
 const local=w.residents[0];assert.equal(submitPlan(w,{id:'invalid-route',actorId:local.id,actorRevision:local.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'不能伪造旅程',actions:[{type:'visitorJourney',operation:'continue',journeyId:j.id}]}).ok,false);
});

test('a blocked gate remains physical, waits after repair, survives restart and requires a full chosen retry',()=>{
 let f=fixture();waitAtStage(f);choose(f.w,f.r,'continue');f.w.map.tiles[f.w.map.entrance.y*f.w.map.width]='water';stepWorld(f.w,f.j.stageRemaining);
 assert.equal(f.j.progress,0);assert.equal(f.j.status,'waiting');assert.equal(f.c.journey!.blocked,true);assert.equal(f.r.residency,'outside');
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,c=w.migration!.contacts.find(c=>c.id===f.r.id)!,r=c.person!,j=c.journey!.staged!;f={w,c,r,j};w.map={...w.map,tiles:w.map.tiles.slice()};w.map.tiles[w.map.entrance.y*w.map.width]='grass';stepWorld(w,90);assert.equal(r.residency,'outside');assert.equal(j.progress,0);choose(w,r,'continue');stepWorld(w,29);assert.equal(r.residency,'outside');stepWorld(w,1);assert.equal(r.residency,'visitor');assert.equal(r.homeId,null);}finally{store.close();}
});

test('movement and an unfinished meal persist once through restart and global pause changes nothing',()=>{
 const f=fixture();stepWorld(f.w,3);const progress=f.j.progress;const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,base=w.revision,c=w.migration!.contacts[0],r=c.person!,j=c.journey!.staged!;assert.equal(j.progress,progress);advanceMigration(w);assert.equal(j.progress,progress);stepWorld(w,j.stageRemaining);choose(w,r,'eat','meal');stepWorld(w,2);const meals=r.inventory.meal!;store.commit(w,base);const loaded=store.load()!,lr=loaded.migration!.contacts[0].person!,lj=ordinaryVisitorJourney(loaded,lr)!;loaded.clock.paused=true;const before=JSON.stringify(loaded);stepWorld(loaded,60);advanceMigration(loaded);assert.equal(JSON.stringify(loaded),before);loaded.clock.paused=false;stepWorld(loaded,3);assert.equal(lr.inventory.meal,meals-1);assert.equal(lj.pause,undefined);stepWorld(loaded,5);assert.equal(lr.inventory.meal,meals-1);assert.equal(lj.progress,j.progress);}finally{store.close();}
});

test('incapacity cancels movement or rest at the actual location and recovery never silently resumes it',()=>{
 const f=fixture();stepWorld(f.w,2);const at=f.j.progress;f.r.canDecide=false;const memory=JSON.stringify(f.r.memories);stepWorld(f.w,5);assert.equal(f.j.progress,at);assert.equal(f.j.status,'waiting');assert.equal(JSON.stringify(f.r.memories),memory);f.r.canDecide=true;stepWorld(f.w,20);assert.equal(f.j.progress,at);choose(f.w,f.r,'rest');stepWorld(f.w,2);f.r.canExpress=false;stepWorld(f.w,1);assert.equal(f.j.pause,undefined);f.r.canExpress=true;stepWorld(f.w,30);assert.equal(f.j.progress,at);choose(f.w,f.r,'continue');stepWorld(f.w,1);assert.equal(f.j.progress,at-1);
});

test('a first-time traveler can die without being added to town and body, lots, estate and witnesses stay regional',()=>{
 const f=fixture(),{w,r,j,c}=f;stepWorld(w,3);const at=j.progress;r.hunger=100;r.energy=0;r.health=.01;const stock={...r.inventory},before=w.residents.map(p=>JSON.stringify(p.memories));stepWorld(w,1);
 assert.equal(r.status,'dead');assert.equal(c.person,r);assert.equal(w.residents.some(p=>p.id===r.id),false);assert.equal(j.status,'interrupted');assert.equal(j.progress,at);const estate=w.estates.find(e=>e.personId===r.id)!;assert.deepEqual(estate.inventory,stock);assert.equal(estate.location!.regional!.progress,at);assert.equal(atEstateLocation(w.residents[0],estate.location!),false);assert.deepEqual(r.inventory,{});
 const death=w.events.find(e=>e.kind==='death'&&e.actors[0]===r.id)!;assert.equal(death.regionalLocation!.progress,at);assert.equal(death.bodyLocation,undefined);assert.deepEqual(death.witnesses,[]);assert.deepEqual(w.residents.map(p=>JSON.stringify(p.memories)),before);assert.ok(w.food!.lots['estate:'+r.id].meal!.length);stepWorld(w,10);assert.equal(w.estates.filter(e=>e.personId===r.id).length,1);
});

test('bounded rescue protection covers a stopped first visitor, not chosen travel or expired food',()=>{
 const f=fixture();waitAtStage(f);Object.assign(f.r,{hunger:98,energy:80,health:1});const before=JSON.stringify(f.w);assert.equal(hasTimelyVisitorJourneyRescue(f.w,f.r),true);assert.equal(JSON.stringify(f.w),before);protectedStep(f.w,3);assert.equal(f.r.health,1);assert.equal(f.r.decisionProtection!.expiresAt-f.r.decisionProtection!.startedAt,180);choose(f.w,f.r,'eat','meal');protectedStep(f.w,5);assert.ok(f.r.hunger<95);assert.equal(f.r.decisionProtection!.reason,'decision');assert.ok(f.r.decisionProtection!.recoveredAt);
 const moving=fixture();Object.assign(moving.r,{hunger:98,energy:80,health:1});protectedStep(moving.w,3);assert.equal(moving.r.decisionProtection,undefined);assert.ok(moving.r.health<1);
 for(const mode of ['no-food','too-late','expires'] as const){const g=fixture();waitAtStage(g);Object.assign(g.r,{hunger:98,energy:80,health:mode==='too-late'?.1:1});if(mode==='no-food')g.r.inventory={};if(mode==='expires')for(const lots of Object.values(g.w.food!.lots['person:'+g.r.id]))for(const lot of lots??[])lot.expiresAt=g.w.minute+3;assert.equal(hasTimelyVisitorJourneyRescue(g.w,g.r),false,mode);protectedStep(g.w,1);assert.equal(g.r.decisionProtection,undefined);}
});

test('first-visitor health cases keep progressing outside town and are not shielded by technical protection',()=>{
 const f=fixture();waitAtStage(f);Object.assign(f.r,{hunger:98,energy:80,health:1});protectedStep(f.w,1);const health=f.r.health;addHealthCase(f.w,f.r,'illness',100,'实际途中疾病');protectedStep(f.w,1);assert.ok(f.r.health<health);assert.equal(f.r.canDecide,false);assert.equal(f.j.status,'waiting');assert.notEqual(f.r.decisionProtection!.endedAt,null);
});

test('legacy timer journeys retain their old shape rather than inventing past stages',()=>{
 const f=fixture(),{w,c,r}=f;delete c.journey!.staged;delete r.regionalLocation;r.at={...w.map.entrance};c.journey!.nextCheckAt=c.journey!.arriveAt;const before=JSON.stringify(c.journey);w.minute=c.journey!.arriveAt-1;advanceMigration(w);assert.equal(JSON.stringify(c.journey),before);w.minute++;advanceMigration(w);assert.equal(r.residency,'visitor');assert.equal(c.journey,null);
});

test('observation distinguishes chosen stages, rest and decision waits, escapes origins and promises no arrival time',()=>{
 const f=fixture(),{w,r,j,c}=f;j.origin=c.origin='<svg onload=bad>';waitAtStage(f);const before=JSON.stringify(w);assert.equal(residentActivity(w,r).kind,'decision-wait');let html=censusPanel(w);assert.match(html,/等待本人另选/);assert.match(html,/&lt;svg/);assert.doesNotMatch(html,/<svg|预计.*抵达/);assert.equal(JSON.stringify(w),before);choose(w,r,'rest');assert.equal(residentActivity(w,r).kind,'voluntary-wait');html=censusPanel(w);assert.match(html,/原地休息/);
});

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('only a first-time regional waiter participates in runtime outage protection and its successful choice is counted',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const f=fixture();waitAtStage(f);Object.assign(f.r,{hunger:98,energy:80,health:1});f.w.clock.realMinutesPerDay=20;const store=new WorldStore(':memory:');store.commit(f.w,null);let finish!:(r:ModelResult)=>void;
 const runtime=new ValleyRuntime(store,'offline-test-key',async(_key,context)=>context.actor.id===f.r.id?new Promise<ModelResult>(resolve=>{finish=resolve;}):new Promise<ModelResult>(()=>{}));
 try{runtime.start();await flush();for(let i=0;i<160;i++)runtime.tick(now+=1000);const r=runtime.world.migration!.contacts[0].person!,j=ordinaryVisitorJourney(runtime.world,r)!;assert.equal(runtime.world.clock.paused,true);assert.equal(r.health,1);assert.equal(j.progress,f.j.progress);assert.equal(runtime.world.residents.some(p=>p.id===r.id),false);finish({decision:{intention:'本人选择现物进食',actions:[{type:'visitorJourney',operation:'eat',journeyId:j.id,item:'meal'}]},inputTokens:1,outputTokens:1,latencyMs:1});await flush();assert.equal(runtime.world.metrics.regionalDecisions,1);for(let i=0;i<6;i++)runtime.tick(now+=1000);const after=runtime.world.migration!.contacts[0].person!;assert.equal(runtime.world.clock.paused,false);assert.ok(after.hunger<95);assert.ok(after.decisionProtection!.recoveredAt);}finally{runtime.stop();store.close();}
});


test('injury slows actual route distance without extending the independently chosen stage time',()=>{
 const f=fixture(),{w,r,j}=f;addHealthCase(w,r,'injury',60,'实际旧伤');assert.equal(movementRate(w,r),.5);const initial=j.stageRemaining;stepWorld(w,1);assert.equal(j.duration-j.progress,.5);assert.equal(j.stageRemaining,initial-1);stepWorld(w,initial-1);assert.equal(j.status,'waiting');assert.equal(j.progress,j.duration-initial*.5);const progress=j.progress;stepWorld(w,20);assert.equal(j.progress,progress);
 let count=0;while(r.residency==='outside'){assert.ok(count++<8);choose(w,r,'continue');assert.ok(j.stageRemaining<=12);stepWorld(w,j.stageRemaining);}assert.equal(r.residency,'visitor');assert.ok(count>=3);
});

test('a longer frontier visit has finite stages and return uses the same record with one body clock',()=>{
 for(const returning of [false,true]){const f=fixture(),{w,c,r}=f;w.scenario='frontier';c.journey=null;c.phase='offered';delete r.regionalLocation;if(returning){w.residents.push(r);delete c.person;}assert.ok(applyOutsideDecision(w,r.id,r.revision,{intention:'本人选择较长路线',actions:[{type:'travelToValley'}]}).ok);const j=c.journey!.staged!,hunger=r.hunger,energy=r.energy,rules=physiology(w,r);assert.equal(j.duration,204);stepWorld(w,30);assert.equal(j.progress,174);assert.ok(Math.abs(r.hunger-hunger-rules.hungerPerMinute*30)<1e-8);assert.ok(Math.abs(energy-r.energy-rules.energyPerMinute*30)<1e-8);choose(w,r,'continue');stepWorld(w,30);assert.equal(j.progress,144);choose(w,r,'turnBack');stepWorld(w,30);assert.equal(j.progress,174);assert.equal(j.status,'waiting');choose(w,r,'continue');stepWorld(w,30);assert.equal(c.journey,null);assert.equal(r.regionalLocation!.progress,204);assert.equal(w.residents.filter(p=>p.id===r.id).length,returning?1:0);assert.equal(r.residency,'outside');}
});

test('first visitor memories and active route evidence remain after the working event window is trimmed',()=>{
 const f=fixture();waitAtStage(f);const ids=[...f.j.eventIds],memories=f.r.memories.map(m=>m.eventId);f.w.minute+=60;for(let i=0;i<220;i++)emitLedgerEvent(f.w,{kind:'system',actors:[],place:{x:0,y:0},text:'其他观察事实'+i});const events=workingEvents(f.w);assert.ok(ids.every(id=>events.some(e=>e.id===id)));assert.ok(memories.every(id=>events.some(e=>e.id===id)));
});


test('a slow reply cannot lengthen the exact walking time chosen before a natural mobility threshold crossing',()=>{
 const f=fixture(),{w,r,j}=f;waitAtStage(f);j.progress=6;r.regionalLocation!.progress=6;r.hunger=85;addHealthCase(w,r,'injury',49.999,'实际伤病恶化');assert.equal(movementRate(w,r),.75);const action=outsideDecisionContext(w,r).outside!.choices.find(c=>c.action.type==='visitorJourney'&&c.action.operation==='continue')!.action;assert.equal(action.type,'visitorJourney');assert.equal((action as VisitorJourneyAction).minutes,8);const revision=r.revision;stepWorld(w,3);assert.equal(movementRate(w,r),.5);assert.equal(r.revision,revision);assert.ok(applyOutsideDecision(w,r.id,revision,{intention:'本人仅选原先的八分钟',actions:[action]}).ok);assert.equal(j.stageRemaining,8);stepWorld(w,8);assert.equal(j.status,'waiting');assert.equal(j.progress,2);
 for(const minutes of [undefined,0,-1,13,NaN,Infinity]){const before=JSON.stringify(w);assert.equal(applyOutsideDecision(w,r.id,r.revision,{intention:'无效时长',actions:[{type:'visitorJourney',operation:'continue',journeyId:j.id,minutes}]}).ok,false);assert.equal(JSON.stringify(w),before);}
});


test('fractional real-time steps normalize a blocked endpoint and cannot shorten the chosen 30-minute retry',()=>{
 const f=fixture(),{w,r,c,j}=f;w.map.tiles[w.map.entrance.y*w.map.width]='water';let limit=300;while(!c.journey!.blocked){assert.ok(limit--);if(j.status==='waiting')choose(w,r,'continue');stepWorld(w,.3);}assert.equal(j.progress,0);assert.equal(r.regionalLocation!.progress,0);const choice=outsideDecisionContext(w,r).outside!.choices.find(c=>c.action.type==='visitorJourney'&&c.action.operation==='continue')!.action as VisitorJourneyAction;assert.equal(choice.minutes,30);choose(w,r,'continue');w.map.tiles[w.map.entrance.y*w.map.width]='grass';stepWorld(w,29.9);assert.equal(r.residency,'outside');stepWorld(w,.1);assert.equal(r.residency,'visitor');
});
