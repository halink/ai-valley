import {createHash} from 'node:crypto';
import {openPrivateNativeWeatherPacketReaderOnOwner} from './valley-spirit-native-weather-packet.js';
import {openPrivateWeatherRehearsalStore} from './valley-spirit-private-weather-store.js';
import {openDisconnectedWeatherUseGrant} from './valley-spirit-weather-use-grant.js';
import {isProductionAccountQuotaRehearsal,type ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import type {SharedModelAccountPolicy} from './shared-model-account.js';
import {ValleySpiritAlmanac,syntheticAlmanacProvenUnsent,syntheticValleySpiritAlmanacAdmission,
 validateValleySpiritAlmanacEntries,type ValleySpiritAlmanacEntry,type ValleySpiritAlmanacPacket,type ValleySpiritAlmanacRange} from './valley-spirit-almanac.js';

type Range=Omit<ValleySpiritAlmanacRange,'worldId'>;
type Packet=Readonly<ValleySpiritAlmanacPacket>;
type Outcome='proven-unsent'|'settled-synthetic'|'unresolved';
type Witness=Readonly<{packet:Packet;entryId?:string;digest:string;grantVersion:number;weatherPermissionVersion:number}>;
interface Call {witness:Witness;finish:(success:boolean)=>void;}
interface MemoryState {attached:boolean;calls:Call[]}
interface MemoryTransport {
 requests():readonly Witness[];
 complete(i:number):void;
 lose(i:number):void;
}
const memory=new WeakMap<MemoryTransport,MemoryState>();
const MAX_CALLS=32,OUTPUT_BUDGET=64,INPUT_OVERHEAD=256;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');

/** Compiled-in memory only: no callback, endpoint, signing capability, or I/O. */
export function createDisconnectedWeatherMemory():MemoryTransport {
 const state:MemoryState={attached:false,calls:[]};
 const handle:MemoryTransport=Object.freeze({
  requests:()=>state.calls.map(c=>c.witness),
  complete(i:number){state.calls[i]?.finish(true);},
  lose(i:number){state.calls[i]?.finish(false);}
 });
 memory.set(handle,state);return handle;
}

/** Explicit standalone rehearsal only. Resident candidate may share this exact
 * branded quota object; this does not attach either lane to a production run. */
export function openDisconnectedWeatherRehearsal(owner:DeveloperMvpSpiritFixtureOwner,
 quota:ProductionAccountQuotaRehearsal,worldId:string,policy:SharedModelAccountPolicy,transport:MemoryTransport,options?:Readonly<{storage:'durable-private'}>){
 if(options!==undefined&&(options.storage!=='durable-private'||Object.keys(options).length!==1))throw Error('private_weather_store_option');
 const state=memory.get(transport);
 if(!state||state.attached||!isProductionAccountQuotaRehearsal(quota))
  throw Error('disconnected_weather_rehearsal_capability');
 const grant=openDisconnectedWeatherUseGrant(owner,quota,worldId,policy);
 let reader:ReturnType<typeof openPrivateNativeWeatherPacketReaderOnOwner>;
 try{reader=openPrivateNativeWeatherPacketReaderOnOwner(owner,worldId);}
 catch(e){grant.close();throw e;}
 let durable:ReturnType<typeof openPrivateWeatherRehearsalStore>|undefined;
 try{if(options)durable=openPrivateWeatherRehearsalStore(owner,grant.context);}
 catch(e){try{reader.close();}finally{grant.close();}throw e;}
 state.attached=true;
 let closed=false,active=false,uncertain=false,abort:(()=>void)|undefined;
 let sandbox:ValleySpiritAlmanacEntry[]=[];
 const almanac=new ValleySpiritAlmanac(durable??{
  read:()=>structuredClone(sandbox),
  replace(previous,next){
   if(next.length>MAX_CALLS||!validateValleySpiritAlmanacEntries(next)||
    JSON.stringify(previous)!==JSON.stringify(sandbox))return false;
   sandbox=structuredClone([...next]);return true;
  }
 },reader.almanacAuthority);
 const hold=(selection:Range,expected:string,entryId?:string)=>{
  if(closed||active||uncertain||state.calls.length>=MAX_CALLS)return null;
  const authorized=grant.active(),packet=reader.packet(selection),at=Date.now();
  if(!authorized||!packet||packet.permissionVersion!==authorized.weatherPermissionVersion)return null;
  const bytes=JSON.stringify(packet),hash=digest(bytes),inputTokens=Buffer.byteLength(bytes)+INPUT_OVERHEAD;
  if(hash!==expected)return null;
  const summary=quota.summary(at);
  if(summary.waitingResidents||summary.unknown)return null;
  // Stable canonical reservation key prevents another entry or renewed grant
  // resending the exact packet. The held closure separately binds the entry.
  const id='weather-rehearsal-'+hash;
  if(quota.reserve({requestId:id,purpose:'valley-spirit-almanac',inputTokens,outputTokens:OUTPUT_BUDGET},at).status!=='reserved')
   return null;
  active=true;
  let started=false,attempted=false,finished=false;
  const finishUnsent=()=>{
   if(finished||attempted)return false;
   finished=true;active=false;
   try{return quota.cancelProvenUnsent(id,Date.now());}catch{return false;}
  };
  const send=async(candidate:Packet,authorizeDelivery:()=>boolean):Promise<Packet|typeof syntheticAlmanacProvenUnsent>=>{
   if(finished||started)throw Error('disconnected_weather_hold_consumed');
   started=true;
   try{
    // No database transaction across either yield.
    await Promise.resolve();
    const exact=reader.packet(selection),last=grant.active(),now=Date.now();
    if(closed||!exact||!last||last.version!==authorized.version||
     last.weatherPermissionVersion!==authorized.weatherPermissionVersion||exact.permissionVersion!==last.weatherPermissionVersion||
     digest(JSON.stringify(exact))!==hash||digest(JSON.stringify(candidate))!==hash||
     now>=last.expiresAt||quota.summary(now).waitingResidents||!authorizeDelivery()){
     if(!finishUnsent())throw Error('disconnected_weather_cancel_unconfirmed');
     return syntheticAlmanacProvenUnsent;
    }
    attempted=true;
    if(!quota.markHandoff(id,Date.now()))throw Error('rehearsal_handoff_unconfirmed');
    if(Date.now()>=last.expiresAt)throw Error('rehearsal_expired_at_handoff');
    const ok=await new Promise<boolean>(resolve=>{
     let resolved=false;
     const complete=(success:boolean)=>{if(!resolved){resolved=true;abort=undefined;resolve(success);}};
     abort=()=>complete(false);
     state.calls.push({witness:Object.freeze({packet:exact,...entryId?{entryId}:{},digest:hash,grantVersion:last.version,
      weatherPermissionVersion:last.weatherPermissionVersion}),finish:complete});
    });
    if(!ok||closed||!quota.confirmCompletion(id,Date.now(),{inputTokens,outputTokens:1}))
     throw Error('rehearsal_completion_unconfirmed');
    return exact;
   }catch(e){
    if(attempted)uncertain=true;
    throw e;
   }finally{
    if(!attempted&&!finished)finishUnsent();
    finished=true;active=false;
   }
  };
  return {packet,send,cancelUnsent(){if(!started)finishUnsent();}};
 };
 return Object.freeze({
  context:grant.context,
  recordGrant:grant.record,
  async rehearse(range:Range):Promise<Outcome>{
   // A durable rehearsal must stage all sends through its edition CAS.
   if(durable||closed||active||uncertain)return 'proven-unsent';
   try{
    const selection=structuredClone(range),packet=reader.packet(selection);
    if(!packet)return 'proven-unsent';
    const held=hold(selection,digest(JSON.stringify(packet)));
    if(!held)return 'proven-unsent';
    const settled=await held.send(held.packet,()=>true);
    return settled===syntheticAlmanacProvenUnsent?'proven-unsent':'settled-synthetic';
   }catch{return uncertain?'unresolved':'proven-unsent';}
  },
  /** Private in-memory edition state; exposes no publish/read API or arbitrary
   * response. The deterministic selector runs only after confirmed settlement. */
  async groundEdition(range:Range){
   if(closed||active||uncertain)return null;
   try{
    const selection=structuredClone(range),packet=reader.packet(selection);
    if(!packet)return null;
    const bytes=JSON.stringify(packet),expected=digest(bytes);
    const admission=syntheticValleySpiritAlmanacAdmission(async request=>{
     if(request.purpose!=='valley-spirit-almanac'||request.promptVersion!==1||
      request.packetBytes!==Buffer.byteLength(bytes)||!/^valley-almanac-[a-f0-9]{64}$/.test(request.requestId))return null;
     const held=hold(selection,expected,request.requestId);
     if(!held)return null;
     return {cancelUnsent:held.cancelUnsent,async send(sent,authorize){
      const settled=await held.send(sent,authorize);
      if(settled===syntheticAlmanacProvenUnsent)return settled;
      return {claims:settled.points.map(p=>({sourceRef:p.sourceRef,field:'condition',value:p.condition})),
       atmosphere:'plain',wording:'time-first'};
     }};
    });
    return await almanac.generate({...selection,worldId},admission);
   }catch{return null;}
  },
  editionStatus(range:Pick<Range,'fromMinute'|'throughMinute'>){
   return closed?{status:'unavailable' as const}:almanac.schedulingState({...range,worldId});
  },
  close(){if(!closed){closed=true;abort?.();try{reader.close();}finally{try{grant.close();}finally{durable?.close();}}}}
 });
}
