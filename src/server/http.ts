import {VALLEY_VERSION} from '../shared/version.js';
import {FAST_DAY_MINUTES} from '../world/time.js';
import {parseHistoryQuery,HistoryQueryError} from './history-query.js';
import type {Biography} from '../shared/history.js';
import {createServer,type ServerResponse} from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {gzipSync} from 'node:zlib';
import type {ValleyRuntime} from './runtime.js';
import type {Snapshot} from '../shared/types.js';
import {observerFrame} from './observer-feed.js';
import type {WorldStore} from './store.js';
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
const jsonHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding'};
const eventHeaders={'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'};
const acceptsGzip=(value:string|undefined)=>value?.split(',').some(encoding=>{
 const [name,...parameters]=encoding.trim().toLowerCase().split(';');
 return name.trim()==='gzip'&&!parameters.some(p=>/^q\s*=\s*0(?:\.0+)?\s*$/.test(p.trim()));
})??false;
export function createObserverServer(runtime:ValleyRuntime,store:WorldStore,root:string){
 const clients=new Map<ServerResponse,Snapshot>();
 let cache:{snapshot:Snapshot;body?:string;gzip?:Buffer;baseline?:string}|undefined;
 const currentSnapshot=()=>{
  if(!cache||cache.snapshot.world.id!==runtime.world.id||cache.snapshot.world.revision!==runtime.world.revision)cache={snapshot:runtime.snapshot()};
  return cache;
 };
 let broadcastAt=0;
 const unsubscribe=runtime.subscribe(()=>{
  const now=Date.now();
  const interval=runtime.world.clock.realMinutesPerDay<=FAST_DAY_MINUTES?950:2000;
  if(!clients.size||now-broadcastAt<interval)return;
  broadcastAt=now;
  const current=currentSnapshot().snapshot;
  const frames=new Map<number,string>();
  for(const [client,previous] of clients){
   if(client.writableLength>1_000_000){client.destroy();clients.delete(client);continue;}
   const base=previous.world.revision;
   let text=frames.get(base);
   if(!text){text='event: update\ndata: '+JSON.stringify(observerFrame(current,previous))+'\n\n';frames.set(base,text);}
   client.write(text);
   clients.set(client,current);
  }
 });
 const server=createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end('Observer access is read-only');return;}
  let url:URL;try{url=new URL(req.url??'/', 'http://localhost');}catch{res.writeHead(400);res.end();return;}
  const pathname=url.pathname,prior='/ai-town/formal';
  if(pathname===prior||pathname.startsWith(prior+'/')){
   res.writeHead(308,{Location:'/ai-town'+(pathname.slice(prior.length)||'/')+url.search});res.end();return;
  }
  const json=(data:unknown,status=200)=>{
   if(req.method==='HEAD'){res.writeHead(status,jsonHeaders);res.end();return;}
   const body=JSON.stringify(data);
   const compressed=body.length>2048&&acceptsGzip(req.headers['accept-encoding']);
   res.writeHead(status,compressed?{...jsonHeaders,'Content-Encoding':'gzip'}:jsonHeaders);res.end(compressed?gzipSync(body,{level:1}):body);
  };
  if(pathname==='/ai-town/api/world'){
   if(req.method==='HEAD'){res.writeHead(200,jsonHeaders);res.end();return;}
   const current=currentSnapshot(),body=current.body??=JSON.stringify(current.snapshot);
   if(body.length>2048&&acceptsGzip(req.headers['accept-encoding'])){
    const compressed=current.gzip??=gzipSync(body,{level:1});
    res.writeHead(200,{...jsonHeaders,'Content-Encoding':'gzip'});res.end(compressed);
   }else{res.writeHead(200,jsonHeaders);res.end(body);}
   return;
  }
  if(pathname==='/ai-town/api/health'){json({ok:true,version:VALLEY_VERSION,mode:runtime.world.mode,revision:runtime.world.revision,clockPaused:runtime.world.clock.paused,modelConfigured:runtime.world.metrics.configured});return;}
  if(pathname==='/ai-town/api/history/page'){
   try{json({...store.historyPage(runtime.world.id,parseHistoryQuery(url.searchParams)),observedRevision:runtime.world.revision});}catch(error){json({error:error instanceof HistoryQueryError?error.message:'history_unavailable'},error instanceof HistoryQueryError?400:500);}return;
  }
  const biographyPath=pathname.match(/^\/ai-town\/api\/people\/([^/]+)\/biography$/);
  if(biographyPath){
   let id:string;try{id=decodeURIComponent(biographyPath[1]);}catch{json({error:'invalid_person'},400);return;}
   const w=runtime.world,r=w.residents.find(r=>r.id===id);if(!r){json({error:'person_not_found'},404);return;}
   const archive=store.personArchive(w.id,id),history=store.historyPage(w.id,{personId:id,limit:40,populationOnly:true});
   const partners=archive.partners.slice();for(const tie of r.relations.filter(t=>t.partner))if(!partners.some(p=>p.personId===tie.targetId&&p.endedAt===null))partners.push({personId:tie.targetId,kind:tie.partner!,startedAt:null,endedAt:null,sourceEvents:[]});
   const result:Biography={worldId:w.id,person:{id:r.id,name:r.name,bornAt:r.bornAt,status:r.status,residency:r.residency,deathAt:r.deathAt,deathCause:r.deathCause,deathDetail:r.deathDetail,homeId:r.homeId,parents:[...r.parents],adoptiveParents:[...(r.adoptiveParents??[])],guardianIds:[...r.guardianIds]},...archive,partners,history:{...history,observedRevision:w.revision}};json(result);return;
  }
  if(pathname==='/ai-town/api/history'){
   const before=Number(url.searchParams.get('before')??Number.MAX_SAFE_INTEGER);if(!Number.isFinite(before)){json({error:'invalid_cursor'},400);return;}
   json({events:store.history(runtime.world.id,before)});return;
  }
  if(pathname==='/ai-town/api/events'){
   if(req.method==='HEAD'){res.writeHead(200,eventHeaders);res.end();return;}
   if(clients.size>=32){json({error:'observer_capacity'},503);return;}
   const current=currentSnapshot();
   current.baseline??='event: update\ndata: '+JSON.stringify(observerFrame(current.snapshot))+'\n\n';
   res.writeHead(200,eventHeaders);
   res.write(current.baseline);
   clients.set(res,current.snapshot);
   const heartbeat=setInterval(()=>{if(res.writableLength>1_000_000)res.destroy();else res.write(': heartbeat\n\n');},20000);
   res.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});return;
  }
  if(pathname==='/ai-town'){res.writeHead(308,{Location:'/ai-town/'+url.search});res.end();return;}
  if(!pathname.startsWith('/ai-town/')){res.writeHead(404);res.end();return;}
  let relative:string;try{relative=decodeURIComponent(pathname.slice('/ai-town/'.length));}catch{res.writeHead(400);res.end();return;}
  if(!relative)relative='index.html';
  const file=resolve(root,relative);
  if(!file.startsWith(resolve(root)+'/')){res.writeHead(404);res.end('Not found');return;}
  try{
   const info=statSync(file);
   if(!info.isFile()){res.writeHead(404);res.end('Not found');return;}
   const headers:Record<string,string>={'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':relative.startsWith('assets/')?'public,max-age=31536000,immutable':'no-cache','Vary':'Accept-Encoding'};
   const compressed=info.size>1024&&acceptsGzip(req.headers['accept-encoding']);
   if(compressed)headers['Content-Encoding']='gzip';
   const body=req.method==='HEAD'?undefined:readFileSync(file);
   const payload=compressed&&body?gzipSync(body,{level:1}):body;
   res.writeHead(200,headers);res.end(payload);
  }catch{res.writeHead(404);res.end('Not found');}
 });
 server.on('close',()=>{unsubscribe();for(const client of clients.keys())client.end();clients.clear();});
 return server;
}
