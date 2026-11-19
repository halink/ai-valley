import type {World} from '../shared/types.js';
import type {RuntimeOwnership} from './runtime-lock.js';
import type {OfflineResidentAccountAdmission} from './shared-resident-admission.js';
import {ValleySpiritAlmanac,type ValleySpiritAlmanacPacket} from './valley-spirit-almanac.js';
import {SqliteValleySpiritAlmanacStore} from './valley-spirit-almanac-store.js';
import {ValleySpiritAlmanacScheduler,type ValleySpiritSyntheticSchedulePolicy} from './valley-spirit-almanac-scheduler.js';
import {SqliteValleySpiritPermissions} from './valley-spirit-permissions.js';
import {ValleySpiritJournal,publicWeatherProjection} from './valley-spirit.js';

type Channel=Readonly<{kind:'seasonal-almanac-memory'}>;
type Reply={result:unknown;usage?:{inputTokens:number;outputTokens:number}};
type Call={packet:Readonly<ValleySpiritAlmanacPacket>;reply:(v:Reply)=>void;reject:()=>void};
const fixtures=new WeakMap<Channel,{claimed:boolean;invoke:(p:Readonly<ValleySpiritAlmanacPacket>,signal:AbortSignal)=>Promise<Reply>}>();
/** Fixture data only; no provider callbacks, endpoint, environment or key. */
export function createSeasonalAlmanacMemoryTransport(){
 const calls:Call[]=[],transport=Object.freeze({kind:'seasonal-almanac-memory'} as const);
 fixtures.set(transport,{claimed:false,invoke:(packet,signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('seasonal_almanac_memory_unknown'));return;}
  const failed=()=>{signal.removeEventListener('abort',failed);reject(Error('seasonal_almanac_memory_unknown'));};
  signal.addEventListener('abort',failed,{once:true});
  calls.push({packet,reply:v=>{signal.removeEventListener('abort',failed);resolve(v);},reject:failed});
 })});
 return {transport,requests:()=>calls.map(r=>structuredClone(r.packet)),reply:(i:number,result:unknown,usage?:Reply['usage'])=>calls[i].reply(structuredClone({result,usage})),reject:(i:number)=>calls[i].reject()};
}
export interface SeasonalAlmanacFixture {policy:ValleySpiritSyntheticSchedulePolicy;transport:Channel;}
export function claimSeasonalAlmanacFixture(options:SeasonalAlmanacFixture,residents:OfflineResidentAccountAdmission){
 const transport=fixtures.get(options?.transport);
 if(!transport||transport.claimed)throw Error('seasonal_almanac_memory_untrusted');
 const policy=structuredClone(options.policy);
 const controller=new AbortController();
 const account=residents.fixtureYearbook(policy,packet=>transport.invoke(packet,controller.signal));
 transport.claimed=true;
 return {policy,account,abort:()=>controller.abort()};
}
type Claimed=ReturnType<typeof claimSeasonalAlmanacFixture>;
export function openSeasonalAlmanacFixture(owner:RuntimeOwnership,world:World,claimed:Claimed){
 const fact=publicWeatherProjection(world);
 if(!fact)throw Error('seasonal_almanac_weather_unavailable');
 let permissions:SqliteValleySpiritPermissions|undefined,store:SqliteValleySpiritAlmanacStore|undefined;
 try{
  store=new SqliteValleySpiritAlmanacStore(owner.database,world.id,owner.assertOwned);
  permissions=new SqliteValleySpiritPermissions(owner.database,world.id,owner.assertOwned);
  const journal=new ValleySpiritJournal(owner.database,fact,owner.assertOwned,permissions);
  journal.observe(fact);
  const almanac=new ValleySpiritAlmanac(store,{permission:()=>journal.publicWeatherPermission(),resolve:r=>journal.resolveSource(r),readCurrent:r=>journal.publicNarrationInput(r)});
  const scheduler=new ValleySpiritAlmanacScheduler(almanac,window=>{
   const archived=journal.archive({...window,limit:24});
   return archived.status==='ready'?{worldId:archived.worldId,sourceRefs:archived.slots.flatMap(s=>s.status==='observed'?[s.record.sourceRef]:[])}:null;
  },{policy:claimed.policy,sharedAccount:claimed.account});
  return {
   observe(committed:World){journal.observe(publicWeatherProjection(committed));},
   async pump(minute:number){return scheduler.advance(Math.floor(minute/60));},
   latest(){
    const grant=journal.publicWeatherPermission();
    return grant?.publicWeather?almanac.latest(world.id,grant.version):null;
   },
   setPublicWeatherAllowed(allowed:boolean){
    if(!journal.setPublicWeatherAllowed(allowed))return false;
    almanac.retractChanged();return true;
   },
   close(){
    scheduler.stop();claimed.abort();
    try{store!.close();}finally{permissions!.close();}
   },
  };
 }catch(error){try{store?.close();}finally{permissions?.close();}throw error;}
}
