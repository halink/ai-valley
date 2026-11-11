/** Explicit synthetic school building fixture; real engine plans, never a real save/model. */
import {createFormalWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {actionRoom} from '../src/shared/rooms.js';
import type {Action,Building,Resident,Snapshot,Vec} from '../src/shared/types.js';

export function isometricSchoolRoute(){
 const world=createFormalWorld(5402),teacher=world.residents.find(r=>r.id==='founder-1-1')!,learner=world.residents.find(r=>r.id==='founder-1-2')!;
 const home=world.buildings.find(b=>b.id===teacher.homeId)!;
 const snapshots:Snapshot[]=[],labels:string[]=[],plans:Array<{actorId:string;action:Action;start:number}>=[];
 const capture=(label:string)=>{labels.push(label);snapshots.push({world:structuredClone(world),mapRevision:world.id,serverTime:'synthetic-offline-school',version:'synthetic-engine-school-route',capabilities:{active:[],pending:[]}});};
 capture('original-seed');
 // This seed has no school. Add only one explicitly synthetic building, on the
 // teacher's existing registered parcel, using the real versioned definition.
 // No room coordinates, people, skills, money, materials or lesson are seeded.
 const parcel=(world.definitions['land/start@1'].data.parcels as Array<Vec&{ownerId:string}>).find(p=>p.ownerId===teacher.id)!;
 const definition=world.activeDefinitions['building/school'],data=world.definitions[definition].data;
 const building:Building={id:'synthetic-school-1',name:'合成观察校舍',kind:'school',at:{x:parcel.x,y:parcel.y},width:Number(data.width),height:Number(data.height),capacity:Number(data.capacity),ownerId:teacher.id,residents:[],condition:100,definition,door:{x:parcel.x+Math.floor(Number(data.width)/2),y:parcel.y+Number(data.height)}};
 world.buildings.push(building);world.clock.paused=false;capture('fixture');
 const submit=(label:string,actor:Resident,action:Action)=>{
  const result=submitPlan(world,{id:`school-route:${plans.length}`,actorId:actor.id,actorRevision:actor.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Explicit scripted synthetic school route, not autonomous model behavior',actions:[action]});
  if(!result.ok)throw new Error(label+': '+result.error);
  plans.push({actorId:actor.id,action:structuredClone(action),start:world.minute});
 };
 const tick=(label:string)=>{
  const before=[teacher.inside,learner.inside];stepWorld(world,.25);
  for(const [index,actor]of [teacher,learner].entries()){
   if(actor.lastFailure)throw new Error(label+': '+actor.lastFailure);
   if(actor.inside!==before[index])capture(label+':'+(actor===teacher?'teacher':'learner')+(actor.inside?':entered':':exited'));
  }
 };
 const atTarget=(actor:Resident)=>{const activity=actor.activity,target=activity&&actionRoom(world,actor,activity)?.target;return actor.inside===building.id&&!!activity&&!activity.path.length&&!activity.room?.path.length&&!!target&&actor.roomAt?.x===target.x&&actor.roomAt?.y===target.y;};
 const until=(label:string,done:()=>boolean)=>{let count=0;while(!done()){if(++count>2400)throw new Error('school_route_timeout:'+label);tick(label);}};
 const run=(label:string,actor:Resident,action:Action)=>{submit(label,actor,action);until(label,()=>!actor.plan&&!actor.activity);capture(label+':completed');};
 run('teacher-approach',teacher,{type:'move',to:{...building.door}});
 run('post',teacher,{type:'education',operation:'post',buildingId:building.id,subject:'building',startsIn:60,windowMinutes:240,fee:12,capacity:1});
 const lesson=world.education!.lessons.at(-1)!;
 run('teacher-return',teacher,{type:'move',to:{...home.door}});
 run('learner-approach',learner,{type:'move',to:{...building.door}});
 run('enroll',learner,{type:'education',operation:'enroll',lessonId:lesson.id});
 const enrollment=lesson.enrollments[0];
 run('learner-return',learner,{type:'move',to:{...home.door}});
 until('wait-for-start',()=>world.minute>=lesson.start);
 submit('teacher-teach',teacher,{type:'education',operation:'teach',lessonId:lesson.id,minutes:120});
 until('teacher-teach',()=>atTarget(teacher));capture('teacher-on-site');
 for(let i=0;i<8;i++)tick('teacher-wait');capture('teacher-solo');
 submit('learner-study',learner,{type:'education',operation:'study',lessonId:lesson.id,minutes:120});
 until('learner-study',()=>atTarget(learner));capture('both-on-site');
 until('shared',()=>enrollment.worked>0);capture('first-shared-work');
 until('shared',()=>enrollment.worked>=lesson.minutes/2);capture('half-learning');
 until('shared',()=>enrollment.worked>=lesson.minutes-.25);capture('before-completion');
 until('shared',()=>enrollment.status==='completed');capture('learning:completed');
 until('finish-teaching-action',()=>!teacher.plan&&!teacher.activity);capture('teacher-action:completed');
 run('teacher-exit',teacher,{type:'move',to:{...home.door}});
 run('learner-exit',learner,{type:'move',to:{...home.door}});
 return {snapshots,labels,plans,personId:teacher.id,teacherId:teacher.id,learnerId:learner.id,buildingId:building.id,lessonId:lesson.id,enrollmentId:enrollment.id,
  fixtureDifferences:{addedBuilding:structuredClone(building),unpaused:true},
  provenance:'createFormalWorld(5402) has no school. Explicitly adds one synthetic building/school@1 on the original teacher-owned parcel, owned by that teacher, and unpauses. All original people, positions, inventory, skills, money and knowledge unchanged in setup. submitPlan/stepWorld alone produce discovery, post, independent enrollment/escrow, actual outdoor/indoor travel, role positions, shared learning, real material consumption, proportional tuition and exit. Scripted synthetic fixture, not original-seed construction, autonomous/model behavior or live learning acceptance.'};
}
