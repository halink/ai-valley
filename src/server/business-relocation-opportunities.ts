import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {BusinessRelocationAction} from '../shared/business-relocation.js';
import {businessRelocationReason} from '../world/business-relocation.js';
import {employmentTermsLabel} from '../world/employment.js';
import {distance} from '../world/navigation.js';

export function businessRelocationOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const out:FormalOpportunity[]=[];
 const near=(id:string)=>{const b=w.buildings.find(b=>b.id===id);return !!b&&distance(r.at,b.door)<=8&&(r.inside===null||r.inside===id);};
 const add=(id:string,label:string,action:BusinessRelocationAction)=>{if(!businessRelocationReason(w,r,action))out.push({id:'businessRelocation.'+id,label,action});};
 const visit=(id:string,buildingId:string,label:string)=>{const b=w.buildings.find(b=>b.id===buildingId);if(b&&!near(buildingId))out.push({id:'businessRelocation.visit.'+id,label,action:{type:'move',to:{...b.door}}});};
 for(const b of w.economy?.businesses.filter(b=>b.ownerId===r.id&&b.closedAt===null&&near(b.buildingId))??[])
  for(const dest of w.buildings.filter(d=>d.id!==b.buildingId&&r.knownBuildings.includes(d.id)))add('propose.'+b.id+'.'+dest.id,`提出将${b.name}从原址迁至已知${dest.name}，先停新订单与招聘；已有订单按原址结清，员工须另到新址独立同意，原货由本人实际领取携带；提议7日内有效`,{type:'businessRelocation',operation:'propose',businessId:b.id,fromBuildingId:b.buildingId,toBuildingId:dest.id});
 for(const m of w.economy?.relocations??[]){
  if(!['preparing','moving'].includes(m.status)||m.expiresAt<=w.minute)continue;
  const from=w.buildings.find(b=>b.id===m.fromBuildingId)?.name??m.fromBuildingId,to=w.buildings.find(b=>b.id===m.toBuildingId)?.name??m.toBuildingId;
  if(m.ownerId===r.id){
   add('cancel.'+m.id,'撤回本人的迁址提议，货物留在现处；原聘约、租金押金与工资仍按原权利处理',{type:'businessRelocation',operation:'cancel',relocationId:m.id});
   // Readiness is local to the original ledger; do not reveal a remote worker's response.
   if(near(m.fromBuildingId))add('begin.'+m.id,`在${from}核对原订单与所有员工答复，按已接受条款暂停工作开始搬运；未工作不计薪，原聘期不延长`,{type:'businessRelocation',operation:'begin',relocationId:m.id});
   if(near(m.toBuildingId))add('finish.'+m.id,`在${to}复核权利与工位后登记迁址；原址须无货，原资金和已挣工资保留，只有同意的员工聘约改址；随身货须另行入库`,{type:'businessRelocation',operation:'finish',relocationId:m.id});
   if(m.status==='moving')visit(m.id+'.new',m.toBuildingId,`本人携带已领取货物前往原提议的新址${to}；到场后仍须复核并选择登记`);
   visit(m.id+'.old',m.fromBuildingId,`回本人登记的旧址${from}查看实际货物、订单及员工答复，领取余货或继续协商`);
  }
  for(const e of m.employees.filter(e=>e.workerId===r.id)){
   const a={type:'businessRelocation' as const,relocationId:m.id,contractId:e.contractId};
   add('review.'+m.id+'.'+e.contractId,`在旧址阅读店主给本人的具体迁址提议与停工条款，不表示同意`,{...a,operation:'review'});
   if(e.reviewedAt===null)continue;
   const terms=`新址${to}；${employmentTermsLabel(e.terms)}，仍至第${e.endDay}日；搬运停工期间未工作不计薪、聘期不延长，原已挣工资和剩余预存不变`;
   add('accept.'+m.id+'.'+e.contractId,'亲自在新址核验并独立同意：'+terms,{...a,operation:'accept'});
   add('decline.'+m.id+'.'+e.contractId,'拒绝迁址：'+terms+'；本人原聘约仍在旧址',{...a,operation:'decline'});
   add('revoke.'+m.id+'.'+e.contractId,'在正式登记迁址前撤回本人同意，原聘约仍留旧址；已经搬走的货物不会返回',{...a,operation:'revoke'});
   if(e.acceptedAt===null&&e.declinedAt===null)visit(m.id+'.'+e.contractId,m.toBuildingId,`去本人已读到的拟迁新址${to}查看工位，再决定是否接受相同报酬与停工条款`);
  }
 }
 const proposed=out.filter(c=>c.action.type==='businessRelocation'&&c.action.operation==='propose'),offset=proposed.length?Math.floor(w.minute/15)%proposed.length:0;
 return [...out.filter(c=>!proposed.includes(c)),...[...proposed.slice(offset),...proposed.slice(0,offset)].slice(0,2)];
}
