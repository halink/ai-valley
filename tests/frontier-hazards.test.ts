import assert from 'node:assert/strict';
import {test} from 'node:test';
import {frontierHazardNotes,frontierHazardOpportunities} from '../src/server/frontier-hazard-opportunities.js';
import type {FrontierDisaster} from '../src/shared/frontier-hazards.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {advanceFrontierHazards,completeFrontierHazard,initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {createWorld} from '../src/world/seed.js';

function fixture(){
 const w=createWorld(73),[first,second]=w.residents;
 w.mode='formal';w.scenario='frontier';w.clock.paused=false;
 w.map.settlement={x:35,y:32};
 w.map.tiles=w.map.tiles.map((_,i)=>i%w.map.width===50?'water':'grass');
 w.resources=[];
 first.at={...w.map.settlement};second.at={x:36,y:32};
 initializeFrontierHazards(w);
 return {w,first,second,state:w.frontierHazards!};
}

test('beasts patrol real terrain and a warned resident can avoid an attack by physically walking away',()=>{
 const {w,first,state}=fixture(),boar=state.beasts.find(b=>b.species==='boar')!;
 assert.ok(state.beasts.some(animal=>animal.species==='wolf'));
 const spawn={...boar.at};
 stepWorld(w,8);
 assert.notDeepEqual(boar.at,spawn);
 first.at={...boar.at};w.minute=boar.cooldownUntil;
 advanceFrontierHazards(w,1);
 assert.equal(boar.alert?.residentId,first.id);
 assert.match(frontierHazardNotes(w,first),/野猪/);
 const retreat=frontierHazardOpportunities(w,first).find(c=>c.action.type==='frontierHazard'&&c.action.operation==='retreat')!;
 assert.ok(retreat);
 const health=first.health;
 assert.equal(submitPlan(w,{id:'retreat',actorId:first.id,actorRevision:first.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'走远一些',actions:[retreat.action]}).ok,true);
 stepWorld(w,40);
 assert.equal(first.health,health);
 assert.equal(first.status,'alive');
 assert.ok(w.events.some(e=>e.kind==='hazard'&&e.text.includes('自行撤离')));
});

test('continued close exposure can cause a recorded accidental death and preserves the normal estate',()=>{
 const {w,first,state}=fixture(),boar=state.beasts[0];
 first.at={...boar.at};first.health=25;
 w.minute=boar.cooldownUntil;
 advanceFrontierHazards(w,1);
 assert.equal(first.status,'alive');
 const warning=boar.alert!.attackAt;
 w.clock.paused=true;w.minute=warning;
 advanceFrontierHazards(w,1);
 assert.equal(first.status,'alive');
 w.clock.paused=false;
 advanceFrontierHazards(w,1);
 advanceFrontierHazards(w,1);
 assert.equal(first.status,'dead');
 assert.equal(first.deathCause,'accident');
 assert.equal(state.totals.accidentalDeaths,1);
 assert.equal(w.estates.filter(e=>e.personId===first.id).length,1);
 assert.ok(w.events.some(e=>e.kind==='death'&&e.text.includes('野猪袭击')));
});

test('a flood progresses from warning to local crop damage and expires using world time',()=>{
 const {w,first,state}=fixture();
 w.minute=state.nextDisasterAt;
 advanceFrontierHazards(w,1);
 const flood=state.disasters[0];
 assert.equal(flood.kind,'flashFlood');assert.equal(flood.phase,'warning');
 assert.equal(frontierHazardNotes(w,first),'');
 const plot={...w.plots[0],at:{...flood.at},crop:{definition:'crop/turnip@1',planted:w.minute,growth:2,wateredDay:0,lastGrowthDay:0}};
 w.plots=[plot];
 w.minute=flood.startsAt;
 advanceFrontierHazards(w,1);
 assert.equal(flood.phase,'active');assert.equal(plot.crop,null);
 assert.equal(state.totals.damagedPlots,1);
 w.minute=flood.endsAt;
 advanceFrontierHazards(w,1);
 assert.equal(flood.phase,'ended');
 assert.equal(state.totals.damagedPlots,1);
});

test('a storm harms an exposed person and damages a real building while a sound roof protects the occupant',()=>{
 const {w,first,second,state}=fixture(),house=w.buildings.find(b=>b.id===second.homeId)!;
 first.at={...house.door};second.at={...house.door};second.inside=house.id;
 const storm:FrontierDisaster={id:'storm:test',kind:'windstorm',at:{...house.door},radius:7,phase:'warning',warningAt:w.minute,startsAt:w.minute+1,endsAt:w.minute+50,intensity:24,warned:[],exposure:{}};
 state.disasters=[storm];
 const firstHealth=first.health,secondHealth=second.health;
 stepWorld(w,25);
 assert.ok(first.health<firstHealth);
 assert.equal(second.health,secondHealth);
 assert.equal(house.condition,76);
 assert.equal(state.totals.damagedBuildings,1);
 assert.ok(w.health?.cases.some(c=>c.personId===first.id&&c.source==='山谷风暴'));
 house.ownerId=second.id;second.knownBuildings.push(house.id);second.inventory.wood=2;second.inventory.stone=1;
 assert.equal(completeFrontierHazard(w,second,{type:'frontierHazard',operation:'repair',buildingId:house.id}),null);
 assert.equal(house.condition,100);
 assert.equal(second.inventory.wood,0);
});
