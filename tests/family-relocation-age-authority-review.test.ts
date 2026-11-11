import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {stepWorld, submitPlan} from '../src/world/engine.js';
import {decisionChoices, decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore, workingEvents} from '../src/server/store.js';
import {completeFamilyRelocation, familyRelocationReason} from '../src/world/family-relocation.js';
import {YEAR} from '../src/world/time.js';
import type {Resident, World} from '../src/shared/types.js';
import type {FamilyRelocation, FamilyRelocationAction} from '../src/shared/family-relocation.js';

// Independent synthetic fixture. Never load server configuration or on-disk worlds.
function fixture(age=5) {
  const w=createWorld(48023);w.mode='formal';w.clock.paused=false;
  const [parent,owner,child]=w.residents;w.residents=[parent,owner,child];
  w.map={width:24,height:18,name:'Independent relocation authority review',entrance:{x:2,y:15},tiles:Array(24*18).fill('grass')};
  const old={...w.buildings[0],at:{x:2,y:3},door:{x:5,y:8},capacity:4,residents:[parent.id,child.id]};
  const home={...w.buildings[1],at:{x:14,y:3},door:{x:17,y:8},capacity:4,residents:[owner.id]};
  w.buildings=[old,home];w.resources=[];w.plots=[];w.graves=[];
  for(const p of w.residents)Object.assign(p,{at:{x:4,y:9},inside:null,roomAt:null,bornAt:w.minute-30*YEAR,homeId:p===owner?home.id:old.id,inventory:{meal:30,water:30,berry:3},hunger:20,energy:100,health:100,canDecide:true,canExpress:true,knownBuildings:[old.id,home.id],knownPeople:w.residents.map(x=>x.id),plan:null,activity:null,decisionDue:Number.MAX_SAFE_INTEGER,agency:{focus:'family',goals:[],routines:[],nextSerial:1}});
  Object.assign(child,{bornAt:w.minute-age*YEAR,parents:[parent.id],guardianIds:[parent.id],canDecide:age>=6,canExpress:age>=6,inventory:{berry:3}});
  stepWorld(w,1);w.rooms!.beds[old.id]={[parent.id]:0,[child.id]:1};w.rooms!.beds[home.id]={[owner.id]:0};return {w,parent,owner,child,old,home};
}
type Fixture=ReturnType<typeof fixture>;
function choices(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
function actions(w:World,r:Resident){return choices(w,r).flatMap(c=>c.action.type==='familyRelocation'?[{...c,action:c.action}]:[]);}
let serial=0;
function choose(w:World,r:Resident,op:FamilyRelocationAction['operation'],predicate:(a:FamilyRelocationAction)=>boolean=()=>true){
  const menu=choices(w,r),choice=menu.find(c=>c.action.type==='familyRelocation'&&c.action.operation===op&&predicate(c.action));assert.ok(choice,`final menu contains ${op} at ${w.minute}`);
  const decision=parseChoice(JSON.stringify({choice:choice.id}),menu);
  assert.equal(submitPlan(w,{id:`relocation-review:${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision}).ok,true);
}
function finish(w:World,r:Resident){for(let i=0;(r.plan||r.activity)&&i<200;i++)stepWorld(w,.25);assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(r.lastFailure,null);}
function run(w:World,r:Resident,op:FamilyRelocationAction['operation'],predicate:(a:FamilyRelocationAction)=>boolean=()=>true){choose(w,r,op,predicate);finish(w,r);}
function propose(f:Fixture){run(f.w,f.parent,'propose',a=>a.operation==='propose'&&a.buildingId===f.home.id);return f.w.familyRelocation!.agreements[0];}
function accept(f:Fixture){const c=propose(f);for(const id of c.requiredSignerIds.filter(id=>id!==f.parent.id))run(f.w,f.w.residents.find(p=>p.id===id)!,'accept');assert.equal(c.status,'accepted');stepWorld(f.w,Math.max(0,c.departAfter-f.w.minute));return c;}
function depart(f:Fixture){const c=accept(f);run(f.w,f.parent,'depart');assert.equal(c.status,'travelling');return c;}
function arrive(f:Fixture){const c=depart(f);for(let i=0;String(c.status)==='travelling'&&i<100;i++)stepWorld(f.w,.25);assert.equal(c.status,'arrived');return c;}
function original(c:FamilyRelocation){return structuredClone({...c,status:undefined,signatures:undefined,revocations:undefined,journey:undefined,startedAt:undefined,endedAt:undefined,reason:undefined,members:c.members.map(({escorting,arrivedAt,arrivalEventId,...m})=>m)});}
function physical(w:World){return structuredClone({people:w.residents.map(p=>({id:p.id,at:p.at,inside:p.inside,roomAt:p.roomAt,homeId:p.homeId,residency:p.residency,inventory:p.inventory,coins:p.coins,parents:p.parents,guardianIds:p.guardianIds})),buildings:w.buildings.map(b=>({id:b.id,ownerId:b.ownerId,residents:b.residents})),beds:w.rooms?.beds,stays:w.commons?.stays,lots:w.food?.lots});}
function unknown(r:Resident){Object.assign(r,{bornAt:null,canDecide:true,canExpress:true});}
function birthday(w:World,r:Resident){r.bornAt=w.minute-6*YEAR;r.canDecide=r.canExpress=true;}
const openStores:WorldStore[]=[];
afterEach(()=>{for(const db of openStores.splice(0))db.close();});
function restore(w:World){const db=new WorldStore(':memory:');openStores.push(db);db.commit(w,null);return db.loadForRuntime()!;}
function bind(w:World,f:Fixture){return {...f,w,parent:w.residents.find(r=>r.id===f.parent.id)!,owner:w.residents.find(r=>r.id===f.owner.id)!,child:w.residents.find(r=>r.id===f.child.id)!,old:w.buildings.find(b=>b.id===f.old.id)!,home:w.buildings.find(b=>b.id===f.home.id)!};}

test('review: a sixth birthday after arrival requires actual own assent then actual own registration',()=>{
  const f=fixture(),c=arrive(f),terms=original(c),stock=physical(f.w);birthday(f.w,f.child);
  assert.equal(actions(f.w,f.parent).some(c=>c.action.operation==='arrive'),false);
  assert.equal(actions(f.w,f.parent).some(c=>c.action.operation==='escort'),false);
  run(f.w,f.child,'accept');assert.equal(c.status,'arrived');assert.deepEqual(original(c),terms);assert.deepEqual(physical(f.w),stock);
  const signature=c.signatures.find(s=>s.personId===f.child.id)!;assert.ok(signature);assert.ok(workingEvents(f.w).some(e=>e.id===signature.eventId&&e.actors.includes(f.child.id)));
  run(f.w,f.parent,'arrive',a=>a.operation==='arrive'&&a.personId===f.parent.id);assert.equal(f.child.homeId,f.old.id);
  assert.equal(actions(f.w,f.parent).some(c=>c.action.operation==='arrive'),false);
  run(f.w,f.child,'arrive',a=>a.operation==='arrive'&&a.personId===f.child.id);assert.equal(c.status,'completed');assert.deepEqual(original(c),terms);
  assert.equal(f.home.ownerId,f.owner.id);assert.deepEqual(f.child.inventory,{berry:3});assert.deepEqual(f.child.parents,[f.parent.id]);
});

test('review: paused birthday assent survives two runtime reloads without remote destination disclosure or automatic resume',()=>{
  let f=fixture();const c=depart(f),terms=original(c);birthday(f.w,f.child);stepWorld(f.w,.25);assert.equal(c.status,'paused');
  f.owner.at={x:22,y:16};const before=actions(f.w,f.child),beforeParent=actions(f.w,f.parent);
  unknown(f.owner);f.home.ownerId='remote-new-owner';f.home.condition=0;
  assert.deepEqual(actions(f.w,f.child),before);assert.deepEqual(actions(f.w,f.parent),beforeParent);
  const stock=physical(f.w),journey=structuredClone(c.journey);run(f.w,f.child,'accept');assert.equal(c.status,'paused');assert.deepEqual(physical(f.w),stock);assert.deepEqual(c.journey,journey);
  const signatures=structuredClone(c.signatures);f.w.minute+=60;for(const p of f.w.residents)p.memories=[];
  for(let i=0;i<220;i++)f.w.events.push({id:`review-later:${i}`,at:f.w.minute,kind:'system',actors:[],place:{x:1,y:1},text:'Synthetic history rollover',witnesses:[]});
  f.w.events=workingEvents(f.w);for(let n=0;n<2;n++){f=bind(restore(f.w),f);const saved=f.w.familyRelocation!.agreements[0];assert.equal(saved.status,'paused');assert.deepEqual(saved.signatures,signatures);assert.ok(saved.signatures.every(s=>workingEvents(f.w).some(e=>e.id===s.eventId)));assert.deepEqual(original(saved),terms);assert.deepEqual(saved.journey,journey);assert.equal(actions(f.w,f.child).some(c=>c.action.operation==='accept'),false);assert.equal(actions(f.w,f.parent).some(c=>c.action.operation==='resume'),true);}
  run(f.w,f.parent,'resume');const saved=f.w.familyRelocation!.agreements[0];assert.equal(saved.status,'travelling');assert.deepEqual(f.parent.inventory,stock.people.find(p=>p.id===f.parent.id)!.inventory);
  for(let n=0;String(saved.status)==='travelling'&&n<100;n++)stepWorld(f.w,.25);assert.equal(saved.status,'arrived');assert.equal(actions(f.w,f.parent).some(c=>c.action.operation==='arrive'),false);assert.equal(f.parent.homeId,f.old.id);assert.equal(f.child.homeId,f.old.id);
});

for(const change of ['unknown','cannot express','cannot decide','eighteen'] as const)test(`review: resumed journey final quarter minute rechecks ${change} after SQLite`,()=>{
  let f=fixture(7);const c=depart(f),terms=original(c);const next=c.journey!.path[0];f.w.map.tiles[next.y*f.w.map.width+next.x]='cliff';stepWorld(f.w,.25);assert.equal(c.status,'paused');f.w.map.tiles[next.y*f.w.map.width+next.x]='grass';
  choose(f.w,f.parent,'resume');stepWorld(f.w,.75);assert.ok(f.parent.activity&&f.parent.activity.remaining<=.25);
  if(change==='unknown')unknown(f.child);else if(change==='cannot express')f.child.canExpress=false;else if(change==='cannot decide')f.child.canDecide=false;else f.child.bornAt=f.w.minute-18*YEAR;
  f=bind(restore(f.w),f);const saved=f.w.familyRelocation!.agreements[0],stock=physical(f.w),journey=structuredClone(saved.journey),signatures=structuredClone(saved.signatures);
  if(change==='eighteen')stock.people.find(p=>p.id===f.child.id)!.guardianIds=[]; // Existing adulthood lifecycle clears guardians, not relocation.
  stepWorld(f.w,.25);assert.ok(f.parent.lastFailure);assert.equal(saved.status,'paused');assert.deepEqual(physical(f.w),stock);assert.deepEqual(saved.journey,journey);assert.deepEqual(saved.signatures,signatures);assert.deepEqual(original(saved),terms);
});

for(const role of ['parent','owner','child'] as const)test(`review: unknown ${role} retains genuine existing refusal without becoming a signer or guardian`,()=>{
  const f=fixture(7),c=accept(f),terms=original(c),signatures=structuredClone(c.signatures);unknown(f[role]);const before=physical(f.w);
  assert.equal(actions(f.w,f[role]).some(c=>c.action.operation==='accept'),false);run(f.w,f[role],'withdraw');assert.equal(c.status,'cancelled');assert.deepEqual(c.signatures,signatures);assert.deepEqual(original(c),terms);assert.deepEqual(physical(f.w),before);
});

test('review: a capable unknown-age outsider cannot refuse or sign a family agreement',()=>{
  const f=fixture(7),c=accept(f),outsider=structuredClone(f.owner);outsider.id='review-outsider';unknown(outsider);f.w.residents.push(outsider);const before=structuredClone(c);
  assert.equal(actions(f.w,outsider).length,0);for(const operation of ['withdraw','decline','accept'] as const)assert.ok(completeFamilyRelocation(f.w,outsider,{type:'familyRelocation',operation,relocationId:c.id}));assert.deepEqual(c,before);
});

for(const change of ['age','capability','expiry'] as const)test(`review: actual supplemental assent final quarter minute cannot ignore changed ${change}`,()=>{
  const f=fixture(),c=accept(f);birthday(f.w,f.child);if(change==='expiry')f.w.minute=c.expiresAt-1;
  choose(f.w,f.child,'accept');stepWorld(f.w,.75);assert.ok(f.child.activity&&f.child.activity.remaining<=.25);const terms=original(c),signatures=structuredClone(c.signatures),stock=physical(f.w);
  if(change==='age')unknown(f.child);else if(change==='capability')f.child.canExpress=false;
  stepWorld(f.w,.25);assert.ok(f.child.lastFailure);assert.deepEqual(c.signatures,signatures);assert.deepEqual(original(c),terms);assert.deepEqual(physical(f.w),stock);assert.equal(c.status,change==='expiry'?'expired':'accepted');
});

test('review: stopped unknown-age infant return cannot finish after reload or release the existing bed',()=>{
  let f=fixture(3);const c=depart(f);stepWorld(f.w,1);run(f.w,f.parent,'withdraw');assert.equal(c.status,'cancelled');choose(f.w,f.parent,'returnChild',a=>a.operation==='returnChild'&&a.personId===f.child.id);
  for(let i=0;!c.members.find(m=>m.personId===f.child.id)!.escorting&&i<20;i++)stepWorld(f.w,.25);assert.equal(c.members.find(m=>m.personId===f.child.id)!.escorting,true);
  unknown(f.child);f=bind(restore(f.w),f);const saved=f.w.familyRelocation!.agreements[0],before=physical(f.w);stepWorld(f.w,.25);assert.ok(f.parent.lastFailure);assert.equal(saved.members.find(m=>m.personId===f.child.id)!.escorting,false);assert.deepEqual(physical(f.w),before);assert.equal(f.child.homeId,f.old.id);assert.ok(f.old.residents.includes(f.child.id));
});

test('review: unsigned sixth birthday at the very last route step pauses before arrival or another ration',()=>{
  const f=fixture(),c=depart(f);for(let i=0;c.journey!.path.length>1&&i<100;i++)stepWorld(f.w,.25);assert.equal(c.journey!.path.length,1);assert.equal(c.status,'travelling');birthday(f.w,f.child);c.journey!.lastRationAt=f.w.minute-120;
  const before=physical(f.w),journey=structuredClone(c.journey);stepWorld(f.w,1);assert.equal(c.status,'paused');assert.deepEqual(physical(f.w),before);assert.deepEqual(c.journey,journey);assert.notDeepEqual(f.child.at,c.destination);assert.equal(f.child.homeId,f.old.id);
});

test('review: persisted real child signature never downgrades to infant proxy after a backwards birth correction',()=>{
  const f=fixture(7),c=accept(f),signatures=structuredClone(c.signatures),terms=original(c);f.child.bornAt=f.w.minute-3*YEAR;f.child.canDecide=f.child.canExpress=false;
  for(const op of ['escort','depart','returnChild'] as const)assert.equal(actions(f.w,f.parent).some(c=>c.action.operation===op),false);
  assert.ok(familyRelocationReason(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}));assert.deepEqual(c.signatures,signatures);assert.deepEqual(original(c),terms);
});

test('review: an unsigned infant whose age becomes unknown can actually refuse a known original proposal',()=>{
  const f=fixture(3),c=propose(f),terms=original(c),signatures=structuredClone(c.signatures);unknown(f.child);const before=physical(f.w);
  assert.equal(c.requiredSignerIds.includes(f.child.id),false);assert.equal(c.signatures.some(s=>s.personId===f.child.id),false);
  run(f.w,f.child,'withdraw');assert.equal(c.status,'cancelled');assert.deepEqual(c.signatures,signatures);assert.deepEqual(original(c),terms);assert.deepEqual(physical(f.w),before);
});

test('review: unknown remote owner withdrawal records only their choice until the family actually arrives',()=>{
  const f=fixture(7),c=depart(f);f.owner.at={x:22,y:16};unknown(f.owner);const before=actions(f.w,f.child),signatures=structuredClone(c.signatures),oldOwner=f.home.ownerId;
  run(f.w,f.owner,'withdraw');assert.equal(c.status,'travelling');assert.equal(c.revocations?.length,1);assert.equal(c.revocations![0].personId,f.owner.id);assert.deepEqual(c.signatures,signatures);assert.deepEqual(actions(f.w,f.child),before);assert.equal(f.home.ownerId,oldOwner);
  for(let i=0;String(c.status)==='travelling'&&i<100;i++)stepWorld(f.w,.25);assert.equal(c.status,'arrived');assert.equal(actions(f.w,f.parent).some(c=>c.action.operation==='arrive'),false);assert.equal(f.parent.homeId,f.old.id);assert.equal(f.child.homeId,f.old.id);
});

for(const reason of ['unknown child','changed owner'] as const)test(`review: final child registration after persisted parent arrival rechecks ${reason} and keeps original bed`,()=>{
  let f=fixture(7);const c=arrive(f);run(f.w,f.parent,'arrive',a=>a.operation==='arrive'&&a.personId===f.parent.id);choose(f.w,f.child,'arrive',a=>a.operation==='arrive'&&a.personId===f.child.id);stepWorld(f.w,.75);assert.ok(f.child.activity&&f.child.activity.remaining<=.25);
  if(reason==='unknown child')unknown(f.child);else f.home.ownerId=f.parent.id;
  f=bind(restore(f.w),f);const saved=f.w.familyRelocation!.agreements[0],before=physical(f.w),terms=original(saved),signatures=structuredClone(saved.signatures);stepWorld(f.w,.25);
  assert.ok(f.child.lastFailure);assert.equal(saved.status,'arrived');assert.equal(saved.members.find(m=>m.personId===f.child.id)!.arrivedAt,null);assert.deepEqual(physical(f.w),before);assert.deepEqual(original(saved),terms);assert.deepEqual(saved.signatures,signatures);assert.equal(f.w.rooms!.beds[f.old.id][f.child.id],1);assert.equal(f.parent.homeId,f.home.id);assert.equal(f.child.homeId,f.old.id);
});

test('review: an actual supplemental child signature cannot later be downgraded to infant proxy by a backwards date',()=>{
  const f=fixture(5),c=accept(f);birthday(f.w,f.child);run(f.w,f.child,'accept');const signatures=structuredClone(c.signatures),terms=original(c);assert.equal(c.members.find(m=>m.personId===f.child.id)!.requiresAssent,false);assert.ok(c.signatures.some(s=>s.personId===f.child.id));
  f.child.bornAt=f.w.minute-3*YEAR;f.child.canDecide=f.child.canExpress=false;
  for(const op of ['escort','depart','returnChild'] as const)assert.equal(actions(f.w,f.parent).some(c=>c.action.operation===op),false,op);
  assert.ok(familyRelocationReason(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}));assert.deepEqual(c.signatures,signatures);assert.deepEqual(original(c),terms);
});

test('review: a supplemental signer losing current age evidence pauses a live journey without turning into a carried passenger',()=>{
  const f=fixture(5),c=accept(f);birthday(f.w,f.child);run(f.w,f.child,'accept');run(f.w,f.parent,'depart');assert.equal(c.status,'travelling');
  f.child.bornAt=f.w.minute-3*YEAR;f.child.canDecide=f.child.canExpress=false;const before=physical(f.w),journey=structuredClone(c.journey),signatures=structuredClone(c.signatures);
  stepWorld(f.w,1);assert.equal(c.status,'paused');assert.deepEqual(physical(f.w),before);assert.deepEqual(c.journey,journey);assert.deepEqual(c.signatures,signatures);
});
