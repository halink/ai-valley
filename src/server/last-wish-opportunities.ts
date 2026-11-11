import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {LastWishAction} from '../shared/last-wishes.js';
import {lastWishReason,knownLastWish} from '../world/last-wishes.js';
import {deathProof} from '../world/knowledge.js';
import {coLocated} from '../world/proximity.js';
import {distance} from '../world/navigation.js';
export function lastWishOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const out:FormalOpportunity[]=[];
 const add=(id:string,label:string,action:LastWishAction)=>{if(!lastWishReason(w,r,action))out.push({id:'lastWish.'+id,label,action});};
 // Drafts disclose only personally known beneficiaries, not their distant live status or wealth.
 const rotate=<T>(rows:T[],limit:number)=>{const offset=Math.floor(w.minute/30)%Math.max(1,rows.length);return Array.from({length:Math.min(rows.length,limit)},(_,i)=>rows[(offset+i)%rows.length]);};
 const nearby=w.residents.filter(p=>p.id!==r.id&&coLocated(w,r,p,2));
 for(const b of w.buildings.filter(b=>b.kind==='lodge'&&b.ownerId==='commons'&&r.knownBuildings.includes(b.id)&&!r.inside&&distance(r.at,b.door)<=8).slice(0,1)){
  const witness=rotate(nearby,nearby.length).find(p=>!lastWishReason(w,r,{type:'lastWish',operation:'declare',buildingId:b.id,witnessId:p.id,amount:0,text:'记得共同生活的日子'}));
  if(witness){
   add('declare.burial.'+b.id,`亲自去${b.name}写下安葬意愿，请${witness.name}独立见证；填写text墓志1–80字，不指定执行人、不预占空墓位`,{type:'lastWish',operation:'declare',buildingId:b.id,witnessId:witness.id,amount:0,text:'记得共同生活的日子'});
   for(const id of rotate(r.knownPeople.filter(id=>id!==r.id&&id!==witness.id),4)){
    const name=w.residents.find(p=>p.id===id)?.name??'已认识的居民';
    add('declare.gift.'+b.id+'.'+id,`亲自写给${name}的有限现金遗赠与安葬意愿，请${witness.name}另行见证。填写amount（1–200钱上限）及text（1–80字墓志）；只从清算现金至多四分之一交付，所有成年继承人另行同意，受保护未成年份额优先`,{type:'lastWish',operation:'declare',buildingId:b.id,witnessId:witness.id,beneficiaryId:id,amount:1,text:'记得共同生活的日子'});
   }
   for(const g of rotate(w.graves.filter(g=>distance(r.at,g.at)<=12),2))add('declare.grave.'+g.id,`在${b.name}写下本人见到的墓位（${g.at.x},${g.at.y}）偏好，请${witness.name}独立见证；填写text墓志，不预留、不保证今后仍空闲`,{type:'lastWish',operation:'declare',buildingId:b.id,witnessId:witness.id,amount:0,graveId:g.id,text:'记得共同生活的日子'});
  }
 }
 for(const c of w.lastWishes?.records??[]){
  if(c.personId===r.id)add('revoke.'+c.id,'撤回本人的这份身后意愿，保留原记录，不转移任何财产',{type:'lastWish',operation:'revoke',wishId:c.id});
  if(c.witnessId===r.id){
   add('witness.'+c.id,`亲自在立愿人仍有能力并在场时见证原文书：最多${c.amount}钱${c.beneficiaryId?'给'+(w.residents.find(p=>p.id===c.beneficiaryId)?.name??'指定居民'):''}；${c.graveId?'希望使用墓位'+c.graveId:'希望使用真实空墓位'}，墓志“${c.epitaph}”。不接受执行义务`,{type:'lastWish',operation:'witness',wishId:c.id});
   add('declineWitness.'+c.id,'拒绝本次见证邀请，不影响本人的其他承诺',{type:'lastWish',operation:'declineWitness',wishId:c.id});
  }
  const b=w.buildings.find(b=>b.id===c.buildingId);
  // No remote catalog of private wills, deaths, money or consent state.
  if(!deathProof(w,r,c.personId))continue;
  const near=!!b&&!r.inside&&distance(r.at,b.door)<=8;
  if(near)add('read.'+c.id,'亲自查阅本处已获知死亡者生前签署的身后意愿；不等于接受遗赠或承担安葬义务',{type:'lastWish',operation:'read',wishId:c.id});
  if(!Object.hasOwn(c.readers,r.id))continue;
  // Choices use the last personally read snapshot, not live distant heirs or balances.
  // An attempt may fail at the registry; rereading is the explicit way to learn a changed outcome.
  if(!c.amount||(c.knownGiftStatus?.[r.id]??'pending')!=='pending')continue;
  const offer=(op:LastWishAction['operation'],label:string)=>out.push({id:'lastWish.'+op+'.'+c.id,label,action:{type:'lastWish',operation:op,wishId:c.id}});
  const terms=`给${w.residents.find(p=>p.id===c.beneficiaryId)?.name??'原指定居民'}最多${c.amount}钱、且不超过清算净现金四分之一`;
  if(c.readHeirs?.[r.id]?.includes(r.id)){
   if(near&&!Object.hasOwn(c.approvals,r.id))offer('approveGift',`按本人上次查阅的身份，尝试独立同意${terms}；须到场核验当前继承权，交付前可反对`);
   offer('refuseGift',`作为本人上次查阅的继承人，立即反对${terms}的遗赠，保留原权益；安葬意愿独立保留`);
  }
  if(c.beneficiaryId===r.id){
   if(near)offer('acceptGift',`自行到登记处尝试接受${terms}的遗赠；重查债务、待返还权益、保护份额及每位继承人同意，可能无法履行，不接受执行义务`);
   offer('declineGift','立即拒绝今后的现金遗赠，不产生义务，不追溯已完成的交付');
  }
 }
 for(const p of w.residents){const c=knownLastWish(w,r,p.id);if(!c||!deathProof(w,r,p.id)||p.status!=='dead'||w.graves.some(g=>g.personId===p.id))continue;
  out.push({id:'lastWish.ordinaryBurial.'+c.id,label:`本人另行决定为${p.name}按普通流程搬运安葬，尝试寻找实际可达空墓位；不采用已读文书的指定墓位或墓志`,action:{type:'bury',targetId:p.id}});
  out.push({id:'lastWish.bury.'+c.id,label:`本人自愿尝试按${p.name}的原文书搬运安葬${c.graveId?'至其指定实际墓位':''}并刻写墓志“${c.epitaph}”；无空位或断路则失败，不自动改选`,action:{type:'bury',targetId:p.id,wishId:c.id}});
 }
 return out;
}
