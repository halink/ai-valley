import {hasReceipt} from './receipts.js';
import {hasFerryAssets} from './ferry.js';
import {animalCrate,cratedAnimal,crateLocation,canReachCrate,careForCrate} from './livestock-cargo.js';
import {industryDefinition,initializeIndustryRules} from './industry-rules.js';
import {animalYears} from '../shared/industry-rules.js';
import {roomLayout} from '../shared/rooms.js';
import {initializeIndustryDefinitions,actionRecipe,stationDefinition} from './industry-definitions.js';
import {initializeFishing,advanceFishing,fishWindow,fishingMinutes,fishingShore,fishingStockAt,shoalWithinReach,waterAtShore,fishingKey} from './fishing.js';
import {advancePastures,pastureTileFree} from './pasture.js';
import {initializeFixtureRemoval,advanceFixtureRemoval,publicRemovalError,fixtureMandate,workFixtureRemoval,finishFixtureRemoval} from './fixture-removal.js';
import {estateStock,estateBuildingLocation,atEstateLocation} from './estate-custody.js';
import {addHealthCase} from './health.js';
import {prepareRoomExit} from './rooms.js';
import {foodTransaction,initializeFood} from './food.js';
import type {Building,Inventory,Item,Resident,Vec,World} from '../shared/types.js';
import type {IndustryAction,ToolKind} from '../shared/industry.js';
import {toolKits} from '../shared/industry.js';
import {completeHunt,huntingTarget} from './hunting.js';
import {recipeById,stationCosts,stationNames} from './industry-content.js';
import {goods,itemLabels} from '../shared/items.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {educationConflict} from './education.js';
import {employmentConflict} from './employment.js';
import {ageYears,calendar,DAY,YEAR} from './time.js';
import {emitEvent} from './events.js';
import {animalNames,animalProducts,recordLivestockDeath} from './livestock-life.js';
import {recordLivestockNourishment} from './frontier-nutrients.js';

const whole=(v:unknown,a=1,b=120):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b;
const eligible=(w:World,r:Resident,a:IndustryAction)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=(w.scenario==='frontier'&&a.operation==='shoreRest'?6:w.scenario==='frontier'&&a.operation==='fish'?13:18);
const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([i,n])=>(bag[i as Item]??0)>=n!);
const change=(bag:Inventory,values:Inventory,sign=1)=>{for(const [i,n]of Object.entries(values))bag[i as Item]=(bag[i as Item]??0)+sign*n!;};
const building=(w:World,id?:string)=>w.buildings.find(b=>b.id===id);
const use=(r:Resident,b:Building)=>b.condition>0&&(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id));
export {animalNames} from './livestock-life.js';
export const barnCapacity=(b:Building)=>Math.max(4,Math.floor(b.width*b.height/8));
const toolFor=(w:World,r:Resident,kind?:ToolKind)=>w.industry?.tools.find(t=>t.ownerId===r.id&&t.kind===kind&&!t.location&&t.durability>0);
const aliveAnimals=(w:World,id:string)=>w.industry!.animals.filter(a=>a.barnId===id&&a.status==='alive');
const name=(w:World,id:string)=>w.residents.find(r=>r.id===id)?.name??'原居民';
function fact(w:World,r:Resident,text:string,at=r.at,animalIds?:string[]){emitEvent(w,{kind:'production',actors:[r.id],place:{...at},text,...(animalIds?{animalIds}:{})});}
export function initializeIndustry(w:World){
 if(w.mode!=='formal')return;if(w.industry){initializeIndustryRules(w);initializeIndustryDefinitions(w);initializeFixtureRemoval(w);initializeFishing(w);return;}
 const mineral=w.resources.filter(r=>r.kind==='rock'&&r.amount>0);
 w.industry={nextSerial:1,batches:[],trees:[],animals:[],tools:[],stations:[],beds:[],mines:mineral.map(r=>({id:'mine:'+r.id,at:{...r.at},resourceId:r.id,depth:0,remaining:[r.amount,r.amount*2,r.amount*2],exploredBy:{}})),fishing:{},sources:{registeredAt:w.minute,livestockCrates:{chickCrate:6,goatCrate:2,sheepCrate:2},mineralUnits:mineral.reduce((n,r)=>n+r.amount*5,0)},totals:{crafted:0,fruit:0,animalProducts:0,animalBirths:0,animalDeaths:0,fish:0,ore:0}};
 w.definitions['industry/rules@1']??={id:'industry/rules',version:1,kind:'action',dependencies:[],data:{treeGrowthDays:28,barnSpace:8,fishCapacity:12,fishRenewalDays:10,source:'当前未耗尽岩体的有限深部矿层；镇外一次性登记的有限种畜；不自动补货'}};
 initializeIndustryRules(w);initializeIndustryDefinitions(w);initializeFishing(w);initializeFixtureRemoval(w);const west=w.foreignTrade?.merchants[0];if(west){change(west.person.inventory,w.industry.sources.livestockCrates);west.person.revision++;}
}
function workConflict(w:World,r:Resident,at:Vec,minutes:number,b?:Building){
 if(educationConflict(w,r.id,w.minute,w.minute+minutes,b?.id))return '本人的课堂或本处教学桌已被预留';
 if(b&&employmentConflict(w,r,w.minute,w.minute+minutes,b.id))return '与既有聘约或通勤安排冲突';
 if(w.duties?.shifts.some(s=>s.workerId===r.id&&['booked','on-duty'].includes(s.status)&&w.minute<s.end&&s.start<w.minute+minutes))return '与本人已接受的公共班次冲突';
 const path=findPath(w,r.at,at);return path===null?'实际工作位置不可达':null;
}
function tameableDuck(w:World,id?:string){
 return w.frontierHazards?.beasts.find(b=>b.id===id&&b.species==='duck'&&b.status==='alive');
}
export function industryTarget(w:World,r:Resident,a:IndustryAction):{target:Vec;duration:number;adjacent?:boolean;error?:string}{
 const fail=(error:string)=>({target:r.at,duration:0,error});if(!w.industry||!eligible(w,r,a))return fail('本人年龄或能力不适合这项活动');
 if(w.scenario!=='frontier'&&(a.tool==='spear'||a.recipeId==='spear'||a.recipeId==='gameMeal'))return fail('此处还没有开拓聚落的打猎活动');
 let at:Vec={...r.at},duration=30,adjacent=false;const b=building(w,a.buildingId),instance=a.toolId?w.industry.tools.find(t=>t.id===a.toolId):a.treeId?w.industry.trees.find(t=>t.id===a.treeId):a.animalId?w.industry.animals.find(t=>t.id===a.animalId):a.mineId?w.industry.mines.find(t=>t.id===a.mineId):['upgrade','repairTool'].includes(a.operation)?w.industry.tools.find(t=>t.ownerId===r.id&&!t.location&&t.kind===a.tool):null;const selected=industryDefinition(w,instance?.definition??a.processDefinition);a.processDefinition=selected.definition;const rules=selected.rules;duration=rules.animalWorkMinutes;
 if(['placeAnimal','feedCrate','waterCrate'].includes(a.operation))initializeFood(w);
 if(['craft','install','uninstall','plantHouse','tendHouse','harvestHouse'].includes(a.operation)){
  if(!b||!r.knownBuildings.includes(b.id)||!use(r,b)&&!(['tendHouse','harvestHouse'].includes(a.operation)&&w.industry.beds.some(p=>p.buildingId===b.id&&p.index===a.bed&&p.crop?.ownerId===r.id)))return fail('没有已知且有使用权的场所');at={...b.door};
 }
 if(a.operation==='craft'){
  const selected=actionRecipe(w,r.id,a),recipe=selected?.recipe;if(!recipe||!whole(a.minutes))return fail('没有这项有效制作方法或实际工时');
  a.station=recipe.station??undefined;
  if(!['home','lodge','workshop','store'].includes(b!.kind)||r.skills[recipe.skill]<recipe.minimum)return fail('本人技能或制作场所不适用');
  if(recipe.station&&!w.industry.stations.some(s=>s.buildingId===b!.id&&s.kind===recipe.station&&!(s.removalWorked!>0)))return fail('所需加工设备尚未由居民实际安装');
  const batch=w.industry.batches.find(c=>c.ownerId===r.id&&c.status==='working');if(batch&&(batch.buildingId!==b!.id||batch.recipe.id!==recipe.id))return fail('本人已有未完成批次，须回到原工位继续');
  if(!batch&&!has(r.inventory,recipe.input))return fail('本人没有真实配方原料');duration=Math.min(a.minutes,batch?batch.recipe.minutes-batch.worked:recipe.minutes);
 }else if(a.operation==='install'){
  const installation=a.station?stationDefinition(w,a.station,a.stationDefinition):null;if(installation)a.stationDefinition=installation.definition;
  if(!a.station||!installation||!['workshop','store','lodge'].includes(b!.kind)||b!.kind==='lodge'&&a.station!=='bench'||b!.ownerId!==r.id&&b!.ownerId!=='commons')return fail('不能在此安装这类设备');
  if(w.industry.stations.some(s=>s.buildingId===b!.id&&s.kind===a.station)||!has(r.inventory,installation.cost))return fail('该设备已存在或本人安装材料不足');duration=installation.minutes;
 }else if(a.operation==='uninstall'){
  const fixture=w.industry.stations.find(s=>s.buildingId===b!.id&&s.kind===a.station);if(a.stationId&&fixture?.id!==a.stationId)return fail('原先指定的设备身份已经改变，须由本人重新决定');if(fixture)a.stationId=fixture.id;
  if(!a.station||!w.industry.stations.some(s=>s.buildingId===b!.id&&s.kind===a.station)||b!.ownerId!==r.id&&b!.ownerId!=='commons')return fail('没有本人有权处置的现有设备');if(b!.ownerId==='commons'){const problem=publicRemovalError(w,b!.id,a.station);if(problem)return fail(problem);}
  if(w.industry.batches.some(c=>c.buildingId===b!.id&&c.status==='working')||w.employment?.contracts.some(c=>c.buildingId===b!.id&&c.status==='active'))return fail('实际在制品或有效雇佣尚未结清，不能拆除工位');duration=b!.ownerId==='commons'?Math.max(.001,(fixture!.uninstallMinutes??60)-(fixture!.removalWorked??0)):fixture!.uninstallMinutes??60;
 }else if(a.operation==='collectTool'){const t=w.industry.tools.find(t=>t.id===a.toolId&&t.ownerId===r.id&&t.location);if(!t)return fail('没有归本人且尚待到原处领取的封存工具');at={...t.location!.at};duration=5;
 }else if(a.operation==='equip'){
  if(!a.tool||!Object.hasOwn(toolKits,a.tool)||!has(r.inventory,{[toolKits[a.tool]]:1})||toolFor(w,r,a.tool))return fail('没有未拆封工具，或已有可用同类工具');duration=rules.equipMinutes;
 }else if(a.operation==='repairTool'){
  const t=w.industry.tools.find(t=>t.ownerId===r.id&&!t.location&&t.kind===a.tool&&(!a.toolId||t.id===a.toolId)&&t.durability<t.maxDurability);
  if(!t||!b||!use(r,b)||!w.industry.stations.some(s=>s.buildingId===b.id&&s.kind==='bench'&&!(s.removalWorked!>0))||!has(r.inventory,{wood:rules.repairWood,stone:rules.repairStone}))return fail('维修需要本人磨损工具、木工作台、2木材和1石料');a.toolId=t.id;a.station='bench';at={...b.door};duration=rules.repairMinutes;
 }else if(a.operation==='upgrade'){
  const t=toolFor(w,r,a.tool);if(!t||t.level>=rules.maximumToolLevel||!has(r.inventory,{bar:rules.upgradeBar,wood:rules.upgradeWood})||!b||!use(r,b)||!w.industry.stations.some(s=>s.buildingId===b.id&&s.kind==='forge'&&!(s.removalWorked!>0)))return fail('升级需要本人可用工具、锻冶炉、2铁锭和2木材');a.station='forge';at={...b.door};duration=rules.upgradeMinutes;
 }else if(['plantTree','tendTree','harvestFruit','cutTree'].includes(a.operation)){
  const p=w.plots.find(p=>p.id===a.plotId),t=w.industry.trees.find(t=>t.id===a.treeId&&t.status!=='cut');
  if(a.operation==='plantTree'){
   if(!p||p.ownerId!==r.id||p.crop||w.industry.trees.some(t=>t.plotId===p.id&&t.status!=='cut')||!has(r.inventory,{sapling:1,water:1}))return fail('须本人空田、果树苗和清水，不能覆盖现有作物');at={...p.at};duration=rules.treePlantMinutes;
  }else{
   if(!t||t.ownerId!==r.id)return fail('没有这株果树的本人产权');at={...t.at};duration=a.operation==='cutTree'?rules.treeCutMinutes:rules.treeTendMinutes;
   if(a.operation==='tendTree'&&!has(r.inventory,{water:1}))return fail('浇护果树需要本人清水');if(a.operation==='harvestFruit'&&t.fruit<1)return fail('当前没有实际成熟水果');
  }
 }else if(a.operation==='tameAnimal'){
  const duck=tameableDuck(w,a.beastId);
  if(!duck||!a.at||r.inside||!walkable(w,a.at,r.at)||distance(r.at,a.at)>10||distance(a.at,duck.at)>5||
   !has(r.inventory,{fodder:1})||!b||b.kind!=='barn'||!r.knownBuildings.includes(b.id)||!use(r,b))return fail('需要户外亲自接近目击的活野鸭、实有饲料及可用畜舍');
  const animals=aliveAnimals(w,b.id);
  if(animals.length+animals.filter(n=>n.pregnancy).length+w.industry.animals.filter(n=>n.barnId!==b.id&&n.destinationId===b.id).length>=barnCapacity(b)||
   findPath(w,a.at,b.door,false,65)===null)return fail('畜舍没有空位或没有实际护送路线');
  at={...a.at};duration=24;adjacent=true;
 }else if(a.operation==='feedCrate'||a.operation==='waterCrate'){const c=w.industry.livestockCargo?.find(c=>c.id===a.animalId&&c.status==='crated'),l=c&&crateLocation(w,c);if(!c||!l?.at||!canReachCrate(w,r,c)||!has(r.inventory,{[a.operation==='feedCrate'?'fodder':'water']:1}))return fail('须亲自接近实际活畜运输笼，并使用本人饲料或水');at={...l.at};duration=industryDefinition(w,c.definition).rules.animalWorkMinutes;
 }else if(['placeAnimal','feedAnimal','waterAnimal','collectAnimal','breedAnimal','moveAnimal'].includes(a.operation)){
  const animal=w.industry.animals.find(n=>n.id===a.animalId&&(n.status==='alive'||a.operation==='collectAnimal')),barn=a.operation==='placeAnimal'||a.operation==='moveAnimal'?b:building(w,animal?.barnId);
  if(!barn||barn.kind!=='barn'||barn.condition<=0||!r.knownBuildings.includes(barn.id))return fail('须已知、实际可用的畜舍');at={...barn.door};
  if(a.operation==='placeAnimal'){
   if(!a.kind||!Object.hasOwn(animalNames,a.kind)||!use(r,barn)||!has(r.inventory,{[animalCrate(a.kind)]:1})||!cratedAnimal(w,'person:'+r.id,a.kind,a.animalId)||aliveAnimals(w,barn.id).length+aliveAnimals(w,barn.id).filter(n=>n.pregnancy).length>=barnCapacity(barn))return fail('须真实种畜、合法畜舍和未预留的空位');
  }else{
   if(!animal)return fail('这只动物不再存活');if(animal.at&&a.operation!=='moveAnimal')at={...animal.at};
   if(animal.carrierId&&!(a.operation==='moveAnimal'&&animal.carrierId===r.id))return fail('这只动物正被另一人实际护送');
   if(['collectAnimal','breedAnimal','moveAnimal'].includes(a.operation)&&animal.ownerId!==r.id)return fail('只有动物主人能处分、繁育或领取其产品');
   if(a.operation==='feedAnimal'&&!has(r.inventory,{fodder:1}))return fail('自愿喂养须本人实际饲料');if(a.operation==='waterAnimal'&&!has(r.inventory,{water:1}))return fail('自愿供水须本人实际清水');
   if(a.operation==='collectAnimal'&&animal.product<1)return fail('没有实际可收集的动物产物');
   if(a.operation==='breedAnimal'){
    const sire=w.industry.animals.find(n=>n.id===a.partnerId&&n.status==='alive'&&n.ownerId===r.id&&n.barnId===animal.barnId&&n.kind===animal.kind&&n.sex==='male');
    if(animal.sex!=='female'||animal.pregnancy||!sire||w.minute-animal.bornAt<rules.animalAdultDays*DAY||w.minute-sire.bornAt<industryDefinition(w,sire.definition).rules.animalAdultDays*DAY||animal.health<rules.animalMinimumBreedHealth||sire.health<industryDefinition(w,sire.definition).rules.animalMinimumBreedHealth||animal.hunger>rules.animalBreedThreshold||animal.thirst>rules.animalBreedThreshold||aliveAnimals(w,barn.id).length+aliveAnimals(w,barn.id).filter(n=>n.pregnancy).length>=barnCapacity(barn))return fail('繁育需要本人同舍健康成年雌雄、实际照料和预留幼畜空位');
   }
   if(a.operation==='moveAnimal'){
    const source=animal.at??building(w,animal.barnId)?.door;
    const reserved=w.industry.animals.filter(n=>n.id!==animal.id&&n.status==='alive'&&n.destinationId===barn.id).length;
    if(!source||!use(r,barn))return fail('没有合法畜舍或可接近的动物位置');
    let destination=barn.door;
    if(a.pastureId){
     const yard=w.industry.pastures?.find(p=>p.id===a.pastureId&&p.barnId===barn.id);
     if(!yard||!a.at||!yard.tiles.some(tile=>same(tile,a.at!))||animal.pastureId===yard.id)return fail('没有实际可用的放牧位置，或动物已经在这处牧场');
     const free=pastureTileFree(w,a.at,animal.id)?a.at:a.phase!=='delivery'?yard.tiles.find(tile=>pastureTileFree(w,tile,animal.id)):undefined;
     if(!free)return fail('牧场没有空闲且可走的放牧位置');
     a.at={...free};destination=a.at;
    }else if(barn.id===animal.barnId&&!animal.at)return fail('动物已经在本人畜舍内');
    if(barn.id!==animal.barnId&&aliveAnimals(w,barn.id).length+aliveAnimals(w,barn.id).filter(n=>n.pregnancy).length+reserved>=barnCapacity(barn))return fail('新畜舍没有空位');
    if(findPath(w,source,destination)===null)return fail('没有实际通往动物目的地的路线');
    at={...(a.phase==='delivery'?destination:source)};duration=15;
   }
  }
 }else if(['plantHouse','tendHouse','harvestHouse'].includes(a.operation)){
  if(b!.kind!=='greenhouse'||!whole(a.bed,0,3))return fail('须真实温室的有效种植床');const bed=w.industry.beds.find(p=>p.buildingId===b!.id&&p.index===a.bed);
  if(a.operation==='plantHouse'&&(bed?.crop||!a.cropId||!w.definitions[a.cropId]||!a.cropId.startsWith('crop/')||!has(r.inventory,{...w.definitions[a.cropId]?.cost,water:(w.definitions[a.cropId]?.cost?.water??0)+1})))return fail('温室种植需要空床、有效作物与本人种水');
  if(a.operation!=='plantHouse'&&(!bed?.crop||bed.crop.ownerId!==r.id))return fail('本人没有这床温室作物');if(a.operation==='tendHouse'&&!has(r.inventory,{water:1}))return fail('浇水需要实际清水');if(a.operation==='harvestHouse'&&bed!.crop!.growth<Number(w.definitions[bed!.crop!.definition].data.growthDays))return fail('本床作物尚未实际成熟');duration=15;
 }else if(a.operation==='hunt'){
  const route=huntingTarget(w,r,a);if(route.error)return route;at=route.target;duration=route.duration;
 }else if(a.operation==='fish'||a.operation==='shoreRest'){
  if(!a.at||distance(r.at,a.at)>12||!fishingShore(w,a.at))return fail('须亲自前往已知且可走的近处水岸');
  at={...a.at};
  if(a.operation==='shoreRest'){
   if(w.scenario!=='frontier')return fail('这里尚未登记可以沿岸休息的开拓区域');
   duration=30;
  }else{
   const rod=toolFor(w,r,'rod'),pool=fishingStockAt(w,at);
   if(!rod)return fail('垂钓需要本人可用钓具');
   if(!pool)return fail('这片新增水域没有已登记的真实种群来源');
   if(pool.amount<1)return fail('这片水域鱼群尚未恢复');
   if(!fishWindow(w,at).species)return fail('当前地点、季节、时段和天气没有可活动的已知鱼种');
   if(!shoalWithinReach(w,at))return fail('鱼群离岸太远、隔着陆地，或正在躲避洪水');
   duration=fishingMinutes(w,r,at,rod.level);
  }
 }else if(a.operation==='mine'||a.operation==='deepen'){
  const m=w.industry.mines.find(m=>m.id===a.mineId),t=toolFor(w,r,'pick');if(!m||!r.knownResources.includes(m.resourceId)||!t||t.level<m.depth+1)return fail('须本人已探明的矿口和相应等级镐具');at={...m.at};adjacent=true;
  if(a.depth!==undefined&&a.depth!==m.depth)return fail('矿层已由其他施工改变，请重新查看再决定');a.depth=m.depth;
  if(a.operation==='mine'&&(m.remaining[m.depth]<1||m.depth===0&&(w.resources.find(r=>r.id===m.resourceId)?.amount??0)<1))return fail('本层有限矿脉已耗尽');if(a.operation==='deepen'&&(m.depth>=2||t.level<m.depth+2||!has(r.inventory,{plank:rules.supportPlank,bar:rules.supportBar})))return fail('向深层开拓须更高等级工具、2木板和1铁锭支护');duration=a.operation==='mine'?rules.mineMinutes:rules.deepenMinutes;
 }else return fail('没有这项生产安排');
 const conflict=workConflict(w,r,adjacent?r.at:at,duration,b);return conflict?fail(conflict):{target:at,duration,adjacent};
}
export function industryWorkError(w:World,r:Resident,a:IndustryAction,dt:number):string|null {
 if(a.operation!=='craft'){const removal=workFixtureRemoval(w,r,a,dt);if(removal)return removal;const animal=w.industry?.animals.find(n=>n.id===a.animalId),b=building(w,a.buildingId??animal?.barnId);if(b&&same(r.at,b.door)&&(!animal?.at||animal.inside===b.id)&&['install','uninstall','upgrade','repairTool','plantHouse','tendHouse','harvestHouse','placeAnimal','feedAnimal','waterAnimal','collectAnimal'].includes(a.operation))r.inside=b.id;return null;}
 if(r.activity?.action.type!=='industry'||r.activity.action.operation!=='craft'||r.activity.action.recipeId!==a.recipeId||r.activity.action.buildingId!==a.buildingId)return '没有本人已接受并实际开始的制作安排';
 const b=building(w,a.buildingId);if(!b||!same(r.at,b.door)||!use(r,b))return '本人必须实际到达仍有使用权的工位';
 const selected=actionRecipe(w,r.id,a),recipe=selected?.recipe;if(!recipe||r.skills[recipe.skill]<recipe.minimum)return '本人制作能力或配方不适用';
 if(educationConflict(w,r.id,w.minute-dt,w.minute,b.id))return '教学桌正在被已接受的课堂占用';
 const actionKey=r.activity?`${r.activity.planId}:${r.activity.startedAt}`:`manual:${r.id}:${w.minute}`;if(w.industry!.batches.some(c=>c.ownerId===r.id&&c.actionKey===actionKey&&c.status==='completed'))return null;
 if(a.batchId&&w.industry!.batches.find(c=>c.id===a.batchId)?.status==='cancelled')return '本次加工的实际原料已腐败或批次已终止，请重新决定';
 let batch=w.industry!.batches.find(c=>c.ownerId===r.id&&c.status==='working');
 if(!batch){if(!has(r.inventory,recipe.input))return '实际加工原料已不足';foodTransaction(w,()=>{change(r.inventory,recipe.input,-1);batch={definition:selected!.definition,id:`batch:${w.id}:${w.industry!.nextSerial++}`,ownerId:r.id,buildingId:b.id,recipe:structuredClone(recipe),input:{...recipe.input},actionKey,worked:0,lastAt:-1,status:'working',createdAt:w.minute};w.industry!.batches.push(batch!);a.batchId=batch!.id;});fact(w,r,`${r.name}开始${recipe.name}，实际原料已留在${b.name}的加工批次中。`);}
 if(!batch)return '加工批次未建立';a.batchId=batch.id;batch.actionKey=actionKey;
 if(batch.buildingId!==b.id||batch.recipe.id!==recipe.id)return '须先处理本人既有加工批次';if(batch.lastAt>=w.minute-1e-9)return null;
 batch.worked+=Math.min(dt,batch.recipe.minutes-batch.worked,r.activity?.remaining??dt);batch.lastAt=w.minute;r.inside=b.id;
 if(batch.worked>=batch.recipe.minutes-1e-8)foodTransaction(w,()=>{batch!.worked=batch!.recipe.minutes;batch!.status='completed';change(r.inventory,batch!.recipe.output);w.industry!.totals.crafted++;r.skills[recipe.skill]+=recipe.minutes/12000;if(r.activity?.action===a)r.activity.remaining=0;fact(w,r,`${r.name}实际完成${recipe.name}，得到${Object.entries(batch!.recipe.output).map(([i,n])=>`${n}份${itemLabels[i as Item]}`).join('、')}。`);});
 return null;
}
function completeIndustryAtomic(w:World,r:Resident,a:IndustryAction):string|null {
 if(a.operation==='craft')return null;const mark=r.activity?`industry:${r.activity.planId}:${r.activity.startedAt}:${a.operation}`:`industry:${r.id}:${r.revision}:${w.revision}`;if(hasReceipt(w,mark))return null;
 const route=industryTarget(w,r,a);if(route.error)return route.error;if(route.adjacent?distance(r.at,route.target)>1:!same(r.at,route.target))return '须亲自到达实际工作位置';
 const rules=industryDefinition(w,a.processDefinition).rules;const state=w.industry!,b=building(w,a.buildingId),t=state.trees.find(t=>t.id===a.treeId),n=state.animals.find(n=>n.id===a.animalId),m=state.mines.find(m=>m.id===a.mineId);
 if(a.operation==='install'){const installation=stationDefinition(w,a.station!,a.stationDefinition)!;change(r.inventory,installation.cost,-1);state.stations.push({id:'station:'+state.nextSerial++,buildingId:b!.id,kind:a.station!,installedAt:w.minute,installedCost:structuredClone(installation.cost),definition:installation.definition,uninstallMinutes:installation.uninstallMinutes,salvageFraction:installation.salvageFraction,removalWorked:0});fact(w,r,`${r.name}用实际材料在${b!.name}安装了${stationNames[a.station!]}。`);}
 else if(a.operation==='uninstall'&&b!.ownerId==='commons'){const problem=finishFixtureRemoval(w,r,a);if(problem)return problem;}
 else if(a.operation==='uninstall'){const fixture=state.stations.find(s=>s.buildingId===b!.id&&s.kind===a.station)!,cost=fixture.installedCost??stationCosts[a.station!];state.stations=state.stations.filter(s=>!(s.buildingId===b!.id&&s.kind===a.station));for(const [item,n]of Object.entries(cost))change(r.inventory,{[item]:Math.floor(n!*(fixture.salvageFraction??.5))});fact(w,r,`${r.name}亲自拆卸自有场所的${stationNames[a.station!]}，回收一半实际安装木石，原设备不再可用。`);}
 else if(a.operation==='collectTool'){const t=state.tools.find(t=>t.id===a.toolId)!;if(!t.location||!atEstateLocation(r,t.location))return '须本人走到工具实际封存位置';t.location=null;fact(w,r,`${r.name}亲自领取并带上原址封存的本人工具，保留原等级与磨损。`);}
 else if(a.operation==='equip'){change(r.inventory,{[toolKits[a.tool!]]:1},-1);state.tools.push({definition:a.processDefinition,id:'tool:'+state.nextSerial++,ownerId:r.id,kind:a.tool!,level:1,durability:rules.toolDurability,maxDurability:rules.toolDurability});fact(w,r,`${r.name}拆封并装备了本人${itemLabels[toolKits[a.tool!]]}，可用${rules.toolDurability}次。`);}
 else if(a.operation==='repairTool'){change(r.inventory,{wood:rules.repairWood,stone:rules.repairStone},-1);const tool=state.tools.find(t=>t.id===a.toolId)!;tool.durability=tool.maxDurability;fact(w,r,`${r.name}实际修复本人磨损工具，保留原有等级和身份。`);}
 else if(a.operation==='upgrade'){change(r.inventory,{bar:rules.upgradeBar,wood:rules.upgradeWood},-1);const tool=toolFor(w,r,a.tool)!;tool.level++;tool.maxDurability+=rules.upgradeDurability;tool.durability=tool.maxDurability;fact(w,r,`${r.name}实际升级本人${itemLabels[toolKits[a.tool!]]}至${tool.level}级。`);}
 else if(a.operation==='plantTree'){change(r.inventory,{sapling:1,water:1},-1);const p=w.plots.find(p=>p.id===a.plotId)!;state.trees.push({definition:a.processDefinition,id:'orchard:'+state.nextSerial++,ownerId:r.id,plotId:p.id,at:{...p.at},plantedAt:w.minute,growth:0,lastWateredDay:Math.floor(w.minute/DAY),lastMinute:w.minute,fruit:0,fruitProgress:0,status:'growing'});fact(w,r,`${r.name}在自有空田种下果树苗，需实际浇护生长28日才成熟。`);}
 else if(a.operation==='tendTree'){change(r.inventory,{water:1},-1);t!.lastWateredDay=Math.floor(w.minute/DAY);fact(w,r,`${r.name}实际为果树浇水。`);}
 else if(a.operation==='harvestFruit'){change(r.inventory,{fruit:t!.fruit});state.totals.fruit+=t!.fruit;fact(w,r,`${r.name}收集了果树上实际成熟的${t!.fruit}份水果。`);t!.fruit=0;}
 else if(a.operation==='cutTree'){const wood=t!.status==='mature'?rules.treeMatureWood:rules.treeYoungWood;t!.status='cut';change(r.inventory,{wood});fact(w,r,`${r.name}亲自砍除了自有果树，释放原田地并回收${wood}份木材。`);}
 else if(a.operation==='tameAnimal'){
  const duck=tameableDuck(w,a.beastId);
  if(!duck||r.activity?.action!==a||r.activity.remaining>0||!findPath(w,r.at,duck.at,false,1))return '实际接触的野鸭已离开，驯养未完成';
  change(r.inventory,{fodder:1},-1);
  const hunger=Math.max(0,duck.hunger-rules.animalFeedRelief);
  const animal={definition:a.processDefinition,id:duck.id,ownerId:r.id,kind:'duck' as const,at:{...duck.at},inside:null,
   pen:nextAnimalPen(w,b!.id),sex:duck.sex??'female' as const,bornAt:duck.bornAt,barnId:b!.id,hunger,
   thirst:duck.thirst??20,health:duck.health,status:'alive' as const,deathAt:null,product:0,progress:0,
   pregnancy:null,lastMinute:w.minute,energy:duck.energy??75};
  w.frontierHazards!.beasts=w.frontierHazards!.beasts.filter(x=>x.id!==duck.id);
  state.animals.push(animal);recordLivestockNourishment(w,animal,duck.hunger-hunger);
  fact(w,r,`${r.name}在河岸以实物驯养了一只野鸭。家鸭保留原身份与位置，尚待亲自接回畜舍。`,animal.at,[animal.id]);
 }
 else if(a.operation==='placeAnimal'){const c=cratedAnimal(w,'person:'+r.id,a.kind!,a.animalId)!;c.status='released';c.releasedAt=w.minute;change(r.inventory,{[animalCrate(a.kind!)]:1},-1);state.animals.push({definition:c.definition,id:c.id,ownerId:r.id,kind:c.kind,pen:nextAnimalPen(w,b!.id),sex:c.sex,bornAt:c.bornAt,barnId:b!.id,hunger:c.hunger,thirst:c.thirst,health:c.health,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute,energy:75});fact(w,r,`${r.name}把运输笼内实际${Math.floor((w.minute-c.bornAt)/DAY)}日龄的${animalNames[c.kind]}安置到${b!.name}，保留原身份、年龄、饥渴与健康。`,r.at,[c.id]);}
 else if(a.operation==='feedCrate'||a.operation==='waterCrate'){const c=state.livestockCargo!.find(c=>c.id===a.animalId)!;change(r.inventory,{[a.operation==='feedCrate'?'fodder':'water']:1},-1);careForCrate(w,c,a.operation==='waterCrate');fact(w,r,`${r.name}用本人实物照料了运输笼内的${animalNames[c.kind]}。`,r.at,[c.id]);}
 else if(a.operation==='feedAnimal'){
  change(r.inventory,{fodder:1},-1);
  const hunger=n!.hunger;n!.hunger=Math.max(0,hunger-rules.animalFeedRelief);
  recordLivestockNourishment(w,n!,hunger-n!.hunger);
  fact(w,r,`${r.name}自愿用本人饲料喂养${name(w,n!.ownerId)}的${animalNames[n!.kind]}。`,r.at,[n!.id]);
 }
 else if(a.operation==='waterAnimal'){change(r.inventory,{water:1},-1);n!.thirst=Math.max(0,n!.thirst-rules.animalWaterRelief);fact(w,r,`${r.name}自愿为${animalNames[n!.kind]}提供本人清水。`,r.at,[n!.id]);}
 else if(a.operation==='collectAnimal'){const item=animalProducts[n!.kind];change(r.inventory,{[item]:n!.product});state.totals.animalProducts+=n!.product;fact(w,r,`${r.name}实际收集${n!.product}份${itemLabels[item]}。`,r.at,[n!.id]);n!.product=0;}
 else if(a.operation==='breedAnimal'){n!.pregnancy={sireId:a.partnerId!,dueAt:w.minute+rules[`${n!.kind}PregnancyDays`]*DAY};fact(w,r,`${r.name}决定让本人健康成年${animalNames[n!.kind]}繁育，已为幼畜预留畜舍位置。`,r.at,[n!.id,a.partnerId!]);}
 else if(a.operation==='moveAnimal'){
  const destination=a.pastureId?a.at!:b!.door;
  const label=a.pastureId?`${b!.name}旁的牧场`:b!.name;
  if(a.phase!=='delivery'){
   if(!r.activity||r.activity.action!==a)return '护送需要本人实际执行的移动安排';
   if(n!.inside&&r.inside!==n!.inside)return '须进入动物所在室内亲自接出';
   if(n!.roomAt&&r.roomAt&&distance(n!.roomAt,r.roomAt)>1)return '须亲自走到动物身边';
   const path=findPath(w,r.at,destination);if(path===null)return '护送路线已阻断';
   n!.carrierId=r.id;n!.at={...r.at};n!.inside=r.inside;n!.roomAt=r.roomAt?{...r.roomAt}:null;n!.destinationId=b!.id;
   delete n!.pastureId;
   a.phase='delivery';r.activity.path=path;r.activity.target={...destination};r.activity.remaining=15;r.activity.travelProgress=0;prepareRoomExit(w,r);
   fact(w,r,`${r.name}实际接出自有${animalNames[n!.kind]}，开始护送到${label}。`,r.at,[n!.id]);return null;
  }
  if(n!.carrierId!==r.id||r.inside!==(a.pastureId?null:b!.id))return '没有本人实际护送并送入指定地点的动物';
  if(n!.barnId!==b!.id)n!.pen=nextAnimalPen(w,b!.id);
  n!.barnId=b!.id;n!.carrierId=null;delete n!.roomAt;n!.destinationId=null;
  if(a.pastureId){n!.at={...destination};n!.inside=null;n!.pastureId=a.pastureId;}
  else{delete n!.at;delete n!.inside;}
  fact(w,r,`${r.name}沿实际路线把自有${animalNames[n!.kind]}送到${label}。`,r.at,[n!.id]);
 }
 else if(['plantHouse','tendHouse','harvestHouse'].includes(a.operation)){
  let bed=state.beds.find(p=>p.buildingId===b!.id&&p.index===a.bed);if(!bed){bed={id:`bed:${b!.id}:${a.bed}`,buildingId:b!.id,index:a.bed!,crop:null};state.beds.push(bed);}
  if(a.operation==='plantHouse'){change(r.inventory,{...w.definitions[a.cropId!].cost,water:(w.definitions[a.cropId!].cost?.water??0)+1},-1);bed.crop={ownerId:r.id,definition:a.cropId!,growth:0,wateredDay:Math.floor(w.minute/DAY),lastMinute:w.minute};fact(w,r,`${r.name}在温室种植床${a.bed!+1}播种，季节保护不替代种水与实际生长。`);}
  else if(a.operation==='tendHouse'){change(r.inventory,{water:1},-1);bed.crop!.wateredDay=Math.floor(w.minute/DAY);}
  else{const d=w.definitions[bed.crop!.definition],item=(d.data.output??'turnip') as Item;change(r.inventory,{[item]:Number(d.data.yield)});bed.crop=null;fact(w,r,`${r.name}实际收获一床温室作物。`);}
 }else if(a.operation==='hunt'){
  const problem=completeHunt(w,r,a);if(problem)return problem;
 }else if(a.operation==='fish'){
  const pool=fishingStockAt(w,a.at!)!,window=fishWindow(w,a.at!);
  pool.amount--;toolFor(w,r,'rod')!.durability--;change(r.inventory,{fish:1});state.totals.fish++;
  if(state.fishingExperience)state.fishingExperience[r.id]=Math.min(10,(state.fishingExperience[r.id]??0)+.5);
  else r.skills.farming+=.01;
  emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},animalIds:['shoal:'+fishingKey(waterAtShore(w,a.at!)!)],
   text:`${r.name}在${window.habitat==='coast'?'海岸':window.habitat==='lake'?'湖岸':'河岸'}实际钓获一份${window.name}。当地鱼群余${pool.amount}，钓具实际磨损一次。`});
 }else if(a.operation==='shoreRest'){
  r.energy=Math.min(100,r.energy+4);
  fact(w,r,`${r.name}在水边坐了一会儿，恢复了一些体力。`);
 }else if(a.operation==='mine'){m!.remaining[m!.depth]--;if(m!.depth===0){const rock=w.resources.find(v=>v.id===m!.resourceId);if(rock)rock.amount--;}toolFor(w,r,'pick')!.durability--;change(r.inventory,{ore:m!.depth+1,coal:rules.mineCoal,stone:rules.mineStone});state.totals.ore+=m!.depth+1;m!.exploredBy[r.id]=m!.depth;r.skills.building+=.01;const risk=m!.depth*rules.mineRiskPerDepth;if(risk&&r.skills.building<rules.mineSafeSkill){r.health=Math.max(0,r.health-risk);addHealthCase(w,r,'injury',risk*rules.mineSeverity,'本人实际参与深层采矿的损伤');}fact(w,r,`${r.name}在已探明矿口第${m!.depth+1}层实际开采，取得${m!.depth+1}份铁矿、1煤和1石${risk&&r.skills.building<rules.mineSafeSkill?'，深层劳作造成了轻度伤害':''}。`);
 }else if(a.operation==='deepen'){change(r.inventory,{plank:rules.supportPlank,bar:rules.supportBar},-1);m!.depth++;m!.exploredBy[r.id]=m!.depth;fact(w,r,`${r.name}实际支护并开拓矿口至第${m!.depth+1}层，该层有限矿量为${m!.remaining[m!.depth]}。`);}
 w.processed.push(mark);r.revision++;w.revision++;return null;
}
export function advanceIndustry(w:World){
 initializeIndustry(w);advanceFixtureRemoval(w);const s=w.industry;if(!s)return;const day=Math.floor(w.minute/DAY),season=calendar(w.minute).season;
 advancePastures(w);
 for(const n of s.animals)if(n.status==='alive'&&n.pen===undefined)n.pen=nextAnimalPen(w,n.barnId);
 for(const tree of s.trees){const rules=industryDefinition(w,tree.definition).rules;const dt=Math.max(0,w.minute-tree.lastMinute);tree.lastMinute=w.minute;if(tree.status==='cut')continue;const wet=tree.lastWateredDay===day||w.weather==='rain';if(wet&&tree.status==='growing'){tree.growth+=dt;if(tree.growth>=rules.treeGrowthDays*DAY)tree.status='mature';}if(tree.status==='mature'&&season!=='winter'&&wet&&tree.fruit<rules.treeMaximumFruit){tree.fruitProgress+=dt;const fruit=Math.min(rules.treeMaximumFruit-tree.fruit,Math.floor(tree.fruitProgress/(rules.treeFruitDays*DAY)));if(fruit)foodTransaction(w,()=>{tree.fruit+=fruit;});tree.fruitProgress-=fruit*rules.treeFruitDays*DAY;}}
 for(const n of s.animals){
  const rules=industryDefinition(w,n.definition).rules,dt=Math.max(0,w.minute-n.lastMinute);
  n.lastMinute=w.minute;if(n.status==='dead')continue;
  const demand=n.kind==='cow'?1.35:n.kind==='duck'?.90:1;
  n.hunger=Math.min(100,n.hunger+demand*dt/rules.animalHungerMinutes);
  n.thirst=Math.min(100,n.thirst+demand*dt/rules.animalThirstMinutes);
  if(n.hunger>rules.animalDanger||n.thirst>rules.animalDanger)n.health=Math.max(0,n.health-dt*rules.animalHealthDrain);
  const barn=building(w,n.barnId);
  if(!barn||barn.condition<=0)n.health=Math.max(0,n.health-dt*rules.animalShelterDrain);
  const lifespan=animalYears(rules,n.kind)*YEAR;
  if(n.health<=0||w.minute-n.bornAt>=lifespan){recordLivestockDeath(w,n,n.health<=0?'长期照护不足':'衰老');continue;}
  if(w.scenario==='frontier'&&(n.carrierId||!n.pastureId)){
   const carrier=n.carrierId&&w.residents.find(person=>person.id===n.carrierId);
   const sheltered=!!barn&&barn.condition>0&&(n.inside===barn.id||!n.at);
   n.energy=Math.max(0,Math.min(100,(n.energy??85)+dt*(sheltered?.076:-.025)));
   const at=n.at??barn?.door;
   if(carrier)n.activity={kind:'transport',reason:'主人正在实际护送',target:building(w,n.destinationId??undefined)?.door,targetId:carrier.id};
   else if(n.thirst>72||n.hunger>72)n.activity={kind:n.thirst>72?'drink':'forage',reason:n.thirst>72?'口渴，等待可接触的清水':'饥饿，等待送来的饲料',target:at};
   else n.activity={kind:sheltered?'shelter':'roam',reason:sheltered?'在可用畜舍休息':'停在户外，等待接回牧场或畜舍',target:at};
  }
  if(n.hunger<rules.animalProductThreshold&&n.thirst<rules.animalProductThreshold&&w.minute-n.bornAt>=rules.animalAdultDays*DAY&&n.product<rules.animalMaximumProduct&&(n.kind==='sheep'||n.sex==='female')&&(n.kind!=='cow'||(n.lactatesUntil??0)>w.minute)){n.progress+=dt;const interval=rules[`${n.kind}ProductDays`]*DAY;const amount=Math.min(rules.animalMaximumProduct-n.product,Math.floor(n.progress/interval));if(amount)foodTransaction(w,()=>{n.product+=amount;});n.progress-=amount*interval;}
  if(n.pregnancy&&n.pregnancy.dueAt<=w.minute){
   n.pregnancy=null;
   const baby={...n,definition:industryDefinition(w).definition,id:'animal:'+s.nextSerial++,sex:s.nextSerial%2?'female' as const:'male' as const,bornAt:w.minute,carrierId:null,destinationId:null,pen:nextAnimalPen(w,n.barnId),hunger:30,thirst:30,health:90,product:0,progress:0,pregnancy:null,lastMinute:w.minute,activity:undefined,energy:90,lactatesUntil:undefined};
   if(n.kind==='cow')n.lactatesUntil=w.minute+112*DAY;
   const yard=s.pastures?.find(p=>p.id===n.pastureId);
   if(yard&&n.at){
    const motherAt=n.at;
    const newbornAt=yard.tiles.filter(at=>pastureTileFree(w,at)).sort((a,b)=>distance(a,motherAt)-distance(b,motherAt))[0];
    if(newbornAt)baby.at={...newbornAt};
   }
   s.animals.push(baby);s.totals.animalBirths++;
   const owner=w.residents.find(r=>r.id===n.ownerId);
   if(owner)fact(w,owner,`一只${animalNames[n.kind]}幼畜实际出生，进入${barn?.name??'原畜舍'}的照料与容量记录。`,baby.at??barn?.door??owner.at,[n.id,baby.id]);
  }
 }
 for(const bed of s.beds)if(bed.crop){const dt=Math.max(0,w.minute-bed.crop.lastMinute);bed.crop.lastMinute=w.minute;const b=building(w,bed.buildingId);if(b&&b.condition>0&&bed.crop.wateredDay===day)bed.crop.growth+=dt/DAY;}
 advanceFishing(w);
 for(const batch of s.batches)if(batch.status==='working'){const owner=w.residents.find(r=>r.id===batch.ownerId);if(owner?.status==='dead'){const estate=w.estates.find(e=>e.personId===owner.id);if(estate)foodTransaction(w,()=>{change(estateStock(w,owner.id,'craft:'+batch.id,estateBuildingLocation(w,batch.buildingId,'原加工工位保全原料',true,batch.recipe.station??undefined))!,batch.input);batch.input={};batch.status='cancelled';});}}
 if(s.batches.length>200)s.batches=s.batches.filter((b,i)=>b.status==='working'||i>=s.batches.length-80);
}
export function industryAssets(w:World,id:string):string[]{
 const s=w.industry;if(!s)return [];
 return [...(w.ferries?.boats.filter(b=>b.ownerId===id).map(b=>b.id)??[]),...s.tools.filter(t=>t.ownerId===id).map(t=>t.id),...s.trees.filter(t=>t.ownerId===id&&t.status!=='cut').map(t=>t.id),...s.animals.filter(a=>a.ownerId===id&&(a.status==='alive'||a.product>0)).map(a=>a.id),...s.beds.filter(b=>b.crop?.ownerId===id).map(b=>b.id)];
}
export function hasIndustryAssets(w:World,id:string){return hasFerryAssets(w,id)||!!w.industry?.batches.some(b=>b.ownerId===id&&b.status==='working');}
export function inheritIndustry(w:World,from:string,to:string,ids:string[]){
 const s=w.industry;if(!s)return;const heir=w.residents.find(r=>r.id===to)!;
 for(const b of w.ferries?.boats??[])if(b.ownerId===from&&ids.includes(b.id)){b.ownerId=to;heir.knownDocks??=[];if(b.dockId&&!heir.knownDocks.includes(b.dockId))heir.knownDocks.push(b.dockId);}
 for(const t of s.tools)if(t.ownerId===from&&ids.includes(t.id))t.ownerId=to;
 for(const t of s.trees)if(t.ownerId===from&&ids.includes(t.id))t.ownerId=to;
 for(const a of s.animals)if(a.ownerId===from&&ids.includes(a.id)){a.ownerId=to;if(!heir.knownBuildings.includes(a.barnId))heir.knownBuildings.push(a.barnId);}
 for(const b of s.beds)if(b.crop?.ownerId===from&&ids.includes(b.id)){b.crop.ownerId=to;if(!heir.knownBuildings.includes(b.buildingId))heir.knownBuildings.push(b.buildingId);}
}

export function completeIndustry(w:World,r:Resident,a:IndustryAction):string|null{return foodTransaction(w,()=>completeIndustryAtomic(w,r,a));}

export function nextAnimalPen(w:World,barnId:string){const taken=new Set<number>();for(const n of w.industry?.animals??[])if(n.barnId===barnId&&n.status==='alive'&&n.pen!==undefined)taken.add(n.pen);let i=0;while(taken.has(i))i++;return i;}

/** A failed escort leaves the animal at its last actual position, without returning it by teleport. */
export function syncAnimalTransport(w:World){for(const n of w.industry?.animals??[]){if(!n.carrierId)continue;const r=w.residents.find(r=>r.id===n.carrierId);if(!r||r.status!=='alive'||r.activity?.action.type!=='industry'||r.activity.action.operation!=='moveAnimal'||r.activity.action.animalId!==n.id){n.carrierId=null;n.destinationId=null;continue;}n.at={...r.at};n.inside=r.inside;n.roomAt=r.roomAt?{...r.roomAt}:null;}}
