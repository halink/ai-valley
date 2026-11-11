import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {initializeFrontierHazards,seenFrontierDangers,frontierRetreatStepAllowed} from '../src/world/frontier-hazards.js';
import {createWildBeast} from '../src/world/frontier-wildlife.js';
import {frontierHazardOpportunities} from '../src/server/frontier-hazard-opportunities.js';
import {findPath,distance} from '../src/world/navigation.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(73);w.mode='formal';w.scenario='frontier';w.clock.paused=false;
 const r=w.residents[0],b={...w.buildings[0],id:'review-roof',name:'审查共屋',ownerId:'commons',residents:[],capacity:8,condition:100,at:{x:17,y:8},door:{x:17,y:9},width:1,height:1};
 w.map={name:'独立避险审查',width:27,height:21,tiles:Array(567).fill('grass'),entrance:{x:1,y:1},settlement:{x:9,y:9}};
 w.buildings=[b];w.resources=[];w.plots=[];w.graves=[];w.residents=[r];
 Object.assign(r,{at:{x:9,y:9},inside:null,roomAt:null,homeId:null,knownBuildings:[b.id],knownResources:[],activity:null,plan:null,bornAt:w.minute-25*YEAR,health:100,energy:100,hunger:0,inventory:{water:20,meal:20},residency:'resident'});
 initializeFrontierHazards(w);const state=w.frontierHazards!;state.disasters=[];state.nextDisasterAt=w.minute+100000;
 const boar=createWildBeast(w,'boar','review-boar',{x:13,y:9});boar.nextMoveAt=w.minute+100000;boar.cooldownUntil=w.minute+100000;state.beasts=[boar];
 const action={type:'frontierHazard' as const,operation:'shelter' as const,dangerId:boar.id,buildingId:b.id};
 const submit=()=>assert.equal(submitPlan(w,{id:`review:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择共屋',actions:[action]}).ok,true);
 return {w,r,b,boar,action,submit};
}

for(const dt of [.25,1.2])test(`independent review: safe edges reach the same roof at ${dt}-minute ticks`,()=>{
 const {w,r,b,boar,submit}=fixture();const health=r.health;
 assert.equal(findPath(w,r.at,b.door)!.length,8);assert.equal(findPath(w,r.at,b.door,false,48,frontierRetreatStepAllowed(w,r))!.length,16);
 assert.ok(frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'));
 submit();let n=120;while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,dt);assert.ok(distance(r.at,boar.at)>3);}
 assert.equal(r.lastFailure,null);assert.equal(r.inside,b.id);assert.deepEqual(r.at,b.door);assert.equal(r.health,health);
});

test('independent review: SQLite legacy unsafe route is rejected before its first dangerous edge',()=>{
 const {w,r,b,submit}=fixture();submit();stepWorld(w,.25);assert.ok(r.activity);
 r.activity.path=findPath(w,r.at,b.door)!;r.activity.travelProgress=.9;
 const store=new WorldStore(':memory:');try{store.commit(w,null);const restored=store.load()!,person=restored.residents[0];stepWorld(restored,1.2);
  assert.deepEqual(person.at,{x:9,y:9});assert.match(person.lastFailure!,/原路线出现阻挡/);assert.equal(person.inside,null);assert.equal(person.activity,null);
 }finally{store.close();}
});

for(const mutation of ['condition','permission','capacity'] as const)test(`independent review: ${mutation} changes at arrival invalidate entry`,()=>{
 const {w,r,b,submit}=fixture();submit();let n=120;while(!r.activity||r.activity.path.length){assert.ok(n-->0);stepWorld(w,.25);}
 assert.deepEqual(r.at,b.door);assert.equal(r.inside,null);
 if(mutation==='condition')b.condition=34;else if(mutation==='permission')b.ownerId='other-owner';else b.capacity=0;
 while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,.25);}
 assert.equal(r.inside,null);assert.match(r.lastFailure!,/当前没有可进入的安全遮蔽处/);
});

test('independent review: newly visible beast blocks a saved route without choosing another roof',()=>{
 const {w,r,boar,submit}=fixture();boar.at={x:9,y:15};submit();stepWorld(w,.25);const next={...r.activity!.path[0]};
 boar.at={x:next.x+3,y:next.y};assert.ok(seenFrontierDangers(w,r).some(d=>d.id===boar.id));stepWorld(w,1.2);
 assert.deepEqual(r.at,{x:9,y:9});assert.match(r.lastFailure!,/原路线出现阻挡/);assert.equal(r.inside,null);
});

test('independent review: unseen wildlife cannot affect planning, but is checked after actual approach',()=>{
 const {w,r,b,boar,submit}=fixture();boar.at={x:20,y:9};assert.equal(seenFrontierDangers(w,r).length,0);
 submit();stepWorld(w,.25);assert.deepEqual(r.activity!.path,findPath(w,r.at,b.door),'an unseen beast must not alter the initial path');
 let n=80;while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,.25);}
 assert.equal(r.inside,null);assert.equal(r.at.x,16);assert.match(r.lastFailure!,/原路线出现阻挡/);assert.ok(distance(r.at,boar.at)>3);
});

test('independent review: stale shelter response with no safe route fails instead of walking through danger',()=>{
 const {w,r,b,submit}=fixture();assert.ok(frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'));
 w.map.tiles.fill('cliff');for(let x=9;x<=17;x++)w.map.tiles[9*w.map.width+x]='grass';
 assert.ok(findPath(w,r.at,b.door));assert.equal(findPath(w,r.at,b.door,false,48,frontierRetreatStepAllowed(w,r)),null);
 assert.equal(frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='shelter'),false);
 submit();stepWorld(w,.25);assert.deepEqual(r.at,{x:9,y:9});assert.equal(r.inside,null);assert.match(r.lastFailure!,/目标目前没有可达路线/);
});

test('independent review: starting inside a known danger still permits walking out to the selected roof',()=>{
 const {w,r,b,boar,submit}=fixture();r.at={x:13,y:9};const canStep=frontierRetreatStepAllowed(w,r);submit();stepWorld(w,.25);
 assert.ok(r.activity);let from={...r.at};for(const to of r.activity.path){assert.equal(canStep(from,to),true);from=to;}
 let n=80;while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,.25);}
 assert.equal(r.lastFailure,null);assert.equal(r.inside,b.id);assert.ok(distance(r.at,boar.at)>3);
});

test('independent review: a new storm warning across the selected safe route stops before entry',()=>{
 const {w,r,submit}=fixture();submit();stepWorld(w,.25);const next={...r.activity!.path[0]},start={...r.at};
 w.frontierHazards!.disasters.push({id:'review-new-storm',kind:'windstorm',at:next,radius:0,phase:'warning',warningAt:w.minute,startsAt:w.minute+500,endsAt:w.minute+1000,intensity:1,warned:[],exposure:{}});
 stepWorld(w,1.2);assert.deepEqual(r.at,start);assert.equal(r.inside,null);assert.match(r.lastFailure!,/原路线出现阻挡/);
});
