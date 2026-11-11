import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {FerryAction,FerryCargo,FerryTrip} from '../shared/ferry.js';
import type {ForeignShipment} from '../shared/foreign-trade.js';
import {itemLabels} from '../shared/items.js';
import {accountBalance,moveCoins} from './economy.js';
import {emitEvent} from './events.js';
import {distance,same} from './navigation.js';
import {berth} from './water-route.js';
import {ageYears} from './time.js';

export const cargoUnits=(quantity:number)=>Math.ceil(quantity/10);
export const activeCargo=(c:FerryCargo)=>!['released','cancelled'].includes(c.status);
export const occupiedFerryCapacity=(t:FerryTrip)=>t.seats.filter(s=>!['withdrawn','landed'].includes(s.status)).length+(t.cargo??[]).filter(c=>['accepted','aboard'].includes(c.status)).reduce((n,c)=>n+c.units,0);
export function shipmentFerry(w:World,id:string){for(const trip of w.ferries?.trips??[]){const cargo=trip.cargo?.find(c=>c.shipmentId===id&&activeCargo(c));if(cargo)return {trip,cargo};}return undefined;}
export const isCargoAction=(a:FerryAction)=>['proposeCargo','acceptCargo','rejectCargo','cancelCargo','loadCargo','unloadCargo','releaseCargo'].includes(a.operation);
const person=(w:World,id:string)=>w.residents.find(r=>r.id===id);
const adult=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const account=(w:World,id:string)=>(person(w,id)?.status==='dead'?'estate:':'resident:')+id;
const ship=(w:World,id?:string)=>w.foreignTrade?.shipments.find(s=>s.id===id);
const vessel=(w:World,t:FerryTrip)=>w.ferries!.boats.find(b=>b.id===t.boatId);
const pier=(w:World,id:string)=>berth(w,w.infrastructure?.assets.find(d=>d.id===id));
const local=(r:Resident,at:{x:number;y:number})=>!r.inside&&distance(r.at,at)<=8;
function pay(w:World,from:string,to:string,amount:number,why:string,ref:string){if(amount>0&&!moveCoins(w,from,to,amount,why,ref))throw new Error('ferry_cargo_escrow_mismatch');}
function fact(w:World,r:Resident,c:FerryCargo,text:string){emitEvent(w,{kind:'trade',actors:[r.id,c.ownerId],place:{...r.at},roomId:null,text});}
function refund(w:World,c:FerryCargo){const n=accountBalance(w,c.account);pay(w,c.account,account(w,c.ownerId),n,'未完成水运的预付运费退回原货主',c.id+':refund');c.refunded+=n;w.ferries!.totals.refunds+=n;}
function cancel(w:World,c:FerryCargo,reason:string){refund(w,c);c.status='cancelled';c.reason=reason;}
const eligible=(s:ForeignShipment)=>s.goods===s.quantity&&(s.status==='ready'&&s.side==='export'||s.status==='inTransit'&&(!s.route||['localIn','localOut','regionalIn'].includes(s.route.phase)));

/** Before loading, a cancellation only releases the booking, never changes physical cargo position. */
export function cancelUnloadedFreight(w:World,s:ForeignShipment,reason:string){const found=shipmentFerry(w,s.id);if(found&&['offered','accepted'].includes(found.cargo.status))cancel(w,found.cargo,reason);}
export function cancelTripFreight(w:World,t:FerryTrip,reason:string){for(const c of t.cargo??[])if(['offered','accepted'].includes(c.status))cancel(w,c,reason);}
export function syncFerryCargo(w:World,t:FerryTrip){const b=vessel(w,t);if(!b)return;for(const c of t.cargo??[])if(c.status==='aboard'){const s=ship(w,c.shipmentId);if(s?.route){s.route.at={...b.at};s.route.updatedAt=w.minute;s.route.progress=0;s.arrivesAt=null;}}}
export function advanceFerryCargo(w:World){for(const t of w.ferries?.trips??[])for(const c of t.cargo??[]){if(!['offered','accepted'].includes(c.status))continue;const s=ship(w,c.shipmentId);if(t.phase!=='posted'||w.minute>=t.expiresAt||person(w,c.ownerId)?.status!=='alive'||!s||!eligible(s))cancel(w,c,'装船前服务到期、撤回或原货物已不具备交付条件');}}

export function ferryCargoReason(w:World,r:Resident,a:FerryAction):string|null {
 if(!w.ferries||!w.foreignTrade||!adult(w,r))return '货运交接须由能自主决定的在谷成年人办理';
 const t=w.ferries.trips.find(t=>t.id===a.tripId),c=t?.cargo?.find(c=>c.id===a.cargoId),b=t&&vessel(w,t),on=w.ferries.trips.find(t=>t.aboard.includes(r.id));
 if(!t||!b||on&&on.id!==t.id)return '没有本人可在场办理的实际船程';
 const source=berth(w,w.infrastructure?.assets.find(d=>d.id===t.sourceId),b.dockId===t.sourceId?b.at:undefined),destination=pier(w,t.destinationId);
 if(a.operation==='proposeCargo'){
  const s=ship(w,a.shipmentId),units=s?cargoUnits(s.quantity):0;
  if(s?.publicReserveId)return '原公共储备授权不包含另议渡运和运费';
  if(on||t.phase!=='posted'||w.minute>=t.expiresAt||!source||!destination||!local(r,source.land)||!r.knownDocks?.includes(t.destinationId)||!s||s.residentId!==r.id||s.readyAt>w.minute||!eligible(s)||shipmentFerry(w,s.id)||units>t.capacity||r.coins<t.fare*units)return '须本人在起运码头为已确认的完整货物提议已知水运段，并预留运费；原买卖目的地不变';
  return null;
 }
 if(!c||!activeCargo(c))return '没有这项尚待处理的货运交接';
 const s=ship(w,c.shipmentId);if(!s)return '原货物记录缺失，不能代造实物或结算';
 if(a.operation==='acceptCargo'||a.operation==='rejectCargo')return !on&&r.id===t.operatorId&&t.phase==='posted'&&w.minute<t.expiresAt&&c.status==='offered'&&!!source&&local(r,source.land)&&(a.operation==='rejectCargo'||person(w,c.ownerId)?.status==='alive'&&eligible(s)&&occupiedFerryCapacity(t)+c.units<=t.capacity)?null:'须船主在原码头独立答复，接单时核对完整货物和客货共用余量';
 if(a.operation==='cancelCargo')return c.ownerId===r.id&&!on&&['offered','accepted'].includes(c.status)&&!!source&&local(r,source.land)?null:'货主只可在原码头撤回尚未实际装船的安排';
 if(a.operation==='loadCargo')return r.id===t.operatorId&&!on&&t.phase==='posted'&&w.minute<t.expiresAt&&c.status==='accepted'&&person(w,c.ownerId)?.status==='alive'&&eligible(s)&&!!source&&local(r,source.land)&&b.dockId===t.sourceId&&!!s.route?.at&&same(s.route.at,c.sourceAt)&&same(source.land,c.sourceAt)&&occupiedFerryCapacity(t)<=t.capacity?null:'须船主实际接收已陆运到原码头的完整货物，且船仍在原处、容量未超限';
 const site=b.dockId?berth(w,w.infrastructure?.assets.find(d=>d.id===b.dockId),b.at):null;
 if(a.operation==='unloadCargo')return c.status==='aboard'&&['posted','docked'].includes(t.phase)&&!!site&&(!!on||local(r,site.land))&&(r.id===t.operatorId||r.id===t.pilotId||r.id===c.ownerId)&&[t.sourceId,t.destinationId].includes(b.dockId!)?null:'只可由货主、原承运人或接替操船者在原约定的实际码头卸货';
 if(a.operation==='releaseCargo')return !on&&c.status==='unloaded'&&!!s.route?.at&&local(r,s.route.at)&&(r.id===c.ownerId||r.id===t.operatorId||r.id===t.pilotId)?null:'须原货主或受托承运人在真实卸货处向原陆路承运人交接';
 return '未知货运交接';
}
export function ferryCargoTarget(w:World,r:Resident,a:FerryAction){const t=w.ferries?.trips.find(t=>t.id===a.tripId),c=t?.cargo?.find(c=>c.id===a.cargoId),s=c&&ship(w,c.shipmentId),b=t&&vessel(w,t),on=t?.aboard.includes(r.id);return {target:on?{...r.at}:a.operation==='releaseCargo'?s?.route?.at??r.at:a.operation==='unloadCargo'&&b?.dockId?berth(w,w.infrastructure?.assets.find(d=>d.id===b.dockId),b.at)?.land??r.at:t?(c?.sourceAt??berth(w,w.infrastructure?.assets.find(d=>d.id===t.sourceId),b?.dockId===t.sourceId?b.at:undefined)?.land??r.at):r.at,duration:['loadCargo','unloadCargo','releaseCargo'].includes(a.operation)?10:5};}
export function completeFerryCargo(w:World,r:Resident,a:FerryAction):string|null {
 const error=ferryCargoReason(w,r,a);if(error)return error;
 const target=ferryCargoTarget(w,r,a).target;if(r.inside||!same(r.at,target))return '必须亲自抵达实际货运交接位置';
 const t=w.ferries!.trips.find(t=>t.id===a.tripId)!,b=vessel(w,t)!,c=t.cargo?.find(c=>c.id===a.cargoId);
 if(a.operation==='proposeCargo'){
  const s=ship(w,a.shipmentId)!,units=cargoUnits(s.quantity),id='freight:'+w.ferries!.nextSerial++,fee=units*t.fare,escrow='escrow:'+id;
  pay(w,account(w,r.id),escrow,fee,'货主独立预存有限水运段运费',id+':reserve');
  const next:FerryCargo={id,shipmentId:s.id,ownerId:r.id,sourceAt:{...berth(w,w.infrastructure?.assets.find(d=>d.id===t.sourceId),b.at)!.land},destinationAt:{...pier(w,t.destinationId)!.land},quantity:s.quantity,units,fee,account:escrow,status:'offered',createdAt:w.minute,acceptedAt:null,loadedAt:null,unloadedAt:null,releasedAt:null,paid:0,refunded:0,reason:null};
  (t.cargo??=[]).push(next);fact(w,r,next,`${r.name}为本人${s.quantity}份${itemLabels[s.item]}提议水运段，预存${fee}钱，占${units}格共用容量。原船主须另行同意；到约定码头卸下完整货物才付运费，返航或货损退费，货物仍按原买卖合同归属；授权承运人在卸货后实际交回原陆路承运人。`);
 }else if(a.operation==='acceptCargo'){c!.status='accepted';c!.acceptedAt=w.minute;fact(w,r,c!,`${r.name}独立接受货运交接，占用${c!.units}格客货共用容量；等待实物陆运到码头后亲自装船。`);}
 else if(a.operation==='rejectCargo'||a.operation==='cancelCargo'){cancel(w,c!,'装船前本人明确撤回或拒绝');fact(w,r,c!,'尚未装船的水运预订已结束，预付运费原路退回，货物留在实际位置并按原陆路合同继续。');}
 else {
  const s=ship(w,c!.shipmentId)!;
  if(a.operation==='loadCargo'){c!.status='aboard';c!.loadedAt=w.minute;s.route!.at={...b.at};s.route!.updatedAt=w.minute;s.route!.progress=0;s.arrivesAt=null;fact(w,r,c!,`${r.name}亲自将${s.goods}份${itemLabels[s.item]}从实际码头装船，保管责任交给船上承运人；原货款仍在买卖托管账户。`);}
  if(a.operation==='unloadCargo'){
   const site=berth(w,w.infrastructure?.assets.find(d=>d.id===b.dockId),b.at)!;c!.status='unloaded';c!.unloadedAt=w.minute;s.route!.at={...site.land};s.route!.updatedAt=w.minute;s.route!.progress=0;
   const delivered=b.dockId===t.destinationId&&!t.returned&&same(site.land,c!.destinationAt)&&s.goods===c!.quantity&&s.status==='inTransit';
   if(delivered){const n=accountBalance(w,c!.account);pay(w,c!.account,account(w,t.operatorId),n,'完整货物实际卸至约定码头后结算运费',c!.id+':delivery');c!.paid+=n;w.ferries!.totals.fares+=n;}else refund(w,c!);
   c!.reason=delivered?'完整货物已卸至约定码头':'返抵原码头、撤单或货损，未挣得运费退回';fact(w,r,c!,`${r.name}亲自在码头卸下剩余${s.goods}份${itemLabels[s.item]}；${c!.reason}。原买卖尚未据此交付，须再实际交给陆路承运人。`);
  }
  if(a.operation==='releaseCargo'){c!.status='released';c!.releasedAt=w.minute;s.route!.updatedAt=w.minute;s.route!.progress=0;fact(w,r,c!,`${r.name}在真实卸货位置把这批剩余实物交回原已授权的陆路承运人，继续原买卖交付或退运路线；没有改变货价、税率和最终交接地点。`);}
 }
 r.revision++;return null;
}
export function ferryCargoOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const choices:FormalOpportunity[]=[];const add=(label:string,a:FerryAction)=>{if(!ferryCargoReason(w,r,a))choices.push({id:`ferry.${a.operation}.${a.tripId}.${a.cargoId??a.shipmentId}`,label,action:a});};
 for(const t of w.ferries?.trips??[]){
  if(t.phase==='posted')for(const s of w.foreignTrade?.shipments.filter(s=>s.residentId===r.id)??[])add(`为本人${s.quantity}份${itemLabels[s.item]}提议此船水运段，占${cargoUnits(s.quantity)}格（每格最多10份），预存${cargoUnits(s.quantity)*t.fare}钱；船主另行同意，完整卸货才付费，返航或货损退费，保留原买卖条款并委托承运人再交陆运`,{type:'ferry',operation:'proposeCargo',tripId:t.id,shipmentId:s.id});
  for(const c of t.cargo??[])for(const [operation,label]of [['acceptCargo','独立接受此项货运，按原报价保留客货共用容量'],['rejectCargo','拒绝此项尚未装船的货运并退回预存运费'],['cancelCargo','本人撤回尚未装船的水运段，货物仍按原陆路合同继续'],['loadCargo','亲自把已到码头的货物装入实际停泊船只并承担保管'],['unloadCargo','亲自在原约定的实际码头卸货，核对实物后结算或退回运费'],['releaseCargo','在实际卸货处把货物交回原陆路承运人，继续原买卖交付或退运']] as const)add(`${label}：${person(w,c.ownerId)?.name??'原货主'}的${c.quantity}份${itemLabels[ship(w,c.shipmentId)?.item??'stone']}，${c.units}格、${c.fee}钱；原码头往返，完整卸货付费，货损或返航退费`,{type:'ferry',operation,tripId:t.id,cargoId:c.id});
 }
 return choices;
}
