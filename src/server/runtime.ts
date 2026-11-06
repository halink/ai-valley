import {VALLEY_VERSION} from '../shared/version.js';
import {initializeFerries} from '../world/ferry.js';
import {initializeCulture,cultureDeadline} from '../world/culture.js';
import {initializeSocial} from '../world/social-life.js';
import {initializeHousehold} from '../world/household.js';
import {initializeDebt} from '../world/debt.js';
import {initializeAdoption} from '../world/adoption.js';
import {initializeAgency,agencyReady,advanceAgency} from '../world/agency.js';
import {initializeInfrastructure} from '../world/infrastructure.js';
import {initializeFunerary} from '../world/funerary.js';
import {initializeLongCare,longCareDeadline} from '../world/long-care.js';
import {initializeHealth,healthDeadline} from '../world/health.js';
import {initializeFood} from '../world/food.js';
import {initializeRooms} from '../world/rooms.js';
import {initializeIndustry} from '../world/industry.js';
import {initializeEducation,educationDeadline} from '../world/education.js';
import type {World,Snapshot,Plan,Resident} from '../shared/types.js';
import {stepWorld,submitPlan} from '../world/engine.js';
import {createWorld} from '../world/seed.js';
import {terrainRevision} from './landscape.js';
import {ensureCensus} from '../shared/demography.js';
import {advancePublicDuties} from '../world/public-duties.js';
import {initializeMigration,outsideCandidate,outsideDecisionContext,applyOutsideDecision} from '../world/migration.js';
import {createFrontierWorld} from '../world/formal-seed.js';
import {initializeFrontierHazards} from '../world/frontier-hazards.js';
import {initializeEconomy} from '../world/economy.js';
import {initializeCivic} from '../world/civic.js';
import {initializeProduction} from '../world/production.js';
import {initializeEmployment,employmentDeadline} from '../world/employment.js';
import {initializeConstruction,constructionDeadline} from '../world/construction.js';
import {initializeForeignTrade,foreignCandidates,isForeignActor,foreignDecisionContext,applyForeignDecision,foreignDeadline} from '../world/foreign-trade.js';
import {WorldStore, workingEvents} from './store.js';
import {callModel,decisionContext,prepareModelDecision,DecisionError,type ModelResult} from './decisions.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,modelLimits,type ModelConnection,type ModelName} from './model-completion.js';
import {ModelBudget} from './model-budget.js';
import {inheritReceiptHistory} from '../world/receipts.js';
import {FAST_DAY_MINUTES,YEAR,gameMinutesFromWall} from '../world/time.js';

type Model = (key:string,context:ReturnType<typeof decisionContext>,feedback?:string,model?:ModelName,prepared?:ReturnType<typeof prepareModelDecision>)=>Promise<ModelResult>;
type Provider = ModelConnection & {slots:number;maxSlots:number;blockedUntil:number;admitAfter:number;limitCount:number;successesSinceLimit:number;transientFailures:number;budget?:ModelBudget};
export const capabilities={
 active:['只读像素山谷与昼夜','逐人模型计划与实际寻路','采集、耕作、进食与休息','有限材料加工','现场会话、关系与双向物物交换','持久存档、事件记录与故障停表'],
 pending:['工程材料预留、分阶段施工与取消结算','完整孕育、照护与代际平衡验证','居民岗位、教育与服务排班','公共议事、产权与完整遗产清算','迁入机会、有限外贸与长期生态','全部建筑室内工位及四季美术验收']
};
function worldDeadline(world:World,actorId:string){
 const duties=world.duties?.shifts.filter(shift=>shift.workerId===actorId&&shift.status==='booked').map(shift=>shift.start)??[];
 const commitments=[...duties,employmentDeadline(world,actorId),educationDeadline(world,actorId),healthDeadline(world,actorId),longCareDeadline(world,actorId),cultureDeadline(world,actorId)];
 const offers=world.offers.filter(offer=>offer.status==='open'&&offer.targetId===actorId).map(offer=>offer.expiresAt);
 const proposals=world.proposals.filter(proposal=>proposal.status==='open'&&proposal.targetId===actorId).map(proposal=>proposal.expiresAt);
 return Math.min(Infinity,...offers,...proposals,...commitments,foreignDeadline(world,actorId),constructionDeadline(world,actorId));
}
function observedChildPressure(world:World,guardian:Resident,criticalOnly=false):number{
 let pressure=0;
 for(const child of world.residents){
  const present=child.status==='alive'&&child.residency!=='outside'&&child.inside===guardian.inside
    &&Math.abs(child.at.x-guardian.at.x)+Math.abs(child.at.y-guardian.at.y)<=12;
  if(!present||!child.guardianIds.includes(guardian.id)||world.minute-child.bornAt>=6*YEAR)continue;
  if(criticalOnly?child.health<=20:child.hunger>=80||child.health<50)pressure=Math.max(pressure,child.hunger+(100-child.health)*2);
 }
 return pressure;
}
export class ValleyRuntime {
 world:World;
 private trimAt=512;
 private inFlight=new Map<string,Provider>();
 private retryAt=new Map<string,number>();
 private readonly modelSlots:number;
 private readonly providers:Provider[];
 private fallbackPending=new Set<string>();
 private failures=new Map<string,string>();
 private replyFeedback=new Map<string,string>();
 private waitingSince=new Map<string,number>();
 private lastTick=Date.now();
 private lastLocalDecision=this.lastTick;
  private listeners=new Set<()=>void>();
 private stopped=false;
 private tickTimer?:ReturnType<typeof setInterval>;
 constructor(private store:WorldStore,credentials:string|null|readonly ModelConnection[],private model:Model=callModel,options:{dayMinutes?:number;mode?:World['mode'];modelSlots?:number}={}){
  const saved=store.loadForRuntime();const previousRevision=saved?.revision??null;if(saved && options.mode && saved.mode!==options.mode)throw new Error('world_mode_mismatch');
  this.world=saved??(options.mode==='formal'?createFrontierWorld():createWorld());
  const originalEvents=this.world.events.length,originalReceipts=this.world.processed.length;
  const connections:readonly ModelConnection[]=typeof credentials==='string'?[{model:GLM_MODEL,key:credentials}]:credentials??[];
  const configured=connections.filter(c=>c.key);
  this.world.clock.realMinutesPerDay=options.dayMinutes??this.world.clock.realMinutesPerDay;
  const legacySlots=this.world.mode==='formal'?4:2;
  this.modelSlots=options.modelSlots??Math.max(legacySlots,...configured.map(c=>c.model===GLM_MODEL?legacySlots:modelLimits[c.model].maxSlots));
  if(!Number.isInteger(this.modelSlots)||this.modelSlots<1||this.modelSlots>modelLimits[QWEN_MODEL].maxSlots)throw new Error('Invalid resident model concurrency');
  this.providers=configured.map(c=>{
   const limits=modelLimits[c.model];
   const maxSlots=Math.min(limits.maxSlots,this.modelSlots);
   const slots=c.model===GLM_MODEL?maxSlots:Math.min(limits.startSlots,maxSlots);
   const budget=limits.tpm===null&&limits.rpm===null?undefined:new ModelBudget(limits.rpm,limits.tpm,this.world.metrics.usageWindow?.[c.model]);
   return {...c,slots,maxSlots,budget,blockedUntil:0,admitAfter:0,limitCount:0,successesSinceLimit:0,transientFailures:0};
  });
  terrainRevision(this.world.map);
  if(this.world.mode==='formal'){
   initializeEconomy(this.world);
   initializeProduction(this.world);
   initializeCivic(this.world);
   initializeEmployment(this.world);
   initializeForeignTrade(this.world);
   initializeConstruction(this.world);initializeEducation(this.world);initializeIndustry(this.world);initializeFerries(this.world);initializeRooms(this.world);initializeFood(this.world);initializeHealth(this.world);initializeLongCare(this.world);initializeFunerary(this.world);initializeInfrastructure(this.world);initializeAgency(this.world);initializeAdoption(this.world);initializeDebt(this.world);initializeHousehold(this.world);initializeSocial(this.world);initializeCulture(this.world);
   ensureCensus(this.world);
   initializeMigration(this.world);
   advancePublicDuties(this.world);
   if(this.world.scenario==='frontier')initializeFrontierHazards(this.world);
  }
  this.world.metrics.configured=this.providers.length>0;
  if(this.world.mode==='formal'&&Array.isArray(credentials)){
   this.world.metrics.routing={primary:QWEN_MODEL,primaryConfigured:this.providers.some(p=>p.model===QWEN_MODEL),backup:DEEPSEEK_MODEL,backupConfigured:this.providers.some(p=>p.model===DEEPSEEK_MODEL)};
  }
  this.world.metrics.model=this.providers[0]?.model??this.world.metrics.routing?.primary??GLM_MODEL;
  const interrupted=this.world.metrics.inFlight.length;
  if(interrupted){this.world.metrics.failures+=interrupted;this.world.metrics.unmeteredFailures=(this.world.metrics.unmeteredFailures??0)+interrupted;this.world.metrics.lastError='服务重启前的未完成请求，用量未知';}
  this.world.metrics.inFlight=[];
  for(const provider of this.providers)this.saveUsage(this.world,provider);
  // Historical account-level errors do not identify which resident is currently waiting for a retry.
  this.world.lastWallAt=Date.now();
  this.world.clock.paused=true;
  this.world.clock.reason=this.world.metrics.configured?'正在等待居民获得自主决策机会':'尚未连接居民模型，世界时间已停表';
  this.world.revision++;
  this.store.commit(this.world,previousRevision,{events:this.world.events.slice(originalEvents),processed:this.world.processed.slice(originalReceipts)});
  if(this.world.mode==='formal'){
   this.store.useIndexedReceipts(this.world);
   this.world.processed=[];
   this.world.events=workingEvents(this.world);
   this.trimAt=this.world.events.length+256;
  }
 }
 snapshot():Snapshot{
  const {usageWindow:_usageWindow,...metrics}=this.world.metrics;
  const publicWorld={...this.world,metrics,events:this.world.events.slice(-180),processed:[]};
  const active=this.world.mode==='formal'
   ? [this.world.scenario==='frontier'?'9 位开拓居民、四季与代际生活；来访、迁居和成家各由本人决定':'创始居民、四季与代际生活；真实迁入、成家、离开与死亡',...(this.world.frontierHazards?['野兽、山洪与风暴会造成实际险情，居民可以退避、入屋和修护受损房屋']:[]),'实际到场的课堂、工作、诊疗、托育、养老与公共服务','农田、牧场、有限鱼群、沿岸休息、温室与原料加工','独立议价、私营雇佣、公共财政、外贸、陆运与船程','分阶段建造、兼容改版、道路桥梁、码头与墓园','共同生活财产、借贷、遗产原址保全与纪念','按会话阅读对话，查阅完整年表、人物生平和关系图','只读观察，无观众时仍处理居民的模型决定'] : capabilities.active;
  const pending=this.world.mode==='formal'
   ? ['真实居民的长期人口、资源与经济平衡会随实际选择持续观察'] : capabilities.pending;
  return {world:publicWorld,serverTime:new Date().toISOString(),version:VALLEY_VERSION,
    mapRevision:terrainRevision(this.world.map),capabilities:{active,pending}};

 }
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 private commit(mutate:(draft:World)=>void){
  const current=this.world;
  const {map,events,processed,...dynamic}=current;
  const formal=current.mode==='formal';
  // Only this draft owns the pending receipts. Durable history remains available for replay checks.
  const draft={...structuredClone(dynamic),map,events:formal?events.slice():structuredClone(events),
   processed:processed.slice()};
  inheritReceiptHistory(current,draft);
  mutate(draft);
  draft.revision=Math.max(draft.revision,current.revision+1);
  this.store.commit(draft,current.revision,formal?{
   events:draft.events.slice(events.length),processed:draft.processed,
  }:undefined);
  if(formal)draft.processed=[];
  if(formal&&draft.events.length>=this.trimAt){
   draft.events=workingEvents(draft);
   this.trimAt=draft.events.length+256;
  }
  this.world=draft;
  for(const listener of this.listeners)listener();
 }
 start(){this.stopped=false;this.lastTick=Date.now();this.lastLocalDecision=this.lastTick;this.schedule();this.tickTimer=setInterval(()=>this.tick(),1000);}
 stop(){
  if(this.stopped)return;this.stopped=true;if(this.tickTimer)clearInterval(this.tickTimer);
  const interrupted=this.inFlight.size;
  if(interrupted)this.commit(w=>{w.clock.paused=true;w.clock.reason='服务正在重新连接，世界时间已停表';w.metrics.failures+=interrupted;w.metrics.unmeteredFailures=(w.metrics.unmeteredFailures??0)+interrupted;w.metrics.lastError='服务重启前的未完成请求，用量未知';w.metrics.inFlight=[];});
  this.inFlight.clear();
 }
 private ready(actor:Resident){return actor.status==='alive'&&actor.canDecide&&actor.canExpress&&actor.residency!=='outside'&&!actor.plan&&!actor.activity&&actor.decisionDue<=this.world.minute;}
 private get fastClock(){return this.world.mode==='formal'&&this.world.clock.realMinutesPerDay<=FAST_DAY_MINUTES;}
 /** Clock never catches up downtime, and model outages are never simulated as famine. */
 tick(now=Date.now()){
  if(this.stopped)return;
  if(agencyReady(this.world))this.commit(w=>{for(const plan of advanceAgency(w))submitPlan(w,plan);});
  const elapsed=Math.max(0,Math.min(2000,now-this.lastTick));this.lastTick=now;
  const advance=gameMinutesFromWall(elapsed,this.world.clock.realMinutesPerDay);
  const ready=this.world.residents.filter(p=>this.ready(p));
  for(const p of ready)if(!this.waitingSince.has(p.id))this.waitingSince.set(p.id,now);
  const waitingIds=new Set([...ready,...outsideCandidate(this.world),...foreignCandidates(this.world)].map(p=>p.id));
  for(const id of this.waitingSince.keys())if(!waitingIds.has(id))this.waitingSince.delete(id);
  for(const id of this.fallbackPending)if(!waitingIds.has(id))this.fallbackPending.delete(id);
  const fast=this.fastClock;
  const noReplies=fast&&now-this.lastLocalDecision>=180_000&&ready.some(p=>now-this.waitingSince.get(p.id)!>=180_000);
  // At the fast clock, personal emergencies and appointments affect decision priority.
  // Their timing still advances while the model is preparing a decision.
  const overdue=!fast&&ready.some(p=>{
   const waited=now-this.waitingSince.get(p.id)!;
   const deadline=worldDeadline(this.world,p.id);
   const need=p.hunger>80||p.energy<10||p.health<50;
   // Ordinary response latency should not stop the formal world at every decision. Protect
   // distressed dependents and scheduled commitments immediately, and cap the grace for needs.
   const needsHold=need&&(this.world.mode!=='formal'||waited>=30_000);
   return needsHold||p.health<=1||observedChildPressure(this.world,p)>0||this.world.minute-p.decisionDue>=60||deadline-this.world.minute<=15;
  });
  const noInitialPlan=ready.some(p=>p.lastDecisionAt<0)&&(!fast||!this.world.residents.some(p=>p.lastDecisionAt>=0));
  const failure=ready.some(p=>this.failures.has(p.id));
  const paused=!this.providers.length||noReplies||overdue||noInitialPlan;
  const reason=!this.providers.length?'尚未连接居民模型，世界时间已停表':noReplies?'模型持续未提供居民决定，世界时间已保护性停表':paused?(failure?'居民正在等待模型重试，世界时间已保护性停表':'正在等待居民获得自主决策机会'):null;
  if(paused&&this.world.clock.paused&&this.world.clock.reason===reason&&JSON.stringify(this.world.metrics.inFlight)===JSON.stringify([...this.inFlight.keys()])){this.schedule();return;}
  this.commit(w=>{
   w.clock.paused=paused;w.clock.reason=reason;w.lastWallAt=now;
   if(!paused)stepWorld(w,advance);
   w.metrics.inFlight=[...this.inFlight.keys()];
  });
  this.schedule();
 }
 private schedule(){
  if(!this.providers.length||this.stopped)return;
  const now=Date.now();
  if(this.providers.every(provider=>now<Math.max(provider.blockedUntil,provider.admitAfter)))return;
  const residents=this.world.residents.filter(p=>this.ready(p));
  const travellers=[...outsideCandidate(this.world),...foreignCandidates(this.world)];
  for(const visitor of travellers)if(!this.waitingSince.has(visitor.id))this.waitingSince.set(visitor.id,now);
  const candidates=[...residents,...travellers].filter(p=>!this.inFlight.has(p.id)&&(this.retryAt.get(p.id)??0)<=now);
  // Need and elapsed opportunity come before a stable, non-roster tie breaker.
  candidates.sort((a,b)=>this.priority(b,now)-this.priority(a,now));
  for(const actor of candidates){
   if(this.inFlight.size>=this.modelSlots)break;
   const provider=this.providerFor(actor.id,now);
   if(provider)void this.decide(actor.id,provider);
  }
 }
 private providerFor(actorId:string,now:number):Provider|undefined{
  const [primary,backup]=this.providers;
  const tryBackup=backup&&now>=Math.max(backup.blockedUntil,backup.admitAfter)&&(this.fallbackPending.has(actorId)||now<primary.blockedUntil);
  const provider=tryBackup?backup:primary;
  if(now<Math.max(provider.blockedUntil,provider.admitAfter)||[...this.inFlight.values()].filter(p=>p===provider).length>=provider.slots)return;
  return provider;
 }
 private saveUsage(w:World,provider:Provider){if(provider.budget)(w.metrics.usageWindow??={})[provider.model]=provider.budget.snapshot();}
 private priority(p:Resident,now:number){
  const local=p.residency!=='outside';
  const fast=this.fastClock,rate=this.world.clock.realMinutesPerDay;
  const missedOpportunity=local&&this.world.minute-p.decisionDue>=(fast?gameMinutesFromWall(120_000,rate):45);
  const imminentPromise=local&&worldDeadline(this.world,p.id)-this.world.minute<=(fast?gameMinutesFromWall(60_000,rate):15);
  const childPressure=local?observedChildPressure(this.world,p):0;
  const urgent=local&&(p.hunger>80||p.energy<10||p.health<50||childPressure>0);
  const critical=fast&&local&&(p.health<=20||observedChildPressure(this.world,p,true)>0);
  const deadlinePriority=critical?2000:missedOpportunity||imminentPromise||urgent?1000:0;
  return deadlinePriority+childPressure+p.hunger+(100-p.energy)*.5+(100-p.health)*2
   +(now-(this.waitingSince.get(p.id)??now))/1000+this.tie(p.id);
 }
 private tie(id:string){let n=this.world.seed;for(const c of id)n=((n*31)^c.charCodeAt(0))>>>0;return n%1000/1000;}
 private async decide(actorId:string,provider:Provider){
  const foreign=isForeignActor(this.world,actorId);
  const merchant=foreign?foreignCandidates(this.world).find(p=>p.id===actorId):undefined;
  const traveller=outsideCandidate(this.world).find(p=>p.id===actorId);
  const actor=merchant??traveller??this.world.residents.find(p=>p.id===actorId);if(!actor)return;
  const revision=actor.revision;
  const feedback=this.replyFeedback.get(actorId);
  let context:ReturnType<typeof decisionContext>,prepared:ReturnType<typeof prepareModelDecision>;
  try{
   context=foreign?foreignDecisionContext(this.world,actor):traveller?outsideDecisionContext(this.world,actor):decisionContext(this.world,actor);
   prepared=prepareModelDecision(context,feedback,provider.model);
  }catch(error){
   const reason=error instanceof Error&&error.message==='model_context_limit'?'model_context_limit':'model_request_invalid';
   this.fallbackPending.delete(actorId);this.retryAt.set(actorId,Date.now()+30_000);this.failures.set(actorId,reason);
   this.commit(w=>{w.metrics.lastError=reason;});return;
  }
  const started=Date.now();
  const limits=modelLimits[provider.model];
  const charge=provider.budget?.reserve(started,prepared.inputBytes+512,limits.answerTokens+limits.thinkingTokens);
  if(provider.budget&&!charge){provider.admitAfter=started+1000;return;}
  this.fallbackPending.delete(actorId);
  this.inFlight.set(actorId,provider);
  this.commit(w=>{w.metrics.requests++;w.metrics.lastAttemptModel=provider.model;w.metrics.inFlight=[...this.inFlight.keys()];this.saveUsage(w,provider);});
  try{
   const result=await this.model(provider.key,context,feedback,provider.model,prepared);
   if(this.stopped)return;
   if(charge)provider.budget!.finish(charge,Date.now(),result);
   this.replyFeedback.delete(actorId);
   if(started>=provider.blockedUntil){
    provider.limitCount=0;
    provider.transientFailures=0;
    if(provider.slots<provider.maxSlots && ++provider.successesSinceLimit>=8){provider.slots++;provider.successesSinceLimit=0;}
   }
   this.commit(w=>{
    const current=w.residents.find(p=>p.id===actorId);
    this.saveUsage(w,provider);w.metrics.model=provider.model;w.metrics.lastLatencyMs=result.latencyMs;w.metrics.inputTokens+=result.inputTokens;w.metrics.outputTokens+=result.outputTokens;
    if(foreign){
     const accepted=applyForeignDecision(w,actorId,revision,result.decision);
     if(!accepted.ok){w.metrics.failures++;w.metrics.lastError=accepted.error??'外贸条件已变化';this.retryAt.set(actorId,Date.now()+5000);return;}
     w.metrics.successes++;this.failures.delete(actorId);this.retryAt.delete(actorId);w.metrics.lastError=this.failures.values().next().value??null;
     return;
    }
    if(traveller){
     const accepted=applyOutsideDecision(w,actorId,revision,result.decision);
     if(!accepted.ok){w.metrics.failures++;w.metrics.lastError=accepted.error??'旅途消息已变化';this.retryAt.set(actorId,Date.now()+5000);return;}
     w.metrics.successes++;this.failures.delete(actorId);this.retryAt.delete(actorId);w.metrics.lastError=this.failures.values().next().value??null;
     return;
    }
    if(!current||current.status!=='alive'||current.revision!==revision){w.metrics.failures++;w.metrics.lastError='过期的居民计划已丢弃';return;}
    const plan:Plan={id:`${w.id}:plan:${actorId}:${revision}:${started}`,actorId,actorRevision:revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine']??'action/routine@1',intention:result.decision.intention,actions:result.decision.actions};
    const accepted=submitPlan(w,plan);
    if(!accepted.ok){w.metrics.failures++;current.lastFailure=accepted.error??'计划不再适用';w.metrics.lastError='居民计划需要重新安排';this.failures.set(actorId,w.metrics.lastError);this.retryAt.set(actorId,Date.now()+5000);return;}
    current.lastDecisionAt=w.minute;this.lastLocalDecision=Date.now();w.metrics.successes++;this.failures.delete(actorId);w.metrics.lastError=this.failures.values().next().value??null;this.retryAt.delete(actorId);
   });
  }catch(error){
   if(this.stopped)return;
   if(charge)provider.budget!.finish(charge,Date.now(),error instanceof DecisionError?error.stats:undefined);
   const code=error instanceof Error?error.message:'model_failed';
   const safe=/^(model_http_\d{3}|model_incomplete|model_stream_error|model_context_limit|invalid_decision|unsupported_action|invalid_action)$/.test(code)?code:'model_timeout_or_invalid_response';
   const backup=provider===this.providers[0]?this.providers[1]:undefined;
   let retryDelay=30_000;
   if(!foreign&&!traveller&&error instanceof DecisionError&&error.feedback){
    if(!this.replyFeedback.has(actorId))retryDelay=5000;
    this.replyFeedback.set(actorId,error.feedback);
   }
   if(/^model_http_(401|402|403|404|429)$/.test(safe)){
    // Several failures from one already-dispatched wave represent one limit event.
    if(started>=provider.blockedUntil){
     provider.slots=Math.max(1,Math.floor(provider.slots/2));
     provider.successesSinceLimit=0;
     provider.transientFailures=0;
     provider.limitCount=Math.min(6,provider.limitCount+1);
     provider.blockedUntil=Date.now()+Math.min(900_000,30_000*2**(provider.limitCount-1));
    }
    retryDelay=Math.max(5000,provider.blockedUntil-Date.now());
   }else if(backup&&started>=provider.blockedUntil&&/^(model_http_5\d{2}|model_timeout_or_invalid_response|model_stream_error)$/.test(safe)){
    if(++provider.transientFailures>=3){
     provider.blockedUntil=Date.now()+30_000;
     provider.transientFailures=0;
    }
   }
   if(backup&&Date.now()>=backup.blockedUntil&&safe!=='model_context_limit'){
    this.fallbackPending.add(actorId);
    retryDelay=0;
   }
   this.retryAt.set(actorId,Date.now()+retryDelay);this.failures.set(actorId,safe);
   this.commit(w=>{this.saveUsage(w,provider);w.metrics.failures++;w.metrics.lastError=safe;if(error instanceof DecisionError){w.metrics.inputTokens+=error.stats.inputTokens;w.metrics.outputTokens+=error.stats.outputTokens;w.metrics.lastLatencyMs=error.stats.latencyMs;}else{w.metrics.unmeteredFailures=(w.metrics.unmeteredFailures??0)+1;}});
  }finally{
   this.inFlight.delete(actorId);
   if(!this.stopped)this.schedule();
  }
 }
}
