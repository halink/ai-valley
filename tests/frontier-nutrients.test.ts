import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {cropYieldAt,soilFertility} from '../src/world/frontier-nutrients.js';
import {initializeProduction} from '../src/world/production.js';

function decide(w:World,actor:Resident,predicate:(action:Action)=>boolean):Action {
 const choice=decisionChoices(decisionContext(w,actor)).find(choice=>predicate(choice.action));
 assert.ok(choice,'the decision appears in the normal resident menu');
 return choice.action;
}

function execute(w:World,actor:Resident,action:Action){
 const plan={id:`nutrients:${w.revision}`,actorId:actor.id,actorRevision:actor.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'隔离验证住民决策',actions:[action]};
 assert.equal(submitPlan(w,plan).ok,true);
 for(let i=0;i<360&&(actor.plan||actor.activity);i++)stepWorld(w,1);
 assert.equal(actor.plan,null);
 assert.equal(actor.activity,null);
 assert.equal(actor.lastFailure,null);
}

test('actually eaten feed yields physical manure, compost changes the harvest and the new soil survives reload',()=>{
 const w=createFrontierWorld();
 w.clock.paused=false;
 initializeProduction(w);
 const herd=w.industry!.animals,hen=herd.find(animal=>animal.kind==='chicken')!;
 const owner=w.residents.find(resident=>resident.id===hen.ownerId)!;
 const barn=w.buildings.find(building=>building.id===hen.barnId)!;
 const plot=w.plots.find(plot=>plot.ownerId===owner.id)!;
 assert.ok(plot&&hen.at);
 const state=w.production!.nutrients!;
 assert.deepEqual(state.heaps,[]);
 owner.at={...hen.at};
 owner.inside=null;
 owner.inventory.fiber=1;
 hen.hunger=78;
 const feed=decide(w,owner,action=>action.type==='industry'&&action.operation==='feedAnimal'&&action.animalId===hen.id);
 const food=owner.inventory.fodder!;
 execute(w,owner,feed);
 assert.equal(owner.inventory.fodder,food-1);
 assert.deepEqual(state.heaps,[],'digestion takes world time');
 stepWorld(w,420);
 assert.ok(state.deposited>=2);

 for(let i=0;i<2&&(owner.inventory.manure??0)<2;i++){
  execute(w,owner,decide(w,owner,action=>action.type==='production'&&action.operation==='collectManure'));
 }
 assert.equal(state.collected,2);
 assert.equal(owner.inventory.manure,2);
 execute(w,owner,{type:'move',to:{...barn.door}});
 const mix=decide(w,owner,action=>action.type==='industry'&&action.operation==='craft'&&action.recipeId==='compost');
 assert.equal(mix.type,'industry');
 execute(w,owner,{...mix,minutes:90});
 assert.equal(owner.inventory.manure,0);
 assert.equal(owner.inventory.compost,1);

 execute(w,owner,{type:'move',to:{...plot.at}});
 plot.crop={definition:'crop/turnip@2',planted:w.minute-6000,growth:4,wateredDay:0,lastGrowthDay:0};
 assert.equal(cropYieldAt(w,plot,12),12);
 execute(w,owner,decide(w,owner,action=>action.type==='production'&&action.operation==='fertilize'));
 assert.equal(owner.inventory.compost,0);
 assert.equal(soilFertility(w,plot.id),72);
 const roots=owner.inventory.turnip??0;
 execute(w,owner,decide(w,owner,action=>action.type==='harvest'&&action.plotId===plot.id));
 assert.equal(owner.inventory.turnip,roots+14);
 assert.equal(soilFertility(w,plot.id),64);
 assert.equal(state.harvested,14);

 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);
  const restored=store.loadForRuntime()!;
  assert.equal(soilFertility(restored,plot.id),64);
  assert.deepEqual(restored.production?.nutrients,state);
 }finally{store.close();}
});
