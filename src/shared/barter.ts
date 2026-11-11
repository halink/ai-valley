import {itemLabels} from './items.js';
import type {Inventory,OfferTerms} from './types.js';

export function validBarterInventory(value:unknown):value is Inventory {
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0
  &&Object.entries(value).every(([key,n])=>Object.hasOwn(itemLabels,key)&&typeof n==='number'&&Number.isInteger(n)&&n>0&&n<=100);
}
export function barterTerms(offer:OfferTerms):OfferTerms {
 return {id:offer.id,actorId:offer.actorId,targetId:offer.targetId,give:structuredClone(offer.give),want:structuredClone(offer.want),expiresAt:offer.expiresAt,definition:offer.definition};
}
export function validBarterTerms(value:unknown):value is OfferTerms {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const terms=value as OfferTerms;
 return [terms.id,terms.actorId,terms.targetId,terms.definition].every(s=>typeof s==='string'&&s.length>0)
  &&terms.actorId!==terms.targetId&&Number.isFinite(terms.expiresAt)&&validBarterInventory(terms.give)&&validBarterInventory(terms.want);
}
function sameInventory(a:Inventory,b:Inventory):boolean {
 return validBarterInventory(a)&&validBarterInventory(b)&&Object.keys(a).length===Object.keys(b).length
  &&Object.entries(a).every(([key,n])=>b[key as keyof Inventory]===n);
}
/** Do not let an old yes authorize a changed party, price, lifetime or rule. */
export function sameBarterTerms(a:OfferTerms|undefined,b:OfferTerms):boolean {
 return validBarterTerms(a)&&validBarterTerms(b)&&a.id===b.id&&a.actorId===b.actorId&&a.targetId===b.targetId&&a.expiresAt===b.expiresAt
  &&a.definition===b.definition&&sameInventory(a.give,b.give)&&sameInventory(a.want,b.want);
}
