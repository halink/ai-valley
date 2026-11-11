import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {disasterContains} from '../src/shared/frontier-hazards.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFrontierHazards,frontierShelterOccupants,frontierRetreatStepAllowed,usableFrontierShelter} from '../src/world/frontier-hazards.js';
import {setWeatherHazardsEnabled} from '../src/world/weather-hazards.js';
import {initializeWaterSupply} from '../src/world/water-supply.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {findPath} from '../src/world/navigation.js';
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
function queue(w:World,r:Resident,decision:ReturnType<typeof parseChoice>){
 const plan={id:`joint:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision};
 const accepted=submitPlan(w,plan);assert.equal(accepted.ok,true,accepted.error);return plan;
}
function finish(w:World,r:Resident){let guard=500;while(r.plan||r.activity){assert.ok(guard-->0,'bounded actual engine execution');stepWorld(w,1);}}
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


test('original dry roof has an ordinary path but no safe approach through the known storm',()=>{
 const f=fixture(),{w,evacuee,hall}=f,d=warn(f);
 const storm=w.frontierHazards!.disasters.find(d=>d.kind==='windstorm')!;
 assert.ok(storm);assert.equal(disasterContains(storm,evacuee.at),false);
 assert.equal(disasterContains(storm,hall.door),true);
 assert.equal(disasterContains(d,hall.door),false);
 assert.equal(usableFrontierShelter(w,evacuee,hall,d.id),true,'roof eligibility is distinct from route safety');
 assert.ok(findPath(w,evacuee.at,hall.door));
 assert.equal(findPath(w,evacuee.at,hall.door,false,Infinity,frontierRetreatStepAllowed(w,evacuee)),null);
 assert.equal(menu(w,evacuee).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'),false);
});

test('a normal shelter reply becomes stale when its safe door is replaced by the original unsafe geometry',()=>{
 const f=fixture(),{w,evacuee,hall}=f;
 hall.at={x:15,y:13};hall.door={x:19,y:19};warn(f);
 const stale=select(w,evacuee,a=>a.type==='frontierHazard'&&a.operation==='shelter');
 hall.at={x:13,y:13};hall.door={x:17,y:19};
 const locations=structuredClone(w.residents.map(r=>r.at)),inventory=structuredClone(w.residents.map(r=>r.inventory)),water=totalWater(w);
 const vessels=structuredClone(w.waterSupply!.vessels);
 assert.equal(menu(w,evacuee).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'),false);
 queue(w,evacuee,stale);finish(w,evacuee);
 assert.match(evacuee.lastFailure!,/没有可达路线/);
 assert.deepEqual(w.residents.map(r=>r.at),locations);assert.equal(evacuee.inside,null);
 assert.equal(evacuee.plan,null);assert.equal(evacuee.activity,null);
 assert.equal(frontierShelterOccupants(w,hall).size,0);assert.deepEqual(hall.residents,[]);
 assert.equal(evacuee.homeId,null);assert.deepEqual(w.residents.map(r=>r.inventory),inventory);
 assert.deepEqual(w.waterSupply!.vessels,vessels);assert.equal(totalWater(w),water);
 assert.equal(w.events.some(e=>e.hazardFact?.phase==='shelter'),false);
});
