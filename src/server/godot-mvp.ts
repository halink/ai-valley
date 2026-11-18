import {preservationPreparation} from './mvp-preservation-policy.js';
import {adoptMvpPreservation,preservationObservation,validateMvpPreservation} from '../world/mvp-preservation.js';
import {mvpNutritionBuffer,mvpEdibleQuantity} from './mvp-nutrition-buffer.js';
import {goods} from '../shared/items.js';
import {adoptMvpAgriculture,agricultureObservation,agricultureReason,plantTarget,canSow,agriculturePlot} from '../world/mvp-agriculture.js';
import {CULTIVARS,cultivarKeys,temperatureFactor} from '../shared/mvp-agriculture.js';
import {adoptMvpSoil,soilObservation} from '../world/mvp-soil.js';
import {adoptMvpResources,mvpResourceItem} from '../world/mvp-resources.js';
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
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {createWorld} from '../world/seed.js';
import {stepWorld,submitPlan,planStartError} from '../world/engine.js';
import {distance} from '../world/navigation.js';
import {barterTerms} from '../shared/barter.js';
import {canContactSocialTarget} from '../world/social-observation.js';
import {berryApproachPath,canContactBerry} from '../world/berry-observation.js';
import {canContactSpring,springApproachPath} from '../world/spring-observation.js';
import {VALLEY_VERSION} from '../shared/version.js';
import type {Action,Resident,Snapshot,Tile,World} from '../shared/types.js';

export const GODOT_MVP_PORT=3414;
export const GODOT_MVP_NOTICE='隔离核心循环：本地规则驱动，非真实模型；内存世界，退出后重置';
export type MvpPhase='deciding'|'travelling'|'gathering'|'eating'|'resting'|'waiting'|'stopped'|'drinking'|'talking'|'planting'|'watering'|'harvesting'|'cooking'|'preserving'|'installing';
export function mvpPhase(r:Resident):MvpPhase {
 if(r.status!=='alive')return 'stopped';
 if(!r.activity)return 'deciding';
 if(r.activity.path.length||r.activity.room?.path.length)return 'travelling';
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
export function chooseMvpAction(w:World,r:Resident):{action:Action;reason:string} {
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
 return {action:{type:'wait',minutes:30},reason:'当前没有可执行的规则行动，短暂等待'};
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
export function createMvpSession(options:{world?:World;commit?:(world:World,previousRevision:number)=>void;persistent?:boolean}={}){
 let world=structuredClone(options.world??createMvpWorld());
 if(options.world)inheritReceiptHistory(options.world,world);
 const initialRevision=world.revision;
 const climateAdopted=adoptMvpClimate(world),soilAdopted=adoptMvpSoil(world),agricultureAdopted=adoptMvpAgriculture(world),preservationAdopted=adoptMvpPreservation(world);
 if(climateAdopted||soilAdopted||agricultureAdopted||preservationAdopted){world.revision++;options.commit?.(world,initialRevision);}
 enableCompletedMovement(world);
 let serial=0,fault:string|null=null;
 const decisions:Record<string,number>={};
 const snapshot=():Snapshot&{roomViews:ReturnType<typeof roomObservation>}&{observation:ReturnType<typeof mvpObservation>;relationshipHistory:ReturnType<typeof relationshipObservation>}&{movement:ReturnType<typeof completedMovementSnapshot>;residentMovement:ReturnType<typeof residentMovementSnapshot>}&{mvp:{driver:'local-rules';notice:string;ephemeral:boolean;fault:string|null;phases:Record<string,MvpPhase>;decisions:Record<string,number>;environment:NonNullable<World['mvpClimate']>['current'];soil:ReturnType<typeof soilObservation>;agriculture:ReturnType<typeof agricultureObservation>;preservation:ReturnType<typeof preservationObservation>;nutritionBuffer:ReturnType<typeof mvpNutritionBuffer>[]}}=>({
  roomViews:roomObservation(world),observation:mvpObservation(world,[],[]),relationshipHistory:relationshipObservation(world),movement:completedMovementSnapshot(world),residentMovement:residentMovementSnapshot(world),world:structuredClone(world),serverTime:new Date().toISOString(),version:VALLEY_VERSION,mapRevision:'godot-mvp-map-4',
  capabilities:{active:['小地图只读观察','本地规则采集/进食/休息闭环','有限面对面规则问候','独立选择的食水交换','同源气候与田地水账','三品种温水生长与实际耕收','本人名义两日营养缓冲','真实罐藏与批次到期（鲜食腐坏未模拟）',...(options.persistent?['规则存档与恢复']:[])],pending:['真实模型决策验收','全年冬储充分性','最终绘本素材']},
  // Read the published, validated point state. Legacy crop rain is separate;
  // soil water is exact; legacy crops and model decisions do not consume PAW.
  mvp:{driver:'local-rules',notice:options.persistent?'持久规则小山谷：本地规则驱动，非真实模型':GODOT_MVP_NOTICE,ephemeral:!options.persistent,fault,phases:Object.fromEntries(world.residents.map(r=>[r.id,mvpPhase(r)])),decisions:{...decisions},environment:structuredClone(world.mvpClimate!.current),soil:soilObservation(world),agriculture:agricultureObservation(world),preservation:preservationObservation(world),nutritionBuffer:world.residents.map(r=>mvpNutritionBuffer(world,r))},
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
    for(const r of world.residents){
     if(r.status!=='alive'||r.activity||r.plan)continue;
     const choice=chooseMvpAction(world,r);
     const result=submitPlan(world,{id:`mvp-rule-${world.id}-${world.revision}-${r.id}-${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:mvpPlanDefinition(world,choice.action),intention:'本地规则：'+choice.reason,actions:[choice.action]});
     if(!result.ok)throw new Error(`MVP plan rejected for ${r.id}: ${result.error}`);
     decisions[r.id]=(decisions[r.id]??0)+1;
    }
    // A neighbour may finish harvesting after this resident chose a source.
    // Keep the engine's rejected action (no inventory credit), then let the
    // next tick choose from current stock instead of freezing the whole demo.
    const gathering=new Map(world.residents.map(r=>[r.id,r.activity?.action]));
    const activityPlans=new Map(world.residents.map(r=>[r.id,r.activity?.planId]));
    const actionFailures:import('../world/engine.js').StepActionFailure[]=[];
    stepWorld(world,1,{actionFailures});
    for(const failed of world.residents.filter(r=>r.lastFailure)){
     const action=gathering.get(failed.id);
     if(action?.type==='talk'&&actionFailures.some(f=>f.actorId===failed.id&&f.planId===activityPlans.get(failed.id)&&f.actionType==='talk'&&f.code==='room_slot_contended'))continue;
     if(action?.type==='mvpAgriculture'||action?.type==='mvpPreservation')continue;
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
    options.commit?.(world,current.revision);
    }catch(error){world=current;serial=previousSerial;for(const key of Object.keys(decisions))delete decisions[key];Object.assign(decisions,previousDecisions);throw error;}
   }
  }catch(error){fault=error instanceof Error?error.message:String(error);world.clock.paused=true;world.clock.reason=fault;world.revision++;}
 };
 return {get world(){return world;},snapshot,advance};
}
export function createMvpServer(session:Pick<ReturnType<typeof createMvpSession>,'snapshot'>,options:{webRoot?:string}={}):Server {
 return createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(options.webRoot&&serveGodotWeb(req,res,options.webRoot))return;
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end('Read-only MVP');return;}
  if(req.url!=='/ai-town/api/world'){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(session.snapshot()));
 });
}
