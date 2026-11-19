import {createServer,type Server} from 'node:http';
import type {ValleySpiritFormalArrivalHostHead,ValleySpiritFormalArrivalViewer} from './valley-spirit-formal-arrival-release.js';

const MODE='isolated-formal-arrival-loopback' as const;
const PATH='/developer/valley-spirit/formal-arrival/current';
const WORLD=/^valley-formal-(?:frontier-)?[0-9]{1,16}$/;
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
interface Options {
 readonly mode?:typeof MODE;
 readonly viewer:ValleySpiritFormalArrivalViewer;
 /** Independent fixture host authority, not derived from a request or from
  * the same release log under read. Never configure credentials here. */
 readonly hostCurrent:()=>ValleySpiritFormalArrivalHostHead|null;
}
/** Explicitly separate disposable listener, not a production/legacy/Godot
 * route or general observer. No activation hooks or upstream connections. */
export async function startValleySpiritFormalArrivalLoopback(options:Options):Promise<{
 readonly server:Server;readonly close:()=>Promise<void>;
}>{
 if(options.mode!==MODE)throw Error('formal_arrival_loopback_disabled');
 const {viewer,hostCurrent}=options;
 const server=createServer((req,res)=>{
  const unavailable=()=>{res.writeHead(404,HEADERS);res.end('{"status":"unavailable"}');};
  try{
   const address=server.address();
   if(req.method!=='GET'||req.socket.remoteAddress!=='127.0.0.1'||!req.url?.startsWith(PATH+'?')||req.url.length>256)
    return unavailable();
   // Do not serve a browser/proxy that simply points an arbitrary Host at a
   // loopback port, and never consume credentials on this fixture route.
   if(!address||typeof address==='string'||req.headers.host!=='127.0.0.1:'+address.port||
    req.headers.authorization!==undefined||req.headers.cookie!==undefined)return unavailable();
   const url=new URL(req.url,'http://127.0.0.1');
   const worldId=url.searchParams.get('worldId');
   if(url.pathname!==PATH||url.hash||url.searchParams.size!==1||!worldId||!WORLD.test(worldId))return unavailable();
   const packet=viewer.readForDeveloperLoopback(worldId,hostCurrent);
   if(!packet)return unavailable();
   const body=JSON.stringify(packet);
   res.writeHead(200,HEADERS);res.end(body);
  }catch{return unavailable();}
 });
 await new Promise<void>((resolve,reject)=>{
  const fail=(error:Error)=>reject(error);server.once('error',fail);
  server.listen(0,'127.0.0.1',()=>{server.off('error',fail);resolve();});
 });
 let closing:Promise<void>|undefined;
 return Object.freeze({server,close:()=>closing??=new Promise<void>((resolve,reject)=>{
  server.close(error=>error?reject(error):resolve());server.closeAllConnections();
 })});
}
