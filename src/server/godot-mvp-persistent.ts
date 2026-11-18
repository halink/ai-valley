import {adoptMvpResources,validateMvpResources} from '../world/mvp-resources.js';
import {adoptMvpSeeds,validateMvpSeeds} from '../world/mvp-seeds.js';
import {assertGodotWebExport,serveGodotWeb} from './godot-web.js';
import {roomObservation} from './room-observation.js';
import {relationshipObservation} from './relationship-observation.js';
import {assertMvpPopulation,expandMvpHamlet} from '../world/mvp-hamlet.js';
import {layOutMvpGardens,widenMvpValley} from '../world/mvp-valley.js';
import {hasMvpHamlet,isSupportedMvpMap,isWideMvpMap} from '../shared/mvp-hamlet.js';
import {adoptMvpRooms,validateMvpRooms} from '../world/mvp-rooms.js';
import {adoptMvpDrinking,validateMvpDrinking} from '../world/mvp-drinking.js';
import {enableCompletedMovement,completedMovementSnapshot,residentMovementSnapshot} from '../world/completed-movement.js';
/** Opt-in persistent small world. No local-rules fallback, no environment-file loader. */
import {createServer,type Server} from 'node:http';
import {preflightWorldSave} from './save-preflight.js';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {readSelfHostedConfig} from './self-hosted-config.js';
import {createMvpWorld,mvpPhase} from './godot-mvp.js';
import type {World} from '../shared/types.js';

type MvpListenerOptions={database:string;port:number;webRoot?:string};

function assertMvpWorld(world:World){
 if(world?.mode!=='validation'||!world.id?.startsWith('godot-mvp-')||!isSupportedMvpMap(world.map)||!Array.isArray(world.residents)||!Array.isArray(world.buildings))throw Error('godot_mvp_save_mismatch');
 assertMvpPopulation(world);
 if(isWideMvpMap(world.map)&&!hasMvpHamlet(world))throw Error('godot_mvp_save_mismatch');
 validateMvpDrinking(world);
 validateMvpRooms(world);
 validateMvpSeeds(world);
 validateMvpResources(world);
}
/** Reject another project's DB before the WorldStore constructor can migrate its schema. */
function validateSavedMvp(database:string):void {
 const world=preflightWorldSave(database,{requireWorld:true});
 if(world)assertMvpWorld(world as unknown as World);
}

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
 if(world.mvpDrinking&&world.mvpRooms&&world.map.mvpGarden?.version===1){const seeds=adoptMvpSeeds(world),resources=adoptMvpResources(world);return seeds||resources?(world.revision++,true):false;}
 adoptMvpDrinking(world);
 adoptMvpRooms(world);
 expandMvpHamlet(world);
 widenMvpValley(world);
 layOutMvpGardens(world);
 adoptMvpSeeds(world);
 adoptMvpResources(world);
 assertMvpWorld(world);
 world.revision++;
 return true;
}

export async function startPersistentMvp(options:MvpListenerOptions&{dayMinutes?:number;env:Readonly<Record<string,string|undefined>>;model?:ConstructorParameters<typeof ValleyRuntime>[2]}){
 checkListener(options);
 const dayMinutes=options.dayMinutes??20;
 if(!Number.isFinite(dayMinutes)||dayMinutes<20||dayMinutes>1440)throw Error('godot_mvp_invalid_clock');
 const providers=readSelfHostedConfig(options.env);
 const server=createServer();
 let owner:RuntimeOwnership|undefined,store:WorldStore|undefined,runtime:ValleyRuntime|undefined;
 let closing:Promise<void>|undefined,shutdownFailure:unknown;
 let stopped=false,storeClosed=false;
 const close=():Promise<void>=>closing??=(async()=>{
  if(!stopped){
   stopped=true;
   try{runtime?.stop();}catch(error){shutdownFailure=error;}
  }
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(!storeClosed){
   try{store?.close();storeClosed=true;}
   catch(error){throw new AggregateError([shutdownFailure,error].filter(Boolean),'godot_mvp_store_close_failed');}
  }
  owner?.release();
  if(shutdownFailure)throw shutdownFailure;
 })().catch(error=>{closing=undefined;throw error;});

 try{
  // Bind before creating or altering the save, avoiding a second active process.
  await listenMvp(server,options.port);
  owner=acquireRuntimeOwnership(options.database);owner.assertOwned();
  validateSavedMvp(owner.database);
  store=new WorldStore(owner.database);
  const saved=store.load();
  if(saved){
   assertMvpWorld(saved);
   const previous=saved.revision;
   if(upgradeMvpWorld(saved))store.commit(saved,previous);
  }else store.commit(createMvpWorld(),null);
  // ValleyRuntime accounts for an interrupted request before it dispatches again.
  runtime=new ValleyRuntime(store,providers,options.model,{mode:'validation',dayMinutes,modelSlots:4,selfHostedSafety:true});
  enableCompletedMovement(runtime.world);
  const driver=providers.length?'model':'disabled';
  const snapshot=()=>({...runtime!.snapshot(),roomViews:roomObservation(runtime!.world),observation:runtime!.mvpObservation(),relationshipHistory:relationshipObservation(runtime!.world),movement:completedMovementSnapshot(runtime!.world),residentMovement:residentMovementSnapshot(runtime!.world),capabilities:{active:['小地图只读观察','真实动作引擎','保存与恢复',providers.length?'模型已配置':'模型禁用，世界停表'],pending:['真实模型生活闭环验收','浏览器画面验收','绘本视觉样板']},mvp:{driver,ephemeral:false,notice:providers.length?'持久小山谷：模型决策已启用；调用成本及长期表现未经本客户端验证':'持久小山谷：模型未启用，世界停表；无规则回退',fault:runtime!.selfHostedUnresolved()?'unresolved_model_request':null,
   primary:providers[0]?.model??null,backup:providers[1]?.model??null,phases:Object.fromEntries(runtime!.world.residents.map(r=>[r.id,mvpPhase(r)]))}});
  serveMvpSnapshot(server,options.webRoot,snapshot);
  if(providers.length)runtime.start();
  return {runtime,server,snapshot,close};
 }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'godot_mvp_startup_cleanup_failed');}throw error;}
}
