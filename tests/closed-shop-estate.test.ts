import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {advanceEconomy,completeEconomy,totalCoins,economyReason,moveCoins} from '../src/world/economy.js';
import {advancePremises,completePremises,premisesReason} from '../src/world/premises.js';
import {initializeProduction,advanceProduction,completeProduction,productionTarget,emergencyEstateOptions} from '../src/world/production.js';
import {pendingEstateReturns} from '../src/world/estate-pending.js';
import {estateGoods,ownedEstateParcels,estateParcels} from '../src/world/estate-custody.js';
import {initializeFood,foodTransaction,foodContainers} from '../src/world/food.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeDebt,completeDebt,debtReason} from '../src/world/debt.js';
import {recordDeath} from '../src/world/life.js';
import {physiologyDefaults} from '../src/shared/physiology.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PremisesTerms} from '../src/shared/premises.js';

const terms:PremisesTerms={days:2,rentPerDay:2,deposit:3,station:'table',startMinute:360,durationMinutes:720};
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.resources=[];
 w.residents.push({...structuredClone(w.residents[2]),id:'other-heir',name:'另一名成年人'});
 const [landlord,owner,heir,other]=w.residents;
 const site={...structuredClone(w.buildings.find(b=>b.ownerId===landlord.id)!),id:'estate-rental',name:'遗产测试店面',kind:'store' as const,residents:[],capacity:0};w.buildings.push(site);
 // This contract/custody fixture isolates long clock progression from unattended hunger.
 w.definitions['life/physiology@98']={id:'life/physiology',version:98,kind:'life',dependencies:[],data:{...physiologyDefaults,hungerPerMinute:0,energyPerMinute:0}};
 for(const p of w.residents){p.at={...site.door};p.inside=null;p.roomAt=null;p.parents=[];p.adoptiveParents=[];p.relations=[];p.bornAt=w.minute-30*YEAR;p.inventory={};p.coins=100;p.hunger=0;p.energy=p.health=100;p.plan=null;p.activity=null;p.physiologyDefinition='life/physiology@98';p.knownPeople=w.residents.map(r=>r.id);p.knownBuildings=w.buildings.map(b=>b.id);}
 heir.parents=[owner.id];owner.inventory={wood:8};advancePremises(w);initializeProduction(w);initializeForeignTrade(w);initializeFood(w);
 return {w,landlord,owner,heir,other,site};
}
function run(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`closed-shop:${w.revision}:${r.id}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离测试中本人明确选择办理或取回自己的物品',actions:[a]});assert.equal(result.ok,true,JSON.stringify(result));let left=1000;while(r.plan||r.activity){assert.ok(left-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function shop(f:ReturnType<typeof fixture>,real=false){const {w,landlord,owner,site}=f;const act=(r:Resident,a:Action)=>real?run(w,r,a):assert.equal(a.type==='premises'?completePremises(w,r,a):completeEconomy(w,r,a as never),null);
 act(landlord,{type:'premises',operation:'offer',buildingId:site.id,tenantId:owner.id,terms});const lease=w.economy!.leases!.at(-1)!;
 act(owner,{type:'premises',operation:'accept',leaseId:lease.id});act(owner,{type:'economy',operation:'open',buildingId:site.id});const b=w.economy!.businesses.at(-1)!;
 act(owner,{type:'economy',operation:'stock',businessId:b.id,item:'wood',quantity:8});return {b,lease};
}
function close(f:ReturnType<typeof fixture>){const result=shop(f);f.w.minute=result.lease.endsAt!;advancePremises(f.w);advanceEconomy(f.w);return result.b;}
function reload(w:World){const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();return restored;}
function wood(w:World){return [...foodContainers(w)].filter(([id])=>id.startsWith('estate')||id.startsWith('business:')||w.residents.some(r=>id==='person:'+r.id)).reduce((n,[,b])=>n+(b.wood??0),0);}
function inherit(w:World,r:Resident,id:string){const action={type:'production' as const,operation:'inherit' as const,personId:id},target=productionTarget(w,r,action);assert.equal(target.error,undefined);r.at={...target.target};r.inside=null;assert.equal(completeProduction(w,r,action),null);}

test('real lease expiry then owner death seals eight wood, requires explicit heir collection, and frees the landlord to lease again after reload',()=>{
 const f=fixture(),{w,owner,heir,landlord,other,site}=f,{b,lease}=shop(f,true),money=totalCoins(w);
 stepWorld(w,lease.endsAt!-w.minute);assert.notEqual(b.closedAt,null);assert.equal(b.inventory.wood,8);
 owner.health=0;stepWorld(w,1);assert.equal(owner.status,'dead');
 assert.deepEqual(b.inventory,{});assert.equal(estateGoods(w,owner.id).wood,8);assert.equal(site.ownerId,landlord.id);assert.equal(heir.inventory.wood??0,0);
 assert.ok(economyReason(w,landlord,{type:'economy',operation:'retrieve',businessId:b.id,item:'wood',quantity:8}));
 run(w,heir,{type:'production',operation:'inherit',personId:owner.id});assert.equal(heir.inventory.wood??0,0);assert.equal(w.estates.find(e=>e.personId===owner.id)!.status,'settled');
 const saved=reload(w),child=saved.residents.find(r=>r.id===heir.id)!;stepWorld(saved,3*DAY);
 const parcel=ownedEstateParcels(saved,child).find(p=>p.inventory.wood===8)!;assert.ok(parcel);assert.deepEqual(parcel.location.at,site.door);assert.equal(wood(saved),8);assert.equal(totalCoins(saved),money);
 assert.ok(completeProduction(saved,saved.residents.find(r=>r.id===landlord.id)!,{type:'production',operation:'collectEstate',parcelId:parcel.id}));
 run(saved,child,{type:'production',operation:'collectEstate',parcelId:parcel.id});assert.equal(child.inventory.wood,8);assert.equal(wood(saved),8);
 const lessor=saved.residents.find(r=>r.id===landlord.id)!;lessor.at={...site.door};assert.equal(premisesReason(saved,lessor,{type:'premises',operation:'offer',buildingId:site.id,tenantId:other.id,terms}),null);
 const count=saved.economy!.transferCount;advanceEconomy(saved);advanceProduction(saved);assert.equal(saved.economy!.transferCount,count);assert.equal(wood(saved),8);
});

test('death before the economic sweep blocks inheritance while closed stock remains, and missing premises never teleport it',()=>{
 const f=fixture(),b=close(f);recordDeath(f.w,f.owner);assert.match(pendingEstateReturns(f.w,f.owner.id)??'',/经营财产/);
 assert.ok(productionTarget(f.w,f.heir,{type:'production',operation:'inherit',personId:f.owner.id}).error);
 const index=f.w.buildings.findIndex(p=>p.id===f.site.id);f.w.buildings.splice(index,1);assert.doesNotThrow(()=>advanceEconomy(f.w));assert.equal(b.inventory.wood,8);assert.ok(pendingEstateReturns(f.w,f.owner.id));
 f.w.buildings.push(f.site);advanceEconomy(f.w);assert.equal(pendingEstateReturns(f.w,f.owner.id),null);assert.equal(estateGoods(f.w,f.owner.id).wood,8);
});


// Reproduce the already-written legacy omission while using real registration:
// only for the fixture, hide the closed-shop bag from the pre-fix estate census.
function legacySplit(f:ReturnType<typeof fixture>,accept:Resident[]){
 const b=close(f),omitted=b.inventory;b.inventory={};recordDeath(f.w,f.owner);
 for(const heir of accept)inherit(f.w,heir,f.owner.id);
 b.inventory=omitted;return b;
}

test('an already settled legacy estate recovers omitted shop stock through a new explicit share without replaying old rights',()=>{
 const f=fixture(),b=legacySplit(f,[f.heir]),before=JSON.stringify(f.w.production!.inheritances[f.owner.id].shares),money=totalCoins(f.w);
 assert.equal(f.w.estates[0].status,'settled');const w=reload(f.w),heir=w.residents.find(p=>p.id===f.heir.id)!;
 advanceEconomy(w);advanceProduction(w);
 assert.equal(w.economy!.businesses.find(p=>p.id===b.id)!.inventory.wood??0,0);
 const shares=w.production!.inheritances[f.owner.id].shares;assert.equal(JSON.stringify(shares.slice(0,1)),before);assert.equal(shares.length,2);assert.equal(shares[1].inventory.wood,8);assert.equal(shares[1].claimedAt,null);
 assert.equal(heir.inventory.wood??0,0);assert.equal(w.estates[0].status,'protected');assert.equal(totalCoins(w),money);assert.equal(wood(w),8);
 assert.equal(ownedEstateParcels(w,heir).some(p=>p.inventory.wood===8),false);
 inherit(w,heir,f.owner.id);const p=ownedEstateParcels(w,heir).find(p=>p.inventory.wood===8)!;assert.ok(p);
 const count=shares.length;advanceEconomy(w);advanceProduction(w);assert.equal(shares.length,count);assert.equal(wood(w),8);
 run(w,heir,{type:'production',operation:'collectEstate',parcelId:p.id});assert.equal(heir.inventory.wood,8);assert.equal(w.estates[0].status,'settled');assert.equal(totalCoins(w),money);
});

test('legacy supplements preserve accepted and unaccepted branches, then use the deceased recipients own spouse fallback',()=>{
 const f=fixture();f.other.parents=[f.owner.id];legacySplit(f,[f.heir]);
 const child:Resident={...structuredClone(f.heir),id:'branch-child',name:'后代',parents:[f.other.id],adoptiveParents:[],relations:[],inventory:{},coins:0};f.w.residents.push(child);
 f.other.at={...f.heir.at};recordDeath(f.w,f.other);advanceProduction(f.w);
 const spouse=f.landlord;f.heir.relations=[{targetId:spouse.id,partner:'married'} as never];spouse.relations=[{targetId:f.heir.id,partner:'married'} as never];recordDeath(f.w,f.heir);
 const original=JSON.stringify(f.w.production!.inheritances[f.owner.id].shares);advanceEconomy(f.w);advanceProduction(f.w);
 const shares=f.w.production!.inheritances[f.owner.id].shares;assert.equal(JSON.stringify(shares.filter(s=>!s.id.startsWith('supplement:'))),original);
 const extra=shares.filter(s=>s.id.startsWith('supplement:'));assert.equal(extra.find(s=>s.heirId===child.id)!.inventory.wood,4);assert.equal(extra.find(s=>s.heirId===spouse.id)!.inventory.wood,4);
 assert.equal(wood(f.w),8);assert.equal(spouse.inventory.wood??0,0);assert.equal(child.inventory.wood??0,0);
});

test('legacy supplements retain the half-share of a deceased original heir across two children rather than flattening all recipients',()=>{
 const f=fixture();f.other.parents=[f.owner.id];legacySplit(f,[f.heir]);
 for(const id of ['branch-a','branch-b'])f.w.residents.push({...structuredClone(f.heir),id,name:id,parents:[f.other.id],adoptiveParents:[],relations:[],inventory:{},coins:0});
 recordDeath(f.w,f.other);advanceProduction(f.w);advanceEconomy(f.w);advanceProduction(f.w);
 const extra=f.w.production!.inheritances[f.owner.id].shares.filter(s=>s.id.startsWith('supplement:'));
 assert.equal(extra.find(s=>s.heirId===f.heir.id)!.inventory.wood,4);assert.equal(extra.find(s=>s.heirId==='branch-a')!.inventory.wood,2);assert.equal(extra.find(s=>s.heirId==='branch-b')!.inventory.wood,2);assert.equal(wood(f.w),8);
});

test('closed-shop food keeps its original life through sealing, inheritance, collection and reload',()=>{
 const f=fixture(),{b,lease}=shop(f);f.owner.inventory.berry=4;
 assert.equal(completeEconomy(f.w,f.owner,{type:'economy',operation:'stock',businessId:b.id,item:'berry',quantity:4}),null);
 const expiry=f.w.food!.lots['business:'+b.id].berry![0].expiresAt;
 f.w.minute=lease.endsAt!;advancePremises(f.w);advanceEconomy(f.w);f.w.minute++;recordDeath(f.w,f.owner);advanceEconomy(f.w);
 const sealed=estateParcels(f.w).find(p=>p.inventory.berry===4)!;assert.equal(f.w.food!.lots[sealed.id].berry![0].expiresAt,expiry);
 inherit(f.w,f.heir,f.owner.id);const p=ownedEstateParcels(f.w,f.heir).find(p=>p.inventory.berry===4)!;assert.equal(f.w.food!.lots[p.id].berry![0].expiresAt,expiry);
 const w=reload(f.w),heir=w.residents.find(p=>p.id===f.heir.id)!;run(w,heir,{type:'production',operation:'collectEstate',parcelId:p.id});assert.equal(w.food!.lots['person:'+heir.id].berry![0].expiresAt,expiry);
});


test('cash debt settlement waits for the closed shop census and never seizes retained goods or moves a debt onto the heir',()=>{
 const f=fixture(),{w,landlord,owner,heir}=f,hall=w.buildings.find(b=>b.kind==='lodge')!;initializeDebt(w);
 for(const p of [owner,landlord])p.at={...hall.door};
 assert.equal(completeDebt(w,landlord,{type:'debt',operation:'lend',targetId:owner.id,buildingId:hall.id,principal:10,repayment:12,days:3}),null);
 const loan=w.debt!.loans[0];assert.equal(completeDebt(w,owner,{type:'debt',operation:'respond',loanId:loan.id,accept:true}),null);
 for(const p of [owner,landlord])p.at={...f.site.door};close(f);recordDeath(w,owner);landlord.at={...hall.door};const money=totalCoins(w);
 const action={type:'debt' as const,operation:'settleEstate' as const,targetId:owner.id,buildingId:hall.id};assert.match(debtReason(w,landlord,action)??'',/经营财产/);assert.equal(loan.repaid,0);
 advanceEconomy(w);assert.equal(completeDebt(w,landlord,action),null);assert.equal(loan.repaid,12);assert.equal(estateGoods(w,owner.id).wood,8);assert.equal(totalCoins(w),money);
 inherit(w,heir,owner.id);assert.ok(!w.debt!.loans.some(l=>l.borrowerId===heir.id));assert.equal(heir.inventory.wood??0,0);assert.equal(ownedEstateParcels(w,heir).find(p=>p.inventory.wood===8)!.inventory.wood,8);
});

test('later actual returns to a closed shop receive a separate claim once, without replaying accepted shares or cash',()=>{
 const f=fixture(),b=legacySplit(f,[f.heir]);f.other.inventory.wood=2;advanceEconomy(f.w);advanceProduction(f.w);inherit(f.w,f.heir,f.owner.id);
 const before=JSON.stringify(f.w.production!.inheritances[f.owner.id].shares),money=totalCoins(f.w),cash=f.heir.coins;
 foodTransaction(f.w,()=>{f.other.inventory.wood!-=2;b.inventory.wood=2;});
 assert.ok(moveCoins(f.w,`resident:${f.other.id}`,`business:${b.id}`,8,'隔离测试的既有实际退款','closed-shop-return'));
 const w=reload(f.w),heir=w.residents.find(p=>p.id===f.heir.id)!;advanceEconomy(w);advanceProduction(w);
 const shares=w.production!.inheritances[f.owner.id].shares;assert.equal(JSON.stringify(shares.slice(0,2)),before);assert.equal(shares.length,3);assert.equal(shares[2].inventory.wood,2);assert.equal(shares[2].coins,8);
 inherit(w,heir,f.owner.id);assert.equal(heir.coins,cash+8);advanceEconomy(w);advanceProduction(w);assert.equal(shares.length,3);assert.equal(totalCoins(w),money);assert.equal(wood(w),10);
});

test('a deceased supplemental recipient without successors keeps that branch protected rather than enriching an unrelated resident',()=>{
 const f=fixture();legacySplit(f,[f.heir]);recordDeath(f.w,f.heir);advanceEconomy(f.w);advanceProduction(f.w);
 const extra=f.w.production!.inheritances[f.owner.id].shares.filter(s=>s.id.startsWith('supplement:'));
 assert.equal(extra.find(s=>s.heirId===f.heir.id)!.inventory.wood,8);assert.equal(extra.some(s=>s.heirId===f.other.id),false);assert.equal(wood(f.w),8);
 const w=reload(f.w);advanceProduction(w);assert.equal(w.estates.find(e=>e.personId===f.owner.id)!.status,'protected');assert.ok(productionTarget(w,w.residents.find(r=>r.id===f.landlord.id)!,{type:'production',operation:'inherit',personId:f.owner.id}).error);
});

test('legacy missing goodsClaims migration cannot give an accepted coheirs recovered stock to the remaining claimant',()=>{
 const f=fixture();f.other.parents=[f.owner.id];legacySplit(f,[f.heir]);
 const saved=f.w.production!.inheritances[f.owner.id];delete saved.shares.find(s=>s.claimedAt===null)!.goodsClaims;
 advanceEconomy(f.w);advanceProduction(f.w);
 const extra=saved.shares.filter(s=>s.id.startsWith('supplement:'));assert.equal(extra.find(s=>s.heirId===f.heir.id)?.inventory.wood,4);assert.equal(extra.find(s=>s.heirId===f.other.id)?.inventory.wood,4);
 assert.equal(saved.shares.find(s=>s.heirId===f.other.id&&!s.id.startsWith('supplement:'))!.goodsClaims?.length,0);assert.equal(wood(f.w),8);
});


test('a minors supplemental food is accessible behind an empty original claim without taking the coheirs ration',()=>{
 const f=fixture();f.other.parents=[f.owner.id];const b=legacySplit(f,[f.other]);b.inventory.berry=4;initializeFood(f.w);
 f.heir.bornAt=f.w.minute-12*YEAR;f.heir.physiologyDefinition='life/physiology@1';advanceEconomy(f.w);advanceProduction(f.w);
 const shares=f.w.production!.inheritances[f.owner.id].shares,original=shares.find(s=>s.heirId===f.heir.id&&!s.id.startsWith('supplement:'))!,supplement=shares.find(s=>s.heirId===f.heir.id&&s.id.startsWith('supplement:'))!,coheir=shares.find(s=>s.heirId===f.other.id&&s.id.startsWith('supplement:'))!;
 const before=JSON.stringify(f.w),option=emergencyEstateOptions(f.w,f.heir).find(o=>o.inventory.berry)!;assert.ok(option);assert.equal(JSON.stringify(f.w),before);
 f.heir.at={...option.location.at};assert.equal(completeProduction(f.w,f.heir,option.action),null);assert.equal(f.heir.inventory.berry,2);assert.equal(supplement.inventory.berry,0);assert.equal(original.inventory.berry??0,0);assert.equal(coheir.inventory.berry,2);assert.equal(f.w.estates[0].status,'protected');
});
