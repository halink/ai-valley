import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Resident} from '../src/shared/types.js';
import {knownAgeYears,ageYears,YEAR} from '../src/world/time.js';
import {guardianHasPersonalApproval} from '../src/world/guardian-consent.js';
import {finishFamilyAction,familyOpportunities} from '../src/world/family.js';
import {advanceLife,infantRest} from '../src/world/life.js';
import {stepWorld} from '../src/world/engine.js';
import {fosterFixture,proposeFoster,selectFoster,queueFoster,chooseFoster} from './helpers/foster-age-consent.js';

const corrupt=(p:Resident,value:unknown)=>{p.bornAt=value as number;};
const invalid:unknown[]=[null,undefined,NaN,Infinity,-Infinity,'0',false,{},[],Number.MAX_SAFE_INTEGER+1];
test('review: birth and current time are both strict, finite, safe and ordered',()=>{
 for(const value of invalid){assert.equal(knownAgeYears(value,0),null);assert.equal(knownAgeYears(0,value),null);assert.equal(ageYears(value as number,0),0);}
 assert.equal(knownAgeYears(1,0),null);
 assert.equal(knownAgeYears(-Number.MAX_SAFE_INTEGER,1),null);
 for(const age of [0,5,6,13,17,18,80])assert.equal(knownAgeYears(-age*YEAR,0),age);
});

test('review: sixth and eighteenth birthdays respect neighboring representable timestamps',()=>{
 const before=(value:number)=>{const bytes=new ArrayBuffer(8),v=new DataView(bytes);v.setFloat64(0,value);let bits=v.getBigUint64(0);bits+=value>0?-1n:1n;v.setBigUint64(0,bits);return v.getFloat64(0);};
 for(const birth of [-10000000.125,-123.7,123.7,2**40+.125])for(const age of [6,18]){
  const birthday=birth+age*YEAR;
  assert.ok(knownAgeYears(birth,before(birthday))!<age,`${birth}/${age}`);
  assert.ok(knownAgeYears(birth,birthday)!>=age,`${birth}/${age}`);
 }
});

for(const who of ['guardian','volunteer'] as const)for(const value of [null,NaN,'0'])test(`review: corrupt ${who} age ${String(value)} cannot finish a previously queued grant`,()=>{
 const f=fosterFixture(7),{w,guardian,child}=f;proposeFoster(f);chooseFoster(w,child,'familyConsent');
 queueFoster(w,guardian,selectFoster(w,guardian,'familyConsent'));stepWorld(w,4.75);
 corrupt(f[who],value);const offer=structuredClone(child.guardianOffer);stepWorld(w,.25);
 assert.ok(guardian.lastFailure);assert.deepEqual(child.guardianOffer,offer);assert.deepEqual(child.guardianIds,[guardian.id]);
 assert.equal(w.events.some(e=>e.populationChange==='guardian'),false);
});

for(const value of [null,NaN,'0'])test(`review: child signature queued after guardian approval cannot complete with age ${String(value)}`,()=>{
 const f=fosterFixture(7),{w,guardian,child}=f;proposeFoster(f);chooseFoster(w,guardian,'familyConsent');
 queueFoster(w,child,selectFoster(w,child,'familyConsent'));stepWorld(w,4.75);corrupt(child,value);
 const evidence=structuredClone(child.guardianOffer);stepWorld(w,.25);
 assert.ok(child.lastFailure);assert.deepEqual(child.guardianOffer,evidence);assert.deepEqual(child.guardianIds,[guardian.id]);
});

test('review: invalid clocks never grant from current signature records',()=>{
 const f=fosterFixture(7),{w,child,guardian}=f;const offer=proposeFoster(f);chooseFoster(w,child,'familyConsent');
 const action=selectFoster(w,guardian,'familyConsent'),evidence=structuredClone(offer);
 for(const minute of invalid){w.minute=minute as number;
  assert.equal(guardianHasPersonalApproval(w,child,offer),false);
  assert.equal(finishFamilyAction(w,guardian,action as Parameters<typeof finishFamilyAction>[2]).ok,false);
  assert.equal(familyOpportunities(w,guardian).some(c=>c.action.type==='familyConsent'&&c.action.accept),false);
  assert.deepEqual(child.guardianOffer,evidence);assert.deepEqual(child.guardianIds,[guardian.id]);
 }
});

test('review: both legacy and modern personal approval remain unusable while birth is unknown',()=>{
 for(const legacy of [true,false]){const f=fosterFixture(7),{w,child}=f;const offer=proposeFoster(f);
  if(legacy){delete offer.id;delete offer.createdAt;delete offer.childApprovedAt;offer.childApproved=true;}
  else chooseFoster(w,child,'familyConsent');
  const birth=child.bornAt,evidence=structuredClone(offer);assert.equal(guardianHasPersonalApproval(w,child,offer),true);
  for(const value of invalid){corrupt(child,value);assert.equal(guardianHasPersonalApproval(w,child,offer),false);assert.deepEqual(offer,evidence);}
  child.bornAt=birth;assert.equal(guardianHasPersonalApproval(w,child,offer),true);
 }
});

test('review: unknown ages preserve absent or existing stages and capacities but clear both expiry types',()=>{
 for(const stage of [undefined,'infant','child','teen','adult','elder'] as const)for(const ability of [false,true]){
  const f=fosterFixture(7),{w,child,guardian}=f;const offer=proposeFoster(f);corrupt(child,null);
  child.lifeStage=stage;child.canDecide=child.canExpress=ability;child.energy=1;
  child.homeInvitation={hostId:guardian.id,buildingId:'synthetic-missing-house',expiresAt:offer.expiresAt};
  w.minute=offer.expiresAt;infantRest(w,child,1);advanceLife(w,1);
  assert.equal(child.energy,1);assert.equal(child.lifeStage,stage);assert.equal(child.canDecide,ability);assert.equal(child.canExpress,ability);
  assert.equal(child.guardianOffer,undefined);assert.equal(child.homeInvitation,undefined);assert.deepEqual(child.guardianIds,[guardian.id]);
 }
});

for(const age of [5,6,17])test(`review: known age ${age} preserves real numbered grant rules`,()=>{
 const f=fosterFixture(age),{w,child,guardian,volunteer}=f;proposeFoster(f);chooseFoster(w,guardian,'familyConsent');
 if(age>=6){assert.deepEqual(child.guardianIds,[guardian.id]);chooseFoster(w,child,'familyConsent');}
 assert.deepEqual(child.guardianIds,[guardian.id,volunteer.id]);assert.equal(child.guardianOffer,undefined);
 assert.equal(w.events.filter(e=>e.populationChange==='guardian').length,1);
});
