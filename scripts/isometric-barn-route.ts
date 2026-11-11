/** Explicit synthetic barn/crate fixture; actual engine actions, never a real save/model. */
import {createFormalWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {Action,Building,Snapshot,Vec} from '../src/shared/types.js';

export function isometricBarnRoute(){
 const world=createFormalWorld(5402),person=world.residents.find(r=>r.id==='founder-1-1')!;
 const home=world.buildings.find(b=>b.id===person.homeId)!;
 const snapshots:Snapshot[]=[],labels:string[]=[],plans:Array<{actorId:string;action:Action;start:number}>=[];
 const capture=(label:string)=>{labels.push(label);snapshots.push({world:structuredClone(world),mapRevision:world.id,serverTime:'synthetic-offline-barn',version:'synthetic-engine-barn-route',capabilities:{active:[],pending:[]}});};
 capture('original-seed');
 const parcel=(world.definitions['land/start@1'].data.parcels as Array<Vec&{ownerId:string}>).find(p=>p.ownerId===person.id)!;
 const definition=world.activeDefinitions['building/barn'],data=world.definitions[definition].data;
 const building:Building={id:'synthetic-barn-1',name:'合成观察畜舍',kind:'barn',at:{x:parcel.x,y:parcel.y},width:Number(data.width),height:Number(data.height),capacity:Number(data.capacity),ownerId:person.id,residents:[],condition:100,definition,door:{x:parcel.x+Math.floor(Number(data.width)/2),y:parcel.y+Number(data.height)}};
 // Exactly one test crate and one fodder, before ordinary engine initialization.
 // Cargo identity, age and condition are initialized by the real engine, not us.
 world.buildings.push(building);person.inventory.chickCrate=1;person.inventory.fodder=1;world.clock.paused=false;capture('fixture');
 const submit=(label:string,action:Action)=>{
  const result=submitPlan(world,{id:`barn-route:${plans.length}`,actorId:person.id,actorRevision:person.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Explicit scripted synthetic barn route, not autonomous model behavior',actions:[action]});
  if(!result.ok)throw new Error(label+': '+result.error);
  plans.push({actorId:person.id,action:structuredClone(action),start:world.minute});
 };
 const tick=(label:string)=>{const before=person.inside;stepWorld(world,.25);if(person.lastFailure)throw new Error(label+': '+person.lastFailure);if(before!==person.inside)capture(label+(person.inside?':entered':':exited'));};
 const until=(label:string,done:()=>boolean)=>{let count=0;while(!done()){if(++count>2400)throw new Error('barn_route_timeout:'+label);tick(label);}};
 const run=(label:string,action:Action)=>{submit(label,action);until(label,()=>!person.plan&&!person.activity);capture(label+':completed');};
 run('approach',{type:'move',to:{...building.door}});
 const cargo=world.industry!.livestockCargo!.find(c=>c.container==='person:'+person.id&&c.kind==='chicken')!;
 if(!cargo)throw new Error('barn_route_missing_actual_crate');
 run('place',{type:'industry',operation:'placeAnimal',buildingId:building.id,animalId:cargo.id,kind:'chicken'});
 const animal=world.industry!.animals.find(a=>a.id===cargo.id)!;
 for(const [label,operation]of [['feed','feedAnimal'],['water','waterAnimal']] as const){
  submit(label,{type:'industry',operation,animalId:animal.id});
  if(label==='feed'){until(label,()=>!!person.activity?.room?.path.length);capture('feed:indoor-walking');}
  until(label,()=>!!person.activity&&!person.activity.path.length&&!person.activity.room?.path.length&&person.activity.remaining===.25);
  capture(label+':before-completion');tick(label);capture(label+':completed');
 }
 run('exit',{type:'move',to:{...home.door}});
 return {snapshots,labels,plans,personId:person.id,buildingId:building.id,animalId:animal.id,
  penKey:'pen:'+(animal.pen??0),penAt:roomLayout(world,building).slots.find(s=>s.key==='pen:'+(animal.pen??0))!.at,
  fixtureDifferences:{addedBuilding:structuredClone(building),inventory:{personId:person.id,chickCrate:1,fodder:1},unpaused:true},
  provenance:'createFormalWorld(5402) has no barn or initialized livestock. Adds one explicitly synthetic building/barn@1 on the original resident-owned parcel, exactly one test chickCrate and one fodder, and unpauses. Original people, positions, water, money and skills retained. Actual submitPlan/stepWorld initializes cargo identity and condition, discovers the barn, enters, releases that crate, feeds and waters the same animal with real material consumption, then exits. Normal housed livestock has barnId+pen, not an explicit roomAt: penAt is a layout-derived husbandry anchor, not a measured animal coordinate or indoor roaming. No products, second animal, pregnancy or outdoor position are fabricated. Scripted synthetic fixture, not original-seed construction, autonomous/model or browser acceptance.'};
}
