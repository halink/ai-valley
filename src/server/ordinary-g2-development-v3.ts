import {verifyDueExecutionPlacement,verifyOrdinaryDueExecution,readOrdinaryDevelopmentDueRecord,consumeOrdinaryDevelopmentDue} from './ordinary-g2-development-due.js';
import {deriveNativeAgedFruitSourceMinute,verifyNativeAgedFruitSourceFlow,type NativeAgedFruitSourceFlow} from './ordinary-native-aged-fruit-conservation.js';
import {diningWorkClaim,readNativeAgedEatingState,type Eating} from './disposable-native-aged-transfer.js';
import {agedGroundApproachPath,chooseLawfulAgedGroundPath,equalAgedGroundPath,type AgedGroundApproachPlan,type AgedGroundApproachWitness} from '../world/mvp-native-aged-ground-approach.js';
import {same} from '../world/navigation.js';
import {physiology} from '../world/physiology.js';
import type {NativeAgedDiningDeclineReason,NativeAgedEatCompletion} from '../world/mvp-aged-fruit-native-eat.js';
import {goods} from '../shared/items.js';
import {prepareOrdinaryAgedGroundPickup} from './valley-spirit-ordinary-aged-pickup.js';
import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {prepareSealedMvpEcologyMinute,prepareStoppedOrdinaryAgedGroundMinute,prepareStoppedOrdinaryAgedGroundRouteMinute} from './godot-mvp.js';
import {advanceAgedGroundExpiry,type AgedGroundLot} from './valley-spirit-ordinary-aged-ground.js';
import {assertStoppedEventAuthority,assertStoppedEventArchive} from './valley-spirit-ordinary-stopped-continuation.js';
import type {CommittedNativeOrdinaryAgedDiscovery} from '../world/mvp-ordinary-aged-ground-discovery.js';
import {mvpFallenFruitDiscoveryId} from '../shared/valley-spirit-fairness.js';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';
import {authenticateOrdinaryG2DevelopmentV3,type OrdinaryG2DevelopmentOrigin} from './ordinary-g2-development-origin.js';

const MODE='ordinary-g2-development-v3-one-unit/v1',SIGN='ordinary-g2-development-v3-exact-consent/v1';
const LATCH='ordinary_g2_development_v3_placed';
const GROUND='valley_spirit_ordinary_g2_dev_ground_v3',RECEIPT='valley_spirit_ordinary_g2_dev_receipt_v3';
const gddl='CREATE TABLE '+GROUND+' (slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1), body TEXT NOT NULL)';
const rddl='CREATE TABLE '+RECEIPT+' (opportunity TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, seal TEXT NOT NULL)';
const exact=(p:unknown,k:readonly string[]):p is Record<string,unknown>=>!!p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===k.length&&k.every(x=>Object.hasOwn(p,x));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hex=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const string=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=300;
const int=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const clock=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v);
const point=(v:unknown)=>exact(v,['x','y'])&&int(v.x)&&int(v.y);
const policy=hash([MODE,'one-unit','native-closed-rain','original-lot-age','commons','no-advance-while-ground','not-production']);
export type OrdinaryDevelopmentV3Options=Readonly<{mode:typeof MODE;reviewerPublicKeyPem:string;dueTransferReviewerPublicKeyPem?:string}>;
type PublicPin=Readonly<{key:KeyObject;fingerprint:string}>;
type Pin=Readonly<PublicPin&{dueTransfer?:PublicPin}>;
const pins=new WeakSet<Pin>();
export type OrdinaryDevelopmentV3Pin=Pin;
function parseDevelopmentReviewer(pem:unknown):PublicPin|null{
 if(typeof pem!=='string'||pem.length>256||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(pem))return null;
 const key=createPublicKey(pem);
 return key.asymmetricKeyType==='ed25519'?Object.freeze({key,fingerprint:createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex')}):null;
}
export function pinOrdinaryDevelopmentV3(input:unknown):Pin|null{
 try{
  if(!input||typeof input!=='object')return null;
  const hasFourth=Object.hasOwn(input,'dueTransferReviewerPublicKeyPem');
  if(!exact(input,['mode','reviewerPublicKeyPem',...(hasFourth?['dueTransferReviewerPublicKeyPem']:[])])||input.mode!==MODE)return null;
  const original=parseDevelopmentReviewer(input.reviewerPublicKeyPem),fourth=hasFourth?parseDevelopmentReviewer(input.dueTransferReviewerPublicKeyPem):null;
  if(!original||hasFourth&&(!fourth||fourth.fingerprint===original.fingerprint))return null;
  const p=Object.freeze({...original,...(fourth?{dueTransfer:fourth}:{})});
  pins.add(p);return p;
 }catch{return null;}
}
export const ownsOrdinaryDevelopmentV3Pin=(p:unknown)=>!!p&&typeof p==='object'&&pins.has(p as Pin);
const keys=['schema','policy','originScope','reviewer','reviewDigest','snapshot','headDigest','worldId','revision','permissionVersion','opportunityId',
 'rainEventId','sourceId','sourceInstanceId','targetId','atUs','eligibleUntilUs','lotId','bornUs','expiresUs','ownerId','quantity'] as const;
export type OrdinaryDevelopmentV3Terms=Readonly<{schema:typeof SIGN;policy:string;originScope:string;reviewer:string;reviewDigest:string;snapshot:string;headDigest:string;
 worldId:string;revision:number;permissionVersion:number;opportunityId:string;rainEventId:string;sourceId:string;sourceInstanceId:string;targetId:string;
 atUs:string;eligibleUntilUs:string;lotId:string;bornUs:string;expiresUs:string;ownerId:'commons';quantity:1}>;
export function ordinaryDevelopmentV3Terms(origin:OrdinaryG2DevelopmentOrigin,pin:Pin,input:Omit<OrdinaryDevelopmentV3Terms,'schema'|'policy'|'originScope'|'reviewer'>){
 if(!pins.has(pin))return null;
 const t:OrdinaryDevelopmentV3Terms={schema:SIGN,policy,originScope:authenticateOrdinaryG2DevelopmentV3(origin,'consent-scope',pin.fingerprint),
  reviewer:pin.fingerprint,...input};
 return encodeOrdinaryDevelopmentV3(t)?Object.freeze(t):null;
}
export function encodeOrdinaryDevelopmentV3(t:unknown){
 if(!exact(t,keys)||t.schema!==SIGN||t.policy!==policy||t.ownerId!=='commons'||t.quantity!==1||!int(t.revision)||!int(t.permissionVersion)||
  !['originScope','reviewer','reviewDigest','snapshot','headDigest'].every(k=>hex(t[k]))||
  !['worldId','opportunityId','rainEventId','sourceId','sourceInstanceId','targetId','lotId'].every(k=>string(t[k]))||
  !clock(t.atUs)||!clock(t.eligibleUntilUs)||!clock(t.bornUs)||!clock(t.expiresUs)||
  BigInt(t.bornUs)>BigInt(t.atUs)||BigInt(t.atUs)>=BigInt(t.eligibleUntilUs)||BigInt(t.eligibleUntilUs)>BigInt(t.expiresUs))return null;
 return Buffer.from(JSON.stringify([MODE,...keys.map(k=>t[k])]));
}
type Approval=Readonly<{terms:OrdinaryDevelopmentV3Terms;signature:string}>;
export function verifyOrdinaryDevelopmentV3(v:unknown,origin:OrdinaryG2DevelopmentOrigin,pin:Pin):Approval|null{
 try{
  if(!pins.has(pin)||!exact(v,['terms','signature'])||typeof v.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(v.signature))return null;
  const bytes=encodeOrdinaryDevelopmentV3(v.terms),sig=Buffer.from(v.signature,'base64url'),t=v.terms as OrdinaryDevelopmentV3Terms;
  if(!bytes||v.signature!==sig.toString('base64url')||t.reviewer!==pin.fingerprint||
   t.originScope!==authenticateOrdinaryG2DevelopmentV3(origin,'consent-scope',pin.fingerprint)||!verify(null,bytes,pin.key,sig))return null;
  return {terms:Object.fromEntries(keys.map(k=>[k,t[k]])) as OrdinaryDevelopmentV3Terms,signature:v.signature};
 }catch{return null;}
}
type Ground=Readonly<{schema:'ordinary-g2-development-ground/v3';effectId:string;sourceId:string;sourceInstanceId:string;sourceAt:{x:number;y:number};
 at:{x:number;y:number};targetId:string;ownerId:'commons';quantity:1;lotId:string;bornUs:string;expiresUs:string;placedUs:string}>;
type Archive=Readonly<{schema:'ordinary-g2-development-receipt/v3';approval:Approval|NonNullable<ReturnType<typeof verifyOrdinaryDueExecution>>;sourceBefore:number;sourceAfter:number;afterRevision:number;afterDigest:string;groundDigest:string}>;
function digestHead(db:DatabaseSync,w:World){
 const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all(),r=rows[0];
 return rows.length===1&&r.id===w.id&&r.revision===w.revision&&r.state instanceof Uint8Array?createHash('sha256').update(r.state).digest('hex'):null;
}
function assertLifecycleWorldWriter(db:DatabaseSync){
 const table=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='worlds'").get();
 if(table?.name!=='worlds'||table.type!=='table'||table.sql!=='CREATE TABLE worlds (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state BLOB NOT NULL)'||
    db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)='worlds' AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get()||
    db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name)='worlds' OR lower(tbl_name)='worlds'").get())
  throw Error('ordinary_g2_dev_v3_continuation_world_writer');
}
function latch(db:DatabaseSync,strict=false){
 const m=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta'").get();
 if(!m&&!strict)return null;
 if(m?.type!=='table'||m.sql!=='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)'||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)='archive_meta' AND type='trigger'").get()||
   db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name)='archive_meta' OR lower(tbl_name)='archive_meta'").get())
  throw Error('ordinary_g2_dev_v3_anchor_schema');
 const r=db.prepare("SELECT CASE WHEN length(value)=64 THEN value END AS value FROM main.archive_meta WHERE key=?").get(LATCH);
 if(r&&!hex(r.value))throw Error('ordinary_g2_dev_v3_anchor_value');
 return r?r.value as string:null;
}
function tables(db:DatabaseSync){
 const names=[GROUND,RECEIPT];
 const actual=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name) IN (?,?)").all(...names);
 if(!actual.length){if(latch(db)!==null)throw Error('ordinary_g2_dev_v3_orphan_anchor');return false;}
 if(latch(db,true)===null)throw Error('ordinary_g2_dev_v3_missing_anchor');
 if(actual.length!==2||!actual.every(r=>r.type==='table'&&(r.name===GROUND&&r.sql===gddl||r.name===RECEIPT&&r.sql===rddl))||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name) IN (?,?) AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(...names)||
   db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (?,?,'worlds') OR lower(tbl_name) IN (?,?,'worlds')").get(...names,...names))
  throw Error('ordinary_g2_dev_v3_schema');
 return true;
}
type Expiry=NonNullable<ReturnType<typeof advanceAgedGroundExpiry>>['expired'][number];
type Pickup=NonNullable<ReturnType<typeof prepareOrdinaryAgedGroundPickup>>['completion'];
type Held=Readonly<{schema:'ordinary-g2-development-held/v3';holderId:string;ownerId:'commons';effectId:string;lotId:string;
 bornUs:string;expiresUs:string;groundDebit:1;heldCredit:1;pickup:Pickup}>;
type HeldExpiry=Readonly<{settledUs:string;heldDebit:1}>;
type Work=Readonly<{planId:string;startedUs:string;count:number;at:{x:number;y:number}}>;
type Eaten=Readonly<{heldDebit:1;witness:NativeAgedEatCompletion}>;
type Route=Readonly<{plan:AgedGroundApproachPlan;edgesUs:readonly string[];result:'active'|'completed'|'interrupted'|'superseded';
 closedUs?:string;competitorPlanId?:string}>;
type HallDecline=Readonly<{schema:'v3-native-hall-declined';holderId:string;planId:string;atUs:string;reason:NativeAgedDiningDeclineReason}>;
type SourceFlow=NativeAgedFruitSourceFlow;
type Lifecycle=Readonly<{schema:'ordinary-g2-development-continuation/v3';sequence:number;atUs:string;
 revision:number;digest:string;placement:Ground;discoveries:readonly CommittedNativeOrdinaryAgedDiscovery[];expiry:Expiry|null;held?:Held;heldExpiry?:HeldExpiry;work?:Work;hallWork?:Eating;hallDecline?:HallDecline;eaten?:Eaten;route?:Route;sourceFlow?:SourceFlow|null}>;
const archiveKeys=['schema','approval','sourceBefore','sourceAfter','afterRevision','afterDigest','groundDigest'];
const lotOf=(g:Ground,c:Approval):AgedGroundLot=>({bornUs:g.bornUs,expiresUs:g.expiresUs,
 fruit:{effectId:g.effectId,kind:'fallen-fruit',amount:1,ownerId:g.ownerId,sourceResourceId:g.sourceId,
  sourceResourceInstanceId:g.sourceInstanceId,sourceAt:g.sourceAt,rainEventId:c.terms.rainEventId,at:g.at,placedUs:g.placedUs}});
const verifiedArchiveReads=new WeakMap<object,{db:DatabaseSync;revision:number;world:string;content:string}>();
export function readOrdinaryDevelopmentV3(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:Pin,w:World){
 if(!tables(db))return null;
 const gr=db.prepare('SELECT slot,CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body FROM main.'+GROUND+' LIMIT 2').all();
 const rr=db.prepare('SELECT opportunity,CASE WHEN length(CAST(body AS BLOB))<=65536 THEN body END AS body,seal FROM main.'+RECEIPT+' LIMIT 2').all();
 const rg=gr[0],ar=rr[0];
 if(gr.length>1||rr.length!==1||typeof ar.body!=='string'||
  ar.seal!==authenticateOrdinaryG2DevelopmentV3(origin,'v3-receipt',ar.body)||latch(db,true)!==ar.seal)throw Error('ordinary_g2_dev_v3_receipt');
 const envelope=JSON.parse(ar.body),stepped=exact(envelope,['placementReceipt','lifecycle']);
 const a=(stepped?envelope.placementReceipt:envelope) as Archive,l=stepped?envelope.lifecycle as Lifecycle:null;
 const g=l?l.placement:typeof rg?.body==='string'?JSON.parse(rg.body) as Ground:null;
 const c=verifyOrdinaryDevelopmentV3(a.approval,origin,pin)??verifyDueExecutionPlacement(db,origin,pin,a.approval,hash(a));
 if(!g||!c||!exact(a,archiveKeys)||a.schema!=='ordinary-g2-development-receipt/v3'||
  !int(a.sourceBefore)||!int(a.sourceAfter)||a.sourceAfter!==a.sourceBefore-1||a.afterRevision!==c.terms.revision+1||!hex(a.afterDigest)||
  w.id!==c.terms.worldId||a.groundDigest!==hash(g)||ar.opportunity!==c.terms.opportunityId||
  !exact(g,['schema','effectId','sourceId','sourceInstanceId','sourceAt','at','targetId','ownerId','quantity','lotId','bornUs','expiresUs','placedUs'])||
  g.schema!=='ordinary-g2-development-ground/v3'||g.effectId!=='ordinary-g2-dev-v3:'+hash(c.terms.opportunityId)||
  g.sourceId!==c.terms.sourceId||g.sourceInstanceId!==c.terms.sourceInstanceId||g.ownerId!==c.terms.ownerId||
  g.targetId!==c.terms.targetId||g.lotId!==c.terms.lotId||g.quantity!==1||g.bornUs!==c.terms.bornUs||g.expiresUs!==c.terms.expiresUs||g.placedUs!==c.terms.atUs||
  !point(g.sourceAt)||!point(g.at)||g.targetId!=='ground:'+g.at.x+':'+g.at.y||
  valleySpiritFruitFallOpportunityId(w.id,c.terms.rainEventId,g.sourceInstanceId)!==c.terms.opportunityId)
  throw Error('ordinary_g2_dev_v3_mismatch');
 const now=minuteToClimateUs(w.minute),before=BigInt(g.placedUs),expires=BigInt(g.expiresUs);
 if(!l){
  if(stepped||w.revision!==a.afterRevision||now!==c.terms.atUs||a.afterDigest!==digestHead(db,w)||
   w.resources.filter(r=>r.id===g.sourceId&&r.amount===a.sourceAfter&&r.at.x===g.sourceAt.x&&r.at.y===g.sourceAt.y).length!==1||
   !resolveMvpRainEpisode(w,c.terms.rainEventId))throw Error('ordinary_g2_dev_v3_placement_mismatch');
 }else{
  if(!exact(l,['schema','sequence','atUs','revision','digest','placement','discoveries','expiry',...(Object.hasOwn(l,'held')?['held']:[]),...(Object.hasOwn(l,'heldExpiry')?['heldExpiry']:[]),...(Object.hasOwn(l,'work')?['work']:[]),...(Object.hasOwn(l,'eaten')?['eaten']:[]),...(Object.hasOwn(l,'hallWork')?['hallWork']:[]),...(Object.hasOwn(l,'hallDecline')?['hallDecline']:[]),...(Object.hasOwn(l,'route')?['route']:[]),...(Object.hasOwn(l,'sourceFlow')?['sourceFlow']:[])])||l.schema!=='ordinary-g2-development-continuation/v3'||
   !int(l.sequence)||l.sequence<1||l.sequence>1440||BigInt(now)!==before+1_000_000n*BigInt(l.sequence)||
   now!==l.atUs||w.revision!==l.revision||w.revision<=a.afterRevision||l.digest!==digestHead(db,w)||
   !Array.isArray(l.discoveries)||l.discoveries.length>64||
   new Set(l.discoveries.map(d=>d.residentId)).size!==l.discoveries.length)throw Error('ordinary_g2_dev_v3_continuation_mismatch');
  for(const d of l.discoveries)if(d.schema!=='native-ordinary-aged-ground-observation/v1'||d.worldId!==w.id||d.effectId!==g.effectId||
   d.receiptDigest!==hash(a)||d.discoveryId!==mvpFallenFruitDiscoveryId(w.id,d.residentId,g.effectId)||
   !clock(d.atUs)||BigInt(d.atUs)<=before||BigInt(d.atUs)>=expires||BigInt(d.atUs)>BigInt(now)||
   !int(d.committedRevision)||d.committedRevision>w.revision||d.committedRevision<=d.fromRevision||
   d.fromRevision<a.afterRevision||hash(d.target)!==hash(g.at)||!point(d.observerAt))
    throw Error('ordinary_g2_dev_v3_discovery');
  if(Object.hasOwn(l,'held')){
   const held=l.held,p=held?.pickup;
   const d=l.discoveries.find(x=>x.residentId===held?.holderId);
   const resident=w.residents.find(x=>x.id===held?.holderId);
   if(!held||!p||!d||!resident||!exact(held,['schema','holderId','ownerId','effectId','lotId','bornUs','expiresUs','groundDebit','heldCredit','pickup'])||
    held.schema!=='ordinary-g2-development-held/v3'||l.expiry!==null||held.effectId!==g.effectId||held.lotId!==g.lotId||held.ownerId!==g.ownerId||
    held.bornUs!==g.bornUs||held.expiresUs!==g.expiresUs||held.groundDebit!==1||held.heldCredit!==1||
    !exact(p,['schema','worldId','baseRevision','draftRevision','effectId','receiptDigest','residentId','discoveryId','planId','settledUs','bornUs','expiresUs'])||
    p.schema!=='native-ordinary-aged-ground-pickup-completion/v1'||p.worldId!==w.id||!int(p.draftRevision)||p.draftRevision>w.revision||p.baseRevision>=p.draftRevision||
    !int(p.baseRevision)||p.baseRevision<d.committedRevision||p.effectId!==g.effectId||p.receiptDigest!==hash(a)||p.residentId!==held.holderId||
    p.discoveryId!==d.discoveryId||!clock(p.settledUs)||BigInt(p.settledUs)>BigInt(now)||BigInt(p.settledUs)>=expires||p.bornUs!==g.bornUs||p.expiresUs!==g.expiresUs||BigInt(d.atUs)>=BigInt(p.settledUs)||
    !string(p.planId)||!w.processed.includes('plan:'+p.planId)||
    resident.status!=='alive'||resident.residency==='outside'||resident.regionalLocation||
    (p.settledUs===now)!==(p.draftRevision===w.revision)||
    p.settledUs===now&&(resident.at.x!==g.at.x||resident.at.y!==g.at.y||resident.inside!==null||resident.plan||resident.activity))
    throw Error('ordinary_g2_dev_v3_held');
  }
  if(Object.hasOwn(l,'heldExpiry')){
   const x=l.heldExpiry;
   if(!l.held||!x||!exact(x,['settledUs','heldDebit'])||
    x.heldDebit!==1||x.settledUs!==now||BigInt(now)<expires||BigInt(now)-1_000_000n>=expires)throw Error('ordinary_g2_dev_v3_held_expiry');
  }
  if(Object.hasOwn(l,'route')&&(!l.route||!validRoute(w,l.route,g,l.discoveries,l.held,l.expiry)))throw Error('ordinary_g2_dev_v3_route');
  if(Object.hasOwn(l,'hallDecline')){
   const d=l.hallDecline,h=l.held;
   if(!d||!h||!exact(d,['schema','holderId','planId','atUs','reason'])||d.schema!=='v3-native-hall-declined'||d.holderId!==h.holderId||
    !['route-unavailable','seat-or-eligibility','work-invalid'].includes(d.reason)||!string(d.planId)||!w.processed.includes('plan:'+d.planId)||!clock(d.atUs)||BigInt(d.atUs)<=BigInt(h.pickup.settledUs)||
    BigInt(d.atUs)>BigInt(now)||w.residents.some(r=>r.id===h.holderId&&(r.plan?.id===d.planId||r.activity?.planId===d.planId)))
    throw Error('ordinary_g2_dev_v3_hall_decline');
  }
  if(l.work||l.hallWork||l.eaten){
   const h=l.held;
   if(!h||l.heldExpiry||[l.work,l.hallWork,l.eaten].filter(Boolean).length!==1)throw Error('ordinary_g2_dev_v3_eating');
   const holder=w.residents.find(r=>r.id===h.holderId)!;
   if(l.work){
    const work=l.work;
    if(!exact(work,['planId','startedUs','count','at'])||!matchesOutdoorWork(holder,work,h.effectId,now)||!w.processed.includes('plan:'+work.planId)||
      BigInt(work.startedUs)<=BigInt(h.pickup.settledUs))throw Error('ordinary_g2_dev_v3_work');
   }else if(l.hallWork){
    const work=l.hallWork;
    if(!work.table||hash(work)!==hash(readNativeAgedEatingState(w,h.holderId,h.effectId))||
      BigInt(minuteToClimateUs(work.startedAt))<=BigInt(h.pickup.settledUs)||
      work.table.workStartedAt!==undefined&&BigInt(minuteToClimateUs(work.table.workStartedAt))+4_000_000n>=expires)
      throw Error('ordinary_g2_dev_v3_hall_work');
   }else{
    const e=l.eaten!,n=e.witness;
    if(!exact(e,['heldDebit','witness'])||e.heldDebit!==1||!exact(n,['residentId','planId','startedUs','settledUs','eventId','hungerBefore','hungerAfter','nutrition','workMinutes',...(n.dining?['dining']:[])])||
     !clock(n.startedUs)||BigInt(n.startedUs)<=BigInt(h.pickup.settledUs)||BigInt(now)-BigInt(n.startedUs)!==4_000_000n||
     n.residentId!==h.holderId||n.settledUs!==now||n.workMinutes!==5||!w.processed.includes('plan:'+n.planId)||
     !matchesEatingNutrition(n)||!matchesSettledHunger(w,holder,n)||!matchesEatingEvent(w,n))throw Error('ordinary_g2_dev_v3_eaten');
   }
  }else if(Object.hasOwn(l,'work')||Object.hasOwn(l,'hallWork')||Object.hasOwn(l,'eaten'))throw Error('ordinary_g2_dev_v3_eating_shape');
  if(l.expiry!==null){
   if(!exact(l.expiry,['effectId','bornUs','expiresUs','settledUs','groundDebit'])||l.expiry.effectId!==g.effectId||l.expiry.bornUs!==g.bornUs||
    l.expiry.expiresUs!==g.expiresUs||l.expiry.settledUs!==now||l.expiry.groundDebit!==1||BigInt(now)<expires||BigInt(now)-1_000_000n>=expires)
     throw Error('ordinary_g2_dev_v3_expiry');
  }else if(!l.heldExpiry&&BigInt(now)>=expires)throw Error('ordinary_g2_dev_v3_unsettled_expiry');
 }
 if(l){assertStoppedEventAuthority(db);assertStoppedEventArchive(db,w);}
 if(l?.expiry||l?.held?gr.length!==0:rg?.slot!==1||rg.body!==JSON.stringify(g))throw Error('ordinary_g2_dev_v3_ground_row');
 const own={ground:l?.expiry||l?.held?null:g,receipt:a,approval:c,lifecycle:l,seal:ar.seal as string};
 verifiedArchiveReads.set(own,{db,revision:w.revision,world:hash(w),content:hash(own)});
 return own;
}
function liveRoute(w:World,r:Route){
 const p=r.plan,actor=w.residents.find(x=>x.id===p.residentId),a=actor?.activity,q=actor?.plan;
 const path=agedGroundApproachPath(p),done=r.edgesUs.length;
 return !!actor&&!!a&&!!q&&a.planId===p.planId&&q.id===p.planId&&q.actorId===p.residentId&&q.createdAt===p.startedFromMinute&&
  q.actions.length===0&&a.action.type==='move'&&same(a.action.to,p.to)&&same(a.target,p.to)&&!a.room&&actor.inside===null&&
  a.startedAt===p.startedFromMinute+1&&Number.isFinite(a.travelProgress??0)&&(a.travelProgress??0)>=0&&(a.travelProgress??0)<1&&
  (done<path.length||(a.travelProgress??0)===0)&&same(actor.at,done?path[done-1]:p.from)&&equalAgedGroundPath(a.path,path.slice(done));
}
function validRoute(w:World,r:Route,g:Ground,discoveries:readonly CommittedNativeOrdinaryAgedDiscovery[],held?:Held,expiry?:Expiry|null){
 const p=r.plan,path=p&&agedGroundApproachPath(p),now=minuteToClimateUs(w.minute);
 const onMap=(q:import('../shared/types.js').Vec)=>point(q)&&q.x<w.map.width&&q.y<w.map.height;
 if(!p||!exact(r,['plan','edgesUs','result',...(r.result==='active'?[]:['closedUs']),...(r.result==='superseded'?['competitorPlanId']:[])])||
  !exact(p,['residentId','effectId','discoveryId','from','to','expiresUs','planId','startedFromMinute',...(p.path?['path']:[])])||
  !string(p.planId)||!p.planId.startsWith('mvp-rule-'+w.id+'-')||!w.processed.includes('plan:'+p.planId)||!int(p.startedFromMinute)||
  w.minute<=p.startedFromMinute||p.effectId!==g.effectId||p.expiresUs!==g.expiresUs||!onMap(p.from)||!onMap(p.to)||!same(p.to,g.at)||
  !discoveries.some(d=>d.residentId===p.residentId&&d.discoveryId===p.discoveryId&&BigInt(d.atUs)<=BigInt(p.startedFromMinute)*1_000_000n)||
  !path||path.length!==(p.path?2:1)||path.some((q,i)=>{const prev=i?path[i-1]:p.from;return !onMap(q)||same(q,p.from)||
   Math.abs(q.x-prev.x)+Math.abs(q.y-prev.y)!==1;})||!same(path.at(-1)!,p.to)||
  !Array.isArray(r.edgesUs)||r.edgesUs.length>path.length||r.edgesUs.some((t,i)=>!clock(t)||
   BigInt(t)<BigInt(p.startedFromMinute+1)*1_000_000n||BigInt(t)>=BigInt(g.expiresUs)||BigInt(t)>BigInt(now)||i>0&&BigInt(t)<BigInt(r.edgesUs[i-1])))return false;
 if(r.result==='active')return !held&&!expiry&&liveRoute(w,r);
 if(!clock(r.closedUs)||BigInt(r.closedUs)>BigInt(now)||BigInt(r.closedUs)<BigInt(r.edgesUs.at(-1)??(BigInt(p.startedFromMinute+1)*1_000_000n).toString())||
    w.residents.some(a=>a.id===p.residentId&&(a.plan?.id===p.planId||a.activity?.planId===p.planId)))return false;
 if(r.result==='completed')return r.edgesUs.length===path.length&&BigInt(r.closedUs)<BigInt(g.expiresUs);
 if(r.result==='superseded')return !!held&&held.holderId!==p.residentId&&held.pickup.planId===r.competitorPlanId&&held.pickup.settledUs===r.closedUs;
 return r.result==='interrupted';
}
function stageRoute(before:World,after:World,old:Route|undefined,witness:AgedGroundApproachWitness,held:Held|undefined,atUs:string){
 const p=witness.plan;
 if(!p)return null;
 const open=before.residents.find(a=>a.id===p.residentId),close=after.residents.find(a=>a.id===p.residentId);
 const path=agedGroundApproachPath(p),edges=[...old?.edgesUs??[]];
 if(!open||!close||old&&(old.result!=='active'||hash(p)!==hash(old.plan)||!liveRoute(before,old))||
  !old&&(p.startedFromMinute!==before.minute||open.activity||open.plan||!same(open.at,p.from)||
   !equalAgedGroundPath(chooseLawfulAgedGroundPath(before,open,p.to)??[],path)))return null;
 let pos=open.at;
 for(const e of witness.edges){
  if(!path[edges.length]||!same(pos,e.from)||!same(path[edges.length],e.to)||BigInt(atUs)>=BigInt(p.expiresUs))return null;
  pos=e.to;edges.push(atUs);
 }
 if(!same(pos,close.at))return null;
 const active:Route={plan:p,edgesUs:edges,result:'active'};
 if(witness.supersededBy){
  if(!old||witness.stopped||!held||held.holderId===p.residentId||held.holderId!==witness.supersededBy.residentId||
    held.pickup.planId!==witness.supersededBy.planId||close.plan||close.activity)return null;
  return {...active,result:'superseded' as const,closedUs:atUs,competitorPlanId:held.pickup.planId};
 }
 if(liveRoute(after,active))return !held&&!witness.stopped?active:null;
 if(close.plan?.id===p.planId||close.activity?.planId===p.planId)return null;
 if(!witness.stopped&&!close.lastFailure&&edges.length===path.length&&same(pos,p.to))
  return {...active,result:'completed' as const,closedUs:atUs};
 if(!witness.stopped)return null;
 return {...active,result:'interrupted' as const,closedUs:atUs};
}
function matchesOutdoorWork(r:World['residents'][number],work:Work,effectId:string,atUs:string){
 const a=r.activity,p=r.plan;
 return !!a&&!!p&&string(work.planId)&&clock(work.startedUs)&&point(work.at)&&int(work.count)&&work.count>=1&&work.count<=4&&
  BigInt(atUs)-BigInt(work.startedUs)===BigInt(work.count-1)*1_000_000n&&r.inside===null&&!r.regionalLocation&&r.residency!=='outside'&&
  a.planId===work.planId&&p.id===work.planId&&a.action.type==='mvpAgedFruitEat'&&!a.action.dining&&a.action.effectId===effectId&&
  p.actions.length===0&&p.actorId===r.id&&p.createdAt===a.startedAt-1&&exact(a.action,['type','effectId'])&&!Object.hasOwn(a,'mvpAgedEatWorkStartedAt')&&
  !a.room&&!a.path.length&&a.remaining===5-work.count&&minuteToClimateUs(a.startedAt)===work.startedUs&&
  a.target.x===work.at.x&&a.target.y===work.at.y&&r.at.x===work.at.x&&r.at.y===work.at.y;
}
function matchesEatingNutrition(n:NativeAgedEatCompletion){
 return Number.isFinite(n.hungerBefore)&&n.hungerBefore>=35&&n.hungerBefore<=100&&n.nutrition===goods.fruit.food&&
  n.hungerAfter===Math.max(0,n.hungerBefore-n.nutrition);
}
function matchesSettledHunger(w:World,r:World['residents'][number],n:NativeAgedEatCompletion){
 return r.hunger===Math.min(100,n.hungerAfter+physiology(w,r).hungerPerMinute);
}
function matchesEatingEvent(w:World,n:NativeAgedEatCompletion){
 const r=w.residents.find(x=>x.id===n.residentId),e=string(n.eventId)&&w.events.find(x=>x.id===n.eventId);
 return !!r&&!!e&&e.kind==='action'&&e.at===w.minute&&e.actors.length===1&&e.actors[0]===n.residentId&&
  e.text===r.name+'吃完了一份自己的食物。'&&e.observerOnly&&e.place?.x===r.at.x&&e.place?.y===r.at.y&&
  (n.dining?!!e.roomAt&&e.roomId===n.dining.buildingId&&same(e.roomAt,n.dining.seat)&&diningWorkClaim(w,r,n.dining):!e.roomId&&!e.roomAt);
}
function eligibleLifecycleEvents(w:World,draft:World){
 return draft.events.length<=4096&&draft.events.length-w.events.length<=128&&
  hash(draft.events.slice(0,w.events.length))===hash(w.events)&&
  !draft.events.slice(w.events.length).some(e=>e.kind==='conversation'||e.speechText!==undefined||e.mvpMeal||e.socialAppointmentArrival||e.mvpFruitFall);
}
const nativeSourceBasis=(g:Ground,a:Archive)=>({sourceId:g.sourceId,sourceAt:g.sourceAt,placementClosingQuantity:a.sourceAfter});
/** Only project an original transaction-verified archive through its owning reader. */
export function projectOrdinaryDevelopmentV3Fairness(w:World,owned:NonNullable<ReturnType<typeof readOrdinaryDevelopmentV3>>){
 const proof=verifiedArchiveReads.get(owned);
 if(!proof||proof.revision!==w.revision||proof.world!==hash(w)||proof.content!==hash(owned))return null;
 const l=owned.lifecycle,g=l?.placement??owned.ground;
 if(!g)return null;
 const flow=verifyNativeAgedFruitSourceFlow(w,nativeSourceBasis(g,owned.receipt),l);
 return {status:'ready',coverage:'one-signed-development-opportunity',throughRevision:w.revision,throughUs:minuteToClimateUs(w.minute),
  proposalDirections:{linkedApprovedCandidate:1,total:'unavailable'},actualEffects:{groundPlacement:1},
  actualDiscoveries:{personal:(l?.discoveries??[]).length},actualPickups:{settled:l?.held?1:0},
  supply:{fallTransfer:{sourceDebit:1,groundCredit:1,directNewSupply:0},pickupTransfer:{groundDebit:l?.held?1:0,heldCredit:l?.held?1:0},
   groundExpiry:l?.expiry?1:0,heldExpiry:l?.heldExpiry?1:0,eaten:l?.eaten?1:0,
   sourceFlow:flow?{status:'ready',baselineUs:g.placedUs,baselineRevision:owned.receipt.afterRevision,baselineQuantity:owned.receipt.sourceAfter,...flow}:
    {status:'unavailable',reason:'no-contiguous-native-coverage'},causalGain:'unavailable'},
  productionEnabled:false,executionAuthorized:false} as const;
}
const preparedMinutes=new WeakMap<object,{db:DatabaseSync;priorSeal:string;content:string}>();
/** Native minute for an actually placed, still owned lot. No user-supplied
 * actor, plan, world, time, target or observations enter this path. */
export function prepareOrdinaryDevelopmentV3Minute(db:DatabaseSync,w:World,owned:NonNullable<ReturnType<typeof readOrdinaryDevelopmentV3>>,mode:'observe'|'pickup'|'held'|'approach'|'hall'='observe'){
 const pickup=mode==='pickup',hall=mode==='hall',heldTick=mode==='held'||hall;
 const g=owned.ground,l=owned.lifecycle;
 const proven=verifiedArchiveReads.get(owned);
 if(!db.isTransaction||!proven||proven.db!==db||proven.revision!==w.revision||proven.world!==hash(w)||proven.content!==hash(owned)||
  !(heldTick?l?.held&&!l.heldExpiry&&!l.eaten:g)||latch(db,true)!==owned.seal||(l?.sequence??0)>=1440)return null;
 assertLifecycleWorldWriter(db);assertStoppedEventAuthority(db);assertStoppedEventArchive(db,w);
 if(heldTick){
  if(!l?.held||l.heldExpiry||l.eaten)return null;
  const held=l.held;
  const opening=w.residents.find(r=>r.id===held.holderId);
  if(!opening||hall&&l.work||!hall&&l.hallWork||l.work&&!matchesOutdoorWork(opening,l.work,held.effectId,l.atUs))return null;
  const now=minuteToClimateUs(w.minute),deadline=BigInt(held.expiresUs);
  if(BigInt(now)>=deadline)return null;
  const next=prepareSealedMvpEcologyMinute(w,true,undefined,undefined,{
   residentId:held.holderId,effectId:held.effectId,expiresUs:held.expiresUs,...(hall?{originalHall:true}:{originalOutdoorEvent:true})
  },undefined,true);
  if(!next||next.observed.length||next.mealWitnesses.length||next.speech?.receipts.length||!eligibleLifecycleEvents(w,next.draft))return null;
  const holder=next.draft.residents.find(r=>r.id===held.holderId);
  if(!holder||holder.status!=='alive'||holder.residency==='outside'||holder.regionalLocation)return null;
  const after=minuteToClimateUs(next.draft.minute);
  if(BigInt(after)!==BigInt(now)+1_000_000n)return null;
  const heldExpiry:HeldExpiry|undefined=BigInt(after)>=deadline?{settledUs:after,heldDebit:1}:undefined;
  let work:Work|undefined,hallWork:Eating|undefined,eaten:Eaten|undefined;
  if(next.eaten){
   const n=next.eaten;
   const outdoor=l.work,dining=l.hallWork?.table;
   if(heldExpiry||n.residentId!==held.holderId||n.settledUs!==after||n.workMinutes!==5||!matchesEatingNutrition(n)||
    n.hungerBefore!==opening.hunger||!matchesSettledHunger(next.draft,holder,n)||!matchesEatingEvent(next.draft,n)||
    w.events.some(e=>e.id===n.eventId)||holder.plan||holder.activity||!next.draft.processed.includes('plan:'+n.planId)||
    hash(holder.inventory)!==hash(opening.inventory))return null;
   if(hall){
    if(!dining||!n.dining||dining.workStartedAt===undefined||l.hallWork!.worked!==4||l.hallWork!.planId!==n.planId||
      minuteToClimateUs(dining.workStartedAt)!==n.startedUs||hash(dining.dining)!==hash(n.dining))return null;
   }else if(!outdoor||outdoor.count!==4||outdoor.planId!==n.planId||outdoor.startedUs!==n.startedUs||n.dining||!same(holder.at,outdoor.at))return null;
   eaten={heldDebit:1,witness:n};
  }else if(holder.activity?.action.type==='mvpAgedFruitEat'){
   if(heldExpiry)return null;
   if(hash(holder.inventory)!==hash(opening.inventory)||
    holder.hunger!==Math.min(100,opening.hunger+physiology(next.draft,holder).hungerPerMinute))return null;
   if(hall){
    hallWork=readNativeAgedEatingState(next.draft,held.holderId,held.effectId);
    const d=hallWork?.table,prior=l.hallWork,prev=prior?.table;
    const phases=['outdoor-route','indoor-route','seated','work'];
    if(!hallWork||!d||prior&&(!prev||hash(d.dining)!==hash(prev.dining)||hallWork.planId!==prior.planId||
      hallWork.startedAt!==prior.startedAt||phases.indexOf(d.phase)<phases.indexOf(prev.phase))||
      d.workStartedAt!==undefined&&BigInt(minuteToClimateUs(d.workStartedAt))+4_000_000n>=deadline||
      (prior?.worked?hallWork.worked!==prior.worked+1||d.workStartedAt!==prev?.workStartedAt:hallWork.worked>1))return null;
   }else{
    const a=holder.activity;
    work=l.work?{...l.work,count:l.work.count+1}:{planId:a.planId,startedUs:after,count:1,at:{...holder.at}};
    if(!matchesOutdoorWork(holder,work,held.effectId,after))return null;
   }
  }
  let hallDecline=l.hallDecline;
  if(hall&&l.hallWork&&!hallWork&&!eaten){
   const declining=next.agedDiningDecline;
   if(!declining||declining.planId!==l.hallWork.planId||declining.residentId!==held.holderId||declining.atUs!==after||holder.plan||holder.activity||
    holder.hunger!==Math.min(100,opening.hunger+physiology(next.draft,holder).hungerPerMinute)||
    hash(holder.inventory)!==hash(opening.inventory))return null;
   hallDecline={schema:'v3-native-hall-declined',holderId:held.holderId,planId:l.hallWork.planId,atUs:after,reason:declining.reason};
  }
  const prepared={draft:next.draft,placement:l.placement,sequence:l.sequence+1,discoveries:l.discoveries,expiry:null,held,heldExpiry,work,hallWork,hallDecline,eaten,route:l.route,sourceFlow:deriveNativeAgedFruitSourceMinute(w,next.draft,nativeSourceBasis(l.placement,owned.receipt),l,next.fruitFlow)};
  preparedMinutes.set(prepared,{db,priorSeal:owned.seal,content:hash(prepared)});
  return prepared;
 }
 if(!g)return null;
 const lot=lotOf(g,owned.approval),receiptDigest=hash(owned.receipt);
 const readLot=(h:{worldId:string;revision:number;atUs:string})=>
  h.worldId===w.id&&h.revision===w.revision&&h.atUs===w.mvpClimate?.lastUs?
   {...h,schema:'ordinary-active-aged-ground-observation/v1' as const,...lot,receiptDigest}:null;
 const activeRoute=l?.route?.result==='active'?l.route:undefined;
 if(mode==='approach'&&l?.route&&!activeRoute)return null;
 const routed=mode==='approach'||activeRoute?prepareStoppedOrdinaryAgedGroundRouteMinute(w,{
  readExactActiveLot:readLot,
  readExactPickupEvidence(h){const active=readLot(h);return active&&l?.discoveries.length?
   {lot:active,discoveries:l.discoveries,approachAlreadyUsed:!!l.route}:null;}
 },activeRoute?.plan??null,true):null;
 if((mode==='approach'||activeRoute)&&!routed||pickup&&routed&&!routed.pickup)return null;
 const picked=pickup&&!routed?prepareOrdinaryAgedGroundPickup(w,{readExactPickupEvidence(h){
  const active=readLot(h);
  if(!active||!l?.discoveries.length)return null;
  return {lot:active,discoveries:l.discoveries.map(({committedRevision:_,...native})=>native)};
 }},true):null;
 if(pickup&&!routed&&(!picked||picked.nativeCustody.mealWitnesses.length||picked.nativeCustody.speech?.receipts.length))return null;
 const next=routed??(picked?{draft:picked.draft,observed:[],fruitFlow:picked.nativeCustody.fruitFlow}:prepareStoppedOrdinaryAgedGroundMinute(w,{readExactActiveLot:readLot},true));
 if(!next)return null;
 const {draft,observed}=next,expiry=advanceAgedGroundExpiry(w,draft,[lot]),atUs=minuteToClimateUs(draft.minute);
 let completion=picked?.completion;
 if(routed?.pickup){
  const p=routed.pickup,d=l?.discoveries.find(x=>x.residentId===p.residentId);
  const a=w.residents.find(x=>x.id===p.residentId),b=draft.residents.find(x=>x.id===p.residentId);
  if(!d||!a||!b||!same(a.at,g.at)||!same(b.at,g.at)||p.settledUs!==atUs||p.startedAt!==draft.minute||
    !draft.processed.includes('plan:'+p.planId)||b.plan||b.activity||b.inside!==null||hash(a.inventory)!==hash(b.inventory))return null;
  completion={schema:'native-ordinary-aged-ground-pickup-completion/v1',worldId:w.id,baseRevision:w.revision,draftRevision:draft.revision,
   effectId:g.effectId,receiptDigest,residentId:p.residentId,discoveryId:d.discoveryId,planId:p.planId,settledUs:atUs,
   bornUs:g.bornUs,expiresUs:g.expiresUs};
 }
 const held:Held|undefined=completion?{schema:'ordinary-g2-development-held/v3',holderId:completion.residentId,
  ownerId:g.ownerId,effectId:g.effectId,lotId:g.lotId,bornUs:g.bornUs,expiresUs:g.expiresUs,groundDebit:1,heldCredit:1,pickup:completion}:undefined;
 const route=routed?stageRoute(w,draft,activeRoute,routed.witness,held,atUs):l?.route;
 if(routed&&!route)return null;
 if(!expiry||expiry.expired.length&&(observed.length||held)||!eligibleLifecycleEvents(w,draft))return null;
 const discoveries=[...l?.discoveries??[]],prior=new Set(discoveries.map(d=>d.residentId));
 for(const seen of observed)if(!prior.has(seen.residentId)){
  discoveries.push({...seen,committedRevision:draft.revision});prior.add(seen.residentId);
 }
 if(discoveries.length>64)return null;
 const prepared={draft,placement:g,sequence:(l?.sequence??0)+1,discoveries,expiry:expiry.expired[0]??null,...(held?{held}:{}),heldExpiry:undefined,work:undefined,hallWork:undefined,hallDecline:undefined,eaten:undefined,route,sourceFlow:deriveNativeAgedFruitSourceMinute(w,draft,nativeSourceBasis(g,owned.receipt),l,next.fruitFlow)};
 preparedMinutes.set(prepared,{db,priorSeal:owned.seal,content:hash(prepared)});
 return prepared;
}
export function stagedOrdinaryDevelopmentV3WorkActor(db:DatabaseSync,step:NonNullable<ReturnType<typeof prepareOrdinaryDevelopmentV3Minute>>){
 const p=preparedMinutes.get(step);
 return p&&p.db===db&&db.isTransaction&&p.content===hash(step)&&(step.work||step.hallWork)&&step.held?{id:step.held.holderId,hall:!!step.hallWork}:null;
}
export function writeOrdinaryDevelopmentV3Minute(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:Pin,
 owned:NonNullable<ReturnType<typeof readOrdinaryDevelopmentV3>>,step:NonNullable<ReturnType<typeof prepareOrdinaryDevelopmentV3Minute>>){
 const h=digestHead(db,step.draft),prepared=preparedMinutes.get(step);
 preparedMinutes.delete(step);
 if(!db.isTransaction||!h||!prepared||prepared.db!==db||prepared.priorSeal!==owned.seal||prepared.content!==hash(step)||(!owned.ground&&!owned.lifecycle?.held)||!tables(db)||latch(db,true)!==owned.seal)throw Error('ordinary_g2_dev_v3_continuation_scope');
 assertLifecycleWorldWriter(db);assertStoppedEventAuthority(db);assertStoppedEventArchive(db,step.draft);
 const lifecycle:Lifecycle={schema:'ordinary-g2-development-continuation/v3',sequence:step.sequence,atUs:minuteToClimateUs(step.draft.minute),
  revision:step.draft.revision,digest:h,placement:step.placement,discoveries:step.discoveries,expiry:step.expiry,sourceFlow:step.sourceFlow,...(step.held?{held:step.held}:{}),...(step.heldExpiry?{heldExpiry:step.heldExpiry}:{}),...(step.work?{work:step.work}:{}),...(step.eaten?{eaten:step.eaten}:{}),...(step.hallWork?{hallWork:step.hallWork}:{}),...(step.hallDecline?{hallDecline:step.hallDecline}:{}),...(step.route?{route:step.route}:{})};
 const raw=JSON.stringify({placementReceipt:owned.receipt,lifecycle}),seal=authenticateOrdinaryG2DevelopmentV3(origin,'v3-receipt',raw);
 if(Buffer.byteLength(raw)>65536||
  db.prepare('UPDATE main.'+RECEIPT+' SET body=?,seal=? WHERE opportunity=? AND seal=?')
   .run(raw,seal,owned.approval.terms.opportunityId,owned.seal).changes!==1||
  db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(seal,LATCH,owned.seal).changes!==1||
  owned.ground&&(step.expiry||step.held)&&db.prepare('DELETE FROM main.'+GROUND+' WHERE slot=1').run().changes!==1)
   throw Error('ordinary_g2_dev_v3_continuation_write');
 const persisted=readOrdinaryDevelopmentV3(db,origin,pin,step.draft);
 if(!persisted||persisted.seal!==seal||persisted.lifecycle?.digest!==h)throw Error('ordinary_g2_dev_v3_continuation_readback');
 return persisted;
}
/** Invoke only from the original scoped WorldStore transaction after the actual debit. */
export function writeOrdinaryDevelopmentV3(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:Pin,
 before:World,after:World,target:{x:number;y:number},signed:unknown,paired=false){
 const due=paired?readOrdinaryDevelopmentDueRecord(db,origin,pin):null;
 const approval=paired?due&&verifyOrdinaryDueExecution(signed,origin,pin,due):verifyOrdinaryDevelopmentV3(signed,origin,pin),h=digestHead(db,after);
 if(!db.isTransaction||!approval||!h||tables(db))throw Error('ordinary_g2_dev_v3_scope');
 const t='basis' in approval.terms?approval.terms.basis:approval.terms,geo=inspectMvpGroundFruitGeography(before,t.sourceId,target),source=before.resources.find(r=>r.id===t.sourceId);
 if(!geo||geo.targetId!==t.targetId||geo.source.resourceInstanceId!==t.sourceInstanceId||geo.source.ownerId!==t.ownerId||
   before.revision!==t.revision||after.revision!==t.revision+1||t.atUs!==minuteToClimateUs(before.minute)||!source||source.amount<1||
   after.resources.find(r=>r.id===t.sourceId)?.amount!==source.amount-1)throw Error('ordinary_g2_dev_v3_ground');
 const g:Ground={schema:'ordinary-g2-development-ground/v3',effectId:'ordinary-g2-dev-v3:'+hash(t.opportunityId),
  sourceId:t.sourceId,sourceInstanceId:t.sourceInstanceId,sourceAt:{...source.at},at:{...target},targetId:t.targetId,
  ownerId:'commons',quantity:1,lotId:t.lotId,bornUs:t.bornUs,expiresUs:t.expiresUs,placedUs:t.atUs};
 const a:Archive={schema:'ordinary-g2-development-receipt/v3',approval,sourceBefore:source.amount,sourceAfter:source.amount-1,
  afterRevision:after.revision,afterDigest:h,groundDigest:hash(g)};
 const raw=JSON.stringify(a),seal=authenticateOrdinaryG2DevelopmentV3(origin,'v3-receipt',raw);
 if(latch(db,true)!==null)throw Error('ordinary_g2_dev_v3_anchor_exists');
 db.exec(gddl);db.exec(rddl);
 db.prepare('INSERT INTO main.'+GROUND+' VALUES(1,?)').run(JSON.stringify(g));
 db.prepare('INSERT INTO main.'+RECEIPT+' VALUES(?,?,?)').run(t.opportunityId,raw,seal);
 db.prepare('INSERT INTO main.archive_meta (key,value) VALUES(?,?)').run(LATCH,seal);
 if(paired&&due)consumeOrdinaryDevelopmentDue(db,origin,pin,due,approval,hash(a));
 if(!readOrdinaryDevelopmentV3(db,origin,pin,after))throw Error('ordinary_g2_dev_v3_readback');
 return {status:'development-v3-stored' as const,ground:g,worldId:after.id,revision:after.revision,minute:after.minute,expiry:null,sourceBefore:a.sourceBefore,sourceAfter:a.sourceAfter,approvalPresent:true as const,
  productionApproved:false as const,executionAuthorized:false as const};
}
