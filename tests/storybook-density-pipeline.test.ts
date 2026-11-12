/** Density contract tests use only programmatic SYNTHETIC cells, never reference art. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assembleStorybookAssets, parseStorybookBuildRecipe, storybookBuildFiles} from '../src/tools/storybook-asset-pipeline.js';
import {createSyntheticStorybookInput} from '../src/tools/storybook-synthetic-input.js';
import {decodeRgbaPng, sha256} from '../src/tools/storybook-png.js';

function fixture(density: number) {
  const f = createSyntheticStorybookInput();
  const recipe = {...f.recipe, buildSchemaVersion: 2, atlas: {...f.recipe.atlas, pixelsPerUnit: density}};
  return {...f, recipe};
}

test('v1 remains byte-identical to the pre-density synthetic build', () => {
  const f = createSyntheticStorybookInput();
  const files = storybookBuildFiles(assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256));
  assert.deepEqual([...files].map(([name, bytes]) => [name, sha256(bytes)]), [
    ['atlas.png', '5a142387bb1a172067403ce3e4936ebfadf0fb81add7d56de1a4c4c3d73b1435'],
    ['atlas.manifest.json', '5bc95370193225ce49adb05d77012a185ac68d67534709f3eb8beae02a4cd6bb'],
    ['atlas.animation.json', '66c833225e221c41c7d585855af32e2854746bb413102c0f4dd7819e898a61f7'],
    ['asset-build.json', 'c70ba0bf151c2cc4401695a3054da305bd0456c4592c0d5a4bd30eb5e45d8d08'],
  ]);
});

for (const density of [1, 2, 8]) test(`v2 ${density}x preserves pixels and world footprints, reports logical geometry`, () => {
  const f = fixture(density), before = JSON.stringify(f.recipe), sourceBefore = Buffer.from(f.png);
  const hash = sha256(Buffer.from(before));
  const r = assembleStorybookAssets(f.recipe, f.sources, hash);
  const old = createSyntheticStorybookInput(), v1 = assembleStorybookAssets(old.recipe, old.sources, old.recipeSha256);
  assert.equal(r.manifest.schemaVersion, 2);
  assert.equal(r.report.buildReportVersion, 2);
  assert.equal(r.report.pipelineVersion, '1.1.0');
  assert.equal(r.report.atlas.pixelsPerUnit, density);
  assert.deepEqual(r.manifest.projection, {tileWidth: 32, tileHeight: 16});
  assert.deepEqual(r.png, v1.png); // Metadata must never resample or alter the packed PNG.
  assert.equal(r.manifest.atlas.sha256, sha256(r.png));
  assert.deepEqual(r.manifest.assets, v1.manifest.assets);
  assert.deepEqual(r.animation, v1.animation);
  assert.equal(r.report.atlas.logicalWidth, r.manifest.atlas.width / density);
  assert.equal(r.report.atlas.logicalHeight, r.manifest.atlas.height / density);
  const atlas = decodeRgbaPng(r.png), source = decodeRgbaPng(f.png);
  for (const p of r.report.placements) {
    assert.ok('logicalSize' in p && 'logicalFoot' in p);
    assert.deepEqual(p.logicalSize, {width: p.sourceRect.width / density, height: p.sourceRect.height / density});
    assert.deepEqual(p.logicalFoot, {x: p.foot.x / density, y: p.foot.y / density});
    const copied = new Uint8Array(p.sourceRect.width * p.sourceRect.height * 4);
    for (let y = 0; y < p.sourceRect.height; y++) {
      const from = ((p.sourceRect.y + y) * source.width + p.sourceRect.x) * 4;
      const to: number = ((p.atlasRect.y + y) * atlas.width + p.atlasRect.x) * 4;
      const row = source.pixels.subarray(from, from + p.sourceRect.width * 4);
      assert.deepEqual(atlas.pixels.subarray(to, to + row.length), row);
      copied.set(row, y * p.sourceRect.width * 4);
    }
    assert.equal(p.pixelSha256, sha256(copied));
  }
  assert.deepEqual(r.report.buildings, f.recipe.buildings);
  for (const [i, b] of r.report.logicalBuildings!.entries()) {
    const original = f.recipe.buildings[i];
    assert.deepEqual(b.layers, original.layers);
    assert.deepEqual(b.points.door, {x: original.points.door.x / density, y: original.points.door.y / density});
    assert.deepEqual(b.points.operations, original.points.operations.map(p => ({id: p.id, x: p.x / density, y: p.y / density})));
  }
  assert.equal(JSON.stringify(f.recipe), before);
  assert.deepEqual(f.png, sourceBefore);
  assert.equal(r.report.sources[0].sha256, sha256(sourceBefore));
  assert.equal(r.report.recipeSha256, hash);
  assert.deepEqual([...storybookBuildFiles(r)], [...storybookBuildFiles(assembleStorybookAssets(f.recipe, f.sources, hash))]);
});

test('versioned recipe schemas reject missing, invalid and cross-version density metadata', () => {
  for (const value of [undefined, null, 0, -1, 1.5, 9, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '2', true]) {
    const f = fixture(2); (f.recipe.atlas as any).pixelsPerUnit = value;
    assert.throws(() => parseStorybookBuildRecipe(f.recipe), /atlas.pixelsPerUnit/);
  }
  const f = fixture(2);
  delete (f.recipe.atlas as any).pixelsPerUnit;
  assert.throws(() => parseStorybookBuildRecipe(f.recipe), /atlas.keys/);
  for (const version of [0, 3, '2']) {
    const f = fixture(2); (f.recipe as any).buildSchemaVersion = version;
    assert.throws(() => parseStorybookBuildRecipe(f.recipe), /schema_version/);
  }
  const legacy = fixture(1); legacy.recipe.buildSchemaVersion = 1;
  assert.throws(() => parseStorybookBuildRecipe(legacy.recipe), /atlas.keys/);
  const extra = fixture(2); (extra.recipe.atlas as any).scale = 2;
  assert.throws(() => parseStorybookBuildRecipe(extra.recipe), /atlas.keys/);
  let reads = 0;
  const getter = fixture(2);
  Object.defineProperty(getter.recipe.atlas, 'pixelsPerUnit', {enumerable: true, get() {reads++; return 2;}});
  assert.throws(() => parseStorybookBuildRecipe(getter.recipe), /atlas.pixelsPerUnit/);
  assert.equal(reads, 0);
});

test('v2 retains source hashes, character registration and building registration checks', () => {
  const bytes = fixture(2);
  bytes.sources.set('synthetic-arrows', Buffer.concat([bytes.png, Buffer.from([0])]));
  assert.throws(() => assembleStorybookAssets(bytes.recipe, bytes.sources, bytes.recipeSha256), /source_hash/);
  const character = fixture(2);
  const cel = character.recipe.assets[0]; assert.equal(cel.kind, 'directional');
  if (cel.kind === 'directional') cel.frames.north.foot.x++;
  assert.throws(() => assembleStorybookAssets(character.recipe, character.sources, character.recipeSha256), /canvas_or_foot/);
  const building = fixture(2);
  const roof = building.recipe.assets.find(a => a.id === 'synthetic-roof')!;
  if (roof.kind === 'static') roof.frame.foot.x++;
  assert.throws(() => assembleStorybookAssets(building.recipe, building.sources, building.recipeSha256), /building_layer_registration/);
});
