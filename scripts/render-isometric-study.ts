/** Offline source-native rendering, not a browser screenshot. All outputs stay in this repository. */
import {writeFileSync,mkdirSync,lstatSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {isometricStudyAnimationFixture} from './isometric-study-fixture.js';
import {renderIsometricStudy,rasterIsometricStudy,type IsometricStudy} from '../src/client/isometric-study.js';
const directory=fileURLToPath(new URL('../output/isometric-study/',import.meta.url));
for(const url of [new URL('../output/',import.meta.url),new URL('../output/isometric-study/',import.meta.url)]){
 try{mkdirSync(url,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const info=lstatSync(url);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe_isometric_output');
}
const save=(name:string,data:string|Buffer)=>writeFileSync(directory+'/'+name,data,{flag:constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,mode:0o600});
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function svg(scene:IsometricStudy){
 const marks=(list:IsometricStudy['terrain'])=>list.map(m=>`<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${m.color}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width*3}" height="${scene.height*3}" shape-rendering="crispEdges" role="img" aria-label="合成等距美术样板，不是游戏截图"><rect width="100%" height="100%" fill="#f0d9ac"/><g transform="translate(${scene.camera.origin.x} ${scene.camera.origin.y})">${marks(scene.terrain)}${scene.objects.map(o=>`<g data-subject="${escape(o.key)}"><title>${escape(o.key)}</title>${marks(o.marks)}</g>`).join('')}</g></svg>`;
}
function crc32(buffer:Buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);}
function png(scene:IsometricStudy,scale=3){
 const source=rasterIsometricStudy(scene),width=scene.width*scale,height=scene.height*scale,rows=Buffer.alloc((width*4+1)*height),head=Buffer.alloc(13);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const si=(Math.floor(y/scale)*scene.width+Math.floor(x/scale))*4,di=y*(width*4+1)+1+x*4;
  rows[di]=source[si+3]?source[si]:0xf0;rows[di+1]=source[si+3]?source[si+1]:0xd9;rows[di+2]=source[si+3]?source[si+2]:0xac;rows[di+3]=255;
 }
 head.writeUInt32BE(width,0);head.writeUInt32BE(height,4);head[8]=8;head[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const {world,bounds}=isometricStudyAnimationFixture(),times=[0,240,480,720,840,2520],frames=times.map(elapsed=>renderIsometricStudy(world,{bounds,elapsed}));
save('synthetic-isometric-study.svg',svg(frames[2]));
save('synthetic-isometric-study.png',png(frames[2]));
for(let i=0;i<frames.length;i++)save(`synthetic-phase-${i}.png`,png(frames[i]));
save('index.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>栖谷 · 等距美术样板</title><style>*{box-sizing:border-box}body{margin:0;background:#f0d9ac;color:#512807;font-family:system-ui,sans-serif}main{max-width:1152px;margin:0 auto;padding:28px 20px}small{letter-spacing:.15em}h1{margin:.4em 0;font-size:clamp(26px,4vw,42px)}p{line-height:1.6}svg{display:block;width:100%;height:auto;image-rendering:pixelated}figure{margin:0;border:1px solid #c59215;border-radius:8px;overflow:hidden}button{font:inherit;background:#ffffc6;color:#512807;border:1px solid #ab680f;border-radius:6px;padding:8px 14px;cursor:pointer}button[aria-pressed=true]{background:#693127;color:#ffffc6}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.frame[hidden]{display:none}output{display:block;min-height:3em}footer{border-top:1px solid #c59215;padding-top:12px;font-size:13px}g[data-subject]{cursor:pointer}</style><main><small>AI VALLEY · ISOMETRIC ART STUDY</small><h1>栖谷，一小片斜俯视的生活</h1><p>独立的人工动作样板：复制暂停夹具后仅开启显示相位，不推进模拟，不更改原暂停夹具或实际世界。房屋、林木、农田和水岸使用同一套像素色板；人物展示浇水、伐木与垂钓姿态。</p><figure>${frames.map((s,i)=>`<div class="frame" ${i!==2?'hidden':''}>${svg(s)}</div>`).join('')}</figure><div class="controls" aria-label="检查动作相位">${times.map((time,i)=>`<button data-phase="${i}" aria-pressed="${i===2}">${time} 毫秒</button>`).join('')}</div><output aria-live="polite">点击画面中的屋顶、树冠、人物或田地，可检查前后遮挡的命中身份。</output><footer>这不是正在运行的山谷，也不是浏览器截图。数据仅在内存中合成；按钮切换静态姿态，不推进模拟、不产生收获。正式默认视图、模拟规则和存档均未改变。真实运行画面、手机布局与运动节奏尚未完成视觉验收。动物、完整墓园、室内和全图迁移留待后续。</footer></main><script>const floor=(value,magnitude=Math.abs(value))=>{const edge=Math.round(value);return Math.floor(Math.abs(value-edge)<=Number.EPSILON*Math.max(1,Math.abs(value),magnitude)*8?edge:value);};const frames=[...document.querySelectorAll('.frame')];document.querySelectorAll('[data-phase]').forEach(button=>button.addEventListener('click',()=>{const phase=Number(button.dataset.phase);frames.forEach((frame,i)=>frame.hidden=i!==phase);document.querySelectorAll('[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}));document.querySelector('figure').addEventListener('click',event=>{const subject=event.target.closest('[data-subject]');const output=document.querySelector('output');if(subject){output.textContent='合成对象：'+subject.dataset.subject;return;}const svg=event.target.closest('svg');if(!svg){output.textContent='画外。';return;}const rect=svg.getBoundingClientRect(),sx=(event.clientX-rect.left)*${frames[0].width}/rect.width-${frames[0].camera.origin.x},sy=(event.clientY-rect.top)*${frames[0].height}/rect.height-${frames[0].camera.origin.y},magnitude=((Math.abs(event.clientX)+Math.abs(rect.left))*${frames[0].width}/rect.width+${Math.abs(frames[0].camera.origin.x)})/32+((Math.abs(event.clientY)+Math.abs(rect.top))*${frames[0].height}/rect.height+${Math.abs(frames[0].camera.origin.y)})/16,x=floor(sx/32+sy/16,magnitude),y=floor(sy/16-sx/32,magnitude);output.textContent=x>=0&&x<13&&y>=0&&y<12?'合成地表坐标：('+x+', '+y+')':'画外。';});</script></html>`);
console.log(`Synthetic static art exported to ${directory}. Browser/game visual QA was not performed.`);
