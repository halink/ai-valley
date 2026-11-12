/** Synthetic metadata only: these tests do not authenticate C2PA or approve artwork. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeRgbaPng, inspectRgbaPngSource, pngCrc, sha256, PNG_LIMITS} from '../src/tools/storybook-png.js';
import {assembleStorybookAssets, storybookBuildFiles} from '../src/tools/storybook-asset-pipeline.js';
import {createSyntheticStorybookInput} from '../src/tools/storybook-synthetic-input.js';
function chunk(name: string, data = Buffer.from('opaque synthetic data')) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(name, 4); b.set(data, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4); return b;
}
function insert(png: Uint8Array, chunks: Uint8Array[], at = 33) {return Buffer.concat([png.subarray(0, at), ...chunks, png.subarray(at)]);}
test('explicit import preserves decoded RGBA, default decoder refuses silent provenance removal', () => {
  const f = createSyntheticStorybookInput(), original = decodeRgbaPng(f.png);
  for (const at of [33, f.png.length - 12]) {
    const bytes = insert(f.png, [chunk('caBX')], at), result = inspectRgbaPngSource(bytes);
    assert.deepEqual(result.image, original); assert.equal(result.contentCredentials?.validation, 'opaque-unverified');
    assert.equal(result.contentCredentials?.sha256, sha256(Buffer.from('opaque synthetic data')));
    assert.throws(() => decodeRgbaPng(bytes), /unsupported_chunk_caBX/);
  }
});
test('reject malformed envelopes, duplicates, unknown blocks and oversized opaque payloads', () => {
  const f = createSyntheticStorybookInput();
  const damaged = chunk('caBX'); damaged[8] ^= 1;
  const length = chunk('caBX'); length.writeUInt32BE(0xffffffff);
  for (const [chunks, error] of [
    [[damaged], /crc/], [[length], /truncated_chunk/], [[chunk('caBX'), chunk('caBX')], /duplicate_cabx/],
    [[chunk('caBX', Buffer.alloc(0))], /cabx_length/],
    [[chunk('caBX', Buffer.alloc(PNG_LIMITS.contentCredentialsBytes + 1))], /cabx_length/],
    [[chunk('caBX'), chunk('zzZZ')], /unsupported_chunk/], [[chunk('caBX'), chunk('iCCP')], /unsupported_chunk/],
    [[chunk('caBX'), chunk('acTL')], /unsupported_chunk/], [[chunk('cabX')], /chunk_name/],
  ] as const) assert.throws(() => inspectRgbaPngSource(insert(f.png, [...chunks])), error);
  const bytes = insert(f.png, [chunk('caBX')]);
  assert.throws(() => inspectRgbaPngSource(bytes.subarray(0, bytes.length - 1)), /truncated_chunk/);
  assert.throws(() => inspectRgbaPngSource(Buffer.concat([bytes, Buffer.from([0])])), /end/);
});
test('candidate retains byte-exact original and source hashes without transferring claims to atlas', () => {
  const f = createSyntheticStorybookInput(), before = assembleStorybookAssets(f.recipe, f.sources, f.recipeSha256);
  const source = f.recipe.sources[0], bytes = insert(f.sources.get(source.id)!, [chunk('caBX')]);
  source.sha256 = sha256(bytes); f.sources.set(source.id, bytes);
  const result = assembleStorybookAssets(f.recipe, f.sources, sha256(Buffer.from(JSON.stringify(f.recipe))));
  const files = storybookBuildFiles(result), name = `source-${source.sha256}.png`;
  assert.deepEqual(files.get(name), Uint8Array.from(bytes));
  assert.equal(sha256(files.get(name)!), source.sha256);
  assert.equal(result.report.sources[0].contentCredentials?.retainedOriginal, name);
  assert.deepEqual(result.png, before.png); assert.equal(inspectRgbaPngSource(result.png).contentCredentials, null);
  assert.equal(result.report.visualApproval, false); assert.equal(result.report.productionInstalled, false);
  bytes.fill(0); assert.equal(sha256(files.get(name)!), source.sha256);
});
