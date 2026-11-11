import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action} from '../src/shared/types.js';
import type {AdultPresenceAction} from '../src/shared/adult-presence.js';
import {adultPresenceReason,completeAdultPresence} from '../src/world/adult-presence.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {createWorld} from '../src/world/seed.js';
import {roomLayout} from '../src/shared/rooms.js';
import {parseChoice} from '../src/server/affordances.js';
import {presenceFixture,evacuatePresence,verifyPresence,choosePresence,presenceMenu,submitPresence,reloadPresence} from './helpers/adult-presence.js';

const noStart=(f:ReturnType<typeof presenceFixture>)=>!presenceMenu(f.w,f.actor).some(c=>c.action.type==='adultPresence'&&c.action.operation!=='stop');
for(const change of ['event','audit','witness','narrowWitness','time','patient','phase'] as const)test(`presence independent: source ${change} cannot be substituted`,()=>{
 const f=presenceFixture(),t=evacuatePresence(f),a=choosePresence(f.w,f.actor,'verify') as AdultPresenceAction,e=f.w.events.find(e=>e.id===t.arrivalEventId)!;
 if(change==='event')t.arrivalEventId='invented';if(change==='audit')e.audit!.rule='unrelated';if(change==='witness')e.witnesses=[];if(change==='narrowWitness')e.audit!.scope=['actual-arrival'];if(change==='time')e.at--;if(change==='patient')t.patientId=f.remote.id;if(change==='phase')t.phase='interrupted';
 assert.ok(adultPresenceReason(f.w,f.actor,a));assert.ok(noStart(f));assert.equal(f.w.adultPresence!.records.length,0);
});

for(const change of ['recovery','refusal','separation','critical','risk','sleep','roomMissing'] as const)test(`presence independent: verification last tick rechecks ${change}`,()=>{
 const f=presenceFixture();evacuatePresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,1.75);
 if(change==='recovery')f.patient.canDecide=true;if(change==='refusal')f.patient.refusesCare=true;if(change==='separation')f.patient.at.x+=3;if(change==='critical')f.patient.health=19;if(change==='risk')f.w.frontierHazards!.disasters[0].footprint!.push({...f.patient.at});
 if(change==='sleep')f.patient.activity={action:{type:'sleep',minutes:5},path:[],remaining:5,startedAt:f.w.minute,planId:'review-sleep',target:{...f.patient.at},definition:f.w.activeDefinitions['action/routine']};
 if(change==='roomMissing')f.patient.roomAt={x:1,y:1};
 stepWorld(f.w,.25);assert.equal(f.w.adultPresence!.records.length,0);assert.ok(f.actor.lastFailure);
});

test('presence independent: genuine indoor legal contact is required and loss of rights ends active presence',()=>{
 const f=presenceFixture();evacuatePresence(f);const b=structuredClone(createWorld().buildings.find(b=>b.kind==='lodge')!);b.ownerId='commons';b.residents=[];b.door={...f.patient.at};f.w.buildings=[b];const entry=roomLayout(f.w,b).entry;
 for(const p of [f.actor,f.patient]){p.inside=b.id;p.roomAt={...entry};}
 assert.ok(!noStart(f));b.ownerId=f.remote.id;assert.ok(noStart(f));b.ownerId='commons';submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,2);
 const c=f.w.adultPresence!.records[0];assert.ok(c);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));stepWorld(f.w,1);assert.equal(c.minutes,1);b.ownerId=f.remote.id;stepWorld(f.w,.25);assert.equal(c.status,'ended');assert.equal(c.minutes,1);
});

test('presence independent: strict choice and direct action shapes reject authority injection',()=>{
 const f=presenceFixture();evacuatePresence(f);const menu=presenceMenu(f.w,f.actor),row=menu.find(c=>c.action.type==='adultPresence')!;
 for(const extra of [{providerId:f.remote.id},{authority:'guardian'},{minutes:999},{targetId:f.patient.id},{operation:'stay'}]){assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,...extra}),menu));assert.ok(adultPresenceReason(f.w,f.actor,{...row.action,...extra} as AdultPresenceAction));}
});

for(const value of [NaN,Infinity,-1])test(`presence independent: corrupted verification work ${value} fails closed`,()=>{
 const f=presenceFixture();evacuatePresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,1.75);f.actor.activity!.presenceWork!.minutes=value;
 stepWorld(f.w,.25);assert.equal(f.w.adultPresence!.records.length,0);assert.ok(f.actor.lastFailure);
});

test('presence independent: early completion replay cannot manufacture elapsed verification',()=>{
 const f=presenceFixture();evacuatePresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,.25);const a=f.actor.activity!.action as AdultPresenceAction;
 assert.ok(completeAdultPresence(f.w,f.actor,a));f.actor.activity!.remaining=0;stepWorld(f.w,.25);assert.equal(f.w.adultPresence!.records.length,0);
});

test('presence independent: persisted source receipt still bars renewal when visible record is trimmed',()=>{
 let f=presenceFixture();const c=verifyPresence(f),t=f.w.health!.transports[0],a:AdultPresenceAction={type:'adultPresence',operation:'verify',transportId:t.id,eventId:t.arrivalEventId!};f.w.adultPresence!.records=[];f=reloadPresence(f);assert.ok(adultPresenceReason(f.w,f.actor,a));assert.ok(noStart(f));assert.ok(c.expiresAt>f.w.minute);
});

test('presence independent: unrelated resident cannot stop and hidden remote invalidation does not change own stop menu',()=>{
 const f=presenceFixture(),c=verifyPresence(f);f.patient.canExpress=true;const stop:Action={type:'adultPresence',operation:'stop',recordId:c.id};assert.equal(submitPresence(f.w,f.remote,stop).ok,false);const menu=presenceMenu(f.w,f.patient);f.actor.at={x:1,y:1};f.actor.canDecide=false;stepWorld(f.w,.25);assert.deepEqual(presenceMenu(f.w,f.patient),menu);assert.equal(submitPresence(f.w,f.patient,stop).ok,true);assert.equal(c.stops.length,1);
});

for(const field of ['stops','providerLocation','personLocation'] as const)test(`presence independent: missing persisted ${field} fails closed without crashing decisions`,()=>{
 let f=presenceFixture();verifyPresence(f);delete (f.w.adultPresence!.records[0] as unknown as Record<string,unknown>)[field];f=reloadPresence(f);
 assert.doesNotThrow(()=>presenceMenu(f.w,f.actor));assert.ok(noStart(f));assert.doesNotThrow(()=>stepWorld(f.w,.25));
});

for(const field of ['scope','witnesses'] as const)test(`presence independent: missing arrival ${field} is rejected without crashing`,()=>{
 const f=presenceFixture(),t=evacuatePresence(f),e=f.w.events.find(e=>e.id===t.arrivalEventId)!;
 if(field==='scope')delete (e.audit as unknown as Record<string,unknown>).scope;else delete (e as unknown as Record<string,unknown>).witnesses;
 assert.doesNotThrow(()=>presenceMenu(f.w,f.actor));assert.ok(noStart(f));
});

for(const elapsed of [0,1.75])test(`presence independent: expression stops verification immediately before completion (${elapsed}) and survives reload`,()=>{
 let f=presenceFixture();const t=evacuatePresence(f),verify=choosePresence(f.w,f.actor,'verify');assert.equal(submitPresence(f.w,f.actor,verify).ok,true);if(elapsed)stepWorld(f.w,elapsed);f.patient.canExpress=true;
 const menu=presenceMenu(f.w,f.patient),row=menu.find(c=>c.action.type==='adultPresence'&&String(c.action.operation)==='stopVerification');assert.ok(row,'expression alone must expose the active verification stop');
 const stop=parseChoice(JSON.stringify({choice:row.id}),menu).actions[0];assert.equal(submitPresence(f.w,f.patient,stop).ok,true);assert.equal(f.actor.activity,null);assert.equal(f.actor.plan,null);assert.equal(f.w.adultPresence!.records.length,0);
 f=reloadPresence(f);stepWorld(f.w,.25);assert.equal(f.w.adultPresence!.records.length,0);assert.ok(noStart(f));assert.ok(adultPresenceReason(f.w,f.actor,{type:'adultPresence',operation:'verify',transportId:t.id,eventId:t.arrivalEventId!}));assert.equal(f.patient.canDecide,false);assert.equal(f.patient.refusesCare,false);
});

test('presence independent: verification stop rejects strangers, forged providers and mixed actions atomically',()=>{
 const f=presenceFixture(),t=evacuatePresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,1);f.patient.canExpress=true;
 const stop:AdultPresenceAction={type:'adultPresence',operation:'stopVerification',transportId:t.id,eventId:t.arrivalEventId!,providerId:f.actor.id};
 assert.equal(submitPresence(f.w,f.remote,stop).ok,false);assert.equal(submitPresence(f.w,f.patient,{...stop,providerId:f.remote.id}).ok,false);assert.ok(adultPresenceReason(f.w,f.patient,{...stop,minutes:1} as AdultPresenceAction));
 const before=structuredClone(f.w);const result=submitPlan(f.w,{id:'review-mixed-stop',actorId:f.patient.id,actorRevision:f.patient.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'invalid mixed stop',actions:[stop,{type:'wait',minutes:1}]});assert.equal(result.ok,false);assert.deepEqual(f.w,before);
});

test('presence independent: provider can withdraw verification after losing decision capacity and cannot renew after reload',()=>{
 let f=presenceFixture();const t=evacuatePresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,1);f.actor.canDecide=false;
 const menu=presenceMenu(f.w,f.actor),row=menu.find(c=>c.action.type==='adultPresence'&&c.action.operation==='stopVerification');assert.ok(row);assert.equal(submitPresence(f.w,f.actor,row.action).ok,true);assert.equal(f.actor.activity,null);assert.equal(f.w.adultPresence!.records.length,0);assert.equal(f.w.adultPresence!.refusals.length,0);
 f=reloadPresence(f);f.actor.canDecide=true;assert.ok(adultPresenceReason(f.w,f.actor,{type:'adultPresence',operation:'verify',transportId:t.id,eventId:t.arrivalEventId!}));
});

test('presence independent: extending mutable record times cannot extend immutable verification proof',()=>{
 const f=presenceFixture(),c=verifyPresence(f);f.w.minute+=1;c.verifiedAt++;c.expiresAt++;assert.ok(noStart(f));stepWorld(f.w,.25);assert.equal(c.status,'ended');assert.equal(c.minutes,0);
});

test('presence independent: restored decision capacity ends active presence even without expression',()=>{
 const f=presenceFixture(),c=verifyPresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));stepWorld(f.w,1);f.patient.canDecide=true;f.patient.canExpress=false;stepWorld(f.w,.25);assert.equal(c.status,'ended');assert.equal(c.minutes,1);assert.ok(noStart(f));
});

test('presence independent: shared ship coordinates never retain shore presence authority',()=>{
 const f=presenceFixture(),c=verifyPresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));stepWorld(f.w,1);
 f.w.ferries={boats:[],builds:[],trips:[{id:'review-presence-ship',boatId:'review-boat',operatorId:f.patient.id,sourceId:'none',destinationId:'none',headingId:'none',fare:0,departAt:0,expiresAt:99999999,capacity:3,phase:'docked',seats:[],aboard:[f.patient.id],pilotId:null,path:[],progress:0,returned:false,arrivedAt:0,reason:null}],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0}};
 assert.ok(noStart(f));assert.ok(adultPresenceReason(f.w,f.actor,{type:'adultPresence',operation:'stay',recordId:c.id},true));
});

test('presence independent: patient cannot discover a distant queued verification through stop controls',()=>{
 const f=presenceFixture();evacuatePresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));f.patient.canExpress=true;f.actor.at={x:1,y:1};assert.equal(presenceMenu(f.w,f.patient).some(c=>c.action.type==='adultPresence'&&c.action.operation==='stopVerification'),false);
});
