import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {prepareStorybookAtlas, STORYBOOK_ATLAS_MAX_BYTES, type StorybookAtlasDecoder} from '../src/client/storybook-texture.js';
import {syntheticManifest, syntheticPin, syntheticAtlasBytes, syntheticAtlasPixels, SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT} from '../src/client/storybook-synthetic-atlas.js';
const memoryDecode: StorybookAtlasDecoder = async () => ({width: SYNTHETIC_WIDTH, height: SYNTHETIC_HEIGHT, pixels: syntheticAtlasPixels()});
const manifest = (): any => structuredClone(syntheticManifest);

test('SYNTHETIC atlas bytes match repository PNG, SHA256 and offline RGBA source (not browser evidence)', async () => {
  const bytes = syntheticAtlasBytes();
  assert.deepEqual(bytes, new Uint8Array(readFileSync(new URL('../assets/storybook/synthetic-prototype.png', import.meta.url))));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), syntheticManifest.atlas.sha256);
  // Independent restricted PNG decoder validates chunk CRCs and emitted filter-zero scanlines.
  const chunks: Uint8Array[] = [];
  let sawEnd = false;
  for (let offset=8; offset < bytes.length;) {
    const view: DataView = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const size: number = view.getUint32(0);
    assert.ok(offset + size + 12 <= bytes.length);
    const body = bytes.subarray(offset+4, offset+8+size);
    let crc=0xffffffff;
    for (const value of body) {crc ^= value; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    assert.equal(view.getUint32(size+8), (crc^0xffffffff)>>>0);
    const kind = String.fromCharCode(...body.subarray(0,4));
    if (kind === 'IDAT') chunks.push(body.subarray(4));
    if (kind === 'IEND') {assert.equal(offset + size + 12, bytes.length); sawEnd = true;}
    offset += size + 12;
  }
  assert.equal(sawEnd, true);
  const raw = inflateSync(Buffer.concat(chunks));
  assert.equal(raw.length, SYNTHETIC_HEIGHT * (SYNTHETIC_WIDTH * 4 + 1));
  const pixels = syntheticAtlasPixels();
  for (let y=0; y<SYNTHETIC_HEIGHT; y++) {
    const offset = y * (SYNTHETIC_WIDTH * 4 + 1);
    assert.equal(raw[offset],0);
    assert.deepEqual(new Uint8ClampedArray(raw.subarray(offset+1,offset+1+SYNTHETIC_WIDTH*4)),pixels.subarray(y*SYNTHETIC_WIDTH*4,(y+1)*SYNTHETIC_WIDTH*4));
  }
  const texture = await prepareStorybookAtlas(syntheticManifest, syntheticPin, bytes, memoryDecode);
  assert.equal(texture.frameKeys.length,16);
  assert.ok(texture.frameKeys.includes('resident-route:northwest'));
  assert.ok(Object.isFrozen(texture)); assert.ok(Object.isFrozen(texture.frameKeys)); assert.ok(Object.isFrozen(texture.manifest.assets));
  assert.match(texture.manifest.provenance.source, /SYNTHETIC/);
  assert.ok(pixels.some((v,i) => i%4 === 3 && v === 0));
  assert.ok(pixels.some((v,i) => i%4 === 3 && v === 255));
});

test('texture validates metadata, header and hash before calling injected decoder', async () => {
  const cases: [string, (m:any,b:Uint8Array)=>void][] = [
    ['declared_bounds',(m)=>m.atlas.width=2049],
    ['png_signature',(_m,b)=>b[0]=0],
    ['png_ihdr',(_m,b)=>b[11]=12],
    ['png_ihdr',(_m,b)=>b[12]=0],
    ['png_dimensions',(_m,b)=>b[19]^=1],
    ['png_format',(_m,b)=>b[25]=2],
    ['sha256_mismatch',(_m,b)=>b[b.length-1]^=1],
    ['sha256_mismatch',(m)=>m.atlas.sha256='f'.repeat(64)],
  ];
  for (const [reason, mutate] of cases) {
    const m = manifest(), b = syntheticAtlasBytes(); mutate(m,b);
    let called=false;
    await assert.rejects(prepareStorybookAtlas(m,syntheticPin,b,async()=>{called=true;return memoryDecode(b);}),new RegExp(reason));
    assert.equal(called,false);
  }
  for (const bytes of [new Uint8Array(32),new Uint8Array(STORYBOOK_ATLAS_MAX_BYTES+1)]) await assert.rejects(prepareStorybookAtlas(syntheticManifest,syntheticPin,bytes,memoryDecode),/byte_bounds/);
  await assert.rejects(prepareStorybookAtlas(syntheticManifest,{...syntheticPin,packVersion:'9.0.0'},syntheticAtlasBytes(),memoryDecode),/pin.mismatch/);
});

test('texture rejects decoded size/pixel mismatches and propagates decoder failures', async () => {
  const bytes = syntheticAtlasBytes();
  await assert.rejects(prepareStorybookAtlas(syntheticManifest,syntheticPin,bytes,async()=>({width:1,height:1,pixels:new Uint8ClampedArray(4)})),/decoded_dimensions/);
  await assert.rejects(prepareStorybookAtlas(syntheticManifest,syntheticPin,bytes,async()=>({width:SYNTHETIC_WIDTH,height:SYNTHETIC_HEIGHT,pixels:new Uint8ClampedArray(4)})),/decoded_pixels/);
  await assert.rejects(prepareStorybookAtlas(syntheticManifest,syntheticPin,bytes,async()=>{throw new Error('decode_failed');}),/decode_failed/);
});

test('async byte and decoded pixel ownership is detached; metadata cannot change after validation', async () => {
  const bytes = syntheticAtlasBytes(), m=manifest(), pixels=syntheticAtlasPixels();
  const expected = new Uint8ClampedArray(pixels);
  const pending = prepareStorybookAtlas(m,syntheticPin,bytes,async received=>{
    assert.notEqual(received,bytes);
    return {width:SYNTHETIC_WIDTH,height:SYNTHETIC_HEIGHT,pixels};
  });
  bytes.fill(0); m.atlas.sha256='f'.repeat(64); m.assets[0].id='changed';
  const texture=await pending;
  pixels.fill(0);
  assert.deepEqual(texture.pixels,expected);
  assert.equal(texture.manifest.assets[0].id,'terrain-grass');
});

test('all four route arrows are separate actual pixels; lodge anchors match 8×6 projected coordinates', () => {
  const pixels=syntheticAtlasPixels();
  const route=syntheticManifest.assets.find(a=>a.id==='resident-route')!;
  assert.equal(route.kind,'directional');
  if(route.kind!=='directional') return;
  const hashes=Object.values(route.frames).map(({rect})=>{
    const data=[];
    for(let y=rect.y;y<rect.y+rect.height;y++) for(let x=rect.x;x<rect.x+rect.width;x++) data.push(...pixels.subarray((y*SYNTHETIC_WIDTH+x)*4,(y*SYNTHETIC_WIDTH+x)*4+4));
    return createHash('sha256').update(new Uint8Array(data)).digest('hex');
  });
  assert.equal(new Set(hashes).size,4);
  for(const layer of ['contact','body','roof']) {
    const asset=syntheticManifest.assets.find(a=>a.id===`lodge-${layer}`)!;
    assert.deepEqual(asset.footprint,{width:8,height:6}); assert.deepEqual(asset.groundAnchor,{x:4,y:6});
    if(asset.kind==='static') assert.deepEqual(asset.frame.foot,{x:64,y:128});
  }
});

test('default decoder closes synthetic bitmap on success and readback failure (mock lifecycle only)', async () => {
  const {decodeStorybookPng} = await import('../src/client/storybook-texture.js');
  const bitmapDescriptor=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap');
  const documentDescriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  let closes=0, failRead=false;
  const pixels=new Uint8ClampedArray(4);
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async (blob:Blob)=>{
    assert.equal(blob.type,'image/png');
    assert.equal(blob.size,syntheticAtlasBytes().length);
    return {width:1,height:1,close:()=>closes++};
  }});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>{
    assert.equal(tag,'canvas');
    return {width:0,height:0,getContext:()=>({drawImage:()=>{},getImageData:()=>{
      if(failRead) throw new Error('readback_failed');
      return {data:pixels};
    }})};
  }}});
  try {
    assert.deepEqual(await decodeStorybookPng(syntheticAtlasBytes()),{width:1,height:1,pixels});
    assert.equal(closes,1);
    failRead=true;
    await assert.rejects(decodeStorybookPng(syntheticAtlasBytes()),/readback_failed/);
    assert.equal(closes,2);
  } finally {
    if(bitmapDescriptor) Object.defineProperty(globalThis,'createImageBitmap',bitmapDescriptor); else Reflect.deleteProperty(globalThis,'createImageBitmap');
    if(documentDescriptor) Object.defineProperty(globalThis,'document',documentDescriptor); else Reflect.deleteProperty(globalThis,'document');
  }
});
