import {createHash} from 'node:crypto';
import type {Vec,World} from '../shared/types.js';
import {formalNativeRainEpisodeId,type FormalRainEpisode} from '../world/formal-rain-provenance.js';
import {readFormalRainShadowBasis,type FormalRainShadowEligibilityOptions} from './valley-spirit-formal-eligibility.js';
import type {WorldStore} from './store.js';

const SCOPE='formal-berry-detached-draft';
const SIDE=4096;
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const min=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const samePoint=(a:Vec,b:Vec)=>a.x===b.x&&a.y===b.y;
const hash=(values:unknown[])=>createHash('sha256').update(JSON.stringify(values)).digest('hex');
export const formalBerryOpportunityId=(worldId:string,rainId:string,sourceId:string)=>'formal-berry:'+hash([worldId,rainId,sourceId]);

interface Capacity {worldLots:number;lotsPerTarget:number}
export interface FormalBerryDetachedReceipt {
 readonly schemaVersion:1;
 readonly draftId:string;
 readonly item:'berry';
 readonly ownerId:'commons';
 readonly rain:Readonly<FormalRainEpisode>;
 readonly placedMinute:number;
 readonly atRevision:number;
 readonly sourceId:string;
 readonly sourceAt:Readonly<Vec>;
 readonly sourceBefore:number;
 readonly sourceAfter:number;
 readonly target:Readonly<Vec>;
 readonly groundCredit:1;
}
export interface FormalBerryDetachedLedger {
 readonly schemaVersion:1;
 readonly worldId:string;
 readonly rainAdoptedMinute:number;
 readonly capacity:Readonly<Capacity>;
 readonly drafts:readonly FormalBerryDetachedReceipt[];
}
export interface FormalBerryDraftOptions {
 readonly scope:typeof SCOPE;
 readonly enabled:boolean;
 readonly geography:FormalRainShadowEligibilityOptions; // exactly one explicit site
 readonly capacity:Readonly<Capacity>;
}

const capacityOk=(cap:Capacity)=>exact(cap,['worldLots','lotsPerTarget'])&&nat(cap.worldLots)&&nat(cap.lotsPerTarget)&&
 cap.worldLots>=1&&cap.worldLots<=SIDE&&cap.lotsPerTarget>=1&&cap.lotsPerTarget<=cap.worldLots;
const validPoint=(w:World,p:Vec)=>exact(p,['x','y'])&&nat(p.x)&&nat(p.y)&&p.x<w.map.width&&p.y<w.map.height;
const receiptKeys=['schemaVersion','draftId','item','ownerId','rain','placedMinute','atRevision','sourceId','sourceAt',
 'sourceBefore','sourceAfter','target','groundCredit'] as const;

/** Structure and lineage only: never proof a detached draft was installed.
 * Current retained rain must match exactly; older copies remain immutable
 * draft evidence only, and cannot authorize a new placement. */
export function validateFormalBerryDetachedLedger(w:World,ledger:FormalBerryDetachedLedger):boolean {
 try{
  const rain=w.formalRainProvenance;
  if(!rain||w.mode!=='formal'||Object.hasOwn(w,'simulationOnly')||
   !exact(ledger,['schemaVersion','worldId','rainAdoptedMinute','capacity','drafts'])||ledger.schemaVersion!==1||
   ledger.worldId!==w.id||ledger.rainAdoptedMinute!==rain.adoptedMinute||!capacityOk(ledger.capacity)||
   !Array.isArray(ledger.drafts)||ledger.drafts.length>ledger.capacity.worldLots)return false;
  let previous=rain.adoptedMinute,revision=0;
  const seen=new Set<string>(),tiles=new Map<string,number>();
  for(const r of ledger.drafts){
   if(!r||!exact(r,receiptKeys)||r.schemaVersion!==1||r.item!=='berry'||r.ownerId!=='commons'||r.groundCredit!==1||
    !min(r.placedMinute)||r.placedMinute<previous||r.placedMinute>w.minute||!nat(r.atRevision)||r.atRevision<revision||r.atRevision>w.revision||
    !validPoint(w,r.sourceAt)||!validPoint(w,r.target)||Math.abs(r.sourceAt.x-r.target.x)+Math.abs(r.sourceAt.y-r.target.y)!==1||
    r.sourceId!==`bush-${r.sourceAt.x}-${r.sourceAt.y}`||!nat(r.sourceBefore)||!nat(r.sourceAfter)||r.sourceBefore-r.sourceAfter!==1||
    !exact(r.rain,['episodeId','startedMinute','closedMinute'])||!min(r.rain.startedMinute)||!min(r.rain.closedMinute)||
    r.rain.episodeId!==formalNativeRainEpisodeId(w.id,r.rain.startedMinute)||
    r.rain.startedMinute<=rain.adoptedMinute||r.rain.closedMinute<=r.rain.startedMinute||r.rain.closedMinute>r.placedMinute||
    r.draftId!==formalBerryOpportunityId(w.id,r.rain.episodeId,r.sourceId)||seen.has(r.draftId))return false;
   const retained=rain.closed.find(e=>e.episodeId===r.rain.episodeId);
   if(retained?(retained.startedMinute!==r.rain.startedMinute||retained.closedMinute!==r.rain.closedMinute):
    (!rain.closed.length||r.rain.closedMinute>=rain.closed[0].startedMinute))return false;
   const t=`${r.target.x}:${r.target.y}`,n=(tiles.get(t)??0)+1;
   if(n>ledger.capacity.lotsPerTarget)return false;
   tiles.set(t,n);seen.add(r.draftId);previous=r.placedMinute;revision=r.atRevision;
  }
  return true;
 }catch{return false;}
}

export function draftFormalBerryGround(store:WorldStore,options?:FormalBerryDraftOptions,prior?:FormalBerryDetachedLedger){
 if(options?.enabled!==true)return {status:'disabled'} as const;
 const unavailable={status:'unavailable'} as const;
 try{
  if(!exact(options,['scope','enabled','geography','capacity'])||options.scope!==SCOPE||
   !capacityOk(options.capacity)||options.geography?.sites.length!==1)return unavailable;
  const basis=readFormalRainShadowBasis(store,options.geography);
  if(basis.status!=='geography_only'||basis.offers.length!==1)return unavailable;
  const {head:{world:w,episode},offers:[site]}=basis;
  const old=prior===undefined?{schemaVersion:1 as const,worldId:w.id,rainAdoptedMinute:w.formalRainProvenance!.adoptedMinute,
   capacity:{...options.capacity},drafts:[]}:structuredClone(prior);
  if(!validateFormalBerryDetachedLedger(w,old)||old.capacity.worldLots!==options.capacity.worldLots||
   old.capacity.lotsPerTarget!==options.capacity.lotsPerTarget)return unavailable;
  const key=formalBerryOpportunityId(w.id,episode.episodeId,site.sourceId);
  if(old.drafts.some(d=>d.draftId===key))return {status:'already_drafted'} as const;
  if(old.drafts.length>=old.capacity.worldLots||old.drafts.filter(d=>samePoint(d.target,site.target)).length>=old.capacity.lotsPerTarget)
   return {status:'capacity'} as const;
  const source=w.resources.find(r=>r.id===site.sourceId)!;
  const receipt:FormalBerryDetachedReceipt={schemaVersion:1,draftId:key,item:'berry',ownerId:'commons',rain:structuredClone(episode),
   placedMinute:w.minute,atRevision:w.revision,sourceId:site.sourceId,sourceAt:{...source.at},
   sourceBefore:site.harvestableBerryUnits,sourceAfter:site.harvestableBerryUnits-1,target:{...site.target},groundCredit:1};
  const ledger:FormalBerryDetachedLedger={...old,drafts:[...old.drafts,receipt]};
  if(!validateFormalBerryDetachedLedger(w,ledger))return unavailable;
  return {status:'draft_only',executionAuthorized:false,worldId:w.id,expectedWorldRevision:w.revision,
   sourceDebit:1,groundCredit:1,residentCredit:0,receipt:structuredClone(receipt),ledger} as const;
 }catch{return unavailable;}
}
