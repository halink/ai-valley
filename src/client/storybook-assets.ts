/** CPU-only metadata contract. Does not load files, inspect PNG pixels, verify hashes,
 * or establish legal rights: provenance fields are declarations by the pack author.
 * Frames are untrimmed and unrotated. Foot/anchor coordinates use inclusive edges.
 */
export const STORYBOOK_SCHEMA_VERSION = 1 as const;
export const STORYBOOK_DENSITY_SCHEMA_VERSION = 2 as const;
export const STORYBOOK_MAX_PIXELS_PER_UNIT = 8;
export type StorybookDirection = 'northeast' | 'southeast' | 'southwest' | 'northwest';
export type StorybookPoint = Readonly<{x: number; y: number}>;
export type StorybookFootprint = Readonly<{width: number; height: number}>;
export type StorybookFrame = Readonly<{
  rect: Readonly<{x: number; y: number; width: number; height: number}>;
  foot: StorybookPoint;
}>;
type AssetBase = Readonly<{id: string; footprint: StorybookFootprint; groundAnchor: StorybookPoint}>;
export type StorybookAsset = AssetBase & (
  Readonly<{kind: 'static'; frame: StorybookFrame}> |
  Readonly<{kind: 'directional'; frames: Readonly<Record<StorybookDirection, StorybookFrame>>}>
);
export type StorybookPackPin = Readonly<{packId: string; packVersion: string}>;
type StorybookAtlasMetadata = Readonly<{path: string; width: number; height: number; sha256: string}>;
export type StorybookManifest = StorybookPackPin & Readonly<{
  projection: Readonly<{tileWidth: 32; tileHeight: 16}>;
  provenance: Readonly<{source: string; author: string; license: string}>;
  assets: readonly StorybookAsset[];
}> & (
  Readonly<{schemaVersion: typeof STORYBOOK_SCHEMA_VERSION; atlas: StorybookAtlasMetadata}> |
  Readonly<{schemaVersion: typeof STORYBOOK_DENSITY_SCHEMA_VERSION; atlas: StorybookAtlasMetadata & Readonly<{pixelsPerUnit: number}>}>
);
/** v1 remains an exact 1:1 contract. v2 density belongs to source artwork, not world tiles. */
export function storybookPixelsPerUnit(manifest: StorybookManifest): number {
  return manifest.schemaVersion === STORYBOOK_DENSITY_SCHEMA_VERSION ? manifest.atlas.pixelsPerUnit : 1;
}
const directions = ['northeast', 'southeast', 'southwest', 'northwest'] as const;
function fail(path: string): never { throw new Error(`invalid_storybook_manifest: ${path}`); }
function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return fail(`${path}.keys`);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail(`${path}.${key}`);
    copy[key] = descriptor.value;
  }
  return copy;
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail(path);
  return value;
}
function id(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result)) return fail(path);
  return result;
}
function version(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(result)) return fail(path);
  return result;
}
function integer(value: unknown, minimum: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return fail(path);
  return value;
}
function point(value: unknown, width: number, height: number, path: string): StorybookPoint {
  const p = record(value, ['x', 'y'], path);
  for (const [key, maximum] of [['x', width], ['y', height]] as const) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < 0 || p[key] > maximum) return fail(`${path}.${key}`);
  }
  return Object.freeze({x: p.x as number, y: p.y as number});
}
function frame(value: unknown, atlasWidth: number, atlasHeight: number, path: string): StorybookFrame {
  const f = record(value, ['rect', 'foot'], path);
  const r = record(f.rect, ['x', 'y', 'width', 'height'], `${path}.rect`);
  const x = integer(r.x, 0, `${path}.rect.x`), y = integer(r.y, 0, `${path}.rect.y`);
  const width = integer(r.width, 1, `${path}.rect.width`), height = integer(r.height, 1, `${path}.rect.height`);
  if (width > atlasWidth || height > atlasHeight || x > atlasWidth - width || y > atlasHeight - height) return fail(`${path}.rect.bounds`);
  return Object.freeze({rect: Object.freeze({x, y, width, height}), foot: point(f.foot, width, height, `${path}.foot`)});
}
/** Parse JSON-like data against an explicit pack/version pin; returns detached frozen copies.
 * Accessors and non-plain objects are rejected. Hostile JavaScript Proxies are not a sandbox boundary.
 */
export function parseStorybookManifest(input: unknown, expected: StorybookPackPin): StorybookManifest {
  const pin = record(expected, ['packId', 'packVersion'], 'pin');
  const expectedId = id(pin.packId, 'pin.packId'), expectedVersion = version(pin.packVersion, 'pin.packVersion');
  const m = record(input, ['schemaVersion', 'packId', 'packVersion', 'projection', 'atlas', 'provenance', 'assets'], 'manifest');
  if (m.schemaVersion !== STORYBOOK_SCHEMA_VERSION && m.schemaVersion !== STORYBOOK_DENSITY_SCHEMA_VERSION) return fail('schemaVersion');
  const packId = id(m.packId, 'packId'), packVersion = version(m.packVersion, 'packVersion');
  if (packId !== expectedId || packVersion !== expectedVersion) return fail('pin.mismatch');
  const projection = record(m.projection, ['tileWidth', 'tileHeight'], 'projection');
  if (projection.tileWidth !== 32 || projection.tileHeight !== 16) return fail('projection');
  const a = record(m.atlas, ['path', 'width', 'height', 'sha256', ...(m.schemaVersion === STORYBOOK_DENSITY_SCHEMA_VERSION ? ['pixelsPerUnit'] : [])], 'atlas');
  const pixelsPerUnit = m.schemaVersion === STORYBOOK_DENSITY_SCHEMA_VERSION ? integer(a.pixelsPerUnit, 1, 'atlas.pixelsPerUnit') : 1;
  if (pixelsPerUnit > STORYBOOK_MAX_PIXELS_PER_UNIT) return fail('atlas.pixelsPerUnit');
  const path = string(a.path, 'atlas.path');
  if (!/^assets\/storybook\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.png$/.test(path)) return fail('atlas.path');
  const width = integer(a.width, 1, 'atlas.width'), height = integer(a.height, 1, 'atlas.height');
  const sha256 = string(a.sha256, 'atlas.sha256');
  if (!/^[a-f0-9]{64}$/.test(sha256)) return fail('atlas.sha256');
  const p = record(m.provenance, ['source', 'author', 'license'], 'provenance');
  const provenance = Object.freeze({source: string(p.source, 'provenance.source'), author: string(p.author, 'provenance.author'), license: string(p.license, 'provenance.license')});
  if (!Array.isArray(m.assets) || m.assets.length === 0) return fail('assets');
  const descriptors = Object.getOwnPropertyDescriptors(m.assets);
  if (Reflect.ownKeys(descriptors).length !== m.assets.length + 1) return fail('assets.keys');
  const ids = new Set<string>();
  const assets: StorybookAsset[] = [];
  for (let i = 0; i < m.assets.length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail(`assets.${i}`);
    const value: unknown = descriptor.value;
    // Inspect kind without invoking an accessor, before selecting the exact shape.
    if (value === null || typeof value !== 'object') return fail(`assets.${i}`);
    const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
    if (kind !== 'static' && kind !== 'directional') return fail(`assets.${i}.kind`);
    const e = record(value, ['id', 'kind', 'footprint', 'groundAnchor', kind === 'static' ? 'frame' : 'frames'], `assets.${i}`);
    const assetId = id(e.id, `assets.${i}.id`);
    if (ids.has(assetId)) return fail(`assets.${i}.duplicate`);
    ids.add(assetId);
    const fp = record(e.footprint, ['width', 'height'], `assets.${i}.footprint`);
    const footprint = Object.freeze({width: integer(fp.width, 1, `assets.${i}.footprint.width`), height: integer(fp.height, 1, `assets.${i}.footprint.height`)});
    const base = {id: assetId, footprint, groundAnchor: point(e.groundAnchor, footprint.width, footprint.height, `assets.${i}.groundAnchor`)};
    if (kind === 'static') assets.push(Object.freeze({...base, kind, frame: frame(e.frame, width, height, `assets.${i}.frame`)}));
    else {
      const fs = record(e.frames, directions, `assets.${i}.frames`);
      const frames = Object.fromEntries(directions.map(direction => [direction, frame(fs[direction], width, height, `assets.${i}.frames.${direction}`)])) as Record<StorybookDirection, StorybookFrame>;
      assets.push(Object.freeze({...base, kind, frames: Object.freeze(frames)}));
    }
  }
  const projectionUnits = Object.freeze({tileWidth: 32, tileHeight: 16} as const), frozenAssets = Object.freeze(assets);
  return m.schemaVersion === STORYBOOK_DENSITY_SCHEMA_VERSION
    ? Object.freeze({schemaVersion: STORYBOOK_DENSITY_SCHEMA_VERSION, packId, packVersion, projection: projectionUnits, atlas: Object.freeze({path, width, height, sha256, pixelsPerUnit}), provenance, assets: frozenAssets})
    : Object.freeze({schemaVersion: STORYBOOK_SCHEMA_VERSION, packId, packVersion, projection: projectionUnits, atlas: Object.freeze({path, width, height, sha256}), provenance, assets: frozenAssets});
}
