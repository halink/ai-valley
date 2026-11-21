import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

export const WEB_TYPES:Readonly<Record<string,string>>=Object.freeze({
 'index.html':'text/html; charset=utf-8','index.js':'text/javascript; charset=utf-8',
 'index.wasm':'application/wasm','index.pck':'application/octet-stream',
 'index.png':'image/png','index.icon.png':'image/png','index.apple-touch-icon.png':'image/png',
 'index.audio.worklet.js':'text/javascript; charset=utf-8',
 'index.audio.position.worklet.js':'text/javascript; charset=utf-8',
});
const required=['index.html','index.js','index.wasm','index.pck'];
const HEX=/^[0-9a-f]{64}$/,MAX_FILE=512*1024*1024,READY_MAX=4096;
const schema='valley-godot-web-artifacts/v1';
type Artifact={size:number;sha256:string};
type Stamp=ReturnType<typeof stampOf>;
function stampOf(s:import('node:fs').BigIntStats){
 return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode].join(':');
}
function stableFile(path:string,limit=MAX_FILE){
 const before=lstatSync(path,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.size<0n||before.size>BigInt(limit))throw Error('godot_web_export_invalid');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  if(stampOf(fstatSync(fd,{bigint:true}))!==stampOf(before))throw Error('godot_web_export_changed');
  const bytes=readFileSync(fd);
  if(BigInt(bytes.length)!==before.size||stampOf(fstatSync(fd,{bigint:true}))!==stampOf(before))throw Error('godot_web_export_changed');
  return {bytes,stamp:stampOf(before)};
 }finally{closeSync(fd);}
}
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const canonical=(x:unknown)=>JSON.stringify(x)+'\n';
function exact(o:unknown,keys:readonly string[]):o is Record<string,unknown>{
 return !!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
}

export function godotWebSourceDigest(project:string){
 const hash=createHash('sha256');
 let n=0;
 function visit(dir:string,relative=''){
  for(const name of readdirSync(dir).sort()){
   if(relative===''&&(name==='.godot'||name==='export_templates'))continue;
   if(name==='.'||name==='..'||name.includes('\\')||name.includes('\0'))throw Error('godot_web_source_name');
   if(++n>8192)throw Error('godot_web_source_limit');
   const p=join(dir,name),key=relative+name,s=lstatSync(p);
   if(s.isSymbolicLink())throw Error('godot_web_source_symlink');
   if(s.isDirectory())visit(p,key+'/');
   else if(s.isFile())hash.update(JSON.stringify([key,digest(stableFile(p).bytes)])+'\n');
   else throw Error('godot_web_source_type');
  }
 }
 if(realpathSync(project)!==project)throw Error('godot_web_source_scope');
 for(const needed of ['project.godot','export_presets.cfg'])if(!lstatSync(join(project,needed)).isFile())throw Error('godot_web_source_required');
 hash.update('AI Valley Godot Web source v1\n');visit(project);
 return hash.digest('hex');
}

function collectGodotWeb(root:string,sourceSha256:string,engine:string){
 if(!HEX.test(sourceSha256)||!/^4\.6\.3\.stable(?:\.[a-zA-Z0-9.-]+)?$/.test(engine))throw Error('godot_web_manifest_inputs');
 const artifacts:Record<string,Artifact>={},stamps=new Map<string,Stamp>();
 for(const file of readdirSync(root).filter(x=>Object.hasOwn(WEB_TYPES,x)).sort()){
  const {bytes,stamp}=stableFile(join(root,file));
  if(!bytes.length)throw Error('godot_web_export_empty');
  if(file==='index.html'&&!bytes.toString('utf8').includes('index.js'))throw Error('godot_web_export_html');
  artifacts[file]={size:bytes.length,sha256:digest(bytes)};stamps.set(file,stamp);
 }
 if(required.some(file=>!Object.hasOwn(artifacts,file)))throw Error('godot_web_export_required');
 return {manifest:canonical({schema,engine,preset:'Web',sourceSha256,artifacts}),stamps};
}
export function createGodotWebManifest(root:string,sourceSha256:string,engine:string){
 return collectGodotWeb(root,sourceSha256,engine).manifest;
}

export function pinGodotWebManifest(root:string,project?:string){
 const base=realpathSync(root),ready=stableFile(join(base,'.ready'),READY_MAX);
 let data:unknown;
 try{data=JSON.parse(ready.bytes.toString('utf8'));}catch{throw Error('godot_web_manifest_version');}
 if(!exact(data,['schema','engine','preset','sourceSha256','artifacts'])||data.schema!==schema||data.preset!=='Web'||
  typeof data.engine!=='string'||typeof data.sourceSha256!=='string')throw Error('godot_web_manifest_version');
 if(project!==undefined&&godotWebSourceDigest(project)!==data.sourceSha256)throw Error('godot_web_source_stale');
 const {manifest,stamps}=collectGodotWeb(base,data.sourceSha256,data.engine);
 if(ready.bytes.toString('utf8')!==manifest)throw Error('godot_web_manifest_artifacts');
 if(stableFile(join(base,'.ready'),READY_MAX).stamp!==ready.stamp)throw Error('godot_web_manifest_changed');
 return Object.freeze({base,unchanged:(file:string,opened:import('node:fs').BigIntStats)=>{
  const marker=lstatSync(join(base,'.ready'),{bigint:true});
  return marker.isFile()&&!marker.isSymbolicLink()&&stampOf(marker)===ready.stamp&&stampOf(opened)===stamps.get(file);
 }});
}
