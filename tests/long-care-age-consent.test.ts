import {test} from 'node:test';
import assert from 'node:assert/strict';
import {birthdayCareFixture,chooseCare,hasCare,selectCare,careMenu,careAction} from './helpers/long-care-age-consent.js';
import {finishLongCare} from './helpers/long-care-meal-evidence.js';
import {carePlan,queueCareAction} from './helpers/care-meal-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {advanceLongCare,initializeLongCare,longCareReason,completeLongCare} from '../src/world/long-care.js';
import {longCareHasPersonalAssent} from '../src/world/long-care-consent.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';
import {parseChoice} from '../src/server/affordances.js';

for(const reverse of [false,true])test(`birthday last quarter pauses before any feeding or payment, resident order ${reverse}`,()=>{
 const f=birthdayCareFixture(),{w,provider,beneficiary,c,birthday}=f;if(reverse)w.residents.reverse();
 assert.equal(hasCare(w,beneficiary,c.id,'assent'),false);
 chooseCare(w,provider,c.id,'visit');stepWorld(w,19.75);assert.equal(w.minute,birthday-.25);
 assert.equal(c.status,'active');assert.equal(c.visits.length,0);const inventory={...provider.inventory},coins=totalCoins(w),balance=accountBalance(w,c.account);
 assert.deepEqual(stepWorldWithFoodEvidence(w,.25).longCareMeals,[]);
 assert.equal(c.status,'awaitingChild');assert.equal(c.assentPausedAt,birthday);assert.equal(c.childAssent,false);assert.equal(c.childAssentedAt,null);
 assert.equal(beneficiary.canDecide,true);assert.equal(beneficiary.canExpress,true);assert.equal(c.visits.length,0);assert.equal(c.paid,0);
 assert.deepEqual(provider.inventory,inventory);assert.equal(accountBalance(w,c.account),balance);assert.equal(totalCoins(w),coins);
 assert.equal(hasCare(w,provider,c.id,'visit'),false);assert.equal(hasCare(w,beneficiary,c.id,'assent'),true);assert.equal(hasCare(w,beneficiary,c.id,'cancel'),true);
 const signed=c.acceptedAt,original=c.id,reserved=c.reserved,payerCoins=f.other.coins;
 chooseCare(w,beneficiary,c.id,'assent');finishLongCare(w,beneficiary);assert.equal(c.status,'active');assert.ok(longCareHasPersonalAssent(w,c));
 assert.equal(c.acceptedAt,signed);assert.equal(c.id,original);assert.equal(c.reserved,reserved);assert.equal(f.other.coins,payerCoins);assert.equal(c.paid,0);
 chooseCare(w,provider,c.id,'visit');const receipts=finishLongCare(w,provider);assert.equal(receipts.length,1);assert.equal(c.visits.length,1);assert.equal(c.paid,3);
 assert.equal(provider.inventory.meal,inventory.meal!-1);assert.equal(provider.inventory.water,inventory.water!-1);assert.equal(totalCoins(w),coins);
 assert.ok(longCareReason(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));
});

test('birthday pause retains original escrow beyond first window; independent refusal is immediate and permanent',()=>{
 const {w,provider,beneficiary,c,birthday}=birthdayCareFixture();w.minute=birthday;stepWorld(w,.25);
 w.minute=c.startDay*DAY+c.startMinute+c.windowMinutes+1;advanceLongCare(w);
 assert.equal(c.status,'awaitingChild');assert.equal(c.refunded,0);assert.equal(accountBalance(w,c.account),12);
 const stop=chooseCare(w,beneficiary,c.id,'cancel');assert.equal(c.status,'cancelled');assert.equal(c.refunded,12);assert.equal(accountBalance(w,c.account),0);
 assert.deepEqual(submitPlan(w,stop),{ok:true});beneficiary.canDecide=beneficiary.canExpress=true;advanceLongCare(w);
 assert.equal(c.status,'cancelled');assert.equal(c.refunded,12);assert.equal(c.paid,0);assert.equal(hasCare(w,beneficiary,c.id,'assent'),false);
 assert.ok(completeLongCare(w,beneficiary,{type:'longCare',operation:'assent',agreementId:c.id}));assert.ok(longCareReason(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));
});

test('independent assent cannot clear an existing refusal or be supplied by provider or guardian',()=>{
 const {w,provider,beneficiary,other,c,birthday}=birthdayCareFixture();w.minute=birthday;stepWorld(w,.25);
 const assent=selectCare(w,beneficiary,c.id,'assent');beneficiary.refusesCare=true;
 assert.equal(hasCare(w,beneficiary,c.id,'assent'),false);assert.ok(completeLongCare(w,beneficiary,assent as never));
 for(const actor of [provider,other])assert.ok(completeLongCare(w,actor,{type:'longCare',operation:'assent',agreementId:c.id}));
 assert.equal(beneficiary.refusesCare,true);assert.equal(c.status,'awaitingChild');assert.equal(c.childAssent,false);assert.equal(c.paid,0);
 chooseCare(w,beneficiary,c.id,'cancel');assert.equal(c.status,'cancelled');assert.equal(beneficiary.refusesCare,true);
});

for(const capacity of ['expressionOnly','neither'] as const)test(`birthday without independent capacity stays safely paused: ${capacity}`,()=>{
 const {w,provider,beneficiary,c,birthday}=birthdayCareFixture();w.minute=birthday;stepWorld(w,.25);
 beneficiary.canDecide=false;beneficiary.canExpress=capacity==='expressionOnly';beneficiary.lifeStage='child';beneficiary.decisionDue=w.minute;beneficiary.lastDecisionAt=w.minute;
 const inventory={...provider.inventory},money=totalCoins(w);stepWorld(w,1);
 assert.equal(c.status,'awaitingChild');assert.equal(c.refunded,0);assert.equal(hasCare(w,beneficiary,c.id,'assent'),false);
 assert.equal(submitPlan(w,carePlan(w,beneficiary,[careAction(c.id,'assent')])).ok,false);
 assert.equal(beneficiary.canDecide,false);assert.equal(beneficiary.canExpress,capacity==='expressionOnly');assert.equal(c.paid,0);assert.deepEqual(provider.inventory,inventory);assert.equal(totalCoins(w),money);
 if(capacity==='expressionOnly'){assert.equal(hasCare(w,beneficiary,c.id,'cancel'),true);chooseCare(w,beneficiary,c.id,'cancel');assert.equal(c.status,'cancelled');}
 else{assert.equal(hasCare(w,beneficiary,c.id,'cancel'),false);beneficiary.canDecide=beneficiary.canExpress=true;chooseCare(w,beneficiary,c.id,'assent');finishLongCare(w,beneficiary);assert.equal(c.status,'active');}
});

test('guardian acceptance after birthday cannot reuse the under-six offer default',()=>{
 const {w,provider,beneficiary,other,c}=birthdayCareFixture(false);
 // Legacy under-six offer with its historical automatic true, not an actual signature.
 c.childAssent=true;delete c.childAssentedAt;
 beneficiary.bornAt=w.minute-6*YEAR;beneficiary.canDecide=beneficiary.canExpress=true;
 initializeLongCare(w);assert.equal(c.childAssent,false);
 chooseCare(w,other,c.id,'accept');finishLongCare(w,other);assert.equal(c.status,'awaitingChild');assert.equal(c.childAssent,false);assert.equal(c.reserved,12);
 assert.ok(longCareReason(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));assert.equal(hasCare(w,beneficiary,c.id,'assent'),true);
});

test('initial six-year-old agreement still expires at its first deadline, a birthday pause does not renew',()=>{
 const f=birthdayCareFixture();f.w.minute=f.birthday;stepWorld(f.w,.25);const {w,c}=f;
 const other=structuredClone(c);other.id+=':initial';other.status='awaitingChild';delete other.assentPausedAt;other.account+=':initial';other.reserved=0;other.fee=0;w.longCare!.agreements.push(other);
 w.minute=c.startDay*DAY+c.startMinute+c.windowMinutes;advanceLongCare(w);assert.equal(other.status,'expired');assert.equal(c.status,'awaitingChild');
 w.minute=c.endDay*DAY;advanceLongCare(w);assert.equal(c.status,'completed');assert.equal(c.refunded,12);assert.equal(accountBalance(w,c.account),0);
 assert.ok(completeLongCare(w,f.beneficiary,{type:'longCare',operation:'assent',agreementId:c.id}));assert.equal(c.endDay,f.c.endDay);
});

test('legacy under-six true pauses on reload, existing older assent stays valid, normalization is idempotent',()=>{
 for(const legacyAge of [2,8]){const {w,c,beneficiary,birthday}=birthdayCareFixture();c.childAssent=true;delete c.childAssentedAt;
  if(legacyAge===8)beneficiary.bornAt=c.createdAt-8*YEAR;
  w.minute=birthday;const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!,saved=loaded.longCare!.agreements[0];initializeLongCare(loaded);
   assert.equal(saved.status,legacyAge===2?'awaitingChild':'active');assert.equal(saved.childAssent,legacyAge!==2);assert.equal(longCareHasPersonalAssent(loaded,saved),legacyAge!==2);assert.equal(saved.childAssentedAt,null);assert.equal(saved.legacyPersonalAssent,legacyAge===8?true:undefined);
   const snapshot=JSON.stringify(saved);initializeLongCare(loaded);assert.equal(JSON.stringify(saved),snapshot);
   loaded.revision++;store.commit(loaded,w.revision);const again=store.load()!;initializeLongCare(again);assert.deepEqual(again.longCare!.agreements[0],saved);
  }finally{store.close();}}
});

test('SQLite stale service cannot overwrite birthday pause or explicit refusal; receipts and original ID survive reload',()=>{
 const {w,provider,beneficiary,c}=birthdayCareFixture();chooseCare(w,provider,c.id,'visit');stepWorld(w,19.75);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const winner=store.load()!,stale=store.load()!,prior=w.revision;
  stepWorld(winner,.25);const p=winner.residents.find(p=>p.id===beneficiary.id)!;const stop=chooseCare(winner,p,c.id,'cancel');store.commit(winner,prior);
  stepWorld(stale,.25);assert.equal(stale.longCare!.agreements[0].paid,0);assert.throws(()=>store.commit(stale,prior),/stale_world_revision/);
  const loaded=store.load()!,saved=loaded.longCare!.agreements[0];assert.deepEqual(submitPlan(loaded,stop),{ok:true});stepWorld(loaded,.25);
  assert.equal(saved.id,c.id);assert.equal(saved.status,'cancelled');assert.equal(saved.refunded,12);assert.equal(saved.paid,0);assert.equal(saved.visits.length,0);
  assert.equal(accountBalance(loaded,saved.account),0);assert.deepEqual(loaded.residents.find(p=>p.id===provider.id)!.inventory,provider.inventory);
 }finally{store.close();}
});


test('previously armed care waits for independent assent and remains separately disarmable while paused',()=>{
 for(const disarm of [false,true]){
  const {w,c,provider,beneficiary,birthday}=birthdayCareFixture(true,true);
  // Arm before the service window, using the original numbered decision.
  w.minute=c.startDay*DAY+c.startMinute-10;chooseCare(w,provider,c.id,'arm');finishLongCare(w,provider);assert.equal(c.armed,true);
  w.minute=birthday;stepWorld(w,.25);assert.equal(c.status,'awaitingChild');assert.equal(provider.plan,null);assert.equal(c.armed,true);
  assert.equal(advanceLongCare(w).length,0);assert.equal(c.visits.length,0);assert.equal(c.paid,0);
  if(disarm){chooseCare(w,provider,c.id,'disarm');finishLongCare(w,provider);assert.equal(c.armed,false);}
  chooseCare(w,beneficiary,c.id,'assent');finishLongCare(w,beneficiary);assert.equal(c.status,'active');
  if(disarm){assert.equal(provider.plan,null);assert.equal(c.visits.length,0);}
  else{assert.ok(provider.plan);finishLongCare(w,provider);assert.equal(c.visits.length,1);assert.equal(c.paid,3);}
 }
});

test('remote refusal of a paused original promise refunds it once without exposing remote settlement',()=>{
 const {w,c,beneficiary,birthday}=birthdayCareFixture(true,true);w.minute=birthday;stepWorld(w,.25);beneficiary.at={x:1,y:16};beneficiary.canDecide=false;
 const menu=careMenu(w,beneficiary),stop=menu.find(c=>c.action.type==='promise'&&c.action.operation==='withdraw');assert.ok(stop);
 const p=queueCareAction(w,beneficiary,parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0]);
 assert.equal(c.status,'cancelled');assert.equal(c.refunded,12);assert.equal(c.paid,0);assert.equal(accountBalance(w,c.account),0);
 assert.deepEqual(submitPlan(w,p),{ok:true});assert.equal(c.refunded,12);
});

test('paused escrow and later independent assent persist across working SQLite reload without new reservation',()=>{
 const {w,c,beneficiary,other,birthday}=birthdayCareFixture();w.minute=birthday;stepWorld(w,.25);const store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.loadForRuntime()!,r=loaded.residents.find(r=>r.id===beneficiary.id)!,saved=loaded.longCare!.agreements[0];
  const original=structuredClone(saved),coins=loaded.residents.find(r=>r.id===other.id)!.coins,revision=loaded.revision;
  const p=chooseCare(loaded,r,c.id,'assent');finishLongCare(loaded,r);store.commit(loaded,revision);
  const again=store.loadForRuntime()!,confirmed=again.longCare!.agreements[0];assert.deepEqual(submitPlan(again,p),{ok:true});initializeLongCare(again);
  assert.equal(confirmed.status,'active');assert.equal(confirmed.childAssent,true);assert.equal(confirmed.childAssentedAt,saved.childAssentedAt);assert.equal(confirmed.assentPausedAt,undefined);
  assert.equal(confirmed.acceptedAt,original.acceptedAt);assert.equal(confirmed.reserved,original.reserved);assert.equal(confirmed.startDay,original.startDay);assert.equal(confirmed.endDay,original.endDay);
  assert.equal(accountBalance(again,confirmed.account),12);assert.equal(again.residents.find(r=>r.id===other.id)!.coins,coins);assert.equal(confirmed.paid,0);assert.equal(confirmed.visits.length,0);
 }finally{store.close();}
});

test('pure action guards reject birthday completion even before the next normalization pass',()=>{
 const {w,c,provider,beneficiary,birthday}=birthdayCareFixture();w.minute=birthday;beneficiary.canDecide=beneficiary.canExpress=true;
 const stock={...provider.inventory};assert.equal(c.status,'active');assert.ok(completeLongCare(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));
 assert.equal(hasCare(w,beneficiary,c.id,'assent'),true);assert.equal(c.visits.length,0);assert.deepEqual(provider.inventory,stock);
});


test('simulation pause never turns silence into consent and immediate refusal survives resuming the clock',()=>{
 const {w,c,provider,beneficiary,birthday}=birthdayCareFixture();chooseCare(w,provider,c.id,'visit');stepWorld(w,19.75);stepWorld(w,.25);
 assert.equal(w.minute,birthday);assert.equal(c.status,'awaitingChild');w.clock.paused=true;
 const at=w.minute,stock={...provider.inventory};stepWorld(w,60);assert.equal(w.minute,at);assert.equal(c.status,'awaitingChild');assert.equal(c.childAssent,false);
 chooseCare(w,beneficiary,c.id,'cancel');assert.equal(c.status,'cancelled');assert.equal(c.refunded,12);w.clock.paused=false;stepWorld(w,1);
 assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.deepEqual(provider.inventory,stock);
});


test('queued original address inspection crossing birthday does not mark the paused promise ended',()=>{
 const {w,c,provider,beneficiary,birthday}=birthdayCareFixture(true,true);
 w.minute=c.startDay*DAY+c.startMinute-10;chooseCare(w,provider,c.id,'arm');finishLongCare(w,provider);
 w.minute=birthday-3;stepWorld(w,.25);assert.ok(provider.plan);assert.equal(provider.plan!.actions[0].type,'promise');
 const stock={...provider.inventory};finishLongCare(w,provider);
 assert.equal(c.status,'awaitingChild');assert.equal(c.armed,true);assert.ok(!c.endKnownBy?.includes(provider.id));assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.deepEqual(provider.inventory,stock);
 assert.equal(hasCare(w,beneficiary,c.id,'assent'),true);
});
