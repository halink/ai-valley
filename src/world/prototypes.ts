import {prototypeFish} from '../shared/prototypes.js';
import type {PrototypeAction,PrototypeAsset,PrototypeSpec,PrototypeTrial} from '../shared/prototypes.js';
import type {ResidentDesign} from '../shared/designs.js';
import type {Inventory,Resident,World} from '../shared/types.js';
import {actionRoom} from '../shared/rooms.js';
import {foodTransaction,initializeFood} from './food.js';
import {emitEvent} from './events.js';
import {same} from './navigation.js';
import {daylight} from './time.js';
import {foodFlowInputs,recordFoodFlow,type FoodFlowAmount,type FoodFlowReceipt} from './food-consumption-evidence.js';

const has=(bag:Inventory,cost:Inventory)=>Object.entries(cost).every(([key,n])=>(bag[key as keyof Inventory]??0)>=n!);
const asset=(w:World,id:string|undefined)=>w.designs?.prototypes?.find(p=>p.id===id);
const trial=(w:World,id:string|undefined)=>w.designs?.trials?.find(t=>t.id===id);
const activeTrial=(w:World,id:string)=>w.designs?.trials?.find(t=>t.prototypeId===id&&t.status==='working');
export const prototypeValidated=(w:World,d:ResidentDesign)=>w.designs?.trials?.some(t=>t.designId===d.id&&t.actorId===d.authorId&&t.status==='succeeded')??false;
export function prototypeActionReason(w:World,r:Resident,a:PrototypeAction,d:ResidentDesign):string|null {
 if(d.spec.kind!=='prototype'||!(d.authorId===r.id||d.learnedBy.includes(r.id)))return '本人尚未掌握此原型图纸';
 const p=asset(w,a.prototypeId);
 if(a.operation==='assemble'){
  if(r.skills.building<1)return '试作须先掌握一级建造技能';
  if(a.prototypeId)return p&&p.designId===d.id&&p.ownerId===r.id&&p.status==='assembling'&&p.buildingId===a.buildingId?null:'原型不在此工位、已结束或不归本人';
  if(w.designs?.prototypes?.some(p=>p.ownerId===r.id&&p.status==='assembling'))return '先续做或放弃本人尚未完成的原型';
  return has(r.inventory,d.spec.materials)?null:'本人实际原型部件材料不足';
 }
 if(!p||p.ownerId!==r.id||p.designId!==d.id)return '本人没有这件原型';
 // Relinquishing continuation neither enters the old site nor recovers or clears its material.
 if(a.operation==='abandonPrototype')return p.status==='discarded'?'该原型已经放弃':null;
 if(p.status!=='ready'||p.durability<=0)return '原型尚未完成或已经耗尽耐用';
 if(a.trialId){const t=trial(w,a.trialId);return t&&t.status==='working'&&t.prototypeId===p.id&&t.actorId===r.id&&t.buildingId===a.buildingId&&t.input[a.input]===d.spec.batchSize?null:'这次原型试用已结束或不在此地';}
 if(activeTrial(w,p.id))return '先续做或放弃已经投入鲜鱼的这次试用';
 return prototypeFish.includes(a.input as typeof prototypeFish[number])&&(r.inventory[a.input]??0)>=d.spec.batchSize?null:'缺少图纸所需数量的本人鲜鱼';
}
export function prototypeDuration(w:World,a:PrototypeAction,spec:PrototypeSpec):number {
 if(a.operation==='abandonPrototype')return 5;
 return Math.max(1,a.operation==='assemble'?spec.minutes-(asset(w,a.prototypeId)?.worked??0):spec.trialMinutes-(trial(w,a.trialId)?.worked??0));
}
function present(w:World,r:Resident,a:PrototypeAction):boolean {
 const b=w.buildings.find(b=>b.id===a.buildingId);if(!b||!same(r.at,b.door))return false;
 if(a.operation==='trial')return !r.inside;
 if(!w.rooms)return true;
 const room=r.activity&&actionRoom(w,r,r.activity);return !!room&&r.inside===b.id&&!!r.roomAt&&same(r.roomAt,room.target);
}
function notice(w:World,r:Resident,d:ResidentDesign,text:string){return emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},designId:d.id,text});}
/** The saved trial links start and outcome, but its historical sourceLots are
 * not an active physical container. Never replay them as a second input debit. */
function observePrototype(w:World,r:Resident,t:PrototypeTrial,eventId:string,
 phase:Extract<FoodFlowReceipt,{action:'prototype_trial'}>['phase'],
 failureReason:Extract<FoodFlowReceipt,{action:'prototype_trial'}>['failureReason'],inputs:FoodFlowAmount[]|undefined){
 if(!r.activity)return;
 const inputItem=Object.keys(t.input)[0] as typeof prototypeFish[number];
 recordFoodFlow(w,{type:'processed',action:'prototype_trial',phase,at:w.minute,residentId:r.id,eventId,
  planId:r.activity.planId,container:'person:'+r.id,definition:t.definition,trialId:t.id,prototypeId:t.prototypeId,
  designId:t.designId,buildingId:t.buildingId,startedAt:t.startedAt,inputItem,inputQuantity:t.input[inputItem]!,failureReason,
  inputs,output:phase==='succeeded'?{...t.output}:{}});
}
/** Called only after arrival, room claims and work-schedule checks. Up-front physical inputs stay spent on interruption. */
export function workPrototype(w:World,r:Resident,a:PrototypeAction,d:ResidentDesign,minutes:number):string|null {
 const error=prototypeActionReason(w,r,a,d);if(error)return error;
 if(!present(w,r,a))return '本人尚未到达原型的实际工作位置';
 if(a.operation==='abandonPrototype'||d.spec.kind!=='prototype')return null;
 const spec=d.spec,state=w.designs!;
 if(a.operation==='assemble'){
  let p=asset(w,a.prototypeId);
  if(!p){
   for(const [i,n] of Object.entries(spec.materials))r.inventory[i as keyof Inventory]=(r.inventory[i as keyof Inventory]??0)-n!;
   p={id:`prototype:${w.id}:${state.nextSerial++}`,designId:d.id,ownerId:r.id,madeBy:r.id,buildingId:a.buildingId,createdAt:w.minute,completedAt:null,status:'assembling',materials:{...spec.materials},worked:0,lastAt:w.minute-minutes,durability:spec.durability};
   (state.prototypes??=[]).push(p);a.prototypeId=p.id;
   notice(w,r,d,`${r.name}在实际桌台投入部件，开始试作「${d.name}」。中断不退回已用材料。`);
  }
  const dt=Math.max(0,Math.min(minutes,w.minute-p.lastAt,spec.minutes-p.worked));p.worked+=dt;p.lastAt=w.minute;return null;
 }
 const p=asset(w,a.prototypeId)!;
 let t=trial(w,a.trialId);
 if(!t){
  // Snapshot before foodTransaction/initializeFood can repair missing lot metadata.
  const inputs=foodFlowInputs(w,'person:'+r.id,{[a.input]:spec.batchSize},1,true);
  if(inputs){
   const lots=w.food?.lots['person:'+r.id]?.[a.input];
   const held=Array.isArray(lots)&&lots.every(l=>l&&Number.isFinite(l.quantity)&&l.quantity>0)?lots.reduce((n,l)=>n+l.quantity,0):null;
   if(held===null||Math.abs(held-(r.inventory[a.input]??0))>1e-9){inputs[0].lots=null;inputs[0].nutrition=null;}
  }
  foodTransaction(w,()=>{
   initializeFood(w);let left=spec.batchSize;
   const sourceLots=(w.food?.lots['person:'+r.id]?.[a.input]??[]).slice().sort((a,b)=>a.expiresAt-b.expiresAt).flatMap(l=>{const quantity=Math.min(left,l.quantity);left-=quantity;return quantity>0?[{...l,quantity}]:[];});
   if(left>1e-9)throw new Error('prototype_food_lots_missing');
   r.inventory[a.input]=(r.inventory[a.input]??0)-spec.batchSize;
   t={id:`prototype-trial:${w.id}:${state.nextSerial++}`,prototypeId:p.id,designId:d.id,actorId:r.id,buildingId:a.buildingId,startedAt:w.minute,endedAt:null,
    definition:spec.definition,input:{[a.input]:spec.batchSize},sourceLots,expiresAt:Math.min(...sourceLots.map(l=>l.expiresAt)),status:'working',worked:0,sunMinutes:0,rainMinutes:0,nightMinutes:0,lastAt:w.minute-minutes,output:{},durabilityBefore:p.durability,durabilityAfter:null,reason:null};
   (state.trials??=[]).push(t);a.trialId=t.id;
  });
  const event=notice(w,r,d,`${r.name}把本人${spec.batchSize}份鲜鱼实际挂上「${d.name}」，开始在${w.buildings.find(b=>b.id===a.buildingId)!.name}门外照看晾晒。`);
  observePrototype(w,r,t!,event.id,'started',null,inputs);
 }
 const current=t!,dt=Math.max(0,Math.min(minutes,w.minute-current.lastAt,spec.trialMinutes-current.worked));
 current.worked+=dt;current.lastAt=w.minute;
 if(w.weather==='rain')current.rainMinutes+=dt;
 else if(daylight(w.minute).phase==='day')current.sunMinutes+=dt;
 else current.nightMinutes+=dt;
 return null;
}
function settleTrial(w:World,r:Resident,d:ResidentDesign,p:PrototypeAsset,t:PrototypeTrial,abandon=false){
 if(t.status!=='working'||d.spec.kind!=='prototype')return;
 const spec=d.spec,overload=spec.batchSize>spec.capacity;
 const wet=spec.cover==='cloth'?t.rainMinutes/4:t.rainMinutes;
 const needed=120+(spec.batchSize-2)*20;
 const failureReason=abandon?'abandoned':overload?'overload':w.minute>=t.expiresAt?'expired':wet>30?'rain':t.sunMinutes<needed?'sunlight':null;
 t.reason=abandon?'本人放弃，已投入鲜鱼不返还':overload?'实际挂载超过支架承重':w.minute>=t.expiresAt?'原鲜鱼批次已超过安全加工期限':wet>30?'雨水暴露超过可用干燥条件':t.sunMinutes<needed?'实际晴天白昼干燥时间不足':null;
 t.status=abandon?'abandoned':t.reason?'failed':'succeeded';t.endedAt=w.minute;
 const wear=overload?2:1;p.durability=Math.max(0,p.durability-wear);t.durabilityAfter=p.durability;
 if(!p.durability)p.status='spent';
 if(t.status==='succeeded'){t.output={driedFish:Math.floor(spec.batchSize/2)};r.inventory.driedFish=(r.inventory.driedFish??0)+t.output.driedFish!;}
 const heading=abandon?`${r.name}决定不再继续「${d.name}」在${w.buildings.find(b=>b.id===t.buildingId)?.name??t.buildingId}门外的试用，以下为原址记录`:`${r.name}结束「${d.name}」的实际试用`;
 const event=notice(w,r,d,`${heading}：照看${t.worked}分钟，晴天白昼${t.sunMinutes}分钟、雨中${t.rainMinutes}分钟、其他时段${t.nightMinutes}分钟；${t.reason??`产出${t.output.driedFish}份鱼干`}。耐用从${t.durabilityBefore}降至${t.durabilityAfter}。`);
 observePrototype(w,r,t,event.id,t.status,failureReason,[]);
}
export function completePrototype(w:World,r:Resident,a:PrototypeAction,d:ResidentDesign):string|null {
 const p=asset(w,a.prototypeId);if(!p||d.spec.kind!=='prototype')return '原型尚未真实投入制作';
 if(a.operation==='assemble'){
  if(p.worked<d.spec.minutes)return '实际试作工时尚不足';
  p.status='ready';p.completedAt=w.minute;
  notice(w,r,d,`${r.name}经过${p.worked}分钟实际劳动，完成「${d.name}」原型并随身携带；其效果尚待实际试用。`);
 }else if(a.operation==='trial'){
  const t=trial(w,a.trialId);if(!t||t.worked<d.spec.trialMinutes)return '实际试用工时尚不足';
  settleTrial(w,r,d,p,t);
 }else{
  const t=activeTrial(w,p.id);if(t)settleTrial(w,r,d,p,t,true);
  p.status='discarded';
  notice(w,r,d,`${r.name}自行决定不再继续制作或试用「${d.name}」，保留原址部件、已用工时和试用记录，不清理旧址、不返还材料。`);
 }
 return null;
}
