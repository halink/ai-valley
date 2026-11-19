import {openPersistentGeographyCustody,type PersistentGeographyCustody} from './valley-spirit-geography-custody.js';
import {createPersistentRulesShadow,pinPersistentRulesShadowOptions,type PersistentRulesShadowOptions} from './valley-spirit-persistent-rules-shadow.js';
import {inspectValleySpiritAlmanac,SqliteValleySpiritAlmanacReader} from './valley-spirit-almanac-store.js';
import {createValleySpiritPublicReaders,type ValleySpiritPublicReaders} from './valley-spirit-reader.js';
import {SqliteValleySpiritPermissions} from './valley-spirit-permissions.js';
import {ValleySpiritJournal,publicWeatherProjection,valleySpiritUnavailable} from './valley-spirit.js';
import {adoptMvpAgriculture} from '../world/mvp-agriculture.js';
import {adoptMvpSoil} from '../world/mvp-soil.js';
import {lstatSync} from 'node:fs';
/** Explicit opt-in durable RULE demonstration. Never reads model configuration or dispatches a model. */
import {createMvpSession,createMvpServer,createMvpWorld} from './godot-mvp.js';
import {assertMvpWorld,upgradeMvpWorld} from './godot-mvp-persistent.js';
import {adoptMvpClimate,validateMvpClimate,assertMvpClimateWorld} from '../world/mvp-climate-state.js';
import {adoptMvpRainProvenance} from '../world/mvp-rain-provenance.js';
import {preflightWorldSave} from './save-preflight.js';
import {WorldStore} from './store.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {assertGodotWebExport} from './godot-web.js';
import type {World} from '../shared/types.js';
export async function startPersistentRulesMvp(options:{database:string;port:number;webRoot?:string;autoStart?:boolean;tickMs?:number;privateSpiritShadow?:PersistentRulesShadowOptions}){
 if(typeof options.database!=='string'||!options.database.trim())throw Error('mvp_rules_database_required');
 if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw Error('godot_mvp_invalid_port');
 const tickMs=options.tickMs??500,shadowOptions=pinPersistentRulesShadowOptions(options.privateSpiritShadow);
 if(!Number.isFinite(tickMs)||tickMs<100)throw Error('mvp_rules_invalid_tick');
 if(options.webRoot!==undefined)assertGodotWebExport(options.webRoot);
 let owner:RuntimeOwnership|undefined,store:WorldStore|undefined,timer:ReturnType<typeof setInterval>|undefined;
 let server:ReturnType<typeof createMvpServer>|undefined;
 let valleySpirit:ValleySpiritJournal|undefined;let spiritPermissions:SqliteValleySpiritPermissions|undefined;
 let geographyCustody:PersistentGeographyCustody|undefined;
 let shadow:ReturnType<typeof createPersistentRulesShadow>|undefined;
 let viewers:ValleySpiritPublicReaders|undefined,almanacReader:SqliteValleySpiritAlmanacReader|undefined;
 let closing:Promise<void>|undefined;
 const close=():Promise<void>=>closing??=(async()=>{if(timer)clearInterval(timer);timer=undefined;if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}try{almanacReader?.close();}catch{/* optional isolated reader */}almanacReader=undefined;viewers=undefined;shadow=undefined;try{geographyCustody?.close();}catch{/* optional isolated custody */}geographyCustody=undefined;try{spiritPermissions?.close();}catch{valleySpirit?.isolate();}spiritPermissions=undefined;store?.close();store=undefined;owner?.release();owner=undefined;})().catch(error=>{closing=undefined;throw error;});
 try{
  owner=acquireRuntimeOwnership(options.database);owner.assertOwned();
  try{lstatSync(owner.database+'.self-hosted-session');throw Error('mvp_rules_unresolved_session');}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;}
  let almanacReadable=true;
  const probe=preflightWorldSave(owner.database,{requireWorld:true,inspectOptionalAlmanac:(db,w)=>{try{inspectValleySpiritAlmanac(db,(w as unknown as World).id);}catch{almanacReadable=false;}},validateWorld:value=>{const w=value as unknown as World;assertMvpWorld(w);assertMvpClimateWorld(w);const m=w.metrics;
   if(!m||!Array.isArray(m.inFlight)||m.inFlight.length||m.configured!==false||[m.requests,m.successes,m.failures,m.inputTokens,m.outputTokens].some(n=>n!==0)||m.lastAttemptModel!==undefined||m.admissionCancellation!==undefined||m.routing!==undefined||Object.keys(m.usageWindow??{}).length||Object.keys(m.selfHostedCooldowns??{}).length||m.unmeteredFailures)throw Error('mvp_rules_model_history_unsupported');}});
  if(probe){assertMvpWorld(probe as unknown as World);validateMvpClimate(probe as unknown as World);}
  // Bind before any writable SQLite open or adoption.
  let session:ReturnType<typeof createMvpSession>|undefined;
  const snapshot=()=>({...session!.snapshot(),valleySpirit:valleySpirit?.view()??valleySpiritUnavailable()});
  server=createMvpServer({snapshot},{webRoot:options.webRoot,valleySpiritSource:ref=>valleySpirit?.resolveSource(ref)??null,valleySpiritArchive:query=>valleySpirit?.archive(query)??{status:'unavailable'},valleySpiritReaders:{almanac:id=>viewers?.almanac(id)??null,latestAlmanac:()=>viewers?.latestAlmanac()??{status:'unavailable'},topics:range=>viewers?.topics(range)??{status:'unavailable'}}});
  await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(options.port,'127.0.0.1',resolve);});
  store=new WorldStore(owner.database,{allowMvpClimate:true});
  const saved=store.load(),world=structuredClone(saved??createMvpWorld()),previous=saved?.revision??null;
  assertMvpWorld(world);
  const upgraded=upgradeMvpWorld(world),adopted=adoptMvpClimate(world),soilAdopted=adoptMvpSoil(world),agricultureAdopted=adoptMvpAgriculture(world);
  const rainAdopted=adoptMvpRainProvenance(world);
  if(adopted||soilAdopted||agricultureAdopted||rainAdopted)world.revision++;
  if(!saved||upgraded||adopted||soilAdopted||agricultureAdopted||rainAdopted)store.commit(world,previous);
  session=createMvpSession({world,persistent:true,commit:(draft,revision)=>{owner!.assertOwned();store!.commit(draft,revision);try{valleySpirit?.observe(publicWeatherProjection(draft));}catch{valleySpirit?.isolate();}
   shadow?.onCommitted(draft);}});
  const initialPublicFact=publicWeatherProjection(session.world);
  if(initialPublicFact){try{spiritPermissions=new SqliteValleySpiritPermissions(owner.database,initialPublicFact.worldId,()=>owner!.assertOwned());valleySpirit=new ValleySpiritJournal(owner.database,initialPublicFact,()=>owner!.assertOwned(),spiritPermissions);valleySpirit.observe(initialPublicFact);}catch{valleySpirit?.isolate();}}
  if(valleySpirit){
   if(shadowOptions)try{
    if(shadowOptions.durableObservation)geographyCustody=openPersistentGeographyCustody(owner.database,world.id,()=>owner!.assertOwned());
    shadow=createPersistentRulesShadow(shadowOptions,valleySpirit,geographyCustody);shadow.onCommitted(session.world);
   }catch{/* optional independent custody cannot block the rules runtime */}
   if(almanacReadable)try{almanacReader=new SqliteValleySpiritAlmanacReader(owner.database,world.id,()=>owner!.assertOwned());}catch{/* optional unreadable almanac remains isolated */}
   viewers=createValleySpiritPublicReaders(valleySpirit,almanacReader);
  }
  if(options.autoStart!==false)timer=setInterval(()=>session!.advance(1),tickMs);
  const readPrivateSpiritCandidate=()=>{
   if(!shadowOptions)return {status:'disabled'} as const;
   try{
    if(session!.world.clock.paused||!shadow)return {status:'unavailable'} as const;
    const head=store?.load();
    return head?shadow.read(head):{status:'unavailable'} as const;
   }catch{return {status:'unavailable'} as const;}
  };
  return {session,server,snapshot,readPrivateSpiritCandidate,close};
 }catch(error){await close();throw error;}
}
