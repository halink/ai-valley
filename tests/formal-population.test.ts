import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {ageYears} from '../src/world/time.js';
import {distance,walkable} from '../src/world/navigation.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';

test('formal founders have unique walkable addresses, real occupancy, valid family records and finite food',()=>{
  const w=createFormalWorld();
  const homes=w.buildings.filter(b=>b.kind==='home');
  assert.equal(w.mode,'formal');assert.equal(w.residents.length,54);assert.equal(homes.length,27);
  assert.equal(new Set(w.residents.map(p=>p.name)).size,54);
  assert.equal(new Set(w.residents.map(p=>p.id)).size,54);
  assert.equal(new Set(w.residents.map(p=>JSON.stringify(p.at))).size,54);
  assert.equal(homes.flatMap(b=>b.residents).length,54);
  assert.ok(w.graves.every(g=>!g.personId));assert.ok(w.graves.length>0);
  assert.equal(w.definitions['land/start@1'].data.parcels instanceof Array,true);
  const minors=w.residents.filter(p=>ageYears(p.bornAt,w.minute)<18);
  assert.equal(minors.length,7);
  for(const b of homes){
    assert.ok(b.residents.length<=b.capacity && b.residents.includes(b.ownerId));
    assert.equal(w.definitions[b.definition].data.capacity,b.capacity);
  }
  for(const p of w.residents){
    const home=homes.find(b=>b.id===p.homeId)!;
    assert.equal(home.residents.includes(p.id),true);
    assert.equal(walkable(w,p.at),true);assert.ok(distance(home.door,p.at)<=2);
    assert.ok(p.canDecide && p.canExpress);assert.equal(p.plan,null);assert.equal(p.activity,null);
    assert.ok((p.inventory.meal??0)>0 && (p.inventory.water??0)>0);
    assert.ok(p.memories.some(m=>w.events.some(e=>e.id===m.eventId&&e.kind==='system'&&e.witnesses.includes(p.id))));
    for(const r of p.relations){
      const other=w.residents.find(v=>v.id===r.targetId)!;
      const reverse=other.relations.find(v=>v.targetId===p.id)!;
      assert.equal(reverse.partner,r.partner);
      assert.equal(reverse.kin,r.kin==='parent'?'child':r.kin==='child'?'parent':r.kin);
      assert.ok(r.evidence.length>0);
    }
  }
  for(const child of minors){
    assert.ok(child.guardianIds.length>0);
    for(const id of child.guardianIds){
      const guardian=w.residents.find(p=>p.id===id)!;
      assert.equal(guardian.homeId,child.homeId);
      assert.ok(guardian.bornAt<child.bornAt);
    }
  }
  for(const plot of w.plots){
    assert.ok(w.residents.some(p=>p.id===plot.ownerId));
    assert.equal(w.map.tiles[plot.at.y*w.map.width+plot.at.x],'soil');
  }
});

test('founders old enough to cook use their registered kitchen and younger children can eat their own provisions',()=>{
  const w=createFormalWorld();w.clock.paused=false;
  const before=w.residents.map(p=>({...p.inventory}));
  for(const p of w.residents){
    assert.ok(submitPlan(w,{id:'cook-'+p.id,actorId:p.id,actorRevision:p.revision,createdAt:w.minute,
      definition:w.activeDefinitions['action/routine'],intention:'隔离世界验证厨房',actions:ageYears(p.bornAt,w.minute)>=13?[{type:'cook',quantity:1}]:[{type:'eat',item:'meal'}]}).ok);
    let guard=1000;while(p.plan||p.activity){assert.ok(guard--);stepWorld(w,1);}
  }
  for(const [index,p] of w.residents.entries()){
    assert.equal(p.lastFailure,null,p.id);
    const cooking=ageYears(p.bornAt,w.minute)>=13;
    assert.equal(p.inventory.meal,before[index].meal!+(cooking?1:-1),p.id);
    assert.equal(p.inventory.turnip,before[index].turnip!-(cooking?2:0));
    assert.equal(p.inventory.water,before[index].water!-(cooking?1:0));
  }
});

test('a resident can read directions only at the registered doorstep and remember them after walking away',async()=>{
  const {visibleStreetDirectory}=await import('../src/world/street-directory.js');
  const {decisionContext}=await import('../src/server/decisions.js');
  const w=createFormalWorld();
  for(const person of w.residents)assert.ok(visibleStreetDirectory(w,person),person.name);
  const actor=w.residents.find(person=>{
    const sign=visibleStreetDirectory(w,person)!;
    return !person.knownResources.includes(sign.water.id)&&!person.knownBuildings.includes(sign.hall.id);
  })!;
  const sign=visibleStreetDirectory(w,actor)!;
  assert.ok(decisionContext(w,actor).formal?.opportunities.some(o=>o.id==='move.known-spring'));
  // Reading the menu cannot register knowledge or reveal the offscreen well's current stock.
  assert.ok(!actor.knownResources.includes(sign.water.id));
  assert.ok(!decisionContext(w,actor).resources.some(r=>r.id===sign.water.id));
  w.clock.paused=false;stepWorld(w,1);
  assert.ok(actor.knownResources.includes(sign.water.id));assert.ok(actor.knownBuildings.includes(sign.hall.id));
  actor.at={...w.map.entrance};
  assert.equal(visibleStreetDirectory(w,actor),undefined);
  assert.ok(decisionContext(w,actor).formal?.opportunities.some(o=>o.id==='move.known-spring'));
});
