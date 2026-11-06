import {estateGoods,splitEstateParcels,acceptEstateParcels,ownedEstateParcels,estateParcel,atEstateParcel} from './estate-custody.js';
import {pendingEstateReturns} from './estate-pending.js';
import {hasEstateDebt,debtClaims,inheritDebtClaims} from './debt.js';
import {deathProof} from './knowledge.js';
import {foodTransaction} from './food.js';
import {industryAssets,inheritIndustry} from './industry.js';
import {itemKeys} from '../shared/items.js';
import type {Building, ContentDefinition, Inventory, Item, Resident, Vec, World} from '../shared/types.js';
import type {InheritanceShare, ProductionAction} from '../shared/production.js';
import {moveCoins} from './economy.js';
import {constructionLand,insideProject} from './construction-sites.js';
import {pastureContains} from './pasture.js';
import {advanceFrontierNutrients,initializeFrontierNutrients,soilFertility} from './frontier-nutrients.js';
import {emitEvent} from './events.js';
import {distance, same, walkable} from './navigation.js';
import {ageYears, calendar, DAY} from './time.js';
import type {BuildingParcel} from './starting-content.js';

/** Food is measured in portions. These varieties share the root-vegetable inventory. */
export const productiveCrops:ContentDefinition[]=[
  {id:'crop/turnip',version:2,kind:'recipe',dependencies:[],cost:{seed:1},minutes:4*DAY,
    data:{name:'春秋芜菁',growthDays:4,seasons:['spring','autumn'],yield:12}},
  {id:'crop/summer-root',version:1,kind:'recipe',dependencies:[],cost:{seed:1},minutes:4*DAY,
    data:{name:'夏季耐热根菜',growthDays:4,seasons:['summer'],yield:12}},
  {id:'crop/winter-root',version:1,kind:'recipe',dependencies:[],cost:{seed:1},minutes:6*DAY,
    data:{name:'冬季耐寒根菜',growthDays:6,seasons:['winter'],yield:18}},
];
productiveCrops.push(
 {id:'crop/grain',version:1,kind:'recipe',dependencies:[],cost:{seed:1},minutes:6*DAY,data:{name:'季节谷物',growthDays:6,seasons:['spring','summer','autumn'],yield:10,output:'grain'}},
 {id:'crop/flax',version:1,kind:'recipe',dependencies:[],cost:{seed:1},minutes:5*DAY,data:{name:'纤维作物',growthDays:5,seasons:['spring','summer'],yield:8,output:'fiber'}},
);
export const cropKeys=productiveCrops.map(d=>d.id+'@'+d.version);
export function availableCropKeys(w:World){const keys=new Set<string>();for(const key of cropKeys){const d=w.definitions[key],active=d&&w.activeDefinitions[d.id];keys.add(active&&active!=='crop/turnip@1'?active:key);}for(const [id,key]of Object.entries(w.activeDefinitions))if(id.startsWith('crop/')&&key!=='crop/turnip@1')keys.add(key);return [...keys].filter(key=>w.definitions[key]?.kind==='recipe'&&w.definitions[key].id.startsWith('crop/'));}
const items:Item[]=itemKeys;
const adult=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([key,n])=>(bag[key as Item]??0)>=n!);
const debit=(bag:Inventory,cost:Inventory)=>{for(const [key,n]of Object.entries(cost))bag[key as Item]=(bag[key as Item]??0)-n!;};
const credit=(bag:Inventory,goods:Inventory)=>{for(const [key,n]of Object.entries(goods))bag[key as Item]=(bag[key as Item]??0)+n!;};

/** Old crops retain their immutable definitions; only new, explicit choices use these varieties. */
export function initializeProduction(w:World):void {
  if(w.mode!=='formal')return;
  w.production??={lastMinute:w.minute,lastDay:Math.floor(w.minute/DAY),ecology:{},inheritances:{},knownDeaths:{},lastEventRevision:0,parcelOwners:{},seedSaved:0,reclaimedPlots:0,repairs:0};
  initializeFrontierNutrients(w);
  for(const [id,saved] of Object.entries(w.production.inheritances)){const shares=saved.shares.filter(s=>s.claimedAt===null);if(shares.length&&shares.some(s=>s.goodsClaims===undefined)){const claims=foodTransaction(w,()=>splitEstateParcels(w,id,shares.map(s=>s.heirId),shares.map(s=>s.id)));shares.forEach((s,i)=>s.goodsClaims=claims[i]);}}
  w.production.knownDeaths??={};
  w.production.parcelOwners??={};
  for(const def of productiveCrops){const key=def.id+'@'+def.version;if(!w.definitions[key])w.definitions[key]=structuredClone(def);}
  for(const resource of w.resources)w.production.ecology[resource.id]??={progress:0};
  for(let i=w.events.length-1;i>=0;i--){
    const fact=w.events[i],revision=Number(fact.id.split(':').at(-1));
    if(Number.isFinite(revision)&&revision<=(w.production.lastEventRevision??0))break;
    if(fact.kind!=='death'||!fact.actors[0])continue;
    for(const id of fact.witnesses){const known=w.production.knownDeaths[id]??=[];if(!known.includes(fact.actors[0]))known.push(fact.actors[0]);}
  }
  w.production.lastEventRevision=w.revision;
}

/** Nature replenishes existing resource sites; harvesting does not restart their growth clock. */
export function advanceProduction(w:World):void {
  if(w.mode!=='formal')return;
  initializeProduction(w);
  const state=w.production!,elapsed=Math.max(0,w.minute-state.lastMinute);
  for(const [id,inheritance]of Object.entries(state.inheritances)){
    const updated:InheritanceShare[]=[];
    for(const share of inheritance.shares){
      if(share.claimedAt!==null||w.residents.some(p=>p.id===share.heirId&&p.status==='alive')){updated.push(share);continue;}
      const heirs=successors(w,w.estates.find(e=>e.personId===share.heirId)?.heirs??w.residents.filter(p=>(p.parents.includes(share.heirId)||p.adoptiveParents?.includes(share.heirId))).map(p=>p.id));
      if(!heirs.length){updated.push(share);continue;}
      const goods=foodTransaction(w,()=>splitEstateParcels(w,id,heirs,heirs.map((_,i)=>share.id+'.'+i),share.goodsClaims??[]));
      for(const [index,heirId]of heirs.entries())updated.push({goodsClaims:goods[index],id:share.id+'.'+index,heirId,claimedAt:null,
        coins:split(share.coins,index,heirs.length),inventory:Object.fromEntries(items.map(item=>[item,split(share.inventory[item]??0,index,heirs.length)]).filter(([,n])=>Number(n)>0)) as Inventory,
        plots:share.plots.filter((_,i)=>i%heirs.length===index),buildings:share.buildings.filter((_,i)=>i%heirs.length===index),parcels:share.parcels.filter((_,i)=>i%heirs.length===index),industryAssets:(share.industryAssets??[]).filter((_,i)=>i%heirs.length===index),creditClaims:(share.creditClaims??[]).filter((_,i)=>i%heirs.length===index)});
    }
    inheritance.shares=updated;
    // Unclaimed rights pass to a deceased heir's descendants, never to an administrator's purse.
    if(updated.some(s=>s.claimedAt===null)){const estate=w.estates.find(e=>e.personId===id);if(estate)estate.status='protected';}
  }
  if(!elapsed)return;
  for(const resource of w.resources){
    if(resource.regrowthDays<=0||resource.max<=0)continue;
    const progress=state.ecology[resource.id];
    const covered=w.buildings.some(b=>resource.at.x>=b.at.x&&resource.at.x<b.at.x+b.width&&resource.at.y>=b.at.y&&resource.at.y<b.at.y+b.height)
      ||w.plots.some(p=>same(p.at,resource.at))||w.construction?.projects.some(p=>p.reserved&&insideProject(p,resource.at));
    if(covered||resource.amount>=resource.max){progress.progress=0;continue;}
    progress.progress+=elapsed*resource.max/(resource.regrowthDays*DAY);
    const whole=Math.floor(progress.progress+1e-10);
    if(whole<1)continue;
    const solid=resource.kind==='tree'||resource.kind==='rock';
    if(solid&&resource.amount<=0&&w.residents.some(r=>r.residency!=='outside'&&same(r.at,resource.at))){progress.progress=Math.min(progress.progress,1);continue;}
    const recovered=Math.min(whole,resource.max-resource.amount);
    resource.amount+=recovered;progress.progress-=recovered;
    if(resource.amount>=resource.max)progress.progress=0;
  }
  const day=Math.floor(w.minute/DAY),days=Math.max(0,day-state.lastDay);
  if(days)for(const building of w.buildings)building.condition=Math.max(0,Math.round((building.condition-days*.1)*1000)/1000);
  advanceFrontierNutrients(w);
  state.lastDay=day;state.lastMinute=w.minute;
}

export function productionParcels(w:World):BuildingParcel[]{
  const parcels=(w.definitions['land/start@1']?.data.parcels??[]) as BuildingParcel[];
  return parcels.map((parcel,index)=>({...parcel,ownerId:w.production?.parcelOwners[index]??parcel.ownerId}));
}
function plotClaimError(w:World,r:Resident,at:Vec):string|null {
  if(r.residency!=='resident')return '须先自行定居，才能申请本镇耕地使用权';
  if(!Number.isInteger(at.x)||!Number.isInteger(at.y)||distance(r.at,at)>8)return '只能申请自己眼前已经查看的土地';
  if(w.plots.filter(p=>p.ownerId===r.id).length>=6)return '个人现有耕地已达六块，请先经营现有土地';
  if(at.x<0||at.x>=w.map.width||at.y<144||at.y>=336)return '此处不在开放耕作的谷地与河岸区域';
  if(!walkable(w,at)||!['grass','soil'].includes(w.map.tiles[at.y*w.map.width+at.x]))return '此处没有可耕作的平地';
  if(pastureContains(w,at))return '不能把正在使用的牧场开垦为农田';
  if(w.plots.some(p=>same(p.at,at))||w.graves.some(g=>distance(g.at,at)<=1)||w.resources.some(s=>same(s.at,at)))return '这块地已有耕作权、墓位或自然资源用途';
  if(w.buildings.some(b=>distance(b.door,at)<=1)||w.residents.some(p=>p.id!==r.id&&p.residency!=='outside'&&same(p.at,at)))return '此处是出入口或有人正在使用';
  if(constructionLand(w,at))return '此处已有建设用地、院落或工地登记';
  if(!has(r.inventory,{wood:1}))return '开垦需要自有的一份木材制作田界';
  return null;
}
export function nearbyClaimablePlot(w:World,r:Resident):Vec|undefined {
  if(!adult(w,r)||r.inside||r.residency!=='resident'||w.plots.filter(p=>p.ownerId===r.id).length>=6)return;
  for(let radius=0;radius<=4;radius++)for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(Math.abs(dx)+Math.abs(dy)!==radius)continue;
    const at={x:r.at.x+dx,y:r.at.y+dy};if(!plotClaimError(w,r,at))return at;
  }
}

function knownDeath(w:World,r:Resident,id:string):boolean {
  const subject=w.residents.find(p=>p.id===id);
  return !!subject&&subject.status==='dead'&&r.knownPeople.includes(id)&&!!deathProof(w,r,id);
}
function successors(w:World,ids:string[],seen=new Set<string>()):string[]{
  const result:string[]=[];
  for(const id of ids){
    if(seen.has(id))continue;seen.add(id);
    if(id.startsWith('unborn:')){result.push(id);continue;}
    const p=w.residents.find(p=>p.id===id);
    if(p?.status==='alive')result.push(id);
    else if(p)result.push(...successors(w,w.estates.find(e=>e.personId===id)?.heirs??w.residents.filter(child=>(child.parents.includes(id)||child.adoptiveParents?.includes(id))).map(p=>p.id),seen));
  }
  return [...new Set(result)];
}
function estateHeirs(w:World,id:string):string[]{
  const estate=w.estates.find(e=>e.personId===id),person=w.residents.find(p=>p.id===id);
  if(!estate||!person)return [];
  let ids=successors(w,estate.heirs);
  if(!ids.length)ids=successors(w,person.relations.filter(r=>r.partner==='married').map(r=>r.targetId));
  if(!ids.length)ids=successors(w,[...person.parents,...(person.adoptiveParents??[])]);
  if(!ids.length)ids=successors(w,person.relations.filter(r=>(r.kin==='sibling'||r.adoptive==='sibling')).map(r=>r.targetId));
  return ids.sort();
}
function registryPlace(w:World,r:Resident,id:string):Building|undefined {
  const person=w.residents.find(p=>p.id===id);
  const ownHome=w.buildings.find(b=>b.id===person?.homeId&&r.knownBuildings.includes(b.id));
  return ownHome??w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons'&&r.knownBuildings.includes(b.id)&&distance(r.at,b.door)<=8);
}
function inheritanceError(w:World,r:Resident,id:string):string|null {
  const estate=w.estates.find(e=>e.personId===id);
  if(!estate||estate.status!=='protected'||!knownDeath(w,r,id))return '尚无本人已获知并可领取的保全遗产';
  const pending=pendingEstateReturns(w,id);if(pending)return pending;
  if(hasEstateDebt(w,id))return '逝者已登记的借款义务尚待按原条款清算，不能先把现金分走';
  const saved=w.production?.inheritances[id];
  const heirs=saved?saved.shares.filter(s=>s.claimedAt===null).map(s=>s.heirId):estateHeirs(w,id);
  if(heirs.some(id=>id.startsWith('unborn:')))return '尚有未出生子女的受保护份额，须等待出生事实确定';
  if(!heirs.includes(r.id))return '本人没有尚未领取的继承份额';
  if(!registryPlace(w,r,id))return '须先找到已知旧宅或本地登记处，亲自办理';
  return null;
}
function split(amount:number,index:number,count:number){return Math.floor(amount/count)+(index<amount%count?1:0);}
/** Pregnancy references become real identities only when the life module records a birth. */
export function resolveInheritanceBirth(w:World,pendingId:string,childId:string|null):void {
  for(const [id,inheritance]of Object.entries(w.production?.inheritances??{})){
    const updated:InheritanceShare[]=[];
    for(const share of inheritance.shares){
      if(share.heirId!==pendingId||share.claimedAt!==null){updated.push(share);continue;}
      if(childId){share.heirId=childId;updated.push(share);continue;}
      const heirs=estateHeirs(w,id).filter(id=>id!==pendingId);
      if(!heirs.length){updated.push({...share,heirId:`unclaimed:${pendingId}`});continue;}
      const goods=foodTransaction(w,()=>splitEstateParcels(w,id,heirs,heirs.map((_,i)=>share.id+'.loss.'+i),share.goodsClaims??[]));
      for(const [index,heirId]of heirs.entries())updated.push({goodsClaims:goods[index],id:share.id+'.loss.'+index,heirId,claimedAt:null,
        coins:split(share.coins,index,heirs.length),inventory:Object.fromEntries(items.map(item=>[item,split(share.inventory[item]??0,index,heirs.length)]).filter(([,n])=>Number(n)>0)) as Inventory,
        plots:share.plots.filter((_,i)=>i%heirs.length===index),buildings:share.buildings.filter((_,i)=>i%heirs.length===index),parcels:share.parcels.filter((_,i)=>i%heirs.length===index),industryAssets:(share.industryAssets??[]).filter((_,i)=>i%heirs.length===index),creditClaims:(share.creditClaims??[]).filter((_,i)=>i%heirs.length===index)});
    }
    inheritance.shares=updated;
  }
}
function prepareShares(w:World,id:string):InheritanceShare[]{
  const state=w.production!,saved=state.inheritances[id];if(saved)return saved.shares;
  const estate=w.estates.find(e=>e.personId===id)!,heirs=estateHeirs(w,id);
  const goods=estateGoods(w,id),claims=splitEstateParcels(w,id,heirs,heirs.map((_,i)=>String(i)));
  const shares=heirs.map((heirId,index)=>({goodsClaims:claims[index],id:String(index),heirId,coins:split(estate.coins,index,heirs.length),
    inventory:Object.fromEntries(items.map(item=>[item,split(goods[item]??0,index,heirs.length)]).filter(([,n])=>Number(n)>0)) as Inventory,
    plots:[] as string[],buildings:[] as string[],parcels:[] as number[],industryAssets:[] as string[],creditClaims:[] as string[],claimedAt:null as number|null}));
  w.plots.filter(p=>p.ownerId===id).sort((a,b)=>a.id.localeCompare(b.id)).forEach((p,index)=>shares[index%shares.length].plots.push(p.id));
  w.buildings.filter(b=>b.ownerId===id).sort((a,b)=>a.id.localeCompare(b.id)).forEach((b,index)=>shares[index%shares.length].buildings.push(b.id));
  productionParcels(w).forEach((p,index)=>{if(p.ownerId===id)shares[index%shares.length].parcels.push(index);});
  industryAssets(w,id).sort().forEach((asset,index)=>shares[index%shares.length].industryAssets.push(asset));
  debtClaims(w,id).sort().forEach((claim,index)=>shares[index%shares.length].creditClaims.push(claim));
  state.inheritances[id]={createdAt:w.minute,shares};return shares;
}

export function productionTarget(w:World,r:Resident,a:ProductionAction):{target:Vec;duration:number;error?:string} {
  const fail=(error:string)=>({target:r.at,duration:0,error});
  if(a.operation==='collectEstate'){const p=estateParcel(w,a.parcelId);if(w.mode!=='formal'||!adult(w,r)||!p||p.ownerId!==r.id||p.claimId||!Object.values(p.inventory).some(n=>n!>0))return fail('没有已登记归本人、尚待实际领取的原址遗产物资');if(p.location.inside&&!w.buildings.some(b=>b.id===p.location.inside))return fail('原储物建筑已不存在，物资位置须先实际核验');return {target:{...p.location.at},duration:5};}
  if(w.mode!=='formal'||!adult(w,r))return fail('此项生产或财产安排须由有决定能力的成年人本人办理');
  if(a.operation==='collectManure'){
    const heap=w.production?.nutrients?.heaps.find(pile=>pile.id===a.heapId&&pile.ownerId===r.id&&pile.units>0);
    return heap&&!r.inside&&distance(r.at,heap.at)<=12&&walkable(w,heap.at)?{target:heap.at,duration:10}:fail('附近没有本人可收集的畜粪');
  }
  if(a.operation==='fertilize'){
    const plot=w.plots.find(p=>p.id===a.plotId&&p.ownerId===r.id);
    const orchard=w.industry?.trees.some(tree=>tree.plotId===plot?.id&&tree.status!=='cut');
    return w.production?.nutrients&&plot&&!orchard&&!r.inside&&distance(r.at,plot.at)<=8&&soilFertility(w,plot.id)<=75&&has(r.inventory,{compost:1})?{target:plot.at,duration:15}:fail('施肥需要附近可种季节作物的本人田地、实际堆肥与可容纳的肥力');
  }
  if(a.operation==='saveSeed')return has(r.inventory,{turnip:1})?{target:r.at,duration:15}:fail('留种需要本人一份实际根菜');
  if(a.operation==='plantCrop'||a.operation==='clearPlot'){
    const p=w.plots.find(p=>p.id===a.plotId&&p.ownerId===r.id);
    if(!p)return fail('没有这块田地的本人使用权');
    if(a.operation==='clearPlot')return p.crop?{target:p.at,duration:10}:fail('田里没有需要清理的作物');
    if(p.crop||w.industry?.trees.some(t=>t.plotId===p.id&&t.status!=='cut'))return fail('这块地已经种有作物或果树');
    if(!a.cropId||w.definitions[a.cropId]?.kind!=='recipe'||!w.definitions[a.cropId].id.startsWith('crop/'))return fail('没有这种已登记的种植方法');
    const def=w.definitions[a.cropId!];
    if(!(def.data.seasons as string[]).includes(calendar(w.minute).season))return fail('当前季节不适合这种作物');
    if(!has(r.inventory,def.cost??{seed:1}))return fail('没有实际种子');
    return {target:p.at,duration:15};
  }
  if(a.operation==='claimPlot'){
    if(!a.at)return fail('没有选定的土地');
    const reason=plotClaimError(w,r,a.at);return reason?fail(reason):{target:{...a.at},duration:45};
  }
  if(a.operation==='repair'){
    const b=w.buildings.find(b=>b.id===a.buildingId&&b.ownerId===r.id&&r.knownBuildings.includes(b.id));
    if(!b)return fail('只能修缮本人已知且拥有的建筑');
    if(b.condition>=100)return fail('房屋目前无需修缮');
    return has(r.inventory,{wood:2,stone:1})?{target:b.door,duration:60}:fail('修缮需要本人的两份木材和一份石料');
  }
  if(a.operation==='inherit'){
    const reason=inheritanceError(w,r,a.personId??'');
    return reason?fail(reason):{target:{...registryPlace(w,r,a.personId!)!.door},duration:20};
  }
  return fail('没有这种生产安排');
}

function completeProductionAtomic(w:World,r:Resident,a:ProductionAction):string|null {
  initializeProduction(w);
  const route=productionTarget(w,r,a);if(route.error)return route.error;
  if(!same(r.at,route.target))return '须本人实际抵达工作地点';
  const fact=(text:string)=>emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},text});
  if(a.operation==='collectManure'){
    const state=w.production!.nutrients!,heap=state.heaps.find(pile=>pile.id===a.heapId)!;
    const amount=Math.min(2,heap.units);
    heap.units-=amount;state.collected+=amount;
    if(!heap.units)state.heaps=state.heaps.filter(pile=>pile!==heap);
    credit(r.inventory,{manure:amount});
    emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},text:`${r.name}在饲养地收集了 ${amount} 份实际留下的畜粪。`});
    return null;
  }
  if(a.operation==='fertilize'){
    const state=w.production!.nutrients!,id=a.plotId!;
    const before=soilFertility(w,id);
    debit(r.inventory,{compost:1});
    state.soil[id]=before+22;state.fertilized++;
    emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},text:`${r.name}用一份堆肥改良了这块田，土壤肥力从 ${before} 升至 ${state.soil[id]}。`});
    return null;
  }
  if(a.operation==='collectEstate'){const p=estateParcel(w,a.parcelId)!;if(!atEstateParcel(r,p))return '须亲自走到封存物资的实际位置，登记不等于已经取货';credit(r.inventory,p.inventory);p.inventory={};fact(`${r.name}亲自到${p.location.label??'原存放处'}领取自己已经登记的物资，没有移动其他人的份额。`);return null;}
  if(a.operation==='saveSeed'){
    debit(r.inventory,{turnip:1});credit(r.inventory,{seed:2});w.production!.seedSaved+=2;r.energy=Math.max(0,r.energy-1);
    fact(`${r.name}把一份自有根菜留作种用，整理出了两份种子。`);return null;
  }
  if(a.operation==='plantCrop'){
    const p=w.plots.find(p=>p.id===a.plotId)!,def=w.definitions[a.cropId!];
    debit(r.inventory,def.cost??{seed:1});p.crop={definition:a.cropId!,planted:w.minute,growth:0,wateredDay:-1,lastGrowthDay:Math.floor(w.minute/DAY)};
    r.skills.farming+=.005;fact(`${r.name}消耗一份种子，在自己的田里播下了${def.data.name}。`);return null;
  }
  if(a.operation==='clearPlot'){
    w.plots.find(p=>p.id===a.plotId)!.crop=null;fact(`${r.name}自行清理了田里原有的作物，没有获得收成。`);return null;
  }
  if(a.operation==='claimPlot'){
    debit(r.inventory,{wood:1});const at=a.at!,id=`field-claimed-${at.x}-${at.y}`;
    w.plots.push({id,at:{...at},ownerId:r.id,crop:null});
    w.production!.reclaimedPlots++;fact(`${r.name}花费一份木材并完成开垦，登记了一块自用耕地。`);return null;
  }
  if(a.operation==='repair'){
    const b=w.buildings.find(b=>b.id===a.buildingId)!;debit(r.inventory,{wood:2,stone:1});b.condition=Math.min(100,b.condition+20);
    w.production!.repairs++;r.skills.building+=.02;fact(`${r.name}用两份木材和一份石料完成了${b.name}的修缮。`);return null;
  }
  const id=a.personId!,estate=w.estates.find(e=>e.personId===id)!;
  const share=prepareShares(w,id).find(s=>s.heirId===r.id&&s.claimedAt===null)!;
  if(estate.coins<share.coins)return '保全财产与登记份额不符，暂不交付';
  if(share.coins&&!moveCoins(w,`estate:${id}`,`resident:${r.id}`,share.coins,'继承本人登记份额',`inherit:${id}:${share.id}`))return '遗产钱款尚未完成交付';
  acceptEstateParcels(w,share.goodsClaims??[],r.id);
  for(const p of w.plots)if(share.plots.includes(p.id)&&p.ownerId===id)p.ownerId=r.id;
  for(const b of w.buildings)if(share.buildings.includes(b.id)&&b.ownerId===id){b.ownerId=r.id;if(!r.knownBuildings.includes(b.id))r.knownBuildings.push(b.id);}
  for(const index of share.parcels){const p=productionParcels(w)[index];if(p?.ownerId===id)w.production!.parcelOwners[index]=r.id;}
  // Unfinished structures follow their land or original building, including successor shares.
  for(const p of w.construction?.projects??[]){
    if(p.ownerId!==id||p.status!=='abandoned')continue;
    const inherits=p.base?share.buildings.includes(p.base.id):share.parcels.some(index=>{const lot=productionParcels(w)[index];return lot&&p.at.x>=lot.x&&p.at.x<lot.x+lot.width&&p.at.y>=lot.y&&p.at.y<lot.y+lot.height;});
    if(!inherits)continue;
    p.ownerId=r.id;p.managerId=r.id;if(p.base)p.base.ownerId=r.id;
    const known=w.construction!.knownProjects[r.id]??=[];if(!known.includes(p.id))known.push(p.id);
  }
  inheritIndustry(w,id,r.id,share.industryAssets??[]);inheritDebtClaims(w,id,r.id,share.creditClaims??[]);
  share.claimedAt=w.minute;
  if(!r.knownPeople.includes(id))r.knownPeople.push(id);
  const deaths=w.production!.knownDeaths[r.id]??=[];if(!deaths.includes(id))deaths.push(id);
  if(w.production!.inheritances[id].shares.every(s=>s.claimedAt!==null))estate.status='settled';
  fact(`${r.name}亲自登记了${w.residents.find(p=>p.id===id)?.name??'亲属'}的本人继承份额，包含 ${share.coins} 枚钱款、${share.plots.length} 块耕地和 ${share.buildings.length} 处建筑；实物留在各自原址，须亲自到场领取；其他人的份额仍各自保全。`);
  return null;
}

export function claimableInheritance(w:World,r:Resident):string|undefined {
  return w.estates.find(e=>!inheritanceError(w,r,e.personId))?.personId;
}

export function completeProduction(w:World,r:Resident,a:ProductionAction):string|null{return foodTransaction(w,()=>completeProductionAtomic(w,r,a));}
