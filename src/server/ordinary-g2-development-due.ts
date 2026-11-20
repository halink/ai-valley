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
type RecordBody=Readonly<{signed:Approved;result:Result|null}>;
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
export function readOrdinaryDevelopmentDue(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:OrdinaryDevelopmentV3Pin,w:World){
 const raw=archive(db);
 if(!raw)return null;
 if(raw.seal!==authenticateOrdinaryG2DevelopmentV3(origin,schema,raw.body))throw Error('ordinary_g2_development_due_signature');
 const r=JSON.parse(raw.body) as RecordBody,a=verifyOrdinaryDevelopmentDue(r.signed,origin,pin),head=ordinaryDevelopmentDueHead(db,w);
 if(!head||!exact(r,['signed','result'])||!a||a.terms.basis.worldId!==w.id||
  raw.anchor!==authenticateOrdinaryG2DevelopmentV3(origin,schema+'-immutable',JSON.stringify(a)))throw Error('ordinary_g2_development_due_scope');
 const result=r.result,now=minuteToClimateUs(w.minute),basis=a.terms.basis;
 if(result===null?(basis.headDigest!==head||basis.revision!==w.revision||basis.atUs!==now):
  (!exact(result,['status','revision','atUs','headDigest'])||!['eligible-detached','expired','invalid'].includes(result.status)||
   now!==a.terms.dueUs||result.atUs!==now||result.revision!==w.revision||result.revision<=basis.revision||result.headDigest!==head))
  throw Error('ordinary_g2_development_due_head');
 return r;
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
