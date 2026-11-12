import type {DecisionContext} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';

export const MAX_VISIBLE_BERRY_OBSERVATIONS=4;
/** The context already applies personal knowledge, sight and indoor boundaries.
 * Do not consult the world, remembered addresses or regrowth metadata here. */
export function visibleBerryObservationNote(c:DecisionContext,choices:ActionChoice[]):string {
 if(!c.formal)return '';
 const targets=new Set(choices.flatMap(row=>row.action.type==='gather'?[row.action.resourceId]:[]));
 const visible=c.resources.filter(s=>s.kind==='bush'&&Number.isSafeInteger(s.at.x)&&Number.isSafeInteger(s.at.y)
  &&s.at.x>=0&&s.at.y>=0&&s.at.x<c.bounds.width&&s.at.y<c.bounds.height)
  .sort((a,b)=>Number(targets.has(b.id))-Number(targets.has(a.id))
   ||Math.abs(a.at.x-c.actor.at.x)+Math.abs(a.at.y-c.actor.at.y)-Math.abs(b.at.x-c.actor.at.x)-Math.abs(b.at.y-c.actor.at.y)||a.id.localeCompare(b.id));
 if(!visible.length)return '';
 const rows=visible.slice(0,MAX_VISIBLE_BERRY_OBSERVATIONS).map(s=>{
  const amount=Number.isFinite(s.amount)&&s.amount>=0?s.amount:null;
  return `浆果地点(${s.at.x},${s.at.y})：${amount===null?'当前余量未知':`当前看见${amount}份${amount===0?'，此刻没有浆果':amount<1?'，不足一整份，不能完成一次整份采集':''}`}`;
 });
 return `你在第${c.minute}游戏分钟现场看见的浆果（至多${MAX_VISIBLE_BERRY_OBSERVATIONS}处）：${rows.join('。')}。`
  +(visible.length>rows.length?`另有${visible.length-rows.length}处现场观察未展开，未列出不表示没有食物。`:'')
  +'这些仍是原地未采的实物，不计入本人已有口粮；看见不等于能接触、已有采集权限或已选行动。只能另选已有菜单并实际走路、采集、进食，途中余量或路线可变；不预报再生时间、未来产量或离开后的库存。';
}
