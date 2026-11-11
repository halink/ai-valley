// Runs in Node's ESM loader thread, where tsx owns its esbuild service.
// No PID lookup or general descendant adoption: capture only initialize's child.
import childProcess from 'node:child_process';

export async function ownSyntheticCompiler(compiler,spawner=childProcess){
 let child,closed,resolveClose,unexpected=false,error=false,stopping=false,closing;
 const close=new Promise(resolve=>{resolveClose=resolve;});
 const spawn=spawner.spawn;let initialized;
 try{
  spawner.spawn=function(...args){
   if(child)throw Error('synthetic_compiler_multiple_children');
   child=spawn.apply(this,args);
   child.once('error',()=>{error=true;});
   child.once('close',(code,signal)=>{unexpected=!stopping;closed={code,signal};resolveClose(closed);});
   return child;
  };
  // esbuild initialize spawns synchronously. Restore the narrow capture before
  // awaiting it; an incompatible future implementation must fail closed.
  initialized=compiler.initialize({});
 }finally{spawner.spawn=spawn;}
 await initialized;
 if(!child||!Number.isSafeInteger(child.pid)||child.pid<1)throw Error('synthetic_compiler_child_missing');
 return {close(){return closing??=(async()=>{
  stopping=true;child.ref();
  try{await compiler.stop();}catch{error=true;}
  // stop() resolving, exit, stdout EOF, and kill() succeeding are insufficient.
  // If close never arrives the unchanged independent watchdog kills the group.
  const result=closed??await close;
  if(unexpected||error||!(result.code===0&&result.signal===null||result.code===null&&result.signal==='SIGTERM'))
   throw Error('synthetic_compiler_not_clean');
  return {pid:child.pid,...result};
 })();}};
}

export async function initialize({port}){
 // Global patches are realm-local. Install the same fixed guard here before
 // importing compiler/tsx dependencies, rather than trusting the main realm.
 await import('./acceptance-offline-guard.mjs');
 if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length)throw Error('synthetic_compiler_offline_required');
 const {default:compiler}=await import('../node_modules/esbuild/lib/main.js');
 const owner=await ownSyntheticCompiler(compiler);let stopping=false;
 port.on('message',async message=>{
  if(stopping)return;stopping=true;
  try{
   if(message!=='stop')throw Error('synthetic_compiler_protocol');
   const result=await owner.close();port.postMessage({type:'closed',...result});
  }catch{port.postMessage({type:'failed'});}
  finally{port.close();}
 });
 port.unref();
}
