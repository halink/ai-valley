/** Pure seasonal reserve arithmetic. No forecasts, world reads or rule actions. */
export interface SeasonalSupplyEvent {
 id:string;minute:number;order:number;
 /** P is undiscounted physical supply; A already includes actual access/labour. */
 source:{kind:'P'|'A';evidence:string};
 /** One atomic net nutrition event, never an inventory delta or eating debit. */
 semantics:'atomic-net-supply';
 nutrition:number;
}
export interface SeasonalReserveInput {
 actorId:string;
 startMinute:number;endMinute:number;
 demand:{kind:'constant';baseDailyNutrition:number;evidence:string};
 coverage:{kind:'complete'|'observed-prefix'|'unknown';evidence:string;zeroSupplyConfirmed?:boolean};
 /** Actual observed first spring harvest within this window, not ideal growth days. */
 springHarvest?:{eventId:string;minute:number;evidence:string};
 events:SeasonalSupplyEvent[];
 /** Personally held edible nutrition after seed reserves, not projected supply. */
 onhand:{asOfMinute:number;nutrition:number;evidence:string};
}
export type SeasonalReserveResult = {
 actorId:string;status:'unknown';reason:string;guaranteesFuture:false;
}|{
 actorId:string;status:'complete';scope:'observed-complete-window';guaranteesFuture:false;
 requiredObserved:number;additionalObserved:number;peakDeficit:number;baseBuffer:number;
}|{
 actorId:string;status:'observed-prefix';scope:'conditional-observed-lower-bound';guaranteesFuture:false;
 conditionalLowerBound:number;conditionalAdditionalLowerBound:number;peakDeficit:number;baseBuffer:number;
};
const DAY=1440;
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const invalid=():never=>{throw Error('invalid_seasonal_reserve_input')};
/** Observed arithmetic only. Supply coverage must be certified by the caller;
 * this function cannot manufacture epistemic completeness from an event list. */
export function seasonalReserve(input:SeasonalReserveInput):SeasonalReserveResult {
 const v=input;
 if(!v||!text(v.actorId)||!finite(v.startMinute)||v.startMinute<0||!finite(v.endMinute)||v.endMinute<v.startMinute
  ||v.demand?.kind!=='constant'||!finite(v.demand.baseDailyNutrition)||v.demand.baseDailyNutrition<0||!text(v.demand.evidence)
  ||!v.coverage||!['complete','observed-prefix','unknown'].includes(v.coverage.kind)||!text(v.coverage.evidence)
  ||!v.onhand||v.onhand.asOfMinute!==v.startMinute||!finite(v.onhand.nutrition)||v.onhand.nutrition<0||!text(v.onhand.evidence)||!Array.isArray(v.events))invalid();
 if(v.coverage.zeroSupplyConfirmed!==undefined&&typeof v.coverage.zeroSupplyConfirmed!=='boolean')invalid();
 if(v.springHarvest&&(!text(v.springHarvest.eventId)||!finite(v.springHarvest.minute)||v.springHarvest.minute<v.startMinute||v.springHarvest.minute>v.endMinute||!text(v.springHarvest.evidence)))invalid();
 const ids=new Set<string>();let previousMinute=-Infinity,previousOrder=-1;
 for(const e of v.events){
  if(!e||!text(e.id)||ids.has(e.id)||!finite(e.minute)||e.minute<=v.startMinute||e.minute>v.endMinute
   ||!Number.isSafeInteger(e.order)||e.order<0||e.semantics!=='atomic-net-supply'||!finite(e.nutrition)
   ||!e.source||!['P','A'].includes(e.source.kind)||!text(e.source.evidence)
   ||e.minute<previousMinute||e.minute===previousMinute&&e.order<=previousOrder)invalid();
  // A physical quantity P cannot be a negative net cost. Seed/cooking net
  // debits must be actual available A, never discounted to erase real costs.
  if(e.source.kind==='P'&&e.nutrition<0)invalid();
  ids.add(e.id);previousMinute=e.minute;previousOrder=e.order;
 }
 if(v.coverage.zeroSupplyConfirmed&&v.events.length)invalid();
 if(v.springHarvest&&!v.events.some(e=>e.id===v.springHarvest!.eventId&&e.minute===v.springHarvest!.minute&&e.source.kind==='A'&&e.nutrition>0))invalid();
 const unknown=(reason:string):SeasonalReserveResult=>({actorId:v.actorId,status:'unknown',reason,guaranteesFuture:false});
 if(v.coverage.kind==='unknown')return unknown('supply-coverage-unknown');
 if(v.events.length===0&&v.coverage.zeroSupplyConfirmed!==true)return unknown('empty-list-is-not-zero-supply-evidence');
 if(v.coverage.kind==='complete'&&((v.endMinute-v.startMinute)<34*DAY||!v.springHarvest||v.springHarvest.minute>v.endMinute))return unknown('complete-window-needs-at-least-34-days-and-observed-spring-harvest-within-window');
 const rate=1.2*v.demand.baseDailyNutrition/DAY,baseBuffer=2*v.demand.baseDailyNutrition;
 let supply=0,peak=0;
 const deficit=(minute:number)=>rate*(minute-v.startMinute)-supply;
 for(const e of v.events){peak=Math.max(peak,deficit(e.minute));supply+=e.nutrition*(e.source.kind==='P'?.8:1);peak=Math.max(peak,deficit(e.minute));}
 peak=Math.max(peak,deficit(v.endMinute));const required=peak+baseBuffer,additional=Math.max(0,required-v.onhand.nutrition);
 if(![rate,baseBuffer,supply,peak,required,additional].every(Number.isFinite))invalid();
 return v.coverage.kind==='complete'
  ?{actorId:v.actorId,status:'complete',scope:'observed-complete-window',guaranteesFuture:false,requiredObserved:required,additionalObserved:additional,peakDeficit:peak,baseBuffer}
  :{actorId:v.actorId,status:'observed-prefix',scope:'conditional-observed-lower-bound',guaranteesFuture:false,conditionalLowerBound:required,conditionalAdditionalLowerBound:additional,peakDeficit:peak,baseBuffer};
}
