import {deathProof} from './knowledge.js';
import {coLocated} from './proximity.js';
import {foodTransaction} from './food.js';
import type {Action, Proposal, Resident, World, WorldEvent} from '../shared/types.js';
import {emitEvent} from './events.js';
import {DAY, ageYears} from './time.js';
import {finishFamilyAction,homeMoveAllowed} from './family.js';
import {canDepart, recordDeparture} from './migration.js';

export interface SocialResult {handled:boolean;ok:boolean;error?:string;}
const fail=(error:string):SocialResult=>({handled:true,ok:false,error});
const done=():SocialResult=>({handled:true,ok:true});
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const present=(w:World,a:Resident,b:Resident)=>coLocated(w,a,b);
const competent=(a:Resident)=>a.status==='alive'&&a.canDecide&&a.canExpress;
const adult=(w:World,a:Resident)=>ageYears(a.bornAt,w.minute)>=18;
function related(w:World,a:Resident,b:Resident){
 const ancestry=(person:Resident)=>{const found=new Set<string>(),pending=[...person.parents,...(person.adoptiveParents??[])];while(pending.length){const id=pending.pop()!;if(found.has(id))continue;found.add(id);const parent=w.residents.find(p=>p.id===id);pending.push(...(parent?.parents??[]),...(parent?.adoptiveParents??[]));}return found;};
 return ancestry(a).has(b.id)||ancestry(b).has(a.id)||a.parents.some(id=>b.parents.includes(id))||a.relations.some(r=>r.targetId===b.id&&(r.kin||r.adoptive));
}
function relation(a:Resident,b:Resident){let r=a.relations.find(r=>r.targetId===b.id);if(!r){r={targetId:b.id,affection:0,trust:0,conflict:0,evidence:[]};a.relations.push(r);}return r;}
function tell(w:World,a:Resident,b:Resident,text:string,kind:WorldEvent['kind']='relationship',populationChange?:WorldEvent['populationChange']){
 return emitEvent(w,{kind,populationChange,actors:[a.id,b.id],place:{...a.at},text,witnesses:[a.id,b.id]});
}
function liveProposal(w:World,p:Proposal){return p.status==='open'&&p.expiresAt>w.minute;}
export function eligiblePair(w:World,a:Resident,b:Resident):string|null {
 if(a.id===b.id)return '不能向自己提出双方约定';
 if(!competent(a)||!competent(b))return '双方须具备当前决定与表达能力';
 if(!adult(w,a)||!adult(w,b))return '亲密关系与生育提议仅向成年人开放';
 if(related(w,a,b))return '近亲关系不适用婚恋与生育约定';
 return null;
}

/** The authority is narrow: one basic-care step using the volunteer's own supplies. */
export function careAuthority(w:World,actor:Resident,target:Resident):{allowed:boolean;basis?:'consent'|'guardian'|'emergency';reason?:string;evidence?:string} {
 if(!competent(actor)||actor.id===target.id||target.status!=='alive'||!present(w,actor,target))return {allowed:false,reason:'施救者须有能力并实际到场'};
 if(target.refusesCare)return {allowed:false,reason:'当前照护存在明确拒绝'};
 const agreed=w.proposals.find(p=>p.kind==='care'&&p.actorId===actor.id&&p.targetId===target.id&&p.status==='accepted'&&p.expiresAt>w.minute);
 if(agreed)return {allowed:true,basis:'consent',evidence:agreed.id};
 if(ageYears(target.bornAt,w.minute)<6&&target.guardianIds.includes(actor.id))return {allowed:true,basis:'guardian',evidence:`guardian:${actor.id}:${target.id}`};
 // Speaking or waking alone does not restore full decision-and-expression capacity.
 if(target.canDecide&&target.canExpress)return {allowed:false,reason:'本人有完整决定能力，须先获得照护同意'};
 if(target.health>20)return {allowed:false,reason:'不符合紧急照护窗口'};
 const timelyProxy=target.guardianIds.some(id=>{const g=w.residents.find(p=>p.id===id);return g&&competent(g)&&present(w,g,target);});
 if(timelyProxy)return {allowed:false,reason:'有可及时决定的代理，应使用普通授权'};
 return {allowed:true,basis:'emergency',evidence:`observed:${actor.id}:${target.id}:${w.minute}:health=${target.health}:decide=${target.canDecide}:express=${target.canExpress}`};
}

/** Backup promises cannot observe a global status bit. This evaluates a delivered observation only. */
export interface CareTrigger {
 observerId:string;acceptedAt:number;scope:string[];
 condition:{kind:'observed-need'|'delivered-notice'|'missed-handoff';subjectId:string;notBefore:number};
}
export interface CareEvidence {
 eventId:string;observerId:string;subjectId:string;receivedAt:number;
 kind:'observed-need'|'delivered-notice'|'missed-handoff'|'internal-death';source:'witness'|'heard'|'internal';
 scope:string[];
}
export function canActivateCareBranch(promise:CareTrigger,evidence:CareEvidence,now:number):boolean {
 return evidence.kind!=='internal-death'&&evidence.source!=='internal'
  &&promise.observerId===evidence.observerId&&promise.condition.subjectId===evidence.subjectId
  &&promise.condition.kind===evidence.kind&&evidence.receivedAt>=promise.acceptedAt
  &&evidence.receivedAt>=promise.condition.notBefore&&evidence.receivedAt<=now
  &&evidence.scope.length>0&&evidence.scope.every(s=>promise.scope.includes(s))
  &&(evidence.kind==='delivered-notice'||evidence.source==='witness');
}

/** Called after travel and work, while actor.activity still exists. Revalidates all current conditions. */
function executeSocialActionAtomic(w:World,actor:Resident,action:Action):SocialResult {
 if(action.type==='tendChild'||action.type==='fosterChild'||action.type==='familyConsent'||action.type==='inviteHome'||action.type==='homeReply'){
  const result=finishFamilyAction(w,actor,action);return {handled:true,...result};
 }

 const handled=['care','learn','propose','respond','separate','bury','leave','settle','lodge'].includes(action.type);
 if(!handled)return {handled:false,ok:false};
 if(actor.status!=='alive'||actor.residency==='outside')return fail('人物已不在此处行动');
 if(!competent(actor))return fail('人物当前缺少相应决定或表达能力');
 if(action.type==='learn')return fail('教学需要教师接受具体教学承诺；样章尚未开放此约定');
 if(action.type==='leave'){
  if(distance(actor.at,w.map.entrance)>1||actor.inside)return fail('须实际走到山谷出口');
  const blocked=canDepart(w,actor);
  if(blocked)return fail(blocked);
  const settled=actor.residency==='resident';
  recordDeparture(w,actor);
  actor.residency='outside';actor.inside=null;actor.intention='已经离开山谷';actor.revision++;
  const event=emitEvent(w,{kind:'departure',populationChange:settled?'depart':'endVisit',actors:[actor.id],place:{...actor.at},
   text:`${actor.name}${settled?'迁出':'结束访问，离开'}了山谷，往西岭驿去了。个人财产和亲缘仍有记录。`});
  // The person who crossed the gate knows their own departure even though the town census now excludes them.
  if(!event.witnesses.includes(actor.id))event.witnesses.push(actor.id);
  actor.memories.push({eventId:event.id,receivedAt:w.minute,source:'self',text:event.text});
  if(actor.memories.length>80)actor.memories.shift();
  return done();
 }
 if(action.type==='settle'||action.type==='lodge'){
  const b=w.buildings.find(b=>b.id===action.buildingId);
  if(!b||b.condition<=0||distance(actor.at,b.door)>2||actor.inside)return fail('须到达可居住建筑门口');
  if(!['home','lodge'].includes(b.kind))return fail('这里没有登记居住用途');
  if(b.ownerId!=='commons'&&b.ownerId!==actor.id)return fail('尚无房主的入住许可');
  const temporary=action.type==='lodge';
  if(temporary&&(actor.residency!=='visitor'||b.kind!=='lodge'||b.ownerId!=='commons'))return fail('短住须由访客到公共会馆自愿办理');
  const alreadyHere=actor.homeId===b.id&&b.residents.includes(actor.id);
  if(alreadyHere&&(temporary||actor.residency==='resident'))return done();
  if(!alreadyHere&&b.residents.length>=b.capacity)return fail('住所已满，不能凭空增加床位');
  if(w.mode==='formal'&&!homeMoveAllowed(w,actor,b.id))return fail('原住所的未成年子女仍需要留下的在地监护人');
  const oldResidency=actor.residency;
  if(actor.homeId&&actor.homeId!==b.id){const previous=w.buildings.find(p=>p.id===actor.homeId);if(previous)previous.residents=previous.residents.filter(id=>id!==actor.id);}
  actor.homeId=b.id;
  if(!temporary)actor.residency='resident';
  if(!b.residents.includes(actor.id))b.residents.push(actor.id);
  actor.revision++;
  emitEvent(w,{kind:'arrival',...(!temporary?{populationChange:oldResidency==='resident'?'moveHome' as const:'settle' as const}:{}),
   actors:[actor.id],place:{...actor.at},text:temporary
    ?`${actor.name}在${b.name}借用了一张真实空床，作为访客短住。`
    :`${actor.name}自愿在${b.name}${oldResidency==='resident'?'换房居住':'登记为常住居民'}。`});
  return done();
 }
 if(action.type==='respond'){
  const p=w.proposals.find(p=>p.id===action.proposalId);
  if(!p||!liveProposal(w,p))return fail('提议不存在、已撤回或已经过期');
  if(p.actorId===actor.id&&!action.accept){
   p.status='declined';
   emitEvent(w,{kind:'relationship',actors:[actor.id],place:{...actor.at},text:`${actor.name}撤回了此前提出的${proposalNames[p.kind]}。`});
   return done();
  }
  if(p.targetId!==actor.id)return fail('只能回复向自己提出的约定');
  const other=w.residents.find(r=>r.id===p.actorId);
  if(!other||!competent(other)||!present(w,actor,other))return fail('双方须再次实际在场确认');
  if(!action.accept){p.status='declined';tell(w,actor,other,`${actor.name}拒绝了${other.name}提出的${proposalNames[p.kind]}。`);return done();}
  if(p.kind!=='care'){const error=eligiblePair(w,other,actor);if(error)return fail(error);}
  if(p.kind==='dating'||p.kind==='marriage'){
   if(p.kind==='marriage'&&(relation(actor,other).partner!=='dating'||relation(other,actor).partner!=='dating'))return fail('婚姻提议须基于双方当前接受的交往关系');
   if([actor,other].some(person=>person.relations.some(r=>r.partner&&r.targetId!== (person===actor?other.id:actor.id))))return fail('现有伴侣关系须先明确处理');
   relation(actor,other).partner=p.kind==='marriage'?'married':'dating';relation(other,actor).partner=p.kind==='marriage'?'married':'dating';
  }
  if(p.kind==='child'){
   // The proposer explicitly offers to carry the pregnancy; accepting is the other parent's separate choice.
   if(other.pregnancy||actor.pregnancy)return fail('已有进行中的孕育安排');
   if(other.health<65||actor.health<65)return fail('当前身体条件不支持开始孕育');
   const home=w.buildings.find(b=>b.id===other.homeId);
   if(!home||home.residents.length>=home.capacity)return fail('尚无可用的初期居住空间');
   const definition=w.activeDefinitions['life/basic']??'life/basic@1';
   const duration=Number(w.definitions[definition]?.data.gestationMinutes??Number(w.definitions[definition]?.data.gestationDays??84)*DAY);
   other.pregnancy={otherParentId:actor.id,conceivedAt:w.minute,dueAt:w.minute+duration,definition};
  }
  p.status='accepted';
  const event=tell(w,actor,other,`${actor.name}与${other.name}分别确认了${proposalNames[p.kind]}${p.kind==='child'?'，由提议者孕育，双方承担初期照护':''}。`,p.kind==='care'?'care':'relationship',p.kind==='dating'?'dating':p.kind==='marriage'?'marriage':undefined);
  for(const [a,b] of [[actor,other],[other,actor]]){const r=relation(a,b);r.evidence.push(event.id);}
  return done();
 }
 const target='targetId'in action?w.residents.find(r=>r.id===action.targetId):undefined;
 if(!target||target.id===actor.id)return fail('对象不存在或不能指向自己');
 if(action.type==='bury'){
  if(target.status!=='dead')return fail('没有实际死亡事实，不能安葬');
  if(w.graves.some(g=>g.personId===target.id))return fail('此人已经安葬，不能重复占用墓位');
  const cargo=(actor.activity as typeof actor.activity & {cargo?:{bodyId:string;graveId:string;pickedUp:boolean}})?.cargo;
  const grave=cargo?w.graves.find(g=>g.id===cargo.graveId):undefined;
  if(!cargo?.pickedUp||cargo.bodyId!==target.id||!grave||grave.personId||target.body?.carriedBy!==actor.id||target.body.reservedBy!==actor.id||grave.reservedBy!==actor.id)return fail('需要实际运送遗体并拥有空墓位');
  if(distance(actor.at,grave.at)>1||distance(target.at,actor.at)>1||target.inside)return fail('遗体尚未实际运到墓位');
  const known=!!deathProof(w,actor,target.id);
  if(!known)return fail('尚未实际发现或核实死亡事实');
  grave.personId=target.id;grave.buriedAt=w.minute;grave.reservedBy=null;grave.condition=100;grave.lastMaintainedAt=w.minute;target.at={...grave.at};target.inside=null;target.roomAt=null;if(target.body){target.body.carriedBy=null;target.body.reservedBy=null;target.body.storedAt=null;}
  emitEvent(w,{kind:'burial',actors:[actor.id,target.id],place:{...actor.at},bodyLocation:{personId:target.id,at:{...target.at},roomId:null,roomAt:null},text:`${actor.name}将${target.name}安葬在墓园。身份、亲缘和生平继续保留。`});
  return done();
 }
 if(action.type==='separate'){
  const a=relation(actor,target),b=relation(target,actor);
  if(!a.partner&&!b.partner)return fail('没有需要结束的伴侣关系');
  delete a.partner;delete b.partner;
  for(const p of w.proposals)if(p.status==='open'&&p.kind!=='care'&&[p.actorId,p.targetId].includes(actor.id)&&[p.actorId,p.targetId].includes(target.id))p.status='expired';
  tell(w,actor,target,`${actor.name}结束了与${target.name}的伴侣关系。居住、个人财产、亲缘和已开始的孕育保持独立。`,'relationship','separate');
  return done();
 }
 if(target.status!=='alive'||!present(w,actor,target))return fail('对象须在世且实际在场');
 if(action.type==='care'){
  if(actor.skills.care<1)return fail('尚不具备基础照护能力');
  const authority=careAuthority(w,actor,target);
  if(!authority.allowed)return fail(authority.reason??'缺少照护权限');
  if((actor.inventory.water??0)<1||(actor.inventory.meal??0)<1)return fail('需要施救者自有的一份清水和餐食');
  if(target.health>=95&&target.hunger<=25)return fail('当前没有基本照护需求');
  actor.inventory.water!--;actor.inventory.meal!--;
  target.health=Math.min(100,target.health+8);target.hunger=Math.max(0,target.hunger-22);
  const used=w.proposals.find(p=>p.kind==='care'&&p.actorId===actor.id&&p.targetId===target.id&&p.status==='accepted'&&p.expiresAt>w.minute);
  if(used)used.status='expired';
  emitEvent(w,{kind:'care',actors:[actor.id,target.id],place:{...actor.at},witnesses:[actor.id,target.id],text:`${actor.name}用自己的餐食和清水照料了${target.name}。${authority.basis==='emergency'?'这是一次针对眼前危险的紧急帮助。':''}`,audit:{rule:'action/routine@1',authority:authority.basis!,evidence:authority.evidence!,scope:['basic-care'],resources:{meal:1,water:1},providerId:actor.id,termination:'完整决定与表达能力恢复、代理可及时决定、紧急情形消失或获知有效拒绝时终止；不产生债务或永久监护'}});
  return done();
 }
 if(action.type==='propose'){
  if(action.proposal!=='care'){const error=eligiblePair(w,actor,target);if(error)return fail(error);}
  if(!competent(target))return fail('当前无法获得本人对新约定的有效同意');
  if(w.proposals.some(p=>p.actorId===actor.id&&p.targetId===target.id&&p.kind===action.proposal&&liveProposal(w,p)))return fail('同类提议仍在等待回复');
  const id=`proposal:${w.id}:${w.minute}:${w.proposals.length}`;
  w.proposals.push({id,actorId:actor.id,targetId:target.id,kind:action.proposal,createdAt:w.minute,expiresAt:w.minute+DAY,status:'open',definition:actor.activity?.definition??'action/routine@1'});
  tell(w,actor,target,`${actor.name}向${target.name}提出${proposalNames[action.proposal]}${action.proposal==='child'?'，愿由自己孕育并共同承担初期照护':''}，正在等待对方决定。`);
  return done();
 }
 return fail('该社会行为尚未实现');
}
const proposalNames:Record<Proposal['kind'],string>={dating:'交往',marriage:'结婚',child:'共同育儿',care:'一次基础照护'};

export function executeSocialAction(w:World,actor:Resident,action:Action):SocialResult{return foodTransaction(w,()=>executeSocialActionAtomic(w,actor,action));}
