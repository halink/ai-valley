import assert from 'node:assert/strict';
import type {EmploymentRole} from '../../src/shared/employment.js';
import {recipeById} from '../../src/world/industry-content.js';
import type {Action,Inventory,Resident,World} from '../../src/shared/types.js';
import {createWorld} from '../../src/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {moveCoins} from '../../src/world/economy.js';
import {initializeFood} from '../../src/world/food.js';
import {DAY,YEAR} from '../../src/world/time.js';
import {atWorkstation} from './workspaces.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {WorldStore} from '../../src/server/store.js';
import type {DirectEatingObservation,FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
let serial=0;
export function submitEmploymentAction(w:World,r:Resident,a:Action,followWait=false){
 atWorkstation(w,r,a);
 const result=submitPlan(w,{id:`employment-evidence:${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
 definition:w.activeDefinitions['action/routine'],intention:'本人决定执行',actions:[a,...(followWait?[{type:'wait' as const,minutes:120}]:[])]});
 assert.ok(result.ok,result.error);
}
export function finishEmploymentAction(w:World,r:Resident,success=true){
 const observations:DirectEatingObservation[]=[];
 for(let n=0;r.plan||r.activity;n++){assert.ok(n<400);observations.push(stepWorldWithFoodEvidence(w,1));}
 if(success)assert.equal(r.lastFailure,null);return observations;
}
/** Explicit synthetic adults, capital and supplies; hiring itself uses actual engine actions. */
export function employmentFlowFixture(input?:Inventory,role:EmploymentRole='cook'){
 const w=createWorld();w.mode='formal';w.clock.paused=false;const [owner,worker]=w.residents,home=w.buildings.find(b=>b.ownerId===owner.id)!;
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=100;r.health=r.energy=100;r.hunger=10;r.knownBuildings.push(home.id);r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 stepWorld(w,1);
 const run=(r:Resident,a:Action)=>{submitEmploymentAction(w,r,a);finishEmploymentAction(w,r);};
 run(owner,{type:'economy',operation:'open',buildingId:home.id,name:'合成食铺'});
 const b=w.economy!.businesses[0];assert.ok(moveCoins(w,`resident:${owner.id}`,`business:${b.id}`,60,'合成测试出资','employment-evidence-capital'));
 if(input){w.definitions['recipe/meal@2']={...structuredClone(w.definitions['recipe/meal@1']),version:2,cost:input};w.activeDefinitions['recipe/meal']='recipe/meal@2';}
 const recipeId=({miller:'bread',dairyworker:'cheese',preserver:'preserve',carpenter:'plank',herbalist:'medicine',smith:'bar',weaver:'cloth'} as Partial<Record<EmploymentRole,string>>)[role];
 const recipe=recipeId?recipeById(recipeId):undefined;if(recipe){worker.skills[recipe.skill]=Math.max(worker.skills[recipe.skill],recipe.minimum);if(recipe.station)w.industry!.stations.push({id:'employment-station:'+recipe.station,buildingId:home.id,kind:recipe.station,installedAt:w.minute});}
 run(owner,{type:'employment',operation:'post',businessId:b.id,terms:{role,wage:12,days:2,startMinute:600,durationMinutes:120}});
 const p=w.employment!.posts[0];run(worker,{type:'employment',operation:'apply',postId:p.id});
 run(owner,{type:'employment',operation:'select',postId:p.id,applicantId:worker.id});run(worker,{type:'employment',operation:'accept',postId:p.id});
 const c=w.employment!.contracts[0];w.minute=c.startDay*DAY+c.terms.startMinute;owner.inside=null;owner.roomAt=null;
 for(const r of w.residents){r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 b.inventory=role==='cook'?{turnip:4,water:2}:structuredClone(c.recipe!.input);initializeFood(w);return {w,owner,worker,b,c,p,home};
}
export function queueEmploymentFlow(f:ReturnType<typeof employmentFlowFixture>,minutes=20,followWait=false){
 const {w,worker,c}=f;
 const choices=decisionChoices(decisionContext(w,worker));
 const choice=choices.find(c=>c.action.type==='employment'&&c.action.operation==='work'&&c.action.contractId===f.c.id);
 assert.ok(choice,'signed work must reach final numbered menu');
 const parsed=parseChoice(JSON.stringify({choice:choice.id,minutes}),choices);
 submitEmploymentAction(w,worker,parsed.actions[0],followWait);return worker.plan!.id;
}
export function employmentReceipts(observations:DirectEatingObservation[]){return observations.flatMap(o=>o.foodFlows??[]).filter((f):f is Extract<FoodFlowReceipt,{action:'employment_processing'}>=>f.action==='employment_processing');}
export function reloadEmployment(f:ReturnType<typeof employmentFlowFixture>){
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load(true)!;return {w,owner:w.residents.find(r=>r.id===f.owner.id)!,worker:w.residents.find(r=>r.id===f.worker.id)!,b:w.economy!.businesses.find(b=>b.id===f.b.id)!,c:w.employment!.contracts.find(c=>c.id===f.c.id)!,p:w.employment!.posts.find(p=>p.id===f.p.id)!,home:w.buildings.find(b=>b.id===f.home.id)!};}finally{store.close();}
}
