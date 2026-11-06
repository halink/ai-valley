import type {Resident,World,WorldEvent} from '../shared/types.js';
import {same} from './navigation.js';
import {roomLayout} from '../shared/rooms.js';

/** Physical presence alone is insufficient while asleep or unable to understand an observation. */
export function canObserve(w:World,r:Resident):boolean {
 if(r.status!=='alive'||r.residency==='outside'||!r.canDecide)return false;
 const a=r.activity;
 if(a?.action.type!=='sleep'||a.path.length||a.room?.path.length||!r.inside)return true;
 const b=w.buildings.find(b=>b.id===r.inside);
 return !b||!r.roomAt||!roomLayout(w,b).slots.some(s=>s.kind==='bed'&&same(s.at,r.roomAt!));
}

/** Register only a witnessed physical fact, never an internal status flag or a delivered rumour. */
export function rememberPhysicalFact(w:World,r:Resident,e:WorldEvent){
 if(!canObserve(w,r)||!e.witnesses.includes(r.id))return;
 const body=e.bodyLocation;
 if(e.kind==='death'&&e.actors[0]){
  r.deathKnowledge??={};const old=r.deathKnowledge[e.actors[0]];
  r.deathKnowledge[e.actors[0]]={eventId:e.id,source:'witness',confirmedAt:e.at,
   location:body?{at:{...body.at},roomId:body.roomId,roomAt:body.roomAt?{...body.roomAt}:null,atMinute:e.at,eventId:e.id}:old?.location??null};
 }
 if(body&&r.deathKnowledge?.[body.personId])r.deathKnowledge[body.personId].location={at:{...body.at},roomId:body.roomId,roomAt:body.roomAt?{...body.roomAt}:null,atMinute:e.at,eventId:e.id};
}

/** Legacy personal proofs can be retained, but old bare 'known IDs' do not manufacture evidence. */
export function deathProof(w:World,r:Resident,id:string,personal=false):WorldEvent|undefined {
 const saved=r.deathKnowledge?.[id];
 if(saved&&(!personal||saved.source==='witness'))return w.events.find(e=>e.id===saved.eventId);
 return [...r.memories].reverse().filter(m=>m.source!=='heard').map(m=>w.events.find(e=>e.id===m.eventId))
  .find(e=>e?.kind==='death'&&e.actors[0]===id&&e.witnesses.includes(r.id));
}

/** Migrate only still-present, historically witnessed evidence; never reconstruct from omniscient death state. */
export function retainDeathKnowledge(w:World){
 for(const r of w.residents)for(const m of r.memories){
  if(m.source==='heard')continue;const e=w.events.find(e=>e.id===m.eventId);
  if(e?.kind!=='death'||!e.witnesses.includes(r.id)||r.deathKnowledge?.[e.actors[0]]?.source==='witness')continue;
  r.deathKnowledge??={};const body=e.bodyLocation;
  r.deathKnowledge[e.actors[0]]={eventId:e.id,source:'witness',confirmedAt:e.at,location:{at:{...(body?.at??e.place)},roomId:body?.roomId??e.roomId??null,roomAt:body?.roomAt??e.roomAt,atMinute:e.at,eventId:e.id}};
 }
}
