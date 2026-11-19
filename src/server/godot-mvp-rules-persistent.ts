import {pinRulesNativeFruitRenewal,type RulesNativeFruitRenewalPin} from './valley-spirit-rules-fruit-renewal.js';
import {openRulesGeographyQueue,pinRulesGeographyQueue,type RulesGeographyQueueOptions} from './valley-spirit-rules-geography-queue.js';
import {nativeWeatherHourTransition} from './valley-spirit-weather-credit.js';
import {join} from 'node:path';
import {acquireDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureKey} from './valley-spirit-fixture-files.js';
import {openPersistentGeographyCustody,type PersistentGeographyCustody} from './valley-spirit-geography-custody.js';
import {inspectPersistentRulesLifeFixture,openPersistentRulesLifeFixture,pinPersistentRulesLifeFixture,type PersistentRulesLifeFixture} from './persistent-rules-life-view.js';
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
export async function startPersistentRulesMvp(options:{database:string;port:number;webRoot?:string;autoStart?:boolean;tickMs?:number;privateSpiritShadow?:PersistentRulesShadowOptions;privateSpiritGeographyQueue?:RulesGeographyQueueOptions;privateNativeFruitRenewal?:RulesNativeFruitRenewalPin;privateLifeFixture?:PersistentRulesLifeFixture;privateSpeechCustody?:Readonly<{fixture:DeveloperMvpSpiritFixtureKey;worldId:string;nativeWeatherCredit?:true}>;privateMealCustody?:Readonly<{fixture:DeveloperMvpSpiritFixtureKey;worldId:string}>}){
 if(typeof options.database!=='string'||!options.database.trim())throw Error('mvp_rules_database_required');
 if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw Error('godot_mvp_invalid_port');
 const tickMs=options.tickMs??500,shadowOptions=pinPersistentRulesShadowOptions(options.privateSpiritShadow);
 const queuePin=pinRulesGeographyQueue(options.privateSpiritGeographyQueue);
 if(options.privateSpiritGeographyQueue!==undefined&&(!queuePin||options.privateSpeechCustody!==undefined||options.privateMealCustody!==undefined))
  throw Error('mvp_rules_private_geography_queue_scope');
 const nativeRenewal=pinRulesNativeFruitRenewal(options.privateNativeFruitRenewal);
 if(options.privateNativeFruitRenewal!==undefined&&(!nativeRenewal||options.privateSpeechCustody!==undefined||options.privateMealCustody!==undefined))
  throw Error('mvp_rules_private_native_renewal_scope');
 const speechPin=options.privateSpeechCustody===undefined?undefined:structuredClone(options.privateSpeechCustody);
 if(options.privateSpeechCustody!==undefined&&(!speechPin||!speechPin.fixture||typeof speechPin.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(speechPin.worldId)||
    Object.keys(speechPin).some(k=>!['fixture','worldId','nativeWeatherCredit'].includes(k))||
    (Object.hasOwn(speechPin,'nativeWeatherCredit')&&speechPin.nativeWeatherCredit!==true)||typeof speechPin.fixture.directory!=='string'||
    options.database!==join(speechPin.fixture.directory,'fixture.sqlite')||
    options.privateLifeFixture!==undefined||options.privateSpiritShadow!==undefined||options.webRoot!==undefined))
  throw Error('mvp_rules_private_speech_scope');
 const mealPin=options.privateMealCustody===undefined?undefined:structuredClone(options.privateMealCustody);
 if(options.privateMealCustody!==undefined&&(!mealPin||!mealPin.fixture||typeof mealPin.worldId!=='string'||
    !/^godot-mvp-[A-Za-z0-9_-]{1,160}$/.test(mealPin.worldId)||Object.keys(mealPin).length!==2||
    typeof mealPin.fixture.directory!=='string'||options.database!==join(mealPin.fixture.directory,'fixture.sqlite')||
    options.privateSpeechCustody!==undefined||options.privateLifeFixture!==undefined||
    options.privateSpiritShadow!==undefined||options.webRoot!==undefined))throw Error('mvp_rules_private_meal_scope');
 const custodyPin=speechPin??mealPin;
 const weatherCredit=speechPin?.nativeWeatherCredit===true;
 if(!Number.isFinite(tickMs)||tickMs<100)throw Error('mvp_rules_invalid_tick');
 if(options.webRoot!==undefined)assertGodotWebExport(options.webRoot);
 let owner:RuntimeOwnership|DeveloperMvpSpiritFixtureOwner|undefined,privateOwner:DeveloperMvpSpiritFixtureOwner|undefined,store:WorldStore|undefined,timer:ReturnType<typeof setInterval>|undefined;
 let server:ReturnType<typeof createMvpServer>|undefined;
 let valleySpirit:ValleySpiritJournal|undefined;let spiritPermissions:SqliteValleySpiritPermissions|undefined;
 let geographyCustody:PersistentGeographyCustody|undefined;
 let shadow:ReturnType<typeof createPersistentRulesShadow>|undefined;
 let geographicProposalQueue:ReturnType<typeof openRulesGeographyQueue>|undefined;
 let viewers:ValleySpiritPublicReaders|undefined,almanacReader:SqliteValleySpiritAlmanacReader|undefined;
 const lifePin=pinPersistentRulesLifeFixture(options.privateLifeFixture);
 let life:ReturnType<typeof openPersistentRulesLifeFixture>|undefined,lifeReadable=false;
 let closing:Promise<void>|undefined;
 const close=():Promise<void>=>closing??=(async()=>{if(timer)clearInterval(timer);timer=undefined;if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}try{life?.close();}catch{/* optional isolated life reader */}life=undefined;try{almanacReader?.close();}catch{/* optional isolated reader */}almanacReader=undefined;viewers=undefined;shadow=undefined;geographicProposalQueue=undefined;try{geographyCustody?.close();}catch{/* optional isolated custody */}geographyCustody=undefined;try{spiritPermissions?.close();}catch{valleySpirit?.isolate();}spiritPermissions=undefined;store?.close();store=undefined;owner?.release();owner=undefined;})().catch(error=>{closing=undefined;throw error;});
 try{
  if(custodyPin){
   owner=privateOwner=acquireDeveloperMvpSpiritFixtureOwner(custodyPin.fixture);
   if(mealPin?privateOwner.rulesMealWorldId!==mealPin.worldId:privateOwner.rulesSpeechWorldId!==speechPin?.worldId)
    throw Error(mealPin?'mvp_rules_private_meal_world':'mvp_rules_private_speech_world');
   if((privateOwner.rulesWeatherHourCredit===true)!==weatherCredit)throw Error('mvp_rules_private_weather_scope');
  }else owner=acquireRuntimeOwnership(options.database);
  owner.assertOwned();
  try{lstatSync(owner.database+'.self-hosted-session');throw Error('mvp_rules_unresolved_session');}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;}
  let almanacReadable=true;
  const probe=preflightWorldSave(owner.database,{requireWorld:true,developerSpiritFixtureOwner:privateOwner,inspectOptionalAlmanac:(db,w)=>{try{inspectValleySpiritAlmanac(db,(w as unknown as World).id);}catch{almanacReadable=false;}if(lifePin)try{inspectPersistentRulesLifeFixture(db,w,lifePin);lifeReadable=true;}catch{/* isolate optional life */}},validateWorld:value=>{const w=value as unknown as World;assertMvpWorld(w);assertMvpClimateWorld(w);const m=w.metrics;
   if(!m||!Array.isArray(m.inFlight)||m.inFlight.length||m.configured!==false||[m.requests,m.successes,m.failures,m.inputTokens,m.outputTokens].some(n=>n!==0)||m.lastAttemptModel!==undefined||m.admissionCancellation!==undefined||m.routing!==undefined||Object.keys(m.usageWindow??{}).length||Object.keys(m.selfHostedCooldowns??{}).length||m.unmeteredFailures)throw Error('mvp_rules_model_history_unsupported');}});
  if(nativeRenewal&&probe?.id!==nativeRenewal.worldId)throw Error('mvp_rules_private_native_renewal_world');
  if(custodyPin&&probe?.id!==custodyPin.worldId)throw Error(mealPin?'mvp_rules_private_meal_world':'mvp_rules_private_speech_world');
  if(probe){assertMvpWorld(probe as unknown as World);validateMvpClimate(probe as unknown as World);}
  // Bind before any writable SQLite open or adoption.
  let session:ReturnType<typeof createMvpSession>|undefined;
  const snapshot=()=>({...session!.snapshot(),valleySpirit:valleySpirit?.view()??valleySpiritUnavailable()});
  server=createMvpServer({snapshot,get world(){return session?.world;}},{webRoot:options.webRoot,privateSpeechWeatherOnly:custodyPin?true:undefined,valleySpiritLifeViewer:lifePin?{latest:id=>life?.latest(id)??null}:undefined,valleySpiritSource:ref=>valleySpirit?.resolveSource(ref)??null,valleySpiritArchive:query=>valleySpirit?.archive(query)??{status:'unavailable'},valleySpiritReaders:{almanac:id=>viewers?.almanac(id)??null,latestAlmanac:()=>viewers?.latestAlmanac()??{status:'unavailable'},topics:range=>viewers?.topics(range)??{status:'unavailable'}}});
  await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(options.port,'127.0.0.1',resolve);});
  store=new WorldStore(owner.database,{allowMvpClimate:true,developerSpiritFixtureOwner:privateOwner,nativeWeatherCredit:weatherCredit?true:undefined,nativeRulesFruitRenewal:nativeRenewal??undefined});
  const saved=store.load(),world=structuredClone(saved??createMvpWorld()),previous=saved?.revision??null;
  if(custodyPin&&world.id!==custodyPin.worldId)throw Error(mealPin?'mvp_rules_private_meal_world':'mvp_rules_private_speech_world');
  assertMvpWorld(world);
  const upgraded=upgradeMvpWorld(world),adopted=adoptMvpClimate(world),soilAdopted=adoptMvpSoil(world),agricultureAdopted=adoptMvpAgriculture(world);
  const rainAdopted=adoptMvpRainProvenance(world);
  if(adopted||soilAdopted||agricultureAdopted||rainAdopted)world.revision++;
  if(!saved||upgraded||adopted||soilAdopted||agricultureAdopted||rainAdopted)store.commit(world,previous);
  let lastCommittedMinute=world.minute;
  session=createMvpSession({world,persistent:true,captureAddressedSpeechCustody:speechPin?true:undefined,captureSameSaveNativeWeather:privateOwner?.rulesWeatherAccountScope?true:undefined,captureAtomicNativeMeals:mealPin?true:undefined,captureAtomicNativeFruitRenewal:nativeRenewal?true:undefined,commit:(draft,revision,speech,meals)=>{
   owner!.assertOwned();
   if(mealPin){
    if(draft.id!==mealPin.worldId)throw Error('mvp_rules_private_meal_world');
    store!.commitMvpWithAtomicMealCustody(draft,revision,meals??[]);
   }else if(speechPin){
    if(draft.id!==speechPin.worldId)throw Error('mvp_rules_private_speech_world');
    store!.commitMvpWithAddressedSpeech(draft,revision,speech);
   }else store!.commit(draft,revision);
   const beforeMinute=lastCommittedMinute;
   const exactHour=nativeWeatherHourTransition(beforeMinute,draft.minute);
   const sample=!weatherCredit||exactHour;
   lastCommittedMinute=draft.minute;
   try{valleySpirit?.observe(publicWeatherProjection(draft),sample);}catch{valleySpirit?.isolate();}
   shadow?.onCommitted(draft);
   if(exactHour&&!draft.clock.paused)geographicProposalQueue?.onCommitted(beforeMinute,draft);}});
  const initialPublicFact=publicWeatherProjection(session.world);
  if(initialPublicFact){try{spiritPermissions=new SqliteValleySpiritPermissions(owner.database,initialPublicFact.worldId,()=>owner!.assertOwned());valleySpirit=new ValleySpiritJournal(owner.database,initialPublicFact,()=>owner!.assertOwned(),spiritPermissions,weatherCredit?{persistEmpty:true}:undefined);if(!weatherCredit)valleySpirit.observe(initialPublicFact);}catch{valleySpirit?.isolate();}}
  if(valleySpirit){
   if(queuePin?.worldId===world.id)try{
    geographicProposalQueue=openRulesGeographyQueue(owner.database,queuePin,valleySpirit,()=>owner!.assertOwned(),()=>store!.load());
   }catch{/* independent private G1 queue does not block starting normal rules */}
   if(shadowOptions)try{
    if(shadowOptions.durableObservation)geographyCustody=openPersistentGeographyCustody(owner.database,world.id,()=>owner!.assertOwned());
    shadow=createPersistentRulesShadow(shadowOptions,valleySpirit,geographyCustody);shadow.onCommitted(session.world);
   }catch{/* optional independent custody cannot block the rules runtime */}
   if(almanacReadable)try{almanacReader=new SqliteValleySpiritAlmanacReader(owner.database,world.id,()=>owner!.assertOwned());}catch{/* optional unreadable almanac remains isolated */}
   viewers=createValleySpiritPublicReaders(valleySpirit,almanacReader);
  }
  if(lifePin&&lifeReadable&&'lockPath' in owner)try{life=openPersistentRulesLifeFixture(owner,store,()=>session!.world,lifePin);}catch{/* no approved view */}
  if(options.autoStart!==false)timer=setInterval(()=>session!.advance(1),tickMs);
  const readPrivateSpiritCandidate=()=>{
   if(!shadowOptions)return {status:'disabled'} as const;
   try{
    if(session!.world.clock.paused||!shadow)return {status:'unavailable'} as const;
    const head=store?.load();
    return head?shadow.read(head):{status:'unavailable'} as const;
   }catch{return {status:'unavailable'} as const;}
  };
  const readPrivateSpiritGeographicProposal=()=>{
   if(!queuePin)return {status:'disabled'} as const;
   if(!geographicProposalQueue||!session||session.world.clock.paused)return {status:'unavailable'} as const;
   return geographicProposalQueue.review(session.world);
  };
  const readPrivateNativeFruitRenewal=()=>nativeRenewal&&session&&!session.world.clock.paused?store?.readCurrentNativeRulesFruitRenewal(session.world)??null:null;
  return {session,server,snapshot,readPrivateSpiritCandidate,readPrivateSpiritGeographicProposal,readPrivateNativeFruitRenewal,close};
 }catch(error){await close();throw error;}
}
