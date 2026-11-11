/** Repository-only pixel evidence. No browser/IPC, saved world, server or model. */
import {writeFileSync,readFileSync,mkdirSync,lstatSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isometricResidentsFixture} from './isometric-residents-fixture.js';
import {prepareIsometricResidents,type IsometricResidentRecord} from '../src/client/isometric-residents.js';
import {rasterIsometricStudy,type IsometricStudy,type StudyObject} from '../src/client/isometric-study.js';
import {projectIsometric} from '../src/client/isometric-projection.js';
import {Pixels} from '../src/client/isometric-pixels.js';
const directory=fileURLToPath(new URL('../output/isometric-residents/',import.meta.url));
for(const url of [new URL('../output/',import.meta.url),new URL('../output/isometric-residents/',import.meta.url)]){
 try{mkdirSync(url,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const info=lstatSync(url);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe_resident_evidence_directory');
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
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('tEXt',Buffer.from('Description\0Synthetic resident contact sheet; re-laid-out art for inspection, not world positions or a browser screenshot.')),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const f=isometricResidentsFixture(),outdoor=prepareIsometricResidents(f.world),indoor=prepareIsometricResidents(f.world,{roomId:f.home.id,bounds:{x:0,y:0,width:f.layout.width,height:f.layout.height}});
const ids=[f.idle,f.walk,f.worker,f.baby,f.ill,f.rest,f.culture,f.hunt,f.body,f.carrier,f.patient,f.bodyCarrier,f.carriedBody,f.sleeper];
const selected=ids.map(r=>[...outdoor,...indoor].find(x=>x.id===r.id&&x.kind==='render')! as Extract<IsometricResidentRecord,{kind:'render'}>);
if(selected.some(r=>!r||r.kind!=='render'))throw new Error('resident_contact_sheet_missing_pose');
const manifest={evidence:'Synthetic source-native contact sheet only; poses are laid out for inspection, not world positions. Not browser or model acceptance.',sourceHashes:{} as Record<string,string>,files:[] as unknown[]};
for(const name of ['src/client/isometric-residents.ts','scripts/isometric-residents-fixture.ts','scripts/render-isometric-residents.ts'])manifest.sourceHashes[name]=createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex');
for(const elapsed of [0,260,520,780]){
 const back=new Pixels(),objects:StudyObject[]=[];
 selected.forEach((r,i)=>{
  const x=44+i%7*88,y=68+Math.floor(i/7)*100,at=projectIsometric({x:r.anchor.x+.5,y:r.anchor.y+.5});
  back.rect('#d3b57d',i%7*88+5,Math.floor(i/7)*100+5,78,88);back.rect('#f0d9ac',i%7*88+6,Math.floor(i/7)*100+6,76,86);back.line('#c79e61',{x:x-22,y:y+2},{x:x+22,y:y+2});
  objects.push({key:'resident:'+r.id,subject:{kind:'resident',id:r.id,at:r.at,description:r.description},footprint:r.footprint,marks:r.marks(elapsed).map(m=>({...m,x:m.x-at.x+x,y:m.y-at.y+y}))});
 });
 const scene:IsometricStudy={width:616,height:200,camera:{origin:{x:0,y:0},zoom:1},bounds:{x:0,y:0,width:26,height:20},terrain:back.marks,objects};
 const bytes=png(scene),file=`synthetic-resident-phases-${elapsed}.png`;save(file,bytes);
 manifest.files.push({file,elapsed,sha256:createHash('sha256').update(bytes).digest('hex'),width:1848,height:600,records:selected.map((r,i)=>({cell:i+1,id:r.id,pose:r.pose,at:r.at,anchor:r.anchor,description:r.description,marks:r.marks(elapsed).length}))});
}
save('manifest.json',JSON.stringify(manifest,null,2)+'\n');
save('index.html','<!doctype html><meta charset="utf-8"><title>Synthetic resident pixel diagnostics</title><style>body{font:16px system-ui;background:#f0d9ac;color:#512807;max-width:1400px;margin:auto;padding:24px}img{width:100%;image-rendering:pixelated}li{line-height:1.6}</style><h1>居民姿态 · 源码像素合成图</h1><p>不是浏览器截图、真实存档或自主模型验收。此联系表重新排布像素以检查姿态，不表示人物实际互相位置。原坐标、ID及源码/图片哈希见 manifest.json。</p><ol>'+selected.map(r=>'<li>'+r.id+' · '+r.pose+' · '+r.description+'</li>').join('')+'</ol><p>户外睡眠安排未能核实床位，明确回退，不画成睡着。婴儿、疾病与遗体均不附加未记录床具、担架或药物。</p>'+[0,260,520,780].map(t=>`<h2>${t} ms</h2><img src="synthetic-resident-phases-${t}.png" alt="Synthetic CPU resident contact sheet, not browser screenshot">`).join(''));
console.log('Created repository-only resident pixel contact sheets: '+directory);
