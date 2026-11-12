/** Offline calibration contracts, not browser, resident or aesthetic acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {SLICE, sliceAssets, sliceGroundCorners, slicePoint, SLICE_STATIONS} from '../src/client/storybook-slice-model.js';
import {buildSliceAssets, slicePin} from '../src/tools/storybook-slice-build.js';
import {decodeRgbaPng, sha256} from '../src/tools/storybook-png.js';
import {prepareStorybookAtlas} from '../src/client/storybook-texture.js';
import {placeStorybookAsset, projectStorybook} from '../src/client/storybook-geometry.js';
import {parseStorybookManifest, storybookPixelsPerUnit} from '../src/client/storybook-assets.js';
import {sliceDrawCommands, drawSlice} from '../src/client/storybook-slice-render.js';
const read = (file: string) => readFileSync(new URL('../' + file, import.meta.url));
const stored = read('src/client/assets/storybook/geometry-slice.png');
const raw = JSON.parse(read('src/client/assets/storybook/geometry-slice.manifest.json').toString());
const manifest = parseStorybookManifest(raw, slicePin);
const defaults = {station: 0, roof: true, guides: true, reveal: false};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('code-native asset export is deterministic and matches every committed byte', () => {
  const {png, manifest: built} = buildSliceAssets();
  assert.deepEqual(png, stored); assert.deepEqual(built, manifest);
  assert.equal(sha256(stored), manifest.atlas.sha256);
  assert.equal(storybookPixelsPerUnit(manifest), 2);
  assert.equal(manifest.atlas.width, 1728); assert.equal(manifest.atlas.height, 672);
  assert.match(manifest.provenance.source, /NOT final art/);
  assert.equal(manifest.assets.length, 5);
  assert.ok(manifest.assets.every(a => a.kind === 'static')); // no fake direction coverage
});

test('CPU decode passes the existing density texture pipeline, with browser decode explicitly untested', async () => {
  let called = 0;
  const atlas = await prepareStorybookAtlas(raw, slicePin, stored, async bytes => {
    called++; const decoded = decodeRgbaPng(bytes);
    return {...decoded, pixels: new Uint8ClampedArray(decoded.pixels)};
  });
  assert.equal(called, 1); assert.equal(atlas.width * atlas.height * 4, atlas.pixels.length);
  const changed = Buffer.from(stored); changed[changed.length - 1] ^= 1;
  await assert.rejects(prepareStorybookAtlas(raw, slicePin, changed), /sha256_mismatch/);
});

test('true 8x6 footprint edges have +/-0.5 slope without resizing 32x16 world units', () => {
  const corners = sliceGroundCorners();
  assert.deepEqual(corners, [{x: 112, y: 112}, {x: 240, y: 176}, {x: 144, y: 224}, {x: 16, y: 160}]);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    near(Math.abs((b.y - a.y) / (b.x - a.x)), .5);
  }
  near(Math.hypot(128, 64) / Math.hypot(96, 48), 8 / 6);
  assert.deepEqual(manifest.projection, {tileWidth: 32, tileHeight: 16});
  const source = read('src/world/formal-geography.ts').toString();
  assert.match(source, /kind:'lodge',at:point\(405,235\),name:'河谷共屋'/);
  // Existing 8x6 contract is corroborated without loading any saved state.
  assert.match(read('src/world/seed.ts').toString(), /building\('lodge','lodge','溪畔会馆',42,22,8,6/);
});

test('all house layers register the same foot and door, matching the figure foot at the threshold', () => {
  const layers = manifest.assets.slice(0, 3);
  const foot = slicePoint(SLICE.door.x, SLICE.door.y);
  assert.deepEqual(foot, {x: 80, y: 192});
  for (const asset of layers) {
    assert.deepEqual(asset.footprint, {width: 8, height: 6}); assert.deepEqual(asset.groundAnchor, SLICE.door);
    const placed = placeStorybookAsset({x: 0, y: 0, width: 8, height: 6}, asset, null, 2);
    assert.deepEqual(placed.position, {x: -32, y: 80}); assert.deepEqual(placed.topLeft, {x: -112, y: -112});
    assert.deepEqual(placed.frame.foot, {x: foot.x * 2, y: foot.y * 2});
    assert.deepEqual(placed.size, {width: 288, height: 256});
  }
  const commands = sliceDrawCommands(manifest, {...defaults, station: 1});
  assert.deepEqual(commands.find(c => c.id === 'slice-adult')!.position, commands.find(c => c.id === 'slice-body')!.position);
  assert.throws(() => placeStorybookAsset({x: 0, y: 0, width: 9, height: 6}, layers[0], null, 2), /asset_footprint/);
});

test('measuring silhouettes use explicit head units and door ratio without claiming anatomy or identity', () => {
  near(SLICE.doorHeight / SLICE.adultHeight, 1.25);
  near(SLICE.teenHeight / SLICE.adultHeight, .85);
  for (const [id, height, heads] of [['slice-adult', SLICE.adultHeight, SLICE.adultHeads], ['slice-teen', SLICE.teenHeight, SLICE.teenHeads]] as const) {
    const asset = sliceAssets().find(a => a.id === id)!;
    const head = asset.shapes.find(s => s.kind === 'ellipse' && s.color[3] === 255)!;
    assert.equal(head.kind, 'ellipse');
    if (head.kind !== 'ellipse') throw Error('head');
    near(head.radius.y * 2, height / heads); near(head.center.y - head.radius.y, SLICE.figureFrame.foot.y - height);
    const bottom = Math.max(...asset.shapes.filter(s => s.kind === 'polygon').flatMap(s => s.kind === 'polygon' ? s.points.map(p => p.y) : []));
    near(bottom, SLICE.figureFrame.foot.y);
  }
});

test('opaque PNG content stays within each declared frame, and no pixel touches a frame edge', () => {
  const decoded = decodeRgbaPng(stored);
  const covered = new Uint8Array(decoded.width * decoded.height);
  for (const asset of manifest.assets) {
    assert.equal(asset.kind, 'static'); if (asset.kind !== 'static') continue;
    const r = asset.frame.rect; let visible = 0;
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      const at = (r.y + y) * decoded.width + r.x + x;
      assert.equal(covered[at], 0); covered[at] = 1;
      const alpha = decoded.pixels[at * 4 + 3]; if (alpha) visible++;
      if (x < 2 || y < 2 || x >= r.width - 2 || y >= r.height - 2) assert.equal(alpha, 0, `${asset.id}: edge (${x},${y})`);
    }
    assert.ok(visible > 100);
  }
  for (let i = 0; i < covered.length; i++) if (!covered[i]) assert.equal(decoded.pixels[i * 4 + 3], 0);
});

test('the explicit behind/front stations preserve foot points and reveal only their house group', () => {
  const behind = sliceDrawCommands(manifest, {...defaults, station: 2});
  assert.ok(behind.findIndex(c => c.id === 'slice-adult') < behind.findIndex(c => c.id === 'slice-body'));
  assert.deepEqual(behind.find(c => c.id === 'slice-adult')!.worldFoot, SLICE_STATIONS[2].adult);
  const front = sliceDrawCommands(manifest, defaults);
  assert.ok(front.findIndex(c => c.id === 'slice-adult') > front.findIndex(c => c.id === 'slice-roof'));
  const reveal = sliceDrawCommands(manifest, {...defaults, station: 2, reveal: true});
  assert.deepEqual(reveal.filter(c => c.alpha !== 1).map(c => c.id), ['slice-body', 'slice-roof']);
  assert.ok(!sliceDrawCommands(manifest, {...defaults, roof: false}).some(c => c.id === 'slice-roof'));
  assert.throws(() => sliceDrawCommands(manifest, {...defaults, station: 99}), /slice_station/);
  for (const zoom of [.5, 1, 1.5]) for (const command of front) {
    near((command.topLeft.x + command.frame.foot.x / 2) * zoom, projectStorybook(command.worldFoot).x * zoom);
    near((command.topLeft.y + command.frame.foot.y / 2) * zoom, projectStorybook(command.worldFoot).y * zoom);
  }
});

test('draw is synchronous and balances canvas state on success and draw failure', () => {
  let saved = 0, restored = 0, draws = 0;
  const target = {save() {saved++;}, restore() {restored++;}, drawImage() {draws++;}};
  const context = new Proxy(target, {get(object, key) {return Reflect.get(object, key) ?? (() => {});}, set(object, key, value) {Reflect.set(object, key, value); return true;}}) as unknown as CanvasRenderingContext2D;
  drawSlice(context, {} as CanvasImageSource, manifest, defaults); assert.equal(saved, restored); assert.equal(draws, 5);
  target.drawImage = () => {throw Error('test canvas loss');};
  assert.throws(() => drawSlice(context, {} as CanvasImageSource, manifest, defaults), /test canvas loss/); assert.equal(saved, restored);
});

test('standalone entry is absent from default HTML and production graph roots', () => {
  for (const name of ['index.html', 'vite.config.ts', 'src/client/main.ts', 'src/client/scene.ts', 'src/client/development-preview.ts', 'scripts/dev-preview-web.mjs']) assert.doesNotMatch(read(name).toString(), /storybook-slice/);
  for (const name of ['src/client/storybook-slice-model.ts', 'src/client/storybook-slice-render.ts', 'src/client/storybook-slice-entry.ts']) assert.doesNotMatch(read(name).toString(), /\b(?:EventSource|WebSocket|XMLHttpRequest|localStorage|stepWorld|submitPlan|setInterval|requestAnimationFrame)\b|process\.env|from ['"].*(?:main|observer-map|server)/);
  const entry = read('src/client/storybook-slice-entry.ts').toString();
  assert.match(entry, /import\.meta\.env\.DEV/); assert.match(entry, /credentials: 'omit'/); assert.match(entry, /if \(!event.persisted\) dispose\(\)/);
  assert.match(read('storybook-slice.html').toString(), /不是正式美术/);
});
