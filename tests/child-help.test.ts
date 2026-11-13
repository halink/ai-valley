import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {EmergencyCareAction} from '../src/shared/emergency-care.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext,prompt} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {childHelpOpportunities,childHelpReason,childHelpTarget,completeChildHelp} from '../src/world/child-help.js';
import {completeEmergencyCare,emergencyCareReason} from '../src/world/emergency-care.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeMigration,applyOutsideDecision} from '../src/world/migration.js';
import {initializeFood,foodContainers} from '../src/world/food.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {recordDeath} from '../src/world/life.js';

import {finishChosenVisit} from './helpers/visitor-journeys.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);
 const [reporter,child,other]=w.residents;
 for(const r of w.residents)Object.assign(r,{at:{x:20,y:10},inside:null,roomAt:null,homeId:null,inventory:{},parents:[],adoptiveParents:[],guardianIds:[],relations:[],bornAt:w.minute-30*YEAR,hunger:25,energy:100,health:100,canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,knownBuildings:[],knownResources:[],knownPeople:[],memories:[]});
 child.bornAt=w.minute-2*YEAR;child.canDecide=child.canExpress=false;child.hunger=70;other.at={x:35,y:15};
 initializeForeignTrade(w);w.foreignTrade!.knownStationIds.push(reporter.id,other.id,child.id);
 initializeRooms(w);initializeEconomy(w);initializeFood(w);stepWorld(w,.001);
 return {w,reporter,child,other};
}
function menu(w:World,r:Resident,operation:EmergencyCareAction['operation']){
 const choices=decisionChoices(decisionContext(w,r)),row=choices.find(c=>c.action.type==='emergencyCare'&&c.action.operation===operation);
 assert.ok(row,`${r.id}: missing final ${operation}`);return {row,choices};
}
function queue(w:World,r:Resident,action:Action){const p={id:`child-help-test:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人自主决定',actions:[action]};assert.ok(submitPlan(w,p).ok);return p;}
function finish(w:World,r:Resident,success=true){let remaining=200;while(r.plan||r.activity){assert.ok(remaining-->0);stepWorld(w,1);}if(success)assert.equal(r.lastFailure,null);}
function run(w:World,r:Resident,operation:EmergencyCareAction['operation']){const {row,choices}=menu(w,r,operation),plan=queue(w,r,parseChoice(JSON.stringify({choice:row.id}),choices).actions[0]);finish(w,r);return plan;}
function post(f:ReturnType<typeof fixture>){run(f.w,f.reporter,'requestHelp');const n=f.w.emergencyCare!.helpNotices![0];run(f.w,f.reporter,'postHelp');return n;}
function read(f:ReturnType<typeof fixture>){const n=post(f);f.other.at={...f.w.map.entrance};run(f.w,f.other,'readHelp');return n;}
const action=(operation:EmergencyCareAction['operation'],noticeId:string):EmergencyCareAction=>({type:'emergencyCare',operation,noticeId});
const stock=(w:World)=>[...foodContainers(w).values()].reduce((n,bag)=>n+(bag.meal??0),0);

test('ordinary final menus connect a real arriving visitor to an infant and separately chosen limited feeding',()=>{
 const f=fixture(),{w,reporter,child}=f,n=post(f),deadline=n.expiresAt,created=n.createdAt;
 assert.equal(n.readers.length,1);assert.equal(n.postedAt!==null,true);assert.deepEqual(reporter.at,w.map.entrance);assert.ok(n.postedAt!-created>=25);assert.equal(w.emergencyCare!.agreements.length,0);
 initializeMigration(w);const contact=w.migration!.contacts[0],visitor=contact.person!,identity=visitor.id;
 assert.ok(applyOutsideDecision(w,identity,visitor.revision,{intention:'本人自愿来访',actions:[{type:'travelToValley'}]}).ok);finishChosenVisit(w,visitor);assert.equal(visitor.residency,'visitor');
 const population=w.residents.length,coins=totalCoins(w),food=stock(w),rights=JSON.stringify([child.guardianIds,child.homeId,w.buildings,w.plots]);
 run(w,visitor,'readHelp');assert.equal(visitor.knownPeople.includes(child.id),false,'reading a name does not make the distant child an observed actor');assert.equal(visitor.deathKnowledge?.[child.id],undefined);
 run(w,reporter,'visitHelp');const start={...visitor.at},at=w.minute;run(w,visitor,'visitHelp');assert.notDeepEqual(visitor.at,start);assert.ok(w.minute-at>=20);assert.equal(n.expiresAt,deadline);assert.equal(w.emergencyCare!.agreements.length,0);assert.equal(stock(w),food);
 run(w,visitor,'offer');const care=w.emergencyCare!.agreements[0];assert.equal(care.providerId,identity);assert.equal(care.reviewerId,reporter.id);assert.equal(care.status,'offered');run(w,reporter,'review');run(w,visitor,'feed');
 assert.equal(care.meals,1);assert.equal(stock(w),food-1);assert.equal(w.residents.length,population);assert.equal(w.residents.filter(r=>r.id===identity).length,1);assert.equal(totalCoins(w),coins);assert.equal(JSON.stringify([child.guardianIds,child.homeId,w.buildings,w.plots]),rights);assert.equal(visitor.residency,'visitor');

});

test('a report requires lawful witnessed guardian evidence, but no food or second adult; older children speak for themselves',()=>{
 const {w,reporter,child,other}=fixture();reporter.bornAt=w.minute-13*YEAR;
 assert.equal(childHelpReason(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}),null);
 child.guardianIds=['unknown'];assert.ok(childHelpReason(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}));child.guardianIds=[other.id];other.canDecide=false;assert.ok(childHelpReason(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}));other.at={...child.at};assert.equal(childHelpReason(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}),null);
 child.guardianIds=[];child.refusesCare=true;assert.ok(childHelpReason(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}));child.refusesCare=false;child.bornAt=w.minute-8*YEAR;child.canDecide=child.canExpress=true;
 assert.ok(childHelpReason(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}));run(w,child,'requestHelp');assert.equal(w.emergencyCare!.helpNotices![0].reporterId,child.id);
});

test('unknown guardian death is not evidence and public notice is not a death certificate',()=>{
 const f=fixture(),{w,reporter,child,other}=f;child.guardianIds=[other.id];recordDeath(w,other);assert.ok(childHelpReason(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}));
 child.guardianIds=[];const n=post(f);assert.ok(n.evidence.includes('observed-child-with-no-registered-guardian'));assert.equal(w.funerary?.certificates?.length??0,0);assert.ok(w.events.filter(e=>n.eventIds.includes(e.id)).every(e=>e.kind==='care'&&e.actors.length===1&&e.actors[0]===reporter.id));
});

test('no reporter, no decision or an unposted draft cannot announce a child or create a helper',()=>{
 const f=fixture(),{w,reporter,child,other}=f,count=w.residents.length;
 assert.deepEqual(childHelpOpportunities(w,child),[]);stepWorld(w,20);assert.equal(w.emergencyCare!.helpNotices,undefined);assert.equal(w.residents.length,count);
 run(w,reporter,'requestHelp');other.at={...w.map.entrance};assert.ok(!childHelpOpportunities(w,other).some(c=>c.action.type==='emergencyCare'&&['readHelp','visitHelp'].includes(c.action.operation)));stepWorld(w,20);assert.equal(w.emergencyCare!.helpNotices![0].postedAt,null);assert.equal(w.residents.length,count);
});

test('historical location and original deadline do not follow a moved child or reset when posting and reading',()=>{
 const f=fixture(),{w,reporter,child,other}=f;run(w,reporter,'requestHelp');const n=w.emergencyCare!.helpNotices![0],original=structuredClone(n.location),deadline=n.expiresAt;child.at={x:32,y:2};run(w,reporter,'postHelp');other.at={...w.map.entrance};run(w,other,'readHelp');
 const selected=menu(w,other,'visitHelp').row.action as EmergencyCareAction,target=childHelpTarget(w,other,selected);assert.deepEqual(target.target,original.at);assert.deepEqual(n.location,original);assert.equal(n.expiresAt,deadline);
 run(w,other,'visitHelp');assert.ok(other.at.x<=21);assert.ok(!other.memories.some(m=>m.text.includes('32,2')));assert.equal(w.emergencyCare!.agreements.length,0);
});

test('remote moves, death, refusal and guardian recovery do not alter a reader context, prompt or menu',()=>{
 const f=fixture(),n=read(f),{w,other,child}=f;other.at={x:1,y:10};
 child.at={x:30,y:2};child.status='dead';child.refusesCare=true;child.guardianIds=[f.reporter.id];f.reporter.at={x:30,y:2};
 // The reporter was initially visible at the gate; remove that independent difference from both snapshots.
 const control=structuredClone(w);control.residents.find(r=>r.id===child.id)!.status='alive';control.residents.find(r=>r.id===child.id)!.refusesCare=false;control.residents.find(r=>r.id===child.id)!.guardianIds=[];control.residents.find(r=>r.id===child.id)!.at={...n.location.at};
 const baseline=decisionContext(control,control.residents.find(r=>r.id===other.id)!);assert.deepEqual(decisionContext(w,other),baseline);assert.deepEqual(decisionChoices(decisionContext(w,other)),decisionChoices(baseline));assert.deepEqual(prompt(decisionContext(w,other)),prompt(baseline));
});

test('a remote withdrawal is learned only by returning to read the actual correction',()=>{
 const f=fixture(),n=read(f),{w,reporter,other}=f;other.at={x:8,y:10};const before=childHelpOpportunities(w,other);run(w,reporter,'withdrawHelp');assert.deepEqual(childHelpOpportunities(w,other),before);assert.equal(n.readers.find(k=>k.personId===other.id)!.withdrawnAt,null);
 other.at={...w.map.entrance};run(w,other,'readHelp');assert.equal(n.readers.find(k=>k.personId===other.id)!.withdrawnAt,n.withdrawnAt);assert.ok(!childHelpOpportunities(w,other).some(c=>c.action.type==='emergencyCare'&&c.action.operation==='visitHelp'));
});

test('room evidence never gives a visitor permission to enter a private home',()=>{
 const f=fixture(),{w,reporter,child,other}=f;
 const b={id:'child-home',name:'幼儿原住所',kind:'home' as const,at:{x:18,y:6},width:4,height:3,door:{x:20,y:9},ownerId:reporter.id,residents:[child.id],capacity:2,condition:100,definition:'building/home@1'};w.buildings.push(b);
 for(const r of [reporter,child]){r.at={...b.door};r.inside=b.id;r.roomAt={...roomLayout(w,b).entry};}
 const n=read(f);assert.equal(n.location.inside,b.id);run(w,other,'visitHelp');assert.equal(other.inside,null);assert.deepEqual(other.at,b.door);assert.match(other.memories.at(-1)!.text,/没有找到可合法接触/);assert.equal(child.inside,b.id);assert.equal(w.emergencyCare!.agreements.length,0);
});

test('shared-room visit walks to the recorded room place without following a later indoor move',()=>{
 const f=fixture(),{w,reporter,child,other}=f;
 const b={id:'shared-home',name:'共屋',kind:'lodge' as const,at:{x:18,y:6},width:4,height:3,door:{x:20,y:9},ownerId:'commons',residents:[],capacity:2,condition:100,definition:'building/lodge@1'};w.buildings.push(b);
 for(const r of [reporter,child]){r.at={...b.door};r.inside=b.id;r.roomAt={...roomLayout(w,b).entry};}
 const n=read(f),old={...n.location.roomAt!};child.roomAt={x:2,y:5};run(w,other,'visitHelp');assert.equal(other.inside,b.id);assert.deepEqual(other.roomAt,old);assert.deepEqual(n.location.roomAt,old);assert.match(other.memories.at(-1)!.text,/没有找到可合法接触/);
});

test('a blocked path or deadline reached in transit leaves no invented visit, food, housing or renewal',()=>{
 for(const cause of ['path','expiry'] as const){const f=fixture(),n=read(f),{w,other,child}=f,before=JSON.stringify([child.inventory,child.guardianIds,child.homeId]),deadline=n.expiresAt;
  const a=menu(w,other,'visitHelp').row.action;if(cause==='path')for(let y=0;y<w.map.height;y++)w.map.tiles[y*w.map.width+10]='water';else w.minute=n.expiresAt-5;
  queue(w,other,a);finish(w,other,false);assert.ok(other.lastFailure);assert.equal(n.readers.find(k=>k.personId===other.id)!.visitAt,null);assert.equal(n.expiresAt,deadline);assert.equal(JSON.stringify([child.inventory,child.guardianIds,child.homeId]),before);
 }
});

test('read completion requires actual gate and conscious local observation, not knowing a notice id',()=>{
 const f=fixture(),n=post(f),{w,other}=f,a=action('readHelp',n.id);
 assert.ok(completeChildHelp(w,other,a));other.at={x:1,y:10};assert.equal(childHelpReason(w,other,a),null);assert.ok(completeChildHelp(w,other,a));other.at={...w.map.entrance};other.canDecide=false;assert.ok(completeChildHelp(w,other,a));other.canDecide=true;other.residency='outside';assert.ok(completeChildHelp(w,other,a));other.residency='resident';other.inside='elsewhere';assert.ok(completeChildHelp(w,other,a));other.inside=null;
 assert.equal(completeChildHelp(w,other,a),null);assert.ok(completeChildHelp(w,other,a));assert.equal(n.readers.filter(k=>k.personId===other.id).length,1);assert.equal(other.memories.at(-1)!.source,'heard');
});

test('restarts preserve fixed deadlines, completed receipts and evidence under history trimming',()=>{
 const f=fixture(),n=read(f),{w,reporter,other}=f,deadline=n.expiresAt;
 const plan=run(w,other,'visitHelp'),before=JSON.stringify(w);assert.ok(submitPlan(w,plan).ok);assert.equal(JSON.stringify(w),before);assert.ok(completeChildHelp(w,other,action('visitHelp',n.id)));
 for(const r of w.residents)r.memories=[];w.minute+=60;for(let i=0;i<250;i++)emitLedgerEvent(w,{kind:'system',actors:[],place:{x:0,y:0},text:'unrelated test event'});
 const retained=workingEvents(w);for(const id of n.eventIds)assert.ok(retained.some(e=>e.id===id));const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();const saved=restored.emergencyCare!.helpNotices![0];assert.deepEqual(saved,n);assert.equal(saved.expiresAt,deadline);
 restored.minute=deadline;assert.ok(completeChildHelp(restored,restored.residents.find(r=>r.id===reporter.id)!,action('postHelp',n.id)));assert.equal(saved.expiresAt,deadline);assert.equal(saved.readers.filter(k=>k.visitAt!==null).length,1);
});

test('read-only opportunities and decision context cannot inject another child or permissions',()=>{
 const f=fixture(),{w,reporter,child}=f;child.name='<script>child</script>';const n=post(f),before=JSON.stringify(w);childHelpOpportunities(w,reporter);decisionContext(w,reporter);assert.equal(JSON.stringify(w),before);
 assert.ok(completeChildHelp(w,reporter,{...action('visitHelp',n.id),childId:f.other.id}));assert.ok(emergencyCareReason(w,reporter,{...action('visitHelp',n.id),agreementId:'forged'}));
 const {row,choices}=menu(w,reporter,'visitHelp');for(const extra of [{days:30},{guardianId:reporter.id},{childId:f.other.id}])assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,...extra}),choices));const a=row.action as Action & EmergencyCareAction;childHelpTarget(w,reporter,a);a.observedTarget!.at.x=39;assert.notEqual(n.location.at.x,39);assert.ok(completeEmergencyCare(w,reporter,{type:'emergencyCare',operation:'feed',noticeId:n.id}));
});

test('a child reaching independent age may withdraw without remotely changing the reporter menu',()=>{
 const f=fixture(),{w,reporter,child}=f;child.bornAt=w.minute-6*YEAR+60;const n=post(f);
 w.minute=n.createdAt+61;child.canDecide=child.canExpress=true;child.at={...w.map.entrance};run(w,child,'readHelp');reporter.at={x:20,y:10};
 const before=childHelpOpportunities(w,reporter);run(w,child,'withdrawHelp');assert.equal(n.readers.find(k=>k.personId===reporter.id)!.withdrawnAt,null);assert.deepEqual(childHelpOpportunities(w,reporter),before);
 const withdrawnAt=n.withdrawnAt;run(w,reporter,'withdrawHelp');assert.equal(n.withdrawnAt,withdrawnAt);assert.equal(n.readers.find(k=>k.personId===reporter.id)!.withdrawnAt,withdrawnAt);assert.ok(!childHelpOpportunities(w,reporter).some(c=>c.action.type==='emergencyCare'&&c.action.operation==='visitHelp'));
});

test('an unposted report stays unposted if the reporter dies; expiry and init never fabricate past help',()=>{
 const f=fixture(),{w,reporter}=f;run(w,reporter,'requestHelp');const n=w.emergencyCare!.helpNotices![0],deadline=n.expiresAt;reporter.at={x:30,y:2};recordDeath(w,reporter);w.minute=deadline;stepWorld(w,1);assert.equal(n.postedAt,null);assert.equal(n.expiresAt,deadline);assert.equal(n.readers.length,1);assert.equal(w.emergencyCare!.agreements.length,0);
});
