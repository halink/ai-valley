import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import {isProductionAccountQuotaRehearsal,type ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
import type {SharedModelAccountPolicy} from './shared-model-account.js';
import {readNativeValidationWeatherHead} from './valley-spirit-native-basis.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';

const schema='valley-private-disconnected-weather-use/v1';
const purpose='valley-spirit-public-weather-points-v1';
const table='valley_spirit_disconnected_weather_use';
const ddl=`CREATE TABLE ${table}(version INTEGER NOT NULL PRIMARY KEY, signed TEXT NOT NULL)`;
const CAP=128,BYTES=2048,WINDOW=30_000;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const label=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,126}$/.test(v);
const world=(v:unknown):v is string=>typeof v==='string'&&/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

export interface DisconnectedWeatherUseContext {
 schema:typeof schema;purpose:typeof purpose;fixtureScopeId:string;worldId:string;
 accountScope:string;accountFingerprint:string;runId:string;policyDigest:string;
}
export interface DisconnectedWeatherUseTerms extends DisconnectedWeatherUseContext {
 action:'grant'|'revoke';version:number;weatherPermissionVersion:number;startsAt:number;expiresAt:number;
}
const contextKeys=['schema','purpose','fixtureScopeId','worldId','accountScope','accountFingerprint','runId','policyDigest'] as const;
const termKeys=[...contextKeys,'action','version','weatherPermissionVersion','startsAt','expiresAt'] as const;
interface Signed {terms:DisconnectedWeatherUseTerms;signature:string}
export function encodeDisconnectedWeatherUse(v:unknown):Buffer|null {
 try{
  if(!exact(v,termKeys)||v.schema!==schema||v.purpose!==purpose||!hex(v.fixtureScopeId)||!world(v.worldId)||
   !label(v.accountScope)||!hex(v.accountFingerprint)||!label(v.runId)||!hex(v.policyDigest)||
   v.action!=='grant'&&v.action!=='revoke'||!integer(v.version)||v.version<1||
   !integer(v.weatherPermissionVersion)||v.weatherPermissionVersion<1||!integer(v.startsAt)||!integer(v.expiresAt)||
   v.expiresAt<=v.startsAt||v.expiresAt-v.startsAt>WINDOW)return null;
  return Buffer.from(JSON.stringify(['disconnected-developer-only',...termKeys.map(k=>v[k])]),'utf8');
 }catch{return null;}
}
function checked(input:unknown,key:KeyObject,context:DisconnectedWeatherUseContext):Signed|null {
 if(!exact(input,['terms','signature'])||typeof input.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(input.signature))return null;
 const bytes=encodeDisconnectedWeatherUse(input.terms);
 if(!bytes)return null;
 const terms=input.terms as DisconnectedWeatherUseTerms;
 if(contextKeys.some(k=>terms[k]!==context[k]))return null;
 const signature=Buffer.from(input.signature,'base64url');
 if(signature.length!==64||signature.toString('base64url')!==input.signature||!verify(null,bytes,key,signature))return null;
 return {terms:{...context,action:terms.action,version:terms.version,weatherPermissionVersion:terms.weatherPermissionVersion,
  startsAt:terms.startsAt,expiresAt:terms.expiresAt},signature:input.signature};
}
function tableExists(db:DatabaseSync){
 const t=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(table);
 if(!t)return false;
 if(t.type!=='table'||t.sql!==ddl||
    db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(table))
  throw Error('disconnected_weather_grant_schema');
 return true;
}
function nextTransition(previous:Signed|undefined,t:DisconnectedWeatherUseTerms){
 if(t.version!==(previous?.terms.version??0)+1||previous&&t.startsAt<previous.terms.startsAt)return false;
 return t.action==='grant'?(!previous||t.weatherPermissionVersion>=previous.terms.weatherPermissionVersion):
  previous?.terms.action==='grant'&&t.weatherPermissionVersion===previous.terms.weatherPermissionVersion;
}
function load(db:DatabaseSync,key:KeyObject,context:DisconnectedWeatherUseContext){
 if(!tableExists(db))return [];
 const rows=db.prepare(`SELECT version,CASE WHEN length(CAST(signed AS BLOB)) <= ? THEN signed END AS signed FROM ${table} ORDER BY version LIMIT ?`).all(BYTES,CAP+1);
 if(!rows.length||rows.length>CAP)throw Error('disconnected_weather_grant_size');
 const history:Signed[]=[];
 for(const row of rows){
  if(row.version!==history.length+1||typeof row.signed!=='string')throw Error('disconnected_weather_grant_row');
  const s=checked(JSON.parse(row.signed),key,context);
  if(!s||!nextTransition(history.at(-1),s.terms)||JSON.stringify(s)!==row.signed)throw Error('disconnected_weather_grant_history');
  history.push(s);
 }
 return history;
}
const policyHash=(p:SharedModelAccountPolicy)=>digest(JSON.stringify(['disconnected-weather-policy/v1',p.accountId,
 ...[p.limit,p.residentFloor,p.almanacCap].flatMap(x=>[x.rpm,x.tpm,x.slots]),p.almanacCooldownMs]));

/** Uses the existing branded developer fixture owner and canonical disconnected
 * quota handle; neither a documentary object nor this verifier authorizes a
 * production account. No reservation, transport, or provider code here. */
export function openDisconnectedWeatherUseGrant(owner:DeveloperMvpSpiritFixtureOwner,
 quota:ProductionAccountQuotaRehearsal,worldId:string,policy:SharedModelAccountPolicy){
 if(!world(worldId)||!isDeveloperMvpSpiritFixtureOwner(owner)||!owner.weatherUse||!isProductionAccountQuotaRehearsal(quota))
  throw Error('disconnected_weather_grant_scope');
 owner.assertOwned();
 if(owner.rulesWeatherAccountScope!==undefined&&(owner.rulesWeatherAccountScope!==quota.accountScope||owner.rulesSpeechWorldId!==worldId))
  throw Error('disconnected_weather_grant_scope');
 const frozenPolicy=structuredClone(policy);
 if(!quota.matchesPolicy(frozenPolicy)||quota.accountScope!==frozenPolicy.accountId)throw Error('disconnected_weather_grant_policy');
 const key=createPublicKey(owner.weatherUse.keyPem);
 if(key.asymmetricKeyType!=='ed25519')throw Error('disconnected_weather_grant_key');
 const context:Readonly<DisconnectedWeatherUseContext>=Object.freeze({schema,purpose,
  fixtureScopeId:digest('disconnected-weather-fixture/v1\0'+owner.seal),worldId,accountScope:quota.accountScope,
  accountFingerprint:owner.weatherUse.accountFingerprint,runId:quota.runId,policyDigest:policyHash(frozenPolicy)});
 const db=new DatabaseSync(owner.database);
 try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');
  let closed=false,isolated=false,seen:Signed[]=[],lastNow=0;
  const tx=<T>(write:boolean,f:(history:Signed[],now:number)=>{result:T;next?:Signed[]}):T|null=>{
   if(closed||isolated)return null;
   let began=false;
   try{
    const now=Date.now();
    if(!integer(now)||now<lastNow)throw Error('disconnected_weather_clock');
    lastNow=now;
    owner.assertOwned();
    if(!quota.matchesPolicy(frozenPolicy))throw Error('disconnected_weather_quota_changed');
    db.exec(write?'BEGIN IMMEDIATE':'BEGIN');began=true;
    const seal=db.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
    if(seal.length!==1||Object.keys(seal[0]).length!==2||seal[0].version!==1||seal[0].seal!==owner.seal||
       !readNativeValidationWeatherHead(db,worldId))throw Error('disconnected_weather_grant_world');
    const history=load(db,key,context);
    if(history.length<seen.length||seen.some((old,i)=>JSON.stringify(old)!==JSON.stringify(history[i])))
     throw Error('disconnected_weather_grant_rewind');
    const {result,next}=f(history,now);
    owner.assertOwned();
    db.exec('COMMIT');began=false;seen=next??history;
    return result;
   }catch{
    isolated=true;
    if(began)try{db.exec('ROLLBACK');}catch{/* isolated */}
    return null;
   }
  };
  const matchesSource=(t:DisconnectedWeatherUseTerms)=>{
   const weather=readValleySpiritWeatherPermission(db,worldId);
   return weather?.publicWeather&&weather.version===t.weatherPermissionVersion;
  };
  return Object.freeze({
   context,
   /** Persist only detached signed developer grant/revoke transitions. */
   record(input:unknown):boolean {
    let signed:Signed|null;
    try{signed=checked(structuredClone(input),key,context);}catch{return false;}
    if(!signed)return false;
    const s=signed;
    return tx(true,(history,now)=>{
     if(history.length>=CAP||s.terms.action==='grant'&&history.length>=CAP-1||!nextTransition(history.at(-1),s.terms)||now<s.terms.startsAt||now>=s.terms.expiresAt||
      s.terms.action==='grant'&&!matchesSource(s.terms))return {result:false};
     const text=JSON.stringify(s);
     if(Buffer.byteLength(text)>BYTES)return {result:false};
     if(!tableExists(db))db.exec(ddl);
     db.prepare(`INSERT INTO ${table} VALUES (?,?)`).run(s.terms.version,text);
     return {result:true,next:[...history,s]};
    })===true;
   },
   /** Informational current result; callers must re-read immediately before any
    * mock handoff. It is not a bearer token, provider identity, or real grant. */
   active(){
    const current=tx(false,(history,now)=>{
     const t=history.at(-1)?.terms;
     return {result:t?.action==='grant'&&now>=t.startsAt&&now<t.expiresAt&&matchesSource(t)?
       Object.freeze({mode:'disconnected-weather-use' as const,version:t.version,weatherPermissionVersion:t.weatherPermissionVersion,expiresAt:t.expiresAt}):null};
    });
    const observed=Date.now();
    if(observed<lastNow){isolated=true;return null;}
    lastNow=observed;
    return current&&observed<current.expiresAt?current:null;
   },
   close(){if(!closed){closed=true;db.close();}}
  });
 }catch(e){db.close();throw e;}
}
