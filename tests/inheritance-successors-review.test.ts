import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {recordDeath} from '../src/world/life.js';
import {advanceProduction,initializeProduction,prepareShares,productionTarget,completeProduction,estateHeirs} from '../src/world/production.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {estateParcels,ownedEstateParcels} from '../src/world/estate-custody.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import type {Resident,World} from '../src/shared/types.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.resources=[];
 const template=structuredClone(w.residents[0]);
 w.residents=Array.from({length:8},(_,i)=>({...structuredClone(template),id:`review-${i}`,name:`审查${i}`,parents:[],adoptiveParents:[],relations:[],coins:0,inventory:{},at:{x:34,y:40},inside:null,roomAt:null,bornAt:w.minute-30*YEAR,canDecide:true,canExpress:true,plan:null,activity:null}));
 for(const r of w.residents){r.knownPeople=w.residents.map(p=>p.id);r.knownBuildings=w.buildings.map(b=>b.id);}
 const [parent,adult,minor,spouse,grandparent,child,other]=w.residents;
 const home=w.buildings.find(b=>b.id===parent.homeId)!;home.ownerId=parent.id;
 parent.coins=20;parent.inventory={wood:6};adult.parents=[parent.id];minor.parents=[parent.id];minor.bornAt=w.minute-10*YEAR;
 w.plots=Array.from({length:6},(_,i)=>({id:`review-plot-${i}`,at:{x:40+i,y:180},ownerId:parent.id,crop:null}));
 initializeEconomy(w);initializeProduction(w);assert.equal(recordDeath(w,parent),true);
 return {w,parent,adult,minor,spouse,grandparent,child,other};
}
function inherit(w:World,r:Resident,id:string){
 const a={type:'production',operation:'inherit',personId:id} as const;
 const route=productionTarget(w,r,a);assert.equal(route.error,undefined);r.at={...route.target};r.inside=null;r.roomAt=null;
 assert.equal(completeProduction(w,r,a),null);
}
function killMinor(f:ReturnType<typeof fixture>){f.minor.at={...f.adult.at};assert.equal(recordDeath(f.w,f.minor),true);advanceProduction(f.w);}

test('review: remaining sibling rights transfer without rewriting claimed half, minting cash or moving goods; SQLite replay is stable',()=>{
 const f=fixture(),{w,parent,adult}=f;const money=totalCoins(w);inherit(w,adult,parent.id);
 const original=structuredClone(w.production!.inheritances[parent.id].shares.find(s=>s.claimedAt!==null)!);
 assert.equal(adult.coins,10);assert.equal(w.plots.filter(p=>p.ownerId===adult.id).length,3);
 killMinor(f);
 const shares=w.production!.inheritances[parent.id].shares;
 assert.deepEqual(shares.find(s=>s.claimedAt!==null),original);
 assert.equal(shares.find(s=>s.claimedAt===null)?.heirId,adult.id);
 const source=estateParcels(w).filter(p=>(p.inventory.wood??0)>0).map(p=>structuredClone(p.location));
 assert.equal(adult.inventory.wood??0,0);assert.equal(totalCoins(w),money);
 const store=new WorldStore(':memory:');try{
  store.commit(w,null);const restored=store.loadForRuntime()!;advanceProduction(restored);
  assert.deepEqual(restored.production!.inheritances[parent.id].shares,shares);
  const r=restored.residents.find(p=>p.id===adult.id)!;inherit(restored,r,parent.id);
  assert.equal(r.coins,20);assert.equal(restored.plots.filter(p=>p.ownerId===r.id).length,6);
  assert.equal(restored.estates.find(e=>e.personId===parent.id)!.status,'settled');
  assert.equal(totalCoins(restored),money);assert.equal(r.inventory.wood??0,0);
  assert.equal(ownedEstateParcels(restored,r).reduce((n,p)=>n+(p.inventory.wood??0),0),6);
  assert.deepEqual(estateParcels(restored).filter(p=>(p.inventory.wood??0)>0).map(p=>p.location),source);
  const snapshot=JSON.stringify(restored.production!.inheritances);advanceProduction(restored);assert.equal(JSON.stringify(restored.production!.inheritances),snapshot);
  assert.ok(completeProduction(restored,r,{type:'production',operation:'inherit',personId:parent.id}));assert.equal(r.coins,20);
 }finally{store.close();}
});

test('review: dead heir uses descendants, death-time spouse, living parents then siblings in that order',()=>{
 for(const tier of ['child','spouse','parent','sibling'] as const){
  const f=fixture(),{w,parent,adult,minor,spouse,grandparent,child}=f;inherit(w,adult,parent.id);
  if(tier==='child')child.parents=[minor.id];
  if(tier==='child'||tier==='spouse')minor.relations.push({targetId:spouse.id,affection:0,trust:0,conflict:0,evidence:[],partner:'married'});
  if(tier!=='sibling')minor.parents=[grandparent.id];
  killMinor(f);
  const expected=tier==='child'?child:tier==='spouse'?spouse:tier==='parent'?grandparent:adult;
  assert.deepEqual(w.production!.inheritances[parent.id].shares.filter(s=>s.claimedAt===null).map(s=>s.heirId),[expected.id],tier);
  if(tier==='spouse'){assert.deepEqual(w.estates.find(e=>e.personId===minor.id)!.spouseIds,[spouse.id]);assert.equal(minor.relations.some(r=>r.partner==='married'),false);}
 }
});

test('review: descendant cycles terminate and absent lawful heirs retain protected cash and source claims',()=>{
 const f=fixture(),{w,parent,minor,adult,other}=f;inherit(w,adult,parent.id);
 minor.parents=[];assert.equal(recordDeath(w,minor),true);assert.equal(recordDeath(w,other),true);
 const m=w.estates.find(e=>e.personId===minor.id)!,o=w.estates.find(e=>e.personId===other.id)!;
 m.heirs=[other.id];o.heirs=[minor.id];
 const before=structuredClone(w.production!.inheritances[parent.id]);const cash=totalCoins(w),parcels=structuredClone(estateParcels(w));
 for(let i=0;i<4;i++)advanceProduction(w);
 assert.deepEqual(estateHeirs(w,minor.id),[]);assert.deepEqual(w.production!.inheritances[parent.id],before);
 assert.deepEqual(estateParcels(w),parcels);assert.equal(totalCoins(w),cash);assert.equal(w.estates.find(e=>e.personId===parent.id)!.status,'protected');
});

test('review: unfinished action rechecks death, adulthood, knowledge, identity and duplicate claim at completion',()=>{
 const f=fixture(),{w,parent,adult,minor,other}=f;inherit(w,adult,parent.id);killMinor(f);
 const a={type:'production',operation:'inherit',personId:parent.id} as const;
 assert.ok(completeProduction(w,minor,a));assert.ok(completeProduction(w,other,a));
 const coin=totalCoins(w),oldBorn=adult.bornAt;adult.bornAt=w.minute-10*YEAR;assert.ok(completeProduction(w,adult,a));adult.bornAt=oldBorn;
 const known=adult.knownPeople;adult.knownPeople=[];assert.ok(completeProduction(w,adult,a));adult.knownPeople=known;
 const route=productionTarget(w,adult,a);assert.equal(route.error,undefined);
 adult.canDecide=false;assert.ok(completeProduction(w,adult,a));adult.canDecide=true;
 inherit(w,adult,parent.id);assert.ok(completeProduction(w,adult,a));assert.equal(adult.coins,20);assert.equal(totalCoins(w),coin);
});

test('review: chained deaths allocate each outstanding share once, keep adopted descendants and preserve odd remainders',()=>{
 const f=fixture(),{w,parent,adult,minor,child,other}=f;inherit(w,adult,parent.id);
 child.adoptiveParents=[minor.id];other.parents=[minor.id];killMinor(f);
 let shares=w.production!.inheritances[parent.id].shares.filter(s=>s.claimedAt===null);
 assert.deepEqual(shares.map(s=>s.coins),[5,5]);assert.equal(shares.reduce((n,s)=>n+s.plots.length,0),3);
 child.parents=[adult.id];other.parents=[adult.id];
 assert.equal(recordDeath(w,child),true);assert.equal(recordDeath(w,other),true);advanceProduction(w);
 shares=w.production!.inheritances[parent.id].shares.filter(s=>s.claimedAt===null);
 assert.equal(shares.reduce((n,s)=>n+s.coins,0),10);assert.ok(shares.every(s=>s.heirId===adult.id));
 inherit(w,adult,parent.id);inherit(w,adult,parent.id);assert.equal(adult.coins,20);
 assert.equal(w.plots.filter(p=>p.ownerId===adult.id).length,6);
 assert.equal(prepareShares(w,parent.id).filter(s=>s.claimedAt===null).length,0);
});

test('review: sibling fallback works without parent records and uses death-time spouse rather than later relationship edits',()=>{
 for(const hasSpouse of [false,true]){
  const f=fixture(),{w,parent,adult,minor,spouse,other}=f;inherit(w,adult,parent.id);
  minor.parents=[];minor.relations.push({targetId:adult.id,affection:0,trust:0,conflict:0,evidence:[],kin:'sibling'});
  if(hasSpouse)minor.relations.push({targetId:spouse.id,affection:0,trust:0,conflict:0,evidence:[],partner:'married'});
  assert.equal(recordDeath(w,minor),true);
  minor.relations.push({targetId:other.id,affection:0,trust:0,conflict:0,evidence:[],partner:'married'});
  advanceProduction(w);
  assert.deepEqual(w.production!.inheritances[parent.id].shares.filter(s=>s.claimedAt===null).map(s=>s.heirId),[hasSpouse?spouse.id:adult.id]);
 }
});

// Compatibility check: the existing resolver expands deceased parents through descendants.
test('review: existing deceased-parent representation semantics are preserved, not silently replaced',()=>{
 const f=fixture(),{w,parent,adult,minor,grandparent}=f;inherit(w,adult,parent.id);
 minor.parents.push(grandparent.id);killMinor(f);
 const pending=w.production!.inheritances[parent.id].shares.filter(s=>s.claimedAt===null);
 assert.deepEqual(pending.map(s=>s.heirId),[adult.id,grandparent.id]);
 assert.deepEqual(pending.map(s=>s.coins),[5,5]);
});
