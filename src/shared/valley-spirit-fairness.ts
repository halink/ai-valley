import {createHash} from 'node:crypto';
import {validValleySpiritFruitFallReceipt,type MvpSpiritAppliedEffect,type ValleySpiritFruitFallReceipt} from './valley-spirit-effects.js';

const LIMIT = 4096; // wire/read bound, never a gameplay quota or retention policy
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u;
const OPPORTUNITY = /^fruit_fall:[a-f0-9]{64}$/u;
const EFFECT = /^valley-effect:[a-f0-9]{64}$/u;
const TARGET = /^ground:(0|[1-9][0-9]{0,8}):(0|[1-9][0-9]{0,8})$/u;
const natural = (v:unknown):v is number => typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const id = (v:unknown):v is string=>typeof v==='string'&&ID.test(v);
const effectId = (v:unknown):v is string=>typeof v==='string'&&EFFECT.test(v);
const targetId = (v:unknown):v is string=>typeof v==='string'&&TARGET.test(v);
const opportunityId = (v:unknown):v is string=>typeof v==='string'&&OPPORTUNITY.test(v);
const exact = (v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sha = (values:readonly string[])=>createHash('sha256').update(JSON.stringify(values)).digest('hex');

/** Shared only for stable indexing. A computed identity is not evidence. */
export const mvpFallenFruitDiscoveryId = (worldId:string,residentId:string,effectId:string):string =>
 'mvp-fruit-discovery:'+sha([worldId,residentId,effectId]);
/** A lot can be picked at most once, irrespective of competing resident or request. */
export const mvpFallenFruitPickupId = (worldId:string,effectId:string):string =>
 'mvp-fruit-pickup:'+sha([worldId,effectId]);

/** Advisory facts. Recording this mark says a location was proposed, never
 * that a resident was targeted, an effect was allowed, or fruit was created. */
export interface ValleySpiritProposalDirectionFact {
 readonly schemaVersion:1;
 readonly worldId:string;
 readonly proposalId:string;
 readonly opportunityId:string;
 readonly targetId:string;
 readonly proposedAtMicroMinute:number;
}
/** A durable record of an actual local sighting, not a generated sighting view.
 * Only a future authority may append this to the private observation ledger. */
export interface ValleySpiritFallenFruitDiscoveryFact {
 readonly schemaVersion:1;
 readonly worldId:string;
 readonly effectId:string;
 readonly residentId:string;
 readonly discoveryId:string;
 readonly targetId:string;
 readonly discoveredAtMicroMinute:number;
 readonly worldRevision:number;
}
/** Must come from the committed settlement that decremented the exact ground
 * lot and incremented the named resident's stock. Intent is not a receipt. */
export interface ValleySpiritFallenFruitPickupFact {
 readonly schemaVersion:1;
 readonly worldId:string;
 readonly effectId:string;
 readonly residentId:string;
 readonly discoveryId:string;
 readonly pickupId:string;
 readonly targetId:string;
 readonly settledAtMicroMinute:number;
 readonly worldRevision:number;
 readonly previousGroundCustody:'commons';
 readonly item:'fruit';
 readonly debitGroundFruit:1;
 readonly creditResidentFruit:1;
}

/** Versioned private fixture ledger. Original effect birth lots remain immutable;
 * availability is recomputed by subtracting exactly these pickup receipts. */
export interface MvpFallenFruitSettlementLedger {
 readonly schemaVersion:1;
 readonly worldId:string;
 readonly discoveries:readonly ValleySpiritFallenFruitDiscoveryFact[];
 readonly pickups:readonly ValleySpiritFallenFruitPickupFact[];
}

const PROPOSAL_KEYS=['schemaVersion','worldId','proposalId','opportunityId','targetId','proposedAtMicroMinute'] as const;
const DISCOVERY_KEYS=['schemaVersion','worldId','effectId','residentId','discoveryId','targetId','discoveredAtMicroMinute','worldRevision'] as const;
const PICKUP_KEYS=['schemaVersion','worldId','effectId','residentId','discoveryId','pickupId','targetId',
 'settledAtMicroMinute','worldRevision','previousGroundCustody','item','debitGroundFruit','creditResidentFruit'] as const;

export function validValleySpiritProposalDirectionFact(v:unknown):v is ValleySpiritProposalDirectionFact {
 return exact(v,PROPOSAL_KEYS)&&v.schemaVersion===1&&id(v.worldId)&&id(v.proposalId)&&
  opportunityId(v.opportunityId)&&targetId(v.targetId)&&natural(v.proposedAtMicroMinute);
}
export function validValleySpiritFallenFruitDiscoveryFact(v:unknown):v is ValleySpiritFallenFruitDiscoveryFact {
 return exact(v,DISCOVERY_KEYS)&&v.schemaVersion===1&&id(v.worldId)&&effectId(v.effectId)&&id(v.residentId)&&
  v.discoveryId===mvpFallenFruitDiscoveryId(v.worldId,v.residentId,v.effectId)&&targetId(v.targetId)&&
  natural(v.discoveredAtMicroMinute)&&natural(v.worldRevision);
}
export function validValleySpiritFallenFruitPickupFact(v:unknown):v is ValleySpiritFallenFruitPickupFact {
 return exact(v,PICKUP_KEYS)&&v.schemaVersion===1&&id(v.worldId)&&effectId(v.effectId)&&id(v.residentId)&&
  v.discoveryId===mvpFallenFruitDiscoveryId(v.worldId,v.residentId,v.effectId)&&
  v.pickupId===mvpFallenFruitPickupId(v.worldId,v.effectId)&&targetId(v.targetId)&&
  natural(v.settledAtMicroMinute)&&natural(v.worldRevision)&&v.previousGroundCustody==='commons'&&v.item==='fruit'&&
  v.debitGroundFruit===1&&v.creditResidentFruit===1;
}

export interface ValleySpiritFairnessInput {
 readonly worldId:string;
 /** Full, current, authority-projected records for this world. No World.events
  * arrays, fabricated resident views, or independently sliced time windows. */
 readonly proposalDirections:readonly ValleySpiritProposalDirectionFact[];
 readonly actualEffects:readonly ValleySpiritFruitFallReceipt[];
 readonly actualDiscoveries:readonly ValleySpiritFallenFruitDiscoveryFact[];
 readonly actualPickups:readonly ValleySpiritFallenFruitPickupFact[];
}
type Count = Readonly<{key:string;count:number}>;
export type ValleySpiritFairnessProjection =
 | {readonly status:'unavailable';readonly code:'invalid-or-incomplete-authoritative-facts'}
 | {readonly status:'ready';readonly schemaVersion:1;readonly worldId:string;readonly audience:'internal-audit';
  readonly proposalDirections:{readonly count:number;readonly byTarget:readonly Count[]};
  readonly actualEffects:{readonly count:number;readonly byTarget:readonly Count[]};
  readonly actualDiscoveries:{readonly count:number;readonly byResident:readonly Count[]};
  readonly actualPickups:{readonly count:number;readonly byResident:readonly Count[]};
 };

const unavailable = {status:'unavailable',code:'invalid-or-incomplete-authoritative-facts'} as const;
function body(v:object):string {
 const r=v as Record<string,unknown>;
 return JSON.stringify(Object.keys(r).sort().map(k=>[k,r[k]]));
}
function index<T extends {readonly worldId:string}>(values:readonly T[],worldId:string,
 valid:(v:unknown)=>v is T,key:(v:T)=>string):Map<string,T>|null {
 if(!Array.isArray(values)||values.length>LIMIT)return null;
 const out=new Map<string,T>();
 for(const v of values){
  if(!valid(v)||v.worldId!==worldId)return null;
  const id=key(v),seen=out.get(id);
  if(seen){if(body(seen)!==body(v))return null;}else out.set(id,v);
 }
 return out;
}
export function countValleySpiritFacts<T>(values:Iterable<T>,key:(v:T)=>string):Count[]{
 const agg=new Map<string,number>();
 for(const v of values){const k=key(v);agg.set(k,(agg.get(k)??0)+1);}
 return [...agg].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,count])=>({key,count}));
}

/** Read-only rebuild from explicitly committed records. Does not fill holes.
 * Missing optional proposal history never becomes a synthetic proposal.
 * A sighting/pickup without its effect or prior personal discovery cannot be
 * interpreted. No result here feeds resident awareness or world rules. */
export function projectValleySpiritFairness(input:ValleySpiritFairnessInput):ValleySpiritFairnessProjection {
 try{
  if(!input||!id(input.worldId))return unavailable;
  const {worldId}=input;
  const proposals=index(input.proposalDirections,worldId,validValleySpiritProposalDirectionFact,p=>p.proposalId);
  const effects=index(input.actualEffects,worldId,validValleySpiritFruitFallReceipt,e=>e.effectId);
  const discoveries=index(input.actualDiscoveries,worldId,validValleySpiritFallenFruitDiscoveryFact,d=>d.discoveryId);
  const pickups=index(input.actualPickups,worldId,validValleySpiritFallenFruitPickupFact,p=>p.pickupId);
  if(!proposals||!effects||!discoveries||!pickups)return unavailable;
  const usedOpportunity=new Set<string>(),usedProposal=new Set<string>();
  for(const e of effects.values()){
   if(e.ownerId!=='commons'||!targetId(e.targetId)||usedOpportunity.has(e.opportunityId)||usedProposal.has(e.proposalId))return unavailable;
   usedOpportunity.add(e.opportunityId);usedProposal.add(e.proposalId);
   const p=proposals.get(e.proposalId);
   if(p&&(p.opportunityId!==e.opportunityId||p.targetId!==e.targetId||p.proposedAtMicroMinute>e.committedAtMicroMinute))return unavailable;
  }
  for(const d of discoveries.values()){
   const e=effects.get(d.effectId);
   if(!e||e.targetId!==d.targetId||d.discoveredAtMicroMinute<e.committedAtMicroMinute)return unavailable;
  }
  const pickedEffect=new Map<string,ValleySpiritFallenFruitPickupFact>();
  for(const p of pickups.values()){
   const d=discoveries.get(p.discoveryId),e=effects.get(p.effectId);
   if(!d||!e||d.residentId!==p.residentId||d.effectId!==p.effectId||d.targetId!==p.targetId||e.ownerId!==p.previousGroundCustody||
     d.discoveredAtMicroMinute>p.settledAtMicroMinute||d.worldRevision>=p.worldRevision||pickedEffect.has(p.effectId))return unavailable;
   pickedEffect.set(p.effectId,p);
  }
  // A resident cannot discover a lot already removed in an earlier committed
  // revision. Later recollection belongs to a separate, private memory layer.
  for(const d of discoveries.values()){
   const p=pickedEffect.get(d.effectId);
   if(p&&(d.discoveredAtMicroMinute>p.settledAtMicroMinute||d.worldRevision>=p.worldRevision))return unavailable;
  }
  return {
   status:'ready',schemaVersion:1,worldId,audience:'internal-audit',
   proposalDirections:{count:proposals.size,byTarget:countValleySpiritFacts(proposals.values(),p=>p.targetId)},
   actualEffects:{count:effects.size,byTarget:countValleySpiritFacts(effects.values(),e=>e.targetId)},
   actualDiscoveries:{count:discoveries.size,byResident:countValleySpiritFacts(discoveries.values(),d=>d.residentId)},
   actualPickups:{count:pickups.size,byResident:countValleySpiritFacts(pickups.values(),p=>p.residentId)},
  };
 }catch{return unavailable;}
}

/** Shared lower-layer validation for active ground. Readers must separately
 * verify the immutable effect births/events and pass the same committed head. */
export function settledMvpFallenFruitEffectIds(
 worldId:string,worldRevision:number,nowMicroMinute:number,applied:readonly MvpSpiritAppliedEffect[],ledger:unknown,
):ReadonlySet<string>|null {
 if(!natural(worldRevision)||!natural(nowMicroMinute)||!exact(ledger,['schemaVersion','worldId','discoveries','pickups'])||
  ledger.schemaVersion!==1||ledger.worldId!==worldId||!Array.isArray(ledger.discoveries)||!Array.isArray(ledger.pickups)||
  ledger.discoveries.length>LIMIT||ledger.pickups.length>LIMIT)return null;
 const {discoveries,pickups}=ledger as unknown as MvpFallenFruitSettlementLedger;
 const fairness=projectValleySpiritFairness({worldId,proposalDirections:[],actualEffects:applied.map(a=>a.receipt),
  actualDiscoveries:discoveries,actualPickups:pickups});
 // Unlike a diagnostic projection, authoritative history cannot store duplicate rows.
 if(fairness.status!=='ready'||fairness.actualDiscoveries.count!==discoveries.length||fairness.actualPickups.count!==pickups.length||
  discoveries.some(f=>f.worldRevision>worldRevision||f.discoveredAtMicroMinute>nowMicroMinute)||
  pickups.some(f=>f.worldRevision>worldRevision||f.settledAtMicroMinute>nowMicroMinute))return null;
 const committedRevision=new Map(applied.map(a=>[a.receipt.effectId,Number(a.eventId.slice(a.eventId.lastIndexOf(':')+1))]));
 const usedRevision=new Set<number>(committedRevision.values());
 let last=0;
 for(const f of discoveries){
  const predecessor=committedRevision.get(f.effectId);
  if(predecessor===undefined||f.worldRevision<=predecessor||f.worldRevision<=last||usedRevision.has(f.worldRevision))return null;
  last=f.worldRevision;usedRevision.add(last);
 }
 last=0;
 for(const f of pickups){
  if(f.worldRevision<=last||usedRevision.has(f.worldRevision))return null;
  last=f.worldRevision;usedRevision.add(last);
 }
 const chronological=[
  ...discoveries.map(f=>({revision:f.worldRevision,minute:f.discoveredAtMicroMinute})),
  ...pickups.map(f=>({revision:f.worldRevision,minute:f.settledAtMicroMinute})),
 ].sort((a,b)=>a.revision-b.revision);
 if(chronological.some((f,i)=>i>0&&f.minute<chronological[i-1].minute))return null;
 return new Set(pickups.map(p=>p.effectId));
}
