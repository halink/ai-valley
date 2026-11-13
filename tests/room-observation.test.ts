import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMvpSession,createMvpServer} from '../src/server/godot-mvp.js';
import {roomLayout} from '../src/shared/rooms.js';

test('small-world live HTTP room projection matches actual engine layout and indoor steps',async()=>{
 const s=createMvpSession(),server=createMvpServer(s);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const a=server.address();assert.ok(a&&typeof a==='object');
  let indoor=false,moved=false;const last=new Map<string,string>();
  for(let i=0;i<180;i++){
   s.advance();
   const snap=await (await fetch(`http://127.0.0.1:${a.port}/ai-town/api/world`)).json() as ReturnType<typeof s.snapshot>;
   assert.equal(snap.roomViews.worldId,snap.world.id);assert.equal(snap.roomViews.revision,snap.world.revision);
   assert.deepEqual(snap.roomViews.rooms,[{buildingId:s.world.buildings[0].id,...roomLayout(s.world,s.world.buildings[0])}]);
   assert.equal(snap.roomViews.rooms[0].slots.filter(s=>s.kind==='bed').length,2);
   for(const r of snap.world.residents)if(r.inside){
    indoor=true;assert.ok(r.roomAt);assert.deepEqual(r.roomAt,s.world.residents.find(p=>p.id===r.id)!.roomAt);
    const current=JSON.stringify(r.roomAt);if(last.has(r.id)&&last.get(r.id)!==current)moved=true;last.set(r.id,current);
   }
  }
  assert.ok(indoor&&moved,'observes actual room journey, not doorway fallback');assert.equal(s.world.metrics.requests,0);
 }finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
