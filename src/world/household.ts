import {routeFood} from './food-routes.js';
import {estateStock,estateLocation} from './estate-custody.js';
import type {FormalOpportunity,Inventory,Item,Resident,World} from '../shared/types.js';import type {HouseholdAction,HouseholdCredit,HouseholdGift,HouseholdPool} from '../shared/household.js';import {itemKeys,itemLabels} from '../shared/items.js';import {ageYears,DAY} from './time.js';import {coLocated} from './proximity.js';import {distance,same} from './navigation.js';import {accountBalance,initializeEconomy,moveCoins} from './economy.js';import {foodTransaction} from './food.js';import {deathProof} from './knowledge.js';import {emitEvent} from './events.js';
const person=(w:World,id?:string)=>w.residents.find(p=>p.id===id),integer=(n:unknown,a:number,b:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=a&&n<=b;
const adult=(w:World,r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const pool=(w:World,id?:string)=>w.household?.pools.find(p=>p.id===id),gift=(w:World,id?:string)=>w.household?.gifts.find(p=>p.id===id);
const credit=(p:HouseholdPool,id:string)=>p.credits.find(c=>c.ownerId===id);
const participants=(p:HouseholdPool)=>[p.creatorId,p.partnerId];
const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([i,n])=>(bag[i as Item]??0)>=n!);
function change(bag:Inventory,value:Inventory,sign:number){for(const [i,n] of Object.entries(value))bag[i as Item]=(bag[i as Item]??0)+n!*sign;}
const stock=(a:HouseholdAction):Inventory=>a.item&&a.quantity?{[a.item]:a.quantity}:{};
const nonempty=(c:HouseholdCredit)=>c.coins>0||Object.values(c.inventory).some(n=>n!>0);
function terms(a:HouseholdAction){return integer(a.amount,0,200)&&integer(a.quantity,0,20)&&(a.quantity===0||!!a.item&&itemKeys.includes(a.item))&&(a.amount>0||a.quantity>0);}
function pay(w:World,from:string,to:string,n:number,reason:string,ref:string){if(n>0&&!moveCoins(w,from,to,n,reason,ref))throw new Error('household_transfer_failed:'+reason);}
function eligibleHome(w:World,r:Resident,id?:string){return w.buildings.find(b=>b.id===id&&r.knownBuildings.includes(b.id)&&b.condition>0&&['home','lodge'].includes(b.kind)&&(b.ownerId===r.id||b.ownerId==='commons')&&b.residents.includes(r.id));}
function nearby(r:Resident,p:HouseholdPool){return !r.inside&&distance(r.at,p.at)<=8;}
export function initializeHousehold(w:World){if(w.mode!=='formal')return;initializeEconomy(w);w.household??={pools:[],gifts:[],nextSerial:1,totals:{deposited:0,withdrawn:0,gifted:0,estateCoins:0}};w.definitions['family/shared@1']??={id:'family/shared',version:1,kind:'action',dependencies:[],data:{initial:'双方分别接受相同数额的初始出资；以后各自出资分别记份额',physical:'原住处门外实际共用储物处，每人实际库存独立标记',withdraw:'只能取自己的份额；共同赠与须两人及接收者分别接受',separate:'任一人可以结束共用安排，不自动结束婚姻、搬家或清除亲缘',death:'个人份额保全，其他人无权私取；须有真实死亡证据并到原处办理遗产保全'}};}
function giftFits(p:HouseholdPool,g:Pick<HouseholdGift,'costs'>){return g.costs.every(cost=>{const own=credit(p,cost.ownerId);return own&&own.coins>=cost.coins&&has(own.inventory,cost.inventory);});}
function giftCosts(p:HouseholdPool,id:string,amount:number,item:Item|undefined,quantity:number,percent:number){const own=Math.ceil(amount*percent/100),ownQuantity=Math.ceil(quantity*percent/100),other=participants(p).find(person=>person!==id)!;return [id,other].map((ownerId,i)=>({ownerId,coins:i?amount-own:own,inventory:item?{[item]:i?quantity-ownQuantity:ownQuantity}:{}}));}
export function householdReason(w:World,r:Resident,a:HouseholdAction):string|null {
 if(!w.household||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return '本人目前不能处理共同生活资料';
 if(a.operation==='create'){
  const other=person(w,a.targetId),b=eligibleHome(w,r,a.buildingId);if(!adult(w,r)||!adult(w,other)||r.id===other.id||!r.knownPeople.includes(other.id)||!coLocated(w,r,other,2)||!b||!b.residents.includes(other.id)||distance(r.at,b.door)>8)return '双方须实际同住、相识并分别有能力决定，创建人须有本处使用权';
  if(!terms(a)||r.coins<a.amount!||!has(r.inventory,stock(a))||!a.name?.trim()||a.name.length>30)return '需要本人真实初始出资、物资及1–30字名称';
  return w.household.pools.some(p=>participants(p).includes(r.id)&&participants(p).includes(other.id)&&['offered','open'].includes(p.status))?'双方已有一份尚未结束的共用安排':null;
 }
 const g=gift(w,a.giftId),p=pool(w,a.poolId??g?.poolId);if(!p)return '没有这份实际共同账户与储物安排';
 if(a.operation==='respond')return adult(w,r)&&p.partnerId===r.id&&p.status==='offered'&&p.expiresAt>w.minute&&typeof a.accept==='boolean'&&(!a.accept||adult(w,person(w,p.creatorId))&&coLocated(w,r,person(w,p.creatorId)!,2)&&r.coins>=p.initial.coins&&has(r.inventory,p.initial.item?{[p.initial.item]:p.initial.quantity}:{})&&has(credit(p,p.creatorId)!.inventory,p.initial.item?{[p.initial.item]:p.initial.quantity}:{}))?null:'没有本人可接受的同住出资条件，或原实物与本人匹配出资已不足';
 if(a.operation==='protectEstate')return adult(w,r)&&!!a.ownerId&&person(w,a.ownerId)?.status==='dead'&&!!deathProof(w,r,a.ownerId)&&!!credit(p,a.ownerId)&&nonempty(credit(p,a.ownerId)!)&&!w.household.gifts.some(g=>g.poolId===p.id&&g.status==='ready'&&g.segments.some(c=>c.ownerId===a.ownerId))?null:'须有本人已核实的死亡证据、确有保全份额，且先退回尚未交付的赠与预留';
 if(a.operation==='acceptGift'||a.operation==='declineGift')return g?.status==='ready'&&g.expiresAt>w.minute&&g.recipientId===r.id&&(nearby(r,p)||g.knownBy.includes(r.id))?null:'没有等待本人独立接受的共同赠与';
 if(!adult(w,r)||!participants(p).includes(r.id))return '本人不是这份共同生活安排的出资当事人';
 const own=credit(p,r.id);
 if(a.operation==='close')return p.status==='open'?null:'这份共用安排当前无需结束';
 if(a.operation==='deposit')return p.status==='open'&&terms(a)&&r.coins>=a.amount!&&has(r.inventory,stock(a))?null:'需要有效的共用安排与本人实际出资，不能动用他人的份额';
 if(a.operation==='withdraw')return own&&terms(a)&&own.coins>=a.amount!&&has(own.inventory,stock(a))?null:'只可领取本人已登记且实际仍存在的份额';
 if(a.operation==='proposeGift'){
  const to=person(w,a.targetId);if(p.status!=='open'||!to||to.status!=='alive'||to.residency==='outside'||!to.canDecide||!to.canExpress||!r.knownPeople.includes(to.id)||!terms(a)||!integer(a.ownPercent,0,100))return '需要开放的共用安排、本人认识且能独立接受的接收者，以及有限数额';
  if(w.household.gifts.filter(g=>g.poolId===p.id&&['proposed','ready'].includes(g.status)).length>=3)return '本处已有三项未完成的共同赠与';return giftFits(p,{costs:giftCosts(p,r.id,a.amount!,a.item,a.quantity!,a.ownPercent!)})?null:'双方分别持有的份额不能支持所提数额与比例';
 }
 if(!g||g.poolId!==p.id||g.expiresAt<=w.minute||!g.knownBy.includes(r.id)&&!nearby(r,p))return '没有仍然有效的共同赠与提议';
 if(a.operation==='notifyGift')return g.status==='ready'&&!!person(w,g.recipientId)&&coLocated(w,r,person(w,g.recipientId)!,2)&&!g.knownBy.includes(g.recipientId)?null:'需要本人掌握的有效赠与，并亲自向身边的接收者送达消息';
 if(a.operation==='cancelGift')return ['proposed','ready'].includes(g.status)?null:'这份赠与已经交付或结束';
 if(a.operation==='approveGift')return p.status==='open'&&g.status==='proposed'&&g.approverId===r.id&&adult(w,person(w,g.proposerId))&&coLocated(w,r,person(w,g.proposerId)!,2)&&giftFits(p,g)?null:'需要另一位出资人独立到场同意，且两人的原份额仍然足额';
 return '没有这项共同生活事务';
}
export function householdTarget(w:World,r:Resident,a:HouseholdAction){const error=householdReason(w,r,a);if(error)return {target:r.at,duration:0,error};const p=pool(w,a.poolId??gift(w,a.giftId)?.poolId),b=a.operation==='create'?eligibleHome(w,r,a.buildingId):null;return {target:{...(a.operation==='notifyGift'?r.at:p?.at??b!.door)},duration:a.operation==='protectEstate'?20:5};}
function fact(w:World,r:Resident,text:string){emitEvent(w,{kind:'trade',actors:[r.id],place:{...r.at},text});}
function cancelGift(w:World,g:HouseholdGift,status:'cancelled'|'declined'|'expired'){
 const p=pool(w,g.poolId)!;if(g.status==='ready')for(const segment of g.segments){const own=credit(p,segment.ownerId)!;pay(w,g.account,p.account,segment.coins,'共同赠与未交付的原份额退回',g.id+':return:'+segment.ownerId);own.coins+=segment.coins;segment.coins=0;routeFood(w,'family-gift:'+g.id+':'+segment.ownerId,'family-stock:'+p.id+':'+segment.ownerId,segment.inventory);change(own.inventory,segment.inventory,1);segment.inventory={};}g.status=status;
}
function completeAtomic(w:World,r:Resident,a:HouseholdAction):string|null {
 const error=householdReason(w,r,a);if(error)return error;const s=w.household!,g=gift(w,a.giftId),p=pool(w,a.poolId??g?.poolId),target=a.operation==='notifyGift'?r.at:a.operation==='create'?eligibleHome(w,r,a.buildingId)!.door:p!.at;if(a.operation!=='notifyGift'&&(r.inside||!same(r.at,target)))return '须本人实际到达原住处门外的共用储物处，不能远程取走实物';
 const ref=`household:${r.activity?.planId??r.id+':'+r.revision}:${r.activity?.startedAt??w.minute}:${a.operation}`;
 if(a.operation==='create'){
  const b=eligibleHome(w,r,a.buildingId)!,id='family-pool:'+s.nextSerial++,account='escrow:'+id;pay(w,`resident:${r.id}`,account,a.amount!,'本人提出共用生活资金预存',id+':initial');const inventory=stock(a);change(r.inventory,inventory,-1);
  s.pools.push({id,definition:'family/shared@1',name:a.name!.trim(),creatorId:r.id,partnerId:a.targetId!,buildingId:b.id,at:{...b.door},account,initial:{coins:a.amount!,item:a.item,quantity:a.quantity!},credits:[{ownerId:r.id,coins:a.amount!,inventory}],status:'offered',createdAt:w.minute,expiresAt:w.minute+2*DAY,acceptedAt:null,closedAt:null,reason:null});s.totals.deposited+=a.amount!;
  fact(w,r,`${r.name}实际在${b.name}门外预存自己的${a.amount}钱及具体物资，邀请${person(w,a.targetId)!.name}按相同初始数额建立${a.name}。此后各人份额分别记账，共同赠与需两人另行同意；不合并婚姻、房屋产权或儿童财产。`);
 }else if(a.operation==='respond'){
  if(a.accept){const inventory=p!.initial.item?{[p!.initial.item]:p!.initial.quantity}:{};pay(w,`resident:${r.id}`,p!.account,p!.initial.coins,'本人接受共用生活初始出资',p!.id+':accept');change(r.inventory,inventory,-1);p!.credits.push({ownerId:r.id,coins:p!.initial.coins,inventory});p!.status='open';p!.acceptedAt=w.minute;s.totals.deposited+=p!.initial.coins;}else {p!.status='declined';p!.closedAt=w.minute;p!.reason='对方独立拒绝，原出资仍在原处等待本人领取';}
  fact(w,r,`${r.name}亲自${a.accept?'接受并实际提供自己的匹配初始份额':'拒绝'}了${p!.name}的共用安排，房屋产权与婚姻仍分别处理。`);
 }else if(a.operation==='deposit'||a.operation==='withdraw'){
  const own=credit(p!,r.id)!,deposit=a.operation==='deposit',amount=a.amount!,inventory=stock(a);if(!deposit&&p!.status==='offered'){p!.status='closed';p!.closedAt=w.minute;p!.reason='创建人取回预存，原邀请已撤回';}
  pay(w,deposit?`resident:${r.id}`:p!.account,deposit?p!.account:`resident:${r.id}`,amount,deposit?'本人向共用储物处追加独立份额':'本人实际领取共用储物处的个人份额',ref);own.coins+=deposit?amount:-amount;change(deposit?r.inventory:own.inventory,inventory,-1);change(deposit?own.inventory:r.inventory,inventory,1);s.totals[deposit?'deposited':'withdrawn']+=amount;
  fact(w,r,`${r.name}亲自${deposit?'存入':'领取'}本人${amount}钱及具体物资，另一人的独立份额未被动用。`);
 }else if(a.operation==='close'){
  for(const offer of s.gifts.filter(g=>g.poolId===p!.id&&['proposed','ready'].includes(g.status)))cancelGift(w,offer,'cancelled');p!.status='closed';p!.closedAt=w.minute;p!.reason='一位当事人自主结束共用安排，个人份额留在原处待取';fact(w,r,`${r.name}自主结束${p!.name}的共用安排，双方剩余份额原地分别保全；不因此驱逐住户、自动结束婚姻或清除孩子亲缘。`);
 }else if(a.operation==='proposeGift'){
  const other=participants(p!).find(id=>id!==r.id)!,id='family-gift:'+s.nextSerial++,coins=a.amount!,quantity=a.quantity!,costs=giftCosts(p!,r.id,coins,a.item,quantity,a.ownPercent!);
  const offer:HouseholdGift={id,definition:p!.definition,poolId:p!.id,knownBy:[r.id,...(adult(w,person(w,other))&&coLocated(w,r,person(w,other)!,6)?[other]:[])],proposerId:r.id,approverId:other,recipientId:a.targetId!,ownPercent:a.ownPercent!,amount:coins,item:a.item,quantity,costs,segments:[],account:'escrow:'+id,status:'proposed',createdAt:w.minute,expiresAt:w.minute+2*DAY,approvedAt:null,deliveredAt:null};if(!giftFits(p!,offer))return '双方各自份额不能支持这项共同赠与，尚未扣取任何份额';s.gifts.push(offer);fact(w,r,`${r.name}提出从双方分别持有的份额中共同赠给${person(w,a.targetId)!.name}${coins}钱及${quantity}份${a.item?itemLabels[a.item]:'物资'}，本人愿出${a.ownPercent}%（零头向本人取整），另一人出余数。等待另一人及接收者独立同意。`);
 }else if(a.operation==='approveGift'){
  for(const cost of g!.costs){const own=credit(p!,cost.ownerId)!;pay(w,p!.account,g!.account,cost.coins,'两位出资人分别接受的共同赠与预存',g!.id+':reserve:'+cost.ownerId);own.coins-=cost.coins;routeFood(w,'family-stock:'+p!.id+':'+cost.ownerId,'family-gift:'+g!.id+':'+cost.ownerId,cost.inventory);change(own.inventory,cost.inventory,-1);g!.segments.push(structuredClone(cost));}g!.status='ready';g!.approvedAt=w.minute;if(!g!.knownBy.includes(r.id))g!.knownBy.push(r.id);fact(w,r,`${r.name}亲自同意了这份具体共同赠与，双方实际份额已分别预留；接收者仍可拒绝，尚未收货。`);
 }else if(a.operation==='notifyGift'){g!.knownBy.push(g!.recipientId);const to=person(w,g!.recipientId)!;const e=emitEvent(w,{kind:'trade',actors:[r.id,to.id],place:{...r.at},witnesses:[r.id,to.id],text:`${r.name}亲自向${to.name}送达已被双方同意的共同赠与消息与原储物处地址；接收者仍可拒绝或自行前往领取。`});const memory=to.memories.find(m=>m.eventId===e.id);if(memory)memory.source='heard';
 }else if(a.operation==='acceptGift'){
  if(g!.segments.some((segment,i)=>!has(segment.inventory,g!.costs[i].inventory)))return '预留的完整赠与实物已不足，不能声称完整交付';const amount=accountBalance(w,g!.account);pay(w,g!.account,`resident:${r.id}`,amount,'本人接受共同赠与实际收款',g!.id+':accept');for(const segment of g!.segments){change(r.inventory,segment.inventory,1);segment.inventory={};segment.coins=0;}g!.status='delivered';g!.deliveredAt=w.minute;s.totals.gifted+=amount;fact(w,r,`${r.name}亲自来到原储物处，独立接受并实际领取双方同意的共同赠与${amount}钱和具体物资；后续用途仍须本人决定。`);
 }else if(a.operation==='declineGift'||a.operation==='cancelGift'){cancelGift(w,g!,a.operation==='declineGift'?'declined':'cancelled');fact(w,r,`${r.name}拒绝或撤回了尚未交付的共同赠与，剩余实物与钱款原地退回各原出资人的份额。`);}
 else {const own=credit(p!,a.ownerId!)!,estate=w.estates.find(e=>e.personId===a.ownerId)!;pay(w,p!.account,`estate:${a.ownerId}`,own.coins,'已核实逝者的共用资金份额保全',p!.id+':estate:'+a.ownerId);s.totals.estateCoins+=own.coins;own.coins=0;change(estateStock(w,a.ownerId!,'household:'+p!.id,estateLocation(p!.at,null,null,'原共同储物处'))!,own.inventory,1);own.inventory={};fact(w,r,`${r.name}亲自到原共用储物处，将已核实逝者${person(w,a.ownerId)!.name}的个人份额纳入保全遗产，没有领取到自己名下或动用另一人的份额。`);}
 r.revision++;return null;
}
export function completeHousehold(w:World,r:Resident,a:HouseholdAction){return foodTransaction(w,()=>completeAtomic(w,r,a));}
export function advanceHousehold(w:World){initializeHousehold(w);const s=w.household;if(!s)return;for(const p of s.pools)if(p.status==='offered'&&(p.expiresAt<=w.minute||!adult(w,person(w,p.creatorId))||!adult(w,person(w,p.partnerId))||p.initial.item&&!has(credit(p,p.creatorId)!.inventory,{[p.initial.item]:p.initial.quantity}))){p.status='expired';p.closedAt=w.minute;p.reason='邀请到期、原实物不足或尚未形成双方有效接受，原份额仍在原处';}
 for(const g of s.gifts)if(['proposed','ready'].includes(g.status)){const p=pool(w,g.poolId)!;if(g.expiresAt<=w.minute||p.status!=='open'||!adult(w,person(w,g.proposerId))||!adult(w,person(w,g.approverId))||person(w,g.recipientId)?.status!=='alive'||g.status==='ready'&&g.segments.some((segment,i)=>!has(segment.inventory,g.costs[i].inventory)))foodTransaction(w,()=>cancelGift(w,g,'expired'));}
 if(s.gifts.length>200)s.gifts=s.gifts.filter((g,i)=>['proposed','ready'].includes(g.status)||i>=s.gifts.length-80);
 if(s.pools.length>200){const referenced=new Set(s.gifts.filter(g=>['proposed','ready'].includes(g.status)).map(g=>g.poolId));s.pools=s.pools.filter((p,i)=>['offered','open'].includes(p.status)||p.credits.some(nonempty)||referenced.has(p.id)||i>=s.pools.length-80);}}
export function hasHouseholdAssets(w:World,id:string){return !!w.household&&(w.household.pools.some(p=>p.credits.some(c=>c.ownerId===id&&nonempty(c)))||w.household.gifts.some(g=>g.status==='ready'&&g.segments.some(c=>c.ownerId===id&&nonempty(c))));}
export function householdOpportunities(w:World,r:Resident):FormalOpportunity[]{const result:FormalOpportunity[]=[],add=(id:string,label:string,a:HouseholdAction)=>{if(!householdReason(w,r,a))result.push({id:'household.'+id,label,action:a});};
 for(const b of w.buildings.filter(b=>eligibleHome(w,r,b.id)&&distance(r.at,b.door)<=8))for(const other of w.residents.filter(p=>p.id!==r.id&&coLocated(w,r,p,2)))for(const item of [undefined,...itemKeys.filter(i=>(r.inventory[i]??0)>0).slice(0,2)])add('create.'+other.id+'.'+b.id+'.'+(item??'cash'),`与${other.name}在${b.name}门外建立共同生活储物处：填写name（1–30字）、amount初始钱款0–200、quantity${item?itemLabels[item]+'0–20':'0'}，至少一项出资；对方另行接受相同初始数额，以后各人的份额分别记账`,{type:'household',operation:'create',targetId:other.id,buildingId:b.id,name:'共同生活储物处',amount:item?0:1,item,quantity:item?1:0});
 for(const p of w.household?.pools??[]){
  if(participants(p).includes(r.id)){for(const accept of [true,false])add('respond.'+p.id+'.'+accept,`${accept?'接受并匹配自己的初始出资':'拒绝'}${p.name}：本人出${p.initial.coins}钱和${p.initial.quantity}份${p.initial.item?itemLabels[p.initial.item]:'物资'}；个人产权、婚姻、住处分别记录`,{type:'household',operation:'respond',poolId:p.id,accept});add('close.'+p.id,'本人结束这份共用安排，剩余物资原地保留各自份额；不自动离婚或驱逐住户',{type:'household',operation:'close',poolId:p.id});
   for(const item of [undefined,...itemKeys.filter(i=>(r.inventory[i]??0)>0||(credit(p,r.id)?.inventory[i]??0)>0).slice(0,3)])for(const operation of ['deposit','withdraw'] as const)add(operation+'.'+p.id+'.'+(item??'cash'),`去${p.name}实际${operation==='deposit'?'存入':'领取'}自己的份额，填写amount钱款0–200、quantity${item?itemLabels[item]+'0–20':'0'}，至少一项；不能取另一人的钱物`,{type:'household',operation,poolId:p.id,amount:item?0:1,item,quantity:item?1:0});
   if(nearby(r,p))for(const to of w.residents.filter(to=>r.knownPeople.includes(to.id)&&coLocated(w,r,to,6)).slice(0,3))for(const item of [undefined,...itemKeys.filter(i=>p.credits.some(c=>(c.inventory[i]??0)>0)).slice(0,2)])add('gift.'+p.id+'.'+to.id+'.'+(item??'cash'),`向${to.name}提出共同赠与，填写amount钱款0–200、quantity${item?itemLabels[item]+'0–20':'0'}（至少一项）、ownPercent本人出资比例0–100；零头向本人取整，另一人出余数。须另一位出资人及接收者另行同意`,{type:'household',operation:'proposeGift',poolId:p.id,targetId:to.id,amount:item?0:1,item,quantity:item?1:0,ownPercent:50});}
  if(nearby(r,p))for(const own of p.credits)add('estate.'+p.id+'.'+own.ownerId,'亲自保全原储物处中已核实逝者的个人份额，纳入遗产而非领取到自己名下',{type:'household',operation:'protectEstate',poolId:p.id,ownerId:own.ownerId});
 }
 for(const g of w.household?.gifts??[])for(const operation of ['approveGift','acceptGift','declineGift','cancelGift','notifyGift'] as const)add(operation+'.'+g.id,`${{approveGift:'本人同意具体共同赠与并预存双方已同意的份额',acceptGift:'本人去原处独立接受共同赠与',declineGift:'本人拒绝接收共同赠与',cancelGift:'本人撤回尚未交付的共同赠与',notifyGift:'本人亲自向身边接收者送达有效赠与的消息及具体领取地点'}[operation]}：${g.amount}钱、${g.quantity}份${g.item?itemLabels[g.item]:'物资'}，接收者${person(w,g.recipientId)?.name}`,{type:'household',operation,giftId:g.id});
 return result;
}

export function householdNotes(w:World,r:Resident){return (w.household?.pools??[]).filter(p=>participants(p).includes(r.id)&&nearby(r,p)).map(p=>`${p.name}在原住处门外，共同账簿现状${p.status}。各人可领取份额：${p.credits.map(c=>(person(w,c.ownerId)?.name??'原出资人')+'钱款'+c.coins+'，实际物资'+JSON.stringify(c.inventory)).join('；')}。这不合并房屋产权或孩子财产，未经双方另行同意不能替对方赠与。`).join(' \n');}
