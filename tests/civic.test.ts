import {atWorkstation} from './helpers/workspaces.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {CivicAction,CivicMeasure} from '../src/shared/civic.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {initializeCivic,advanceCivic,completeCivic,civicReason,hasPublicServiceSupplies} from '../src/world/civic.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {civicOpportunities,parseCivicChoice} from '../src/server/civic-opportunities.js';
import {advancePublicDuties,completeDuty,dutyReason} from '../src/world/public-duties.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {recordDeath} from '../src/world/life.js';
import {parseChoice} from '../src/server/affordances.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createFormalWorld();w.clock.paused=false;w.minute=580;
 const people=w.residents.filter(p=>w.minute-p.bornAt>18*YEAR).slice(0,3);
 w.residents=people;
 const hall=w.buildings.find(b=>b.ownerId==='commons'&&b.kind==='lodge')!;
 for(const r of people){r.at={...hall.door};r.inside=null;r.coins=200;r.inventory={turnip:20,meal:10,water:20,wood:12,stone:8};r.health=90;r.energy=90;r.hunger=60;r.skills.care=2;r.knownBuildings.push(hall.id);}
 initializeCivic(w);initializeForeignTrade(w);
 return {w,people,hall};
}
function execute(w:World,r:Resident,a:CivicAction){assert.equal(completeCivic(w,r,a),null);}
function approve(w:World,people:Resident[],hallId:string,measure:CivicMeasure){
 execute(w,people[0],{type:'civic',operation:'propose',buildingId:hallId,measure});
 const p=w.civic!.proposals.at(-1)!;
 execute(w,people[0],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 execute(w,people[1],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 return p;
}
function budgetFixture(){
 const f=fixture();
 execute(f.w,f.people[0],{type:'civic',operation:'donate',buildingId:f.hall.id,amount:100});
 const proposal=approve(f.w,f.people,f.hall.id,{kind:'service',buildingId:f.hall.id,wagePerService:3,wageBudget:30,suppliesBudget:30,durationDays:7});
 assert.equal(proposal.status,'approved');
 return {...f,budget:f.w.civic!.budgets.at(-1)!};
}
function schedule(w:World,r:Resident,action:Action){
  atWorkstation(w,r,action);
 assert.equal(submitPlan(w,{id:`civic-test:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择',actions:[action]}).ok,true);
}

test('public spending requires separate adult votes and finite cash, with no donor or proposer implied vote',()=>{
 const {w,people,hall}=fixture();const starting=totalCoins(w);
 execute(w,people[0],{type:'civic',operation:'donate',buildingId:hall.id,amount:50});
 const measure:CivicMeasure={kind:'service',buildingId:hall.id,wagePerService:3,wageBudget:30,suppliesBudget:30,durationDays:7};
 execute(w,people[0],{type:'civic',operation:'propose',buildingId:hall.id,measure});
 const p=w.civic!.proposals[0];assert.deepEqual(p.votes,{});assert.equal(w.civic!.budgets.length,0);
 execute(w,people[0],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 assert.equal(p.status,'open');assert.equal(w.economy!.treasury,50);
 assert.ok(civicReason(w,people[0],{type:'civic',operation:'vote',proposalId:p.id,accept:true}));
 execute(w,people[1],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 assert.equal(p.status,'unfunded');assert.equal(w.civic!.budgets.length,0);assert.equal(w.economy!.treasury,50);assert.equal(totalCoins(w),starting);
});

test('fixed voter roll, fair rejection option and quorum prevent one eager person from committing the town',()=>{
 const {w,people,hall}=fixture();
 execute(w,people[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'salesTax',basisPoints:500,durationDays:14}});
 const p=w.civic!.proposals[0];
 const options=civicOpportunities(w,people[1]).filter(c=>c.action.type==='civic'&&c.action.operation==='vote');
 assert.deepEqual(options.map(c=>(c.action as Extract<CivicAction,{operation:'vote'}>).accept),[true,false]);
 execute(w,people[0],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 people[2].residency='visitor';
 assert.ok(civicReason(w,people[2],{type:'civic',operation:'vote',proposalId:p.id,accept:true}));
 w.minute=p.closesAt;advanceCivic(w);
 assert.equal(p.status,'rejected');assert.equal(w.civic!.salesTax,null);
});

test('notice copies allow a resident to vote at another real public board without travelling to the proposer',()=>{
 const {w,people,hall}=fixture();
 execute(w,people[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'salesTax',basisPoints:500,durationDays:14}});
 const p=w.civic!.proposals[0],other=w.buildings.find(b=>b.ownerId==='commons'&&b.kind==='clinic')!;
 people[1].at={...other.door};
 assert.ok(civicOpportunities(w,people[1]).some(o=>o.action.type==='civic'&&o.action.operation==='vote'));
 execute(w,people[1],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 assert.equal(p.votes[people[1].id],true);
 people[2].at={x:0,y:0};assert.ok(civicReason(w,people[2],{type:'civic',operation:'vote',proposalId:p.id,accept:true}));
});

test('approved budgets escrow only existing money and expire with exact refund across saved restart',()=>{
 const {w,budget}=budgetFixture();const coins=totalCoins(w);
 assert.equal(w.economy!.treasury,40);assert.equal(accountBalance(w,budget.wageAccount),30);assert.equal(accountBalance(w,budget.supplyAccount),30);
 const saved=structuredClone(w);saved.minute=budget.expiresAt;advanceCivic(saved);advanceCivic(saved);
 assert.equal(saved.economy!.treasury,100);assert.equal(saved.civic!.budgets[0].status,'expired');assert.equal(totalCoins(saved),coins);
});

test('public procurement really pays a consenting supplier and reserves goods at the specified place',()=>{
 const {w,people,budget,hall}=budgetFixture(),seller=people[2],before=seller.coins;
 execute(w,seller,{type:'civic',operation:'supply',budgetId:budget.id,item:'turnip',quantity:3});
 assert.equal(seller.coins,before+6);assert.equal(seller.inventory.turnip,17);assert.equal(w.civic!.stores[hall.id].turnip,3);assert.equal(w.economy!.treasuryStock.turnip,3);
 assert.equal(budget.spentSupplies,6);assert.equal(accountBalance(w,budget.supplyAccount),24);
 assert.ok(civicReason(w,seller,{type:'civic',operation:'supply',budgetId:budget.id,item:'wood',quantity:1}));
 seller.at={x:0,y:0};assert.ok(civicReason(w,seller,{type:'civic',operation:'supply',budgetId:budget.id,item:'turnip',quantity:1}));
});

test('paid public work needs a real worker, purchased supplies and completed consented service; idling and repeats earn nothing',()=>{
 const {w,people,budget,hall}=budgetFixture(),[worker,client,seller]=people;
 execute(w,seller,{type:'civic',operation:'supply',budgetId:budget.id,item:'turnip',quantity:3});
 execute(w,seller,{type:'civic',operation:'supply',budgetId:budget.id,item:'water',quantity:3});
 advancePublicDuties(w);const shift=w.duties!.shifts.find(s=>s.buildingId===hall.id&&s.start===600)!;
 assert.ok(shift.funding);assert.equal(shift.funding.reserved,12);assert.equal(hasPublicServiceSupplies(w,shift),true);
 worker.inventory={};const coins=worker.coins,total=totalCoins(w);
 assert.equal(completeDuty(w,worker,{type:'publicDuty',operation:'claim',shiftId:shift.id}),null);
 w.minute=600;atWorkstation(w,worker,{type:'publicDuty',operation:'attend',shiftId:shift.id});assert.equal(completeDuty(w,worker,{type:'publicDuty',operation:'attend',shiftId:shift.id}),null);
 stepWorld(w,2);assert.equal(worker.coins,coins);
 schedule(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id});stepWorld(w,20);
 assert.equal(client.lastFailure,null);assert.equal(shift.served,1);assert.equal(worker.coins,coins+3);assert.deepEqual(worker.inventory,{});
 assert.equal(w.civic!.stores[hall.id].turnip,1);assert.equal(w.civic!.stores[hall.id].water,2);assert.equal(shift.assignments[0].wagesPaid,3);
 assert.ok(completeDuty(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id}));assert.equal(worker.coins,coins+3);assert.equal(totalCoins(w),total);
});

test('no-show wage promise and unfilled windows return reserved payroll without paying the missing worker',()=>{
 const {w,people,budget,hall}=budgetFixture();
 execute(w,people[2],{type:'civic',operation:'supply',budgetId:budget.id,item:'turnip',quantity:3});
 execute(w,people[2],{type:'civic',operation:'supply',budgetId:budget.id,item:'water',quantity:3});
 advancePublicDuties(w);const shift=w.duties!.shifts.find(s=>s.buildingId===hall.id&&s.start===600)!;
 const worker=people[0],coins=worker.coins,total=totalCoins(w);
 assert.equal(completeDuty(w,worker,{type:'publicDuty',operation:'claim',shiftId:shift.id}),null);
 w.minute=616;advancePublicDuties(w);assert.equal(shift.workerId,null);assert.equal(worker.coins,coins);
 w.minute=shift.end;advancePublicDuties(w);advancePublicDuties(w);
 assert.equal(accountBalance(w,shift.funding!.wageAccount),0);assert.equal(shift.funding!.closed,true);assert.equal(worker.coins,coins);assert.equal(totalCoins(w),total);
});

test('public repair is a separately approved material-consuming job and has no phantom wages on replay',()=>{
 const {w,people,hall}=fixture();hall.condition=70;
 execute(w,people[0],{type:'civic',operation:'donate',buildingId:hall.id,amount:60});
 const p=approve(w,people,hall.id,{kind:'repair',buildingId:hall.id,wage:15,suppliesBudget:20,durationDays:7});
 const b=w.civic!.budgets.find(b=>b.id===p.budgetId)!;
 execute(w,people[2],{type:'civic',operation:'supply',budgetId:b.id,item:'wood',quantity:6});
 execute(w,people[2],{type:'civic',operation:'supply',budgetId:b.id,item:'stone',quantity:4});
 const before=people[1].coins; schedule(w,people[1],{type:'civic',operation:'repair',budgetId:b.id});
 stepWorld(w,119);assert.equal(people[1].coins,before);assert.equal(hall.condition,70);
 stepWorld(w,1);assert.equal(people[1].coins,before+15);assert.equal(hall.condition,100);assert.equal(b.status,'completed');
 assert.equal(w.economy!.treasuryStock.wood,0);assert.equal(w.economy!.treasuryStock.stone,0);
 assert.ok(completeCivic(w,people[1],{type:'civic',operation:'repair',budgetId:b.id}));assert.equal(people[1].coins,before+15);
});

test('residents can propose their own wages, procurement prices and term; adopted quotes stay immutable',()=>{
 const {w,people,hall}=fixture();
 execute(w,people[0],{type:'civic',operation:'donate',buildingId:hall.id,amount:120});
 const choice=civicOpportunities(w,people[0]).find(c=>c.action.type==='civic'&&c.action.operation==='propose'&&c.action.measure.kind==='service')!;
 const proposal=parseCivicChoice(choice.action as CivicAction,{wagePerService:4,wageBudget:40,suppliesBudget:50,durationDays:3,prices:{turnip:5,water:2}});
 assert.equal(proposal.operation,'propose');
 execute(w,people[0],proposal);
 const p=w.civic!.proposals[0];
 assert.equal(p.measure.kind,'service');
 if(p.measure.kind!=='service')throw new Error('wrong measure');
 assert.equal(p.measure.wagePerService,4);assert.equal(p.measure.prices!.turnip,5);
 execute(w,people[1],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 execute(w,people[2],{type:'civic',operation:'vote',proposalId:p.id,accept:true});
 const b=w.civic!.budgets[0],before=people[2].coins;
 execute(w,people[2],{type:'civic',operation:'supply',budgetId:b.id,item:'turnip',quantity:2});
 assert.equal(people[2].coins,before+10);assert.equal(b.prices.turnip,5);assert.equal(b.expiresAt-b.startsAt,3*DAY);
 assert.throws(()=>parseCivicChoice(choice.action as CivicAction,{prices:{seed:2}}));
 assert.throws(()=>parseCivicChoice(choice.action as CivicAction,{wagePerService:20,wageBudget:1}));
});

test('a ruined public building can receive a repair mandate at its exterior board',()=>{
 const {w,people,hall}=fixture();hall.condition=0;
 execute(w,people[0],{type:'civic',operation:'donate',buildingId:hall.id,amount:60});
 const p=approve(w,people,hall.id,{kind:'repair',buildingId:hall.id,wage:15,suppliesBudget:20,durationDays:7});
 const b=w.civic!.budgets.find(b=>b.id===p.budgetId)!;assert.ok(b);
 execute(w,people[2],{type:'civic',operation:'supply',budgetId:b.id,item:'wood',quantity:6});
 execute(w,people[2],{type:'civic',operation:'supply',budgetId:b.id,item:'stone',quantity:4});
 schedule(w,people[1],{type:'civic',operation:'repair',budgetId:b.id});stepWorld(w,120);
 assert.equal(hall.condition,30);assert.equal(b.status,'completed');
});

test('the actual model parser allows own budget terms but cannot edit another person’s ballot contract',()=>{
 const {w,people}=fixture();
 const option=civicOpportunities(w,people[0]).find(c=>c.action.type==='civic'&&c.action.operation==='propose'&&c.action.measure.kind==='service')!;
 const action=parseChoice(JSON.stringify({choice:option.id,wagePerService:8,wageBudget:80,suppliesBudget:75,durationDays:5,prices:{turnip:4,meal:7,water:2}}),[option]).actions[0];
 assert.equal(action.type,'civic');
 if(action.type!=='civic'||action.operation!=='propose'||action.measure.kind!=='service')throw new Error('invalid parsed action');
 assert.equal(action.measure.wageBudget,80);assert.equal(action.measure.prices!.meal,7);
 execute(w,people[0],action);
 const vote=civicOpportunities(w,people[1]).find(c=>c.action.type==='civic'&&c.action.operation==='vote')!;
 assert.throws(()=>parseChoice(JSON.stringify({choice:vote.id,wageBudget:1}),[vote]));
 assert.throws(()=>parseChoice(JSON.stringify({choice:option.id,buildingId:'private-house'}),[option]));
});

test('a final paid service at the budget expiry and shift close pays once and returns every remaining pledge',()=>{
 for(const reverse of [false,true]){
  const {w,people,budget,hall}=budgetFixture(),[worker,client,seller]=people;
  execute(w,seller,{type:'civic',operation:'supply',budgetId:budget.id,item:'turnip',quantity:3});
  execute(w,seller,{type:'civic',operation:'supply',budgetId:budget.id,item:'water',quantity:3});
  budget.expiresAt=690;advancePublicDuties(w);
  const shift=w.duties!.shifts.find(s=>s.buildingId===hall.id&&s.start===600)!;
  assert.ok(shift.funding);
  assert.equal(completeDuty(w,worker,{type:'publicDuty',operation:'claim',shiftId:shift.id}),null);
  w.minute=600;atWorkstation(w,worker,{type:'publicDuty',operation:'attend',shiftId:shift.id});assert.equal(completeDuty(w,worker,{type:'publicDuty',operation:'attend',shiftId:shift.id}),null);
  const before=worker.coins,total=totalCoins(w);w.minute=670;
  schedule(w,worker,{type:'wait',minutes:20});schedule(w,client,{type:'publicDuty',operation:'receive',shiftId:shift.id});
  if(reverse)w.residents.reverse();stepWorld(w,20);
  assert.equal(client.lastFailure,null);assert.equal(worker.coins,before+3);assert.equal(shift.served,1);
  assert.equal(budget.status,'expired');assert.equal(shift.status,'finished');assert.equal(w.economy!.treasury,88);
  assert.equal(accountBalance(w,budget.wageAccount),0);assert.equal(accountBalance(w,budget.supplyAccount),0);
  assert.equal(accountBalance(w,shift.funding!.wageAccount),0);assert.equal(totalCoins(w),total);
  advanceCivic(w);advancePublicDuties(w);assert.equal(worker.coins,before+3);assert.equal(w.economy!.treasury,88);
 }
});

test('a public workshop exterior maintenance sign supports repair proposals without becoming a kitchen job',()=>{
 const {w,people}=fixture();
 const workshop=w.buildings.find(b=>b.ownerId==='commons'&&b.kind==='workshop')!;assert.ok(workshop);
 workshop.condition=0;for(const r of people)r.at={...workshop.door};
 const options=civicOpportunities(w,people[0]);
 assert.ok(options.some(o=>o.action.type==='civic'&&o.action.operation==='propose'&&o.action.measure.kind==='repair'&&o.action.measure.buildingId===workshop.id));
 assert.ok(!options.some(o=>o.action.type==='civic'&&o.action.operation==='propose'&&o.action.measure.kind==='service'));
 execute(w,people[0],{type:'civic',operation:'donate',buildingId:workshop.id,amount:60});
 const p=approve(w,people,workshop.id,{kind:'repair',buildingId:workshop.id,wage:15,suppliesBudget:20,durationDays:7});
 assert.equal(p.status,'approved');
});

function repairFixture(){
 const f=fixture();f.hall.condition=70;
 execute(f.w,f.people[0],{type:'civic',operation:'donate',buildingId:f.hall.id,amount:60});
 const p=approve(f.w,f.people,f.hall.id,{kind:'repair',buildingId:f.hall.id,wage:15,suppliesBudget:20,durationDays:7});
 const budget=f.w.civic!.budgets.find(b=>b.id===p.budgetId)!;
 execute(f.w,f.people[2],{type:'civic',operation:'supply',budgetId:budget.id,item:'wood',quantity:6});
 execute(f.w,f.people[2],{type:'civic',operation:'supply',budgetId:budget.id,item:'stone',quantity:4});
 return {...f,budget};
}

test('concurrent repair choices grant the site to the first actual worker and stop the other before any labour or pay',()=>{
 const {w,people,budget,hall}=repairFixture(),[first,second]=people;
 const money=[first.coins,second.coins],total=totalCoins(w);
 schedule(w,first,{type:'civic',operation:'repair',budgetId:budget.id});
 schedule(w,second,{type:'civic',operation:'repair',budgetId:budget.id});
 stepWorld(w,1);assert.equal(budget.repairWorkerId,first.id);assert.equal(first.activity!.remaining,119);
 assert.equal(second.activity,null);assert.match(second.lastFailure!,/另一位居民/);assert.equal(second.coins,money[1]);
 stepWorld(w,119);assert.equal(hall.condition,100);assert.equal(first.coins,money[0]+15);assert.equal(second.coins,money[1]);
 assert.equal(budget.repairWorkerId,undefined);assert.equal(totalCoins(w),total);
});

test('an interrupted repair releases its work claim and pays no unfinished wage, so another resident can freely take over',()=>{
 for(const ending of ['death','departure','abandon'] as const){
  const {w,people,budget,hall}=repairFixture(),[first,second]=people;
  const before=first.coins,secondBefore=second.coins,total=totalCoins(w);
  schedule(w,first,{type:'civic',operation:'repair',budgetId:budget.id});stepWorld(w,5);
  assert.equal(budget.repairWorkerId,first.id);assert.equal(hall.condition,70);
  if(ending==='death')recordDeath(w,first);else if(ending==='departure')first.residency='outside';else{first.activity=null;first.plan=null;}
  advanceCivic(w);assert.equal(budget.repairWorkerId,undefined);
  assert.equal(ending==='death'?w.estates.find(e=>e.personId===first.id)!.coins:first.coins,before);
  schedule(w,second,{type:'civic',operation:'repair',budgetId:budget.id});stepWorld(w,120);
  assert.equal(second.lastFailure,null);assert.equal(second.coins,secondBefore+15);assert.equal(hall.condition,100);
  assert.equal(budget.paidWages,15);assert.equal(totalCoins(w),total);
 }
});

test('one or two adult electors cannot establish new public spending or taxes, but can use their own money',()=>{
 for(const n of [1,2]){const {w,people,hall}=fixture();w.residents=people.slice(0,n);const p=w.residents[0];
  assert.ok(civicReason(w,p,{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'salesTax',basisPoints:300,durationDays:2}}));
  assert.ok(completeCivic(w,p,{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'repair',buildingId:hall.id,wage:2,suppliesBudget:10,durationDays:1}}));
  execute(w,p,{type:'civic',operation:'donate',buildingId:hall.id,amount:1});assert.equal(w.economy!.treasury,1);assert.equal(w.civic!.proposals.length,0);
 }
});
test('incapacity preserves the original civic roll and arbitrary saved ballots cannot manufacture a quorum',()=>{
 const {w,people,hall}=fixture();people[2].canDecide=false;
 execute(w,people[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'salesTax',basisPoints:300,durationDays:2}});const p=w.civic!.proposals[0];assert.equal(p.electorate.length,3);
 execute(w,people[0],{type:'civic',operation:'vote',proposalId:p.id,accept:true});p.votes['not-an-elector']=true;(p.votes as Record<string,unknown>)[people[1].id]='yes';p.electorate.push(people[0].id);w.minute=p.closesAt;advanceCivic(w);assert.equal(p.status,'rejected');assert.equal(w.civic!.salesTax,null);
});
test('legacy single-person proposals cannot approve while already funded finite budgets survive population loss',()=>{
 const {w,people,hall}=fixture();execute(w,people[0],{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'salesTax',basisPoints:300,durationDays:2}});const p=w.civic!.proposals[0];p.electorate=[people[0].id];p.votes={[people[0].id]:true};w.minute=p.closesAt;advanceCivic(w);assert.equal(p.status,'rejected');
 const b=budgetFixture();b.w.residents=b.people.slice(0,1);const balance=accountBalance(b.w,b.budget.supplyAccount);advanceCivic(b.w);assert.equal(b.budget.status,'active');assert.equal(accountBalance(b.w,b.budget.supplyAccount),balance);b.w.minute=b.budget.expiresAt;advanceCivic(b.w);assert.equal(b.budget.status,'expired');assert.equal(b.w.economy!.treasury,100);
});
