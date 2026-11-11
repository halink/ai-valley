import type {Building,FormalOpportunity,Resident,World} from '../shared/types.js';
import type {FamilyRelocation,FamilyRelocationAction,RelocationMember} from '../shared/family-relocation.js';
import {activeRelocation,travellingFamily} from '../shared/family-relocation.js';
import {leasedBed} from '../shared/commons.js';
import {roomLayout,roomPath,residentBed} from '../shared/rooms.js';
import {knownAgeYears,DAY} from './time.js';
import {prepareRoomExit} from './rooms.js';
import {socialSpace} from './relationships.js';
import {coLocated} from './proximity.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {movementRate} from './health.js';
import {passenger} from './medical-transport.js';
import {aboardFerry} from './ferry.js';
import {deathProof} from './knowledge.js';
import {emitEvent} from './events.js';
import {foodTransaction,foodValue} from './food.js';
import {familyJourneyMealInputs,recordFamilyJourneyMeal,type FamilyJourneyMealReceipt} from './food-consumption-evidence.js';

const person=(w:World,id:string)=>w.residents.find(r=>r.id===id);
const alive=(r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside';
const capable=(r:Resident|undefined):r is Resident=>alive(r)&&r.canDecide&&r.canExpress;
const adult=(w:World,r:Resident|undefined):r is Resident=>capable(r)&&(knownAgeYears(r.bornAt,w.minute)??-1)>=18;
const minor=(w:World,r:Resident)=>{const age=knownAgeYears(r.bornAt,w.minute);return age!==null&&age<18;};
const infant=(w:World,r:Resident)=>{const age=knownAgeYears(r.bornAt,w.minute);return age!==null&&age<6;};
const needsAssent=(w:World,r:Resident)=>(knownAgeYears(r.bornAt,w.minute)??-1)>=6;
// Keep actual supplemental signatures as independent-participation evidence,
// without rewriting the original infant terms. A later bad birth correction
// cannot downgrade that person to a proxy passenger.
const personalMember=(w:World,c:FamilyRelocation,m:RelocationMember,r:Resident)=>m.requiresAssent||needsAssent(w,r)||c.signatures.some(s=>s.personId===r.id);
// Unknown age proves neither infancy nor adulthood; ability flags do not replace age.
const proxyChild=(w:World,c:FamilyRelocation,m:RelocationMember,r:Resident)=>!personalMember(w,c,m,r)&&infant(w,r);
const agreement=(w:World,id:string)=>w.familyRelocation?.agreements.find(c=>c.id===id);
const open=(c:FamilyRelocation,w:World)=>c.status==='proposed'&&c.expiresAt>w.minute||activeRelocation(c,w);
const assents=(w:World,r:Resident)=>needsAssent(w,r)&&capable(r);
const signerIds=(w:World,c:FamilyRelocation)=>[...new Set([...c.requiredSignerIds,...c.members.filter(m=>{const p=person(w,m.personId);return p&&personalMember(w,c,m,p);}).map(m=>m.personId)])];
const fact=(w:World,c:FamilyRelocation,r:Resident,text:string)=>emitEvent(w,{kind:'relationship',actors:[r.id,...c.members.map(m=>m.personId).filter(id=>id!==r.id)],place:{...r.at},text});

export function initializeFamilyRelocation(w:World){
 if(w.mode!=='formal')return;
 w.familyRelocation??={version:1,nextSerial:1,agreements:[]};
 w.definitions['family/relocation@1']??={id:'family/relocation',version:1,kind:'action',dependencies:[],data:{scope:'镇内换房与已入谷访客家庭定居；镇外住房及接待另行实现',rationMinutes:120,arrivalReserve:1,consent:'房主、同行成年人、全部当前监护人和能够表达的孩子分别接受同一具体安排；收养登记不授予迁居同意',housing:'逐人实际抵达并登记后才释放原床；产权、亲缘和个人财产不转移'}};
}

/** Existing permanent beds are allocated first, including residents who never slept. */
function occupiedBeds(w:World,b:Building){
 const result=new Map<string,number>(),taken=new Set<number>(),assignments=w.rooms?.beds[b.id]??{};
 for(const id of b.residents){const bed=assignments[id];if(Number.isInteger(bed)&&bed>=0&&bed<b.capacity&&!taken.has(bed)){result.set(id,bed);taken.add(bed);}}
 for(const id of b.residents){if(result.has(id))continue;let bed=0;while(taken.has(bed)||leasedBed(w,b.id,bed,id))bed++;result.set(id,bed);taken.add(bed);}
 return result;
}
function bedAvailable(w:World,b:Building,bed:number,id:string){
 if(!Number.isSafeInteger(bed)||bed<0||bed>=b.capacity||leasedBed(w,b.id,bed,id))return false;
 if([...occupiedBeds(w,b)].some(([resident,n])=>resident!==id&&n===bed))return false;
 if(w.health?.transports.some(t=>t.phase==='carrying'&&t.buildingId===b.id&&t.bed===bed&&t.patientId!==id))return false;
 const slot=roomLayout(w,b).slots.find(s=>s.key==='bed:'+bed);if(!slot)return false;
 if(roomPath(roomLayout(w,b),roomLayout(w,b).entry,slot.at)===null)return false;
 if(w.rooms?.claims.some(c=>c.buildingId===b.id&&c.key===slot.key&&c.people.some(p=>p!==id)))return false;
 return !w.residents.some(p=>p.id!==id&&p.inside===b.id&&p.roomAt&&distance(p.roomAt,slot.at)<=1&&(p.status==='alive'||!p.body?.carriedBy&&!w.graves.some(g=>g.personId===p.id)));
}
function bedsFor(w:World,b:Building,people:Resident[]):number[]|null{
 const result:number[]=[],existing=occupiedBeds(w,b);
 for(const p of people){const own=existing.get(p.id),bed=own!==undefined?own:Array.from({length:b.capacity},(_,n)=>n).find(n=>!result.includes(n)&&bedAvailable(w,b,n,p.id));
  if(bed===undefined||result.includes(bed)||!bedAvailable(w,b,bed,p.id))return null;result.push(bed);
 }
 return result;
}
function guardians(w:World,proposer:Resident,child:Resident){return child.guardianIds.filter(id=>!deathProof(w,proposer,id));}
function unattended(w:World,ids:string[],destination:string){
 return w.residents.find(child=>alive(child)&&(minor(w,child)||knownAgeYears(child.bornAt,w.minute)===null)&&!ids.includes(child.id)&&child.homeId!==destination&&child.guardianIds.some(id=>ids.includes(id))&&!child.guardianIds.some(id=>!ids.includes(id)&&adult(w,person(w,id))&&person(w,id)!.homeId===child.homeId));
}
function authorityError(w:World,c:FamilyRelocation,requireSignatures=true,inspectDestination=true){
 if(inspectDestination&&c.revocations?.length)return '原约定的入住或照护同意已被当事人撤回，须重新商量';
 const b=w.buildings.find(b=>b.id===c.buildingId),proposer=person(w,c.proposerId);
 if(!adult(w,proposer)||inspectDestination&&(!b||!['home','lodge'].includes(b.kind)||b.condition<=0||b.ownerId!==c.ownerId||!same(b.door,c.destination)||!adult(w,person(w,c.ownerId))))return '房主、目的地或负责照护的成年人已经变化';
 for(const m of c.members){const p=person(w,m.personId);if(!alive(p))return '同行者已不在本地存活';
  if(knownAgeYears(p.bornAt,w.minute)===null)return '同行者年龄无法核实，不能推定幼儿豁免、成年身份或监护代理';
  if(m.arrivedAt===null&&(p.homeId!==m.previousHomeId||p.residency!==m.previousResidency))return '原住宿或居留登记已经改变，须重新商量';
  if(inspectDestination&&!bedAvailable(w,b!,m.bed,p.id))return '原定实际床位已被占用、损坏或不能到达';
  if(m.caregiverId){const g=person(w,m.caregiverId);
   if(!minor(w,p)||!adult(w,g)||!p.guardianIds.includes(g.id)||p.refusesCare||guardians(w,proposer,p).some(id=>!m.guardianIds.includes(id))||m.guardianIds.some(id=>!p.guardianIds.includes(id)))return '孩子的监护、年龄或当前照护意愿已经变化';
   if(personalMember(w,c,m,p)&&!capable(p))return '需要本人独立接受的同行者当前不能决定或表达，不能改由监护人代理';
   if(requireSignatures&&personalMember(w,c,m,p)&&!c.signatures.some(s=>s.personId===p.id))return '孩子已到独立答复年龄，需要本人接受原具体同住安排';
  }else if(!adult(w,p))return '同行成年人当前无法自主决定或继续行路';
 }
 if(unattended(w,c.members.map(m=>m.personId),c.buildingId))return '仍有未同行孩子缺少留在原处的合格监护人';
 return null;
}
function freshRations(w:World,provider:Resident,quantity:number,through:number){
 if((provider.inventory.meal??0)<quantity||(provider.inventory.water??0)<quantity)return false;
 const lots=w.food?.lots['person:'+provider.id]?.meal;
 return !lots||lots.filter(l=>l.expiresAt>through).reduce((n,l)=>n+l.quantity,0)>=quantity;
}
function suppliesError(w:World,c:FamilyRelocation,rations:number,through:number){
 const counts=new Map<string,number>();for(const m of c.members)counts.set(m.providerId,(counts.get(m.providerId)??0)+rations);
 for(const [id,count]of counts){const r=person(w,id);if(!alive(r)||!freshRations(w,r,count,through))return '签署的供给者实际携带的有效餐食或清水不足；不从其他人、公共库存或未来收入补足';}
 return null;
}
function consumeRation(w:World,c:FamilyRelocation,trigger:FamilyJourneyMealReceipt['trigger']){
 // Read each provider's original batch intervals before foodTransaction can
 // initialize/repair lots. The actual loop below retains its existing order.
 const portions=new Map<string,number>(),observed=c.members.map((m,memberIndex)=>{
  const provider=person(w,m.providerId)!,providerPortion=portions.get(provider.id)??0;portions.set(provider.id,providerPortion+1);
  const inputs=familyJourneyMealInputs(w,provider,providerPortion);
  return inputs?{action:'familyRelocation' as const,operation:'ration' as const,trigger,at:w.minute,
   relocationId:c.id,definition:c.definition,rationNumber:(c.journey?.rationsUsed??0)+1,memberIndex,memberCount:c.members.length,
   providerPortion,providerId:provider.id,beneficiaryId:m.personId,container:'person:'+provider.id,inputs,
   hungerBefore:0,hungerAfter:0,hungerRelief:0}:undefined;
 });
 foodTransaction(w,()=>{const used=new Map<string,number>();for(const [index,m] of c.members.entries()){const provider=person(w,m.providerId)!,p=person(w,m.personId)!;
  const receipt=observed[index];if(receipt)receipt.hungerBefore=p.hunger;
  const before=used.get(provider.id)??0,nutrition=foodValue(w,'person:'+provider.id,'meal',before+1)-foodValue(w,'person:'+provider.id,'meal',before);used.set(provider.id,before+1);provider.inventory.meal!--;provider.inventory.water!--;p.hunger=Math.max(0,p.hunger-nutrition);provider.revision++;p.revision++;
  if(receipt){receipt.hungerAfter=p.hunger;receipt.hungerRelief=receipt.hungerBefore-p.hunger;}
 }});
 for(const receipt of observed)if(receipt)recordFamilyJourneyMeal(w,receipt);
}
function journeyError(w:World,c:FamilyRelocation){
 const invalid=authorityError(w,c,true,same(person(w,c.proposerId)!.at,c.destination));if(invalid)return invalid;
 const leader=person(w,c.proposerId)!;
 for(const m of c.members){const p=person(w,m.personId)!;
  if(p.inside||!same(p.at,leader.at)||passenger(w,p.id)||aboardFerry(w,p.id))return '同行者必须实际在同一处户外集合，不可从室内或远处接走';
  if(p.health<=30||p.energy<10||personalMember(w,c,m,p)&&!capable(p)||(!m.caregiverId||!proxyChild(w,c,m,p))&&movementRate(w,p)<=0)return '同行者的身体条件不支持这段路程，须先停下照护或求助';
  if(p.plan||p.activity){const a=p.activity?.action;if(!(p.id===c.proposerId&&((a?.type==='familyRelocation'&&(a.operation==='depart'||a.operation==='resume')&&a.relocationId===c.id)||(!p.activity&&p.plan?.actions.length===0))))return '同行者仍在执行另一项本人安排，不能代为取消';}
 }
 // One consenting caregiver can carry only one child unable to walk independently.
 for(const id of new Set(c.members.map(m=>m.caregiverId).filter(Boolean)))if(c.members.filter(m=>m.caregiverId===id&&proxyChild(w,c,m,person(w,m.personId)!)).length>1)return '同一护送人不能同时抱送多位暂不能独立行路的孩子';
 return null;
}

function proposal(w:World,r:Resident,a:Extract<FamilyRelocationAction,{operation:'propose'}>):{error?:string;members?:RelocationMember[];signers?:string[];rations?:number}{
 if(!adult(w,r)||!Array.isArray(a.memberIds)||a.memberIds.length<2||a.memberIds.length>8||new Set(a.memberIds).size!==a.memberIds.length||!a.memberIds.includes(r.id))return {error:'须由实际在场成年监护人为2至8位明确家庭成员提议'};
 // Absolute world timestamps may be fractional; keep the chosen window unchanged across delayed replies.
 if(!Number.isFinite(a.departAfter)||!Number.isFinite(a.departBefore)||a.departAfter<0||a.departBefore<=w.minute||a.departBefore<=a.departAfter||a.departBefore-a.departAfter>DAY||a.departBefore>w.minute+DAY)return {error:'须指定未来一天内的实际出发时段'};
 const b=w.buildings.find(b=>b.id===a.buildingId),owner=b&&person(w,b.ownerId);
 if(!b||!['home','lodge'].includes(b.kind)||b.condition<=0||!r.knownBuildings.includes(b.id)||!adult(w,owner)||!socialSpace(w,r,owner))return {error:'须有已知住宅、实际在场的产权人及其独立入住确认；公共接待另行处理'};
 const people=a.memberIds.map(id=>person(w,id));
 if(people.some(p=>!alive(p)||!socialSpace(w,r,p)||p.id!==r.id&&!r.knownPeople.includes(p.id)))return {error:'所有拟同行者须实际在场且已经相识'};
 const members=people as Resident[];
 if(members.some(p=>knownAgeYears(p.bornAt,w.minute)===null))return {error:'同行者年龄无法核实，不能推定幼儿豁免、成年身份或监护代理'};
 if(members.some(p=>needsAssent(w,p)&&!capable(p)))return {error:'已到独立答复年龄的同行者须能够本人决定并表达'};
 if(!members.some(p=>minor(w,p))||members.every(p=>p.homeId===b.id&&p.residency==='resident'))return {error:'须确有未成年家庭成员及需要变更的住所或访客定居'};
 if(members.some(p=>minor(w,p)?!p.guardianIds.includes(r.id)||p.refusesCare:!adult(w,p)||p.id!==r.id&&!r.relations.some(t=>t.targetId===p.id&&(t.kin||t.adoptive||t.partner))&&!members.some(child=>child.guardianIds.includes(r.id)&&child.guardianIds.includes(p.id))))return {error:'成年监护人须负责所有同行孩子；其他同行成年人须为已知家人且自行决定'};
 if(members.some(p=>w.familyRelocation?.agreements.some(c=>open(c,w)&&c.members.some(m=>m.personId===p.id))))return {error:'家庭成员已有未完成的迁居提议，请先处理原安排'};
 if(unattended(w,a.memberIds,b.id))return {error:'未同行孩子仍需要留在原处的合格监护人'};
 const path=findPath(w,r.at,b.door),beds=bedsFor(w,b,members);if(path===null||!beds)return {error:'没有实际可达路线或每人可分别使用的床位'};
 const rate=Math.min(...members.filter(p=>!minor(w,p)||assents(w,p)).map(p=>movementRate(w,p)));if(rate<=0)return {error:'同行者目前无法行路'};
 const carriers=new Set<string>(),rows:RelocationMember[]=[];
 for(const [i,p]of members.entries()){
  const g=minor(w,p)?members.find(g=>adult(w,g)&&p.guardianIds.includes(g.id)&&(assents(w,p)||!carriers.has(g.id))):undefined;
  if(minor(w,p)&&!g)return {error:'每位暂不能独立行路的孩子都需要一位分别同意且有空余抱送能力的在场监护人'};
  if(g&&!assents(w,p))carriers.add(g.id);
  rows.push({personId:p.id,previousHomeId:p.homeId,previousResidency:p.residency as 'resident'|'visitor',guardianIds:minor(w,p)?guardians(w,r,p):[],caregiverId:g?.id??null,requiresAssent:needsAssent(w,p),providerId:g?.id??p.id,bed:beds[i],arrivedAt:null,arrivalEventId:null});
 }
 if(rows.some(m=>m.guardianIds.some(id=>!adult(w,person(w,id)))))return {error:'现有监护意见尚未协调，不能用未知的死亡、离镇或失能代替签署'};
 return {members:rows,signers:[...new Set([r.id,owner.id,...rows.filter(m=>m.requiresAssent).map(m=>m.personId),...rows.flatMap(m=>m.guardianIds)])],rations:Math.floor(path.length/rate/120)+2};
}
export function familyRelocationReason(w:World,r:Resident,a:FamilyRelocationAction):string|null{
 if(w.mode!=='formal'||!w.familyRelocation||!capable(r))return '本人当前不能决定家庭迁居';
 if(a.operation==='propose')return proposal(w,r,a).error??null;
 const c=agreement(w,a.relocationId);
 if(c&&a.operation==='returnChild')return returnChildReason(w,r,c,a);
 if(!c||!open(c,w))return '这项具体迁居安排已结束或过期';
 if(a.operation==='decline'||a.operation==='withdraw'){if(!c.requiredSignerIds.includes(r.id)&&!c.members.some(m=>m.personId===r.id))return '本人不是这项安排的当事人';return c.revocations?.some(s=>s.personId===r.id)&&!coLocated(w,r,person(w,c.proposerId)!,2)?'本人已经撤回；仍须实际告知同行家人':null;}
 if((a.operation==='escort'||a.operation==='returnChild')&&r.activity?.room){const b=w.buildings.find(b=>b.id===r.activity!.room!.buildingId);if(!b||r.activity.room.path.some(at=>roomLayout(w,b).blocked.some(p=>same(p,at))))return '原室内路线已被阻断，须停在实际位置重新决定';}
 const error=authorityError(w,c,a.operation!=='accept',a.operation==='accept'&&c.status==='proposed'||a.operation==='arrive'||same(r.at,c.destination));if(error)return error;
 if(a.operation==='accept'){
  const ownNewAssent=c.members.some(m=>m.personId===r.id&&personalMember(w,c,m,r));
  if(!signerIds(w,c).includes(r.id)||c.signatures.some(s=>s.personId===r.id)||c.status!=='proposed'&&(!ownNewAssent||!['accepted','paused','arrived'].includes(c.status)))return '没有等待本人独立确认的签署';
  return c.members.every(m=>socialSpace(w,r,person(w,m.personId)!))?null:'须实际与同行家人会面后确认同一安排';
 }
 if(a.operation==='escort'){
  const m=c.members.find(m=>m.personId===a.personId),p=m&&person(w,m.personId);
  if(c.status!=='accepted'||!m||!p||m.caregiverId!==r.id||!proxyChild(w,c,m,p)||p.refusesCare||p.plan||p.activity||passenger(w,p.id)||aboardFerry(w,p.id)||r.health<=30||r.energy<10)return '只能按已签署安排亲自接送年龄已核实且未满六岁的孩子，不能覆盖孩子的其他行动或拒绝';
  if(c.members.some(other=>other.escorting&&other.personId!==p.id&&other.caregiverId===r.id))return '本人已经抱送另一位孩子';
  if(p.inside){const b=w.buildings.find(b=>b.id===p.inside);if(!b||roomPath(roomLayout(w,b),p.roomAt??roomLayout(w,b).entry,roomLayout(w,b).entry)===null)return '孩子所在室内没有实际可用的出门路线';}
  if(a.phase==='delivery')return m.escorting?null:'本人已没有实际接出的孩子';
  return socialSpace(w,r,p)?null:'须实际在孩子身边且有室内使用权，不能远程接走孩子';
 }
 if(a.operation==='depart'||a.operation==='resume'){
  if(r.id!==c.proposerId||(a.operation==='depart'?c.status!=='accepted':c.status!=='paused'))return '须由已接受具体责任的护送人发起本次旅程';
  if(a.operation==='depart'&&(w.minute<c.departAfter||w.minute>c.departBefore||!same(r.at,c.assembly)))return '尚未到约定出发时段或集合点';
  const problem=journeyError(w,c);if(problem)return problem;
  const path=findPath(w,r.at,c.destination);if(path===null)return '原目的地目前没有可通行路线';
  const remaining=c.rationsPerPerson-(c.journey?.rationsUsed??0),rate=groupRate(w,c);
  const elapsed=a.operation==='depart'?120:Math.min(120,w.minute-(c.journey?.lastRationAt??w.minute));
  if(remaining<Math.floor((elapsed+path.length/rate)/120)+1)return '原已签署旅途口粮不足新路线，须另约路程与补给';
  return suppliesError(w,c,remaining,w.minute+path.length/rate+15);
 }
 if(a.operation==='arrive'){
  const m=c.members.find(m=>m.personId===a.personId),p=m&&person(w,m.personId);
  if(c.status!=='arrived'||!m||m.arrivedAt!==null||!p||r.id!==p.id&&!(m.caregiverId===r.id&&proxyChild(w,c,m,p)))return '须由实际到达者本人，或年龄已核实且未满六岁的孩子的已签署监护人登记';
  if(r.inside||p.inside||!same(r.at,c.destination)||!same(p.at,c.destination))return '须逐人实际到达已确认住宅门口';
  if(m.caregiverId){const g=person(w,m.caregiverId)!;if(!coLocated(w,p,g,1)||g.homeId!==c.buildingId)return '孩子到达后须有已落实同住床位且实际在场的监护人';}
  return suppliesError(w,c,1,w.minute+15);
 }
 return '没有这项家庭迁居行动';
}
export function familyRelocationTarget(w:World,r:Resident,a:FamilyRelocationAction){
 const error=familyRelocationReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 if(a.operation==='escort'||a.operation==='returnChild'){const c=agreement(w,a.relocationId)!,p=person(w,a.personId)!;return {target:{...(a.phase==='delivery'?a.operation==='returnChild'?w.buildings.find(b=>b.id===p.homeId)!.door:c.assembly:p.at)},duration:1};}
 return {target:{...r.at},duration:1};
}

function end(w:World,c:FamilyRelocation,r:Resident,status:'cancelled'|'expired',reason:string){c.status=status;for(const m of c.members){const a=person(w,m.caregiverId??'')?.activity?.action;if(a?.type!=='familyRelocation'||a.operation!=='returnChild')m.escorting=false;}c.endedAt=w.minute;c.reason=reason;fact(w,c,r,`${r.name}的家庭迁居安排结束：${reason}。未登记到达者保留此前住宿，所有人停留在实际位置；已完成的个人入住不倒退。`);}
export function completeFamilyRelocation(w:World,r:Resident,a:FamilyRelocationAction):string|null{
 const error=familyRelocationReason(w,r,a);if(error)return error;
 if(a.operation==='propose'){
  const terms=proposal(w,r,a),b=w.buildings.find(b=>b.id===a.buildingId)!;
  const c:FamilyRelocation={id:'family-relocation:'+w.familyRelocation!.nextSerial++,definition:'family/relocation@1',proposerId:r.id,buildingId:b.id,ownerId:b.ownerId,assembly:{...r.at},destination:{...b.door},departAfter:a.departAfter,departBefore:a.departBefore,expiresAt:a.departBefore+DAY,members:terms.members!,requiredSignerIds:terms.signers!,signatures:[],rationsPerPerson:terms.rations!,food:'meal',waterPerRation:1,status:'proposed',createdAt:w.minute,startedAt:null,endedAt:null,reason:null,journey:null};
  const e=fact(w,c,r,`${r.name}提出与${c.members.filter(m=>m.personId!==r.id).map(m=>person(w,m.personId)!.name).join('、')}迁居${b.name}，每人指定一张床。出发时段${c.departAfter}–${c.departBefore}分钟，每人${c.rationsPerPerson}份餐食及清水，成年人各自携带，${c.members.filter(m=>m.caregiverId).map(m=>person(w,m.caregiverId!)!.name+'承担'+person(w,m.personId)!.name+'的供给、护送及到达后同住照护').join('；')}；等待各人分别接受，收养同意不替代入住同意。`);
  c.signatures.push({personId:r.id,at:w.minute,eventId:e.id});if(c.requiredSignerIds.length===1)c.status='accepted';w.familyRelocation!.agreements.push(c);return null;
 }
 const c=agreement(w,a.relocationId)!;
 if(a.operation==='decline'||a.operation==='withdraw'){
  if(c.members.some(m=>m.personId===r.id)||coLocated(w,r,person(w,c.proposerId)!,2))end(w,c,r,'cancelled','当事人已实际表达拒绝或撤回');
  else {const e=emitEvent(w,{kind:'relationship',actors:[r.id],place:{...r.at},text:`${r.name}撤回了本人对${c.id}的入住或照护同意；记录在实际所在地，尚未把消息送到同行家人，不能令远处的人自动停步。`});(c.revocations??=[]).push({personId:r.id,at:w.minute,eventId:e.id});}
  return null;
 }
 if(a.operation==='accept'){
  const e=fact(w,c,r,`${r.name}独立接受了${c.id}的明确同行者、床位、出发时段、本人供给责任和同住照护；尚未搬家。`);c.signatures.push({personId:r.id,at:w.minute,eventId:e.id});
  if(c.status==='proposed'&&signerIds(w,c).every(id=>c.signatures.some(s=>s.personId===id))){c.status='accepted';fact(w,c,r,'家庭迁居的各方已分别确认，目的地实际床位预留；原住处继续保留，等待本人集合启程。');}
  r.revision++;return null;
 }
 if(a.operation==='escort'||a.operation==='returnChild'){
  const m=c.members.find(m=>m.personId===a.personId)!,p=person(w,m.personId)!;
  if(!r.activity||r.activity.action!==a)return '接送须由本人实际行动、走到孩子身边并出门';
  if(a.phase==='delivery'){
   const home=a.operation==='returnChild'?w.buildings.find(b=>b.id===p.homeId):undefined,bed=home?residentBed(w,p,home):null,slot=home&&bed!==null?roomLayout(w,home).slots.find(s=>s.key==='bed:'+bed):undefined;
   const reached=a.operation==='returnChild'?r.inside===p.homeId&&!!slot&&!!r.roomAt&&same(r.roomAt,slot.at):!r.inside&&same(r.at,c.assembly);if(!reached||!coLocated(w,r,p,0))return '尚未亲自把孩子带到约定位置';
   m.escorting=false;fact(w,c,r,`${r.name}按已签署安排亲自把${p.name}从原位置${a.operation==='returnChild'?'送回仍保留的原住所实际床位':'带到户外集合点'}，原住宿保留，没有另行搬家。`);return null;
  }
  if(!coLocated(w,r,p,0))return '须实际走到孩子所在的位置再接出';
  const target=a.operation==='returnChild'?w.buildings.find(b=>b.id===p.homeId)!.door:c.assembly,path=findPath(w,r.at,target);if(path===null)return '孩子所在处没有可达的集合路线';
  m.escorting=true;a.phase='delivery';r.activity.path=path;r.activity.target={...target};r.activity.remaining=1;r.activity.travelProgress=0;prepareRoomExit(w,r);
  fact(w,c,r,`${r.name}在${p.name}实际所在的位置接出孩子，${a.operation==='returnChild'?'按当前监护职责返回仍保留的原住所':'按分别确认的迁居安排走向户外集合点'}；未把孩子或自己瞬移到门外。`);return null;
 }
 if(a.operation==='depart'||a.operation==='resume'){
  const path=findPath(w,r.at,c.destination)!;
  const feed=a.operation==='depart'||w.minute-(c.journey?.lastRationAt??w.minute)>=120;if(feed)consumeRation(w,c,a.operation);c.journey={path,progress:0,lastRationAt:feed?w.minute:c.journey!.lastRationAt,rationsUsed:(c.journey?.rationsUsed??0)+(feed?1:0)};c.status='travelling';c.startedAt??=w.minute;c.reason=null;
  fact(w,c,r,`${r.name}与分别同意的家人在实际集合处${a.operation==='resume'?'重新':'开始'}同行，${feed?'每人实际消耗一份已约定餐食和清水':'继续使用上次已经消耗的口粮，不重复扣除'}，沿真实道路前往原定住宅；原床位尚未释放。`);return null;
 }
 if(a.operation!=='arrive')return '没有这项家庭迁居行动';
 const m=c.members.find(m=>m.personId===a.personId)!,p=person(w,m.personId)!,b=w.buildings.find(b=>b.id===c.buildingId)!;
 const previous=w.buildings.find(b=>b.id===p.homeId),oldHome=p.homeId,visiting=p.residency==='visitor';
 if(previous&&previous.id!==b.id)previous.residents=previous.residents.filter(id=>id!==p.id);
 if(!b.residents.includes(p.id))b.residents.push(p.id);p.homeId=b.id;p.residency='resident';
 if(w.rooms){for(const assignments of Object.values(w.rooms.beds))delete assignments[p.id];(w.rooms.beds[b.id]??={})[p.id]=m.bed;}
 for(const s of w.commons?.stays??[])if(s.residentId===p.id&&s.endedAt===null){s.endedAt=w.minute;s.reason='本人实际完成家庭迁居入住';}
 if(!p.knownBuildings.includes(b.id))p.knownBuildings.push(b.id);p.revision++;m.arrivedAt=w.minute;
 const e=emitEvent(w,{kind:'arrival',...(visiting?{populationChange:'settle' as const}:oldHome!==b.id?{populationChange:'moveHome' as const}:{}),actors:[p.id,...(m.caregiverId?[m.caregiverId]:[])],place:{...p.at},text:`${p.name}按另外签署的家庭同住安排实际抵达${b.name}，登记第${m.bed+1}张床${m.caregiverId?'及在场监护人的同住照护':''}，此时才释放原住宿；亲缘、产权和个人财产保留。`});m.arrivalEventId=e.id;
 if(c.members.every(m=>m.arrivedAt!==null)){c.status='completed';c.endedAt=w.minute;c.reason='全部成员分别到达并登记';}
 return null;
}
function groupRate(w:World,c:FamilyRelocation){return Math.min(...c.members.map(m=>({m,p:person(w,m.personId)!})).filter(({m,p})=>!m.caregiverId||!proxyChild(w,c,m,p)).map(({p})=>movementRate(w,p)));}
function pause(w:World,c:FamilyRelocation,reason:string){c.status='paused';c.reason=reason;const r=person(w,c.proposerId);if(r)fact(w,c,r,`家庭同行在实际位置暂停：${reason}。原住宿继续保留，可以等待、撤回后折返或另行求助；不自动换路或搬家。`);}
/** Only a unanimously accepted journey advances people. No intentions, signatures or stock are generated. */
export function advanceFamilyRelocation(w:World,minutes:number){
 initializeFamilyRelocation(w);
 for(const c of w.familyRelocation?.agreements??[]){
  if(!open(c,w)){if(['proposed','accepted','travelling','paused','arrived'].includes(c.status)){const r=person(w,c.proposerId);if(r)end(w,c,r,'expired','已签署安排的期限结束');}continue;}
  if(c.status!=='travelling')continue;
  const error=authorityError(w,c,true,false);if(error){pause(w,c,error);continue;}
  const r=person(w,c.proposerId)!,j=c.journey!;
  const health=c.members.some(m=>{const p=person(w,m.personId)!;return !same(p.at,r.at)||p.inside!==null||p.health<=30||p.energy<10||personalMember(w,c,m,p)&&!capable(p)||(!m.caregiverId||!proxyChild(w,c,m,p))&&movementRate(w,p)<=0;});
  if(health){pause(w,c,'同行位置、身体或照护条件改变');continue;}
  if(w.minute-j.lastRationAt>=120){if(j.rationsUsed>=c.rationsPerPerson-1||suppliesError(w,c,2,w.minute+15)){pause(w,c,'剩余已约定口粮不足，保留到达后的供给');continue;}consumeRation(w,c,'travel');j.rationsUsed++;j.lastRationAt=w.minute;}
  let available=minutes*groupRate(w,c);
  while(available>1e-9&&j.path.length){const next=j.path[0];if(!walkable(w,next,r.at)){pause(w,c,'原路线出现实际阻挡');break;}
   const duration=w.map.tiles[next.y*w.map.width+next.x]==='road'?.75:1,needed=(1-j.progress)*duration;
   if(available+1e-9<needed){j.progress+=available/duration;break;}
   available-=needed;j.progress=0;j.path.shift();for(const m of c.members){const p=person(w,m.personId)!;p.at={...next};p.inside=null;p.roomAt=null;}
  }
  if(c.status==='travelling'&&!j.path.length){c.status='arrived';fact(w,c,r,'同行家人已沿真实道路到达目的地，尚待各人分别登记，孩子须先落实在场监护人的同住；未登记者仍保有原住宿。');}
 }
}

export function familyRelocationOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const out:FormalOpportunity[]=[],add=(id:string,label:string,a:FamilyRelocationAction)=>{if(!familyRelocationReason(w,r,a))out.push({id:'relocation.'+id,label,action:a});};
 if(!w.familyRelocation)return out;
 if(adult(w,r)&&!travellingFamily(w,r.id)){
  const children=w.residents.filter(p=>alive(p)&&minor(w,p)&&p.guardianIds.includes(r.id)&&coLocated(w,r,p,2));
  const relatives=w.residents.filter(p=>p.id!==r.id&&adult(w,p)&&coLocated(w,r,p,2)&&(r.relations.some(t=>t.targetId===p.id&&(t.kin||t.adoptive||t.partner))||children.some(child=>child.guardianIds.includes(p.id))));
  const households=[...children.map(p=>[r.id,p.id]),...(children.length>1?[[r.id,...children.map(p=>p.id)]]:[]),...(children.length&&relatives.length?[[r.id,...relatives.map(p=>p.id),...children.map(p=>p.id)]]:[])];
  for(const b of w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&adult(w,person(w,b.ownerId))&&coLocated(w,r,person(w,b.ownerId)!,2)))for(const ids of households){
   add('propose.'+b.id+'.'+ids.join('.'),`提出与${ids.slice(1).map(id=>person(w,id)!.name).join('、')}迁居${b.name}：独立同意、逐人床位、自有餐食清水、本人护送及到达后同住照护，收养登记不能代替接受`,{type:'familyRelocation',operation:'propose',buildingId:b.id,memberIds:ids,departAfter:w.minute+5,departBefore:w.minute+240});
  }
 }
 for(const c of w.familyRelocation.agreements){
  for(const m of c.members)add('return.'+c.id+'.'+m.personId,`本人亲自把${person(w,m.personId)?.name}送回仍保留的原住所床位，沿实际路线行走，不修改住处`,{type:'familyRelocation',operation:'returnChild',relocationId:c.id,personId:m.personId});
  if(!open(c,w)||!c.requiredSignerIds.includes(r.id)&&!c.members.some(m=>m.personId===r.id))continue;
  // Unsigned people learn the arrangement only through an actual family meeting.
  if(!c.signatures.some(s=>s.personId===r.id)&&!c.members.every(m=>coLocated(w,r,person(w,m.personId)!,2)))continue;
  add('withdraw.'+c.id,'本人拒绝或撤回具体家庭迁居，停留实际位置并保留尚未释放的原住宿',{type:'familyRelocation',operation:'withdraw',relocationId:c.id});
  add('accept.'+c.id,`本人分别接受${c.id}：${c.members.map(m=>person(w,m.personId)?.name+'第'+(m.bed+1)+'床').join('、')}同住${w.buildings.find(b=>b.id===c.buildingId)?.name}（${c.destination.x},${c.destination.y}），户外集合点（${c.assembly.x},${c.assembly.y}），每人${c.rationsPerPerson}份自有餐食清水、${c.members.filter(m=>m.caregiverId).map(m=>person(w,m.caregiverId!)?.name+'为'+person(w,m.personId)?.name+'护送供给并同住照护').join('；')}，出发时段${c.departAfter}–${c.departBefore}；不授予财产处分权`,{type:'familyRelocation',operation:'accept',relocationId:c.id});
  for(const operation of ['depart','resume'] as const)add(operation+'.'+c.id,`${operation==='depart'?'集合后启程':'本人选择按原约定重新启程'}，实际消耗本人已同意承担的粮水并沿路同行`,{type:'familyRelocation',operation,relocationId:c.id});
  if(c.status==='accepted'&&c.members.some(m=>m.personId===r.id)&&(r.inside||!same(r.at,c.assembly)))out.push({id:'relocation.assemble.'+c.id,label:'按本人接受的原约定步行到户外集合点，是否能出发仍须到场核实',action:{type:'move',to:{...c.assembly}}});
  for(const m of c.members)add('escort.'+c.id+'.'+m.personId,`按已签署安排实际接出${person(w,m.personId)?.name}，沿室内外路线带到户外集合点，原住宿不变`,{type:'familyRelocation',operation:'escort',relocationId:c.id,personId:m.personId});
  for(const m of c.members)add('arrive.'+c.id+'.'+m.personId,`在实际到达后为${person(w,m.personId)?.name}登记已确认床位，此时才释放其原住宿`,{type:'familyRelocation',operation:'arrive',relocationId:c.id,personId:m.personId});
 }
 return out;
}

/** The accepted guardian follows the real engine path; the child is never copied to a remote target. */
export function syncFamilyEscorts(w:World){
 for(const c of w.familyRelocation?.agreements??[])for(const m of c.members){if(!m.escorting)continue;const r=person(w,m.caregiverId!),p=person(w,m.personId),a=r?.activity?.action;
  if(!adult(w,r)||!alive(p)||a?.type!=='familyRelocation'||(a.operation!=='escort'&&a.operation!=='returnChild')||(a.operation==='escort'&&!open(c,w))||a.relocationId!==c.id||a.personId!==p.id||a.phase!=='delivery'||!proxyChild(w,c,m,p)||p.refusesCare||!p.guardianIds.includes(r.id)){m.escorting=false;continue;}
  p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;
 }
}
export function familyEscortContinues(w:World,r:Resident){return w.familyRelocation?.agreements.some(c=>c.members.some(m=>m.escorting&&m.caregiverId===r.id))??false;}

function returnChildReason(w:World,r:Resident,c:FamilyRelocation,a:Extract<FamilyRelocationAction,{operation:'escort'|'returnChild'}>){
 const m=c.members.find(m=>m.personId===a.personId),p=m&&person(w,m.personId),b=p&&w.buildings.find(b=>b.id===p.homeId);
 if(!m||!alive(p)||!minor(w,p)||!adult(w,r)||!p.guardianIds.includes(r.id)||m.caregiverId!==r.id||p.homeId!==m.previousHomeId||!b||b.condition<=0||!b.residents.includes(p.id)||b.ownerId!=='commons'&&b.ownerId!==r.id&&!b.residents.includes(r.id)||!proxyChild(w,c,m,p)||p.refusesCare||p.plan||p.activity||passenger(w,p.id)||aboardFerry(w,p.id)||r.health<=30||r.energy<10||travellingFamily(w,p.id))return '须按当前监护职责接送年龄已核实且未满六岁的孩子，原住所及双方使用权仍有效，并先停止共同旅程';
 const bed=residentBed(w,p,b),layout=roomLayout(w,b),slot=bed===null?undefined:layout.slots.find(s=>s.key==='bed:'+bed);if(!slot||roomPath(layout,layout.entry,slot.at)===null)return '原住所已没有仍可使用的真实床位，不能把到门口或进入房间当作送回床位';
 if(w.familyRelocation?.agreements.some(other=>other.members.some(n=>n.escorting&&n.caregiverId===r.id&&n.personId!==p.id)))return '本人已在接送另一位孩子';
 if(r.activity?.room){const room=w.buildings.find(b=>b.id===r.activity!.room!.buildingId);if(!room||r.activity.room.path.some(at=>roomLayout(w,room).blocked.some(p=>same(p,at))))return '返回原住所的室内路线已阻断';}
 if(a.phase==='delivery')return m.escorting?null:'本人已没有实际接出的孩子';
 if(p.inside){const room=w.buildings.find(b=>b.id===p.inside);if(!room||roomPath(roomLayout(w,room),p.roomAt??roomLayout(w,room).entry,roomLayout(w,room).entry)===null)return '原位置没有可用的室内出门路线';}
 if(p.inside===b.id)return '孩子已经在仍保留的原住所内';
 return socialSpace(w,r,p)?null:'须亲自到孩子目前的位置接出，不能远程送回';
}
