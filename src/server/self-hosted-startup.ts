import {openSync,closeSync,fsyncSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {createServer} from 'node:http';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {createObserverServer} from './http.js';
import {acquireRuntimeOwnership,type RuntimeOwnership} from './runtime-lock.js';
import {callModel} from './decisions.js';
import {readSelfHostedConfig} from './self-hosted-config.js';

export async function startSelfHostedServer(options:{port:number;database:string;root:string;dayMinutes:number;env:Readonly<Record<string,string|undefined>>;model?:ConstructorParameters<typeof ValleyRuntime>[2]}){
 if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw new Error('Invalid observer port');
 if(!Number.isFinite(options.dayMinutes)||options.dayMinutes<20||options.dayMinutes>1440)throw new Error('Invalid world clock setting');
 const providers=readSelfHostedConfig(options.env);
 if(!providers.length)throw Error('self_hosted_not_enabled');
 const server=createServer();
 let owner:RuntimeOwnership|undefined,store:WorldStore|undefined,runtime:ValleyRuntime|undefined;
 let closing:Promise<void>|undefined,marker:string|undefined;
 let clean=false,unresolved=false;
 const close=()=>closing??=(async()=>{
  let failure:unknown;
  clean=!unresolved&&!!runtime&&!runtime.selfHostedUnresolved()&&runtime.world.metrics.inFlight.length===0;
  try{runtime?.stop();}catch(error){failure=error;}
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  // Do not release ownership while a still-open store could write a late reply.
  try{store?.close();}catch(error){throw new AggregateError([failure,error].filter(Boolean),'self_hosted_store_close_failed');}
  if(marker&&clean&&!failure){unlinkSync(marker);const directory=openSync(dirname(marker),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
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
  const markerPath=owner.database+'.self-hosted-session';
  let fd:number;
  try{fd=openSync(markerPath,'wx',0o600);}catch{throw Error('self_hosted_unresolved_session');}
  marker=markerPath;try{fsyncSync(fd);}finally{closeSync(fd);}
  const directory=openSync(dirname(markerPath),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
  store=new WorldStore(owner.database);
  if(store.loadForRuntime()?.metrics.inFlight.length)throw Error('self_hosted_unresolved_requests');
  owner.assertOwned();
  // Never reuse caller-owned providers after the asynchronous listen boundary.
  const model:NonNullable<typeof options.model>=async(...args)=>{if(unresolved||runtime?.selfHostedUnresolved())throw Error('self_hosted_unresolved_request');try{return await (options.model??callModel)(...args);}catch(error){if(!(error instanceof Error&&error.message==='model_http_429'))unresolved=true;throw error;}};
  runtime=new ValleyRuntime(store,providers,model,{dayMinutes:options.dayMinutes,mode:'formal',modelSlots:1,selfHostedSafety:true});
  createObserverServer(runtime,store,options.root,server,undefined,()=>({mode:'self-hosted',supervised:false,actualProviderCostCny:null,pricingVerified:false,unresolved:unresolved||runtime!.selfHostedUnresolved(),primary:providers[0].model,backup:providers[1]?.model??null}));
  runtime.start();
  return {server,store,runtime,close};
 }catch(error){
  try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'self_hosted_startup_and_cleanup_failed');}
  throw error;
 }
}
