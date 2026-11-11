import assert from 'node:assert/strict';
import {test} from 'node:test';
import {careFixture,careChoice,carePlan,finishCareAction} from './helpers/care-meal-evidence.js';
import {submitPlan} from '../src/world/engine.js';
import {familyOpportunities,finishFamilyAction} from '../src/world/family.js';
import {guardianOfferIdentity,guardianHasPersonalApproval} from '../src/world/guardian-consent.js';
import {advanceLife} from '../src/world/life.js';
import {DAY,YEAR} from '../src/world/time.js';

// Independent review fixtures only; never opens a runtime world or invokes models.
function fixture(){
 const {w,provider:volunteer,beneficiary:child,other:guardian}=careFixture();
 guardian.at={...child.at};child.guardianIds=[guardian.id];
 const birthday=w.minute+1;child.bornAt=birthday-6*YEAR;child.lifeStage='infant';
 child.canDecide=false;child.canExpress=false;
 assert.equal(finishFamilyAction(w,volunteer,{type:'fosterChild',targetId:child.id}).ok,true);
 return {w,volunteer,child,guardian,birthday};
}
const consent=(f:ReturnType<typeof fixture>,who:'guardian'|'child',accept=true)=>finishFamilyAction(f.w,f[who],{type:'familyConsent',targetId:f.child.id,accept,offerId:f.child.guardianOffer?guardianOfferIdentity(f.child.guardianOffer):'expired-review-offer'});
const hasAccept=(f:ReturnType<typeof fixture>)=>familyOpportunities(f.w,f.child).some(o=>o.action.type==='familyConsent'&&o.action.targetId===f.child.id&&o.action.accept);

test('foster review: birthday direct completion cannot use an infant exemption and menu reads are pure',()=>{
 const f=fixture(),{w,child,guardian,volunteer,birthday}=f;
 const expiresAt=child.guardianOffer!.expiresAt;
 w.minute=birthday;child.canDecide=child.canExpress=true;
 const before=JSON.stringify({offer:child.guardianOffer,events:w.events});
 assert.equal(hasAccept(f),true);
 assert.equal(JSON.stringify({offer:child.guardianOffer,events:w.events}),before);
 consent(f,'guardian');assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(child.guardianOffer!.expiresAt,expiresAt);
 assert.equal(consent(f,'child').ok,true);assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);
 assert.equal(w.events.filter(e=>e.populationChange==='guardian').length,1);
 assert.equal(consent(f,'child').ok,false);
});

for(const capacity of ['decide','express','both'] as const)test(`foster review: missing ${capacity} capacity pauses the birthday handoff`,()=>{
 const f=fixture(),{w,child,guardian,birthday}=f;w.minute=birthday;
 child.canDecide=capacity==='express';child.canExpress=capacity==='decide';
 const expiresAt=child.guardianOffer!.expiresAt;
 consent(f,'guardian');assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(hasAccept(f),false);assert.equal(consent(f,'child').ok,false);
 assert.equal(child.guardianOffer!.expiresAt,expiresAt);
 child.canDecide=child.canExpress=true;
 assert.equal(hasAccept(f),true);assert.equal(consent(f,'child').ok,true);
 if(child.guardianOffer)assert.equal(consent(f,'guardian').ok,true);
 assert.equal(child.guardianOffer,undefined);
});

for(const who of ['guardian','child'] as const)test(`foster review: ${who} refusal cannot be resurrected by a stale acceptance`,()=>{
 const f=fixture(),{w,child,guardian,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;
 assert.equal(consent(f,who,false).ok,true);assert.equal(child.guardianOffer,undefined);
 assert.equal(consent(f,'guardian').ok,false);assert.equal(consent(f,'child').ok,false);
 advanceLife(w,.25);assert.deepEqual(child.guardianIds,[guardian.id]);
});

test('foster review: original deadline wins over the birthday and never extends on read or attempted signature',()=>{
 const f=fixture(),{w,child,guardian,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;
 consent(f,'guardian');const deadline=child.guardianOffer!.expiresAt;
 w.minute=deadline;assert.equal(hasAccept(f),false);assert.equal(consent(f,'child').ok,false);
 assert.deepEqual(child.guardianIds,[guardian.id]);advanceLife(w,.25);assert.equal(child.guardianOffer,undefined);
});

test('foster review: an old infant true flag survives reload only as an exemption, never a personal signature',()=>{
 const f=fixture(),{w,child,guardian,volunteer,birthday}=f;
 child.guardianOffer={volunteerId:volunteer.id,guardianId:guardian.id,guardianApproved:false,childApproved:true,expiresAt:w.minute+DAY};
 const original=structuredClone(child.guardianOffer);w.minute=birthday;child.canDecide=child.canExpress=true;
 const restored=JSON.parse(JSON.stringify(w));
 const c=restored.residents.find((p:typeof child)=>p.id===child.id)!,g=restored.residents.find((p:typeof guardian)=>p.id===guardian.id)!;
 finishFamilyAction(restored,g,{type:'familyConsent',targetId:c.id,accept:true,offerId:guardianOfferIdentity(c.guardianOffer)});
 assert.deepEqual(c.guardianIds,[guardian.id]);assert.equal(c.guardianOffer.expiresAt,original.expiresAt);
 assert.equal(finishFamilyAction(restored,c,{type:'familyConsent',targetId:c.id,accept:true,offerId:guardianOfferIdentity(c.guardianOffer)}).ok,true);
 assert.deepEqual(c.guardianIds,[guardian.id,volunteer.id]);
});

test('foster review: lawful historical personal consent after six still permits the remaining guardian signature',()=>{
 const f=fixture(),{w,child,guardian,volunteer}=f;child.bornAt=w.minute-8*YEAR;child.canDecide=child.canExpress=true;
 child.guardianOffer={volunteerId:volunteer.id,guardianId:guardian.id,guardianApproved:false,childApproved:true,expiresAt:w.minute+DAY};
 assert.equal(consent(f,'guardian').ok,true);assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);
});

test('foster review: adulthood blocks stale proxy acceptance even before the lifecycle clears history',()=>{
 const f=fixture(),{w,child,guardian}=f;child.bornAt=w.minute-18*YEAR;child.canDecide=child.canExpress=true;
 assert.equal(consent(f,'guardian').ok,false);assert.equal(consent(f,'child').ok,false);
 assert.deepEqual(child.guardianIds,[guardian.id]);assert.equal(hasAccept(f),false);
});

test('foster review: an already completed under-six handoff is not revoked on the sixth birthday',()=>{
 const f=fixture(),{w,child,guardian,volunteer,birthday}=f;
 assert.equal(consent(f,'guardian').ok,true);assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);
 const events=w.events.filter(e=>e.populationChange==='guardian').map(e=>structuredClone(e));
 w.minute=birthday;advanceLife(w,1);
 assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);assert.equal(child.guardianOffer,undefined);
 assert.deepEqual(w.events.filter(e=>e.populationChange==='guardian'),events);
});


test('foster review: guardian action selected before six cannot finish after the birthday without the child',()=>{
 const f=fixture(),{w,child,guardian,volunteer}=f;
 const action=careChoice(w,guardian,a=>a.type==='familyConsent'&&a.targetId===child.id&&a.accept);
 const expiry=child.guardianOffer!.expiresAt;
 assert.equal(submitPlan(w,carePlan(w,guardian,[action])).ok,true);
 finishCareAction(w,guardian);
 assert.deepEqual(child.guardianIds,[guardian.id]);assert.ok(child.guardianOffer);
 assert.equal(child.guardianOffer.expiresAt,expiry);
 assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
 const self=careChoice(w,child,a=>a.type==='familyConsent'&&a.targetId===child.id&&a.accept);
 assert.equal(submitPlan(w,carePlan(w,child,[self])).ok,true);finishCareAction(w,child);
 assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);
 assert.equal(w.events.filter(e=>e.populationChange==='guardian').length,1);
});


for(const bad of ['beforeSix','future','beforeOffer','atExpiry','null','nan','falseFlag','missingTime','missingCreationAndTime','missingIdAndTime'] as const)test(`foster review: malformed personal evidence cannot grant authority (${bad})`,()=>{
 const f=fixture(),{w,child,guardian,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;
 const offer=child.guardianOffer!;offer.childApproved=true;offer.childApprovedAt=w.minute;
 if(bad==='beforeSix')offer.childApprovedAt=birthday-.5;
 if(bad==='future')offer.childApprovedAt=birthday+.5;
 if(bad==='beforeOffer')offer.childApprovedAt=offer.createdAt!-1;
 if(bad==='atExpiry')offer.childApprovedAt=offer.expiresAt;
 if(bad==='null')offer.childApprovedAt=null;
 if(bad==='nan')offer.childApprovedAt=NaN;
 if(bad==='falseFlag')offer.childApproved=false;
 if(bad==='missingTime')delete offer.childApprovedAt;
 if(bad==='missingCreationAndTime'){delete offer.createdAt;delete offer.childApprovedAt;child.bornAt=w.minute-8*YEAR;}
 if(bad==='missingIdAndTime'){delete offer.id;delete offer.childApprovedAt;child.bornAt=w.minute-8*YEAR;}
 assert.equal(guardianHasPersonalApproval(w,child,offer),false);
 consent(f,'guardian');assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(hasAccept(f),true);assert.equal(consent(f,'child').ok,true);
 assert.equal(child.guardianOffer,undefined);
});

for(const who of ['guardian','volunteer'] as const)test(`foster review: ${who} must still be an adult at completion`,()=>{
 const f=fixture(),{w,child,guardian,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;
 f[who].bornAt=w.minute-17*YEAR;
 assert.equal(consent(f,'guardian').ok,false);assert.equal(consent(f,'child').ok,false);
 assert.deepEqual(child.guardianIds,[guardian.id]);assert.equal(hasAccept(f),false);
});

test('foster review: child-first personal evidence is retained but cannot finish during later incapacity',()=>{
 const f=fixture(),{w,child,guardian,volunteer,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;
 assert.equal(consent(f,'child').ok,true);const evidence=structuredClone(child.guardianOffer);
 child.canExpress=false;assert.equal(consent(f,'guardian').ok,false);
 assert.deepEqual(child.guardianOffer,evidence);assert.deepEqual(child.guardianIds,[guardian.id]);
 child.canExpress=true;assert.equal(consent(f,'guardian').ok,true);
 assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);
});

test('foster review: stale bound and unbound decisions cannot approve a replacement proposal',()=>{
 const f=fixture(),{w,child,guardian,volunteer,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;
 const stale={type:'familyConsent' as const,targetId:child.id,accept:true,offerId:guardianOfferIdentity(child.guardianOffer!)};
 assert.equal(consent(f,'child',false).ok,true);
 assert.equal(finishFamilyAction(w,volunteer,{type:'fosterChild',targetId:child.id}).ok,true);
 assert.notEqual(guardianOfferIdentity(child.guardianOffer!),stale.offerId);
 const snapshot=structuredClone(child.guardianOffer);
 assert.equal(finishFamilyAction(w,guardian,stale).ok,false);
 assert.equal(finishFamilyAction(w,guardian,{type:'familyConsent',targetId:child.id,accept:true}).ok,false);
 assert.deepEqual(child.guardianOffer,snapshot);assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(consent(f,'child').ok,true);assert.equal(consent(f,'guardian').ok,true);
 assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);
});

test('foster review: a guardian may still decline while the six-year-old cannot express a choice',()=>{
 const f=fixture();f.w.minute=f.birthday;f.child.canDecide=true;f.child.canExpress=false;
 const choices=familyOpportunities(f.w,f.guardian);
 assert.equal(choices.some(o=>o.action.type==='familyConsent'&&o.action.accept),false);
 assert.equal(choices.some(o=>o.action.type==='familyConsent'&&!o.action.accept),true);
 assert.equal(consent(f,'guardian',false).ok,true);assert.equal(f.child.guardianOffer,undefined);
 assert.deepEqual(f.child.guardianIds,[f.guardian.id]);
});

test('foster review: reading an old lawful signature does not invent timestamps or rewrite its raw evidence',()=>{
 const f=fixture(),{w,child,guardian,volunteer}=f;child.bornAt=w.minute-8*YEAR;child.canDecide=child.canExpress=true;
 child.guardianOffer={volunteerId:volunteer.id,guardianId:guardian.id,guardianApproved:false,childApproved:true,expiresAt:w.minute+DAY};
 const before=JSON.stringify(child.guardianOffer);
 assert.equal(guardianHasPersonalApproval(w,child,child.guardianOffer),true);
 assert.equal(hasAccept(f),false);familyOpportunities(w,guardian);
 assert.equal(JSON.stringify(child.guardianOffer),before);
});
