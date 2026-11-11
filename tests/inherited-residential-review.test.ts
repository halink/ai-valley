import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {PremisesAction,PremisesTerms} from '../src/shared/premises.js';
import {createWorld} from '../src/world/seed.js';
import {recordDeath} from '../src/world/life.js';
import {initializeProduction,completeProduction} from '../src/world/production.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeRooms} from '../src/world/rooms.js';
import {advancePremises,completePremises} from '../src/world/premises.js';
import {DAY,YEAR} from '../src/world/time.js';

const terms:PremisesTerms={days:2,rentPerDay:12,deposit:7,station:'bed',startMinute:0,durationMinutes:DAY};
function fixture(){
 const w=createWorld();w.mode='formal';w.minute=600;
 const [dead,heir,tenant]=w.residents,home=w.buildings.find(b=>b.id===dead.homeId)!;
 for(const r of w.residents){
  r.bornAt=w.minute-30*YEAR;r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=500;
  r.parents=[];r.canDecide=r.canExpress=true;r.plan=r.activity=null;
  r.knownBuildings=w.buildings.map(b=>b.id);r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);
 }
 heir.parents=[dead.id];initializeEconomy(w);initializeProduction(w);initializeRooms(w);advancePremises(w);
 assert.equal(recordDeath(w,dead),true);
 const action:PremisesAction={type:'premises',operation:'offer',buildingId:home.id,tenantId:tenant.id,terms};
 return {w,dead,heir,tenant,home,action};
}
function inherit(f:ReturnType<typeof fixture>){assert.equal(completeProduction(f.w,f.heir,{type:'production',operation:'inherit',personId:f.dead.id}),null);}

test('review: historical-home exemption does not bypass actual inheritance or authorize a dead landlord',()=>{
 const f=fixture(),before=JSON.stringify(f.w);
 assert.ok(completePremises(f.w,f.heir,f.action));assert.equal(JSON.stringify(f.w),before);
 assert.ok(completePremises(f.w,f.dead,f.action));assert.equal(JSON.stringify(f.w),before);
 inherit(f);assert.equal(completePremises(f.w,f.heir,f.action),null);
 assert.equal(f.dead.homeId,f.home.id);assert.equal(f.home.ownerId,f.heir.id);
});

test('review: a deceased resident-list entry still blocks both offer and acceptance without silent cleanup',()=>{
 for(const phase of ['offer','accept'] as const){
  const f=fixture();inherit(f);
  if(phase==='accept')assert.equal(completePremises(f.w,f.heir,f.action),null);
  f.home.residents.push(f.dead.id);
  const before=JSON.stringify(f.w),a:PremisesAction=phase==='offer'?f.action:{type:'premises',operation:'accept',leaseId:f.w.economy!.leases!.at(-1)!.id};
  assert.match(completePremises(f.w,phase==='offer'?f.heir:f.tenant,a)!,/既有住户/);
  assert.equal(JSON.stringify(f.w),before);
 }
});

test('review: a body arriving after an offer blocks acceptance, and only removal of physical presence unlocks it',()=>{
 const f=fixture();inherit(f);assert.equal(completePremises(f.w,f.heir,f.action),null);
 const l=f.w.economy!.leases!.at(-1)!,a:PremisesAction={type:'premises',operation:'accept',leaseId:l.id},money=totalCoins(f.w);
 f.dead.inside=f.home.id;
 const before=JSON.stringify(f.w);assert.match(completePremises(f.w,f.tenant,a)!,/实际在场者/);
 assert.equal(JSON.stringify(f.w),before);assert.equal(l.prepaid,0);
 f.dead.inside=null;
 assert.equal(completePremises(f.w,f.tenant,a),null);assert.equal(l.status,'active');
 assert.equal(totalCoins(f.w),money);assert.equal(f.dead.homeId,f.home.id);
});

test('review: a different living outside resident keeps a housing claim without invalidating either signatory',()=>{
 for(const phase of ['offer','accept'] as const){
  const f=fixture();inherit(f);
  if(phase==='accept')assert.equal(completePremises(f.w,f.heir,f.action),null);
  const other={...structuredClone(f.tenant),id:'review-outside-occupant',coins:0};f.w.residents.push(other);
  assert.equal(other.status,'alive');other.residency='outside';other.at={x:1,y:1};other.homeId=f.home.id;
  const before=JSON.stringify(f.w),a:PremisesAction=phase==='offer'?f.action:{type:'premises',operation:'accept',leaseId:f.w.economy!.leases!.at(-1)!.id};
  assert.match(completePremises(f.w,phase==='offer'?f.heir:f.tenant,a)!,/既有住户/);assert.equal(JSON.stringify(f.w),before);
 }
});
