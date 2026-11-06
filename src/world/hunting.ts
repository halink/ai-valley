import {beastNames} from '../shared/frontier-hazards.js';
import type {IndustryAction} from '../shared/industry.js';
import type {Resident,Vec,World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {alarmWildBeast,woundWildBeast} from './frontier-hazards.js';
import {distance,findPath,walkable} from './navigation.js';

export function carriedHuntingSpear(w:World,r:Resident,id?:string){
 return w.industry?.tools.find(t=>t.kind==='spear'&&t.ownerId===r.id&&!t.location&&t.durability>0&&(!id||t.id===id));
}

export function huntingTarget(w:World,r:Resident,a:IndustryAction):{target:Vec;duration:number;error?:string}{
 const fail=(error:string)=>({target:r.at,duration:0,error});
 if(w.scenario!=='frontier'||!w.frontierHazards||r.inside||!a.at||!a.beastId||distance(r.at,a.at)>10||!walkable(w,a.at,r.at))return fail('须在户外前往自己近处见到猎物的地点');
 const spear=carriedHuntingSpear(w,r,a.toolId);
 if(!spear)return fail('打猎需要本人随身携带的可用猎矛');
 a.toolId=spear.id;
 return {target:{...a.at},duration:14};
}

/** An action reaches the original sighting. An animal that has since moved out of reach escapes. */
export function completeHunt(w:World,r:Resident,a:IndustryAction):string|null {
 if(r.activity?.action!==a||r.activity.remaining>0)return '打猎需要本人实际完成一次进攻准备';
 const beast=w.frontierHazards?.beasts.find(b=>b.id===a.beastId&&b.status!=='dead');
 if(!beast||!findPath(w,r.at,beast.at,false,2))return '到场后未能接近原先看到的猎物';
 const spear=carriedHuntingSpear(w,r,a.toolId);
 if(!spear)return '本人随身的猎矛已不可用';
 const hit=woundWildBeast(w,beast.id,45+7*spear.level-(r.energy<30?15:0));
 if(!hit)return '到场后未能接近原先看到的猎物';
 spear.durability--;
 const name=beastNames[hit.species];
 let text:string;
 if(hit.killed){
  const meat={boar:5,wolf:2,deer:6,hare:1,fox:2,duck:1}[hit.species];
  const totals=w.industry!.totals;
  r.inventory.gameMeat=(r.inventory.gameMeat??0)+meat;
  totals.gameMeat=(totals.gameMeat??0)+meat;
  text=`${r.name}用猎矛猎获一只${name}，实际取得${meat}份生猎肉。`;
 }else{
  alarmWildBeast(w,beast.id,r);
  text=`${r.name}用猎矛刺伤一只${name}，野兽仍然活着，可能还击或逃走。`;
 }
 emitEvent(w,{kind:'hazard',actors:[r.id],animalIds:[beast.id],place:{...r.at},text});
 return null;
}
