import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import type {DisconnectedWeatherUseContext} from './valley-spirit-weather-use-grant.js';
import {privateWeatherRehearsalScope,readPrivateWeatherRehearsalSnapshot} from './valley-spirit-private-weather-store.js';
import {nativeWeatherPacketAuthorityOnConnection} from './valley-spirit-native-weather-packet.js';
import {previewGroundedSyntheticWeather} from './valley-spirit-almanac.js';

const schema='valley-private-weather-editorial/v1';
const TABLE='valley_spirit_private_weather_editorial';
const DDL=`CREATE TABLE ${TABLE}(seq INTEGER NOT NULL PRIMARY KEY, signed TEXT NOT NULL)`;
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const hash=(u:unknown)=>createHash('sha256').update(JSON.stringify(u)).digest('hex');
const id=(s:unknown):s is string=>typeof s==='string'&&/^valley-almanac-[a-f0-9]{64}$/.test(s);
const keys=['schema','scope','entryId','priorEntryId','permissionVersion','textVersion','rendererVersion','renderedDigest'] as const;
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
const exact=(u:unknown,ks:readonly string[]):u is Record<string,unknown>=>!!u&&typeof u==='object'&&!Array.isArray(u)&&
 Object.keys(u).length===ks.length&&ks.every(k=>Object.hasOwn(u,k));
export interface PrivateWeatherEditorialTerms {
 schema:typeof schema;scope:string;entryId:string;priorEntryId:string|null;
 permissionVersion:number;textVersion:number;rendererVersion:1;renderedDigest:string;
}
interface Signed {terms:PrivateWeatherEditorialTerms;signature:string}
export function encodePrivateWeatherEditorial(input:unknown):Buffer|null {
 if(!exact(input,keys)||input.schema!==schema||!hex(input.scope)||!id(input.entryId)||
    !(input.priorEntryId===null||id(input.priorEntryId))||input.priorEntryId===input.entryId||
    !positive(input.permissionVersion)||!positive(input.textVersion)||input.rendererVersion!==1||!hex(input.renderedDigest))return null;
 return Buffer.from(JSON.stringify(['sealed-synthetic-only',...keys.map(k=>input[k])]));
}
function checked(input:unknown,key:KeyObject,scope:string):Signed|null {
 if(!exact(input,['terms','signature'])||typeof input.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(input.signature))return null;
 const bytes=encodePrivateWeatherEditorial(input.terms);
 if(!bytes||!exact(input.terms,keys)||input.terms.scope!==scope)return null;
 const sig=Buffer.from(input.signature,'base64url');
 if(sig.length!==64||sig.toString('base64url')!==input.signature||!verify(null,bytes,key,sig))return null;
 const terms=Object.fromEntries(keys.map(k=>[k,(input.terms as Record<string,unknown>)[k]])) as unknown as PrivateWeatherEditorialTerms;
 return {terms,signature:input.signature};
}
function exists(db:DatabaseSync){
 const t=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(TABLE);
 if(!t)return false;
 if(t.type!=='table'||t.sql!==DDL||
    db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
  throw Error('private_weather_editorial_schema');
 return true;
}
function history(db:DatabaseSync,key:KeyObject,scope:string){
 if(!exists(db))return [];
 const rows=db.prepare(`SELECT seq,CASE WHEN length(CAST(signed AS BLOB))<=2048 THEN signed END AS signed FROM ${TABLE} ORDER BY seq LIMIT 33`).all();
 if(!rows.length||rows.length>32)throw Error('private_weather_editorial_capacity');
 const out:Signed[]=[];
 for(const row of rows){
  if(row.seq!==out.length+1||typeof row.signed!=='string')throw Error('private_weather_editorial_row');
  const a=checked(JSON.parse(row.signed),key,scope);
  if(!a||JSON.stringify(a)!==row.signed||a.terms.priorEntryId!==(out.at(-1)?.terms.entryId??null)||
    out.some(prior=>prior.terms.entryId===a.terms.entryId))throw Error('private_weather_editorial_history');
  out.push(a);
 }
 return out;
}

/** Explicit sealed private editor. Nothing here uses send permission to approve,
 * reads a public almanac, publishes, or writes during preview/readback. */
export function openPrivateWeatherEditorial(owner:DeveloperMvpSpiritFixtureOwner,context:DisconnectedWeatherUseContext){
 const fixed=structuredClone(context),scope=privateWeatherRehearsalScope(owner,fixed);
 if(!owner.weatherUse?.editorialKeyPem)throw Error('private_weather_editorial_key_not_pinned');
 const key=createPublicKey(owner.weatherUse.editorialKeyPem);
 if(key.asymmetricKeyType!=='ed25519')throw Error('private_weather_editorial_key');
 const db=new DatabaseSync(owner.database);
 try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
  const authority=nativeWeatherPacketAuthorityOnConnection(db,owner,fixed.worldId);
  let closed=false,isolation=false,seen:Signed[]=[];
  let priorRows:ReturnType<typeof readPrivateWeatherRehearsalSnapshot>['rows']=[];
  const immutable=(e:typeof priorRows[number])=>hash([e.entryId,e.packet,e.origin,e.textVersion]);
  const tx=<T>(write:boolean,run:(log:Signed[],rows:ReturnType<typeof readPrivateWeatherRehearsalSnapshot>['rows'])=>{result:T;next?:Signed[]}):T|null=>{
   if(closed||isolation)return null;
   let began=false;
   try{
    owner.assertOwned();db.exec(write?'BEGIN IMMEDIATE':'BEGIN');began=true;
    const rows=readPrivateWeatherRehearsalSnapshot(db,owner,fixed).rows;
    if(rows.length<priorRows.length||priorRows.some((e,i)=>immutable(e)!==immutable(rows[i])||
       e.phase==='grounded'&&hash(e)!==hash(rows[i])))throw Error('private_weather_editorial_source_rewind');
    const log=history(db,key,scope);
    if(log.length<seen.length||seen.some((x,i)=>JSON.stringify(x)!==JSON.stringify(log[i])))
     throw Error('private_weather_editorial_rewind');
    const {result,next}=run(log,rows);
    owner.assertOwned();db.exec('COMMIT');began=false;seen=next??log;priorRows=rows;
    return result;
   }catch{
    isolation=true;
    if(began)try{db.exec('ROLLBACK');}catch{/* isolated */}
    return null;
   }
  };
  const candidate=(rows:ReturnType<typeof readPrivateWeatherRehearsalSnapshot>['rows'],priorEntryId:string|null)=>{
   const e=rows.at(-1);if(!e||e.entryId===priorEntryId)return null;
   const rendered=previewGroundedSyntheticWeather(e,authority);
   if(!rendered)return null;
   const terms:PrivateWeatherEditorialTerms={schema,scope,entryId:e.entryId,priorEntryId,permissionVersion:e.packet.permissionVersion,
    textVersion:e.textVersion,rendererVersion:rendered.rendererVersion,renderedDigest:hash([schema,e.packet,e.draft,rendered])};
   for(const f of rendered.facts)Object.freeze(f);
   Object.freeze(rendered.facts);Object.freeze(rendered.atmosphere);
   return Object.freeze({terms:Object.freeze(terms),rendered:Object.freeze(rendered)});
  };
  return Object.freeze({
   preview(){return tx(false,(log,rows)=>({result:candidate(rows,log.at(-1)?.terms.entryId??null)}));},
   approve(input:unknown):boolean{
    let approved:Signed|null;try{approved=checked(structuredClone(input),key,scope);}catch{return false;}
    if(!approved)return false;
    const s=approved;
    return tx(true,(log,rows)=>{
     const current=candidate(rows,log.at(-1)?.terms.entryId??null);
     if(!current||JSON.stringify(current.terms)!==JSON.stringify(s.terms)||log.length>=32||
        log.some(r=>r.terms.entryId===s.terms.entryId))return {result:false};
     if(!exists(db))db.exec(DDL);
     db.prepare(`INSERT INTO ${TABLE} VALUES (?,?)`).run(log.length+1,JSON.stringify(s));
     return {result:true,next:[...log,s]};
    })===true;
   },
   read(){
    return tx(false,(log,rows)=>{
     const last=log.at(-1),c=last?candidate(rows,last.terms.priorEntryId):null;
     return {result:last&&c&&JSON.stringify(last.terms)===JSON.stringify(c.terms)?
      Object.freeze({mode:'private-reviewed-offline-synthetic' as const,entryId:c.terms.entryId,rendered:c.rendered}):null};
    });
   },
   close(){if(!closed){closed=true;db.close();}}
  });
 }catch(e){db.close();throw e;}
}
