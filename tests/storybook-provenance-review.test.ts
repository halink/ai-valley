/** Independent review: synthetic opaque metadata, no signature or art acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {inspectRgbaPngSource, pngCrc, sha256} from '../src/tools/storybook-png.js';
import {createSyntheticStorybookInput} from '../src/tools/storybook-synthetic-input.js';
import {runStorybookAssetCli} from '../src/tools/storybook-asset-files.js';
function chunk(name: string, data: Uint8Array) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(name, 4); b.set(data, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4); return b;
}
const metadata = chunk('caBX', Buffer.from('UNVERIFIED synthetic metadata'));
test('provenance review: caBX cannot split IDAT or hide a wrong-case chunk', () => {
  const f = createSyntheticStorybookInput(), png = Buffer.from(f.png), size = png.readUInt32BE(33), data = png.subarray(41, 41 + size), half = Math.floor(size / 2);
  const split = Buffer.concat([png.subarray(0, 33), chunk('IDAT', data.subarray(0, half)), metadata, chunk('IDAT', data.subarray(half)), png.subarray(45 + size)]);
  assert.throws(() => inspectRgbaPngSource(split), /noncontiguous_idat/);
  for (const name of ['caBx', 'caBX', 'cABX']) {
    const forged = chunk(name, Buffer.from('x'));
    if (name === 'caBX') forged[forged.length - 1] ^= 1;
    const invalid = Buffer.concat([png.subarray(0,33), forged, png.subarray(33)]);
    assert.throws(() => inspectRgbaPngSource(invalid), /unsupported_chunk|crc/);
  }
  assert.throws(() => inspectRgbaPngSource(Buffer.concat([png.subarray(0, 8), metadata, png.subarray(8)])), /header_first/);
});
test('provenance review: actual CLI build retains original and verify detects missing/tampered audit source', () => {
  const root = mkdtempSync(join(testTmpdir(), 'provenance-review-'));
  try {
    const f = createSyntheticStorybookInput(), png = Buffer.from(f.png), original = Buffer.concat([png.subarray(0,33),metadata,png.subarray(33)]);
    f.recipe.sources[0].sha256 = sha256(original);
    const recipe = Buffer.from(JSON.stringify(f.recipe)), approval = `--approved-manifest-sha256=${sha256(recipe)}`;
    mkdirSync(join(root, 'input')); writeFileSync(join(root, 'input/recipe.json'), recipe); writeFileSync(join(root, 'input/synthetic-input.png'), original);
    const output = 'output/storybook-assets/provenance-review', args = (mode:string) => [mode, 'input/recipe.json', output, approval];
    const built = JSON.parse(runStorybookAssetCli(args('build'), root));
    assert.equal(built.visualApproval, false); assert.equal(built.productionInstalled, false);
    const name = `source-${sha256(original)}.png`, retained = join(root, output, name);
    assert.deepEqual(readFileSync(retained), original);
    const receipt = JSON.parse(readFileSync(join(root, output, 'asset-build.json'), 'utf8'));
    assert.equal(receipt.sources[0].contentCredentials.retainedOriginal, name);
    assert.equal(receipt.sources[0].contentCredentials.validation, 'opaque-unverified');
    assert.equal(inspectRgbaPngSource(readFileSync(join(root,output,'atlas.png'))).contentCredentials, null);
    runStorybookAssetCli(args('verify'), root);
    const tampered = Buffer.from(original); tampered[45] ^= 1; writeFileSync(retained, tampered);
    assert.throws(() => runStorybookAssetCli(args('verify'), root), /rebuild_mismatch/);
    rmSync(retained); assert.throws(() => runStorybookAssetCli(args('verify'), root), /ENOENT/);
    assert.deepEqual(readFileSync(join(root,'input/synthetic-input.png')), original);
  } finally {rmSync(root, {recursive:true, force:true});}
});
