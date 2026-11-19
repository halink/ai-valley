import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acquireDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey} from './valley-spirit-fixture-files.js';
import {checkedPin,nativeYearbookCaptureOnConnection} from './valley-spirit-native-basis.js';
import {buildNativeYearbookDraft,nativeYearbookDraftDigest,nativeYearbookChoiceMenu} from './valley-spirit-yearbook-editor.js';

const SCHEMA='valley-private-native-yearbook-review/v1';
const ID=/^native-private-edition-[a-f0-9]{64}$/;
const HEX=/^[a-f0-9]{64}$/;
const CAP=128, BYTES=4096;
const name='valley_spirit_native_reviewed_editions';
const ddl=`CREATE TABLE ${name}(seq INTEGER NOT NULL PRIMARY KEY, approval TEXT NOT NULL)`;
const hex=(v:unknown):v is string=>typeof v==='string'&&HEX.test(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export interface PrivateNativeYearbookReviewTerms {
 schema:typeof SCHEMA;fixtureScopeId:string;worldId:string;weatherEntryId:string;lifeSectionId:string;
 priorEditionId:string|null;sourceDigest:string;renderedDigest:string;selectedIds:readonly string[];
}
interface Approval {terms:PrivateNativeYearbookReviewTerms;signature:string;}
export function encodePrivateNativeYearbookReview(v:unknown):Buffer|null {
 try{
  if(!exact(v,['schema','fixtureScopeId','worldId','weatherEntryId','lifeSectionId','priorEditionId','sourceDigest','renderedDigest','selectedIds'])||
    v.schema!==SCHEMA||!hex(v.fixtureScopeId)||!hex(v.sourceDigest)||!hex(v.renderedDigest)||
    !(v.priorEditionId===null||typeof v.priorEditionId==='string'&&ID.test(v.priorEditionId))||
    !Array.isArray(v.selectedIds)||v.selectedIds.length<2||v.selectedIds.length>12||
    !Array.from(v.selectedIds).every(hex)||new Set(v.selectedIds).size!==v.selectedIds.length)return null;
  if(typeof v.worldId!=='string'||typeof v.weatherEntryId!=='string'||typeof v.lifeSectionId!=='string')return null;
  checkedPin({worldId:v.worldId,weatherEntryId:v.weatherEntryId,lifeSectionId:v.lifeSectionId});
  return Buffer.from(JSON.stringify([SCHEMA,'sealed-development-only',v.fixtureScopeId,v.worldId,v.weatherEntryId,v.lifeSectionId,
   v.priorEditionId,v.sourceDigest,v.renderedDigest,v.selectedIds]),'utf8');
 }catch{return null;}
}
function checkedApproval(input:unknown,key:KeyObject,scope:string,worldId:string):Approval|null {
 if(!exact(input,['terms','signature'])||typeof input.signature!=='string'||!(/^[A-Za-z0-9_-]{86}$/.test(input.signature)))return null;
 const bytes=encodePrivateNativeYearbookReview(input.terms);
 if(!bytes)return null;
 const t=input.terms as PrivateNativeYearbookReviewTerms,sig=Buffer.from(input.signature,'base64url');
 if(t.fixtureScopeId!==scope||t.worldId!==worldId||sig.length!==64||sig.toString('base64url')!==input.signature||
   !verify(null,bytes,key,sig))return null;
 return {terms:{schema:SCHEMA,fixtureScopeId:scope,worldId,weatherEntryId:t.weatherEntryId,lifeSectionId:t.lifeSectionId,
  priorEditionId:t.priorEditionId,sourceDigest:t.sourceDigest,renderedDigest:t.renderedDigest,selectedIds:[...t.selectedIds]},signature:input.signature};
}
const edition=(t:PrivateNativeYearbookReviewTerms)=>'native-private-edition-'+createHash('sha256').update(encodePrivateNativeYearbookReview(t)!).digest('hex');
function exists(db:DatabaseSync){
 const t=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(name);
 if(!t)return false;
 if(t.type!=='table'||t.sql!==ddl||db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(name))
  throw Error('native_review_edition_schema');
 return true;
}
function readLog(db:DatabaseSync,key:KeyObject,scope:string,worldId:string):Approval[] {
 if(!exists(db))return [];
 const rows=db.prepare(`SELECT seq,CASE WHEN length(CAST(approval AS BLOB))<=? THEN approval ELSE NULL END AS approval FROM ${name} ORDER BY seq LIMIT ?`).all(BYTES,CAP+1);
 if(!rows.length||rows.length>CAP)throw Error('native_review_edition_size');
 const entries:Approval[]=[],used=new Set<string>();let prior:string|null=null;
 for(const row of rows){
  if(row.seq!==entries.length+1||typeof row.approval!=='string')throw Error('native_review_edition_row');
  const a=checkedApproval(JSON.parse(row.approval),key,scope,worldId);
  if(!a||row.approval!==JSON.stringify(a)||a.terms.priorEditionId!==prior||used.has(a.terms.sourceDigest))
   throw Error('native_review_edition_history');
  used.add(a.terms.sourceDigest); entries.push(a); prior=edition(a.terms);
 }
 return entries;
}

/** Not attached to runtime: explicit sealed development restart capability
 * only. This never publishes, revokes, reauthorizes, or opens a provider. */
export function openPrivateNativeReviewedEdition(fixture:DeveloperMvpSpiritFixtureKey,worldId:string){
 if(!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(worldId))throw Error('native_review_world_invalid');
 const owner=acquireDeveloperMvpSpiritFixtureOwner(fixture);
 let db:DatabaseSync|undefined,closed=false;
 try{
  if(!owner.yearbookReviewerKeyPem||owner.formalApprovalKeyPem)throw Error('native_reviewer_not_pinned');
  const key=createPublicKey(owner.yearbookReviewerKeyPem);
  if(key.asymmetricKeyType!=='ed25519')throw Error('native_reviewer_not_ed25519');
  const scope=createHash('sha256').update('valley-private-native-yearbook-scope/v1\0'+owner.seal).digest('hex');
  const sqlite=db=new DatabaseSync(owner.database);
  sqlite.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
  const assertSeal=()=>{
   owner.assertOwned();const rows=sqlite.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
   if(rows.length!==1||Object.keys(rows[0]).length!==2||rows[0].version!==1||rows[0].seal!==owner.seal)throw Error('native_review_seal_invalid');
  };
  assertSeal();
  const capture=nativeYearbookCaptureOnConnection(sqlite,owner.database,worldId,owner.assertOwned);
  let seen:Approval[]=[],pending:Approval[]|undefined,poisoned=false;
  const tx=<T>(write:boolean,run:()=>T):T|null=>{
   if(closed||poisoned)return null;
   let started=false;
   try{
    owner.assertOwned();sqlite.exec(write?'BEGIN IMMEDIATE':'BEGIN');started=true;
    assertSeal();const result=run();
    owner.assertOwned();sqlite.exec('COMMIT');started=false;
    if(pending)seen=pending;
    return result;
   }catch{if(started)try{sqlite.exec('ROLLBACK');}catch{closed=true;try{sqlite.close();}finally{owner.release();}}return null;}finally{pending=undefined;}
  };
  const log=()=>{
   try{
    const next=readLog(sqlite,key,scope,worldId);
    if(next.length<seen.length||seen.some((a,i)=>JSON.stringify(a)!==JSON.stringify(next[i])))
     throw Error('rewound_native_review_history');
    return pending=next;
   }catch(error){poisoned=true;throw error;}
  };
  const source=(pin:{weatherEntryId:string;lifeSectionId:string})=>{
   try{return capture({worldId,weatherEntryId:pin.weatherEntryId,lifeSectionId:pin.lifeSectionId});}
   catch(error){
    if(error instanceof Error&&['rewound_native_yearbook_snapshot','rewound_native_yearbook_payload'].includes(error.message))poisoned=true;
    throw error;
   }
  };
  const build=(pins:{weatherEntryId:string;lifeSectionId:string},ids:readonly string[],prior:string|null)=>buildNativeYearbookDraft(source(pins),ids,prior);
  const verifyCurrent=(a:Approval|undefined)=>{
   if(!a)return null;
   const t=a.terms,draft=build(t,t.selectedIds,t.priorEditionId);
   return draft?.sourceDigest===t.sourceDigest&&nativeYearbookDraftDigest(draft)===t.renderedDigest?
    {editionId:edition(t),draft}:null;
  };
  return Object.freeze({
   menu(pin:{weatherEntryId:string;lifeSectionId:string}){return tx(false,()=>nativeYearbookChoiceMenu(source(pin)))??[];},
   preview(pin:{weatherEntryId:string;lifeSectionId:string},ids:readonly string[]){
    return tx(false,()=>{
     const entries=log(),latest=entries.at(-1),priorEditionId=latest?edition(latest.terms):null;
     const draft=build(pin,ids,priorEditionId);
     if(!draft||entries.length>=CAP||entries.some(e=>e.terms.sourceDigest===draft.sourceDigest))return null;
     const terms:PrivateNativeYearbookReviewTerms={schema:SCHEMA,fixtureScopeId:scope,worldId,weatherEntryId:pin.weatherEntryId,
      lifeSectionId:pin.lifeSectionId,priorEditionId,sourceDigest:draft.sourceDigest,renderedDigest:nativeYearbookDraftDigest(draft),selectedIds:[...draft.selectedIds]};
     return {terms,draft};
    });
   },
   approve(input:unknown):string|null{
    return tx(true,()=>{
     const approved=checkedApproval(structuredClone(input),key,scope,worldId);
     if(!approved)return null;
     const entries=log(),latest=entries.at(-1),t=approved.terms,id=edition(t),prior=latest?edition(latest.terms):null;
     if(latest&&id===prior)return JSON.stringify(latest)===JSON.stringify(approved)&&verifyCurrent(latest)?id:null;
     if(t.priorEditionId!==prior||entries.length>=CAP||entries.some(e=>e.terms.sourceDigest===t.sourceDigest)||
       !verifyCurrent(approved))return null;
     const serialized=JSON.stringify(approved);
     if(Buffer.byteLength(serialized)>BYTES)return null;
     if(!exists(sqlite))sqlite.exec(ddl);
     sqlite.prepare(`INSERT INTO ${name} VALUES (?,?)`).run(entries.length+1,serialized);
     pending=[...entries,approved];
     return id;
    });
   },
   read(){return tx(false,()=>verifyCurrent(log().at(-1)));},
   close(){if(!closed){closed=true;try{sqlite.close();}finally{owner.release();}}}
  });
 }catch(error){try{db?.close();}finally{owner.release();}throw error;}
}
