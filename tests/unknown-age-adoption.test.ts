import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {adoptionOpportunities,adoptionReason,advanceAdoption,completeAdoption,initializeAdoption} from '../src/world/adoption.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import {careFixture,carePlan} from './helpers/care-meal-evidence.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {AdoptionAction,AdoptionAgreement} from '../src/shared/adoption.js';

function fixture(age=9){
 const {w,provider:adopter,beneficiary:child,other:guardian}=careFixture();
 const hall=structuredClone(createWorld().buildings.find(b=>b.kind==='lodge')!);
 hall.ownerId='commons';hall.at={x:15,y:6};hall.door={x:14,y:8};hall.condition=100;w.buildings=[hall];
 for(const r of w.residents){r.knownBuildings=[hall.id];r.hunger=0;if(r.agency)r.agency.focus='family';}
 guardian.at={...child.at};child.bornAt=w.minute-age*YEAR;child.parents=[guardian.id];child.guardianIds=[guardian.id];
 child.lifeStage=age<6?'infant':age<13?'child':age<18?'teen':'adult';child.canDecide=child.canExpress=age>=6;
 child.decisionDue=age<6?Number.MAX_SAFE_INTEGER:w.minute;child.lastDecisionAt=child.bornAt;
 initializeAdoption(w);return {w,adopter,child,guardian,hall};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
function selected(w:World,r:Resident,operation:AdoptionAction['operation'],accept=true):AdoptionAction {
 const choices=menu(w,r),choice=choices.find(c=>c.action.type==='adoption'&&c.action.operation===operation&&(operation!=='consent'||c.action.accept===accept));
 assert.ok(choice,`real numbered menu includes ${r.name} adoption ${operation} ${accept}`);assert.match(choice.id,/^\d+$/);
 return parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as AdoptionAction;
}
function queue(w:World,r:Resident,a:Action){assert.deepEqual(submitPlan(w,carePlan(w,r,[a])),{ok:true});}
function finish(w:World,r:Resident,success=true){let left=200;while(r.plan||r.activity){assert.ok(left-->0);stepWorld(w,.25);}if(success)assert.equal(r.lastFailure,null);else assert.ok(r.lastFailure);}
function choose(w:World,r:Resident,operation:AdoptionAction['operation'],accept=true){queue(w,r,selected(w,r,operation,accept));finish(w,r);}
function propose(f:ReturnType<typeof fixture>){choose(f.w,f.adopter,'propose');return f.w.adoption!.agreements.at(-1)!;}
const registration=(f:ReturnType<typeof fixture>,c:AdoptionAgreement):AdoptionAction=>({type:'adoption',operation:'register',adoptionId:c.id,buildingId:f.hall.id});
function has(w:World,r:Resident,operation:AdoptionAction['operation'],accept=true){return menu(w,r).some(c=>c.action.type==='adoption'&&c.action.operation===operation&&(operation!=='consent'||c.action.accept===accept));}
function assertUnchangedFamily(f:ReturnType<typeof fixture>){assert.equal(f.child.adoptiveParents,undefined);assert.deepEqual(f.child.guardianIds,[f.guardian.id]);assert.equal(f.w.events.filter(e=>e.populationChange==='adoption').length,0);}
const corruptions:Array<[string,(w:World)=>unknown]>=[['null',()=>null],['NaN',()=>NaN],['future',w=>w.minute+YEAR],['missing',()=>undefined],['string',()=> '0'],['infinity',()=>Infinity],['unsafe',()=>-Number.MAX_SAFE_INTEGER-1]];

for(const [name,bad] of corruptions)test(`adoption unknown ${name}: no new proposal or infant exemption from actual menu or direct completion`,()=>{
 const f=fixture(2);f.child.bornAt=bad(f.w) as number;const before=structuredClone(f.w.adoption);
 assert.equal(has(f.w,f.adopter,'propose'),false);
 assert.ok(completeAdoption(f.w,f.adopter,{type:'adoption',operation:'propose',childId:f.child.id}));
 assert.deepEqual(f.w.adoption,before);assertUnchangedFamily(f);
});

for(const [name,bad] of corruptions.slice(0,3))test(`adoption old proposal ${name}: preserve evidence and deadline, recover at six only with real independent assent`,()=>{
 const f=fixture(2),{w,adopter,child,guardian}=f,c=propose(f);choose(w,guardian,'consent');
 child.bornAt=bad(w) as number;const before=structuredClone(c);
 for(const r of [adopter,child,guardian]){menu(w,r);adoptionOpportunities(w,r);}
 advanceAdoption(w);stepWorld(w,.25);assert.deepEqual(c,before);
 assert.equal(has(w,adopter,'register'),false);assert.ok(completeAdoption(w,adopter,registration(f,c)));assertUnchangedFamily(f);
 assert.equal(c.childAssentedAt,null);assert.equal(child.canDecide,false);assert.equal(child.canExpress,false);
 child.bornAt=w.minute-6*YEAR;stepWorld(w,.25);assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
 assert.equal(has(w,adopter,'register'),false);choose(w,child,'consent');assert.ok(c.childAssentedAt!==null);
 assert.equal(c.id,before.id);assert.equal(c.expiresAt,before.expiresAt);assert.deepEqual(c.signatures.slice(0,2),before.signatures);
 choose(w,adopter,'register');assert.equal(c.status,'registered');assert.deepEqual(child.adoptiveParents,[adopter.id]);
 assert.equal(w.events.filter(e=>e.populationChange==='adoption').length,1);
});

for(const operation of ['propose','consent','register'] as const)for(const [name,bad] of corruptions.slice(0,3))test(`adoption ${operation} last quarter ${name}: completion cannot grant authority`,()=>{
 const f=fixture(2),{w,adopter,guardian,child}=f;
 const c=operation==='propose'?undefined:propose(f);
 if(operation==='register'){choose(w,guardian,'consent');adopter.at={...f.hall.door};}
 const actor=operation==='consent'?guardian:adopter,a=selected(w,actor,operation),before=c&&structuredClone(c);
 queue(w,actor,a);stepWorld(w,operation==='register'?14.75:4.75);assert.equal(actor.activity?.remaining,.25);
 child.bornAt=bad(w) as number;stepWorld(w,.25);assert.ok(actor.lastFailure);assert.equal(actor.activity,null);
 if(c)assert.deepEqual(c,before);else assert.equal(w.adoption!.agreements.length,0);
 assertUnchangedFamily(f);
});

test('adoption travelling registration pauses immediately on unknown age, and recovery does not silently restart it',()=>{
 const f=fixture(2),{w,adopter,guardian,child}=f,c=propose(f);choose(w,guardian,'consent');
 const bornAt=child.bornAt;queue(w,adopter,selected(w,adopter,'register'));stepWorld(w,.25);assert.ok(adopter.activity?.path.length);
 const at=structuredClone(adopter.at),evidence=structuredClone(c);child.bornAt=NaN;stepWorld(w,.25);
 assert.equal(adopter.activity,null);assert.equal(adopter.plan,null);assert.ok(adopter.lastFailure);assert.deepEqual(adopter.at,at);assert.deepEqual(c,evidence);
 child.bornAt=bornAt;stepWorld(w,20);assert.equal(c.status,'pending');assertUnchangedFamily(f);
 choose(w,adopter,'register');assert.equal(c.status,'registered');assert.equal(c.childAssentedAt,null);
});

for(const who of ['child','guardian','adopter'] as const)for(const operation of ['consent','withdraw'] as const){
 if(who==='adopter'&&operation==='consent')continue;
 test(`adoption unknown age preserves ${who} ${operation==='consent'?'refusal':'withdrawal'} through numbered engine`,()=>{
  const f=fixture(),{w,child,adopter,guardian}=f,c=propose(f);choose(w,guardian,'consent');choose(w,child,'consent');
  const stale=selected(w,adopter,'register'),bornAt=child.bornAt,evidence=structuredClone(c.signatures);child.bornAt=null as unknown as number;
  stepWorld(w,.25);assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);assert.equal(has(w,adopter,'register'),false);
  choose(w,f[who],operation,false);assert.equal(c.status,operation==='consent'?'declined':'withdrawn');
  assert.deepEqual(c.signatures,evidence);child.bornAt=bornAt;advanceAdoption(w);assert.ok(completeAdoption(w,adopter,stale));assertUnchangedFamily(f);
 });
}

for(const [name,bad] of corruptions.slice(0,3))test(`adoption memory SQLite ${name}: neither reload nor advance turns unknown birth into toddler authority`,()=>{
 const f=fixture(2),c=propose(f);choose(f.w,f.guardian,'consent');f.child.bornAt=bad(f.w) as number;
 const evidence=structuredClone(c),store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,child=w.residents.find(r=>r.id===f.child.id)!,guardian=w.residents.find(r=>r.id===f.guardian.id)!,adopter=w.residents.find(r=>r.id===f.adopter.id)!,restored=w.adoption!.agreements[0];
  assert.equal(child.bornAt,name==='future'?f.child.bornAt:null);advanceAdoption(w);stepWorld(w,.25);assert.deepEqual(restored,evidence);
  assert.equal(has(w,adopter,'register'),false);assert.ok(completeAdoption(w,adopter,registration(f,restored)));assert.equal(restored.childAssentedAt,null);
  assert.deepEqual(child.guardianIds,[guardian.id]);child.bornAt=w.minute-9*YEAR;stepWorld(w,.25);
  assert.equal(has(w,adopter,'register'),false);choose(w,child,'consent');choose(w,adopter,'register');assert.equal(restored.status,'registered');
  assert.equal(restored.expiresAt,evidence.expiresAt);assert.deepEqual(child.adoptiveParents,[adopter.id]);
 }finally{store.close();}
});

test('adoption historical personal assent survives unknown age without resigning after valid age recovery',()=>{
 const f=fixture(),{w,adopter,guardian,child}=f,c=propose(f);choose(w,guardian,'consent');choose(w,child,'consent');
 const evidence=structuredClone(c),bornAt=child.bornAt;child.bornAt=NaN;advanceAdoption(w);
 assert.deepEqual(c,evidence);assert.equal(has(w,adopter,'register'),false);child.bornAt=bornAt;
 assert.equal(has(w,child,'consent'),false);choose(w,adopter,'register');assert.deepEqual(c.signatures,evidence.signatures);assert.equal(c.childAssentedAt,evidence.childAssentedAt);
});

for(const reverse of [false,true])test(`adoption simultaneous refusal and registration with unknown birth is safe in either resident order ${reverse}`,()=>{
 const f=fixture(),{w,adopter,child,guardian}=f,c=propose(f);choose(w,guardian,'consent');choose(w,child,'consent');
 for(const r of [adopter,child,guardian])r.at={...f.hall.door};
 queue(w,adopter,selected(w,adopter,'register'));stepWorld(w,10);queue(w,child,selected(w,child,'consent',false));stepWorld(w,4.75);
 assert.equal(adopter.activity?.remaining,.25);assert.equal(child.activity?.remaining,.25);if(reverse)w.residents.reverse();
 child.bornAt=null as unknown as number;stepWorld(w,.25);assert.equal(c.status,'declined');assert.ok(adopter.lastFailure);assert.equal(child.lastFailure,null);assertUnchangedFamily(f);
});

test('adoption unknown pending record still expires at the original deadline; restored adulthood keeps adult exclusion',()=>{
 for(const adult of [false,true]){
  const f=fixture(),c=propose(f);f.child.bornAt=NaN;advanceAdoption(f.w);assert.equal(c.status,'pending');
  if(adult)f.child.bornAt=f.w.minute-18*YEAR;else f.w.minute=c.expiresAt;
  assert.equal(has(f.w,f.adopter,'register'),false);advanceAdoption(f.w);assert.equal(c.status,'expired');assertUnchangedFamily(f);
 }
 const f=fixture(18);assert.equal(has(f.w,f.adopter,'propose'),false);
});

test('adoption original toddler and older-child rules still use actual signatures and physical registry work',()=>{
 for(const age of [2,6,9,17]){
  const f=fixture(age),{w,adopter,child,guardian}=f,c=propose(f);choose(w,guardian,'consent');
  assert.equal(has(w,adopter,'register'),age<6);assert.equal(c.childAssentedAt,null);
  if(age>=6)choose(w,child,'consent');choose(w,adopter,'register');assert.equal(c.status,'registered');
  assert.equal(c.childAssentedAt===null,age<6);assert.deepEqual(child.guardianIds,[guardian.id,adopter.id]);
  child.bornAt=NaN;advanceAdoption(w);assert.equal(c.status,'registered');assert.deepEqual(child.adoptiveParents,[adopter.id]);
 }
});

test('adoption unknown adopter age blocks positive authority but preserves the original parties withdrawal',()=>{
 const f=fixture(),{w,adopter,guardian,child}=f,c=propose(f),before=structuredClone(c);adopter.bornAt=NaN;
 assert.equal(has(w,guardian,'consent'),false);assert.ok(adoptionReason(w,guardian,{type:'adoption',operation:'consent',adoptionId:c.id,accept:true}));
 advanceAdoption(w);assert.deepEqual(c,before);choose(w,adopter,'withdraw');assert.equal(c.status,'withdrawn');assertUnchangedFamily(f);
 assert.ok(completeAdoption(w,child,{type:'adoption',operation:'consent',adoptionId:c.id,accept:true}));
});

for(const [name,bad] of corruptions.slice(0,3))test(`adoption guardian own ${name} age cannot finish a stale signature but can still refuse`,()=>{
 const f=fixture(),{w,guardian}=f,c=propose(f),before=structuredClone(c),action=selected(w,guardian,'consent');
 queue(w,guardian,action);stepWorld(w,4.75);assert.equal(guardian.activity?.remaining,.25);guardian.bornAt=bad(w) as number;
 stepWorld(w,.25);assert.ok(guardian.lastFailure);assert.deepEqual(c,before);assert.ok(completeAdoption(w,guardian,action));
 assert.equal(has(w,guardian,'consent'),false);choose(w,guardian,'consent',false);assert.equal(c.status,'declined');assertUnchangedFamily(f);
});

test('adoption child own signature selected while age is known is not written after birth becomes unknown',()=>{
 const f=fixture(),{w,child}=f,c=propose(f),before=structuredClone(c);queue(w,child,selected(w,child,'consent'));stepWorld(w,4.75);
 child.bornAt=NaN;stepWorld(w,.25);assert.ok(child.lastFailure);assert.deepEqual(c,before);assert.equal(c.childAssentedAt,null);assertUnchangedFamily(f);
});

for(const at of [undefined,null,NaN,Infinity,0,Number.MAX_SAFE_INTEGER])test(`adoption recovery never interprets a missing or malformed old child assent ${at} as a signature`,()=>{
 const f=fixture(),{w,guardian,child,adopter}=f,c=propose(f);choose(w,guardian,'consent');
 c.childAssentedAt=at as number;child.bornAt=NaN;const before=structuredClone(c);advanceAdoption(w);assert.deepEqual(c,before);
 child.bornAt=w.minute-9*YEAR;assert.equal(has(w,adopter,'register'),false);assert.ok(completeAdoption(w,adopter,registration(f,c)));
 assert.deepEqual(c,before);choose(w,child,'consent');choose(w,adopter,'register');assert.equal(c.status,'registered');
});
