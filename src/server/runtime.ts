import {readSelfHostedCooldowns,cooldownDelay} from './self-hosted-cooldown.js';
import {createHash} from 'node:crypto';
import {nextDailyBoundary,checkedDailySnapshotConfig,type DailySnapshotConfig} from './acceptance-daily-snapshots.js';
import {hasCareWithdrawal,careWithdrawalOnly} from '../world/care-withdrawal.js';
import {expressiveTransportControl} from '../world/medical-transport.js';
import {initializeWaterSupply} from '../world/water-supply.js';
import {regionalDecisionWait} from '../shared/outside-aid.js';
import {initializeFamilyRelocation} from '../world/family-relocation.js';
import {initializeCommons} from '../world/commons.js';
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
import {settlementFoodCoverage} from '../world/food-coverage.js';
import {initializeRooms} from '../world/rooms.js';
import {initializeIndustry} from '../world/industry.js';
import {initializeEducation,educationDeadline} from '../world/education.js';
import type {World,Snapshot,Plan,Resident,ModelAdmissionCancellation} from '../shared/types.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan,planStartError} from '../world/engine.js';
import type {DirectEatingObservation} from '../world/food-consumption-evidence.js';
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
import {callModel,decisionContext,decisionChoices,prepareModelDecision,DecisionError,type ModelResult} from './decisions.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,modelLimits,type ModelConnection,type ModelName} from './model-completion.js';
import {ModelBudget} from './model-budget.js';
import {DecisionWaitEvidence,type DecisionWaitEvidenceOptions} from './decision-wait-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvidenceOptions} from './runtime-food-evidence.js';
import type {AcceptanceEvidenceWriter} from './acceptance-evidence-writer.js';
import {AcceptanceStopControl,type AcceptanceStopOptions,type AcceptanceStopReason,type AcceptanceStopStatus} from './acceptance-stop-control.js';
import {inheritReceiptHistory} from '../world/receipts.js';
import {FAST_DAY_MINUTES,knownAgeYears,gameMinutesFromWall} from '../world/time.js';

type Model = (key:string,context:ReturnType<typeof decisionContext>,feedback?:string,model?:ModelName,prepared?:ReturnType<typeof prepareModelDecision>,execution?:{signal:AbortSignal})=>Promise<ModelResult & {acceptanceCostUsd?:number}>;
/** Trusted synchronous sink. Result identity correlates one response, not an
 * aggregate success counter. Fired after durable decision commit, before other
 * subscribers; it does not assert that the selected action has completed. */
export type DecisionCommittedEvent=Readonly<{result:ModelResult;actorId:string;accepted:boolean;revision:number;
 rejection:'actor_changed'|'plan_invalid'|'regional_changed'|'foreign_changed'|null}>;
/** A persisted local start rejected by the optional admission gate, before the
 * injected model is called. This is not a transport attempt or cost receipt. */
export type DecisionAdmissionCancelledEvent=Readonly<ModelAdmissionCancellation&{model:ModelName}>;
export type AcceptanceLifecycleObserver={stopping?:(status:AcceptanceStopStatus)=>unknown;stopped?:(status:AcceptanceStopStatus)=>unknown};
type Provider = ModelConnection & {slots:number;maxSlots:number;blockedUntil:number;admitAfter:number;limitCount:number;successesSinceLimit:number;transientFailures:number;rateLimitedAt:number;budget?:ModelBudget};
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
  if(!present||!child.guardianIds.includes(guardian.id))continue;
  // Unknown birth records must not create infant-care priority or clock holds.
  // The waiter's own verified needs and rescue eligibility remain independent.
  const age=knownAgeYears(child.bornAt,world.minute);
  if(age===null||age>=6)continue;
  if(criticalOnly?child.health<=20:child.hunger>=80||child.health<50)pressure=Math.max(pressure,child.hunger+(100-child.health)*2);
 }
 return pressure;
}
export class ValleyRuntime {
 world:World;
 private trimAt=512;
 private inFlight=new Map<string,Provider>();
 private pendingChoices=new Map<string,Plan['actions']>();
 private retryAt=new Map<string,number>();
 private readonly modelSlots:number;
 private readonly providers:Provider[];
 private fallbackPending=new Set<string>();
 private readonly selfHostedSafety:boolean;
 private selfHostedInterrupted=false;
 private selfHostedLastWall=Date.now();
 selfHostedUnresolved(){return this.selfHostedInterrupted;}
 private failures=new Map<string,string>();
 private replyFeedback=new Map<string,string>();
 private waitingSince=new Map<string,number>();
 private lastTick=Date.now();
 private lastResidentDecision=this.lastTick;
  private listeners=new Set<()=>void>();
 private stopped=false;
 private started=false;
 private generation=0;
 private requestTokens=new Map<string,{generation:number;controller:AbortController;terminalCommitted:boolean}>();
 private readonly acceptance?:AcceptanceStopControl;
 private readonly acceptanceEvidence?:{writer:AcceptanceEvidenceWriter;sourceFingerprintAfter:()=>string};
 private acceptanceCommitFailed=false;
 private readonly dailySnapshots?:DailySnapshotConfig;
 private readonly decisionEvidence?:DecisionWaitEvidence;
 private readonly foodEvidence?:RuntimeFoodEvidence;
 private readonly decisionCommitted?: (event:DecisionCommittedEvent)=>unknown;
 private readonly decisionAdmissionCancelled?: (event:DecisionAdmissionCancelledEvent)=>unknown;
 private readonly admissionBaseline:{requests:number;cancellations:number};
 private readonly acceptanceLifecycle?:AcceptanceLifecycleObserver;
 private readonly acceptanceAdmission?:()=>unknown;
 private acceptanceDraining=false;
 private tickTimer?:ReturnType<typeof setInterval>;
 constructor(private store:WorldStore,credentials:string|null|readonly ModelConnection[],private model:Model=callModel,options:{selfHostedSafety?:boolean;dailySnapshots?:DailySnapshotConfig;dayMinutes?:number;mode?:World['mode'];modelSlots?:number;decisionWaitEvidence?:DecisionWaitEvidenceOptions;directEatingEvidence?:RuntimeFoodEvidenceOptions;acceptanceStop?:AcceptanceStopOptions;acceptanceEvidence?:{writer:AcceptanceEvidenceWriter;sourceFingerprintAfter:()=>string};decisionCommitted?:(event:DecisionCommittedEvent)=>unknown;decisionAdmissionCancelled?:(event:DecisionAdmissionCancelledEvent)=>unknown;acceptanceLifecycle?:AcceptanceLifecycleObserver;acceptanceAdmission?:()=>unknown}={}){
  if(options.dailySnapshots&&!options.acceptanceStop)throw new Error('daily_snapshots_require_acceptance_control');
  this.dailySnapshots=options.dailySnapshots?checkedDailySnapshotConfig(options.dailySnapshots):undefined;
  this.selfHostedSafety=options.selfHostedSafety===true;
  if(options.decisionCommitted&&!options.acceptanceStop)throw new Error('decision_commit_observer_requires_control');
  if(options.acceptanceLifecycle&&!options.acceptanceStop)throw new Error('acceptance_lifecycle_requires_control');
  if(options.acceptanceAdmission&&!options.acceptanceStop)throw new Error('acceptance_admission_requires_control');
  if(options.decisionAdmissionCancelled&&(!options.acceptanceStop||!options.acceptanceAdmission))throw new Error('admission_cancel_observer_requires_control');
  this.decisionCommitted=options.decisionCommitted;
  this.decisionAdmissionCancelled=options.decisionAdmissionCancelled;
  this.acceptanceLifecycle=options.acceptanceLifecycle?{...options.acceptanceLifecycle}:undefined;
  this.acceptanceAdmission=options.acceptanceAdmission;
  if(options.acceptanceEvidence&&(!options.acceptanceStop||options.decisionWaitEvidence||options.directEatingEvidence))throw new Error('acceptance_evidence_requires_exclusive_controlled_channels');
  this.acceptanceEvidence=options.acceptanceEvidence?{...options.acceptanceEvidence}:undefined;
  if(options.acceptanceStop){
   if(model===callModel)throw new Error('acceptance_stop_requires_injected_model');
   this.acceptance=new AcceptanceStopControl(options.acceptanceStop,()=>this.stop(),status=>{
    try{this.persistAcceptanceStop(status);}catch(error){
     this.observeAcceptanceLifecycle('stopped',{...status,issues:[...status.issues,'evidence_persistence_failed']});throw error;
    }
    this.observeAcceptanceLifecycle('stopped',status);
   },status=>this.observeAcceptanceLifecycle('stopping',status));
  }
  if(this.acceptanceEvidence){
   const writer=this.acceptanceEvidence.writer;
   if(writer.status().phase!=='open')throw new Error('acceptance_evidence_writer_not_open');
   options={...options,decisionWaitEvidence:{observe:writer.observeDecisionWait,
    monotonicNow:options.acceptanceStop?.clock?()=>options.acceptanceStop!.clock!.now():undefined},
    directEatingEvidence:{observe:writer.observeDirectEating}};
  }
  if(options.decisionWaitEvidence)this.decisionEvidence=new DecisionWaitEvidence(options.decisionWaitEvidence);
  if(options.directEatingEvidence)this.foodEvidence=new RuntimeFoodEvidence(options.directEatingEvidence);
  try{
  const saved=store.loadForRuntime();const previousRevision=saved?.revision??null;if(saved && options.mode && saved.mode!==options.mode)throw new Error('world_mode_mismatch');
  this.world=saved??(options.mode==='formal'?createFrontierWorld():createWorld());
  this.admissionBaseline={requests:this.world.metrics.requests,cancellations:this.world.metrics.admissionCancellation?.count??0};
  if(this.acceptanceEvidence){const identity=this.acceptanceEvidence.writer.identity();
   if(identity.worldId!==this.world.id||identity.fromMinute!==this.world.minute)throw new Error('acceptance_evidence_world_mismatch');}
  const originalEvents=this.world.events.length,originalReceipts=this.world.processed.length;
  const connections:readonly ModelConnection[]=typeof credentials==='string'?[{model:GLM_MODEL,key:credentials}]:credentials??[];
  const configured=connections.filter(c=>c.key);
  this.world.clock.realMinutesPerDay=options.dayMinutes??this.world.clock.realMinutesPerDay;
  const legacySlots=this.world.mode==='formal'?4:2;
  this.modelSlots=options.modelSlots??Math.max(legacySlots,...configured.map(c=>c.model===GLM_MODEL?legacySlots:modelLimits[c.model].maxSlots));
  if(!Number.isInteger(this.modelSlots)||this.modelSlots<1||this.modelSlots>modelLimits[QWEN_MODEL].maxSlots)throw new Error('Invalid resident model concurrency');
  const cooldowns=this.selfHostedSafety?readSelfHostedCooldowns(this.world.metrics.selfHostedCooldowns,Date.now()):{};
  this.providers=configured.map(c=>{
   const limits=modelLimits[c.model];
   const maxSlots=Math.min(limits.maxSlots,this.modelSlots);
   const slots=c.model===GLM_MODEL?maxSlots:Math.min(limits.startSlots,maxSlots);
   const budget=limits.tpm===null&&limits.rpm===null?undefined:new ModelBudget(limits.rpm,limits.tpm,this.world.metrics.usageWindow?.[c.model]);
   return {...c,slots,maxSlots,budget,blockedUntil:cooldowns[c.model]?.blockedUntil??0,rateLimitedAt:cooldowns[c.model]?.observedAt??0,admitAfter:0,limitCount:cooldowns[c.model]?.limitCount??0,successesSinceLimit:0,transientFailures:0};
  });
  terrainRevision(this.world.map);
  if(this.world.mode==='formal'){
   initializeEconomy(this.world);
   initializeProduction(this.world);
   initializeCivic(this.world);initializeCommons(this.world);initializeWaterSupply(this.world);
   initializeEmployment(this.world);
   initializeForeignTrade(this.world);
   initializeConstruction(this.world);initializeEducation(this.world);initializeIndustry(this.world);initializeFerries(this.world);initializeRooms(this.world);initializeFood(this.world);initializeHealth(this.world);initializeLongCare(this.world);initializeFunerary(this.world);initializeInfrastructure(this.world);initializeAgency(this.world);initializeAdoption(this.world);initializeFamilyRelocation(this.world);initializeDebt(this.world);initializeHousehold(this.world);initializeSocial(this.world);initializeCulture(this.world);
   ensureCensus(this.world);
   initializeMigration(this.world);
   advancePublicDuties(this.world);
   if(this.world.scenario==='frontier')initializeFrontierHazards(this.world);
  }
  this.world.metrics.configured=this.providers.length>0;
  if(this.world.mode==='formal'&&Array.isArray(credentials)){
   this.world.metrics.routing={primary:this.providers[0]?.model??QWEN_MODEL,primaryConfigured:!!this.providers[0],backup:this.providers[1]?.model??'',backupConfigured:!!this.providers[1]};
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
  }catch(error){this.acceptanceEvidence?.writer.abort();throw error;}
 }
 snapshot():Snapshot{
  const {usageWindow:_usageWindow,...metrics}=this.world.metrics;
  const publicWorld={...this.world,metrics,events:this.world.events.slice(-180),processed:[]};
  const active=this.world.mode==='formal'
   ? [this.world.scenario==='frontier'?'9 位开拓居民、四季与代际生活；来访、迁居和成家各由本人决定':'创始居民、四季与代际生活；真实迁入、成家、离开与死亡',...(this.world.frontierHazards?[this.world.frontierHazards.weather?.enabled?'野兽与天气灾害可造成实际险情，居民自行退避、入屋或修护':'野兽可造成实际险情；新天气预警未启用，既有险情与修护继续保留']:[]),'实际到场的课堂、工作、诊疗、托育、养老与公共服务','农田、牧场、有限鱼群、沿岸休息、温室与原料加工','独立议价、私营雇佣、公共财政、外贸、陆运与船程','分阶段建造、兼容改版、道路桥梁、码头与墓园','共同生活财产、借贷、遗产原址保全与纪念','按会话阅读对话，查阅完整年表、人物生平和关系图','只读观察，无观众时仍处理居民的模型决定'] : capabilities.active;
  const pending=this.world.mode==='formal'
   ? ['真实居民的长期人口、资源与经济平衡会随实际选择持续观察'] : capabilities.pending;
  return {world:publicWorld,...(this.world.mode==='formal'?{foodCoverage:settlementFoodCoverage(this.world)}:{}),serverTime:new Date().toISOString(),version:VALLEY_VERSION,
    mapRevision:terrainRevision(this.world.map),capabilities:{active,pending}};

 }
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 private commit(mutate:(draft:World)=>void,afterCommit?:()=>void){
  const current=this.world;
  const {map,events,processed,...dynamic}=current;
  const formal=current.mode==='formal';
  // Only this draft owns the pending receipts. Durable history remains available for replay checks.
  const draft={...structuredClone(dynamic),map,events:formal?events.slice():structuredClone(events),
   processed:processed.slice()};
  inheritReceiptHistory(current,draft);
  mutate(draft);
  draft.revision=Math.max(draft.revision,current.revision+1);
  try{this.store.commit(draft,current.revision,formal?{
   events:draft.events.slice(events.length),processed:draft.processed,
  }:undefined);}catch(error){this.acceptanceCommitFailed=true;throw error;}
  if(formal)draft.processed=[];
  if(formal&&draft.events.length>=this.trimAt){
   draft.events=workingEvents(draft);
   this.trimAt=draft.events.length+256;
  }
  this.world=draft;
  this.acceptance?.recordCommittedMinute(draft.minute);
  // Receipt observers contain their own errors and run only after durable commit,
  // before unrelated subscribers can throw. Never publish draft-only consumption.
  afterCommit?.();
  for(const listener of this.listeners)listener();
 }
 /** External evidence status only; never persisted or exposed to resident decisions. */
 decisionWaitEvidenceStatus(){return this.decisionEvidence?.status()??null;}
 directEatingEvidenceStatus(){return this.foodEvidence?.status()??null;}
 private observeDecisionWaiters(initial=false){
  if(!this.decisionEvidence)return;
  this.decisionEvidence.reconcile([
   ...this.world.residents.filter(p=>this.ready(p)).map(p=>({actorId:p.id,actorKind:'resident' as const})),
   ...outsideCandidate(this.world).map(p=>({actorId:p.id,actorKind:'regional' as const})),
   ...foreignCandidates(this.world).map(p=>({actorId:p.id,actorKind:'foreign' as const})),
  ],this.world.minute,initial);
 }
 start(){
  if(this.selfHostedSafety&&this.started)throw new Error('self_hosted_runtime_is_single_use');
  if(this.acceptance&&(this.started||this.acceptance.status().phase==='stopped'))throw new Error('acceptance_runtime_is_single_use');
  if(this.started&&!this.stopped)return;
  this.started=true;this.stopped=false;this.generation++;
  try{
  this.foodEvidence?.start(this.world.id,this.world.minute);this.decisionEvidence?.start(this.world.minute);this.observeDecisionWaiters(true);
  this.lastTick=Date.now();this.lastResidentDecision=this.lastTick;
  if(this.stopped)return;
  if(this.acceptance){this.acceptance.start(this.world.minute);
   if(this.acceptance.status().phase==='running')this.acceptanceEvidence?.writer.observeAcceptanceControl(this.acceptance.status());
   if(!this.acceptanceReady()||!this.acceptance.validateModels(this.providers.map(p=>p.model))||!this.acceptance.committed(this.world))return;}
  this.schedule();if(!this.stopped)this.tickTimer=setInterval(()=>this.tick(),1000);
  }catch(error){if(!this.acceptance)throw error;this.acceptance.stop(this.acceptanceEvidence?.writer.status().phase==='failed'?'evidence_failed':'runtime_failed');}
 }
 stop(){
  if(this.stopped)return;
  if(this.acceptance&&this.acceptance.status().phase!=='stopped'){this.acceptance.stop('manual_stop');return;}
  this.stopped=true;this.generation++;if(this.tickTimer)clearInterval(this.tickTimer);
  const interrupted=this.unresolvedRequestIds().length;
  if(this.selfHostedSafety&&interrupted)this.selfHostedInterrupted=true;
  const tokens=[...this.requestTokens.values()];this.requestTokens.clear();this.inFlight.clear();this.pendingChoices.clear();
  for(const token of tokens)token.controller.abort();
  // Revocation and cancellation precede any fallible storage/observer callback.
  if(interrupted||this.acceptance)this.commit(w=>{w.clock.paused=true;w.clock.reason=this.acceptance?'隔离验收已停止，世界时间已停表':'服务正在重新连接，世界时间已停表';
   w.metrics.failures+=interrupted;w.metrics.unmeteredFailures=(w.metrics.unmeteredFailures??0)+interrupted;
   if(interrupted)w.metrics.lastError='服务重启前的未完成请求，用量未知';w.metrics.inFlight=[];});
  // Failed persistence must leave evidence open/unknown, never synthesize a clean close.
  this.decisionEvidence?.stop(this.world.minute);this.foodEvidence?.stop(this.world.id,this.world.minute);
  if(this.acceptance&&(this.decisionEvidence?.status().phase==='failed'||this.foodEvidence?.status().phase==='failed'))throw new Error('acceptance_evidence_close_failed');
 }
 /** Explicitly called by an optional caller-owned signal binding. No global handlers. */
 stopAcceptance(reason:Extract<AcceptanceStopReason,'manual_stop'|'signal'>='manual_stop'){
  if(!this.acceptance)throw new Error('acceptance_control_not_enabled');this.acceptance.stop(reason);
 }
 acceptanceStopStatus(){return this.acceptance?.status()??null;}
 /** Explicit controlled, one-way drain. Existing responses retain the normal
  * settle/commit path; only new admission stops. Not a remote cancellation. */
 drainAcceptance(){
  if(!this.acceptance||!this.acceptanceAdmission)throw new Error('acceptance_drain_not_enabled');
  this.acceptanceDraining=true;this.finishAcceptanceDrain();
 }
 private finishAcceptanceDrain(){if(this.acceptanceDraining&&!this.stopped&&this.inFlight.size===0)this.stop();}
 private acceptanceAdmissionReady(){
  if(!this.acceptanceAdmission)return true;
  if(this.stopped)return false;
  if(this.acceptanceDraining){this.finishAcceptanceDrain();return false;}
  try{
   const allowed=this.acceptanceAdmission();
   if(allowed&&typeof (allowed as {then?:unknown}).then==='function')void Promise.resolve(allowed).catch(()=>{});
   if(typeof allowed!=='boolean')throw new Error('acceptance_admission_must_be_synchronous_boolean');
   if(!allowed){this.drainAcceptance();return false;}
   return !this.stopped&&!this.acceptanceDraining;
  }catch{this.acceptance!.stop('runtime_failed');return false;}
 }
 private observeAcceptanceLifecycle(phase:keyof AcceptanceLifecycleObserver,status:AcceptanceStopStatus){
  const returned=this.acceptanceLifecycle?.[phase]?.(Object.freeze(status));
  if(returned&&typeof (returned as {then?:unknown}).then==='function'){
   void Promise.resolve(returned).catch(()=>{});throw new Error('acceptance_lifecycle_must_be_synchronous');
  }
 }
 private persistAcceptanceStop(control:AcceptanceStopStatus){
  const evidence=this.acceptanceEvidence;if(!evidence)return;
  const writer=evidence.writer;
  try{
   writer.observeAcceptanceControl(control);
   const statuses={decisionWaiting:this.decisionWaitEvidenceStatus(),directEating:this.directEatingEvidenceStatus()};
   // A durable terminal record is useful even when shutdown failed. It is not a seal.
   if(this.acceptanceCommitFailed||control.issues.length||['runtime_failed','evidence_failed','endpoint_observer_failed'].includes(control.reason??'')
    ||statuses.decisionWaiting?.phase!=='stopped'||statuses.directEating?.phase!=='stopped'){
    writer.abort();return;
   }
   const sourceFingerprintAfter=evidence.sourceFingerprintAfter();
   if(sourceFingerprintAfter!==writer.identity().sourceFingerprint)throw new Error('acceptance_source_changed');
   const report=writer.close({reason:control.reason!,statuses,sourceFingerprintAfter});
   if(!report.complete)throw new Error('acceptance_evidence_incomplete');
  }catch{writer.abort();throw new Error('acceptance_evidence_persistence_failed');}
 }

 private acceptanceReady(){
  if(!this.acceptance)return !this.stopped;
  if(this.decisionEvidence?.status().phase==='failed'||this.foodEvidence?.status().phase==='failed'
   ||this.acceptanceEvidence&&this.acceptanceEvidence.writer.status().phase!=='open'){
   this.acceptance.stop('evidence_failed');return false;
  }
  return !this.stopped&&this.acceptance.check(this.world.minute);
 }
 private ready(actor:Resident){return actor.status==='alive'&&(actor.canDecide||hasCareWithdrawal(this.world,actor)||expressiveTransportControl(this.world,actor))&&actor.canExpress&&actor.residency!=='outside'&&(!actor.plan&&!actor.activity||careWithdrawalOnly(this.world,actor)||expressiveTransportControl(this.world,actor))&&actor.decisionDue<=this.world.minute;}
 private get fastClock(){return this.world.mode==='formal'&&this.world.clock.realMinutesPerDay<=FAST_DAY_MINUTES;}
 /** A terminal world transaction can notify subscribers before its async slot
  * leaves inFlight. Reentrant ticks, starts and stops must not revive that
  * already-accounted request. This does not acknowledge any provider journal. */
 private unresolvedRequestIds(){return [...this.inFlight.keys()].filter(id=>!this.requestTokens.get(id)?.terminalCommitted);}
 /** Clock never catches up downtime, and model outages are never simulated as famine. */
 tick(now=Date.now()){
  if(this.stopped||this.acceptance&&!this.acceptanceReady())return;
  try{this.tickOnce(now);}catch(error){if(!this.acceptance)throw error;this.acceptance.stop('runtime_failed');}
 }
 private tickOnce(now:number){
  if(this.selfHostedSafety){const wall=Date.now();if(!Number.isSafeInteger(wall)||wall<this.selfHostedLastWall){this.selfHostedInterrupted=true;this.stop();return;}this.selfHostedLastWall=wall;}
  if(agencyReady(this.world))this.commit(w=>{for(const plan of advanceAgency(w))submitPlan(w,plan);});
  this.observeDecisionWaiters();
  const elapsed=Math.max(0,Math.min(2000,now-this.lastTick));this.lastTick=now;
  const requested=gameMinutesFromWall(elapsed,this.world.clock.realMinutesPerDay);
  const controlled=this.acceptance?this.acceptance.clampAdvance(this.world.minute,requested):requested;
  const boundary=this.dailySnapshots?nextDailyBoundary(this.world.minute,this.dailySnapshots):Infinity;
  const advance=Math.min(controlled,boundary-this.world.minute);
  const exactEndMinute=Number.isFinite(boundary)&&advance===boundary-this.world.minute?boundary:undefined;
  if(this.stopped)return;
  const ready=[...this.world.residents.filter(p=>this.ready(p)),...outsideCandidate(this.world).filter(p=>regionalDecisionWait(this.world,p))];
  for(const p of ready)if(!this.waitingSince.has(p.id))this.waitingSince.set(p.id,now);
  const waitingIds=new Set([...ready,...outsideCandidate(this.world),...foreignCandidates(this.world)].map(p=>p.id));
  for(const id of this.waitingSince.keys())if(!waitingIds.has(id))this.waitingSince.delete(id);
  for(const id of this.fallbackPending)if(!waitingIds.has(id))this.fallbackPending.delete(id);
  const fast=this.fastClock;
  const noReplies=fast&&now-this.lastResidentDecision>=180_000&&ready.some(p=>now-this.waitingSince.get(p.id)!>=180_000);
  // The default clock reaches 180 game minutes before the wall-time outage
  // threshold. Persisted local-decision evidence prevents a total outage (or
  // a restart during it) from killing the waiter in that gap. Other residents'
  // valid decisions keep the personal expiry independent of the shared clock.
  const protectionOutage=fast&&ready.some(p=>{
   const state=p.decisionProtection;
   return state&&state.recoveredAt===null&&(state.endedAt===null||state.reason==='expired')
    &&state.expiresAt<=this.world.minute+advance+1e-9
    &&(typeof state.regionalDecisionsAtStart!=='number'||(this.world.metrics.regionalDecisions??0)===state.regionalDecisionsAtStart)
    &&(typeof state.localDecisionsAtStart==='number'?(this.world.metrics.localDecisions??0)===state.localDecisionsAtStart
     :this.world.residents.every(r=>r.lastDecisionAt<=state.startedAt));
  });
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
  const paused=!this.providers.length||noReplies||protectionOutage||overdue||noInitialPlan;
  const reason=!this.providers.length?'尚未连接居民模型，世界时间已停表':noReplies||protectionOutage?'模型持续未提供居民决定，世界时间已保护性停表':paused?(failure?'居民正在等待模型重试，世界时间已保护性停表':'正在等待居民获得自主决策机会'):null;
  if(paused&&this.world.clock.paused&&this.world.clock.reason===reason&&JSON.stringify(this.world.metrics.inFlight)===JSON.stringify(this.unresolvedRequestIds())){this.schedule();return;}
  let eating:DirectEatingObservation|null=null;
  this.commit(w=>{
   w.clock.paused=paused;w.clock.reason=reason;w.lastWallAt=now;
   if(!paused){const options:Parameters<typeof stepWorld>[2]={exactEndMinute,decisionChoices:(world,resident)=>{
    // A rotating overview cannot revoke a still-executable choice already sent
    // to this resident. Every candidate is revalidated against current facts.
    const choices=[...decisionChoices(decisionContext(world,resident)).map(c=>c.action),...(this.pendingChoices.get(resident.id)??[])];
    return [...new Map(choices.map(action=>[JSON.stringify(action),action])).values()];
   }};
    if(this.foodEvidence?.observing)eating=stepWorldWithFoodEvidence(w,advance,options);
    else stepWorld(w,advance,options);
   }
   w.metrics.inFlight=this.unresolvedRequestIds();
  },()=>{if(eating)this.foodEvidence?.committed(eating,this.world.revision);});
  if(this.acceptance&&(!this.acceptanceReady()||!this.acceptance.committed(this.world)))return;
  this.schedule();
 }
 private schedule(){
  if(!this.acceptanceReady())return;
  if(!this.acceptanceAdmissionReady())return;
  if(!this.stopped)this.observeDecisionWaiters();
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
   if(!this.acceptanceReady()||this.inFlight.size>=this.modelSlots)break;
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
 private saveUsage(w:World,provider:Provider){
  if(this.selfHostedSafety){const records=w.metrics.selfHostedCooldowns??={};if(provider.limitCount)records[provider.model]={observedAt:provider.rateLimitedAt,blockedUntil:provider.blockedUntil,limitCount:provider.limitCount};else delete records[provider.model];}
  if(provider.budget)(w.metrics.usageWindow??={})[provider.model]=provider.budget.snapshot();}
 private priority(p:Resident,now:number){
  const local=p.residency!=='outside',bodyDecision=local||regionalDecisionWait(this.world,p);
  const fast=this.fastClock,rate=this.world.clock.realMinutesPerDay;
  const missedOpportunity=bodyDecision&&this.world.minute-p.decisionDue>=(fast?gameMinutesFromWall(120_000,rate):45);
  const imminentPromise=local&&worldDeadline(this.world,p.id)-this.world.minute<=(fast?gameMinutesFromWall(60_000,rate):15);
  const childPressure=local?observedChildPressure(this.world,p):0;
  const urgent=bodyDecision&&(p.hunger>80||p.energy<10||p.health<50||childPressure>0);
  const critical=fast&&bodyDecision&&(p.health<=20||observedChildPressure(this.world,p,true)>0);
  const deadlinePriority=critical?2000:missedOpportunity||imminentPromise||urgent?1000:0;
  return deadlinePriority+childPressure+p.hunger+(100-p.energy)*.5+(100-p.health)*2
   +(now-(this.waitingSince.get(p.id)??now))/1000+this.tie(p.id);
 }
 private tie(id:string){let n=this.world.seed;for(const c of id)n=((n*31)^c.charCodeAt(0))>>>0;return n%1000/1000;}
 private async decide(actorId:string,provider:Provider){
  try{await this.decideOnce(actorId,provider);}catch(error){if(!this.acceptance)throw error;this.acceptance.stop('runtime_failed');}
 }
 private async decideOnce(actorId:string,provider:Provider){
  if(!this.acceptanceReady())return;
  const generation=this.generation;
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
   this.commit(w=>{w.metrics.lastError=reason;});
   this.decisionEvidence?.preparationFailed(actorId,provider.model,reason,this.world.minute);
   this.decisionEvidence?.retry(actorId,30_000,null,this.world.minute);this.acceptanceReady();return;
  }
  if(!this.acceptanceReady()||!this.acceptanceAdmissionReady())return;
  const started=Date.now();
  const limits=modelLimits[provider.model];
  const charge=provider.budget?.reserve(started,prepared.inputBytes+512,limits.answerTokens+limits.thinkingTokens);
  if(provider.budget&&!charge){provider.admitAfter=started+1000;this.decisionEvidence?.deferred(actorId,provider.model,this.world.minute);return;}
  const acceptanceRequest=this.acceptance?.reserve(provider.model,this.world.minute);
  if(this.acceptance&&!acceptanceRequest)return;
  const requestToken={generation,controller:new AbortController(),terminalCommitted:false};
  this.requestTokens.set(actorId,requestToken);
  const live=()=>!this.stopped&&this.generation===generation&&this.requestTokens.get(actorId)===requestToken;
  let evidenceRequest:ReturnType<DecisionWaitEvidence['requestStarted']>=null;
  let requestNumber:number|null=null;
  let modelInvoked=false;
  const admissionReady=()=>{
   if(this.acceptanceAdmissionReady())return true;
   // Only an explicit clean admission rejection qualifies. Stops, thrown
   // admission, price failure and stale generations must never be relabelled.
   if(requestNumber!==null&&!modelInvoked&&live()&&this.acceptanceDraining&&this.decisionAdmissionCancelled){
    const budgetCancellation=charge?provider.budget!.prepareUnsentCancellation(charge):undefined;
    let cancelled!:DecisionAdmissionCancelledEvent;
    const atMs=Date.now(),monotonicNs=process.hrtime.bigint().toString();
    this.commit(w=>{
     const prior=w.metrics.admissionCancellation?.count??0;
     if(!Number.isSafeInteger(prior)||prior<0||!Number.isSafeInteger(prior+1)
      ||!Number.isSafeInteger(this.admissionBaseline.requests)||this.admissionBaseline.requests<0
      ||!Number.isSafeInteger(this.admissionBaseline.cancellations)||this.admissionBaseline.cancellations<0)throw new Error('admission_cancel_receipt_invalid');
     cancelled={actorId,model:provider.model,requestNumber:requestNumber!,revision:this.world.revision+1,atMs,monotonicNs,
      count:prior+1,baselineRequests:this.admissionBaseline.requests,baselineCancellations:this.admissionBaseline.cancellations,
      previousReceiptHash:w.metrics.admissionCancellation?createHash('sha256').update(JSON.stringify(w.metrics.admissionCancellation)).digest('hex'):null};
     w.metrics.admissionCancellation={...cancelled};
     // The local start persisted this estimate, but the model was never called.
     // Bind its removal to the same durable world as the cancellation receipt.
     if(budgetCancellation)(w.metrics.usageWindow??={})[provider.model]=budgetCancellation.snapshot;
    },()=>budgetCancellation?.committed());
    if(!live())return false;
    const returned=this.decisionAdmissionCancelled(Object.freeze({...cancelled}));
    if(returned&&typeof (returned as {then?:unknown}).then==='function'){
     void Promise.resolve(returned).catch(()=>{});throw new Error('admission_cancel_observer_must_be_synchronous');
    }
   }
   return false;
  };
  const evidenceTrigger=this.fallbackPending.has(actorId)?'fallback_pending':provider!==this.providers[0]&&started<this.providers[0].blockedUntil?'primary_blocked':'normal';
  this.fallbackPending.delete(actorId);
  this.inFlight.set(actorId,provider);
  if(!foreign&&!traveller)this.pendingChoices.set(actorId,prepared.choices.map(choice=>choice.action));
  try{
  this.commit(w=>{requestNumber=++w.metrics.requests;w.metrics.lastAttemptModel=provider.model;w.metrics.inFlight=this.unresolvedRequestIds();this.saveUsage(w,provider);});
  evidenceRequest=this.decisionEvidence?.requestStarted(actorId,provider.model,provider===this.providers[0]?'primary':'backup',evidenceTrigger,this.world.minute)??null;
   if(!live()||!this.acceptanceReady()||!admissionReady()||this.acceptance&&!this.acceptance.dispatch(acceptanceRequest!,this.world.minute))return;
   // dispatch() assesses price through trusted synchronous user code. It can
   // request drain while this slot is already reserved, so check once more
   // before invoking the model. A control reservation is not a transport call.
   if(!live()||!admissionReady())return;
   const signal=acceptanceRequest?AbortSignal.any([requestToken.controller.signal,acceptanceRequest.signal]):requestToken.controller.signal;
   modelInvoked=true;
   const result=await this.model(provider.key,context,feedback,provider.model,prepared,{signal});
   if(!live())return;
   if(this.acceptance&&!this.acceptance.settle(acceptanceRequest!,this.world.minute,result.acceptanceCostUsd))return;
   if(!this.acceptanceReady())return;
   this.decisionEvidence?.requestFinished(evidenceRequest,'reply',null,this.world.minute);
   if(!live()||!this.acceptanceReady())return;
   if(charge)provider.budget!.finish(charge,Date.now(),result);
   this.replyFeedback.delete(actorId);
   if(started>=provider.blockedUntil){
    provider.limitCount=0;
    provider.transientFailures=0;
    if(provider.slots<provider.maxSlots && ++provider.successesSinceLimit>=8){provider.slots++;provider.successesSinceLimit=0;}
   }
   let rejection:'actor_changed'|'plan_invalid'|'regional_changed'|'foreign_changed'|null=null;
   this.commit(w=>{
    // Clear only this response, together with its result and usage. Other
    // requests and their conservative reservations remain unresolved.
    w.metrics.inFlight=w.metrics.inFlight.filter(id=>id!==actorId);
    const current=w.residents.find(p=>p.id===actorId);
    this.saveUsage(w,provider);w.metrics.model=provider.model;w.metrics.lastLatencyMs=result.latencyMs;w.metrics.inputTokens+=result.inputTokens;w.metrics.outputTokens+=result.outputTokens;
    if(foreign){
     const accepted=applyForeignDecision(w,actorId,revision,result.decision);
     if(!accepted.ok){rejection='foreign_changed';w.metrics.failures++;w.metrics.lastError=accepted.error??'外贸条件已变化';this.retryAt.set(actorId,Date.now()+5000);return;}
     w.metrics.successes++;this.failures.delete(actorId);this.retryAt.delete(actorId);w.metrics.lastError=this.failures.values().next().value??null;
     return;
    }
    if(traveller){
     const regional=w.migration?.contacts.some(c=>c.id===actorId&&(c.phase==='carryingMail'||!!c.journey?.staged));
     const accepted=applyOutsideDecision(w,actorId,revision,result.decision);
     if(!accepted.ok){rejection='regional_changed';w.metrics.failures++;w.metrics.lastError=accepted.error??'旅途消息已变化';this.retryAt.set(actorId,Date.now()+5000);return;}
     if(regional){this.lastResidentDecision=Date.now();w.metrics.regionalDecisions=(w.metrics.regionalDecisions??0)+1;}
     w.metrics.successes++;this.failures.delete(actorId);this.retryAt.delete(actorId);w.metrics.lastError=this.failures.values().next().value??null;
     return;
    }
    if(!current||current.status!=='alive'||current.revision!==revision){rejection='actor_changed';w.metrics.failures++;w.metrics.lastError='过期的居民计划已丢弃';return;}
    const plan:Plan={id:`${w.id}:plan:${actorId}:${revision}:${started}`,actorId,actorRevision:revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine']??'action/routine@1',intention:result.decision.intention,actions:result.decision.actions};
    const startError=planStartError(w,plan);
    const accepted=startError?{ok:false,error:startError}:submitPlan(w,plan);
    if(!accepted.ok){rejection='plan_invalid';w.metrics.failures++;current.lastFailure=accepted.error??'计划不再适用';w.metrics.lastError='居民计划需要重新安排';this.failures.set(actorId,w.metrics.lastError);this.retryAt.set(actorId,Date.now()+5000);return;}
    current.lastDecisionAt=w.minute;this.lastResidentDecision=Date.now();w.metrics.successes++;w.metrics.localDecisions=(w.metrics.localDecisions??0)+1;this.failures.delete(actorId);w.metrics.lastError=this.failures.values().next().value??null;this.retryAt.delete(actorId);
   },()=>{
    requestToken.terminalCommitted=true;
    const observed=this.decisionCommitted?.(Object.freeze({result,actorId,accepted:rejection===null,rejection,revision:this.world.revision}));
    if(observed&&typeof (observed as {then?:unknown}).then==='function'){
     void Promise.resolve(observed).catch(()=>{});throw new Error('decision_commit_observer_must_be_synchronous');
    }
   });
   if(rejection){
    this.decisionEvidence?.rejected(actorId,evidenceRequest,rejection,this.world.minute);
    if(rejection!=='actor_changed')this.decisionEvidence?.retry(actorId,5000,null,this.world.minute);
   }else this.decisionEvidence?.accepted(actorId,this.world.minute,evidenceRequest);
  }catch(error){
   if(!live())return;
   if(this.acceptance){this.acceptance.settle(acceptanceRequest!,this.world.minute,undefined);if(this.acceptanceReady())this.acceptance.stop('runtime_failed');return;}
   // A post-commit observer error is not a second model outcome. Keep the
   // original error visible without finishing/recounting the response again.
   if(requestToken.terminalCommitted)throw error;
   if(charge)provider.budget!.finish(charge,Date.now(),error instanceof DecisionError?error.stats:undefined);
   const code=error instanceof Error?error.message:'model_failed';
   const safe=/^(model_http_\d{3}|model_incomplete|model_stream_error|model_context_limit|invalid_decision|unsupported_action|invalid_action)$/.test(code)?code:'model_timeout_or_invalid_response';
   this.decisionEvidence?.requestFinished(evidenceRequest,error instanceof Error&&error.name==='TimeoutError'?'timeout':'failed',safe,this.world.minute);
   if(this.selfHostedSafety&&safe!=='model_http_429'){this.stop();this.commit(w=>{w.metrics.lastError=safe;w.clock.reason='模型请求未核实，世界已停表';});return;}
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
     provider.rateLimitedAt=Date.now();
     provider.blockedUntil=provider.rateLimitedAt+cooldownDelay(provider.limitCount);
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
   this.commit(w=>{
    this.saveUsage(w,provider);w.metrics.failures++;w.metrics.lastError=safe;
    if(error instanceof DecisionError){w.metrics.inputTokens+=error.stats.inputTokens;w.metrics.outputTokens+=error.stats.outputTokens;w.metrics.lastLatencyMs=error.stats.latencyMs;}
    else{w.metrics.unmeteredFailures=(w.metrics.unmeteredFailures??0)+1;}
    // A missing usage report remains explicitly unknown and keeps its budget;
    // only the already-accounted local wait ends. Unsent cancellation is separate.
    if(modelInvoked)w.metrics.inFlight=w.metrics.inFlight.filter(id=>id!==actorId);
   },()=>{if(modelInvoked)requestToken.terminalCommitted=true;});
   this.decisionEvidence?.retry(actorId,retryDelay,this.fallbackPending.has(actorId)?backup?.model??null:null,this.world.minute);
  }finally{
   if(this.requestTokens.get(actorId)===requestToken){
    this.requestTokens.delete(actorId);this.inFlight.delete(actorId);this.pendingChoices.delete(actorId);
    if(this.acceptanceDraining)this.finishAcceptanceDrain();
    else if(!this.stopped&&this.generation===generation)this.schedule();
   }
  }
 }
}
