import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {recordDeath} from '../src/world/life.js';
import {initializeProduction,advanceProduction,completeProduction,estateHeirs,productionTarget,productionParcels} from '../src/world/production.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {estateParcels,estateStock,estateLocation,ownedEstateParcels} from '../src/world/estate-custody.js';
import {foodTransaction,initializeFood,foodContainers} from '../src/world/food.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeDebt,completeDebt} from '../src/world/debt.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR,DAY} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.minute=600;w.clock.paused=false;w.resources=[];
 const [parent,adult,minor]=w.residents,home=w.buildings.find(b=>b.id===parent.homeId)!;
 for(const p of w.residents){p.at={...home.door};p.inside=null;p.roomAt=null;p.parents=[];p.adoptiveParents=[];p.relations=[];p.guardianIds=[];p.pregnancy=null;p.bornAt=w.minute-30*YEAR;p.inventory={};p.coins=0;p.hunger=0;p.energy=p.health=100;p.plan=null;p.activity=null;p.canDecide=p.canExpress=true;p.knownPeople=w.residents.map(r=>r.id);p.knownBuildings=w.buildings.map(b=>b.id);}
 adult.parents=[parent.id];minor.parents=[parent.id];minor.bornAt=w.minute-10*YEAR;
 parent.coins=20;parent.inventory={wood:7,meal:6};
 w.plots=w.plots.filter(p=>p.ownerId===parent.id);assert.equal(w.plots.length,6);
 initializeEconomy(w);initializeProduction(w);initializeForeignTrade(w);initializeFood(w);
 return {w,parent,adult,minor,home};
}
function person(w:World,id:string):Resident {
 const p:Resident={...structuredClone(w.residents[1]),id,name:id,parents:[],adoptiveParents:[],relations:[],guardianIds:[],inventory:{},coins:0,plan:null,activity:null,status:'alive',deathAt:null,canDecide:true,canExpress:true,bornAt:w.minute-30*YEAR};
 w.residents.push(p);for(const r of w.residents)r.knownPeople=w.residents.map(p=>p.id);return p;
}
function marry(a:Resident,b:Resident){for(const [p,q] of [[a,b],[b,a]])p.relations.push({targetId:q.id,partner:'married',affection:0,trust:0,conflict:0,evidence:[]});}
function inherit(w:World,r:Resident,id:string){
 const a={type:'production' as const,operation:'inherit' as const,personId:id},route=productionTarget(w,r,a);assert.equal(route.error,undefined);r.at={...route.target};r.inside=null;r.roomAt=null;assert.equal(completeProduction(w,r,a),null);
}
function acceptFirst(f:ReturnType<typeof fixture>){recordDeath(f.w,f.parent);inherit(f.w,f.adult,f.parent.id);return structuredClone(f.w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt!==null)!);}
function reload(w:World){const store=new WorldStore(':memory:');try{store.commit(w,null);return store.load(true)!;}finally{store.close();}}
function stock(w:World,item:'wood'|'meal'){return [...foodContainers(w)].filter(([id])=>id.startsWith('estate')||w.residents.some(p=>id==='person:'+p.id)).reduce((n,[,b])=>n+(b[item]??0),0);}
let serial=0;
function numbered(w:World,r:Resident,match:(a:Action)=>boolean){
 const p=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),choice=p.choices.find(c=>match(c.action));assert.ok(choice,'the final normal numbered menu must expose this legal action');assert.match(choice.id,/^\d+$/);
 return parseChoice(JSON.stringify({choice:choice.id}),p.choices);
}
function run(w:World,r:Resident,decision:ReturnType<typeof parseChoice>){
 const result=submitPlan(w,{id:'inheritance-successor:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision});assert.equal(result.ok,true,JSON.stringify(result));
 let left=500;while(r.plan||r.activity){assert.ok(left-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);
}

test('20 coins and six fields: sibling death after a half claim exposes a new numbered action, not a redistribution',()=>{
 const f=fixture(),{w,parent,adult,minor}=f,money=totalCoins(w),first=acceptFirst(f),oldParcels=structuredClone(ownedEstateParcels(w,adult));
 assert.equal(adult.coins,10);assert.equal(w.plots.filter(p=>p.ownerId===adult.id).length,3);
 const deceasedAction={type:'production' as const,operation:'inherit' as const,personId:parent.id};recordDeath(w,minor);advanceProduction(w);
 const shares=w.production!.inheritances[parent.id].shares,next=shares.find(s=>s.claimedAt===null)!;
 assert.equal(next.heirId,adult.id);assert.equal(next.coins,10);assert.equal(next.plots.length,3);assert.deepEqual(shares.find(s=>s.id===first.id),first);
 assert.deepEqual(ownedEstateParcels(w,adult),oldParcels);assert.equal(adult.coins,10);assert.equal(w.plots.filter(p=>p.ownerId===parent.id).length,3);
 assert.ok(completeProduction(w,minor,deceasedAction));
 decisionContext(w,adult);const before=structuredClone(w),decision=numbered(w,adult,a=>a.type==='production'&&a.operation==='inherit'&&a.personId===parent.id);assert.deepEqual(w,before);
 run(w,adult,decision);assert.equal(adult.coins,20);assert.equal(w.plots.filter(p=>p.ownerId===adult.id).length,6);assert.equal(w.estates.find(e=>e.personId===parent.id)!.status,'settled');
 assert.equal(adult.inventory.wood??0,0);assert.equal(stock(w,'wood'),7);assert.equal(totalCoins(w),money);assert.equal(w.metrics.requests,0);
 const transfers=w.economy!.transferCount;assert.ok(completeProduction(w,adult,deceasedAction));advanceProduction(w);assert.equal(w.economy!.transferCount,transfers);assert.deepEqual(shares.find(s=>s.id===first.id),first);
});

test('the sibling dying before the first split leaves the same total money and land without rewriting accepted rights',()=>{
 const f=fixture();recordDeath(f.w,f.parent);recordDeath(f.w,f.minor);advanceProduction(f.w);
 assert.deepEqual(estateHeirs(f.w,f.parent.id),[f.adult.id]);inherit(f.w,f.adult,f.parent.id);
 assert.equal(f.adult.coins,20);assert.equal(f.w.plots.filter(p=>p.ownerId===f.adult.id).length,6);assert.equal(f.w.production!.inheritances[f.parent.id].shares.length,1);
});

test('recursive descendants precede a surviving spouse and retain the locked branch instead of flattening the whole estate',()=>{
 const f=fixture(),first=acceptFirst(f),child=person(f.w,'branch-child'),grandchild=person(f.w,'branch-grandchild'),sibling=person(f.w,'branch-other-child'),spouse=person(f.w,'branch-spouse');
 child.parents=[f.minor.id];sibling.adoptiveParents=[f.minor.id];grandchild.parents=[child.id];marry(f.minor,spouse);
 recordDeath(f.w,child);recordDeath(f.w,f.minor);advanceProduction(f.w);
 const shares=f.w.production!.inheritances[f.parent.id].shares;assert.deepEqual(shares.find(s=>s.id===first.id),first);
 assert.deepEqual(shares.filter(s=>s.claimedAt===null).map(s=>[s.heirId,s.coins]),[[grandchild.id,5],[sibling.id,5]]);
 assert.equal(shares.filter(s=>s.claimedAt===null).reduce((n,s)=>n+s.plots.length,0),3);assert.equal(f.adult.coins,10);assert.equal(spouse.coins,0);
});

for(const rank of ['spouse','parent','sibling'] as const)test(`an unclaimed deceased branch uses the existing ${rank} fallback without changing the coheir`,()=>{
 const f=fixture(),first=acceptFirst(f),recipient=person(f.w,'recipient-'+rank);
 // Isolate each rank without allowing the original deceased parent to supply living descendants.
 f.minor.parents=[];f.minor.adoptiveParents=[];
 if(rank==='spouse')marry(f.minor,recipient);
 if(rank==='parent')f.minor.adoptiveParents=[recipient.id];
 if(rank==='sibling')f.minor.relations.push({targetId:recipient.id,adoptive:'sibling',affection:0,trust:0,conflict:0,evidence:[]});
 recordDeath(f.w,f.minor);advanceProduction(f.w);
 const shares=f.w.production!.inheritances[f.parent.id].shares;assert.deepEqual(shares.find(s=>s.id===first.id),first);assert.equal(shares.find(s=>s.claimedAt===null)!.heirId,recipient.id);
 inherit(f.w,recipient,f.parent.id);assert.equal(recipient.coins,10);assert.equal(f.adult.coins,10);assert.equal(f.w.plots.filter(p=>p.ownerId===recipient.id).length,3);
});

test('an estate retains the deceased heirs spouse-at-death even after that spouse marries someone else',()=>{
 const f=fixture(),first=acceptFirst(f),spouse=person(f.w,'widow'),later=person(f.w,'later-partner');marry(f.minor,spouse);
 recordDeath(f.w,f.minor);marry(spouse,later);advanceProduction(f.w);
 assert.equal(f.w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt===null)!.heirId,spouse.id);assert.deepEqual(f.w.production!.inheritances[f.parent.id].shares.find(s=>s.id===first.id),first);
});

test('SQLite reload before and after succession preserves source parcels, food age, accepted records and exactly-once money',()=>{
 const f=fixture(),first=acceptFirst(f),money=totalCoins(f.w),oldShares=f.w.production!.inheritances[f.parent.id].shares,old=oldShares.find(s=>s.claimedAt===null)!;
 const oldLots=old.goodsClaims!.flatMap(id=>(f.w.food!.lots[id]?.meal??[]).map(l=>({...l}))),locations=old.goodsClaims!.map(id=>estateParcels(f.w).find(p=>p.id===id)!.location);
 recordDeath(f.w,f.minor);let w=reload(f.w);advanceProduction(w);w=reload(w);const adult=w.residents.find(r=>r.id===f.adult.id)!,next=w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt===null)!;
 assert.deepEqual(next.goodsClaims!.map(id=>estateParcels(w).find(p=>p.id===id)!.location),locations);
 assert.deepEqual(next.goodsClaims!.flatMap(id=>w.food!.lots[id]?.meal??[]),oldLots);assert.deepEqual(w.production!.inheritances[f.parent.id].shares.find(s=>s.id===first.id),first);
 const snapshot=structuredClone(w.production!.inheritances);for(let i=0;i<4;i++)advanceProduction(w);assert.deepEqual(w.production!.inheritances,snapshot);
 inherit(w,adult,f.parent.id);w=reload(w);const final=w.residents.find(r=>r.id===adult.id)!;assert.ok(completeProduction(w,final,{type:'production',operation:'inherit',personId:f.parent.id}));
 assert.equal(final.coins,20);assert.equal(totalCoins(w),money);assert.equal(stock(w,'wood'),7);assert.equal(stock(w,'meal'),6);assert.equal(new Set(estateParcels(w).map(p=>p.id)).size,estateParcels(w).length);
 const parcel=ownedEstateParcels(w,final).find(p=>p.id===next.goodsClaims![0])!;assert.ok(parcel);const wood=parcel.inventory.wood;run(w,final,numbered(w,final,a=>a.type==='production'&&a.operation==='collectEstate'&&a.parcelId===parcel.id));
 assert.equal(final.inventory.wood,wood);assert.equal(stock(w,'wood'),7);assert.ok(completeProduction(w,final,{type:'production',operation:'collectEstate',parcelId:parcel.id}));
});

test('successor property includes original building, parcel, industry and creditor rights, never movement or debtor liability',()=>{
 const f=fixture(),{w,parent,adult,minor}=f;initializeIndustry(w);initializeDebt(w);
 const hall=w.buildings.find(b=>b.kind==='lodge')!,borrower=person(w,'loan-borrower');parent.at={...hall.door};borrower.at={...hall.door};parent.coins=22;
 for(let i=0;i<2;i++){assert.equal(completeDebt(w,parent,{type:'debt',operation:'lend',targetId:borrower.id,buildingId:hall.id,principal:1,repayment:2,days:3}),null);assert.equal(completeDebt(w,borrower,{type:'debt',operation:'respond',loanId:w.debt!.loans.at(-1)!.id,accept:true}),null);}
 const secondHome=structuredClone(f.home);secondHome.id='z-second-home';secondHome.residents=[];w.buildings.push(secondHome);
 const parcelDef=w.definitions['land/start@1'].data.parcels as Array<{ownerId:string;x:number;y:number;width:number;height:number}>;parcelDef.push({ownerId:parent.id,x:5,y:5,width:3,height:3});
 w.industry!.tools=[{id:'a-tool',ownerId:parent.id,kind:'axe',level:1,durability:80,maxDurability:100},{id:'z-tool',ownerId:parent.id,kind:'pick',level:1,durability:70,maxDurability:100}];
 parent.at={...f.home.door};const first=acceptFirst(f),branch=structuredClone(w.production!.inheritances[parent.id].shares.find(s=>s.claimedAt===null)!),money=totalCoins(w);
 assert.equal(branch.buildings.length,1);assert.equal(branch.parcels.length,1);assert.equal(branch.industryAssets!.length,1);assert.equal(branch.creditClaims!.length,1);
 const tool=w.industry!.tools.find(t=>t.id===branch.industryAssets![0])!,location=structuredClone(tool.location);
 recordDeath(w,minor);advanceProduction(w);assert.equal(tool.ownerId,parent.id);inherit(w,adult,parent.id);
 assert.deepEqual(w.production!.inheritances[parent.id].shares.find(s=>s.id===first.id),first);
 assert.ok(branch.buildings.every(id=>w.buildings.find(b=>b.id===id)!.ownerId===adult.id));assert.ok(branch.parcels.every(index=>productionParcels(w)[index].ownerId===adult.id));
 assert.equal(tool.ownerId,adult.id);assert.deepEqual(tool.location,location);assert.ok(w.debt!.loans.every(c=>c.ownerId===adult.id&&c.borrowerId===borrower.id&&c.originalLenderId===parent.id));assert.equal(totalCoins(w),money);
});

test('several sites and odd quantities keep exact branch inventory and food definitions through sibling fallback',()=>{
 const f=fixture();recordDeath(f.w,f.parent);f.w.minute+=DAY;
 foodTransaction(f.w,()=>{estateStock(f.w,f.parent.id,'late-original-stock',estateLocation({x:34,y:62},null,null,'实际远处货站'))!.meal=5;});
 inherit(f.w,f.adult,f.parent.id);const initial=structuredClone(f.w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt===null)!);
 recordDeath(f.w,f.minor);advanceProduction(f.w);const branch=f.w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt===null)!;
 assert.deepEqual(branch.inventory,initial.inventory);assert.equal(branch.goodsClaims!.length,2);assert.equal(stock(f.w,'meal'),11);
 assert.equal(new Set(branch.goodsClaims!.flatMap(id=>(f.w.food!.lots[id]?.meal??[]).map(l=>l.expiresAt))).size,2);
 inherit(f.w,f.adult,f.parent.id);assert.equal(f.adult.inventory.meal??0,0);assert.equal(stock(f.w,'meal'),11);
});

test('two successors completing numbered claims in one world sweep cannot spend each others shares or replay payment',()=>{
 const f=fixture(),first=acceptFirst(f),a=person(f.w,'successor-a'),b=person(f.w,'successor-b');a.parents=[f.minor.id];b.parents=[f.minor.id];
 recordDeath(f.w,f.minor);advanceProduction(f.w);const cash=totalCoins(f.w);
 for(const r of [a,b]){
  const decision=numbered(f.w,r,action=>action.type==='production'&&action.operation==='inherit'&&action.personId===f.parent.id);
  assert.equal(submitPlan(f.w,{id:'concurrent-inheritance:'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],...decision}).ok,true);
 }
 for(let i=0;a.plan||a.activity||b.plan||b.activity;i++){assert.ok(i<80);stepWorld(f.w,1);}
 assert.equal(a.lastFailure,null);assert.equal(b.lastFailure,null);assert.equal(a.coins,5);assert.equal(b.coins,5);assert.equal(f.adult.coins,10);assert.equal(totalCoins(f.w),cash);
 const shares=f.w.production!.inheritances[f.parent.id].shares;assert.deepEqual(shares.find(s=>s.id===first.id),first);assert.ok(shares.every(s=>s.claimedAt!==null));
 assert.equal(f.w.plots.filter(p=>p.ownerId===a.id||p.ownerId===b.id).length,3);
 const transfers=f.w.economy!.transferCount;for(const r of [a,b])assert.ok(completeProduction(f.w,r,{type:'production',operation:'inherit',personId:f.parent.id}));assert.equal(f.w.economy!.transferCount,transfers);
});

test('death during a second inheritance action cancels that action and passes only its unclaimed branch to the spouse',()=>{
 const f=fixture(),first=acceptFirst(f),spouse=person(f.w,'surviving-spouse');marry(f.adult,spouse);
 recordDeath(f.w,f.minor);advanceProduction(f.w);const money=totalCoins(f.w);
 const decision=numbered(f.w,f.adult,a=>a.type==='production'&&a.operation==='inherit'&&a.personId===f.parent.id);
 assert.equal(submitPlan(f.w,{id:'interrupted-inheritance',actorId:f.adult.id,actorRevision:f.adult.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],...decision}).ok,true);
 stepWorld(f.w,5);assert.ok(f.adult.activity);assert.equal(f.adult.coins,10);recordDeath(f.w,f.adult);advanceProduction(f.w);
 assert.equal(f.adult.activity,null);const shares=f.w.production!.inheritances[f.parent.id].shares;assert.deepEqual(shares.find(s=>s.id===first.id),first);assert.equal(shares.find(s=>s.claimedAt===null)!.heirId,spouse.id);
 inherit(f.w,spouse,f.parent.id);assert.equal(spouse.coins,10);assert.equal(f.w.estates.find(e=>e.personId===f.adult.id)!.coins,10);
 inherit(f.w,spouse,f.adult.id);assert.equal(spouse.coins,20);assert.equal(f.w.plots.filter(p=>p.ownerId===spouse.id).length,6);assert.equal(totalCoins(f.w),money);assert.deepEqual(shares.find(s=>s.id===first.id),first);
});

test('missing deceased identity or estate remains protected instead of inventing succession evidence',()=>{
 for(const missing of ['person','estate'] as const){
  const f=fixture();acceptFirst(f);recordDeath(f.w,f.minor);
  if(missing==='person')f.w.residents=f.w.residents.filter(p=>p!==f.minor);else f.w.estates=f.w.estates.filter(e=>e.personId!==f.minor.id);
  const shares=structuredClone(f.w.production!.inheritances[f.parent.id]),parcels=structuredClone(estateParcels(f.w)),cash=totalCoins(f.w);
  for(let i=0;i<3;i++)advanceProduction(f.w);assert.deepEqual(f.w.production!.inheritances[f.parent.id],shares);assert.deepEqual(estateParcels(f.w),parcels);assert.equal(totalCoins(f.w),cash);assert.equal(f.w.estates.find(e=>e.personId===f.parent.id)!.status,'protected');
 }
});
