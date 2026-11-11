import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PremisesAction,PremisesTerms} from '../src/shared/premises.js';
import {residentialStay} from '../src/shared/premises.js';
import {roomLayout} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {recordDeath} from '../src/world/life.js';
import {deathProof} from '../src/world/knowledge.js';
import {initializeProduction,completeProduction} from '../src/world/production.js';
import {initializeEconomy,accountBalance,totalCoins} from '../src/world/economy.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeHealth} from '../src/world/health.js';
import {completePremises,premisesReason,advancePremises} from '../src/world/premises.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';

const terms:PremisesTerms={days:2,rentPerDay:12,deposit:7,station:'bed',startMinute:0,durationMinutes:DAY};
function fixture(inside=false){
 const w=createWorld();w.mode='formal';w.minute=600;w.clock.paused=false;
 const [dead,heir,tenant]=w.residents,home=w.buildings.find(b=>b.id===dead.homeId)!;
 for(const r of w.residents){
  r.bornAt=w.minute-30*YEAR;r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=500;
  r.inventory={meal:10,water:10};r.health=r.energy=100;r.hunger=10;r.plan=r.activity=null;
  r.knownBuildings=w.buildings.map(b=>b.id);r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);
  r.parents=[];r.canDecide=r.canExpress=true;
 }
 heir.parents=[dead.id];
 initializeEconomy(w);initializeProduction(w);initializeForeignTrade(w);initializeRooms(w);advancePremises(w);
 if(inside)for(const r of [dead,heir]){r.inside=home.id;r.roomAt={...roomLayout(w,home).entry};}
 const money=totalCoins(w),history={homeId:dead.homeId,name:dead.name,bornAt:dead.bornAt,parents:[...dead.parents]};
 assert.equal(recordDeath(w,dead),true);assert.ok(deathProof(w,heir,dead.id));
 assert.equal(dead.homeId,home.id);assert.deepEqual(home.residents,[]);
 heir.inside=null;heir.roomAt=null;
 return {w,dead,heir,tenant,home,money,history};
}
function inherit(f:ReturnType<typeof fixture>){
 assert.equal(completeProduction(f.w,f.heir,{type:'production',operation:'inherit',personId:f.dead.id}),null);
 assert.equal(f.home.ownerId,f.heir.id);assert.equal(f.dead.homeId,f.home.id);
 assert.equal(f.w.estates.find(e=>e.personId===f.dead.id)!.status,'settled');
 assert.equal(totalCoins(f.w),f.money);
}
function offerAction(f:ReturnType<typeof fixture>):PremisesAction{return {type:'premises',operation:'offer',buildingId:f.home.id,tenantId:f.tenant.id,terms};}
function offer(f:ReturnType<typeof fixture>){assert.equal(completePremises(f.w,f.heir,offerAction(f)),null);return f.w.economy!.leases!.at(-1)!;}
function run(w:World,r:Resident,action:Action,id:string){
 assert.ok(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'独立选择继承住宅的有限租住',actions:[action]}).ok);
 for(let n=0;r.plan||r.activity;n++){assert.ok(n<500,'action must complete');stepWorld(w,1);}
 assert.equal(r.lastFailure,null);
}
function history(r:Resident){return {homeId:r.homeId,name:r.name,bornAt:r.bornAt,parents:r.parents};}
function familyJourney(w:World,r:Resident,buildingId:string,status:'proposed'|'travelling'|'paused'='travelling',escorting=false){
 w.familyRelocation={version:1,nextSerial:2,agreements:[{
  id:'prior-family',definition:'family/relocation@1',proposerId:r.id,buildingId,ownerId:r.id,
  assembly:{...r.at},destination:{...r.at},departAfter:w.minute,departBefore:w.minute+DAY,expiresAt:w.minute+DAY,
  members:[{personId:r.id,previousHomeId:r.homeId,previousResidency:'resident',guardianIds:[],caregiverId:null,requiresAssent:true,providerId:r.id,bed:0,arrivedAt:null,arrivalEventId:null,escorting}],
  requiredSignerIds:[r.id],signatures:[],rationsPerPerson:1,food:'meal',waterPerRation:1,status,
  createdAt:w.minute,startedAt:status==='proposed'?null:w.minute,endedAt:null,reason:null,journey:null,
 }]};
}
function transit(w:World,r:Resident,kind:'ferry'|'medical'|'family'|'escort'){
 if(kind==='ferry')w.ferries={boats:[],builds:[],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0},trips:[{id:'aboard',boatId:'boat',operatorId:'operator',sourceId:'a',destinationId:'b',headingId:'b',fare:0,departAt:w.minute,expiresAt:w.minute+DAY,capacity:3,phase:'sailing',seats:[],aboard:[r.id],pilotId:'operator',path:[],progress:0,returned:false,arrivedAt:null,reason:null}]};
 else if(kind==='medical'){
  initializeHealth(w);w.health!.transports.push({id:'carried',carrierId:'carrier',patientId:r.id,buildingId:r.homeId!,bed:0,basis:'consent',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});
 }else familyJourney(w,r,r.homeId!,kind==='escort'?'paused':'travelling',kind==='escort');
}

test('actual inherited empty home reaches normal lease choices and timed sleep without erasing deceased home history',()=>{
 const f=fixture(),{w,dead,heir,tenant,home,money}=f,oldHome=tenant.homeId,bag=structuredClone(tenant.inventory);
 inherit(f);
 const choice=decisionChoices(decisionContext(w,heir)).find(c=>c.action.type==='premises'&&c.action.operation==='offer'&&c.action.buildingId===home.id&&c.action.tenantId===tenant.id);
 assert.ok(choice,'a real heir must be able to offer the deceased owner’s now-empty home');
 run(w,heir,choice.action,'inherited-home-offer');
 const choices=decisionChoices(decisionContext(w,tenant)),accept=choices.find(c=>c.action.type==='premises'&&c.action.operation==='accept');
 assert.ok(accept);assert.ok(choices.some(c=>c.action.type==='premises'&&c.action.operation==='decline'));
 run(w,tenant,accept.action,'inherited-home-accept');
 const lease=w.economy!.leases!.at(-1)!;
 assert.equal(residentialStay(w,tenant.id,home.id)?.id,lease.id);
 assert.deepEqual(tenant.inventory,bag);assert.equal(tenant.homeId,oldHome);assert.deepEqual(home.residents,[]);
 tenant.energy=40;run(w,tenant,{type:'sleep',buildingId:home.id,minutes:30},'inherited-home-sleep');
 assert.equal(tenant.inside,home.id);assert.deepEqual(tenant.roomAt,roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at);assert.ok(tenant.energy>40);
 assert.deepEqual(history(dead),f.history);assert.equal(home.ownerId,heir.id);assert.equal(totalCoins(w),money);
});

test('SQLite reload preserves historical home through death, actual inheritance, offer, durable acceptance and expiry',()=>{
 const initial=fixture(),store=new WorldStore(':memory:');let f=initial,revision:number|null=null;
 const reload=()=>{store.commit(f.w,revision);const w=store.load()!;revision=w.revision;f={...f,w,dead:w.residents.find(r=>r.id===f.dead.id)!,heir:w.residents.find(r=>r.id===f.heir.id)!,tenant:w.residents.find(r=>r.id===f.tenant.id)!,home:w.buildings.find(b=>b.id===f.home.id)!};};
 try{
  reload();inherit(f);reload();
  assert.ok(completeProduction(f.w,f.heir,{type:'production',operation:'inherit',personId:f.dead.id}));
  const offered=offer(f);reload();
  const a:PremisesAction={type:'premises',operation:'accept',leaseId:offered.id};
  f.tenant.activity={planId:'inherited-durable-accept',action:a,startedAt:f.w.minute,remaining:1,path:[],target:{...f.home.door},definition:f.w.activeDefinitions['action/routine']};
  assert.equal(completePremises(f.w,f.tenant,a),null);const transfers=f.w.economy!.transferCount;
  reload();assert.equal(completePremises(f.w,f.tenant,a),null);assert.equal(f.w.economy!.transferCount,transfers);
  const lease=f.w.economy!.leases!.find(l=>l.id===offered.id)!;
  assert.equal(residentialStay(f.w,f.tenant.id,f.home.id)?.id,lease.id);assert.equal(lease.prepaid,31);assert.equal(accountBalance(f.w,lease.account),31);
  f.w.minute=lease.endsAt!;advancePremises(f.w);assert.equal(lease.paid,24);assert.equal(lease.refunded,7);
  const settled=f.w.economy!.transferCount;reload();advancePremises(f.w);
  assert.equal(f.w.economy!.transferCount,settled);assert.equal(accountBalance(f.w,lease.account),0);
  assert.deepEqual(history(f.dead),initial.history);assert.equal(f.home.ownerId,f.heir.id);assert.deepEqual(f.home.residents,[]);assert.equal(totalCoins(f.w),initial.money);
 }finally{store.close();}
});

test('an inherited home with an actual indoor body remains unavailable despite historical home exemption',()=>{
 const f=fixture(true);inherit(f);assert.equal(f.dead.inside,f.home.id);
 const before=JSON.stringify(f.w);assert.match(completePremises(f.w,f.heir,offerAction(f))!,/实际在场者/);assert.equal(JSON.stringify(f.w),before);
});

test('living registrations, absent residents, physical occupants, and bed claims still block offers and acceptance',()=>{
 for(const phase of ['offer','accept'] as const)for(const kind of ['resident-list','homeId','outside-homeId','ferry-homeId','inside','claim'] as const){
  const f=fixture();inherit(f);const l=phase==='accept'?offer(f):undefined;
  const occupant={...structuredClone(f.tenant),id:'living-occupant',coins:0,inventory:{}};f.w.residents.push(occupant);
  if(kind==='resident-list')f.home.residents.push(occupant.id);
  if(['homeId','outside-homeId','ferry-homeId'].includes(kind))occupant.homeId=f.home.id;
  if(kind==='outside-homeId'){occupant.residency='outside';occupant.at={x:1,y:1};}
  if(kind==='ferry-homeId')transit(f.w,occupant,'ferry');
  if(kind==='inside')occupant.inside=f.home.id;
  if(kind==='claim')f.w.rooms!.claims.push({buildingId:f.home.id,key:'bed:0',group:occupant.id,people:[occupant.id]});
  const a:PremisesAction=l?{type:'premises',operation:'accept',leaseId:l.id}:offerAction(f),r=l?f.tenant:f.heir,before=JSON.stringify(f.w);
  assert.ok(completePremises(f.w,r,a),`${phase}: ${kind}`);assert.equal(JSON.stringify(f.w),before);
  assert.equal(totalCoins(f.w),f.money);assert.equal(l?accountBalance(f.w,l.account):f.w.economy!.leases!.length,0);
 }
});

test('inherited-home parties cannot sign from stale coordinates while on a ferry or being transported',()=>{
 for(const phase of ['offer','accept'] as const)for(const kind of ['ferry','medical','family','escort'] as const){
  const f=fixture();inherit(f);const l=phase==='accept'?offer(f):undefined,r=l?f.tenant:f.heir;
  const a:PremisesAction=l?{type:'premises',operation:'accept',leaseId:l.id}:offerAction(f);
  assert.equal(premisesReason(f.w,r,a),null);transit(f.w,r,kind);
  const before=JSON.stringify(f.w);assert.match(completePremises(f.w,r,a)!,/本人当前不能/);assert.equal(JSON.stringify(f.w),before);
  assert.equal(totalCoins(f.w),f.money);assert.equal(l?accountBalance(f.w,l.account):f.w.economy!.leases!.length,0);
 }
});

test('inheritance does not bypass pending family, care, temporary bed, shared goods, or protected property rights',()=>{
 for(const phase of ['offer','accept'] as const)for(const kind of ['family','appointment','transport','care','stay','shared','protected'] as const){
  const f=fixture();inherit(f);const {w,heir,tenant,home}=f,l=phase==='accept'?offer(f):undefined;
  if(kind==='family')familyJourney(w,tenant,home.id,'proposed');
  if(kind==='appointment'||kind==='transport'){
   initializeHealth(w);
   if(kind==='appointment')w.health!.appointments.push({id:'prior-care',doctorId:heir.id,patientId:tenant.id,buildingId:home.id,createdAt:w.minute,start:w.minute,end:w.minute+30,minutes:30,fee:0,account:'prior-care',stock:{},status:'offered',acceptedAt:null,worked:0,paid:0,refunded:0,materialsUsed:false,lastAt:w.minute,reason:null});
   else w.health!.transports.push({id:'incoming-care',carrierId:heir.id,patientId:'other-patient',buildingId:home.id,bed:0,basis:'consent',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});
  }
  if(kind==='care')w.longCare={agreements:[{addressId:home.id,status:'active'}]} as World['longCare'];
  if(kind==='stay')w.commons={version:1,adoptedAt:w.minute,receipts:[],stays:[{id:'prior-stay',residentId:tenant.id,buildingId:home.id,bed:0,startedAt:w.minute,expiresAt:w.minute+DAY,endedAt:null,reason:null}]};
  if(kind==='shared')w.household={pools:[{id:'prior-household',definition:'household/rules@1',name:'原共同安排',creatorId:heir.id,partnerId:tenant.id,buildingId:home.id,at:{...home.door},account:'prior-household',initial:{coins:0,quantity:0},status:'closed',credits:[{ownerId:tenant.id,coins:0,inventory:{wood:1}}],createdAt:w.minute,expiresAt:w.minute+DAY,acceptedAt:w.minute,closedAt:w.minute,reason:'已关闭但余物未领取'}],gifts:[],nextSerial:2,totals:{deposited:0,withdrawn:0,gifted:0,estateCoins:0}};
  if(kind==='protected')w.production!.protectedCustody={mandates:[{scope:{buildings:[home.id]},status:'active'}]} as NonNullable<World['production']>['protectedCustody'];
  const a:PremisesAction=l?{type:'premises',operation:'accept',leaseId:l.id}:offerAction(f),r=l?tenant:heir,before=JSON.stringify(w);
  assert.ok(completePremises(w,r,a),`${phase}: ${kind}`);assert.equal(JSON.stringify(w),before);
  assert.equal(totalCoins(w),f.money);assert.equal(l?accountBalance(w,l.account):w.economy!.leases!.length,0);
 }
});
