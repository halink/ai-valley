import type {Resident,Vec,World} from '../shared/types.js';import {calendar,DAY} from './time.js';import {fishingDefaults,fishNames,type FishHabitat} from '../shared/fishing-rules.js';import {processDefinition} from './process-definitions.js';
import {distance,walkable} from './navigation.js';
import type {FishPool} from '../shared/industry.js';
export {fishNames};export type {FishHabitat};
export const fishingDefinition=(w:World,key?:string)=>processDefinition(w,'ecology/fishing-process',fishingDefaults,'life',key);
export function fishHabitat(w:World,at:Vec):FishHabitat{return at.y>=w.map.height*.7&&at.x>=w.map.width*.5?'coast':at.y<w.map.height*.3?'lake':'river';}
export const fishingKey=(at:Vec)=>`${Math.floor(at.x/32)},${Math.floor(at.y/32)}`;
function waterTile(w:World,{x,y}:Vec):boolean {
 return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<w.map.width&&y<w.map.height&&w.map.tiles[y*w.map.width+x]==='water';
}
/** Fish belong to the adjacent water sector, including when the shore lies across a sector edge. */
export function waterAtShore(w:World,at:Vec):Vec|undefined {
 if(waterTile(w,at))return at;
 const neighbors=[{x:at.x+1,y:at.y},{x:at.x-1,y:at.y},{x:at.x,y:at.y+1},{x:at.x,y:at.y-1}].filter(p=>waterTile(w,p));
 return neighbors.find(p=>fishingKey(p)===fishingKey(at))??neighbors[0];
}
export function fishingShore(w:World,at:Vec):boolean {return !!waterAtShore(w,at)&&walkable(w,at);}
export function fishingStockAt(w:World,at:Vec){const water=waterAtShore(w,at);return water?w.industry?.fishing[fishingKey(water)]:undefined;}
export function visibleFishingShores(w:World,r:Resident,range=12):Vec[] {
 if(r.inside)return [];
 const shores:Vec[]=[];
 for(let y=r.at.y-range;y<=r.at.y+range;y++)for(let x=r.at.x-range;x<=r.at.x+range;x++){
  const at={x,y};if(distance(r.at,at)<=range&&fishingShore(w,at))shores.push(at);
 }
 return shores.sort((a,b)=>distance(r.at,a)-distance(r.at,b));
}
export function initializeFishing(w:World){
 const state=w.industry;if(!state)return;
 fishingDefinition(w,'ecology/fishing-process@1');
 if(state.sources.fishingRegisteredAt===undefined){
  const selected=fishingDefinition(w),pools=new Map<string,Vec>();
  for(let y=0;y<w.map.height;y++)for(let x=0;x<w.map.width;x++)if(w.map.tiles[y*w.map.width+x]==='water')pools.set(fishingKey({x,y}),{x,y});
  for(const [key,at]of pools)state.fishing[key]??={habitatBounds:{x:w.map.width,y:w.map.height},definition:selected.definition,amount:selected.rules.capacity,progress:0,lastMinute:w.minute,habitat:fishHabitat(w,at)};
  state.sources.fishingRegisteredAt=w.minute;
  state.sources.fishingOpeningUnits=Object.values(state.fishing).reduce((n,p)=>n+p.amount,0);
  w.definitions['ecology/fishing@1']??={id:'ecology/fishing',version:1,kind:'life',dependencies:[],data:{capacity:12,renewalDays:10,source:'接入时实际已有水域的有限野生种群；每个32格水域只登记一次，开采压力与季节恢复实际保留'}};
 }
 for(const [key,p] of Object.entries(state.fishing)){
  p.definition??='ecology/fishing-process@1';
  p.habitatBounds??={x:w.map.width,y:w.map.height};
  if(w.scenario==='frontier'&&p.shoal===undefined)initializeShoal(w,key,p);
 }
}
export function poolRules(w:World,at:Vec){return fishingDefinition(w,fishingStockAt(w,at)?.definition??'ecology/fishing-process@1').rules;}
export function fishWindow(w:World,at:Vec){const water=waterAtShore(w,at)??at,p=fishingStockAt(w,at),habitat:FishHabitat=p?.habitatBounds?(water.y>=p.habitatBounds.y*.7&&water.x>=p.habitatBounds.x*.5?'coast':water.y<p.habitatBounds.y*.3?'lake':'river'):fishHabitat(w,water),rules=poolRules(w,at),t=calendar(w.minute),hour=t.hour+t.minute/60,possible=rules.windows.filter(f=>f.habitats.includes(habitat)&&f.seasons.includes(t.season)&&(f.rain===undefined||f.rain===(w.weather==='rain'))),selected=possible.find(f=>f.from<f.to?hour>=f.from&&hour<f.to:hour>=f.from||hour<f.to),species=selected?.species??null,hours=selected?`${selected.from}时至${selected.to<selected.from?'次日':''}${selected.to}时`:possible.map(f=>`${f.from}–${f.to}时`).join('、')||'当前季节无窗口';return {habitat,species,name:species?fishNames[species]:null,hours,season:t.season,weather:w.weather};}
export function advanceFishing(w:World){
 initializeFishing(w);
 for(const [key,p] of Object.entries(w.industry?.fishing??{})){
  const [x,y]=key.split(',').map(Number);
  p.habitat??=fishHabitat(w,{x:x*32+16,y:y*32+16});
  const r=fishingDefinition(w,p.definition).rules;
  let from=p.lastMinute;
  while(from<w.minute&&p.amount<r.capacity){
   const to=Math.min(w.minute,(Math.floor(from/DAY)+1)*DAY),day=Math.floor(from/DAY);
   const weather=day===Math.floor(w.minute/DAY)?w.weather:((day*17+w.seed)%11<3?'rain':'sun');
   const rate=r.rates[p.habitat][calendar(from).season]*(weather==='rain'?(p.habitat==='river'?r.rainRiver:r.rainOther):1);
   p.progress+=(to-from)*r.capacity/(r.renewalDays*DAY)*rate;
   const n=Math.min(r.capacity-p.amount,Math.floor(p.progress+1e-9));p.amount+=n;p.progress-=n;from=to;
  }
  p.lastMinute=w.minute;
  if(p.amount>=r.capacity)p.progress=0;
  if(w.scenario==='frontier')advanceShoal(w,key,p);
 }
}

const waterNeighbors=({x,y}:Vec):Vec[]=>[{x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1}];
const floodAt=(w:World,at:Vec)=>w.frontierHazards?.disasters.find(d=>d.kind==='flashFlood'&&d.phase==='active'&&distance(d.at,at)<=d.radius);
const activityAt=(w:World,at:Vec):NonNullable<FishPool['shoal']>['activity']=>floodAt(w,at)?'evadingFlood':fishWindow(w,at).species?'feeding':'resting';

function initializeShoal(w:World,key:string,pool:FishPool){
 const [cx,cy]=key.split(',').map(Number),shore=w.industry?.frontierShore;
 const near=shore&&waterAtShore(w,shore);
 const target=near&&fishingKey(near)===key?near:{x:cx*32+16,y:cy*32+16};
 let anchor:Vec|undefined,best=Infinity;
 for(let y=cy*32;y<Math.min(w.map.height,(cy+1)*32);y++)for(let x=cx*32;x<Math.min(w.map.width,(cx+1)*32);x++){
  const at={x,y},d=distance(at,target);
  if(d<best&&waterTile(w,at)){anchor=at;best=d;}
 }
 pool.shoal=anchor?{anchor,at:{...anchor},nextMoveAt:w.minute+12,activity:activityAt(w,anchor)}:null;
}

function advanceShoal(w:World,key:string,pool:FishPool){
 if(!pool.shoal||pool.amount<1)return;
 if(!waterTile(w,pool.shoal.at)){
  // Geometry can change through completed works; the finite stock and recovery are kept.
  initializeShoal(w,key,pool);return;
 }
 const school=pool.shoal;
 const flood=floodAt(w,school.at)??floodAt(w,school.anchor);
 const activity=flood?'evadingFlood':activityAt(w,school.at);
 if(w.minute<school.nextMoveAt&&activity===school.activity)return;
 school.activity=activity;school.nextMoveAt=w.minute+(flood?6:activity==='feeding'?12:26);
 const current=school.at,cells=waterNeighbors(current).filter(at=>waterTile(w,at)&&fishingKey(at)===key&&distance(at,school.anchor)<=8);
 if(!cells.length)return;
 const score=(at:Vec)=>{
  const depth=waterNeighbors(at).filter(p=>waterTile(w,p)).length;
  if(flood)return distance(at,flood.at)*4+depth;
  const phase=Math.floor(w.minute/12);
  const motion=((Math.imul(w.seed+at.x,1723)^Math.imul(at.y+phase,43889))>>>0)%17/17;
  return (activity==='feeding'?-depth:depth)+motion-distance(at,school.anchor)*.12;
 };
 const next=cells.sort((a,b)=>score(b)-score(a))[0];
 if(!flood||distance(next,flood.at)>distance(current,flood.at))school.at=next;
}

/** Crossing land, deep water out of reach and active flood current cannot supply a catch. */
export function shoalWithinReach(w:World,shore:Vec,limit=12):boolean {
 if(w.scenario!=='frontier')return true;
 const source=waterAtShore(w,shore),school=fishingStockAt(w,shore)?.shoal;
 if(!source||!school||!waterTile(w,school.at)||floodAt(w,source)||floodAt(w,school.at)||distance(source,school.at)>limit)return false;
 const cells=[{at:source,steps:0}],seen=new Set<number>([source.y*w.map.width+source.x]);
 for(let i=0;i<cells.length;i++){
  const {at,steps}=cells[i];
  if(distance(at,school.at)===0)return true;
  if(steps===limit)continue;
  for(const next of waterNeighbors(at)){
   const index=next.y*w.map.width+next.x;
   if(!seen.has(index)&&distance(next,school.at)<=limit-steps-1&&waterTile(w,next)){seen.add(index);cells.push({at:next,steps:steps+1});}
  }
 }
 return false;
}

/** A wild duck taking a fish consumes the same renewable stock as a resident. */
export function wildFishAt(w:World,shore:Vec):boolean {
 const pool=fishingStockAt(w,shore);
 if(w.scenario!=='frontier'||!pool||pool.amount<1||!fishWindow(w,shore).species||!shoalWithinReach(w,shore,4))return false;
 pool.amount--;return true;
}

export function fishSchoolView(w:World,key:string){
 const pool=w.industry?.fishing[key],school=pool?.shoal;
 if(!pool||!school||!waterTile(w,school.at))return undefined;
 const window=fishWindow(w,school.at);
 return {id:key,at:school.at,amount:pool.amount,capacity:fishingDefinition(w,pool.definition).rules.capacity,
  recovery:pool.progress,habitat:window.habitat,species:window.name,hours:window.hours,activity:school.activity};
}
export type FishSchoolView=NonNullable<ReturnType<typeof fishSchoolView>>;
export function fishingMinutes(w:World,r:Resident,at:Vec,level:number){const window=fishWindow(w,at),rules=poolRules(w,at),skill=w.industry?.fishingExperience?w.industry.fishingExperience[r.id]??0:r.skills.farming;return Math.max(rules.minimumMinutes,Math.round((window.weather==='rain'?rules.rainMinutes:rules.dryMinutes)+(window.season==='winter'?rules.winterExtra:0)-Math.min(rules.skillMaximum,skill*rules.skillRate)-Math.max(0,level-1)*rules.toolRate));}
