import type {Building,PartnershipEnd,Relation,Resident,World} from '../shared/types.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {commonsStay} from '../shared/commons.js';
import {residentialStay} from '../shared/premises.js';
import {canObserve,deathProof} from './knowledge.js';
import {coLocated} from './proximity.js';
import {emitLedgerEvent} from './events.js';

/** Shared physical space is local and permitted; consent and wakefulness are checked by callers. */
export function socialRoomAccess(w:World,r:Resident,building:Building):boolean {
 return building.condition>0&&(building.ownerId==='commons'||building.ownerId===r.id||building.residents.includes(r.id)||!!commonsStay(w,r,building.id)||!!residentialStay(w,r.id,building.id));
}
export function socialSpace(w:World,a:Resident,b:Resident):boolean {
 if(!coLocated(w,a,b))return false;
 if(!a.inside)return true;
 const building=w.buildings.find(p=>p.id===a.inside);
 if(!building||building.condition<=0)return false;
 // The tenant's existing finite bed stay permits local interaction, not shared housing or work.
 if(!socialRoomAccess(w,a,building)||!socialRoomAccess(w,b,building))return false;
 const layout=roomLayout(w,building),from=a.roomAt??layout.entry,to=b.roomAt??layout.entry;
 if(layout.blocked.some(p=>p.x===from.x&&p.y===from.y||p.x===to.x&&p.y===to.y))return false;
 const path=roomPath(layout,from,to);
 return path!==null&&path.length<=2;
}

export function socialPresence(w:World,a:Resident,b:Resident):boolean {return socialSpace(w,a,b)&&canObserve(w,a)&&canObserve(w,b);}

function dates(w:World,a:Resident,tie:Relation){
 const changes=w.events.filter(e=>e.kind==='relationship'&&e.actors.includes(a.id)&&e.actors.includes(tie.targetId)&&['dating','marriage','separate'].includes(e.populationChange??''));
 let lastEnd=-1;for(let i=changes.length-1;i>=0;i--)if(changes[i].populationChange==='separate'){lastEnd=i;break;}
 const current=changes.slice(lastEnd+1);
 return {startedAt:tie.partnerSince??current.find(e=>e.populationChange==='dating')?.at??null,
  marriedAt:tie.marriedAt??current.find(e=>e.populationChange==='marriage')?.at??null};
}

/** Snapshot the spouse fallback before changing current relationship facts. Children keep first priority. */
export function spousesAtDeath(person:Resident):string[]{return person.relations.filter(r=>r.partner==='married').map(r=>r.targetId);}

export function closePartnershipsOnDeath(w:World,person:Resident):void {
 const estate=w.estates.find(e=>e.personId===person.id);
 if(estate)estate.spouseIds??=spousesAtDeath(person);
 const partners=w.residents.filter(p=>p.id!==person.id&&(person.relations.some(t=>t.targetId===p.id&&t.partner)||p.relations.some(t=>t.targetId===person.id&&t.partner)));
 for(const other of partners){
  const own=person.relations.find(t=>t.targetId===other.id),reciprocal=other.relations.find(t=>t.targetId===person.id),tie=own?.partner?own:reciprocal!;
  const uncertainOrder=other.status==='dead'&&(person.deathAt===null||other.deathAt===null);
  // Without death ordering, preserve existing estate evidence but do not invent a first survivor.
  if(uncertainOrder){const otherEstate=w.estates.find(e=>e.personId===other.id);if(otherEstate)otherEstate.spouseIds??=spousesAtDeath(other);}
  const end:PartnershipEnd={kind:tie.partner!,...dates(w,tie===own?person:other,tie),endedAt:uncertainOrder?null:person.deathAt,reason:'death',deceasedId:uncertainOrder?null:person.id};
  const event=emitLedgerEvent(w,{kind:'relationship',actors:[person.id,other.id],place:{...person.at},relationshipEnd:end,
   text:uncertainOrder?`${person.name}与${other.name}均已离世，原伴侣关系已结束；旧记录不足以确认死亡先后和关系结束日期。原有关系与遗产依据保留。`:`${person.name}离世，其与${other.name}的${end.kind==='married'?'婚姻':'交往'}关系随死亡结束。原有关系经历与死亡当时的遗产权利保留；此项档案核对不自动通知远处的人。`});
  for(const r of [own,reciprocal])if(r?.partner){(r.pastPartnerships??=[]).push({...end,eventId:event.id});delete r.partner;delete r.partnerSince;delete r.marriedAt;}
 }
}

/** Old saves retain unknown starting dates; migration never supplies personal knowledge. */
export function initializeRelationships(w:World):void {
 const attached=new Set(w.residents.flatMap(p=>p.relations.filter(r=>r.partner).flatMap(r=>[p.id,r.targetId])));
 const dead=w.residents.filter(p=>p.status==='dead'&&attached.has(p.id)).sort((a,b)=>(a.deathAt??Number.NEGATIVE_INFINITY)-(b.deathAt??Number.NEGATIVE_INFINITY)||a.id.localeCompare(b.id));
 for(const person of dead)closePartnershipsOnDeath(w,person);
 // Retain only delivery records with both a personal source and an actually conscious recipient.
 for(const n of w.funerary?.notices??[]){
  const recipient=w.residents.find(r=>r.id===n.recipientId);if(!recipient||recipient.partnerDeathNotices?.[n.personId])continue;
  const delivered=w.events.find(e=>e.id===n.eventId),proof=w.events.find(e=>e.id===n.sourceEventId);
  if(delivered?.witnesses.includes(recipient.id)&&proof?.kind==='death'&&proof.actors[0]===n.personId&&proof.witnesses.includes(n.reporterId))rememberPartnerDeathNotice(w,recipient,n.personId,n.eventId,n.sourceEventId,n.deliveredAt);
 }
}

export function knowsPartnerDeath(w:World,r:Resident,id:string):boolean {
 return !!deathProof(w,r,id)||!!r.partnerDeathNotices?.[id];
}

/** This is a delivered verified report, not legal proof or permission to inherit. */
export function rememberPartnerDeathNotice(w:World,r:Resident,id:string,eventId:string,sourceEventId:string,receivedAt=w.minute):void {
 if(!r.relations.some(t=>t.targetId===id&&(t.partner||t.pastPartnerships?.some(p=>p.reason==='death'))))return;
 (r.partnerDeathNotices??={})[id]={eventId,sourceEventId,receivedAt};
}

/** A survivor who has not learned the death still understands their earlier commitment as current. */
export function hasOtherPartner(w:World,r:Resident,otherId:string):boolean {
 return r.relations.some(t=>t.targetId!==otherId&&(!!t.partner||t.pastPartnerships?.some(p=>p.reason==='death'&&p.deceasedId===t.targetId&&!knowsPartnerDeath(w,r,t.targetId))));
}

export function relationshipNotes(w:World,r:Resident):string {
 return r.relations.flatMap(t=>{
  const ended=[...(t.pastPartnerships??[])].reverse().find(p=>p.reason==='death'&&p.deceasedId===t.targetId);
  if(!ended)return [];
  const name=w.residents.find(p=>p.id===t.targetId)?.name??'原伴侣';
  return [knowsPartnerDeath(w,r,t.targetId)?`本人已获知${name}离世，与其既往${ended.kind==='married'?'婚姻':'交往'}经历仍保留；是否追思或另行交往由本人决定。`:`本人仍记得与${name}的${ended.kind==='married'?'婚姻':'交往'}承诺，尚未收到改变这项认识的消息，可以继续按已知地点寻找。`];
 }).join(' ');
}
