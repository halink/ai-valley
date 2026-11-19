import {createHash} from 'node:crypto';
import type {MvpGroundFruitState} from './mvp-ground-fruit.js';
import type {MvpRainEpisode} from './mvp-climate.js';

const FAMILY='fruit_fall',KIND=FAMILY,VERSION=1;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/.test(v);
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

export interface ValleySpiritFruitFallReceipt {
 readonly schemaVersion: 1;
 readonly family: 'fruit_fall';
 readonly worldId: string;
 readonly effectId: string;
 readonly opportunityId: string;
 readonly proposalId: string;
 readonly approvalId: string;
 readonly rainEventId: string;
 readonly sourceResourceInstanceId: string;
 readonly targetId: string;
 readonly ownerId: string;
 readonly committedAtMicroMinute: number;
 readonly debitRipeFruit: 1;
 readonly creditGroundFruit: 1;
}
/** Stable across schema versions, menu revisions, targets, and proposal IDs. */
export function valleySpiritFruitFallOpportunityId(worldId: string, rainEventId: string, sourceResourceInstanceId: string): string {
  if (![worldId, rainEventId, sourceResourceInstanceId].every(id)) throw new TypeError("invalid opportunity identity");
  const key = JSON.stringify([worldId, KIND, rainEventId, sourceResourceInstanceId]);
  return `fruit_fall:${createHash("sha256").update(key).digest("hex")}`;
}

export function valleySpiritFruitFallEffectId(opportunityId:string):string {
 if(!/^fruit_fall:[a-f0-9]{64}$/.test(opportunityId))throw new TypeError('invalid fruit-fall opportunity');
 return 'valley-effect:'+createHash('sha256').update(opportunityId).digest('hex');
}
const RECEIPT_KEYS = [
 'schemaVersion','family','worldId','effectId','opportunityId','proposalId','approvalId','rainEventId',
 'sourceResourceInstanceId','targetId','ownerId','committedAtMicroMinute','debitRipeFruit','creditGroundFruit',
] as const;
export function validValleySpiritFruitFallReceipt(value:unknown):value is ValleySpiritFruitFallReceipt {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==RECEIPT_KEYS.length||
   RECEIPT_KEYS.some(k=>!Object.hasOwn(value,k)))return false;
 const r=value as ValleySpiritFruitFallReceipt;
 if(r.schemaVersion!==VERSION||r.family!==FAMILY||r.debitRipeFruit!==1||r.creditGroundFruit!==1||
   !natural(r.committedAtMicroMinute)||![r.worldId,r.proposalId,r.approvalId,r.rainEventId,r.sourceResourceInstanceId,r.targetId,r.ownerId].every(id))return false;
 const opportunityId=valleySpiritFruitFallOpportunityId(r.worldId,r.rainEventId,r.sourceResourceInstanceId);
 return r.opportunityId===opportunityId&&r.effectId===valleySpiritFruitFallEffectId(opportunityId);
}

/** Authoritative snapshot. The rain fact remains attached after the rolling
 * provenance window has discarded its short-lived opportunity entry. */
export interface MvpSpiritAppliedEffect {
 readonly receipt:ValleySpiritFruitFallReceipt;
 readonly rain:MvpRainEpisode;
 readonly eventId:string;
 readonly sourceBefore:number;
 readonly sourceAfter:number;
}
export interface MvpSpiritEffects {
 readonly version:1;
 readonly adoptedUs:string;
 readonly ground:MvpGroundFruitState;
 readonly applied:readonly MvpSpiritAppliedEffect[];
}
