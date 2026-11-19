import {createHash} from 'node:crypto';
import type {MvpGroundFruitState} from '../shared/mvp-ground-fruit.js';
import type {Vec, World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {inspectMvpGroundFruitPlacement, type MvpGroundFruitCapacity} from '../world/mvp-ground-fruit.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {
 isEnabledValleySpiritFruitFallPolicy, isValleySpiritFruitFallProposal, proposeValleySpiritFruitFall,
 valleySpiritFruitFallOpportunityId, type ValleySpiritFruitFallEvidence,
 type ValleySpiritFruitFallOption, type ValleySpiritFruitFallPolicy,
} from './valley-spirit-proposal.js';
import type {ValleySpiritShadowEvidenceReader} from './valley-spirit-shadow-queue.js';
import type {ValleySpiritJournal} from './valley-spirit.js';

const VERSION = 'valley-spirit-fruit-fall-offer-v1';
const MAX_SITES = 16; // input shape bound, not an available game quota
const MAX_REFS = 16;
const token = (v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u.test(v);
const natural = (v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact = (v:unknown,keys:readonly string[]):boolean=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

export interface ValleySpiritShadowSite {
 readonly sourceId:string;
 readonly target:Readonly<Vec>;
}
export interface ValleySpiritShadowManifest {
 readonly worldId:string;
 readonly menuVersion:string;
 readonly rainEventId:string;
 readonly publicWeatherRefs:readonly string[];
 readonly validFromMicroMinute:number;
 readonly validUntilMicroMinute:number;
 readonly sites:readonly ValleySpiritShadowSite[];
 readonly capacity:Readonly<MvpGroundFruitCapacity>;
 readonly policy:ValleySpiritFruitFallPolicy;
}
type Journal = Pick<ValleySpiritJournal,'publicNarrationInput'|'isCurrentPublicInput'>;
type GroundFacts = NonNullable<ReturnType<typeof inspectMvpGroundFruitPlacement>>;
type ReceiptFacts = {
 readonly opportunityConsumed:boolean;
 readonly proposalQuotaAvailable:boolean;
 readonly lastCommittedFruitFallMicroMinute:number|null;
};
export interface ValleySpiritShadowOfferReads {
 /** Committed head only. A request projection or a simulation clone is not authoritative. */
 readonly readCommittedWorld:()=>World;
 /** Required detached ground-lot view corresponding to this exact committed head. */
 readonly readGroundFruit:(worldId:string,revision:number)=>MvpGroundFruitState|undefined;
 readonly journal:Journal;
 /** Required for assessment. May only consult committed quota and receipt evidence for this exact head. */
 readonly readReceiptFacts?:(request:{
  readonly worldId:string;readonly revision:number;readonly opportunityId:string;
 })=>ReceiptFacts|undefined;
}
export interface ValleySpiritShadowOffer {
 readonly option:ValleySpiritFruitFallOption;
 readonly availability:'missing_ground_capabilities'|'shadow_preflight_only';
}
export type ValleySpiritShadowOffers =
 | {readonly status:'unavailable'}
 | {readonly status:'ready';readonly offers:readonly ValleySpiritShadowOffer[];readonly reader:ValleySpiritShadowEvidenceReader};

const unavailable = {status:'unavailable'} as const;

function validManifest(m:ValleySpiritShadowManifest):boolean {
 return exact(m,['worldId','menuVersion','rainEventId','publicWeatherRefs','validFromMicroMinute','validUntilMicroMinute',
  'sites','capacity','policy'])&&token(m.worldId)&&token(m.menuVersion)&&token(m.rainEventId)&&
  natural(m.validFromMicroMinute)&&natural(m.validUntilMicroMinute)&&m.validFromMicroMinute<m.validUntilMicroMinute&&
  Array.isArray(m.publicWeatherRefs)&&m.publicWeatherRefs.length>=1&&m.publicWeatherRefs.length<=MAX_REFS&&
  [...m.publicWeatherRefs].every(r=>typeof r==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,399}$/u.test(r))&&
  new Set(m.publicWeatherRefs).size===m.publicWeatherRefs.length&&isEnabledValleySpiritFruitFallPolicy(m.policy)&&
  exact(m.capacity,['worldLots','lotsPerTarget'])&&natural(m.capacity.worldLots)&&natural(m.capacity.lotsPerTarget)&&
  m.capacity.worldLots>=1&&m.capacity.worldLots<=4096&&m.capacity.lotsPerTarget>=1&&m.capacity.lotsPerTarget<=m.capacity.worldLots&&
  Array.isArray(m.sites)&&m.sites.length>=1&&m.sites.length<=MAX_SITES&&[...m.sites].every(s=>exact(s,['sourceId','target'])&&
    token(s.sourceId)&&exact(s.target,['x','y'])&&natural(s.target.x)&&natural(s.target.y))&&
  new Set(m.sites.map(s=>JSON.stringify([s.sourceId,s.target.x,s.target.y]))).size===m.sites.length;
}

/** Both pinned facts and placement are recaptured at read time. The journal
 * grants identifying weather records only and never becomes authority for rain. */
function captureHead(reads:ValleySpiritShadowOfferReads,m:ValleySpiritShadowManifest) {
 const w=reads.readCommittedWorld();
 if(!w||w.simulationOnly||w.id!==m.worldId||w.mode!=='validation'||!natural(w.revision))return null;
 const nowMicroMinute=Number(minuteToClimateUs(w.minute));
 if(!natural(nowMicroMinute))return null;
 const rain=resolveMvpRainEpisode(w,m.rainEventId);
 const packet=reads.journal.publicNarrationInput(m.publicWeatherRefs);
 if(!packet||packet.worldId!==m.worldId||packet.mode!=='public-weather-only'||
  packet.sourceRefs.length!==m.publicWeatherRefs.length||
  packet.sourceRefs.some((ref,i)=>ref!==m.publicWeatherRefs[i])||
  !natural(packet.permissionVersion)||packet.permissionVersion<1||!reads.journal.isCurrentPublicInput(packet))return null;
 const ground=reads.readGroundFruit(w.id,w.revision);
 if(!ground)return null;
 return {w,nowMicroMinute,rain,packet,ground};
}

function statusOf(target:GroundFacts['target']):ValleySpiritShadowOffer['availability'] {
 return target.supportsGroundFood&&target.supportsDiscovery&&target.supportsPickup
  ?'shadow_preflight_only':'missing_ground_capabilities';
}

function pinOption(
 m:ValleySpiritShadowManifest,site:ValleySpiritShadowSite,head:NonNullable<ReturnType<typeof captureHead>>,
 sourceResourceInstanceId:string,targetId:string,
):ValleySpiritFruitFallOption {
 // Versionless opportunity ID is computed by proposal policy. This separate
 // input pin binds exact allowed fields, policy, capacity and landing site.
 const p=head.packet;
 const inputSnapshotId='valley-offer:'+createHash('sha256').update(JSON.stringify([
  VERSION,m.worldId,m.menuVersion,m.rainEventId,p.projectionVersion,p.permissionVersion,p.sourceRefs,
  p.records.map(e=>[e.sourceRef,e.fact.atUs,e.fact.worldRevision,e.fact.condition,e.fact.temperatureDeciC,
   e.fact.relativeHumidityPermille,e.fact.cloudPermille,e.fact.windPermille,e.fact.daylightPermille,e.fact.precipitationPermille]),
  site.sourceId,site.target.x,site.target.y,sourceResourceInstanceId,targetId,
  m.validFromMicroMinute,m.validUntilMicroMinute,
  m.capacity.worldLots,m.capacity.lotsPerTarget,m.policy.version,m.policy.maxAgeGameMinutes,m.policy.minimumCooldownGameMinutes,
 ])).digest('hex');
 return Object.freeze({
  worldId:m.worldId,menuVersion:m.menuVersion,inputSnapshotId,permissionVersion:p.permissionVersion,
  sourceRefs:Object.freeze([...p.sourceRefs]),rainEventId:m.rainEventId,sourceResourceInstanceId,
  targetId,quantity:1,validFromMicroMinute:m.validFromMicroMinute,validUntilMicroMinute:m.validUntilMicroMinute,
 });
}

/** No reads if not configured. No discovery, pick-up, dispatch, storage or
 * effect authority is created, even if all future capabilities become true. */
export function prepareValleySpiritShadowOffers(
 reads:ValleySpiritShadowOfferReads, manifest?:ValleySpiritShadowManifest,
):ValleySpiritShadowOffers {
 try {
  if(!manifest)return unavailable;
  const m=structuredClone(manifest);
  if(!validManifest(m))return unavailable;
  const head=captureHead(reads,m);
  if(!head||!head.rain||head.nowMicroMinute>=m.validUntilMicroMinute)return unavailable;
  const age=BigInt(head.nowMicroMinute)-BigInt(head.rain.endedUs);
  if(age<0n||age>BigInt(m.policy.maxAgeGameMinutes)*1_000_000n)return unavailable;
  const pins=new Map<string,{site:ValleySpiritShadowSite;option:ValleySpiritFruitFallOption}>();
  const offers:ValleySpiritShadowOffer[]=[];
  for(const site of m.sites){
   const facts=inspectMvpGroundFruitPlacement(head.w,head.ground,site.sourceId,site.target,m.capacity);
   if(!facts)continue;
   const option=pinOption(m,site,head,facts.source.resourceInstanceId,facts.target.id);
   if(proposeValleySpiritFruitFall('offer-check',[option],{optionNumber:1,rationale:'internal validation'}).status!=='proposed')
    return unavailable;
   pins.set(option.inputSnapshotId,{site,option});
   offers.push(Object.freeze({option,availability:statusOf(facts.target)}));
  }
  return {status:'ready',offers:Object.freeze(offers),reader:{
   readFruitFallEvidence(proposal){
    try{
     if(!isValleySpiritFruitFallProposal(proposal))return;
     const pin=pins.get(proposal.inputSnapshotId);
     if(!pin)return;
     const again=captureHead(reads,m);
     if(!again||again.packet.permissionVersion!==pin.option.permissionVersion)return;
     // Detect even a same-version journal record mismatch with the original pin,
     // without assuming the landing tile or source remains eligible.
     const expected=pinOption(m,pin.site,again,pin.option.sourceResourceInstanceId,pin.option.targetId);
     if(expected.inputSnapshotId!==pin.option.inputSnapshotId)return;
     const f=inspectMvpGroundFruitPlacement(again.w,again.ground,pin.site.sourceId,pin.site.target,m.capacity);
     const exactTarget=f?.target.id===pin.option.targetId&&f.source.resourceInstanceId===pin.option.sourceResourceInstanceId?f:undefined;
     const opportunityId=valleySpiritFruitFallOpportunityId(m.worldId,m.rainEventId,pin.option.sourceResourceInstanceId);
     const receipt=reads.readReceiptFacts?.({worldId:m.worldId,revision:again.w.revision,opportunityId});
     return {
      worldId:m.worldId,nowMicroMinute:again.nowMicroMinute,
      approvedBasis:{inputSnapshotId:pin.option.inputSnapshotId,menuVersion:m.menuVersion,permissionVersion:again.packet.permissionVersion,
       sourceRefs:[...again.packet.sourceRefs],offeredOption:pin.option},
      rain:again.rain?{type:'committed_actual_rain',worldId:m.worldId,rainEventId:again.rain.rainEventId,endedUs:again.rain.endedUs}:undefined,
      source:exactTarget?.source,target:exactTarget?.target,
      opportunityConsumed:receipt?.opportunityConsumed,proposalQuotaAvailable:receipt?.proposalQuotaAvailable,
      lastCommittedFruitFallMicroMinute:receipt?.lastCommittedFruitFallMicroMinute,
     } satisfies ValleySpiritFruitFallEvidence;
    }catch{return undefined;}
   },
  }};
 }catch{return unavailable;}
}
