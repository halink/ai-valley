import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {executeSocialAction,careAuthority,canActivateCareBranch,type CareTrigger,type CareEvidence} from '../src/world/social.js';
import {advanceLife,recordDeath} from '../src/world/life.js';
import {YEAR} from '../src/world/time.js';

function nearby(){const w=createWorld();w.clock.paused=false;const [a,b,c]=w.residents;a.at={x:30,y:29};b.at={x:31,y:29};c.at={x:70,y:50};return {w,a,b,c};}
test('emergency care requires real incapacity, urgency, volunteer supplies and no timely proxy',()=>{
 const {w,a,b,c}=nearby();a.skills.care=2;a.inventory={meal:2,water:2};b.health=10;
 assert.equal(careAuthority(w,a,b).allowed,false,'model delay/silence alone never grants authority');
 b.canDecide=false;b.canExpress=true;
 assert.equal(careAuthority(w,a,b).basis,'emergency','ability to speak alone is insufficient');
 const balance=b.coins;
 assert.equal(executeSocialAction(w,a,{type:'care',targetId:b.id}).ok,true);
 assert.equal(a.inventory.meal,1);assert.equal(b.coins,balance);assert.deepEqual(b.guardianIds,[]);
 b.canDecide=true;assert.equal(careAuthority(w,a,b).allowed,false,'recovered full capacity ends exception');
 b.canDecide=false;b.refusesCare=true;assert.equal(careAuthority(w,a,b).allowed,false);
 b.refusesCare=false;b.guardianIds=[c.id];c.at={...b.at};assert.equal(careAuthority(w,a,b).allowed,false,'timely proxy restores ordinary route');
});
test('ordinary care is a separately accepted single episode and rechecks refusal/resources',()=>{
 const {w,a,b}=nearby();a.skills.care=2;a.inventory={meal:1,water:1};b.health=60;
 assert.equal(executeSocialAction(w,a,{type:'propose',proposal:'care',targetId:b.id}).ok,true);
 const proposal=w.proposals[0];assert.equal(executeSocialAction(w,a,{type:'care',targetId:b.id}).ok,false);
 assert.equal(executeSocialAction(w,b,{type:'respond',proposalId:proposal.id,accept:true}).ok,true);
 b.refusesCare=true;assert.equal(executeSocialAction(w,a,{type:'care',targetId:b.id}).ok,false);assert.equal(a.inventory.meal,1);
 b.refusesCare=false;assert.equal(executeSocialAction(w,a,{type:'care',targetId:b.id}).ok,true);
 assert.equal(proposal.status,'expired');assert.equal(executeSocialAction(w,a,{type:'care',targetId:b.id}).ok,false);
});
test('backup branch sees delivered evidence, never an internal death flag',()=>{
 const promise:CareTrigger={observerId:'backup',acceptedAt:10,scope:['feed'],condition:{kind:'delivered-notice',subjectId:'child',notBefore:20}};
 const e:CareEvidence={eventId:'actual',observerId:'backup',subjectId:'child',receivedAt:30,kind:'delivered-notice',source:'heard',scope:['feed']};
 assert.equal(canActivateCareBranch(promise,e,30),true);
 assert.equal(canActivateCareBranch(promise,{...e,kind:'internal-death',source:'internal'},30),false);
 assert.equal(canActivateCareBranch(promise,{...e,observerId:'someone-else'},30),false);
 assert.equal(canActivateCareBranch(promise,{...e,scope:['sell-estate']},30),false);
 assert.equal(canActivateCareBranch(promise,e,25),false);
});
test('romance needs separate adult consent, unilateral separation preserves pregnancy and assets',()=>{
 const {w,a,b}=nearby();b.bornAt=w.minute-17*YEAR;
 assert.equal(executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:b.id}).ok,false);
 b.bornAt=w.minute-22*YEAR;
 assert.equal(executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:b.id}).ok,true);
 assert.equal(a.relations.some(r=>r.partner),false);
 assert.equal(executeSocialAction(w,b,{type:'respond',proposalId:w.proposals[0].id,accept:true}).ok,true);
 a.pregnancy={otherParentId:b.id,conceivedAt:w.minute,dueAt:w.minute+100,definition:'life/basic@1'};
 const money=b.coins;assert.equal(executeSocialAction(w,a,{type:'separate',targetId:b.id}).ok,true);
 assert.ok(a.pregnancy);assert.equal(b.coins,money);assert.equal(a.relations.some(r=>r.partner),false);
});
test('late agreement after death is rejected; estate is protected once without distant notification',()=>{
 const {w,a,b,c}=nearby();assert.equal(executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:b.id}).ok,true);
 a.at={x:5,y:5};const possessions={...a.inventory},money=a.coins,bMemory=b.memories.length,cMemory=c.memories.length;
 assert.equal(recordDeath(w,a),true);assert.equal(recordDeath(w,a),false);
 assert.equal(w.estates.length,1);assert.deepEqual(w.estates[0].inventory,possessions);assert.equal(w.estates[0].coins,money);
 assert.deepEqual(a.inventory,{});assert.equal(b.memories.length,bMemory);assert.equal(c.memories.length,cMemory);
 assert.equal(executeSocialAction(w,b,{type:'respond',proposalId:w.proposals[0].id,accept:true}).ok,false);
});
test('pregnancy survives other parent death; birth is once, same calendar, no inherited skills',()=>{
 const {w,a,b}=nearby();a.pregnancy={otherParentId:b.id,conceivedAt:w.minute-50,dueAt:w.minute+5,definition:'life/basic@1'};
 recordDeath(w,b);assert.ok(a.pregnancy);assert.ok(w.estates[0].heirs.some(id=>id.startsWith('unborn:')));
 w.minute+=10;advanceLife(w,10);advanceLife(w,10);
 assert.equal(w.residents.length,4);const child=w.residents[3];assert.equal(child.bornAt,w.minute);
 assert.deepEqual(child.parents,[a.id,b.id]);assert.deepEqual(child.skills,{farming:0,building:0,care:0});
 assert.ok(w.estates[0].heirs.includes(child.id));assert.equal(child.at.x,a.at.x);
});
test('clock hold does not deliver overdue births or deaths',()=>{
 const {w,a}=nearby();a.pregnancy={otherParentId:'qiao',conceivedAt:1,dueAt:2,definition:'life/basic@1'};a.health=0;
 w.clock.paused=true;advanceLife(w,100);assert.equal(a.status,'alive');assert.equal(w.residents.length,3);
});
test('burial needs an actual carried body, finite grave and a witnessed death',()=>{
 const {w,a,b}=nearby();recordDeath(w,b);
 assert.equal(executeSocialAction(w,a,{type:'bury',targetId:b.id}).ok,false);
 const g=w.graves[0];a.at={x:g.at.x,y:g.at.y+1};b.at={...a.at};
 b.body={reservedBy:a.id,carriedBy:a.id,storedAt:null};g.reservedBy=a.id;
 a.activity={planId:'test',action:{type:'bury',targetId:b.id},startedAt:w.minute,remaining:0,path:[],target:g.at,definition:'action/routine@1',cargo:{bodyId:b.id,graveId:g.id,pickedUp:true}};
 assert.equal(executeSocialAction(w,a,{type:'bury',targetId:b.id}).ok,true);
 assert.equal(w.graves.filter(g=>g.personId===b.id).length,1);
 assert.equal(executeSocialAction(w,a,{type:'bury',targetId:b.id}).ok,false);
});
test('migration preserves identity and independent assets and does not overfill a house',()=>{
 const {w,a}=nearby();a.at={...w.map.entrance};const identity=a.id,money=a.coins;
 assert.equal(executeSocialAction(w,a,{type:'leave'}).ok,true);assert.equal(a.id,identity);assert.equal(a.coins,money);
 // Outside entry is a separate physical-arrival process, not this observer-accessible helper.
 a.residency='visitor';const lodge=w.buildings.find(b=>b.id==='lodge')!;a.at={...lodge.door};lodge.residents=['x','y','z','w'];
 assert.equal(executeSocialAction(w,a,{type:'settle',buildingId:lodge.id}).ok,false);
 lodge.residents.pop();assert.equal(executeSocialAction(w,a,{type:'settle',buildingId:lodge.id}).ok,true);assert.equal(lodge.residents.length,4);
});
test('a proposal may be withdrawn before late acceptance and separation needs no absent-partner permission',()=>{
 const {w,a,b}=nearby();executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:b.id});
 const first=w.proposals[0];assert.equal(executeSocialAction(w,a,{type:'respond',proposalId:first.id,accept:false}).ok,true);
 assert.equal(executeSocialAction(w,b,{type:'respond',proposalId:first.id,accept:true}).ok,false);
 w.minute++;executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:b.id});
 executeSocialAction(w,b,{type:'respond',proposalId:w.proposals[1].id,accept:true});b.residency='outside';b.at={x:70,y:50};
 assert.equal(executeSocialAction(w,a,{type:'separate',targetId:b.id}).ok,true);
});
test('gestator death ends the physical process without leaving unresolvable unborn estate claims',()=>{
 const {w,a,b}=nearby();a.pregnancy={otherParentId:b.id,conceivedAt:100,dueAt:10000,definition:'life/basic@1'};
 recordDeath(w,b);assert.ok(w.estates[0].heirs.includes(`unborn:${a.id}:100`));recordDeath(w,a);
 assert.equal(w.estates[0].heirs.length,0);assert.equal(a.pregnancy,null);
});
test('direct ancestry remains a romantic prohibition across generations without shortcut kin links',()=>{
 const {w,a,b,c}=nearby();b.parents=[c.id];c.parents=[a.id];
 assert.equal(a.relations.length,0);assert.equal(executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:b.id}).ok,false);
});
