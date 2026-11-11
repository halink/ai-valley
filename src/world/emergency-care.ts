import type {Action,FormalOpportunity,Inventory,Resident,World} from '../shared/types.js';
import type {EmergencyCareAction,EmergencyCareAgreement} from '../shared/emergency-care.js';
import {knownAgeYears,DAY} from './time.js';
import {socialSpace} from './relationships.js';
import {careChildVisible as seen,childCareGapEvidence as gapEvidence} from './child-care-evidence.js';
import {childHelpReason,childHelpTarget,completeChildHelp,childHelpOpportunities,isChildHelpAction} from './child-help.js';
import {foodTransaction,foodValue} from './food.js';
import {foodFlowInputs,recordEmergencyCareMeal} from './food-consumption-evidence.js';
import {emitEvent,emitLedgerEvent} from './events.js';

const person=(w:World,id?:string)=>w.residents.find(p=>p.id===id);
const present=(r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside';
const capable=(r:Resident|undefined):r is Resident=>present(r)&&r.canDecide&&r.canExpress;
const adult=(w:World,r:Resident|undefined):r is Resident=>capable(r)&&(knownAgeYears(r.bornAt,w.minute)??-1)>=18;
const minor=(w:World,r:Resident|undefined):r is Resident=>{if(!present(r))return false;const age=knownAgeYears(r.bornAt,w.minute);return age!==null&&age<18;};
// A malformed or future date cannot establish the young-child exemption.
const infant=(w:World,r:Resident)=>{const age=knownAgeYears(r.bornAt,w.minute);return age!==null&&age<6;};
const get=(w:World,id?:string)=>w.emergencyCare?.agreements.find(c=>c.id===id);
const open=(c:EmergencyCareAgreement)=>c.status==='offered'||c.status==='active';
const sameIds=(a:string[],b:string[])=>[...new Set(a)].sort().join('\0')===[...new Set(b)].sort().join('\0');
const members=(c:EmergencyCareAgreement)=>[c.providerId,c.childId,c.reviewerId,...c.guardianIds];
export function initializeEmergencyCare(w:World){if(w.mode==='formal')w.emergencyCare??={nextSerial:1,agreements:[]};}

/** Expression permits only stopping this beneficiary's original finite agreement. */
export function emergencyCareSelfWithdrawal(w:World,r:Resident,a:Action):EmergencyCareAction|null {
 if(w.mode!=='formal'||!present(r)||!r.canExpress||a.type!=='emergencyCare'||a.operation!=='withdraw'
  ||Object.keys(a).some(k=>!['type','operation','agreementId'].includes(k)))return null;
 const c=get(w,a.agreementId);
 return c&&c.childId===r.id&&w.minute<c.expiresAt&&!c.endKnownBy.includes(r.id)?{type:'emergencyCare',operation:'withdraw',agreementId:c.id}:null;
}
export function emergencyCareSelfWithdrawalOpportunities(w:World,r:Resident):FormalOpportunity[]{
 return (w.emergencyCare?.agreements??[]).flatMap(c=>{
  const action=emergencyCareSelfWithdrawal(w,r,{type:'emergencyCare',operation:'withdraw',agreementId:c.id});
  return action?[{id:'emergency.selfStop.'+c.id,label:'本人立即拒绝或停止这一份限时照护，不改变其他约定、监护与财产',action}]:[];
 });
}

function connected(w:World,a:string,b:string){
 if(a===b)return true;
 const pa=person(w,a),pb=person(w,b);
 const ancestors=(p:Resident|undefined)=>{const ids=new Set<string>(),pending=[...(p?.parents??[]),...(p?.adoptiveParents??[])];while(pending.length){const id=pending.pop()!;if(ids.has(id))continue;ids.add(id);const parent=person(w,id);pending.push(...(parent?.parents??[]),...(parent?.adoptiveParents??[]));}return ids;};
 const aa=ancestors(pa),bb=ancestors(pb);
 if(aa.has(b)||bb.has(a)||[...aa].some(id=>bb.has(id)))return true;
 if([[pa,b],[pb,a]].some(([p,id])=>(p as Resident|undefined)?.relations.some(t=>t.targetId===id&&(t.kin||t.adoptive||t.partner))))return true;
 return !!w.household?.pools.some(p=>['offered','open'].includes(p.status)&&p.credits.some(c=>c.ownerId===a)&&p.credits.some(c=>c.ownerId===b))
  ||!!w.employment?.contracts.some(c=>c.status==='active'&&[c.employerId,c.workerId].includes(a)&&[c.employerId,c.workerId].includes(b))
  ||!!w.debt?.loans.some(c=>['offered','active','overdue'].includes(c.status)&&[c.ownerId,c.borrowerId].includes(a)&&[c.ownerId,c.borrowerId].includes(b));
}
function independent(w:World,r:Resident|undefined,p:Resident,providerId:string){return adult(w,r)&&![p.id,providerId,...p.guardianIds].some(id=>connected(w,r.id,id));}
function edible(w:World,r:Resident,item:'meal'|'turnip'){
 const expired=(w.food?.lots[`person:${r.id}`]?.[item]??[]).filter(l=>l.expiresAt<=w.minute).reduce((n,l)=>n+l.quantity,0);
 return expired===0&&(r.inventory[item]??0)>=1;
}
const meal=(w:World,r:Resident)=>edible(w,r,'meal')?'meal':edible(w,r,'turnip')?'turnip':null;
function supplies(w:World,r:Resident){return meal(w,r)!==null&&(r.inventory.water??0)>=1;}
function changed(w:World,c:EmergencyCareAgreement):string|null {
 const p=person(w,c.childId);
 if(!minor(w,p))return '无法确认仍为未成年孩子，或已离谷、不再存活';
 if(!adult(w,person(w,c.providerId))||!independent(w,person(w,c.reviewerId),p,c.providerId))return '提供者或独立复核资格已变化';
 if(!sameIds(c.guardianIds,p.guardianIds)||p.guardianIds.some(id=>capable(person(w,id))))return '监护关系已变化或原监护人恢复，须重新交接';
 if(p.refusesCare)return '孩子明确拒绝了照护';
 if(!infant(w,p)&&(!capable(p)||c.status==='active'&&c.acceptedAt===null))return '孩子须以当前能力独立接受，不能沿用幼儿时的权限';
 return null;
}
function end(w:World,c:EmergencyCareAgreement,status:EmergencyCareAgreement['status'],reason:string){
 if(!open(c))return;c.status=status;c.endedAt=w.minute;c.reason=reason;
 emitLedgerEvent(w,{kind:'care',actors:[c.providerId,c.childId,c.reviewerId],place:{...c.location.at},text:`限时照护${c.id}结束：${reason}。未发生监护、住处或财产权转移；远处当事人须实际获知。`});
}
export function advanceEmergencyCare(w:World){
 if(w.mode!=='formal')return;initializeEmergencyCare(w);
 for(const c of w.emergencyCare!.agreements){if(!open(c))continue;if(w.minute>=c.expiresAt)end(w,c,'expired','原定24小时届满，不自动续期');else{const reason=changed(w,c);if(reason)end(w,c,'invalid',reason);}}
}
function fact(w:World,r:Resident,p:Resident,c:EmergencyCareAgreement|undefined,text:string,resources:Inventory={},basis='分别接受并独立复核的限时照护'){
 return emitEvent(w,{kind:'care',actors:[r.id,p.id],place:{...r.at},text,audit:{rule:'child/emergency-care@1',authority:basis,evidence:c?.id??`observed:${r.id}:${p.id}:${w.minute}`,scope:['one-physical-meal','own-food-and-water','no-guardianship','no-public-money','no-property-transfer'],resources,providerId:c?.providerId??r.id,termination:'本次喂养结束；异议、资格变化或24小时届满停止连续权限'}});
}
export function emergencyCareReason(w:World,r:Resident,a:EmergencyCareAction):string|null {
 if(isChildHelpAction(a))return childHelpReason(w,r,a);
 if(emergencyCareSelfWithdrawal(w,r,a))return null;
 if(w.mode!=='formal'||!capable(r))return '本人当前不能决定这项照护';
 const c=get(w,a.agreementId),p=person(w,a.childId??c?.childId);
 if(['offer','rescueMeal'].includes(a.operation)?!!a.agreementId:!c||a.childId!==undefined&&a.childId!==c.childId)return '不能替换原照护对象或混用救急与连续权限';
 if(a.operation==='withdraw')return c&&w.minute<c.expiresAt&&members(c).includes(r.id)&&!c.endKnownBy.includes(r.id)?null:'没有本人可撤回或提出异议的限时照护';
 if(a.operation==='inspect')return c&&members(c).includes(r.id)?null:'本人没有这份照护记录';
 if(!minor(w,p)||p.refusesCare||!seen(w,r,p))return '须在有使用权的现场亲见未成年孩子，且没有明确拒绝';
 if(a.operation==='rescueMeal'){
  if(!adult(w,r)||r.id===p.id||r.health<=30||r.energy<10||!infant(w,p)&&capable(p)||p.health>20||p.hunger<12||!supplies(w,r))return '当次救急须为严重衰弱、不能自主决定的孩子，由有能力成年人用自有食品和水完成';
  if(p.guardianIds.some(id=>{const g=person(w,id);return adult(w,g)&&socialSpace(w,g,p);}))return '在场已有能及时决定的监护人';
  return null;
 }
 if(a.operation==='offer'){
  const reviewer=person(w,a.reviewerId);
  if(!adult(w,r)||r.id===p.id||r.health<=30||r.energy<10||!supplies(w,r)||!gapEvidence(w,r,p))return '须有自有饭食清水并亲自核实无人照护，未知的监护缺席不能视为失去监护';
  if(!infant(w,p)&&!capable(p))return '有独立答复年龄的孩子暂不能同意，仅保留当次救急';
  if(!reviewer||!independent(w,reviewer,p,r.id)||!seen(w,r,reviewer)||!seen(w,reviewer,p))return '须有实际在场、无家庭或经济利益冲突的成年复核人';
  if(a.step!==(w.emergencyCare?.nextSerial??1)||w.emergencyCare?.agreements.some(c=>c.childId===p.id&&c.expiresAt>w.minute&&(open(c)||!c.endKnownBy.includes(r.id))))return '原提议版本已变化或孩子已有待办照护';
  return null;
 }
 if(!c||!open(c)||w.minute>=c.expiresAt)return '原限时照护已结束';
 const problem=changed(w,c);if(problem)return a.operation==='feed'?'原约当前不能完成，须重新核对当事人的条件':problem;
 const provider=person(w,c.providerId)!;
 if(a.operation==='accept')return r.id===p.id&&!infant(w,p)&&c.acceptedAt===null&&seen(w,r,provider)?null:'本次须由孩子当面独立接受';
 if(a.operation==='review')return r.id===c.reviewerId&&c.reviewedAt===null&&gapEvidence(w,r,p)&&seen(w,r,provider)?null:'独立复核须亲见孩子、提供者及监护缺口';
 if(a.operation==='feed')return c.status==='active'&&r.id===c.providerId&&a.step===c.meals&&c.meals<c.mealLimit&&r.health>30&&r.energy>=10&&p.hunger>=12&&supplies(w,r)?null:'须为有效约定内下一次实际喂养，并有自有食品清水和真实需要';
 return '不支持这项限时照护行动';
}
export function emergencyCareTarget(w:World,r:Resident,a:EmergencyCareAction){
 if(isChildHelpAction(a))return childHelpTarget(w,r,a);
 const c=get(w,a.agreementId);
 if(a.operation==='inspect'&&c&&members(c).includes(r.id)){(a as Action).observedTarget=structuredClone(c.location);return {target:{...c.location.at},adjacent:!c.location.inside,duration:2};}
 const error=emergencyCareReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 // These choices are made at the actual care location. No remote person tracking or new room entry permission.
 return {target:{...r.at},duration:a.operation==='feed'||a.operation==='rescueMeal'?20:2};
}
export function completeEmergencyCare(w:World,r:Resident,a:EmergencyCareAction):string|null{
 if(isChildHelpAction(a))return completeChildHelp(w,r,a);
 return foodTransaction(w,()=>{
 const error=emergencyCareReason(w,r,a);if(error)return error;
 let c=get(w,a.agreementId),p=person(w,a.childId??c?.childId);
 if(a.operation==='withdraw'){
  end(w,c!,'withdrawn',`${r.name}撤回或提出异议`);c!.endKnownBy.push(r.id);
  const event=emitEvent(w,{kind:'care',actors:[r.id],place:{...r.at},text:`${r.name}撤回了自己参与的限时照护${c!.id}，此后不能再按原约喂养。`});
  for(const id of event.witnesses)if(members(c!).includes(id)&&!c!.endKnownBy.includes(id))c!.endKnownBy.push(id);return null;
 }
 if(a.operation==='inspect'){
  if(!p||!seen(w,r,p))return '到达记得的地点后没有找到可接触的孩子，未获知新的远处状态';
  // Seeing the child does not deliver an absent reviewer's withdrawal or a remote guardian's recovery.
  const localEnd=p.refusesCare||(knownAgeYears(p.bornAt,w.minute)??-1)>=18||p.guardianIds.some(id=>{const g=person(w,id);return adult(w,g)&&seen(w,r,g);});
  if(localEnd&&!c!.endKnownBy.includes(r.id))c!.endKnownBy.push(r.id);
  fact(w,r,p,c,`${r.name}实际到原址探望${p.name}，${localEnd?'亲见原照护条件已改变，须另行交接':'只核对眼前处境，不代答未在场当事人的决定'}。`);return null;
 }
 p=p!;
 if(a.operation==='offer'){
  initializeEmergencyCare(w);c={id:`child-care:${w.id}:${w.emergencyCare!.nextSerial++}`,providerId:r.id,childId:p.id,reviewerId:a.reviewerId!,guardianIds:[...p.guardianIds],location:{id:p.id,at:{...p.at},inside:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,atMinute:w.minute},createdAt:w.minute,expiresAt:w.minute+DAY,reviewedAt:null,acceptedAt:null,mealLimit:4,meals:0,status:'offered',endedAt:null,reason:null,endKnownBy:[],evidence:[{personId:r.id,at:w.minute,facts:gapEvidence(w,r,p)!}],receipts:[]};w.emergencyCare!.agreements.push(c);
  fact(w,r,p,c,`${r.name}自愿为${p.name}提供24小时内最多4次现场喂养，只使用自己的饭食清水，等待独立复核及有能力孩子的单独同意。`);return null;
 }
 if(a.operation==='accept'||a.operation==='review'){
  if(a.operation==='accept')c!.acceptedAt=w.minute;
  else {c!.reviewedAt=w.minute;c!.evidence.push({personId:r.id,at:w.minute,facts:gapEvidence(w,r,p)!});}
  if(c!.reviewedAt!==null&&(infant(w,p)||c!.acceptedAt!==null))c!.status='active';
  fact(w,r,p,c,`${r.name}${a.operation==='accept'?'独立接受':'实际完成独立复核'}了限时照护；${c!.status==='active'?'约定已成立，之后仍须提供者逐次实际到场':'仍等待另一方决定'}。`);return null;
 }
 const item=meal(w,r)!,nutrition=foodValue(w,`person:${r.id}`,item),resources:Inventory={[item]:1,water:1};
 // Read the actual selected batch before its debit. Repairs performed by the
 // original food transaction remain unproven, not evidence of original food.
 const inputs=foodFlowInputs(w,`person:${r.id}`,resources,1,true),hungerBefore=p.hunger;
 const foodBefore=r.inventory[item]!,waterBefore=r.inventory.water!;
 r.inventory[item]!--;r.inventory.water!--;p.hunger=Math.max(0,p.hunger-nutrition);
 const event=fact(w,r,p,c,`${r.name}实际用自有1份${item==='meal'?'餐食':'芜菁'}和1份清水喂养${p.name}，没有支取孩子财物或公款。`,resources,a.operation==='rescueMeal'?'当次严重失能儿童救急':'分别接受并独立复核的限时照护');
 if(inputs&&r.activity?.action.type==='emergencyCare'&&(a.operation==='feed'||a.operation==='rescueMeal')){
  for(const input of inputs)input.quantity=input.item===item?foodBefore-r.inventory[item]!:waterBefore-r.inventory.water!;
  recordEmergencyCareMeal(w,{action:'emergencyCare',operation:a.operation,at:w.minute,providerId:r.id,beneficiaryId:p.id,
   eventId:event.id,planId:r.activity.planId,container:'person:'+r.id,definition:r.activity.definition,
   agreementId:c?.id??null,mealNumber:c?c.meals+1:null,inputs,hungerBefore,hungerAfter:p.hunger,hungerRelief:hungerBefore-p.hunger});
 }
 if(c){c.receipts.push({id:`${c.id}:meal:${c.meals}`,at:w.minute,providerId:r.id,resources,nutrition,eventId:event.id});c.meals++;if(c.meals>=c.mealLimit)end(w,c,'completed','四次实际喂养额度用尽');}
 return null;
 });}
export function emergencyCareOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!capable(r))return [];const out:FormalOpportunity[]=[...childHelpOpportunities(w,r)];
 const add=(label:string,a:EmergencyCareAction)=>{if(!emergencyCareReason(w,r,a))out.push({id:`child-care.${a.operation}.${a.childId??a.agreementId}.${a.reviewerId??''}`,label,action:a});};
 for(const c of w.emergencyCare?.agreements??[]){if(!members(c).includes(r.id))continue;
  if(w.minute<c.expiresAt&&!c.endKnownBy.includes(r.id)){
   if(r.id!==c.childId)add('拒绝、撤回或反对这份限时照护，不改变监护与财产',{type:'emergencyCare',operation:'withdraw',agreementId:c.id});
   const p=person(w,c.childId);if(p&&seen(w,r,p)){
    add('孩子本人独立接受这份24小时照护',{type:'emergencyCare',operation:'accept',agreementId:c.id});
    add('亲自独立复核眼前监护缺口和自愿照护条款',{type:'emergencyCare',operation:'review',agreementId:c.id});
    // A remote withdrawal cannot silently disappear an already known local choice. The engine rechecks before delivery.
    if(r.id===c.providerId&&c.reviewedAt!==null&&(infant(w,p)||c.acceptedAt!==null)&&minor(w,p)&&!p.refusesCare&&p.hunger>=12&&adult(w,r)&&r.health>30&&r.energy>=10&&supplies(w,r)&&c.meals<c.mealLimit)out.push({id:`child-care.feed.${c.id}`,label:'按记录原约尝试用自有饭食和清水喂养一次，实际执行仍须重新核对条件',action:{type:'emergencyCare',operation:'feed',agreementId:c.id,step:c.meals}});
   }
  }
  // The remembered address and personal withdrawal remain unchanged by unseen remote invalidation.
  if(w.minute<c.expiresAt&&!c.endKnownBy.includes(r.id))add('到原先亲见的位置探望并核对限时照护，不保证孩子仍在',{type:'emergencyCare',operation:'inspect',agreementId:c.id});
 }
 if(adult(w,r))for(const p of w.residents.filter(p=>minor(w,p)&&seen(w,r,p))){
  add(`为眼前严重衰弱且不能自主决定的${p.name}提供当次自有饭食清水救急，不取得连续权限`,{type:'emergencyCare',operation:'rescueMeal',childId:p.id});
  for(const reviewer of w.residents.filter(q=>independent(w,q,p,r.id)&&seen(w,r,q)&&seen(w,q,p)))add(`自愿为${p.name}提供24小时、最多4次自有饭食清水照护，由${reviewer.name}另行独立复核，孩子有能力时另行同意`,{type:'emergencyCare',operation:'offer',childId:p.id,reviewerId:reviewer.id,step:w.emergencyCare?.nextSerial??1});
 }
 return out;
}
