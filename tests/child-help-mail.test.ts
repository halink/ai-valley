import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {EmergencyCareAction} from '../src/shared/emergency-care.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext,prompt} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {childHelpOpportunities,completeChildHelp} from '../src/world/child-help.js';
import {childHelpOutsideChoices} from '../src/world/child-help-mail.js';
import {initializeForeignTrade,advanceForeignTrade,foreignDecisionContext,applyForeignDecision} from '../src/world/foreign-trade.js';
import {initializeMigration,advanceMigration,applyOutsideDecision,outsideDecisionContext,outsideCandidate} from '../src/world/migration.js';
import {initializeFood,foodContainers} from '../src/world/food.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeRooms} from '../src/world/rooms.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);
 const [reporter,child,trader]=w.residents;
 for(const r of w.residents)Object.assign(r,{at:{x:20,y:10},inside:null,roomAt:null,homeId:null,inventory:{},parents:[],adoptiveParents:[],guardianIds:[],relations:[],bornAt:w.minute-30*YEAR,hunger:25,energy:100,health:100,canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,knownBuildings:[],knownResources:[],knownPeople:[],memories:[],coins:0});
 child.bornAt=w.minute-2*YEAR;child.canDecide=child.canExpress=false;child.hunger=70;
 trader.at={...w.map.entrance};trader.inventory.wood=10;
 initializeForeignTrade(w);initializeMigration(w);w.foreignTrade!.knownStationIds.push(reporter.id,trader.id,child.id);
 initializeRooms(w);initializeEconomy(w);initializeFood(w);stepWorld(w,.001);
 const contact=w.migration!.contacts.find(c=>c.origin===w.foreignTrade!.merchants[0].origin)!,recipient=contact.person!;
 // A help receipt must create an opportunity even without the unrelated ordinary road notice.
 contact.phase='home';contact.futureAt=w.minute+10000;
 return {w,reporter,child,trader,contact,recipient,merchant:w.foreignTrade!.merchants[0]};
}
const isCare=(op:EmergencyCareAction['operation'])=>(a:Action)=>a.type==='emergencyCare'&&a.operation===op;
function select(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={},outside=false){
 const choices=decisionChoices(outside?outsideDecisionContext(w,r):decisionContext(w,r)),row=choices.find(c=>predicate(c.action));
 assert.ok(row,`missing final choice for ${r.id}`);return parseChoice(JSON.stringify({choice:row.id,...fields}),choices);
}
function run(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 const d=select(w,r,predicate,fields),plan={id:`child-help-mail:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d};
 assert.ok(submitPlan(w,plan).ok);let cap=300;while(r.plan||r.activity){assert.ok(cap-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);return plan;
}
function post(f:ReturnType<typeof fixture>,send=true){
 run(f.w,f.reporter,isCare('requestHelp'));run(f.w,f.reporter,isCare('postHelp'));if(send)run(f.w,f.reporter,isCare('sendHelp'));return f.w.emergencyCare!.helpNotices![0];
}
function courier(f:ReturnType<typeof fixture>,merchantId=f.merchant.id){
 const {w,trader}=f;
 run(w,trader,a=>a.type==='foreignTrade'&&a.operation==='propose'&&a.merchantId===merchantId&&a.side==='export'&&a.item==='wood',{quantity:1,price:1});
 const offer=w.foreignTrade!.offers.at(-1)!;w.minute=offer.noticeAt;advanceForeignTrade(w);
 const m=w.foreignTrade!.merchants.find(m=>m.id===merchantId)!,choices=decisionChoices(foreignDecisionContext(w,m.person)),row=choices.find(c=>c.action.type==='foreignTrade'&&c.action.operation==='accept'&&c.action.offerId===offer.id);assert.ok(row);
 assert.ok(applyForeignDecision(w,m.id,m.person.revision,parseChoice(JSON.stringify({choice:row.id}),choices)).ok);
 const s=w.foreignTrade!.shipments.at(-1)!;w.minute=s.readyAt;
 run(w,trader,a=>a.type==='foreignTrade'&&a.operation==='dispatch'&&a.shipmentId===s.id);return s;
}
function deliver(f:ReturnType<typeof fixture>){const n=post(f),s=courier(f);assert.equal(n.outbound!.attempts[0]?.status,'carried');f.w.minute=s.arrivesAt!;advanceForeignTrade(f.w);assert.equal(n.outbound!.attempts[0].status,'delivered');return {n,s};}
function reply(w:World,r:Resident,op:'travelHelp'|'declineHelp'){const d=select(w,r,isCare(op),{},true);assert.ok(applyOutsideDecision(w,r.id,r.revision,d).ok);return d;}
function arrive(w:World,r:Resident){let cap=100;while(r.residency==='outside'){
 assert.ok(cap-->0);const c=w.migration!.contacts.find(c=>c.id===r.id)!,j=c.journey?.staged;assert.ok(j);
 if(j.status==='waiting'){if(c.journey!.blocked)return;const d=select(w,r,a=>a.type==='visitorJourney'&&a.operation==='continue',{},true);assert.ok(applyOutsideDecision(w,r.id,r.revision,d).ok);}
 w.minute+=Math.max(1,j.stageRemaining);advanceMigration(w);
}}
const wealth=(w:World)=>totalCoins(w)+(w.migration?.contacts??[]).reduce((sum,c)=>sum+(c.person?.coins??0),0);
const food=(w:World)=>[...foodContainers(w).values()].reduce((n,bag)=>n+(bag.meal??0),0);

test('numbered normal menus carry entrusted child mail on real freight, then independently travel, visit, review and feed',()=>{
 const f=fixture(),{w,reporter,child,recipient}=f,identities=w.residents.length+w.migration!.contacts.filter(c=>c.person).length,{n,s}=deliver(f),deadline=n.expiresAt;
 assert.equal(n.outbound!.attempts[0].shipmentId,s.id);assert.ok(n.outbound!.attempts[0].arrivedAt!>n.outbound!.attempts[0].pickedAt);assert.ok(outsideCandidate(w).includes(recipient));
 assert.equal(recipient.knownPeople.includes(child.id),false);assert.equal(recipient.deathKnowledge?.[child.id],undefined);assert.equal(w.emergencyCare!.agreements.length,0);
 const stock=food(w),coins=wealth(w),rights=JSON.stringify([child.guardianIds,child.homeId,w.buildings,w.plots]),start=w.minute;
 reply(w,recipient,'travelHelp');assert.equal(recipient.residency,'outside');assert.ok(f.contact.journey!.staged!.stageRemaining<f.contact.journey!.staged!.duration);
 const j=f.contact.journey!.staged!;w.minute+=j.stageRemaining;advanceMigration(w);assert.equal(j.status,'waiting');assert.equal(recipient.residency,'outside');assert.equal(w.emergencyCare!.agreements.length,0);
 arrive(w,recipient);assert.ok(w.minute>start);assert.equal(recipient.residency,'visitor');assert.equal(w.residents.filter(r=>r.id===recipient.id).length,1);
 assert.equal(w.residents.length+w.migration!.contacts.filter(c=>c.person).length,identities);assert.equal(food(w),stock);
 run(w,reporter,isCare('visitHelp'));run(w,recipient,isCare('visitHelp'));assert.equal(w.emergencyCare!.agreements.length,0);run(w,recipient,isCare('offer'));run(w,reporter,isCare('review'));run(w,recipient,isCare('feed'));
 assert.equal(w.emergencyCare!.agreements[0].meals,1);assert.equal(food(w),stock-1);assert.equal(wealth(w),coins);assert.equal(n.expiresAt,deadline);assert.equal(JSON.stringify([child.guardianIds,child.homeId,w.buildings,w.plots]),rights);
});

test('posting alone, no freight and a freight crossing before entrustment do not deliver or invent help',()=>{
 const f=fixture(),n=post(f,false),count=f.w.migration!.contacts.length,s=courier(f);assert.equal(n.outbound,undefined);
 run(f.w,f.reporter,isCare('sendHelp'));f.w.minute=s.arrivesAt!;advanceForeignTrade(f.w);assert.deepEqual(n.outbound!.attempts,[]);assert.deepEqual(childHelpOutsideChoices(f.w,f.recipient),[]);
 f.w.minute+=60;advanceMigration(f.w);assert.equal(f.w.migration!.contacts.length,count);assert.equal(f.w.emergencyCare!.agreements.length,0);assert.equal(f.recipient.residency,'outside');
});

test('an actual recipient may decline once without telling a remote reporter or starting a journey',()=>{
 const f=fixture(),{n}=deliver(f),{w,recipient,reporter}=f;reporter.at={x:20,y:10};const before=JSON.stringify(decisionContext(w,reporter)),d=reply(w,recipient,'declineHelp');
 assert.equal(f.contact.journey,null);assert.equal(recipient.residency,'outside');assert.equal(n.readers.find(k=>k.personId===recipient.id)!.reply!.choice,'decline');
 assert.equal(JSON.stringify(decisionContext(w,reporter)),before);const state=JSON.stringify(w);assert.equal(applyOutsideDecision(w,recipient.id,recipient.revision,d).ok,false);assert.equal(JSON.stringify(w),state);assert.deepEqual(childHelpOutsideChoices(w,recipient),[]);
});

test('delivered historical knowledge does not track child relocation, death, guardians, refusal or remote withdrawal',()=>{
 const f=fixture(),{n}=deliver(f),{w,child,recipient}=f,baseline=outsideDecisionContext(w,recipient),original=structuredClone(n.location);
 child.at={x:36,y:1};child.status='dead';child.guardianIds=[f.trader.id];child.refusesCare=true;
 run(w,f.reporter,isCare('withdrawHelp'));
 // Keep the clock and body fields aligned while changing only distant facts.
 const control=structuredClone(w),controlNotice=control.emergencyCare!.helpNotices![0];controlNotice.withdrawnAt=null;controlNotice.withdrawnBy=null;
 const other=control.residents.find(r=>r.id===child.id)!;other.at={...original.at};other.status='alive';other.guardianIds=[];other.refusesCare=false;
 assert.deepEqual(outsideDecisionContext(w,recipient),outsideDecisionContext(control,control.migration!.contacts.find(c=>c.id===recipient.id)!.person!));assert.deepEqual(prompt(outsideDecisionContext(w,recipient)),prompt(outsideDecisionContext(control,control.migration!.contacts.find(c=>c.id===recipient.id)!.person!)));
 assert.equal(n.readers.find(k=>k.personId===recipient.id)!.withdrawnAt,null);assert.equal(baseline.people.length,0);
 reply(w,recipient,'travelHelp');arrive(w,recipient);run(w,recipient,isCare('visitHelp'));assert.deepEqual(n.location,original);assert.ok(recipient.at.x<=21);assert.match(recipient.memories.at(-1)!.text,/没有找到可合法接触/);assert.equal(w.emergencyCare!.agreements.length,0);
});

test('an expired delivered letter cannot start a visit and expiry during journey never refreshes the old address',()=>{
 const f=fixture(),{n}=deliver(f),{w,recipient}=f,d=select(w,recipient,isCare('travelHelp'),{},true),deadline=n.expiresAt;
 w.minute=deadline;assert.equal(applyOutsideDecision(w,recipient.id,recipient.revision,d).ok,false);assert.deepEqual(childHelpOutsideChoices(w,recipient),[]);assert.equal(f.contact.journey,null);
 const g=fixture(),notice=deliver(g).n;g.w.minute=notice.expiresAt-1;reply(g.w,g.recipient,'travelHelp');arrive(g.w,g.recipient);assert.equal(g.recipient.residency,'visitor');assert.ok(!childHelpOpportunities(g.w,g.recipient).some(c=>isCare('visitHelp')(c.action)));assert.equal(notice.readers.find(k=>k.personId===g.recipient.id)!.visitAt,null);assert.equal(g.w.emergencyCare!.agreements.length,0);
});

test('a blocked valley gate leaves the same chosen traveller outside until another independent decision',()=>{
 const f=fixture(),{n}=deliver(f),{w,recipient}=f;reply(w,recipient,'travelHelp');w.map.tiles[w.map.entrance.y*w.map.width+w.map.entrance.x]='water';arrive(w,recipient);
 assert.equal(recipient.residency,'outside');assert.equal(f.contact.journey!.staged!.progress,0);assert.equal(f.contact.journey!.blocked,true);assert.equal(n.readers.find(k=>k.personId===recipient.id)!.visitAt,null);
 w.map.tiles[w.map.entrance.y*w.map.width+w.map.entrance.x]='grass';w.minute+=30;advanceMigration(w);assert.equal(recipient.residency,'outside');
 const d=select(w,recipient,a=>a.type==='visitorJourney'&&a.operation==='continue',{},true);assert.ok(applyOutsideDecision(w,recipient.id,recipient.revision,d).ok);w.minute+=30;advanceMigration(w);assert.equal(recipient.residency,'visitor');
});

test('in-memory SQLite reload preserves actual delivery, fixed expiry, one reply and retained historical evidence',()=>{
 const f=fixture(),{n}=deliver(f),{w,recipient}=f,deadline=n.expiresAt;reply(w,recipient,'travelHelp');
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();const saved=restored.emergencyCare!.helpNotices![0],r=restored.migration!.contacts.find(c=>c.id===recipient.id)!.person!;
 assert.deepEqual(saved,n);arrive(restored,r);run(restored,r,isCare('visitHelp'));const state=JSON.stringify(restored);assert.ok(completeChildHelp(restored,r,{type:'emergencyCare',operation:'visitHelp',noticeId:saved.id}));assert.equal(JSON.stringify(restored),state);
 assert.equal(saved.expiresAt,deadline);assert.equal(saved.outbound!.attempts.length,1);assert.equal(saved.readers.filter(k=>k.personId===r.id).length,1);
 for(const p of restored.residents)p.memories=[];for(let i=0;i<250;i++)emitLedgerEvent(restored,{kind:'system',actors:[],place:{x:0,y:0},text:'unrelated test fact'});
 const retained=workingEvents(restored);for(const id of saved.eventIds)assert.ok(retained.some(e=>e.id===id));
});

test('delivery requires a real capable existing person at the matching origin, not someone travelling or a replacement',()=>{
 for(const reason of ['away','dead','incapable','unknown-age','other-origin'] as const){
  const f=fixture(),n=post(f),s=courier(f),{w,recipient,contact}=f,count=w.migration!.contacts.length;
  if(reason==='away'){
   contact.phase='offered';assert.ok(applyOutsideDecision(w,recipient.id,recipient.revision,{intention:'本人原先已决定出行',actions:[{type:'travelToValley'}]}).ok);
  }else if(reason==='dead'){recipient.status='dead';recipient.canDecide=false;}
  else if(reason==='incapable')recipient.canExpress=false;
  else if(reason==='unknown-age')recipient.bornAt=Number.NaN;
  else contact.origin='没有连通路线的其他居地';
  w.minute=s.arrivesAt!;advanceForeignTrade(w);
  assert.equal(n.outbound!.attempts[0].status,'unreceived',reason);assert.equal(n.outbound!.attempts[0].recipientId,null);assert.equal(n.readers.length,1);assert.equal(w.migration!.contacts.length,count);assert.equal(w.emergencyCare!.agreements.length,0);
  advanceForeignTrade(w);assert.equal(n.outbound!.attempts.length,1);assert.equal(n.readers.length,1);
 }
});

test('mail arriving after its fixed deadline records actual late receipt but offers no child-help departure',()=>{
 const f=fixture(),n=post(f),s=courier(f),deadline=n.expiresAt;assert.ok(s.arrivesAt!<deadline);
 f.w.minute=deadline+1;advanceForeignTrade(f.w);
 assert.equal(n.outbound!.attempts[0].status,'delivered');assert.equal(n.outbound!.attempts[0].arrivedAt,f.w.minute);assert.equal(n.expiresAt,deadline);assert.deepEqual(childHelpOutsideChoices(f.w,f.recipient),[]);assert.equal(outsideCandidate(f.w).includes(f.recipient),false);assert.match(f.recipient.memories.at(-1)!.text,/已经到期/);
});

test('withdrawal before pickup stops entrustment, while a carried historical copy cannot hear a later withdrawal',()=>{
 for(const afterPickup of [false,true]){
  const f=fixture(),n=post(f);let s;
  if(afterPickup)s=courier(f);
  run(f.w,f.reporter,isCare('withdrawHelp'));
  if(!afterPickup)s=courier(f);
  f.w.minute=s!.arrivesAt!;advanceForeignTrade(f.w);
  assert.equal(n.outbound!.attempts.length,afterPickup?1:0);
  if(afterPickup){assert.equal(n.outbound!.attempts[0].status,'delivered');assert.equal(n.readers.find(k=>k.personId===f.recipient.id)!.withdrawnAt,null);assert.equal(childHelpOutsideChoices(f.w,f.recipient).length,2);}
  else assert.equal(n.readers.length,1);
 }
});

test('in-transit SQLite reload and repeated transport advancement cannot deliver twice or renew the paper',()=>{
 const f=fixture(),n=post(f),s=courier(f),deadline=n.expiresAt;assert.equal(n.outbound!.attempts[0].status,'carried');
 const store=new WorldStore(':memory:');store.commit(f.w,null);const w=store.load()!;store.close();w.minute=s.arrivesAt!;advanceForeignTrade(w);
 const saved=w.emergencyCare!.helpNotices![0],recipient=w.migration!.contacts.find(c=>c.id===f.recipient.id)!.person!,before=recipient.memories.length,eventCount=saved.eventIds.length;
 advanceForeignTrade(w);assert.equal(saved.outbound!.attempts.length,1);assert.equal(saved.readers.filter(k=>k.personId===recipient.id).length,1);assert.equal(saved.expiresAt,deadline);assert.equal(recipient.memories.length,before);assert.equal(saved.eventIds.length,eventCount);
});

test('a thirteen-year-old reporter can separately choose sendHelp and physically walk to the original gate',()=>{
 const f=fixture(),{w,reporter}=f;reporter.bornAt=w.minute-13*YEAR;const n=post(f,false);reporter.at={x:20,y:10};const started=w.minute;
 const chosen=select(w,reporter,isCare('sendHelp'));assert.equal(chosen.actions[0].type,'emergencyCare');run(w,reporter,isCare('sendHelp'));
 assert.deepEqual(reporter.at,n.boardAt);assert.ok(w.minute-started>=25);assert.equal(n.outbound!.requestedAt,w.minute);assert.deepEqual(n.outbound!.attempts,[]);assert.equal(w.emergencyCare!.agreements.length,0);
});

test('sendHelp completion rejects remote callers, another role, expiry and a newly withdrawn board without mutation',()=>{
 for(const cause of ['remote','other-person','expiry','board-withdrawn'] as const){
  const f=fixture(),{w,reporter,trader}=f,n=post(f,false),a=select(w,reporter,isCare('sendHelp')).actions[0] as EmergencyCareAction;
  let actor=reporter;
  if(cause==='remote')reporter.at={x:20,y:10};
  else if(cause==='other-person')actor=trader;
  else if(cause==='expiry')w.minute=n.expiresAt;
  // Synthetic concurrent completion: the board has changed but this reporter
  // has not personally read the correction. Validation must check it on arrival.
  else {n.withdrawnAt=w.minute;n.withdrawnBy=f.child.id;}
  const before=JSON.stringify(w);assert.ok(completeChildHelp(w,actor,a),cause);assert.equal(JSON.stringify(w),before);assert.equal(n.outbound,undefined);
 }
});

test('sendHelp survives a saturated ordinary final menu and its numbered choice still executes physically',()=>{
 const f=fixture(),{w,reporter}=f,n=post(f,false);reporter.at={x:20,y:10};reporter.agency={focus:'trade',goals:[],routines:[],nextSerial:1};
 const context=decisionContext(w,reporter);
 // Synthetic crowding follows the opportunity-coverage suite: these unrelated
 // candidates exercise menu clipping only and are never executed.
 context.formal!.opportunities=[
  ...Array.from({length:100},(_,i)=>({id:'mail-crowded-class-'+i,label:'已承诺课堂',action:{type:'education' as const,operation:'teach' as const,lessonId:'mail-class-'+i,minutes:30}})),
  ...Array.from({length:80},(_,i)=>({id:'mail-crowded-reply-'+i,label:'同意或拒绝',action:{type:'respond' as const,proposalId:'mail-proposal-'+Math.floor(i/2),accept:i%2===0}})),
  ...context.formal!.opportunities,
 ];
 const choices=decisionChoices(context),row=choices.find(c=>isCare('sendHelp')(c.action));assert.ok(row);assert.ok(choices.length<=78);assert.ok(context.formal!.opportunities.length>180);
 const decision=parseChoice(JSON.stringify({choice:row.id}),choices);
 assert.ok(submitPlan(w,{id:`mail-crowded:${w.revision}`,actorId:reporter.id,actorRevision:reporter.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision}).ok);
 let cap=200;while(reporter.activity||reporter.plan){assert.ok(cap-->0);stepWorld(w,1);}assert.equal(reporter.lastFailure,null);assert.deepEqual(reporter.at,n.boardAt);assert.equal(n.outbound!.requestedAt,w.minute);
});
