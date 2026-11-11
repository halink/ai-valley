import {premisesBusinessRight} from '../shared/premises.js';
import type {FormalOpportunity, Item, Resident, World} from '../shared/types.js';
import type {EconomyAction} from '../shared/economy.js';
import {economyReason, itemNames, salesLevy} from '../world/economy.js';
import {distance} from '../world/navigation.js';
import {ageYears} from '../world/time.js';
import {goods} from '../shared/items.js';

const items=Object.keys(itemNames) as Item[];
export function economyOpportunities(w:World,r:Resident):FormalOpportunity[]{
  if(!w.economy||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<18)return [];
  const choices:FormalOpportunity[]=[];
  const hungry=r.hunger>=80;
  const add=(id:string,label:string,action:EconomyAction,check=true)=>{
    if(action.operation!=='open'&&action.buildingId===undefined){const id=action.businessId??w.economy!.listings.find(l=>l.id===action.listingId)?.businessId;action.buildingId=w.economy!.businesses.find(b=>b.id===id)?.buildingId;}
    if(!check||!economyReason(w,r,action))choices.push({id:'economy.'+id,label,action});
  };
  const mine=w.economy.businesses.find(b=>b.ownerId===r.id&&b.closedAt===null);
  if(!mine){
    for(const building of w.buildings.filter(b=>premisesBusinessRight(w,r.id,b)&&['home','store','workshop'].includes(b.kind)&&r.knownBuildings.includes(b.id)))
      add('open.'+building.id,`在本人有经营权的${building.name}开一间小铺；可填写name自行取名，不会自动获得货物或资金`,{type:'economy',operation:'open',buildingId:building.id});
  }else{
    const shopPlace=w.buildings.find(p=>p.id===mine.buildingId)!;
    const atShop=shopPlace&&distance(r.at,shopPlace.door)<=8&&(r.inside===null||r.inside===shopPlace.id);
    if(!atShop){
      if(shopPlace)choices.push({id:'economy.return',label:`回自己登记的${mine.name}查看账本与货物，决定下一步经营`,action:{type:'move',to:{...shopPlace.door}}});
    }else{
    const businessId=mine.id;
    add('fund',`给自己的${mine.name}投入资金（填写amount，1–${Math.min(10000,r.coins)}钱）`,{type:'economy',operation:'fund',businessId,amount:1});
    add('withdraw',`从${mine.name}领回经营收入（填写amount，1–${Math.min(10000,mine.coins)}钱）`,{type:'economy',operation:'withdraw',businessId,amount:1});
    for(const item of items){
      if((r.inventory[item]??0)>0)add('stock.'+item,`给${mine.name}送入自有${itemNames[item]}（填写quantity，最多${Math.min(100,r.inventory[item]??0)}份）`,{type:'economy',operation:'stock',businessId,item,quantity:1});
      if((mine.inventory[item]??0)>0){
        add('list.'+item,`为店中的${itemNames[item]}定价出售（填写quantity 1–${Math.min(100,mine.inventory[item]??0)}，price为每份1–1000钱；货物留店，买家另付现行公共附加款）`,{type:'economy',operation:'list',businessId,item,quantity:1,price:1});
        add('retrieve.'+item,`领回店内未上架的${itemNames[item]}（填写quantity，最多${Math.min(100,mine.inventory[item]??0)}份）`,{type:'economy',operation:'retrieve',businessId,item,quantity:1});
      }
      const rate=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
      if(mine.coins>0)add('order.'+item,`请其他人供给${itemNames[item]}（填写quantity 1–100、price每份1–1000钱；商铺预存货款和当前${rate/100}%附加款，库存资金${mine.coins}钱，政策改变可能需撤单重报）`,{type:'economy',operation:'order',businessId,item,quantity:1,price:1,maximumLevyBasisPoints:rate});
    }
    for(const listing of w.economy.listings.filter(l=>l.businessId===mine.id&&l.status==='open').slice(0,4)){
      add('cancel.'+listing.id,`撤回${listing.side==='purchase'?'收购':'出售'}${itemNames[listing.item]}的报价（剩${listing.quantity}份，每份${listing.price}钱）`,{type:'economy',operation:'cancel',listingId:listing.id});
    }
    add('close',`结束自己的${mine.name}，取回全部余货和资金`,{type:'economy',operation:'close',businessId});
    }
  }
  for(const shop of w.economy.businesses.filter(b=>b.ownerId===r.id&&b.closedAt!==null))for(const item of items)if((shop.inventory[item]??0)>0)add('closed-stock.'+shop.id+'.'+item,`亲自回到原${shop.name}领取停业后仍留原处的${itemNames[item]}（quantity最多${Math.min(100,shop.inventory[item]!)}）`,{type:'economy',operation:'retrieve',businessId:shop.id,item,quantity:1});
  const visible=w.economy.businesses.filter(b=>b.ownerId!==r.id&&b.closedAt===null&&r.knownBuildings.includes(b.buildingId)).map(b=>({b,place:w.buildings.find(p=>p.id===b.buildingId)!})).filter(v=>v.place&&distance(v.place.door,r.at)<=8&&(r.inside===null||r.inside===v.place.id));
  for(const {b} of hungry?visible:visible.slice(0,3)){
    const listings=w.economy.listings.filter(l=>l.businessId===b.id&&l.status==='open');
    for(const listing of hungry?listings:listings.slice(0,8)){
      const purchase=listing.side==='purchase',tax=salesLevy(w,listing.price,`resident:${r.id}`);
      const available=Math.min(100,listing.quantity,purchase?Math.floor(r.inventory[listing.item]??0):100);
      const rate=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
      const estimate=available*listing.price,levy=salesLevy(w,estimate,purchase?`business:${b.id}`:`resident:${r.id}`);
      const expiry=(w.food?.lots[purchase?'person:'+r.id:'listing:'+listing.id]?.[listing.item]??[]).filter(l=>l.expiresAt>w.minute).map(l=>Math.floor(l.expiresAt-w.minute));
      const life=expiry.length?`；现有食品最早还剩${Math.min(...expiry)}游戏分钟，交接保留原批次`:'';
      add('trade.'+listing.id,purchase?
        `向${b.name}交付自有${itemNames[listing.item]}：填写quantity 1–${available}、minTotal最低到手总额（不会按部分数量自动降低）；每份${listing.price}钱，店尚收${listing.quantity}份，本人携带${r.inventory[listing.item]??0}份，${available}份预计到手${estimate}钱，店主另付现行${rate/100}%附加款约${levy}钱`+life+`。可选minimumQuantity 1–quantity，省略表示必须足量；填写较低值才同意余量不足时部分成交`:
        `在${b.name}购买${itemNames[listing.item]}：填写quantity 1–${available}、maxTotal含附加款的最高总支出；每份${listing.price}钱，现行附加款${rate/100}%，实物余${listing.quantity}份，买${available}份预计总额${estimate+levy}钱，本人可用${r.coins}钱`+life+`。可选minimumQuantity 1–quantity，省略表示必须足量；填写较低值才同意余量不足时部分成交`,
        {type:'economy',operation:purchase?'fulfill':'buy',listingId:listing.id,buildingId:b.buildingId,item:listing.item,quantity:1,...(purchase?{minTotal:listing.price}:{maxTotal:listing.price+tax})});
    }
  }
  // The owner can direct the next operation, but large stockpiles do not crowd out public work/family.
  // Keep every eligible location available to the final rotating overview.
  const openings=choices.filter(c=>c.action.type==='economy'&&c.action.operation==='open');
  const food=hungry?choices.filter(c=>c.action.type==='economy'&&['retrieve','buy'].includes(c.action.operation)&&c.action.item&&goods[c.action.item].food>0):[];
  const management=choices.filter(c=>!c.id.startsWith('economy.trade.')&&!openings.includes(c)&&!food.includes(c));
  const trade=choices.filter(c=>c.id.startsWith('economy.trade.')&&!food.includes(c));
  const groups=[...new Set(management.map(c=>(c.action as EconomyAction).operation))].map(operation=>management.filter(c=>(c.action as EconomyAction).operation===operation));
  const compact:FormalOpportunity[]=[];
  for(let i=0;compact.length<20;i++){
    let found=false;
    for(const group of groups)if(group[i]){compact.push(group[i]);found=true;if(compact.length===20)break;}
    if(!found)break;
  }
  const visits:FormalOpportunity[]=w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&distance(r.at,b.door)>8&&b.ownerId!==r.id&&['home','store','workshop'].includes(b.kind))
    .sort((a,b)=>distance(a.door,r.at)-distance(b.door,r.at)).slice(0,2).map(b=>({id:`economy.inspect.${b.id}`,label:`去已知的${b.name}门前看看，了解那里现在是否有人经营或留下报价`,action:{type:'move',to:{...b.door}}}));
  return [...food,...openings,...compact,...trade.slice(0,10),...visits];
}

export function economyNotes(w:World,r:Resident):string {
  if(!w.economy)return '';
  const owned=w.economy.businesses.find(b=>b.ownerId===r.id&&b.closedAt===null);
  const notes=[`你自己的钱款是${r.coins}钱。`];
  if(owned){
    const shopPlace=w.buildings.find(b=>b.id===owned.buildingId),atShop=shopPlace&&distance(r.at,shopPlace.door)<=8&&(r.inside===null||r.inside===shopPlace.id);
    if(!atShop)return notes.join('')+`你登记经营${owned.name}，离店时不能看到当前货物、钱款或顾客，须亲自回店查看账本。`;
    notes.push(`你在自己经营的${owned.name}查看账本与货物，店内另有${owned.coins}钱，未上架货物${Object.entries(owned.inventory).filter(([,n])=>n!>0).map(([item,n])=>`${n}份${itemNames[item as Item]}`).join('、')||'暂无'}。店中钱货需要你亲自领取或调整。`);
    const listings=w.economy.listings.filter(l=>l.businessId===owned.id&&l.status==='open');
    if(listings.length)notes.push('你已登记的报价有'+listings.slice(0,8).map(l=>`${l.side==='purchase'?'收购':'出售'}${l.quantity}份${itemNames[l.item]}，每份${l.price}钱`).join('；')+'。');
  }
  return notes.join('');
}

export function economyChoiceFields(a:EconomyAction):string[]{
  if(a.operation==='open')return ['name'];
  if(a.operation==='fund'||a.operation==='withdraw')return ['amount'];
  if(a.operation==='list'||a.operation==='order')return ['quantity','price'];
  if(a.operation==='stock'||a.operation==='retrieve')return ['quantity'];
  if(a.operation==='buy')return ['quantity','maxTotal','minimumQuantity'];
  if(a.operation==='fulfill')return ['quantity','minTotal','minimumQuantity'];
  return [];
}
/** Only fields explicitly solicited by the chosen personal action can alter its contract. */
export function parseEconomyChoice(action:EconomyAction,data:Record<string,unknown>):EconomyAction {
  const result=structuredClone(action),fields=economyChoiceFields(action);
  for(const field of fields){
    if(field==='name'){
      if(data.name!==undefined&&(typeof data.name!=='string'||!data.name.trim()||data.name.length>24))throw new Error('invalid_shop_name');
      if(typeof data.name==='string')result.name=data.name.trim();
    }else{
      if(field==='minimumQuantity'&&data[field]===undefined){delete result.minimumQuantity;continue;}
      const value=data[field],max=field==='maxTotal'||field==='minTotal'?1_000_000:field==='amount'?10000:field==='price'?1000:100;
      if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>max)throw new Error('invalid_economy_amount');
      if(field==='quantity')result.quantity=value;
      if(field==='price')result.price=value;
      if(field==='amount')result.amount=value;
      if(field==='maxTotal')result.maxTotal=value;
      if(field==='minTotal')result.minTotal=value;
      if(field==='minimumQuantity')result.minimumQuantity=value;
    }
  }
  if(result.minimumQuantity!==undefined&&result.minimumQuantity>result.quantity!)throw new Error('invalid_minimum_quantity');
  return result;
}
