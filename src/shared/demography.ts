import type {PopulationChange, World, WorldEvent} from './types.js';
import {calendar} from '../world/time.js';

export interface PopulationSeason {
 year:number;
 season:ReturnType<typeof calendar>['season'];
 residents:number;
 visitors:number;
 changes:Partial<Record<PopulationChange,number>>;
}
export interface PopulationBook {
 since:number;
 baseline:number;
 seasons:PopulationSeason[];
 recent:Array<Pick<WorldEvent,'id'|'at'|'actors'|'text'|'populationChange'>>;
}

export function headcount(world:World){
 let residents=0,visitors=0;
 for(const person of world.residents){
  if(person.status!=='alive')continue;
  if(person.residency==='resident')residents++;
  if(person.residency==='visitor')visitors++;
 }
 return {residents,visitors};
}

export function ensureCensus(world:World){
 if(world.mode!=='formal')return;
 const {year,season}=calendar(world.minute);
 const last=world.population?.seasons.at(-1);
 if(last?.year===year && last.season===season)return;
 const size=headcount(world);
 world.population??={since:world.minute,baseline:size.residents,seasons:[],recent:[]};
 world.population.seasons.push({year,season,...size,changes:{}});
}

export function recordPopulationFact(world:World,event:WorldEvent){
 const key=event.populationChange;
 if(!key || world.mode!=='formal')return;
 ensureCensus(world);
 const book=world.population!;
 const period=book.seasons.at(-1)!;
 Object.assign(period,headcount(world));
 period.changes[key]=(period.changes[key]??0)+1;
 book.recent.push({id:event.id,at:event.at,actors:event.actors.slice(),text:event.text,populationChange:key});
 if(book.recent.length>36)book.recent.shift();
}
