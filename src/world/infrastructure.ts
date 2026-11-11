import {disasterContains} from '../shared/frontier-hazards.js';
import {retainedOutdoorSites} from '../shared/land-use.js';
import {reservedLandRights,inLand} from '../shared/land-rights.js';
import {hasReceipt} from './receipts.js';
import {infrastructureNames} from '../shared/infrastructure.js';
import {pastureContains} from './pasture.js';
import type {Building,Inventory,Resident,Vec,World} from '../shared/types.js';import type {ConstructionAction,ConstructionKind,ConstructionProject} from '../shared/construction.js';import type {InfrastructureKind,TerrainWork} from '../shared/infrastructure.js';import {DAY} from './time.js';import {same,walkable,findPath,distance} from './navigation.js';import {productionParcels} from './production.js';import {emitEvent} from './events.js';
export {infrastructureNames};
export const isInfrastructure=(kind:ConstructionKind|undefined):kind is InfrastructureKind=>!!kind&&Object.hasOwn(infrastructureNames,kind);
export function initializeInfrastructure(w:World){if(w.mode!=='formal')return;w.infrastructure??={assets:[],lastDay:Math.floor(w.minute/DAY),totals:{roads:0,bridges:0,docks:0,cemeteries:0,repairs:0}};
 const content={road:{wood:1,stone:2,minutes:20},bridge:{wood:5,stone:2,minutes:60},dock:{wood:6,stone:2,minutes:90},cemetery:{wood:6,stone:12,minutes:360}};
 for(const [kind,data]of Object.entries(content)){const key=`infrastructure/${kind}@1`;w.definitions[key]??={id:`infrastructure/${kind}`,version:1,kind:'action',dependencies:[],cost:{wood:data.wood,stone:data.stone},minutes:data.minutes,data:{kind,perTile:kind!=='cemetery',width:3,height:6,graveColumns:2,graveRows:3,maximumLength:24}};w.activeDefinitions[`infrastructure/${kind}`]??=key;}
}
const inRect=(p:Vec,q:{at:Vec;width:number;height:number})=>p.x>=q.at.x&&p.x<q.at.x+q.width&&p.y>=q.at.y&&p.y<q.at.y+q.height;
export interface InfrastructureFootprint {at:Vec;width:number;height:number;door:Vec;capacity:number;base:Building|null;definition:string;kind:InfrastructureKind;cost:Inventory;minutes:number;terrain:TerrainWork;}
export function infrastructureFootprint(w:World,a:ConstructionAction):InfrastructureFootprint|null{
 if(a.operation==='repairInfrastructure'){const asset=w.infrastructure?.assets.find(s=>s.id===a.assetId&&s.retiredAt===null);if(!asset||asset.condition>=100)return null;return {at:{...asset.at},width:asset.width,height:asset.height,door:{...asset.access},capacity:0,base:null,definition:asset.definition,kind:asset.kind,cost:{wood:Math.ceil((asset.cost.wood??0)/3),stone:Math.ceil((asset.cost.stone??0)/3)},minutes:Math.max(30,Math.ceil(asset.minutes/3)),terrain:{kind:asset.kind,tiles:structuredClone(asset.tiles),graves:[],anchors:structuredClone(asset.anchors??[asset.access]),repairOf:asset.id}};}
 if(a.operation!=='propose'||!isInfrastructure(a.kind)||!a.at||!Number.isSafeInteger(a.at.x)||!Number.isSafeInteger(a.at.y)||a.scope!=='public')return null;
 const kind=a.kind,definition=a.definition??w.activeDefinitions[`infrastructure/${kind}`],d=w.definitions[definition];if(!d||d.kind!=='action'||d.id!==`infrastructure/${kind}`||!d.cost||Object.entries(d.cost).some(([i,n])=>!['wood','stone'].includes(i)||!Number.isSafeInteger(n)||n!<0)||!Number.isSafeInteger(d.minutes)||d.minutes!<=0)return null;
 const points:Vec[]=[],graves:Vec[]=[],anchors:Vec[]=[];let door:Vec;
 if(kind==='cemetery'){const cols=Number(d.data.graveColumns),rows=Number(d.data.graveRows),width=Number(d.data.width),height=Number(d.data.height);if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>24||height>24||!Number.isSafeInteger(cols)||!Number.isSafeInteger(rows)||cols<1||cols>6||rows<1||rows>12||width<cols*2-1||height<rows*2)return null;for(let y=0;y<height;y++)for(let x=0;x<width;x++)points.push({x:a.at.x+x,y:a.at.y+y});for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)graves.push({x:a.at.x+x*2,y:a.at.y+y*2});door={x:a.at.x+1,y:a.at.y+height};}
 else {const end=a.end;if(!end||!Number.isSafeInteger(end.x)||!Number.isSafeInteger(end.y)||a.at.x!==end.x&&a.at.y!==end.y)return null;const length=distance(a.at,end)+1;if(length<1||length>Number(d.data.maximumLength)||kind==='dock'&&length>6)return null;const facing=a.direction??'east',dx=Math.sign(end.x-a.at.x)||(end.y===a.at.y?(facing==='west'?-1:facing==='east'?1:0):0),dy=Math.sign(end.y-a.at.y)||(end.x===a.at.x?(facing==='north'?-1:facing==='south'?1:0):0);for(let i=0;i<length;i++)points.push({x:a.at.x+i*dx,y:a.at.y+i*dy});door=kind==='road'?{x:a.at.x-dx,y:a.at.y-dy}:{x:a.at.x-dx,y:a.at.y-dy};if(!dx&&!dy)door={x:a.at.x,y:a.at.y+1};if(kind==='bridge'||kind==='road')anchors.push({x:end.x+dx,y:end.y+dy});}
 anchors.push({...door});
 const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxX=Math.max(...points.map(p=>p.x)),maxY=Math.max(...points.map(p=>p.y));
 const tiles=points.map(at=>({at,before:w.map.tiles[at.y*w.map.width+at.x],after:(kind==='road'?'road':kind==='cemetery'?(at.x===a.at!.x+1?'path':w.map.tiles[at.y*w.map.width+at.x]):'bridge') as World['map']['tiles'][number]}));
 const multiplier=d.data.perTile?points.length:1;return {at:{x:minX,y:minY},width:maxX-minX+1,height:maxY-minY+1,door,capacity:0,base:null,definition,kind,cost:{wood:(d.cost.wood??0)*multiplier,stone:(d.cost.stone??0)*multiplier},minutes:d.minutes!*multiplier,terrain:{kind,tiles,graves,anchors,repairOf:null}};
}
export function infrastructureSiteError(w:World,p:Pick<ConstructionProject,'id'|'ownerId'|'at'|'width'|'height'|'door'|'definition'|'terrain'>,access=false):string|null{
 const work=p.terrain;if(!work||p.ownerId!=='commons'||!w.definitions[p.definition])return '公共交通与墓园必须有具体的定义、占地及公共授权';const asset=work.repairOf?w.infrastructure?.assets.find(s=>s.id===work.repairOf&&s.retiredAt===null):undefined;if(work.repairOf&&!asset)return '原公共设施已不再有效';
 if(!walkable(w,p.door))return '施工人员实际可到达的岸边或入口不可用';
 if(w.frontierHazards?.disasters.some(d=>d.kind==='flashFlood'&&d.phase==='active'&&d.footprint&&work.tiles.some(t=>disasterContains(d,t.at))))return '实际施工地块的洪水尚未消退';
 if(!work.tiles.length||new Set(work.tiles.map(t=>t.at.x+','+t.at.y)).size!==work.tiles.length)return '施工方案须有不重复的真实地块';
 const occupied=productionParcels(w),retained=retainedOutdoorSites(w);for(const t of [...work.tiles,...work.anchors.map(at=>({at,before:w.map.tiles[at.y*w.map.width+at.x],after:w.map.tiles[at.y*w.map.width+at.x]}))]){const at=t.at;if(at.x<1||at.y<1||at.x>=w.map.width-1||at.y>=w.map.height-1)return '公共工程超出开放地图';const current=w.map.tiles[at.y*w.map.width+at.x];if(current!==t.before&&(!asset||current!==t.after))return '现场地形已改变，原方案须重新核验';
  if(asset){if(work.anchors.some(a=>same(a,at))&&!walkable(w,at))return '原设施的实际接入点已经改变';continue;}
  if(retained.some(p=>same(p,at)))return '公共工程不能覆盖未葬遗体或原址封存实物';
  if(reservedLandRights(w).some(p=>inLand({...p.at,width:p.width,height:p.height},at)))return '公共工程不能占用有效或保全中的有限建设地权';
  if(pastureContains(w,at))return '公共工程不能占用已经使用的牧场';
  if(occupied.some(q=>at.x>=q.x&&at.y>=q.y&&at.x<q.x+q.width&&at.y<q.y+q.height)||Object.values(w.construction?.yards??{}).some(q=>at.x>=q.x&&at.y>=q.y&&at.x<q.x+q.width&&at.y<q.y+q.height)||w.buildings.some(q=>inRect(at,q))||w.plots.some(q=>same(q.at,at))||w.graves.some(q=>distance(q.at,at)<=1)||w.resources.some(q=>same(q.at,at)))return '道路、水岸与墓园不能占用既有私人院落、农田、墓位、自然资源或矿口';
  if(w.infrastructure?.assets.some(s=>s.retiredAt===null&&[...s.tiles.map(t=>t.at),...(s.anchors??[s.access])].some(t=>same(t,at))))return '这里已有持续有效的公共设施，应修护原设施';
  if(w.construction?.projects.some(q=>q.id!==p.id&&q.reserved&&(q.terrain?[...q.terrain.tiles.map(t=>t.at),...q.terrain.anchors].some(t=>same(t,at)):inRect(at,q))))return '现场已有另一项真实工程预留';
  if(work.anchors.some(a=>same(a,at))){if(!walkable(w,at))return '实际接入点必须仍可通行';continue;}
  if(work.kind==='road'||work.kind==='cemetery'){if(!['grass','soil','sand','path'].includes(current))return '陆地道路和墓园不能覆盖水面、悬崖或现有桥梁';}
  else if(current!=='water')return '桥梁和码头的结构须铺在实际水面，不能覆盖土地用途';
 }
 if(!asset&&work.kind==='bridge'){const first=work.tiles[0].at,last=work.tiles.at(-1)!.at,dx=first.x-p.door.x,dy=first.y-p.door.y;if(work.tiles.length<1||!walkable(w,{x:last.x+dx,y:last.y+dy})||!walkable(w,p.door))return '桥梁须从真实可到达的一岸连接另一处可通行的岸边';}
 if(!asset&&work.kind==='dock'&&!work.tiles.some(t=>[[1,0],[-1,0],[0,1],[0,-1]].some(([x,y])=>w.map.tiles[(t.at.y+y)*w.map.width+t.at.x+x]==='water')))return '码头须邻接真实水域';
 return access&&findPath(w,w.map.entrance,p.door)===null?'施工入口没有现有的实际通路':null;
}
export function completeTerrain(w:World,p:ConstructionProject):string|null{
 const mark='terrain-commit:'+p.id;if(hasReceipt(w,mark))return null;
 if(p.mode!=='terrain'||!p.terrain||p.stage!==p.stages.length||p.stages.some(s=>s.worked<s.minutes||s.finishedAt===null)||(p.authorizedUntil??0)<=w.minute)return '地形与墓位只能在有效公共授权及全部实际施工阶段完成后交付';
 const error=infrastructureSiteError(w,p,true);if(error)return error;const t=p.terrain!,state=w.infrastructure!;const tiles=[...w.map.tiles];for(const edit of t.tiles)tiles[edit.at.y*w.map.width+edit.at.x]=edit.after;w.map={...w.map,entrance:{...w.map.entrance},tiles};
 if(t.repairOf){const a=state.assets.find(a=>a.id===t.repairOf)!,before=a.condition,disasterId=a.lastHazardDamage?.disasterId??w.events.slice().reverse().find(e=>e.hazardFact?.phase==='damage'&&e.hazardFact.targetId===a.id)?.hazardFact?.disasterId;a.condition=100;
  if(disasterId)emitEvent(w,{kind:'hazard',actors:[],place:{...a.access},hazardFact:{disasterId,phase:'repair',targetId:a.id,before,after:a.condition},text:`${a.name}由已授权的公共工程实际完成修护；材料和工时记录在工程 ${p.id}。`});a.lastDay=Math.floor(w.minute/DAY);state.totals.repairs++;w.processed.push(mark);return null;}
 const graveIds=t.graves.map((at,i)=>{const id=`grave:${p.id}:${i}`;if(!w.graves.some(g=>g.id===id))w.graves.push({id,at:{...at},personId:null,buriedAt:null,reservedBy:null,condition:100,lastMaintainedAt:w.minute});return id;});
 if(!state.assets.some(a=>a.projectId===p.id))state.assets.push({id:`infrastructure:${p.id}`,name:p.name,projectId:p.id,kind:t.kind,definition:p.definition,at:{...p.at},width:p.width,height:p.height,access:{...p.door},anchors:structuredClone(t.anchors),tiles:structuredClone(t.tiles),graveIds,condition:100,lastDay:Math.floor(w.minute/DAY),createdAt:w.minute,retiredAt:null,cost:p.stages.reduce((bag,s)=>({wood:(bag.wood??0)+(s.materials.wood??0),stone:(bag.stone??0)+(s.materials.stone??0)}),{} as Inventory),minutes:p.stages.reduce((n,s)=>n+s.minutes,0)});
 w.processed.push(mark);state.totals[t.kind==='road'?'roads':t.kind==='bridge'?'bridges':t.kind==='dock'?'docks':'cemeteries']++;return null;
}
export function advanceInfrastructure(w:World){initializeInfrastructure(w);const s=w.infrastructure,day=Math.floor(w.minute/DAY);if(!s||s.lastDay===day)return;s.lastDay=day;let tiles:World['map']['tiles']|null=null;for(const a of s.assets){if(a.retiredAt!==null)continue;const before=a.condition,dt=Math.max(0,day-a.lastDay);a.lastDay=day;a.condition=Math.max(0,a.condition-dt*(a.kind==='bridge'?.25:a.kind==='dock'?.3:.15));if(before>0&&a.condition===0){if(a.kind==='road'||a.kind==='cemetery'){tiles??=[...w.map.tiles];for(const t of a.tiles)if(tiles[t.at.y*w.map.width+t.at.x]===t.after)tiles[t.at.y*w.map.width+t.at.x]=t.before;}emitEvent(w,{kind:'construction',actors:[],place:{...a.access},text:`${infrastructureNames[a.kind]}的实际维护不足，${a.kind==='road'||a.kind==='cemetery'?'铺设已经退化，原有使用权与纪念仍保留':'已停止新增通行，已经在设施上的人仍可离开'}，修护须有人另行提出并施工。`});}}
 if(tiles)w.map={...w.map,entrance:{...w.map.entrance},tiles};
}
