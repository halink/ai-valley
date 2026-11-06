import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {EmploymentAction,EmploymentTerms} from '../shared/employment.js';
import {employmentReason,employmentRoles,employmentTermsLabel} from '../world/employment.js';
import {distance} from '../world/navigation.js';
import {ageYears,DAY} from '../world/time.js';

const baseTerms=(role:EmploymentTerms['role']):EmploymentTerms=>({role,wage:3,startMinute:540,durationMinutes:120,days:7});
function atShop(w:World,r:Resident,buildingId:string){const b=w.buildings.find(b=>b.id===buildingId);return !!b&&distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id);}
function dateTime(minute:number){const day=Math.floor(minute/DAY)+1,time=Math.floor(minute%DAY);return `第${day}日 ${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`;}
function adjustedTermsHint(){return '可填写wage（每日1–100钱）、startMinute（每日开班分钟360–1200）、durationMinutes（30–240）、days（2–28），工资须由店内钱款足额预留；不填则采用上列条件';}

export function employmentOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!w.employment||!r.canDecide||!r.canExpress||r.status!=='alive'||r.residency==='outside'||ageYears(r.bornAt,w.minute)<18)return [];
 const result:FormalOpportunity[]=[];
 const add=(id:string,label:string,action:EmploymentAction)=>{if(!employmentReason(w,r,action))result.push({id:'employment.'+id,label,action});};
 const mine=w.economy?.businesses.find(b=>b.ownerId===r.id&&b.closedAt===null);
 if(mine&&atShop(w,r,mine.buildingId)){
  for(const role of Object.keys(employmentRoles) as EmploymentTerms['role'][]){const terms=baseTerms(role);add('post.'+role,`在${mine.name}招聘：${employmentTermsLabel(terms)}。${adjustedTermsHint()}`,{type:'employment',operation:'post',businessId:mine.id,terms});}
 }
 const relevant=w.employment.posts.filter(p=>p.status==='open'||p.status==='offered');
 const responses:FormalOpportunity[]=[];
 for(const p of relevant){
  const place=w.buildings.find(b=>b.id===p.buildingId),shop=w.economy?.businesses.find(b=>b.id===p.businessId);
  if(!place||!shop)continue;
  if(p.employerId===r.id){
   if(!atShop(w,r,p.buildingId))continue;
   for(const application of p.applications.filter(app=>app.status==='pending').slice(0,4)){
    const person=w.residents.find(r=>r.id===application.residentId);if(!person)continue;
    add('select.'+p.id+'.'+person.id,`选择录用申请人${person.name}，按启事原条件预存 ${p.terms.wage*p.terms.days} 钱，等待本人最后确认（${employmentTermsLabel(p.terms)}）`,{type:'employment',operation:'select',postId:p.id,applicantId:person.id});
    add('reject.'+p.id+'.'+person.id,`不接受${person.name}对${employmentRoles[p.terms.role]}岗位的这次应聘`,{type:'employment',operation:'reject',postId:p.id,applicantId:person.id});
   }
   add('cancel.'+p.id,`撤回${shop.name}的${employmentRoles[p.terms.role]}招聘，尚未接受的工资预留退回`,{type:'employment',operation:'cancelPost',postId:p.id});
  }else{
   const application=p.applications.find(app=>app.residentId===r.id);
   if(p.offer?.workerId===r.id&&(p.offer.notifiedAt!==undefined||atShop(w,r,p.buildingId))){
    for(const operation of ['accept','decline'] as const){
     const action:EmploymentAction={type:'employment',operation,postId:p.id};
     if(!employmentReason(w,r,action))responses.push({id:`employment.${operation}.${p.id}`,label:`${operation==='accept'?'亲自到店接受':'婉拒'}${shop.name}已预存工资的录用邀请：${employmentTermsLabel(p.terms)}，可在${dateTime(p.offer.expiresAt)}前答复`,action});
    }
   }else if(application?.status==='pending'||application?.status==='selected'){
    add('withdraw.'+p.id,`撤回我交给${shop.name}的应聘申请`,{type:'employment',operation:'withdrawApplication',postId:p.id});
    if(!atShop(w,r,p.buildingId))responses.push({id:'employment.application.'+p.id,label:`去自己应聘的${shop.name}查看招聘回复`,action:{type:'move',to:{...place.door}}});
   }
   else if(atShop(w,r,p.buildingId)&&r.knownBuildings.includes(place.id)){
    add('apply.'+p.id,`向${shop.name}应聘（须店主选择、自己再确认）：${employmentTermsLabel(p.terms)}`,{type:'employment',operation:'apply',postId:p.id});
   }
  }
 }
 for(const c of w.employment.contracts.filter(c=>c.status==='active'&&(c.workerId===r.id||c.employerId===r.id))){
  const shop=w.economy?.businesses.find(b=>b.id===c.businessId),place=w.buildings.find(b=>b.id===c.buildingId);if(!shop||!place)continue;
  if(c.workerId===r.id){
   add('work.'+c.id,`到${shop.name}履行自己的${employmentRoles[c.terms.role]}聘约，本次工作30分钟，原料与成品归商铺（足班${c.terms.durationMinutes}分钟日薪${c.terms.wage}钱，按真实时间结算）`,{type:'employment',operation:'work',contractId:c.id,minutes:30});
   add('quit.'+c.id,`自行辞去${shop.name}的聘约，已挣工资保留，未履约资金退回雇主`,{type:'employment',operation:'quit',contractId:c.id});
   if(!atShop(w,r,c.buildingId))responses.push({id:'employment.return.'+c.id,label:`去自己已签约的${shop.name}，查看岗位、材料和本人班次`,action:{type:'move',to:{...place.door}}});
  }else{
   add('dismiss.'+c.id,`结束与${w.residents.find(p=>p.id===c.workerId)?.name??'受雇者'}的${employmentRoles[c.terms.role]}聘约，已挣工资不能扣回`,{type:'employment',operation:'dismiss',contractId:c.id});
   const terms={...c.terms};add('renew.'+c.id,`向${w.residents.find(p=>p.id===c.workerId)?.name??'原受雇者'}提出到期续约：${employmentTermsLabel(terms)}。${adjustedTermsHint()}`,{type:'employment',operation:'renew',contractId:c.id,terms});
  }
 }
 const visiblePosts=relevant.filter(p=>r.knownBuildings.includes(p.buildingId)&&atShop(w,r,p.buildingId));
 if(!visiblePosts.length){
  const building=w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&['home','store','workshop'].includes(b.kind)&&!atShop(w,r,b.id)).sort((a,b)=>distance(a.door,r.at)-distance(b.door,r.at))[0];
  if(building)responses.push({id:'employment.inspect.'+building.id,label:`去已知的${building.name}门口看看是否张贴招聘`,action:{type:'move',to:{...building.door}}});
 }
 // Accept/refuse pairs and the worker's own departure choice are retained ahead of unrelated new posts.
 return [...responses,...result];
}
export function employmentNotes(w:World,r:Resident):string {
 if(!w.employment)return '';
 const notes:string[]=[];
 for(const c of w.employment.contracts.filter(c=>c.status==='active'&&(c.workerId===r.id||c.employerId===r.id))){
  if(!atShop(w,r,c.buildingId))continue;
  const other=w.residents.find(p=>p.id===(c.workerId===r.id?c.employerId:c.workerId));
  const shop=w.economy?.businesses.find(b=>b.id===c.businessId);
  notes.push(`你与${other?.name??'对方'}在${shop?.name??'登记商铺'}有本人已确认的聘约：${employmentTermsLabel(c.terms)}，第${c.startDay+1}至${c.endDay}日。`);
  if(c.workerId===r.id){
   const entry=c.attendance.find(d=>d.day===Math.floor(w.minute/DAY));
   if(entry)notes.push(`你今天已实际工作${Math.floor(entry.worked)}分钟，已领${entry.paid}钱。`);
  }
  if(atShop(w,r,c.buildingId)){
   const stock=shop?.inventory??{};
   notes.push(`你在工作地点看到未上架根菜${stock.turnip??0}份、清水${stock.water??0}份；材料不足时不能开工计薪。`);
  }
 }
 for(const p of w.employment.posts)if(p.offer?.workerId===r.id&&(p.offer.notifiedAt!==undefined||atShop(w,r,p.buildingId)))notes.push(`你已在店前读到${employmentRoles[p.terms.role]}录用邀请，可在${dateTime(p.offer.expiresAt)}前独立接受或拒绝。`);
 return notes.join('');
}
export function employmentChoiceFields(a:EmploymentAction):string[]{return a.operation==='post'||a.operation==='renew'?['wage','startMinute','durationMinutes','days']:a.operation==='work'?['minutes']:[];}
export function parseEmploymentChoice(action:EmploymentAction,data:Record<string,unknown>):EmploymentAction {
 const copy=structuredClone(action);
 if(copy.operation==='post'||copy.operation==='renew'){
  if(!copy.terms)throw new Error('missing_employment_terms');
  for(const [key,min,max] of [['wage',1,100],['startMinute',360,1200],['durationMinutes',30,240],['days',2,28]] as const){
   const value=data[key];if(value===undefined)continue;
   if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new Error('invalid_employment_terms');
   copy.terms[key]=value;
  }
  if(copy.terms.startMinute+copy.terms.durationMinutes>1380)throw new Error('invalid_employment_hours');
 }else if(copy.operation==='work'&&data.minutes!==undefined){
  if(typeof data.minutes!=='number'||!Number.isSafeInteger(data.minutes)||data.minutes<1||data.minutes>120)throw new Error('invalid_employment_work');
  copy.minutes=data.minutes;
 }
 return copy;
}
