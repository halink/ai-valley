import type {Building,Inventory,Resident,Resource,Vec,World} from '../shared/types.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {canObserve} from './knowledge.js';
import {distance} from './navigation.js';

export interface GateDirectory {
  hall:Pick<Building,'id'|'name'|'door'>|null;
  water:Pick<Resource,'id'|'at'>|null;
  exit:Vec;
}

/** The public gate sign lists addresses, not remote stock, beds, staff or road conditions. */
export function visibleGateDirectory(w:World,r:Resident):GateDirectory|undefined {
  if(w.mode!=='formal'||r.inside||!canObserve(w,r)||distance(r.at,w.map.entrance)>2)return;
  const hall=w.buildings.filter(b=>b.ownerId==='commons'&&b.kind==='lodge')
    .sort((a,b)=>distance(a.door,w.map.entrance)-distance(b.door,w.map.entrance)||a.id.localeCompare(b.id))[0];
  const water=w.resources.filter(p=>p.kind==='spring')
    .sort((a,b)=>distance(a.at,w.map.entrance)-distance(b.at,w.map.entrance)||a.id.localeCompare(b.id))[0];
  return {hall:hall?{id:hall.id,name:hall.name,door:{...hall.door}}:null,
    water:water?{id:water.id,at:{...water.at}}:null,exit:{...w.map.entrance}};
}

/** Called by physical observation, never by a menu or a public read. */
export function observeGateDirections(w:World,r:Resident):void {
  const sign=visibleGateDirectory(w,r);if(!sign)return;
  if(sign.hall&&!r.knownBuildings.includes(sign.hall.id))r.knownBuildings.push(sign.hall.id);
  if(sign.water&&!r.knownResources.includes(sign.water.id))r.knownResources.push(sign.water.id);
}

export function gateDirectoryNote(sign:GateDirectory):string {
  const places=[sign.hall?`${sign.hall.name}门外（${sign.hall.door.x},${sign.hall.door.y}）`:null,
    sign.water?`取水点（${sign.water.at.x},${sign.water.at.y}）`:null].filter(Boolean);
  return `谷口路牌${places.length?'标有'+places.join('、')+'的地址':'没有登记共屋或水点地址'}；归路由谷口（${sign.exit.x},${sign.exit.y}）接西南林道。路牌不承诺空床、余粮、值守人员或水量，途中是否通行须亲自核对。`;
}

const positive=(n:number|undefined)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:0;
const whole=(n:number)=>Math.floor(n+1e-9);
const foodList=(bag:Inventory)=>itemKeys.filter(i=>positive(bag[i])>0).map(i=>`${itemLabels[i]}${bag[i]}份`).join('、')||'无';

/** Only one's carried, dated physical lots are evidence. Never initialize missing dates on a read. */
export function journeySupplyNote(w:World,r:Resident,minutes:number):string {
  const current:Inventory={},later:Inventory={},unknown:Inventory={};
  for(const item of itemKeys.filter(i=>goods[i].food>0)){
    let remaining=positive(r.inventory[item]),fresh=0,surviving=0;
    if(!remaining)continue;
    const lots=[...(w.food?.lots['person:'+r.id]?.[item]??[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt);
    for(const lot of lots){
      const quantity=Math.min(remaining,positive(lot.quantity));remaining-=quantity;
      if(!Number.isFinite(lot.expiresAt)){unknown[item]=(unknown[item]??0)+quantity;continue;}
      if(lot.expiresAt>w.minute)fresh+=quantity;
      if(lot.expiresAt>w.minute+minutes)surviving+=quantity;
    }
    current[item]=whole(fresh);later[item]=whole(surviving);
    if(remaining>0)unknown[item]=(unknown[item]??0)+remaining;
  }
  return `随身已登记且当前未过期的完整食品：${foodList(current)}；只按原批次保质期、尚未食用来算，${minutes}分钟后仍未过期的完整食品：${foodList(later)}。`
    +(Object.keys(unknown).length?`另有随身食品保质期未核实：${foodList(unknown)}，不计为已核实口粮。`:'')
    +`随身清水${positive(r.inventory.water)}份。上述不是逐餐安排或旅途安全保证；本次公示未提供沿途补给或接待承诺，目的地余粮、空床与值守情况仍须到场核实。`;
}
