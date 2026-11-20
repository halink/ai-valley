import {MVP_HALL} from '../shared/mvp-hamlet.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {agedGroundApproachPath,chooseLawfulAgedGroundPath,equalAgedGroundPath,type AgedGroundApproachPlan,type AgedGroundApproachWitness} from '../world/mvp-native-aged-ground-approach.js';
import {physiology} from '../world/physiology.js';
import type {NativeAgedEatCompletion,NativeAgedEatSelection} from '../world/mvp-aged-fruit-native-eat.js';
import {goods} from '../shared/items.js';
import type {DisposableNativePickupWitness} from './godot-mvp.js';
import {same} from '../world/navigation.js';
import {countValleySpiritFacts,mvpFallenFruitDiscoveryId} from '../shared/valley-spirit-fairness.js';
import type {GroundDiscoveryHead,NativeOrdinaryAgedDiscovery,CommittedNativeOrdinaryAgedDiscovery} from '../world/mvp-ordinary-aged-ground-discovery.js';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import type {Vec,World} from '../shared/types.js';
import {parseClimateUs,minuteToClimateUs} from '../world/mvp-climate.js';
import type {MvpFruitFlowBatch} from '../world/mvp-resources.js';
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
 const sourceFlow:SourceFlow={baselineUs:receipt.placedUs,baselineRevision:receipt.placementRevision,
  baselineQuantity:receipt.sourceAfter,observedMinutes:0,grossNaturalRenewal:0,grossOrdinaryGather:0,closingQuantity:receipt.sourceAfter};
 const entry={version:1 as const,sourceFlow,p,g2:{terms:p.terms,signature:g2.signature},lot,receipt,head:digestWorld(draft),expiry:null as null|{revision:number;atUs:string;groundDebit:1}};
 return {draft,entry};
}
type PickupFact=Readonly<DisposableNativePickupWitness&{revision:number;groundDebit:1;heldCredit:1}>;
type HeldExpiry=Readonly<{atUs:string;revision:number;heldDebit:1}>;
type SourceFlow=Readonly<{baselineUs:string;baselineRevision:number;baselineQuantity:number;observedMinutes:number;
 grossNaturalRenewal:number;grossOrdinaryGather:number;closingQuantity:number}>;
type Entry=Omit<NonNullable<ReturnType<typeof makeDisposableNativeAgedBirth>>['entry'],'version'|'sourceFlow'>&{
 readonly sourceFlow?:SourceFlow|null;
 readonly version:1|2|3|4|5|6;
 readonly discoveries?:readonly CommittedNativeOrdinaryAgedDiscovery[];
 readonly pickup?:PickupFact;
 readonly heldExpiry?:HeldExpiry;
 readonly eating?:Eating;
 readonly eaten?:Eaten;
 readonly approach?:Approach;
 readonly lastApproach?:ApproachResult;
};
// Persist the legacy one-edge shape unchanged; two-edge routes add the exact
// ordered commit minute of each real edge (two edges may share a minute).
type Approach=Readonly<{plan:AgedGroundApproachPlan;enteredAtUs?:string;stepTimesUs?:readonly string[]}>;
type ApproachResult=Readonly<{approach:Approach;revision:number;finishedAtUs:string}&(
 {result:'completed'|'interrupted'}|{result:'superseded-by-pickup';pickupResidentId:string;pickupPlanId:string}
)>;
const approachTimes=(a:Approach):readonly string[]=>a.stepTimesUs??(a.enteredAtUs?[a.enteredAtUs]:[]);
function exactMove(w:World,approach:Approach){
 const p=approach.plan;
 const r=w.residents.find(r=>r.id===p.residentId),a=r?.activity;
 if(!r||!a||!r.plan||r.plan.id!==p.planId||a.planId!==p.planId||r.plan.createdAt!==p.startedFromMinute||
  r.plan.actorId!==r.id||r.plan.actions.length!==0||a.action.type!=='move'||!same(a.action.to,p.to)||
  !same(a.target,p.to)||a.room||r.inside!==null||a.startedAt!==p.startedFromMinute+1||
  !Number.isFinite(a.travelProgress??0)||(a.travelProgress??0)<0||(a.travelProgress??0)>=1)return null;
 const path=agedGroundApproachPath(p),completed=approachTimes(approach).length;
 if(!same(r.at,completed?path[completed-1]:p.from)||!equalAgedGroundPath(a.path,path.slice(completed)))return null;
 if(completed<path.length)return 'in-flight' as const;
 return (a.travelProgress??0)===0?'entered' as const:null;
}
function validateApproach(e:Entry,w:World,a:Approach){
 const p=a.plan,first=e.discoveries?.find(d=>d.residentId===p.residentId&&d.discoveryId===p.discoveryId);
 if(!first||p.effectId!==e.receipt.effectId||p.expiresUs!==e.lot.expiresUs||!same(p.to,e.lot.fruit.at)||!vec(p.from)||
  !Number.isSafeInteger(p.startedFromMinute)||p.startedFromMinute<0||w.minute<p.startedFromMinute+1||
  parseClimateUs(first.atUs)>BigInt(p.startedFromMinute)*1_000_000n||
  !p.planId.startsWith('mvp-rule-'+w.id+'-')||!w.processed.includes('plan:'+p.planId))return false;
 const at=(p:Vec)=>vec(p)&&p.x>=0&&p.y>=0&&p.x<w.map.width&&p.y<w.map.height;
 const steps=agedGroundApproachPath(p),times=approachTimes(a);
 if(p.path===undefined?a.stepTimesUs!==undefined:!Array.isArray(p.path)||p.path.length!==2||!Array.isArray(a.stepTimesUs))return false;
 const latest=times.at(-1);
 return at(p.from)&&steps.every((q,i)=>{
  const from=i?steps[i-1]:p.from;
  return at(q)&&Math.abs(from.x-q.x)+Math.abs(from.y-q.y)===1&&!same(q,p.from);
 })&&same(steps.at(-1)!,p.to)&&times.length<=steps.length&&
  a.enteredAtUs===(times.length===steps.length?latest:undefined)&&times.every((t,i)=>typeof t==='string'&&
   parseClimateUs(t)>=BigInt(p.startedFromMinute+1)*1_000_000n&&parseClimateUs(t)<parseClimateUs(p.expiresUs)&&
   parseClimateUs(t)<=parseClimateUs(minuteToClimateUs(w.minute))&&(!i||parseClimateUs(t)>=parseClimateUs(times[i-1])));
}
export function projectCurrentDisposableGroundApproach(e:Entry){
 return structuredClone(e.approach?.plan??null);
}
function stageApproach(e:Entry,before:World,after:World,witness:AgedGroundApproachWitness|undefined,atUs:string,pickup?:DisposableNativePickupWitness){
 const old=e.approach,p=witness?.plan;
 if(!p){
  if(old)throw Error('disposable_native_ground_approach_missing_witness');
  return {approach:undefined,lastApproach:e.lastApproach};
 }
 if(e.pickup||e.expiry||old&&!sameJson(old.plan,p))throw Error('disposable_native_ground_approach_scope');
 const a=before.residents.find(r=>r.id===p.residentId),b=after.residents.find(r=>r.id===p.residentId);
 if(!a||!b||!old&&(p.startedFromMinute!==before.minute||e.lastApproach||!same(a.at,p.from)||a.activity||a.plan||
   !equalAgedGroundPath(chooseLawfulAgedGroundPath(before,a,p.to)??[],agedGroundApproachPath(p)))||old&&!exactMove(before,old))throw Error('disposable_native_ground_approach_start');
 const path=agedGroundApproachPath(p),times=[...(old?approachTimes(old):[])];
 let pos=a.at;
 for(const edge of witness.edges){
  if(!path[times.length]||!same(edge.from,pos)||!same(edge.to,path[times.length])||
   parseClimateUs(atUs)>=parseClimateUs(p.expiresUs))throw Error('disposable_native_ground_approach_edge');
  pos=edge.to;times.push(atUs);
 }
 if(!same(pos,b.at))throw Error('disposable_native_ground_approach_unverified_motion');
 const approach={plan:p,...(p.path?{stepTimesUs:times}:{}),...(times.length===path.length?{enteredAtUs:times.at(-1)!}:{})};
 if(!validateApproach(e,after,approach))throw Error('disposable_native_ground_approach_evidence');
 const phase=exactMove(after,approach), superseded=witness.supersededBy;
 if(superseded){
  if(!old||!pickup||witness.stopped||phase||b.activity||b.plan||
   pickup.settledUs!==atUs||pickup.effectId!==p.effectId||pickup.residentId===p.residentId||
   pickup.residentId!==superseded.residentId||pickup.planId!==superseded.planId||
   parseClimateUs(atUs)>=parseClimateUs(p.expiresUs))
   throw Error('disposable_native_ground_approach_pickup_order');
  return {approach:undefined,lastApproach:{approach,revision:after.revision,finishedAtUs:atUs,
   result:'superseded-by-pickup' as const,pickupResidentId:pickup.residentId,pickupPlanId:pickup.planId}};
 }
 if(phase){
  if(pickup)throw Error('disposable_native_ground_approach_unretired');

  if(witness.stopped||parseClimateUs(atUs)>=parseClimateUs(p.expiresUs)||(phase==='entered')!==!!approach.enteredAtUs)
   throw Error('disposable_native_ground_approach_phase');
  return {approach,lastApproach:e.lastApproach};
 }
 if(b.activity?.planId===p.planId||b.plan?.id===p.planId)throw Error('disposable_native_ground_approach_orphan');
 const completed=!!approach.enteredAtUs&&!b.lastFailure&&!witness.stopped&&same(b.at,p.to)&&parseClimateUs(atUs)<parseClimateUs(p.expiresUs);
 return {approach:undefined,lastApproach:{approach,revision:after.revision,finishedAtUs:atUs,result:completed?'completed' as const:'interrupted' as const}};
}
type DiningPlace=NonNullable<NativeAgedEatCompletion['dining']>;
type DiningEating=Readonly<{dining:DiningPlace;phase:'outdoor-route'|'indoor-route'|'seated'|'work';workStartedAt?:number}>;
export type Eating=Readonly<{residentId:string;planId:string;effectId:string;startedAt:number;worked:number;table?:DiningEating}>;
type Eaten=Readonly<NativeAgedEatCompletion&{eventId:string;eventDigest:string;revision:number;heldDebit:1}>;
function sameJson(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function agedEatActor(r:World['residents'][number]){
 return r.activity?.action.type==='mvpAgedFruitEat'||r.plan?.actions.some(a=>a.type==='mvpAgedFruitEat')||
  r.activity?.mvpAgedEatWorkStartedAt!==undefined;
}
function diningWorkClaim(w:World,r:World['residents'][number],d:DiningPlace){
 return r.inside===d.buildingId&&!!r.roomAt&&same(r.roomAt,d.seat)&&w.rooms?.tick===w.minute&&
  w.rooms.claims.filter(c=>c.buildingId===d.buildingId&&c.key===d.key).length===1&&
  w.rooms.claims.some(c=>c.buildingId===d.buildingId&&c.key===d.key&&c.group===r.id&&c.people.length===1&&c.people[0]===r.id);
}
const diningPhaseOrder=['outdoor-route','indoor-route','seated','work'] as const;
function exactDiningActivity(w:World,r:World['residents'][number],expected:Eating){
 const a=r.activity!,d=a.action.type==='mvpAgedFruitEat'?a.action.dining:undefined,t=expected.table;
 if(!d||!t||!exact(a.action,['type','effectId','dining'])||!exact(d,['buildingId','key','seat'])||
  d.buildingId!==MVP_HALL||!sameJson(d,t.dining))return false;
 const b=w.buildings.find(b=>b.id===d.buildingId);
 if(!b||b.kind!=='lodge'||b.ownerId!=='commons'||!same(a.target,b.door))return false;
 const layout=roomLayout(w,b),slot=layout.slots.find(s=>s.kind==='seat'&&s.key===d.key);
 if(!slot||!same(slot.at,d.seat)||a.room?.mode==='exit')return false;
 if(t.phase==='work'){
  return Number.isSafeInteger(t.workStartedAt)&&t.workStartedAt!>=a.startedAt&&a.mvpAgedEatWorkStartedAt===t.workStartedAt&&
   expected.worked>=1&&expected.worked<=4&&w.minute===t.workStartedAt!+expected.worked-1&&
   !a.room&&!a.path.length&&diningWorkClaim(w,r,d);
 }
 if(expected.worked!==0||t.workStartedAt!==undefined||a.mvpAgedEatWorkStartedAt!==undefined)return false;
 if(t.phase==='outdoor-route')return r.inside===null&&!a.room&&
  (a.path.length?same(a.path.at(-1)!,b.door):same(r.at,b.door));
 if(!same(r.at,b.door)||a.path.length||r.inside!==d.buildingId||!r.roomAt)return false;
 if(t.phase==='seated')return !a.room&&same(r.roomAt,d.seat);
 const j=a.room;
 return t.phase==='indoor-route'&&!!j&&j.mode==='work'&&j.buildingId===d.buildingId&&same(j.target,d.seat)&&
  j.path.length>0&&same(j.path.at(-1)!,d.seat)&&roomPath(layout,r.roomAt,d.seat)!==null;
}
export function exactDisposableEating(w:World,expected?:Eating):boolean{
 if(!expected)return !w.residents.some(agedEatActor);
 const actors=w.residents.filter(agedEatActor);
 if(actors.length!==1||actors[0].id!==expected.residentId)return false;
 const r=actors[0],a=r.activity,p=r.plan;
 if(!a||!p||r.regionalLocation||r.status!=='alive'||a.action.type!=='mvpAgedFruitEat'||
  a.action.effectId!==expected.effectId||p.id!==expected.planId||p.actorId!==r.id||p.actions.length!==0||
  a.planId!==p.id||a.startedAt!==expected.startedAt||!Number.isSafeInteger(a.startedAt)||a.startedAt>w.minute||p.createdAt!==a.startedAt-1||
  !Number.isSafeInteger(expected.worked)||a.remaining!==5-expected.worked||!w.processed.includes('plan:'+p.id))return false;
 if(expected.table)return exactDiningActivity(w,r,expected);
 return r.inside===null&&exact(a.action,['type','effectId'])&&a.path.length===0&&!a.room&&a.mvpAgedEatWorkStartedAt===undefined&&
  same(a.target,r.at)&&expected.worked>=1&&expected.worked<=4&&w.minute===expected.startedAt+expected.worked-1;
}
function readEating(w:World,holderId:string,effectId:string):Eating|undefined{
 if(!w.residents.some(agedEatActor))return undefined;
 const r=w.residents.find(r=>r.id===holderId),a=r?.activity;
 if(!r||!a||a.action.type!=='mvpAgedFruitEat')throw Error('disposable_native_aged_eat_foreign');
 const d=a.action.dining,workStartedAt=a.mvpAgedEatWorkStartedAt;
 const table:DiningEating|undefined=d?{dining:structuredClone(d),phase:workStartedAt!==undefined?'work':
  r.inside===null?'outdoor-route':a.room?'indoor-route':'seated',...(workStartedAt!==undefined?{workStartedAt}:{})}:undefined;
 const work={residentId:holderId,planId:a.planId,effectId,startedAt:a.startedAt,worked:5-a.remaining,...(table?{table}:{})};
 if(!exactDisposableEating(w,work))throw Error('disposable_native_aged_eat_activity');
 return work;
}
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
 return lot?{lot,discoveries:structuredClone(e.discoveries??[]),approachAlreadyUsed:!!(e.approach||e.lastApproach)}:null;
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
 if((e.version===6?!e.pickup||!!e.approach:e.lastApproach?.result==='superseded-by-pickup'?e.version!==5:
  e.approach||e.lastApproach?e.version!==4:e.pickup?e.version!==2&&e.version!==3:e.version!==1)||
  (e.eating?.table||e.eaten?.dining)&&e.version!==6||
  (e.eating||e.eaten)&&e.version!==3&&e.version!==4&&e.version!==5&&e.version!==6||e.head!==digestWorld(w)||w.id!==e.p.terms.worldId||w.revision<e.receipt.placementRevision||
  g1.status!=='encoding-only'||e.p.terms.g1Digest!==hash(JSON.stringify(e.p.g1))||e.p.terms.effectKeyId!==pin.keyId||
  !g2Valid(e.p.terms,e.g2,pin)||e.expiry===null&&!e.pickup&&parseClimateUs(minuteToClimateUs(w.minute))>=parseClimateUs(e.lot.expiresUs)||
  e.expiry!==null&&(e.expiry.atUs!==e.lot.expiresUs||e.expiry.revision>w.revision))throw Error('disposable_native_aged_transfer_head');
 if(e.sourceFlow!==undefined&&e.sourceFlow!==null&&!validSourceFlow(e,e.sourceFlow,w))
  throw Error('disposable_native_aged_source_flow_archive');
 const d=e.discoveries;
 if(d!==undefined&&(!Array.isArray(d)||d.length>MAX_DISCOVERIES||new Set(d.map(r=>r.residentId)).size!==d.length||
  d.some(({committedRevision,...r})=>!validDiscovery(e,r)||!Number.isSafeInteger(committedRevision)||committedRevision<=r.fromRevision||
   committedRevision<r.observedRevision||committedRevision>w.revision||parseClimateUs(r.atUs)>parseClimateUs(minuteToClimateUs(w.minute)))))
  throw Error('disposable_native_aged_discovery_archive');
 if(e.approach&&(e.pickup||e.expiry||e.lastApproach||!validateApproach(e,w,e.approach)||
   !exactMove(w,e.approach)||(exactMove(w,e.approach)==='entered')!==!!e.approach.enteredAtUs)||
  e.lastApproach&&(!validateApproach(e,w,e.lastApproach.approach)||!Number.isSafeInteger(e.lastApproach.revision)||e.lastApproach.revision>w.revision||
   !['completed','interrupted','superseded-by-pickup'].includes(e.lastApproach.result)||
   e.lastApproach.result==='superseded-by-pickup'&&(!e.pickup||e.approach||e.expiry||
    e.lastApproach.pickupResidentId!==e.pickup.residentId||e.lastApproach.pickupPlanId!==e.pickup.planId||
    e.lastApproach.approach.plan.residentId===e.pickup.residentId||e.lastApproach.revision!==e.pickup.revision||
    e.lastApproach.finishedAtUs!==e.pickup.settledUs||
    e.lastApproach.approach.enteredAtUs!==undefined&&parseClimateUs(e.lastApproach.approach.enteredAtUs)>parseClimateUs(e.pickup.settledUs))||
   parseClimateUs(e.lastApproach.finishedAtUs)<BigInt(e.lastApproach.approach.plan.startedFromMinute+1)*1_000_000n||
   parseClimateUs(e.lastApproach.finishedAtUs)>parseClimateUs(minuteToClimateUs(w.minute))||
   approachTimes(e.lastApproach.approach).some(t=>parseClimateUs(t)>parseClimateUs(e.lastApproach!.finishedAtUs))||
   e.lastApproach.result==='completed'&&(!e.lastApproach.approach.enteredAtUs||
    parseClimateUs(e.lastApproach.finishedAtUs)<=parseClimateUs(e.lastApproach.approach.enteredAtUs)||
    parseClimateUs(e.lastApproach.finishedAtUs)>=parseClimateUs(e.lot.expiresUs))))
  throw Error('disposable_native_ground_approach_archive');
 const p=e.pickup;
 if(p){
  const first=e.discoveries?.find(d=>d.residentId===p.residentId&&d.discoveryId===p.discoveryId),now=parseClimateUs(minuteToClimateUs(w.minute));
  if(e.expiry||!first||p.effectId!==e.receipt.effectId||p.groundDebit!==1||p.heldCredit!==1||!Number.isSafeInteger(p.revision)||
   p.revision<=first.committedRevision||p.revision>w.revision||minuteToClimateUs(p.startedAt)!==p.settledUs||
   parseClimateUs(p.settledUs)<=parseClimateUs(first.atUs)||parseClimateUs(p.settledUs)>=parseClimateUs(e.lot.expiresUs)||
   parseClimateUs(p.settledUs)>now||!p.planId.startsWith('mvp-rule-'+w.id+'-')||
   (e.heldExpiry?e.heldExpiry.atUs!==e.lot.expiresUs||e.heldExpiry.revision<=p.revision||e.heldExpiry.revision>w.revision||
    e.heldExpiry.heldDebit!==1||now<parseClimateUs(e.lot.expiresUs):e.eaten?false:now>=parseClimateUs(e.lot.expiresUs)||!livingHolder(w,p.residentId)))
   throw Error('disposable_native_aged_pickup_archive');
 }else if(e.heldExpiry||e.eating||e.eaten)throw Error('disposable_native_aged_pickup_archive');
 if(!exactDisposableEating(w,e.eating)||e.eating&&(e.eaten||e.heldExpiry||e.eating.residentId!==p?.residentId||e.eating.effectId!==e.receipt.effectId))
  throw Error('disposable_native_aged_eat_archive');
 if(e.eaten){
  const f=e.eaten,now=parseClimateUs(minuteToClimateUs(w.minute));
  const archived=db.prepare('SELECT id,world_id,at,rowid AS seq,body FROM main.events WHERE id=?').get(f.eventId);
  const actors=db.prepare('SELECT world_id,person_id,event_id,event_seq FROM main.event_people WHERE event_id=? LIMIT 2').all(f.eventId);
  const animals=db.prepare('SELECT 1 FROM main.event_animals WHERE event_id=? LIMIT 1').get(f.eventId);
  if(e.heldExpiry||!p||f.residentId!==p.residentId||f.heldDebit!==1||f.workMinutes!==5||f.nutrition!==goods.fruit.food||
   parseClimateUs(f.startedUs)<=parseClimateUs(p.settledUs)||parseClimateUs(f.settledUs)-parseClimateUs(f.startedUs)!==4_000_000n||
   parseClimateUs(f.settledUs)>=parseClimateUs(e.lot.expiresUs)||parseClimateUs(f.settledUs)>now||f.revision<=p.revision||f.revision>w.revision||
   archived?.id!==f.eventId||archived.world_id!==w.id||typeof archived.at!=='number'||minuteToClimateUs(archived.at)!==f.settledUs||
   typeof archived.body!=='string'||hash(archived.body)!==f.eventDigest||actors.length!==1||actors[0].world_id!==w.id||
   actors[0].event_id!==f.eventId||actors[0].event_seq!==archived.seq||actors[0].person_id!==f.residentId||animals)
   throw Error('disposable_native_aged_eat_event');
  if(f.dining){
   const event=JSON.parse(archived.body);
   if(f.dining.buildingId!==MVP_HALL||event.roomId!==f.dining.buildingId||!event.roomAt||!same(event.roomAt,f.dining.seat))
    throw Error('disposable_native_aged_eat_room_event');
  }
 }
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
export function projectDisposableHeldForNativeEating(e:Entry):NativeAgedEatSelection|null{
 return e.pickup&&!e.heldExpiry&&!e.eaten?Object.freeze({residentId:e.pickup.residentId,effectId:e.receipt.effectId,
  expiresUs:e.lot.expiresUs,table:true as const,disposableEvent:true as const}):null;
}
export function advanceDisposableNativeAgedTransfer(e:Entry,before:World,after:World,observed:readonly NativeOrdinaryAgedDiscovery[]=[],pickup?:DisposableNativePickupWitness,
 scope?:NativeAgedEatSelection,completed?:NativeAgedEatCompletion,route?:AgedGroundApproachWitness){
 const atUs=minuteToClimateUs(after.minute);
 if(after.id!==before.id||after.minute!==before.minute+1||after.revision<=before.revision||after.clock.paused||before.clock.paused)
  throw Error('disposable_native_aged_transfer_native_minute');
 if(e.pickup){
  if(pickup||observed.length||route?.plan||e.approach)throw Error('disposable_native_aged_pickup_duplicate');
  if(e.heldExpiry||e.eaten){
   if(scope||completed||!exactDisposableEating(after))throw Error('disposable_native_aged_eat_duplicate');
   return {...e,head:digestWorld(after)};
  }
  const expected=projectDisposableHeldForNativeEating(e),holder=e.pickup.residentId;
  if(!expected||!sameJson(scope,expected)||!exactDisposableEating(before,e.eating)||!livingHolder(before,holder)||!livingHolder(after,holder)||
   before.mvpClimate?.lastUs!==minuteToClimateUs(before.minute)||after.mvpClimate?.lastUs!==atUs||
   parseClimateUs(atUs)>parseClimateUs(e.lot.expiresUs))throw Error('disposable_native_aged_held_scope');
  const work=readEating(after,holder,e.receipt.effectId);
  if(atUs===e.lot.expiresUs){
   if(work||completed)throw Error('disposable_native_aged_eat_expiry_priority');
   const {eating:_old,...rest}=e;
   return {...rest,head:digestWorld(after),heldExpiry:{atUs,revision:after.revision,heldDebit:1 as const}};
  }
  if(completed){
   const previous=e.eating,event=after.events.find(x=>x.id===completed.eventId),old=livingHolder(before,holder)!,next=livingHolder(after,holder)!;
   if(work||!previous||previous.worked!==4||completed.residentId!==holder||completed.workMinutes!==5||
    !sameJson(completed.dining,previous.table?.dining)||
    completed.planId!==previous.planId||completed.startedUs!==minuteToClimateUs(previous.table?.workStartedAt??previous.startedAt)||completed.settledUs!==atUs||
    completed.dining&&(!diningWorkClaim(after,next,completed.dining)||!event?.roomAt||
     event.roomId!==completed.dining.buildingId||!same(event.roomAt,completed.dining.seat))||
    completed.nutrition!==goods.fruit.food||completed.hungerAfter!==Math.max(0,completed.hungerBefore-completed.nutrition)||
    old.hunger!==completed.hungerBefore||next.hunger!==Math.min(100,completed.hungerAfter+physiology(after,next).hungerPerMinute)||
    !sameJson(old.inventory,next.inventory)||
    !event||event.kind!=='action'||event.at!==after.minute||event.actors.length!==1||event.actors[0]!==holder||!event.observerOnly||
    before.events.some(x=>x.id===event.id))throw Error('disposable_native_aged_eat_completion');
   const {eating:_old,...rest}=e;
   return {...rest,version:e.version===6||e.lastApproach?e.version:3 as const,head:digestWorld(after),eaten:{...completed,eventId:event.id,eventDigest:hash(JSON.stringify(event)),
    revision:after.revision,heldDebit:1 as const}};
  }
  if(work){
   const prior=e.eating,age=work.table;
   if(prior&&(work.planId!==prior.planId||work.startedAt!==prior.startedAt||!sameJson(age?.dining,prior.table?.dining)||
    age&&prior.table&&diningPhaseOrder.indexOf(age.phase)<diningPhaseOrder.indexOf(prior.table.phase))||
    !age&&work.worked!==(prior?.worked??0)+1||age&&(prior?.worked?
     work.worked!==prior.worked+1||age.workStartedAt!==prior.table?.workStartedAt:work.worked>1)||
    age&&work.worked>0&&(!age.workStartedAt||!diningWorkClaim(after,livingHolder(after,holder)!,age.dining)))
    throw Error('disposable_native_aged_eat_work');
  }
  const {eating:_old,...rest}=e;
  return {...rest,version:work?.table||e.version===6?6 as const:work&&!e.lastApproach?3 as const:e.version,...(work?{eating:work}:{}),head:digestWorld(after)};
 }
 if(scope||completed||!exactDisposableEating(after))throw Error('disposable_native_aged_eat_without_held');
 const routed=stageApproach(e,before,after,route,atUs,pickup);
 const {approach:_oldRoute,lastApproach:_oldResult,...rest}=e;
 const routeState={...rest,...(routed.approach?{approach:routed.approach}:{}),...(routed.lastApproach?{lastApproach:routed.lastApproach}:{}),
  version:routed.lastApproach?.result==='superseded-by-pickup'?5 as const:routed.approach||routed.lastApproach?4 as const:e.version};
 const shift=e.expiry?null:advanceAgedGroundExpiry(before,after,[e.lot]);
 if(!e.expiry&&!shift)throw Error('disposable_native_aged_transfer_expiry');
 const expiry=shift?.expired[0];
 if(expiry&&expiry.settledUs!==e.lot.expiresUs)throw Error('disposable_native_aged_transfer_missed_expiry');
 if(pickup){
  const first=e.discoveries?.find(d=>d.residentId===pickup.residentId&&d.discoveryId===pickup.discoveryId);
  const from=livingHolder(before,pickup.residentId),to=livingHolder(after,pickup.residentId);
  if(e.expiry||expiry||routeState.approach||route?.plan&&!e.approach||!first||first.committedRevision>before.revision||pickup.effectId!==e.receipt.effectId||
   pickup.settledUs!==atUs||pickup.startedAt!==after.minute||!from||!to||from.activity||from.plan||to.activity||to.plan||
   !same(from.at,e.lot.fruit.at)||!same(to.at,e.lot.fruit.at)||to.inside!==null||
   !after.processed.includes('plan:'+pickup.planId)||JSON.stringify(from.inventory)!==JSON.stringify(to.inventory))
   throw Error('disposable_native_aged_pickup_phase');
  // No new ground discoveries are made durable on the pickup settlement minute:
  // per-resident observations do not provide ordering against that removal.
  return {...routeState,version:routeState.lastApproach?routeState.version:2 as const,head:digestWorld(after),pickup:{...pickup,revision:after.revision,groundDebit:1 as const,heldCredit:1 as const}};
 }
 if(observed.length&&(e.expiry||expiry||observed.length>MAX_DISCOVERIES||observed.some(d=>!validDiscovery(e,d)||
  d.fromRevision!==before.revision||d.observedRevision>after.revision||d.atUs!==atUs)))
  throw Error('disposable_native_aged_discovery_phase');
 const discoveries=[...e.discoveries??[]],seen=new Set(discoveries.map(d=>d.residentId));
 for(const d of observed)if(!seen.has(d.residentId)){seen.add(d.residentId);discoveries.push({...d,committedRevision:after.revision});}
 if(discoveries.length>MAX_DISCOVERIES)throw Error('disposable_native_aged_discovery_capacity');
 return {...routeState,...(discoveries.length?{discoveries}:{}),head:digestWorld(after),expiry:e.expiry??(expiry?{revision:after.revision,atUs,groundDebit:1 as const}:null)};
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
  return {...base,status:e.eaten?'eaten' as const:e.heldExpiry?'held-expired' as const:'held' as const,occupied:0 as const,
   pickup:e.pickup,heldQuantity:e.eaten||e.heldExpiry?0 as const:1 as const,heldExpiry:e.heldExpiry??null,eaten:e.eaten??null};
 }
 return {...base,status:e.expiry?'expired' as const:'placed' as const,occupied:e.expiry?0 as const:1 as const};
}

export function readExactDisposableActiveEating(db:DatabaseSync,owner:DisposableRulesSaveAuthority,pin:DisposableNativeAgedTransferPin,w:World){
 if(!Array.isArray(w.residents)||!w.residents.some(agedEatActor))return null;
 const entry=readDisposableNativeAgedTransfer(db,owner,pin,w);
 return entry?.eating&&exactDisposableEating(w,entry.eating)?entry.eating:null;
}

/** A scoped view over the one authenticated native effect, not a census of
 * proposals, residents or world fruit. Call only after the owning snapshot
 * validates the archive, both historical signatures and the live disclosure. */
export function projectDisposableNativeAgedFairness(e:Entry,head:GroundDiscoveryHead){
 const discoveries=e.discoveries??[],pickups=e.pickup?[e.pickup]:[];
 const byTarget=[{key:e.p.terms.targetId,count:1}];
 return {
  status:'ready',audience:'internal-audit',schemaVersion:1,coverage:'single-disposable-native-effect',
  worldId:head.worldId,throughRevision:head.revision,throughUs:head.atUs,
  proposalDirections:{status:'ready',coverage:'authenticated-linked-proposal-only',count:1,byTarget,
   total:{status:'unavailable',code:'no-complete-proposal-coverage'}},
  actualEffects:{status:'ready',count:1,byTarget},
  actualDiscoveries:{status:'ready',count:discoveries.length,byResident:countValleySpiritFacts(discoveries,d=>d.residentId)},
  actualPickups:{status:'ready',count:pickups.length,byResident:countValleySpiritFacts(pickups,p=>p.residentId)},
  supply:{
   item:'fruit',fallTransfer:{sourceDebit:e.receipt.sourceDebit,groundCredit:e.receipt.groundCredit,directNewSupply:0},
   pickupTransfer:{groundDebit:e.pickup?.groundDebit??0,residentHeldCredit:e.pickup?.heldCredit??0},
   groundExpiryDebit:e.expiry?.groundDebit??0,
   sourceFlow:e.sourceFlow?{status:'ready',coverage:'contiguous-native-minutes-after-placement',...e.sourceFlow}:
    {status:'unavailable',code:'no-cumulative-source-flow-coverage'},
   causalGain:{status:'unavailable',code:'requires-counterfactual'},
  },
  executionAuthorized:false,productionEnabled:false,
 } as const;
}

const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function validSourceFlow(e:Entry,x:SourceFlow,w:World):boolean{
 const sources=w.resources.filter(r=>r.id===e.receipt.sourceId);
 const source=sources[0];
 return exact(x,['baselineUs','baselineRevision','baselineQuantity','observedMinutes','grossNaturalRenewal',
  'grossOrdinaryGather','closingQuantity'])&&x.baselineUs===e.receipt.placedUs&&x.baselineRevision===e.receipt.placementRevision&&
  x.baselineQuantity===e.receipt.sourceAfter&&[x.baselineQuantity,x.observedMinutes,x.grossNaturalRenewal,x.grossOrdinaryGather,x.closingQuantity].every(count)&&
  BigInt(x.observedMinutes)*1_000_000n===parseClimateUs(minuteToClimateUs(w.minute))-parseClimateUs(x.baselineUs)&&
  BigInt(x.baselineQuantity)+BigInt(x.grossNaturalRenewal)-BigInt(x.grossOrdinaryGather)===BigInt(x.closingQuantity)&&
  sources.length===1&&source.kind==='bush'&&source.foodItem==='fruit'&&same(source.at,e.lot.fruit.sourceAt)&&source.amount===x.closingQuantity;
}

/** Join only the exact authenticated native minute carried into the same WorldStore
 * transaction. A gap is permanently unavailable; never repair from net stock. */
export function advanceDisposableNativeAgedSourceFlow(e:Entry,before:World,after:World,flow:MvpFruitFlowBatch|null):Entry{
 const old=e.sourceFlow;
 if(!old)return e;
 const id=e.receipt.sourceId;
 if(!flow||flow.worldId!==after.id||flow.fromRevision!==before.revision||flow.toRevision!==after.revision||
  flow.fromUs!==minuteToClimateUs(before.minute)||flow.toUs!==minuteToClimateUs(after.minute)||
  flow.opening.find(r=>r.sourceId===id)?.amount!==old.closingQuantity)return {...e,sourceFlow:null};
 let grossNaturalRenewal=old.grossNaturalRenewal,grossOrdinaryGather=old.grossOrdinaryGather;
 for(const op of flow.operations){
  if(op.kind==='gather'&&op.sourceId===id)grossOrdinaryGather+=op.quantity;
  if(op.kind==='renewal'&&op.witness.sourceId===id)grossNaturalRenewal+=op.witness.naturallyRenewed;
 }
 const closingQuantity=flow.closing.find(r=>r.sourceId===id)?.amount;
 if(closingQuantity===undefined)return {...e,sourceFlow:null};
 const sourceFlow={...old,observedMinutes:old.observedMinutes+1,grossNaturalRenewal,grossOrdinaryGather,closingQuantity};
 return {...e,sourceFlow:validSourceFlow(e,sourceFlow,after)?sourceFlow:null};
}
