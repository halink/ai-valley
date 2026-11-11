import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,FormalOpportunity} from '../src/shared/types.js';
import {birthdayCareFixture,chooseCare,hasCare,careMenu,selectCare} from './helpers/long-care-age-consent.js';
import {finishLongCare} from './helpers/long-care-meal-evidence.js';
import {carePlan} from './helpers/care-meal-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {advanceLongCare,authorizeLongCare,completeLongCare,initializeLongCare,longCareReason} from '../src/world/long-care.js';
import {longCareHasPersonalAssent} from '../src/world/long-care-consent.js';
import {addHealthCase} from '../src/world/health.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

// Independent review: generated fixtures and SQLite :memory: only. No runtime files or models.
test('age-consent review: birthday completion guard is safe even before the lifecycle normalization',()=>{
 const {w,provider,beneficiary,c,birthday}=birthdayCareFixture();
 const action:Action={type:'longCare',operation:'visit',agreementId:c.id};
 assert.equal(longCareReason(w,provider,action),null);
 w.minute=birthday;assert.equal(c.status,'active');
 const before=structuredClone({stock:provider.inventory,paid:c.paid,visits:c.visits,hunger:beneficiary.hunger,health:beneficiary.health,money:totalCoins(w)});
 assert.ok(longCareReason(w,provider,action));assert.ok(completeLongCare(w,provider,action));
 assert.deepEqual({stock:provider.inventory,paid:c.paid,visits:c.visits,hunger:beneficiary.hunger,health:beneficiary.health,money:totalCoins(w)},before);
 initializeLongCare(w);assert.equal(c.status,'awaitingChild');assert.equal(c.refunded,0);
});

test('age-consent review: a capable beneficiary has the assent menu before normalization without self-conflicting',()=>{
 const {w,beneficiary,c,birthday}=birthdayCareFixture();w.minute=birthday;
 beneficiary.canDecide=beneficiary.canExpress=true;beneficiary.lifeStage='child';
 const snapshot=JSON.stringify(c);
 assert.equal(longCareReason(w,beneficiary,{type:'longCare',operation:'assent',agreementId:c.id}),null);
 assert.equal(hasCare(w,beneficiary,c.id,'assent'),true);
 assert.equal(JSON.stringify(c),snapshot,'reading the menu cannot sign, pause, or reserve money');
 chooseCare(w,beneficiary,c.id,'assent');finishLongCare(w,beneficiary);
 assert.equal(c.status,'active');assert.equal(c.paid,0);assert.equal(c.reserved,12);assert.ok(longCareHasPersonalAssent(w,c));
});

for(const evidence of ['underSix','beforeAcceptance','future','falseWithTimestamp','nullWithTrue','inapplicableLegacyMarker'] as const)test(`age-consent review: invalid independent evidence cannot authorize service (${evidence})`,()=>{
 const {w,provider,c,birthday}=birthdayCareFixture();w.minute=birthday;
 c.childAssent=evidence!=='falseWithTimestamp';
 c.childAssentedAt=evidence==='underSix'?birthday-1:evidence==='beforeAcceptance'?c.acceptedAt!-1:evidence==='future'?birthday+1:evidence==='nullWithTrue'||evidence==='inapplicableLegacyMarker'?null:birthday;
 if(evidence==='inapplicableLegacyMarker')c.legacyPersonalAssent=true;
 assert.equal(longCareHasPersonalAssent(w,c),false);
 assert.ok(completeLongCare(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));
 initializeLongCare(w);assert.equal(c.status,'awaitingChild');assert.equal(c.paid,0);assert.equal(c.refunded,0);assert.equal(accountBalance(w,c.account),12);
});

test('age-consent review: a critical injury cannot be healed by the birthday; recovery exposes assent without restart',()=>{
 const {w,provider,beneficiary,c,birthday}=birthdayCareFixture();
 const illness=addHealthCase(w,beneficiary,'injury',95,'isolated birthday review')!;
 illness.lastAt=birthday-.25;w.minute=birthday-.25;
 stepWorld(w,.25);
 assert.equal(c.status,'awaitingChild');assert.equal(beneficiary.canDecide,false);assert.equal(beneficiary.canExpress,false);
 assert.deepEqual(illness.capacity,{decide:true,express:true});assert.equal(hasCare(w,beneficiary,c.id,'assent'),false);
 assert.equal(submitPlan(w,carePlan(w,beneficiary,[{type:'longCare',operation:'assent',agreementId:c.id}])).ok,false);
 const stock={...provider.inventory};assert.ok(completeLongCare(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));
 illness.severity=40;beneficiary.health=80;stepWorld(w,.25);
 assert.equal(beneficiary.canDecide,true);assert.equal(beneficiary.canExpress,true);assert.equal(c.status,'awaitingChild');
 assert.equal(hasCare(w,beneficiary,c.id,'assent'),true);assert.equal(c.childAssent,false);
 chooseCare(w,beneficiary,c.id,'assent');finishLongCare(w,beneficiary);
 assert.equal(c.status,'active');assert.ok(longCareHasPersonalAssent(w,c));assert.deepEqual(provider.inventory,stock);assert.equal(c.paid,0);
});

for(const terminal of ['decline','expire'] as const)test(`age-consent review: public funding returns only unearned balance to original treasury (${terminal})`,()=>{
 const {w,provider,beneficiary,other,c,birthday}=birthdayCareFixture(false);
 w.economy!.treasury=30;w.minute=c.startDay*DAY+c.startMinute-1;
 assert.equal(authorizeLongCare(w,c.id,12,2,'synthetic-review-resolution'),null);
 const total=totalCoins(w),payerBalance=other.coins;
 chooseCare(w,other,c.id,'accept');finishLongCare(w,other);
 chooseCare(w,provider,c.id,'visit');assert.equal(finishLongCare(w,provider).length,1);
 assert.ok(w.minute<birthday);assert.equal(c.paid,3);assert.equal(accountBalance(w,c.account),9);
 const stock={...provider.inventory};stepWorld(w,birthday-w.minute);
 assert.equal(c.status,'awaitingChild');assert.equal(c.refunded,0);assert.equal(accountBalance(w,c.account),9);
 const original={id:c.id,startDay:c.startDay,endDay:c.endDay,acceptedAt:c.acceptedAt,reserved:c.reserved};
 if(terminal==='decline'){
  chooseCare(w,beneficiary,c.id,'decline');finishLongCare(w,beneficiary);assert.equal(c.status,'cancelled');
 }else{w.minute=c.endDay*DAY;advanceLongCare(w);assert.equal(c.status,'completed');}
 assert.deepEqual({id:c.id,startDay:c.startDay,endDay:c.endDay,acceptedAt:c.acceptedAt,reserved:c.reserved},original);
 assert.equal(c.refunded,9);assert.equal(c.paid,3);assert.equal(w.economy!.treasury,27);assert.equal(other.coins,payerBalance);assert.equal(totalCoins(w),total);
 assert.equal(accountBalance(w,c.account),0);assert.deepEqual(provider.inventory,stock);
 advanceLongCare(w);assert.equal(w.economy!.treasury,27);assert.equal(c.refunded,9);
});

test('age-consent review: already lawful older child and adult legacy signatures survive two reloads',()=>{
 for(const age of [8,30]){
  const {w,beneficiary,c,birthday}=birthdayCareFixture();w.minute=birthday;
  beneficiary.bornAt=c.createdAt-age*YEAR;c.childAssent=true;delete c.childAssentedAt;
  if(age>=18){c.signerId=beneficiary.id;c.payer=beneficiary.id;beneficiary.guardianIds=[];}
  const before={id:c.id,acceptedAt:c.acceptedAt,reserved:c.reserved,paid:c.paid,refunded:c.refunded,money:totalCoins(w)};
  const store=new WorldStore(':memory:');try{
   store.commit(w,null);let loaded=store.load()!;
   for(let turn=0;turn<2;turn++){
    initializeLongCare(loaded);const saved=loaded.longCare!.agreements[0];
    assert.equal(saved.status,'active');assert.equal(saved.childAssentedAt,null,'old records never prove the precise assent minute');assert.equal(saved.legacyPersonalAssent,true);assert.equal(longCareHasPersonalAssent(loaded,saved),true);
    assert.deepEqual({id:saved.id,acceptedAt:saved.acceptedAt,reserved:saved.reserved,paid:saved.paid,refunded:saved.refunded,money:totalCoins(loaded)},before);
    const revision=loaded.revision;loaded.revision++;store.commit(loaded,revision);loaded=store.load()!;
   }
  }finally{store.close();}
 }
});

test('age-consent review: a late assent loses to an immediate stop and cannot resurrect the original promise',()=>{
 const {w,beneficiary,c,birthday}=birthdayCareFixture();w.minute=birthday;stepWorld(w,.25);
 const assent=selectCare(w,beneficiary,c.id,'assent');
 chooseCare(w,beneficiary,c.id,'assent');stepWorld(w,.75);assert.equal(beneficiary.activity?.remaining,.25);
 chooseCare(w,beneficiary,c.id,'cancel');assert.equal(c.status,'cancelled');assert.equal(c.refunded,12);
 assert.deepEqual(stepWorldWithFoodEvidence(w,.25).longCareMeals,[]);
 assert.equal(c.status,'cancelled');assert.equal(c.childAssent,false);assert.equal(c.childAssentedAt,null);
 assert.ok(completeLongCare(w,beneficiary,assent as never));assert.equal(c.refunded,12);assert.equal(c.paid,0);
 assert.equal(hasCare(w,beneficiary,c.id,'assent'),false);
});

test('age-consent review: saturated independent control agenda keeps stop and eventually exposes a genuine assent',()=>{
 const {w,beneficiary,c,birthday}=birthdayCareFixture();w.minute=birthday;stepWorld(w,.25);
 const context=decisionContext(w,beneficiary),real=context.formal!.opportunities;
 const filler:FormalOpportunity[]=Array.from({length:120},(_,i)=>({id:'review.other-stop.'+i,label:'isolated unrelated control',action:{type:'longCare',operation:'cancel',agreementId:'unrelated:'+i}}));
 context.formal!.opportunities=[...filler,...real];
 let sawAssent=false;
 for(let i=0;i<Math.floor((c.endDay*DAY-birthday)/30);i++){
  context.minute=birthday+i*30;
  const choices=decisionChoices(context);
  assert.ok(choices.some(x=>x.action.type==='longCare'&&x.action.operation==='cancel'&&x.action.agreementId===c.id));
  sawAssent ||= choices.some(x=>x.action.type==='longCare'&&x.action.operation==='assent'&&x.action.agreementId===c.id);
 }
 assert.equal(sawAssent,true);assert.equal(c.status,'awaitingChild');assert.equal(c.paid,0);assert.ok(careMenu(w,beneficiary).length>0);
});
