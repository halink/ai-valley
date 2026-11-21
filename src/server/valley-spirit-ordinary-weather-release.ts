import {encodeOrdinaryWeatherWithdrawal,type OrdinaryWeatherWithdrawalReason} from './valley-spirit-ordinary-weather-withdrawal.js';
export {encodeOrdinaryWeatherWithdrawal} from './valley-spirit-ordinary-weather-withdrawal.js';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {acquireRuntimeOwnership} from './runtime-lock.js';
import {readNativeValidationWeatherHead} from './valley-spirit-native-basis.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';
import {readExistingPublicWeatherJournal} from './valley-spirit.js';
import {composeOfflineWeatherEdition,composeSelectedOfflineWeatherEdition,isOrdinaryReviewedWeatherField,type OrdinaryReviewedWeatherField,type ValleySpiritAlmanacRange} from './valley-spirit-almanac.js';
import {SqliteValleySpiritAlmanacStore,readOrdinaryWeatherCorrectionBasis,readOrdinaryWeatherWithdrawalBasis,readValleySpiritAlmanacReviewBasis} from './valley-spirit-almanac-store.js';

import {encodeOrdinaryOfflineWeatherCorrection,encodeOrdinaryOfflineWeatherReview,encodeOrdinaryOfflineWeatherSelection,ordinaryWeatherRawHeadDigest,ordinaryReviewDigest as digest,ordinaryReviewSaveScope,
 ORDINARY_OFFLINE_SELECTED_SCHEMA as SELECTED,ORDINARY_OFFLINE_REVIEW_SCHEMA as SCHEMA,ORDINARY_OFFLINE_CORRECTION_SCHEMA as CORRECTION,ORDINARY_REVIEW_SIGNATURE as SIG,ORDINARY_REVIEW_WORLD as WORLD,
 type OrdinaryOfflineWeatherReview,type OrdinaryOfflineWeatherCorrection,type OrdinaryOfflineWeatherSelection} from './valley-spirit-ordinary-weather-receipt.js';
export {encodeOrdinaryOfflineWeatherCorrection,encodeOrdinaryOfflineWeatherReview,encodeOrdinaryOfflineWeatherSelection,type OrdinaryOfflineWeatherReview,type OrdinaryOfflineWeatherCorrection,type OrdinaryOfflineWeatherSelection} from './valley-spirit-ordinary-weather-receipt.js';
import {inspectOrdinaryG2DevelopmentOrigin} from './ordinary-g2-development-origin.js';
import {decodeSavedWorld} from './save-preflight.js';
import {climateAt} from '../world/mvp-climate.js';
type Range=Omit<ValleySpiritAlmanacRange,'worldId'>;
type Selection=Readonly<{sourceRef:string;field:OrdinaryReviewedWeatherField}>;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

/** Local operator seam, not imported by any service entrypoint. The trusted
 * caller pins an independent reviewer in configuration. No fixture DBs,
 * automatic startup, signing capability, provider, or HTTP write surface. */
export function openOrdinaryOfflineWeatherRelease(options:{database:string;worldId:string;reviewerPublicKeyPem:string;previewOnly?:true}){
 const {database,worldId,reviewerPublicKeyPem,previewOnly}=options;
 if(!WORLD.test(worldId)||typeof reviewerPublicKeyPem!=='string'||reviewerPublicKeyPem.length>256||
  !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(reviewerPublicKeyPem))
  throw Error('ordinary_weather_review_pin_invalid');
 const reviewer=createPublicKey(reviewerPublicKeyPem);
 if(reviewer.asymmetricKeyType!=='ed25519')throw Error('ordinary_weather_review_pin_invalid');
 const reviewerDer=reviewer.export({type:'spki',format:'der'});
 const reviewerFingerprint=createHash('sha256').update(reviewerDer).digest('hex');
 const owner=acquireRuntimeOwnership(database,{existingOnly:true});
 let sqlite:DatabaseSync|undefined;
 try{
  const assertNoJournal=()=>{
   if(!previewOnly)return;
   for(const suffix of ['-wal','-shm','-journal']){
    try{lstatSync(owner.database+suffix);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
    throw Error('ordinary_weather_preview_pending_journal');
   }
  };
  assertNoJournal();
  const readPath=previewOnly?pathToFileURL(owner.database):undefined;
  readPath?.searchParams.set('immutable','1');
  const db=sqlite=new DatabaseSync(readPath?.href??owner.database,{readOnly:true});
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
  const file=lstatSync(owner.database,{bigint:true});
  const saveScope=ordinaryReviewSaveScope(owner.database,worldId);
  const requireOrdinary=()=>{
   owner.assertOwned();assertNoJournal();
   const current=lstatSync(owner.database,{bigint:true});
   if(current.dev!==file.dev||current.ino!==file.ino||
    db.prepare("SELECT 1 FROM sqlite_master WHERE name='mvp_spirit_developer_fixture'").get())throw Error('ordinary_weather_release_scope');
  };
  requireOrdinary();
  if(!readNativeValidationWeatherHead(db,worldId))throw Error('ordinary_weather_release_world');
  const snapshot=(rangeOrSelection:Range|Selection,supersedes?:string,selected=false)=>{
   const requested=rangeOrSelection as Partial<Selection>;
   if(selected?(!exact(rangeOrSelection,['sourceRef','field'])||typeof requested.sourceRef!=='string'||
      requested.sourceRef.length>220||!isOrdinaryReviewedWeatherField(requested.field)||supersedes!==undefined):
      !exact(rangeOrSelection,['fromMinute','throughMinute','sourceRefs']))return null;
   const pick=selected?rangeOrSelection as Selection:null;
   let begun=false;
   try{
    requireOrdinary();db.exec('BEGIN');begun=true;
    const head=readNativeValidationWeatherHead(db,worldId),grant=readValleySpiritWeatherPermission(db,worldId);
    if(!head||!grant?.publicWeather)return null;
    if(pick)inspectOrdinaryG2DevelopmentOrigin(db);
    const journal=readExistingPublicWeatherJournal(owner.database,head,grant);
    if(!journal)return null;
    const refs=new Map(journal.entries.filter(r=>r.permissionVersion===grant.version).map(r=>[r.sourceRef,r]));
    const source=pick&&refs.get(pick.sourceRef);
    if(pick){
     if(!source)return null;
     const raw=db.prepare('SELECT state FROM main.worlds WHERE id=?').get(worldId)?.state;
     const native=decodeSavedWorld(raw);
     if(!Number.isSafeInteger(native.seed)||climateAt(native.seed as number,source.fact.minute)[pick.field]!==source.fact[pick.field])return null;
    }
    const range:Range=source?{fromMinute:source.fact.minute,throughMinute:source.fact.minute,sourceRefs:[source.sourceRef]}:rangeOrSelection as Range;
    if(range.throughMinute>=Math.floor(head.minute/60)*60)return null;
    const correction=supersedes===undefined?null:readOrdinaryWeatherCorrectionBasis(db,worldId,saveScope,supersedes,reviewerFingerprint);
    if(supersedes!==undefined&&!correction)return null;
    const authority={permission:()=>grant,resolve:(ref:string)=>refs.get(ref)??null};
    const built=pick?composeSelectedOfflineWeatherEdition({...range,worldId},authority,pick.field):
     composeOfflineWeatherEdition({...range,worldId},authority,supersedes);
    if(!built)return null;
    const before=correction?.before??readValleySpiritAlmanacReviewBasis(db,worldId,saveScope),p=built.entry.packet;
    const prior=before.filter(e=>e.packet.fromMinute===p.fromMinute&&e.packet.throughMinute===p.throughMinute).at(-1);
    if(correction?prior?.entryId!==correction.prior.entryId:!!prior)return null;
    const base={worldId,saveScope,reviewerFingerprint,headRevision:head.worldRevision,permissionVersion:grant.version,
     priorAlmanacDigest:digest(before),entryId:built.entry.entryId,editionDigest:digest(built.entry),
     selectedSourcesDigest:digest(p.points.map(point=>refs.get(point.sourceRef)))};
    const rawHeadDigest=pick?ordinaryWeatherRawHeadDigest(db,worldId,head.worldRevision):null;
    if(pick&&!rawHeadDigest)return null;
    const terms:OrdinaryOfflineWeatherReview|OrdinaryOfflineWeatherCorrection|OrdinaryOfflineWeatherSelection=pick?
     {schema:SELECTED,...base,rawHeadDigest:rawHeadDigest!,rendererVersion:1,sourceRef:pick.sourceRef,field:pick.field}:correction?
     {schema:CORRECTION,...base,supersedes:correction.prior.entryId,predecessorDigest:correction.predecessorDigest,
      predecessorReceiptDigest:correction.predecessorReceiptDigest,predecessorWithdrawalDigest:correction.predecessorWithdrawalDigest}:
     {schema:SCHEMA,...base};
    requireOrdinary();db.exec('COMMIT');begun=false;
    return {terms,...built,before,sourceBytes:journal.raw};
   }catch{return null;}finally{if(begun)try{db.exec('ROLLBACK');}catch{/* deny */}}
  };
  let closed=false;
  const release=(range:Range|Selection,approval:unknown,supersedes?:string,oneField=false):string|null=>{
   if(closed||previewOnly)return null;
   try{
    const a=structuredClone(approval);
    if(!exact(a,['terms','signature'])||typeof a.signature!=='string'||!SIG.test(a.signature))return null;
    const encode=oneField?encodeOrdinaryOfflineWeatherSelection:supersedes===undefined?encodeOrdinaryOfflineWeatherReview:encodeOrdinaryOfflineWeatherCorrection;
    const bytes=encode(a.terms),sig=Buffer.from(a.signature,'base64url');
    if(!bytes||sig.length!==64||sig.toString('base64url')!==a.signature||!verify(null,bytes,reviewer,sig))return null;
    const selected=structuredClone(range),candidate=snapshot(selected,supersedes,oneField);
    if(!candidate||!bytes.equals(encode(candidate.terms)!))return null;
    const store=new SqliteValleySpiritAlmanacStore(owner.database,worldId,requireOrdinary);
    try{
     // SQLite and the independent source journal do not share a transaction.
     // Re-read under the same cooperative ownership immediately before CAS.
     const current=snapshot(selected,supersedes,oneField);
     if(!current||current.sourceBytes!==candidate.sourceBytes||!bytes.equals(encode(current.terms)!))return null;
     return store.recordOrdinaryReview(current.before,current.entry,{terms:current.terms,signature:a.signature,reviewerDer:reviewerDer.toString('base64url')})?current.entry.entryId:null;
    }finally{store.close();}
   }catch{return null;}
  };
  return Object.freeze({
   preview(range:Omit<ValleySpiritAlmanacRange,'worldId'>){
    if(closed)return null;
    try{
     const candidate=snapshot(structuredClone(range));
     return candidate?.terms.schema===SCHEMA?{terms:candidate.terms,edition:candidate.view}:null;
    }catch{return null;}
   },
   release(range:Omit<ValleySpiritAlmanacRange,'worldId'>,approval:unknown){return release(range,approval);},
   previewSelection(selection:Selection){
    if(closed)return null;
    try{
     const candidate=snapshot(structuredClone(selection),undefined,true);
     return candidate?.terms.schema===SELECTED?{terms:candidate.terms,edition:candidate.view}:null;
    }catch{return null;}
   },
   releaseSelection(selection:Selection,approval:unknown){return release(selection,approval,undefined,true);},
   previewCorrection(supersedes:string,range:Omit<ValleySpiritAlmanacRange,'worldId'>){
    if(closed||typeof supersedes!=='string')return null;
    try{
     const candidate=snapshot(structuredClone(range),supersedes);
     return candidate?.terms.schema===CORRECTION?{terms:candidate.terms,edition:candidate.view}:null;
    }catch{return null;}
   },
   correct(supersedes:string,range:Omit<ValleySpiritAlmanacRange,'worldId'>,approval:unknown){
    return typeof supersedes==='string'?release(range,approval,supersedes):null;
   },
   previewWithdrawal(entryId:string,reason:OrdinaryWeatherWithdrawalReason){
    if(closed)return null;
    try{
     requireOrdinary();db.exec('BEGIN');
     try{return readOrdinaryWeatherWithdrawalBasis(db,worldId,saveScope,entryId,reason,reviewerFingerprint);}
     finally{db.exec('ROLLBACK');}
    }catch{return null;}
   },
   withdraw(entryId:string,reason:OrdinaryWeatherWithdrawalReason,approval:unknown):boolean{
    if(closed||previewOnly)return false;
    try{
     const a=structuredClone(approval);
     if(!exact(a,['terms','signature'])||typeof a.signature!=='string'||!SIG.test(a.signature))return false;
     const bytes=encodeOrdinaryWeatherWithdrawal(a.terms),sig=Buffer.from(a.signature,'base64url');
     if(!bytes||sig.length!==64||sig.toString('base64url')!==a.signature||!verify(null,bytes,reviewer,sig))return false;
     requireOrdinary();
     const store=new SqliteValleySpiritAlmanacStore(owner.database,worldId,requireOrdinary);
     try{return store.recordOrdinaryWithdrawal(entryId,reason,a);}
     finally{store.close();}
    }catch{return false;}
   },
   close(){if(!closed){closed=true;try{db.close();}finally{owner.release();}}}
  });
 }catch(error){try{sqlite?.close();}finally{owner.release();}throw error;}
}
