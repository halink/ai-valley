import {openSelectedOrdinaryRehearsal,pinSelectedOrdinaryRehearsal,type SelectedOrdinaryRehearsalOptions} from './valley-spirit-ordinary-selected-rehearsal.js';
import {openOrdinaryCandidateSelection,pinOrdinaryCandidateSelection,type OrdinaryCandidateSelectionOptions} from './valley-spirit-ordinary-multi-selection.js';
import {pinOrdinaryMultiCandidate,type OrdinaryMultiCandidatePin} from './valley-spirit-ordinary-multi-candidate.js';
import {pinOrdinaryNativeShelterOptions,type OrdinaryNativeShelterOptions} from './ordinary-native-shelter-custody.js';
import {pinOrdinaryNativeSpeechOptions,type OrdinaryNativeSpeechOptions} from './ordinary-native-speech-custody.js';
import {openOrdinaryHearingEditorialViewer,openOrdinaryMealEditorialViewer,openOrdinaryShelterEditorialViewer,
 pinOrdinaryHearingEditorial,pinOrdinaryMealEditorial,pinOrdinaryShelterEditorial,
 type OrdinaryHearingEditorialPin,type OrdinaryMealEditorialPin,type OrdinaryShelterEditorialPin} from './valley-spirit-ordinary-meal-editorial.js';
import {pinOrdinaryNativeMealOptions,type OrdinaryNativeMealOptions} from './valley-spirit-meal-custody.js';
import {ORDINARY_G2_HANDOFF_BLOCKERS,appendOrdinaryG2BlockedHandoff,encodeOrdinaryG2BlockedHandoffTerms,ordinaryG2BlockedHandoffSigningBytes,pinOrdinaryG2BlockedHandoff,readOrdinaryG2HandoffRecord,sameOrdinaryG2HandoffTerms,type OrdinaryG2BlockedHandoffOptions,type OrdinaryG2BlockedHandoffTerms} from './valley-spirit-ordinary-g2-blocked-handoff.js';
import {DatabaseSync} from 'node:sqlite';
import {ORDINARY_G1_DECISION_PURPOSE,advanceOrdinaryG1DecisionEpoch,appendOrdinaryG1Decision,ordinaryAgedG1DecisionSigningBytes,ordinaryG1DecisionDigest,ordinaryG1DecisionHash,ordinaryG1DecisionReviewDigest,ordinaryG1DecisionSaveScope,readOrdinaryG1DecisionHead,readOrdinaryG1DecisionRecord,type OrdinaryG1DecisionTerms} from './valley-spirit-ordinary-g1-decision.js';
import {rehearseOrdinaryAgedG1} from './valley-spirit-ordinary-g1-rehearsal.js';
import {openDisposableSpeechEditorial,pinDisposableSpeechEditorialReviewer,type DisposableSpeechEditorialWatermark} from './disposable-native-speech-release.js';
import {bindDisposableSpeechPurpose,disposableSpeechHead,openDisposableNativeSpeechReader,stageDisposableSpeechScenario,type DisposableSpeechCase,type DisposableSpeechHead} from './disposable-native-addressed-speech.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {pinDisposableNativeAgedTransfer} from './disposable-native-aged-transfer.js';
import {createFreshDisposableRulesStorage,isDisposableRulesScratchPath} from './disposable-native-rules-save.js';
import {inspectOrdinaryAgedG1Advisory,prepareOrdinaryAgedG1ReviewEncoding,pinOrdinaryAgedG1Review,unavailableOrdinaryAgedG1,type OrdinaryAgedG1ReviewOptions} from './valley-spirit-ordinary-aged-g1-review.js';
import {canInstallEmptyOrdinaryAgedGround,hasNativeEmptyGroundCheckpoint,openEmptyOrdinaryAgedGround,pinOrdinaryAgedGround,type OrdinaryAgedGroundPin} from './valley-spirit-ordinary-aged-ground.js';
import {unavailableAgedRulesPreflight} from './valley-spirit-rules-aged-preflight.js';
import {pinRulesNativeMultiFruit,type RulesNativeMultiFruitPin,pinRulesNativeFruitRenewal,type RulesNativeFruitRenewalPin} from './valley-spirit-rules-fruit-renewal.js';
import {openRulesGeographyQueue,pinRulesGeographyQueue,type RulesGeographyQueueOptions} from './valley-spirit-rules-geography-queue.js';
import {nativeWeatherHourTransition} from './valley-spirit-weather-credit.js';
import {dirname,join} from 'node:path';
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
type PersistentRulesOptions={database:string;port:number;webRoot?:string;autoStart?:boolean;tickMs?:number;privateSpiritShadow?:PersistentRulesShadowOptions;privateSpiritGeographyQueue?:RulesGeographyQueueOptions;privateNativeFruitRenewal?:RulesNativeFruitRenewalPin;privateOrdinaryMultiFruit?:RulesNativeMultiFruitPin;privateOrdinaryMultiCandidate?:OrdinaryMultiCandidatePin;privateOrdinaryMultiSelection?:OrdinaryCandidateSelectionOptions;privateOrdinarySelectedRehearsal?:SelectedOrdinaryRehearsalOptions;privateAgedFruitPreflight?:true;privateEmptyAgedGround?:OrdinaryAgedGroundPin;privateNativeEmptyAgedGround?:true;privateOrdinaryAgedG1Review?:OrdinaryAgedG1ReviewOptions;privateOrdinaryAgedG1Decision?:true;privateOrdinaryG2BlockedHandoff?:OrdinaryG2BlockedHandoffOptions;privateLifeFixture?:PersistentRulesLifeFixture;privateSpeechCustody?:Readonly<{fixture:DeveloperMvpSpiritFixtureKey;worldId:string;nativeWeatherCredit?:true}>;privateOrdinaryNativeMeal?:OrdinaryNativeMealOptions;privateOrdinaryNativeSpeech?:OrdinaryNativeSpeechOptions;privateOrdinaryNativeShelter?:OrdinaryNativeShelterOptions;privateOrdinaryNativeMealView?:OrdinaryMealEditorialPin;privateOrdinaryNativeHearingView?:OrdinaryHearingEditorialPin;privateOrdinaryNativeShelterView?:OrdinaryShelterEditorialPin;privateMealCustody?:Readonly<{fixture:DeveloperMvpSpiritFixtureKey;worldId:string}>};
export async function startPersistentRulesMvp(options:PersistentRulesOptions){
 if(typeof options.database!=='string'||!options.database.trim())throw Error('mvp_rules_database_required');
 if(isDisposableRulesScratchPath(options.database))throw Error('disposable_native_rules_no_http');
 const running=await openPersistentRulesCore(options);
 const server=running.server;
 if(!server){await running.close();throw Error('mvp_rules_missing_server');}
 const {transactPrivateDisposableAgedTransfer:_developerOnly,disposableRebaseRequired:_rebase,readPrivateDisposableResidentGroundDiscovery:_discovery,readPrivateDisposableNativeAgedFairness:_fairness,readPrivateDisposableNativeSpeech:_speech,...normal}=running;
 return {...normal,server};
}
type DisposableRulesOptions=Pick<PersistentRulesOptions,'privateSpiritGeographyQueue'|'privateNativeFruitRenewal'|
 'privateAgedFruitPreflight'|'privateEmptyAgedGround'|'privateNativeEmptyAgedGround'|'privateOrdinaryAgedG1Review'>&{privateDisposableAgedEffectPublicKeyPem?:string};
const disposableOptions=['privateSpiritGeographyQueue','privateNativeFruitRenewal','privateAgedFruitPreflight',
 'privateEmptyAgedGround','privateNativeEmptyAgedGround','privateOrdinaryAgedG1Review','privateDisposableAgedEffectPublicKeyPem'] as const;
/** Internal operator fixture. The closure is the capability; it can neither
 * import nor adopt an existing path, and its lifetime is this process only. */
export function createDisposableNativeRulesSave(){
 const storage=createFreshDisposableRulesStorage(),{database,assertOwned:assertDisposable}=storage;
 let open=false;
 return Object.freeze({
  async open(options:DisposableRulesOptions={}){
   if(open)throw Error('disposable_native_rules_already_open');
   const pinned=structuredClone(options);
   if(!pinned||typeof pinned!=='object'||Array.isArray(pinned)||
    Object.keys(pinned).some(k=>!(disposableOptions as readonly string[]).includes(k)))
    throw Error('disposable_native_rules_options');
   assertDisposable();open=true;
   try{
    const {privateDisposableAgedEffectPublicKeyPem,...nativeOptions}=pinned;
    const run=await openPersistentRulesCore({...nativeOptions,database,port:0,autoStart:false},storage,privateDisposableAgedEffectPublicKeyPem);
    // No server, raw draft, store, OS path, timer or external provider.
    let closing:Promise<void>|undefined;
    const live=<T>(read:()=>T):T=>{
     if(closing)throw Error('disposable_native_rules_closed');
     if(run.disposableRebaseRequired())throw Error('disposable_native_aged_transfer_committed_reopen_required');
     assertDisposable();return read();
    };
    return Object.freeze({
     snapshot:()=>live(()=>{
      const s=run.snapshot();
      // Exact in-flight effect identifiers live only in the protected world
      // and private evidence, not generic observer snapshots.
      for(const resident of s.world.residents){
       if(resident.activity?.action.type==='mvpAgedFruitEat'||resident.plan?.actions.some(a=>a.type==='mvpAgedFruitEat')){
        resident.activity=null;resident.plan=null;
       }
      }
      return s;
     }),advance:()=>live(()=>run.session.advance(1)),
     readPrivateSpiritGeographicProposal:()=>live(run.readPrivateSpiritGeographicProposal),
     readPrivateNativeFruitLot:()=>live(run.readPrivateNativeFruitLot),
     readPrivateAgedFruitPreflight:()=>live(run.readPrivateAgedFruitPreflight),
     readPrivateOrdinaryAgedGround:()=>live(run.readPrivateOrdinaryAgedGround),
     readPrivateOrdinaryAgedG1Review:(signed?:unknown)=>live(()=>run.readPrivateOrdinaryAgedG1Review(signed)),
     transactPrivateDisposableAgedTransfer:(g1?:unknown,g2?:unknown)=>live(()=>run.transactPrivateDisposableAgedTransfer(g1,g2)),
     readPrivateDisposableNativeAgedFairness:()=>live(run.readPrivateDisposableNativeAgedFairness),
     readPrivateDisposableResidentGroundDiscovery:(residentId:string)=>live(()=>run.readPrivateDisposableResidentGroundDiscovery(residentId)),
     close:()=>closing??=(run.close().then(()=>{open=false;}).catch(e=>{closing=undefined;throw e;})),
    });
   }catch(e){open=false;throw e;}
  },
  dispose(){
   if(open)throw Error('disposable_native_rules_already_open');
   return storage.dispose();
  },
 });
}
/** Dedicated private proof profile. No world/draft, server, path, arbitrary
 * action, or share/publication handle escapes the fresh owning save closure. */
export function createDisposableNativeSpeechSave(scenario:DisposableSpeechCase,commissionedReviewerPublicKeyPem?:string){
 if(scenario!=='recipient-perceives'&&scenario!=='recipient-cannot-perceive')throw Error('disposable_native_speech_scenario');
 const reviewer=commissionedReviewerPublicKeyPem===undefined?undefined:pinDisposableSpeechEditorialReviewer(commissionedReviewerPublicKeyPem);
 const storage=createFreshDisposableRulesStorage();
 const watermark:DisposableSpeechEditorialWatermark={seen:[],isolated:false};
 let open=false;
 return Object.freeze({
  openEditorial(){
   if(!reviewer||open)throw Error('disposable_speech_editorial_closed_scope_required');
   storage.assertOwned();open=true;
   let owner:RuntimeOwnership|undefined;
   try{
    owner=acquireRuntimeOwnership(storage.database,{existingOnly:true});
    const storeOwner=storage.bind(owner),purpose=bindDisposableSpeechPurpose(owner.database,storeOwner);
    const editor=openDisposableSpeechEditorial(owner.database,storeOwner,purpose,reviewer,watermark);
    return Object.freeze({...editor,close(){if(!owner)return;try{editor.close();}finally{owner.release();owner=undefined;open=false;}}});
   }catch(e){try{owner?.release();}finally{open=false;}throw e;}
  },
  async open(){
   if(open)throw Error('disposable_native_rules_already_open');
   storage.assertOwned();open=true;
   try{
    const run=await openPersistentRulesCore({database:storage.database,port:0,autoStart:false},storage,undefined,scenario);
    let closing:Promise<void>|undefined;
    const live=<T>(read:()=>T):T=>{
     if(closing)throw Error('disposable_native_rules_closed');
     storage.assertOwned();return read();
    };
    return Object.freeze({
     head:()=>live(()=>disposableSpeechHead(run.session.world)),
     advance:()=>live(()=>run.session.advance(1)),
     readPrivateProof:(head:Readonly<DisposableSpeechHead>)=>live(()=>run.readPrivateDisposableNativeSpeech(head)),
     close:()=>closing??=(run.close().then(()=>{open=false;}).catch(e=>{closing=undefined;throw e;})),
    });
   }catch(e){open=false;throw e;}
  },
 });
}
async function openPersistentRulesCore(options:PersistentRulesOptions,disposable?:ReturnType<typeof createFreshDisposableRulesStorage>,disposableEffectKey?:string,disposableSpeech?:DisposableSpeechCase){
 const assertDisposable=disposable?.assertOwned;
 if(disposableSpeech&&(!assertDisposable||disposableEffectKey!==undefined||
   Object.keys(options).some(k=>!['database','port','autoStart'].includes(k))||
   options.port!==0||options.autoStart!==false))throw Error('disposable_native_speech_scope');
 if(typeof options.database!=='string'||!options.database.trim())throw Error('mvp_rules_database_required');
 if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw Error('godot_mvp_invalid_port');
 const tickMs=options.tickMs??500,shadowOptions=pinPersistentRulesShadowOptions(options.privateSpiritShadow);
 const queuePin=pinRulesGeographyQueue(options.privateSpiritGeographyQueue);
 if(options.privateSpiritGeographyQueue!==undefined&&(!queuePin||options.privateSpeechCustody!==undefined||options.privateMealCustody!==undefined))
  throw Error('mvp_rules_private_geography_queue_scope');
 const nativeRenewal=pinRulesNativeFruitRenewal(options.privateNativeFruitRenewal);
 if(options.privateNativeFruitRenewal!==undefined&&(!nativeRenewal||options.privateSpeechCustody!==undefined||options.privateMealCustody!==undefined))
  throw Error('mvp_rules_private_native_renewal_scope');
 const agedPreflight=options.privateAgedFruitPreflight===true;
 if(options.privateAgedFruitPreflight!==undefined&&(!agedPreflight||!queuePin||!nativeRenewal?.lotShelfLifeGameMinutes||
   nativeRenewal.worldId!==queuePin.worldId||nativeRenewal.sourceId!==queuePin.site.sourceId))
  throw Error('mvp_rules_private_aged_preflight_scope');
 const agedGroundPin=pinOrdinaryAgedGround(options.privateEmptyAgedGround);
 if(options.privateEmptyAgedGround!==undefined&&(!agedGroundPin||options.privateSpeechCustody!==undefined||options.privateMealCustody!==undefined))
  throw Error('ordinary_aged_ground_runtime_scope');
 const nativeEmpty=options.privateNativeEmptyAgedGround===true;
 if(options.privateNativeEmptyAgedGround!==undefined&&(!nativeEmpty||!agedGroundPin||options.privateOrdinaryAgedG1Review!==undefined))
  throw Error('ordinary_native_empty_ground_scope');
 const ordinaryReview=pinOrdinaryAgedG1Review(options.privateOrdinaryAgedG1Review);
 const disposableAgedTransfer=disposableEffectKey===undefined?undefined:pinDisposableNativeAgedTransfer(disposableEffectKey,ordinaryReview);
 if(disposableEffectKey!==undefined&&(!disposable||!disposableAgedTransfer||!nativeRenewal?.lotShelfLifeGameMinutes||!agedGroundPin||!queuePin))
  throw Error('disposable_native_aged_transfer_scope');
 if(options.privateOrdinaryAgedG1Review!==undefined&&(!ordinaryReview||!agedPreflight||!agedGroundPin||!queuePin||
   agedGroundPin.worldId!==queuePin.worldId||agedGroundPin.sourceId!==queuePin.site.sourceId||
   agedGroundPin.target.x!==queuePin.site.target.x||agedGroundPin.target.y!==queuePin.site.target.y))
  throw Error('ordinary_aged_g1_review_scope');
 const g1DecisionEnabled=options.privateOrdinaryAgedG1Decision===true;
 if(options.privateOrdinaryAgedG1Decision!==undefined&&
  (!g1DecisionEnabled||!ordinaryReview||!!disposable||options.autoStart!==false))
  throw Error('ordinary_aged_g1_decision_stopped_scope');
 const g2Handoff=pinOrdinaryG2BlockedHandoff(options.privateOrdinaryG2BlockedHandoff);
 if(options.privateOrdinaryG2BlockedHandoff!==undefined&&(!g2Handoff||!g1DecisionEnabled||!ordinaryReview||
  g2Handoff.keyId===ordinaryReview.keyId))throw Error('ordinary_g2_blocked_handoff_independent_scope');
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
 const ordinaryShelter=pinOrdinaryNativeShelterOptions(options.privateOrdinaryNativeShelter);
 if(options.privateOrdinaryNativeShelter!==undefined&&(!ordinaryShelter||!!disposable||options.autoStart!==false||
  Object.keys(options).some(k=>k.startsWith('private')&&k!=='privateOrdinaryNativeShelter')))
  throw Error('ordinary_native_shelter_explicit_local_scope');
 const ordinarySpeech=pinOrdinaryNativeSpeechOptions(options.privateOrdinaryNativeSpeech);
 if(options.privateOrdinaryNativeSpeech!==undefined&&(!ordinarySpeech||!!disposable||options.autoStart!==false||
  Object.keys(options).some(k=>k.startsWith('private')&&k!=='privateOrdinaryNativeSpeech')))
  throw Error('ordinary_native_speech_explicit_local_scope');
 const ordinaryMeal=pinOrdinaryNativeMealOptions(options.privateOrdinaryNativeMeal);
 if(options.privateOrdinaryNativeMeal!==undefined&&(!ordinaryMeal||!!disposable||options.autoStart!==false||
  Object.keys(options).some(k=>k.startsWith('private')&&k!=='privateOrdinaryNativeMeal')))
  throw Error('ordinary_native_meal_explicit_local_scope');
 const ordinaryMealView=pinOrdinaryMealEditorial(options.privateOrdinaryNativeMealView);
 const ordinaryHearingView=pinOrdinaryHearingEditorial(options.privateOrdinaryNativeHearingView);
 const ordinaryShelterView=pinOrdinaryShelterEditorial(options.privateOrdinaryNativeShelterView);
 const conflictingEditorialOptions=!!disposable||options.autoStart!==false||
  Object.keys(options).some(k=>k.startsWith('private')&&!['privateOrdinaryNativeMealView','privateOrdinaryNativeHearingView','privateOrdinaryNativeShelterView'].includes(k));
 if(options.privateOrdinaryNativeMealView!==undefined&&(!ordinaryMealView||conflictingEditorialOptions))
  throw Error('ordinary_native_meal_view_explicit_local_scope');
 if(options.privateOrdinaryNativeHearingView!==undefined&&(!ordinaryHearingView||conflictingEditorialOptions))
  throw Error('ordinary_native_hearing_view_explicit_local_scope');
 if(options.privateOrdinaryNativeShelterView!==undefined&&(!ordinaryShelterView||conflictingEditorialOptions))
  throw Error('ordinary_native_shelter_view_explicit_local_scope');
 const nativeLifePins=[ordinaryHearingView,ordinaryMealView,ordinaryShelterView].filter(p=>p!==null);
 if(new Set(nativeLifePins.map(p=>p.worldId)).size>1||new Set(nativeLifePins.map(p=>p.fingerprint)).size!==nativeLifePins.length)
  throw Error('ordinary_native_life_view_independent_scope');
 const ordinaryMultiFruit=pinRulesNativeMultiFruit(options.privateOrdinaryMultiFruit);
 if(options.privateOrdinaryMultiFruit!==undefined&&(!ordinaryMultiFruit||disposable||options.autoStart!==false||
  Object.keys(options).some(k=>k.startsWith('private')&&k!=='privateOrdinaryMultiFruit'&&k!=='privateOrdinaryMultiCandidate'&&k!=='privateOrdinaryMultiSelection'&&k!=='privateOrdinarySelectedRehearsal')))
  throw Error('ordinary_multi_fruit_explicit_scope');
 const ordinaryMultiCandidate=pinOrdinaryMultiCandidate(options.privateOrdinaryMultiCandidate);
 if(options.privateOrdinaryMultiCandidate!==undefined&&(!ordinaryMultiCandidate||!ordinaryMultiFruit||
  ordinaryMultiCandidate.worldId!==ordinaryMultiFruit.worldId||
  ordinaryMultiCandidate.sites.some(site=>!ordinaryMultiFruit.sites.some(source=>source.sourceId===site.sourceId))))
  throw Error('ordinary_multi_candidate_explicit_scope');
 const ordinarySelection=options.privateOrdinaryMultiSelection===undefined?null:pinOrdinaryCandidateSelection(options.privateOrdinaryMultiSelection);
 if(options.privateOrdinaryMultiSelection!==undefined&&(!ordinarySelection||!ordinaryMultiCandidate||!ordinaryMultiFruit||options.autoStart!==false||disposable))
  throw Error('ordinary_candidate_selection_explicit_scope');
 const selectedRehearsal=options.privateOrdinarySelectedRehearsal===undefined?null:pinSelectedOrdinaryRehearsal(options.privateOrdinarySelectedRehearsal);
 if(options.privateOrdinarySelectedRehearsal!==undefined&&(!selectedRehearsal||!ordinarySelection||
  selectedRehearsal.fingerprint===ordinarySelection.fingerprint))throw Error('ordinary_selected_review_explicit_independent_scope');
 const custodyPin=speechPin??mealPin;
 const weatherCredit=speechPin?.nativeWeatherCredit===true;
 if(!Number.isFinite(tickMs)||tickMs<100)throw Error('mvp_rules_invalid_tick');
 if(options.webRoot!==undefined)assertGodotWebExport(options.webRoot);
 let owner:RuntimeOwnership|DeveloperMvpSpiritFixtureOwner|undefined,privateOwner:DeveloperMvpSpiritFixtureOwner|undefined,store:WorldStore|undefined,timer:ReturnType<typeof setInterval>|undefined;
 let server:ReturnType<typeof createMvpServer>|undefined;
 let speechReader:ReturnType<typeof openDisposableNativeSpeechReader>|undefined;
 let valleySpirit:ValleySpiritJournal|undefined;let spiritPermissions:SqliteValleySpiritPermissions|undefined;
 let agedGround:ReturnType<typeof openEmptyOrdinaryAgedGround>|undefined;
 let geographyCustody:PersistentGeographyCustody|undefined;
 let shadow:ReturnType<typeof createPersistentRulesShadow>|undefined;
 let geographicProposalQueue:ReturnType<typeof openRulesGeographyQueue>|undefined;
 let viewers:ValleySpiritPublicReaders|undefined,almanacReader:SqliteValleySpiritAlmanacReader|undefined;
 const lifePin=pinPersistentRulesLifeFixture(options.privateLifeFixture);
 let life:ReturnType<typeof openPersistentRulesLifeFixture>|undefined,lifeReadable=false;
 let mealEditorialViewer:ReturnType<typeof openOrdinaryMealEditorialViewer>|undefined;
 let hearingEditorialViewer:ReturnType<typeof openOrdinaryHearingEditorialViewer>|undefined;
 let shelterEditorialViewer:ReturnType<typeof openOrdinaryShelterEditorialViewer>|undefined;
 const latestOrdinary=(id:string)=>{
  // Fixed ties keep the established hearing > meal order, then shelter.
  // Do not sort by the underlying exact source minute.
  const candidates=[hearingEditorialViewer?.latest(id),mealEditorialViewer?.latest(id),shelterEditorialViewer?.latest(id)];
  let selected:NonNullable<(typeof candidates)[number]>|null=null;
  for(const candidate of candidates)
   if(candidate&&(!selected||BigInt(candidate.range.throughUs)>BigInt(selected.range.throughUs)))selected=candidate;
  return selected;
 };
 let selectedReview:ReturnType<typeof openSelectedOrdinaryRehearsal>|undefined;
 let selection:ReturnType<typeof openOrdinaryCandidateSelection>|undefined;
 let closing:Promise<void>|undefined;
 const close=():Promise<void>=>closing??=(async()=>{selection?.close();selection=undefined;selectedReview=undefined;if(timer)clearInterval(timer);timer=undefined;if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;}try{speechReader?.close();}catch{/* optional private snapshot */}speechReader=undefined;try{life?.close();}catch{/* optional isolated life reader */}life=undefined;try{mealEditorialViewer?.close();}catch{/* optional objective life viewer */}mealEditorialViewer=undefined;try{hearingEditorialViewer?.close();}catch{/* optional objective hearing viewer */}hearingEditorialViewer=undefined;try{shelterEditorialViewer?.close();}catch{/* optional objective shelter viewer */}shelterEditorialViewer=undefined;try{almanacReader?.close();}catch{/* optional isolated reader */}almanacReader=undefined;viewers=undefined;shadow=undefined;try{agedGround?.close();}catch{/* private closure */}agedGround=undefined;geographicProposalQueue=undefined;try{geographyCustody?.close();}catch{/* optional isolated custody */}geographyCustody=undefined;try{spiritPermissions?.close();}catch{valleySpirit?.isolate();}spiritPermissions=undefined;store?.close();store=undefined;owner?.release();owner=undefined;})().catch(error=>{closing=undefined;throw error;});
 try{
  if(custodyPin){
   owner=privateOwner=acquireDeveloperMvpSpiritFixtureOwner(custodyPin.fixture);
   if(mealPin?privateOwner.rulesMealWorldId!==mealPin.worldId:privateOwner.rulesSpeechWorldId!==speechPin?.worldId)
    throw Error(mealPin?'mvp_rules_private_meal_world':'mvp_rules_private_speech_world');
   if((privateOwner.rulesWeatherHourCredit===true)!==weatherCredit)throw Error('mvp_rules_private_weather_scope');
  }else owner=acquireRuntimeOwnership(options.database,agedGroundPin||ordinaryMeal||nativeLifePins.length||ordinarySpeech||ordinaryShelter||ordinaryMultiFruit?{existingOnly:true}:undefined);
  owner.assertOwned();assertDisposable?.();
  const privateDisposableSave=disposable&&'lockPath' in owner?disposable.bind(owner):undefined;
  if(disposable&&!privateDisposableSave)throw Error('disposable_native_rules_owner');
  const speechPurpose=disposableSpeech&&privateDisposableSave?bindDisposableSpeechPurpose(owner.database,privateDisposableSave):undefined;
  try{lstatSync(owner.database+'.self-hosted-session');throw Error('mvp_rules_unresolved_session');}catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw error;}
  let almanacReadable=true,nativeGroundAlreadyBound=false;
  const probe=preflightWorldSave(owner.database,{requireWorld:true,privateDisposableSave,privateDisposableAgedTransfer:disposableAgedTransfer??undefined,developerSpiritFixtureOwner:privateOwner,nativeEmptyGround:nativeEmpty?agedGroundPin??undefined:undefined,inspectOptionalAlmanac:(db,w)=>{if(nativeEmpty)nativeGroundAlreadyBound=hasNativeEmptyGroundCheckpoint(db);try{inspectValleySpiritAlmanac(db,(w as unknown as World).id);}catch{almanacReadable=false;}if(lifePin)try{inspectPersistentRulesLifeFixture(db,w,lifePin);lifeReadable=true;}catch{/* isolate optional life */}},validateWorld:value=>{const w=value as unknown as World;assertMvpWorld(w);assertMvpClimateWorld(w);const m=w.metrics;
   if(!m||!Array.isArray(m.inFlight)||m.inFlight.length||m.configured!==false||[m.requests,m.successes,m.failures,m.inputTokens,m.outputTokens].some(n=>n!==0)||m.lastAttemptModel!==undefined||m.admissionCancellation!==undefined||m.routing!==undefined||Object.keys(m.usageWindow??{}).length||Object.keys(m.selfHostedCooldowns??{}).length||m.unmeteredFailures)throw Error('mvp_rules_model_history_unsupported');}});
  if(agedGroundPin){
   if(probe?.id!==agedGroundPin.worldId)throw Error('ordinary_aged_ground_existing_save_required');
   if(!nativeGroundAlreadyBound&&!canInstallEmptyOrdinaryAgedGround(probe as unknown as World,agedGroundPin))
    throw Error('ordinary_aged_ground_legal_commons_site_required');
  }
  if(nativeRenewal&&probe?.id!==nativeRenewal.worldId)throw Error('mvp_rules_private_native_renewal_world');
  if(ordinaryMultiFruit&&probe?.id!==ordinaryMultiFruit.worldId)throw Error('ordinary_multi_fruit_world_mismatch');
  if(ordinaryShelter&&probe?.id!==ordinaryShelter.worldId)throw Error('ordinary_native_shelter_world_mismatch');
  if(ordinarySpeech&&probe?.id!==ordinarySpeech.worldId)throw Error('ordinary_native_speech_world_mismatch');
  if(ordinaryMeal&&probe?.id!==ordinaryMeal.worldId)throw Error('ordinary_native_meal_world_mismatch');
  if(ordinaryShelterView&&probe?.id!==ordinaryShelterView.worldId)throw Error('ordinary_native_shelter_view_world_mismatch');
  if(ordinaryHearingView&&probe?.id!==ordinaryHearingView.worldId)throw Error('ordinary_native_hearing_view_world_mismatch');
  if(ordinaryMealView&&probe?.id!==ordinaryMealView.worldId)throw Error('ordinary_native_meal_view_world_mismatch');
  if(custodyPin&&probe?.id!==custodyPin.worldId)throw Error(mealPin?'mvp_rules_private_meal_world':'mvp_rules_private_speech_world');
  if(probe){assertMvpWorld(probe as unknown as World);validateMvpClimate(probe as unknown as World);}
  // Bind before any writable SQLite open or adoption.
  let session:ReturnType<typeof createMvpSession>|undefined;
  const snapshot=()=>({...session!.snapshot(),valleySpirit:valleySpirit?.view()??valleySpiritUnavailable()});
  if(!assertDisposable){
   server=createMvpServer({snapshot,get world(){return session?.world;}},{webRoot:options.webRoot,privateSpeechWeatherOnly:custodyPin?true:undefined,valleySpiritLifeViewer:lifePin||nativeLifePins.length?{latest:id=>nativeLifePins.length?latestOrdinary(id):life?.latest(id)??null}:undefined,valleySpiritSource:ref=>valleySpirit?.resolveSource(ref)??null,valleySpiritArchive:query=>valleySpirit?.archive(query)??{status:'unavailable'},valleySpiritReaders:{almanac:id=>viewers?.almanac(id)??null,latestAlmanac:()=>viewers?.latestAlmanac()??{status:'unavailable'},topics:range=>viewers?.topics(range)??{status:'unavailable'}}});
   await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(options.port,'127.0.0.1',resolve);});
  }
  const nativeGround=nativeEmpty&&agedGroundPin&&'lockPath' in owner?{owner,pin:agedGroundPin}:undefined;
  store=new WorldStore(owner.database,{privateDisposableSave,disposableAgedTransfer:disposableAgedTransfer??undefined,nativeEmptyGround:nativeGround,allowMvpClimate:true,developerSpiritFixtureOwner:privateOwner,nativeWeatherCredit:weatherCredit?true:undefined,nativeRulesFruitRenewal:nativeRenewal??undefined,nativeMultiFruit:ordinaryMultiFruit&&'lockPath' in owner?{owner,pin:ordinaryMultiFruit}:undefined,
   ordinaryNativeShelter:ordinaryShelter&&'lockPath' in owner?{owner,pin:ordinaryShelter}:undefined,
   ordinaryNativeSpeech:ordinarySpeech&&'lockPath' in owner?{owner,pin:ordinarySpeech}:undefined,
   ordinaryNativeMeal:ordinaryMeal&&'lockPath' in owner?{owner,pin:ordinaryMeal}:undefined});
  const saved=store.load(),world=structuredClone(saved??createMvpWorld()),previous=saved?.revision??null;
  if(custodyPin&&world.id!==custodyPin.worldId)throw Error(mealPin?'mvp_rules_private_meal_world':'mvp_rules_private_speech_world');
  assertMvpWorld(world);
  if(disposableSpeech&&!saved)stageDisposableSpeechScenario(world,disposableSpeech);
  if(agedGroundPin){
   if(!('lockPath' in owner))throw Error('ordinary_aged_ground_runtime_owner_required');
   agedGround=openEmptyOrdinaryAgedGround(owner,agedGroundPin,()=>store!.load(),nativeEmpty);
  }
  const upgraded=upgradeMvpWorld(world),adopted=adoptMvpClimate(world),soilAdopted=adoptMvpSoil(world),agricultureAdopted=adoptMvpAgriculture(world);
  const rainAdopted=adoptMvpRainProvenance(world);
  if(adopted||soilAdopted||agricultureAdopted||rainAdopted)world.revision++;
  if(!saved||upgraded||adopted||soilAdopted||agricultureAdopted||rainAdopted)store.commit(world,previous);
  let lastCommittedMinute=world.minute;
  const startSession=(head:World)=>createMvpSession({world:head,persistent:true,
   privateReadHeldAgedEat:disposableAgedTransfer?head=>store!.readDisposableHeldForNativeEating(head):undefined,
   privateAgedGroundDiscovery:disposableAgedTransfer?{
    readExactCurrentApproach:head=>store!.readDisposableCurrentGroundApproach(head),
    readExactActiveLot:head=>store!.readDisposableActiveGroundForNativeObservation(head),
    readExactPickupEvidence:head=>store!.readDisposableNativeGroundPickupEvidence(head),
   }:undefined,captureAtomicShelterEntries:ordinaryShelter?true:undefined,captureAddressedSpeechCustody:speechPin||speechPurpose||ordinarySpeech?true:undefined,captureSameSaveNativeWeather:privateOwner?.rulesWeatherAccountScope?true:undefined,captureAtomicNativeMeals:mealPin||ordinaryMeal?true:undefined,captureAtomicNativeFruitRenewal:nativeRenewal?true:undefined,captureNativeEmptyGroundMinute:nativeEmpty?true:undefined,captureAtomicNativeFruitLot:nativeRenewal?.lotShelfLifeGameMinutes||ordinaryMultiFruit?true:undefined,commit:(draft,revision,speech,meals)=>{
   owner!.assertOwned();assertDisposable?.();
   if(mealPin){
    if(draft.id!==mealPin.worldId)throw Error('mvp_rules_private_meal_world');
    store!.commitMvpWithAtomicMealCustody(draft,revision,meals??[]);
   }else if(ordinaryMeal)store!.commitOrdinaryNativeMeals(draft,revision,meals??[]);
   else if(ordinarySpeech)store!.commitMvpWithAddressedSpeech(draft,revision,speech);
   else if(speechPin){
    if(draft.id!==speechPin.worldId)throw Error('mvp_rules_private_speech_world');
    store!.commitMvpWithAddressedSpeech(draft,revision,speech);
   }else if(speechPurpose)store!.commitDisposableNativeSpeech(draft,revision,speechPurpose,speech);
   else store!.commit(draft,revision);
   const beforeMinute=lastCommittedMinute;
   const exactHour=nativeWeatherHourTransition(beforeMinute,draft.minute);
   const sample=!weatherCredit||exactHour;
   lastCommittedMinute=draft.minute;
   try{valleySpirit?.observe(publicWeatherProjection(draft),sample);}catch{valleySpirit?.isolate();}
   shadow?.onCommitted(draft);
   if(exactHour&&!draft.clock.paused)geographicProposalQueue?.onCommitted(beforeMinute,draft);}});
  session=startSession(world);
  if(speechPurpose&&privateDisposableSave)speechReader=openDisposableNativeSpeechReader(owner.database,privateDisposableSave,speechPurpose,()=>session!.world);
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
  if(ordinarySelection&&ordinaryMultiCandidate&&'lockPath' in owner){
   selection=openOrdinaryCandidateSelection(owner,ordinarySelection,
    ()=>session&&store&&valleySpirit?store.readCurrentOrdinaryMultiCandidate(session.world,ordinaryMultiCandidate,valleySpirit):null);
  }
  if(selectedRehearsal&&ordinaryMultiCandidate&&selection&&'lockPath' in owner)
   selectedReview=openSelectedOrdinaryRehearsal(owner,selectedRehearsal,()=>selection?.reviewProof()??null,
    (s,n)=>session&&store&&valleySpirit?store.readExactSelectedOrdinaryRehearsal(session.world,ordinaryMultiCandidate,valleySpirit,s,n):null);
  if(ordinaryMealView&&'lockPath' in owner)try{mealEditorialViewer=openOrdinaryMealEditorialViewer(owner,ordinaryMealView,()=>session!.world);}catch{/* objective meal view unavailable */}
  if(ordinaryHearingView&&'lockPath' in owner)try{hearingEditorialViewer=openOrdinaryHearingEditorialViewer(owner,ordinaryHearingView,()=>session!.world);}catch{/* objective hearing unavailable */}
  if(ordinaryShelterView&&'lockPath' in owner)try{shelterEditorialViewer=openOrdinaryShelterEditorialViewer(owner,ordinaryShelterView,()=>session!.world);}catch{/* objective shelter unavailable */}
  if(lifePin&&lifeReadable&&'lockPath' in owner)try{life=openPersistentRulesLifeFixture(owner,store,()=>session!.world,lifePin);}catch{/* no approved view */}
  if(!assertDisposable&&options.autoStart!==false)timer=setInterval(()=>session!.advance(1),tickMs);
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
  const readPrivateNativeFruitLot=()=>nativeRenewal?.lotShelfLifeGameMinutes&&session&&!session.world.clock.paused?store?.readCurrentNativeRulesFruitLot(session.world)??null:null;
  const readPrivateAgedFruitPreflight=()=>{
   if(!agedPreflight)return {status:'disabled',executionAuthorized:false} as const;
   if(!owner||!store||!geographicProposalQueue||!session||session.world.clock.paused||!queuePin)return unavailableAgedRulesPreflight();
   try{
    owner.assertOwned();
    return store.readCurrentNativeRulesAgedPreflight(session.world,queuePin,geographicProposalQueue);
   }catch{return unavailableAgedRulesPreflight();}
  };
  const readPrivateOrdinaryAgedGround=()=>agedGround&&session&&!store!.hasDisposableAgedTransfer()?agedGround.review(session.world):null;
  const readPrivateOrdinaryAgedG1Review=(signed?:unknown)=>{
   if(!ordinaryReview)return {status:'disabled',executionAuthorized:false} as const;
   try{
    // No caller-provided basis or ground capability. Both independent leases
    // recheck the actual common head, and the final queue read rechecks grant.
    const ground=readPrivateOrdinaryAgedGround(),basis=readPrivateAgedFruitPreflight();
    if(!ground||basis.status!=='blocked'||JSON.stringify(ground)!==JSON.stringify(readPrivateOrdinaryAgedGround())||
     JSON.stringify(basis)!==JSON.stringify(readPrivateAgedFruitPreflight()))return unavailableOrdinaryAgedG1();
    const encoded=prepareOrdinaryAgedG1ReviewEncoding(ordinaryReview,basis,ground,signed);
    if(encoded.status!=='encoding-only')return encoded;
    if(signed===undefined)return Object.freeze({...encoded,status:'g1-review-signing-input' as const});
    const advisory=inspectOrdinaryAgedG1Advisory(ordinaryReview,basis,ground,signed);
    if(!advisory||!queuePin||!store||!session)return unavailableOrdinaryAgedG1();
    const exactHead=store.load();
    if(!exactHead||exactHead.id!==basis.worldId||exactHead.revision!==basis.revision||minuteToClimateUs(exactHead.minute)!==basis.atUs)
     return unavailableOrdinaryAgedG1();
    const rehearsal=rehearseOrdinaryAgedG1(exactHead,queuePin.site,advisory,encoded.terms.untilUs);
    if(JSON.stringify(ground)!==JSON.stringify(readPrivateOrdinaryAgedGround())||
     JSON.stringify(basis)!==JSON.stringify(readPrivateAgedFruitPreflight()))return unavailableOrdinaryAgedG1();
    return Object.freeze({...encoded,status:'g1-review-verified' as const,advisory,rehearsal});
   }catch{return unavailableOrdinaryAgedG1();}
  };
  // The only decision owner is this stopped ordinary runtime closure. There
  // is no HTTP, G2, weather publication or automatic scheduler adapter.
  const g1DecisionUnavailable=()=>({status:g1DecisionEnabled?'unavailable' as const:'disabled' as const,executionAuthorized:false as const});
  let g1DecisionEpochReady=false;
  const withG1DecisionDb=<T>(write:boolean,fn:(db:DatabaseSync,database:string)=>T,bootstrap=false):T|ReturnType<typeof g1DecisionUnavailable>=>{
   if(!g1DecisionEnabled||!ordinaryReview||!owner||!('lockPath' in owner)||!session||!store||closing||
    !bootstrap&&!g1DecisionEpochReady)return g1DecisionUnavailable();
   try{
    owner.assertOwned();
    const database=owner.database,db=new DatabaseSync(database,{readOnly:!write});
    try{
     db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0');
     db.exec(write?'BEGIN IMMEDIATE':'BEGIN');
     const result=fn(db,database);
     owner.assertOwned();
     db.exec('COMMIT');
     return result;
    }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
   }catch{return g1DecisionUnavailable();}
  };
  if(g1DecisionEnabled)g1DecisionEpochReady=withG1DecisionDb(true,(db,database)=>{
   const saveScope=ordinaryG1DecisionSaveScope(database);
   return !!saveScope&&advanceOrdinaryG1DecisionEpoch(db,{worldId:session!.world.id,saveScope},ordinaryReview!.epoch,ordinaryReview!.keyId);
  },true)===true;
  const currentG1DecisionHead=(db:DatabaseSync,database:string)=>{
   const w=session!.world,h=readOrdinaryG1DecisionHead(db,database,w.id);
   return h&&h.revision===w.revision&&h.atUs===minuteToClimateUs(w.minute)?h:null;
  };
  const captureG1Decision=(db:DatabaseSync,database:string,review:unknown):OrdinaryG1DecisionTerms|null=>{
   const initial=currentG1DecisionHead(db,database);
   const reviewDigest=ordinaryG1DecisionReviewDigest(review);
   if(!initial||!reviewDigest)return null;
   const result=readPrivateOrdinaryAgedG1Review(review);
   if(result.status!=='g1-review-verified'||result.rehearsal.status!=='validated_detached'||
    result.terms.worldId!==initial.worldId||result.terms.revision!==initial.revision||result.terms.atUs!==initial.atUs||
    result.advisory.candidate.permissionVersion!==initial.permissionVersion||
    JSON.stringify(currentG1DecisionHead(db,database))!==JSON.stringify(initial))return null;
   const c=result.advisory.candidate,terms:OrdinaryG1DecisionTerms=Object.freeze({
    purpose:ORDINARY_G1_DECISION_PURPOSE,...initial,untilUs:result.terms.untilUs,epoch:result.terms.epoch,
    reviewerKeyId:result.terms.reviewerKeyId,proposalId:c.proposalId,opportunityId:c.opportunityId,inputSnapshotId:c.inputSnapshotId,
    sourceLotId:result.sourceLotId,targetId:result.targetId,reviewDigest,rehearsalDigest:ordinaryG1DecisionDigest(result.rehearsal),
    outcome:'validated_detached',
   });
   return ordinaryAgedG1DecisionSigningBytes(terms)?terms:null;
  };
  const g1DecisionView=(decisionId:string,terms:OrdinaryG1DecisionTerms)=>({
   status:'g1-detached-validated' as const,decisionId,terms,
   executionAuthorized:false as const,placementEligible:false as const,schedulingAuthorized:false as const,
  });
  const previewPrivateOrdinaryAgedG1Decision=(signedReview:unknown)=>withG1DecisionDb(false,(db,database)=>{
   const terms=captureG1Decision(db,database,structuredClone(signedReview));
   if(!terms)return g1DecisionUnavailable();
   // A malformed previously used annex is not a fresh review surface.
   readOrdinaryG1DecisionRecord(db,terms,terms.epoch,terms.reviewerKeyId);
   return {status:'g1-detached-decision-signing-input' as const,terms,executionAuthorized:false as const};
  });
  const commitPrivateOrdinaryAgedG1Decision=(signedReview:unknown,signedDecision:unknown)=>withG1DecisionDb(true,(db,database)=>{
   const review=structuredClone(signedReview),approval=structuredClone(signedDecision);
   const terms=captureG1Decision(db,database,review);
   if(!terms)return g1DecisionUnavailable();
   const result=appendOrdinaryG1Decision(db,terms,review,approval,ordinaryReview!.key);
   if(!result)return g1DecisionUnavailable();
   if(JSON.stringify(captureG1Decision(db,database,review))!==JSON.stringify(terms))throw Error('ordinary_g1_decision_stale_readback');
   return {...g1DecisionView(result.id,terms),replay:result.replay};
  });
  // Same owning SQLite transaction as the caller. No DTO supplied by a
  // caller or shadow queue is a live signed G1 decision.
  const captureLiveG1Decision=(db:DatabaseSync,database:string)=>{
   const current=currentG1DecisionHead(db,database);
   if(!current)return null;
   const record=readOrdinaryG1DecisionRecord(db,current,ordinaryReview!.epoch,ordinaryReview!.keyId);
   const terms=record&&captureG1Decision(db,database,record.review);
   const live=terms&&ordinaryAgedG1DecisionSigningBytes(terms),stored=record&&ordinaryAgedG1DecisionSigningBytes(record.terms);
   return record&&terms&&live&&stored&&live.equals(stored)?{record,terms,id:ordinaryG1DecisionHash(live)}:null;
  };
  const readPrivateOrdinaryAgedG1Decision=()=>withG1DecisionDb(false,(db,database)=>{
   const g1=captureLiveG1Decision(db,database);
   return g1?g1DecisionView(g1.id,g1.terms):g1DecisionUnavailable();
  });
  const g2HandoffUnavailable=()=>({status:g2Handoff?'unavailable' as const:'disabled' as const,approvalPresent:false as const,
   executionAuthorized:false as const,placementEligible:false as const,schedulingAuthorized:false as const,reservationAuthorized:false as const});
  const withG2HandoffDb=<T>(write:boolean,fn:(db:DatabaseSync,database:string)=>T):T|ReturnType<typeof g2HandoffUnavailable>=>{
   if(!g2Handoff||!g1DecisionEpochReady)return g2HandoffUnavailable();
   const result=withG1DecisionDb(write,(db,database)=>({value:fn(db,database)}));
   return 'value' in result?result.value:g2HandoffUnavailable();
  };
  const captureG2Handoff=(db:DatabaseSync,database:string)=>{
   const g1=captureLiveG1Decision(db,database);
   return g1&&encodeOrdinaryG2BlockedHandoffTerms(g1.record,g2Handoff!.keyId);
  };
  const g2HandoffView=(receiptId:string,terms:OrdinaryG2BlockedHandoffTerms)=>({
   ...g2HandoffUnavailable(),status:'execution-blocked' as const,receiptId,terms,blockers:ORDINARY_G2_HANDOFF_BLOCKERS,
  });
  const previewPrivateOrdinaryG2BlockedHandoff=()=>withG2HandoffDb(false,(db,database)=>{
   const terms=captureG2Handoff(db,database);
   if(!terms)return g2HandoffUnavailable();
   const stored=readOrdinaryG2HandoffRecord(db,terms);
   if(stored&&!sameOrdinaryG2HandoffTerms(stored.terms,terms))return g2HandoffUnavailable();
   return {...g2HandoffUnavailable(),status:'g2-blocked-handoff-review-signing-input' as const,terms,blockers:ORDINARY_G2_HANDOFF_BLOCKERS};
  });
  const commitPrivateOrdinaryG2BlockedHandoff=(signedHandoff:unknown)=>withG2HandoffDb(true,(db,database)=>{
   const signed=structuredClone(signedHandoff),terms=captureG2Handoff(db,database);
   if(!terms)return g2HandoffUnavailable();
   const receipt=appendOrdinaryG2BlockedHandoff(db,terms,signed,g2Handoff!.key);
   if(!receipt)return g2HandoffUnavailable();
   const still=captureG2Handoff(db,database);
   if(!still||!sameOrdinaryG2HandoffTerms(terms,still))throw Error('ordinary_g2_handoff_stale_readback');
   return {...g2HandoffView(receipt.id,terms),replay:receipt.replay};
  });
  const readPrivateOrdinaryG2BlockedHandoff=()=>withG2HandoffDb(false,(db,database)=>{
   const terms=captureG2Handoff(db,database);
   if(!terms)return g2HandoffUnavailable();
   const stored=readOrdinaryG2HandoffRecord(db,terms),bytes=ordinaryG2BlockedHandoffSigningBytes(terms);
   return stored&&bytes&&sameOrdinaryG2HandoffTerms(stored.terms,terms)?
    g2HandoffView(ordinaryG1DecisionHash(bytes),terms):g2HandoffUnavailable();
  });
  let rebaseRequired=false;
  const transactPrivateDisposableAgedTransfer=(g1?:unknown,g2?:unknown)=>{
   if(!disposableAgedTransfer||!queuePin||!agedGroundPin||!geographicProposalQueue||!owner||!('lockPath' in owner)||!store||!session)return null;
   const result=store.transactDisposableAgedTransfer(owner,session.world,queuePin,agedGroundPin,geographicProposalQueue,g1,g2);
   if(result?.status==='placed'&&!result.replay){
    rebaseRequired=true;
    try{
     const committed=store.load();
     if(!committed||committed.id!==session.world.id||committed.minute!==session.world.minute||
      committed.revision!==result.receipt.placementRevision)throw Error('invalid_committed_head');
     session=startSession(committed);
     rebaseRequired=false;
    }catch{throw Error('disposable_native_aged_transfer_committed_reopen_required');}
   }
   return result;
  };
  const readPrivateDisposableNativeAgedFairness=()=>{
   owner!.assertOwned();assertDisposable?.();
   const w=session!.world;
   return store!.readDisposableNativeAgedFairness({worldId:w.id,revision:w.revision,atUs:minuteToClimateUs(w.minute)});
  };
  const readPrivateDisposableResidentGroundDiscovery=(residentId:string)=>{
   if(!disposableAgedTransfer||!session||session.world.clock.paused||!store)return null;
   const w=session.world;
   return store.readDisposableResidentGroundDiscovery({worldId:w.id,revision:w.revision,atUs:minuteToClimateUs(w.minute)},residentId);
  };
  return {get session(){return session!;},server,snapshot,...(selectedRehearsal?{previewPrivateSelectedOrdinaryRehearsal:()=>selectedReview?.preview()??null,rehearsePrivateSelectedOrdinaryCandidate:(input:unknown)=>selectedReview?.run(input)??null}:{}),...(ordinarySelection?{previewPrivateOrdinaryMultiSelection:()=>selection?.preview()??null,selectPrivateOrdinaryMultiCandidate:(input:unknown)=>selection?.select(input)??Promise.resolve(null),readPrivateOrdinaryMultiSelection:()=>selection?.latest()??null}:{}),...(ordinaryMultiCandidate?{readPrivateOrdinaryMultiCandidate:()=>session&&store&&valleySpirit?store.readCurrentOrdinaryMultiCandidate(session.world,ordinaryMultiCandidate,valleySpirit):null}:{}),...(ordinaryMultiFruit?{readPrivateOrdinaryMultiFruit:()=>session&&store?store.readCurrentOrdinaryNativeMultiFruit(session.world):null}:{}),...(ordinaryShelter?{readPrivateOrdinaryNativeShelter:()=>session&&store?store.readOrdinaryNativeShelterAtHead(session.world):null}:{}),...(ordinarySpeech?{readPrivateOrdinaryNativeSpeech:(eventId:string)=>session&&store?store.readOrdinaryNativeSpeechAtHead(session.world,eventId):null}:{}),...(ordinaryMeal?{readPrivateOrdinaryNativeMeal:(eventId:string)=>session&&store?store.readOrdinaryNativeMealAtHead(session.world,eventId):null}:{}),readPrivateDisposableNativeSpeech:(head:Readonly<DisposableSpeechHead>)=>speechReader?.latest(head)??null,transactPrivateDisposableAgedTransfer,readPrivateDisposableNativeAgedFairness,readPrivateDisposableResidentGroundDiscovery,disposableRebaseRequired:()=>rebaseRequired,readPrivateSpiritCandidate,readPrivateSpiritGeographicProposal,readPrivateNativeFruitRenewal,readPrivateNativeFruitLot,readPrivateAgedFruitPreflight,readPrivateOrdinaryAgedGround,readPrivateOrdinaryAgedG1Review,previewPrivateOrdinaryAgedG1Decision,commitPrivateOrdinaryAgedG1Decision,readPrivateOrdinaryAgedG1Decision,previewPrivateOrdinaryG2BlockedHandoff,commitPrivateOrdinaryG2BlockedHandoff,readPrivateOrdinaryG2BlockedHandoff,close};
 }catch(error){await close();throw error;}
}
