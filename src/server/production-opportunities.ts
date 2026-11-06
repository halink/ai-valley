import {ownedEstateParcels} from '../world/estate-custody.js';
import type {FormalOpportunity, Resident, World} from '../shared/types.js';
import {itemLabels} from '../shared/items.js';
import {calendar, DAY} from '../world/time.js';
import {distance} from '../world/navigation.js';
import {claimableInheritance,availableCropKeys,nearbyClaimablePlot,productionTarget} from '../world/production.js';
import type {ProductionAction} from '../shared/production.js';
import {cropYieldAt,soilFertility} from '../world/frontier-nutrients.js';

export function productionOpportunities(w:World,r:Resident):FormalOpportunity[]{
  if(w.mode!=='formal'||!w.production)return [];
  const result:FormalOpportunity[]=[];
  const add=(label:string,action:ProductionAction)=>{if(!productionTarget(w,r,action).error)result.push({id:`production.${action.operation}.${action.parcelId??action.plotId??action.personId??action.buildingId??action.heapId??''}`,label,action});};
  add('用1份自有根菜留种，整理出2份种子（15分钟）',{type:'production',operation:'saveSeed'});
  const visible=w.plots.filter(p=>p.ownerId===r.id&&!r.inside&&distance(r.at,p.at)<=8).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at));
  const lowSoil=visible.filter(p=>soilFertility(w,p.id)<=75&&!w.industry?.trees.some(tree=>tree.plotId===p.id&&tree.status!=='cut')).sort((a,b)=>soilFertility(w,a.id)-soilFertility(w,b.id))[0];
  if(lowSoil)add(`到本人田地 (${lowSoil.at.x},${lowSoil.at.y}) 使用1份堆肥，肥力当前 ${soilFertility(w,lowSoil.id)}/100，提高22点，成熟收成会受肥力影响`,{type:'production',operation:'fertilize',plotId:lowSoil.id});
  for(const heap of (w.production.nutrients?.heaps??[]).filter(pile=>pile.ownerId===r.id&&distance(r.at,pile.at)<=12).sort((a,b)=>b.units-a.units||distance(r.at,a.at)-distance(r.at,b.at)).slice(0,2)){
    add(`去 (${heap.at.x},${heap.at.y}) 收集实际存在的畜粪，现有 ${heap.units} 份，每次至多2份，可加工成堆肥或与人交换`,{type:'production',operation:'collectManure',heapId:heap.id});
  }
  const empty=visible.find(p=>!p.crop),season=calendar(w.minute).season;
  if(empty)for(const cropId of availableCropKeys(w)){
    const def=w.definitions[cropId];if(!(def.data.seasons as string[]).includes(season))continue;
    add(`种${def.data.name}（实际投入${Object.entries(def.cost??{}).map(([i,n])=>n+itemLabels[i as keyof typeof itemLabels]).join('、')}，浇水生长${def.data.growthDays}日，按当前肥力可产${cropYieldAt(w,empty,Number(def.data.yield))}份${itemLabels[(def.data.output??'turnip') as keyof typeof itemLabels]}；晚播可能跨季停长）`,{type:'production',operation:'plantCrop',plotId:empty.id,cropId});
  }
  const ripe=visible.find(p=>p.crop&&p.crop.growth>=Number(w.definitions[p.crop.definition].data.growthDays)&&p.crop.definition!=='crop/turnip@1');
  if(ripe)result.push({id:'production.harvest.'+ripe.id,label:`收获眼前已成熟的作物，当前预计 ${cropYieldAt(w,ripe,Number(w.definitions[ripe.crop!.definition].data.yield))} 份`,action:{type:'harvest',plotId:ripe.id}});
  const dry=visible.find(p=>p.crop&&p.crop.definition!=='crop/turnip@1'&&p.crop.wateredDay!==Math.floor(w.minute/DAY)&&p.crop.growth<Number(w.definitions[p.crop.definition].data.growthDays));
  if(dry&&(r.inventory.water??0)>0)result.push({id:'production.water.'+dry.id,label:'用1份水浇灌眼前未成熟的根菜田',action:{type:'water',plotId:dry.id}});
  const stalled=visible.find(p=>p.crop&&!(w.definitions[p.crop.definition].data.seasons as string[]).includes(season));
  if(stalled)add('放弃眼前已过季作物并清田，重新安排种植（原作物不产出）',{type:'production',operation:'clearPlot',plotId:stalled.id});
  const at=nearbyClaimablePlot(w,r);if(at)add(`开垦眼前(${at.x},${at.y})的闲置谷地（45分钟、1木材，个人最多6块）`,{type:'production',operation:'claimPlot',at});
  const repair=w.buildings.filter(b=>b.ownerId===r.id&&r.knownBuildings.includes(b.id)&&b.condition<=80).sort((a,b)=>a.condition-b.condition)[0];
  if(repair)add(`亲自修缮${repair.name}（现状${Math.round(repair.condition)}%，用2木1石，恢复20点）`,{type:'production',operation:'repair',buildingId:repair.id});
  const personId=claimableInheritance(w,r);if(personId)add('亲自办理自己应得的亲属遗产份额，其他继承人的份额保持保全',{type:'production',operation:'inherit',personId});
  for(const p of ownedEstateParcels(w,r))add(`亲自到${p.location.label??'原存放处'}（${p.location.at.x},${p.location.at.y}）领取已登记归本人的实物；路程与室内移动另计`,{type:'production',operation:'collectEstate',parcelId:p.id});
  return result;
}
