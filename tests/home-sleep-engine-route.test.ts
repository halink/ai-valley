import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeEngineRoute} from './helpers/home-engine-route.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {roomLayout,residentBed} from '../src/shared/rooms.js';

test('actual engine enters home and reaches the recorded bed before sleep work or recovery',()=>{
 const route=homeEngineRoute(),w=structuredClone(route.snapshots.at(-1)!.world),r=w.residents.find(p=>p.id===route.personId)!;
 const home=w.buildings.find(b=>b.id===route.buildingId)!;
 assert.equal(r.inside,null);
 assert.equal(submitPlan(w,{id:'independent-sleep-route',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Offline engine sleep route regression',actions:[{type:'sleep',minutes:10}]}).ok,true);
 let approached=false,slept=false,entered=false,doorway=false;
 for(let i=0;i<160&&(r.plan||r.activity);i++){
  const energy=r.energy,before=r.activity?.remaining;
  stepWorld(w,1);
  assert.equal(r.lastFailure,null);
  if(r.inside===null&&r.at.x===home.door.x&&r.at.y===home.door.y){
   doorway=true;assert.equal(r.roomAt,null);assert.ok(r.energy<=energy,'doorway cannot grant sleep recovery');
   if(before!==undefined)assert.equal(r.activity?.remaining,before,'doorway cannot consume sleep work');
  }
  if(r.inside===home.id)entered=true;
  if(r.activity?.room?.path.length){
   approached=true;assert.equal(r.inside,home.id);assert.ok(r.roomAt);assert.ok(r.energy<=energy,'walking toward bed cannot grant sleep recovery');
   if(before!==undefined)assert.equal(r.activity.remaining,before,'walking cannot consume chosen sleep work');
  }
  if(r.activity?.action.type==='sleep'&&!r.activity.path.length&&!r.activity.room?.path.length&&r.activity.remaining<10){
   slept=true;assert.equal(r.inside,home.id);
   const bed=roomLayout(w,home).slots.find(s=>s.key==='bed:'+residentBed(w,r,home));assert.ok(bed);assert.deepEqual(r.roomAt,bed.at);
  }
 }
 assert.ok(doorway&&entered&&approached&&slept,'real engine must enter home, approach the bed and actually sleep');
 assert.equal(r.lastFailure,null);assert.equal(r.activity,null);
});
