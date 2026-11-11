import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PremisesAction,PremisesTerms} from '../src/shared/premises.js';
import {residentialLease,residentialStay,premisesWorkReason} from '../src/shared/premises.js';
import {commonsLeaseCount,leasedBed} from '../src/shared/commons.js';
import {roomLayout,sleepBuilding,actionRoom,residentBed} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {advancePremises,completePremises,premisesReason,premisesTermsError} from '../src/world/premises.js';
import {accountBalance,totalCoins,economyReason} from '../src/world/economy.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeRooms} from '../src/world/rooms.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {recordDeath} from '../src/world/life.js';
import {executeSocialAction} from '../src/world/social.js';
import {pendingEstateReturns} from '../src/world/estate-pending.js';
import {premisesOpportunities,premisesNotes,parsePremisesChoice} from '../src/server/premises-opportunities.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {premisesPanel} from '../src/client/premises.js';
import {WorldStore} from '../src/server/store.js';

const terms:PremisesTerms={days:4,rentPerDay:12,deposit:7,station:'bed',startMinute:0,durationMinutes:DAY};
function fixture(){
 const w=createWorld();w.mode='formal';w.minute=600;w.clock.paused=false;
 const [owner,tenant,other]=w.residents,source=w.buildings.find(b=>b.ownerId===owner.id)!;
 const home={...structuredClone(source),id:'vacant-rental-home',name:'空置住宅',kind:'home' as const,residents:[] as string[],capacity:3};w.buildings.push(home);
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=500;r.inventory={meal:10,water:10,turnip:10};r.health=r.energy=100;r.hunger=10;r.plan=r.activity=null;r.knownBuildings.push(home.id);r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);r.canDecide=r.canExpress=true;}
 initializeRooms(w);advancePremises(w);initializeForeignTrade(w);return {w,owner,tenant,other,home};
}
function offer(f:ReturnType<typeof fixture>){assert.equal(completePremises(f.w,f.owner,{type:'premises',operation:'offer',buildingId:f.home.id,tenantId:f.tenant.id,terms}),null);return f.w.economy!.leases!.at(-1)!;}
function accept(f:ReturnType<typeof fixture>){const l=offer(f);assert.equal(completePremises(f.w,f.tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);return l;}
function plan(w:World,r:Resident,a:Action,id='residential-plan'){assert.ok(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择有限住宿',actions:[a]}).ok);}
function run(w:World,r:Resident){for(let n=0;r.plan||r.activity;n++){assert.ok(n<500);stepWorld(w,1);}assert.equal(r.lastFailure,null);}

test('residential rent requires both independent choices and changes no permanent home, property or inventory',()=>{
 const f=fixture(),{w,owner,tenant,other,home}=f,money=totalCoins(w),oldHome=tenant.homeId,bag=structuredClone(tenant.inventory),l=offer(f);
 assert.equal(sleepBuilding(w,tenant,{buildingId:home.id}),undefined);assert.equal(accountBalance(w,l.account),0);
 for(const r of [owner,other])assert.ok(premisesReason(w,r,{type:'premises',operation:'accept',leaseId:l.id}));
 tenant.at={x:1,y:1};assert.ok(completePremises(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}));tenant.at={...home.door};
 assert.equal(completePremises(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);
 assert.equal(residentialStay(w,tenant.id,home.id)?.id,l.id);assert.equal(residentialStay(w,other.id,home.id),undefined);
 assert.equal(tenant.homeId,oldHome);assert.deepEqual(home.residents,[]);assert.equal(home.ownerId,owner.id);assert.deepEqual(tenant.inventory,bag);assert.equal(tenant.coins,445);assert.equal(totalCoins(w),money);
 assert.equal(sleepBuilding(w,tenant,{} )?.id,oldHome);assert.equal(sleepBuilding(w,tenant,{buildingId:home.id})?.id,home.id);
});

test('a refusal or withdrawal costs nothing and the landlord cannot withdraw a signed residential lease',()=>{
 for(const operation of ['decline','withdraw'] as const){const f=fixture(),l=offer(f),money=totalCoins(f.w);assert.equal(completePremises(f.w,operation==='decline'?f.tenant:f.owner,{type:'premises',operation,leaseId:l.id}),null);assert.equal(accountBalance(f.w,l.account),0);assert.equal(totalCoins(f.w),money);assert.ok(premisesReason(f.w,f.tenant,{type:'premises',operation:'accept',leaseId:l.id}));}
 const f=fixture(),l=accept(f);assert.ok(completePremises(f.w,f.owner,{type:'premises',operation:'withdraw',leaseId:l.id}));assert.equal(l.status,'active');
});

test('vacancy is rechecked at acceptance, with no displacement or escrow charge on failure',()=>{
 for(const obstruction of ['resident','homeId','inside','claim','owner','condition','capacity','funds','minor','incapable'] as const){const f=fixture(),{w,tenant,other,home}=f,l=offer(f);
  if(obstruction==='resident')home.residents.push(other.id);
  if(obstruction==='homeId')other.homeId=home.id;
  if(obstruction==='inside')other.inside=home.id;
  if(obstruction==='claim')w.rooms!.claims.push({buildingId:home.id,key:'bed:0',group:other.id,people:[other.id]});
  if(obstruction==='owner')home.ownerId=other.id;
  if(obstruction==='condition')home.condition=0;
  if(obstruction==='capacity')home.capacity=0;
  if(obstruction==='funds')tenant.coins=1;
  if(obstruction==='minor')tenant.bornAt=w.minute-17*YEAR;
  if(obstruction==='incapable')tenant.canDecide=false;
  const money=totalCoins(w);assert.ok(completePremises(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}),obstruction);assert.equal(l.status,'offered');assert.equal(accountBalance(w,l.account),0);assert.equal(totalCoins(w),money);
 }
});

test('stale shore coordinates on a ferry do not authorize residential acceptance',()=>{
 const f=fixture(),{w,tenant}=f,l=offer(f);w.ferries={boats:[],builds:[],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0},trips:[{id:'aboard',boatId:'boat',operatorId:f.other.id,sourceId:'a',destinationId:'b',headingId:'b',fare:0,departAt:w.minute,expiresAt:w.minute+DAY,capacity:3,phase:'sailing',seats:[],aboard:[tenant.id],pilotId:f.other.id,path:[],progress:0,returned:false,arrivedAt:null,reason:null}]};
 assert.ok(completePremises(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}));assert.equal(l.prepaid,0);
});

test('residential terms have no editable purpose, party, bed or partial daily window',()=>{
 const f=fixture(),{w,owner,tenant}=f,choices=decisionChoices(decisionContext(w,owner)),choice=choices.find(c=>c.action.type==='premises'&&c.action.operation==='offer'&&c.action.tenantId===tenant.id&&c.action.terms?.station==='bed');assert.ok(choice);
 const good=parseChoice(JSON.stringify({choice:choice.id,days:3,rentPerDay:2,deposit:0}),choices);assert.equal((good.actions[0] as PremisesAction).terms!.days,3);
 for(const field of ['buildingId','tenantId','station','bed'])assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,[field]:'changed'}),choices));
 assert.throws(()=>parsePremisesChoice(choice.action as PremisesAction,{startMinute:360}));
 for(const t of [{...terms,days:29},{...terms,days:NaN},{...terms,deposit:-1},{...terms,rentPerDay:0},{...terms,durationMinutes:720}])assert.ok(premisesTermsError(t));
});

test('normal final menus and timed actions lead to actual indoor sleep without teleporting or automatic move-in',()=>{
 const f=fixture(),{w,owner,tenant,home}=f;
 let choices=decisionChoices(decisionContext(w,owner)),c=choices.find(c=>c.action.type==='premises'&&c.action.operation==='offer'&&c.action.tenantId===tenant.id&&c.action.terms?.station==='bed');assert.ok(c);plan(w,owner,c.action,'offer-home');run(w,owner);
 choices=decisionChoices(decisionContext(w,tenant));assert.ok(choices.some(c=>c.action.type==='premises'&&c.action.operation==='decline'));c=choices.find(c=>c.action.type==='premises'&&c.action.operation==='accept');assert.ok(c);plan(w,tenant,c.action,'accept-home');run(w,tenant);
 c=decisionChoices(decisionContext(w,tenant)).find(c=>c.action.type==='sleep'&&c.action.buildingId===home.id);assert.ok(c);tenant.energy=40;plan(w,tenant,{...c.action,minutes:30} as Action,'sleep-home');stepWorld(w,1);assert.ok(tenant.energy<=40);assert.notDeepEqual(tenant.roomAt,roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at);run(w,tenant);
 assert.equal(tenant.inside,home.id);assert.deepEqual(tenant.roomAt,roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at);assert.ok(tenant.energy>40);assert.deepEqual(home.residents,[]);assert.notEqual(tenant.homeId,home.id);
});

test('renting a bed cannot open a shop, cook, steal another bed or turn the home into permanent shared housing',()=>{
 const f=fixture(),{w,owner,tenant,other,home}=f;accept(f);
 for(const r of [owner,tenant])assert.ok(economyReason(w,r,{type:'economy',operation:'open',buildingId:home.id}));
 for(const r of [owner,tenant,other])assert.ok(premisesWorkReason(w,r.id,home.id,'kitchen',w.minute,w.minute+20));
 assert.equal(commonsLeaseCount(w,home.id),home.capacity);assert.equal(leasedBed(w,home.id,0,other.id),true);assert.equal(leasedBed(w,home.id,1,other.id),true);assert.equal(leasedBed(w,home.id,0,tenant.id),false);assert.equal(leasedBed(w,home.id,home.capacity,other.id),false);assert.equal(residentBed(w,other,home),null);
 assert.equal(executeSocialAction(w,owner,{type:'settle',buildingId:home.id}).ok,false);assert.equal(home.residents.length,0);
 const a={planId:'bed',action:{type:'sleep' as const,buildingId:home.id,minutes:30},startedAt:w.minute,remaining:30,path:[],target:home.door,definition:w.activeDefinitions['action/routine']};assert.equal(actionRoom(w,tenant,a)?.key,'bed:0');
 plan(w,tenant,{type:'cook',buildingId:home.id,quantity:1});stepWorld(w,1);assert.match(tenant.lastFailure??'',/使用权|厨房/);
});

test('expiry ends an ongoing sleep in place and refunds only deposit after exactly finite rent',()=>{
 const f=fixture(),{w,tenant,home}=f,l=accept(f),money=totalCoins(w);w.minute=l.endsAt!-3;tenant.inside=home.id;tenant.roomAt={...roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at};tenant.energy=40;
 plan(w,tenant,{type:'sleep',buildingId:home.id,minutes:120});stepWorld(w,4);assert.match(tenant.lastFailure??'',/失效/);assert.equal(tenant.inside,home.id);assert.equal(l.status,'expired');assert.equal(l.paid,48);assert.equal(l.refunded,7);assert.equal(accountBalance(w,l.account),0);assert.equal(totalCoins(w),money);assert.equal(residentialLease(w,home.id),undefined);
});

test('early surrender settles elapsed rent once and keeps goods and prior permanent residence',()=>{
 const f=fixture(),{w,tenant}=f,l=accept(f),money=totalCoins(w),home=tenant.homeId,bag=structuredClone(tenant.inventory);w.minute+=DAY/2;
 assert.equal(completePremises(w,tenant,{type:'premises',operation:'surrender',leaseId:l.id}),null);assert.equal(l.status,'ended');assert.equal(l.paid,6);assert.equal(l.refunded,49);assert.equal(tenant.homeId,home);assert.deepEqual(tenant.inventory,bag);const count=w.economy!.transferCount;advancePremises(w);advancePremises(w);assert.equal(w.economy!.transferCount,count);assert.equal(totalCoins(w),money);
});

test('owner death protects the finite lease and tenant death returns escrow to the proper estate',()=>{
 for(const dead of ['owner','tenant'] as const){const f=fixture(),{w,owner,tenant,home}=f,l=accept(f),money=totalCoins(w);w.minute+=DAY/2;recordDeath(w,f[dead]);advancePremises(w);
  if(dead==='owner'){assert.equal(l.status,'active');assert.equal(residentialStay(w,tenant.id,home.id)?.id,l.id);assert.match(pendingEstateReturns(w,owner.id)??'',/租约/);w.minute=l.endsAt!;advancePremises(w);assert.equal(l.paid,48);assert.equal(l.refunded,7);}
  else {assert.equal(l.status,'ended');assert.equal(l.paid,6);assert.equal(l.refunded,49);assert.ok(w.estates.find(e=>e.personId===tenant.id));}
  assert.equal(totalCoins(w),money);
 }
});

test('damage or title change ends only use rights and refunds unearned rent, without moving the tenant',()=>{
 for(const change of ['damage','title'] as const){const f=fixture(),{w,tenant,home}=f,l=accept(f),money=totalCoins(w);w.minute+=DAY;tenant.inside=home.id;tenant.roomAt={x:2,y:5};if(change==='damage')home.condition=0;else home.ownerId=f.other.id;advancePremises(w);assert.equal(l.status,'ended');assert.equal(l.paid,12);assert.equal(l.refunded,43);assert.equal(tenant.inside,home.id);assert.equal(totalCoins(w),money);}
});

test('SQLite reload retains residential rights and durable accept/expiry receipts without repeat money',()=>{
 const f=fixture(),{w,tenant,home}=f,l=offer(f),a:PremisesAction={type:'premises',operation:'accept',leaseId:l.id};tenant.activity={planId:'durable-home',action:a,startedAt:w.minute,remaining:1,path:[],target:home.door,definition:w.activeDefinitions['action/routine']};assert.equal(completePremises(w,tenant,a),null);const money=totalCoins(w),store=new WorldStore(':memory:');store.commit(w,null);
 const restored=store.load()!,r=restored.residents.find(p=>p.id===tenant.id)!;assert.equal(completePremises(restored,r,a),null);assert.equal(residentialStay(restored,r.id,home.id)?.id,l.id);restored.minute=l.endsAt!;advancePremises(restored);const count=restored.economy!.transferCount;store.commit(restored,w.revision);const again=store.load()!;advancePremises(again);assert.equal(again.economy!.transferCount,count);assert.equal(totalCoins(again),money);store.close();
});

test('legacy worlds gain no paid housing and observation remains read-only, escaped and local',()=>{
 const f=fixture(),{w,tenant,home}=f,money=totalCoins(w);delete w.economy!.leases;advancePremises(w);assert.deepEqual(w.economy!.leases,[]);assert.equal(totalCoins(w),money);assert.equal(residentialStay(w,tenant.id,home.id),undefined);accept(f);home.name='<img onerror=alert(1)>';const before=JSON.stringify(w),html=premisesPanel(w);assert.match(html,/住宅第1张床/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.equal(JSON.stringify(w),before);
 tenant.at={x:1,y:1};const choices=premisesOpportunities(w,tenant);const notes=premisesNotes(w,tenant);home.condition=0;advancePremises(w);assert.deepEqual(premisesOpportunities(w,tenant),choices);assert.equal(premisesNotes(w,tenant),notes);assert.ok(choices.some(c=>c.action.type==='move'));assert.ok(!choices.some(c=>c.action.type==='sleep'));
});


test('self-surrender clears the tenant remembered-current lease while distant changes remain unobserved',()=>{
 const f=fixture(),l=accept(f);assert.equal(completePremises(f.w,f.tenant,{type:'premises',operation:'surrender',leaseId:l.id}),null);f.tenant.at={x:1,y:1};assert.equal(premisesNotes(f.w,f.tenant),'');assert.ok(!premisesOpportunities(f.w,f.tenant).some(c=>c.id==='premises.visit.'+l.id));
});

test('pending family, care, shared property and protected property commitments block residential leasing',()=>{
 for(const kind of ['family','care','shared','protected'] as const){const f=fixture(),{w,owner,tenant,home}=f;
  if(kind==='family')w.familyRelocation={version:1,nextSerial:1,agreements:[{id:'pending-family',definition:'family/relocation@1',proposerId:owner.id,buildingId:home.id,ownerId:owner.id,assembly:{...owner.at},destination:{...home.door},departAfter:w.minute,departBefore:w.minute+DAY,expiresAt:w.minute+DAY,members:[],requiredSignerIds:[owner.id],signatures:[],rationsPerPerson:1,food:'meal',waterPerRation:1,status:'proposed',createdAt:w.minute,startedAt:null,endedAt:null,reason:null,journey:null}]};
  if(kind==='care')w.longCare={agreements:[{addressId:home.id,status:'active'}]} as World['longCare'];
  if(kind==='shared')w.household={pools:[{buildingId:home.id,status:'open'}]} as World['household'];
  if(kind==='protected')w.production={protectedCustody:{mandates:[{scope:{buildings:[home.id]},status:'active'}]}} as World['production'];
  const money=totalCoins(w);assert.ok(premisesReason(w,owner,{type:'premises',operation:'offer',buildingId:home.id,tenantId:tenant.id,terms}),kind);assert.equal(w.economy!.leases!.length,0);assert.equal(totalCoins(w),money);
 }
});

test('missing estate settlement freezes the actual end boundary, never accrues extra rent on retry',()=>{
 const f=fixture(),{w,tenant}=f,l=accept(f);w.minute+=DAY/2;recordDeath(w,tenant);const estate=w.estates.find(e=>e.personId===tenant.id)!;w.estates=w.estates.filter(e=>e!==estate);advancePremises(w);assert.equal(l.endedAt,w.minute);assert.equal(l.paid,6);assert.equal(l.status,'active');assert.equal(residentialLease(w,f.home.id),undefined);
 const stopped=l.endedAt;w.minute+=DAY;w.estates.push(estate);const money=totalCoins(w);advancePremises(w);assert.equal(l.endedAt,stopped);assert.equal(l.status,'ended');assert.equal(l.paid,6);assert.equal(l.refunded,49);assert.equal(totalCoins(w),money);
});


test('closed shared accounts must actually clear their original stock and pending gifts before rental',()=>{
 for(const status of ['closed','declined','expired'] as const){const f=fixture(),{w,owner,tenant,home}=f;
  const pool={id:'original-household',buildingId:home.id,status,credits:[{ownerId:owner.id,coins:9,inventory:{wood:3}}]} as NonNullable<World['household']>['pools'][number];
  w.household={pools:[pool],gifts:[],nextSerial:1,totals:{deposited:0,withdrawn:0,gifted:0,estateCoins:0}};
  const action:PremisesAction={type:'premises',operation:'offer',buildingId:home.id,tenantId:tenant.id,terms};assert.ok(premisesReason(w,owner,action),status);pool.credits[0].coins=0;assert.ok(premisesReason(w,owner,action));pool.credits[0].inventory={};assert.equal(premisesReason(w,owner,action),null);
  w.household.gifts.push({poolId:pool.id,status:'ready'} as NonNullable<World['household']>['gifts'][number]);assert.ok(premisesReason(w,owner,action));w.household.gifts[0].status='delivered';assert.equal(premisesReason(w,owner,action),null);
 }
});
