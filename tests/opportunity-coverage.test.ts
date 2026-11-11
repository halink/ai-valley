import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import type {Building,World,Resident} from '../src/shared/types.js';
import type {Livestock} from '../src/shared/industry.js';
import {initializeEconomy,completeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeIndustry,completeIndustry} from '../src/world/industry.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeProduction} from '../src/world/production.js';
import {recordDeath} from '../src/world/life.js';
import {economyOpportunities} from '../src/server/economy-opportunities.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {productionOpportunities} from '../src/server/production-opportunities.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {hasTimelySelfRescue,stepWorld,submitPlan} from '../src/world/engine.js';
import {goods,itemKeys} from '../src/shared/items.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 w.map={width:100,height:80,tiles:Array(100*80).fill('grass'),entrance:{x:1,y:1},name:'营业与照护菜单验收'};
 const r=w.residents[0];
 const home:Building={id:'home-lin',name:'原住宅',kind:'home',ownerId:r.id,residents:[r.id],at:{x:2,y:2},door:{x:5,y:7},width:6,height:5,capacity:2,condition:100,definition:'building/home@1'};
 const workshop:Building={...home,id:'new-workshop',name:'自有新工坊',kind:'workshop',residents:[],at:{x:14,y:2},door:{x:17,y:7},definition:'building/workshop@1'};
 const barn:Building={...home,id:'large-barn',name:'十栏畜舍',kind:'barn',residents:[],at:{x:2,y:15},door:{x:7,y:23},width:10,height:8,capacity:10,definition:'building/barn@1'};
 w.buildings=[home,workshop,barn];w.resources=[];w.plots=[];w.graves=[];
 for(const p of w.residents){p.at={...home.door};p.inside=null;p.roomAt=null;p.homeId=home.id;p.bornAt=w.minute-25*YEAR;p.hunger=0;p.health=p.energy=100;p.inventory={meal:20,water:20,fodder:20};p.knownBuildings=w.buildings.map(b=>b.id);p.knownResources=[];}
 initializeEconomy(w);initializeForeignTrade(w);initializeIndustry(w);
 return {w,r,home,workshop,barn};
}
function animals(w:World,r:Resident,barn:Building){
 w.industry!.animals=Array.from({length:10},(_,i):Livestock=>({id:`animal-${String(i+1).padStart(2,'0')}`,ownerId:r.id,kind:'chicken',sex:'female',bornAt:w.minute-28*DAY,barnId:barn.id,pen:i,hunger:20,thirst:20,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute}));
 r.at={...barn.door};r.inside=null;r.roomAt=null;
 return w.industry!.animals;
}
function choose(w:World,r:Resident,menu:ActionChoice[],choice:ActionChoice,fields:Record<string,unknown>={}){
 const decision=parseChoice(JSON.stringify({choice:choice.id,...fields}),menu);
 assert.equal(submitPlan(w,{id:`menu-test:${r.id}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:decision.intention,actions:decision.actions}).ok,true);
 let remaining=300;
 while(r.activity||r.plan){assert.ok(remaining-->0,'action completes by walking and working');stepWorld(w,1);}
 assert.equal(r.lastFailure,null);
}
const opens=(menu:ActionChoice[])=>menu.filter(c=>c.action.type==='economy'&&c.action.operation==='open');
const care=(menu:ActionChoice[],operation='waterAnimal')=>menu.filter(c=>c.action.type==='industry'&&c.action.operation===operation);
function crowdedMenu(w:World,r:Resident){
 const context=decisionContext(w,r);
 const appointments:ActionChoice[]=Array.from({length:100},(_,i)=>({id:'crowded-class-'+i,label:'已承诺课堂',action:{type:'education',operation:'teach',lessonId:'class-'+i,minutes:30}}));
 const replies:ActionChoice[]=Array.from({length:80},(_,i)=>({id:'crowded-reply-'+i,label:'同意或拒绝',action:{type:'respond',proposalId:'proposal-'+Math.floor(i/2),accept:i%2===0}}));
 context.formal!.opportunities=[...appointments,...replies,...context.formal!.opportunities];
 return decisionChoices(context);
}

test('both owned venues reach the real model menu and the chosen new workshop opens in place',()=>{
 const {w,r,home,workshop}=fixture(),before=totalCoins(w);
 const raw=opens(economyOpportunities(w,r));assert.equal(raw.length,2);assert.equal(new Set(raw.map(c=>c.id)).size,2);
 const menu=decisionChoices(decisionContext(w,r)),choices=opens(menu);
 assert.deepEqual(new Set(choices.map(c=>c.action.type==='economy'&&c.action.buildingId)),new Set([home.id,workshop.id]));
 const choice=choices.find(c=>c.action.type==='economy'&&c.action.buildingId===workshop.id)!;
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,buildingId:home.id}),menu));
 choose(w,r,menu,choice,{name:'新工坊小铺'});
 const shop=w.economy!.businesses[0];assert.equal(shop.buildingId,workshop.id);assert.equal(shop.name,'新工坊小铺');assert.deepEqual(r.at,workshop.door);
 assert.deepEqual(shop.inventory,{});assert.equal(shop.coins,0);assert.equal(totalCoins(w),before);assert.equal(opens(economyOpportunities(w,r)).length,0);
});

test('an invalid first venue cannot hide a later eligible venue, and stale ownership never grants opening rights',()=>{
 const {w,r,home,workshop,barn}=fixture();home.condition=0;
 w.buildings.push({...workshop,id:'unknown-workshop'},{...workshop,id:'common-workshop',ownerId:'commons'});r.knownBuildings.push('common-workshop');
 const choices=opens(economyOpportunities(w,r));assert.equal(choices.length,1);assert.equal(choices[0].action.type==='economy'&&choices[0].action.buildingId,workshop.id);
 assert.ok(!choices.some(c=>c.action.type==='economy'&&c.action.buildingId===barn.id));
 workshop.ownerId=w.residents[1].id;
 assert.ok(completeEconomy(w,r,choices[0].action as Parameters<typeof completeEconomy>[2]));assert.equal(w.economy!.businesses.length,0);
});

test('more than twenty eligible opening locations remain selectable through a bounded rotating final menu',()=>{
 const {w,r,home}=fixture();
 for(let i=0;i<24;i++){const b={...home,id:'extra-home-'+i,at:{x:30+i%8*8,y:2+Math.floor(i/8)*9},door:{x:33+i%8*8,y:7+Math.floor(i/8)*9}};w.buildings.push(b);r.knownBuildings.push(b.id);}
 const available=opens(economyOpportunities(w,r));assert.equal(available.length,26);
 r.agency={focus:'social',goals:[],routines:[],nextSerial:1};const seen=new Set<string>();
 for(let i=0;i<available.length;i++){w.minute=480+i*30;const menu=decisionChoices(decisionContext(w,r));assert.ok(menu.length<=56);for(const c of opens(menu))if(c.action.type==='economy')seen.add(c.action.buildingId!);}
 assert.equal(seen.size,available.length);
});

test('the urgent ninth animal is offered through the final menu and receives only the selected actual water',()=>{
 const {w,r,barn}=fixture(),herd=animals(w,r,barn),ninth=herd[8];ninth.hunger=ninth.thirst=95;
 r.agency={focus:'trade',goals:[],routines:[],nextSerial:1};
 const before=herd.map(n=>n.id),raw=care(industryOpportunities(w,r));assert.equal(raw.length,10);assert.equal(raw[0].action.type==='industry'&&raw[0].action.animalId,ninth.id);assert.deepEqual(herd.map(n=>n.id),before);
 const menu=decisionChoices(decisionContext(w,r)),choice=care(menu).find(c=>c.action.type==='industry'&&c.action.animalId===ninth.id)!;
 assert.ok(choice);assert.match(choice.label,new RegExp(ninth.id));assert.ok(menu.length<=56);assert.equal(ninth.lastCaredAt,undefined);
 const water=r.inventory.water!;choose(w,r,menu,choice);
 assert.equal(r.inventory.water,water-1);assert.ok(ninth.thirst<46);assert.equal(ninth.lastCaredAt,w.minute);assert.ok(herd[0].thirst>=20);assert.equal(herd[0].lastCaredAt,undefined);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const restored=store.load(true)!;assert.equal(restored.industry!.animals.find(n=>n.id===ninth.id)!.lastCaredAt,ninth.lastCaredAt);}finally{store.close();}
});

test('equal-need livestock prioritize longer waits while every individual rotates into the final menu',()=>{
 const {w,r,barn}=fixture(),herd=animals(w,r,barn);for(const n of herd)n.lastCaredAt=w.minute-10;
 herd[9].lastCaredAt=w.minute-100;
 const first=care(industryOpportunities(w,r))[0];assert.equal(first.action.type==='industry'&&first.action.animalId,herd[9].id);
 const seen=new Set<string>();r.agency={focus:'social',goals:[],routines:[],nextSerial:1};
 for(let i=0;i<herd.length;i++){w.minute=480+i*30;const menu=decisionChoices(decisionContext(w,r));assert.ok(menu.length<=56);for(const c of care(menu))if(c.action.type==='industry')seen.add(c.action.animalId!);}
 assert.equal(seen.size,herd.length);
});

test('water and feed rank their own needs rather than letting a hungry animal hide a thirsty one',()=>{
 const {w,r,barn}=fixture(),herd=animals(w,r,barn);herd[0].hunger=100;herd[8].thirst=99;
 const raw=industryOpportunities(w,r),water=care(raw)[0],feed=care(raw,'feedAnimal')[0];
 assert.equal(water.action.type==='industry'&&water.action.animalId,herd[8].id);assert.equal(feed.action.type==='industry'&&feed.action.animalId,herd[0].id);
 r.agency={focus:'social',goals:[],routines:[],nextSerial:1};
 for(let i=0;i<herd.length;i++){w.minute=480+i*30;const menu=decisionChoices(decisionContext(w,r));assert.ok(care(menu).some(c=>c.action.type==='industry'&&c.action.animalId===herd[8].id));assert.ok(care(menu,'feedAnimal').some(c=>c.action.type==='industry'&&c.action.animalId===herd[0].id));}
});

test('care menus retain material, knowledge, life and ownership checks for every individual',()=>{
 const {w,r,barn}=fixture(),herd=animals(w,r,barn);
 herd[0].status='dead';herd[1].carrierId=w.residents[1].id;herd[8].ownerId=w.residents[1].id;herd[8].product=2;
 let raw=industryOpportunities(w,r);assert.equal(care(raw).length,8);assert.ok(care(raw).some(c=>c.action.type==='industry'&&c.action.animalId===herd[8].id));
 assert.ok(!care(raw,'collectAnimal').some(c=>c.action.type==='industry'&&c.action.animalId===herd[8].id));
 const selected=care(raw).find(c=>c.action.type==='industry'&&c.action.animalId===herd[8].id)!;
 r.inventory.water=0;assert.equal(care(industryOpportunities(w,r)).length,0);assert.ok(completeIndustry(w,r,selected.action as Parameters<typeof completeIndustry>[2]));assert.equal(herd[8].lastCaredAt,undefined);
 r.inventory.water=1;r.knownBuildings=[];assert.equal(care(industryOpportunities(w,r)).length,0);
});

test('the official nine-resident start also exposes an eligible ninth animal regardless of another focus',()=>{
 const w=createFrontierWorld(),barn=w.buildings.find(b=>b.kind==='barn')!,r=w.residents.find(r=>r.id===barn.ownerId)!;
 initializeIndustry(w);r.knownBuildings.push(barn.id);r.inventory.water=1;r.inventory.fodder=1;r.agency={focus:'social',goals:[],routines:[],nextSerial:1};
 barn.width=10;barn.height=8;const herd=animals(w,r,barn);herd[8].thirst=95;
 const menu=decisionChoices(decisionContext(w,r));assert.ok(care(menu).some(c=>c.action.type==='industry'&&c.action.animalId===herd[8].id));assert.ok(menu.length<=56);
});

test('saturated appointments and responses cannot hide rest, food, livestock care or either owned venue',()=>{
 const {w,r,barn,home,workshop}=fixture(),herd=animals(w,r,barn);herd[8].hunger=herd[8].thirst=99;
 r.hunger=98;r.agency={focus:'social',goals:[],routines:[],nextSerial:1};
 for(const item of itemKeys.filter(item=>goods[item].food>0))r.inventory[item]=1;
 for(let i=0;i<10;i++){
  w.minute=480+i*30;const menu=crowdedMenu(w,r);assert.ok(menu.length<=56);
  for(const type of ['sleep','wait','eat'])assert.ok(menu.some(c=>c.action.type===type),type);
  for(const op of ['feedAnimal','waterAnimal'])assert.ok(care(menu,op).some(c=>c.action.type==='industry'&&c.action.animalId===herd[8].id),op);
  assert.deepEqual(new Set(opens(menu).map(c=>c.action.type==='economy'&&c.action.buildingId)),new Set([home.id,workshop.id]));
  assert.ok(menu.some(c=>c.action.type==='education'&&c.action.operation==='teach'));
  assert.ok(menu.some(c=>c.action.type==='respond'));
 }
});

test('an exhausted resident without a bed retains a real shore-rest choice in a crowded final menu',()=>{
 const w=createFrontierWorld(),r=w.residents.find(p=>p.id==='founder-3-2')!;
 w.frontierHazards=undefined;r.homeId=null;r.inside=null;r.roomAt=null;r.at={...w.industry!.frontierShore!};r.inventory={};r.hunger=20;r.energy=0;r.health=2;r.decisionDue=w.minute;
 const menu=crowdedMenu(w,r);assert.ok(menu.some(c=>c.action.type==='industry'&&c.action.operation==='shoreRest'));assert.ok(!menu.some(c=>c.action.type==='sleep'));
 assert.ok(hasTimelySelfRescue(w,r,menu.map(c=>c.action)));assert.ok(menu.length<=56);
});

test('fully populated priority groups retain borrowed sleep, shore rest and a rotating change of personal focus',()=>{
 const {w,r}=fixture(),context=decisionContext(w,r);context.formal!.frontier=true;context.actor.hunger=98;
 const all:ActionChoice[]=[
  {id:'wait',label:'等候',action:{type:'wait',minutes:30}},
  {id:'sleep',label:'睡眠',action:{type:'sleep',minutes:30}},
  {id:'borrowed-sleep',label:'借床睡眠',action:{type:'sleep',buildingId:'temporary-lodge',minutes:30}},
  ...(['meal','berry','fruit','bread'] as const).map(item=>({id:'eat-'+item,label:'进食',action:{type:'eat' as const,item}})),
  ...Array.from({length:8},(_,i)=>({id:'food-'+i,label:'取餐',action:{type:'economy' as const,operation:'retrieve' as const,businessId:'shop-'+i,item:'meal' as const,quantity:1}})),
  ...(['feedAnimal','waterAnimal'] as const).flatMap(operation=>[0,1].map(i=>({id:operation+i,label:'照料',action:{type:'industry' as const,operation,animalId:'animal-'+i}}))),
  ...[0,1].map(i=>({id:'open-'+i,label:'开店',action:{type:'economy' as const,operation:'open' as const,buildingId:'building-'+i}})),
  ...Array.from({length:8},(_,i)=>({id:'teach-'+i,label:'赴约',action:{type:'education' as const,operation:'teach' as const,lessonId:'lesson-'+i,minutes:30}})),
  ...Array.from({length:24},(_,i)=>({id:'respond-'+i,label:'答复',action:{type:'respond' as const,proposalId:'proposal-'+i,accept:false}})),
  ...(['hunt','fish','tameAnimal'] as const).flatMap(operation=>[0,1].map(i=>({id:operation+i,label:'户外行动',action:{type:'industry' as const,operation,at:{x:2,y:2},beastId:'animal-'+i}}))),
  {id:'shore',label:'岸边休息',action:{type:'industry',operation:'shoreRest',at:{x:2,y:2}}},
  ...(['social','industry','trade','daily'] as const).map(focus=>({id:'reflect-'+focus,label:'改变目标',action:{type:'agency' as const,operation:'reflect' as const,focus,text:'本人新的目标'}}))
 ];
 const focuses=new Set<string>();
 for(let i=0;i<4;i++){
  context.minute=480+i*30;const menu=focusedChoices(context,all);assert.ok(menu.length<=56);assert.ok(menu.some(c=>c.id==='shore'));assert.ok(menu.some(c=>c.id==='borrowed-sleep'));
  for(const c of menu)if(c.action.type==='agency'&&c.action.operation==='reflect')focuses.add(c.action.focus!);
  assert.ok(menu.some(c=>c.action.type==='agency'&&c.action.operation==='reflect'));
 }
 assert.equal(focuses.size,4);
});

test('an endangered resident can retrieve or buy actual food through the crowded final menu and eat it',()=>{
 for(const operation of ['retrieve','buy'] as const){
  const {w,r:owner,home}=fixture();
  assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:home.id}),null);
  const business=w.economy!.businesses[0];assert.equal(completeEconomy(w,owner,{type:'economy',operation:'stock',businessId:business.id,item:'meal',quantity:2}),null);
  if(operation==='buy')assert.equal(completeEconomy(w,owner,{type:'economy',operation:'list',businessId:business.id,item:'meal',quantity:1,price:1}),null);
  const r=operation==='retrieve'?owner:w.residents[1];r.inventory={};r.health=2;r.hunger=98;r.energy=80;r.decisionDue=w.minute;r.agency={focus:'social',goals:[],routines:[],nextSerial:1};
  const menu=crowdedMenu(w,r),selection=menu.find(c=>c.action.type==='economy'&&c.action.operation===operation&&c.action.item==='meal')!;
  assert.ok(selection,operation);assert.ok(hasTimelySelfRescue(w,r,menu.map(c=>c.action)),operation);
  const coins=r.coins;choose(w,r,menu,selection,operation==='retrieve'?{quantity:1}:{quantity:1,maxTotal:1});
  assert.equal(r.inventory.meal,1);assert.equal(r.coins,coins-(operation==='buy'?1:0));
  const next=crowdedMenu(w,r),eat=next.find(c=>c.action.type==='eat'&&c.action.item==='meal')!;assert.ok(eat);
  choose(w,r,next,eat);assert.equal(r.inventory.meal,0);assert.equal(r.status,'alive');assert.ok(r.hunger<95);
 }
});

test('late edible listings survive earlier non-food offers while money and real paths remain necessary',()=>{
 const {w,r:owner,home}=fixture();assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:home.id}),null);
 const business=w.economy!.businesses[0];
 for(const item of [...itemKeys.filter(item=>goods[item].food===0).slice(0,8),'meal'] as const){
  owner.inventory[item]=1;assert.equal(completeEconomy(w,owner,{type:'economy',operation:'stock',businessId:business.id,item,quantity:1}),null);
  assert.equal(completeEconomy(w,owner,{type:'economy',operation:'list',businessId:business.id,item,quantity:1,price:1}),null);
 }
 const r=w.residents[1];r.inventory={};r.hunger=98;r.health=2;r.energy=80;r.decisionDue=w.minute;
 let menu=crowdedMenu(w,r);assert.ok(menu.some(c=>c.action.type==='economy'&&c.action.operation==='buy'&&c.action.item==='meal'));assert.ok(hasTimelySelfRescue(w,r,menu.map(c=>c.action)));
 r.coins=0;menu=crowdedMenu(w,r);assert.ok(!menu.some(c=>c.action.type==='economy'&&c.action.operation==='buy'));assert.equal(hasTimelySelfRescue(w,r,menu.map(c=>c.action)),false);
 r.coins=30;r.at={x:home.door.x,y:home.door.y+3};
 for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(home.door.y+dy)*w.map.width+home.door.x+dx]='cliff';
 menu=crowdedMenu(w,r);assert.equal(hasTimelySelfRescue(w,r,menu.map(c=>c.action)),false);assert.equal(r.inventory.meal,undefined);assert.equal(w.economy!.listings.at(-1)!.quantity,1);
});

test('a verified minor estate ration stays in a saturated final menu before severe hunger',()=>{
 const {w,r:parent,home}=fixture(),child=w.residents[1];
 child.bornAt=w.minute-13*YEAR;child.parents=[parent.id];child.guardianIds=[parent.id];child.inventory={};child.agency={focus:'social',goals:[],routines:[],nextSerial:1};home.residents.push(child.id);
 parent.inventory={meal:2};initializeProduction(w);recordDeath(w,parent);
 const ration=productionOpportunities(w,child).find(c=>c.action.type==='production'&&c.action.operation==='emergencyEstateRation');assert.ok(ration);
 const originalEstate=structuredClone(w.estates);
 for(const hunger of [0,79,98])for(let i=0;i<4;i++){
  child.hunger=hunger;w.minute=480+i*30;const context=decisionContext(w,child);
  const appointments:ActionChoice[]=Array.from({length:100},(_,j)=>({id:'study-'+j,label:'测试用已承诺学习菜单负载',action:{type:'education',operation:'study',lessonId:'class-'+j,minutes:30}}));
  const replies:ActionChoice[]=Array.from({length:80},(_,j)=>({id:'reply-'+j,label:'测试用答复菜单负载',action:{type:'respond',proposalId:'proposal-'+j,accept:false}}));
  const conversations:ActionChoice[]=Array.from({length:200},(_,j)=>({id:'talk-'+j,label:'测试用关注领域菜单负载',action:{type:'talk',targetId:w.residents[2].id,text:'闲谈',tone:'neutral'}}));
  context.formal!.opportunities=[...appointments,...replies,...conversations,...context.formal!.opportunities];
  const menu=decisionChoices(context),offered=menu.find(c=>c.action.type==='production'&&c.action.operation==='emergencyEstateRation');assert.ok(offered,`hunger ${hunger}, rotation ${i}`);assert.ok(menu.length<=56);
  assert.deepEqual(parseChoice(JSON.stringify({choice:offered.id}),menu).actions[0],ration.action);
  assert.throws(()=>parseChoice(JSON.stringify({choice:offered.id,rationId:'another-allowance'}),menu));
 }
 assert.deepEqual(w.estates,originalEstate);assert.deepEqual(child.inventory,{});
});
