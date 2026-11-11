import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Resident,Resource,World} from '../src/shared/types.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {foodSourceOpportunities} from '../src/server/food-source-opportunities.js';
import {hasTimelySelfRescue,stepWorld,submitPlan} from '../src/world/engine.js';
import {initializeFood} from '../src/world/food.js';
import {residentFoodCoverage} from '../src/world/food-coverage.js';
import {distance,findPath} from '../src/world/navigation.js';
import {createWorld} from '../src/world/seed.js';
import {WorldStore} from '../src/server/store.js';
import {roomLayout} from '../src/shared/rooms.js';
import {initializeRooms} from '../src/world/rooms.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(),r=w.residents[0];w.mode='formal';w.clock.paused=false;
 w.map={width:80,height:64,tiles:Array(80*64).fill('grass'),entrance:{x:1,y:1},name:'隔离食源菜单验收'};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=[r];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{},knownBuildings:[],knownResources:[],knownPeople:[],hunger:30,health:100,energy:100,bornAt:w.minute-25*YEAR});
 initializeFood(w);return {w,r};
}
function patch(w:World,r:Resident,id:string,x:number,y:number,amount=6,known=true){
 const p:Resource={id,kind:'bush',at:{x,y},amount,max:6,regrowthDays:4,lastHarvest:w.minute};w.resources.push(p);if(known)r.knownResources.push(id);return p;
}
function seal(w:World,p:Resource){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)w.map.tiles[(p.at.y+dy)*w.map.width+p.at.x+dx]='cliff';}
const gathered=(rows:ActionChoice[])=>rows.filter(c=>c.action.type==='gather').map(c=>c.action.type==='gather'?c.action.resourceId:'');
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
function start(w:World,r:Resident,choices:ActionChoice[],choice:ActionChoice){
 const selected=parseChoice(JSON.stringify({choice:choice.id}),choices);
 const plan={id:'food-source:'+r.id+':'+w.minute+':'+r.revision,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:selected.intention,actions:selected.actions};
 assert.equal(submitPlan(w,plan).ok,true);return plan;
}
function finish(w:World,r:Resident){for(let i=0;i<500&&(r.plan||r.activity);i++)stepWorld(w,1);assert.equal(r.activity,null);assert.equal(r.plan,null);}

test('an unreachable or fractional nearest berry patch cannot hide a real local alternative',()=>{
 const {w,r}=fixture(),blocked=patch(w,r,'blocked',22,20);seal(w,blocked);
 patch(w,r,'fraction',20,21,.5);const available=patch(w,r,'available',20,25);
 patch(w,r,'unknown',19,20,100,false);
 const before=structuredClone(w);foodSourceOpportunities(w,r);
 assert.deepEqual(w,before,'generating alternatives never chooses, harvests or creates memory');
 const choices=menu(w,r);
 assert.deepEqual(gathered(choices),[available.id]);assert.ok(choices.length<=56);
 assert.equal(residentFoodCoverage(w,r).days,0,'unpicked plants are not carried or collectible stock');
 r.health=2;r.hunger=98;
 assert.ok(hasTimelySelfRescue(w,r,menu(w,r).map(c=>c.action)),'existing forecast can validate the actual alternative and subsequent meal');
});

test('one nearby option stays visible and a bounded alternative rotates across all known viable patches',()=>{
 const {w,r}=fixture();for(let i=0;i<7;i++)patch(w,r,'local-'+i,20,22+i);
 const seen=new Set<string>();
 for(let i=0;i<12;i++){
  w.minute=480+i*30;const raw=foodSourceOpportunities(w,r),ids=gathered(raw);
  assert.equal(ids.length,2);assert.equal(ids[0],'local-0');for(const id of ids)seen.add(id);
 }
 assert.equal(seen.size,7);
 const original=foodSourceOpportunities(w,r);w.resources.reverse();assert.deepEqual(foodSourceOpportunities(w,r),original);
});

test('remembered distant patches expose only inspection addresses, even if empty or not yet regrown',()=>{
 const {w,r}=fixture(),p=patch(w,r,'distant',40,20,0);patch(w,r,'unseen',39,20,99,false);
 const before=structuredClone(w),choices=foodSourceOpportunities(w,r);
 assert.equal(choices.length,1);assert.equal(choices[0].action.type,'move');assert.match(choices[0].label,/余量.*未知/);
 assert.deepEqual(w,before);assert.equal(residentFoodCoverage(w,r).days,0);
 p.amount=100;p.max=100;p.regrowthDays=100;p.lastHarvest=-1000;
 assert.deepEqual(foodSourceOpportunities(w,r),choices,'remote live stock and regeneration never affect the menu');
 assert.deepEqual(decisionContext(w,r).resources,[]);assert.deepEqual(gathered(menu(w,r)),[]);
});

test('remote alternatives rotate past blocked addresses and never depend on distant yield',()=>{
 const {w,r}=fixture(),blocked=patch(w,r,'blocked-address',34,20);seal(w,blocked);
 for(let i=0;i<7;i++)patch(w,r,'address-'+i,40+i,25,0);
 const seen=new Set<string>();for(let i=0;i<12;i++){
  w.minute=480+i*30;const choices=foodSourceOpportunities(w,r);
  assert.equal(choices.length,2);assert.equal(choices[0].id,'foodSource.inspect.address-0');
  for(const c of choices){assert.equal(c.action.type,'move');seen.add(c.id);}
 }
 assert.equal(seen.size,7);assert.ok(![...seen].some(id=>id.includes('blocked')));
});

test('many disconnected remembered patches reuse one connectivity scan without hiding a later viable source',()=>{
 const {w,r}=fixture();w.map={...w.map,width:160,height:160,tiles:Array(160*160).fill('grass')};r.at={x:4,y:4};
 for(let i=0;i<100;i++){const p=patch(w,r,'sealed-'+i,25+i%10*5,25+Math.floor(i/10)*5,0);seal(w,p);}
 patch(w,r,'late-accessible',140,140,0);
 const tiles=w.map.tiles;let reads=0;Object.defineProperty(w.map,'tiles',{get:()=>{reads++;return tiles;},configurable:true});
 const choices=foodSourceOpportunities(w,r);assert.deepEqual(choices.map(c=>c.id),['foodSource.inspect.late-accessible']);
 assert.ok(reads<=12,`map requested ${reads} times; disconnected candidates must not each start a new full search`);
});

test('an indoor resident must actually exit before checking a remembered patch outside',()=>{
 const {w,r}=fixture(),home=createWorld().buildings[0];w.buildings=[home];r.homeId=home.id;r.knownBuildings=[home.id];r.at={...home.door};r.inside=home.id;
 r.roomAt={...roomLayout(w,home).slots.find(s=>s.key==='table')!.at};initializeRooms(w);
 const p=patch(w,r,'outside-room',home.door.x,home.door.y+3),choices=menu(w,r);
 assert.deepEqual(gathered(choices),[],'being near outside stock while indoors is not observing it');
 start(w,r,choices,choices.find(c=>c.label.includes('自己记得的浆果地点'))!);stepWorld(w,1);
 assert.equal(r.inside,home.id);assert.equal(p.amount,6);finish(w,r);
 assert.equal(r.lastFailure,null);assert.equal(r.inside,null);assert.equal(distance(r.at,p.at),1);assert.ok(gathered(menu(w,r)).includes(p.id));
});

test('a resident independently returns, inspects, gathers real stock and then chooses to eat',()=>{
 const {w,r}=fixture(),p=patch(w,r,'distant',40,20),original=p.amount,startAt={...r.at};
 let choices=menu(w,r),choice=choices.find(c=>c.label.includes('自己记得的浆果地点'))!;assert.ok(choice);
 assert.equal(choice.action.type,'move');if(choice.action.type!=='move')return;
 const steps=findPath(w,r.at,choice.action.to)!.length,started=w.minute;
 start(w,r,choices,choice);assert.deepEqual(r.at,startAt);assert.deepEqual(r.inventory,{});finish(w,r);
 assert.equal(r.lastFailure,null);assert.ok(w.minute-started>=steps);assert.equal(distance(r.at,p.at),1);assert.equal(p.amount,original);assert.deepEqual(r.inventory,{});
 choices=menu(w,r);choice=choices.find(c=>c.action.type==='gather'&&c.action.resourceId===p.id)!;assert.ok(choice);
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,resourceId:'unseen'}),choices));
 start(w,r,choices,choice);finish(w,r);assert.equal(r.lastFailure,null);
 assert.equal(r.inventory.berry,3);assert.equal(p.amount,original-3);assert.equal(r.inventory.berry+p.amount,original);
 assert.ok(residentFoodCoverage(w,r).days>0);const lot={...w.food!.lots['person:'+r.id].berry![0]};
 choices=menu(w,r);choice=choices.find(c=>c.action.type==='eat'&&c.action.item==='berry')!;assert.ok(choice);
 const hunger=r.hunger;start(w,r,choices,choice);finish(w,r);
 assert.equal(r.inventory.berry,2);assert.equal(p.amount,original-3);assert.ok(r.hunger<hunger);assert.equal(w.food!.lots['person:'+r.id].berry![0].expiresAt,lot.expiresAt);
 assert.ok(w.events.some(e=>e.actors.includes(r.id)&&e.text.includes('采集了 3 份')));
});

test('arrival at a depleted remembered patch creates no food or automatic follow-on gathering',()=>{
 const {w,r}=fixture(),p=patch(w,r,'empty',40,20,0),choices=menu(w,r);
 start(w,r,choices,choices.find(c=>c.label.includes('自己记得的浆果地点'))!);finish(w,r);
 assert.equal(r.lastFailure,null);assert.equal(distance(r.at,p.at),1);assert.deepEqual(r.inventory,{});assert.equal(p.amount,0);assert.deepEqual(gathered(menu(w,r)),[]);
});

test('a route blocked during inspection stops at the real position and does not collect remotely',()=>{
 const {w,r}=fixture(),p=patch(w,r,'route-changes',40,20),choices=menu(w,r);
 start(w,r,choices,choices.find(c=>c.label.includes('自己记得的浆果地点'))!);stepWorld(w,2);
 assert.ok(r.activity?.path.length);const actual={...r.at},next=r.activity!.path[0];w.map.tiles[next.y*w.map.width+next.x]='cliff';
 finish(w,r);assert.ok(r.lastFailure);assert.deepEqual(r.at,actual);assert.deepEqual(r.inventory,{});assert.equal(p.amount,6);
});

test('stale gathering rechecks depleted stock and changed access without granting replacement food',()=>{
 for(const change of ['stock','route'] as const){
  const {w,r}=fixture(),p=patch(w,r,'fresh',20,25),choices=menu(w,r),choice=choices.find(c=>c.action.type==='gather')!;
  if(change==='stock')p.amount=2;else seal(w,p);
  start(w,r,choices,choice);finish(w,r);
  assert.ok(r.lastFailure);assert.deepEqual(r.inventory,{});assert.equal(p.amount,change==='stock'?2:6);
 }
});

test('stock taken by another actor during work is not duplicated at gathering completion',()=>{
 const {w,r}=fixture(),p=patch(w,r,'contested',20,25),choices=menu(w,r);
 start(w,r,choices,choices.find(c=>c.action.type==='gather')!);
 for(let i=0;i<40&&(!r.activity||r.activity.path.length);i++)stepWorld(w,1);
 assert.ok(r.activity);p.amount=2;finish(w,r);
 assert.ok(r.lastFailure);assert.equal(p.amount,2);assert.deepEqual(r.inventory,{});
});

test('a selected real gathering can resume from an in-memory save and cannot pay out twice',()=>{
 const {w,r}=fixture(),p=patch(w,r,'reload',20,27),choices=menu(w,r),plan=start(w,r,choices,choices.find(c=>c.action.type==='gather')!);
 stepWorld(w,2);assert.ok(r.activity||r.plan);assert.equal(p.amount,6);
 const store=new WorldStore(':memory:');try{
  store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(p=>p.id===r.id)!;loaded.clock.paused=false;
  finish(loaded,actor);assert.equal(actor.lastFailure,null);assert.equal(actor.inventory.berry,3);assert.equal(loaded.resources.find(p=>p.id==='reload')!.amount,3);
  assert.equal(submitPlan(loaded,plan).ok,true);assert.equal(actor.plan,null);assert.equal(actor.activity,null);assert.equal(actor.inventory.berry,3);assert.equal(loaded.resources.find(p=>p.id==='reload')!.amount,3);
 }finally{store.close();}
});

test('a crowded final menu keeps a real local food option and a remembered alternate without choosing either',()=>{
 const {w,r}=fixture();patch(w,r,'near',20,24);patch(w,r,'far',40,20);r.agency={focus:'social',goals:[],routines:[],nextSerial:1};
 for(let i=0;i<4;i++){
  w.minute=480+i*30;const context=decisionContext(w,r);
  context.formal!.opportunities.push(...Array.from({length:100},(_,n):ActionChoice=>({id:'class-'+n,label:'已约课程',action:{type:'education',operation:'study',lessonId:'class-'+n,minutes:30}})));
  context.formal!.opportunities.push(...Array.from({length:100},(_,n):ActionChoice=>({id:'reply-'+n,label:'拒绝提议',action:{type:'respond',proposalId:'proposal-'+n,accept:false}})));
  const choices=decisionChoices(context);assert.ok(choices.length<=56);assert.ok(gathered(choices).includes('near'));assert.ok(choices.some(c=>c.label.includes('自己记得的浆果地点')));assert.ok(choices.some(c=>c.action.type==='wait'));
 }
 assert.deepEqual(r.inventory,{});assert.equal(r.plan,null);
});

test('existing child autonomy and unavailable mobility are respected without migrating old saves',()=>{
 const {w,r}=fixture();patch(w,r,'child-food',20,24);patch(w,r,'child-address',40,20);
 r.bornAt=w.minute-6*YEAR;assert.equal(foodSourceOpportunities(w,r).length,2);
 r.bornAt=w.minute-5*YEAR;assert.deepEqual(foodSourceOpportunities(w,r),[]);
 r.bornAt=w.minute-25*YEAR;r.canDecide=false;assert.deepEqual(foodSourceOpportunities(w,r),[]);r.canDecide=true;
 w.health={cases:[{id:'severe',personId:r.id,kind:'injury',source:'test',severity:90,stage:'acute',startedAt:w.minute,lastAt:w.minute,resolvedAt:null,treatment:0,capacity:null}],appointments:[],transports:[],transportOffers:[],pulses:[],lastDay:0,nextSerial:1,totals:{injuries:1,illnesses:0,recovered:0,treated:0,paid:0,refunded:0}};
 const before=structuredClone(w);assert.deepEqual(foodSourceOpportunities(w,r),[]);assert.deepEqual(w,before);
 delete w.health;const saved=JSON.parse(JSON.stringify(w)) as World;assert.deepEqual(foodSourceOpportunities(saved,saved.residents[0]),foodSourceOpportunities(w,r));
});
