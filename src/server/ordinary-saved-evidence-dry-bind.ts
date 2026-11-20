/** Stopped, private orchestration. No ordinary startup, network, or effect capability. */
import {createHash} from 'node:crypto';
import type {World} from '../shared/types.js';
import {climateAt,minuteToClimateUs} from '../world/mvp-climate.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import {assertMvpClimateWorld} from '../world/mvp-climate-state.js';
import {assertMvpWorld} from './godot-mvp-persistent.js';
import {createDryDeploymentTrust} from './dry-deployment-trust.js';
import {acquireRuntimeOwnership} from './runtime-lock.js';
import {preflightWorldSave,SaveCompatibilityError} from './save-preflight.js';
import {pinOrdinaryAgedGround,readNativeOrdinaryEmptyGroundCheckpoint,type OrdinaryAgedGroundPin} from './valley-spirit-ordinary-aged-ground.js';
import {ordinaryG1DecisionSaveScope} from './valley-spirit-ordinary-g1-decision.js';
import {rehearseDetachedNativeLot} from './valley-spirit-ordinary-g1-rehearsal.js';
import {pinRulesNativeFruitRenewal,readRulesNativeFruitLot,type RulesNativeFruitRenewalPin} from './valley-spirit-rules-fruit-renewal.js';
import {currentClosedRain} from './valley-spirit-persistent-rules-shadow.js';
import {valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';
import {publicWeatherProjection,readExistingPublicWeatherJournal} from './valley-spirit.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';

type Trust=ReturnType<typeof createDryDeploymentTrust>;
type Witness=Parameters<Trust['inspectOrdinary']>[1];
type Boot=Readonly<{database:string;trust:NonNullable<Parameters<typeof createDryDeploymentTrust>[0]>;
 ground:OrdinaryAgedGroundPin;fruit:RulesNativeFruitRenewalPin;maxRainAgeGameMinutes:number}>;
type Reason='unconfigured'|'original-scope-unavailable'|'ordinary-save-unavailable'|'native-exact-basis-missing'|'rain-or-permission-missing'|'native-rehearsal-unavailable';
type Captured={evidence:Witness;verifyWeather:()=>boolean;verifySnapshot:()=>boolean};
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const blocked=(reason:Reason)=>({status:'unavailable' as const,reason,liveAuthorized:false as const,migrationPolicyAvailable:false as const});
/** Keys, clock, path, original inode digest and site policy are provided once
 * by trusted boot code. Requests may supply only the signed envelope. */
export function createOrdinarySavedEvidenceDryBind(boot?:Boot){
 const config=(()=>{
  try{
   if(!boot||typeof boot.database!=='string'||!boot.database||boot.database===':memory:'||
    !Number.isInteger(boot.maxRainAgeGameMinutes)||boot.maxRainAgeGameMinutes<1||boot.maxRainAgeGameMinutes>120)return null;
   const ground=pinOrdinaryAgedGround(boot.ground),fruit=pinRulesNativeFruitRenewal(boot.fruit),scope=boot.trust.scope;
   if(!ground||!fruit?.lotShelfLifeGameMinutes||ground.worldId!==fruit.worldId||ground.sourceId!==fruit.sourceId||
    ground.worldId!==scope.worldId||typeof scope.originDigest!=='string'||!/^[a-f0-9]{64}$/.test(scope.originDigest))return null;
   return {database:boot.database,scopeDigest:scope.originDigest,ground,fruit,maxRainAgeGameMinutes:boot.maxRainAgeGameMinutes,
    trust:createDryDeploymentTrust(boot.trust)};
  }catch{return null;}
 })();
 const capture=(request?:{chain:Parameters<Trust['inspectOrdinary']>[0]})=>{
  if(!config)return blocked('unconfigured');
  const {database,scopeDigest,ground,fruit,maxRainAgeGameMinutes}=config;
  let owner:ReturnType<typeof acquireRuntimeOwnership>|undefined;
  try{
   owner=acquireRuntimeOwnership(database,{existingOnly:true});
   const original=owner.database;
   owner.assertOwned();
   if(ordinaryG1DecisionSaveScope(original)!==scopeDigest)return blocked('original-scope-unavailable');
   let captured:Captured|undefined,reason:Reason='native-exact-basis-missing';
   preflightWorldSave(original,{requireWorld:true,nativeEmptyGround:ground,
    validateWorld(value){const w=value as unknown as World;assertMvpWorld(w);assertMvpClimateWorld(w);},
    inspectOptionalAlmanac(db,value){
     const w=value as unknown as World;
     if(w.id!==ground.worldId||w.mode!=='validation'||w.clock.paused||w.simulationOnly||Object.hasOwn(w,'mvpSeasonalModelVersion'))return;
     const checkpoint=readNativeOrdinaryEmptyGroundCheckpoint(db,w,ground),lot=readRulesNativeFruitLot(db,fruit,w);
     const geometry=inspectMvpGroundFruitGeography(w,ground.sourceId,ground.target);
     if(!checkpoint||!lot||!geometry||geometry.source.ownerId!=='commons'||
      geometry.source.resourceInstanceId!==checkpoint.sourceResourceInstanceId||geometry.targetId!==checkpoint.targetId)return;
     reason='rain-or-permission-missing';
     const head=publicWeatherProjection(w),rain=currentClosedRain(w,maxRainAgeGameMinutes),grant=readValleySpiritWeatherPermission(db,w.id);
     if(!head||!rain||!grant?.publicWeather)return;
     const weather=readExistingPublicWeatherJournal(original,head,grant);
     const row=weather?.entries.slice().reverse().find(e=>e.permissionVersion===grant.version&&e.fact.condition==='rain'&&e.fact.precipitationPermille>0&&
      BigInt(e.fact.atUs)>=BigInt(rain.firstRainUs)&&BigInt(e.fact.atUs)<BigInt(rain.endedUs));
     if(!weather||!row)return;
     const actual=climateAt(w.seed,row.fact.minute);
     const fields=['atUs','condition','temperatureDeciC','relativeHumidityPermille','cloudPermille','windPermille','daylightPermille','precipitationPermille'] as const;
     if(actual.condition!=='rain'||fields.some(k=>actual[k]!==row.fact[k]))return;
     const rainPoint=[row.entryId,row.fact.minute,...fields.map(k=>actual[k])];
     reason='native-rehearsal-unavailable';
     const atUs=minuteToClimateUs(w.minute),opportunityId=valleySpiritFruitFallOpportunityId(w.id,rain.rainEventId,checkpoint.sourceResourceInstanceId);
     const expiry=[BigInt(lot.lot.expiresUs),BigInt(rain.endedUs)+BigInt(maxRainAgeGameMinutes)*1_000_000n].sort((a,b)=>a<b?-1:a>b?1:0)[0].toString();
     const rehearsal=rehearseDetachedNativeLot(w,ground,{worldId:w.id,opportunityId,sourceResourceInstanceId:checkpoint.sourceResourceInstanceId,
      targetId:checkpoint.targetId,rainEventId:rain.rainEventId,atUs,reviewUntilUs:expiry,lot:{...lot.lot,ownerId:'commons'}});
     if(rehearsal.status!=='validated_detached')return;
     const evidence:Witness=Object.freeze({headDigest:checkpoint.headDigest,opportunityDigest:hash(['ordinary-saved-opportunity/v1',w.id,opportunityId]),
      kind:'native-aged-fruit-ground-placement',units:1,
      sourceDigest:hash(['ordinary-saved-source/v1',checkpoint.sourceResourceInstanceId,lot.lot,'commons',rain,grant.version,rainPoint,expiry]),
      targetDigest:hash(['ordinary-saved-target/v1',checkpoint.targetId,checkpoint.checkpointDigest,ground.target])});
     const verifySnapshot=()=>{
      let exact=false;
      preflightWorldSave(original,{requireWorld:true,nativeEmptyGround:ground,inspectOptionalAlmanac(checkDb,saved){
       const current=saved as unknown as World,currentGrant=readValleySpiritWeatherPermission(checkDb,current.id);
       const currentCheckpoint=readNativeOrdinaryEmptyGroundCheckpoint(checkDb,current,ground);
       const currentLot=readRulesNativeFruitLot(checkDb,fruit,current);
       exact=!!currentGrant?.publicWeather&&currentGrant.version===grant.version&&!!currentCheckpoint&&!!currentLot&&
        hash(currentCheckpoint)===hash(checkpoint)&&hash(currentLot)===hash(lot);
      }});
      return exact;
     };
     captured={evidence,verifySnapshot,verifyWeather:()=>readExistingPublicWeatherJournal(original,head,grant)?.raw===weather.raw};
    }});
   owner.assertOwned();
   if(ordinaryG1DecisionSaveScope(original)!==scopeDigest)return blocked('original-scope-unavailable');
   if(!captured)return blocked(reason);
   if(!captured.verifyWeather())return blocked('rain-or-permission-missing');
   if(!request)return {status:'ready' as const,evidence:captured.evidence,liveAuthorized:false as const,migrationPolicyAvailable:false as const};
   const result=config.trust.inspectOrdinary(request.chain,captured.evidence);
   if(result.admitted&&!captured.verifySnapshot())return blocked('native-exact-basis-missing');
   owner.assertOwned();
   if(ordinaryG1DecisionSaveScope(original)!==scopeDigest)return blocked('original-scope-unavailable');
   if(!captured.verifyWeather())return blocked('rain-or-permission-missing');
   return result.admitted?Object.freeze({status:'signed-evidence-only' as const,liveAuthorized:false as const,migrationPolicyAvailable:false as const}):
    Object.freeze({status:'denied' as const,reason:result.reason,liveAuthorized:false as const,migrationPolicyAvailable:false as const});
  }catch(e){
   return blocked(e instanceof SaveCompatibilityError?'ordinary-save-unavailable':'original-scope-unavailable');
  }finally{owner?.release();}
 };
 return Object.freeze({
  preview:()=>capture(),
  inspect:(chain:Parameters<Trust['inspectOrdinary']>[0])=>capture({chain}),
 });
}
