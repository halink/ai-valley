import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {WaterSupplyAction,WaterVessel} from '../src/shared/water-supply.js';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {waterSupplyOpportunities} from '../src/server/water-supply-opportunities.js';
import {roomLayout,roomPath} from '../src/shared/rooms.js';
import {initializeCivic} from '../src/world/civic.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {distance,findPath} from '../src/world/navigation.js';
import {initializeRooms} from '../src/world/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {YEAR} from '../src/world/time.js';
import {completeWaterSupply,initializeWaterSupply,waterDrunkToday,waterReceiptId,waterSupplyReason} from '../src/world/water-supply.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:32,tiles:Array(40*32).fill('grass'),entrance:{x:0,y:12}};w.resources=[];w.plots=[];w.graves=[];
 const hall=w.buildings.find(b=>b.kind==='lodge')!;hall.at={x:16,y:6};hall.width=8;hall.height=6;hall.door={x:20,y:12};hall.residents=[];w.buildings=[hall];
 for(const r of w.residents){r.at={x:12,y:12};r.inside=null;r.roomAt=null;r.homeId=null;r.parents=[];r.guardianIds=[];r.inventory={};r.bornAt=w.minute-30*YEAR;r.health=r.energy=100;r.hunger=0;r.knownBuildings=[hall.id];r.knownResources=[];r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.activity=null;r.plan=null;}
 initializeCivic(w);initializeRooms(w);initializeWaterSupply(w);
 const [guardian,child,other]=w.residents;child.bornAt=w.minute-3*YEAR;child.guardianIds=[guardian.id];child.canDecide=false;child.at={x:14,y:12};
 const vessel:WaterVessel={id:'child-water-bucket',ownerId:guardian.id,buildingId:null,capacity:6,amount:3,quality:'safe',createdAt:w.minute};w.waterSupply!.vessels.push(vessel);
 return {w,guardian,child,other,hall,vessel};
}
type Fixture=ReturnType<typeof fixture>;
const serves=(a:Action)=>a.type==='waterSupply'&&a.operation==='serveChild';
const service=({w,guardian,child,vessel}:Fixture):WaterSupplyAction=>({type:'waterSupply',operation:'serveChild',receiptId:waterReceiptId(w,guardian),vesselId:vessel.id,targetId:child.id});
function selected(f:Fixture){
 // The ordinary bounded overview rotates supply choices every 30 minutes.
 const slots=waterSupplyOpportunities(f.w,f.guardian).length;
 for(let i=0;i<=slots;i++){
  const menu=decisionChoices(decisionContext(f.w,f.guardian)),choice=menu.find(c=>serves(c.action));
  if(choice)return parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];
  f.w.minute+=30;
 }
 assert.fail('real resident menu offers reachable child service');
}
function plan(f:Fixture,a:Action){const {w,guardian}=f;return {id:`child-water:${w.revision}:${w.minute}`,actorId:guardian.id,actorRevision:guardian.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择在场帮助幼儿饮水',actions:[a]};}
function queue(f:Fixture,a:Action){assert.equal(submitPlan(f.w,plan(f,a)).ok,true);}
function finish({w,guardian}:Fixture){let ticks=30;while(guardian.plan||guardian.activity){assert.ok(ticks--,'service finishes or fails');stepWorld(w,1);}}
function unchanged(f:Fixture){assert.equal(f.vessel.amount,3);assert.equal(waterDrunkToday(f.w,f.child.id),0);assert.equal(f.w.waterSupply!.receipts.length,0);assert.equal(f.w.events.filter(e=>e.waterSupply).length,0);}
function noMenu(f:Fixture){assert.ok(!waterSupplyOpportunities(f.w,f.guardian).some(c=>serves(c.action)));assert.ok(!decisionContext(f.w,f.guardian).formal!.opportunities.some(c=>serves(c.action)));assert.ok(!decisionChoices(decisionContext(f.w,f.guardian)).some(c=>serves(c.action)));}
function barrier(f:Fixture){for(let y=0;y<f.w.map.height;y++)f.w.map.tiles[y*f.w.map.width+13]='cliff';}
function indoors(f:Fixture,p:Resident,at={x:6,y:9}){p.at={...f.hall.door};p.inside=f.hall.id;p.roomAt={...at};}

test('child service menus reject a two-tile cliff separation and a reachable but longer detour',()=>{
 for(const blocked of [true,false]){
  const f=fixture();if(blocked)barrier(f);else f.w.map.tiles[12*f.w.map.width+13]='cliff';
  assert.equal(distance(f.guardian.at,f.child.at),2);
  const path=findPath(f.w,f.guardian.at,f.child.at);if(blocked)assert.equal(path,null);else assert.equal(path!.length,4);
  noMenu(f);assert.match(waterSupplyReason(f.w,f.guardian,service(f))!,/位置/);unchanged(f);
 }
});

test('a stale real menu choice cannot start or complete child service across a new cliff',()=>{
 const f=fixture(),a=selected(f);barrier(f);const p=plan(f,a),before=structuredClone(f.w);
 assert.match(planStartError(f.w,p)!,/位置/);assert.deepEqual(f.w,before,'start preview is read-only');
 queue(f,a);finish(f);assert.match(f.guardian.lastFailure!,/位置/);unchanged(f);
 assert.match(completeWaterSupply(f.w,f.guardian,a as WaterSupplyAction)!,/位置/);unchanged(f);
});

test('child service rechecks terrain during work and immediately before completion without consuming water',()=>{
 for(const timing of ['work','completion'] as const){
  const f=fixture(),a=selected(f);queue(f,a);stepWorld(f.w,1);assert.ok(f.guardian.activity);assert.equal(f.guardian.activity.path.length,0);
  // Coordinates stay close, and an unbounded four-step detour remains possible.
  f.w.map.tiles[12*f.w.map.width+13]='cliff';assert.equal(findPath(f.w,f.guardian.at,f.child.at)!.length,4);noMenu(f);
  if(timing==='completion'){assert.match(completeWaterSupply(f.w,f.guardian,a as WaterSupplyAction)!,/位置/);unchanged(f);}
  finish(f);assert.match(f.guardian.lastFailure!,/位置/);unchanged(f);
  // Opening the original route permits a new decision; failure did not spend a receipt or water.
  f.w.map.tiles[12*f.w.map.width+13]='grass';queue(f,selected(f));finish(f);assert.equal(f.guardian.lastFailure,null);assert.equal(f.vessel.amount,2);assert.equal(waterDrunkToday(f.w,f.child.id),1);
 }
});

test('normal same-tile, adjacent, two-step, diagonal and indoor child service still uses real menu and five-minute work',()=>{
 for(const place of ['same','adjacent','two-step','diagonal','indoors'] as const){
  const f=fixture();
  if(place==='same')f.child.at={...f.guardian.at};
  if(place==='adjacent')f.child.at={x:13,y:12};
  if(place==='diagonal'){f.child.at={x:13,y:13};f.w.map.tiles[12*f.w.map.width+13]='cliff';assert.equal(findPath(f.w,f.guardian.at,f.child.at,false,2)!.length,2);}
  if(place==='indoors'){indoors(f,f.guardian);indoors(f,f.child,{x:8,y:9});}
  const a=selected(f),before={minute:f.w.minute,health:f.child.health,guardian:structuredClone({at:f.guardian.at,inside:f.guardian.inside,roomAt:f.guardian.roomAt}),child:structuredClone({at:f.child.at,inside:f.child.inside,roomAt:f.child.roomAt})};
  queue(f,a);stepWorld(f.w,1);unchanged(f);finish(f);
  assert.equal(f.guardian.lastFailure,null,place);assert.equal(f.w.minute-before.minute,5);assert.equal(f.vessel.amount,2);assert.equal(waterDrunkToday(f.w,f.child.id),1);assert.equal(f.child.health,before.health);
  assert.deepEqual({at:f.guardian.at,inside:f.guardian.inside,roomAt:f.guardian.roomAt},before.guardian);assert.deepEqual({at:f.child.at,inside:f.child.inside,roomAt:f.child.roomAt},before.child);
  assert.equal(f.w.waterSupply!.receipts.length,1);assert.equal(f.w.events.filter(e=>e.waterSupply).length,1);
 }
});

test('blocked standing tiles and a third walking step never count as close child service',()=>{
 for(const problem of ['guardian','child','same-blocked','third-step'] as const){
  const f=fixture();
  if(problem==='third-step')f.child.at={x:15,y:12};
  else {if(problem==='same-blocked')f.child.at={...f.guardian.at};const at=problem==='child'?f.child.at:f.guardian.at;f.w.map.tiles[at.y*f.w.map.width+at.x]='cliff';}
  noMenu(f);assert.match(completeWaterSupply(f.w,f.guardian,service(f))!,/位置/);unchanged(f);
 }
});

test('indoor child service requires both actual coordinates, both room rights and an unblocked short route',()=>{
 for(const problem of ['guardian-coordinate','child-coordinate','guardian-right','child-right','obstacle','damaged','doorway'] as const){
  const f=fixture();indoors(f,f.guardian);indoors(f,f.child,{x:8,y:9});
  if(problem==='guardian-coordinate')f.guardian.roomAt=null;
  if(problem==='child-coordinate')f.child.roomAt=null;
  if(problem==='guardian-right'){f.hall.ownerId=f.child.id;f.hall.residents=[];}
  if(problem==='child-right'){f.hall.ownerId=f.guardian.id;f.hall.residents=[];}
  if(problem==='damaged')f.hall.condition=0;
  if(problem==='doorway'){f.child.inside=null;f.child.roomAt=null;}
  if(problem==='obstacle'){
   f.other.status='dead';indoors(f,f.other,{x:7,y:9});f.other.body={reservedBy:null,carriedBy:null,storedAt:f.hall.id};
   assert.equal(distance(f.guardian.roomAt!,f.child.roomAt!),2);assert.equal(roomPath(roomLayout(f.w,f.hall),f.guardian.roomAt!,f.child.roomAt!)!.length,4);
  }
  noMenu(f);assert.match(completeWaterSupply(f.w,f.guardian,service(f))!,/位置/);unchanged(f);
 }
});

test('a new indoor obstruction stops previously selected child service without moving either person',()=>{
 const f=fixture();indoors(f,f.guardian);indoors(f,f.child,{x:8,y:9});const a=selected(f);queue(f,a);stepWorld(f.w,1);
 f.other.status='dead';indoors(f,f.other,{x:7,y:9});f.other.body={reservedBy:null,carriedBy:null,storedAt:f.hall.id};
 finish(f);assert.match(f.guardian.lastFailure!,/位置/);unchanged(f);assert.deepEqual(f.guardian.roomAt,{x:6,y:9});assert.deepEqual(f.child.roomAt,{x:8,y:9});
});
