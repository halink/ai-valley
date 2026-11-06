import {hasReceipt} from './receipts.js';
import {industryDefinition} from './industry-rules.js';
import {crateAtOrigin,careForCrate} from './livestock-cargo.js';
import {estateStock,estateLocation} from './estate-custody.js';
import {deliveryPoint,cargoStation,atCargoStation,dispatchCargo,beginCargoReturn,advanceCargo} from './foreign-routing.js';
import {foodTransaction} from './food.js';
import {itemLabels} from '../shared/items.js';
import type {DecisionContext,FormalOpportunity,Inventory,Item,ModelDecision,Resident,Vec,World} from '../shared/types.js';
import type {ForeignAction,ForeignMerchant,ForeignOffer,ForeignRecipe,ForeignShipment} from '../shared/foreign-trade.js';
import {accountBalance,commitLevyForPolicy,initializeEconomy,moveCoins,salesLevyForPolicy} from './economy.js';
import {emitEvent} from './events.js';
import {distance,same,walkable} from './navigation.js';
import {ageYears,calendar,DAY,YEAR} from './time.js';

export const foreignItemNames=itemLabels;
const validNumber=(n:unknown,min=1,max=40):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const count=(bag:Inventory,item:Item)=>bag[item]??0;
const add=(bag:Inventory,item:Item,n:number)=>{bag[item]=count(bag,item)+n;};
const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([key,n])=>count(bag,key as Item)>=n!);
const change=(bag:Inventory,cost:Inventory,sign:number)=>{for(const [key,n]of Object.entries(cost))add(bag,key as Item,sign*n!);};
const localAdult=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
export const merchantFor=(w:World,id:string|undefined)=>w.foreignTrade?.merchants.find(m=>m.id===id);
export const isForeignActor=(w:World,id:string)=>!!merchantFor(w,id);
const offerFor=(w:World,id:string|undefined)=>w.foreignTrade?.offers.find(o=>o.id===id);
const shipmentFor=(w:World,id:string|undefined)=>w.foreignTrade?.shipments.find(s=>s.id===id);
const levy=(w:World)=>w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax:null;
const maxTax=(gross:number,rate:number)=>Math.ceil(gross*rate/10000);
const recipientAccount=(w:World,id:string)=>w.residents.find(r=>r.id===id)?.status==='dead'?`estate:${id}`:`resident:${id}`;
const recipientBag=(w:World,id:string,at:Vec,source:string)=>w.residents.find(r=>r.id===id)?.status==='dead'?estateStock(w,id,source,estateLocation(at,null,null,'合同实际交接处封存货物')):undefined;
const activeShipment=(s:ForeignShipment)=>!['completed','cancelled'].includes(s.status);
const nearStation=(w:World,r:Resident)=>!!w.foreignTrade&&!r.inside&&distance(r.at,w.foreignTrade.station)<=8;
export const knowsForeignStation=(w:World,r:Resident)=>nearStation(w,r)||!!w.foreignTrade?.knownStationIds.includes(r.id);

function personal(id:string,name:string,traits:string[],inventory:Inventory,minute:number):Resident {
 return {id,name,appearance:{hair:0x493423,shirt:0x738752,skin:0xe5b88b},at:{x:0,y:0},inside:null,bornAt:minute-35*YEAR,status:'alive',residency:'outside',homeId:null,traits,
  hunger:15,energy:90,health:100,inventory,coins:400,skills:{farming:2,building:1,care:1},relations:[],memories:[],knownPeople:[],knownResources:[],knownBuildings:[],
  plan:null,activity:null,intention:'考虑自己的经营安排',revision:0,decisionDue:minute,lastDecisionAt:minute-120,lastFailure:null,parents:[],guardianIds:[],pregnancy:null,canDecide:true,canExpress:true,refusesCare:false,deathAt:null,lifeStage:'adult'};
}
/** Regional capital and physical reserves are explicit one-time world starting conditions. */
export function initializeForeignTrade(w:World):void {
 if(w.mode!=='formal'||w.foreignTrade)return;
 initializeEconomy(w);
 const seed=[
  ['foreign-west','陆岑','西岭驿行栈','西岭驿',60,{seed:24,turnip:36,water:40,wood:18},['看重稳定往来','报价谨慎']],
  ['foreign-coast','海棠','南湾商号','南湾港',180,{meal:18,berry:30,water:40,seed:16},['愿意尝试新品','在意周转']],
  ['foreign-ridge','宋砾','北岭石材行','北岭矿镇',120,{stone:60,wood:24,water:40,turnip:18},['重视履约','喜欢议价']],
 ] as const;
 const frontier=w.scenario==='frontier';
 const merchants:ForeignMerchant[]=seed.map(([id,name,firm,origin,routeMinutes,inventory,traits],i)=>({id,name:firm,origin,routeMinutes:routeMinutes+(frontier?360:0),
  person:{...personal(id,name,[...traits],{...inventory},w.minute),decisionDue:w.minute+(frontier?(4+i)*DAY:i*60)},work:null,
  resources:{wood:{amount:36,max:36,regrowthDays:28,progress:0},stone:{amount:i===2?600:60,max:i===2?600:60,regrowthDays:0,progress:0},water:{amount:300,max:300,regrowthDays:1,progress:0}}}));
 const openingCoins=merchants.reduce((sum,m)=>sum+m.person.coins,0);
 w.foreignTrade={merchants,offers:[],shipments:[],station:{...w.map.entrance},knownStationIds:[],nextSerial:1,lastMinute:w.minute,openingCoins,
  totals:{imports:0,exports:0,importValue:0,exportValue:0,taxes:0,returned:0}};
 w.economy!.externalCoins+=openingCoins;
}
function tell(w:World,text:string,actors:string[]=[],remote=false){
 const event=emitEvent(w,{kind:'trade',actors,place:{...w.foreignTrade!.station},...(remote?{witnesses:[]}:{ }),text});
 for(const id of actors){const m=merchantFor(w,id);if(m){m.person.memories.push({eventId:event.id,receivedAt:w.minute,source:'self',text});if(m.person.memories.length>20)m.person.memories.shift();}}
 return event;
}
function touchMerchant(w:World,id:string){const m=merchantFor(w,id);if(m)m.person.revision++;}
function payment(w:World,from:string,to:string,n:number,reason:string,reference:string){
 if(n>0&&!moveCoins(w,from,to,n,reason,reference))throw new Error('foreign_transaction_failed:'+reason);
}
function parcel(w:World,o:ForeignOffer,quantity:number,readyAt=w.minute):void {
 const state=w.foreignTrade!,id=`foreign-shipment-${state.nextSerial++}`;
 state.shipments.push({id,offerId:o.id,merchantId:o.merchantId,residentId:o.residentId!,side:o.side,item:o.item,quantity,price:o.price,goods:quantity,status:'arrived',createdAt:w.minute,readyAt,
  departedAt:null,arrivesAt:w.minute,deliveryAt:w.minute,merchantNoticeAt:w.minute,merchantNotified:true,blockedSince:null,nextCheckAt:w.minute,collectedAt:null,stationAt:{...cargoStation(w,o)},deliveryId:o.deliveryId,route:{at:{...cargoStation(w,o)},phase:'done',updatedAt:w.minute,dueAt:w.minute,progress:0},escrowAccount:`escrow:${id}`,gross:0,maxTax:0,actualTax:0,taxPolicyId:null,taxRate:0,returned:true});
}
function closeOfferAtomic(w:World,o:ForeignOffer,status:'cancelled'|'rejected'|'expired'){
 if(o.status!=='open')return;
 const m=merchantFor(w,o.merchantId)!;
 if(o.escrowAccount){const to=o.initiatedBy==='merchant'?`foreign:${m.id}`:recipientAccount(w,o.residentId!);payment(w,o.escrowAccount,to,accountBalance(w,o.escrowAccount),'外贸报价余款退回',`foreign-offer-return:${o.id}`);}
 if(o.stock>0){
  if(o.initiatedBy==='merchant')add(m.person.inventory,o.item,o.stock);
  else {const estate=recipientBag(w,o.residentId!,cargoStation(w,o),'foreign-offer:'+o.id);if(estate)add(estate,o.item,o.stock);else parcel(w,o,o.stock,w.minute+(status==='rejected'?m.routeMinutes:0));}
 }
 o.stock=0;o.remaining=0;o.merchantKnownRemaining=0;o.status=status;touchMerchant(w,o.merchantId);
 const knownByMerchant=status==='rejected'||o.initiatedBy==='merchant'||o.expiresAt<=w.minute&&o.noticeAt<=w.minute;
 tell(w,`${m.name}的${o.side==='import'?'售货':'收购'}协商已${status==='expired'?'到期':status==='rejected'?'被对方婉拒':'撤回'}，预留钱款已退回，实物归原所有人保管${o.initiatedBy==='resident'&&o.side==='export'?'，回执送达后在驿站领取':''}。`,[...(knownByMerchant?[m.id]:[]),...(o.residentId?[o.residentId]:[])],true);
}
function shipmentTax(w:World,s:ForeignShipment):number {
 return s.taxPolicyId?salesLevyForPolicy(w,s.gross,`resident:${s.residentId}`,s.taxPolicyId,s.taxRate):0;
}
function commitTax(w:World,s:ForeignShipment){
 if(s.taxPolicyId)commitLevyForPolicy(w,s.gross,`resident:${s.residentId}`,s.taxPolicyId,s.taxRate);
}
function settleDeliveryAtomic(w:World,s:ForeignShipment){
 if(s.goods<s.quantity)throw new Error('cannot_settle_incomplete_cargo');
 const m=merchantFor(w,s.merchantId)!,state=w.foreignTrade!,tax=shipmentTax(w,s);
 if(tax>s.maxTax)throw new Error('foreign_tax_quote_exceeded');
 const target=s.side==='import'?`foreign:${m.id}`:recipientAccount(w,s.residentId);
 payment(w,s.escrowAccount,target,s.side==='import'?s.gross:s.gross-tax,s.side==='import'?'外贸进口货款':'外贸出口收入',`${s.id}:goods`);
 payment(w,s.escrowAccount,'treasury',tax,'外贸成交税',`${s.id}:tax`);
 const remainder=accountBalance(w,s.escrowAccount);
 if(remainder)payment(w,s.escrowAccount,s.side==='import'?recipientAccount(w,s.residentId):`foreign:${m.id}`,remainder,'外贸预留余款退回',`${s.id}:excess`);
 commitTax(w,s);s.actualTax=tax;s.deliveryAt=w.minute;state.totals.taxes+=tax;
 if(s.side==='export'){
  add(m.person.inventory,s.item,s.goods);s.goods=0;s.status='completed';state.totals.exports+=s.quantity;state.totals.exportValue+=s.gross;
 }else{
  const estate=recipientBag(w,s.residentId,cargoStation(w,s),'foreign-shipment:'+s.id);if(estate){add(estate,s.item,s.goods);s.goods=0;s.status='completed';}else s.status='arrived';
  state.totals.imports+=s.quantity;state.totals.importValue+=s.gross;
 }
 touchMerchant(w,m.id);
 tell(w,`${s.quantity} 份${foreignItemNames[s.item]}已经${s.side==='import'?'从'+m.origin+'运抵合同指定交接处':'送达'+m.origin}，实际结算货款 ${s.gross} 钱、税款 ${tax} 钱${s.status==='arrived'?'，货主尚待亲自取货':''}。`,[s.residentId],s.side==='export');
}
function finishReturnAtomic(w:World,s:ForeignShipment){
 const m=merchantFor(w,s.merchantId)!;
 const refund=s.side==='import'?recipientAccount(w,s.residentId):`foreign:${m.id}`;
 payment(w,s.escrowAccount,refund,accountBalance(w,s.escrowAccount),'外贸退运退款',`${s.id}:returned`);
 if(s.side==='import'){add(m.person.inventory,s.item,s.goods);s.goods=0;s.status='cancelled';}
 else{const estate=recipientBag(w,s.residentId,cargoStation(w,s),'foreign-shipment:'+s.id);if(estate){add(estate,s.item,s.goods);s.goods=0;s.status='cancelled';}else s.status='arrived';}
 s.returned=true;s.deliveryAt=w.minute;w.foreignTrade!.totals.returned+=s.quantity;touchMerchant(w,m.id);
 tell(w,`与${m.name}约定的 ${s.quantity} 份${foreignItemNames[s.item]}已完成退运，预留货款退回付款人，未收成交税。`,[s.residentId],s.side==='import');
}

/** Only accepted shipping arrangements and ecological consequences advance without another choice. */
export function advanceForeignTrade(w:World):void {
 initializeForeignTrade(w);const state=w.foreignTrade;if(!state)return;
 const elapsed=Math.max(0,w.minute-state.lastMinute);state.lastMinute=w.minute;
 for(const r of w.residents){
  if(r.status!=='alive'||r.residency==='outside'||state.knownStationIds.includes(r.id))continue;
  const publicNotice=w.buildings.some(b=>b.ownerId==='commons'&&distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id));
  if(nearStation(w,r)||publicNotice)state.knownStationIds.push(r.id);
 }
 for(const m of state.merchants){
  for(const stock of Object.values(m.resources)){
   if(stock.regrowthDays<=0||stock.amount>=stock.max){stock.progress=0;continue;}
   stock.progress+=elapsed*stock.max/(stock.regrowthDays*DAY);const n=Math.min(stock.max-stock.amount,Math.floor(stock.progress));stock.amount+=n;stock.progress-=n;
  }
  if(m.work&&m.work.finishesAt<=w.minute){
   foodTransaction(w,()=>change(m.person.inventory,m.work!.output,1));const done=m.work;if(done.animalId){const c=w.industry?.livestockCargo?.find(c=>c.id===done.animalId);if(c&&crateAtOrigin(w,c,m.id))careForCrate(w,c,done.recipe==='waterLivestock');else change(m.person.inventory,done.recipe==='waterLivestock'?{water:1}:{fodder:1},1);}m.work=null;m.person.revision++;m.person.decisionDue=w.minute;
   tell(w,`${m.name}在${m.origin}完成了本人先前安排的${recipeNames[done.recipe]}，${done.animalId?'原库现场照料窗口结束，离库或已死亡动物的未用物资归还原库':'实物已入库'}。`,[m.id],true);
  }
 }
 for(const o of state.offers){
  if(o.status!=='open')continue;
  const resident=o.residentId?w.residents.find(r=>r.id===o.residentId):undefined;
  if(o.expiresAt<=w.minute||resident?.status==='dead'||(o.initiatedBy==='merchant'&&o.side==='import'||o.initiatedBy==='resident'&&o.side==='export')&&o.stock<o.remaining)closeOffer(w,o,'expired');
  else if(o.initiatedBy==='resident'&&o.noticeAt<=w.minute&&!o.delivered){o.delivered=true;const m=merchantFor(w,o.merchantId)!;m.person.decisionDue=Math.min(m.person.decisionDue,w.minute);}
 }
 for(const s of state.shipments){
  if(!s.merchantNotified&&w.minute>=(s.merchantNoticeAt??s.createdAt)){
   s.merchantNotified=true;const m=merchantFor(w,s.merchantId)!,o=offerFor(w,s.offerId);
   if(o&&o.initiatedBy==='merchant')o.merchantKnownRemaining=Math.max(0,o.quantity-state.shipments.filter(other=>other.offerId===o.id&&(other.merchantNoticeAt??other.createdAt)<=w.minute).reduce((n,other)=>n+other.quantity,0));
   m.person.decisionDue=Math.min(m.person.decisionDue,w.minute);m.person.revision++;
   tell(w,`${m.name}实际收到了 ${s.quantity} 份${foreignItemNames[s.item]}交易的确认信，知道双方已按每份 ${s.price} 钱成立运输约定。`,[m.id],true);
  }
  const owner=w.residents.find(r=>r.id===s.residentId);
  if(s.goods<s.quantity&&['ready','inTransit'].includes(s.status)){const ready=s.status==='ready';if(ready){s.route={at:{...cargoStation(w,s)},phase:'done',updatedAt:w.minute,dueAt:w.minute,progress:0};s.status='returning';s.returned=true;s.arrivesAt=w.minute;s.nextCheckAt=w.minute;}else beginCargoReturn(w,s);tell(w,`货物发生腐败或活畜死亡等实际损失，原约定的完整数量无法交付，停止成交并退运剩余实物；货款待实际退达后退回。`,[s.residentId]);}
  if(s.status==='arrived'&&s.goods===0){s.status=s.returned?'cancelled':'completed';continue;}
  if(s.status==='ready'&&(owner?.status==='dead'||w.minute>s.readyAt+7*DAY)){
   s.status='returning';s.returned=true;s.arrivesAt=w.minute;s.nextCheckAt=w.minute;finishReturn(w,s);continue;
  }
  if(s.status==='arrived'&&owner?.status==='dead'){
   const estate=recipientBag(w,s.residentId,cargoStation(w,s),'foreign-shipment:'+s.id);if(estate)foodTransaction(w,()=>{add(estate,s.item,s.goods);s.goods=0;s.status=s.returned?'cancelled':'completed';});continue;
  }
  if(!['inTransit','returning'].includes(s.status)||w.minute<s.nextCheckAt)continue;
  if(!advanceCargo(w,s))continue;
  if(s.status==='returning')finishReturn(w,s);else settleDelivery(w,s);
 }
 // In-progress rights are never pruned. The full event and receipt journals remain durable.
 if(state.offers.length>160){const referenced=new Set(state.shipments.filter(activeShipment).map(s=>s.offerId));state.offers=state.offers.filter((o,i)=>o.status==='open'||referenced.has(o.id)||i>=state.offers.length-80);}
 if(state.shipments.length>160)state.shipments=state.shipments.filter((s,i)=>activeShipment(s)||i>=state.shipments.length-80);
}

export const recipeNames:Record<ForeignRecipe,string>={drawWater:'取水',gatherWood:'采伐',quarryStone:'采石',saveSeed:'留种',cook:'烹饪',growRoots:'商行温棚种植',fiber:'整理植物纤维',fodder:'配制饲料',feedLivestock:'给原库活畜喂饲料',waterLivestock:'给原库活畜供水'};
function production(m:ForeignMerchant,recipe:ForeignRecipe,quantity:number):{duration:number;cost:Inventory;output:Inventory;resource?:'wood'|'stone'|'water'}|undefined {
 if(recipe==='feedLivestock')return {duration:30,cost:{fodder:1},output:{}};
 if(recipe==='waterLivestock')return {duration:30,cost:{water:1},output:{}};
 if(recipe==='fiber')return {duration:quantity*20,cost:{wood:quantity},output:{fiber:3*quantity}};
 if(recipe==='fodder')return {duration:quantity*20,cost:{turnip:quantity,fiber:quantity},output:{fodder:4*quantity}};
 if(recipe==='drawWater')return {duration:quantity*2,cost:{},output:{water:quantity},resource:'water'};
 if(recipe==='gatherWood')return {duration:quantity*8,cost:{},output:{wood:quantity},resource:'wood'};
 if(recipe==='quarryStone')return {duration:quantity*12,cost:{},output:{stone:quantity},resource:'stone'};
 if(recipe==='saveSeed')return {duration:quantity*15,cost:{turnip:quantity},output:{seed:quantity*2}};
 if(recipe==='cook')return {duration:quantity*20,cost:{turnip:quantity*2,water:quantity},output:{meal:quantity}};
 if(recipe==='growRoots')return {duration:4*DAY,cost:{seed:quantity,water:quantity*2},output:{turnip:quantity*12}};
}
export function foreignReason(w:World,r:Resident,a:ForeignAction):string|null {
 const state=w.foreignTrade,m=merchantFor(w,r.id);
 if(!state||w.mode!=='formal'||(!m&&!localAdult(w,r)))return '本人当前不能安排外贸';
 if(m&&m.work)return '自己的既有生产安排尚未完成';
 if(a.operation==='wait')return m&&validNumber(a.minutes,60,720)?null:'商行等待时间无效';
 if(a.operation==='produce'){
  if(!m||!a.recipe||!validNumber(a.quantity,1,12))return '本次商行生产安排无效';
  if(['feedLivestock','waterLivestock'].includes(a.recipe)){const c=w.industry?.livestockCargo?.find(c=>c.id===a.animalId);if(a.quantity!==1||!c||!crateAtOrigin(w,c,m.id))return '本人原库没有这只实际活畜，不能远程喂养运输中或已交付的动物';}
  const work=production(m,a.recipe,a.quantity);if(!work||!has(m.person.inventory,work.cost))return '商行实际生产材料不足';
  return work.resource&&m.resources[work.resource].amount<a.quantity?'已探明的实际资源不足':null;
 }
 if(a.operation==='post'||a.operation==='propose'){
  const partner=merchantFor(w,a.merchantId??m?.id);
  if(!partner||!['import','export'].includes(a.side??'')||!a.item||!Object.hasOwn(foreignItemNames,a.item)||!validNumber(a.quantity)||!validNumber(a.price,1,1000))return '外贸物品、价格或数量无效';
  if(a.operation==='post'&&(!m||partner.id!==m.id)||a.operation==='propose'&&m)return '只能以本人的身份提出自己的报价';
  if(state.offers.filter(o=>o.status==='open'&&(m?o.merchantId===m.id&&o.initiatedBy==='merchant':o.residentId===r.id)).length>=4)return '本人已有四项待处理报价，请先履约或撤回';
  if(!m&&state.shipments.filter(s=>s.residentId===r.id&&activeShipment(s)).length>=4)return '本人已有四项运输或取货安排，请先处理';
  const gross=a.price*a.quantity;
  if(m)return a.side==='import'?(count(m.person.inventory,a.item)>=a.quantity?null:'商行没有足够的实际货物'):(m.person.coins>=gross?null:'商行没有足够钱款预存收购款');
  const delivery=deliveryPoint(w,r,a.deliveryId);if(!delivery||!atCargoStation(w,r,{stationAt:delivery.at}))return '须本人到达有权使用的实际交接处提交协商与实物';
  const policy=levy(w),rate=policy?.basisPoints??0;
  if(!validNumber(a.maximumLevyBasisPoints,0,1500)||rate>a.maximumLevyBasisPoints)return '当前税率高于本人所见上限，请重新决定';
  return a.side==='import'?(r.coins>=gross+maxTax(gross,rate)?null:'本人实际钱款不足以预存货款与最高税额'):(count(r.inventory,a.item)>=a.quantity?null:'出口货物须由本人实际带到驿站');
 }
 if(a.operation==='accept'||a.operation==='reject'||a.operation==='cancelOffer'){
  const o=offerFor(w,a.offerId);if(!o||o.expiresAt<=w.minute)return '这份外贸报价已经结束';
  // Withdrawing whatever remains unbound does not reveal a sale whose reply is still travelling.
  if(a.operation==='cancelOffer'&&m&&o.initiatedBy==='merchant'&&o.merchantId===m.id&&o.status==='accepted'&&(o.merchantKnownRemaining??o.remaining)>0)return null;
  if(o.status!=='open')return '这份外贸报价已经结束';
  const partner=merchantFor(w,o.merchantId)!;
  if(a.operation==='cancelOffer')return m?(o.initiatedBy==='merchant'&&o.merchantId===m.id?null:'只能撤回本人报价'):(o.initiatedBy==='resident'&&o.residentId===r.id&&atCargoStation(w,r,o)?null:'须到驿站撤回本人报价');
  if(o.noticeAt>w.minute)return '报价信件尚未实际送达';
  if(m){if(o.initiatedBy!=='resident'||o.merchantId!==m.id)return '这份协商不是交给自己的';}
  else if(o.initiatedBy!=='merchant'||!nearStation(w,r))return '须到驿站阅读对方真实张贴的报价';
  if(a.operation==='reject')return m?null:'可自行不接受公开报价，无需替商行撤单';
  const quantity=m?o.remaining:a.quantity;
  if(!validNumber(quantity)||quantity>o.remaining)return '报价数量不足';
  if((o.initiatedBy==='merchant'&&o.side==='import'||o.initiatedBy==='resident'&&o.side==='export')&&o.stock<quantity)return '预留实物已不足，原报价不能继续成交';
  if(state.shipments.filter(s=>s.residentId===(m?o.residentId:r.id)&&activeShipment(s)).length>=4)return '本人已有四项待处理运输或取货安排';
  if(!m){
   if(a.quotedPrice!==o.price)return '报价已经改变，请重新查看';
   const rate=levy(w)?.basisPoints??0;
   if(!validNumber(a.maximumLevyBasisPoints,0,1500)||rate>a.maximumLevyBasisPoints)return '当前税率高于本人所见上限，请重新决定';
   return o.side==='import'?(r.coins>=o.price*quantity+maxTax(o.price*quantity,rate)?null:'本人货款及税额预留不足'):(count(r.inventory,o.item)>=quantity?null:'本人尚未把这批实际货物带到驿站');
  }
  return o.side==='import'?(count(partner.person.inventory,o.item)>=quantity?null:'商行没有足够的实际货物'):(partner.person.coins>=o.price*quantity?null:'商行预付资金不足');
 }
 const s=shipmentFor(w,a.shipmentId);
 if(!s||!(m?s.merchantId===m.id:s.residentId===r.id))return '没有交给本人的运输安排';
 if(m&&w.minute<(s.merchantNoticeAt??s.createdAt))return '对方接单的信件尚未送达自己的商行';
 if(!m&&s.readyAt>w.minute)return '这笔协商的回执尚未实际送达';
 if(!m&&!atCargoStation(w,r,s))return '须亲自到合同指定的交接处查看、发货或领取';
 if(a.operation==='dispatch')return !m&&s.status==='ready'&&s.readyAt<=w.minute&&walkable(w,cargoStation(w,s))?null:'这批货物尚未具备实际启程条件';
 if(a.operation==='collect')return !m&&s.status==='arrived'&&s.goods>0?null:'尚无已经到站的本人货物';
 if(a.operation==='cancelShipment')return s.status==='ready'||s.status==='inTransit'?null:'这笔运输已交付或正在退运，无法再次撤回';
 return '未知的外贸安排';
}
export function foreignTarget(w:World,r:Resident,a:ForeignAction):{target:Vec;duration:number;error?:string}{
 const error=foreignReason(w,r,a);const shipment=shipmentFor(w,a.shipmentId),offer=offerFor(w,a.offerId),delivery=a.operation==='propose'?deliveryPoint(w,r,a.deliveryId):null;return error?{target:r.at,duration:0,error}:{target:{...(delivery?.at??cargoStation(w,shipment??offer))},duration:a.operation==='dispatch'||a.operation==='collect'?10:5};
}
function newOffer(w:World,r:Resident,a:ForeignAction){
 const state=w.foreignTrade!,m=merchantFor(w,a.merchantId??r.id)!,foreign=!!merchantFor(w,r.id),id=`foreign-offer-${state.nextSerial++}`;
 const policy=foreign?null:levy(w),rate=policy?.basisPoints??0,gross=a.price!*a.quantity!;
 const cash=foreign?a.side==='export':a.side==='import';const escrowAccount=cash?`escrow:${id}`:null;
 if(cash)payment(w,foreign?`foreign:${m.id}`:`resident:${r.id}`,escrowAccount!,gross+(foreign?0:maxTax(gross,rate)),'外贸报价预付款',`${id}:reserve`);
 else add(r.inventory,a.item!,-a.quantity!);
 const o:ForeignOffer={id,merchantId:m.id,residentId:foreign?null:r.id,initiatedBy:foreign?'merchant':'resident',side:a.side!,item:a.item!,quantity:a.quantity!,remaining:a.quantity!,merchantKnownRemaining:a.quantity!,price:a.price!,createdAt:w.minute,noticeAt:w.minute+m.routeMinutes,expiresAt:w.minute+4*DAY,status:'open',stationAt:{...(foreign?state.station:deliveryPoint(w,r,a.deliveryId)!.at)},deliveryId:foreign?undefined:a.deliveryId,escrowAccount,stock:cash?0:a.quantity!,taxPolicyId:policy?.proposalId??null,taxRate:rate};
 state.offers.push(o);touchMerchant(w,m.id);
 tell(w,`${foreign?m.name:r.name}在交接处（${(foreign?state.station:deliveryPoint(w,r,a.deliveryId)!.at).x},${(foreign?state.station:deliveryPoint(w,r,a.deliveryId)!.at).y}）提出${a.side==='import'?'从'+m.origin+'进口':'向'+m.origin+'出口'} ${a.quantity} 份${foreignItemNames[a.item!]}的报价，每份 ${a.price} 钱，信件尚待送达与对方自行决定。`,foreign?[m.id]:[r.id],foreign);
}
function acceptOffer(w:World,r:Resident,a:ForeignAction){
 const state=w.foreignTrade!,o=offerFor(w,a.offerId)!,m=merchantFor(w,o.merchantId)!,isMerchant=!!merchantFor(w,r.id);
 const residentId=isMerchant?o.residentId!:r.id,quantity=isMerchant?o.remaining:a.quantity!,id=`foreign-shipment-${state.nextSerial++}`;
 const policy=isMerchant?{proposalId:o.taxPolicyId,basisPoints:o.taxRate}:levy(w),rate=policy?.basisPoints??0;
 const gross=quantity*o.price,tax=maxTax(gross,rate),escrowAccount=`escrow:${id}`;
 if(o.side==='import'){
  payment(w,isMerchant?o.escrowAccount!:`resident:${r.id}`,escrowAccount,gross+tax,'进口货款预留',`${id}:reserve`);
  if(isMerchant)add(m.person.inventory,o.item,-quantity);else o.stock-=quantity;
 }else{
  payment(w,isMerchant?`foreign:${m.id}`:o.escrowAccount!,escrowAccount,gross,'出口收购货款预留',`${id}:reserve`);
  if(isMerchant)o.stock-=quantity;else add(r.inventory,o.item,-quantity);
 }
 o.remaining-=quantity;if(isMerchant)o.merchantKnownRemaining=o.remaining;if(!o.remaining)o.status='accepted';
 const readyAt=isMerchant?w.minute+m.routeMinutes:w.minute;
 state.shipments.push({id,offerId:o.id,merchantId:m.id,residentId,side:o.side,item:o.item,quantity,price:o.price,goods:quantity,
  stationAt:{...cargoStation(w,o)},deliveryId:o.deliveryId,route:o.side==='import'?{at:null,phase:'regionalIn',updatedAt:w.minute,dueAt:w.minute+m.routeMinutes*(isMerchant?1:2),progress:0}:{at:{...cargoStation(w,o)},phase:'done',updatedAt:w.minute,dueAt:w.minute,progress:0},status:o.side==='import'?'inTransit':'ready',createdAt:w.minute,readyAt,merchantNoticeAt:w.minute+(isMerchant?0:m.routeMinutes),merchantNotified:isMerchant,
  departedAt:o.side==='import'?w.minute:null,arrivesAt:o.side==='import'?w.minute+m.routeMinutes*(isMerchant?1:2):null,
  blockedSince:null,nextCheckAt:w.minute,collectedAt:null,escrowAccount,gross,maxTax:tax,actualTax:null,taxPolicyId:policy?.proposalId??null,taxRate:rate,returned:false});
 touchMerchant(w,m.id);
 tell(w,`${isMerchant?m.name:r.name}自主接受了每份 ${o.price} 钱的协商，${quantity} 份${foreignItemNames[o.item]}及货款已分别预留。${o.side==='import'?'货物按已同意的往返安排在途中，实际到站后结算':'回执送达后由本镇货主亲自办理发货'}；本单税率锁定 ${rate/100}%，最多 ${tax} 钱，累计零头按实际交付结算。`,isMerchant?[m.id]:[r.id],isMerchant);
}
function executeAtomic(w:World,r:Resident,a:ForeignAction):string|null {
 const error=foreignReason(w,r,a);if(error)return error;
 const m=merchantFor(w,r.id);
 const endpoint=a.operation==='propose'?deliveryPoint(w,r,a.deliveryId)?.at:cargoStation(w,shipmentFor(w,a.shipmentId)??offerFor(w,a.offerId));
 if(!m&&(!endpoint||!same(r.at,endpoint)||r.inside))return '须本人实际抵达约定交接处办理';
 const ref=`foreign-action:${r.activity?.planId??`${r.id}:${r.revision}:${w.revision}`}:${r.activity?.startedAt??w.minute}:${a.operation}`;
 if(hasReceipt(w,ref))return null;
 if(a.operation==='post'||a.operation==='propose')newOffer(w,r,a);
 else if(a.operation==='accept')acceptOffer(w,r,a);
 else if(a.operation==='reject'||a.operation==='cancelOffer')closeOffer(w,offerFor(w,a.offerId)!,a.operation==='reject'?'rejected':'cancelled');
 else if(a.operation==='wait')m!.person.decisionDue=w.minute+a.minutes!;
 else if(a.operation==='produce'){
  const work=production(m!,a.recipe!,a.quantity!)!;if(a.animalId){const c=w.industry!.livestockCargo!.find(c=>c.id===a.animalId)!;work.duration=industryDefinition(w,c.definition).rules.animalWorkMinutes;}change(m!.person.inventory,work.cost,-1);
  if(work.resource)m!.resources[work.resource].amount-=a.quantity!;
  m!.work={animalId:a.animalId,recipe:a.recipe!,quantity:a.quantity!,finishesAt:w.minute+work.duration,output:work.output};
  tell(w,`${m!.name}自行安排了${recipeNames[a.recipe!]}，已预留实际材料，完成后才能获得产品。`,[m!.id],true);
 }else{
  const s=shipmentFor(w,a.shipmentId)!,partner=merchantFor(w,s.merchantId)!;
  if(a.operation==='dispatch'){
   s.status='inTransit';s.departedAt=w.minute;s.nextCheckAt=w.minute;dispatchCargo(w,s);
   tell(w,`${r.name}实际在合同指定交接处交付并发出了 ${s.quantity} 份${foreignItemNames[s.item]}，货款在送达${partner.origin}后结算。`,[r.id]);
  }else if(a.operation==='collect'){
   add(r.inventory,s.item,s.goods);s.goods=0;s.collectedAt=w.minute;s.status=s.returned?'cancelled':'completed';
   tell(w,`${r.name}亲自来到合同指定交接处，领取了 ${s.quantity} 份${foreignItemNames[s.item]}${s.returned?'退回的原货':''}。`,[r.id]);
  }else{
   const ready=s.status==='ready';beginCargoReturn(w,s);
   if(ready)finishReturn(w,s);
   tell(w,`${m?m.name:r.name}撤回运输约定，${ready?'未出发的货物留在驿站，预付款已退回':'货物正在按原路退回，实际退达后才会退还货款'}。`,m?[m.id]:[r.id],!!m);
  }
 }
 w.processed.push(ref);r.revision++;return null;
}
export const completeForeignTrade=execute;
export function foreignCandidates(w:World):Resident[]{return (w.foreignTrade?.merchants??[]).filter(m=>!m.work&&m.person.status==='alive'&&m.person.canDecide&&m.person.decisionDue<=w.minute).map(m=>m.person);}
export function hasForeignAssets(w:World,id:string):boolean {
 return !!w.foreignTrade&&(w.foreignTrade.offers.some(o=>o.residentId===id&&o.status==='open')||w.foreignTrade.shipments.some(s=>s.residentId===id&&activeShipment(s)));
}
export function activeForeignPolicyIds(w:World):string[]{return [...new Set([...(w.foreignTrade?.offers.filter(o=>o.status==='open').map(o=>o.taxPolicyId)??[]),...(w.foreignTrade?.shipments.filter(activeShipment).map(s=>s.taxPolicyId)??[])].filter((id):id is string=>!!id))];}
export function foreignDeadline(w:World,id:string):number {
 return Math.min(Infinity,...(w.foreignTrade?.offers.filter(o=>o.residentId===id&&o.status==='open').map(o=>o.expiresAt)??[]));
}

export function merchantChoices(w:World,m:ForeignMerchant):FormalOpportunity[]{
 const choices:FormalOpportunity[]=[];
 const add=(id:string,label:string,action:ForeignAction)=>{if(!foreignReason(w,m.person,action))choices.push({id:'foreign.'+id,label,action});};
 for(const o of w.foreignTrade!.offers.filter(o=>o.merchantId===m.id&&o.initiatedBy==='resident'&&o.status==='open'&&o.noticeAt<=w.minute).slice(0,4)){
  const description=`交接地址（${cargoStation(w,o).x},${cargoStation(w,o).y}），镇内按实际陆路运输；${o.side==='import'?'向来信居民出售':'向来信居民收购'} ${o.remaining} 份${foreignItemNames[o.item]}，每份 ${o.price} 钱`;
  add('accept.'+o.id,`接受已送达的协商，${description}，使用自己的真实资金或货物`,{type:'foreignTrade',operation:'accept',offerId:o.id});
  add('reject.'+o.id,`婉拒已送达的协商：${description}`,{type:'foreignTrade',operation:'reject',offerId:o.id});
 }
 for(const item of Object.keys(foreignItemNames) as Item[]){
  add('sell.'+item,`出售${foreignItemNames[item]}（实存${count(m.person.inventory,item)}份；填quantity 1–40、price每份1–1000）`,{type:'foreignTrade',operation:'post',merchantId:m.id,side:'import',item,quantity:1,price:1});
  add('buy.'+item,`收购${foreignItemNames[item]}（填quantity 1–40、price每份1–1000；实存货款）`,{type:'foreignTrade',operation:'post',merchantId:m.id,side:'export',item,quantity:1,price:1});
 }
 for(const o of w.foreignTrade!.offers.filter(o=>o.merchantId===m.id&&o.initiatedBy==='merchant'&&['open','accepted'].includes(o.status)&&(o.merchantKnownRemaining??o.remaining)>0).slice(0,4))add('cancel.'+o.id,`撤回自己此前登记${o.side==='import'?'出售':'收购'}${o.merchantKnownRemaining??o.remaining}份${foreignItemNames[o.item]}、每份${o.price}钱的未成交报价`,{type:'foreignTrade',operation:'cancelOffer',offerId:o.id});
 for(const s of w.foreignTrade!.shipments.filter(s=>s.merchantId===m.id&&w.minute>=(s.merchantNoticeAt??s.createdAt)&&(s.status==='ready'||s.status==='inTransit')).slice(0,2))add('recall.'+s.id,`取消自己已同意的${s.quantity}份${foreignItemNames[s.item]}运输，货款等货物实际退回后退还`,{type:'foreignTrade',operation:'cancelShipment',shipmentId:s.id});
 for(const c of w.industry?.livestockCargo?.filter(c=>crateAtOrigin(w,c,m.id))??[])for(const recipe of ['feedLivestock','waterLivestock'] as const)add(recipe+'.'+c.id,`自行花30分钟、本人1${recipe==='feedLivestock'?'饲料':'水'}照料原库${c.kind}，实际${Math.floor((w.minute-c.bornAt)/DAY)}日龄，饥饿${Math.round(c.hunger)}、口渴${Math.round(c.thirst)}、健康${Math.round(c.health)}；交易与运输不重置生命`,{type:'foreignTrade',operation:'produce',recipe,quantity:1,animalId:c.id});
 for(const recipe of (Object.keys(recipeNames) as ForeignRecipe[]).filter(r=>!['feedLivestock','waterLivestock'].includes(r)))add('produce.'+recipe,`自己安排${recipeNames[recipe]}（填写quantity 1–12；只使用自己的已知库存与可开采资源，产出需等待工作完成）`,{type:'foreignTrade',operation:'produce',recipe,quantity:1});
 for(const minutes of [120,360])add('wait.'+minutes,`保持现有安排，${minutes}分钟后再考虑经营`,{type:'foreignTrade',operation:'wait',minutes});
 return choices;
}
export function foreignDecisionContext(w:World,person:Resident):DecisionContext {
 const m=merchantFor(w,person.id);if(!m)throw new Error('unknown_foreign_actor');
 const pending=w.foreignTrade!.offers.filter(o=>o.merchantId===m.id&&o.initiatedBy==='merchant'&&['open','accepted'].includes(o.status)&&(o.merchantKnownRemaining??o.remaining)>0);
 const notice=`你经营${m.name}，实际可用钱款${person.coins}，未预留库存${JSON.stringify(person.inventory)}。你自己的已探明资源：木料${m.resources.wood.amount}、石料${m.resources.stone.amount}、水${m.resources.water.amount}。采石不会凭空恢复；木材和水源会随时间恢复。根据已收到回执，自己登记的报价${pending.map(o=>(o.side==='import'?'出售':'收购')+(o.merchantKnownRemaining??o.remaining)+foreignItemNames[o.item]+'每份'+o.price+'钱').join('；')||'无'}。你只知道实际送到自己的报价信件，无法知道山谷居民的私人库存或意愿。运输到谷口约${m.routeMinutes}分钟。留种每根菜产2种，烹饪每2根菜1水产1餐，商行温棚每1种2水在4日后产12根菜。原库活畜需本人花30分钟用真实饲料或水照料，运输中无法远程喂养；整理1木成3纤维，1菜1纤维配4饲料。是否经营、生产或婉拒均由你自行决定。`;
 return {foreign:{origin:m.origin,notice,choices:merchantChoices(w,m)},actor:{id:person.id,name:person.name,traits:person.traits,hunger:person.hunger,energy:person.energy,health:person.health,inventory:{...person.inventory},coins:person.coins,skills:{...person.skills},intention:person.intention,at:{...person.at},homeId:null,lastFailure:person.lastFailure},
  bounds:{width:w.map.width,height:w.map.height},minute:w.minute,season:calendar(w.minute).season,weather:w.weather,people:[],buildings:[],resources:[],plots:[],knownLand:[],offers:[],proposals:[],memories:person.memories.slice(-8)};
}
export function applyForeignDecision(w:World,id:string,revision:number,decision:ModelDecision):{ok:boolean;error?:string}{
 const m=merchantFor(w,id);if(!m||m.person.revision!==revision||m.work||m.person.status!=='alive')return {ok:false,error:'商行当前状态已改变'};
 if(decision.actions.length!==1||decision.actions[0].type!=='foreignTrade')return {ok:false,error:'商行只能提交自己的经营选择'};
 const action=decision.actions[0],error=execute(w,m.person,action);
 if(error)return {ok:false,error};
 m.person.intention=decision.intention.slice(0,160);m.person.lastDecisionAt=w.minute;m.person.lastFailure=null;
 if(action.operation!=='wait')m.person.decisionDue=w.minute+120;
 return {ok:true};
}

function execute(w:World,r:Resident,a:ForeignAction):string|null{return foodTransaction(w,()=>executeAtomic(w,r,a));}

function closeOffer(w:World,o:ForeignOffer,status:'cancelled'|'rejected'|'expired'):void{return foodTransaction(w,()=>closeOfferAtomic(w,o,status));}

function settleDelivery(w:World,s:ForeignShipment):void{return foodTransaction(w,()=>settleDeliveryAtomic(w,s));}

function finishReturn(w:World,s:ForeignShipment):void{return foodTransaction(w,()=>finishReturnAtomic(w,s));}
