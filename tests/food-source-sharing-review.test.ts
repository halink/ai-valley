import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {ShareFoodSourceAction} from '../src/shared/food-source-sharing.js';
import {observeFoodSources,foodSourceShareOpportunities,foodSourceShareReason,completeFoodSourceShare} from '../src/world/food-source-sharing.js';
import {foodSourceClueOpportunities,restoreFoodSourceSharingChoices} from '../src/server/food-source-clues.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import type {ActionChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {emitEvent} from '../src/world/events.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(5401);w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={width:80,height:80,tiles:Array(6400).fill('grass'),entrance:{x:0,y:0},name:'Independent offline review'};
 w.buildings=[];w.plots=[];w.graves=[];w.events=[];w.resources=[{id:'review-bush',kind:'bush',at:{x:10,y:10},amount:9,max:9,regrowthDays:0,lastHarvest:0}];w.residents=w.residents.slice(0,3);
 for(const [i,r] of w.residents.entries())Object.assign(r,{at:{x:40+i,y:40},inside:null,roomAt:null,homeId:null,knownResources:[],knownBuildings:[],knownPeople:w.residents.filter(p=>p!==r).map(p=>p.id),inventory:{meal:10,water:10},memories:[],relations:[],plan:null,activity:null,lastFailure:null,bornAt:600-25*YEAR,canDecide:true,canExpress:true,hunger:20,energy:100,health:100});
 const [a,b,c]=w.residents;a.at={x:9,y:10};observeFoodSources(w,a);a.at={x:40,y:40};c.at={x:60,y:60};
 for(const r of w.residents)decisionContext(w,r);
 const action=foodSourceShareOpportunities(w,a)[0]?.action;assert.equal(action?.type,'shareFoodSource');
 return {w,a,b,c,action:action as ShareFoodSourceAction};
}
let serial=0;
function queue(w:World,r:Resident,action:Action){return submitPlan(w,{id:'review-food-share-'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Independent explicit choice',actions:[action]});}
function finish(w:World,r:Resident){let n=60;while(r.plan||r.activity){assert.ok(n--);stepWorld(w,.25);}assert.equal(r.lastFailure,null);}

test('independent food review: arbitrary fields and altered historical proof cannot be submitted',()=>{
 for(const mutate of [
  (a:any)=>a.extra='ignored?',(a:any)=>a.source.amount=100,(a:any)=>a.source.at.z=1,
  (a:any)=>a.source.observedAt++,(a:any)=>a.source.at.x++,(a:any)=>a.source=null,
  (a:any)=>a.source.at=null,(a:any)=>a.source.observedAt=NaN,(a:any)=>a.targetId=a.source.resourceId,
 ]){const {w,a,action}=fixture(),bad=structuredClone(action);mutate(bad);const before=structuredClone(w);assert.equal(queue(w,a,bad).ok,false);assert.deepEqual(w,before);}
});

test('independent food review: every sharing query is identical when remote patch changes or vanishes',()=>{
 const {w,a,b,action}=fixture(),expected=foodSourceShareOpportunities(w,a);
 for(const state of ['empty','moved','deleted']){
  if(state==='empty')w.resources[0].amount=0;
  if(state==='moved')w.resources[0].at={x:70,y:70};
  if(state==='deleted')w.resources=[];
  const before=structuredClone(w);assert.deepEqual(foodSourceShareOpportunities(w,a),expected);assert.equal(foodSourceShareReason(w,a,action),null);assert.deepEqual(w,before);
 }
 assert.equal(queue(w,a,action).ok,true);finish(w,a);const visits=foodSourceClueOpportunities(w,b);assert.equal(visits.length,1);assert.match(visits[0].label,/600/);assert.match(visits[0].label,/不是本人亲见/);assert.equal(b.knownResources.length,0);
});

test('independent food review: stationary sleeping listeners do not receive or enter sharing candidates',()=>{
 const {w,a,b,action}=fixture();b.activity={action:{type:'sleep',minutes:60},planId:'review-sleep',startedAt:w.minute,remaining:60,path:[],target:{...b.at},definition:w.activeDefinitions['action/routine']};
 const before=structuredClone(w);assert.equal(foodSourceShareOpportunities(w,a).length,0);assert.ok(foodSourceShareReason(w,a,action));assert.ok(completeFoodSourceShare(w,a,action));assert.deepEqual(w,before);
});

test('independent food review: completion helper and accelerated remaining time cannot replace a minute of actual speech',()=>{
 const {w,a,b,action}=fixture(),before=structuredClone(w);assert.ok(completeFoodSourceShare(w,a,action));assert.deepEqual(w,before);
 assert.equal(queue(w,a,action).ok,true);stepWorld(w,.25);assert.ok(a.activity);a.activity.remaining=0;stepWorld(w,.25);assert.ok(a.lastFailure);assert.equal(b.foodSourceKnowledge?.heard.length??0,0);assert.equal(a.foodSourceKnowledge!.shared.length,0);
});

test('independent food review: in-flight SQLite reload retains fractional work and delivers once only to named listener',()=>{
 const {w,a,b,c,action}=fixture();c.at={x:40,y:41};assert.equal(queue(w,a,action).ok,true);stepWorld(w,.25);assert.ok(a.activity?.foodSourceShareWork);assert.equal(b.foodSourceKnowledge?.heard.length??0,0);
 const store=new WorldStore(':memory:');try{
  store.commit(w,null);const loaded=store.loadForRuntime()!,aa=loaded.residents.find(r=>r.id===a.id)!,bb=loaded.residents.find(r=>r.id===b.id)!,cc=loaded.residents.find(r=>r.id===c.id)!;
  assert.deepEqual(aa.activity?.foodSourceShareWork,a.activity.foodSourceShareWork);finish(loaded,aa);
  assert.equal(bb.foodSourceKnowledge!.heard.length,1);assert.equal(cc.foodSourceKnowledge?.heard.length??0,0);const heard=bb.foodSourceKnowledge!.heard[0],event=loaded.events.find(e=>e.id===heard.eventId)!;
  assert.deepEqual([...event.witnesses].sort(),[aa.id,bb.id].sort());assert.equal(bb.memories.find(m=>m.eventId===event.id)?.source,'heard');assert.ok(!cc.memories.some(m=>m.eventId===event.id));assert.ok(!bb.foodSourceKnowledge!.seen[action.source.resourceId]);
  for(let i=0;i<190;i++)emitEvent(loaded,{kind:'action',actors:[aa.id,bb.id],place:aa.at,text:'Unrelated review memory'});
  loaded.minute+=60;store.commit(loaded,w.revision);const again=store.loadForRuntime()!,aaa=again.residents.find(r=>r.id===a.id)!,bbb=again.residents.find(r=>r.id===b.id)!;
  assert.ok(again.events.some(e=>e.id===event.id));assert.equal(queue(again,aaa,{...action,receiptId:`food-source:${aaa.id}:${aaa.revision}`}).ok,false);assert.equal(bbb.foodSourceKnowledge!.heard.length,1);assert.equal(foodSourceClueOpportunities(again,bbb).length,1);
 }finally{store.close();}
});

test('independent food review: listener keeps an already accepted wait, without auto-navigation or retelling',()=>{
 const {w,a,b,action}=fixture();assert.equal(queue(w,b,{type:'wait',minutes:15}).ok,true);const planId=b.plan!.id;assert.equal(queue(w,a,action).ok,true);finish(w,a);
 assert.equal(b.activity?.planId??b.plan?.id,planId);assert.deepEqual(b.at,{x:41,y:40});assert.equal(foodSourceShareOpportunities(w,b).length,0);assert.equal(foodSourceClueOpportunities(w,b).length,1);
});

test('independent food review: adding bounded rows preserves all 78 existing actions and stop decisions',()=>{
 const {action}=fixture();const rows:ActionChoice[]=Array.from({length:78},(_,i)=>({id:'existing.'+i,label:'Existing '+i,action:{type:'wait',minutes:15}}));
 rows[0]={id:'care.stop.review',label:'Stop care',action:{type:'health',operation:'cancelRescue',transportId:'review'}};
 const extras:ActionChoice[]=[{id:'foodSource.share.review',label:'Share',action},{id:'foodSource.heard.review',label:'Inspect',action:{type:'move',to:{x:10,y:10}}}];
 const before=structuredClone(rows),menu=restoreFoodSourceSharingChoices([...rows,...extras],rows);assert.equal(menu.length,80);assert.deepEqual(menu.slice(0,78),before);assert.deepEqual(rows,before);assert.deepEqual(restoreFoodSourceSharingChoices([...rows,...extras],menu),menu);
});

test('independent food review: final restoration cannot reintroduce sharing into transport or restricted-capacity menus',()=>{
 const {w,a,b,action}=fixture();assert.equal(queue(w,a,action).ok,true);finish(w,a);
 for(const who of [a,b])for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','familyTravelling','passenger','aboard'] as const){
  const context=decisionContext(w,who);context.formal![flag]=true;const before=structuredClone(context),menu=decisionChoices(context);
  assert.equal(menu.some(c=>c.action.type==='shareFoodSource'||c.label.includes('当面告知的旧地址')),false,flag);assert.deepEqual(context,before);
 }
});
