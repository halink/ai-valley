import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {assertDisposableRulesSavePath,authenticateDisposableRulesPayload,type DisposableRulesSaveAuthority} from './disposable-native-rules-save.js';
import {readDisposableNativeSpeechOnConnection,type DisposableSpeechPurpose} from './disposable-native-addressed-speech.js';
import {valleySpiritLifeBinding} from './valley-spirit-life-facts.js';
import {renderObjectiveDeliveredConversation} from './valley-spirit-life-almanac.js';

const SCHEMA='disposable-native-speech-editorial/v1' as const;
const AUDIENCE='offline-development-objective-speech' as const;
const TABLE='mvp_disposable_speech_editorial';
const DDL='CREATE TABLE mvp_disposable_speech_editorial(version INTEGER PRIMARY KEY NOT NULL, body TEXT NOT NULL, seal TEXT NOT NULL)';
const MAX=4096;
const hex=/^[0-9a-f]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const clock=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=1_000_000_000_000_000n;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface DisposableSpeechEditorialTerms {
 schema:typeof SCHEMA;audience:typeof AUDIENCE;decision:'publish'|'revoke';
 scope:string;reviewerFingerprint:string;worldId:string;headRevision:number;headAtUs:string;
 receiptId:string;receiptDigest:string;observedAtUs:string;priorVersion:0|1;lineDigest:string;
}
export function encodeDisposableSpeechEditorialTerms(t:unknown):Buffer|null{
 if(!exact(t,['schema','audience','decision','scope','reviewerFingerprint','worldId','headRevision','headAtUs',
  'receiptId','receiptDigest','observedAtUs','priorVersion','lineDigest'])||t.schema!==SCHEMA||t.audience!==AUDIENCE||
  !(t.decision==='publish'&&t.priorVersion===0||t.decision==='revoke'&&t.priorVersion===1)||
  typeof t.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(t.worldId)||
  typeof t.headRevision!=='number'||!Number.isSafeInteger(t.headRevision)||t.headRevision<1||
  !clock(t.headAtUs)||!clock(t.observedAtUs)||BigInt(t.observedAtUs)>BigInt(t.headAtUs)||
  typeof t.receiptId!=='string'||!uuid.test(t.receiptId)||
  [t.scope,t.reviewerFingerprint,t.receiptDigest,t.lineDigest].some(v=>typeof v!=='string'||!hex.test(v)))return null;
 return Buffer.from(JSON.stringify([SCHEMA,AUDIENCE,t.decision,t.scope,t.reviewerFingerprint,t.worldId,t.headRevision,
  t.headAtUs,t.receiptId,t.receiptDigest,t.observedAtUs,t.priorVersion,t.lineDigest]));
}
type Signed={terms:DisposableSpeechEditorialTerms;signature:string};
export function pinDisposableSpeechEditorialReviewer(pem:string):KeyObject{
 if(typeof pem!=='string'||pem.length>256||
  !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(pem))throw Error('disposable_speech_editorial_reviewer');
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519')throw Error('disposable_speech_editorial_reviewer');
 return key;
}
export interface DisposableSpeechEditorialWatermark {readonly reset?:never;seen:string[];isolated:boolean;}
function table(db:DatabaseSync):boolean{
 const row=db.prepare('SELECT type,sql FROM main.sqlite_schema WHERE name=?').get(TABLE);
 if(!row)return false;
 if(row.type!=='table'||row.sql!==DDL||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='trigger' AND tbl_name=?").get(TABLE))
  throw Error('disposable_speech_editorial_schema');
 return true;
}
/** Borrowed scope: caller exclusively holds the stopped fresh owning save. */
export function openDisposableSpeechEditorial(database:string,owner:DisposableRulesSaveAuthority,purpose:DisposableSpeechPurpose,
 reviewer:KeyObject,watermark:DisposableSpeechEditorialWatermark){
 assertDisposableRulesSavePath(owner,database);
 const fingerprint=createHash('sha256').update(reviewer.export({type:'spki',format:'der'})).digest('hex');
 const file=lstatSync(database,{bigint:true});
 const scope=authenticateDisposableRulesPayload(owner,SCHEMA,JSON.stringify([String(file.dev),String(file.ino),fingerprint]));
 const db=new DatabaseSync(database);
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');}catch(e){db.close();throw e;}
 let closed=false;
 const signed=(raw:unknown):Signed|null=>{
  if(!exact(raw,['terms','signature'])||typeof raw.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(raw.signature))return null;
  const bytes=encodeDisposableSpeechEditorialTerms(raw.terms),t=raw.terms as DisposableSpeechEditorialTerms;
  const sig=Buffer.from(raw.signature,'base64url');
  return bytes&&t.scope===scope&&t.reviewerFingerprint===fingerprint&&sig.toString('base64url')===raw.signature&&verify(null,bytes,reviewer,sig)
   ?{terms:t,signature:raw.signature}:null;
 };
 const readLog=()=>{
  try{
   const rows=table(db)?db.prepare(`SELECT version,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body,
    CASE WHEN length(seal)=64 THEN seal END AS seal FROM main.${TABLE} ORDER BY version LIMIT 3`).all(MAX):[];
   if(rows.length>2||rows.length<watermark.seen.length)throw Error('disposable_speech_editorial_rewind');
   const log:Signed[]=[],bodies:string[]=[];
   for(const [i,r] of rows.entries()){
    if(r.version!==i+1||typeof r.body!=='string'||r.seal!==authenticateDisposableRulesPayload(owner,SCHEMA,r.body)||
       i<watermark.seen.length&&r.body!==watermark.seen[i])throw Error('disposable_speech_editorial_row');
    const item=signed(JSON.parse(r.body));
    if(!item||item.terms.priorVersion!==i)throw Error('disposable_speech_editorial_signature');
    const p=log[0]?.terms,t=item.terms;
    if(p&&(p.worldId!==t.worldId||p.receiptId!==t.receiptId||p.lineDigest!==t.lineDigest||
     p.receiptDigest!==t.receiptDigest||p.observedAtUs!==t.observedAtUs||p.headRevision>t.headRevision||
     BigInt(p.headAtUs)>BigInt(t.headAtUs)))throw Error('disposable_speech_editorial_custody');
    log.push(item);bodies.push(r.body);
   }
   return {log,bodies};
  }catch(e){watermark.isolated=true;throw e;}
 };
 const state=()=>{
  const previous=readLog();
  // A read transaction returns an exact native proof; absence/corruption is
  // never replaced with a prior receipt or a generic conversation.
  let native;
  try{native=readDisposableNativeSpeechOnConnection(db,owner,purpose);}
  catch(error){watermark.isolated=true;throw error;}
  if(!native||native.receipts.length!==1)return {previous,native:null};
  const receipt=native.receipts[0],binding=valleySpiritLifeBinding(receipt);
  const line=renderObjectiveDeliveredConversation(receipt.atUs);
  if(!line)return {previous,native:null};
  return {previous,native:{head:native.head,receipt,receiptDigest:binding.receiptDigest,line}};
 };
 const propose=(s:ReturnType<typeof state>,decision:'publish'|'revoke')=>{
  const {native,previous}=s;
  if(!native||!(decision==='publish'&&previous.log.length===0||decision==='revoke'&&previous.log.length===1))return null;
  const terms:DisposableSpeechEditorialTerms={schema:SCHEMA,audience:AUDIENCE,decision,scope,reviewerFingerprint:fingerprint,
   worldId:native.head.worldId,headRevision:native.head.revision,headAtUs:native.head.atUs,receiptId:native.receipt.receiptId,
   receiptDigest:native.receiptDigest,observedAtUs:native.receipt.atUs,priorVersion:decision==='publish'?0:1,lineDigest:hash(native.line)};
  const old=previous.log[0]?.terms;
  if(old&&(old.worldId!==terms.worldId||old.receiptId!==terms.receiptId||old.receiptDigest!==terms.receiptDigest||old.lineDigest!==terms.lineDigest||
   old.headRevision>terms.headRevision||BigInt(old.headAtUs)>BigInt(terms.headAtUs)))return null;
  return terms;
 };
 const tx=<T>(write:boolean,run:(s:ReturnType<typeof state>)=>{result:T;append?:string}):T|null=>{
  if(closed||watermark.isolated)return null;
  let open=false;
  try{
   assertDisposableRulesSavePath(owner,database);db.exec(write?'BEGIN IMMEDIATE':'BEGIN');open=true;
   const s=state(),{result,append}=run(s);
   assertDisposableRulesSavePath(owner,database);db.exec('COMMIT');open=false;
   watermark.seen=append===undefined?s.previous.bodies:[...s.previous.bodies,append];
   return result;
  }catch{if(open)try{db.exec('ROLLBACK');}catch{watermark.isolated=true;}return null;}
 };
 return Object.freeze({
  preview(decision:'publish'|'revoke'){return tx(false,s=>{const terms=propose(s,decision);return {result:terms&&s.native?{terms,line:s.native.line}:null};});},
  apply(approval:unknown){return tx(true,s=>{
   const a=signed(structuredClone(approval)),expected=a&&propose(s,a.terms.decision);
   if(!a||!expected||!encodeDisposableSpeechEditorialTerms(a.terms)!.equals(encodeDisposableSpeechEditorialTerms(expected)!))return {result:null};
   const body=JSON.stringify({terms:expected,signature:a.signature});
   if(Buffer.byteLength(body)>MAX)return {result:null};
   if(!table(db))db.exec(DDL);
   const version=expected.priorVersion+1;
   db.prepare(`INSERT INTO main.${TABLE} VALUES(?,?,?)`).run(version,body,authenticateDisposableRulesPayload(owner,SCHEMA,body));
   if(readLog().bodies.at(-1)!==body)throw Error('disposable_speech_editorial_readback');
   return {result:Object.freeze({status:expected.decision==='publish'?'published' as const:'revoked' as const,version}),append:body};
  });},
  readPublished(){return tx(false,s=>{
   const p=s.previous.log[0]?.terms,n=s.native;
   if(s.previous.log.length!==1||!n||!p||p.worldId!==n.head.worldId||p.headRevision!==n.head.revision||p.headAtUs!==n.head.atUs||
    p.receiptId!==n.receipt.receiptId||p.receiptDigest!==n.receiptDigest||p.observedAtUs!==n.receipt.atUs||
    p.lineDigest!==hash(n.line))return {result:null};
   return {result:Object.freeze({status:'offline-development-publication' as const,rendererVersion:1 as const,line:n.line})};
  });},
  close(){if(!closed){closed=true;db.close();}}
 });
}
