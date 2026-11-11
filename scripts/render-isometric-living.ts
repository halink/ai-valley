/** Repository-only source-native diagnostics. No browser, IPC, save, server, or model. */
import {writeFileSync,readFileSync,mkdirSync,lstatSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isometricLivingFixture} from './isometric-living-fixture.js';
import {IsometricViewport,fitWorldCamera} from '../src/client/isometric-viewport.js';
import {rasterIsometricStudy,type IsometricStudy,type StudyObject} from '../src/client/isometric-study.js';
import {orderIsometricObjects} from '../src/client/isometric-projection.js';
import type {PixelMark} from '../src/client/work-art.js';
const directory=fileURLToPath(new URL('../output/isometric-living/',import.meta.url));
for(const url of [new URL('../output/',import.meta.url),new URL('../output/isometric-living/',import.meta.url)]){
 try{mkdirSync(url,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const info=lstatSync(url);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe_isometric_living_output');
}
const save=(name:string,data:string|Buffer)=>writeFileSync(directory+'/'+name,data,{flag:constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,mode:0o600});
function crc32(buffer:Buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);}
function png(scene:IsometricStudy,scale=3){
 const source=rasterIsometricStudy(scene),width=scene.width*scale,height=scene.height*scale,rows=Buffer.alloc((width*4+1)*height),head=Buffer.alloc(13);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const si=(Math.floor(y/scale)*scene.width+Math.floor(x/scale))*4,di=y*(width*4+1)+1+x*4;
  rows[di]=source[si+3]?source[si]:0xf0;rows[di+1]=source[si+3]?source[si+1]:0xd9;rows[di+2]=source[si+3]?source[si+2]:0xac;rows[di+3]=255;
 }
 head.writeUInt32BE(width,0);head.writeUInt32BE(height,4);head[8]=8;head[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('tEXt',Buffer.from('Description\0Synthetic source-native pixel composition. Not a browser or live-game screenshot. Fixture IDs only.')),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const {world,snapshot}=isometricLivingFixture(),manifest:{evidence:string;files:unknown[];sourceHashes:Record<string,string>}={evidence:'Synthetic source-native PNG only. No browser, real save, or autonomous/model acceptance.',files:[],sourceHashes:{}};
for(const name of ['src/client/isometric-living.ts','src/client/isometric-pixels.ts','src/client/isometric-viewport.ts','scripts/isometric-living-fixture.ts','scripts/render-isometric-living.ts'])manifest.sourceHashes[name]=createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex');
for(const [name,minute,elapsed] of [['day',720,0],['phase',720,300],['night',1380,300]] as const){
 world.minute=minute;const v=new IsometricViewport();v.accept({...snapshot,world});
 // Whole-fixture diagnostic stitched from the production viewport's own source-coordinate marks.
 // The optional viewer still pans bounded frames; this composition is not a full-map UI promise.
 const objects=new Map<string,StudyObject>(),terrain=new Map<string,PixelMark>();
 for(const y of [0,5,10,15,19])for(const x of [0,6,12,18,25]){
  const s=v.render(fitWorldCamera(world,{x,y},480,360),480,360,elapsed);
  for(const o of s.objects)objects.set(o.key,o);
  for(const mark of s.terrain)terrain.set(JSON.stringify(mark),mark);
 }
 const scene:IsometricStudy={width:800,height:472,camera:{origin:{x:352,y:80},zoom:1},bounds:{x:0,y:0,width:26,height:20},terrain:[...terrain.values()],objects:orderIsometricObjects([...objects.values()])};
 const file=`synthetic-source-living-${name}.png`,bytes=png(scene);save(file,bytes);
 const expected=[...world.frontierHazards!.beasts.map(b=>'beast:'+b.id),...world.industry!.animals.map(a=>'animal:'+a.id),...Object.keys(world.industry!.fishing).map(id=>'fish:'+id),...world.graves.map(g=>'grave:'+g.id)];
 if(expected.some(key=>!objects.has(key)))throw new Error('incomplete_living_art_evidence');
 manifest.files.push({file,minute,elapsed,sha256:createHash('sha256').update(bytes).digest('hex'),width:scene.width*3,height:scene.height*3,objects:scene.objects.map(o=>({key:o.key,at:o.subject.at,description:o.subject.description,placeholder:o.subject.placeholder})),stats:v.stats});
}
save('manifest.json',JSON.stringify(manifest,null,2)+'\n');
save('index.html','<!doctype html><meta charset="utf-8"><title>Synthetic isometric living art</title><style>body{background:#f0d9ac;color:#512807;font:16px system-ui;max-width:1200px;margin:auto;padding:24px}img{width:100%;image-rendering:pixelated}p{line-height:1.6}</style><h1>生灵与墓位 · 源码原生合成图</h1><p>这是测试夹具的程序像素合成，不是浏览器截图，不是实际存档或自主模型演示。上半部：六种野兽与五种家畜。右侧：七种单独鱼群与底部混合鱼群，每种一个示意符，不是逐条个体。下排：空墓位、预留、登记待葬、已安葬。相位与昼夜只改变显示。</p>'+['day','phase','night'].map(name=>`<h2>${name}</h2><img src="synthetic-source-living-${name}.png" alt="Synthetic source-native living art, not a browser screenshot">`).join('')+'<p>每个对象的原ID、坐标、图片及源码SHA-256见 manifest.json。实际浏览器、触控、GPU与真实快照接线仍待验收。</p>');
console.log('Created source-native synthetic diagnostics in '+directory+'; not browser screenshots.');
