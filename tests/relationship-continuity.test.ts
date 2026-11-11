import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {roomLayout} from '../src/shared/rooms.js';
import {initializeRooms} from '../src/world/rooms.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {recordDeath} from '../src/world/life.js';
import {executeSocialAction} from '../src/world/social.js';
import {initializeRelationships,socialPresence} from '../src/world/relationships.js';
import {completeFunerary,initializeFunerary} from '../src/world/funerary.js';
import {completeProduction,initializeProduction} from '../src/world/production.js';
import {deathProof} from '../src/world/knowledge.js';
import {WorldStore,workingEvents} from '../src/server/store.js';

function setup(){
 const w=createFormalWorld(),a=w.residents.find(p=>p.name==='白荻')!,b=w.residents.find(p=>p.name==='樊桥')!,c=w.residents.find(p=>p.name==='阮颂')!,hall=w.buildings.find(p=>p.kind==='lodge')!;
 initializeRooms(w);initializeFunerary(w);initializeProduction(w);
 for(const r of w.residents){r.at={x:2,y:2};r.inside=null;r.roomAt=null;r.activity=null;r.plan=null;r.energy=r.health=100;r.hunger=0;}
 for(const r of [a,b,c]){r.relations=[];r.parents=[];r.canDecide=r.canExpress=true;r.knownPeople=[a.id,b.id,c.id];r.knownBuildings=w.buildings.map(b=>b.id);r.at={...hall.door};}
 c.at={x:2,y:2};w.clock.paused=false;
 return {w,a,b,c,hall};
}
function inside(f:ReturnType<typeof setup>,a=f.a,b=f.b){const at=roomLayout(f.w,f.hall).entry;for(const [i,r]of [a,b].entries()){r.at={...f.hall.door};r.inside=f.hall.id;r.roomAt={x:at.x+i,y:at.y};}}
function choices(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
function offer(w:World,r:Resident,kind:'dating'|'marriage'|'care'|'child',other:Resident){return choices(w,r).find(c=>c.action.type==='propose'&&c.action.proposal===kind&&c.action.targetId===other.id);}
function run(w:World,r:Resident,match:(a:Action)=>boolean,minutes=12){
 let menu=choices(w,r),choice=menu.find(c=>match(c.action));
 for(let tries=0;!choice&&tries<24;tries++){const wait=menu.find(c=>c.action.type==='wait')!;const answer=parseChoice(JSON.stringify({choice:wait.id,minutes:30}),menu);assert.ok(submitPlan(w,{id:'menu-wait-'+w.revision+'-'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...answer}).ok);stepWorld(w,30);menu=choices(w,r);choice=menu.find(c=>match(c.action));}
 assert.ok(choice,'action must be available in the real model menu');
 const answer=parseChoice(JSON.stringify({choice:choice.id}),menu);
 assert.ok(submitPlan(w,{id:'continuity-'+w.revision+'-'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...answer}).ok);
 stepWorld(w,minutes);assert.equal(r.lastFailure,null);assert.equal(r.activity,null,'actual action must finish');
}
function propose(w:World,r:Resident,kind:'dating'|'marriage'|'care'|'child',other:Resident){run(w,r,a=>a.type==='propose'&&a.proposal===kind&&a.targetId===other.id);return w.proposals.at(-1)!;}
function agree(w:World,r:Resident,id:string){run(w,r,a=>a.type==='respond'&&a.proposalId===id&&a.accept);}
function married(f:ReturnType<typeof setup>){const {w,a,b}=f;inside(f);agree(w,b,propose(w,a,'dating',b).id);agree(w,a,propose(w,b,'marriage',a).id);}
function roundtrip(w:World){const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load(true)!;return {store,saved};}

test('indoor dating, marriage, gestation and care go through real menus, separate consent and execution',()=>{
 const f=setup(),{w,a,b}=f;married(f);
 assert.equal(a.relations.find(t=>t.targetId===b.id)?.partner,'married');
 const home=w.buildings.find(h=>h.id===a.homeId)!;home.capacity=home.residents.length+1;
 const child=propose(w,a,'child',b);assert.equal(a.pregnancy,null);agree(w,b,child.id);assert.equal(w.residents.find(p=>p.id===a.id)!.pregnancy?.otherParentId,b.id);
 a.skills.care=2;a.inventory.meal=3;a.inventory.water=3;b.health=70;b.hunger=50;
 const care=propose(w,a,'care',b);assert.equal(care.status,'open');agree(w,b,care.id);
 const meals=a.inventory.meal;run(w,a,x=>x.type==='care'&&x.targetId===b.id,40);assert.equal(a.inventory.meal,meals-1);assert.equal(care.status,'expired');
});

test('indoor proposals require the same room, short unblocked distance, actual access and awake independent participants',()=>{
 const f=setup(),{w,a,b,c,hall}=f;inside(f);assert.ok(offer(w,a,'dating',b));
 b.inside=null;b.roomAt=null;assert.equal(offer(w,a,'dating',b),undefined);
 b.inside=hall.id;b.roomAt={x:2,y:5};assert.equal(offer(w,a,'dating',b),undefined);
 a.roomAt={x:5,y:9};b.roomAt={x:7,y:9};c.status='dead';c.deathAt=w.minute;c.inside=hall.id;c.roomAt={x:6,y:9};c.body={carriedBy:null,reservedBy:null,storedAt:hall.id};
 assert.equal(socialPresence(w,a,b),false);assert.equal(offer(w,a,'dating',b),undefined);
 c.body.storedAt=null;inside(f);hall.ownerId=a.id;hall.residents=[];assert.equal(offer(w,a,'dating',b),undefined);
 hall.residents.push(b.id);assert.ok(offer(w,a,'dating',b));
 const bed=roomLayout(w,hall).slots.find(s=>s.kind==='bed')!.at;b.roomAt={...bed};a.roomAt={x:bed.x+1,y:bed.y};
 b.activity={planId:'asleep',action:{type:'sleep',minutes:60},startedAt:w.minute,remaining:60,path:[],target:hall.door,definition:w.activeDefinitions['action/routine']};
 assert.equal(offer(w,a,'dating',b),undefined);assert.equal(executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:b.id}).ok,false);
});

test('reply rechecks room access, capacity, refusal and current relationship, with no retroactive consent',()=>{
 const f=setup(),{w,a,b,hall}=f;inside(f);const p=propose(w,a,'dating',b);
 const accepted=choices(w,b).find(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&c.action.accept)!.action;
 a.inside=null;a.roomAt=null;assert.equal(executeSocialAction(w,b,accepted).ok,false);assert.equal(p.status,'open');
 inside(f);hall.ownerId=a.id;hall.residents=[];assert.equal(executeSocialAction(w,b,accepted).ok,false);hall.ownerId='commons';
 a.canExpress=false;assert.equal(executeSocialAction(w,b,accepted).ok,false);a.canExpress=true;
 run(w,b,x=>x.type==='respond'&&x.proposalId===p.id&&!x.accept);assert.equal(p.status,'declined');assert.equal(a.relations.find(t=>t.targetId===b.id)?.partner,undefined);
 a.skills.care=2;a.inventory.meal=2;a.inventory.water=2;b.health=70;const care=propose(w,a,'care',b);b.refusesCare=true;
 assert.equal(choices(w,b).some(c=>c.action.type==='respond'&&c.action.proposalId===care.id&&c.action.accept),false);
 assert.equal(executeSocialAction(w,b,{type:'respond',proposalId:care.id,accept:true}).ok,false);assert.equal(care.status,'open');
});

test('witnessed death closes world relationships and archived marriage, preserving dates, independent rights and remarriage choice',()=>{
 const f=setup(),{w,a,b,c}=f;married(f);const tie=a.relations.find(t=>t.targetId===b.id)!,started=tie.partnerSince,marriage=tie.marriedAt;
 a.pregnancy={otherParentId:b.id,conceivedAt:w.minute,dueAt:w.minute+10000,definition:'life/basic@1'};const home=a.homeId,guardians=[...a.guardianIds];
 const died=w.minute;recordDeath(w,b);assert.equal(tie.partner,undefined);assert.equal(b.relations.find(t=>t.targetId===a.id)?.partner,undefined);
 assert.ok(deathProof(w,a,b.id));assert.equal(a.pregnancy.otherParentId,b.id);assert.equal(a.homeId,home);assert.deepEqual(a.guardianIds,guardians);
 assert.ok(tie.pastPartnerships?.some(p=>p.endedAt===died&&p.startedAt===started&&p.marriedAt===marriage));
 inside(f,a,c);assert.ok(offer(w,a,'dating',c));const pending=propose(w,a,'dating',c);assert.equal(a.relations.find(t=>t.targetId===c.id)?.partner,undefined);agree(w,c,pending.id);
 const count=w.events.length;assert.equal(recordDeath(w,b),false);initializeRelationships(w);assert.equal(w.events.length,count);
 const {store,saved}=roundtrip(w);const archive=store.personArchive(w.id,a.id);const past=archive.partners.find(p=>p.personId===b.id)!;
 assert.equal(past.endedAt,died);assert.equal(past.endReason,'death');assert.equal(past.startedAt,started);assert.equal(past.marriedAt,marriage);
 assert.equal(saved.residents.find(p=>p.id===a.id)!.relations.find(t=>t.targetId===c.id)?.partner,'dating');store.close();
});

test('unseen death and ordinary hearsay do not announce widowhood or unlock a new commitment, including after reload',()=>{
 const f=setup(),{w,a,b,c,hall}=f;married(f);a.inside=null;a.roomAt=null;a.at={...hall.door};b.at={x:2,y:2};b.inside=null;b.roomAt=null;recordDeath(w,b);
 assert.equal(a.relations.find(t=>t.targetId===b.id)?.partner,undefined);assert.equal(deathProof(w,a,b.id),undefined);c.at={...a.at};
 const death=w.events.find(e=>e.kind==='death'&&e.actors[0]===b.id)!;a.memories.push({eventId:death.id,receivedAt:w.minute,source:'heard',text:'有人说他不在了'});
 assert.equal(offer(w,a,'dating',c),undefined);assert.equal(executeSocialAction(w,a,{type:'propose',proposal:'dating',targetId:c.id}).ok,false);
 assert.match(decisionContext(w,a).formal!.familyNotes!,/仍记得/);assert.doesNotMatch(decisionContext(w,a).formal!.familyNotes!,/本人已获知/);
 a.memories=[];const {store,saved}=roundtrip(w),survivor=saved.residents.find(p=>p.id===a.id)!,candidate=saved.residents.find(p=>p.id===c.id)!;
 assert.equal(offer(saved,survivor,'dating',candidate),undefined);assert.equal(survivor.partnerDeathNotices,undefined);store.close();
});

test('verified death notice is delivered consciously, remains durable after pruning, and is not inheritance proof',()=>{
 const f=setup(),{w,a,b,c,hall}=f;married(f);a.inside=null;a.roomAt=null;a.at={...hall.door};b.inside=null;b.roomAt=null;b.at={x:2,y:2};c.at={...b.at};recordDeath(w,b);assert.ok(deathProof(w,c,b.id));
 inside(f,a,c);const bed=roomLayout(w,hall).slots.find(s=>s.kind==='bed')!.at;a.roomAt={...bed};c.roomAt={x:bed.x+1,y:bed.y};a.activity={planId:'sleep',action:{type:'sleep',minutes:60},startedAt:w.minute,remaining:60,path:[],target:hall.door,definition:w.activeDefinitions['action/routine']};
 const notify={type:'funerary' as const,operation:'notify' as const,targetId:b.id,recipientId:a.id};assert.ok(completeFunerary(w,c,notify));assert.equal(a.partnerDeathNotices,undefined);a.activity=null;
 run(w,c,x=>x.type==='funerary'&&x.operation==='notify'&&x.recipientId===a.id&&x.targetId===b.id);
 assert.ok(a.partnerDeathNotices?.[b.id]);assert.equal(deathProof(w,a,b.id),undefined);assert.ok(offer(w,a,'dating',c));
 const eventId=w.residents.find(p=>p.id===a.id)!.partnerDeathNotices![b.id].eventId;a.memories=[];w.funerary!.notices=[];w.minute+=10000;
 assert.ok(workingEvents(w).some(e=>e.id===eventId));const {store,saved}=roundtrip(w),survivor=saved.residents.find(p=>p.id===a.id)!,candidate=saved.residents.find(p=>p.id===c.id)!;
 assert.ok(offer(saved,survivor,'dating',candidate));assert.equal(deathProof(saved,survivor,b.id),undefined);assert.match(decisionContext(saved,survivor).formal!.familyNotes!,/本人已获知/);store.close();
});

test('spouse inheritance fallback is frozen at death, survives a new relationship and reload, without copying original sealed assets',()=>{
 const f=setup(),{w,a,b,c}=f;married(f);b.inventory={wood:5};b.coins=27;const initial=a.coins;recordDeath(w,b);
 assert.deepEqual(w.estates.find(e=>e.personId===b.id)!.spouseIds,[a.id]);inside(f,a,c);agree(w,c,propose(w,a,'dating',c).id);
 const {store,saved}=roundtrip(w),survivor=saved.residents.find(p=>p.id===a.id)!,home=saved.buildings.find(h=>h.id===b.homeId)!;
 survivor.at={...home.door};survivor.inside=null;survivor.roomAt=null;
 assert.equal(completeProduction(saved,survivor,{type:'production',operation:'inherit',personId:b.id}),null);
 assert.equal(survivor.coins,initial+27);assert.equal(survivor.inventory.wood??0,a.inventory.wood??0);
 assert.ok(saved.estates.find(e=>e.personId===b.id)!.parcels!.some(p=>p.ownerId===a.id&&p.inventory.wood===5));
 assert.ok(completeProduction(saved,survivor,{type:'production',operation:'inherit',personId:b.id}));assert.equal(survivor.coins,initial+27);store.close();
});

test('legacy deceased spouses migrate once, preserve unknown starts and estate priority, and never acquire remote knowledge',()=>{
 const f=setup(),{w,a,b,c}=f;a.relations.push({targetId:b.id,partner:'married',affection:3,trust:2,conflict:0,evidence:[]});b.relations.push({targetId:a.id,partner:'married',affection:4,trust:1,conflict:0,evidence:[]});
 b.status='dead';b.deathAt=w.minute-60;b.inventory={};b.coins=0;w.estates.push({personId:b.id,inventory:{wood:5},coins:15,status:'protected',heirs:[c.id]});
 initializeRelationships(w);const count=w.events.length;initializeRelationships(w);assert.equal(w.events.length,count);
 assert.equal(a.relations[0].partner,undefined);assert.equal(a.relations[0].pastPartnerships![0].startedAt,null);assert.equal(a.relations[0].pastPartnerships![0].endedAt,b.deathAt);
 assert.deepEqual(w.estates[0].heirs,[c.id]);assert.deepEqual(w.estates[0].spouseIds,[a.id]);assert.equal(a.partnerDeathNotices,undefined);assert.equal(deathProof(w,a,b.id),undefined);
 const {store}=roundtrip(w);assert.equal(store.personArchive(w.id,a.id).partners[0].startedAt,null);store.close();
});

test('indoor withdrawal and unilateral separation complete locally without chasing oneself or a departed partner',()=>{
 const f=setup(),{w,a,b,hall}=f;inside(f);const p=propose(w,a,'dating',b);const position={...a.roomAt!};
 run(w,a,x=>x.type==='respond'&&x.proposalId===p.id&&!x.accept);assert.equal(p.status,'declined');assert.equal(a.inside,hall.id);assert.deepEqual(a.roomAt,position);
 agree(w,b,propose(w,a,'dating',b).id);b.at={x:2,y:2};b.inside=null;b.roomAt=null;const before={...a.roomAt!};
 run(w,a,x=>x.type==='separate'&&x.targetId===b.id);assert.equal(a.inside,hall.id);assert.deepEqual(a.roomAt,before);assert.equal(a.relations.find(t=>t.targetId===b.id)?.partner,undefined);
 assert.equal(b.relations.find(t=>t.targetId===a.id)?.partner,undefined);
});

test('legacy double death closes at the first known death regardless of resident order, and never invents an unknown order',()=>{
 for(const unknown of [false,true])for(const reversed of [false,true]){
  const {w,a,b}=setup();a.relations=[{targetId:b.id,partner:'married',affection:0,trust:0,conflict:0,evidence:[]}];b.relations=[{targetId:a.id,partner:'married',affection:0,trust:0,conflict:0,evidence:[]}];
  a.status=b.status='dead';a.deathAt=120;b.deathAt=unknown?null:60;w.estates=[{personId:a.id,inventory:{},coins:5,status:'protected',heirs:[]},{personId:b.id,inventory:{},coins:7,status:'protected',heirs:[]}];
  if(reversed)w.residents.reverse();initializeRelationships(w);const ended=a.relations[0].pastPartnerships![0];
  assert.equal(ended.endedAt,unknown?null:60);assert.equal(ended.deceasedId,unknown?null:b.id);
  assert.deepEqual(w.estates.find(e=>e.personId===b.id)!.spouseIds,[a.id]);assert.deepEqual(w.estates.find(e=>e.personId===a.id)!.spouseIds,unknown?[b.id]:[]);
  assert.equal(w.events.filter(e=>e.relationshipEnd).length,1);const count=w.events.length;initializeRelationships(w);assert.equal(w.events.length,count);
 }
});

test('reading an actual public death record unlocks informed widowhood, and an old verified delivery can migrate without upgrading hearsay',()=>{
 const f=setup(),{w,a,b,c,hall}=f;married(f);a.inside=null;a.roomAt=null;a.at={...hall.door};b.inside=null;b.roomAt=null;b.at={x:2,y:2};c.at={...b.at};recordDeath(w,b);
 c.at={...hall.door};assert.equal(completeFunerary(w,c,{type:'funerary',operation:'registerDeath',targetId:b.id,buildingId:hall.id}),null);
 assert.equal(deathProof(w,a,b.id),undefined);assert.equal(completeFunerary(w,a,{type:'funerary',operation:'readDeathRecord',targetId:b.id,buildingId:hall.id}),null);assert.ok(deathProof(w,a,b.id));
 assert.match(decisionContext(w,a).formal!.familyNotes!,/本人已获知/);
 assert.equal(completeFunerary(w,c,{type:'funerary',operation:'notify',targetId:b.id,recipientId:a.id}),null);delete a.partnerDeathNotices;delete a.deathKnowledge;
 const notice=w.funerary!.notices.at(-1)!;a.memories=[];w.minute+=10000;
 for(let i=0;i<200;i++)emitLedgerEvent(w,{kind:'action',actors:[],place:{x:0,y:0},text:'其他已发生的独立记录'});
 const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.loadForRuntime()!,survivor=saved.residents.find(p=>p.id===a.id)!;
 assert.ok(saved.events.some(e=>e.id===notice.eventId),'working load must retain old delivery evidence before migration');
 initializeRelationships(saved);assert.ok(survivor.partnerDeathNotices?.[b.id]);assert.equal(deathProof(saved,survivor,b.id),undefined);store.close();
});
