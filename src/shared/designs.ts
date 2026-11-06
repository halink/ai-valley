import {roofColors} from './building-art.js';
import type {ToolKind} from './industry.js';
import type {BuildingKind, Inventory} from './types.js';

export const designedToolNames={rod:'钓竿',axe:'斧具',pick:'镐具',spear:'猎矛'} as const;
export const designedSpaceNames={home:'住宅',lodge:'公共旅舍',workshop:'工坊',clinic:'诊所',school:'校舍',barn:'畜舍',greenhouse:'温室',store:'商铺'} as const;
export const structuralNames={timber:'木构',masonry:'石构',mixed:'混合结构'} as const;
type Roof=typeof roofColors[number];
type Description={name:string;purpose:string};
export type ToolDrawing=Description & {kind:'tool';tool:ToolKind;frame:'wood'|'plank';fitting:'stone'|'bar'|'fiber'|'cloth';reinforcement:number};
export type BuildingDrawing=Description & {kind:'building';template:BuildingKind;width:number;height:number;roof:Roof;structure:keyof typeof structuralNames};
export type Drawing=ToolDrawing|BuildingDrawing;
export type DesignSpec=
 | Omit<ToolDrawing,keyof Description> & {materials:Inventory;minutes:number;durability:number;level:number}
 | Omit<BuildingDrawing,keyof Description> & {materials:Inventory;minutes:number;capacity:number;definition:string};
export interface ResidentDesign {
 id:string;authorId:string;name:string;purpose:string;createdAt:number;createdIn:string;
 publication:{buildingId:string;at:number}|null;learnedBy:string[];spec:DesignSpec;
}
export interface DesignState {nextSerial:number;records:ResidentDesign[];}
export type DesignAction=
 | {type:'design';operation:'draw';buildingId:string;kind:Drawing['kind'];drawing?:Drawing}
 | {type:'design';operation:'fabricate'|'publish'|'study';buildingId:string;designId:string}
 | {type:'design';operation:'equip';toolId:string};

const toolFields=['name','purpose','tool','frame','fitting','reinforcement'];
const buildingFields=['name','purpose','template','width','height','roof','structure'];
const integer=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
const label=(x:unknown,max:number):x is string=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const key=<T extends object>(table:T,value:unknown):value is keyof T=>typeof value==='string'&&Object.hasOwn(table,value);

/** A drawing describes actual stock, a known physical effect, and geometry within the engine's units. */
export function parseDrawing(kind:Drawing['kind'],value:unknown):Drawing|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const d=value as Record<string,unknown>;
 const fields=kind==='tool'?toolFields:buildingFields;
 if(Object.keys(d).some(k=>k!=='kind'&&!fields.includes(k))||(d.kind!==undefined&&d.kind!==kind)||!label(d.name,24)||!label(d.purpose,80))return null;
 const name=d.name.trim(),purpose=d.purpose.trim();
 if(kind==='tool'){
  if(!key(designedToolNames,d.tool)||(d.frame!=='wood'&&d.frame!=='plank')||!integer(d.reinforcement,0,3))return null;
  const soft=d.tool==='rod';
  if(soft?(d.fitting!=='fiber'&&d.fitting!=='cloth'):(d.fitting!=='stone'&&d.fitting!=='bar'))return null;
  const fitting=d.fitting as ToolDrawing['fitting'];
  return {kind,name,purpose,tool:d.tool,frame:d.frame,fitting,reinforcement:d.reinforcement};
 }
 if(!key(designedSpaceNames,d.template)||!integer(d.width,4,10)||!integer(d.height,4,8)||!key(structuralNames,d.structure)||!roofColors.includes(d.roof as Roof))return null;
 return {kind,name,purpose,template:d.template,width:d.width,height:d.height,roof:d.roof as Roof,structure:d.structure};
}
