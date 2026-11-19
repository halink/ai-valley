import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {acquireDeveloperMvpSpiritFixtureOwner,isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import type {World} from '../shared/types.js';
import {validateFormalRainProvenance} from '../world/formal-rain-provenance.js';
import {formalSyntheticWeatherBinding} from './production-model-runtime.js';
import {WorldStore} from './store.js';
import {ownsProductionAccountQuotaRehearsal,type ProductionAccountQuotaRehearsal,type ProductionModelAccountOwnership} from './production-model-account-ownership.js';
import type {SharedModelAccountPolicy} from './shared-model-account.js';
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

const ACCOUNT_SCHEMA='sealed-formal-weather-account-offline-preparation/v1';
const SYNTHETIC_SCHEMA='sealed-formal-weather-account-memory-handoff/v1';
const ACCOUNT_WINDOW=300_000;
const label=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(v);
const accountKeys=['schema','fixtureScope','worldId','episodeId','sourceDigest','sourceEpoch','sourceAuthorizationDigest',
 'accountScope','accountFingerprint','runId','policyDigest','startsAt','expiresAt'] as const;
export interface FormalWeatherAccountPreparationTerms {
 schema:typeof ACCOUNT_SCHEMA|typeof SYNTHETIC_SCHEMA;fixtureScope:string;worldId:string;episodeId:string;sourceDigest:string;sourceEpoch:number;
 sourceAuthorizationDigest:string;accountScope:string;accountFingerprint:string;runId:string;policyDigest:string;
 startsAt:number;expiresAt:number;
}
export function encodeFormalWeatherAccountPreparation(t:unknown):Buffer|null{
 if(!exact(t,accountKeys)||t.schema!==ACCOUNT_SCHEMA&&t.schema!==SYNTHETIC_SCHEMA||!hex(t.fixtureScope)||!world(t.worldId)||!episode(t.episodeId)||
    !hex(t.sourceDigest)||!integer(t.sourceEpoch)||t.sourceEpoch<1||t.sourceEpoch>=CAP||!hex(t.sourceAuthorizationDigest)||
    !label(t.accountScope)||!hex(t.accountFingerprint)||!label(t.runId)||!hex(t.policyDigest)||
    !integer(t.startsAt)||!integer(t.expiresAt)||t.expiresAt<=t.startsAt||t.expiresAt-t.startsAt>ACCOUNT_WINDOW)return null;
 return Buffer.from(JSON.stringify([t.schema===SYNTHETIC_SCHEMA?'formal-closed-rain-account-fixed-fields-memory-only':'formal-closed-rain-account-fixed-fields-offline-prepare-only',...accountKeys.map(k=>t[k])]));
}

/** Borrow a live Formal store lease. No caller connection or facts, no quota
 * mutation or transport. The second signature is per exact source epoch and
 * short-lived, not a durable dispatch grant. Primary revoke invalidates both. */
export function borrowFormalWeatherAccountPreparation(store:WorldStore,owner:DeveloperMvpSpiritFixtureOwner,
 ownership:ProductionModelAccountOwnership,quota:ProductionAccountQuotaRehearsal,policy:SharedModelAccountPolicy,pinnedEpisodeId:string){
 const {terms,packet,close}=openFormalWeatherAccountSnapshot(store,owner,ownership,quota,policy,pinnedEpisodeId,false);
 return Object.freeze({terms,packet,close});
}

const SPENT='valley_spirit_formal_weather_memory_handoff';
const SPENT_DDL=`CREATE TABLE ${SPENT}(singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton=1), fixture_scope TEXT NOT NULL, source_digest TEXT NOT NULL)`;
function spentSource(db:DatabaseSync,fixtureScope:string,sourceDigest:string):boolean{
 const entry=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(SPENT);
 if(!entry)return false;
 if(entry.type!=='table'||entry.sql!==SPENT_DDL||db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(SPENT))
  throw Error('formal_weather_handoff_schema');
 const rows=db.prepare(`SELECT singleton,fixture_scope,source_digest FROM ${SPENT} LIMIT 2`).all();
 if(rows.length!==1||rows[0].singleton!==1||rows[0].fixture_scope!==fixtureScope||rows[0].source_digest!==sourceDigest)
  throw Error('formal_weather_handoff_history');
 return true;
}
const AUDIT='valley_spirit_formal_weather_memory_audit';
const AUDIT_DDL=`CREATE TABLE ${AUDIT}(singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton=1), witness TEXT NOT NULL, witness_digest TEXT NOT NULL)`;
const auditKeys=['schemaVersion','mode','fixtureScope','packet','packetDigest','episodeId','sourceDigest','sourceAuthorizationDigest',
 'dispatchTermsDigest','startsAt','expiresAt','requestId','accountScope','accountRunId','policyDigest','quotaBinding',
 'completedAt','inputTokens','outputTokens'] as const;
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const memoryRequestId=(seal:string,p:FormalMemoryPacket)=>'formal-weather-memory-'+hash(JSON.stringify([
 seal,p.worldId,p.sourceRef,p.startedMinute,p.closedMinute]));
type PairedCompletion=NonNullable<ReturnType<ProductionAccountQuotaRehearsal['proveOfflineAlmanacCompletion']>>;
type FormalAuditStatus='unavailable'|'not-recorded'|'settlement-unproven'|'locally-recorded'|'paired-verified';
function auditRow(db:DatabaseSync){
 const entry=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(AUDIT);
 if(!entry)return null;
 if(entry.type!=='table'||entry.sql!==AUDIT_DDL||
    db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(AUDIT))
  throw Error('formal_weather_audit_schema');
 const rows=db.prepare(`SELECT singleton,CASE WHEN length(CAST(witness AS BLOB))<=4096 THEN witness END AS witness,
  witness_digest FROM ${AUDIT} LIMIT 2`).all(),r=rows[0];
 if(rows.length!==1||r.singleton!==1||typeof r.witness!=='string'||r.witness_digest!==hash(r.witness))
  throw Error('formal_weather_audit_row');
 const v:unknown=JSON.parse(r.witness);
 if(!exact(v,auditKeys)||JSON.stringify(Object.fromEntries(auditKeys.map(k=>[k,v[k]])))!==r.witness)
  throw Error('formal_weather_audit_record');
 return {value:v,digest:r.witness_digest};
}
function openFormalWeatherAccountSnapshot(store:WorldStore,owner:DeveloperMvpSpiritFixtureOwner,
 ownership:ProductionModelAccountOwnership,quota:ProductionAccountQuotaRehearsal,policy:SharedModelAccountPolicy,pinnedEpisodeId:string,synthetic:boolean){
 if(!(store instanceof WorldStore)||!episode(pinnedEpisodeId))throw Error('formal_dual_weather_scope');
 const context=owner?.formalWeatherPurpose;
 if(!context?.accountKeyPem||!context.accountScope||!context.accountFingerprint)throw Error('formal_dual_weather_scope');
 const {worldId,accountScope,accountFingerprint}=context, frozenPolicy=structuredClone(policy);
 const assertCurrent=()=>{
  WorldStore.prototype.assertFormalDualWeatherFixtureOwner.call(store,owner);
  if(!ownsProductionAccountQuotaRehearsal(ownership,quota)||quota.accountScope!==accountScope||
     quota.runId!==ownership.runId||!quota.matchesPolicy(frozenPolicy))throw Error('formal_dual_weather_account');
 };
 assertCurrent();
 const policyDigest=createHash('sha256').update(JSON.stringify([frozenPolicy.accountId,
  ...[frozenPolicy.limit,frozenPolicy.residentFloor,frozenPolicy.almanacCap].flatMap(x=>[x.rpm,x.tpm,x.slots]),
  frozenPolicy.almanacCooldownMs])).digest('hex');
 const fixtureScope=createHash('sha256').update(SCHEMA+'\0'+owner.seal).digest('hex');
 const sourceKey=createPublicKey(context.keyPem),accountKey=createPublicKey(context.accountKeyPem),runId=quota.runId;
 const pin={mode:FORMAL_RAIN_OBJECTIVE_MODE,worldId,episodeId:pinnedEpisodeId};
 const db=new DatabaseSync(owner.database,{readOnly:!synthetic});
 try{db.exec(synthetic?'PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL':'PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');}catch(e){db.close();throw e;}
 let closed=false,isolated=false,seen:Signed[]=[],rev=-1,at=-1,lastNow=-1;
 type Snapshot=ReturnType<typeof readFormalClosedRainObjectiveOnConnection>;
 const read=<T>(f:(projection:NonNullable<Snapshot['projection']>,primary:Signed,now:number,log:readonly Signed[])=>T,write=false):T|null=>{
  if(closed||isolated)return null;
  let begun=false;
  try{
   assertCurrent();db.exec(write?'BEGIN IMMEDIATE':'BEGIN');begun=true;
   const {observedHead,projection}=readFormalClosedRainObjectiveOnConnection(db,owner,pin);
   const log=history(db,sourceKey,fixtureScope,worldId),primary=log.at(-1),now=Date.now();
   if(!integer(now)||now<lastNow||observedHead.revision<rev||observedHead.asOfMinute<at||
      log.length<seen.length||seen.some((x,i)=>JSON.stringify(x)!==JSON.stringify(log[i])))
    throw Error('formal_dual_weather_rewind');
   let output:T|null=null;
   const t=primary?.terms;
   if(projection&&primary&&t?.allow&&t.episodeId===pinnedEpisodeId&&t.sourceDigest===projection.sourceDigest&&
      observedHead.asOfMinute>=t.startsMinute&&observedHead.asOfMinute<t.expiresMinute)output=f(projection,primary,now,log);
   assertCurrent();db.exec('COMMIT');begun=false;
   seen=log;rev=observedHead.revision;at=observedHead.asOfMinute;lastNow=now;return output;
  }catch{
   isolated=true;
   if(begun)try{db.exec('ROLLBACK');}catch{/* isolated */}
   return null;
  }
 };
 const terms=(primary:Signed,startsAt:number,expiresAt:number):FormalWeatherAccountPreparationTerms=>({
  schema:synthetic?SYNTHETIC_SCHEMA:ACCOUNT_SCHEMA,fixtureScope,worldId,episodeId:pinnedEpisodeId,sourceDigest:primary.terms.sourceDigest,
  sourceEpoch:primary.terms.version,sourceAuthorizationDigest:createHash('sha256').update(primary.signature).digest('hex'),
  accountScope,accountFingerprint,runId,policyDigest,startsAt,expiresAt
 });
 let sawSpent=false,pairedAuditDigest:string|undefined;
 const makePacket=(p:NonNullable<Snapshot['projection']>,permissionVersion:number)=>{
  const {sourceRef,startedMinute,closedMinute}=p.source;
  return Object.freeze({schemaVersion:1 as const,projectionVersion:1 as const,permissionVersion,worldId,sourceRef,startedMinute,closedMinute});
 };
 const packet=(input:unknown,mode:'read'|'check'|'consume'|'after-consume'|'audit'='read',
  audit?:Readonly<{proof:PairedCompletion;expectedPacket:FormalMemoryPacket;id:string}>):FormalMemoryPacket|null=>{
   let signed:unknown;try{signed=structuredClone(input);}catch{return null;}
   if(!exact(signed,['terms','signature'])||!exact(signed.terms,accountKeys)||typeof signed.signature!=='string'||
      !/^[A-Za-z0-9_-]{86}$/.test(signed.signature))return null;
   const claimed=signed.terms,sig=Buffer.from(signed.signature,'base64url'),buffer=encodeFormalWeatherAccountPreparation(claimed);
   if(!buffer||sig.length!==64||sig.toString('base64url')!==signed.signature||!verify(null,buffer,accountKey,sig))return null;
   let stagedDigest:string|undefined;
   const result=read((p,primary,now)=>{
    const startsAt=Number(claimed.startsAt),expiresAt=Number(claimed.expiresAt);
    const expected=encodeFormalWeatherAccountPreparation(terms(primary,startsAt,expiresAt));
    if(!expected?.equals(buffer)||now<startsAt||now>=expiresAt||Date.now()>=expiresAt)return null;
    if(mode!=='read'){
     const spent=spentSource(db,fixtureScope,p.sourceDigest);
     if(sawSpent&&!spent)throw Error('formal_weather_handoff_rewind');
     if(spent)sawSpent=true;
     if((mode==='after-consume'||mode==='audit')!==spent)return null;
     if(mode==='consume'){
      db.exec(SPENT_DDL);
      db.prepare(`INSERT INTO ${SPENT} VALUES (1,?,?)`).run(fixtureScope,p.sourceDigest);
     }
    }
    const projected=makePacket(p,primary.terms.version);
    if(mode==='audit'){
     if(!audit||JSON.stringify(projected)!==JSON.stringify(audit.expectedPacket)||
        audit.id!==memoryRequestId(owner.seal,projected)||auditRow(db))return null;
     const proof=audit.proof;
     if(proof.runId!==runId||proof.inputTokens!==Buffer.byteLength(JSON.stringify(projected))+INPUT_OVERHEAD||
        proof.outputTokens!==1||!hex(proof.binding))return null;
     const record=JSON.stringify({schemaVersion:1,mode:'compiled-memory-only',fixtureScope,packet:projected,
      packetDigest:hash(JSON.stringify(projected)),episodeId:pinnedEpisodeId,sourceDigest:p.sourceDigest,
      sourceAuthorizationDigest:terms(primary,startsAt,expiresAt).sourceAuthorizationDigest,dispatchTermsDigest:hash(buffer),
      startsAt,expiresAt,requestId:audit.id,accountScope,accountRunId:proof.runId,policyDigest,quotaBinding:proof.binding,
      completedAt:proof.completedAt,inputTokens:proof.inputTokens,outputTokens:proof.outputTokens});
     db.exec(AUDIT_DDL);
     const digest=hash(record);
     db.prepare(`INSERT INTO ${AUDIT} VALUES (1,?,?)`).run(record,digest);stagedDigest=digest;
    }
    return projected;
   },mode==='consume'||mode==='audit');
   if(result&&stagedDigest)pairedAuditDigest=stagedDigest;
   return result;
 };
 return Object.freeze({
  terms(startsAt:number,expiresAt:number){
   return read((_p,primary,now)=>{
    const t=terms(primary,startsAt,expiresAt);
    return encodeFormalWeatherAccountPreparation(t)&&now>=startsAt&&now<expiresAt?Object.freeze(t):null;
   });
  },
  packet:(input:unknown)=>packet(input),
  check:(input:unknown)=>packet(input,'check'),
  consume(input:unknown){
   const result=packet(input,'consume');if(result)sawSpent=true;return result;
  },
  afterConsume:(input:unknown)=>packet(input,'after-consume'),
  recordAudit(input:unknown,id:string,expectedPacket:FormalMemoryPacket,proof:PairedCompletion){
   return !!packet(input,'audit',{proof,expectedPacket,id});
  },
  auditStatus():FormalAuditStatus{
   return read<FormalAuditStatus>((p,_primary,_now,log)=>{
    const spent=spentSource(db,fixtureScope,p.sourceDigest),row=auditRow(db);
    if(!row)return pairedAuditDigest!==undefined?'unavailable':spent?'settlement-unproven':'not-recorded';
    const r=row.value;
    if(!spent||r.schemaVersion!==1||r.mode!=='compiled-memory-only'||r.fixtureScope!==fixtureScope||
       r.episodeId!==pinnedEpisodeId||r.sourceDigest!==p.sourceDigest||r.accountScope!==accountScope||
       !label(r.accountRunId)||!hex(r.policyDigest)||!hex(r.quotaBinding)||
       !integer(r.startsAt)||!integer(r.expiresAt)||!integer(r.completedAt)||r.completedAt<r.startsAt||
       !exact(r.packet,['schemaVersion','projectionVersion','permissionVersion','worldId','sourceRef','startedMinute','closedMinute'])||
       !integer(r.packet.permissionVersion)||r.packet.permissionVersion===0)return 'unavailable';
    const historical=log[r.packet.permissionVersion-1];
    if(!historical?.terms.allow||historical.terms.sourceDigest!==p.sourceDigest||
       historical.terms.episodeId!==pinnedEpisodeId)return 'unavailable';
    const projected=makePacket(p,historical.terms.version),bytes=JSON.stringify(projected);
    const oldTerms={...terms(historical,r.startsAt,r.expiresAt),runId:r.accountRunId,policyDigest:r.policyDigest};
    const encoded=encodeFormalWeatherAccountPreparation(oldTerms);
    if(!encoded||r.sourceAuthorizationDigest!==oldTerms.sourceAuthorizationDigest||r.dispatchTermsDigest!==hash(encoded)||
       JSON.stringify(r.packet)!==bytes||r.packetDigest!==hash(bytes)||r.requestId!==memoryRequestId(owner.seal,projected)||
       r.inputTokens!==Buffer.byteLength(bytes)+INPUT_OVERHEAD||r.outputTokens!==1)return 'unavailable';
    if(pairedAuditDigest!==undefined){
     if(pairedAuditDigest!==row.digest)return 'unavailable';
     const proof=quota.proveOfflineAlmanacCompletion(String(r.requestId),r.completedAt,Number(r.inputTokens),1);
     return proof?.runId===r.accountRunId&&proof.binding===r.quotaBinding?'paired-verified':'unavailable';
    }
    return 'locally-recorded';
   })??'unavailable';
  },
  close(){if(!closed){closed=true;db.close();}} // Store owns the lease.
 });
}

type FormalMemoryPacket=Readonly<{schemaVersion:1;projectionVersion:1;permissionVersion:number;
 worldId:string;sourceRef:string;startedMinute:number;closedMinute:number}>;
type FormalMemoryOutcome='unavailable'|'proven-unsent'|'source-consumed'|'unresolved'|'settled-audit-unavailable'|'settled-synthetic';
const INPUT_OVERHEAD=256,OUTPUT_BUDGET=64;

/** Disposable, explicitly opened only on the real shared-quota resident
 * bridge. The compiled memory sink records at most one delivery; it has no
 * subscriber, transport parameter, model reply, credentials or network I/O. */
export function openFormalWeatherMemoryHandoff(bridge:unknown,owner:DeveloperMvpSpiritFixtureOwner,pinnedEpisodeId:string){
 const bound=formalSyntheticWeatherBinding(bridge);
 if(!bound||bound.signal.aborted)throw Error('formal_weather_resident_bridge_required');
 const {store,ownership,quota,signal}=bound;
 const snapshot=openFormalWeatherAccountSnapshot(store,owner,ownership,quota,bound.policy(),pinnedEpisodeId,true);
 let closed=false,active=false,uncertain=false,spentHere=false;
 let delivered:FormalMemoryPacket|undefined,resolveMemory:((ok:boolean)=>void)|undefined;
 const close=()=>{if(!closed){
  closed=true;signal.removeEventListener('abort',close);resolveMemory?.(false);snapshot.close();
 }};
 signal.addEventListener('abort',close,{once:true});
 const eligible=()=>{
  if(closed||!bound.running())return false;
  const s=quota.summary(Date.now());
  return !s.waitingResidents&&!s.unknown;
 };
 return Object.freeze({
  terms:snapshot.terms,
  delivery:()=>delivered??null,
  auditStatus:snapshot.auditStatus,
  confirm(){resolveMemory?.(true);},
  lose(){resolveMemory?.(false);},
  async rehearse(input:unknown):Promise<FormalMemoryOutcome>{
   if(uncertain)return 'unresolved';
   if(active)return 'unavailable';
   if(spentHere)return 'source-consumed';
   if(closed)return 'unavailable';
   active=true;
   let stage:'initial'|'reserving'|'held'|'marking'='initial',id='';
   const stopBeforeMark=():FormalMemoryOutcome=>{
    try{
     if(quota.cancelProvenUnsent(id,Date.now()))return spentHere?'source-consumed':'proven-unsent';
    }catch{/* defer to authoritative recovery */}
    uncertain=true;return 'unresolved';
   };
   try{
    const signed=structuredClone(input),packet=snapshot.check(signed);
    if(!packet||!eligible())return 'unavailable';
    const exact=JSON.stringify(packet);
    // The primary digest covers canonical world+episode+observed interval.
    // Do not vary identity with approval epoch, account run or wall time.
    id=memoryRequestId(owner.seal,packet);
    const inputTokens=Buffer.byteLength(exact)+INPUT_OVERHEAD;
    stage='reserving';
    if(quota.reserve({requestId:id,purpose:'valley-spirit-almanac',inputTokens,outputTokens:OUTPUT_BUDGET},Date.now()).status!=='reserved')
     return 'unavailable';
    stage='held';
    await Promise.resolve();
    if(!eligible())return stopBeforeMark();
    const consumed=snapshot.consume(signed);
    if(!consumed)return stopBeforeMark();
    spentHere=true;
    // No yield from final priority/grant check through durable mark and memory
    // delivery. A consumed source is never reissued even if mark fails.
    const rechecked=eligible()?snapshot.afterConsume(signed):null;
    if(!rechecked||JSON.stringify(rechecked)!==exact)return stopBeforeMark();
    stage='marking';
    if(!quota.markHandoff(id,Date.now()))throw Error('formal_memory_handoff_unconfirmed');
    const ok=await new Promise<boolean>(resolve=>{
     resolveMemory=settled=>{resolveMemory=undefined;resolve(settled);};
     delivered=rechecked;
    });
    if(!ok||closed||!bound.running())throw Error('formal_memory_completion_unconfirmed');
    WorldStore.prototype.assertFormalDualWeatherFixtureOwner.call(store,owner);
    const completedAt=Date.now();
    if(!quota.confirmCompletion(id,completedAt,{inputTokens,outputTokens:1}))throw Error('formal_memory_completion_unconfirmed');
    // No transaction spans the two stores. Never reconstruct success from
    // SPENT or a recovery-only quota row if this independent append fails.
    try{
     const proof=quota.proveOfflineAlmanacCompletion(id,completedAt,inputTokens,1);
     if(proof&&snapshot.recordAudit(signed,id,rechecked,proof))return 'settled-synthetic';
    }catch{/* settlement already happened; audit is unavailable */}
    return 'settled-audit-unavailable';
   }catch{
    if(stage==='held')return stopBeforeMark();
    if(stage==='reserving'||stage==='marking'){uncertain=true;return 'unresolved';}
    return 'unavailable';
   }finally{active=false;}
  },
  close
 });
}
