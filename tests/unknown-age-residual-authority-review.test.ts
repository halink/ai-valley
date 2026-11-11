import assert from 'node:assert/strict';
import {test} from 'node:test';
import {custodyFixture,activateCustody,helpFixture,evacuationFixture,choose,queue,run,operation,guardianRescue,damage,invalidDates,menu} from './helpers/unknown-age-residual.js';
import {careFixture,acceptedCare,queueOrdinaryCare,finishCareAction} from './helpers/care-meal-evidence.js';
import {advanceProtectedCustody,completeCustody} from '../src/world/protected-custody.js';
import {completeChildHelp} from '../src/world/child-help.js';
import {guardianEvacuationReason} from '../src/world/guardian-evacuation.js';
import {careAuthority,executeSocialAction} from '../src/world/social.js';
import {passenger,syncMedicalTransport} from '../src/world/medical-transport.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function custody(){const f=custodyFixture();f.child.bornAt=f.w.minute-2*YEAR;f.child.canDecide=f.child.canExpress=false;f.child.guardianIds=[f.buyer.id];return f;}
for(const [name,value] of invalidDates){
 test(`review: unknown ${name} cannot qualify guardian or independent reviewer as an adult`,()=>{
  const f=custody(),c=activateCustody(f);damage(f.w,f.reviewer,value);const before=structuredClone(c);assert.ok(completeCustody(f.w,f.provider,{type:'production',operation:'custodyRepair',custodyId:c.id,custodyStep:c.workSerial,buildingId:f.home.id}));assert.deepEqual(c,before);
  const e=evacuationFixture();damage(e.w,e.guardian,value);assert.ok(guardianEvacuationReason(e.w,e.guardian,e.child,e.d.id));assert.equal(menu(e.w,e.guardian).some(x=>guardianRescue(x.action)),false);
 });
}

test('review: invalidated custody cannot revive when a birth date becomes known again, including after SQLite reload',()=>{
 const f=custody(),c=activateCustody(f),birth=f.child.bornAt;damage(f.w,f.child,null);advanceProtectedCustody(f.w);assert.equal(c.status,'invalid');f.child.bornAt=birth;
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.loadForRuntime()!,saved=w.production!.protectedCustody!.mandates[0],before=structuredClone(saved),r=w.residents.find(r=>r.id===f.provider.id)!;advanceProtectedCustody(w);assert.deepEqual(saved,before);assert.ok(completeCustody(w,r,{type:'production',operation:'custodyRepair',custodyId:c.id,custodyStep:c.workSerial,buildingId:f.home.id}));assert.equal(saved.spent,0);}finally{store.close();}
});

test('review: sixth birthday at final care quarter closes toddler authority without spending',()=>{
 const f=careFixture(),{w,provider,beneficiary}=f;beneficiary.bornAt=w.minute+30-6*YEAR;beneficiary.canDecide=beneficiary.canExpress=false;beneficiary.guardianIds=[provider.id];queueOrdinaryCare(f);stepWorld(w,29.75);const before={...provider.inventory};assert.deepEqual(stepWorldWithFoodEvidence(w,.25).careMeals,[]);assert.deepEqual(provider.inventory,before);assert.ok(provider.lastFailure);
});

test('review: sixth birthday at final public-help quarter closes third-party exemption',()=>{
 const {w,reporter,child}=helpFixture();w.minute=601;child.bornAt=w.minute+3-6*YEAR;queue(w,reporter,choose(w,reporter,operation('emergencyCare','requestHelp')));stepWorld(w,2.75);assert.ok(reporter.activity);stepWorld(w,.25);assert.equal(w.emergencyCare?.helpNotices?.length??0,0);assert.ok(reporter.lastFailure);
});

test('review: corrupted reporter birth blocks a previously selected public notice without changing records',()=>{
 const {w,reporter}=helpFixture(),a=choose(w,reporter,operation('emergencyCare','requestHelp'));damage(w,reporter,null);assert.ok(completeChildHelp(w,reporter,a as never));assert.equal(w.emergencyCare?.helpNotices?.length??0,0);
});

test('review: unknown-age emergency does not resurrect explicitly declined ordinary care',()=>{
 const f=careFixture(),p=acceptedCare(f),{w,provider,beneficiary}=f;run(w,beneficiary,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept);damage(w,beneficiary,null);beneficiary.health=15;beneficiary.canDecide=beneficiary.canExpress=false;beneficiary.guardianIds=[provider.id];const before={...provider.inventory};assert.equal(careAuthority(w,provider,beneficiary).allowed,false);assert.equal(executeSocialAction(w,provider,{type:'care',targetId:beneficiary.id}).ok,false);assert.deepEqual(provider.inventory,before);
});

test('review: queued genuine care consent survives unknown-age SQLite reload and spends only once',()=>{
 const f=careFixture();acceptedCare(f);queueOrdinaryCare(f);stepWorld(f.w,29.75);damage(f.w,f.beneficiary,NaN);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.loadForRuntime()!,r=w.residents.find(r=>r.id===f.provider.id)!,p=w.residents.find(r=>r.id===f.beneficiary.id)!,before={...r.inventory};assert.equal(finishCareAction(w,r).length,1);assert.equal(r.inventory.meal,before.meal!-1);assert.equal(r.inventory.water,before.water!-1);assert.equal(p.bornAt,null);assert.deepEqual(finishCareAction(w,r),[]);}finally{store.close();}
});

test('review: guardian birth corruption interrupts bed-bound carry even when patient is critical; restoring birth cannot revive it',()=>{
 const {w,guardian,child}=evacuationFixture();queue(w,guardian,choose(w,guardian,a=>guardianRescue(a)&&a.evacuationDestination!=='safe-ground'));let left=100;while(!passenger(w,child.id)){assert.ok(left-->0);stepWorld(w,.25);}const t=passenger(w,child.id)!,birth=guardian.bornAt;damage(w,guardian,null);child.health=15;const at=structuredClone(child.at),stock={...guardian.inventory};syncMedicalTransport(w);assert.equal(t.phase,'interrupted');assert.deepEqual(child.at,at);assert.deepEqual(guardian.inventory,stock);guardian.bornAt=birth;syncMedicalTransport(w);assert.equal(t.phase,'interrupted');assert.equal(passenger(w,child.id),undefined);assert.equal(w.health!.transports.length,1);
});

import {createWorld} from '../src/world/seed.js';
import {initializeHealth} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeRooms} from '../src/world/rooms.js';
import type {Building,Tile} from '../src/shared/types.js';
function indoorReviewFixture(){
 const w=createWorld(71);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';w.resources=[];w.plots=[];w.graves=[];
 w.map={name:'室内幼儿按已知地址护送隔离验收',width:44,height:18,tiles:Array<Tile>(792).fill('grass'),entrance:{x:1,y:10},settlement:{x:10,y:10}};
 const seed=w.buildings.find(b=>b.kind==='lodge')!;
 const source:Building={...structuredClone(seed),id:'source-home',kind:'home',name:'受灾住处',at:{x:9,y:6},width:4,height:4,door:{x:10,y:10},capacity:3,condition:100,ownerId:'commons',residents:[]};
 const destination:Building={...structuredClone(seed),id:'known-hall',name:'已知共屋',at:{x:29,y:6},width:4,height:4,door:{x:30,y:10},capacity:1,condition:100,ownerId:'commons',residents:[]};
 w.buildings=[source,destination];w.residents=w.residents.slice(0,3);
 for(const r of w.residents){r.at={...source.door};r.inside=source.id;r.roomAt={x:4,y:9};r.homeId=source.id;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:3,medicine:2,meal:10};r.knownBuildings=[source.id,destination.id];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;}
 const [guardian,child,other]=w.residents;child.bornAt=w.minute-2*YEAR;child.guardianIds=[guardian.id];child.canDecide=child.canExpress=false;child.roomAt={x:3,y:9};other.at={x:1,y:16};other.inside=null;other.roomAt=null;other.homeId=null;source.residents=[guardian.id,child.id];
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d={id:'source-flood',kind:'flashFlood' as const,at:{...source.door},radius:2,phase:'active' as const,warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:[guardian.id],exposure:{},footprint:[{...source.door}]};w.frontierHazards!.disasters=[d];
 return {w,guardian,child,other,source,destination,d};
}
for(const kind of ['safe-ground','known-address'] as const)test(`review: unknown-age ${kind} carry stops after SQLite reload at actual position`,()=>{
 const f=kind==='safe-ground'?evacuationFixture():indoorReviewFixture(),{w,guardian,child}=f;
 queue(w,guardian,choose(w,guardian,a=>guardianRescue(a)&&a.evacuationDestination===kind));
 let left=160;while(!passenger(w,child.id)){assert.ok(left-->0);stepWorld(w,.25);}
 const t=passenger(w,child.id)!;assert.equal(t.evacuationDestination,kind);if(kind==='known-address')assert.equal(child.inside,'source-home');
 damage(w,child,NaN);const position=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt}),stock={...guardian.inventory},home=child.homeId,guardians=[...child.guardianIds];
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!,p=loaded.residents.find(r=>r.id===child.id)!,g=loaded.residents.find(r=>r.id===guardian.id)!,saved=loaded.health!.transports.find(x=>x.id===t.id)!;
  stepWorld(loaded,.25);assert.equal(saved.phase,'interrupted');assert.equal(saved.basis,'guardian');assert.equal(saved.evacuationDestination,kind);assert.deepEqual({at:p.at,inside:p.inside,roomAt:p.roomAt},position);assert.deepEqual(g.inventory,stock);assert.equal(p.homeId,home);assert.deepEqual(p.guardianIds,guardians);assert.equal(p.bornAt,null);assert.equal(loaded.health!.transports.length,1);assert.equal(passenger(loaded,p.id),undefined);
 }finally{store.close();}
});

test('review: guardian birth corruption terminates an active mandate before actual repair reimbursement',()=>{
 const f=custody(),c=activateCustody(f);damage(f.w,f.buyer,null);const stock={...f.provider.inventory},condition=f.home.condition;
 const repair=menu(f.w,f.provider).find(x=>operation('production','custodyRepair')(x.action));if(repair)run(f.w,f.provider,operation('production','custodyRepair'));
 advanceProtectedCustody(f.w);assert.equal(c.status,'invalid');assert.equal(c.spent,0);assert.deepEqual(f.provider.inventory,stock);assert.equal(f.home.condition,condition);
});
