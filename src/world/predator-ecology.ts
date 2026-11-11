import {disasterContains} from '../shared/frontier-hazards.js';
import {beastNames,type FrontierHazardState,type PredatorHabitat,type WildBeast} from '../shared/frontier-hazards.js';
import type {Vec,World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {calendar,DAY} from './time.js';

export const isPredator=(b:WildBeast):boolean=>b.species==='wolf'||b.species==='fox';
const living=(b:WildBeast)=>b.status==='alive';
const adjacent=(p:Vec)=>[{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}];
const threatened=(w:World,p:Vec)=>!!w.frontierHazards?.disasters.some(d=>d.phase==='active'&&disasterContains(d,p));
const route=(w:World,from:Vec,to:Vec,limit:number)=>{
 if(!walkable(w,from)||!walkable(w,to)||threatened(w,from)||threatened(w,to))return null;
 const path=findPath(w,from,to,false,limit);
 return path&&!path.some(at=>threatened(w,at))?path:null;
};
const preyFor=(kind:WildBeast['species'])=>kind==='wolf'?['hare','duck','deer']:['hare','duck'];

/** Small-game pools are physical finite stocks shared by every nearby consumer, never per-habitat copies. */
export function predatorFoodPatch(w:World,b:WildBeast){
 return w.frontierHazards?.foodPatches.filter(p=>p.kind==='smallGame'&&p.amount>=1&&distance(b.at,p.at)<=24)
  .sort((a,c)=>distance(b.at,a.at)-distance(b.at,c.at)).find(p=>route(w,b.at,p.at,32)!==null);
}
function cover(w:World,at:Vec){
 if(!walkable(w,at)||threatened(w,at))return false;
 if(!w.resources.some(r=>r.kind==='tree'&&r.amount>0&&distance(r.at,at)<=12))return false;
 let space=0;const queue=[at],seen=new Set([`${at.x},${at.y}`]);
 for(let index=0;index<queue.length;index++){
  const p=queue[index];if(w.map.tiles[p.y*w.map.width+p.x]==='grass')space++;
  for(const next of adjacent(p)){
   const key=`${next.x},${next.y}`;
   if(seen.has(key)||Math.abs(next.x-at.x)>2||Math.abs(next.y-at.y)>2||!walkable(w,next,p)||threatened(w,next))continue;
   seen.add(key);queue.push(next);
  }
 }
 return space>=6;
}
function water(w:World,at:Vec){
 if(w.resources.some(r=>r.kind==='spring'&&r.floodDamage?.clearedAt!==null&&r.amount>=1&&distance(r.at,at)<=72&&route(w,at,r.at,80)!==null))return true;
 const shore=w.frontierHazards?.shore;
 return !!shore&&adjacent(shore).some(p=>p.x>=0&&p.y>=0&&p.x<w.map.width&&p.y<w.map.height&&
  w.map.tiles[p.y*w.map.width+p.x]==='water')&&route(w,at,shore,80)!==null;
}
function food(w:World,h:PredatorHabitat){
 const state=w.frontierHazards!,prey=preyFor(h.species);
 const patches=state.foodPatches.filter(p=>p.kind==='smallGame'&&p.amount>0&&distance(h.at,p.at)<=24&&route(w,h.at,p.at,32)!==null);
 const animals=state.beasts.filter(b=>living(b)&&prey.includes(b.species)&&distance(h.at,b.at)<=24&&route(w,h.at,b.at,32)!==null);
 return patches.reduce((sum,p)=>sum+p.amount,0)+animals.length;
}
export function predatorHabitatCondition(w:World,h:PredatorHabitat){
 const sheltered=cover(w,h.at),watered=water(w,h.at),available=food(w,h);
 return {sheltered,watered,food:available,suitable:sheltered&&watered&&available>=2};
}
const residents=(s:FrontierHazardState,h:PredatorHabitat)=>s.beasts.filter(b=>living(b)&&b.habitatId===h.id);
const occupied=(s:FrontierHazardState,h:PredatorHabitat)=>residents(s,h).length+
 s.beasts.filter(b=>living(b)&&b.migration?.toId===h.id&&b.habitatId!==h.id).length+
 residents(s,h).filter(b=>b.pregnancy).length;
const habitat=(s:FrontierHazardState,b:WildBeast)=>s.predatorEcology?.habitats.find(h=>h.id===b.habitatId);
type Factory=(w:World,species:WildBeast['species'],id:string,den:Vec)=>WildBeast;

/** Upgrade metadata only. Only explicit new-world creation can introduce founding mates. */
export function initializePredatorEcology(w:World,s:FrontierHazardState,create:Factory,fresh=false){
 if(s.predatorEcology)return;
 const habitats:PredatorHabitat[]=[];
 const add=(kind:'wolf'|'fox',at:Vec)=>{
  const h:PredatorHabitat={id:`predator:${kind}:${habitats.filter(h=>h.species===kind).length+1}`,species:kind,at:{...at},capacity:3,
   registered:0,born:0,deaths:0,arrived:0,departed:0};
  habitats.push(h);return h;
 };
 for(const kind of ['wolf','fox'] as const){
  const beasts=s.beasts.filter(b=>b.species===kind);
  if(!beasts.length)continue;
  for(const b of beasts){
   const h=habitats.find(h=>h.species===kind&&distance(h.at,b.den)<=8)??add(kind,b.den);
   b.habitatId=h.id;if(living(b))h.registered++;
  }
  const primary=habitats.find(h=>h.species===kind)!;
  // This is an empty, on-map neighboring territory, not an inexhaustible outside population.
  const anchors=w.resources.filter(r=>r.kind==='tree'&&r.amount>0&&distance(r.at,primary.at)>=10&&distance(r.at,primary.at)<=24)
   .sort((a,b)=>distance(a.at,primary.at)-distance(b.at,primary.at)||a.id.localeCompare(b.id));
  const neighbor=anchors.flatMap(r=>adjacent(r.at)).find(at=>cover(w,at)&&water(w,at)&&
   !habitats.some(h=>h.species===kind&&distance(h.at,at)<10)&&route(w,primary.at,at,40)!==null);
  if(neighbor){
   const h=add(kind,neighbor);
   if(fresh&&beasts.length===1&&living(beasts[0])){
    const mate=create(w,kind,`beast:${kind}:founding-mate`,neighbor);
    mate.sex=beasts[0].sex==='male'?'female':'male';mate.habitatId=h.id;
    s.beasts.push(mate);h.registered++;
   }
  }
 }
 s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats};
}

function note(w:World,b:WildBeast,text:string,others:string[]=[]){
 emitEvent(w,{kind:'hazard',actors:[],animalIds:[b.id,...others],place:{...b.at},text});
}
export function recordPredatorDeath(w:World,b:WildBeast){
 if(!isPredator(b))return;
 const h=habitat(w.frontierHazards!,b);if(h)h.deaths++;
 delete b.migration;
}

/** Disease acts only on wildlife; contact needs an actual, reachable infectious animal. */
export function advancePredatorDisease(w:World,b:WildBeast,minutes:number){
 if(!isPredator(b))return;
 const s=w.frontierHazards!,h=habitat(s,b);
 const crowded=!!h&&residents(s,h).length>h.capacity;
 const contact=s.beasts.find(n=>n.id!==b.id&&living(n)&&isPredator(n)&&n.disease&&distance(b.at,n.at)<=2&&route(w,b.at,n.at,3)!==null);
 const stressed=b.hunger>=80||(b.thirst??0)>=85||crowded;
 if(!b.disease){
  b.diseaseExposure=Math.max(0,(b.diseaseExposure??0)+minutes*(contact||stressed?1:-2));
  if(b.diseaseExposure>=2*DAY){
   b.disease={since:w.minute,severity:20,cause:contact?'contact':'stress',...(contact?{sourceId:contact.id}:{})};
   b.diseaseExposure=0;
   note(w,b,`${beastNames[b.species]}出现野生动物疾病，记录原因：${contact?'接触患病个体':'持续饥渴或拥挤'}。`,contact?[contact.id]:[]);
  }
 }else{
  b.disease.severity=Math.max(0,Math.min(100,b.disease.severity+minutes/DAY*(stressed?12:-8)));
  b.health=Math.max(0,b.health-minutes/DAY*b.disease.severity*.35);
  if(b.disease.severity===0){delete b.disease;note(w,b,`${beastNames[b.species]}的野生动物疾病已恢复。`);}
 }
}

function cancelMigration(w:World,b:WildBeast,reason:string){
 delete b.migration;delete b.path;b.nextMigrationAt=w.minute+DAY/4;
 b.activity={kind:'roam',reason,target:{...b.den}};
 note(w,b,`${beastNames[b.species]}中止迁移：${reason}。`);
}
/** Called after normal needs/mortality, once per movement deadline. A move is never a respawn. */
export function stepPredatorMigration(w:World,b:WildBeast):boolean {
 if(!b.migration)return false;
 if(w.minute<b.nextMoveAt)return true;
 b.nextMoveAt=w.minute+8;
 const s=w.frontierHazards!,m=b.migration,to=s.predatorEcology?.habitats.find(h=>h.id===m.toId);
 if(!to||occupied(s,to)>to.capacity||!predatorHabitatCondition(w,to).suitable){cancelMigration(w,b,'目的栖地已缺少食水、遮蔽或空位');return true;}
 const path=route(w,b.at,to.at,80);
 if(!path){cancelMigration(w,b,'途中通路已经阻断');return true;}
 if(path.length){
  const next=path[0];
  if(!walkable(w,next,b.at)){cancelMigration(w,b,'途中通路已经阻断');return true;}
  b.at={...next};
 }
 b.activity={kind:'migrate',reason:m.reason,target:{...to.at},targetId:to.id};
 if(same(b.at,to.at)){
  const from=s.predatorEcology!.habitats.find(h=>h.id===m.fromId);
  if(from)from.departed++;to.arrived++;b.habitatId=to.id;b.den={...to.at};
  delete b.migration;delete b.path;b.nextMigrationAt=w.minute+2*DAY;
  b.activity={kind:'roam',reason:'已沿实际通路抵达新的栖地',target:{...to.at}};
  note(w,b,`${beastNames[b.species]}从${m.fromId}迁至${to.id}，沿用原个体身份。`);
 }
 return true;
}

function capable(w:World,b:WildBeast){
 return living(b)&&!b.disease&&!b.migration&&b.health>=75&&b.hunger<53&&(b.thirst??0)<65&&w.minute-b.bornAt>=28*DAY;
}
function breed(w:World,s:FrontierHazardState,create:Factory){
 const season=calendar(w.minute).season;
 for(const mother of s.beasts.filter(b=>living(b)&&isPredator(b)&&b.sex==='female')){
  const h=habitat(s,mother);if(!h)continue;
  const c=predatorHabitatCondition(w,h);
  if(mother.pregnancy){
   const p=mother.pregnancy;if(p.dueAt>w.minute)continue;
   const at=adjacent(mother.at).find(at=>walkable(w,at,mother.at)&&!threatened(w,at)&&!s.beasts.some(b=>living(b)&&same(b.at,at)));
   if(!capable(w,mother)||!c.suitable||c.food<2||occupied(s,h)>h.capacity||distance(mother.at,h.at)>5||!at){
    // A poor birth site cannot retain an overdue pregnancy indefinitely.
    if(w.minute>=p.dueAt+DAY){delete mother.pregnancy;mother.lastBredAt=w.minute;note(w,mother,`${beastNames[mother.species]}的孕育因健康、食水或巢位条件不足而终止。`,[p.sireId]);}
    continue;
   }
   let id:string;do{id=`beast:${mother.species}:${s.nextBeastSerial++}`;}while(s.beasts.some(b=>b.id===id));
   const baby=create(w,mother.species,id,h.at);
   Object.assign(baby,{at,bornAt:w.minute,sex:s.nextBeastSerial%2?'female':'male',health:90,hunger:35,
    habitatId:h.id,motherId:mother.id,sireId:p.sireId});
   s.beasts.push(baby);h.born++;delete mother.pregnancy;mother.lastBredAt=w.minute;mother.hunger=Math.min(100,mother.hunger+20);
   note(w,baby,`${beastNames[mother.species]}幼崽在${h.id}出生，亲代与实际巢位均已登记。`,[mother.id,p.sireId]);
   continue;
  }
  if(season!=='spring'||!capable(w,mother)||(mother.lastBredAt!==undefined&&w.minute-mother.lastBredAt<28*DAY)||
   !c.suitable||c.food<3||occupied(s,h)>=h.capacity||distance(mother.at,h.at)>5)continue;
  const sire=s.beasts.find(b=>b.species===mother.species&&b.sex==='male'&&b.habitatId===h.id&&capable(w,b)&&
   route(w,mother.at,b.at,5)!==null&&b.motherId!==mother.id&&b.sireId!==mother.id&&mother.motherId!==b.id&&mother.sireId!==b.id&&
   !(b.motherId&&b.motherId===mother.motherId)&&!(b.sireId&&b.sireId===mother.sireId));
  if(!sire)continue;
  mother.pregnancy={dueAt:w.minute+(mother.species==='wolf'?6:4)*DAY,sireId:sire.id};
  note(w,mother,`${beastNames[mother.species]}在${h.id}开始孕育，已预留一个巢位。`,[sire.id]);
 }
}

export function reviewPredatorEcology(w:World,s:FrontierHazardState,create:Factory){
 const ecology=s.predatorEcology;if(!ecology||Math.floor(w.minute/60)<=Math.floor(ecology.lastReviewAt/60))return;
 ecology.lastReviewAt=w.minute;
 breed(w,s,create);
 for(const b of s.beasts.filter(b=>living(b)&&isPredator(b))){
  if(b.migration||b.pregnancy||b.disease||b.alert||w.minute-b.bornAt<28*DAY||w.minute<(b.nextMigrationAt??0))continue;
  const from=habitat(s,b);if(!from)continue;
  const count=residents(s,from).length;
  const conditions=predatorHabitatCondition(w,from),crowded=count>from.capacity||count>=from.capacity&&!!b.motherId;
  const mateHere=residents(s,from).some(n=>n.id!==b.id&&n.sex!==b.sex&&capable(w,n));
  const forced=!conditions.suitable;
  const seekMate=calendar(w.minute).season==='spring'&&capable(w,b)&&!mateHere;
  if(!forced&&!crowded&&!seekMate)continue;
  const candidates=ecology.habitats.filter(h=>h.species===b.species&&h.id!==from.id&&occupied(s,h)<h.capacity)
   .sort((a,c)=>distance(b.at,a.at)-distance(b.at,c.at));
  for(const to of candidates){
   const c=predatorHabitatCondition(w,to);
   if(!c.suitable||route(w,b.at,to.at,80)===null)continue;
   if(seekMate&&!forced&&!crowded&&!residents(s,to).some(n=>n.sex!==b.sex&&capable(w,n)))continue;
   const reason=forced?'原栖地食水或遮蔽不足':crowded?'原栖地巢位拥挤':'寻找存活的成年配偶';
   b.migration={fromId:from.id,toId:to.id,startedAt:w.minute,reason};delete b.alert;delete b.path;
   b.activity={kind:'migrate',reason,target:{...to.at},targetId:to.id};
   note(w,b,`${beastNames[b.species]}离开${from.id}，开始沿通路迁往${to.id}：${reason}。`);
   break;
  }
  b.nextMigrationAt=w.minute+DAY/4;
 }
}
