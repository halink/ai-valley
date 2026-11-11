import type {Action,Activity} from './types.js';

/** Observer-only identity of work that actually completed, not its reward or yield. */
export interface WorkCompleted {
 residentId:string;planId:string;startedAt:number;
 action:'gather'|'plant'|'water'|'harvest'|'industry'|'production';
 operation?:'fish'|'cutTree'|'harvestFruit'|'plantTree'|'tendTree'|'plantCrop';
}
export function completedWorkIdentity(residentId:string,activity:Activity,action:Action):WorkCompleted|null {
 if(activity.action!==action||(!Number.isFinite(activity.remaining)||activity.remaining>0)||!Number.isFinite(activity.startedAt))return null;
 const base={residentId,planId:activity.planId,startedAt:activity.startedAt};
 if(action.type==='gather'||action.type==='plant'||action.type==='water'||action.type==='harvest')return {...base,action:action.type};
 if(action.type==='industry'&&(action.operation==='fish'||action.operation==='cutTree'||action.operation==='harvestFruit'||action.operation==='plantTree'||action.operation==='tendTree'))return {...base,action:action.type,operation:action.operation};
 if(action.type==='production'&&action.operation==='plantCrop')return {...base,action:action.type,operation:action.operation};
 return null;
}
export function validWorkCompleted(value:WorkCompleted):boolean {
 if(!value||typeof value.residentId!=='string'||!value.residentId||typeof value.planId!=='string'||!value.planId||!Number.isFinite(value.startedAt))return false;
 if(value.action==='industry')return ['fish','cutTree','harvestFruit','plantTree','tendTree'].includes(value.operation??'');
 if(value.action==='production')return value.operation==='plantCrop';
 return ['gather','plant','water','harvest'].includes(value.action)&&value.operation===undefined;
}
