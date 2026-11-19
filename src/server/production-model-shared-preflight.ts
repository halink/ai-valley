import {isProductionAccountQuotaRehearsal,type ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
import type {SharedModelAccountPolicy} from './shared-model-account.js';
import {modelEvidenceHash} from './production-model-journal.js';

const scopes={
 resident:'fictional-resident-state-memory-relationships-actions',
 weather:'valley-spirit-public-weather-points-v1',
 life:'valley-spirit-explicitly-public-life-receipts-v1',
} as const;
export type SharedPreflightPurpose=keyof typeof scopes;
type Grant<P extends SharedPreflightPurpose>={purpose:P;dataScope:typeof scopes[P];version:number;approvalReference:string;};
type Grants=Partial<{[P in SharedPreflightPurpose]:Grant<P>}>;
interface BoundScope {provider:'siliconflow';accountScope:string;accountFingerprint:string;worldId:string;runId:string;startsAt:number;expiresAt:number;policy:SharedModelAccountPolicy;}
export interface SharedLaunchDocument extends BoundScope {
 schemaVersion:1;mode:'offline-preflight';grants:Grants;
 previousCompletionReference:string;quotaReviewReference:string;
}
export interface SharedPreflightCurrent extends BoundScope {
 activeGrants:Partial<Record<SharedPreflightPurpose,{version:number;approvalReference:string}>>;
 previousCompletionReference:string;quotaReviewReference:string;
}
const keys=['resident','weather','life'] as const;
const label=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const wall=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(v:unknown,names:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)]));
 return value;
}
const sameScope=(a:BoundScope,b:BoundScope)=>a.provider==='siliconflow'&&b.provider===a.provider&&label(a.accountScope)&&a.accountScope===b.accountScope&&digest(a.accountFingerprint)&&a.accountFingerprint===b.accountFingerprint&&label(a.worldId)&&a.worldId===b.worldId&&label(a.runId)&&a.runId===b.runId&&a.startsAt===b.startsAt&&a.expiresAt===b.expiresAt;

/** Run-local documentary preflight only. Neither the document nor the returned
 * digest verifies provider identity, billing, grant authority or real pricing.
 * The result cannot open a transport, publish anything, or authorize a launch. */
export function preflightSharedModelLaunch(options:{
 quota:ProductionAccountQuotaRehearsal;document:SharedLaunchDocument;current:SharedPreflightCurrent;
 required:readonly SharedPreflightPurpose[];now:number;
}){
 const blocked={status:'blocked' as const,liveAuthorized:false as const};
 try{
  const {quota,now}=options,b=structuredClone(options.current),a=structuredClone(options.document);
  const declared=['schemaVersion','mode','provider','accountScope','accountFingerprint','worldId','runId','startsAt','expiresAt','policy','grants','previousCompletionReference','quotaReviewReference'];
  if(!isProductionAccountQuotaRehearsal(quota)||!exact(a,declared)||!exact(b,declared.filter(k=>k!=='schemaVersion'&&k!=='mode'&&k!=='grants').concat('activeGrants'))||a.schemaVersion!==1||a.mode!=='offline-preflight'||!sameScope(a,b)||
     quota.accountScope!==a.accountScope||quota.runId!==a.runId)return blocked;
  if(!wall(now)||!wall(a.startsAt)||!wall(a.expiresAt)||now<a.startsAt||now>=a.expiresAt||a.expiresAt-a.startsAt>30_000)return blocked;
  if(!digest(a.previousCompletionReference)||a.previousCompletionReference!==b.previousCompletionReference||
     !digest(a.quotaReviewReference)||a.quotaReviewReference!==b.quotaReviewReference||!quota.matchesPolicy(a.policy)||!quota.matchesPolicy(b.policy))return blocked;
  if(!a.grants||typeof a.grants!=='object'||Array.isArray(a.grants)||!b.activeGrants||typeof b.activeGrants!=='object'||Array.isArray(b.activeGrants)||
     Object.keys(a.grants).some(k=>!keys.includes(k as SharedPreflightPurpose))||Object.keys(b.activeGrants).some(k=>!keys.includes(k as SharedPreflightPurpose)))return blocked;
  const required=[...options.required];
  if(!required.length||required.length>keys.length||new Set(required).size!==required.length||required.some(k=>!keys.includes(k)))return blocked;
  for(const k of keys){
   const grant=a.grants[k];
   if(!grant){if(required.includes(k))return blocked;continue;}
   const active=b.activeGrants[k];
   if(!active||!exact(active,['version','approvalReference'])||!exact(grant,['purpose','dataScope','version','approvalReference'])||grant.purpose!==k||grant.dataScope!==scopes[k]||
     !Number.isSafeInteger(grant.version)||grant.version<=0||grant.version!==active.version||!digest(grant.approvalReference)||grant.approvalReference!==active.approvalReference)return blocked;
  }
  const summary=quota.summary(now);
  if(summary.unknown||summary.held)return blocked;
  return Object.freeze({status:'checked-offline' as const,liveAuthorized:false as const,
   reference:modelEvidenceHash([canonical(a),keys.filter(k=>required.includes(k))])});
 }catch{return blocked;}
}
