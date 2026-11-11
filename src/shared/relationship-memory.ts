/** Private, directional recollections. No reciprocal attitude or current target state. */
export interface RelationshipMemory {
 targetId:string;
 name:string;
 affection:number|null;
 trust:number|null;
 conflict:number|null;
 interpretation:{text:string;at:number|null;source:'self'|'witness'|'heard'|null}|null;
}
export interface RelationshipMemories {atMinute:number;people:RelationshipMemory[];}
