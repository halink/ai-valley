import {createHash} from 'node:crypto';
import type {Vec,World} from '../shared/types.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {canInstallEmptyOrdinaryAgedGround} from './valley-spirit-ordinary-aged-ground.js';
import {currentClosedRain} from './valley-spirit-persistent-rules-shadow.js';
import {valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';
import type {openRulesNativeMultiFruitLease} from './valley-spirit-rules-fruit-renewal.js';
import type {ValleySpiritJournal} from './valley-spirit.js';
const exact=(v:unknown,k:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type OrdinaryMultiCandidatePin=Readonly<{scope:'ordinary-native-multi-candidate-preview/v1';worldId:string;maxAgeGameMinutes:number;
 sites:readonly Readonly<{sourceId:string;target:Readonly<Vec>}>[]}>;
type LotBasis=NonNullable<ReturnType<ReturnType<typeof openRulesNativeMultiFruitLease>['inspect']>>;
export type CandidateJournal=Pick<ValleySpiritJournal,'currentObservedRainPacket'|'isCurrentPublicInput'>;
export function pinOrdinaryMultiCandidate(v:unknown):OrdinaryMultiCandidatePin|null{
 try{
  const p=structuredClone(v);
  if(!exact(p,['scope','worldId','maxAgeGameMinutes','sites'])||p.scope!=='ordinary-native-multi-candidate-preview/v1'||
   typeof p.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(p.worldId)||!int(p.maxAgeGameMinutes,1,120)||
   !Array.isArray(p.sites)||p.sites.length<2||p.sites.length>4||!p.sites.every(s=>exact(s,['sourceId','target'])&&
    typeof s.sourceId==='string'&&/^mvp-supply-fruit-[0-9]{1,12}$/.test(s.sourceId)&&exact(s.target,['x','y'])&&
    int(s.target.x,0,4095)&&int(s.target.y,0,4095))||
   new Set(p.sites.map(s=>s.sourceId)).size!==p.sites.length||new Set(p.sites.map(s=>s.target.x+':'+s.target.y)).size!==p.sites.length)return null;
  const sites=p.sites.map(s=>Object.freeze({sourceId:s.sourceId as string,target:Object.freeze({x:s.target.x as number,y:s.target.y as number})}))
   .sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
  return Object.freeze({scope:p.scope,worldId:p.worldId,maxAgeGameMinutes:p.maxAgeGameMinutes,sites:Object.freeze(sites)});
 }catch{return null;}
}

/** Operator-owned read only: no physical ground capability, state or queue is created. */
export function buildOrdinaryMultiCandidatePreview(w:World,p:OrdinaryMultiCandidatePin,lots:LotBasis,journal:CandidateJournal){
 try{
  const atUs=minuteToClimateUs(w.minute);
  if(w.id!==p.worldId||w.id!==lots.worldId||w.revision!==lots.revision||atUs!==lots.atUs||
   BigInt(atUs)%60_000_000n!==0n||w.clock.paused||Object.hasOwn(w,'mvpSeasonalModelVersion'))return null;
  const rain=currentClosedRain(w,p.maxAgeGameMinutes);
  if(!rain)return null;
  const archived=journal.currentObservedRainPacket(BigInt(rain.firstRainUs),BigInt(rain.endedUs));
  if(!archived||archived.worldId!==w.id||archived.sourceRefs.length!==1||archived.records.length!==1||
   archived.records[0].fact.worldRevision>w.revision||!journal.isCurrentPublicInput(archived))return null;
  const timeLimit=BigInt(rain.endedUs)+BigInt(p.maxAgeGameMinutes)*1_000_000n;
  const rows=p.sites.flatMap(site=>{
   const lot=lots.lots.find(l=>l.sourceId===site.sourceId),geo=inspectMvpGroundFruitGeography(w,site.sourceId,site.target);
   if(!lot||!geo||geo.source.resourceInstanceId!==('mvp-fruit:'+site.sourceId+':'+lot.sourceAt.x+':'+lot.sourceAt.y)||
    geo.source.ownerId!=='commons'||!canInstallEmptyOrdinaryAgedGround(w,{scope:'ordinary-empty-aged-ground/v1',
    worldId:w.id,sourceId:site.sourceId,target:site.target}))return [];
   const until=BigInt(lot.lot.expiresUs)<timeLimit?BigInt(lot.lot.expiresUs):timeLimit;
   if(until<=BigInt(atUs)||BigInt(lot.lot.bornUs)>BigInt(atUs))return [];
   return [{opportunityId:valleySpiritFruitFallOpportunityId(w.id,rain.rainEventId,geo.source.resourceInstanceId),
    lotId:lot.lot.id,sourceId:site.sourceId,sourceInstanceId:geo.source.resourceInstanceId,ownerId:geo.source.ownerId,
    targetId:geo.targetId,eligibleUntilUs:until.toString()}];
  });
  if(rows.length<2||new Set(rows.map(r=>r.opportunityId)).size!==rows.length||!journal.isCurrentPublicInput(archived))return null;
  const offers=Object.freeze(rows.map((r,i)=>Object.freeze({number:i+1,...r})));
  const snapshot=hash([p,w.id,w.revision,atUs,rain,archived,offers,lots]);
  const numbered=Object.freeze({schema:'ordinary-native-candidate-numbered-preview/v1' as const,
   options:Object.freeze(offers.map(o=>Object.freeze({number:o.number,kind:'ripe-fruit-after-rain' as const})))});
  return Object.freeze({status:'candidate-menu-preview-only' as const,snapshot,headRevision:w.revision,
   permissionVersion:archived.permissionVersion,offers,numbered,selectionAuthorized:false as const,executionAuthorized:false as const,
   groundCapability:false as const});
 }catch{return null;}
}
