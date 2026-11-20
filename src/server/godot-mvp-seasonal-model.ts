import {claimSeasonalHeldWeatherMemory,prepareSeasonalHeldWeatherBody,parseSeasonalHeldWeatherCompletion,SEASONAL_HELD_WEATHER_OUTPUT_TOKENS,type SeasonalHeldWeatherTransport} from './valley-spirit-seasonal-weather-http-held.js';
import {claimSeasonalAlmanacFixture,openSeasonalAlmanacFixture,type SeasonalAlmanacFixture} from './seasonal-almanac-runtime.js';
import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {nativeWeatherHourTransition} from './valley-spirit-weather-credit.js';
import {publicWeatherEntryId,publicWeatherProjection,validPublicWeatherFact,type PublicWeatherFact} from './valley-spirit.js';
import {lstatSync} from 'node:fs';
import {claimSeasonalResidentQuota} from './production-model-runtime-ownership.js';
import {OfflineResidentAccountAdmission,type CanonicalSeasonalQuota,type ResidentAccountRound} from './shared-resident-admission.js';
import {createServer} from 'node:http';
import type {ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {decodeSavedWorld,preflightWorldSave} from './save-preflight.js';
import {WorldStore} from './store.js';
import {assertMvpWorld} from './godot-mvp-persistent.js';
import {createMvpSession,createMvpWorld,mvpPhase} from './godot-mvp.js';
import {validateMvpClimate} from '../world/mvp-climate-state.js';
import {validateMvpPreservation} from '../world/mvp-preservation.js';
import {validateSeasonalKnowledge} from '../world/mvp-seasonal-knowledge.js';
import {MODEL_CONTEXT_VERSION,MODEL_MENU_VERSION,seasonalModelContext} from './seasonal-model-context.js';
import {DecisionError,prepareModelDecision,parseModelCompletion} from './decisions.js';
import {ModelBudget} from './model-budget.js';
import {modelRequestPayload,modelLimits,type ModelReply} from './model-completion.js';
import {finishSeasonalCharge,modelDigest,readSeasonalLedger,seasonalModelPolicy as policy,type SeasonalLedger,type SeasonalRequest} from './seasonal-model-ledger.js';
import {planStartError,stepWorld,submitPlan} from '../world/engine.js';
import {claimSeasonalWeatherMemoryTransport,groundSeasonalWeatherWireReply,seasonalWeatherWireRequest,groundSeasonalWeatherTopicChoice,seasonalWeatherTopicChoiceRequest,
 SEASONAL_WEATHER_WIRE_REPLY_BYTES,validSeasonalWeatherWireDraft,type SeasonalWeatherMemoryTransport} from './valley-spirit-seasonal-weather-wire.js';
import {createValleySpiritAlmanacPacket,renderOneSeasonalWeatherReview,type ValleySpiritAlmanacPacket,type ValleySpiritAlmanacWeatherSource} from './valley-spirit-almanac.js';
import {nativeSeasonalWeatherPairMenu} from './valley-spirit-topics.js';
import type {Resident,World} from '../shared/types.js';

type MemoryRequest=Readonly<{id:string;actorId:string;payload:string}>;
type Entry={request:MemoryRequest;resolve:(reply:ModelReply)=>void;reject:()=>void};
type MemoryTransport=Readonly<{kind:'seasonal-memory'}>;
const transports=new WeakMap<MemoryTransport,{claimed:boolean;invoke:(request:MemoryRequest,signal:AbortSignal)=>Promise<ModelReply>}>();
/** Data-only synthetic transport; no callback, URL, environment or live key. */
export function createSeasonalMemoryTransport(){
 const calls:Entry[]=[],transport=Object.freeze({kind:'seasonal-memory'} as const);
 transports.set(transport,{claimed:false,invoke:(request,signal)=>new Promise((resolve,reject)=>{
  const cancel=()=>reject(Error('synthetic_transport_unknown'));
  signal.addEventListener('abort',cancel,{once:true});
  calls.push({request,resolve:reply=>{signal.removeEventListener('abort',cancel);resolve(reply);},reject:()=>{signal.removeEventListener('abort',cancel);cancel();}});
 })});
 return {transport,requests:()=>calls.map(c=>c.request),
  reply:(i:number,value:ModelReply)=>calls[i].resolve(structuredClone(value)),reject:(i:number)=>calls[i].reject()};
}
export function startLiveSeasonalModel():never {
 // Prior live request outcome and billing remain unverified. Neither an
 // environment switch nor possession of a key can create this capability.
 throw Error('seasonal_model_live_blocked_previous_request_and_billing_unverified');
}
function modelWorld(w:World){
 if(w.schemaVersion===3)throw Error('seasonal_model_shelter_save_unsupported');
 assertMvpWorld(w);validateMvpClimate(w);validateMvpPreservation(w);validateSeasonalKnowledge(w);
 if(w.mvpClimate?.schemaVersion!==3||!w.mvpSoil||!w.mvpAgriculture||!w.mvpPreservation||w.simulationOnly)throw Error('seasonal_model_world_dependencies');
 const m=w.metrics;
 if(m.configured!==false||m.inFlight.length||[m.requests,m.successes,m.failures,m.inputTokens,m.outputTokens].some(n=>n!==0)||
  m.lastAttemptModel!==undefined||m.admissionCancellation!==undefined||m.routing!==undefined||Object.keys(m.usageWindow??{}).length||Object.keys(m.selfHostedCooldowns??{}).length||m.unmeteredFailures)
  throw Error('seasonal_model_legacy_provider_history');
}
const wall=()=>{const value=Date.now();if(!Number.isSafeInteger(value)||value<0)throw Error('seasonal_model_wall_clock');return value;};
function validateSyntheticReply(reply:ModelReply){
 const counts=[reply?.usage?.prompt_tokens,reply?.usage?.completion_tokens] as const;
 if(counts.some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0)))throw Error('seasonal_model_reply_usage');
 if(typeof reply?.content!=='string'||Buffer.byteLength(reply.content)>32_000||reply.finish!==null&&typeof reply.finish!=='string')throw Error('seasonal_model_reply_shape');
 return counts;
}
const ready=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&!r.plan&&!r.activity&&r.decisionDue<=w.minute;
const WEATHER_PURPOSE='private-seasonal-weather-use/v1';
const SECOND_WEATHER_PURPOSE='private-seasonal-weather-topic-second-use/v1';
const PUBLIC_SOURCE_PURPOSE='seasonal-objective-public-weather-source/v1';
const PUBLIC_SOURCE_MODE='explicit-seasonal-public-weather-source' as const;
const PUBLIC_SOURCE_TABLE='seasonal_public_weather_source';
const TOPIC_MODE='explicit-private-seasonal-weather-topics/v1' as const;
const SECOND_WEATHER_TABLE='seasonal_private_weather_topic_second';
const WEATHER_LIMIT=32,WEATHER_WALL_WINDOW=300_000,WEATHER_JSON_LIMIT=32_768;
const WEATHER_TABLE='seasonal_private_weather_use';
const WEATHER_SQL=`CREATE TABLE ${WEATHER_TABLE}(singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL)`;
const weatherDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(v:unknown,ks:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const finiteInteger=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const hour=(v:unknown):v is number=>finiteInteger(v)&&v>0&&v<=1e9&&v%60===0;
type SeasonalPublicWeatherSourcePin=Readonly<{mode:typeof PUBLIC_SOURCE_MODE;hourMinute:number;reviewerPublicKeyPem:string}>;
type SeasonalPrivateWeatherPin=Readonly<{mode:'explicit-private-seasonal-weather-use';hourMinute:number;reviewerPublicKeyPem:string}>;
function pinSeasonalWeather(v:unknown,mode:'explicit-private-seasonal-weather-use'|typeof PUBLIC_SOURCE_MODE='explicit-private-seasonal-weather-use'){
 if(!exact(v,['mode','hourMinute','reviewerPublicKeyPem'])||v.mode!==mode||!hour(v.hourMinute)||
    typeof v.reviewerPublicKeyPem!=='string'||v.reviewerPublicKeyPem.length>256||
    !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(v.reviewerPublicKeyPem))
  throw Error('seasonal_private_weather_pin');
 const signer=createPublicKey(v.reviewerPublicKeyPem);
 if(signer.asymmetricKeyType!=='ed25519')throw Error('seasonal_private_weather_pin');
 const fingerprint=createHash('sha256').update(signer.export({type:'spki',format:'der'})).digest('hex');
 return Object.freeze({signer,fingerprint,hourMinute:v.hourMinute});
}
const permitKeys=['schema','binding','worldId','hourMinute','sourceDigest','priorVersion','version','allow','startsAt','expiresAt'] as const;
export interface SeasonalPrivateWeatherTerms {
 schema:typeof WEATHER_PURPOSE|typeof SECOND_WEATHER_PURPOSE;binding:string;worldId:string;hourMinute:number;sourceDigest:string;
 priorVersion:number;version:number;allow:boolean;startsAt:number;expiresAt:number;
}
function nativeWeatherPairCurrent(first:SeasonalPrivateWeatherTerms,second:SeasonalPrivateWeatherTerms,observedAt:number){
 const now=wall();
 return first.schema===WEATHER_PURPOSE&&second.schema===SECOND_WEATHER_PURPOSE&&first.binding===second.binding&&
  first.worldId===second.worldId&&first.hourMinute+60===second.hourMinute&&first.allow&&second.allow&&
  now>=Math.max(observedAt,first.startsAt,second.startsAt)&&now<Math.min(first.expiresAt,second.expiresAt);
}
export type SeasonalPublicWeatherSourceTerms=Omit<SeasonalPrivateWeatherTerms,'schema'>&{schema:typeof PUBLIC_SOURCE_PURPOSE};
type WeatherTerms=SeasonalPrivateWeatherTerms|SeasonalPublicWeatherSourceTerms;
type SignedPermit={terms:WeatherTerms;signature:string};
function encodeWeatherTerms(v:unknown,publicPurpose:boolean):Buffer|null{
 if(!exact(v,permitKeys)||(publicPurpose?v.schema!==PUBLIC_SOURCE_PURPOSE:
    v.schema!==WEATHER_PURPOSE&&v.schema!==SECOND_WEATHER_PURPOSE)||!hex(v.binding)||
    typeof v.worldId!=='string'||!/^godot-mvp-[a-f0-9-]{36}$/.test(v.worldId)||!hour(v.hourMinute)||!hex(v.sourceDigest)||
    !finiteInteger(v.priorVersion)||!finiteInteger(v.version)||v.version!==v.priorVersion+1||v.version>WEATHER_LIMIT||
    typeof v.allow!=='boolean'||!finiteInteger(v.startsAt)||!finiteInteger(v.expiresAt)||
    v.expiresAt<=v.startsAt||v.expiresAt-v.startsAt>WEATHER_WALL_WINDOW)return null;
 return Buffer.from(JSON.stringify([v.schema===PUBLIC_SOURCE_PURPOSE?'seasonal-objective-public-source-no-edition':
  v.schema===WEATHER_PURPOSE?'offline-seasonal-native-hour-prepare-only':'offline-seasonal-second-native-hour-topic-prepare-only',
  ...permitKeys.map(k=>v[k])]));
}
export function encodeSeasonalPrivateWeatherTerms(v:unknown):Buffer|null{return encodeWeatherTerms(v,false);}
function encodeSeasonalPublicWeatherSourceTerms(v:unknown):Buffer|null{return encodeWeatherTerms(v,true);}
/** Module-private: only the genuine seasonal postcommit hook can capture.
 * This annex is deliberately not the authoritative world transaction. */
function openSeasonalWeatherCustody(owner:RuntimeOwnership,worldId:string,binding:string,pin:ReturnType<typeof pinSeasonalWeather>,quota:ProductionAccountQuotaRehearsal,
 assertCanonical:()=>void,current:()=>Pick<World,'id'|'revision'|'minute'>,slot:'private-first'|'private-second'|'public-source'='private-first'){
 const second=slot==='private-second',publicSource=slot==='public-source';
 const tableName=second?SECOND_WEATHER_TABLE:publicSource?PUBLIC_SOURCE_TABLE:WEATHER_TABLE;
 const ddl=WEATHER_SQL.replace(WEATHER_TABLE,tableName);
 const purpose=second?SECOND_WEATHER_PURPOSE:publicSource?PUBLIC_SOURCE_PURPOSE:WEATHER_PURPOSE;
 const registry=second?quota.seasonalPrivateWeatherTopicSecondAnchor:publicSource?quota.seasonalPublicWeatherSourceAnchor:quota.seasonalPrivateWeatherAnchor;
 const db=new DatabaseSync(owner.database);
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');}catch(e){db.close();throw e;}
 let isolated=false,closed=false,seen:WeatherState|null=null,lastWall=-1;
 type WeatherState={schemaVersion:1;binding:string;fact:PublicWeatherFact;history:SignedPermit[]};
 const sourceDigest=(fact:PublicWeatherFact)=>weatherDigest([purpose,binding,fact]);
 const checked=(u:unknown):SignedPermit|null=>{
  if(!exact(u,['terms','signature'])||typeof u.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(u.signature)||
     !exact(u.terms,permitKeys))return null;
  const body=encodeWeatherTerms(u.terms,publicSource),sig=Buffer.from(u.signature,'base64url');
  if(!body||sig.length!==64||sig.toString('base64url')!==u.signature||!verify(null,body,pin.signer,sig))return null;
  return {terms:Object.fromEntries(permitKeys.map(k=>[k,(u.terms as Record<string,unknown>)[k]])) as unknown as WeatherTerms,signature:u.signature};
 };
 const next=(s:WeatherState,t:WeatherTerms)=>{
  const prior=s.history.at(-1)?.terms;
  return t.schema===purpose&&t.binding===binding&&t.worldId===worldId&&t.hourMinute===pin.hourMinute&&t.sourceDigest===sourceDigest(s.fact)&&
   t.priorVersion===s.history.length&&(!prior||t.startsAt>=prior.startsAt)&&
   (t.allow?t.version<WEATHER_LIMIT:prior?.allow===true);
 };
 const readState=(head:PublicWeatherFact):WeatherState|null=>{
  if(db.prepare('SELECT 1 FROM sqlite_temp_schema WHERE lower(name)=? OR lower(tbl_name)=?').get(tableName,tableName))
   throw Error('seasonal_private_weather_temp_schema');
  const table=db.prepare("SELECT type,sql FROM main.sqlite_schema WHERE name=? COLLATE NOCASE").get(tableName);
  if(!table){if(seen)throw Error('seasonal_private_weather_rewind');return null;}
  if(table.type!=='table'||table.sql!==ddl||
     db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(tableName))
   throw Error('seasonal_private_weather_schema');
  const rows=db.prepare(`SELECT singleton,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM main.${tableName} LIMIT 2`).all(WEATHER_JSON_LIMIT);
  if(rows.length!==1||rows[0].singleton!==1||typeof rows[0].body!=='string')throw Error('seasonal_private_weather_row');
  const u:unknown=JSON.parse(rows[0].body);
  if(!exact(u,['schemaVersion','binding','fact','history'])||u.schemaVersion!==1||u.binding!==binding||!validPublicWeatherFact(u.fact)||
     u.fact.worldId!==worldId||u.fact.minute!==pin.hourMinute||u.fact.minute>head.minute||u.fact.worldRevision>head.worldRevision||
     u.fact.worldRevision===head.worldRevision&&weatherDigest(u.fact)!==weatherDigest(head)||
     !Array.isArray(u.history)||u.history.length>WEATHER_LIMIT)throw Error('seasonal_private_weather_state');
  const rebuilt:WeatherState={schemaVersion:1,binding,fact:u.fact,history:[]};
  for(const row of u.history){
   const s=checked(row);if(!s||!next(rebuilt,s.terms))throw Error('seasonal_private_weather_history');
   rebuilt.history.push(s);
  }
  if(JSON.stringify(rebuilt)!==rows[0].body||seen&&(sourceDigest(seen.fact)!==sourceDigest(rebuilt.fact)||
     seen.history.length>rebuilt.history.length||seen.history.some((s,i)=>JSON.stringify(s)!==JSON.stringify(rebuilt.history[i]))))
   throw Error('seasonal_private_weather_rewind');
  return rebuilt;
 };
 const operate=<T>(write:boolean,fn:(head:PublicWeatherFact,state:WeatherState|null,now:number)=>{result:T;next?:WeatherState}):T|null=>{
  if(isolated||closed)return null;
  let begun=false;
  try{
   assertCanonical();db.exec(write?'BEGIN IMMEDIATE':'BEGIN');begun=true;
   const rows=db.prepare('SELECT id,revision,state FROM worlds LIMIT 2').all();
   if(rows.length!==1||rows[0].id!==worldId)throw Error('seasonal_private_weather_head');
   const w=decodeSavedWorld(rows[0].state) as unknown as World,head=publicWeatherProjection(w),actual=current();
   if(!head||head.worldId!==worldId||head.worldRevision!==rows[0].revision||w.mvpSeasonalModelVersion!==1||
      actual.id!==head.worldId||actual.revision!==head.worldRevision||actual.minute!==head.minute)
    throw Error('seasonal_private_weather_head');
   const ledger=readSeasonalLedger(db,w,true);
   if(ledger?.schemaVersion!==2||ledger.sharedAccountBinding!==binding)throw Error('seasonal_private_weather_binding');
   const now=wall(),s=readState(head),anchor=registry(binding);
   if(now<lastWall||anchor&&now<anchor.wallFloor)throw Error('seasonal_private_weather_clock_rewind');
   if(s?(!anchor||anchor.sourceDigest!==sourceDigest(s.fact)||anchor.stateDigest!==weatherDigest(s)||
      anchor.version!==s.history.length):anchor!==null)throw Error('seasonal_private_weather_cross_store_gap');
   const {result,next}=fn(head,s,now),latest=next??s;
   if(publicSource&&next&&weatherDigest(readState(head))!==weatherDigest(next))
    throw Error('seasonal_public_weather_source_readback');
   assertCanonical();
   // Durably anchor the exact state and time before returning any observation
   // or permit. A failure before the world-annex COMMIT cannot be repaired by
   // re-importing older evidence: the two states must match or isolate.
   if(latest&&(next||!anchor||anchor.wallFloor!==now)){
    const successor={sourceDigest:sourceDigest(latest.fact),stateDigest:weatherDigest(latest),
     version:latest.history.length,wallFloor:now};
    const written=registry(binding,{previous:anchor,next:successor});
    if(JSON.stringify(written)!==JSON.stringify(successor))throw Error('seasonal_private_weather_anchor_write');
   }
   assertCanonical();db.exec('COMMIT');begun=false;seen=latest;lastWall=now;return result;
  }catch{
   isolated=true;if(begun)try{db.exec('ROLLBACK');}catch{/* isolate optional annex */}
   return null;
  }
 };
 const authorized=()=>operate(false,(head,s,now)=>{
  const t=s?.history.at(-1)?.terms;
  if(!s||!t?.allow||now<t.startsAt||now>=t.expiresAt)return {result:null};
  return {result:{terms:t,fact:s.fact,observedAt:now,head}};
 });
 return {
  capture(beforeMinute:number,committed:World){
   if(committed.minute!==pin.hourMinute||!nativeWeatherHourTransition(beforeMinute,committed.minute))return;
   operate(true,(head,state)=>{
    const f=publicWeatherProjection(committed);
    if(state||!f||head.worldRevision!==f.worldRevision||weatherDigest(head)!==weatherDigest(f))return {result:false};
    const s:WeatherState={schemaVersion:1,binding,fact:head,history:[]};
    db.exec(ddl);
    db.prepare(`INSERT INTO main.${tableName} VALUES (1,?)`).run(JSON.stringify(s));
    return {result:true,next:s};
   });
  },
  terms(allow:boolean,startsAt:number,expiresAt:number){
   return operate(false,(_h,s,now)=>{
    if(!s||now<startsAt||now>=expiresAt)return {result:null};
    const t:WeatherTerms={schema:purpose,binding,worldId,hourMinute:pin.hourMinute,
     sourceDigest:sourceDigest(s.fact),priorVersion:s.history.length,version:s.history.length+1,allow,startsAt,expiresAt};
    return {result:encodeWeatherTerms(t,publicSource)&&next(s,t)?Object.freeze(t):null};
   });
  },
  record(input:unknown):boolean{
   let signed:SignedPermit|null;
   try{signed=checked(structuredClone(input));}catch{return false;}
   if(!signed)return false;
   const accepted=signed,t=accepted.terms;
   return operate(true,(_h,s,now)=>{
    if(!s||now<t.startsAt||now>=t.expiresAt||!next(s,t))return {result:false};
    const amended:WeatherState={...s,history:[...s.history,accepted]},raw=JSON.stringify(amended);
    if(Buffer.byteLength(raw)>WEATHER_JSON_LIMIT)return {result:false};
    if(db.prepare(`UPDATE main.${tableName} SET body=? WHERE singleton=1 AND body=?`).run(raw,JSON.stringify(s)).changes!==1)
     throw Error('seasonal_private_weather_write');
    return {result:true,next:amended};
   })===true;
  },
  hasNativeFact(){return operate(false,(_h,s)=>({result:!!s}))===true;},
  authorized,
  packet(){const allowed=!publicSource&&authorized();return allowed&&allowed.terms.schema!==PUBLIC_SOURCE_PURPOSE?nativeWeatherDraftPacket(allowed.terms,allowed.fact):null;},
  close(){if(!closed){closed=true;db.close();}}
 };
}

/** Separate bounded seasonal mode. Caller explicitly pumps the server; the
 * normal rules runner and all pre-existing model entry points stay unchanged. */
const NATIVE_DRAFT_PROFILE='private-canonical-seasonal-weather-draft/v1' as const;
const WIRE_DRAFT_PROFILE='private-canonical-seasonal-weather-wire-draft/v1' as const;
const HELD_HTTP_PROFILE='seasonal-g0-public-weather-http-held-response/v1' as const;
const PUBLIC_RESPONSE_PROFILE='seasonal-g0-public-weather-prepublication-response/v1' as const;
const TOPIC_CHOICE_PROFILE='private-canonical-seasonal-weather-topic-choice/v1' as const;
const TABLE='seasonal_native_private_weather_draft';
const DDL='CREATE TABLE seasonal_native_private_weather_draft(singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1), body TEXT NOT NULL)';
const bytesMax=8192, outputBound=96;
const conditions={sun:'晴',cloud:'阴',rain:'雨',snow:'雪',mixed:'雨雪混合'} as const;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const int=(v:unknown,lo=0,hi=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const keys=['schemaVersion','mode','projectionVersion','worldId','sourceRef','sourceDigest','permitVersion','observedMinute',
 'condition','temperatureDeciC','relativeHumidityPermille','cloudPermille','windPermille','daylightPermille','precipitationPermille'] as const;
type WeatherDraftPacket<Mode extends string=string>=Readonly<{schemaVersion:1;mode:Mode;projectionVersion:1;
 worldId:string;sourceRef:string;sourceDigest:string;permitVersion:number;observedMinute:number;condition:keyof typeof conditions;
 temperatureDeciC:number;relativeHumidityPermille:number;cloudPermille:number;windPermille:number;daylightPermille:number;precipitationPermille:number;}>;
type NativeWeatherDraftPacket=WeatherDraftPacket<'private-seasonal-weather-prepare-only'>;
const PUBLIC_PACKET_MODE='seasonal-public-weather-pending-editorial' as const;
type PublicResponsePacket=WeatherDraftPacket<typeof PUBLIC_PACKET_MODE>&Readonly<{grantDigest:string;eligibilityPacketDigest:string}>;
type DraftPacket=NativeWeatherDraftPacket|PublicResponsePacket;
function nativeWeatherDraftPacket(t:SeasonalPrivateWeatherTerms,fact:PublicWeatherFact):NativeWeatherDraftPacket{
 const {condition,temperatureDeciC,relativeHumidityPermille,cloudPermille,windPermille,daylightPermille,precipitationPermille}=fact;
 return Object.freeze({schemaVersion:1,mode:'private-seasonal-weather-prepare-only',projectionVersion:1,
  worldId:t.worldId,sourceRef:t.worldId+'/seasonal-hour-'+t.hourMinute,
  sourceDigest:t.sourceDigest,permitVersion:t.version,observedMinute:t.hourMinute,
  condition,temperatureDeciC,relativeHumidityPermille,cloudPermille,windPermille,daylightPermille,precipitationPermille});
}
type TopicFieldPoint=Readonly<Pick<PublicWeatherFact,'minute'|'condition'|'temperatureDeciC'|'relativeHumidityPermille'>>;
type TopicBasis=Readonly<{firstGrantDigest:string;secondGrantDigest:string;late:TopicFieldPoint}>;
const topicOf=(p:DraftPacket,t:TopicBasis)=>nativeSeasonalWeatherPairMenu({
 minute:p.observedMinute,condition:p.condition,temperatureDeciC:p.temperatureDeciC,relativeHumidityPermille:p.relativeHumidityPermille,
},t.late);
function validTopicBasis(v:unknown,p:DraftPacket):v is TopicBasis{
 if(!exact(v,['firstGrantDigest','secondGrantDigest','late'])||!hex(v.firstGrantDigest)||!hex(v.secondGrantDigest)||
  v.firstGrantDigest===v.secondGrantDigest||!exact(v.late,['minute','condition','temperatureDeciC','relativeHumidityPermille']))return false;
 const l=v.late;
 return l.minute===p.observedMinute+60&&typeof l.condition==='string'&&Object.hasOwn(conditions,l.condition)&&
  int(l.temperatureDeciC,-300,450)&&int(l.relativeHumidityPermille,0,1000);
}
export interface NativeWeatherDraftTerms {schema:typeof NATIVE_DRAFT_PROFILE;binding:string;worldId:string;requestId:string;
 packetDigest:string;permitVersion:number;}
type NativeWeatherWireDraftTerms=Omit<NativeWeatherDraftTerms,'schema'>&{schema:typeof WIRE_DRAFT_PROFILE;wireDigest:string;};
type NativePublicWeatherResponseTerms=Omit<NativeWeatherWireDraftTerms,'schema'>&{schema:typeof PUBLIC_RESPONSE_PROFILE;};
type HeldHttpWeatherTerms=Omit<NativeWeatherWireDraftTerms,'schema'>&{schema:typeof HELD_HTTP_PROFILE;bodyDigest:string;};
type NativeWeatherTopicChoiceTerms=Omit<NativeWeatherWireDraftTerms,'schema'>&{schema:typeof TOPIC_CHOICE_PROFILE;topicDigest:string;};
const termsKeys=['schema','binding','worldId','requestId','packetDigest','permitVersion'] as const;
const wireKeys=[...termsKeys,'wireDigest'] as const;
const topicKeys=[...wireKeys,'topicDigest'] as const;
const httpKeys=[...wireKeys,'bodyDigest'] as const;
const approvalKeys=(schema:string)=>schema===HELD_HTTP_PROFILE?httpKeys:schema===TOPIC_CHOICE_PROFILE?topicKeys:(schema===WIRE_DRAFT_PROFILE||schema===PUBLIC_RESPONSE_PROFILE)?wireKeys:termsKeys;
const requestPattern=/^seasonal-private-almanac-[a-f0-9]{64}$/;
export function encodeNativeWeatherDraftTerms(t:unknown):Buffer|null {
 const http=exact(t,httpKeys)&&t.schema===HELD_HTTP_PROFILE&&hex(t.wireDigest)&&hex(t.bodyDigest);
 const topic=exact(t,topicKeys)&&t.schema===TOPIC_CHOICE_PROFILE&&hex(t.topicDigest)&&hex(t.wireDigest);
 const wire=exact(t,wireKeys)&&(t.schema===WIRE_DRAFT_PROFILE||t.schema===PUBLIC_RESPONSE_PROFILE)&&hex(t.wireDigest);
 if(!(http||topic||wire||exact(t,termsKeys)&&t.schema===NATIVE_DRAFT_PROFILE)||!hex(t.binding)||!hex(t.packetDigest)||
  typeof t.worldId!=='string'||!/^godot-mvp-[a-f0-9-]{36}$/.test(t.worldId)||typeof t.requestId!=='string'||
  !requestPattern.test(t.requestId)||!int(t.permitVersion,1,32))return null;
 return Buffer.from(JSON.stringify([http?'explicit-seasonal-g0-weather-http-shaped-disconnected-only':topic?'explicit-numbered-weather-topic-no-world-authority':
  wire?t.schema===PUBLIC_RESPONSE_PROFILE?'explicit-seasonal-g0-source-response-pending-editorial':'explicit-versioned-memory-weather-claims-no-publication':'explicit-compiled-offline-claim-no-publication',
  ...approvalKeys(t.schema as string).map(k=>t[k])]));
}
type Approval={terms:NativeWeatherDraftTerms|NativeWeatherWireDraftTerms|NativeWeatherTopicChoiceTerms|NativePublicWeatherResponseTerms|HeldHttpWeatherTerms;signature:string;};
type Proof=NonNullable<ReturnType<ProductionAccountQuotaRehearsal['proveOfflineAlmanacCompletion']>>;
type Usage={at:number;inputTokens:number;outputTokens:number;proof:Proof;};
const compose=(p:DraftPacket)=>Object.freeze({observedMinute:p.observedMinute,
 field:'condition' as const,value:p.condition,text:`第 ${p.observedMinute} 游戏分钟，天气：${conditions[p.condition]}`});
type WeatherDraftFact=ReturnType<typeof compose>|NonNullable<ReturnType<typeof groundSeasonalWeatherWireReply>>;
type TopicChoice={readonly number:number};
type State={schemaVersion:1|2|3|4|5;topic?:TopicBasis;sequence:number;approval:Approval;packet:DraftPacket;
 phase:'intent'|'sent-unknown'|'not-dispatched'|'grounded'|'settled-hidden';settlement:Usage|null;draft:WeatherDraftFact|TopicChoice|null;};

function validPacket(p:unknown,worldId:string,hour:number):p is DraftPacket{
 const publicMode=exact(p,[...keys,'grantDigest','eligibilityPacketDigest'])&&p.mode===PUBLIC_PACKET_MODE&&hex(p.grantDigest)&&hex(p.eligibilityPacketDigest);
 return (publicMode||exact(p,keys)&&p.mode==='private-seasonal-weather-prepare-only')&&p.schemaVersion===1&&p.projectionVersion===1&&
  p.worldId===worldId&&p.observedMinute===hour&&hex(p.sourceDigest)&&int(p.permitVersion,1,32)&&
  p.sourceRef===(publicMode?worldId+'/weather-'+p.permitVersion+'-'+hour/60:worldId+'/seasonal-hour-'+hour)&&
  typeof p.condition==='string'&&Object.hasOwn(conditions,p.condition)&&int(p.temperatureDeciC,-300,450)&&keys.slice(10).every(key=>int(p[key],0,1000));
}
/** Operator-only attachment to the current world and permit. A single local
 * treatment uses either the compiled claim or a claimed data-only adapter. */
function openNativeWeatherDraft(owner:RuntimeOwnership,quota:ProductionAccountQuotaRehearsal,opts:{
 binding:string;worldId:string;hour:number;signer:KeyObject;guard:()=>void;currentRevision:()=>number;
 packet:()=>DraftPacket|null;publicResponse?:true;residentPriority:()=>boolean;now:()=>number;
 wire?:ReturnType<typeof claimSeasonalWeatherMemoryTransport>;
 heldHttp?:ReturnType<typeof claimSeasonalHeldWeatherMemory>;
 topic?:()=>{packet:NativeWeatherDraftPacket;topic:TopicBasis}|null;
}){
 const {binding,worldId,hour,signer,guard,currentRevision,residentPriority,now}=opts;
 // The compiled and versioned-wire treatments cannot both spend the same
 // approved source opportunity. Keep the existing request ID and anchor.
 const draftVersion=opts.heldHttp?5:opts.publicResponse?4:opts.topic?3:opts.wire?2:1;
 const requestId='seasonal-private-almanac-'+hash([NATIVE_DRAFT_PROFILE,quota.accountScope,quota.runId,binding,worldId,hour]);
 const db=new DatabaseSync(owner.database);
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');}catch(e){db.close();throw e;}
 let closed=false,isolated=false,seen:string|null=null;
 const abort=new AbortController();
 const approval=(x:unknown):Approval|null=>{
  if(!exact(x,['terms','signature'])||typeof x.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(x.signature))return null;
  const bytes=encodeNativeWeatherDraftTerms(x.terms),t=x.terms as Approval['terms'],sig=Buffer.from(x.signature,'base64url');
  if(!bytes||sig.length!==64||sig.toString('base64url')!==x.signature||!verify(null,bytes,signer,sig)||
    t.binding!==binding||t.worldId!==worldId||t.requestId!==requestId)return null;
  return {terms:Object.fromEntries(approvalKeys(t.schema).map(k=>[k,(t as unknown as Record<string,unknown>)[k]])) as unknown as Approval['terms'],signature:x.signature};
 };
 const current=()=>{
  const basis=opts.topic?opts.topic():{packet:opts.packet(),topic:undefined},p=basis?.packet;
  return validPacket(p,worldId,hour)?{packet:p,topic:basis?.topic}:null;
 };
 const wireFor=(p:DraftPacket,version:State['schemaVersion'],basis?:TopicBasis)=>{
  if(version===1)return null;
  if(version===2||version===4||version===5)return seasonalWeatherWireRequest(p);
  const menu=basis?topicOf(p,basis):null;
  return menu?seasonalWeatherTopicChoiceRequest(menu):null;
 };
 const termsFor=(p:DraftPacket,version:State['schemaVersion'],basis?:TopicBasis):Approval['terms']|null=>{
  if((version===4||version===5)!==(p.mode===PUBLIC_PACKET_MODE))return null;
  const base={binding,worldId,requestId,packetDigest:hash(p),permitVersion:p.permitVersion};
  if(version===1)return {schema:NATIVE_DRAFT_PROFILE,...base};
  const wire=wireFor(p,version,basis);
  if(!wire)return null;
  if(version===5){const req=prepareSeasonalHeldWeatherBody(p);return req?{schema:HELD_HTTP_PROFILE,...base,wireDigest:wire.digest,bodyDigest:req.bodyDigest}:null;}
  return version===4?{schema:PUBLIC_RESPONSE_PROFILE,...base,wireDigest:wire.digest}:version===2?{schema:WIRE_DRAFT_PROFILE,...base,wireDigest:wire.digest}:
   {schema:TOPIC_CHOICE_PROFILE,...base,wireDigest:wire.digest,topicDigest:hash(basis)};
 };
 const active=(s:State)=>{
  guard();
  const p=current();
  return !!p&&hash(termsFor(p.packet,s.schemaVersion,p.topic))===hash(s.approval.terms);
 };
 const read=(checkContinuity=true)=>{
  guard();
  const head=db.prepare('SELECT id,revision FROM worlds LIMIT 2').all();
  if(head.length!==1||head[0].id!==worldId||head[0].revision!==currentRevision())throw Error('seasonal_weather_draft_head');
  const table=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(TABLE);
  if(!table){if(checkContinuity&&seen!==null)throw Error('seasonal_weather_draft_rewind');return null;}
  if(table.type!=='table'||table.sql!==DDL||
   db.prepare("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
   throw Error('seasonal_weather_draft_schema');
  const rows=db.prepare(`SELECT singleton,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM ${TABLE} LIMIT 2`).all(bytesMax);
  const raw=rows[0]?.body;
  if(rows.length!==1||rows[0].singleton!==1||typeof raw!=='string'||checkContinuity&&seen!==null&&raw!==seen)
   throw Error('seasonal_weather_draft_row');
  const u:unknown=JSON.parse(raw);
  const stateKeys=['schemaVersion','sequence','approval','packet','phase','settlement','draft'];
  const v3=typeof u==='object'&&u!==null&&'schemaVersion' in u&&u.schemaVersion===3;
  if(!exact(u,v3?[...stateKeys,'topic']:stateKeys)||(u.schemaVersion!==1&&u.schemaVersion!==2&&u.schemaVersion!==3&&u.schemaVersion!==4&&u.schemaVersion!==5)||
   !int(u.sequence,1,3)||!validPacket(u.packet,worldId,hour)||typeof u.phase!=='string'||!['intent','sent-unknown','not-dispatched','grounded','settled-hidden'].includes(u.phase)||
   u.phase==='intent'&&u.sequence!==1||u.phase==='sent-unknown'&&u.sequence!==2||
   (u.phase==='grounded'||u.phase==='settled-hidden')&&u.sequence!==3||u.phase==='not-dispatched'&&u.sequence<2)
   throw Error('seasonal_weather_draft_state');
  const topic=v3&&validTopicBasis(u.topic,u.packet)?u.topic:undefined;
  if(v3&&!topic)throw Error('seasonal_weather_topic_basis');
  const a=approval(u.approval);
  if(!a||hash(a.terms)!==hash(termsFor(u.packet,u.schemaVersion,topic)))throw Error('seasonal_weather_draft_permit');
  const d=u.draft;
  if(u.phase==='grounded'?(topic?!exact(d,['number'])||!topicOf(u.packet,topic)?.options.some(o=>o.number===d.number):
   u.schemaVersion===1?hash(d)!==hash(compose(u.packet)):!validSeasonalWeatherWireDraft(u.packet,d)):d!==null)
   throw Error('seasonal_weather_draft_shape');
  const p=u.settlement;
  if(u.phase==='grounded'||u.phase==='settled-hidden'){
   if(!exact(p,['at','inputTokens','outputTokens','proof'])||!int(p.at)||!int(p.inputTokens,1)||!int(p.outputTokens,u.schemaVersion===1?1:0,u.schemaVersion===1?outputBound:u.schemaVersion===5?SEASONAL_HELD_WEATHER_OUTPUT_TOKENS:SEASONAL_WEATHER_WIRE_REPLY_BYTES)||
    (u.schemaVersion===5?(u.phase==='grounded'&&p.outputTokens===0)||p.inputTokens>(prepareSeasonalHeldWeatherBody(u.packet)?.inputTokenBound??0):
       u.schemaVersion!==1&&p.inputTokens!==Buffer.byteLength(wireFor(u.packet,u.schemaVersion,topic)?.bytes??''))||
    hash(p.proof)!==hash(quota.proveOfflineAlmanacCompletion(requestId,p.at,p.inputTokens,p.outputTokens))||
    !p.proof)throw Error('seasonal_weather_draft_completion');
  }else if(p!==null)throw Error('seasonal_weather_draft_unsettled');
  if(JSON.stringify({...u,approval:a})!==raw)throw Error('seasonal_weather_draft_noncanonical');
  return {raw,state:u as unknown as State};
 };
 const account=()=>quota.seasonalPrivateWeatherDraftRequest(requestId);
 const anchorFor=(row:NonNullable<ReturnType<typeof read>>)=>({sequence:row.state.sequence,digest:hash(row.raw)});
 const assertAnchor=(row:ReturnType<typeof read>)=>{
  const anchor=quota.seasonalPrivateWeatherDraftAnchor(binding,requestId);
  if(hash(anchor)!==hash(row?anchorFor(row):null))throw Error('seasonal_weather_draft_cross_store');
 };
 const put=(prior:ReturnType<typeof read>,next:Omit<State,'sequence'>)=>{
  const nextState:State={...next,sequence:(prior?.state.sequence??0)+1};
  const body=JSON.stringify(nextState);if(Buffer.byteLength(body)>bytesMax)throw Error('seasonal_weather_draft_size');
  db.exec('BEGIN IMMEDIATE');
  try{
   const current=read();
   if((current?.raw??null)!==(prior?.raw??null))throw Error('seasonal_weather_draft_cas');
   assertAnchor(current);
   if(!current){db.exec(DDL);db.prepare(`INSERT INTO ${TABLE} VALUES(1,?)`).run(body);}
   else if(db.prepare(`UPDATE ${TABLE} SET body=? WHERE singleton=1 AND body=?`).run(body,current.raw).changes!==1)throw Error('seasonal_weather_draft_cas');
   if(read(false)?.raw!==body)throw Error('seasonal_weather_draft_readback');
   const nextAnchor=anchorFor({raw:body,state:nextState}),previous=current?anchorFor(current):null;
   if(hash(quota.seasonalPrivateWeatherDraftAnchor(binding,requestId,{previous,next:nextAnchor}))!==hash(nextAnchor))
    throw Error('seasonal_weather_draft_anchor_write');
   guard();db.exec('COMMIT');seen=body;return {raw:body,state:nextState};
  }catch(error){db.exec('ROLLBACK');throw error;}
 };
 const eligible=()=>{
  if(residentPriority())return 'resident-priority' as const;
  const q=quota.summary(now());
  return q.waitingResidents?'resident-priority' as const:q.held||q.unknown?'blocked' as const:null;
 };
 const state=()=>{
  const row=read();assertAnchor(row);
  const q=account();
  if(row?((row.state.phase==='grounded'||row.state.phase==='settled-hidden')&&q!=='complete'||
    row.state.phase==='not-dispatched'&&q!==null&&q!=='claim-only'&&q!=='cancelled'):q!==null)
   throw Error('seasonal_weather_draft_cross_store');
  if(row)seen=row.raw;
  return row;
 };
 const blocked=Object.freeze({status:'blocked' as const});
 const start=(input:unknown,version:State['schemaVersion'])=>{
  if(closed||isolated||version!==draftVersion)return blocked;
  const existing=state();
  if(existing)return {status:['intent','sent-unknown'].includes(existing.state.phase)?'blocked' as const:'already-processed' as const};
  const a=approval(structuredClone(input)),basis=current();
  if(!a||!basis||hash(a.terms)!==hash(termsFor(basis.packet,version,basis.topic)))return {status:'unapproved' as const};
  const wait=eligible();if(wait)return {status:wait};
  const {packet:p,topic}=basis;
  let row=put(null,{schemaVersion:version,approval:a,packet:p,phase:'intent',settlement:null,draft:null,...topic?{topic}:{} });
  const suppress=()=>{put(row,{...row.state,phase:'not-dispatched'});return {status:'not-dispatched' as const};};
  if(!active(row.state)||eligible())return suppress();
  const wire=wireFor(p,version,topic);
  const envelope=version===5?prepareSeasonalHeldWeatherBody(p):null;
  if(version===5&&(!envelope||a.terms.schema!==HELD_HTTP_PROFILE||envelope.bodyDigest!==a.terms.bodyDigest))return suppress();
  const inputTokens=envelope?.inputTokenBound??Buffer.byteLength(wire?.bytes??JSON.stringify(p));
  const reserved=quota.reserve({requestId,purpose:'valley-spirit-almanac',inputTokens,
   outputTokens:envelope?SEASONAL_HELD_WEATHER_OUTPUT_TOKENS:wire?SEASONAL_WEATHER_WIRE_REPLY_BYTES:outputBound},now());
  if(reserved.status!=='reserved')return reserved.status==='duplicate'?blocked:suppress();
  if(!active(row.state)||residentPriority())return quota.cancelProvenUnsent(requestId,now())?suppress():blocked;
  row=put(row,{...row.state,phase:'sent-unknown'});
  if(!active(row.state)||residentPriority())return quota.cancelProvenUnsent(requestId,now())?suppress():blocked;
  if(!quota.markHandoff(requestId,now())||!active(row.state)||residentPriority())return blocked;
  return {row,p,topic,wire,inputTokens,envelope};
 };
 const complete=(row:ReturnType<typeof put>,inputTokens:number,outputTokens:number,result:WeatherDraftFact|TopicChoice|null)=>{
  if(closed||isolated||state()?.raw!==row.raw||account()!=='sent-unknown')return blocked;
  const at=now();
  if(!quota.confirmCompletion(requestId,at,{inputTokens,outputTokens}))return blocked;
  const proof=quota.proveOfflineAlmanacCompletion(requestId,at,inputTokens,outputTokens);
  if(!proof)return blocked;
  const visible=!!result&&active(row.state)&&(!(opts.wire||opts.heldHttp)||!residentPriority());
  put(row,{...row.state,phase:visible?'grounded':'settled-hidden',settlement:{at,inputTokens,outputTokens,proof},draft:visible?result:null});
  return {status:visible?((row.state.schemaVersion===4||row.state.schemaVersion===5)?'public-weather-response-pending-editorial' as const:row.state.schemaVersion===3?'private-topic-selected' as const:'private-draft-grounded' as const):result?'not-current' as const:'invalid-response' as const};
 };
 return Object.freeze({
  terms(){
   if(closed||isolated)return null;
   try{if(state())return null;const p=current(),t=p?termsFor(p.packet,draftVersion,p.topic):null;return t?Object.freeze(t):null;}
   catch{isolated=true;return null;}
  },
  pump(input:unknown){
   try{
    const s=start(input,1);if('status' in s)return s;
    const result=compose(s.p);
    return complete(s.row,s.inputTokens,Buffer.byteLength(JSON.stringify([result.field,result.value])),result);
   }catch{isolated=true;return blocked;}
  },
  previewTopic(){
   if(closed||isolated||draftVersion!==3)return null;
   try{
    if(state())return null;
    const p=current();if(!p?.topic)return null;
    const t=termsFor(p.packet,3,p.topic),wire=wireFor(p.packet,3,p.topic);
    return t?.schema===TOPIC_CHOICE_PROFILE&&wire?Object.freeze({terms:Object.freeze(t),exactMenuBytes:wire.bytes}):null;
   }catch{isolated=true;return null;}
  },
  async pumpWire(input:unknown,version:2|3|4=2){
   try{
    if(!opts.wire)return blocked;
    const s=start(input,version);
    if('status' in s)return s;
    if(!s.wire||s.wire.digest!==(s.row.state.approval.terms as NativeWeatherWireDraftTerms|NativeWeatherTopicChoiceTerms|NativePublicWeatherResponseTerms).wireDigest)return blocked;
    const raw=await opts.wire(s.wire.bytes,abort.signal);
    if(typeof raw!=='string'||raw.length>SEASONAL_WEATHER_WIRE_REPLY_BYTES)return blocked;
    const size=Buffer.byteLength(raw);
    if(size>SEASONAL_WEATHER_WIRE_REPLY_BYTES)return blocked;
    if(version===3){
     const menu=s.topic?topicOf(s.p,s.topic):null;
     return menu&&'menuToken' in s.wire&&typeof s.wire.menuToken==='string'?
      complete(s.row,s.inputTokens,size,groundSeasonalWeatherTopicChoice(menu,s.wire.menuToken,raw)):blocked;
    }
    return complete(s.row,s.inputTokens,size,groundSeasonalWeatherWireReply(s.p,raw));
   }catch{if(!closed)isolated=true;return blocked;}
  },
  async pumpHeldHttp(input:unknown){
   try{
    if(!opts.heldHttp||draftVersion!==5)return blocked;
    const s=start(input,5);
    if('status' in s)return s;
    if(!s.envelope)return blocked;
    const raw=await opts.heldHttp(s.envelope.body,abort.signal);
    const parsed=parseSeasonalHeldWeatherCompletion(s.p,raw);
    return parsed?complete(s.row,parsed.inputTokens,parsed.outputTokens,parsed.fact):blocked;
   }catch{if(!closed)isolated=true;return blocked;}
  },
  readPrivateTopic(){
   if(closed||isolated||draftVersion!==3)return null;
   try{
    const row=state(),s=row?.state,q=quota.summary(now());
    if(!s||s.phase!=='grounded'||s.schemaVersion!==3||!s.topic||!s.draft||!('number' in s.draft)||q.held||q.unknown||!active(s))return null;
    const number=s.draft.number,option=topicOf(s.packet,s.topic)?.options.find(o=>o.number===number);
    return option?Object.freeze({status:'private-synthetic-weather-topic' as const,menuVersion:1 as const,option}):null;
   }catch{isolated=true;return null;}
  },
  previewPublicResponse(){
   if(closed||isolated||(draftVersion!==4&&draftVersion!==5))return null;
   try{
    if(state())return null;const p=current();if(!p)return null;
    const t=termsFor(p.packet,draftVersion),wire=wireFor(p.packet,draftVersion);
    if(t?.schema===HELD_HTTP_PROFILE&&wire){const req=prepareSeasonalHeldWeatherBody(p.packet);
     return req?Object.freeze({terms:Object.freeze(t),exactRequestBytes:wire.bytes,exactProviderRequestBody:req.body,liveAuthorized:false as const}):null;}
    return t?.schema===PUBLIC_RESPONSE_PROFILE&&wire?Object.freeze({terms:Object.freeze(t),exactRequestBytes:wire.bytes}):null;
   }catch{isolated=true;return null;}
  },
  readPublicResponse(){
   if(closed||isolated||(draftVersion!==4&&draftVersion!==5))return null;
   try{
    const row=state(),q=quota.summary(now()),s=row?.state;
    if(s?.phase!=='grounded'||s.schemaVersion!==draftVersion||s.packet.mode!==PUBLIC_PACKET_MODE||!s.draft||
       'number' in s.draft||!s.settlement||q.held||q.unknown||!active(s))return null;
    return Object.freeze({status:'public-weather-response-pending-editorial' as const,publicationAuthorized:false as const,
     grantDigest:s.packet.grantDigest,eligibilityPacketDigest:s.packet.eligibilityPacketDigest,
     ...(draftVersion===5?{liveAuthorized:false as const}:{}),responseDigest:hash([s.approval,s.draft,s.settlement]),fact:Object.freeze({...s.draft})});
   }catch{isolated=true;return null;}
  },
  readPrivateDraft(){
   if(closed||isolated)return null;
   try{
    const row=state(),q=quota.summary(now());
    return row?.state.phase==='grounded'&&row.state.schemaVersion===draftVersion&&row.state.draft&&!('number' in row.state.draft)&&!q.held&&!q.unknown&&active(row.state)?
     Object.freeze({status:'private-synthetic-weather-draft' as const,rendererVersion:1 as const,fact:Object.freeze({...row.state.draft!})}):null;
   }catch{isolated=true;return null;}
  },
  close(){if(!closed){closed=true;abort.abort();db.close();}}
 });
}

const seasonalLocalWeatherEditorial=(()=>{
const SCHEMA='seasonal-local-weather-editorial/v1' as const;
const MODE='explicit-local-offline-weather-edition' as const;
const TABLE='seasonal_local_weather_editorial';
const DDL='CREATE TABLE seasonal_local_weather_editorial(singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1), body TEXT NOT NULL)';
const KEYS=['schema','action','worldId','binding','reviewer','sequence','priorDigest','headRevision','headDigest','grantDigest','packetDigest','responseDigest','renderDigest'] as const;
const FACT_KEYS=['grantDigest','packetDigest','responseDigest','renderDigest'] as const;
const LIMIT=4096;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type Action='publish'|'revoke';
type Terms=Readonly<{schema:typeof SCHEMA;action:Action;worldId:string;binding:string;reviewer:string;sequence:1|2;priorDigest:string;
 headRevision:number;headDigest:string;grantDigest:string;packetDigest:string;responseDigest:string;renderDigest:string;}>;
type Approval=Readonly<{terms:Terms;signature:string}>;
type Rendered=NonNullable<ReturnType<typeof renderOneSeasonalWeatherReview>>;
type Facts=Readonly<{grantDigest:string;packetDigest:string;responseDigest:string;renderDigest:string;}>;
type ViewBasis={grantDigest:string;packetDigest:string;responseDigest:string;packet:ValleySpiritAlmanacPacket;field:unknown;value:unknown};
const sameFacts=(a:Facts,b:Facts)=>FACT_KEYS.every(k=>a[k]===b[k]);

function encodeSeasonalLocalWeatherEditorialTerms(t:unknown):Buffer|null{
 if(!exact(t,KEYS)||t.schema!==SCHEMA||!((t.action==='publish'&&t.sequence===1)||(t.action==='revoke'&&t.sequence===2))||
  typeof t.worldId!=='string'||!/^godot-mvp-[a-f0-9-]{36}$/.test(t.worldId)||
  !Number.isSafeInteger(t.headRevision)||(t.headRevision as number)<0||
  !['binding','reviewer','priorDigest','headDigest',...FACT_KEYS].every(k=>hex(t[k])))return null;
 return Buffer.from(JSON.stringify([MODE,...KEYS.map(k=>t[k])]));
}

/** Called only by the original explicitly opted-in canonical Seasonal runtime.
 * This closure has no transport or route; the supplied reader belongs to that
 * runtime and revalidates the independently signed source and quota proof. */
function openSeasonalLocalWeatherEditorial(owner:RuntimeOwnership,quota:ProductionAccountQuotaRehearsal,opts:{
 worldId:string;binding:string;reviewer:string;signer:KeyObject;guard:()=>void;revision:()=>number;basis:()=>ViewBasis|null;
}){
 const {worldId,binding,reviewer,signer,guard,revision}=opts;
 const db=new DatabaseSync(owner.database);
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');}catch(e){db.close();throw e;}
 let closed=false,isolated=false,seen:string|null=null;
 const checked=(u:unknown):Approval|null=>{
  if(!exact(u,['terms','signature'])||typeof u.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(u.signature))return null;
  const bytes=encodeSeasonalLocalWeatherEditorialTerms(u.terms),t=u.terms as Terms,signature=Buffer.from(u.signature,'base64url');
  if(!bytes||t.worldId!==worldId||t.binding!==binding||t.reviewer!==reviewer||signature.length!==64||
   signature.toString('base64url')!==u.signature||!verify(null,bytes,signer,signature))return null;
  return {terms:Object.fromEntries(KEYS.map(k=>[k,t[k]])) as Terms,signature:u.signature};
 };
 const head=()=>{
  guard();
  if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (?, 'worlds') OR lower(tbl_name) IN (?, 'worlds')").get(TABLE,TABLE))
   throw Error('seasonal_weather_editor_shadow');
  const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all();
  const row=rows[0];
  if(rows.length!==1||row.id!==worldId||row.revision!==revision()||!(row.state instanceof Uint8Array))
   throw Error('seasonal_weather_editor_head');
  return {headRevision:row.revision,headDigest:createHash('sha256').update(row.state).digest('hex')};
 };
 const history=(continuity=true)=>{
  const t=db.prepare('SELECT type,sql FROM main.sqlite_schema WHERE name=? COLLATE NOCASE').get(TABLE);
  if(!t){
   if(continuity&&seen!==null)throw Error('seasonal_weather_editor_rewind');
   return {raw:null,list:[] as Approval[]};
  }
  if(t.type!=='table'||t.sql!==DDL||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
   throw Error('seasonal_weather_editor_schema');
  const rows=db.prepare(`SELECT singleton,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM main.${TABLE} LIMIT 2`).all(LIMIT);
  const raw=rows[0]?.body;
  if(rows.length!==1||rows[0].singleton!==1||typeof raw!=='string'||continuity&&seen!==null&&seen!==raw)throw Error('seasonal_weather_editor_row');
  const values:unknown=JSON.parse(raw);
  if(!Array.isArray(values)||values.length<1||values.length>2)throw Error('seasonal_weather_editor_chain');
  const list:Approval[]=[];
  for(const entry of values){
   const a=checked(entry),prior=list.at(-1);
   if(!a||a.terms.sequence!==list.length+1||a.terms.headRevision>revision()||a.terms.priorDigest!==digest(list)||
      prior&&(a.terms.headRevision<prior.terms.headRevision||!sameFacts(a.terms,prior.terms)))throw Error('seasonal_weather_editor_chain');
   list.push(a);
  }
  if(JSON.stringify(list)!==raw)throw Error('seasonal_weather_editor_canonical');
  return {raw,list};
 };
 const anchorFor=(s:ReturnType<typeof history>)=>s.raw===null?null:{sequence:s.list.length,digest:digest(s.raw)};
 const assertAnchor=(s:ReturnType<typeof history>)=>{
  const a=quota.seasonalPublicWeatherEditorAnchor(binding);
  if(digest(a)!==digest(anchorFor(s)))throw Error('seasonal_weather_editor_cross_store');
 };
 const view=()=>{
  const b=opts.basis();if(!b||b.packet.worldId!==worldId)return null;
  const rendered=renderOneSeasonalWeatherReview(b.packet,b.field,b.value);
  if(!rendered)return null;
  return {rendered, facts:{grantDigest:b.grantDigest,packetDigest:b.packetDigest,responseDigest:b.responseDigest,renderDigest:digest(rendered)}};
 };
 const build=(action:Action,s:ReturnType<typeof history>,h:ReturnType<typeof head>)=>{
  let basis:ReturnType<typeof view>=null,facts:Facts,sequence:1|2;
  if(action==='publish'){
   if(s.list.length!==0||(basis=view())===null)return null;
   facts=basis.facts;sequence=1;
  }else if(action==='revoke'&&s.list.length===1){
   const p=s.list[0].terms;
   facts={grantDigest:p.grantDigest,packetDigest:p.packetDigest,responseDigest:p.responseDigest,renderDigest:p.renderDigest};sequence=2;
  }else return null;
  const terms:Terms={schema:SCHEMA,action,worldId,binding,reviewer,sequence,priorDigest:digest(s.list),...h,...facts};
  return {terms:Object.freeze(terms),rendered:basis?.rendered??null};
 };
 const inspect=<T>(fn:(s:ReturnType<typeof history>,h:ReturnType<typeof head>)=>T):T|null=>{
  if(closed||isolated)return null;
  try{
   db.exec('BEGIN');
   try{
    const h=head(),s=history();assertAnchor(s);
    const result=fn(s,h);guard();db.exec('COMMIT');seen=s.raw;return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }catch{isolated=true;return null;}
 };
 return Object.freeze({
  preview(action:Action){
   if(action!=='publish'&&action!=='revoke')return null;
   return inspect((s,h)=>build(action,s,h));
  },
  record(input:unknown):boolean{
   if(closed||isolated)return false;
   let a:Approval|null;
   try{a=checked(structuredClone(input));}catch{return false;}
   if(!a)return false;
   try{
    db.exec('BEGIN IMMEDIATE');
    try{
     const h=head(),s=history();assertAnchor(s);
     const offered=build(a.terms.action,s,h);
     if(!offered||digest(offered.terms)!==digest(a.terms)){db.exec('ROLLBACK');return false;}
     const next=[...s.list,a],raw=JSON.stringify(next);
     if(Buffer.byteLength(raw)>LIMIT)throw Error('seasonal_weather_editor_size');
     if(!s.raw){db.exec(DDL);db.prepare(`INSERT INTO main.${TABLE} VALUES (1,?)`).run(raw);}
     else if(db.prepare(`UPDATE main.${TABLE} SET body=? WHERE singleton=1 AND body=?`).run(raw,s.raw).changes!==1)
      throw Error('seasonal_weather_editor_cas');
     const saved=history(false),after=head(),again=build(a.terms.action,s,after);
     if(saved.raw!==raw||!again||digest(again.terms)!==digest(a.terms))throw Error('seasonal_weather_editor_readback');
     const anchor=anchorFor(saved)!;
     if(digest(quota.seasonalPublicWeatherEditorAnchor(binding,{previous:anchorFor(s),next:anchor}))!==digest(anchor))
      throw Error('seasonal_weather_editor_anchor_write');
     guard();db.exec('COMMIT');seen=raw;return true;
    }catch(e){db.exec('ROLLBACK');throw e;}
   }catch{isolated=true;return false;}
  },
  latest(){
   return inspect((s,h)=>{
    const a=s.list[0]?.terms;
    if(!a||s.list.length!==1||a.headRevision===h.headRevision&&a.headDigest!==h.headDigest)return null;
    const v=view();
    return v&&sameFacts(a,v.facts)?{status:'local-reviewed-offline-weather-edition' as const,
     origin:'offline-synthetic' as const,textVersion:1 as const,rendered:v.rendered}:null;
   });
  },
  close(){if(!closed){closed=true;db.close();}},
 });
}
return {open:openSeasonalLocalWeatherEditorial,encode:encodeSeasonalLocalWeatherEditorialTerms};
})();

export async function startOfflineSeasonalModel(options:{mode:'offline-seasonal';database:string;port?:number;transport?:MemoryTransport;sharedAccount?:OfflineResidentAccountAdmission;almanacFixture?:SeasonalAlmanacFixture;canonicalResidentQuota?:Readonly<CanonicalSeasonalQuota>;privateWeatherUse?:SeasonalPrivateWeatherPin;privateWeatherDraft?:true;privateWeatherWire?:SeasonalWeatherMemoryTransport;privateWeatherTopics?:typeof TOPIC_MODE;privateWeatherTopicChoice?:SeasonalWeatherMemoryTransport;publicWeatherSource?:SeasonalPublicWeatherSourcePin;publicWeatherResponse?:Readonly<{reviewerPublicKeyPem:string;transport:SeasonalWeatherMemoryTransport|SeasonalHeldWeatherTransport}>;localWeatherEditorial?:Readonly<{mode:'explicit-local-offline-weather-edition';reviewerPublicKeyPem:string}>}){
 if(options.mode!=='offline-seasonal')throw Error('seasonal_model_explicit_mode_required');
 if(options.port!==undefined&&(!Number.isInteger(options.port)||options.port<0||options.port>65535))throw Error('seasonal_model_port');
 const transport=options.transport===undefined?undefined:transports.get(options.transport);
 if(options.transport!==undefined&&(!transport||transport.claimed))throw Error('seasonal_model_transport_untrusted');
 const legacy=options.sharedAccount;
 if(legacy!==undefined&&(!(legacy instanceof OfflineResidentAccountAdmission)||!transport))throw Error('seasonal_model_shared_fixture_required');
 if(options.canonicalResidentQuota!==undefined&&(legacy||!transport||options.almanacFixture!==undefined))
  throw Error('seasonal_model_canonical_residents_only');
 const canonical=options.canonicalResidentQuota===undefined?undefined:
  OfflineResidentAccountAdmission.claimCanonical(options.canonicalResidentQuota,wall);
 const weatherPin=options.privateWeatherUse===undefined?undefined:pinSeasonalWeather(options.privateWeatherUse);
 if(weatherPin&&!canonical)throw Error('seasonal_private_weather_requires_canonical_residents');
 const wireEnabled=options.privateWeatherWire!==undefined;
 const draftEnabled=options.privateWeatherDraft===true||wireEnabled;
 if((options.privateWeatherDraft!==undefined&&options.privateWeatherDraft!==true)||
  draftEnabled&&(!weatherPin||!canonical||options.port!==undefined||wireEnabled&&options.privateWeatherDraft!==undefined))
  throw Error('seasonal_private_weather_draft_scope');
 const weatherWire=wireEnabled?claimSeasonalWeatherMemoryTransport(options.privateWeatherWire!):undefined;
 const topicsEnabled=options.privateWeatherTopics!==undefined;
 if(topicsEnabled&&(options.privateWeatherTopics!==TOPIC_MODE||!weatherPin||!canonical||options.port!==undefined||draftEnabled||
  !hour(weatherPin.hourMinute+60)))throw Error('seasonal_private_weather_topics_scope');
 const topicChoiceEnabled=options.privateWeatherTopicChoice!==undefined;
 if(topicChoiceEnabled&&!topicsEnabled)throw Error('seasonal_private_weather_topic_choice_scope');
 // Adding an adapter never changes the pair world's sealed identity or its
 // one request opportunity. Reopening without a choice adapter is view-only.
 const topicTransport=topicChoiceEnabled?claimSeasonalWeatherMemoryTransport(options.privateWeatherTopicChoice!):undefined;
 const publicSourcePin=options.publicWeatherSource===undefined?undefined:pinSeasonalWeather(options.publicWeatherSource,PUBLIC_SOURCE_MODE);
 if(publicSourcePin&&(!canonical||options.port!==undefined||
  weatherPin&&weatherPin.fingerprint===publicSourcePin.fingerprint))throw Error('seasonal_public_weather_source_scope');
 const publicResponseOption=options.publicWeatherResponse;
 const publicResponsePin=publicResponseOption===undefined?undefined:(()=>{
  if(!publicSourcePin||!canonical||draftEnabled||topicsEnabled||!exact(publicResponseOption,['reviewerPublicKeyPem','transport']))
   throw Error('seasonal_public_weather_response_scope');
  const pin=pinSeasonalWeather({mode:PUBLIC_SOURCE_MODE,hourMinute:publicSourcePin.hourMinute,
   reviewerPublicKeyPem:publicResponseOption.reviewerPublicKeyPem},PUBLIC_SOURCE_MODE);
  if(pin.fingerprint===publicSourcePin.fingerprint||pin.fingerprint===weatherPin?.fingerprint)
   throw Error('seasonal_public_weather_response_reviewer');
  return pin;
 })();
 const httpHeld=publicResponseOption?.transport?.kind==='seasonal-weather-claims-http-held-memory';
 const localWeatherEditorialOption=options.localWeatherEditorial;
 const localWeatherEditorPin=localWeatherEditorialOption===undefined?undefined:(()=>{
  if(!publicSourcePin||!publicResponsePin||!canonical||httpHeld||!exact(localWeatherEditorialOption,['mode','reviewerPublicKeyPem'])||
     localWeatherEditorialOption.mode!=='explicit-local-offline-weather-edition')
   throw Error('seasonal_local_weather_editor_scope');
  const pin=pinSeasonalWeather({mode:PUBLIC_SOURCE_MODE,hourMinute:publicSourcePin.hourMinute,
   reviewerPublicKeyPem:localWeatherEditorialOption.reviewerPublicKeyPem},PUBLIC_SOURCE_MODE);
  if([publicSourcePin.fingerprint,publicResponsePin.fingerprint,weatherPin?.fingerprint].includes(pin.fingerprint))
   throw Error('seasonal_local_weather_editor_reviewer');
  return pin;
 })();
 const publicResponseTransport=publicResponsePin&&!httpHeld?claimSeasonalWeatherMemoryTransport(publicResponseOption!.transport as SeasonalWeatherMemoryTransport):undefined;
 const publicHeldTransport=publicResponsePin&&httpHeld?claimSeasonalHeldWeatherMemory(publicResponseOption!.transport as SeasonalHeldWeatherTransport):undefined;
 const shared=canonical?.admission??legacy;
 let binding=legacy?.fixtureBinding();
 if(options.almanacFixture!==undefined&&!legacy)throw Error('seasonal_almanac_requires_bound_resident_account');
 const claimedAlmanac=options.almanacFixture&&legacy?claimSeasonalAlmanacFixture(options.almanacFixture,legacy):undefined;
 // One-shot capability claim, even if startup later fails. No await or
 // listener bind may allow a second world to claim the same synthetic slot.
 if(transport)transport.claimed=true;
 const releaseQuota=canonical?claimSeasonalResidentQuota(canonical.quota):undefined;
 const owner=(()=>{
  try{
   const pinned=canonical?.quota.seasonalResidentWorld();
   return acquireRuntimeOwnership(options.database,pinned?{existingOnly:true}:undefined);
  }catch(error){releaseQuota?.();throw error;}
 })();
 let store:WorldStore|undefined,server:ReturnType<typeof createServer>|undefined,closed=false;
 let almanac:ReturnType<typeof openSeasonalAlmanacFixture>|undefined;
 let privateWeather:ReturnType<typeof openSeasonalWeatherCustody>|undefined;
 let privateWeatherSecond:ReturnType<typeof openSeasonalWeatherCustody>|undefined;
 let publicWeatherSource:ReturnType<typeof openSeasonalWeatherCustody>|undefined;
 let weatherDraft:ReturnType<typeof openNativeWeatherDraft>|undefined;
 let localWeatherEditorial:ReturnType<typeof seasonalLocalWeatherEditorial.open>|undefined;
 const worldBinding=()=>{
  owner.assertOwned();
  const f=lstatSync(owner.database,{bigint:true});
  if(!f.isFile()||f.isSymbolicLink()||f.nlink!==1n)throw Error('seasonal_model_canonical_world_file');
  return weatherDigest(['seasonal-runtime-world/v1',canonical!.binding,canonical!.worldId,String(f.dev),String(f.ino),
   ...(weatherPin?[WEATHER_PURPOSE,weatherPin.fingerprint,weatherPin.hourMinute]:[]),...(draftEnabled?[NATIVE_DRAFT_PROFILE]:[]),...(topicsEnabled?[TOPIC_MODE,weatherPin!.hourMinute+60]:[]),
   ...(publicSourcePin?[PUBLIC_SOURCE_PURPOSE,publicSourcePin.fingerprint,publicSourcePin.hourMinute]:[])]);
 };
 try{
  owner.assertOwned();
  let inspected:SeasonalLedger|null=null;
  const saved=preflightWorldSave(owner.database,{requireWorld:true,allowSeasonalModel:true,inspectSeasonalModel:s=>{inspected=s;},validateWorld:v=>modelWorld(v as unknown as World)});
  // Cross-store binding is checked on the private preflight copy before
  // either the existing world or any resident/account state is changed.
  const previous=inspected as SeasonalLedger|null;
  if(canonical){
   if(saved&&(saved.id!==canonical.worldId||previous?.schemaVersion!==2))throw Error('seasonal_model_canonical_world');
   const pinned=canonical.quota.seasonalResidentWorld();
   if(saved){
    binding=worldBinding();
    if(binding!==pinned)throw Error('seasonal_model_canonical_world_file');
   }else{
    if(pinned!==null)throw Error('seasonal_model_canonical_world_already_bound');
    canonical.assertFresh();
   }
  }
  if(shared&&saved&&!previous)throw Error('seasonal_model_shared_fixture_fresh_save_required');
  if(transport&&(previous?.schemaVersion===2?binding!==previous.sharedAccountBinding:!!shared&&!!previous))throw Error('seasonal_model_shared_account_mismatch');
  if(canonical&&previous?.requests.at(-1)?.state!=='intent'){
   const s=canonical.quota.summary(wall());
   if(s.held||s.unknown)throw Error('seasonal_model_canonical_recovery_unresolved');
  }
  if(shared&&previous&&!shared.verifyWorldRecovery(previous.requests.map(r=>({round:{worldId:previous.worldId,residentId:r.actorId,roundId:r.id},worldTerminal:r.state!=='intent'}))))throw Error('seasonal_model_shared_recovery_unresolved');
  let w:World;
  if(saved){
   if(transport){store=new WorldStore(owner.database,{allowMvpClimate:true,seasonalModel:true});w=store.load()!;}
   else w=saved as unknown as World;
   modelWorld(w);
  }else{
   // Generate a legitimate native seed; pin only its new exact world ID.
   const initial=createMvpWorld();
   if(canonical)initial.id=canonical.worldId;
   w=createMvpSession({world:initial}).world;
   if(weatherPin&&weatherPin.hourMinute!==(Math.floor(w.minute/60)+1)*60)throw Error('seasonal_private_weather_first_hour_pin');
   if(publicSourcePin&&publicSourcePin.hourMinute!==(Math.floor(w.minute/60)+1)*60)throw Error('seasonal_public_weather_source_first_hour_pin');
   if(canonical){
    store=new WorldStore(owner.database,{allowMvpClimate:true,seasonalModel:true});
    binding=worldBinding();
    canonical.quota.seasonalResidentWorld(binding);
    w.schemaVersion=2;w.mvpSeasonalModelVersion=1;
    w.clock={...w.clock,paused:true,reason:'等待已绑定的离线合成决定'};
    // Native world and zero-request binding enter one world transaction. If
    // it fails, the earlier account binding stays spent; never rebind.
    store.commit(w,null,undefined,{schemaVersion:2,worldId:w.id,sharedAccountBinding:binding,
     nextSequence:1,lastWall:wall(),charges:[],requests:[]});
   }
  }
  let ledger:SeasonalLedger|null=store?.seasonalLedger(w)??inspected;
  let fault:string|null=null,budgetWaiting=false,dispatch:Promise<ModelReply>|null=null,controller:AbortController|null=null;
  const read=()=>({mode:'offline-seasonal' as const,driver:'synthetic-model-decisions' as const,
   liveModel:'blocked' as const,realModelCalls:0,account:policy.account,slots:policy.slots,
   ...(ledger?.schemaVersion===2?{sharedAdmission:canonical?'canonical-offline-residents' as const:'durable-offline' as const}:{}),
   paused:closed||!transport||!!fault||budgetWaiting||ledger?.requests.at(-1)?.state==='intent',
   status:closed?'closed':fault??(ledger?.requests.at(-1)?.state==='intent'?(dispatch?'awaiting-synthetic-response':'sent-unknown'):(budgetWaiting?'synthetic-budget-wait':transport?'ready':'no-synthetic-provider')),
   minute:w.minute,phases:w.residents.map(mvpPhase),
   requests:ledger?.requests.length??0,accepted:ledger?.requests.filter(r=>r.state==='accepted').length??0});
  if(options.port!==undefined){
   server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='GET'&&req.url==='/ai-town/api/seasonal-model'){res.end(JSON.stringify(read()));return;}
    res.writeHead(404);res.end('{}');
   });
   await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(options.port,'127.0.0.1',()=>{server!.off('error',reject);resolve();});});
  }
  const commit=(draft:World,next?:SeasonalLedger)=>{
   owner.assertOwned();modelWorld(draft);
   if(!store){store=new WorldStore(owner.database,{allowMvpClimate:true,seasonalModel:true});store.commit(w,null);}
   draft.revision=Math.max(w.revision+1,draft.revision);
   store.commit(draft,w.revision,undefined,next);
   w=draft;if(next)ledger=next;
   almanac?.observe(draft);
  };
  const assertCanonicalWorld=()=>{
   if(canonical&&(canonical.quota.seasonalResidentWorld()!==binding||worldBinding()!==binding))
    throw Error('seasonal_model_canonical_world_binding_changed');
  };
  const synchronizePriority=()=>{
   assertCanonicalWorld();
   if(shared)shared.setWorldWaiting(w.id,ledger?.requests.at(-1)?.state==='intent'||w.residents.some(r=>ready(w,r)));
  };
  const draftResidentPriority=()=>{
   synchronizePriority();
   return closed||!!fault||!!dispatch||ledger?.requests.at(-1)?.state==='intent'||w.residents.some(r=>ready(w,r));
  };
  if(shared&&binding&&!ledger){
   // Bind world with a zero-request manifest first so a crash before the
   // first dispatch cannot rotate the world/round identity or fall back.
   const bound=structuredClone(w);bound.schemaVersion=2;bound.mvpSeasonalModelVersion=1;
   bound.clock={...bound.clock,paused:true,reason:'等待已绑定的离线合成决定'};
   commit(bound,{schemaVersion:2,worldId:w.id,sharedAccountBinding:binding,nextSequence:1,lastWall:wall(),charges:[],requests:[]});
  }
  synchronizePriority();
  const topicContext=()=>{
   if(closed||!privateWeather||!privateWeatherSecond)return null;
   try{
    const early=privateWeather.authorized(),late=privateWeatherSecond.authorized();
    if(!early||!late||early.terms.schema===PUBLIC_SOURCE_PURPOSE||late.terms.schema===PUBLIC_SOURCE_PURPOSE||late.fact.worldRevision<=early.fact.worldRevision||
       late.observedAt<early.observedAt||!nativeWeatherPairCurrent(early.terms,late.terms,late.observedAt))return null;
    const {minute,condition,temperatureDeciC,relativeHumidityPermille}=late.fact;
    return {packet:nativeWeatherDraftPacket(early.terms,early.fact),topic:{
     firstGrantDigest:hash(early.terms),secondGrantDigest:hash(late.terms),
     late:{minute,condition,temperatureDeciC,relativeHumidityPermille},
    }};
   }catch{return null;}
  };
  if(weatherPin&&binding&&canonical)try{
   privateWeather=openSeasonalWeatherCustody(owner,w.id,binding,weatherPin,canonical.quota,assertCanonicalWorld,()=>w);
   if(topicsEnabled)privateWeatherSecond=openSeasonalWeatherCustody(owner,w.id,binding,{...weatherPin,hourMinute:weatherPin.hourMinute+60},
    canonical.quota,assertCanonicalWorld,()=>w,'private-second');
   if(draftEnabled||topicChoiceEnabled)weatherDraft=openNativeWeatherDraft(owner,canonical.quota,{binding,worldId:w.id,hour:weatherPin.hourMinute,
    signer:weatherPin.signer,guard:assertCanonicalWorld,currentRevision:()=>w.revision,
    packet:()=>privateWeather?.packet()??null,residentPriority:draftResidentPriority,now:wall,wire:weatherWire??topicTransport,topic:topicChoiceEnabled?topicContext:undefined});
  }catch{/* optional weather cannot alter resident/clock behavior */}
  if(publicSourcePin&&binding&&canonical)try{
   publicWeatherSource=openSeasonalWeatherCustody(owner,w.id,binding,publicSourcePin,canonical.quota,assertCanonicalWorld,()=>w,'public-source');
  }catch{/* optional disclosure is independent of private weather and residents */}
  if(publicResponsePin&&(publicResponseTransport||publicHeldTransport)&&publicWeatherSource&&binding&&canonical)try{
   weatherDraft=openNativeWeatherDraft(owner,canonical.quota,{binding,worldId:w.id,hour:publicResponsePin.hourMinute,
    signer:publicResponsePin.signer,guard:assertCanonicalWorld,currentRevision:()=>w.revision,
    packet:publicResponsePacket,residentPriority:draftResidentPriority,now:wall,wire:publicResponseTransport,heldHttp:publicHeldTransport,publicResponse:true});
  }catch{/* Optional response has no effect on world, source approval or resident progression. */}
  if(localWeatherEditorPin&&weatherDraft&&binding&&canonical)try{
   localWeatherEditorial=seasonalLocalWeatherEditorial.open(owner,canonical.quota,{
    worldId:w.id,binding,reviewer:localWeatherEditorPin.fingerprint,signer:localWeatherEditorPin.signer,
    guard:assertCanonicalWorld,revision:()=>w.revision,basis:localWeatherEditorialBasis,
   });
  }catch{/* Optional signed editorial custody does not affect world and quota. */}
  if(claimedAlmanac){
   // Unknown optional data isolates the almanac without altering resident
   // accounting, clock behavior, or the previous world commit.
   try{almanac=openSeasonalAlmanacFixture(owner,w,claimedAlmanac);}catch{claimedAlmanac.abort();}
  }
  const pump=async ()=>{
   if(closed||!transport||fault||dispatch||ledger?.requests.at(-1)?.state==='intent')return read();
   try{
    const now=wall();
    // Conservative during any synchronous world write and failures. Lower
    // optional priority pressure only after persisted world state says so.
    assertCanonicalWorld();
    if(canonical){
     const s=canonical.quota.summary(now);
     if(s.held||s.unknown)throw Error('seasonal_model_canonical_recovery_unresolved');
    }
    shared?.setWorldWaiting(w.id,true);
    if(ledger&&now<ledger.lastWall)throw Error('seasonal_model_wall_clock_reversal');
    const actor=w.residents.filter(r=>ready(w,r)).sort((a,b)=>a.decisionDue-b.decisionDue||a.id.localeCompare(b.id))[0];
    if(!actor){
     const before=w.minute,draft=structuredClone(w);
     draft.clock={...draft.clock,paused:false,reason:null};stepWorld(draft,1);commit(draft);
     privateWeather?.capture(before,draft);
     publicWeatherSource?.capture(before,draft);
     if(privateWeatherSecond&&draft.minute===weatherPin!.hourMinute+60&&privateWeather?.hasNativeFact())
      privateWeatherSecond.capture(before,draft);
     synchronizePriority();return read();
    }
    if((ledger?.requests.length??0)>=1000)throw Error('seasonal_model_request_limit');
    const context=seasonalModelContext(w,actor),prepared=prepareModelDecision(context,undefined,policy.model);
    if(prepared.choices.length>32)throw Error('seasonal_model_menu_limit');
    const payload=modelRequestPayload(policy.model,prepared.messages,0.25);
    const budget=new ModelBudget(policy.rpm,policy.tpm,ledger?.charges,now);
    const limits=modelLimits[policy.model];
    const charge=budget.reserve(now,prepared.inputBytes+512,limits.answerTokens+limits.thinkingTokens);
    budgetWaiting=!charge;if(!charge)return read();
    const base:SeasonalLedger=ledger?structuredClone(ledger):{schemaVersion:1,worldId:w.id,nextSequence:1,lastWall:now,charges:[],requests:[]};
    const request:SeasonalRequest={id:w.id+':seasonal-model:'+base.nextSequence++,actorId:actor.id,actorRevision:actor.revision,minute:w.minute,worldRevision:w.revision,at:now,contextVersion:MODEL_CONTEXT_VERSION,menuVersion:MODEL_MENU_VERSION,menuDigest:modelDigest(JSON.stringify(prepared.choices)),payload,digest:modelDigest(payload),state:'intent',finishedAt:null,usage:null};
    base.requests.push(request);base.lastWall=now;base.charges=budget.snapshot();
    const saveIntent=()=>{
     const waiting=structuredClone(w);waiting.schemaVersion=2;waiting.mvpSeasonalModelVersion=1;waiting.clock={...waiting.clock,paused:true,reason:'等待离线合成决定'};
     commit(waiting,base); // FULL SQLite world intent BEFORE memory dispatch
     return true;
    };
    const invoke=()=>{
     owner.assertOwned();
     controller=new AbortController();
     const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(150_000)]);
     dispatch=transport.invoke(Object.freeze({id:request.id,actorId:request.actorId,payload}),signal);
     return dispatch;
    };
    let reply:ModelReply;
    if(shared){
     const round:ResidentAccountRound={worldId:w.id,residentId:actor.id,roundId:request.id};
     shared.queue(round);
     const admitted=await shared.attempt({
      round,estimate:{inputTokens:charge.input,outputTokens:charge.output},
      authorize:()=>{owner.assertOwned();assertCanonicalWorld();return !closed;},
      beforeHandoff:saveIntent,
      simulate:async()=>{
       const result=await invoke();
       const counts=validateSyntheticReply(result);
       const usage=counts[0]!==undefined||counts[1]!==undefined?{inputTokens:counts[0]??charge.input,outputTokens:counts[1]??charge.output}:undefined;
       return {completion:'synthetic-complete' as const,result,usage};
      },
     });
     if(closed)return read();
     if(admitted.status!=='complete'){
      budgetWaiting=admitted.status==='deferred';
      if(!budgetWaiting)fault=ledger?.requests.at(-1)?.state==='intent'?'sent-unknown':'seasonal_model_shared_recovery_unresolved';
      return read();
     }
     reply=admitted.result;
    }else{saveIntent();reply=await invoke();}
    if(closed)return read(); // late reply cannot acknowledge a stopped process
    const finished=wall();if(finished<now)throw Error('seasonal_model_wall_clock_reversal');
    const counts=validateSyntheticReply(reply);
    const validUsage=typeof counts[0]==='number'||typeof counts[1]==='number'?{...(typeof counts[0]==='number'?{inputTokens:counts[0]}:{}),...(typeof counts[1]==='number'?{outputTokens:counts[1]}:{})}:null;
    finishSeasonalCharge(budget,charge,finished,validUsage);
    const draft=structuredClone(w),person=draft.residents.find(r=>r.id===request.actorId);
    let accepted=false;
    let decision:ReturnType<typeof parseModelCompletion>|undefined;
    try{decision=parseModelCompletion(context,prepared,reply,finished-now);}catch(error){if(!(error instanceof DecisionError))throw error;}
    if(decision&&person&&person.revision===request.actorRevision&&ready(draft,person)){
     const plan={id:request.id+':plan',actorId:person.id,actorRevision:person.revision,createdAt:draft.minute,definition:draft.activeDefinitions['action/routine']??'action/routine@1',intention:'离线合成决定',actions:decision.decision.actions};
     if(!draft.processed.includes('plan:'+plan.id)&&!planStartError(draft,plan))accepted=submitPlan(draft,plan).ok;
    }
    if(person&&!accepted){person.lastFailure='选择未成，请在现场复查。';person.decisionDue=draft.minute+1;}
    if(person&&accepted)person.lastDecisionAt=draft.minute;
    draft.clock={...draft.clock,paused:false,reason:null};
    const next=structuredClone(base),terminal=next.requests.at(-1)!;terminal.state=accepted?'accepted':'rejected';terminal.finishedAt=finished;terminal.usage=validUsage;
    next.lastWall=finished;next.charges=budget.snapshot();
    commit(draft,next); // accepted plan + terminal receipt + replay charge in same tx
    synchronizePriority();
   }catch{
    // If intent committed, unknown remains in durable storage. No retry or
    // fabricated usage on crash, failed storage, malformed wire or close.
    if(!closed)fault=ledger?.requests.at(-1)?.state==='intent'?'sent-unknown':'seasonal-model-stopped';
   }finally{dispatch=null;controller=null;}
   return read();
  };
  let closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{
   const dispatchWasLive=!!dispatch;
   closed=true;controller?.abort();try{localWeatherEditorial?.close();}catch{/* optional editor */}try{weatherDraft?.close();}catch{/* private draft */}try{publicWeatherSource?.close();}catch{/* optional public-source custody */}try{privateWeatherSecond?.close();}catch{/* optional topic annex */}try{privateWeather?.close();}catch{/* optional annex */}try{almanac?.close();}catch{/* isolate optional state */}
   try{
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
    let clearCanonicalDemand=false;
    if(canonical&&store&&!dispatchWasLive&&!fault&&ledger?.requests.at(-1)?.state!=='intent'){
     try{
      assertCanonicalWorld();
      const head=store.load(),liveLedger=head&&store.seasonalLedger(head);
      const s=canonical.quota.summary(wall());
      clearCanonicalDemand=!!head&&head.id===w.id&&head.revision===w.revision&&head.minute===w.minute&&
       JSON.stringify(liveLedger)===JSON.stringify(ledger)&&!s.held&&!s.unknown;
     }catch{/* Closed runtime cannot establish clean release; retain demand. */}
    }
    store?.close();
    if(clearCanonicalDemand&&canonical){
     try{
      assertCanonicalWorld();
      const s=canonical.quota.summary(wall());
      if(!s.held&&!s.unknown)canonical.admission.setWorldWaiting(w.id,false);
     }catch{/* Never replace ambiguous state with clean release. */}
    }
   }finally{try{owner.release();}finally{releaseQuota?.();}}
  })();
  const topicMenu=()=>{
   const basis=topicContext();return basis?topicOf(basis.packet,basis.topic):null;
  };
  function readPublicSource(){
   if(closed)return null;
   const value=publicWeatherSource?.authorized();
   if(!value||value.terms.schema!==PUBLIC_SOURCE_PURPOSE)return null;
   const now=wall();
   if(now<value.observedAt||now<value.terms.startsAt||now>=value.terms.expiresAt)return null;
   const {terms,fact,head}=value;
   const permissionVersion=terms.version,sourceRef=terms.worldId+'/'+publicWeatherEntryId(fact,permissionVersion);
   const source:ValleySpiritAlmanacWeatherSource=Object.freeze({sourceRef,permissionVersion,fact:Object.freeze({...fact})});
   return {terms,head,source};
  };
  function previewPublicationEligibility(){
   try{
    const basis=readPublicSource();
    if(!basis||basis.source.fact.minute>=Math.floor(basis.head.minute/60)*60)return null;
    const {source,terms,head}=basis;
    const worldId=terms.worldId,minute=source.fact.minute;
    const packet=createValleySpiritAlmanacPacket({worldId,fromMinute:minute,throughMinute:minute,sourceRefs:[source.sourceRef]},{
     permission:()=>null,resolve:()=>null,readCurrent:refs=>refs.length===1&&refs[0]===source.sourceRef?
      {worldId,permissionVersion:source.permissionVersion,records:[source]}:null,
    });
    if(packet){
     packet.points.forEach(Object.freeze);Object.freeze(packet.points);Object.freeze(packet.unselectedHourBuckets);Object.freeze(packet);
    }
    const reread=packet&&readPublicSource();
    return packet&&reread&&weatherDigest(reread)===weatherDigest(basis)?Object.freeze({
     status:'publication-eligibility-only' as const,publicationAuthorized:false as const,
     scope:'same-original-seasonal-public-source/v1' as const,headRevision:head.worldRevision,
     grantDigest:weatherDigest(terms),sourceDigest:terms.sourceDigest,packetDigest:weatherDigest(packet),packet,
    }):null;
   }catch{return null;}
  };
  function publicResponsePacket():PublicResponsePacket|null{
   const preview=previewPublicationEligibility(),basis=preview&&readPublicSource();
   if(!preview||!basis||basis.head.worldRevision!==preview.headRevision||weatherDigest(basis.terms)!==preview.grantDigest||
      basis.terms.sourceDigest!==preview.sourceDigest)return null;
   const {fact,sourceRef,permissionVersion}=basis.source;
   const {condition,temperatureDeciC,relativeHumidityPermille,cloudPermille,windPermille,daylightPermille,precipitationPermille}=fact;
   return Object.freeze({schemaVersion:1,mode:PUBLIC_PACKET_MODE,projectionVersion:1,worldId:basis.terms.worldId,
    sourceRef,sourceDigest:preview.sourceDigest,permitVersion:permissionVersion,observedMinute:fact.minute,condition,temperatureDeciC,
    relativeHumidityPermille,cloudPermille,windPermille,daylightPermille,precipitationPermille,
    grantDigest:preview.grantDigest,eligibilityPacketDigest:preview.packetDigest});
  }
  function localWeatherEditorialBasis(){
   const p=previewPublicationEligibility(),r=p&&weatherDraft?.readPublicResponse();
   if(!p||!r||p.grantDigest!==r.grantDigest||p.packetDigest!==r.eligibilityPacketDigest||p.headRevision!==w.revision)return null;
   return {grantDigest:p.grantDigest,packetDigest:p.packetDigest,responseDigest:r.responseDigest,
    packet:p.packet,field:r.fact.field,value:r.fact.value};
  }
  return {status:read,pump,close,server,
   async pumpAlmanac(){
    if(closed||!almanac)return {status:'disabled' as const};
    if(fault||dispatch||ledger?.requests.at(-1)?.state==='intent')return {status:'resident-unresolved' as const};
    if(w.residents.some(r=>ready(w,r)))return {status:'resident-priority' as const};
    return almanac.pump(w.minute);
   },
   latestAlmanac:()=>closed?null:almanac?.latest()??null,
   privateWeatherUseTerms:(allow:boolean,startsAt:number,expiresAt:number)=>closed?null:privateWeather?.terms(allow,startsAt,expiresAt)??null,
   recordPrivateWeatherUse:(approval:unknown)=>!closed&&(privateWeather?.record(approval)??false),
   readPrivateWeatherUse:()=>closed?null:privateWeather?.packet()??null,
   ...(publicSourcePin?{
    publicWeatherSourceTerms:(allow:boolean,startsAt:number,expiresAt:number)=>closed?null:publicWeatherSource?.terms(allow,startsAt,expiresAt)??null,
    encodePublicWeatherSourceTerms:encodeSeasonalPublicWeatherSourceTerms,
    recordPublicWeatherSource:(approval:unknown)=>!closed&&(publicWeatherSource?.record(approval)??false),
    readAuthorizedPublicWeatherSource:()=>{try{return readPublicSource()?.source??null;}catch{return null;}},
    previewPublicWeatherPublicationEligibility:previewPublicationEligibility,
   }:{}),
   ...(publicResponsePin?{
    previewPublicWeatherResponse:()=>closed?null:weatherDraft?.previewPublicResponse()??null,
    pumpPublicWeatherResponse:async(approval:unknown)=>{
     const result=closed?{status:'blocked' as const}:
      await (httpHeld?weatherDraft?.pumpHeldHttp(approval):weatherDraft?.pumpWire(approval,4))??{status:'blocked' as const};
     return httpHeld?{...result,liveAuthorized:false as const}:result;
    },
    readPublicWeatherResponse:()=>closed?null:weatherDraft?.readPublicResponse()??null,
   }:{}),
   ...(localWeatherEditorPin?{
    previewLocalWeatherEditorial:(action:'publish'|'revoke')=>closed?null:localWeatherEditorial?.preview(action)??null,
    encodeLocalWeatherEditorialTerms:seasonalLocalWeatherEditorial.encode,
    recordLocalWeatherEditorial:(signed:unknown)=>!closed&&(localWeatherEditorial?.record(signed)??false),
    latestLocalWeatherEdition:()=>closed?null:localWeatherEditorial?.latest()??null,
   }:{}),
   ...(topicsEnabled?{
    privateWeatherTopicSecondTerms:(allow:boolean,startsAt:number,expiresAt:number)=>closed?null:privateWeatherSecond?.terms(allow,startsAt,expiresAt)??null,
    recordPrivateWeatherTopicSecondUse:(approval:unknown)=>!closed&&(privateWeatherSecond?.record(approval)??false),
    readPrivateWeatherTopicMenu:topicMenu,
   }:{}),
   ...(topicChoiceEnabled?{
    previewPrivateWeatherTopicChoice:()=>closed?null:weatherDraft?.previewTopic()??null,
    pumpPrivateWeatherTopicChoice:async(approved:unknown)=>closed?{status:'blocked' as const}:
     await weatherDraft?.pumpWire(approved,3)??{status:'blocked' as const},
    readPrivateWeatherTopicChoice:()=>closed?null:weatherDraft?.readPrivateTopic()??null,
   }:{}),
   ...(draftEnabled?{
    privateWeatherDraftTerms:()=>closed?null:weatherDraft?.terms()??null,
    ...(wireEnabled?{pumpPrivateWeatherWireDraft:async(approved:unknown)=>closed?{status:'blocked' as const}:
     await weatherDraft?.pumpWire(approved)??{status:'blocked' as const}}:
     {pumpPrivateWeatherDraft:(approved:unknown)=>closed?{status:'blocked' as const}:weatherDraft?.pump(approved)??{status:'blocked' as const}}),
    readPrivateWeatherDraft:()=>closed?null:weatherDraft?.readPrivateDraft()??null,
   }:{}),
   setAlmanacPublicWeatherAllowed:(allowed:boolean)=>!closed&&(almanac?.setPublicWeatherAllowed(allowed)??false),
  };
 }catch(error){try{localWeatherEditorial?.close();}catch{/* optional editor */}try{weatherDraft?.close();}catch{/* private draft */}try{publicWeatherSource?.close();}catch{/* optional public-source custody */}try{privateWeatherSecond?.close();}catch{/* optional topic annex */}try{privateWeather?.close();}catch{/* optional annex */}try{almanac?.close();}catch{/* optional state */}try{if(server?.listening){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}store?.close();}finally{try{owner.release();}finally{releaseQuota?.();}}throw error;}
}
