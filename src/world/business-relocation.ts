import type {Building,Resident,World} from '../shared/types.js';
import type {BusinessRelocation,BusinessRelocationAction,RelocationEmployee} from '../shared/business-relocation.js';
import {activeBusinessRelocation} from '../shared/business-relocation.js';
import {currentPremisesLease,premisesBusinessRight} from '../shared/premises.js';
import {employmentTermsLabel,relocatedEmploymentReason} from './employment.js';
import {firstReceipt} from './receipts.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {ageYears,DAY} from './time.js';
import {distance,same} from './navigation.js';

const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const local=(r:Resident,b:Building|undefined)=>!!b&&distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id);
const nonempty=(bag:object)=>Object.values(bag).some(n=>typeof n==='number'&&n>0);
const site=(w:World,id:string)=>w.buildings.find(b=>b.id===id);
function destinationReason(w:World,ownerId:string,id:string,ignore?:string):string|null {
 const b=site(w,id);
 if(!b||!premisesBusinessRight(w,ownerId,b)||!['workshop','store'].includes(b.kind)||b.residents.length||w.residents.some(r=>r.homeId===id))return '新址须为本人自有或有效租约允许的完好非住宅工坊或店面，不影响住户';
 if(w.economy?.businesses.some(s=>s.buildingId===id&&(s.closedAt===null||nonempty(s.inventory)))||w.economy?.relocations?.some(m=>m.id!==ignore&&['preparing','moving'].includes(m.status)&&m.toBuildingId===id))return '新址已有经营、原址库存或另一份搬迁安排';
 if(w.economy?.leases?.some(l=>l.buildingId===id&&l.status==='offered'))return '新址还有待签订的租赁报价';
 if(w.construction?.projects.some(p=>p.base?.id===id&&!['completed','cancelled','abandoned'].includes(p.status))||w.buildingMigrations?.some(m=>m.buildingId===id&&['offered','accepted'].includes(m.status)))return '新址仍有施工或改版承诺';
 return null;
}
function sourceReason(w:World,m:BusinessRelocation):string|null {
 const b=w.economy?.businesses.find(b=>b.id===m.businessId),s=site(w,m.fromBuildingId);
 return b&&b.ownerId===m.ownerId&&b.closedAt===null&&b.buildingId===m.fromBuildingId&&s&&premisesBusinessRight(w,m.ownerId,s)?null:'原商铺或原址经营权已经改变';
}
function rightsReason(w:World,m:BusinessRelocation):string|null {
 const error=destinationReason(w,m.ownerId,m.toBuildingId,m.id);if(error)return error;
 return site(w,m.toBuildingId)?.ownerId===m.destinationOwnerId&&(currentPremisesLease(w,m.toBuildingId)?.id??null)===m.destinationLeaseId?null:'新址产权或租约与提议时不同，须撤回并重新商议';
}
function matches(w:World,m:BusinessRelocation,e:RelocationEmployee){
 const c=w.employment?.contracts.find(c=>c.id===e.contractId);
 return c&&c.status==='active'&&c.businessId===m.businessId&&c.buildingId===m.fromBuildingId&&c.employerId===m.ownerId&&c.workerId===e.workerId&&c.startDay===e.startDay&&c.endDay===e.endDay&&c.account===e.account&&c.recipeDefinition===e.recipeDefinition&&JSON.stringify(c.terms)===JSON.stringify(e.terms)?c:undefined;
}
function readyReason(w:World,m:BusinessRelocation):string|null {
 const rights=rightsReason(w,m);if(rights)return rights;
 if(w.economy!.listings.some(l=>l.businessId===m.businessId&&l.status==='open'))return '旧址报价须先按原约成交、到期或由店主撤回，不能把订单搬到新址';
 if(w.employment?.posts.some(p=>p.businessId===m.businessId&&(['open','offered'].includes(p.status)||p.offer)))return '旧址招聘及待接受工资预留须先结清';
 for(const c of w.employment?.contracts.filter(c=>c.businessId===m.businessId)??[]){
  if(c.batch)return '原工位仍有未完原料，须先完成或按原聘约结算取回';
  if(c.status!=='active')continue;
  const e=m.employees.find(e=>e.contractId===c.id);
  if(!e||e.acceptedAt===null||!matches(w,m,e))return '每位仍在聘的员工须亲自确认同一新址、工位、报酬及搬迁暂停条款';
  const worker=w.residents.find(r=>r.id===c.workerId);
  if(!worker||!capable(w,worker))return '受雇者当前不能履行原聘约';
  const conflict=relocatedEmploymentReason(w,c,m.toBuildingId);if(conflict)return conflict;
 }
 if(w.residents.some(r=>r.activity?.action.type==='employment'&&r.activity.action.operation==='work'&&w.employment?.contracts.some(c=>c.id===(r.activity!.action as {contractId?:string}).contractId&&c.businessId===m.businessId)))return '员工仍在前往或履行旧址工作，须待本次行动结束';
 return null;
}
export function businessRelocationReason(w:World,r:Resident,a:BusinessRelocationAction):string|null {
 if(w.mode!=='formal'||!w.economy||!capable(w,r))return '本人当前不能办理经营迁址';
 if(a.operation==='propose'){
  const b=w.economy.businesses.find(b=>b.id===a.businessId);
  if(!b||b.ownerId!==r.id||b.closedAt!==null||b.buildingId!==a.fromBuildingId||!local(r,site(w,b.buildingId)))return '店主须在原店现场提出具体迁址';
  if(activeBusinessRelocation(w,b.id))return '本店已有尚未结束的迁址安排';
  if(!a.toBuildingId||a.toBuildingId===b.buildingId||!r.knownBuildings.includes(a.toBuildingId))return '新址须为本人已知的另一处场所';
  if(!premisesBusinessRight(w,r.id,site(w,b.buildingId)!))return '原址经营权已失效';
  return destinationReason(w,r.id,a.toBuildingId);
 }
 const m=w.economy.relocations?.find(m=>m.id===a.relocationId);
 if(!m||!['preparing','moving'].includes(m.status)||w.minute>=m.expiresAt)return '这份迁址安排已结束或到期';
 const e=m.employees.find(e=>e.contractId===a.contractId&&e.workerId===r.id);
 if(['review','accept','decline','revoke'].includes(a.operation)){
  if(!e||!matches(w,m,e))return '本人没有这份仍相同的原聘约';
  if(a.operation==='review')return e.reviewedAt===null&&local(r,site(w,m.fromBuildingId))?null:'须先到旧址阅读给本人的迁址条款';
  if(e.reviewedAt===null)return '尚未到原址读到给本人的具体迁址条款';
  if(a.operation==='decline')return e.acceptedAt===null&&e.declinedAt===null?null:'已经答复这份提议';
  if(a.operation==='revoke')return e.acceptedAt!==null?null:'本人尚未同意这份提议';
  if(e.acceptedAt!==null||e.declinedAt!==null||!local(r,site(w,m.toBuildingId)))return '须亲自在新址确认尚未答复的具体工作条件';
  return sourceReason(w,m)??rightsReason(w,m)??relocatedEmploymentReason(w,matches(w,m,e)!,m.toBuildingId);
 }
 if(m.ownerId!==r.id)return '只能办理本人商铺的迁址';
 if(a.operation==='cancel')return null;
 const source=sourceReason(w,m);if(source)return source;
 if(a.operation==='begin')return m.status==='preparing'?readyReason(w,m):'已经开始停工搬运';
 if(a.operation==='finish'){
  if(m.status!=='moving')return '须先结束旧址承诺并按双方同意开始停工搬运';
  const ready=readyReason(w,m);if(ready)return ready;
  if(nonempty(w.economy.businesses.find(b=>b.id===m.businessId)!.inventory))return '旧址仍有库存，须由本人先到旧址领取再实际携带，不能迁址传送货物';
  return null;
 }
 return '未知迁址行动';
}
export function businessRelocationTarget(w:World,r:Resident,a:BusinessRelocationAction){
 const error=businessRelocationReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 if(['cancel','decline','revoke'].includes(a.operation))return {target:{...r.at},duration:1};
 const m=w.economy?.relocations?.find(m=>m.id===a.relocationId);
 const id=a.operation==='propose'?a.fromBuildingId:['accept','finish'].includes(a.operation)?m!.toBuildingId:m!.fromBuildingId;
 return {target:{...site(w,id!)!.door},duration:a.operation==='propose'?5:3};
}
export function completeBusinessRelocation(w:World,r:Resident,a:BusinessRelocationAction):string|null {
 const namespace=`business-relocation:${r.activity?.planId??r.plan?.id??`${r.id}:${r.revision}:${w.revision}`}:${r.activity?.startedAt??w.minute}`;
 const receipt=namespace+':'+JSON.stringify(a),prior=firstReceipt(w,namespace);
 if(prior)return prior===receipt?null:'同一迁址决定不能换成其他条款重放';
 const target=businessRelocationTarget(w,r,a);if(target.error)return target.error;
 if(!same(r.at,target.target)||!['cancel','decline','revoke'].includes(a.operation)&&r.inside!==null)return '须亲自抵达约定场所门前，不能远程改变工作地点';
 const state=w.economy!,m=state.relocations?.find(m=>m.id===a.relocationId);
 if(a.operation==='propose'){
  const id=`business-relocation-${state.nextSerial++}`,b=site(w,a.toBuildingId!)!;
  (state.relocations??=[]).push({id,businessId:a.businessId!,ownerId:r.id,fromBuildingId:a.fromBuildingId!,toBuildingId:b.id,destinationOwnerId:b.ownerId,destinationLeaseId:currentPremisesLease(w,b.id)?.id??null,proposedAt:w.minute,expiresAt:w.minute+7*DAY,beganAt:null,endedAt:null,status:'preparing',reason:null,employees:(w.employment?.contracts.filter(c=>c.businessId===a.businessId&&c.status==='active')??[]).map(c=>({contractId:c.id,workerId:c.workerId,terms:structuredClone(c.terms),startDay:c.startDay,endDay:c.endDay,recipeDefinition:c.recipeDefinition,account:c.account,reviewedAt:null,acceptedAt:null,declinedAt:null})),transferredContractIds:[]});
 }else if(['review','accept','decline','revoke'].includes(a.operation)){
  const e=m!.employees.find(e=>e.contractId===a.contractId)!;
  if(a.operation==='review'){e.reviewedAt=w.minute;if(!r.knownBuildings.includes(m!.toBuildingId))r.knownBuildings.push(m!.toBuildingId);}
  if(a.operation==='accept')e.acceptedAt=w.minute;
  if(a.operation==='decline')e.declinedAt=w.minute;
  if(a.operation==='revoke'){e.acceptedAt=null;e.declinedAt=w.minute;m!.status='preparing';}
 }else if(a.operation==='begin'){m!.status='moving';m!.beganAt=w.minute;}
 else if(a.operation==='cancel'){m!.status='cancelled';m!.endedAt=w.minute;m!.reason='经营者自行撤回，钱货及原址聘约不变';}
 else if(a.operation==='finish'){
  const b=state.businesses.find(b=>b.id===m!.businessId)!;
  for(const c of w.employment?.contracts.filter(c=>c.businessId===b.id&&c.status==='active')??[]){c.buildingId=m!.toBuildingId;m!.transferredContractIds.push(c.id);}
  b.buildingId=m!.toBuildingId;m!.status='completed';m!.endedAt=w.minute;
 }
 w.processed.push(receipt);r.revision++;w.revision++;
 const labels={propose:'提出经营迁址，停止新增旧址订单与招聘',review:'在旧址读到迁址提议与原聘约条款',accept:'在新址独立同意新工位、原报酬与搬运停工；未工作不计薪、原期限不延长',decline:'拒绝经营迁址，原聘约不变',revoke:'撤回迁址同意，原聘约仍在原址',begin:'按各方已确认条款暂停工作并开始实际搬运',finish:'抵达新址后登记营业与已确认聘约；随身货物仍须本人另行入库',cancel:'撤回经营迁址，原址钱货和聘约继续按原权利处理'};
 const record=m??state.relocations!.at(-1)!,employee=record.employees.find(e=>e.contractId===a.contractId&&e.workerId===r.id);
 const route=`${site(w,record.fromBuildingId)?.name??record.fromBuildingId} → ${site(w,record.toBuildingId)?.name??record.toBuildingId}`;
 const terms=employee?`原聘约：${employmentTermsLabel(employee.terms)}，仍至第${employee.endDay}日。`:'';
 emitEvent(w,{kind:'trade',actors:[r.id],place:{...r.at},text:`${r.name}${labels[a.operation]}（${route}）。${terms}不转移产权、租约或公共补贴，不扣回已挣工资。`});
 return null;
}
export function advanceBusinessRelocations(w:World){
 for(const m of w.economy?.relocations??[]){
  if(!['preparing','moving'].includes(m.status))continue;
  const owner=w.residents.find(r=>r.id===m.ownerId);
  const reason=w.minute>=m.expiresAt?'有限迁址提议到期':!owner||!capable(w,owner)?'经营者当前不能继续迁址':sourceReason(w,m);
  if(!reason)continue;
  m.status='cancelled';m.endedAt=w.minute;m.reason=reason;
  emitLedgerEvent(w,{kind:'trade',actors:[m.ownerId],place:site(w,m.fromBuildingId)?.door??{x:0,y:0},text:`经营迁址中止：${reason}。实物仍在原处或实际携带者身上；工资、押金与原租约分别结算。`});
 }
 const records=w.economy?.relocations;if(records&&records.length>240)w.economy!.relocations=records.filter((m,i)=>['preparing','moving'].includes(m.status)||i>=records.length-120);
}
