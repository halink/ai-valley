import {hasReceipt} from './receipts.js';
import {cropYieldAt,recordFieldHarvest} from './frontier-nutrients.js';
import {aboardFerry,ferryTarget,completeFerry,workFerry,initializeFerries,advanceFerries,learnDocks} from './ferry.js';
import {buildingMigrationTarget,completeBuildingMigration,workBuildingMigration,advanceBuildingMigrations} from './building-migration.js';
import {promiseTarget,completePromise} from './known-promises.js';
import {initializePhysiology,physiology} from './physiology.js';
import {routeFood} from './food-routes.js';
import {initializeCulture,advanceCulture,cultureTarget,cultureWorkError,completeCulture} from './culture.js';
import {initializeSocial,advanceSocial,socialTarget,completeSocial} from './social-life.js';
import {initializeHousehold,advanceHousehold,householdTarget,completeHousehold} from './household.js';
import {initializeDebt,advanceDebt,debtTarget,completeDebt} from './debt.js';
import {initializeAdoption,advanceAdoption,adoptionTarget,completeAdoption} from './adoption.js';
import {initializeAgency,agencyReason,completeAgency,advanceAgency,settleAgencyAction} from './agency.js';
import {deathProof,canObserve} from './knowledge.js';
import {initializeFunerary,advanceFunerary,funeraryTarget,completeFunerary,knownBodyLocation} from './funerary.js';
import {reserveBody,bodyPickup,syncBodies} from './bodies.js';
import {initializeLongCare,advanceLongCare,longCareTarget,longCareWorkError,completeLongCare} from './long-care.js';
import {residentBed} from '../shared/rooms.js';
import {syncMedicalTransport,transportContinues,passenger} from './medical-transport.js';
import {coLocated} from './proximity.js';
import {initializeHealth,advanceHealth,healthTarget,healthWorkError,completeHealth,movementRate} from './health.js';
import {syncAnimalTransport} from './industry.js';
import {advanceFood,initializeFood,foodTransaction,foodValue} from './food.js';
import {initializeRooms,beginRoomTick,moveInRoom,prepareRoomExit} from './rooms.js';
import {initializeIndustry,advanceIndustry,industryTarget,industryWorkError,completeIndustry} from './industry.js';
import {itemLabels,goods} from '../shared/items.js';
import {initializeEducation,advanceEducation,educationTarget,educationWorkError,completeEducation,educationConflict} from './education.js';
import type {Action, Activity, Building, BuildingKind, Inventory, Plan, Resident, Vec, World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {visibleStreetDirectory} from './street-directory.js';
import {advanceLife,recordDeath} from './life.js';
import {careAuthority,executeSocialAction} from './social.js';
import {ageAllowsAction,familyCareRoute} from './family.js';
import {advanceMigration} from './migration.js';
import {advancePublicDuties,completeDuty,dutyTarget,dutyWorkError,publicKitchenReason} from './public-duties.js';
import {ensureCensus} from '../shared/demography.js';
import {initializeEconomy,advanceEconomy,economyTarget,completeEconomy} from './economy.js';
import {initializeCivic,advanceCivic,civicTarget,completeCivic,civicWorkError} from './civic.js';
import {initializeProduction,advanceProduction,productionTarget,completeProduction,productionParcels} from './production.js';
import {initializeEmployment,advanceEmployment,employmentTarget,employmentWorkError,completeEmployment,employmentKitchenReason} from './employment.js';
import {initializeForeignTrade,advanceForeignTrade,foreignTarget,completeForeignTrade} from './foreign-trade.js';
import {initializeConstruction,advanceConstruction,constructionTarget,constructionWorkError,completeConstruction} from './construction.js';
import {calendar,DAY} from './time.js';
import {advanceFrontierHazards,frontierHazardTarget,completeFrontierHazard} from './frontier-hazards.js';

import {designTarget,designWorkError,completeDesign} from './resident-designs.js';

const names:Record<string,string>=itemLabels;
const buildingNames:Record<BuildingKind,string>={home:'木屋',lodge:'会馆',workshop:'工坊',clinic:'诊所',school:'学堂',barn:'畜舍',greenhouse:'温室',store:'商铺'};
const has=(inventory:Inventory,cost:Inventory,multiplier=1)=>Object.entries(cost).every(([k,v])=>(inventory[k as keyof Inventory]??0)>=(v??0)*multiplier);
function transfer(from:Inventory,to:Inventory,cost:Inventory){for(const [k,v]of Object.entries(cost)){const item=k as keyof Inventory;from[item]=(from[item]??0)-v;to[item]=(to[item]??0)+v;}}
function consume(inventory:Inventory,cost:Inventory,multiplier=1){for(const [k,v]of Object.entries(cost)){const item=k as keyof Inventory;inventory[item]=(inventory[item]??0)-v*multiplier;}}
function inventoryValid(i:Inventory){return i&&Object.keys(i).length>0&&Object.entries(i).every(([k,v])=>k in names&&Number.isInteger(v)&&v>0&&v<=100);}
const allowedAboard=(a:Action)=>['wait','eat','talk','ferry'].includes(a.type);
const living=(r:Resident)=>r.status==='alive'&&r.residency!=='outside';
function nearby(a:Resident,b:Resident){return living(a)&&living(b)&&a.inside===b.inside&&distance(a.at,b.at)<=2;}
function failure(world:World,r:Resident,error:string){settleAgencyAction(r,r.activity?.planId??r.plan?.id??'',error);r.activity=null;r.plan=null;if(!world.rooms){r.inside=null;r.roomAt=null;}r.lastFailure=error;r.decisionDue=world.minute;r.revision++;}
function definitionFor(world:World,plan:Plan,action:Action):string {
 const key=action.type==='cook'?'recipe/meal':action.type==='plant'||action.type==='harvest'||action.type==='water'?'crop/turnip':action.type==='build'?`building/${action.kind}`:'action/routine';
 if(key==='action/routine')return plan.definition;
 const bound=world.definitions[plan.definition]?.dependencies.find(k=>k.startsWith(`${key}@`));
 return bound??'';
}
/** A submitted plan represents one individual's choice; it never authorizes another person's choice. */
export function submitPlan(world:World,plan:Plan):{ok:boolean;error?:string} {
 if(hasReceipt(world,`plan:${plan.id}`))return {ok:true};
 const actor=world.residents.find(r=>r.id===plan.actorId);
 if(!actor||!living(actor)||!actor.canDecide||!actor.canExpress)return {ok:false,error:'人物当前无法提交新决定'};
 if(actor.revision!==plan.actorRevision)return {ok:false,error:'人物状态已变化，迟到的决定失效'};
 if(aboardFerry(world,actor.id)&&plan.actions.some(a=>!allowedAboard(a)))return {ok:false,error:'已登船，须实际靠泊并上岸后才能独立走动或工作'};
 if(passenger(world,actor.id)&&plan.actions.some(a=>a.type!=='wait'&&!(a.type==='health'&&a.operation==='cancelRescue')))return {ok:false,error:'护送中的乘员须先明确停止护送，再安排独立移动或工作'};
 if(actor.plan||actor.activity)return {ok:false,error:'已有尚未完成的安排'};
 if(!world.definitions[plan.definition]||world.definitions[plan.definition].kind!=='action')return {ok:false,error:'未知的行为定义版本'};
 if(plan.createdAt>world.minute||!plan.id||plan.actions.length<1||plan.actions.length>10)return {ok:false,error:'计划的时间、标识或长度无效'};
 if(world.mode==='formal'&&plan.actions.some(action=>!ageAllowsAction(world,actor,action)||action.type==='travelToValley'||action.type==='travelWithFamily'||action.type==='stayOutside'))return {ok:false,error:'这项行动不符合本人当前的年龄或居留状态'};
 actor.plan=structuredClone(plan);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;
 world.processed.push(`plan:${plan.id}`);world.revision++;
 return {ok:true};
}

function targetFor(world:World,r:Resident,a:Action,definition:string):{target:Vec;adjacent?:boolean;duration:number;error?:string;cargo?:Activity['cargo']} {
 const fail=(error:string)=>({target:r.at,duration:0,error});
 if(a.type==='frontierHazard')return frontierHazardTarget(world,r,a);
 if(a.type==='design')return designTarget(world,r,a);
 if(a.type==='ferry')return ferryTarget(world,r,a);
 if(a.type==='buildingMigration')return buildingMigrationTarget(world,r,a);
 if(a.type==='promise')return promiseTarget(world,r,a);
 if(a.type==='agency'){const error=agencyReason(world,r,a);return error?fail(error):{target:{...r.at},duration:1};}
 if(a.type==='culture')return cultureTarget(world,r,a);
 if(a.type==='social')return socialTarget(world,r,a);
 if(a.type==='household')return householdTarget(world,r,a);
 if(a.type==='debt')return debtTarget(world,r,a);
 if(a.type==='adoption')return adoptionTarget(world,r,a);
 if(a.type==='funerary')return funeraryTarget(world,r,a);
 if(a.type==='longCare')return longCareTarget(world,r,a);
 if(a.type==='health')return healthTarget(world,r,a);
 if(a.type==='industry')return industryTarget(world,r,a);
 if(a.type==='education')return educationTarget(world,r,a);
 if(a.type==='construction')return constructionTarget(world,r,a);
 if(a.type==='build'&&world.mode==='formal')return fail('建设已改为分阶段工程，请本人重新选择用途、地点和施工条件');
 if(a.type==='employment')return employmentTarget(world,r,a);
 if(a.type==='foreignTrade')return foreignTarget(world,r,a);
 if(a.type==='economy')return economyTarget(world,r,a);
 if(a.type==='civic')return civicTarget(world,r,a);
 if(a.type==='production')return productionTarget(world,r,a);
 if(a.type==='tendChild'||a.type==='fosterChild'||a.type==='familyConsent'||a.type==='inviteHome'||a.type==='homeReply')return familyCareRoute(world,r,a);
 if(a.type==='publicDuty')return dutyTarget(world,r,a);
 if(a.type==='move')return {target:a.to,duration:0};
 if(a.type==='wait'||a.type==='sleep'){
  if(!Number.isFinite(a.minutes)||a.minutes<1||a.minutes>720)return fail('休息时长须在 1–720 分钟之间');
  if(a.type==='sleep'){const b=world.buildings.find(b=>b.id===r.homeId&&b.condition>0&&b.residents.includes(r.id));if(!b||world.rooms&&residentBed(world,r,b)===null)return fail('尚未拥有可使用的真实床位，当前住处存在床位缺口');return {target:b.door,duration:a.minutes};}
  return {target:r.at,duration:a.minutes};
 }
 if(a.type==='eat')return Object.hasOwn(goods,a.item)&&goods[a.item].food>0?{target:r.at,duration:5}:fail('这不是可以食用的实际食品');
 if(a.type==='gather'){
  const resource=world.resources.find(v=>v.id===a.resourceId);
  if(!resource||!r.knownResources.includes(resource.id))return fail('尚未找到这处资源');
  if(!Number.isInteger(a.quantity)||a.quantity<1||a.quantity>12)return fail('采集数量不合法');
  if(resource.amount<a.quantity)return fail('资源已不足，须重新决定');
  return {target:resource.at,adjacent:true,duration:a.quantity*(resource.kind==='tree'?(world.industry?.tools.some(t=>t.ownerId===r.id&&!t.location&&t.kind==='axe'&&t.durability>0)?5:8):resource.kind==='rock'?12:resource.kind==='bush'?3:2)};
 }
 if(a.type==='plant'||a.type==='water'||a.type==='harvest'){
  const p=world.plots.find(p=>p.id===a.plotId);if(!p||p.ownerId!==r.id)return fail('没有这块田的使用权');return {target:p.at,duration:a.type==='plant'?15:a.type==='water'?8:10};
 }
 if(a.type==='cook'){
  if(!Number.isInteger(a.quantity)||a.quantity<1||a.quantity>6)return fail('烹饪数量不合法');
  const b=world.buildings.find(b=>b.id===r.homeId&&b.condition>0&&b.residents.includes(r.id))||world.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons'&&b.condition>0);
  if(!b)return fail('没有可使用的厨房');const problem=publicKitchenReason(world,r,b.id)??employmentKitchenReason(world,r,b.id);if(problem)return fail(problem);return {target:b.door,duration:Number(world.definitions[definition]?.minutes??20)*a.quantity};
 }
 if(a.type==='build')return {target:{x:a.at.x+Math.floor(Number(world.definitions[definition]?.data.width??6)/2),y:a.at.y+Number(world.definitions[definition]?.data.height??5)},duration:Number(world.definitions[definition]?.minutes??360)};
 if(a.type==='separate')return {target:r.at,duration:1};
 if(a.type==='respond'){const p=world.proposals.find(p=>p.id===a.proposalId);if(p?.actorId===r.id&&!a.accept)return {target:r.at,duration:1};}
 if(a.type==='leave')return {target:world.map.entrance,duration:1};
 if(a.type==='settle'||a.type==='lodge'){const b=world.buildings.find(b=>b.id===a.buildingId);if(!b)return fail('没有这处住所');return {target:b.door,duration:15};}
 let targetId='targetId'in a?a.targetId:undefined;
 if(a.type==='accept'){const offer=world.offers.find(o=>o.id===a.offerId&&o.targetId===r.id);if(!offer)return fail('没有交给本人的报价');targetId=offer.actorId;}
 if(a.type==='respond'){const proposal=world.proposals.find(p=>p.id===a.proposalId&&p.targetId===r.id);if(!proposal)return fail('没有交给本人的提议');targetId=proposal.actorId;}
 const target=world.residents.find(p=>p.id===targetId);
 if(!target||!r.knownPeople.includes(target.id))return fail('未认识该人物');
 if(a.type==='bury'){
  const known=!!deathProof(world,r,target.id);
  if(target.status!=='dead'||!known)return fail('尚未实际发现该人物死亡');
  const knownPlace=knownBodyLocation(world,r,target.id);if(!knownPlace)return fail('本人尚无可据以寻找遗体的实际地点');
  const grave=world.graves.filter(g=>!g.personId&&(!g.reservedBy||g.reservedBy===r.id)).sort((g,h)=>distance(g.at,target.at)-distance(h.at,target.at)).find(g=>findPath(world,knownPlace.at,g.at,true)!==null);
  if(!grave)return fail('没有可达的空墓位');
  return {target:knownPlace.at,adjacent:!knownPlace.inside,duration:120,cargo:{bodyId:target.id,graveId:grave.id,pickedUp:false}};
 }
 // A late model reply retains the place actually seen when its menu was built.
 if(a.observedTarget&&a.observedTarget.id===targetId)return {target:{...a.observedTarget.at},adjacent:!a.observedTarget.inside,duration:a.type==='care'?30:a.type==='learn'?60:3};
 // A name in memory does not reveal someone's live whereabouts across the map.
 if(!living(target)||target.inside!==r.inside||distance(target.at,r.at)>12)return fail('当前视野内没有找到对方，须先前往寻找');
 a.observedTarget={id:target.id,at:{...target.at},inside:target.inside,roomAt:target.roomAt?{...target.roomAt}:null,atMinute:world.minute};
 return {target:{...target.at},adjacent:!target.inside,duration:a.type==='care'?30:a.type==='learn'?60:3};
}
function begin(world:World,r:Resident){
 const plan=r.plan;if(!plan)return;
 const action=plan.actions.shift();if(!action){r.plan=null;r.decisionDue=world.minute;return;}
 if(aboardFerry(world,r.id)&&!allowedAboard(action)){failure(world,r,'本人仍在船上，须靠泊并上岸');return;}
 const definition=definitionFor(world,plan,action);
 if(!world.definitions[definition]){failure(world,r,'行为引用的定义版本不存在');return;}
 const route=targetFor(world,r,action,definition);if(route.error){failure(world,r,route.error);return;}
 const path=findPath(world,r.at,route.target,route.adjacent);
 if(path===null){failure(world,r,'目标目前没有可达路线');return;}
 const outdoors=['move','gather','plant','water','harvest','build','construction','industry','leave','settle','lodge'].includes(action.type);
 if((path.length||outdoors)&&!world.rooms){r.inside=null;r.roomAt=null;}
 r.activity={planId:plan.id,action,startedAt:world.minute,remaining:route.duration,path,target:{...route.target},definition,travelProgress:0,...(route.cargo?{cargo:route.cargo}:{})};
 const bodyError=reserveBody(world,r,r.activity);if(bodyError){failure(world,r,bodyError);return;}
 prepareRoomExit(world,r);
}
export function buildAllowed(world:World,r:Resident,a:Extract<Action,{type:'build'}>,definition:string):{ok:boolean;error?:string;building?:Building} {
 const def=world.definitions[definition];if(!def||def.kind!=='building')return {ok:false,error:'未知建筑定义'};
 const w=Number(def.data.width),h=Number(def.data.height);
 if(!Number.isInteger(a.at.x)||!Number.isInteger(a.at.y)||w<1||h<1)return {ok:false,error:'建筑坐标无效'};
 const parcels=productionParcels(world);
 if(!parcels?.some(p=>p.ownerId===r.id&&a.at.x>=p.x&&a.at.y>=p.y&&a.at.x+w<=p.x+p.width&&a.at.y+h+1<=p.y+p.height))return {ok:false,error:'须在已有本人建设使用权的地块内施工'};
 if(!has(r.inventory,def.cost??{}))return {ok:false,error:'实际携带的建筑材料不足'};
 for(let y=a.at.y;y<a.at.y+h;y++)for(let x=a.at.x;x<a.at.x+w;x++){
  const p={x,y};if(!walkable(world,p)||world.map.tiles[y*world.map.width+x]!=='grass'||world.plots.some(q=>same(q.at,p))||world.graves.some(g=>same(g.at,p))||world.resources.some(v=>v.amount>0&&same(v.at,p))||world.residents.some(v=>v.status==='alive'&&same(v.at,p)))return {ok:false,error:'占地含有道路、资源、墓位、耕地、建筑或人物'};
 }
 const building:Building={id:`building-${world.id}-${world.revision+1}`,kind:a.kind,name:`${r.name}的${buildingNames[a.kind]}`,at:{...a.at},width:w,height:h,door:{x:a.at.x+Math.floor(w/2),y:a.at.y+h},ownerId:r.id,definition,capacity:Number(def.data.capacity),residents:[],condition:100};
 // Test the candidate against all existing doors and water access before touching state or assets.
 const candidate={...world,buildings:[...world.buildings,building]};
 if([...world.buildings.map(b=>b.door),building.door].some(p=>findPath(candidate,world.map.entrance,p)===null)||world.resources.filter(v=>v.kind==='spring').every(v=>findPath(candidate,world.map.entrance,v.at,true)===null))return {ok:false,error:'工程将阻断既有通行或唯一水源'};
 return {ok:true,building};
}
function completeAtomic(world:World,r:Resident,a:Action,definition:string):string|null {
 if(a.type==='frontierHazard')return completeFrontierHazard(world,r,a);
 if(a.type==='design')return completeDesign(world,r,a);
 if(a.type==='funerary')return completeFunerary(world,r,a);
 if(a.type==='longCare')return completeLongCare(world,r,a);
 if(a.type==='health')return completeHealth(world,r,a);
 if(a.type==='culture')return completeCulture(world,r,a);
 if(a.type==='social')return completeSocial(world,r,a);
 if(a.type==='household')return completeHousehold(world,r,a);
 if(a.type==='debt')return completeDebt(world,r,a);
 if(a.type==='adoption')return completeAdoption(world,r,a);
 if(a.type==='ferry')return completeFerry(world,r,a);
 if(a.type==='buildingMigration')return completeBuildingMigration(world,r,a);
 if(a.type==='promise')return completePromise(world,r,a);
 if(a.type==='agency')return completeAgency(world,r,a);
 if(a.type==='industry')return completeIndustry(world,r,a);
 if(a.type==='education')return completeEducation(world,r,a);
 if(a.type==='construction')return completeConstruction(world,r,a);
 if(a.type==='employment')return completeEmployment(world,r,a);
 if(a.type==='foreignTrade')return completeForeignTrade(world,r,a);
 if(a.type==='economy')return completeEconomy(world,r,a);
 if(a.type==='civic')return completeCivic(world,r,a);
 if(a.type==='production')return completeProduction(world,r,a);
 if(a.type==='publicDuty')return completeDuty(world,r,a);
 const def=world.definitions[definition];
 const social=executeSocialAction(world,r,a);if(social.handled)return social.ok?null:social.error??'行为当前无法完成';
 const record=(text:string,kind:'action'|'construction'|'trade'|'production'='action',actors=[r.id])=>emitEvent(world,{kind,actors,place:{...r.at},text});
 if(a.type==='move'||a.type==='wait'||a.type==='sleep')return null;
 if(a.type==='eat'){
  if(!has(r.inventory,{[a.item]:1}))return '食物已经不足';const nutrition=foodValue(world,'person:'+r.id,a.item);consume(r.inventory,{[a.item]:1});r.hunger=Math.max(0,r.hunger-nutrition);record(`${r.name}吃了一份${names[a.item]}。`);return null;
 }
 if(a.type==='gather'){
  const resource=world.resources.find(v=>v.id===a.resourceId);if(!resource||distance(resource.at,r.at)>1||resource.amount<a.quantity)return '资源或实际位置已经变化';
  if(resource.kind==='tree'){const axe=world.industry?.tools.find(t=>t.ownerId===r.id&&!t.location&&t.kind==='axe'&&t.durability>0);if(axe)axe.durability=Math.max(0,axe.durability-1);}
  resource.amount-=a.quantity;resource.lastHarvest=world.minute;const item=resource.kind==='tree'?'wood':resource.kind==='rock'?'stone':resource.kind==='bush'?'berry':'water';r.inventory[item]=(r.inventory[item]??0)+a.quantity;r.energy=Math.max(0,r.energy-a.quantity*0.5);record(`${r.name}采集了 ${a.quantity} 份${names[item]}。`);return null;
 }
 if(a.type==='plant'||a.type==='water'||a.type==='harvest'){
  const p=world.plots.find(v=>v.id===a.plotId);if(!p||p.ownerId!==r.id||distance(p.at,r.at)>1)return '田地位置或使用权已经变化';
  if(a.type==='plant'){
   if(p.crop)return '田里已有作物';
   if(!(def.data.seasons as string[]).includes(calendar(world.minute).season))return '这个季节不适合种植芜菁';
   if(!has(r.inventory,def.cost??{seed:1}))return '没有实际种子';consume(r.inventory,def.cost??{seed:1});p.crop={definition,planted:world.minute,growth:0,wateredDay:-1,lastGrowthDay:Math.floor(world.minute/DAY)};r.skills.farming+=0.005;record(`${r.name}播下了芜菁种子。`);return null;
  }
  if(!p.crop)return '田里还没有作物';
  if(a.type==='water'){if(!has(r.inventory,{water:1}))return '没有携带清水';consume(r.inventory,{water:1});p.crop.wateredDay=Math.floor(world.minute/DAY);record(`${r.name}为田里的芜菁浇了水。`);return null;}
  const cropDef=world.definitions[p.crop.definition];if(p.crop.growth<Number(cropDef.data.growthDays))return '作物尚未成熟';
  const item=(cropDef.data.output??'turnip') as keyof Inventory;
  const amount=cropYieldAt(world,p,Number(cropDef.data.yield));
  r.inventory[item]=(r.inventory[item]??0)+amount;
  p.crop=null;r.skills.farming+=.02;recordFieldHarvest(world,p.id,amount);
  record(`${r.name}收获了 ${amount} 份${names[item]}。`,world.scenario==='frontier'?'production':'action');return null;
 }
 if(a.type==='cook'){
  if(!has(r.inventory,def.cost??{},a.quantity))return '烹饪需要实际芜菁与清水';consume(r.inventory,def.cost??{},a.quantity);r.inventory.meal=(r.inventory.meal??0)+a.quantity*Number(def.data.yield);record(`${r.name}在厨房做好 ${a.quantity} 份餐食。`);return null;
 }
 if(a.type==='build'){
  const valid=buildAllowed(world,r,a,definition);if(!valid.ok||!valid.building)return valid.error??'无法建造';consume(r.inventory,def.cost??{});world.buildings.push(valid.building);r.knownBuildings.push(valid.building.id);r.skills.building+=0.1;record(`${r.name}用自己的材料完成了${valid.building.name}。`,'construction');return null;
 }
 if(a.type==='talk'){
  const target=world.residents.find(v=>v.id===a.targetId);if(!target||(!living(target)||!coLocated(world,r,target))||!r.canExpress)return '对方已经不在能够交谈的位置';
  const previous=[...world.events].reverse().find(e=>e.kind==='conversation'&&e.conversationId?.startsWith('conversation-')&&(e.roomId??null)===r.inside&&e.actors.includes(r.id)&&e.actors.includes(target.id)&&world.minute-e.at<45&&(r.inside?!!e.roomAt&&!!r.roomAt&&distance(e.roomAt,r.roomAt)<5:distance(e.place,r.at)<5));
  const conversationId=previous?.conversationId??`conversation-${world.id}-${world.revision+1}`;
  const event=emitEvent(world,{kind:'conversation',actors:[r.id,target.id],place:{...r.at},conversationId,text:`${r.name}：${a.text.slice(0,320)}`});
  // Hearing a chosen tone is a fact; the listener decides its personal meaning separately.
  for(const [from,to] of [[r,target],[target,r]]){let relation=from.relations.find(v=>v.targetId===to.id);if(!relation){relation={targetId:to.id,affection:0,trust:0,conflict:0,evidence:[]};from.relations.push(relation);}relation.evidence.push(event.id);if(relation.evidence.length>80)relation.evidence=relation.evidence.slice(-80);}
  if(!target.plan&&!target.activity)target.decisionDue=Math.min(target.decisionDue,world.minute);
  return null;
 }
 if(a.type==='offer'){
  const target=world.residents.find(v=>v.id===a.targetId);if(!target||target.id===r.id||(!living(target)||!coLocated(world,r,target)))return '须另一位在场的实际当事人，不能与自己虚构交换';
  if(!inventoryValid(a.give)||!inventoryValid(a.want)||!has(r.inventory,a.give))return '报价物品或本人实际库存无效';
  if(world.offers.some(o=>o.actorId===r.id&&o.targetId===target.id&&o.status==='open'))return '对方还有未处理的报价';
  world.offers.push({id:`offer-${world.id}-${world.revision+1}`,actorId:r.id,targetId:target.id,give:structuredClone(a.give),want:structuredClone(a.want),expiresAt:world.minute+240,status:'open',definition});
  record(`${r.name}向${target.name}提出交换报价，等待对方自己决定。`,'trade',[r.id,target.id]);return null;
 }
 if(a.type==='accept'){
  const offer=world.offers.find(o=>o.id===a.offerId);if(!offer||offer.status!=='open'||offer.expiresAt<=world.minute||offer.targetId!==r.id)return '报价已经失效';
  const other=world.residents.find(v=>v.id===offer.actorId);if(!other||other.id===r.id||(!living(other)||!coLocated(world,r,other)))return '交易须有两位不同的实际在场当事人';
  if(!has(other.inventory,offer.give)||!has(r.inventory,offer.want))return '任一方的实际库存已不足';
  routeFood(world,'person:'+other.id,'person:'+r.id,offer.give);routeFood(world,'person:'+r.id,'person:'+other.id,offer.want);transfer(other.inventory,r.inventory,offer.give);transfer(r.inventory,other.inventory,offer.want);other.revision++;offer.status='accepted';record(`${r.name}接受${other.name}的报价，双方当面交付了物品。`,'trade',[r.id,other.id]);return null;
 }
 return '该行为尚未开放';
}
function observe(world:World,r:Resident){
 if(!canObserve(world,r))return;
 if(r.inside){for(const other of world.residents){if(other.id===r.id||!coLocated(world,r,other,10))continue;if(!r.knownPeople.includes(other.id))r.knownPeople.push(other.id);if(other.status==='dead'&&!world.graves.some(g=>g.personId===other.id)&&!deathProof(world,r,other.id,true))emitEvent(world,{kind:'death',actors:[other.id,r.id],place:{...other.at},witnesses:[r.id],text:`${r.name}在室内发现并确认了${other.name}的死亡。`});}return;}
 const sign=visibleStreetDirectory(world,r);
 if(sign){
  if(!r.knownResources.includes(sign.water.id))r.knownResources.push(sign.water.id);
  if(!r.knownBuildings.includes(sign.hall.id))r.knownBuildings.push(sign.hall.id);
 }
 for(const res of world.resources)if(distance(r.at,res.at)<=7&&!r.knownResources.includes(res.id))r.knownResources.push(res.id);
 for(const b of world.buildings)if(distance(r.at,b.door)<=10&&!r.knownBuildings.includes(b.id))r.knownBuildings.push(b.id);
 for(const other of world.residents){if(other.id===r.id||other.residency==='outside'||other.inside||distance(r.at,other.at)>5)continue;
  if(!r.knownPeople.includes(other.id))r.knownPeople.push(other.id);
  if(other.status==='dead'&&!world.graves.some(g=>g.personId===other.id)&&!deathProof(world,r,other.id,true))emitEvent(world,{kind:'death',actors:[other.id,r.id],place:{...other.at},witnesses:[r.id],text:`${r.name}在这里发现并确认了${other.name}的死亡。`});
 }
}
function processActivity(world:World,r:Resident,minutes:number){
 if(!r.activity)begin(world,r);
 const activity=r.activity;if(!activity)return;
 if(world.mode==='formal'&&activity.action.type==='build'){failure(world,r,'旧的一次性建造已停用，请重新决定分阶段工程');return;}
 if(r.status!=='alive'||!r.canDecide){failure(world,r,'当前身体或决定能力不支持继续执行');return;}
 if(activity.action.type==='care'){
  const target=world.residents.find(v=>v.id===(activity.action as Extract<Action,{type:'care'}>).targetId);
  if(activity.path.length===0&&(!target||!careAuthority(world,r,target).allowed)){failure(world,r,'照护权限或紧急条件已经改变');return;}
 }
 const interior=moveInRoom(world,r,minutes);syncMedicalTransport(world);syncBodies(world);if(interior.error){failure(world,r,interior.error);return;}if(interior.moving)return;
 if(activity.path.length){
  let available=minutes*movementRate(world,r),progress=activity.travelProgress??0;
  while(available>1e-9&&activity.path.length){const next=activity.path[0];
   if(!walkable(world,next,r.at)){failure(world,r,'原路线出现阻挡，需要重新决定');return;}
   const duration=world.map.tiles[next.y*world.map.width+next.x]==='road'?.75:1,needed=(1-progress)*duration;
   if(available+1e-9<needed){progress+=available/duration;available=0;break;}
   available-=needed;progress=0;r.at=activity.path.shift()!;r.inside=null;
   if(activity.cargo?.pickedUp){const body=world.residents.find(v=>v.id===activity.cargo!.bodyId);if(body){body.at={...r.at};body.inside=null;}}
   observe(world,r);
  }
  activity.travelProgress=progress;
  syncMedicalTransport(world);syncBodies(world);return;
 }
 if(activity.action.type==='publicDuty'){
  const problem=dutyWorkError(world,r,activity.action);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.action.type==='civic'){
  const problem=civicWorkError(world,r,activity.action);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.action.type==='employment'){
  const problem=employmentWorkError(world,r,activity.action,minutes);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.action.type==='culture'){const problem=cultureWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='longCare'){const problem=longCareWorkError(world,r,activity.action);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='health'){const problem=healthWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='industry'){const problem=industryWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='education'){const problem=educationWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='design'){const problem=designWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='ferry'){const problem=workFerry(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='buildingMigration'){const problem=workBuildingMigration(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='construction'){
  const problem=constructionWorkError(world,r,activity.action,minutes);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.cargo&&!activity.cargo.pickedUp){const error=bodyPickup(world,r,minutes);if(error)failure(world,r,error);return;}
 if(activity.action.type==='sleep'||activity.action.type==='cook'){
  const b=world.buildings.find(b=>same(b.door,r.at)&&(b.id===r.homeId&&b.condition>0&&b.residents.includes(r.id)||activity.action.type==='cook'&&b.ownerId==='commons'&&b.kind==='lodge'&&b.condition>0));
  if(!b){failure(world,r,'没有实际到达可使用的室内位置');return;}
  if(activity.action.type==='cook'){const problem=publicKitchenReason(world,r,b.id)??employmentKitchenReason(world,r,b.id);if(problem){failure(world,r,problem);return;}}
  r.inside=b.id;
 }
 if(activity.action.type==='sleep'){const rules=physiology(world,r);r.energy=Math.min(100,r.energy+minutes*rules.sleepEnergy);if(r.hunger<rules.sleepFedThreshold)r.health=Math.min(100,r.health+minutes*rules.sleepHealth);}
 activity.remaining-=minutes;if(activity.remaining>0)return;
 const error=complete(world,r,activity.action,activity.definition);if(error){failure(world,r,error);return;}
 if(transportContinues(world,r)||activity.path.length||activity.room?.mode==='exit'||activity.action.type==='industry'&&activity.action.operation==='moveAnimal'&&world.industry?.animals.some(n=>n.id===(activity.action as import('../shared/industry.js').IndustryAction).animalId&&n.carrierId===r.id))return;
 if(world.mode==='formal'){
  const action=activity.action;
  const rest=action.type==='sleep'||action.type==='wait';
  r.recentActions=[...(r.recentActions??[]).slice(-3),{type:action.type,at:world.minute,...(rest?{minutes:action.minutes,energy:Math.round(r.energy)}:{})}];
 }
 settleAgencyAction(r,activity.planId);r.activity=null;r.revision++;world.revision++;
 if(!r.plan?.actions.length){r.plan=null;r.decisionDue=world.minute;}
}
/** Advances only committed model arrangements and physical consequences. No intentions are generated here. */
export function stepWorld(world:World,minutes:number):void {
 if(world.clock.paused||!Number.isFinite(minutes)||minutes<=0)return;
 // A caller may use large isolated-test steps; real runtime never catches up downtime.
 ensureCensus(world);initializePhysiology(world);
 if(world.mode==='formal'){initializeEconomy(world);initializeCivic(world);initializeProduction(world);initializeEmployment(world);initializeForeignTrade(world);initializeConstruction(world);initializeEducation(world);initializeIndustry(world);initializeFerries(world);initializeRooms(world);initializeFood(world);initializeHealth(world);initializeLongCare(world);initializeFunerary(world);initializeAgency(world);initializeAdoption(world);initializeDebt(world);initializeHousehold(world);initializeSocial(world);initializeCulture(world);}
 let left=minutes;
 while(left>0){const dt=Math.min(1,left),previousDay=Math.floor(world.minute/DAY);world.minute+=dt;left-=dt;advanceFood(world);beginRoomTick(world);
  for(const r of world.residents){if(!living(r))continue;if(r.health<=0){recordDeath(world,r);continue;}
   processActivity(world,r,dt);
   const bodyRules=physiology(world,r);r.hunger=Math.min(100,r.hunger+bodyRules.hungerPerMinute*dt);
   if(r.activity?.action.type!=='sleep'||r.activity.path.length||r.activity.room?.path.length)r.energy=Math.max(0,r.energy-bodyRules.energyPerMinute*dt);
   if(r.hunger>bodyRules.hungerDanger)r.health=Math.max(0,r.health-bodyRules.hungerHealthDrain*dt);
   if(r.energy<bodyRules.energyDanger)r.health=Math.max(0,r.health-bodyRules.energyHealthDrain*dt);
   if(r.health<=0){recordDeath(world,r);continue;}
   observe(world,r);learnDocks(world,r);
  }
  if(world.frontierHazards)advanceFrontierHazards(world,dt,(r,reason)=>{
   if(r.plan||r.activity)failure(world,r,reason);
   else{r.lastFailure=reason;r.decisionDue=Math.min(r.decisionDue,world.minute);r.revision++;}
  });
  advanceHealth(world,dt);
  syncAnimalTransport(world);
  advanceLife(world,dt);syncBodies(world);
  if(world.mode==='formal'){
   advanceMigration(world);
   advanceEconomy(world);
   advanceEmployment(world);
   advanceForeignTrade(world);
   advanceConstruction(world);advanceBuildingMigrations(world);
   advanceEducation(world);
   advanceIndustry(world);advanceFerries(world,dt);
   advanceProduction(world);
   advanceCivic(world);
   advancePublicDuties(world);
   advanceFunerary(world);advanceAdoption(world);advanceHousehold(world);advanceDebt(world);advanceSocial(world);advanceCulture(world);
   for(const plan of advanceLongCare(world))submitPlan(world,plan);
   for(const plan of advanceAgency(world))submitPlan(world,plan);
   ensureCensus(world);
  }
  for(const offer of world.offers)if(offer.status==='open'&&(offer.expiresAt<=world.minute||!world.residents.some(r=>r.id===offer.actorId&&living(r))))offer.status='expired';
  const day=Math.floor(world.minute/DAY);
  if(day!==previousDay){
   const previousWeather=world.weather;world.weather=((day*17+world.seed)%11)<3?'rain':'sun';
   for(const p of world.plots){if(!p.crop)continue;const def=world.definitions[p.crop.definition];if((def.data.seasons as string[]).includes(calendar(world.minute-1).season)&&(p.crop.wateredDay===previousDay||previousWeather==='rain'))p.crop.growth=Math.min(Number(def.data.growthDays),p.crop.growth+1);p.crop.lastGrowthDay=day;}
   if(!world.production)for(const res of world.resources)if(res.regrowthDays>0&&res.amount<res.max&&world.minute-res.lastHarvest>=res.regrowthDays*DAY){res.amount=Math.min(res.max,res.amount+1);res.lastHarvest=world.minute;}
  }
 }
 world.revision++;
}

function complete(world:World,r:Resident,a:Action,definition:string):string|null{return foodTransaction(world,()=>completeAtomic(world,r,a,definition));}
