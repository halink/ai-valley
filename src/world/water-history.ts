import type {Resident,World} from '../shared/types.js';
import type {WaterSupplyAction} from '../shared/water-supply.js';
import type {WaterSupplyFact,WaterVesselSnapshot} from '../shared/water-history.js';

/** Read only the entities this action can affect, before its successful atomic completion. */
export function captureWaterSupplyFact(w:World,r:Resident,a:WaterSupplyAction){
 const state=w.waterSupply!;
 const gift='giftId'in a?state.gifts?.find(g=>g.id===a.giftId):undefined;
 const ids=[...new Set([...(a.operation==='craft'?[a.receiptId]:[]),...('vesselId'in a?[a.vesselId]:[]),...('publicVesselId'in a?[a.publicVesselId]:[]),...(gift?[gift.vesselId]:[])])];
 const snapshot=(id:string):WaterVesselSnapshot|null=>{const v=state.vessels.find(v=>v.id===id);return v?{ownerId:v.ownerId,buildingId:v.buildingId,capacity:v.capacity,amount:v.amount,quality:v.quality}:null;};
 const before=ids.map(id=>({id,before:snapshot(id)}));
 const item=a.operation==='craft'||a.operation==='boil'?'wood':a.operation==='load'||a.operation==='decant'?'water':undefined;
 const inventoryBefore=item?r.inventory[item]??0:0;
 const sourceId='sourceId'in a?a.sourceId:a.operation==='survey'?`surface:${a.at.x},${a.at.y}`:undefined;
 const sourceKind=a.operation==='fillSpring'?'spring' as const:'surface' as const;
 const amount=()=>sourceKind==='spring'?w.resources.find(s=>s.id===sourceId)?.amount??null:state.surfaceSources.find(s=>s.id===sourceId)?.amount??null;
 const sourceBefore=sourceId?amount():null;
 return (quantity:number,recipientId?:string,counterpartyId?:string):WaterSupplyFact=>({
  version:1,receiptId:a.receiptId,operation:a.operation,actorId:r.id,quantity,
  ...(recipientId?{recipientId}:{}),...(counterpartyId?{counterpartyId}:{}),
  vessels:before.map(v=>({...v,after:snapshot(v.id)})),
  inventory:item?[{personId:r.id,item,before:inventoryBefore,after:r.inventory[item]??0}]:[],
  ...(sourceId?{source:{id:sourceId,kind:sourceKind,before:sourceBefore,after:amount()}}:{}),
  ...('authorizationId'in a?{authorizationId:a.authorizationId}:a.operation==='authorizeAssist'?{authorizationId:a.receiptId}:{}),
  ...('giftId'in a?{giftId:a.giftId}:a.operation==='offerVessel'?{giftId:a.receiptId}:{}),
 });
}
