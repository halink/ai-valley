import {retainedOutdoorSites} from '../shared/land-use.js';
import {activeLandRights,reservedLandRights,inLand,landConstructionError} from '../shared/land-rights.js';
import {currentPremisesLease} from '../shared/premises.js';
import {accountBalance} from './economy.js';
import {infrastructureFootprint,infrastructureSiteError,isInfrastructure} from './infrastructure.js';
import {infrastructureNames} from '../shared/infrastructure.js';
import type {TerrainWork} from '../shared/infrastructure.js';
import type {Building,BuildingKind,Inventory,Resident,Vec,World} from '../shared/types.js';
import type {ConstructionAction,ConstructionKind,ConstructionProject,ConstructionStage} from '../shared/construction.js';
import {productionParcels} from './production.js';
import {pastureContains} from './pasture.js';
import {distance,reachableTiles,same,walkable} from './navigation.js';

export const constructionNames:Record<ConstructionKind,string>={home:'住宅',lodge:'公共旅舍',workshop:'工坊',clinic:'照护所',school:'校舍',barn:'畜舍',greenhouse:'温室',store:'店铺',...infrastructureNames};
type Rect={x:number;y:number;width:number;height:number};
const inRect=(at:Vec,r:Rect)=>at.x>=r.x&&at.x<r.x+r.width&&at.y>=r.y&&at.y<r.y+r.height;
export const insideProject=(p:Pick<ConstructionProject,'at'|'width'|'height'>,at:Vec)=>inRect(at,{...p.at,width:p.width,height:p.height});
const insideBuilding=(b:Building,at:Vec)=>inRect(at,{...b.at,width:b.width,height:b.height});
export function constructionFootprint(w:World,a:ConstructionAction):{at:Vec;width:number;height:number;door:Vec;capacity:number;base:Building|null;definition:string;kind:ConstructionKind;cost:Inventory;minutes:number;terrain?:TerrainWork}|null {
 if(isInfrastructure(a.kind)||a.operation==='repairInfrastructure')return infrastructureFootprint(w,a);
 const base=a.operation==='expand'||a.operation==='convert'?w.buildings.find(b=>b.id===a.buildingId):undefined;
 const kind=a.operation==='convert'?a.kind:base?.kind??a.kind;if(!kind||!Object.hasOwn(constructionNames,kind))return null;
 const definition=(a.operation==='convert'?a.definition:base?.definition)??a.definition??w.activeDefinitions[`building/${kind}`];
 const d=w.definitions[definition];if(!d||d.kind!=='building'||d.id!==`building/${kind}`&&d.data.template!==kind)return null;
 const cost=d.cost;if(!cost||Object.entries(cost).some(([item,n])=>!['wood','stone'].includes(item)||!Number.isSafeInteger(n)||n!<0))return null;
 const width=base?.width??Number(d.data.width),height=base?.height??Number(d.data.height);
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||height<2||width>24||height>24)return null;
 if(a.operation==='convert'){if(!base||kind===base.kind&&definition===base.definition)return null;return {at:{...base.at},width:base.width,height:base.height,door:{...base.door},base,kind,definition,cost:{wood:Math.ceil((cost.wood??0)/2)+2,stone:Math.ceil((cost.stone??0)/2)+2},minutes:Math.ceil(Number(d.minutes??360)/2),capacity:Math.max(0,Math.min(Number(d.data.capacity??0),Math.floor(base.width*base.height/6)))};}
 if(a.operation==='expand'){
  if(!base||!['north','east','west'].includes(a.direction??'')||(base.extensions?.length??0)>=4)return null;
  const at={...base.at};let wide=width,high=height;
  if(a.direction==='north'){at.y-=2;high+=2;}else{wide+=2;if(a.direction==='west')at.x-=2;}
  return {at,width:wide,height:high,door:{...base.door},base,kind,definition,
   capacity:base.capacity+(['home','lodge'].includes(kind)?2:0),cost:{wood:Math.ceil((cost.wood??0)/2),stone:Math.ceil((cost.stone??0)/2)},minutes:240};
 }
 if(!a.at||!Number.isSafeInteger(a.at.x)||!Number.isSafeInteger(a.at.y))return null;
 const capacity=Number(d.data.capacity),minutes=Number(d.minutes);
 if(!Number.isSafeInteger(capacity)||capacity<0||capacity>100||!Number.isSafeInteger(minutes)||minutes<3||minutes>100000)return null;
 return {at:{...a.at},width,height,door:{x:a.at.x+Math.floor(width/2),y:a.at.y+height},base:null,kind,definition,
  capacity,cost:{...cost},minutes};
}
export function constructionStages(cost:Inventory,minutes:number):ConstructionStage[]{
 const wood=cost.wood??0,stone=cost.stone??0;
 const first={wood:Math.floor(wood/6),stone:Math.ceil(stone*2/3)};
 const second={wood:Math.ceil(wood*2/3),stone:Math.floor(stone/6)};
 const third={wood:wood-first.wood-second.wood,stone:stone-first.stone-second.stone};
 const times=[Math.ceil(minutes/4),Math.ceil(minutes/2),0];times[2]=minutes-times[0]-times[1];
 return ['基础与地基','梁柱与墙体','屋顶与交付'].map((name,i)=>({name,materials:[first,second,third][i],minutes:times[i],worked:0,startedAt:null,finishedAt:null}));
}
export function constructionLand(w:World,at:Vec):boolean {
 return reservedLandRights(w).some(p=>inLand({...p.at,width:p.width,height:p.height},at))||productionParcels(w).some(p=>inRect(at,p))||Object.values(w.construction?.yards??{}).some(p=>inRect(at,p))||!!w.construction?.projects.some(p=>p.reserved&&insideProject(p,at));
}
/** Cheap local validity for a menu. Global reachability runs only when reserving or delivering a project. */
export function constructionSiteError(w:World,p:Pick<ConstructionProject,'id'|'mode'|'ownerId'|'at'|'width'|'height'|'door'|'base'|'definition'|'ruleVersion'|'terrain'|'landRightId'>,access=false):string|null {
 if(p.mode==='terrain')return infrastructureSiteError(w,p,access);
 const landError=landConstructionError(w,p);if(landError)return landError;
 const retained=retainedOutdoorSites(w);
 if(!w.definitions[p.definition])return '建筑定义已不存在';
 if(p.at.x<1||p.at.y<1||p.at.x+p.width>=w.map.width||p.at.y+p.height>=w.map.height)return '建设范围超出开放地图';
 const parcels=productionParcels(w),yard=p.base?w.construction?.yards[p.base.id]:undefined;
 if(p.base){if(currentPremisesLease(w,p.base.id))return '原址仍有有效租约，不能未经承租人同意改动';if(w.buildingMigrations?.some(m=>m.buildingId===p.base!.id&&(m.status==='accepted'||Object.values(m.stock).some(n=>n!>0))))return '原场所仍有本人已接受的兼容改版或实际保留材料';const current=w.buildings.find(b=>b.id===p.base!.id);
  if(p.mode==='conversion'){const occupied=conversionUseError(w,p.base.id);if(occupied)return occupied;}
  if(!current||current.ownerId!==p.ownerId||current.definition!==p.base.definition||!same(current.at,p.base.at)||current.width!==p.base.width||current.height!==p.base.height||!same(current.door,p.base.door))return '原建筑产权或占地已改变，须重新设计扩建';
 }
 for(let y=p.at.y;y<p.at.y+p.height;y++)for(let x=p.at.x;x<p.at.x+p.width;x++){
  const at={x,y};if(p.base&&insideBuilding(p.base,at))continue;
  if(retained.some(p=>same(p,at)))return '新增占地不能覆盖未葬遗体或原址封存实物';
  if(pastureContains(w,at))return '新增占地不能覆盖已经使用的牧场';
  const privateParcel=parcels.find(q=>inRect(at,q))??activeLandRights(w).filter(q=>q.definition===p.definition).map(q=>({...q.at,width:q.width,height:q.height,ownerId:q.applicantId})).find(q=>inRect(at,q));
  if(p.ownerId!=='commons'){
   if(privateParcel?.ownerId!==p.ownerId&&!(yard&&inRect(at,yard)))return '新增占地超出本人登记的建设用地或院落';
   if(privateParcel&&privateParcel.ownerId!==p.ownerId)return '此处属于另一位居民的建设用地';
  }else{
   const areas=w.definitions[`construction/rules@${p.ruleVersion}`]?.data.publicAreas as Rect[]|undefined;
   if(privateParcel||Object.entries(w.construction?.yards??{}).some(([id,r])=>id!==p.base?.id&&inRect(at,r)))return '公共工程不能占用私人登记用地或其他建筑院落';
   if(!areas?.some(q=>inRect(at,q)))return '此处尚未开放公共建设用地';
  }
  if(w.infrastructure?.assets.some(s=>s.retiredAt===null&&([...s.tiles.map(t=>t.at),...(s.anchors??[s.access])]).some(t=>same(t,at)))||w.construction?.projects.some(s=>s.id!==p.id&&s.reserved&&s.terrain?.anchors.some(t=>same(t,at))))return '这里有既存或已授权的公共通路与接入权';
  if(w.map.tiles[y*w.map.width+x]!=='grass'||w.buildings.some(b=>b.id!==p.base?.id&&insideBuilding(b,at))||w.plots.some(q=>same(q.at,at))||w.graves.some(q=>distance(q.at,at)<=1)||w.resources.some(q=>q.amount>0&&same(q.at,at)))return '占地包含道路、自然资源、建筑、农田或墓位';
  if(w.construction?.projects.some(q=>q.id!==p.id&&q.reserved&&insideProject(q,at)))return '这块地已被另一项真实工程预留';
  if(w.residents.some(r=>r.status==='alive'&&r.residency!=='outside'&&!r.inside&&same(r.at,at)))return '有人仍在新增占地内，不能将其封进工地';
 }
 if(insideProject(p,p.door)||!walkable({...w,construction:w.construction?{...w.construction,projects:w.construction.projects.filter(q=>q.id!==p.id)}:undefined},p.door))return '施工入口或原住户出入口不可用';
 if(!access)return null;
 const current={...w,construction:w.construction?{...w.construction,projects:w.construction.projects.filter(q=>q.id!==p.id)}:undefined};
 const reserved={...p,reserved:true} as ConstructionProject;
 const candidate={...current,construction:{...w.construction!,projects:[...(current.construction?.projects??[]),reserved]}};
 const before=reachableTiles(current),after=reachableTiles(candidate),index=(at:Vec)=>at.y*w.map.width+at.x;
 const reachable=(seen:Uint8Array,at:Vec,adjacent=false)=>!!seen[index(at)]||adjacent&&[{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y-1},{x:at.x,y:at.y+1}].some(q=>q.x>=0&&q.y>=0&&q.x<w.map.width&&q.y<w.map.height&&seen[index(q)]);
 const places=[...retained,...reservedLandRights(w).map(p=>p.door),...w.buildings.map(b=>b.door),...(w.construction?.projects.filter(q=>q.id!==p.id&&q.reserved).map(q=>q.door)??[]),...w.residents.filter(r=>r.status==='alive'&&r.residency!=='outside'&&!r.inside).map(r=>r.at),...(w.industry?.pastures?.flatMap(yard=>yard.tiles)??[])];
 const privateAccess=parcels.flatMap(q=>{const cells:Vec[]=[];for(let y=Math.max(0,q.y);y<Math.min(w.map.height,q.y+q.height);y++)for(let x=Math.max(0,q.x);x<Math.min(w.map.width,q.x+q.width);x++)cells.push({x,y});return cells;});
 if(privateAccess.some(at=>!insideProject(p,at)&&reachable(before,at)&&!reachable(after,at)))return '工程会阻断原有私人地块的可达通路';
 if(!reachable(after,p.door)||places.some(at=>reachable(before,at)&&!reachable(after,at))||w.resources.filter(r=>r.kind==='spring').some(r=>reachable(before,r.at,true)&&!reachable(after,r.at,true))||w.plots.some(q=>reachable(before,q.at)&&!reachable(after,q.at)))return '工程会阻断既有住户、农田、牧场、工地或水源的通路';
 return null;
}
export function proposedSite(w:World,r:Resident,a:ConstructionAction){
 const f=constructionFootprint(w,a);if(!f)return null;
 const ownerId=f.terrain?'commons':f.base?.ownerId??(a.scope==='public'?'commons':r.id);
 const rules=w.definitions[w.activeDefinitions['construction/rules']??'construction/rules@1'];
 if(!rules||rules.id!=='construction/rules')return null;
 const right=activeLandRights(w).find(p=>p.applicantId===ownerId&&p.definition===f.definition&&inLand({...p.at,width:p.width,height:p.height},f.at));
 return {...f,...(right?{landRightId:right.id}:{}),id:'candidate',ownerId,mode:f.terrain?'terrain' as const:a.operation==='convert'?'conversion' as const:f.base?'expansion' as const:'new' as const,ruleVersion:rules.version};
}

/** Renovation never evicts a person or silently destroys an existing crop, animal or promise. */
export function conversionUseError(w:World,id:string):string|null{
 if(currentPremisesLease(w,id))return '原址仍有有效租约';
 const b=w.buildings.find(b=>b.id===id);if(!b)return '原场所已不存在';
 if(w.industry?.pastures?.some(yard=>yard.barnId===id))return '该畜舍仍登记有附属牧场，不能直接改换用途';
 if(w.culture?.events.some(e=>e.buildingId===id&&(['planned','held'].includes(e.status)||e.preparation.completedAt!==null&&e.preparation.clearedAt===null||Object.values(e.preparation.held).some(n=>n!>0)||e.contributions.some(c=>Object.values(c.inventory).some(n=>n!>0)))))return '原场所还有已接受的文化活动、实际布置或他人物资，须先实际处理';
 if(w.industry?.tools.some(t=>t.location?.inside===id))return '原室内仍有独立封存的工具，须由产权人亲自取走';
 if(w.estates.some(e=>(e.location?.inside===id&&Object.values(e.inventory).some(n=>n!>0))||e.parcels?.some(p=>p.location.inside===id&&Object.values(p.inventory).some(n=>n!>0))))return '原室内还有独立封存的继承物资，须先由实际权利人到场领取';
 if(w.economy?.businesses.some(b=>b.buildingId===id&&(b.closedAt===null||Object.values(b.inventory).some(n=>n!>0))))return '原商铺仍在经营或留有尚未取走的实际库存';
 if(w.household?.pools.some(p=>p.buildingId===id&&(p.status==='open'||p.status==='offered'||p.credits.some(c=>c.coins>0||Object.values(c.inventory).some(n=>n!>0)))))return '原住处仍有共同资金、储物或他人的独立份额，须先实际取走或迁移';
 if(w.debt?.loans.some(c=>c.buildingId===id&&(['offered','active','overdue'].includes(c.status)||accountBalance(w,c.repaymentAccount)>0)))return '原登记处仍保管有效借贷文书或待领实款，须先实际结清或另行迁移';
 if(b.residents.length||w.residents.some(r=>r.inside===id||r.status==='alive'&&r.residency!=='outside'&&r.homeId===id))return '原住户或实际室内的人与遗体尚未自行迁离，不能改换用途';
 if(w.duties?.shifts.some(s=>s.buildingId===id&&['booked','on-duty'].includes(s.status))||w.employment?.contracts.some(c=>c.buildingId===id&&c.status==='active')||w.education?.lessons.some(c=>c.buildingId===id&&c.status==='scheduled')||w.health?.appointments.some(c=>c.buildingId===id&&['accepted','offered'].includes(c.status))||w.longCare?.agreements.some(c=>c.addressId===id&&['offered','awaitingChild','active'].includes(c.status)))return '原用途仍有有效岗位、课堂、诊疗或照护承诺，须由当事人先行处理';
 if(w.economy?.businesses.some(c=>c.buildingId===id&&c.closedAt===null))return '原经营尚未自行清算';
 if(w.industry?.stations.some(c=>c.buildingId===id)||w.industry?.batches.some(c=>c.buildingId===id&&c.status==='working')||w.industry?.animals.some(c=>c.barnId===id&&c.status==='alive')||w.industry?.beds.some(c=>c.buildingId===id&&c.crop))return '原加工设备、在制品、动物或温室作物尚未实际处理，不能无声移除';
 return null;
}
