import {pendingEstateReturns} from '../src/world/estate-pending.js';
import {WorldStore} from '../src/server/store.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {advanceEconomy,completeEconomy,economyReason,totalCoins,accountBalance} from '../src/world/economy.js';
import {advancePremises,completePremises,premisesReason,premisesTarget} from '../src/world/premises.js';
import {currentPremisesLease,premisesWorkReason} from '../src/shared/premises.js';
import type {PremisesAction,PremisesTerms} from '../src/shared/premises.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import {initializeIndustry,industryTarget,industryWorkError,completeIndustry} from '../src/world/industry.js';
import {initializeEmployment,employmentReason,completeEmployment,employmentWorkError,advanceEmployment} from '../src/world/employment.js';
import {atWorkstation} from './helpers/workspaces.js';
import {premisesOpportunities,parsePremisesChoice} from '../src/server/premises-opportunities.js';
import {employmentOpportunities} from '../src/server/employment-opportunities.js';
import {economyOpportunities} from '../src/server/economy-opportunities.js';
import {buildChoices,parseChoice} from '../src/server/affordances.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {beginRoomTick,moveInRoom} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {premisesPanel} from '../src/client/premises.js';
import {recordDeath} from '../src/world/life.js';

const terms:PremisesTerms={days:4,rentPerDay:12,deposit:7,station:'bench',startMinute:540,durationMinutes:360};
function fixture(){
 const w=createWorld();w.mode='formal';w.minute=600;w.clock.paused=false;
 const [owner,tenant,worker]=w.residents,source=w.buildings.find(b=>b.ownerId===owner.id)!;
 const site={...structuredClone(source),id:'rental-workshop',kind:'workshop' as const,name:'独立工坊',ownerId:owner.id,residents:[] as string[],capacity:0};w.buildings.push(site);
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...site.door};r.inside=null;r.roomAt=null;r.coins=500;r.inventory={wood:30,turnip:30,water:30,stone:10};r.health=100;r.energy=100;r.hunger=10;r.skills.building=4;r.plan=null;r.activity=null;r.knownBuildings.push(site.id);r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);}
 initializeIndustry(w);initializeEmployment(w);advancePremises(w);
 assert.equal(completeIndustry(w,owner,{type:'industry',operation:'install',buildingId:site.id,station:'bench'}),null);
 return {w,owner,tenant,worker,site};
}
function offer(f:ReturnType<typeof fixture>,t=terms){assert.equal(completePremises(f.w,f.owner,{type:'premises',operation:'offer',buildingId:f.site.id,tenantId:f.tenant.id,terms:t}),null);return f.w.economy!.leases!.at(-1)!;}
function lease(f:ReturnType<typeof fixture>,t=terms){const l=offer(f,t);assert.equal(completePremises(f.w,f.tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);return l;}
function open(f:ReturnType<typeof fixture>){assert.equal(completeEconomy(f.w,f.tenant,{type:'economy',operation:'open',buildingId:f.site.id}),null);return f.w.economy!.businesses.at(-1)!;}
function choose(w:World,r:Resident,a:Action,id='lease-plan'){
 const result=submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择场所安排',actions:[a]});assert.equal(result.ok,true,JSON.stringify(result));
}

test('owner offers, tenant independently accepts at site, no deed/home/goods transfer',()=>{
 const f=fixture(),{w,owner,tenant,worker,site}=f,before=totalCoins(w),inventory=structuredClone(tenant.inventory),home=tenant.homeId,l=offer(f);
 assert.equal(accountBalance(w,l.account),0);assert.equal(economyReason(w,tenant,{type:'economy',operation:'open',buildingId:site.id})!==null,true);
 assert.notEqual(premisesReason(w,owner,{type:'premises',operation:'accept',leaseId:l.id}),null);assert.notEqual(premisesReason(w,worker,{type:'premises',operation:'accept',leaseId:l.id}),null);
 tenant.at={x:1,y:1};assert.notEqual(completePremises(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);tenant.at={...site.door};
 assert.equal(completePremises(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);
 assert.equal(accountBalance(w,l.account),55);assert.equal(tenant.coins,445);assert.equal(totalCoins(w),before);assert.equal(site.ownerId,owner.id);assert.equal(tenant.homeId,home);assert.deepEqual(tenant.inventory,inventory);
 assert.equal(economyReason(w,tenant,{type:'economy',operation:'open',buildingId:site.id}),null);assert.notEqual(economyReason(w,owner,{type:'economy',operation:'open',buildingId:site.id}),null);
});

test('bad terms, insufficient funding, changed ownership and home occupancy fail before money moves',()=>{
 const f=fixture(),{w,tenant,site}=f;assert.throws(()=>parsePremisesChoice({type:'premises',operation:'offer',terms},{days:Infinity}),/invalid/);
 const l=offer(f);tenant.coins=1;assert.notEqual(completePremises(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);assert.equal(accountBalance(w,l.account),0);
 tenant.coins=500;site.residents.push(tenant.id);assert.notEqual(premisesReason(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);site.residents=[];site.ownerId=f.worker.id;assert.notEqual(premisesReason(w,tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);
});

test('rent, refundable deposit and restart have durable finite accounting',()=>{
 const f=fixture(),l=lease(f),before=totalCoins(f.w);f.w.minute+=DAY;advancePremises(f.w);assert.equal(l.paid,12);assert.equal(accountBalance(f.w,l.account),43);
 const w=JSON.parse(JSON.stringify(f.w)) as World;w.minute=l.endsAt!;advancePremises(w);const ended=w.economy!.leases![0];assert.equal(ended.status,'expired');assert.equal(ended.paid,48);assert.equal(ended.refunded,7);assert.equal(accountBalance(w,ended.account),0);assert.equal(totalCoins(w),before);
 const ledger=w.economy!.transferCount;advancePremises(w);advancePremises(w);assert.equal(w.economy!.transferCount,ledger);assert.equal(totalCoins(w),before);
});

test('tenant surrender refunds unearned rent and deposit; landlord cannot revoke accepted lease',()=>{
 const f=fixture(),l=lease(f);f.w.minute+=DAY/2;assert.notEqual(completePremises(f.w,f.owner,{type:'premises',operation:'withdraw',leaseId:l.id}),null);
 assert.equal(completePremises(f.w,f.tenant,{type:'premises',operation:'surrender',leaseId:l.id}),null);assert.equal(l.paid,6);assert.equal(l.refunded,49);assert.equal(l.status,'ended');assert.equal(currentPremisesLease(f.w,f.site.id),undefined);
});

test('new or existing site obligations and fixture disposal cannot displace lease rights',()=>{
 const f=fixture();assert.equal(completeEconomy(f.w,f.owner,{type:'economy',operation:'open',buildingId:f.site.id}),null);assert.notEqual(premisesReason(f.w,f.owner,{type:'premises',operation:'offer',buildingId:f.site.id,tenantId:f.tenant.id,terms}),null);
 const g=fixture();lease(g);assert.notEqual(industryTarget(g.w,g.owner,{type:'industry',operation:'uninstall',buildingId:g.site.id,station:'bench'}).error,undefined);
 assert.notEqual(industryTarget(g.w,g.tenant,{type:'industry',operation:'install',buildingId:g.site.id,station:'forge'}).error,undefined);
});

test('workstation window excludes landlord, wrong stations and off-hours, including exact closing boundary',()=>{
 const f=fixture();lease(f);assert.equal(premisesWorkReason(f.w,f.tenant.id,f.site.id,'table',600,660),null);
 assert.notEqual(premisesWorkReason(f.w,f.owner.id,f.site.id,'table',600,660),null);assert.equal(premisesWorkReason(f.w,f.owner.id,f.site.id,'table',900,960),null);
 assert.notEqual(premisesWorkReason(f.w,f.tenant.id,f.site.id,'kitchen',600,660),null);assert.notEqual(premisesWorkReason(f.w,f.tenant.id,f.site.id,'table',899,901),null);
 f.w.minute=899;assert.notEqual(industryTarget(f.w,f.tenant,{type:'industry',operation:'craft',buildingId:f.site.id,recipeId:'plank',minutes:60}).error,undefined);
});

test('actual leased craft uses a real station, consumes inputs and cannot keep working after expiry',()=>{
 const f=fixture(),{w,tenant,site}=f,l=lease(f),a={type:'industry' as const,operation:'craft' as const,buildingId:site.id,recipeId:'plank',minutes:15};
 assert.equal(industryTarget(w,tenant,a).error,undefined);atWorkstation(w,tenant,a);tenant.activity={planId:'craft-test',action:a,startedAt:w.minute,remaining:15,path:[],target:{...site.door},definition:w.activeDefinitions['action/routine']};
 w.minute+=1;assert.equal(industryWorkError(w,tenant,a,1),null);const batch=w.industry!.batches.find(b=>b.ownerId===tenant.id)!;assert.equal(batch.worked,1);const original=tenant.inventory.wood;
 w.minute=l.endsAt!;advancePremises(w);assert.notEqual(industryWorkError(w,tenant,a,1),null);assert.equal(tenant.inventory.wood,original);assert.equal(batch.status,'working');assert.equal(batch.buildingId,site.id);
 tenant.activity=null;tenant.inside=null;tenant.roomAt=null;assert.notEqual(completePremises(w,tenant,{type:'premises',operation:'collect',batchId:batch.id}),null);
 const pos=roomLayout(w,site).slots.find(s=>s.key==='station:bench')!.at;tenant.inside=site.id;tenant.roomAt={...pos};assert.equal(completePremises(w,tenant,{type:'premises',operation:'collect',batchId:batch.id}),null);assert.equal(batch.status,'cancelled');assert.equal(tenant.inventory.wood,(original??0)+3);
});

test('expiry preserves closed shop stock and unfinished employee material at original building',()=>{
 const f=fixture(),{w,tenant,worker,site}=f,l=lease(f),b=open(f);b.inventory={wood:8};b.coins=30;
 const t={role:'carpenter' as const,wage:12,startMinute:600,durationMinutes:60,days:2};assert.equal(completeEmployment(w,tenant,{type:'employment',operation:'post',businessId:b.id,terms:t}),null);const p=w.employment!.posts.at(-1)!;
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'apply',postId:p.id}),null);assert.equal(completeEmployment(w,tenant,{type:'employment',operation:'select',postId:p.id,applicantId:worker.id}),null);assert.equal(completeEmployment(w,worker,{type:'employment',operation:'accept',postId:p.id}),null);
 const c=w.employment!.contracts.at(-1)!;w.minute=c.startDay*DAY+600;const a={type:'employment' as const,operation:'work' as const,contractId:c.id,minutes:10};atWorkstation(w,worker,a);worker.activity={planId:'wage-test',action:a,startedAt:w.minute,remaining:10,path:[],target:{...site.door},definition:w.activeDefinitions['action/routine']};w.minute+=5;
 assert.equal(employmentWorkError(w,worker,a,5),null);assert.equal(c.paid,1);assert.equal(c.batch?.inventory.wood,3);
 const ownStock=tenant.inventory.wood,workerCoins=worker.coins;tenant.at={x:1,y:1};w.minute=l.endsAt!;advancePremises(w);advanceEconomy(w);advanceEmployment(w);
 assert.notEqual(b.closedAt,null);assert.equal(b.inventory.wood,8);assert.equal(tenant.inventory.wood,ownStock);assert.equal(c.status,'ended');assert.equal(c.paid,1);assert.equal(worker.coins,workerCoins);assert.equal(c.batch,null);assert.equal(c.refunded,23);
 tenant.at={...site.door};assert.equal(completeEconomy(w,tenant,{type:'economy',operation:'retrieve',businessId:b.id,item:'wood',quantity:8}),null);assert.equal(b.inventory.wood,0);
});

test('hiring choices fit signed window and reject overlong, wrong-station or stale acceptance',()=>{
 const f=fixture(),{w,tenant,worker}=f,l=lease(f),b=open(f);b.coins=100;
 const choices=employmentOpportunities(w,tenant);assert.ok(choices.some(c=>c.action.type==='employment'&&c.action.operation==='post'&&c.action.terms?.role==='carpenter'));
 assert.notEqual(employmentReason(w,tenant,{type:'employment',operation:'post',businessId:b.id,terms:{role:'cook',wage:3,startMinute:600,durationMinutes:60,days:2}}),null);
 assert.notEqual(employmentReason(w,tenant,{type:'employment',operation:'post',businessId:b.id,terms:{role:'carpenter',wage:3,startMinute:600,durationMinutes:60,days:4}}),null);
 assert.equal(completeEmployment(w,tenant,{type:'employment',operation:'post',businessId:b.id,terms:{role:'carpenter',wage:3,startMinute:600,durationMinutes:60,days:2}}),null);const p=w.employment!.posts.at(-1)!;
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'apply',postId:p.id}),null);assert.equal(completeEmployment(w,tenant,{type:'employment',operation:'select',postId:p.id,applicantId:worker.id}),null);
 w.minute=l.endsAt!-DAY;assert.notEqual(employmentReason(w,worker,{type:'employment',operation:'accept',postId:p.id}),null);
});

test('normal model menu can sign lease, open tenant shop, and preserves locked identities',()=>{
 const f=fixture(),{w,owner,tenant,site}=f;const choices=decisionChoices(decisionContext(w,owner)),choice=choices.find(c=>c.action.type==='premises'&&c.action.operation==='offer'&&c.action.tenantId===tenant.id);assert.ok(choice);
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,tenantId:f.worker.id}),choices),/unexpected_choice_field/);
 const decision=parseChoice(JSON.stringify({choice:choice.id,days:4,rentPerDay:3,deposit:0}),choices);choose(w,owner,decision.actions[0]);for(let i=0;i<15&&owner.plan;i++)stepWorld(w,1);
 assert.equal(w.economy!.leases!.length,1);const responses=decisionChoices(decisionContext(w,tenant));assert.ok(responses.some(c=>c.action.type==='premises'&&c.action.operation==='decline'));
 const accept=responses.find(c=>c.action.type==='premises'&&c.action.operation==='accept')!;assert.ok(accept);choose(w,tenant,accept.action,'accept-lease');for(let i=0;i<15&&tenant.plan;i++)stepWorld(w,1);
 assert.equal(w.economy!.leases![0].status,'active');assert.ok(economyOpportunities(w,tenant).some(c=>c.action.type==='economy'&&c.action.operation==='open'&&c.action.buildingId===site.id));
});

test('building damage ends lease, refunds only remaining escrow and never invents repair/damages deductions',()=>{
 const f=fixture(),l=lease(f),total=totalCoins(f.w);f.w.minute+=DAY;f.site.condition=0;advancePremises(f.w);assert.equal(l.status,'ended');assert.equal(l.paid,12);assert.equal(l.refunded,43);assert.equal(totalCoins(f.w),total);
});

test('observer shows finite rent and escrow read-only with escaped labels',()=>{
 const f=fixture();lease(f);f.site.name='<img onerror=alert(1)>';const before=JSON.stringify(f.w),html=premisesPanel(f.w);assert.match(html,/押金7钱/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.equal(JSON.stringify(f.w),before);
});

test('normal engine finishes repair at window end and denies later work',()=>{
 const f=fixture(),{w,tenant,site}=f;lease(f);
 assert.equal(completeIndustry(w,tenant,{type:'industry',operation:'equip',tool:'axe'}), '没有未拆封工具，或已有可用同类工具');
 tenant.inventory.axeKit=1;assert.equal(completeIndustry(w,tenant,{type:'industry',operation:'equip',tool:'axe'}),null);
 const tool=w.industry!.tools.find(t=>t.ownerId===tenant.id&&t.kind==='axe')!;tool.durability=1;
 const a={type:'industry' as const,operation:'repairTool' as const,buildingId:site.id,tool:'axe' as const};const duration=industryTarget(w,tenant,a).duration;
 w.minute=terms.startMinute+terms.durationMinutes-duration;atWorkstation(w,tenant,a);choose(w,tenant,a,'repair-boundary');stepWorld(w,duration);
 assert.equal(tenant.lastFailure,null);assert.equal(tenant.plan,null);assert.ok(tool.durability>1);assert.equal(w.minute,900);
 tool.durability=1;assert.notEqual(industryTarget(w,tenant,a).error,undefined);
});

test('leased kitchen is available only to signed tenant with real ingredients and room walk',()=>{
 const f=fixture(),{w,tenant,site}=f;lease(f,{...terms,station:'kitchen'});
 const a=premisesOpportunities(w,tenant).find(c=>c.action.type==='cook')?.action;assert.ok(a);choose(w,tenant,a,'leased-cook');const meals=tenant.inventory.meal??0;stepWorld(w,2);assert.equal(tenant.inventory.meal??0,meals);stepWorld(w,65);assert.equal(tenant.inventory.meal,meals+1);assert.equal(tenant.lastFailure,null);
 w.minute=900;assert.ok(!premisesOpportunities(w,tenant).some(c=>c.action.type==='cook'));
});

test('ordinary owner room labor cannot claim the leased bench during its window',()=>{
 const f=fixture(),{w,owner,tenant,site}=f;lease(f);const a={type:'industry' as const,operation:'craft' as const,buildingId:site.id,recipeId:'plank',minutes:1};
 atWorkstation(w,owner,a);owner.activity={planId:'owner-conflict',action:a,startedAt:w.minute,remaining:1,path:[],target:{...site.door},definition:w.activeDefinitions['action/routine']};
 // craft room targeting needs the validated station selected by its recipe.
 a['station' as keyof typeof a]='bench' as never;atWorkstation(w,owner,a);w.minute++;beginRoomTick(w);assert.match(moveInRoom(w,owner,1).error??'',/租约/);
});

test('persistent receipt journal prevents accept or expiry replay after compact reload',()=>{
 const f=fixture(),{w,tenant}=f,l=offer(f),a:PremisesAction={type:'premises',operation:'accept',leaseId:l.id};tenant.activity={planId:'durable-accept',action:a,startedAt:w.minute,remaining:1,path:[],target:{...f.site.door},definition:w.activeDefinitions['action/routine']};
 assert.equal(completePremises(w,tenant,a),null);const coins=totalCoins(w),store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;
 const person=saved.residents.find(p=>p.id===tenant.id)!;assert.equal(completePremises(saved,person,a),null);assert.equal(totalCoins(saved),coins);saved.minute=l.endsAt!;advancePremises(saved);const count=saved.economy!.transferCount;store.commit(saved,w.revision);const again=store.load()!;advancePremises(again);assert.equal(again.economy!.transferCount,count);assert.equal(totalCoins(again),coins);store.close();
});

test('tenant death returns unearned rent and deposit to own estate, not landlord or household',()=>{
 const f=fixture(),{w,tenant}=f,l=lease(f);w.minute+=DAY/2;recordDeath(w,tenant);const estate=w.estates.find(e=>e.personId===tenant.id)!;assert.ok(estate);const coins=estate.coins;advancePremises(w);assert.equal(l.status,'ended');assert.equal(l.paid,6);assert.equal(l.refunded,49);assert.equal(estate.coins,coins+49);
});

test('old worlds gain no leases, funds or implied property rights on initialization',()=>{
 const f=fixture(),coins=totalCoins(f.w);delete f.w.economy!.leases;advancePremises(f.w);assert.deepEqual(f.w.economy!.leases,[]);assert.equal(totalCoins(f.w),coins);assert.notEqual(economyReason(f.w,f.tenant,{type:'economy',operation:'open',buildingId:f.site.id}),null);
});

test('cooking receives the final actual minute of a leased window',()=>{
 const f=fixture(),{w,tenant,site}=f;lease(f,{...terms,station:'kitchen'});const a={type:'cook' as const,quantity:1,buildingId:site.id};
 w.minute=899;atWorkstation(w,tenant,a);tenant.activity={planId:'cooking-boundary',action:a,startedAt:880,remaining:1,path:[],target:{...site.door},definition:w.activeDefinitions['recipe/meal']};
 const meals=tenant.inventory.meal??0;stepWorld(w,1);assert.equal(tenant.lastFailure,null);assert.equal(tenant.inventory.meal,meals+1);
});

test('a lease does not strip tenant independent rights to talk in the same room',()=>{
 const f=fixture(),{w,tenant,owner,site}=f;lease(f);w.minute=601;tenant.inside=site.id;tenant.roomAt={x:5,y:10};owner.inside=site.id;owner.roomAt={x:6,y:10};
 const a={type:'talk' as const,targetId:owner.id,text:'下午好',tone:'friendly' as const};tenant.activity={planId:'independent-talk',action:a,startedAt:600,remaining:3,path:[],target:{...site.door},definition:w.activeDefinitions['action/routine']};
 beginRoomTick(w);assert.equal(moveInRoom(w,tenant,1).error,undefined);
});

test('a landlord estate retains unsettled finite rent rights until the original lease ends',()=>{
 const f=fixture(),{w,owner,tenant}=f,l=lease(f),total=totalCoins(w);recordDeath(w,owner);assert.match(pendingEstateReturns(w,owner.id)??'',/租约/);
 w.minute+=DAY;advancePremises(w);assert.equal(l.status,'active');assert.equal(l.paid,12);assert.equal(currentPremisesLease(w,f.site.id)?.tenantId,tenant.id);
 w.minute=l.endsAt!;advancePremises(w);assert.equal(l.paid,48);assert.equal(l.refunded,7);assert.equal(totalCoins(w),total);assert.ok(!pendingEstateReturns(w,owner.id)?.includes('租约'));
});

test('tenant death preserves shop goods in an estate parcel at the original premises',()=>{
 const f=fixture(),{w,tenant,site}=f;lease(f);const b=open(f);b.inventory={wood:9};recordDeath(w,tenant);advancePremises(w);advanceEconomy(w);
 const estate=w.estates.find(e=>e.personId===tenant.id)!;assert.ok(estate.parcels?.some(p=>p.location.at.x===site.door.x&&p.location.at.y===site.door.y&&p.inventory.wood===9));assert.deepEqual(b.inventory,{});assert.notEqual(b.closedAt,null);
});

test('repair finishing exactly at lease expiry completes before expiry settlement',()=>{
 const f=fixture(),{w,tenant,site}=f,l=lease(f);tenant.inventory.axeKit=1;assert.equal(completeIndustry(w,tenant,{type:'industry',operation:'equip',tool:'axe'}),null);
 const tool=w.industry!.tools.find(t=>t.ownerId===tenant.id&&t.kind==='axe')!;tool.durability=1;const a={type:'industry' as const,operation:'repairTool' as const,buildingId:site.id,tool:'axe' as const};const duration=industryTarget(w,tenant,a).duration;
 w.minute=l.endsAt!-duration;atWorkstation(w,tenant,a);choose(w,tenant,a,'repair-lease-expiry');stepWorld(w,duration);
 assert.equal(tenant.lastFailure,null);assert.ok(tool.durability>1);assert.equal(l.status,'expired');assert.equal(l.paid,48);assert.equal(l.refunded,7);
});

test('renting the shared table position does not silently grant the installed bench machinery',()=>{
 const f=fixture();lease(f,{...terms,station:'table'});
 assert.equal(premisesWorkReason(f.w,f.tenant.id,f.site.id,'table',600,630),null);
 assert.notEqual(industryTarget(f.w,f.tenant,{type:'industry',operation:'craft',buildingId:f.site.id,recipeId:'plank',minutes:15}).error,undefined);
 assert.notEqual(premisesWorkReason(f.w,f.owner.id,f.site.id,'station:bench',600,630),null);
});
