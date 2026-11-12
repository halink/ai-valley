// Fixed synthetic runtime worker; immutable offline guard is mandatory.
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||!process.connected||process.argv.length!==2)throw Error('offline_account_worker_required');
process.umask(0o077);
let gone=false;
process.once('disconnect',()=>{gone=true;});
const input=await new Promise(resolve=>{process.once('message',resolve);process.once('disconnect',()=>resolve(null));});
if(gone||!input||input.options?.contract?.executionKind!=='synthetic-production-candidate'||!['normal','crash_intent','crash_response','block'].includes(input.scenario))throw Error('synthetic_worker_input_invalid');
const {registerSyntheticCompiler}=await import('./production-model-process-loader.mjs');
const compiler=registerSyntheticCompiler();
const {register}=await import('../node_modules/tsx/dist/esm/api/index.mjs'),unregister=register();
let store,db,bridge,worldLock,journalLock;
const stage=point=>{if(process.connected)process.send({type:'stage',point},()=>{});};
try{
 const {DatabaseSync}=await import('node:sqlite');
 const {WorldStore}=await import('../src/server/store.ts');
 const {acquireRuntimeOwnership}=await import('../src/server/runtime-lock.ts');
 const {persistedWorldFingerprint}=await import('../src/server/acceptance-offline-protocol.ts');
 const {ProductionModelJournal}=await import('../src/server/production-model-journal.ts');
 const {createMemoryProductionHttp}=await import('../src/server/production-model-http.ts');
 const {createProductionModelOfflineRuntime}=await import('../src/server/production-model-runtime.ts');
 const {PRODUCTION_MODEL_CANDIDATE:P}=await import('../src/server/production-model-policy.ts');
 const {options,scenario}=input;
 if(gone||!process.connected)throw Error('watchdog_gone');
 worldLock=acquireRuntimeOwnership(options.worldPath);journalLock=acquireRuntimeOwnership(options.journalPath);
 store=new WorldStore(worldLock.database);db=new DatabaseSync(journalLock.database);
 const world=store.loadForRuntime(),journal=new ProductionModelJournal(db,options.contract,{create:false,worldFingerprint:persistedWorldFingerprint(world)});
 const fault=(method,point)=>{const original=journal[method].bind(journal);journal[method]=(...args)=>{const value=original(...args);stage(point);
  // Keep the leader alive until normal compiler teardown, even for crash faults.
  throw Error(`synthetic_crash_${point}`);
 };};
 if(scenario==='crash_intent')fault('intent','intent');
 if(scenario==='crash_response')fault('response','response');
 const memory=createMemoryProductionHttp();
 bridge=createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:world.minute+60,maxWallMs:Math.min(options.process.maxWallMs,30000)});
 bridge.runtime.start();stage('started');
 if(scenario==='block'){stage('blocked');for(;;){}}
 if(scenario==='normal'||scenario==='crash_response'){
  const request=memory.requests()[0];if(!request)throw Error('synthetic_request_missing');
  const choice=JSON.parse(request.body).messages.map(m=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];if(!choice)throw Error('synthetic_choice_missing');
  memory.headers(0);memory.chunk(0,Buffer.from(JSON.stringify({model:P.model,choices:[{message:{content:JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})));memory.end(0);
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 }
 if(scenario!=='normal'||journal.status().completed!==1)throw Error('synthetic_worker_not_clean');
 stage('committed');
}catch{process.exitCode=73;}
finally{
 try{if(bridge?.close().failure)process.exitCode=73;}catch{process.exitCode=73;}
 try{store?.close();db?.close();journalLock?.release();worldLock?.release();}catch{process.exitCode=73;}
 try{await compiler.close(unregister);}catch{process.exitCode=73;}
 if(process.connected)process.disconnect();
}
