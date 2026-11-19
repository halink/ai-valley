import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';

const TABLE='valley_spirit_geography_observations';
const SQL='CREATE TABLE '+TABLE+' (opportunity_id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)';
const META='valley_spirit_geography_observations_v1',LIMIT=64;
export interface GeographyObservation {
 readonly schema:'persistent-rules-observed-geography/v1';readonly worldId:string;readonly opportunityId:string;
 readonly rainEventId:string;readonly rainStartedUs:string;readonly rainFirstWetUs:string;readonly rainEndedUs:string;
 readonly wetSourceRef:string;readonly wetAtUs:string;readonly wetRevision:number;readonly permissionVersion:number;
 readonly sourceResourceInstanceId:string;readonly targetId:string;readonly firstObservedAtUs:string;readonly firstObservedRevision:number;
 readonly executionAuthorized:false;
}
const fields=['schema','worldId','opportunityId','rainEventId','rainStartedUs','rainFirstWetUs','rainEndedUs','wetSourceRef',
 'wetAtUs','wetRevision','permissionVersion','sourceResourceInstanceId','targetId','firstObservedAtUs','firstObservedRevision','executionAuthorized'];
const time=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,16})$/u.test(v);
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function valid(v:unknown,worldId:string):v is GeographyObservation{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==fields.length||!fields.every(k=>Object.hasOwn(v,k)))return false;
 const r=v as GeographyObservation;
 return r.schema==='persistent-rules-observed-geography/v1'&&r.worldId===worldId&&r.executionAuthorized===false&&
  typeof r.sourceResourceInstanceId==='string'&&/^mvp-fruit:[A-Za-z0-9:_-]+:\d+:\d+$/u.test(r.sourceResourceInstanceId)&&r.sourceResourceInstanceId.length<=200&&
  typeof r.targetId==='string'&&/^ground:\d+:\d+$/u.test(r.targetId)&&r.targetId.length<=24&&
  [r.rainStartedUs,r.rainFirstWetUs,r.rainEndedUs,r.wetAtUs,r.firstObservedAtUs].every(time)&&
  r.rainEventId===worldId+':rain:'+r.rainStartedUs&&r.opportunityId===valleySpiritFruitFallOpportunityId(worldId,r.rainEventId,r.sourceResourceInstanceId)&&
  BigInt(r.rainStartedUs)<=BigInt(r.rainFirstWetUs)&&BigInt(r.rainFirstWetUs)<=BigInt(r.wetAtUs)&&
  BigInt(r.wetAtUs)<BigInt(r.rainEndedUs)&&BigInt(r.rainEndedUs)<=BigInt(r.firstObservedAtUs)&&
  nat(r.wetRevision)&&nat(r.firstObservedRevision)&&r.wetRevision<=r.firstObservedRevision&&
  nat(r.permissionVersion)&&r.permissionVersion>0&&
  r.wetSourceRef===worldId+'/weather-'+r.permissionVersion+'-'+(BigInt(r.wetAtUs)/60_000_000n);
}
const hash=(rows:readonly [string,string][])=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');

/** Own SQLite connection under the rules runtime's existing file lock. It
 * only accesses an independent private table after the world commits. */
export function openPersistentGeographyCustody(database:string,worldId:string,assertOwned:()=>void){
 const privateStat=()=>{
  assertOwned();const f=lstatSync(database,{bigint:true});
  if(!f.isFile()||f.nlink!==1n||f.uid!==BigInt(process.getuid!())||(f.mode&0o077n)!==0n)
   throw Error('geography_custody_requires_private_database');
  return f;
 };
 const inode=privateStat();
 const check=()=>{const f=privateStat();if(f.dev!==inode.dev||f.ino!==inode.ino)throw Error('geography_custody_database_changed');};
 const db=new DatabaseSync(database);
 const read=()=>{
  check();
  const meta=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='archive_meta' COLLATE NOCASE").get();
  if(meta?.type!=='table'||meta.sql!=='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
   throw Error('unknown_geography_custody_anchor_schema');
  const table=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(TABLE);
  if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE name IN (?, 'archive_meta') COLLATE NOCASE OR tbl_name IN (?, 'archive_meta') COLLATE NOCASE").get(TABLE,TABLE)||
   db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name IN (?, 'archive_meta') COLLATE NOCASE").get(TABLE)||
   table&&(table.type!=='table'||table.sql!==SQL))throw Error('unknown_geography_custody');
  const anchor=db.prepare('SELECT value FROM archive_meta WHERE key=?').get(META);
  if(!table&&!anchor)return {installed:false,rows:[] as GeographyObservation[]};
  if(!table||!anchor)throw Error('missing_geography_custody_anchor');
  const raw=db.prepare("SELECT opportunity_id, CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body "+
   "FROM valley_spirit_geography_observations ORDER BY opportunity_id LIMIT ?").all(LIMIT+1);
  if(raw.length>LIMIT)throw Error('geography_custody_bound');
  const bytes: [string,string][]=[];
  const rows=raw.map(({opportunity_id,body})=>{
   if(typeof body!=='string'||typeof opportunity_id!=='string')throw Error('invalid_geography_custody');
   const value:unknown=JSON.parse(body);
   if(!valid(value,worldId)||value.opportunityId!==opportunity_id||body!==JSON.stringify(value))throw Error('invalid_geography_custody');
   bytes.push([opportunity_id,body]);return value;
  });
  if(hash(bytes)!==anchor.value)throw Error('geography_custody_anchor_mismatch');
  return {installed:true,rows};
 };
 const lookup=(id:string)=>{
  check();db.exec('BEGIN');
  try{const row=read().rows.find(r=>r.opportunityId===id);db.exec('COMMIT');return row;}
  catch(error){db.exec('ROLLBACK');throw error;}
 };
 return {
  lookup,
  record(value:GeographyObservation){
   if(!valid(value,worldId))return null;
   check();db.exec('BEGIN IMMEDIATE');
   try{
    const {rows,installed}=read(),prior=rows.find(r=>r.opportunityId===value.opportunityId);
    if(prior||rows.length>=LIMIT){db.exec('COMMIT');return prior??null;}
    const body=JSON.stringify(value);
    if(!installed){
     db.exec(SQL);
     db.prepare('INSERT INTO archive_meta (key,value) VALUES (?,?)').run(META,hash([]));
    }
    db.prepare('INSERT INTO valley_spirit_geography_observations VALUES (?,?)').run(value.opportunityId,body);
    const next=[...rows,value].map(r=>[r.opportunityId,JSON.stringify(r)] as [string,string]).sort(([a],[b])=>a<b?-1:a>b?1:0);
    if(db.prepare('UPDATE archive_meta SET value=? WHERE key=?').run(hash(next),META).changes!==1)throw Error('missing_geography_custody_anchor');
    db.exec('COMMIT');return value;
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  close(){db.close();},
 };
}
export type PersistentGeographyCustody=ReturnType<typeof openPersistentGeographyCustody>;
