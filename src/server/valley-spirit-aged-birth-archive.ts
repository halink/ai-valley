import {prepareSealedMvpEcologyMinute} from './godot-mvp.js';
import {parseClimateUs} from '../world/mvp-climate.js';
import {canPerceiveMvpCommonFruitPoint} from '../world/mvp-fallen-fruit-resident.js';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync} from 'node:zlib';
import type {World,WorldEvent} from '../shared/types.js';
import {valleySpiritFruitFallOpportunityId} from '../shared/valley-spirit-effects.js';
import {emitLedgerEvent} from '../world/events.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {inspectMvpGroundFruitPlacement} from '../world/mvp-ground-fruit.js';
import {projectMvpSpiritActiveGround} from '../world/mvp-spirit-effects.js';
import {agedBirthExecutionSigningBytes,agedBirthRainDigest,bindsAgedBirthG1Review,verifiesAgedBirthExecution} from './valley-spirit-aged-birth-review.js';
import {agedG1ReviewSigningBytes,verifiesAgedG1Review} from './valley-spirit-aged-g1-review.js';
import {sealedAgedPlacementAgeDigest,sealedAgedPlacementScope} from './valley-spirit-aged-placement-terms.js';
import {makeSealedMvpSourceAgeTerms,verifySealedMvpSourceAge} from './valley-spirit-mvp-source-age.js';
import {readCurrentSealedMvpSourceCommitment} from './valley-spirit-mvp-source-credit.js';
import {isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';

const table='sealed_mvp_aged_birth_v2';
const sql='CREATE TABLE sealed_mvp_aged_birth_v2(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),predecessor BLOB NOT NULL,proof TEXT NOT NULL)';
const expiryTable='sealed_mvp_aged_expiry_v2';
const expirySql='CREATE TABLE sealed_mvp_aged_expiry_v2(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),body TEXT NOT NULL)';
const maxState=32*1024*1024;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const fail=():never=>{throw Error('invalid_sealed_aged_birth_v2');};
export interface AgedBirthProofs {readonly age:unknown;readonly g1:unknown;readonly execution:unknown}
interface ParkedBirth {
 world:World;
 event:WorldEvent&{mvpAgedFruitBirth:{version:2;effectId:string;proofDigest:string}};
 receipt:Readonly<{worldId:string;approvalId:string;effectId:string;opportunityId:string;creditId:string;bornUs:string;expiresUs:string;
  placedUs:string;quantity:1;ownerId:'commons';rainEventId:string;proofDigest:string;sourceId:string;sourceInstanceId:string;sourceBefore:number;sourceAfter:number;targetId:string;eventId:string;revision:number}>;
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const signedTerms=(v:unknown)=>obj(v)&&obj(v.terms)?v.terms:null;
const equalBytes=(a:Uint8Array,b:Uint8Array)=>Buffer.from(a).equals(b);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const hasTable=(db:DatabaseSync)=>db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
const typedRows=(db:DatabaseSync,field:'mvpAgedFruitBirth'|'mvpAgedFruitExpiry')=>db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='events'").get()?db.prepare(`SELECT id,world_id,at,body,rowid AS archiveSeq FROM events WHERE CASE WHEN json_valid(body) THEN json_type(body,'$.${field}') IS NOT NULL ELSE 0 END LIMIT 2`).all():[];

/** The parked archive never follows TEMP shadow tables, and the dedicated
 * direct CAS may not execute unknown trigger code. */
export function assertAgedBirthSqlAuthority(db:DatabaseSync):void {
 const names=['worlds','events','event_people','event_animals','mvp_spirit_developer_fixture',table,expiryTable,'valley_spirit_sealed_source_credit',
  'sealed_aged_g1_review_epoch','valley_spirit_permissions'];
 const slots=names.map(()=>'?').join(',');
 if(db.prepare(`SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (${slots}) OR lower(tbl_name) IN (${slots})`).get(...names,...names))fail();
 const triggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' AND lower(tbl_name) IN ('worlds','events','event_people','event_animals')").all();
 const standard="CREATE TRIGGER immutable_event BEFORE UPDATE ON events WHEN NEW.body <> OLD.body BEGIN SELECT RAISE(ABORT, 'event_id_conflict'); END";
 if(triggers.length!==1||triggers[0].name!=='immutable_event'||triggers[0].tbl_name!=='events'||triggers[0].sql!==standard)fail();
}

/** All ordinary and legacy-compatibility reads/writes stop at this dependency. */
export function rejectSealedAgedBirthOnGenericPath(db:DatabaseSync,scanSealedArchive=false):void {
 // Normal runtime can cheaply reject a present sidecar, and its world
 // decoder separately rejects inline markers. Only sealed save preflight
 // checks detached archived orphans (the owner holds an exclusive lock).
 if(hasTable(db)||expirySchema(db)||scanSealedArchive&&(typedRows(db,'mvpAgedFruitBirth').length||typedRows(db,'mvpAgedFruitExpiry').length))throw Error('sealed_aged_birth_requires_private_archive');
}

function reconstruct(
 db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,prior:World,predecessor:Uint8Array,proofs:AgedBirthProofs,proofText:string,
):ParkedBirth {
 const t=signedTerms(proofs.execution),g1=signedTerms(proofs.g1),climate=prior.mvpClimate;
 if(!owner.sourceAge||!owner.agedG1ReviewerKeyPem||!owner.agedPlacementKeyPem||!t||!g1||
  !agedBirthExecutionSigningBytes(t)||!verifiesAgedBirthExecution(owner.agedPlacementKeyPem,t,proofs.execution)||
  !verifiesAgedG1Review(owner.agedG1ReviewerKeyPem,g1,proofs.g1)||!bindsAgedBirthG1Review(t,proofs.g1)||
  prior.id!==t.worldId||prior.revision!==t.worldRevision||prior.mode!=='validation'||prior.clock.paused||
  !climate||climate.lastUs!==t.atUs||climate.current.precipitationPermille>0||
  t.fixtureScopeId!==sealedAgedPlacementScope(owner.seal))return fail();
 const credit=readCurrentSealedMvpSourceCommitment(db,owner.seal,prior,predecessor);
 const age=credit&&makeSealedMvpSourceAgeTerms(prior.id,credit.creditId,credit.bornUs,owner.sourceAge.policy);
 if(!credit||!age||!verifySealedMvpSourceAge(owner.sourceAge.keyPem,age,proofs.age)||credit.creditId!==t.creditId||
  credit.sourceId!==t.sourceId||age.bornUs!==t.bornUs||age.expiresUs!==t.expiresUs||sealedAgedPlacementAgeDigest(age)!==t.ageTermsDigest)return fail();
 const effects=climate.spiritEffects,settlement=climate.spiritFruitSettlement,ground=projectMvpSpiritActiveGround(prior);
 const rain=climate.rainProvenance?.recent.at(-1),target=typeof t.targetId==='string'?/^ground:(\d{1,4}):(\d{1,4})$/u.exec(t.targetId):null;
 if(!ground||ground.items.length||effects?.version!==1||effects.ground.items.length||effects.applied.length||
  !settlement||settlement.discoveries.length||settlement.pickups.length||!rain||!resolveMvpRainEpisode(prior,rain.rainEventId)||
  agedBirthRainDigest(rain)!==t.rainDigest||!target)return fail();
 const at={x:Number(target[1]),y:Number(target[2])};
 const site=inspectMvpGroundFruitPlacement(prior,ground,credit.sourceId,at,owner.capacity);
 if(!site||site.target.id!==t.targetId||site.source.resourceInstanceId!==t.sourceInstanceId||
  t.opportunityId!==valleySpiritFruitFallOpportunityId(prior.id,rain.rainEventId,site.source.resourceInstanceId))return fail();
 const world=structuredClone(prior);
 const source=world.resources.find(r=>r.id===credit.sourceId)!;
 const sourceBefore=source.amount;source.amount--;
 const proofDigest=hash(proofText);
 const effectId=t.effectId as string;
 const event=emitLedgerEvent(world,{kind:'system',actors:[],place:at,text:'雨后在地面留下一份公共落果。'}) as ParkedBirth['event'];
 event.mvpAgedFruitBirth={version:2,effectId,proofDigest};
 if(!Number.isSafeInteger(world.revision)||world.revision!==prior.revision+1)return fail();
 const receipt=Object.freeze({worldId:world.id,approvalId:t.approvalId as string,effectId,opportunityId:t.opportunityId as string,
  creditId:credit.creditId,bornUs:age.bornUs,expiresUs:age.expiresUs,placedUs:climate.lastUs,quantity:1 as const,
  ownerId:'commons' as const,rainEventId:rain.rainEventId,proofDigest,
  sourceId:credit.sourceId,sourceInstanceId:site.source.resourceInstanceId,sourceBefore,sourceAfter:source.amount,targetId:site.target.id,
  eventId:event.id,revision:world.revision});
 const lot={kind:'aged-fallen-fruit',quantity:1,ownerId:'commons',effectId,at,sourceAt:credit.sourceAt,sourceId:credit.sourceId,
  sourceInstanceId:site.source.resourceInstanceId,creditId:credit.creditId,bornUs:age.bornUs,expiresUs:age.expiresUs,placedUs:receipt.placedUs};
 // Intentionally incompatible with all general World decoders/engines. Only
 // this module can reconstruct/read it. There is no blank V2 or downgrade.
 Object.assign(world.mvpClimate!,{spiritEffects:{version:2,proofDigest,rain,ground:{items:[lot]},receipt}});
 return {world,event,receipt};
}

type DecodePredecessor=(state:Uint8Array)=>World;
function rawHead(db:DatabaseSync){
 const rows=db.prepare("SELECT id,revision,CASE WHEN length(state)<=? THEN state ELSE NULL END AS state FROM worlds LIMIT 2").all(maxState);
 if(rows.length!==1||typeof rows[0].id!=='string'||typeof rows[0].revision!=='number'||!(rows[0].state instanceof Uint8Array))return fail();
 return {id:rows[0].id,revision:rows[0].revision,state:rows[0].state};
}

const expirySchema=(db:DatabaseSync)=>db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(expiryTable);

interface AgedFruitExpiry {
 readonly version:2;readonly kind:'ground-fruit-expired';readonly worldId:string;readonly effectId:string;
 readonly birthProofDigest:string;readonly birthEventId:string;readonly expiryEventId:string;
 readonly bornUs:string;readonly expiresUs:string;readonly beforeUs:string;readonly settledUs:string;
 readonly fromRevision:number;readonly worldRevision:number;readonly groundDebit:1;
}
function nativeExpiryDraft(birth:ParkedBirth,prior:World){
 const bornHead=birth.world,receipt=birth.receipt,beforeUs=bornHead.mvpClimate!.lastUs;
 const before=parseClimateUs(beforeUs),expiry=parseClimateUs(receipt.expiresUs);
 // This first lifecycle writer does not commit preparatory/quiet minutes.
 // It only runs the native tick that can actually cross the old age boundary.
 if(before>=expiry||before+1_000_000n<expiry)return null;
 const substrate=structuredClone(bornHead);
 const marker=substrate.mvpClimate!.spiritEffects;
 // Restore only the exact absence of V1 ground at birth; never synthesize a
 // V1 lot or hand this private substrate to any ordinary load/chooser API.
 substrate.mvpClimate!.spiritEffects=structuredClone(prior.mvpClimate!.spiritEffects);
 const next=prepareSealedMvpEcologyMinute(substrate,true);
 if(!next)return null;
 const {draft,speech,mealWitnesses}=next;
 if(!draft.mvpClimate||draft.id!==bornHead.id||draft.minute!==bornHead.minute+1||
  parseClimateUs(draft.mvpClimate.lastUs)-before!==1_000_000n||parseClimateUs(draft.mvpClimate.lastUs)<expiry||
  !equal(draft.mvpClimate.spiritEffects,substrate.mvpClimate!.spiritEffects)||
  !equal(draft.mvpClimate.spiritFruitSettlement,substrate.mvpClimate!.spiritFruitSettlement))return null;
 const ordinary=draft.events.slice(bornHead.events.length);
 // Do not bypass any installed independent custody. Unsupported speech,
 // meals, or other effect facts abort the entire proposed native minute.
 if(ordinary.length>255||speech?.receipts.length||mealWitnesses.length||
  ordinary.some(e=>e.speechText!==undefined||e.mvpMeal||e.socialAppointmentArrival||e.mvpFruitFall)||
  !equal(draft.events.slice(0,bornHead.events.length),bornHead.events))return null;
 const sourceBefore=bornHead.resources.find(r=>r.id===receipt.sourceId);
 if(!sourceBefore||!equal(draft.resources.find(r=>r.id===receipt.sourceId),sourceBefore))return null;
 // Ground expiry affects only the effect lot, never the native resident or
 // fruit source. All other ordinary changes from the tick are kept verbatim.
 const event=emitLedgerEvent(draft,{kind:'system',actors:[],place:birth.event.place,text:'一份地面落果超过原保鲜期。'}) as
  WorldEvent&{mvpAgedFruitExpiry:AgedFruitExpiry};
 if(!Number.isSafeInteger(draft.revision)||draft.revision<=bornHead.revision)return null;
 const fact:AgedFruitExpiry=Object.freeze({version:2,kind:'ground-fruit-expired',worldId:bornHead.id,effectId:receipt.effectId,
  birthProofDigest:receipt.proofDigest,birthEventId:receipt.eventId,expiryEventId:event.id,bornUs:receipt.bornUs,expiresUs:receipt.expiresUs,
  beforeUs,settledUs:draft.mvpClimate.lastUs,fromRevision:bornHead.revision,worldRevision:draft.revision,groundDebit:1});
 event.mvpAgedFruitExpiry=fact;
 Object.assign(draft.mvpClimate,{spiritEffects:{...marker,ground:{items:[]},expiry:fact}});
 return {world:draft,events:[...ordinary,event],event,fact};
}
function exactExpiryArchiveSuffix(db:DatabaseSync,worldId:string,birthSeq:unknown,expected:readonly WorldEvent[]):boolean {
 if(typeof birthSeq!=='number'||!Number.isSafeInteger(birthSeq)||birthSeq<1||expected.length>256)return false;
 const rows=db.prepare('SELECT rowid AS archiveSeq,id,world_id,at,body FROM events WHERE rowid>? ORDER BY rowid LIMIT ?')
  .all(birthSeq,expected.length+1);
 if(rows.length!==expected.length)return false;
 return expected.every((event,i)=>{
  const row=rows[i];
  if(row.id!==event.id||row.world_id!==worldId||row.at!==event.at||row.body!==JSON.stringify(event))return false;
  const p=db.prepare('SELECT world_id,person_id,event_seq FROM event_people WHERE event_id=? ORDER BY person_id LIMIT 257').all(event.id);
  const a=db.prepare('SELECT world_id,animal_id,event_seq FROM event_animals WHERE event_id=? ORDER BY animal_id LIMIT 257').all(event.id);
  const identities=(subs:typeof p,field:string,values:readonly string[])=>{
   const wanted=new Set(values);
   return subs.length===wanted.size&&subs.every(s=>s.world_id===worldId&&s.event_seq===row.archiveSeq&&
    typeof s[field]==='string'&&wanted.delete(s[field] as string));
  };
  return identities(p,'person_id',event.actors)&&identities(a,'animal_id',event.animalIds??[]);
 });
}
function readVerifiedSealedAgedBirth(
 db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,decode:DecodePredecessor,
){
 assertAgedBirthSqlAuthority(db);
 const schema=hasTable(db);
 const events=typedRows(db,'mvpAgedFruitBirth'),expiryEvents=typedRows(db,'mvpAgedFruitExpiry'),expiryHeader=expirySchema(db);
 if(!schema){
  if(events.length||expiryEvents.length||expiryHeader)return fail();
  // A deleted table cannot turn a parked V2 head into an absent receipt.
  if(db.prepare('SELECT 1 FROM worlds LIMIT 1').get())decode(rawHead(db).state);
  return null;
 }
 if(schema.type!=='table'||schema.sql!==sql||events.length!==1||
  db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? COLLATE NOCASE AND type IN ('trigger','index')").get(table))return fail();
 const seal=db.prepare('SELECT version,seal FROM mvp_spirit_developer_fixture LIMIT 2').all();
 if(seal.length!==1||seal[0].version!==1||seal[0].seal!==owner.seal)return fail();
 const rows=db.prepare("SELECT slot,CASE WHEN length(predecessor)<=? THEN predecessor ELSE NULL END AS predecessor,CASE WHEN length(proof)<=12288 THEN proof ELSE NULL END AS proof FROM sealed_mvp_aged_birth_v2 LIMIT 2").all(maxState);
 const r=rows[0];
 if(rows.length!==1||r.slot!==1||typeof r.proof!=='string'||!(r.predecessor instanceof Uint8Array))return fail();
 const stored=JSON.parse(r.proof);
 if(!obj(stored)||Object.keys(stored).length!==3||!['age','g1','execution'].every(k=>Object.hasOwn(stored,k)))return fail();
 const prior=decode(r.predecessor);
 const derived=reconstruct(db,owner,prior,r.predecessor,stored as unknown as AgedBirthProofs,r.proof);
 const current=rawHead(db),actual=events[0];
 if(actual.id!==derived.event.id||actual.world_id!==derived.world.id||actual.at!==derived.event.at||actual.body!==JSON.stringify(derived.event))return fail();
 let world=derived.world,expiry:AgedFruitExpiry|null=null;
 if(expiryHeader){
  if(expiryHeader.type!=='table'||expiryHeader.sql!==expirySql||expiryEvents.length!==1||
   db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? COLLATE NOCASE AND type IN ('trigger','index')").get(expiryTable))return fail();
  const expiryRows=db.prepare('SELECT slot,CASE WHEN length(body)<=2048 THEN body ELSE NULL END AS body FROM sealed_mvp_aged_expiry_v2 LIMIT 2').all();
  const replay=nativeExpiryDraft(derived,prior);
  if(expiryRows.length!==1||expiryRows[0].slot!==1||!replay||expiryRows[0].body!==JSON.stringify(replay.fact)||
   expiryEvents[0].id!==replay.event.id||!exactExpiryArchiveSuffix(db,replay.world.id,actual.archiveSeq,replay.events))return fail();
  world=replay.world;expiry=replay.fact;
 }else if(expiryEvents.length||!exactExpiryArchiveSuffix(db,derived.world.id,actual.archiveSeq,[]))return fail();
 if(current.id!==world.id||current.revision!==world.revision||
  !equalBytes(current.state,gzipSync(JSON.stringify(world),{level:1})))return fail();
 return {world,prior,birth:derived,expiry,point:derived.event.place,receipt:derived.receipt,proofs:stored as unknown as AgedBirthProofs};
}

export function readSealedAgedBirthArchive(db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,decode:DecodePredecessor){
 const value=readVerifiedSealedAgedBirth(db,owner,decode);
 return value?{receipt:value.receipt,proofs:value.proofs}:null;
}

/** Called under sealed store BEGIN IMMEDIATE, only after live independent
 * authority was checked. No caller-supplied world, stock, site or head digest. */
export function writeSealedAgedBirth(
 db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,prior:World,proofs:AgedBirthProofs,decode:DecodePredecessor,
){
 assertAgedBirthSqlAuthority(db);
 rejectSealedAgedBirthOnGenericPath(db,true);
 const from=rawHead(db);
 if(from.id!==prior.id||from.revision!==prior.revision||!equal(decode(from.state),prior))return fail();
 const proofText=JSON.stringify(proofs);
 if(Buffer.byteLength(proofText)>12288)return fail();
 const birth=reconstruct(db,owner,prior,from.state,proofs,proofText);
 const state=gzipSync(JSON.stringify(birth.world),{level:1});
 if(state.length>maxState)return fail();
 db.exec(sql);
 db.prepare('INSERT INTO sealed_mvp_aged_birth_v2 VALUES (1,?,?)').run(from.state,proofText);
 db.prepare('INSERT INTO events(id,world_id,at,body) VALUES (?,?,?,?)')
  .run(birth.event.id,birth.world.id,birth.event.at,JSON.stringify(birth.event));
 if(db.prepare('UPDATE worlds SET revision=?,state=? WHERE id=? AND revision=?').run(birth.world.revision,state,prior.id,prior.revision).changes!==1)return fail();
 if(!equal(readSealedAgedBirthArchive(db,owner,decode)?.receipt,birth.receipt))return fail();
 return birth.receipt;
}
/** Live execution handle only, in one already-owned BEGIN IMMEDIATE. */
export function advanceSealedAgedFruitExpiry(
 db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,decode:DecodePredecessor,worldId:string,
){
 const prior=readVerifiedSealedAgedBirth(db,owner,decode);
 if(!prior||prior.world.id!==worldId)return null;
 if(prior.expiry)return {status:'expired' as const,replay:true,expiry:prior.expiry};
 const next=nativeExpiryDraft(prior.birth,prior.prior);
 if(!next)return null;
 const before=rawHead(db),state=gzipSync(JSON.stringify(next.world),{level:1});
 if(before.id!==worldId||before.revision!==prior.world.revision||state.length>maxState)return fail();
 db.exec(expirySql);
 db.prepare('INSERT INTO sealed_mvp_aged_expiry_v2 VALUES (1,?)').run(JSON.stringify(next.fact));
 const insert=db.prepare('INSERT INTO events(id,world_id,at,body) VALUES (?,?,?,?)');
 const indexPerson=db.prepare('INSERT INTO event_people(world_id,person_id,event_id,event_seq) VALUES(?,?,?,?)');
 const indexAnimal=db.prepare('INSERT INTO event_animals(world_id,animal_id,event_id,event_seq) VALUES(?,?,?,?)');
 for(const e of next.events){
  const seq=insert.run(e.id,worldId,e.at,JSON.stringify(e)).lastInsertRowid;
  for(const id of new Set(e.actors))indexPerson.run(worldId,id,e.id,seq);
  for(const id of new Set(e.animalIds??[]))indexAnimal.run(worldId,id,e.id,seq);
 }
 if(db.prepare('UPDATE worlds SET revision=?,state=? WHERE id=? AND revision=? AND state=?')
  .run(next.world.revision,state,worldId,before.revision,before.state).changes!==1)return fail();
 const verified=readVerifiedSealedAgedBirth(db,owner,decode);
 if(!verified||!equal(verified.expiry,next.fact))return fail();
 return {status:'expired' as const,replay:false,expiry:next.fact};
}
export function sameAgedBirthProofs(a:AgedBirthProofs,b:AgedBirthProofs):boolean {
 function sameProof(left:unknown,right:unknown,canonical?:(v:unknown)=>Buffer|null):boolean {
  if(!obj(left)||!obj(right)||Object.keys(right).length!==2||!Object.hasOwn(right,'terms')||
   !Object.hasOwn(right,'signature')||left.signature!==right.signature)return false;
  if(canonical){
   const l=canonical(left.terms),r=canonical(right.terms);return !!l&&!!r&&l.equals(r);
  }
  return equal(left.terms,right.terms);
 }
 return sameProof(a.age,b.age)&&sameProof(a.g1,b.g1,agedG1ReviewSigningBytes)&&
  sameProof(a.execution,b.execution,agedBirthExecutionSigningBytes);
}
function readOwnedSealedAgedBirth<T>(
 owner:DeveloperMvpSpiritFixtureOwner,decode:DecodePredecessor,project:(value:NonNullable<ReturnType<typeof readVerifiedSealedAgedBirth>>)=>T,
):T|null{
 if(!isDeveloperMvpSpiritFixtureOwner(owner)||!owner.sourceAge||!owner.agedG1ReviewerKeyPem||!owner.agedPlacementKeyPem)return null;
 owner.assertOwned();
 const db=new DatabaseSync(owner.database,{readOnly:true});
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN');
  const value=readVerifiedSealedAgedBirth(db,owner,decode);
  const result=value?project(value):null;
  owner.assertOwned();db.exec('COMMIT');return result;
 }finally{db.close();}
}
export function readOwnedSealedAgedFruitExpiry(owner:DeveloperMvpSpiritFixtureOwner,decode:DecodePredecessor){
 return readOwnedSealedAgedBirth(owner,decode,value=>value.expiry);
}
export function readOwnedSealedAgedBirthReceipt(owner:DeveloperMvpSpiritFixtureOwner,decode:DecodePredecessor){
 return readOwnedSealedAgedBirth(owner,decode,value=>value.receipt);
}
/** One resident's private, read-only possible sight. No durable discovery,
 * transfer intent, authority, notifications, or raw world leaves the reader. */
export function readOwnedSealedAgedFruitSight(
 owner:DeveloperMvpSpiritFixtureOwner,decode:DecodePredecessor,worldId:string,residentId:string,
){
 if(typeof worldId!=='string'||typeof residentId!=='string'||worldId.length>200||residentId.length>200)return null;
 try{
  return readOwnedSealedAgedBirth(owner,decode,({world,point,receipt,expiry})=>{
   if(expiry||world.id!==worldId||!world.mvpClimate)return null;
   const now=parseClimateUs(world.mvpClimate.lastUs);
   if(now<parseClimateUs(receipt.bornUs)||now>=parseClimateUs(receipt.expiresUs)||
    !canPerceiveMvpCommonFruitPoint(world,residentId,point))return null;
   return Object.freeze({status:'visible' as const,at:Object.freeze({...point})});
  });
 }catch{return null;}
}
