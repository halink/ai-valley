import {finishChosenVisit} from './helpers/visitor-journeys.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceMigration,applyOutsideDecision,initializeMigration,outsideCandidate,outsideDecisionContext} from '../src/world/migration.js';
import {gateDirectoryNote,journeySupplyNote,observeGateDirections,visibleGateDirectory} from '../src/world/visitor-guidance.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext,prompt} from '../src/server/decisions.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';

function offered(world=createWorld()):{w:World;p:Resident}{
  const w=world;w.mode='formal';w.clock.paused=false;initializeMigration(w);
  // Deliver one actual test notice without changing supplies, buildings or population.
  const c=w.migration!.contacts[0];c.phase='offered';c.offeredAt=w.minute;
  return {w,p:outsideCandidate(w)[0]};
}
function arrived(world?:World){
  const {w,p}=offered(world);
  assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'本人先去谷口看看',actions:[{type:'travelToValley'}]}).ok);
  const c=w.migration!.contacts.find(c=>c.id===p.id)!;
  finishChosenVisit(w,p);
  assert.equal(p.residency,'visitor');return {w,p};
}
function choose(w:World,p:Resident,action:Action){
  assert.ok(submitPlan(w,{id:'visitor-test:'+p.revision,actorId:p.id,actorRevision:p.revision,createdAt:w.minute,
    definition:w.activeDefinitions['action/routine'],intention:'本人选择已列出的方向',actions:[action]}).ok);
  let guard=1000;while(p.activity||p.plan){assert.ok(guard--,'action must finish or fail');stepWorld(w,1);}
}

test('the public gate sign gives only addresses, works without either destination and cannot be read remotely',()=>{
  const {w,p}=arrived();
  const before=JSON.stringify(w),sign=visibleGateDirectory(w,p)!;
  assert.deepEqual(Object.keys(sign.hall!).sort(),['door','id','name']);
  assert.deepEqual(Object.keys(sign.water!).sort(),['at','id']);
  assert.deepEqual(sign.exit,w.map.entrance);
  const note=gateDirectoryNote(sign);assert.match(note,/水量.*亲自核对/);assert.match(note,/归路/);
  assert.equal(JSON.stringify(w),before,'read-only sign must not register state');
  const hall=w.buildings.find(b=>b.id===sign.hall!.id)!,water=w.resources.find(r=>r.id===sign.water!.id)!;
  hall.capacity=999;hall.condition=0;hall.residents=['hidden-person'];water.amount=0;
  assert.deepEqual(visibleGateDirectory(w,p),sign,'sign cannot report live availability');
  p.at={x:p.at.x+3,y:p.at.y};assert.equal(visibleGateDirectory(w,p),undefined);
  p.at={...w.map.entrance};p.inside=hall.id;assert.equal(visibleGateDirectory(w,p),undefined);
  p.inside=null;p.residency='outside';assert.equal(visibleGateDirectory(w,p),undefined);
  p.residency='visitor';p.canDecide=false;assert.equal(visibleGateDirectory(w,p),undefined);
  p.canDecide=true;w.buildings=w.buildings.filter(b=>b.id!==hall.id);
  assert.equal(visibleGateDirectory(w,p)!.hall,null);assert.ok(visibleGateDirectory(w,p)!.water);
  w.resources=w.resources.filter(r=>r.kind!=='spring');
  assert.equal(visibleGateDirectory(w,p)!.water,null);
  assert.match(gateDirectoryNote(visibleGateDirectory(w,p)!),/没有登记.*归路/);
});

test('arrival learns gate addresses and records truthful directions without transferring supplies or assigning a bed',()=>{
  const {w,p}=offered(createFrontierWorld());initializeFood(w);
  const bag=structuredClone(p.inventory),stocks=structuredClone(w.civic?.stores),count=w.residents.length;
  assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'我选择探访',actions:[{type:'travelToValley'}]}).ok);
  const c=w.migration!.contacts.find(c=>c.id===p.id)!;finishChosenVisit(w,p);
  const sign=visibleGateDirectory(w,p)!;
  assert.ok(p.knownBuildings.includes(sign.hall!.id));assert.ok(p.knownResources.includes(sign.water!.id));
  assert.equal(p.homeId,null);assert.deepEqual(p.inventory,bag);assert.deepEqual(w.civic?.stores,stocks);
  assert.equal(w.residents.length,count+1);assert.match(w.events.at(-1)!.text,/取水点.*归路.*不承诺空床/);
  // Existing unrelated opportunity builders register their rule definitions once.
  decisionContext(w,p);
  const before=JSON.stringify(w),cxt=decisionContext(w,p),all=decisionChoices(cxt);
  assert.equal(JSON.stringify(w),before,'context and final menu must be read-only');
  assert.equal(cxt.resources.length,0,'a distant water address does not expose live water');
  for(const id of ['visit.water','visit.inn','visit.return'])assert.ok(cxt.formal!.opportunities.some(c=>c.id===id),id);
  assert.ok(all.some(c=>c.action.type==='move'&&c.action.to.x===sign.water!.at.x&&c.action.to.y===sign.water!.at.y));
  assert.ok(all.some(c=>c.action.type==='leave'));
});

test('a gate visitor can read the final menu, walk to the water point and then actually gather',()=>{
  const {w,p}=arrived(),water=visibleGateDirectory(w,p)!.water!;
  const choice=decisionChoices(decisionContext(w,p)).find(c=>c.action.type==='move'&&c.action.to.x===water.at.x&&c.action.to.y===water.at.y);
  assert.ok(choice,'water direction reaches the normal final decision menu');
  choose(w,p,choice.action);assert.equal(p.lastFailure,null);assert.deepEqual(p.at,water.at);
  const gather=decisionChoices(decisionContext(w,p)).find(c=>c.action.type==='gather'&&c.action.resourceId===water.id);assert.ok(gather);
  const amount=p.inventory.water??0;choose(w,p,gather.action);
  assert.equal(p.lastFailure,null);assert.equal(p.inventory.water,amount+(gather.action.type==='gather'?gather.action.quantity:0));
});

test('water, lodging directions and voluntary return survive crowded replies and an unrelated personal focus',()=>{
  const {w,p}=arrived(createFrontierWorld());
  p.agency={focus:'learning',goals:[],routines:[],nextSerial:1};
  const cxt=decisionContext(w,p),sign=visibleGateDirectory(w,p)!;
  cxt.formal!.opportunities.unshift(...Array.from({length:100},(_,i)=>({id:'reply:'+i,label:'独立应答',action:{type:'respond' as const,proposalId:'proposal:'+i,accept:false}})));
  for(const minute of [w.minute,w.minute+30,w.minute+60]){
    cxt.minute=minute;const all=decisionChoices(cxt);assert.ok(all.length<=56);
    for(const at of [sign.water!.at,sign.hall!.door])assert.ok(all.some(c=>c.action.type==='move'&&c.action.to.x===at.x&&c.action.to.y===at.y));
    assert.ok(all.some(c=>c.action.type==='leave'));
  }
});

test('directions do not bypass a blocked local route or replenish an empty spring',()=>{
  const {w,p}=arrived(),water=visibleGateDirectory(w,p)!.water!,resource=w.resources.find(r=>r.id===water.id)!;
  const choice=decisionContext(w,p).formal!.opportunities.find(c=>c.id==='visit.water')!;
  resource.amount=0;resource.lastHarvest=Math.floor(w.minute/1440);
  w.map.tiles[water.at.y*w.map.width+water.at.x]='water';
  const at={...p.at},bag={...p.inventory};choose(w,p,choice.action);
  assert.match(p.lastFailure!,/可达路线/);assert.deepEqual(p.at,at);assert.deepEqual(p.inventory,bag);
  w.map.tiles[water.at.y*w.map.width+water.at.x]='grass';p.at={...water.at};resource.amount=0;
  const empty=JSON.stringify(resource);
  assert.ok(!decisionChoices(decisionContext(w,p)).some(c=>c.action.type==='gather'&&c.action.resourceId===water.id));
  assert.equal(JSON.stringify(resource),empty,'reading a sign or menu cannot replenish water');
});

test('legacy visitors learn only on a real observation, retain addresses after walking away and reload without gifts',()=>{
  const {w,p}=arrived();p.knownBuildings=[];p.knownResources=[];
  decisionContext(w,p);
  const before=JSON.stringify(w),sign=visibleGateDirectory(w,p)!;
  decisionContext(w,p);assert.equal(JSON.stringify(w),before);
  stepWorld(w,1);
  assert.ok(p.knownBuildings.includes(sign.hall!.id));assert.ok(p.knownResources.includes(sign.water!.id));
  const bag={...p.inventory};p.at={x:p.at.x+3,y:p.at.y};assert.equal(visibleGateDirectory(w,p),undefined);
  const store=new WorldStore(':memory:');
  try{store.commit(w,null);const loaded=store.load()!,person=loaded.residents.find(r=>r.id===p.id)!;
    assert.deepEqual(person.knownBuildings,p.knownBuildings);assert.deepEqual(person.knownResources,p.knownResources);
    assert.deepEqual(person.inventory,bag);assert.equal(person.homeId,null);
    const saved=JSON.stringify(loaded);observeGateDirections(loaded,person);assert.equal(JSON.stringify(loaded),saved);
  }finally{store.close();}
});

test('departure notice reports only real carried lots and excludes expiry on the arrival boundary',()=>{
  const {w,p}=offered();p.inventory={meal:4,water:2};initializeFood(w);
  w.food!.lots['person:'+p.id].meal=[
    {quantity:1,producedAt:w.minute-10,expiresAt:w.minute-1,definition:'food/life@1'},
    {quantity:1,producedAt:w.minute-10,expiresAt:w.minute+24,definition:'food/life@1'},
    {quantity:2,producedAt:w.minute-10,expiresAt:w.minute+25,definition:'food/life@1'},
  ];
  const before=JSON.stringify(w),cxt=outsideDecisionContext(w,p),notice=cxt.outside!.notice;
  assert.match(notice,/路程约24分钟/);assert.match(notice,/当前未过期的完整食品：餐食3份/);
  assert.match(notice,/24分钟后仍未过期的完整食品：餐食2份/);assert.match(notice,/随身清水2份/);
  assert.match(notice,/未提供沿途补给或接待承诺/);assert.match(prompt(cxt)[0].content,/餐食2份/);
  assert.equal(JSON.stringify(w),before);assert.equal(cxt.buildings.length,0);assert.equal(cxt.resources.length,0);
  w.buildings.find(b=>b.kind==='lodge')!.capacity=999;
  for(const r of w.resources)r.amount=0;
  assert.equal(outsideDecisionContext(w,p).outside!.notice,notice,'unobserved town changes cannot alter the road notice');
  assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'我选择不启程',actions:[{type:'stayOutside'}]}).ok);
  assert.equal(p.residency,'outside');assert.deepEqual(p.inventory,{meal:4,water:2});
});

test('missing and malformed expiry evidence never becomes fresh food on a read',()=>{
  const {w,p}=offered();p.inventory={meal:2,berry:.5,water:0};
  const before=JSON.stringify(w),note=journeySupplyNote(w,p,24);
  assert.match(note,/当前未过期的完整食品：无/);assert.match(note,/保质期未核实/);
  assert.equal(JSON.stringify(w),before);assert.equal(w.food,undefined);
  initializeFood(w);w.food!.lots['person:'+p.id].meal![0].expiresAt=NaN;
  assert.match(journeySupplyNote(w,p,24),/当前未过期的完整食品：无/);
});

test('journey food is capped by physical inventory and fractional remnants need a complete portion',()=>{
  const {w,p}=offered();p.inventory={meal:2,berry:1.5};initializeFood(w);
  const ledger=w.food!.lots['person:'+p.id];
  ledger.meal![0].quantity=99;
  ledger.berry=[
    {quantity:.75,producedAt:w.minute,expiresAt:w.minute+10,definition:'food/life@1'},
    {quantity:.75,producedAt:w.minute,expiresAt:w.minute+25,definition:'food/life@1'},
  ];
  const before=JSON.stringify(w),note=journeySupplyNote(w,p,24);
  assert.match(note,/当前未过期的完整食品：浆果1份、餐食2份/);
  assert.match(note,/24分钟后仍未过期的完整食品：餐食2份/);
  assert.doesNotMatch(note,/99份/);assert.equal(JSON.stringify(w),before);
});

test('blocked travellers see a bounded retry and may refuse; capacity loss in transit is not a promised bed',()=>{
  const {w,p}=offered();initializeFood(w);
  assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'本人决定来访',actions:[{type:'travelToValley'}]}).ok);
  const c=w.migration!.contacts.find(c=>c.id===p.id)!,gate=w.map.entrance;
  w.map.tiles[gate.y*w.map.width+gate.x]='water';finishChosenVisit(w,p);
  assert.match(outsideDecisionContext(w,p).outside!.notice,/等待30分钟再查路/);
  assert.match(outsideDecisionContext(w,p).outside!.notice,/30分钟后仍未过期/);
  const inn=w.buildings.find(b=>b.kind==='lodge')!;inn.residents=Array.from({length:inn.capacity},(_,i)=>'reserved:'+i);
  assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'我再查一次路',actions:[{type:'visitorJourney',operation:'continue',journeyId:c.journey!.staged!.id,minutes:30}]}).ok);
  w.map.tiles[gate.y*w.map.width+gate.x]='path';w.minute=c.journey!.nextCheckAt;advanceMigration(w);
  assert.equal(p.residency,'visitor');assert.equal(p.homeId,null);
  p.at={...inn.door};assert.ok(!decisionChoices(decisionContext(w,p)).some(c=>c.action.type==='lodge'));
  const leave=decisionChoices(decisionContext(w,p)).find(c=>c.action.type==='leave');assert.ok(leave);
  choose(w,p,leave.action);assert.equal(p.residency,'outside');assert.equal(p.homeId,null);
  assert.equal(inn.residents.length,inn.capacity);
});

test('arrival cannot invent read knowledge for a traveller who has lost observation capacity',()=>{
  const {w,p}=offered();
  assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'本人决定来访',actions:[{type:'travelToValley'}]}).ok);
  const c=w.migration!.contacts.find(c=>c.id===p.id)!;p.canDecide=false;
  w.minute=c.journey!.arriveAt;advanceMigration(w);
  assert.equal(p.residency,'outside');assert.equal(c.journey!.staged!.progress,c.journey!.staged!.duration);assert.deepEqual(p.knownBuildings,[]);assert.deepEqual(p.knownResources,[]);
  assert.doesNotMatch(w.events.at(-1)!.text,/路牌/);
});
