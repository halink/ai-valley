/** Offline candidate assembly only. No game bindings, production installation or visual approval.
 * The caller supplies explicitly approved JSON and exact PNG bytes, never a search directory.
 */
import {parseStorybookAnimationBundle, type StorybookAnimationBundle} from '../client/storybook-animation-assets.js';
import {storybookFacing} from '../client/storybook-geometry.js';
import {STORYBOOK_MAX_PIXELS_PER_UNIT, type StorybookAsset, type StorybookFrame, type StorybookPackPin} from '../client/storybook-assets.js';
import {decodeRgbaPng, encodeRgbaPng, sha256, type RgbaImage} from './storybook-png.js';

export const PIPELINE_VERSION = '1.0.0';
export const DENSITY_PIPELINE_VERSION = '1.1.0';
export const BUILD_LIMITS = Object.freeze({sources: 128, sourceBytes: 96_000_000, sourcePixels: 24_000_000, frames: 4096, atlasSide: 2048});
const directions = ['north', 'east', 'south', 'west'] as const;
type Direction = typeof directions[number];
type Point = {x: number; y: number};
type Rect = Point & {width: number; height: number};
type InputFrame = {sourceId: string; rect: Rect; foot: Point; transparency: 'required' | 'opaque-allowed'};
type Base = {id: string; footprint: {width: number; height: number}; groundAnchor: Point};
type InputAsset = Base & ({kind: 'static'; frame: InputFrame} | {kind: 'directional'; frames: Record<Direction, InputFrame>});
type Source = {
  id: string; path: string; sha256: string; width: number; height: number;
  role: 'production-export' | 'synthetic-diagnostic';
  authorization: {purpose: 'atlas-assembly'; reference: string; author: string; license: string};
};
type Cel = {assetId: string; durationMs: number};
type Character = {id: string; clips: {idle: {cels: Cel[]}; walk: {cels: Cel[]}; pick: {cels: Cel[]} | null}};
type Building = {
  id: string; layers: {contact: string; body: string; roof: string; foreground: string[]};
  points: {door: Point; operations: {id: string; x: number; y: number}[]};
};
type RecipeAtlas = {width: number; maxHeight: number; padding: number};
type RecipeBody = {
  packId: string; packVersion: string;
  purpose: 'production-candidate' | 'synthetic-diagnostic'; profile: 'first-batch' | 'custom';
  provenance: {source: string; author: string; license: string};
  sources: Source[]; assets: InputAsset[]; characters: Character[]; buildings: Building[];
};
export type StorybookBuildRecipe = RecipeBody & (
  {buildSchemaVersion: 1; atlas: RecipeAtlas} |
  {buildSchemaVersion: 2; atlas: RecipeAtlas & {pixelsPerUnit: number}}
);
function fail(reason: string): never {throw Error(`invalid_storybook_build: ${reason}`);}
function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) fail(path);
  const ds = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(ds);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) fail(`${path}.keys`);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {const d = ds[key]; if (!d || !('value' in d) || !d.enumerable) fail(`${path}.${key}`); copy[key] = d.value;}
  return copy;
}
function list(value: unknown, min: number, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) fail(path);
  const ds = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(ds).length !== value.length + 1) fail(`${path}.keys`);
  return Array.from({length: value.length}, (_, i) => {const d = ds[String(i)]; if (!d || !('value' in d) || !d.enumerable) fail(path); return d.value;});
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) fail(path);
  return value;
}
function id(value: unknown, path: string): string {const s = string(value, path); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s)) fail(path); return s;}
function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(path); return value;
}
function point(value: unknown, width: number, height: number, path: string): Point {
  const p = record(value, ['x', 'y'], path);
  for (const [k, limit] of [['x', width], ['y', height]] as const) {
    if (typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k] < 0 || p[k] > limit) fail(`${path}.${k}`);
  }
  return {x: p.x as number, y: p.y as number};
}
function unique(values: string[], path: string): void {if (new Set(values).size !== values.length) fail(`${path}.duplicate`);}
/** Portable relative paths only. Filesystem callers must additionally reject symlink ancestors. */
export function assetRelativePath(value: unknown, extension?: string): string {
  const s = string(value, 'path');
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(s) || s.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) ||
    /(?:^|\/)docs\/design(?:\/|$)/.test(s) || (extension && !s.endsWith(extension))) fail('path');
  return s;
}
/** Parse before reading any sources. This declaration records permission; it cannot grant it. */
export function parseStorybookBuildRecipe(value: unknown): StorybookBuildRecipe {
  const r = record(value, ['buildSchemaVersion', 'packId', 'packVersion', 'purpose', 'profile', 'atlas', 'provenance', 'sources', 'assets', 'characters', 'buildings'], 'recipe');
  if (r.buildSchemaVersion !== 1 && r.buildSchemaVersion !== 2) fail('schema_version');
  const packId = id(r.packId, 'packId'), packVersion = string(r.packVersion, 'packVersion');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packVersion)) fail('packVersion');
  if (r.purpose !== 'production-candidate' && r.purpose !== 'synthetic-diagnostic') fail('purpose');
  if (r.profile !== 'first-batch' && r.profile !== 'custom') fail('profile');
  if (r.purpose === 'synthetic-diagnostic' && !packId.startsWith('synthetic-')) fail('synthetic_pack_label');
  const a = record(r.atlas, r.buildSchemaVersion === 1 ? ['width', 'maxHeight', 'padding'] : ['width', 'maxHeight', 'padding', 'pixelsPerUnit'], 'atlas');
  const density = r.buildSchemaVersion === 2 ? integer(a.pixelsPerUnit, 1, STORYBOOK_MAX_PIXELS_PER_UNIT, 'atlas.pixelsPerUnit') : 1;
  const atlas = {width: integer(a.width, 1, BUILD_LIMITS.atlasSide, 'atlas.width'), maxHeight: integer(a.maxHeight, 1, BUILD_LIMITS.atlasSide, 'atlas.maxHeight'), padding: integer(a.padding, 1, 16, 'atlas.padding')};
  const p = record(r.provenance, ['source', 'author', 'license'], 'provenance');
  const provenance = {source: string(p.source, 'provenance.source'), author: string(p.author, 'provenance.author'), license: string(p.license, 'provenance.license')};
  if (r.purpose === 'synthetic-diagnostic' && !/SYNTHETIC/.test(provenance.source)) fail('synthetic_source_label');
  const sources: Source[] = list(r.sources, 1, BUILD_LIMITS.sources, 'sources').map((value, i) => {
    const at = `sources.${i}`, s = record(value, ['id', 'path', 'sha256', 'width', 'height', 'role', 'authorization'], at);
    const auth = record(s.authorization, ['purpose', 'reference', 'author', 'license'], `${at}.authorization`);
    if (auth.purpose !== 'atlas-assembly') fail(`${at}.authorization.purpose`);
    if (s.role !== (r.purpose === 'synthetic-diagnostic' ? 'synthetic-diagnostic' : 'production-export')) fail(`${at}.role`);
    const digest = string(s.sha256, `${at}.sha256`); if (!/^[a-f0-9]{64}$/.test(digest)) fail(`${at}.sha256`);
    return {id: id(s.id, `${at}.id`), path: assetRelativePath(s.path, '.png'), sha256: digest,
      width: integer(s.width, 1, 4096, `${at}.width`), height: integer(s.height, 1, 4096, `${at}.height`), role: s.role as Source['role'],
      authorization: {purpose: 'atlas-assembly', reference: string(auth.reference, `${at}.authorization.reference`), author: string(auth.author, `${at}.authorization.author`), license: string(auth.license, `${at}.authorization.license`)}};
  });
  unique(sources.map(s => s.id), 'sources.ids'); unique(sources.map(s => s.path), 'sources.paths');
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  let count = 0;
  function frame(value: unknown, path: string, directional: boolean): InputFrame {
    if (++count > BUILD_LIMITS.frames) fail('frame_limit');
    const f = record(value, ['sourceId', 'rect', 'foot', 'transparency'], path), sourceId = id(f.sourceId, `${path}.sourceId`), source = sourceMap.get(sourceId);
    if (!source) fail(`${path}.source`);
    const rr = record(f.rect, ['x', 'y', 'width', 'height'], `${path}.rect`);
    const rect = {x: integer(rr.x, 0, source.width, `${path}.x`), y: integer(rr.y, 0, source.height, `${path}.y`),
      width: integer(rr.width, 1, source.width, `${path}.width`), height: integer(rr.height, 1, source.height, `${path}.height`)};
    if (rect.x + rect.width > source.width || rect.y + rect.height > source.height) fail(`${path}.bounds`);
    if ((f.transparency !== 'required' && f.transparency !== 'opaque-allowed') || (directional && f.transparency !== 'required')) fail(`${path}.transparency`);
    return {sourceId, rect, foot: point(f.foot, rect.width, rect.height, `${path}.foot`), transparency: f.transparency};
  }
  const assets: InputAsset[] = list(r.assets, 1, BUILD_LIMITS.frames, 'assets').map((value, i) => {
    if (!value || typeof value !== 'object') fail(`assets.${i}`);
    const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
    if (kind !== 'static' && kind !== 'directional') fail(`assets.${i}.kind`);
    const s = record(value, ['id', 'kind', 'footprint', 'groundAnchor', kind === 'static' ? 'frame' : 'frames'], `assets.${i}`);
    const fp = record(s.footprint, ['width', 'height'], `assets.${i}.footprint`), footprint = {width: integer(fp.width, 1, 128, 'footprint.width'), height: integer(fp.height, 1, 128, 'footprint.height')};
    const base = {id: id(s.id, `assets.${i}.id`), footprint, groundAnchor: point(s.groundAnchor, footprint.width, footprint.height, 'groundAnchor')};
    if (kind === 'static') return {...base, kind, frame: frame(s.frame, `assets.${i}.frame`, false)};
    const fs = record(s.frames, directions, `assets.${i}.frames`);
    return {...base, kind, frames: Object.fromEntries(directions.map(d => [d, frame(fs[d], `assets.${i}.${d}`, true)])) as Record<Direction, InputFrame>};
  });
  unique(assets.map(a => a.id), 'assets.ids');
  const characters: Character[] = list(r.characters, 0, 64, 'characters').map((value, i) => {
    const c = record(value, ['id', 'clips'], `characters.${i}`), clips = record(c.clips, ['idle', 'walk', 'pick'], `characters.${i}.clips`);
    const clip = (name: 'idle' | 'walk' | 'pick') => {
      const k = record(clips[name], ['cels'], `characters.${i}.${name}`), n = {idle: 2, walk: 6, pick: 4}[name];
      const cels = list(k.cels, n, n, `characters.${i}.${name}.cels`).map((value, j) => {
        const e = record(value, ['assetId', 'durationMs'], `characters.${i}.${name}.${j}`);
        if (typeof e.durationMs !== 'number' || !Number.isFinite(e.durationMs)) fail('durationMs');
        return {assetId: id(e.assetId, 'assetId'), durationMs: e.durationMs};
      });
      return {cels};
    };
    return {id: id(c.id, `characters.${i}.id`), clips: {idle: clip('idle'), walk: clip('walk'), pick: clips.pick === null ? null : clip('pick')}};
  });
  unique(characters.map(c => c.id), 'characters.ids');
  const refs = characters.flatMap(c => [c.clips.idle, c.clips.walk, c.clips.pick].flatMap(clip => clip?.cels.map(cel => cel.assetId) ?? []));
  unique(refs, 'character_assets');
  const directional = assets.filter(a => a.kind === 'directional').map(a => a.id);
  if (refs.length !== directional.length || refs.some(ref => !directional.includes(ref))) fail('character_asset_coverage');
  const buildings: Building[] = list(r.buildings, 0, 64, 'buildings').map((value, i) => {
    const b = record(value, ['id', 'layers', 'points'], `buildings.${i}`), ls = record(b.layers, ['contact', 'body', 'roof', 'foreground'], `buildings.${i}.layers`);
    const layers = {contact: id(ls.contact, 'contact'), body: id(ls.body, 'body'), roof: id(ls.roof, 'roof'), foreground: list(ls.foreground, 0, 16, 'foreground').map(v => id(v, 'foreground'))};
    const ids = [layers.contact, layers.body, layers.roof, ...layers.foreground]; unique(ids, 'layers');
    let registered = '';
    let canvas: Rect | undefined;
    for (const layer of ids) {
      const asset = assets.find(a => a.id === layer);
      if (!asset || asset.kind !== 'static' || asset.frame.transparency !== 'required') fail('building_static_transparent_layer');
      const {rect, foot} = asset.frame;
      const signature = JSON.stringify([rect.width, rect.height, foot, asset.footprint, asset.groundAnchor]);
      if (registered && registered !== signature) fail('building_layer_registration'); registered = signature; canvas = rect;
    }
    const ps = record(b.points, ['door', 'operations'], `buildings.${i}.points`);
    const operations = list(ps.operations, 0, 32, 'operations').map(value => {
      const op = record(value, ['id', 'x', 'y'], 'operation');
      return {id: id(op.id, 'operation.id'), ...point({x: op.x, y: op.y}, canvas!.width, canvas!.height, 'operation.point')};
    });
    unique(operations.map(op => op.id), 'operations');
    return {id: id(b.id, `buildings.${i}.id`), layers, points: {door: point(ps.door, canvas!.width, canvas!.height, 'door'), operations}};
  });
  unique(buildings.map(b => b.id), 'buildings.ids');
  if (r.profile === 'first-batch' && (characters.length !== 2 || characters.filter(c => c.clips.pick !== null).length !== 1 || refs.length * 4 !== 80 || buildings.length !== 1)) fail('first_batch_requires_two_characters_80_frames_one_building');
  const body: RecipeBody & {atlas: RecipeAtlas} = {packId, packVersion, purpose: r.purpose, profile: r.profile, atlas, provenance, sources, assets, characters, buildings};
  return r.buildSchemaVersion === 1 ? {buildSchemaVersion: 1, ...body} : {buildSchemaVersion: 2, ...body, atlas: {...atlas, pixelsPerUnit: density}};
}
type Placement = {assetId: string; direction: Direction | null; sourceId: string; sourceRect: Rect; atlasRect: Rect; foot: Point; pixelSha256: string; alpha: {transparent: number; partial: number; opaque: number}};
function overlap(a: Rect, b: Rect): boolean {return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;}
function crop(source: RgbaImage, rect: Rect): Uint8Array {
  const pixels = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * source.width + rect.x) * 4;
    pixels.set(source.pixels.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return pixels;
}
export function alphaCounts(pixels: Uint8Array): Placement['alpha'] {
  let transparent = 0, partial = 0, opaque = 0;
  for (let i = 3; i < pixels.length; i += 4) {if (!pixels[i]) transparent++; else if (pixels[i] === 255) opaque++; else partial++;}
  return {transparent, partial, opaque};
}
/** Also useful for verifying an already assembled v1 or v2 bundle against actual local PNG bytes. */
export function validateStorybookAtlas(bytes: Uint8Array, manifestInput: unknown, animationInput: unknown, pin: StorybookPackPin): StorybookAnimationBundle {
  const bundle = parseStorybookAnimationBundle(manifestInput, animationInput, pin);
  if (sha256(bytes) !== bundle.manifest.atlas.sha256) fail('atlas_byte_hash');
  const decoded = decodeRgbaPng(bytes);
  if (decoded.width !== bundle.manifest.atlas.width || decoded.height !== bundle.manifest.atlas.height) fail('atlas_dimensions');
  const rects: Rect[] = [];
  for (const asset of bundle.manifest.assets) for (const f of asset.kind === 'static' ? [asset.frame] : Object.values(asset.frames)) {
    if (rects.some(r => overlap(r, f.rect))) fail('atlas_frame_overlap'); rects.push(f.rect);
    const alpha = alphaCounts(crop(decoded, f.rect));
    if (!alpha.opaque && !alpha.partial) fail('empty_frame');
    if (asset.kind === 'directional' && !alpha.transparent) fail('directional_frame_requires_transparency');
  }
  return bundle;
}
export type StorybookBuildResult = ReturnType<typeof assembleStorybookAssets>;
/** Does not access disk. Map keys must exactly equal declared source IDs. Input order is packing order. */
export function assembleStorybookAssets(input: unknown, sourceBytes: ReadonlyMap<string, Uint8Array>, recipeSha256: string) {
  const recipe = parseStorybookBuildRecipe(input);
  if (!/^[a-f0-9]{64}$/.test(recipeSha256)) fail('recipe_hash');
  if (sourceBytes.size !== recipe.sources.length || [...sourceBytes.keys()].some(k => !recipe.sources.some(s => s.id === k))) fail('source_bytes_coverage');
  const images = new Map<string, RgbaImage>(); let totalBytes = 0, totalPixels = 0;
  const sources = recipe.sources.map(source => {
    const bytes = sourceBytes.get(source.id)!;
    totalBytes += bytes.length; totalPixels += source.width * source.height;
    if (totalBytes > BUILD_LIMITS.sourceBytes || totalPixels > BUILD_LIMITS.sourcePixels) fail('source_budget');
    if (sha256(bytes) !== source.sha256) fail(`source_hash.${source.id}`);
    const image = decodeRgbaPng(bytes);
    if (image.width !== source.width || image.height !== source.height) fail(`source_dimensions.${source.id}`);
    images.set(source.id, image);
    return {...source, byteLength: bytes.length, alpha: alphaCounts(image.pixels)};
  });
  const {width, maxHeight, padding} = recipe.atlas;
  let x = padding, y = padding, row = 0;
  const placements: Placement[] = [], cells: Uint8Array[] = [];
  function pack(asset: InputAsset, frame: InputFrame, direction: Direction | null): StorybookFrame {
    if (placements.some(p => p.sourceId === frame.sourceId && overlap(p.sourceRect, frame.rect))) fail('source_frame_overlap');
    const {width: w, height: h} = frame.rect;
    if (w + 2 * padding > width || h + 2 * padding > maxHeight) fail('frame_exceeds_atlas');
    if (x + w + padding > width) {x = padding; y += row + padding; row = 0;}
    if (y + h + padding > maxHeight) fail('atlas_capacity');
    const rect = {x, y, width: w, height: h}, pixels = crop(images.get(frame.sourceId)!, frame.rect), alpha = alphaCounts(pixels);
    if (!alpha.opaque && !alpha.partial) fail('empty_frame');
    if (frame.transparency === 'required' && !alpha.transparent) fail('frame_requires_transparency');
    placements.push({assetId: asset.id, direction, sourceId: frame.sourceId, sourceRect: {...frame.rect}, atlasRect: rect, foot: {...frame.foot}, pixelSha256: sha256(pixels), alpha});
    cells.push(pixels); x += w + padding; row = Math.max(row, h);
    return {rect, foot: {...frame.foot}};
  }
  const assets: StorybookAsset[] = recipe.assets.map(asset => {
    const base = {id: asset.id, footprint: asset.footprint, groundAnchor: asset.groundAnchor};
    if (asset.kind === 'static') return {...base, kind: 'static', frame: pack(asset, asset.frame, null)};
    return {...base, kind: 'directional', frames: Object.fromEntries(directions.map(d => [storybookFacing(d), pack(asset, asset.frames[d], d)])) as Extract<StorybookAsset, {kind: 'directional'}>['frames']};
  });
  if (sources.some(s => !placements.some(p => p.sourceId === s.id))) fail('unused_source');
  const height = y + row + padding, pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < placements.length; i++) {
    const r = placements[i].atlasRect, cel = cells[i];
    for (let dy = 0; dy < r.height; dy++) pixels.set(cel.subarray(dy * r.width * 4, (dy + 1) * r.width * 4), ((r.y + dy) * width + r.x) * 4);
  }
  const png = encodeRgbaPng({width, height, pixels}), pin = {packId: recipe.packId, packVersion: recipe.packVersion}, digest = sha256(png);
  const density = recipe.buildSchemaVersion === 2 ? recipe.atlas.pixelsPerUnit : 1;
  const densityFields = recipe.buildSchemaVersion === 2 ? {pixelsPerUnit: density} : {};
  const manifest = {schemaVersion: recipe.buildSchemaVersion, ...pin, projection: {tileWidth: 32, tileHeight: 16}, atlas: {path: `assets/storybook/${recipe.packId}.png`, width, height, sha256: digest, ...densityFields}, provenance: recipe.provenance, assets};
  // Coordinates and PNG cells remain source pixels. These report-only conversions
  // make the intended logical geometry auditable without changing world footprints.
  const logicalPoint = (p: Point): Point => ({x: p.x / density, y: p.y / density});
  const animation = recipe.characters.length ? {animationSchemaVersion: 1, atlas: {...pin, sha256: digest}, characters: recipe.characters, bindings: []} : null;
  const bundle = validateStorybookAtlas(png, manifest, animation, pin);
  const duplicatePixels = placements.filter((p, i) => placements.findIndex(q => q.pixelSha256 === p.pixelSha256 && q.atlasRect.width === p.atlasRect.width && q.atlasRect.height === p.atlasRect.height) !== i).map(p => ({assetId: p.assetId, direction: p.direction}));
  const report = {
    buildReportVersion: recipe.buildSchemaVersion, pipelineVersion: recipe.buildSchemaVersion === 1 ? PIPELINE_VERSION : DENSITY_PIPELINE_VERSION, recipeSha256, ...pin, purpose: recipe.purpose, profile: recipe.profile,
    status: 'validated-candidate-only', visualApproval: false, productionInstalled: false,
    atlas: {...manifest.atlas, byteLength: png.length, ...(recipe.buildSchemaVersion === 2 ? {logicalWidth: width / density, logicalHeight: height / density} : {})}, directionMapping: Object.fromEntries(directions.map(d => [d, storybookFacing(d)])),
    animationFrameCount: placements.filter(p => p.direction !== null).length, sources,
    placements: recipe.buildSchemaVersion === 1 ? placements : placements.map(p => ({...p,
      logicalSize: {width: p.atlasRect.width / density, height: p.atlasRect.height / density}, logicalFoot: logicalPoint(p.foot)})),
    buildings: recipe.buildings,
    ...(recipe.buildSchemaVersion === 2 ? {logicalBuildings: recipe.buildings.map(b => ({...b, points: {
      door: logicalPoint(b.points.door), operations: b.points.operations.map(op => ({id: op.id, ...logicalPoint(op)})),
    }}))} : {}),
    duplicatePixels, warnings: ['License and authorization are declarations, not legal verification.', 'Source crops, alpha and anchors do not verify artwork, identity, anatomical direction or pixel-level foot stability.', 'No production installation, resident binding, visual acceptance or runtime acceptance.'],
  } as const;
  return {png, manifest: bundle.manifest, animation: bundle.animation, report};
}
/** Stable JSON and filenames; manifest path is the future runtime path, not an install action. */
export function storybookBuildFiles(result: StorybookBuildResult): ReadonlyMap<string, Uint8Array> {
  const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  return new Map([['atlas.png', result.png], ['atlas.manifest.json', json(result.manifest)], ['atlas.animation.json', json(result.animation)], ['asset-build.json', json(result.report)]]);
}
