/** Serve only the explicit Godot export artifacts, never the repository or .env. */
import {readFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
const types:Record<string,string>={
 'index.html':'text/html; charset=utf-8','index.js':'text/javascript; charset=utf-8',
 'index.wasm':'application/wasm','index.pck':'application/octet-stream',
 'index.png':'image/png','index.icon.png':'image/png','index.apple-touch-icon.png':'image/png',
 'index.audio.worklet.js':'text/javascript; charset=utf-8',
 'index.audio.position.worklet.js':'text/javascript; charset=utf-8',
};
export function serveGodotWeb(req:IncomingMessage,res:ServerResponse,root:string):boolean {
 if(req.method!=='GET'&&req.method!=='HEAD')return false;
 const path=(req.url??'').split('?')[0];
 const file=path==='/'?'index.html':path.slice(1);
 if(!Object.hasOwn(types,file))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const base=realpathSync(root);
  if(!existsSync(join(base,'.ready')))throw Error('export not ready');
  const target=join(base,file),stat=lstatSync(target);
  if(!stat.isFile()||stat.isSymbolicLink()||dirname(realpathSync(target))!==base)throw Error('invalid export');
  const bytes=readFileSync(target);
  res.writeHead(200,{'Content-Type':types[file],'Content-Length':bytes.length});
  res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:'Godot Web export missing. Run npm run build:godot:web first.');}
 return true;
}

/** Fail before opening a save or starting model dispatch when a browser build is absent. */
export function assertGodotWebExport(root:string):void {
 const base=realpathSync(root);
 for(const file of ['.ready','index.html','index.js','index.wasm','index.pck']){
  const target=join(base,file),stat=lstatSync(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size===0||dirname(realpathSync(target))!==base)throw Error('godot_web_export_invalid');
 }
}
