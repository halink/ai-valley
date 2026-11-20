import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import type {NativeOrdinaryAgedDiscovery} from '../world/mvp-ordinary-aged-ground-discovery.js';
import {prepareOrdinaryAgedGroundPickup} from './valley-spirit-ordinary-aged-pickup.js';
import {parseClimateUs} from '../world/mvp-climate.js';
import {prepareSealedMvpEcologyMinute,prepareStoppedOrdinaryAgedGroundMinute} from './godot-mvp.js';
import {advanceAgedGroundExpiry,type AgedGroundLot} from './valley-spirit-ordinary-aged-ground.js';

export const stoppedContinuationTable='valley_spirit_ordinary_aged_continuation';
export const stoppedContinuationSql='CREATE TABLE valley_spirit_ordinary_aged_continuation(sequence INTEGER PRIMARY KEY NOT NULL,body TEXT NOT NULL)';
const maxSteps=8,maxHeldSteps=48,maxEvents=4096,maxStepBytes=65536;
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const bytes=(w:World)=>gzipSync(JSON.stringify(w),{level:1});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function invalid():never{throw Error('ordinary_stopped_continuation_invalid');}
const pickupSchema='ordinary-stopped-native-pickup/v1',heldSchema='ordinary-stopped-native-held-minute/v1';
type Pickup=NonNullable<ReturnType<typeof prepareOrdinaryAgedGroundPickup>>['completion'];
export interface StoppedOrdinaryHeldFruit {
 readonly schema:'ordinary-stopped-held-fruit/v1';readonly holderId:string;readonly lot:AgedGroundLot;
 readonly pickup:Pickup;readonly groundDebit:1;readonly heldCredit:1;
}
type Eat=NonNullable<NonNullable<ReturnType<typeof prepareSealedMvpEcologyMinute>>['eaten']>;
type HeldDisposition=Readonly<{effectId:string;bornUs:string;expiresUs:string;heldDebit:1}&({kind:'expired';settledUs:string}|{kind:'eaten';witness:Eat})>;
type Expiry=NonNullable<ReturnType<typeof advanceAgedGroundExpiry>>['expired'][number];
export interface StoppedGroundReplay{
 readonly world:World;readonly lot:AgedGroundLot|null;readonly receiptDigest:string;readonly sequence:number;
 readonly discoveries:ReadonlyMap<string,NativeOrdinaryAgedDiscovery>;readonly expiry:Expiry|null;
 readonly held?:StoppedOrdinaryHeldFruit;readonly heldSteps?:number;readonly heldDisposition?:HeldDisposition;
}
function nativeEvents(prior:World,draft:World){
 if(draft.events.length>maxEvents||!same(draft.events.slice(0,prior.events.length),prior.events))return null;
 const events=draft.events.slice(prior.events.length);
 return events.length>128||events.some(e=>e.kind==='conversation'||e.speechText!==undefined||e.mvpMeal||e.socialAppointmentArrival||e.mvpFruitFall||
   e.id.length>320||!e.id.startsWith(prior.id+':event:')||e.at!==draft.minute)?null:events;
}
export function prepareStoppedGroundReplayMinute(current:StoppedGroundReplay,pickup=false){
 if(!current.lot||current.expiry||current.sequence>=maxSteps)return null;
 const prior=current.world,lot=current.lot;
 if(pickup){
  if(!current.sequence||!current.discoveries.size)return null;
  const next=prepareOrdinaryAgedGroundPickup(prior,{readExactPickupEvidence(h){
   if(h.worldId!==prior.id||h.revision!==prior.revision||h.atUs!==prior.mvpClimate?.lastUs)return null;
   return {lot:{...h,schema:'ordinary-active-aged-ground-observation/v1',receiptDigest:current.receiptDigest,...lot},
    discoveries:[...current.discoveries.values()]};
  }});
  if(!next||next.nativeCustody.mealWitnesses.length||next.nativeCustody.speech?.receipts.length)return null;
  const events=nativeEvents(prior,next.draft),fact=next.completion;
  if(!events||fact.effectId!==lot.fruit.effectId||fact.bornUs!==lot.bornUs||fact.expiresUs!==lot.expiresUs||fact.receiptDigest!==current.receiptDigest)return null;
  const held:StoppedOrdinaryHeldFruit=Object.freeze({schema:'ordinary-stopped-held-fruit/v1',holderId:fact.residentId,
   lot,pickup:fact,groundDebit:1,heldCredit:1});
  const finish:StoppedGroundReplay=Object.freeze({sequence:current.sequence+1,world:next.draft,receiptDigest:current.receiptDigest,
   lot:null,expiry:null,held,discoveries:current.discoveries});
  const body=JSON.stringify({schema:pickupSchema,sequence:finish.sequence,fromRevision:prior.revision,toRevision:next.draft.revision,
   atUs:fact.settledUs,placementReceiptDigest:current.receiptDigest,beforeDigest:hash(bytes(prior)),afterDigest:hash(bytes(next.draft)),
   eventIds:events.map(e=>e.id),held});
  return Buffer.byteLength(body)<=maxStepBytes?{finish,body,events}:null;
 }
 const next=prepareStoppedOrdinaryAgedGroundMinute(prior,{readExactActiveLot(h){
  return h.worldId===prior.id&&h.revision===prior.revision&&h.atUs===prior.mvpClimate?.lastUs?
   {...h,schema:'ordinary-active-aged-ground-observation/v1',receiptDigest:current.receiptDigest,...lot}:null;
 }});
 if(!next)return null;
 const events=nativeEvents(prior,next.draft);
 if(!events)return null;
 const expiry=advanceAgedGroundExpiry(prior,next.draft,[lot]);
 if(!expiry||expiry.expired.length&&next.observed.length)return null;
 const first=next.observed.filter(d=>!current.discoveries.has(d.residentId));
 const discoveries=new Map(current.discoveries);
 if(discoveries.size+first.length>64)return null;
 for(const fact of first)discoveries.set(fact.residentId,fact);
 const finish:StoppedGroundReplay=Object.freeze({sequence:current.sequence+1,world:next.draft,receiptDigest:current.receiptDigest,
  lot:expiry.remaining[0]??null,expiry:expiry.expired[0]??null,discoveries});
 const body=JSON.stringify({schema:'ordinary-stopped-native-continuation/v1',sequence:finish.sequence,fromRevision:prior.revision,
  toRevision:next.draft.revision,atUs:next.draft.mvpClimate?.lastUs,placementReceiptDigest:current.receiptDigest,
  beforeDigest:hash(bytes(prior)),afterDigest:hash(bytes(next.draft)),eventIds:events.map(e=>e.id),discoveries:first,expiry:finish.expiry});
 if(Buffer.byteLength(body)>maxStepBytes)return null;
 return {finish,body,events};
}
/** Continue only the actual original resident's native plans. The carried
 * lot stays out of ordinary scalar food; eating settles the scoped witness. */
export function prepareStoppedHeldReplayMinute(current:StoppedGroundReplay){
 const held=current.held,prior=current.world,heldSteps=current.heldSteps??0;
 if(!held||current.lot||current.expiry||current.heldDisposition||heldSteps>=maxHeldSteps||!prior.mvpClimate)return null;
 const owner=prior.residents.find(r=>r.id===held.holderId);
 if(!owner||owner.status!=='alive'||owner.health<=0||owner.residency==='outside'||owner.regionalLocation)return null;
 const before=parseClimateUs(prior.mvpClimate.lastUs),expires=parseClimateUs(held.lot.expiresUs);
 if(before>=expires)return null;
 const next=prepareSealedMvpEcologyMinute(prior,true,undefined,undefined,
  {residentId:held.holderId,effectId:held.lot.fruit.effectId,expiresUs:held.lot.expiresUs,table:true});
 if(!next||next.mealWitnesses.length||next.speech?.receipts.length||!next.draft.mvpClimate)return null;
 const {draft,eaten}=next,atUs=draft.mvpClimate!.lastUs,now=parseClimateUs(atUs);
 const person=draft.residents.find(r=>r.id===held.holderId),events=nativeEvents(prior,draft);
 if(!events||now!==before+1_000_000n||!person||person.status!=='alive'||person.health<=0||person.residency!==owner.residency||person.regionalLocation)return null;
 let heldDisposition:HeldDisposition|undefined;
 const age={effectId:held.lot.fruit.effectId,bornUs:held.lot.bornUs,expiresUs:held.lot.expiresUs,heldDebit:1 as const};
 if(eaten){
  if(now>=expires||eaten.residentId!==held.holderId||eaten.settledUs!==atUs||eaten.workMinutes!==5||
   parseClimateUs(eaten.settledUs)-parseClimateUs(eaten.startedUs)!==4_000_000n||
   !draft.processed.includes('plan:'+eaten.planId)||person.activity||person.plan||!same(person.inventory,owner.inventory))return null;
  heldDisposition=Object.freeze({kind:'eaten',witness:eaten,...age});
 }else if(now>=expires)heldDisposition=Object.freeze({kind:'expired',settledUs:atUs,...age});
 const finish:StoppedGroundReplay=Object.freeze({...current,world:draft,sequence:current.sequence+1,heldSteps:heldSteps+1,heldDisposition});
 const body=JSON.stringify({schema:heldSchema,sequence:finish.sequence,heldSteps:finish.heldSteps,fromRevision:prior.revision,
  toRevision:draft.revision,atUs,placementReceiptDigest:current.receiptDigest,pickupPlanId:held.pickup.planId,
  effectId:held.lot.fruit.effectId,bornUs:held.lot.bornUs,expiresUs:held.lot.expiresUs,
  beforeDigest:hash(bytes(prior)),afterDigest:hash(bytes(draft)),eventIds:events.map(e=>e.id),terminal:heldDisposition??null});
 return Buffer.byteLength(body)<=maxStepBytes?{finish,body,events}:null;
}
function hasSteps(db:DatabaseSync){
 const header=db.prepare('SELECT type,sql FROM sqlite_schema WHERE lower(name)=?').get(stoppedContinuationTable);
 if(!header)return false;
 if(header.type!=='table'||header.sql!==stoppedContinuationSql||db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(stoppedContinuationTable))invalid();
 return true;
}
export function assertStoppedEventAuthority(db:DatabaseSync){
 const names=['events','event_people','event_animals',stoppedContinuationTable], slots=names.map(()=>'?').join(',');
 if(db.prepare(`SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (${slots}) OR lower(tbl_name) IN (${slots})`).get(...names,...names))invalid();
 const expected=[
  'CREATE TABLE events (id TEXT PRIMARY KEY,world_id TEXT NOT NULL,at REAL NOT NULL,body TEXT NOT NULL)',
  'CREATE TABLE event_people (world_id TEXT NOT NULL,person_id TEXT NOT NULL,event_id TEXT NOT NULL,event_seq INTEGER NOT NULL,PRIMARY KEY(event_id,person_id),FOREIGN KEY(event_id) REFERENCES events(id))',
  'CREATE TABLE event_animals (world_id TEXT NOT NULL,animal_id TEXT NOT NULL,event_id TEXT NOT NULL,event_seq INTEGER NOT NULL,PRIMARY KEY(event_id,animal_id),FOREIGN KEY(event_id) REFERENCES events(id))',
 ];
 for(let i=0;i<expected.length;i++){
  const t=db.prepare('SELECT type,sql FROM sqlite_schema WHERE lower(name)=?').get(names[i]);
  if(t?.type!=='table'||t.sql!==expected[i])invalid();
 }
 const triggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' AND lower(tbl_name) IN ('events','event_people','event_animals') LIMIT 2").all();
 const trigger="CREATE TRIGGER immutable_event BEFORE UPDATE ON events WHEN NEW.body <> OLD.body BEGIN SELECT RAISE(ABORT, 'event_id_conflict'); END";
 if(triggers.length!==1||triggers[0].name!=='immutable_event'||triggers[0].tbl_name!=='events'||triggers[0].sql!==trigger)invalid();
}
export function assertStoppedEventArchive(db:DatabaseSync,w:World){
 if(w.events.length>maxEvents)invalid();
 const rows=db.prepare("SELECT rowid AS seq,id,world_id,at,CASE WHEN length(CAST(body AS BLOB))<=131072 THEN body END AS body FROM main.events ORDER BY rowid LIMIT ?").all(w.events.length+1);
 if(rows.length!==w.events.length)invalid();
 const partitions=[['event_people','person_id'],['event_animals','animal_id']] as const;
 const counts={event_people:0,event_animals:0};
 for(let i=0;i<rows.length;i++){
  const e=w.events[i],r=rows[i];
  if(r.id!==e.id||r.world_id!==w.id||r.at!==e.at||r.body!==JSON.stringify(e)||typeof r.seq!=='number'||!Number.isSafeInteger(r.seq))invalid();
  for(const [table,key] of partitions){
   const ids=new Set(table==='event_people'?e.actors:e.animalIds??[]);
   counts[table]+=ids.size;
   const got=db.prepare(`SELECT ${key} AS identity,world_id,event_seq FROM main.${table} WHERE event_id=? LIMIT 257`).all(e.id);
   if(ids.size>256||got.length!==ids.size||got.some(x=>typeof x.identity!=='string'||!ids.delete(x.identity)||x.world_id!==w.id||x.event_seq!==r.seq))invalid();
  }
 }
 for(const [table] of partitions){
  const count=db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM main.${table} LIMIT ?)`).get(counts[table]+1)?.n;
  if(count!==counts[table])invalid();
 }
}
export const stoppedGroundBody=(r:StoppedGroundReplay,effectId:string)=>JSON.stringify({version:2,worldId:r.world.id,effectId,items:r.lot?[r.lot]:[],...(r.heldDisposition?{held:null,heldDisposition:r.heldDisposition}:r.held?{held:r.held}:{})});
export function recoverStoppedGroundContinuation(db:DatabaseSync,origin:World,lot:AgedGroundLot,receiptDigest:string,
 current:Uint8Array,ground:Readonly<{body?:unknown;digest?:unknown}>|undefined):StoppedGroundReplay{
 let replay:StoppedGroundReplay={world:origin,lot,receiptDigest,sequence:0,discoveries:new Map(),expiry:null};
 const stepped=hasSteps(db);
 if(stepped){
  assertStoppedEventAuthority(db);
  const rows=db.prepare(`SELECT sequence,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM main.${stoppedContinuationTable} ORDER BY sequence LIMIT ?`).all(maxStepBytes,maxSteps+maxHeldSteps+1);
  if(!rows.length||rows.length>maxSteps+maxHeldSteps)invalid();
  for(const r of rows){
   if(typeof r.body!=='string')invalid();
   const version=JSON.parse(r.body)?.schema;
   if(version!==pickupSchema&&version!==heldSchema&&version!=='ordinary-stopped-native-continuation/v1')invalid();
   const next=version===heldSchema?prepareStoppedHeldReplayMinute(replay):prepareStoppedGroundReplayMinute(replay,version===pickupSchema);
   if(!next||r.sequence!==next.finish.sequence||r.body!==next.body)invalid();
   replay=next.finish;
  }
  assertStoppedEventArchive(db,replay.world);
 }
 const expected=stoppedGroundBody(replay,lot.fruit.effectId);
 if(!bytes(replay.world).equals(current)||ground?.body!==expected||ground.digest!==hash(expected))invalid();
 return replay;
}
