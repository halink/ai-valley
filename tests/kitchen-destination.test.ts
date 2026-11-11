import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {publicKitchenReason} from '../src/world/public-duties.js';
import {buildChoices,parseChoice} from '../src/server/affordances.js';
import {decisionContext,parseDecision} from '../src/server/decisions.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {atWorkstation} from './helpers/workspaces.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;initializeRooms(w);
 const r=w.residents[0],hall=w.buildings.find(b=>b.kind==='lodge')!,unknown=w.buildings.find(b=>b.kind==='workshop')!;
 r.homeId=null;r.knownBuildings=[hall.id];r.inventory={turnip:2,water:1};r.hunger=0;r.health=100;r.energy=80;
 r.at={...w.map.entrance};r.inside=null;r.roomAt=null;
 unknown.kind='lodge';unknown.ownerId='commons';unknown.condition=100;
 return {w,r,hall,unknown};
}
function plan(w:World,r:Resident,action:Action){return {id:`cook:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择去已知厨房做饭',actions:[action]};}
function finish(w:World,r:Resident){let guard=400;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}}
function choice(w:World,r:Resident){return buildChoices(decisionContext(w,r)).find(c=>c.action.type==='cook')!;}

test('a remote cooking choice binds its known kitchen and never redirects to an unknown intact lodge',()=>{
 const {w,r,hall,unknown}=fixture(),selected=choice(w,r);assert.ok(selected);
 assert.ok(!r.knownBuildings.includes(unknown.id));
 assert.deepEqual(selected.action,{type:'cook',quantity:1,buildingId:hall.id});assert.match(selected.label,new RegExp(hall.name));
 const decoded=parseChoice(JSON.stringify({choice:selected.id}),[selected]);assert.deepEqual(decoded.actions,[selected.action]);
 assert.throws(()=>parseChoice(JSON.stringify({choice:selected.id,buildingId:unknown.id}),[selected]));
 hall.condition=0;assert.deepEqual(choice(w,r),selected,'unseen damage does not change the known-destination choice');
 const p=plan(w,r,selected.action),before=JSON.stringify(w);
 assert.match(planStartError(w,p)!,/厨房已损坏/);assert.equal(JSON.stringify(w),before);
 assert.ok(submitPlan(w,p).ok);stepWorld(w,1);
 assert.match(r.lastFailure!,/厨房已损坏/);assert.equal(r.activity,null);assert.deepEqual(r.at,w.map.entrance);
 assert.equal(r.inside,null);assert.deepEqual(r.inventory,{turnip:2,water:1});
});

test('a chosen kitchen is revalidated at arrival before entering, with no substitution or ingredient loss',()=>{
 for(const change of ['damage','permission'] as const){
  const {w,r,hall}=fixture();assert.ok(submitPlan(w,plan(w,r,choice(w,r).action)).ok);stepWorld(w,1);
  assert.ok(r.activity!.path.length);assert.deepEqual(r.activity!.target,hall.door);
  if(change==='damage')hall.condition=0;else hall.ownerId='another-household';
  finish(w,r);assert.match(r.lastFailure!,/厨房已损坏或本人没有使用权/);
  assert.deepEqual(r.at,hall.door);assert.equal(r.inside,null);assert.deepEqual(r.inventory,{turnip:2,water:1});
 }
});

test('the exact selected kitchen controls its room station even when another building shares the doorway',()=>{
 const {w,r,hall,unknown}=fixture();unknown.door={...hall.door};w.buildings=[unknown,...w.buildings.filter(b=>b.id!==unknown.id)];
 r.at={...hall.door};assert.ok(submitPlan(w,plan(w,r,choice(w,r).action)).ok);stepWorld(w,1);
 assert.equal(r.inside,hall.id);assert.equal(r.activity!.room!.buildingId,hall.id);
 finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.inside,hall.id);assert.equal(r.inventory.meal,1);
});

test('workstation setup respects an explicit non-home kitchen, including shared doorways, without skipping outdoor travel',()=>{
 for(const sharedDoor of [false,true]){
  const {w,r,hall}=fixture(),home=w.buildings.find(b=>b.ownerId===r.id&&b.kind==='home')!;r.homeId=home.id;
  if(sharedDoor)home.door={...hall.door};
  r.at={...hall.door};const action:Action={type:'cook',quantity:1,buildingId:hall.id};atWorkstation(w,r,action);
  assert.equal(r.inside,hall.id);assert.deepEqual(r.at,hall.door);
  assert.deepEqual(r.roomAt,roomLayout(w,hall).slots.find(s=>s.key==='kitchen')!.at);
  assert.equal(r.activity,null);assert.equal(r.plan,null);assert.deepEqual(action,{type:'cook',quantity:1,buildingId:hall.id});
 }
 const {w,r,hall}=fixture(),home=w.buildings.find(b=>b.ownerId===r.id&&b.kind==='home')!;r.homeId=home.id;r.at={...home.door};
 atWorkstation(w,r,{type:'cook',quantity:1,buildingId:hall.id});assert.equal(r.inside,null);assert.deepEqual(r.at,home.door);
 atWorkstation(w,r,{type:'cook',quantity:1});assert.equal(r.inside,home.id,'unbound legacy setup still uses the registered home');
 hall.door={...home.door};hall.width=14;r.inside=hall.id;r.roomAt={...roomLayout(w,hall).entry};
 const unbound:Action={type:'cook',quantity:1};atWorkstation(w,r,unbound);
 assert.equal(r.inside,home.id);assert.deepEqual(r.roomAt,roomLayout(w,home).slots.find(s=>s.key==='kitchen')!.at);
 assert.notDeepEqual(r.roomAt,roomLayout(w,hall).slots.find(s=>s.key==='kitchen')!.at);
 assert.deepEqual(unbound,{type:'cook',quantity:1},'synthetic setup binding must not mutate the caller’s legacy action');
});

test('two distinct kitchens sharing a doorway support actual concurrent cooking in either resident order',()=>{
 for(const reverse of [false,true]){
  const {w,r,hall,unknown}=fixture(),other=w.residents[1];unknown.door={...hall.door};
  other.homeId=null;other.knownBuildings=[unknown.id];other.inventory={turnip:2,water:1};
  for(const person of [r,other]){person.at={...hall.door};person.inside=null;person.roomAt=null;person.hunger=0;person.energy=80;person.health=100;}
  if(reverse)w.residents.reverse();
  for(const person of [r,other])assert.ok(submitPlan(w,plan(w,person,choice(w,person).action)).ok);
  stepWorld(w,1);assert.equal(r.lastFailure,null);assert.equal(other.lastFailure,null);
  assert.equal(r.inside,hall.id);assert.equal(other.inside,unknown.id);
  let guard=100;while([r,other].some(p=>p.plan||p.activity)){assert.ok(guard--);stepWorld(w,1);}
  for(const person of [r,other]){assert.equal(person.lastFailure,null);assert.equal(person.inventory.meal,1);assert.equal(person.inventory.turnip,0);assert.equal(person.inventory.water,0);}
  assert.equal(r.inside,hall.id);assert.equal(other.inside,unknown.id);
 }
});

test('legacy cooking occupies its actual saved room, while an exit from another room does not reserve the destination kitchen',()=>{
 const {w,r,hall,unknown}=fixture(),other=w.residents[1];unknown.door={...hall.door};
 other.at={...hall.door};other.inside=unknown.id;other.roomAt={...roomLayout(w,unknown).slots.find(s=>s.key==='kitchen')!.at};
 other.activity={planId:'legacy-cook',action:{type:'cook',quantity:1},startedAt:w.minute-5,remaining:15,path:[],target:{...unknown.door},definition:'recipe/meal@1'};
 assert.equal(publicKitchenReason(w,r,hall.id),null);assert.match(publicKitchenReason(w,r,unknown.id)!,/实际烹饪/);
 const store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load()!,person=loaded.residents.find(p=>p.id===r.id)!;
  assert.equal(publicKitchenReason(loaded,person,hall.id),null);assert.match(publicKitchenReason(loaded,person,unknown.id)!,/实际烹饪/);
 }finally{store.close();}
 other.activity.action={type:'cook',quantity:1,buildingId:hall.id};
 other.activity.room={buildingId:unknown.id,mode:'exit',path:[{...roomLayout(w,unknown).entry}],target:{...roomLayout(w,unknown).entry},progress:0};
 assert.equal(publicKitchenReason(w,r,hall.id),null,'the destination is not occupied while its cook is still exiting another room');
});

test('a legacy unbound plan uses known kitchens only, and a legacy underway trip keeps its saved destination after reload',()=>{
 const {w,r,hall,unknown}=fixture();r.knownBuildings=[];
 assert.match(planStartError(w,plan(w,r,{type:'cook',quantity:1}))!,/已知厨房/);
 r.knownBuildings=[hall.id];assert.ok(submitPlan(w,plan(w,r,{type:'cook',quantity:1})).ok);stepWorld(w,1);
 assert.equal(r.activity!.action.type,'cook');const action=r.activity!.action as Extract<Action,{type:'cook'}>;
 assert.equal(action.buildingId,hall.id,'newly started legacy action is bound once');delete action.buildingId;
 r.homeId=unknown.id;unknown.residents.push(r.id);
 const store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load()!,person=loaded.residents.find(p=>p.id===r.id)!;
  assert.deepEqual(person.activity!.target,hall.door);finish(loaded,person);
  assert.equal(person.lastFailure,null);assert.equal(person.inside,hall.id);assert.equal(person.inventory.meal,1);
 }finally{store.close();}
});

test('an optional kitchen ID is validated and never grants access to a known private kitchen',()=>{
 const {w,r,unknown}=fixture();
 const decision=(buildingId:unknown)=>JSON.stringify({intention:'本人指定厨房',actions:[{type:'cook',quantity:1,buildingId}]});
 for(const id of ['',null,42,{},'x'.repeat(101)])assert.throws(()=>parseDecision(decision(id)));
 assert.equal((parseDecision(decision(unknown.id)).actions[0] as Extract<Action,{type:'cook'}>).buildingId,unknown.id);
 assert.match(planStartError(w,plan(w,r,{type:'cook',quantity:1,buildingId:unknown.id}))!,/尚未知道/);
 r.knownBuildings.push(unknown.id);unknown.ownerId='another-household';
 assert.match(planStartError(w,plan(w,r,{type:'cook',quantity:1,buildingId:unknown.id}))!,/没有使用权/);
});
