import type {DisposableNativePickupWitness} from './godot-mvp.js';
import {same} from '../world/navigation.js';
import {mvpFallenFruitDiscoveryId} from '../shared/valley-spirit-fairness.js';
import type {GroundDiscoveryHead,NativeOrdinaryAgedDiscovery,CommittedNativeOrdinaryAgedDiscovery} from '../world/mvp-ordinary-aged-ground-discovery.js';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {parseClimateUs,minuteToClimateUs} from '../world/mvp-climate.js';
import {validateMvpGroundFruitState} from '../world/mvp-ground-fruit.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {advanceAgedGroundExpiry,type AgedGroundLot,readOwnedEmptyGround} from './valley-spirit-ordinary-aged-ground.js';
import {ordinaryAgedG1ReviewSigningBytes,prepareOrdinaryAgedG1ReviewEncoding,type pinOrdinaryAgedG1Review} from './valley-spirit-ordinary-aged-g1-review.js';
import {authenticateDisposableRulesPayload,type DisposableRulesSaveAuthority} from './disposable-native-rules-save.js';
import type {inspectRulesAgedFruitBasis} from './valley-spirit-rules-aged-preflight.js';

const lane='disposable-ordinary-aged-transfer/v1';
const table='valley_spirit_disposable_native_aged_transfer';
const ddl='CREATE TABLE valley_spirit_disposable_native_aged_transfer (slot INTEGER PRIMARY KEY CHECK(slot=1),body TEXT NOT NULL,seal TEXT NOT NULL)';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const digestWorld=(w:World)=>hash(gzipSync(JSON.stringify(w),{level:1}));
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,fields:readonly string[]):v is Record<string,unknown>=>record(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
export const pinDisposableNativeAgedTransfer=(pem:unknown,review:ReturnType<typeof pinOrdinaryAgedG1Review>)=>{
 try{
  if(typeof pem!=='string'||pem.length>256||!review||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/u.test(pem))return null;
  const key=createPublicKey(pem),keyId=hash(key.export({format:'der',type:'spki'}));
  return key.asymmetricKeyType==='ed25519'&&keyId!==review.keyId?Object.freeze({key,keyId,review}):null;
 }catch{return null;}
};
export type DisposableNativeAgedTransferPin=NonNullable<ReturnType<typeof pinDisposableNativeAgedTransfer>>;
const keys=['purpose','worldId','revision','atUs','untilUs','g1Digest','worldDigest','effectKeyId','lotId','targetId'] as const;
type Terms={purpose:typeof lane;worldId:string;revision:number;atUs:string;untilUs:string;g1Digest:string;worldDigest:string;effectKeyId:string;lotId:string;targetId:string};
export function disposableNativeAgedTransferSigningBytes(v:unknown){
 try{
  if(!exact(v,keys)||v.purpose!==lane||typeof v.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u.test(v.worldId)||
   !Number.isSafeInteger(v.revision)||Number(v.revision)<0||typeof v.atUs!=='string'||typeof v.untilUs!=='string'||parseClimateUs(v.untilUs)<=parseClimateUs(v.atUs)||
   parseClimateUs(v.untilUs)-parseClimateUs(v.atUs)>60_000_000n||![v.g1Digest,v.worldDigest,v.effectKeyId].every(hex)||
   typeof v.lotId!=='string'||!/^native-fruit:[a-f0-9]{64}$/u.test(v.lotId)||typeof v.targetId!=='string'||!/^ground:\d{1,4}:\d{1,4}$/u.test(v.targetId))return null;
  return Buffer.from(JSON.stringify(keys.map(k=>v[k])));
 }catch{return null;}
}
type Signed<T>={terms:T;signature:string};
function g2Valid(terms:Terms,signed:unknown,pin:DisposableNativeAgedTransferPin):signed is Signed<Terms>{
 try{
  if(!exact(signed,['terms','signature'])||typeof signed.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(signed.signature))return false;
  const a=disposableNativeAgedTransferSigningBytes(terms),b=disposableNativeAgedTransferSigningBytes(signed.terms),sig=Buffer.from(signed.signature,'base64url');
  return !!a&&!!b&&a.equals(b)&&sig.toString('base64url')===signed.signature&&verify(null,a,pin.key,sig);
 }catch{return false;}
}
type Basis=Extract<ReturnType<typeof inspectRulesAgedFruitBasis>,{status:'blocked'}>;
type Ground=NonNullable<ReturnType<typeof readOwnedEmptyGround>>;
type G1=Extract<ReturnType<typeof prepareOrdinaryAgedG1ReviewEncoding>,{status:'encoding-only'}>['terms'];
type Prepared={terms:Terms;g1:Signed<G1>;basis:Basis;ground:Ground};
export function prepareDisposableNativeAgedTransfer(pin:DisposableNativeAgedTransferPin,w:World,basis:Basis,ground:Ground,signed:unknown):Prepared|null{
 if(!exact(signed,['terms','signature'])||typeof signed.signature!=='string')return null;
 const g1=prepareOrdinaryAgedG1ReviewEncoding(pin.review,basis,ground,signed);
 if(g1.status!=='encoding-only')return null;
 const auth={terms:g1.terms,signature:signed.signature};
 const terms:Terms={purpose:lane,worldId:w.id,revision:w.revision,atUs:g1.terms.atUs,untilUs:g1.terms.untilUs,
  g1Digest:hash(JSON.stringify(auth)),worldDigest:digestWorld(w),effectKeyId:pin.keyId,lotId:g1.sourceLotId,targetId:g1.targetId};
 return disposableNativeAgedTransferSigningBytes(terms)?{terms,g1:auth,basis,ground}:null;
}
export function makeDisposableNativeAgedBirth(pin:DisposableNativeAgedTransferPin,w:World,p:Prepared,g2:unknown,sourceId:string){
 if(!g2Valid(p.terms,g2,pin)||p.terms.worldDigest!==digestWorld(w)||w.clock.paused||!resolveMvpRainEpisode(w,p.basis.rainEventId))return null;
 const source=w.resources.find(r=>r.id===sourceId);
 if(!source||source.kind!=='bush'||source.foodItem!=='fruit'||!Number.isSafeInteger(source.amount)||source.amount<1||
  p.basis.sourceResourceInstanceId!==`mvp-fruit:${source.id}:${source.at.x}:${source.at.y}`)return null;
 const [_,x,y]=p.terms.targetId.split(':'),effectId='ordinary-live:'+hash(JSON.stringify(p.terms));
 const lot:AgedGroundLot={fruit:{kind:'fallen-fruit',amount:1,ownerId:'commons',effectId,sourceResourceId:sourceId,
  sourceResourceInstanceId:p.basis.sourceResourceInstanceId,sourceAt:{...source.at},rainEventId:p.basis.rainEventId,at:{x:Number(x),y:Number(y)},placedUs:p.terms.atUs},
  bornUs:p.basis.sourceLot.bornUs,expiresUs:p.basis.sourceLot.expiresUs};
 validateMvpGroundFruitState(w,{version:1,items:[lot.fruit]});
 const draft=structuredClone(w);
 if(!Number.isSafeInteger(++draft.revision))return null;
 draft.resources.find(r=>r.id===sourceId)!.amount--;
 const receipt={effectId,sourceId,sourceBefore:source.amount,sourceAfter:source.amount-1,sourceDebit:1 as const,groundCredit:1 as const,
  bornUs:lot.bornUs,expiresUs:lot.expiresUs,placedUs:lot.fruit.placedUs,placementRevision:draft.revision,productionEnabled:false as const};
 const entry={version:1 as const,p,g2:{terms:p.terms,signature:g2.signature},lot,receipt,head:digestWorld(draft),expiry:null as null|{revision:number;atUs:string;groundDebit:1}};
 return {draft,entry};
}
type PickupFact=Readonly<DisposableNativePickupWitness&{revision:number;groundDebit:1;heldCredit:1}>;
type HeldExpiry=Readonly<{atUs:string;revision:number;heldDebit:1}>;
type Entry=Omit<NonNullable<ReturnType<typeof makeDisposableNativeAgedBirth>>['entry'],'version'>&{
 readonly version:1|2;
 readonly discoveries?:readonly CommittedNativeOrdinaryAgedDiscovery[];
 readonly pickup?:PickupFact;
 readonly heldExpiry?:HeldExpiry;
};
const MAX_DISCOVERIES=64, MAX_ARCHIVE_BYTES=64*1024;
const residentId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9:_-]{1,160}$/u.test(id);
const vec=(v:unknown)=>exact(v,['x','y'])&&[v.x,v.y].every(n=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=4095);
const receiptDigest=(e:Entry)=>hash(JSON.stringify([lane,e.receipt]));
function validDiscovery(e:Entry,d:NativeOrdinaryAgedDiscovery){
 return exact(d,['schema','worldId','residentId','effectId','receiptDigest','discoveryId','atUs','fromRevision','observedRevision','observerAt','target'])&&
  d.schema==='native-ordinary-aged-ground-observation/v1'&&d.worldId===e.p.terms.worldId&&residentId(d.residentId)&&
  d.effectId===e.receipt.effectId&&d.receiptDigest===receiptDigest(e)&&d.discoveryId===mvpFallenFruitDiscoveryId(d.worldId,d.residentId,d.effectId)&&
  typeof d.atUs==='string'&&parseClimateUs(d.atUs)>parseClimateUs(e.receipt.placedUs)&&parseClimateUs(d.atUs)<parseClimateUs(e.receipt.expiresUs)&&
  Number.isSafeInteger(d.fromRevision)&&d.fromRevision>=e.receipt.placementRevision&&Number.isSafeInteger(d.observedRevision)&&d.observedRevision>=d.fromRevision&&
  vec(d.observerAt)&&vec(d.target)&&d.target.x===e.lot.fruit.at.x&&d.target.y===e.lot.fruit.at.y;
}
export function projectActiveDisposableGroundForObservation(e:Entry,head:GroundDiscoveryHead){
 if(e.expiry||e.pickup)return null;
 return Object.freeze({...head,schema:'ordinary-active-aged-ground-observation/v1' as const,
  receiptDigest:receiptDigest(e),fruit:structuredClone(e.lot.fruit),bornUs:e.lot.bornUs,expiresUs:e.lot.expiresUs});
}
export function projectActiveDisposableGroundForPickup(e:Entry,h:GroundDiscoveryHead){
 const lot=projectActiveDisposableGroundForObservation(e,h);
 return lot?{lot,discoveries:structuredClone(e.discoveries??[])}:null;
}
export function projectDisposableGroundResidentDiscovery(e:Entry,id:string){
 return residentId(id)?structuredClone(e.discoveries?.find(d=>d.residentId===id)??null):null;
}
export function hasDisposableNativeAgedTransfer(db:DatabaseSync):boolean{
 const exists=db.prepare('SELECT type,sql FROM main.sqlite_schema WHERE lower(name)=?').get(table);
 const meta=db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='archive_meta'").get();
 const anchor=meta?db.prepare('SELECT value FROM main.archive_meta WHERE key=?').get(lane):undefined;
 if(!exists&&!anchor)return false;
 if(!exists||anchor?.value!==lane)throw Error('disposable_native_aged_transfer_dependency');
 if(exists.type!=='table'||exists.sql!==ddl||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(table))
  throw Error('disposable_native_aged_transfer_schema');
 return true;
}
export function readDisposableNativeAgedTransfer(db:DatabaseSync,owner:DisposableRulesSaveAuthority,pin:DisposableNativeAgedTransferPin,w:World):Entry|null{
 if(!hasDisposableNativeAgedTransfer(db))return null;
 const rows=db.prepare(`SELECT slot,CASE WHEN length(CAST(body AS BLOB))<=${MAX_ARCHIVE_BYTES} THEN body END AS body,seal FROM main.${table} LIMIT 2`).all();
 const r=rows[0];
 if(rows.length!==1||r.slot!==1||typeof r.body!=='string'||authenticateDisposableRulesPayload(owner,lane,r.body)!==r.seal)
  throw Error('disposable_native_aged_transfer_archive');
 const e=JSON.parse(r.body) as Entry;
 const persisted=db.prepare('SELECT revision,state FROM main.worlds WHERE id=?').get(w.id);
 if(persisted?.revision!==w.revision||!(persisted.state instanceof Uint8Array)||hash(persisted.state)!==e.head)
  throw Error('disposable_native_aged_transfer_durable_head');
 const g1=prepareOrdinaryAgedG1ReviewEncoding(pin.review,e.p.basis,e.p.ground,e.p.g1);
 if(e.version!==(e.pickup?2:1)||e.head!==digestWorld(w)||w.id!==e.p.terms.worldId||w.revision<e.receipt.placementRevision||
  g1.status!=='encoding-only'||e.p.terms.g1Digest!==hash(JSON.stringify(e.p.g1))||e.p.terms.effectKeyId!==pin.keyId||
  !g2Valid(e.p.terms,e.g2,pin)||e.expiry===null&&!e.pickup&&parseClimateUs(minuteToClimateUs(w.minute))>=parseClimateUs(e.lot.expiresUs)||
  e.expiry!==null&&(e.expiry.atUs!==e.lot.expiresUs||e.expiry.revision>w.revision))throw Error('disposable_native_aged_transfer_head');
 const d=e.discoveries;
 if(d!==undefined&&(!Array.isArray(d)||d.length>MAX_DISCOVERIES||new Set(d.map(r=>r.residentId)).size!==d.length||
  d.some(({committedRevision,...r})=>!validDiscovery(e,r)||!Number.isSafeInteger(committedRevision)||committedRevision<=r.fromRevision||
   committedRevision<r.observedRevision||committedRevision>w.revision||parseClimateUs(r.atUs)>parseClimateUs(minuteToClimateUs(w.minute)))))
  throw Error('disposable_native_aged_discovery_archive');
 const p=e.pickup;
 if(p){
  const first=e.discoveries?.find(d=>d.residentId===p.residentId&&d.discoveryId===p.discoveryId),now=parseClimateUs(minuteToClimateUs(w.minute));
  if(e.expiry||!first||p.effectId!==e.receipt.effectId||p.groundDebit!==1||p.heldCredit!==1||!Number.isSafeInteger(p.revision)||
   p.revision<=first.committedRevision||p.revision>w.revision||minuteToClimateUs(p.startedAt)!==p.settledUs||
   parseClimateUs(p.settledUs)<=parseClimateUs(first.atUs)||parseClimateUs(p.settledUs)>=parseClimateUs(e.lot.expiresUs)||
   parseClimateUs(p.settledUs)>now||!p.planId.startsWith('mvp-rule-'+w.id+'-')||
   (e.heldExpiry?e.heldExpiry.atUs!==e.lot.expiresUs||e.heldExpiry.revision<=p.revision||e.heldExpiry.revision>w.revision||
    e.heldExpiry.heldDebit!==1||now<parseClimateUs(e.lot.expiresUs):now>=parseClimateUs(e.lot.expiresUs)||!livingHolder(w,p.residentId)))
   throw Error('disposable_native_aged_pickup_archive');
 }else if(e.heldExpiry)throw Error('disposable_native_aged_pickup_archive');
 return e;
}
export function writeDisposableNativeAgedTransfer(db:DatabaseSync,owner:DisposableRulesSaveAuthority,e:Entry,initial:boolean){
 if(!db.isTransaction)throw Error('disposable_native_aged_transfer_transaction');
 if(initial){db.exec(ddl);db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?)').run(lane,lane);}
 const body=JSON.stringify(e);
 if(Buffer.byteLength(body)>MAX_ARCHIVE_BYTES||db.prepare(`INSERT INTO main.${table} VALUES(1,?,?) ON CONFLICT(slot) DO UPDATE SET body=excluded.body,seal=excluded.seal`)
  .run(body,authenticateDisposableRulesPayload(owner,lane,body)).changes!==1)throw Error('disposable_native_aged_transfer_write');
}
function livingHolder(w:World,id:string){
 const r=w.residents.find(r=>r.id===id);
 return r?.status==='alive'&&r.health>0&&r.residency!=='outside'&&!r.regionalLocation?r:null;
}
export function advanceDisposableNativeAgedTransfer(e:Entry,before:World,after:World,observed:readonly NativeOrdinaryAgedDiscovery[]=[],pickup?:DisposableNativePickupWitness){
 const atUs=minuteToClimateUs(after.minute);
 if(after.id!==before.id||after.minute!==before.minute+1||after.revision<=before.revision||after.clock.paused||before.clock.paused)
  throw Error('disposable_native_aged_transfer_native_minute');
 if(e.pickup){
  if(pickup||observed.length)throw Error('disposable_native_aged_pickup_duplicate');
  if(e.heldExpiry)return {...e,head:digestWorld(after)};
  if(!livingHolder(before,e.pickup.residentId)||!livingHolder(after,e.pickup.residentId)||
   before.mvpClimate?.lastUs!==minuteToClimateUs(before.minute)||after.mvpClimate?.lastUs!==atUs||
   parseClimateUs(atUs)>parseClimateUs(e.lot.expiresUs))throw Error('disposable_native_aged_held_scope');
  return {...e,head:digestWorld(after),...(atUs===e.lot.expiresUs?{heldExpiry:{atUs,revision:after.revision,heldDebit:1 as const}}:{})};
 }
 const shift=e.expiry?null:advanceAgedGroundExpiry(before,after,[e.lot]);
 if(!e.expiry&&!shift)throw Error('disposable_native_aged_transfer_expiry');
 const expiry=shift?.expired[0];
 if(expiry&&expiry.settledUs!==e.lot.expiresUs)throw Error('disposable_native_aged_transfer_missed_expiry');
 if(pickup){
  const first=e.discoveries?.find(d=>d.residentId===pickup.residentId&&d.discoveryId===pickup.discoveryId);
  const from=livingHolder(before,pickup.residentId),to=livingHolder(after,pickup.residentId);
  if(e.expiry||expiry||!first||first.committedRevision>before.revision||pickup.effectId!==e.receipt.effectId||
   pickup.settledUs!==atUs||pickup.startedAt!==after.minute||!from||!to||from.activity||from.plan||to.activity||to.plan||
   !same(from.at,e.lot.fruit.at)||!same(to.at,e.lot.fruit.at)||to.inside!==null||
   !after.processed.includes('plan:'+pickup.planId)||JSON.stringify(from.inventory)!==JSON.stringify(to.inventory))
   throw Error('disposable_native_aged_pickup_phase');
  // No new ground discoveries are made durable on the pickup settlement minute:
  // per-resident observations do not provide ordering against that removal.
  return {...e,version:2 as const,head:digestWorld(after),pickup:{...pickup,revision:after.revision,groundDebit:1 as const,heldCredit:1 as const}};
 }
 if(observed.length&&(e.expiry||expiry||observed.length>MAX_DISCOVERIES||observed.some(d=>!validDiscovery(e,d)||
  d.fromRevision!==before.revision||d.observedRevision>after.revision||d.atUs!==atUs)))
  throw Error('disposable_native_aged_discovery_phase');
 const discoveries=[...e.discoveries??[]],seen=new Set(discoveries.map(d=>d.residentId));
 for(const d of observed)if(!seen.has(d.residentId)){seen.add(d.residentId);discoveries.push({...d,committedRevision:after.revision});}
 if(discoveries.length>MAX_DISCOVERIES)throw Error('disposable_native_aged_discovery_capacity');
 return {...e,...(discoveries.length?{discoveries}:{}),head:digestWorld(after),expiry:e.expiry??(expiry?{revision:after.revision,atUs,groundDebit:1 as const}:null)};
}
export function projectDisposableNativeAgedTransfer(e:Entry,w:World,g1?:unknown,g2?:unknown,pin?:DisposableNativeAgedTransferPin){
 if(w.clock.paused)return null;
 if(g1!==undefined||g2!==undefined){
  const expected=ordinaryAgedG1ReviewSigningBytes(e.p.g1.terms);
  if(!pin||!expected||!exact(g1,['terms','signature'])||g1.signature!==e.p.g1.signature||
   !ordinaryAgedG1ReviewSigningBytes(g1.terms)?.equals(expected)||!g2Valid(e.p.terms,g2,pin))return null;
 }
 const base={replay:true as const,receipt:e.receipt,expiry:e.expiry};
 if(e.pickup){
  return {...base,status:e.heldExpiry?'held-expired' as const:'held' as const,occupied:0 as const,
   pickup:e.pickup,heldQuantity:e.heldExpiry?0 as const:1 as const,heldExpiry:e.heldExpiry??null};
 }
 return {...base,status:e.expiry?'expired' as const:'placed' as const,occupied:e.expiry?0 as const:1 as const};
}
