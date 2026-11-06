import type {Livestock} from '../shared/industry.js';
import type {FrontierNutrients} from '../shared/production.js';
import type {Plot,World} from '../shared/types.js';
import {same,walkable} from './navigation.js';
import {DAY} from './time.js';

export function initializeFrontierNutrients(w:World):FrontierNutrients|undefined {
 if(w.scenario!=='frontier'||!w.production)return undefined;
 return w.production.nutrients??={lastDay:Math.floor(w.minute/DAY),digestion:{},heaps:[],soil:{},deposited:0,collected:0,fertilized:0,harvested:0};
}

/** Grazing and hand feeding call this with the hunger relief they actually supplied. */
export function recordLivestockNourishment(w:World,animal:Livestock,relief:number):void {
 if(!Number.isFinite(relief)||relief<=0)return;
 const state=initializeFrontierNutrients(w);if(!state)return;
 const digestion=state.digestion[animal.id]??={remaining:0,readyAt:w.minute+120};
 digestion.remaining=Math.min(96,digestion.remaining+relief);
}

export function advanceFrontierNutrients(w:World):void {
 const state=w.production?.nutrients;
 if(!state)return;
 const animals=w.industry?.animals??[];
 const day=Math.floor(w.minute/DAY),elapsed=day-state.lastDay;
 if(elapsed>0){
  const plots=new Map(w.plots.map(plot=>[plot.id,plot]));
  const orchards=new Set(w.industry?.trees.filter(tree=>tree.status!=='cut').map(tree=>tree.plotId));
  for(const id of Object.keys(state.soil)){
   const plot=plots.get(id);
   if(!plot){delete state.soil[id];continue;}
   if(!plot.crop&&!orchards.has(plot.id)&&state.soil[id]<50)state.soil[id]=Math.min(50,state.soil[id]+elapsed);
  }
  const live=new Set(animals.filter(animal=>animal.status==='alive').map(animal=>animal.id));
  for(const id of Object.keys(state.digestion))if(!live.has(id))delete state.digestion[id];
  state.heaps=state.heaps.filter(heap=>w.minute-heap.updatedAt<3*DAY);
  state.lastDay=day;
 }
 for(const animal of animals){
  const digestion=state.digestion[animal.id];
  if(!digestion)continue;
  if(animal.status!=='alive'){delete state.digestion[animal.id];continue;}
  if(animal.carrierId||w.minute<digestion.readyAt)continue;
  const intake=animal.kind==='chicken'||animal.kind==='duck'?12:16;
  if(digestion.remaining+1e-8<intake)continue;
  const barn=w.buildings.find(b=>b.id===animal.barnId);
  const at=animal.inside?barn?.door:animal.at??barn?.door;
  if(!at||!walkable(w,at))continue;
  let heap=state.heaps.find(pile=>pile.ownerId===animal.ownerId&&same(pile.at,at));
  if(!heap){
   heap={id:`manure:${at.x},${at.y}:${animal.ownerId}`,at:{...at},ownerId:animal.ownerId,units:0,updatedAt:w.minute};
   state.heaps.push(heap);
  }
  digestion.remaining=Math.max(0,digestion.remaining-intake);
  digestion.readyAt=w.minute+4*60;
  if(heap.units<4){heap.units++;heap.updatedAt=w.minute;state.deposited++;}
 }
}

export function soilFertility(w:World,plotId:string):number {
 return w.production?.nutrients?.soil[plotId]??50;
}

export function cropYieldAt(w:World,plot:Plot,base:number):number {
 if(w.scenario!=='frontier')return base;
 return Math.max(1,Math.round(base*(.65+.007*soilFertility(w,plot.id))));
}

export function recordFieldHarvest(w:World,plotId:string,amount:number):void {
 const state=w.production?.nutrients;
 if(!state)return;
 state.soil[plotId]=Math.max(0,soilFertility(w,plotId)-8);
 state.harvested+=amount;
}
