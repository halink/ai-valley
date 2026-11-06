import {createHash} from 'node:crypto';
import type {World} from '../shared/types.js';

const keys = new WeakMap<World['map'], string>();
export function terrainRevision(map: World['map']): string {
  const saved = keys.get(map);
  if (saved) return saved;
  const key = createHash('sha256').update(JSON.stringify(map)).digest('hex');
  // Edits replace the map. Sharing frozen terrain across ticks avoids copying 307,200 tiles every second.
  Object.freeze(map.tiles);
  Object.freeze(map.entrance);
  Object.freeze(map);
  keys.set(map,key);
  return key;
}
