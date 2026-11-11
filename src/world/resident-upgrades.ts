import type {BuildingMigrationAction,BuildingUpgrade} from '../shared/building-migration.js';
import type {Building,FormalOpportunity,Inventory,Item,Resident,World} from '../shared/types.js';
import {currentPremisesLease} from '../shared/premises.js';
import {landConstructionError,landOverlap} from '../shared/land-rights.js';
import {activeDefinitionError} from './content-schema.js';
import {registerDefinition} from './content.js';
import {firstReceipt} from './receipts.js';
import {ageYears,DAY} from './time.js';
import {distance,same} from './navigation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {educationConflict} from './education.js';
import {employmentConflict} from './employment.js';
import {estateStock} from './estate-custody.js';

const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const capable=(w:World,r:Resident|undefined)=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const active=(m:BuildingUpgrade)=>m.status==='offered'||m.status==='accepted';
const nonempty=(bag:Inventory)=>Object.values(bag).some(n=>n!>0);
const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([i,n])=>(bag[i as Item]??0)>=n!);
const add=(bag:Inventory,cost:Inventory,sign=1)=>{for(const [i,n]of Object.entries(cost))bag[i as Item]=(bag[i as Item]??0)+sign*n!;};
const local=(r:Resident,b:Building)=>r.knownBuildings.includes(b.id)&&distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id);
const quote=(b:Building,roof:'wood'|'slate')=>({charge:roof==='wood'?{wood:Math.ceil(b.width*b.height/4)}:{wood:Math.ceil(b.width*b.height/8),stone:Math.ceil(b.width*b.height/4)},minutes:30+2*b.width*b.height});
export const isResidentUpgrade=(w:World,a:BuildingMigrationAction)=>a.operation==='propose'||!!w.buildingMigrations?.find(m=>m.id===a.migrationId)?.residentProposal;

/** Stable rights only. Stock, ordinary work progress, wages and food clocks continue unchanged. */
function rights(w:World,b:Building){
 const partyMap=new Map<string,string[]>();
 const include=(id:string,role:string)=>partyMap.set(id,[...(partyMap.get(id)??[]),role]);
 include(b.ownerId,'产权人');
 const occupants=[...new Set([...b.residents,...w.residents.filter(r=>r.homeId===b.id).map(r=>r.id)])].sort();
 occupants.forEach(id=>include(id,'住户'));
 const lease=currentPremisesLease(w,b.id);if(lease)include(lease.tenantId,'承租人');
 const businesses=(w.economy?.businesses??[]).filter(s=>s.buildingId===b.id).map(s=>{if(s.closedAt===null||nonempty(s.inventory))include(s.ownerId,'经营者或原址库存所有人');return {id:s.id,ownerId:s.ownerId,buildingId:s.buildingId,closedAt:s.closedAt};}).sort((a,b)=>a.id.localeCompare(b.id));
 const contracts=(w.employment?.contracts??[]).filter(c=>c.buildingId===b.id&&(c.status==='active'||c.batch!==null)).map(c=>{include(c.employerId,'雇主');include(c.workerId,'员工');return {id:c.id,businessId:c.businessId,employerId:c.employerId,workerId:c.workerId,buildingId:c.buildingId,terms:c.terms,acceptedAt:c.acceptedAt,recipe:c.recipe,startDay:c.startDay,endDay:c.endDay,account:c.account,recipeDefinition:c.recipeDefinition,status:c.status};}).sort((a,b)=>a.id.localeCompare(b.id));
 const stations=(w.industry?.stations??[]).filter(s=>s.buildingId===b.id).map(s=>({id:s.id,kind:s.kind,definition:s.definition,installedCost:s.installedCost,installedAt:s.installedAt})).sort((a,b)=>a.id.localeCompare(b.id));
 for(const batch of w.industry?.batches??[])if(batch.buildingId===b.id&&batch.status==='working')include(batch.ownerId,'未完批次所有人');
 const parties=[...partyMap].sort(([a],[b])=>a.localeCompare(b)).map(([residentId,roles])=>({residentId,roles:[...new Set(roles)].sort(),reviewedAt:null,acceptedAt:null}));
 const snapshot=canonical({building:{id:b.id,ownerId:b.ownerId,definition:b.definition,kind:b.kind,at:b.at,door:b.door,width:b.width,height:b.height,capacity:b.capacity,residents:occupants,extensions:b.extensions,conversions:b.conversions},lease:lease?{id:lease.id,ownerId:lease.ownerId,tenantId:lease.tenantId,terms:lease.terms,acceptedAt:lease.acceptedAt,endsAt:lease.endsAt}:null,businesses,contracts,stations,land:(w.landRights?.applications??[]).filter(a=>a.registeredAt!==null&&landOverlap(a,b)).map(a=>({id:a.id,status:a.status,applicantId:a.applicantId,expiresAt:a.expiresAt,definition:a.definition}))});
 return {parties,snapshot};
}
function siteReason(w:World,b:Building):string|null {
 if(!['home','workshop','store'].includes(b.kind)||b.ownerId==='commons'||b.condition<=0)return '首版只支持完好的私人住宅、工坊或店面屋面，不改变用途、容量、屋况或内部设备';
 const activeLeases=(w.economy?.leases??[]).filter(l=>l.buildingId===b.id&&l.status==='active'&&l.endedAt===null);
 if(activeLeases.length>1||activeLeases.length===1&&currentPremisesLease(w,b.id)?.id!==activeLeases[0].id)return '原租约记录不一致或已经失效，须先按原约处理';
 const source=w.definitions[b.definition];if(!source||source.kind!=='building'||String(source.data.template??source.id.slice(9))!==b.kind||activeDefinitionError(w,source))return '原建筑版本无法核验';
 const land=landConstructionError(w,{...b,ownerId:b.ownerId});if(land)return land;
 if(w.construction?.projects.some(p=>(p.base?.id===b.id||p.buildingId===b.id)&&['proposed','planned','active','paused'].includes(p.status)))return '原址已有建设工程';
 if(w.economy?.relocations?.some(m=>['preparing','moving'].includes(m.status)&&(m.fromBuildingId===b.id||m.toBuildingId===b.id)))return '原址正在另行商议经营迁址';
 if(w.economy?.leases?.some(l=>l.buildingId===b.id&&l.status==='offered'))return '原址仍有未签定的租约报价';
 if(w.employment?.posts.some(p=>p.buildingId===b.id&&(['open','offered'].includes(p.status)||p.offer)))return '原址待聘约须先独立完成或撤回';
 if(w.health?.appointments.some(a=>a.buildingId===b.id&&['offered','accepted'].includes(a.status))||w.health?.transports.some(t=>t.buildingId===b.id&&t.phase==='carrying')||w.longCare?.agreements.some(c=>c.addressId===b.id&&['offered','awaitingChild','active'].includes(c.status))||w.education?.lessons.some(l=>l.buildingId===b.id&&['offered','open','active','scheduled','teaching'].includes(l.status))||w.duties?.shifts.some(s=>s.buildingId===b.id&&['booked','on-duty'].includes(s.status)))return '原址有另行约定的照护、教学或公共班次，首版不改动这些场所';
 if(w.household?.pools.some(p=>p.buildingId===b.id&&['offered','open'].includes(p.status))||w.production?.protectedCustody?.mandates.some(m=>m.scope.buildings.includes(b.id)&&['offered','active'].includes(m.status)))return '共同钱物或受保护财产须走专门授权，不能以屋面提议代替';
 if(w.familyRelocation?.agreements.some(c=>!['completed','cancelled','expired'].includes(c.status)&&(c.buildingId===b.id||c.members.some(m=>m.previousHomeId===b.id)))||w.commons?.stays.some(s=>s.buildingId===b.id&&s.endedAt===null&&s.expiresAt>w.minute))return '原址仍有家庭迁居或临时床位承诺';
 if(w.culture?.events.some(e=>e.buildingId===b.id&&['planned','held'].includes(e.status)))return '原址仍有文化活动约定';
 if(w.industry?.stations.some(s=>s.buildingId===b.id&&(s.removalWorked??0)>0)||w.industry?.removals?.some(p=>p.buildingId===b.id&&p.status==='active'))return '原址设备仍在拆卸';
 const parties=rights(w,b).parties;
 if(parties.some(p=>!capable(w,w.residents.find(r=>r.id===p.residentId))))return '每位受影响权利人都须能独立答复；未成年、失能或权利人缺失的场所暂不支持';
 return null;
}
function currentReason(w:World,m:BuildingUpgrade,b:Building):string|null {
 const p=m.residentProposal!;
 if(!active(m)||w.minute>=m.expiresAt)return '这次有限屋面提议已结束或到期';
 const reason=siteReason(w,b);if(reason)return reason;
 const now=rights(w,b);
 if(now.parties.some(person=>!p.parties.some(signed=>signed.residentId===person.residentId))||p.parties.some(person=>!capable(w,w.residents.find(r=>r.id===person.residentId))))return '出现尚未同意的新当事人或原当事人已无法独立答复';
 if(now.snapshot!==p.rights)return '原产权、住户、租约、工位或聘约已变化，旧同意不能沿用';
 if(canonical([w.definitions[m.from],w.definitions[m.to]])!==p.definitions)return '已确认的原建筑或兼容版本已经变化';
 if(!capable(w,w.residents.find(r=>r.id===p.proposerId)))return '提议人当前无法继续履约';
 return null;
}
export function residentUpgradeReason(w:World,r:Resident,a:BuildingMigrationAction):string|null {
 if(w.mode!=='formal'||!capable(w,r))return '本人当前无法独立处理屋面提议';
 if(a.operation==='propose'){
  const b=w.buildings.find(b=>b.id===a.buildingId);if(!b||!local(r,b))return '须在已知原建筑附近实地提出具体方案';
  if(b.ownerId!==r.id&&currentPremisesLease(w,b.id)?.tenantId!==r.id)return '只有原产权人或当前承租经营者可以提出';
  if(r.skills.building<1||!['wood','slate'].includes(a.roof??''))return '须有一级建造技能并选择木面或石板屋面';
  if(w.definitions[b.definition]?.data.art&&(w.definitions[b.definition].data.art as {roof?:string}).roof===a.roof)return '现有屋面已经是这个方案';
  if(w.buildingMigrations?.some(m=>m.buildingId===b.id&&(active(m)||nonempty(m.stock))))return '原址还有未结束的改版或未领材料';
  return siteReason(w,b);
 }
 const m=w.buildingMigrations?.find(m=>m.id===a.migrationId),b=m&&w.buildings.find(b=>b.id===m.buildingId),p=m?.residentProposal;
 if(!m||!p)return '找不到这份具体居民提议';
 const party=p.parties.find(p=>p.residentId===r.id),proposer=p.proposerId===r.id;
 if(a.operation==='collect')return proposer&&!active(m)&&nonempty(m.stock)?null:'没有本人留在原址的未用材料';
 if(a.operation==='cancel')return proposer&&active(m)?null:'只有原提议人可以撤销尚未完成的方案';
 if(a.operation==='decline'||a.operation==='revoke')return party&&active(m)&&(a.operation==='decline'||party.acceptedAt!==null)?null:'没有本人可拒绝或撤回的具体同意';
 if(!b)return '原建筑已经不存在';
 const reason=currentReason(w,m,b);if(reason)return reason;
 if(a.operation==='review')return party&&local(r,b)&&party.reviewedAt===null?null:'须本人在原址附近亲自阅读尚未读过的提议';
 if(a.operation==='accept')return party&&party.reviewedAt!==null&&party.acceptedAt===null&&m.status==='offered'?null:'须本人先阅读这份具体提议，再分别同意';
 if(a.operation==='begin')return proposer&&m.status==='offered'&&p.parties.every(p=>p.acceptedAt!==null)&&has(r.inventory,m.charge)?null:'须所有受影响者分别同意，提议人再亲自带足本人材料开工';
 if(a.operation==='work'){
  if(!proposer||m.status!=='accepted'||!p.parties.every(p=>p.acceptedAt!==null)||!Number.isSafeInteger(a.minutes)||a.minutes!<1||a.minutes!>120)return '须各方同意后由提议人选择1至120分钟实际劳动';
  const minutes=Math.min(a.minutes!,m.minutes-m.worked);
  const conflict=educationConflict(w,r.id,w.minute,w.minute+minutes,b.id)??employmentConflict(w,r,w.minute,w.minute+minutes,b.id);if(conflict)return conflict;
  if(w.duties?.shifts.some(s=>s.workerId===r.id&&['booked','on-duty'].includes(s.status)&&w.minute<s.end&&s.start<w.minute+minutes))return '本人已有公共班次，不能占用该劳动时段';
  if(Object.entries(m.charge).some(([i,n])=>(m.stock[i as Item]??0)+(p.consumed[i as Item]??0)!<n!))return '原址预留材料不足';
  return null;
 }
 return '未知屋面提议行动';
}
export function residentUpgradeTarget(w:World,r:Resident,a:BuildingMigrationAction){
 const error=residentUpgradeReason(w,r,a),m=w.buildingMigrations?.find(m=>m.id===a.migrationId),b=w.buildings.find(b=>b.id===(a.operation==='propose'?a.buildingId:m?.buildingId));
 if(!error&&a.operation==='collect'&&m?.residentProposal)return {target:{...m.residentProposal.stockAt},duration:5};
 return error||!b?{target:{...r.at},duration:0,error:error??'找不到原址'}:{target:{...b.door},duration:a.operation==='work'?Math.min(a.minutes!,m!.minutes-m!.worked):a.operation==='propose'?20:5};
}
function stop(w:World,m:BuildingUpgrade,reason:string,status:BuildingUpgrade['status']='cancelled'){
 m.status=status;m.residentProposal!.reason=reason;
 const b=w.buildings.find(b=>b.id===m.buildingId);emitLedgerEvent(w,{kind:'construction',actors:[m.residentProposal!.proposerId],place:m.residentProposal!.stockAt,text:`屋面提议停止：${reason}。原建筑和契约不变，已投入材料及劳动不退回，未用材料留在原址。`});
}
export function completeResidentUpgrade(w:World,r:Resident,a:BuildingMigrationAction):string|null {
 if(a.operation==='work')return null;
 const current=r.activity;if(!current||current.action!==a||current.remaining>0||current.path.length||current.room?.path.length)return '须本人到场完成实际办理';
 const receipt=`resident-upgrade:${current.planId}:${current.startedAt}`;
 const saved=firstReceipt(w,receipt);if(saved)return saved===receipt+':'+canonical(a)?null:'同一办理记录不能改换条款';
 const error=residentUpgradeReason(w,r,a);if(error)return error;
 const target=residentUpgradeTarget(w,r,a);if(r.inside!==null||!same(r.at,target.target))return '须本人实际来到原建筑门外';
 let m=w.buildingMigrations?.find(m=>m.id===a.migrationId);
 if(a.operation==='propose'){
  const b=w.buildings.find(b=>b.id===a.buildingId)!,from=w.definitions[b.definition],to=structuredClone(from);
  to.version=Math.max(...Object.values(w.definitions).filter(d=>d.id===from.id).map(d=>d.version))+1;to.data.art={...(to.data.art as object??{}),roof:a.roof};
  const registered=registerDefinition(w,to);if(!registered.ok)return registered.error!;
  const id=`resident-upgrade-${w.revision}-${w.minute}-${w.buildingMigrations?.length??0}`,snapshot=rights(w,b),terms=quote(b,a.roof!);
  m={id,buildingId:b.id,from:b.definition,to:`${to.id}@${to.version}`,ownerId:b.ownerId,offeredAt:w.minute,expiresAt:w.minute+7*DAY,acceptedAt:null,completedAt:null,status:'offered',charge:terms.charge,refund:{},stock:{},minutes:terms.minutes,worked:0,lastAt:-1,residentProposal:{proposerId:r.id,stockAt:{...b.door},roof:a.roof!,rights:snapshot.snapshot,definitions:canonical([from,to]),parties:snapshot.parties,reason:null,consumed:{}}};
  (w.buildingMigrations??=[]).push(m);
 }else{
  const p=m!.residentProposal!,party=p.parties.find(p=>p.residentId===r.id);
  if(a.operation==='review')party!.reviewedAt=w.minute;
  if(a.operation==='accept')party!.acceptedAt=w.minute;
  if(a.operation==='begin'){add(r.inventory,m!.charge,-1);m!.stock={...m!.charge};m!.status='accepted';m!.acceptedAt=w.minute;}
  if(a.operation==='decline'||a.operation==='revoke'||a.operation==='cancel'){if(party&&a.operation==='revoke')party.acceptedAt=null;stop(w,m!,a.operation==='decline'?'一位当事人拒绝':a.operation==='revoke'?'一位当事人撤回同意':'提议人撤销',a.operation==='decline'?'declined':'cancelled');}
  if(a.operation==='collect'){add(r.inventory,m!.stock);m!.stock={};}
 }
 w.processed.push(receipt+':'+canonical(a));r.revision++;w.revision++;
 const label={propose:'提出有限屋面改版，尚无任何人的同意或材料投入',review:'亲自读到屋面方案及原住户、租约、岗位不变的条款',accept:'独立同意这份屋面方案，可在完成前撤回',begin:'在各方同意后预留自己的真实材料，尚须本人逐步劳动',decline:'拒绝方案',revoke:'撤回自己的同意',cancel:'撤销方案',collect:'亲自取回原址未用材料',work:'实际劳动'};
 emitEvent(w,{kind:'construction',actors:[r.id],place:{...r.at},roomId:null,text:`${r.name}${label[a.operation]}。不改变建筑身份、屋况、占地、容量、库存或原服务；无工资及额外收益承诺。`});
 return null;
}
export function workResidentUpgrade(w:World,r:Resident,a:BuildingMigrationAction,dt:number):string|null {
 if(a.operation!=='work')return null;
 const error=residentUpgradeReason(w,r,a);if(error)return error;
 const m=w.buildingMigrations!.find(m=>m.id===a.migrationId)!,p=m.residentProposal!,b=w.buildings.find(b=>b.id===m.buildingId)!;
 if(!r.activity||r.activity.action!==a||r.inside!==null||!same(r.at,b.door))return '尚未在原建筑门外实际劳动';
 if(!Number.isFinite(dt)||dt<=0)return '实际劳动时间无效';
 if(m.lastAt>=w.minute)return null;
 const progress=Math.min(m.minutes,m.worked+Math.min(dt,r.activity.remaining)),worked=progress+1e-8>=m.minutes?m.minutes:progress;
 for(const [i,n]of Object.entries(m.charge)){const item=i as Item,used=Math.floor(n!*worked/m.minutes),delta=used-(p.consumed[item]??0);if((m.stock[item]??0)<delta)return '预留材料不足，不能继续劳动';}
 for(const [i,n]of Object.entries(m.charge)){const item=i as Item,used=Math.floor(n!*worked/m.minutes),delta=used-(p.consumed[item]??0);m.stock[item]=(m.stock[item]??0)-delta;p.consumed[item]=used;}
 m.lastAt=w.minute;m.worked=worked;
 if(worked+1e-8>=m.minutes){m.worked=m.minutes;m.status='completed';m.completedAt=w.minute;b.definition=m.to;r.activity.remaining=0;emitEvent(w,{kind:'construction',actors:[r.id],place:{...b.door},roomId:null,text:`${r.name}完成原址屋面改版，实际投入${m.charge.wood??0}木、${m.charge.stone??0}石及${m.minutes}分钟劳动。原住户、内室、工位、钱货、未完批次与聘约保持原状；不增加容量或恢复屋况。`});}
 return null;
}
export function advanceResidentUpgrades(w:World){
 for(const m of w.buildingMigrations??[]){const p=m.residentProposal;if(!p)continue;const b=w.buildings.find(b=>b.id===m.buildingId),proposer=w.residents.find(r=>r.id===p.proposerId);
  if(active(m)){const reason=!b?'原建筑已不存在':currentReason(w,m,b);if(reason)stop(w,m,reason,w.minute>=m.expiresAt?'expired':'cancelled');}
  if(proposer?.status==='dead'&&nonempty(m.stock)){const bag=estateStock(w,proposer.id,'building-upgrade:'+m.id,{at:{...p.stockAt},inside:null,roomAt:null,label:'居民屋面原址未用材料'});if(bag){add(bag,m.stock);m.stock={};}}
 }
}
export function residentUpgradeOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!capable(w,r)||w.mode!=='formal')return [];
 const rows:FormalOpportunity[]=[];
 const addChoice=(id:string,label:string,action:BuildingMigrationAction)=>{if(!residentUpgradeReason(w,r,action))rows.push({id:'buildingMigration.'+id,label,action});};
 const sites=w.buildings.filter(b=>local(r,b)&&(b.ownerId===r.id||currentPremisesLease(w,b.id)?.tenantId===r.id));
 const offset=Math.floor(w.minute/30)%Math.max(1,sites.length);
 for(let i=0;i<Math.min(3,sites.length);i++){const b=sites[(offset+i)%sites.length];for(const roof of ['wood','slate'] as const){const q=quote(b,roof);addChoice(`propose.${b.id}.${roof}`,`到${b.name}门外提议${roof==='wood'?'木面':'石板'}屋面：本人${q.charge.wood??0}木、${q.charge.stone??0}石与${q.minutes}分钟劳动，7日内各当事人分别阅读和同意；原用途、住户、租约、工资、库存及屋况不变`,{type:'buildingMigration',operation:'propose',buildingId:b.id,roof});}}
 for(const m of w.buildingMigrations??[]){const p=m.residentProposal,b=w.buildings.find(b=>b.id===m.buildingId);if(!p)continue;const party=p.parties.find(p=>p.residentId===r.id);if(!party&&p.proposerId!==r.id)continue;
  // No remote proposal broadcast. Once personally read, only that recorded proposal is remembered.
  if(p.proposerId!==r.id&&party?.reviewedAt===null&&(!b||!local(r,b)))continue;
  const label=`${b?.name??'原建筑'}屋面（${p.roof==='wood'?'木面':'石板'}，本人原权利不变，${m.charge.wood??0}木${m.charge.stone??0}石由提议人提供，${m.worked}/${m.minutes}分钟）`;
  for(const [operation,description]of [['review','到原址亲自阅读具体条款'],['accept','本人独立同意'],['decline','本人拒绝，原约继续'],['revoke','撤回本人同意，停止后续施工'],['begin','带足本人材料，在全体同意后预留开工'],['work','本人继续30分钟实际劳动（可填minutes 1–120）'],['cancel','提议人停止方案'],['collect','本人到原址领取未用材料']] as const)addChoice(m.id+'.'+operation,`${description}：${label}`,{type:'buildingMigration',operation,migrationId:m.id,...(operation==='work'?{minutes:30}:{})});
 }
 return rows;
}
