import {finishChosenVisit} from './helpers/visitor-journeys.js';
import {test} from 'node:test';

import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {OutsideAidAction} from '../src/shared/outside-aid.js';
import {createWorld} from '../src/world/seed.js';
import {initializeForeignTrade,applyForeignDecision,foreignDecisionContext} from '../src/world/foreign-trade.js';
import {initializeOutsideAid,completeOutsideAid,outsideAidReason,advanceOutsideAid} from '../src/world/outside-aid.js';
import {initializeMigration,advanceMigration,applyOutsideDecision,outsideDecisionContext,outsideCandidate,stationDuration} from '../src/world/migration.js';
import {visitorAidOpportunities,hasTimelyVisitorAidRescue} from '../src/world/visitor-aid.js';
import {initializeFood,advanceFood,foodContainers,foodTransaction} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {DecisionError,type ModelResult} from '../src/server/decisions.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitLedgerEvent} from '../src/world/events.js';

import {initializeIndustry,industryTarget} from '../src/world/industry.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {productionTarget,emergencyEstateOptions} from '../src/world/production.js';
import {splitEstateParcels,acceptEstateParcels,atEstateLocation} from '../src/world/estate-custody.js';
import {addHealthCase,advanceHealth} from '../src/world/health.js';
import {recordDeath} from '../src/world/life.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.map={...w.map,width:20,height:12,tiles:Array(240).fill('grass'),entrance:{x:0,y:6}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,1);
 const child=w.residents[0];Object.assign(child,{at:{...w.map.entrance},inside:null,roomAt:null,homeId:null,inventory:{},parents:[],guardianIds:[],bornAt:w.minute-10*YEAR,hunger:70,energy:100,health:100,canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,knownBuildings:[],knownResources:[]});
 initializeForeignTrade(w);initializeOutsideAid(w);initializeMigration(w);initializeFood(w);
 const c=w.migration!.contacts[0],traveller=c.person!,id=traveller.id,inventory={...traveller.inventory};
 assert.equal(applyOutsideDecision(w,id,traveller.revision,{intention:'本人选择先访问山谷',actions:[{type:'travelToValley'}]}).ok,true);finishChosenVisit(w,traveller);assert.equal(traveller.residency,'visitor');assert.equal(c.person,undefined);assert.deepEqual(traveller.inventory,inventory);
 assert.equal(completeOutsideAid(w,child,{type:'outsideAid',operation:'post'}),null);return {w,child,traveller,c,n:w.outsideAid!.notices[0],m:w.foreignTrade!.merchants[0]};
}
function queue(w:World,r:Resident,actions:Action[]){return submitPlan(w,{id:`visitor-aid:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择',actions});}
function finish(w:World,r:Resident){let cap=100;while(r.activity||r.plan){assert.ok(cap--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function carry(f:ReturnType<typeof fixture>){const action:OutsideAidAction={type:'outsideAid',operation:'carryMail',noticeId:f.n.id};assert.equal(completeOutsideAid(f.w,f.traveller,action),null);return f.w.outsideAid!.visitorJourneys![0];}
function outside(f:ReturnType<typeof fixture>,operation:'continueMail'|'returnMail'){const j=f.w.outsideAid!.visitorJourneys![0];assert.equal(applyOutsideDecision(f.w,f.traveller.id,f.traveller.revision,{intention:'本人重新决定',actions:[{type:'outsideAid',operation,journeyId:j.id}]}).ok,true);}
function advance(f:ReturnType<typeof fixture>,n:number){f.w.minute+=n;advanceMigration(f.w);}
const stocks=(w:World,item:'turnip'|'meal')=>[...foodContainers(w).values()].reduce((sum,b)=>sum+(b[item]??0),0)+(w.food?.spoiled[item]??0);

test('a real visitor independently carries an orphan request home without any trade shipment, then the merchant independently sends existing food',()=>{
 const f=fixture(),{w,child,traveller,c,n,m}=f,identity=traveller.id,pop=w.residents.length,stocksBefore=stocks(w,'turnip');
 assert.equal(w.residents.filter(r=>r.residency==='resident'&&r.status==='alive').length,1);assert.equal(w.foreignTrade!.shipments.length,0);
 const choices=decisionChoices(decisionContext(w,traveller)),choice=choices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='carryMail')!;assert.ok(choice);assert.match(choice.label,/结束本次访问/);
 assert.equal(queue(w,traveller,parseChoice(JSON.stringify({choice:choice.id}),choices).actions).ok,true);finish(w,traveller);const j=w.outsideAid!.visitorJourneys![0];
 assert.equal(j.duration,stationDuration(w,c.origin));assert.equal(j.progress,0);assert.equal(traveller.residency,'outside');assert.equal(n.mail!.carrierKind,'visitor');assert.equal(n.mail!.courierId,identity);assert.equal(n.mail!.receivedAt,null);assert.equal(c.phase,'carryingMail');assert.equal(outsideCandidate(w).includes(traveller),false);assert.equal(m.person.inventory.turnip,36);
 advance(f,j.duration/2);assert.equal(outsideCandidate(w).includes(traveller),true);const context=outsideDecisionContext(w,traveller);assert.ok(context.outside!.choices.some(c=>c.action.type==='outsideAid'&&c.action.operation==='returnMail'));assert.deepEqual(context.people,[]);assert.equal(n.mail!.receivedAt,null);
 advance(f,j.duration/2-1);assert.equal(n.mail!.receivedAt,null);advance(f,1);assert.equal(j.status,'delivered');assert.equal(n.mail!.receivedAt,w.minute);assert.equal(c.phase,'home');assert.equal(w.residents.filter(p=>p.id===identity).length,1);assert.equal(w.residents.length,pop);assert.equal(w.foreignTrade!.shipments.length,0);assert.equal(w.outsideAid!.deliveries.length,0,'carriage does not choose a donation');
 const menu=decisionChoices(foreignDecisionContext(w,m.person)),accept=menu.find(c=>c.action.type==='outsideAid'&&c.action.operation==='accept'&&c.action.item==='turnip'&&c.action.quantity===2)!;assert.ok(accept);assert.equal(applyForeignDecision(w,m.id,m.person.revision,parseChoice(JSON.stringify({choice:accept.id}),menu)).ok,true);
 const d=w.outsideAid!.deliveries[0];assert.equal(d.status,'reserved');assert.equal(completeOutsideAid(w,m.person,{type:'outsideAid',operation:'dispatch',deliveryId:d.id}),null);w.minute=d.arrivesAt!;advanceOutsideAid(w);
 const collection=decisionChoices(decisionContext(w,child)).find(c=>c.action.type==='outsideAid'&&c.action.operation==='collect')!;assert.ok(collection);assert.equal(queue(w,child,[collection.action]).ok,true);finish(w,child);assert.equal(child.inventory.turnip,2);assert.equal(stocks(w,'turnip'),stocksBefore);assert.deepEqual(child.guardianIds,[]);assert.equal(child.homeId,null);assert.equal(child.residency,'resident');
});

test('declining to carry creates no replacement; only an actual capable visitor with a matching origin may carry',()=>{
 const f=fixture(),{w,child,traveller,n,c}=f;advance(f,20);assert.equal(n.mail,null);assert.equal(w.outsideAid!.visitorJourneys,undefined);assert.equal(w.residents.length,2);
 assert.ok(outsideAidReason(w,child,{type:'outsideAid',operation:'carryMail',noticeId:n.id}));traveller.canExpress=false;assert.equal(visitorAidOpportunities(w,traveller).length,0);traveller.canExpress=true;
 traveller.residency='resident';assert.equal(visitorAidOpportunities(w,traveller).length,0);traveller.residency='visitor';c.origin='苇塘渡';assert.match(outsideAidReason(w,traveller,{type:'outsideAid',operation:'carryMail',noticeId:n.id})!,/原居地/);c.origin='西岭驿';
 traveller.at={x:15,y:6};assert.equal(visitorAidOpportunities(w,traveller).length,0);traveller.at={...w.map.entrance};child.guardianIds=[traveller.id];assert.match(outsideAidReason(w,traveller,{type:'outsideAid',operation:'carryMail',noticeId:n.id})!,/监护/);child.guardianIds=[];
 const action:OutsideAidAction={type:'outsideAid',operation:'carryMail',noticeId:n.id};assert.equal(queue(w,traveller,[action,{type:'wait',minutes:30}]).ok,false);assert.equal(n.mail,null);
});

test('gate failure before pickup changes no custody or lodging; a completed departure releases only actual lodging',()=>{
 const f=fixture(),{w,traveller,n}=f;const old={id:'guest-home',kind:'home' as const,name:'原借住处',at:{x:10,y:1},width:2,height:2,door:{x:11,y:3},ownerId:traveller.id,definition:'building/home@1',capacity:1,residents:[traveller.id],condition:100};w.buildings.push(old);traveller.homeId=old.id;
 const action:OutsideAidAction={type:'outsideAid',operation:'carryMail',noticeId:n.id};w.map.tiles[w.map.entrance.y*w.map.width+w.map.entrance.x]='water';assert.match(completeOutsideAid(w,traveller,action)!,/通行/);assert.equal(n.mail,null);assert.equal(traveller.residency,'visitor');assert.equal(traveller.homeId,old.id);assert.deepEqual(old.residents,[traveller.id]);
 w.map.tiles[w.map.entrance.y*w.map.width+w.map.entrance.x]='grass';carry(f);assert.equal(traveller.homeId,null);assert.deepEqual(old.residents,[]);assert.equal(old.ownerId,traveller.id);
 advance(f,6);outside(f,'returnMail');advance(f,6);assert.equal(traveller.residency,'visitor');assert.equal(traveller.homeId,null);assert.deepEqual(old.residents,[]);assert.equal(old.ownerId,traveller.id);
});

test('turnback keeps the same person and paper at actual progress, waits outside a blocked gate, and needs a new decision to resume',()=>{
 const f=fixture(),{w,traveller,n,m}=f,j=carry(f);advance(f,9);outside(f,'returnMail');assert.equal(j.progress,9);assert.equal(n.mail!.receivedAt,null);advance(f,8);assert.equal(j.progress,1);assert.equal(traveller.residency,'outside');assert.notEqual(n.mail,null);
 w.map.tiles[w.map.entrance.y*w.map.width+w.map.entrance.x]='water';advance(f,1);assert.equal(j.status,'waiting');assert.equal(j.progress,0);assert.equal(traveller.residency,'outside');assert.notEqual(n.mail,null);assert.match(outsideDecisionContext(w,traveller).outside!.notice,/入口实际受阻/);
 w.map.tiles[w.map.entrance.y*w.map.width+w.map.entrance.x]='grass';advance(f,10);assert.equal(j.status,'waiting');outside(f,'continueMail');advance(f,1);assert.equal(j.status,'returned');assert.equal(n.mail,null);assert.equal(traveller.residency,'visitor');assert.deepEqual(traveller.at,w.map.entrance);assert.equal(w.residents.filter(r=>r.id===traveller.id).length,1);assert.ok(!m.person.memories.some(m=>m.text.includes('访客')));
});

test('remote withdrawal and recipient unavailability do not teleport knowledge or the original paper',()=>{
 const f=fixture(),{w,child,n,m}=f,j=carry(f);const context=outsideDecisionContext(w,f.traveller);assert.equal(completeOutsideAid(w,child,{type:'outsideAid',operation:'withdraw',noticeId:n.id}),null);assert.equal(outsideDecisionContext(w,f.traveller).outside!.notice,context.outside!.notice);
 m.person.status='dead';advance(f,j.duration);assert.equal(j.status,'waiting');assert.equal(n.mail!.receivedAt,null);assert.equal(j.progress,j.duration);assert.match(outsideDecisionContext(w,f.traveller).outside!.notice,/原接收商行/);
 m.person.status='alive';advance(f,10);assert.equal(n.mail!.receivedAt,null);outside(f,'continueMail');advance(f,1);assert.equal(j.status,'delivered');assert.equal(n.mail!.receivedAt,w.minute);assert.equal(n.withdrawnAt!==null,true);assert.equal(w.outsideAid!.deliveries.length,0);
});

test('expiry, incapacity, death and restart never duplicate an actor, a paper receipt, or food',()=>{
 const f=fixture(),{w,traveller,n,m}=f,j=carry(f),before=stocks(w,'meal');w.food!.lots['person:'+traveller.id]!.meal![0].expiresAt=w.minute+1;advance(f,1);advanceFood(w);assert.equal(stocks(w,'meal'),before);const revision=traveller.revision-1;
 assert.equal(applyOutsideDecision(w,traveller.id,revision,{intention:'旧决定',actions:[{type:'outsideAid',operation:'returnMail',journeyId:j.id}]}).ok,false);
 traveller.canDecide=false;advance(f,1);const progress=j.progress;advance(f,10);assert.equal(j.progress,progress);assert.equal(j.status,'waiting');traveller.canDecide=true;outside(f,'continueMail');advance(f,5);
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();const p=restored.residents.find(r=>r.id===traveller.id)!,restoredJourney=restored.outsideAid!.visitorJourneys![0];initializeOutsideAid(restored);restored.minute+=restoredJourney.duration-restoredJourney.progress;advanceMigration(restored);assert.equal(restoredJourney.status,'delivered');assert.equal(restored.outsideAid!.notices[0].mail!.receivedAt,restored.minute);assert.equal(restored.residents.filter(r=>r.id===p.id).length,1);const eventCount=restored.events.length;advanceMigration(restored);assert.equal(restored.events.length,eventCount);
 const g=fixture(),broken=carry(g);advance(g,7);recordDeath(g.w,g.traveller);advance(g,1);assert.equal(broken.status,'interrupted');assert.equal(g.n.mail!.receivedAt,null);assert.ok(!g.m.person.memories.some(m=>m.text.includes('访客')));assert.equal(g.w.residents.length,2);assert.equal(g.w.outsideAid!.deliveries.length,0);
});

test('only the same carrier can revise their route; late decisions cannot undo physical delivery, and all journey evidence survives trimming',()=>{
 const f=fixture(),{w,traveller,child}=f,j=carry(f),revision=traveller.revision;
 assert.equal(completeOutsideAid(w,child,{type:'outsideAid',operation:'returnMail',journeyId:j.id})!==null,true);advance(f,6);outside(f,'continueMail');advance(f,j.duration-j.progress);const deliveredAt=f.n.mail!.receivedAt;
 assert.equal(applyOutsideDecision(w,traveller.id,revision,{intention:'迟到折返',actions:[{type:'outsideAid',operation:'returnMail',journeyId:j.id}]}).ok,false);assert.equal(f.n.mail!.receivedAt,deliveredAt);
 const ids=[...j.eventIds,...f.n.eventIds];w.minute+=100;for(let i=0;i<220;i++)emitLedgerEvent(w,{kind:'system',actors:[],place:w.map.entrance,text:'unrelated '+i});assert.ok(ids.every(id=>workingEvents(w).some(e=>e.id===id)));
});

test('visitor mail return pauses at a blocked entrance',()=>{
 const f=fixture();f.traveller.name='<img src=x onerror=alert(1)>';const j=carry(f),before=JSON.stringify(f.w);
 assert.equal(JSON.stringify(f.w),before);
 advance(f,6);outside(f,'returnMail');f.w.map.tiles[f.w.map.entrance.y*f.w.map.width+f.w.map.entrance.x]='water';advance(f,6);assert.equal(j.status,'waiting');
});

test('a return requires a traversable entrance, not an isolated walkable gate tile',()=>{
 const f=fixture(),j=carry(f);advance(f,5);outside(f,'returnMail');const gate=f.w.map.entrance;
 for(const [dx,dy] of [[1,0],[0,1],[0,-1]])f.w.map.tiles[(gate.y+dy)*f.w.map.width+gate.x+dx]='water';
 advance(f,5);assert.equal(j.status,'waiting');assert.equal(f.traveller.residency,'outside');assert.notEqual(f.n.mail,null);
 f.w.map.tiles[gate.y*f.w.map.width+gate.x+1]='grass';outside(f,'continueMail');advance(f,1);assert.equal(j.status,'returned');assert.equal(f.traveller.regionalLocation,undefined);
 const seen=f.child.memories.length;addHealthCase(f.w,f.traveller,'injury',5,'实际返谷后的在场损伤');assert.ok(f.child.memories.length>seen,'actual return restores ordinary nearby observation');
});

test('regional health and death never create gate witnesses, a local body, accessible estate food, or a dead self memory',()=>{
 const f=fixture(),{w,child,traveller}=f;initializeIndustry(w);w.industry!.tools.push({id:'mail-tool',ownerId:traveller.id,kind:'axe',level:1,durability:40,maxDurability:50,location:null});const j=carry(f);advance(f,7);
 const seen=JSON.stringify(child.memories),body={...traveller.regionalLocation!};assert.deepEqual(traveller.at,{x:-1,y:-1});
 const illness=addHealthCase(w,traveller,'injury',.001,'镇外真实损伤')!;w.minute++;advanceHealth(w,1);assert.equal(illness.stage,'resolved');assert.equal(JSON.stringify(child.memories),seen);
 const memory=JSON.stringify(traveller.memories);recordDeath(w,traveller);advance(f,1);assert.equal(j.status,'interrupted');assert.equal(JSON.stringify(traveller.memories),memory);assert.equal(JSON.stringify(child.memories),seen);
 const death=w.events.find(e=>e.kind==='death'&&e.actors[0]===traveller.id)!;assert.equal(death.observerOnly,true);assert.deepEqual(death.witnesses,[]);assert.equal(death.bodyLocation,undefined);assert.deepEqual(death.regionalLocation,body);
 const estate=w.estates.find(e=>e.personId===traveller.id)!;assert.deepEqual(estate.location!.regional,body);assert.equal(atEstateLocation(child,estate.location!),false);
 child.bornAt=w.minute-20*YEAR;const shares=foodTransaction(w,()=>splitEstateParcels(w,traveller.id,[child.id],['regional-share']));acceptEstateParcels(w,shares[0],child.id);const parcel=estate.parcels!.find(p=>p.id===shares[0][0])!;assert.deepEqual(parcel.location.regional,body);assert.match(productionTarget(w,child,{type:'production',operation:'collectEstate',parcelId:parcel.id}).error!,/镇外/);assert.equal(emergencyEstateOptions(w,child).length,0);
 const tool=w.industry!.tools[0];tool.ownerId=child.id;assert.deepEqual(tool.location!.regional,body);assert.match(industryTarget(w,child,{type:'industry',operation:'collectTool',toolId:tool.id}).error!,/镇外/);assert.ok(!industryOpportunities(w,child).some(o=>o.action.type==='industry'&&o.action.operation==='collectTool'));
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();assert.deepEqual(restored.estates[0].parcels![0].location.regional,body);assert.deepEqual(restored.industry!.tools[0].location!.regional,body);
});

test('chosen regional journeys and blocked waits consume body time; an unfed exhausted traveller can die before delivery',()=>{
 const f=fixture(),j=carry(f);f.traveller.inventory={};f.traveller.hunger=100;f.traveller.energy=0;f.traveller.health=.1;const memories=JSON.stringify(f.traveller.memories);stepWorld(f.w,3);
 assert.equal(f.traveller.status,'dead');assert.equal(j.status,'interrupted');assert.ok(j.progress<j.duration);assert.equal(f.n.mail!.receivedAt,null);assert.equal(JSON.stringify(f.traveller.memories),memories);assert.equal(f.w.residents.length,2);
 const g=fixture(),trip=carry(g);stepWorld(g.w,3);outside(g,'returnMail');g.w.map.tiles[g.w.map.entrance.y*g.w.map.width+g.w.map.entrance.x]='water';stepWorld(g.w,3);assert.equal(trip.status,'waiting');const hunger=g.traveller.hunger,energy=g.traveller.energy;stepWorld(g.w,20);assert.ok(g.traveller.hunger>hunger);assert.ok(g.traveller.energy<energy);assert.equal(trip.progress,0);
});

test('regional eating and sitting rest require their own choice, elapsed work and real supplies, without moving or inventing a bed',()=>{
 const f=fixture(),j=carry(f),r=f.traveller;r.hunger=90;r.energy=1;const original=r.inventory.meal!;
 const eat=outsideDecisionContext(f.w,r).outside!.choices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='eatMail'&&c.action.item==='meal')!;assert.ok(eat);assert.equal(applyOutsideDecision(f.w,r.id,r.revision,{intention:'本人停步吃饭',actions:[eat.action]}).ok,true);
 stepWorld(f.w,4);assert.equal(r.inventory.meal,original);assert.equal(j.progress,0);assert.equal(outsideCandidate(f.w).includes(r),false);stepWorld(f.w,1);assert.equal(r.inventory.meal,original-1);assert.ok(r.hunger<60);assert.equal(j.status,'waiting');assert.equal(j.pause,undefined);assert.equal(j.progress,0);assert.equal(outsideCandidate(f.w).includes(r),true);
 const rest=outsideDecisionContext(f.w,r).outside!.choices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='restMail')!;assert.equal(applyOutsideDecision(f.w,r.id,r.revision,{intention:'本人停步休息',actions:[rest.action]}).ok,true);const energy=r.energy,hunger=r.hunger;stepWorld(f.w,30);assert.ok(r.energy>energy);assert.ok(r.hunger>hunger);assert.equal(j.progress,0);assert.equal(r.homeId,null);assert.equal(j.pause,undefined);outside(f,'continueMail');stepWorld(f.w,1);assert.equal(j.progress,1);
});

test('food expiring during a chosen regional meal is not replaced or consumed, and pause work survives reload',()=>{
 const f=fixture(),j=carry(f),r=f.traveller;r.hunger=70;const action:OutsideAidAction={type:'outsideAid',operation:'eatMail',journeyId:j.id,item:'berry'};assert.equal(applyOutsideDecision(f.w,r.id,r.revision,{intention:'本人吃现有浆果',actions:[action]}).ok,true);for(const lot of f.w.food!.lots['person:'+r.id]!.berry!)lot.expiresAt=f.w.minute+1;
 stepWorld(f.w,2);assert.equal(j.pause!.remaining,3);const store=new WorldStore(':memory:');store.commit(f.w,null);const w=store.load(true)!;store.close();const p=w.residents.find(p=>p.id===r.id)!;stepWorld(w,3);assert.equal(p.inventory.berry??0,0);assert.ok(p.hunger>70);assert.equal(w.outsideAid!.visitorJourneys![0].progress,0);assert.match(w.outsideAid!.visitorJourneys![0].reason!,/腐败/);assert.equal(w.outsideAid!.notices[0].mail!.receivedAt,null);
});

test('global pause freezes a regional rest, while incapacity interrupts it without writing an unconscious self memory',()=>{
 const f=fixture(),j=carry(f),r=f.traveller;assert.equal(applyOutsideDecision(f.w,r.id,r.revision,{intention:'本人停步休息',actions:[{type:'outsideAid',operation:'restMail',journeyId:j.id}]}).ok,true);stepWorld(f.w,3);
 f.w.clock.paused=true;const before=JSON.stringify(f.w);stepWorld(f.w,60);advanceMigration(f.w);assert.equal(JSON.stringify(f.w),before);f.w.clock.paused=false;
 const memory=JSON.stringify(r.memories),energy=r.energy;r.canDecide=false;stepWorld(f.w,2);assert.equal(j.pause,undefined);assert.equal(j.status,'waiting');assert.equal(JSON.stringify(r.memories),memory);assert.ok(r.energy<energy);assert.equal(j.progress,0);
 r.canDecide=true;stepWorld(f.w,5);assert.equal(j.status,'waiting');assert.equal(j.progress,0);outside(f,'continueMail');stepWorld(f.w,1);assert.equal(j.progress,1);
});

const protectedRegionalStep=(w:World,n:number)=>stepWorld(w,n,{decisionChoices:()=>[]});
function waitingFixture(){const f=fixture(),j=carry(f);f.w.clock.realMinutesPerDay=20;assert.equal(applyOutsideDecision(f.w,f.traveller.id,f.traveller.revision,{intention:'自行先停步休息',actions:[{type:'outsideAid',operation:'restMail',journeyId:j.id}]}).ok,true);stepWorld(f.w,30);Object.assign(f.traveller,{hunger:98,energy:80,health:1});f.child.decisionDue=Number.MAX_SAFE_INTEGER;f.child.lastDecisionAt=f.w.minute;return {...f,j};}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('a stopped regional technical waiter has the same bounded protection only when real supplies can rescue them in time',()=>{
 const f=waitingFixture(),r=f.traveller,before=JSON.stringify(f.w);assert.equal(hasTimelyVisitorAidRescue(f.w,r),true);assert.equal(JSON.stringify(f.w),before);protectedRegionalStep(f.w,5);
 assert.equal(r.health,1);assert.ok(r.hunger>98);assert.ok(r.energy<80);assert.equal(r.decisionProtection!.expiresAt-r.decisionProtection!.startedAt,180);assert.ok(r.decisionProtection!.prevented.hunger>0);assert.equal(f.j.progress,0);assert.equal(f.w.events.find(e=>e.decisionProtection?.phase==='started'&&e.actors[0]===r.id)!.regionalLocation!.routeId,f.j.id);
 for(const mode of ['no-food','too-late','expiry'] as const){const g=waitingFixture();if(mode==='no-food')g.traveller.inventory={};if(mode==='too-late')g.traveller.health=.1;if(mode==='expiry')for(const lots of Object.values(g.w.food!.lots['person:'+g.traveller.id]))for(const lot of lots??[])lot.expiresAt=g.w.minute+3;
  const original=JSON.stringify(g.w);assert.equal(hasTimelyVisitorAidRescue(g.w,g.traveller),false,mode);assert.equal(JSON.stringify(g.w),original);protectedRegionalStep(g.w,1);assert.equal(g.traveller.decisionProtection,undefined);assert.ok(g.traveller.health<1);
 }
 const moving=fixture();carry(moving);Object.assign(moving.traveller,{hunger:98,energy:80,health:1});protectedRegionalStep(moving.w,5);assert.equal(moving.traveller.decisionProtection,undefined);assert.ok(moving.traveller.health<1,'a chosen physical journey is not a technical wait');
});

test('regional protection expires once, does not shield disease, and never renews merely by leaving and returning',()=>{
 const f=waitingFixture();protectedRegionalStep(f.w,180);const deadline=f.traveller.decisionProtection!.expiresAt;assert.equal(f.traveller.health,1);assert.equal(f.traveller.decisionProtection!.reason,'expired');protectedRegionalStep(f.w,1);assert.ok(f.traveller.health<1);assert.equal(f.traveller.decisionProtection!.expiresAt,deadline);
 const illness=waitingFixture();protectedRegionalStep(illness.w,1);addHealthCase(illness.w,illness.traveller,'illness',100,'镇外实际疾病');const health=illness.traveller.health;protectedRegionalStep(illness.w,1);assert.ok(illness.traveller.health<health);assert.equal(illness.traveller.canDecide,false);assert.notEqual(illness.traveller.decisionProtection!.endedAt,null);
 const g=fixture(),r=g.traveller;Object.assign(r,{hunger:98,energy:80,health:1,decisionDue:g.w.minute});stepWorld(g.w,1,{decisionChoices:(w,r)=>decisionChoices(decisionContext(w,r)).map(c=>c.action)});const original=r.decisionProtection!.expiresAt;carry(g);outside(g,'returnMail');protectedRegionalStep(g.w,1);assert.equal(r.residency,'visitor');assert.equal(r.regionalLocation,undefined);assert.equal(r.decisionProtection!.reason,'decision');const after=r.health;stepWorld(g.w,1,{decisionChoices:(w,r)=>decisionChoices(decisionContext(w,r)).map(c=>c.action)});assert.equal(r.decisionProtection!.expiresAt,original);assert.ok(r.health<after);
});

test('an outage with only a regional waiter pauses before the original deadline across invalid replies and restart',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const f=waitingFixture(),store=new WorldStore(':memory:');store.commit(f.w,null);let calls=0,finish!:(result:ModelResult)=>void;
 const model=async(_key:string,context:ReturnType<typeof decisionContext>):Promise<ModelResult>=>{if(context.actor.id!==f.traveller.id)return new Promise(()=>{});if(calls++===0)throw new DecisionError('invalid_decision',{inputTokens:1,outputTokens:1,latencyMs:1},'invalid');return new Promise(resolve=>{finish=resolve;});};
 let runtime=new ValleyRuntime(store,'test-key',model);
 try{
  runtime.start();await flush();for(let i=0;i<70;i++){runtime.tick(now+=1000);await flush();}const actor=()=>runtime.world.residents.find(r=>r.id===f.traveller.id)!;const deadline=actor().decisionProtection!.expiresAt;assert.ok(calls>=2);assert.equal(actor().health,1);delete actor().decisionProtection!.regionalDecisionsAtStart;runtime.stop();runtime=new ValleyRuntime(store,'test-key',model);runtime.start();
  for(let i=0;i<90;i++)runtime.tick(now+=1000);assert.equal(runtime.world.clock.paused,true);assert.match(runtime.world.clock.reason!,/持续未提供/);assert.equal(actor().health,1);assert.equal(actor().decisionProtection!.expiresAt,deadline);const at=runtime.world.minute;runtime.tick(now+=1000);assert.equal(runtime.world.minute,at);
  const j=runtime.world.outsideAid!.visitorJourneys![0];finish({decision:{intention:'本人决定吃真实随身口粮',actions:[{type:'outsideAid',operation:'eatMail',journeyId:j.id,item:'meal'}]},inputTokens:1,outputTokens:1,latencyMs:1});await flush();assert.equal(runtime.world.metrics.regionalDecisions,1);for(let i=0;i<6;i++)runtime.tick(now+=1000);assert.equal(runtime.world.clock.paused,false);assert.ok(actor().hunger<95);assert.equal(actor().decisionProtection!.expiresAt,deadline);assert.equal(actor().decisionProtection!.reason,'decision');assert.ok(actor().decisionProtection!.recoveredAt);assert.equal(runtime.world.events.filter(e=>e.decisionProtection?.phase==='started'&&e.actors[0]===actor().id).length,1);
 }finally{runtime.stop();store.close();}
});

test('another real resident decision keeps the clock moving without extending the regional personal deadline',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const f=waitingFixture();f.child.decisionDue=f.w.minute;const store=new WorldStore(':memory:');store.commit(f.w,null);
 const runtime=new ValleyRuntime(store,'test-key',async(_key,context)=>context.actor.id===f.child.id?{decision:{intention:'本人短暂停留',actions:[{type:'wait',minutes:20}]},inputTokens:1,outputTokens:1,latencyMs:1}:new Promise<ModelResult>(()=>{}));
 try{runtime.start();await flush();runtime.tick(now+=1000);await flush();const deadline=runtime.world.residents.find(r=>r.id===f.traveller.id)!.decisionProtection!.expiresAt;
  for(let i=0;i<159;i++){runtime.tick(now+=1000);await flush();}const r=runtime.world.residents.find(r=>r.id===f.traveller.id)!;assert.ok((runtime.world.metrics.localDecisions??0)>1);assert.equal(runtime.world.clock.paused,false);assert.equal(r.decisionProtection!.expiresAt,deadline);assert.equal(r.decisionProtection!.reason,'expired');assert.ok(r.health<1&&r.health>0);
 }finally{runtime.stop();store.close();}
});

test('regional protection ends when its actual food expires, without giving a replacement or new deadline',()=>{
 const f=waitingFixture();protectedRegionalStep(f.w,1);const deadline=f.traveller.decisionProtection!.expiresAt;for(const lots of Object.values(f.w.food!.lots['person:'+f.traveller.id]))for(const lot of lots??[])lot.expiresAt=f.w.minute+1;protectedRegionalStep(f.w,1);
 assert.equal(f.traveller.decisionProtection!.reason,'unavailable');assert.equal(f.traveller.decisionProtection!.expiresAt,deadline);assert.ok(f.traveller.health<1);assert.equal(f.traveller.inventory.meal??0,0);assert.equal(f.traveller.inventory.berry??0,0);assert.equal(f.j.progress,0);
});

test('zero health cannot finish a regional meal or create a posthumous memory',()=>{
 const f=waitingFixture(),r=f.traveller;assert.equal(applyOutsideDecision(f.w,r.id,r.revision,{intention:'本人停步吃饭',actions:[{type:'outsideAid',operation:'eatMail',journeyId:f.j.id,item:'meal'}]}).ok,true);stepWorld(f.w,4);const inventory={...r.inventory},memory=JSON.stringify(r.memories),hunger=r.hunger;r.health=0;stepWorld(f.w,1);assert.equal(r.status,'dead');assert.equal(f.j.status,'interrupted');assert.equal(f.j.pause,undefined);assert.deepEqual(f.w.estates.find(e=>e.personId===r.id)!.inventory,inventory);assert.equal(r.hunger,hunger);assert.equal(JSON.stringify(r.memories),memory);
});
