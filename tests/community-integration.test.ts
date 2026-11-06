import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {headcount,ensureCensus} from '../src/shared/demography.js';
import {recordDeath} from '../src/world/life.js';
import {advanceMigration,applyOutsideDecision,outsideCandidate} from '../src/world/migration.js';
import {executeSocialAction} from '../src/world/social.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('normal runtime sends an outside persons own context to the same model and preserves refusal through restart',async()=>{
 const store=new WorldStore(':memory:');
 const base=createFormalWorld();initializeForeignTrade(base);
 for(const merchant of base.foreignTrade!.merchants)merchant.person.decisionDue=base.minute+1000;
 for(const person of base.residents){person.lastDecisionAt=base.minute;person.decisionDue=base.minute+1000;}
 store.commit(base,null);
 const received:string[]=[];
 const runtime=new ValleyRuntime(store,'isolated-model',async(_key,context)=>{
  assert.ok(context.outside);assert.deepEqual(context.people,[]);received.push(context.actor.id);
  return {decision:{intention:'我想留在原来的地方',actions:[{type:'stayOutside'}]},inputTokens:1,outputTokens:1,latencyMs:1};
 },{mode:'formal'});
 try{
  runtime.start();await flush();await flush();
  assert.equal(received.length,1);assert.equal(runtime.world.metrics.successes,1);
  assert.equal(runtime.world.residents.length,54);
  const contact=runtime.world.migration!.contacts.find(p=>p.id===received[0])!;
  assert.equal(contact.lastChoice,'stay');assert.equal(contact.phase,'home');
  runtime.stop();
  const restored=new ValleyRuntime(store,null,undefined,{mode:'formal'});
  assert.equal(restored.world.migration!.contacts.find(p=>p.id===contact.id)!.futureAt,contact.futureAt);
  restored.stop();
 }finally{runtime.stop();store.close();}
});

test('visitor entry, voluntary settlement and departure change the saved census exactly once',()=>{
 const world=createFormalWorld();ensureCensus(world);world.clock.paused=false;
 advanceMigration(world);
 const outside=outsideCandidate(world)[0];
 assert.ok(applyOutsideDecision(world,outside.id,outside.revision,{intention:'我想亲自来看看',actions:[{type:'travelToValley'}]}).ok);
 world.minute=world.migration!.contacts[0].journey!.arriveAt;advanceMigration(world);
 const visitor=world.residents.find(p=>p.id===outside.id)!;
 assert.deepEqual(headcount(world),{residents:54,visitors:1});
 advanceMigration(world);assert.equal(world.residents.length,55);
 const inn=world.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 visitor.at={...inn.door};
 assert.ok(executeSocialAction(world,visitor,{type:'settle',buildingId:inn.id}).ok);
 assert.deepEqual(headcount(world),{residents:55,visitors:0});
 visitor.at={...world.map.entrance};
 assert.ok(executeSocialAction(world,visitor,{type:'leave'}).ok);
 assert.deepEqual(headcount(world),{residents:54,visitors:0});
 const period=world.population!.seasons.at(-1)!;
 assert.equal(period.changes.visit,1);assert.equal(period.changes.settle,1);assert.equal(period.changes.depart,1);
 const local=world.residents[0];recordDeath(world,local);recordDeath(world,local);
 assert.equal(period.changes.death,1);assert.equal(headcount(world).residents,53);
 const store=new WorldStore(':memory:');
 try{store.commit(world,null);assert.deepEqual(store.load()!.population,world.population);}finally{store.close();}
});

test('children get executable berry and water choices, with adult work filtered from the actual model menu',()=>{
 const world=createFormalWorld();
 const child=world.residents.find(person=>(world.minute-person.bornAt)/(112*1440)<13)!;
 const resource=world.resources.find(r=>r.kind==='tree')!;
 child.at={...resource.at};child.knownResources.push(resource.id);
 const choices=decisionChoices(decisionContext(world,child));
 assert.ok(!choices.some(c=>c.action.type==='gather'&&c.action.resourceId===resource.id));
 assert.ok(!choices.some(c=>c.action.type==='publicDuty'&&c.action.operation!=='receive'));
});

test('an outside reply failure does not freeze residents who have no pending decisions',async()=>{
 const store=new WorldStore(':memory:');const base=createFormalWorld();
 for(const person of base.residents){person.lastDecisionAt=base.minute;person.decisionDue=base.minute+1000;}
 store.commit(base,null);
 const runtime=new ValleyRuntime(store,'isolated-model',async()=>{throw new Error('model_http_503');},{mode:'formal'});
 try{
  runtime.start();await flush();await flush();
  const before=runtime.world.minute;runtime.tick(Date.now()+1000);
  assert.ok(runtime.world.minute>before);assert.equal(runtime.world.clock.paused,false);
  assert.equal(runtime.world.residents.length,54);
 }finally{runtime.stop();store.close();}
});

test('a guardian who can observe an infant in distress gets decision priority without stopping the world',()=>{
 const store=new WorldStore(':memory:');const base=createFormalWorld();
 for(const person of base.residents){person.lastDecisionAt=base.minute;person.decisionDue=base.minute+1000;}
 const [guardian,routine,infant]=base.residents;
 guardian.decisionDue=base.minute;guardian.hunger=20;guardian.health=100;
 routine.decisionDue=base.minute;
 infant.bornAt=base.minute-100;infant.canDecide=false;infant.canExpress=false;
 infant.at={...guardian.at};infant.inside=guardian.inside;infant.hunger=90;infant.health=19;infant.guardianIds=[guardian.id];
 store.commit(base,null);
 const dispatched:string[]=[];
 const runtime=new ValleyRuntime(store,'isolated-model',(_key,context)=>{dispatched.push(context.actor.id);return new Promise(()=>{});},{mode:'formal',modelSlots:1});
 try{
  runtime.start();const before=runtime.world.minute;runtime.tick(Date.now()+1000);
  assert.deepEqual(dispatched,[guardian.id]);
  assert.equal(runtime.world.clock.paused,false);assert.ok(runtime.world.minute>before);
  assert.equal(runtime.world.residents[0].plan,null);
 }finally{runtime.stop();store.close();}
});

test('a resident whose queued decision is stopping the clock gets a slot before a recent routine request',()=>{
 const store=new WorldStore(':memory:');const base=createFormalWorld();
 for(const person of base.residents){person.lastDecisionAt=base.minute;person.decisionDue=base.minute+1000;}
 const overdue=base.residents[0],recent=base.residents[1];
 overdue.decisionDue=base.minute-60;overdue.hunger=0;overdue.health=100;overdue.energy=100;
 recent.decisionDue=base.minute;recent.hunger=70;recent.energy=40;
 store.commit(base,null);
 const dispatched:string[]=[];
 const runtime=new ValleyRuntime(store,'isolated-model',(_key,context)=>{dispatched.push(context.actor.id);return new Promise(()=>{});},{mode:'formal',modelSlots:1,dayMinutes:180});
 try{runtime.start();assert.deepEqual(dispatched,[overdue.id]);}finally{runtime.stop();store.close();}
});
