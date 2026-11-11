import {itemLabels} from '../shared/items.js';
import {prototypeFish} from '../shared/prototypes.js';
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
  if(r.skills.building>=1)list.push({id:'design.draw.prototype',label:`去${workspace.name}画自己组合的便携晾鱼原型（55分钟）。填写 drawing：name、purpose、frame（wood/plank）、mesh（fiber/cloth）、cover（none/cloth）、processes（无遮盖为["hang","airDry"]，有遮盖为["hang","shelter","airDry"]）、batchSize（2–6份鲜鱼）、trialMinutes（60–360）。实物承重、天气、白昼与食品期限决定实际结果，名称不能创造效果。`,action:{type:'design',operation:'draw',buildingId:workspace.id,kind:'prototype'}});
  list.push({id:'design.draw.building',label:`去${workspace.name}画一处自己设想的场所（55分钟）。填写 drawing 对象，含${buildingFields}。画成后可按新图纸提议真实选址、备料和分阶段施工。`,action:{type:'design',operation:'draw',buildingId:workspace.id,kind:'building'}});
 }
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons'&&designWorkspace(r,b)&&distance(r.at,b.door)<=18);
 const records=w.designs?.records??[];
 if(workspace)for(const d of records.filter(d=>knowsDesign(r,d)&&d.spec.kind==='tool').slice(-5).reverse()){
  if(d.spec.kind!=='tool')continue;
  add('fabricate.'+d.id,`在${workspace.name}按已知图纸制作并优先使用「${d.name}」${designedToolNames[d.spec.tool]}，实际用${designStockLabel(d.spec.materials)}和${d.spec.minutes}分钟，${d.spec.durability}耐用、${d.spec.level}级`,{type:'design',operation:'fabricate',buildingId:workspace.id,designId:d.id});
 }
 const rotate=<T>(rows:T[],limit:number,period=30)=>{const offset=Math.floor(w.minute/period)%Math.max(1,rows.length);return Array.from({length:Math.min(rows.length,limit)},(_,i)=>rows[(offset+i)%rows.length]);};
 const prototypeRecords=records.filter(d=>knowsDesign(r,d)&&d.spec.kind==='prototype');
 const unfinished=w.designs?.prototypes?.find(p=>p.ownerId===r.id&&p.status==='assembling');
 const unfinishedDesign=prototypeRecords.find(d=>d.id===unfinished?.designId);
 const selectedPrototypes=[...(unfinishedDesign?[unfinishedDesign]:[]),...rotate(prototypeRecords.filter(d=>d.id!==unfinishedDesign?.id),unfinishedDesign?3:4)];
 if(workspace)for(const d of selectedPrototypes){
  if(d.spec.kind!=='prototype')continue;
  const spec=d.spec;
  const own=w.designs?.prototypes?.filter(p=>p.ownerId===r.id&&p.designId===d.id)??[];
  const pending=own.find(p=>p.status==='assembling');
  const site=pending?w.buildings.find(b=>b.id===pending.buildingId):workspace;
  if(site)add('assemble.'+d.id,`${pending?'续做':'备料试作'}「${d.name}」：${designStockLabel(d.spec.materials)}，${d.spec.minutes}分钟；已做${pending?.worked??0}分钟。只用本人实际材料，制作不等于有效`,{type:'design',operation:'assemble',designId:d.id,buildingId:site.id,...(pending?{prototypeId:pending.id}:{})});
  const shownAssets=[...(pending?[pending]:[]),...rotate(own.filter(p=>p.status!=='discarded'&&p.id!==pending?.id),pending?2:3,30*Math.max(1,prototypeRecords.length))];
  for(const p of shownAssets){
   const t=w.designs?.trials?.find(t=>t.prototypeId===p.id&&t.status==='working');
   const place=t?w.buildings.find(b=>b.id===t.buildingId):workspace;
   // Missing legacy sites prevent resumed physical use, not the owner's decision at a different authorized desk.
   if(p.status==='ready'&&place){
    const inputs=t?Object.keys(t.input) as typeof prototypeFish[number][]:prototypeFish.filter(i=>(r.inventory[i]??0)>=spec.batchSize);
    for(const input of inputs)add('trial.'+p.id+'.'+input,`在${place.name}门外${t?'续做已投入鲜鱼的':'实际试用'}「${d.name}」：${d.spec.batchSize}份${itemLabels[input]}，照看${d.spec.trialMinutes}分钟（已做${t?.worked??0}）；承重${d.spec.capacity}份，耐用${p.durability}。只累计晴天白昼干燥，失败消耗已投鱼和耐用`,{type:'design',operation:'trial',buildingId:place.id,designId:d.id,prototypeId:p.id,input,...(t?{trialId:t.id}:{})});
   }
   const discardAt=workspace.id;
   add('abandon.'+p.id,`到${workspace.name}桌台决定不再继续「${d.name}」原型，原址部件与试用记录仍保留，不清理、不返还物资`,{type:'design',operation:'abandonPrototype',buildingId:discardAt,designId:d.id,prototypeId:p.id});
  }
 }
 if(hall){
  for(const d of rotate(records.filter(d=>d.authorId===r.id&&!d.publication&&!designTarget(w,r,{type:'design',operation:'publish',buildingId:hall.id,designId:d.id}).error),3))
   add('publish.'+d.id,`到${hall.name}留存自己「${d.name}」图纸。别人须自行去桌台学习，图纸公开不代表出钱、制作或施工`,{type:'design',operation:'publish',buildingId:hall.id,designId:d.id});
  for(const d of rotate(records.filter(d=>d.publication?.buildingId===hall.id&&!knowsDesign(r,d)),4)){
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
