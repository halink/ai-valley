// Fixed SYNTHETIC executable adapter. No live provider/credential capability.
// This independent process owns account reservation even after its caller dies.
import {spawn} from 'node:child_process';
import {readFileSync,writeSync,fsyncSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||typeof process.send!=='function'||process.argv.length!==2)throw Error('offline_account_watchdog_required');
process.umask(0o077);

let gone=!process.connected,supervisor;
const interrupt=()=>{gone=true;supervisor?.interrupt('parent_disconnect');};
process.on('disconnect',interrupt);process.on('SIGTERM',interrupt);process.on('SIGINT',interrupt);
const send=value=>{if(process.connected)try{process.send(value,()=>{});}catch{}};
const input=gone?null:await new Promise(resolve=>{process.once('message',resolve);process.once('disconnect',()=>resolve(null));});
const {registerSyntheticCompiler}=await import('./production-model-process-loader.mjs');
const compiler=registerSyntheticCompiler();
const {register}=await import('../node_modules/tsx/dist/esm/api/index.mjs'),unregister=register();
let result={kind:'synthetic-account-process',realModelExecuted:false,readyForProduction:false,actualProviderCostCny:null,report:null,error:'not_started'};
try{
 const {ProductionModelAccountSupervisor}=await import('../src/server/production-model-account-supervisor.ts');
 const {signalSyntheticProcessGroup}=await import('../src/server/production-model-process-signals.ts');
 const scenarios=['normal','crash_intent','crash_response','block'];
 if(gone||!input||input.options?.contract?.executionKind!=='synthetic-production-candidate'||!scenarios.includes(input.scenario))throw Error('synthetic_account_input_invalid');
 const options=input.options;
 const originalBudget=options.process.maxWallMs;
 if(!/^[0-9]{1,30}$/.test(input.startedMonotonicNs))throw Error('synthetic_account_clock_invalid');
 const elapsed=Number((process.hrtime.bigint()-BigInt(input.startedMonotonicNs))/1_000_000n);
 if(elapsed<0)throw Error('synthetic_account_clock_invalid');
 options.process.maxWallMs=Math.floor(Math.min(originalBudget-elapsed,options.contract.deadlineAtMs-Date.now()));
 if(!Number.isSafeInteger(originalBudget)||originalBudget<1||originalBudget>30000||options.process.maxWallMs<1)throw Error('synthetic_account_expired');
 // External caller cannot inject clocks, callbacks, scripts, environment, or PIDs.
 if(Object.keys(options.process).some(k=>!['maxWallMs','termGraceMs','killWaitMs'].includes(k))||options.process.termGraceMs!==1500||options.process.killWaitMs!==1500)throw Error('synthetic_account_bounds_invalid');
 supervisor=new ProductionModelAccountSupervisor(options);
 const report=await supervisor.start(observe=>{
  const worker=fileURLToPath(new URL('./production-model-account-worker.mjs',import.meta.url));
  const guard=fileURLToPath(new URL('./acceptance-offline-guard.mjs',import.meta.url));
  const child=spawn(process.execPath,['--import',guard,worker],{cwd:'/',env:{},detached:true,shell:false,stdio:['ignore','ignore','ignore','ipc']});
  let identity=null,absent=false;
  const group=()=>{if(absent)return 'absent';if(!child.pid)return 'unknown';try{process.kill(-child.pid,0);return 'present';}catch(e){if(e.code==='ESRCH'){absent=true;return 'absent';}return 'unknown';}};
  child.on('spawn',()=>{
   observe({type:'spawned'});
   try{const stat=readFileSync(`/proc/${child.pid}/stat`,'utf8');identity={pid:child.pid,startTicks:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};
    send({type:'worker',identity});
    if(gone)supervisor.interrupt('parent_disconnect');else child.send({options,scenario:input.scenario},error=>{if(error)observe({type:'transport_error'});});
   }catch{observe({type:'transport_error'});}
  });
  child.on('error',()=>observe({type:child.pid?'transport_error':'spawn_failed'}));
  child.on('exit',(code,signal)=>observe({type:'exit',code,signal}));
  child.on('message',message=>{if(message?.type==='stage')send(message);});
  return {groupState:group,signalGroup:signal=>signalSyntheticProcessGroup(identity,signal,group),dispose(){if(child.connected)child.disconnect();child.unref();}};
 });
 result={...result,report,error:null};
}catch(error){result.error=error instanceof Error?error.message:'synthetic_account_failed';}
finally{
 try{await compiler.close(unregister);}catch{result.error='watchdog_compiler_close_failed';}
 // Descriptor is an already-open caller-owned report, not a path from IPC.
 try{writeSync(4,JSON.stringify(result));fsyncSync(4);}catch{process.exitCode=1;}
 send({type:'result',...result});
 if(result.error||result.report?.account!=='clean')process.exitCode=1;
 if(process.connected)process.disconnect();
}
