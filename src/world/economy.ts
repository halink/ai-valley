import {firstReceipt,hasReceipt} from './receipts.js';
import {estateStock,estateBuildingLocation} from './estate-custody.js';
import {foodTransaction} from './food.js';
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
  return b.condition>0&&b.ownerId===r.id&&['home','store','workshop'].includes(b.kind);
}
function ownerPresent(w:World,b:Business):boolean {
  const owner=w.residents.find(r=>r.id===b.ownerId),building=place(w,b);
  return !!owner&&!!building&&owner.status==='alive'&&owner.residency!=='outside'&&building.ownerId===owner.id&&b.closedAt===null;
}
function businessFor(w:World,a:EconomyAction):Business|undefined {
  if(a.listingId){const listing=w.economy?.listings.find(l=>l.id===a.listingId);return w.economy?.businesses.find(b=>b.id===listing?.businessId);}
  return w.economy?.businesses.find(b=>b.id===a.businessId);
}
export function economyReason(w:World,r:Resident,a:EconomyAction):string|null {
  if(w.mode!=='formal'||!w.economy||!active(r)||ageYears(r.bornAt,w.minute)<18)return '本人当前不能经营或签订交易';
  if(a.operation==='open'){
    const building=w.buildings.find(b=>b.id===a.buildingId);
    if(!building||!usablePlace(w,r,building)||!r.knownBuildings.includes(building.id))return '须在本人已有产权的住宅、店面或工坊设摊';
    if(w.economy.businesses.some(b=>b.ownerId===r.id&&b.closedAt===null))return '请先经营或关闭已有商铺';
    return null;
  }
  const b=businessFor(w,a);if(b&&b.closedAt!==null&&a.operation==='retrieve'&&b.ownerId===r.id&&w.buildings.some(p=>p.id===b.buildingId)&&r.knownBuildings.includes(b.buildingId))return a.item&&integer(a.quantity,1,100)&&(b.inventory[a.item]??0)>=a.quantity?null:'原店尚存实物不足';
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
    if(!integer(a.quantity,1,100)||l.quantity<a.quantity)return '实物余量不足';
    if(a.operation==='fulfill'){
      if(l.side!=='purchase'||!l.escrowId)return '不是已预付资金的收购单';
      if(amount(r.inventory,l.item)<a.quantity)return '本人未携带足够的实际货物';
      const rate=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
      if(rate>(l.taxBasisPoints??0))return '公共附加款高于店主这份收购单原先同意的比例，须待本人重新报价';
      const cost=l.price*a.quantity;
      return accountBalance(w,l.escrowId)>=cost+salesLevy(w,cost,`business:${b.id}`)?null:'现行附加款变化后预存款不足，请经营者重新报价';
    }
    if(l.side!=='sale')return '这项是收购报价';
    const cost=l.price*a.quantity;
    const total=cost+salesLevy(w,cost,`resident:${r.id}`);
    if(!integer(a.maxTotal,1)||total>a.maxTotal)return '货款与公共附加款已高于本人看见并同意的总价，须重新决定';
    return r.coins>=total?null:'本人钱款不足以支付货款和现行交易附加款';
  }
  return a.operation==='close'?null:'未知经营行动';
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
  if(!recipient)return; // Keep unclaimed property protected in its separate account.
  if(b.coins&&!moveCoins(w,`business:${b.id}`,owner?.status==='dead'?`estate:${b.ownerId}`:`resident:${b.ownerId}`,b.coins,'经营清算',`close:${b.id}`))return;
  if(owner?.status==='dead'){const stock=estateStock(w,b.ownerId,'business:'+b.id,estateBuildingLocation(w,b.buildingId,'原商铺封存余货'))!;deposit(stock,b.inventory);b.inventory={};}else if(owner&&!owner.inside&&place(w,b)&&same(owner.at,place(w,b)!.door)){deposit(owner.inventory,b.inventory);b.inventory={};}b.closedAt=w.minute;
  if(owner)(actor?emitEvent:emitLedgerEvent)(w,{kind:'trade',actors:[owner.id],place:place(w,b)?.door??owner.at,
    witnesses:owner.residency==='outside'?[]:undefined,text:`${b.name}${reason}，余货和资金${owner.status==='dead'?'转入受保护的遗产':'归还经营者本人'}。`});
}
/** Changes only contracts' physical validity; no new merchant or purchaser is invented. */
export function advanceEconomy(w:World):void {
  initializeEconomy(w);const e=w.economy;if(!e)return;
  for(const r of w.residents)if(!e.knownResidents.includes(r.id)){
    e.knownResidents.push(r.id);e.externalCoins+=r.coins;
  }
  for(const l of e.listings)if(l.status==='open'&&l.expiresAt<=w.minute)returnListing(w,l,'expired');
  for(const b of e.businesses)if(b.closedAt===null&&!ownerPresent(w,b))closeBusiness(w,b,'因经营者离开、失能或场所不可用而停业');
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
  const error=economyReason(w,r,a);if(error)return error;
  const e=w.economy!,b=businessFor(w,a),building=w.buildings.find(p=>p.id===(a.operation==='open'?a.buildingId:b?.buildingId))!;
  if(!same(r.at,building.door))return '须实际到达店前交货、付款或经营';
  const reference=`economy-action:${r.activity?.planId??r.plan?.id??`${r.id}:${r.revision}:${w.revision}`}:${r.activity?.startedAt??w.minute}:${a.operation}`;
  const receipt=`done:${reference}`;if(hasReceipt(w,receipt))return null;
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
    case 'buy':{
      const l=e.listings.find(l=>l.id===a.listingId)!;const gross=l.price*a.quantity!,tax=salesLevy(w,gross,`resident:${r.id}`);
      // Synchronous preflight makes payment, levy and physical delivery one authoritative action.
      if(r.coins<gross+tax)return '付款时钱款不足';
      if(!moveCoins(w,`resident:${r.id}`,`business:${b!.id}`,gross,'商品销售',reference+':sale'))return '货款划转未完成';
      if(tax&&!moveCoins(w,`resident:${r.id}`,'treasury',tax,'交易公共附加款',reference+':levy'))throw new Error('sales_levy_transaction_failed');
      commitLevy(w,gross,`resident:${r.id}`);
      l.quantity-=a.quantity!;if(!l.quantity)l.status='sold';add(r.inventory,l.item,a.quantity!);b!.sales+=a.quantity!;b!.revenue+=gross;
      record(`${r.name}按${b!.name}的公开报价买下 ${a.quantity} 份${itemNames[l.item]}，支付 ${gross} 钱${tax?`，另按居民议决缴 ${tax} 钱公共附加款`:''}。`,[r.id,b!.ownerId]);break;
    }
    case 'fulfill':{
      const l=e.listings.find(l=>l.id===a.listingId)!,gross=l.price*a.quantity!,tax=salesLevy(w,gross,`business:${b!.id}`);
      if(!moveCoins(w,l.escrowId!,`resident:${r.id}`,gross,'居民接单交货',reference+':delivery'))return '预付货款不足';
      if(tax&&!moveCoins(w,l.escrowId!,'treasury',tax,'交易公共附加款',reference+':levy'))throw new Error('order_levy_transaction_failed');
      commitLevy(w,gross,`business:${b!.id}`);
      add(r.inventory,l.item,-a.quantity!);add(b!.inventory,l.item,a.quantity!);l.quantity-=a.quantity!;
      if(!l.quantity){
        const balance=accountBalance(w,l.escrowId!);
        if(balance&&!moveCoins(w,l.escrowId!,`business:${b!.id}`,balance,'收购余款退回',`order-return:${l.id}`))throw new Error('order_change_return_failed');
        l.status='sold';
      }
      record(`${r.name}自主接下${b!.name}的收购单，实际交付 ${a.quantity} 份${itemNames[l.item]}，领取预存货款 ${gross} 钱${tax?`，商铺另缴 ${tax} 钱公共附加款`:''}。`,[r.id,b!.ownerId]);break;
    }
    case 'close':closeBusiness(w,b!,'由经营者自行结束营业',r);break;
  }
  w.processed.push(receipt);r.revision++;return null;
}

export function completeEconomy(w:World,r:Resident,a:EconomyAction):string|null{return foodTransaction(w,()=>completeEconomyAtomic(w,r,a));}

function returnListing(w:World,l:MarketListing,status:'cancelled'|'expired'):void{return foodTransaction(w,()=>returnListingAtomic(w,l,status));}

function closeBusiness(w:World,b:Business,reason:string,actor?:Resident):void{return foodTransaction(w,()=>closeBusinessAtomic(w,b,reason,actor));}
