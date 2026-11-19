import {FORMAL_HEIGHT,FORMAL_WIDTH} from '../shared/formal-regions.js';
import {pastureEdgeOpen} from '../shared/pasture-access.js';
import type {Vec,World} from '../shared/types.js';
import {distance,reachableTilesFrom,walkable} from '../world/navigation.js';
import {DAY} from '../world/time.js';
import {WorldStore} from './store.js';
import {formalBerryCommonGround} from '../world/formal-berry-location.js';

const MAX_SITES=8,MAX_MAP_AREA=FORMAL_WIDTH*FORMAL_HEIGHT,MAX_AGE=28*DAY; // audit bounds, not production policy
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

export interface FormalRainShadowEligibilityOptions {
 readonly scope:'formal-rain-geography-shadow-only';
 readonly enabled:boolean;
 readonly worldId:string;
 readonly episodeId:string;
 readonly maxAgeGameMinutes:number;
 readonly sites:readonly {readonly sourceId:string;readonly target:Readonly<Vec>}[];
}

function point(w:World,p:Vec):boolean {
 return exact(p,['x','y'])&&nat(p.x)&&nat(p.y)&&p.x<w.map.width&&p.y<w.map.height;
}

/** Physical availability only: no resident awareness, no actual effect state,
 * no budget, no selection menu, and no conversion to an executable proposal. */
export function readFormalRainShadowBasis(store:WorldStore,options?:FormalRainShadowEligibilityOptions){
 if(options?.enabled!==true)return {status:'disabled'} as const;
 const unavailable={status:'unavailable'} as const;
 try{
  if(!(store instanceof WorldStore)||!Array.isArray(options.sites)||options.sites.length>MAX_SITES)return unavailable;
  const o=structuredClone(options);
  if(!exact(o,['scope','enabled','worldId','episodeId','maxAgeGameMinutes','sites'])||
   o.scope!=='formal-rain-geography-shadow-only'||!/^valley-formal-[A-Za-z0-9_-]{1,180}$/.test(o.worldId)||
   !/^formal-rain:[a-f0-9]{64}$/.test(o.episodeId)||!nat(o.maxAgeGameMinutes)||o.maxAgeGameMinutes<1||
   o.maxAgeGameMinutes>MAX_AGE||!Array.isArray(o.sites)||!o.sites.length||o.sites.length>MAX_SITES)return unavailable;
  const head=WorldStore.prototype.readCommittedFormalRainHead.call(store,o.worldId,o.episodeId);
  if(!head)return unavailable;
  const {world:w,episode}=head;
  if(w.clock.paused||w.weather!=='sun'||w.formalRainProvenance?.open||
   w.formalRainProvenance?.closed.at(-1)?.episodeId!==episode.episodeId||
   w.minute-episode.closedMinute>o.maxAgeGameMinutes||w.minute<episode.closedMinute)return unavailable;
  if(!nat(w.map.width)||!nat(w.map.height)||w.map.width*w.map.height>MAX_MAP_AREA||
   !Array.isArray(w.map.tiles)||w.map.tiles.length!==w.map.width*w.map.height||
   !point(w,w.map.entrance)||!walkable(w,w.map.entrance)||[...o.sites].some(s=>
    !s||!exact(s,['sourceId','target'])||typeof s.sourceId!=='string'||!/^bush-\d{1,8}-\d{1,8}$/.test(s.sourceId)||!point(w,s.target)))
   return unavailable;
  const ground=formalBerryCommonGround(w);
  if(ground.unsafe(w.map.entrance))return unavailable;
  const reach=reachableTilesFrom(w,w.map.entrance),idx=(p:Vec)=>p.y*w.map.width+p.x;
  const seen=new Set<string>(),offers=[];
  for(const {sourceId,target} of o.sites){
   const matching=w.resources.filter(r=>r.id===sourceId);
   if(matching.length!==1)continue;
   const r=matching[0];
   if(r.kind!=='bush'||r.foodItem!==undefined||!point(w,r.at)||r.id!==`bush-${r.at.x}-${r.at.y}`||
    !nat(r.amount)||r.amount<1||!nat(r.max)||r.amount>r.max||!ground.common(r.at)||!walkable(w,r.at)||
    !ground.landing(target)||distance(r.at,target)!==1||
    !pastureEdgeOpen(w,r.at,target)||!reach[idx(r.at)]||!reach[idx(target)])continue;
   const key=JSON.stringify([sourceId,target.x,target.y]);if(seen.has(key))continue;seen.add(key);
   offers.push({kind:'formal-wild-berry-geography' as const,sourceId,target:{...target},
    harvestableBerryUnits:r.amount,quantityForEligibility:1 as const,executionAuthorized:false as const,
    groundEffectCapability:'not-installed' as const});
  }
  return {status:'geography_only' as const,worldId:w.id,revision:w.revision,atMinute:w.minute,
   rainEpisodeId:episode.episodeId,offers,head};
 }catch{return unavailable;}
}

/** Narrow geography-only view; the detached native draft adapter consumes the
 * internal same-head basis above instead of reimplementing any site checks. */
export function readFormalRainShadowEligibility(store:WorldStore,options?:FormalRainShadowEligibilityOptions){
 const basis=readFormalRainShadowBasis(store,options);
 if(basis.status!=='geography_only')return basis;
 const {head:_internal,...view}=basis;return view;
}
