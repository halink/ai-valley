/** Paused, synthetic GET/SSE source. No store, credentials, model or simulation loop. */
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {pathToFileURL} from 'node:url';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {observerFrame} from '../src/server/observer-feed.js';
import type {Snapshot} from '../src/shared/types.js';
export function observerPreviewSnapshot():Snapshot {
 const world=createFrontierWorld(5401);world.clock.paused=true;
 return {world,mapRevision:world.id,serverTime:new Date().toISOString(),version:'synthetic-observer-preview',capabilities:{active:[],pending:['Paused synthetic observer source; not autonomous model behavior']}};
}
export function observerPreviewHandler(snapshot:Snapshot){
 const encoded=JSON.stringify(snapshot),frame=JSON.stringify(observerFrame(snapshot));
 return (request:IncomingMessage,response:ServerResponse)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
  if(request.method!=='GET'){response.writeHead(405,{'Allow':'GET','Content-Type':'application/json'});response.end('{"error":"read_only_synthetic_preview"}');return;}
  const path=(request.url??'').split('?')[0];
  if(path==='/ai-town/api/world'){response.writeHead(200,{'Content-Type':'application/json'});response.end(encoded);return;}
  if(path==='/ai-town/api/events'){
   response.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});response.write(`event: update\ndata: ${frame}\n\n`);
   const heartbeat=setInterval(()=>response.write(': paused synthetic preview\n\n'),15000);heartbeat.unref();request.once('close',()=>clearInterval(heartbeat));return;
  }
  response.writeHead(404,{'Content-Type':'application/json'});response.end('{"error":"preview_endpoint_unavailable"}');
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length>2)throw new Error('No model, store or path options are accepted by the synthetic preview');
 const server=createServer(observerPreviewHandler(observerPreviewSnapshot()));
 server.listen(3413,'127.0.0.1',()=>console.log('Paused synthetic observer source: http://127.0.0.1:3413/ai-town/api/world'));
 let closing=false;const stop=()=>{if(closing)return;closing=true;server.closeAllConnections();server.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
