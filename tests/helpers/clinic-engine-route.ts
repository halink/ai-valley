/** Explicit synthetic clinic fixture; ordinary engine actions, no model or real save. */
import {createFormalWorld} from '../../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import {roomLayout} from '../../src/shared/rooms.js';
import {addHealthCase} from '../../src/world/health.js';
import type {Action,Resident,Snapshot} from '../../src/shared/types.js';

export function clinicEngineRoute(){
 const world=createFormalWorld(5402),doctor=world.residents.find(r=>r.id==='founder-14-2')!,patient=world.residents.find(r=>r.id==='founder-14-1')!;
 const home=world.buildings.find(b=>b.id===doctor.homeId)!;
 const snapshots:Snapshot[]=[],labels:string[]=[],plans:Array<{actorId:string;action:Action;start:number}>=[];
 const capture=(label:string)=>{labels.push(label);snapshots.push({world:structuredClone(world),mapRevision:world.id,serverTime:'synthetic-offline-clinic',version:'synthetic-engine-clinic-route',capabilities:{active:[],pending:[]}});};
 capture('original-seed');
 // Keep the existing commons clinic, original people and all room coordinates.
 // Only medicine and an explicitly synthetic injury are added; no treatment,
 // appointment, consent or patient identity is fabricated by the renderer.
 const building=world.buildings.find(b=>b.id==='commons-clinic-5')!;
 doctor.inventory.medicine=(doctor.inventory.medicine??0)+1;
 const healthCase=addHealthCase(world,patient,'injury',50,'Explicit synthetic clinic-route injury, not an observed formal-save event')!;
 world.clock.paused=false;capture('fixture');
 const submit=(label:string,actor:Resident,action:Action)=>{
  const result=submitPlan(world,{id:`clinic-route:${plans.length}`,actorId:actor.id,actorRevision:actor.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Explicit scripted synthetic clinic route, not autonomous model behavior',actions:[action]});
  if(!result.ok)throw new Error(label+': '+result.error);
  plans.push({actorId:actor.id,action:structuredClone(action),start:world.minute});
 };
 const tick=(label:string)=>{
  const before=[doctor.inside,patient.inside];stepWorld(world,.25);
  for(const [index,actor]of [doctor,patient].entries()){
   if(actor.lastFailure)throw new Error(label+': '+actor.lastFailure);
   if(actor.inside!==before[index])capture(label+':'+(actor===doctor?'doctor':'patient')+(actor.inside?':entered':':exited'));
  }
 };
 const atSlot=(actor:Resident,key:string)=>{const slot=roomLayout(world,building).slots.find(s=>s.key===key)!;return actor.inside===building.id&&!!actor.activity&&!actor.activity.path.length&&!actor.activity.room?.path.length&&actor.roomAt?.x===slot.at.x&&actor.roomAt?.y===slot.at.y;};
 const until=(label:string,done:()=>boolean)=>{let count=0;while(!done()){if(++count>2400)throw new Error('clinic_route_timeout:'+label);tick(label);}};
 const run=(label:string,actor:Resident,action:Action)=>{submit(label,actor,action);until(label,()=>!actor.plan&&!actor.activity);capture(label+':completed');};
 run('approach',doctor,{type:'move',to:{...building.door}});
 run('return-to-patient',doctor,{type:'move',to:{...home.door}});
 run('offer',doctor,{type:'health',operation:'offer',targetId:patient.id,buildingId:building.id,fee:10,startsIn:60});
 const appointment=world.health!.appointments.at(-1)!;
 run('accept',patient,{type:'health',operation:'accept',appointmentId:appointment.id});
 submit('doctor-treat',doctor,{type:'health',operation:'treat',appointmentId:appointment.id,minutes:120});
 until('doctor-treat',()=>atSlot(doctor,'care')&&world.minute>appointment.start+2);
 capture('doctor-solo');
 submit('patient-receive',patient,{type:'health',operation:'receive',appointmentId:appointment.id,minutes:120});
 until('patient-receive',()=>atSlot(patient,'bed:0'));
 capture('both-on-site');
 until('shared',()=>appointment.worked>0);capture('first-shared-work');
 until('shared',()=>appointment.worked>=appointment.minutes/2);capture('half-treatment');
 until('shared',()=>appointment.worked>=appointment.minutes-.25);capture('before-completion');
 until('shared',()=>appointment.status==='completed');capture('treatment:completed');
 run('doctor-exit',doctor,{type:'move',to:{...home.door}});
 run('patient-exit',patient,{type:'move',to:{...home.door}});
 return {snapshots,labels,plans,personId:doctor.id,doctorId:doctor.id,patientId:patient.id,buildingId:building.id,appointmentId:appointment.id,caseId:healthCase.id,
  fixtureDifferences:{medicine:{personId:doctor.id,added:1},injury:{personId:patient.id,caseId:healthCase.id,severity:50,source:healthCase.source},unpaused:true},
  provenance:'createFormalWorld(5402); uses existing commons-clinic-5 (building/clinic@1), explicitly adds exactly 1 medicine to that original care-skilled adult, one severity-50 injury for founder-14-1 through addHealthCase, and unpaused. All other initial identities, positions, water, money and skills retained. submitPlan/stepWorld alone produce discovery, offer, patient acceptance, escrow, actual travel, care and bed:0 coordinates, shared treatment, material consumption, payment and exit. Scripted synthetic fixture, not a real injury or autonomous/model acceptance; original seed has three clinics but no medicine or active health case.'};
}
