/** Formal process startup must own both the listening socket and the save before
 * opening WorldStore or constructing ValleyRuntime (both may write migrations).
 * The socket is never released/rebound between validation and actual serving.
 */
import {createServer} from 'node:http';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {createObserverServer} from './http.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import type {ModelConnection} from './model-completion.js';
import {requireDisabledProductionModelPolicy,type ProductionModelPolicy} from './production-model-policy.js';

export async function startFormalServer(options:{port:number;database:string;root:string;dayMinutes:number;providers:readonly ModelConnection[];productionModelPolicy?:ProductionModelPolicy}){
 if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw new Error('Invalid observer port');
 if(!Number.isFinite(options.dayMinutes)||options.dayMinutes<20||options.dayMinutes>1440)throw new Error('Invalid world clock setting');
 // Do this before socket/save ownership or runtime construction. A raw provider
 // would select ValleyRuntime's default HTTP path without a durable production
 // budget, reviewed admission, supervision, or recovery. No live permit exists.
 if(!Array.isArray(options.providers)||options.providers.length!==0)throw new Error('formal_model_providers_disabled');
 const modelPolicy=requireDisabledProductionModelPolicy(options.productionModelPolicy);
 const server=createServer();
 let owner:RuntimeOwnership|undefined,store:WorldStore|undefined,runtime:ValleyRuntime|undefined;
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(async()=>{
  let failure:unknown;
  try{runtime?.stop();}catch(error){failure=error;}
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  // Do not release ownership while a still-open store could write a late reply.
  try{store?.close();}catch(error){throw new AggregateError([failure,error].filter(Boolean),'formal_store_close_failed');}
  owner?.release();
  if(failure)throw failure;
 })();
 try{
  await new Promise<void>((resolve,reject)=>{
   const fail=(error:Error)=>reject(error);
   server.once('error',fail);
   server.listen(options.port,'127.0.0.1',()=>{server.off('error',fail);resolve();});
  });
  owner=acquireRuntimeOwnership(options.database);
  owner.assertOwned();
  store=new WorldStore(owner.database);
  owner.assertOwned();
  // Never reuse caller-owned providers after the asynchronous listen boundary.
  runtime=new ValleyRuntime(store,[],undefined,{dayMinutes:options.dayMinutes,mode:'formal'});
  createObserverServer(runtime,store,options.root,server,modelPolicy);
  runtime.start();
  return {server,store,runtime,close};
 }catch(error){
  try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'formal_startup_and_cleanup_failed');}
  throw error;
 }
}
