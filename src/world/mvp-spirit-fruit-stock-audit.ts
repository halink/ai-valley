import type {World} from '../shared/types.js';
import {canAccessMvpGroundFruitTile} from './mvp-ground-fruit.js';
import {advanceMvpResources,mvpResourceItem,validateMvpResources} from './mvp-resources.js';
import {projectMvpSpiritActiveGround} from './mvp-spirit-effects.js';

const MAX_WINDOW_MINUTES=1440; // audit work bound, not a policy or quota
const MAX_ROWS=4096;
const AUDIT_SCOPE='isolated-fixture-fruit-stock-audit' as const;
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

export interface MvpSpiritFruitStockAuditOptions {
 readonly scope:typeof AUDIT_SCOPE;
 /** Optional renewal-only rule projection; no actors, events or clock run. */
 readonly futureGameMinutes?:number;
}
interface SourceStock {readonly sourceId:string;readonly quantity:number;}
interface RenewalProjection {
 readonly kind:'detached-renewal-only';
 readonly elapsedGameMinutes:number;
 readonly sourceRuleGain:readonly {readonly sourceId:string;readonly quantity:number}[];
 readonly totalRuleGain:number;
 readonly equalsCommittedHistory:false;
 readonly identifiesValleySpiritCausalGain:false;
}
export type MvpSpiritFruitStockAudit =
 | {readonly status:'disabled'}
 | {readonly status:'unavailable'}
 | {readonly status:'measured';readonly scope:typeof AUDIT_SCOPE;readonly atGameMinute:number;readonly atRevision:number;
  readonly actualStock:{
   readonly source:readonly SourceStock[];
   readonly sourceFruit:number;
   readonly unpickedGroundFruit:number;
   /** Current tile legality only, not anyone's discovery or ability to get there. */
   readonly unpickedFruitOnLegalCommonTiles:number;
   readonly heldByLivingValleyResidents:number;
   readonly heldByOtherResidentRecords:number;
   /** Defined loci only, not all fruit in buildings, shipments or estate inventory. */
   readonly totalInMeasuredLoci:number;
  };
  readonly actualTransfers:{
   readonly fallSourceDebits:number;readonly fallGroundCredits:number;
   readonly pickupGroundDebits:number;readonly pickupResidentCredits:number;
  };
  readonly history:{
   readonly exactHistoricalNaturalGain:'not-recorded';
   readonly causalGainUnlockedByFalls:'not-identified';
  };
  readonly renewalProjection?:RenewalProjection;
 };

function inventoryCount(value:unknown):number {
 if(value===undefined)return 0;
 if(!natural(value))throw Error('non_integral_audit_stock');
 return value;
}
const count=(rows:readonly number[]):number=>{
 const total=rows.reduce((sum,quantity)=>sum+inventoryCount(quantity),0);
 if(!natural(total))throw Error('audit_stock_overflow');
 return total;
};
function sourceStock(w:World):SourceStock[]{
 const sources=w.resources.filter(r=>mvpResourceItem(w,r)==='fruit');
 if(sources.length>MAX_ROWS||new Set(sources.map(r=>r.id)).size!==sources.length)throw Error('ambiguous_audit_sources');
 return sources.map(r=>({sourceId:r.id,quantity:inventoryCount(r.amount)}))
  .sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
}

/** Private developer reader only; no store call and no runtime wiring.
 * Historical natural accumulation cannot be reconstructed from remaining
 * stock: actual gathering and ordinary renewal can change the same source
 * between heads, and only a current renewal clock/fraction is stored. */
export function auditMvpSpiritFruitStock(
 w:World,options?:MvpSpiritFruitStockAuditOptions,
):MvpSpiritFruitStockAudit {
 if(options?.scope!==AUDIT_SCOPE)return {status:'disabled'};
 try{
  if(!w||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||!natural(w.revision)||
   !w.mvpResources||w.mvpResources.lastMinute!==w.minute||w.residents.length>MAX_ROWS||w.resources.length>MAX_ROWS)return {status:'unavailable'};
  const n=options.futureGameMinutes;
  if(n!==undefined&&(!natural(n)||n<1||n>MAX_WINDOW_MINUTES))return {status:'unavailable'};
  validateMvpResources(w);
  const ground=projectMvpSpiritActiveGround(w),effects=w.mvpClimate?.spiritEffects;
  if(!ground||!effects)return {status:'unavailable'};
  const source=sourceStock(w);
  const sourceFruit=count(source.map(r=>r.quantity));
  const isInValley=(r:World['residents'][number])=>r.status==='alive'&&r.residency!=='outside'&&!r.regionalLocation;
  const heldByLivingValleyResidents=count(w.residents.filter(isInValley).map(r=>inventoryCount(r.inventory.fruit)));
  const heldByOtherResidentRecords=count(w.residents.filter(r=>!isInValley(r)).map(r=>inventoryCount(r.inventory.fruit)));
  const actualStock={source,sourceFruit,unpickedGroundFruit:ground.items.length,
   unpickedFruitOnLegalCommonTiles:ground.items.filter(lot=>canAccessMvpGroundFruitTile(w,lot.at)).length,
   heldByLivingValleyResidents,heldByOtherResidentRecords,
   totalInMeasuredLoci:count([sourceFruit,ground.items.length,heldByLivingValleyResidents,heldByOtherResidentRecords])};
  const pickups=w.mvpClimate?.spiritFruitSettlement?.pickups??[];
  const actualTransfers={
   fallSourceDebits:count(effects.applied.map(e=>e.receipt.debitRipeFruit)),
   fallGroundCredits:count(effects.applied.map(e=>e.receipt.creditGroundFruit)),
   pickupGroundDebits:count(pickups.map(p=>p.debitGroundFruit)),
   pickupResidentCredits:count(pickups.map(p=>p.creditResidentFruit)),
  };
  if(actualTransfers.fallGroundCredits-actualTransfers.pickupGroundDebits!==ground.items.length)return {status:'unavailable'};
  const base={status:'measured',scope:AUDIT_SCOPE,atGameMinute:w.minute,atRevision:w.revision,actualStock,actualTransfers,
   history:{exactHistoricalNaturalGain:'not-recorded',causalGainUnlockedByFalls:'not-identified'}} as const;
  if(n===undefined)return base;
  // Run the production renewal formula on a disposable copy, isolated from
  // normal actors or gathering. This is a rule projection, not a replay of an
  // actual future/historical world, nor an effect-level credit allocation.
  const copy=structuredClone(w);copy.minute+=n;
  if(!Number.isFinite(copy.minute)||copy.minute-w.minute!==n)return {status:'unavailable'};
  advanceMvpResources(copy);
  const after=sourceStock(copy);
  if(after.length!==source.length)return {status:'unavailable'};
  const sourceRuleGain=after.map((r,i)=>{
   if(r.sourceId!==source[i]?.sourceId)throw Error('audit_sources_changed');
   return {sourceId:r.sourceId,quantity:inventoryCount(r.quantity-source[i].quantity)};
  }).filter(r=>r.quantity>0);
  return {...base,renewalProjection:{kind:'detached-renewal-only',elapsedGameMinutes:n,sourceRuleGain,
   totalRuleGain:count(sourceRuleGain.map(r=>r.quantity)),equalsCommittedHistory:false,identifiesValleySpiritCausalGain:false}};
 }catch{return {status:'unavailable'};}
}
