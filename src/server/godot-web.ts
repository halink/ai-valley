/** Serve only the explicit Godot export artifacts, never the repository or .env. */
import {createReadStream,openSync,closeSync,fstatSync,constants,lstatSync,realpathSync} from 'node:fs';
import {pipeline} from 'node:stream';
import {join,dirname} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {fileURLToPath} from 'node:url';
import {WEB_TYPES as types,pinGodotWebManifest} from './godot-web-provenance.js';
const repoProject=fileURLToPath(new URL('../../godot-client',import.meta.url));
export type GodotWebExport=ReturnType<typeof pinGodotWebManifest>;
const verified=new WeakSet<GodotWebExport>();
export function ownsGodotWebExport(pin:GodotWebExport){return verified.has(pin);}
export function serveGodotWeb(req:IncomingMessage,res:ServerResponse,pinned:GodotWebExport):boolean {
 if(req.method!=='GET'&&req.method!=='HEAD')return false;
 const path=(req.url??'').split('?')[0];
 const file=path==='/'?'index.html':path.slice(1);
 if(!Object.hasOwn(types,file))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 let fd:number|undefined;
 try{
  if(!ownsGodotWebExport(pinned))throw Error('godot_web_export_unverified');
  const base=pinned.base;
  const target=join(base,file),stat=lstatSync(target,{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink()||dirname(realpathSync(target))!==base)throw Error('invalid export');
  fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
  const opened=fstatSync(fd,{bigint:true});
  if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||!pinned.unchanged(file,opened))throw Error('export changed');
  res.writeHead(200,{'Content-Type':types[file],'Content-Length':String(opened.size)});
  if(req.method==='HEAD'){
   closeSync(fd);fd=undefined;res.end();
  }else{
   // WASM/PCK can be large. Stream with backpressure rather than synchronously
   // loading the entire asset on the world simulation's event loop.
   const stream=createReadStream(target,{fd,autoClose:true});fd=undefined;
   pipeline(stream,res,error=>{if(error)res.destroy();});
  }
 }catch{
  if(fd!==undefined)closeSync(fd);
  if(res.headersSent){res.destroy();return true;}
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:'Godot Web export missing. Run npm run build:godot:web first.');
 }
 return true;
}

/** Fail before opening a save or starting model dispatch when a browser build is absent. */
export function assertGodotWebExport(root:string):GodotWebExport {
 let project:string|undefined;
 try{
  if(!lstatSync(repoProject).isDirectory())throw Error('godot_web_source_scope');
  project=repoProject;
 }catch(error){
  // Published release tarballs intentionally carry build/package/output, not Godot sources.
  if((error as NodeJS.ErrnoException).code!=='ENOENT'||import.meta.url.endsWith('.ts'))throw error;
 }
 const pin=pinGodotWebManifest(root,project);verified.add(pin);return pin;
}
