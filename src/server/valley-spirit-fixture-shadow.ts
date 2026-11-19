import type {World} from '../shared/types.js';
import {projectMvpSpiritActiveGround} from '../world/mvp-spirit-effects.js';
import {WorldStore} from './store.js';
import {isEnabledValleySpiritFruitFallPolicy,preflightValleySpiritFruitFall,valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';
import {ValleySpiritJournal,publicWeatherProjection} from './valley-spirit.js';
import {SqliteValleySpiritPermissions} from './valley-spirit-permissions.js';
import {prepareValleySpiritShadowOffers,type ValleySpiritShadowManifest,type ValleySpiritShadowOffers} from './valley-spirit-shadow-offers.js';
import {ValleySpiritShadowQueue} from './valley-spirit-shadow-queue.js';
import {ValleySpiritShadowWorkflow} from './valley-spirit-shadow-workflow.js';
import {
 developerMvpFruitFallAssessmentDigest,readDeveloperMvpFruitFallVerificationPolicy,
 verifyDeveloperMvpFruitFallSignedApproval,type DeveloperMvpFruitFallVerificationPolicy,
} from './valley-spirit-fixture-signed-approval.js';
import {
 reconcileMvpFruitFallAttachmentFixture,runMvpFruitFallAttachmentFixture,type MvpFruitFallFixtureApproval,
} from './valley-spirit-fruit-fall-fixture.js';

export interface DeveloperMvpSpiritShadowOptions {
 readonly scope:'sealed-developer-shadow-only';
 readonly enabled:boolean;
 readonly manifest:ValleySpiritShadowManifest;
 readonly maxProposalCount:number;
 readonly g2?:DeveloperMvpFruitFallVerificationPolicy;
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
  const fields=['scope','enabled','manifest','maxProposalCount',...(Object.hasOwn(options,'g2')?['g2']:[])];
  if(!exact(options,fields)||
     options.scope!=='sealed-developer-shadow-only'||!Number.isSafeInteger(options.maxProposalCount)||
     options.maxProposalCount<1||options.maxProposalCount>256)return unavailable;
  const config=structuredClone(options),manifest=config.manifest;
  const verifier=config.g2===undefined?null:readDeveloperMvpFruitFallVerificationPolicy(config.g2);
  if(config.g2!==undefined&&!verifier)return unavailable;
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
  const currentGrant=(proposal:{sourceRefs:readonly string[];permissionVersion:number})=>{
   const packet=journal.publicNarrationInput(proposal.sourceRefs);
   return !!packet&&packet.worldId===manifest.worldId&&packet.permissionVersion===proposal.permissionVersion&&
    journal.isCurrentPublicInput(packet);
  };
  /** Reconstruct the exact signed/advisory basis, using current private
   * sources. No caller supplied proposal or raw writable world is accepted. */
  const signedEntry=(value:unknown)=>{
   if(closed||!verifier)return null;
   const terms=verifyDeveloperMvpFruitFallSignedApproval(value,verifier.key);
   if(!terms||terms.fixtureScopeId!==port.scopeId||terms.maxCommittedEffects>verifier.maxCommittedEffects)return null;
   const row=queue.get(terms.proposalId),head=captureOwned();
   if(row.status!=='found'||row.entry.assessment.status!=='validated_shadow'||!head)return null;
   const {proposal,policy}=row.entry;
   if(developerMvpFruitFallAssessmentDigest(row.entry)!==terms.assessmentDigest||
      terms.firstMicroMinute<row.entry.assessment.checkedAtMicroMinute||
      terms.firstMicroMinute<proposal.validFromMicroMinute||terms.expiresMicroMinute>proposal.validUntilMicroMinute||
      head.nowMicroMinute<terms.firstMicroMinute||head.nowMicroMinute>=terms.expiresMicroMinute||
      policy.version!==manifest.policy.version||policy.shadowEnabled!==manifest.policy.shadowEnabled||
      policy.maxAgeGameMinutes!==manifest.policy.maxAgeGameMinutes||
      policy.minimumCooldownGameMinutes!==manifest.policy.minimumCooldownGameMinutes||!currentGrant(proposal))return null;
   return {terms,proposal,policy,head};
  };
  const applySigned=(value:unknown)=>{
   if(!verifier||closed)return off;
   try{
    const pinned=structuredClone(value),basis=signedEntry(pinned);
    if(!basis)return unavailable;
    const {terms,proposal,policy,head}=basis;
    const prior=head.world.mvpClimate!.spiritEffects!.applied.find(e=>e.receipt.opportunityId===proposal.opportunityId);
    if(prior){
     if(prior.receipt.proposalId!==proposal.proposalId||prior.receipt.approvalId!==terms.approvalId)return unavailable;
     return reconcileMvpFruitFallAttachmentFixture(store,proposal);
    }
    const candidate=manifest.sites.find(site=>{
     if(`ground:${site.target.x}:${site.target.y}`!==proposal.targetId)return false;
     const source=head.world.resources.find(r=>r.id===site.sourceId);
     return !!source&&`mvp-fruit:${source.id}:${source.at.x}:${source.at.y}`===proposal.sourceResourceInstanceId;
    });
    if(!candidate)return unavailable;
    const approval:MvpFruitFallFixtureApproval={
     scope:'isolated-sqlite-fruit-fall-fixture',enabled:true,policy,pinnedOption:{
      worldId:proposal.worldId,menuVersion:proposal.menuVersion,inputSnapshotId:proposal.inputSnapshotId,
      permissionVersion:proposal.permissionVersion,sourceRefs:proposal.sourceRefs,rainEventId:proposal.rainEventId,
      sourceResourceInstanceId:proposal.sourceResourceInstanceId,targetId:proposal.targetId,quantity:proposal.quantity,
      validFromMicroMinute:proposal.validFromMicroMinute,validUntilMicroMinute:proposal.validUntilMicroMinute,
     },schedule:{type:'fruit_fall',worldId:proposal.worldId,proposalId:proposal.proposalId,opportunityId:proposal.opportunityId,
      approvalId:terms.approvalId,firstMicroMinute:terms.firstMicroMinute,expiresMicroMinute:terms.expiresMicroMinute},
     currentPermissionVersion:proposal.permissionVersion,sourceResourceId:candidate.sourceId,target:{...candidate.target},
     maxCommittedEffects:terms.maxCommittedEffects,
    };
    return runMvpFruitFallAttachmentFixture(store,proposal,approval,undefined,current=>{
     const fresh=signedEntry(pinned);
     if(!fresh||fresh.head.world.id!==current.id||fresh.head.world.revision!==current.revision)return false;
     const ready=capture();
     if(ready.status!=='ready')return false;
     const evidence=ready.reader.readFruitFallEvidence(proposal);
     return preflightValleySpiritFruitFall(proposal,evidence,policy).status==='validated_shadow';
    });
   }catch{return unavailable;}
  };
  return {
   status:'ready' as const,
   preview:()=>{const used=queue.countForQuota(manifest.worldId);return used!==null&&used<config.maxProposalCount?workflow.preview():null;},
   enqueue:(id:string,answer:unknown)=>workflow.enqueue(id,answer),
   inspect:(id:string)=>workflow.inspect(id),
   assess:(id:string)=>workflow.assess(id),
   expire:(id:string)=>workflow.expire(id),
   sweepPending:()=>workflow.sweepPending(),
   approvalBasis(id:string){
    if(!verifier||closed)return null;
    try{
     const row=queue.get(id);
     if(row.status!=='found'||!currentGrant(row.entry.proposal))return null;
     const assessmentDigest=developerMvpFruitFallAssessmentDigest(row.entry);
     return assessmentDigest?{type:'fruit_fall' as const,fixtureScopeId:port.scopeId,proposalId:id,assessmentDigest}:null;
    }catch{return null;}
   },
   applySigned,
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
