import assert from 'node:assert/strict';
import {parseChoice} from '../../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {WorldStore} from '../../src/server/store.js';
import type {Action,Resident,World} from '../../src/shared/types.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {initializeFood} from '../../src/world/food.js';
import type {DirectEatingObservation,FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
let serial=0;
/** Explicit synthetic supplies; actual seed saving still uses final menus and engine time. */
export function seedFlowFixture(){
 const w=createFrontierWorld(5401),r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 w.clock.paused=false;w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const beast of w.frontierHazards!.beasts){beast.nextMoveAt=w.minute+10000;beast.cooldownUntil=w.minute+10000;}
 for(const actor of w.residents){actor.hunger=20;actor.energy=actor.health=100;actor.lastDecisionAt=w.minute;actor.decisionDue=w.minute+10000;}
 r.at={...home.door};r.inside=null;r.roomAt=null;r.inventory={turnip:1,seed:3};
 initializeFood(w);decisionContext(w,r);
 // Respect ordinary agenda rotation instead of injecting or pinning an action.
 for(let n=0;!seedChoices(w,r).some(c=>c.action.type==='production'&&c.action.operation==='saveSeed');n++){
  assert.ok(n<40,'normal rotating menu must expose seed saving');const choices=seedChoices(w,r),wait=choices.find(c=>c.action.type==='wait')!;
  submitSeedActions(w,r,parseChoice(JSON.stringify({choice:wait.id,minutes:30}),choices).actions);finishSeedFlow(w,r);
 }
 return {w,r,home};
}
export function seedChoices(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
export function submitSeedActions(w:World,r:Resident,actions:Action[]){
 const plan={id:'seed-evidence:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'本人决定实际留种',actions};
 const result=submitPlan(w,plan);assert.ok(result.ok,result.error);return structuredClone(plan);
}
export function queueSeedFlow(w:World,r:Resident,followWait=false){
 const choices=seedChoices(w,r),choice=choices.find(c=>c.action.type==='production'&&c.action.operation==='saveSeed');
 assert.ok(choice,'saveSeed must reach final numbered menu');
 const parsed=parseChoice(JSON.stringify({choice:choice.id}),choices);
 const wait=choices.find(c=>c.action.type==='wait');assert.ok(wait);
 const quiet=parseChoice(JSON.stringify({choice:wait.id,minutes:120}),choices);
 return submitSeedActions(w,r,[...parsed.actions,...(followWait?quiet.actions:[])]);
}
export function finishSeedFlow(w:World,r:Resident,success=true){
 const observations:DirectEatingObservation[]=[];
 for(let n=0;r.plan||r.activity;n++){assert.ok(n<400,'seed plan must terminate');observations.push(stepWorldWithFoodEvidence(w,1));}
 if(success)assert.equal(r.lastFailure,null);return observations;
}
export function seedReceipts(observations:DirectEatingObservation[]){return observations.flatMap(o=>o.foodFlows??[]).filter((f):f is Extract<FoodFlowReceipt,{action:'saveSeed'}>=>f.action==='saveSeed');}
export function reloadSeed(w:World){const store=new WorldStore(':memory:');try{store.commit(w,null);return store.load(true)!;}finally{store.close();}}
