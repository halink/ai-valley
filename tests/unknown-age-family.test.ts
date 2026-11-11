import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident} from '../src/shared/types.js';
import {fosterFixture,fosterMenu,proposeFoster,queueFoster,selectFoster,chooseFoster} from './helpers/foster-age-consent.js';
import {ageAllowsChoice,finishFamilyAction} from '../src/world/family.js';
import {guardianHasPersonalApproval} from '../src/world/guardian-consent.js';
import {advanceLife,infantRest} from '../src/world/life.js';
import {stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

const badBirths:Array<[string,(now:number)=>unknown]>=[
 ['null',()=>null],['NaN',()=>NaN],['future',now=>now+2*DAY],['undefined',()=>undefined],
 ['string',()=>'-123'],['positive infinity',()=>Infinity],['negative infinity',()=>-Infinity],
 ['unsafe timestamp',()=>-Number.MAX_SAFE_INTEGER-1],['unsafe elapsed',()=>-Number.MAX_SAFE_INTEGER],
];
function corrupt(person:Resident,bornAt:unknown){person.bornAt=bornAt as number;}
const isFamily=(a:Action)=>a.type==='fosterChild'||a.type==='familyConsent';
const rights=(r:Resident)=>structuredClone({id:r.id,bornAt:r.bornAt,parents:r.parents,guardianIds:r.guardianIds,
 adoptiveParents:r.adoptiveParents,homeId:r.homeId,inventory:r.inventory,coins:r.coins,refusesCare:r.refusesCare});

for(const [label,bad] of badBirths)test(`unknown family: ${label} cannot offer permanent guardianship through the actual menu or direct completion`,()=>{
 const f=fosterFixture(7),{w,volunteer,guardian,child}=f;corrupt(child,bad(w.minute));const before=rights(child);
 assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(fosterMenu(w,volunteer).some(c=>c.action.type==='fosterChild'&&c.action.targetId===child.id),false);
 assert.equal(finishFamilyAction(w,volunteer,{type:'fosterChild',targetId:child.id}).ok,false);
 assert.equal(child.guardianOffer,undefined);assert.deepEqual(rights(child),before);
});

for(const [label,bad] of badBirths)test(`unknown family: ${label} invalidates queued acceptance without rewriting prior evidence`,()=>{
 const f=fosterFixture(7),{w,guardian,child}=f,offer=proposeFoster(f),action=selectFoster(w,guardian,'familyConsent');
 chooseFoster(w,child,'familyConsent');corrupt(child,bad(w.minute));const evidence=structuredClone(offer),before=rights(child);
 assert.equal(guardianHasPersonalApproval(w,child,offer),false);
 assert.equal(fosterMenu(w,guardian).some(c=>c.action.type==='familyConsent'&&c.action.accept),false);
 assert.equal(finishFamilyAction(w,guardian,action as Extract<Action,{type:'familyConsent'}>).ok,false);
 assert.deepEqual(child.guardianOffer,evidence);assert.deepEqual(rights(child),before);
 assert.equal(w.events.some(e=>e.populationChange==='guardian'),false);
});

for(const who of ['guardian','child'] as const)test(`unknown family: capable ${who} retains a real numbered refusal and stale acceptance cannot undo it`,()=>{
 const f=fosterFixture(7),{w,child,guardian}=f;proposeFoster(f);const stale=selectFoster(w,guardian,'familyConsent');
 corrupt(child,null);const offer=structuredClone(child.guardianOffer);
 assert.equal(fosterMenu(w,child).some(c=>isFamily(c.action)&&c.action.type==='familyConsent'&&c.action.accept),false);
 chooseFoster(w,f[who],'familyConsent',false);
 assert.equal(child.guardianOffer,undefined);assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(finishFamilyAction(w,guardian,stale as Extract<Action,{type:'familyConsent'}>).ok,false);
 assert.equal(offer!.childApproved,false);assert.equal(child.bornAt,null);assert.equal(child.lifeStage,'child');
 assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
});

for(const [label,bad] of badBirths.slice(0,3))test(`unknown family: ${label} at last work quarter rejects queued proposal and acceptance`,()=>{
 for(const phase of ['offer','accept'] as const){
  const f=fosterFixture(7),{w,child,guardian,volunteer}=f;
  if(phase==='accept')proposeFoster(f);
  const actor=phase==='offer'?volunteer:guardian,action=selectFoster(w,actor,phase==='offer'?'fosterChild':'familyConsent');
  queueFoster(w,actor,action);stepWorld(w,4.75);assert.equal(actor.activity?.remaining,.25);
  corrupt(child,bad(w.minute));const evidence=structuredClone(child.guardianOffer);stepWorld(w,.25);
  assert.ok(actor.lastFailure);assert.deepEqual(child.guardianIds,[guardian.id]);assert.deepEqual(child.guardianOffer,evidence);
  assert.equal(w.events.some(e=>e.populationChange==='guardian'),false);
 }
});

for(const [label,bad] of badBirths.slice(0,3))test(`unknown family: ${label} survives in-memory SQLite as unknown, never infant authority`,()=>{
 const f=fosterFixture(7),{w,child,guardian}=f;proposeFoster(f);const action=selectFoster(w,guardian,'familyConsent');
 queueFoster(w,guardian,action);stepWorld(w,4.75);corrupt(child,bad(w.minute));const original=JSON.parse(JSON.stringify(child.guardianOffer));
 const expectedBirth=label==='NaN'?null:child.bornAt,store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.loadForRuntime()!,c=loaded.residents.find(p=>p.id===child.id)!,g=loaded.residents.find(p=>p.id===guardian.id)!;
  assert.equal(c.bornAt,expectedBirth);assert.deepEqual(c.guardianOffer,original);
  stepWorld(loaded,.25);assert.ok(g.lastFailure);assert.deepEqual(c.guardianIds,[guardian.id]);assert.deepEqual(c.guardianOffer,original);
  assert.equal(c.bornAt,expectedBirth);assert.equal(c.lifeStage,'child');assert.equal(c.canDecide,true);assert.equal(c.canExpress,true);
  assert.equal(loaded.events.some(e=>e.populationChange==='guardian'),false);
 }finally{store.close();}
});

test('unknown family: invalid ages never add infant feeding, rest, stage transition or adult permission',()=>{
 for(const [label,bad] of badBirths){const f=fosterFixture(7),{w,child,guardian}=f;corrupt(child,bad(w.minute));child.hunger=80;child.energy=10;
  const before=rights(child),energy=child.energy;assert.equal(fosterMenu(w,guardian).some(c=>c.action.type==='tendChild'&&c.action.targetId===child.id),false,label);
  assert.equal(finishFamilyAction(w,guardian,{type:'tendChild',targetId:child.id}).ok,false,label);
  infantRest(w,child,1);assert.equal(child.energy,energy,label);advanceLife(w,1);
  assert.deepEqual(rights(child),before,label);assert.equal(child.lifeStage,'child',label);assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
  assert.equal(fosterMenu(w,child).some(c=>['fosterChild','inviteHome','propose'].includes(c.action.type)),false,label);
 }
});

test('unknown family: skipped age updates still expire proposals and preserve inactive capacity',()=>{
 const f=fosterFixture(7),{w,child}=f,c=proposeFoster(f);corrupt(child,null);child.canDecide=child.canExpress=false;
 w.minute=c.expiresAt;advanceLife(w,1);assert.equal(child.guardianOffer,undefined);assert.equal(child.lifeStage,'child');
 assert.equal(child.canDecide,false);assert.equal(child.canExpress,false);assert.equal(child.bornAt,null);
});

test('unknown family: restored valid age still follows the real sixth birthday and both signatures',()=>{
 const f=fosterFixture(),{w,child,guardian,volunteer,birthday}=f,c=proposeFoster(f),birth=child.bornAt;
 corrupt(child,null);assert.equal(fosterMenu(w,guardian).some(c=>c.action.type==='familyConsent'&&c.action.accept),false);
 child.bornAt=birth;w.minute=birthday;advanceLife(w,.25);chooseFoster(w,guardian,'familyConsent');
 assert.deepEqual(child.guardianIds,[guardian.id]);assert.equal(c.childApproved,false);chooseFoster(w,child,'familyConsent');
 assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);assert.equal(child.bornAt,birthday-6*YEAR);
});

test('unknown family: relocation retains only negative choices through the age fallback gate',()=>{
 for(const age of [0,5,6,17,18])for(const operation of ['decline','withdraw'] as const)
  assert.equal(ageAllowsChoice(age,{type:'familyRelocation',operation,relocationId:'existing-proposal'}),true);
 assert.equal(ageAllowsChoice(0,{type:'familyRelocation',operation:'accept',relocationId:'existing-proposal'}),false);
 assert.equal(ageAllowsChoice(0,{type:'familyRelocation',operation:'arrive',relocationId:'existing-proposal',personId:'本人'}),false);
});
