import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Resident,World} from '../src/shared/types.js';
import type {IndustryAction,Livestock,Pasture} from '../src/shared/industry.js';
import {pastureFenceBlocks,pastureFenceRules} from '../src/shared/pasture-fence.js';
import {pastureEdgeChecker,pastureEdgeOpen} from '../src/shared/pasture-access.js';
import {createWorld} from '../src/world/seed.js';
import {initializeProduction} from '../src/world/production.js';
import {initializeIndustry,industryAssets,inheritIndustry} from '../src/world/industry.js';
import {advancePastureFence} from '../src/world/pasture-fences.js';
import {completePasture,pastureAdmissionError,pastureTarget,workPasture} from '../src/world/pasture-projects.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';

import {DAY,YEAR} from '../src/world/time.js';

function fixture(condition=60){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:48,height:40,tiles:Array(48*40).fill('grass'),entrance:{x:1,y:1}};
 w.resources=[];w.plots=[];w.graves=[];w.definitions['land/start@1'].data.parcels=[];
 const [owner,other]=w.residents,source=w.buildings.find(b=>b.ownerId===owner.id)!;
 const barn={...source,id:'fence-barn',name:'围栏测试畜舍',kind:'barn' as const,at:{x:4,y:4},width:6,height:4,door:{x:7,y:8},ownerId:owner.id,definition:'building/barn@1',residents:[]};w.buildings=[barn];
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={x:14,y:21};r.inside=null;r.roomAt=null;r.homeId=null;r.residency='resident';r.canDecide=r.canExpress=true;r.coins=200;r.inventory={wood:20,stone:10,meal:40,water:40};r.health=r.energy=100;r.hunger=0;r.knownBuildings=[barn.id];r.plan=null;r.activity=null;}
 initializeProduction(w);initializeIndustry(w);
 const p:Pasture={id:'fence-pasture',ownerId:owner.id,barnId:barn.id,tiles:Array.from({length:12},(_,i)=>({x:12+i%4,y:18+Math.floor(i/4)})),forage:18,capacity:48,lastMinute:w.minute,gate:{inside:{x:14,y:20},outside:{x:14,y:21}},fenced:true,status:'open',expiresAt:w.minute+14*DAY,fence:{condition,lastMinute:w.minute,woodUsed:0,repairs:0},trough:{at:{x:14,y:20},water:1,capacity:8,delivered:1,consumed:0}};
 w.industry!.pastures=[p];w.weather='sun';return {w,owner,other,barn,p};
}
const action=(p:Pasture,minutes=30):IndustryAction=>({type:'industry',operation:'repairFence',pastureId:p.id,minutes});
function start(w:World,r:Resident,a:IndustryAction){
 const plan={id:'fence-test:'+w.revision,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定修护围栏',actions:[a]};
 const result=submitPlan(w,plan);assert.equal(result.ok,true,JSON.stringify(result));
}
function run(w:World,r:Resident,a:IndustryAction){start(w,r,a);let guard=200;while(r.plan||r.activity){assert.ok(guard-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function menuAction(w:World,r:Resident){const menu=decisionChoices(decisionContext(w,r)),c=menu.find(c=>c.action.type==='industry'&&c.action.operation==='repairFence');assert.ok(c,'repair must be selectable through the ordinary resident menu');return parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as IndustryAction;}

test('fence wear is elapsed-time based, idempotent, rain-sensitive, and never spends resident goods',()=>{
 const {w,owner,p}=fixture(100),inventory=structuredClone(owner.inventory);
 w.minute+=DAY;advancePastureFence(w,p);assert.equal(p.fence!.condition,96);
 advancePastureFence(w,p);assert.equal(p.fence!.condition,96);
 w.weather='rain';w.minute+=DAY;advancePastureFence(w,p);assert.equal(p.fence!.condition,90);
 assert.deepEqual(owner.inventory,inventory);assert.equal(p.fence!.woodUsed,0);assert.equal(p.fence!.repair,undefined);
 const loaded=JSON.parse(JSON.stringify(w)) as World;loaded.minute+=DAY;advancePastureFence(loaded,loaded.industry!.pastures![0]);assert.equal(loaded.industry!.pastures![0].fence!.condition,84);
});

test('old snapshots never gain fences or retroactive damage and retired fences stop wearing',()=>{
 const {w,p}=fixture();delete p.fence;delete p.fenced;w.minute+=20*DAY;advancePastureFence(w,p);assert.equal(p.fence,undefined);assert.equal(pastureFenceBlocks(p),false);
 p.fenced=true;assert.equal(pastureFenceBlocks(p),true);advancePastureFence(w,p);assert.deepEqual(p.fence,{condition:100,lastMinute:w.minute,woodUsed:0,repairs:0});
 w.minute+=DAY;advancePastureFence(w,p);assert.equal((p as Pasture).fence!.condition,96);
 p.status='retired';w.minute+=DAY;advancePastureFence(w,p);assert.equal((p as Pasture).fence!.condition,96);assert.equal(pastureFenceBlocks(p),false);
});

test('broken perimeter stops new admissions without moving animals, changing grass or water, or closing the gate',()=>{
 const {w,p,owner,barn}=fixture(1),inside=p.tiles[0],outside={x:11,y:18};
 const n={id:'retained-goat',ownerId:owner.id,barnId:barn.id,pastureId:p.id,kind:'goat',status:'alive',inside:null,at:{...inside}} as Livestock;w.industry!.animals.push(n);
 assert.equal(pastureEdgeOpen(w,outside,inside),false);assert.equal(pastureEdgeChecker(w)(outside,inside),false);
 w.minute+=DAY;advancePastureFence(w,p);assert.equal(p.fence!.condition,0);assert.equal(pastureFenceBlocks(p),false);assert.match(pastureAdmissionError(w,p)!,/围栏已损坏/);
 assert.equal(pastureEdgeOpen(w,outside,inside),true);assert.equal(pastureEdgeChecker(w)(outside,inside),true);assert.equal(pastureEdgeOpen(w,p.gate!.inside,p.gate!.outside),true);
 assert.deepEqual(n.at,inside);assert.equal(n.pastureId,p.id);assert.equal(p.forage,18);assert.equal(p.trough!.water,1);
 assert.equal(w.events.filter(e=>e.text.includes('围栏因实际风雨磨损')).length,1);w.minute+=DAY;advancePastureFence(w,p);assert.equal(w.events.filter(e=>e.text.includes('围栏因实际风雨磨损')).length,1);
});

test('ordinary choices require two actual work sessions, spend only four wood and restore the original perimeter',()=>{
 const {w,owner,other,p}=fixture(0),stock=owner.inventory.wood!,otherBefore=structuredClone(other.inventory),expires=p.expiresAt;
 run(w,owner,menuAction(w,owner));assert.equal(p.fence!.repair!.worked,30);assert.equal(p.fence!.condition,0);assert.equal(owner.inventory.wood,stock-4);assert.equal(p.fence!.woodUsed,4);
 run(w,owner,menuAction(w,owner));assert.equal(p.fence!.repair,undefined);assert.equal(p.fence!.repairs,1);assert.ok(p.fence!.condition>39.9&&p.fence!.condition<=40);assert.equal(owner.inventory.wood,stock-4);
 assert.equal(pastureAdmissionError(w,p),null);assert.equal(pastureEdgeChecker(w)({x:11,y:18},p.tiles[0]),false);assert.equal(pastureEdgeOpen(w,p.gate!.outside,p.gate!.inside),true);
 assert.equal(p.expiresAt,expires);assert.deepEqual(other.inventory,otherBefore);assert.equal(other.plan,null);assert.equal(other.activity,null);
});

test('interrupted repair survives reload and resumes without paying again or healing unfinished work',()=>{
 const {w,owner,p}=fixture(),stock=owner.inventory.wood!;start(w,owner,action(p));stepWorld(w,10);
 assert.equal(p.fence!.repair!.worked,10);assert.equal(owner.inventory.wood,stock-4);assert.ok(p.fence!.condition<60);
 const loaded=JSON.parse(JSON.stringify(w)) as World,r=loaded.residents.find(r=>r.id===owner.id)!,q=loaded.industry!.pastures![0];r.plan=null;r.activity=null;r.inventory.wood=0;
 run(loaded,r,menuAction(loaded,r));assert.equal(q.fence!.repair!.worked,40);assert.equal(r.inventory.wood,0);assert.ok(q.fence!.condition<60);
 run(loaded,r,menuAction(loaded,r));assert.equal(q.fence!.repair,undefined);assert.equal(q.fence!.woodUsed,4);assert.equal(q.fence!.repairs,1);assert.ok(q.fence!.condition>99&&q.fence!.condition<=100);
});

test('an accepted repair reloads in flight and a repeated same-tick work hook cannot double its labour',()=>{
 const {w,owner,p}=fixture();start(w,owner,action(p));stepWorld(w,10);const a=owner.activity!.action as IndustryAction;
 assert.equal(workPasture(w,owner,a,10),null);assert.equal(p.fence!.repair!.worked,10);
 const loaded=JSON.parse(JSON.stringify(w)) as World,r=loaded.residents.find(r=>r.id===owner.id)!,q=loaded.industry!.pastures![0],stock=r.inventory.wood!;
 while(r.plan||r.activity)stepWorld(loaded,1);
 assert.equal(r.lastFailure,null);assert.equal(q.fence!.repair!.worked,30);assert.equal(r.inventory.wood,stock);
 run(loaded,r,menuAction(loaded,r));assert.equal(q.fence!.repairs,1);assert.equal(q.fence!.woodUsed,4);assert.equal(r.inventory.wood,stock);
});

test('repair checks owner, real location, materials, time, existing fence and actual accepted work',()=>{
 const {w,owner,other,p}=fixture(),a=action(p),stock=owner.inventory.wood!;
 assert.match(pastureTarget(w,other,a).error!,/责任人/);owner.inventory.wood=3;assert.match(pastureTarget(w,owner,a).error!,/4木材/);owner.inventory.wood=stock;
 assert.match(completePasture(w,owner,a)!,/实际开始/);assert.equal(p.fence!.condition,60);assert.equal(owner.inventory.wood,stock);
 owner.at={x:13,y:21};assert.match(completePasture(w,owner,a)!,/实际到达/);assert.match(workPasture(w,owner,a,10)!,/到场/);
 for(const minutes of [0,-1,NaN,Infinity,121])assert.match(pastureTarget(w,owner,action(p,minutes)).error!,/1–120/);
 p.fenced=false;assert.match(pastureTarget(w,owner,a).error!,/实际围栏/);p.fenced=true;p.status='retired';assert.match(pastureTarget(w,owner,a).error!,/尚存/);
});

test('a newly blocked route fails before any wood or labour can be spent',()=>{
 const {w,owner,p}=fixture();owner.at={x:10,y:21};const stock=owner.inventory.wood!;start(w,owner,action(p));stepWorld(w,1);
 const next=owner.activity!.path[0];assert.ok(next);w.map.tiles[next.y*w.map.width+next.x]='cliff';for(let i=0;i<12&&(owner.plan||owner.activity);i++)stepWorld(w,1);
 assert.match(owner.lastFailure??'',/阻挡/);assert.equal(owner.inventory.wood,stock);assert.equal(p.fence!.repair,undefined);assert.equal(p.fence!.woodUsed,0);
});

test('an expired field can conserve its existing fence without renewing land or reopening admissions',()=>{
 const {w,owner,p}=fixture(0);run(w,owner,action(p));p.status='expired';p.expiresAt=w.minute;const expires=p.expiresAt;
 run(w,owner,menuAction(w,owner));assert.equal(p.fence!.repairs,1);assert.equal(p.status,'expired');assert.equal(p.expiresAt,expires);assert.ok(pastureAdmissionError(w,p));assert.equal(pastureEdgeOpen(w,p.gate!.inside,p.gate!.outside),true);
});

test('unfinished physical repairs can be inherited without assigning labour or charging the new owner again',()=>{
 const {w,owner,other,p}=fixture();run(w,owner,action(p));const otherStock=other.inventory.wood!;
 owner.status='dead';inheritIndustry(w,owner.id,other.id,industryAssets(w,owner.id));assert.equal(p.ownerId,other.id);assert.equal(other.activity,null);assert.equal(other.plan,null);
 assert.ok(pastureTarget(w,owner,action(p)).error);run(w,other,menuAction(w,other));assert.equal(other.inventory.wood,otherStock);assert.equal(p.fence!.repairs,1);assert.equal(p.fence!.woodUsed,4);
});

test('a change of facility owner interrupts ongoing labour before any further progress or spending',()=>{
 const {w,owner,other,p}=fixture();start(w,owner,action(p));stepWorld(w,10);const stock=owner.inventory.wood!;
 p.ownerId=other.id;stepWorld(w,1);
 assert.match(owner.lastFailure??'',/责任人/);assert.equal(owner.activity,null);assert.equal(p.fence!.repair!.worked,10);assert.equal(owner.inventory.wood,stock);assert.equal(p.fence!.woodUsed,4);
 run(w,other,menuAction(w,other));assert.equal(p.fence!.repair!.worked,40);assert.equal(other.inventory.wood,20);
});

test('completed batch identity cannot be replayed and partial work stays in observable accounting',()=>{
 const {w,owner,p}=fixture();run(w,owner,action(p));const id=p.fence!.repair!.id;

 const stale={...action(p),fenceRepairId:id};run(w,owner,stale);p.fence!.condition=60;const stock=owner.inventory.wood!;
 assert.match(pastureTarget(w,owner,stale).error!,/批次已结束/);assert.equal(owner.inventory.wood,stock);assert.equal(p.fence!.repairs,1);
 owner.at={x:40,y:35};assert.ok(!decisionChoices(decisionContext(w,owner)).some(c=>c.action.type==='industry'&&c.action.operation==='repairFence'));
 assert.equal(pastureFenceRules.repairWood,4);
});
