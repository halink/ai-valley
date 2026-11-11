import type {Resident,World,Vec} from '../shared/types.js';
import type {LastWish,LastWishAction} from '../shared/last-wishes.js';
import {ageYears} from './time.js';
import {canObserve,deathProof} from './knowledge.js';
import {coLocated} from './proximity.js';
import {distance,same} from './navigation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {estateHeirs} from './production.js';
import {hasEstateDebt} from './debt.js';
import {pendingEstateReturns} from './estate-pending.js';
import {moveCoins} from './economy.js';
const person=(w:World,id?:string|null)=>w.residents.find(p=>p.id===id);
const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&canObserve(w,r)&&ageYears(r.bornAt,w.minute)>=18;
const record=(w:World,id?:string)=>w.lastWishes?.records.find(c=>c.id===id);
const registry=(w:World,id:string)=>w.buildings.find(b=>b.id===id&&b.kind==='lodge'&&b.ownerId==='commons'&&b.condition>0);
const atRegistry=(w:World,r:Resident,id:string)=>{const b=registry(w,id);return !!b&&!r.inside&&same(r.at,b.door);};
export function initializeLastWishes(w:World){if(w.mode==='formal')w.lastWishes??={records:[],nextSerial:1};}
export function activeLastWish(w:World,id:string){return w.lastWishes?.records.find(c=>c.personId===id&&c.status==='active');}
export function knownLastWish(w:World,r:Resident,id:string){const c=activeLastWish(w,id);return c&&Object.hasOwn(c.readers,r.id)?c:undefined;}
function fact(w:World,r:Resident,c:LastWish,text:string,ids=[r.id]){const e=emitEvent(w,{kind:'action',actors:ids,place:{...r.at},witnesses:ids,text});c.eventIds.push(e.id);return e;}
export function giftBlocker(w:World,c:LastWish):string|null {
 const estate=w.estates.find(e=>e.personId===c.personId);
 if(!estate||estate.status!=='protected'||w.production?.inheritances[c.personId])return '原继承份额已登记或不存在未分配遗产';
 const pending=pendingEstateReturns(w,c.personId);if(pending)return pending;
 if(hasEstateDebt(w,c.personId))return '原债务尚未清算，遗赠不能优先领取';
 const heirs=estateHeirs(w,c.personId);
 if(heirs.some(id=>id.startsWith('unborn:')||!person(w,id)||ageYears(person(w,id)!.bornAt,w.minute)<18))return '存在未出生或未成年受保护继承人，本次现金遗赠不能执行';
 if(heirs.some(id=>{const p=person(w,id)!;return !p.canDecide||!p.canExpress||!Object.hasOwn(c.approvals,id);}))return '每位当前有权继承的成年人须先独立查阅并同意，不能代签或减损其原份额';
 if(Math.min(c.amount,Math.floor(estate.coins/4))<1)return '清算后的实际现金不足，不能凭空补足遗赠';
 return null;
}
export function lastWishReason(w:World,r:Resident,a:LastWishAction):string|null {
 if(!w.lastWishes||!capable(w,r))return '须由有当前决定与表达能力的成年人亲自办理';
 if(a.operation==='declare'){
  const b=registry(w,a.buildingId??''),witness=person(w,a.witnessId);
  if(!b||!r.knownBuildings.includes(b.id))return '须选择已知的实际公共会馆登记处';
  if(w.lastWishes.records.some(c=>c.personId===r.id&&c.status==='draft'&&c.expiresAt>w.minute))return '已有尚待独立见证的草案，请先撤回或等其失效';
  if(!witness||witness.id===r.id||witness.id===a.beneficiaryId||!capable(w,witness)||!coLocated(w,r,witness,2))return '需要身边另一位有能力的成年见证人，且不能是受赠人';
  if(!Number.isSafeInteger(a.amount)||a.amount!<0||a.amount!>200||typeof a.text!=='string'||!a.text.trim()||a.text.length>80)return '现金上限须为0–200整数，墓志须由本人填写1–80字';
  if(a.amount!>0&&(!a.beneficiaryId||!person(w,a.beneficiaryId)||a.beneficiaryId===r.id||!r.knownPeople.includes(a.beneficiaryId)))return '现金遗赠只能写给本人已认识的另一位居民';
  if(a.amount===0&&a.beneficiaryId)return '仅安葬意愿不指定现金受赠人';
  if(a.graveId){const g=w.graves.find(g=>g.id===a.graveId);if(!g||r.inside||distance(r.at,g.at)>12)return '指定墓位须本人实际在附近观察，不能凭名字取得远方墓位知识';}
  return null;
 }
 const c=record(w,a.wishId);if(!c)return '没有本人可办理的这份意愿文书';
 if(a.operation==='revoke')return c.personId===r.id&&['draft','active'].includes(c.status)?null:'只能在本人在世时撤回自己的当前草案或意愿';
 if(a.operation==='witness'||a.operation==='declineWitness'){
  if(c.witnessId!==r.id||c.status!=='draft'||c.expiresAt<=w.minute)return '没有仍有效且交给本人的见证邀请';
  if(a.operation==='declineWitness')return null;
  const owner=person(w,c.personId);return owner&&capable(w,owner)&&atRegistry(w,owner,c.buildingId)&&coLocated(w,r,owner,2)?null:'立愿人须仍在原登记处清醒在场且有决定与表达能力';
 }
 if(c.status!=='active'||person(w,c.personId)?.status!=='dead'||!deathProof(w,r,c.personId))return '须有本人的死亡证据与生前有效文书；听说或内部状态不构成证据';
 if(a.operation==='refuseGift'||a.operation==='declineGift'){
  if(!Object.hasOwn(c.readers,r.id)||!c.amount||c.stops?.[r.id]!==undefined)return '本人尚未查阅或已经作出本人的停止决定';
  return a.operation==='declineGift'?c.beneficiaryId===r.id?null:'只能拒绝指定给本人的遗赠':c.readHeirs?.[r.id]?.includes(r.id)?null:'本人没有亲自查阅到的继承人身份';
 }
 if(!registry(w,c.buildingId)||!r.knownBuildings.includes(c.buildingId))return '原公共登记处目前不可使用或本人尚不知其地址';
 if(a.operation==='read')return null;
 if(!Object.hasOwn(c.readers,r.id))return '须先亲自查阅这份文书，见证不等于死后已查阅';
 if(c.amount===0||c.gift.status!=='pending')return '没有尚待本次处理的现金遗赠';
 if(a.operation==='approveGift'){
  if(!estateHeirs(w,c.personId).includes(r.id)||w.production?.inheritances[c.personId])return '本人不是当前尚未分配的法定继承人';
  if(a.operation==='approveGift'&&Object.hasOwn(c.approvals,r.id))return '本人已同意，仍可另行反对';
  return null;
 }
 if(c.beneficiaryId!==r.id)return '只有文书指定受赠人可以自行接受或拒绝';
 return a.operation==='acceptGift'?giftBlocker(w,c):'没有这项文书行动';
}
export function lastWishTarget(w:World,r:Resident,a:LastWishAction):{target:Vec;duration:number;error?:string}{
 if(['revoke','declineWitness','refuseGift','declineGift'].includes(a.operation)){const error=lastWishReason(w,r,a);return {target:{...r.at},duration:0,...(error?{error}:{})};}
 // A previously read document is an address and terms, not a live estate feed.
 const c=record(w,a.wishId),b=w.buildings.find(b=>b.id===c?.buildingId);
 if(['read','approveGift','refuseGift','acceptGift','declineGift'].includes(a.operation)&&c&&b&&capable(w,r)&&r.knownBuildings.includes(b.id)&&!!deathProof(w,r,c.personId)&&(a.operation==='read'||Object.hasOwn(c.readers,r.id)))return {target:{...b.door},duration:10};
 const error=lastWishReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 if(a.operation==='revoke'||a.operation==='declineWitness')return {target:{...r.at},duration:1};
 return {target:{...registry(w,a.operation==='declare'?a.buildingId!:record(w,a.wishId)!.buildingId)!.door},duration:a.operation==='declare'?15:10};
}
export function completeLastWish(w:World,r:Resident,a:LastWishAction):string|null {
 const error=lastWishReason(w,r,a);if(error)return error;
 if(a.operation==='declare'){
  if(!atRegistry(w,r,a.buildingId!))return '须本人实际到达所选会馆登记处';
  const witness=person(w,a.witnessId)!;if(!atRegistry(w,witness,a.buildingId!))return '见证人须亲自在同一登记处';
  const c:LastWish={id:'last-wish:'+w.lastWishes!.nextSerial++,personId:r.id,witnessId:witness.id,buildingId:a.buildingId!,beneficiaryId:a.amount?a.beneficiaryId!:null,amount:a.amount!,graveId:a.graveId??null,epitaph:a.text!.trim(),createdAt:w.minute,expiresAt:w.minute+60,signedAt:null,status:'draft',readers:{},readHeirs:{},knownGiftStatus:{},approvals:{},eventIds:[],gift:{status:a.amount?'pending':'unfulfilled',amount:0,at:null,reason:a.amount?null:'本人未提出现金遗赠'}};
  w.lastWishes!.records.push(c);fact(w,r,c,`${r.name}亲自写下身后意愿，现金最多${c.amount}钱且不超过清算现金四分之一，须保护债务和所有继承人的独立权利；希望在${c.graveId?'墓位'+c.graveId:'实际空墓位'}安葬，墓志：“${c.epitaph}”。邀请${witness.name}独立见证，尚未生效，未指定执行人或预留财物墓位。`,[r.id,witness.id]);return null;
 }
 const c=record(w,a.wishId)!;
 if(a.operation==='refuseGift'||a.operation==='declineGift'){
  (c.stops??={})[r.id]=w.minute;(c.knownGiftStatus??={})[r.id]='declined';
  if(c.gift.status==='pending'&&(a.operation==='declineGift'||estateHeirs(w,c.personId).includes(r.id)))c.gift={status:'declined',amount:0,at:w.minute,reason:a.operation==='refuseGift'?'一位有权继承人明确反对':'指定受赠人自行拒绝'};
  fact(w,r,c,`${r.name}亲自停止同意或接受这份现金遗赠，不等待到场；不撤销此前已完成的交付，也不据此获知远方结算。安葬意愿独立保留。`);return null;
 }
 if(a.operation==='revoke'||a.operation==='declineWitness'){
  c.status=a.operation==='revoke'?'revoked':'declined';fact(w,r,c,`${r.name}亲自${a.operation==='revoke'?'撤回自己的身后意愿':'拒绝本次见证邀请'}；未发生财产或墓位交付。`);return null;
 }
 if(!atRegistry(w,r,c.buildingId))return '须本人亲自到达原文书登记处';
 if(a.operation==='witness'){
  for(const prior of w.lastWishes!.records)if(prior.personId===c.personId&&prior.status==='active')prior.status='superseded';
  c.status='active';c.signedAt=w.minute;fact(w,r,c,`${r.name}在立愿人本人仍有能力并在场时独立见证了这份具体意愿；不接受执行义务，不获得钱款、监护或决定他人行动的权限。`,[r.id,c.personId]);return null;
 }
 if(a.operation==='read'){
  c.readers[r.id]=w.minute;(c.readHeirs??={})[r.id]=estateHeirs(w,c.personId);(c.knownGiftStatus??={})[r.id]=c.gift.status;fact(w,r,c,`${r.name}亲自查阅${person(w,c.personId)!.name}生前签署的文书：${c.beneficiaryId?'给'+(person(w,c.beneficiaryId)?.name??c.beneficiaryId)+'现金最多'+c.amount+'钱':'无现金遗赠'}，仍须清算与每位继承人独立同意；${c.graveId?'希望使用墓位'+c.graveId:'希望使用实际可用空墓位'}；墓志：“${c.epitaph}”。本次查阅现金状态为${c.gift.status}，不自动告知其他居民。`);return null;
 }
 if(a.operation==='approveGift'){
  c.approvals[r.id]=w.minute;fact(w,r,c,`${r.name}作为当前继承人独立同意这份现金遗赠的上限；其他继承人仍须自行决定，实际交付前可反对。`);return null;
 }

 const estate=w.estates.find(e=>e.personId===c.personId)!,amount=Math.min(c.amount,Math.floor(estate.coins/4));
 if(!moveCoins(w,'estate:'+c.personId,'resident:'+r.id,amount,'本人接受有限现金遗赠','last-wish:'+c.id))return '本次遗赠钱款尚未实际交付';
 (c.knownGiftStatus??={})[r.id]='paid';c.gift={status:'paid',amount,at:w.minute,reason:amount<c.amount?'净遗产四分之一上限不足，部分履行':'已按本人接受与继承人独立同意交付'};
 fact(w,r,c,`${r.name}亲自接受并收到${amount}钱现金遗赠（原上限${c.amount}钱）；债务与待返还权益已核验，其他实物和产权不转移，不产生执行义务。`);return null;
}
/** An actual ordinary inheritance may proceed without waiting for a voluntary gift. */
export function closeUndistributedGift(w:World,id:string){const c=activeLastWish(w,id);if(!c||!c.amount||c.gift.status!=='pending')return;c.gift={status:'unfulfilled',amount:0,at:w.minute,reason:giftBlocker(w,c)??'原继承份额先行登记，未接受的自愿遗赠不扣留家属财产'};const p=person(w,id)!;const e=emitLedgerEvent(w,{kind:'action',actors:[id],place:{...p.at},text:`${p.name}的现金遗赠未履行：${c.gift.reason}。按原继承规则保全，不自动通知任何居民。`});c.eventIds.push(e.id);}
export function advanceLastWishes(w:World){initializeLastWishes(w);for(const c of w.lastWishes?.records??[])if(c.status==='draft'&&(c.expiresAt<=w.minute||person(w,c.personId)?.status!=='alive'))c.status='expired';}
export function burialWishReason(w:World,r:Resident,personId:string,wishId?:string):string|null {if(!wishId)return null;const c=knownLastWish(w,r,personId);return c?.id===wishId?null:'本人尚未实际查阅逝者这份有效的安葬意愿';}
export function recordWishBurial(w:World,r:Resident,personId:string,graveId:string,wishId?:string){
 const c=activeLastWish(w,personId);if(!c||c.burial)return;
 const followed=wishId===c.id&&(!c.graveId||c.graveId===graveId),g=w.graves.find(g=>g.id===graveId)!;
 if(followed)g.epitaph=c.epitaph;
 c.burial={at:w.minute,actorId:r.id,graveId,followed,reason:followed?'自愿搬运并实际使用可用墓位，写下原墓志':'完成普通安葬，未按该文书执行；不推定办理人知晓意愿'};
 const e=emitLedgerEvent(w,{kind:'burial',actors:[r.id,personId],place:{...r.at},text:`安葬意愿核对：${c.burial.reason}。`});c.eventIds.push(e.id);
}
