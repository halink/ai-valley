import type {World,Vec} from '../shared/types.js';
import {calendar,DAY} from './time.js';
import {distance,same,walkable} from './navigation.js';
import {recordLivestockNourishment} from './frontier-nutrients.js';

export function pastureContains(w:World,at:Vec):boolean {
 return w.industry?.pastures?.some(yard=>yard.tiles.some(tile=>same(tile,at)))??false;
}

export function pastureTileFree(w:World,at:Vec,animalId?:string):boolean {
 return walkable(w,at)&&!w.industry?.animals.some(n=>n.status==='alive'&&n.id!==animalId&&n.at&&!n.inside&&same(n.at,at))&&
  !w.residents.some(r=>{
   const a=r.activity?.action;
   return a?.type==='industry'&&a.operation==='moveAnimal'&&a.pastureId&&a.animalId!==animalId&&a.at&&same(a.at,at);
  });
}

const grassDay=14*60;
const grazingRate={chicken:.013,duck:.016,goat:.020,sheep:.022,cow:.030};
function daylightThrough(minute:number){return Math.floor(minute/DAY)*grassDay+Math.max(0,Math.min(grassDay,minute%DAY-6*60));}

/** Outdoor animals can consume only the grass that actually grows in their registered yard. */
export function advancePastures(w:World):void {
 const state=w.industry;if(!state?.pastures?.length)return;
 const season=calendar(w.minute).season;
 const seasonGrowth={spring:.35,summer:.19,autumn:.22,winter:.04}[season];
 for(const yard of state.pastures){
  const dt=Math.max(0,w.minute-yard.lastMinute);if(!dt)continue;
  const dayMinutes=daylightThrough(w.minute)-daylightThrough(yard.lastMinute);
  const canStep=Math.floor(w.minute/15)>Math.floor(yard.lastMinute/15);
  yard.lastMinute=w.minute;
  yard.forage=Math.min(yard.capacity,yard.forage+dt/DAY*yard.capacity*seasonGrowth*(w.weather==='rain'?1.4:1));
  for(const n of state.animals){
   if(n.status!=='alive'||n.pastureId!==yard.id||n.carrierId||n.inside||!n.at||!yard.tiles.some(tile=>same(tile,n.at!)))continue;
   const current=n.at,energy=n.energy??85;
   const neighbors=()=>yard.tiles.filter(tile=>distance(tile,current)===1&&pastureTileFree(w,tile,n.id));
   const predator=w.frontierHazards?.beasts.find(b=>b.status==='alive'&&(b.alert?.animalId===n.id||
    (b.species==='wolf'||b.species==='fox'||b.species==='boar')&&distance(b.at,current)<=3));
   const interacting=w.residents.some(r=>r.activity?.action.type==='industry'&&r.activity.action.animalId===n.id);
   if(predator&&!interacting){
    const away=neighbors().filter(tile=>distance(tile,predator.at)>distance(current,predator.at))
     .sort((a,b)=>distance(b,predator.at)-distance(a,predator.at))[0];
    if(canStep&&away)n.at={...away};
    n.energy=Math.max(0,energy-dt*.042);
    n.activity={kind:'flee',reason:'在牧场内躲避接近的野兽',target:{...(away??current)},targetId:predator.id};
    continue;
   }
   if(dayMinutes<=0||energy<24||n.activity?.kind==='rest'&&energy<55){
    n.energy=Math.min(100,energy+dt*.095);
    n.activity={kind:'rest',reason:dayMinutes<=0?'入夜，在牧场休息':'体力不足，在牧场歇息',target:{...current}};
    continue;
   }
   n.energy=Math.max(0,energy-dt*.022);
   if(w.map.tiles[current.y*w.map.width+current.x]==='grass'){
    const eaten=Math.min(yard.forage,Math.max(0,n.hunger-6),dayMinutes*grazingRate[n.kind]);
    n.hunger-=eaten;yard.forage-=eaten;
    if(eaten>0)recordLivestockNourishment(w,n,eaten);
   }
   n.activity={kind:n.thirst>72?'drink':yard.forage>0?'forage':'roam',
    reason:n.thirst>72?'口渴，牧场没有可用水槽，等待有人送水':yard.forage>0?'在牧场寻找草料':'牧场草料耗尽，寻找剩余植被',target:{...current},targetId:yard.id};
   if(!canStep||interacting)continue;
   const nearby=neighbors();
   if(nearby.length)n.at={...nearby[(Math.floor(w.minute/15)+(n.pen??0))%nearby.length]};
  }
 }
}
