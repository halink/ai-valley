import type {Building,FormalOpportunity,Resident,World} from '../shared/types.js';import type {DebtAction,PersonalLoan} from '../shared/debt.js';import {ageYears,DAY} from './time.js';import {accountBalance,initializeEconomy,moveCoins} from './economy.js';import {coLocated} from './proximity.js';import {distance,same} from './navigation.js';import {deathProof} from './knowledge.js';import {pendingEstateReturns} from './estate-pending.js';import {emitEvent} from './events.js';
const person=(w:World,id?:string)=>w.residents.find(p=>p.id===id);
const adult=(w:World,r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const integer=(n:unknown,a:number,b:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=a&&n<=b;
const loan=(w:World,id?:string)=>w.debt?.loans.find(c=>c.id===id);
const recipient=(w:World,id:string)=>person(w,id)?.status==='dead'?`estate:${id}`:`resident:${id}`;
const outstanding=(c:PersonalLoan)=>Math.max(0,c.repayment-c.repaid-c.forgiven-c.writtenOff);
const live=(c:PersonalLoan)=>['active','overdue'].includes(c.status);
function registry(w:World,r:Resident,id?:string):Building|undefined {return w.buildings.find(b=>(!id||b.id===id)&&b.ownerId==='commons'&&b.kind==='lodge'&&b.condition>0&&r.knownBuildings.includes(b.id));}
function near(r:Resident,b:Building){return (!r.inside||r.inside===b.id)&&distance(r.at,b.door)<=8;}
function pay(w:World,from:string,to:string,n:number,reason:string,ref:string){if(n>0&&!moveCoins(w,from,to,n,reason,ref))throw new Error('debt_transfer_failed:'+reason);}
export function initializeDebt(w:World){if(w.mode!=='formal')return;initializeEconomy(w);w.debt??={loans:[],nextSerial:1,totals:{principal:0,repaid:0,collected:0,forgiven:0,writtenOff:0}};w.definitions['economy/loan@1']??={id:'economy/loan',version:1,kind:'action',dependencies:[],data:{principalMax:500,repaymentMax:1000,maxDays:28,compound:false,automaticRepayment:false,deathRecourse:'无抵押，逝后仅限完成已有退款与预付款清算时的净现金遗产，按全部同类债权比例清偿；地权、房产及未到期债权等非现金权利不自动处置，余欠终结，不转嫁孩子或继承人。'}};}
export function debtReason(w:World,r:Resident,a:DebtAction):string|null {
 if(!w.debt||!adult(w,r))return '本人目前不能签署或清算借贷';
 if(a.operation==='lend'){
  const p=person(w,a.targetId),b=registry(w,r,a.buildingId);if(!adult(w,p)||p.id===r.id||!r.knownPeople.includes(p.id)||!coLocated(w,r,p,2)||!b||!near(r,b)||!near(p,b))return '双方须相识、成年、有能力，并实际在同一公共登记处附近';
  if(!integer(a.principal,1,500)||!integer(a.repayment,a.principal,1000)||!integer(a.days,1,28)||r.coins<a.principal)return '本人须有真实本金1–500钱，固定偿还总额不低于本金且不超过1000钱，期限1–28日';
  return w.debt.loans.filter(c=>c.ownerId===r.id&&c.status==='offered').length>=4?'请先处理本人四项未被接受的借款提议':null;
 }
 if(a.operation==='settleEstate'){
  const p=person(w,a.targetId),b=registry(w,r,a.buildingId),estate=w.estates.find(e=>e.personId===p?.id);if(!p||!estate||estate.status!=='protected'||!deathProof(w,r,p.id)||!b||!near(r,b)||!w.debt.loans.some(c=>c.borrowerId===p.id&&live(c)))return '需要本人已经获知的有效死亡证据、未清偿的具体债务和实际公共登记处';
  if(w.production?.inheritances[p.id])return '已经形成的遗产分配不能被后来一项请求追溯重分';
  if(w.debt.loans.some(c=>c.originalLenderId===p.id&&c.status==='offered'))return '逝者尚未被接受的借款预存款须先退回';
  return pendingEstateReturns(w,p.id);
 }
 const c=loan(w,a.loanId);if(!c)return '没有这项实际借贷文书';
 if(a.operation==='respond')return c.status==='offered'&&c.borrowerId===r.id&&c.expiresAt>w.minute&&typeof a.accept==='boolean'&&(!a.accept||adult(w,person(w,c.ownerId))&&coLocated(w,r,person(w,c.ownerId)!,2))?null:'没有交给本人且仍然有效、双方实际在场的借款提议';
 if(a.operation==='withdraw')return c.status==='offered'&&c.ownerId===r.id?null:'只能撤回本人尚未被接受的借款提议';
 if(![c.ownerId,c.borrowerId].includes(r.id))return '这份借贷权利或义务不属于本人';
 if(a.operation==='repay')return c.borrowerId===r.id&&live(c)&&integer(a.amount,1,outstanding(c))&&r.coins>=a.amount?null:'本人须有未偿债务与真实自有钱款，不能超额还款';
 if(a.operation==='collect')return c.ownerId===r.id&&accountBalance(w,c.repaymentAccount)>0?null:'本人尚无可以实际领取的已付借款';
 if(a.operation==='forgive')return c.ownerId===r.id&&live(c)&&integer(a.amount,1,outstanding(c))?null:'本人只能明确减免自己尚未获得清偿的债权';
 return '没有这项借贷安排';
}
export function debtTarget(w:World,r:Resident,a:DebtAction){const error=debtReason(w,r,a);if(error)return {target:r.at,duration:0,error};const c=loan(w,a.loanId),b=registry(w,r,a.buildingId??c?.buildingId);return b?{target:{...b.door},duration:a.operation==='settleEstate'?30:5}:{target:r.at,duration:0,error:'合同登记处暂不可用，须先恢复实际服务'};}
function annotate(w:World,c:PersonalLoan,r:Resident,text:string){const e=emitEvent(w,{kind:'trade',actors:[r.id],place:{...r.at},text});c.events.push(e.id);}
function closeOffer(w:World,c:PersonalLoan,status:'declined'|'withdrawn'|'expired'){pay(w,c.principalAccount,recipient(w,c.originalLenderId),accountBalance(w,c.principalAccount),'未被接受的借款本金退回',c.id+':offer-return');c.status=status;}
export function completeDebt(w:World,r:Resident,a:DebtAction):string|null {
 const error=debtReason(w,r,a);if(error)return error;const s=w.debt!,c=loan(w,a.loanId),b=registry(w,r,a.buildingId??c?.buildingId);if(!b||r.inside||!same(r.at,b.door))return '须本人实际到达约定的公共登记处办理';
 if(a.operation==='lend'){
  const id='loan:'+s.nextSerial++,account='escrow:'+id+':principal';pay(w,`resident:${r.id}`,account,a.principal!,'本人自愿预存借款本金',id+':reserve');
  const n:PersonalLoan={id,definition:'economy/loan@1',originalLenderId:r.id,ownerId:r.id,borrowerId:a.targetId!,buildingId:b.id,principal:a.principal!,repayment:a.repayment!,days:a.days!,offeredAt:w.minute,expiresAt:w.minute+2*DAY,acceptedAt:null,dueAt:null,status:'offered',principalAccount:account,repaymentAccount:'escrow:'+id+':repayment',repaid:0,collected:0,forgiven:0,writtenOff:0,settledAt:null,events:[]};s.loans.push(n);const borrower=person(w,n.borrowerId)!;if(!borrower.knownBuildings.includes(b.id))borrower.knownBuildings.push(b.id);annotate(w,n,r,`${r.name}在公共登记处自愿预存${n.principal}钱，提出借给${person(w,n.borrowerId)!.name}；若对方接受，${n.days}日后固定偿还${n.repayment}钱，无复利、无自动扣款。逝后仅依已声明的净现金遗产限额规则清偿，不自动处分房地或追索孩子。对方尚未接受。`);
 }else if(a.operation==='respond'){
  if(!a.accept)closeOffer(w,c!,'declined');else {pay(w,c!.principalAccount,`resident:${r.id}`,c!.principal,'本人接受借款实际收到本金',c!.id+':accept');c!.acceptedAt=w.minute;c!.dueAt=w.minute+c!.days*DAY;c!.status='active';s.totals.principal+=c!.principal;}
  annotate(w,c!,r,`${r.name}亲自${a.accept?'接受':'拒绝'}了已登记的借款条件${a.accept?'，实际收到本金'+c!.principal+'钱，固定应还'+c!.repayment+'钱，期限'+c!.days+'日；不自动续期或累计复利':''}。`);
 }else if(a.operation==='withdraw'){closeOffer(w,c!,'withdrawn');annotate(w,c!,r,`${r.name}撤回了尚未被接受的借款提议，剩余本金原路退回。`);}
 else if(a.operation==='repay'){
  pay(w,`resident:${r.id}`,c!.repaymentAccount,a.amount!,'本人自主实际偿还借款',c!.id+':repay:'+(c!.repaid+a.amount!));c!.repaid+=a.amount!;s.totals.repaid+=a.amount!;if(!outstanding(c!))c!.status='paid';annotate(w,c!,r,`${r.name}在登记处实际偿还${a.amount}钱，尚欠${outstanding(c!)}钱；已付款保存在该债权的独立账户，权利人仍须实际领取。`);
 }else if(a.operation==='collect'){
  const n=accountBalance(w,c!.repaymentAccount);pay(w,c!.repaymentAccount,`resident:${r.id}`,n,'本人领取已偿还债权',c!.id+':collect:'+(c!.collected+n));c!.collected+=n;s.totals.collected+=n;annotate(w,c!,r,`${r.name}亲自领取了自己债权中实际已付的${n}钱，不重复取得借款收入。`);
 }else if(a.operation==='forgive'){c!.forgiven+=a.amount!;s.totals.forgiven+=a.amount!;if(!outstanding(c!))c!.status='forgiven';annotate(w,c!,r,`${r.name}自愿减免本人债权${a.amount}钱，尚欠${outstanding(c!)}钱，已经偿还的实款归属不变。`);}
 else {
  const id=a.targetId!,estate=w.estates.find(e=>e.personId===id)!;
  // Held repayments already belonging to the deceased are cash, not an heir's private pocket.
  for(const claim of s.loans.filter(l=>l.ownerId===id)){const n=accountBalance(w,claim.repaymentAccount);pay(w,claim.repaymentAccount,`estate:${id}`,n,'已付债权现金保全进入遗产',claim.id+':estate-cash:'+id+':'+claim.repaid);claim.collected+=n;s.totals.collected+=n;}
  const debts=s.loans.filter(l=>l.borrowerId===id&&live(l)).sort((a,b)=>a.id.localeCompare(b.id)),total=debts.reduce((sum,l)=>sum+outstanding(l),0),budget=Math.min(estate.coins,total);
  const shares=debts.map(l=>({loan:l,pay:Math.floor(budget*outstanding(l)/total)}));let remainder=budget-shares.reduce((sum,l)=>sum+l.pay,0);for(const item of shares)if(remainder&&item.pay<outstanding(item.loan)){item.pay++;remainder--;}
  for(const item of shares){const l=item.loan;pay(w,`estate:${id}`,l.repaymentAccount,item.pay,'逝者净现金遗产依约清偿借款',l.id+':estate-settlement');l.repaid+=item.pay;s.totals.repaid+=item.pay;const loss=outstanding(l);l.writtenOff+=loss;s.totals.writtenOff+=loss;l.status='estateSettled';l.settledAt=w.minute;annotate(w,l,r,`${r.name}依据已核实的死亡与登记借款，实际从${person(w,id)!.name}的净现金遗产清偿${item.pay}钱，本份余欠${loss}钱依原有限追索条款终结。未处分房地、他人财物或孩子的独立财产，也没有新增孩子债务。`);}
 }r.revision++;return null;
}
export function advanceDebt(w:World){initializeDebt(w);for(const c of w.debt?.loans??[]){if(c.status==='offered'&&(c.expiresAt<=w.minute||person(w,c.originalLenderId)?.status==='dead'||person(w,c.borrowerId)?.status==='dead'))closeOffer(w,c,'expired');if(c.status==='active'&&c.dueAt!<=w.minute)c.status='overdue';}}
export function hasEstateDebt(w:World,id:string){return !!w.debt?.loans.some(c=>c.borrowerId===id&&live(c)||c.originalLenderId===id&&c.status==='offered');}
export function debtClaims(w:World,id:string){return w.debt?.loans.filter(c=>c.ownerId===id&&(live(c)||accountBalance(w,c.repaymentAccount)>0)).map(c=>c.id)??[];}
export function inheritDebtClaims(w:World,from:string,to:string,ids:string[]){for(const c of w.debt?.loans??[])if(c.ownerId===from&&ids.includes(c.id)){c.ownerId=to;const heir=person(w,to);if(heir&&!heir.knownBuildings.includes(c.buildingId))heir.knownBuildings.push(c.buildingId);if(to===c.borrowerId&&live(c)){const n=outstanding(c);c.forgiven+=n;w.debt!.totals.forgiven+=n;c.status='forgiven';}}}
export function debtOpportunities(w:World,r:Resident):FormalOpportunity[]{const result:FormalOpportunity[]=[],add=(id:string,label:string,a:DebtAction)=>{if(!debtReason(w,r,a))result.push({id:'debt.'+id,label,action:a});};if(!w.debt)return result;
 for(const b of w.buildings.filter(b=>b.ownerId==='commons'&&b.kind==='lodge'&&r.knownBuildings.includes(b.id)&&near(r,b))){for(const p of w.residents.filter(p=>coLocated(w,r,p,2)))add('lend.'+p.id+'.'+b.id,`向${p.name}提出本人出资的固定借款：填写principal本金1–500、repayment固定偿还总额（不少于本金、最多1000）、days 1–28。须对方独立接受；无复利、不自动扣款。死亡仅依净现金遗产有限追索，不自动处置房地或追索孩子`,{type:'debt',operation:'lend',targetId:p.id,buildingId:b.id,principal:1,repayment:1,days:7});
  for(const p of w.residents.filter(p=>!!deathProof(w,r,p.id)))add('estate.'+p.id+'.'+b.id,`依据已知证据亲自在${b.name}清算${p.name}已登记的有限现金借款；先结清客户款项和既有退款，余欠不由孩子承担`,{type:'debt',operation:'settleEstate',targetId:p.id,buildingId:b.id});}
 for(const c of w.debt.loans.filter(c=>[c.ownerId,c.borrowerId].includes(r.id))){
  for(const accept of [true,false])add('respond.'+c.id+'.'+accept,`${accept?'本人接受':'本人拒绝'}${person(w,c.originalLenderId)?.name}登记的借款：实收${c.principal}钱，${c.days}日后固定还${c.repayment}钱，死亡仅限原条款的净现金遗产追索，不将余欠转给孩子`,{type:'debt',operation:'respond',loanId:c.id,accept});
  add('withdraw.'+c.id,'撤回本人尚未被接受的借款提议，本金退回',{type:'debt',operation:'withdraw',loanId:c.id});
  add('repay.'+c.id,`亲自去登记处偿还本人借款，填写amount（1–${Math.min(outstanding(c),r.coins)}），固定剩余${outstanding(c)}钱，已偿${c.repaid}钱${c.status==='overdue'?'，已经逾期但不会自动复利或强迫工作':''}`,{type:'debt',operation:'repay',loanId:c.id,amount:1});
  add('collect.'+c.id,`亲自领取本人债权实际已付款${accountBalance(w,c.repaymentAccount)}钱，包括合法继承的债权`,{type:'debt',operation:'collect',loanId:c.id});
  add('forgive.'+c.id,`本人自愿减免这份债权，填写amount（1–${outstanding(c)}）；只处分本人的债权，不替他人放弃钱款`,{type:'debt',operation:'forgive',loanId:c.id,amount:1});
 }return result;
}
