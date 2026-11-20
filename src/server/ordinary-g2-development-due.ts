import {gzipSync} from 'node:zlib';
import {readAtomicNativeRulesRenewal} from './godot-mvp.js';
import {ownsSelectedPositiveRehearsal,type openSelectedOrdinaryRehearsal} from './valley-spirit-ordinary-selected-rehearsal.js';
import {createHash,verify} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {assertOrdinaryG2DevelopmentPath,authenticateOrdinaryG2DevelopmentV3,type OrdinaryG2DevelopmentOrigin} from './ordinary-g2-development-origin.js';
import {encodeOrdinaryDevelopmentV3,ownsOrdinaryDevelopmentV3Pin,type OrdinaryDevelopmentV3Terms,type OrdinaryDevelopmentV3Pin} from './ordinary-g2-development-v3.js';

const MARK='valley_spirit_ordinary_g2_dev_due_v3';
const ddl='CREATE TABLE '+MARK+' (slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1), anchor TEXT NOT NULL)';
const BODY='ordinary_g2_development_v3_due_intent',SEAL='ordinary_g2_development_v3_due_seal';
const schema='ordinary-g2-development-due-revalidation/v1';
const exact=(o:unknown,k:readonly string[]):o is Record<string,unknown>=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const clock=(v:unknown):v is string=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,15})$/.test(v);
export const digestOrdinaryDue=(o:unknown)=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
type Terms=Readonly<{schema:typeof schema;basis:OrdinaryDevelopmentV3Terms;rainArchiveDigest:string;dueUs:string}>;
type Approved=Readonly<{terms:Terms;signature:string}>;
type Outcome='eligible-detached'|'expired'|'invalid';
type Result=Readonly<{status:Outcome;atUs:string;revision:number;headDigest:string}>;
const executionSchema='ordinary-g2-development-due-execution-consent/v1';
type ExecutionTerms=Readonly<{schema:typeof executionSchema;reviewer:string;originScope:string;
 acceptedDigest:string;eligibleDigest:string;basis:OrdinaryDevelopmentV3Terms}>;
type ExecutionApproval=Readonly<{terms:ExecutionTerms;signature:string}>;
type Consumed=Readonly<{placementDigest:string;consentDigest:string}>;
type RecordBody=Readonly<{signed:Approved;result:Result|null;consumed?:Consumed}>;
type DueEvidence=Readonly<{record:RecordBody;seal:string;body:string}>;
export function ordinaryDevelopmentDueTerms(basis:OrdinaryDevelopmentV3Terms,rainArchiveDigest:string){
 const next={schema,basis,rainArchiveDigest,dueUs:(BigInt(basis.atUs)+1_000_000n).toString()} as const;
 return encodeOrdinaryDevelopmentDue(next)?Object.freeze(next):null;
}
export function encodeOrdinaryDevelopmentDue(t:unknown){
 if(!exact(t,['schema','basis','rainArchiveDigest','dueUs'])||t.schema!==schema||!hex(t.rainArchiveDigest)||!clock(t.dueUs))return null;
 const b=t.basis as OrdinaryDevelopmentV3Terms,bytes=encodeOrdinaryDevelopmentV3(b);
 if(!bytes||BigInt(t.dueUs)!==BigInt(b.atUs)+1_000_000n||BigInt(t.dueUs)>=BigInt(b.eligibleUntilUs)||BigInt(t.dueUs)>=BigInt(b.expiresUs))return null;
 return Buffer.from(JSON.stringify([schema,bytes.toString('base64url'),t.rainArchiveDigest,t.dueUs]));
}
export function verifyOrdinaryDevelopmentDue(a:unknown,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin):Approved|null{
 try{
  if(!ownsOrdinaryDevelopmentV3Pin(pin)||!exact(a,['terms','signature'])||typeof a.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(a.signature))return null;
  const t=a.terms as Terms,bytes=encodeOrdinaryDevelopmentDue(t),sig=Buffer.from(a.signature,'base64url');
  if(!bytes||sig.toString('base64url')!==a.signature||!verify(null,bytes,pin.key,sig))return null;
  if(t.basis.reviewer!==pin.fingerprint||t.basis.originScope!==authenticateOrdinaryG2DevelopmentV3(origin,'consent-scope',pin.fingerprint))return null;
  return {terms:t,signature:a.signature};
 }catch{return null;}
}
export function ordinaryDevelopmentDueHead(db:DatabaseSync,w:World){
 const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all(),r=rows[0];
 return rows.length===1&&r.id===w.id&&r.revision===w.revision&&r.state instanceof Uint8Array?createHash('sha256').update(r.state).digest('hex'):null;
}
function archive(db:DatabaseSync){
 const m=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta'").get();
 if(m?.name!=='archive_meta'||m.type!=='table'||m.sql!=='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)'||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)='archive_meta' AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get()||
   db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN ('archive_meta','worlds') OR lower(tbl_name) IN ('archive_meta','worlds')").get())
  throw Error('ordinary_g2_development_due_schema');
 const marker=db.prepare('SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)=?').get(MARK);
 if(db.prepare('SELECT 1 FROM sqlite_temp_schema WHERE lower(name)=? OR lower(tbl_name)=?').get(MARK,MARK)||
   marker&&(marker.name!==MARK||marker.type!=='table'||marker.sql!==ddl||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(MARK)))
  throw Error('ordinary_g2_development_due_marker');
 const raws=db.prepare('SELECT key,CASE WHEN length(CAST(value AS BLOB))<=8192 THEN value END value FROM main.archive_meta WHERE key IN (?,?)').all(BODY,SEAL);
 if(!raws.length&&!marker)return null;
 if(!marker)throw Error('ordinary_g2_development_due_marker');
 const rows=db.prepare('SELECT slot,CASE WHEN length(anchor)=64 THEN anchor END AS anchor FROM main.'+MARK+' LIMIT 2').all();
 const sr=rows[0];
 if(rows.length!==1||sr.slot!==1||!hex(sr.anchor))throw Error('ordinary_g2_development_due_marker');
 const body=raws.find(r=>r.key===BODY)?.value,seal=raws.find(r=>r.key===SEAL)?.value;
 if(raws.length!==2||typeof body!=='string'||!hex(seal))throw Error('ordinary_g2_development_due_anchor');
 return {body,seal,anchor:sr.anchor};
}
export const hasOrdinaryDevelopmentDue=(db:DatabaseSync)=>!!archive(db);
export function readOrdinaryDevelopmentDueRecord(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin):DueEvidence|null{
 const raw=archive(db);
 if(!raw)return null;
 if(raw.seal!==authenticateOrdinaryG2DevelopmentV3(origin,schema,raw.body))throw Error('ordinary_g2_development_due_signature');
 const r=JSON.parse(raw.body) as RecordBody,a=verifyOrdinaryDevelopmentDue(r.signed,origin,pin);
 if(!exact(r,['signed','result',...(Object.hasOwn(r,'consumed')?['consumed']:[])])||!a||
   raw.anchor!==authenticateOrdinaryG2DevelopmentV3(origin,schema+'-immutable',JSON.stringify(a)))throw Error('ordinary_g2_development_due_scope');
 const x=r.result;
 if(x!==null&&(!exact(x,['status','revision','atUs','headDigest'])||!['eligible-detached','expired','invalid'].includes(x.status)||
  x.atUs!==a.terms.dueUs||!Number.isSafeInteger(x.revision)||x.revision<=a.terms.basis.revision||!hex(x.headDigest)))
  throw Error('ordinary_g2_development_due_result_shape');
 if(Object.hasOwn(r,'consumed')&&(!r.consumed||x?.status!=='eligible-detached'||!exact(r.consumed,['placementDigest','consentDigest'])||
   !hex(r.consumed.placementDigest)||!hex(r.consumed.consentDigest)||!pin.dueTransfer))
  throw Error('ordinary_g2_development_due_consumed_shape');
 return {record:r,seal:raw.seal,body:raw.body};
}
export function readOrdinaryDevelopmentDue(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin,w:World,
 placementDigest?:string){
 const r=readOrdinaryDevelopmentDueRecord(db,origin,pin)?.record;
 if(!r)return null;
 const head=ordinaryDevelopmentDueHead(db,w),result=r.result,now=minuteToClimateUs(w.minute),basis=r.signed.terms.basis;
 if(!head||basis.worldId!==w.id)throw Error('ordinary_g2_development_due_scope');
 if(r.consumed){
  if(placementDigest!==r.consumed.placementDigest||!result||w.revision<=result.revision||BigInt(now)<BigInt(result.atUs))
   throw Error('ordinary_g2_development_due_unpaired');
 }else if(placementDigest||(result===null?(basis.headDigest!==head||basis.revision!==w.revision||basis.atUs!==now):
  (result.atUs!==now||result.revision!==w.revision||result.headDigest!==head)))throw Error('ordinary_g2_development_due_head');
 return r;
}
export function ordinaryDueExecutionTerms(origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin,d:DueEvidence,forRead=false){
 const f=pin.dueTransfer,r=d.record;
 if(!ownsOrdinaryDevelopmentV3Pin(pin)||!f||r.result?.status!=='eligible-detached'||(!forRead&&r.consumed))return null;
 const basis={...r.signed.terms.basis,revision:r.result.revision,atUs:r.result.atUs,headDigest:r.result.headDigest};
 const t={schema:executionSchema,reviewer:f.fingerprint,originScope:authenticateOrdinaryG2DevelopmentV3(origin,executionSchema,f.fingerprint),
  acceptedDigest:digestOrdinaryDue(r.signed),eligibleDigest:digestOrdinaryDue(r.result),basis} as const;
 return encodeOrdinaryDueExecution(t)?Object.freeze(t):null;
}
export function encodeOrdinaryDueExecution(t:unknown){
 if(!exact(t,['schema','reviewer','originScope','acceptedDigest','eligibleDigest','basis'])||t.schema!==executionSchema||
    ![t.reviewer,t.originScope,t.acceptedDigest,t.eligibleDigest].every(hex))return null;
 const basis=encodeOrdinaryDevelopmentV3(t.basis);
 return basis?Buffer.from(JSON.stringify([executionSchema,t.reviewer,t.originScope,t.acceptedDigest,t.eligibleDigest,basis.toString('base64url')])):null;
}
export function verifyOrdinaryDueExecution(v:unknown,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin,d:DueEvidence,forRead=false):ExecutionApproval|null{
 try{
  if(!pin.dueTransfer||!exact(v,['terms','signature'])||typeof v.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(v.signature))return null;
  const t=ordinaryDueExecutionTerms(origin,pin,d,forRead),wire=encodeOrdinaryDueExecution(v.terms),signature=Buffer.from(v.signature,'base64url');
  if(!t||!wire||!wire.equals(encodeOrdinaryDueExecution(t)!)||signature.toString('base64url')!==v.signature||
   !verify(null,wire,pin.dueTransfer.key,signature))return null;
  return {terms:t,signature:v.signature};
 }catch{return null;}
}
export function verifyDueExecutionPlacement(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin,input:unknown,placementDigest:string){
 if(!pin.dueTransfer)return null;
 const d=readOrdinaryDevelopmentDueRecord(db,origin,pin),consumed=d?.record.consumed;
 if(!d||consumed?.placementDigest!==placementDigest)return null;
 const a=verifyOrdinaryDueExecution(input,origin,pin,d,true);
 return a&&consumed.consentDigest===digestOrdinaryDue(a)?{terms:a.terms.basis,signature:a.signature}:null;
}
export function consumeOrdinaryDevelopmentDue(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin,d:DueEvidence,
 input:unknown,placementDigest:string){
 const file=db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file,a=verifyOrdinaryDueExecution(input,origin,pin,d);
 if(!db.isTransaction||typeof file!=='string'||!hex(placementDigest)||!a)throw Error('ordinary_g2_development_due_consume');
 assertOrdinaryG2DevelopmentPath(origin,file);
 const rows=db.prepare('SELECT opportunity,CASE WHEN length(body)<=8192 THEN body END AS body,seal FROM main.valley_spirit_ordinary_g2_dev_receipt_v3 LIMIT 2').all(),raw=rows[0];
 const got=rows.length===1&&typeof raw.body==='string'?JSON.parse(raw.body):null;
 const t=a.terms.basis;
 if(!got||raw.opportunity!==t.opportunityId||raw.seal!==authenticateOrdinaryG2DevelopmentV3(origin,'v3-receipt',raw.body as string)||
  digestOrdinaryDue(got)!==placementDigest||digestOrdinaryDue(got.approval)!==digestOrdinaryDue(a)||
  got.afterRevision!==t.revision+1||!hex(got.afterDigest)||got.sourceBefore!==got.sourceAfter+1)
  throw Error('ordinary_g2_development_due_missing_placed_half');
 const consumed={placementDigest,consentDigest:digestOrdinaryDue(a)},body=JSON.stringify({...d.record,consumed});
 if(db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(body,BODY,d.body).changes!==1||
  db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(authenticateOrdinaryG2DevelopmentV3(origin,schema,body),SEAL,d.seal).changes!==1)
  throw Error('ordinary_g2_development_due_consumed_CAS');
}
export function writeOrdinaryDevelopmentDue(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin,w:World,
 signed:Approved,evidence:{proof:NonNullable<ReturnType<ReturnType<typeof openSelectedOrdinaryRehearsal>['currentPositive']>>}|{before:World;outcome:Outcome}){
 const file=db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file;
 if(!db.isTransaction||typeof file!=='string'||!verifyOrdinaryDevelopmentDue(signed,origin,pin))throw Error('ordinary_g2_development_due_writer');
 assertOrdinaryG2DevelopmentPath(origin,file);
 const t=signed.terms.basis,outcome='outcome' in evidence?evidence.outcome:undefined;
 if('proof' in evidence){
  const p=evidence.proof;
  if(!ownsSelectedPositiveRehearsal(p)||p.reviewDigest!==t.reviewDigest||p.headDigest!==t.headDigest||p.snapshot!==t.snapshot||
    p.evidence.offer.opportunityId!==t.opportunityId||p.evidence.lot.lot.id!==t.lotId)throw Error('ordinary_g2_development_due_review');
 }else{
  const {before}=evidence;
  if(!readAtomicNativeRulesRenewal(before,w)?.flow||before.id!==t.worldId||before.revision!==t.revision||
   minuteToClimateUs(before.minute)!==t.atUs||createHash('sha256').update(gzipSync(JSON.stringify(before),{level:1})).digest('hex')!==t.headDigest)
    throw Error('ordinary_g2_development_due_native');
 }
 const old=archive(db),prior=old&&JSON.parse(old.body) as RecordBody;
 if(outcome?(old?.seal!==authenticateOrdinaryG2DevelopmentV3(origin,schema,old?.body??'')||prior?.result!==null||
  digestOrdinaryDue(prior?.signed)!==digestOrdinaryDue(signed)):!!old)throw Error('ordinary_g2_development_due_transition');
 const head=ordinaryDevelopmentDueHead(db,w);
 if(!head)throw Error('ordinary_g2_development_due_world');
 const result=outcome?{status:outcome,atUs:minuteToClimateUs(w.minute),revision:w.revision,headDigest:head}:null;
 const body=JSON.stringify({signed,result}),seal=authenticateOrdinaryG2DevelopmentV3(origin,schema,body);
 if(body.length>8192)throw Error('ordinary_g2_development_due_size');
 if(old){
  if(db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(body,BODY,old.body).changes!==1||
   db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(seal,SEAL,old.seal).changes!==1)
   throw Error('ordinary_g2_development_due_CAS');
 }else{
  db.exec(ddl);
  db.prepare('INSERT INTO main.'+MARK+' VALUES(1,?)').run(authenticateOrdinaryG2DevelopmentV3(origin,schema+'-immutable',JSON.stringify(signed)));
  db.prepare('INSERT INTO main.archive_meta (key,value) VALUES(?,?),(?,?)').run(BODY,body,SEAL,seal);
 }
 const final=readOrdinaryDevelopmentDue(db,origin,pin,w);
 if(!final||digestOrdinaryDue(final.result)!==digestOrdinaryDue(result))throw Error('ordinary_g2_development_due_readback');
 return final;
}
