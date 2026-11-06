import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {WorldStore} from '../src/server/store.js';
import {executeSocialAction} from '../src/world/social.js';
import {DAY, YEAR} from '../src/world/time.js';
import {advanceMigration, applyOutsideDecision, canDepart, initializeMigration, outsideCandidate, outsideDecisionContext, settlementDirections} from '../src/world/migration.js';
import {recordDeath} from '../src/world/life.js';

function started(){
  const w=createFormalWorld();
  w.clock.paused=false;initializeMigration(w);
  return w;
}
function decide(w:ReturnType<typeof started>,kind:'travelToValley'|'stayOutside'){
 const p=outsideCandidate(w)[0];assert.ok(p);
 const result=applyOutsideDecision(w,p.id,p.revision,{intention:kind==='stayOutside'?'我留在原居地':'我想亲自看看山谷',actions:[{type:kind}]});
 assert.equal(result.ok,true);
 return p;
}
function arrive(w:ReturnType<typeof started>,p:ReturnType<typeof decide>){
 const c=w.migration!.contacts.find(c=>c.id===p.id)!;
 w.minute=c.journey!.arriveAt;advanceMigration(w);
 assert.equal(p.residency,'visitor');
}

test('new and existing formal worlds register regional contacts without adding residents or inventing visits',()=>{
 const w=started(),id=w.id,history=w.events.length,minute=w.minute;
 assert.equal(w.residents.length,54);assert.equal(outsideCandidate(w).length,1);
 initializeMigration(w);assert.equal(w.migration!.contacts.length,3);
 assert.equal(w.events.length,history);assert.equal(w.minute,minute);assert.equal(w.id,id);
 const outsider=outsideCandidate(w)[0],context=outsideDecisionContext(w,outsider);
 assert.equal(context.people.length,0);assert.equal(context.buildings.length,0);assert.equal(context.resources.length,0);
 assert.equal(context.outside!.choices.length,2);assert.match(context.outside!.notice,/没有承诺床位/);
});

test('an outsider may refuse; repeat frames and existing residents leaving do not compel a replacement',()=>{
 const w=started(),p=decide(w,'stayOutside'),count=w.residents.length;
 const contact=w.migration!.contacts.find(c=>c.id===p.id)!;
 for(let i=0;i<50;i++){w.minute++;advanceMigration(w);}
 assert.equal(contact.phase,'home');assert.equal(contact.lastChoice,'stay');assert.equal(w.residents.length,count);
 assert.equal(outsideCandidate(w).some(c=>c.id===p.id),false);
 assert.equal(applyOutsideDecision(w,p.id,p.revision,{intention:'repeat',actions:[{type:'travelToValley'}]}).ok,false);
});

test('travel survives save/restart, enters only at the gate after its time, and cannot duplicate the same person',()=>{
 let w=started();const p=decide(w,'travelToValley'),c=w.migration!.contacts.find(c=>c.id===p.id)!;
 assert.equal(w.residents.some(r=>r.id===p.id),false);
 const remaining=c.journey!.arriveAt-w.minute;
 assert.ok(remaining>0);
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);w=store.load()!;
  w.minute+=remaining-1;advanceMigration(w);assert.equal(w.residents.length,54);
  w.minute++;advanceMigration(w);
  const visitor=w.residents.find(r=>r.id===p.id)!;
  assert.equal(visitor.residency,'visitor');assert.deepEqual(visitor.at,w.map.entrance);
  assert.deepEqual(visitor.inventory,p.inventory);assert.equal(visitor.coins,p.coins);
  assert.equal(w.residents.filter(r=>r.residency==='resident').length,54);
  assert.equal(w.events.at(-1)?.populationChange,'visit');
  for(let i=0;i<5;i++){w.minute++;advanceMigration(w);}
  assert.equal(w.residents.filter(r=>r.id===p.id).length,1);
 }finally{store.close();}
});

test('an obstructed gate delays arrival and the traveller may choose to go home',()=>{
 const w=started(),p=decide(w,'travelToValley'),gate=w.map.entrance;
 w.map.tiles[gate.y*w.map.width+gate.x]='water';
 const c=w.migration!.contacts.find(c=>c.id===p.id)!;
 w.minute=c.journey!.arriveAt;advanceMigration(w);
 assert.equal(c.phase,'offered');assert.equal(w.residents.length,54);assert.equal(c.journey?.blocked,true);
 assert.match(outsideDecisionContext(w,p).outside!.notice,/路阻/);
 decide(w,'stayOutside');assert.equal(c.phase,'home');assert.equal(c.journey,null);
 assert.equal(w.residents.length,54);
});

test('temporary lodging uses capacity while settlement is a later individual choice; visits do not subtract residents when they end',()=>{
 const w=started(),p=decide(w,'travelToValley');arrive(w,p);
 assert.equal(settlementDirections(w,p)[0].action.type,'move');
 const inn=w.buildings.find(b=>p.knownBuildings.includes(b.id))!;
 p.at={...inn.door};const before=inn.residents.length;
 inn.capacity=before;
 assert.equal(executeSocialAction(w,p,{type:'lodge',buildingId:inn.id}).ok,false);
 inn.capacity++;
 assert.equal(executeSocialAction(w,p,{type:'lodge',buildingId:inn.id}).ok,true);
 assert.equal(p.residency,'visitor');assert.equal(inn.residents.length,before+1);
 assert.equal(p.homeId,inn.id);
 assert.equal(executeSocialAction(w,p,{type:'settle',buildingId:inn.id}).ok,true);
 assert.equal(p.residency,'resident');assert.equal(inn.residents.length,before+1);
 assert.equal(w.events.at(-1)?.populationChange,'settle');
 p.at={...w.map.entrance};
 assert.equal(executeSocialAction(w,p,{type:'leave'}).ok,true);
 assert.equal(w.events.at(-1)?.populationChange,'depart');assert.equal(inn.residents.length,before);
 assert.equal(p.homeId,null);assert.equal(p.residency,'outside');
});

test('a past resident returns with the same name, identity, assets and relationships',()=>{
 const w=started(),p=w.residents.find(r=>r.name==='姚峤')!;
 const title=w.buildings.find(b=>b.ownerId===p.id)!;
 const inventory=structuredClone(p.inventory),relations=structuredClone(p.relations),money=p.coins;
 p.at={...w.map.entrance};assert.equal(executeSocialAction(w,p,{type:'leave'}).ok,true);
 assert.equal(title.ownerId,p.id);assert.equal(title.residents.includes(p.id),false);
 const contact=w.migration!.contacts.find(c=>c.id===p.id)!;
 // Independent test delivery of the next actual road notice.
 contact.phase='offered';contact.offeredAt=w.minute;
 assert.equal(applyOutsideDecision(w,p.id,p.revision,{intention:'想回去看看',actions:[{type:'travelToValley'}]}).ok,true);
 arrive(w,p);
 assert.equal(w.residents.filter(r=>r.id===p.id).length,1);assert.equal(p.name,'姚峤');
 assert.deepEqual(p.inventory,inventory);assert.deepEqual(p.relations,relations);assert.equal(p.coins,money);
 assert.equal(p.residency,'visitor');
});

test('a dead former resident does not leave the regional post permanently occupied',()=>{
 const w=started();decide(w,'stayOutside');
 const former=w.residents.find(r=>r.name==='姚峤')!;
 former.at={...w.map.entrance};assert.equal(executeSocialAction(w,former,{type:'leave'}).ok,true);
 const state=w.migration!,returning=state.contacts.find(c=>c.id===former.id)!;
 const available=state.contacts.find(c=>c.person&&c.lastChoice===null)!;
 for(const c of state.contacts)if(c!==returning&&c.lastChoice===null)c.futureAt=state.nextPostAt+(c===available?DAY:3*DAY);
 w.minute=state.nextPostAt;advanceMigration(w);
 assert.deepEqual(outsideCandidate(w).map(r=>r.id),[former.id]);
 assert.ok(recordDeath(w,former,'oldAge'));
 w.minute=state.nextPostAt;advanceMigration(w);
 assert.equal(returning.phase,'home');assert.equal(returning.offeredAt,null);
 assert.ok(outsideCandidate(w).some(r=>r.id===available.id));
 assert.ok(!outsideCandidate(w).some(r=>r.id===former.id));
});

test('an incapacitated traveller keeps their own pending choice while others can receive notices',()=>{
 const w=started(),waiting=outsideCandidate(w)[0];
 waiting.canDecide=false;waiting.canExpress=false;
 w.minute=w.migration!.nextPostAt;advanceMigration(w);
 assert.equal(w.migration!.contacts.find(c=>c.id===waiting.id)?.phase,'offered');
 assert.equal(outsideCandidate(w).length,1);
 assert.ok(!outsideCandidate(w).some(r=>r.id===waiting.id));
 waiting.canDecide=true;waiting.canExpress=true;
 assert.ok(outsideCandidate(w).some(r=>r.id===waiting.id));
});

test('a sole in-town guardian and a pregnant person must arrange care before departing',()=>{
 const w=started(),[a,b,child]=w.residents;
 assert.equal(canDepart(w,a),null);
 b.residency='outside';
 assert.match(canDepart(w,a)!,/监护/);
 a.at={...w.map.entrance};
 assert.equal(executeSocialAction(w,a,{type:'leave'}).ok,false);
 child.bornAt=w.minute-19*YEAR;
 assert.equal(canDepart(w,a),null);
 a.pregnancy={otherParentId:b.id,conceivedAt:w.minute,dueAt:w.minute+84*DAY,definition:'life/basic@1'};
 assert.match(canDepart(w,a)!,/孕育/);
});

test('the road can bring a willing visitor to an empty valley without replacing a fixed population',()=>{
 const w=started();w.residents=[];for(const building of w.buildings)building.residents=[];
 const p=decide(w,'travelToValley');arrive(w,p);
 assert.equal(w.residents.length,1);assert.equal(w.residents[0].residency,'visitor');
 const before=w.migration!.contacts.length;
 w.minute+=28*DAY;advanceMigration(w);
 assert.equal(w.migration!.contacts.length,before+1);
 assert.equal(w.residents.length,1);
});

test('public-house settlement cannot bypass a sole guardian’s care handoff',()=>{
 const w=started(),[parent,other,child]=w.residents;
 other.residency='outside';
 const inn=w.buildings.find(b=>b.kind==='lodge')!;
 parent.at={...inn.door};parent.inside=null;
 assert.equal(executeSocialAction(w,parent,{type:'settle',buildingId:inn.id}).ok,false);
 assert.equal(parent.homeId,child.homeId);
 other.residency='resident';other.homeId=child.homeId;
 assert.equal(executeSocialAction(w,parent,{type:'settle',buildingId:inn.id}).ok,true);
});

test('visiting and ending a visit update the current census without changing settled population',()=>{
 const w=started(),p=decide(w,'travelToValley');arrive(w,p);
 assert.equal(w.population!.seasons.at(-1)!.residents,54);
 assert.equal(w.population!.seasons.at(-1)!.visitors,1);
 p.at={...w.map.entrance};
 assert.equal(executeSocialAction(w,p,{type:'leave'}).ok,true);
 assert.equal(w.events.at(-1)?.populationChange,'endVisit');
 assert.equal(w.population!.seasons.at(-1)!.residents,54);
 assert.equal(w.population!.seasons.at(-1)!.visitors,0);
 assert.equal(w.population!.seasons.at(-1)!.changes.depart,undefined);
 assert.equal(w.population!.seasons.at(-1)!.changes.endVisit,1);
 assert.ok(p.memories.some(memory=>memory.eventId===w.events.at(-1)!.id&&memory.source==='self'));
});

import {createWorld} from '../src/world/seed.js';import {submitPlan,stepWorld} from '../src/world/engine.js';
function regionalFamily(){const w=createWorld();w.mode='formal';w.clock.paused=false;w.resources=[];initializeMigration(w);for(const c of w.migration!.contacts){c.phase='home';c.futureAt=Number.MAX_SAFE_INTEGER;}w.minute=56*DAY+480;advanceMigration(w);const members=w.migration!.contacts.filter(c=>c.familyId);assert.equal(members.length,2);assert.ok(members.every(c=>c.phase==='offered'));return {w,members,people:members.map(c=>c.person!)};}
test('an existing external family needs two independent choices, arrives through the same actual gate and cannot overbook its lodging',()=>{const {w,members,people:[a,b]}=regionalFamily(),count=w.residents.length,history=w.events.length;assert.ok(outsideDecisionContext(w,a).outside!.choices.some(c=>c.action.type==='travelWithFamily'));const go=(r:typeof a,other:typeof b)=>applyOutsideDecision(w,r.id,r.revision,{intention:'我愿意与亲人同行，住宿各自选择',actions:[{type:'travelWithFamily',partnerId:other.id}]});assert.ok(go(a,b).ok);assert.ok(members.every(c=>!c.journey));assert.equal(w.residents.length,count);assert.equal(w.events.length,history);assert.ok(go(b,a).ok);assert.ok(members.every(c=>c.phase==='travelling'));assert.equal(members[0].journey!.arriveAt,members[1].journey!.arriveAt);assert.equal(w.residents.length,count);w.minute=members[0].journey!.arriveAt;advanceMigration(w);assert.equal(w.residents.length,count+2);assert.ok([a,b].every(p=>p.residency==='visitor'&&p.homeId===null));assert.equal(a.relations.find(r=>r.targetId===b.id)?.kin,'sibling');const inn=w.buildings.find(x=>x.kind==='lodge'&&x.ownerId==='commons')!;inn.capacity=inn.residents.length+1;const travel=(r:typeof a)=>{assert.ok(submitPlan(w,{id:'family-inn:'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择到会馆问空床',actions:[{type:'lodge',buildingId:inn.id}]}).ok);let n=500;while(r.activity||r.plan){assert.ok(n--);stepWorld(w,1);}};travel(a);travel(b);assert.equal(a.homeId,inn.id);assert.equal(b.homeId,null);assert.match(b.lastFailure!,/已满/);assert.equal(inn.residents.length,inn.capacity);assert.equal(w.buildings.length,5);assert.equal(a.relations.find(r=>r.targetId===b.id)?.kin,'sibling');});
test('a family member can decline; the other cannot move them or claim a joint arrival',()=>{const {w,members,people:[a,b]}=regionalFamily();assert.ok(applyOutsideDecision(w,a.id,a.revision,{intention:'我提议同行',actions:[{type:'travelWithFamily',partnerId:b.id}]}).ok);assert.ok(applyOutsideDecision(w,b.id,b.revision,{intention:'我愿意留在这里',actions:[{type:'stayOutside'}]}).ok);assert.ok(members.every(c=>!c.journey));assert.equal(members[0].familyConsentUntil,undefined);assert.ok(!applyOutsideDecision(w,a.id,a.revision,{intention:'已经婉拒的对方仍同行',actions:[{type:'travelWithFamily',partnerId:b.id}]}).ok);});

test('the last departure preserves the town and does not replace anyone; a later independently arriving person can register at the existing public lodge',()=>{const w=createWorld();w.mode='formal';w.clock.paused=false;initializeMigration(w);w.residents=w.residents.slice(0,1);const original=w.residents[0],inn=w.buildings.find(b=>b.kind==='lodge')!;original.at={...w.map.entrance};original.inside=null;const ids=w.buildings.map(b=>b.id),terrain=w.map.tiles.slice();assert.equal(executeSocialAction(w,original,{type:'leave'}).ok,true);assert.equal(original.residency,'outside');const count=w.residents.length;w.minute+=DAY;advanceMigration(w);assert.equal(w.residents.length,count);assert.deepEqual(w.buildings.map(b=>b.id),ids);assert.deepEqual(w.map.tiles,terrain);const p=outsideCandidate(w)[0];assert.ok(p);assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'本人决定去旧山谷看看',actions:[{type:'travelToValley'}]}).ok);w.minute=w.migration!.contacts.find(c=>c.id===p.id)!.journey!.arriveAt;advanceMigration(w);assert.equal(p.residency,'visitor');assert.equal(p.homeId,null);p.at={...inn.door};assert.equal(executeSocialAction(w,p,{type:'settle',buildingId:inn.id}).ok,true);assert.equal(p.residency,'resident');assert.deepEqual(w.buildings.map(b=>b.id),ids);});
