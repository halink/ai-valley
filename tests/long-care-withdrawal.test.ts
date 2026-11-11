import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeLongCare,completeLongCare,careWindows,longCareReason} from '../src/world/long-care.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {totalCoins,accountBalance} from '../src/world/economy.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Plan,Resident,World} from '../src/shared/types.js';
import type {LongCareAgreement} from '../src/shared/long-care.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {longCareSelfWithdrawal,longCareSelfWithdrawalOpportunities} from '../src/world/long-care-withdrawal.js';

function fixture(age=30){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 const [provider,beneficiary,other]=w.residents,home=w.buildings.find(b=>b.id===beneficiary.homeId)!;
 for(const r of w.residents){r.at={...home.door};r.inside=null;r.roomAt=null;r.homeId=home.id;r.coins=100;r.hunger=20;r.energy=r.health=100;r.bornAt=w.minute-30*YEAR;r.inventory={meal:20,water:20};r.knownPeople=w.residents.map(r=>r.id);r.knownBuildings=[home.id];r.canDecide=r.canExpress=true;r.refusesCare=false;r.status='alive';r.residency='resident';r.guardianIds=[];r.plan=null;r.activity=null;}
 beneficiary.bornAt=w.minute-age*YEAR;beneficiary.guardianIds=age<18?[other.id]:[];
 initializeLongCare(w);stepWorld(w,.001);
 assert.equal(completeLongCare(w,provider,{type:'longCare',operation:'offer',targetId:beneficiary.id,fee:3,days:2,startsIn:60,startMinute:480,windowMinutes:120,visitsPerDay:2,condition:'daily'}),null);
 const c=w.longCare!.agreements[0];
 assert.equal(completeLongCare(w,age<18?other:beneficiary,{type:'longCare',operation:'accept',agreementId:c.id}),null);
 if(c.status==='awaitingChild')assert.equal(completeLongCare(w,beneficiary,{type:'longCare',operation:'assent',agreementId:c.id}),null);
 w.minute=careWindows(c,c.startDay)[0].start+1;
 return {w,provider,beneficiary,other,home,c};
}
let serial=0;
function plan(w:World,r:Resident,actions:Action[]):Plan{return {id:`long-care-withdrawal:${serial++}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择停止这一份长期照护',actions};}
function queue(w:World,r:Resident,a:Action){const p=plan(w,r,[a]);assert.deepEqual(submitPlan(w,p),{ok:true});return p;}
function cancel(c:LongCareAgreement):Action{return {type:'longCare',operation:'cancel',agreementId:c.id};}
function chosen(w:World,r:Resident,c:LongCareAgreement){const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(x=>x.action.type==='longCare'&&x.action.operation==='cancel'&&x.action.agreementId===c.id);assert.ok(choice,'real menu must expose this beneficiary’s cancellation');return {menu,action:parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]};}

test('long-care withdrawal: an expressive beneficiary without full decision capacity gets only silence and own stops',()=>{
 const {w,beneficiary,c}=fixture();beneficiary.canDecide=false;
 const {menu,action}=chosen(w,beneficiary,c);
 assert.ok(menu.every(x=>x.action.type==='wait'||x.action.type==='longCare'&&x.action.operation==='cancel'&&x.action.agreementId===c.id||x.action.type==='promise'&&x.action.operation==='withdraw'&&x.action.promiseId==='longCare:'+c.id));
 queue(w,beneficiary,action);assert.equal(c.status,'cancelled');assert.equal(beneficiary.canDecide,false);assert.equal(beneficiary.canExpress,true);assert.equal(beneficiary.plan,null);assert.equal(beneficiary.activity,null);
});

test('long-care withdrawal: real-menu cancellation wins the final quarter minute in either resident order',()=>{
 for(const reverse of [false,true]){const {w,provider,beneficiary,c}=fixture();if(reverse)w.residents.reverse();
  queue(w,provider,{type:'longCare',operation:'visit',agreementId:c.id});stepWorld(w,19.75);assert.equal(c.visits.length,0);
  const stock={...provider.inventory},coins=totalCoins(w),hunger=beneficiary.hunger;
  queue(w,beneficiary,chosen(w,beneficiary,c).action);assert.equal(c.status,'cancelled','stop must commit before any next world tick');
  stepWorld(w,.25);assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.equal(c.refunded,12);assert.equal(accountBalance(w,c.account),0);assert.deepEqual(provider.inventory,stock);assert.ok(beneficiary.hunger>=hunger);assert.equal(totalCoins(w),coins);
 }
});

test('long-care withdrawal: same original contract and refund survive SQLite, replay, and regained capacity',()=>{
 const f=fixture();queue(f.w,f.provider,{type:'longCare',operation:'visit',agreementId:f.c.id});stepWorld(f.w,19.75);f.beneficiary.canDecide=false;
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.load()!,r=w.residents.find(r=>r.id===f.beneficiary.id)!,provider=w.residents.find(r=>r.id===f.provider.id)!,c=w.longCare!.agreements[0],stock={...provider.inventory};
  const prior=w.revision,p=queue(w,r,chosen(w,r,c).action);assert.equal(c.id,f.c.id);assert.equal(c.refunded,12);store.commit(w,prior);
  const loaded=store.load()!,loadedR=loaded.residents.find(x=>x.id===r.id)!,loadedC=loaded.longCare!.agreements[0];
  assert.deepEqual(submitPlan(loaded,p),{ok:true});loadedR.canDecide=true;stepWorld(loaded,.25);
  assert.equal(loadedC.status,'cancelled');assert.equal(loadedC.refunded,12);assert.equal(loadedC.paid,0);assert.deepEqual(loaded.residents.find(x=>x.id===provider.id)!.inventory,stock);assert.ok(longCareReason(loaded,loaded.residents.find(x=>x.id===provider.id)!,{type:'longCare',operation:'visit',agreementId:c.id}));
 }finally{store.close();}
});

test('long-care withdrawal: expression alone cannot sign, expand, transfer, arm, or stop anyone else’s agreement',()=>{
 const {w,provider,beneficiary,other,c}=fixture();beneficiary.canDecide=false;
 const before=JSON.stringify(w.longCare),money=totalCoins(w);
 for(const action of [{type:'move',to:{x:1,y:1}},{type:'longCare',operation:'accept',agreementId:c.id},{type:'longCare',operation:'arm',agreementId:c.id},{type:'longCare',operation:'visit',agreementId:c.id},{type:'longCare',operation:'handoff',agreementId:c.id,replacementId:c.id},{type:'longCare',operation:'cancel',agreementId:'not-the-original'},{type:'longCare',operation:'cancel',agreementId:c.id,targetId:other.id},{type:'longCare',operation:'cancel',agreementId:c.id,providerId:provider.id},{type:'promise',operation:'inspect',promiseId:'longCare:'+c.id}] as Action[])assert.equal(submitPlan(w,plan(w,beneficiary,[action])).ok,false,JSON.stringify(action));
 assert.equal(submitPlan(w,plan(w,beneficiary,[cancel(c),{type:'wait',minutes:1}])).ok,false);
 assert.equal(JSON.stringify(w.longCare),before);assert.equal(totalCoins(w),money);
 const guardians=[...beneficiary.guardianIds];beneficiary.guardianIds=[other.id];other.canDecide=false;
 assert.equal(longCareSelfWithdrawal(w,other,cancel(c)),null);assert.ok(longCareReason(w,other,{type:'longCare',operation:'cancel',agreementId:c.id}));
 assert.deepEqual(guardians,[]);assert.equal(c.status,'active');
});

test('long-care withdrawal: loss of expression, death or outside residency invalidates a previously offered self stop',()=>{
 for(const mutate of [(r:Resident)=>{r.canExpress=false;},r=>{r.status='dead';},r=>{r.residency='outside';}] as Array<(r:Resident)=>void>){
  const {w,beneficiary,c}=fixture(),action=chosen(w,beneficiary,c).action;mutate(beneficiary);
  assert.equal(submitPlan(w,plan(w,beneficiary,[action])).ok,false);assert.equal(c.status,'active');assert.equal(c.refunded,0);
 }
});

test('long-care withdrawal: child expression stops only that child’s care without guardian replacement',()=>{
 for(const age of [2,8]){const {w,beneficiary,c}=fixture(age),guardians=[...beneficiary.guardianIds],parents=[...beneficiary.parents];beneficiary.canDecide=false;beneficiary.canExpress=true;
  queue(w,beneficiary,chosen(w,beneficiary,c).action);assert.equal(c.status,'cancelled');assert.deepEqual(beneficiary.guardianIds,guardians);assert.deepEqual(beneficiary.parents,parents);assert.equal(beneficiary.canDecide,false);
 }
});

test('long-care withdrawal: pending visits revalidate current refusal and materials before actual debit',()=>{
 for(const change of ['refusal','materials','capacity'] as const){const {w,provider,beneficiary,c}=fixture();queue(w,provider,{type:'longCare',operation:'visit',agreementId:c.id});stepWorld(w,19.75);
  if(change==='refusal')beneficiary.refusesCare=true;else if(change==='materials')provider.inventory.water=0;else provider.canExpress=false;
  const stock={...provider.inventory},money=totalCoins(w);stepWorld(w,.25);assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.deepEqual(provider.inventory,stock);assert.equal(totalCoins(w),money);assert.ok(provider.lastFailure);
 }
});

test('long-care withdrawal: an unrelated personal plan survives an immediate self stop',()=>{
 const {w,provider,beneficiary,c}=fixture();queue(w,beneficiary,{type:'wait',minutes:60});stepWorld(w,.25);const ownPlan=beneficiary.plan!.id,ownActivity=beneficiary.activity!;
 queue(w,provider,{type:'longCare',operation:'visit',agreementId:c.id});stepWorld(w,19.75);
 queue(w,beneficiary,chosen(w,beneficiary,c).action);assert.equal(c.status,'cancelled');assert.equal(beneficiary.plan!.id,ownPlan);assert.equal(beneficiary.activity,ownActivity);assert.equal(beneficiary.activity!.action.type,'wait');
});

test('long-care withdrawal: remote original-promise menu does not disclose undiscovered internal termination',()=>{
 const {w,beneficiary,provider,c}=fixture();beneficiary.at={x:1,y:1};beneficiary.canDecide=false;
 const before=longCareSelfWithdrawalOpportunities(w,beneficiary);assert.equal(before.length,1);assert.equal(before[0].action.type,'promise');
 assert.equal(completeLongCare(w,provider,{type:'longCare',operation:'cancel',agreementId:c.id}),null);
 assert.deepEqual(longCareSelfWithdrawalOpportunities(w,beneficiary),before);
 const menu=decisionChoices(decisionContext(w,beneficiary)),choice=menu.find(x=>x.action.type==='promise'&&x.action.operation==='withdraw'&&x.action.promiseId==='longCare:'+c.id);assert.ok(choice);
 queue(w,beneficiary,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);assert.ok(c.endKnownBy?.includes(beneficiary.id));assert.equal(c.refunded,12);
 assert.equal(longCareSelfWithdrawalOpportunities(w,beneficiary).length,0);
});

test('long-care withdrawal: offline runtime actually requests the narrow expressive cancellation and never restores capacity',async()=>{
 const {w,beneficiary,c}=fixture();beneficiary.canDecide=false;beneficiary.decisionDue=w.minute;for(const r of w.residents)if(r.id!==beneficiary.id)r.decisionDue=w.minute+1000;
 const store=new WorldStore(':memory:');store.commit(w,null);const requests:string[]=[];
 const runtime=new ValleyRuntime(store,'synthetic-test-credential',async(_key,context)=>{
  requests.push(context.actor.id);const menu=decisionChoices(context),stop=menu.find(x=>x.action.type==='longCare'&&x.action.operation==='cancel'&&x.action.agreementId===c.id);if(context.actor.id===beneficiary.id)assert.ok(stop);
  return {decision:stop?parseChoice(JSON.stringify({choice:stop.id}),menu):{intention:'隔离测试等待',actions:[{type:'wait' as const,minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:1};
 });
 try{runtime.start();await new Promise<void>(resolve=>setImmediate(resolve));await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(requests.filter(id=>id===beneficiary.id).length,1);assert.equal(runtime.world.longCare!.agreements[0].status,'cancelled');assert.equal(runtime.world.residents.find(r=>r.id===beneficiary.id)!.canDecide,false);}finally{runtime.stop();store.close();}
});

test('long-care withdrawal: capable escorted beneficiaries keep a real stop menu without ending transport',()=>{
 const {w,provider,beneficiary,c,home}=fixture();
 w.health!.transports.push({id:'care-transport',carrierId:provider.id,patientId:beneficiary.id,buildingId:home.id,bed:0,basis:'consent',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});
 const original=structuredClone(w.health!.transports),at={...beneficiary.at};
 queue(w,beneficiary,chosen(w,beneficiary,c).action);assert.equal(c.status,'cancelled');assert.deepEqual(w.health!.transports,original);assert.deepEqual(beneficiary.at,at);
});

test('long-care withdrawal: capable ferry passengers can stop only their care without disembarking',()=>{
 const {w,provider,beneficiary,c}=fixture();
 w.ferries={boats:[{id:'care-boat',ownerId:provider.id,definition:'transport/ferry@1',at:{...provider.at},dockId:null,condition:100,tripId:'care-trip'}],builds:[],trips:[{id:'care-trip',boatId:'care-boat',operatorId:provider.id,sourceId:'source',destinationId:'destination',headingId:'destination',fare:0,departAt:w.minute,expiresAt:w.minute+100,capacity:3,phase:'held',seats:[],aboard:[beneficiary.id],pilotId:provider.id,path:[],progress:0,returned:false,arrivedAt:null,reason:null}],nextSerial:0,totals:{built:0,voyages:0,fares:0,refunds:0}};
 const original=structuredClone(w.ferries),at={...beneficiary.at};
 queue(w,beneficiary,chosen(w,beneficiary,c).action);assert.equal(c.status,'cancelled');assert.deepEqual(w.ferries,original);assert.deepEqual(beneficiary.at,at);
});
