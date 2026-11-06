import {beastNames,disasterNames,type FrontierDisaster,type FrontierHazardAction,type WildBeast} from '../shared/frontier-hazards.js';
import {roomLayout} from '../shared/rooms.js';
import type {Building,Resident,Vec,World} from '../shared/types.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {aboardFerry} from './ferry.js';
import {addHealthCase} from './health.js';
import {canObserve} from './knowledge.js';
import {recordDeath} from './life.js';
import {passenger} from './medical-transport.js';
import {distance,same,walkable} from './navigation.js';
import {ageYears,DAY} from './time.js';
import {advanceWildlife,createWildBeast,initializeWildlife,wildlifeThreatensPeople,wildlifeVisible} from './frontier-wildlife.js';
export {alarmWildBeast,wildlifeVisible,woundWildBeast} from './frontier-wildlife.js';

const directions:Vec[]=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
const add=(a:Vec,b:Vec):Vec=>({x:a.x+b.x,y:a.y+b.y});
const tile=(w:World,{x,y}:Vec)=>x>=0&&y>=0&&x<w.map.width&&y<w.map.height?w.map.tiles[y*w.map.width+x]:undefined;
const local=(r:Resident)=>r.status==='alive'&&r.residency!=='outside';
const riskSeed=(seed:number,n:number)=>((Math.imul(seed^(n*337),1103515245)>>>8)%997)/997;
const repairWood=2,repairStone=1;
type Warning=(person:Resident,reason:string)=>void;

function siteNear(w:World,center:Vec,radius:number,accept:(at:Vec)=>boolean):Vec|null{
 let nearest:Vec|null=null,range=Infinity;
 for(let y=Math.max(0,center.y-radius);y<=Math.min(w.map.height-1,center.y+radius);y++){
  for(let x=Math.max(0,center.x-radius);x<=Math.min(w.map.width-1,center.x+radius);x++){
   const at={x,y},d=distance(at,center);
   if(d>=range||!accept(at))continue;
   nearest=at;range=d;
  }
 }
 return nearest;
}

/** Wildlife and hazards live only in the isolated settlement scenario. Their clocks are world time. */
export function initializeFrontierHazards(w:World):void {
 if(w.scenario!=='frontier'||!w.map.settlement)return;
 if(w.frontierHazards){initializeWildlife(w,w.frontierHazards);return;}
 const settlement=w.map.settlement,edge={x:settlement.x-24,y:settlement.y-2};
 const trees=w.resources.filter(r=>r.kind==='tree'&&distance(r.at,settlement)>=15&&distance(r.at,settlement)<=45)
  .sort((a,b)=>distance(a.at,edge)-distance(b.at,edge));
 const woodland=trees[0]?.at??siteNear(w,edge,18,at=>distance(at,settlement)>=15&&walkable(w,at))??edge;
 const shore=siteNear(w,{x:settlement.x+15,y:settlement.y+5},16,at=>directions.some(d=>tile(w,add(at,d))==='water')&&walkable(w,at));
 const beasts:WildBeast[]=[];
 for(const species of ['boar','wolf'] as const){
  const home=species==='boar'?woodland:add(woodland,{x:-8,y:-8});
  const den=siteNear(w,home,6,at=>distance(at,settlement)>=14&&walkable(w,at)&&!beasts.some(b=>same(b.at,at)));
  if(den)beasts.push(createWildBeast(w,species,`beast:${species}`,den));
 }
 w.frontierHazards={beasts,disasters:[],shore,woodland:{...woodland},nextDisasterAt:w.minute+120,nextSerial:1,
  nextBeastSerial:1,foodPatches:[],
  totals:{injuries:0,accidentalDeaths:0,damagedBuildings:0,damagedPlots:0,repairs:0,livestockAttacks:0,livestockKilled:0,wildlifeDeaths:0,hunted:0}};
 initializeWildlife(w,w.frontierHazards);
}

function announce(w:World,at:Vec,text:string){emitLedgerEvent(w,{kind:'hazard',actors:[],place:{...at},text});}

function warn(w:World,r:Resident,text:string,interrupt:Warning|undefined,at:Vec,radius:number,beastId?:string){
 emitEvent(w,{kind:'hazard',actors:[r.id],...(beastId?{animalIds:[beastId]}:{}),place:{...r.at},witnesses:[r.id],text});
 if(!interrupt||!r.canExpress||r.activity?.action.type==='frontierHazard'||r.plan?.actions[0]?.type==='frontierHazard'||aboardFerry(w,r.id)||passenger(w,r.id))return;
 const action=r.activity?.action??r.plan?.actions[0];
 if(beastId&&action?.type==='industry'&&action.operation==='hunt'&&action.beastId===beastId)return;
 if(r.activity?.path.length&&distance(r.activity.target,at)>radius)return;
 interrupt(r,text);
}

function injure(w:World,r:Resident,damage:number,source:string){
 const totals=w.frontierHazards!.totals;
 r.health=Math.max(0,r.health-damage);
 if(r.health===0){
  if(recordDeath(w,r,'accident',source))totals.accidentalDeaths++;
  return;
 }
 addHealthCase(w,r,'injury',Math.min(75,damage*2.15),source);
 totals.injuries++;
 emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}在${source}中受伤。`});
}

function sheltered(w:World,r:Resident,disaster:FrontierDisaster){
 const building=r.inside&&w.buildings.find(b=>b.id===r.inside);
 if(!building||building.condition<35)return false;
 return disaster.kind==='windstorm'||distance(building.door,disaster.at)>Math.floor(disaster.radius/2);
}

function damageProperty(w:World,disaster:FrontierDisaster){
 const totals=w.frontierHazards!.totals;
 const affected=w.buildings.filter(b=>b.condition>10&&distance(b.door,disaster.at)<=disaster.radius)
  .sort((a,b)=>distance(a.door,disaster.at)-distance(b.door,disaster.at)).slice(0,3);
 for(const b of affected){
  b.condition=Math.max(10,b.condition-disaster.intensity);
  totals.damagedBuildings++;
  announce(w,b.door,`${disasterNames[disaster.kind]}损坏了${b.name}。现状为 ${Math.round(b.condition)}/100，可由居民到场修缮。`);
 }
 const plots=w.plots.filter(p=>p.crop&&distance(p.at,disaster.at)<=disaster.radius).slice(0,9);
 for(const p of plots){
  if(disaster.kind==='flashFlood'&&distance(p.at,disaster.at)<=Math.floor(disaster.radius/2))p.crop=null;
  else if(p.crop)p.crop.growth=Math.max(0,p.crop.growth-.6);
  totals.damagedPlots++;
 }
 if(plots.length)announce(w,disaster.at,`${disasterNames[disaster.kind]}影响了附近 ${plots.length} 块已经播种的农地。`);
}

function stepDisaster(w:World,disaster:FrontierDisaster,minutes:number,interrupt:Warning|undefined){
 if(disaster.phase==='ended')return;
 const label=disasterNames[disaster.kind];
 if(w.minute>=disaster.endsAt){disaster.phase='ended';disaster.exposure={};announce(w,disaster.at,`${label}已经消退。`);return;}
 if(disaster.phase==='warning'&&w.minute>=disaster.startsAt){
  disaster.phase='active';announce(w,disaster.at,`${label}已发生，危险集中在已标出的区域。`);
  damageProperty(w,disaster);
 }
 for(const r of w.residents){
  const exposed=local(r)&&!aboardFerry(w,r.id)&&distance(r.at,disaster.at)<=disaster.radius&&!sheltered(w,r,disaster);
  if(!exposed){delete disaster.exposure[r.id];continue;}
  if(!disaster.warned.includes(r.id)&&canObserve(w,r)){
   disaster.warned.push(r.id);
   warn(w,r,`${r.name}察觉到${label}的近处${disaster.phase==='warning'?'迹象':'危险'}，可以自行判断是否撤离或避险。`,interrupt,disaster.at,disaster.radius);
  }
  if(disaster.phase!=='active')continue;
  const elapsed=(disaster.exposure[r.id]??0)+minutes;
  disaster.exposure[r.id]=elapsed;
  if(elapsed<24)continue;
  disaster.exposure[r.id]=elapsed-24;
  const core=distance(r.at,disaster.at)<=Math.floor(disaster.radius/2);
  injure(w,r,(core?disaster.intensity:Math.ceil(disaster.intensity*.55))+(r.energy<20?4:0),label);
 }
}

export function advanceFrontierHazards(w:World,minutes:number,interrupt?:Warning):void {
 const state=w.frontierHazards;
 if(!state||w.clock.paused||!Number.isFinite(minutes)||minutes<=0)return;
 if(w.minute>=state.nextDisasterAt){
  const ordinal=state.nextSerial++,kind=ordinal%2===1&&state.shore?'flashFlood':'windstorm';
  const settlement=w.map.settlement!,location=kind==='flashFlood'?state.shore!:{x:Math.floor((state.woodland.x+settlement.x)/2),y:state.woodland.y+1};
  const radius=kind==='flashFlood'?7:14,startsAt=w.minute+(kind==='flashFlood'?90:118);
  const disaster:FrontierDisaster={id:`disaster:${ordinal}`,kind,at:{...location},radius,phase:'warning',warningAt:w.minute,startsAt,
   endsAt:startsAt+(kind==='flashFlood'?132:172),intensity:20+Math.floor(riskSeed(w.seed,ordinal)*11),warned:[],exposure:{}};
  const expired=state.disasters.filter(d=>d.phase==='ended').slice(0,-12);
  state.disasters=state.disasters.filter(d=>!expired.includes(d));
  state.disasters.push(disaster);
  state.nextDisasterAt=startsAt+(1.4+riskSeed(w.seed,ordinal+81)*2.8)*DAY;
  announce(w,disaster.at,kind==='flashFlood'?'河岸水位正在上涨，低处出现洪水征兆。':'林缘阵风增强，山谷风暴正在逼近。');
 }
 for(const disaster of state.disasters)stepDisaster(w,disaster,minutes,interrupt);
 advanceWildlife(w,minutes,{warn:(r,text,at,radius,beastId)=>warn(w,r,text,interrupt,at,radius,beastId),
  injure:(r,damage,source)=>injure(w,r,damage,source),notify:(r,text)=>interrupt?.(r,text)});
}

export interface SeenFrontierDanger {id:string;label:string;at:Vec;radius:number;phase:'nearby'|'warning'|'active';animalId?:string;}
export function seenFrontierDangers(w:World,r:Resident):SeenFrontierDanger[]{
 const state=w.frontierHazards;
 if(!state||!canObserve(w,r))return [];
 const beasts:SeenFrontierDanger[]=state.beasts.filter(b=>(wildlifeThreatensPeople(b)||b.alert?.animalId)&&wildlifeVisible(w,r,b)).map(b=>({id:b.id,label:beastNames[b.species],at:b.at,radius:3,
  phase:b.alert?.residentId===r.id?'active':b.alert?.animalId?'warning':'nearby',animalId:b.alert?.animalId}));
 const disasters:SeenFrontierDanger[]=state.disasters.flatMap(d=>d.phase!=='ended'&&distance(r.at,d.at)<=d.radius+9?[{id:d.id,label:disasterNames[d.kind],at:d.at,radius:d.radius,phase:d.phase}]:[]);
 return [...beasts,...disasters].sort((a,b)=>distance(a.at,r.at)-distance(b.at,r.at));
}

export function usableFrontierShelter(w:World,r:Resident,b:Building,dangerId:string){
 if(b.condition<35||!r.knownBuildings.includes(b.id)||!(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id)))return false;
 const d=w.frontierHazards?.disasters.find(d=>d.id===dangerId);
 return !d||d.kind!=='flashFlood'||distance(b.door,d.at)>Math.floor(d.radius/2);
}

export function frontierHazardTarget(w:World,r:Resident,a:FrontierHazardAction):{target:Vec;duration:number;error?:string}{
 const fail=(error:string)=>({target:r.at,duration:0,error});
 if(!w.frontierHazards||!local(r)||!r.canDecide||!r.canExpress)return fail('当前无法作出这项避险或修缮决定');
 if(a.operation==='repair'){
  const b=w.buildings.find(b=>b.id===a.buildingId);
  if(!b||!r.knownBuildings.includes(b.id)||!(b.ownerId===r.id||b.ownerId==='commons')||b.condition>=100||ageYears(r.bornAt,w.minute)<18)return fail('需要本人拥有或可维护的已知受损建筑');
  if((r.inventory.wood??0)<repairWood||(r.inventory.stone??0)<repairStone)return fail('修缮需要本人实际携带 2 份木料和 1 份石料');
  return {target:b.door,duration:34};
 }
 if(!w.frontierHazards.beasts.some(b=>b.id===a.dangerId&&b.status!=='dead')&&!w.frontierHazards.disasters.some(d=>d.id===a.dangerId))return fail('这项危险已经离开本地记录');
 if(a.operation==='retreat')return distance(r.at,a.to)<=24&&walkable(w,a.to,r.at)?{target:a.to,duration:1}:fail('撤离目的地当前不能到达');
 const b=w.buildings.find(b=>b.id===a.buildingId);
 return b&&usableFrontierShelter(w,r,b,a.dangerId)?{target:b.door,duration:1}:fail('当前没有可进入的安全遮蔽处');
}

export function completeFrontierHazard(w:World,r:Resident,a:FrontierHazardAction):string|null {
 const route=frontierHazardTarget(w,r,a);
 if(route.error)return route.error;
 if(!same(r.at,route.target))return '本人尚未实际到达目的地';
 if(a.operation==='retreat'){
  emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}自行撤离到附近的位置。`});
  return null;
 }
 const b=w.buildings.find(b=>b.id===a.buildingId)!;
 if(a.operation==='repair'){
  r.inventory.wood!-=repairWood;r.inventory.stone!-=repairStone;b.condition=Math.min(100,b.condition+28);
  w.frontierHazards!.totals.repairs++;
  emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}用自己的材料修缮了${b.name}。`});
 }else{
  r.inside=b.id;r.roomAt={...roomLayout(w,b).entry};
  emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}自行进入${b.name}避险。`});
 }
 return null;
}
