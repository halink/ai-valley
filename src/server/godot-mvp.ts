import {captureAgedGroundApproach,hasAgedGroundApproachCapture,isDeclinedAgedGroundRacePickup,selectAgedGroundApproach,stoppedCurrentAgedGroundApproach,type AgedGroundApproachWitness} from '../world/mvp-native-aged-ground-approach.js';
import {captureOrdinaryAgedGroundDiscovery,prepareOrdinaryNativePickupIntents,prepareOrdinaryNativeGroundApproach,type OrdinaryAgedGroundNativePickupRead,type OrdinaryAgedGroundDiscoveryRead,type NativeOrdinaryAgedDiscovery} from '../world/mvp-ordinary-aged-ground-discovery.js';
import {AGED_DINING_INVALID,AGED_EAT_INVALID,type NativeAgedEatCompletion,captureMvpNativeAgedEat,hasDisposableAgedDiningCapture,selectMvpNativeAgedEat,wasDisposableAgedDiningSeatDecline,type NativeAgedEatSelection} from '../world/mvp-aged-fruit-native-eat.js';
import {captureMvpNativeAgedPickup,selectMvpNativeAgedPickup,type NativeAgedPickupSelection} from '../world/mvp-aged-fruit-native-pickup.js';
import {nativeWeatherHourTransition} from './valley-spirit-weather-credit.js';
import {captureMvpNativeObservationPhase} from '../world/mvp-native-observation-phase.js';
import {planMvpFallenFruitAdjacentApproach,unsafeMvpApproachEndpoint} from './valley-spirit-mvp-fallen-fruit-approach.js';
import {observeMvpFallenFruit} from '../world/mvp-fallen-fruit-resident.js';
import {captureAddressedSpeech,type AddressedSpeechObservation} from '../world/addressed-speech.js';
import type {ValleySpiritLifeViewer,ValleySpiritPublishedLifeView} from './valley-spirit-life-publisher.js';
import {captureValleySpiritMvpMealStep,type ValleySpiritMvpMealWitness} from './valley-spirit-meal-custody.js';
import {parseValleySpiritAlmanacId,parseValleySpiritTopicWindow,type ValleySpiritPublicReaders} from './valley-spirit-reader.js';
import {parseWeatherArchiveQuery,publicWeatherProjection,type PublicWeatherFact,type ValleySpiritJournal} from './valley-spirit.js';
import {mvpMealObservation} from './mvp-meal-observation.js';
import {seasonalPersonalWeather} from './mvp-seasonal-context.js';
import {personallyFeelsRain,shelterRoomWithinIdleTime,MVP_IDLE_WAIT_MINUTES} from '../world/mvp-shelter.js';
import {preservationPreparation} from './mvp-preservation-policy.js';
import {adoptMvpPreservation,preservationObservation,validateMvpPreservation} from '../world/mvp-preservation.js';
import {mvpNutritionBuffer,mvpEdibleQuantity} from './mvp-nutrition-buffer.js';
import {goods} from '../shared/items.js';
import {adoptMvpAgriculture,agricultureObservation,agricultureReason,plantTarget,canSow,agriculturePlot} from '../world/mvp-agriculture.js';
import {CULTIVARS,cultivarKeys,temperatureFactor} from '../shared/mvp-agriculture.js';
import {adoptMvpSoil,soilObservation} from '../world/mvp-soil.js';
import {adoptMvpResources,captureMvpFruitFlowStep,captureMvpFruitRenewalStep,mvpResourceItem,type MvpFruitRenewalWitness,type MvpFruitFlowBatch} from '../world/mvp-resources.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {adoptMvpClimate,validateMvpClimate} from '../world/mvp-climate-state.js';
import {inheritReceiptHistory} from '../world/receipts.js';
import {adoptMvpSeeds,isMvpSeedAction} from '../world/mvp-seeds.js';
import {serveGodotWeb} from './godot-web.js';
import {roomObservation} from './room-observation.js';
import {relationshipObservation} from './relationship-observation.js';
import {expandMvpHamlet} from '../world/mvp-hamlet.js';
import {layOutMvpGardens,widenMvpValley} from '../world/mvp-valley.js';
import {COMPACT_MVP_MAP,hasMvpHamlet,MVP_HALL} from '../shared/mvp-hamlet.js';
import {adoptMvpRooms} from '../world/mvp-rooms.js';
import {adoptMvpDrinking,mvpThirst} from '../world/mvp-drinking.js';
import {mvpObservation} from './mvp-observation.js';
import {enableCompletedMovement,forkCompletedMovement,completedMovementSnapshot,residentMovementSnapshot} from '../world/completed-movement.js';
/** Small, disposable engineering MVP. Rules choose actions; the existing world
 * engine owns pathfinding, needs, elapsed work and resource/food settlement.
 * This is NOT LLM autonomy, a formal save, or a longevity acceptance run. */
import {createHash,randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {createWorld} from '../world/seed.js';
import {stepWorld,submitPlan,planStartError} from '../world/engine.js';
import {distance,same} from '../world/navigation.js';
import {barterTerms} from '../shared/barter.js';
import {canContactSocialTarget} from '../world/social-observation.js';
import {berryApproachPath,canContactBerry} from '../world/berry-observation.js';
import {canContactSpring,springApproachPath} from '../world/spring-observation.js';
import {VALLEY_VERSION} from '../shared/version.js';
import type {Action,Resident,Snapshot,Tile,Vec,World} from '../shared/types.js';

export const GODOT_MVP_PORT=3414;
export const GODOT_MVP_NOTICE='隔离核心循环：本地规则驱动，非真实模型；内存世界，退出后重置';
export type MvpPhase='deciding'|'travelling'|'gathering'|'eating'|'resting'|'waiting'|'stopped'|'drinking'|'talking'|'planting'|'watering'|'harvesting'|'cooking'|'preserving'|'inspecting'|'installing'|'sheltering';
export function mvpPhase(r:Resident):MvpPhase {
 if(r.status!=='alive')return 'stopped';
 if(!r.activity)return 'deciding';
 if(r.activity.path.length||r.activity.room?.path.length)return 'travelling';
 if(r.activity.action.type==='mvpShelter'&&r.inside===MVP_HALL&&r.roomAt&&Number.isFinite(r.activity.mvpShelterEnteredAt))return 'sheltering';
 if(r.activity.action.type==='mvpInspect')return 'inspecting';
 if(r.activity.action.type==='mvpPreservation')return r.activity.action.operation==='install'?'installing':'preserving';
 return ({cook:'cooking',plant:'planting',water:'watering',harvest:'harvesting',talk:'talking',mvpDrink:'drinking',gather:'gathering',eat:'eating',sleep:'resting',wait:'waiting'} as const)[r.activity.action.type as 'gather'|'eat'|'sleep'|'wait']??'waiting';
}
export function createMvpWorld():World {
 const world=createWorld(3414);
 const {width,height}=COMPACT_MVP_MAP,tiles:Tile[]=Array(width*height).fill('grass');
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(x===0||y===0||x===width-1||y===height-1)tiles[y*width+x]='cliff';
  else if(x>=27)tiles[y*width+x]='water';
  else if(y===14||x===15&&y>=12)tiles[y*width+x]='path';
 }
 world.id='godot-mvp-'+randomUUID();
 world.map={width,height,tiles,name:'溪畔小院 · 核心循环',entrance:{x:15,y:22},settlement:{x:15,y:13}};
 world.residents=world.residents.slice(0,2);
 const home={...world.buildings.find(b=>b.id==='lodge')!,id:MVP_HALL,name:'共屋',at:{x:11,y:6},width:8,height:6,door:{x:15,y:12},residents:world.residents.map(r=>r.id),capacity:2};
 world.buildings=[home];
 world.resources=[
  ...[{x:7,y:13},{x:22,y:14},{x:8,y:19},{x:21,y:20}].map((at,index)=>({id:'mvp-berry-'+index,kind:'bush' as const,at,amount:12,max:12,regrowthDays:1,lastHarvest:0})),
  {id:'mvp-spring',kind:'spring',at:{x:25,y:14},amount:10000,max:10000,regrowthDays:1,lastHarvest:0},
 ];
 world.plots=world.residents.map((r,i)=>({id:'mvp-garden-'+i,ownerId:r.id,at:{x:18+i*3,y:18},crop:null}));world.graves=[];world.events=[];
 // Explicit finite starting seeds; the ordinary crop recipe still takes four watered days.
 world.definitions['action/mvp-garden@1']={id:'action/mvp-garden',version:1,kind:'action',dependencies:['crop/turnip@1'],data:{}};
 world.definitions['action/mvp-cooking@1']={id:'action/mvp-cooking',version:1,kind:'action',dependencies:['recipe/meal@1'],data:{}};
 for(const [index,r]of world.residents.entries()){
  r.at={x:14+index*2,y:14};r.homeId=home.id;r.inside=null;r.roomAt=null;
  r.inventory={seed:2};r.hunger=index===0?65:25;r.energy=index===0?85:50;
  r.knownPeople=world.residents.filter(p=>p.id!==r.id).map(p=>p.id);
  r.knownBuildings=[home.id];r.knownResources=world.resources.map(s=>s.id);
  r.intention='本地规则：观察当前需要';
 }
 world.clock={paused:false,reason:null,realMinutesPerDay:12};
 adoptMvpDrinking(world);
 adoptMvpRooms(world);
 expandMvpHamlet(world);
 widenMvpValley(world);
 layOutMvpGardens(world);
 adoptMvpSeeds(world);
 adoptMvpResources(world,true);
 for(const r of world.residents)r.knownResources=world.resources.map(s=>s.id);
 return world;
}
/** A two-portion carried reserve covers the MVP's nominal daily water need.
 * Selection never credits stock; the engine owns travel and collection. */
function mvpWaterTrip(w:World,r:Resident):Action|null {
 const missing=Math.max(0,Math.floor(2-(r.inventory.water??0)));
 if(!missing)return null;
 const source=w.resources.filter(s=>s.kind==='spring'&&s.amount>=1&&s.floodDamage?.clearedAt!==null&&r.knownResources.includes(s.id))
  .sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at))
  .find(s=>springApproachPath(w,r.at,s)!==null);
 return source?{type:'gather',resourceId:source.id,quantity:Math.min(missing,Math.floor(source.amount))}:null;
}
/** No global information is claimed to be a resident's model knowledge. This
 * deliberately bounded engineering policy is visibly labelled in snapshots. */
function mvpPlanDefinition(w:World,action:Action){return action.type==='mvpPreservation'?'action/mvp-preservation@1':action.type==='cook'?'action/mvp-cooking@1':['plant','water','harvest'].includes(action.type)?'action/mvp-garden@1':w.activeDefinitions['action/routine'];}
function mvpCanStart(w:World,r:Resident,action:Action):boolean {
 return planStartError(w,{id:'mvp-exchange-preview',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:mvpPlanDefinition(w,action),intention:'本地规则：行动预检',actions:[action]})===null;
}
export function chooseMvpAction(w:World,r:Resident):{action:Action;reason:string;idleFallback?:true} {
 // Each recipient chooses independently, using exact received terms and its
 // own supplies. No automatic acceptance, distant stock probe, or free food.
 const wantsFood=(r.inventory.berry??0)<1&&(r.inventory.water??0)>=2;
 const wantsWater=(r.inventory.water??0)<1&&(r.inventory.berry??0)>=2&&r.hunger<35;
 if((wantsFood||wantsWater)&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9){
  const offer=w.offers.find(o=>o.targetId===r.id&&o.status==='open'&&o.expiresAt>w.minute
   &&Object.keys(o.give).length===1&&Object.keys(o.want).length===1
   &&(wantsFood&&o.give.berry===1&&o.want.water===1||wantsWater&&o.give.water===1&&o.want.berry===1)
   &&w.residents.some(p=>p.id===o.actorId&&canContactSocialTarget(w,r,p)));
  if(offer){
   const action:Action={type:'accept',offerId:offer.id,offerTerms:barterTerms(offer)};
   if(mvpCanStart(w,r,action))return {action,reason:wantsFood?'本地规则独立接受当面报价：用一份富余清水换一份浆果，交付后再决定进食':'本地规则独立接受当面报价：用一份富余浆果换一份清水，交付后再决定饮用'};
  }
 }
 // Buffer planning must not tighten the established permission to eat.
 // Ordinary eating reserves at most one root when no seed is held; severe
 // hunger can use even that root. Cooking/buffer estimates use fuller goals.
 const reserveRoot=(r.inventory.seed??0)<1&&(r.inventory.turnip??0)>=1&&r.hunger<80;
 const newFood=cultivarKeys.map(c=>CULTIVARS[c]).find(d=>(r.inventory[d.root]??0)>=((r.inventory[d.seed]??0)<1&&r.hunger<80?2:1))?.root;
 const food=(r.inventory.meal??0)>=1?'meal':newFood??((r.inventory.turnip??0)>=(reserveRoot?2:1)?'turnip':(r.inventory.fruit??0)>=1?'fruit':(r.inventory.berry??0)>=1?'berry':'preserve');
 if(food==='berry'||food==='preserve'){
  const aged=selectMvpNativeAgedEat(w,r);
  if(aged)return {action:aged,reason:aged.type==='mvpAgedFruitEat'&&aged.dining?'带着仍未到期的本人随身果实，前往本人的共屋餐位':'无更高优先的本人食物或餐位，留在原处吃仍未到期的随身果实'};
 }
 if(r.hunger>=35&&r.hunger<80&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9&&(r.inventory[food]??0)>=1){const action:Action={type:'eat',item:food,mvpAtTable:true};if(mvpCanStart(w,r,action))return {action,reason:'带着自己的食物回共屋餐桌进食，不共享或凭空补充口粮'};}
 if(r.hunger>=35&&(r.inventory[food]??0)>=1)return {action:{type:'eat',item:food},reason:'饥饿且带有一整份自有食物，优先餐食、根菜和鲜果，缺少鲜食时可吃本人罐藏'};
 // Immediate needs come before optional stocking: an empty bag must not
 // send a thirsty or exhausted resident on a food-reserve trip.
 if(r.hunger>=35){
  const newRipe=w.plots.find(p=>p.ownerId===r.id&&p.crop?.mvpCrop&&p.crop.growth>=CULTIVARS[p.crop.mvpCrop.cultivar].days);
  if(newRipe?.crop?.mvpCrop){const action:Action={type:'mvpAgriculture',operation:'harvest',cultivar:newRipe.crop.mvpCrop.cultivar,target:plantTarget(w,newRipe)};if(mvpCanStart(w,r,action))return {action,reason:'饥饿且没有口粮，先收获本人已成熟的新根菜'};}
  const ripe=w.plots.find(p=>p.ownerId===r.id&&p.id.startsWith('mvp-garden-')&&p.crop&&!p.crop.mvpCrop&&p.crop.growth>=Number(w.definitions[p.crop.definition]?.data.growthDays));
  if(ripe){const action:Action={type:'harvest',plotId:ripe.id};if(mvpCanStart(w,r,action))return {action,reason:'饥饿且没有随身食物，收获自己的成熟根菜'};}
  const source=w.resources.filter(s=>s.kind==='bush'&&s.amount>=1&&r.knownResources.includes(s.id)).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at)).find(s=>berryApproachPath(w,r.at,s)!==null);
  if(source)return {action:{type:'gather',resourceId:source.id,quantity:Math.min(3,Math.floor(source.amount))},reason:'前往已知果丛，采集有限整份食物'};
 }
 if((mvpThirst(w,r)??0)>=50-1e-9){
  if((r.inventory.water??0)>=1)return {action:{type:'mvpDrink'},reason:'口渴，选择饮用一份随身清水'};
  const action=mvpWaterTrip(w,r);
  if(action)return {action,reason:'口渴且没有清水，前往泉水补足两份随身清水储备'};
 }
 if(r.energy<70){
  const action:Action={type:'sleep',minutes:120};
  // Preview on the engine's isolated copy: invalid homes, occupied/missing
  // beds and blocked approaches must not freeze this rule-only demo.
  // Execution still rechecks changes after selection; never grant free rest.
  const problem=planStartError(w,{id:'mvp-rest-preview',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本地规则：休息可行性预检',actions:[action]});
  if(problem===null)return {action,reason:'返回共屋休息，恢复精力'};
 }
 // Remain available briefly after quoting, but never suppress urgent needs.
 const pending=w.offers.find(o=>o.actorId===r.id&&o.status==='open'&&o.expiresAt>w.minute+225);
 if(pending&&r.hunger<35&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9
  &&w.residents.some(p=>p.id===pending.targetId&&canContactSocialTarget(w,r,p)))
  return {action:{type:'wait',minutes:5},reason:'在原处短暂等候对方独立决定，不自动成交'};
 // Offer only one's own surplus, without assuming the other person's needs
 // or consent. Existing offers provide a finite cooldown even when ignored.
 if(r.hunger<35&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9
  &&((r.inventory.berry??0)>=3&&(r.inventory.water??0)<1||(r.inventory.water??0)>=2&&(r.inventory.berry??0)<1)
  &&!w.offers.some(o=>o.actorId===r.id&&w.minute<o.expiresAt+120)){
  const target=w.residents.find(p=>p.id!==r.id&&p.canExpress&&(!p.activity||p.activity.action.type==='wait')&&canContactSocialTarget(w,r,p));
  if(target){
   const giveWater=(r.inventory.water??0)>=2&&(r.inventory.berry??0)<1;
   const action:Action={type:'offer',targetId:target.id,give:giveWater?{water:1}:{berry:1},want:giveWater?{berry:1}:{water:1}};
   if(mvpCanStart(w,r,action))return {action,reason:giveWater?'向眼前熟人提出一份清水换一份浆果，等待对方独立选择；规则示例':'向眼前熟人提出一份浆果换一份清水，等待对方独立选择；规则示例'};
  }
 }
 // Keep the remaining portion; replenish only after the carried supply runs out.
 const waterTrip=(r.inventory.water??0)<1?mvpWaterTrip(w,r):null;
 if(waterTrip)return {action:waterTrip,reason:'当前紧急需求已处理，前往已知泉水补足两份清水储备'};
 const agriculture=chooseAgricultureRule(w,r);if(agriculture)return agriculture;
 // Preserve a route back into planting before cooking away the final root.
 if(r.hunger<35&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9&&(r.inventory.seed??0)<1&&w.mvpSeeds&&!w.mvpAgriculture){
  const action:Action|null=(r.inventory.turnip??0)>=1?{type:'mvpSaveSeed'}:w.mvpSeeds.stock>=1&&w.plots.some(p=>p.ownerId===r.id&&p.id.startsWith('mvp-garden-')&&!p.crop)?{type:'mvpCollectSeed'}:null;
  const busy=w.residents.some(p=>p.id!==r.id&&p.activity&&isMvpSeedAction(p.activity.action));
  if(action&&!busy&&mvpCanStart(w,r,action))return {action,reason:action.type==='mvpSaveSeed'?'用自己一份根菜留出两份下轮种子':'到灶堂领取一份有限种子，实际到场扣减种源'};
 }
 // A personal cooked meal uses real roots and water; never reserve scarce drinking water.
 if(r.hunger<35&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9&&mvpEdibleQuantity(w,r,'turnip')>=2&&(r.inventory.meal??0)<1){
  const kitchenId=hasMvpHamlet(w)?MVP_HALL:r.homeId??undefined;
  if((r.inventory.water??0)<2){const trip=mvpWaterTrip(w,r);if(trip)return {action:trip,reason:'为自己的根菜餐食取水，并保留一份饮水'};}
  else if(!w.residents.some(p=>p.id!==r.id&&(hasMvpHamlet(w)||p.homeId===r.homeId)&&(p.activity?.action.type==='cook'||p.plan?.actions.some(a=>a.type==='cook')))){
   const action:Action={type:'cook',quantity:1,buildingId:kitchenId};
   if(mvpCanStart(w,r,action))return {action,reason:'回共屋厨房，用本人两份根菜和一份水做一份餐食'};
  }
 }
 // Garden only after personal needs/reserves; no borrowed seeds or water.
 if(r.hunger<35&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9){
  const plots=w.plots.filter(p=>p.ownerId===r.id&&p.id.startsWith('mvp-garden-')&&!p.crop?.mvpCrop&&(p.crop||!w.mvpAgriculture)).sort((a,b)=>Number(!!b.crop)-Number(!!a.crop));
  for(const plot of plots){
   const crop=plot.crop,days=crop?Number(w.definitions[crop.definition]?.data.growthDays):0;
   const action:Action|null=crop&&crop.growth>=days?{type:'harvest',plotId:plot.id}:!crop&&(r.inventory.seed??0)>=1?{type:'plant',plotId:plot.id}:crop&&crop.wateredDay!==Math.floor(w.minute/1440)&&(r.inventory.water??0)>=2?{type:'water',plotId:plot.id}:null;
   if(action&&mvpCanStart(w,r,action))return {action,reason:action.type==='plant'?'用自己的有限种子播种小菜园':action.type==='water'?'保留一份饮水，用另一份清水浇灌自己的菜园':'收获自己已经成熟的根菜'};
   if(crop&&crop.growth<days&&crop.wateredDay!==Math.floor(w.minute/1440)&&(r.inventory.water??0)<2){const trip=mvpWaterTrip(w,r);if(trip)return {action:trip,reason:'为菜园取水，同时保留本人饮水储备'};}
  }
 }
 // A nominal nutrition buffer is a low-priority rule preference, never a
 // guarantee of two days without supply. Critical farming above stays first.
 if(r.hunger<35&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9){
  const buffer=mvpNutritionBuffer(w,r);
  if(buffer.deficit>1e-9){
   const sources=w.resources.filter(source=>source.kind==='bush'&&source.amount>=1&&r.knownResources.includes(source.id)).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at));
   for(const source of sources){
    const item=mvpResourceItem(w,source),nutrition=goods[item].food;
    if(nutrition<=0||berryApproachPath(w,r.at,source)===null)continue;
    const action:Action={type:'gather',resourceId:source.id,quantity:Math.min(3,Math.floor(source.amount),Math.ceil(buffer.deficit/nutrition))};
    if(mvpCanStart(w,r,action))return {action,reason:'基本需求与可执行耕作已处理，真实采集本人名义两日营养缓冲的缺口；不代表冬储充足'};
   }
  }
 }
 // A greeting is a performed, finite action, not a model-generated dialogue.
 // Only address a known person already in actual contact; never pursue them.
 const recentlySpoke=w.events.some(e=>e.kind==='conversation'&&e.actors.includes(r.id)&&w.minute-e.at<360);
 if(r.canExpress&&!recentlySpoke&&r.hunger<35&&(mvpThirst(w,r)??0)<50-1e-9&&r.energy>=70&&(r.inventory.berry??0)>=3&&(r.inventory.water??0)>=1){
  const target=w.residents.find(p=>p.id!==r.id&&p.canExpress&&(!p.activity||p.activity.action.type==='wait')&&(!p.plan||p.plan.actions.every(a=>a.type==='wait'))&&canContactSocialTarget(w,r,p));
  if(target){
   const action:Action={type:'talk',targetId:target.id,text:'〔规则示例问候〕你好，愿你今天在山谷过得顺利。',tone:'friendly'};
   const error=planStartError(w,{id:'mvp-greeting-preview',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本地规则：向眼前空闲熟人问候',actions:[action]});
   if(error===null)return {action,reason:'基本需求已处理，向眼前空闲熟人问候；固定规则示例，不是模型对话'};
  }
 }
 if(r.hunger<35&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9){const preparation=preservationPreparation(w,r);if(preparation&&mvpCanStart(w,r,preparation.action))return preparation;}
 // Replace only the previous outdoor idle fallback. Keep a five-point
 // margin from urgent needs and limit the real journey, never skip duties.
 if(r.hunger<=30&&r.energy>=75&&(mvpThirst(w,r)??0)<=45&&personallyFeelsRain(w,r)){
  if(shelterRoomWithinIdleTime(w,r))
   return {action:{type:'mvpShelter'},reason:'本人在户外察觉雨水，其他行动已处理，选择步行到共屋前室短候'};
 }
 return {action:{type:'wait',minutes:MVP_IDLE_WAIT_MINUTES},reason:'当前没有可执行的规则行动，短暂等待',idleFallback:true};
}
/** Rule-only farming preference. Engine permissions never enforce these quotas. */
function chooseAgricultureRule(w:World,r:Resident):{action:Action;reason:string}|null {
 if(!w.mvpAgriculture||r.hunger>=35||r.energy<70||(mvpThirst(w,r)??0)>=50)return null;
 const active=cultivarKeys.find(c=>canSow(w,c));if(!active)return null;
 const d=CULTIVARS[active],plots=w.plots.filter(p=>p.ownerId===r.id).sort((a,b)=>a.id.localeCompare(b.id));
 const attempt=(action:Action,reason:string)=>mvpCanStart(w,r,action)?{action,reason}:null;
 for(const p of plots)if(p.crop?.mvpCrop&&p.crop.growth>=CULTIVARS[p.crop.mvpCrop.cultivar].days){const out=attempt({type:'mvpAgriculture',operation:'harvest',cultivar:p.crop.mvpCrop.cultivar,target:plantTarget(w,p)},'收获本人已成熟的新根菜，保留有限种源闭环');if(out)return out;}
 const goal=plots.length>0?plots.length+1:0;
 if((r.inventory[d.seed]??0)<goal&&(r.inventory[d.root]??0)>=1){const out=attempt({type:'mvpAgriculture',operation:'saveSeed',cultivar:active},'用本人一根留种，为下一轮每田一份及一份私人备种；不是引擎上限');if(out)return out;}
 for(const c of cultivarKeys){const def=CULTIVARS[c];if(mvpEdibleQuantity(w,r,def.root)>=2&&(r.inventory.meal??0)<1){if((r.inventory.water??0)<2){const a=mvpWaterTrip(w,r);if(a)return {action:a,reason:'烹饪前补足本人用水，并保留饮用水'};}else{const out=attempt({type:'mvpAgriculture',operation:'cook',cultivar:c},'用本人两份同种根菜和一水烹饪餐食');if(out)return out;}}}
 const candidates=plots.filter(p=>!p.crop||p.crop.mvpCrop?(!p.crop||temperatureFactor(p.crop.mvpCrop!.cultivar,w.mvpClimate!.current.temperatureDeciC)===0):(w.definitions[p.crop.definition]?.data.seasons as string[]).includes(calendarSeason(w))===false);
 const targets=candidates.map(p=>plantTarget(w,p,!!p.crop));
 if(w.mvpAgriculture.grants[active].stock>0){for(const target of targets){const a:Action={type:'mvpAgriculture',operation:'collectSeed',cultivar:active,target,targets};if(!agricultureReason(w,r,a)){const out=attempt(a,'只领取当前合法田地实际缺口的有限种子，已有种子逐田抵扣');if(out)return out;}}}
 for(const p of candidates){if((r.inventory[d.seed]??0)<1)break;const a:Action=p.crop?{type:'mvpAgriculture',operation:'clear',cultivar:active,target:plantTarget(w,p,true)}:{type:'mvpAgriculture',operation:'plant',cultivar:active,target:plantTarget(w,p)};const out=attempt(a,p.crop?'已备本人替代种，再自主清除停长作物；清田不返种产粮':'用本人有限新种子在合法季节播种');if(out)return out;}
 for(const p of plots)if(p.crop?.mvpCrop&&p.crop.growth<CULTIVARS[p.crop.mvpCrop.cultivar].days){const soil=w.mvpSoil!.plots.find(s=>s.plotId===p.id)!;if(BigInt(soil.current.water)<35n*1440000000000000n){if((r.inventory.water??0)<2){const a=mvpWaterTrip(w,r);if(a)return {action:a,reason:'为新作物取水，并保留本人饮水'};}else{const out=attempt({type:'water',plotId:p.id,expectedInstanceId:p.crop.mvpCrop.instanceId},'按实际PAW选择灌溉，不按旧雨日或今日已浇判断');if(out)return out;}}}
 return null;
}
function calendarSeason(w:World){return ['spring','summer','autumn','winter'][Math.floor(w.minute/1440/28)%4];}
type SessionWeatherReading=Pick<PublicWeatherFact,'minute'|'condition'|'temperatureDeciC'|'relativeHumidityPermille'>;
type SessionWeather={schemaVersion:1;worldId:string;worldRevision:number;atMinute:number;readings:SessionWeatherReading[]};

interface RuleMinuteCapture {sealedReplayFruitFlow?:true;meals:boolean;fruitFlow:boolean;fruitRenewal:boolean;addressedSpeech:boolean;}
/** Existing resident choices and exactly one engine minute on an existing
 * detached draft. No caller-supplied action, commit, split tick or delivery. */
function advanceMvpRuleMinuteDraft(world:World,current:World,serial:number,decisions:Record<string,number>,capture:RuleMinuteCapture,approach?:NonNullable<ReturnType<typeof planMvpFallenFruitAdjacentApproach>>){
 const newGather=new Map<string,{planId:string;resourceId:string;quantity:number}>();
 for(const r of world.residents){
  if(r.status!=='alive'||r.activity||r.plan)continue;
  let choice=chooseMvpAction(world,r);
  const planId=`mvp-rule-${world.id}-${world.revision}-${r.id}-${++serial}`;
  if(approach?.residentId===r.id){
   const live=planMvpFallenFruitAdjacentApproach(world);
   if(choice.idleFallback!==true||!live||live.residentId!==r.id||live.residentRevision!==approach.residentRevision||
    live.discoveryId!==approach.discoveryId||!same(live.from,approach.from)||!same(live.to,approach.to))
    throw Error('mvp_adjacent_idle_or_basis_changed');
   choice={action:{type:'move',to:{...approach.to}},reason:'本人已发现一格外的落果，闲候前走到同一地面'};
  }
  if(choice.idleFallback){
   const nativePickup=selectMvpNativeAgedPickup(world,r);
   if(nativePickup)choice={action:nativePickup,reason:'本人的原生观察已发现此果，闲候前亲手拾起'};
  }
  if(choice.idleFallback){
   const endpoint=selectAgedGroundApproach(world,r,planId);
   if(endpoint)choice={action:{type:'move',to:endpoint},reason:'闲候前短暂步行'};
  }
  const result=submitPlan(world,{id:planId,actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:mvpPlanDefinition(world,choice.action),intention:'本地规则：'+choice.reason,actions:[choice.action]});
  if(!result.ok)throw new Error(`MVP plan rejected for ${r.id}: ${result.error}`);
  if(choice.action.type==='gather'){
   const {resourceId,quantity}=choice.action;
   const source=world.resources.find(s=>s.id===resourceId);
   if(source&&Number.isFinite(source.amount)&&source.amount>=quantity)newGather.set(r.id,{planId,resourceId,quantity});
  }
  decisions[r.id]=(decisions[r.id]??0)+1;
 }
 // A neighbour may finish harvesting after this resident chose a source.
 // Keep the engine's rejected action (no inventory credit), then let the
 // next tick choose from current stock instead of freezing the whole demo.
 const gathering=new Map(world.residents.map(r=>[r.id,r.activity?.action]));
 const shelterWorkers=new Set(world.residents.filter(r=>r.activity?.action.type==='mvpShelter'||r.plan?.actions[0]?.type==='mvpShelter').map(r=>r.id));
 const activityPlans=new Map(world.residents.map(r=>[r.id,r.activity?.planId]));
 const ownedDiningPlans=hasDisposableAgedDiningCapture(world)?new Map(world.residents.filter(r=>r.activity?.action.type==='mvpAgedFruitEat'||
  r.plan?.actions.some(a=>a.type==='mvpAgedFruitEat'&&a.dining)).map(r=>[r.id,r.activity?.planId??r.plan?.id])):null;
 const approachPlans=hasAgedGroundApproachCapture(world)?new Map(world.residents.map(r=>[r.id,r.activity?.planId??r.plan?.id])):null;
 const actionFailures:import('../world/engine.js').StepActionFailure[]=[];
 const optional:{stageMealWitnesses?:()=>readonly ValleySpiritMvpMealWitness[]}={};
 const advanceEngine=()=>{
  if(capture.meals)optional.stageMealWitnesses=captureValleySpiritMvpMealStep(world,{actionFailures});
  else stepWorld(world,1,{actionFailures});
 };
 let stageRenewal:(()=>readonly MvpFruitRenewalWitness[])|undefined;
 let readFlow:(()=>MvpFruitFlowBatch|null)|undefined;
 const advanceObservedEngine=()=>{
  if(capture.fruitFlow){
   const flow=captureMvpFruitFlowStep(world,current,advanceEngine,capture.sealedReplayFruitFlow===true);
   stageRenewal=flow.readRenewal;readFlow=flow.readFlow;
  }else if(capture.fruitRenewal)
   stageRenewal=captureMvpFruitRenewalStep(world,advanceEngine);
  else advanceEngine();
 };
 let speech:AddressedSpeechObservation|undefined;
 if(capture.addressedSpeech)
  speech=captureAddressedSpeech(world,advanceObservedEngine);
 else advanceObservedEngine();
 for(const failed of world.residents.filter(r=>r.lastFailure)){
  if(ownedDiningPlans&&wasDisposableAgedDiningSeatDecline(world,failed,ownedDiningPlans.get(failed.id)))continue;
  if(approachPlans&&(stoppedCurrentAgedGroundApproach(world,failed,approachPlans.get(failed.id))||
   isDeclinedAgedGroundRacePickup(world,failed,approachPlans.get(failed.id))))continue;
  const action=gathering.get(failed.id);
  const fresh=newGather.get(failed.id);
  // A live start rejected only after a same-tick stock change is not a
  // world fault. Older plans, unverified depletion and malformed targets do not
  // get recovery from an error message (or any other typed failure).
  if(fresh&&actionFailures.some(f=>f.code==='resource_stock_depleted_before_gather'&&f.actionType==='gather'&&
   f.actorId===failed.id&&f.planId===fresh.planId&&f.resourceId===fresh.resourceId&&f.quantity===fresh.quantity&&f.available<fresh.quantity))continue;
  if(action?.type==='talk'&&actionFailures.some(f=>f.actorId===failed.id&&f.planId===activityPlans.get(failed.id)&&f.actionType==='talk'&&f.code==='room_slot_contended'))continue;
  if(action?.type==='mvpAgedFruitEat'&&(failed.lastFailure===AGED_EAT_INVALID||failed.lastFailure===AGED_DINING_INVALID))continue;
  if(action?.type==='mvpAgriculture'||action?.type==='mvpPreservation'||shelterWorkers.has(failed.id))continue;
  if(action&&isMvpSeedAction(action)&&['灶堂有限种源已领完','这处实际工位正在被另一项劳动占用'].includes(failed.lastFailure!))continue;
  const source=action?.type==='gather'?world.resources.find(s=>s.id===action.resourceId):undefined;
  const depleted=action?.type==='gather'&&source&&source.amount<action.quantity&&distance(failed.at,source.at)<=1
   &&(source.kind!=='bush'||canContactBerry(world,failed,source))
   &&(source.kind!=='spring'||canContactSpring(world,failed,source));
  if(failed.lastFailure==='资源或实际位置已经变化'&&depleted)continue;
  // A listener may leave while the finite utterance is being performed.
  // Keep the engine's failure, without inventing speech or freezing time.
  if(failed.lastFailure==='对方已经不在能够交谈的位置'&&action?.type==='talk')continue;
  // A quoted counterparty or stock may change before actual settlement.
  // The engine rejects atomically; retry policy next tick, never credit goods.
  if((action?.type==='offer'||action?.type==='accept')&&[
   '须另一位在场的实际当事人，不能与自己虚构交换','报价物品或本人实际库存无效','对方还有未处理的报价',
   '报价已经失效或没有交给本人','报价已经失效','交易须有两位不同的实际在场当事人','任一方的实际库存已不足',
   '当前没有实际可见且可接近的交流对象，须先前往寻找','当前视野内没有找到对方，须先前往寻找',
  ].includes(failed.lastFailure!))continue;
  throw new Error(`MVP action failed for ${failed.id}: ${failed.lastFailure}`);
 }
 validateMvpClimate(world);validateMvpPreservation(world);
 world.revision=Math.max(world.revision,current.revision+1);
 // Resolve fresh staged evidence on this draft. Delivery is a separate,
 // strictly post-commit responsibility of the session.
 let witnesses:readonly ValleySpiritMvpMealWitness[]=[];
 if(optional.stageMealWitnesses)try{witnesses=optional.stageMealWitnesses();}catch{/* optional custody */}
 let renewal:readonly MvpFruitRenewalWitness[]=[];
 if(stageRenewal)try{renewal=stageRenewal();}catch{/* optional observation */}
 let fruitFlow:MvpFruitFlowBatch|null=null;
 if(readFlow)try{fruitFlow=readFlow();}catch{/* optional observation */}
 return {serial,speech,witnesses,renewal,fruitFlow};
}

/** Internal exact native minute for the sealed store only. Input is the
 * authoritative head, not a resident ID, coordinates, plan, or callback. */
export function prepareSealedMvpAdjacentMinute(current:World){
 const approach=planMvpFallenFruitAdjacentApproach(current);
 if(!approach)return null;
 const draft=structuredClone(current);
 inheritReceiptHistory(current,draft);enableCompletedMovement(draft);
 const base=completedMovementSnapshot(draft);
 if(!base)return null;
 try{
  const result=advanceMvpRuleMinuteDraft(draft,current,0,{},{
   meals:true,fruitFlow:false,fruitRenewal:false,addressedSpeech:true,
  },approach);
  const after=completedMovementSnapshot(draft),r=draft.residents.find(p=>p.id===approach.residentId);
  const edges=after?.steps.filter(e=>e.actorId===approach.residentId&&e.seq>base.lastSeq);
  if(draft.minute!==current.minute+1||after?.epoch!==base.epoch||edges?.length!==1||
   edges[0].minute!==draft.minute||!same(edges[0].from,approach.from)||!same(edges[0].to,approach.to)||
   !r?.activity||r.activity.action.type!=='move'||!same(r.activity.action.to,approach.to)||r.activity.path.length||
   !draft.processed.includes('plan:'+r.activity.planId)||r.lastFailure||r.inside!==null||!same(r.at,approach.to)||unsafeMvpApproachEndpoint(draft,approach.to)||
   !observeMvpFallenFruit(draft,r.id).some(s=>s.discoveryId===approach.discoveryId)||
   JSON.stringify(draft.mvpClimate?.spiritEffects)!==JSON.stringify(current.mvpClimate?.spiritEffects)||
   JSON.stringify(draft.mvpClimate?.spiritFruitSettlement)!==JSON.stringify(current.mvpClimate?.spiritFruitSettlement))
   return null;
  return {draft,approach,speech:result.speech,mealWitnesses:result.witnesses,planId:r.activity.planId};
 }catch{return null;}
}

/** One detached ordinary ecology minute without any supplied resident action.
 * Only the sealed store may commit it with custody. */
export function prepareSealedMvpEcologyMinute(current:World,captureMeals=false,privateFruitPoint?:Vec,privatePickup?:ReadonlyMap<string,NativeAgedPickupSelection>,privateEat?:NativeAgedEatSelection,sealedReplayFruitFlow?:true){
 if(current.mode!=='validation'||current.clock.paused||!current.mvpClimate?.rainProvenance)return null;
 const draft=structuredClone(current);
 inheritReceiptHistory(current,draft);enableCompletedMovement(draft);
 try{
  const advance=()=>advanceMvpRuleMinuteDraft(draft,current,0,{},{meals:captureMeals,fruitFlow:sealedReplayFruitFlow===true,fruitRenewal:true,addressedSpeech:true,sealedReplayFruitFlow});
  const observe=()=>privateFruitPoint?captureMvpNativeObservationPhase(draft,privateFruitPoint,advance):{result:advance(),observed:[],arrivals:[]};
  const pickup=()=>privatePickup?captureMvpNativeAgedPickup(draft,privatePickup,observe):{result:observe(),completion:null};
  const eating=privateEat?captureMvpNativeAgedEat(draft,privateEat,pickup):{result:pickup(),completion:null};
  const scoped=eating?.result;
  if(!scoped?.result)return null;
  const {result,observed,arrivals}=scoped.result;
  if(draft.minute!==current.minute+1||
   JSON.stringify(draft.mvpClimate?.spiritEffects)!==JSON.stringify(current.mvpClimate?.spiritEffects)||
   JSON.stringify(draft.mvpClimate?.spiritFruitSettlement)!==JSON.stringify(current.mvpClimate?.spiritFruitSettlement))return null;
  return {draft,fruitFlow:result.fruitFlow,renewal:result.renewal,mealWitnesses:result.witnesses,speech:result.speech,observed,completion:scoped.completion,eaten:eating?.completion??null,movement:arrivals};
 }catch{return null;}
}

/** One normal chooser/engine minute for the stopped ordinary archive only.
 * The provided read port is built from the verified owning snapshot. */
export function prepareStoppedOrdinaryAgedGroundMinute(current:World,ownedGround:OrdinaryAgedGroundDiscoveryRead){
 if(current.mode!=='validation'||current.clock.paused||!current.mvpClimate?.rainProvenance||
  Object.hasOwn(current.mvpClimate,'spiritEffects')||Object.hasOwn(current.mvpClimate,'spiritFruitSettlement'))return null;
 const draft=structuredClone(current);
 inheritReceiptHistory(current,draft);enableCompletedMovement(draft);
 try{
  const {result,observed}=captureOrdinaryAgedGroundDiscovery(draft,ownedGround,()=>
   advanceMvpRuleMinuteDraft(draft,current,0,{},{meals:true,fruitFlow:false,fruitRenewal:false,addressedSpeech:true}));
  if(draft.minute!==current.minute+1||result.speech?.receipts.length||result.witnesses.length)return null;
  return {draft,observed};
 }catch{return null;}
}

/** Existing narrowly selected source-credit fixture: no credit means no tick. */
export function prepareSealedMvpFruitCreditMinute(current:World,sourceId:string){
 if(!/^mvp-supply-fruit-[0-9]{1,12}$/.test(sourceId))return null;
 const next=prepareSealedMvpEcologyMinute(current,true);
 const witnesses=next?.renewal.filter(w=>w.sourceId===sourceId);
 return next&&witnesses?.length===1?{...next,witness:witnesses[0]}:null;
}

const postCommitFruitFlows=new WeakMap<MvpFruitFlowBatch,{sessionToken:symbol;deliveredSequence:number}>();
/** Exact in-process delivery from the session's trusted commit callback.
 * Not a database receipt or a verifier for a caller-supplied commit backend. */
export function isPostCommitMvpFruitFlow(value:unknown):value is MvpFruitFlowBatch {
 return typeof value==='object'&&value!==null&&postCommitFruitFlows.has(value as MvpFruitFlowBatch);
}
/** A cloned world cannot extend observations from a different session. */
export function followsPostCommitMvpFruitFlow(previous:MvpFruitFlowBatch,next:MvpFruitFlowBatch):boolean {
 const before=postCommitFruitFlows.get(previous),after=postCommitFruitFlows.get(next);
 return !!before&&!!after&&before.sessionToken===after.sessionToken&&after.deliveredSequence===before.deliveredSequence+1;
}
export type DisposableNativePickupWitness=Readonly<{
 residentId:string;effectId:string;discoveryId:string;planId:string;settledUs:string;startedAt:number;
}>;
const atomicNativeMealMinutes=new WeakMap<World,Readonly<{before:string;after:string}>>();
const atomicNativeRenewalMinutes=new WeakMap<World,Readonly<{before:string;after:string;renewal:readonly MvpFruitRenewalWitness[];flow:MvpFruitFlowBatch|null;groundObserved?:readonly NativeOrdinaryAgedDiscovery[];groundPickup?:DisposableNativePickupWitness;agedEaten?:NativeAgedEatCompletion;agedEatingScope?:NativeAgedEatSelection;agedApproach?:AgedGroundApproachWitness}>>();
export function readAtomicNativeRulesRenewal(previous:World,draft:World){
 const recorded=atomicNativeRenewalMinutes.get(draft);
 return recorded&&recorded.before===sameSaveWorldFingerprint(previous)&&recorded.after===sameSaveWorldFingerprint(draft)?recorded:undefined;
}
const sameSaveNativeWeatherMinutes=new WeakMap<World,Readonly<{before:string;after:string}>>();
// Validation saves persist the complete JSON World. Bind to that exact
// serialized content (including private state, order, and all arrays), using
// a process-local digest only. A SQLite decode preserves that JSON shape.
// Undefined fields omitted by persistence do not authorize extra state.
const sameSaveWorldFingerprint=(w:World)=>createHash('sha256').update('same-save-native-minute/v1\0')
 .update(JSON.stringify(w),'utf8').digest('hex');
function sealNativeWeatherMinute(previous:World,draft:World){
 if(draft.id===previous.id&&draft.revision>previous.revision&&nativeWeatherHourTransition(previous.minute,draft.minute))
  sameSaveNativeWeatherMinutes.set(draft,Object.freeze({before:sameSaveWorldFingerprint(previous),after:sameSaveWorldFingerprint(draft)}));
}
/** Detached/altered state cannot reuse a native minute marker, even when the
 * public projection, identifiers, and clock are all identical. */
export function isSameSaveNativeWeatherMinute(previous:World,draft:World):boolean{
 const observed=sameSaveNativeWeatherMinutes.get(draft);
 return !!observed&&observed.before===sameSaveWorldFingerprint(previous)&&observed.after===sameSaveWorldFingerprint(draft);
}
export function isAtomicNativeMealMinute(previous:World,draft:World):boolean{
 const observed=atomicNativeMealMinutes.get(draft);
 return !!observed&&observed.before===sameSaveWorldFingerprint(previous)&&observed.after===sameSaveWorldFingerprint(draft);
}
export function createMvpSession(options:{observeSessionWeather?:true;world?:World;commit?:(world:World,previousRevision:number,speech?:AddressedSpeechObservation,atomicMeals?:readonly ValleySpiritMvpMealWitness[])=>void;persistent?:boolean;captureAddressedSpeechCustody?:true;captureSameSaveNativeWeather?:true;captureAtomicNativeMeals?:true;captureAtomicNativeFruitRenewal?:true;captureAtomicNativeFruitLot?:true;captureNativeEmptyGroundMinute?:true;privateAgedGroundDiscovery?:OrdinaryAgedGroundNativePickupRead;privateReadHeldAgedEat?:(head:{worldId:string;revision:number;atUs:string})=>NativeAgedEatSelection|null;observeCommittedMeals?:(witnesses:readonly ValleySpiritMvpMealWitness[])=>void;observeCommittedFruitRenewal?:(witnesses:readonly MvpFruitRenewalWitness[])=>void;observeCommittedFruitFlow?:(flow:MvpFruitFlowBatch)=>void}={}){
 const fruitFlowSessionToken=Symbol();let deliveredFruitFlowSequence=0;
 let world=structuredClone(options.world??createMvpWorld());
 if(options.world)inheritReceiptHistory(options.world,world);
 const initialRevision=world.revision;
 const climateAdopted=adoptMvpClimate(world),soilAdopted=adoptMvpSoil(world),agricultureAdopted=adoptMvpAgriculture(world),preservationAdopted=adoptMvpPreservation(world);
 if(climateAdopted||soilAdopted||agricultureAdopted||preservationAdopted){world.revision++;options.commit?.(world,initialRevision);}
 enableCompletedMovement(world);
 let serial=0,fault:string|null=null;
 const decisions:Record<string,number>={};
 // Session observations never mint archive or life authority and never persist.
 const observesWeather=options.observeSessionWeather===true&&!options.world&&!options.persistent&&!options.commit;
 let sessionWeather:SessionWeather|undefined;
 function observeCommittedWeather() {
  if(!observesWeather)return;
  const fact=publicWeatherProjection(world);
  if(!fact){sessionWeather=undefined;return;}
  const {worldId,worldRevision,minute,condition,temperatureDeciC,relativeHumidityPermille}=fact;
  const readings=sessionWeather?.readings??[];
  const last=readings.at(-1);
  const current={minute,condition,temperatureDeciC,relativeHumidityPermille};
  if(!last||Math.floor(last.minute/60)!==Math.floor(minute/60))readings.push(current);
  else readings[readings.length-1]=current;
  if(readings.length>6)readings.shift();
  sessionWeather={schemaVersion:1,worldId,worldRevision,atMinute:minute,readings};
 }
 observeCommittedWeather();
 const snapshot=():Snapshot&{roomViews:ReturnType<typeof roomObservation>}&{observation:ReturnType<typeof mvpObservation>;relationshipHistory:ReturnType<typeof relationshipObservation>}&{movement:ReturnType<typeof completedMovementSnapshot>;residentMovement:ReturnType<typeof residentMovementSnapshot>}&{valleySpiritSessionWeather?:SessionWeather;mvp:{driver:'local-rules';notice:string;ephemeral:boolean;fault:string|null;phases:Record<string,MvpPhase>;decisions:Record<string,number>;environment:NonNullable<World['mvpClimate']>['current'];soil:ReturnType<typeof soilObservation>;agriculture:ReturnType<typeof agricultureObservation>;preservation:ReturnType<typeof preservationObservation>;residentWeather:{schemaVersion:1;atMinute:number;resident:Record<string,ReturnType<typeof seasonalPersonalWeather>>};mealObservation:ReturnType<typeof mvpMealObservation>;nutritionBuffer:ReturnType<typeof mvpNutritionBuffer>[]}}=>({
  ...(sessionWeather?.worldId===world.id&&sessionWeather.worldRevision===world.revision&&sessionWeather.atMinute===world.minute
   ?{valleySpiritSessionWeather:structuredClone(sessionWeather)}:{}),
  roomViews:roomObservation(world),observation:mvpObservation(world,[],[]),relationshipHistory:relationshipObservation(world),movement:completedMovementSnapshot(world),residentMovement:residentMovementSnapshot(world),world:structuredClone(world),serverTime:new Date().toISOString(),version:VALLEY_VERSION,mapRevision:'godot-mvp-map-4',
  capabilities:{active:['小地图只读观察','本地规则采集/进食/休息闭环','有限面对面规则问候','独立选择的食水交换','同源气候与田地水账','三品种温水生长与实际耕收','本人感知与共屋短时避雨','本人名义两日营养缓冲','真实罐藏与批次到期（鲜食腐坏未模拟）',...(options.persistent?['规则存档与恢复']:[])],pending:['真实模型决策验收','全年冬储充分性','最终绘本素材']},
  // Read the published, validated point state. Legacy crop rain is separate;
  // soil water is exact; legacy crops and model decisions do not consume PAW.
  mvp:{driver:'local-rules',notice:options.persistent?'持久规则小山谷：本地规则驱动，非真实模型':GODOT_MVP_NOTICE,ephemeral:!options.persistent,fault,phases:Object.fromEntries(world.residents.map(r=>[r.id,mvpPhase(r)])),decisions:{...decisions},environment:structuredClone(world.mvpClimate!.current),soil:soilObservation(world),agriculture:agricultureObservation(world),preservation:preservationObservation(world),residentWeather:{schemaVersion:1,atMinute:world.minute,resident:Object.fromEntries(world.residents.map(r=>[r.id,seasonalPersonalWeather(world,r)]))},mealObservation:mvpMealObservation(world),nutritionBuffer:world.residents.map(r=>mvpNutritionBuffer(world,r))},
 });
 const advance=(minutes=1)=>{
  if(!Number.isInteger(minutes)||minutes<1||minutes>60)throw new Error('MVP advances must be 1–60 whole world minutes');
  if(fault||world.clock.paused)return;
  try{
   for(let tick=0;tick<minutes;tick++){
    const current=world,previousSerial=serial,previousDecisions={...decisions};
    const draft=structuredClone(current);inheritReceiptHistory(current,draft);forkCompletedMovement(current,draft);
    world=draft;
    try{
    const advanceNative=()=>advanceMvpRuleMinuteDraft(world,current,serial,decisions,{
     meals:!!(options.persistent&&options.commit&&(options.captureAtomicNativeMeals||options.observeCommittedMeals)),
     fruitFlow:!!(options.persistent&&options.commit&&(options.observeCommittedFruitFlow||options.captureAtomicNativeFruitLot)),
     fruitRenewal:!!(options.persistent&&options.commit&&(options.observeCommittedFruitRenewal||options.captureAtomicNativeFruitRenewal)),
     addressedSpeech:!!(options.persistent&&options.commit&&options.captureAddressedSpeechCustody),
    });
    const owned=options.persistent&&options.commit?options.privateAgedGroundDiscovery:undefined;
    const head={worldId:current.id,revision:current.revision,atUs:minuteToClimateUs(current.minute)};
    const priorApproach=owned?.readExactCurrentApproach?.(head)??null;
    const intents=owned?prepareOrdinaryNativePickupIntents(current,owned):undefined;
    const approachIntents=owned&&!priorApproach&&!intents?.size?prepareOrdinaryNativeGroundApproach(current,owned):new Map();
    const advanceObserved=()=>owned?captureOrdinaryAgedGroundDiscovery(world,owned,advanceNative):{result:advanceNative(),observed:undefined};
    const wrapped=()=>priorApproach||approachIntents.size?captureAgedGroundApproach(world,approachIntents,priorApproach,advanceObserved):
     {result:advanceObserved(),witness:undefined};
    const pickup=intents?.size?captureMvpNativeAgedPickup(world,intents,wrapped):null;
    if(intents?.size&&!pickup)throw Error('disposable_native_pickup_scope_conflict');
    const scope=options.persistent&&options.commit?options.privateReadHeldAgedEat?.({worldId:current.id,revision:current.revision,atUs:minuteToClimateUs(current.minute)}):null;
    if(scope&&pickup)throw Error('disposable_native_dual_custody');
    const eating=scope?captureMvpNativeAgedEat(world,scope,wrapped):null;
    if(scope&&!eating)throw Error('disposable_native_eating_scope_conflict');
    const route=pickup?pickup.result:eating?eating.result:wrapped(),scoped=route.result;
    const chosen=pickup?.completion,selected=chosen?intents?.get(chosen.residentId):undefined;
    if(chosen&&!selected)throw Error('disposable_native_pickup_missing_selection');
    const groundPickup=chosen&&selected?Object.freeze({...chosen,effectId:selected.effectId,discoveryId:selected.discoveryId}):undefined;
    const minute=scoped.result;
    serial=minute.serial;
    const {speech,witnesses,renewal,fruitFlow}=minute;
    if(options.persistent&&options.commit&&options.captureSameSaveNativeWeather)sealNativeWeatherMinute(current,world);
    const atomic=options.persistent&&options.commit&&options.captureAtomicNativeMeals;
    if(atomic&&witnesses.length&&world.minute===current.minute+1)
     atomicNativeMealMinutes.set(world,Object.freeze({before:sameSaveWorldFingerprint(current),after:sameSaveWorldFingerprint(world)}));
    if(options.persistent&&options.commit&&(options.captureNativeEmptyGroundMinute||options.captureAtomicNativeFruitLot||options.captureAtomicNativeFruitRenewal&&renewal.length))
     atomicNativeRenewalMinutes.set(world,Object.freeze({before:sameSaveWorldFingerprint(current),after:sameSaveWorldFingerprint(world),renewal,flow:fruitFlow,groundObserved:scoped.observed,groundPickup,agedEaten:eating?.completion??undefined,agedEatingScope:scope??undefined,agedApproach:route.witness}));
    try{
     if(atomic)options.commit?.(world,current.revision,speech,witnesses);
     else if(speech?.receipts.length)options.commit?.(world,current.revision,speech);
     else options.commit?.(world,current.revision);
    }finally{
     if(options.captureSameSaveNativeWeather)sameSaveNativeWeatherMinutes.delete(draft);
     if(options.captureAtomicNativeMeals)atomicNativeMealMinutes.delete(draft);
     if(options.captureAtomicNativeFruitRenewal||options.captureAtomicNativeFruitLot||options.captureNativeEmptyGroundMinute)atomicNativeRenewalMinutes.delete(draft);
    }
    try{observeCommittedWeather();}catch{sessionWeather=undefined;}
    if(witnesses.length)try{options.observeCommittedMeals?.(witnesses);}catch{/* committed world is independent */}
    if(renewal.length)try{options.observeCommittedFruitRenewal?.(renewal);}catch{/* committed world is independent */}
    if(fruitFlow)try{
     postCommitFruitFlows.set(fruitFlow,{sessionToken:fruitFlowSessionToken,deliveredSequence:++deliveredFruitFlowSequence});
     options.observeCommittedFruitFlow?.(fruitFlow);
    }catch{/* committed world is independent */}
    }catch(error){world=current;serial=previousSerial;for(const key of Object.keys(decisions))delete decisions[key];Object.assign(decisions,previousDecisions);throw error;}
   }
  }catch(error){fault=error instanceof Error?error.message:String(error);world.clock.paused=true;world.clock.reason=fault;world.revision++;}
 };
 return {get world(){return world;},snapshot,advance};
}
function currentLifeView(viewer:Pick<ValleySpiritLifeViewer,'latest'>|undefined,world:World|undefined):ValleySpiritPublishedLifeView|null{
 try{
  if(!viewer||!world||world.mode!=='validation'||Object.hasOwn(world,'simulationOnly'))return null;
  const view=viewer.latest(world.id);
  return view&&BigInt(view.range.throughUs)<=BigInt(minuteToClimateUs(world.minute))?view:null;
 }catch{return null;}
}
export function createMvpServer(session:Pick<ReturnType<typeof createMvpSession>,'snapshot'>&Partial<Pick<ReturnType<typeof createMvpSession>,'world'>>,options:{webRoot?:string;valleySpiritSource?:(sourceRef:string)=>unknown;valleySpiritArchive?:ValleySpiritJournal['archive'];valleySpiritReaders?:ValleySpiritPublicReaders;valleySpiritLifeViewer?:Pick<ValleySpiritLifeViewer,'latest'>;privateSpeechWeatherOnly?:true}={}):Server {
 return createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(options.privateSpeechWeatherOnly){
   const path='/ai-town/api/valley-spirit/archive',bind=res.socket?.localPort;
   if(req.method!=='GET'||!bind||req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!=='127.0.0.1:'+bind||
      !(req.url===path||req.url?.startsWith(path+'?'))||req.headers.authorization!==undefined||req.headers.cookie!==undefined){
    res.writeHead(404,{'Content-Type':'application/json; charset=utf-8'});res.end('{"status":"unavailable"}');return;
   }
  }
  if(options.webRoot&&serveGodotWeb(req,res,options.webRoot))return;
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end('Read-only MVP');return;}
  const lifeAlmanacPath='/ai-town/api/valley-spirit/almanac/life/latest';
  if(req.url===lifeAlmanacPath||req.url?.startsWith(lifeAlmanacPath+'?')){
   let data:ValleySpiritPublishedLifeView|null=null;
   try{
    const params=new URL(req.url,'http://localhost').searchParams,worldId=params.get('worldId');
    if(options.valleySpiritLifeViewer&&[...params.keys()].length===1&&worldId&&session.world?.id===worldId)
     data=currentLifeView(options.valleySpiritLifeViewer,session.world);
   }catch{/* fail closed */}
   res.writeHead(data?200:404,{'Content-Type':'application/json; charset=utf-8'});
   res.end(JSON.stringify(data??{status:'unavailable'}));return;
  }
  const latestAlmanacPath='/ai-town/api/valley-spirit/almanac/latest';
  if(req.url===latestAlmanacPath||req.url?.startsWith(latestAlmanacPath+'?')){
   let data:ReturnType<ValleySpiritPublicReaders['latestAlmanac']>|{status:'invalid'}={status:'unavailable'};
   try{data=req.url===latestAlmanacPath?options.valleySpiritReaders?.latestAlmanac()??data:{status:'invalid'};}catch{/* fail closed */}
   res.writeHead(data.status==='unavailable'?404:data.status==='invalid'?400:200,{'Content-Type':'application/json; charset=utf-8'});
   res.end(JSON.stringify(data));return;
  }
  const almanacPath='/ai-town/api/valley-spirit/almanac',topicsPath='/ai-town/api/valley-spirit/topics';
  if(req.url===almanacPath||req.url===topicsPath||req.url?.startsWith(almanacPath+'?')||req.url?.startsWith(topicsPath+'?')){
   const unavailable={status:'unavailable'} as const,invalid={status:'invalid'} as const;
   const target=new URL(req.url,'http://localhost');let result:unknown=unavailable,code=404;
   try{
    if(options.valleySpiritReaders){
     if(target.pathname===almanacPath){
      const id=parseValleySpiritAlmanacId(target.searchParams),entry=id?options.valleySpiritReaders.almanac(id):null;
      result=entry?{status:'ready',entry}:id?unavailable:invalid;code=entry?200:id?404:400;
     }else{
      const range=parseValleySpiritTopicWindow(target.searchParams),page=range?options.valleySpiritReaders.topics(range):invalid;
      result=page;code=page.status==='ready'?200:page.status==='invalid'?400:404;
     }
    }
   }catch{result=unavailable;code=404;}
   res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));return;
  }
  const archivePath='/ai-town/api/valley-spirit/archive';
  if(req.url===archivePath||req.url?.startsWith(archivePath+'?')){
   const unavailable={status:'unavailable'} as const;
   const query=parseWeatherArchiveQuery(new URL(req.url,'http://localhost').searchParams);
   const page=!options.valleySpiritArchive?unavailable:query?options.valleySpiritArchive(query):{status:'invalid'};
   res.writeHead(page.status==='ready'?200:page.status==='invalid'?400:404,{'Content-Type':'application/json; charset=utf-8'});
   res.end(JSON.stringify(page));return;
  }
  if(req.url?.startsWith('/ai-town/api/valley-spirit/source?')){
   const params=new URL(req.url,'http://localhost').searchParams,ref=params.get('ref');
   const source=ref&&ref.length<=300&&[...params.keys()].length===1?options.valleySpiritSource?.(ref):null;
   res.writeHead(source?200:404,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(source??{status:'unavailable'}));return;
  }
  if(req.url!=='/ai-town/api/world'){res.writeHead(404);res.end('Not found');return;}
  const snapshot=session.snapshot(),world=session.world;
  // An opt-in fixture can advertise the exact current section without exposing
  // text or sources. Ordinary server starts omit this marker entirely.
  const life=world&&world.id===snapshot.world.id&&world.revision===snapshot.world.revision&&world.minute===snapshot.world.minute
   ?currentLifeView(options.valleySpiritLifeViewer,world):null;
  const body=life?{...snapshot,valleySpiritLifeYearbook:{schemaVersion:1,status:'ready',generatedBy:life.generatedBy,worldId:life.worldId,
   worldRevision:snapshot.world.revision,atMinute:snapshot.world.minute,sectionId:life.sectionId}}:snapshot;
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));
 });
}
