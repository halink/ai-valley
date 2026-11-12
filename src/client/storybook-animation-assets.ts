/** Optional animation companion for v1 or density-aware v2 atlases. No art, loading or world writes.
 * References describe separately authored cels, never mirroring, resizing or inferred identity.
 */
import {parseStorybookManifest, type StorybookManifest, type StorybookPackPin, type StorybookFrame} from './storybook-assets.js';
import {storybookFacing, type StorybookWorldDirection} from './storybook-geometry.js';

export const STORYBOOK_ANIMATION_SCHEMA_VERSION = 1 as const;
export const STORYBOOK_ANIMATION_LIMITS = Object.freeze({characters: 64, bindings: 512, frames: 3072});
export const STORYBOOK_WORLD_DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west'] as const);
export type StorybookClipName = 'idle' | 'walk' | 'pick';
export type StorybookAnimationCel = Readonly<{assetId: string; durationMs: number}>;
export type StorybookAnimationClip = Readonly<{cels: readonly StorybookAnimationCel[]}>;
export type StorybookCharacter = Readonly<{
  id: string;
  clips: Readonly<{idle: StorybookAnimationClip; walk: StorybookAnimationClip; pick: StorybookAnimationClip | null}>;
}>;
export type StorybookAnimationCompanion = Readonly<{
  animationSchemaVersion: typeof STORYBOOK_ANIMATION_SCHEMA_VERSION;
  atlas: StorybookPackPin & Readonly<{sha256: string}>;
  characters: readonly StorybookCharacter[];
  bindings: readonly Readonly<{residentId: string; characterId: string}>[];
}>;
export type StorybookAnimationBundle = Readonly<{manifest: StorybookManifest; animation: StorybookAnimationCompanion | null}>;
function fail(path: string): never {throw new Error(`invalid_storybook_animation: ${path}`);}
function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(path);
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) return fail(`${path}.keys`);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key];
    if (!d || !('value' in d) || !d.enumerable) return fail(`${path}.${key}`);
    result[key] = d.value;
  }
  return result;
}
function array(value: unknown, minimum: number, maximum: number, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) return fail(path);
  const ds = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(ds).length !== value.length + 1) return fail(`${path}.keys`);
  return Array.from({length: value.length}, (_, i) => {
    const d = ds[String(i)];
    if (!d || !('value' in d) || !d.enumerable) return fail(`${path}.${i}`);
    return d.value;
  });
}
function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) return fail(path);
  return value;
}
function residentId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.length > 200 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return fail(path);
  return value;
}
/** Parse the atlas with its strict versioned parser. Null companion means static-only,
 * not an implicit animation. Hash equality pins metadata, not PNG bytes or visual quality.
 */
export function parseStorybookAnimationBundle(atlasInput: unknown, animationInput: unknown, pin: StorybookPackPin): StorybookAnimationBundle {
  const manifest = parseStorybookManifest(atlasInput, pin);
  if (animationInput === null) return Object.freeze({manifest, animation: null});
  const a = object(animationInput, ['animationSchemaVersion', 'atlas', 'characters', 'bindings'], 'companion');
  if (a.animationSchemaVersion !== STORYBOOK_ANIMATION_SCHEMA_VERSION) return fail('schemaVersion');
  const p = object(a.atlas, ['packId', 'packVersion', 'sha256'], 'atlas');
  if (p.packId !== manifest.packId || p.packVersion !== manifest.packVersion || p.sha256 !== manifest.atlas.sha256) return fail('atlas.pin');
  const atlas = Object.freeze({packId: manifest.packId, packVersion: manifest.packVersion, sha256: manifest.atlas.sha256});
  const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));
  const ids = new Set<string>(); let frameCount = 0;
  const characters = array(a.characters, 1, STORYBOOK_ANIMATION_LIMITS.characters, 'characters').map((value, i) => {
    const path = `characters.${i}`, c = object(value, ['id', 'clips'], path), id = identifier(c.id, `${path}.id`);
    if (ids.has(id)) return fail(`${path}.duplicate`); ids.add(id);
    const clips = object(c.clips, ['idle', 'walk', 'pick'], `${path}.clips`);
    const used = new Set<string>(); let canvas: string | null = null;
    const parseClip = (name: StorybookClipName): StorybookAnimationClip => {
      const cp = `${path}.clips.${name}`, clip = object(clips[name], ['cels'], cp), count = {idle: 2, walk: 6, pick: 4}[name];
      const cels = array(clip.cels, count, count, `${cp}.cels`).map((value, index) => {
        const ep = `${cp}.cels.${index}`, e = object(value, ['assetId', 'durationMs'], ep), assetId = identifier(e.assetId, `${ep}.assetId`);
        const durationMs = e.durationMs;
        // Walking is 8–12 fps. Idle includes deliberately long holds; picking has no implied yield timing.
        const [minimum, maximum] = name === 'walk' ? [1000 / 12, 125] : name === 'idle' ? [1000, 60000] : [100, 2000];
        if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < minimum || durationMs > maximum) return fail(`${ep}.durationMs`);
        const asset = assets.get(assetId);
        if (!asset || asset.kind !== 'directional') return fail(`${ep}.directional_asset`);
        if (asset.footprint.width !== 1 || asset.footprint.height !== 1 || asset.groundAnchor.x !== .5 || asset.groundAnchor.y !== .5) return fail(`${ep}.resident_anchor`);
        for (const direction of STORYBOOK_WORLD_DIRECTIONS) {
          const f = asset.frames[storybookFacing(direction)], r = f.rect;
          const signature = `${r.x},${r.y},${r.width},${r.height}`;
          if (used.has(signature)) return fail(`${ep}.reused_frame`); used.add(signature);
          const geometry = `${r.width},${r.height},${f.foot.x},${f.foot.y}`;
          if (canvas !== null && canvas !== geometry) return fail(`${ep}.canvas_or_foot`); canvas = geometry;
          if (++frameCount > STORYBOOK_ANIMATION_LIMITS.frames) return fail('frame_limit');
        }
        return Object.freeze({assetId, durationMs});
      });
      return Object.freeze({cels: Object.freeze(cels)});
    };
    return Object.freeze({id, clips: Object.freeze({idle: parseClip('idle'), walk: parseClip('walk'), pick: clips.pick === null ? null : parseClip('pick')})});
  });
  const residents = new Set<string>();
  const bindings = array(a.bindings, 0, STORYBOOK_ANIMATION_LIMITS.bindings, 'bindings').map((value, i) => {
    const path = `bindings.${i}`, b = object(value, ['residentId', 'characterId'], path), id = residentId(b.residentId, `${path}.residentId`), characterId = identifier(b.characterId, `${path}.characterId`);
    if (residents.has(id)) return fail(`${path}.duplicate`); residents.add(id);
    if (!ids.has(characterId)) return fail(`${path}.character`);
    return Object.freeze({residentId: id, characterId});
  });
  return Object.freeze({manifest, animation: Object.freeze({animationSchemaVersion: STORYBOOK_ANIMATION_SCHEMA_VERSION, atlas, characters: Object.freeze(characters), bindings: Object.freeze(bindings)})});
}
/** Deterministic, half-open timing intervals. No wall clock, world speed, event or completion callback. */
export function storybookCelIndex(clip: StorybookAnimationClip, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > Number.MAX_SAFE_INTEGER) return fail('elapsedMs');
  const duration = clip.cels.reduce((sum, cel) => sum + cel.durationMs, 0);
  let remainder = elapsedMs % duration;
  for (let i = 0; i < clip.cels.length; i++) {if (remainder < clip.cels[i].durationMs) return i; remainder -= clip.cels[i].durationMs;}
  return 0;
}
/** Resolve only parsed metadata. All four world directions are explicit; no mirroring fallback. */
export function storybookAnimationFrame(bundle: StorybookAnimationBundle, resident: string, name: StorybookClipName, direction: StorybookWorldDirection, elapsedMs: number): Readonly<{characterId: string; assetId: string; frameIndex: number; frame: StorybookFrame}> | null {
  const binding = bundle.animation?.bindings.find(b => b.residentId === resident);
  const character = binding && bundle.animation?.characters.find(c => c.id === binding.characterId), clip = character?.clips[name];
  if (!character || !clip) return null;
  const frameIndex = storybookCelIndex(clip, elapsedMs), assetId = clip.cels[frameIndex].assetId;
  const asset = bundle.manifest.assets.find(a => a.id === assetId);
  if (!asset || asset.kind !== 'directional') return fail('unparsed_bundle');
  return Object.freeze({characterId: character.id, assetId, frameIndex, frame: asset.frames[storybookFacing(direction)]});
}
