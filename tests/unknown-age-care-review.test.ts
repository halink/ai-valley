import assert from 'node:assert/strict';
import {test} from 'node:test';
import {birthdayCareFixture,chooseCare,hasCare} from './helpers/long-care-age-consent.js';
import {childTransportFixture,transportMenu,pickUpChild,finishTransport} from './helpers/child-medical-transport-age-consent.js';
import {longCareReason,advanceLongCare,completeLongCare} from '../src/world/long-care.js';
import {longCareNeedsPersonalAssent,longCareHasPersonalAssent} from '../src/world/long-care-consent.js';
import {transportReason,rescueAuthority,syncMedicalTransport,passenger} from '../src/world/medical-transport.js';
import {transportNeedsPersonalConsent,transportPersonalConsent,transportConsentUsable} from '../src/world/medical-transport-consent.js';
import {completeHealth} from '../src/world/health.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {DAY,YEAR} from '../src/world/time.js';

for(const [label,value] of [['negative Infinity',-Infinity],['numeric string','0'],['boolean',false],['array',[]],['object',{}],['unsafe integer',-Number.MAX_SAFE_INTEGER-1]] as const){
 test(`review: ${label} never gains care or transport permission, and guards are pure`,()=>{
  const {w,beneficiary,provider,c}=birthdayCareFixture();beneficiary.bornAt=value as number;const before=structuredClone(w);
  assert.equal(longCareNeedsPersonalAssent(w,c),true);assert.equal(longCareHasPersonalAssent(w,c),false);
  for(const operation of ['visit','arm','handoff'] as const)assert.ok(longCareReason(w,provider,{type:'longCare',operation,agreementId:c.id}));assert.deepEqual(w,before);assert.equal(hasCare(w,provider,c.id,'visit'),false);
  const f=childTransportFixture();f.child.bornAt=value as number;const original=structuredClone(f.w);
  assert.equal(transportNeedsPersonalConsent(f.w,f.offer,f.child),true);assert.equal(transportPersonalConsent(f.w,f.offer,f.child),false);assert.equal(transportConsentUsable(f.w,f.offer,f.child),false);assert.equal(rescueAuthority(f.w,f.guardian,f.child,f.clinic.id),null);
  for(const operation of ['rescue','stabilize'] as const)assert.ok(transportReason(f.w,f.guardian,{type:'health',operation,targetId:f.child.id,...(operation==='rescue'?{buildingId:f.clinic.id}:{})}));assert.deepEqual(f.w,original);
  assert.equal(transportMenu(f.w,f.guardian).some(x=>x.action.type==='health'&&['rescue','stabilize','acceptRescue'].includes(x.action.operation)),false);
 });
}
test('review: armed care pauses without generated work, early refund, or material/coin changes',()=>{
 const {w,provider,beneficiary,c}=birthdayCareFixture();chooseCare(w,provider,c.id,'arm');while(provider.plan||provider.activity)stepWorld(w,.25);assert.equal(c.armed,true);beneficiary.bornAt=null as unknown as number;
 const money=totalCoins(w),stock={...provider.inventory},id=c.id,end=c.endDay;assert.ok(longCareReason(w,provider,{type:'longCare',operation:'visit',agreementId:id}));assert.deepEqual(advanceLongCare(w),[]);assert.equal(c.status,'awaitingChild');assert.equal(c.id,id);assert.equal(c.endDay,end);assert.equal(accountBalance(w,c.account),12);
 assert.equal(hasCare(w,provider,id,'disarm'),true);assert.equal(completeLongCare(w,provider,{type:'longCare',operation:'disarm',agreementId:id}),null);assert.equal(c.armed,false);
 w.minute=c.startDay*DAY+c.startMinute+c.windowMinutes+1;advanceLongCare(w);assert.equal(c.status,'awaitingChild');assert.equal(c.refunded,0);assert.equal(c.paid,0);assert.deepEqual(provider.inventory,stock);assert.equal(totalCoins(w),money);
 w.minute=end*DAY;advanceLongCare(w);advanceLongCare(w);assert.equal(c.status,'completed');assert.equal(c.refunded,12);assert.equal(accountBalance(w,c.account),0);assert.equal(totalCoins(w),money);
});
test('review: unknown age emergency pickup consumes materials and capacity recovery stops without replenishment',()=>{
 const f=childTransportFixture(),{w,helper,child}=f;child.bornAt=null as unknown as number;child.health=15;assert.equal(rescueAuthority(w,helper,child,f.clinic.id)?.basis,'emergency');const stock={...helper.inventory},t=pickUpChild(f);assert.equal(t.basis,'emergency');assert.equal(t.offerId,null);assert.equal(helper.inventory.cloth,stock.cloth!-1);assert.equal(helper.inventory.water,stock.water!-1);
 const at=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt});child.canDecide=child.canExpress=true;stepWorld(w,.25);assert.equal(t.phase,'interrupted');assert.equal(passenger(w,child.id),undefined);assert.deepEqual({at:child.at,inside:child.inside,roomAt:child.roomAt},at);syncMedicalTransport(w);assert.equal(helper.inventory.cloth,stock.cloth!-1);assert.equal(helper.inventory.water,stock.water!-1);
});
test('review: unknown age critical transport can reach the actual bed without proxy consent',()=>{
 const f=childTransportFixture(),{w,helper,child}=f;child.bornAt=null as unknown as number;child.health=15;const t=pickUpChild(f);finishTransport(w,helper);assert.equal(t.phase,'delivered');assert.equal(t.basis,'emergency');assert.equal(t.offerId,null);assert.equal(child.inside,f.clinic.id);assert.ok(child.roomAt);assert.equal(f.offer.personalAcceptedAt,null);
});
test('review: repairing a birth record cannot automatically resume the stopped old proxy trip',()=>{
 const f=childTransportFixture(),{w,child,helper,offer}=f;const born=child.bornAt,t=pickUpChild(f),stock={...helper.inventory};child.bornAt=null as unknown as number;syncMedicalTransport(w);assert.equal(t.phase,'interrupted');assert.equal(offer.status,'awaitingPatient');child.bornAt=born;syncMedicalTransport(w);stepWorld(w,.25);assert.equal(t.phase,'interrupted');assert.equal(passenger(w,child.id),undefined);assert.deepEqual(helper.inventory,stock);assert.equal(offer.personalAcceptedAt,null);
});
test('review: future/coercible personal consent timestamps are not evidence',()=>{
 const {w,beneficiary,c}=birthdayCareFixture();beneficiary.bornAt=w.minute-8*YEAR;c.childAssent=true;for(const timestamp of [w.minute+1,NaN,Infinity,'0',null]){c.childAssentedAt=timestamp as number;assert.equal(longCareHasPersonalAssent(w,c),false);}
 const f=childTransportFixture();f.child.bornAt=f.w.minute-8*YEAR;for(const timestamp of [f.w.minute+1,NaN,Infinity,'0',null]){f.offer.personalAcceptedAt=timestamp as number;assert.equal(transportPersonalConsent(f.w,f.offer,f.child),false);}
});
test('review: an unknown-age guardian cannot sign a known infant rescue through direct completion',()=>{
 const {w,guardian,offer}=childTransportFixture(false);guardian.bornAt=null as unknown as number;assert.ok(completeHealth(w,guardian,{type:'health',operation:'acceptRescue',offerId:offer.id}));assert.equal(offer.status,'offered');assert.equal(offer.proxyAcceptedAt,null);
});

test('review: unknown-age guardian cannot create a new proxy rescue offer',()=>{
 const {w,helper,child,guardian,clinic,offer}=childTransportFixture(false);offer.status='cancelled';guardian.bornAt=null as unknown as number;
 assert.ok(transportReason(w,helper,{type:'health',operation:'rescueOffer',targetId:child.id,buildingId:clinic.id}));
});

test('review: unknown-age retained guardian does not block strictly critical incapacitated rescue',()=>{
 const {w,helper,child,guardian,offer}=childTransportFixture(false);offer.status='cancelled';guardian.bornAt=null as unknown as number;child.health=15;
 assert.equal(rescueAuthority(w,helper,child,undefined,false)?.basis,'emergency');
});

test('review: unknown provider or carrier age cannot be promoted to adult capability',()=>{
 const {w,provider,c}=birthdayCareFixture();provider.bornAt=null as unknown as number;const before=structuredClone(w);assert.ok(completeLongCare(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));assert.deepEqual(w,before);
 const f=childTransportFixture();f.helper.bornAt=null as unknown as number;f.child.health=15;f.guardian.at={x:1,y:1};assert.equal(rescueAuthority(f.w,f.helper,f.child,f.clinic.id),null);
});

test('review: a known adult guardian still signs an ordinary infant offer and blocks substitute emergency authority',()=>{
 const {w,guardian,helper,child,offer}=childTransportFixture(false);child.health=15;assert.equal(rescueAuthority(w,helper,child,undefined,false),null);assert.equal(completeHealth(w,guardian,{type:'health',operation:'acceptRescue',offerId:offer.id}),null);assert.equal(offer.status,'accepted');assert.equal(offer.proxyAcceptedAt,w.minute);assert.equal(offer.personalAcceptedAt,null);
});


test('review: provider birth corruption in last quarter cannot complete service or charge',()=>{
 const {w,provider,beneficiary,c}=birthdayCareFixture();beneficiary.bornAt=w.minute-2*YEAR;chooseCare(w,provider,c.id,'visit');stepWorld(w,19.75);assert.ok(provider.activity);provider.bornAt=null as unknown as number;
 const inventory={...provider.inventory},escrow=accountBalance(w,c.account),money=totalCoins(w);assert.deepEqual(stepWorldWithFoodEvidence(w,.25).longCareMeals,[]);assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.equal(c.refunded,0);assert.deepEqual(provider.inventory,inventory);assert.equal(accountBalance(w,c.account),escrow);assert.equal(totalCoins(w),money);
});

test('review: accepted old proxy becomes unusable when the guardian birth record is damaged',()=>{
 const f=childTransportFixture(),{w,guardian,child,helper,offer,clinic}=f;const before=structuredClone(offer);guardian.bornAt=null as unknown as number;
 assert.equal(transportConsentUsable(w,offer,child),false);assert.equal(rescueAuthority(w,helper,child,clinic.id),null);assert.ok(transportReason(w,helper,{type:'health',operation:'rescue',targetId:child.id,buildingId:clinic.id}));assert.deepEqual(offer,before);
 assert.equal(transportMenu(w,helper).some(row=>row.action.type==='health'&&row.action.operation==='rescue'),false);
});

test('review: known adult provider completes ordinary contracted service and charges exactly once',()=>{
 const {w,provider,beneficiary,c}=birthdayCareFixture();beneficiary.bornAt=w.minute-2*YEAR;chooseCare(w,provider,c.id,'visit');stepWorld(w,19.75);assert.ok(provider.activity);const inventory={...provider.inventory};const evidence=stepWorldWithFoodEvidence(w,.25);assert.equal(evidence.longCareMeals!.length,1);assert.equal(c.visits.length,1);assert.equal(c.paid,3);assert.equal(accountBalance(w,c.account),9);assert.equal(provider.inventory.meal,inventory.meal!-1);assert.equal(provider.inventory.water,inventory.water!-1);stepWorld(w,.25);assert.equal(c.paid,3);
});
