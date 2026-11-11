import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Tile,World} from '../src/shared/types.js';
import {disasterContains,type FrontierDisaster} from '../src/shared/frontier-hazards.js';
import {createWorld} from '../src/world/seed.js';
import {advanceFrontierHazards,completeFrontierHazard,frontierHazardTarget,frontierShelterOccupants,initializeFrontierHazards,usableFrontierShelter} from '../src/world/frontier-hazards.js';
import {advanceWeatherHazards,floodFootprint,setWeatherHazardsEnabled} from '../src/world/weather-hazards.js';
import {initializeWaterSupply,waterSupplyReason,waterReceiptId} from '../src/world/water-supply.js';
import {frontierHazardOpportunities} from '../src/server/frontier-hazard-opportunities.js';
import {findPath,walkable} from '../src/world/navigation.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {YEAR} from '../src/world/time.js';
import {initializeInfrastructure} from '../src/world/infrastructure.js';

function fixture(seed=73){
 const w=createWorld(seed);w.mode='formal';w.scenario='frontier';w.clock.paused=false;
 w.map={name:'隔离天气验收',width:40,height:40,tiles:Array(1600).fill('grass') as Tile[],entrance:{x:1,y:1},settlement:{x:10,y:12}};
 for(let y=1;y<35;y++)w.map.tiles[y*40+22]='water';
 w.resources=[{id:'spring',kind:'spring',at:{x:21,y:20},amount:7,max:7,regrowthDays:0,lastHarvest:w.minute}];w.plots=[];w.graves=[];
 const b={...w.buildings[0],id:'shelter',kind:'lodge' as const,name:'原有共屋',ownerId:'commons',at:{x:7,y:8},width:4,height:3,door:{x:9,y:11},capacity:2,residents:[] as string[]};w.buildings=[b];
 for(const p of w.residents){p.homeId=null;p.at={x:10,y:12};p.inside=null;p.roomAt=null;p.bornAt=w.minute-25*YEAR;p.residency='resident';p.health=p.energy=100;p.hunger=0;p.inventory={wood:8,stone:8,water:7,meal:8};p.knownBuildings=[b.id];p.knownResources=['spring'];p.activity=null;p.plan=null;}
 initializeFrontierHazards(w);w.frontierHazards!.beasts=[];initializeWaterSupply(w);initializeInfrastructure(w);
 return {w,r:w.residents[0],other:w.residents[1],third:w.residents[2],b,s:w.frontierHazards!,spring:w.resources[0]};
}
function sample(w:World,n:number){for(let i=0;i<n;i++){w.minute++;advanceWeatherHazards(w,1);}}
function disaster(w:World,kind:'flashFlood'|'windstorm',at={x:22,y:20},footprint?:{x:number;y:number}[]):FrontierDisaster{
 const d:FrontierDisaster={id:`test:${kind}:${w.frontierHazards!.disasters.length}`,kind,at,radius:7,phase:'warning',warningAt:w.minute,startsAt:w.minute+1,endsAt:w.minute+250,intensity:24,warned:[],exposure:{},...(footprint?{footprint}:{}),weatherEvidence:{from:w.minute,through:w.minute,rainfall:200,runoff:200,wind:55,strongWindMinutes:70}};
 w.frontierHazards!.disasters.push(d);return d;
}
function run(w:World,r:Resident,action:Action){assert.equal(submitPlan(w,{id:`weather:${w.revision}:${w.minute}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人实地行动',actions:[action]}).ok,true);let guard=500;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}return r.lastFailure;}

test('new and legacy worlds default off without manufacturing rain, disasters or supplies',()=>{
 for(const legacy of [false,true]){const {w,s}=fixture(),before=JSON.stringify(w.resources);if(legacy)delete s.weather;
  w.weather='rain';w.minute=s.nextDisasterAt+100;advanceFrontierHazards(w,1);
  assert.equal(s.weather!.enabled,false);assert.equal(s.weather!.rainfall,0);assert.equal(s.disasters.length,0);assert.equal(JSON.stringify(w.resources),before);
 }
});

test('dry weather cannot create a flood; sustained simulated rain records measured evidence and a connected footprint',()=>{
 const {w,s}=fixture();setWeatherHazardsEnabled(w,true);sample(w,400);assert.equal(s.disasters.length,0);
 w.weather='rain';sample(w,350);const flood=s.disasters.find(d=>d.kind==='flashFlood')!;assert.ok(flood);assert.ok(flood.weatherEvidence!.rainfall>=180);assert.ok(flood.footprint!.length>0);assert.ok(disasterContains(flood,flood.weatherEvidence!.waterAt!));
 assert.ok(w.events.some(e=>e.hazardFact?.disasterId===flood.id&&e.hazardFact.phase==='warning'));
 const count=s.disasters.length,observed=s.weather!.rainfall;advanceWeatherHazards(w,1);assert.equal(s.weather!.rainfall,observed);assert.equal(s.disasters.length,count);
 setWeatherHazardsEnabled(w,false);sample(w,500);assert.equal(s.disasters.length,count);assert.equal(s.disasters.includes(flood),true);
});

test('strong wind needs observed duration rather than alternating with a forced flood',()=>{
 const {w,s}=fixture(9);setWeatherHazardsEnabled(w,true);w.weather='rain';sample(w,59);assert.equal(s.disasters.length,0);sample(w,1);
 assert.equal(s.disasters[0].kind,'windstorm');assert.ok(s.disasters[0].weatherEvidence!.wind>=48);assert.equal(s.disasters[0].weatherEvidence!.strongWindMinutes,60);
});

test('flood footprint follows connected water, stops at cliffs and cannot jump a land barrier into another water body',()=>{
 const {w}=fixture();w.map.tiles.fill('grass');w.map.tiles[20*40+20]='water';w.map.tiles[20*40+22]='water';w.map.tiles[19*40+20]='cliff';
 const points=floodFootprint(w,{x:20,y:20});assert.ok(points.some(p=>p.x===21&&p.y===20));assert.ok(!points.some(p=>p.x===22&&p.y===20));assert.ok(!points.some(p=>p.x===20&&p.y===19));assert.ok(!points.some(p=>p.x===23&&p.y===20));assert.ok(points.length<=113);
});

test('actual flood tiles close ingress without trapping an occupant and restart preserves geometry and progress',()=>{
 const {w,s}=fixture(),d=disaster(w,'flashFlood',{x:20,y:20},[{x:19,y:20},{x:20,y:20},{x:21,y:20}]);d.phase='active';
 assert.equal(walkable(w,{x:20,y:20}),false);assert.equal(findPath(w,{x:18,y:20},{x:20,y:20}),null);assert.ok(findPath(w,{x:20,y:20},{x:18,y:20}));assert.equal(walkable(w,{x:19,y:20},{x:20,y:20}),true);
 setWeatherHazardsEnabled(w,true);sample(w,10);const store=new WorldStore(':memory:');store.commit(w,null);const loaded=store.load()!;store.close();assert.deepEqual(loaded.frontierHazards!.weather,s.weather);assert.deepEqual(loaded.frontierHazards!.disasters,s.disasters);assert.equal(findPath(loaded,{x:18,y:20},{x:20,y:20}),null);
});

test('finite shelter protects existing occupants and rights; racing arrivals cannot invent capacity',()=>{
 const {w,r,other,third,b}=fixture(),d=disaster(w,'windstorm',{...b.door});r.at={...b.door};other.at={...b.door};third.at={...b.door};b.capacity=1;
 const a={type:'frontierHazard' as const,operation:'shelter' as const,dangerId:d.id,buildingId:b.id};assert.equal(frontierHazardTarget(w,r,a).error,undefined);assert.equal(frontierHazardTarget(w,other,a).error,undefined);
 const stock=JSON.stringify(r.inventory),home=r.homeId;assert.equal(completeFrontierHazard(w,r,a),null);assert.match(completeFrontierHazard(w,other,a)!,/遮蔽/);assert.equal(frontierShelterOccupants(w,b).size,1);assert.equal(r.homeId,home);assert.equal(JSON.stringify(r.inventory),stock);assert.equal(b.residents.length,0);
 r.inside=null;b.residents=[third.id];assert.equal(usableFrontierShelter(w,r,b,d.id),false);assert.equal(usableFrontierShelter(w,third,b,d.id),true);
});

test('shelter rejects another overlapping flood and does not leak distant capacity in the normal menu',()=>{
 const {w,r,b}=fixture(),d=disaster(w,'windstorm',{...r.at});b.capacity=8;assert.ok(frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'));
 disaster(w,'flashFlood',{...b.door},[{...b.door}]);assert.equal(usableFrontierShelter(w,r,b,d.id),false);
 w.frontierHazards!.disasters.pop();r.at={x:b.door.x+20,y:b.door.y};d.at={...r.at};assert.equal(frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'),false);
});

test('warning does not move a person; a voluntary reachable retreat and exposed injury have distinct factual records',()=>{
 const {w,r,other,b}=fixture();w.buildings=[];r.at={x:12,y:20};other.at={...r.at};const d=disaster(w,'windstorm',{...r.at});d.startsAt=w.minute+90;
 advanceFrontierHazards(w,1);assert.deepEqual(r.at,{x:12,y:20});assert.equal(r.plan,null);
 const choice=frontierHazardOpportunities(w,r).find(c=>c.action.type==='frontierHazard'&&c.action.operation==='retreat')!;assert.ok(choice);assert.equal(run(w,r,choice.action),null);assert.ok(!disasterContains(d,r.at));
 w.minute=d.startsAt;advanceFrontierHazards(w,1);const before=other.health;w.minute+=24;advanceFrontierHazards(w,24);assert.ok(other.health<before);assert.equal(r.health,100);
 assert.ok(w.events.some(e=>e.hazardFact?.disasterId===d.id&&e.hazardFact.phase==='retreat'&&e.actors.includes(r.id)));assert.ok(w.events.some(e=>e.hazardFact?.disasterId===d.id&&e.hazardFact.phase==='injury'&&e.actors.includes(other.id)));
 const after=other.health;advanceFrontierHazards(w,24);assert.equal(other.health,after);
});

test('flood damages only footprint springs and assets; duplicate advancement cannot repeat damage',()=>{
 const {w,s,spring}=fixture();const d=disaster(w,'flashFlood',{x:22,y:20},[{...spring.at},{x:20,y:20}]);
 w.infrastructure!.assets.push({id:'road',name:'旧路',projectId:'old',kind:'road',definition:'infrastructure/road@1',at:{x:20,y:20},width:1,height:1,access:{x:19,y:20},anchors:[{x:19,y:20}],tiles:[{at:{x:20,y:20},before:'grass',after:'road'}],graveIds:[],condition:30,lastDay:0,createdAt:0,retiredAt:null,cost:{wood:1,stone:2},minutes:20});w.map.tiles[20*40+20]='road';
 const amount=spring.amount;w.minute=d.startsAt;advanceFrontierHazards(w,1);assert.equal(spring.amount,amount);assert.equal(spring.floodDamage!.clearedAt,null);assert.equal(w.infrastructure!.assets[0].condition,0);assert.equal(w.map.tiles[20*40+20],'grass');
 const events=w.events.length;advanceFrontierHazards(w,1);assert.equal(w.events.length,events);assert.ok(w.events.some(e=>e.hazardFact?.targetId==='road'&&e.hazardFact.phase==='damage'&&e.hazardFact.after===0));assert.equal(s.weather!.enabled,false);
});

test('blocked safe-water routes cannot bypass damage; actual normal-menu spring clearing consumes labor and materials, never adds water',()=>{
 const {w,r,spring}=fixture(),d=disaster(w,'flashFlood',{...spring.at},[{...spring.at}]);r.at={x:20,y:20};w.minute=d.startsAt;advanceFrontierHazards(w,1);w.waterSupply!.vessels.push({id:'bucket',ownerId:r.id,buildingId:null,capacity:6,amount:0,quality:'safe',createdAt:w.minute});
 const fill={type:'waterSupply' as const,operation:'fillSpring' as const,receiptId:waterReceiptId(w,r),vesselId:'bucket',sourceId:spring.id,quantity:1};assert.match(waterSupplyReason(w,r,fill)!,/淤塞/);
 assert.match(run(w,r,{type:'gather',resourceId:spring.id,quantity:1})!,/淤塞/);assert.equal(r.inventory.water,7);
 assert.equal(frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='clearSpring'),false);
 w.minute=d.endsAt;advanceFrontierHazards(w,1);const choice=frontierHazardOpportunities(w,r).find(c=>c.action.type==='frontierHazard'&&c.action.operation==='clearSpring')!;assert.ok(choice);
 const at=w.minute,amount=spring.amount,wood=r.inventory.wood!,stone=r.inventory.stone!;assert.equal(run(w,r,choice.action),null);assert.ok(w.minute-at>=60);assert.equal(spring.amount,amount);assert.equal(r.inventory.wood,wood-1);assert.equal(r.inventory.stone,stone-2);assert.ok(spring.floodDamage!.clearedAt!>=at+60);
 const stocks=JSON.stringify(r.inventory);assert.match(completeFrontierHazard(w,r,choice.action as any)!,/已清理/);assert.equal(JSON.stringify(r.inventory),stocks);assert.equal(waterSupplyReason(w,r,fill),null);assert.ok(w.events.some(e=>e.hazardFact?.phase==='repair'&&e.hazardFact.targetId===spring.id&&e.hazardFact.disasterId===d.id));
});

test('changed flood damage and lost materials invalidate pending spring clearance without grants or refunds',()=>{
 const {w,r,spring}=fixture();r.at={x:20,y:20};spring.floodDamage={disasterId:'old',at:w.minute,clearedAt:null};const a={type:'frontierHazard' as const,operation:'clearSpring' as const,sourceId:spring.id,damageId:'old'};
 assert.equal(frontierHazardTarget(w,r,a).error,undefined);spring.floodDamage.disasterId='new';assert.match(completeFrontierHazard(w,r,a)!,/改变/);spring.floodDamage.disasterId='old';r.inventory.wood=0;assert.match(completeFrontierHazard(w,r,a)!,/1木2石/);assert.equal(spring.floodDamage.clearedAt,null);assert.equal(spring.amount,7);
});

test('a real U-shaped flood footprint cannot yield a path that exits and re-enters blocked water',()=>{
 const {w}=fixture();w.map={name:'U-shaped actual banks',width:13,height:10,tiles:Array(130).fill('grass'),entrance:{x:1,y:1}};w.buildings=[];w.resources=[];
 for(let y=1;y<=5;y++)for(const x of [2,8])w.map.tiles[y*13+x]='water';for(let x=2;x<=8;x++)w.map.tiles[5*13+x]='water';
 const d=disaster(w,'flashFlood',{x:5,y:5},floodFootprint(w,{x:5,y:5}));d.phase='active';const start={x:3,y:1},path=findPath(w,start,{x:10,y:1});
 if(path){let from=start;for(const to of path){assert.ok(walkable(w,to,from),JSON.stringify({from,to}));from=to;}}
});

test('the personal resource view exposes visible blockage but not unobserved flood identity or timestamp',()=>{
 const {w,r,spring}=fixture();r.at={x:20,y:20};spring.floodDamage={disasterId:'unseen-disaster-evidence',at:123,clearedAt:null};
 const c=decisionContext(w,r),view=c.resources.find(s=>s.id===spring.id)!;assert.equal(view.waterBlocked,true);assert.ok(!('floodDamage'in view));assert.ok(!JSON.stringify(view).includes('unseen-disaster'));assert.equal(decisionChoices(c).some(c=>c.action.type==='gather'&&c.action.resourceId===spring.id),false);
});

test('multi-interval exposure is applied once and a zero-time replay cannot spend leftover injury buckets',()=>{
 const {w,r}=fixture();w.buildings=[];r.at={x:12,y:20};const d=disaster(w,'windstorm',{...r.at});d.intensity=2;d.phase='active';d.startsAt=w.minute;d.lastSteppedAt=w.minute;
 w.minute+=72;const before=r.health;advanceFrontierHazards(w,72);assert.equal(r.health,before-6);assert.equal(d.exposure[r.id],0);advanceFrontierHazards(w,72);assert.equal(r.health,before-6);
});

test('resource delta persistence retains newly blocked, cleared and repeated flood damage without a quantity change',()=>{
 const {w,spring}=fixture(),store=new WorldStore(':memory:');store.commit(w,null);
 const amount=spring.amount,harvest=spring.lastHarvest;for(const damage of [{disasterId:'one',at:500,clearedAt:null},{disasterId:'one',at:500,clearedAt:700},{disasterId:'two',at:800,clearedAt:null}]){
  const revision=w.revision;spring.floodDamage=damage;w.revision++;store.commit(w,revision);const loaded=store.load()!;assert.deepEqual(loaded.resources[0].floodDamage,damage);assert.equal(loaded.resources[0].amount,amount);assert.equal(loaded.resources[0].lastHarvest,harvest);
 }store.close();
});

test('accepted future appointments and booked care reserve actual shelter capacity beyond the warning interval',()=>{
 const {w,r,other,b}=fixture(),d=disaster(w,'windstorm',{...b.door});b.capacity=1;
 stepWorld(w,.001);w.health!.appointments.push({id:'later',doctorId:r.id,patientId:other.id,buildingId:b.id,createdAt:w.minute,start:w.minute+121,end:w.minute+200,minutes:30,fee:0,account:'test',stock:{},status:'accepted',acceptedAt:w.minute,worked:0,paid:0,refunded:0,materialsUsed:false,lastAt:w.minute,reason:null});
 assert.equal(usableFrontierShelter(w,r,b,d.id),false);assert.equal(frontierShelterOccupants(w,b).has(other.id),true);w.health!.appointments=[];
 w.duties!.shifts=[{id:'booked-care',role:'care',buildingId:b.id,start:w.minute+200,end:w.minute+300,workerId:r.id,status:'booked',assignments:[],declinedBy:[],served:0,clientId:other.id}];
 assert.equal(usableFrontierShelter(w,r,b,d.id),false);w.duties!.shifts[0].status='finished';assert.equal(usableFrontierShelter(w,r,b,d.id),true);
});

test('a recorded building damage remains linked after old working events are evicted before repair',()=>{
 const {w,r,b}=fixture();r.at={...b.door};const d=disaster(w,'windstorm',{...b.door});w.minute=d.startsAt;advanceFrontierHazards(w,1);assert.equal(b.lastHazardDamage!.disasterId,d.id);
 const store=new WorldStore(':memory:');store.commit(w,null);const loaded=store.load()!;store.close();loaded.events=[];const person=loaded.residents.find(p=>p.id===r.id)!,building=loaded.buildings[0];
 assert.equal(completeFrontierHazard(loaded,person,{type:'frontierHazard',operation:'repair',buildingId:b.id}),null);assert.equal(building.condition,100);assert.ok(loaded.events.some(e=>e.hazardFact?.phase==='repair'&&e.hazardFact.disasterId===d.id));
});
