/** Synthetic read-only CPU coverage. Not browser or live-world acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricResidentsFixture,residentAction} from '../scripts/isometric-residents-fixture.js';
import {prepareIsometricResidents,RESIDENT_MARK_LIMIT,type IsometricResidentRecord} from '../src/client/isometric-residents.js';
import {pickIsometricStudy,type IsometricStudy} from '../src/client/isometric-study.js';
import type {World} from '../src/shared/types.js';
const rendered=(records:IsometricResidentRecord[],id:string)=>{const r=records.find(r=>r.id===id);assert.equal(r?.kind,'render');return r as Extract<IsometricResidentRecord,{kind:'render'}>;};
const result=(w:World,id:string)=>prepareIsometricResidents(w).find(r=>r.id===id)!;
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('resident states retain exact IDs and render distinct evidence-driven poses without mutating a frozen snapshot',()=>{
 const f=isometricResidentsFixture(),before=structuredClone(f.world);freeze(f.world);const records=prepareIsometricResidents(f.world);
 for(const [r,pose] of [[f.idle,'idle'],[f.walk,'walk'],[f.worker,'work'],[f.baby,'infant'],[f.ill,'ill'],[f.rest,'shoreRest'],[f.culture,'celebrate'],[f.hunt,'hunt'],[f.body,'body'],[f.patient,'carried'],[f.carriedBody,'body']] as const){
  const out=rendered(records,r.id);assert.equal(out.pose,pose);assert.equal(out.id,r.id);
  for(const t of [0,260,520,780,1e12,NaN,-1])for(const mark of out.marks(t)){
   assert.ok(out.marks(t).length<=RESIDENT_MARK_LIMIT);assert.match(mark.color,/^#[a-f0-9]{6}$/i);
   assert.ok([mark.x,mark.y,mark.width,mark.height].every(Number.isInteger));assert.ok(mark.width>0&&mark.height>0);
  }
 }
 assert.deepEqual(f.world,before);
});

test('walking animates limbs, interpolates only the saved first step, and never extrapolates toward later tiles',()=>{
 const f=isometricResidentsFixture();f.walk.activity!.path.push({x:8,y:3});const r=rendered(prepareIsometricResidents(f.world),f.walk.id);
 assert.deepEqual(r.at,{x:6,y:3});assert.deepEqual(r.anchor,{x:6.5,y:3});assert.deepEqual(r.footprint,{x:6,y:3,width:2,height:1});
 assert.notDeepEqual(r.marks(0),r.marks(260));assert.deepEqual(r.anchor,{x:6.5,y:3});r.marks(1e12);assert.deepEqual(r.anchor,{x:6.5,y:3});
 f.walk.activity!.travelProgress=.75;assert.deepEqual(rendered(prepareIsometricResidents(f.world),f.walk.id).anchor,{x:6.75,y:3});
});

test('every pose freezes for a paused snapshot including path progress and carried payload',()=>{
 const f=isometricResidentsFixture();f.world.clock.paused=true;for(const r of prepareIsometricResidents(f.world))if(r.kind==='render'){
  assert.equal(r.animated,false);assert.deepEqual(r.marks(0),r.marks(100000));
 }
 assert.deepEqual(rendered(prepareIsometricResidents(f.world),f.patient.id).anchor,{x:14.25,y:8});
});

test('invalid travel points and progress fail explicitly, with no destination relocation',()=>{
 for(const progress of [-.1,1.1,NaN,Infinity]){const f=isometricResidentsFixture();f.walk.activity!.travelProgress=progress;const out=result(f.world,f.walk.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.deepEqual(out.at,f.walk.at);}
 for(const next of [{x:9,y:3},{x:7,y:4},{x:NaN,y:3},{x:26,y:3}]){const f=isometricResidentsFixture();f.walk.activity!.path=[next];assert.equal(result(f.world,f.walk.id).kind,'fallback');}
});

test('room journeys use room coordinates, preserve identity, and reject room/outdoor route confusion',()=>{
 const f=isometricResidentsFixture(),r=f.sleeper;residentAction(f.world,r,{type:'wait',minutes:15});r.roomAt={x:3,y:5};r.activity!.room={buildingId:f.home.id,mode:'work',target:{x:4,y:5},path:[{x:4,y:5}],progress:.5};
 const space={roomId:f.home.id,bounds:{x:0,y:0,width:f.layout.width,height:f.layout.height}},out=rendered(prepareIsometricResidents(f.world,space),r.id);
 assert.equal(out.pose,'walk');assert.deepEqual(out.at,r.roomAt);assert.deepEqual(out.anchor,{x:3.5,y:5});assert.equal(result(f.world,r.id).kind,'hidden');
 r.activity!.room!.buildingId='other';assert.equal(prepareIsometricResidents(f.world,space).find(p=>p.id===r.id)!.kind,'fallback');
 r.inside=null;assert.equal(result(f.world,r.id).kind,'fallback');assert.throws(()=>prepareIsometricResidents(f.world,{roomId:f.home.id}),/space/);
});

test('confirmed indoor sleep is drawn but an unverified outdoor sleep plan remains a labeled fallback',()=>{
 const f=isometricResidentsFixture();const out=result(f.world,f.sleepPlan.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.match(out.reason,/睡眠位置待核验/);
 const indoor=rendered(prepareIsometricResidents(f.world,{roomId:f.home.id,bounds:{x:0,y:0,width:f.layout.width,height:f.layout.height}}),f.sleeper.id);
 assert.equal(indoor.pose,'sleep');assert.deepEqual(indoor.at,f.sleeper.roomAt);
});

test('only actual non-future burial hides the deceased; reservation and pending burial do not',()=>{
 for(const [buriedAt,kind] of [[null,'render'],[721,'render'],[NaN,'render'],[-1,'render'],[720,'hidden'],[0,'hidden']] as const){
  const f=isometricResidentsFixture();f.world.graves.push({id:'g',personId:f.body.id,at:{x:9,y:9},buriedAt,reservedBy:f.carrier.id});assert.equal(result(f.world,f.body.id).kind,kind);
 }
 const f=isometricResidentsFixture();f.body.activity=f.walk.activity;const dead=rendered(prepareIsometricResidents(f.world),f.body.id);assert.deepEqual(dead.at,f.body.at);assert.deepEqual(dead.anchor,f.body.at);assert.equal(dead.pose,'body');assert.equal(dead.animated,false);
});

test('medical and body payloads use verified carrier location and saved progress, never stale patient positions',()=>{
 const f=isometricResidentsFixture();f.patient.at={x:1,y:1};f.carriedBody.at={x:0,y:0};const records=prepareIsometricResidents(f.world);
 const patient=rendered(records,f.patient.id),body=rendered(records,f.carriedBody.id);
 assert.deepEqual(patient.at,f.carrier.at);assert.deepEqual(patient.anchor,{x:14.25,y:8});assert.deepEqual(body.at,f.bodyCarrier.at);assert.deepEqual(body.anchor,{x:18.75,y:8});assert.match(patient.description,new RegExp(f.carrier.id));
 f.carrier.activity=null;const unresolved=result(f.world,f.patient.id);assert.equal(unresolved.kind,'fallback');if(unresolved.kind==='fallback')assert.equal(unresolved.at,null);
});

test('payloads follow the carrier across room and regional boundaries, without duplication',()=>{
 const f=isometricResidentsFixture();f.carrier.inside=f.home.id;f.carrier.roomAt={x:4,y:5};f.carrier.activity!.path=[];f.carrier.activity!.room={buildingId:f.home.id,mode:'work',target:{x:5,y:5},path:[{x:5,y:5}],progress:.5};
 assert.equal(result(f.world,f.patient.id).kind,'hidden');const indoor=rendered(prepareIsometricResidents(f.world,{roomId:f.home.id,bounds:{x:0,y:0,width:f.layout.width,height:f.layout.height}}),f.patient.id);assert.deepEqual(indoor.anchor,{x:4.5,y:5});
 f.carrier.residency='outside';assert.equal(result(f.world,f.patient.id).kind,'hidden');
});

test('missing carriers, contradictory transport claims and inconsistent body storage never use stale positions',()=>{
 const f=isometricResidentsFixture();f.world.residents=f.world.residents.filter(r=>r.id!==f.carrier.id);let out=result(f.world,f.patient.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.equal(out.at,null);
 f.body.body={reservedBy:null,carriedBy:null,storedAt:'missing-room'};out=result(f.world,f.body.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.equal(out.at,null);
 f.world.health!.transports.push({...f.world.health!.transports[0],id:'duplicate'});out=result(f.world,f.patient.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.match(out.reason,/冲突/);
});

test('ferry passengers and shared family journeys cannot masquerade as ordinary walking',()=>{
 const f=isometricResidentsFixture();f.world.ferries!.trips.push({id:'trip',aboard:[f.walk.id],phase:'sailing'} as NonNullable<World['ferries']>['trips'][number]);let out=result(f.world,f.walk.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.match(out.reason,/渡船/);
 f.world.ferries!.trips=[];f.world.familyRelocation!.agreements.push({id:'family',status:'travelling',members:[{personId:f.walk.id,arrivedAt:null}]} as NonNullable<World['familyRelocation']>['agreements'][number]);out=result(f.world,f.walk.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.match(out.reason,/共同旅程/);
});

test('work/celebration/hunting phases imply no yield, and stale weapon or cancelled event records cannot invent actions',()=>{
 const f=isometricResidentsFixture();for(const r of [f.worker,f.culture,f.hunt]){const out=rendered(prepareIsometricResidents(f.world),r.id);assert.notDeepEqual(out.marks(0),out.marks(260));}
 f.world.industry!.tools.find(t=>t.id==='synthetic-spear')!.durability=0;assert.equal(result(f.world,f.hunt.id).kind,'fallback');
 f.world.culture!.events[0].status='cancelled';assert.equal(rendered(prepareIsometricResidents(f.world),f.culture.id).pose,'idle');
 f.worker.activity!.path=[{x:11,y:3}];assert.equal(rendered(prepareIsometricResidents(f.world),f.worker.id).pose,'walk');
});

test('visible pixels pick the exact original person, not a generic pose identity',()=>{
 const f=isometricResidentsFixture();for(const r of prepareIsometricResidents(f.world))if(r.kind==='render'){
  const scene:IsometricStudy={width:900,height:700,bounds:{x:0,y:0,width:26,height:20},camera:{origin:{x:400,y:100},zoom:1},terrain:[],objects:[{key:'resident:'+r.id,subject:{kind:'resident',id:r.id,at:r.at},footprint:r.footprint,marks:r.marks(260)}]};
  const p=scene.objects[0].marks[0],hit=pickIsometricStudy(scene,{x:p.x+400+.5,y:p.y+100+.5});assert.equal(hit?.kind,'resident');assert.equal(hit&&'id' in hit?hit.id:null,r.id);
 }
});

test('missing room positions and nonlocal residents never receive a guessed tile',()=>{
 const f=isometricResidentsFixture();f.sleeper.roomAt=null;const out=prepareIsometricResidents(f.world,{roomId:f.home.id,bounds:{x:0,y:0,width:f.layout.width,height:f.layout.height}}).find(p=>p.id===f.sleeper.id)!;assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.equal(out.at,null);
 f.idle.residency='outside';assert.equal(result(f.world,f.idle.id).kind,'hidden');f.world.residents.push(f.idle);assert.throws(()=>prepareIsometricResidents(f.world),/duplicate/);
});

test('verified child escort follows the guardian while conflicting or circular payload claims fail closed',()=>{
 const f=isometricResidentsFixture();f.world.health!.transports=[];f.patient.lifeStage='infant';residentAction(f.world,f.carrier,{type:'familyRelocation',operation:'escort',phase:'delivery',relocationId:'family-escort',personId:f.patient.id});f.carrier.activity!.path=[{x:15,y:8}];f.carrier.activity!.travelProgress=.5;
 f.world.familyRelocation!.agreements.push({id:'family-escort',status:'accepted',members:[{personId:f.patient.id,caregiverId:f.carrier.id,escorting:true}]} as NonNullable<World['familyRelocation']>['agreements'][number]);
 const child=rendered(prepareIsometricResidents(f.world),f.patient.id);assert.equal(child.pose,'carried');assert.deepEqual(child.anchor,{x:14.5,y:8});
 f.body.body={reservedBy:f.carrier.id,carriedBy:f.carrier.id,storedAt:null};let out=result(f.world,f.patient.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.match(out.reason,/冲突携运/);
 f.body.body=undefined;f.world.familyRelocation!.agreements[0].members.push({personId:f.carrier.id,caregiverId:f.patient.id,escorting:true} as NonNullable<World['familyRelocation']>['agreements'][number]['members'][number]);out=result(f.world,f.patient.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.equal(out.at,null);
});

test('directional walking and age appearance differ while animation closures never rescan the source world',()=>{
 const f=isometricResidentsFixture(),frames=[];for(const next of [{x:7,y:3},{x:5,y:3},{x:6,y:2},{x:6,y:4}]){f.walk.activity!.path=[next];frames.push(rendered(prepareIsometricResidents(f.world),f.walk.id).marks(260));}
 assert.notDeepEqual(frames[0],frames[1]);const records=prepareIsometricResidents(f.world);const copy=structuredClone(f.world);Object.defineProperty(f.world,'residents',{get(){throw new Error('unexpected rescan');}});
 for(const r of records)if(r.kind==='render')r.marks(260);assert.equal(copy.id,'synthetic-resident-states');
});

test('review regressions: missing ordinary/room path or health arrays fail per-resident without throwing',()=>{
 for(const mode of ['path','room','health'] as const){const f=isometricResidentsFixture();
  if(mode==='path')delete (f.walk.activity as Partial<NonNullable<typeof f.walk.activity>>).path;
  if(mode==='room')f.walk.activity!.room={buildingId:'other',path:null} as unknown as NonNullable<typeof f.walk.activity>['room'];
  if(mode==='health')delete (f.world.health as Partial<NonNullable<World['health']>>).transports;
  assert.doesNotThrow(()=>prepareIsometricResidents(f.world));assert.equal(result(f.world,f.walk.id).kind,'fallback');
 }
});

test('review regressions: incapacitated/infant carriers and critical residual paths cannot imply actual walking or carrying',()=>{
 for(const patch of [{canDecide:false},{canExpress:false},{health:0},{lifeStage:'infant' as const}]){const f=isometricResidentsFixture();Object.assign(f.carrier,patch);const out=result(f.world,f.patient.id);assert.equal(out.kind,'fallback');if(out.kind==='fallback')assert.equal(out.at,null);}
 const f=isometricResidentsFixture();f.walk.canDecide=false;f.world.health!.cases.push({...f.world.health!.cases[0],id:'critical-walker',personId:f.walk.id,severity:95});assert.equal(result(f.world,f.walk.id).kind,'fallback');
});

test('review regression: an infant at a confirmed bed sleeps lying down rather than sitting',()=>{
 const f=isometricResidentsFixture();f.sleeper.lifeStage='infant';const r=rendered(prepareIsometricResidents(f.world,{roomId:f.home.id,bounds:{x:0,y:0,width:f.layout.width,height:f.layout.height}}),f.sleeper.id);assert.equal(r.pose,'sleep');
});

test('review regression: corrupt relationship ledgers fail explicitly without treating them as empty',()=>{
 const patches:Array<(w:World)=>void>=[
  w=>{delete (w.ferries as Partial<NonNullable<World['ferries']>>).trips;},
  w=>{w.ferries!.trips.push({id:'x',phase:'held'} as NonNullable<World['ferries']>['trips'][number]);},
  w=>{w.familyRelocation!.agreements.push({id:'x',status:'cancelled'} as NonNullable<World['familyRelocation']>['agreements'][number]);},
  w=>{w.health!.transports={} as NonNullable<World['health']>['transports'];},
 ];
 for(const patch of patches){const f=isometricResidentsFixture();patch(f.world);assert.doesNotThrow(()=>prepareIsometricResidents(f.world));for(const r of prepareIsometricResidents(f.world)){assert.equal(r.kind,'fallback');if(r.kind==='fallback'){assert.equal(r.at,null);assert.match(r.reason,/关系账本不完整/);}}}
 const f=isometricResidentsFixture();delete (f.world.industry as Partial<NonNullable<World['industry']>>).tools;assert.doesNotThrow(()=>prepareIsometricResidents(f.world));assert.equal(result(f.world,f.hunt.id).kind,'fallback');
 f.world.residents.push(f.idle);delete (f.world.health as Partial<NonNullable<World['health']>>).transports;assert.throws(()=>prepareIsometricResidents(f.world),/duplicate/);
});

test('engine regression: real sleep route keeps the actual doorway transition visible without claiming sleep',async()=>{
 const {isometricObserverRoute}=await import('../scripts/isometric-observer-route.js');
 const {stepWorld,submitPlan}=await import('../src/world/engine.js');const {roomLayout}=await import('../src/shared/rooms.js');const {personVisual}=await import('../src/client/person-pose.js');
 const route=isometricObserverRoute(),w=structuredClone(route.snapshots.at(-1)!.world),r=w.residents.find(r=>r.id===route.personId)!;w.clock.paused=false;
 assert.equal(submitPlan(w,{id:'resident-engine-sleep',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Scripted synthetic sleep-state regression',actions:[{type:'sleep',minutes:5}]}).ok,true);
 let steps=0,doors=0,sleeps=0;while(r.plan||r.activity){assert.ok(++steps<180);stepWorld(w,1);assert.equal(r.lastFailure,null);
  const building=r.inside?w.buildings.find(b=>b.id===r.inside)!:null,layout=building?roomLayout(w,building):null;
  const records=prepareIsometricResidents(w,layout?{roomId:building!.id,bounds:{x:0,y:0,width:layout.width,height:layout.height}}:{}),out=rendered(records,r.id),visual=personVisual(w,r);
  if(out.description.includes('住宿门口')){doors++;assert.equal(out.pose,'idle');assert.equal(out.animated,false);assert.equal(r.inside,null);assert.deepEqual(out.at,w.buildings.find(b=>b.id===r.homeId)!.door);assert.notEqual(visual.pose,'sleep');}
  if(out.pose==='sleep'){sleeps++;assert.equal(visual.pose,'sleep');assert.equal(r.inside,route.buildingId);assert.deepEqual(out.at,r.roomAt);}
 }
 assert.ok(doors>0);assert.ok(sleeps>0);
});

test('hidden reasons distinguish true burial/nonlocal travel from another local scene without parsing labels',()=>{
 const f=isometricResidentsFixture();
 const hidden=(id:string,reason:'buried'|'outside'|'other-space')=>{const r=result(f.world,id);assert.equal(r.kind,'hidden');if(r.kind==='hidden')assert.equal(r.hiddenReason,reason);};
 hidden(f.sleeper.id,'other-space');f.idle.residency='outside';hidden(f.idle.id,'outside');
 f.world.graves.push({id:'burial',personId:f.body.id,at:{x:9,y:9},buriedAt:f.world.minute});hidden(f.body.id,'buried');
 f.carrier.inside=f.home.id;f.carrier.roomAt={x:4,y:5};hidden(f.patient.id,'other-space');
 // The patient's old room cannot override the effective carrier's nonlocal location.
 f.patient.inside=f.home.id;f.patient.roomAt={x:5,y:5};f.carrier.residency='outside';hidden(f.patient.id,'outside');
});
