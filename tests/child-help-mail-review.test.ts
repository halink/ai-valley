import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ForeignShipment} from '../src/shared/foreign-trade.js';
import type {EmergencyCareAction} from '../src/shared/emergency-care.js';
import {createWorld} from '../src/world/seed.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeMigration,applyOutsideDecision,outsideCandidate,outsideDecisionContext,advanceMigration} from '../src/world/migration.js';
import {completeChildHelp,childHelpOpportunities} from '../src/world/child-help.js';
import {carryChildHelpMail,childHelpOutsideChoices} from '../src/world/child-help-mail.js';
import {decisionChoices,prompt} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {childHelpProfile} from '../src/client/emergency-care.js';
import {DAY,YEAR} from '../src/world/time.js';

/** Isolated callback adversaries; full freight/menu integration lives in child-help-mail.test.ts. */
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,2);
 const [reporter,child]=w.residents;
 for(const r of w.residents)Object.assign(r,{at:{x:20,y:10},inside:null,roomAt:null,homeId:null,inventory:{},parents:[],adoptiveParents:[],guardianIds:[],relations:[],bornAt:w.minute-30*YEAR,hunger:25,energy:100,health:100,canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,knownBuildings:[],knownResources:[],knownPeople:[],memories:[]});
 child.bornAt=w.minute-2*YEAR;child.canDecide=child.canExpress=false;
 initializeForeignTrade(w);initializeMigration(w);w.foreignTrade!.knownStationIds.push(reporter.id);
 const c=w.migration!.contacts[0],p=c.person!;c.phase='home';c.futureAt=w.minute+14*DAY;
 assert.equal(completeChildHelp(w,reporter,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}),null);
 const n=w.emergencyCare!.helpNotices![0];reporter.at={...n.boardAt};w.minute++;
 assert.equal(completeChildHelp(w,reporter,{type:'emergencyCare',operation:'postHelp',noticeId:n.id}),null);w.minute++;
 assert.equal(completeChildHelp(w,reporter,{type:'emergencyCare',operation:'sendHelp',noticeId:n.id}),null);
 const s:ForeignShipment={id:'review-existing-shipment',offerId:'review-existing-contract',merchantId:w.foreignTrade!.merchants[0].id,residentId:reporter.id,side:'export',item:'wood',quantity:1,goods:1,price:1,status:'inTransit',createdAt:w.minute,readyAt:w.minute,departedAt:w.minute,arrivesAt:w.minute+60,blockedSince:null,nextCheckAt:w.minute,collectedAt:null,escrowAccount:'review-escrow',gross:1,maxTax:0,actualTax:null,taxPolicyId:null,taxRate:0,returned:false};
 w.foreignTrade!.shipments.push(s);
 return {w,reporter,child,c,p,n,s};
}
function deliver(f:ReturnType<typeof fixture>){carryChildHelpMail(f.w,f.s,'depart',f.w.minute);f.w.minute+=60;carryChildHelpMail(f.w,f.s,'arrive',f.w.minute);}
const reply=(operation:'travelHelp'|'declineHelp',noticeId:string):EmergencyCareAction=>({type:'emergencyCare',operation,noticeId});

test('review: no retroactive pickup, no unknown source, and no synthetic recipient initialization',()=>{
 const f=fixture(),{w,n,s,p}=f,before=structuredClone(p),count=w.residents.length;
 carryChildHelpMail(w,s,'depart',n.outbound!.requestedAt-1);carryChildHelpMail(w,s,'arrive',w.minute+60);
 assert.equal(n.outbound!.attempts.length,0);assert.deepEqual(p,before);assert.deepEqual(childHelpOutsideChoices(w,p),[]);
 const wrong={...s,id:'wrong-source',merchantId:w.foreignTrade!.merchants[1].id};carryChildHelpMail(w,wrong,'depart',w.minute);w.minute+=180;carryChildHelpMail(w,wrong,'arrive',w.minute);
 assert.equal(n.outbound!.attempts[0].status,'unreceived');assert.equal(n.readers.length,1);assert.deepEqual(p,before);assert.equal(w.residents.length,count);
 const g=fixture();delete g.w.migration;deliver(g);assert.equal(g.w.migration,undefined);assert.equal(g.n.readers.length,1);assert.equal(g.n.outbound!.attempts[0].status,'unreceived');
});

test('review: actual home presence and known return route are required, not an identity alone',()=>{
 for(const reason of ['travelling','dead','incapable','unknownAge','elsewhere','unsupportedRoute'] as const){
  const f=fixture();
  if(reason==='travelling')f.c.phase='travelling';
  if(reason==='dead')f.p.status='dead';
  if(reason==='incapable')f.p.canExpress=false;
  if(reason==='unknownAge')f.p.bornAt=Number.NaN;
  if(reason==='elsewhere')f.p.regionalLocation={routeId:'another-road',origin:f.c.origin,progress:3,duration:24};
  if(reason==='unsupportedRoute'){f.c.origin='未核实驿路';f.w.foreignTrade!.merchants[0].origin=f.c.origin;}
  const before=structuredClone(f.p.inventory);deliver(f);
  assert.deepEqual(childHelpOutsideChoices(f.w,f.p),[],reason);
  assert.equal(applyOutsideDecision(f.w,f.p.id,f.p.revision,{intention:'不得虚构路线',actions:[reply('travelHelp',f.n.id)]}).ok,false,reason);
  assert.equal(f.c.journey,null);assert.deepEqual(f.p.inventory,before);assert.equal(f.w.residents.some(r=>r.id===f.p.id),false);
 }
});

test('review: duplicate pickup, delivery and returned-carrier replay cannot manufacture a second attempt',()=>{
 const f=fixture();carryChildHelpMail(f.w,f.s,'depart',f.w.minute);const first=JSON.stringify(f.n);
 carryChildHelpMail(f.w,f.s,'depart',f.w.minute);assert.equal(JSON.stringify(f.n),first);
 f.w.minute+=10;carryChildHelpMail(f.w,f.s,'return',f.w.minute);const returned=JSON.stringify(f.n);
 carryChildHelpMail(f.w,f.s,'depart',f.w.minute-10);carryChildHelpMail(f.w,f.s,'arrive',f.w.minute);
 assert.equal(JSON.stringify(f.n),returned,'only a different existing trip may pick up returned paper');
 const next={...f.s,id:'another-existing-trip'};carryChildHelpMail(f.w,next,'depart',f.w.minute);f.w.minute+=60;carryChildHelpMail(f.w,next,'arrive',f.w.minute);
 assert.equal(f.n.outbound!.attempts.length,2);assert.equal(f.n.outbound!.attempts[1].status,'delivered');
 const delivered=JSON.stringify(f.w);carryChildHelpMail(f.w,next,'arrive',f.w.minute);carryChildHelpMail(f.w,next,'return',f.w.minute);assert.equal(JSON.stringify(f.w),delivered);
});

test('review: withdrawal and child changes after pickup do not telegraph to the recipient',()=>{
 const f=fixture();carryChildHelpMail(f.w,f.s,'depart',f.w.minute);f.w.minute++;
 assert.equal(completeChildHelp(f.w,f.reporter,{type:'emergencyCare',operation:'withdrawHelp',noticeId:f.n.id}),null);
 f.child.at={x:39,y:19};f.child.status='dead';f.child.guardianIds=['new-guardian'];f.w.minute+=60;carryChildHelpMail(f.w,f.s,'arrive',f.w.minute);
 const before=outsideDecisionContext(f.w,f.p),choices=decisionChoices(before);
 assert.ok(choices.some(x=>x.action.type==='emergencyCare'&&x.action.operation==='travelHelp'));
 assert.equal(f.n.readers.find(k=>k.personId===f.p.id)!.withdrawnAt,null);
 const control=structuredClone(f.w),child=control.residents.find(r=>r.id===f.child.id)!;child.status='alive';child.at={...f.n.location.at};child.guardianIds=[];control.emergencyCare!.helpNotices![0].withdrawnAt=null;
 const comparison=outsideDecisionContext(control,control.migration!.contacts[0].person!);
 assert.deepEqual(before,comparison);assert.deepEqual(prompt(before),prompt(comparison));
 assert.ok(!f.p.knownPeople.includes(f.child.id));assert.equal(f.p.deathKnowledge?.[f.child.id],undefined);
});

test('review: refusing is private, exact and replay safe, even after short memory is lost',()=>{
 const f=fixture();deliver(f);f.p.memories=[];
 const choices=decisionChoices(outsideDecisionContext(f.w,f.p)),decline=choices.find(x=>x.action.type==='emergencyCare'&&x.action.operation==='declineHelp')!;assert.ok(decline);
 const local=structuredClone(childHelpOpportunities(f.w,f.reporter)),memories=structuredClone(f.reporter.memories),bag=structuredClone(f.p.inventory),revision=f.p.revision;
 assert.ok(applyOutsideDecision(f.w,f.p.id,revision,parseChoice(JSON.stringify({choice:decline.id}),choices)).ok);
 assert.equal(f.c.journey,null);assert.equal(f.c.phase,'home');assert.deepEqual(childHelpOpportunities(f.w,f.reporter),local);assert.deepEqual(f.reporter.memories,memories);assert.deepEqual(f.p.inventory,bag);
 assert.equal(outsideCandidate(f.w).some(p=>p.id===f.p.id),false);
 const before=JSON.stringify(f.w);assert.equal(applyOutsideDecision(f.w,f.p.id,f.p.revision,{intention:'重复拒绝',actions:[reply('declineHelp',f.n.id)]}).ok,false);assert.equal(JSON.stringify(f.w),before);
});

test('review: expired delivery is retained as history but cannot open an itinerary or refresh the observation',()=>{
 const f=fixture(),deadline=f.n.expiresAt;carryChildHelpMail(f.w,f.s,'depart',f.w.minute);f.w.minute=deadline;carryChildHelpMail(f.w,f.s,'arrive',f.w.minute);
 assert.equal(f.n.outbound!.attempts[0].status,'delivered');assert.equal(f.n.readers.length,2);assert.deepEqual(childHelpOutsideChoices(f.w,f.p),[]);
 assert.equal(applyOutsideDecision(f.w,f.p.id,f.p.revision,{intention:'过期不能启程',actions:[reply('travelHelp',f.n.id)]}).ok,false);assert.equal(f.n.expiresAt,deadline);assert.equal(f.c.journey,null);
});

test('review: original paper and person receipts survive SQLite and trimming without duplicate delivery',()=>{
 const f=fixture();deliver(f);f.p.memories=[];f.reporter.memories=[];
 for(let i=0;i<240;i++)emitLedgerEvent(f.w,{kind:'system',actors:[],place:{x:0,y:0},text:'unrelated review event'});
 for(const id of f.n.eventIds)assert.ok(workingEvents(f.w).some(e=>e.id===id));
 const store=new WorldStore(':memory:');store.commit(f.w,null);const w=store.load()!;store.close();
 const n=w.emergencyCare!.helpNotices![0],p=w.migration!.contacts[0].person!,before=JSON.stringify(w);
 assert.deepEqual(n,f.n);assert.ok(childHelpOutsideChoices(w,p).length);carryChildHelpMail(w,w.foreignTrade!.shipments[0],'arrive',w.minute);assert.equal(JSON.stringify(w),before);
 for(const extra of [{childId:f.child.id},{agreementId:'forged'},{step:0}])assert.equal(applyOutsideDecision(w,p.id,p.revision,{intention:'禁止混用权限',actions:[{...reply('travelHelp',n.id),...extra}]}).ok,false);
 assert.equal(JSON.stringify(w),before);
});

test('review: an invited traveller stops at a real blocked gate and never acquires entry or care authority',()=>{
 const f=fixture();deliver(f);const bag=structuredClone(f.p.inventory),rights=structuredClone([f.child.guardianIds,f.child.homeId]),population=f.w.residents.length;
 assert.ok(applyOutsideDecision(f.w,f.p.id,f.p.revision,{intention:'我自行入谷',actions:[reply('travelHelp',f.n.id)]}).ok);
 const j=f.c.journey!.staged!;f.w.map.tiles[f.w.map.entrance.y*f.w.map.width+f.w.map.entrance.x]='water';
 f.w.minute+=j.stageRemaining;advanceMigration(f.w);assert.equal(j.status,'waiting');assert.equal(f.p.residency,'outside');
 assert.ok(applyOutsideDecision(f.w,f.p.id,f.p.revision,{intention:'本人选择第二段',actions:[{type:'visitorJourney',operation:'continue',journeyId:j.id,minutes:12}]}).ok);
 f.w.minute+=12;advanceMigration(f.w);assert.equal(j.progress,0);assert.equal(j.status,'waiting');assert.equal(f.c.journey!.blocked,true);assert.equal(f.w.residents.length,population);assert.deepEqual(f.p.inventory,bag);assert.deepEqual([f.child.guardianIds,f.child.homeId],rights);assert.equal(f.w.emergencyCare!.agreements.length,0);assert.equal(f.n.readers.find(k=>k.personId===f.p.id)!.visitAt,null);
});

test('review: a different courier cannot retroactively collect paper before its actual return',()=>{
 const f=fixture(),departed=f.w.minute;carryChildHelpMail(f.w,f.s,'depart',departed);
 f.w.minute+=20;carryChildHelpMail(f.w,f.s,'return',f.w.minute);
 const before=JSON.stringify(f.n),other={...f.s,id:'late-callback-other-courier'};
 carryChildHelpMail(f.w,other,'depart',departed+10);carryChildHelpMail(f.w,other,'arrive',f.w.minute);
 assert.equal(JSON.stringify(f.n),before,'paper was still with the first carrier at the second historical crossing');
 carryChildHelpMail(f.w,{...other,id:'after-actual-return'},'depart',f.w.minute);
 assert.equal(f.n.outbound!.attempts.length,2);assert.equal(f.n.outbound!.attempts[1].pickedAt,f.w.minute);
});


test('review: read-only mail history escapes external labels and old notices do not acquire fabricated transport',()=>{
 const f=fixture();f.w.foreignTrade!.merchants[0].origin='<img src=x onerror=alert(1)>';carryChildHelpMail(f.w,f.s,'depart',f.w.minute);
 const before=JSON.stringify(f.w),html=childHelpProfile(f.w,f.reporter);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img'));assert.equal(JSON.stringify(f.w),before);
 delete f.n.outbound;const legacy=JSON.stringify(f.w);childHelpProfile(f.w,f.reporter);childHelpOutsideChoices(f.w,f.p);assert.equal(JSON.stringify(f.w),legacy);assert.equal(f.n.outbound,undefined);
});
