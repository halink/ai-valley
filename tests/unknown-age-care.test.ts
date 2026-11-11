import assert from 'node:assert/strict';
import {test} from 'node:test';
import {birthdayCareFixture,careMenu,chooseCare,hasCare} from './helpers/long-care-age-consent.js';
import {finishLongCare} from './helpers/long-care-meal-evidence.js';
import {childTransportFixture,transportMenu,selectTransport,queueTransport,runTransport,finishTransport,pickUpChild} from './helpers/child-medical-transport-age-consent.js';
import {completeLongCare,initializeLongCare,longCareReason,advanceLongCare} from '../src/world/long-care.js';
import {longCareHasPersonalAssent} from '../src/world/long-care-consent.js';
import {completeHealth,healthReason} from '../src/world/health.js';
import {rescueAuthority,syncMedicalTransport,passenger} from '../src/world/medical-transport.js';
import {transportPersonalConsent,transportConsentUsable} from '../src/world/medical-transport-consent.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';
import type {Resident,World} from '../src/shared/types.js';

const invalid=[['null',null],['NaN',NaN],['undefined',undefined],['Infinity',Infinity],['string','unknown'],['future','future']] as const;
function damage(w:World,p:Resident,value:unknown){p.bornAt=(value==='future'?w.minute+10*YEAR:value) as number;}
const hasHealth=(w:World,r:Resident,operation:string)=>transportMenu(w,r).some(c=>c.action.type==='health'&&c.action.operation===operation);

for(const [name,value] of invalid){
 test(`unknown ${name}: old guardian long care cannot feed, charge, arm, or invent assent`,()=>{
  const {w,provider,beneficiary,other,c}=birthdayCareFixture();damage(w,beneficiary,value);
  const stock={...provider.inventory},money=totalCoins(w),escrow=accountBalance(w,c.account),original={id:c.id,acceptedAt:c.acceptedAt,start:c.startDay,end:c.endDay};
  for(const operation of ['visit','arm','assent'] as const)assert.ok(completeLongCare(w,operation==='assent'?beneficiary:provider,{type:'longCare',operation,agreementId:c.id}));
  assert.equal(hasCare(w,provider,c.id,'visit'),false);assert.equal(hasCare(w,beneficiary,c.id,'assent'),false);
  assert.equal(careMenu(w,provider).some(c=>c.action.type==='longCare'&&c.action.operation==='offer'&&c.action.targetId===beneficiary.id),false);
  initializeLongCare(w);assert.equal(c.status,'awaitingChild');assert.ok(c.assentPausedAt!==undefined);assert.equal(c.childAssent,false);assert.equal(c.childAssentedAt,null);assert.equal(longCareHasPersonalAssent(w,c),false);
  assert.deepEqual(stepWorldWithFoodEvidence(w,.25).longCareMeals,[]);assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.equal(c.refunded,0);assert.deepEqual(provider.inventory,stock);assert.equal(totalCoins(w),money);assert.equal(accountBalance(w,c.account),escrow);
  assert.deepEqual({id:c.id,acceptedAt:c.acceptedAt,start:c.startDay,end:c.endDay},original);
  // Losing known age must not make a historical signer into a valid proxy again.
  c.status='offered';c.acceptedAt=null;assert.ok(longCareReason(w,other,{type:'longCare',operation:'accept',agreementId:c.id}));assert.equal(hasCare(w,other,c.id,'accept'),false);
 });
 test(`unknown ${name}: medical proxy cannot accept, carry, or noncritically stabilize`,()=>{
  const {w,helper,child,guardian,offer,clinic}=childTransportFixture(false);damage(w,child,value);const stock={...guardian.inventory},otherStock={...helper.inventory};
  assert.ok(completeHealth(w,guardian,{type:'health',operation:'acceptRescue',offerId:offer.id}));assert.equal(hasHealth(w,guardian,'acceptRescue'),false);
  assert.equal(rescueAuthority(w,guardian,child,clinic.id),null);assert.equal(rescueAuthority(w,guardian,child,undefined,false),null);
  for(const operation of ['rescue','stabilize'] as const){assert.ok(completeHealth(w,guardian,{type:'health',operation,targetId:child.id,...(operation==='rescue'?{buildingId:clinic.id}:{})}));assert.equal(hasHealth(w,guardian,operation),false);}
  assert.equal(hasHealth(w,helper,'rescueOffer'),false);assert.equal(offer.personalAcceptedAt,null);assert.equal(w.health!.transports.length,0);assert.deepEqual(guardian.inventory,stock);assert.deepEqual(helper.inventory,otherStock);
  offer.status='accepted';offer.proxyAcceptedAt=w.minute;assert.equal(transportPersonalConsent(w,offer,child),false);assert.equal(transportConsentUsable(w,offer,child),false);syncMedicalTransport(w);assert.equal(offer.status,'awaitingPatient');assert.equal(offer.personalAcceptedAt,null);
 });
}

for(const reverse of [false,true])test(`long care rejects changed birth record during last quarter, order ${reverse}`,()=>{
 const {w,provider,beneficiary,c}=birthdayCareFixture();chooseCare(w,provider,c.id,'visit');stepWorld(w,19.75);assert.ok(provider.activity);if(reverse)w.residents.reverse();damage(w,beneficiary,null);
 const stock={...provider.inventory},escrow=accountBalance(w,c.account),money=totalCoins(w);assert.ok(completeLongCare(w,provider,provider.activity!.action as never));assert.deepEqual(stepWorldWithFoodEvidence(w,.25).longCareMeals,[]);
 assert.equal(c.status,'awaitingChild');assert.equal(c.paid,0);assert.equal(c.visits.length,0);assert.deepEqual(provider.inventory,stock);assert.equal(accountBalance(w,c.account),escrow);assert.equal(totalCoins(w),money);
 beneficiary.canExpress=true;beneficiary.canDecide=false;const stop=chooseCare(w,beneficiary,c.id,'cancel');assert.equal(c.status,'cancelled');assert.equal(c.refunded,12);assert.deepEqual(submitPlan(w,stop),{ok:true});assert.equal(c.refunded,12);assert.equal(c.childAssentedAt,null);
});

for(const operation of ['rescue','stabilize'] as const)test(`medical ${operation} rejects changed birth record during last quarter without materials`,()=>{
 const {w,child,guardian}=childTransportFixture();const action=selectTransport(w,guardian,operation,child.id);queueTransport(w,guardian,action);stepWorld(w,operation==='rescue'?14.75:29.75);assert.ok(guardian.activity);damage(w,child,null);
 const stock={...guardian.inventory},at={...child.at},treatment=w.health!.cases[0].treatment;assert.ok(completeHealth(w,guardian,guardian.activity!.action as never));stepWorld(w,.25);
 assert.deepEqual(guardian.inventory,stock);assert.deepEqual(child.at,at);assert.equal(w.health!.transports.length,0);assert.equal(w.health!.cases[0].treatment,treatment);
});

for(const reverse of [false,true])test(`started proxy transport stops when birth becomes unknown before next movement, order ${reverse}`,()=>{
 const f=childTransportFixture(),t=pickUpChild(f),{w,helper,child,offer}=f;if(reverse)w.residents.reverse();damage(w,child,null);
 const stock={...helper.inventory},at=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt});stepWorld(w,.25);
 assert.equal(t.phase,'interrupted');assert.equal(helper.activity,null);assert.equal(passenger(w,child.id),undefined);assert.deepEqual({at:child.at,inside:child.inside,roomAt:child.roomAt},at);assert.deepEqual(helper.inventory,stock);assert.equal(offer.status,'awaitingPatient');assert.equal(offer.personalAcceptedAt,null);
});

for(const operation of ['declineRescue','cancelRescue'] as const)test(`unknown age retains genuine immediate personal ${operation}`,()=>{
 const {w,child,offer}=childTransportFixture();damage(w,child,null);child.canExpress=true;child.canDecide=false;
 assert.equal(hasHealth(w,child,'acceptRescue'),false);const plan=queueTransport(w,child,selectTransport(w,child,operation));assert.equal(offer.status,operation==='declineRescue'?'declined':'cancelled');assert.equal(offer.personalAcceptedAt,null);assert.deepEqual(submitPlan(w,plan),{ok:true});
});

test('SQLite preserves unknown legacy long care as paused without invented personal timestamp or prepaid loss',()=>{
 const {w,beneficiary,c,provider}=birthdayCareFixture();damage(w,beneficiary,NaN);c.childAssent=true;delete c.childAssentedAt;
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!,saved=loaded.longCare!.agreements[0];initializeLongCare(loaded);
  assert.equal(saved.status,'awaitingChild');assert.equal(saved.childAssent,false);assert.equal(saved.childAssentedAt,null);assert.equal(saved.legacyPersonalAssent,undefined);assert.equal(saved.id,c.id);assert.equal(accountBalance(loaded,saved.account),12);
  const before=JSON.stringify(saved);initializeLongCare(loaded);assert.equal(JSON.stringify(saved),before);assert.equal(hasCare(loaded,loaded.residents.find(r=>r.id===provider.id)!,saved.id,'visit'),false);
  loaded.minute=saved.endDay*DAY;advanceLongCare(loaded);assert.equal(saved.status,'completed');assert.equal(saved.refunded,12);assert.equal(saved.paid,0);
 }finally{store.close();}
});

test('SQLite unknown proxy transport pauses at actual location, retaining used resources and original offer evidence',()=>{
 const f=childTransportFixture(),t=pickUpChild(f),{w,child,helper,offer}=f;damage(w,child,NaN);const stock={...helper.inventory},at=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt});
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!;syncMedicalTransport(loaded);const saved=loaded.health!.transportOffers.find(o=>o.id===offer.id)!,p=loaded.residents.find(r=>r.id===child.id)!;
  assert.equal(loaded.health!.transports.find(x=>x.id===t.id)!.phase,'interrupted');assert.equal(saved.status,'awaitingPatient');assert.equal(saved.personalAcceptedAt,null);assert.equal(saved.proxyAcceptedAt,offer.proxyAcceptedAt);assert.equal(saved.createdAt,offer.createdAt);assert.equal(saved.expiresAt,offer.expiresAt);assert.deepEqual(loaded.residents.find(r=>r.id===helper.id)!.inventory,stock);assert.deepEqual({at:p.at,inside:p.inside,roomAt:p.roomAt},at);
 }finally{store.close();}
});

test('unknown age does not remove strict age-independent emergency stabilization, refusal and capacity still end it',()=>{
 const {w,helper,child,guardian}=childTransportFixture();damage(w,child,null);child.health=15;guardian.at={x:1,y:1};
 assert.equal(rescueAuthority(w,helper,child,undefined,false)?.basis,'emergency');const before={...helper.inventory};runTransport(w,helper,selectTransport(w,helper,'stabilize',child.id));assert.equal(helper.inventory.medicine,before.medicine!-1);assert.equal(helper.inventory.water,before.water!-1);
 child.health=15;child.refusesCare=true;assert.equal(rescueAuthority(w,helper,child,undefined,false),null);child.refusesCare=false;child.canDecide=child.canExpress=true;assert.equal(rescueAuthority(w,helper,child,undefined,false),null);
});

for(const age of [2,6,8])test(`known ${age}-year-old long care keeps original guardian and independent assent rules`,()=>{
 const {w,beneficiary,provider,c}=birthdayCareFixture();beneficiary.bornAt=c.createdAt-age*YEAR;beneficiary.lifeStage=age<6?'infant':'child';beneficiary.canDecide=beneficiary.canExpress=age>=6;initializeLongCare(w);
 if(age>=6){assert.equal(c.status,'awaitingChild');chooseCare(w,beneficiary,c.id,'assent');finishLongCare(w,beneficiary);}assert.equal(c.status,'active');chooseCare(w,provider,c.id,'visit');finishLongCare(w,provider);assert.equal(c.visits.length,1);assert.equal(c.paid,3);
});

for(const age of [2,6,8])test(`known ${age}-year-old medical transport keeps actual proxy or patient consent`,()=>{
 const f=childTransportFixture(),{w,child,offer}=f;child.bornAt=offer.createdAt-age*YEAR;child.lifeStage=age<6?'infant':'child';child.canDecide=child.canExpress=age>=6;syncMedicalTransport(w);
 if(age>=6){assert.equal(offer.status,'awaitingPatient');runTransport(w,child,selectTransport(w,child,'acceptRescue'));assert.ok(transportPersonalConsent(w,offer,child));}
 const t=pickUpChild(f);finishTransport(w,f.helper);assert.equal(t.phase,'delivered');
});

test('unknown age blocks completing a previously approved long-care handoff without ending either agreement',()=>{
 const {w,provider,beneficiary,other,c}=birthdayCareFixture();const next=structuredClone(c);next.id+=':replacement';next.providerId=other.id;next.account+=':replacement';next.reserved=0;next.fee=0;next.knownBy=w.residents.map(r=>r.id);w.longCare!.agreements.push(next);c.knownBy=w.residents.map(r=>r.id);
 assert.equal(completeLongCare(w,provider,{type:'longCare',operation:'handoff',agreementId:c.id,replacementId:next.id}),null);const handoff=w.longCare!.handoffs.at(-1)!;
 assert.equal(completeLongCare(w,other,{type:'longCare',operation:'approveHandoff',replacementId:handoff.id}),null);damage(w,beneficiary,null);
 const original=structuredClone(handoff),escrow=accountBalance(w,c.account),money=totalCoins(w);assert.ok(completeLongCare(w,other,{type:'longCare',operation:'receiveHandoff',replacementId:handoff.id}));
 assert.equal(careMenu(w,other).some(row=>row.action.type==='longCare'&&row.action.operation==='receiveHandoff'),false);assert.deepEqual(handoff,original);assert.equal(c.refunded,0);assert.equal(next.refunded,0);assert.equal(accountBalance(w,c.account),escrow);assert.equal(totalCoins(w),money);
});

test('unknown age preserves a genuine recorded personal long-care choice without treating it as current permission',()=>{
 const {w,provider,beneficiary,c}=birthdayCareFixture();beneficiary.bornAt=c.createdAt-8*YEAR;beneficiary.lifeStage='child';beneficiary.canDecide=beneficiary.canExpress=true;initializeLongCare(w);chooseCare(w,beneficiary,c.id,'assent');finishLongCare(w,beneficiary);
 const accepted=c.childAssentedAt;assert.equal(typeof accepted,'number');damage(w,beneficiary,null);initializeLongCare(w);assert.equal(c.status,'awaitingChild');assert.equal(c.childAssent,true);assert.equal(c.childAssentedAt,accepted);assert.equal(longCareHasPersonalAssent(w,c),false);assert.equal(hasCare(w,provider,c.id,'visit'),false);
 const stop=chooseCare(w,beneficiary,c.id,'cancel');assert.equal(c.status,'cancelled');assert.equal(c.refunded,12);assert.deepEqual(submitPlan(w,stop),{ok:true});assert.equal(c.childAssentedAt,accepted);
});

test('unknown age preserves a genuine recorded personal medical choice without substituting proxy or current consent',()=>{
 const {w,helper,child,offer,clinic}=childTransportFixture();child.bornAt=offer.createdAt-8*YEAR;child.lifeStage='child';child.canDecide=child.canExpress=true;syncMedicalTransport(w);runTransport(w,child,selectTransport(w,child,'acceptRescue'));const accepted=offer.personalAcceptedAt;assert.equal(typeof accepted,'number');damage(w,child,null);syncMedicalTransport(w);
 assert.equal(offer.status,'awaitingPatient');assert.equal(offer.personalAcceptedAt,accepted);assert.equal(rescueAuthority(w,helper,child,clinic.id),null);assert.equal(hasHealth(w,child,'acceptRescue'),false);queueTransport(w,child,selectTransport(w,child,'declineRescue'));assert.equal(offer.status,'declined');assert.equal(offer.personalAcceptedAt,accepted);
});
