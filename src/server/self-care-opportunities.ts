import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {commonsStay} from '../shared/commons.js';
import {residentialStay} from '../shared/premises.js';
import type {Action,FormalOpportunity,Resident,World} from '../shared/types.js';
import {selfCareReason} from '../world/self-care.js';
import {knownAgeYears} from '../world/time.js';
import {MAX_DIRECT_EAT_CHOICES} from './direct-food-choices.js';

/** Separate from display age: supplied only for genuinely unknown birth data.
 * No policy chooses an action. Numbering, duration selection and execution use
 * the same ordinary final-menu path as known-age residents. */
export function unknownAgeSelfCare(w:World,r:Resident):FormalOpportunity[]|undefined {
 if(knownAgeYears(r.bornAt,w.minute)!==null)return undefined;
 const rows:FormalOpportunity[]=[],add=(id:string,label:string,action:Action,duration=false)=>{
  if(selfCareReason(w,r,action))return;
  rows.push({id,label,action:duration?{...action,minutes:0} as Action:action,...(duration?{chooseDuration:true}:{})});
 };
 add('wait.duration','原地停留（填写本人决定的 minutes，1–720分钟）',{type:'wait',minutes:1},true);
 const foods=itemKeys.filter(item=>goods[item].food>0&&Number.isFinite(r.inventory[item])&&(r.inventory[item]??0)>=1),offset=foods.length>MAX_DIRECT_EAT_CHOICES?Math.floor(w.minute/30)%foods.length:0;
 for(let i=0;i<Math.min(MAX_DIRECT_EAT_CHOICES,foods.length);i++){const item=foods[(offset+i)%foods.length];add('eat.'+item,`吃1份自有${itemLabels[item]}`,{type:'eat',item});}
 const home=w.buildings.find(b=>b.id===r.homeId&&r.knownBuildings.includes(b.id));
 if(home){
  add('sleep.duration','到自己的实际床位睡觉（路程另计，填写本人决定的 minutes，1–720分钟）',{type:'sleep',minutes:1},true);
  if(home.door.x!==r.at.x||home.door.y!==r.at.y)add('move.home','走到本人已知住处门外查看',{type:'move',to:{...home.door}});
 }
 // An already held temporary bed is personal use, not authority to obtain a
 // new public allocation or sign a lease. Leave all held alternatives to the
 // normal bounded final-menu rotation; an id-first choice could hide a nearby
 // lifesaving bed behind a legal but much farther one indefinitely.
 const alternatives=w.buildings.filter(b=>b.id!==r.homeId&&r.knownBuildings.includes(b.id)&&(commonsStay(w,r,b.id)||residentialStay(w,r.id,b.id)))
  .sort((a,b)=>a.id.localeCompare(b.id));
 for(const b of alternatives)add('sleep.held.'+b.id,`到已有使用权的${b.name}实际床位睡觉（路程另计，填写 minutes，1–720分钟）`,{type:'sleep',buildingId:b.id,minutes:1},true);
 for(const [id,name,dx,dy]of [['east','东',6,0],['south','南',0,6],['west','西',-6,0],['north','北',0,-6]] as const)
  add('explore.'+id,`向${name}步行6格（沿实际可达路线，不取得物资或使用权）`,{type:'move',to:{x:r.at.x+dx,y:r.at.y+dy}});
 return rows;
}
