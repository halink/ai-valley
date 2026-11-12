import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {roomLayout} from '../src/shared/rooms.js';
import {WorldStore} from '../src/server/store.js';
import type {World} from '../src/shared/types.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 const [r,body]=w.residents,home=w.buildings.find(b=>b.id===r.homeId)!;
 home.kind='lodge';home.residents=[r.id];home.capacity=2;
 for(const p of w.residents){p.at={...home.door};p.inside=null;p.roomAt=null;p.plan=null;p.activity=null;p.hunger=20;p.energy=70;p.health=100;}
 assert.equal(submitPlan(w,{id:'walk-to-bed',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择睡觉',actions:[{type:'sleep',minutes:10}]}).ok,true);
 stepWorld(w,.25);
 const bay=roomLayout(w,home).slots.find(s=>s.key==='bodyBay:0')!.at;
 assert.ok(r.activity?.room?.path.some(p=>p.x===bay.x&&p.y===bay.y),'normal bed route crosses the actual storage bay');
 // Fixture boundary: another actor has just completed normal body placement.
 // The dead body uses the exact designated slot, not an arbitrary corridor.
 Object.assign(body,{status:'dead',inside:home.id,roomAt:{...bay},body:{reservedBy:null,carriedBy:null,storedAt:home.id,storageSlot:0}});
 return {w,r,body,home,bay};
}
function reachesBlock(w:World,id:string,bay:{x:number;y:number}){
 const r=w.residents.find(p=>p.id===id)!;const startEnergy=r.energy;
 let left=100;
 while(r.activity||r.plan){assert.ok(left-->0);stepWorld(w,.25);assert.notDeepEqual(r.roomAt,bay,'must never step onto the newly stored body');}
 assert.ok(r.lastFailure);assert.ok(r.energy<=startEnergy,'walking cannot earn sleep recovery');
 const at=structuredClone(r.roomAt);stepWorld(w,2);assert.deepEqual(r.roomAt,at,'no automatic retry or teleport');
 return r;
}

test('a sleeper stops before a body placed on the cached route to the bed',()=>{
 const {w,r,bay}=fixture();reachesBlock(w,r.id,bay);
});

test('the blocked work route behaves identically after closing and reopening SQLite',()=>{
 const {w,r,bay}=fixture();mkdirSync('output',{recursive:true});const dir=mkdtempSync('output/room-work-'),file=join(dir,'synthetic.sqlite');let store=new WorldStore(file);
 try{store.commit(w,null);store.close();store=new WorldStore(file);const restored=store.loadForRuntime()!;
  const original=reachesBlock(w,r.id,bay),loaded=reachesBlock(restored,r.id,bay);
  assert.deepEqual(loaded.roomAt,original.roomAt);assert.equal(loaded.energy,original.energy);assert.equal(loaded.lastFailure,original.lastFailure);assert.equal(restored.metrics.requests,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
