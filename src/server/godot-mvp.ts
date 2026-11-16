import {serveGodotWeb} from './godot-web.js';
import {roomObservation} from './room-observation.js';
import {adoptMvpRooms} from '../world/mvp-rooms.js';
import {adoptMvpDrinking,mvpThirst} from '../world/mvp-drinking.js';
import {mvpObservation} from './mvp-observation.js';
import {enableCompletedMovement,completedMovementSnapshot} from '../world/completed-movement.js';
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
export type MvpPhase='deciding'|'travelling'|'gathering'|'eating'|'resting'|'waiting'|'stopped'|'drinking'|'talking';
export function mvpPhase(r:Resident):MvpPhase {
 if(r.status!=='alive')return 'stopped';
 if(!r.activity)return 'deciding';
 if(r.activity.path.length||r.activity.room?.path.length)return 'travelling';
 return ({talk:'talking',mvpDrink:'drinking',gather:'gathering',eat:'eating',sleep:'resting',wait:'waiting'} as const)[r.activity.action.type as 'gather'|'eat'|'sleep'|'wait']??'waiting';
}
export function createMvpWorld():World {
 const world=createWorld(3414);
 const width=32,height=24,tiles:Tile[]=Array(width*height).fill('grass');
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(x===0||y===0||x===width-1||y===height-1)tiles[y*width+x]='cliff';
  else if(x>=27)tiles[y*width+x]='water';
  else if(y===14||x===15&&y>=12)tiles[y*width+x]='path';
 }
 world.id='godot-mvp-'+randomUUID();
 world.map={width,height,tiles,name:'溪畔小院 · 核心循环',entrance:{x:15,y:22},settlement:{x:15,y:13}};
 world.residents=world.residents.slice(0,2);
 const home={...world.buildings.find(b=>b.id==='lodge')!,id:'mvp-home',name:'共屋',at:{x:11,y:6},width:8,height:6,door:{x:15,y:12},residents:world.residents.map(r=>r.id),capacity:2};
 world.buildings=[home];
 world.resources=[
  ...[{x:7,y:13},{x:22,y:14},{x:8,y:19},{x:21,y:20}].map((at,index)=>({id:'mvp-berry-'+index,kind:'bush' as const,at,amount:12,max:12,regrowthDays:1,lastHarvest:0})),
  {id:'mvp-spring',kind:'spring',at:{x:25,y:14},amount:10000,max:10000,regrowthDays:1,lastHarvest:0},
 ];
 world.plots=[];world.graves=[];world.events=[];
 for(const [index,r]of world.residents.entries()){
  r.at={x:14+index*2,y:14};r.homeId=home.id;r.inside=null;r.roomAt=null;
  r.inventory={};r.hunger=index===0?65:25;r.energy=index===0?85:50;
  r.knownPeople=world.residents.filter(p=>p.id!==r.id).map(p=>p.id);
  r.knownBuildings=[home.id];r.knownResources=world.resources.map(s=>s.id);
  r.intention='本地规则：观察当前需要';
 }
 world.clock={paused:false,reason:null,realMinutesPerDay:12};
 adoptMvpDrinking(world);
 adoptMvpRooms(world);
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
function mvpCanStart(w:World,r:Resident,action:Action):boolean {
 return planStartError(w,{id:'mvp-exchange-preview',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本地规则：当面交换预检',actions:[action]})===null;
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
 if(r.hunger>=35&&r.hunger<80&&r.energy>=70&&(mvpThirst(w,r)??0)<50-1e-9&&(r.inventory.berry??0)>=1){const action:Action={type:'eat',item:'berry',mvpAtTable:true};if(mvpCanStart(w,r,action))return {action,reason:'带着自己的食物回共屋餐桌进食，不共享或凭空补充口粮'};}
 if(r.hunger>=35&&(r.inventory.berry??0)>=1)return {action:{type:'eat',item:'berry'},reason:'饥饿且带有一整份浆果，进食'};
 // Immediate needs come before optional stocking: an empty bag must not
 // send a thirsty or exhausted resident on a food-reserve trip.
 if(r.hunger>=35){
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
 if((r.inventory.berry??0)<3){
  const source=w.resources.filter(s=>s.kind==='bush'&&s.amount>=1&&r.knownResources.includes(s.id)).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at)).find(s=>berryApproachPath(w,r.at,s)!==null);
  // Reserve three portions in total, not three more on every top-up.
  // Gathering uses whole units; never debit stock or credit inventory here.
  if(source)return {action:{type:'gather',resourceId:source.id,quantity:Math.min(Math.ceil(3-(r.inventory.berry??0)),Math.floor(source.amount))},reason:'前往已知果丛补足三份浆果储备的缺口'};
 }
 // Keep the remaining portion; replenish only after the carried supply runs out.
 const waterTrip=(r.inventory.water??0)<1?mvpWaterTrip(w,r):null;
 if(waterTrip)return {action:waterTrip,reason:'当前紧急需求已处理，前往已知泉水补足两份清水储备'};
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
 return {action:{type:'wait',minutes:30},reason:'当前没有可执行的规则行动，短暂等待'};
}
export function createMvpSession(){
 const world=createMvpWorld();
 enableCompletedMovement(world);
 let serial=0,fault:string|null=null;
 const decisions:Record<string,number>={};
 const snapshot=():Snapshot&{roomViews:ReturnType<typeof roomObservation>}&{observation:ReturnType<typeof mvpObservation>}&{movement:ReturnType<typeof completedMovementSnapshot>}&{mvp:{driver:'local-rules';notice:string;ephemeral:true;fault:string|null;phases:Record<string,MvpPhase>;decisions:Record<string,number>}}=>({
  roomViews:roomObservation(world),observation:mvpObservation(world,[],[]),movement:completedMovementSnapshot(world),world:structuredClone(world),serverTime:new Date().toISOString(),version:VALLEY_VERSION,mapRevision:'godot-mvp-map-1',
  capabilities:{active:['小地图只读观察','本地规则采集/进食/休息闭环','有限面对面规则问候','独立选择的食水交换'],pending:['真实模型决策验收','持久存档','最终绘本素材']},
  mvp:{driver:'local-rules',notice:GODOT_MVP_NOTICE,ephemeral:true,fault,phases:Object.fromEntries(world.residents.map(r=>[r.id,mvpPhase(r)])),decisions:{...decisions}},
 });
 const advance=(minutes=1)=>{
  if(!Number.isInteger(minutes)||minutes<1||minutes>60)throw new Error('MVP advances must be 1–60 whole world minutes');
  if(fault)return;
  try{
   for(let tick=0;tick<minutes;tick++){
    for(const r of world.residents){
     if(r.status!=='alive'||r.activity||r.plan)continue;
     const choice=chooseMvpAction(world,r);
     const result=submitPlan(world,{id:`mvp-rule-${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'本地规则：'+choice.reason,actions:[choice.action]});
     if(!result.ok)throw new Error(`MVP plan rejected for ${r.id}: ${result.error}`);
     decisions[r.id]=(decisions[r.id]??0)+1;
    }
    // A neighbour may finish harvesting after this resident chose a source.
    // Keep the engine's rejected action (no inventory credit), then let the
    // next tick choose from current stock instead of freezing the whole demo.
    const gathering=new Map(world.residents.map(r=>[r.id,r.activity?.action]));
    stepWorld(world,1);
    for(const failed of world.residents.filter(r=>r.lastFailure)){
     const action=gathering.get(failed.id);
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
   }
  }catch(error){fault=error instanceof Error?error.message:String(error);world.clock.paused=true;world.clock.reason=fault;world.revision++;}
 };
 return {world,snapshot,advance};
}
export function createMvpServer(session:ReturnType<typeof createMvpSession>,options:{webRoot?:string}={}):Server {
 return createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(options.webRoot&&serveGodotWeb(req,res,options.webRoot))return;
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end('Read-only MVP');return;}
  if(req.url!=='/ai-town/api/world'){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(session.snapshot()));
 });
}
