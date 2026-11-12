import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {roomLayout,roomPath} from '../src/shared/rooms.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={name:'synthetic exit',width:40,height:24,tiles:Array(960).fill('grass'),entrance:{x:0,y:10}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.rooms={tick:-1,claims:[],beds:{}};
 for(const r of w.residents)Object.assign(r,{at:{x:10,y:10},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:40,knownBuildings:[],knownResources:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null});
 const [giver,r,body]=w.residents;giver.inventory={turnip:3};r.inventory={berry:1};initializeFood(w);
 const template=structuredClone(createWorld().buildings[0]);
 const b={...template,id:'exit-source',kind:'home' as const,at:{x:15,y:5},door:{x:17,y:10},width:4,height:4,capacity:4,condition:100,ownerId:r.id,residents:[r.id,giver.id]};
 return {w,r,giver,body,b};
}
function inside(f:ReturnType<typeof fixture>){const {w,r,b}=f;if(!w.buildings.includes(b))w.buildings.push(b);const entry=roomLayout(w,b).entry;r.at={...b.door};r.inside=b.id;r.roomAt={x:entry.x+2,y:entry.y};return entry;}
function block(f:ReturnType<typeof fixture>,at=roomLayout(f.w,f.b).entry){const {body,b}=f;body.status='dead';body.at={...b.door};body.inside=b.id;body.roomAt={...at};body.body={reservedBy:null,carriedBy:null,storedAt:b.id};}
const location=(r:Resident)=>structuredClone({at:r.at,inside:r.inside,roomAt:r.roomAt});
function queue(w:World,r:Resident,a:Action){const q=submitPlan(w,{id:`exit:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择实际路线',actions:[a]});assert.equal(q.ok,true,q.error);}
function choose(w:World,r:Resident,operation:string){const rows=decisionChoices(decisionContext(w,r)),row=rows.find(c=>c.action.type==='personalFoodGift'&&c.action.operation===operation);assert.ok(row);return parseChoice(JSON.stringify({choice:row.id}),rows).actions[0];}
function finish(w:World,r:Resident){let n=500;while(r.plan||r.activity){assert.ok(n--);stepWorld(w,.25);}}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);assert.equal(r.lastFailure,null);}
function returned(indoorTarget:boolean){const f=fixture(),{w,r,giver,b}=f;
 if(indoorTarget){const destination={...structuredClone(b),id:'gift-destination',at:{x:8,y:5},door:{x:10,y:10}};w.buildings.push(destination);const entry=roomLayout(w,destination).entry;for(const p of [r,giver]){p.inside=destination.id;p.roomAt={x:entry.x+2,y:entry.y};}}
 run(w,giver,choose(w,giver,'offer'));run(w,r,choose(w,r,'accept'));inside(f);return f;
}

for(const target of [false,true])for(const reload of [false,true])test(`exit: blocked source cannot teleport gift return to ${target?'another room':'outdoors'}${reload?' after SQLite reload':''}`,()=>{
 const f=returned(target),{r}=f;block(f);const before=location(r),gift=structuredClone(f.w.personalFoodGifts),stock=f.w.residents.map(p=>structuredClone(p.inventory));assert.equal(roomPath(roomLayout(f.w,f.b),r.roomAt!,roomLayout(f.w,f.b).entry),null);
 queue(f.w,r,choose(f.w,r,'return'));let w=f.w,actor=r;
 if(reload){const store=new WorldStore(':memory:');try{store.commit(w,null);w=store.load(true)!;actor=w.residents.find(p=>p.id===r.id)!;}finally{store.close();}}
 stepWorld(w,.25);assert.deepEqual(location(actor),before);assert.ok(actor.lastFailure);assert.equal(actor.activity,null);assert.equal(actor.plan,null);assert.deepEqual(w.personalFoodGifts,gift);assert.deepEqual(w.residents.map(p=>p.inventory),stock);
 stepWorld(w,2);assert.deepEqual(location(actor),before,'no automatic retry after failure');
});

for(const cause of ['entry','missing-room','missing-position','door-mismatch','blocked-current'])test(`exit: ordinary movement refuses ${cause} without inventing a doorway`,()=>{
 const f=fixture();const entry=inside(f);if(cause==='entry')block(f);if(cause==='missing-room')f.w.buildings=[];if(cause==='missing-position')f.r.roomAt=null;if(cause==='door-mismatch')f.r.at.x++;if(cause==='blocked-current')block(f,f.r.roomAt!);
 const before=location(f.r);queue(f.w,f.r,{type:'move',to:{x:f.b.door.x-3,y:f.b.door.y}});stepWorld(f.w,.25);assert.deepEqual(location(f.r),before);assert.ok(f.r.lastFailure);assert.equal(f.r.activity,null);assert.ok(entry);
});

test('exit: a reachable route consumes room steps, while an actor already at the real clear entry may leave',()=>{
 for(const atEntry of [false,true]){const f=fixture(),entry=inside(f);if(atEntry)f.r.roomAt={...entry};const destination={x:f.b.door.x-3,y:f.b.door.y};queue(f.w,f.r,{type:'move',to:destination});stepWorld(f.w,.25);
  if(atEntry)assert.equal(f.r.inside,null);else {assert.equal(f.r.inside,f.b.id);assert.equal(f.r.activity!.room!.mode,'exit');assert.deepEqual(f.r.at,f.b.door);}
  finish(f.w,f.r);assert.equal(f.r.lastFailure,null);assert.equal(f.r.inside,null);assert.deepEqual(f.r.at,destination);
 }
});

for(const action of [{type:'wait',minutes:1},{type:'eat',item:'berry'}] as Action[])test(`exit: blocked doorway does not cancel original in-place ${action.type}`,()=>{
 const f=fixture();inside(f);block(f);const before=location(f.r);run(f.w,f.r,action);assert.deepEqual(location(f.r),before);
});

test('exit: a blocker appearing after route preparation stops before entering that room tile',()=>{
 const f=fixture();inside(f);queue(f.w,f.r,{type:'move',to:{x:14,y:10}});stepWorld(f.w,.25);const before=location(f.r);block(f,f.r.activity!.room!.path[0]);stepWorld(f.w,1);assert.deepEqual(location(f.r),before);assert.ok(f.r.lastFailure);assert.equal(f.r.activity,null);
});

for(const malformed of ['missing-journey','empty-journey','wrong-building','wrong-target'])test(`exit: persisted ${malformed} cannot bypass the actual exit`,()=>{
 const f=fixture(),entry=inside(f),r=f.r;
 r.activity={planId:'legacy-exit',action:{type:'move',to:{x:14,y:10}},startedAt:f.w.minute,remaining:1,path:[{x:16,y:10},{x:15,y:10},{x:14,y:10}],target:{x:14,y:10},definition:f.w.activeDefinitions['action/routine']};
 if(malformed!=='missing-journey')r.activity.room={buildingId:malformed==='wrong-building'?'another-room':f.b.id,mode:'exit',target:malformed==='wrong-target'?{x:entry.x+1,y:entry.y}:entry,path:[],progress:0};else block(f);
 const before=location(r),store=new WorldStore(':memory:');let w:World;try{store.commit(f.w,null);w=store.load(true)!;}finally{store.close();}
 const loaded=w.residents.find(p=>p.id===r.id)!;stepWorld(w,.25);assert.deepEqual(location(loaded),before);assert.ok(loaded.lastFailure);assert.equal(loaded.activity,null);
});

test('exit: a valid legacy outdoor activity with no room journey reconstructs the real interior route',()=>{
 const f=fixture();inside(f);const destination={x:14,y:10};f.r.activity={planId:'legacy-valid',action:{type:'move',to:destination},startedAt:f.w.minute,remaining:1,path:[{x:16,y:10},{x:15,y:10},destination],target:destination,definition:f.w.activeDefinitions['action/routine']};
 const before=location(f.r);stepWorld(f.w,.25);assert.deepEqual(location(f.r),before);assert.equal(f.r.activity!.room!.mode,'exit');finish(f.w,f.r);assert.equal(f.r.lastFailure,null);assert.equal(f.r.inside,null);assert.deepEqual(f.r.at,destination);
});

test('exit: a recipient can still immediately decline while the source doorway is blocked',()=>{
 const f=returned(false);block(f);const before=location(f.r);run(f.w,f.r,choose(f.w,f.r,'decline'));assert.deepEqual(location(f.r),before);assert.equal(f.w.personalFoodGifts!.gifts[0].status,'declined');
});
