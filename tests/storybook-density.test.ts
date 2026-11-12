/** Synthetic source-density invariants. No rendered browser, real save or final artwork. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseStorybookManifest, storybookPixelsPerUnit} from '../src/client/storybook-assets.js';
import {placeStorybookFrame, placeStorybookAsset, storybookFacing} from '../src/client/storybook-geometry.js';
import {buildStorybookPlan, pickStorybookPlan} from '../src/client/storybook-render-plan.js';
import {prepareStorybookAtlas} from '../src/client/storybook-texture.js';
import {syntheticManifest, syntheticAtlasPixels, syntheticPin, SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT} from '../src/client/storybook-synthetic-atlas.js';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot} from '../src/shared/types.js';
import {encodeRgbaPng, decodeRgbaPng, sha256} from '../src/tools/storybook-png.js';
import {densityAtlas} from './helpers/storybook-density-fixture.js';

const original = {manifest: syntheticManifest, width: SYNTHETIC_WIDTH, height: SYNTHETIC_HEIGHT, pixels: syntheticAtlasPixels()};
const bounds = {x: 20, y: 15, width: 32, height: 32};
function fixture(): Snapshot {return {world: createWorld(5401), serverTime: 'synthetic density', version: 'synthetic', capabilities: {active: [], pending: []}};}
function v2(density = 2): any {return {...structuredClone(syntheticManifest), schemaVersion: 2, atlas: {...syntheticManifest.atlas, pixelsPerUnit: density}};}
test('v1 stays exact and v2 is explicit, detached, frozen and still uses 32×16 logical tiles', () => {
  assert.equal(storybookPixelsPerUnit(syntheticManifest), 1);
  assert.equal(JSON.stringify(parseStorybookManifest(syntheticManifest, syntheticPin)), JSON.stringify(syntheticManifest));
  assert.equal(Object.hasOwn(syntheticManifest.atlas, 'pixelsPerUnit'), false);
  for (let density = 1; density <= 8; density++) {
    const input = v2(density), before = structuredClone(input), m = parseStorybookManifest(input, syntheticPin);
    assert.equal(storybookPixelsPerUnit(m), density); assert.deepEqual(m, before);
    assert.deepEqual(m.projection, {tileWidth: 32, tileHeight: 16}); assert.ok(Object.isFrozen(m.atlas));
    input.atlas.pixelsPerUnit = 8; assert.equal(storybookPixelsPerUnit(m), density);
  }
});
test('density metadata rejects ambiguity, unsafe values and accessors without invoking them', () => {
  for (const value of [undefined, null, '2', 0, -1, 1.5, 9, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    const m = v2(); m.atlas.pixelsPerUnit = value; assert.throws(() => parseStorybookManifest(m, syntheticPin), /atlas.pixelsPerUnit/);
  }
  const missing = v2(); delete missing.atlas.pixelsPerUnit; assert.throws(() => parseStorybookManifest(missing, syntheticPin), /atlas.keys/);
  const legacy = v2(); legacy.schemaVersion = 1; assert.throws(() => parseStorybookManifest(legacy, syntheticPin), /atlas.keys/);
  const extra = v2(); extra.atlas.scale = 2; assert.throws(() => parseStorybookManifest(extra, syntheticPin), /atlas.keys/);
  const projection = v2(); projection.projection.tileWidth = 64; assert.throws(() => parseStorybookManifest(projection, syntheticPin), /projection/);
  let calls = 0; const getter = v2();
  Object.defineProperty(getter.atlas, 'pixelsPerUnit', {enumerable: true, get() {calls++; return 2;}});
  assert.throws(() => parseStorybookManifest(getter, syntheticPin), /atlas.pixelsPerUnit/); assert.equal(calls, 0);
});
test('2x and 3x source geometry retains logical extents, foot, origin and four-way occupancy', () => {
  const footprint = {x: -3.25, y: 10.125, width: 1, height: 1};
  const base = original.manifest.assets.find(a => a.id === 'resident-route')!;
  for (const density of [1, 2, 3]) {
    const atlas = densityAtlas(original, density), asset = atlas.manifest.assets.find(a => a.id === base.id)!;
    for (const direction of ['north', 'east', 'south', 'west'] as const) {
      const plain = placeStorybookAsset(footprint, base, storybookFacing(direction));
      const scaled = placeStorybookAsset(footprint, asset, storybookFacing(direction), density);
      assert.deepEqual(scaled.worldFoot, plain.worldFoot); assert.deepEqual(scaled.position, plain.position);
      assert.deepEqual(scaled.origin, plain.origin); assert.deepEqual(scaled.topLeft, plain.topLeft); assert.deepEqual(scaled.size, plain.size);
      assert.equal(scaled.scale, 1 / density); assert.deepEqual(asset.footprint, base.footprint); assert.deepEqual(asset.groundAnchor, base.groundAnchor);
    }
  }
  const frame = {rect: {x: 2, y: 3, width: 67, height: 101}, foot: {x: 32.5, y: 100.5}};
  const placed = placeStorybookFrame(footprint, {x: .5, y: .5}, frame, 2);
  assert.deepEqual(placed.size, {width: 33.5, height: 50.5});
  assert.equal(placed.topLeft.x + frame.foot.x / 2, placed.position.x); assert.equal(placed.topLeft.y + frame.foot.y / 2, placed.position.y);
  for (const bad of [0, -1, 1.5, 9, Infinity, NaN]) assert.throws(() => placeStorybookFrame(footprint, {x: .5, y: .5}, frame, bad), /density/);
});
test('plan density never changes ground tiles, buildings, markers, movement, depth or world data', () => {
  const s = fixture(), r = s.world.residents[0];
  r.at = {x: 30, y: 30}; r.activity = {action: {type: 'wait', minutes: 1}, target: {x: 31, y: 30}, path: [{x: 31, y: 30}], travelProgress: .25, startedAt: 0, remaining: 1, planId: 'synthetic-density', definition: 'action/routine@1'};
  const before = JSON.stringify(s), plan = buildStorybookPlan(s, original, bounds);
  assert.ok(plan.draws.some(d => d.assetId === 'resident-route')); assert.ok(plan.draws.some(d => d.layer === 'roof')); assert.ok(plan.draws.some(d => d.layer === 'marker'));
  for (const density of [1, 2, 3]) {
    const scaled = buildStorybookPlan(s, densityAtlas(original, density), bounds);
    assert.equal(scaled.draws.length, plan.draws.length);
    for (const [i, draw] of scaled.draws.entries()) {
      const {frame: _frame, scale: _scale, ...logical} = draw, {frame: _oldFrame, scale: _oldScale, ...old} = plan.draws[i];
      assert.deepEqual(logical, old); assert.equal(draw.scale, 1 / density);
    }
    assert.deepEqual(scaled.overlaps, plan.overlaps); assert.deepEqual(scaled.cycleBreaks, plan.cycleBreaks);
  }
  assert.equal(JSON.stringify(s), before);
});
test('source alpha holes and first/last texel hits remain equal at 1x/2x/3x and fractional camera zoom', () => {
  const s = fixture(), base = buildStorybookPlan(s, original, bounds);
  const draw = base.draws.find(d => d.selection?.id === 'lin')!, r = draw.frame.rect;
  const pixels = new Uint8ClampedArray(original.pixels.length);
  for (const [x, y, alpha] of [[0, 0, 255], [r.width - 1, r.height - 1, 1], [15, 20, 128]]) pixels[((r.y + y) * original.width + r.x + x) * 4 + 3] = alpha;
  const marked = {...original, pixels};
  for (const density of [1, 2, 3]) {
    const atlas = densityAtlas(marked, density), p = buildStorybookPlan(s, atlas, bounds), d = p.draws.find(v => v.key === draw.key)!;
    const isolated = {...p, draws: [d]};
    for (const zoom of [.3, 1, 2.75]) {
      const camera = {origin: {x: 123.45, y: -81.23}, zoom};
      const pick = (x: number, y: number) => pickStorybookPlan(isolated, atlas, {
        x: (d.topLeft.x + x) * zoom + camera.origin.x, y: (d.topLeft.y + y) * zoom + camera.origin.y,
      }, camera)?.selection?.id ?? null;
      for (const [x, y] of [[.1, .1], [r.width - .1, r.height - .1], [15.25, 20.75]]) assert.equal(pick(x, y), 'lin');
      for (const [x, y] of [[1.5, .5], [-.01, .5], [.5, -.01], [r.width + .01, r.height - .5], [r.width - .5, r.height + .01]]) assert.equal(pick(x, y), null);
    }
  }
});
test('v2 texture hash/header/decode still use source bytes and source dimensions', async () => {
  const atlas = densityAtlas(original, 2), png = encodeRgbaPng({width: atlas.width, height: atlas.height, pixels: new Uint8Array(atlas.pixels)});
  const metadata = {...atlas.manifest, atlas: {...atlas.manifest.atlas, sha256: sha256(png)}};
  const texture = await prepareStorybookAtlas(metadata, syntheticPin, png, async bytes => {
    const decoded = decodeRgbaPng(bytes); return {...decoded, pixels: new Uint8ClampedArray(decoded.pixels)};
  });
  assert.equal(storybookPixelsPerUnit(texture.manifest), 2); assert.equal(texture.width, original.width * 2); assert.deepEqual(texture.pixels, atlas.pixels);
  await assert.rejects(prepareStorybookAtlas({...metadata, atlas: {...metadata.atlas, width: atlas.width + 1}}, syntheticPin, png), /png_dimensions/);
});
