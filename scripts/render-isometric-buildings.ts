/** Source-native synthetic evidence, not a browser screenshot or runtime acceptance. */
import {writeFileSync,readFileSync,mkdirSync,lstatSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildingFixtureScene} from './isometric-buildings-fixture.js';
import {rasterIsometricStudy,type IsometricStudy} from '../src/client/isometric-study.js';
const directory=fileURLToPath(new URL('../output/isometric-buildings/',import.meta.url));
for(const url of [new URL('../output/',import.meta.url),new URL('../output/isometric-buildings/',import.meta.url)]){
 try{mkdirSync(url,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const info=lstatSync(url);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe_isometric_buildings_output');
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
const manifest:{evidence:string;files:unknown[];sourceHashes:Record<string,string>}={evidence:'Pure art API synthetic composition. Not browser pixels, real saves, autonomous models, or viewport runtime acceptance.',files:[],sourceHashes:{}};
for(const name of ['src/client/isometric-buildings.ts','src/client/isometric-resources.ts','src/client/isometric-pixels.ts','scripts/isometric-buildings-fixture.ts','scripts/render-isometric-buildings.ts','tests/isometric-buildings.test.ts'])manifest.sourceHashes[name]=createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex');
for(const season of ['spring','winter'] as const){
 const scene=buildingFixtureScene(season),file=`synthetic-source-buildings-${season}.png`,bytes=png(scene,2);save(file,bytes);
 manifest.files.push({file,season,sha256:createHash('sha256').update(bytes).digest('hex'),width:scene.width*2,height:scene.height*2,objects:scene.objects.map(o=>({key:o.key,at:o.subject.at,footprint:o.footprint,description:o.subject.description,marks:o.marks.length}))});
}
save('manifest.json',JSON.stringify(manifest,null,2)+'\n');
save('index.html','<!doctype html><meta charset="utf-8"><title>Synthetic isometric buildings and resources</title><style>body{background:#f0d9ac;color:#512807;font:16px system-ui;max-width:1500px;margin:auto;padding:24px}img{width:100%;image-rendering:pixelated}p{line-height:1.6}</style><h1>建筑与资源 · 源码原生合成图</h1><p>不是浏览器截图，不是实际存档或自主模型演示。以纯像素API绘制人工夹具，实际viewport接线另行测试。</p><p>地图前两排：住宅、旅舍、工坊、诊所；学校、畜舍、温室、商店。中排：condition=15诊所、condition=0住宅、石矿/浆果丛/泉各有存量与耗尽。再下一排：生长中、成熟无果、成熟有果。最前排：预留边界、基础施工、梁柱施工、局部屋顶施工。果实符号不表示逐个数量。温室没有假造作物，工坊没有假造设备，商店没有假造库存。</p>'+['spring','winter'].map(name=>`<h2>${name}</h2><img src="synthetic-source-buildings-${name}.png" alt="Synthetic source-native art, not a browser screenshot">`).join('')+'<p>原ID、足迹、坐标、源码与图像SHA-256见 manifest.json。浏览器、触控、GPU、真实快照与运行视觉仍未验收。</p>');
console.log('Created source-native synthetic diagnostics in '+directory+'; not browser screenshots.');
