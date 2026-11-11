import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WorldStore} from '../src/server/store.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {fishItems} from '../src/shared/fish-species.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {HouseholdAction} from '../src/shared/household.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {ageAllowsChoice} from '../src/world/family.js';
import {completeHousehold,householdOpportunities,householdReason} from '../src/world/household.js';
import {industryTarget} from '../src/world/industry.js';
import {DAY} from '../src/world/time.js';
import {approveSupplyKit,carriedSupplyRods,findSupplyChoice,finishSupply,physicalSupplyKitCount,proposeSupplyKit,queueSupply,supplyFixture,supplyMenu} from './helpers/teen-fishing-supply.js';

const equip=(a:Action)=>a.type==='industry'&&a.operation==='equip'&&a.tool==='rod';
const fish=(a:Action)=>a.type==='industry'&&a.operation==='fish';
const accept=(id:string)=>(a:Action)=>a.type==='household'&&a.operation==='acceptGift'&&a.giftId===id;
const decline=(id:string)=>(a:Action)=>a.type==='household'&&a.operation==='declineGift'&&a.giftId===id;
function cannotEquipOrFish(w:World,r:Resident){
 assert.equal(supplyMenu(w,r).some(c=>equip(c.action)||fish(c.action)),false);
 assert.equal(industryOpportunities(w,r).some(c=>equip(c.action)||fish(c.action)),false);
 assert.ok(industryTarget(w,r,{type:'industry',operation:'equip',tool:'rod'}).error);
 assert.ok(industryTarget(w,r,{type:'industry',operation:'fish',at:w.industry!.frontierShore}).error);
 assert.equal(carriedSupplyRods(w,r).length,0);
}
function assertNoFishing(w:World,r:Resident){
 assert.equal(w.industry!.totals.fish,0);assert.equal(w.industry!.fishingExperience?.[r.id]??0,0);
 for(const item of ['fish',...Object.values(fishItems)] as const)assert.equal(r.inventory[item]??0,0);
 assert.equal(r.plan,null);assert.equal(r.activity,null);
}

for(const origin of ['founder','birth-then-synthetic-13'] as const)test(`${origin}: adult seed wood becomes a separately approved and personally collected kit before teen chooses fifteen-minute equipment`,()=>{
 const f=supplyFixture(origin),{w,a,b,teen,home,opening}=f;
 cannotEquipOrFish(w,teen);assert.equal(physicalSupplyKitCount(w),0);
 const {p,g}=proposeSupplyKit(f);
 assert.equal(physicalSupplyKitCount(w),1);cannotEquipOrFish(w,teen);
 assert.equal(supplyMenu(w,teen).some(c=>accept(g.id)(c.action)||decline(g.id)(c.action)),false);
 const receive:HouseholdAction={type:'household',operation:'acceptGift',giftId:g.id};
 assert.match(householdReason(w,teen,receive)!,/独立接受/);
 const before=structuredClone({credits:p.credits,segments:g.segments,inventory:teen.inventory});
 assert.ok(completeHousehold(w,teen,receive),'forged receipt cannot bypass the other adult');
 assert.ok(completeHousehold(w,a,{type:'household',operation:'approveGift',giftId:g.id}),'proposer cannot sign for second adult');
 assert.deepEqual({credits:p.credits,segments:g.segments,inventory:teen.inventory},before);
 approveSupplyKit(f,g.id);
 assert.equal(p.credits.find(c=>c.ownerId===a.id)!.inventory.rodKit,0);
 assert.deepEqual(g.segments.map(c=>c.inventory.rodKit),[1,0]);
 assert.equal(physicalSupplyKitCount(w),1);cannotEquipOrFish(w,teen);
 assert.ok(supplyMenu(w,teen).some(c=>accept(g.id)(c.action)));
 assert.ok(supplyMenu(w,teen).some(c=>decline(g.id)(c.action)),'receiving is not compulsory');
 assert.match(completeHousehold(w,teen,receive)!,/实际到达/,'approval does not deliver remotely');
 const start={...teen.at},started=w.minute;
 queueSupply(f,teen,findSupplyChoice(w,teen,accept(g.id),'teen independently accepts'));
 assert.deepEqual(teen.at,start);assert.equal(teen.inventory.rodKit??0,0);
 stepWorld(w,.25);assert.equal(teen.inventory.rodKit??0,0);finishSupply(w,teen);
 assert.ok(w.minute-started>5,'travel is additional to five minutes receiving');
 assert.equal(g.status,'delivered');assert.deepEqual(teen.at,home.door);assert.equal(teen.inside,null);
 assert.equal(teen.inventory.rodKit,1);assert.equal(physicalSupplyKitCount(w),1);
 assert.deepEqual(g.segments.map(c=>c.inventory),[{},{}]);assert.equal(carriedSupplyRods(w,teen).length,0);
 assert.ok(completeHousehold(w,teen,receive),'completed gift cannot deliver twice');assert.equal(teen.inventory.rodKit,1);
 assertNoFishing(w,teen);
 const equippedAt=w.minute;
 {
  queueSupply(f,teen,findSupplyChoice(w,teen,equip,'teen separately equips own kit'));
  stepWorld(w,14.75);assert.equal(teen.inventory.rodKit,1);assert.equal(carriedSupplyRods(w,teen).length,0);
  stepWorld(w,.25);assert.equal(teen.lastFailure,null);assert.equal(w.minute-equippedAt,15);
 }
 assert.equal(teen.inventory.rodKit,0);assert.equal(physicalSupplyKitCount(w),0);
 const rod=carriedSupplyRods(w,teen)[0];assert.ok(rod);assert.equal(rod.durability,30);assert.equal(rod.maxDurability,30);
 assert.equal(w.industry!.tools.length,opening.tools.length+1);
 assert.deepEqual(w.industry!.tools.filter(t=>t.id!==rod.id),opening.tools);
 assert.equal(a.inventory.wood,5);assert.equal(a.inventory.fiber,1);assert.equal(a.inventory.rodKit,0);
 assert.equal(b.inventory.wood,opening.adults[1].wood);
 assert.deepEqual(p.credits.map(c=>({ownerId:c.ownerId,meal:c.inventory.meal,coins:c.coins})),[{ownerId:a.id,meal:1,coins:0},{ownerId:b.id,meal:1,coins:0}]);
 assert.deepEqual(w.residents.map(r=>[r.id,r.coins]),opening.coins);
 assert.deepEqual(teen.parents,opening.parents);assert.deepEqual(teen.guardianIds,opening.guardians);
 assertNoFishing(w,teen);stepWorld(w,30);assertNoFishing(w,teen);assert.equal(rod.durability,30);
 const milestones=f.trace.filter(c=>c.action.type==='industry'||c.action.type==='household');
 assert.deepEqual(milestones.map(c=>[c.actorId,c.action.type==='industry'?c.action.recipeId??c.action.operation:c.action.type==='household'?c.action.operation:'unexpected']),[
  [a.id,'fiber'],[a.id,'rod'],[a.id,'create'],[b.id,'respond'],[a.id,'deposit'],[a.id,'proposeGift'],[b.id,'approveGift'],[teen.id,'acceptGift'],[teen.id,'equip'],
 ]);
 assert.equal(f.trace.some(c=>fish(c.action)),false);assert.equal(w.metrics.requests,0);
 assert.ok(w.minute-opening.minute<DAY,'short scripted rule chain, not years of model survival');
 if(origin==='birth-then-synthetic-13'){assert.deepEqual(f.birthEvidence!.inventory,{});assert.equal(f.birthEvidence!.id,teen.id);assert.equal(w.residents.length,10);}
 else assert.equal(w.residents.length,9);
});

test('SQLite reloads before approval, during collection and halfway through equipment preserve source ownership and cannot duplicate kit or rod',()=>{
 let f=supplyFixture('birth-then-synthetic-13');const {p,g}=proposeSupplyKit(f),ids={a:f.a.id,b:f.b.id,teen:f.teen.id,pool:p.id,gift:g.id};
 const store=new WorldStore(':memory:');let committed:number|null=null;
 const reload=()=>{
  store.commit(f.w,committed);committed=f.w.revision;const w=store.load()!;
  f={...f,w,a:w.residents.find(r=>r.id===ids.a)!,b:w.residents.find(r=>r.id===ids.b)!,teen:w.residents.find(r=>r.id===ids.teen)!,home:w.buildings.find(h=>h.id===f.home.id)!};
  return {p:w.household!.pools.find(p=>p.id===ids.pool)!,g:w.household!.gifts.find(g=>g.id===ids.gift)!};
 };
 try{
  let restored=reload();assert.equal(restored.g.status,'proposed');assert.equal(restored.p.credits[0].inventory.rodKit,1);assert.equal(physicalSupplyKitCount(f.w),1);cannotEquipOrFish(f.w,f.teen);
  assert.ok(householdReason(f.w,f.teen,{type:'household',operation:'acceptGift',giftId:ids.gift}));
  approveSupplyKit(f,ids.gift);restored=reload();assert.equal(restored.g.status,'ready');assert.equal(restored.g.segments[0].inventory.rodKit,1);assert.equal(f.teen.inventory.rodKit??0,0);
  const receipt=queueSupply(f,f.teen,findSupplyChoice(f.w,f.teen,accept(ids.gift),'reload receiver accepts'));
  stepWorld(f.w,.25);assert.ok(f.teen.activity);restored=reload();assert.equal(restored.g.status,'ready');assert.equal(f.teen.inventory.rodKit??0,0);finishSupply(f.w,f.teen);
  restored=reload();assert.equal(restored.g.status,'delivered');assert.equal(f.teen.inventory.rodKit,1);assert.equal(physicalSupplyKitCount(f.w),1);
  assert.ok(submitPlan(f.w,receipt).ok);stepWorld(f.w,.25);assert.equal(f.teen.inventory.rodKit,1);assert.equal(f.teen.plan,null);
  const equipment=queueSupply(f,f.teen,findSupplyChoice(f.w,f.teen,equip,'reload recipient chooses equipment'));stepWorld(f.w,7.5);
  reload();assert.equal(f.teen.activity!.remaining,7.5);assert.equal(f.teen.inventory.rodKit,1);assert.equal(carriedSupplyRods(f.w,f.teen).length,0);
  stepWorld(f.w,7.25);assert.equal(f.teen.inventory.rodKit,1);stepWorld(f.w,.25);assert.equal(f.teen.inventory.rodKit,0);assert.equal(carriedSupplyRods(f.w,f.teen).length,1);
  reload();assert.equal(physicalSupplyKitCount(f.w),0);assert.equal(carriedSupplyRods(f.w,f.teen).length,1);assertNoFishing(f.w,f.teen);
  assert.ok(submitPlan(f.w,equipment).ok);stepWorld(f.w,15);assert.equal(physicalSupplyKitCount(f.w),0);assert.equal(carriedSupplyRods(f.w,f.teen).length,1);assertNoFishing(f.w,f.teen);
  assert.equal(f.a.inventory.wood,5);assert.equal(f.a.inventory.fiber,1);assert.equal(f.b.inventory.wood,2);
 }finally{store.close();}
});

test('teen authority remains receive or refuse only before and after donor approval; adult craft, deposit and signatures stay forbidden',()=>{
 const f=supplyFixture(),{w,a,b,teen,home}=f,{p,g}=proposeSupplyKit(f);
 const forbidden:Action[]=[
  {type:'industry',operation:'craft',recipeId:'rod',buildingId:home.id,minutes:45},
  {type:'household',operation:'create',targetId:a.id,buildingId:home.id,name:'not adult',amount:0,item:'meal',quantity:1},
  {type:'household',operation:'respond',poolId:p.id,accept:true},
  {type:'household',operation:'deposit',poolId:p.id,amount:0,item:'rodKit',quantity:1},
  {type:'household',operation:'withdraw',poolId:p.id,amount:0,item:'rodKit',quantity:1},
  {type:'household',operation:'proposeGift',poolId:p.id,targetId:b.id,amount:0,item:'rodKit',quantity:1,ownPercent:100},
  {type:'household',operation:'approveGift',giftId:g.id},
 ];
 for(const approved of [false,true]){
  if(approved)approveSupplyKit(f,g.id);
  for(const action of forbidden){
   assert.equal(ageAllowsChoice(13,action),false);
   assert.equal(submitPlan(w,{id:`forbidden:${approved}:${action.type}:${'operation'in action?action.operation:''}`,actorId:teen.id,actorRevision:teen.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'negative age boundary',actions:[structuredClone(action)]}).ok,false);
   if(action.type==='household')assert.ok(householdReason(w,teen,action));else if(action.type==='industry')assert.ok(industryTarget(w,teen,structuredClone(action)).error);
  }
  assert.ok(householdOpportunities(w,teen).every(c=>c.action.type==='household'&&['acceptGift','declineGift'].includes(c.action.operation)));
  assert.equal(teen.inventory.rodKit??0,0);assert.equal(physicalSupplyKitCount(w),1);cannotEquipOrFish(w,teen);
 }
});

for(const unavailable of ['absent','underage','no-decision','no-expression','outside'] as const)test(`the present household route requires two qualified adult members (${unavailable}); it is not a universal supplier`,()=>{
 const f=supplyFixture(),{w,a,b,teen,home}=f;
 // Negative fixture changes only the prospective second adult's eligibility.
 if(unavailable==='absent')w.residents=w.residents.filter(r=>r.id!==b.id);
 if(unavailable==='underage')b.bornAt=teen.bornAt;
 if(unavailable==='no-decision')b.canDecide=false;
 if(unavailable==='no-expression')b.canExpress=false;
 if(unavailable==='outside')b.residency='outside';
 const action:HouseholdAction={type:'household',operation:'create',targetId:b.id,buildingId:home.id,name:'two adults required',amount:0,item:'meal',quantity:1};
 assert.ok(householdReason(w,a,action));assert.ok(completeHousehold(w,a,action));
 assert.equal(householdOpportunities(w,a).some(c=>c.action.type==='household'&&c.action.operation==='create'),false);
 assert.equal(supplyMenu(w,a).some(c=>c.action.type==='household'&&c.action.operation==='create'),false);
 assert.equal(w.household!.pools.length,0);assert.equal(w.household!.gifts.length,0);
 assert.equal(a.inventory.meal,1);assert.equal(b.inventory.meal,1);assert.equal(teen.inventory.rodKit??0,0);assert.equal(physicalSupplyKitCount(w),0);
});
