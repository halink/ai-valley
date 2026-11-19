import {createHash} from 'node:crypto';
import type {World} from '../shared/types.js';
import {DAY} from './time.js';

const LIMIT=64;
type Weather=World['weather'];
interface Boundary {episodeId:string;startedMinute:number}
export interface FormalRainEpisode extends Boundary {closedMinute:number}
export interface FormalRainProvenance {
 version:1;worldId:string;adoptedMinute:number;
 open:Boundary|null;
 closed:FormalRainEpisode[];
}
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const native=(w:World)=>w.mode==='formal'&&typeof w.id==='string'&&/^valley-formal-[a-zA-Z0-9_-]{1,180}$/.test(w.id)&&
 !Object.hasOwn(w,'simulationOnly')&&!w.mvpClimate&&(w.weather==='rain'||w.weather==='sun');
export const formalNativeRainEpisodeId=(worldId:string,startedMinute:number)=>'formal-rain:'+createHash('sha256')
 .update(JSON.stringify([worldId,Math.floor(startedMinute/DAY)])).digest('hex');

export function emptyFormalRainProvenance(w:World):FormalRainProvenance {
 if(!native(w)||!minute(w.minute))throw Error('formal_rain_world_scope');
 return {version:1,worldId:w.id,adoptedMinute:w.minute,open:null,closed:[]};
}

export function validateFormalRainProvenance(w:World):void {
 if(!Object.hasOwn(w,'formalRainProvenance'))return;
 const state=w.formalRainProvenance;
 if(!native(w)||!minute(w.minute)||!state||!exact(state,['version','worldId','adoptedMinute','open','closed'])||
  state.version!==1||state.worldId!==w.id||!minute(state.adoptedMinute)||state.adoptedMinute>w.minute||
  !Array.isArray(state.closed)||state.closed.length>LIMIT)throw Error('formal_rain_unknown_state');
 let prior=state.adoptedMinute;
 const check=(b:Boundary,keys:string[])=>exact(b,keys)&&minute(b.startedMinute)&&b.startedMinute>prior&&
  b.startedMinute<=w.minute&&b.episodeId===formalNativeRainEpisodeId(w.id,b.startedMinute);
 for(const x of state.closed){
  if(!x||!check(x,['episodeId','startedMinute','closedMinute'])||!minute(x.closedMinute)||
   Math.floor(x.closedMinute/DAY)<=Math.floor(x.startedMinute/DAY)||x.closedMinute>w.minute)
   throw Error('formal_rain_bad_episode');
  prior=x.closedMinute;
 }
 if(state.open!==null&&(!state.open||!check(state.open,['episodeId','startedMinute'])||w.weather!=='rain'))
  throw Error('formal_rain_bad_open');
}

interface Evidence {from:number;through:number;before:FormalRainProvenance;after:FormalRainProvenance;startWeather:Weather;endWeather:Weather}
const observed=new WeakMap<World,Evidence>();
export function forgetFormalRainStep(w:World):void {observed.delete(w);}

export function beginFormalRainStep(w:World):(()=>void)|undefined {
 if(Object.hasOwn(w,'simulationOnly')||!Object.hasOwn(w,'formalRainProvenance'))return;
 validateFormalRainProvenance(w);
 if(w.clock.paused)return;
 const from=w.minute,before=structuredClone(w.formalRainProvenance!),startWeather=w.weather;
 const old=observed.get(w);
 // Merge real adjacent step calls on the same draft, not reattached objects.
 const prior=old&&old.through===from&&old.endWeather===startWeather&&same(old.after,before)?old:undefined;
 return ()=>{
  validateFormalRainProvenance(w);
  observed.set(w,{from:prior?.from??from,through:w.minute,before:prior?.before??before,
   after:structuredClone(w.formalRainProvenance!),startWeather:prior?.startWeather??startWeather,endWeather:w.weather});
 };
}

/** Called only at the engine's real daily weather assignment, not from plans,
 * snapshots, forecasts or a historical reconstruction. */
export function observeFormalRainEdge(w:World,previousWeather:Weather):void {
 const s=w.formalRainProvenance;
 if(!s||Object.hasOwn(w,'simulationOnly')||previousWeather===w.weather)return;
 if(!native(w)||w.clock.paused)throw Error('formal_rain_invalid_engine_edge');
 if(w.weather==='rain'){
  s.open={episodeId:formalNativeRainEpisodeId(w.id,w.minute),startedMinute:w.minute};
 }else if(s.open){
  s.closed=[...s.closed,{...s.open,closedMinute:w.minute}].slice(-LIMIT);
  s.open=null;
 }
}

export function assertFormalRainProvenanceCommit(previous:World|null,next:World,enabled:boolean):void {
 const before=previous?.formalRainProvenance,after=next.formalRainProvenance;
 if(!before&&!after)return;
 if(!enabled||!after||!previous||previous.id!==next.id)throw Error('formal_rain_store_scope');
 if(!before){
  if(next.minute!==previous.minute||next.weather!==previous.weather||next.revision!==previous.revision+1||
   !same(after,emptyFormalRainProvenance(previous)))throw Error('formal_rain_invalid_adoption');
  return;
 }
 if(next.minute<previous.minute||next.revision<previous.revision)throw Error('formal_rain_rewind');
 if(next.minute===previous.minute){
  if(next.weather!==previous.weather||!same(before,after))throw Error('formal_rain_invalid_static_change');
  return;
 }
 const proof=observed.get(next);
 if(next.revision<=previous.revision||previous.clock.paused||!proof||proof.from!==previous.minute||proof.through!==next.minute||
  proof.startWeather!==previous.weather||proof.endWeather!==next.weather||!same(proof.before,before)||!same(proof.after,after))
  throw Error('formal_rain_unconfirmed_step');
}
