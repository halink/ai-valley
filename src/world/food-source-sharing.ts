import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {FoodSourceSight,ShareFoodSourceAction} from '../shared/food-source-sharing.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import {canObserve} from './knowledge.js';
import {canSeeOutdoorPoint,validPoint} from './outdoor-observation.js';
import {canContactSocialTarget} from './social-observation.js';
import {knownAgeYears} from './time.js';
import {same,distance} from './navigation.js';
import {emitEvent} from './events.js';
import {hasReceipt} from './receipts.js';

const unavailable='此处未能当面传达原浆果地点，未交付线索；须本人重新决定';
const book=(r:Resident)=>r.foodSourceKnowledge??={seen:{},heard:[],shared:[]};
const carried=(w:World,r:Resident)=>!!travellingFamily(w,r.id)||!!familyPassenger(w,r.id)||!!w.ferries?.trips.some(t=>t.aboard.includes(r.id))||!!w.health?.transports.some(t=>t.phase==='carrying'&&(t.patientId===r.id||t.carrierId===r.id));
const eligible=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&(knownAgeYears(r.bornAt,w.minute)??-1)>=6&&r.health>0&&!carried(w,r)&&canObserve(w,r)&&!(r.activity?.action.type==='sleep'&&!r.activity.path.length&&!r.activity.room?.path.length);
const receipt=(id:string)=>'food-source-sharing:'+id;
export const foodSourceShareReceiptId=(r:Resident)=>`food-source:${r.id}:${r.revision}`;
const sightShape=(w:World,s:FoodSourceSight)=>!!s&&Object.keys(s).every(k=>['resourceId','at','observedAt'].includes(k))&&typeof s.resourceId==='string'&&s.resourceId.length>0&&!!s.at&&Object.keys(s.at).every(k=>['x','y'].includes(k))&&validPoint(w,s.at)&&Number.isFinite(s.observedAt)&&s.observedAt>=0&&s.observedAt<=w.minute;
const sameSight=(a:FoodSourceSight,b:FoodSourceSight)=>a.resourceId===b.resourceId&&a.observedAt===b.observedAt&&same(a.at,b.at);

/** Only physical observation creates shareable evidence. Bare legacy known IDs,
 * arbitrary conversation text and received clues never become personal sight. */
export function observeFoodSources(w:World,r:Resident){
 if(w.mode!=='formal'||r.inside!==null||!canObserve(w,r))return;
 for(const source of w.resources){
  if(source.kind!=='bush'||r.foodSourceKnowledge?.seen[source.id]||distance(r.at,source.at)>7||!canSeeOutdoorPoint(w,r,source.at,7))continue;
  book(r).seen[source.id]={resourceId:source.id,at:{...source.at},observedAt:w.minute};
 }
}

export function foodSourceShareReason(w:World,r:Resident,a:ShareFoodSourceAction):string|null {
 if(w.mode!=='formal'||!a||Object.keys(a).some(k=>!['type','targetId','source','receiptId'].includes(k))||typeof a.targetId!=='string'||typeof a.receiptId!=='string'||!sightShape(w,a.source)||!eligible(w,r))return unavailable;
 const sight=r.foodSourceKnowledge?.seen[a.source.resourceId];
 if(!sight||!sameSight(sight,a.source)||hasReceipt(w,receipt(a.receiptId))||r.foodSourceKnowledge?.shared.some(s=>s.targetId===a.targetId&&s.resourceId===a.source.resourceId))return unavailable;
 const listener=w.residents.find(p=>p.id===a.targetId);
 return !listener||!eligible(w,listener)||!canContactSocialTarget(w,r,listener)?unavailable:null;
}

export function foodSourceShareTarget(w:World,r:Resident,a:ShareFoodSourceAction){
 const error=foodSourceShareReason(w,r,a);return {target:{...r.at},duration:1,...(error?{error}:{})};
}
export function foodSourceShareWork(w:World,r:Resident,a:ShareFoodSourceAction,minutes:number):string|null {
 const error=foodSourceShareReason(w,r,a);if(error)return error;
 const activity=r.activity;if(!activity||activity.action!==a||activity.path.length||activity.room?.path.length||activity.room?.mode==='exit'||!same(r.at,activity.target))return unavailable;
 const prior=activity.foodSourceShareWork;
 if(prior&&Math.abs(prior.through-(w.minute-minutes))>1e-7)return unavailable;
 activity.foodSourceShareWork={from:prior?.from??w.minute-minutes,through:w.minute,minutes:(prior?.minutes??0)+minutes};
 return null;
}
export function completeFoodSourceShare(w:World,r:Resident,a:ShareFoodSourceAction):string|null {
 const error=foodSourceShareReason(w,r,a);if(error)return error;
 const activity=r.activity,work=activity?.foodSourceShareWork;
 if(!activity||activity.action!==a||activity.path.length||activity.room?.path.length||!same(r.at,activity.target)||!work||work.through!==w.minute||work.minutes<1-1e-7||Math.abs(work.through-work.from-work.minutes)>1e-7)return unavailable;
 const listener=w.residents.find(p=>p.id===a.targetId)!;
 const source=structuredClone(a.source);
 const event=emitEvent(w,{kind:'conversation',actors:[r.id,listener.id],place:{...r.at},witnesses:[r.id,listener.id],
  text:`${r.name}当面告诉${listener.name}：我在游戏分钟${source.observedAt}亲眼见过（${source.at.x},${source.at.y}）的浆果地点。现在是否还有浆果未知，须你自己前往核实。`,
  foodSourceShare:{speakerId:r.id,listenerId:listener.id,source},
 });
 // The event and personal record describe hearing, not seeing the patch.
 const memory=listener.memories.find(m=>m.eventId===event.id);if(memory)memory.source='heard';
 book(listener).heard.push({...source,speakerId:r.id,speakerName:r.name,receivedAt:w.minute,eventId:event.id});
 book(r).shared.push({receiptId:a.receiptId,targetId:listener.id,resourceId:source.resourceId,eventId:event.id});
 w.processed.push(receipt(a.receiptId));
 // Do not cancel an existing choice or force a visit. Only the next idle
 // decision may use the newly delivered historical address.
 if(!listener.plan&&!listener.activity)listener.decisionDue=Math.min(listener.decisionDue,w.minute);
 return null;
}

/** One fully specified person/address pair rotates through all eligible pairs.
 * No remote listener knowledge, stock, resource existence or regrowth is read. */
export function foodSourceShareOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!eligible(w,r))return [];
 const sights=Object.values(r.foodSourceKnowledge?.seen??{}).filter(s=>sightShape(w,s)).sort((a,b)=>a.resourceId.localeCompare(b.resourceId));
 const listeners=w.residents.filter(p=>eligible(w,p)&&canContactSocialTarget(w,r,p)).sort((a,b)=>a.id.localeCompare(b.id));
 const pairs=listeners.flatMap(p=>sights.filter(s=>!r.foodSourceKnowledge?.shared.some(old=>old.targetId===p.id&&old.resourceId===s.resourceId)).map(s=>({p,s})));
 if(!pairs.length)return [];
 const {p,s}=pairs[Math.floor(w.minute/30)%pairs.length];
 return [{id:`foodSource.share.${p.id}.${s.resourceId}`,label:`当面告诉${p.name}自己在游戏分钟${s.observedAt}亲眼见过的浆果地址（${s.at.x},${s.at.y}），用时1分钟；不保证现在有粮，对方另行决定是否核实`,action:{type:'shareFoodSource',targetId:p.id,source:structuredClone(s),receiptId:foodSourceShareReceiptId(r)}}];
}
