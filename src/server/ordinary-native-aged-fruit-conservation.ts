import type {World,Vec} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import type {MvpFruitFlowBatch} from '../world/mvp-resources.js';

/** Arithmetic and exact-world checks for an already observed fruit source.
 * Neither this basis nor the result is authority to run the engine or write
 * a save. The owning archive must supply a previously verified native batch. */
export type NativeAgedFruitSourceBasis=Readonly<{sourceId:string;sourceAt:Readonly<Vec>;placementClosingQuantity:number}>;
export type NativeAgedFruitSourceFlow=Readonly<{
 observedMinutes:number;grossNaturalRenewal:number;grossOrdinaryGather:number;closingQuantity:number;
}>;
type Prior=Readonly<{sequence:number;sourceFlow?:NativeAgedFruitSourceFlow|null}>;
const natural=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sameSource=(row:{sourceAt:Readonly<Vec>}|undefined,b:NativeAgedFruitSourceBasis)=>
 !!row&&row.sourceAt.x===b.sourceAt.x&&row.sourceAt.y===b.sourceAt.y;

export function verifyNativeAgedFruitSourceFlow(w:World,basis:NativeAgedFruitSourceBasis,prior:Prior|null):NativeAgedFruitSourceFlow|null{
 const physical=w.resources.filter(r=>r.id===basis.sourceId);
 const x=prior?prior.sourceFlow:{observedMinutes:0,grossNaturalRenewal:0,grossOrdinaryGather:0,closingQuantity:basis.placementClosingQuantity};
 if(!x||!exact(x,['observedMinutes','grossNaturalRenewal','grossOrdinaryGather','closingQuantity'])||
  !Object.values(x).every(natural)||!natural(basis.placementClosingQuantity)||x.observedMinutes!==(prior?.sequence??0)||
  BigInt(basis.placementClosingQuantity)+BigInt(x.grossNaturalRenewal)-BigInt(x.grossOrdinaryGather)!==BigInt(x.closingQuantity)||
  physical.length!==1||physical[0].kind!=='bush'||physical[0].foodItem!=='fruit'||
  !sameSource({sourceAt:physical[0].at},basis)||physical[0].amount!==x.closingQuantity)return null;
 return x;
}

/** Keep simultaneous ordinary gather and natural recovery separate even when
 * their net change is zero. A historic coverage gap is never backfilled from
 * the stock level at a later head. */
export function deriveNativeAgedFruitSourceMinute(w:World,draft:World,basis:NativeAgedFruitSourceBasis,prior:Prior|null,flow:MvpFruitFlowBatch|null):NativeAgedFruitSourceFlow|null{
 const old=verifyNativeAgedFruitSourceFlow(w,basis,prior);
 if(!old||!flow||flow.version!==1||draft.minute!==w.minute+1||draft.revision<=w.revision||flow.worldId!==w.id||draft.id!==w.id||flow.fromRevision!==w.revision||flow.toRevision!==draft.revision||
  flow.fromUs!==minuteToClimateUs(w.minute)||flow.toUs!==minuteToClimateUs(draft.minute))return null;
 const opening=flow.opening.filter(r=>r.sourceId===basis.sourceId),closing=flow.closing.filter(r=>r.sourceId===basis.sourceId);
 const open=opening[0],close=closing[0];
 if(opening.length!==1||closing.length!==1||!sameSource(open,basis)||!sameSource(close,basis)||open.amount!==old.closingQuantity)return null;
 let grossNaturalRenewal=old.grossNaturalRenewal,grossOrdinaryGather=old.grossOrdinaryGather;
 for(const op of flow.operations){
  if(op.kind==='gather'&&op.sourceId===basis.sourceId)grossOrdinaryGather+=op.quantity;
  if(op.kind==='renewal'&&op.witness.sourceId===basis.sourceId)grossNaturalRenewal+=op.witness.naturallyRenewed;
 }
 const sequence=(prior?.sequence??0)+1;
 const sourceFlow={observedMinutes:sequence,grossNaturalRenewal,grossOrdinaryGather,closingQuantity:close.amount};
 return verifyNativeAgedFruitSourceFlow(draft,basis,{sequence,sourceFlow});
}
