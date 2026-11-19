import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {valleySpiritFruitFallOpportunityId} from '../shared/valley-spirit-effects.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {projectMvpSpiritActiveGround} from '../world/mvp-spirit-effects.js';
import {inspectMvpGroundFruitPlacement} from '../world/mvp-ground-fruit.js';
import {readCurrentSealedMvpSourceCommitment} from './valley-spirit-mvp-source-credit.js';
import {makeSealedMvpSourceAgeTerms,verifySealedMvpSourceAge} from './valley-spirit-mvp-source-age.js';
import {sealedAgedPlacementAgeDigest,sealedAgedPlacementScope} from './valley-spirit-aged-placement-terms.js';
import {ValleySpiritShadowQueue} from './valley-spirit-shadow-queue.js';
import {prepareValleySpiritShadowOffers} from './valley-spirit-shadow-offers.js';
import {publicWeatherProjection,ValleySpiritJournal} from './valley-spirit.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';

const UNIT=1_000_000n;
const MAX_AGE=40_320;
const MAX_AGED_RETAINED_ATTEMPTS=64; // conservative offline review bound, not live quota

/** Called from the owning SQLite read transaction with a verified effect
 * archive. This only reads the existing numbered-choice queue and current
 * weather authority. It does not install aged ground or authorize placement. */
export function buildSealedMvpAgedG1Basis(db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,w:World,proposalId:string,ageProof:unknown){
 if(!owner.sourceAge||!owner.agedPlacementKeyPem||owner.formalApprovalKeyPem||w.mode!=='validation'||
  w.clock.paused||!w.mvpClimate?.spiritEffects||!w.mvpClimate.spiritFruitSettlement||w.mvpClimate.current.precipitationPermille>0)return null;
 const credit=readCurrentSealedMvpSourceCommitment(db,owner.seal,w);
 const age=credit&&makeSealedMvpSourceAgeTerms(w.id,credit.creditId,credit.bornUs,owner.sourceAge.policy);
 if(!credit||!age||!verifySealedMvpSourceAge(owner.sourceAge.keyPem,age,ageProof))return null;
 const atUs=w.mvpClimate.lastUs,now=Number(atUs);
 if(!Number.isSafeInteger(now)||now<0||BigInt(atUs)<BigInt(age.bornUs)||BigInt(atUs)>=BigInt(age.expiresUs))return null;

 const queue=new ValleySpiritShadowQueue(owner.database,w.id,()=>owner.assertOwned());
 const row=queue.get(proposalId),directions=queue.readPrivateProposalDirections(now);
 if(row.status!=='found'||!directions||directions.length>MAX_AGED_RETAINED_ATTEMPTS||!directions.some(d=>d.proposalId===proposalId)||
  (row.entry.assessment.status!=='proposed'&&row.entry.assessment.status!=='validated_shadow'))return null;
 const {proposal:p,policy}=row.entry;
 if(policy.maxAgeGameMinutes>MAX_AGE||policy.minimumCooldownGameMinutes>MAX_AGE||
  now<p.validFromMicroMinute||now>=p.validUntilMicroMinute||now<row.entry.appendedAtMicroMinute)return null;
 const rain=resolveMvpRainEpisode(w,p.rainEventId),ground=projectMvpSpiritActiveGround(w);
 if(!rain||!ground||w.mvpClimate.rainProvenance?.recent.at(-1)?.rainEventId!==rain.rainEventId||
  BigInt(atUs)<BigInt(rain.endedUs)||BigInt(atUs)>=BigInt(rain.endedUs)+BigInt(policy.maxAgeGameMinutes)*UNIT)return null;
 const xy=/^ground:(\d{1,4}):(\d{1,4})$/u.exec(p.targetId);
 if(!xy)return null;
 const target={x:Number(xy[1]),y:Number(xy[2])},placement=inspectMvpGroundFruitPlacement(w,ground,credit.sourceId,target,owner.capacity);
 if(!placement||placement.source.resourceInstanceId!==p.sourceResourceInstanceId||placement.target.id!==p.targetId||
  p.opportunityId!==valleySpiritFruitFallOpportunityId(w.id,rain.rainEventId,placement.source.resourceInstanceId))return null;
 const effects=w.mvpClimate.spiritEffects.applied,last=effects.at(-1)?.receipt.committedAtMicroMinute;
 if(effects.some(e=>e.receipt.opportunityId===p.opportunityId)||
  last!==undefined&&BigInt(now-last)<BigInt(policy.minimumCooldownGameMinutes)*UNIT)return null;

 const head=publicWeatherProjection(w);if(!head)return null;
 const permission=()=>{owner.assertOwned();return readValleySpiritWeatherPermission(db,w.id);};
 const noWrite=()=>{throw Error('aged_g1_read_only');};
 const journal=new ValleySpiritJournal(owner.database,head,()=>owner.assertOwned(),{read:permission,initialize:noWrite,advance:noWrite});
 const packet=journal.publicNarrationInput(p.sourceRefs);
 if(!packet||packet.permissionVersion!==p.permissionVersion||!journal.isCurrentPublicInput(packet)||
  !packet.records.some(e=>e.fact.condition==='rain'&&e.fact.precipitationPermille>0&&BigInt(e.fact.atUs)>=BigInt(rain.firstRainUs)&&
   BigInt(e.fact.atUs)<BigInt(rain.endedUs)&&e.fact.worldRevision<=w.revision))return null;
 // Recreate the original pinned option, not the fixture adapter which
 // attests legacy installed carrying/discovery/pickup capabilities.
 const menu=prepareValleySpiritShadowOffers({
  readCommittedWorld:()=>w,readGroundFruit:(id,rev)=>id===w.id&&rev===w.revision?ground:undefined,journal,
 },{worldId:w.id,menuVersion:p.menuVersion,rainEventId:rain.rainEventId,publicWeatherRefs:p.sourceRefs,
  validFromMicroMinute:p.validFromMicroMinute,validUntilMicroMinute:p.validUntilMicroMinute,
  sites:[{sourceId:credit.sourceId,target}],capacity:owner.capacity,policy});
 if(menu.status!=='ready'||menu.offers.length!==1||menu.offers[0].availability!=='missing_ground_capabilities'||
  menu.offers[0].option.inputSnapshotId!==p.inputSnapshotId||!journal.isCurrentPublicInput(packet)||
  queue.countForQuota(w.id)!==directions.length)return null;
 const basis={schema:'aged-g1-current-advisory/v1',fixtureScopeId:sealedAgedPlacementScope(owner.seal),worldId:w.id,
  worldRevision:w.revision,atUs,proposalId:p.proposalId,opportunityId:p.opportunityId,inputSnapshotId:p.inputSnapshotId,
  proposalRecordedAtUs:String(row.entry.appendedAtMicroMinute),menuVersion:p.menuVersion,permissionVersion:p.permissionVersion,
  rain,sourceId:credit.sourceId,sourceInstanceId:p.sourceResourceInstanceId,targetId:p.targetId,creditId:credit.creditId,
  ageTermsDigest:sealedAgedPlacementAgeDigest(age),bornUs:age.bornUs,expiresUs:age.expiresUs,
  validUntilUs:[BigInt(p.validUntilMicroMinute),BigInt(rain.endedUs)+BigInt(policy.maxAgeGameMinutes)*UNIT,BigInt(age.expiresUs)]
   .reduce((a,b)=>a<b?a:b).toString(),
  proposalQuota:{kind:'sealed-offline-retained-attempts',count:directions.length,limit:MAX_AGED_RETAINED_ATTEMPTS},
  installedAgedGround:false,executionAuthorized:false,
 } as const;
 const assessmentDigest=createHash('sha256').update(JSON.stringify([basis,policy,owner.capacity,
  last??null,placement.source.ripeAvailable,placement.target.freeCapacity])).digest('hex');
 return {status:'eligible_aged_advisory',basis,assessmentDigest} as const;
}
