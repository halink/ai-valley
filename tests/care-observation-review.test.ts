import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth} from '../src/world/health.js';
import {initializeRooms} from '../src/world/rooms.js';
import {healthPanel,healthProfile} from '../src/client/health.js';
import {decisionContext,prompt,decisionChoices} from '../src/server/decisions.js';
import {observeBody} from '../src/world/body-observation.js';
import type {MedicalTransport} from '../src/shared/health.js';

function setup(){
 const w=createWorld();w.mode='formal';w.resources=[];w.plots=[];initializeHealth(w);initializeRooms(w);
 const [actor,patient]=w.residents;
 for(const r of w.residents){r.at={x:30,y:30};r.inside=null;r.roomAt=null;r.activity=null;r.plan=null;r.hunger=0;r.health=r.energy=100;r.canDecide=r.canExpress=true;}
 w.residents[2].at={x:60,y:40};patient.name='独立审查对象';
 return {w,actor,patient};
}
function delivered(f:ReturnType<typeof setup>,overrides:Partial<MedicalTransport>={}){
 const t:MedicalTransport={id:'review-arrival',carrierId:f.actor.id,patientId:f.patient.id,buildingId:null,bed:null,basis:'emergency',offerId:null,phase:'delivered',startedAt:f.w.minute-30,endedAt:f.w.minute-10,reason:null,evacuationDestination:'safe-ground',...overrides};
 f.w.health!.transports.push(t);return t;
}

test('independent review: observation and observer rendering have no side effects or executable controls',()=>{
 const f=setup();delivered(f);f.patient.canDecide=false;f.patient.canExpress=false;f.patient.hunger=96;
 const before=structuredClone(f.w);
 observeBody(f.w,f.actor,f.patient);
 const html=healthPanel(f.w)+healthProfile(f.w,f.patient);
 assert.doesNotMatch(html,/data-command|data-action|<input|<form/);
 assert.deepEqual(f.w,before,'read-only display must not claim beds, register care, change knowledge, or modify consent');
});

test('independent review: a delivered patient without a health case is visible to the observer without claiming a bed',()=>{
 const f=setup();delivered(f);f.patient.canDecide=false;f.patient.canExpress=false;
 const html=healthPanel(f.w);
 assert.doesNotMatch(html,/目前需要照护的人/);
 assert.match(html,/救援后|接续/);
 assert.match(html,/独立审查对象/);
 assert.doesNotMatch(html,/已送入实际床位/);
});

test('independent review: health display escapes patient names and transport reasons',()=>{
 const f=setup();f.patient.name='<script>review-name</script>';delivered(f,{reason:'<img src=x onerror=review()>'});f.patient.canDecide=false;
 const html=healthPanel(f.w)+healthProfile(f.w,f.patient);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img/);
});

const observed=(f:ReturnType<typeof setup>)=>decisionContext(f.w,f.actor).people.find(p=>p.id===f.patient.id)?.bodyObservation;

test('independent review: signs use two real tiles, not the old ten-tile people radius',()=>{
 const f=setup();f.patient.canDecide=false;f.patient.at={x:32,y:30};assert.ok(observed(f));
 f.patient.at={x:33,y:30};assert.equal(observed(f),undefined);
 f.patient.at={x:30,y:30};f.actor.canDecide=false;assert.equal(observed(f),undefined);
 f.actor.canDecide=true;f.patient.residency='outside';assert.equal(observed(f),undefined);
 f.patient.residency='resident';f.patient.status='dead';assert.equal(observed(f),undefined);
});

test('independent review: a shared doorway never substitutes for real room presence',()=>{
 const f=setup(),b=f.w.buildings[0];f.patient.canDecide=false;f.actor.inside=f.patient.inside=b.id;f.actor.at={...b.door};f.patient.at={...b.door};
 f.actor.roomAt={x:4,y:10};f.patient.roomAt={x:5,y:10};assert.ok(observed(f));
 for(const missing of [null,undefined,{x:NaN,y:10},{x:10000,y:10000}]){f.patient.roomAt=missing;assert.equal(observed(f),undefined);}
 f.patient.roomAt={x:5,y:10};f.actor.roomAt=null;assert.equal(observed(f),undefined);
 f.actor.roomAt={x:4,y:10};f.patient.at={x:b.door.x+1,y:b.door.y};assert.equal(observed(f),undefined);
 f.patient.at={...b.door};f.patient.inside=f.w.buildings[1].id;assert.equal(observed(f),undefined);
 f.patient.inside=null;assert.equal(observed(f),undefined);
});

test('independent review: projection contains no raw capacity, vital value, stock, diagnosis or plan',()=>{
 const f=setup();f.patient.canDecide=false;f.patient.canExpress=false;f.patient.hunger=93.17;f.patient.health=17.29;f.patient.energy=11.83;f.patient.inventory={medicine:9876};f.patient.intention='PRIVATE_INTENTION_SENTINEL';
 const view=observed(f);assert.ok(view);assert.deepEqual(Object.keys(view).sort(),['atMinute','signs']);
 const text=JSON.stringify(view);assert.doesNotMatch(text,/93\.17|17\.29|11\.83|9876|PRIVATE_INTENTION_SENTINEL|canDecide|canExpress|inventory|health|"hunger":/);
 const messages=JSON.stringify(prompt(decisionContext(f.w,f.actor),[]));assert.match(messages,/独立审查对象/);assert.doesNotMatch(messages,/93\.17|17\.29|11\.83|9876|PRIVATE_INTENTION_SENTINEL/);
});

test('independent review: observation metadata cannot grant new action choices',()=>{
 const f=setup();f.patient.canExpress=false;const context=decisionContext(f.w,f.actor),without=structuredClone(context);
 for(const p of without.people)delete p.bodyObservation;
 assert.deepEqual(decisionChoices(context),decisionChoices(without));
});

test('independent review: ship and shore sharing coordinates do not create bedside observations',()=>{
 const f=setup();f.patient.canDecide=false;
 f.w.ferries={boats:[],builds:[],trips:[{id:'review-ship',boatId:'review-boat',operatorId:f.patient.id,sourceId:'none',destinationId:'none',headingId:'none',fare:0,departAt:0,expiresAt:9999,capacity:3,phase:'docked',seats:[],aboard:[f.patient.id],pilotId:null,path:[],progress:0,returned:false,arrivedAt:0,reason:null}],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0}};
 assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
 f.w.ferries.trips[0].aboard=[f.actor.id];assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
 f.w.ferries.trips[0].aboard=[f.actor.id,f.patient.id];assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
});

test('independent review: sleep does not disclose hunger or infer incapacity, and sleeping observers cannot inspect',()=>{
 const f=setup();f.patient.canDecide=false;f.patient.canExpress=false;f.patient.hunger=99;f.patient.energy=1;f.patient.health=1;
 f.patient.activity={action:{type:'sleep',minutes:10},path:[],remaining:10,startedAt:f.w.minute,planId:'review-sleep',target:{...f.patient.at},definition:'action/routine@1'};
 assert.deepEqual(observeBody(f.w,f.actor,f.patient)?.signs,['sleeping']);
 f.actor.activity=structuredClone(f.patient.activity);assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
});

test('independent review: prompt excludes stale observations and the guardian branch shares the same narrow evidence',()=>{
 const f=setup();f.patient.bornAt=f.w.minute-100;f.patient.guardianIds=[f.actor.id];f.patient.hunger=91.37;f.patient.health=22.48;f.patient.canDecide=false;
 let context=decisionContext(f.w,f.actor);assert.match(context.formal!.familyNotes!,/近身所见/);assert.doesNotMatch(context.formal!.familyNotes!,/91|22|\/100/);
 // Isolate the new prompt path from independently generated family notes.
 context.formal!.familyNotes='';context.people.find(p=>p.id===f.patient.id)!.bodyObservation!.atMinute--;
 assert.doesNotMatch(JSON.stringify(prompt(context,[])),/你此刻近身所见/);
 f.patient.at={x:34,y:30};context=decisionContext(f.w,f.actor);
 assert.doesNotMatch(context.formal!.familyNotes!,/近身所见|明显饥饿|虚弱|91|22/);
 assert.doesNotMatch(JSON.stringify(prompt(context,[])),/你此刻近身所见/);
});

test('independent review: expression limitation is not described as lost decision capacity or consent',()=>{
 const f=setup();f.patient.canExpress=false;
 assert.deepEqual(observeBody(f.w,f.actor,f.patient)?.signs,['expression-support']);
 const text=JSON.stringify(prompt(decisionContext(f.w,f.actor),[]));
 assert.match(text,/表达受限/);assert.match(text,/不能据此认定没有决定能力或已经同意/);assert.doesNotMatch(text,/自主应对受限/);
});

test('independent review: old unknown-bed deliveries stay unknown and do not rewrite historical records',()=>{
 const f=setup();delivered(f,{buildingId:f.w.buildings[0].id,bed:null,evacuationDestination:'known-address'});f.patient.canDecide=false;
 const before=structuredClone(f.w);let html=healthPanel(f.w);
 assert.match(html,/接收床位未登记/);assert.doesNotMatch(html,/已送入实际床位/);assert.deepEqual(f.w,before);
 delete (f.w.health!.transports[0] as Partial<MedicalTransport>).bed;html=healthPanel(f.w);assert.match(html,/接收床位未登记/);assert.doesNotMatch(html,/已送入实际床位/);
 for(const bed of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){f.w.health!.transports[0].bed=bed;html=healthPanel(f.w)+healthProfile(f.w,f.patient);assert.match(html,/接收床位未登记/);assert.doesNotMatch(html,/已送入实际床位|NaN|Infinity/);}
 for(const endedAt of [undefined,NaN,Infinity]){const t=f.w.health!.transports[0];t.bed=null;if(endedAt===undefined)delete (t as Partial<MedicalTransport>).endedAt;else t.endedAt=endedAt;const before=structuredClone(f.w);html=healthPanel(f.w)+healthProfile(f.w,f.patient);assert.match(html,/接收床位未登记/);assert.doesNotMatch(html,/已送入实际床位|NaN|Infinity/);assert.deepEqual(f.w,before);}
});

test('independent review: recovery removes the continuation item, not the rescue record; death and departure are not current needs',()=>{
 const f=setup();delivered(f);f.patient.canDecide=false;assert.match(healthProfile(f.w,f.patient),/当前能力与待核实/);
 f.patient.canDecide=true;assert.doesNotMatch(healthProfile(f.w,f.patient),/当前能力与待核实/);assert.match(healthPanel(f.w),/已临时落脚在干地/);
 f.patient.canDecide=false;f.patient.status='dead';assert.doesNotMatch(healthProfile(f.w,f.patient),/当前能力与待核实/);
 f.patient.status='alive';f.patient.residency='outside';assert.doesNotMatch(healthProfile(f.w,f.patient),/当前能力与待核实/);
});

test('independent review: a two-tile line blocked by terrain is not close physical contact',()=>{
 const f=setup();f.actor.at={x:20,y:20};f.patient.at={x:22,y:20};f.patient.canDecide=false;
 assert.ok(observeBody(f.w,f.actor,f.patient));f.w.map.tiles[20*f.w.map.width+21]='cliff';
 assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
 f.w.map.tiles[20*f.w.map.width+21]='grass';f.patient.at={x:21.5,y:20};assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
 f.patient.at={x:22,y:20};f.patient.roomAt={x:1,y:1};assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
});
