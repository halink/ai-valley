import {register} from 'node:module';
import {MessageChannel} from 'node:worker_threads';

// The main-thread port stays referenced through unregister + actual compiler
// close. A stuck loader cannot let the worker silently exit zero; the original
// watchdog deadline and TERM/KILL windows remain its external failure bound.
export function syntheticCompilerShutdown(port){
 let resolve,reject,settled=false,stopping=false,closing;
 const done=new Promise((yes,no)=>{resolve=yes;reject=no;});
 done.catch(()=>{}); // A premature port failure is retained until close().
 const fail=()=>{if(!settled){settled=true;reject(Error('synthetic_compiler_shutdown_failed'));}};
 port.on('message',message=>{
  if(settled)return;
  if(!stopping||message?.type!=='closed'||!Number.isSafeInteger(message.pid)||message.pid<1||
   !(message.code===0&&message.signal===null||message.code===null&&message.signal==='SIGTERM')){fail();return;}
  settled=true;resolve({pid:message.pid,code:message.code,signal:message.signal});
 });
 port.on('messageerror',fail);port.on('close',fail);port.ref();
 return {close(unregister){return closing??=(async()=>{
  try{await unregister();stopping=true;port.postMessage('stop');return await done;}
  finally{port.close();}
 })();}};
}

export function registerSyntheticCompiler(){
 if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length)throw Error('synthetic_compiler_offline_required');
 const {port1,port2}=new MessageChannel(),compiler=syntheticCompilerShutdown(port1);
 try{register(new URL('./production-model-process-loader-owner.mjs',import.meta.url),{data:{port:port2},transferList:[port2]});}
 catch(error){port1.close();port2.close();throw error;}
 return compiler;
}
