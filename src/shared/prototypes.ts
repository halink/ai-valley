import type {FoodLot} from './food.js';
import type {Inventory,Item} from './types.js';

/** Finite physical vocabulary, never resident-authored code or arbitrary effect multipliers. */
export interface PrototypeDrawing {
 kind:'prototype';name:string;purpose:string;frame:'wood'|'plank';mesh:'fiber'|'cloth';cover:'none'|'cloth';
 processes:Array<'hang'|'shelter'|'airDry'>;batchSize:number;trialMinutes:number;
}
export interface PrototypeSpec extends Omit<PrototypeDrawing,'name'|'purpose'> {
 definition:'invention/air-drying@1';materials:Inventory;minutes:number;capacity:number;durability:number;
}
export interface PrototypeAsset {
 id:string;designId:string;ownerId:string;madeBy:string;buildingId:string;createdAt:number;completedAt:number|null;
 status:'assembling'|'ready'|'spent'|'discarded';materials:Inventory;worked:number;lastAt:number;durability:number;
}
export interface PrototypeTrial {
 id:string;prototypeId:string;designId:string;actorId:string;buildingId:string;startedAt:number;endedAt:number|null;
 definition:'invention/air-drying@1';input:Inventory;sourceLots:FoodLot[];expiresAt:number;
 status:'working'|'succeeded'|'failed'|'abandoned';worked:number;sunMinutes:number;rainMinutes:number;nightMinutes:number;
 lastAt:number;output:Inventory;durabilityBefore:number;durabilityAfter:number|null;reason:string|null;
}
export type PrototypeAction=
 | {type:'design';operation:'assemble';buildingId:string;designId:string;prototypeId?:string}
 | {type:'design';operation:'trial';buildingId:string;designId:string;prototypeId:string;input:Item;trialId?:string}
 | {type:'design';operation:'abandonPrototype';buildingId:string;designId:string;prototypeId:string};
export const prototypeFish=['fish','perch','carp','catfish','bream','snapper','cod','crucian'] as const;
export function parsePrototypeDrawing(value:Record<string,unknown>):PrototypeDrawing|null {
 const d=value,fields=['kind','name','purpose','frame','mesh','cover','processes','batchSize','trialMinutes'];
 if(Object.keys(d).some(k=>!fields.includes(k))||(d.kind!==undefined&&d.kind!=='prototype'))return null;
 if(![d.name,d.purpose].every((v,i)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=(i?80:24)&&!/[\u0000-\u001f\u007f]/.test(v)))return null;
 if(typeof d.frame!=='string'||!['wood','plank'].includes(d.frame)||typeof d.mesh!=='string'||!['fiber','cloth'].includes(d.mesh)||typeof d.cover!=='string'||!['none','cloth'].includes(d.cover))return null;
 if(!Number.isSafeInteger(d.batchSize)||(d.batchSize as number)<2||(d.batchSize as number)>6||!Number.isSafeInteger(d.trialMinutes)||(d.trialMinutes as number)<60||(d.trialMinutes as number)>360)return null;
 const sequence=d.cover==='cloth'?['hang','shelter','airDry']:['hang','airDry'];
 if(!Array.isArray(d.processes)||d.processes.length!==sequence.length||d.processes.some((v,i)=>v!==sequence[i]))return null;
 return {kind:'prototype',name:(d.name as string).trim(),purpose:(d.purpose as string).trim(),frame:d.frame as PrototypeDrawing['frame'],mesh:d.mesh as PrototypeDrawing['mesh'],cover:d.cover as PrototypeDrawing['cover'],processes:[...sequence] as PrototypeDrawing['processes'],batchSize:d.batchSize as number,trialMinutes:d.trialMinutes as number};
}
export function prototypeSpec(d:PrototypeDrawing):PrototypeSpec {
 const materials:Inventory={[d.frame]:4,[d.mesh]:2};
 if(d.cover==='cloth')materials.cloth=(materials.cloth??0)+2;
 return {kind:d.kind,frame:d.frame,mesh:d.mesh,cover:d.cover,processes:[...d.processes],batchSize:d.batchSize,trialMinutes:d.trialMinutes,
  definition:'invention/air-drying@1',materials,minutes:90+(d.frame==='plank'?20:0)+(d.cover==='cloth'?25:0),
  capacity:(d.frame==='plank'?4:2)+(d.mesh==='cloth'?1:0),durability:4+(d.frame==='plank'?2:0)+(d.mesh==='cloth'?1:0)};
}
