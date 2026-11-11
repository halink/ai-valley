import {canInspectSpring,canContactSpring} from './spring-observation.js';
import {buildingSheltersFrom,canSeeDisaster,safeFrontierShelter} from './building-safety.js';
import {beastNames,disasterNames,disasterContains,type FrontierDisaster,type FrontierHazardAction,type WildBeast} from '../shared/frontier-hazards.js';
import {relocationBedClaims} from '../shared/family-relocation.js';
import {advanceWeatherHazards,initializeWeatherHazards} from './weather-hazards.js';
import {roomLayout} from '../shared/rooms.js';
import type {Building,Resident,Vec,World} from '../shared/types.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {aboardFerry} from './ferry.js';
import {addHealthCase} from './health.js';
import {canObserve} from './knowledge.js';
import {recordDeath} from './life.js';
import {passenger} from './medical-transport.js';
import {distance,same,walkable} from './navigation.js';
import {ageYears} from './time.js';
import {advanceWildlife,createWildBeast,initializeWildlife,wildlifeThreatensPeople,wildlifeVisible} from './frontier-wildlife.js';
export {alarmWildBeast,wildlifeVisible,woundWildBeast} from './frontier-wildlife.js';

const directions:Vec[]=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
const add=(a:Vec,b:Vec):Vec=>({x:a.x+b.x,y:a.y+b.y});
const tile=(w:World,{x,y}:Vec)=>x>=0&&y>=0&&x<w.map.width&&y<w.map.height?w.map.tiles[y*w.map.width+x]:undefined;
const local=(r:Resident)=>r.status==='alive'&&r.residency!=='outside';
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
 if(w.frontierHazards){initializeWildlife(w,w.frontierHazards);initializeWeatherHazards(w);return;}
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
 initializeWildlife(w,w.frontierHazards,true);initializeWeatherHazards(w);
}

function announce(w:World,at:Vec,text:string,hazardFact?:import('../shared/types.js').WorldEvent['hazardFact']){return emitLedgerEvent(w,{kind:'hazard',actors:[],place:{...at},text,...(hazardFact?{hazardFact}:{})});}

function warn(w:World,r:Resident,text:string,interrupt:Warning|undefined,at:Vec,radius:number,beastId?:string,disasterId?:string){
 emitEvent(w,{kind:'hazard',actors:[r.id],...(beastId?{animalIds:[beastId]}:{}),place:{...r.at},witnesses:[r.id],text,...(disasterId?{hazardFact:{disasterId,phase:'warning' as const,targetId:r.id}}:{})});
 if(!interrupt||!r.canExpress||r.activity?.action.type==='frontierHazard'||r.plan?.actions[0]?.type==='frontierHazard'||aboardFerry(w,r.id)||passenger(w,r.id))return;
 const action=r.activity?.action??r.plan?.actions[0];
 if(beastId&&action?.type==='industry'&&action.operation==='hunt'&&action.beastId===beastId)return;
 if(r.activity?.path.length&&distance(r.activity.target,at)>radius)return;
 interrupt(r,text);
}

function injure(w:World,r:Resident,damage:number,source:string,disasterId?:string){
 const totals=w.frontierHazards!.totals;
 const before=r.health;r.health=Math.max(0,r.health-damage);
 if(disasterId)emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}在${source}中实际损失 ${(before-r.health).toFixed(1)} 健康。`,hazardFact:{disasterId,phase:'injury',targetId:r.id,before,after:r.health}});
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
 return !!building&&buildingSheltersFrom(building,disaster);
}

function damageProperty(w:World,disaster:FrontierDisaster){
 const totals=w.frontierHazards!.totals;
 const affected=w.buildings.filter(b=>b.condition>10&&disasterContains(disaster,b.door))
  .sort((a,b)=>distance(a.door,disaster.at)-distance(b.door,disaster.at)).slice(0,disaster.weatherEvidence?Infinity:3);
 for(const b of affected){
  const before=b.condition;b.condition=Math.max(10,b.condition-disaster.intensity);
  totals.damagedBuildings++;
  const event=announce(w,b.door,`${disasterNames[disaster.kind]}损坏了${b.name}。现状为 ${Math.round(b.condition)}/100，可由居民到场修缮。`,{disasterId:disaster.id,phase:'damage',targetId:b.id,before,after:b.condition});b.lastHazardDamage={disasterId:disaster.id,eventId:event.id};
 }
 const plots=w.plots.filter(p=>p.crop&&disasterContains(disaster,p.at)).slice(0,disaster.weatherEvidence?Infinity:9);
 for(const p of plots){
  const before=p.crop!.growth;
  if(disaster.kind==='flashFlood'&&(disaster.footprint||distance(p.at,disaster.at)<=Math.floor(disaster.radius/2)))p.crop=null;
  else if(p.crop)p.crop.growth=Math.max(0,p.crop.growth-.6);
  totals.damagedPlots++;
  announce(w,p.at,`${disasterNames[disaster.kind]}实际损伤已播种农地 ${p.id}。`,{disasterId:disaster.id,phase:'damage',targetId:p.id,before,after:p.crop?.growth??0});
 }
 if(plots.length)announce(w,disaster.at,`${disasterNames[disaster.kind]}影响了附近 ${plots.length} 块已经播种的农地。`);
 // New damage is gated by explicit weather evidence; legacy events retain original scope.
 if(!disaster.weatherEvidence)return;
 if(disaster.kind==='flashFlood')for(const spring of w.resources.filter(s=>s.kind==='spring'&&disasterContains(disaster,s.at))){
  spring.floodDamage={disasterId:disaster.id,at:w.minute,clearedAt:null};
  announce(w,spring.at,`洪水使泉水 ${spring.id} 淤塞，停止安全取水；现有 ${spring.amount} 份水未增加，须退水后到场清理。`,{disasterId:disaster.id,phase:'damage',targetId:spring.id,before:spring.amount,after:spring.amount});
 }
 for(const asset of w.infrastructure?.assets??[]){
  if(asset.retiredAt!==null||asset.condition<=0||!['road','bridge','dock'].includes(asset.kind)||!asset.tiles.some(t=>disasterContains(disaster,t.at)))continue;
  const before=asset.condition;asset.condition=Math.max(0,asset.condition-disaster.intensity*(disaster.kind==='flashFlood'?2:1));
  if(asset.kind==='road'&&asset.condition===0){const tiles=w.map.tiles.slice();for(const t of asset.tiles)if(tiles[t.at.y*w.map.width+t.at.x]===t.after)tiles[t.at.y*w.map.width+t.at.x]=t.before;w.map={...w.map,tiles};}
  const event=announce(w,asset.access,`${disasterNames[disaster.kind]}使${asset.name}状况从 ${before.toFixed(1)} 降到 ${asset.condition.toFixed(1)}，实际修复仍须原公共工程授权、材料和工时。`,{disasterId:disaster.id,phase:'damage',targetId:asset.id,before,after:asset.condition});asset.lastHazardDamage={disasterId:disaster.id,eventId:event.id};
 }

}

function stepDisaster(w:World,disaster:FrontierDisaster,minutes:number,interrupt:Warning|undefined){
 if(disaster.phase==='ended')return;
 minutes=Math.max(0,Math.min(minutes,w.minute-(disaster.lastSteppedAt??w.minute-minutes)));disaster.lastSteppedAt=w.minute;
 const label=disasterNames[disaster.kind];
 if(w.minute>=disaster.endsAt){disaster.phase='ended';disaster.exposure={};announce(w,disaster.at,`${label}已经消退。`,{disasterId:disaster.id,phase:'ended'});return;}
 if(disaster.phase==='warning'&&w.minute>=disaster.startsAt){
  disaster.phase='active';announce(w,disaster.at,`${label}已发生，危险集中在已标出的区域。`,{disasterId:disaster.id,phase:'active'});
  damageProperty(w,disaster);
 }
 for(const r of w.residents){
  const exposed=local(r)&&!aboardFerry(w,r.id)&&disasterContains(disaster,r.at)&&!sheltered(w,r,disaster);
  if(!exposed){delete disaster.exposure[r.id];continue;}
  if(!disaster.warned.includes(r.id)&&canObserve(w,r)){
   disaster.warned.push(r.id);
   warn(w,r,`${r.name}察觉到${label}的近处${disaster.phase==='warning'?'迹象':'危险'}，可以自行判断是否撤离或避险。`,interrupt,disaster.at,disaster.radius,undefined,disaster.id);
  }
  if(disaster.phase!=='active')continue;
  const elapsed=(disaster.exposure[r.id]??0)+Math.max(0,Math.min(minutes,w.minute-disaster.startsAt));
  disaster.exposure[r.id]=elapsed;
  const core=distance(r.at,disaster.at)<=Math.floor(disaster.radius/2);
  while(disaster.exposure[r.id]>=24&&local(r)){
   disaster.exposure[r.id]-=24;
   injure(w,r,(core?disaster.intensity:Math.ceil(disaster.intensity*.55))+(r.energy<20?4:0),label,disaster.id);
  }
 }
}

export function advanceFrontierHazards(w:World,minutes:number,interrupt?:Warning):void {
 const state=w.frontierHazards;
 if(!state||w.clock.paused||!Number.isFinite(minutes)||minutes<=0)return;
 advanceWeatherHazards(w,minutes);
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
 const disasters:SeenFrontierDanger[]=state.disasters.flatMap(d=>d.phase!=='ended'&&canSeeDisaster(w,r,d)?[{id:d.id,label:disasterNames[d.kind],at:d.at,radius:d.radius,phase:d.phase}]:[]);
 return [...beasts,...disasters].sort((a,b)=>distance(a.at,r.at)-distance(b.at,r.at));
}

/** Retreat searches and the engine use the same actual edges. A resident may
 * leave a danger already occupied, but must not enter or re-enter another known
 * danger on the way to a dry destination. This does not reveal distant beasts. */
export function frontierRetreatStepAllowed(w:World,r:Resident):(from:Vec,to:Vec)=>boolean {
 const dangers=seenFrontierDangers(w,r).map(seen=>{
  const disaster=w.frontierHazards!.disasters.find(d=>d.id===seen.id&&d.phase!=='ended');
  return (at:Vec)=>disaster?disasterContains(disaster,at):distance(at,seen.at)<=seen.radius;
 });
 return (from,to)=>walkable(w,to,from)&&dangers.every(contains=>!contains(to)||contains(from));
}

/** Temporary shelter does not allocate a bed or displace an existing right or occupant. */
export function frontierShelterOccupants(w:World,b:Building):Set<string>{
 const ids=new Set(w.residents.filter(p=>local(p)&&(p.inside===b.id||b.residents.includes(p.id))).map(p=>p.id));
 for(const stay of w.commons?.stays??[])if(stay.buildingId===b.id&&stay.endedAt===null&&stay.expiresAt>w.minute)ids.add(stay.residentId);
 for(const claim of relocationBedClaims(w,b.id))ids.add(claim.personId);
 for(const transport of w.health?.transports??[])if(transport.buildingId===b.id&&transport.phase==='carrying'&&transport.bed!==null)ids.add(transport.patientId);
 for(const appointment of w.health?.appointments??[])if(appointment.buildingId===b.id&&appointment.status==='accepted'&&appointment.end>w.minute)ids.add(appointment.patientId);
 for(const shift of w.duties?.shifts??[])if(shift.buildingId===b.id&&shift.role==='care'&&['booked','on-duty'].includes(shift.status)&&shift.end>w.minute&&shift.clientId)ids.add(shift.clientId);
 return ids;
}
export function usableFrontierShelter(w:World,r:Resident,b:Building,dangerId:string){
 if(b.condition<35||!r.knownBuildings.includes(b.id)||!(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id)))return false;
 const occupants=frontierShelterOccupants(w,b);
 if(!occupants.has(r.id)&&occupants.size>=b.capacity)return false;
 // A roof does not protect against another simultaneous flood.
 return safeFrontierShelter(w,b);
}

export function frontierHazardTarget(w:World,r:Resident,a:FrontierHazardAction):{target:Vec;duration:number;adjacent?:boolean;error?:string}{
 const fail=(error:string)=>({target:r.at,duration:0,error});
 if(!w.frontierHazards||!local(r)||!r.canDecide||!r.canExpress)return fail('当前无法作出这项避险或修缮决定');
 if(a.operation==='clearSpring'){
  const spring=w.resources.find(s=>s.id===a.sourceId&&s.kind==='spring');
  if(!spring||!canInspectSpring(w,r,spring)||ageYears(r.bornAt,w.minute)<18)return fail('须由成年人在已知泉水附近实地核实');
  if(!spring.floodDamage||spring.floodDamage.disasterId!==a.damageId||spring.floodDamage.clearedAt!==null)return fail('原淤塞已清理或损害记录已改变');
  if(w.frontierHazards.disasters.some(d=>d.phase!=='ended'&&disasterContains(d,spring.at)))return fail('危险尚未解除，不能清理泉水');
  if((r.inventory.wood??0)<1||(r.inventory.stone??0)<2)return fail('清理泉水须本人实际携带1木2石');
  return {target:spring.at,duration:60,adjacent:true};
 }
 if(a.operation==='repair'){
  const b=w.buildings.find(b=>b.id===a.buildingId);
  if(!b||!r.knownBuildings.includes(b.id)||!(b.ownerId===r.id||b.ownerId==='commons')||b.condition>=100||ageYears(r.bornAt,w.minute)<18)return fail('需要本人拥有或可维护的已知受损建筑');
  if((r.inventory.wood??0)<repairWood||(r.inventory.stone??0)<repairStone)return fail('修缮需要本人实际携带 2 份木料和 1 份石料');
  return {target:b.door,duration:34};
 }
 if(!w.frontierHazards.beasts.some(b=>b.id===a.dangerId&&b.status!=='dead')&&!w.frontierHazards.disasters.some(d=>d.id===a.dangerId&&d.phase!=='ended'))return fail('这项危险已经离开本地记录');
 if(a.operation==='retreat')return distance(r.at,a.to)<=24&&walkable(w,a.to,r.at)&&!w.frontierHazards.disasters.some(d=>d.phase!=='ended'&&disasterContains(d,a.to))?{target:a.to,duration:1}:fail('撤离目的地当前不能到达');
 const b=w.buildings.find(b=>b.id===a.buildingId);
 return b&&usableFrontierShelter(w,r,b,a.dangerId)?{target:b.door,duration:1}:fail('当前没有可进入的安全遮蔽处');
}

export function completeFrontierHazard(w:World,r:Resident,a:FrontierHazardAction):string|null {
 const route=frontierHazardTarget(w,r,a);
 if(route.error)return route.error;
 if(route.adjacent?distance(r.at,route.target)>1||!walkable(w,r.at):!same(r.at,route.target))return '本人尚未实际到达目的地';
 if(a.operation==='clearSpring'){
  const spring=w.resources.find(s=>s.id===a.sourceId)!;if(!canContactSpring(w,r,spring))return '本人尚未实际接触这处泉水';r.inventory.wood!-=1;r.inventory.stone!-=2;spring.floodDamage!.clearedAt=w.minute;
  emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}用1木2石到场清理了淤塞泉水；只恢复原水点取用，不补水。`,hazardFact:{disasterId:a.damageId,phase:'repair',targetId:spring.id,before:spring.amount,after:spring.amount}});return null;
 }
 if(a.operation==='retreat'){
  emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}自行撤离到附近的位置。`,...(w.frontierHazards!.disasters.some(d=>d.id===a.dangerId)?{hazardFact:{disasterId:a.dangerId,phase:'retreat' as const,targetId:r.id}}:{})});
  return null;
 }
 const b=w.buildings.find(b=>b.id===a.buildingId)!;
 if(a.operation==='repair'){
  const before=b.condition,disasterId=b.lastHazardDamage?.disasterId??w.events.slice().reverse().find(e=>e.hazardFact?.phase==='damage'&&e.hazardFact.targetId===b.id)?.hazardFact?.disasterId;
  r.inventory.wood!-=repairWood;r.inventory.stone!-=repairStone;b.condition=Math.min(100,b.condition+28);
  w.frontierHazards!.totals.repairs++;
  emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}用自己的材料修缮了${b.name}。`,...(disasterId?{hazardFact:{disasterId,phase:'repair' as const,targetId:b.id,before,after:b.condition}}:{})});
 }else{
  r.inside=b.id;r.roomAt={...roomLayout(w,b).entry};
  emitEvent(w,{kind:'hazard',actors:[r.id],place:{...r.at},text:`${r.name}自行进入${b.name}避险；未新增住宿、床位或物资。`,...(w.frontierHazards!.disasters.some(d=>d.id===a.dangerId)?{hazardFact:{disasterId:a.dangerId,phase:'shelter' as const,targetId:b.id}}:{})});
 }
 return null;
}
