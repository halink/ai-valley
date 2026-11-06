import {supportEligible} from '../world/support.js';
import {coLocated} from '../world/proximity.js';
import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {CivicAction,CivicMeasure} from '../shared/civic.js';
import {civicReason,measureLabel} from '../world/civic.js';
import {distance} from '../world/navigation.js';
import {ageYears,DAY} from '../world/time.js';
import {accountBalance} from '../world/economy.js';

const readableItems={turnip:'芜菁',meal:'餐食',water:'清水',wood:'木材',stone:'石料'};
function nearbyBoards(w:World,r:Resident){return w.buildings.filter(b=>b.ownerId==='commons'&&b.condition>=0&&distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id));}
export function civicNotes(w:World,r:Resident):string {
 if(!w.civic||!nearbyBoards(w,r).length)return '';
 const c=w.civic;
 const tax=c.salesTax?c.salesTax.basisPoints/100:0;
 return `你在公开公告板看到，公共金库尚可支出 ${accountBalance(w,'treasury')} 钱；现在货币买卖对买方加收 ${tax}% 销售税。公开议案会张贴到各处公共用房门外。居民需分别同意，投票不影响个人的工作、捐款或交易选择。`;
}
export function civicOpportunities(w:World,r:Resident):FormalOpportunity[] {
 if(w.mode!=='formal'||!w.civic||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<18)return [];
 const places=nearbyBoards(w,r).sort((a,b)=>distance(r.at,a.door)-distance(r.at,b.door));
 const choices:FormalOpportunity[]=[];
 const add=(id:string,label:string,action:CivicAction)=>{if(!civicReason(w,r,action))choices.push({id,label,action});};
 if(!places.length){
  const known=w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&b.ownerId==='commons'&&b.condition>=0).sort((a,b)=>distance(r.at,a.door)-distance(r.at,b.door));
  if(known[0])choices.push({id:`civic.board.${known[0].id}`,label:`去${known[0].name}公告板查看公共议案、收支和采购`,action:{type:'move',to:{...known[0].door}}});
  return choices;
 }
 const place=places[0];
 const proposals=w.civic.proposals.filter(p=>p.status==='open'&&p.closesAt>w.minute&&!Object.hasOwn(p.votes,r.id)&&p.electorate.includes(r.id));
 // Both responses to the same real notice are always included together.
 for(const p of proposals.slice(0,2))for(const accept of [true,false])add(`civic.vote.${p.id}.${accept}`,`${accept?'赞成':'反对'}议案：${measureLabel(w,p.measure)}（${Object.values(p.votes).filter(Boolean).length}赞成/${Object.values(p.votes).filter(v=>!v).length}反对，还可表决${Math.ceil((p.closesAt-w.minute)/DAY)}日）`,{type:'civic',operation:'vote',proposalId:p.id,accept});
 for(const amount of [5,20])add(`civic.donate.${amount}`,`自愿捐 ${amount} 钱给公共金库，具体支出仍由居民议案决定`,{type:'civic',operation:'donate',buildingId:place.id,amount});
 for(const b of w.civic.budgets.filter(b=>b.status==='active'&&places.some(p=>p.id===b.buildingId))){
  const destination=w.buildings.find(p=>p.id===b.buildingId)!;
  const demand=b.kind==='repair'?['wood','stone'] as const:destination.kind==='clinic'?['meal','water'] as const:['turnip','water'] as const;
  for(const item of demand){const quantity=Math.min(3,r.inventory[item]??0);if(quantity<1)continue;
   add(`civic.supply.${b.id}.${item}`,`按已通过的采购报价向${destination.name}交付本人 ${quantity} 份${readableItems[item]}，领 ${quantity*b.prices[item]!} 钱（每份${b.prices[item]}）`,{type:'civic',operation:'supply',budgetId:b.id,item,quantity});
  }
  add(`civic.repair.${b.id}`,`亲自用公共材料修缮${destination.name}，工作120分钟，完工领 ${b.wage} 钱`,{type:'civic',operation:'repair',budgetId:b.id});
 }
 for(const l of w.education?.lessons??[])if(l.buildingId===place.id&&l.status==='scheduled'&&l.fee>0&&!l.funding&&l.end>w.minute){
  const measure:CivicMeasure={kind:'education',buildingId:place.id,lessonId:l.id,amount:l.fee*l.capacity,durationDays:Math.max(1,Math.ceil((l.end-w.minute)/DAY))};
  add('civic.education.'+l.id,`提出具体课堂助学预算：${measureLabel(w,measure)}。可填amount（1–1000）和durationDays（1–28）；报名与到场仍由学生自主决定`,{type:'civic',operation:'propose',buildingId:place.id,measure});
 }
 for(const c of w.longCare?.agreements??[])if(c.status==='offered'&&!c.funding&&(c.knownBy??[]).includes(r.id)&&c.fee>0){const measure:CivicMeasure={kind:'careSupport',buildingId:place.id,agreementId:c.id,amount:c.fee*c.visitsPerDay*(c.endDay-c.startDay),durationDays:c.endDay-c.startDay};add('civic.careSupport.'+c.id,`提出具体照护保障，由居民分别投票：${measureLabel(w,measure)}`,{type:'civic',operation:'propose',buildingId:place.id,measure});}
 for(const p of w.residents.filter(p=>supportEligible(w,p.id)&&(p.id===r.id||r.knownPeople.includes(p.id))&&(ageYears(p.bornAt,w.minute)>=65||coLocated(w,r,p,6))).slice(0,3)){const measure:CivicMeasure={kind:'pension',buildingId:place.id,beneficiaryId:p.id,amountPerDay:3,durationDays:7};add('civic.pension.'+p.id,`提出有限生活保障，由居民分别投票：${measureLabel(w,measure)}。可填amountPerDay 1–20、durationDays 1–28`,{type:'civic',operation:'propose',buildingId:place.id,measure});}
 for(const s of w.industry?.stations.filter(s=>s.buildingId===place.id)??[]){const measure:CivicMeasure={kind:'fixtureRemoval',buildingId:place.id,stationId:s.id,wage:6,durationDays:7};add('civic.fixtureRemoval.'+s.id,`提出具体公共设备处置，居民各自表决：${measureLabel(w,measure)}。可填wage 0–100、durationDays 1–28`,{type:'civic',operation:'propose',buildingId:place.id,measure});}
 const measures:CivicMeasure[]=[];
 for(const p of w.construction?.projects??[])if(p.ownerId==='commons'&&p.boardId===place.id&&!['completed','removed','cancelled'].includes(p.status)&&(p.managerId===r.id||w.civic.proposals.some(proposal=>proposal.measure.kind==='construction'&&proposal.measure.projectId===p.id))){
  if((p.authorizedUntil??0)>w.minute&&p.status!=='paused'&&p.status!=='abandoned')continue;
  const measure:CivicMeasure={kind:'construction',buildingId:place.id,projectId:p.id,amount:Math.min(200,accountBalance(w,'treasury')),durationDays:14};
  add('civic.construction.'+p.id,`提出公共建设用地、负责人和预算议案，居民须分别表决：${measureLabel(w,measure)}。可填amount（0–2000）和durationDays（1–28）决定具体条款；0拨款须另靠自愿资助，不能凭空获得经费`,{type:'civic',operation:'propose',buildingId:place.id,measure});
 }
 if(place.condition>0&&(place.kind==='lodge'||place.kind==='clinic'))for(const wagePerService of [3,6])measures.push({kind:'service',buildingId:place.id,wagePerService,wageBudget:wagePerService*20,suppliesBudget:90,durationDays:7});
 if(place.condition<100)measures.push({kind:'repair',buildingId:place.id,wage:15,suppliesBudget:20,durationDays:7});
 const tax=w.civic.salesTax?.basisPoints??0;
 if(tax===0)measures.push({kind:'salesTax',basisPoints:500,durationDays:14});
 else {measures.push({kind:'salesTax',basisPoints:0,durationDays:14});if(tax<1000)measures.push({kind:'salesTax',basisPoints:1000,durationDays:14});else measures.push({kind:'salesTax',basisPoints:500,durationDays:14});}
 for(const [index,measure]of measures.entries())add(`civic.propose.${index}`,`提出议案，由所有成年居民分别投票：${measureLabel(w,measure)}。可另填${measure.kind==='salesTax'?'basisPoints（0–1500）':measure.kind==='service'?'wagePerService（1–20）、wageBudget（单次工资至1000）、suppliesBudget（0–1000）、prices（物品每份1–100）':'wage（1–100）、suppliesBudget（0–1000）、prices（wood/stone每份1–100）'}和durationDays（1–28）自行修改条款；未填沿用上述报价`,{type:'civic',operation:'propose',buildingId:place.id,measure});
 return choices;
}

export function civicChoiceFields(a:CivicAction):string[] {
 if(a.operation==='donate')return ['amount'];
 if(a.operation==='supply')return ['quantity'];
 if(a.operation!=='propose')return [];
 if(a.measure.kind==='fixtureRemoval')return ['wage','durationDays'];
 if(a.measure.kind==='careSupport')return [];
 if(a.measure.kind==='pension')return ['amountPerDay','durationDays'];
 if(a.measure.kind==='salesTax')return ['basisPoints','durationDays'];
 if(a.measure.kind==='construction'||a.measure.kind==='education')return ['amount','durationDays'];
 return a.measure.kind==='service'?['wagePerService','wageBudget','suppliesBudget','durationDays','prices']:['wage','suppliesBudget','durationDays','prices'];
}
/** Only an individual's proposed contract can change; a vote never edits somebody else's terms. */
export function parseCivicChoice(action:CivicAction,data:Record<string,unknown>):CivicAction {
 const a=structuredClone(action);
 for(const key of civicChoiceFields(action)){
  const value=data[key];if(value===undefined)continue;
  if(key==='prices'){
   if(a.operation!=='propose'||a.measure.kind==='fixtureRemoval'||a.measure.kind==='salesTax'||a.measure.kind==='construction'||a.measure.kind==='education'||a.measure.kind==='careSupport'||a.measure.kind==='pension'||!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_civic_prices');
   const allowed=a.measure.kind==='repair'?['wood','stone']:['turnip','meal','water'];
   if(Object.entries(value).some(([item,n])=>!allowed.includes(item)||typeof n!=='number'||!Number.isSafeInteger(n)||n<1||n>100))throw new Error('invalid_civic_prices');
   a.measure.prices={...a.measure.prices,...value};continue;
  }
  const min=['basisPoints','suppliesBudget'].includes(key)||a.operation==='propose'&&a.measure.kind==='fixtureRemoval'&&key==='wage'||a.operation==='propose'&&a.measure.kind==='construction'&&key==='amount'?0:1;
  const max=key==='amountPerDay'?20:a.operation==='propose'&&a.measure.kind==='construction'&&key==='amount'?2000:key==='durationDays'?28:key==='basisPoints'?1500:key==='wagePerService'?20:key==='wage'?100:key==='quantity'?12:1000;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new Error('invalid_civic_amount');
  if(a.operation==='donate'&&key==='amount')a.amount=value;
  else if(a.operation==='supply'&&key==='quantity')a.quantity=value;
  else if(a.operation==='propose'){
   if(key==='durationDays')a.measure.durationDays=value;
   else if((a.measure.kind==='construction'||a.measure.kind==='education')&&key==='amount')a.measure.amount=value;
   else if(a.measure.kind==='pension'&&key==='amountPerDay')a.measure.amountPerDay=value;
   else if(a.measure.kind==='salesTax'&&key==='basisPoints')a.measure.basisPoints=value;
   else if(a.measure.kind==='service'&&key==='wagePerService')a.measure.wagePerService=value;
   else if(a.measure.kind==='service'&&key==='wageBudget')a.measure.wageBudget=value;
   else if((a.measure.kind==='repair'||a.measure.kind==='fixtureRemoval')&&key==='wage')a.measure.wage=value;
   else if((a.measure.kind==='service'||a.measure.kind==='repair')&&key==='suppliesBudget')a.measure.suppliesBudget=value;
  }
 }
 if(a.operation==='propose'&&a.measure.kind==='service'&&a.measure.wageBudget<a.measure.wagePerService)throw new Error('invalid_civic_wage_cap');
 return a;
}
