/** Explicit offline plans executed by the real engine; never autonomous model evidence. */
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {waterReceiptId} from '../src/world/water-supply.js';
import type {Action,Snapshot} from '../src/shared/types.js';
export function isometricObserverRoute(){
 const world=createFrontierWorld(5401),person=world.residents[0],personId=person.id,buildingId=person.homeId!;
 const snapshots:Snapshot[]=[],labels:string[]=[],plans:{action:Action;start:number;end:number}[]=[];
 const capture=(label:string)=>{labels.push(label);snapshots.push({world:structuredClone(world),mapRevision:world.id,serverTime:'synthetic-offline-route',version:'synthetic-engine-observer-route',capabilities:{active:[],pending:[]}});};
 capture('seed');world.clock.paused=false;
 const run=(label:string,action:Action)=>{
  const start=world.minute,result=submitPlan(world,{id:`observer-route:${plans.length}`,actorId:personId,actorRevision:person.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Scripted offline observation validation; not a model choice',actions:[action]});
  if(!result.ok)throw new Error(label+': '+result.error);
  let count=0,work=false;
  while(person.plan||person.activity){
   if(++count>180)throw new Error('observer_route_timeout');const room=person.inside,x=person.at.x,y=person.at.y;stepWorld(world,1);
   if(person.lastFailure)throw new Error(label+': '+person.lastFailure);
   if(Math.floor(x/16)!==Math.floor(person.at.x/16)||Math.floor(y/16)!==Math.floor(person.at.y/16))capture(label+':cross-block');
   if(room!==person.inside)capture(label+(person.inside?':entered':':exited'));
   if(!work&&person.activity&&!person.activity.path.length&&!person.activity.room?.path.length&&action.type!=='move'){capture(label+':on-site');work=true;}
  }
  plans.push({action:structuredClone(action),start,end:world.minute});capture(label+':completed');
 };
 run('west',{type:'move',to:{x:398,y:233}});run('spring',{type:'move',to:{x:419,y:233}});run('gather',{type:'gather',resourceId:'spring-419-233',quantity:1});
 run('home',{type:'waterSupply',operation:'craft',buildingId,receiptId:waterReceiptId(world,person)});run('exit',{type:'move',to:{x:417,y:231}});
 return {snapshots,labels,plans,personId,buildingId,provenance:'createFrontierWorld(5401), only directly unpaused; submitPlan/stepWorld produce all movement, inventory and room changes; scripted synthetic, not autonomous model behavior'};
}
