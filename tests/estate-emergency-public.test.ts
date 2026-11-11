import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PublicShift} from '../src/shared/public-duties.js';
import {roomLayout} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {hasTimelyPublicFood} from '../src/world/estate-emergency-public.js';
import {initializeProduction,emergencyEstateOptions} from '../src/world/production.js';
import {initializeFood} from '../src/world/food.js';
import {initializeEconomy} from '../src/world/economy.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeRooms} from '../src/world/rooms.js';
import {recordDeath} from '../src/world/life.js';
import {dutyTarget} from '../src/world/public-duties.js';
import {findPath} from '../src/world/navigation.js';
import {addHealthCase} from '../src/world/health.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};
 w.resources=[];w.plots=[];w.graves=[];
 const b=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 b.at={x:12,y:6};b.width=b.height=4;b.door={x:14,y:10};w.buildings=[b];
 const [child,worker,dead]=w.residents;w.residents=[child,worker,dead];
 for(const p of w.residents){
  p.at={...b.door};p.inside=null;p.roomAt=null;p.homeId=null;p.parents=[];p.guardianIds=[];p.inventory={};
  p.bornAt=w.minute-30*YEAR;p.health=p.energy=100;p.hunger=30;p.knownBuildings=[b.id];
  p.canDecide=p.canExpress=true;p.activity=null;p.plan=null;
 }
 child.bornAt=w.minute-10*YEAR;child.parents=[dead.id];dead.inventory={berry:6};worker.inventory={turnip:4,water:2};
 initializeEconomy(w);initializeProduction(w);initializeCivic(w);initializeRooms(w);initializeFood(w);recordDeath(w,dead);
 const layout=roomLayout(w,b);worker.inside=b.id;worker.roomAt={...layout.slots.find(s=>s.key==='kitchen')!.at};
 child.at={x:b.door.x+2,y:b.door.y};
 const shift:PublicShift={id:'test-kitchen',role:'kitchen',buildingId:b.id,start:w.minute-1,end:w.minute+90,workerId:worker.id,status:'on-duty',assignments:[{residentId:worker.id,acceptedAt:w.minute-2,arrivedAt:w.minute-1,leftAt:null}],declinedBy:[],served:0,clientId:null};
 w.duties={publishedThroughDay:2,shifts:[shift]};
 return {w,child,worker,dead,b,shift,layout};
}
function queue(w:World,r:Resident,actions:Action[]){
 r.plan={id:'queued:'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'test existing decision',actions};
}
function funded(f:ReturnType<typeof fixture>){
 const {w,b,shift}=f;w.civic!.stores[b.id]={turnip:2,water:1};w.economy!.treasuryStock={turnip:2,water:1};
 shift.funding={budgetId:'test-budget',wagePerService:2,wageAccount:'escrow:test-kitchen:wages',reserved:2,paid:0};
 w.economy!.escrows['test-kitchen:wages']=2;initializeFood(w);
}

test('a locally known staffed public meal is a read-only alternative and completes in the real executor',()=>{
 const {w,child,worker,shift}=fixture(),before=JSON.stringify(w);
 assert.equal(hasTimelyPublicFood(w,child),true);assert.equal(JSON.stringify(w),before);
 assert.equal(emergencyEstateOptions(w,child).length,0);
 const turnips=worker.inventory.turnip!,hunger=child.hunger,start=w.minute;
 assert.equal(submitPlan(w,{id:'receive-real-meal',actorId:child.id,actorRevision:child.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人请求公厨饭食',actions:[{type:'publicDuty',operation:'receive',shiftId:shift.id}]}).ok,true);
 let left=100;while(child.plan||child.activity){assert.ok(left--);stepWorld(w,1);}
 assert.equal(child.lastFailure,null);assert.equal(shift.served,1);assert.equal(worker.inventory.turnip,turnips-2);assert.ok(child.hunger<hunger);
 assert.equal(w.minute-start,25,'two outdoor ticks, three indoor ticks and twenty service ticks');
});

test('unattended cupboard stock, an absent worker and a reserved service seat never block the child estate ration',()=>{
 for(const change of [
  (f:ReturnType<typeof fixture>)=>{f.w.duties!.shifts=[];},
  (f:ReturnType<typeof fixture>)=>{f.shift.status='booked';},
  (f:ReturnType<typeof fixture>)=>{f.worker.inside=null;},
  (f:ReturnType<typeof fixture>)=>{f.worker.roomAt={...f.layout.entry};},
  (f:ReturnType<typeof fixture>)=>{f.shift.clientId=f.dead.id;},
  (f:ReturnType<typeof fixture>)=>{delete f.w.rooms;},
 ]){const f=fixture();funded(f);change(f);const before=JSON.stringify(f.w);assert.equal(hasTimelyPublicFood(f.w,f.child),false);assert.equal(JSON.stringify(f.w),before);assert.ok(emergencyEstateOptions(f.w,f.child).length);}
});

test('a nearby stocked and staffed lodge across an impassable barrier is not reachable food',()=>{
 const f=fixture();funded(f);const {w,b,child}=f;
 for(const at of [{x:b.door.x-1,y:b.door.y},{x:b.door.x+1,y:b.door.y},{x:b.door.x,y:b.door.y+1}])w.map.tiles[at.y*w.map.width+at.x]='water';
 assert.match(dutyTarget(w,child,{type:'publicDuty',operation:'receive',shiftId:f.shift.id}).error!,/实际路线不可达/);
 assert.equal(findPath(w,child.at,b.door),null);assert.equal(hasTimelyPublicFood(w,child),false);assert.ok(emergencyEstateOptions(w,child).length);
});

test('actual indoor and detour travel must leave enough time for the whole service',()=>{
 const f=fixture();f.shift.end=f.w.minute+22;
 assert.match(dutyTarget(f.w,f.child,{type:'publicDuty',operation:'receive',shiftId:f.shift.id}).error!,/路程与工作时间超过/);
 assert.equal(hasTimelyPublicFood(f.w,f.child),false,'two outdoor steps plus indoor travel and twenty minutes do not fit');
 const g=fixture();g.child.inside=g.b.id;g.child.at={...g.b.door};g.child.roomAt={...g.layout.slots.find(s=>s.key==='table')!.at};g.shift.end=g.w.minute+20;
 assert.equal(hasTimelyPublicFood(g.w,g.child),true,'an actual seated client can finish at closing');g.shift.end--;assert.equal(hasTimelyPublicFood(g.w,g.child),false);
 const h=fixture();h.w.map.tiles[h.b.door.y*h.w.map.width+h.b.door.x+1]='water';h.shift.end=h.w.minute+25;
 assert.equal(hasTimelyPublicFood(h.w,h.child),false,'the detour costs real steps, not Manhattan distance');
});

test('unknown and distant facilities, another interior, blocked rooms and occupied workstations are not actionable alternatives',()=>{
 for(const change of [
  (f:ReturnType<typeof fixture>)=>{f.child.knownBuildings=[];},
  (f:ReturnType<typeof fixture>)=>{f.child.at={x:25,y:10};},
  (f:ReturnType<typeof fixture>)=>{f.child.inside='other-home';},
  (f:ReturnType<typeof fixture>)=>{f.child.inside=f.b.id;f.child.at={...f.b.door};f.child.roomAt={x:0,y:0};},
  (f:ReturnType<typeof fixture>)=>{f.w.rooms!.claims.push({buildingId:f.b.id,key:'kitchen',group:'other-work',people:[f.dead.id]});},
  (f:ReturnType<typeof fixture>)=>{const cook=structuredClone(f.worker);cook.id='ordinary-cook';cook.activity={planId:'cook',action:{type:'cook',quantity:1},startedAt:f.w.minute,remaining:20,path:[],target:f.b.door,definition:f.w.activeDefinitions['action/routine']};f.w.residents.push(cook);},
 ]){const f=fixture();change(f);assert.equal(hasTimelyPublicFood(f.w,f.child),false);}
});

test('a cook in another same-door room or exiting toward it does not block a staffed public meal',()=>{
 const {w,child,worker,b,layout}=fixture(),other={...structuredClone(b),id:'another-kitchen'},cook=structuredClone(worker);
 w.buildings.push(other);cook.id='other-kitchen-cook';cook.inside=other.id;
 cook.activity={planId:'other-cook',action:{type:'cook',quantity:1,buildingId:other.id},startedAt:w.minute,remaining:20,path:[],target:{...other.door},definition:'recipe/meal@1'};w.residents.push(cook);
 assert.equal(hasTimelyPublicFood(w,child),true);
 cook.inside=b.id;cook.activity.room={buildingId:b.id,mode:'exit',path:[{...layout.entry}],target:{...layout.entry},progress:0};
 assert.equal(hasTimelyPublicFood(w,child),true,'leaving for another kitchen is not an active claim on the public workstation');
});

test('a deceased person with a stale cooking activity is not an active workstation claim',()=>{
 const {w,child,dead,b}=fixture();dead.inside=b.id;
 dead.activity={planId:'stale-cook',action:{type:'cook',quantity:1},startedAt:w.minute-20,remaining:1,path:[],target:{...b.door},definition:'recipe/meal@1'};
 assert.equal(hasTimelyPublicFood(w,child),true);
});

test('a chosen departure or withdrawal before meal completion is not continuing staffing',()=>{
 for(const action of [{type:'leave'},{type:'publicDuty',operation:'withdraw',shiftId:'test-kitchen'},{type:'move',to:{x:20,y:10}}] as Action[]){
  const f=fixture();queue(f.w,f.worker,[{type:'wait',minutes:3},action]);assert.equal(hasTimelyPublicFood(f.w,f.child),false);
 }
 const f=fixture();f.worker.activity={planId:'withdraw-now',action:{type:'publicDuty',operation:'withdraw',shiftId:f.shift.id},startedAt:f.w.minute,remaining:1,path:[],target:f.b.door,definition:f.w.activeDefinitions['action/routine']};
 assert.equal(hasTimelyPublicFood(f.w,f.child),false);
 const g=fixture();queue(g.w,g.worker,[{type:'wait',minutes:60},{type:'leave'}]);assert.equal(hasTimelyPublicFood(g.w,g.child),true);
});

test('an already committed competing client can reserve the seat before clientId is populated',()=>{
 const f=fixture(),other=structuredClone(f.child);other.id='queued-client';other.parents=[];other.inventory={};f.w.residents.unshift(other);
 queue(f.w,other,[{type:'publicDuty',operation:'receive',shiftId:f.shift.id}]);
 assert.equal(f.shift.clientId,null);assert.equal(hasTimelyPublicFood(f.w,f.child),false);assert.ok(emergencyEstateOptions(f.w,f.child).length);
 stepWorld(f.w,2);assert.equal(f.shift.clientId,null,'the earlier client is still travelling indoors');
 assert.equal(other.activity?.action.type,'publicDuty');assert.equal(hasTimelyPublicFood(f.w,f.child),false);
});

test('public service requires funded wages and complete ingredients that last until the meal',()=>{
 const f=fixture();funded(f);assert.equal(hasTimelyPublicFood(f.w,f.child),true);
 f.w.economy!.escrows['test-kitchen:wages']=0;assert.equal(hasTimelyPublicFood(f.w,f.child),false);
 f.w.economy!.escrows['test-kitchen:wages']=2;f.w.civic!.stores[f.b.id].water=0;assert.equal(hasTimelyPublicFood(f.w,f.child),false);
 const g=fixture();g.worker.inventory.turnip=1;assert.equal(hasTimelyPublicFood(g.w,g.child),false);
 const h=fixture();h.w.food!.lots['person:'+h.worker.id].turnip![0].expiresAt=h.w.minute+21;assert.equal(hasTimelyPublicFood(h.w,h.child),false);
 const i=fixture();delete i.w.food!.lots['person:'+i.worker.id];assert.equal(hasTimelyPublicFood(i.w,i.child),false,'unknown freshness is not proof of an alternative');
 const j=fixture();funded(j);j.w.food!.lots['public:'+j.b.id].turnip![0].expiresAt=j.w.minute+21;assert.equal(hasTimelyPublicFood(j.w,j.child),false);
});

test('spoilage is bounded by real stock and enough remaining fresh inputs still allow a meal',()=>{
 const f=fixture(),id='person:'+f.worker.id,lot=f.w.food!.lots[id].turnip![0];
 f.w.food!.lots[id].turnip=[{...lot,quantity:2,expiresAt:f.w.minute+1},{...lot,quantity:2}];assert.equal(hasTimelyPublicFood(f.w,f.child),true);
 f.worker.inventory.turnip=2;assert.equal(hasTimelyPublicFood(f.w,f.child),false,'a stale larger ledger cannot replenish the real cupboard');
});

test('a meal arriving after lethal hunger or worker exhaustion is not timely relief',()=>{
 const f=fixture();f.child.hunger=100;f.child.health=.8;assert.equal(hasTimelyPublicFood(f.w,f.child),false);assert.ok(emergencyEstateOptions(f.w,f.child).length);
 const g=fixture();g.worker.energy=10.1;assert.equal(hasTimelyPublicFood(g.w,g.child),false);
 const h=fixture();h.worker.health=45.1;h.worker.hunger=100;assert.equal(hasTimelyPublicFood(h.w,h.child),false);
});

test('slower movement and legacy health rule lookup stay read-only',()=>{
 const f=fixture();f.shift.end=f.w.minute+28;assert.equal(hasTimelyPublicFood(f.w,f.child),true);
 const c=addHealthCase(f.w,f.child,'injury',60,'test')!;delete c.rules;delete f.w.definitions['health/rules@1'];
 const before=JSON.stringify(f.w);assert.equal(hasTimelyPublicFood(f.w,f.child),false);assert.equal(JSON.stringify(f.w),before);
});
