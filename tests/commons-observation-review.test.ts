import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action} from '../src/shared/types.js';
import {roomLayout} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeCommons,commonsTarget,commonsReceiptId,commonsFoodOptions} from '../src/world/commons.js';
import {initializeFood} from '../src/world/food.js';
import {initializeRooms} from '../src/world/rooms.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {DAY,YEAR} from '../src/world/time.js';
import {commonsOpportunities} from '../src/server/commons-opportunities.js';
// Synthetic geometry reproduces the audited seed-5401 four-tile sight leak.
// No runtime saves, models, network or automatic resident decisions are used.
function fixture(stock=3,reserveStock=0){
 const w=createWorld(5401);w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};
 w.resources=[];w.plots=[];w.graves=[];w.events=[];w.estates=[];
 const b=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 Object.assign(b,{at:{x:12,y:6},width:4,height:4,door:{x:14,y:10},residents:[],capacity:2});w.buildings=[b];
 w.residents=w.residents.slice(0,2);const [r,other]=w.residents;
 for(const p of w.residents)Object.assign(p,{at:{...b.door},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-10*YEAR,health:100,energy:100,hunger:30,knownBuildings:[b.id],knownPeople:[],knownResources:[],memories:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,lastFailure:null});
 other.at={x:25,y:20};
 initializeCivic(w);initializeRooms(w);initializeCommons(w);
 w.civic!.stores={[b.id]:{turnip:stock}};w.civic!.budgets=[];w.civic!.proposals=[];
 w.civic!.reserves=[{id:'observation-reserve',proposalId:'old-public-notice',buildingId:b.id,item:'turnip',quantityLimit:20,unitPrice:0,dailyNutrition:40,startsAt:0,expiresAt:w.minute+2*DAY,status:'active',supplyAccount:'reserve-observation',suppliesLimit:0,spent:0,refunded:0,inventory:{turnip:reserveStock},stocked:reserveStock,purchased:0,opened:reserveStock,withdrawn:0,receipts:[]}];
 w.economy!.treasuryStock={turnip:stock+reserveStock};initializeFood(w);
 return {w,b,r,other};
}

test('review: remembered ruined lodge stays a tentative inspection but cannot transfer food',()=>{
 const {w,r,b}=fixture();r.at={x:10,y:10};w.map.tiles[10*w.map.width+12]='cliff';
 const before=commonsOpportunities(w,r);b.condition=0;
 assert.deepEqual(commonsOpportunities(w,r),before,'remote condition must not change remembered address choices');
 const inspect=before.find(c=>c.action.type==='commons'&&c.action.operation==='inspectFood')!;
 assert.ok(inspect);assert.ok(commonsTarget(w,r,inspect.action as Extract<Action,{type:'commons'}>).error);
 assert.equal(r.inventory.turnip,undefined);assert.equal(w.commons!.receipts.length,0);
});

test('review: an entry blocked during outdoor approach cannot be crossed by inspection',()=>{
 const {w,r,b,other}=fixture();r.at={x:10,y:10};
 const action:Action={type:'commons',operation:'inspectFood',buildingId:b.id,receiptId:commonsReceiptId(w,r)};
 assert.equal(submitPlan(w,{id:'review-entry',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'inspect only',actions:[action]}).ok,true);
 stepWorld(w,1);assert.ok(r.activity);assert.equal(r.inside,null);
 const entry=roomLayout(w,b).entry,body=structuredClone(other);body.id='review-entry-block';body.status='dead';body.at={...b.door};body.inside=b.id;body.roomAt={...entry};body.body={reservedBy:null,carriedBy:null,storedAt:b.id};w.residents.push(body);
 let ticks=50;while(r.activity||r.plan){assert.ok(ticks-->0);stepWorld(w,1);}
 assert.ok(r.lastFailure,'new entry obstruction should stop inspection instead of allowing successful arrival');
 assert.equal(r.inventory.turnip,undefined);assert.equal(r.inside,null);assert.equal(r.roomAt,null);
 assert.equal(w.civic!.stores[b.id].turnip,3);assert.equal(w.commons!.receipts.length,0);
});

test('review: adult remote openReserve choices and final prompt cannot query hidden public shelf stock',()=>{
 const {w,r,b}=fixture();r.bornAt=w.minute-30*YEAR;r.at={x:10,y:10};w.map.tiles[10*w.map.width+12]='cliff';
 const prepare=()=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
 const hiddenAt={...r.at};r.at={...b.door};assert.ok(prepare().choices.some(c=>c.action.type==='civic'&&c.action.operation==='openReserve'),'visible adult control exposes an eligible openReserve choice');r.at=hiddenAt;
 const before=prepare();assert.equal(before.choices.some(c=>c.action.type==='civic'&&c.action.operation==='openReserve'),false);
 for(const quantity of [0,1,99]){
  w.civic!.stores[b.id].turnip=quantity;for(const lot of w.food!.lots['public:'+b.id].turnip??[])lot.quantity=quantity;
  assert.deepEqual(prepare(),before,'unseen public shelf quantities cannot alter adult numbered choices or prompt');
 }
});

test('review: missing indoor coordinates and sleeping actors have no live commons food observation',()=>{
 const {w,r,b}=fixture();r.inside=b.id;r.roomAt=null;
 assert.equal(commonsFoodOptions(w,r).length,0);
 const inspect:Action={type:'commons',operation:'inspectFood',buildingId:b.id,receiptId:commonsReceiptId(w,r)};
 assert.ok(commonsTarget(w,r,inspect).error);assert.equal(r.roomAt,null);
 r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:0')!.at};
 r.activity={planId:'review-sleep',action:{type:'sleep',minutes:30},startedAt:w.minute,remaining:30,path:[],target:{...b.door},definition:w.activeDefinitions['action/routine']};
 assert.equal(commonsFoodOptions(w,r).length,0);
});
