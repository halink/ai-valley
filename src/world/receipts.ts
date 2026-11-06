import type {World} from '../shared/types.js';

export interface ReceiptHistory {
 has(receipt:string):boolean;
 first(prefix:`${string}:`):string|undefined;
}

// Working worlds keep only pending writes. Standalone worlds still carry their own full journal.
const histories=new WeakMap<World,ReceiptHistory>();

export function attachReceiptHistory(world:World,history:ReceiptHistory):void {
 histories.set(world,history);
}

export function inheritReceiptHistory(source:World,draft:World):void {
 const history=histories.get(source);
 if(history)attachReceiptHistory(draft,history);
}

export function hasReceipt(world:World,receipt:string):boolean {
 return world.processed.includes(receipt)||(histories.get(world)?.has(receipt)??false);
}

export function firstReceipt(world:World,namespace:string):string|undefined {
 const prefix=`${namespace}:` as const;
 // Committed entries preceded pending entries in the original journal.
 return histories.get(world)?.first(prefix)??world.processed.find(receipt=>receipt.startsWith(prefix));
}
