import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {SLICE, sliceAssets, sliceGroundCorners, slicePoint, SLICE_STATIONS} from '../src/client/storybook-slice-model.js';
import {sliceDrawCommands} from '../src/client/storybook-slice-render.js';
import {parseStorybookManifest, storybookPixelsPerUnit} from '../src/client/storybook-assets.js';
import {buildSliceAssets, slicePin} from '../src/tools/storybook-slice-build.js';
import {decodeRgbaPng, sha256} from '../src/tools/storybook-png.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const bytes = read('src/client/assets/storybook/geometry-slice.png');
const manifest = parseStorybookManifest(JSON.parse(read('src/client/assets/storybook/geometry-slice.manifest.json').toString()), slicePin);
const near = (a: number,b: number) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

test('review: recorded PNG and metadata reproduce offline, with bounded 2x density', () => {
  const built = buildSliceAssets();
  assert.deepEqual(built.png, bytes);assert.deepEqual(built.manifest, manifest);
  assert.equal(sha256(bytes), manifest.atlas.sha256);
  const image = decodeRgbaPng(bytes);
  assert.equal(image.width,1728);assert.equal(image.height,672);assert.equal(storybookPixelsPerUnit(manifest),2);
  assert.ok(image.width<=2048 && image.height<=2048);
  assert.equal(manifest.assets.length,5);
  const covered = new Uint8Array(image.width*image.height);
  for (const asset of manifest.assets) {
    assert.equal(asset.kind,'static');if(asset.kind!=='static')throw Error('static required');
    const r=asset.frame.rect;let count=0;
    for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++){
      const i: number=y*image.width+x;assert.equal(covered[i],0);covered[i]=1;
      if(image.pixels[i*4+3])count++;
    }
    assert.ok(count>100,asset.id);
  }
  for(let i=0;i<covered.length;i++)if(!covered[i])assert.equal(image.pixels[i*4+3],0);
});

test('review: 8x6 ground follows both 2:1 axes and all shapes fit untrimmed frames', () => {
  const corners=sliceGroundCorners();
  assert.deepEqual(corners,[{x:112,y:112},{x:240,y:176},{x:144,y:224},{x:16,y:160}]);
  for(let i=0;i<4;i++)near(Math.abs((corners[(i+1)%4].y-corners[i].y)/(corners[(i+1)%4].x-corners[i].x)),.5);
  for(const asset of sliceAssets())for(const shape of asset.shapes){
    const points=shape.kind==='polygon'?shape.points:[{x:shape.center.x-shape.radius.x,y:shape.center.y-shape.radius.y},{x:shape.center.x+shape.radius.x,y:shape.center.y+shape.radius.y}];
    for(const p of points)assert.ok(p.x>=0 && p.y>=0 && p.x<=asset.width && p.y<=asset.height,asset.id);
  }
});

test('review: figures have exact anatomy envelopes independently of contact shadows', () => {
  for(const [id,height,heads] of [['slice-adult',56,4.5],['slice-teen',47.6,4.2]] as const){
    const asset=sliceAssets().find(a=>a.id===id)!;
    const shapes=asset.shapes.filter(s=>s.color[3]===255);
    const ys=shapes.flatMap(s=>s.kind==='polygon'?s.points.map(p=>p.y):[s.center.y-s.radius.y,s.center.y+s.radius.y]);
    near(Math.max(...ys),72);near(Math.max(...ys)-Math.min(...ys),height);
    const head=shapes.find(s=>s.kind==='ellipse')!;assert.equal(head.kind,'ellipse');if(head.kind==='ellipse')near(head.radius.y*2,height/heads);
  }
  near(SLICE.doorHeight/SLICE.adultHeight,1.25);
  const a=slicePoint(4,6,0),b=slicePoint(4,6,70);near(a.x,b.x);near(a.y-b.y,70);
});

test('review: layer anchors remain registered and explicit rear station is occluded', () => {
  for(let station=0;station<SLICE_STATIONS.length;station++)for(const roof of [false,true])for(const reveal of [false,true]){
    const commands=sliceDrawCommands(manifest,{station,roof,reveal,guides:true});
    const buildings=commands.filter(c=>['slice-contact','slice-body','slice-roof'].includes(c.id));
    for(const c of buildings){assert.deepEqual(c.worldFoot,{x:4,y:6});assert.deepEqual(c.topLeft,{x:-112,y:-112});assert.deepEqual(c.size,{width:288,height:256});}
    for(const id of ['adult','teen'] as const){const c=commands.find(c=>c.id===`slice-${id}`)!;assert.deepEqual(c.worldFoot,SLICE_STATIONS[station][id]);near(c.topLeft.y+72,c.position.y);near(c.topLeft.x+24,c.position.x);}
    const ids=commands.map(c=>c.id);assert.equal(ids.includes('slice-roof'),roof);
    assert.equal(ids.indexOf('slice-adult')<ids.indexOf('slice-body'),station===2);
    assert.equal(commands.find(c=>c.id==='slice-body')!.alpha,station===2&&reveal?.25:1);
  }
});

test('review: standalone page makes calibration limits and dev gate explicit', () => {
  const html=read('storybook-slice.html').toString(),entry=read('src/client/storybook-slice-entry.ts').toString();
  for(const label of ['不是正式美术','没有模拟世界','未绑定真实居民','不声称一般遮挡排序','output/storybook-art-slice-v1'])assert.ok(html.includes(label));
  assert.match(entry,/if \(import\.meta\.env\.DEV\)/);
  assert.match(entry,/credentials: 'omit'/);assert.match(entry,/abort\.abort\(\)/);
  assert.doesNotMatch(entry,/WebSocket|EventSource|localStorage|sessionStorage|setInterval|requestAnimationFrame/);
});

test('review: default production build excludes slice modules, atlas and HTML', async () => {
  // Explicit index.html graph, without loading configuration or any environment files.
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const result=await build({configFile:false,envFile:false,envDir:false,root:repo,base:'/ai-town/',logLevel:'silent',build:{write:false}});
  for(const bundle of Array.isArray(result)?result:[result]){
    assert.ok('output' in bundle);if(!('output' in bundle))continue;
    for(const item of bundle.output){
      assert.doesNotMatch(item.fileName,/geometry-slice|storybook-slice/);
      if(item.type==='chunk')for(const id of Object.keys(item.modules))assert.doesNotMatch(id,/geometry-slice|storybook-slice/);
    }
  }
});

test('review: bfcache retention and loading cancellation have explicit lifecycle guards', () => {
  const entry=read('src/client/storybook-slice-entry.ts').toString();
  assert.match(entry,/const pagehide = \(event: PageTransitionEvent\) => \{if \(!event.persisted\) dispose\(\);\}/);
  assert.ok(entry.indexOf("window.addEventListener('pagehide'")<entry.indexOf('await fetch('));
  assert.match(entry,/removeEventListener\('pagehide', pagehide\)/);
  assert.match(entry,/import\.meta\.hot\.dispose\(dispose\)/);
  assert.match(entry,/if \(disposed\) return dispose;/);
});

test('review: later redraw failures and canvas context loss share terminal cleanup', () => {
  const entry=read('src/client/storybook-slice-entry.ts').toString();
  assert.match(entry,/const fail = \(\) => \{[\s\S]*?if \(!disposed\)[\s\S]*?status\.setAttribute\('role', 'alert'\);[\s\S]*?dispose\(\);\s*\};/);
  assert.match(entry,/const change = \(\) => \{try \{redraw\(\); center\(\);\} catch \{fail\(\);\}\};/);
  assert.match(entry,/controls\.addEventListener\('change', change\)/);
  assert.match(entry,/window\.addEventListener\('resize', change\)/);
  assert.match(entry,/canvas\.addEventListener\('contextlost', fail\)/);
  assert.match(entry,/releases\.push\(\(\) => canvas\.removeEventListener\('contextlost', fail\)\)/);
  assert.match(entry,/catch \{fail\(\); return dispose;\}/);
  assert.match(entry,/if \(disposed \|\| !image\) return;/);
  assert.match(entry,/while \(releases\.length\) releases\.pop\(\)!\(\);/);
  assert.match(entry,/canvas\.width = 1; canvas\.height = 1; controls\.disabled = true;/);
});
