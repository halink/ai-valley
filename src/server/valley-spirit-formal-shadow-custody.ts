import {createHash,createPublicKey,verify} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {formalBerryOpportunityId} from './valley-spirit-formal-berry-draft.js';
import {formalNativeRainEpisodeId,type FormalRainEpisode} from '../world/formal-rain-provenance.js';
import type {Vec,World} from '../shared/types.js';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';

const POLICY='sealed-formal-rain-public-projection/v1', LIMIT=64, MAX_AGE=40320;
const name='formal_shadow_custody';
const SQL='CREATE TABLE '+name+' (seq INTEGER PRIMARY KEY NOT NULL, permission TEXT NOT NULL, proposal TEXT)';
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const match=(v:unknown,r:RegExp):v is string=>typeof v==='string'&&r.test(v);
const digest=(items:unknown[])=>createHash('sha256').update(JSON.stringify(items)).digest('hex');

export interface FormalShadowPermission {
 readonly schema:typeof POLICY;readonly fixtureScope:string;readonly worldId:string;readonly version:number;
 readonly decision:'allow'|'deny';readonly episodeId:string;readonly startsAt:number;readonly expiresAt:number;
 readonly maxAgeGameMinutes:number;readonly cooldownGameMinutes:number;
 readonly sites:readonly {readonly sourceId:string;readonly target:Readonly<Vec>}[];
}
interface SignedPermission {readonly terms:FormalShadowPermission;readonly signature:string}
export const formalShadowScope=(owner:DeveloperMvpSpiritFixtureOwner)=>digest([POLICY,owner.seal]);
export function encodeFormalShadowPermission(t:unknown):Buffer|null{
 if(!exact(t,['schema','fixtureScope','worldId','version','decision','episodeId','startsAt','expiresAt','maxAgeGameMinutes','cooldownGameMinutes','sites'])||
  t.schema!==POLICY||!match(t.fixtureScope,/^[a-f0-9]{64}$/u)||!match(t.worldId,/^valley-formal-[A-Za-z0-9_-]{1,180}$/u)||
  !nat(t.version)||t.version<1||t.version>LIMIT||!(t.decision==='allow'||t.decision==='deny')||
  !match(t.episodeId,/^formal-rain:[a-f0-9]{64}$/u)||!minute(t.startsAt)||!minute(t.expiresAt)||
  t.expiresAt<=t.startsAt||t.expiresAt-t.startsAt>MAX_AGE||!nat(t.maxAgeGameMinutes)||t.maxAgeGameMinutes<1||
  t.maxAgeGameMinutes>MAX_AGE||!nat(t.cooldownGameMinutes)||t.cooldownGameMinutes<1||t.cooldownGameMinutes>MAX_AGE||
  !Array.isArray(t.sites)||t.sites.length>8||(t.decision==='allow'?t.sites.length<1:t.sites.length!==0))return null;
 const sites=t.sites.map(s=>exact(s,['sourceId','target'])&&match(s.sourceId,/^bush-\d{1,8}-\d{1,8}$/u)&&
  exact(s.target,['x','y'])&&nat(s.target.x)&&s.target.x<4096&&nat(s.target.y)&&s.target.y<4096?
   [s.sourceId,s.target.x,s.target.y]:null);
 if(sites.includes(null)||new Set(sites.map(s=>JSON.stringify(s))).size!==sites.length)return null;
 return Buffer.from(JSON.stringify([t.schema,t.fixtureScope,t.worldId,t.version,t.decision,t.episodeId,t.startsAt,t.expiresAt,
  t.maxAgeGameMinutes,t.cooldownGameMinutes,sites]));
}
export function verifyFormalShadowPermission(value:unknown,owner:DeveloperMvpSpiritFixtureOwner):value is SignedPermission{
 try{
  if(!owner.formalShadowKeyPem||!exact(value,['terms','signature'])||!match(value.signature,/^[A-Za-z0-9_-]{86}$/u))return false;
  const bytes=encodeFormalShadowPermission(value.terms),sig=Buffer.from(value.signature,'base64url');
  return !!bytes&&(value.terms as FormalShadowPermission).fixtureScope===formalShadowScope(owner)&&
   sig.length===64&&sig.toString('base64url')===value.signature&&verify(null,bytes,createPublicKey(owner.formalShadowKeyPem),sig);
 }catch{return false;}
}

export interface FormalShadowProposal {
 readonly schema:'formal-berry-shadow-proposal/v1';readonly menuVersion:1;readonly family:'fruit_fall';
 readonly status:'proposed_only';readonly executionAuthorized:false;readonly proposalId:string;readonly opportunityId:string;
 readonly worldId:string;readonly episodeId:string;readonly permissionVersion:number;readonly optionNumber:1;
 readonly sourceId:string;readonly target:Readonly<Vec>;readonly atRevision:number;readonly atMinute:number;readonly rainStartedAt:number;readonly rainClosedAt:number;
 readonly expiresAt:number;readonly cooldownGameMinutes:number;readonly offlineSelectionCost:1;readonly providerTokens:0;
 readonly rationale:'first-eligible-signed-site';
}
interface Row {readonly permission:SignedPermission;readonly proposal:FormalShadowProposal|null}
export function formalShadowProposalId(opportunityId:string,permissionVersion:number){
 return 'formal-shadow:'+digest([opportunityId,permissionVersion]);
}
export function makeFormalShadowProposal(t:FormalShadowPermission,w:Pick<World,'id'|'revision'|'minute'>,site:FormalShadowPermission['sites'][number],rain:Pick<FormalRainEpisode,'startedMinute'|'closedMinute'>):FormalShadowProposal{
 const opportunityId=formalBerryOpportunityId(w.id,t.episodeId,site.sourceId);
 return {schema:'formal-berry-shadow-proposal/v1',menuVersion:1,family:'fruit_fall',status:'proposed_only',executionAuthorized:false,
  proposalId:formalShadowProposalId(opportunityId,t.version),opportunityId,worldId:w.id,episodeId:t.episodeId,
  permissionVersion:t.version,optionNumber:1,sourceId:site.sourceId,target:{...site.target},atRevision:w.revision,atMinute:w.minute,rainStartedAt:rain.startedMinute,rainClosedAt:rain.closedMinute,
  expiresAt:Math.min(t.expiresAt,rain.closedMinute+t.maxAgeGameMinutes),cooldownGameMinutes:t.cooldownGameMinutes,offlineSelectionCost:1,providerTokens:0,rationale:'first-eligible-signed-site'};
}
const hasTable=(db:DatabaseSync)=>{
 const row=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE").get(name);
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name IN (?, 'archive_meta') COLLATE NOCASE").get(name)||
  db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE name IN (?, 'archive_meta') COLLATE NOCASE OR tbl_name IN (?, 'archive_meta') COLLATE NOCASE").get(name,name)||
  row&&(row.type!=='table'||row.sql!==SQL))throw Error('formal_shadow_unknown_schema');
 return !!row;
};
const readRaw=(db:DatabaseSync)=>db.prepare("SELECT seq, CASE WHEN length(CAST(permission AS BLOB))<=4096 THEN permission END AS permission, "+
  "CASE WHEN length(CAST(proposal AS BLOB))<=4096 THEN proposal END AS proposal, proposal IS NULL AS empty "+
  "FROM formal_shadow_custody ORDER BY seq LIMIT ?").all(LIMIT+1);
const anchorKey='formal_shadow_custody_v1';
const anchor=(rows:ReturnType<typeof readRaw>)=>digest(rows.map(r=>[r.seq,r.permission,r.proposal,r.empty]));
export function initializeFormalShadowCustody(db:DatabaseSync){
 db.exec(SQL);
 db.prepare('INSERT INTO archive_meta (key,value) VALUES (?,?)').run(anchorKey,anchor([]));
}
const updateAnchor=(db:DatabaseSync)=>{
 const raw=readRaw(db);
 if(raw.length>LIMIT||db.prepare('UPDATE archive_meta SET value=? WHERE key=?').run(anchor(raw),anchorKey).changes!==1)
  throw Error('formal_shadow_anchor_missing');
};
export function readFormalShadowRows(db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,w:World):readonly Row[]{
 if(!owner.formalShadowKeyPem||!hasTable(db))throw Error('formal_shadow_not_installed');
 const raw=readRaw(db);
 if(db.prepare('SELECT value FROM archive_meta WHERE key=?').get(anchorKey)?.value!==anchor(raw))
  throw Error('formal_shadow_anchor_mismatch');
 if(raw.length>LIMIT)throw Error('formal_shadow_capacity');
 const used=new Set<string>();
 let prior:FormalShadowProposal|null=null;
 return raw.map(({seq,permission,proposal,empty},i)=>{
  if(typeof permission!=='string'||empty!==1&&typeof proposal!=='string')throw Error('formal_shadow_encoding');
  const grant:unknown=JSON.parse(permission);
  if(seq!==i+1||!verifyFormalShadowPermission(grant,owner)||grant.terms.version!==seq||grant.terms.worldId!==w.id||
   grant.terms.startsAt>w.minute)throw Error('formal_shadow_invalid_permission');
  if(typeof proposal!=='string')return {permission:grant,proposal:null};
  const p=JSON.parse(proposal) as FormalShadowProposal,t=grant.terms;
  const site=t.sites.find(s=>s.sourceId===p?.sourceId&&s.target.x===p.target?.x&&s.target.y===p.target?.y);
  const rain=w.formalRainProvenance?.closed.find(e=>e.episodeId===t.episodeId);
  if(!site||t.decision!=='allow'||!nat(p.atRevision)||p.atRevision>w.revision||!minute(p.atMinute)||
   p.atMinute<t.startsAt||p.atMinute>=p.expiresAt||p.atMinute>w.minute||!minute(p.rainClosedAt)||!minute(p.rainStartedAt)||p.rainStartedAt>=p.rainClosedAt||p.rainClosedAt>p.atMinute||
   formalNativeRainEpisodeId(w.id,p.rainStartedAt)!==t.episodeId||
   (rain?rain.closedMinute!==p.rainClosedAt:p.rainClosedAt>=(w.formalRainProvenance?.closed[0]?.startedMinute??0))||
   prior&&p.atMinute<prior.atMinute+prior.cooldownGameMinutes||used.has(p.opportunityId)||
   proposal!==JSON.stringify(makeFormalShadowProposal(t,{id:w.id,revision:p.atRevision,minute:p.atMinute},site,{startedMinute:p.rainStartedAt,closedMinute:p.rainClosedAt})))
   throw Error('formal_shadow_invalid_proposal');
  used.add(p.opportunityId);prior=p;return {permission:grant,proposal:p};
 });
}
/** The reviewer envelope and all proposal evidence are bound, not just an
 * ID derived from a rain/source pair. Only hashed data leaves this read. */
export function formalShadowApprovalBasis(row:Row){
 return row.proposal?digest(['formal-berry-g1-approval-basis/v1',row.permission,row.proposal]):null;
}
export function appendFormalShadowPermission(db:DatabaseSync,grant:SignedPermission){
 if(!hasTable(db))throw Error('formal_shadow_not_installed');
 db.prepare('INSERT INTO formal_shadow_custody (seq,permission) VALUES (?,?)').run(grant.terms.version,JSON.stringify(grant));
 updateAnchor(db);
}
export function appendFormalShadowProposal(db:DatabaseSync,p:FormalShadowProposal){
 if(!hasTable(db)||db.prepare('UPDATE formal_shadow_custody SET proposal=? WHERE seq=? AND proposal IS NULL')
  .run(JSON.stringify(p),p.permissionVersion).changes!==1)throw Error('formal_shadow_stale_permission');
 updateAnchor(db);
}
