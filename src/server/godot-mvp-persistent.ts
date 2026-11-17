import {assertGodotWebExport,serveGodotWeb} from './godot-web.js';
import {roomObservation} from './room-observation.js';
import {relationshipObservation} from './relationship-observation.js';
import {assertMvpPopulation,expandMvpHamlet} from '../world/mvp-hamlet.js';
import {layOutMvpGardens,widenMvpValley} from '../world/mvp-valley.js';
import {hasMvpHamlet,isSupportedMvpMap,isWideMvpMap} from '../shared/mvp-hamlet.js';
import {adoptMvpRooms,validateMvpRooms} from '../world/mvp-rooms.js';
import {adoptMvpDrinking,validateMvpDrinking} from '../world/mvp-drinking.js';
import {enableCompletedMovement,completedMovementSnapshot,residentMovementSnapshot} from '../world/completed-movement.js';
import {VALLEY_VERSION} from '../shared/version.js';
/** Opt-in persistent small world. No local-rules fallback, no environment-file loader. */
import {createServer,type Server} from 'node:http';
import fs,{openSync,closeSync,fsyncSync,existsSync,statSync,fstatSync,lstatSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {readSelfHostedConfig} from './self-hosted-config.js';
import {callModel,isInvalidDecision} from './decisions.js';
import {createMvpWorld,mvpPhase} from './godot-mvp.js';
import {terrainRevision} from './landscape.js';
import {mvpObservation} from './mvp-observation.js';
import type {World} from '../shared/types.js';

type MvpListenerOptions={database:string;port:number;webRoot?:string};

function assertMvpWorld(world:World){
 if(world?.mode!=='validation'||!world.id?.startsWith('godot-mvp-')||!isSupportedMvpMap(world.map)||!Array.isArray(world.residents)||!Array.isArray(world.buildings))throw Error('godot_mvp_save_mismatch');
 assertMvpPopulation(world);
 if(isWideMvpMap(world.map)&&!hasMvpHamlet(world))throw Error('godot_mvp_save_mismatch');
 validateMvpDrinking(world);
 validateMvpRooms(world);
}
/** Reject another project's DB before the WorldStore constructor can migrate its schema. */
function readSavedMvp(database:string):World|null {
 if(!existsSync(database)||statSync(database).size===0)return null;
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  const row=db.prepare('SELECT state FROM worlds ORDER BY rowid DESC LIMIT 1').get() as {state:string|Uint8Array}|undefined;
  if(!row)throw Error('godot_mvp_save_mismatch');
  const world=JSON.parse(typeof row.state==='string'?row.state:gunzipSync(row.state).toString()) as World;
  assertMvpWorld(world);
  return world;
 }catch{throw Error('godot_mvp_save_mismatch');}finally{db.close();}
}
function syncDirectory(path:string){const fd=openSync(dirname(path),'r');try{fs.fsyncSync(fd);}finally{closeSync(fd);}}

function checkListener(options:MvpListenerOptions){
 if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw Error('godot_mvp_invalid_port');
 if(options.webRoot!==undefined)assertGodotWebExport(options.webRoot);
}

function listenMvp(server:Server,port:number){
 return new Promise<void>((resolve,reject)=>{
  const fail=(error:Error)=>reject(error);
  server.once('error',fail);
  server.listen(port,'127.0.0.1',()=>{server.off('error',fail);resolve();});
 });
}

function serveMvpSnapshot(server:Server,webRoot:string|undefined,snapshot:()=>unknown){
 server.on('request',(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(webRoot!==undefined&&serveGodotWeb(req,res,webRoot))return;
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end('Read-only MVP');return;}
  if(req.url!=='/ai-town/api/world'){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(snapshot()));
 });
}

function upgradeMvpWorld(world:World):boolean {
 if(world.mvpDrinking&&world.mvpRooms&&world.map.mvpGarden?.version===1)return false;
 adoptMvpDrinking(world);
 adoptMvpRooms(world);
 expandMvpHamlet(world);
 widenMvpValley(world);
 layOutMvpGardens(world);
 assertMvpWorld(world);
 world.revision++;
 return true;
}

/** Show a protected save without constructing a mutable store or dispatching a model. */
export async function startProtectedMvpObserver(options:MvpListenerOptions){
 checkListener(options);
 const database=realpathSync(options.database);
 const world=readSavedMvp(database);
 if(!world)throw Error('godot_mvp_save_mismatch');
 if(!existsSync(database+'.self-hosted-session')&&!world.metrics.inFlight.length)throw Error('godot_mvp_save_not_protected');
 upgradeMvpWorld(world);
 world.clock={...world.clock,paused:true,reason:'模型请求未核实，世界已停表'};
 const mapRevision=terrainRevision(world.map);
 const {usageWindow:_usageWindow,...metrics}=world.metrics;
 const roomViews=roomObservation(world);
 const relationshipHistory=relationshipObservation(world);
 const snapshot=()=>({
  world:{...world,metrics,events:world.events.slice(-180),processed:[]},
  serverTime:new Date().toISOString(),version:VALLEY_VERSION,mapRevision,roomViews,relationshipHistory,
  observation:mvpObservation(world,[],[],true),
  capabilities:{active:['原存档只读观察','模型请求待核实'],pending:['恢复模型驱动']},
  mvp:{driver:'disabled',ephemeral:false,fault:'unresolved_model_request',primary:null,backup:null,
   notice:'模型请求未核实，现以只读方式显示原存档',
   phases:Object.fromEntries(world.residents.map(r=>[r.id,mvpPhase(r)]))},
 });
 const server=createServer();
 serveMvpSnapshot(server,options.webRoot,snapshot);
 await listenMvp(server,options.port);
 const close=()=>{
  server.closeAllConnections();
  return new Promise<void>(resolve=>server.close(()=>resolve()));
 };
 return {server,snapshot,close};
}

export async function startPersistentMvp(options:MvpListenerOptions&{dayMinutes?:number;env:Readonly<Record<string,string|undefined>>;model?:ConstructorParameters<typeof ValleyRuntime>[2]}){
 checkListener(options);
 const dayMinutes=options.dayMinutes??20;
 if(!Number.isFinite(dayMinutes)||dayMinutes<20||dayMinutes>1440)throw Error('godot_mvp_invalid_clock');
 const providers=readSelfHostedConfig(options.env);
 const server=createServer();
 let owner:RuntimeOwnership|undefined,store:WorldStore|undefined,runtime:ValleyRuntime|undefined;
 let marker:string|undefined,markerIdentity:{dev:number;ino:number}|undefined,unresolved=false,closing:Promise<void>|undefined;
 let stopped=false,storeClosed=false,ownerReleased=false,closeCompleted=false,shutdownFailure:unknown;
 let clean=false;
 const close=():Promise<void>=>{
  if(closeCompleted)return Promise.resolve();
  if(closing)return closing;
  closing=(async()=>{
   if(!stopped){
    clean=!unresolved&&!!runtime&&!runtime.selfHostedUnresolved()&&runtime.world.metrics.inFlight.length===0;
    // stop revokes callbacks before fallible persistence. A failure is sticky:
    // retrying DB close must never turn an uncertain shutdown into a clean one.
    stopped=true;
    try{runtime?.stop();}catch(error){shutdownFailure=error;clean=false;}
   }
   server.closeAllConnections();
   await new Promise<void>(resolve=>server.close(()=>resolve()));
   if(!storeClosed){
    try{store?.close();storeClosed=true;}
    catch(error){throw new AggregateError([shutdownFailure,error].filter(Boolean),'godot_mvp_store_close_failed');}
   }
   let cleanupFailure:unknown;
   try{
    if(!ownerReleased&&marker&&clean&&!shutdownFailure){
     const current=lstatSync(marker);
     if(!current.isFile()||current.size!==0||current.nlink!==1||current.dev!==markerIdentity?.dev||current.ino!==markerIdentity?.ino)throw Error('godot_mvp_marker_changed');
     fs.unlinkSync(marker);
     try{syncDirectory(marker);}catch(error){
      // A failed directory flush cannot prove durable removal. Restore a guard
      // without replacing any file somebody else may have created meanwhile.
      try{const fd=openSync(marker,'wx',0o600);try{fs.fsyncSync(fd);}finally{closeSync(fd);}}catch(restore){throw new AggregateError([error,restore],'godot_mvp_marker_cleanup_uncertain');}
      throw error;
     }
    }
   }catch(error){cleanupFailure=error;}finally{
    // The DB is definitely closed: even marker cleanup failure must not leak
    // ownership. Once released, close retries may not touch the marker path.
    if(!ownerReleased){try{owner?.release();ownerReleased=true;}catch(error){cleanupFailure=new AggregateError([cleanupFailure,error].filter(Boolean),'godot_mvp_release_failed');}}
   }
   if(cleanupFailure)throw new AggregateError([shutdownFailure,cleanupFailure].filter(Boolean),'godot_mvp_cleanup_failed');
   if(shutdownFailure)throw shutdownFailure;
   closeCompleted=true;
  })().catch(error=>{closing=undefined;throw error;});
  return closing;
 };

 try{
  // Bind before creating or altering the save, avoiding a second active process.
  await listenMvp(server,options.port);
  owner=acquireRuntimeOwnership(options.database);owner.assertOwned();
  const markerPath=owner.database+'.self-hosted-session';
  if(existsSync(markerPath))throw Error('godot_mvp_unresolved_session');
  readSavedMvp(owner.database);
  if(providers.length){
   const fd=openSync(markerPath,'wx',0o600);marker=markerPath;const info=fstatSync(fd);markerIdentity={dev:info.dev,ino:info.ino};
   try{fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(markerPath);
  }
  store=new WorldStore(owner.database);
  const saved=store.load();
  if(saved){
   assertMvpWorld(saved);
   if(saved.metrics.inFlight.length)throw Error('godot_mvp_unresolved_requests');
   const previous=saved.revision;
   if(upgradeMvpWorld(saved))store.commit(saved,previous);
  }else store.commit(createMvpWorld(),null);
  const model:NonNullable<typeof options.model>=async(...args)=>{
   if(!providers.length)throw Error('godot_mvp_models_disabled');
   if(unresolved||runtime?.selfHostedUnresolved())throw Error('godot_mvp_unresolved_request');
   try{return await (options.model??callModel)(...args);}
   catch(error){
    if(!isInvalidDecision(error)&&!(error instanceof Error&&error.message==='model_http_429'))unresolved=true;
    throw error;
   }
  };
  runtime=new ValleyRuntime(store,providers,model,{mode:'validation',dayMinutes,modelSlots:1,selfHostedSafety:true});
  enableCompletedMovement(runtime.world);
  const driver=providers.length?'model':'disabled';
  const snapshot=()=>({...runtime!.snapshot(),roomViews:roomObservation(runtime!.world),observation:runtime!.mvpObservation(),relationshipHistory:relationshipObservation(runtime!.world),movement:completedMovementSnapshot(runtime!.world),residentMovement:residentMovementSnapshot(runtime!.world),capabilities:{active:['小地图只读观察','真实动作引擎','保存与恢复',providers.length?'模型已配置':'模型禁用，世界停表'],pending:['真实模型生活闭环验收','浏览器画面验收','绘本视觉样板']},mvp:{driver,ephemeral:false,notice:providers.length?'持久小山谷：模型决策已启用；调用成本及长期表现未经本客户端验证':'持久小山谷：模型未启用，世界停表；无规则回退',fault:runtime!.selfHostedUnresolved()?'unresolved_model_request':null,
   primary:providers[0]?.model??null,backup:providers[1]?.model??null,phases:Object.fromEntries(runtime!.world.residents.map(r=>[r.id,mvpPhase(r)]))}});
  serveMvpSnapshot(server,options.webRoot,snapshot);
  if(providers.length)runtime.start();
  return {runtime,server,snapshot,close};
 }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'godot_mvp_startup_cleanup_failed');}throw error;}
}
