import type {Item} from './types.js';
export const focusNames={daily:'日常生活',farming:'农事与果园',industry:'畜牧与工艺',trade:'买卖与经营',construction:'建造与交通',community:'公共事务',family:'家庭与居住',care:'健康与照护',learning:'学习与传授',social:'相处与交流',exploration:'探索与迁居',funerary:'身后与纪念'} as const;
export type Focus=keyof typeof focusNames;
export type RoutineAction={type:'eat';item:Item}|{type:'sleep';minutes:number};
export interface AgencyAction {type:'agency';operation:'reflect'|'conclude'|'arm'|'disarm';focus?:Focus;text?:string;routineId?:string;routineAction?:RoutineAction;threshold?:number;days?:number;uses?:number;cooldown?:number;}
export interface PersonalGoal {id:string;text:string;focus:Focus;createdAt:number;endedAt:number|null;outcome:string|null;status:'active'|'revised'|'concluded';evidence:string[];}
export interface PersonalRoutine {id:string;action:RoutineAction;homeId:string|null;definition:string;ruleDefinition:string;armedAt:number;expiresAt:number;threshold:number;cooldown:number;remaining:number;attempted:number;succeeded:number;lastAt:number;pendingPlanId:string|null;status:'active'|'disarmed'|'expired'|'failed'|'exhausted';reason:string|null;}
export interface AgencyState {focus:Focus|null;goals:PersonalGoal[];routines:PersonalRoutine[];nextSerial:number;}
export function repeatsActiveGoal(state:AgencyState|undefined,action:AgencyAction):boolean{
 return action.operation==='reflect'&&!!state?.goals.some(goal=>goal.status==='active'&&goal.focus===action.focus&&goal.text===action.text?.trim());
}
