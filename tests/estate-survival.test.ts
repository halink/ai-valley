import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import {hasTimelySelfRescue,stepWorld,submitPlan} from '../src/world/engine.js';
import {initializeFood} from '../src/world/food.js';
import {recordDeath} from '../src/world/life.js';
import {createWorld} from '../src/world/seed.js';
import {YEAR} from '../src/world/time.js';

const choices=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r)).map(c=>c.action);
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.resources=[];w.plots=[];
 for(const p of w.residents){
  p.at={x:34,y:40};p.inside=null;p.roomAt=null;p.hunger=20;p.energy=80;p.health=100;
  p.bornAt=w.minute-30*YEAR;p.inventory={};p.knownPeople=w.residents.map(r=>r.id);
  p.knownBuildings=w.buildings.map(b=>b.id);p.parents=[];p.decisionDue=w.minute+1000;p.lastDecisionAt=w.minute;
 }
 stepWorld(w,.001);
 const [dead,heir]=w.residents;heir.bornAt=w.minute-13*YEAR;heir.parents=[dead.id];
 dead.inventory={meal:4,wood:5};initializeFood(w);recordDeath(w,dead);
 heir.hunger=98;heir.health=2;heir.decisionDue=w.minute;
 const menu=decisionChoices(decisionContext(w,heir));
 const offered=menu.find(c=>c.action.type==='production'&&c.action.operation==='emergencyEstateRation');
 assert.ok(offered,'the real final menu must offer the legal food source');
 return {w,dead,heir,menu,offered};
}
function choose(w:World,r:Resident,action:Action,id:string){
 assert.equal(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人实际选择',actions:[action]}).ok,true);
}

test('normal-menu emergency estate food enables protection without taking it, then actual collection and eating rescue the heir',()=>{
 const {w,dead,heir,menu,offered}=fixture(),before=structuredClone(w);
 assert.equal(hasTimelySelfRescue(w,heir,menu.map(c=>c.action)),true);
 assert.deepEqual(w,before);
 stepWorld(w,1,{decisionChoices:choices});
 assert.equal(heir.health,2);assert.equal(heir.decisionProtection?.endedAt,null);
 assert.deepEqual(heir.inventory,{});assert.equal(w.estates.find(e=>e.personId===dead.id)!.inventory.meal,4);
 const coins=heir.coins,owners=w.buildings.map(b=>b.ownerId);
 const selected=parseChoice(JSON.stringify({choice:offered.id}),menu);
 choose(w,heir,selected.actions[0],'take-ration');stepWorld(w,5);
 assert.equal(heir.lastFailure,null);assert.equal(heir.inventory.meal,1);
 assert.equal(heir.decisionProtection?.reason,'decision');assert.ok(heir.hunger>95,'collection alone does not eat for the heir');
 choose(w,heir,{type:'eat',item:'meal'},'eat-ration');stepWorld(w,5);
 assert.equal(heir.inventory.meal,0);assert.equal(heir.status,'alive');assert.ok(heir.health>0);assert.ok(heir.hunger<95);
 assert.equal(heir.coins,coins);assert.deepEqual(w.buildings.map(b=>b.ownerId),owners);
 assert.equal(w.production!.emergencyFood![heir.id].receipts.length,1);
});

for(const failure of ['missing-stock','spoil-before-eating','blocked-route','lost-age-eligibility'] as const){
 test(`emergency estate forecasts reject ${failure} even when an older prompt offered the action`,()=>{
  const {w,dead,heir,menu}=fixture();
  if(failure==='missing-stock')w.estates.find(e=>e.personId===dead.id)!.inventory={wood:5};
  else if(failure==='spoil-before-eating')for(const lot of w.food!.lots['estate:'+dead.id].meal!)lot.expiresAt=w.minute+7;
  else if(failure==='blocked-route'){
   w.map.tiles=w.map.tiles.map(()=> 'grass');heir.at={x:40,y:40};
   for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(dead.at.y+dy)*w.map.width+dead.at.x+dx]='cliff';
  }else heir.bornAt=w.minute-18*YEAR;
  const before=structuredClone(w);
  assert.equal(hasTimelySelfRescue(w,heir,menu.map(c=>c.action)),false);
  assert.deepEqual(w,before);
  stepWorld(w,1,{decisionChoices:()=>menu.map(c=>c.action)});
  assert.equal(heir.decisionProtection,undefined);assert.ok(heir.health<2);
 });
}

test('losing an estate food source during model waiting ends protection instead of preserving a stale positive forecast',()=>{
 const {w,dead,heir,menu}=fixture();stepWorld(w,1,{decisionChoices:choices});
 assert.equal(heir.decisionProtection?.endedAt,null);
 const deadline=heir.decisionProtection!.expiresAt;
 for(const lot of w.food!.lots['estate:'+dead.id].meal!)lot.expiresAt=w.minute+.1;
 // Retain the in-flight prompt as runtime does; both its action and the live
 // source must still be executable, rather than trusting an earlier result.
 stepWorld(w,1,{decisionChoices:()=>menu.map(c=>c.action)});
 assert.equal(heir.decisionProtection?.reason,'unavailable');assert.equal(heir.decisionProtection?.expiresAt,deadline);
 assert.ok(heir.health<2);assert.deepEqual(heir.inventory,{});
});
