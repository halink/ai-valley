/** Synthetic source pixels only, never browser/GPU or autonomous-model evidence. */
import {writeFileSync,readFileSync,mkdirSync,lstatSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isometricWorkshopRoute} from './isometric-workshop-route.js';
import {IsometricHomeInterior,homeInteriorSupport,fitRoomCamera} from '../src/client/isometric-interior.js';
import {rasterIsometricStudy,type IsometricStudy} from '../src/client/isometric-study.js';

const directory=fileURLToPath(new URL('../output/isometric-workshop-crafting/',import.meta.url));
for(const url of [new URL('../output/',import.meta.url),new URL('../output/isometric-workshop-crafting/',import.meta.url)]){
 try{mkdirSync(url,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const info=lstatSync(url);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe_workshop_art_output');
}
const save=(name:string,data:string|Buffer)=>writeFileSync(directory+'/'+name,data,{flag:constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,mode:0o600});
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
function crc32(buffer:Buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);}
function png(scene:IsometricStudy,scale:number){
 const source=rasterIsometricStudy(scene),width=scene.width*scale,height=scene.height*scale,rows=Buffer.alloc((width*4+1)*height),head=Buffer.alloc(13);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const si=(Math.floor(y/scale)*scene.width+Math.floor(x/scale))*4,di=y*(width*4+1)+1+x*4;
  rows[di]=source[si+3]?source[si]:0xf0;rows[di+1]=source[si+3]?source[si+1]:0xd9;rows[di+2]=source[si+3]?source[si+2]:0xac;rows[di+3]=255;
 }
 head.writeUInt32BE(width,0);head.writeUInt32BE(height,4);head[8]=8;head[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('tEXt',Buffer.from('Description\0Synthetic source-native ordinary-engine workshop pixels; not a browser or live screenshot.')),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const route=isometricWorkshopRoute(),snapshot=route.snapshots[route.labels.indexOf('craft:working')],support=homeInteriorSupport(snapshot.world,route.buildingId);
if(!support.supported)throw new Error(support.reason);
const person=snapshot.world.residents.find(r=>r.id===route.personId)!,view=new IsometricHomeInterior();view.accept(snapshot,route.buildingId);
const manifest={evidence:'Synthetic ordinary-engine snapshot, source-native raster only. No browser/touch/GPU/live/model acceptance.',provenance:route.provenance,sourceHashes:{} as Record<string,string>,files:[] as unknown[]};
for(const name of ['src/client/isometric-crafting.ts','src/client/isometric-interior.ts','src/client/isometric-preview.ts','scripts/isometric-workshop-route.ts','scripts/render-isometric-workshop.ts'])manifest.sourceHashes[name]=hash(readFileSync(new URL('../'+name,import.meta.url)));
for(const [name,time,close] of [['room',0,false],['craft-0',0,true],['craft-1',280,true],['craft-2',560,true],['craft-3',840,true]] as const){
 const width=close?128:720,height=close?128:480,scale=close?4:2,at=close?{x:person.roomAt!.x+.5,y:person.roomAt!.y+.5}:null;
 const scene=view.render(fitRoomCamera(support.layout,at,width,height,1),width,height,time),bytes=png(scene,scale),file='synthetic-workshop-'+name+'.png';save(file,bytes);
 manifest.files.push({file,sha256:hash(bytes),minute:snapshot.world.minute,elapsed:time,width:scene.width*scale,height:scene.height*scale,objects:scene.objects.map(o=>({key:o.key,at:o.subject.at,roomId:o.subject.roomId,description:o.subject.description,placeholder:o.subject.placeholder})),stats:view.stats});
}
save('manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Created synthetic source-native workshop diagnostics in '+directory+'; not browser screenshots.');
