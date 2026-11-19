import type {Vec,World} from '../shared/types.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';
import type {PublicWeatherNarrationInput,ValleySpiritJournal} from './valley-spirit.js';

const MAX_SITES=16,UNIT=1_000_000n;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const bounded=(v:unknown,min:number,max:number):v is number=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
export interface PersistentRulesShadowOptions{
 readonly scope:'persistent-rules-geography-only/v1';readonly enabled:true;
 readonly cadenceGameMinutes:number;readonly maxAgeGameMinutes:number;
 readonly sites:readonly {readonly sourceId:string;readonly target:Readonly<Vec>}[];
}
export function pinPersistentRulesShadowOptions(input:unknown):PersistentRulesShadowOptions|null{
 try{
  const v:unknown=structuredClone(input);
  if(!exact(v,['scope','enabled','cadenceGameMinutes','maxAgeGameMinutes','sites'])||
   v.scope!=='persistent-rules-geography-only/v1'||v.enabled!==true||!bounded(v.cadenceGameMinutes,1,60)||
   !bounded(v.maxAgeGameMinutes,1,1440)||!Array.isArray(v.sites)||!v.sites.length||v.sites.length>MAX_SITES||
   !v.sites.every(s=>exact(s,['sourceId','target'])&&typeof s.sourceId==='string'&&/^[A-Za-z0-9:_-]{1,200}$/u.test(s.sourceId)&&
    exact(s.target,['x','y'])&&bounded(s.target.x,0,4095)&&bounded(s.target.y,0,4095)))return null;
  if(new Set(v.sites.map(({sourceId,target})=>JSON.stringify([sourceId,target.x,target.y]))).size!==v.sites.length)return null;
  return v as unknown as PersistentRulesShadowOptions;
 }catch{return null;}
}
interface Sample {
 readonly rainId:string;readonly site:PersistentRulesShadowOptions['sites'][number];
 readonly packet:PublicWeatherNarrationInput;readonly sourceResourceInstanceId:string;readonly targetId:string;
}
type Authority=Pick<ValleySpiritJournal,'currentObservedRainPacket'|'isCurrentPublicInput'>;
function currentClosedRain(w:World,maxAge:number){
 if(w.mode!=='validation'||w.clock.paused||w.simulationOnly||!w.mvpClimate||
  w.mvpClimate.current.precipitationPermille>0)return null;
 const recent=w.mvpClimate.rainProvenance?.recent.at(-1);
 if(!recent)return null;
 const rain=resolveMvpRainEpisode(w,recent.rainEventId);
 if(!rain)return null;
 const age=BigInt(minuteToClimateUs(w.minute))-BigInt(rain.endedUs);
 return age>=0n&&age<BigInt(maxAge)*UNIT?rain:null;
}
/** In-memory advisory sampling only, never a proposal/ground or queue writer.
 * Optional failure does not propagate to the post-commit world hook. */
export function createPersistentRulesShadow(config:PersistentRulesShadowOptions,journal:Authority){
 let next=0,lastRain:string|undefined,sample:Sample|null=null;
 const onCommitted=(w:World)=>{
  try{
   if(w.clock.paused)return;
   const now=w.minute,latest=w.mvpClimate?.rainProvenance?.recent.at(-1)?.rainEventId;
   if(now<next&&latest===lastRain)return;
   next=now+config.cadenceGameMinutes;lastRain=latest;sample=null;
   const rain=currentClosedRain(w,config.maxAgeGameMinutes);if(!rain)return;
   const packet=journal.currentObservedRainPacket(BigInt(rain.firstRainUs),BigInt(rain.endedUs));
   if(!packet||packet.worldId!==w.id||!journal.isCurrentPublicInput(packet)||
    packet.records.some(r=>r.fact.worldRevision>w.revision))return;
   for(const site of config.sites){
    const geo=inspectMvpGroundFruitGeography(w,site.sourceId,site.target);
    if(!geo)continue;
    sample={rainId:rain.rainEventId,site,packet,sourceResourceInstanceId:geo.source.resourceInstanceId,targetId:geo.targetId};break;
   }
  }catch{sample=null;}
 };
 const read=(w:World)=>{
  try{
   const p=sample,rain=currentClosedRain(w,config.maxAgeGameMinutes);
   if(!p||!rain||rain.rainEventId!==p.rainId||w.id!==p.packet.worldId||!journal.isCurrentPublicInput(p.packet))
    return {status:'unavailable'} as const;
   const geo=inspectMvpGroundFruitGeography(w,p.site.sourceId,p.site.target);
   if(!geo||geo.source.resourceInstanceId!==p.sourceResourceInstanceId||geo.targetId!==p.targetId)
    return {status:'unavailable'} as const;
   return {status:'geography_only',availability:'missing_ground_capabilities',executionAuthorized:false,
    worldId:w.id,revision:w.revision,atUs:minuteToClimateUs(w.minute),rainEventId:rain.rainEventId,
    permissionVersion:p.packet.permissionVersion,sourceRefs:[...p.packet.sourceRefs],sourceResourceInstanceId:p.sourceResourceInstanceId,
    targetId:p.targetId,opportunityId:valleySpiritFruitFallOpportunityId(w.id,rain.rainEventId,p.sourceResourceInstanceId),
    optionNumber:1,
   } as const;
  }catch{return {status:'unavailable'} as const;}
 };
 return {onCommitted,read};
}
