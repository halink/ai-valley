import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acquireDeveloperMvpSpiritFixtureOwner,isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import type {World} from '../shared/types.js';
import {validateFormalRainProvenance} from '../world/formal-rain-provenance.js';
import {decodeSavedWorld} from './save-preflight.js';

const SCHEMA='sealed-formal-weather-offline-preparation/v1';
const TABLE='valley_spirit_formal_weather_preparation';
const DDL=`CREATE TABLE ${TABLE}(epoch INTEGER NOT NULL PRIMARY KEY, signed TEXT NOT NULL)`;
const CAP=64,DAY=1440;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const world=(v:unknown):v is string=>typeof v==='string'&&/^valley-formal-[A-Za-z0-9_-]{1,180}$/.test(v);
const episode=(v:unknown):v is string=>typeof v==='string'&&/^formal-rain:[a-f0-9]{64}$/.test(v);
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(v:unknown,k:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const keys=['schema','fixtureScope','worldId','episodeId','sourceDigest','priorVersion','version','allow','startsMinute','expiresMinute'] as const;
export interface FormalWeatherPreparationTerms {
 schema:typeof SCHEMA;fixtureScope:string;worldId:string;episodeId:string;sourceDigest:string;
 priorVersion:number;version:number;allow:boolean;startsMinute:number;expiresMinute:number;
}
interface Signed {terms:FormalWeatherPreparationTerms;signature:string;}
export function encodeFormalWeatherPreparation(t:unknown):Buffer|null{
 if(!exact(t,keys)||t.schema!==SCHEMA||!hex(t.fixtureScope)||!world(t.worldId)||!episode(t.episodeId)||!hex(t.sourceDigest)||
    !integer(t.priorVersion)||!integer(t.version)||t.version!==t.priorVersion+1||t.version>CAP||typeof t.allow!=='boolean'||
    !minute(t.startsMinute)||!minute(t.expiresMinute)||t.expiresMinute<=t.startsMinute||t.expiresMinute-t.startsMinute>DAY)return null;
 return Buffer.from(JSON.stringify(['formal-closed-rain-fixed-fields-offline-only',...keys.map(k=>t[k])]));
}
function validate(u:unknown,key:KeyObject,scope:string,worldId:string):Signed|null{
 if(!exact(u,['terms','signature'])||typeof u.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(u.signature))return null;
 const body=encodeFormalWeatherPreparation(u.terms);
 if(!body||!exact(u.terms,keys)||u.terms.fixtureScope!==scope||u.terms.worldId!==worldId)return null;
 const sig=Buffer.from(u.signature,'base64url');
 if(sig.length!==64||sig.toString('base64url')!==u.signature||!verify(null,body,key,sig))return null;
 return {terms:Object.fromEntries(keys.map(x=>[x,(u.terms as Record<string,unknown>)[x]])) as unknown as FormalWeatherPreparationTerms,signature:u.signature};
}
function exists(db:DatabaseSync){
 const e=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(TABLE);
 if(!e)return false;
 if(e.type!=='table'||e.sql!==DDL||db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
  throw Error('formal_weather_preparation_schema');
 return true;
}
function next(prior:Signed|undefined,t:FormalWeatherPreparationTerms){
 if(t.priorVersion!==(prior?.terms.version??0)||prior&&t.startsMinute<prior.terms.startsMinute)return false;
 if(prior&&(t.episodeId!==prior.terms.episodeId||t.sourceDigest!==prior.terms.sourceDigest))return false;
 return t.allow?t.version<CAP:prior?.terms.allow===true;
}
function history(db:DatabaseSync,key:KeyObject,scope:string,worldId:string){
 if(!exists(db))return [];
 const rows=db.prepare(`SELECT epoch,CASE WHEN length(CAST(signed AS BLOB))<=4096 THEN signed END AS signed FROM ${TABLE} ORDER BY epoch LIMIT ?`).all(CAP+1);
 if(!rows.length||rows.length>CAP)throw Error('formal_weather_preparation_capacity');
 const log:Signed[]=[];
 for(const r of rows){
  if(typeof r.signed!=='string'||r.epoch!==log.length+1)throw Error('formal_weather_preparation_row');
  const grant=validate(JSON.parse(r.signed),key,scope,worldId);
  if(!grant||!next(log.at(-1),grant.terms)||JSON.stringify(grant)!==r.signed)throw Error('formal_weather_preparation_history');
  log.push(grant);
 }
 return log;
}

/** Explicit independent permission for one original sealed Formal source.
 * This neither reserves quota nor attaches to a dispatcher or publisher. */
export function openFormalWeatherPreparation(fixture:DeveloperMvpSpiritFixtureKey,pinnedEpisodeId:string){
 if(!episode(pinnedEpisodeId))throw Error('formal_weather_preparation_pin');
 const owner=acquireDeveloperMvpSpiritFixtureOwner(fixture);
 let db:DatabaseSync|undefined;
 try{
  const auth=owner.formalWeatherPurpose;
  if(!auth||owner.formalApprovalKeyPem||owner.formalShadowKeyPem)throw Error('formal_weather_preparation_key_not_pinned');
  const worldId=auth.worldId,key=createPublicKey(auth.keyPem);
  if(key.asymmetricKeyType!=='ed25519')throw Error('formal_weather_preparation_key');
  const scope=createHash('sha256').update(SCHEMA+'\0'+owner.seal).digest('hex');
  const pin={mode:FORMAL_RAIN_OBJECTIVE_MODE,worldId,episodeId:pinnedEpisodeId};
  const sqlite=db=new DatabaseSync(owner.database);
  sqlite.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
  let closed=false,isolated=false,seen:Signed[]=[],rev=-1,at=-1;
  type Snapshot=ReturnType<typeof readFormalClosedRainObjectiveOnConnection>;
  const tx=<T>(write:boolean,f:(s:Snapshot,log:Signed[])=>{result:T;staged?:Signed[]}):T|null=>{
   if(closed||isolated)return null;let began=false;
   try{
    owner.assertOwned();sqlite.exec(write?'BEGIN IMMEDIATE':'BEGIN');began=true;
    const snap=readFormalClosedRainObjectiveOnConnection(sqlite,owner,pin),log=history(sqlite,key,scope,worldId);
    if(snap.observedHead.revision<rev||snap.observedHead.asOfMinute<at||
       log.length<seen.length||seen.some((x,i)=>JSON.stringify(x)!==JSON.stringify(log[i])))
     throw Error('formal_weather_preparation_rewind');
    const {result,staged}=f(snap,log);
    owner.assertOwned();sqlite.exec('COMMIT');began=false;
    seen=staged??log;rev=snap.observedHead.revision;at=snap.observedHead.asOfMinute;return result;
   }catch{
    isolated=true;
    if(began)try{sqlite.exec('ROLLBACK');}catch{/* isolated */}
    return null;
   }
  };
  return Object.freeze({
   terms(allow:boolean,startsMinute:number,expiresMinute:number){
    return tx(false,(s,log)=>{
     const last=log.at(-1)?.terms;
     const digest=s.projection?.sourceDigest??(!allow&&last?.episodeId===pinnedEpisodeId?last.sourceDigest:undefined);
     if(!digest||last&&last.episodeId!==pinnedEpisodeId)return {result:null};
     const t:FormalWeatherPreparationTerms={schema:SCHEMA,fixtureScope:scope,worldId,episodeId:pinnedEpisodeId,sourceDigest:digest,
      priorVersion:log.length,version:log.length+1,allow,startsMinute,expiresMinute};
     return {result:encodeFormalWeatherPreparation(t)&&next(log.at(-1),t)?Object.freeze(t):null};
    });
   },
   record(input:unknown):boolean{
    let signed:Signed|null;try{signed=validate(structuredClone(input),key,scope,worldId);}catch{return false;}
    if(!signed)return false;
    const accepted=signed,t=accepted.terms;
    return tx(true,(s,log)=>{
     if(t.episodeId!==pinnedEpisodeId||!next(log.at(-1),t)||s.observedHead.asOfMinute<t.startsMinute||
        s.observedHead.asOfMinute>=t.expiresMinute||t.allow&&s.projection?.sourceDigest!==t.sourceDigest)return {result:false};
     if(!exists(sqlite))sqlite.exec(DDL);
     sqlite.prepare(`INSERT INTO ${TABLE} VALUES (?,?)`).run(t.version,JSON.stringify(accepted));
     return {result:true,staged:[...log,accepted]};
    })===true;
   },
   packet(){
    return tx(false,(s,log)=>{
     const t=log.at(-1)?.terms,p=s.projection;
     if(!p||!t?.allow||t.episodeId!==pinnedEpisodeId||t.sourceDigest!==p.sourceDigest||
        s.observedHead.asOfMinute<t.startsMinute||s.observedHead.asOfMinute>=t.expiresMinute)return {result:null};
     const {sourceRef,startedMinute,closedMinute}=p.source;
     return {result:Object.freeze({schemaVersion:1 as const,projectionVersion:1 as const,permissionVersion:t.version,
      worldId,sourceRef,startedMinute,closedMinute})};
    });
   },
   close(){if(!closed){closed=true;try{sqlite.close();}finally{owner.release();}}}
  });
 }catch(e){try{db?.close();}finally{owner.release();}throw e;}
}

export const FORMAL_RAIN_OBJECTIVE_MODE='sealed-formal-closed-rain-objective' as const;
const MODE=FORMAL_RAIN_OBJECTIVE_MODE;
const projectionExact=(u:unknown,keys:readonly string[]):u is Record<string,unknown>=>!!u&&typeof u==='object'&&!Array.isArray(u)&&
 Object.keys(u).length===keys.length&&keys.every(k=>Object.hasOwn(u,k));
const worldId=(u:unknown):u is string=>typeof u==='string'&&/^valley-formal-[A-Za-z0-9_-]{1,180}$/.test(u);
const episodeId=(u:unknown):u is string=>typeof u==='string'&&/^formal-rain:[a-f0-9]{64}$/.test(u);
const revision=(u:unknown):u is number=>typeof u==='number'&&Number.isSafeInteger(u)&&u>=0;
const projectionMinute=(u:unknown):u is number=>typeof u==='number'&&Number.isFinite(u)&&u>=0&&u<=1e9;
const disabled=Object.freeze({status:'disabled' as const});
const unavailable=Object.freeze({status:'unavailable' as const});
const missing=Object.freeze({status:'missing' as const,reason:'no-retained-native-closed-rain' as const});
export interface FormalClosedRainObjectivePin {mode:typeof MODE;worldId:string;episodeId:string;}

/** Private read used only on connections opened against the branded owner’s
 * path below. Keep head and retained source under the same SQLite snapshot. */
function readFormalClosedRainObjectiveOnConnection(db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,pin:Readonly<FormalClosedRainObjectivePin>){
 if(!isDeveloperMvpSpiritFixtureOwner(owner)||!owner.formalApprovalKeyPem&&!owner.formalWeatherPurpose||
    !projectionExact(pin,['mode','worldId','episodeId'])||pin.mode!==MODE||!worldId(pin.worldId)||!episodeId(pin.episodeId)||
    owner.formalWeatherPurpose!==undefined&&owner.formalWeatherPurpose.worldId!==pin.worldId)
  throw Error('formal_closed_rain_owner_scope');
 owner.assertOwned();
 const tables=db.prepare("SELECT name,type FROM sqlite_schema WHERE name IN ('worlds','mvp_spirit_developer_fixture')").all();
 if(tables.length!==2||tables.some(x=>x.type!=='table'))throw Error('formal_closed_rain_schema');
 const seal=db.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
 if(seal.length!==1||Object.keys(seal[0]).length!==2||seal[0].version!==1||seal[0].seal!==owner.seal)
  throw Error('formal_closed_rain_seal');
 const rows=db.prepare('SELECT id,revision,state FROM worlds LIMIT 2').all();
 if(rows.length!==1||rows[0].id!==pin.worldId||!revision(rows[0].revision))throw Error('formal_closed_rain_world');
 // Formal compact saves retain these fields in the same encoded row.
 const head=decodeSavedWorld(rows[0].state) as unknown as World;
 if(head.mode!=='formal'||head.id!==pin.worldId||head.revision!==rows[0].revision||!projectionMinute(head.minute)||
    Object.hasOwn(head,'simulationOnly')||Object.hasOwn(head,'mvpClimate'))throw Error('formal_closed_rain_head');
 validateFormalRainProvenance(head);
 const observedHead=Object.freeze({revision:head.revision,asOfMinute:head.minute});
 const found=head.formalRainProvenance?.closed.find(r=>r.episodeId===pin.episodeId);
 if(!found)return {observedHead,projection:null};
 const sourceRef=head.id+'/'+found.episodeId;
 const source=Object.freeze({kind:'observed-closed-rain' as const,sourceRef,startedMinute:found.startedMinute,closedMinute:found.closedMinute});
 const sourceDigest=createHash('sha256').update(JSON.stringify(['formal-closed-rain-objective/v1',sourceRef,found.startedMinute,found.closedMinute])).digest('hex');
 return {observedHead,projection:Object.freeze({status:'ready' as const,mode:MODE,projectionVersion:1 as const,worldId:head.id,
  observedHead,source,sourceDigest})};
}

/** Explicit private evidence read only. No disclosure grant, route, writer,
 * transport or forecast. The original existing developer lease is required. */
export function readFormalClosedRainObjective(owner:DeveloperMvpSpiritFixtureOwner|undefined,input?:Readonly<FormalClosedRainObjectivePin>){
 if(input===undefined)return disabled;
 let db:DatabaseSync|undefined,began=false;
 try{
  if(!isDeveloperMvpSpiritFixtureOwner(owner)||!owner)return unavailable;
  owner.assertOwned();
  db=new DatabaseSync(owner.database,{readOnly:true});
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN');began=true;
  const {projection}=readFormalClosedRainObjectiveOnConnection(db,owner,structuredClone(input));
  owner.assertOwned();db.exec('COMMIT');began=false;
  return projection??missing;
 }catch{
  if(began)try{db?.exec('ROLLBACK');}catch{/* read-only connection closes */}
  return unavailable;
 }finally{db?.close();}
}
