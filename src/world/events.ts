import {nearLocation} from './proximity.js';
import type {World,WorldEvent} from '../shared/types.js';
import {recordPopulationFact} from '../shared/demography.js';
import {distance} from './navigation.js';
import {canObserve,rememberPhysicalFact} from './knowledge.js';
/** Facts are public to observers; personal memories are restricted to real co-present witnesses. */
export function emitEvent(world:World,input:Omit<WorldEvent,'id'|'at'|'witnesses'>&{witnesses?:string[]}):WorldEvent {
 const source=world.residents.find(r=>r.id===input.actors[0]),anchored=!!source&&distance(source.at,input.place)===0;
 const bodyLocation=input.bodyLocation??(input.kind==='death'&&source?.status==='dead'&&anchored?{personId:source.id,at:{...source.at},roomId:source.inside,roomAt:source.roomAt?{...source.roomAt}:null}:undefined);
 const roomId=input.roomId!==undefined?input.roomId:bodyLocation?.roomId??(anchored?source!.inside:null),roomAt=input.roomAt!==undefined?input.roomAt:bodyLocation?.roomAt??(anchored?source!.roomAt??null:null),location={at:input.place,inside:roomId,roomAt};
 const witnesses=world.residents.filter(r=>canObserve(world,r)&&nearLocation(world,r,location,input.kind==='death'&&input.witnesses?.includes(r.id)?10:6)&&(input.witnesses===undefined||input.witnesses.includes(r.id))).map(r=>r.id);
 const event:WorldEvent={...input,...(bodyLocation?{bodyLocation}:{}),roomId,roomAt:roomAt?{...roomAt}:null,id:`${world.id}:event:${++world.revision}`,at:world.minute,place:{...input.place},witnesses};
 world.events.push(event);
 recordPopulationFact(world,event);
 for(const id of witnesses){const r=world.residents.find(p=>p.id===id)!;r.memories.push({eventId:event.id,receivedAt:world.minute,source:input.actors.includes(id)?'self':'witness',text:event.text});rememberPhysicalFact(world,r,event);if(r.memories.length>80)r.memories.splice(0,r.memories.length-80);for(const actorId of input.actors){if(actorId!==r.id&&!r.knownPeople.includes(actorId))r.knownPeople.push(actorId);}}
 return event;
}

/** Observer chronicle of completed accounting facts; this does not deliver knowledge to any resident. */
export function emitLedgerEvent(world:World,input:Omit<WorldEvent,'id'|'at'|'witnesses'>):WorldEvent {
 const event:WorldEvent={...input,id:`${world.id}:event:${++world.revision}`,at:world.minute,place:{...input.place},witnesses:[],observerOnly:true};world.events.push(event);recordPopulationFact(world,event);return event;
}
