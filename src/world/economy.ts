import {activeBusinessRelocation} from '../shared/business-relocation.js';
import {premisesBusinessRight} from '../shared/premises.js';
import {firstReceipt,hasReceipt} from './receipts.js';
import {estateStock,estateBuildingLocation} from './estate-custody.js';
import {advanceFood,foodTransaction} from './food.js';
import {routeFood} from './food-routes.js';
import {itemLabels} from '../shared/items.js';
import type {Building, Inventory, Item, Resident, Vec, World} from '../shared/types.js';
import type {Business, EconomyAction, MarketListing} from '../shared/economy.js';
import {distance, same} from './navigation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {ageYears, DAY} from './time.js';

export const itemNames=itemLabels;
const integer=(n:unknown,min=1,max=1_000_000):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const active=(r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress;
const amount=(stock:Inventory,item:Item)=>stock[item]??0;
function add(stock:Inventory,item:Item,n:number){stock[item]=amount(stock,item)+n;}
function deposit(stock:Inventory,other:Inventory){for(const [item,n] of Object.entries(other))add(stock,item as Item,n!);}

/** Installation opens empty institutions; it never taxes or endows a resident by implication. */
export function initializeEconomy(w:World):void {
  if(w.mode!=='formal'||w.economy)return;
  w.economy={treasury:0,treasuryStock:{},escrows:{},businesses:[],listings:[],ledger:[],
    initialCoins:w.residents.reduce((sum,r)=>sum+r.coins,0)+w.estates.reduce((sum,e)=>sum+e.coins,0),
    externalCoins:0,knownResidents:w.residents.map(r=>r.id),transferCount:0,transferred:0,totals:{},nextSerial:1};
}
function account(w:World,id:string,create=false):{get:()=>number;set:(n:number)=>void}|undefined {
  const e=w.economy;if(!e)return;
  if(id==='treasury')return {get:()=>e.treasury,set:n=>{e.treasury=n;}};
  const colon=id.indexOf(':'),kind=id.slice(0,colon),key=id.slice(colon+1);if(colon<0||!key)return;
  if(kind==='resident'){
    const r=w.residents.find(r=>r.id===key);if(!r)return;
    return {get:()=>r.coins,set:n=>{r.coins=n;r.revision++;}};
  }
  if(kind==='business'){
    const b=e.businesses.find(b=>b.id===key);if(!b)return;
    return {get:()=>b.coins,set:n=>{b.coins=n;}};
  }
  if(kind==='estate'){
    const estate=w.estates.find(r=>r.personId===key);if(!estate)return;
    return {get:()=>estate.coins,set:n=>{estate.coins=n;}};
  }
  if(kind==='foreign'){
    const merchant=w.foreignTrade?.merchants.find(m=>m.id===key);
    if(!merchant)return;
    return {get:()=>merchant.person.coins,set:n=>{merchant.person.coins=n;merchant.person.revision++;}};
  }
  if(kind==='escrow'&&(Object.hasOwn(e.escrows,key)||create)){
    return {get:()=>e.escrows[key]??0,set:n=>{e.escrows[key]=n;}};
  }
}
export function accountBalance(w:World,id:string):number{return account(w,id)?.get()??0;}
/** Currency has no negative balance. Receipts live in the durable receipt journal across restarts. */
export function moveCoins(w:World,from:string,to:string,n:number,reason:string,reference:string):boolean {
  initializeEconomy(w);if(!w.economy||!integer(n,0)||!reference||reference.length>300||!reason||reason.length>100)return false;
  const namespace=`coin:${JSON.stringify(reference)}`;
  const receipt=namespace+':'+JSON.stringify([from,to,n,reason]);
  const prior=firstReceipt(w,namespace);if(prior)return prior===receipt;
  const source=account(w,from),target=account(w,to,true);
  if(!source||!target||!Number.isSafeInteger(source.get())||!Number.isSafeInteger(target.get())||source.get()<n||!Number.isSafeInteger(target.get()+n))return false;
  if(from!==to){source.set(source.get()-n);target.set(target.get()+n);}
  const e=w.economy;
  e.ledger.push({id:`coin-${e.nextSerial++}`,at:w.minute,from,to,amount:n,reason,reference});
  if(e.ledger.length>240)e.ledger.splice(0,e.ledger.length-240);
  e.transferCount++;e.transferred+=n;e.totals[reason]=(e.totals[reason]??0)+n;
  w.processed.push(receipt);w.revision++;return true;
}
export function totalCoins(w:World):number {
  const e=w.economy;
  return w.residents.reduce((sum,r)=>sum+r.coins,0)+w.estates.reduce((sum,s)=>sum+s.coins,0)
    +(w.foreignTrade?.merchants.reduce((sum,m)=>sum+m.person.coins,0)??0)
    +(e?e.treasury+Object.values(e.escrows).reduce((s,n)=>s+n,0)+e.businesses.reduce((s,b)=>s+b.coins,0):0);
}
export function salesLevy(w:World,price:number,payer?:string):number {
  const policy=w.civic?.salesTax;
  if(!policy||policy.expiresAt<=w.minute)return 0;
  return salesLevyForPolicy(w,price,payer,policy.proposalId,policy.basisPoints);
}
function carriedLevy(w:World,payer:string|undefined,policyId:string):number {
  if(!payer)return 0;
  const current=w.economy?.levyCarries?.[policyId]?.[payer];
  if(current!==undefined)return current;
  const stored=payer?w.economy?.taxRemainders?.[payer]:undefined;
  return stored?.policyId===policyId?stored.remainder:0;
}
/** Delivered cross-town contracts retain their signed levy; both markets share the same fractional carry. */
export function salesLevyForPolicy(w:World,price:number,payer:string|undefined,policyId:string,rate:number):number {
  return Math.floor((price*rate+carriedLevy(w,payer,policyId))/10000);
}
export function commitLevyForPolicy(w:World,price:number,payer:string,policyId:string,rate:number):void {
  if(!w.economy||rate===0)return;
  const remainder=(price*rate+carriedLevy(w,payer,policyId))%10000;
  const policies=w.economy.levyCarries??={};
  const payers=policies[policyId]??={};payers[payer]=remainder;
  (w.economy.taxRemainders??={})[payer]={policyId,remainder};
}
function commitLevy(w:World,price:number,payer:string):void {
  const policy=w.civic?.salesTax;if(!policy||policy.expiresAt<=w.minute)return;
  commitLevyForPolicy(w,price,payer,policy.proposalId,policy.basisPoints);
}
function reserveLevy(w:World,price:number):number {
  const policy=w.civic?.salesTax;
  return policy&&policy.expiresAt>w.minute?Math.ceil(price*policy.basisPoints/10000):0;
}
function place(w:World,b:Business):Building|undefined{return w.buildings.find(p=>p.id===b.buildingId&&p.condition>0);}
function usablePlace(w:World,r:Resident,b:Building):boolean {
  return b.condition>0&&premisesBusinessRight(w,r.id,b)&&['home','store','workshop'].includes(b.kind);
}
function ownerPresent(w:World,b:Business):boolean {
  const owner=w.residents.find(r=>r.id===b.ownerId),building=place(w,b);
  return !!owner&&!!building&&owner.status==='alive'&&owner.residency!=='outside'&&premisesBusinessRight(w,owner.id,building)&&b.closedAt===null;
}
function businessFor(w:World,a:EconomyAction):Business|undefined {
  if(a.listingId){const listing=w.economy?.listings.find(l=>l.id===a.listingId);return w.economy?.businesses.find(b=>b.id===listing?.businessId);}
  return w.economy?.businesses.find(b=>b.id===a.businessId);
}
export function economyReason(w:World,r:Resident,a:EconomyAction):string|null {
  if(w.mode!=='formal'||!w.economy||!active(r)||ageYears(r.bornAt,w.minute)<18)return '本人当前不能经营或签订交易';
  if(a.operation==='open'){
    const building=w.buildings.find(b=>b.id===a.buildingId);
    if(!building||!usablePlace(w,r,building)||!r.knownBuildings.includes(building.id))return '须在本人自有或有效租约允许的住宅、店面或工坊设摊';
    if(w.economy.businesses.some(b=>b.ownerId===r.id&&b.closedAt===null))return '请先经营或关闭已有商铺';
    return null;
  }
  const b=businessFor(w,a);
  if(b&&a.buildingId!==undefined&&a.buildingId!==b.buildingId)return '商铺地点已改变，须重新决定';
  if(b&&activeBusinessRelocation(w,b.id)&&['stock','list','order'].includes(a.operation))return '迁址期间停止新增旧址库存与交易承诺，既有订单仍按原址处理';
  if(b&&b.closedAt!==null&&a.operation==='retrieve'&&b.ownerId===r.id&&w.buildings.some(p=>p.id===b.buildingId)&&r.knownBuildings.includes(b.buildingId))return a.item&&integer(a.quantity,1,100)&&(b.inventory[a.item]??0)>=a.quantity?null:'原店尚存实物不足';
  if(!b||!ownerPresent(w,b))return '商铺已停业或当前产权不适用';
  if(a.operation!=='buy'&&a.operation!=='fulfill'&&b.ownerId!==r.id)return '只能管理自己的商铺';
  if(!r.knownBuildings.includes(b.buildingId))return '本人尚未知道该商铺地点';
  if(a.operation==='fund'||a.operation==='withdraw'){
    if(!integer(a.amount,1,10000))return '钱款须为 1 至 10000 的整数';
    return (a.operation==='fund'?r.coins:b.coins)>=a.amount?null:'可用钱款不足';
  }
  if(a.operation==='stock'||a.operation==='retrieve'||a.operation==='list'||a.operation==='order'){
    if(!a.item||!Object.hasOwn(itemNames,a.item)||!integer(a.quantity,1,100))return '货物种类或数量无效';
    const inventory=a.operation==='stock'?r.inventory:b.inventory;
    if(a.operation!=='order'&&amount(inventory,a.item)<a.quantity)return '实际库存不足';
    if((a.operation==='list'||a.operation==='order')&&(!integer(a.price,1,1000)||w.economy.listings.filter(l=>l.businessId===b.id&&l.status==='open').length>=12))return '报价须为每份 1 至 1000，且同时至多十二项';
    if(a.operation==='order'){
      const rate=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
      if(!integer(a.maximumLevyBasisPoints,0,1500)||rate>a.maximumLevyBasisPoints)return '公共附加款已高于本人报价时同意的比例，须重新决定预付款';
    }
    if(a.operation==='order'&&b.coins<a.price!*a.quantity+reserveLevy(w,a.price!*a.quantity))return '商铺尚无足够资金预存货款与公共附加款';
    return null;
  }
  if(a.operation==='cancel'||a.operation==='buy'||a.operation==='fulfill'){
    const l=w.economy.listings.find(l=>l.id===a.listingId);
    if(!l||l.status!=='open'||l.expiresAt<=w.minute)return '这项报价已经结束';
    if(a.operation==='cancel')return null;
    if(b.ownerId===r.id)return '不能与自己的商铺虚构交易';
    if(a.buildingId!==undefined&&a.buildingId!==b.buildingId)return '商铺地点已改变，须亲自重新查看报价';
    if(a.item!==undefined&&a.item!==l.item)return '报价货物已经改变，须重新决定';
    const quote=marketTradeQuote(w,r,a,b,l);
    return typeof quote==='string'?quote:null;
  }
  return a.operation==='close'?null:'未知经营行动';
}
/** Expired lots never count as stock, even when a caller has not stepped the clock yet. */
function freshQuantity(w:World,container:string,item:Item,quantity:number):number {
  const expired=(w.food?.lots[container]?.[item]??[]).filter(l=>l.expiresAt<=w.minute).reduce((n,l)=>n+l.quantity,0);
  return Math.max(0,Math.floor(quantity-expired));
}
interface TradeQuote {quantity:number;gross:number;tax:number;minimumQuantity:number;}
function marketTradeQuote(w:World,r:Resident,a:EconomyAction,b:Business,l:MarketListing):TradeQuote|string {
  if(!integer(a.quantity,1,100)||!integer(l.quantity,0,100)||!integer(l.price,1,1000))return '报价或成交数量无效';
  const minimum=a.minimumQuantity??a.quantity;
  if(!integer(minimum,1,a.quantity))return '最低接受数量须为不超过原数量的正整数';
  const purchase=a.operation==='fulfill';
  if(purchase&&(l.side!=='purchase'||!l.escrowId))return '不是已预付资金的收购单';
  if(!purchase&&l.side!=='sale')return '这项是收购报价';
  const held=purchase?amount(r.inventory,l.item):l.quantity;
  if(!Number.isFinite(held)||held<0)return '实际库存无效';
  const available=freshQuantity(w,purchase?'person:'+r.id:'listing:'+l.id,l.item,held);
  const quantity=Math.min(a.quantity,l.quantity,available);
  if(quantity<minimum)return '实际可交付余量低于本人同意的最低数量；须重新决定或退出';
  const gross=l.price*quantity,payer=purchase?'business:'+b.id:'resident:'+r.id,tax=salesLevy(w,gross,payer);
  if(!integer(tax,0))return '现行公共附加款无效';
  if(purchase){
    if(!integer(a.minTotal,1)||gross<a.minTotal)return '实际到手货款低于本人同意的最低总额，须重新决定';
    const rate=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
    if(rate>(l.taxBasisPoints??0))return '公共附加款高于店主这份收购单原先同意的比例，须待本人重新报价';
    if(accountBalance(w,l.escrowId!)<gross+tax)return '预存款不足以支付实际货款与附加款，须重新报价';
  }else{
    if(!integer(a.maxTotal,1)||gross+tax>a.maxTotal)return '货款与公共附加款已高于本人看见并同意的总价，须重新决定';
    if(r.coins<gross+tax)return '本人钱款不足以支付货款和现行交易附加款';
    if(!Number.isSafeInteger(b.sales+quantity)||!Number.isSafeInteger(b.revenue+gross))return '商铺累计账目超出有效范围';
  }
  const destination=purchase?b.inventory:r.inventory;
  if(!Number.isFinite(amount(destination,l.item))||amount(destination,l.item)<0||amount(destination,l.item)+quantity>Number.MAX_SAFE_INTEGER)return '收货库存超出有效范围';
  return {quantity,gross,tax,minimumQuantity:minimum};
}
interface CoinMove {from:string;to:string;amount:number;reason:string;reference:string;}
/** Validate all legs against projected balances before the synchronous settlement mutates anything. */
function marketPaymentsReady(w:World,moves:CoinMove[]):boolean {
  const balances=new Map<string,number>();
  for(const move of moves){
    if(!integer(move.amount,0)||!move.reference||move.reference.length>300||firstReceipt(w,`coin:${JSON.stringify(move.reference)}`))return false;
    for(const id of [move.from,move.to])if(!balances.has(id)){
      const a=account(w,id);if(!a||!Number.isSafeInteger(a.get())||a.get()<0)return false;
      balances.set(id,a.get());
    }
    if(balances.get(move.from)!<move.amount||!Number.isSafeInteger(balances.get(move.to)!+move.amount))return false;
    balances.set(move.from,balances.get(move.from)!-move.amount);balances.set(move.to,balances.get(move.to)!+move.amount);
  }
  return true;
}
/** Price information is local. An existing proprietor may return to their own registered stall. */
export function economyTarget(w:World,r:Resident,a:EconomyAction):{target:Vec;duration:number;error?:string} {
  const error=economyReason(w,r,a);if(error)return {target:r.at,duration:0,error};
  const b=businessFor(w,a),building=w.buildings.find(p=>p.id===(a.operation==='open'?a.buildingId:b?.buildingId))!;
  if((a.operation==='buy'||a.operation==='fulfill')&&(distance(r.at,building.door)>8||r.inside!==null&&r.inside!==building.id))return {target:r.at,duration:0,error:'须先亲自来到店前看见现有报价'};
  return {target:{...building.door},duration:a.operation==='open'?20:a.operation==='stock'||a.operation==='retrieve'?5:3};
}
function returnListingAtomic(w:World,l:MarketListing,status:'cancelled'|'expired'){
  const b=w.economy!.businesses.find(b=>b.id===l.businessId)!;
  if(l.status!=='open')return;
  if(l.side==='purchase'){
    const balance=l.escrowId?accountBalance(w,l.escrowId):0;
    if(balance&&!moveCoins(w,l.escrowId!,`business:${b.id}`,balance,'收购余款退回',`order-return:${l.id}`))throw new Error('order_return_failed');
  }else add(b.inventory,l.item,l.quantity);
  l.quantity=0;l.status=status;
}
function closeBusinessAtomic(w:World,b:Business,reason:string,actor?:Resident){
  if(b.closedAt!==null)return;
  for(const listing of w.economy!.listings.filter(l=>l.businessId===b.id))returnListing(w,listing,'cancelled');
  const owner=w.residents.find(r=>r.id===b.ownerId);
  const estate=w.estates.find(e=>e.personId===b.ownerId);
  const recipient=owner?.status==='dead'?estate:owner;
  if(owner?.status==='dead'&&!w.buildings.some(p=>p.id===b.buildingId))return;
  if(!recipient)return; // Keep unclaimed property protected in its separate account.
  if(b.coins&&!moveCoins(w,`business:${b.id}`,owner?.status==='dead'?`estate:${b.ownerId}`:`resident:${b.ownerId}`,b.coins,'经营清算',`close:${b.id}`))return;
  if(owner?.status==='dead'){const stock=estateStock(w,b.ownerId,'business:'+b.id,estateBuildingLocation(w,b.buildingId,'原商铺封存余货'))!;deposit(stock,b.inventory);b.inventory={};}else if(actor&&owner&&!owner.inside&&place(w,b)&&same(owner.at,place(w,b)!.door)){deposit(owner.inventory,b.inventory);b.inventory={};}b.closedAt=w.minute;
  if(owner)(actor?emitEvent:emitLedgerEvent)(w,{kind:'trade',actors:[owner.id],place:place(w,b)?.door??owner.at,
    witnesses:owner.residency==='outside'?[]:undefined,text:`${b.name}${reason}，${owner.status==='dead'?'余货与资金进入受保护遗产，实物仍在原址':`资金归还经营者，${Object.values(b.inventory).some(n=>n!>0)?'余货仍在原址，须本人另行领取':'余货已由本人实际领取'}`}。`});
}
/** Closed shops still own their original goods; closure is not abandonment or succession. */
export function hasBusinessEstateAssets(w:World,id:string):boolean {
  return !!w.economy?.businesses.some(b=>b.ownerId===id&&(b.closedAt===null||b.coins>0||Object.values(b.inventory).some(n=>n!>0)
    ||w.economy!.listings.some(l=>l.businessId===b.id&&(l.status==='open'||!!l.escrowId&&accountBalance(w,l.escrowId)>0))));
}
function protectClosedBusiness(w:World,b:Business):void {
  const owner=w.residents.find(r=>r.id===b.ownerId),estate=w.estates.find(e=>e.personId===b.ownerId);
  if(b.closedAt===null||owner?.status!=='dead'||!estate)return;
  // Return each old quotation first, in its own food transaction. Then seal its stock.
  for(const l of w.economy!.listings.filter(l=>l.businessId===b.id&&l.status==='open'))returnListing(w,l,'cancelled');
  const goods=Object.values(b.inventory).some(n=>n!>0),coins=b.coins;
  if(!goods&&!coins)return;
  // A missing site cannot justify inventing a different physical location.
  if(!w.buildings.some(p=>p.id===b.buildingId))return;
  foodTransaction(w,()=>{
    if(coins&&!moveCoins(w,`business:${b.id}`,`estate:${b.ownerId}`,coins,'停业经营财产保全',`closed-estate:${b.id}:${w.economy!.nextSerial}`))return;
    const source=(w.production?.inheritances[b.ownerId]?'business-supplement:':'business:')+b.id,stock=estateStock(w,b.ownerId,source,estateBuildingLocation(w,b.buildingId,'原停业商铺封存余货'))!;
    if(goods){
      routeFood(w,'business:'+b.id,'estate-stock:'+b.ownerId+':'+source,b.inventory);deposit(stock,b.inventory);b.inventory={};
    }
    estate.status='protected';
    emitLedgerEvent(w,{kind:'trade',actors:[owner.id],place:w.buildings.find(p=>p.id===b.buildingId)?.door??owner.at,
      text:`${b.name}停业后仍属原经营者的余货与资金纳入其受保护遗产，实物保留原址，尚未交给继承人或场所产权人。`});
  });
}
/** Changes only contracts' physical validity; no new merchant or purchaser is invented. */
export function advanceEconomy(w:World):void {
  initializeEconomy(w);const e=w.economy;if(!e)return;
  for(const r of w.residents)if(!e.knownResidents.includes(r.id)){
    e.knownResidents.push(r.id);e.externalCoins+=r.coins;
  }
  for(const l of e.listings)if(l.status==='open'&&l.expiresAt<=w.minute)returnListing(w,l,'expired');
  for(const b of e.businesses)if(b.closedAt===null&&!ownerPresent(w,b))closeBusiness(w,b,'因经营者离开、失能或场所不可用而停业');
  for(const b of e.businesses)protectClosedBusiness(w,b);
  // Closed quotations remain in the town event ledger; the active observer state stays bounded.
  if(e.listings.length>240)e.listings=e.listings.filter((l,i)=>l.status==='open'||i>=e.listings.length-120);
  for(const [id,balance]of Object.entries(e.escrows))if(balance===0)delete e.escrows[id];
  // Expired policies can still belong to signed deliveries. Keep their fractional tax
  // carry until those rights settle; discard only policies no longer usable anywhere.
  const retainedPolicies=new Set<string>();
  if(w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute)retainedPolicies.add(w.civic.salesTax.proposalId);
  for(const offer of w.foreignTrade?.offers??[])if(offer.status==='open'&&offer.taxPolicyId)retainedPolicies.add(offer.taxPolicyId);
  for(const shipment of w.foreignTrade?.shipments??[])if(!['completed','cancelled'].includes(shipment.status)&&shipment.taxPolicyId)retainedPolicies.add(shipment.taxPolicyId);
  for(const id of Object.keys(e.levyCarries??{}))if(!retainedPolicies.has(id))delete e.levyCarries![id];
  for(const [payer,carry]of Object.entries(e.taxRemainders??{}))if(!retainedPolicies.has(carry.policyId))delete e.taxRemainders![payer];
  if(e.businesses.length>240){
    const referenced=new Set(e.listings.map(l=>l.businessId));
    for(const contract of w.employment?.contracts??[])if(contract.status==='active'||accountBalance(w,contract.account)>0||contract.batch)referenced.add(contract.businessId);
    for(const post of w.employment?.posts??[])if(post.status==='open'||post.status==='offered')referenced.add(post.businessId);
    for(const entry of e.ledger)for(const account of [entry.from,entry.to])if(account.startsWith('business:'))referenced.add(account.slice(9));
    e.businesses=e.businesses.filter((b,i)=>b.closedAt===null||b.coins!==0||Object.values(b.inventory).some(n=>n!>0)||referenced.has(b.id)||i>=e.businesses.length-120);
    for(const id of Object.keys(e.taxRemainders??{}))if(id.startsWith('business:')&&!e.businesses.some(b=>b.id===id.slice(9)))delete e.taxRemainders![id];
  }
}
function completeEconomyAtomic(w:World,r:Resident,a:EconomyAction):string|null {
  const reference=`economy-action:${r.activity?.planId??r.plan?.id??`${r.id}:${r.revision}:${w.revision}`}:${r.activity?.startedAt??w.minute}:${a.operation}`;
  const receipt=`done:${reference}`,trade=a.operation==='buy'||a.operation==='fulfill';
  const contractNamespace=`market-contract:${r.id}:${reference}`;
  const contractReceipt=contractNamespace+':'+JSON.stringify([a.operation,a.listingId,a.item,a.buildingId,a.quantity,a.minimumQuantity??a.quantity,a.maxTotal,a.minTotal]);
  if(trade){const prior=firstReceipt(w,contractNamespace);if(prior)return prior===contractReceipt?null:'同一成交决定不能更换约定后重复结算';}
  if(hasReceipt(w,receipt))return null;
  const error=economyReason(w,r,a);if(error)return error;
  const e=w.economy!,b=businessFor(w,a),building=w.buildings.find(p=>p.id===(a.operation==='open'?a.buildingId:b?.buildingId))!;
  if(!same(r.at,building.door)||trade&&r.inside!==null)return '须实际到达店前交货、付款或经营';
  const record=(text:string,actors=[r.id])=>emitEvent(w,{kind:'trade',actors,place:{...building.door},text});
  switch(a.operation){
    case 'open':{
      const name=a.name?.trim().slice(0,24)||`${r.name}的小铺`;
      const business:Business={id:`shop-${e.nextSerial++}`,ownerId:r.id,buildingId:building.id,name,openedAt:w.minute,closedAt:null,coins:0,inventory:{},sales:0,revenue:0};
      e.businesses.push(business);record(`${r.name}自行在${building.name}开设${name}，资金与货物由其另行投入。`);break;
    }
    case 'fund':case 'withdraw':{
      const from=a.operation==='fund'?`resident:${r.id}`:`business:${b!.id}`,to=a.operation==='fund'?`business:${b!.id}`:`resident:${r.id}`;
      if(!moveCoins(w,from,to,a.amount!,'经营资金',reference))return '资金划转未完成';
      record(`${r.name}${a.operation==='fund'?'向商铺投入':'从商铺取回'} ${a.amount} 钱。`);break;
    }
    case 'stock':case 'retrieve':{
      const source=a.operation==='stock'?r.inventory:b!.inventory,target=a.operation==='stock'?b!.inventory:r.inventory;
      add(source,a.item!,-a.quantity!);add(target,a.item!,a.quantity!);
      record(`${r.name}${a.operation==='stock'?'向商铺送入':'从商铺领回'} ${a.quantity} 份${itemNames[a.item!]}。`);break;
    }
    case 'list':case 'order':{
      const id=`listing-${e.nextSerial++}`,purchase=a.operation==='order',escrowId=`escrow:order-${id}`;
      if(purchase){
        const gross=a.price!*a.quantity!;
        if(!moveCoins(w,`business:${b!.id}`,escrowId,gross+reserveLevy(w,gross),'预付收购货款',reference))return '收购预付款不足';
      }else add(b!.inventory,a.item!,-a.quantity!);
      e.listings.push({id,side:purchase?'purchase':'sale',...(purchase?{escrowId,taxBasisPoints:a.maximumLevyBasisPoints}:{}),businessId:b!.id,item:a.item!,quantity:a.quantity!,originalQuantity:a.quantity!,price:a.price!,postedAt:w.minute,expiresAt:w.minute+7*DAY,status:'open'});
      record(`${r.name}在${b!.name}${purchase?'发布收购':'上架'} ${a.quantity} 份${itemNames[a.item!]}，自行定价每份 ${a.price} 钱，${purchase?'货款已预存，等其他人自主接单交货':'实物已留在店中'}。`);break;
    }
    case 'cancel':returnListing(w,e.listings.find(l=>l.id===a.listingId)!,'cancelled');record(`${r.name}撤下自己的报价，余货回到商铺库存。`);break;
    case 'buy':case 'fulfill':{
      const l=e.listings.find(l=>l.id===a.listingId)!,quote=marketTradeQuote(w,r,a,b!,l);
      if(typeof quote==='string')return quote;
      const {quantity,gross,tax,minimumQuantity}=quote,purchase=a.operation==='fulfill';
      const from=purchase?l.escrowId!:`resident:${r.id}`,to=purchase?`resident:${r.id}`:`business:${b!.id}`;
      const moves:CoinMove[]=[{from,to,amount:gross,reason:purchase?'居民接单交货':'商品销售',reference:reference+(purchase?':delivery':':sale')}];
      if(tax)moves.push({from,to:'treasury',amount:tax,reason:'交易公共附加款',reference:reference+':levy'});
      const refund=purchase&&l.quantity===quantity?accountBalance(w,from)-gross-tax:0;
      if(refund)moves.push({from,to:`business:${b!.id}`,amount:refund,reason:'收购余款退回',reference:`order-return:${l.id}`});
      if(!marketPaymentsReady(w,moves))return '成交账户或收据已改变，钱货未转移，须重新核对';
      // No awaits, callbacks, or unvalidated payment legs occur after this point.
      for(const move of moves)if(!moveCoins(w,move.from,move.to,move.amount,move.reason,move.reference))throw new Error('market_preflight_invariant_failed');
      commitLevy(w,gross,purchase?`business:${b!.id}`:`resident:${r.id}`);
      if(purchase){routeFood(w,'person:'+r.id,'business:'+b!.id,{[l.item]:quantity});add(r.inventory,l.item,-quantity);add(b!.inventory,l.item,quantity);}
      else{routeFood(w,'listing:'+l.id,'person:'+r.id,{[l.item]:quantity});add(r.inventory,l.item,quantity);b!.sales+=quantity;b!.revenue+=gross;}
      l.quantity-=quantity;if(!l.quantity)l.status='sold';
      const trades=e.trades??=[];
      trades.push({id:reference,at:w.minute,actorId:r.id,businessId:b!.id,listingId:l.id,buildingId:building.id,operation:a.operation,item:l.item,requestedQuantity:a.quantity!,minimumQuantity,quantity,unitPrice:l.price,gross,levy:tax,...(purchase?{minTotal:a.minTotal}:{maxTotal:a.maxTotal})});
      if(trades.length>120)trades.splice(0,trades.length-120);
      w.processed.push(contractReceipt);
      record(`${r.name}在${b!.name}${purchase?'实际交付':'买下'} ${quantity} 份${itemNames[l.item]}，${quantity<a.quantity! ? `按事前同意至少 ${minimumQuantity} 份，从原拟 ${a.quantity} 份部分成交，` : ''}${purchase?'领取':'支付'}货款 ${gross} 钱${tax?`，${purchase?'商铺':'买方'}另缴 ${tax} 钱公共附加款`:''}（${purchase?'最低到手':'最高总支出'} ${purchase?a.minTotal:a.maxTotal} 钱）。`,[r.id,b!.ownerId]);break;
    }
    case 'close':closeBusiness(w,b!,'由经营者自行结束营业',r);break;
  }
  if(!trade)w.processed.push(receipt);r.revision++;return null;
}

export function completeEconomy(w:World,r:Resident,a:EconomyAction):string|null{
  if(a.operation==='buy'||a.operation==='fulfill')advanceFood(w);
  return foodTransaction(w,()=>completeEconomyAtomic(w,r,a));
}

function returnListing(w:World,l:MarketListing,status:'cancelled'|'expired'):void{return foodTransaction(w,()=>returnListingAtomic(w,l,status));}

function closeBusiness(w:World,b:Business,reason:string,actor?:Resident):void{return foodTransaction(w,()=>closeBusinessAtomic(w,b,reason,actor));}
