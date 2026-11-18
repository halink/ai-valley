import {agriculturePrefix} from './mvp-agriculture-solver.js';
import {agricultureInput,publishAgricultureGrowth,validateMvpAgriculture,agriculturePlot} from './mvp-agriculture.js';
import type {Activity,World} from '../shared/types.js';
import type {MvpSoilObservation,SoilAmounts,SoilPlot,SoilRates} from '../shared/mvp-soil.js';
import {climateAtUs,climateThermalCuts,minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {SOIL_DENOMINATOR as D,SOIL_GRID_US as GRID,SOIL_KEYS,soilPrefix} from './mvp-soil-solver.js';
export {SOIL_DENOMINATOR,SOIL_GRID_US} from './mvp-soil-solver.js';
export const SOIL_PARAMETERS='mvp-soil-v1;D=1440000000000000;grid=50000us;left-sample+thermal-component-cuts;micro-order=snow,melt,rain,evap,drain;rain=120*P*L;snow=120*P*(1000-L);L=clamp(50*Tdeci,0,1000);melt=120000*clamp(Tdeci,0,300);evap=6*(1000-RH)*(1000+wind);initial=50;cap=100;irrigation=30;cropUse=0';
export const SOIL_PARAMETER_FINGERPRINT='a9460161303985cff054b329b58b1bcde9565a1394f1e2d9d80db921bb846f9e';
const owns=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:unknown,names:readonly string[])=>obj(v)&&Object.keys(v).length===names.length&&names.every(k=>owns(v,k));
function integer(v:unknown):bigint {if(typeof v!=='string'||v.length>40||!/^(0|[1-9][0-9]*)$/.test(v))throw Error('soil_invalid_integer');return BigInt(v);}
function seq(v:unknown):bigint {const n=integer(v);if(n<1n||n>1000000000000000000n)throw Error('soil_invalid_sequence');return n;}
const grid=(us:bigint)=>us/GRID*GRID;
const rateCache=new Map<string,SoilRates>();
export function soilRatesAt(seed:number,gridUs:string):SoilRates {
 const key=seed+':'+gridUs,cached=rateCache.get(key);if(cached)return {...cached};
 parseClimateUs(gridUs);
 const c=climateAtUs(seed,gridUs),p=BigInt(c.precipitationPermille),liquid=BigInt(Math.max(0,Math.min(1000,50*c.temperatureDeciC)));
 const result={rain:(120n*p*liquid).toString(),snow:(120n*p*(1000n-liquid)).toString(),melt:(120000n*BigInt(Math.max(0,Math.min(300,c.temperatureDeciC)))).toString(),evaporation:(6n*BigInt(1000-c.relativeHumidityPermille)*BigInt(1000+c.windPermille)).toString()};
 if(rateCache.size>=512)rateCache.delete(rateCache.keys().next().value!);rateCache.set(key,Object.freeze(result));return {...result};
}
function initial():SoilAmounts {return {water:(50n*D).toString(),snow:'0',initial:(50n*D).toString(),rainIn:'0',snowIn:'0',melt:'0',irrigation:'0',evaporation:'0',drainage:'0'};}
function checkAmounts(a:SoilAmounts,agriculture=false):void {
 if(!keys(a,agriculture?[...SOIL_KEYS,'cropUse']:SOIL_KEYS))throw Error('soil_invalid_amounts');
 const n=Object.fromEntries(SOIL_KEYS.map(k=>[k,integer(a[k])])) as Record<typeof SOIL_KEYS[number],bigint>;
 if(n.initial!==50n*D||n.water>100n*D||n.snowIn-n.melt!==n.snow||n.initial+n.rainIn+n.melt+n.irrigation-n.evaporation-n.drainage-(agriculture?integer(a.cropUse):0n)!==n.water)throw Error('soil_balance_mismatch');
}
function cell(seed:number,at:bigint):{gridUs:string;sampleUs:string;cellEndUs:string} {
 const g=grid(at),end=g+GRID;
 // At the maximum allowed endpoint an empty terminal segment needs no future cell.
 if(at===10000000000000000n)return {gridUs:g.toString(),sampleUs:g.toString(),cellEndUs:g.toString()};
 const cuts=climateThermalCuts(seed,g.toString()).map(BigInt);let sample=g,next=end;
 for(const cut of cuts){if(cut<=at)sample=cut;else{next=cut;break;}}
 return {gridUs:g.toString(),sampleUs:sample.toString(),cellEndUs:next.toString()};
}
function newSegment(w:World,p:SoilPlot,at:bigint):void {const c=cell(w.seed,at);p.segment={startUs:at.toString(),endUs:at.toString(),...c,start:{...p.current},rates:soilRatesAt(w.seed,c.sampleUs),...(w.mvpSoil?.schemaVersion===2?{crop:agricultureInput(w,p.plotId,c.sampleUs)}:{})};}
export function resetSoilSegment(w:World,plotId:string):void {if(!w.mvpSoil)return;const p=w.mvpSoil.plots.find(p=>p.plotId===plotId);if(!p)throw Error('soil_missing_plot');newSegment(w,p,parseClimateUs(w.mvpSoil.lastUs));}
export function upgradeSoilForAgriculture(w:World):void {const s=w.mvpSoil;if(!s||s.schemaVersion!==1)throw Error('soil_invalid_agriculture_upgrade');s.schemaVersion=2;s.integratorVersion=2;for(const p of s.plots){p.current={...p.current,cropUse:'0'};newSegment(w,p,parseClimateUs(s.lastUs));}}
function executionNumber(id:unknown):bigint {if(typeof id!=='string'||!/^soil-water:[1-9][0-9]{0,17}$/.test(id))throw Error('soil_invalid_execution_id');return seq(id.slice(11));}
/** Both directions of the persisted dependency are mandatory, including absence. */
export function validateMvpSoil(w:World,minute=w.minute):void {
 const has=owns(w,'mvpSoil'),climate=w.mvpClimate;
 if(!has){if(climate?.schemaVersion===2||climate?.schemaVersion===3||climate?.capability==='soil-water-v1')throw Error('soil_missing_dependency');return;}
 if(!climate||!((climate.schemaVersion===2&&climate.capability==='soil-water-v1')||(climate.schemaVersion===3&&climate.capability==='agriculture-v1')))throw Error('soil_missing_climate');
 const s=w.mvpSoil!;
 if(!keys(s,['schemaVersion','integratorVersion','parameterFingerprint','denominator','adoptedMinute','adoptedUs','lastUs','nextWaterExecutionSeq','plots','waterReceipts'])||!((s.schemaVersion===1&&s.integratorVersion===1&&climate.schemaVersion===2)||(s.schemaVersion===2&&s.integratorVersion===2&&climate.schemaVersion===3))||s.parameterFingerprint!==SOIL_PARAMETER_FINGERPRINT||s.denominator!==D.toString())throw Error('soil_unsupported_state');
 const last=parseClimateUs(s.lastUs),adopted=parseClimateUs(s.adoptedUs),next=seq(s.nextWaterExecutionSeq);
 if(minuteToClimateUs(s.adoptedMinute)!==s.adoptedUs||s.lastUs!==minuteToClimateUs(minute)||adopted>last||adopted<parseClimateUs(climate.adoptedUs)||s.adoptedMinute<climate.adoptedMinute||s.adoptedMinute>minute||!Array.isArray(s.plots)||!Array.isArray(w.plots)||s.plots.length!==w.plots.length||!obj(s.waterReceipts))throw Error('soil_invalid_clock_or_plots');
 const ids=new Set<string>();const rates=new Map<string,SoilRates>();
 for(const p of s.plots){
  if(!keys(p,['plotId','segment','current'])||typeof p.plotId!=='string'||ids.has(p.plotId)||!w.plots.some(plot=>plot.id===p.plotId)||!keys(p.segment,['startUs','endUs','gridUs','sampleUs','cellEndUs','start','rates',...(s.schemaVersion===2?['crop']:[])]))throw Error('soil_invalid_plot');ids.add(p.plotId);
  const g=parseClimateUs(p.segment.gridUs),start=parseClimateUs(p.segment.startUs),end=parseClimateUs(p.segment.endUs);
  const c=cell(w.seed,start);
  if(g!==grid(start)||start<adopted||start>end||end!==last||(end>=parseClimateUs(c.cellEndUs)&&!(start===10000000000000000n&&end===start&&parseClimateUs(c.cellEndUs)===start))||p.segment.sampleUs!==c.sampleUs||p.segment.cellEndUs!==c.cellEndUs)throw Error('soil_invalid_segment');
  checkAmounts(p.segment.start,s.schemaVersion===2);checkAmounts(p.current,s.schemaVersion===2);
  let rate=rates.get(p.segment.sampleUs);if(!rate){rate=soilRatesAt(w.seed,p.segment.sampleUs);rates.set(p.segment.sampleUs,rate);}
  if(!keys(p.segment.rates,['rain','snow','melt','evaporation'])||Object.keys(rate).some(k=>p.segment.rates[k as keyof SoilRates]!==rate![k as keyof SoilRates]))throw Error('soil_rate_mismatch');
  const coupled=s.schemaVersion===2?agriculturePrefix(p.segment.start as SoilAmounts&{cropUse:string},rate,end-start,p.segment.crop??null):null;
  const computed=coupled?.amounts??soilPrefix(p.segment.start,rate,end-start);
  if(s.schemaVersion===2){const input=agricultureInput(w,p.plotId,p.segment.sampleUs),saved=p.segment.crop;
   if(!!input!==!!saved||input&&saved&&(input.instanceId!==saved.instanceId||input.temperatureFactor!==saved.temperatureFactor||input.target!==saved.target||coupled!.progress!==input.progress)||computed.cropUse!==p.current.cropUse)throw Error('soil_crop_prefix_mismatch');
  }
  if(SOIL_KEYS.some(k=>computed[k]!==p.current[k]))throw Error('soil_prefix_mismatch');
 }
 for(const event of w.events)if(event.soilWater){const receipt=s.waterReceipts[event.soilWater.executionId];if(!receipt||receipt.eventId!==event.id)throw Error('soil_orphan_water_event');}
 const active=new Set<string>();
 for(const r of w.residents){const a=r.activity;if(!a)continue;if(a.action.type!=='water'){if(a.mvpWaterExecutionId!==undefined)throw Error('soil_unexpected_execution_id');continue;}
  const id=a.mvpWaterExecutionId;if(executionNumber(id)>=next||active.has(id!)||owns(s.waterReceipts,id!))throw Error('soil_invalid_active_execution');active.add(id!);
 }
 const totals=new Map<string,bigint>(),eventIndex=new Map(w.events.map(event=>[event.id,event]));
 if(eventIndex.size!==w.events.length)throw Error('soil_duplicate_event_id');
 for(const [id,receipt]of Object.entries(s.waterReceipts)){
  if(executionNumber(id)>=next||!keys(receipt,['executionId','actorId','plotId','atUs','eventId'])||receipt.executionId!==id||typeof receipt.actorId!=='string'||!w.residents.some(r=>r.id===receipt.actorId)||!ids.has(receipt.plotId)||typeof receipt.eventId!=='string'||!receipt.eventId.startsWith(w.id+':event:')||parseClimateUs(receipt.atUs)<adopted||parseClimateUs(receipt.atUs)>last)throw Error('soil_invalid_receipt');
  const event=eventIndex.get(receipt.eventId),suffix=receipt.eventId.slice((w.id+':event:').length);
  if(!/^[1-9][0-9]*$/.test(suffix)||BigInt(suffix)>BigInt(w.revision)||!event||event.kind!=='action'||event.actors.length!==1||event.actors[0]!==receipt.actorId||minuteToClimateUs(event.at)!==receipt.atUs||!keys(event.soilWater,['executionId','plotId','actorId','amount'])||event.soilWater?.executionId!==id||event.soilWater.plotId!==receipt.plotId||event.soilWater.actorId!==receipt.actorId||event.soilWater.amount!=='30')throw Error('soil_receipt_event_mismatch');
  totals.set(receipt.plotId,(totals.get(receipt.plotId)??0n)+30n*D);
 }
 for(const p of s.plots)if(integer(p.current.irrigation)!==(totals.get(p.plotId)??0n))throw Error('soil_irrigation_receipt_mismatch');
 validateMvpAgriculture(w);
}
export function allocateSoilWaterExecution(w:World,a:Activity):void {
 if(!w.mvpSoil||a.action.type!=='water')return;
 if(a.mvpWaterExecutionId!==undefined)throw Error('soil_execution_already_assigned');
 const n=seq(w.mvpSoil.nextWaterExecutionSeq);if(n>=1000000000000000000n)throw Error('soil_sequence_exhausted');
 a.mvpWaterExecutionId='soil-water:'+n;w.mvpSoil.nextWaterExecutionSeq=(n+1n).toString();
}
export function adoptMvpSoil(w:World):boolean {
 if(owns(w,'simulationOnly'))throw Error('soil_simulation_adoption');
 if(owns(w,'mvpSoil')||w.mvpClimate?.schemaVersion===2||w.mvpClimate?.schemaVersion===3){validateMvpSoil(w);return false;}
 if(w.mvpClimate?.schemaVersion!==1||w.mvpClimate.capability!=='observation-only')throw Error('soil_adoption_requires_climate');
 const at=minuteToClimateUs(w.minute);
 // Migration begins at the actual adoption time, not its absolute grid's left edge.
 const plots=w.plots.map(plot=>{const p={plotId:plot.id,current:initial()} as SoilPlot;newSegment(w,p,BigInt(at));return p;});
 w.mvpSoil={schemaVersion:1,integratorVersion:1,parameterFingerprint:SOIL_PARAMETER_FINGERPRINT,denominator:D.toString(),adoptedMinute:w.minute,adoptedUs:at,lastUs:at,nextWaterExecutionSeq:'1',plots,waterReceipts:{}};
 const {observationOnly,...sample}=w.mvpClimate.current as import('../shared/mvp-climate.js').MvpClimatePoint&{observationOnly?:true};
 w.mvpClimate={...w.mvpClimate,schemaVersion:2,capability:'soil-water-v1',current:{...sample,schemaVersion:2,soilWater:true}};
 for(const r of w.residents)if(r.activity?.action.type==='water')allocateSoilWaterExecution(w,r.activity);
 validateMvpSoil(w);return true;
}
/** Called after old-state validation and before any event at the new endpoint. */
export function advanceMvpSoil(w:World,fromMinute:number):void {
 if(!w.mvpSoil)return;
 const s=w.mvpSoil,target=parseClimateUs(minuteToClimateUs(w.minute));
 if(s.lastUs!==minuteToClimateUs(fromMinute)||target<parseClimateUs(s.lastUs))throw Error('soil_clock_reversal');
 // Advance the shared weather-cell clock once, then all plots. Long directed
 // runs never recompute a year's weather separately for each of the eight plots.
 let at=parseClimateUs(s.lastUs);
 while(at<target){
  const c=cell(w.seed,at),boundary=parseClimateUs(c.cellEndUs),end=target<boundary?target:boundary;
  const next=end===boundary?cell(w.seed,end):null,rate=next?soilRatesAt(w.seed,next.sampleUs):null;
  for(const p of s.plots){
   if(s.schemaVersion===2){const result=agriculturePrefix(p.segment.start as SoilAmounts&{cropUse:string},p.segment.rates,end-parseClimateUs(p.segment.startUs),p.segment.crop??null);p.current=result.amounts;if(p.segment.crop&&result.progress!==null)publishAgricultureGrowth(w,p.plotId,result.progress,result.matureAtOffset===null?null:(parseClimateUs(p.segment.startUs)+BigInt(result.matureAtOffset)).toString());}
   else p.current=soilPrefix(p.segment.start,p.segment.rates,end-parseClimateUs(p.segment.startUs));p.segment.endUs=end.toString();
   if(next)p.segment={startUs:end.toString(),endUs:end.toString(),...next,start:{...p.current},rates:{...rate!},...(s.schemaVersion===2?{crop:agricultureInput(w,p.plotId,next.sampleUs)}:{})};
  }
  at=end;
 }
 s.lastUs=target.toString();
}
export function assertSoilWaterUnsettled(w:World,actorId:string,a:Activity,plotId:string):void {
 if(!w.mvpSoil)return;
 const id=a.mvpWaterExecutionId;
 if(executionNumber(id)>=seq(w.mvpSoil.nextWaterExecutionSeq)||owns(w.mvpSoil.waterReceipts,id!)||a.action.type!=='water'||a.action.plotId!==plotId||!w.residents.some(r=>r.id===actorId&&r.activity===a)||!w.mvpSoil.plots.some(p=>p.plotId===plotId)||w.mvpSoil.lastUs!==minuteToClimateUs(w.minute))throw Error('soil_water_settlement_invalid');
}
export function settleSoilWater(w:World,actorId:string,a:Activity,plotId:string,eventId:string):void {
 if(!w.mvpSoil)return;
 assertSoilWaterUnsettled(w,actorId,a,plotId);
 const s=w.mvpSoil,p=s.plots.find(p=>p.plotId===plotId)!,amount=integer(p.current.water)+30n*D,cap=100n*D;
 p.current={...p.current,water:(amount>cap?cap:amount).toString(),irrigation:(integer(p.current.irrigation)+30n*D).toString(),drainage:(integer(p.current.drainage)+(amount>cap?amount-cap:0n)).toString()};
 const id=a.mvpWaterExecutionId!;s.waterReceipts[id]={executionId:id,actorId,plotId,atUs:s.lastUs,eventId};newSegment(w,p,parseClimateUs(s.lastUs));
}
export function soilObservation(w:World):MvpSoilObservation|undefined {
 if(!w.mvpSoil)return;
 const display=(s:string)=>Number((integer(s)*1000n+D/2n)/D)/1000;
 return {schemaVersion:w.mvpSoil.schemaVersion,denominator:D.toString(),atUs:w.mvpSoil.lastUs,plots:w.mvpSoil.plots.map(p=>({plotId:p.plotId,paw:display(p.current.water),snowWater:display(p.current.snow),initialPaw:50,rainIn:display(p.current.rainIn),snowIn:display(p.current.snowIn),melt:display(p.current.melt),irrigation:display(p.current.irrigation),evaporation:display(p.current.evaporation),drainage:display(p.current.drainage),cropUse:display(p.current.cropUse??'0'),exact:{...p.current}}))};
}
