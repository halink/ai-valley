import type {Action,DecisionContext,Resident,World} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';
import {CULTIVARS,cultivarKeys,type Cultivar} from '../shared/mvp-agriculture.js';
import {MVP_HALL} from '../shared/mvp-hamlet.js';
import {roomLayout} from '../shared/rooms.js';
import {canObserve} from '../world/knowledge.js';
import {canObserveOutdoors} from '../world/outdoor-observation.js';

import type {SeasonalPersonalContext} from '../shared/mvp-seasonal.js';
import {visibleSeasonalPlots,validateSeasonalKnowledge} from '../world/mvp-seasonal-knowledge.js';
/** Current personal perception only. No initialization, path probe, forecast,
 * other person's ledger, or observer-wide snapshot is called here. */
export function seasonalPersonalContext(w:World,r:Resident):SeasonalPersonalContext|undefined {
 if(w.mode!=='validation'||!w.mvpAgriculture||!w.mvpClimate||!w.mvpSoil)return;
 validateSeasonalKnowledge({...w,residents:[r]});
 const awake=canObserve(w,r),outdoors=canObserveOutdoors(w,r),weather=w.mvpClimate.current;
 const hall=w.buildings.find(b=>b.id===MVP_HALL&&r.knownBuildings.includes(b.id));
 const near=(key:string)=>{if(!awake||!hall||r.inside!==hall.id||!r.roomAt)return false;const slot=roomLayout(w,hall).slots.find(s=>s.key===key);return !!slot&&r.roomAt.x===slot.at.x&&r.roomAt.y===slot.at.y;};
 const account=w.mvpPreservation?.accounts[r.id];
 return {schemaVersion:1,atMinute:w.minute,weather:outdoors?{condition:weather.condition,temperature:weather.temperatureDeciC<100?'cold':weather.temperatureDeciC>=240?'warm':'mild',humidity:weather.relativeHumidityPermille>=800?'humid':weather.relativeHumidityPermille<350?'dry':'ordinary'}:null,
  plots:visibleSeasonalPlots(w,r),
  rememberedPlots:r.mvpSeasonalKnowledge?Object.values(r.mvpSeasonalKnowledge.latest).map(id=>structuredClone(r.mvpSeasonalKnowledge!.receipts[id])):[],
  hall:hall?{id:hall.id,door:{...hall.door},seedStock:near('mvp-seed')?Object.fromEntries(cultivarKeys.map(c=>[c,w.mvpAgriculture!.grants[c].stock])) as Record<Cultivar,number>:null,preserverInstalled:w.mvpPreservation&&near('kitchen')?!!w.mvpPreservation.installed:null}:null,
  preservation:account?{unknownFreshness:account.unknown,lots:account.lots.filter(l=>l.quantity>0).map(l=>({quantity:l.quantity,producedAt:l.producedAt,expiresAt:l.expiresAt}))}:null};
}
/** Only this already filtered personal value may influence new choices. */
export function seasonalChoiceGroups(c:DecisionContext):ActionChoice[][] {
 const v=c.mvpSeasonal;if(!v||v.atMinute!==c.minute)return [];
 const groups:ActionChoice[][]=Array.from({length:10},()=>[]);
 const add=(g:number,id:string,label:string,action:Action)=>groups[g].push({id:'seasonal.'+id,label,action});
 const n=(i:keyof Resident['inventory'])=>c.actor.inventory[i]??0;
 for(const p of v.plots){
  const target=p.target;
  if(p.kind==='empty')for(const cultivar of cultivarKeys){const d=CULTIVARS[cultivar];if((d.seasons as readonly string[]).includes(c.season)&&n(d.seed)>=1)add(0,'plant.'+target.plotId+'.'+cultivar,`在本人亲见空田播${d.name}（实际1份同种种子、15分钟）`,{type:'mvpAgriculture',operation:'plant',cultivar,target:structuredClone(target)});}
  if(p.kind==='climate'&&p.cultivar){
   if(p.mature)add(1,'harvest.'+target.plotId,`收本人亲见成熟${CULTIVARS[p.cultivar].name}（10分钟，原实例到场重验）`,{type:'mvpAgriculture',operation:'harvest',cultivar:p.cultivar,target:structuredClone(target)});
   if(n('water')>=1)add(2,'water.'+target.plotId,'给本人亲见的新作物田浇1份水（8分钟；是否浇水由本人决定）',{type:'water',plotId:target.plotId,expectedInstanceId:target.instanceId!});
  }
  if(p.kind!=='empty')add(3,'clear.'+target.plotId,'清除本人亲见的原作物（30分钟，不退种、不产粮；成熟作物也可自主放弃）',{type:'mvpAgriculture',operation:'clear',cultivar:p.cultivar??'spring',target:{...target,replace:true}});
 }
 if(v.hall){
  if(v.hall.seedStock===null)add(5,'inspect.seed','按已知地址进入灶堂公开种台查看（实际走路和1分钟观察；不领取、不保证余量）',{type:'mvpInspect',station:'seed'});
  if(v.hall.preserverInstalled===null)add(9,'inspect.kitchen','按已知地址进入灶堂公开厨房查看（实际走路和1分钟观察；不安装、不加工）',{type:'mvpInspect',station:'kitchen'});
  if(v.hall.seedStock!==null){
   const remembered=new Map(v.rememberedPlots.map(k=>[k.plot.target.plotId,k.plot]));for(const p of v.plots)remembered.set(p.target.plotId,p);
   const fields=[...remembered.values()].sort((a,b)=>a.target.plotId.localeCompare(b.target.plotId));
   for(const cultivar of cultivarKeys){const d=CULTIVARS[cultivar],held=Math.floor(n(d.seed));if(!(d.seasons as readonly string[]).includes(c.season)||v.hall.seedStock[cultivar]<1)continue;
    const plans=fields.map(p=>[p]);for(let i=0;i<fields.length;i++)for(let j=i+1;j<fields.length;j++)plans.push([fields[i],fields[j]]);
    for(const plan of plans){if(held>=plan.length)continue;
     const targets=plan.map(p=>({...p.target,replace:p.kind!=='empty'})),target=targets[held];
     const scope=plan.map(p=>`田${p.target.plotId}(${p.at.x},${p.at.y})${p.kind==='empty'?'空田播种':'明确替换原作物'}`).join('、');
     add(6,'collect.'+cultivar+'.'+targets.map(t=>t.plotId).join('+'),`明确规划${plan.length}块本人记录中的田：${scope}；已有${held}份${d.name}种，按此计划下一缺口领取1份（10分钟；旧田况可能变化须重看，不自动清田，未选田不计配额）`,{type:'mvpAgriculture',operation:'collectSeed',cultivar,target:structuredClone(target),targets:structuredClone(targets)});
    }
   }
  }
  // Address-based preparation is added only after the personal observation
  // contract can physically reach the corresponding public room station.
  if(v.hall.seedStock!==null)for(const cultivar of cultivarKeys){const d=CULTIVARS[cultivar];if(n(d.root)>=1)add(4,'save.'+cultivar,`用本人1份${d.name}留2份同种种子（30分钟，不强制留种上限）`,{type:'mvpAgriculture',operation:'saveSeed',cultivar});}
  if(v.hall.preserverInstalled!==null){
   for(const cultivar of cultivarKeys){const d=CULTIVARS[cultivar];if(n(d.root)>=2&&n('water')>=1)add(7,'cook.'+cultivar,`用本人2份${d.name}和1水做1份餐食（20分钟）`,{type:'mvpAgriculture',operation:'cook',cultivar});}
   if(v.hall.preserverInstalled&&n('fruit')>=2&&n('water')>=1&&n('wood')>=1)add(8,'preserve','用本人2果1水1木制作2份罐藏（60分钟，实际56日批次；不保证越冬）',{type:'mvpPreservation',operation:'preserve'});
   if(!v.hall.preserverInstalled&&n('wood')>=6&&n('stone')>=6)add(8,'install','用本人6木6石安装共用罐藏工位（120分钟）',{type:'mvpPreservation',operation:'install'});
  }
 }
 return groups.map(g=>{const offset=Math.floor(c.minute/30)%Math.max(1,g.length);return [...g.slice(offset),...g.slice(0,offset)];});
}
export function seasonalPersonalNote(c:DecisionContext):string {
 const v=c.mvpSeasonal;if(!v||v.atMinute!==c.minute)return '';
 const weather=v.weather?`本人此刻户外所感：${{sun:'晴',cloud:'阴',rain:'雨',snow:'雪',mixed:'雨雪混合'}[v.weather.condition]}；${{cold:'偏冷',mild:'温和',warm:'偏热'}[v.weather.temperature]}；空气${{dry:'偏干',ordinary:'无明显干湿感',humid:'潮湿'}[v.weather.humidity]}。这是定性游戏感知，不是温湿度仪读数或未来预报。`:'本人当前没有户外现场气候观察，不从全局天气补知。';
 const plots=v.plots.map(p=>`本人亲见田(${p.at.x},${p.at.y})：${p.kind==='empty'?'空田':p.kind==='legacy'?'旧制作物':CULTIVARS[p.cultivar!].name+(p.mature?'已成熟':'仍在生长')}；土壤游戏感知${p.soil==='dry'?'偏干':p.soil==='adequate'?'有可用水':'未知'}，不等于已有水或必须浇水。`).join('');
 const stored=v.preservation?`本人新制罐藏有${v.preservation.lots.reduce((s,l)=>s+l.quantity,0)}份已知到期批次，旧鲜度未知${v.preservation.unknownFreshness}份；鲜食腐坏未模拟，不能称冬储充足。`:'';
 const memories=v.rememberedPlots.map(k=>`本人在第${k.observedAt}分钟亲见的田(${k.plot.at.x},${k.plot.at.y})记录${k.id}，仅证明当时${k.plot.kind==='empty'?'空田':'有原作物'}；离开后当前状态未知。`).join('');
 return `季节观察（第${v.atMinute}分钟，schema1）：${weather}${plots}${memories}${stored}远方余量、工位忙闲、他人库存与未来首收均未由此获得。`;
}
