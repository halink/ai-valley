import {mayUseDesignedBuilding} from './resident-designs.js';
import {hasReceipt} from './receipts.js';
import {estateStock,estateLocation} from './estate-custody.js';
import {initializeInfrastructure,advanceInfrastructure,completeTerrain,isInfrastructure} from './infrastructure.js';
import {educationConflict} from './education.js';
import type {Building,Inventory,Item,Resident,Vec,World} from '../shared/types.js';
import type {ConstructionAction,ConstructionGrant,ConstructionMaterial,ConstructionProject,ConstructionWorker} from '../shared/construction.js';
import {accountBalance,initializeEconomy,moveCoins} from './economy.js';
import {constructionFootprint,constructionNames,constructionSiteError,constructionStages,proposedSite} from './construction-sites.js';
import {distance,findPath,same} from './navigation.js';
import {ageYears,DAY} from './time.js';
import {emitEvent,emitLedgerEvent} from './events.js';

const integer=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const live=(p:ConstructionProject)=>['planned','active','paused'].includes(p.status);
const closed=(p:ConstructionProject)=>['completed','removed','cancelled'].includes(p.status);
const personAccount=(w:World,id:string)=>w.residents.find(r=>r.id===id)?.status==='dead'?`estate:${id}`:`resident:${id}`;
const sourceAccount=(w:World,source:string)=>source.startsWith('resident:')?personAccount(w,source.slice(9)):source;
const ownerAccount=(w:World,p:ConstructionProject)=>p.ownerId==='commons'?'treasury':personAccount(w,p.ownerId);
const stockCount=(lots:ConstructionMaterial[],item:string)=>lots.filter(l=>l.item===item).reduce((n,l)=>n+l.quantity,0);
const add=(bag:Inventory,item:Item,n:number)=>{bag[item]=(bag[item]??0)+n;};
const get=(w:World,id:string|undefined)=>w.construction?.projects.find(p=>p.id===id);
const local=(r:Resident,p:ConstructionProject)=>!r.inside&&distance(r.at,p.door)<=8;
const payableWorker=(p:ConstructionProject,id?:string)=>p.workers.find(c=>(c.status==='offered'||c.status==='active')&&(id===undefined||c.workerId===id));
export const remainingConstructionWork=(p:ConstructionProject)=>p.stages.reduce((n,s)=>n+Math.max(0,s.minutes-s.worked),0);
export function neededConstructionMaterials(p:ConstructionProject):Inventory {
 const wanted:Inventory={wood:0,stone:0};
 for(const stage of p.stages)if(stage.startedAt===null)for(const [item,n]of Object.entries(stage.materials))add(wanted,item as Item,n!);
 return {wood:Math.max(0,wanted.wood!-stockCount(p.stock,'wood')),stone:Math.max(0,wanted.stone!-stockCount(p.stock,'stone'))};
}
function tell(w:World,p:ConstructionProject,text:string,actors=[p.managerId]){emitEvent(w,{kind:'construction',actors,place:{...p.door},text});}
function transfer(w:World,from:string,to:string,n:number,reason:string,reference:string){if(n>0&&!moveCoins(w,from,to,n,reason,reference))throw new Error('construction_transfer_failed:'+reason);}
function grant(p:ConstructionProject,source:string,amount:number){let g=p.grants.find(g=>g.source===source);if(!g){g={source,amount:0,remaining:0,refunded:0};p.grants.push(g);}g.amount+=amount;g.remaining+=amount;}
function spend(p:ConstructionProject,amount:number){
 if(p.grants.reduce((n,g)=>n+g.remaining,0)<amount)throw new Error('construction_unfunded_spending');
 let left=amount;for(const g of p.grants){const n=Math.min(g.remaining,left);g.remaining-=n;left-=n;if(!left)break;}
}
function addLot(lots:ConstructionMaterial[],source:string,item:'wood'|'stone',quantity:number){let l=lots.find(l=>l.source===source&&l.item===item);if(!l){l={source,item,quantity:0};lots.push(l);}l.quantity+=quantity;}
function refundFunds(w:World,p:ConstructionProject,reason:string){
 for(const g of p.grants){const n=g.remaining;if(!n)continue;transfer(w,p.account,sourceAccount(w,g.source),n,'工程未用资助退回',`${p.id}:refund:${g.source}:${g.refunded+n}`);g.refunded+=n;g.remaining=0;}
 if(accountBalance(w,p.account)!==0)throw new Error('construction_refund_balance_mismatch');
 if(p.grants.some(g=>g.refunded))tell(w,p,`${p.name}${reason}，未使用的钱款按原出资记录退回；已完成的劳动和已付货款不撤销。`);
}
function endWorker(w:World,p:ConstructionProject,c:ConstructionWorker,status:ConstructionWorker['status']){
 if(c.status!=='active'&&c.status!=='offered')return;
 const refund=accountBalance(w,c.account);transfer(w,c.account,p.account,refund,'施工未挣工资退回工程',`${c.id}:return`);c.refunded+=refund;c.status=status;
 const app=p.applications.find(a=>a.workerId===c.workerId&&['selected','hired'].includes(a.status));if(app)app.status=status==='declined'?'declined':'withdrawn';
 tell(w,p,`${w.residents.find(r=>r.id===c.workerId)?.name??'施工者'}的施工委托已${status==='quit'?'由本人退出':status==='finished'?'结清':'结束'}，已挣工资 ${c.paid} 钱保留，未挣的 ${refund} 钱仍属于工程出资人。`,[p.managerId,c.workerId]);
}
function clearClaimsForDeaths(w:World,p:ConstructionProject){
 for(const lot of p.claims){
  if(!lot.quantity||!lot.source.startsWith('resident:'))continue;
  const id=lot.source.slice(9);if(w.residents.find(r=>r.id===id)?.status!=='dead')continue;
  const estate=w.estates.find(e=>e.personId===id);if(!estate)continue;add(estateStock(w,id,'construction:'+p.id,estateLocation(p.door,null,null,'原施工材料处'))!,lot.item,lot.quantity);lot.quantity=0;
 }
 p.claims=p.claims.filter(l=>l.quantity>0);
}
function settleDeceasedContributors(w:World,p:ConstructionProject){
 const sources=new Set([...p.grants.filter(g=>g.remaining>0).map(g=>g.source),...p.stock.map(l=>l.source)]);
 const deceased=[...sources].filter(source=>source.startsWith('resident:')&&w.residents.find(r=>r.id===source.slice(9))?.status==='dead'&&w.estates.some(e=>e.personId===source.slice(9)));
 if(!deceased.length)return;
 // Pending wages are conditional on future attendance; earned wages are never clawed back.
 for(const c of p.workers)endWorker(w,p,c,'released');
 for(const source of deceased){
  const g=p.grants.find(g=>g.source===source),estate=w.estates.find(e=>e.personId===source.slice(9))!;
  if(g?.remaining){const n=g.remaining;transfer(w,p.account,`estate:${estate.personId}`,n,'逝者未用工程资助保全',`${p.id}:refund:${source}:${g.refunded+n}`);g.refunded+=n;g.remaining=0;}
  for(const lot of p.stock)if(lot.source===source){add(estateStock(w,estate.personId,'construction:'+p.id,estateLocation(p.door,null,null,'原施工材料处'))!,lot.item,lot.quantity);lot.quantity=0;}
 }
 p.stock=p.stock.filter(l=>l.quantity>0);
 if(live(p)){p.status='paused';p.reason='资助或供料者去世，未用钱物已归遗产，等待负责人重新决定施工';}
 p.updatedAt=w.minute;emitLedgerEvent(w,{kind:'construction',actors:[p.managerId,...deceased.map(id=>id.slice(9))],place:{...p.door},text:`${p.name}的逝者未用钱款和未投入材料已保全至各自遗产；已挣工资和已完成部分保留，原施工委托结清，复工须重新决定。`});
}
function cancelProject(w:World,p:ConstructionProject,reason:string,internal=false){
 for(const c of p.workers)endWorker(w,p,c,'released');
 refundFunds(w,p,reason);
 for(const lot of p.stock)addLot(p.claims,lot.source==='owner'?(p.ownerId==='commons'?'treasury':`resident:${p.ownerId}`):lot.source,lot.item,lot.quantity);
 p.stock=[];p.status=Object.values(p.incorporated).some(n=>n!>0)?'abandoned':'cancelled';p.reserved=p.status==='abandoned';p.reason=reason;p.updatedAt=w.minute;
 clearClaimsForDeaths(w,p);
 const text=`${p.name}${reason}。${p.reserved?'已施工部分保留在原址，需另行决定复工或拆除':'未开工占地已经释放'}；未用实物在工地按原归属保管，须本人领取。`;if(internal)emitLedgerEvent(w,{kind:'construction',actors:[p.ownerId,p.managerId],place:{...p.door},text});else tell(w,p,text);
}
export function initializeConstruction(w:World):void {
 if(w.mode!=='formal')return;initializeEconomy(w);initializeInfrastructure(w);
 w.construction??={projects:[],nextSerial:1,yards:{},knownProjects:{},totals:{completed:0,expanded:0,labor:0,wages:0,procurement:0,demolished:0}};
 w.definitions['construction/rules@1']??={id:'construction/rules',version:1,kind:'action',dependencies:[],data:{publicAreas:[{x:208,y:144,width:240,height:192}],stages:['基础与地基','梁柱与墙体','屋顶与交付'],demolitionRecovery:.5}};
 w.activeDefinitions['construction/rules']??='construction/rules@1';
 for(const b of w.buildings)w.construction.yards[b.id]??={x:b.at.x-2,y:b.at.y-2,width:b.width+4,height:b.height+2};
}
export function knowsConstruction(w:World,r:Resident,p:ConstructionProject){return r.id===p.managerId||r.id===p.ownerId||local(r,p)||!!w.construction?.knownProjects[r.id]?.includes(p.id);}
export function hasConstructionAssets(w:World,id:string):boolean {
 return !!w.construction?.projects.some(p=>(p.ownerId===id&&live(p))||p.grants.some(g=>g.source===`resident:${id}`&&g.remaining>0)||[...p.claims,...p.stock].some(l=>l.source===`resident:${id}`&&l.quantity>0));
}
export function constructionDeadline(w:World,id:string):number {return Math.min(Infinity,...(w.construction?.projects.flatMap(p=>p.workers.filter(c=>c.workerId===id&&c.status==='offered'&&c.notifiedAt!==null).map(c=>c.expiresAt))??[]));}
/** Establishes only a separately voted public mandate. The manager still chooses all work. */
export function authorizeConstruction(w:World,id:string,amount:number,managerId:string,days:number):string|null {
 const p=get(w,id),manager=w.residents.find(r=>r.id===managerId);
 if(!p||p.ownerId!=='commons'||closed(p)||!manager||!capable(w,manager)||manager.residency!=='resident')return '公共工程或负责人已不适用';
 if(!integer(amount,0,2000)||!integer(days,1,28)||accountBalance(w,'treasury')<amount)return '公共工程现有预算不足';
 const problem=constructionSiteError(w,p,true);if(problem)return problem;
 for(const c of p.workers)endWorker(w,p,c,'released');
 p.managerId=managerId;p.authorizedUntil=w.minute+days*DAY;p.reserved=true;
 p.status=p.stages.some(s=>s.worked>0)?'paused':'planned';p.reason=null;
 if(amount){transfer(w,'treasury',p.account,amount,'公共工程表决授权',`${p.id}:public:${w.revision}:${w.construction!.nextSerial++}`);grant(p,'treasury',amount);}
 p.updatedAt=w.minute;tell(w,p,`${p.name}经居民独立表决取得 ${days} 日公共建设授权，预算 ${amount} 钱已预留，${manager.name}负责按已表决的用途和地点安排施工。`);return null;
}
export function advanceConstruction(w:World):void {
 initializeConstruction(w);advanceInfrastructure(w);const state=w.construction;if(!state)return;
 for(const p of state.projects){
  for(const r of w.residents)if(r.status==='alive'&&r.residency!=='outside'&&local(r,p)){
   const known=state.knownProjects[r.id]??=[];if(!known.includes(p.id))known.push(p.id);
   for(const c of p.workers)if(c.workerId===r.id&&c.status==='offered')c.notifiedAt??=w.minute;
  }
  for(const c of p.workers){
   const worker=w.residents.find(r=>r.id===c.workerId);
   if((c.status==='offered'||c.status==='active')&&(!worker||!capable(w,worker)||w.minute>=c.expiresAt))endWorker(w,p,c,'expired');
  }
  settleDeceasedContributors(w,p);
  const owner=w.residents.find(r=>r.id===p.ownerId),manager=w.residents.find(r=>r.id===p.managerId);
  if(live(p)&&p.ownerId!=='commons'&&(!owner||owner.status==='dead'||owner.residency==='outside'))cancelProject(w,p,'因产权人死亡或离镇而结束本次施工',true);
  if(live(p)&&p.ownerId==='commons'&&((p.authorizedUntil??0)<=w.minute||!manager||!capable(w,manager))){
   p.status='paused';p.reason='公共授权到期或原负责人无法履职，等待居民重新表决';
   for(const c of p.workers)endWorker(w,p,c,'released');
   if(p.grants.some(g=>g.remaining))refundFunds(w,p,'公共授权暂止');
  }
  if(p.status==='proposed'&&w.minute-p.createdAt>28*DAY){p.status='cancelled';p.reason='提议二十八日内未取得公共建设授权';}
  clearClaimsForDeaths(w,p);
 }
 if(state.projects.length>160)state.projects=state.projects.filter((p,i)=>!closed(p)||p.claims.length>0||p.stock.length>0||accountBalance(w,p.account)>0||i>=state.projects.length-80);
 const retained=new Set(state.projects.map(p=>p.id));for(const known of Object.values(state.knownProjects))for(let i=known.length-1;i>=0;i--)if(!retained.has(known[i]))known.splice(i,1);
}
function materialsReady(p:ConstructionProject){const s=p.stages[p.stage];return !!s&&(s.startedAt!==null||Object.entries(s.materials).every(([item,n])=>stockCount(p.stock,item)>=n!));}
function hasMandate(w:World,p:ConstructionProject){return p.ownerId!=='commons'||(p.authorizedUntil??0)>w.minute;}
function busy(w:World,r:Resident,door:Vec,start:number,end:number):boolean {
 if(educationConflict(w,r.id,start,end))return true;
 const shifts=(w.duties?.shifts??[]).filter(s=>s.workerId===r.id&&['booked','on-duty'].includes(s.status)).map(s=>({start:s.start,end:s.end,buildingId:s.buildingId}));
 for(const c of w.employment?.contracts??[])if(c.status==='active'&&c.workerId===r.id)for(let day=Math.floor(start/DAY)-1;day<=Math.floor(end/DAY)+1;day++)if(day>=c.startDay&&day<c.endDay)shifts.push({start:day*DAY+c.terms.startMinute,end:day*DAY+c.terms.startMinute+c.terms.durationMinutes,buildingId:c.buildingId});
 return shifts.some(s=>{if(start<s.end&&s.start<end)return true;const b=w.buildings.find(b=>b.id===s.buildingId);if(!b)return false;const gap=end<=s.start?s.start-end:start-s.end;if(gap>1440)return false;const path=findPath(w,door,b.door);return path===null||path.length>gap;});
}
export function constructionReason(w:World,r:Resident,a:ConstructionAction,working=false):string|null {
 if(!w.construction||!capable(w,r))return '本人当前不能签订或履行工程安排';
 if(a.operation==='propose'||a.operation==='expand'||a.operation==='convert'||a.operation==='repairInfrastructure'){
  const s=proposedSite(w,r,a);if(!s)return '建筑定义、坐标或扩建方向无效';
  if((a.operation==='propose'||a.operation==='convert')&&!mayUseDesignedBuilding(w,r,s.definition))return '尚未亲自查阅此居民设计的图纸';
  if(s.base&&s.ownerId!=='commons'&&s.ownerId!==r.id)return '只有产权人能提出私人扩建';
  if(s.ownerId==='commons'&&r.residency!=='resident')return '公共建设须由成年常住居民提议';
  if(s.terrain&&s.terrain.tiles.some(t=>distance(r.at,t.at)>16))return '公共地形工程须先实地查看全部邻近施工范围';
  if(r.inside||distance(r.at,s.door)>16)return '须亲自到选址附近查看地面，不能隔空选地';
  if(!integer(a.wagePerHour,0,60)||!a.prices||Object.keys(a.prices).some(i=>!['wood','stone'].includes(i))||!integer(a.prices.wood,1,100)||!integer(a.prices.stone,1,100))return '施工时报酬须为 0–60 钱，木石采购单价须为 1–100 钱';
  if(a.name!==undefined&&(!a.name.trim()||a.name.length>32))return '工程名称须为 1–32 字';
  if(w.construction.projects.some(p=>p.managerId===r.id&&!closed(p)&&p.status!=='abandoned'))return '本人仍有未结束的工程，请先处理既有安排';
  return constructionSiteError(w,s,false);
 }
 const p=get(w,a.projectId);if(!p||!knowsConstruction(w,r,p))return '本人尚未获知这项工程';
 const manager=r.id===p.managerId&&(p.ownerId==='commons'||p.ownerId===r.id),c=payableWorker(p,['hire','reject','release'].includes(a.operation)?a.applicantId:r.id),atSite=local(r,p);
 if(a.operation==='collect')return p.claims.some(l=>l.source===`resident:${r.id}`&&l.quantity>0)?null:'此处没有属于本人的未领材料';
 if(a.operation==='cancel')return manager&&!closed(p)?null:'只能结束本人有权管理的未完工工程';
 if(a.operation==='pause')return manager&&['planned','active'].includes(p.status)?null:'当前不能暂停这项工程';
 if(a.operation==='resume'){
  if(!manager||!hasMandate(w,p)||!['paused','abandoned'].includes(p.status))return '须由有效负责人自行决定复工，公共工程须有当前授权';
  return constructionSiteError(w,p,true);
 }
 if(a.operation==='dismantle'){
  if(!manager||p.status!=='abandoned'||!hasMandate(w,p)||!integer(a.minutes,1,120))return '只能亲自拆除本人获授权的未完工遗留部分';
  const path=findPath(w,r.at,p.door);if(path===null)return '工地目前不可达';
  if(!working&&busy(w,r,p.door,w.minute+path.length,w.minute+path.length+a.minutes))return '拆除与本人已接受的班次或通勤时间冲突';
  return r.health>=45&&r.energy>=10?null:'身体条件不适合拆除';
 }
 if(!live(p)||!hasMandate(w,p))return '工程当前没有有效施工或筹资授权';
 if(a.operation==='fund')return integer(a.amount,1,1000)&&r.coins>=a.amount?null:'须用本人真实钱款资助，单次 1–1000 钱';
 if(a.operation==='donateMaterials'||a.operation==='supply'){
  if(!a.item||!['wood','stone'].includes(a.item)||!integer(a.quantity,1,40)||(r.inventory[a.item]??0)<a.quantity||(neededConstructionMaterials(p)[a.item]??0)<a.quantity)return '现场所需材料、数量或本人携带实物不足';
  if(a.operation==='donateMaterials')return null;
  return a.quotedPrice===p.prices[a.item]&&accountBalance(w,p.account)>=a.quantity*p.prices[a.item]!?null:'工程采购余额或本人已知价格不适用';
 }
 if(a.operation==='apply')return atSite&&r.id!==p.ownerId&&!p.applications.some(app=>app.workerId===r.id&&['pending','selected','hired'].includes(app.status))?null:'须实际在工地看到条件，自主提交尚不存在的申请';
 if(a.operation==='withdraw')return p.applications.some(app=>app.workerId===r.id&&app.status==='pending')?null:'本人没有待处理施工申请';
 if(a.operation==='hire'||a.operation==='reject'){
  const applicant=w.residents.find(r=>r.id===a.applicantId);
  if(!manager||!atSite||!applicant||!capable(w,applicant)||!p.applications.some(app=>app.workerId===applicant.id&&app.status==='pending'))return '负责人须亲自查看真实申请，选择仍能自主决定的申请人';
  if(a.operation==='reject')return null;
  if(c)return '同一申请人已有待确认或有效的施工委托';
  if(p.workers.filter(c=>c.status==='offered'||c.status==='active').length>=4)return '本处已经有四名待确认或在岗施工者，需先结束原委托';
  return accountBalance(w,p.account)>=Math.ceil(remainingConstructionWork(p)*p.wagePerHour/60)?null:'尚不能预存这段剩余工程的全部施工工资';
 }
 if(a.operation==='accept'||a.operation==='decline')return c?.status==='offered'&&c.workerId===r.id&&c.expiresAt>w.minute&&(c.notifiedAt!==null||atSite)?null:'本人尚未在工地获知有效的施工邀请';
 if(a.operation==='quit')return c?.workerId===r.id&&c.status==='active'?null:'本人没有这项有效施工委托';
 if(a.operation==='release')return manager&&c?null:'本人没有可结束的施工委托';
 if(a.operation==='work'){
  if(!p.stages[p.stage]||(a.stage!==undefined&&a.stage!==p.stage))return '这次选择的施工阶段已结束，请另行决定下一阶段';
  if(p.status==='paused')return '工程已经停工，须负责人另行决定复工';
  if(r.id!==p.ownerId&&!(c?.status==='active'&&c.workerId===r.id))return '须本人为私人产权人，或另行接受施工委托';
  if(!integer(a.minutes,1,120)||r.health<45||r.energy<10)return '本次施工须为 1–120 分钟且身体条件适合';
  if(atSite&&!materialsReady(p))return '当前阶段材料尚未备齐，不能虚记劳动';
  const path=findPath(w,r.at,p.door);if(path===null)return '工地目前不可达';
  const duration=Math.min(a.minutes,p.stages[p.stage]?.minutes-p.stages[p.stage]?.worked);
  if(!working&&busy(w,r,p.door,w.minute+path.length,w.minute+path.length+duration))return '本次施工与本人已接受的班次或通勤时间冲突';
  return null;
 }
 return '没有这项工程操作';
}
export function constructionTarget(w:World,r:Resident,a:ConstructionAction):{target:Vec;duration:number;error?:string}{
 const error=constructionReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 if(a.operation==='propose'||a.operation==='expand'||a.operation==='convert'||a.operation==='repairInfrastructure')return {target:constructionFootprint(w,a)!.door,duration:10};
 const p=get(w,a.projectId)!;
 if(a.operation==='work')a.stage??=p.stage;
 const duration=a.operation==='work'?Math.min(a.minutes!,p.stages[p.stage].minutes-p.stages[p.stage].worked):a.operation==='dismantle'?Math.min(a.minutes!,Number(w.definitions[`construction/rules@${p.ruleVersion}`]?.data.demolitionDuration??120)-p.demolitionMinutes):5;
 return {target:{...p.door},duration};
}
function completeBuilding(w:World,p:ConstructionProject){
 if(p.mode==='terrain'){const error=completeTerrain(w,p);if(error){p.status='paused';p.reason=error;return;}p.status='completed';p.reserved=false;p.finishedAt=w.minute;p.reason=null;for(const c of p.workers)endWorker(w,p,c,'finished');refundFunds(w,p,'完工');tell(w,p,`${p.name}实际完成全部阶段并开放使用，地形、通路或墓位按原方案生效，没有自动指派居民使用。`);return;}
 if(isInfrastructure(p.kind)){p.status='paused';p.reason='工程种类与地形约定不一致';return;}
 const problem=constructionSiteError(w,p,true);if(problem){p.status='paused';p.reason=problem;return;}
 if(p.base){
  const b=w.buildings.find(b=>b.id===p.base!.id)!;
  const area=p.width*p.height-b.width*b.height;
  if(p.mode==='conversion'){(b.conversions??=[]).push({projectId:p.id,from:b.kind,to:p.kind,oldDefinition:b.definition,definition:p.definition,completedAt:w.minute});b.kind=p.kind;b.definition=p.definition;b.name=p.name;w.construction!.totals.converted=(w.construction!.totals.converted??0)+1;}
  b.at={...p.at};b.width=p.width;b.height=p.height;b.capacity=p.capacity;b.condition=Math.max(b.condition,90);
  if(p.mode!=='conversion'){(b.extensions??=[]).push({projectId:p.id,definition:p.definition,completedAt:w.minute,addedArea:area});w.construction!.totals.expanded++;}p.buildingId=b.id;
 }else{
  const b:Building={id:`built:${p.id}`,name:p.name,kind:p.kind,at:{...p.at},width:p.width,height:p.height,door:{...p.door},ownerId:p.ownerId,definition:p.definition,capacity:p.capacity,residents:[],condition:100};
  w.buildings.push(b);p.buildingId=b.id;
  w.construction!.yards[b.id]={...b.at,width:b.width,height:b.height};w.construction!.totals.completed++;
 }
 p.status='completed';p.reserved=false;p.finishedAt=w.minute;p.reason=null;
 for(const c of p.workers)endWorker(w,p,c,'finished');refundFunds(w,p,'完工');
 for(const r of w.residents)if(local(r,p)&&!r.knownBuildings.includes(p.buildingId!))r.knownBuildings.push(p.buildingId!);
 tell(w,p,`${p.name}完成全部阶段并交付，${p.mode==='conversion'?'原建筑身份、占地和产权保留，新用途现在启用':p.base?'原建筑与住户保留，新空间现在启用':'房屋现在成为真实可使用的场所'}${['home','lodge'].includes(p.kind)?`，登记床位 ${p.capacity} 个`:''}。没有自动安排居民入住、经营或上班。`);
}
/** Actual fractional labour only; attendance and progress have a bounded per-person replay guard. */
export function constructionWorkError(w:World,r:Resident,a:ConstructionAction,dt:number):string|null {
 if(a.operation!=='work'&&a.operation!=='dismantle')return null;
 const p=get(w,a.projectId);if(!p)return '工程已不存在';
 if(a.operation==='work'&&p.status==='completed')return null;
 if(a.operation==='dismantle'&&p.status==='removed')return null;
 const error=constructionReason(w,r,a,true);if(error)return error;
 if(!same(r.at,p.door)||r.inside)return '须本人实际到达施工入口';
 if(a.operation==='dismantle'){
  if(p.lastDemolitionAt!==null&&p.lastDemolitionAt>=w.minute-1e-9)return null;
  const demolitionDuration=Number(w.definitions[`construction/rules@${p.ruleVersion}`]?.data.demolitionDuration??120),recovery=Number(w.definitions[`construction/rules@${p.ruleVersion}`]?.data.demolitionRecovery??.5),minutes=Math.min(dt,demolitionDuration-p.demolitionMinutes,r.activity?.remaining??dt);
  if(busy(w,r,p.door,w.minute-minutes,w.minute))return '本人的既有岗位时段开始，拆除不能继续占用该工时';
  p.demolitionMinutes+=minutes;p.lastDemolitionAt=w.minute;
  if(p.demolitionMinutes>=demolitionDuration-1e-8){
   p.demolitionMinutes=demolitionDuration;if(r.activity?.action===a)r.activity.remaining=0;
   const source=p.ownerId==='commons'?'treasury':`resident:${p.ownerId}`;
   for(const item of ['wood','stone'] as const)addLot(p.claims,source,item,Math.floor((p.incorporated[item]??0)*recovery));
   p.status='removed';p.reserved=false;p.finishedAt=w.minute;w.construction!.totals.demolished++;
   tell(w,p,`${r.name}实际拆除了${p.name}的未完工部分，按原规范回收${recovery*100}%已投入木石，仍按原产权保存在工地，土地重新开放。`,[r.id]);
  }
  return null;
 }
 const stage=p.stages[p.stage];if(!stage)return '工程阶段不存在';
 if(!materialsReady(p))return '当前阶段的实际材料尚未备齐';
 let entry=p.labor.find(l=>l.workerId===r.id);if(!entry){entry={workerId:r.id,minutes:0,lastAt:-1};p.labor.push(entry);}if(entry.lastAt>=w.minute-1e-9)return null;
 const minutes=Math.min(dt,stage.minutes-stage.worked,r.activity?.remaining??dt);if(minutes<=0)return null;
 if(busy(w,r,p.door,w.minute-minutes,w.minute))return '本人的既有岗位时段开始，施工不能继续占用该工时';
 if(stage.startedAt===null){
  for(const [item,n]of Object.entries(stage.materials)){let left=n!;for(const lot of p.stock){if(lot.item!==item)continue;const used=Math.min(lot.quantity,left);lot.quantity-=used;left-=used;if(!left)break;}add(p.incorporated,item as Item,n!);}
  p.stock=p.stock.filter(l=>l.quantity>0);stage.startedAt=w.minute-minutes;
  tell(w,p,`${p.name}开始「${stage.name}」，本阶段木石已实际投入，后续暂停仍保留。`,[r.id]);
 }
 p.status='active';stage.worked+=minutes;entry.minutes+=minutes;entry.lastAt=w.minute;p.updatedAt=w.minute;w.construction!.totals.labor+=minutes;r.skills.building+=minutes/6000;
 const c=payableWorker(p,r.id);
 if(c?.workerId===r.id&&c.status==='active'){
  c.worked+=minutes;const earned=Math.floor(c.worked*c.wagePerHour/60+1e-8),due=earned-c.paid;
  if(due){transfer(w,c.account,personAccount(w,r.id),due,'实际施工工资',`${c.id}:earned:${earned}`);spend(p,due);c.paid+=due;p.spentWages+=due;w.construction!.totals.wages+=due;}
 }
 if(stage.worked>=stage.minutes-1e-8){stage.worked=stage.minutes;stage.finishedAt=w.minute;p.stage++;if(r.activity?.action===a)r.activity.remaining=0;tell(w,p,`${p.name}的「${stage.name}」实际完工。${p.stage<p.stages.length?'下一阶段仍须材料齐备，并由施工者另行决定继续':'正在核验最终用地与入口' }。`,[r.id]);if(p.stage===p.stages.length)completeBuilding(w,p);}
 return null;
}
export function completeConstruction(w:World,r:Resident,a:ConstructionAction):string|null {
 if(a.operation==='work'||a.operation==='dismantle')return null;
 const ref=r.activity?`construction:${r.activity.planId}:${r.activity.startedAt}:${a.operation}`:`construction:${r.id}:${r.revision}:${w.revision}:${w.construction?.nextSerial}`;
 if(hasReceipt(w,ref))return null;
 const error=constructionReason(w,r,a);if(error)return error;
 const target=a.operation==='propose'||a.operation==='expand'||a.operation==='convert'||a.operation==='repairInfrastructure'?constructionFootprint(w,a)!.door:get(w,a.projectId)!.door;
 if(!same(r.at,target))return '须亲自到工地完成确认、付款、交货或取回';
 if(a.operation==='propose'||a.operation==='expand'||a.operation==='convert'||a.operation==='repairInfrastructure'){
  const s=proposedSite(w,r,a)!,problem=constructionSiteError(w,s,true);if(problem)return problem;
  const id=`project:${w.id}:${w.construction!.nextSerial++}`,publicProject=s.ownerId==='commons';
  const board=w.buildings.filter(b=>b.ownerId==='commons'&&r.knownBuildings.includes(b.id)).sort((a,b)=>distance(a.door,s.door)-distance(b.door,s.door))[0];
  if(publicProject&&!board)return '须先知道一处可公开议决的公共公告板';
  const p:ConstructionProject={id,name:a.name?.trim()||(s.base?s.base.name+(s.mode==='conversion'?'改造为'+constructionNames[s.kind]:'扩建'):r.name+'的'+constructionNames[s.kind]),mode:s.mode,ownerId:s.ownerId,managerId:r.id,kind:s.kind,definition:s.definition,ruleVersion:s.ruleVersion,
   ...(s.terrain?{terrain:structuredClone(s.terrain)}:{}),at:s.at,width:s.width,height:s.height,door:s.door,base:s.base?structuredClone(s.base):null,capacity:s.capacity,buildingId:s.base?.id??null,boardId:board?.id??null,
   createdAt:w.minute,updatedAt:w.minute,finishedAt:null,authorizedUntil:null,status:publicProject?'proposed':'planned',reserved:!publicProject,reason:null,
   stages:constructionStages(s.cost,s.minutes).map((stage,i)=>({...stage,name:String((w.definitions[`construction/rules@${s.ruleVersion}`]?.data.stages as string[]|undefined)?.[i]??stage.name)})),stage:0,incorporated:{},stock:[],claims:[],grants:[],account:`escrow:${id}`,wagePerHour:a.wagePerHour!,prices:{...a.prices},spentWages:0,spentSupplies:0,
   applications:[],workers:[],nextWorker:1,labor:[],demolitionMinutes:0,lastDemolitionAt:null};
  w.construction!.projects.push(p);(w.construction!.knownProjects[r.id]??=[]).push(id);
  tell(w,p,`${r.name}自主提出${p.name}，选址(${p.at.x},${p.at.y})，${p.width}×${p.height}格，${publicProject?'公共用途须另经居民表决，尚未预留土地':'本人登记用地已预留'}；时薪 ${p.wagePerHour} 钱、木材每份 ${p.prices.wood} 钱、石料每份 ${p.prices.stone} 钱。筹资、供料和施工都需各人另行决定。`);
 }else{
  const p=get(w,a.projectId)!,c=payableWorker(p,['hire','reject','release'].includes(a.operation)?a.applicantId:r.id);
  if(a.operation==='fund'){transfer(w,`resident:${r.id}`,p.account,a.amount!,'居民自主工程资助',ref);grant(p,`resident:${r.id}`,a.amount!);tell(w,p,`${r.name}自愿为${p.name}投入 ${a.amount} 钱，未用部分结束时退回，资助不取得产权或他人的劳动承诺。`,[r.id]);}
  else if(a.operation==='donateMaterials'||a.operation==='supply'){
   if(a.operation==='supply'){const price=p.prices[a.item!]!*a.quantity!;transfer(w,p.account,`resident:${r.id}`,price,'工程实际材料采购',ref);spend(p,price);p.spentSupplies+=price;w.construction!.totals.procurement+=price;}
   r.inventory[a.item!]=(r.inventory[a.item!]??0)-a.quantity!;addLot(p.stock,a.operation==='supply'?'owner':`resident:${r.id}`,a.item!,a.quantity!);
   tell(w,p,`${r.name}实际交付 ${a.quantity} 份${a.item==='wood'?'木材':'石料'}给${p.name}${a.operation==='supply'?'，按本人接受的报价收到货款':'，已投入部分不再退回，未用部分保留取回权'}。`,[r.id]);
  }else if(a.operation==='apply'){p.applications.push({workerId:r.id,at:w.minute,status:'pending'});tell(w,p,`${r.name}看到时薪 ${p.wagePerHour} 钱的施工条件后自行申请，等待负责人择人和自己的最终确认。`,[r.id]);}
  else if(a.operation==='withdraw'){p.applications.find(app=>app.workerId===r.id&&app.status==='pending')!.status='withdrawn';}
  else if(a.operation==='reject'){p.applications.find(app=>app.workerId===a.applicantId&&app.status==='pending')!.status='rejected';}
  else if(a.operation==='hire'){
   const id=`${p.id}:worker:${p.nextWorker++}`,reserved=Math.ceil(remainingConstructionWork(p)*p.wagePerHour/60),account=`escrow:${id}`;
   transfer(w,p.account,account,reserved,'施工邀请预存工资',ref);
   p.workers.push({id,workerId:a.applicantId!,status:'offered',account,offeredAt:w.minute,expiresAt:w.minute+2*DAY,notifiedAt:null,acceptedAt:null,wagePerHour:p.wagePerHour,reserved,worked:0,paid:0,refunded:0});
   p.applications.find(app=>app.workerId===a.applicantId&&app.status==='pending')!.status='selected';
   tell(w,p,`${r.name}选择 ${w.residents.find(r=>r.id===a.applicantId)?.name}施工，预留 ${reserved} 钱工资，仍等待申请人到工地获知并亲自接受。`,[r.id]);
  }else if(a.operation==='accept'){c!.status='active';c!.acceptedAt=w.minute;c!.expiresAt=w.minute+14*DAY;p.applications.find(app=>app.workerId===r.id&&app.status==='selected')!.status='hired';tell(w,p,`${r.name}独立接受${p.name}的施工委托，按实际工时累计取得工资，每次是否到场工作仍由本人决定。`,[r.id]);}
  else if(a.operation==='decline'||a.operation==='quit'||a.operation==='release')endWorker(w,p,c!,a.operation==='decline'?'declined':a.operation==='quit'?'quit':'released');
  else if(a.operation==='pause'){p.status='paused';p.reason='负责人自主暂停施工';tell(w,p,`${r.name}决定暂停${p.name}，已经投入的材料、工时和工资保留。`);}
  else if(a.operation==='resume'){
   const source=p.ownerId==='commons'?'treasury':`resident:${p.ownerId}`;
   for(const lot of p.claims)if(lot.source===source){const needed=neededConstructionMaterials(p)[lot.item]??0;const n=Math.min(needed,lot.quantity);addLot(p.stock,'owner',lot.item,n);lot.quantity-=n;}
   p.claims=p.claims.filter(l=>l.quantity>0);
   p.status=p.stage>=p.stages.length?'active':'planned';p.reserved=true;p.reason=null;
   if(p.stage>=p.stages.length)completeBuilding(w,p);else tell(w,p,`${r.name}决定继续${p.name}，从已保存的实际阶段恢复，仍待自愿施工。`);
  }else if(a.operation==='cancel')cancelProject(w,p,'由负责人决定结束');
  else if(a.operation==='collect'){
   for(const lot of p.claims)if(lot.source===`resident:${r.id}`){add(r.inventory,lot.item,lot.quantity);lot.quantity=0;}
   p.claims=p.claims.filter(l=>l.quantity>0);tell(w,p,`${r.name}亲自取回工地保管的本人材料。`,[r.id]);
  }
  p.updatedAt=w.minute;
 }
 w.processed.push(ref);r.revision++;w.revision++;return null;
}
