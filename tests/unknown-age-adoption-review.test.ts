import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {adoptionOpportunities,adoptionReason,advanceAdoption,completeAdoption,initializeAdoption} from '../src/world/adoption.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitEvent} from '../src/world/events.js';
import {YEAR} from '../src/world/time.js';
import {careFixture,carePlan} from './helpers/care-meal-evidence.js';
import type {Resident,World} from '../src/shared/types.js';
import type {AdoptionAction,AdoptionAgreement} from '../src/shared/adoption.js';

function fixture(age=9){
 const {w,provider:adopter,beneficiary:child,other:guardian}=careFixture();
 const hall=structuredClone(createWorld().buildings.find(b=>b.kind==='lodge')!);
 hall.ownerId='commons';hall.at={x:15,y:6};hall.door={x:14,y:8};hall.condition=100;w.buildings=[hall];
 for(const r of w.residents){r.knownBuildings=[hall.id];r.hunger=0;r.at={x:11,y:8};if(r.agency)r.agency.focus='family';}
 child.bornAt=w.minute-age*YEAR;child.parents=[guardian.id];child.guardianIds=[guardian.id];
 child.canDecide=child.canExpress=age>=6;child.lifeStage=age<6?'infant':age<13?'child':age<18?'teen':'adult';
 child.decisionDue=age<6?Number.MAX_SAFE_INTEGER:w.minute;child.lastDecisionAt=child.bornAt;
 initializeAdoption(w);return {w,adopter,child,guardian,hall};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
const matches=(a:AdoptionAction,operation:AdoptionAction['operation'],accept=true)=>a.operation===operation&&(operation!=='consent'||a.accept===accept);
function has(w:World,r:Resident,operation:AdoptionAction['operation'],accept=true){return menu(w,r).some(c=>c.action.type==='adoption'&&matches(c.action,operation,accept));}
function select(w:World,r:Resident,operation:AdoptionAction['operation'],accept=true){
 const choices=menu(w,r),choice=choices.find(c=>c.action.type==='adoption'&&matches(c.action,operation,accept));
 assert.ok(choice,`${r.id}: real numbered adoption ${operation}/${accept}`);assert.match(choice.id,/^\d+$/);
 return parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as AdoptionAction;
}
function queue(w:World,r:Resident,a:AdoptionAction){assert.deepEqual(submitPlan(w,carePlan(w,r,[a])),{ok:true});}
function finish(w:World,r:Resident){let budget=300;while(r.plan||r.activity){assert.ok(budget-->0);stepWorld(w,.25);}assert.equal(r.lastFailure,null);}
function choose(w:World,r:Resident,operation:AdoptionAction['operation'],accept=true){queue(w,r,select(w,r,operation,accept));finish(w,r);}
function propose(f:ReturnType<typeof fixture>){choose(f.w,f.adopter,'propose');return f.w.adoption!.agreements.at(-1)!;}
function signed(f:ReturnType<typeof fixture>){const c=propose(f);choose(f.w,f.guardian,'consent');if(f.child.canDecide)choose(f.w,f.child,'consent');return c;}
const register=(f:ReturnType<typeof fixture>,c:AdoptionAgreement):AdoptionAction=>({type:'adoption',operation:'register',adoptionId:c.id,buildingId:f.hall.id});
function noFamilyWrite(f:ReturnType<typeof fixture>){assert.equal(f.child.adoptiveParents,undefined);assert.deepEqual(f.child.guardianIds,[f.guardian.id]);assert.equal(f.w.events.filter(e=>e.populationChange==='adoption').length,0);}
const invalidBirths:Array<[string,(w:World)=>number]>=[['null',()=>null as unknown as number],['NaN',()=>NaN],['future',w=>w.minute+YEAR]];

for(const who of ['child','adopter','guardian'] as const)for(const [name,bad] of invalidBirths)test(`adoption review: ${who} ${name} cannot create a permanent proposal`,()=>{
 const f=fixture(2);f[who].bornAt=bad(f.w);const before=structuredClone(f.w.adoption);
 assert.equal(has(f.w,f.adopter,'propose'),false);
 assert.ok(completeAdoption(f.w,f.adopter,{type:'adoption',operation:'propose',childId:f.child.id}));
 assert.deepEqual(f.w.adoption,before);noFamilyWrite(f);
});

for(const age of [2,6,17,18])test(`adoption review: known age ${age} uses its real authorization branch`,()=>{
 const f=fixture(age),{w,child,guardian,adopter}=f;
 if(age===18){assert.equal(has(w,adopter,'propose'),false);return;}
 const c=propose(f);choose(w,guardian,'consent');assert.equal(c.childAssentedAt,null);
 assert.equal(has(w,adopter,'register'),age<6);
 if(age>=6){choose(w,child,'consent');assert.ok(c.signatures.some(s=>s.personId===child.id&&s.at===c.childAssentedAt));}
 choose(w,adopter,'register');assert.equal(c.status,'registered');assert.deepEqual(child.adoptiveParents,[adopter.id]);
 assert.equal(c.childAssentedAt===null,age<6);assert.ok(completeAdoption(w,adopter,register(f,c)));
 assert.equal(w.events.filter(e=>e.populationChange==='adoption').length,1);
});

for(const malformed of ['missingSignature','wrongPerson','mismatchedTime','beforeProposal','future','atExpiry','NaN','beforeSix','missingEvent','wrongEvent','guardianEventAsChild'] as const)test(`adoption review: invalid historical personal assent ${malformed} requires a new actual child choice`,()=>{
 const f=fixture(),{w,child,adopter}=f,c=signed(f);
 const signature=c.signatures.find(s=>s.personId===child.id)!;
 if(malformed==='missingSignature')c.signatures=c.signatures.filter(s=>s!==signature);
 if(malformed==='wrongPerson')signature.personId='not-this-child';
 if(malformed==='mismatchedTime')signature.at-=.25;
 if(malformed==='beforeProposal')c.childAssentedAt=signature.at=c.createdAt-.25;
 if(malformed==='future')c.childAssentedAt=signature.at=w.minute+.25;
 if(malformed==='atExpiry')c.childAssentedAt=signature.at=c.expiresAt;
 if(malformed==='NaN')c.childAssentedAt=signature.at=NaN;
 if(malformed==='missingEvent')signature.eventId='nonexistent-personal-assent';
 if(malformed==='wrongEvent')signature.eventId=c.signatures.find(s=>s.personId===f.guardian.id)!.eventId;
 if(malformed==='guardianEventAsChild'){
  const guardianSignature=c.signatures.find(s=>s.personId===f.guardian.id)!;
  signature.eventId=guardianSignature.eventId;c.childAssentedAt=signature.at=guardianSignature.at;
 }
 if(malformed==='beforeSix'){
  child.bornAt=signature.at+.25-6*YEAR;
  w.minute+=.5;
 }
 const evidence=structuredClone(c),birth=child.bornAt;
 child.bornAt=null as unknown as number;advanceAdoption(w);assert.deepEqual(c,evidence);
 child.bornAt=birth;
 assert.equal(has(w,adopter,'register'),false,'the current child age does not authenticate a malformed past signature');
 assert.ok(completeAdoption(w,adopter,register(f,c)));assert.deepEqual(c,evidence);noFamilyWrite(f);
 choose(w,child,'consent');choose(w,adopter,'register');assert.equal(c.status,'registered');
 assert.deepEqual(c.signatures.slice(0,evidence.signatures.length),evidence.signatures);
});

for(const who of ['child','guardian','adopter'] as const)test(`adoption review: ${who} withdrawal remains a real choice with unknown ages, not proxy authority`,()=>{
 const f=fixture(),{w,child,adopter,guardian}=f,c=signed(f),stale=register(f,c),before=structuredClone(c.signatures);
 child.bornAt=NaN;adopter.bornAt=null as unknown as number;guardian.bornAt=w.minute+YEAR;
 assert.equal(has(w,adopter,'register'),false);assert.equal(has(w,guardian,'consent'),false);assert.equal(has(w,child,'consent'),false);
 const actor=f[who];actor.canExpress=false;assert.equal(has(w,actor,'withdraw'),false);
 actor.canExpress=true;choose(w,actor,'withdraw');assert.equal(c.status,'withdrawn');assert.deepEqual(c.signatures,before);
 child.bornAt=w.minute-9*YEAR;adopter.bornAt=guardian.bornAt=w.minute-30*YEAR;
 advanceAdoption(w);assert.ok(completeAdoption(w,adopter,stale));noFamilyWrite(f);
});

for(const who of ['child','guardian'] as const)test(`adoption review: ${who} refusal needs original identity and physical presence even with unknown age`,()=>{
 const f=fixture(),{w,adopter,child,guardian}=f,c=propose(f),actor=f[who];child.bornAt=NaN;guardian.bornAt=NaN;
 actor.at={x:1,y:16};assert.equal(has(w,actor,'consent',false),false);actor.at={...adopter.at};
 const outsider=structuredClone(adopter);outsider.id='unrelated-person';w.residents.push(outsider);
 assert.ok(adoptionReason(w,outsider,{type:'adoption',operation:'consent',adoptionId:c.id,accept:false}));
 choose(w,actor,'consent',false);assert.equal(c.status,'declined');noFamilyWrite(f);
});

for(const [name,bad] of invalidBirths)test(`adoption review: ${name} during registration travel survives reload without movement or automatic recovery`,()=>{
 const f=fixture(),{w,adopter,child}=f,c=signed(f),birth=child.bornAt;
 queue(w,adopter,select(w,adopter,'register'));stepWorld(w,.25);assert.ok(adopter.activity?.path.length);
 const position=structuredClone(adopter.at),record=structuredClone(c);child.bornAt=bad(w);
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);const loaded=store.loadForRuntime()!,a=loaded.residents.find(r=>r.id===adopter.id)!,p=loaded.residents.find(r=>r.id===child.id)!;
  const restored=loaded.adoption!.agreements.find(x=>x.id===c.id)!;
  assert.ok(a.activity);stepWorld(loaded,.25);assert.equal(a.activity,null);assert.equal(a.plan,null);assert.ok(a.lastFailure);
  assert.deepEqual(a.at,position);assert.deepEqual(restored,record);assert.equal(p.adoptiveParents,undefined);
  p.bornAt=birth;stepWorld(loaded,1);assert.equal(restored.status,'pending');assert.equal(a.activity,null);
  assert.equal(has(loaded,p,'consent'),false,'a genuine old signature remains usable');
  choose(loaded,a,'register');assert.equal(restored.status,'registered');assert.deepEqual(restored.signatures,record.signatures);
  assert.equal(restored.expiresAt,record.expiresAt);assert.equal(loaded.events.filter(e=>e.populationChange==='adoption').length,1);
 }finally{store.close();}
});

for(const who of ['child','adopter'] as const)for(const [name,bad] of invalidBirths)test(`adoption review: ${who} ${name} in the final registry quarter cannot create kinship`,()=>{
 const f=fixture(),{w,adopter}=f,c=signed(f),birth=f[who].bornAt;adopter.at={...f.hall.door};
 queue(w,adopter,select(w,adopter,'register'));stepWorld(w,14.75);assert.equal(adopter.activity?.remaining,.25);
 const evidence=structuredClone(c);f[who].bornAt=bad(w);stepWorld(w,.25);
 assert.ok(adopter.lastFailure);assert.equal(adopter.activity,null);assert.equal(adopter.plan,null);assert.deepEqual(c,evidence);noFamilyWrite(f);
 f[who].bornAt=birth;stepWorld(w,.25);assert.equal(c.status,'pending');assert.equal(adopter.activity,null);
 choose(w,adopter,'register');assert.equal(c.status,'registered');assert.deepEqual(c.signatures,evidence.signatures);
});

test('adoption review: authentic guardian consent survives later unknown guardian age without a replacement signature',()=>{
 const f=fixture(),{w,guardian,adopter}=f,c=signed(f),evidence=structuredClone(c);
 guardian.bornAt=NaN;assert.equal(has(w,guardian,'consent'),false);choose(w,adopter,'register');
 assert.equal(c.status,'registered');assert.deepEqual(c.signatures,evidence.signatures);assert.equal(c.expiresAt,evidence.expiresAt);
});

test('adoption review: sixth birthday in the final registry quarter revokes only the infant exemption',()=>{
 const f=fixture(2),{w,adopter,child,guardian}=f,c=signed(f);adopter.at={...f.hall.door};
 const birthday=w.minute+15;child.bornAt=birthday-6*YEAR;
 queue(w,adopter,select(w,adopter,'register'));stepWorld(w,14.75);assert.equal(adopter.activity?.remaining,.25);
 const evidence=structuredClone(c);stepWorld(w,.25);assert.ok(adopter.lastFailure);assert.deepEqual(c,evidence);noFamilyWrite(f);
 assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
 for(const r of [adopter,child,guardian])r.at={...f.hall.door};
 choose(w,child,'consent');choose(w,adopter,'register');assert.equal(c.status,'registered');
});

test('adoption review: registration finishing exactly at the original deadline cannot register',()=>{
 const f=fixture(),{w,adopter}=f,c=signed(f);adopter.at={...f.hall.door};w.minute=c.expiresAt-15;
 queue(w,adopter,select(w,adopter,'register'));stepWorld(w,14.75);assert.equal(adopter.activity?.remaining,.25);
 const signatures=structuredClone(c.signatures),expiry=c.expiresAt;stepWorld(w,.25);
 assert.equal(w.minute,expiry);assert.equal(c.status,'expired');assert.ok(adopter.lastFailure);assert.equal(adopter.activity,null);
 assert.deepEqual(c.signatures,signatures);assert.equal(c.expiresAt,expiry);noFamilyWrite(f);
});

for(const ending of ['expiry','eighteenthBirthday','death','outside'] as const)test(`adoption review: unknown-age pause does not renew or prevent original ${ending} invalidation`,()=>{
 const f=fixture(),{w,child,adopter}=f,c=signed(f),oldExpiry=c.expiresAt;
 child.bornAt=NaN;advanceAdoption(w);assert.equal(c.status,'pending');
 if(ending==='expiry')w.minute=c.expiresAt;
 if(ending==='eighteenthBirthday')child.bornAt=w.minute-18*YEAR;
 if(ending==='death')child.status='dead';
 if(ending==='outside')child.residency='outside';
 assert.equal(has(w,adopter,'register'),false);advanceAdoption(w);assert.equal(c.status,'expired');assert.equal(c.expiresAt,oldExpiry);
 child.status='alive';child.residency='resident';child.bornAt=w.minute-9*YEAR;
 assert.ok(completeAdoption(w,adopter,register(f,c)));noFamilyWrite(f);
});

test('adoption review: read-only unknown-age menus and advance preserve every proposal evidence field',()=>{
 const f=fixture(),{w,child}=f,c=signed(f);c.reason='historical note';child.bornAt=NaN;
 const evidence=structuredClone(c),events=w.events.length;
 for(let i=0;i<3;i++)for(const r of w.residents){adoptionOpportunities(w,r);menu(w,r);advanceAdoption(w);}
 assert.deepEqual(c,evidence);assert.equal(w.events.length,events);assert.ok(Number.isNaN(child.bornAt));noFamilyWrite(f);
});

test('adoption review: genuine child assent remains verifiable after memory turnover, working-history trim and SQLite reload',()=>{
 const f=fixture(),{w,adopter,child}=f,c=signed(f),evidence=structuredClone(c),birth=child.bornAt;
 w.minute+=60;
 for(let i=0;i<205;i++)emitEvent(w,{kind:'conversation',actors:[f.guardian.id],place:{...f.guardian.at},text:`Unrelated synthetic review event ${i}`});
 for(const r of w.residents)r.memories=[];
 w.events=workingEvents(w);
 assert.ok(c.signatures.every(s=>w.events.some(e=>e.id===s.eventId)));
 child.bornAt=NaN;advanceAdoption(w);assert.deepEqual(c,evidence);
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);const loaded=store.loadForRuntime()!,p=loaded.residents.find(r=>r.id===child.id)!,a=loaded.residents.find(r=>r.id===adopter.id)!;
  const restored=loaded.adoption!.agreements.find(x=>x.id===c.id)!;
  assert.deepEqual(restored,evidence);assert.ok(restored.signatures.every(s=>loaded.events.some(e=>e.id===s.eventId)));
  assert.equal(has(loaded,a,'register'),false);p.bornAt=birth;
  assert.equal(has(loaded,p,'consent'),false);choose(loaded,a,'register');advanceAdoption(loaded);
  assert.equal(restored.status,'registered');assert.deepEqual(restored.signatures,evidence.signatures);assert.equal(restored.childAssentedAt,evidence.childAssentedAt);
  assert.equal(loaded.events.filter(e=>e.populationChange==='adoption').length,1);assert.deepEqual(p.adoptiveParents,[a.id]);
 }finally{store.close();}
});
