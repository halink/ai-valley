import {canInspectSpring} from '../world/spring-observation.js';
import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {WaterSupplyAction} from '../shared/water-supply.js';
import {waterReceiptId,waterSupplyReason,isSurfaceWater,surfaceWaterId} from '../world/water-supply.js';
import {distance,findPath} from '../world/navigation.js';
/** Only locally inspectable stocks appear here. Distant known addresses use ordinary travel choices. */
export function waterSupplyOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!w.waterSupply)return [];
 const out:FormalOpportunity[]=[],receiptId=waterReceiptId(w,r),base={type:'waterSupply' as const,receiptId};
 const add=(a:WaterSupplyAction,label:string)=>{if(!waterSupplyReason(w,r,a))out.push({id:`waterSupply.${a.operation}.${'vesselId'in a?a.vesselId:''}.${'sourceId'in a?a.sourceId:''}.${'buildingId'in a?a.buildingId:''}.${'targetId'in a?a.targetId:''}.${a.operation==='survey'?surfaceWaterId(a.at):''}.${a.operation==='refillPublic'?a.publicVesselId:''}.${'authorizationId'in a?a.authorizationId:''}.${'giftId'in a?a.giftId:''}`,label,action:a});};
 for(const c of w.waterSupply.assistance??[]){
  if([c.beneficiaryId,c.providerId].includes(r.id))add({...base,operation:'revokeAssist',authorizationId:c.id},'撤回本人这项限时协助饮水授权或自愿参与，立即停止以后供水，不移动任何人或水');
 }
 for(const g of w.waterSupply.gifts??[]){
  if(g.donorId===r.id)add({...base,operation:'cancelVessel',giftId:g.id},'撤回本人这只具体水桶的赠送提议，归属和水量保持原状');
  if(g.recipientId===r.id){add({...base,operation:'declineVessel',giftId:g.id},'独立拒绝这项赠桶提议，不改变监护、住所或任何财产');add({...base,operation:'acceptVessel',giftId:g.id},`本人独立接受${w.residents.find(p=>p.id===g.donorId)?.name??'原桶主'}先前提议的这只6份容量桶及其中${g.amount}份安全水；须与桶主现场完成实物交接`);}
 }
 for(const p of w.residents.filter(p=>p.id!==r.id))add({...base,operation:'authorizeAssist',targetId:p.id},`本人明确授权${p.name}未来24小时最多2次，在本人行动受限且仍能安全配合时用其自有安全水协助饮用；可撤回，无自动服务或紧急越权`);
 const buildings=w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&(r.inside===b.id||r.inside===null&&distance(r.at,b.door)<=8));
 const vessels=w.waterSupply.vessels.filter(v=>v.ownerId===r.id&&v.buildingId===null),publicVessels=w.waterSupply.vessels.filter(v=>v.ownerId==='commons'&&buildings.some(b=>b.id===v.buildingId));
 for(const b of buildings){
  if(vessels.length<2)add({...base,operation:'craft',buildingId:b.id},`到${b.name}桌台用2木材、30分钟制作6份容量空水桶；不赠水`);
  for(const p of publicVessels.filter(p=>p.buildingId===b.id))add({...base,operation:'drinkPublic',buildingId:b.id,vesselId:p.id},`到${b.name}桌台饮用1份自愿捐赠的安全水（当前${p.amount}份；每人滚动24小时最多2份）；供水阶段未启用口渴`);
 }
 for(const v of vessels){
  for(const p of w.residents.filter(p=>p.id!==r.id))add({...base,operation:'offerVessel',targetId:p.id,vesselId:v.id},`向${p.name}提出赠送这只桶及其中${v.amount}份安全水，24小时内须对方独立接受且现场交接；现在不转移物资`);
  for(const c of w.waterSupply.assistance??[])if(c.providerId===r.id)add({...base,operation:'assistDrink',authorizationId:c.id,vesselId:v.id},`按${w.residents.find(p=>p.id===c.beneficiaryId)?.name??'受助者'}本人原有24小时授权，现场用自有桶中1份安全水协助饮用，当前拒绝立即停止，授权剩余${c.limit-c.used}次`);
  const quantity=Math.min(3,v.capacity-v.amount);
  add({...base,operation:'load',vesselId:v.id,quantity:Math.min(quantity,r.inventory.water??0)},`把本人原有清水装入水桶，受6份容量限制，不增加总水量`);
  add({...base,operation:'drink',vesselId:v.id},`饮用本人桶中1份安全水（现有${v.amount}份），无口渴或健康加成`);
  add({...base,operation:'decant',vesselId:v.id},`将桶内${v.amount}份安全水转入本人原有生产清水库存，供烹饪、灌溉或牲畜使用`);
  for(const child of w.residents.filter(p=>p.guardianIds.includes(r.id)))add({...base,operation:'serveChild',vesselId:v.id,targetId:child.id},`现场帮助受本人监护的${child.name}饮用1份自有安全水，须未拒绝照护且仍在可及位置`);
  if(r.inside===null)for(const s of w.resources.filter(s=>canInspectSpring(w,r,s)&&s.amount>=1))add({...base,operation:'fillSpring',sourceId:s.id,vesselId:v.id,quantity:Math.min(quantity,Math.floor(s.amount))},`到已知泉边把有限安全水装入水桶（容量6份，当前${v.amount}份），每份2分钟`);
  if(r.inside===null)for(const s of w.waterSupply.surfaceSources.filter(s=>distance(r.at,s.at)<=12&&s.amount>=1))add({...base,operation:'fillSurface',sourceId:s.id,vesselId:v.id,quantity:Math.min(quantity,Math.floor(s.amount))},`到可见河岸装入有限原水（该点余${s.amount}份），每份3分钟，须另到有使用权的厨房煮沸才能饮用`);
  for(const b of buildings){
   add({...base,operation:'boil',buildingId:b.id,vesselId:v.id},`到${b.name}灶台用1木材、30分钟煮沸桶内${v.amount}份原水并冷却装回，不增加水量`);
   add({...base,operation:'donate',buildingId:b.id,vesselId:v.id},`自愿将这只桶及${v.amount}份安全水实际捐到${b.name}桌台，供到场居民及访客每人每日最多饮用2份；桶也转为公共所有`);
   for(const p of publicVessels.filter(p=>p.buildingId===b.id))add({...base,operation:'refillPublic',buildingId:b.id,vesselId:v.id,publicVesselId:p.id,quantity:Math.min(3,v.amount,p.capacity-p.amount)},`用本人桶水补充${b.name}已捐赠的公共水桶，不动用金库或其他公共库存`);
  }
 }
 // One nearby genuinely reachable freshwater tile, not a remote map-wide water inventory.
 if(r.inside===null){
  const points=[];for(let y=Math.max(0,r.at.y-8);y<=Math.min(w.map.height-1,r.at.y+8);y++)for(let x=Math.max(0,r.at.x-8);x<=Math.min(w.map.width-1,r.at.x+8);x++){const at={x,y};if(distance(r.at,at)<=8&&isSurfaceWater(w,at)&&!w.waterSupply.surfaceSources.some(s=>s.id===surfaceWaterId(at)))points.push(at);}
  const at=points.sort((a,b)=>distance(r.at,a)-distance(r.at,b)).slice(0,8).find(at=>findPath(w,r.at,at,true,12)!==null);
  if(at)add({...base,operation:'survey',at},`亲自到(${at.x},${at.y})淡水河岸花10分钟登记24份有限原水，不抽取、不净化、无自动补水；以后另选装桶`);
 }
 return out;
}
