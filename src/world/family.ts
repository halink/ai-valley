import {deathProof} from './knowledge.js';
import {coLocated} from './proximity.js';
import {foodTransaction} from './food.js';
import type {Action, FormalOpportunity, Resident, Vec, World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {distance} from './navigation.js';
import {ageYears, DAY} from './time.js';

type FamilyAction = Extract<Action,{type:'tendChild'|'fosterChild'|'familyConsent'|'inviteHome'|'homeReply'}>;
type Result = {ok:boolean;error?:string};
const fail = (error:string):Result => ({ok:false,error});
const here = (r:Resident) => r.status==='alive' && r.residency!=='outside';
const capable = (r:Resident) => here(r) && r.canDecide && r.canExpress;
const together = (w:World,a:Resident,b:Resident,range=2) => here(a)&&here(b)&&coLocated(w,a,b,range);
const years = (w:World,r:Resident) => ageYears(r.bornAt,w.minute);

export function ageAllowsChoice(age:number, action:Action):boolean {
 if(age>=18)return true;
 if(age<6)return false;
 switch(action.type){
  case 'frontierHazard': return action.operation!=='repair';
  case 'industry': return action.operation==='shoreRest'||age>=13&&action.operation==='fish';
  case 'culture': return ['rsvp','withdraw','attend','speak','take','invite'].includes(action.operation);
  case 'social': case 'promise': return true;
  case 'ferry': return ['reserve','board','disembark'].includes(action.operation);
  case 'household': return ['acceptGift','declineGift'].includes(action.operation);
  case 'adoption': return ['consent','withdraw'].includes(action.operation);
  case 'agency': return true;
  case 'talk': case 'move': case 'wait': case 'eat': case 'sleep': case 'learn': case 'familyConsent': return true;
  case 'respond': return true; // Relationship and other adult agreements are checked at acceptance.
  case 'gather': return true; // Personal berry picking and fetching water are filtered by resource at execution.
  case 'cook': return age>=13;
  case 'publicDuty': return action.operation==='receive';
  case 'funerary': return ['visit','verify','notify','readDeathRecord'].includes(action.operation);
  case 'longCare': return ['assent','decline','cancel','observe','notify'].includes(action.operation);
  case 'health': return ['accept','decline','cancel','receive','selfTreat','acceptRescue','declineRescue','cancelRescue'].includes(action.operation);
  case 'education': return ['enroll','study','withdraw'].includes(action.operation);
  default: return false;
 }
}
export function ageAllowsAction(w:World,r:Resident,action:Action):boolean {
 const age=years(w,r);
 if(age>=18)return true;
 if(!ageAllowsChoice(age,action))return false;
 if(action.type==='gather'){
  const resource=w.resources.find(s=>s.id===action.resourceId);
  return (resource?.kind==='bush'||resource?.kind==='spring') && action.quantity<=3;
 }
 if(action.type==='respond'){
  return w.proposals.some(p=>p.id===action.proposalId&&p.kind==='care'&&p.targetId===r.id);
 }
 return true;
}

function nearbyGuardians(w:World,child:Resident):Resident[] {
 return w.residents.filter(r=>child.guardianIds.includes(r.id)&&capable(r)&&years(w,r)>=18);
}
function witnessedLoss(w:World,actor:Resident,child:Resident):boolean {
 if(child.guardianIds.length===0) return false;
 const witnessed = new Set(actor.memories.filter(m=>m.source!=='heard').map(m=>m.eventId));
 return child.guardianIds.every(id=>!!deathProof(w,actor,id)||w.events.some(e=>witnessed.has(e.id)&&e.kind==='departure'&&e.actors[0]===id));
}
const hasFood=(actor:Resident)=> (actor.inventory.meal??0)>0 || (actor.inventory.turnip??0)>0;
function birthHome(w:World,actor:Resident,child:Resident) {
 if(!child.guardianIds.includes(actor.id) || !child.homeId || !actor.knownBuildings.includes(child.homeId))return undefined;
 return w.buildings.find(b=>b.id===child.homeId && b.residents.includes(child.id) &&
  (b.ownerId==='commons'||b.ownerId===actor.id||b.residents.includes(actor.id)));
}

function rememberedChildObservation(w:World,actor:Resident,child:Resident):import('../shared/types.js').PersonObservation|undefined {
 const memories=new Set(actor.memories.filter(m=>m.source!=='heard').map(m=>m.eventId));
 for(let i=w.events.length-1;i>=0;i--){
  const event=w.events[i];
  if(memories.has(event.id)&&event.actors.includes(child.id)&&(event.kind==='birth'||event.audit?.scope.includes('feed-child')))return {id:child.id,at:{...event.place},inside:event.roomId??null,roomAt:event.roomAt?{...event.roomAt}:null,atMinute:event.at};
 }
 return undefined;
}
const rememberedChildPlace=(w:World,actor:Resident,child:Resident)=>rememberedChildObservation(w,actor,child)?.at;

function enterCareRoom(w:World,actor:Resident,child:Resident):void {
 const home=birthHome(w,actor,child);
 if(home && child.inside===home.id && !actor.inside && distance(actor.at,home.door)<=1){
  actor.at={...home.door};actor.inside=home.id;
 }
}

function canTender(w:World,actor:Resident,child:Resident):boolean {
 return here(child) && capable(actor) && years(w,actor)>=18 && years(w,child)<6 && child.guardianIds.includes(actor.id) && !child.refusesCare;
}
function canOffer(w:World,actor:Resident,child:Resident):boolean {
 if(!capable(actor)||years(w,actor)<18||years(w,child)>=18||!together(w,actor,child)||actor.id===child.id||child.guardianIds.includes(actor.id))return false;
 if(child.guardianOffer && child.guardianOffer.expiresAt>w.minute)return false;
 const current=nearbyGuardians(w,child);
 if(current.length) return current.some(g=>together(w,g,actor)&&together(w,g,child));
 return witnessedLoss(w,actor,child);
}

export function familyOpportunities(w:World,actor:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!capable(actor))return [];
 const choices:FormalOpportunity[]=housingOpportunities(w,actor);
 const add=(id:string,label:string,action:FamilyAction)=>choices.push({id,label,action});
 for(const child of w.residents){
  if(!here(child)||years(w,child)>=18)continue;
  const offer=child.guardianOffer;
  if(offer&&offer.expiresAt>w.minute&&together(w,actor,child)){
   const volunteer=w.residents.find(p=>p.id===offer.volunteerId);
   const mayReply=actor.id===child.id || actor.id===offer.guardianId;
   if(mayReply&&volunteer&&together(w,actor,volunteer)){
    for(const accept of [true,false]){
     if(accept&&(actor===child?offer.childApproved:offer.guardianApproved))continue;
     add(`guard.${child.id}.${accept}`,`${accept?'同意':'婉拒'}${volunteer.name}承担${actor===child?'我的':child.name+'的'}监护`,
      {type:'familyConsent',targetId:child.id,accept});
    }
   }
  }
  if(canTender(w,actor,child)&&hasFood(actor)&&(actor.inventory.water??0)>0){
   const visible=together(w,actor,child,10);
   // A parent knows the registered home address. The menu does not give away the child's remote state.
   const home=birthHome(w,actor,child);
   const remembered=rememberedChildPlace(w,actor,child);
   if(visible ? child.hunger>=12 : Boolean(home||remembered)){
    add(`tend.${child.id}`,visible?`用自己的一份饭食和水喂养${child.name}（饥饿 ${Math.round(child.hunger)}/100）`:
     `到自己记得的${child.name}身边或住处探望，找到孩子后用自有饭食和水喂养`,{type:'tendChild',targetId:child.id});
   }
  }
  if(canOffer(w,actor,child))add(`foster.${child.id}`,`自愿承担${child.name}的监护，向在场家人提出交接`,{type:'fosterChild',targetId:child.id});
 }
 return choices;
}

export function familyCareRoute(w:World,actor:Resident,action:FamilyAction):{target:Vec;duration:number;adjacent?:boolean;error?:string} {
 if(action.type==='inviteHome'){
  const guest=w.residents.find(p=>p.id===action.targetId);
  return guest&&together(w,actor,guest,12)?{target:guest.at,adjacent:true,duration:5}:{target:actor.at,duration:0,error:'邀请对象需要实际在场'};
 }
 if(action.type==='homeReply'){
  const home=w.buildings.find(b=>b.id===actor.homeInvitation?.buildingId);
  return home&&action.accept?{target:home.door,duration:5}:{target:actor.at,duration:1};
 }
 const child=w.residents.find(r=>r.id===action.targetId);
 const absent={target:actor.at,duration:0,error:'当前无法找到可接触的照护对象'};
 if(!child||!here(child))return absent;
 if(together(w,actor,child,12)){action.observedTarget={id:child.id,at:{...child.at},inside:child.inside,roomAt:child.roomAt?{...child.roomAt}:null,atMinute:w.minute};return {target:child.at,adjacent:!child.inside,duration:action.type==='tendChild'?20:5};}
 if(action.type==='tendChild'&&canTender(w,actor,child)){
  const remembered=rememberedChildObservation(w,actor,child);
  if(remembered){action.observedTarget=remembered;return {target:{...remembered.at},adjacent:!remembered.inside,duration:20};}
  const home=birthHome(w,actor,child);
  if(home){action.observedTarget={id:child.id,at:{...home.door},inside:home.id,roomAt:null,atMinute:w.minute};return {target:home.door,duration:20};}
 }
 return absent;
}

function enroll(w:World,volunteer:Resident,child:Resident){
 child.guardianIds.push(volunteer.id);
 delete child.guardianOffer;
 emitEvent(w,{kind:'care',populationChange:'guardian',actors:[volunteer.id,child.id],place:{...child.at},
  text:`${volunteer.name}自愿承担了${child.name}的监护。亲生父母与原来的亲缘记录保留。`});
}

/** The current guardian and a child able to decide each have a separate veto. */
function finishFamilyActionAtomic(w:World,actor:Resident,action:FamilyAction):Result {
 if(w.mode!=='formal')return fail('这个世界未开通家庭照护安排');
 if(action.type==='inviteHome'||action.type==='homeReply')return finishHousing(w,actor,action);
 const child=w.residents.find(r=>r.id===action.targetId);
 if(!child||!here(child)||years(w,child)>=18)return fail('孩子当前不在此处或已经成年');
 if(action.type==='tendChild'){
  if(!canTender(w,actor,child))return fail('当前没有幼儿喂养权限');
  if(!w.rooms)enterCareRoom(w,actor,child);
  if(!together(w,actor,child))return fail('须实际找到并来到孩子身边');
  const food=(actor.inventory.meal??0)>0?'meal':'turnip';
  if(!hasFood(actor)||(actor.inventory.water??0)<1)return fail('自己的饭食或清水不足');
  if(child.hunger<12)return fail('孩子现在已经吃饱');
  actor.inventory[food]!--;actor.inventory.water!--;
  child.hunger=Math.max(0,child.hunger-48);child.health=Math.min(100,child.health+3);
  emitEvent(w,{kind:'care',actors:[actor.id,child.id],place:{...child.at},text:`${actor.name}坐在${child.name}身边，用自己的${food==='meal'?'餐食':'芜菁泥'}和水喂了孩子一餐。`,
   audit:{authority:'guardian',scope:['feed-child'],rule:'family/feeding@1',providerId:actor.id,evidence:`guardian:${child.id}:${actor.id}`,resources:{[food]:1,water:1},termination:'这次喂养完成'}});
  return {ok:true};
 }
 if(action.type==='fosterChild'){
  if(!canOffer(w,actor,child))return fail('需要实际在场、可核实的照护需要，以及有权参与交接的人');
  const guardian=nearbyGuardians(w,child).find(g=>together(w,g,actor)&&together(w,g,child));
  if(!guardian && years(w,child)<6){enroll(w,actor,child);return {ok:true};}
  child.guardianOffer={volunteerId:actor.id,guardianId:guardian?.id,guardianApproved:!guardian,
   childApproved:years(w,child)<6,expiresAt:w.minute+DAY};
  emitEvent(w,{kind:'care',actors:[actor.id,child.id,...(guardian?[guardian.id]:[])],place:{...child.at},
   text:`${actor.name}向${child.name}的家庭提出承担监护，等待有关当事人决定。`});
  return {ok:true};
 }
 if(action.type!=='familyConsent')return fail('未知的家庭安排');
 const offer=child.guardianOffer;
 const volunteer=w.residents.find(p=>p.id===offer?.volunteerId);
 if(!offer||offer.expiresAt<=w.minute||!volunteer||!capable(volunteer)||!together(w,volunteer,child)||!together(w,actor,volunteer)||!together(w,actor,child))
  return fail('原监护提议已过期或当事人无法当面确认');
 if(!capable(actor))return fail('本次需要当事人自行表达意愿');
 const isGuardian=actor.id===offer.guardianId&&child.guardianIds.includes(actor.id);
 const isChild=actor===child&&years(w,child)>=6;
 if(!isGuardian&&!isChild)return fail('这个监护提议没有等待你的答复');
 if(!action.accept){
  delete child.guardianOffer;
  emitEvent(w,{kind:'care',actors:[actor.id,volunteer.id],place:{...child.at},text:`${actor.name}婉拒了这次监护安排。`});
  return {ok:true};
 }
 if(isGuardian&&offer.guardianApproved||isChild&&offer.childApproved)return fail('你已经同意了这份仍待完成的交接');
 if(isGuardian)offer.guardianApproved=true;
 if(isChild)offer.childApproved=true;
 if(offer.guardianApproved&&offer.childApproved)enroll(w,volunteer,child);
 else emitEvent(w,{kind:'care',actors:[actor.id,volunteer.id],place:{...child.at},text:`${actor.name}同意了自己的这一部分监护安排，仍等待另一位当事人。`});
 return {ok:true};
}

/** Existing dependent children keep an on-site caregiver when an adult changes household. */
export function homeMoveAllowed(w:World,actor:Resident,buildingId:string):boolean {
 return w.residents.filter(child=>here(child)&&years(w,child)<18&&child.homeId===actor.homeId&&
  child.guardianIds.includes(actor.id)&&child.homeId!==buildingId).every(child=>
   child.guardianIds.some(id=>{
    const guardian=w.residents.find(p=>p.id===id);
    return guardian&&guardian.id!==actor.id&&capable(guardian)&&years(w,guardian)>=18&&guardian.homeId===child.homeId;
   }));
}
function housingOpportunities(w:World,actor:Resident):FormalOpportunity[]{
 if(!capable(actor)||years(w,actor)<18)return [];
 const result:FormalOpportunity[]=[];
 const invitation=actor.homeInvitation;
 if(invitation&&invitation.expiresAt>w.minute){
  const host=w.residents.find(p=>p.id===invitation.hostId);
  const house=w.buildings.find(b=>b.id===invitation.buildingId);
  if(host&&house){
   result.push({id:'home.decline',label:`婉拒${host.name}发来的同住邀请`,action:{type:'homeReply',targetId:host.id,accept:false}});
   if(here(host)&&house.condition>0&&house.ownerId===host.id&&house.residents.length<house.capacity&&homeMoveAllowed(w,actor,house.id))
    result.push({id:'home.accept',label:`接受${host.name}的同住邀请，亲自搬到${house.name}`,action:{type:'homeReply',targetId:host.id,accept:true}});
  }
 }
 for(const invitee of w.residents.filter(p=>p.homeInvitation?.hostId===actor.id && p.homeInvitation.expiresAt>w.minute)){
  result.push({id:`home.revoke.${invitee.id}`,label:`撤回我给${invitee.name}的同住邀请`,action:{type:'homeReply',targetId:invitee.id,accept:false}});
 }
 const home=w.buildings.find(b=>b.id===actor.homeId&&b.condition>0&&b.ownerId===actor.id&&b.residents.includes(actor.id));
 if(home&&home.residents.length<home.capacity){
  for(const guest of w.residents.filter(p=>capable(p)&&p.id!==actor.id&&years(w,p)>=18&&p.homeId!==home.id&&
   together(w,actor,p)&&actor.knownPeople.includes(p.id)&&!(p.homeInvitation&&p.homeInvitation.expiresAt>w.minute)).slice(0,3)){
   result.push({id:`home.invite.${guest.id}`,label:`邀请${guest.name}住进自己住宅的空床，等对方决定`,action:{type:'inviteHome',targetId:guest.id}});
  }
 }
 return result;
}
function finishHousing(w:World,actor:Resident,action:Extract<Action,{type:'inviteHome'|'homeReply'}>):Result {
 if(!capable(actor)||years(w,actor)<18)return fail('迁居约定需要在场成年当事人');
 if(action.type==='inviteHome'){
  const home=w.buildings.find(b=>b.id===actor.homeId&&b.condition>0&&b.ownerId===actor.id&&b.residents.includes(actor.id));
  const guest=w.residents.find(p=>p.id===action.targetId);
  if(!home||home.residents.length>=home.capacity||!guest||!capable(guest)||years(w,guest)<18||guest===actor||guest.homeId===home.id||!together(w,actor,guest))
   return fail('需要空床、产权人和在场的受邀成年人');
  if(guest.homeInvitation&&guest.homeInvitation.expiresAt>w.minute)return fail('对方还有正在考虑的同住邀请');
  guest.homeInvitation={hostId:actor.id,buildingId:home.id,expiresAt:w.minute+DAY};
  emitEvent(w,{kind:'relationship',actors:[actor.id,guest.id],place:actor.at,text:`${actor.name}邀请${guest.name}同住，等待对方决定。`});
  return {ok:true};
 }
 const invitee=w.residents.find(p=>p.id===action.targetId&&p.homeInvitation?.hostId===actor.id);
 if(!action.accept && invitee){
  delete invitee.homeInvitation;
  emitEvent(w,{kind:'relationship',actors:[actor.id,invitee.id],place:actor.at,text:`${actor.name}撤回了给${invitee.name}的同住邀请。`});
  return {ok:true};
 }
 const invitation=actor.homeInvitation;
 if(!invitation||invitation.hostId!==action.targetId||invitation.expiresAt<=w.minute)return fail('这份同住邀请已经失效');
 const host=w.residents.find(p=>p.id===invitation.hostId);
 if(!action.accept){
  delete actor.homeInvitation;
  emitEvent(w,{kind:'relationship',actors:[actor.id,...(host?[host.id]:[])],place:actor.at,text:`${actor.name}婉拒了同住邀请。`});
  return {ok:true};
 }
 const home=w.buildings.find(b=>b.id===invitation.buildingId);
 if(!host||!capable(host)||!home||home.condition<=0||home.ownerId!==host.id||!home.residents.includes(host.id)||home.residents.length>=home.capacity)
  return fail('房主、居住权或空床已经变化');
 if(actor.inside||distance(actor.at,home.door)>1)return fail('须带着自己的物品实际到达受邀住宅门口');
 if(!homeMoveAllowed(w,actor,home.id))return fail('原住所的未成年子女尚无留下承担照护的监护人');
 const previous=w.buildings.find(b=>b.id===actor.homeId);
 if(previous)previous.residents=previous.residents.filter(id=>id!==actor.id);
 const visiting=actor.residency==='visitor';
 home.residents.push(actor.id);actor.homeId=home.id;actor.residency='resident';actor.revision++;
 if(!actor.knownBuildings.includes(home.id))actor.knownBuildings.push(home.id);
 delete actor.homeInvitation;
 emitEvent(w,{kind:'arrival',populationChange:visiting?'settle':'moveHome',actors:[actor.id,host.id],place:{...home.door},
  text:`${actor.name}接受了${host.name}的邀请，实际搬进了${home.name}。`});
 return {ok:true};
}

export function finishFamilyAction(w:World,actor:Resident,action:FamilyAction):Result{return foodTransaction(w,()=>finishFamilyActionAtomic(w,actor,action));}
