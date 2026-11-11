import type {Action,World} from '../../src/shared/types.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {stepWorld} from '../../src/world/engine.js';
import {initializeFood} from '../../src/world/food.js';
import {advancePublicDuties,completeDuty} from '../../src/world/public-duties.js';
import {roomLayout} from '../../src/shared/rooms.js';

export const survivalScenarios=['carried-meal','hunger-exhaustion','no-food-source','service-stays','service-leaves'] as const;
export type SurvivalScenario=typeof survivalScenarios[number];

/** Rebuilt in memory, never loaded from a user save. Keeps the official map
 * and nine identities, while declaring each controlled critical condition. */
export function survivalBenchmarkWorld(scenario:SurvivalScenario):World{
 const w=createFrontierWorld(5401);w.id='isolated-survival-benchmark';w.clock.paused=false;
 // Isolate model-wait cost from unrelated weather/harvest opportunities. All
 // physical checks remain active, including the actual room and care rules.
 w.frontierHazards=undefined;w.scenario=undefined;w.resources=[];w.plots=[];
 stepWorld(w,.001);
 for(const r of w.residents){
  r.plan=null;r.activity=null;r.lastDecisionAt=w.minute;r.decisionDue=w.minute;
  r.hunger=98;r.energy=scenario==='hunger-exhaustion'?1:80;r.health=scenario==='hunger-exhaustion'?3.6:2.7;
  r.inventory=scenario==='no-food-source'?{}:{meal:3};r.knownResources=[];
  delete r.decisionProtection;
 }
 // Empty pockets alone do not mean no food: the actual founder owns a chicken
 // with collectible eggs. Remove those independent sources explicitly when
 // testing absence of rescue, or isolating a provider's service availability.
 if(scenario==='no-food-source'||scenario.startsWith('service-')){
  for(const animal of w.industry!.animals){animal.product=0;animal.progress=0;}
  for(const tree of w.industry!.trees){tree.fruit=0;tree.fruitProgress=0;}
  for(const bed of w.industry!.beds)bed.crop=null;
  for(const pool of Object.values(w.industry!.fishing)){pool.amount=0;pool.progress=0;}
 }
 if(scenario.startsWith('service-')){
  w.minute=601;
  for(const r of w.residents){r.health=90;r.hunger=20;r.energy=80;r.decisionDue=w.minute+1000;}
  const [client,worker]=w.residents;client.inventory={};client.hunger=98;client.health=2.7;client.decisionDue=w.minute;
  advancePublicDuties(w);
  const shift=w.duties!.shifts.find(s=>s.role==='kitchen'&&s.start===600)!;
  const lodge=w.buildings.find(b=>b.id===shift.buildingId)!;
  worker.at={...lodge.door};worker.inside=lodge.id;worker.roomAt={...roomLayout(w,lodge).slots.find(s=>s.key==='kitchen')!.at};worker.inventory={turnip:12,water:6};
  for(const operation of ['claim','attend'] as const){
   const error=completeDuty(w,worker,{type:'publicDuty',operation,shiftId:shift.id});
   if(error)throw new Error('Invalid isolated service fixture: '+error);
  }
  const actions:Action[]=scenario==='service-leaves'?[{type:'wait',minutes:1},{type:'move',to:{x:lodge.door.x+3,y:lodge.door.y}}]:[{type:'wait',minutes:120}];
  worker.plan={id:'benchmark-provider',actorId:worker.id,actorRevision:worker.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离基准中的既定安排',actions};
  client.at={...lodge.door};client.inside=lodge.id;client.roomAt={...roomLayout(w,lodge).slots.find(s=>s.key==='table')!.at};client.knownBuildings.push(lodge.id);
 }
 initializeFood(w);
 return w;
}
