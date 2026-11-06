import {designedToolNames,parseDrawing} from '../shared/designs.js';
import type {BuildingDrawing,DesignAction,DesignSpec,ResidentDesign,ToolDrawing} from '../shared/designs.js';
import {itemLabels} from '../shared/items.js';
import type {Building,ContentDefinition,Inventory,Item,Resident,Vec,World} from '../shared/types.js';
import {actionRoom} from '../shared/rooms.js';
import {employmentConflict} from './employment.js';
import {emitEvent} from './events.js';
import {industryDefinition} from './industry-rules.js';
import {distance,same} from './navigation.js';
import {hasReceipt} from './receipts.js';
import {ageYears,DAY} from './time.js';

const tables=['home','lodge','workshop','store'];
const newDrawingInterval=DAY;
const record=(w:World,id:string)=>w.designs?.records.find(d=>d.id===id);
export const knowsDesign=(r:Resident,d:ResidentDesign)=>r.id===d.authorId||d.learnedBy.includes(r.id);
export function mayUseDesignedBuilding(w:World,r:Resident,definition:string){
 const id=w.definitions[definition]?.data.residentDesign;
 if(typeof id!=='string')return true;
 const d=record(w,id);
 return !!d&&knowsDesign(r,d);
}

export function mayDesign(w:World,r:Resident){
 return w.mode==='formal'&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
}
export function mayDraw(w:World,r:Resident){
 return mayDesign(w,r)&&!w.designs?.records.some(d=>d.authorId===r.id&&w.minute-d.createdAt<newDrawingInterval);
}
export function designWorkspace(r:Resident,b:Building){
 return b.condition>0&&tables.includes(b.kind)&&r.knownBuildings.includes(b.id)&&(b.ownerId===r.id||b.ownerId==='commons'||b.residents.includes(r.id));
}
function knowsHall(r:Resident,b:Building){return designWorkspace(r,b)&&b.kind==='lodge'&&b.ownerId==='commons';}
const has=(bag:Inventory,materials:Inventory)=>Object.entries(materials).every(([key,n])=>(bag[key as Item]??0)>=n!);
export const designStockLabel=(materials:Inventory)=>Object.entries(materials).map(([item,n])=>n!+itemLabels[item as Item]).join('、');

function toolSpec(w:World,d:ToolDrawing):Extract<DesignSpec,{kind:'tool'}>{
 const {kind,tool,frame,fitting,reinforcement}=d;
 const fine=fitting==='bar'||fitting==='cloth';
 const materials:Inventory={
  [frame]:(tool==='rod'?2:3)+reinforcement,
  [fitting]:fitting==='bar'?2:fitting==='stone'&&tool==='pick'?3:2,
 };
 if(tool==='spear')materials.fiber=1;
 const rules=industryDefinition(w).rules;
 return {kind,tool,frame,fitting,reinforcement,materials,minutes:(tool==='pick'?70:55)+reinforcement*18+(fine?20:0),
  durability:rules.toolDurability+reinforcement*8+(frame==='plank'?8:0)+(fine?10:0),
  level:Math.min(rules.maximumToolLevel,fine?2:1)};
}
function buildingSpec(d:BuildingDrawing,definition:string):Extract<DesignSpec,{kind:'building'}>{
 const {kind,template,width,height,roof,structure}=d,area=width*height;
 const [wood,stone]=structure==='timber'?[.95,.42]:structure==='masonry'?[.52,1]:[.76,.68];
 return {kind,template,width,height,roof,structure,definition,materials:{wood:Math.ceil(area*wood),stone:Math.ceil(area*stone)},
  minutes:100+area*(structure==='masonry'?11:8),capacity:['home','lodge','clinic'].includes(template)?Math.max(1,Math.floor(area/10)):0};
}

export function designTarget(w:World,r:Resident,a:DesignAction):{target:Vec;duration:number;error?:string}{
 const fail=(error:string)=>({target:{...r.at},duration:0,error});
 if(!mayDesign(w,r))return fail('本人当前无法设计、制作或阅读图纸');
 if(a.operation==='equip'){
  const tool=w.industry?.tools.find(t=>t.id===a.toolId&&t.ownerId===r.id&&!t.location&&t.durability>0);
  return tool?{target:{...r.at},duration:1}:fail('此处没有本人随身携带的该工具');
 }
 const b=w.buildings.find(b=>b.id===a.buildingId);
 if(!b||!designWorkspace(r,b))return fail('须前往已知且本人有使用权的桌台');
 if(a.operation==='draw'){
  const drawing=parseDrawing(a.kind,a.drawing);
  if(!drawing||drawing.kind==='tool'&&drawing.tool==='spear'&&w.scenario!=='frontier')return fail('图纸参数缺失或图纸用途在当前世界不可实现');
  if(!mayDraw(w,r))return fail('今天已经绘制新图纸，可以先完成制作或施工');
  if(w.designs?.records.some(d=>d.authorId===r.id&&d.name===drawing.name))return fail('这个名称已经用于本人的图纸');
  return {target:{...b.door},duration:drawing.kind==='tool'?35:55};
 }
 const d=record(w,a.designId);
 if(!d)return fail('图纸已不存在');
 if(a.operation==='fabricate'){
  if(d.spec.kind!=='tool'||!w.industry||!knowsDesign(r,d)||!has(r.inventory,d.spec.materials))return fail('缺少可读图纸、实际材料或工艺场所');
  return {target:{...b.door},duration:d.spec.minutes};
 }
 if(!knowsHall(r,b))return fail('须在已知公共旅舍的桌台公开或查阅');
 if(a.operation==='publish')return d.authorId===r.id&&!d.publication?{target:{...b.door},duration:12}:fail('只有作者可公开自己的未公开图纸');
 if(a.operation==='study')return d.publication?.buildingId===b.id&&!knowsDesign(r,d)?{target:{...b.door},duration:25}:fail('没有在此公开的未读图纸');
 return fail('未知的设计行动');
}

export function designWorkError(w:World,r:Resident,a:DesignAction,minutes:number):string|null {
 if(a.operation==='equip')return null;
 const start=w.minute-minutes;
 const conflict=employmentConflict(w,r,start,w.minute,a.buildingId);
 if(conflict)return conflict;
 return w.duties?.shifts.some(s=>s.workerId===r.id&&['booked','on-duty'].includes(s.status)&&start<s.end&&s.start<w.minute)
  ?'本人的已认领班次开始，不能继续占用这个时段':null;
}

/** Commits the resident's own drawing or completed physical work, keeping ordinary use, wear and ownership rules. */
export function completeDesign(w:World,r:Resident,a:DesignAction):string|null{
 const current=r.activity;
 if(!current||current.action!==a||current.remaining>0||current.path.length||current.room?.path.length)return '本人须到场完成实际劳动';
 const receipt=`resident-design:${current.planId}:${current.startedAt}`;
 if(hasReceipt(w,receipt))return null;
 const target=designTarget(w,r,a);
 if(target.error)return target.error;
 if(!same(r.at,target.target))return '本人尚未实际抵达指定位置';
 if(a.operation!=='equip'&&w.rooms){
  const workspace=actionRoom(w,r,current);
  if(!workspace||r.inside!==workspace.building.id||!r.roomAt||!same(r.roomAt,workspace.target))return '本人尚未实际抵达指定桌台';
 }
 let designId:string|undefined,text:string;
 if(a.operation==='equip'){
  const tools=w.industry!.tools,tool=tools.find(t=>t.id===a.toolId)!;
  tools.splice(tools.indexOf(tool),1);
  tools.unshift(tool);
  designId=tool.designId;text=`${r.name}改用${record(w,tool.designId??'')?.name??designedToolNames[tool.kind]}。`;
 }else if(a.operation==='draw'){
  const drawing=parseDrawing(a.kind,a.drawing)!;
  const state=w.designs??={nextSerial:1,records:[]};
  let serial=state.nextSerial++,definition=`building/resident-${serial}@1`;
  while(w.definitions[definition]||w.activeDefinitions[definition.slice(0,-2)]){
   serial=state.nextSerial++;definition=`building/resident-${serial}@1`;
  }
  const id=`design:${w.id}:${serial}`;
  const spec=drawing.kind==='tool'?toolSpec(w,drawing):buildingSpec(drawing,definition);
  if(spec.kind==='building'){
   const alias=definition.slice(0,-2);
   const d:ContentDefinition={id:alias,version:1,kind:'building',dependencies:['action/routine@1'],
    cost:{...spec.materials},minutes:spec.minutes,data:{template:spec.template,width:spec.width,height:spec.height,capacity:spec.capacity,
     art:{roof:spec.roof},name:drawing.name,residentDesign:id}};
   w.definitions[definition]=d;w.activeDefinitions[alias]=definition;
  }
  state.records.push({id,authorId:r.id,name:drawing.name,purpose:drawing.purpose,createdAt:w.minute,createdIn:a.buildingId,publication:null,learnedBy:[],spec});
  designId=id;text=`${r.name}在桌台上画成了「${drawing.name}」的图纸，打算${drawing.purpose}。`;
 }else{
  const d=record(w,a.designId)!;designId=d.id;
  if(a.operation==='publish'){
   d.publication={buildingId:a.buildingId,at:w.minute};
   text=`${r.name}把「${d.name}」的图纸留在公共桌台供其他居民查阅。`;
  }else if(a.operation==='study'){
   d.learnedBy.push(r.id);
   text=`${r.name}亲自读完「${d.name}」的图纸，学会按图制作或施工。`;
  }else{
   const spec=d.spec as Extract<DesignSpec,{kind:'tool'}>,industry=w.industry!;
   for(const [item,n] of Object.entries(spec.materials))r.inventory[item as Item]=(r.inventory[item as Item]??0)-n!;
   const def=industryDefinition(w);
   // Putting the completed asset first is the resident's explicit choice to use it before the old same-kind tools.
   industry.tools.unshift({id:`tool:${industry.nextSerial++}`,definition:def.definition,ownerId:r.id,kind:spec.tool,designId:d.id,
    level:spec.level,durability:spec.durability,maxDurability:spec.durability});
   industry.totals.crafted++;
   text=`${r.name}实际用了${designStockLabel(spec.materials)}制作「${d.name}」，并把这件${designedToolNames[spec.tool]}带在身边使用。`;
  }
 }
 w.processed.push(receipt);
 emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},designId,text});
 return null;
}

export function nearestDesignWorkspace(w:World,r:Resident){
 return w.buildings.filter(b=>designWorkspace(r,b)&&distance(r.at,b.door)<=18)
  .sort((a,b)=>distance(r.at,a.door)-distance(r.at,b.door))[0];
}
