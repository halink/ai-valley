import assert from 'node:assert/strict';
import {parseChoice} from '../../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {WorldStore} from '../../src/server/store.js';
import type {Action,Resident,World} from '../../src/shared/types.js';
import type {PrototypeDrawing} from '../../src/shared/prototypes.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {initializeFood} from '../../src/world/food.js';
import type {DirectEatingObservation,FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
let serial=0;
export const prototypeDrawing:PrototypeDrawing={kind:'prototype',name:'晴日挂鱼架',purpose:'实际晾干鲜鱼',frame:'wood',mesh:'fiber',cover:'none',processes:['hang','airDry'],batchSize:2,trialMinutes:180};
/** Synthetic supplies only: drawing, assembly and trial all use final numbered menus. */
export function prototypeFlowFixture(patch:Partial<PrototypeDrawing>={}){
 const w=createFrontierWorld(5401),r=w.residents.find(a=>a.skills.building>=1)!,home=w.buildings.find(b=>b.id===r.homeId)!;
 w.clock.paused=false;w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const beast of w.frontierHazards!.beasts){beast.nextMoveAt=w.minute+10000;beast.cooldownUntil=w.minute+10000;}
 for(const actor of w.residents){actor.hunger=20;actor.energy=actor.health=100;actor.lastDecisionAt=w.minute;actor.decisionDue=w.minute+10000;}
 r.at={...home.door};r.inside=null;r.roomAt=null;r.inventory={wood:20,plank:20,fiber:20,cloth:20,fish:20};
 initializeFood(w);decisionContext(w,r);
 submitPrototypeActions(w,r,[selectPrototypeAction(w,r,a=>a.type==='design'&&a.operation==='draw'&&a.kind==='prototype',{drawing:{...prototypeDrawing,...patch}})]);finishPrototypeFlow(w,r);
 const d=w.designs!.records.at(-1)!;
 submitPrototypeActions(w,r,[selectPrototypeAction(w,r,a=>a.type==='design'&&a.operation==='assemble')]);finishPrototypeFlow(w,r);
 const p=w.designs!.prototypes!.at(-1)!;
 // Rotate now, so queueing the returned fixture does not advance time or consume inputs.
 selectPrototypeAction(w,r,a=>a.type==='design'&&a.operation==='trial');
 return {w,r,d,p,home};
}
export function prototypeChoices(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
export function submitPrototypeActions(w:World,r:Resident,actions:Action[]){
 const plan={id:'prototype-evidence:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人实际试用组合原型',actions};
 const result=submitPlan(w,plan);assert.ok(result.ok,result.error);return structuredClone(plan);
}
export function selectPrototypeAction(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 for(let n=0;n<40;n++){
  const menu=prototypeChoices(w,r),choice=menu.find(c=>predicate(c.action));
  if(choice)return parseChoice(JSON.stringify({choice:choice.id,...fields}),menu).actions[0];
  const wait=menu.find(c=>c.action.type==='wait');assert.ok(wait);
  submitPrototypeActions(w,r,parseChoice(JSON.stringify({choice:wait.id,minutes:30}),menu).actions);finishPrototypeFlow(w,r);
 }
 assert.fail('normal rotating final menu must expose prototype action');
}
export function queuePrototypeFlow(w:World,r:Resident,followWait=false){
 const menu=prototypeChoices(w,r),choice=menu.find(c=>c.action.type==='design'&&c.action.operation==='trial');assert.ok(choice,'trial must reach final numbered menu');
 const parsed=parseChoice(JSON.stringify({choice:choice.id}),menu),wait=menu.find(c=>c.action.type==='wait');assert.ok(wait);
 return submitPrototypeActions(w,r,[...parsed.actions,...(followWait?parseChoice(JSON.stringify({choice:wait.id,minutes:120}),menu).actions:[])]);
}
export function finishPrototypeFlow(w:World,r:Resident,success=true){
 const observations:DirectEatingObservation[]=[];
 for(let n=0;r.plan||r.activity;n++){assert.ok(n<2000,'prototype plan must terminate');observations.push(stepWorldWithFoodEvidence(w,1));}
 if(success)assert.equal(r.lastFailure,null);return observations;
}
export function prototypeReceipts(observations:DirectEatingObservation[]){return observations.flatMap(o=>o.foodFlows??[]).filter((f):f is Extract<FoodFlowReceipt,{action:'prototype_trial'}>=>f.action==='prototype_trial');}
export function reloadPrototype(w:World){const store=new WorldStore(':memory:');try{store.commit(w,null);return store.load(true)!;}finally{store.close();}}
