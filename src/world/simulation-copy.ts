import type {World} from '../shared/types.js';
import {inheritReceiptHistory} from './receipts.js';

/** An independent speculative world, including its mutable terrain array.
 * Tile values are primitive strings, so slice is a complete copy of that
 * large array without structuredClone's per-value serialization overhead.
 * Everything else retains the ordinary deep-copy semantics. Receipt history
 * only exposes read operations; new receipts belong to the copied world.
 */
export function copyForSimulation(world:World):World{
 // Clone geography with the rest of the graph: e.g. a departing resident's
 // activity target can reference the same coordinate as map.entrance.
 const copy:World=structuredClone({...world,map:{...world.map,tiles:[]}});
 copy.map.tiles=world.map.tiles.slice();
 inheritReceiptHistory(world,copy);
 return copy;
}
