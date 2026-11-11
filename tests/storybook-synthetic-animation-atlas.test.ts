import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {syntheticManifest, syntheticAtlasPixels, SYNTHETIC_WIDTH, SYNTHETIC_HEIGHT} from '../src/client/storybook-synthetic-atlas.js';
import {syntheticAnimationManifest as manifest, syntheticAnimationCompanion as companion, syntheticAnimationAtlasBytes, syntheticAnimationAtlasPixels, bindSyntheticAnimationResident, syntheticAnimationPin, SYNTHETIC_ANIMATION_WIDTH, SYNTHETIC_ANIMATION_HEIGHT} from '../src/client/storybook-synthetic-animation-atlas.js';
import {prepareStorybookAtlas} from '../src/client/storybook-texture.js';
import {storybookAnimationFrame} from '../src/client/storybook-animation-assets.js';

// Independent restricted real PNG decoder: checks CRC, RGBA8 header, filter-zero rows,
// chunk structure and decompressed byte lengths. Not the browser decoder or visual evidence.
function decodePng(bytes: Uint8Array) {
  const b=Buffer.from(bytes); assert.deepEqual([...b.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const chunks: Buffer[]=[]; let width=0,height=0,end=false,index=0;
  for(let p=8;p<b.length;index++) {
    assert.ok(p+12<=b.length); const size=b.readUInt32BE(p);assert.ok(p+12+size<=b.length);
    const body=b.subarray(p+4,p+8+size),name=body.subarray(0,4).toString();
    let crc=0xffffffff;for(const value of body){crc^=value;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    assert.equal(b.readUInt32BE(p+8+size),(crc^0xffffffff)>>>0);
    if(index===0){assert.equal(name,'IHDR');assert.equal(size,13);width=b.readUInt32BE(p+8);height=b.readUInt32BE(p+12);assert.deepEqual([...b.subarray(p+16,p+21)],[8,6,0,0,0]);}
    else if(name==='IDAT')chunks.push(body.subarray(4));
    else {assert.equal(name,'IEND');assert.equal(size,0);assert.equal(p+12,b.length);end=true;}
    p+=size+12;
  }
  assert.ok(end);const raw=inflateSync(Buffer.concat(chunks));assert.equal(raw.length,height*(width*4+1));
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++){const p=y*(width*4+1);assert.equal(raw[p],0);pixels.set(raw.subarray(p+1,p+1+width*4),y*width*4);}
  return {width,height,pixels};
}

test('actual animation PNG, embedded bytes, JSON, hash and RGBA agree; real offline decoder feeds loader', async()=>{
  const bytes=syntheticAnimationAtlasBytes();
  assert.deepEqual(bytes,new Uint8Array(readFileSync(new URL('../assets/storybook/synthetic-animation-prototype.png',import.meta.url))));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.atlas.sha256);
  for(const [suffix,expected] of [['manifest',manifest],['animation',companion]] as const) assert.deepEqual(JSON.parse(readFileSync(new URL(`../assets/storybook/synthetic-animation-prototype.${suffix}.json`,import.meta.url),'utf8')),expected);
  const decoded=decodePng(bytes);assert.equal(decoded.width,SYNTHETIC_ANIMATION_WIDTH);assert.equal(decoded.height,SYNTHETIC_ANIMATION_HEIGHT);
  assert.deepEqual(decoded.pixels,syntheticAnimationAtlasPixels());
  const atlas=await prepareStorybookAtlas(manifest,syntheticAnimationPin,bytes,async data=>decodePng(data));
  assert.equal(atlas.frameKeys.length,64);assert.deepEqual(atlas.pixels,decoded.pixels);
  const damaged=bytes.slice();damaged[40]^=1;assert.throws(()=>decodePng(damaged));
});

test('all original terrain, marker, route and lodge geometry and pixels are preserved',()=>{
  assert.deepEqual(manifest.assets.slice(0,syntheticManifest.assets.length),syntheticManifest.assets);
  const pixels=decodePng(syntheticAnimationAtlasBytes()).pixels,original=syntheticAtlasPixels();
  for(let y=0;y<SYNTHETIC_HEIGHT;y++)assert.deepEqual(pixels.subarray(y*SYNTHETIC_ANIMATION_WIDTH*4,(y*SYNTHETIC_ANIMATION_WIDTH+SYNTHETIC_WIDTH)*4),original.subarray(y*SYNTHETIC_WIDTH*4,(y+1)*SYNTHETIC_WIDTH*4));
});

test('48 real diagnostic frames have distinct pixels, direction arrows and invariant foot contacts',()=>{
  const pixels=decodePng(syntheticAnimationAtlasBytes()).pixels,hashes=new Set<string>();
  const character=companion.characters[0];
  for(const name of ['idle','walk','pick'] as const) {
    const clip=character.clips[name]!;assert.equal(clip.cels.length,{idle:2,walk:6,pick:4}[name]);
    for(const cel of clip.cels) {
      const asset=manifest.assets.find(a=>a.id===cel.assetId)!;assert.equal(asset.kind,'directional');if(asset.kind!=='directional')throw Error('directional');
      for(const [d,frame] of Object.entries(asset.frames)) {
        assert.deepEqual(frame.foot,{x:16,y:40});assert.equal(frame.rect.width,32);assert.equal(frame.rect.height,40);
        const data=new Uint8Array(32*40*4),alpha=(x:number,y:number)=>pixels[((frame.rect.y+y)*SYNTHETIC_ANIMATION_WIDTH+frame.rect.x+x)*4+3];
        for(let y=0;y<40;y++)data.set(pixels.subarray(((frame.rect.y+y)*SYNTHETIC_ANIMATION_WIDTH+frame.rect.x)*4,((frame.rect.y+y)*SYNTHETIC_ANIMATION_WIDTH+frame.rect.x+32)*4),y*32*4);
        hashes.add(createHash('sha256').update(data).digest('hex'));
        for(let x=0;x<32;x++)assert.equal(alpha(x,39),x>=14&&x<=17?255:0);
        // Arrow tip lies in the expected projected quadrant, independently of colored cel bars.
        const sx=d==='northeast'||d==='southeast'?1:-1,sy=d==='northeast'||d==='northwest'?-1:1;
        assert.ok(Array.from({length:4},(_,i)=>alpha(16+sx*(7+i),18+sy*7)).some(a=>a===255));
        assert.equal(alpha(16-sx*9,18-sy*7),0);
      }
    }
  }
  assert.equal(hashes.size,48);
});

test('no default identity binding; caller explicitly binds one diagnostic resident without mutating exports',()=>{
  assert.deepEqual(companion.bindings,[]);assert.ok(Object.isFrozen(companion));
  const bundle=bindSyntheticAnimationResident('test-resident');assert.deepEqual(bundle.animation!.bindings,[{residentId:'test-resident',characterId:'synthetic-diagnostic-arrow'}]);
  assert.equal(storybookAnimationFrame(bundle,'other-resident','walk','north',0),null);
  assert.ok(storybookAnimationFrame(bundle,'test-resident','walk','north',0));assert.deepEqual(companion.bindings,[]);
  assert.throws(()=>bindSyntheticAnimationResident(''));assert.throws(()=>bindSyntheticAnimationResident(' trailing '));
  const bytes=syntheticAnimationAtlasBytes(),pixels=syntheticAnimationAtlasPixels();bytes.fill(0);pixels.fill(0);
  assert.notEqual(syntheticAnimationAtlasBytes()[0],0);assert.ok(syntheticAnimationAtlasPixels().some(Boolean));
});
