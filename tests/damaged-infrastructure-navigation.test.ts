import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Vec,World} from '../src/shared/types.js';
import type {InfrastructureAsset} from '../src/shared/infrastructure.js';
import {createWorld} from '../src/world/seed.js';
import {findPath,reachableTilesFrom,walkable} from '../src/world/navigation.js';
import {initializeInfrastructure,infrastructureFootprint} from '../src/world/infrastructure.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';

function fixture(){
 const w=createWorld(),r=w.residents[0];w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={width:26,height:10,tiles:Array(260).fill('cliff'),entrance:{x:2,y:4},name:'合成坏桥与岸边岔路'};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=[r];
 for(let x=2;x<=23;x++)w.map.tiles[4*26+x]=x>=3&&x<=20?'water':'grass';
 for(let x=3;x<=19;x++)w.map.tiles[5*26+x]='road';
 Object.assign(r,{at:{x:3,y:4},inside:null,roomAt:null,homeId:null,knownBuildings:[],knownResources:[],knownPeople:[],inventory:{},plan:null,activity:null,lastFailure:null,hunger:94,health:10,energy:100});
 initializeInfrastructure(w);
 // Use the actual supported straight-bridge footprint, not a made-up U shape.
 const footprint=infrastructureFootprint(w,{type:'construction',operation:'propose',scope:'public',kind:'bridge',at:{x:3,y:4},end:{x:20,y:4},name:'原直桥',wagePerHour:1})!;
 assert.ok(footprint);
 const asset:InfrastructureAsset={id:'straight-bridge',name:'原直桥',projectId:'synthetic',kind:'bridge',definition:footprint.definition,at:footprint.at,width:footprint.width,height:footprint.height,access:footprint.door,anchors:footprint.terrain.anchors,tiles:footprint.terrain.tiles,graveIds:[],condition:0,lastDay:0,createdAt:0,retiredAt:null,cost:footprint.cost,minutes:footprint.minutes};
 w.infrastructure!.assets.push(asset);for(const t of asset.tiles)w.map.tiles[t.at.y*26+t.at.x]=t.after;
 return {w,r,asset,target:{x:21,y:4}};
}
function assertExecutable(w:World,start:Vec,path:Vec[]|null){
 assert.ok(path);let from=start;for(const to of path){assert.equal(walkable(w,to,from),true,`illegal edge ${JSON.stringify({from,to})}`);from=to;}
}
function flood(w:World,at:Vec){
 w.frontierHazards={beasts:[],disasters:[{id:'blocking-flood',kind:'flashFlood',at,radius:1,phase:'active',warningAt:0,startsAt:0,endsAt:10000,intensity:10,warned:[],exposure:{},footprint:[at]}],shore:null,woodland:{x:1,y:1},nextDisasterAt:10000,nextSerial:1,foodPatches:[],nextBeastSerial:1,totals:{injuries:0,accidentalDeaths:0,damagedBuildings:0,damagedPlots:0,repairs:0,livestockAttacks:0,livestockKilled:0,wildlifeDeaths:0,hunted:0}};
}
function actualReachable(w:World,start:Vec){
 const seen=new Uint8Array(w.map.width*w.map.height),queue=[start];seen[start.y*w.map.width+start.x]=1;
 for(const from of queue)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
  const to={x:from.x+dx,y:from.y+dy},i=to.y*w.map.width+to.x;
  if(!walkable(w,to,from)||seen[i])continue;seen[i]=1;queue.push(to);
 }
 return seen;
}
function choose(w:World,r:Resident,predicate:(a:Action)=>boolean){
 const prepared=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),row=prepared.choices.find(c=>predicate(c.action));assert.ok(row,'action belongs to the final numbered menu');
 const selected=parseChoice(JSON.stringify({choice:row.id}),prepared.choices);
 assert.equal(submitPlan(w,{id:`bridge-food:${w.minute}:${r.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...selected}).ok,true);
}
function finish(w:World,r:Resident){let left=100;while(r.plan||r.activity){assert.ok(left--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}

test('road weighting cannot leave and reenter the damaged bridge occupied at the search start',()=>{
 const {w,r,target}=fixture(),before=structuredClone(w),path=findPath(w,r.at,target);
 assertExecutable(w,r.at,path);assert.equal(path!.length,18);assert.ok(path!.every(p=>p.y===4));
 assertExecutable(w,r.at,findPath(w,r.at,target,false,18));assert.equal(findPath(w,r.at,target,false,17),null);
 assert.deepEqual(w,before,'route queries remain read-only');
});

test('a flood across a damaged straight bridge cannot be bypassed by illegal reentry',()=>{
 const {w,r,target}=fixture();flood(w,{x:10,y:4});
 assert.equal(findPath(w,r.at,target),null);
 const before=structuredClone(w),reachable=reachableTilesFrom(w,r.at);
 assert.equal(reachable[target.y*w.map.width+target.x],0);
 assert.deepEqual(reachable,actualReachable(w,r.at),'connectivity matches the real per-edge rule');
 for(let x=2;x<=23;x++)assert.equal(findPath(w,r.at,{x,y:4})!==null,!!reachable[4*w.map.width+x]);
 assert.deepEqual(w,before);
});

test('normal, retired and non-bridge infrastructure keeps road shortcuts while outsiders cannot enter a damaged asset',()=>{
 for(const variant of ['healthy','retired','road'] as const){const {w,r,asset,target}=fixture();if(variant==='healthy')asset.condition=100;else if(variant==='retired')asset.retiredAt=0;else asset.kind='road';
  const path=findPath(w,r.at,target);assertExecutable(w,r.at,path);assert.ok(path!.some(p=>p.y===5),variant);
 }
 const {w,asset}=fixture();assert.equal(findPath(w,{x:19,y:5},{x:19,y:4}),null);
 asset.kind='dock';assert.equal(findPath(w,{x:19,y:5},{x:19,y:4}),null);
});

test('a numbered remembered-food visit exits the damaged bridge, reloads, gathers finite food and separately eats',()=>{
 const {w,r}=fixture(),berry={id:'known-food-bank',kind:'bush' as const,at:{x:22,y:4},amount:3,max:3,regrowthDays:0,lastHarvest:0};w.resources.push(berry);r.knownResources=[berry.id];
 choose(w,r,a=>a.type==='move'&&a.to.x===21&&a.to.y===4);stepWorld(w,5);assert.equal(r.lastFailure,null);assert.ok(r.activity?.path.length);assert.equal(r.at.y,4);assert.deepEqual(r.inventory,{});assert.equal(berry.amount,3);
 const store=new WorldStore(':memory:');store.commit(w,null);const copy=store.load()!;store.close();const actor=copy.residents[0];finish(copy,actor);
 assert.deepEqual(actor.at,{x:21,y:4});assert.deepEqual(actor.inventory,{});assert.equal(copy.resources[0].amount,3);
 choose(copy,actor,a=>a.type==='gather'&&a.resourceId===berry.id);finish(copy,actor);
 assert.equal(actor.inventory.berry,3);assert.equal(copy.resources[0].amount,0);assert.ok(actor.hunger>95,'arrival and gathering did not feed the person');
 const health=actor.health;choose(copy,actor,a=>a.type==='eat'&&a.item==='berry');finish(copy,actor);
 assert.equal(actor.inventory.berry,2);assert.ok(actor.hunger<95);assert.ok(actor.health>0);assert.ok(actor.health<=health,'no health or food was injected');
});

test('a later bridge failure still stops an underway outsider at the real boundary',()=>{
 const {w,r,asset}=fixture();asset.condition=100;r.at={x:18,y:5};
 assert.equal(submitPlan(w,{id:'before-damage',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人行走',actions:[{type:'move',to:{x:20,y:4}}]}).ok,true);
 stepWorld(w,1);assert.ok(r.activity);assert.equal(r.at.y,5);asset.condition=0;const actual={...r.at};stepWorld(w,1);
 assert.equal(r.activity,null);assert.deepEqual(r.at,actual);assert.match(r.lastFailure!,/原路线出现阻挡/);assert.deepEqual(r.inventory,{});
});
