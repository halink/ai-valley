import {activeBusinessRelocation} from '../shared/business-relocation.js';
import {premisesBusinessRight,premisesWorkReason} from '../shared/premises.js';
import {hasReceipt} from './receipts.js';
import {occupiesKitchen} from '../shared/rooms.js';
import {markPromiseEnd} from './known-promises.js';
import {industryRecipe,bindRecipeSnapshot} from './industry-definitions.js';
import {promisedEmploymentRecipe,isolateEmploymentBatch,employmentBatchIntact} from './employment-recipes.js';
import {estateStock,estateBuildingLocation} from './estate-custody.js';
import {foodTransaction} from './food.js';
import {craftFoodFlowInputs,recordFoodFlow,finishFoodFlowAction} from './food-consumption-evidence.js';
import {educationConflict} from './education.js';
import type {Building,Inventory,Resident,Vec,World} from '../shared/types.js';
import type {CraftRecipe} from '../shared/industry.js';
import type {Business} from '../shared/economy.js';
import type {EmploymentAction,EmploymentContract,EmploymentPost,EmploymentTerms} from '../shared/employment.js';
import {accountBalance,initializeEconomy,moveCoins} from './economy.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {distance,findPath,same} from './navigation.js';
import {ageYears,DAY} from './time.js';

export const employmentRoles={cook:'餐食制作',seedkeeper:'留种加工',carpenter:'木工加工',smith:'铁锭冶炼',miller:'谷物制面包',dairyworker:'乳品加工',weaver:'纺织加工',preserver:'罐藏加工',herbalist:'照护用品配制'};
const roleRecipes={carpenter:'plank',smith:'bar',miller:'bread',dairyworker:'cheese',weaver:'cloth',preserver:'preserve',herbalist:'medicine'};
function jobRecipe(w:World,role:EmploymentTerms['role'],legacy=false):CraftRecipe|undefined {if(role==='seedkeeper')return {id:'employment-seed',name:'留种加工',input:{turnip:1},output:{seed:2},minutes:15,station:null,skill:'farming',minimum:0};if(role==='cook'){const key=legacy?'recipe/meal@1':w.activeDefinitions['recipe/meal']??'recipe/meal@1',d=w.definitions[key];return d?{id:'employment-cook',name:'餐食制作',input:structuredClone(d.cost??{}),output:{meal:Number(d.data.yield)},minutes:d.minutes??20,station:null,skill:'farming',minimum:0}:undefined;}const id=roleRecipes[role as keyof typeof roleRecipes];return id?industryRecipe(w,id,legacy?'recipe/industry/'+id+'@1':undefined)?.recipe:undefined;}
function qualified(w:World,r:Resident,t:EmploymentTerms,buildingId:string,recipe=jobRecipe(w,t.role)){return !recipe||(r.skills[recipe.skill]>=recipe.minimum&&(!recipe.station||w.industry?.stations.some(s=>s.buildingId===buildingId&&s.kind===recipe.station&&!(s.removalWorked!>0))));}

const whole=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const local=(r:Resident,b:Building)=>distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id);
const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([key,n])=>(bag[key as keyof Inventory]??0)>=n!);
function add(bag:Inventory,cost:Inventory,sign=1){for(const [key,n]of Object.entries(cost))bag[key as keyof Inventory]=(bag[key as keyof Inventory]??0)+sign*n!;}
function business(w:World,id:string):Business|undefined{return w.economy?.businesses.find(b=>b.id===id);}
function site(w:World,id:string):Building|undefined{return w.buildings.find(b=>b.id===id);}
function operating(w:World,b:Business|undefined,at=w.minute):b is Business {
 if(!b||b.closedAt!==null)return false;
 const owner=w.residents.find(p=>p.id===b.ownerId),place=site(w,b.buildingId);
 return !!owner&&capable(w,owner)&&!!place&&premisesBusinessRight(w,owner.id,place,at)&&place.condition>0;
}
function termsError(t:EmploymentTerms|undefined):string|null {
 if(!t||!Object.hasOwn(employmentRoles,t.role)||!whole(t.wage,1,100)||!whole(t.days,2,28)
   ||!whole(t.startMinute,360,1200)||!whole(t.durationMinutes,30,240)||t.startMinute+t.durationMinutes>1380)return '岗位、日薪、开班时间、工时或期限无效';
 return null;
}
export function employmentTermsLabel(t:EmploymentTerms):string {
 const time=(m:number)=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 return `${employmentRoles[t.role]}，每天${time(t.startMinute)}—${time(t.startMinute+t.durationMinutes)}，足班日薪${t.wage}钱，连续${t.days}日；不足班按实际工作分钟比例结算取整`;
}
export function initializeEmployment(w:World):void {
 if(w.mode!=='formal')return;initializeEconomy(w);
 w.employment??={posts:[],contracts:[],nextSerial:1,totals:{paid:0,worked:0,produced:0,hired:0}};
 for(const c of w.employment.posts)restoreRecipe(w,c);
 for(const c of w.employment.contracts){
  isolateEmploymentBatch(c);
  // The recruiting snapshot is independent evidence only for this exact promise.
  const p=w.employment.posts.find(p=>p.id===c.postId&&p.businessId===c.businessId&&p.employerId===c.employerId&&JSON.stringify(p.terms)===JSON.stringify(c.terms));
  restoreRecipe(w,c,p);
 }
}
function restoreRecipe(w:World,c:EmploymentPost|EmploymentContract,post?:EmploymentPost):void {
 if(!c.recipeDefinition&&post){const recipe=promisedEmploymentRecipe(w,post);if(recipe){c.recipe=structuredClone(recipe);c.recipeDefinition=post.recipeDefinition??bindRecipeSnapshot(w,recipe);}}
 // Saves predating recipe snapshots used the original version, not today's active content.
 if(!c.recipe&&!c.recipeDefinition)c.recipe=jobRecipe(w,c.terms.role,true);
 const recipe=promisedEmploymentRecipe(w,c);if(!recipe)return;
 if(JSON.stringify(c.recipe)!==JSON.stringify(recipe))c.recipe=structuredClone(recipe);
 c.recipeDefinition??=bindRecipeSnapshot(w,recipe);
}
function announce(w:World,buildingId:string,text:string,actors:string[]=[]){
 const place=site(w,buildingId);if(place)return emitEvent(w,{kind:'trade',actors,place:{...place.door},text});
}
function refundAccount(w:World,businessId:string,employerId:string):string|undefined {
 const b=business(w,businessId);if(b?.closedAt===null)return `business:${b.id}`;
 const owner=w.residents.find(p=>p.id===employerId);
 return owner?.status==='dead'?w.estates.some(e=>e.personId===employerId)?`estate:${employerId}`:undefined:owner?`resident:${employerId}`:undefined;
}
function refundStockAtomic(w:World,c:EmploymentContract){
 if(!c.batch)return;
 const b=business(w,c.businessId),owner=w.residents.find(r=>r.id===c.employerId);
 const stock=b&&owner?.status!=='dead'?b.inventory:owner?.status==='dead'?estateStock(w,owner.id,'employment:'+c.id,estateBuildingLocation(w,c.buildingId,'原雇佣加工工位',true,c.recipe?.station??undefined)):owner?.inventory;
 if(stock){add(stock,c.batch.inventory);c.batch=null;}
}
function closeOffer(w:World,p:EmploymentPost,outcome:'declined'|'expired'='expired'){
 if(!p.offer)return;
 const target=refundAccount(w,p.businessId,p.employerId),balance=accountBalance(w,p.offer.account);
 if(balance&&(!target||!moveCoins(w,p.offer.account,target,balance,'未接受聘约余款退回',`${p.id}:offer:${p.offer.serial}:refund`)))return;
 const application=p.applications.find(a=>a.residentId===p.offer!.workerId&&a.status==='selected');
 if(application)application.status=outcome;
 p.offer=null;p.status=operating(w,business(w,p.businessId))&&p.expiresAt>w.minute?'open':'closed';
}
function endContract(w:World,c:EmploymentContract,status:EmploymentContract['status'],reason:string,actor?:Resident){
 if(c.status!=='active')return;
 refundStock(w,c);
 const target=refundAccount(w,c.businessId,c.employerId),amount=accountBalance(w,c.account);
 if(amount&&(!target||!moveCoins(w,c.account,target,amount,'长期聘约未履约工资退回',`${c.id}:end`)))return;
 c.refunded+=amount;c.status=status;c.reason=reason;c.endedAt=w.minute;
 if(actor)markPromiseEnd(w,c,actor);
 const text=`长期聘约结束：${reason}。已挣得 ${c.paid} 钱，未履约 ${amount} 钱归还原出资方。`;if(actor)emitEvent(w,{kind:'trade',actors:[actor.id,c.employerId,c.workerId].filter((id,i,ids)=>ids.indexOf(id)===i),place:{...actor.at},text});else emitLedgerEvent(w,{kind:'trade',actors:[c.employerId,c.workerId],place:{...site(w,c.buildingId)!.door},text});
}
export function hasEmploymentAssets(w:World,personId:string):boolean {
 return !!w.employment&&(w.employment.posts.some(p=>p.employerId===personId&&p.offer!==null)
   ||w.employment.contracts.some(c=>c.employerId===personId&&c.status==='active'));
}
/** Accounted time and contracts can expire, but no work intention is created here. */
export function advanceEmployment(w:World):void {
 initializeEmployment(w);const e=w.employment;if(!e)return;
 for(const p of e.posts){
  const hired=p.offer&&w.residents.find(r=>r.id===p.offer!.workerId);
  if(p.offer&&(p.offer.expiresAt<=w.minute||!operating(w,business(w,p.businessId))||!hired||!capable(w,hired)))closeOffer(w,p);
  if(p.offer&&hired&&local(hired,site(w,p.buildingId)!))p.offer.notifiedAt??=w.minute;
  if(p.status==='open'&&(p.expiresAt<=w.minute||!operating(w,business(w,p.businessId))))p.status='closed';
 }
 for(const c of e.contracts){
  if(c.status!=='active')continue;
  const worker=w.residents.find(p=>p.id===c.workerId);
  if(!operating(w,business(w,c.businessId)))endContract(w,c,'ended','雇主、店面或经营权已不再适用');
  else if(!worker||!capable(w,worker))endContract(w,c,'ended','受雇者死亡、迁出或失去当前工作能力');
  else if(w.minute>=c.endDay*DAY)endContract(w,c,'completed','约定期限届满');
 }
 const activePostIds=new Set(e.contracts.filter(c=>c.status==='active').map(c=>c.postId));
 e.posts=e.posts.filter((p,i,a)=>p.status==='open'||p.status==='offered'||activePostIds.has(p.id)||i>=a.length-120);
 e.contracts=e.contracts.filter((c,i,a)=>c.status==='active'||w.minute<c.endDay*DAY||c.batch!==null||accountBalance(w,c.account)>0||i>=a.length-120);
}
function compatible(w:World,start:number,end:number,buildingId:string,otherStart:number,otherEnd:number,otherBuildingId:string):boolean {
 if(start<otherEnd&&otherStart<end)return false;
 const a=site(w,buildingId),b=site(w,otherBuildingId);if(!a||!b)return false;
 const path=findPath(w,a.door,b.door);if(path===null)return false;
 const gap=end<=otherStart?otherStart-end:start-otherEnd;
 return gap>=path.length;
}
/** Shared by private recruitment and public shift acceptance. */
export function employmentConflict(w:World,r:Resident,start:number,end:number,buildingId:string,excludeContract?:string):string|null {
 const classroom=educationConflict(w,r.id,start,end,buildingId);if(classroom)return classroom;
 for(const c of w.employment?.contracts??[]){
  if(c.status!=='active'||c.workerId!==r.id||c.id===excludeContract)continue;
  const today=Math.floor(start/DAY);
  for(let day=today-1;day<=today+1;day++){
   if(day<c.startDay||day>=c.endDay)continue;
   const from=day*DAY+c.terms.startMinute,to=from+c.terms.durationMinutes;
   if(!compatible(w,start,end,buildingId,from,to,c.buildingId))return '与本人已接受的私人班次重叠，或两处之间没有足够通勤时间';
  }
 }
 return null;
}
function scheduleConflict(w:World,r:Resident,t:EmploymentTerms,buildingId:string,startDay:number,excludeContract?:string):string|null {
 for(let day=startDay;day<startDay+t.days;day++){
  const start=day*DAY+t.startMinute,end=start+t.durationMinutes;
  const conflict=employmentConflict(w,r,start,end,buildingId,excludeContract);if(conflict)return conflict;
  for(const shift of w.duties?.shifts??[]){
   if(shift.workerId!==r.id||!['booked','on-duty'].includes(shift.status)||Math.abs(Math.floor(shift.start/DAY)-day)>1)continue;
   if(!compatible(w,start,end,buildingId,shift.start,shift.end,shift.buildingId))return '与本人已认领的公共班次重叠，或没有足够通勤时间';
  }
 }
 return null;
}
function postFor(w:World,a:EmploymentAction){return w.employment?.posts.find(p=>p.id===a.postId);}
function contractFor(w:World,a:EmploymentAction){return w.employment?.contracts.find(c=>c.id===a.contractId);}
function renewedStartDay(w:World,p:EmploymentPost):number {
 const old=p.renewalOf?w.employment?.contracts.find(c=>c.id===p.renewalOf):undefined;
 return Math.max(Math.floor(w.minute/DAY)+1,old?.endDay??0);
}
function leasedScheduleError(w:World,ownerId:string,buildingId:string,t:EmploymentTerms,startDay:number,recipe=jobRecipe(w,t.role)){
 const key=recipe?.station?'station:'+recipe.station:t.role==='cook'?'kitchen':'table';
 for(let day=startDay;day<startDay+t.days;day++){
  const start=day*DAY+t.startMinute,problem=premisesWorkReason(w,ownerId,buildingId,key,start,start+t.durationMinutes);if(problem)return problem;
 }
 return null;
}
/** Recheck the remaining original promise at a separately accepted destination. */
export function relocatedEmploymentReason(w:World,c:EmploymentContract,buildingId:string):string|null {
 const worker=w.residents.find(r=>r.id===c.workerId),b=site(w,buildingId);
 if(!worker||!capable(w,worker)||!b||!premisesBusinessRight(w,c.employerId,b)||!qualified(w,worker,c.terms,buildingId,c.recipe))return '新址经营权、员工能力或真实工位不适用';
 const startDay=Math.max(c.startDay,Math.floor(w.minute/DAY));
 if(startDay>=c.endDay)return '原聘约已经届满，不能藉迁址延长';
 const terms={...c.terms,days:c.endDay-startDay};
 return leasedScheduleError(w,c.employerId,buildingId,terms,startDay,c.recipe)??scheduleConflict(w,worker,terms,buildingId,startDay,c.id);
}
export function employmentReason(w:World,r:Resident,a:EmploymentAction,workStart=w.minute):string|null {
 if(!w.employment||!capable(w,r))return '当前不能签订或履行私人聘约';
 const boundContract=contractFor(w,a),boundPost=postFor(w,a);
 if(a.contractId&&a.postId||a.operation==='post'&&(a.contractId||a.postId)||a.businessId&&(boundContract??boundPost)&&a.businessId!==(boundContract??boundPost)!.businessId)return '聘约、招聘与商铺身份不相符';
 const promised=boundContract??boundPost,shop=business(w,promised?.businessId??a.businessId??'');
 if(a.buildingId!==undefined&&a.buildingId!==(promised?.buildingId??shop?.buildingId))return '工作地点已改变，须重新决定';
 const move=shop&&activeBusinessRelocation(w,shop.id);
 if(move&&['post','renew','apply','select','accept'].includes(a.operation))return '迁址准备期间不新增旧址招聘承诺';
 if(move?.status==='moving'&&a.operation==='work')return '各方同意搬迁期间暂停工作，原工资与期限不变';
 if(a.operation==='post'||a.operation==='renew'){
  const old=a.operation==='renew'?contractFor(w,a):undefined;
  const b=business(w,a.operation==='renew'?old?.businessId??'':a.businessId??'');
  if(!operating(w,b)||b.ownerId!==r.id)return '只能为自己正在经营的商铺招聘';
  if(!local(r,site(w,b.buildingId)!))return '须回到自己的商铺查看账目并张贴招聘';
  if(a.operation==='renew'&&(!old||old.employerId!==r.id||old.status!=='active'||old.endDay*DAY-w.minute>3*DAY))return '只能在本人有效聘约的最后三日提出续约';
  const invalid=termsError(a.terms);if(invalid)return invalid;
  const leaseError=leasedScheduleError(w,r.id,b.buildingId,a.terms!,Math.max(Math.floor(w.minute/DAY)+1,old?.endDay??0));if(leaseError)return leaseError;
  const recipe=jobRecipe(w,a.terms!.role);if(recipe?.station&&!w.industry?.stations.some(s=>s.buildingId===b.buildingId&&s.kind===recipe.station&&!(s.removalWorked!>0)))return '需要先实际安装该行业的加工工位';
  if(w.employment.posts.some(p=>p.businessId===b.id&&['open','offered'].includes(p.status)&&p.terms.role===a.terms!.role))return '本店同类岗位已有未完结招聘';
  if(w.employment.contracts.some(c=>c.businessId===b.id&&c.status==='active'&&c.terms.role===a.terms!.role&&c.id!==old?.id))return '本店这一工作位置已有有效聘约';
  return null;
 }
 if(['work','quit','dismiss'].includes(a.operation)){
  const c=contractFor(w,a);if(!c||c.status!=='active')return '聘约已经结束';
  if(a.operation==='dismiss')return c.employerId===r.id?null:'只能结束自己作为雇主的聘约';
  if(c.workerId!==r.id)return '只能履行或辞去本人的聘约';
  if(a.operation==='quit')return null;
  if(!promisedEmploymentRecipe(w,c))return '原聘约的加工配方缺少可信历史记录，当前不能加工；仍可结束聘约退回剩余实物';
  if(!qualified(w,r,c.terms,c.buildingId,c.recipe))return '本人实际技能或现场加工设备不再适用';
  if(!operating(w,business(w,c.businessId),workStart)||r.health<45||r.energy<10)return '场所、身体或经营条件暂不适合开工';
  if(!whole(a.minutes,1,120))return '本次自愿工作的时长须为 1 至 120 分钟';
  const day=Math.floor(w.minute/DAY),start=day*DAY+c.terms.startMinute,end=start+c.terms.durationMinutes;
  if(day<c.startDay||day>=c.endDay||w.minute<start||w.minute>end)return '当前不在本人约定的班次时段';
  if((c.attendance.find(d=>d.day===day)?.worked??0)>=c.terms.durationMinutes)return '本人已经完成今日约定工时';
  if(accountBalance(w,c.account)<1&&c.paid<c.reserved)return '预存工资当前不可用';
  return null;
 }
 const p=postFor(w,a);if(!p)return '没有这份招聘启事';
 const b=business(w,p.businessId);if(!operating(w,b))return '该店当前不再招聘';
 const app=p.applications.find(application=>application.residentId===r.id);
 if(a.operation==='cancelPost')return p.employerId===r.id&&['open','offered'].includes(p.status)?null:'只能撤回本人尚未成立的招聘';
 if(a.operation==='apply'){
  if(!qualified(w,r,p.terms,p.buildingId,p.recipe))return '本人尚未取得该岗位需要的实际技能或加工工位';
  if(p.status!=='open'||p.expiresAt<=w.minute||p.employerId===r.id||app)return '当前不能向这份招聘再次申请';
  if(p.renewalOf&&w.employment.contracts.find(c=>c.id===p.renewalOf)?.workerId!==r.id)return '此续约提议只发给原受雇者';
  if(!local(r,site(w,p.buildingId)!))return '须实际到店看到招聘条件再决定申请';
  return scheduleConflict(w,r,p.terms,p.buildingId,renewedStartDay(w,p),p.renewalOf);
 }
 if(a.operation==='withdrawApplication')return app?.status==='pending'&&p.status==='open'?null:'本人没有待处理申请';
 if(a.operation==='select'||a.operation==='reject'){
  if(p.employerId!==r.id||p.status!=='open')return '只能处理本人仍开放的招聘';
  if(!local(r,site(w,p.buildingId)!))return '须回店查阅本人收到的申请';
  const applicant=p.applications.find(app=>app.residentId===a.applicantId&&app.status==='pending');
  const person=w.residents.find(person=>person.id===a.applicantId);
  if(!applicant||!person||!capable(w,person))return '没有这位仍有效的申请人';
  if(a.operation==='reject')return null;
  const leaseError=leasedScheduleError(w,p.employerId,p.buildingId,p.terms,renewedStartDay(w,p),p.recipe);if(leaseError)return leaseError;
  if(b.coins<p.terms.wage*p.terms.days)return '本店资金不足以预留整段聘期的工资';
  return null;
 }
 if(a.operation==='accept'||a.operation==='decline'){
  if(p.status!=='offered'||p.offer?.workerId!==r.id||p.offer.expiresAt<=w.minute)return '本人没有这份仍有效的录用邀请';
  if(p.offer.notifiedAt===undefined&&!local(r,site(w,p.buildingId)!))return '须先到本人应聘的店前读取录用回复';
  if(a.operation==='decline')return null;
  const leaseError=leasedScheduleError(w,p.employerId,p.buildingId,p.terms,renewedStartDay(w,p),p.recipe);if(leaseError)return leaseError;
  if(!qualified(w,r,p.terms,p.buildingId,p.recipe))return '本人当前不具备该岗位需要的实际技能或工位';
  if(accountBalance(w,p.offer.account)<p.terms.wage*p.terms.days)return '承诺的整段工资未足额预存';
  return scheduleConflict(w,r,p.terms,p.buildingId,renewedStartDay(w,p),p.renewalOf);
 }
 return '没有这项聘用安排';
}
export function employmentTarget(w:World,r:Resident,a:EmploymentAction):{target:Vec;duration:number;error?:string} {
 const error=employmentReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 const p=postFor(w,a),c=contractFor(w,a);
 const b=business(w,c?.businessId??p?.businessId??a.businessId??'');
 const place=site(w,b!.buildingId)!;
 if(a.operation==='quit'||a.operation==='dismiss'||a.operation==='withdrawApplication'||a.operation==='decline')return {target:{...r.at},duration:1};
 if(a.operation==='work'){
  // The engine has already advanced the current tick when it asks for the route.
  // The work hook knows its fractional dt and trims at the exact closing boundary.
  return {target:{...place.door},duration:a.minutes!};
 }
 return {target:{...place.door},duration:a.operation==='post'||a.operation==='renew'?10:3};
}
export function employmentKitchenReason(w:World,r:Resident,buildingId:string):string|null {
 const active=w.residents.some(other=>other.id!==r.id&&other.status==='alive'&&other.residency!=='outside'&&other.activity?.action.type==='employment'
  &&other.activity.action.operation==='work'&&other.activity.path.length===0&&same(other.at,site(w,buildingId)?.door??{x:-1,y:-1})
  &&other.activity.room?.mode!=='exit'&&(other.inside===null||other.inside===buildingId)
  &&w.employment?.contracts.some(c=>c.id===(other.activity!.action as EmploymentAction).contractId&&c.status==='active'&&c.terms.role==='cook'&&c.buildingId===buildingId));
 return active?'厨房工位正由实际到岗的受雇者使用':null;
}
/** This hook receives only time actually spent after the worker has reached the contracted station. */
export function employmentWorkError(w:World,r:Resident,a:EmploymentAction,minutes=1):string|null {
 if(a.operation!=='work')return null;
 initializeEmployment(w);
 const problem=employmentReason(w,r,a,w.minute-minutes);if(problem)return problem;
 const c=contractFor(w,a)!,b=business(w,c.businessId)!,place=site(w,c.buildingId)!;
 const key=c.recipe?.station?'station:'+c.recipe.station:c.terms.role==='cook'?'kitchen':'table';
 const leaseError=premisesWorkReason(w,c.employerId,c.buildingId,key,w.minute-minutes,w.minute);if(leaseError)return leaseError;
 if(!same(r.at,place.door))return '须亲自抵达聘约指定的工作地点';
 if(!r.activity||r.activity.action.type!=='employment'||r.activity.action.operation!=='work'||r.activity.action.contractId!==c.id)return '没有本人已提交并开始执行的工作安排';
 if(c.terms.role==='cook'&&w.residents.some(other=>other.id!==r.id&&occupiesKitchen(w,other,place.id)))return '厨房工位已有居民在烹饪，请待其交还工位';
 const day=Math.floor(w.minute/DAY),start=day*DAY+c.terms.startMinute,end=start+c.terms.durationMinutes;
 const entry=c.attendance.find(d=>d.day===day)??{day,worked:0,paid:0,produced:0,firstArrival:null,lastWork:null};
 const dt=Math.min(Math.max(0,minutes),Math.max(0,w.minute-start),c.terms.durationMinutes-entry.worked,Math.max(0,end-(w.minute-minutes)),r.activity.remaining);
 if(dt<=0)return '今天的可计薪工作时段已经结束';
 // The checkpoint's bounded attendance record deduplicates physical ticks; only actual coin
 // transfers need permanent journal receipts. A fractional runtime tick must not grow that journal.
 if(entry.lastWork!==null&&entry.lastWork>=w.minute-1e-9)return null;
 if(c.batch&&!employmentBatchIntact(w,c)){refundStock(w,c);return '未完成批次的实际材料或加工记录已不完整，当前不能继续计工时';}
 if(!c.batch){
  const recipe=promisedEmploymentRecipe(w,c)!;const cost=recipe.input;
  if(!has(b.inventory,cost))return '店内尚未备齐实际加工材料，当前不能计工时';
  foodTransaction(w,()=>{add(b.inventory,cost,-1);c.batch={inventory:structuredClone(cost),progress:0,minutes:recipe.minutes,output:structuredClone(recipe.output)};});
 }
 if(!c.batch)return '实际批次未建立';
 if(!c.attendance.includes(entry))c.attendance.push(entry);
 entry.firstArrival??=w.minute-dt;entry.lastWork=w.minute;entry.worked+=dt;
 c.batch.progress+=dt;r.inside=place.id;
 const earned=Math.min(c.terms.wage,Math.floor((entry.worked*c.terms.wage+1e-8)/c.terms.durationMinutes));
 const due=earned-entry.paid;
 if(due>0){
  if(!moveCoins(w,c.account,`resident:${r.id}`,due,'私人长期雇佣工资',`${c.id}:${day}:earned:${earned}`))throw new Error('private_payroll_unfunded');
  entry.paid+=due;c.paid+=due;w.employment!.totals.paid+=due;
 }
 w.employment!.totals.worked+=dt;
 if(c.batch.progress+1e-8>=c.batch.minutes){
  const recipe=c.recipe!,inputs=craftFoodFlowInputs(w,'employment:'+c.id,c.batch.inventory,recipe);
  try{foodTransaction(w,()=>{
   add(b.inventory,c.batch!.output);entry.produced++;w.employment!.totals.produced++;
   const event=announce(w,c.buildingId,`${r.name}在${b.name}完成一批${employmentRoles[c.terms.role]}加工，使用店内原料，成品归该店，今日已挣得 ${entry.paid} 钱。`,[r.id,c.employerId]);
   if(inputs&&event){
    const snapshot={id:recipe.id,input:recipe.input,output:recipe.output,minutes:recipe.minutes,
     station:recipe.station,skill:recipe.skill,minimum:recipe.minimum};
    recordFoodFlow(w,{type:'processed',action:'employment_processing',at:w.minute,residentId:r.id,eventId:event.id,
     planId:r.activity!.planId,container:'business:'+b.id,inputContainer:'employment:'+c.id,
     contractId:c.id,businessId:b.id,employerId:c.employerId,buildingId:c.buildingId,
     day,batchNumber:entry.produced,definition:c.recipeDefinition!,recipe:structuredClone(snapshot),
     inputs,output:c.batch!.output});
   }
   c.batch=null;
  });}finally{finishFoodFlowAction(w);}
 }
 r.activity.remaining=Math.min(r.activity.remaining,end-w.minute+dt);
 return null;
}
function completeEmploymentAtomic(w:World,r:Resident,a:EmploymentAction):string|null {
 if(a.operation==='work')return null; // Every physical minute and product was already committed by the work hook.
 const mark=r.activity?`employment-action:${r.activity.planId}:${r.activity.startedAt}:${a.operation}`:null;
 if(mark&&hasReceipt(w,mark))return null;
 const error=employmentReason(w,r,a);if(error)return error;
 const state=w.employment!,p=postFor(w,a),c=contractFor(w,a);
 const b=business(w,c?.businessId??p?.businessId??a.businessId??'')!;
 const remote=['quit','dismiss','withdrawApplication','decline'].includes(a.operation);
 if(!remote&&!same(r.at,site(w,b.buildingId)!.door))return '须本人实际到店办理聘用约定';
 if(a.operation==='post'||a.operation==='renew'){
  const id=`employment-post:${state.nextSerial++}`;
  const post:EmploymentPost={id,businessId:b.id,employerId:r.id,buildingId:b.buildingId,terms:structuredClone(a.terms!),...(jobRecipe(w,a.terms!.role)?{recipe:structuredClone(jobRecipe(w,a.terms!.role))}:{}),postedAt:w.minute,expiresAt:w.minute+7*DAY,status:'open',applications:[],offer:null,offerSerial:0,...(a.operation==='renew'?{renewalOf:c!.id}:{})};
  if(post.recipe)post.recipeDefinition=bindRecipeSnapshot(w,post.recipe);
  state.posts.push(post);announce(w,b.buildingId,`${r.name}为${b.name}${a.operation==='renew'?'提出一份需要本人另行接受的续约条件':'张贴长期招聘'}：${employmentTermsLabel(post.terms)}。`,[r.id,...(c?[c.workerId]:[])]);
 }else if(a.operation==='apply'){
  p!.applications.push({residentId:r.id,appliedAt:w.minute,status:'pending'});
  announce(w,p!.buildingId,`${r.name}申请${employmentRoles[p!.terms.role]}岗位，等${w.residents.find(p=>p.id===b.ownerId)?.name??'店主'}选择是否录用。`,[r.id,b.ownerId]);
 }else if(a.operation==='withdrawApplication'){
  p!.applications.find(app=>app.residentId===r.id)!.status='withdrawn';announce(w,p!.buildingId,`${r.name}撤回自己的应聘申请。`,[r.id]);
 }else if(a.operation==='select'){
  const serial=++p!.offerSerial,account=`escrow:${p!.id}:offer:${serial}`,amount=p!.terms.wage*p!.terms.days;
  if(!moveCoins(w,`business:${b.id}`,account,amount,'长期聘约全期工资预留',`${p!.id}:offer:${serial}:reserve`))return '工资预留未完成';
  p!.offer={workerId:a.applicantId!,offeredAt:w.minute,expiresAt:Math.min(p!.expiresAt,w.minute+2*DAY),account,serial};p!.status='offered';
  const recipient=w.residents.find(person=>person.id===a.applicantId)!;
  if(local(recipient,site(w,p!.buildingId)!))p!.offer.notifiedAt=w.minute;
  p!.applications.find(app=>app.residentId===a.applicantId)!.status='selected';
  announce(w,p!.buildingId,`${r.name}选择录用${w.residents.find(p=>p.id===a.applicantId)?.name??'这位应聘者'}，预留全期 ${amount} 钱工资，等待对方最后确认。`,[r.id,a.applicantId!]);
 }else if(a.operation==='reject'){
  p!.applications.find(app=>app.residentId===a.applicantId)!.status='rejected';announce(w,p!.buildingId,`${r.name}未接受这次应聘。`,[r.id,a.applicantId!]);
 }else if(a.operation==='accept'){
  const startDay=renewedStartDay(w,p!),id=`employment-contract:${state.nextSerial++}`;
  const contract:EmploymentContract={id,postId:p!.id,businessId:b.id,employerId:b.ownerId,workerId:r.id,buildingId:b.buildingId,terms:structuredClone(p!.terms),...(p!.recipe?{recipe:structuredClone(p!.recipe),recipeDefinition:p!.recipeDefinition??bindRecipeSnapshot(w,p!.recipe)}:{}),acceptedAt:w.minute,startDay,endDay:startDay+p!.terms.days,account:p!.offer!.account,reserved:p!.terms.wage*p!.terms.days,paid:0,refunded:0,status:'active',endedAt:null,reason:null,attendance:[],batch:null};
  state.contracts.push(contract);state.totals.hired++;p!.status='filled';p!.offer=null;p!.applications.find(app=>app.residentId===r.id)!.status='hired';
  if(!r.knownBuildings.includes(b.buildingId))r.knownBuildings.push(b.buildingId);
  announce(w,b.buildingId,`${r.name}独立接受${b.name}的聘约：${employmentTermsLabel(contract.terms)}，从第 ${startDay+1} 日起生效，每次仍由本人决定是否到岗。`,[r.id,b.ownerId]);
 }else if(a.operation==='decline'){
  closeOffer(w,p!,'declined');announce(w,p!.buildingId,`${r.name}婉拒录用邀请，预留工资归还出资商铺。`,[r.id,b.ownerId]);
 }else if(a.operation==='cancelPost'){
  closeOffer(w,p!);p!.status='closed';announce(w,p!.buildingId,`${r.name}撤回尚未成立的招聘启事。`,[r.id]);
 }else if(a.operation==='quit')endContract(w,c!,'quit',`${r.name}自行辞职`,r);
 else if(a.operation==='dismiss')endContract(w,c!,'dismissed',`${r.name}决定结束聘用`,r);
 if(mark)w.processed.push(mark);return null;
}
export function employmentDeadline(w:World,actorId:string,includeOffers=true):number {
 const deadlines:number[]=[];
 if(includeOffers)for(const p of w.employment?.posts??[])if(p.status==='offered'&&p.offer?.workerId===actorId&&p.offer.notifiedAt!==undefined)deadlines.push(p.offer.expiresAt);
 for(const c of w.employment?.contracts??[]){
  if(c.status!=='active'||c.workerId!==actorId)continue;
  const today=Math.floor(w.minute/DAY),day=Math.max(today,c.startDay);if(day>=c.endDay)continue;
  const start=day*DAY+c.terms.startMinute,end=start+c.terms.durationMinutes;
  if(w.minute>end)continue;
  const attendance=c.attendance.find(d=>d.day===day);
  if(!attendance?.worked)deadlines.push(start>=w.minute?start:end);
 }
 return Math.min(Infinity,...deadlines);
}

export function completeEmployment(w:World,r:Resident,a:EmploymentAction):string|null{return foodTransaction(w,()=>completeEmploymentAtomic(w,r,a));}

function refundStock(w:World,c:EmploymentContract):void{return foodTransaction(w,()=>refundStockAtomic(w,c));}
