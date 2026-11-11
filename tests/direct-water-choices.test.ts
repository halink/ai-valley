import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,DecisionContext,FormalOpportunity,Resident,World} from '../src/shared/types.js';
import type {WaterVessel} from '../src/shared/water-supply.js';
import {focusNames} from '../src/shared/agency.js';
import {createWorld} from '../src/world/seed.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeWaterSupply,waterDrunkToday,waterSupplyReason} from '../src/world/water-supply.js';
import {waterSupplyOpportunities} from '../src/server/water-supply-opportunities.js';
import {decisionChoices,decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {directWaterChoice} from '../src/server/direct-water-choices.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';
import {roomLayout} from '../src/shared/rooms.js';

const drinks=(a:Action)=>a.type==='waterSupply'&&(a.operation==='drink'||a.operation==='drinkPublic');
function fixture(){
 const w=createWorld(5401),r=w.residents[0];w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:32,tiles:Array(40*32).fill('grass'),entrance:{x:0,y:12}};w.resources=[];w.plots=[];w.graves=[];
 const hall=w.buildings.find(b=>b.kind==='lodge')!;hall.at={x:16,y:6};hall.width=8;hall.height=6;hall.door={x:20,y:12};hall.residents=[];w.buildings=[hall];w.residents=[r];
 Object.assign(r,{at:{...hall.door},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{berry:2,wood:20,water:3},bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:0,knownBuildings:[hall.id],knownResources:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null});
 initializeCivic(w);initializeRooms(w);initializeWaterSupply(w);
 const vessel:WaterVessel={id:'direct-water-personal',ownerId:r.id,buildingId:null,capacity:6,amount:3,quality:'safe',createdAt:w.minute};w.waterSupply!.vessels.push(vessel);
 return {w,r,hall,vessel};
}
function crowd(c:DecisionContext){
 for(let i=0;i<160;i++){
  c.formal!.opportunities.push({id:`water-menu-work-${i}`,label:`Synthetic scheduled work ${i}`,action:{type:'employment',operation:'work',contractId:`work-${i}`}});
  c.formal!.opportunities.push({id:`water-menu-control-${i}`,label:`Synthetic stop ${i}`,action:{type:'agency',operation:'disarm',routineId:`routine-${i}`}});
 }
}
const signature=(c:ActionChoice)=>JSON.stringify(c.action);
function execute(w:World,r:Resident,choice:ActionChoice,menu:ActionChoice[]){
 const d=parseChoice(JSON.stringify({choice:choice.id}),menu),p={id:`direct-water:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d};
 assert.equal(submitPlan(w,p).ok,true);let ticks=100;while(r.plan||r.activity){assert.ok(ticks--);stepWorld(w,1);}return p;
}

test('a legal own drink survives every crowded focus without enlarging the 56-row ordinary budget',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);crowd(c);
 for(const focus of [null,...Object.keys(focusNames)] as Array<keyof typeof focusNames|null>){
  c.actor.agency={focus,goals:[],routines:[],nextSerial:1};
  for(let i=0;i<16;i++){
   c.minute=600+i*30;const before=structuredClone(c),all=buildChoices(c),rows=focusedChoices(c,all),p=prepareModelDecision(c,undefined,GLM_MODEL);
   assert.equal(rows.length,56);assert.ok(rows.some(x=>drinks(x.action)),`${focus} minute ${c.minute}`);
   assert.ok(p.choices.some(x=>drinks(x.action)));assert.ok(p.choices.filter(x=>x.action.type==='waterSupply').length<=2);
   for(const choice of p.choices)assert.ok(p.messages[0].content.includes(choice.id+'. '+choice.label));
   assert.deepEqual(c,before);assert.deepEqual(prepareModelDecision(c,undefined,GLM_MODEL),p);
  }
 }
});

test('a locally eligible donated public drink survives saturation without a personal vessel',()=>{
 const {w,r,hall,vessel}=fixture();vessel.ownerId='commons';vessel.buildingId=hall.id;vessel.donatedBy='actual-donor';vessel.donatedAt=w.minute;
 const c=decisionContext(w,r);crowd(c);const menu=decisionChoices(c),drink=menu.find(x=>x.action.type==='waterSupply'&&x.action.operation==='drinkPublic');assert.ok(drink);
 const before=vessel.amount;execute(w,r,drink,menu);assert.equal(r.lastFailure,null);assert.equal(vessel.amount,before-1);assert.equal(waterDrunkToday(w,r.id),1);assert.equal('thirst'in r,false);
});

test('rest, food, urgent care, consent pairs and live stops retain their safety slots beside self drinking',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);crowd(c);
 const urgent:FormalOpportunity[]=[
  {id:'water-test.sleep',label:'Synthetic available bed',action:{type:'sleep',minutes:120}},
  {id:'water-test.evacuate',label:'Current evacuation',action:{type:'health',operation:'rescue',targetId:'child',evacuationDangerId:'flood'}},
  {id:'water-test.rescueMeal',label:'Current emergency meal',action:{type:'emergencyCare',operation:'rescueMeal',childId:'child'}},
  ...(['acceptRescue','declineRescue','cancelRescue'] as const).map(operation=>({id:'water-test.'+operation,label:operation,action:{type:'health' as const,operation,offerId:'own-offer'}})),
  ...(['approveHandoff','declineHandoff'] as const).map(operation=>({id:'water-test.'+operation,label:operation,action:{type:'longCare' as const,operation,replacementId:'own-handoff'}})),
  {id:'care.stop.water-test',label:'Stop this actual care',action:{type:'respond',proposalId:'own-care',accept:false}},
 ];
 c.formal!.opportunities.push(...urgent);
 for(let i=0;i<8;i++){
  c.minute=600+i*30;const rows=decisionChoices(c);assert.ok(rows.some(x=>drinks(x.action)));
  for(const action of urgent)assert.ok(rows.some(x=>signature(x)===signature(action)),action.id);
  assert.ok(rows.some(x=>x.action.type==='eat'));assert.ok(rows.some(x=>x.action.type==='sleep'));assert.ok(rows.some(x=>x.action.type==='wait'));
  assert.ok(focusedChoices(c,buildChoices(c)).length<=56);
 }
});

test('empty, raw, foreign and undonated vessels or exhausted daily allowance never create direct drinking',()=>{
 for(const state of ['none','empty','fraction','raw','foreign','undonated','quota'] as const){
  const {w,r,hall,vessel}=fixture();
  if(state==='none')w.waterSupply!.vessels=[];
  if(state==='empty')vessel.amount=0;if(state==='fraction')vessel.amount=.5;if(state==='raw')vessel.quality='raw';if(state==='foreign')vessel.ownerId='someone-else';
  if(state==='undonated'){vessel.ownerId='commons';vessel.buildingId=hall.id;}
  if(state==='quota')for(let i=0;i<2;i++)w.waterSupply!.receipts.push({id:`old-drink-${i}`,actorId:r.id,recipientId:r.id,at:w.minute-DAY+1,operation:'drink',quantity:1,action:{type:'waterSupply',operation:'drink',receiptId:`old-drink-${i}`,vesselId:vessel.id}});
  const c=decisionContext(w,r);crowd(c);assert.ok(!decisionChoices(c).some(x=>drinks(x.action)),state);
 }
});

test('self drinking never bypasses child, capacity, transport or expression-only menu gates',()=>{
 for(const age of [0,1,5]){
  const {w,r}=fixture();r.bornAt=w.minute-age*YEAR;const c=decisionContext(w,r);crowd(c);assert.ok(!decisionChoices(c).some(x=>drinks(x.action)),String(age));
 }
 for(const ability of ['canDecide','canExpress'] as const){const {w,r}=fixture();r[ability]=false;assert.ok(!waterSupplyOpportunities(w,r).some(x=>drinks(x.action)));}
 for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','familyTravelling','passenger','aboard'] as const){
  const {w,r}=fixture(),c=decisionContext(w,r);crowd(c);c.formal![flag]=true;
  assert.ok(!decisionChoices(c).some(x=>drinks(x.action)),flag);
 }
 const {w,r}=fixture();r.bornAt=w.minute-6*YEAR;const c=decisionContext(w,r);crowd(c);assert.ok(decisionChoices(c).some(x=>drinks(x.action)));
});

test('shown drinking remains a choice and stale water cannot bypass completion validation or replay protection',()=>{
 const {w,r,vessel}=fixture(),c=decisionContext(w,r);crowd(c);const menu=decisionChoices(c),drink=menu.find(x=>drinks(x.action));assert.ok(drink);
 assert.equal(vessel.amount,3);assert.equal(waterDrunkToday(w,r.id),0);assert.equal(r.plan,null);
 vessel.amount=0;assert.ok(drink.action.type==='waterSupply'&&waterSupplyReason(w,r,drink.action));
 execute(w,r,drink,menu);assert.ok(r.lastFailure);assert.equal(vessel.amount,0);assert.equal(waterDrunkToday(w,r.id),0);
 vessel.amount=3;r.lastFailure=null;const fresh=decisionChoices(decisionContext(w,r)),own=fresh.find(x=>drinks(x.action))!;
 const p=execute(w,r,own,fresh);assert.equal(vessel.amount,2);assert.equal(waterDrunkToday(w,r.id),1);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!,actor=loaded.residents[0];assert.equal(submitPlan(loaded,p).ok,true);assert.equal(loaded.waterSupply!.vessels[0].amount,2);assert.equal(waterDrunkToday(loaded,actor.id),1);}finally{store.close();}
});

test('multiple legal self-drinks rotate once by stable identity, with at most two total ordinary supply rows',()=>{
 const {w,r,hall,vessel}=fixture();
 for(let i=0;i<4;i++)w.waterSupply!.vessels.push({...vessel,id:`own-water-${i}`});
 w.waterSupply!.vessels.push({...vessel,id:'public-water',ownerId:'commons',buildingId:hall.id,donatedBy:r.id,donatedAt:w.minute});
 const c=decisionContext(w,r);crowd(c);const all=buildChoices(c),before=all.slice(),seen=new Set<string>();
 for(let i=0;i<6;i++){
  c.minute=600+i*30;const choice=directWaterChoice(c,all)!;assert.ok(choice);seen.add(choice.id);
  assert.equal(directWaterChoice(c,[...all].reverse())?.id,choice.id);
  const rows=focusedChoices(c,all);assert.ok(rows.includes(choice));assert.ok(rows.filter(x=>x.action.type==='waterSupply').length<=2);assert.equal(rows.length,56);
 }
 assert.equal(seen.size,6);assert.deepEqual(all,before);
});

test('nearby production water or a known spring alone is not a new permission to drink',()=>{
 const {w,r}=fixture();w.waterSupply!.vessels=[];r.inventory.water=100;
 const source={id:'known-water',kind:'spring' as const,at:{x:21,y:12},amount:10,max:10,regrowthDays:0,lastHarvest:0};w.resources=[source];r.knownResources=[source.id];
 const c=decisionContext(w,r);crowd(c);const menu=decisionChoices(c);
 assert.ok(menu.some(x=>x.action.type==='gather'&&x.action.resourceId===source.id));assert.ok(!menu.some(x=>drinks(x.action)));assert.equal(r.inventory.water,100);assert.equal(source.amount,10);
});

test('a held plan and a competing public-table work claim are not unlocked by menu retention',()=>{
 {
  const {w,r,vessel}=fixture(),menu=decisionChoices(decisionContext(w,r)),drink=menu.find(x=>drinks(x.action))!;
  const definition=w.activeDefinitions['action/routine'];
  const held={id:'held-wait',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition,intention:'Wait by choice',actions:[{type:'wait' as const,minutes:30}]};assert.equal(submitPlan(w,held).ok,true);
  const before=structuredClone(r.plan),parsed=parseChoice(JSON.stringify({choice:drink.id}),menu),result=submitPlan(w,{id:'blocked-drink',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition,...parsed});
  assert.equal(result.ok,false);assert.match(result.error!,/尚未完成/);assert.deepEqual(r.plan,before);assert.equal(vessel.amount,3);
 }
 {
  const {w,r,hall,vessel}=fixture(),other=structuredClone(r);other.id='table-worker';other.name='Table worker';other.inventory={wood:10};w.residents.push(other);
  const at=roomLayout(w,hall).slots.find(s=>s.key==='table')!.at;
  for(const p of [r,other]){p.inside=hall.id;p.roomAt={...at};}
  vessel.ownerId='commons';vessel.buildingId=hall.id;vessel.donatedBy='donor';vessel.donatedAt=w.minute;
  const workerMenu=decisionChoices(decisionContext(w,other));
  const craft=waterSupplyOpportunities(w,other).find(c=>c.action.type==='waterSupply'&&c.action.operation==='craft')!;assert.ok(craft);
  assert.equal(submitPlan(w,{id:'occupy-table',actorId:other.id,actorRevision:other.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Make a bucket',actions:[craft.action]}).ok,true);stepWorld(w,1);assert.ok(other.activity);
  const c=decisionContext(w,r);crowd(c);const menu=decisionChoices(c),drink=menu.find(x=>drinks(x.action))!;assert.ok(drink);
  execute(w,r,drink,menu);assert.match(r.lastFailure!,/工位/);assert.equal(vessel.amount,3);assert.equal(waterDrunkToday(w,r.id),0);assert.equal(workerMenu.some(x=>drinks(x.action)),true);
 }
});

test('a stale public drink fails after permission changes, and competing last-unit plans never double-drink',()=>{
 for(const change of ['damage','ownership','last-unit'] as const){
  const {w,r,hall,vessel}=fixture();vessel.ownerId='commons';vessel.buildingId=hall.id;vessel.donatedBy='donor';vessel.amount=1;
  const c=decisionContext(w,r);crowd(c);const menu=decisionChoices(c),drink=menu.find(x=>drinks(x.action))!;assert.ok(drink);
  if(change==='damage')hall.condition=0;
  if(change==='ownership')hall.ownerId='someone-else';
  if(change==='last-unit'){
   const other=structuredClone(r);other.id='other-drinker';other.name='Other drinker';w.residents.push(other);
   const otherMenu=decisionChoices(decisionContext(w,other)),otherDrink=otherMenu.find(x=>drinks(x.action))!;execute(w,other,otherDrink,otherMenu);assert.equal(vessel.amount,0);
  }
  execute(w,r,drink,menu);assert.ok(r.lastFailure);assert.equal(vessel.amount,change==='last-unit'?0:1);assert.equal(waterDrunkToday(w,r.id),0);
 }
});

test('an extreme 56-row safety-only agenda keeps every selected stop instead of forcing drinking or enlarging the cap',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r),drink=buildChoices(c).find(x=>drinks(x.action))!;assert.ok(drink);
 const stops:ActionChoice[]=Array.from({length:100},(_,i)=>({id:`safety-stop-${i}`,label:`Stop ${i}`,action:{type:'agency',operation:'disarm',routineId:`routine-${i}`}}));
 for(let i=0;i<10;i++){
  c.minute=600+i*30;const before=focusedChoices(c,stops),after=focusedChoices(c,[...stops,drink]);
  assert.equal(before.length,56);assert.deepEqual(after,before);assert.ok(!after.some(x=>drinks(x.action)));assert.equal(after.length,56);
 }
});
