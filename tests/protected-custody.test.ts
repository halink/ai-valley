import {initializeFunerary} from '../src/world/funerary.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {recordDeath} from '../src/world/life.js';
import {initializeProduction,completeProduction} from '../src/world/production.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeFood,foodContainers,advanceFood} from '../src/world/food.js';
import {custodyOpportunities,custodyReason,advanceProtectedCustody} from '../src/world/protected-custody.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {estateParcel} from '../src/world/estate-custody.js';
import {roomLayout} from '../src/shared/rooms.js';

import {DAY,YEAR} from '../src/world/time.js';
import type {ProductionAction} from '../src/shared/production.js';
import type {Action,Resident,World} from '../src/shared/types.js';

function setup(w=createWorld()){w.mode='formal';w.clock.paused=false;w.resources=[];
 const [dead,child,provider]=w.residents;
 const reviewer=w.residents[3]??{...structuredClone(provider),id:'reviewer',name:'独立复核人',homeId:null},buyer=w.residents[4]??{...structuredClone(provider),id:'buyer',name:'购买人',homeId:null};if(!w.residents.includes(reviewer))w.residents.push(reviewer,buyer);
 const home=w.buildings.find(b=>b.id===dead.homeId)!;
 for(const r of w.residents){r.at={...home.door};r.inside=null;r.roomAt=null;r.inventory={water:8,fodder:8,wood:8,stone:8,meal:5};r.coins=40;r.hunger=20;r.energy=r.health=100;r.bornAt=w.minute-30*YEAR;r.knownPeople=w.residents.map(p=>p.id);r.knownBuildings=w.buildings.map(b=>b.id);r.parents=[];r.adoptiveParents=[];r.guardianIds=[];r.relations=[];r.canDecide=r.canExpress=true;}
 child.bornAt=w.minute-10*YEAR;child.parents=[dead.id];child.homeId=home.id;home.residents.push(child.id);home.condition=70;
 w.plots=[{id:'protected-field',at:{x:27,y:27},ownerId:dead.id,crop:{definition:'crop/turnip@2',planted:w.minute-5*DAY,growth:4,wateredDay:-1,lastGrowthDay:Math.floor(w.minute/DAY)}}];
 initializeEconomy(w);initializeForeignTrade(w);initializeProduction(w);initializeIndustry(w);initializeRooms(w);initializeFood(w);recordDeath(w,dead);
 return {w,dead,child,provider,reviewer,buyer,home,plot:w.plots[0]};
}
const mandates=(w:World)=>w.production!.protectedCustody!.mandates;
function choice(w:World,r:Resident,op:ProductionAction['operation'],predicate:(a:ProductionAction)=>boolean=()=>true):ProductionAction{
 const row=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='production'&&c.action.operation===op&&predicate(c.action));
 assert.ok(row,`${r.id} normal menu missing ${op}; available custody: ${custodyOpportunities(w,r).map(c=>(c.action as ProductionAction).operation)}`);return row.action as ProductionAction;
}
function run(w:World,r:Resident,action:Action){
 const p={id:`custody-test:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人分别决定受保护临时代管的一项行动',actions:[action]};
 assert.equal(submitPlan(w,p).ok,true);let steps=500;while(r.plan||r.activity){assert.ok(steps-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);return p;
}
function activate(f:ReturnType<typeof setup>){const {w,provider,reviewer,child}=f;
 run(w,provider,choice(w,provider,'custodyOffer',a=>a.reviewerId===reviewer.id));
 const c=mandates(w)[0];assert.equal(c.status,'offered');assert.equal(w.production!.inheritances[f.dead.id],undefined);
 run(w,child,choice(w,child,'custodyAccept'));assert.equal(c.status,'offered');
 run(w,reviewer,choice(w,reviewer,'custodyReview'));assert.equal(c.status,'active');return c;
}
const sum=(w:World,item:'turnip'|'milk')=>[...foodContainers(w).values()].reduce((n,b)=>n+(b[item]??0),0);

test('normal menu separately accepts exact custody; actual harvest, repair, independent sale and adult handback conserve rights and money',()=>{
 const f=setup(),{w,provider,child,reviewer,buyer,dead,home,plot}=f,before=JSON.stringify(w),coins=totalCoins(w),rights={parents:[...child.parents],guardians:[...child.guardianIds],home:child.homeId};
 custodyOpportunities(w,provider);assert.equal(JSON.stringify(w),before,'proposal preview is read-only');
 const c=activate(f),share=w.production!.inheritances[dead.id].shares.find(s=>s.heirId===child.id)!;
 assert.ok(c.scope.plots.includes(plot.id));assert.equal(home.ownerId,dead.id);assert.equal(share.claimedAt,null);
 const harvest=choice(w,provider,'custodyHarvest'),n=sum(w,'turnip'),t=w.minute;
 const plan=run(w,provider,harvest);assert.ok(w.minute-t>=20);assert.equal(sum(w,'turnip'),n+12);assert.equal(provider.inventory.turnip??0,0);
 const p=estateParcel(w,share.goodsClaims!.find(id=>id.startsWith('custody-stock:'))!)!;
 assert.deepEqual(p.location.at,plot.at);assert.equal(p.claimId,share.id);assert.equal(p.inventory.turnip,12);assert.equal(plot.ownerId,dead.id);
 const snapshot=JSON.stringify(w);assert.equal(submitPlan(w,plan).ok,true);assert.equal(JSON.stringify(w),snapshot);assert.ok(completeProduction(w,provider,harvest));
 const cash=share.coins,personal=provider.coins,wood=provider.inventory.wood!,stone=provider.inventory.stone!;
 run(w,provider,choice(w,provider,'custodyRepair'));assert.equal(c.spent,3);assert.equal(share.coins,cash-3);assert.equal(provider.coins,personal+3);assert.equal(provider.inventory.wood,wood-2);assert.equal(provider.inventory.stone,stone-1);assert.ok(home.condition>89);assert.equal(home.ownerId,dead.id);
 run(w,provider,choice(w,provider,'custodySell'));const sale=w.production!.protectedCustody!.sales[0];
 assert.equal(custodyOpportunities(w,provider).some(c=>(c.action as ProductionAction).operation==='custodyBuy'),false);
 assert.equal(custodyOpportunities(w,reviewer).some(c=>(c.action as ProductionAction).operation==='custodyBuy'),false);
 buyer.at={...p.location.at};const buy=choice(w,buyer,'custodyBuy'),expiry=w.food!.lots[p.id].turnip![0].expiresAt;
 run(w,buyer,buy);assert.equal(buyer.inventory.turnip,12);assert.equal(p.inventory.turnip,0);assert.equal(share.coins,cash-3+24);assert.equal(c.revenue,24);assert.equal(c.sold,12);assert.equal(sale.status,'sold');assert.equal(w.food!.lots['person:'+buyer.id].turnip![0].expiresAt,expiry);assert.equal(totalCoins(w),coins);assert.ok(completeProduction(w,buyer,buy));
 assert.deepEqual({parents:child.parents,guardians:child.guardianIds,home:child.homeId},rights);
 child.bornAt=w.minute-18*YEAR;advanceProtectedCustody(w);assert.equal(c.status,'adult');assert.equal(c.handback?.coins,share.coins);assert.equal(home.ownerId,dead.id);
 child.at={...home.door};assert.equal(completeProduction(w,child,{type:'production',operation:'inherit',personId:dead.id}),null);assert.equal(home.ownerId,child.id);assert.equal(plot.ownerId,child.id);assert.equal(totalCoins(w),coins);
});

test('child objection, independent reviewer withdrawal and hard expiry reject stale work without changing money or materials',()=>{
 for(const end of ['child','reviewer','expiry','adult'] as const){const f=setup(),{w,child,provider,reviewer}=f,c=activate(f),action=choice(w,provider,'custodyRepair'),stock=structuredClone(provider.inventory),money=totalCoins(w);
  if(end==='expiry'){w.minute=c.expiresAt;advanceProtectedCustody(w);}else if(end==='adult'){child.bornAt=w.minute-18*YEAR;advanceProtectedCustody(w);}else run(w,end==='child'?child:reviewer,choice(w,end==='child'?child:reviewer,'custodyObject'));
  assert.notEqual(c.status,'active');assert.ok(completeProduction(w,provider,action));assert.deepEqual(provider.inventory,stock);assert.equal(totalCoins(w),money);assert.equal(c.records.length,0);assert.ok(c.handback);
 }
});

test('guardian and child assent are distinct; donor/guardian status cannot replace independent review or create new guardianship',()=>{
 const f=setup(),{w,provider,child,reviewer,buyer}=f;child.guardianIds=[buyer.id];
 run(w,provider,choice(w,provider,'custodyOffer',a=>a.reviewerId===reviewer.id));const c=mandates(w)[0];
 run(w,child,choice(w,child,'custodyAccept'));run(w,reviewer,choice(w,reviewer,'custodyReview'));assert.equal(c.status,'offered');
 assert.equal(custodyOpportunities(w,provider).some(c=>(c.action as ProductionAction).operation==='custodyHarvest'),false);
 run(w,buyer,choice(w,buyer,'custodyAccept'));assert.equal(c.status,'active');assert.deepEqual(child.guardianIds,[buyer.id]);
 child.guardianIds=[];advanceProtectedCustody(w);assert.equal(c.status,'invalid');
 const g=setup();g.child.bornAt=g.w.minute-2*YEAR;assert.equal(custodyOpportunities(g.w,g.provider).some(c=>(c.action as ProductionAction).operation==='custodyOffer'),false,'unaccompanied toddler cannot appoint property/parental authority through food delivery');
});

test('debt, unsettled wages/common property, unborn shares, conflicted review and overlapping mandates block authority',()=>{
 for(const obstruction of ['debt','payroll','household','unborn','reviewer'] as const){const f=setup(),{w,dead,child,provider,reviewer}=f,action=custodyOpportunities(w,provider).map(c=>c.action as ProductionAction).find(a=>a.operation==='custodyOffer'&&a.reviewerId===reviewer.id)!;assert.ok(action);
  if(obstruction==='debt')w.debt={nextSerial:1,totals:{principal:0,repaid:0,collected:0,forgiven:0,writtenOff:0},loans:[{id:'owed',borrowerId:dead.id,ownerId:reviewer.id,status:'active',repayment:9,repaid:0} as never]};
  if(obstruction==='payroll')w.employment={posts:[],contracts:[{employerId:dead.id,workerId:reviewer.id,status:'active',escrowId:'escrow:wage',batch:null} as never]} as never;
  if(obstruction==='household')w.household={nextSerial:1,totals:{deposited:0,withdrawn:0,gifted:0,estateCoins:0},gifts:[],pools:[{id:'joint',status:'open',credits:[{ownerId:dead.id,coins:5,inventory:{wood:1}}]} as never]};
  if(obstruction==='unborn')w.estates[0].heirs.push('unborn:pending');
  if(obstruction==='reviewer')reviewer.parents=[dead.id],w.estates[0].heirs.push(reviewer.id);
  assert.ok(custodyReason(w,provider,action),obstruction);assert.equal(w.production!.inheritances[dead.id],undefined);
 }
 const f=setup(),c=activate(f),old=custodyOpportunities(f.w,f.provider).filter(c=>(c.action as ProductionAction).operation==='custodyOffer');assert.equal(old.length,0);assert.equal(c.status,'active');
});

test('restart preserves exact consent, limits, receipts, original food age and handback without replenishment',()=>{
 const f=setup(),{w,provider,child}=f,c=activate(f);run(w,provider,choice(w,provider,'custodyHarvest'));run(w,provider,choice(w,provider,'custodySell'));
 const saved=new WorldStore(':memory:');saved.commit(w,null);const restored=saved.load()!;saved.close();
 assert.deepEqual(restored.production!.protectedCustody,w.production!.protectedCustody);assert.deepEqual(restored.food,w.food);assert.equal(totalCoins(restored),totalCoins(w));
 const p=restored.residents.find(r=>r.id===provider.id)!,kid=restored.residents.find(r=>r.id===child.id)!;run(restored,kid,choice(restored,kid,'custodyObject'));assert.equal(mandates(restored)[0].status,'objected');assert.equal(restored.production!.protectedCustody!.sales[0].status,'cancelled');
 assert.equal(custodyOpportunities(restored,p).some(c=>(c.action as ProductionAction).operation==='custodyHarvest'),false);
 const legacy=setup().w;delete legacy.production!.protectedCustody;const old=JSON.stringify(legacy);advanceProtectedCustody(legacy);assert.equal(JSON.stringify(legacy),old);
});

test('expense cap, exact sale total, perishable expiry and changing ownership reject with no partial transfer',()=>{
 const f=setup(),{w,provider,child,buyer,home}=f,c=activate(f);
 c.expenseCap=2;const repair:ProductionAction={type:'production',operation:'custodyRepair',custodyId:c.id,custodyStep:0,buildingId:home.id};const snapshot=JSON.stringify({money:totalCoins(w),stock:provider.inventory,condition:home.condition,c});assert.ok(completeProduction(w,provider,repair));assert.equal(JSON.stringify({money:totalCoins(w),stock:provider.inventory,condition:home.condition,c}),snapshot);
 run(w,provider,choice(w,provider,'custodyHarvest'));run(w,provider,choice(w,provider,'custodySell'));const sale=w.production!.protectedCustody!.sales[0],parcel=estateParcel(w,sale.parcelId)!;buyer.at={...parcel.location.at};const buy=choice(w,buyer,'custodyBuy');buy.maxTotal!--;assert.ok(completeProduction(w,buyer,buy));assert.equal(sale.status,'offered');assert.equal(parcel.inventory.turnip,12);
 w.food!.lots[parcel.id].turnip![0].expiresAt=w.minute;assert.ok(completeProduction(w,buyer,{...buy,maxTotal:999}));advanceFood(w);assert.equal(parcel.inventory.turnip,0);assert.equal(c.revenue,0);
 home.ownerId=child.id;advanceProtectedCustody(w);assert.equal(c.status,'invalid');assert.equal(c.spent,0);
});

test('real indoor animal care and products use actual pen, materials and original food lots',()=>{
 const f=setup(),{w,dead,provider,child,reviewer,buyer}=f;
 const barn={...structuredClone(f.home),id:'protected-barn',name:'受保护畜舍',kind:'barn' as const,at:{x:42,y:43},door:{x:45,y:48},definition:'building/barn@1',residents:[],capacity:0,condition:100};w.buildings.push(barn);
 for(const r of [provider,child,reviewer,buyer]){r.at={...barn.door};r.inside=barn.id;r.roomAt={...roomLayout(w,barn).slots.find(s=>s.key==='pen:0')!.at};r.knownBuildings.push(barn.id);}
 w.industry!.animals.push({id:'protected-goat',ownerId:dead.id,kind:'goat',sex:'female',bornAt:w.minute-100*DAY,barnId:barn.id,pen:0,hunger:40,thirst:70,health:100,status:'alive',deathAt:null,product:2,progress:0,pregnancy:null,lastMinute:w.minute});
 initializeFood(w);const expiry=w.food!.lots['animal-stock:protected-goat'].milk![0].expiresAt,c=activate(f),goat=w.industry!.animals[0];assert.deepEqual(c.scope.animals,[goat.id]);
 const water=provider.inventory.water!,coins=totalCoins(w);run(w,provider,choice(w,provider,'custodyWaterAnimal'));assert.equal(provider.inventory.water,water-1);assert.ok(goat.thirst<40);assert.equal(c.spent,1);assert.equal(provider.inside,barn.id);
 const amount=sum(w,'milk');run(w,provider,choice(w,provider,'custodyCollectAnimal'));const p=w.estates[0].parcels!.find(p=>p.source==='custody:'+c.id)!;assert.equal(p.inventory.milk,2);assert.equal(provider.inventory.milk??0,0);assert.equal(sum(w,'milk'),amount);assert.equal(w.food!.lots[p.id].milk![0].expiresAt,expiry);assert.equal(p.location.inside,barn.id);assert.equal(totalCoins(w),coins);
 run(w,provider,choice(w,provider,'custodySell'));buyer.inside=null;buyer.roomAt=null;assert.equal(custodyOpportunities(w,buyer).some(c=>(c.action as ProductionAction).operation==='custodyBuy'),false,'outdoor doorway cannot see or buy indoor stock');
 buyer.inside=barn.id;buyer.roomAt={...p.location.roomAt!};run(w,buyer,choice(w,buyer,'custodyBuy'));assert.equal(buyer.inventory.milk,2);assert.equal(goat.ownerId,dead.id);assert.deepEqual(child.guardianIds,[]);
});

test('another heirs property and balance remain separate; conflicted or missing guardian cannot be silently replaced',()=>{
 const f=setup(),{w,dead,child,provider,buyer,reviewer,plot}=f;
 buyer.parents=[dead.id];w.estates[0].heirs.push(buyer.id);
 const proposal=custodyOpportunities(w,provider).map(c=>c.action as ProductionAction).find(a=>a.operation==='custodyOffer'&&a.reviewerId===reviewer.id)!;
 // Asset allocation is stable by ID, so qiao owns the second estate field.
 w.plots.push({...structuredClone(plot),id:'protected-field-z'});
 const c=activate(f),shares=w.production!.inheritances[dead.id].shares,others=shares.find(s=>s.heirId===buyer.id)!;
 const original={coins:others.coins,inventory:structuredClone(others.inventory),goods:others.goodsClaims!.map(id=>structuredClone(estateParcel(w,id)!))};
 const forbidden:ProductionAction={type:'production',operation:'custodyHarvest',custodyId:c.id,custodyStep:0,plotId:others.plots[0]};assert.ok(completeProduction(w,provider,forbidden));
 run(w,provider,choice(w,provider,'custodyHarvest'));assert.equal(others.coins,original.coins);assert.deepEqual(others.inventory,original.inventory);assert.deepEqual(others.goodsClaims!.map(id=>estateParcel(w,id)),original.goods);
 const s=shares.find(s=>s.heirId===child.id)!;assert.equal(s.inventory.turnip,12);
 const g=setup();g.child.guardianIds=[g.buyer.id];g.buyer.residency='outside';assert.equal(custodyOpportunities(g.w,g.provider).some(c=>(c.action as ProductionAction).operation==='custodyOffer'),false);
});

test('saved in-progress physical work is cancelled by objection and cannot be replayed for reimbursement',()=>{
 const f=setup(),{w,provider,child,home}=f,c=activate(f),action=choice(w,provider,'custodyRepair'),coins=totalCoins(w),stock=structuredClone(provider.inventory);
 const plan={id:'interrupted-custody',actorId:provider.id,actorRevision:provider.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'实际投入修护工时',actions:[action]};assert.equal(submitPlan(w,plan).ok,true);stepWorld(w,5);assert.ok(provider.activity);
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();const p=restored.residents.find(r=>r.id===provider.id)!,kid=restored.residents.find(r=>r.id===child.id)!;
 run(restored,kid,choice(restored,kid,'custodyObject'));let left=100;while(p.activity||p.plan){assert.ok(left-->0);stepWorld(restored,1);}assert.ok(p.lastFailure);assert.equal(totalCoins(restored),coins);assert.deepEqual(p.inventory,stock);assert.equal(mandates(restored)[0].spent,0);assert.equal(mandates(restored)[0].records.length,0);assert.ok(restored.buildings.find(b=>b.id===home.id)!.condition<71);
 assert.equal(submitPlan(restored,plan).ok,true);assert.equal(mandates(restored)[0].spent,0);
});

test('sales capture buyer total including tax; rate changes force a new decision and levy is paid exactly once',()=>{
 const f=setup(),{w,provider,buyer}=f,c=activate(f);run(w,provider,choice(w,provider,'custodyHarvest'));run(w,provider,choice(w,provider,'custodySell'));
 const sale=w.production!.protectedCustody!.sales[0],p=estateParcel(w,sale.parcelId)!;buyer.at={...p.location.at};const stale=choice(w,buyer,'custodyBuy');
 w.civic!.salesTax={proposalId:'custody-test-tax',basisPoints:1000,expiresAt:w.minute+DAY};const coins=totalCoins(w),treasury=w.economy!.treasury,before=buyer.coins;
 assert.ok(completeProduction(w,buyer,stale));assert.equal(sale.status,'offered');assert.equal(buyer.coins,before);
 const chosen=choice(w,buyer,'custodyBuy');assert.equal(chosen.maxTotal,26);run(w,buyer,chosen);assert.equal(w.economy!.treasury,treasury+2);assert.equal(c.revenue,24);assert.equal(buyer.coins,before-26);assert.equal(totalCoins(w),coins);assert.ok(completeProduction(w,buyer,chosen));assert.equal(w.economy!.treasury,treasury+2);
});

test('child objection after custody work records handback',()=>{
 const f=setup(),{w,provider,child}=f,c=activate(f);run(w,provider,choice(w,provider,'custodyHarvest'));run(w,child,choice(w,child,'custodyObject'));
 const before=JSON.stringify(w);assert.equal(JSON.stringify(w),before);assert.ok(c.handback);
 child.name='<script>bad</script>';
});

test('isolated nine-founder formal world offers and executes custody without adding population, stock or guardians',()=>{
 const f=setup(createFrontierWorld()),{w,home,provider,child,plot}=f;assert.equal(w.residents.length,9);
 // Preserve the formal map; put the isolated mature field on a known walkable doorway tile.
 plot.at={...home.door};const count=w.residents.length,coins=totalCoins(w),c=activate(f);
 const before=sum(w,'turnip');run(w,provider,choice(w,provider,'custodyHarvest'));assert.ok(sum(w,'turnip')>before);assert.equal(w.residents.length,count);assert.equal(totalCoins(w),coins);assert.deepEqual(child.guardianIds,[]);assert.equal(c.status,'active');
});

test('a child reaching six stops a former guardian-only mandate until the child independently accepts a new one',()=>{
 const f=setup(),{w,provider,child,reviewer,buyer}=f;child.bornAt=w.minute-6*YEAR+30;child.guardianIds=[buyer.id];
 run(w,provider,choice(w,provider,'custodyOffer',a=>a.reviewerId===reviewer.id));run(w,buyer,choice(w,buyer,'custodyAccept'));run(w,reviewer,choice(w,reviewer,'custodyReview'));
 const c=mandates(w)[0];assert.equal(c.status,'active');assert.ok(!c.acceptedBy.includes(child.id));const stale=choice(w,provider,'custodyRepair');
 w.minute=child.bornAt+6*YEAR;advanceProtectedCustody(w);assert.equal(c.status,'invalid');assert.ok(completeProduction(w,provider,stale));assert.equal(c.spent,0);
 run(w,provider,choice(w,provider,'custodyOffer',a=>a.reviewerId===reviewer.id));run(w,buyer,choice(w,buyer,'custodyAccept'));run(w,reviewer,choice(w,reviewer,'custodyReview'));assert.equal(mandates(w)[1].status,'offered');run(w,child,choice(w,child,'custodyAccept'));assert.equal(mandates(w)[1].status,'active');
});

test('reviewer and guardian related buyers are excluded and co-heir financial partners cannot independently review',()=>{
 for(const side of ['reviewer','guardian'] as const){const f=setup(),{w,provider,buyer,reviewer,child}=f;const guardian=side==='guardian'?{...structuredClone(buyer),id:'independent-guardian',name:'另一监护人'}:undefined;if(guardian){w.residents.push(guardian);child.guardianIds=[guardian.id];}
  if(guardian){run(w,provider,choice(w,provider,'custodyOffer',a=>a.reviewerId===reviewer.id));run(w,guardian,choice(w,guardian,'custodyAccept'));run(w,child,choice(w,child,'custodyAccept'));run(w,reviewer,choice(w,reviewer,'custodyReview'));}else activate(f);
  run(w,provider,choice(w,provider,'custodyHarvest'));run(w,provider,choice(w,provider,'custodySell'));const c=mandates(w)[0],sale=w.production!.protectedCustody!.sales[0],p=estateParcel(w,sale.parcelId)!;buyer.at={...p.location.at};const valid=choice(w,buyer,'custodyBuy');
  buyer.relations.push({targetId:side==='reviewer'?reviewer.id:guardian!.id,partner:'married',affection:0,trust:0,conflict:0,evidence:[]});assert.equal(custodyOpportunities(w,buyer).some(c=>(c.action as ProductionAction).operation==='custodyBuy'),false);assert.ok(completeProduction(w,buyer,valid));assert.equal(c.revenue,0);assert.equal(p.inventory.turnip,12);
 }
 const f=setup();f.buyer.parents=[f.dead.id];f.w.estates[0].heirs.push(f.buyer.id);f.reviewer.relations.push({targetId:f.buyer.id,partner:'married',affection:0,trust:0,conflict:0,evidence:[]});
 assert.equal(custodyOpportunities(f.w,f.provider).some(c=>(c.action as ProductionAction).operation==='custodyOffer'&&(c.action as ProductionAction).reviewerId===f.reviewer.id),false);
});

test('remote custody menu uses recorded visits, not live crop maturity or house condition; inspection executes before new work',()=>{
 const f=setup(),{w,provider,plot,home}=f,c=activate(f);provider.at={x:34,y:40};const before=custodyOpportunities(w,provider);
 assert.ok(before.some(c=>(c.action as ProductionAction).operation==='custodyInspect'));assert.ok(!before.some(c=>['custodyRepair','custodyHarvest','custodyWater'].includes((c.action as ProductionAction).operation)));
 home.condition=90;plot.crop!.growth=0;assert.deepEqual(custodyOpportunities(w,provider),before);
 const visit=choice(w,provider,'custodyInspect',a=>a.custodyAssetId===plot.id);run(w,provider,visit);assert.deepEqual(provider.at,plot.at);assert.equal(custodyOpportunities(w,provider).some(c=>(c.action as ProductionAction).operation==='custodyHarvest'),false);assert.equal(c.workSerial,0);
 plot.crop!.growth=4;run(w,provider,choice(w,provider,'custodyHarvest'));assert.equal(c.records[0].operation,'custodyHarvest');
});

test('engine rejects unrelated asset fields instead of repairing or harvesting at the wrong location',()=>{
 for(const kind of ['repair','harvest'] as const){const f=setup(),{w,provider,home,plot}=f,c=activate(f),cash=provider.coins,stock=structuredClone(provider.inventory),action=choice(w,provider,kind==='repair'?'custodyRepair':'custodyHarvest');
  if(kind==='repair')action.plotId=plot.id;else action.buildingId=home.id;
  const plan={id:'wrong-asset:'+kind,actorId:provider.id,actorRevision:provider.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离无关字段防御测试',actions:[action]};assert.equal(submitPlan(w,plan).ok,true);let left=100;while(provider.plan||provider.activity){assert.ok(left-->0);stepWorld(w,1);}assert.match(provider.lastFailure??'',/无关的资产字段/);assert.equal(provider.coins,cash);assert.deepEqual(provider.inventory,stock);assert.equal(c.records.length,0);assert.ok(plot.crop);assert.ok(home.condition<71);
 }
});

test('independent buyer settlement does not invalidate already-started maintenance or duplicate payment',()=>{
 const f=setup(),{w,provider,buyer,home}=f,c=activate(f);run(w,provider,choice(w,provider,'custodyHarvest'));run(w,provider,choice(w,provider,'custodySell'));
 const sale=w.production!.protectedCustody!.sales[0],p=estateParcel(w,sale.parcelId)!,repair=choice(w,provider,'custodyRepair'),money=totalCoins(w),sequence=c.workSerial;
 const plan={id:'repair-while-sale',actorId:provider.id,actorRevision:provider.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'独立维护与买方成交并行',actions:[repair]};assert.equal(submitPlan(w,plan).ok,true);stepWorld(w,3);assert.ok(provider.activity);
 buyer.at={...p.location.at};run(w,buyer,choice(w,buyer,'custodyBuy'));assert.equal(c.workSerial,sequence);let left=100;while(provider.plan||provider.activity){assert.ok(left-->0);stepWorld(w,1);}assert.equal(provider.lastFailure,null);assert.equal(c.spent,3);assert.equal(c.revenue,24);assert.equal(c.workSerial,sequence+1);assert.ok(home.condition>89);assert.equal(totalCoins(w),money);assert.ok(completeProduction(w,provider,repair));assert.equal(c.spent,3);
});

test('unknown remote guardian death cannot silently remove that guardians separate approval',()=>{
 const f=setup(),{w,dead,child,provider,buyer,reviewer}=f;child.guardianIds=[dead.id,buyer.id];buyer.at={x:34,y:60};recordDeath(w,buyer);
 assert.equal(provider.deathKnowledge?.[buyer.id],undefined);assert.equal(custodyOpportunities(w,provider).some(c=>(c.action as ProductionAction).operation==='custodyOffer'),false);
 initializeFunerary(w);provider.at={...buyer.at};const verify=decisionChoices(decisionContext(w,provider)).find(c=>c.action.type==='funerary'&&c.action.operation==='verify'&&c.action.targetId===buyer.id);assert.ok(verify);run(w,provider,verify.action);assert.ok(provider.deathKnowledge?.[buyer.id]);provider.at={...child.at};
 assert.ok(custodyOpportunities(w,provider).some(c=>(c.action as ProductionAction).operation==='custodyOffer'&&(c.action as ProductionAction).reviewerId===reviewer.id));
});

test('recorded barn inspection walks from outdoors into the actual pen without exposing remote animal needs',()=>{
 const f=setup(),{w,dead,provider,child,reviewer}=f;
 const barn={...structuredClone(f.home),id:'inspect-barn',name:'受托牲畜原栏',kind:'barn' as const,at:{x:42,y:43},door:{x:45,y:48},definition:'building/barn@1',residents:[],capacity:0,condition:100};w.buildings.push(barn);
 for(const r of [provider,child,reviewer]){r.at={...barn.door};r.inside=barn.id;r.roomAt={...roomLayout(w,barn).slots.find(s=>s.key==='pen:0')!.at};r.knownBuildings.push(barn.id);}
 const goat={id:'inspect-goat',ownerId:dead.id,kind:'goat' as const,sex:'female' as const,bornAt:w.minute-100*DAY,barnId:barn.id,pen:0,hunger:40,thirst:70,health:100,status:'alive' as const,deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute};w.industry!.animals.push(goat);const c=activate(f);
 provider.inside=null;provider.roomAt=null;provider.at={x:34,y:40};const options=custodyOpportunities(w,provider);goat.thirst=10;assert.deepEqual(custodyOpportunities(w,provider),options,'far away needs cannot alter available custody work');
 const action=choice(w,provider,'custodyInspect',a=>a.custodyAssetId===goat.id),at=w.minute;run(w,provider,action);assert.ok(w.minute-at>10);assert.equal(provider.inside,barn.id);assert.deepEqual(provider.roomAt,roomLayout(w,barn).slots.find(s=>s.key==='pen:0')!.at);assert.equal(custodyOpportunities(w,provider).some(c=>(c.action as ProductionAction).operation==='custodyWaterAnimal'),false);
 goat.thirst=70;run(w,provider,choice(w,provider,'custodyWaterAnimal'));assert.equal(c.spent,1);
});

test('unseen title or guardian changes do not erase the recorded remote inspection or personal withdrawal menu',()=>{
 for(const cause of ['title','guardian'] as const){const f=setup(),{w,provider,home,child,buyer}=f,c=activate(f);provider.at={x:34,y:40};const before=custodyOpportunities(w,provider);
  if(cause==='title')home.ownerId=child.id;else child.guardianIds=[buyer.id];advanceProtectedCustody(w);assert.equal(c.status,'invalid');assert.deepEqual(custodyOpportunities(w,provider),before);
  const declaration=choice(w,provider,'custodyEnd');run(w,provider,declaration);assert.ok(c.endKnownBy.includes(provider.id));assert.equal(c.spent,0);assert.match(w.events.at(-1)!.text,/声明终止/);assert.doesNotMatch(w.events.at(-1)!.text,/监护关系已变化|资产.*变化/);
 }
});

test('unseen animal death retains the original barn visit but actual arrival cannot enter under ended authority',()=>{
 const f=setup(),{w,dead,provider,child,reviewer}=f;
 const barn={...structuredClone(f.home),id:'ended-inspect-barn',name:'原受托畜舍',kind:'barn' as const,at:{x:42,y:43},door:{x:45,y:48},definition:'building/barn@1',residents:[],capacity:0,condition:100};w.buildings.push(barn);
 for(const r of [provider,child,reviewer]){r.at={...barn.door};r.inside=barn.id;r.roomAt={...roomLayout(w,barn).slots.find(s=>s.key==='pen:0')!.at};r.knownBuildings.push(barn.id);}
 w.industry!.animals.push({id:'ended-goat',ownerId:dead.id,kind:'goat',sex:'female',bornAt:w.minute-100*DAY,barnId:barn.id,pen:0,hunger:40,thirst:70,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute});const c=activate(f);
 provider.inside=null;provider.roomAt=null;provider.at={x:34,y:40};const before=custodyOpportunities(w,provider),goat=w.industry!.animals[0];goat.status='dead';goat.deathAt=w.minute;advanceProtectedCustody(w);assert.equal(c.status,'invalid');assert.deepEqual(custodyOpportunities(w,provider),before);
 const action=choice(w,provider,'custodyInspect',a=>a.custodyAssetId===goat.id),start=w.minute;
 assert.equal(submitPlan(w,{id:'ended-barn-inspection',actorId:provider.id,actorRevision:provider.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人只按原已知位置前往查看',actions:[action]}).ok,true);let left=200;while(provider.plan||provider.activity){assert.ok(left-->0);stepWorld(w,1);}assert.ok(w.minute-start>5);assert.deepEqual(provider.at,barn.door);assert.equal(provider.inside,null);assert.match(provider.lastFailure??'',/到原址后未能核实/);assert.ok(c.endKnownBy.includes(provider.id));assert.equal(c.spent,0);
});
