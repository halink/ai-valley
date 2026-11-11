/** Independent adversarial review. Only generated RGBA pixels and isolated project-local files. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deflateSync} from 'node:zlib';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeRgbaPng, encodeRgbaPng, pngCrc, sha256} from '../src/tools/storybook-png.js';
import {assembleStorybookAssets, parseStorybookBuildRecipe, validateStorybookAtlas} from '../src/tools/storybook-asset-pipeline.js';
import {createSyntheticStorybookInput} from '../src/tools/storybook-synthetic-input.js';
import {runStorybookAssetCli} from '../src/tools/storybook-asset-files.js';
import {storybookFacing} from '../src/client/storybook-geometry.js';

function chunk(name: string, body: Uint8Array) {
  const out = Buffer.alloc(body.length + 12); out.writeUInt32BE(body.length); out.write(name, 4); out.set(body, 8);
  out.writeUInt32BE(pngCrc(out.subarray(4, -4)), out.length - 4); return out;
}
function pngWithRaw(raw: Uint8Array, extra = Buffer.alloc(0), width = 2, height = 2) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', Buffer.concat([deflateSync(raw), extra])), chunk('IEND', Buffer.alloc(0))]);
}
function paeth(a: number, b: number, c: number) {const p = a+b-c, x = Math.abs(p-a), y = Math.abs(p-b), z = Math.abs(p-c); return x <= y && x <= z ? a : y <= z ? b : c;}

test('pipeline review: all five PNG filters preserve every RGBA byte including invisible RGB', () => {
  const pixels = Uint8Array.from([0,255,17,0, 210,4,225,160, 16,45,255,255, 200,33,0,0]);
  for (let filter = 0; filter <= 4; filter++) {
    const raw = new Uint8Array(18);
    for (let y = 0; y < 2; y++) {
      raw[y*9] = filter;
      for (let x = 0; x < 8; x++) {
        const i = y*8+x, a = x < 4 ? 0 : pixels[i-4], b = y ? pixels[i-8] : 0, c = y && x >= 4 ? pixels[i-12] : 0;
        const predictor = [0, a, b, Math.floor((a+b)/2), paeth(a,b,c)][filter];
        raw[y*9+x+1] = (pixels[i]-predictor)&255;
      }
    }
    assert.deepEqual(decodeRgbaPng(pngWithRaw(raw)).pixels, pixels);
  }
  assert.deepEqual(decodeRgbaPng(encodeRgbaPng({width:2,height:2,pixels})).pixels, pixels);
});

test('pipeline review: valid CRC does not hide trailing zlib streams, extra rows, or bad filters', () => {
  const raw = Buffer.alloc(18);
  assert.throws(() => decodeRgbaPng(pngWithRaw(raw, deflateSync(Buffer.from('trailing')))), /compressed_trailing_bytes/);
  assert.throws(() => decodeRgbaPng(pngWithRaw(Buffer.alloc(19))), /inflate|scanline_length/);
  assert.throws(() => decodeRgbaPng(pngWithRaw(Buffer.alloc(17))), /scanline_length/);
  raw[0] = 5; assert.throws(() => decodeRgbaPng(pngWithRaw(raw)), /filter/);
  const valid = encodeRgbaPng({width:1,height:1,pixels:new Uint8Array([1,2,3,255])});
  assert.throws(() => decodeRgbaPng(Buffer.concat([valid,Buffer.from([0])])), /end/);
  const corrupted = Buffer.from(valid); corrupted[corrupted.length-1] ^= 1;
  assert.throws(() => decodeRgbaPng(corrupted), /crc/);
});

test('pipeline review: atlas crops preserve exact pixels and explicit world direction mapping', () => {
  const input = createSyntheticStorybookInput(), built = assembleStorybookAssets(input.recipe,input.sources,input.recipeSha256);
  const source = decodeRgbaPng(input.png), atlas = decodeRgbaPng(built.png);
  assert.equal(built.report.animationFrameCount,80); assert.equal(built.report.placements.length,84);
  assert.equal(built.report.duplicatePixels.length,0);
  for (const placement of built.report.placements) {
    const a = placement.atlasRect, s = placement.sourceRect;
    for (let y = 0; y < a.height; y++) {
      assert.deepEqual(atlas.pixels.slice(((a.y+y)*atlas.width+a.x)*4,((a.y+y)*atlas.width+a.x+a.width)*4),
        source.pixels.slice(((s.y+y)*source.width+s.x)*4,((s.y+y)*source.width+s.x+s.width)*4));
    }
    const asset = built.manifest.assets.find(a => a.id === placement.assetId)!;
    if (placement.direction !== null) {
      assert.equal(asset.kind,'directional');
      if (asset.kind === 'directional') assert.deepEqual(asset.frames[storybookFacing(placement.direction)].rect,a);
    }
  }
  const again = assembleStorybookAssets(input.recipe,input.sources,input.recipeSha256);
  assert.deepEqual(again,built);
  input.recipe.characters[0].clips.idle.cels[0].durationMs = 60000;
  input.recipe.buildings[0].points.door.x = 0;
  assert.equal(built.animation!.characters[0].clips.idle.cels[0].durationMs,5000);
  assert.equal(built.report.buildings[0].points.door.x,8);
});

test('pipeline review: source hashes and exact map coverage cannot be bypassed by valid pixels', () => {
  const f = createSyntheticStorybookInput(), changed = Buffer.from(f.png); changed[changed.length-1] ^= 1;
  assert.throws(() => assembleStorybookAssets(f.recipe,new Map([['synthetic-arrows',changed]]),f.recipeSha256), /source_hash/);
  assert.throws(() => assembleStorybookAssets(f.recipe,new Map([...f.sources,['extra',f.png]]),f.recipeSha256), /source_bytes_coverage/);
  f.recipe.sources[0].width--;
  assert.throws(() => assembleStorybookAssets(f.recipe,f.sources,f.recipeSha256), /bounds|source_dimensions/);
});

test('pipeline review: strict shapes reject accessors without evaluating them', () => {
  const f = createSyntheticStorybookInput(); let invoked = false;
  Object.defineProperty(f.recipe.sources[0].authorization,'license',{enumerable:true,get(){invoked=true; return 'MIT';}});
  assert.throws(() => parseStorybookBuildRecipe(f.recipe), /authorization.license/); assert.equal(invoked,false);
  const second = createSyntheticStorybookInput();
  Object.defineProperty(second.recipe.assets,'extra',{value:true});
  assert.throws(() => parseStorybookBuildRecipe(second.recipe), /assets.keys/);
});

test('pipeline review: first batch cannot borrow frame references, drop pick, or drift a foot', () => {
  const f = createSyntheticStorybookInput(); f.recipe.characters[1].clips.walk.cels[0].assetId = f.recipe.characters[0].clips.walk.cels[0].assetId;
  assert.throws(() => parseStorybookBuildRecipe(f.recipe), /character_assets.duplicate/);
  const g = createSyntheticStorybookInput(); g.recipe.characters[0].clips.pick = null;
  assert.throws(() => parseStorybookBuildRecipe(g.recipe), /character_asset_coverage|first_batch/);
  const h = createSyntheticStorybookInput(); const asset = h.recipe.assets[0];
  if (asset.kind !== 'directional') throw Error('fixture'); asset.frames.west.foot.x++;
  assert.throws(() => assembleStorybookAssets(h.recipe,h.sources,h.recipeSha256), /canvas_or_foot/);
  const i = createSyntheticStorybookInput(); const roof = i.recipe.assets.find(a=>a.id==='synthetic-roof')!;
  if (roof.kind !== 'static') throw Error('fixture'); roof.groundAnchor.x++;
  assert.throws(() => parseStorybookBuildRecipe(i.recipe), /building_layer_registration/);
});

test('pipeline review: atlas validator checks actual bytes, dimensions, and nonoverlap', () => {
  const f = createSyntheticStorybookInput(), b = assembleStorybookAssets(f.recipe,f.sources,f.recipeSha256);
  const pin = {packId:b.manifest.packId,packVersion:b.manifest.packVersion};
  const modified = Buffer.from(b.png); modified[modified.length-1] ^= 1;
  assert.throws(() => validateStorybookAtlas(modified,b.manifest,b.animation,pin), /atlas_byte_hash/);
  const manifest = structuredClone(b.manifest); (manifest.atlas as {height:number}).height++;
  assert.throws(() => validateStorybookAtlas(b.png,manifest,b.animation,pin), /atlas_dimensions/);
  const overlap = structuredClone(b.manifest); const statics = overlap.assets.filter(a=>a.kind==='static');
  Object.assign(statics[1].frame.rect,statics[0].frame.rect);
  assert.throws(() => validateStorybookAtlas(b.png,overlap,b.animation,pin), /atlas_frame_overlap/);
});

function withFiles(run: (root: string, fixture: ReturnType<typeof createSyntheticStorybookInput>)=>void) {
  const parent = fileURLToPath(new URL('../output/',import.meta.url)); mkdirSync(parent,{recursive:true});
  const root = mkdtempSync(join(parent,'pipeline-independent-review-'));
  try {const f = createSyntheticStorybookInput(); writeFileSync(join(root,'recipe.json'),f.recipeBytes); writeFileSync(join(root,'synthetic-input.png'),f.png); run(root,f);}
  finally {rmSync(root,{recursive:true,force:true});}
}

test('pipeline review: CLI checks approval before touching a missing source and rejects source symlinks', () => {
  withFiles((root,f)=>{
    rmSync(join(root,'synthetic-input.png'));
    assert.throws(()=>runStorybookAssetCli(['check','recipe.json',`--approved-manifest-sha256=${'0'.repeat(64)}`],root),/approved_manifest_hash_mismatch/);
    writeFileSync(join(root,'real.png'),f.png); symlinkSync('real.png',join(root,'synthetic-input.png'));
    assert.throws(()=>runStorybookAssetCli(['check','recipe.json',`--approved-manifest-sha256=${f.recipeSha256}`],root),/unsafe_input_file/);
    assert.equal(existsSync(join(root,'output')),false);
  });
});

test('pipeline review: CLI verifies receipts, never overwrites candidates, and rejects output symlinks', () => {
  withFiles((root,f)=>{
    const output='output/storybook-assets/first', pin=`--approved-manifest-sha256=${f.recipeSha256}`;
    const result=JSON.parse(runStorybookAssetCli(['build','recipe.json',output,pin],root));
    assert.equal(result.visualApproval,false); assert.equal(result.productionInstalled,false);
    assert.doesNotThrow(()=>runStorybookAssetCli(['verify','recipe.json',output,pin],root));
    const original=readFileSync(join(root,output,'atlas.png'));
    assert.throws(()=>runStorybookAssetCli(['build','recipe.json',output,pin],root),/EEXIST/);
    assert.deepEqual(readFileSync(join(root,output,'atlas.png')),original);
    writeFileSync(join(root,output,'asset-build.json'),'{}');
    assert.throws(()=>runStorybookAssetCli(['verify','recipe.json',output,pin],root),/rebuild_mismatch.asset-build.json/);
    symlinkSync('first',join(root,'output/storybook-assets/link'));
    assert.throws(()=>runStorybookAssetCli(['verify','recipe.json','output/storybook-assets/link',pin],root),/unsafe_directory/);
    assert.throws(()=>runStorybookAssetCli(['build','recipe.json','docs/design/candidate',pin],root),/path/);
  });
});
