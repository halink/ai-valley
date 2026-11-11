import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld} from '../src/world/engine.js';
import {advanceFamilyRelocation,completeFamilyRelocation,familyRelocationReason} from '../src/world/family-relocation.js';
import {YEAR} from '../src/world/time.js';
import type {Resident,World} from '../src/shared/types.js';
import type {FamilyRelocation,FamilyRelocationAction} from '../src/shared/family-relocation.js';
import {familyJourneyMealFixture,chooseFamilyJourney,finishFamilyJourneyChoice,acceptFamilyJourney,departFamilyJourney} from './helpers/family-journey-meal-evidence.js';

function fixture(age=3){const f=familyJourneyMealFixture();f.child.bornAt=f.w.minute-age*YEAR;f.child.canDecide=f.child.canExpress=age>=6;f.child.lifeStage=age<6?'infant':'child';for(const p of f.w.residents){p.agency??={focus:null,goals:[],routines:[],nextSerial:1};p.agency.focus='family';}return f;}
function menu(w:World,r:Resident){return decisionChoices(decisionContext(w,r)).filter(c=>c.action.type==='familyRelocation');}
function has(w:World,r:Resident,operation:FamilyRelocationAction['operation']){return menu(w,r).some(c=>c.action.type==='familyRelocation'&&c.action.operation===operation);}
function corrupt(r:Resident,value:unknown){Object.assign(r,{bornAt:value,canDecide:true,canExpress:true});}
function terms(c:FamilyRelocation){return structuredClone({id:c.id,createdAt:c.createdAt,departAfter:c.departAfter,departBefore:c.departBefore,expiresAt:c.expiresAt,members:c.members.map(({escorting,arrivedAt,arrivalEventId,...m})=>m),requiredSignerIds:c.requiredSignerIds});}
function state(w:World){return structuredClone(w.residents.map(p=>({id:p.id,at:p.at,inside:p.inside,roomAt:p.roomAt,homeId:p.homeId,inventory:p.inventory,coins:p.coins})));}
function finishBlocked(w:World,r:Resident){for(let n=0;(r.plan||r.activity)&&n<100;n++)stepWorld(w,.25);assert.ok(r.lastFailure);assert.equal(r.plan,null);assert.equal(r.activity,null);}
function run(w:World,r:Resident,op:FamilyRelocationAction['operation'],predicate:(a:FamilyRelocationAction)=>boolean=()=>true){chooseFamilyJourney(w,r,op,predicate);return finishFamilyJourneyChoice(w,r);}
const corruptions:[string,unknown][]=[['null',null],['missing',undefined],['NaN',NaN],['positive infinity',Infinity],['negative infinity',-Infinity],['string','-10000'],['object',{}],['future',Number.MAX_SAFE_INTEGER],['unresolvable',-Number.MAX_SAFE_INTEGER-1]];

for(const [name,value] of corruptions)test(`unknown relocation age cannot create an infant signature exemption or escort (${name})`,()=>{
 const f=fixture(7);corrupt(f.child,value);const before=state(f.w);
 assert.equal(has(f.w,f.parent,'propose'),false);
 const a:FamilyRelocationAction={type:'familyRelocation',operation:'propose',memberIds:[f.parent.id,f.child.id],buildingId:f.home.id,departAfter:f.w.minute+5,departBefore:f.w.minute+240};
 assert.ok(completeFamilyRelocation(f.w,f.parent,a));assert.deepEqual(state(f.w),before);assert.equal(f.w.familyRelocation!.agreements.length,0);assert.equal(f.child.bornAt,value);
});

test('unknown parent, owner or leaving dependent cannot silently establish adult or guardian authority',()=>{
 for(const role of ['parent','owner','dependent'] as const){const f=fixture();
  if(role==='dependent'){const p=structuredClone(f.child);p.id='unknown-dependent';p.knownPeople=[];f.w.residents.push(p);f.parent.knownPeople.push(p.id);corrupt(p,null);}
  else corrupt(f[role],null);
  const before=state(f.w);assert.equal(has(f.w,f.parent,'propose'),false);
  assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'propose',memberIds:[f.parent.id,f.child.id],buildingId:f.home.id,departAfter:f.w.minute+5,departBefore:f.w.minute+240}));assert.deepEqual(state(f.w),before);
 }
});

for(const [name,value] of [['null',null],['future',1e8],['missing',undefined]] as const)test(`existing infant contract stays intact and own refusal remains executable after ${name} age`,()=>{
 const f=fixture(),c=acceptFamilyJourney(f),original=terms(c),before=state(f.w);corrupt(f.child,value);
 for(const op of ['escort','depart','resume','arrive','returnChild'] as const)assert.equal(has(f.w,f.parent,op),false,op);
 assert.equal(has(f.w,f.child,'accept'),false);assert.equal(has(f.w,f.child,'withdraw'),true);
 assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}));assert.deepEqual(state(f.w),before);assert.deepEqual(terms(c),original);
 run(f.w,f.child,'withdraw');assert.equal(c.status,'cancelled');assert.deepEqual(terms(c),original);assert.deepEqual(state(f.w),before);assert.equal(has(f.w,f.parent,'returnChild'),false);
});

test('unknown age preserves the original expiry rather than creating a new proposal or consent',()=>{
 const f=fixture(),c=acceptFamilyJourney(f),original=terms(c),signatures=structuredClone(c.signatures),before=state(f.w);corrupt(f.child,null);
 f.w.minute=c.expiresAt;advanceFamilyRelocation(f.w,.25);assert.equal(c.status,'expired');assert.equal(c.endedAt,original.expiresAt);assert.deepEqual(c.signatures,signatures);assert.deepEqual(terms(c),original);assert.deepEqual(state(f.w),before);assert.equal(f.w.familyRelocation!.agreements.length,1);
});

test('sixth birthday before the last original signature requires the real child choice without changing terms',()=>{
 const f=fixture(5);run(f.w,f.parent,'propose',a=>a.operation==='propose'&&a.buildingId===f.home.id);const c=f.w.familyRelocation!.agreements[0],original=terms(c);
 f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=true;run(f.w,f.owner,'accept');assert.equal(c.status,'proposed');assert.equal(c.signatures.some(s=>s.personId===f.child.id),false);
 const before=JSON.stringify(c);assert.equal(has(f.w,f.child,'accept'),true);assert.equal(JSON.stringify(c),before,'menu does not add signatures or rewrite the original signer list');
 run(f.w,f.child,'accept');assert.equal(c.status,'accepted');assert.equal(c.signatures.filter(s=>s.personId===f.child.id).length,1);assert.deepEqual(terms(c),original);assert.equal(has(f.w,f.parent,'escort'),false);
});

test('accepted infant agreement can receive the newly required real signature on its unchanged original terms',()=>{
 const f=fixture(5),c=acceptFamilyJourney(f),original=terms(c);f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=true;
 assert.equal(has(f.w,f.parent,'depart'),false);run(f.w,f.child,'accept');assert.equal(c.status,'accepted');assert.deepEqual(terms(c),original);assert.equal(has(f.w,f.parent,'depart'),true);
 run(f.w,f.parent,'depart');for(let n=0;String(c.status)==='travelling'&&n<100;n++)stepWorld(f.w,.25);assert.equal(c.status,'arrived');
 run(f.w,f.parent,'arrive',a=>a.operation==='arrive'&&a.personId===f.parent.id);assert.equal(f.child.homeId,f.old.id);assert.equal(has(f.w,f.parent,'arrive'),false);
 run(f.w,f.child,'arrive',a=>a.operation==='arrive'&&a.personId===f.child.id);assert.equal(c.status,'completed');assert.equal(f.child.homeId,f.home.id);
});

test('sixth birthday with missing capabilities never turns into a guardian passenger permission',()=>{
 const f=fixture(5),c=acceptFamilyJourney(f),original=terms(c);f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=false;
 const before=state(f.w);for(const op of ['escort','depart','arrive','returnChild'] as const)assert.equal(has(f.w,f.parent,op),false,op);
 assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}));assert.deepEqual(state(f.w),before);assert.deepEqual(terms(c),original);
 f.child.canDecide=f.child.canExpress=true;assert.equal(has(f.w,f.parent,'escort'),false);run(f.w,f.child,'accept');assert.equal(has(f.w,f.parent,'depart'),true);
});

for(const mode of ['bad date','birthday','capability'] as const)test(`departure final work revalidates ${mode} before any supplies or movement`,()=>{
 const f=fixture(mode==='capability'?7:5),c=acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');stepWorld(f.w,.25);assert.equal(f.parent.activity?.action.type,'familyRelocation');assert.equal(c.status,'accepted');
 if(mode==='bad date')corrupt(f.child,null);else if(mode==='birthday'){f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=true;}else f.child.canExpress=false;
 const before=state(f.w),original=terms(c);finishBlocked(f.w,f.parent);assert.equal(c.status,'accepted');assert.equal(c.startedAt,null);assert.deepEqual(state(f.w),before);assert.deepEqual(terms(c),original);
});

for(const mode of ['bad date','birthday','capability'] as const)test(`travelling contract pauses before the next step or ration on ${mode}`,()=>{
 const f=fixture(mode==='capability'?7:5),{c}=departFamilyJourney(f),original=terms(c),signatures=structuredClone(c.signatures),before=state(f.w);
 if(mode==='bad date')corrupt(f.child,null);else if(mode==='birthday'){f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=true;}else f.child.canExpress=false;
 if(mode!=='birthday')c.journey!.lastRationAt=f.w.minute-120;const journey=structuredClone(c.journey);stepWorld(f.w,.25);
 assert.equal(c.status,'paused');assert.deepEqual(c.journey,journey);assert.deepEqual(state(f.w),before);assert.deepEqual(terms(c),original);assert.deepEqual(c.signatures,signatures);
 if(mode==='birthday'){run(f.w,f.child,'accept');assert.equal(c.status,'paused');assert.equal(has(f.w,f.parent,'escort'),false);assert.equal(has(f.w,f.parent,'resume'),true);}
});

for(const mode of ['bad date','birthday'] as const)test(`actual escort stops in place when ${mode} is discovered after pickup`,()=>{
 const f=fixture(5),c=acceptFamilyJourney(f);f.child.at.x++;chooseFamilyJourney(f.w,f.parent,'escort',a=>a.operation==='escort'&&a.personId===f.child.id);
 for(let n=0;!c.members[1].escorting&&n<30;n++)stepWorld(f.w,.25);assert.equal(c.members[1].escorting,true);assert.equal(f.parent.activity?.action.type,'familyRelocation');
 if(mode==='bad date')corrupt(f.child,null);else {f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=false;}
 const before=state(f.w);stepWorld(f.w,.25);assert.equal(c.members[1].escorting,false);assert.ok(f.parent.lastFailure);assert.deepEqual(state(f.w),before);assert.equal(f.child.homeId,f.old.id);
});

test('arrival last quarter minute cannot register an unknown child or release the old bed',()=>{
 const f=fixture(3),{c}=departFamilyJourney(f);for(let n=0;String(c.status)==='travelling'&&n<100;n++)stepWorld(f.w,.25);assert.equal(c.status,'arrived');
 run(f.w,f.parent,'arrive',a=>a.operation==='arrive'&&a.personId===f.parent.id);chooseFamilyJourney(f.w,f.parent,'arrive',a=>a.operation==='arrive'&&a.personId===f.child.id);stepWorld(f.w,.75);assert.ok(f.parent.activity&&f.parent.activity.remaining<=.25);assert.equal(c.members[1].arrivedAt,null);
 corrupt(f.child,null);const before=state(f.w);stepWorld(f.w,.25);assert.ok(f.parent.lastFailure);assert.equal(c.members[1].arrivedAt,null);assert.equal(f.child.homeId,f.old.id);assert.ok(f.old.residents.includes(f.child.id));assert.deepEqual(state(f.w),before);assert.equal(c.status,'arrived');
});

for(const value of [null,NaN,undefined,1e8])test(`two SQLite reloads keep unknown age and unsigned original infant terms (${String(value)})`,()=>{
 const f=fixture(3),c=acceptFamilyJourney(f),original=terms(c),signatures=structuredClone(c.signatures);corrupt(f.child,value);
 const db=new WorldStore(':memory:');try{let w=f.w;for(let i=0;i<2;i++){const rev=i===0?null:w.revision;db.commit(w,rev);w=db.loadForRuntime()!;const saved=w.familyRelocation!.agreements[0],p=w.residents.find(p=>p.id===f.parent.id)!,child=w.residents.find(p=>p.id===f.child.id)!;
  assert.deepEqual(terms(saved),original);assert.deepEqual(saved.signatures,signatures);assert.equal(saved.signatures.some(s=>s.personId===child.id),false);assert.equal(has(w,p,'escort'),false);assert.equal(has(w,p,'depart'),false);assert.equal(has(w,child,'withdraw'),true);assert.ok(familyRelocationReason(w,p,{type:'familyRelocation',operation:'depart',relocationId:saved.id}));
 }}finally{db.close();}
});

test('actual prior child signature survives bad data and recovery without duplicate consent or deadline renewal',()=>{
 const f=fixture(7),c=acceptFamilyJourney(f),bornAt=f.child.bornAt,original=terms(c),signatures=structuredClone(c.signatures);corrupt(f.child,null);assert.equal(has(f.w,f.parent,'depart'),false);assert.equal(has(f.w,f.parent,'escort'),false);
 f.child.bornAt=bornAt;assert.equal(has(f.w,f.parent,'depart'),true);assert.equal(has(f.w,f.child,'accept'),false);assert.equal(has(f.w,f.parent,'escort'),false);assert.deepEqual(c.signatures,signatures);assert.deepEqual(terms(c),original);
});

for(const knownBirth of [0,-3*YEAR-.25])test(`known infant timestamp ${knownBirth} retains normal guardian signature and escort`,()=>{
 const f=fixture(3);f.child.bornAt=knownBirth;const c=acceptFamilyJourney(f);assert.equal(c.signatures.some(s=>s.personId===f.child.id),false);assert.equal(has(f.w,f.parent,'escort'),true);assert.equal(has(f.w,f.parent,'depart'),true);
});

test('bad date during actual last signature work cannot accept the old infant proposal',()=>{
 const f=fixture(3);run(f.w,f.parent,'propose',a=>a.operation==='propose'&&a.buildingId===f.home.id);const c=f.w.familyRelocation!.agreements[0],original=terms(c);chooseFamilyJourney(f.w,f.owner,'accept');stepWorld(f.w,.75);assert.ok(f.owner.activity&&f.owner.activity.remaining<=.25);
 corrupt(f.child,null);const signatures=structuredClone(c.signatures),before=state(f.w);stepWorld(f.w,.25);assert.ok(f.owner.lastFailure);assert.equal(c.status,'proposed');assert.deepEqual(c.signatures,signatures);assert.deepEqual(terms(c),original);assert.deepEqual(state(f.w),before);
});

test('birthday assent during a paused journey does not reveal remote destination changes',()=>{
 const f=fixture(5),{c}=departFamilyJourney(f);f.owner.at={x:22,y:16};f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=true;stepWorld(f.w,.25);assert.equal(c.status,'paused');
 f.home.condition=0;assert.equal(has(f.w,f.child,'accept'),true);run(f.w,f.child,'accept');assert.equal(c.status,'paused');assert.equal(c.signatures.some(s=>s.personId===f.child.id),true);assert.equal(f.child.homeId,f.old.id);
});

test('an actual sixth birthday in the final departure quarter minute invalidates the original infant exemption',()=>{
 const f=fixture(5);f.child.bornAt=f.w.minute+5.875-6*YEAR;const birthday=f.child.bornAt+6*YEAR,c=acceptFamilyJourney(f),original=terms(c);
 chooseFamilyJourney(f.w,f.parent,'depart');stepWorld(f.w,.75);assert.ok(f.parent.activity&&f.parent.activity.remaining<=.25);assert.ok(f.w.minute<birthday);const before=state(f.w);
 stepWorld(f.w,.25);assert.ok(f.w.minute>=birthday);assert.ok(f.parent.lastFailure);assert.equal(c.status,'accepted');assert.equal(c.startedAt,null);assert.deepEqual(state(f.w),before);assert.deepEqual(terms(c),original);assert.equal(c.signatures.some(s=>s.personId===f.child.id),false);
});

test('a naturally reached sixth birthday pauses an already travelling infant contract before moving again',()=>{
 const f=fixture(5);f.child.bornAt=f.w.minute+8-6*YEAR;const birthday=f.child.bornAt+6*YEAR,{c}=departFamilyJourney(f);
 while(f.w.minute+.25<birthday)stepWorld(f.w,.25);assert.equal(c.status,'travelling');const before=state(f.w),journey=structuredClone(c.journey);
 stepWorld(f.w,birthday-f.w.minute);assert.equal(f.w.minute,birthday);assert.equal(c.status,'paused');assert.deepEqual(state(f.w),before);assert.deepEqual(c.journey,journey);assert.equal(c.signatures.some(s=>s.personId===f.child.id),false);
});

for(const phase of ['accepted','travelling','arrived','cancelled'] as const)test(`actual birthday supplement remains independent after a backwards birth correction (${phase})`,()=>{
 const f=fixture(5),c=acceptFamilyJourney(f);f.child.bornAt=f.w.minute-6*YEAR;f.child.canDecide=f.child.canExpress=true;run(f.w,f.child,'accept');
 assert.equal(c.members[1].requiresAssent,false);assert.equal(c.requiredSignerIds.includes(f.child.id),false);assert.equal(c.signatures.filter(s=>s.personId===f.child.id).length,1);
 if(phase!=='accepted')run(f.w,f.parent,'depart');
 if(phase==='arrived'){for(let n=0;String(c.status)==='travelling'&&n<100;n++)stepWorld(f.w,.25);assert.equal(c.status,'arrived');run(f.w,f.parent,'arrive',a=>a.operation==='arrive'&&a.personId===f.parent.id);}
 if(phase==='cancelled')run(f.w,f.parent,'withdraw');
 f.child.bornAt=f.w.minute-3*YEAR;f.child.canDecide=f.child.canExpress=false;const original=terms(c),signatures=structuredClone(c.signatures),before=state(f.w);
 for(const operation of ['depart','resume','escort','returnChild'] as const)assert.equal(has(f.w,f.parent,operation),false,operation);
 assert.ok(completeFamilyRelocation(f.w,f.parent,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:f.child.id}));
 if(phase==='travelling'){c.journey!.lastRationAt=f.w.minute-120;const journey=structuredClone(c.journey);stepWorld(f.w,.25);assert.equal(c.status,'paused');assert.deepEqual(c.journey,journey);}
 assert.deepEqual(state(f.w),before);assert.deepEqual(c.signatures,signatures);assert.deepEqual(terms(c),original);
 const db=new WorldStore(':memory:');try{let w=f.w;for(let i=0;i<2;i++){db.commit(w,i===0?null:w.revision);w=db.loadForRuntime()!;const saved=w.familyRelocation!.agreements[0],p=w.residents.find(p=>p.id===f.parent.id)!;for(const operation of ['depart','resume','escort','returnChild'] as const)assert.equal(has(w,p,operation),false,operation);assert.deepEqual(terms(saved),original);assert.deepEqual(saved.signatures,signatures);assert.deepEqual(state(w),before);}}finally{db.close();}
});
