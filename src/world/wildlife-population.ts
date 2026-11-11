import {beastNames,disasterContains,type FrontierHazardState,type LocalWildSpecies,type WildBeast} from '../shared/frontier-hazards.js';
import type {Vec,World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {DAY} from './time.js';

export const localWildSpecies:LocalWildSpecies[]=['boar','deer','hare','duck'];
const rules={boar:{capacity:4,gestation:5},deer:{capacity:6,gestation:6},hare:{capacity:8,gestation:3},duck:{capacity:4,gestation:4}};
export const isLocalWildSpecies=(kind:WildBeast['species']):kind is LocalWildSpecies=>localWildSpecies.includes(kind as LocalWildSpecies);
const living=(b:WildBeast)=>b.status==='alive';
const neighbors=({x,y}:Vec)=>[{x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1}];
const threatened=(w:World,at:Vec)=>!!w.frontierHazards?.disasters.some(d=>d.phase==='active'&&disasterContains(d,at));
function route(w:World,from:Vec,to:Vec,limit:number){
 if(!walkable(w,from)||!walkable(w,to)||threatened(w,from)||threatened(w,to))return null;
 return findPath(w,from,to,false,limit,(_from,to)=>!threatened(w,to));
}

/** Register only surviving individuals and existing reservations. Never seed or refill an old world. */
export function initializeWildlifePopulation(w:World,s:FrontierHazardState){
 if(s.wildlifePopulation)return;
 const species=Object.fromEntries(localWildSpecies.map(kind=>{
  const animals=s.beasts.filter(b=>b.species===kind&&living(b));
  return [kind,{capacity:Math.max(rules[kind].capacity,animals.length+animals.filter(b=>b.pregnancy).length),
   registered:animals.length,born:0,deaths:0,tamed:0}];
 })) as NonNullable<FrontierHazardState['wildlifePopulation']>['species'];
 s.wildlifePopulation={version:1,registeredAt:w.minute,lastReviewAt:w.minute,species};
}

/** Call once while the individual still belongs to the living wild population. */
export function recordWildlifeExit(w:World,b:WildBeast,reason:'deaths'|'tamed'){
 if(!isLocalWildSpecies(b.species)||!living(b)||!w.frontierHazards)return;
 initializeWildlifePopulation(w,w.frontierHazards);
 w.frontierHazards.wildlifePopulation!.species[b.species][reason]++;
}

/** Existing food and drinking places must be physically reachable, not merely in the same species record. */
export function localWildlifeHabitat(w:World,b:WildBeast){
 const s=w.frontierHazards!,patch=s.foodPatches.find(p=>p.id==='habitat:'+b.species);
 const food=patch&&route(w,b.at,patch.at,72)!==null?patch.amount:0;
 const spring=w.resources.some(r=>r.kind==='spring'&&r.amount>=1&&r.floodDamage?.clearedAt!==null&&
  distance(b.at,r.at)<=70&&route(w,b.at,r.at,80)!==null);
 const shore=s.shore;
 const bank=!!shore&&distance(b.at,shore)<=65&&neighbors(shore).some(at=>at.x>=0&&at.y>=0&&at.x<w.map.width&&at.y<w.map.height&&
  w.map.tiles[at.y*w.map.width+at.x]==='water'&&!threatened(w,at))&&route(w,b.at,shore,80)!==null;
 return {food,watered:spring||bank};
}
const capable=(w:World,b:WildBeast)=>living(b)&&!b.disease&&b.health>=75&&b.hunger<53&&(b.thirst??0)<65&&w.minute-b.bornAt>=28*DAY;
function related(a:WildBeast,b:WildBeast){
 return a.motherId===b.id||a.sireId===b.id||b.motherId===a.id||b.sireId===a.id||
  !!(a.motherId&&a.motherId===b.motherId)||!!(a.sireId&&a.sireId===b.sireId);
}
type Factory=(w:World,kind:WildBeast['species'],id:string,den:Vec)=>WildBeast;
function note(w:World,mother:WildBeast,text:string,ids:string[]){
 emitEvent(w,{kind:'hazard',actors:[],animalIds:ids,place:{...mother.at},text});
}

export function reviewWildlifePopulation(w:World,s:FrontierHazardState,create:Factory){
 initializeWildlifePopulation(w,s);const population=s.wildlifePopulation!;
 if(Math.floor(w.minute/60)<=Math.floor(population.lastReviewAt/60))return;
 population.lastReviewAt=w.minute;
 for(const kind of localWildSpecies){
  const stock=population.species[kind];
  const occupied=()=>s.beasts.filter(b=>living(b)&&b.species===kind).reduce((n,b)=>n+1+(b.pregnancy?1:0),0);
  for(const mother of s.beasts.filter(b=>living(b)&&b.species===kind&&b.sex==='female')){
   const habitat=localWildlifeHabitat(w,mother);
   if(mother.pregnancy){
    const pregnancy=mother.pregnancy;if(pregnancy.dueAt>w.minute)continue;
    const at=neighbors(mother.at).find(at=>route(w,mother.at,at,1)!==null&&!s.beasts.some(b=>living(b)&&same(b.at,at))&&
     !w.industry?.animals.some(b=>b.status==='alive'&&b.at&&!b.inside&&same(b.at,at)));
    if(!capable(w,mother)||habitat.food<2||!habitat.watered||occupied()>stock.capacity||!at){
     if(w.minute>=pregnancy.dueAt+DAY){
      delete mother.pregnancy;mother.lastBredAt=w.minute;
      note(w,mother,`${beastNames[kind]}的孕育因健康、食水或幼崽位置不足而终止。`,[mother.id,pregnancy.sireId]);
     }
     continue;
    }
    let id:string;do{id=`beast:${kind}:${s.nextBeastSerial++}`;}while(s.beasts.some(b=>b.id===id)||w.industry?.animals.some(b=>b.id===id));
    const baby=create(w,kind,id,mother.den);
    Object.assign(baby,{at,bornAt:w.minute,sex:s.nextBeastSerial%2?'female':'male',health:90,hunger:35,motherId:mother.id,sireId:pregnancy.sireId});
    s.beasts.push(baby);stock.born++;delete mother.pregnancy;mother.lastBredAt=w.minute;mother.hunger=Math.min(100,mother.hunger+15);
    note(w,baby,`一只${beastNames[kind]}幼崽在亲代附近实际出生，沿用有限食源与种群容量。`,[baby.id,mother.id,pregnancy.sireId]);
    continue;
   }
   if(!capable(w,mother)||habitat.food<3||!habitat.watered||occupied()>=stock.capacity||
    mother.lastBredAt!==undefined&&w.minute-mother.lastBredAt<rules[kind].gestation*DAY)continue;
   const sire=s.beasts.find(b=>b.species===kind&&b.sex==='male'&&capable(w,b)&&!related(mother,b)&&route(w,mother.at,b.at,5)!==null);
   if(!sire)continue;
   mother.pregnancy={dueAt:w.minute+rules[kind].gestation*DAY,sireId:sire.id};
   note(w,mother,`${beastNames[kind]}开始孕育，已为一只幼崽预留有限种群位置。`,[mother.id,sire.id]);
  }
 }
}
