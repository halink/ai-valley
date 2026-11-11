import {disasterContains} from '../shared/frontier-hazards.js';
import {fishSpecies,fishBreeding,habitatSpecies,type FishSpecies,type FishSpeciesStock} from '../shared/fish-species.js';
import {emitEvent} from './events.js';
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
  const [x,y]=key.split(',').map(Number);
  p.habitat??=fishHabitat(w,{x:x*32+16,y:y*32+16});
  if(p.shoal===undefined)initializeShoal(w,key,p);
  initializeSpecies(w,key,p);
 }
}
export function poolRules(w:World,at:Vec){return fishingDefinition(w,fishingStockAt(w,at)?.definition??'ecology/fishing-process@1').rules;}
/** Windows describe available activity; a selected species must also have its own stock. */
export function fishWindows(w:World,at:Vec){
 const water=waterAtShore(w,at)??at,p=fishingStockAt(w,at),habitat=poolHabitat(w,water,p),rules=poolRules(w,at),t=calendar(w.minute),hour=t.hour+t.minute/60;
 return rules.windows.filter(f=>f.habitats.includes(habitat)&&f.seasons.includes(t.season)&&(f.rain===undefined||f.rain===(w.weather==='rain')))
  .filter(f=>f.from<f.to?hour>=f.from&&hour<f.to:hour>=f.from||hour<f.to)
  .filter((f,i,all)=>all.findIndex(a=>a.species===f.species)===i)
  .map(f=>({habitat,species:f.species,name:fishNames[f.species],hours:`${f.from}时至${f.to<f.from?'次日':''}${f.to}时`,season:t.season,weather:w.weather}));
}
export function fishWindow(w:World,at:Vec,species?:FishSpecies){
 const matches=fishWindows(w,at),p=fishingStockAt(w,at),selected=species?matches.find(f=>f.species===species):matches.find(f=>(p?.species?.[f.species]?.amount??p?.amount??0)>0)??matches[0];
 return selected??{habitat:poolHabitat(w,waterAtShore(w,at)??at,p),species:null,name:null,hours:'当前季节或时段无窗口',season:calendar(w.minute).season,weather:w.weather};
}
const emptySpecies=(amount=0,progress=0):FishSpeciesStock=>({amount,progress,opening:amount,born:0,caught:0,eaten:0,arrived:0,departed:0});
function poolHabitat(w:World,water:Vec,p?:FishPool):FishHabitat {
 const bounds=p?.habitatBounds??{x:w.map.width,y:w.map.height};
 return water.y>=bounds.y*.7&&water.x>=bounds.x*.5?'coast':water.y<bounds.y*.3?'lake':'river';
}
function initializeSpecies(w:World,key:string,p:FishPool){
 if(p.species)return;
 const [cx,cy]=key.split(',').map(Number),habitats=new Set<FishHabitat>();
 for(let y=cy*32;y<Math.min(w.map.height,(cy+1)*32);y++)for(let x=cx*32;x<Math.min(w.map.width,(cx+1)*32);x++)if(waterTile(w,{x,y}))habitats.add(poolHabitat(w,{x,y},p));
 p.habitats=[...habitats];
 const species=[...new Set([p.habitat!,...p.habitats].flatMap(h=>habitatSpecies[h]))];p.species={};
 for(let i=0;i<species.length;i++){
  const amount=Math.floor(p.amount/species.length)+(i<p.amount%species.length?1:0);
  p.species[species[i]]=emptySpecies(amount,p.amount>0?p.progress*amount/p.amount:0);
 }
 // Migration allocates existing wild units, without touching inventories, lots or historical catches.
 p.speciesRegisteredAt=w.minute;p.speciesLastMinute=w.minute;p.lastMigrationDay=Math.floor(w.minute/DAY);
}
export function takeFish(w:World,at:Vec,species:FishSpecies,reason:'caught'|'eaten'):boolean {
 const p=fishingStockAt(w,at),stock=p?.species?.[species];
 if(!p||p.amount<1||!stock||stock.amount<1||fishWindow(w,at,species).species!==species)return false;
 stock.amount--;stock[reason]++;if(stock.amount===0)stock.progress=0;p.amount--;p.progress=Object.values(p.species!).reduce((n,s)=>n+s!.progress,0);return true;
}
export function advanceFishing(w:World){
 initializeFishing(w);
 for(const [key,p] of Object.entries(w.industry?.fishing??{})){
  const rules=fishingDefinition(w,p.definition).rules;
  let from=p.speciesLastMinute??w.minute;
  while(from<w.minute){
   const to=Math.min(w.minute,(Math.floor(from/DAY)+1)*DAY),day=Math.floor(from/DAY),season=calendar(from).season;
   const weather=day===Math.floor(w.minute/DAY)?w.weather:((day*17+w.seed)%11<3?'rain':'sun');
   const rate=rules.rates[p.habitat!][season]*(weather==='rain'?(p.habitat==='river'?rules.rainRiver:rules.rainOther):1);
   const species=fishSpecies.filter(s=>p.species?.[s]);
   for(const kind of species){
    const stock=p.species![kind];if(!stock)continue;
    if(stock.amount<1||p.amount>=rules.capacity){stock.progress=0;continue;}
    if(!fishBreeding[kind].includes(season)||!p.shoal||!waterTile(w,p.shoal.at)||floodAt(w,p.shoal.at))continue;
    stock.progress+=(to-from)*rules.capacity/(rules.renewalDays*DAY*species.length)*rate;
    const born=Math.min(rules.capacity-p.amount,Math.floor(stock.progress+1e-9));
    stock.amount+=born;stock.born+=born;stock.progress-=born;p.amount+=born;
   }
   from=to;
  }
  if(p.amount>=rules.capacity)for(const stock of Object.values(p.species!))stock!.progress=0;
  p.progress=Object.values(p.species!).reduce((n,s)=>n+s!.progress,0);
  p.lastMinute=p.speciesLastMinute=w.minute;
  advanceShoal(w,key,p);
 }
 migrateFish(w);
}

/** A daily exchange requires a real, bounded water route between two registered shoals. */
function connectedPools(w:World,a:FishPool,b:FishPool,keys:Set<string>):boolean {
 if(!a.shoal||!b.shoal||!waterTile(w,a.shoal.at)||!waterTile(w,b.shoal.at))return false;
 const target=b.shoal.at,queue=[{at:a.shoal.at,steps:0}],seen=new Set<string>([`${a.shoal.at.x},${a.shoal.at.y}`]);
 for(let i=0;i<queue.length;i++){
  const {at,steps}=queue[i];if(distance(at,target)===0)return true;if(steps>=64)continue;
  for(const next of waterNeighbors(at)){
   const id=`${next.x},${next.y}`;
   if(!seen.has(id)&&keys.has(fishingKey(next))&&distance(next,target)<=64-steps-1&&waterTile(w,next)&&!floodAt(w,next)){seen.add(id);queue.push({at:next,steps:steps+1});}
  }
 }
 return false;
}
function migrateFish(w:World){
 const pools=w.industry?.fishing??{},day=Math.floor(w.minute/DAY);
 if(!Object.values(pools).some(p=>day>(p.lastMigrationDay??day)))return;
 const opening=new Map(Object.entries(pools).map(([key,p])=>[key,Object.fromEntries(Object.entries(p.species??{}).map(([k,s])=>[k,s!.amount]))]));
 const received=new Set<string>();
 for(const [key,p] of Object.entries(pools).sort(([a],[b])=>a.localeCompare(b))){
  if(day<=(p.lastMigrationDay??day))continue;p.lastMigrationDay=day;
  if(!p.shoal||floodAt(w,p.shoal.at))continue;
  const [x,y]=key.split(',').map(Number),neighbors=[`${x-1},${y}`,`${x+1},${y}`,`${x},${y-1}`,`${x},${y+1}`];
  let moved=false;
  for(const other of neighbors){
   const target=pools[other];if(!target?.shoal||received.has(other)||target.amount>=fishingDefinition(w,target.definition).rules.capacity||floodAt(w,target.shoal.at))continue;
   const species=fishSpecies.find(kind=>(target.habitats??[target.habitat!]).some(h=>habitatSpecies[h].includes(kind))&&(opening.get(key)?.[kind]??0)>=2&&(p.species?.[kind]?.amount??0)>=(opening.get(other)?.[kind]??0)+2);
   if(!species||!connectedPools(w,p,target,new Set([key,other])))continue;
   const source=p.species![species]!,dest=target.species![species]??=emptySpecies();
   source.amount--;source.departed++;p.amount--;dest.amount++;dest.arrived++;target.amount++;received.add(other);moved=true;
   target.shoal.activity=activityAt(w,target.shoal.at);target.shoal.nextMoveAt=w.minute+12;
   if(target.amount>=fishingDefinition(w,target.definition).rules.capacity){for(const stock of Object.values(target.species!))stock!.progress=0;target.progress=0;}
   emitEvent(w,{kind:'hazard',actors:[],animalIds:['shoal:'+key,'shoal:'+other],place:{...target.shoal.at},text:`一份${fishNames[species]}沿相连水域从${key}迁至${other}，原水域减一、到达水域加一，没有新增鱼。`});
   break;
  }
  if(moved&&p.amount<1)for(const s of Object.values(p.species!))s!.progress=0;
 }
}

const waterNeighbors=({x,y}:Vec):Vec[]=>[{x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1}];
const floodAt=(w:World,at:Vec)=>w.frontierHazards?.disasters.find(d=>d.kind==='flashFlood'&&d.phase==='active'&&disasterContains(d,at));
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
   if(!seen.has(index)&&distance(next,school.at)<=limit-steps-1&&waterTile(w,next)&&!floodAt(w,next)){seen.add(index);cells.push({at:next,steps:steps+1});}
  }
 }
 return false;
}

/** Read-only target check: a nonempty sector alone does not make a fish currently edible here. */
export function availableWildFishAt(w:World,shore:Vec):FishSpecies|false {
 // Old worlds must pass through normal fishing initialization, not acquire definitions from a target query.
 if(!w.definitions['ecology/fishing-process@1'])return false;
 const pool=fishingStockAt(w,shore),species=fishWindow(w,shore).species;
 if(w.scenario!=='frontier'||!pool||!species||pool.amount<1||(pool.species?.[species]?.amount??0)<1||!shoalWithinReach(w,shore,4))return false;
 return species;
}
/** A wild duck taking a fish consumes the same renewable stock as a resident. */
export function wildFishAt(w:World,shore:Vec):FishSpecies|false {
 const species=availableWildFishAt(w,shore);if(!species)return false;
 return takeFish(w,shore,species,'eaten')?species:false;
}

export function fishSchoolView(w:World,key:string){
 const pool=w.industry?.fishing[key],school=pool?.shoal;
 if(!pool||!school||!waterTile(w,school.at))return undefined;
 const window=fishWindow(w,school.at);
 return {id:key,at:school.at,amount:pool.amount,capacity:fishingDefinition(w,pool.definition).rules.capacity,
  recovery:pool.progress,habitat:window.habitat,species:window.name,hours:window.hours,activity:school.activity,
  stocks:fishSpecies.filter(s=>pool.species?.[s]).map(s=>({species:s,name:fishNames[s],...pool.species![s]!})),registeredAt:pool.speciesRegisteredAt};
}
export type FishSchoolView=NonNullable<ReturnType<typeof fishSchoolView>>;
export function fishingMinutes(w:World,r:Resident,at:Vec,level:number){const window=fishWindow(w,at),rules=poolRules(w,at),skill=w.industry?.fishingExperience?w.industry.fishingExperience[r.id]??0:r.skills.farming;return Math.max(rules.minimumMinutes,Math.round((window.weather==='rain'?rules.rainMinutes:rules.dryMinutes)+(window.season==='winter'?rules.winterExtra:0)-Math.min(rules.skillMaximum,skill*rules.skillRate)-Math.max(0,level-1)*rules.toolRate));}
