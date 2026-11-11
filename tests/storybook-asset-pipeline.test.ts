/** Real PNG bytes from programmatic SYNTHETIC marks only; no art or visual acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {alphaCounts, assembleStorybookAssets, parseStorybookBuildRecipe, storybookBuildFiles, validateStorybookAtlas} from '../src/tools/storybook-asset-pipeline.js';
import {decodeRgbaPng, encodeRgbaPng, pngCrc, sha256} from '../src/tools/storybook-png.js';
import {createSyntheticStorybookInput} from '../src/tools/storybook-synthetic-input.js';
import {runStorybookAssetCli} from '../src/tools/storybook-asset-files.js';

const fixture = createSyntheticStorybookInput;
function altered(change: (r: any) => void) {const f = fixture(); change(f.recipe); return () => assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256);}
function chunk(type: string, data: Uint8Array) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); b.set(data, 8); b.writeUInt32BE(pngCrc(b.subarray(4, b.length - 4)), b.length - 4); return b;
}
function pngWithRaw(raw: Uint8Array, width = 2, height = 1, headerChange?: (h: Buffer) => void) {
  const h = Buffer.alloc(13); h.writeUInt32BE(width); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 6; headerChange?.(h);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('synthetic 80-cell first batch builds unchanged strict v1 plus optional companion and registered layers', () => {
  const f = fixture(), before = JSON.stringify(f.recipe), pngBefore = Buffer.from(f.png), r = assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256);
  assert.equal(r.report.animationFrameCount, 80); assert.equal(r.animation!.characters.length, 2); assert.equal(r.animation!.characters.filter(c => c.clips.pick).length, 1);
  assert.equal(r.report.buildings.length, 1); assert.equal(r.report.placements.length, 84); assert.deepEqual(r.animation!.bindings, []);
  assert.equal(r.report.visualApproval, false); assert.equal(r.report.productionInstalled, false); assert.equal(r.report.purpose, 'synthetic-diagnostic');
  assert.deepEqual(r.report.duplicatePixels, []); assert.equal(r.manifest.atlas.sha256, sha256(r.png));
  assert.equal(r.manifest.atlas.width, 256); assert.equal(r.manifest.atlas.height, 134);
  assert.equal(JSON.stringify(f.recipe), before); assert.deepEqual(f.png, pngBefore);
  assert.deepEqual(validateStorybookAtlas(r.png, r.manifest, r.animation, {packId: r.manifest.packId, packVersion: r.manifest.packVersion}), {manifest: r.manifest, animation: r.animation});
});
test('complete deterministic rebuild has byte-identical PNG, manifest, animation and source receipt', () => {
  const f = fixture(), a = storybookBuildFiles(assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256)), b = storybookBuildFiles(assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256));
  assert.deepEqual([...a.keys()], ['atlas.png', 'atlas.manifest.json', 'atlas.animation.json', 'asset-build.json']);
  for (const [name, bytes] of a) assert.deepEqual(bytes, b.get(name));
});
test('every packed pixel exactly matches its declared source offset; padding stays transparent', () => {
  const f = fixture(), r = assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256), source = decodeRgbaPng(f.png), atlas = decodeRgbaPng(r.png);
  const occupied = new Set<number>();
  for (const p of r.report.placements) {
    const src = p.sourceRect, dst = p.atlasRect;
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const si = ((src.y + y) * source.width + src.x + x) * 4, di = ((dst.y + y) * atlas.width + dst.x + x) * 4;
      assert.deepEqual(atlas.pixels.subarray(di, di + 4), source.pixels.subarray(si, si + 4)); assert.ok(!occupied.has(di)); occupied.add(di);
    }
    assert.ok(p.alpha.transparent > 0); assert.ok(p.alpha.partial + p.alpha.opaque > 0);
  }
  for (let i = 0; i < atlas.pixels.length; i += 4) if (!occupied.has(i)) assert.deepEqual([...atlas.pixels.subarray(i, i + 4)], [0, 0, 0, 0]);
});
test('world-direction mapping is explicit and foot geometry stays stable after arbitrary atlas placement', () => {
  const f = fixture(), r = assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256);
  assert.deepEqual(r.report.directionMapping, {north: 'northeast', east: 'southeast', south: 'southwest', west: 'northwest'});
  for (const a of r.manifest.assets) if (a.kind === 'directional') for (const frame of Object.values(a.frames)) assert.deepEqual([frame.rect.width, frame.rect.height, frame.foot], [16, 20, {x: 8, y: 20}]);
});
for (const [label, change, error] of [
  ['missing direction', (r: any) => {delete r.assets[0].frames.north;}, /keys/],
  ['screen aliases', (r: any) => {r.assets[0].frames.left = r.assets[0].frames.north;}, /keys/],
  ['wrong idle count', (r: any) => {r.characters[0].clips.idle.cels.pop();}, /cels/],
  ['wrong walking speed', (r: any) => {r.characters[0].clips.walk.cels[0].durationMs = 20;}, /durationMs/],
  ['unstable foot between clips', (r: any) => {r.assets[3].frames.north.foot.x++;}, /canvas_or_foot/],
  ['unstable canvas between directions', (r: any) => {r.assets[0].frames.north.rect.width--;}, /canvas_or_foot/],
  ['same cell reused', (r: any) => {r.assets[0].frames.east.rect = {...r.assets[0].frames.north.rect};}, /source_frame_overlap/],
  ['partial cell overlap', (r: any) => {r.assets[0].frames.east.rect.x--;}, /source_frame_overlap/],
  ['out of source bounds', (r: any) => {r.assets[0].frames.north.rect.x = 127;}, /bounds/],
  ['missing license', (r: any) => {r.sources[0].authorization.license = '';}, /license/],
  ['missing permission reference', (r: any) => {r.sources[0].authorization.reference = '';}, /reference/],
  ['concept role', (r: any) => {r.sources[0].role = 'concept-reference';}, /role/],
  ['protected design path', (r: any) => {r.sources[0].path = 'docs/design/assets/storybook-valley-concept-v1.png';}, /path/],
  ['mirror instruction', (r: any) => {r.assets[0].frames.east.flipX = true;}, /keys/],
  ['insufficient atlas', (r: any) => {r.atlas.maxHeight = 40;}, /atlas_capacity/],
  ['too large atlas', (r: any) => {r.atlas.width = 4096;}, /atlas.width/],
  ['no padding', (r: any) => {r.atlas.padding = 0;}, /padding/],
  ['unregistered roof', (r: any) => {r.assets.find((a: any) => a.id === 'synthetic-roof').frame.foot.x++;}, /building_layer_registration/],
  ['unknown building layer', (r: any) => {r.buildings[0].layers.body = 'no-such-asset';}, /building_static_transparent_layer/],
  ['bad door point', (r: any) => {r.buildings[0].points.door.x = 999;}, /door.x/],
  ['production resident binding', (r: any) => {r.bindings = [{residentId: 'x', characterId: 'y'}];}, /keys/],
  ['synthetic mislabeled', (r: any) => {r.packId = 'final-character-art';}, /synthetic_pack_label/],
] as const) test(`rejects ${label}`, () => assert.throws(altered(change), error));
test('first batch is not only a frame total; missing building or different character count cannot pass', () => {
  assert.throws(altered(r => {r.buildings = [];}), /first_batch/);
  assert.throws(altered(r => {r.characters[1].clips.pick = r.characters[0].clips.pick;}), /character_assets.duplicate/);
});
test('real PNG byte hash and declared dimensions are checked, not trusted metadata alone', () => {
  const f = fixture(); f.sources.set('synthetic-arrows', Buffer.concat([f.png, Buffer.from([0])]));
  assert.throws(() => assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256), /source_hash/);
  assert.throws(altered(r => {r.sources[0].width++;}), /source_dimensions/);
  assert.throws(() => assembleStorybookAssets(f.recipe, new Map(), f.recipeSha256), /source_bytes_coverage/);
});
test('empty and opaque cels cannot masquerade as transparent character exports', () => {
  for (const opaque of [false, true]) {
    const f = fixture(), image = decodeRgbaPng(f.png);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) image.pixels[(y * image.width + x) * 4 + 3] = opaque ? 255 : 0;
    const bytes = encodeRgbaPng(image); f.sources.set('synthetic-arrows', bytes); f.recipe.sources[0].sha256 = sha256(bytes);
    assert.throws(() => assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256), opaque ? /requires_transparency/ : /empty_frame/);
  }
});
test('duplicate pixel content is reported instead of being called independently drawn artwork', () => {
  const f = fixture(), image = decodeRgbaPng(f.png);
  for (let y = 0; y < 20; y++) image.pixels.set(image.pixels.subarray(y * image.width * 4, (y * image.width + 16) * 4), (y * image.width + 16) * 4);
  const bytes = encodeRgbaPng(image); f.sources.set('synthetic-arrows', bytes); f.recipe.sources[0].sha256 = sha256(bytes);
  const r = assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256);
  assert.deepEqual(r.report.duplicatePixels, [{assetId: 'diagnostic-0-idle-0', direction: 'east'}]); assert.equal(r.report.visualApproval, false);
});
test('custom static-only source works without fabricating animation or first-batch completion', () => {
  const f = fixture(); f.recipe.profile = 'custom'; f.recipe.characters = []; f.recipe.assets = f.recipe.assets.filter(a => a.kind === 'static');
  const r = assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256); assert.equal(r.animation, null); assert.equal(r.report.animationFrameCount, 0);
});
test('strict JSON-like parsing rejects accessors without executing them', () => {
  const f = fixture(); let calls = 0; Object.defineProperty(f.recipe, 'purpose', {enumerable: true, get() {calls++; return 'synthetic-diagnostic';}});
  assert.throws(() => parseStorybookBuildRecipe(f.recipe)); assert.equal(calls, 0);
});
test('PNG all five filters reconstruct actual RGBA pixels including partial alpha', () => {
  const width = 3, height = 5, stride = width * 4, raw = Buffer.alloc(height * (stride + 1));
  const target = Uint8Array.from({length: width * height * 4}, (_, i) => i * 37 % 256);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = y;
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= 4 ? target[at - 4] : 0, b = y ? target[at - stride] : 0, c = y && x >= 4 ? target[at - stride - 4] : 0;
      const p = a + b - c, ds = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const prediction = y === 0 ? 0 : y === 1 ? a : y === 2 ? b : y === 3 ? Math.floor((a + b) / 2) : ds[0] <= ds[1] && ds[0] <= ds[2] ? a : ds[1] <= ds[2] ? b : c;
      raw[y * (stride + 1) + x + 1] = (target[at] - prediction) & 255;
    }
  }
  assert.deepEqual(decodeRgbaPng(pngWithRaw(raw, width, height)).pixels, target);
  assert.equal(Object.values(alphaCounts(target)).reduce((a, b) => a + b, 0), width * height);
});
test('PNG refuses CRC damage, extra bytes, invalid filters, unsupported format and inflated size mismatch', () => {
  const f = fixture(), damaged = Buffer.from(f.png); damaged[45] ^= 1;
  assert.throws(() => decodeRgbaPng(damaged), /crc/);
  assert.throws(() => decodeRgbaPng(Buffer.concat([f.png, Buffer.from([0])])), /end/);
  assert.throws(() => decodeRgbaPng(pngWithRaw(Buffer.alloc(9), 2, 1, h => {h[9] = 2;})), /requires_rgba8/);
  assert.throws(() => decodeRgbaPng(pngWithRaw(Buffer.alloc(9), 2, 1, h => {h[12] = 1;})), /requires_rgba8/);
  assert.throws(() => decodeRgbaPng(pngWithRaw(Buffer.from([5, 0, 0, 0, 0, 0, 0, 0, 0]))), /filter/);
  assert.throws(() => decodeRgbaPng(pngWithRaw(Buffer.alloc(8))), /scanline_length/);
  assert.throws(() => decodeRgbaPng(pngWithRaw(Buffer.alloc(1000))), /inflate/);
});

function onDisk(run: (root: string, f: ReturnType<typeof fixture>, args: (mode: string) => string[]) => void) {
  const root = mkdtempSync(join(testTmpdir(), 'storybook-pipeline-')), f = fixture();
  try {
    mkdirSync(join(root, 'input')); writeFileSync(join(root, 'input', 'recipe.json'), f.recipeBytes); writeFileSync(join(root, 'input', 'synthetic-input.png'), f.png);
    run(root, f, mode => [mode, 'input/recipe.json', ...(mode === 'check' ? [] : ['output/storybook-assets/synthetic-run']), `--approved-manifest-sha256=${f.recipeSha256}`]);
  } finally {rmSync(root, {recursive: true, force: true});}
}
test('CLI checks without writes then builds fresh candidates and verifies all four files by deterministic rebuild', () => onDisk((root, f, args) => {
  const check = JSON.parse(runStorybookAssetCli(args('check'), root)); assert.equal(check.animationFrameCount, 80); assert.ok(!existsSync(join(root, 'output')));
  runStorybookAssetCli(args('build'), root); const path = join(root, 'output/storybook-assets/synthetic-run');
  assert.equal(JSON.parse(readFileSync(join(path, 'asset-build.json'), 'utf8')).recipeSha256, f.recipeSha256);
  assert.equal(JSON.parse(runStorybookAssetCli(args('verify'), root)).command, 'verify');
  assert.throws(() => runStorybookAssetCli(args('build'), root), /EEXIST/);
  writeFileSync(join(path, 'atlas.manifest.json'), '{}'); assert.throws(() => runStorybookAssetCli(args('verify'), root), /rebuild_mismatch/);
}));
test('CLI wrong approval pin fails before source read and creates no output', () => onDisk((root, _f, args) => {
  rmSync(join(root, 'input/synthetic-input.png'));
  const argv = args('build'); argv[3] = `--approved-manifest-sha256=${'0'.repeat(64)}`;
  assert.throws(() => runStorybookAssetCli(argv, root), /approved_manifest_hash_mismatch/); assert.ok(!existsSync(join(root, 'output')));
}));
test('CLI never overwrites runtime assets and rejects input/output symlink ancestors', () => onDisk((root, _f, args) => {
  const argv = args('build'); argv[2] = 'assets/storybook/final'; assert.throws(() => runStorybookAssetCli(argv, root), /output_requires_new_candidate/);
  mkdirSync(join(root, 'safe')); symlinkSync(join(root, 'safe'), join(root, 'output'), 'dir');
  assert.throws(() => runStorybookAssetCli(args('build'), root), /unsafe_directory/); assert.ok(!existsSync(join(root, 'safe/storybook-assets')));
  rmSync(join(root, 'input/synthetic-input.png')); symlinkSync(join(root, 'input/recipe.json'), join(root, 'input/synthetic-input.png'));
  assert.throws(() => runStorybookAssetCli(args('check'), root), /unsafe_input_file/);
}));
test('default clients, worlds and synthetic committed art are not linked to the offline production tool', () => {
  for (const file of ['main', 'development-preview', 'storybook-development-entry', 'storybook-assets', 'storybook-animation-assets'])
    assert.doesNotMatch(readFileSync(new URL(`../src/client/${file}.ts`, import.meta.url), 'utf8'), /tools\/storybook|storybook-asset-pipeline/);
});
