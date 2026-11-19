import {createHash} from 'node:crypto';
import {openPrivateNativeWeatherPacketReaderOnOwner} from './valley-spirit-native-weather-packet.js';
import {openDisconnectedWeatherUseGrant} from './valley-spirit-weather-use-grant.js';
import {isProductionAccountQuotaRehearsal,type ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
import type {SharedModelAccountPolicy} from './shared-model-account.js';
import type {ValleySpiritAlmanacPacket,ValleySpiritAlmanacRange} from './valley-spirit-almanac.js';

type Range=Omit<ValleySpiritAlmanacRange,'worldId'>;
type Packet=Readonly<ValleySpiritAlmanacPacket>;
type Outcome='proven-unsent'|'settled-synthetic'|'unresolved';
type Witness=Readonly<{packet:Packet;digest:string;grantVersion:number;weatherPermissionVersion:number}>;
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
 quota:ProductionAccountQuotaRehearsal,worldId:string,policy:SharedModelAccountPolicy,transport:MemoryTransport){
 const state=memory.get(transport);
 if(!state||state.attached||!isProductionAccountQuotaRehearsal(quota))
  throw Error('disconnected_weather_rehearsal_capability');
 const grant=openDisconnectedWeatherUseGrant(owner,quota,worldId,policy);
 let reader:ReturnType<typeof openPrivateNativeWeatherPacketReaderOnOwner>;
 try{reader=openPrivateNativeWeatherPacketReaderOnOwner(owner,worldId);}
 catch(e){grant.close();throw e;}
 state.attached=true;
 let closed=false,active=false,uncertain=false,abort:(()=>void)|undefined;
 return Object.freeze({
  context:grant.context,
  recordGrant:grant.record,
  async rehearse(range:Range):Promise<Outcome>{
   if(closed||active||uncertain||state.calls.length>=MAX_CALLS)return 'proven-unsent';
   active=true;
   let id:string|undefined,attempted=false;
   try{
    const selection:Range=structuredClone(range);
    const authorized=grant.active(),packet=reader.packet(selection),at=Date.now();
    if(!authorized||!packet||packet.permissionVersion!==authorized.weatherPermissionVersion)return 'proven-unsent';
    const summary=quota.summary(at);
    // In-flight unknown takes precedence, including across reopened lane handles.
    // The ledger itself separately enforces resident floors, waiters and limits.
    if(summary.waitingResidents||summary.unknown)return 'proven-unsent';
    const bytes=JSON.stringify(packet),hash=digest(bytes),inputTokens=Buffer.byteLength(bytes)+INPUT_OVERHEAD;
    // The same exact packet cannot be resent under a renewed purpose grant.
    const requestId='weather-rehearsal-'+hash;
    if(quota.reserve({requestId,purpose:'valley-spirit-almanac',inputTokens,outputTokens:OUTPUT_BUDGET},at).status!=='reserved')
     return 'proven-unsent';
    id=requestId;
    // Deliberately yield after durable hold, with NO open SQLite transaction.
    await Promise.resolve();
    const lastPacket=reader.packet(selection),lastGrant=grant.active(),now=Date.now();
    if(closed||!lastPacket||!lastGrant||lastGrant.version!==authorized.version||
     lastGrant.weatherPermissionVersion!==authorized.weatherPermissionVersion||
     lastPacket.permissionVersion!==lastGrant.weatherPermissionVersion||digest(JSON.stringify(lastPacket))!==hash||
     now>=lastGrant.expiresAt||quota.summary(now).waitingResidents)return 'proven-unsent';
    attempted=true;
    if(!quota.markHandoff(id,now))throw Error('rehearsal_handoff_unconfirmed');
    if(Date.now()>=lastGrant.expiresAt)throw Error('rehearsal_expired_at_handoff');
    const ok=await new Promise<boolean>(resolve=>{
     let resolved=false;
     const finish=(success:boolean)=>{if(!resolved){resolved=true;abort=undefined;resolve(success);}};
     abort=()=>finish(false);
     state.calls.push({witness:Object.freeze({packet:lastPacket,digest:hash,grantVersion:lastGrant.version,weatherPermissionVersion:lastGrant.weatherPermissionVersion}),finish});
    });
    if(!ok||closed||!quota.confirmCompletion(id,Date.now(),{inputTokens,outputTokens:1}))
     throw Error('rehearsal_completion_unconfirmed');
    return 'settled-synthetic';
   }catch{
    if(attempted){uncertain=true;return 'unresolved';}
    return 'proven-unsent';
   }finally{
    if(id&&!attempted)try{quota.cancelProvenUnsent(id,Date.now());}catch{/* durable held remains */}
    active=false;
   }
  },
  close(){if(!closed){closed=true;abort?.();try{reader.close();}finally{grant.close();}}}
 });
}
