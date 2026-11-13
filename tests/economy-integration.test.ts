import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeProduction} from '../src/world/production.js';
import {initializeCivic} from '../src/world/civic.js';
import {advanceMigration,outsideCandidate,applyOutsideDecision} from '../src/world/migration.js';
import {decisionContext,decisionChoices,prompt} from '../src/server/decisions.js';

test('upgrading a populated save creates empty institutions, preserves original assets and holds without a model',()=>{
 const w=createFormalWorld();w.minute=900;const before=totalCoins(w),original=structuredClone(w.residents);
 const store=new WorldStore(':memory:');store.commit(w,null);
 const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 try{
 assert.equal(runtime.snapshot().version,'2.2.0');assert.equal(runtime.world.id,w.id);
  assert.deepEqual(runtime.world.residents,original);assert.equal(runtime.world.economy!.initialCoins,before);
  assert.equal(runtime.world.economy!.treasury,0);assert.equal(runtime.world.civic!.proposals.length,0);
  assert.equal(runtime.world.economy!.businesses.length,0);assert.equal(totalCoins(runtime.world),before+runtime.world.foreignTrade!.openingCoins);
  runtime.tick(Date.now()+30000);assert.equal(runtime.world.minute,w.minute);
  assert.ok(!runtime.world.residents.some(r=>r.plan));
  assert.ok(runtime.world.definitions['crop/turnip@2']);
  assert.deepEqual(runtime.world.definitions['crop/turnip@1'],w.definitions['crop/turnip@1']);
 }finally{runtime.stop();store.close();}
});

test('an arriving person is entered in the asset census before their first possible town transaction',()=>{
 const w=createFormalWorld();initializeEconomy(w);initializeProduction(w);initializeCivic(w);initializeForeignTrade(w);
 const openingExternal=w.economy!.externalCoins;
 w.clock.paused=false;advanceMigration(w);const traveller=outsideCandidate(w)[0],carried=traveller.coins;
 assert.ok(applyOutsideDecision(w,traveller.id,traveller.revision,{intention:'来看看',actions:[{type:'travelToValley'}]}).ok);
 const trip=w.migration!.contacts.find(c=>c.id===traveller.id)!.journey!;w.minute+=trip.staged!.stageRemaining;advanceMigration(w);assert.ok(applyOutsideDecision(w,traveller.id,traveller.revision,{intention:'本人继续余下路程',actions:[{type:'visitorJourney',operation:'continue',journeyId:trip.staged!.id,minutes:trip.staged!.progress}]}).ok);w.minute+=trip.staged!.stageRemaining-.1;
 stepWorld(w,.2);
 assert.ok(w.residents.some(r=>r.id===traveller.id));assert.equal(w.economy!.externalCoins,openingExternal+carried);
 assert.equal(totalCoins(w),w.economy!.initialCoins+w.economy!.externalCoins);
 stepWorld(w,.2);assert.equal(w.economy!.externalCoins,openingExternal+carried);
});

test('formal model menu offers renewable seasonal crops without the obsolete low-yield planting choice',()=>{
 const w=createFormalWorld();initializeEconomy(w);initializeProduction(w);initializeCivic(w);
 const plot=w.plots[0],person=w.residents.find(r=>r.id===plot.ownerId)!;
 person.at={...plot.at};person.inside=null;person.inventory.seed=1;
 const context=decisionContext(w,person),choices=decisionChoices(context);
 assert.ok(choices.some(c=>c.action.type==='production'&&c.action.operation==='plantCrop'));
 assert.ok(!choices.some(c=>c.action.type==='plant'));
 assert.ok(prompt(context,choices)[0].content.includes('自己的钱款'));
 const child=w.residents.find(r=>w.minute-r.bornAt<18*112*1440)!;
 child.at={...person.at};child.knownBuildings=person.knownBuildings.slice();
 const children=decisionChoices(decisionContext(w,child));
 assert.ok(!children.some(c=>['economy','civic','production'].includes(c.action.type)));
});

test('a collapsed residence cannot give free sleep until an owner actually repairs it',()=>{
 const w=createFormalWorld();w.clock.paused=false;const r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 home.condition=0;r.at={...home.door};r.inside=null;r.energy=50;
 const selected=submitPlan(w,{id:'sleep-broken',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'回家睡觉',actions:[{type:'sleep',minutes:30}]});
 assert.ok(selected.ok);stepWorld(w,1);assert.ok(r.lastFailure);assert.ok(r.energy<50);assert.equal(r.inside,null);
});
