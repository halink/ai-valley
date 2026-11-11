import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {disasterContains,type FrontierDisaster,type FrontierHazardAction} from '../src/shared/frontier-hazards.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {floodFootprint} from '../src/world/weather-hazards.js';
import {frontierHazardOpportunities} from '../src/server/frontier-hazard-opportunities.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {findPath,walkable} from '../src/world/navigation.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {YEAR} from '../src/world/time.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeInfrastructure} from '../src/world/infrastructure.js';

function fixture(){
 const w=createWorld(73);w.mode='formal';w.scenario='frontier';w.clock.paused=false;
 w.map={name:'真实近岸洪区隔离验收',width:13,height:13,tiles:Array(169).fill('grass'),entrance:{x:1,y:1},settlement:{x:4,y:6}};
 // Real connected water produces two shore tiles, then a safe tile still inside the old radius.
 for(let y=0;y<13;y++)w.map.tiles[y*13+6]='water';
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const p of w.residents){p.homeId=null;p.at={x:5,y:6};p.inside=null;p.roomAt=null;p.bornAt=w.minute-25*YEAR;p.residency='resident';p.health=p.energy=100;p.hunger=0;p.inventory={water:7,meal:8};p.knownBuildings=[];p.knownResources=[];p.activity=null;p.plan=null;}
 initializeFrontierHazards(w);const s=w.frontierHazards!;s.beasts=[];
 const d:FrontierDisaster={id:'real-bank-flood',kind:'flashFlood',at:{x:6,y:6},radius:7,phase:'active',warningAt:w.minute-90,startsAt:w.minute,endsAt:w.minute+300,intensity:8,warned:[],exposure:{},footprint:floodFootprint(w,{x:6,y:6})};s.disasters=[d];
 return {w,r:w.residents[0],d};
}
const retreats=(w:World,r:Resident)=>frontierHazardOpportunities(w,r).filter(c=>c.action.type==='frontierHazard'&&c.action.operation==='retreat');
function menuRetreat(w:World,r:Resident){const choices=decisionChoices(decisionContext(w,r)).filter(c=>c.action.type==='frontierHazard'&&c.action.operation==='retreat');assert.equal(choices.length,1,'the actual resident menu offers one reachable retreat');return choices[0].action as Extract<FrontierHazardAction,{operation:'retreat'}>;}
function submit(w:World,r:Resident,action:Action){assert.equal(submitPlan(w,{id:`retreat:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定步行撤到近岸安全处',actions:[action]}).ok,true);}
function finish(w:World,r:Resident){let guard=100;while(r.plan||r.activity){assert.ok(guard-->0);stepWorld(w,1);}}

test('the normal menu offers the real two-step flood exit and only a submitted choice moves the resident',()=>{
 const {w,r,d}=fixture(),start={...r.at},safe={x:3,y:6};
 assert.equal(disasterContains(d,start),true);assert.equal(disasterContains(d,safe),false);assert.deepEqual(findPath(w,start,safe,false,24),[{x:4,y:6},safe]);
 const initial=structuredClone(w);assert.equal(retreats(w,r).length,1);assert.deepEqual(w,initial,'the flood opportunity query is read-only');
 // Other normal-menu providers lazily register their definitions on first use.
 decisionContext(w,r);const before=structuredClone(w);const action=menuRetreat(w,r);
 assert.deepEqual(w,before,'reading the menu does not move residents, submit plans or enable weather');
 assert.deepEqual(action.to,safe);assert.equal(w.frontierHazards!.weather!.enabled,false);
 submit(w,r,action);assert.deepEqual(r.at,start);stepWorld(w,.25);assert.ok(r.activity);assert.deepEqual(r.at,start,'movement takes actual game time');
 finish(w,r);assert.equal(r.lastFailure,null);assert.deepEqual(r.at,safe);assert.ok(!disasterContains(d,r.at));
 assert.equal(w.events.filter(e=>e.hazardFact?.disasterId===d.id&&e.hazardFact.phase==='retreat'&&e.actors.includes(r.id)).length,1);assert.equal(w.frontierHazards!.weather!.enabled,false);
});

test('the two-step exit already executes through the real engine without any menu override',()=>{
 const {w,r,d}=fixture();submit(w,r,{type:'frontierHazard',operation:'retreat',dangerId:d.id,to:{x:3,y:6}});finish(w,r);assert.equal(r.lastFailure,null);assert.deepEqual(r.at,{x:3,y:6});
});

test('a newly blocked route stops a selected retreat without a completion event, then the normal menu can be reconsidered',()=>{
 const {w,r}=fixture(),action=menuRetreat(w,r),start={...r.at};submit(w,r,action);stepWorld(w,.25);assert.ok(r.activity?.path.length);
 const next={...r.activity!.path[0]};w.resources.push({id:'fallen-tree',kind:'tree',at:next,amount:1,max:1,regrowthDays:0,lastHarvest:w.minute});
 stepWorld(w,1);assert.match(r.lastFailure!,/阻挡/);assert.deepEqual(r.at,start);assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(w.events.some(e=>e.hazardFact?.phase==='retreat'),false);
 assert.ok(retreats(w,r).length<=1);w.resources=[];const retry=menuRetreat(w,r);submit(w,r,retry);finish(w,r);assert.equal(r.lastFailure,null);
});

test('a destination newly covered by another flood is rechecked at completion rather than credited as safe',()=>{
 const {w,r,d}=fixture(),action=menuRetreat(w,r);submit(w,r,action);
 let guard=30;while(!r.activity||r.activity.path.length){assert.ok(guard-->0);stepWorld(w,1);}assert.deepEqual(r.at,action.to);
 w.frontierHazards!.disasters.push({...d,id:'later-warning',phase:'warning',startsAt:w.minute+100,at:{...action.to},footprint:[{...action.to}],warned:[r.id],exposure:{}});
 finish(w,r);assert.match(r.lastFailure!,/撤离目的地/);assert.equal(w.events.some(e=>e.hazardFact?.phase==='retreat'),false);
});

test('the flood menu stays empty when real terrain traps the resident despite nearby dry tiles',()=>{
 const {w,r}=fixture();for(const at of [{x:4,y:6},{x:5,y:5},{x:5,y:7}])w.map.tiles[at.y*w.map.width+at.x]='cliff';
 assert.equal(findPath(w,r.at,{x:3,y:6}),null);assert.deepEqual(retreats(w,r),[]);
});

test('overlapping actual floods and warnings cannot be chosen as dry destinations',()=>{
 for(const phase of ['active','warning'] as const){const {w,r,d}=fixture();w.frontierHazards!.disasters.push({...d,id:'overlap',phase,startsAt:phase==='warning'?w.minute+100:w.minute,at:{x:3,y:6},footprint:[{x:3,y:6}],warned:[],exposure:{}});
  const action=menuRetreat(w,r);assert.ok(w.frontierHazards!.disasters.every(d=>!disasterContains(d,action.to)));const path=findPath(w,r.at,action.to,false,24)!;assert.ok(path);
  let from=r.at;for(const to of path){assert.equal(walkable(w,to,from),true);from=to;}submit(w,r,action);finish(w,r);assert.equal(r.lastFailure,null);
 }
});

test('a flood retreat respects a real pasture gate and cannot cross the fence after that gate is blocked',()=>{
 const {w,r}=fixture();initializeIndustry(w);
 const tiles=Array.from({length:9},(_,i)=>({x:4+i%3,y:5+Math.floor(i/3)}));
 w.industry!.pastures=[{id:'fenced-bank',barnId:'old-barn',tiles,forage:10,capacity:10,lastMinute:w.minute,fenced:true,gate:{inside:{x:5,y:7},outside:{x:5,y:8}}}];
 const action=menuRetreat(w,r),path=findPath(w,r.at,action.to,false,24)!;assert.ok(path);assert.ok(path.some(p=>p.x===5&&p.y===8));
 w.resources.push({id:'blocked-gate',kind:'tree',at:{x:5,y:8},amount:1,max:1,regrowthDays:0,lastHarvest:w.minute});assert.deepEqual(retreats(w,r),[]);
});

test('an unusable bridge blocks a menu route; repairing its existing condition restores the ordinary two-step option',()=>{
 const {w,r}=fixture();initializeInfrastructure(w);w.map.tiles.fill('cliff');for(let x=1;x<=5;x++)w.map.tiles[6*13+x]='grass';w.map.tiles[6*13+4]='bridge';
 const at={x:4,y:6};w.infrastructure!.assets=[{id:'bank-bridge',name:'已有岸桥',projectId:'old',kind:'bridge',definition:'bridge-test',at,width:1,height:1,access:{x:3,y:6},anchors:[{x:3,y:6},{x:5,y:6}],tiles:[{at,before:'water',after:'bridge'}],graveIds:[],condition:0,lastDay:0,createdAt:0,retiredAt:null,cost:{},minutes:0}];
 assert.deepEqual(retreats(w,r),[]);w.infrastructure!.assets[0].condition=100;assert.deepEqual(menuRetreat(w,r).to,{x:3,y:6});
});

test('one flood menu search is bounded to 24 walking steps even on a large fully affected map',()=>{
 const {w,r,d}=fixture();w.map={name:'有界菜单成本',width:65,height:65,tiles:Array(4225).fill('grass'),entrance:{x:1,y:1}};r.at={x:32,y:32};d.at={...r.at};d.radius=64;
 d.footprint=Array.from({length:4225},(_,i)=>({x:i%65,y:Math.floor(i/65)}));
 let inspected=0;w.map.tiles=new Proxy(w.map.tiles,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))inspected++;return Reflect.get(target,key,receiver);}});
 assert.deepEqual(retreats(w,r),[]);assert.ok(inspected>1000,'the test exercises a full search, not an early exit');assert.ok(inspected<=4804,`${inspected} tile inspections exceed the 1,201-cell / four-edge bound`);
});

test('declining an offered retreat does not schedule evacuation, and ineligible residents receive no option',()=>{
 const {w,r}=fixture(),start={...r.at};menuRetreat(w,r);submit(w,r,{type:'wait',minutes:5});finish(w,r);assert.deepEqual(r.at,start);assert.equal(w.events.some(e=>e.hazardFact?.phase==='retreat'),false);
 for(const change of [{canDecide:false},{canExpress:false},{residency:'outside' as const},{status:'dead' as const}]){const person={...r,...change};assert.deepEqual(retreats(w,person),[]);}
 r.inside='existing-interior';assert.deepEqual(retreats(w,r),[]);assert.equal(w.frontierHazards!.weather!.enabled,false);
});

test('a nearby dry endpoint is not offered when its only route enters a separate storm',()=>{
 const {w,r,d}=fixture();w.map={name:'洪区外风暴阻断',width:16,height:13,tiles:Array(208).fill('cliff'),entrance:{x:0,y:6}};
 for(let x=0;x<=10;x++)w.map.tiles[6*16+x]='grass';w.map.tiles[6*16+11]='water';r.at={x:10,y:6};d.at={x:11,y:6};d.footprint=floodFootprint(w,d.at);
 const storm:FrontierDisaster={...d,id:'separate-storm',kind:'windstorm',at:{x:8,y:6},radius:1,footprint:undefined,warned:[],exposure:{}};w.frontierHazards!.disasters.push(storm);
 assert.equal(disasterContains(storm,r.at),false);assert.ok(findPath(w,r.at,{x:4,y:6})!.some(p=>disasterContains(storm,p)));assert.deepEqual(retreats(w,r),[]);
});

test('the engine follows the same safe edges as the menu when leaving a U-shaped broken bridge inside a real flood',()=>{
 const {w,r,d}=fixture();initializeInfrastructure(w);w.map={name:'破桥洪区逐边撤离',width:8,height:9,tiles:Array(72).fill('cliff'),entrance:{x:5,y:5}};
 for(let x=2;x<=4;x++)w.map.tiles[7*8+x]='water';
 const bridge=[{x:2,y:5},{x:2,y:6},{x:3,y:6},{x:4,y:6},{x:4,y:5}];for(const at of bridge)w.map.tiles[at.y*8+at.x]='bridge';for(const at of [{x:3,y:5},{x:5,y:5}])w.map.tiles[at.y*8+at.x]='grass';
 w.infrastructure!.assets=[{id:'broken-u',name:'已有坏桥',projectId:'old',kind:'bridge',definition:'bridge-test',at:bridge[0],width:3,height:2,access:{x:5,y:5},anchors:[{x:5,y:5}],tiles:bridge.map(at=>({at,before:'water',after:'bridge'})),graveIds:[],condition:0,lastDay:0,createdAt:0,retiredAt:null,cost:{},minutes:0}];
 r.at={x:2,y:5};d.at={x:3,y:7};d.footprint=floodFootprint(w,d.at);assert.ok(disasterContains(d,r.at));
 const action=menuRetreat(w,r);assert.deepEqual(action.to,{x:5,y:5});submit(w,r,action);stepWorld(w,.25);
 assert.deepEqual(r.activity!.path,[{x:2,y:6},{x:3,y:6},{x:4,y:6},{x:4,y:5},{x:5,y:5}]);finish(w,r);assert.equal(r.lastFailure,null);assert.deepEqual(r.at,action.to);
});

test('a new flood warning across an already selected route stops the resident before entering it',()=>{
 const {w,r,d}=fixture(),action=menuRetreat(w,r),start={...r.at};submit(w,r,action);stepWorld(w,.25);
 const next={...r.activity!.path[0]};w.frontierHazards!.disasters.push({...d,id:'new-path-warning',phase:'warning',startsAt:w.minute+90,at:next,footprint:[next],warned:[],exposure:{}});
 stepWorld(w,1);assert.match(r.lastFailure!,/阻挡/);assert.deepEqual(r.at,start);assert.equal(w.events.some(e=>e.hazardFact?.phase==='retreat'),false);
});

test('the retreat search admits a 24-step recorded-flood exit but does not expand to a 25-step exit',()=>{
 for(const steps of [24,25]){const {w,r,d}=fixture();w.map={name:'实际步数上限',width:28,height:3,tiles:Array(84).fill('cliff'),entrance:{x:0,y:1}};
  for(let x=0;x<=steps;x++)w.map.tiles[28+x]='grass';r.at={x:steps,y:1};d.at={...r.at};d.radius=30;d.footprint=Array.from({length:steps},(_,i)=>({x:i+1,y:1}));
  assert.equal(findPath(w,r.at,{x:0,y:1})!.length,steps);const choices=retreats(w,r);assert.equal(choices.length,steps===24?1:0);if(steps===24)assert.deepEqual((choices[0].action as Extract<FrontierHazardAction,{operation:'retreat'}>).to,{x:0,y:1});
 }
});
