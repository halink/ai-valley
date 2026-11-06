import {designedToolNames,parseDrawing} from '../shared/designs.js';
import type {DesignAction} from '../shared/designs.js';
import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import {designStockLabel,designTarget,designWorkspace,knowsDesign,mayDesign,mayDraw,nearestDesignWorkspace} from '../world/resident-designs.js';
import {distance} from '../world/navigation.js';

const toolFields='name、purpose、tool（rod钓竿/axe斧/pick镐/spear猎矛）、frame（wood原木/plank木板）、fitting（钓竿用fiber纤维/cloth布；其余用stone石料/bar铁锭）、reinforcement（0–3）';
const buildingFields='name、purpose、template（home住宅/lodge旅舍/workshop工坊/clinic诊所/school校舍/barn畜舍/greenhouse温室/store商铺）、width（4–10）、height（4–8）、roof（wood/clay/blue/thatch/green/slate）、structure（timber木构/masonry石构/mixed混合）';
export function designOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!mayDesign(w,r))return [];
 const list:FormalOpportunity[]=[];
 const add=(id:string,label:string,action:DesignAction)=>{if(!designTarget(w,r,action).error)list.push({id:'design.'+id,label,action});};
 const workspace=nearestDesignWorkspace(w,r);
 if(workspace&&mayDraw(w,r)){
  list.push({id:'design.draw.tool',label:`去${workspace.name}画一件自己设想的可用工具（35分钟）。填写 drawing 对象，含${toolFields}。材料与工时取决于设计，画图后须自行备料制作。`,action:{type:'design',operation:'draw',buildingId:workspace.id,kind:'tool'}});
  list.push({id:'design.draw.building',label:`去${workspace.name}画一处自己设想的场所（55分钟）。填写 drawing 对象，含${buildingFields}。画成后可按新图纸提议真实选址、备料和分阶段施工。`,action:{type:'design',operation:'draw',buildingId:workspace.id,kind:'building'}});
 }
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons'&&designWorkspace(r,b)&&distance(r.at,b.door)<=18);
 const records=w.designs?.records??[];
 if(workspace)for(const d of records.filter(d=>knowsDesign(r,d)&&d.spec.kind==='tool').slice(-5).reverse()){
  if(d.spec.kind!=='tool')continue;
  add('fabricate.'+d.id,`在${workspace.name}按已知图纸制作并优先使用「${d.name}」${designedToolNames[d.spec.tool]}，实际用${designStockLabel(d.spec.materials)}和${d.spec.minutes}分钟，${d.spec.durability}耐用、${d.spec.level}级`,{type:'design',operation:'fabricate',buildingId:workspace.id,designId:d.id});
 }
 if(hall){
  for(const d of records.filter(d=>d.authorId===r.id&&!d.publication).slice(-3).reverse())
   add('publish.'+d.id,`到${hall.name}留存自己「${d.name}」图纸。别人须自行去桌台学习，图纸公开不代表出钱、制作或施工`,{type:'design',operation:'publish',buildingId:hall.id,designId:d.id});
  for(const d of records.filter(d=>d.publication?.buildingId===hall.id&&!knowsDesign(r,d)).slice(-4).reverse()){
   const author=w.residents.find(p=>p.id===d.authorId)?.name??'原作者';
   add('study.'+d.id,`到${hall.name}阅读${author}公开的「${d.name}」图纸（25分钟），读完才获得实际做法`,{type:'design',operation:'study',buildingId:hall.id,designId:d.id});
  }
 }
 const usable=w.industry?.tools.filter(t=>t.ownerId===r.id&&!t.location&&t.durability>0)??[];
 for(const t of usable.filter((t,index)=>usable.findIndex(other=>other.kind===t.kind)<index).slice(-3)){
  const title=records.find(d=>d.id===t.designId)?.name??designedToolNames[t.kind];
  add('equip.'+t.id,`换用随身的「${title}」（${t.level}级、剩余耐用${t.durability}）`,{type:'design',operation:'equip',toolId:t.id});
 }
 return list;
}
export function parseDesignChoice(action:DesignAction,data:Record<string,unknown>):DesignAction{
 if(action.operation!=='draw')return structuredClone(action);
 const drawing=parseDrawing(action.kind,data.drawing);
 if(!drawing)throw new Error('invalid_resident_drawing');
 return {...action,drawing};
}
