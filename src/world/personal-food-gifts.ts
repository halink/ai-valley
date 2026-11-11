import type {Action,FormalOpportunity,PersonObservation,Resident,Vec,World} from '../shared/types.js';
import type {PersonalFoodGift,PersonalFoodGiftAction,PersonalFoodGiftAgeTerms} from '../shared/personal-food-gifts.js';
import {isPersonalFoodGiftStop} from '../shared/personal-food-gifts.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {commonsStay} from '../shared/commons.js';
import {residentialStay} from '../shared/premises.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import {knownAgeYears} from './time.js';
import {socialPresence} from './relationships.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {foodTransaction} from './food.js';
import {routeFood} from './food-routes.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {hasReceipt} from './receipts.js';

export const PERSONAL_FOOD_GIFT_MINUTES=120;
const unavailable='原赠粮尚不能在此完成，未交付任何食物；远方原因和位置仍未知';
const person=(w:World,id:string)=>w.residents.find(p=>p.id===id);
const gifts=(w:World)=>w.personalFoodGifts?.gifts??[];
const capable=(w:World,p:Resident|undefined,minAge=6):p is Resident=>!!p&&p.status==='alive'&&p.residency!=='outside'&&p.canDecide&&p.canExpress&&(knownAgeYears(p.bornAt,w.minute)??-1)>=minAge&&Number.isFinite(p.health)&&p.health>0;
const carried=(w:World,p:Resident)=>!!travellingFamily(w,p.id)||!!familyPassenger(w,p.id)||!!w.ferries?.trips.some(t=>t.aboard.includes(p.id))||!!w.health?.transports.some(t=>t.phase==='carrying'&&(t.patientId===p.id||t.carrierId===p.id));
const loc=(w:World,p:Resident):PersonObservation=>({id:p.id,at:{...p.at},inside:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,atMinute:w.minute});
const point=(p:Vec|undefined|null):p is Vec=>!!p&&Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y);
const edible=(i:unknown):i is typeof itemKeys[number]=>typeof i==='string'&&itemKeys.includes(i as typeof itemKeys[number])&&goods[i as typeof itemKeys[number]].food>0;
const quantity=(n:number)=>Number.isSafeInteger(n)&&n>=1&&n<=3;
const stock=(r:Resident,i:typeof itemKeys[number],n:number)=>Number.isFinite(r.inventory[i])&&(r.inventory[i]??0)>=n;
const sourceReceipt=(id:string)=>'personal-food-gift:offer:'+id;
const deliveryReceipt=(id:string)=>'personal-food-gift:delivery:'+id;
export function personalFoodGiftReceiptId(_w:World,r:Resident,version:1|2=2){return `personal-food-gift:${version===2?'v2:':''}${r.id}:${r.revision}`;}
export function initializePersonalFoodGifts(w:World){if(w.mode==='formal')w.personalFoodGifts??={nextSerial:1,gifts:[]};}
function ageTermsValid(t:PersonalFoodGiftAgeTerms,before:number){
 if(!t||Object.keys(t).length!==5||t.version!==2||!Number.isFinite(t.decidedAt)||t.decidedAt>before)return false;
 const giver=knownAgeYears(t.giverBornAt,t.decidedAt),recipient=knownAgeYears(t.recipientBornAt,t.decidedAt);
 return giver!==null&&giver>=13&&recipient!==null&&recipient>=6&&t.maxQuantity===(giver<18||recipient<18?1:3);
}
function offerTerms(w:World,r:Resident,p:Resident):PersonalFoodGiftAgeTerms{return {version:2,decidedAt:w.minute,giverBornAt:r.bornAt,recipientBornAt:p.bornAt,maxQuantity:(knownAgeYears(r.bornAt,w.minute)??0)<18||(knownAgeYears(p.bornAt,w.minute)??0)<18?1:3};}
/** Only inspect the acting person's current identity until the parties really meet. */
function partyEligible(w:World,c:PersonalFoodGift,p:Resident|undefined,giver:boolean):p is Resident {
 if(!capable(w,p,c.ageTerms?(giver?13:6):18))return false;
 return c.ageTerms?p.bornAt===(giver?c.ageTerms.giverBornAt:c.ageTerms.recipientBornAt):(knownAgeYears(p.bornAt,c.offeredAt)??-1)>=18;
}
function shape(a:PersonalFoodGiftAction){
 const fields=a.operation==='offer'?['type','operation','recipientId','item','quantity','receiptId']:['type','operation','giftId'];
 return ['offer','accept','deliver','cancel','decline'].includes(a.operation)&&Object.keys(a).every(k=>fields.includes(k)||a.operation==='offer'&&k==='ageTerms')&&fields.every(k=>k==='quantity'?quantity((a as Extract<PersonalFoodGiftAction,{operation:'offer'}>).quantity):typeof (a as unknown as Record<string,unknown>)[k]==='string'&&(a as unknown as Record<string,string>)[k].length>0)&&(a.operation!=='offer'||edible(a.item));
}
function access(w:World,p:Resident,id:string){const b=w.buildings.find(b=>b.id===id);return !!b&&b.condition>0&&(b.ownerId==='commons'||b.ownerId===p.id||b.residents.includes(p.id)||!!commonsStay(w,p,b.id)||!!residentialStay(w,p.id,b.id));}
function physical(w:World,p:Resident){
 if(!point(p.at))return false;
 if(!p.inside)return p.inside===null&&p.roomAt==null&&walkable(w,p.at);
 const b=w.buildings.find(b=>b.id===p.inside);return !!b&&!!w.rooms&&point(p.roomAt)&&same(p.at,b.door)&&access(w,p,b.id)&&roomPath(roomLayout(w,b),p.roomAt,p.roomAt)!==null;
}
function near(w:World,a:Resident,b:Resident){
 if(!physical(w,a)||!physical(w,b)||carried(w,a)||carried(w,b)||!socialPresence(w,a,b))return false;
 if(a.inside)return true;
 const path=findPath(w,a.at,b.at,false,2);return path!==null&&path.length<=2;
}
function atPlace(p:Resident,l:PersonObservation){return same(p.at,l.at)&&p.inside===l.inside&&(!l.inside||!!p.roomAt&&!!l.roomAt&&same(p.roomAt,l.roomAt));}
function binding(c:PersonalFoodGift){const original=[c.id,c.giverId,c.recipientId,c.item,c.quantity,c.receiptId,c.offeredAt,c.expiresAt];return JSON.stringify(c.ageTerms?[...original,c.ageTerms]:original);}
const proofVersion=(c:PersonalFoodGift)=>c.ageTerms?2:1;
const proofAuthority=(c:PersonalFoodGift)=>c.ageTerms?'independent-age-bounded-personal-food':'independent-adult-personal-food';
function valid(w:World,c:PersonalFoodGift){
 if(!c||!edible(c.item)||!quantity(c.quantity)||c.giverId===c.recipientId||!c.knownStatus||!Array.isArray(c.eventIds)||!Number.isFinite(c.offeredAt)||c.offeredAt>w.minute||c.expiresAt!==c.offeredAt+PERSONAL_FOOD_GIFT_MINUTES||!c.location||!point(c.location.at)||c.location.id!==c.recipientId||!Number.isFinite(c.location.atMinute)||!(c.location.inside===null||typeof c.location.inside==='string'&&point(c.location.roomAt)))return false;
 if(c.ageTerms!==undefined&&(!ageTermsValid(c.ageTerms,c.offeredAt)||c.quantity>c.ageTerms.maxQuantity))return false;
 const proof=(e:World['events'][number]|undefined,first:string,second:string)=>!!e&&Array.isArray(e.actors)&&e.actors.length===2&&e.actors[0]===first&&e.actors[1]===second&&Array.isArray(e.witnesses)&&e.audit?.authority===proofAuthority(c)&&e.audit.providerId===c.giverId&&JSON.stringify(e.audit.scope)===JSON.stringify(['personal-food-only'])&&Object.keys(e.audit.resources??{}).length===1&&e.audit.resources[c.item]===c.quantity;
 const e=w.events.find(e=>c.eventIds.includes(e.id)&&e.audit?.rule===`personal-food-gift/offer@${proofVersion(c)}`);
 if(!proof(e,c.giverId,c.recipientId)||!e||!hasReceipt(w,sourceReceipt(c.receiptId))||e.at!==c.offeredAt||e.audit?.evidence!==binding(c)||!e.witnesses.includes(c.giverId)||!e.witnesses.includes(c.recipientId))return false;
 if(c.acceptedAt!==null){const accepted=w.events.find(e=>c.eventIds.includes(e.id)&&e.audit?.rule===`personal-food-gift/accept@${proofVersion(c)}`);if(!Number.isFinite(c.acceptedAt)||c.acceptedAt<c.offeredAt||c.acceptedAt>=c.expiresAt||!proof(accepted,c.recipientId,c.giverId)||!accepted||accepted.at!==c.acceptedAt||accepted.audit?.evidence!==JSON.stringify([binding(c),c.location])||!accepted.witnesses.includes(c.giverId)||!accepted.witnesses.includes(c.recipientId))return false;}
 return true;
}
function statusKnown(c:PersonalFoodGift,r:Resident){return ['offered','accepted'].includes(c.knownStatus[r.id]);}
function localEvent(w:World,c:PersonalFoodGift,r:Resident,text:string,rule?:string){
 const other=person(w,r.id===c.giverId?c.recipientId:c.giverId),witnesses=[r.id,...(other&&near(w,r,other)?[other.id]:[])];
 const e=emitEvent(w,{kind:'trade',actors:[r.id,...witnesses.filter(id=>id!==r.id)],place:{...r.at},witnesses,text,...(rule?{audit:{rule,authority:proofAuthority(c),evidence:rule.startsWith('personal-food-gift/offer@')?binding(c):JSON.stringify([binding(c),c.location]),scope:['personal-food-only'],resources:{[c.item]:c.quantity},providerId:c.giverId,termination:'不喂食、不医疗、不代理、不动用公粮'}}:{})});
 c.eventIds.push(e.id);for(const id of e.witnesses)c.knownStatus[id]=c.status;
 for(const id of e.witnesses){const p=person(w,id)!;p.revision++;p.decisionDue=Math.min(p.decisionDue,w.minute);}
}
export function personalFoodGiftReason(w:World,r:Resident,a:PersonalFoodGiftAction,atSite=false):string|null {
 if(!shape(a)||w.mode!=='formal'||!capable(w,r))return '仅由年龄已知且能自主决定和表达的在地居民处理本人有限赠粮';
 if(a.operation==='offer'){
  const p=person(w,a.recipientId),t=a.ageTerms;
  // A new choice cannot shed its terms to masquerade as an older adult-only choice.
  if(a.receiptId.startsWith('personal-food-gift:v2:')!==(t!==undefined))return '原赠粮选择的回执与权限版本不一致';
  if(t!==undefined&&(!ageTermsValid(t,w.minute)||t.giverBornAt!==r.bornAt||t.recipientBornAt!==p?.bornAt||a.quantity>t.maxQuantity))return '原赠粮年龄或数量条款已失效，须重新选择；生日不扩大旧选择';
  if(!capable(w,r,t?13:18)||!capable(w,p,t?6:18)||p.id===r.id||!near(w,r,p)||!stock(r,a.item,a.quantity)||t&&a.quantity>offerTerms(w,r,p).maxQuantity)return '须合法近身赠送本人实际携带的食品：送出者满13岁，接收者满6岁且可自主进食；涉未成年限1份，成人之间1–3份';
  if(hasReceipt(w,sourceReceipt(a.receiptId)))return '原提议选择已经使用，不能重新编号复活';
  if(gifts(w).filter(c=>c.giverId===r.id&&statusKnown(c,r)&&w.minute<c.expiresAt).length>=3)return '本人至多保留三份未结束赠粮，请先处理原提议';
  return null;
 }
 const c=gifts(w).find(c=>c.id===a.giftId);if(!c||!valid(w,c)||![c.giverId,c.recipientId].includes(r.id))return '没有属于本人的完整赠粮记录';
 if(!partyEligible(w,c,r,r.id===c.giverId))return '本人当前年龄或能力不符合原赠粮权限，旧约不自动扩权';
 if(w.minute>=c.expiresAt||!statusKnown(c,r))return '本人已知的原赠粮已结束或到期';
 if(isPersonalFoodGiftStop(a))return a.operation==='cancel'&&r.id!==c.giverId||a.operation==='decline'&&r.id!==c.recipientId?'只能撤回或拒绝本人参加的这份赠粮':null;
 if(carried(w,r)||!physical(w,r))return unavailable;
 const giver=person(w,c.giverId),recipient=person(w,c.recipientId);
 if(a.operation==='accept'){
  if(r.id!==c.recipientId||c.status!=='offered'||c.acceptedAt!==null||!partyEligible(w,c,giver,true)||!near(w,r,giver))return unavailable;
  // Acceptance does not inspect the giver's private current stock or reserve it.
  return null;
 }
 if(r.id!==c.giverId||c.knownStatus[r.id]!=='accepted'||c.acceptedAt===null||hasReceipt(w,deliveryReceipt(c.id)))return unavailable;
 if(!stock(r,c.item,c.quantity))return '本人实际携带的原类食物不足，未交付；不改用公粮、商铺或他人物品';
 if(c.location.inside&&!access(w,r,c.location.inside))return '本人已无原约房间使用权，不能因赠粮进入';
 // Remote facts never change a route or disclose somebody else's current whereabouts.
 if(!atSite)return null;
 if(c.status!=='accepted'||!partyEligible(w,c,recipient,false)||!partyEligible(w,c,giver,true)||!atPlace(recipient,c.location)||!near(w,r,recipient))return unavailable;
 if(!Number.isFinite(recipient.inventory[c.item]??0)||(recipient.inventory[c.item]??0)<0||!Number.isFinite((recipient.inventory[c.item]??0)+c.quantity))return unavailable;
 return null;
}
export function personalFoodGiftTarget(w:World,r:Resident,a:PersonalFoodGiftAction){
 const error=personalFoodGiftReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 const c=a.operation==='deliver'?gifts(w).find(c=>c.id===a.giftId):undefined;
 return {target:c?{...c.location.at}:{...r.at},adjacent:c?!c.location.inside:false,duration:1};
}
/** Check every actual room step, including exit paths. No missing coordinates become a doorway. */
export function personalFoodGiftTravelReason(w:World,r:Resident,a:PersonalFoodGiftAction):string|null {
 const error=personalFoodGiftReason(w,r,a);if(error)return error;
 const activity=r.activity;if(!activity)return unavailable;
 if(a.operation!=='deliver'&&(activity.path.length||activity.room))return unavailable;
 if(activity.path.length&&distance(r.at,activity.path[0])!==1)return '原赠粮路线不是连续实际步行';
 if(activity.room){const b=w.buildings.find(b=>b.id===r.inside),from=r.roomAt,next=activity.room.path[0];if(!b||!from||!access(w,r,b.id)||!same(r.at,b.door)||next&&(distance(from,next)!==1||roomPath(roomLayout(w,b),from,next)?.length!==1))return '原赠粮房间路线已失效';}
 if(a.operation==='deliver'){
  const c=gifts(w).find(c=>c.id===a.giftId)!;
  if(!same(activity.target,c.location.at))return unavailable;
  if(c.location.inside){const b=w.buildings.find(b=>b.id===c.location.inside);if(!b||!same(b.door,c.location.at)||!access(w,r,b.id)||!c.location.roomAt||roomPath(roomLayout(w,b),r.inside===b.id?r.roomAt!:roomLayout(w,b).entry,c.location.roomAt)===null)return '原赠粮房间通路或使用权已失效';}
 }
 return null;
}
export function personalFoodGiftWork(w:World,r:Resident,a:PersonalFoodGiftAction,minutes:number):string|null {
 const error=personalFoodGiftReason(w,r,a,true);if(error)return error;
 const activity=r.activity;if(!activity||activity.path.length||activity.room?.path.length||!Number.isFinite(minutes)||minutes<=0||minutes>1)return unavailable;
 const work=activity.foodGiftWork??={from:w.minute-minutes,through:w.minute-minutes,minutes:0};
 if(!Number.isFinite(work.from)||!Number.isFinite(work.through)||!Number.isFinite(work.minutes)||work.minutes<0||Math.abs(work.through-(w.minute-minutes))>1e-7||Math.abs(work.through-work.from-work.minutes)>1e-7)return unavailable;
 work.minutes+=minutes;work.through=w.minute;return null;
}
export function completePersonalFoodGift(w:World,r:Resident,a:PersonalFoodGiftAction):string|null {return foodTransaction(w,()=>{
 const error=personalFoodGiftReason(w,r,a,true);if(error)return error;
 initializePersonalFoodGifts(w);
 if(isPersonalFoodGiftStop(a)){
  const c=gifts(w).find(c=>c.id===a.giftId)!;
  if(['offered','accepted'].includes(c.status)){c.status=a.operation==='cancel'?'cancelled':'declined';c.endedAt=w.minute;c.reason='本人撤回原赠粮';}
  c.knownStatus[r.id]=a.operation==='cancel'?'cancelled':'declined';
  const matches=(v:Action)=>v.type==='personalFoodGift'&&v.operation!=='offer'&&v.giftId===c.id;
  if(r.activity&&matches(r.activity.action)||r.plan?.actions.some(matches)){r.activity=null;r.plan=null;}
  localEvent(w,c,r,`${r.name}立即${a.operation==='cancel'?'撤回':'拒绝或撤回接受'}本人原赠粮${c.id}；不交付、不代另一方决定。`);return null;
 }
 const work=r.activity?.foodGiftWork;
 if(!r.activity||JSON.stringify(r.activity.action)!==JSON.stringify(a)||r.activity.path.length||r.activity.room?.path.length||!work||!Number.isFinite(work.minutes)||work.minutes<1||work.minutes>2||work.through!==w.minute||Math.abs(work.through-work.from-work.minutes)>1e-7)return '须完成本人真实近身办理时间，不能直接伪造交付';
 if(a.operation==='offer'){
  const state=w.personalFoodGifts!,p=person(w,a.recipientId)!;
  const c:PersonalFoodGift={id:`personal-food-gift:${w.id}:${state.nextSerial++}`,giverId:r.id,recipientId:p.id,item:a.item,quantity:a.quantity,receiptId:a.receiptId,...(a.ageTerms?{ageTerms:structuredClone(a.ageTerms)}:{}),offeredAt:w.minute,expiresAt:w.minute+PERSONAL_FOOD_GIFT_MINUTES,acceptedAt:null,location:loc(w,p),status:'offered',knownStatus:{},endedAt:null,reason:null,eventIds:[]};
  state.gifts.push(c);w.processed.push(sourceReceipt(a.receiptId));localEvent(w,c,r,`${r.name}向${p.name}提出赠送${a.quantity}份自有${itemLabels[a.item]}，固定截止${c.expiresAt}分钟；不扣货、不预留，对方须独立接受，之后送出者另选亲自交付。`,`personal-food-gift/offer@${proofVersion(c)}`);return null;
 }
 const c=gifts(w).find(c=>c.id===a.giftId)!;
 if(a.operation==='accept'){
  c.status='accepted';c.acceptedAt=w.minute;c.location=loc(w,r);localEvent(w,c,r,`${r.name}独立接受${c.quantity}份${itemLabels[c.item]}原赠粮，原截止不变；约在本人当前实际位置交付，不自动进食。`,`personal-food-gift/accept@${proofVersion(c)}`);return null;
 }
 const p=person(w,c.recipientId)!;routeFood(w,'person:'+r.id,'person:'+p.id,{[c.item]:c.quantity});r.inventory[c.item]=(r.inventory[c.item]??0)-c.quantity;p.inventory[c.item]=(p.inventory[c.item]??0)+c.quantity;
 c.status='delivered';c.endedAt=w.minute;w.processed.push(deliveryReceipt(c.id));localEvent(w,c,r,`${r.name}实际当面交付${c.quantity}份${itemLabels[c.item]}给${p.name}，原实物批次和腐败期限随所有权转移；未喂食、未增加健康，接收者须另选进食。`);return null;
 });}
export function advancePersonalFoodGifts(w:World){
 initializePersonalFoodGifts(w);
 for(const c of gifts(w))if(['offered','accepted'].includes(c.status)){
  const invalid=!valid(w,c),expired=w.minute>=c.expiresAt;
  if(!invalid&&!expired)continue;c.status=expired?'expired':'invalid';c.endedAt=w.minute;c.reason=expired?'原固定期限已到':'原记录不完整';
  c.eventIds??=[];c.eventIds.push(emitLedgerEvent(w,{kind:'trade',actors:[],place:point(c.location?.at)?{...c.location.at}:{...w.map.entrance},text:`个人赠粮${c.id}已结束，未交付任何食物；不向远方居民递送现场消息。`}).id);
 }
}
export function personalFoodGiftOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!capable(w,r))return [];
 const out:FormalOpportunity[]=[],add=(id:string,label:string,action:PersonalFoodGiftAction)=>out.push({id:'personalFoodGift.'+id,label,action});
 for(const c of gifts(w)){
  if(!valid(w,c)||!statusKnown(c,r)||w.minute>=c.expiresAt)continue;
  const giver=c.giverId===r.id,recipient=c.recipientId===r.id;if(!giver&&!recipient||!partyEligible(w,c,r,giver))continue;
  add('stop.'+c.id,`立即${giver?'撤回本人提出':'拒绝或撤回本人接受'}的${c.quantity}份${itemLabels[c.item]}赠粮；原截止${c.expiresAt}，不需对方同意`,{type:'personalFoodGift',operation:giver?'cancel':'decline',giftId:c.id});
  if(giver&&c.knownStatus[r.id]==='accepted'&&!carried(w,r))add('deliver.'+c.id,`本人带${c.quantity}份自有${itemLabels[c.item]}走到已约位置(${c.location.at.x},${c.location.at.y})尝试近身交付；原截止${c.expiresAt}，远方情况未知，不追踪、不自动喂食`,{type:'personalFoodGift',operation:'deliver',giftId:c.id});
  const accept:PersonalFoodGiftAction={type:'personalFoodGift',operation:'accept',giftId:c.id};
  if(recipient&&!personalFoodGiftReason(w,r,accept))add('accept.'+c.id,`本人独立接受原${c.quantity}份${itemLabels[c.item]}赠粮，截止${c.expiresAt}不变；尚未收货，不自动进食`,accept);
 }
 for(const p of w.residents){
  if(p.id===r.id||!capable(w,r,13)||!capable(w,p)||!near(w,r,p))continue;
  for(const item of itemKeys.filter(i=>goods[i].food>0&&stock(r,i,1))){const ageTerms=offerTerms(w,r,p),a:PersonalFoodGiftAction={type:'personalFoodGift',operation:'offer',recipientId:p.id,item,quantity:1,receiptId:personalFoodGiftReceiptId(w,r),ageTerms};if(!personalFoodGiftReason(w,r,a))add('offer.'+p.id+'.'+item,`向在场${p.name}提出赠送本人携带的${itemLabels[item]}（${ageTerms.maxQuantity===1?'涉及未成年，quantity限1份':'quantity可填1–3，默认1'}），120分钟固定期限；不扣货，对方另行接受，之后本人另选实际交付`,a);}
 }
 return out;
}
