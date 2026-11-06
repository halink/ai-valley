import type {AnimalKind,Livestock,Pasture} from '../shared/industry.js';
import type {Vec,World} from '../shared/types.js';
import {initializeForeignTrade} from './foreign-trade.js';
import {initializeIndustry,barnCapacity} from './industry.js';
import {industryDefinition} from './industry-rules.js';
import {same,walkable,findPath} from './navigation.js';
import {fishingShore,fishingStockAt} from './fishing.js';
import {DAY} from './time.js';

/** Register only the finite livestock and tools physically brought by the starting households. */
export function seedFrontierLivelihood(w:World,{barnId,pasture,fisherId,shore}:{barnId:string;pasture:Vec[];fisherId:string;shore:Vec}):void {
 const barn=w.buildings.find(b=>b.id===barnId&&b.kind==='barn');
 const owner=w.residents.find(r=>r.id===barn?.ownerId),fisher=w.residents.find(r=>r.id===fisherId);
 if(!barn||!owner||!fisher||pasture.length<4||barnCapacity(barn)<4||pasture.some((tile,index)=>!walkable(w,tile)||w.map.tiles[tile.y*w.map.width+tile.x]!=='grass'||pasture.slice(0,index).some(at=>same(at,tile))))throw new Error('Invalid frontier livelihood opening');
 initializeForeignTrade(w);initializeIndustry(w);
 const state=w.industry!;
 if(!fishingShore(w,shore)||!fishingStockAt(w,shore)||findPath(w,fisher.at,shore)===null)throw new Error('Invalid frontier fishing shore');
 const id=`pasture:${barn.id}`;
 if(state.pastures?.some(yard=>yard.id===id))return;
 const yard:Pasture={id,barnId:barn.id,tiles:pasture.map(at=>({...at})),capacity:pasture.length*4,forage:pasture.length*4,lastMinute:w.minute};
 (state.pastures??=[]).push(yard);
 const binding=industryDefinition(w);
 const herd:Array<[AnimalKind,Livestock['sex']]>= [['chicken','female'],['chicken','male'],['goat','female']];
 herd.forEach(([kind,sex],index)=>{
  const n:Livestock={id:`frontier-animal:${index+1}`,ownerId:owner.id,kind,sex,barnId:barn.id,pastureId:yard.id,pen:index,
   at:{...yard.tiles[Math.floor(index*yard.tiles.length/herd.length)]},inside:null,definition:binding.definition,
   bornAt:w.minute-(binding.rules.animalAdultDays+20+index)*DAY,hunger:18+index*3,thirst:17+index*3,
   health:95,product:index===0?1:0,progress:0,status:'alive',deathAt:null,pregnancy:null,lastMinute:w.minute};
  state.animals.push(n);
 });
 owner.inventory.fodder=(owner.inventory.fodder??0)+4;
 state.tools.push({id:'frontier-rod',definition:binding.definition,ownerId:fisher.id,kind:'rod',level:1,durability:binding.rules.toolDurability,maxDurability:binding.rules.toolDurability});
 state.fishingExperience??={};
 state.frontierShore={...shore};
}
