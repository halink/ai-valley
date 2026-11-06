import {firstReceipt} from './receipts.js';
import {activeDefinitionError} from './content-schema.js';
import {proveExtension} from './content-proof.js';
import {itemKeys} from '../shared/items.js';
import {createHash} from 'node:crypto';
import {findPath, distance} from './navigation.js';
import {ageYears} from './time.js';
import type {Action,ContentDefinition, Inventory, Item, Resident, Vec, World} from '../shared/types.js';

export interface ContentResult {ok:boolean;error?:string;duplicate?:boolean;}
const items:Item[]=itemKeys;
export const definitionKey=(d:ContentDefinition)=>`${d.id}@${d.version}`;
function validInventory(value:Inventory):boolean{return Object.entries(value).every(([item,n])=>items.includes(item as Item)&&Number.isFinite(n)&&Number.isInteger(n)&&n!>=0);}
function debit(inventory:Inventory,cost:Inventory):boolean {
 if(!validInventory(cost)||Object.entries(cost).some(([k,n])=>(inventory[k as Item]??0)<n!))return false;
 for(const [k,n] of Object.entries(cost))inventory[k as Item]=(inventory[k as Item]??0)-n!;return true;
}
function credit(inventory:Inventory,value:Inventory){for(const [k,n] of Object.entries(value))inventory[k as Item]=(inventory[k as Item]??0)+n!;}
function canonical(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
 return JSON.stringify(value);
}
function requestMark(id:string,value:unknown){return `${id}:${createHash('sha256').update(canonical(value)).digest('hex')}`;}
function checkedRequest(w:World,id:string,value:unknown):ContentResult|null {
 const mark=requestMark(id,value),old=firstReceipt(w,id);
 if(old)return old===mark?{ok:true,duplicate:true}:{ok:false,error:'请求标识已用于其他内容'};
 return null;
}
function register(target:Record<string,ContentDefinition>,definition:ContentDefinition):ContentResult {
 if(!definition||typeof definition.id!=='string'||!/^[-a-zA-Z0-9/]+$/.test(definition.id)||!Number.isSafeInteger(definition.version)||definition.version<1||!['action','recipe','building','life'].includes(definition.kind)||!Array.isArray(definition.dependencies)||definition.dependencies.some(dep=>typeof dep!=='string'||!target[dep])||!definition.data||typeof definition.data!=='object'||Array.isArray(definition.data))return {ok:false,error:'定义版本或依赖不可解析'};
 if(definition.cost&&!validInventory(definition.cost))return {ok:false,error:'定义材料数量无效'};
 const key=definitionKey(definition),old=target[key];
 if(old)return canonical(old)===canonical(definition)?{ok:true,duplicate:true}:{ok:false,error:'不可覆写已有内容定义版本'};
 target[key]=structuredClone(definition);return {ok:true};
}
/** Existing instances keep their own key; registering a version never migrates them. */
export function registerDefinition(w:World,definition:ContentDefinition):ContentResult {return register(w.definitions,definition);}

export type BootstrapStep=
 | {kind:'gather';resourceId:string;quantity:number}
 | {kind:'recipe';definition:string;count:number}
 | {kind:'act'|'start';actorId?:string;actions:Action[]}
 | {kind:'advance';minutes:number}
 | {kind:'season';season:import('../shared/types.js').Season};
export interface ExtensionPlan {
 id:string;expectedRevision:number;actorId:string;definitions:ContentDefinition[];maxMinutes?:number;
 activate:Record<string,string>;steps:BootstrapStep[];required:Inventory;
}
/** Atomically installs definitions only. Proof sources are the current world, never a cached launch stockpile. */
export function activateExtension(w:World,plan:ExtensionPlan):ContentResult {
 const duplicate=checkedRequest(w,`extension:${plan.id}`,plan);if(duplicate)return duplicate;
 if(plan.expectedRevision!==w.revision)return {ok:false,error:'世界已经变化，必须基于最新已提交状态重新核验'};
 const definitions=structuredClone(w.definitions);
 for(const definition of plan.definitions){const result=register(definitions,definition);if(!result.ok)return result;}
 for(const [alias,key]of Object.entries(plan.activate))if(!definitions[key]||definitions[key].id!==alias)return {ok:false,error:'启用映射与定义不一致'};
 const candidate={...w,definitions,activeDefinitions:{...w.activeDefinitions,...plan.activate}};
 for(const key of Object.values(plan.activate)){const d=definitions[key],error=activeDefinitionError(candidate,d);if(error)return {ok:false,error};}
 if(!validInventory(plan.required))return {ok:false,error:'目标数量无效'};
 let proof:ContentResult;try{proof=proveExtension(w,plan,definitions);}catch{return {ok:false,error:'隔离启动路径含不可执行行动，定义与世界未变更'};}if(!proof.ok)return proof;
 // No awaits occur between current-state validation and this commit; callers persist this mutation in the same transaction.
 w.definitions=definitions;w.activeDefinitions={...w.activeDefinitions,...plan.activate};w.processed.push(requestMark(`extension:${plan.id}`,plan));w.revision++;
 return {ok:true};
}

export interface BuildingMigration {
 id:string;expectedRevision:number;buildingId:string;from:string;to:string;
 payerId:string;charge:Inventory;refund:Inventory;
 consent:{actorId:string;buildingId:string;from:string;to:string;revision:number;acceptedAt:number};
}
/** Legacy direct callers cannot manufacture an owner's consent or bypass physical work. */
export function migrateBuilding(_w:World,_plan:BuildingMigration):ContentResult {return {ok:false,error:'旧式直接迁移已经停用，须登记具体提议，由产权人独立接受并实际施工'};}
