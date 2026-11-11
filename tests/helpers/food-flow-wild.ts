import assert from 'node:assert/strict';
import {parseChoice} from '../../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import type {IndustryAction} from '../../src/shared/industry.js';
import type {Resident,Vec,World} from '../../src/shared/types.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import type {FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {fishingStockAt} from '../../src/world/fishing.js';
import {findPath,walkable} from '../../src/world/navigation.js';
import {DAY} from '../../src/world/time.js';

export function wildFlowFixture(){
 const w=createFrontierWorld();w.clock.paused=false;w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const r of w.residents){r.hunger=10;r.energy=r.health=100;r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 for(const beast of w.frontierHazards!.beasts){beast.nextMoveAt=w.minute+DAY;beast.cooldownUntil=beast.nextMoveAt;}
 const fisher=w.residents.find(r=>r.id==='founder-3-2')!,hunter=w.residents.find(r=>r.skills.building>0)!;
 const beast=w.frontierHazards!.beasts.find(b=>b.species==='boar')!,shore=w.industry!.frontierShore!,pool=fishingStockAt(w,shore)!;
 return {w,fisher,hunter,beast,shore,pool};
}
export function prepareHunt(w:World,hunter:Resident,beast:{at:Vec}){
 w.industry!.tools.push({id:'flow-spear:'+hunter.id,ownerId:hunter.id,kind:'spear',level:1,durability:10,maxDurability:10});
 const at=beast.at,near=[{x:at.x+4,y:at.y},{x:at.x-4,y:at.y},{x:at.x,y:at.y+4},{x:at.x,y:at.y-4}]
  .find(p=>walkable(w,p)&&findPath(w,p,at,false,8));assert.ok(near);
 hunter.at={...near};hunter.inside=null;hunter.roomAt=null;
}
export function flowMenuAction(w:World,r:Resident,operation:'fish'|'hunt',target?:string){
 const choices=decisionChoices(decisionContext(w,r)),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation===operation&&(!target||c.action.beastId===target));
 assert.ok(choice,`${operation} must reach final numbered decision menu`);
 return parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as IndustryAction;
}
let serial=0;
export function queueWildFlow(w:World,r:Resident,a:IndustryAction){
 const result=submitPlan(w,{id:'wild-flow:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'Offline physical wild source evidence',actions:[a]});assert.ok(result.ok,result.error);
}
export function finishWildFlows(w:World,actors:Resident[]){
 const receipts:FoodFlowReceipt[]=[];let left=500;
 while(actors.some(r=>r.activity||r.plan)){assert.ok(left--,'actions must terminate');receipts.push(...stepWorldWithFoodEvidence(w,1).foodFlows!);}
 return receipts;
}
