import {finishChosenVisit} from './helpers/visitor-journeys.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeMigration,applyOutsideDecision,advanceMigration} from '../src/world/migration.js';
import {canInspectBuilding,knownBuildings} from '../src/world/building-knowledge.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {initializeProduction} from '../src/world/production.js';
import {initializeCivic} from '../src/world/civic.js';
import {advancePublicDuties} from '../src/world/public-duties.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {productionOpportunities} from '../src/server/production-opportunities.js';
import {frontierHazardOpportunities} from '../src/server/frontier-hazard-opportunities.js';
import {formalOpportunities} from '../src/server/formal-opportunities.js';
import {decisionContext,decisionChoices,prompt} from '../src/server/decisions.js';
import {buildChoices} from '../src/server/affordances.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;initializeRooms(w);
 const r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!,other=w.residents[1];
 r.knownBuildings=w.buildings.map(b=>b.id);r.inventory={wood:3,stone:2,turnip:2,water:1};
 r.at={...w.map.entrance};r.inside=null;r.roomAt=null;
 const hall=w.buildings.find(b=>b.kind==='lodge')!,privateHome=w.buildings.find(b=>b.ownerId===other.id)!;
 return {w,r,home,other,hall,privateHome};
}

test('an address-only visitor gets the same context, final choices and prompt after unseen commons changes',()=>{
 const w=createFrontierWorld();w.clock.paused=false;initializeMigration(w);
 const c=w.migration!.contacts[0],r=c.person!;c.phase='offered';
 assert.ok(applyOutsideDecision(w,r.id,r.revision,{intention:'我自己先来看看',actions:[{type:'travelToValley'}]}).ok);
 finishChosenVisit(w,r);initializeRooms(w);initializeProduction(w);initializeCivic(w);advancePublicDuties(w);
 decisionContext(w,r); // Unrelated legacy builders register definitions on their first query.
 const before=decisionContext(w,r),choices=decisionChoices(before),message=prompt(before)[0].content;
 const hall=w.buildings.find(b=>b.kind==='lodge')!;
 const address=before.buildings.find(b=>b.id===hall.id)!;assert.equal(address.observed,undefined);
 assert.deepEqual(Object.keys(address).sort(),['door','id','kind','name','ownerId']);
 for(const condition of [80,0,100]){
  hall.condition=condition;hall.capacity=99;hall.residents=['unobserved-private-registration'];
  hall.extensions=[{projectId:'hidden-project',definition:'hidden-version',completedAt:w.minute,addedArea:8}];
  w.rooms!.beds[hall.id]={'unobserved-private-registration':98};
  w.civic!.stores[hall.id]={meal:1234};
  const next=decisionContext(w,r);
  assert.deepEqual(next,before);assert.deepEqual(decisionChoices(next),choices);assert.equal(prompt(next)[0].content,message);
 }
 assert.ok(before.formal!.opportunities.some(c=>c.id==='duty.board.'+hall.id));
 assert.ok(choices.some(c=>c.action.type==='move'&&c.action.to.x===hall.door.x&&c.action.to.y===hall.door.y));
});

test('local public facts are a timestamped allow-list, not the building registry or private household membership',()=>{
 const {w,r,hall,other,privateHome}=fixture();hall.condition=67;hall.capacity=9;hall.residents=[other.id,'private-registry-id'];
 r.at={...hall.door};other.at={...r.at};other.inside=null;
 const before=JSON.stringify(w),places=knownBuildings(w,r),observed=places.find(b=>b.id===hall.id)!;
 assert.deepEqual(observed.observed,{atMinute:w.minute,condition:67,capacity:9});
 assert.equal('residents'in observed,false);assert.equal('definition'in observed,false);assert.equal('extensions'in observed,false);
 assert.equal('at'in observed,false);assert.equal('width'in observed,false);assert.equal('height'in observed,false);
 assert.equal(JSON.stringify(w),before);assert.equal(JSON.stringify(places).includes('private-registry-id'),false);
 privateHome.residents=[other.id];
 const context=decisionContext(w,r);assert.ok(context.people.some(p=>p.id===other.id));
 assert.equal('residents'in context.buildings.find(b=>b.id===privateHome.id)!,false,'seeing a person elsewhere cannot reveal their housing membership');
 observed.door.x++;assert.notEqual(observed.door.x,hall.door.x,'addresses are detached snapshots');
 hall.condition=20;assert.equal(observed.observed!.condition,67,'returned observations do not update themselves');
});

test('a private doorstep reveals exterior condition but not capacity, title holder or roster; entry reveals visible beds',()=>{
 const {w,r,privateHome}=fixture();r.at={...privateHome.door};privateHome.condition=73;privateHome.capacity=7;
 const outside=knownBuildings(w,r).find(b=>b.id===privateHome.id)!;
 assert.deepEqual(outside.observed,{atMinute:w.minute,condition:73});assert.equal(outside.ownerId,undefined);
 assert.equal('residents'in outside,false);
 r.inside=privateHome.id;r.roomAt={...roomLayout(w,privateHome).entry};
 const inside=knownBuildings(w,r).find(b=>b.id===privateHome.id)!;
 assert.equal(inside.observed?.capacity,7);assert.equal(inside.ownerId,undefined);assert.equal('residents'in inside,false);
});

test('being inside a different room, asleep or unable to observe does not reveal outside building state',()=>{
 const {w,r,home,hall}=fixture();r.at={...hall.door};r.inside=home.id;
 assert.equal(canInspectBuilding(w,r,hall),false);assert.equal(knownBuildings(w,r).find(b=>b.id===hall.id)!.observed,undefined);
 r.at={...home.door};r.roomAt={...roomLayout(w,home).slots.find(s=>s.kind==='bed')!.at};
 r.activity={planId:'sleeping',startedAt:w.minute,action:{type:'sleep',minutes:30},definition:'action/routine@1',path:[],target:{...home.door},remaining:30};
 assert.equal(knownBuildings(w,r).find(b=>b.id===home.id)!.observed,undefined);
 r.activity=null;r.canDecide=false;
 assert.equal(knownBuildings(w,r).find(b=>b.id===home.id)!.observed,undefined);
});

test('a remote registered home is unknown rather than a live bed guarantee, while return and sleep attempts remain available',()=>{
 const {w,r,home}=fixture();decisionContext(w,r);
 const first=decisionContext(w,r),basic=buildChoices(first).filter(c=>['move.home','sleep.duration','cook.1'].includes(c.id));
 assert.equal(first.formal!.hasBed,undefined);assert.equal(first.buildings.find(b=>b.id===home.id)!.observed,undefined);
 assert.ok(basic.some(c=>c.id==='sleep.duration'&&/尚待核实/.test(c.label)));
 home.condition=0;home.capacity=0;home.residents=[];
 const changed=decisionContext(w,r);
 assert.equal(changed.formal!.hasBed,undefined);assert.deepEqual(changed.buildings,first.buildings);
 assert.deepEqual(buildChoices(changed).filter(c=>['move.home','sleep.duration','cook.1'].includes(c.id)),basic);
 const sleep=basic.find(c=>c.id==='sleep.duration')!.action;assert.equal(sleep.type,'sleep');
 const action={type:'sleep' as const,minutes:30};
 assert.match(planStartError(w,{id:'stale-bed',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人尝试回登记住处睡觉',actions:[action]})!,/床位/);
 r.at={x:home.door.x,y:home.door.y+2};const local=decisionContext(w,r);
 assert.equal(local.formal!.hasBed,false);assert.equal(local.buildings.find(b=>b.id===home.id)!.observed!.condition,0);
 assert.ok(!buildChoices(local).some(c=>c.action.type==='sleep'));
 assert.ok(buildChoices(local).some(c=>c.id==='move.home'),'an unusable bed must not erase its known address');
});

test('a known distant home with a real bed still supports actual travel and chosen sleep',()=>{
 const {w,r,home}=fixture();r.energy=50;r.hunger=0;r.health=100;
 const choice=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='sleep'&&!c.action.buildingId)!;assert.ok(choice);
 const action={type:'sleep' as const,minutes:30};
 assert.ok(submitPlan(w,{id:'go-home',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'我回登记住处休息',actions:[action]}).ok);
 let remaining=300;while(r.plan||r.activity){assert.ok(remaining--);stepWorld(w,1);}
 assert.equal(r.lastFailure,null);assert.equal(r.inside,home.id);assert.ok(r.energy>50);
});

test('a local bed shortage does not erase an independently usable registered kitchen',()=>{
 const {w,r,home}=fixture();r.at={...home.door};home.capacity=0;
 const context=decisionContext(w,r);assert.equal(context.formal!.hasBed,false);
 assert.equal(context.buildings.find(b=>b.id===home.id)!.observed!.ownResidence,true);
 assert.ok(!buildChoices(context).some(c=>c.action.type==='sleep'));
 assert.ok(buildChoices(context).some(c=>c.action.type==='cook'));
});

test('settlement choices cannot reveal bed counts at nine or ten tiles or through another room',()=>{
 const {w,r,hall,home}=fixture();r.homeId=null;r.residency='visitor';r.knownBuildings=[hall.id];
 for(const distance of [9,10]){
  r.at={x:hall.door.x+distance,y:hall.door.y};r.inside=null;hall.capacity=0;hall.residents=[];
  const before=formalOpportunities(w,r,[]);assert.ok(!before.some(c=>c.id==='settle.'+hall.id));
  hall.capacity=8;assert.deepEqual(formalOpportunities(w,r,[]),before);
  assert.equal(knownBuildings(w,r)[0].observed,undefined);
 }
 r.at={...hall.door};r.inside=home.id;hall.capacity=0;const inside=formalOpportunities(w,r,[]);
 hall.capacity=8;assert.deepEqual(formalOpportunities(w,r,[]),inside);
 r.inside=null;r.at={x:hall.door.x+8,y:hall.door.y};
 assert.ok(formalOpportunities(w,r,[]).some(c=>c.id==='settle.'+hall.id));
 assert.equal(knownBuildings(w,r)[0].observed!.capacity,8);
 hall.capacity=0;assert.ok(!formalOpportunities(w,r,[]).some(c=>c.id==='settle.'+hall.id));
});

test('remote repair suggestions do not reveal damage, but observation makes local repair available',()=>{
 const {w,r,home,hall}=fixture();w.scenario='frontier';w.map.settlement={x:35,y:32};initializeFrontierHazards(w);initializeProduction(w);
 const workshops=w.buildings.filter(b=>b.kind==='workshop');workshops[0].ownerId=r.id;
 const beforeProduction=productionOpportunities(w,r),beforeHazards=frontierHazardOpportunities(w,r);
 home.condition=70;hall.condition=80;workshops[0].condition=25;
 assert.deepEqual(productionOpportunities(w,r),beforeProduction);assert.deepEqual(frontierHazardOpportunities(w,r),beforeHazards);
 assert.ok(beforeProduction.some(c=>c.id==='production.inspectBuilding.'+workshops[0].id));
 r.at={...home.door};
 assert.ok(productionOpportunities(w,r).some(c=>c.action.type==='production'&&c.action.operation==='repair'&&c.action.buildingId===home.id&&/现状70%/.test(c.label)));
 r.at={...hall.door};assert.ok(frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='repair'&&c.action.buildingId===hall.id));
 r.inside=home.id;assert.ok(!frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='repair'&&c.action.buildingId===hall.id));
});

test('legacy address knowledge survives reload without manufacturing observations or changing authoritative observer data',()=>{
 const {w,r,hall}=fixture();hall.capacity=19;hall.condition=42;
 const ids=[...r.knownBuildings],original=JSON.stringify(w),projection=knownBuildings(w,r);
 assert.equal(JSON.stringify(w),original);
 const store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load()!,person=loaded.residents.find(p=>p.id===r.id)!;
  assert.deepEqual(person.knownBuildings,ids);assert.deepEqual(knownBuildings(loaded,person),projection);
  const building=loaded.buildings.find(b=>b.id===hall.id)!;assert.equal(building.capacity,19);assert.equal(building.condition,42);
  person.at={...building.door};assert.equal(knownBuildings(loaded,person).find(b=>b.id===hall.id)!.observed?.condition,42);
  person.at={...loaded.map.entrance};building.condition=11;
  assert.equal(knownBuildings(loaded,person).find(b=>b.id===hall.id)!.observed,undefined);
 }finally{store.close();}
});
