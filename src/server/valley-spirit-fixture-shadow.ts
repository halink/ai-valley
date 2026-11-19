import type {World} from '../shared/types.js';
import {projectMvpSpiritActiveGround} from '../world/mvp-spirit-effects.js';
import {WorldStore} from './store.js';
import {isEnabledValleySpiritFruitFallPolicy,valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';
import {ValleySpiritJournal,publicWeatherProjection} from './valley-spirit.js';
import {SqliteValleySpiritPermissions} from './valley-spirit-permissions.js';
import {prepareValleySpiritShadowOffers,type ValleySpiritShadowManifest,type ValleySpiritShadowOffers} from './valley-spirit-shadow-offers.js';
import {ValleySpiritShadowQueue} from './valley-spirit-shadow-queue.js';
import {ValleySpiritShadowWorkflow} from './valley-spirit-shadow-workflow.js';

export interface DeveloperMvpSpiritShadowOptions {
 readonly scope:'sealed-developer-shadow-only';
 readonly enabled:boolean;
 readonly manifest:ValleySpiritShadowManifest;
 readonly maxProposalCount:number;
}
const unavailable={status:'unavailable'} as const;
const off={status:'disabled'} as const;
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sameCapacity=(a:ValleySpiritShadowManifest['capacity'],b:ValleySpiritShadowManifest['capacity'])=>
 a.worldLots===b.worldLots&&a.lotsPerTarget===b.lotsPerTarget;

/** Explicit private developer-side coordinator. Ordinary placement never
 * advertises installed behavior. Only a verified sealed store with `ground`,
 * the real SQLite local discovery/pickup ledger, and a pre-existing grant may
 * offer candidate numbers. This object exposes no G2 writer or model port. */
export function openDeveloperMvpSpiritShadow(store:WorldStore,options?:DeveloperMvpSpiritShadowOptions) {
 if(options?.enabled!==true)return off;
 let permissions:SqliteValleySpiritPermissions|undefined;
 try{
  if(!exact(options,['scope','enabled','manifest','maxProposalCount'])||
     options.scope!=='sealed-developer-shadow-only'||!Number.isSafeInteger(options.maxProposalCount)||
     options.maxProposalCount<1||options.maxProposalCount>256)return unavailable;
  const config=structuredClone(options),manifest=config.manifest;
  if(!(store instanceof WorldStore)||!manifest||!isEnabledValleySpiritFruitFallPolicy(manifest.policy))return unavailable;
  const port=WorldStore.prototype.developerMvpSpiritShadowReadPort.call(store);
  if(!port||!sameCapacity(manifest.capacity,port.capacity))return unavailable;
  const captureOwned=()=>{
   const world=port.readHead();
   if(!world||world.id!==manifest.worldId||!world.mvpClimate?.spiritFruitSettlement||world.clock.paused)return null;
   const ground=projectMvpSpiritActiveGround(world),nowMicroMinute=Number(world.mvpClimate.lastUs);
   if(!ground||!Number.isSafeInteger(nowMicroMinute)||nowMicroMinute<0)return null;
   return {world,ground,nowMicroMinute};
  };
  const initial=captureOwned();
  const view=initial?publicWeatherProjection(initial.world):null;
  if(!initial||!view)return unavailable;
  const db=permissions=new SqliteValleySpiritPermissions(port.database,manifest.worldId,port.assertOwned,true);
  // Opening a shadow view is not permission to initialize or enable weather.
  if(!db.read()?.publicWeather){db.close();return unavailable;}
  const journal=new ValleySpiritJournal(port.database,view,port.assertOwned,db);
  if(!journal.publicWeatherPermission()?.publicWeather){db.close();return unavailable;}
  const queue=new ValleySpiritShadowQueue(port.database,manifest.worldId,port.assertOwned);
  let closed=false;
  const capture=():ValleySpiritShadowOffers=>{
   if(closed)return unavailable;
   const owned=captureOwned(),used=queue.countForQuota(manifest.worldId);
   if(!owned||used===null)return unavailable;
   const worldId=owned.world.id,revision=owned.world.revision;
   const safe=prepareValleySpiritShadowOffers({
    readCommittedWorld:()=>owned.world,
    readGroundFruit:(id,rev)=>id===worldId&&rev===revision?owned.ground:undefined,
    journal,
    readReceiptFacts:(request)=>{
     if(request.worldId!==worldId||request.revision!==revision)return;
     const receipts=owned.world.mvpClimate!.spiritEffects!.applied;
     return {
      opportunityConsumed:receipts.some(e=>e.receipt.opportunityId===request.opportunityId),
      proposalQuotaAvailable:used<config.maxProposalCount,
      lastCommittedFruitFallMicroMinute:receipts.at(-1)?.receipt.committedAtMicroMinute??null,
     };
    },
   },manifest);
   if(safe.status!=='ready')return safe;
   const sameHead=()=>isSameRevision(captureOwned()?.world,worldId,revision);
   if(!sameHead())return unavailable;
   const spent=new Set(owned.world.mvpClimate!.spiritEffects!.applied.map(item=>item.receipt.opportunityId));
   return {
    status:'ready',offers:Object.freeze(safe.offers.filter(({option})=>!spent.has(
     valleySpiritFruitFallOpportunityId(option.worldId,option.rainEventId,option.sourceResourceInstanceId),
    )).map(offer=>Object.freeze({option:offer.option,availability:'shadow_preflight_only' as const}))),
    reader:{readFruitFallEvidence(proposal){
     if(closed||!sameHead())return;
     const facts=safe.reader.readFruitFallEvidence(proposal);
     if(!facts||!sameHead())return;
     const old=queue.get(proposal.proposalId);
     if(old.status==='blocked'&&old.code!=='not_found')return;
     // The attempt already occupying its quota slot may be assessed even at
     // the cap. A different proposal cannot borrow that persisted slot.
     const already=old.status==='found'&&old.entry.proposal.inputSnapshotId===proposal.inputSnapshotId&&
      old.entry.proposal.opportunityId===proposal.opportunityId;
     const count=queue.countForQuota(worldId);
     if(count===null)return;
     return {...facts,proposalQuotaAvailable:already||count<config.maxProposalCount,
      target:facts.target?{...facts.target,supportsGroundFood:true,supportsDiscovery:true,supportsPickup:true}:undefined};
    }},
   };
  };
  const workflow=new ValleySpiritShadowWorkflow(capture,queue,manifest.policy,()=>{
   if(closed)return null;
   const now=captureOwned();
   return now?{worldId:now.world.id,nowMicroMinute:now.nowMicroMinute}:null;
  });
  return {
   status:'ready' as const,
   preview:()=>{const used=queue.countForQuota(manifest.worldId);return used!==null&&used<config.maxProposalCount?workflow.preview():null;},
   enqueue:(id:string,answer:unknown)=>workflow.enqueue(id,answer),
   inspect:(id:string)=>workflow.inspect(id),
   assess:(id:string)=>workflow.assess(id),
   expire:(id:string)=>workflow.expire(id),
   sweepPending:()=>workflow.sweepPending(),
   close(){if(!closed){closed=true;db.close();}},
  };
 }catch{
  try{permissions?.close();}catch{/* retain original fail-closed result */}
  return unavailable;
 }
}
function isSameRevision(world:World|undefined,worldId:string,worldRevision:number):boolean {
 return !!world&&world.id===worldId&&world.revision===worldRevision;
}
