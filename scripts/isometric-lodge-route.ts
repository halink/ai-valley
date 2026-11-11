/** In-memory seed5401 route: explicit plans, never autonomous model evidence. */
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import type {Action,Snapshot} from '../src/shared/types.js';
export function isometricLodgeRoute(){
 const world=createFrontierWorld(5401),person=world.residents[0],personId=person.id;
 const lodge=world.buildings.find(b=>b.kind==='lodge')!;
 const snapshots:Snapshot[]=[],labels:string[]=[],plans:Array<{action:Action;start:number;end:number}>=[];
 const capture=(label:string)=>{labels.push(label);snapshots.push({world:structuredClone(world),mapRevision:world.id,serverTime:'synthetic-offline-lodge',version:'synthetic-engine-lodge-route',capabilities:{active:[],pending:[]}});};
 capture('seed');world.clock.paused=false;
 const run=(label:string,action:Action)=>{
  const start=world.minute,result=submitPlan(world,{id:`lodge-route:${plans.length}`,actorId:personId,actorRevision:person.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Explicit scripted offline cooking observation; not a model choice',actions:[action]});
  if(!result.ok)throw new Error(label+': '+result.error);
  let count=0,working=false;
  while(person.plan||person.activity){
   if(++count>800)throw new Error('lodge_route_timeout');
   const inside=person.inside;stepWorld(world,.25);
   if(person.lastFailure)throw new Error(label+': '+person.lastFailure);
   if(inside!==person.inside)capture(label+(person.inside?':entered':':exited'));
   if(!working&&person.activity?.action.type==='cook'&&!person.activity.path.length&&!person.activity.room?.path.length&&person.inside===lodge.id){capture(label+':on-site');working=true;}
   else if(working&&person.activity?.action.type==='cook'&&person.activity.remaining<10&&!labels.includes(label+':working'))capture(label+':working');
  }
  plans.push({action:structuredClone(action),start,end:world.minute});capture(label+':completed');
 };
 run('cook',{type:'cook',quantity:1,buildingId:lodge.id});
 run('exit',{type:'move',to:{...world.buildings.find(b=>b.id===person.homeId)!.door}});
 return {snapshots,labels,plans,personId,buildingId:lodge.id,provenance:'createFrontierWorld(5401), only directly unpaused; submitPlan/stepWorld produce all movement, inventory and room changes; scripted synthetic, not autonomous model behavior'};
}
