import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World,Vec} from '../src/shared/types.js';
import {roomLayout,roomPath} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeFood} from '../src/world/food.js';
import {initializeRooms} from '../src/world/rooms.js';
import {findPath} from '../src/world/navigation.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';
import {dutyOpportunities} from '../src/server/duty-opportunities.js';
import {totalCoins,accountBalance} from '../src/world/economy.js';
import type {PublicShift} from '../src/shared/public-duties.js';
import {YEAR} from '../src/world/time.js';

// Entirely synthetic: no model requests, runtime saves, credentials or workstation teleports.
function fixture(role:'kitchen'|'care'){
 const w=createWorld(5401);w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};
 w.resources=[];w.plots=[];w.graves=[];w.events=[];w.estates=[];
 const b=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 Object.assign(b,{kind:role==='care'?'clinic':'lodge',at:{x:12,y:6},width:4,height:4,door:{x:14,y:10},residents:[],capacity:2});w.buildings=[b];
 w.residents=w.residents.slice(0,3);const [r,provider,other]=w.residents;
 for(const p of w.residents){Object.assign(p,{at:{...b.door},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-25*YEAR,health:60,energy:100,hunger:70,knownBuildings:[b.id],knownPeople:[],knownResources:[],memories:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,lastFailure:null});p.skills.care=2;}
 other.at={x:25,y:20};initializeCivic(w);initializeRooms(w);w.civic!.stores={[b.id]:{}};w.civic!.budgets=[];w.civic!.proposals=[];
 provider.inside=b.id;provider.roomAt={...roomLayout(w,b).slots.find(s=>s.key===(role==='care'?'care':'kitchen'))!.at};provider.inventory={turnip:2,meal:1,water:1};
 const shift:PublicShift={id:'observation-shift',role,buildingId:b.id,start:600,end:1000,workerId:provider.id,status:'on-duty' as const,assignments:[{residentId:provider.id,acceptedAt:590,arrivedAt:600,leftAt:null}],declinedBy:[],served:0,clientId:null};
 w.duties={publishedThroughDay:1,shifts:[shift]};initializeFood(w);
 return {w,b,r,provider,other,shift,role};
}
const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
const receive=(a:Action)=>a.type==='publicDuty'&&a.operation==='receive';
function selected(w:World,r:Resident,match:(a:Action)=>boolean){const p=prepared(w,r),c=p.choices.find(c=>match(c.action));assert.ok(c,'choice survives the final numbered menu');assert.ok(p.messages.some(m=>m.content.includes(c.id+'. '+c.label)));return parseChoice(JSON.stringify({choice:c.id}),p.choices).actions[0];}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`duty-observation:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人明确选择现场查看或接受公共服务',actions:[a]});}
function finish(w:World,r:Resident){let n=600;while(r.activity||r.plan){assert.ok(n-->0,'bounded completion');stepWorld(w,1);}}
function hide(f:ReturnType<typeof fixture>){f.r.at={x:10,y:10};f.w.map.tiles[10*f.w.map.width+12]='cliff';}
function trap(w:World,r:Resident){for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(r.at.y+dy)*w.map.width+r.at.x+dx]='cliff';}
function body(f:ReturnType<typeof fixture>,at:Vec){const p=structuredClone(f.other);p.id=`block:${at.x}:${at.y}`;p.status='dead';p.inside=f.b.id;p.roomAt={...at};p.body={reservedBy:null,carriedBy:null,storedAt:f.b.id};f.w.residents.push(p);}
function target(f:ReturnType<typeof fixture>){return roomLayout(f.w,f.b).slots.find(s=>s.key===(f.role==='care'?'bed:0':'table'))!.at;}
for(const role of ['kitchen','care'] as const){
 test(`${role}: cliff-hidden staffing and private inventory do not alter final menu or prompt`,()=>{
  const f=fixture(role);hide(f);assert.ok(findPath(f.w,f.r.at,f.b.door));const p=prepared(f.w,f.r);assert.equal(p.choices.some(c=>receive(c.action)),false);
  const before=structuredClone(f.w);prepared(f.w,f.r);assert.deepEqual(f.w,before);
  f.provider.inventory={};assert.deepEqual(prepared(f.w,f.r),p);f.shift.status='open';f.shift.workerId=null;assert.deepEqual(prepared(f.w,f.r),p);
 });
 test(`${role}: hidden public supplies and wage availability cannot change the final prompt`,()=>{
  const f=fixture(role);f.shift.funding={budgetId:'synthetic-budget',wagePerService:3,wageAccount:'escrow:synthetic-duty-wages',reserved:6,paid:0};f.w.economy!.escrows['synthetic-duty-wages']=6;f.w.civic!.stores[f.b.id]={turnip:2,meal:1,water:1};f.w.economy!.treasuryStock={turnip:2,meal:1,water:1};initializeFood(f.w);hide(f);
  const p=prepared(f.w,f.r);assert.equal(p.choices.some(c=>receive(c.action)),false);f.w.civic!.stores[f.b.id]={};f.w.economy!.treasuryStock={};f.w.food!.lots['public:'+f.b.id]={};f.w.economy!.escrows['synthetic-duty-wages']=0;assert.deepEqual(prepared(f.w,f.r),p);
 });
 test(`${role}: known hidden address stays visitable and travel does not itself serve`,()=>{
  const f=fixture(role);hide(f);const a=selected(f.w,f.r,a=>a.type==='move'&&a.to.x===f.b.door.x&&a.to.y===f.b.door.y);assert.equal(queue(f.w,f.r,a).ok,true);finish(f.w,f.r);assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,0);assert.deepEqual(f.r.at,f.b.door);
  const service=selected(f.w,f.r,receive);assert.equal(queue(f.w,f.r,service).ok,true);finish(f.w,f.r);assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,1);assert.equal(f.provider.inventory.water,0);assert.ok(f.r.hunger<70);assert.deepEqual(f.r.roomAt,target(f));
 });
 test(`${role}: explicit inspection reaches hidden service furniture without eating or taking stock`,()=>{
  const f=fixture(role);hide(f);const stock=structuredClone(f.provider.inventory);const a=selected(f.w,f.r,a=>a.type==='publicDuty'&&a.operation==='inspect');assert.equal(queue(f.w,f.r,a).ok,true);finish(f.w,f.r);
  assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,0);assert.equal(f.shift.clientId,null);assert.deepEqual(f.provider.inventory,stock);assert.deepEqual(f.r.roomAt,role==='care'?{x:target(f).x+1,y:target(f).y}:{x:target(f).x,y:target(f).y+1});assert.ok(f.r.hunger>=70);selected(f.w,f.r,receive);
 });
 test(`${role}: inspecting an occupied service never takes the current beneficiary seat`,()=>{
  const f=fixture(role);f.other.at={...f.b.door};assert.equal(queue(f.w,f.other,selected(f.w,f.other,receive)).ok,true);let n=100;while(f.shift.clientId!==f.other.id){assert.ok(n-->0);stepWorld(f.w,1);}
  const stock=structuredClone(f.provider.inventory);hide(f);assert.equal(queue(f.w,f.r,selected(f.w,f.r,a=>a.type==='publicDuty'&&a.operation==='inspect')).ok,true);finish(f.w,f.r);
  assert.equal(f.r.lastFailure,null);assert.equal(f.shift.clientId,f.other.id);assert.deepEqual(f.other.roomAt,target(f));assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);finish(f.w,f.other);assert.equal(f.other.lastFailure,null);assert.equal(f.shift.served,1);
 });
 test(`${role}: completely unreachable actor has no public service or duty-board journey`,()=>{
  const f=fixture(role);f.r.at={x:10,y:10};trap(f.w,f.r);assert.equal(findPath(f.w,f.r.at,f.b.door),null);assert.equal(prepared(f.w,f.r).choices.some(c=>receive(c.action)||c.action.type==='publicDuty'&&c.action.operation==='inspect'),false);assert.equal(dutyOpportunities(f.w,f.r).some(o=>o.id.startsWith('duty.board.')),false);
 });
 test(`${role}: same-door alias cannot see through room furniture or missing coordinates`,()=>{
  const f=fixture(role),layout=roomLayout(f.w,f.b);f.r.inside=f.b.id;f.r.roomAt=role==='kitchen'?{...layout.slots.find(s=>s.key==='kitchen')!.at}:{...layout.slots.find(s=>s.key==='table')!.at};
  assert.ok(roomPath(layout,f.r.roomAt,target(f)),'a detour does not establish sight');assert.equal(prepared(f.w,f.r).choices.some(c=>receive(c.action)),false);
  f.r.roomAt=null;assert.equal(prepared(f.w,f.r).choices.some(c=>receive(c.action)),false);
 });
 test(`${role}: real final-menu receive navigates static furniture to the actual service target`,()=>{
  const f=fixture(role);const a=selected(f.w,f.r,receive);assert.equal(queue(f.w,f.r,a).ok,true);
  let n=600;while(f.r.activity||f.r.plan){assert.ok(n-->0);stepWorld(f.w,1);if(f.r.inside===f.b.id&&f.r.roomAt)assert.equal(roomLayout(f.w,f.b).blocked.some(p=>p.x===f.r.roomAt!.x&&p.y===f.r.roomAt!.y),false);}
  assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,1);assert.deepEqual(f.r.roomAt,target(f));assert.equal(f.provider.inventory.water,0);
 });
 test(`${role}: new indoor obstacle safely stops the saved route and explicit re-choice takes a detour`,()=>{
  const f=fixture(role);f.r.inside=f.b.id;f.r.roomAt=role==='care'?{x:2,y:9}:{x:5,y:8};assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);let n=80;
  while(!f.r.activity?.room?.path.length){assert.ok(n-->0);stepWorld(f.w,1);}const blocked={...f.r.activity.room.path[0]},stoppedAt={...f.r.roomAt!},stock=structuredClone(f.provider.inventory);body(f,blocked);assert.ok(roomPath(roomLayout(f.w,f.b),f.r.roomAt!,target(f)),'detour remains possible');
  n=600;while(f.r.activity||f.r.plan){assert.ok(n-->0);stepWorld(f.w,1);assert.notDeepEqual(f.r.roomAt,blocked,'never step through a newly stored body');}
  assert.ok(f.r.lastFailure);assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);assert.deepEqual(f.r.roomAt,stoppedAt);
  if(!prepared(f.w,f.r).choices.some(c=>receive(c.action))){assert.equal(queue(f.w,f.r,selected(f.w,f.r,a=>a.type==='publicDuty'&&a.operation==='inspect')).ok,true);finish(f.w,f.r);assert.equal(f.r.lastFailure,null);}
  assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);n=600;while(f.r.activity||f.r.plan){assert.ok(n-->0);stepWorld(f.w,1);assert.notDeepEqual(f.r.roomAt,blocked);}assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,1);
 });
 test(`${role}: arrival changes stop stale requests without consuming stock`,()=>{
  for(const change of ['provider','stock','target'] as const){const f=fixture(role);assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);stepWorld(f.w,1);
   if(change==='provider')f.provider.roomAt={...roomLayout(f.w,f.b).entry};else if(change==='stock')f.provider.inventory.water=0;else for(const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])body(f,{x:target(f).x+dx,y:target(f).y+dy});
   const stock=structuredClone(f.provider.inventory);finish(f.w,f.r);assert.ok(f.r.lastFailure);assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);
  }
 });
 test(`${role}: losing actual service position during work cancels without consuming`,()=>{
  for(const position of ['missing','wrong'] as const){const f=fixture(role);assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);let n=100;
   while(f.shift.clientId!==f.r.id){assert.ok(n-->0);stepWorld(f.w,1);}assert.deepEqual(f.r.roomAt,target(f));const stock=structuredClone(f.provider.inventory);
   f.r.roomAt=position==='missing'?null:{...roomLayout(f.w,f.b).entry};finish(f.w,f.r);assert.ok(f.r.lastFailure);assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);
  }
 });
 test(`${role}: changed sight or stock after submission cannot start a stale receive`,()=>{
  for(const change of ['sight','stock'] as const){const f=fixture(role);f.r.at={x:10,y:10};assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);
   if(change==='sight')f.w.map.tiles[10*f.w.map.width+12]='cliff';else f.provider.inventory.water=0;
   const stock=structuredClone(f.provider.inventory),at={...f.r.at};finish(f.w,f.r);assert.ok(f.r.lastFailure);assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);assert.deepEqual(f.r.at,at);
  }
 });
 test(`${role}: service target becoming blocked during work cannot consume or complete`,()=>{
  const f=fixture(role);assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);let n=100;while(f.shift.clientId!==f.r.id){assert.ok(n-->0);stepWorld(f.w,1);}
  const stock=structuredClone(f.provider.inventory);body(f,target(f));finish(f.w,f.r);assert.ok(f.r.lastFailure);assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);
 });
 test(`${role}: funded competing requests spend exactly one real service and wage after SQLite reload`,()=>{
  const f=fixture(role);f.shift.funding={budgetId:'synthetic-budget',wagePerService:3,wageAccount:'escrow:synthetic-duty-wages',reserved:6,paid:0};f.w.economy!.escrows['synthetic-duty-wages']=6;
  f.w.civic!.stores[f.b.id]={turnip:2,meal:1,water:1};f.w.economy!.treasuryStock={turnip:2,meal:1,water:1};initializeFood(f.w);f.other.at={...f.b.door};
  initializeForeignTrade(f.w);const coins=totalCoins(f.w),providerCoins=f.provider.coins,personal=structuredClone(f.provider.inventory);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,r=w.residents.find(p=>p.id===f.r.id)!,other=w.residents.find(p=>p.id===f.other.id)!;
   const a=selected(w,r,receive),b=selected(w,other,receive);assert.equal(queue(w,r,a).ok,true);queue(w,other,b);let n=600;while(w.residents.some(p=>p.plan||p.activity)){assert.ok(n-->0);stepWorld(w,1);}
   const shift=w.duties!.shifts[0],provider=w.residents.find(p=>p.id===f.provider.id)!;assert.equal(shift.served,1);assert.equal(shift.funding!.paid,3);assert.equal(shift.assignments[0].wagesPaid,3);assert.equal(provider.coins,providerCoins+3);assert.equal(accountBalance(w,shift.funding!.wageAccount),3);assert.equal(totalCoins(w),coins);assert.deepEqual(provider.inventory,personal);
   for(const stock of [w.civic!.stores[f.b.id],w.economy!.treasuryStock]){assert.equal(stock.water,0);assert.equal(stock[role==='care'?'meal':'turnip'],0);}store.commit(w,f.w.revision);assert.equal(store.load()!.duties!.shifts[0].funding!.paid,3);
  }finally{store.close();}
 });
 test(`${role}: SQLite preserves hidden knowledge and competing final-menu requests conserve one service`,()=>{
  const f=fixture(role);hide(f);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,r=w.residents.find(p=>p.id===f.r.id)!;assert.equal(prepared(w,r).choices.some(c=>receive(c.action)),false);
   r.at={...f.b.door};const other=w.residents.find(p=>p.id===f.other.id)!;other.at={...f.b.door};const a=selected(w,r,receive),b=selected(w,other,receive);assert.equal(queue(w,r,a).ok,true);queue(w,other,b);let n=600;while(w.residents.some(p=>p.plan||p.activity)){assert.ok(n-->0);stepWorld(w,1);}assert.equal(w.duties!.shifts[0].served,1);const provider=w.residents.find(p=>p.id===f.provider.id)!;assert.equal(provider.inventory.water,0);assert.equal(provider.inventory[role==='care'?'meal':'turnip'],0);assert.equal([r,other].filter(p=>p.lastFailure===null).length,1);
  }finally{store.close();}
 });
}
