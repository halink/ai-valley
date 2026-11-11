import {disasterContains,type FrontierDisaster} from '../shared/frontier-hazards.js';
import type {Vec,World} from '../shared/types.js';
import {emitLedgerEvent} from './events.js';
import {distance} from './navigation.js';
import {isSurfaceWater} from './water-supply.js';
import {DAY} from './time.js';

const directions=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
const key=(p:Vec)=>`${p.x},${p.y}`;
const terrain=(w:World,p:Vec)=>p.x>=0&&p.y>=0&&p.x<w.map.width&&p.y<w.map.height?w.map.tiles[p.y*w.map.width+p.x]:undefined;
const noise=(seed:number,n:number)=>((Math.imul(seed^(n*337),1103515245)>>>8)%997)/997;

/** Registration never invents past rain or modifies an already recorded disaster. */
export function initializeWeatherHazards(w:World){
 if(!w.frontierHazards)return;
 w.frontierHazards.weather??={version:1,enabled:false,registeredAt:w.minute,lastAt:w.minute,rainfall:0,runoff:0,strongWindMinutes:0,wind:0,nextFloodAt:w.minute,nextStormAt:w.minute};
}
/** Deliberate simulation rollout switch, not an observer control. Disabled until supply/care acceptance. */
export function setWeatherHazardsEnabled(w:World,enabled:boolean){
 initializeWeatherHazards(w);const s=w.frontierHazards?.weather;if(!s||s.enabled===enabled)return;
 s.enabled=enabled;s.lastAt=w.minute;s.sampledFrom=w.minute;s.rainfall=0;s.runoff=0;s.strongWindMinutes=0;s.wind=0;
 emitLedgerEvent(w,{kind:'system',actors:[],place:{...w.map.entrance},text:enabled?'隔离验收已启用天气灾害的后续采样；不补算过去的雨量或灾害。':'已停用天气灾害的新预警；已经发生的险情、损害和修护记录继续保留。'});
}

/** Existing tile geography only: no invented altitude. Water connectivity plus at most two shore steps. */
export function floodFootprint(w:World,waterAt:Vec,radius=7):Vec[]{
 if(terrain(w,waterAt)!=='water')return [];
 const seen=new Set<string>([key(waterAt)]),water=[waterAt];
 for(let i=0;i<water.length;i++)for(const dir of directions){const p={x:water[i].x+dir.x,y:water[i].y+dir.y};
  if(!seen.has(key(p))&&distance(p,waterAt)<=radius&&terrain(w,p)==='water'){seen.add(key(p));water.push(p);}
 }
 // Land never provides a shortcut into a disconnected water body.
 const footprint=[...water],queue=water.map(at=>({at,steps:0}));
 for(let i=0;i<queue.length;i++){const {at,steps}=queue[i];if(steps>=2)continue;
  for(const dir of directions){const p={x:at.x+dir.x,y:at.y+dir.y},t=terrain(w,p);
   if(seen.has(key(p))||distance(p,waterAt)>radius||!t||t==='water'||t==='cliff')continue;
   seen.add(key(p));footprint.push(p);queue.push({at:p,steps:steps+1});
  }
 }
 return footprint;
}

function weatherSite(w:World,kind:FrontierDisaster['kind'],day:number):Vec|null{
 const candidates:Vec[]=[];
 for(let y=1;y<w.map.height-1;y++)for(let x=1;x<w.map.width-1;x++){
  const at={x,y},t=terrain(w,at);
  if(kind==='flashFlood'?t==='water'&&isSurfaceWater(w,at)&&directions.some(d=>{const adjacent=terrain(w,{x:x+d.x,y:y+d.y});return adjacent&&adjacent!=='water'&&adjacent!=='cliff';}):t!=='water'&&t!=='cliff'&&(x+y)%3===0)candidates.push(at);
 }
 return candidates.length?candidates[Math.floor(noise(w.seed,day+(kind==='flashFlood'?430:911))*candidates.length)]:null;
}
function warnWeather(w:World,kind:FrontierDisaster['kind']){
 const state=w.frontierHazards!,s=state.weather!,at=weatherSite(w,kind,Math.floor(w.minute/DAY));if(!at)return false;
 const radius=kind==='flashFlood'?7:10,footprint=kind==='flashFlood'?floodFootprint(w,at,radius):undefined;
 if(footprint&&!footprint.some(p=>terrain(w,p)!=='water'))return false;
 const startsAt=w.minute+(kind==='flashFlood'?90:120),intensity=kind==='flashFlood'?Math.min(30,18+Math.floor(s.runoff/60)):Math.min(30,Math.floor(s.wind/2));
 const d:FrontierDisaster={id:`disaster:${state.nextSerial++}`,kind,at:{...at},radius,phase:'warning',warningAt:w.minute,startsAt,endsAt:startsAt+(kind==='flashFlood'?132:172),intensity,warned:[],exposure:{},...(footprint?{footprint}:{}),weatherEvidence:{from:s.sampledFrom??s.registeredAt,through:w.minute,rainfall:s.rainfall,runoff:s.runoff,wind:s.wind,strongWindMinutes:s.strongWindMinutes,...(kind==='flashFlood'?{waterAt:{...at}}:{})}};
 state.disasters.push(d);
 emitLedgerEvent(w,{kind:'hazard',actors:[],place:{...at},hazardFact:{disasterId:d.id,phase:'warning'},text:kind==='flashFlood'?`持续降雨已形成 ${s.runoff.toFixed(1)} 单位模拟径流，连通水岸 ${footprint!.length} 格进入洪水预警；未测绘海拔，不代表完整流域水文。`:`模拟阵风 ${s.wind.toFixed(1)} 已持续 ${Math.floor(s.strongWindMinutes)} 分钟，当前局地出现风暴预警。`});
 return true;
}
/** Sample only elapsed simulation time. A direct clock jump does not fabricate missing observations. */
export function advanceWeatherHazards(w:World,minutes:number){
 if(w.clock.paused||!Number.isFinite(minutes)||minutes<=0)return;
 initializeWeatherHazards(w);const state=w.frontierHazards,s=state?.weather;if(!state||!s)return;
 const elapsed=Math.max(0,Math.min(minutes,w.minute-s.lastAt,60));s.lastAt=w.minute;
 if(!s.enabled||!elapsed)return;
 const day=Math.floor(w.minute/DAY),rain=w.weather==='rain'?.6+noise(w.seed,day+71)*.8:0;
 s.rainfall+=rain*elapsed;s.runoff=Math.max(0,Math.min(720,s.runoff+(rain||-.5)*elapsed));
 s.wind=(w.weather==='rain'?20:8)+noise(w.seed,day+221)*(w.weather==='rain'?40:20);
 s.strongWindMinutes=s.wind>=48?s.strongWindMinutes+elapsed:0;
 if(state.disasters.filter(d=>d.phase!=='ended').length>=2)return;
 if(s.runoff>=180&&w.minute>=s.nextFloodAt&&!state.disasters.some(d=>d.kind==='flashFlood'&&d.phase!=='ended')){
  if(warnWeather(w,'flashFlood'))s.nextFloodAt=w.minute+DAY;
  else s.nextFloodAt=w.minute+60;
 }
 if(s.strongWindMinutes>=60&&w.minute>=s.nextStormAt&&!state.disasters.some(d=>d.kind==='windstorm'&&d.phase!=='ended')){
  if(warnWeather(w,'windstorm'))s.nextStormAt=w.minute+DAY;
  else s.nextStormAt=w.minute+60;
 }
}
export function activeFloods(w:World){return w.frontierHazards?.disasters.filter(d=>d.kind==='flashFlood'&&d.phase==='active'&&d.footprint)??[];}
export function floodedAt(w:World,at:Vec){return activeFloods(w).some(d=>disasterContains(d,at));}
