import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {disasterContains} from '../src/shared/frontier-hazards.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFrontierHazards,frontierShelterOccupants} from '../src/world/frontier-hazards.js';
import {setWeatherHazardsEnabled} from '../src/world/weather-hazards.js';
import {initializeWaterSupply,waterDrunkToday} from '../src/world/water-supply.js';
import {assistedWaterNeed} from '../src/world/water-support.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

// Every fact below belongs to a newly synthesized world. No runtime entry point,
// model, real save or browser is used. Existing buckets are explicit fixture stock.
function fixture(){
 const w=createWorld(73);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.minute=600;w.weather='rain';
 w.map={name:'隔离洪灾供水联合验收',width:40,height:32,tiles:Array(1280).fill('grass'),entrance:{x:1,y:1},settlement:{x:15,y:20}};
 w.map.tiles[20*40+22]='water';
 const hall={...w.buildings.find(b=>b.kind==='lodge')!,id:'dry-hall',name:'原有避雨共屋',at:{x:13,y:13},width:5,height:6,door:{x:17,y:19},capacity:1,residents:[] as string[],ownerId:'commons',condition:100};
 const shed={...hall,id:'flood-shed',name:'原有岸边工屋',at:{x:21,y:17},width:3,height:2,door:{x:21,y:19}};
 w.buildings=[hall,shed];w.plots=[];w.graves=[];
 w.resources=[{id:'flood-spring',kind:'spring',at:{x:21,y:20},amount:7,max:7,regrowthDays:0,lastHarvest:w.minute},{id:'alternate-spring',kind:'spring',at:{x:18,y:22},amount:9,max:9,regrowthDays:0,lastHarvest:w.minute}];
 w.residents=w.residents.slice(0,3);
 for(const p of w.residents){p.homeId=null;p.at={x:20,y:20};p.inside=null;p.roomAt=null;p.bornAt=w.minute-25*YEAR;p.residency='resident';p.health=p.energy=100;p.hunger=0;p.inventory={wood:8,stone:8,water:0,meal:8};p.knownBuildings=w.buildings.map(b=>b.id);p.knownResources=w.resources.map(s=>s.id);p.activity=null;p.plan=null;p.canDecide=p.canExpress=true;p.skills.care=2;p.parents=[];p.guardianIds=[];}
 const [evacuee,patient,provider]=w.residents;provider.at={x:19,y:20};
 initializeFrontierHazards(w);w.frontierHazards!.beasts=[];initializeWaterSupply(w);
 w.waterSupply!.vessels.push({id:'existing-bucket',ownerId:provider.id,buildingId:null,capacity:6,amount:0,quality:'safe',createdAt:w.minute});
 return {w,evacuee,patient,provider,hall,shed};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
function select(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 const choices=menu(w,r),choice=choices.find(c=>predicate(c.action));
 assert.ok(choice,`normal menu has the requested choice for ${r.id}: ${choices.map(c=>c.id).join(', ')}`);
 return parseChoice(JSON.stringify({choice:choice.id,...fields}),choices);
}
// The compact menu rotates ordinary actions and two water choices every 30 minutes.
// Wait by explicit normal choices, not by overriding the final offered menu.
function eventualChoice(w:World,r:Resident,predicate:(a:Action)=>boolean){
 for(let tries=0;tries<240;tries++){
  if(menu(w,r).some(c=>predicate(c.action)))return select(w,r,predicate);
  run(w,r,select(w,r,a=>a.type==='wait',{minutes:1}));
 }
 return select(w,r,predicate);
}
function queue(w:World,r:Resident,decision:ReturnType<typeof parseChoice>){
 const plan={id:`joint:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision};
 const accepted=submitPlan(w,plan);assert.equal(accepted.ok,true,accepted.error);return plan;
}
function finish(w:World,r:Resident){let guard=500;while(r.plan||r.activity){assert.ok(guard-->0,'bounded actual engine execution');stepWorld(w,1);}}
function run(w:World,r:Resident,decision:ReturnType<typeof parseChoice>){const plan=queue(w,r,decision);finish(w,r);assert.equal(r.lastFailure,null);return plan;}
function until(w:World,condition:()=>boolean,max=500){while(!condition()){assert.ok(max-->0,'bounded chronological progression');stepWorld(w,1);}}
function warn(f:ReturnType<typeof fixture>){
 const {w}=f,locations=w.residents.map(r=>({...r.at})),stocks=w.residents.map(r=>({...r.inventory})),vessels=structuredClone(w.waterSupply!.vessels);
 assert.equal(w.frontierHazards!.weather!.enabled,false);setWeatherHazardsEnabled(w,true);
 until(w,()=>w.frontierHazards!.disasters.some(d=>d.kind==='flashFlood'));
 const d=w.frontierHazards!.disasters.find(d=>d.kind==='flashFlood')!;
 assert.equal(d.phase,'warning');assert.equal(d.startsAt-d.warningAt,90);assert.ok(d.weatherEvidence!.runoff>=180);
 assert.deepEqual(w.residents.map(r=>r.at),locations);assert.deepEqual(w.residents.map(r=>r.inventory),stocks);
 assert.ok(w.residents.every(r=>r.plan===null&&r.activity===null));assert.deepEqual(w.waterSupply!.vessels,vessels);
 // Stop future scheduling in this isolated world; the recorded event must continue.
 setWeatherHazardsEnabled(w,false);return d;
}
function totalWater(w:World){return w.resources.filter(s=>s.kind==='spring').reduce((n,s)=>n+s.amount,0)+w.waterSupply!.vessels.reduce((n,v)=>n+v.amount,0)+w.residents.reduce((n,r)=>n+(r.inventory.water??0),0);}

test('generated flood joins voluntary retreat, actual injury, alternate water, consented care, repair and durable reload through normal menus',()=>{
 const f=fixture(),{w,evacuee,patient,provider,shed}=f;
 const staleFill=eventualChoice(w,provider,a=>a.type==='waterSupply'&&a.operation==='fillSpring'&&a.sourceId==='flood-spring');
 const initialWater=totalWater(w),d=warn(f),initialAt={...patient.at};
 run(w,evacuee,select(w,evacuee,a=>a.type==='frontierHazard'&&a.operation==='retreat'));
 assert.equal(disasterContains(d,evacuee.at),false);assert.equal(evacuee.health,100);
 // The patient deliberately remains. This deterministic menu selection is not an AI decision.
 run(w,patient,select(w,patient,a=>a.type==='wait',{minutes:5}));assert.deepEqual(patient.at,initialAt);
 until(w,()=>d.phase==='active');assert.equal(w.resources[0].amount,7);assert.equal(w.resources[0].floodDamage!.disasterId,d.id);assert.equal(w.resources[0].floodDamage!.clearedAt,null);
 assert.ok(shed.condition<100);assert.equal(totalWater(w),initialWater);
 queue(w,provider,staleFill);finish(w,provider);assert.match(provider.lastFailure!,/淤塞/);assert.equal(totalWater(w),initialWater);
 assert.equal(menu(w,provider).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='clearSpring'),false);
 until(w,()=>w.events.some(e=>e.hazardFact?.disasterId===d.id&&e.hazardFact.phase==='injury'&&e.actors.includes(patient.id)));
 assert.ok(patient.health<100);assert.ok(w.health!.cases.some(c=>c.personId===patient.id&&c.kind==='injury'));assert.equal(assistedWaterNeed(w,patient),null);
 run(w,patient,select(w,patient,a=>a.type==='frontierHazard'&&a.operation==='retreat'));
 assert.equal(disasterContains(d,patient.at),false);
 run(w,provider,eventualChoice(w,provider,a=>a.type==='waterSupply'&&a.operation==='fillSpring'&&a.sourceId==='alternate-spring'));
 assert.equal(w.resources[1].amount,6);assert.equal(w.waterSupply!.vessels[0].amount,3);assert.equal(totalWater(w),initialWater);
 run(w,patient,eventualChoice(w,patient,a=>a.type==='waterSupply'&&a.operation==='authorizeAssist'&&a.targetId===provider.id));
 const consent=w.waterSupply!.assistance![0];assert.equal(consent.used,0);assert.equal(waterDrunkToday(w,patient.id),0);
 const aidChoice=eventualChoice(w,provider,a=>a.type==='waterSupply'&&a.operation==='assistDrink');
 const health=patient.health,at=w.minute,aid=run(w,provider,aidChoice);
 assert.ok(w.minute-at>=5);assert.equal(patient.health,health,'water itself supplies no health bonus');assert.equal(consent.used,1);assert.equal(waterDrunkToday(w,patient.id),1);assert.equal(w.waterSupply!.vessels[0].amount,2);assert.equal(totalWater(w)+1,initialWater);
 until(w,()=>d.phase==='ended');
 const wood=provider.inventory.wood!,stone=provider.inventory.stone!,clearAt=w.minute;
 run(w,provider,select(w,provider,a=>a.type==='frontierHazard'&&a.operation==='clearSpring'));
 assert.ok(w.minute-clearAt>=60);assert.equal(provider.inventory.wood,wood-1);assert.equal(provider.inventory.stone,stone-2);assert.equal(w.resources[0].amount,7);assert.ok(w.resources[0].floodDamage!.clearedAt!==null);
 const repair=eventualChoice(w,provider,a=>a.type==='frontierHazard'&&a.operation==='repair'&&a.buildingId===shed.id),repairAt=w.minute;
 run(w,provider,repair);assert.ok(w.minute-repairAt>=34,'building repair itself requires actual work time');
 assert.equal(shed.condition,100);assert.equal(provider.inventory.wood,wood-3);assert.equal(provider.inventory.stone,stone-3);
 const phases=new Set(w.events.filter(e=>e.hazardFact?.disasterId===d.id).map(e=>e.hazardFact!.phase));
 for(const phase of ['warning','active','injury','retreat','damage','ended','repair'] as const)assert.ok(phases.has(phase),phase);
 for(const targetId of ['flood-spring',shed.id])for(const phase of ['damage','repair'] as const){
  assert.equal(w.events.filter(e=>e.hazardFact?.disasterId===d.id&&e.hazardFact.targetId===targetId&&e.hazardFact.phase===phase).length,1,`${targetId} has exactly one linked ${phase}`);
 }
 const directory=mkdtempSync(join(testTmpdir(),'valley-disaster-chain-')),path=join(directory,'synthetic.sqlite');
 let store:WorldStore|undefined;
 try{
  store=new WorldStore(path);store.commit(w,null);store.close();store=undefined;
  store=new WorldStore(path);const loaded=store.load()!;store.close();store=undefined;
  const restored=loaded.residents.find(r=>r.id===provider.id)!;
  assert.deepEqual(loaded.frontierHazards,w.frontierHazards);assert.deepEqual(loaded.resources,w.resources);assert.deepEqual(loaded.waterSupply,w.waterSupply);assert.deepEqual(loaded.health,w.health);
  const before=JSON.stringify(loaded.waterSupply);assert.equal(submitPlan(loaded,aid).ok,true);assert.equal(restored.plan,null);assert.equal(JSON.stringify(loaded.waterSupply),before);assert.equal(totalWater(loaded)+1,initialWater);
  run(loaded,restored,eventualChoice(loaded,restored,a=>a.type==='waterSupply'&&a.operation==='fillSpring'&&a.sourceId==='flood-spring'));
  assert.equal(loaded.resources[0].amount,4);assert.equal(loaded.waterSupply!.vessels[0].amount,5);assert.equal(totalWater(loaded)+1,initialWater);assert.equal(loaded.frontierHazards!.weather!.enabled,false);
  assert.ok(loaded.residents.every(r=>!('thirst'in r)));
 }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});

test('warning shelter capacity is rechecked for a stale competing arrival without beds, supplies or automatic evacuation',()=>{
 const f=fixture(),{w,evacuee,patient,hall}=f,d=warn(f);
 const first=select(w,evacuee,a=>a.type==='frontierHazard'&&a.operation==='shelter'),second=select(w,patient,a=>a.type==='frontierHazard'&&a.operation==='shelter');
 const inventory=structuredClone(w.residents.map(r=>r.inventory)),water=totalWater(w);
 run(w,evacuee,first);assert.equal(evacuee.inside,hall.id);assert.equal(frontierShelterOccupants(w,hall).size,1);
 queue(w,patient,second);finish(w,patient);assert.match(patient.lastFailure!,/遮蔽/);assert.equal(patient.inside,null);assert.equal(patient.plan,null);
 assert.equal(menu(w,patient).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'),false);
 assert.deepEqual(hall.residents,[]);assert.equal(evacuee.homeId,null);assert.deepEqual(w.residents.map(r=>r.inventory),inventory);assert.equal(totalWater(w),water);
 run(w,patient,select(w,patient,a=>a.type==='frontierHazard'&&a.operation==='retreat'));assert.equal(disasterContains(d,patient.at),false);
 until(w,()=>d.phase==='ended');assert.equal(evacuee.health,100);assert.equal(evacuee.inside,hall.id,'no automatic eviction');assert.equal(w.frontierHazards!.weather!.enabled,false);
});

test('real flood injury and pending authorized assistance survive reload, but the recipients normal withdrawal stops unfinished water',()=>{
 const f=fixture(),{w,evacuee,patient,provider}=f;
 w.waterSupply!.vessels[0].amount=3; // Explicit pre-existing fixture stock, not a disaster grant.
 const initialWater=totalWater(w);
 run(w,patient,eventualChoice(w,patient,a=>a.type==='waterSupply'&&a.operation==='authorizeAssist'&&a.targetId===provider.id));
 const d=warn(f);run(w,evacuee,select(w,evacuee,a=>a.type==='frontierHazard'&&a.operation==='retreat'));
 until(w,()=>w.events.some(e=>e.hazardFact?.phase==='injury'&&e.actors.includes(patient.id)));
 run(w,patient,select(w,patient,a=>a.type==='frontierHazard'&&a.operation==='retreat'));
 queue(w,provider,eventualChoice(w,provider,a=>a.type==='waterSupply'&&a.operation==='assistDrink'));stepWorld(w,1);
 assert.equal(provider.activity!.action.type,'waterSupply');assert.ok(provider.activity!.remaining>0);assert.equal(waterDrunkToday(w,patient.id),0);
 const store=new WorldStore(':memory:');let loaded:World;
 try{store.commit(w,null);loaded=store.load()!;}finally{store.close();}
 const recipient=loaded.residents.find(r=>r.id===patient.id)!,helper=loaded.residents.find(r=>r.id===provider.id)!;
 assert.deepEqual(helper.activity,provider.activity);assert.deepEqual(loaded.resources[0].floodDamage,w.resources[0].floodDamage);assert.deepEqual(loaded.health!.cases,w.health!.cases);
 const minute=loaded.minute;
 queue(loaded,recipient,select(loaded,recipient,a=>a.type==='waterSupply'&&a.operation==='revokeAssist'));
 assert.equal(loaded.minute,minute);assert.equal(loaded.waterSupply!.assistance![0].revokedAt,minute);
 finish(loaded,helper);assert.match(helper.lastFailure!,/授权/);assert.equal(totalWater(loaded),initialWater);assert.equal(loaded.waterSupply!.vessels[0].amount,3);assert.equal(waterDrunkToday(loaded,recipient.id),0);assert.equal(loaded.waterSupply!.assistance![0].used,0);
 assert.equal(loaded.events.some(e=>e.waterSupply?.operation==='assistDrink'),false);
 until(loaded,()=>loaded.frontierHazards!.disasters.find(x=>x.id===d.id)!.phase==='ended');
 assert.equal(loaded.resources[0].floodDamage!.clearedAt,null,'ending the hazard alone never clears the spring');assert.equal(loaded.frontierHazards!.weather!.enabled,false);
});

test('two actual flood exposures reach the severe-care boundary without inventing medical water permission',()=>{
 const f=fixture(),{w,evacuee,patient,provider}=f;
 w.waterSupply!.vessels[0].amount=3;
 run(w,patient,eventualChoice(w,patient,a=>a.type==='waterSupply'&&a.operation==='authorizeAssist'&&a.targetId===provider.id));
 const initialWater=totalWater(w),d=warn(f);
 run(w,evacuee,select(w,evacuee,a=>a.type==='frontierHazard'&&a.operation==='retreat'));
 until(w,()=>w.events.filter(e=>e.hazardFact?.disasterId===d.id&&e.hazardFact.phase==='injury'&&e.actors.includes(patient.id)).length===2);
 assert.ok(patient.health>20);assert.equal(patient.canDecide,true);assert.match(assistedWaterNeed(w,patient)!,/重症/);
 run(w,patient,select(w,patient,a=>a.type==='frontierHazard'&&a.operation==='retreat'));
 assert.equal(disasterContains(d,patient.at),false);assert.equal(menu(w,provider).some(c=>c.action.type==='waterSupply'&&c.action.operation==='assistDrink'),false);
 assert.equal(totalWater(w),initialWater);assert.equal(waterDrunkToday(w,patient.id),0);assert.equal(w.waterSupply!.assistance![0].used,0);
 assert.ok(w.health!.cases.find(c=>c.personId===patient.id)!.severity>=50);assert.ok(w.residents.every(r=>!('thirst'in r)));
});
