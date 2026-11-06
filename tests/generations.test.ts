import {initializeFunerary,completeFunerary} from '../src/world/funerary.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Action, Resident, World} from '../src/shared/types.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {advanceLife,recordDeath,ageMortalityDue,naturalDeath} from '../src/world/life.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {familyOpportunities,ageAllowsAction} from '../src/world/family.js';
import {executeSocialAction} from '../src/world/social.js';
import {DAY,YEAR} from '../src/world/time.js';
import {addHealthCase,advanceHealth} from '../src/world/health.js';
import {WorldStore} from '../src/server/store.js';

function stage(){const w=createFormalWorld();w.clock.paused=false;return w;}
function birth(w:World,parent:Resident,other:Resident){
 parent.pregnancy={otherParentId:other.id,conceivedAt:w.minute-100,dueAt:w.minute,definition:'life/basic@1'};
 const count=w.residents.length;advanceLife(w,1);assert.equal(w.residents.length,count+1);
 return w.residents.at(-1)!;
}
function execute(w:World,p:Resident,action:Action,minutes:number){
 const result=submitPlan(w,{id:'generation-fixture-'+w.revision+'-'+p.id,actorId:p.id,actorRevision:p.revision,
  createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'独立世界逐项验收',actions:[action]});
 assert.ok(result.ok,result.error);stepWorld(w,minutes);assert.equal(p.lastFailure,null);
}

test('newborns have distinct identities and sibling evidence; absent parents do not cancel birth',()=>{
 const w=stage(),[parent,other]=w.residents;
 const first=birth(w,parent,other);
 w.minute+=100;
 recordDeath(w,other);
 const second=birth(w,parent,other);
 assert.notEqual(first.id,second.id);assert.notEqual(first.name,second.name);
 assert.ok(first.id.length<100&&second.id.length<100);
 assert.deepEqual(second.parents,[parent.id,other.id]);assert.deepEqual(second.guardianIds,[parent.id]);
 assert.equal(second.relations.find(r=>r.targetId===first.id)?.kin,'sibling');
 assert.ok(first.relations.find(r=>r.targetId===second.id)?.evidence.length);
 const home=w.buildings.find(b=>b.id===parent.homeId)!;
 assert.ok(home.residents.includes(first.id)&&home.residents.includes(second.id));
 assert.ok(!home.residents.includes(other.id));
});

test('a guardian without medical training can visit and feed an infant using actual personal food',()=>{
 const w=stage(),[parent,other]=w.residents;
 const home=w.buildings.find(b=>b.id===parent.homeId)!;
 parent.at={...home.door};parent.inside=home.id;parent.skills.care=0;
 const child=birth(w,parent,other);child.hunger=65;
 parent.inside=null;parent.inventory={meal:2,water:2};
 assert.ok(familyOpportunities(w,parent).some(c=>c.action.type==='tendChild'&&c.action.targetId===child.id));
 execute(w,parent,{type:'tendChild',targetId:child.id},21);
 assert.ok(child.hunger<20);assert.equal(parent.inventory.meal,1);assert.equal(parent.inventory.water,1);
 assert.equal(parent.inside,child.inside);assert.equal(w.events.at(-1)?.audit?.authority,'guardian');
 // Natural rest costs no AI intention. Food remains the guardian's physical action.
 child.energy=10;w.minute=20*60;advanceLife(w,60);assert.ok(child.energy>10);
});

test('adding a guardian requires the existing guardian and an expressive child to agree independently',()=>{
 const w=stage(),child=w.residents[2],parent=w.residents[0],volunteer=w.residents.find(r=>r.name==='靳微')!;
 child.guardianIds=[parent.id];
 child.at={x:310,y:240};parent.at={x:311,y:240};volunteer.at={x:310,y:241};
 for(const p of [child,parent,volunteer])p.inside=null;
 assert.ok(executeSocialAction(w,volunteer,{type:'fosterChild',targetId:child.id}).ok);
 assert.ok(!child.guardianIds.includes(volunteer.id));
 assert.ok(executeSocialAction(w,parent,{type:'familyConsent',targetId:child.id,accept:true}).ok);
 assert.ok(!child.guardianIds.includes(volunteer.id));
 assert.ok(executeSocialAction(w,child,{type:'familyConsent',targetId:child.id,accept:true}).ok);
 assert.ok(child.guardianIds.includes(volunteer.id));
 assert.equal(w.events.at(-1)?.populationChange,'guardian');
});

test('distant unknown death cannot recruit a guardian but witnessed loss can prompt a voluntary offer',()=>{
 const w=stage(),[parent,other]=w.residents,volunteer=w.residents.find(r=>r.name==='靳微')!;
 const child=birth(w,parent,other);child.guardianIds=[parent.id];
 parent.at={x:60,y:60};parent.inside=null;
 child.at={x:310,y:240};child.inside=null;volunteer.at={x:311,y:240};volunteer.inside=null;
 recordDeath(w,parent);
 assert.ok(!familyOpportunities(w,volunteer).some(c=>c.action.type==='fosterChild'));
 initializeFunerary(w);volunteer.at={...parent.at};
 assert.equal(completeFunerary(w,volunteer,{type:'funerary',operation:'verify',targetId:parent.id}),null);
 volunteer.at={x:child.at.x+1,y:child.at.y};
 assert.ok(executeSocialAction(w,volunteer,{type:'fosterChild',targetId:child.id}).ok);
 assert.ok(child.guardianIds.includes(volunteer.id));
});

test('private household invitations need a separate choice and physical arrival',()=>{
 const w=stage(),host=w.residents.find(r=>r.name==='靳微')!,guest=w.residents.find(r=>r.name==='费棠')!;
 const home=w.buildings.find(b=>b.id===host.homeId)!;
 guest.at={...host.at};host.knownPeople.push(guest.id);
 const oldHome=guest.homeId;
 assert.ok(executeSocialAction(w,host,{type:'inviteHome',targetId:guest.id}).ok);
 assert.equal(guest.homeId,oldHome);
 assert.ok(executeSocialAction(w,guest,{type:'homeReply',targetId:host.id,accept:false}).ok);
 assert.equal(guest.homeId,oldHome);
 assert.ok(executeSocialAction(w,host,{type:'inviteHome',targetId:guest.id}).ok);
 guest.at={x:home.door.x,y:home.door.y+2};guest.inside=null;
 execute(w,guest,{type:'homeReply',targetId:host.id,accept:true},10);
 assert.equal(guest.homeId,home.id);assert.ok(home.residents.includes(guest.id));
});

test('three generations retain ancestry, age on one calendar, and a grown child can independently start a family',()=>{
 const w=stage(),[grandparent,partner]=w.residents;
 const parent=birth(w,grandparent,partner);
 parent.hunger=0;parent.health=100;
 w.minute=parent.bornAt+6*YEAR;advanceLife(w,1);
 assert.equal(parent.canDecide,true);assert.equal(parent.lifeStage,'child');
 assert.equal(ageAllowsAction(w,parent,{type:'build',kind:'home',at:{x:1,y:1}}),false);
 assert.equal(ageAllowsAction(w,parent,{type:'eat',item:'berry'}),true);
 const adultTime=parent.bornAt+18*YEAR;w.minute=adultTime;advanceLife(w,1);
 assert.equal(parent.lifeStage,'adult');assert.deepEqual(parent.guardianIds,[]);
 const candidate=w.residents.find(p=>p.name==='靳微')!;
 parent.at={...candidate.at};parent.inside=null;candidate.inside=null;parent.health=100;candidate.health=100;
 const lodge=w.buildings.find(b=>b.kind==='lodge'&&b.capacity>0)!;
 parent.homeId=lodge.id;lodge.residents.push(parent.id);
 assert.ok(executeSocialAction(w,parent,{type:'propose',proposal:'child',targetId:candidate.id}).ok);
 assert.equal(parent.pregnancy,null);
 const proposal=w.proposals.at(-1)!;
 assert.ok(executeSocialAction(w,candidate,{type:'respond',proposalId:proposal.id,accept:true}).ok);
 const due=parent.pregnancy!.dueAt;w.minute=due;advanceLife(w,1);
 const grandchild=w.residents.at(-1)!;
 assert.ok(grandchild.parents.includes(parent.id));assert.ok(parent.parents.includes(grandparent.id));
 const count=w.residents.length;advanceLife(w,1);assert.equal(w.residents.length,count);
 w.minute=grandchild.bornAt+18*YEAR;advanceLife(w,1);grandchild.at={...grandparent.at};grandchild.health=100;grandparent.health=100;
 assert.equal(executeSocialAction(w,grandchild,{type:'propose',proposal:'dating',targetId:grandparent.id}).ok,false);
});

test('an earlier injury can change the scheduling date without preventing age-six decisions',()=>{
 const w=stage(),child=birth(w,w.residents[0],w.residents[1]);
 w.minute=child.bornAt+6*YEAR-1;
 assert.ok(addHealthCase(w,child,'injury',10,'轻伤'));assert.equal(child.decisionDue,w.minute);
 assert.equal(child.canDecide,false);w.minute++;advanceLife(w,1);
 assert.equal(child.lifeStage,'child');assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
 assert.equal(child.decisionDue,w.minute);assert.equal(child.lastDecisionAt,-1);
});

test('a child whose age-six decision was skipped in a saved world is activated without altering another incapacity',()=>{
 const w=stage(),child=birth(w,w.residents[0],w.residents[1]),adult=w.residents[3];
 child.lifeStage='child';child.decisionDue=w.minute+20;adult.canDecide=false;adult.canExpress=false;
 w.minute=child.bornAt+7*YEAR;
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);const restored=store.load()!;advanceLife(restored,1);
  const person=restored.residents.find(r=>r.id===child.id)!;
  assert.equal(person.canDecide,true);assert.equal(person.canExpress,true);
  assert.equal(restored.residents.find(r=>r.id===adult.id)!.canDecide,false);
 }finally{store.close();}
});

test('an injured child keeps medical incapacity on their sixth birthday and gains decisions after actual recovery',()=>{
 const w=stage(),child=birth(w,w.residents[0],w.residents[1]);
 w.minute=child.bornAt+6*YEAR-1;
 const injury=addHealthCase(w,child,'injury',95,'重伤')!;
 w.minute++;advanceHealth(w,1);advanceLife(w,1);
 assert.equal(child.canDecide,false);assert.equal(child.canExpress,false);
 assert.deepEqual(injury.capacity,{decide:true,express:true});
 injury.severity=0;w.minute++;advanceHealth(w,1);
 assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
});

test('natural age-related death is replayable, creates one estate, releases beds and freezes with the clock',()=>{
 const w=stage(),person=w.residents[0];person.bornAt=w.minute-110*YEAR;
 const from=w.minute;
 let end=from;
 while(!ageMortalityDue(w.seed,person,from,end)&&end<from+5*YEAR)end+=DAY;
 assert.ok(end<from+5*YEAR);
 assert.equal(ageMortalityDue(w.seed,person,from,end),ageMortalityDue(w.seed,structuredClone(person),from,end));
 w.clock.paused=true;w.minute=end;advanceLife(w,end-from);assert.equal(person.status,'alive');
 w.clock.paused=false;advanceLife(w,end-from);
 assert.equal(person.status,'dead');assert.equal(person.deathCause,'oldAge');
 assert.equal(w.estates.filter(e=>e.personId===person.id).length,1);
 assert.equal(w.buildings.some(b=>b.residents.includes(person.id)),false);
 advanceLife(w,1);assert.equal(w.estates.filter(e=>e.personId===person.id).length,1);
 assert.equal(w.events.filter(e=>e.populationChange==='death'&&e.actors[0]===person.id).length,1);
});

test('outside life events cannot be witnessed by a neighbor at the departed resident’s old gate position',()=>{
 const w=stage(),[parent,other,neighbor]=w.residents;
 parent.residency='outside';parent.at={...w.map.entrance};parent.inside=null;
 neighbor.at={...w.map.entrance};neighbor.inside=null;
 const child=birth(w,parent,other);
 const birthEvent=w.events.find(e=>e.kind==='birth'&&e.actors.includes(child.id))!;
 w.minute=child.bornAt+18*YEAR;advanceLife(w,1);
 const growthEvent=w.events.find(e=>e.kind==='action'&&e.actors[0]===child.id&&e.text.includes('进入成年阶段'))!;
 parent.bornAt=w.minute-110*YEAR;
 const from=w.minute;let end=from;
 while(!ageMortalityDue(w.seed,parent,from,end)&&end<from+5*YEAR)end+=DAY;
 w.minute=end;assert.equal(naturalDeath(w,parent,from,end),true);
 const deathEvent=w.events.find(e=>e.kind==='death'&&e.actors[0]===parent.id)!;
 assert.match(deathEvent.text,/在镇外/);
 for(const event of [birthEvent,growthEvent,deathEvent]){
  assert.ok(event);assert.deepEqual(event.witnesses,[]);
  assert.equal(event.populationChange,undefined);
  assert.equal(neighbor.memories.some(memory=>memory.eventId===event.id),false);
 }
});
