import type {MvpClimateState,MvpRainEpisode,MvpRainProvenance} from '../shared/mvp-climate.js';
import type {World} from '../shared/types.js';
import {climateFirstPureRainV1,climatePrecipitationBoundsV1,minuteToClimateUs,parseClimateUs} from './mvp-climate.js';

const DAY=1_440_000_000n,RETENTION=28n*DAY;
const MAX_RECENT=29; // At most one episode per v1 climate day.
const keySet=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const firstRainCache=new Map<string,bigint|null>();

function firstRain(seed:number,day:number,start:bigint,end:bigint):bigint|null {
 const key=seed+':'+day,cached=firstRainCache.get(key);
 if(cached!==undefined)return cached;
 const found=climateFirstPureRainV1(seed,start,end);
 if(firstRainCache.size>=256)firstRainCache.delete(firstRainCache.keys().next().value!);
 firstRainCache.set(key,found);return found;
}
function episodeFor(worldId:string,seed:number,day:number,adopted:bigint,after:bigint,through:bigint):MvpRainEpisode|null {
 const bounds=climatePrecipitationBoundsV1(seed,day);
 if(!bounds||bounds.start<adopted||bounds.end<=after||bounds.end>through)return null;
 const rain=firstRain(seed,day,bounds.start,bounds.end);if(rain===null)return null;
 const startedUs=bounds.start.toString();
 return {rainEventId:worldId+':rain:'+startedUs,startedUs,firstRainUs:rain.toString(),endedUs:bounds.end.toString()};
}
const sameEpisode=(a:MvpRainEpisode,b:MvpRainEpisode)=>a.rainEventId===b.rainEventId&&
 a.startedUs===b.startedUs&&a.firstRainUs===b.firstRainUs&&a.endedUs===b.endedUs;

export function validateMvpRainProvenance(worldId:string,climate:MvpClimateState):void {
 if(!Object.hasOwn(climate,'rainProvenance'))return;
 const p=climate.rainProvenance;
 if(!p||!keySet(p,['version','adoptedUs','recent'])||p.version!==1||!Array.isArray(p.recent)||p.recent.length>MAX_RECENT)
  throw Error('mvp_rain_unsupported_provenance');
 const through=parseClimateUs(climate.lastUs),adopted=parseClimateUs(p.adoptedUs);
 if(adopted<parseClimateUs(climate.adoptedUs)||adopted>through)throw Error('mvp_rain_adoption_clock');
 let previous=through-RETENTION;
 for(const stored of p.recent){
  if(!keySet(stored,['rainEventId','startedUs','firstRainUs','endedUs']))throw Error('mvp_rain_invalid_episode');
  const day=Number(parseClimateUs(stored.startedUs)/DAY);
  const expected=episodeFor(worldId,climate.seed,day,adopted,previous,through);
  if(!expected||!sameEpisode(stored,expected))throw Error('mvp_rain_invalid_episode');
  previous=parseClimateUs(expected.endedUs);
 }
}

/** Initial adoption is empty; a storm already underway is not retroactively
 * declared fully observed. Neither observations nor forecasts are migrated. */
export function adoptMvpRainProvenance(world:World):boolean {
 if(Object.hasOwn(world,'simulationOnly'))throw Error('mvp_rain_simulation_adoption');
 const climate=world.mvpClimate;
 if(!climate||world.mode!=='validation'||!world.id.startsWith('godot-mvp-')||climate.lastUs!==minuteToClimateUs(world.minute))
  throw Error('mvp_rain_requires_live_climate');
 validateMvpRainProvenance(world.id,climate);
 if(climate.rainProvenance)return false;
 climate.rainProvenance={version:1,adoptedUs:climate.lastUs,recent:[]};return true;
}

/** Advance only through a traversed world-clock interval. New evidence is
 * appended on the draft and becomes authoritative with the whole world commit.
 * Older facts age out of this sliding eligibility view; no ID is recreated. */
export function advanceMvpRainProvenance(worldId:string,seed:number,p:MvpRainProvenance,
 previousUs:string,throughUs:string):MvpRainProvenance {
 const previous=parseClimateUs(previousUs),through=parseClimateUs(throughUs),adopted=parseClimateUs(p.adoptedUs);
 if(through<previous||previous<adopted)throw Error('mvp_rain_clock_reversal');
 const floor=through-RETENTION,after=previous>floor?previous:floor;
 const recent=p.recent.filter(e=>parseClimateUs(e.endedUs)>floor);
 for(let day=(after>0n?after:0n)/DAY;day<=through/DAY;day++){
  const fact=episodeFor(worldId,seed,Number(day),adopted,after,through);
  if(fact)recent.push(fact);
 }
 if(recent.length>MAX_RECENT)throw Error('mvp_rain_episode_overflow');
 return {version:1,adoptedUs:p.adoptedUs,recent};
}

/** Narrow source resolver. Never derive a missing ID from weather, and never
 * export the forecast or make an isolated simulation an evidence authority.
 * A future executor must call this on its latest committed-world state. */
export function resolveMvpRainEpisode(world:World,rainEventId:string):MvpRainEpisode|null {
 if(Object.hasOwn(world,'simulationOnly')||world.mode!=='validation'||!world.id.startsWith('godot-mvp-'))return null;
 const climate=world.mvpClimate;
 if(!climate||climate.lastUs!==minuteToClimateUs(world.minute))return null;
 validateMvpRainProvenance(world.id,climate);
 const found=climate.rainProvenance?.recent.find(e=>e.rainEventId===rainEventId);
 return found?{...found}:null;
}

/** Store transition guard: no reset/rewind, overwriting a valid ID, or
 * retroactively adding facts by adopting on an already elapsed interval. */
export function assertMvpRainProvenanceAdvance(previous:World|null,next:World):void {
 const prior=previous?.mvpClimate,now=next.mvpClimate,p=prior?.rainProvenance,q=now?.rainProvenance;
 if(!p){
  if(q&&(q.recent.length!==0||q.adoptedUs!==now!.lastUs||
   previous!==null&&minuteToClimateUs(previous.minute)!==now!.lastUs))throw Error('mvp_rain_invalid_initialization');
  return;
 }
 if(!q||!now||!prior||now.seed!==prior.seed||q.adoptedUs!==p.adoptedUs)
  throw Error('mvp_rain_dependency_downgrade');
 const expected=advanceMvpRainProvenance(next.id,now.seed,p,prior.lastUs,now.lastUs);
 if(q.recent.length!==expected.recent.length||q.recent.some((e,i)=>!sameEpisode(e,expected.recent[i])))
  throw Error('mvp_rain_transition_mismatch');
}
