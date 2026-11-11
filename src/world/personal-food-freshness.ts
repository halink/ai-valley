import type {Resident,World} from '../shared/types.js';
import type {PersonalFoodFreshness,PersonalFoodFreshnessItem} from '../shared/personal-food-freshness.js';
import {goods,itemKeys} from '../shared/items.js';

const positive=(n:number|undefined)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:0;
function add(group:{quantity:number;nutrition:number|null},quantity:number,nutrition:number|null){
 group.quantity+=quantity;
 group.nutrition=group.nutrition===null||nutrition===null||!Number.isFinite(group.nutrition+nutrition)?null:group.nutrition+nutrition;
}
/** Read only the actor's carried ledger, never initialize missing batches. The
 * physical inventory bounds stale ledger quantities; no raw batch list escapes. */
export function personalFoodFreshness(w:World,r:Resident):PersonalFoodFreshness {
 const result:PersonalFoodFreshness={residentId:r.id,atMinute:w.minute,items:[]};
 if(w.mode!=='formal')return result;
 for(const item of itemKeys){
  const quantity=positive(r.inventory[item]);if(!quantity||goods[item].food<=0)continue;
  const row:PersonalFoodFreshnessItem={item,quantity,expiredQuantity:0,unknownQuantity:0,earliest:null,later:{quantity:0,nutrition:0}};
  let left=quantity;
  // Same withdrawal order as foodValue/take, without sorting the actual ledger.
  const lots=[...(w.food?.lots['person:'+r.id]?.[item]??[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt);
  for(const lot of lots){
   const q=Math.min(left,positive(lot.quantity));if(!q)continue;left-=q;
   if(!Number.isFinite(lot.expiresAt)||!Number.isFinite(lot.producedAt)||lot.producedAt>w.minute||lot.expiresAt<lot.producedAt){row.unknownQuantity+=q;continue;}
   if(lot.expiresAt<=w.minute){row.expiredQuantity+=q;continue;}
   const value=(w.definitions[lot.definition]?.data.nutrition as Record<string,number>|undefined)?.[item]??goods[item].food;
   const nutrition=typeof value==='number'&&value>=0&&Number.isFinite(value*q)?value*q:null;
   // Equal expiry times may contain several physical batches/definitions. Keep
   // their combined nutrition, not a made-up uniform per-portion value.
   // Invalid timestamps can make the engine's legacy comparator non-transitive.
   // Keep its stock clipping order, but find the true earliest valid time.
   if(row.earliest&&lot.expiresAt<row.earliest.expiresAt){add(row.later,row.earliest.quantity,row.earliest.nutrition);row.earliest=null;}
   if(!row.earliest)row.earliest={expiresAt:lot.expiresAt,quantity:0,nutrition:0};
   const group=lot.expiresAt===row.earliest.expiresAt?row.earliest:row.later;
   add(group,q,nutrition);
   if(left<=0)break;
  }
  row.unknownQuantity+=left;result.items.push(row);
 }
 return result;
}
