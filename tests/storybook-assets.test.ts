import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseStorybookManifest, STORYBOOK_SCHEMA_VERSION} from '../src/client/storybook-assets.js';

const pin = {packId: 'synthetic-village', packVersion: '1.2.3'};
function fixture(): any {
  const frame = {rect: {x: 0, y: 0, width: 32, height: 48}, foot: {x: 16, y: 48}};
  return {schemaVersion: 1, ...pin, projection: {tileWidth: 32, tileHeight: 16},
    atlas: {path: 'assets/storybook/synthetic/atlas.png', width: 128, height: 128, sha256: 'a'.repeat(64)},
    provenance: {source: 'Synthetic test metadata only', author: 'Test fixture', license: 'No artwork supplied'},
    assets: [
      {id: 'house', kind: 'static', footprint: {width: 2, height: 3}, groundAnchor: {x: 1, y: 2}, frame},
      {id: 'resident', kind: 'directional', footprint: {width: 1, height: 1}, groundAnchor: {x: 0.5, y: 0.5},
        frames: Object.fromEntries(['northeast', 'southeast', 'southwest', 'northwest'].map(d => [d, structuredClone(frame)]))},
    ]};
}
test('storybook: parses pinned static and exactly four directional frames', () => {
  const result = parseStorybookManifest(fixture(), pin);
  assert.equal(result.schemaVersion, STORYBOOK_SCHEMA_VERSION);
  assert.equal(result.assets[0].kind, 'static');
  assert.equal(result.assets[1].kind, 'directional');
  assert.deepEqual(result, fixture());
});
const rejects: [string, (m: any) => void][] = [
  ['unsupported schema', m => m.schemaVersion = 2],
  ['string schema', m => m.schemaVersion = '1'],
  ['pack mismatch', m => m.packId = 'other'],
  ['version mismatch', m => m.packVersion = '1.2.4'],
  ...['01.2.3', '1.2', 'v1.2.3', '1.2.3-rc.1', '1.2.3+build', '1.2.3\n'].map(v => [`version ${JSON.stringify(v)}`, (m: any) => m.packVersion = v] as [string, (m: any) => void]),
  ['wrong tile width', m => m.projection.tileWidth = 64],
  ['wrong tile height', m => m.projection.tileHeight = 32],
  ...['../atlas.png', 'assets/storybook/../atlas.png', '/assets/storybook/a.png', 'https://example.com/a.png', 'assets/storybook/a.PNG', 'assets/storybook/a.png?q=1', 'assets/storybook//a.png', 'assets/storybook/a%2fb.png', 'assets/storybook/a\\b.png', 'assets/storybook/.a.png'].map(p => [`path ${p}`, (m: any) => m.atlas.path = p] as [string, (m: any) => void]),
  ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '128'].map(v => [`atlas dimension ${v}`, (m: any) => m.atlas.width = v] as [string, (m: any) => void]),
  ['short hash', m => m.atlas.sha256 = 'a'.repeat(63)],
  ['nonhex hash', m => m.atlas.sha256 = 'g'.repeat(64)],
  ['uppercase hash', m => m.atlas.sha256 = 'A'.repeat(64)],
  ['empty source', m => m.provenance.source = ''],
  ['blank author', m => m.provenance.author = ' '],
  ['missing license', m => delete m.provenance.license],
  ['no assets', m => m.assets = []],
  ['sparse assets', m => delete m.assets[0]],
  ['duplicate IDs', m => m.assets[1].id = 'house'],
  ['invalid ID', m => m.assets[0].id = '__proto__'],
  ['unknown kind', m => m.assets[0].kind = 'animated'],
  ['missing direction', m => delete m.assets[1].frames.northeast],
  ['extra direction', m => m.assets[1].frames.north = m.assets[1].frames.northeast],
  ['fractional footprint', m => m.assets[0].footprint.width = 0.5],
  ['zero footprint', m => m.assets[0].footprint.height = 0],
  ['out of footprint anchor', m => m.assets[0].groundAnchor.x = 2.1],
  ['negative anchor', m => m.assets[0].groundAnchor.y = -1],
  ['nonfinite anchor', m => m.assets[0].groundAnchor.x = NaN],
  ['nonfinite foot', m => m.assets[0].frame.foot.x = Infinity],
  ['outside foot', m => m.assets[0].frame.foot.y = 49],
  ['negative foot', m => m.assets[0].frame.foot.x = -1],
  ['zero rect', m => m.assets[0].frame.rect.width = 0],
  ['negative rect', m => m.assets[0].frame.rect.x = -1],
  ['fractional rect', m => m.assets[0].frame.rect.y = 0.5],
  ['outside atlas', m => m.assets[0].frame.rect.x = 100],
  ['unsafe rect arithmetic', m => {m.atlas.width = Number.MAX_SAFE_INTEGER; m.assets[0].frame.rect.x = Number.MAX_SAFE_INTEGER; }],
];
for (const [name, change] of rejects) test(`storybook rejects ${name}`, () => {
  const input = fixture(); change(input);
  assert.throws(() => parseStorybookManifest(input, pin), /invalid_storybook_manifest/);
});
for (const path of ['', 'projection', 'atlas', 'provenance', 'assets.0', 'assets.0.footprint', 'assets.0.groundAnchor', 'assets.0.frame', 'assets.0.frame.rect', 'assets.0.frame.foot', 'assets.1.frames', 'assets.1.frames.northeast', 'assets.1.frames.northeast.rect', 'assets.1.frames.northeast.foot']) {
  test(`storybook rejects extra field at ${path || 'root'}`, () => {
    const input = fixture(); const target = path ? path.split('.').reduce((o, k) => o[k], input) : input;
    target.extra = true;
    assert.throws(() => parseStorybookManifest(input, pin), /invalid_storybook_manifest/);
  });
}
test('storybook requires valid explicit pin and exact pin keys', () => {
  for (const bad of [undefined, null, {}, {...pin, extra: true}, {...pin, packVersion: '01.2.3'}, {...pin, packId: ''}]) {
    assert.throws(() => parseStorybookManifest(fixture(), bad as any), /invalid_storybook_manifest/);
  }
});
test('storybook rejects nonobjects, symbols, prototypes and accessors without executing getters', () => {
  for (const bad of [null, [], 1, 'manifest', new Date(), Object.create(fixture())]) {
    assert.throws(() => parseStorybookManifest(bad, pin), /invalid_storybook_manifest/);
  }
  const symbolInput = fixture(); symbolInput[Symbol('extra')] = 1;
  assert.throws(() => parseStorybookManifest(symbolInput, pin), /invalid_storybook_manifest/);
  let calls = 0;
  for (const path of ['atlas', 'assets.0.kind', 'assets.0.frame.foot.x', 'assets.0']) {
    const input = fixture(), keys = path.split('.'), key = keys.pop()!;
    const target = keys.reduce((o, k) => o[k], input);
    Object.defineProperty(target, key, {enumerable: true, get() {calls++; throw new Error('getter executed');}});
    assert.throws(() => parseStorybookManifest(input, pin), /invalid_storybook_manifest/);
  }
  assert.equal(calls, 0);
});
test('storybook inclusive edges and fractional feet/anchors are supported', () => {
  const input = fixture();
  input.assets[0].groundAnchor = {x: 2, y: 3};
  input.assets[0].frame.foot = {x: 0.5, y: 48};
  input.assets[0].frame.rect.x = 96;
  assert.doesNotThrow(() => parseStorybookManifest(input, pin));
});
test('storybook copies deeply, freezes all output, and leaves input untouched', () => {
  const input = fixture(), before = structuredClone(input), result = parseStorybookManifest(input, pin);
  assert.deepEqual(input, before);
  function checkFrozen(value: any): void {
    if (value === null || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value)); Object.values(value).forEach(checkFrozen);
  }
  checkFrozen(result);
  assert.throws(() => (result.assets as any).push({}), TypeError);
  input.assets[0].frame.foot.x = 9;
  input.assets[1].frames.northeast.rect.width = 9;
  assert.deepEqual(result, before);
  assert.ok(!Object.isFrozen(input));
});
test('storybook module has no runtime imports, loading, browser, network, or state dependencies', () => {
  const source = readFileSync(new URL('../src/client/storybook-assets.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|Phaser|localStorage|sessionStorage|window|document|process|require)\b/);
  assert.doesNotMatch(source, /\bimport\s*\(/);
});
