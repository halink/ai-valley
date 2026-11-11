import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseFoster,finishFoster,fosterFixture,fosterMenu,proposeFoster,queueFoster,selectFoster} from './helpers/foster-age-consent.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {executeSocialAction} from '../src/world/social.js';
import {familyOpportunities} from '../src/world/family.js';
import {guardianHasPersonalApproval,guardianOfferIdentity} from '../src/world/guardian-consent.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';
import {parseChoice} from '../src/server/affordances.js';
import {emitEvent} from '../src/world/events.js';
import type {Action} from '../src/shared/types.js';

for(const childFirst of [false,true])test(`actual numbered proposal, sixth birthday and independent choices, child first ${childFirst}`,()=>{
 const f=fosterFixture(),{w,volunteer,child,guardian,birthday}=f,c=proposeFoster(f);
 assert.equal(c.childApproved,false);assert.equal(c.childApprovedAt,null);
 const original=structuredClone({id:child.id,bornAt:child.bornAt,parents:child.parents,homeId:child.homeId,inventory:child.inventory,coins:child.coins}),expires=c.expiresAt;
 w.minute=birthday;stepWorld(w,.25);assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
 chooseFoster(w,childFirst?child:guardian,'familyConsent');assert.deepEqual(child.guardianIds,[guardian.id]);assert.equal(child.guardianOffer,c);assert.equal(c.expiresAt,expires);
 assert.equal(guardianHasPersonalApproval(w,child,c),childFirst);assert.equal(c.childApprovedAt===null,!childFirst);
 chooseFoster(w,childFirst?guardian:child,'familyConsent');assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);assert.equal(child.guardianOffer,undefined);
 assert.deepEqual({id:child.id,bornAt:child.bornAt,parents:child.parents,homeId:child.homeId,inventory:child.inventory,coins:child.coins},original);
 assert.equal(w.events.filter(e=>e.populationChange==='guardian').length,1);
});

for(const reverse of [false,true])test(`last quarter birthday completion cannot enroll before life activation, reverse residents ${reverse}`,()=>{
 const f=fosterFixture(),{w,guardian,child,volunteer,birthday}=f,c=proposeFoster(f);if(reverse)w.residents.reverse();
 w.minute=birthday-5;queueFoster(w,guardian,selectFoster(w,guardian,'familyConsent'));stepWorld(w,4.75);
 assert.equal(w.minute,birthday-.25);assert.equal(guardian.activity?.remaining,.25);assert.equal(child.canDecide,false);
 stepWorld(w,.25);assert.equal(w.minute,birthday);assert.ok(guardian.lastFailure);assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(c.childApproved,false);assert.equal(c.childApprovedAt,null);assert.equal(c.guardianApproved,false);assert.equal(child.canDecide,true);
 assert.ok(fosterMenu(w,child).some(c=>c.action.type==='familyConsent'&&c.action.accept));
 chooseFoster(w,guardian,'familyConsent');assert.ok(!child.guardianIds.includes(volunteer.id));chooseFoster(w,child,'familyConsent');
 assert.equal(w.events.filter(e=>e.populationChange==='guardian').length,1);
});

test('new under-six exemption completes only guardian choice, records no imaginary child signature and is not revoked on birthday',()=>{
 const f=fosterFixture(),{w,child,guardian,volunteer,birthday}=f,c=proposeFoster(f);chooseFoster(w,guardian,'familyConsent');
 assert.equal(c.childApproved,false);assert.equal(c.childApprovedAt,null);assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);
 w.minute=birthday;stepWorld(w,.25);assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);assert.equal(child.guardianOffer,undefined);
});

test('legacy under-six true is unchanged evidence, never hides assent, and original expiry remains unchanged through SQLite',()=>{
 const f=fosterFixture(),{w,child,guardian,birthday}=f,c=proposeFoster(f);delete c.id;delete c.createdAt;delete c.childApprovedAt;c.childApproved=true;
 const legacy=structuredClone(c);w.minute=birthday;stepWorld(w,.25);const store=new WorldStore(':memory:');
 try{store.commit(w,null);let loaded=store.loadForRuntime()!;const r=loaded.residents.find(r=>r.id===child.id)!,g=loaded.residents.find(r=>r.id===guardian.id)!;
  assert.equal(guardianHasPersonalApproval(loaded,r,r.guardianOffer!),false);const snapshot=JSON.stringify(r.guardianOffer);
  const action=selectFoster(loaded,r,'familyConsent');assert.equal(JSON.stringify(r.guardianOffer),snapshot);
  assert.deepEqual(r.guardianOffer,legacy);chooseFoster(loaded,g,'familyConsent');assert.equal(r.guardianIds.length,1);assert.equal(r.guardianOffer!.expiresAt,c.expiresAt);
  queueFoster(loaded,r,action);finishFoster(loaded,r);store.commit(loaded,w.revision);loaded=store.loadForRuntime()!;
  assert.equal(loaded.residents.find(p=>p.id===child.id)!.guardianIds.length,2);assert.equal(loaded.residents.find(p=>p.id===child.id)!.guardianOffer,undefined);
 }finally{store.close();}
});

test('valid old older-child approval survives bounded working history reload with exact signing time still unknown',()=>{
 const f=fosterFixture(8),{w,child,guardian}=f,c=proposeFoster(f);delete c.id;delete c.createdAt;delete c.childApprovedAt;c.childApproved=true;
 const evidence=structuredClone(c);for(const p of w.residents)p.memories=[];
 for(let i=0;i<210;i++)emitEvent(w,{kind:'action',actors:[guardian.id],place:{...guardian.at},text:'离线无关历史 '+i});
 w.minute+=60;const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!,r=loaded.residents.find(r=>r.id===child.id)!,g=loaded.residents.find(r=>r.id===guardian.id)!;
  assert.deepEqual(r.guardianOffer,evidence);assert.equal(guardianHasPersonalApproval(loaded,r,r.guardianOffer!),true);
  assert.equal(r.guardianOffer!.childApprovedAt,undefined);assert.ok(!fosterMenu(loaded,r).some(c=>c.action.type==='familyConsent'&&c.action.accept));
  chooseFoster(loaded,g,'familyConsent');assert.equal(r.guardianIds.length,2);
 }finally{store.close();}
});

test('new missing, malformed, premature and future approval timestamps cannot mint personal consent',()=>{
 const f=fosterFixture(),{w,child,guardian,birthday}=f,c=proposeFoster(f);w.minute=birthday+2;stepWorld(w,.25);
 for(const at of [undefined,null,NaN,Infinity,c.createdAt!-1,c.createdAt!,w.minute+1]){
  c.childApproved=true;c.childApprovedAt=at;assert.equal(guardianHasPersonalApproval(w,child,c),false);
  assert.ok(fosterMenu(w,child).some(c=>c.action.type==='familyConsent'&&c.action.accept));
 }
 c.childApproved=false;c.childApprovedAt=w.minute;assert.equal(guardianHasPersonalApproval(w,child,c),false);
 c.childApproved=true;c.childApprovedAt=null;chooseFoster(w,guardian,'familyConsent');assert.equal(child.guardianIds.length,1);
 chooseFoster(w,child,'familyConsent');assert.equal(child.guardianIds.length,2);
});

test('refusal and reoffer cannot be overwritten by stale numbered consent or unknown offer identity',()=>{
 const f=fosterFixture(8),{w,guardian,child,volunteer}=f;proposeFoster(f);const old=selectFoster(w,child,'familyConsent');
 chooseFoster(w,guardian,'familyConsent',false);assert.equal(child.guardianOffer,undefined);
 assert.equal(executeSocialAction(w,child,old).ok,false);const newer=proposeFoster(f);
 assert.equal(executeSocialAction(w,child,old).ok,false);assert.equal(newer.childApproved,false);
 const consent=selectFoster(w,child,'familyConsent');assert.equal(executeSocialAction(w,child,{...consent,offerId:'forged'} as Action).ok,false);
 assert.equal(executeSocialAction(w,volunteer,consent).ok,false);assert.equal(executeSocialAction(w,guardian,consent).ok,true);
 assert.equal(newer.childApproved,false);assert.equal(child.guardianIds.length,1);
 const menu=fosterMenu(w,child),choice=menu.find(c=>c.action.type==='familyConsent'&&c.action.accept)!;
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,offerId:guardianOfferIdentity(newer)}),menu));
 chooseFoster(w,child,'familyConsent',false);assert.equal(child.guardianOffer,undefined);assert.equal(child.guardianIds.length,1);
});

test('loss of decision or expression after child choice pauses current guardian, recovery still needs their own choice',()=>{
 for(const capacity of ['decide','express','both']){const f=fosterFixture(8),{w,child,guardian}=f,c=proposeFoster(f);chooseFoster(w,child,'familyConsent');
  const evidence=structuredClone(c),action=selectFoster(w,guardian,'familyConsent');child.canDecide=capacity==='express';child.canExpress=capacity==='decide';
  assert.equal(executeSocialAction(w,guardian,action).ok,false);assert.deepEqual(child.guardianOffer,evidence);
  assert.equal(familyOpportunities(w,guardian).some(c=>c.action.type==='familyConsent'&&c.action.accept),false);assert.equal(child.guardianIds.length,1);
  child.canDecide=child.canExpress=true;assert.equal(child.guardianIds.length,1);chooseFoster(w,guardian,'familyConsent');assert.equal(child.guardianIds.length,2);
 }
});

test('expiry, adulthood and guardian removal reject queued choices without changing refusal flags or property',()=>{
 for(const change of ['expiry','adult','authority'] as const){const f=fosterFixture(8),{w,child,guardian}=f,c=proposeFoster(f),action=selectFoster(w,guardian,'familyConsent');
  child.refusesCare=true;const before={coins:child.coins,inventory:{...child.inventory},parents:[...child.parents],homeId:child.homeId};
  if(change==='expiry')w.minute=c.expiresAt;else if(change==='adult')child.bornAt=w.minute-18*YEAR;else child.guardianIds=[];
  assert.equal(executeSocialAction(w,guardian,action).ok,false);assert.equal(child.guardianIds.length,change==='authority'?0:1);assert.equal(child.refusesCare,true);
  assert.deepEqual({coins:child.coins,inventory:child.inventory,parents:child.parents,homeId:child.homeId},before);assert.equal(c.expiresAt,c.createdAt!+DAY);
 }
});

test('persisted stale world cannot restore rejected guardianship and replayed successful plan adds no duplicate guardian',()=>{
 const f=fosterFixture(8),{w,child,guardian}=f;proposeFoster(f);const store=new WorldStore(':memory:');try{store.commit(w,null);const winner=store.loadForRuntime()!,stale=store.loadForRuntime()!;
  const r=winner.residents.find(r=>r.id===child.id)!,g=winner.residents.find(r=>r.id===guardian.id)!;chooseFoster(winner,r,'familyConsent',false);store.commit(winner,w.revision);const durableRevision=winner.revision;
  const oldChild=stale.residents.find(r=>r.id===child.id)!,oldGuardian=stale.residents.find(r=>r.id===guardian.id)!;
  chooseFoster(stale,oldGuardian,'familyConsent');chooseFoster(stale,oldChild,'familyConsent');assert.throws(()=>store.commit(stale,w.revision),/stale_world_revision/);
  assert.equal(store.loadForRuntime()!.residents.find(r=>r.id===child.id)!.guardianOffer,undefined);
  chooseFoster(winner,winner.residents.find(r=>r.id===f.volunteer.id)!,'fosterChild');chooseFoster(winner,g,'familyConsent');const plan=chooseFoster(winner,r,'familyConsent');
  assert.deepEqual(submitPlan(winner,plan),{ok:true});stepWorld(winner,.25);assert.equal(r.guardianIds.length,2);
  store.commit(winner,durableRevision);const loaded=store.loadForRuntime()!,person=loaded.residents.find(r=>r.id===child.id)!;
  assert.deepEqual(submitPlan(loaded,plan),{ok:true});stepWorld(loaded,.25);assert.equal(person.guardianIds.length,2);
  assert.equal(loaded.events.filter(e=>e.populationChange==='guardian').length,1);
 }finally{store.close();}
});
