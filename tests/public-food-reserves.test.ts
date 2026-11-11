import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {CivicAction,CivicMeasure,PublicFoodReserve} from '../src/shared/civic.js';
import type {CommonsAction} from '../src/shared/commons.js';
import {createFormalWorld,createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeCivic,completeCivic,civicReason,advanceCivic,hasPublicServiceSupplies} from '../src/world/civic.js';
import {reserveContainer,reserveReceiptId} from '../src/world/public-food-reserves.js';
import {initializeCommons,completeCommons,commonsReason,commonsReceiptId,commonsFoodOptions,commonsFoodRemaining,hasTimelyCommonsFood} from '../src/world/commons.js';
import {initializeFood,advanceFood,foodContainers} from '../src/world/food.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {advancePublicDuties} from '../src/world/public-duties.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {accountBalance,totalCoins,moveCoins} from '../src/world/economy.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {civicOpportunities} from '../src/server/civic-opportunities.js';
import {commonsOpportunities} from '../src/server/commons-opportunities.js';
import {residentFoodCoverage,settlementFoodCoverage} from '../src/world/food-coverage.js';
import {financePanel} from '../src/client/livelihood.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createFormalWorld();w.minute=600;w.clock.paused=false;
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};w.resources=[];w.plots=[];w.graves=[];
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;hall.at={x:12,y:6};hall.width=hall.height=4;hall.door={x:14,y:10};hall.residents=[];hall.capacity=4;w.buildings=[hall];
 w.residents=w.residents.slice(0,3);for(const r of w.residents){r.at={...hall.door};r.inside=null;r.roomAt=null;r.homeId=null;r.parents=[];r.guardianIds=[];r.inventory={turnip:20,seed:10};r.coins=200;r.bornAt=w.minute-30*YEAR;r.health=r.energy=100;r.hunger=20;r.knownBuildings=[hall.id];r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.activity=null;r.plan=null;}
 const child=structuredClone(w.residents[0]);child.id='reserve-child';child.name='领粮孩子';child.bornAt=w.minute-10*YEAR;child.inventory={};w.residents.push(child);
 initializeCivic(w);initializeCommons(w);initializeRooms(w);initializeForeignTrade(w);advancePublicDuties(w);initializeFood(w);
 return {w,hall,adults:w.residents.slice(0,3),child};
}
type Fixture=ReturnType<typeof fixture>;
function table(f:Fixture,r:Resident){r.at={...f.hall.door};r.inside=f.hall.id;r.roomAt={...roomLayout(f.w,f.hall).slots.find(s=>s.key==='table')!.at};}
function doorway(f:Fixture,r:Resident){r.at={...f.hall.door};r.inside=null;r.roomAt=null;}
function measure(f:Fixture,overrides:Partial<Extract<CivicMeasure,{kind:'foodReserve'}>>={}):Extract<CivicMeasure,{kind:'foodReserve'}>{return {kind:'foodReserve',buildingId:f.hall.id,item:'turnip',quantity:12,unitPrice:3,suppliesBudget:36,dailyNutrition:40,durationDays:2,...overrides};}
function civic(f:Fixture,r:Resident,a:CivicAction){assert.equal(completeCivic(f.w,r,a),null);}
function approve(f:Fixture,m=measure(f),fund=true){
 const {w,adults,hall}=f;for(const r of adults)doorway(f,r);
 if(fund&&m.suppliesBudget)civic(f,adults[0],{type:'civic',operation:'donate',buildingId:hall.id,amount:m.suppliesBudget});
 civic(f,adults[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:m});const p=w.civic!.proposals.at(-1)!;
 civic(f,adults[0],{type:'civic',operation:'vote',proposalId:p.id,accept:true});assert.equal(p.status,'open');
 civic(f,adults[1],{type:'civic',operation:'vote',proposalId:p.id,accept:true});return p;
}
function delivery(p:PublicFoodReserve,quantity=3,operation:'supplyReserve'|'openReserve'='supplyReserve'):CivicAction{return {type:'civic',operation,reserveId:p.id,quantity,receiptId:reserveReceiptId(p)};}
function take(f:Fixture,p:PublicFoodReserve,r=f.child):CommonsAction{return {type:'commons',operation:'takeFood',buildingId:f.hall.id,item:p.item,reserveId:p.id,receiptId:commonsReceiptId(f.w,r)};}
function ready(m?:Partial<Extract<CivicMeasure,{kind:'foodReserve'}>>){const f=fixture();assert.equal(approve(f,measure(f,m)).status,'approved');return {...f,reserve:f.w.civic!.reserves![0]};}
function run(w:World,r:Resident,a:Action){assert.equal(submitPlan(w,{id:`reserve-test:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人自主决定',actions:[a]}).ok,true);let n=500;while(r.activity||r.plan){assert.ok(n-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function publicBalance(w:World){const actual=[...Object.values(w.civic!.stores),...(w.civic!.reserves??[]).map(p=>p.inventory)].reduce((n,b)=>n+(b.turnip??0),0);assert.equal(w.economy!.treasuryStock.turnip??0,actual);return actual;}
function physical(w:World){return [...foodContainers(w).values()].reduce((n,b)=>n+(b.turnip??0),0);}

test('ordinary menus run separate votes, finite procurement, indoor delivery, child collection and eating',()=>{
 const f=fixture(),{w,adults,hall,child}=f,coins=totalCoins(w),stock=physical(w);
 run(w,adults[0],{type:'civic',operation:'donate',buildingId:hall.id,amount:24});
 const menu=decisionChoices(decisionContext(w,adults[0])),choice=menu.find(o=>o.action.type==='civic'&&o.action.operation==='propose'&&o.action.measure.kind==='foodReserve'&&o.action.measure.item==='turnip')!;assert.ok(choice);
 run(w,adults[0],parseChoice(JSON.stringify({choice:choice.id,quantity:8,unitPrice:3,suppliesBudget:24,dailyNutrition:40,durationDays:2}),menu).actions[0]);const proposal=w.civic!.proposals.at(-1)!;assert.deepEqual(proposal.votes,{});assert.equal(w.civic!.reserves!.length,0);
 for(const actor of adults.slice(0,2)){const vote=decisionChoices(decisionContext(w,actor)).find(o=>o.action.type==='civic'&&o.action.operation==='vote'&&o.action.accept)!;assert.ok(vote);run(w,actor,vote.action);}
 const p=w.civic!.reserves![0];assert.equal(p.quantityLimit,8);assert.equal(accountBalance(w,p.supplyAccount),24);assert.equal(w.economy!.treasury,0);assert.equal(physical(w),stock);
 const seller=adults[2],expires=w.food!.lots['person:'+seller.id].turnip![0].expiresAt;
 const supply=decisionChoices(decisionContext(w,seller)).find(o=>o.action.type==='civic'&&o.action.operation==='supplyReserve')!;assert.ok(supply);assert.match(completeCivic(w,seller,supply.action as CivicAction)!,/桌台/);
 run(w,seller,supply.action);assert.equal(seller.coins,209);assert.equal(p.inventory.turnip,3);assert.equal(publicBalance(w),3);assert.equal(w.food!.lots[reserveContainer(p.id)].turnip![0].expiresAt,expires);
 const collect=decisionChoices(decisionContext(w,child)).find(o=>o.action.type==='commons'&&o.action.operation==='takeFood'&&o.action.reserveId===p.id)!;assert.ok(collect);const hunger=child.hunger;run(w,child,collect.action);
 assert.equal(child.inventory.turnip,1);assert.ok(child.hunger>hunger);assert.equal(publicBalance(w),2);assert.equal(p.withdrawn,1);assert.equal(physical(w),stock);assert.equal(totalCoins(w),coins);assert.equal(w.food!.lots['person:'+child.id].turnip![0].expiresAt,expires);
 run(w,child,{type:'eat',item:'turnip'});assert.ok(child.hunger<hunger);assert.equal(physical(w),stock-1);
});

test('unfunded, rejected, malformed and no-quorum proposals never mint an authority or funds',()=>{
 const f=fixture(),{w,adults,hall}=f,coins=totalCoins(w);assert.equal(approve(f,measure(f),false).status,'unfunded');assert.equal(w.civic!.reserves!.length,0);assert.equal(totalCoins(w),coins);
 w.minute+=DAY;const bad=measure(f,{item:'seed'});assert.match(civicReason(w,adults[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:bad})!,/种粮/);
 w.residents=w.residents.filter(r=>r.id!==adults[2].id);assert.match(civicReason(w,adults[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:measure(f)})!,/三位/);
 const g=fixture();civic(g,g.adults[0],{type:'civic',operation:'propose',buildingId:g.hall.id,measure:measure(g)});const p=g.w.civic!.proposals[0];for(const r of g.adults.slice(0,2))civic(g,r,{type:'civic',operation:'vote',proposalId:p.id,accept:false});assert.equal(p.status,'rejected');assert.equal(g.w.civic!.reserves!.length,0);
});

test('approval rechecks a ruined or no-longer-public destination after independent voting',()=>{
 for(const invalidate of ['ruin','ownership'] as const){const f=fixture(),{w,adults,hall}=f;const other={...structuredClone(hall),id:'other-board',door:{x:20,y:10}};w.buildings.push(other);
 civic(f,adults[0],{type:'civic',operation:'donate',buildingId:hall.id,amount:36});civic(f,adults[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:measure(f)});const p=w.civic!.proposals[0];civic(f,adults[0],{type:'civic',operation:'vote',proposalId:p.id,accept:true});if(invalidate==='ruin')hall.condition=0;else hall.ownerId=adults[0].id;adults[1].at={...other.door};civic(f,adults[1],{type:'civic',operation:'vote',proposalId:p.id,accept:true});assert.equal(p.status,'unfunded');assert.equal(w.civic!.reserves!.length,0);assert.equal(w.economy!.treasury,36);}
});

test('on-site opening preserves original public food and cannot take seed, service or funded-shift stock',()=>{
 const f=ready({suppliesBudget:0}),{w,adults,hall,reserve:p}=f;w.civic!.stores[hall.id]={turnip:5,seed:9};w.economy!.treasuryStock={turnip:5,seed:9};initializeFood(w);const expires=w.food!.lots['public:'+hall.id].turnip![0].expiresAt,coins=totalCoins(w);table(f,adults[0]);
 const budget={id:'protect',proposalId:'old',buildingId:hall.id,kind:'service' as const,startsAt:w.minute,expiresAt:w.minute+DAY,status:'active' as const,wage:1,wageLimit:1,suppliesLimit:10,paidWages:0,spentSupplies:0,wageAccount:'w',supplyAccount:'s',prices:{},purchased:{}};w.civic!.budgets.push(budget);
 assert.match(completeCivic(w,adults[0],delivery(p,3,'openReserve'))!,/预算/);w.civic!.budgets=[];
 w.duties!.shifts=[{id:'funded',role:'kitchen',buildingId:hall.id,start:w.minute-1,end:w.minute+60,status:'open',workerId:null,assignments:[],declinedBy:[],served:0,clientId:null,funding:{budgetId:'old',wagePerService:1,wageAccount:'x',reserved:1,paid:0}}];assert.match(completeCivic(w,adults[0],delivery(p,3,'openReserve'))!,/班次/);w.duties!.shifts=[];
 civic(f,adults[0],delivery(p,3,'openReserve'));assert.equal(p.inventory.turnip,3);assert.equal(w.civic!.stores[hall.id].turnip,2);assert.equal(w.civic!.stores[hall.id].seed,9);assert.equal(p.opened,3);assert.equal(p.spent,0);assert.equal(publicBalance(w),5);assert.equal(totalCoins(w),coins);assert.equal(w.food!.lots[reserveContainer(p.id)].turnip![0].expiresAt,expires);
});

test('reserve stock stays separate from service stock and charter withdrawals even during active budgets',()=>{
 const f=ready(),{w,adults,hall,child,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p));w.civic!.stores[hall.id]={water:3};w.economy!.treasuryStock.water=3;w.economy!.escrows['test-wages']=5;
 const shift={id:'test-shift',role:'kitchen' as const,buildingId:hall.id,start:w.minute,end:w.minute+60,status:'on-duty' as const,workerId:adults[0].id,assignments:[],declinedBy:[],served:0,clientId:null,funding:{budgetId:'old',wagePerService:1,wageAccount:'escrow:test-wages',reserved:5,paid:0}};w.duties!.shifts=[shift];
 assert.equal(hasPublicServiceSupplies(w,shift),false);assert.ok(commonsReason(w,child,{type:'commons',operation:'takeFood',buildingId:hall.id,item:'turnip',receiptId:commonsReceiptId(w,child)}));table(f,child);assert.equal(completeCommons(w,child,take(f,p)),null);assert.equal(publicBalance(w),2);assert.equal(w.civic!.stores[hall.id].water,3);
});

test('stale competing deliveries and last-unit withdrawals cannot settle twice or partially',()=>{
 const f=ready({quantity:3,suppliesBudget:9}),{w,adults,child,reserve:p}=f;const first=delivery(p,3),second=delivery(p,3);table(f,adults[0]);table(f,adults[1]);civic(f,adults[0],first);assert.match(completeCivic(w,adults[1],second)!,/回执/);const coins=totalCoins(w),stock=physical(w);assert.equal(completeCivic(w,adults[0],first),null);assert.equal(physical(w),stock);assert.equal(totalCoins(w),coins);assert.ok(completeCivic(w,adults[0],delivery(p,1)));
 for(const r of [child,adults[1],adults[2]]){table(f,r);assert.equal(completeCommons(w,r,take(f,p,r)),null);}const old=take(f,p,adults[0]);table(f,adults[0]);assert.match(completeCommons(w,adults[0],old)!,/现物/);assert.equal(publicBalance(w),0);assert.equal(p.withdrawn,3);
});

test('unavailable stock, changed location, expired lots and insufficient escrow reject the whole requested delivery',()=>{
 const f=ready(),{w,adults,reserve:p}=f,seller=adults[2];const coins=seller.coins;table(f,seller);seller.inventory.turnip=1;initializeFood(w);assert.match(completeCivic(w,seller,delivery(p,2))!,/足额/);assert.equal(seller.coins,coins);assert.equal(p.stocked,0);
 seller.inventory.turnip=3;initializeFood(w);w.food!.lots['person:'+seller.id].turnip!.forEach(l=>l.expiresAt=w.minute);assert.match(completeCivic(w,seller,delivery(p,1))!,/变质/);assert.equal(p.stocked,0);w.food!.lots['person:'+seller.id].turnip!.forEach(l=>l.expiresAt=w.minute+DAY);
 seller.at={x:1,y:1};seller.inside=null;assert.match(completeCivic(w,seller,delivery(p,1))!,/亲自到/);table(f,seller);p.suppliesLimit=2;assert.match(completeCivic(w,seller,delivery(p,1))!,/余额/);assert.equal(p.inventory.turnip,undefined);p.suppliesLimit=36;assert.equal(moveCoins(w,p.supplyAccount,'treasury',36,'隔离测试核对真实账户不足','reserve-test-drain'),true);assert.equal(p.spent,0);assert.match(completeCivic(w,seller,delivery(p,1))!,/余额/);assert.equal(seller.coins,coins);
});

test('rolling allowance includes charter food, another lodge, another mandate and exact 24-hour boundary',()=>{
 const f=ready(),{w,adults,child,hall,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p,6));w.civic!.stores[hall.id]={turnip:1};w.economy!.treasuryStock.turnip!++;initializeFood(w);table(f,child);
 assert.equal(completeCommons(w,child,{type:'commons',operation:'takeFood',buildingId:hall.id,item:'turnip',receiptId:commonsReceiptId(w,child)}),null);assert.equal(completeCommons(w,child,take(f,p)),null);assert.match(commonsReason(w,child,take(f,p))!,/额度/);assert.ok(commonsFoodRemaining(w,child)<20);
 const clone={...structuredClone(p),id:'second-reserve',buildingId:'second-lodge',inventory:{turnip:2},dailyNutrition:40};const house={...structuredClone(hall),id:clone.buildingId};w.buildings.push(house);child.knownBuildings.push(house.id);w.civic!.reserves!.push(clone);w.economy!.treasuryStock.turnip!+=2;initializeFood(w);const other={...take(f,p),buildingId:house.id,reserveId:clone.id} as CommonsAction;assert.match(commonsReason(w,child,other)!,/额度/);
 w.minute+=DAY-1;assert.match(commonsReason(w,child,take(f,p))!,/额度/);w.minute++;assert.equal(commonsReason(w,child,take(f,p)),null);assert.equal(p.inventory.turnip,5);
});

test('food expires in the dedicated shelf without refund, replenishment or renewed lifetime capacity',()=>{
 const f=ready({quantity:3,suppliesBudget:9}),{w,adults,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p));w.food!.lots[reserveContainer(p.id)].turnip!.forEach(l=>l.expiresAt=w.minute+1);w.minute++;advanceFood(w);assert.equal(p.inventory.turnip,0);assert.equal(publicBalance(w),0);assert.equal(p.stocked,3);assert.equal(p.spent,9);assert.equal(accountBalance(w,p.supplyAccount),0);assert.ok(completeCivic(w,adults[2],delivery(p,1)));
});

test('expiry refunds only unused cash and reclassifies remaining food at its original site once',()=>{
 const f=ready(),{w,adults,child,hall,reserve:p}=f;const coins=totalCoins(w);table(f,adults[2]);civic(f,adults[2],delivery(p));const expires=w.food!.lots[reserveContainer(p.id)].turnip![0].expiresAt,stock=physical(w);w.minute=p.expiresAt;
 assert.match(commonsReason(w,child,take(f,p))!,/失效/);assert.ok(completeCivic(w,adults[2],delivery(p,1)));advanceCivic(w);assert.equal(p.status,'expired');assert.equal(p.refunded,27);assert.equal(w.economy!.treasury,27);assert.equal(accountBalance(w,p.supplyAccount),0);assert.equal(w.civic!.stores[hall.id].turnip,3);assert.equal(p.inventory.turnip,0);assert.equal(publicBalance(w),3);assert.equal(w.food!.lots['public:'+hall.id].turnip![0].expiresAt,expires);assert.equal(physical(w),stock);assert.equal(totalCoins(w),coins);advanceCivic(w);assert.equal(w.economy!.treasury,27);assert.equal(publicBalance(w),3);
});

test('quorum loss keeps only the original finite mandate and cannot create or extend another',()=>{
 const f=ready(),{w,adults,child,hall,reserve:p}=f;w.residents=[adults[0],child];table(f,adults[0]);civic(f,adults[0],delivery(p));table(f,child);assert.equal(completeCommons(w,child,take(f,p)),null);assert.match(civicReason(w,adults[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:measure(f)})!,/三位/);assert.equal(p.expiresAt,p.startsAt+2*DAY);w.minute=p.expiresAt;advanceCivic(w);assert.ok(completeCivic(w,adults[0],delivery(p,1)));assert.equal(w.civic!.reserves!.length,1);
});

test('real restart preserves exact receipts, funds, original batches and shared withdrawal allowance',()=>{
 const f=ready(),{w,adults,child,reserve:p}=f;table(f,adults[2]);const supplied=delivery(p,6);civic(f,adults[2],supplied);table(f,child);const a=take(f,p);assert.equal(completeCommons(w,child,a),null);const coins=totalCoins(w),stock=physical(w),store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();const restoredChild=restored.residents.find(r=>r.id===child.id)!,restoredSeller=restored.residents.find(r=>r.id===adults[2].id)!;
 assert.deepEqual(restored.civic!.reserves,w.civic!.reserves);assert.deepEqual(restored.food!.lots[reserveContainer(p.id)],w.food!.lots[reserveContainer(p.id)]);assert.equal(completeCivic(restored,restoredSeller,supplied),null);assert.equal(completeCommons(restored,restoredChild,a),null);assert.equal(totalCoins(restored),coins);assert.equal(physical(restored),stock);assert.equal(commonsFoodRemaining(restored,restoredChild),commonsFoodRemaining(w,child));
});

test('old worlds gain only an empty reserve collection without touching holdings, people, property or time',()=>{
 const {w}=fixture();delete w.civic!.reserves;const before=JSON.stringify({minute:w.minute,residents:w.residents,buildings:w.buildings,food:w.food,economy:w.economy,commons:w.commons,events:w.events});initializeCivic(w);assert.deepEqual(w.civic!.reserves,[]);assert.equal(JSON.stringify({minute:w.minute,residents:w.residents,buildings:w.buildings,food:w.food,economy:w.economy,commons:w.commons,events:w.events}),before);initializeCivic(w);assert.deepEqual(w.civic!.reserves,[]);
});

test('food estimates stay local, count one real lot once and reject expiry before pickup or a blocked table',()=>{
 const f=ready(),{w,adults,child,reserve:p}=f;for(const r of adults)r.inventory={};adults[2].inventory.turnip=1;initializeFood(w);table(f,adults[2]);civic(f,adults[2],delivery(p,1));doorway(f,adults[2]);
 const report=residentFoodCoverage(w,child);assert.equal(report.reachableNutrition,20);assert.match(report.sourceLabel!,/储备/);assert.equal(settlementFoodCoverage(w).uniqueNutrition,20);const before=JSON.stringify(w);residentFoodCoverage(w,child);assert.equal(JSON.stringify(w),before);
 child.at={x:1,y:1};assert.equal(commonsFoodOptions(w,child).length,0);assert.equal(residentFoodCoverage(w,child).reachableNutrition,0);const choices=commonsOpportunities(w,child);p.inventory.turnip=0;assert.deepEqual(commonsOpportunities(w,child),choices);p.inventory.turnip=1;doorway(f,child);p.expiresAt=w.minute+1;assert.equal(residentFoodCoverage(w,child).reachableNutrition,0);assert.equal(hasTimelyCommonsFood(w,child),false);
 p.expiresAt=w.minute+DAY;const layout=roomLayout(w,f.hall);for(let x=1;x<layout.width-1;x++)w.residents.push({...structuredClone(child),id:'blocked-reserve:'+x,status:'dead',inside:f.hall.id,roomAt:{x,y:9},body:{reservedBy:null,carriedBy:null,storedAt:f.hall.id}});assert.equal(residentFoodCoverage(w,child).reachableNutrition,0);assert.equal(hasTimelyCommonsFood(w,child),false);
 const a=take(f,p);assert.equal(submitPlan(w,{id:'blocked-reserve-withdrawal',actorId:child.id,actorRevision:child.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人尝试取粮',actions:[a]}).ok,true);stepWorld(w,10);assert.match(child.lastFailure!,/室内.*不可达/);assert.equal(child.inventory.turnip,undefined);assert.equal(p.inventory.turnip,1);
});

test('child supply, forged policy fields and tampered menu prices cannot acquire extra authority',()=>{
 const f=ready(),{w,child,reserve:p}=f;table(f,child);child.inventory.turnip=3;initializeFood(w);assert.match(completeCivic(w,child,delivery(p))!,/不能处理/);
 const g=fixture(),menu=decisionChoices(decisionContext(g.w,g.adults[0])),choice=menu.find(o=>o.action.type==='civic'&&o.action.operation==='propose'&&o.action.measure.kind==='foodReserve')!;
 for(const bad of [{quantity:0},{quantity:201},{dailyNutrition:201},{unitPrice:0},{suppliesBudget:-1},{durationDays:29},{item:'seed'}])assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,...bad}),menu));
 const seller=f.adults[2],supplyMenu=civicOpportunities(w,seller),supply=supplyMenu.find(o=>o.action.type==='civic'&&o.action.operation==='supplyReserve')!;assert.ok(supply);assert.throws(()=>parseChoice(JSON.stringify({choice:supply.id,unitPrice:100}),supplyMenu));
});

test('observer ledger is read-only, escapes names and separates reserve holdings from public stock',()=>{
 const f=ready(),{w,adults,hall,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p));hall.name='<img src=x onerror=alert(1)>';adults[2].name='<script>bad()</script>';const before=JSON.stringify(w),html=financePanel(w);assert.equal(JSON.stringify(w),before);assert.match(html,/公共储备粮/);assert.match(html,/累计入库 3 \/ 12/);assert.match(html,/尚余预留款 27/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img src=x/);assert.equal(publicBalance(w),3);
});


test('unchanged formal nine-person founding world can vote, deliver and receive a real reserve through normal actions',()=>{
 const w=createFrontierWorld();w.clock.paused=false;initializeCivic(w);initializeCommons(w);initializeRooms(w);initializeForeignTrade(w);advancePublicDuties(w);initializeFood(w);
 const identities=w.residents.map(r=>r.id),buildings=structuredClone(w.buildings),coins=totalCoins(w),stock=physical(w),hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!,voters=w.residents.filter(r=>w.minute-r.bornAt>=18*YEAR),proposer=voters[0];
 assert.equal(identities.length,9);run(w,proposer,{type:'move',to:{...hall.door}});run(w,proposer,{type:'civic',operation:'donate',buildingId:hall.id,amount:10});
 const pick=(r:Resident,predicate:(a:Action)=>boolean)=>{for(let i=0;i<30;i++){const choices=decisionChoices(decisionContext(w,r)),choice=choices.find(o=>predicate(o.action));if(choice)return {choices,choice};run(w,r,{type:'wait',minutes:30});}throw new Error('normal rotating menu must expose choice');};
 const {choices:menu,choice}=pick(proposer,a=>a.type==='civic'&&a.operation==='propose'&&a.measure.kind==='foodReserve'&&a.measure.item==='turnip');run(w,proposer,parseChoice(JSON.stringify({choice:choice.id,quantity:5,unitPrice:2,suppliesBudget:10,dailyNutrition:40,durationDays:2}),menu).actions[0]);const proposal=w.civic!.proposals.at(-1)!;
 for(const voter of voters){if(proposal.status!=='open')break;run(w,voter,{type:'move',to:{...hall.door}});const {choice:vote}=pick(voter,a=>a.type==='civic'&&a.operation==='vote'&&a.proposalId===proposal.id&&a.accept);run(w,voter,vote.action);}
 assert.equal(proposal.status,'approved');const p=w.civic!.reserves![0],supplier=proposer;const {choice:supply}=pick(supplier,a=>a.type==='civic'&&a.operation==='supplyReserve'&&a.reserveId===p.id);run(w,supplier,supply.action);
 const receiver=voters[1];const {choice:take}=pick(receiver,a=>a.type==='commons'&&a.operation==='takeFood'&&a.reserveId===p.id);const before=receiver.inventory.turnip!;run(w,receiver,take.action);assert.equal(receiver.inventory.turnip,before+1);assert.equal(p.withdrawn,1);assert.equal(publicBalance(w),2);assert.equal(totalCoins(w),coins);assert.equal(physical(w),stock);assert.deepEqual(w.residents.map(r=>r.id),identities);assert.deepEqual(w.buildings.map(b=>({id:b.id,ownerId:b.ownerId,residents:b.residents,door:b.door})),buildings.map(b=>({id:b.id,ownerId:b.ownerId,residents:b.residents,door:b.door})));
});

test('expiring and revoting the same-site mandate never clears recent personal food receipts',()=>{
 const f=ready(),{w,adults,child,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p,3));w.minute=p.expiresAt-1;table(f,child);assert.equal(completeCommons(w,child,take(f,p)),null);assert.equal(completeCommons(w,child,take(f,p)),null);w.minute++;advanceCivic(w);
 assert.equal(approve(f,measure(f,{quantity:1,suppliesBudget:0,dailyNutrition:40})).status,'approved');const next=w.civic!.reserves!.at(-1)!;table(f,adults[0]);civic(f,adults[0],delivery(next,1,'openReserve'));assert.equal(next.inventory.turnip,1);assert.match(commonsReason(w,child,take(f,next))!,/额度/);assert.equal(w.commons!.receipts.filter(r=>r.residentId===child.id).length,2);assert.equal(publicBalance(w),1);
});

test('visitor collection grants no residency, infant feeding, property or unexpressed consent powers',()=>{
 const f=ready(),{w,adults,child,hall,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p));child.residency='visitor';table(f,child);assert.equal(completeCommons(w,child,take(f,p)),null);assert.equal(child.residency,'visitor');assert.equal(child.homeId,null);assert.deepEqual(child.guardianIds,[]);assert.equal(hall.ownerId,'commons');
 child.canExpress=false;assert.match(commonsReason(w,child,take(f,p))!,/不能独立/);child.canExpress=true;child.bornAt=w.minute-5*YEAR;assert.match(commonsReason(w,child,take(f,p))!,/不能独立/);assert.equal(p.withdrawn,1);child.bornAt=w.minute-6*YEAR;const atSix=take(f,p);child.canDecide=false;assert.match(completeCommons(w,child,atSix)!,/不能独立/);assert.equal(p.withdrawn,1);child.canDecide=true;assert.equal(completeCommons(w,child,atSix),null);assert.equal(p.withdrawn,2);
});


test('reserve to charter and unequal voted allowances subtract all earlier withdrawals rather than adding caps',()=>{
 const f=ready({dailyNutrition:60}),{w,adults,child,hall,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p,6));w.civic!.stores[hall.id]={turnip:2};w.economy!.treasuryStock.turnip!+=2;initializeFood(w);table(f,child);
 for(let i=0;i<3;i++)assert.equal(completeCommons(w,child,take(f,p)),null);const charter:CommonsAction={type:'commons',operation:'takeFood',buildingId:hall.id,item:'turnip',receiptId:commonsReceiptId(w,child)};assert.match(commonsReason(w,child,charter)!,/额度/);
 const other={...structuredClone(p),id:'unequal-cap',inventory:{turnip:2},dailyNutrition:70};w.civic!.reserves!.push(other);w.economy!.treasuryStock.turnip!+=2;initializeFood(w);assert.match(commonsReason(w,child,take(f,other))!,/额度/);other.dailyNutrition=80;assert.equal(completeCommons(w,child,take(f,other)),null);assert.match(commonsReason(w,child,take(f,p))!,/额度/);assert.match(commonsReason(w,child,take(f,other))!,/额度/);assert.equal(commonsFoodRemaining(w,child),0);
});

test('released shelf leftovers follow existing charter access and cannot evade a surviving service budget',()=>{
 for(const protectedStock of [false,true]){const f=ready(),{w,adults,child,hall,reserve:p}=f;table(f,adults[2]);civic(f,adults[2],delivery(p));w.minute=p.expiresAt;if(protectedStock)w.civic!.budgets.push({id:'still-service',proposalId:'old',buildingId:hall.id,kind:'service',startsAt:w.minute-DAY,expiresAt:w.minute+DAY,status:'active',wage:1,wageLimit:1,suppliesLimit:10,paidWages:0,spentSupplies:0,wageAccount:'w',supplyAccount:'s',prices:{},purchased:{}});advanceCivic(w);table(f,child);const a:CommonsAction={type:'commons',operation:'takeFood',buildingId:hall.id,item:'turnip',receiptId:commonsReceiptId(w,child)};
 if(protectedStock){assert.match(completeCommons(w,child,a)!,/预算/);assert.equal(w.civic!.stores[hall.id].turnip,3);}else{assert.equal(completeCommons(w,child,a),null);assert.equal(w.civic!.stores[hall.id].turnip,2);assert.equal(child.inventory.turnip,1);}publicBalance(w);}
});
