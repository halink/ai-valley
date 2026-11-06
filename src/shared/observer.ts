import type { Snapshot, World } from './types.js';

export const entityFields = ['residents', 'resources', 'buildings', 'plots'] as const;
type EntityField = typeof entityFields[number];
export type Changes = {
  [K in EntityField]?: {upsert: World[K]; remove: string[]; patch?: Array<Partial<World[K][number]> & {id:string}>}
};
export interface ObserverUpdate {
  worldId: string;
  mapRevision: string;
  baseRevision?: number;
  serverTime: string;
  version: string;
  capabilities: Snapshot['capabilities'];
  world: Partial<World>;
  changes?: Changes;
}

function reconcile<T extends {id: string}>(previous: T[], upsert: T[], remove: string[], patch: Array<Partial<T> & {id:string}> = []): T[] {
  const replaced = new Map(upsert.map(item => [item.id, item]));
  const removed = new Set(remove);
  const patches = new Map(patch.map(value => [value.id,value]));
  const result = previous.filter(item => !removed.has(item.id)).map(item => {
    const changes = patches.get(item.id);
    const next = replaced.get(item.id) ?? (changes ? {...item,...changes} : item);
    replaced.delete(item.id);
    return next;
  });
  return result.concat([...replaced.values()]);
}

export function applyObserverUpdate(current: Snapshot, update: ObserverUpdate): Snapshot | null {
  if (current.world.id !== update.worldId || current.mapRevision !== update.mapRevision) return null;
  if ((update.world.revision ?? -1) < current.world.revision) return current;
  if (update.baseRevision !== undefined && update.baseRevision !== current.world.revision) return null;
  const world = {...current.world, ...update.world};
  function apply<K extends EntityField>(key: K) {
    const changes = update.changes?.[key];
    if (changes) world[key] = reconcile<{id: string}>(world[key], changes.upsert, changes.remove, changes.patch) as World[K];
  }
  for (const key of entityFields) apply(key);
  return {world, mapRevision:update.mapRevision, serverTime:update.serverTime, version:update.version, capabilities:update.capabilities};
}
