// Offline, deterministic diagnostic asset generation. No external packages or images.
// Run from repository root: node --import tsx scripts/generate-storybook-synthetic-atlas.mjs
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {syntheticAtlasPixels, SYNTHETIC_WIDTH as width, SYNTHETIC_HEIGHT as height} from '../src/client/storybook-synthetic-atlas.ts';
const pixels = syntheticAtlasPixels();
const raw = Buffer.alloc(height * (1 + width * 4));
for (let y=0; y<height; y++) raw.set(pixels.subarray(y*width*4,(y+1)*width*4), y*(width*4+1)+1);
function chunk(name, data) {
  const type = Buffer.from(name), body = Buffer.concat([type,data]);
  let crc=0xffffffff;
  for (const b of body) {crc ^= b; for(let n=0;n<8;n++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const result=Buffer.alloc(data.length+12); result.writeUInt32BE(data.length); body.copy(result,4); result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4); return result;
}
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
const root = new URL('../', import.meta.url);
mkdirSync(new URL('assets/storybook/',root),{recursive:true});
writeFileSync(new URL('assets/storybook/synthetic-prototype.png',root),png);
const modulePath=new URL('src/client/storybook-synthetic-atlas.ts',root);
const source=readFileSync(modulePath,'utf8').replace(/const PNG_SHA256 = '[^']*';/,`const PNG_SHA256 = '${createHash('sha256').update(png).digest('hex')}';`).replace(/const PNG_BASE64 = '[^']*';/,`const PNG_BASE64 = '${png.toString('base64')}';`);
writeFileSync(modulePath,source);
console.log(`SYNTHETIC diagnostic PNG: ${width}×${height}, ${png.length} bytes`);
