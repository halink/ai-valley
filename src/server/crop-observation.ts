import type {DecisionContext} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';

export const MAX_CROP_OBSERVATIONS=8;
/** Never serialize authoritative crop internals. Observations survive a full
 * agenda and family-note truncation, independently of water inventory or focus. */
export function cropObservationNote(c:DecisionContext,choices:ActionChoice[]):string {
 const visible=c.plots.filter(p=>p.ownerId===c.actor.id&&p.observed?.atMinute===c.minute)
  .sort((a,b)=>Math.abs(a.at.x-c.actor.at.x)+Math.abs(a.at.y-c.actor.at.y)-Math.abs(b.at.x-c.actor.at.x)-Math.abs(b.at.y-c.actor.at.y)||a.id.localeCompare(b.id));
 if(!visible.length)return '';
 const targets=new Set(choices.flatMap(c=>'plotId'in c.action&&c.action.plotId?[c.action.plotId]:[]));
 const rows=visible.filter(p=>targets.has(p.id)).slice(0,MAX_CROP_OBSERVATIONS);
 if(!rows.includes(visible[0])&&rows.length<MAX_CROP_OBSERVATIONS)rows.push(visible[0]);
 const rest=visible.filter(p=>!rows.includes(p)),offset=Math.floor(c.minute/30)%Math.max(1,rest.length);
 for(let i=0;i<rest.length&&rows.length<MAX_CROP_OBSERVATIONS;i++)rows.push(rest[(offset+i)%rest.length]);
 const descriptions=rows.map(p=>{
  const o=p.observed!;
  let state=o.stage==='empty'?'未种田间作物':o.stage==='mature'?'作物已成熟，可另行决定是否收获，无须为继续生长浇水':o.stage==='unknown'?'作物生长阶段尚不能确认':'作物未成熟';
  if(o.stage!=='empty'){
   state+='；'+(o.wateredToday?'今日已浇水':'今日未浇水');
   if(o.stage==='growing')state+=o.inSeason===false?'；当前季节不适合生长，浇水不改变季节限制':o.inSeason===null?'；季节条件尚不能确认':o.wateredToday?'；今日浇水条件已具备':o.rainingNow?'；眼前正在下雨，雨水可满足生长用水条件，但不是浇水记录或未来保证':'；眼前晴天，继续生长的用水条件尚未具备';
  }
  return `本人田(${p.at.x},${p.at.y})：${state}`;
 });
 return `你在第${c.minute}分钟亲眼看到的田况（仅此刻，至多${MAX_CROP_OBSERVATIONS}块）：${descriptions.join('。')}。${visible.length>rows.length?'其他可见田况未在本次摘要列完。':''}看见需水不等于已有清水、行动权限或已选择行动；不会自动取水或浇水。离开后的田况与未来天气未知。`;
}
