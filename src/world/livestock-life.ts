import type {AnimalKind,Livestock} from '../shared/industry.js';
import {roomLayout} from '../shared/rooms.js';
import type {World} from '../shared/types.js';
import {emitEvent} from './events.js';

export const animalNames:Record<AnimalKind,string>={chicken:'鸡',goat:'山羊',sheep:'绵羊',duck:'家鸭',cow:'牛'};
export const animalProducts={chicken:'egg',duck:'duckEgg',goat:'milk',cow:'milk',sheep:'wool'} as const satisfies Record<AnimalKind,string>;

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
