import {personalFoodProcessing} from '../world/personal-food-processing.js';
import {newFoodProcessingLabel,continueFoodProcessingLabel} from './personal-food-processing.js';
import {visibleOwnPlots} from '../world/crop-observation.js';
import {pastureOpportunities} from '../world/pasture-projects.js';
import {currentPremisesLease} from '../shared/premises.js';
import {crateLocation,canReachCrate} from '../world/livestock-cargo.js';
import {ageYears,DAY} from '../world/time.js';
import {availableIndustryRecipes,stationDefinition,validCraftRecipe} from '../world/industry-definitions.js';
import {fishWindows,fishingMinutes,visibleFishingShores,waterAtShore,fishingKey} from '../world/fishing.js';
import {pastureTileFree} from '../world/pasture.js';
import {wildlifeVisible} from '../world/frontier-hazards.js';
import {carriedHuntingSpear} from '../world/hunting.js';
import {beastNames} from '../shared/frontier-hazards.js';
import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {IndustryAction,AnimalKind,ToolKind,StationKind,Livestock} from '../shared/industry.js';
import {toolKits} from '../shared/industry.js';
import {industryTarget,animalNames} from '../world/industry.js';
import {stationNames} from '../world/industry-content.js';
import {goods,itemLabels} from '../shared/items.js';
import {availableCropKeys} from '../world/production.js';
import {distance,findPath,same} from '../world/navigation.js';

function careUrgency(w:World,n:Livestock,need?:'hunger'|'thirst'){
 const barn=w.buildings.find(b=>b.id===n.barnId);
 return Math.max(need?n[need]:Math.max(n.hunger,n.thirst),100-n.health,barn&&barn.condition>0?0:100);
}
export function industryOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!w.industry||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return [];
 const age=ageYears(r.bornAt,w.minute),frontier=w.scenario==='frontier';
 if(age<(frontier?6:18))return [];
 const result:FormalOpportunity[]=[];
 const add=(id:string,label:string,action:IndustryAction)=>{if(!industryTarget(w,r,action,false,w.minute,true).error)result.push({id:'industry.'+id,label,action});};
 const anchor=w.industry.frontierShore,home=w.buildings.find(b=>b.id===r.homeId);
 const knownShore=anchor&&distance(r.at,anchor)<=12&&(!r.inside||home&&distance(home.door,anchor)<=12)?anchor:undefined;
 const shoreCounts=new Map<string,number>();
 const waters=visibleFishingShores(w,r,frontier?12:2).filter(at=>{
  if(knownShore&&same(at,knownShore))return false;
  const key=fishingKey(waterAtShore(w,at)!),count=shoreCounts.get(key)??0;shoreCounts.set(key,count+1);return count<8;
 });
 if(knownShore)waters.unshift(knownShore);
 const rod=w.industry.tools.find(t=>t.ownerId===r.id&&t.kind==='rod'&&!t.location&&t.durability>0);
 if(rod&&age>=(frontier?13:18)){
  const offered=new Set<string>();
  for(const at of waters)for(const window of fishWindows(w,at)){
   if(offered.has(window.species))continue;
   const before=result.length;
   add('fish.'+window.species,`去已知水岸(${at.x},${at.y})用自己的钓具垂钓${fishingMinutes(w,r,at,rod.level)}分钟。选择${window.name}（${window.hours}），按该鱼种实际扣量并保留品种入库，消耗钓具耐用${frontier?`，本人垂钓熟练度${(w.industry.fishingExperience?.[r.id]??0).toFixed(1)}`:''}。`,{type:'industry',operation:'fish',at,fishSpecies:window.species});
   if(result.length>before)offered.add(window.species);
  }
 }
 if(frontier)for(const at of waters){
  const before=result.length;
  add('shoreRest',`去水边(${at.x},${at.y})坐半小时，歇一歇并恢复少量体力`,{type:'industry',operation:'shoreRest',at});
  if(result.length>before)break;
 }
 if(age<18){
  // Teen fishing needs an explicit own-kit equipment choice, not a free rod.
  // All other equipment and industry work stay in the adult branch below.
  if(frontier&&age>=13)add('equip.rod',`拆封并装备本人${itemLabels.rodKit}（15分钟）`,{type:'industry',operation:'equip',tool:'rod'});
  return result;
 }
 if(frontier&&!r.inside&&(r.inventory.fodder??0)>0){
  const ducks=(w.frontierHazards?.beasts??[]).filter(b=>b.species==='duck'&&wildlifeVisible(w,r,b));
  const barns=w.buildings.filter(b=>b.kind==='barn'&&r.knownBuildings.includes(b.id)&&
   (b.ownerId===r.id||b.ownerId==='commons'||b.residents.includes(r.id)));
  for(const duck of ducks.slice(0,2))for(const barn of barns.slice(0,2)){
   add('tame.'+duck.id+'.'+barn.id,`在实际看到野鸭的位置用本人1份饲料尝试驯养24分钟，给${barn.name}留出空位；驯养后仍须亲自护送`,
    {type:'industry',operation:'tameAnimal',beastId:duck.id,buildingId:barn.id,at:{...duck.at}});
  }
 }
 const spear=frontier&&carriedHuntingSpear(w,r),wild=w.frontierHazards;
 if(spear&&wild&&!r.inside){
  const beasts=wild.beasts.filter(b=>wildlifeVisible(w,r,b)).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at));
  for(const beast of beasts.slice(0,2))add('hunt.'+beast.id,`用随身猎矛前往亲眼看到${beastNames[beast.species]}的地点（${beast.at.x}，${beast.at.y}），靠近后花14分钟尝试一击。野兽可能逃脱或还击，只有实际猎获才有猎肉。`,{type:'industry',operation:'hunt',beastId:beast.id,at:{...beast.at},toolId:spear.id});
  if(!beasts.length){
   const edge={x:wild.woodland.x+8,y:wild.woodland.y};
   const path=distance(r.at,edge)>6&&findPath(w,r.at,edge,false,40);
   if(path&&path.length)result.push({id:'industry.huntingTrail',label:'带自己的猎矛向村西林缘走一段路找猎迹，到场再观察有什么',action:{type:'move',to:path[Math.min(path.length,10)-1]}});
  }
 }
 result.push(...pastureOpportunities(w,r));
 const tools=(Object.keys(toolKits) as ToolKind[]).filter(tool=>frontier||tool!=='spear');
 // Rank all locally known individuals, never truncate by insertion order. Missing
 // historical care times remain unknown and sort before recorded recent care.
 const rank=(a:Livestock,b:Livestock,need?:'hunger'|'thirst')=>careUrgency(w,b,need)-careUrgency(w,a,need)||(a.lastCaredAt??-Infinity)-(b.lastCaredAt??-Infinity)||a.id.localeCompare(b.id);
 const animals=w.industry.animals.filter(n=>(n.status==='alive'||n.product>0)&&w.buildings.some(b=>b.id===n.barnId&&r.knownBuildings.includes(b.id)&&Math.min(distance(r.at,b.door),distance(r.at,n.at??b.door))<=12)).sort((a,b)=>rank(a,b));
 const animalName=(n:Livestock)=>frontier&&n.sex?`${n.sex==='female'?'母':'公'}${animalNames[n.kind]}`:animalNames[n.kind];
 for(const operation of ['feedAnimal','waterAnimal','collectAnimal'] as const){
  const need=operation==='feedAnimal'?'hunger':operation==='waterAnimal'?'thirst':undefined;
  for(const n of [...animals].sort((a,b)=>rank(a,b,need))){
   if(frontier&&(operation==='feedAnimal'&&n.hunger<15||operation==='waterAnimal'&&n.thirst<15))continue;
   add(operation+n.id,`${operation==='feedAnimal'?'自愿用本人1份饲料喂养':operation==='waterAnimal'?'自愿提供本人1份水给':'收集本人动物的实际产物：'}${animalName(n)}（个体${n.id}，饥饿${Math.round(n.hunger)}、口渴${Math.round(n.thirst)}、健康${Math.round(n.health)}${n.pastureId?'，在牧场':''}）`,{type:'industry',operation,animalId:n.id});
  }
 }
 for(const n of animals){
  const name=animalName(n);
  if(n.ownerId!==r.id)continue;
  for(const barn of w.buildings.filter(b=>b.kind==='barn'&&(b.id!==n.barnId||n.at)&&r.knownBuildings.includes(b.id)))add('moveAnimal.'+n.id+'.'+barn.id,`亲自把本人的${name}送进${barn.name}的畜栏，途中路阻会留下真实位置`,{type:'industry',operation:'moveAnimal',animalId:n.id,buildingId:barn.id});
  for(const yard of w.industry.pastures??[]){
   if(n.pastureId===yard.id||!r.knownBuildings.includes(yard.barnId))continue;
   const at=yard.tiles.find(tile=>pastureTileFree(w,tile,n.id));
   if(at)add('pasture.'+n.id+'.'+yard.id,`亲自把自有${name}带去放牧。牧场草量${Math.floor(yard.forage)}/${yard.capacity}，仍需要清水。`,{type:'industry',operation:'moveAnimal',animalId:n.id,buildingId:yard.barnId,pastureId:yard.id,at:{...at}});
  }
  for(const sire of w.industry.animals.filter(a=>a.id!==n.id&&a.barnId===n.barnId&&a.kind===n.kind&&a.ownerId===r.id&&a.sex==='male').slice(0,1))add('breed.'+n.id,`决定让本人同舍健康成年${animalNames[n.kind]}繁育，预留真实幼畜空位，持续照料`,{type:'industry',operation:'breedAnimal',animalId:n.id,partnerId:sire.id});
 }
 const batch=w.industry.batches.find(batch=>batch.ownerId===r.id&&batch.status==='working');
 const observed=personalFoodProcessing(w,r).current;
 // A resume keeps the stored recipe, including after active definitions change.
 const recipes=batch?(validCraftRecipe(batch.recipe)?[{recipe:batch.recipe,definition:batch.definition}]:[]):availableIndustryRecipes(w);
 for(const b of w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&distance(r.at,b.door)<=12&&(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id)||currentPremisesLease(w,b.id)?.tenantId===r.id))){
  for(const {recipe,definition} of recipes){
   const food=Object.keys({...recipe.input,...recipe.output}).some(i=>goods[i as keyof typeof goods].life>0);
   // Current physical input/progress must be locally observable, not inferred from an address.
   if(food&&batch&&(!observed||observed.batchId!==batch.id))continue;
   const label=food?(batch?continueFoodProcessingLabel(observed!):newFoodProcessingLabel(b.name,recipe)):
    `在${b.name}亲自${recipe.name}，本次工作60分钟（可填minutes 1–120）；原料${Object.entries(recipe.input).map(([i,n])=>`${n}${itemLabels[i as keyof typeof itemLabels]}`).join('、')}，总需${recipe.minutes}分钟才产出。未完批次保留实际进度，不能无料加工`;
   add(`craft.${b.id}.${recipe.id}`,label,{type:'industry',operation:'craft',buildingId:b.id,recipeId:recipe.id,recipeDefinition:definition,...(batch?{batchId:batch.id}:{}),minutes:60});
  }
  for(const station of Object.keys(stationNames) as StationKind[])add('uninstall.'+b.id+station,`亲自拆卸${b.ownerId==='commons'?'已获具体表决授权的公共':'本人私人'}${stationNames[station]}（共60分钟，须先结清在制品与有效承诺；私人回收物归本人，公共回收物留原公共库存）`,{type:'industry',operation:'uninstall',buildingId:b.id,station});
  for(const station of Object.keys(stationNames) as StationKind[])add('install.'+b.id+station,`自愿用本人材料在${b.name}安装${stationNames[station]}（${stationDefinition(w,station)?.minutes??120}分钟，材料${Object.entries(stationDefinition(w,station)?.cost??{}).map(([i,n])=>n+itemLabels[i as keyof typeof itemLabels]).join('、')}；仍需本人或受雇者实际使用才生产）`,{type:'industry',operation:'install',buildingId:b.id,station});
  for(const tool of tools)add('repairTool.'+b.id+tool,`在${b.name}用2木材、1石料和45分钟修复本人磨损的${itemLabels[toolKits[tool]]}（须木工作台）`,{type:'industry',operation:'repairTool',buildingId:b.id,tool});
  for(const tool of tools)add('upgrade.'+b.id+tool,`在${b.name}用2铁锭、2木材和120分钟升级本人${itemLabels[toolKits[tool]]}`,{type:'industry',operation:'upgrade',buildingId:b.id,tool});
  if(b.kind==='barn')for(const kind of Object.keys(animalNames) as AnimalKind[])add('animal.'+b.id+kind,`把本人实际取得的${animalNames[kind]}运输笼安置在${b.name}；保留原身份、日龄和健康，幼畜不能立即产物；动物持续需要真实饲料和水，会成长、衰老及死亡`,{type:'industry',operation:'placeAnimal',buildingId:b.id,kind});
  if(b.kind==='greenhouse')for(let bed=0;bed<4;bed++){
   for(const cropId of availableCropKeys(w))add(`plantHouse.${b.id}.${bed}.${cropId}`,`在${b.name}第${bed+1}床种${w.definitions[cropId].data.name}（实际种植材料${Object.entries(w.definitions[cropId].cost??{}).map(([i,n])=>n+itemLabels[i as keyof typeof itemLabels]).join('、')}，另需1份浇护水；季节保护不替代材料、浇水和生长）`,{type:'industry',operation:'plantHouse',buildingId:b.id,bed,cropId});
   for(const operation of ['tendHouse','harvestHouse'] as const)add(`${operation}.${b.id}.${bed}`,`${operation==='tendHouse'?'用本人1水浇护':'实际收获'}${b.name}第${bed+1}床自有作物`,{type:'industry',operation,buildingId:b.id,bed});
  }
 }
 for(const c of w.industry.livestockCargo?.filter(c=>c.status==='crated'&&canReachCrate(w,r,c))??[])for(const operation of ['feedCrate','waterCrate'] as const)add(operation+c.id,`自愿用本人1${operation==='feedCrate'?'饲料':'水'}、30分钟照料眼前运输笼内的${animalNames[c.kind]}（${Math.floor((w.minute-c.bornAt)/DAY)}日龄，饥饿${Math.round(c.hunger)}、口渴${Math.round(c.thirst)}、健康${Math.round(c.health)}）`,{type:'industry',operation,animalId:c.id});
 for(const t of w.industry.tools.filter(t=>t.ownerId===r.id&&t.location&&!t.location.regional))add('collectTool.'+t.id,`亲自到原封存处（${t.location!.at.x},${t.location!.at.y}）领取已归本人的工具，登记不等于工具已在手中`,{type:'industry',operation:'collectTool',toolId:t.id});
 for(const tool of tools)add('equip.'+tool,`拆封并装备本人${itemLabels[toolKits[tool]]}（15分钟）`,{type:'industry',operation:'equip',tool});
 for(const p of visibleOwnPlots(w,r).slice(0,2))add('plantTree.'+p.id,'用本人果树苗和清水在自有空田种果树；浇护实际生长28日，成熟后在适宜季节结果',{type:'industry',operation:'plantTree',plotId:p.id});
 for(const t of w.industry.trees.filter(t=>t.ownerId===r.id&&t.status!=='cut')){
  if(distance(r.at,t.at)>12){result.push({id:'industry.visitTree.'+t.id,label:'去本人的果树地查看与照料',action:{type:'move',to:{...t.at}}});continue;}
  for(const operation of ['tendTree','harvestFruit','cutTree'] as const)add(operation+t.id,operation==='tendTree'?'用本人1水浇护果树':operation==='harvestFruit'?'收集本人果树上已经成熟的水果':'亲自砍除本人果树并释放原田地（幼树仅回收1木，成熟树4木）',{type:'industry',operation,treeId:t.id});
 }
 for(const m of w.industry.mines.filter(m=>r.knownResources.includes(m.resourceId)).sort((a,b)=>distance(a.at,r.at)-distance(b.at,r.at)).slice(0,2)){
  if(distance(r.at,m.at)>12){result.push({id:'industry.visitMine.'+m.id,label:'前往本人已探明的矿口查看开采条件',action:{type:'move',to:{x:m.at.x,y:m.at.y+1}}});continue;}
  add('mine.'+m.id,`用本人镐具在已探明矿口第${m.depth+1}层开采60分钟，铁矿、燃煤和石料来自有限矿脉，深层有实际身体风险，可自行离开`,{type:'industry',operation:'mine',mineId:m.id});
  add('deepen.'+m.id,'用本人2木板、1铁锭和更高等级镐具支护并开拓下一层矿脉（120分钟）',{type:'industry',operation:'deepen',mineId:m.id});
 }
 return result;
}
