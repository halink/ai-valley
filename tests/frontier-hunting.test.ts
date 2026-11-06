import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import type {IndustryAction,ToolAsset} from '../src/shared/industry.js';
import type {Resident,World} from '../src/shared/types.js';
import {advanceFood} from '../src/world/food.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {completeIndustry} from '../src/world/industry.js';
import {findPath,walkable} from '../src/world/navigation.js';
import {DAY} from '../src/world/time.js';

function choose(w:World,r:Resident,pick:(action:IndustryAction)=>boolean){
 const choices=decisionChoices(decisionContext(w,r));
 const option=choices.find(c=>c.action.type==='industry'&&pick(c.action));
 assert.ok(option,'the actual model menu contains the requested choice');
 return parseChoice(JSON.stringify({choice:option.id}),choices).actions[0] as IndustryAction;
}

function begin(w:World,r:Resident,action:IndustryAction){
 const result=submitPlan(w,{id:`test-hunt:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'本人选择此行动',actions:[action]});
 assert.ok(result.ok,result.error);
}

function finish(w:World,r:Resident){
 for(let i=0;i<160&&(r.activity||r.plan);i++)stepWorld(w,1);
 assert.equal(r.activity,null);
 assert.equal(r.plan,null);
}

function fixture(){
 const w=createFrontierWorld(),r=w.residents.find(p=>p.skills.building>0)!;
 const beast=w.frontierHazards!.beasts.find(b=>b.species==='boar')!;
 w.clock.paused=false;beast.nextMoveAt=w.minute+DAY;beast.cooldownUntil=beast.nextMoveAt;
 return {w,r,beast};
}

function approachFixture(w:World,r:Resident,prey:{x:number;y:number}){
 const near=[{x:prey.x+4,y:prey.y},{x:prey.x-4,y:prey.y},{x:prey.x,y:prey.y+4},{x:prey.x,y:prey.y-4}]
  .find(at=>walkable(w,at)&&findPath(w,at,prey,false,8));
 assert.ok(near);
 r.at={...near};r.inside=null;r.roomAt=null;
}

test('residents can choose to make and equip a real spear, hunt a finite animal, and cook their perishable catch',()=>{
 const {w,r,beast}=fixture();
 r.inventory.fiber=1;
 const before={wood:r.inventory.wood!,stone:r.inventory.stone!};
 begin(w,r,choose(w,r,a=>a.operation==='craft'&&a.recipeId==='spear'));
 stepWorld(w,40);
 assert.equal(r.inventory.spearKit,undefined);
 assert.ok(r.activity,'crafting requires actual travel and work');
 finish(w,r);assert.equal(r.lastFailure,null);
 assert.equal(r.inventory.wood,before.wood-3);
 assert.equal(r.inventory.stone,before.stone-2);
 assert.equal(r.inventory.fiber,0);
 assert.equal(r.inventory.spearKit,1);
 begin(w,r,choose(w,r,a=>a.operation==='equip'&&a.tool==='spear'));
 finish(w,r);assert.equal(r.lastFailure,null);
 assert.equal(r.inventory.spearKit,0);
 const spear=w.industry!.tools.find(t=>t.kind==='spear'&&t.ownerId===r.id)!;
 assert.ok(spear);
 approachFixture(w,r,beast.at);
 const sighting={...beast.at};
 const strike=choose(w,r,a=>a.operation==='hunt'&&a.beastId===beast.id);
 assert.deepEqual(strike.at,sighting);
 const unused=spear.durability;
 begin(w,r,strike);stepWorld(w,2);
 assert.notDeepEqual(r.at,beast.at);
 assert.equal(spear.durability,unused);
 finish(w,r);assert.equal(r.lastFailure,null);
 assert.deepEqual(r.at,sighting);
 assert.equal(beast.status,'alive');
 assert.ok(beast.health!<55);
 assert.equal(beast.alert?.residentId,r.id);
 assert.equal(spear.durability,unused-1);
 assert.equal(r.inventory.gameMeat,undefined);

 const exposed=structuredClone(w),exposedHunter=exposed.residents.find(p=>p.id===r.id)!;
 stepWorld(exposed,15);
 assert.ok(exposedHunter.health<r.health-10,'remaining within reach after a first strike risks a real counterattack');

 // The alert is a real counterattack. The hunter can independently choose a second strike.
 begin(w,r,choose(w,r,a=>a.operation==='hunt'&&a.beastId===beast.id));
 finish(w,r);assert.equal(r.lastFailure,null);
 assert.equal(beast.status,'dead');
 assert.equal(beast.deathCause,'hunted');
 assert.equal(spear.durability,unused-2);
 assert.equal(r.inventory.gameMeat,5);
 assert.equal(w.frontierHazards!.totals.hunted,1);
 assert.equal(w.industry!.totals.gameMeat,5);
 const lot=w.food!.lots['person:'+r.id].gameMeat![0];
 assert.equal(lot.expiresAt,lot.producedAt+2*DAY);
 assert.ok(!decisionChoices(decisionContext(w,r)).some(c=>c.action.type==='industry'&&c.action.operation==='hunt'&&c.action.beastId===beast.id));
 assert.ok(completeIndustry(w,r,strike));
 assert.equal(r.inventory.gameMeat,5);

 const home=w.buildings.find(b=>b.id===r.homeId)!;
 r.at={...home.door};r.inside=null;r.roomAt=null;
 const meals=r.inventory.meal??0;
 begin(w,r,choose(w,r,a=>a.operation==='craft'&&a.recipeId==='gameMeal'));
 finish(w,r);assert.equal(r.lastFailure,null);
 assert.equal(r.inventory.gameMeat,4);
 assert.equal(r.inventory.meal,meals+2);

 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);
  const saved=store.load()!;
  assert.equal(saved.frontierHazards!.beasts.find(b=>b.id===beast.id)?.status,'dead');
  assert.equal(saved.food!.lots['person:'+r.id].gameMeat![0].expiresAt,lot.expiresAt);
  saved.minute=lot.expiresAt;advanceFood(saved);
  assert.equal(saved.residents.find(p=>p.id===r.id)!.inventory.gameMeat,0);
 }finally{store.close();}
});

test('a beast moving away from its sighting leaves the hunter at the observed place with no phantom catch',()=>{
 const {w,r,beast}=fixture();
 const spear:ToolAsset={kind:'spear',id:'old-spear',ownerId:r.id,level:1,durability:10,maxDurability:10};
 w.industry!.tools.push(spear);
 approachFixture(w,r,beast.at);
 const strike=choose(w,r,a=>a.operation==='hunt'&&a.beastId===beast.id);
 const original={...beast.at};
 begin(w,r,strike);stepWorld(w,1);
 const away=[{x:original.x+4,y:original.y},{x:original.x-4,y:original.y},{x:original.x,y:original.y+4},{x:original.x,y:original.y-4}].find(at=>walkable(w,at));
 assert.ok(away);beast.at=away;
 finish(w,r);
 assert.deepEqual(r.at,original);
 assert.match(r.lastFailure??'',/未能接近/);
 assert.equal(spear.durability,10);
 assert.equal(beast.health,100);
 assert.equal(r.inventory.gameMeat,undefined);
});
