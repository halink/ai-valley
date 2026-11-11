import {atWorkstation} from './helpers/workspaces.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PublicDutyAction,PublicShift} from '../src/shared/public-duties.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {advancePublicDuties,completeDuty,dutyReason} from '../src/world/public-duties.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {recordDeath} from '../src/world/life.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';

function fixture(role:'kitchen'|'care'='kitchen'){
  const w=createFormalWorld();w.clock.paused=false;w.minute=600;
  advancePublicDuties(w);
  const shift=w.duties!.shifts.find(s=>s.role===role&&s.start===600)!;
  const building=w.buildings.find(b=>b.id===shift.buildingId)!;
  const [worker,client]=w.residents.filter(r=>w.minute-r.bornAt>=18*112*1440).slice(0,2);
  const other=w.residents.find(r=>r.id!==worker.id&&r.id!==client.id&&(w.minute-r.bornAt)>=18*112*1440)!;
  for(const person of [worker,client,other]){
    person.at={...building.door};person.inside=null;
    person.knownBuildings.push(building.id);person.inventory={turnip:12,meal:5,water:12};
    person.skills.care=2;person.hunger=65;person.health=70;person.energy=90;
  }
  return {w,shift,building,worker,client,other};
}
function schedule(w:World,r:Resident,action:Action){
  atWorkstation(w,r,action);
  const plan={id:`test:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
    definition:w.activeDefinitions['action/routine'],intention:'本人自主选择',actions:[action]};
  assert.equal(submitPlan(w,plan).ok,true);
}
function choose(w:World,r:Resident,shift:PublicShift,operation:PublicDutyAction['operation'],minutes=1,fromShiftId?:string){
  const menu=decisionChoices(decisionContext(w,r));
  const choice=menu.find(c=>c.action.type==='publicDuty'&&c.action.shiftId===shift.id&&c.action.operation===operation
    &&(!fromShiftId||c.action.fromShiftId===fromShiftId));
  assert.ok(choice,`expected ${operation} in resident's actual model choices`);
  const decision=parseChoice(JSON.stringify({choice:choice.id}),menu);
  schedule(w,r,decision.actions[0]);stepWorld(w,minutes);
  assert.equal(r.lastFailure,null);
}

test('actual model choices book a public kitchen, show up, and supply a personally requested meal',()=>{
  const {w,shift,worker,client}=fixture();
  choose(w,worker,shift,'claim');
  assert.equal(shift.status,'booked');
  assert.equal(dutyReason(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id})!==null,true);
  choose(w,worker,shift,'attend');
  assert.equal(shift.status,'on-duty');assert.ok(shift.assignments[0].arrivedAt);
  const before={...worker.inventory},hunger=client.hunger;
  choose(w,client,shift,'receive',20);
  assert.equal(worker.inventory.turnip,before.turnip!-2);
  assert.equal(worker.inventory.water,before.water!-1);
  assert.ok(client.hunger<hunger-40);
  assert.equal(shift.served,1);assert.equal(shift.clientId,null);
  const fact=w.events.slice().reverse().find(e=>e.kind==='duty'&&e.actors.includes(client.id));
  assert.ok(fact?.actors.includes(worker.id));
});

test('care is requested by the recipient and consumes the attending volunteer supplies',()=>{
  const {w,shift,worker,client}=fixture('care');
  choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');
  client.refusesCare=true;
  assert.ok(dutyReason(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id}));
  client.refusesCare=false;const before={...worker.inventory},health=client.health;
  choose(w,client,shift,'receive',30);
  assert.equal(worker.inventory.meal,before.meal!-1);assert.equal(worker.inventory.water,before.water!-1);
  assert.ok(client.health>=health+7.9);
  const event=w.events.slice().reverse().find(e=>e.kind==='care'&&e.actors.includes(client.id));
  assert.equal(event?.audit?.authority,'consent');assert.equal(event?.audit?.providerId,worker.id);
});

test('missed shifts stay vacant until another resident personally accepts, and bookings reject overlap',()=>{
  const {w,shift,worker,other}=fixture();
  choose(w,worker,shift,'claim');
  const second=w.duties!.shifts.find(s=>s.start===600&&s.id!==shift.id)!;
  assert.match(dutyReason(w,worker,{type:'publicDuty',operation:'claim',shiftId:second.id})!,/重叠/);
  stepWorld(w,17);
  assert.equal(shift.workerId,null);assert.equal(shift.assignments[0].outcome,'absent');assert.equal(shift.served,0);
  choose(w,other,shift,'claim');choose(w,other,shift,'attend');
  assert.equal(shift.workerId,other.id);assert.equal(shift.assignments.length,2);
  choose(w,other,shift,'withdraw');
  assert.equal(shift.workerId,null);assert.equal(shift.status,'open');
});

test('a resident can decline and reschedule a personally accepted future shift with one atomic change',()=>{
  const {w,shift,worker,other}=fixture();
  choose(w,other,shift,'decline');assert.ok(shift.declinedBy.includes(other.id));
  choose(w,worker,shift,'claim');
  const tomorrow=w.duties!.shifts.find(s=>s.buildingId===shift.buildingId&&s.start===2040)!;
  choose(w,worker,tomorrow,'reschedule',1,shift.id);
  assert.equal(shift.workerId,null);assert.equal(shift.assignments[0].outcome,'rescheduled');
  assert.equal(tomorrow.workerId,worker.id);assert.equal(tomorrow.status,'booked');
});

test('leaving the station interrupts an unfinished request without creating food or consuming materials',()=>{
  const {w,shift,building,worker,client}=fixture();
  choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');
  const before={...worker.inventory},hunger=client.hunger;
  schedule(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id});stepWorld(w,5);
  assert.equal(shift.clientId,client.id);
  schedule(w,worker,{type:'move',to:{x:building.door.x+1,y:building.door.y}});
  stepWorld(w,2);
  assert.equal(shift.served,0);assert.equal(shift.workerId,null);
  assert.ok(client.lastFailure);assert.deepEqual(worker.inventory,before);assert.ok(client.hunger>hunger);
});

test('one service seat prevents concurrent claims and supplier depletion is checked at completion',()=>{
  const {w,shift,worker,client,other}=fixture();
  choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');
  schedule(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id});
  schedule(w,other,{type:'publicDuty',operation:'receive',shiftId:shift.id});stepWorld(w,2);
  assert.equal(shift.clientId,client.id);assert.ok(other.lastFailure);
  worker.inventory.turnip=0;stepWorld(w,25);
  assert.equal(shift.served,0);assert.ok(client.lastFailure);assert.equal(worker.inventory.turnip,0);
});

test('new and existing worlds publish the same empty windows without assigning residents',()=>{
  const w=createFormalWorld();
  assert.equal(w.duties,undefined);advancePublicDuties(w);
  const count=w.duties!.shifts.length;assert.ok(count>0);assert.ok(w.duties!.shifts.every(s=>s.workerId===null));
  const saved=structuredClone(w);advancePublicDuties(saved);assert.equal(saved.duties!.shifts.length,count);
  saved.minute=3*1440;advancePublicDuties(saved);
  assert.ok(saved.duties!.shifts.some(s=>s.start>=3*1440));assert.ok(saved.duties!.shifts.every(s=>s.workerId===null));
});

test('a service finishing at the exact closing time completes once, and commuting time prevents impossible consecutive duties',()=>{
  const {w,shift,worker,client}=fixture();
  choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');
  w.minute=shift.end-20;
  // This test isolates exact-closing work, so be physically seated before the
  // menu is built; the room approach no longer disappears from time estimates.
  atWorkstation(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id});
  choose(w,client,shift,'receive',20);
  assert.equal(shift.served,1);assert.equal(shift.status,'finished');
  assert.ok(dutyReason(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id}));
  const another=fixture();
  choose(another.w,another.worker,another.shift,'claim');
  const next=another.w.duties!.shifts.find(s=>s.start===600&&s.buildingId!==another.shift.buildingId)!;
  next.start=another.shift.end;next.end=next.start+90;
  assert.match(dutyReason(another.w,another.worker,{type:'publicDuty',operation:'claim',shiftId:next.id})!,/实际走到/);
});

test('duty departure and death release the workstation and preserve supplies when a client has unfinished care',()=>{
  for(const ending of ['death','departure'] as const){
    const {w,shift,worker,client}=fixture('care');
    choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');
    schedule(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id});stepWorld(w,5);
    const supplies={...worker.inventory},health=client.health;
    if(ending==='death')recordDeath(w,worker);else worker.residency='outside';
    stepWorld(w,30);
    assert.equal(shift.served,0);assert.equal(shift.clientId,null);assert.equal(shift.workerId,null);
    assert.equal(shift.assignments[0].outcome,'left');assert.ok(shift.assignments[0].leftAt);
    assert.ok(client.health<=health);
    if(ending==='death')assert.deepEqual(w.estates.find(e=>e.personId===worker.id)!.inventory,supplies);
    else assert.deepEqual(worker.inventory,supplies);
  }
});

test('finishing the same on-site request cannot consume supplies or apply care twice',()=>{
  const {w,shift,worker,client}=fixture('care');
  choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');choose(w,client,shift,'receive',30);
  const before={...worker.inventory},health=client.health;
  assert.ok(completeDuty(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id}));
  assert.deepEqual(worker.inventory,before);assert.equal(client.health,health);assert.equal(shift.served,1);
});

test('the final service and an attending worker finishing at close behave identically in either resident order',()=>{
  for(const reverse of [false,true]){
    const {w,shift,worker,client}=fixture();
    choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');
    w.minute=shift.end-20;
    schedule(w,worker,{type:'wait',minutes:20});
    schedule(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id});
    if(reverse)w.residents.reverse();
    stepWorld(w,20);
    assert.equal(client.lastFailure,null);assert.equal(shift.served,1);assert.equal(shift.status,'finished');
  }
});

test('ordinary cooking uses the same exclusive public workstation as an attending duty',()=>{
  const {w,shift,worker,client,other}=fixture();
  choose(w,worker,shift,'claim');choose(w,worker,shift,'attend');
  const supplies={...client.inventory};
  client.homeId=null;
  schedule(w,client,{type:'cook',quantity:1});stepWorld(w,2);
  assert.match(client.lastFailure!,/公厨工位/);assert.deepEqual(client.inventory,supplies);
  choose(w,worker,shift,'withdraw');
  client.lastFailure=null;
  schedule(w,client,{type:'cook',quantity:1});stepWorld(w,1);
  assert.ok(client.activity);
  other.homeId=null;const otherSupplies={...other.inventory};
  schedule(w,other,{type:'cook',quantity:1});stepWorld(w,1);
  assert.match(other.lastFailure!,/已有居民/);assert.deepEqual(other.inventory,otherSupplies);
  stepWorld(w,20);
  assert.equal(client.inventory.turnip,supplies.turnip!-2);
  assert.equal(client.inventory.meal,supplies.meal!+1);
});
