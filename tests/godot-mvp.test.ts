import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMvpSession,createMvpServer,createMvpWorld,mvpPhase} from '../src/server/godot-mvp.js';
import {walkable} from '../src/world/navigation.js';

test('Godot MVP starts a separate small, disposable two-person world',()=>{
 const a=createMvpWorld(),b=createMvpWorld();
 assert.notEqual(a.id,b.id);
 assert.equal(a.map.width,32);assert.equal(a.map.height,24);assert.equal(a.map.tiles.length,32*24);
 assert.equal(a.residents.length,2);assert.equal(a.buildings.length,1);assert.equal(a.graves.length,0);
 assert.equal(a.metrics.configured,false);assert.equal(a.metrics.requests,0);
 assert.equal(a.resources.filter(r=>r.kind==='spring').length,1);
 assert.ok(a.residents.every(r=>walkable(a,r.at)&&r.homeId===a.buildings[0].id));
 assert.ok(a.resources.every(r=>r.at.x>=0&&r.at.x<32&&r.at.y>=0&&r.at.y<24));
});

test('real action engine moves, gathers finite stock, eats, rests and decides again',()=>{
 const session=createMvpSession(),w=session.world;
 const startMinute=w.minute,initialFood=w.resources.filter(s=>s.kind==='bush').reduce((n,s)=>n+s.amount,0);
 const initialPositions=w.residents.map(r=>({...r.at})),initialEnergy=w.residents[1].energy;
 const phases=new Set<string>();let moved=false,gathered=false,ate=false,rested=false;
 for(let n=0;n<600;n++){
  const before=w.residents.map(r=>({h:r.hunger,food:r.inventory.berry??0}));
  session.advance();
  assert.equal(session.snapshot().mvp.fault,null);
  for(const [i,r]of w.residents.entries()){
   phases.add(mvpPhase(r));
   moved ||= r.at.x!==initialPositions[i].x||r.at.y!==initialPositions[i].y;
   gathered ||= (r.inventory.berry??0)>before[i].food;
   ate ||= r.hunger<before[i].h&&(r.inventory.berry??0)<before[i].food;
   if(!r.inside)assert.ok(walkable(w,r.at),'movement never crosses an impassable cell');
   assert.equal(r.status,'alive');
  }
  rested ||= w.residents[1].energy>initialEnergy+10;
 }
 assert.equal(w.minute,startMinute+600);
 assert.ok(moved&&gathered&&ate&&rested);
 for(const phase of ['travelling','gathering','eating','resting'])assert.ok(phases.has(phase),phase);
 assert.ok(w.resources.filter(s=>s.kind==='bush').reduce((n,s)=>n+s.amount,0)<initialFood);
 assert.ok(w.events.some(e=>e.text.includes('采集')),'completion came from engine event ledger');
 assert.ok(Object.values(session.snapshot().mvp.decisions).every(count=>count>2));
 assert.equal(w.metrics.requests,0);assert.equal(w.metrics.successes,0);
});

test('MVP snapshot is detached and visibly labelled; invalid advance is rejected',()=>{
 const session=createMvpSession(),snapshot=session.snapshot();
 assert.equal(snapshot.mvp.driver,'local-rules');assert.equal(snapshot.mvp.ephemeral,true);
 assert.match(snapshot.mvp.notice,/非真实模型/);
 snapshot.world.residents[0].health=0;
 assert.equal(session.world.residents[0].health,100);
 assert.throws(()=>session.advance(-1));assert.throws(()=>session.advance(61));assert.throws(()=>session.advance(.5));
});

test('MVP action failure pauses explicitly rather than silently reporting a healthy loop',()=>{
 const session=createMvpSession();
 delete session.world.definitions[session.world.activeDefinitions['action/routine']];
 session.advance();
 const stoppedAt=session.world.minute;
 assert.ok(session.snapshot().mvp.fault);assert.equal(session.world.clock.paused,true);
 session.advance();assert.equal(session.world.minute,stoppedAt);
});

test('MVP HTTP only serves a GET snapshot; never exposes action mutation',async()=>{
 const session=createMvpSession(),server=createMvpServer(session);
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const address=server.address();assert.ok(address&&typeof address==='object');
  const root=`http://127.0.0.1:${address.port}`;
  const response=await fetch(root+'/ai-town/api/world');assert.equal(response.status,200);
  const body=await response.json() as ReturnType<typeof session.snapshot>;
  assert.equal(body.world.id,session.world.id);assert.equal(body.mvp.driver,'local-rules');
  assert.equal((await fetch(root+'/ai-town/api/world',{method:'POST'})).status,405);
  assert.equal((await fetch(root+'/ai-town/api/actions')).status,404);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
