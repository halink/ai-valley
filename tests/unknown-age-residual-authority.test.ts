import assert from 'node:assert/strict';
import {test} from 'node:test';
import {custodyFixture,helpFixture,evacuationFixture,menu,choose,queue,finish,run,operation,guardianRescue,damage,invalidDates,offerCustody,activateCustody} from './helpers/unknown-age-residual.js';
import {careFixture,acceptedCare,queueOrdinaryCare,finishCareAction} from './helpers/care-meal-evidence.js';
import {completeCustody,advanceProtectedCustody} from '../src/world/protected-custody.js';
import {completeChildHelp} from '../src/world/child-help.js';
import {careAuthority,executeSocialAction} from '../src/world/social.js';
import {completeHealth} from '../src/world/health.js';
import {guardianEvacuationReason} from '../src/world/guardian-evacuation.js';
import {passenger,syncMedicalTransport} from '../src/world/medical-transport.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {totalCoins} from '../src/world/economy.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {ProductionAction} from '../src/shared/production.js';

const careTo=(id:string)=>(a:Action)=>a.type==='care'&&a.targetId===id;
const has=(w:World,r:Resident,predicate:(a:Action)=>boolean)=>menu(w,r).some(c=>predicate(c.action));
function infantCustody(){const f=custodyFixture();f.child.bornAt=f.w.minute-2*YEAR;f.child.canDecide=f.child.canExpress=false;f.child.guardianIds=[f.buyer.id];return f;}
function infantCare(){const f=careFixture();f.beneficiary.bornAt=f.w.minute-2*YEAR;f.beneficiary.canDecide=f.beneficiary.canExpress=false;f.beneficiary.guardianIds=[f.provider.id];return f;}
function pickUp(){const f=evacuationFixture();queue(f.w,f.guardian,choose(f.w,f.guardian,a=>guardianRescue(a)&&a.evacuationDestination!=='safe-ground'));let left=100;while(!passenger(f.w,f.child.id)){assert.ok(left-->0);stepWorld(f.w,.25);}return {...f,t:passenger(f.w,f.child.id)!};}

// These four tests are the initial true-menu/engine red reproduction, before production edits.
test('red reproduction: unknown target cannot acquire toddler protected-custody authority',()=>{
 const f=infantCustody(),{w,child,provider,reviewer,buyer}=f;damage(w,child,null);
 if(has(w,provider,operation('production','custodyOffer'))){offerCustody(f);run(w,buyer,operation('production','custodyAccept'));run(w,reviewer,operation('production','custodyReview'));}
 assert.equal(w.production!.protectedCustody?.mandates.some(c=>c.status==='active')??false,false,'unknown child must not activate an adult-only signed custody mandate');
});
test('red reproduction: unknown target cannot acquire infant third-party public-help consent',()=>{
 const {w,child,reporter}=helpFixture();damage(w,child,null);
 if(has(w,reporter,operation('emergencyCare','requestHelp')))run(w,reporter,operation('emergencyCare','requestHelp'));
 assert.equal(w.emergencyCare?.helpNotices?.length??0,0,'no third party can record a public-help notice under an unknown infant exemption');
});
test('red reproduction: unknown target cannot receive ordinary care through infant guardian permission',()=>{
 const f=infantCare(),{w,provider,beneficiary}=f;damage(w,beneficiary,null);const stock={...provider.inventory};
 if(has(w,provider,careTo(beneficiary.id))){queueOrdinaryCare(f);finishCareAction(w,provider);}
 assert.deepEqual(provider.inventory,stock,'no meal/water may be spent using an unknown infant exemption');
});
test('red reproduction: guardian disaster carry cannot become emergency authority when birth turns unknown',()=>{
 const {w,guardian,child,t}=pickUp();damage(w,child,null);child.health=15;const at=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt}),stock={...guardian.inventory};
 stepWorld(w,.25);assert.equal(t.phase,'interrupted','the original guardian-specific carry must stop, even if a separately chosen emergency action might be possible');assert.deepEqual({at:child.at,inside:child.inside,roomAt:child.roomAt},at);assert.deepEqual(guardian.inventory,stock);
});

for(const [name,value] of invalidDates){
 test(`unknown ${name}: custody cannot offer, accept, review or spend under old infant records`,()=>{
  const f=infantCustody(),{w,provider,child,reviewer,buyer}=f;
  const proposed=choose(w,provider,a=>operation('production','custodyOffer')(a)&&(a as ProductionAction).reviewerId===reviewer.id) as ProductionAction;
  damage(w,child,value);const birth=child.bornAt,rights=structuredClone([child.guardianIds,child.parents,child.homeId]);
  assert.equal(has(w,provider,operation('production','custodyOffer')),false);assert.ok(completeCustody(w,provider,proposed));assert.ok(Object.is(child.bornAt,birth));
  child.bornAt=w.minute-2*YEAR;const c=offerCustody(f);damage(w,child,value);const before=structuredClone(c),stock={...provider.inventory},coins=totalCoins(w);
  for(const [r,op]of [[reviewer,'custodyReview'],[buyer,'custodyAccept']] as const){assert.equal(has(w,r,operation('production',op)),false);assert.ok(completeCustody(w,r,{type:'production',operation:op,custodyId:c.id}));}
  assert.deepEqual(c,before);assert.deepEqual(provider.inventory,stock);assert.equal(totalCoins(w),coins);assert.deepEqual([child.guardianIds,child.parents,child.homeId],rights);
 });
 test(`unknown ${name}: child-help cannot record a self or third-party infant exemption`,()=>{
  const {w,child,reporter}=helpFixture(),selected=choose(w,reporter,operation('emergencyCare','requestHelp'));
  damage(w,child,value);const birth=child.bornAt;assert.equal(has(w,reporter,operation('emergencyCare','requestHelp')),false);
  assert.ok(completeChildHelp(w,reporter,selected as never));child.canDecide=child.canExpress=true;assert.ok(completeChildHelp(w,child,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:1}));
  assert.equal(w.emergencyCare?.helpNotices?.length??0,0);assert.ok(Object.is(child.bornAt,birth));
 });
 test(`unknown ${name}: ordinary guardian care is unavailable without resources or age rewriting`,()=>{
  const f=infantCare(),{w,provider,beneficiary}=f,selected=choose(w,provider,careTo(beneficiary.id));damage(w,beneficiary,value);
  const stock={...provider.inventory},birth=beneficiary.bornAt;assert.equal(careAuthority(w,provider,beneficiary).allowed,false);assert.equal(has(w,provider,careTo(beneficiary.id)),false);
  assert.equal(executeSocialAction(w,provider,selected).ok,false);assert.deepEqual(provider.inventory,stock);assert.ok(Object.is(beneficiary.bornAt,birth));
 });
 test(`unknown ${name}: healthy guardian evacuation has no menu, direct completion or fabricated identity`,()=>{
  const {w,guardian,child,d}=evacuationFixture(),selected=choose(w,guardian,guardianRescue);damage(w,child,value);
  const at={...child.at},stock={...guardian.inventory},birth=child.bornAt;assert.equal(has(w,guardian,guardianRescue),false);assert.ok(guardianEvacuationReason(w,guardian,child,d.id));
  assert.ok(completeHealth(w,guardian,selected as never));assert.deepEqual(child.at,at);assert.deepEqual(guardian.inventory,stock);assert.equal(w.health!.transports.length,0);assert.ok(Object.is(child.bornAt,birth));
 });
}

for(const reverse of [false,true]){
 test(`custody birth corruption at final quarter blocks labor, reimbursement and harvest; resident order ${reverse}`,()=>{
  const f=infantCustody(),{w,provider,child,home,dead}=f,c=activateCustody(f),selected=choose(w,provider,operation('production','custodyRepair'));
  queue(w,provider,selected);stepWorld(w,59.75);assert.ok(provider.activity);if(reverse)w.residents.reverse();damage(w,child,null);
  const before={stock:{...provider.inventory},coins:totalCoins(w),condition:home.condition,share:structuredClone(w.production!.inheritances[dead.id]),history:structuredClone({acceptedBy:c.acceptedBy,reviewedAt:c.reviewedAt,createdAt:c.createdAt,expiresAt:c.expiresAt})};
  assert.ok(completeCustody(w,provider,provider.activity!.action as ProductionAction));stepWorld(w,.25);assert.equal(c.status,'invalid');assert.equal(c.spent,0);assert.equal(c.records.length,0);assert.deepEqual(provider.inventory,before.stock);assert.equal(totalCoins(w),before.coins);assert.equal(home.condition,before.condition);assert.deepEqual(w.production!.inheritances[dead.id],before.share);assert.equal(home.ownerId,dead.id);assert.deepEqual({acceptedBy:c.acceptedBy,reviewedAt:c.reviewedAt,createdAt:c.createdAt,expiresAt:c.expiresAt},before.history);
  assert.ok(completeCustody(w,provider,{type:'production',operation:'custodyHarvest',custodyId:c.id,plotId:f.plot.id,custodyStep:c.workSerial}));
 });
 test(`child-help final quarter revalidates known age without publishing or granting rights; order ${reverse}`,()=>{
  const {w,reporter,child}=helpFixture();queue(w,reporter,choose(w,reporter,operation('emergencyCare','requestHelp')));stepWorld(w,2.75);assert.ok(reporter.activity);if(reverse)w.residents.reverse();damage(w,child,null);
  const rights=structuredClone({inventory:child.inventory,guardians:child.guardianIds,home:child.homeId});stepWorld(w,.25);assert.ok(reporter.lastFailure);assert.equal(w.emergencyCare?.helpNotices?.length??0,0);assert.equal(w.emergencyCare?.nextHelpSerial,undefined);assert.deepEqual({inventory:child.inventory,guardians:child.guardianIds,home:child.homeId},rights);
 });
 test(`ordinary care final quarter stops on unknown birth without meal evidence; order ${reverse}`,()=>{
  const f=infantCare(),{w,provider,beneficiary}=f;queueOrdinaryCare(f);stepWorld(w,29.75);assert.ok(provider.activity);if(reverse)w.residents.reverse();damage(w,beneficiary,null);const stock={...provider.inventory};
  assert.deepEqual(stepWorldWithFoodEvidence(w,.25).careMeals,[]);assert.ok(provider.lastFailure);assert.deepEqual(provider.inventory,stock);
 });
 test(`guardian pickup final quarter rejects unknown birth without materials; order ${reverse}`,()=>{
  const {w,guardian,child}=evacuationFixture();queue(w,guardian,choose(w,guardian,guardianRescue));stepWorld(w,14.75);assert.ok(guardian.activity);if(reverse)w.residents.reverse();damage(w,child,null);const at={...child.at},stock={...guardian.inventory};
  stepWorld(w,.25);assert.ok(guardian.lastFailure);assert.equal(w.health!.transports.length,0);assert.deepEqual(child.at,at);assert.deepEqual(guardian.inventory,stock);
 });
 test(`guardian carrying unknown age cannot silently switch to emergency, order ${reverse}`,()=>{
  const {w,guardian,child,t}=pickUp();if(reverse)w.residents.reverse();damage(w,child,null);child.health=15;const at=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt}),stock={...guardian.inventory};
  stepWorld(w,.25);assert.equal(t.phase,'interrupted');assert.equal(passenger(w,child.id),undefined);assert.deepEqual({at:child.at,inside:child.inside,roomAt:child.roomAt},at);assert.deepEqual(guardian.inventory,stock);
 });
}

test('SQLite legacy unknown active custody ends authority once, preserving signatures, cash, property and original deadline',()=>{
 const f=infantCustody(),c=activateCustody(f),{w,provider,child,dead}=f;damage(w,child,NaN);const original=structuredClone(c),money=totalCoins(w),stock={...provider.inventory},estate=structuredClone(w.estates);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!,saved=loaded.production!.protectedCustody!.mandates[0];advanceProtectedCustody(loaded);assert.equal(saved.status,'invalid');assert.equal(saved.spent,0);assert.deepEqual(saved.acceptedBy,original.acceptedBy);assert.equal(saved.reviewedAt,original.reviewedAt);assert.equal(saved.createdAt,original.createdAt);assert.equal(saved.expiresAt,original.expiresAt);assert.equal(totalCoins(loaded),money);assert.deepEqual(loaded.estates,estate);assert.deepEqual(loaded.residents.find(r=>r.id===provider.id)!.inventory,stock);assert.equal(loaded.residents.find(r=>r.id===child.id)!.bornAt,null);assert.equal(loaded.buildings.find(b=>b.id===f.home.id)!.ownerId,dead.id);
  const before=JSON.stringify(saved),events=loaded.events.length;advanceProtectedCustody(loaded);assert.equal(JSON.stringify(saved),before);assert.equal(loaded.events.length,events);assert.equal(has(loaded,loaded.residents.find(r=>r.id===provider.id)!,operation('production','custodyRepair')),false);
 }finally{store.close();}
});

test('SQLite queued unknown help and care do not consume or create notices, and do not repair birth dates',()=>{
 for(const kind of ['help','care'] as const){const f=kind==='help'?helpFixture():infantCare(),w=f.w,actor='reporter'in f?f.reporter:f.provider,p='child'in f?f.child:f.beneficiary;
  queue(w,actor,choose(w,actor,kind==='help'?operation('emergencyCare','requestHelp'):careTo(p.id)));stepWorld(w,.25);damage(w,p,NaN);const stock={...actor.inventory},store=new WorldStore(':memory:');
  try{store.commit(w,null);const loaded=store.loadForRuntime()!,r=loaded.residents.find(x=>x.id===actor.id)!;finish(loaded,r,false);assert.ok(r.lastFailure);assert.deepEqual(r.inventory,stock);assert.equal(loaded.residents.find(x=>x.id===p.id)!.bornAt,null);assert.equal(loaded.emergencyCare?.helpNotices?.length??0,0);}finally{store.close();}
 }
});

test('SQLite unknown guardian carry keeps actual stop position and spent supplies without inventing a new transport',()=>{
 const {w,guardian,child,t}=pickUp();damage(w,child,NaN);child.health=15;const at=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt}),stock={...guardian.inventory},store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.loadForRuntime()!;syncMedicalTransport(loaded);const saved=loaded.health!.transports.find(x=>x.id===t.id)!,p=loaded.residents.find(x=>x.id===child.id)!;assert.equal(saved.phase,'interrupted');assert.equal(saved.basis,'guardian');assert.equal(saved.startedAt,t.startedAt);assert.deepEqual({at:p.at,inside:p.inside,roomAt:p.roomAt},at);assert.deepEqual(loaded.residents.find(x=>x.id===guardian.id)!.inventory,stock);assert.equal(loaded.health!.transports.length,1);const before=JSON.stringify(saved);syncMedicalTransport(loaded);assert.equal(JSON.stringify(saved),before);}finally{store.close();}
});

for(const age of [0,2]){
 test(`valid ${age}-year-old keeps custody, help, guardian evacuation and ordinary care`,()=>{
  const f=infantCustody();f.child.bornAt=f.w.minute-age*YEAR;assert.equal(activateCustody(f).status,'active');run(f.w,f.provider,operation('production','custodyRepair'));assert.equal(f.w.production!.protectedCustody!.mandates[0].spent,3);
  const h=helpFixture();h.child.bornAt=h.w.minute-age*YEAR;run(h.w,h.reporter,operation('emergencyCare','requestHelp'));assert.equal(h.w.emergencyCare!.helpNotices!.length,1);
  const e=evacuationFixture();e.child.bornAt=e.w.minute-age*YEAR;run(e.w,e.guardian,a=>guardianRescue(a)&&a.evacuationDestination!=='safe-ground');assert.equal(e.w.health!.transports[0].phase,'delivered');
  const c=infantCare();c.beneficiary.bornAt=c.w.minute-age*YEAR;queueOrdinaryCare(c);const receipts=finishCareAction(c.w,c.provider);assert.equal(receipts.length,1);assert.equal(c.provider.inventory.meal,9);assert.equal(c.provider.inventory.water,8);
 });
}

test('normal child independently accepts custody and asks for help, while guardian toddler exemption remains unavailable',()=>{
 const f=custodyFixture();f.child.bornAt=f.w.minute-8*YEAR;assert.equal(activateCustody(f).status,'active');
 const h=helpFixture();h.child.bornAt=h.w.minute-8*YEAR;h.child.canDecide=h.child.canExpress=true;assert.equal(has(h.w,h.reporter,operation('emergencyCare','requestHelp')),false);run(h.w,h.child,operation('emergencyCare','requestHelp'));assert.equal(h.w.emergencyCare!.helpNotices![0].reporterId,h.child.id);
 const e=evacuationFixture();e.child.bornAt=e.w.minute-8*YEAR;e.child.canDecide=e.child.canExpress=true;assert.equal(has(e.w,e.guardian,guardianRescue),false);
});

test('genuine age-independent personal ordinary-care consent survives unknown age, with expression-only immediate stop and replay',()=>{
 const f=careFixture(),p=acceptedCare(f),{w,provider,beneficiary}=f;damage(w,beneficiary,null);queueOrdinaryCare(f);stepWorld(w,29.75);beneficiary.canDecide=false;beneficiary.canExpress=true;
 const stock={...provider.inventory},stop=queue(w,beneficiary,choose(w,beneficiary,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept));assert.equal(p.status,'declined');assert.deepEqual(submitPlan(w,stop),{ok:true});assert.deepEqual(stepWorldWithFoodEvidence(w,.25).careMeals,[]);assert.deepEqual(provider.inventory,stock);
 const g=careFixture();acceptedCare(g);damage(g.w,g.beneficiary,null);queueOrdinaryCare(g);assert.equal(finishCareAction(g.w,g.provider).length,1);
});

test('unknown age retains strictly age-independent ordinary emergency care, but not refusal or recovered-capacity bypass',()=>{
 const f=infantCare(),{w,provider,beneficiary}=f;damage(w,beneficiary,null);beneficiary.health=15;
 assert.equal(careAuthority(w,provider,beneficiary).basis,'emergency');queueOrdinaryCare(f);assert.equal(finishCareAction(w,provider).length,1);
 beneficiary.health=15;beneficiary.refusesCare=true;assert.equal(careAuthority(w,provider,beneficiary).allowed,false);beneficiary.refusesCare=false;beneficiary.canDecide=beneficiary.canExpress=true;assert.equal(careAuthority(w,provider,beneficiary).allowed,false);
});

test('unknown birth never removes existing personal guardian-carry stop or custody objection',()=>{
 const {w,guardian,child,t}=pickUp();damage(w,child,null);child.canDecide=false;child.canExpress=true;const stock={...guardian.inventory},at={...child.at};
 const stop=queue(w,child,choose(w,child,a=>operation('health','cancelRescue')(a)));assert.equal(t.phase,'interrupted');assert.deepEqual(submitPlan(w,stop),{ok:true});assert.deepEqual(child.at,at);assert.deepEqual(guardian.inventory,stock);
 const f=infantCustody(),c=activateCustody(f);damage(f.w,f.child,null);f.child.canExpress=true;assert.equal(completeCustody(f.w,f.child,{type:'production',operation:'custodyObject',custodyId:c.id}),null);assert.equal(c.status,'objected');
});

test('historical child-help notices keep their original address and deadline after birth becomes unknown, without new care permission',()=>{
 const {w,reporter,child}=helpFixture();run(w,reporter,operation('emergencyCare','requestHelp'));const n=w.emergencyCare!.helpNotices![0],original=structuredClone(n);damage(w,child,null);run(w,reporter,operation('emergencyCare','postHelp'));
 assert.equal(n.childId,original.childId);assert.deepEqual(n.location,original.location);assert.equal(n.createdAt,original.createdAt);assert.equal(n.expiresAt,original.expiresAt);assert.deepEqual(n.evidence,original.evidence);assert.equal(w.emergencyCare!.agreements.length,0);assert.deepEqual(child.guardianIds,[]);
});

test('custody guardian birth corruption after proposal cannot newly sign an infant proxy mandate',()=>{
 const f=infantCustody(),{w,buyer,reviewer}=f,c=offerCustody(f);queue(w,buyer,choose(w,buyer,operation('production','custodyAccept')));stepWorld(w,.75);damage(w,buyer,null);finish(w,buyer,false);
 if(has(w,reviewer,operation('production','custodyReview')))run(w,reviewer,operation('production','custodyReview'));
 assert.equal(c.acceptedBy.includes(buyer.id),false);assert.notEqual(c.status,'active');
});
test('custody current guardian unknown age stops active materials and reimbursement, retaining their historical signature',()=>{
 const f=infantCustody(),{w,buyer,provider}=f,c=activateCustody(f),selected=choose(w,provider,operation('production','custodyRepair'));
 queue(w,provider,selected);stepWorld(w,59.75);damage(w,buyer,null);const stock={...provider.inventory},cash=c.spent,signatures=[...c.acceptedBy];stepWorld(w,.25);
 assert.equal(c.status,'invalid');assert.equal(c.spent,cash);assert.deepEqual(provider.inventory,stock);assert.deepEqual(c.acceptedBy,signatures);
});
