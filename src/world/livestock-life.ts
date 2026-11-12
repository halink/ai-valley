import type {AnimalKind,Livestock} from '../shared/industry.js';
import {roomLayout} from '../shared/rooms.js';
import type {World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {same,walkable} from './navigation.js';

export const animalNames:Record<AnimalKind,string>={chicken:'鸡',goat:'山羊',sheep:'绵羊',duck:'家鸭',cow:'牛'};
export const animalProducts={chicken:'egg',duck:'duckEgg',goat:'milk',cow:'milk',sheep:'wool'} as const satisfies Record<AnimalKind,string>;

/** Breeding is the existing same-enclosure husbandry action, not an implicit
 * escort between places. Missing `at` is the legacy occupied-barn representation;
 * outdoor animals must actually share a connected, registered pasture. */
export function livestockShareBreedingPlace(w:World,mother:Livestock,sire:Livestock):boolean {
 return livestockBreedingPlaceMatcher(w,mother)(sire);
}

/** Reuse only during one synchronous, read-only menu projection. Never retain
 * this matcher across world mutations; action validation constructs a fresh one. */
export function livestockBreedingPlaceMatcher(w:World,mother:Livestock):(sire:Livestock)=>boolean {
 const nowhere=()=>false;
 if(mother.carrierId||mother.destinationId)return nowhere;
 const barn=w.buildings.find(b=>b.id===mother.barnId&&b.kind==='barn'&&b.condition>0);if(!barn)return nowhere;
 const inBarn=(n:Livestock)=>!n.at?(!n.pastureId&&(!n.inside||n.inside===barn.id)):n.inside===barn.id&&same(n.at,barn.door);
 const motherInside=inBarn(mother);
 const yard=!motherInside&&!mother.inside&&mother.at&&mother.pastureId
  ?w.industry?.pastures?.find(p=>p.id===mother.pastureId&&p.barnId===barn.id&&p.status!=='retired'):undefined;
 const key=(at:{x:number;y:number})=>at.x+','+at.y;
 let connected:Set<string>|undefined;
 return sire=>{
  if(mother.barnId!==sire.barnId||sire.carrierId||sire.destinationId)return false;
  if(motherInside)return inBarn(sire);
  if(!yard||!mother.at||sire.inside||!sire.at||sire.pastureId!==yard.id)return false;
  if(!connected){
   const cells=new Set(yard.tiles.map(key));connected=new Set();
   if(cells.has(key(mother.at))&&walkable(w,mother.at)){
    const queue=[mother.at];connected.add(key(mother.at));
    for(let i=0;i<queue.length;i++)for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
     const from=queue[i],to={x:from.x+dx,y:from.y+dy},id=key(to);
     if(cells.has(id)&&!connected.has(id)&&walkable(w,to,from)){connected.add(id);queue.push(to);}
    }
   }
  }
  return connected.has(key(sire.at))&&walkable(w,sire.at);
 };
}

export function recordLivestockDeath(w:World,animal:Livestock,detail:string):boolean {
 if(animal.status==='dead'||!w.industry)return false;
 const owner=w.residents.find(r=>r.id===animal.ownerId),barn=w.buildings.find(b=>b.id===animal.barnId);
 animal.status='dead';animal.health=0;animal.deathAt=w.minute;animal.deathDetail=detail;animal.lastMinute=w.minute;
 animal.pregnancy=null;animal.carrierId=null;animal.destinationId=null;delete animal.activity;
 w.industry.totals.animalDeaths++;
 const roomId=animal.at?animal.inside??null:barn?.id??null;
 const roomAt=animal.at?animal.roomAt:barn&&roomLayout(w,barn).slots.find(slot=>slot.key==='pen:'+(animal.pen??0))?.at;
 emitEvent(w,{kind:'production',actors:owner?[owner.id]:[],animalIds:[animal.id],place:{...(animal.at??barn?.door??owner?.at??w.map.entrance)},roomId,roomAt:roomAt?{...roomAt}:null,
  text:`${owner?owner.name+'的':'一只'}${animalNames[animal.kind]}因${detail}死亡。`});
 return true;
}
