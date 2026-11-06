import {hasReceipt} from './receipts.js';
import {fixtureMeasureError,authorizeFixtureRemoval} from './fixture-removal.js';
import {authorizeLongCare} from './long-care.js';
import {authorizePension,supportEligible} from './support.js';
import {coLocated} from './proximity.js';
import {foodTransaction} from './food.js';
import {authorizeEducation,subjects} from './education.js';
import type {Building,Inventory,Item,Resident,Vec,World} from '../shared/types.js';
import type {CivicAction,CivicBudget,CivicMeasure,CivicProposal} from '../shared/civic.js';
import type {PublicShift} from '../shared/public-duties.js';
import {accountBalance,initializeEconomy,moveCoins} from './economy.js';
import {emitEvent} from './events.js';
import {distance,same} from './navigation.js';
import {ageYears,DAY} from './time.js';
import {authorizeConstruction} from './construction.js';
import {constructionNames} from './construction-sites.js';

const prices:Inventory={turnip:2,meal:4,water:1,wood:2,stone:2};
const integer=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const citizen=(w:World,r:Resident)=>capable(w,r)&&r.residency==='resident';
const board=(w:World,id:string)=>w.buildings.find(b=>b.id===id&&b.ownerId==='commons'&&b.condition>=0);
const local=(r:Resident,b:Building)=>distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id);
const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([i,n])=>(bag[i as Item]??0)>=n!);
const change=(bag:Inventory,cost:Inventory,sign:number)=>{for(const [i,n]of Object.entries(cost))bag[i as Item]=(bag[i as Item]??0)+sign*n!;};
const itemNames:Record<string,string>={turnip:'芜菁',meal:'餐食',water:'清水',wood:'木材',stone:'石料'};
function tell(w:World,place:Building,text:string,actors:string[]=[]){emitEvent(w,{kind:'trade',actors,place:{...place.door},text});}

export function initializeCivic(w:World):void {
 if(w.mode!=='formal')return;
 initializeEconomy(w);
 w.civic??={proposals:[],budgets:[],stores:{},salesTax:null,nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};
}
function quotePrices(m:Extract<CivicMeasure,{kind:'service'|'repair'}>):Inventory {const source={...prices,...m.prices};return m.kind==='repair'?{wood:source.wood,stone:source.stone}:{turnip:source.turnip,meal:source.meal,water:source.water};}
function priceLabel(m:Extract<CivicMeasure,{kind:'service'|'repair'}>){return Object.entries(quotePrices(m)).map(([item,n])=>`${itemNames[item]}每份${n}钱`).join('、');}
export function measureLabel(w:World,m:CivicMeasure):string {
 if(m.kind==='fixtureRemoval')return `拆卸${w.buildings.find(b=>b.id===m.buildingId)?.name??'原公共场所'}的具体设备${m.stationId}，授权${m.durationDays}日，总工资上限${m.wage}钱，按实际工时分次支付，回收物留原公共库存；有效服务承诺须先处理`;
 if(m.kind==='salesTax')return `货币买卖向买方加收 ${m.basisPoints/100}% 公共销售税，施行 ${m.durationDays} 日`;
 if(m.kind==='careSupport'){const c=w.longCare?.agreements.find(c=>c.id===m.agreementId);return c?`为${w.residents.find(r=>r.id===c.beneficiaryId)?.name}的具体托育或长期照护预存${m.amount}钱，照护者${w.residents.find(r=>r.id===c.providerId)?.name}，每日${c.visitsPerDay}次、每次${c.fee}钱，从约定日起持续${m.durationDays}日，仍须各方另行同意，未完成服务不付薪`:'原具体照护议案';}
 if(m.kind==='pension')return `为${w.residents.find(r=>r.id===m.beneficiaryId)?.name}预存每日${m.amountPerDay}钱、持续${m.durationDays}日的生活保障，本人须自行接受，是否工作仍由本人决定`;
 if(m.kind==='education'){const l=w.education?.lessons.find(l=>l.id===m.lessonId);return l?`为${w.residents.find(r=>r.id===l.teacherId)?.name}的${subjects[l.subject]}课堂预留${m.amount}钱助学金，完整学费每人${l.fee}钱，最多${l.capacity}席，授权${m.durationDays}日，未发生教学不付薪`:'原教学议案';}
 if(m.kind==='construction'){
  const p=w.construction?.projects.find(p=>p.id===m.projectId);
  return p?`${p.name}公共建设：地点(${p.at.x},${p.at.y})，${p.width}×${p.height}格，${p.mode==='conversion'?'原建筑改为'+constructionNames[p.kind]:p.mode==='expansion'?'扩建原房屋':'新建'+constructionNames[p.kind]}，时薪${p.wagePerHour}钱、木石采购价${p.prices.wood}/${p.prices.stone}钱，授权提议人管理${m.durationDays}日，金库拨款${m.amount}钱`:'原公共建设工程';
 }
 const place=w.buildings.find(b=>b.id===m.buildingId)?.name??'指定用房';
 return m.kind==='service'?`${place}每次完成服务付 ${m.wagePerService} 钱，工资总额 ${m.wageBudget} 钱、采购总额 ${m.suppliesBudget} 钱，期限 ${m.durationDays} 日（${priceLabel(m)}）`:
 `${place}一次修缮，工资 ${m.wage} 钱、材料采购限额 ${m.suppliesBudget} 钱，期限 ${m.durationDays} 日（6木材、4石料，${priceLabel(m)}，修复30点）`;
}
function measureError(w:World,m:CivicMeasure):string|null {
 if(!m||!integer(m.durationDays,1,28))return '公共授权期限须为 1 至 28 日';
 if(m.kind==='fixtureRemoval')return fixtureMeasureError(w,m);
 if(m.kind==='salesTax')return integer(m.basisPoints,0,1500)?null:'销售税须在 0% 至 15% 之间';
 if(m.kind==='careSupport'){const c=w.longCare?.agreements.find(c=>c.id===m.agreementId);return c&&c.status==='offered'&&!c.funding&&integer(m.amount,1,2000)&&m.amount===c.fee*(c.endDay-c.startDay)*c.visitsPerDay&&m.durationDays===c.endDay-c.startDay&&w.minute<c.startDay*DAY+c.startMinute+c.windowMinutes?null:'需要尚未接受的具体照护约定，以及与其完整次数、费用和期限一致的有限额度';}
 if(m.kind==='pension')return supportEligible(w,m.beneficiaryId)&&integer(m.amountPerDay,1,20)&&!w.longCare?.supports.some(g=>g.beneficiaryId===m.beneficiaryId&&['offered','active'].includes(g.status))?null:'需要真实在世的本镇长者或行动受限者，每日1–20钱且没有重复保障';
 if(m.kind==='education'){const l=w.education?.lessons.find(l=>l.id===m.lessonId);return l&&l.buildingId===m.buildingId&&l.status==='scheduled'&&l.end>w.minute&&l.fee>0&&w.buildings.some(b=>b.id===m.buildingId&&b.ownerId==='commons')&&integer(m.amount,1,1000)&&!l.funding?null:'需要真实已发布的公共课堂、足额期限及尚未批准的助学额度';}
 if(m.kind==='construction'){
  const p=w.construction?.projects.find(p=>p.id===m.projectId);
  return p&&p.ownerId==='commons'&&p.boardId===m.buildingId&&!['completed','removed','cancelled'].includes(p.status)&&integer(m.amount,0,2000)?null:'必须为已登记的具体公共建设用途、地点与管理期限提出有限拨款';
 }
 if(!['service','repair'].includes(m.kind))return '未支持的公共议案';
 const b=w.buildings.find(b=>b.id===m.buildingId&&b.ownerId==='commons'&&b.condition>=0);
 if(!b)return '只能为真实的公共用房提出预算';
 if(m.prices!==undefined&&(!m.prices||Array.isArray(m.prices)||typeof m.prices!=='object'||Object.entries(m.prices).some(([item,n])=>!Object.hasOwn(m.kind==='repair'?{wood:1,stone:1}:{turnip:1,meal:1,water:1},item)||!integer(n!,1,100))))return '采购单价须为本议案物资每份 1 至 100 钱';
 if(!integer(m.suppliesBudget,0,1000))return '材料预算须在 0 至 1000 钱之间';
 if(m.kind==='service'&&(b.condition<=0||!['lodge','clinic'].includes(b.kind)||!integer(m.wagePerService,1,20)||!integer(m.wageBudget,m.wagePerService,1000)))return '该服务工资或用房不适用';
 if(m.kind==='repair'&&(!integer(m.wage,1,100)||b.condition>=100))return '修缮工资或房屋状态不适用';
 return null;
}
function duplicateMeasure(a:CivicMeasure,b:CivicMeasure){
 if(a.kind!==b.kind)return false;
 if(a.kind==='fixtureRemoval')return b.kind==='fixtureRemoval'&&a.stationId===b.stationId;
 if(a.kind==='salesTax')return true;
 if(a.kind==='careSupport')return b.kind==='careSupport'&&a.agreementId===b.agreementId;
 if(a.kind==='pension')return b.kind==='pension'&&a.beneficiaryId===b.beneficiaryId;
 if(a.kind==='education')return b.kind==='education'&&a.lessonId===b.lessonId;
 if(a.kind==='construction')return b.kind==='construction'&&a.projectId===b.projectId;
 return b.kind!=='salesTax'&&a.buildingId===b.buildingId;
}
function finishProposal(w:World,p:CivicProposal):void {
 if(p.status!=='open')return;
 const yes=Object.values(p.votes).filter(Boolean).length,no=Object.values(p.votes).filter(v=>!v).length;
 const majority=Math.floor(p.electorate.length/2)+1,quorum=Math.ceil(p.electorate.length/2);
 if(w.minute<p.closesAt&&yes<majority&&no<majority)return;
 const passed=yes>no&&yes+no>=quorum&&(w.minute>=p.closesAt||yes>=majority);
 p.decidedAt=w.minute;p.status=passed?'approved':'rejected';
 const place=w.buildings.find(b=>b.id===p.buildingId)!;
 if(passed){
  const m=p.measure;
  if(m.kind==='fixtureRemoval'){const error=authorizeFixtureRemoval(w,m,p.id);if(error){p.status='unfunded';p.executionError=error;}}
  else if(m.kind==='salesTax')w.civic!.salesTax={basisPoints:m.basisPoints,expiresAt:w.minute+m.durationDays*DAY,proposalId:p.id};
  else if(m.kind==='careSupport'){const error=authorizeLongCare(w,m.agreementId,m.amount,m.durationDays,p.id);if(error){p.status='unfunded';p.executionError=error;}}
  else if(m.kind==='pension'){const error=authorizePension(w,m.beneficiaryId,m.amountPerDay,m.durationDays,p.id);if(error){p.status='unfunded';p.executionError=error;}}
  else if(m.kind==='education'){const error=authorizeEducation(w,m.lessonId,m.amount,m.durationDays,p.id);if(error){p.status='unfunded';p.executionError=error;}}
  else if(m.kind==='construction'){
   const error=authorizeConstruction(w,m.projectId,m.amount,p.proposerId,m.durationDays);if(error){p.status='unfunded';p.executionError=error;}
  }
  else{
   const wage=m.kind==='service'?m.wageBudget:m.wage;
   const total=wage+m.suppliesBudget;
   if(accountBalance(w,'treasury')<total || w.civic!.budgets.some(b=>b.kind===m.kind&&b.buildingId===m.buildingId&&b.status==='active'))p.status='unfunded';
   else{
    const id=`budget:${w.id}:${w.civic!.nextSerial++}`;
    const b:CivicBudget={id,proposalId:p.id,buildingId:m.buildingId,kind:m.kind,startsAt:w.minute,expiresAt:w.minute+m.durationDays*DAY,status:'active',wage:m.kind==='service'?m.wagePerService:m.wage,wageLimit:wage,suppliesLimit:m.suppliesBudget,paidWages:0,spentSupplies:0,wageAccount:`escrow:${id}:wages`,supplyAccount:`escrow:${id}:supplies`,prices:quotePrices(m),purchased:{}};
    // Both totals are checked before either leg. No person can spend the other envelope.
    moveCoins(w,'treasury',b.wageAccount,wage,'公共工资授权',`${id}:authorize-wages`);
    moveCoins(w,'treasury',b.supplyAccount,m.suppliesBudget,'公共采购授权',`${id}:authorize-supplies`);
    w.civic!.budgets.push(b);p.budgetId=id;
   }
  }
 }
 tell(w,place,`公共议案计票 ${yes} 赞成、${no} 反对，登记选民 ${p.electorate.length} 人。${p.status==='approved'?'议案通过并取得有限授权':p.status==='unfunded'?'虽获赞成，因'+(p.executionError??'现有资金不足或同类预算仍在执行')+'，本次不支出':'议案未通过'}。${measureLabel(w,p.measure)}。`,[p.proposerId]);
}
function refund(w:World,account:string,reference:string){const balance=accountBalance(w,account);if(balance>0)moveCoins(w,account,'treasury',balance,'公共余款退回',reference);}
export function advanceCivic(w:World):void {
 if(w.mode!=='formal')return;
 initializeCivic(w);
 for(const p of w.civic!.proposals)if(p.status==='open')finishProposal(w,p);
 if(w.civic!.salesTax&&w.civic!.salesTax.expiresAt<=w.minute)w.civic!.salesTax=null;
 for(const b of w.civic!.budgets){
  if(b.repairWorkerId){
   const worker=w.residents.find(r=>r.id===b.repairWorkerId),place=w.buildings.find(p=>p.id===b.buildingId);
   const action=worker?.activity?.action;
   if(b.status!=='active'||!worker||!capable(w,worker)||!place||!same(worker.at,place.door)||action?.type!=='civic'||action.operation!=='repair'||action.budgetId!==b.id)delete b.repairWorkerId;
  }
  if(b.status!=='active'||b.expiresAt>w.minute)continue;
  b.status='expired';delete b.repairWorkerId;refund(w,b.wageAccount,`${b.id}:expire-wages`);refund(w,b.supplyAccount,`${b.id}:expire-supplies`);
  const place=w.buildings.find(p=>p.id===b.buildingId);
  if(place)tell(w,place,`${place.name}的公共预算到期，未承诺的余款已退回金库；续办仍需新的居民表决。`);
 }
 // Closed proposals and budgets retain a bounded public history; no active obligation is discarded.
 const active=new Set(w.duties?.shifts.filter(s=>!['finished','unfilled'].includes(s.status)).map(s=>s.funding?.budgetId));
 w.civic!.proposals=w.civic!.proposals.filter((p,i,all)=>p.status==='open'||i>=all.length-80||w.civic!.budgets.some(b=>b.proposalId===p.id&&b.status==='active'));
 w.civic!.budgets=w.civic!.budgets.filter((b,i,all)=>b.status==='active'||active.has(b.id)||i>=all.length-80);
}
function actionPlace(w:World,a:CivicAction):Building|undefined {
 if(a.operation==='donate'||a.operation==='propose')return board(w,a.buildingId);
 if(a.operation==='vote')return w.buildings.find(b=>b.ownerId==='commons'&&b.condition>=0&&w.civic?.proposals.some(p=>p.id===a.proposalId));
 const budget=w.civic?.budgets.find(b=>b.id===a.budgetId);
 return budget?w.buildings.find(b=>b.id===budget.buildingId&&b.ownerId==='commons'&&b.condition>=0):undefined;
}
export function civicReason(w:World,r:Resident,a:CivicAction):string|null {
 if(w.mode!=='formal'||!w.civic||!capable(w,r))return '当前不能处理公共事务';
 let place=actionPlace(w,a);
 if(a.operation==='vote')place=w.buildings.find(b=>board(w,b.id)&&local(r,b));
 if(!place)return '须在真实的公共公告板或预算用房办理';
 if(!local(r,place))return '请先亲自到公告板或交货地点查看';
 if(a.operation==='donate')return integer(a.amount,1,1000)&&r.coins>=a.amount?null:'捐款需要本人真实持有的钱款';
 if(a.operation==='propose'){
  if(!citizen(w,r))return '公共议案由成年常住居民提出';
  const problem=measureError(w,a.measure);if(problem)return problem;
  if(a.measure.kind==='careSupport'){const id=a.measure.agreementId;const c=w.longCare?.agreements.find(c=>c.id===id);if(!c||(c.knownBy??[]).includes(r.id)===false)return '本人尚未实际获知这项具体照护约定';}
  if(a.measure.kind==='pension'){const id=a.measure.beneficiaryId;const p=w.residents.find(p=>p.id===id);if(!p||p.id!==r.id&&!r.knownPeople.includes(p.id)||ageYears(p.bornAt,w.minute)<65&&!coLocated(w,r,p,6))return '本人须实际认识受助者，行动受限需要本人眼前可观察的实际情况';}
  if(a.measure.kind!=='salesTax'&&a.measure.buildingId!==place.id)return '请到指定用房提出本处预算';
  if(w.civic.proposals.some(p=>p.status==='open'&&(p.proposerId===r.id||duplicateMeasure(p.measure,a.measure))))return '同类议案或本人议案仍在表决';
  if(w.civic.proposals.some(p=>p.proposerId===r.id&&w.minute-p.createdAt<DAY))return '本人今日已提出议案，可先参与讨论与投票';
  if(a.measure.kind!=='salesTax'&&w.civic.budgets.some(b=>b.status==='active'&&b.kind===a.measure.kind&&b.buildingId===place.id))return '本处同类预算仍在执行';
  return null;
 }
 if(a.operation==='vote'){
  const p=w.civic.proposals.find(p=>p.id===a.proposalId);
  return p?.status==='open'&&w.minute<p.closesAt&&citizen(w,r)&&p.electorate.includes(r.id)&&!Object.hasOwn(p.votes,r.id)&&typeof a.accept==='boolean'?null:'本人没有此议案尚未行使的有效表决权';
 }
 const b=w.civic.budgets.find(b=>b.id===a.budgetId);
 if(!b||b.status!=='active'||b.expiresAt<=w.minute)return '该公共预算已失效';
 if(a.operation==='supply'){
  const item=a.item,price=b.prices[item];
  const limits=b.kind==='repair'?{wood:6,stone:4}:place.kind==='clinic'?{meal:18,water:18}:{turnip:36,water:18};
  const limit=(limits as Inventory)[item]??0,stored=w.civic.stores[place.id]?.[item]??0;
  if(!price||!integer(a.quantity,1,12)||stored+a.quantity>limit||!has(r.inventory,{[item]:a.quantity}))return '交货物品须符合本处采购需求、容量和本人实际库存';
  return accountBalance(w,b.supplyAccount)>=price*a.quantity?null:'采购余额不足';
 }
 if(b.repairWorkerId&&b.repairWorkerId!==r.id)return '已有另一位居民在现场承担这项修缮';
 if(b.kind!=='repair'||r.health<45||r.energy<10)return '当前不能承担这项修缮';
 if(place.condition>=100)return '该公共用房目前不需要修缮';
 if(!has(w.civic.stores[place.id]??{},{wood:6,stone:4}))return '修缮现场尚未备齐 6 木材和 4 石料';
 return accountBalance(w,b.wageAccount)>=b.wage?null:'修缮工资尚未备齐';
}
export function civicTarget(w:World,r:Resident,a:CivicAction):{target:Vec;duration:number;error?:string} {
 const error=civicReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 const place=a.operation==='vote'?w.buildings.find(b=>board(w,b.id)&&local(r,b))!:actionPlace(w,a)!;
 return {target:{...place.door},duration:a.operation==='repair'?120:2};
}
/** First actual arrival claims the single repair assignment; a plan on the road cannot reserve the worksite. */
export function civicWorkError(w:World,r:Resident,a:CivicAction):string|null {
 const error=civicReason(w,r,a);if(error)return error;
 if(a.operation!=='repair')return null;
 const b=w.civic!.budgets.find(b=>b.id===a.budgetId)!,place=w.buildings.find(p=>p.id===b.buildingId)!;
 if(!same(r.at,place.door))return '须实际抵达修缮工地';
 if(!b.repairWorkerId){
  b.repairWorkerId=r.id;
  tell(w,place,`${r.name}实际到达${place.name}，接下已获预算授权的修缮工作；完工才领取 ${b.wage} 钱。`,[r.id]);
 }
 return null;
}
function completeCivicAtomic(w:World,r:Resident,a:CivicAction):string|null {
 const mark=r.activity?.planId?`civic-action:${r.activity.planId}:${r.activity.startedAt}:${a.operation}`:null;
 if(mark&&hasReceipt(w,mark))return null;
 const error=a.operation==='repair'?civicWorkError(w,r,a):civicReason(w,r,a);if(error)return error;
 const place=a.operation==='vote'?w.buildings.find(b=>board(w,b.id)&&same(r.at,b.door))!:actionPlace(w,a)!;
 if(!place||!same(r.at,place.door))return '须亲自完成到场、交货或投票';
 const c=w.civic!;
 const reference=mark??`civic:${w.id}:${c.nextSerial++}`;
 if(a.operation==='donate'){
  if(!moveCoins(w,`resident:${r.id}`,'treasury',a.amount,'自愿公共捐款',reference))return '捐款未能完成';
  c.totals.donations+=a.amount;tell(w,place,`${r.name}自愿将 ${a.amount} 钱交入公共金库；支出仍需居民议案与表决。`,[r.id]);
 }else if(a.operation==='propose'){
  const electorate=w.residents.filter(p=>citizen(w,p)).map(p=>p.id);
  const p:CivicProposal={id:`civic-proposal:${w.id}:${c.nextSerial++}`,proposerId:r.id,buildingId:place.id,createdAt:w.minute,closesAt:w.minute+4*DAY,electorate,votes:{},measure:a.measure.kind==='fixtureRemoval'||a.measure.kind==='salesTax'||a.measure.kind==='construction'||a.measure.kind==='education'||a.measure.kind==='careSupport'||a.measure.kind==='pension'?structuredClone(a.measure):{...structuredClone(a.measure),prices:quotePrices(a.measure)},status:'open',decidedAt:null,budgetId:null};
  c.proposals.push(p);tell(w,place,`${r.name}提出公共议案：${measureLabel(w,a.measure)}。全体登记成年居民各自表决，最迟四日后计票。`,[r.id]);
 }else if(a.operation==='vote'){
  const p=c.proposals.find(p=>p.id===a.proposalId)!;p.votes[r.id]=a.accept;
  tell(w,place,`${r.name}对公共议案投下${a.accept?'赞成':'反对'}票。`,[r.id]);finishProposal(w,p);
 }else{
  const b=c.budgets.find(b=>b.id===a.budgetId)!;
  const stock=c.stores[place.id]??={};
  if(a.operation==='supply'){
   const amount=b.prices[a.item]!*a.quantity;
   if(!moveCoins(w,b.supplyAccount,`resident:${r.id}`,amount,'公共物资采购',reference))return '采购付款未能完成';
   change(r.inventory,{[a.item]:a.quantity},-1);change(stock,{[a.item]:a.quantity},1);change(w.economy!.treasuryStock,{[a.item]:a.quantity},1);
   b.purchased[a.item]=(b.purchased[a.item]??0)+a.quantity;b.spentSupplies+=amount;c.totals.procurement+=amount;
   tell(w,place,`${r.name}按已通过的采购报价，向${place.name}交付 ${a.quantity} 份${itemNames[a.item]}，实际收到 ${amount} 钱。`,[r.id]);
  }else{
   if(!moveCoins(w,b.wageAccount,`resident:${r.id}`,b.wage,'公共修缮工资',reference))return '修缮工资未能支付';
   change(stock,{wood:6,stone:4},-1);change(w.economy!.treasuryStock,{wood:6,stone:4},-1);
   place.condition=Math.min(100,place.condition+30);r.skills.building+=0.03;
   b.paidWages+=b.wage;b.status='completed';delete b.repairWorkerId;c.totals.wages+=b.wage;c.totals.repairs++;
   refund(w,b.supplyAccount,`${b.id}:repair-unused-supplies`);refund(w,b.wageAccount,`${b.id}:repair-unused-wages`);
   tell(w,place,`${r.name}实际完成了${place.name}的修缮，使用公有 6 木材、4 石料，收到 ${b.wage} 钱工资。`,[r.id]);
  }
 }
 if(mark)w.processed.push(mark);
 return null;
}

/** A posted paid shift reserves its entire piecework ceiling before anyone accepts it. */
export function fundPublicShift(w:World,shift:PublicShift):void {
 if(!w.civic||shift.funding||shift.status!=='open'||shift.assignments.length||shift.end<=w.minute)return;
 const b=w.civic.budgets.find(b=>b.kind==='service'&&b.status==='active'&&b.buildingId===shift.buildingId&&b.startsAt<=shift.start&&b.expiresAt>=shift.end);
 if(!b)return;
 const capacity=Math.floor((shift.end-Math.max(shift.start,w.minute))/(shift.role==='care'?30:20));
 const amount=capacity*b.wage;if(amount<=0||accountBalance(w,b.wageAccount)<amount)return;
 const account=`escrow:${shift.id}:wages`;
 if(!moveCoins(w,b.wageAccount,account,amount,'班次工资预留',`${shift.id}:reserve:${b.id}`))return;
 shift.funding={budgetId:b.id,wagePerService:b.wage,wageAccount:account,reserved:amount,paid:0};
}
export function publicServiceCost(shift:PublicShift):Inventory{return shift.role==='care'?{meal:1,water:1}:{turnip:2,water:1};}
export function hasPublicServiceSupplies(w:World,shift:PublicShift):boolean {
 return !!shift.funding&&!!w.civic&&has(w.civic.stores[shift.buildingId]??{},publicServiceCost(shift))&&accountBalance(w,shift.funding.wageAccount)>=shift.funding.wagePerService;
}
/** Wage and materials commit together only after a resident actually receives service. */
export function payPublicService(w:World,shift:PublicShift,worker:Resident):boolean {
 if(!shift.funding||!hasPublicServiceSupplies(w,shift))return false;
 const f=shift.funding,ref=`${shift.id}:service:${shift.served+1}`;
 if(!moveCoins(w,f.wageAccount,`resident:${worker.id}`,f.wagePerService,'公共服务工资',ref))return false;
 change(w.civic!.stores[shift.buildingId],publicServiceCost(shift),-1);change(w.economy!.treasuryStock,publicServiceCost(shift),-1);
 f.paid+=f.wagePerService;w.civic!.totals.wages+=f.wagePerService;
 const b=w.civic!.budgets.find(b=>b.id===f.budgetId);if(b)b.paidWages+=f.wagePerService;
 const assignment=shift.assignments.at(-1);if(assignment)assignment.wagesPaid=(assignment.wagesPaid??0)+f.wagePerService;
 return true;
}
export function closeShiftFunding(w:World,shift:PublicShift):void {
 const f=shift.funding;if(!f||f.closed)return;
 const amount=accountBalance(w,f.wageAccount),b=w.civic?.budgets.find(b=>b.id===f.budgetId);
 if(amount>0)moveCoins(w,f.wageAccount,b?.status==='active'&&b.expiresAt>w.minute?b.wageAccount:'treasury',amount,'未履约班次余薪退回',`${shift.id}:close-wages`);
 f.closed=true;
}

export function completeCivic(w:World,r:Resident,a:CivicAction):string|null{return foodTransaction(w,()=>completeCivicAtomic(w,r,a));}
