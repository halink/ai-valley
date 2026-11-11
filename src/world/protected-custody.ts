import type {FormalOpportunity,Inventory,Item,Resident,Vec,World} from '../shared/types.js';
import type {InheritanceShare,ProductionAction,ProtectedCustodyMandate,ProtectedCustodyScope} from '../shared/production.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {roomLayout} from '../shared/rooms.js';
import {knownAgeYears,DAY} from './time.js';
import {coLocated,nearLocation} from './proximity.js';
import {distance,same} from './navigation.js';
import {estateHeirs,prepareShares} from './production.js';
import {pendingEstateReturns} from './estate-pending.js';
import {hasEstateDebt} from './debt.js';
import {deathProof} from './knowledge.js';
import {industryAssets} from './industry.js';
import {industryDefinition} from './industry-rules.js';
import {animalProducts} from './livestock-life.js';
import {recordLivestockNourishment,cropYieldAt,recordFieldHarvest} from './frontier-nutrients.js';
import {atEstateLocation,estateParcel,type EstateLocation} from './estate-custody.js';
import {routeFood} from './food-routes.js';
import {recordFoodFlow} from './food-consumption-evidence.js';
import {moveCoins,salesLevy,commitLevyForPolicy} from './economy.js';
import {canInspectBuilding} from './building-knowledge.js';
import {emitEvent} from './events.js';

const present=(r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside';
const capable=(r:Resident|undefined):r is Resident=>present(r)&&r.canDecide&&r.canExpress;
const adult=(w:World,r:Resident|undefined):r is Resident=>capable(r)&&(knownAgeYears(r.bornAt,w.minute)??-1)>=18;
const minor=(w:World,r:Resident|undefined):r is Resident=>{if(!present(r))return false;const age=knownAgeYears(r.bornAt,w.minute);return age!==null&&age<18;};
const person=(w:World,id?:string)=>w.residents.find(p=>p.id===id);
const whole=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const live=(c:ProtectedCustodyMandate)=>c.status==='offered'||c.status==='active';
const get=(w:World,id?:string)=>w.production?.protectedCustody?.mandates.find(c=>c.id===id);
const state=(w:World)=>w.production!.protectedCustody??={nextSerial:1,mandates:[],sales:[]};
export const isCustodyAction=(a:ProductionAction)=>a.operation.startsWith('custody');
const signature=(a:ProductionAction)=>['custodyOffer','custodyAccept','custodyReview','custodyObject','custodyEnd'].includes(a.operation);
function share(w:World,c:ProtectedCustodyMandate){return w.production?.inheritances[c.estateId]?.shares.find(s=>s.heirId===c.childId&&s.claimedAt===null&&(!c.shareId||s.id===c.shareId));}
function estateProblem(w:World,id:string){
 const estate=w.estates.find(e=>e.personId===id);
 if(!estate||estate.status!=='protected')return '原遗产不再处于保全状态';
 const claims=w.production?.inheritances[id]?.shares.filter(s=>s.claimedAt===null).reduce((n,s)=>n+s.coins,0)??0;
 if(claims>estate.coins)return '既有登记现金份额大于实际保全余额，须先复核，不能挪用其他人的份额';
 return pendingEstateReturns(w,id)??(hasEstateDebt(w,id)?'既有债务尚未结清，不能动用受保护份额':null)
  ??(estateHeirs(w,id).some(id=>id.startsWith('unborn:'))?'未出生份额尚未确定，不能先分割经营权益':null);
}
/** Read-only preview follows the same deterministic asset allocation as inheritance. */
function entitlement(w:World,id:string,childId:string):Pick<InheritanceShare,'coins'|'plots'|'buildings'|'industryAssets'>|undefined{
 const saved=w.production?.inheritances[id];if(saved)return saved.shares.find(s=>s.heirId===childId&&s.claimedAt===null);
 const heirs=estateHeirs(w,id),index=heirs.indexOf(childId),estate=w.estates.find(e=>e.personId===id);if(index<0||!estate)return;
 return {coins:Math.floor(estate.coins/heirs.length)+(index<estate.coins%heirs.length?1:0),
  plots:w.plots.filter(p=>p.ownerId===id).sort((a,b)=>a.id.localeCompare(b.id)).filter((_,i)=>i%heirs.length===index).map(p=>p.id),
  buildings:w.buildings.filter(b=>b.ownerId===id).sort((a,b)=>a.id.localeCompare(b.id)).filter((_,i)=>i%heirs.length===index).map(b=>b.id),
  industryAssets:industryAssets(w,id).sort().filter((_,i)=>i%heirs.length===index)};
}
function guardians(w:World,p:Resident){return [...new Set(p.guardianIds.filter(id=>person(w,id)?.status==='alive'))].sort();}
function matches(a:string[],b:string[]){return [...a].sort().join('\0')===[...b].sort().join('\0');}
function financiallyConnected(w:World,a:string,b:string){
 if(a===b)return true;
 if(w.household?.pools.some(p=>['offered','open'].includes(p.status)&&p.credits.some(c=>c.ownerId===a)&&p.credits.some(c=>c.ownerId===b)))return true;
 if(w.employment?.contracts.some(c=>c.status==='active'&&[c.employerId,c.workerId].includes(a)&&[c.employerId,c.workerId].includes(b)))return true;
 if(w.debt?.loans.some(l=>['offered','active','overdue'].includes(l.status)&&[l.ownerId,l.borrowerId].includes(a)&&[l.ownerId,l.borrowerId].includes(b)))return true;
 return [[a,b],[b,a]].some(([from,to])=>person(w,from)?.relations.some(r=>r.targetId===to&&(r.partner==='married'||r.partner==='dating')));
}
function independent(w:World,reviewer:Resident|undefined,estateId:string,childId:string,providerId:string,guardianIds:string[]){
 if(!adult(w,reviewer)||[childId,providerId,...guardianIds,...estateHeirs(w,estateId)].includes(reviewer.id))return false;
 return ![estateId,childId,providerId,...guardianIds,...estateHeirs(w,estateId)].some(id=>financiallyConnected(w,reviewer.id,id));
}
function scopeValid(w:World,estateId:string,child:Resident,scope:ProtectedCustodyScope|undefined){
 const right=entitlement(w,estateId,child.id);if(!right||!scope)return false;
 if(![scope.plots,scope.buildings,scope.animals].every(ids=>Array.isArray(ids)&&ids.length<=24&&ids.every(id=>typeof id==='string')&&new Set(ids).size===ids.length))return false;
 if(!scope.plots.length&&!scope.buildings.length&&!scope.animals.length)return false;
 return scope.plots.every(id=>right.plots.includes(id)&&w.plots.some(p=>p.id===id&&p.ownerId===estateId))
  &&scope.buildings.every(id=>right.buildings.includes(id)&&w.buildings.some(b=>b.id===id&&b.ownerId===estateId&&b.residents.includes(child.id)))
  &&scope.animals.every(id=>right.industryAssets?.includes(id)&&w.industry?.animals.some(n=>n.id===id&&n.ownerId===estateId&&n.status==='alive'));
}
function scopeLabel(w:World,scope:ProtectedCustodyScope){return [...scope.plots.map(id=>{const p=w.plots.find(p=>p.id===id);return `田${id}(${p?.at.x},${p?.at.y})`;}),...scope.buildings.map(id=>w.buildings.find(b=>b.id===id)?.name??id),...scope.animals.map(id=>`牲畜${id}`)].join('、');}
function scopeObserved(w:World,r:Resident,scope:ProtectedCustodyScope){
 return scope.plots.every(id=>w.plots.some(p=>p.id===id&&!r.inside&&distance(r.at,p.at)<=8))
  &&scope.buildings.every(id=>w.buildings.some(b=>b.id===id&&r.knownBuildings.includes(id)&&canInspectBuilding(w,r,b)))
  &&scope.animals.every(id=>{const loc=animalLocation(w,id);return !!loc&&nearLocation(w,r,loc,8);});
}
function animalLocation(w:World,id?:string):EstateLocation|undefined{
 const n=w.industry?.animals.find(n=>n.id===id),b=w.buildings.find(b=>b.id===n?.barnId);if(!n||!b||b.condition<=0)return;
 const inside=n.at?n.inside??null:b.id,layout=roomLayout(w,b);
 return {at:{...(n.at??b.door)},inside,roomAt:inside?n.roomAt??layout.slots.find(s=>s.key==='pen:'+(n.pen??0))?.at??layout.entry:null,label:b.name+'的原处产物'};
}
function proposalLocations(w:World,scope:ProtectedCustodyScope){
 const locations:ProtectedCustodyMandate['locations']={};
 for(const id of scope.plots){const p=w.plots.find(p=>p.id===id)!;locations[id]={at:{...p.at},inside:null,roomAt:null,label:'受保护田地原址'};}
 for(const id of scope.buildings){const b=w.buildings.find(b=>b.id===id)!;locations[id]={at:{...b.door},inside:null,roomAt:null,label:b.name};}
 for(const id of scope.animals)locations[id]=structuredClone(animalLocation(w,id)!);return locations;
}
export function custodyWorkLocation(w:World,a:ProductionAction):EstateLocation|undefined{
 if(a.operation==='custodyInspect')return get(w,a.custodyId)?.locations[a.custodyAssetId??''];
 if(a.operation==='custodyBuy')return estateParcel(w,w.production?.protectedCustody?.sales.find(s=>s.id===a.saleId)?.parcelId)?.location;
 if(a.operation==='custodySell')return estateParcel(w,a.parcelId)?.location;
 if(['custodyFeedAnimal','custodyWaterAnimal','custodyCollectAnimal'].includes(a.operation))return animalLocation(w,a.animalId);
 if(a.operation==='custodyWater'||a.operation==='custodyHarvest'){const p=w.plots.find(p=>p.id===a.plotId);if(p)return {at:{...p.at},inside:null,roomAt:null,label:'受保护田地原址收成'};}
 if(a.operation==='custodyRepair'){const b=w.buildings.find(b=>b.id===a.buildingId);if(b)return {at:{...b.door},inside:null,roomAt:null,label:b.name+'门外修护'};}
}

function consentProblem(w:World,c:ProtectedCustodyMandate){
 const child=person(w,c.childId);
 if(child&&knownAgeYears(child.bornAt,w.minute)===null)return '受益人年龄无法核实，不能推定未成年身份或幼儿同意豁免';
 if(!minor(w,child))return '受益人已成年、离谷或不再存活';
 if(c.status==='active'&&(knownAgeYears(child.bornAt,w.minute)??-1)>=6&&!c.acceptedBy.includes(child.id))return '孩子现已达到独立答复年龄，须本人另行同意新委托';
 if(!adult(w,person(w,c.providerId)))return '原代管人当前无法继续承担有限劳动';
 if(!matches(guardians(w,child),c.guardianIds))return '现有监护关系已变化，须重新分别确认';
 if(c.guardianIds.some(id=>!adult(w,person(w,id))))return '原监护人当前的成年身份或决定能力无法确认，不能继续代用幼儿权限';
 if(!independent(w,person(w,c.reviewerId),c.estateId,c.childId,c.providerId,c.guardianIds))return '复核人的独立性或资格已改变';
 if(!scopeValid(w,c.estateId,child,c.scope))return '原受保护资产、份额或孩子居住使用权已经变化';
 return estateProblem(w,c.estateId);
}
function required(w:World,c:ProtectedCustodyMandate){const p=person(w,c.childId)!,age=knownAgeYears(p.bornAt,w.minute);return [...c.guardianIds,...(age===null||age>=6?[p.id]:[])];}
function fact(w:World,r:Resident,c:ProtectedCustodyMandate,text:string){return emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},text,audit:{rule:'estate/protected-custody@1',authority:'分别接受的有限财产保全委托',evidence:c.id,scope:['no-title-transfer','protected-revenue','capped-expenses'],providerId:c.providerId,resources:{},termination:'本人异议、撤回、资格或财产变化、固定期限届满或成年即结束'}});}
function finish(w:World,c:ProtectedCustodyMandate,status:ProtectedCustodyMandate['status'],reason:string){
 if(!live(c))return;c.status=status;c.endedAt=w.minute;c.reason=reason;
 const s=share(w,c);c.handback={at:w.minute,coins:s?.coins??0,parcelIds:[...(s?.goodsClaims??[])]};
 for(const sale of w.production?.protectedCustody?.sales??[])if(sale.custodyId===c.id&&sale.status==='offered')sale.status='cancelled';
 // This is a legal termination record, not a message that reveals remote facts to residents.
 emitEvent(w,{kind:'production',actors:[],witnesses:[],place:{...(person(w,c.childId)?.at??w.map.entrance)},text:`${c.id}临时代管结束：${reason}。账目与原址财产继续归受保护份额；成年者须另行办理继承和实际取货。`});
}
export function advanceProtectedCustody(w:World){
 for(const c of w.production?.protectedCustody?.mandates??[]){if(!live(c))continue;
  const p=person(w,c.childId);
  if(p&&(knownAgeYears(p.bornAt,w.minute)??-1)>=18){finish(w,c,'adult','孩子成年，原代管权限停止');continue;}
  if(w.minute>=c.expiresAt||c.status==='offered'&&w.minute>=c.offerExpiresAt){finish(w,c,'expired','原固定期限届满，不自动续期');continue;}
  const error=consentProblem(w,c);if(error)finish(w,c,'invalid',error);
 }
 for(const s of w.production?.protectedCustody?.sales??[])if(s.status==='offered'&&s.expiresAt<=w.minute)s.status='cancelled';
}
function freshQuantity(w:World,id:string,item:Item,n:number){const lots=w.food?.lots[id]?.[item];return !lots?.some(l=>l.quantity>0&&l.expiresAt<=w.minute)&&(lots?.reduce((s,l)=>s+l.quantity,0)??0)>=n;}
function reimbursement(a:ProductionAction){return a.operation==='custodyRepair'?3:['custodyWater','custodyFeedAnimal','custodyWaterAnimal'].includes(a.operation)?1:0;}
function materials(a:ProductionAction):Inventory{return a.operation==='custodyRepair'?{wood:2,stone:1}:a.operation==='custodyFeedAnimal'?{fodder:1}:['custodyWater','custodyWaterAnimal'].includes(a.operation)?{water:1}:{};}
export function custodyReason(w:World,r:Resident,a:ProductionAction):string|null{
 const fields=['plotId','buildingId','animalId','parcelId','saleId','custodyAssetId'] as const;
 const allowed=a.operation==='custodyInspect'?['custodyAssetId']:['custodyWater','custodyHarvest'].includes(a.operation)?['plotId']:a.operation==='custodyRepair'?['buildingId']:['custodyFeedAnimal','custodyWaterAnimal','custodyCollectAnimal'].includes(a.operation)?['animalId']:a.operation==='custodySell'?['parcelId']:a.operation==='custodyBuy'?['saleId','parcelId']:[];
 if(fields.some(key=>a[key]!==undefined&&!allowed.includes(key)))return '行动携带了与原工作无关的资产字段，须重新选择';
 if(w.mode!=='formal'||!w.production||!present(r))return '本人当前不在可办理临时代管的位置';
 const c=get(w,a.custodyId);
 if(a.operation==='custodyObject'||a.operation==='custodyEnd')return c&&w.minute<c.expiresAt&&!c.endKnownBy.includes(r.id)&&r.canExpress&&[c.childId,c.providerId,c.reviewerId,...c.guardianIds].includes(r.id)?null:'没有本人可提出异议或终止的代管委托';
 if(!capable(r))return '本人当前无法独立作出这一决定';
 if(a.operation==='custodyOffer'){
  const p=person(w,a.targetId),reviewer=person(w,a.reviewerId),id=a.personId??'';
  if(!adult(w,r)||!minor(w,p)||!coLocated(w,r,p,6)||!deathProof(w,r,id))return '须有已核实的死亡证据，并与未成年权利人实际见面';
  if(p.guardianIds.some(id=>{const g=person(w,id);return !g||g.status==='dead'&&!deathProof(w,r,id);}))return '原监护人尚有未核实的去世或身份缺口，不能静默移除其确认权';
  const gs=guardians(w,p);if(!Array.isArray(a.guardianIds)||!a.guardianIds.every(id=>typeof id==='string')||!matches(gs,a.guardianIds)||gs.some(id=>!adult(w,person(w,id))||!coLocated(w,r,person(w,id)!,6)))return '所有当前监护人须有决定能力并实际在场';
  if((knownAgeYears(p.bornAt,w.minute)??-1)>=6?!capable(p):!gs.length)return '需孩子独立表达同意，幼儿则须已有监护人；食品援助不产生监护权限';
  if(!independent(w,reviewer,id,p.id,r.id,gs)||!coLocated(w,r,reviewer!,6))return '需实际在场且没有共同财物、债权或受益冲突的独立成年复核人';
  const error=estateProblem(w,id);if(error)return error;
  if(!scopeValid(w,id,p,a.scope)||!scopeObserved(w,r,a.scope!))return '只能提出本人实际观察过、已核实归该孩子受保护份额的明确资产';
  if(!whole(a.days,1,7)||!whole(a.expenseCap,0,20)||!whole(a.saleCap,0,24)||a.expenseCap>entitlement(w,id,p.id)!.coins)return '须固定1至7日、0至20钱费用和0至24份易腐产物出售上限，且不得超过本人份额';
  if(a.custodyStep!==(w.production.protectedCustody?.nextSerial??1))return '原提议序号已失效，请重新决定';
  if(w.production.protectedCustody?.mandates.some(c=>live(c)&&c.estateId===id&&c.childId===p.id))return '该份额已有未结束委托，不叠加期限与额度';
  return null;
 }
 if(a.operation==='custodyInspect')return c&&r.id===c.providerId&&c.locations[a.custodyAssetId??'']?null:'只能走访本人原委托记录的位置';
 if(!c||!live(c)||w.minute>=c.expiresAt||c.status==='offered'&&w.minute>=c.offerExpiresAt)return '原委托已经终止或超过固定期限';
 const error=consentProblem(w,c);if(error)return error;
 if(a.operation==='custodyAccept'||a.operation==='custodyReview'){
  if(c.status!=='offered')return '原委托已接受，不重复签署';
  if(!coLocated(w,r,person(w,c.providerId)!,6)||!coLocated(w,r,person(w,c.childId)!,6))return '需与原代管人、孩子实际共同确认原范围与限额';
  if(a.operation==='custodyReview')return r.id===c.reviewerId&&c.reviewedAt===null?null:'只有原独立复核人可另行确认利益冲突和费用';
  return required(w,c).includes(r.id)&&!c.acceptedBy.includes(r.id)?null:'原委托不再等待本人的独立答复';
 }
 if(c.status!=='active')return '孩子、监护人和独立复核人尚未分别接受';
 if(a.operation==='custodyBuy'){
  const sale=w.production.protectedCustody?.sales.find(s=>s.id===a.saleId&&s.custodyId===c.id),p=sale&&estateParcel(w,sale.parcelId);
  if(!adult(w,r)||[c.childId,c.providerId,c.reviewerId,...c.guardianIds].includes(r.id)||[c.childId,c.providerId,c.reviewerId,...c.guardianIds,...estateHeirs(w,c.estateId)].some(id=>financiallyConnected(w,r.id,id)))return '此项受保护销售不允许代管人、签署人或其共同利益方自买';
  if(a.parcelId!==undefined&&a.parcelId!==sale?.parcelId)return '买方选择的实物地点与原报价不一致';
  if(!sale||sale.status!=='offered'||sale.expiresAt<=w.minute||!p||!share(w,c)?.goodsClaims?.includes(p.id)||p.claimId!==c.shareId||!freshQuantity(w,p.id,sale.item,sale.quantity)||(p.inventory[sale.item]??0)<sale.quantity||c.sold+sale.quantity>c.saleCap)return '原易腐销售已失效或超出原授权现物数量';
  if(!atEstateLocation(r,p.location))return '买方须亲自到实际存货处核验并决定领取';
  const price=sale.quantity*sale.unitPrice,total=price+salesLevy(w,price,`resident:${r.id}`);
  return whole(a.maxTotal,total,1_000_000)&&r.coins>=total?null:'货款、现行公共附加款或余额已超过本人确认的总额';
 }
 if(r.id!==c.providerId||a.custodyStep!==c.workSerial)return '只有原代管人可执行未重放的本次有限劳动';
 const s=share(w,c);if(!s)return '原受保护份额已变更';
 const cost=reimbursement(a),estate=w.estates.find(e=>e.personId===c.estateId)!;
 if(cost+c.spent>c.expenseCap||cost>s.coins||cost>estate.coins)return '原费用上限或该孩子受保护现金余额不足';
 if(Object.entries(materials(a)).some(([i,n])=>(r.inventory[i as Item]??0)<n!))return '代管人须实际携带并投入自己的约定材料';
 if(a.operation==='custodyWater'||a.operation==='custodyHarvest'){
  const p=w.plots.find(p=>p.id===a.plotId),d=p?.crop&&w.definitions[p.crop.definition];
  if(!p||!c.scope.plots.includes(p.id)||p.ownerId!==c.estateId||!p.crop||!d)return '原范围内没有可照料的实际作物';
  return a.operation==='custodyWater'?p.crop.wateredDay===Math.floor(w.minute/DAY)?'这块田今天已实际浇水':null:p.crop.growth<Number(d.data.growthDays)?'作物尚未成熟':null;
 }
 if(a.operation==='custodyRepair')return c.scope.buildings.includes(a.buildingId??'')&&w.buildings.some(b=>b.id===a.buildingId&&b.ownerId===c.estateId&&b.condition>0&&b.condition<=80&&b.residents.includes(c.childId))?null:'只能修护委托内孩子仍在使用且需要修缮的房屋';
 if(['custodyFeedAnimal','custodyWaterAnimal','custodyCollectAnimal'].includes(a.operation)){
  const n=w.industry?.animals.find(n=>n.id===a.animalId);
  if(!n||!c.scope.animals.includes(n.id)||n.ownerId!==c.estateId||n.status!=='alive'||n.carrierId||!animalLocation(w,n.id))return '原范围内没有可以实际接近的存活动物';
  if(a.operation==='custodyCollectAnimal')return n.product>=1?null:'没有实际产物';
  return (a.operation==='custodyFeedAnimal'?n.hunger:n.thirst)>=20?null:'动物目前不需要重复投入该项材料';
 }
 if(a.operation==='custodySell'){
  const p=estateParcel(w,a.parcelId),item=a.item;
  if(!p||!s.goodsClaims?.includes(p.id)||p.claimId!==c.shareId||p.source!=='custody:'+c.id||!item||!itemKeys.includes(item)||goods[item].life<=0||!whole(a.quantity,1,12)||!freshQuantity(w,p.id,item,a.quantity)||(p.inventory[item]??0)<a.quantity)return '只可出售本委托实际生产、尚未过期且仍在原处的明确易腐产物';
  const pending=(w.production.protectedCustody?.sales??[]).filter(s=>s.custodyId===c.id&&s.status==='offered'&&s.expiresAt>w.minute);
  if(c.sold+pending.reduce((n,s)=>n+s.quantity,0)+a.quantity>c.saleCap||pending.some(s=>s.parcelId===p.id&&s.item===item))return '原销售上限或同一产物现有报价已占用，不能重复出售';
  return null;
 }
 return '没有这项受保护代管行动';
}
/** Only called at the actual doorway, never to filter a remote inspection choice. */
export function custodyInspectionEntryProblem(w:World,r:Resident,a:ProductionAction):string|null {
 const c=get(w,a.custodyId),loc=c?.locations[a.custodyAssetId??''];
 if(!c||!loc?.inside)return null;
 if(c.status!=='active'||w.minute>=c.expiresAt||consentProblem(w,c))return '本人到原址后未能核实继续进入或作业的权限，须重新确认，未进入他人室内';
 return null;
}
export function noteCustodyInspectionFailure(w:World,r:Resident,a:ProductionAction){const c=get(w,a.custodyId);if(c&&!live(c)&&!c.endKnownBy.includes(r.id))c.endKnownBy.push(r.id);}

export function custodyTarget(w:World,r:Resident,a:ProductionAction):{target:Vec;duration:number;error?:string}{
 const error=custodyReason(w,r,a);if(error)return {target:{...r.at},duration:0,error};
 if(signature(a))return {target:{...r.at},duration:1};
 const loc=custodyWorkLocation(w,a);if(!loc||loc.regional)return {target:{...r.at},duration:0,error:'原工作或现物位置已失效'};
 return {target:{...loc.at},duration:a.operation==='custodyInspect'?1:a.operation==='custodyRepair'?60:a.operation==='custodyHarvest'?20:a.operation==='custodyBuy'||a.operation==='custodySell'?5:15};
}
function output(w:World,c:ProtectedCustodyMandate,location:EstateLocation,inventory:Inventory){
 const e=w.estates.find(e=>e.personId===c.estateId)!,s=share(w,c)!,id=`custody-stock:${c.id}:${c.workSerial}`;
 (e.parcels??=[]).push({id,ownerId:c.estateId,claimId:s.id,inventory:{...inventory},location:structuredClone(location),createdAt:w.minute,source:'custody:'+c.id});
 (s.goodsClaims??=[]).push(id);for(const [i,n]of Object.entries(inventory))s.inventory[i as Item]=(s.inventory[i as Item]??0)+n!;return id;
}
export function completeCustody(w:World,r:Resident,a:ProductionAction):string|null{
 const error=custodyReason(w,r,a);if(error)return error;
 if(a.operation==='custodyOffer'){
  const ss=state(w),c:ProtectedCustodyMandate={id:`custody:${w.id}:${ss.nextSerial++}`,estateId:a.personId!,childId:a.targetId!,providerId:r.id,reviewerId:a.reviewerId!,guardianIds:[...a.guardianIds!],acceptedBy:[],reviewedAt:null,createdAt:w.minute,expiresAt:w.minute+a.days!*DAY,offerExpiresAt:w.minute+DAY,scope:structuredClone(a.scope!),locations:proposalLocations(w,a.scope!),workSerial:0,expenseCap:a.expenseCap!,saleCap:a.saleCap!,spent:0,sold:0,revenue:0,status:'offered',endedAt:null,reason:null,endKnownBy:[],shareId:null,records:[]};ss.mandates.push(c);
  fact(w,r,c,`${r.name}提出${a.days}日临时代管，列明${c.scope.plots.length}块田、${c.scope.buildings.length}处孩子使用的房屋、${c.scope.animals.length}只牲畜；费用累计至多${c.expenseCap}钱（每次水/饲料1钱、2木1石修护3钱），易腐产物至多${c.saleCap}份按每份2钱出售，收入归孩子。等待孩子、已有监护人和独立复核人分别确认；不新增监护、住房或产权。`);return null;
 }
 const c=get(w,a.custodyId)!;
 if(a.operation==='custodyObject'||a.operation==='custodyEnd'){finish(w,c,a.operation==='custodyObject'?'objected':'ended',a.operation==='custodyObject'?'当事人提出异议，后续权限立即停止；重新复核须另提委托':'当事人自行结束委托');const e=fact(w,r,c,`${r.name}声明终止${c.id}的后续代管安排；保留已发生劳动、收支和原址实物，不能追溯扩大权限。`);c.endKnownBy=[...new Set([...c.endKnownBy,...e.witnesses])];return null;}
 if(a.operation==='custodyAccept'||a.operation==='custodyReview'){
  if(a.operation==='custodyReview')c.reviewedAt=w.minute;else c.acceptedBy.push(r.id);
  if(c.reviewedAt!==null&&required(w,c).every(id=>c.acceptedBy.includes(id))){const s=prepareShares(w,c.estateId).find(s=>s.heirId===c.childId&&s.claimedAt===null)!;c.shareId=s.id;c.status='active';}
  fact(w,r,c,`${r.name}${a.operation==='custodyReview'?'独立复核了受保护份额、共同财物、债务和代管人报销利益':'分别接受了同一资产、固定期限及费用/销售上限'}；${c.status==='active'?'有限委托成立':'仍待其他当事人自行决定'}。`);return null;
 }
 const loc=custodyWorkLocation(w,a)!;if(!same(r.at,loc.at)||!atEstateLocation(r,loc))return '须本人实际抵达工作/存货原址和室内位置，门外不等于完成';
 if(a.operation==='custodyInspect'){const entry=custodyInspectionEntryProblem(w,r,a);if(entry)return entry;if(!live(c)&&!c.endKnownBy.includes(r.id))c.endKnownBy.push(r.id);fact(w,r,c,`${r.name}按原委托记录亲自到达${loc.label??'原处'}查看，具体劳动仍须本人根据当前眼前情形另选。`);return null;}
 if(a.operation==='custodyBuy'){
  const sale=state(w).sales.find(s=>s.id===a.saleId)!,p=estateParcel(w,sale.parcelId)!,s=share(w,c)!,price=sale.quantity*sale.unitPrice,levy=salesLevy(w,price,`resident:${r.id}`),ref=sale.id+':sale';
  if(!moveCoins(w,`resident:${r.id}`,`estate:${c.estateId}`,price,'代管易腐产物收入归受保护份额',ref))return '货款未能完成交付';
  if(levy&&!moveCoins(w,`resident:${r.id}`,'treasury',levy,'代管产物成交公共附加款',ref+':tax'))throw new Error('custody_tax_commit_failed');
  const policy=w.civic?.salesTax;if(policy&&policy.expiresAt>w.minute)commitLevyForPolicy(w,price,`resident:${r.id}`,policy.proposalId,policy.basisPoints);
  p.inventory[sale.item]!-=sale.quantity;r.inventory[sale.item]=(r.inventory[sale.item]??0)+sale.quantity;routeFood(w,p.id,'person:'+r.id,{[sale.item]:sale.quantity});
  s.inventory[sale.item]=Math.max(0,(s.inventory[sale.item]??0)-sale.quantity);s.coins+=price;c.revenue+=price;c.sold+=sale.quantity;sale.status='sold';sale.buyerId=r.id;
  c.records.push({id:ref,at:w.minute,actorId:r.id,operation:a.operation,materials:{},goods:{[sale.item]:sale.quantity},coins:price,targetId:p.id});
  fact(w,r,c,`${r.name}独立到原址购买${sale.quantity}份${itemLabels[sale.item]}，支付${price}钱给孩子受保护份额及${levy}钱公共附加款；代管人未取得货款。`);return null;
 }
 const cost=reimbursement(a),input=materials(a),recordId=`${c.id}:work:${c.workSerial}`,s=share(w,c)!;let produced:Inventory={},target=a.plotId??a.animalId??a.buildingId??a.parcelId??'';
 let harvest:{definition:string;sourceId:string;container:string;workSerial:number}|undefined;
 if(cost&&!moveCoins(w,`estate:${c.estateId}`,`resident:${r.id}`,cost,'已批准且实际投入的代管维护报销',recordId))return '原费用未能结算，尚未扣材料或改变实物';
 for(const [i,n]of Object.entries(input))r.inventory[i as Item]!-=n!;c.spent+=cost;s.coins-=cost;
 if(a.operation==='custodyWater')w.plots.find(p=>p.id===a.plotId)!.crop!.wateredDay=Math.floor(w.minute/DAY);
 if(a.operation==='custodyHarvest'){
  const p=w.plots.find(p=>p.id===a.plotId)!,definition=p.crop!.definition,d=w.definitions[definition],item=(d.data.output??'turnip') as Item,amount=cropYieldAt(w,p,Number(d.data.yield));
  produced={[item]:amount};const container=output(w,c,loc,produced);p.crop=null;recordFieldHarvest(w,p.id,amount);r.skills.farming+=.02;
  if(goods[item]?.food>0&&amount>0)harvest={definition,sourceId:p.id,container,workSerial:c.workSerial};
 }
 if(a.operation==='custodyRepair'){const b=w.buildings.find(b=>b.id===a.buildingId)!;b.condition=Math.min(100,b.condition+20);w.production!.repairs++;r.skills.building+=.02;}
 if(['custodyFeedAnimal','custodyWaterAnimal','custodyCollectAnimal'].includes(a.operation)){const n=w.industry!.animals.find(n=>n.id===a.animalId)!,rules=industryDefinition(w,n.definition).rules;
  if(a.operation==='custodyWaterAnimal'){n.thirst=Math.max(0,n.thirst-rules.animalWaterRelief);n.lastCaredAt=w.minute;}
  if(a.operation==='custodyFeedAnimal'){const old=n.hunger;n.hunger=Math.max(0,n.hunger-rules.animalFeedRelief);recordLivestockNourishment(w,n,old-n.hunger);n.lastCaredAt=w.minute;}
  if(a.operation==='custodyCollectAnimal'){const item=animalProducts[n.kind];produced={[item]:n.product};const id=output(w,c,loc,produced);routeFood(w,'animal-stock:'+n.id,id,produced);w.industry!.totals.animalProducts+=n.product;n.product=0;}
 }
 if(a.operation==='custodySell'){const ss=state(w);ss.sales.push({id:`custody-sale:${c.id}:${c.workSerial}`,custodyId:c.id,parcelId:a.parcelId!,item:a.item!,quantity:a.quantity!,unitPrice:2,createdAt:w.minute,expiresAt:Math.min(w.minute+DAY,c.expiresAt),status:'offered',buyerId:null});}
 c.workSerial++;
 c.records.push({id:recordId,at:w.minute,actorId:r.id,operation:a.operation,materials:{...input},goods:produced,coins:cost?-cost:0,targetId:target});
 const event=fact(w,r,c,`${r.name}实际完成${{custodyWater:'田地浇水',custodyHarvest:'成熟作物收获',custodyRepair:'孩子使用房屋修护',custodyFeedAnimal:'牲畜喂料',custodyWaterAnimal:'牲畜供水',custodyCollectAnimal:'牲畜产物收集',custodySell:'原址易腐产物报价'}[a.operation as 'custodyWater']}；本次材料${Object.entries(input).map(([i,n])=>n+itemLabels[i as Item]).join('、')||'无'}、报销${cost}钱，累计${c.spent}/${c.expenseCap}钱。产物保留实际原址并归孩子受保护份额。`);
 if(harvest&&r.activity?.action===a&&r.activity.remaining<=0)recordFoodFlow(w,{type:'source_added',action:'custody_harvest',at:w.minute,
  residentId:r.id,eventId:event.id,planId:r.activity.planId,...harvest,custodyId:c.id,estateOwnerId:c.estateId,beneficiaryId:c.childId,shareId:s.id,output:produced});
 return null;
}

/** Menus describe observed assets and the immutable proposal; they never prepare shares. */
export function custodyOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!w.production)return [];const result:FormalOpportunity[]=[];
 const add=(label:string,a:ProductionAction)=>{if(!custodyTarget(w,r,a).error)result.push({id:`production.${a.operation}.${a.custodyId??a.targetId??''}.${a.reviewerId??a.plotId??a.animalId??a.buildingId??a.saleId??a.parcelId??''}`,label,action:a});};
 for(const c of w.production.protectedCustody?.mandates??[]){
  if(c.providerId===r.id)for(const [id,loc]of Object.entries(c.locations))if(!nearLocation(w,r,loc,6))add(`按原委托记录亲自到${loc.label??id}查看，再决定是否劳动；当前远处情况未知`,{type:'production',operation:'custodyInspect',custodyId:c.id,custodyAssetId:id});
  const who=person(w,c.childId)?.name??'原权利人',details=`${who}的${scopeLabel(w,c.scope)}，至${Math.ceil(c.expiresAt)}分，费用上限${c.expenseCap}钱、易腐销售${c.saleCap}份，每份2钱，实际投入水/饲料每次报销1钱、2木1石修护报销3钱`;
  add(`独立接受临时代管：${details}，不转移产权或监护`,{type:'production',operation:'custodyAccept',custodyId:c.id});
  add(`独立复核并接受临时代管的份额、既有债务和报销利益冲突：${details}`,{type:'production',operation:'custodyReview',custodyId:c.id});
  add('提出异议并立即停止这项临时代管，已发生记录保留，重新安排须另行复核',{type:'production',operation:'custodyObject',custodyId:c.id});
  add('结束这项临时代管并归还后续经营权，钱物继续在原处保全',{type:'production',operation:'custodyEnd',custodyId:c.id});
  if(c.status!=='active'||c.providerId!==r.id)continue;const base={type:'production' as const,custodyId:c.id,custodyStep:c.workSerial};
  for(const plotId of c.scope.plots){const p=w.plots.find(p=>p.id===plotId);if(!p||r.inside||distance(r.at,p.at)>8)continue;add('亲自为委托内田地投入1水浇灌，按原额度报销1钱',{...base,operation:'custodyWater',plotId});add('实际收获委托内成熟作物，留在田地原址并记入孩子份额',{...base,operation:'custodyHarvest',plotId});}
  for(const buildingId of c.scope.buildings){const b=w.buildings.find(b=>b.id===buildingId);if(b&&canInspectBuilding(w,r,b))add('亲自投入2木1石修护孩子仍在使用的受托房屋，按原额度报销3钱',{...base,operation:'custodyRepair',buildingId});}
  for(const animalId of c.scope.animals){const loc=animalLocation(w,animalId);if(!loc||!nearLocation(w,r,loc,8))continue;add('亲自投入1水照料受托牲畜，按原额度报销1钱',{...base,operation:'custodyWaterAnimal',animalId});add('亲自投入1饲料照料受托牲畜，按原额度报销1钱',{...base,operation:'custodyFeedAnimal',animalId});add('实际收集受托牲畜产物，原地封存到孩子份额，不装进代管人口袋',{...base,operation:'custodyCollectAnimal',animalId});}
  for(const id of share(w,c)?.goodsClaims??[]){const p=estateParcel(w,id);if(p?.source!=='custody:'+c.id||!nearLocation(w,r,p.location,8))continue;
   for(const item of itemKeys)if(goods[item].life>0&&(p.inventory[item]??0)>0){const quantity=Math.min(12,c.saleCap-c.sold,p.inventory[item]??0);add(`到原址报价出售${quantity}份${itemLabels[item]}，每份2钱全归孩子，须买方另外到场决定`,{...base,operation:'custodySell',parcelId:id,item,quantity});}}

 }
 for(const s of w.production.protectedCustody?.sales??[]){const price=s.quantity*s.unitPrice,total=price+salesLevy(w,price,`resident:${r.id}`);add(`亲自在眼前原址购买${s.quantity}份${itemLabels[s.item]}，总计${total}钱含公共附加款，货款归孩子`,{type:'production',operation:'custodyBuy',custodyId:s.custodyId,saleId:s.id,parcelId:s.parcelId,maxTotal:total});}
 if(!adult(w,r))return result;
 for(const child of w.residents.filter(p=>minor(w,p)&&coLocated(w,r,p,6)))for(const e of w.estates){if(!deathProof(w,r,e.personId)||estateProblem(w,e.personId))continue;
  const rights=entitlement(w,e.personId,child.id);if(!rights)continue;
  const scope:ProtectedCustodyScope={plots:rights.plots.filter(id=>w.plots.some(p=>p.id===id&&!r.inside&&distance(r.at,p.at)<=8)),buildings:rights.buildings.filter(id=>w.buildings.some(b=>b.id===id&&b.residents.includes(child.id)&&r.knownBuildings.includes(id)&&canInspectBuilding(w,r,b))),animals:(rights.industryAssets??[]).filter(id=>{const loc=animalLocation(w,id);return loc&&nearLocation(w,r,loc,8);})};
  for(const reviewer of w.residents.filter(p=>coLocated(w,r,p,6)&&independent(w,p,e.personId,child.id,r.id,guardians(w,child))))add(`向${child.name}提出3日临时代管眼前受保护资产（${scopeLabel(w,scope)}），费用至多${Math.min(12,rights.coins)}钱、易腐销售至多12份每份2钱；${reviewer.name}须另行复核，孩子及现有监护人分别接受`,{type:'production',operation:'custodyOffer',personId:e.personId,targetId:child.id,reviewerId:reviewer.id,guardianIds:guardians(w,child),scope,days:3,expenseCap:Math.min(12,rights.coins),saleCap:12,custodyStep:w.production.protectedCustody?.nextSerial??1});
 }
 return result;
}
