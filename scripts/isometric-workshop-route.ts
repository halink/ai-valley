/** Entirely in-memory ordinary-engine route. Explicit plans, not autonomous decisions. */
import {createFormalWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import type {Action,Snapshot} from '../src/shared/types.js';
export function isometricWorkshopRoute(){
 const world=createFormalWorld(5402),person=world.residents.find(r=>r.id==='founder-18-2')!,personId=person.id;
 const workshop=world.buildings.find(b=>b.kind==='workshop')!,home=world.buildings.find(b=>b.id===person.homeId)!;
 const snapshots:Snapshot[]=[],labels:string[]=[],plans:Array<{action:Action;start:number;end:number}>=[];
 const capture=(label:string)=>{labels.push(label);snapshots.push({world:structuredClone(world),mapRevision:world.id,serverTime:'synthetic-offline-workshop',version:'synthetic-engine-workshop-route',capabilities:{active:[],pending:[]}});};
 capture('seed');world.clock.paused=false;
 const run=(label:string,action:Action)=>{
  const start=world.minute,result=submitPlan(world,{id:`workshop-route:${plans.length}`,actorId:personId,actorRevision:person.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Explicit scripted offline workshop observation; not a model choice',actions:[action]});
  if(!result.ok)throw new Error(label+': '+result.error);
  let count=0,onSite=false;
  while(person.plan||person.activity){
   if(++count>2000)throw new Error('workshop_route_timeout');
   const inside=person.inside;stepWorld(world,.25);
   if(person.lastFailure)throw new Error(label+': '+person.lastFailure);
   if(inside!==person.inside)capture(label+(person.inside?':entered':':exited'));
   const activity=person.activity;
   if(!onSite&&activity?.action.type==='industry'&&activity.action.operation==='craft'&&!activity.path.length&&!activity.room?.path.length&&person.inside===workshop.id){capture(label+':on-site');onSite=true;}
   else if(onSite&&activity?.action.type==='industry'&&activity.action.operation==='craft'&&activity.action.batchId&&activity.remaining<10&&!labels.includes(label+':working'))capture(label+':working');
  }
  plans.push({action:structuredClone(action),start,end:world.minute});capture(label+':completed');
 };
 run('approach',{type:'move',to:{...workshop.door}});
 run('table-craft',{type:'industry',operation:'craft',recipeId:'fiber',minutes:20,buildingId:workshop.id});
 run('install',{type:'industry',operation:'install',station:'bench',buildingId:workshop.id});
 run('return',{type:'move',to:{...home.door}});
 run('craft',{type:'industry',operation:'craft',recipeId:'plank',minutes:40,buildingId:workshop.id});
 run('exit',{type:'move',to:{...home.door}});
 return {snapshots,labels,plans,personId,buildingId:workshop.id,provenance:'createFormalWorld(5402), only directly unpaused; original founder-18-2, workshop, resources and inventory; submitPlan/stepWorld produce discovery, installation, all movement, batches and inventory; scripted synthetic, not autonomous model behavior'};
}
