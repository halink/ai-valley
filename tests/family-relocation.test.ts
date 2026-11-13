import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {completeFamilyRelocation,familyRelocationReason,familyRelocationOpportunities,initializeFamilyRelocation} from '../src/world/family-relocation.js';
import {travellingFamily} from '../src/shared/family-relocation.js';
import {leasedBed,commonsLeaseCount} from '../src/shared/commons.js';
import {residentBed} from '../src/shared/rooms.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {completeAgency,advanceAgency} from '../src/world/agency.js';

import {DAY,YEAR} from '../src/world/time.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {decisionContext} from '../src/server/decisions.js';
import {buildChoices,parseChoice} from '../src/server/affordances.js';
import {initializeAdoption,completeAdoption} from '../src/world/adoption.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {FamilyRelocationAction} from '../src/shared/family-relocation.js';

function setup(age=9){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 const [parent,owner,child]=w.residents;
 w.map={width:24,height:18,name:'隔离家庭迁居夹具',entrance:{x:2,y:15},tiles:Array(24*18).fill('grass')};
 const old={...w.buildings[0],at:{x:2,y:3},door:{x:5,y:8},capacity:4,residents:[parent.id,child.id]};
 const home={...w.buildings[1],at:{x:14,y:3},door:{x:17,y:8},capacity:4,residents:[owner.id]};
 const hall={...w.buildings[3],at:{x:6,y:10},width:5,height:4,door:{x:8,y:14},capacity:4};
 w.buildings=[old,home,hall];w.resources=[];w.plots=[];w.graves=[];
 for(const p of w.residents){p.at={x:4,y:9};p.inside=null;p.roomAt=null;p.bornAt=w.minute-30*YEAR;p.homeId=p===owner?home.id:old.id;p.inventory={meal:20,water:20,berry:7};p.hunger=30;p.energy=p.health=100;p.canDecide=p.canExpress=true;p.knownBuildings=w.buildings.map(b=>b.id);p.knownPeople=w.residents.map(p=>p.id);p.plan=null;p.activity=null;}
 child.bornAt=w.minute-age*YEAR;child.parents=[parent.id];child.guardianIds=[parent.id];child.inventory={berry:7};child.canDecide=child.canExpress=age>=6;
 stepWorld(w,1);return {w,parent,owner,child,old,home,hall};
}
function act(w:World,r:Resident,a:FamilyRelocationAction){assert.equal(completeFamilyRelocation(w,r,a),null);}
function propose(f:ReturnType<typeof setup>,memberIds=[f.parent.id,f.child.id]){
 act(f.w,f.parent,{type:'familyRelocation',operation:'propose',memberIds,buildingId:f.home.id,departAfter:f.w.minute+5,departBefore:f.w.minute+240});return f.w.familyRelocation!.agreements.at(-1)!;
}
function sign(f:ReturnType<typeof setup>,c=propose(f)){
 for(const id of c.requiredSignerIds.filter(id=>id!==f.parent.id))act(f.w,f.w.residents.find(p=>p.id===id)!,{type:'familyRelocation',operation:'accept',relocationId:c.id});assert.equal(c.status,'accepted');return c;
}
let serial=0;
function run(w:World,r:Resident,action:Action,step=1){
 assert.ok(submitPlan(w,{id:'relocation-test:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'由本人作出的具体测试选择',actions:[action]}).ok);
 for(let i=0;(r.plan||r.activity)&&i<Math.ceil(100/step);i++)stepWorld(w,step);
 assert.equal(r.lastFailure,null);assert.equal(r.plan,null);assert.equal(r.activity,null);
}
function depart(f:ReturnType<typeof setup>,c=sign(f)){stepWorld(f.w,Math.max(0,c.departAfter-f.w.minute));run(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id});return c;}
function destination(f:ReturnType<typeof setup>,c=depart(f)){for(let n=0;c.status==='travelling'&&n<150;n++)stepWorld(f.w,1);assert.equal(c.status,'arrived');return c;}
function register(f:ReturnType<typeof setup>,c:ReturnType<typeof propose>){run(f.w,f.parent,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.parent.id});run(f.w,f.child.canDecide?f.child:f.parent,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.child.id});}

test('each guardian, owner and capable child separately accept one unchanged residence agreement',()=>{
 const f=setup(),c=propose(f);assert.deepEqual(new Set(c.requiredSignerIds),new Set([f.parent.id,f.owner.id,f.child.id]));
 act(f.w,f.owner,{type:'familyRelocation',operation:'accept',relocationId:c.id});assert.equal(c.status,'proposed');
 assert.ok(familyRelocationReason(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}));
 act(f.w,f.child,{type:'familyRelocation',operation:'decline',relocationId:c.id});assert.equal(c.status,'cancelled');assert.equal(f.child.homeId,f.old.id);assert.equal(f.parent.homeId,f.old.id);
 const again=propose(f);const guardian=structuredClone(f.owner);guardian.id='other-guardian';guardian.homeId=f.old.id;guardian.relations=[];f.w.residents.push(guardian);f.child.guardianIds.push(guardian.id);
 assert.ok(familyRelocationReason(f.w,f.owner,{type:'familyRelocation',operation:'accept',relocationId:again.id}));assert.equal(again.status,'proposed');
});

test('the real route consumes accepted carried supplies, retaining each old bed until individual arrival',()=>{
 const f=setup(),c=sign(f),before={stock:f.parent.inventory.meal,child:structuredClone(f.child.inventory),money:f.w.residents.map(p=>p.coins)};
 assert.equal(leasedBed(f.w,f.home.id,c.members[0].bed),true);assert.equal(commonsLeaseCount(f.w,f.home.id),2);
 depart(f,c);const first={...f.parent.at};assert.notDeepEqual(first,f.home.door);assert.equal(f.parent.inventory.meal,before.stock!-2);assert.deepEqual(f.child.inventory,before.child);
 stepWorld(f.w,1);assert.equal(Math.abs(f.parent.at.x-first.x)+Math.abs(f.parent.at.y-first.y),1);assert.deepEqual(f.parent.at,f.child.at);
 assert.equal(f.child.homeId,f.old.id);assert.ok(f.old.residents.includes(f.parent.id)&&f.old.residents.includes(f.child.id));
 destination(f,c);assert.equal(f.child.homeId,f.old.id);
 assert.ok(completeFamilyRelocation(f.w,f.child,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.child.id}));
 run(f.w,f.parent,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.parent.id});assert.equal(f.parent.homeId,f.home.id);assert.equal(f.child.homeId,f.old.id);assert.ok(f.old.residents.includes(f.child.id));
 run(f.w,f.child,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.child.id});assert.equal(c.status,'completed');assert.equal(f.child.homeId,f.home.id);assert.equal(residentBed(f.w,f.child,f.home),c.members[1].bed);assert.deepEqual(f.w.residents.map(p=>p.coins),before.money);assert.deepEqual(f.child.parents,[f.parent.id]);
});

test('roadblock pauses in place, resumes only by choice, and withdrawal never releases old lodging or teleports',()=>{
 const f=setup(),c=depart(f),next={...c.journey!.path[0]},at={...f.parent.at};f.w.map.tiles[next.y*f.w.map.width+next.x]='cliff';stepWorld(f.w,1);
 assert.equal(c.status,'paused');assert.deepEqual(f.parent.at,at);assert.equal(f.parent.homeId,f.old.id);assert.equal(f.child.homeId,f.old.id);
 f.w.map.tiles[next.y*f.w.map.width+next.x]='grass';stepWorld(f.w,1);assert.equal(c.status,'paused');
 run(f.w,f.parent,{type:'familyRelocation',operation:'resume',relocationId:c.id});assert.equal(c.status,'travelling');
 run(f.w,f.child,{type:'familyRelocation',operation:'withdraw',relocationId:c.id});assert.equal(c.status,'cancelled');const stopped={...f.child.at};stepWorld(f.w,3);assert.deepEqual(f.child.at,stopped);assert.equal(f.child.homeId,f.old.id);assert.equal(commonsLeaseCount(f.w,f.home.id),0);
});

test('actual assembly, idle participants, supply shortage, changed rights and fresh child assent are mandatory',()=>{
 for(const change of ['inside','busy','supplies','guardian','newAssent'] as const){const f=setup(change==='newAssent'?5:9),c=sign(f);stepWorld(f.w,5);
  if(change==='inside'){f.child.inside=f.old.id;f.child.roomAt={x:5,y:10};}
  if(change==='busy')f.child.plan={id:'independent',actorId:f.child.id,actorRevision:f.child.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'自己的事情',actions:[{type:'wait',minutes:60}]};
  if(change==='supplies')f.parent.inventory.water=0;
  if(change==='guardian')f.child.guardianIds.push(f.owner.id);
  if(change==='newAssent'){f.child.bornAt=f.w.minute-7*YEAR;f.child.canDecide=f.child.canExpress=true;}
  assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}),change);assert.equal(c.status,'accepted');assert.equal(f.child.homeId,f.old.id);
 }
});

test('under-six child is escorted without inventing consent or replacing identity; visitors settle only at arrival',()=>{
 const f=setup(2);f.parent.residency=f.child.residency='visitor';const before={id:f.child.id,bornAt:f.child.bornAt,inventory:structuredClone(f.child.inventory),parents:[...f.child.parents]};const c=sign(f);
 assert.ok(!c.requiredSignerIds.includes(f.child.id));destination(f,depart(f,c));assert.equal(f.child.residency,'visitor');register(f,c);assert.equal(f.child.residency,'resident');assert.equal(f.parent.residency,'resident');assert.deepEqual({id:f.child.id,bornAt:f.child.bornAt,inventory:f.child.inventory,parents:f.child.parents},before);
});

test('an accepted journey cannot consume another bed lease, be hijacked into free movement, or rewrite model terms',()=>{
 const f=setup(),c=sign(f);f.w.commons!.stays.push({id:'competing',residentId:'other',buildingId:f.home.id,bed:c.members[1].bed,startedAt:f.w.minute,expiresAt:f.w.minute+1000,endedAt:null,reason:null});
 const other=structuredClone(f.owner);other.id='other';f.w.residents.push(other);assert.equal(leasedBed(f.w,f.home.id,c.members[1].bed,f.child.id),true);f.w.commons!.stays=[];
 const choice=familyRelocationOpportunities(f.w,f.child).find(c=>c.action.type==='familyRelocation'&&c.action.operation==='withdraw')!;assert.ok(choice);assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,relocationId:'other'}),[choice]));
 depart(f,c);assert.ok(travellingFamily(f.w,f.child.id));const actions=buildChoices(decisionContext(f.w,f.child));assert.ok(actions.some(a=>a.action.type==='familyRelocation'&&a.action.operation==='withdraw'));assert.ok(actions.every(a=>a.action.type==='wait'||a.action.type==='familyRelocation'));
 const result=submitPlan(f.w,{id:'hijack',actorId:f.child.id,actorRevision:f.child.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'另行走动',actions:[{type:'move',to:{x:2,y:2}}]});assert.equal(result.ok,false);
});

test('registered adoption is not co-residence consent; a new arrangement needs all original guardians and child',()=>{
 const f=setup();initializeAdoption(f.w);assert.equal(completeAdoption(f.w,f.owner,{type:'adoption',operation:'propose',childId:f.child.id}),null);const adoption=f.w.adoption!.agreements.at(-1)!;
 for(const r of [f.parent,f.child])assert.equal(completeAdoption(f.w,r,{type:'adoption',operation:'consent',adoptionId:adoption.id,accept:true}),null);
 f.owner.at={...f.hall.door};assert.equal(completeAdoption(f.w,f.owner,{type:'adoption',operation:'register',adoptionId:adoption.id,buildingId:f.hall.id}),null);assert.equal(f.child.homeId,f.old.id);
 f.owner.at={...f.parent.at};act(f.w,f.owner,{type:'familyRelocation',operation:'propose',buildingId:f.home.id,memberIds:[f.owner.id,f.child.id],departAfter:f.w.minute+5,departBefore:f.w.minute+240});const c=f.w.familyRelocation!.agreements.at(-1)!;
 assert.deepEqual(new Set(c.requiredSignerIds),new Set([f.owner.id,f.parent.id,f.child.id]));assert.equal(c.status,'proposed');assert.equal(f.child.homeId,f.old.id);assert.ok(familyRelocationOpportunities(f.w,f.child).some(o=>o.action.type==='familyRelocation'&&o.action.operation==='accept'));
});

test('restart resumes the same physical journey and retains signature evidence after memory rollover',()=>{
 const f=setup(),c=depart(f);stepWorld(f.w,3);for(const p of f.w.residents)p.memories=[];
 for(let i=0;i<200;i++)f.w.events.push({id:'later:'+i,at:f.w.minute+1000,kind:'system',actors:[],place:{x:1,y:1},text:'测试后续事件',witnesses:[]});
 const retained=workingEvents(f.w);assert.ok(c.signatures.every(s=>retained.some(e=>e.id===s.eventId)));
 const db=new WorldStore(':memory:');db.commit(f.w,null);const restored=db.load(true)!;db.close();const saved=restored.familyRelocation!.agreements[0];assert.deepEqual(saved.journey,c.journey);const before={...restored.residents[0].at};stepWorld(restored,1);assert.notDeepEqual(restored.residents[0].at,before);assert.equal(restored.residents[2].homeId,f.old.id);
 initializeFamilyRelocation(restored);assert.equal(restored.familyRelocation!.agreements.length,1);
});

test('guardian actually collects a nearby infant and exits indoors before assembly, then can return after cancellation',()=>{
 const f=setup(2);f.home.ownerId=f.parent.id;
 for(const p of [f.parent,f.child]){p.at={...f.old.door};p.inside=f.old.id;p.roomAt={x:p===f.parent?4:5,y:10};}
 const c=propose(f);assert.equal(c.status,'accepted');assert.ok(familyRelocationOpportunities(f.w,f.parent).some(o=>o.action.type==='familyRelocation'&&o.action.operation==='escort'));
 assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}));
 const start={...f.child.roomAt!};assert.ok(submitPlan(f.w,{id:'indoor-pickup',actorId:f.parent.id,actorRevision:f.parent.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'实际抱送孩子到户外集合点',actions:[{type:'familyRelocation',operation:'escort',relocationId:c.id,personId:f.child.id}]}).ok);
 stepWorld(f.w,1);assert.equal(f.child.inside,f.old.id);assert.deepEqual(f.child.roomAt,start);
 for(let i=0;f.parent.plan&&i<60;i++)stepWorld(f.w,1);assert.equal(f.parent.lastFailure,null);assert.equal(f.child.inside,null);assert.deepEqual(f.child.at,c.assembly);assert.equal(f.child.homeId,f.old.id);
 depart(f,c);stepWorld(f.w,2);run(f.w,f.parent,{type:'familyRelocation',operation:'withdraw',relocationId:c.id});const stopped={...f.child.at};assert.notDeepEqual(stopped,f.old.door);
 assert.ok(familyRelocationOpportunities(f.w,f.parent).some(o=>o.action.type==='familyRelocation'&&o.action.operation==='returnChild'));
 run(f.w,f.parent,{type:'familyRelocation',operation:'returnChild',relocationId:c.id,personId:f.child.id});assert.equal(f.child.inside,f.old.id);assert.equal(f.child.homeId,f.old.id);assert.notEqual(f.child.roomAt,null);assert.equal(c.status,'cancelled');
});

test('a blocked infant room cannot be bypassed by pickup, including an obstructed route after pickup',()=>{
 for(const afterPickup of [false,true]){const f=setup(2);f.home.ownerId=f.parent.id;
  for(const p of [f.parent,f.child]){p.at={...f.old.door};p.inside=f.old.id;p.roomAt={x:4,y:10};}
  const c=propose(f),a:FamilyRelocationAction={type:'familyRelocation',operation:'escort',relocationId:c.id,personId:f.child.id};
  if(afterPickup){assert.ok(submitPlan(f.w,{id:'pickup-block-'+serial++,actorId:f.parent.id,actorRevision:f.parent.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'真实接送',actions:[a]}).ok);stepWorld(f.w,1);assert.equal(c.members[1].escorting,true);}
  for(const [i,at]of [{x:3,y:10},{x:5,y:10},{x:4,y:9},{x:4,y:11}].entries()){const body=structuredClone(f.owner);body.id='blocked-body-'+i;body.status='dead';body.at={...f.old.door};body.inside=f.old.id;body.roomAt=at;body.body={storedAt:f.old.id,reservedBy:null,carriedBy:null};f.w.residents.push(body);}
  if(afterPickup){stepWorld(f.w,1);assert.ok(f.parent.lastFailure);}else assert.ok(familyRelocationReason(f.w,f.parent,a));
  assert.equal(f.parent.inside,f.old.id);assert.equal(f.child.inside,f.old.id);assert.deepEqual(f.child.roomAt,{x:4,y:10});
 }
});

test('different food lots nourish each traveler only for their actually consumed portion',()=>{
 const f=setup(),c=sign(f);f.w.definitions['food/test-low@1']={id:'food/test-low',version:1,kind:'life',dependencies:[],data:{nutrition:{meal:2}}};
 f.w.definitions['food/test-high@1']={id:'food/test-high',version:1,kind:'life',dependencies:[],data:{nutrition:{meal:30}}};
 f.w.food!.lots['person:'+f.parent.id]!.meal=[{quantity:1,producedAt:f.w.minute,expiresAt:f.w.minute+2000,definition:'food/test-high@1'},{quantity:19,producedAt:f.w.minute,expiresAt:f.w.minute+3000,definition:'food/test-low@1'}];
 f.parent.hunger=f.child.hunger=90;f.w.minute=c.departAfter;act(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id});assert.equal(f.parent.hunger,60);assert.equal(f.child.hunger,88);assert.equal(f.parent.inventory.meal,18);
});

test('remote withdrawal preserves autonomy without remotely stopping travelers or revealing it in their menu',()=>{
 const f=setup(),c=depart(f);f.owner.at={x:22,y:16};const before=familyRelocationOpportunities(f.w,f.child).map(o=>o.id);
 act(f.w,f.owner,{type:'familyRelocation',operation:'withdraw',relocationId:c.id});assert.equal(c.revocations?.length,1);assert.equal(c.status,'travelling');assert.equal(commonsLeaseCount(f.w,f.home.id),0);assert.deepEqual(familyRelocationOpportunities(f.w,f.child).map(o=>o.id),before);
 destination(f,c);assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.parent.id}));assert.equal(f.parent.homeId,f.old.id);assert.equal(f.child.homeId,f.old.id);
});

test('remote destination damage is found at arrival, while signed terms remain explicit after memory rollover',()=>{
 const f=setup(),c=propose(f);for(const p of f.w.residents)p.memories=[];const accept=familyRelocationOpportunities(f.w,f.child).find(o=>o.action.type==='familyRelocation'&&o.action.operation==='accept')!;
 assert.ok(accept.label.includes(f.parent.name)&&accept.label.includes(f.child.name)&&accept.label.includes('集合点')&&accept.label.includes('第2床'));
 sign(f,c);depart(f,c);f.home.condition=0;destination(f,c);assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.parent.id}));assert.equal(f.parent.homeId,f.old.id);
});

test('family travel preserves armed routine uses and physical escort',()=>{
 const f=setup(),c=depart(f);assert.equal(completeAgency(f.w,f.parent,{type:'agency',operation:'arm',routineAction:{type:'eat',item:'berry'},threshold:1,days:1,uses:3,cooldown:60}),null);
 f.parent.hunger=50;const routine=f.parent.agency!.routines[0];assert.deepEqual(advanceAgency(f.w),[]);assert.equal(routine.remaining,3);assert.equal(routine.attempted,0);assert.equal(routine.pendingPlanId,null);

 act(f.w,f.parent,{type:'familyRelocation',operation:'withdraw',relocationId:c.id});assert.equal(advanceAgency(f.w).length,1);assert.equal(routine.remaining,2);
 const baby=setup(2);baby.child.at.x++;const trip=sign(baby);assert.ok(submitPlan(baby.w,{id:'status-escort',actorId:baby.parent.id,actorRevision:baby.parent.revision,createdAt:baby.w.minute,definition:baby.w.activeDefinitions['action/routine'],intention:'接送孩子',actions:[{type:'familyRelocation',operation:'escort',relocationId:trip.id,personId:baby.child.id}]}).ok);stepWorld(baby.w,2);
});

test('two infants need two independently agreeing guardians, each carrying their own assigned supply',()=>{
 const f=setup(2),second=structuredClone(f.child);second.id='second-child';second.name='第二个孩子';f.w.residents.push(second);f.parent.knownPeople.push(second.id);f.owner.knownPeople.push(second.id);f.child.guardianIds.push(f.owner.id);second.guardianIds.push(f.owner.id);f.home.capacity=4;
 assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'propose',buildingId:f.home.id,memberIds:[f.parent.id,f.child.id,second.id],departAfter:f.w.minute+5,departBefore:f.w.minute+240}));
 const c=propose(f,[f.parent.id,f.owner.id,f.child.id,second.id]);assert.equal(c.members.find(m=>m.personId===f.child.id)!.caregiverId,f.parent.id);assert.equal(c.members.find(m=>m.personId===second.id)!.caregiverId,f.owner.id);sign(f,c);const first=f.parent.inventory.meal!,other=f.owner.inventory.meal!;depart(f,c);assert.equal(f.parent.inventory.meal,first-2);assert.equal(f.owner.inventory.meal,other-2);
});

test('a model-selected proposal tolerates an elapsed earliest-departure time while the fixed window is still open',()=>{
 const f=setup(),choice=familyRelocationOpportunities(f.w,f.parent).find(o=>o.action.type==='familyRelocation'&&o.action.operation==='propose')!;assert.ok(choice);
 const selected=parseChoice(JSON.stringify({choice:choice.id}),[choice]).actions[0] as FamilyRelocationAction;stepWorld(f.w,6);act(f.w,f.parent,selected);assert.equal(f.w.familyRelocation!.agreements[0].departAfter,(choice.action as Extract<FamilyRelocationAction,{operation:'propose'}>).departAfter);
});

test('fractional engine ticks retain normal family choices through delayed consent and actual individual arrival',()=>{
 const f=setup();
 const choose=(r:Resident,operation:FamilyRelocationAction['operation'])=>{
  const choices=buildChoices(decisionContext(f.w,r)),choice=choices.find(o=>o.action.type==='familyRelocation'&&o.action.operation===operation&&(o.action.operation!=='propose'||o.action.buildingId===f.home.id));
  assert.ok(choice,`${operation} remains available at ${f.w.minute}`);
  return {choice,action:parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as FamilyRelocationAction};
 };
 // Use runtime-sized steps, including accumulated floating-point error near a whole minute.
 for(let n=0;n<11;n++){
  stepWorld(f.w,.2);const {action}=choose(f.parent,'propose');assert.equal(action.operation,'propose');
  if(action.operation==='propose'){assert.equal(action.departAfter,f.w.minute+5);assert.equal(action.departBefore,f.w.minute+240);}
 }
 assert.equal(Number.isInteger(f.w.minute),false);
 const {choice,action}=choose(f.parent,'propose');assert.equal(action.operation,'propose');if(action.operation!=='propose')return;
 const original=structuredClone(action),stock=f.parent.inventory.meal!,water=f.parent.inventory.water!,at={...f.parent.at};
 for(const key of ['departAfter','departBefore'])assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,[key]:f.w.minute+10}),[choice]));
 for(let n=0;n<31;n++)stepWorld(f.w,.2);
 assert.ok(f.w.minute>original.departAfter);run(f.w,f.parent,action,.2);
 const c=f.w.familyRelocation!.agreements.at(-1)!;assert.ok(c);assert.equal(c.status,'proposed');
 assert.equal(c.departAfter,original.departAfter);assert.equal(c.departBefore,original.departBefore);assert.equal(c.expiresAt,original.departBefore+DAY);
 assert.equal(c.signatures.length,1);assert.equal(commonsLeaseCount(f.w,f.home.id),0);
 for(const r of [f.owner,f.child])run(f.w,r,choose(r,'accept').action,.2);
 assert.equal(c.status,'accepted');assert.equal(c.signatures.length,3);assert.equal(commonsLeaseCount(f.w,f.home.id),2);
 assert.equal(c.departAfter,original.departAfter);assert.equal(c.departBefore,original.departBefore);
 run(f.w,f.parent,choose(f.parent,'depart').action,.2);assert.equal(c.status,'travelling');
 assert.deepEqual(f.parent.at,at);assert.equal(f.parent.inventory.meal,stock-2);assert.equal(f.parent.inventory.water,water-2);
 for(let n=0;c.status==='travelling'&&n<200;n++){
  stepWorld(f.w,.2);assert.deepEqual(f.parent.at,f.child.at);assert.equal(f.child.homeId,f.old.id);
 }
 assert.equal(c.status,'arrived');assert.deepEqual(f.parent.at,f.home.door);assert.equal(f.parent.homeId,f.old.id);
 run(f.w,f.parent,choose(f.parent,'arrive').action,.2);assert.equal(f.parent.homeId,f.home.id);assert.equal(f.child.homeId,f.old.id);
 run(f.w,f.child,choose(f.child,'arrive').action,.2);assert.equal(c.status,'completed');assert.equal(f.child.homeId,f.home.id);
 assert.equal(f.parent.inventory.meal,stock-2);assert.equal(f.parent.inventory.water,water-2);
});

test('fractional departure timestamps retain finite values, ordering and the one-day limits',()=>{
 const f=setup();stepWorld(f.w,.2);const now=f.w.minute;
 const action:Extract<FamilyRelocationAction,{operation:'propose'}>={type:'familyRelocation',operation:'propose',buildingId:f.home.id,memberIds:[f.parent.id,f.child.id],departAfter:now+5,departBefore:now+240};
 assert.equal(familyRelocationReason(f.w,f.parent,action),null);
 assert.equal(familyRelocationReason(f.w,f.parent,{...action,departAfter:Math.ceil(now)+5,departBefore:Math.ceil(now)+240}),null);
 assert.equal(familyRelocationReason(f.w,f.parent,{...action,departAfter:now-1}),null);
 assert.equal(familyRelocationReason(f.w,f.parent,{...action,departBefore:now+DAY}),null);
 const invalid:Array<Partial<typeof action>>=[
  ...[NaN,Infinity,-Infinity,undefined,null,'486.2',{}].flatMap(value=>[{departAfter:value},{departBefore:value}]) as Array<Partial<typeof action>>,
  {departAfter:-.2},{departAfter:action.departBefore},{departAfter:action.departBefore+.2},
  {departBefore:now},{departBefore:now-.2},{departBefore:now+DAY+.2},{departAfter:0,departBefore:DAY+.2}
 ];
 for(const change of invalid){
  const bad={...action,...change};assert.equal(familyRelocationReason(f.w,f.parent,bad),'须指定未来一天内的实际出发时段');
  assert.equal(completeFamilyRelocation(f.w,f.parent,bad),'须指定未来一天内的实际出发时段');
 }
 assert.equal(f.w.familyRelocation!.agreements.length,0);
});

test('pending and signed fractional departure windows survive SQLite reload without rebasing or duplicate proposals',()=>{
 const f=setup();stepWorld(f.w,.2);
 const choices=buildChoices(decisionContext(f.w,f.parent)),choice=choices.find(o=>o.action.type==='familyRelocation'&&o.action.operation==='propose'&&o.action.buildingId===f.home.id)!;assert.ok(choice);
 const action=parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as Extract<FamilyRelocationAction,{operation:'propose'}>;
 assert.ok(submitPlan(f.w,{id:'fractional-reload',actorId:f.parent.id,actorRevision:f.parent.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'保留本人选择的实际出发时段',actions:[action]}).ok);
 const db=new WorldStore(':memory:');try{
  db.commit(f.w,null);const restored=db.load(true)!,parent=restored.residents.find(r=>r.id===f.parent.id)!,revision=restored.revision;
  assert.equal(restored.minute,f.w.minute);assert.deepEqual(parent.plan!.actions,[action]);
  for(let n=0;(parent.plan||parent.activity)&&n<20;n++)stepWorld(restored,.2);
  assert.equal(parent.lastFailure,null);assert.equal(restored.familyRelocation!.agreements.length,1);
  const c=restored.familyRelocation!.agreements[0];assert.equal(c.departAfter,action.departAfter);assert.equal(c.departBefore,action.departBefore);assert.equal(c.expiresAt,action.departBefore+DAY);
  assert.equal(Number.isInteger(c.createdAt),false);assert.equal(c.signatures[0].at,c.createdAt);
  db.commit(restored,revision);const again=db.load(true)!;assert.deepEqual(again.familyRelocation!.agreements[0],c);
  stepWorld(again,.2);assert.equal(again.familyRelocation!.agreements.length,1);assert.equal(again.familyRelocation!.agreements[0].departBefore,action.departBefore);
 }finally{db.close();}
});

test('fractional proposal and departure actions recheck their fixed deadlines at actual completion',()=>{
 const f=setup();stepWorld(f.w,.2);const now=f.w.minute;
 const action:Extract<FamilyRelocationAction,{operation:'propose'}>={type:'familyRelocation',operation:'propose',buildingId:f.home.id,memberIds:[f.parent.id,f.child.id],departAfter:now+.1,departBefore:now+.6};
 assert.equal(familyRelocationReason(f.w,f.parent,action),null);
 assert.ok(submitPlan(f.w,{id:'expires-during-proposal',actorId:f.parent.id,actorRevision:f.parent.revision,createdAt:now,definition:f.w.activeDefinitions['action/routine'],intention:'完成前窗口已结束',actions:[action]}).ok);
 for(let n=0;(f.parent.plan||f.parent.activity)&&n<20;n++)stepWorld(f.w,.2);
 assert.equal(f.parent.lastFailure,'须指定未来一天内的实际出发时段');assert.equal(f.w.familyRelocation!.agreements.length,0);
 const g=setup();stepWorld(g.w,.2);const c=sign(g),departAction:FamilyRelocationAction={type:'familyRelocation',operation:'depart',relocationId:c.id};
 assert.ok(familyRelocationReason(g.w,g.parent,departAction));
 stepWorld(g.w,c.departAfter-g.w.minute);assert.equal(familyRelocationReason(g.w,g.parent,departAction),null);
 assert.equal(familyRelocationReason({...g.w,minute:c.departBefore},g.parent,departAction),null);
 stepWorld(g.w,c.departBefore-g.w.minute-.6);assert.equal(familyRelocationReason(g.w,g.parent,departAction),null);
 const stock={...g.parent.inventory},at={...g.parent.at};
 assert.ok(submitPlan(g.w,{id:'expires-before-departure',actorId:g.parent.id,actorRevision:g.parent.revision,createdAt:g.w.minute,definition:g.w.activeDefinitions['action/routine'],intention:'完成前已错过最后启程时刻',actions:[departAction]}).ok);
 stepWorld(g.w,.2);assert.equal(g.parent.activity?.action.type,'familyRelocation');assert.equal(c.status,'accepted');assert.ok(g.w.minute<c.departBefore);
 for(let n=0;(g.parent.plan||g.parent.activity)&&n<20;n++)stepWorld(g.w,.2);
 assert.equal(g.parent.lastFailure,'尚未到约定出发时段或集合点');assert.equal(c.status,'accepted');assert.equal(c.startedAt,null);assert.deepEqual(g.parent.inventory,stock);assert.deepEqual(g.parent.at,at);
});

test('a revoked owners silent or incapacitated proximity does not invent delivery of their notice',()=>{
 const f=setup(),c=depart(f);f.owner.at={x:22,y:16};act(f.w,f.owner,{type:'familyRelocation',operation:'withdraw',relocationId:c.id});f.owner.at={...f.parent.at};f.owner.canExpress=false;stepWorld(f.w,1);assert.equal(c.status,'travelling');
 f.owner.canExpress=true;f.owner.at={...f.parent.at};act(f.w,f.owner,{type:'familyRelocation',operation:'withdraw',relocationId:c.id});assert.equal(c.status,'cancelled');
});

test('a child who loses the ability to participate stops the journey instead of becoming an unchosen passenger',()=>{
 const f=setup(),c=depart(f),at={...f.child.at};f.child.canDecide=f.child.canExpress=false;stepWorld(f.w,1);assert.equal(c.status,'paused');assert.deepEqual(f.child.at,at);assert.equal(f.child.homeId,f.old.id);
});

test('returning an infant rechecks the real retained bed after room entry before claiming success',()=>{
 const f=setup(2),c=depart(f);stepWorld(f.w,2);act(f.w,f.parent,{type:'familyRelocation',operation:'withdraw',relocationId:c.id});
 assert.ok(submitPlan(f.w,{id:'return-bed-race',actorId:f.parent.id,actorRevision:f.parent.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'送回原床',actions:[{type:'familyRelocation',operation:'returnChild',relocationId:c.id,personId:f.child.id}]}).ok);
 for(let n=0;f.parent.inside!==f.old.id&&n<80;n++)stepWorld(f.w,1);assert.equal(f.parent.inside,f.old.id);assert.ok(f.parent.activity?.room?.path.length);const at={...f.parent.roomAt!};f.old.capacity=0;stepWorld(f.w,1);assert.ok(f.parent.lastFailure);assert.deepEqual(f.parent.roomAt,at);assert.ok(!f.w.events.some(e=>e.text.includes('送回仍保留的原住所实际床位')));assert.equal(f.child.homeId,f.old.id);
});

test('walking does not invalidate a participant still deciding whether to stop the accepted journey',()=>{
 const f=setup(),c=depart(f),revision=f.child.revision;stepWorld(f.w,3);
 assert.equal(submitPlan(f.w,{id:'delayed-withdraw',actorId:f.child.id,actorRevision:revision,createdAt:f.w.minute-3,definition:f.w.activeDefinitions['action/routine'],intention:'本人选择停止同行',actions:[{type:'familyRelocation',operation:'withdraw',relocationId:c.id}]}).ok,true);stepWorld(f.w,1);assert.equal(c.status,'cancelled');
});
