import {claimSeasonalAlmanacFixture,openSeasonalAlmanacFixture,type SeasonalAlmanacFixture} from './seasonal-almanac-runtime.js';
import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {nativeWeatherHourTransition} from './valley-spirit-weather-credit.js';
import {publicWeatherProjection,validPublicWeatherFact,type PublicWeatherFact} from './valley-spirit.js';
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
import {claimSeasonalWeatherMemoryTransport,groundSeasonalWeatherWireReply,seasonalWeatherWireRequest,
 SEASONAL_WEATHER_WIRE_REPLY_BYTES,validSeasonalWeatherWireDraft,type SeasonalWeatherMemoryTransport} from './valley-spirit-seasonal-weather-wire.js';
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
type SeasonalPrivateWeatherPin=Readonly<{mode:'explicit-private-seasonal-weather-use';hourMinute:number;reviewerPublicKeyPem:string}>;
function pinSeasonalWeather(v:unknown){
 if(!exact(v,['mode','hourMinute','reviewerPublicKeyPem'])||v.mode!=='explicit-private-seasonal-weather-use'||!hour(v.hourMinute)||
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
type SignedPermit={terms:SeasonalPrivateWeatherTerms;signature:string};
export function encodeSeasonalPrivateWeatherTerms(v:unknown):Buffer|null{
 if(!exact(v,permitKeys)||(v.schema!==WEATHER_PURPOSE&&v.schema!==SECOND_WEATHER_PURPOSE)||!hex(v.binding)||
    typeof v.worldId!=='string'||!/^godot-mvp-[a-f0-9-]{36}$/.test(v.worldId)||!hour(v.hourMinute)||!hex(v.sourceDigest)||
    !finiteInteger(v.priorVersion)||!finiteInteger(v.version)||v.version!==v.priorVersion+1||v.version>WEATHER_LIMIT||
    typeof v.allow!=='boolean'||!finiteInteger(v.startsAt)||!finiteInteger(v.expiresAt)||
    v.expiresAt<=v.startsAt||v.expiresAt-v.startsAt>WEATHER_WALL_WINDOW)return null;
 return Buffer.from(JSON.stringify([v.schema===WEATHER_PURPOSE?'offline-seasonal-native-hour-prepare-only':
  'offline-seasonal-second-native-hour-topic-prepare-only',...permitKeys.map(k=>v[k])]));
}
/** Module-private: only the genuine seasonal postcommit hook can capture.
 * This annex is deliberately not the authoritative world transaction. */
function openSeasonalPrivateWeather(owner:RuntimeOwnership,worldId:string,binding:string,pin:ReturnType<typeof pinSeasonalWeather>,quota:ProductionAccountQuotaRehearsal,
 assertCanonical:()=>void,current:()=>Pick<World,'id'|'revision'|'minute'>,secondSlot=false){
 const tableName=secondSlot?SECOND_WEATHER_TABLE:WEATHER_TABLE;
 const ddl=secondSlot?WEATHER_SQL.replace(WEATHER_TABLE,tableName):WEATHER_SQL;
 const purpose=secondSlot?SECOND_WEATHER_PURPOSE:WEATHER_PURPOSE;
 const registry=secondSlot?quota.seasonalPrivateWeatherTopicSecondAnchor:quota.seasonalPrivateWeatherAnchor;
 const db=new DatabaseSync(owner.database);
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');}catch(e){db.close();throw e;}
 let isolated=false,closed=false,seen:WeatherState|null=null,lastWall=-1;
 type WeatherState={schemaVersion:1;binding:string;fact:PublicWeatherFact;history:SignedPermit[]};
 const sourceDigest=(fact:PublicWeatherFact)=>weatherDigest([purpose,binding,fact]);
 const checked=(u:unknown):SignedPermit|null=>{
  if(!exact(u,['terms','signature'])||typeof u.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(u.signature)||
     !exact(u.terms,permitKeys))return null;
  const body=encodeSeasonalPrivateWeatherTerms(u.terms),sig=Buffer.from(u.signature,'base64url');
  if(!body||sig.length!==64||sig.toString('base64url')!==u.signature||!verify(null,body,pin.signer,sig))return null;
  return {terms:Object.fromEntries(permitKeys.map(k=>[k,(u.terms as Record<string,unknown>)[k]])) as unknown as SeasonalPrivateWeatherTerms,signature:u.signature};
 };
 const next=(s:WeatherState,t:SeasonalPrivateWeatherTerms)=>{
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
 const authorized=()=>operate(false,(_h,s,now)=>{
  const t=s?.history.at(-1)?.terms;
  if(!s||!t?.allow||now<t.startsAt||now>=t.expiresAt)return {result:null};
  return {result:{terms:t,fact:s.fact,observedAt:now}};
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
    const t:SeasonalPrivateWeatherTerms={schema:purpose,binding,worldId,hourMinute:pin.hourMinute,
     sourceDigest:sourceDigest(s.fact),priorVersion:s.history.length,version:s.history.length+1,allow,startsAt,expiresAt};
    return {result:encodeSeasonalPrivateWeatherTerms(t)&&next(s,t)?Object.freeze(t):null};
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
  packet(){
   const allowed=authorized();if(!allowed)return null;
   const {terms:t,fact}=allowed;
   const {condition,temperatureDeciC,relativeHumidityPermille,cloudPermille,windPermille,daylightPermille,precipitationPermille}=fact;
   return Object.freeze({schemaVersion:1 as const,mode:'private-seasonal-weather-prepare-only' as const,
    projectionVersion:1 as const,worldId,sourceRef:worldId+'/seasonal-hour-'+pin.hourMinute,
    sourceDigest:t.sourceDigest,permitVersion:t.version,observedMinute:pin.hourMinute,
    condition,temperatureDeciC,relativeHumidityPermille,cloudPermille,windPermille,daylightPermille,precipitationPermille});
  },
  close(){if(!closed){closed=true;db.close();}}
 };
}

/** Separate bounded seasonal mode. Caller explicitly pumps the server; the
 * normal rules runner and all pre-existing model entry points stay unchanged. */
const NATIVE_DRAFT_PROFILE='private-canonical-seasonal-weather-draft/v1' as const;
const WIRE_DRAFT_PROFILE='private-canonical-seasonal-weather-wire-draft/v1' as const;
const TABLE='seasonal_native_private_weather_draft';
const DDL='CREATE TABLE seasonal_native_private_weather_draft(singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1), body TEXT NOT NULL)';
const bytesMax=8192, outputBound=96;
const conditions={sun:'晴',cloud:'阴',rain:'雨',snow:'雪',mixed:'雨雪混合'} as const;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const int=(v:unknown,lo=0,hi=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const keys=['schemaVersion','mode','projectionVersion','worldId','sourceRef','sourceDigest','permitVersion','observedMinute',
 'condition','temperatureDeciC','relativeHumidityPermille','cloudPermille','windPermille','daylightPermille','precipitationPermille'] as const;
type NativeWeatherDraftPacket=Readonly<{schemaVersion:1;mode:'private-seasonal-weather-prepare-only';projectionVersion:1;
 worldId:string;sourceRef:string;sourceDigest:string;permitVersion:number;observedMinute:number;condition:keyof typeof conditions;
 temperatureDeciC:number;relativeHumidityPermille:number;cloudPermille:number;windPermille:number;daylightPermille:number;precipitationPermille:number;}>;
export interface NativeWeatherDraftTerms {schema:typeof NATIVE_DRAFT_PROFILE;binding:string;worldId:string;requestId:string;
 packetDigest:string;permitVersion:number;}
type NativeWeatherWireDraftTerms=Omit<NativeWeatherDraftTerms,'schema'>&{schema:typeof WIRE_DRAFT_PROFILE;wireDigest:string;};
const termsKeys=['schema','binding','worldId','requestId','packetDigest','permitVersion'] as const;
const wireKeys=[...termsKeys,'wireDigest'] as const;
const requestPattern=/^seasonal-private-almanac-[a-f0-9]{64}$/;
export function encodeNativeWeatherDraftTerms(t:unknown):Buffer|null {
 const wire=exact(t,wireKeys)&&t.schema===WIRE_DRAFT_PROFILE&&hex(t.wireDigest);
 if(!(wire||exact(t,termsKeys)&&t.schema===NATIVE_DRAFT_PROFILE)||!hex(t.binding)||!hex(t.packetDigest)||
  typeof t.worldId!=='string'||!/^godot-mvp-[a-f0-9-]{36}$/.test(t.worldId)||typeof t.requestId!=='string'||
  !requestPattern.test(t.requestId)||!int(t.permitVersion,1,32))return null;
 return Buffer.from(JSON.stringify([wire?'explicit-versioned-memory-weather-claims-no-publication':'explicit-compiled-offline-claim-no-publication',
  ...(wire?wireKeys:termsKeys).map(k=>t[k])]));
}
type Approval={terms:NativeWeatherDraftTerms|NativeWeatherWireDraftTerms;signature:string;};
type Proof=NonNullable<ReturnType<ProductionAccountQuotaRehearsal['proveOfflineAlmanacCompletion']>>;
type Usage={at:number;inputTokens:number;outputTokens:number;proof:Proof;};
const compose=(p:NativeWeatherDraftPacket)=>Object.freeze({observedMinute:p.observedMinute,
 field:'condition' as const,value:p.condition,text:`第 ${p.observedMinute} 游戏分钟，天气：${conditions[p.condition]}`});
type WeatherDraftFact=ReturnType<typeof compose>|NonNullable<ReturnType<typeof groundSeasonalWeatherWireReply>>;
type State={schemaVersion:1|2;sequence:number;approval:Approval;packet:NativeWeatherDraftPacket;
 phase:'intent'|'sent-unknown'|'not-dispatched'|'grounded'|'settled-hidden';settlement:Usage|null;draft:WeatherDraftFact|null;};

function validPacket(p:unknown,worldId:string,hour:number):p is NativeWeatherDraftPacket{
 return exact(p,keys)&&p.schemaVersion===1&&p.mode==='private-seasonal-weather-prepare-only'&&p.projectionVersion===1&&
  p.worldId===worldId&&p.observedMinute===hour&&p.sourceRef===worldId+'/seasonal-hour-'+hour&&hex(p.sourceDigest)&&
  int(p.permitVersion,1,32)&&typeof p.condition==='string'&&Object.hasOwn(conditions,p.condition)&&
  int(p.temperatureDeciC,-300,450)&&keys.slice(10).every(key=>int(p[key],0,1000));
}
/** Operator-only attachment to the current world and permit. A single local
 * treatment uses either the compiled claim or a claimed data-only adapter. */
function openNativeWeatherDraft(owner:RuntimeOwnership,quota:ProductionAccountQuotaRehearsal,opts:{
 binding:string;worldId:string;hour:number;signer:KeyObject;guard:()=>void;currentRevision:()=>number;
 packet:()=>NativeWeatherDraftPacket|null;residentPriority:()=>boolean;now:()=>number;
 wire?:ReturnType<typeof claimSeasonalWeatherMemoryTransport>;
}){
 const {binding,worldId,hour,signer,guard,currentRevision,residentPriority,now}=opts;
 // The compiled and versioned-wire treatments cannot both spend the same
 // approved source opportunity. Keep the existing request ID and anchor.
 const draftVersion=opts.wire?2:1;
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
  return {terms:Object.fromEntries((t.schema===WIRE_DRAFT_PROFILE?wireKeys:termsKeys).map(k=>[k,(t as unknown as Record<string,unknown>)[k]])) as unknown as Approval['terms'],signature:x.signature};
 };
 const current=()=>{const p=opts.packet();return validPacket(p,worldId,hour)?p:null;};
 const termsFor=(p:NativeWeatherDraftPacket,version:State['schemaVersion']=draftVersion):Approval['terms']=>{
  const base={binding,worldId,requestId,packetDigest:hash(p),permitVersion:p.permitVersion};
  return version===1?{schema:NATIVE_DRAFT_PROFILE,...base}:{schema:WIRE_DRAFT_PROFILE,...base,wireDigest:seasonalWeatherWireRequest(p).digest};
 };
 const active=(s:State)=>{
  guard();
  const p=current();
  return !!p&&p.permitVersion===s.packet.permitVersion&&hash(p)===s.approval.terms.packetDigest;
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
  if(!exact(u,['schemaVersion','sequence','approval','packet','phase','settlement','draft'])||(u.schemaVersion!==1&&u.schemaVersion!==2)||
   !int(u.sequence,1,3)||!validPacket(u.packet,worldId,hour)||typeof u.phase!=='string'||!['intent','sent-unknown','not-dispatched','grounded','settled-hidden'].includes(u.phase)||
   u.phase==='intent'&&u.sequence!==1||u.phase==='sent-unknown'&&u.sequence!==2||
   (u.phase==='grounded'||u.phase==='settled-hidden')&&u.sequence!==3||u.phase==='not-dispatched'&&u.sequence<2)
   throw Error('seasonal_weather_draft_state');
  const a=approval(u.approval);
  if(!a||hash(a.terms)!==hash(termsFor(u.packet,u.schemaVersion)))throw Error('seasonal_weather_draft_permit');
  if(u.phase==='grounded'?(u.schemaVersion===1?hash(u.draft)!==hash(compose(u.packet)):!validSeasonalWeatherWireDraft(u.packet,u.draft)):u.draft!==null)
   throw Error('seasonal_weather_draft_shape');
  const p=u.settlement;
  if(u.phase==='grounded'||u.phase==='settled-hidden'){
   if(!exact(p,['at','inputTokens','outputTokens','proof'])||!int(p.at)||!int(p.inputTokens,1)||!int(p.outputTokens,u.schemaVersion===1?1:0,u.schemaVersion===1?outputBound:SEASONAL_WEATHER_WIRE_REPLY_BYTES)||
    (u.schemaVersion===2&&p.inputTokens!==Buffer.byteLength(seasonalWeatherWireRequest(u.packet).bytes))||
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
  const a=approval(structuredClone(input)),p=current();
  if(!a||!p||hash(a.terms)!==hash(termsFor(p,version)))return {status:'unapproved' as const};
  const wait=eligible();if(wait)return {status:wait};
  let row=put(null,{schemaVersion:version,approval:a,packet:p,phase:'intent',settlement:null,draft:null});
  const suppress=()=>{put(row,{...row.state,phase:'not-dispatched'});return {status:'not-dispatched' as const};};
  if(!active(row.state)||eligible())return suppress();
  const wire=version===2?seasonalWeatherWireRequest(p):null;
  const inputTokens=Buffer.byteLength(wire?.bytes??JSON.stringify(p));
  const reserved=quota.reserve({requestId,purpose:'valley-spirit-almanac',inputTokens,
   outputTokens:wire?SEASONAL_WEATHER_WIRE_REPLY_BYTES:outputBound},now());
  if(reserved.status!=='reserved')return reserved.status==='duplicate'?blocked:suppress();
  if(!active(row.state)||residentPriority())return quota.cancelProvenUnsent(requestId,now())?suppress():blocked;
  row=put(row,{...row.state,phase:'sent-unknown'});
  if(!active(row.state)||residentPriority())return quota.cancelProvenUnsent(requestId,now())?suppress():blocked;
  if(!quota.markHandoff(requestId,now())||!active(row.state)||residentPriority())return blocked;
  return {row,p,wire,inputTokens};
 };
 const complete=(row:ReturnType<typeof put>,inputTokens:number,outputTokens:number,result:WeatherDraftFact|null)=>{
  if(closed||isolated||state()?.raw!==row.raw||account()!=='sent-unknown')return blocked;
  const at=now();
  if(!quota.confirmCompletion(requestId,at,{inputTokens,outputTokens}))return blocked;
  const proof=quota.proveOfflineAlmanacCompletion(requestId,at,inputTokens,outputTokens);
  if(!proof)return blocked;
  const visible=!!result&&active(row.state)&&(!opts.wire||!residentPriority());
  put(row,{...row.state,phase:visible?'grounded':'settled-hidden',settlement:{at,inputTokens,outputTokens,proof},draft:visible?result:null});
  return {status:visible?'private-draft-grounded' as const:result?'not-current' as const:'invalid-response' as const};
 };
 return Object.freeze({
  terms(){
   if(closed||isolated)return null;
   try{if(state())return null;const p=current();return p?Object.freeze(termsFor(p)):null;}
   catch{isolated=true;return null;}
  },
  pump(input:unknown){
   try{
    const s=start(input,1);if('status' in s)return s;
    const result=compose(s.p);
    return complete(s.row,s.inputTokens,Buffer.byteLength(JSON.stringify([result.field,result.value])),result);
   }catch{isolated=true;return blocked;}
  },
  async pumpWire(input:unknown){
   try{
    if(!opts.wire)return blocked;
    const s=start(input,2);
    if('status' in s)return s;
    if(!s.wire||s.wire.digest!==(s.row.state.approval.terms as NativeWeatherWireDraftTerms).wireDigest)return blocked;
    const raw=await opts.wire(s.wire.bytes,abort.signal);
    if(typeof raw!=='string'||raw.length>SEASONAL_WEATHER_WIRE_REPLY_BYTES)return blocked;
    const size=Buffer.byteLength(raw);
    if(size>SEASONAL_WEATHER_WIRE_REPLY_BYTES)return blocked;
    return complete(s.row,s.inputTokens,size,groundSeasonalWeatherWireReply(s.p,raw));
   }catch{if(!closed)isolated=true;return blocked;}
  },
  readPrivateDraft(){
   if(closed||isolated)return null;
   try{
    const row=state(),q=quota.summary(now());
    return row?.state.phase==='grounded'&&row.state.schemaVersion===draftVersion&&!q.held&&!q.unknown&&active(row.state)?
     Object.freeze({status:'private-synthetic-weather-draft' as const,rendererVersion:1 as const,fact:Object.freeze({...row.state.draft!})}):null;
   }catch{isolated=true;return null;}
  },
  close(){if(!closed){closed=true;abort.abort();db.close();}}
 });
}

export async function startOfflineSeasonalModel(options:{mode:'offline-seasonal';database:string;port?:number;transport?:MemoryTransport;sharedAccount?:OfflineResidentAccountAdmission;almanacFixture?:SeasonalAlmanacFixture;canonicalResidentQuota?:Readonly<CanonicalSeasonalQuota>;privateWeatherUse?:SeasonalPrivateWeatherPin;privateWeatherDraft?:true;privateWeatherWire?:SeasonalWeatherMemoryTransport;privateWeatherTopics?:typeof TOPIC_MODE}){
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
 let privateWeather:ReturnType<typeof openSeasonalPrivateWeather>|undefined;
 let privateWeatherSecond:ReturnType<typeof openSeasonalPrivateWeather>|undefined;
 let weatherDraft:ReturnType<typeof openNativeWeatherDraft>|undefined;
 const worldBinding=()=>{
  owner.assertOwned();
  const f=lstatSync(owner.database,{bigint:true});
  if(!f.isFile()||f.isSymbolicLink()||f.nlink!==1n)throw Error('seasonal_model_canonical_world_file');
  return weatherDigest(['seasonal-runtime-world/v1',canonical!.binding,canonical!.worldId,String(f.dev),String(f.ino),
   ...(weatherPin?[WEATHER_PURPOSE,weatherPin.fingerprint,weatherPin.hourMinute]:[]),...(draftEnabled?[NATIVE_DRAFT_PROFILE]:[]),...(topicsEnabled?[TOPIC_MODE,weatherPin!.hourMinute+60]:[])]);
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
  if(weatherPin&&binding&&canonical)try{
   privateWeather=openSeasonalPrivateWeather(owner,w.id,binding,weatherPin,canonical.quota,assertCanonicalWorld,()=>w);
   if(topicsEnabled)privateWeatherSecond=openSeasonalPrivateWeather(owner,w.id,binding,{...weatherPin,hourMinute:weatherPin.hourMinute+60},
    canonical.quota,assertCanonicalWorld,()=>w,true);
   if(draftEnabled)weatherDraft=openNativeWeatherDraft(owner,canonical.quota,{binding,worldId:w.id,hour:weatherPin.hourMinute,
    signer:weatherPin.signer,guard:assertCanonicalWorld,currentRevision:()=>w.revision,
    packet:()=>privateWeather?.packet()??null,residentPriority:draftResidentPriority,now:wall,wire:weatherWire});
  }catch{/* optional weather cannot alter resident/clock behavior */}
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
   closed=true;controller?.abort();try{weatherDraft?.close();}catch{/* private draft */}try{privateWeatherSecond?.close();}catch{/* optional topic annex */}try{privateWeather?.close();}catch{/* optional annex */}try{almanac?.close();}catch{/* isolate optional state */}
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
   if(closed||!privateWeather||!privateWeatherSecond)return null;
   try{
    const early=privateWeather.authorized(),late=privateWeatherSecond.authorized();
    if(!early||!late||late.fact.worldRevision<=early.fact.worldRevision||
       (late.observedAt<early.observedAt||!nativeWeatherPairCurrent(early.terms,late.terms,late.observedAt)))return null;
    return nativeSeasonalWeatherPairMenu(early.fact,late.fact);
   }catch{return null;}
  };
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
   ...(topicsEnabled?{
    privateWeatherTopicSecondTerms:(allow:boolean,startsAt:number,expiresAt:number)=>closed?null:privateWeatherSecond?.terms(allow,startsAt,expiresAt)??null,
    recordPrivateWeatherTopicSecondUse:(approval:unknown)=>!closed&&(privateWeatherSecond?.record(approval)??false),
    readPrivateWeatherTopicMenu:topicMenu,
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
 }catch(error){try{weatherDraft?.close();}catch{/* private draft */}try{privateWeatherSecond?.close();}catch{/* optional topic annex */}try{privateWeather?.close();}catch{/* optional annex */}try{almanac?.close();}catch{/* optional state */}try{if(server?.listening){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}store?.close();}finally{try{owner.release();}finally{releaseQuota?.();}}throw error;}
}
