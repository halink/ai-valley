/** Independent synthetic density review. No browser/GPU or production art acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {placeStorybookFrame} from '../src/client/storybook-geometry.js';
import {pickStorybookPlan, type StorybookPlan, type StorybookPixelAtlas, type StorybookDraw} from '../src/client/storybook-render-plan.js';

function fixture() {
  const manifest = parseStorybookManifest({schemaVersion: 2, packId: 'synthetic-review', packVersion: '1.0.0', projection: {tileWidth: 32, tileHeight: 16},
    atlas: {path: 'assets/storybook/synthetic-review.png', width: 12, height: 6, sha256: '0'.repeat(64), pixelsPerUnit: 3},
    provenance: {source: 'synthetic review', author: 'test', license: 'test'}, assets: [
      {id: 'front', kind: 'static', footprint: {width: 1, height: 1}, groundAnchor: {x: .5, y: .5}, frame: {rect: {x: 0, y: 0, width: 6, height: 6}, foot: {x: 3, y: 6}}},
      {id: 'back', kind: 'static', footprint: {width: 1, height: 1}, groundAnchor: {x: .5, y: .5}, frame: {rect: {x: 6, y: 0, width: 6, height: 6}, foot: {x: 3, y: 6}}},
    ]}, {packId: 'synthetic-review', packVersion: '1.0.0'});
  const atlas: StorybookPixelAtlas = {manifest, width: 12, height: 6, pixels: new Uint8ClampedArray(12 * 6 * 4)};
  const draws: StorybookDraw[] = manifest.assets.map((a, i): StorybookDraw => {
    if(a.kind !== 'static') throw Error('static fixture');
    return {key: a.id, assetId: a.id, frame: a.frame, facing: null, ...placeStorybookFrame({x: .5, y: .5, width: 1, height: 1}, a.groundAnchor, a.frame, 3), depth: i, layer: 'body', selection: {kind: 'person', id: a.id}, label: a.id, fallback: null};
  }).reverse();
  const plan: StorybookPlan = {worldId: 'synthetic', revision: 1, minute: 0, paused: false, bounds: {x: 0, y: 0, width: 3, height: 3}, draws, notices: [], unknownResidents: [], overlaps: [], cycleBreaks: [], omittedObjects: 0};
  const camera = {origin: {x: 123.45, y: -81.23}, zoom: .3};
  const pick = (x: number, y = 2.5) => pickStorybookPlan(plan, atlas, {x: (-1 + x / 3) * camera.zoom + camera.origin.x, y: (14 + y / 3) * camera.zoom + camera.origin.y}, camera)?.selection?.id ?? null;
  const alpha = (offset: number, x: number, value: number) => {for(let y = 0; y < 6; y++) atlas.pixels[(y * 12 + offset + x) * 4 + 3] = value;};
  return {atlas, plan, pick, alpha};
}
test('3x review: transparent foreground passes through while alpha 1 remains selectable', () => {
  const f = fixture();
  for(let x = 0; x < 6; x++) f.alpha(6, x, 255);
  f.alpha(0, 1, 1);
  assert.equal(f.pick(.5), 'back'); assert.equal(f.pick(1.5), 'front'); assert.equal(f.pick(2.5), 'back');
});
test('3x review: exact internal source-texel edge belongs to its right texel after fractional camera inversion', () => {
  const f = fixture(); f.alpha(0, 1, 255);
  assert.equal(f.pick(1), 'front');
  assert.equal(f.pick(1 - 1e-7), null);
});
test('3x review: exact right source edge is excluded after fractional camera inversion', () => {
  const f = fixture(); f.alpha(0, 5, 255);
  assert.equal(f.pick(6), null);
  assert.equal(f.pick(6 - 1e-7), 'front');
});
test('3x review: non-divisible source size and fractional feet remain fractional logical geometry', () => {
  const p = placeStorybookFrame({x: 0, y: 0, width: 1, height: 1}, {x: .5, y: .5}, {rect: {x: 0, y: 0, width: 7, height: 11}, foot: {x: 3.5, y: 10.5}}, 3);
  assert.equal(p.scale, 1 / 3); assert.ok(Math.abs(p.size.width - 7 / 3) < 1e-12); assert.ok(Math.abs(p.size.height - 11 / 3) < 1e-12);
  assert.deepEqual(p.origin, {x: .5, y: 10.5 / 11}); assert.equal(p.topLeft.y, 4.5);
});

test('3x review: exact bottom edge is excluded without swallowing nearby interior source pixels', () => {
  const f = fixture(); f.alpha(0, 2, 255);
  assert.equal(f.pick(2.5, 6), null);
  assert.equal(f.pick(2.5, 6 - 1e-7), 'front');
  assert.equal(f.pick(2.5, 6 + 1e-7), null);
});
test('3x review: exact horizontal internal edge selects lower texel, not its transparent neighbor', () => {
  const f = fixture();
  for(let x = 0; x < 6; x++) f.atlas.pixels[(1 * 12 + x) * 4 + 3] = 255;
  assert.equal(f.pick(2.5, 1), 'front');
  assert.equal(f.pick(2.5, 1 - 1e-7), null);
  assert.equal(f.pick(2.5, 1 + 1e-7), 'front');
  assert.equal(f.pick(2.5, 2), null);
});
test('3x review: corrupt scale, arithmetic overflow and missing alpha cannot select a draw', () => {
  for(const scale of [0, -1, NaN, Infinity, Number.MIN_VALUE]) {
    const f = fixture(); f.alpha(0, 1, 255);
    f.plan.draws.at(-1)!.scale = scale;
    assert.equal(f.pick(1.5), null);
  }
  const f = fixture(); f.alpha(0, 1, 255); f.atlas.pixels = new Uint8ClampedArray();
  assert.equal(f.pick(1.5), null);
});
