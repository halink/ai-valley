import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {PremisesAction,PremisesStation,PremisesTerms} from '../shared/premises.js';
import {currentPremisesLease,premisesWorkReason} from '../shared/premises.js';
import {premisesReason,premisesTermsError,premisesTermsLabel} from '../world/premises.js';
import {distance} from '../world/navigation.js';
import {stationNames} from '../world/industry-content.js';
export const premisesFields=['days','rentPerDay','deposit','startMinute','durationMinutes'] as const;
export function parsePremisesChoice(a:PremisesAction,data:Record<string,unknown>):PremisesAction {
 const result=structuredClone(a);if(a.operation!=='offer')return result;
 for(const field of premisesFields)if(data[field]!==undefined){if(typeof data[field]!=='number')throw new Error('invalid_premises_terms');result.terms![field]=data[field] as number;}
 if(premisesTermsError(result.terms))throw new Error('invalid_premises_terms');return result;
}
export function premisesOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!w.economy)return [];
 const out:FormalOpportunity[]=[];
 const add=(id:string,label:string,a:PremisesAction)=>{if(!premisesReason(w,r,a))out.push({id:'premises.'+id,label,action:a});};
 const near=(id:string)=>{const b=w.buildings.find(b=>b.id===id);return !!b&&r.knownBuildings.includes(id)&&distance(r.at,b.door)<=8&&(r.inside===null||r.inside===id);};
 for(const b of w.buildings.filter(b=>b.ownerId===r.id&&near(b.id)&&['home','workshop','store'].includes(b.kind))){
  const stations:PremisesStation[]=b.kind==='home'?['bed']:['table','kitchen',...(w.industry?.stations.filter(s=>s.buildingId===b.id).map(s=>s.kind)??[])];
  for(const p of w.residents.filter(p=>p.id!==r.id&&r.knownPeople.includes(p.id))){
   for(const station of stations){const terms:PremisesTerms={days:7,rentPerDay:1,deposit:2,station,startMinute:station==='bed'?0:540,durationMinutes:station==='bed'?1440:360};
    add(`offer.${b.id}.${p.id}.${station}`,`在${b.name}提出给${p.name}的${station==='bed'?'住宅':'经营'}租约，专用${station==='bed'?'第1张床':station==='table'?'桌台':station==='kitchen'?'厨房':stationNames[station]}时段。${premisesTermsLabel(terms)}。可填days、rentPerDay、deposit${station==='bed'?'':'、startMinute、durationMinutes'}；对方须到场另行接受`,{type:'premises',operation:'offer',buildingId:b.id,tenantId:p.id,terms});
   }
  }
 }
 for(const l of w.economy.leases??[]){
  if(l.ownerId!==r.id&&l.tenantId!==r.id)continue;
  if(l.tenantId===r.id&&l.reason==='承租人自行提前交还')continue;
  if(l.acceptedAt!==null&&l.endsAt!>w.minute&&!near(l.buildingId)){const b=w.buildings.find(b=>b.id===l.buildingId);if(b)out.push({id:'premises.visit.'+l.id,label:'回到本人原已签约的'+b.name+'查看场所和原约定，远处现况须到场核实',action:{type:'move',to:{...b.door}}});continue;}
  if(!near(l.buildingId))continue;
  if(l.tenantId===r.id&&l.terms.station==='bed'&&currentPremisesLease(w,l.buildingId)?.id===l.id)out.push({id:'premises.sleep.'+l.id,label:'到本人租用住宅的第1张真实床位睡2小时；路程另计，到期立即停止睡眠权益，不改变原住处',action:{type:'sleep',minutes:120,buildingId:l.buildingId}});
  if(l.tenantId===r.id&&currentPremisesLease(w,l.buildingId)?.id===l.id&&l.terms.station==='kitchen'&&!premisesWorkReason(w,r.id,l.buildingId,'kitchen',w.minute,w.minute+20)&&(r.inventory.turnip??0)>=2&&(r.inventory.water??0)>=1)out.push({id:'premises.cook.'+l.id,label:'到本人已租用的厨房，用自有2芜菁和1水做1份餐食',action:{type:'cook',quantity:1,buildingId:l.buildingId}});
  if(l.status==='offered'){
   if(l.ownerId===r.id)add('withdraw.'+l.id,'撤回自己尚未签订的租赁报价',{type:'premises',operation:'withdraw',leaseId:l.id});
   if(l.tenantId===r.id&&near(l.buildingId)){
    add('accept.'+l.id,`在原址自行接受具体${l.terms.station==='bed'?'住宅':'经营'}租约：${premisesTermsLabel(l.terms)}；不取得产权${l.terms.station==='bed'?'或永久入住权':'或住宿权'}`,{type:'premises',operation:'accept',leaseId:l.id});
    add('decline.'+l.id,'拒绝这份给本人的租赁报价，不支付租金或押金',{type:'premises',operation:'decline',leaseId:l.id});
   }
  }
  if(l.status==='active'&&l.tenantId===r.id)add('surrender.'+l.id,'到原址提前交还租约使用权，退回未挣租金及押金；既有财物、已挣工资与原永久住处不变',{type:'premises',operation:'surrender',leaseId:l.id});
 }
 for(const c of w.industry?.batches??[])if(c.ownerId===r.id&&c.status==='working')add('collect.'+c.id,'到原租赁工位取回本人未完批次原料；放弃该批已投入的劳动进度',{type:'premises',operation:'collect',batchId:c.id});
 // Rotate offers without dropping accept/refuse or an existing tenant's cleanup actions.
 const offers=out.filter(c=>c.action.type==='premises'&&c.action.operation==='offer'),offset=offers.length?Math.floor(w.minute/15)%offers.length:0;
 return [...out.filter(c=>c.action.type!=='premises'||c.action.operation!=='offer'),...[...offers.slice(offset),...offers.slice(0,offset)].slice(0,4)];
}
export function premisesNotes(w:World,r:Resident):string {
 return (w.economy?.leases??[]).filter(l=>l.tenantId===r.id&&l.reason!=='承租人自行提前交还'&&l.acceptedAt!==null&&l.endsAt!>w.minute).map(l=>`本人原已签租约的地址是${w.buildings.find(b=>b.id===l.buildingId)?.name??l.buildingId}，期限至第${l.endsAt}分钟。${premisesTermsLabel(l.terms)}。远处当前场所、床位或工位须到场核实。`).join(' ');
}
/** Default hiring choices must actually fit the remaining signed lease, not hide recruitment. */
export function leasedEmploymentTerms(w:World,ownerId:string,buildingId:string,t:import('../shared/employment.js').EmploymentTerms){
 const l=currentPremisesLease(w,buildingId);if(!l||l.tenantId!==ownerId)return t;
 return {...t,startMinute:l.terms.startMinute,durationMinutes:Math.min(t.durationMinutes,l.terms.durationMinutes),days:Math.min(t.days,Math.floor(l.endsAt!/1440)-Math.floor(w.minute/1440)-1)};
}
