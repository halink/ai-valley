import {estateGoods} from '../src/world/estate-custody.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Resident,World} from '../src/shared/types.js';
import type {ConstructionAction,ConstructionProject} from '../src/shared/construction.js';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {initializeConstruction,advanceConstruction,constructionTarget,constructionReason,completeConstruction,constructionWorkError,neededConstructionMaterials,hasConstructionAssets} from '../src/world/construction.js';
import {constructionFootprint,constructionSiteError} from '../src/world/construction-sites.js';
import {constructionOpportunities} from '../src/server/construction-opportunities.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {initializeCivic,completeCivic} from '../src/world/civic.js';
import {initializeProduction,completeProduction,advanceProduction,productionParcels,productionTarget} from '../src/world/production.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {totalCoins,accountBalance} from '../src/world/economy.js';
import {recordDeath} from '../src/world/life.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {findPath,walkable} from '../src/world/navigation.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

import {observerFrame} from '../src/server/observer-feed.js';
import {ValleyRuntime} from '../src/server/runtime.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 w.map={...w.map,width:40,height:36,tiles:Array(40*36).fill('grass'),entrance:{x:1,y:1}};w.resources=[];w.plots=[];w.graves=[];
 const [owner,worker,other]=w.residents;
 const home={...w.buildings.find(b=>b.ownerId===owner.id)!,at:{x:5,y:5},width:6,height:5,door:{x:8,y:10},capacity:2,residents:[owner.id,worker.id]};
 const hall={...home,id:'hall',name:'公告会馆',kind:'lodge' as const,at:{x:24,y:5},width:8,height:6,door:{x:28,y:11},ownerId:'commons',definition:'building/lodge@1',capacity:4,residents:[]};
 w.buildings=[home,hall];
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={x:10,y:25};r.inside=null;r.coins=200;r.inventory={wood:60,stone:60,meal:20,water:20};r.health=r.energy=100;r.hunger=0;r.knownBuildings=[home.id,hall.id];r.homeId=home.id;}
 w.definitions['land/start@1'].data.parcels=[{x:7,y:20,width:9,height:7,ownerId:owner.id}];
 initializeProduction(w);initializeConstruction(w);initializeCivic(w);initializeForeignTrade(w);
 w.definitions['construction/rules@1'].data.publicAreas=[{x:1,y:1,width:38,height:34}];
 return {w,owner,worker,other,home,hall};
}
function act(w:World,r:Resident,body:Omit<ConstructionAction,'type'>){
 const action:ConstructionAction={type:'construction',...body},target=constructionTarget(w,r,action);
 assert.equal(target.error,undefined);r.at={...target.target};r.inside=null;
 assert.equal(completeConstruction(w,r,action),null);
}
function project(f:ReturnType<typeof fixture>,extra:Partial<ConstructionAction>={}){
 act(f.w,f.owner,{operation:'propose',kind:'home',at:{x:7,y:20},scope:'private',wagePerHour:6,prices:{wood:2,stone:2},...extra});
 return f.w.construction!.projects.at(-1)!;
}
function stock(w:World,r:Resident,p:ConstructionProject){
 for(const item of ['wood','stone'] as const){let need=neededConstructionMaterials(p)[item]??0;while(need){const quantity=Math.min(40,need);act(w,r,{operation:'donateMaterials',projectId:p.id,item,quantity});need-=quantity;}}
}
function work(w:World,r:Resident,p:ConstructionProject,minutes=120){
 r.energy=r.health=100;
 const action:ConstructionAction={type:'construction',operation:'work',projectId:p.id,minutes,stage:p.stage};
 assert.ok(submitPlan(w,{id:`test:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人的施工选择',actions:[action]}).ok);
 let guard=2000;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}
 assert.equal(r.lastFailure,null);
}
function hire(w:World,owner:Resident,worker:Resident,p:ConstructionProject){
 worker.at={...p.door};act(w,worker,{operation:'apply',projectId:p.id});act(w,owner,{operation:'hire',projectId:p.id,applicantId:worker.id});act(w,worker,{operation:'accept',projectId:p.id});return p.workers.at(-1)!;
}

test('three physical stages consume exactly the frozen blueprint; idle time cannot build anything',()=>{
 const f=fixture(),{w,owner}=f,p=project(f),count=w.buildings.length,money=totalCoins(w);
 assert.equal(p.status,'planned');assert.equal(w.buildings.length,count);assert.equal(walkable(w,p.at),false);
 stepWorld(w,30);assert.equal(p.stages[0].worked,0);assert.equal(p.stage,0);
 assert.match(constructionReason(w,owner,{type:'construction',operation:'work',projectId:p.id,minutes:30})!,/材料/);
 const before={...owner.inventory};stock(w,owner,p);
 assert.equal(owner.inventory.wood,before.wood!-24);assert.equal(owner.inventory.stone,before.stone!-12);
 w.activeDefinitions['building/home']='building/home@future';
 work(w,owner,p);assert.equal(p.stage,1);assert.equal(w.buildings.length,count);
 work(w,owner,p);assert.equal(p.stage,1);work(w,owner,p);assert.equal(p.stage,2);
 work(w,owner,p);assert.equal(p.status,'completed');assert.equal(w.buildings.length,count+1);
 assert.deepEqual(p.incorporated,{wood:24,stone:12});assert.deepEqual(p.stock,[]);assert.equal(p.labor[0].minutes,360);assert.equal(totalCoins(w),money);
 assert.deepEqual(w.buildings.at(-1)!.residents,[]);assert.equal(w.buildings.at(-1)!.definition,'building/home@1');
});

test('funders, supplier, employer and worker each make separate choices; fractional wages survive replay and restart',()=>{
 const f=fixture(),{w,owner,worker,other}=f,p=project(f),money=totalCoins(w);
 act(w,owner,{operation:'fund',projectId:p.id,amount:100});act(w,other,{operation:'fund',projectId:p.id,amount:30});
 const paid=other.coins;act(w,other,{operation:'supply',projectId:p.id,item:'stone',quantity:12,quotedPrice:2});assert.equal(other.coins,paid+24);
 stock(w,owner,p);worker.at={...p.door};
 assert.ok(constructionReason(w,owner,{type:'construction',operation:'hire',projectId:p.id,applicantId:worker.id}));
 act(w,worker,{operation:'apply',projectId:p.id});act(w,owner,{operation:'hire',projectId:p.id,applicantId:worker.id});
 const c=p.workers[0];assert.equal(c.status,'offered');assert.equal(accountBalance(w,c.account),36);
 assert.ok(constructionReason(w,worker,{type:'construction',operation:'work',projectId:p.id,minutes:30}));
 act(w,worker,{operation:'accept',projectId:p.id});
 worker.activity={planId:'fractional',action:{type:'construction',operation:'work',projectId:p.id,minutes:30,stage:0},startedAt:w.minute,remaining:30,path:[],target:{...p.door},definition:'action/routine@1'};
 const receipts=w.processed.length;for(let i=0;i<300;i++){w.minute+=.1;assert.equal(constructionWorkError(w,worker,worker.activity.action as ConstructionAction,.1),null);assert.equal(constructionWorkError(w,worker,worker.activity.action as ConstructionAction,.1),null);}
 assert.ok(Math.abs(c.worked-30)<1e-6);assert.equal(c.paid,3);assert.equal(w.processed.length-receipts,3);
 worker.activity=null;
 const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;store.close();assert.equal(saved.construction!.projects[0].workers[0].paid,3);
 act(w,worker,{operation:'quit',projectId:p.id});assert.equal(c.refunded,33);assert.equal(totalCoins(w),money);
 act(w,owner,{operation:'cancel',projectId:p.id});assert.equal(p.status,'abandoned');assert.equal(owner.coins,173);assert.equal(other.coins,224);assert.equal(worker.coins,203);assert.equal(totalCoins(w),money);
 advanceConstruction(w);assert.equal(totalCoins(w),money);assert.equal(accountBalance(w,p.account),0);
});

test('workers may refuse and insufficient funds cannot create a wage promise',()=>{
 const f=fixture(),{w,owner,worker}=f,p=project(f);worker.at={...p.door};
 act(w,worker,{operation:'apply',projectId:p.id});assert.ok(constructionReason(w,owner,{type:'construction',operation:'hire',projectId:p.id,applicantId:worker.id}));
 act(w,owner,{operation:'fund',projectId:p.id,amount:36});act(w,owner,{operation:'hire',projectId:p.id,applicantId:worker.id});act(w,worker,{operation:'decline',projectId:p.id});
 assert.equal(accountBalance(w,p.account),36);assert.equal(p.workers[0].status,'declined');assert.equal(p.stages[0].worked,0);
});

test('pause preserves incorporated goods, cancellation preserves salvage rights, demolition needs actual labor',()=>{
 const f=fixture(),{w,owner,other}=f,p=project(f);stock(w,other,p);work(w,owner,p,20);
 act(w,owner,{operation:'pause',projectId:p.id});const progress=p.stages[0].worked;
 stepWorld(w,10);assert.equal(p.stages[0].worked,progress);act(w,owner,{operation:'resume',projectId:p.id});work(w,owner,p,10);
 act(w,owner,{operation:'cancel',projectId:p.id});assert.equal(p.status,'abandoned');assert.equal(walkable(w,p.at),false);
 assert.ok(constructionReason(w,owner,{type:'construction',operation:'collect',projectId:p.id}));
 const wood=other.inventory.wood!;act(w,other,{operation:'collect',projectId:p.id});assert.equal(other.inventory.wood,wood+20);
 const a:ConstructionAction={type:'construction',operation:'dismantle',projectId:p.id,minutes:120};
 assert.ok(submitPlan(w,{id:'demolish',actorId:owner.id,actorRevision:owner.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'亲自拆除',actions:[a]}).ok);stepWorld(w,120);
 assert.equal(owner.lastFailure,null);assert.equal(p.status,'removed');assert.equal(walkable(w,p.at),true);assert.equal(p.demolitionMinutes,120);
 act(w,owner,{operation:'collect',projectId:p.id});assert.equal(p.claims.length,0);
});

test('a live house retains inhabitants, doorway and capacity until its extension is physically delivered',()=>{
 const f=fixture(),{w,owner,home}=f;owner.at={...home.door};const occupants=home.residents.slice(),door={...home.door},old={width:home.width,height:home.height,capacity:home.capacity};
 const p=project(f,{operation:'expand',buildingId:home.id,direction:'north'});stock(w,owner,p);
 assert.deepEqual(home.residents,occupants);assert.equal(home.capacity,old.capacity);assert.equal(walkable(w,door),true);
 work(w,owner,p);assert.equal(home.height,old.height);work(w,owner,p);assert.equal(home.capacity,old.capacity);work(w,owner,p);
 assert.equal(home.height,old.height+2);assert.equal(home.capacity,old.capacity+2);assert.deepEqual(home.door,door);assert.deepEqual(home.residents,occupants);assert.equal(home.extensions!.length,1);assert.equal(w.construction!.totals.expanded,1);
});

test('one person finishing a stage cannot carry another ongoing work choice into the next stage',()=>{
 const f=fixture(),{w,owner,worker}=f,p=project(f);stock(w,owner,p);act(w,owner,{operation:'fund',projectId:p.id,amount:36});hire(w,owner,worker,p);
 p.stages[0].worked=p.stages[0].minutes-1;
 const old:ConstructionAction={type:'construction',operation:'work',projectId:p.id,minutes:20,stage:0};w.minute++;
 assert.equal(constructionWorkError(w,owner,old,1),null);assert.equal(p.stage,1);w.minute++;
 assert.match(constructionWorkError(w,worker,old,1)!,/阶段/);assert.equal(p.stages[1].worked,0);assert.equal(p.workers[0].paid,0);
});

test('private rights, existing roads and bottleneck access are checked before committing a site',()=>{
 const f=fixture(),{w,owner,worker}=f;const a:ConstructionAction={type:'construction',operation:'propose',kind:'home',at:{x:7,y:20},wagePerHour:6,prices:{wood:2,stone:2}};
 assert.match(constructionReason(w,worker,a)!,/登记/);w.map.tiles[20*40+7]='path';assert.match(constructionReason(w,owner,a)!,/道路/);w.map.tiles[20*40+7]='grass';
 for(let y=0;y<36;y++)if(y<20||y>24)w.map.tiles[y*40+9]='water';w.map.entrance={x:1,y:22};
 assert.equal(constructionReason(w,owner,a),null);assert.match(completeConstruction(w,owner,a)!,/通路/);assert.equal(w.construction!.projects.length,0);
});

test('a reservation prevents double construction, farming claims and regrowth under a future wall',()=>{
 const f=fixture(),{w,owner,worker}=f,p=project(f);w.production!.parcelOwners[0]=worker.id;
 assert.ok(constructionReason(w,worker,{type:'construction',operation:'propose',kind:'home',at:{...p.at},wagePerHour:6,prices:{wood:2,stone:2}}));
 assert.ok(productionTarget(w,owner,{type:'production',operation:'claimPlot',at:{...p.at}}).error);
 w.resources.push({id:'stump',kind:'tree',at:{...p.at},amount:0,max:6,regrowthDays:1,lastHarvest:w.minute});initializeProduction(w);w.minute+=DAY;advanceProduction(w);assert.equal(w.resources[0].amount,0);
});

test('death closes obligations, returns unused donations to the estate, and the unfinished site follows the land heir',()=>{
 const f=fixture(),{w,owner,worker,other,home}=f,p=project(f);worker.parents=[owner.id];other.parents=[];
 stock(w,owner,p);act(w,owner,{operation:'fund',projectId:p.id,amount:60});const c=hire(w,owner,worker,p);work(w,worker,p,10);const money=totalCoins(w);
 owner.at={...p.door};recordDeath(w,owner);advanceConstruction(w);initializeProduction(w);
 assert.equal(p.status,'abandoned');assert.equal(c.status,'released');assert.equal(p.claims.length,0);assert.equal(totalCoins(w),money);
 worker.at={...home.door};assert.equal(completeProduction(w,worker,{type:'production',operation:'inherit',personId:owner.id}),null);
 assert.equal(p.ownerId,worker.id);assert.equal(p.managerId,worker.id);assert.equal(productionParcels(w)[0].ownerId,worker.id);
 worker.at={...p.door};act(w,worker,{operation:'resume',projectId:p.id});assert.equal(p.stages[0].worked,10);assert.equal(p.status,'planned');
});

test('a public project has no land, money or workers before separate votes; its mandate expires with refunds',()=>{
 const f=fixture(),{w,owner,worker,other,hall}=f;owner.at={x:23,y:25};const p=project(f,{scope:'public',at:{x:20,y:20}}),money=totalCoins(w);
 assert.equal(p.status,'proposed');assert.equal(p.reserved,false);assert.ok(constructionReason(w,owner,{type:'construction',operation:'fund',projectId:p.id,amount:5}));
 for(const r of [owner,worker,other])r.at={...hall.door};
 assert.equal(completeCivic(w,owner,{type:'civic',operation:'donate',buildingId:hall.id,amount:100}),null);
 assert.equal(completeCivic(w,owner,{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'construction',buildingId:hall.id,projectId:p.id,amount:80,durationDays:2}}),null);
 const vote=w.civic!.proposals.at(-1)!;assert.deepEqual(vote.votes,{});
 assert.equal(completeCivic(w,owner,{type:'civic',operation:'vote',proposalId:vote.id,accept:true}),null);assert.equal(p.reserved,false);
 assert.equal(completeCivic(w,worker,{type:'civic',operation:'vote',proposalId:vote.id,accept:true}),null);assert.equal(p.reserved,true);assert.equal(accountBalance(w,p.account),80);assert.equal(p.workers.length,0);
 owner.at={...p.door};stock(w,owner,p);const c=hire(w,owner,worker,p);work(w,worker,p,20);assert.equal(c.paid,2);
 w.minute=p.authorizedUntil!;advanceConstruction(w);advanceConstruction(w);assert.equal(p.status,'paused');assert.equal(w.economy!.treasury,98);assert.equal(c.status,'released');assert.equal(accountBalance(w,p.account),0);assert.equal(totalCoins(w),money);
 assert.ok(constructionReason(w,worker,{type:'construction',operation:'work',projectId:p.id,minutes:30}));
});

test('an obsolete public site never spends a passed vote budget',()=>{
 const f=fixture(),{w,owner,worker,hall}=f;owner.at={x:23,y:25};const p=project(f,{scope:'public',at:{x:20,y:20}});
 for(const r of w.residents)r.at={...hall.door};
 assert.equal(completeCivic(w,owner,{type:'civic',operation:'donate',buildingId:hall.id,amount:100}),null);
 assert.equal(completeCivic(w,owner,{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'construction',buildingId:hall.id,projectId:p.id,amount:80,durationDays:2}}),null);
 const vote=w.civic!.proposals.at(-1)!;w.plots.push({id:'later-field',ownerId:worker.id,at:{...p.at},crop:null});
 for(const r of [owner,worker])assert.equal(completeCivic(w,r,{type:'civic',operation:'vote',proposalId:vote.id,accept:true}),null);
 assert.equal(vote.status,'unfunded');assert.equal(w.economy!.treasury,100);assert.equal(p.reserved,false);
});

test('the actual model menu can choose terms and a local site but cannot forge another participant or grant',()=>{
 const f=fixture(),{w,owner}=f,menu=decisionChoices(decisionContext(w,owner));
 const choice=menu.find(c=>c.action.type==='construction'&&c.action.operation==='propose')!;assert.ok(choice);
 const result=parseChoice(JSON.stringify({choice:choice.id,name:'林间新屋',wagePerHour:11,prices:{wood:4,stone:3},x:8,y:20}),menu);
 const a=result.actions[0] as ConstructionAction;assert.equal(a.wagePerHour,11);assert.deepEqual(a.at,{x:8,y:20});assert.equal(a.name,'林间新屋');
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,ownerId:w.residents[1].id}),menu));
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,wagePerHour:-1}),menu));assert.equal(menu.some(c=>c.action.type==='build'),false);
 owner.bornAt=w.minute-17*YEAR;assert.deepEqual(constructionOpportunities(w,owner),[]);
});

test('the real formal map offers reachable registered sites and preserves existing residents during expansion',()=>{
 const w=createFormalWorld();initializeConstruction(w);const owner=w.residents[0],lot=productionParcels(w)[0];owner.at={x:lot.x+3,y:lot.y+5};owner.inside=null;
 const menu=constructionOpportunities(w,owner);const draft=menu.find(c=>c.action.type==='construction'&&c.action.operation==='propose'&&c.action.kind==='home')!.action as ConstructionAction;
 assert.notEqual(findPath(w,owner.at,constructionFootprint(w,draft)!.door),null);act(w,owner,draft);assert.equal(constructionSiteError(w,w.construction!.projects[0],true),null);
 const other=w.residents.find(r=>r.id!==owner.id&&w.buildings.some(b=>b.ownerId===r.id))!;const home=w.buildings.find(b=>b.ownerId===other.id)!;other.at={...home.door};other.inside=null;
 assert.ok(constructionOpportunities(w,other).some(c=>c.action.type==='construction'&&c.action.operation==='expand'));
});

test('workers cannot overlap an accepted public shift or charge their travel as construction labor',()=>{
 const f=fixture(),{w,owner,worker}=f,p=project(f);stock(w,owner,p);act(w,owner,{operation:'fund',projectId:p.id,amount:36});hire(w,owner,worker,p);
 stepWorld(w,.001);const shift=w.duties!.shifts[0];shift.workerId=worker.id;shift.status='booked';shift.start=w.minute;shift.end=w.minute+90;
 assert.match(constructionReason(w,worker,{type:'construction',operation:'work',projectId:p.id,minutes:30})!,/冲突/);
 shift.status='finished';worker.at={x:p.door.x+4,y:p.door.y};
 assert.ok(submitPlan(w,{id:'travel-work',actorId:worker.id,actorRevision:worker.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自己前往施工',actions:[{type:'construction',operation:'work',projectId:p.id,minutes:10,stage:0}]}).ok);
 stepWorld(w,4);assert.equal(p.stages[0].worked,0);assert.equal(p.workers[0].paid,0);stepWorld(w,10);assert.equal(p.stages[0].worked,10);assert.equal(p.workers[0].paid,1);
});

test('a worker death protects earned money and returns future wages without completing the building',()=>{
 const f=fixture(),{w,owner,worker}=f,p=project(f);stock(w,owner,p);act(w,owner,{operation:'fund',projectId:p.id,amount:36});const c=hire(w,owner,worker,p);
 work(w,worker,p,15);const before=worker.coins;recordDeath(w,worker);advanceConstruction(w);
 assert.equal(c.status,'expired');assert.equal(c.paid,1);assert.equal(accountBalance(w,p.account),35);assert.equal(w.estates.find(e=>e.personId===worker.id)!.coins,before);assert.equal(p.status,'active');assert.equal(p.stages[0].worked,15);
});

test('publicly purchased unused materials remain public and can be reused only on a new valid mandate',()=>{
 const f=fixture(),{w,owner,worker,hall}=f;owner.at={x:23,y:25};const p=project(f,{scope:'public',at:{x:20,y:20}});
 for(const r of w.residents)r.at={...hall.door};
 assert.equal(completeCivic(w,owner,{type:'civic',operation:'donate',buildingId:hall.id,amount:150}),null);
 let approvals=0;const approve=()=>{
  assert.equal(completeCivic(w,owner,{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'construction',buildingId:hall.id,projectId:p.id,amount:approvals++===0?120:20,durationDays:2}}),null);
  const v=w.civic!.proposals.at(-1)!;for(const r of [owner,worker])assert.equal(completeCivic(w,r,{type:'civic',operation:'vote',proposalId:v.id,accept:true}),null);
 };
 approve();owner.at={...p.door};for(const item of ['wood','stone'] as const)act(w,owner,{operation:'supply',projectId:p.id,item,quantity:item==='wood'?24:12,quotedPrice:2});
 hire(w,owner,worker,p);work(w,worker,p,10);act(w,owner,{operation:'cancel',projectId:p.id});assert.equal(p.status,'abandoned');assert.ok(p.claims.every(l=>l.source==='treasury'));
 assert.ok(constructionReason(w,owner,{type:'construction',operation:'collect',projectId:p.id}));
 w.minute+=DAY;for(const r of w.residents)r.at={...hall.door};approve();owner.at={...p.door};act(w,owner,{operation:'resume',projectId:p.id});assert.equal(p.claims.length,0);assert.equal(p.stock.find(l=>l.item==='wood')!.quantity,20);
});

test('new content regions never alter a reserved projects frozen permission and material definition',()=>{
 const f=fixture(),{w}=f,p=project(f);w.definitions['construction/rules@2']={id:'construction/rules',version:2,kind:'action',dependencies:[],data:{publicAreas:[{x:1,y:1,width:2,height:2}]}};w.activeDefinitions['construction/rules']='construction/rules@2';
 initializeConstruction(w);assert.equal(p.ruleVersion,1);assert.equal(w.activeDefinitions['construction/rules'],'construction/rules@2');assert.equal(constructionSiteError(w,p,true),null);
});

test('observer snapshots propagate construction changes',()=>{
 const f=fixture(),{w,owner}=f,p=project(f,{name:'<img src=x onerror=x>'});const store=new WorldStore(':memory:');store.commit(w,null);const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 try{
  const before=structuredClone(runtime.snapshot());
  const unchanged=observerFrame(runtime.snapshot(),before);assert.equal(unchanged.world.construction,undefined);
  runtime.world.construction!.projects[0].reason='已自主停工';runtime.world.revision++;const changed=observerFrame(runtime.snapshot(),before);assert.equal(changed.world.construction!.projects[0].reason,'已自主停工');
  assert.equal(runtime.world.construction!.projects[0].stages[0].worked,0);assert.equal(runtime.world.id,w.id);
 }finally{runtime.stop();store.close();}
});

test('an in-flight legacy instant build cannot bypass staged construction after upgrading the formal save',()=>{
 const f=fixture(),{w,owner}=f,count=w.buildings.length,inventory={...owner.inventory};
 owner.activity={planId:'old-build',action:{type:'build',kind:'home',at:{x:7,y:20}},startedAt:w.minute-359,remaining:1,path:[],target:{...owner.at},definition:'action/routine@1'};
 stepWorld(w,1);assert.match(owner.lastFailure!,/分阶段/);assert.equal(w.buildings.length,count);assert.deepEqual(owner.inventory,inventory);
});

test('a deceased funder or material donor cannot strand inheritance inside somebody elses unfinished project',()=>{
 const f=fixture(),{w,owner,worker,other}=f,p=project(f),money=totalCoins(w);
 act(w,owner,{operation:'fund',projectId:p.id,amount:100});act(w,other,{operation:'fund',projectId:p.id,amount:30});
 act(w,other,{operation:'donateMaterials',projectId:p.id,item:'wood',quantity:24});act(w,owner,{operation:'donateMaterials',projectId:p.id,item:'stone',quantity:12});const c=hire(w,owner,worker,p);work(w,worker,p,10);
 recordDeath(w,other);assert.ok(hasConstructionAssets(w,other.id));advanceConstruction(w);advanceConstruction(w);
 const estate=w.estates.find(e=>e.personId===other.id)!;
 assert.equal(estate.coins,200);assert.equal(estateGoods(w,other.id).wood,56);assert.ok(estate.parcels?.some(s=>s.location.at.x===p.door.x&&s.location.at.y===p.door.y&&s.inventory.wood===20));assert.equal(hasConstructionAssets(w,other.id),false);assert.equal(p.status,'paused');assert.equal(p.stages[0].worked,10);assert.equal(c.status,'released');assert.equal(c.paid,1);assert.equal(accountBalance(w,p.account),99);assert.equal(totalCoins(w),money);
 act(w,owner,{operation:'resume',projectId:p.id});assert.equal(p.stages[0].worked,10);assert.equal(neededConstructionMaterials(p).wood,20);
});

test('fractional live ticks finish a stage without leaving a stale activity or reporting a false failure',()=>{
 const f=fixture(),{w,owner}=f,p=project(f);stock(w,owner,p);
 assert.ok(submitPlan(w,{id:'fractional-stage',actorId:owner.id,actorRevision:owner.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自己完成当前阶段',actions:[{type:'construction',operation:'work',projectId:p.id,minutes:120,stage:0}]}).ok);
 for(let i=0;i<901;i++)stepWorld(w,.1);
 assert.equal(p.stage,1);assert.equal(owner.activity,null);assert.equal(owner.lastFailure,null);assert.equal(p.stages[1].worked,0);
});
test('separately accepted workers can contribute concurrently, with separate prepaid wages and exact combined stage labor',()=>{
 const f=fixture(),{w,owner,worker,other}=f,p=project(f);stock(w,owner,p);act(w,owner,{operation:'fund',projectId:p.id,amount:80});const first=hire(w,owner,worker,p),second=hire(w,owner,other,p),money=totalCoins(w);
 for(const r of [worker,other]){r.at={...p.door};assert.ok(submitPlan(w,{id:`concurrent-build:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立接受并选择一起施工',actions:[{type:'construction',operation:'work',projectId:p.id,minutes:10,stage:0}]}).ok);}
 const before=p.stages[0].worked;stepWorld(w,10);assert.equal(worker.lastFailure,null);assert.equal(other.lastFailure,null);assert.equal(p.stages[0].worked,before+20);assert.equal(first.worked,10);assert.equal(second.worked,10);assert.equal(first.paid,1);assert.equal(second.paid,1);assert.equal(totalCoins(w),money);act(w,owner,{operation:'release',projectId:p.id,applicantId:worker.id});assert.equal(first.status,'released');assert.equal(second.status,'active');assert.equal(first.paid,1);assert.equal(second.refunded,0);
});
test('concurrent final-stage ticks cannot manufacture a new stage or duplicate a building',()=>{
 const f=fixture(),{w,owner,worker,other}=f,p=project(f);stock(w,owner,p);act(w,owner,{operation:'fund',projectId:p.id,amount:80});hire(w,owner,worker,p);hire(w,owner,other,p);p.stages[0].worked=p.stages[0].minutes-1;
 for(const r of [worker,other]){r.at={...p.door};assert.ok(submitPlan(w,{id:`stage-boundary:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择当前施工阶段',actions:[{type:'construction',operation:'work',projectId:p.id,minutes:10,stage:0}]}).ok);}
 stepWorld(w,1);assert.equal(p.stage,1);assert.equal(p.stages[0].worked,p.stages[0].minutes);assert.equal(p.stages[1].worked,0);assert.equal(p.workers.reduce((n,c)=>n+c.worked,0),1);assert.equal(w.buildings.filter(b=>b.id===`built:${p.id}`).length,0);
});
test('building conversion refuses occupied housing, then reuses the exact identity, footprint and title after voluntary moves and real staged work',async()=>{
 const {executeSocialAction}=await import('../src/world/social.js');const f=fixture(),{w,owner,home,hall}=f;owner.at={...home.door};const a:ConstructionAction={type:'construction',operation:'convert',buildingId:home.id,kind:'store',wagePerHour:6,prices:{wood:2,stone:2},name:'改作粮铺的旧屋'};assert.match(constructionReason(w,owner,a)!,/迁离/);
 for(const r of w.residents){r.at={...hall.door};assert.equal(executeSocialAction(w,r,{type:'settle',buildingId:hall.id}).ok,true);}owner.at={...home.door};const before={id:home.id,at:{...home.at},door:{...home.door},width:home.width,height:home.height,ownerId:home.ownerId};act(w,owner,{...a});const p=w.construction!.projects.at(-1)!;assert.equal(p.mode,'conversion');stock(w,owner,p);assert.equal(home.kind,'home');let guard=20;while(p.status!=='completed'){assert.ok(guard--);work(w,owner,p);}assert.equal(home.kind,'store');assert.equal(home.id,before.id);assert.deepEqual(home.at,before.at);assert.deepEqual(home.door,before.door);assert.equal(home.width,before.width);assert.equal(home.height,before.height);assert.equal(home.ownerId,before.ownerId);assert.equal(w.buildings.length,2);assert.equal(home.conversions?.length,1);assert.equal(home.conversions![0].from,'home');assert.equal(p.buildingId,home.id);
});
test('conversion cannot discard existing equipment, animals, crops or separate unfinished obligations',()=>{
 const f=fixture(),{w,owner,home}=f;for(const r of w.residents)r.homeId=null;home.residents=[];home.kind='workshop';home.definition='building/workshop@1';owner.at={...home.door};const a:ConstructionAction={type:'construction',operation:'convert',buildingId:home.id,kind:'store',wagePerHour:0,prices:{wood:2,stone:2}};
 stepWorld(w,.001);w.industry!.stations.push({id:'actual-old-bench',buildingId:home.id,kind:'bench',installedAt:w.minute});assert.match(constructionReason(w,owner,a)!,/设备/);assert.equal(w.industry!.stations.length,1);w.industry!.stations=[];w.industry!.animals.push({id:'actual-old-animal',ownerId:owner.id,barnId:home.id,kind:'chicken',sex:'female',bornAt:w.minute-30*DAY,hunger:0,thirst:0,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute});assert.match(constructionReason(w,owner,a)!,/动物/);assert.equal(w.industry!.animals.length,1);
});
