import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PremisesTerms} from '../src/shared/premises.js';
import {currentPremisesLease,premisesWorkReason,residentialStay} from '../src/shared/premises.js';
import {roomLayout,roomPath} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {advancePremises,completePremises} from '../src/world/premises.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {socialSpace,socialPresence,knowsPartnerDeath} from '../src/world/relationships.js';
import {careAuthority,executeSocialAction} from '../src/world/social.js';
import {completeFunerary,initializeFunerary} from '../src/world/funerary.js';
import {deathProof} from '../src/world/knowledge.js';
import {recordDeath} from '../src/world/life.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';

const terms:PremisesTerms={days:4,rentPerDay:12,deposit:7,station:'bed',startMinute:0,durationMinutes:DAY};
function fixture(){
 const w=createWorld();w.mode='formal';w.minute=600;w.clock.paused=false;
 const [owner,tenant,other]=w.residents,source=w.buildings.find(b=>b.ownerId===owner.id)!;
 const home={...structuredClone(source),id:'social-rental-home',name:'交互测试空屋',residents:[] as string[],capacity:3};w.buildings.push(home);
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=500;r.inventory={meal:10,water:10};r.health=r.energy=100;r.hunger=10;r.plan=r.activity=null;r.knownBuildings.push(home.id);r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);r.canDecide=r.canExpress=true;r.skills.care=2;r.relations=[];r.parents=[];r.guardianIds=[];}
 initializeRooms(w);advancePremises(w);initializeForeignTrade(w);initializeFunerary(w);
 return {w,owner,tenant,other,home};
}
function lease(f:ReturnType<typeof fixture>,t=terms){
 assert.equal(completePremises(f.w,f.owner,{type:'premises',operation:'offer',buildingId:f.home.id,tenantId:f.tenant.id,terms:t}),null);
 const l=f.w.economy!.leases!.at(-1)!;
 assert.equal(completePremises(f.w,f.tenant,{type:'premises',operation:'accept',leaseId:l.id}),null);return l;
}
function inside(f:ReturnType<typeof fixture>,a=f.owner,b=f.tenant){
 const bed=roomLayout(f.w,f.home).slots.find(s=>s.key==='bed:0')!.at;
 for(const [i,r]of [b,a].entries()){r.at={...f.home.door};r.inside=f.home.id;r.roomAt={x:bed.x+i,y:bed.y};}
}
function choose(w:World,r:Resident,match:(a:Action)=>boolean){
 const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>match(c.action));assert.ok(choice,'required action must appear in the actual final menu');
 return parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];
}
function queue(w:World,r:Resident,a:Action){assert.ok(submitPlan(w,{id:`tenant-social:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择现场互动',actions:[a]}).ok);}
function finish(w:World,r:Resident){let n=300;while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,1);}}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);assert.equal(r.lastFailure,null);}
function danger(p:Resident){p.canDecide=p.canExpress=false;p.health=19;p.hunger=70;}
const rights=(f:ReturnType<typeof fixture>)=>({ownerId:f.home.ownerId,residents:[...f.home.residents],homeId:f.tenant.homeId,residency:f.tenant.residency,guardians:[...f.tenant.guardianIds]});

test('a real rented-bed journey permits same-room emergency care from the normal menu without granting housing or goods',()=>{
 const f=fixture(),{w,owner,tenant,home}=f,before=rights(f);lease(f);
 run(w,tenant,{...choose(w,tenant,a=>a.type==='sleep'&&a.buildingId===home.id),minutes:10} as Action);
 const bed=roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at;assert.deepEqual(tenant.roomAt,bed);
 owner.inside=home.id;owner.roomAt={x:bed.x+1,y:bed.y};danger(tenant);
 assert.equal(socialSpace(w,owner,tenant),true);assert.equal(socialPresence(w,owner,tenant),false);
 assert.equal(careAuthority(w,owner,tenant).basis,'emergency');
 const action=choose(w,owner,a=>a.type==='care'&&a.targetId===tenant.id),bag={...owner.inventory},patientBag={...tenant.inventory};
 run(w,owner,action);
 assert.equal(owner.inventory.meal,bag.meal!-1);assert.equal(owner.inventory.water,bag.water!-1);assert.deepEqual(tenant.inventory,patientBag);assert.ok(tenant.health>19);assert.deepEqual(rights(f),before);
 const fact=[...w.events].reverse().find(e=>e.kind==='care'&&e.audit?.authority==='emergency');assert.ok(fact);assert.deepEqual(fact.audit?.scope,['basic-care']);assert.deepEqual(fact.audit?.resources,{meal:1,water:1});
 assert.equal(tenant.inside,home.id);assert.deepEqual(tenant.roomAt,bed);assert.equal(w.proposals.length,0);
});

test('tenant emergency care distinguishes adult guardian history from a current child guardian and never invents consent',()=>{
 for(const cause of ['emergency','capable','not-critical','refusal','adult-history','child-guardian'] as const){const f=fixture(),{w,owner,tenant,other}=f;lease(f);inside(f);danger(owner);
  if(cause==='capable')owner.canDecide=owner.canExpress=true;
  if(cause==='not-critical')owner.health=40;
  if(cause==='refusal')owner.refusesCare=true;
  if(cause==='adult-history'||cause==='child-guardian'){other.inside=f.home.id;other.roomAt={...owner.roomAt!};owner.guardianIds=[other.id];}
  if(cause==='child-guardian')owner.bornAt=w.minute-13*YEAR;
  const allowed=cause==='emergency'||cause==='adult-history',bag={...tenant.inventory},result=executeSocialAction(w,tenant,{type:'care',targetId:owner.id});assert.equal(result.ok,allowed,cause);
  if(allowed){assert.equal(tenant.inventory.meal,bag.meal!-1);assert.equal(w.events.at(-1)?.audit?.authority,'emergency');}else assert.deepEqual(tenant.inventory,bag);
 }
});

test('tenant and owner independently date and marry through timed final-menu choices without cohabitation permission',()=>{
 const f=fixture(),{w,owner,tenant,other,home}=f,before=rights(f);lease(f);inside(f);
 for(const [actor,recipient,kind]of [[owner,tenant,'dating'],[tenant,owner,'marriage']] as const){
  run(w,actor,choose(w,actor,a=>a.type==='propose'&&a.proposal===kind&&a.targetId===recipient.id));const p=w.proposals.at(-1)!;
  assert.equal(p.status,'open');assert.notEqual(actor.relations.find(r=>r.targetId===recipient.id)?.partner,'married');
  run(w,recipient,choose(w,recipient,a=>a.type==='respond'&&a.proposalId===p.id&&a.accept));assert.equal(p.status,'accepted');
 }
 assert.equal(owner.relations.find(r=>r.targetId===tenant.id)?.partner,'married');assert.deepEqual(rights(f),before);
 other.inside=home.id;other.roomAt={...tenant.roomAt!};assert.equal(socialSpace(w,tenant,other),false);
 for(const p of [owner,tenant,other])assert.ok(premisesWorkReason(w,p.id,home.id,'kitchen',w.minute,w.minute+20));
 const originalHome=tenant.homeId;tenant.homeId=home.id;
 assert.equal(executeSocialAction(w,tenant,{type:'inviteHome',targetId:other.id}).ok,false);tenant.homeId=originalHome;assert.deepEqual(rights(f),before);
});

test('a verified death notice reaches an awake tenant through the timed menu without becoming personal death proof',()=>{
 const f=fixture(),{w,owner,tenant,other,home}=f;lease(f);inside(f);
 tenant.relations.push({targetId:other.id,partner:'married',affection:30,trust:30,conflict:0,evidence:[]});other.relations.push({targetId:tenant.id,partner:'married',affection:30,trust:30,conflict:0,evidence:[]});
 for(const p of [owner,other]){p.inside=null;p.roomAt=null;p.at={...w.map.entrance};}recordDeath(w,other);
 assert.ok(deathProof(w,owner,other.id));assert.equal(knowsPartnerDeath(w,tenant,other.id),false);inside(f);
 const notify={type:'funerary' as const,operation:'notify' as const,targetId:other.id,recipientId:tenant.id};
 tenant.activity={planId:'sleeping-tenant',action:{type:'sleep',buildingId:home.id,minutes:60},startedAt:w.minute,remaining:60,path:[],target:home.door,definition:w.activeDefinitions['action/routine']};
 assert.ok(completeFunerary(w,owner,notify));assert.equal(w.funerary!.notices.length,0);tenant.activity=null;
 run(w,owner,choose(w,owner,a=>a.type==='funerary'&&a.operation==='notify'&&a.targetId===other.id&&a.recipientId===tenant.id));
 assert.equal(w.funerary!.notices.length,1);assert.equal(knowsPartnerDeath(w,tenant,other.id),true);assert.equal(deathProof(w,tenant,other.id),undefined);
 assert.equal(tenant.inside,home.id);assert.deepEqual(home.residents,[]);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const saved=store.load()!,r=saved.residents.find(p=>p.id===tenant.id)!,o=saved.residents.find(p=>p.id===owner.id)!;assert.ok(residentialStay(saved,r.id,home.id));assert.equal(socialPresence(saved,o,r),true);assert.equal(knowsPartnerDeath(saved,r,other.id),true);assert.equal(deathProof(saved,r,other.id),undefined);}finally{store.close();}
});

test('residential social access uses live half-open lease facts before settlement updates stale status',()=>{
 for(const change of ['future','expiry','ended','unaccepted','withdrawn','damage','title','capacity','kind','outside','dead'] as const){const f=fixture(),{w,owner,tenant,home}=f,l=lease(f);inside(f);
  assert.equal(socialPresence(w,owner,tenant),true,change);
  danger(tenant);assert.equal(careAuthority(w,owner,tenant).allowed,true,change);
  if(change==='future')l.acceptedAt=w.minute+1;
  if(change==='expiry'){w.minute=l.endsAt!-.001;assert.equal(socialSpace(w,owner,tenant),true);w.minute=l.endsAt!;}
  if(change==='ended')l.endedAt=w.minute;
  if(change==='unaccepted')l.acceptedAt=null;
  if(change==='withdrawn')l.status='withdrawn';
  if(change==='damage')home.condition=0;
  if(change==='title')home.ownerId=f.other.id;
  if(change==='capacity')home.capacity=0;
  if(change==='kind')home.kind='workshop';
  if(change==='outside')tenant.residency='outside';
  if(change==='dead')tenant.status='dead';
  const state=JSON.stringify(w);assert.equal(socialSpace(w,owner,tenant),false,change);assert.equal(socialSpace(w,tenant,owner),false,change);assert.equal(JSON.stringify(w),state,'presence queries are read-only');
  const bag={...owner.inventory},health=tenant.health;assert.equal(executeSocialAction(w,owner,{type:'care',targetId:tenant.id}).ok,false);assert.deepEqual(owner.inventory,bag);assert.equal(tenant.health,health);
 }
});

test('an offered, declined or surrendered residential lease and a valid business lease do not confer residential social access',()=>{
 for(const mode of ['offered','declined','surrendered','business'] as const){const f=fixture(),{w,owner,tenant,home}=f;
  if(mode==='business'){home.kind='workshop';lease(f,{...terms,station:'table',startMinute:600,durationMinutes:120});assert.ok(currentPremisesLease(w,home.id));}
  else if(mode==='surrendered'){const l=lease(f);assert.equal(completePremises(w,tenant,{type:'premises',operation:'surrender',leaseId:l.id}),null);}
  else {assert.equal(completePremises(w,owner,{type:'premises',operation:'offer',buildingId:home.id,tenantId:tenant.id,terms}),null);if(mode==='declined')assert.equal(completePremises(w,tenant,{type:'premises',operation:'decline',leaseId:w.economy!.leases!.at(-1)!.id}),null);}
  const at=roomLayout(w,home).entry;for(const [i,p]of [owner,tenant].entries()){p.inside=home.id;p.roomAt={x:at.x+i,y:at.y};}
  assert.equal(socialSpace(w,owner,tenant),false,mode);assert.equal(socialSpace(w,tenant,owner),false,mode);
 }
});

test('rental rights never substitute for the same room, reachable short path or both participants own access',()=>{
 for(const change of ['outside','other-room','distance','detour','blocked','stranger'] as const){const f=fixture(),{w,owner,tenant,other,home}=f;lease(f);inside(f);
  if(change==='outside'){owner.inside=null;owner.roomAt=null;}
  if(change==='other-room')owner.inside=owner.homeId;
  if(change==='distance')owner.roomAt=roomLayout(w,home).entry;
  if(change==='detour'){owner.roomAt={x:10,y:11};tenant.roomAt={x:8,y:11};other.status='dead';other.roomAt={x:9,y:11};other.body={storedAt:home.id,carriedBy:null,reservedBy:null};assert.equal(roomPath(roomLayout(w,home),owner.roomAt,tenant.roomAt)?.length,4);}
  if(change==='blocked')owner.roomAt={x:1,y:4};
  if(change==='stranger'){other.inside=home.id;other.roomAt={...owner.roomAt!};}
  assert.equal(socialSpace(w,change==='stranger'?other:owner,tenant),false,change);
 }
});

test('expiry while queued care or a relationship reply is pending consumes no supplies and grants no retroactive consent',()=>{
 for(const kind of ['care','dating'] as const){const f=fixture(),{w,owner,tenant}=f,l=lease(f);inside(f);let actor=owner,action:Action;
  if(kind==='care'){danger(tenant);action=choose(w,owner,a=>a.type==='care'&&a.targetId===tenant.id);}
  else {run(w,owner,choose(w,owner,a=>a.type==='propose'&&a.proposal==='dating'&&a.targetId===tenant.id));const p=w.proposals.at(-1)!;actor=tenant;action=choose(w,tenant,a=>a.type==='respond'&&a.proposalId===p.id&&a.accept);}
  l.endsAt=w.minute+2;const bag={...owner.inventory};queue(w,actor,action);finish(w,actor);assert.ok(actor.lastFailure);assert.deepEqual(owner.inventory,bag);assert.equal(tenant.inside,f.home.id);assert.equal(owner.relations.find(r=>r.targetId===tenant.id)?.partner,undefined);assert.equal(w.proposals.some(p=>p.status==='accepted'),false);assert.equal(l.status,'expired');
 }
});
