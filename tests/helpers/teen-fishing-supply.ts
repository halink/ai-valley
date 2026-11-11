import assert from 'node:assert/strict';
import {parseChoice,type ActionChoice} from '../../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import type {Action,Inventory,Resident,World} from '../../src/shared/types.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {initializeHousehold} from '../../src/world/household.js';
import {advanceLife} from '../../src/world/life.js';
import {distance,findPath} from '../../src/world/navigation.js';
import {ageYears,YEAR} from '../../src/world/time.js';

export interface SupplySelection {actorId:string;at:number;number:string;action:Action;}
export function supplyFixture(origin:'founder'|'birth-then-synthetic-13'='founder'){
 const w=createFrontierWorld(5401);w.clock.paused=false;initializeHousehold(w);
 const a=w.residents.find(r=>r.id==='founder-1-1')!,b=w.residents.find(r=>r.id==='founder-1-2')!;
 const home=w.buildings.find(h=>h.id===a.homeId)!;
 assert.equal(w.residents.length,9);assert.equal(a.inventory.wood,8);
 assert.equal(a.inventory.meal,1);assert.equal(b.inventory.meal,1);
 assert.equal(a.inventory.fiber??0,0);assert.equal(a.inventory.rodKit??0,0);
 let teen=w.residents.find(r=>r.id==='founder-1-3')!;
 let birthEvidence:{id:string;bornAt:number;inventory:Inventory;canDecide:boolean;canExpress:boolean}|undefined;
 if(origin==='birth-then-synthetic-13'){
  // Due pregnancy is a fixture. advanceLife invokes the production birth function.
  // This tests birth output, not conception decisions or thirteen years of care.
  b.pregnancy={otherParentId:a.id,conceivedAt:w.minute-100,dueAt:w.minute,definition:'life/basic@1'};
  advanceLife(w,.25);teen=w.residents.at(-1)!;
  assert.equal(w.residents.length,10);assert.deepEqual(teen.inventory,{});
  assert.equal(teen.canDecide,false);assert.equal(teen.canExpress,false);
  assert.ok(w.events.some(e=>e.kind==='birth'&&e.actors.includes(teen.id)));
  birthEvidence={id:teen.id,bornAt:teen.bornAt,inventory:structuredClone(teen.inventory),canDecide:teen.canDecide,canExpress:teen.canExpress};
  const minute=w.minute;
  // Explicit synthetic age boundary: move bornAt, not the world clock or resources.
  teen.bornAt=w.minute-13*YEAR;advanceLife(w,.25);
  assert.equal(w.minute,minute);assert.equal(ageYears(teen.bornAt,w.minute),13);
  assert.equal(teen.canDecide,true);assert.equal(teen.canExpress,true);
  assert.deepEqual(teen.inventory,{});
 }
 assert.equal(Math.floor(ageYears(teen.bornAt,w.minute)),13);
 assert.equal(teen.inventory.rodKit??0,0);
 assert.ok(a.knownPeople.includes(teen.id));assert.ok(b.knownPeople.includes(teen.id));
 return {w,a,b,teen,home,origin,birthEvidence,trace:[] as SupplySelection[],
  opening:{minute:w.minute,adults:[structuredClone(a.inventory),structuredClone(b.inventory)],teen:structuredClone(teen.inventory),
   coins:w.residents.map(r=>[r.id,r.coins] as const),tools:structuredClone(w.industry!.tools),parents:teen.parents.slice(),guardians:teen.guardianIds.slice()}};
}
export type SupplyFixture=ReturnType<typeof supplyFixture>;
export const supplyMenu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
export function findSupplyChoice(w:World,r:Resident,predicate:(action:Action)=>boolean,description:string,windows=48){
 for(let n=0;n<windows;n++){
  const row=supplyMenu(w,r).find(c=>predicate(c.action));
  if(row)return row;
  stepWorld(w,30); // Observer advances bounded agenda windows; no model is invoked.
 }
 assert.fail(`${description} absent from actual numbered menu within ${windows} windows`);
}
export function queueSupply(f:SupplyFixture,r:Resident,row:ActionChoice,fields:Record<string,unknown>={}){
 const choices=supplyMenu(f.w,r),current=choices.find(c=>JSON.stringify(c.action)===JSON.stringify(row.action));
 assert.ok(current,'rebuild and select the currently visible choice');assert.match(current.id,/^\d+$/);
 const decision=parseChoice(JSON.stringify({choice:current.id,...fields}),choices);
 assert.equal(decision.actions.length,1);
 const plan={id:`supply:${r.id}:${f.w.revision}:${f.w.minute}:${f.trace.length}`,actorId:r.id,actorRevision:r.revision,
  createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'隔离脚本逐项选择真实菜单，不是模型自主决策',actions:decision.actions};
 const result=submitPlan(f.w,plan);assert.ok(result.ok,result.error);
 f.trace.push({actorId:r.id,at:f.w.minute,number:current.id,action:structuredClone(decision.actions[0])});
 return plan;
}
export function finishSupply(w:World,r:Resident,success=true){
 let remaining=1200;while(r.plan||r.activity){assert.ok(remaining-->0,'bounded actual travel/work');stepWorld(w,.25);}
 if(success)assert.equal(r.lastFailure,null);else assert.ok(r.lastFailure);
}
export function chooseSupply(f:SupplyFixture,r:Resident,predicate:(action:Action)=>boolean,description:string,fields:Record<string,unknown>={}){
 const row=findSupplyChoice(f.w,r,predicate,description),plan=queueSupply(f,r,row,fields);finishSupply(f.w,r);return plan;
}
export function walkAway(f:SupplyFixture,r:Resident){
 const plan=chooseSupply(f,r,a=>a.type==='move'&&distance(r.at,a.to)>=3&&distance(f.home.door,a.to)>2&&distance(f.home.door,a.to)<=8&&findPath(f.w,r.at,a.to)!==null,'walk to a reachable nearby outdoor point');
 const action=plan.actions[0];assert.equal(action.type,'move');if(action.type!=='move')assert.fail('expected selected movement');
 assert.deepEqual(r.at,action.to);assert.equal(r.inside,null);return action.to;
}
export function craftSupplyKit(f:SupplyFixture){
 const {w,a,home}=f;
 for(const [recipe,minutes] of [['fiber',20],['rod',45]] as const){
  chooseSupply(f,a,x=>x.type==='industry'&&x.operation==='craft'&&x.recipeId===recipe&&x.buildingId===home.id,`craft ${recipe}`,{minutes});
  const batch=w.industry!.batches.at(-1)!;
  assert.equal(batch.ownerId,a.id);assert.equal(batch.recipe.id,recipe);
  assert.equal(batch.status,'completed');assert.equal(batch.worked,minutes);
  if(recipe==='fiber'){assert.equal(a.inventory.wood,7);assert.equal(a.inventory.fiber,3);assert.equal(a.inventory.rodKit??0,0);}
 }
 assert.equal(a.inventory.wood,5);assert.equal(a.inventory.fiber,1);assert.equal(a.inventory.rodKit,1);
 assert.equal(f.teen.inventory.rodKit??0,0);assert.deepEqual(w.industry!.tools,f.opening.tools);
 // The maker really exits the indoor worktable before meeting the other donor.
 walkAway(f,a);
 chooseSupply(f,a,x=>x.type==='move'&&x.to.x===home.door.x&&x.to.y===home.door.y,'return to household door');
 assert.deepEqual(a.at,home.door);assert.equal(a.inside,null);
}
export function openSupplyPool(f:SupplyFixture){
 const {w,a,b,home}=f;
 chooseSupply(f,a,x=>x.type==='household'&&x.operation==='create'&&x.targetId===b.id&&x.buildingId===home.id&&x.item==='meal','create meal-funded pool',{name:'分别出资的钓具交接',amount:0,quantity:1});
 const p=w.household!.pools.at(-1)!;
 assert.equal(p.status,'offered');assert.equal(a.inventory.meal,0);assert.equal(b.inventory.meal,1);
 assert.deepEqual(p.credits.map(c=>({ownerId:c.ownerId,inventory:c.inventory})),[{ownerId:a.id,inventory:{meal:1}}]);
 chooseSupply(f,b,x=>x.type==='household'&&x.operation==='respond'&&x.poolId===p.id&&x.accept===true,'second adult accepts pool');
 assert.equal(p.status,'open');assert.equal(b.inventory.meal,0);
 assert.deepEqual(p.credits.map(c=>({ownerId:c.ownerId,inventory:c.inventory})),[{ownerId:a.id,inventory:{meal:1}},{ownerId:b.id,inventory:{meal:1}}]);
 return p;
}
export function proposeSupplyKit(f:SupplyFixture){
 craftSupplyKit(f);const p=openSupplyPool(f),{w,a,teen}=f;
 chooseSupply(f,a,x=>x.type==='household'&&x.operation==='deposit'&&x.poolId===p.id&&x.item==='rodKit','deposit actual crafted kit',{amount:0,quantity:1});
 assert.equal(a.inventory.rodKit,0);assert.equal(p.credits.find(c=>c.ownerId===a.id)!.inventory.rodKit,1);
 chooseSupply(f,a,x=>x.type==='household'&&x.operation==='proposeGift'&&x.poolId===p.id&&x.item==='rodKit'&&x.targetId===teen.id,'propose kit gift',{amount:0,quantity:1,ownPercent:100});
 const g=w.household!.gifts.at(-1)!;
 // Proposals require actual proximity. After hearing it, the receiver walks away
 // through a numbered movement and must return personally to collect.
 walkAway(f,teen);
 assert.equal(g.status,'proposed');assert.equal(g.proposerId,a.id);assert.equal(g.approverId,f.b.id);
 assert.deepEqual(g.costs.map(c=>({ownerId:c.ownerId,inventory:c.inventory})),[{ownerId:a.id,inventory:{rodKit:1}},{ownerId:f.b.id,inventory:{rodKit:0}}]);
 assert.deepEqual(g.segments,[]);assert.equal(teen.inventory.rodKit??0,0);return {p,g};
}
export function approveSupplyKit(f:SupplyFixture,giftId:string){
 chooseSupply(f,f.b,x=>x.type==='household'&&x.operation==='approveGift'&&x.giftId===giftId,'second adult approves gift');
 const g=f.w.household!.gifts.find(g=>g.id===giftId)!;assert.equal(g.status,'ready');assert.equal(f.teen.inventory.rodKit??0,0);return g;
}
export function carriedSupplyRods(w:World,r:Resident){return w.industry!.tools.filter(t=>t.ownerId===r.id&&t.kind==='rod'&&!t.location);}
export function physicalSupplyKitCount(w:World){
 const bags:Inventory[]=[...w.residents.map(r=>r.inventory),...(w.household?.pools.flatMap(p=>p.credits.map(c=>c.inventory))??[]),...(w.household?.gifts.flatMap(g=>g.segments.map(c=>c.inventory))??[])];
 return bags.reduce((n,bag)=>n+(bag.rodKit??0),0);
}
