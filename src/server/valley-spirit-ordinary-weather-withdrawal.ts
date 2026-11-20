import {createPublicKey,verify} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ORDINARY_REVIEW_SIGNATURE,ORDINARY_REVIEW_WORLD,ordinaryReviewDigest,type OrdinaryWeatherReviewReceipt} from './valley-spirit-ordinary-weather-receipt.js';

const schema='ordinary-offline-weather-withdrawal/v1';
const table='valley_spirit_ordinary_weather_withdrawal';
const ddl='CREATE TABLE '+table+' (entry_id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)';
const hex=/^[a-f0-9]{64}$/u,entry=/^valley-almanac-[a-f0-9]{64}$/u;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export type OrdinaryWeatherWithdrawalReason='editorial-withdrawal'|'source-correction';
export interface OrdinaryWeatherWithdrawalTerms{
 readonly schema:typeof schema;readonly worldId:string;readonly saveScope:string;readonly entryId:string;
 readonly headRevision:number;readonly publicationReceiptDigest:string;readonly priorAlmanacDigest:string;
 readonly priorWithdrawalDigest:string;readonly reason:OrdinaryWeatherWithdrawalReason;
}
export function ordinaryWeatherWithdrawalTerms(worldId:string,saveScope:string,entryId:string,headRevision:number,publication:OrdinaryWeatherReviewReceipt,
 priorAlmanacDigest:string,priorWithdrawalDigest:string,reason:OrdinaryWeatherWithdrawalReason):OrdinaryWeatherWithdrawalTerms{
 return {schema,worldId,saveScope,entryId,headRevision,publicationReceiptDigest:ordinaryReviewDigest(publication),
  priorAlmanacDigest,priorWithdrawalDigest,reason};
}
export function encodeOrdinaryWeatherWithdrawal(t:unknown):Buffer|null{
 if(!exact(t,['schema','worldId','saveScope','entryId','headRevision','publicationReceiptDigest','priorAlmanacDigest','priorWithdrawalDigest','reason'])||
  t.schema!==schema||typeof t.worldId!=='string'||!ORDINARY_REVIEW_WORLD.test(t.worldId)||typeof t.entryId!=='string'||!entry.test(t.entryId)||
  !nat(t.headRevision)||(t.reason!=='editorial-withdrawal'&&t.reason!=='source-correction')||
  [t.saveScope,t.publicationReceiptDigest,t.priorAlmanacDigest,t.priorWithdrawalDigest].some(s=>typeof s!=='string'||!hex.test(s)))return null;
 return Buffer.from(JSON.stringify([schema,t.worldId,t.saveScope,t.entryId,t.headRevision,t.publicationReceiptDigest,
  t.priorAlmanacDigest,t.priorWithdrawalDigest,t.reason]));
}
export interface OrdinaryWeatherWithdrawal {readonly terms:OrdinaryWeatherWithdrawalTerms;readonly signature:string}
function valid(value:unknown,publication:OrdinaryWeatherReviewReceipt,worldRevision:unknown):value is OrdinaryWeatherWithdrawal{
 try{
  if(!exact(value,['terms','signature'])||typeof value.signature!=='string'||!ORDINARY_REVIEW_SIGNATURE.test(value.signature))return false;
  const bytes=encodeOrdinaryWeatherWithdrawal(value.terms),t=value.terms as OrdinaryWeatherWithdrawalTerms;
  if(!bytes||t.worldId!==publication.terms.worldId||t.saveScope!==publication.terms.saveScope||t.entryId!==publication.terms.entryId||
   t.publicationReceiptDigest!==ordinaryReviewDigest(publication)||!nat(worldRevision)||t.headRevision>worldRevision||
   t.headRevision<publication.terms.headRevision)return false;
  const signature=Buffer.from(value.signature,'base64url'),key=createPublicKey({
   key:Buffer.from(publication.reviewerDer,'base64url'),format:'der',type:'spki',
  });
  return signature.length===64&&signature.toString('base64url')===value.signature&&key.asymmetricKeyType==='ed25519'&&verify(null,bytes,key,signature);
 }catch{return false;}
}
function installed(db:DatabaseSync){
 if(db.prepare('SELECT 1 FROM sqlite_temp_schema WHERE lower(name)=? OR lower(tbl_name)=?').get(table,table))
  throw Error('ordinary_weather_withdrawal_temp_schema');
 const row=db.prepare('SELECT type,sql FROM main.sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
 if(!row)return false;
 if(row.type!=='table'||row.sql!==ddl||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(table))
  throw Error('ordinary_weather_withdrawal_schema');
 return true;
}
export function readOrdinaryWeatherWithdrawals(db:DatabaseSync,hasDependency:boolean,revision:unknown,publications:ReadonlyMap<string,OrdinaryWeatherReviewReceipt>){
 if(installed(db)!==hasDependency)throw Error('ordinary_weather_withdrawal_dependency');
 if(!hasDependency)return [];
 const rows=db.prepare(`SELECT entry_id,CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body FROM main.${table} ORDER BY rowid LIMIT 257`).all();
 if(!rows.length||rows.length>256)throw Error('ordinary_weather_withdrawal_bound');
 const result:OrdinaryWeatherWithdrawal[]=[];
 for(const row of rows){
  const p=typeof row.entry_id==='string'?publications.get(row.entry_id):undefined;
  const value:unknown=typeof row.body==='string'?JSON.parse(row.body):null;
  if(!p||!valid(value,p,revision)||row.body!==JSON.stringify(value)||value.terms.priorWithdrawalDigest!==ordinaryReviewDigest(result))
   throw Error('ordinary_weather_withdrawal_bad_custody');
  result.push(value);
 }
 return result;
}
export function appendOrdinaryWeatherWithdrawal(db:DatabaseSync,value:unknown,publication:OrdinaryWeatherReviewReceipt,revision:unknown){
 if(!db.isTransaction||!valid(value,publication,revision)||value.terms.headRevision!==revision)return false;
 if(!installed(db))db.exec(ddl);
 db.prepare(`INSERT INTO main.${table} VALUES (?,?)`).run(value.terms.entryId,JSON.stringify(value));
 return true;
}
