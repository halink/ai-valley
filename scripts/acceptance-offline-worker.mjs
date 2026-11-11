// Closed injected-fake-model runtime. Environment is empty and offline guards
// have already been installed by the guardian before this module is loaded.
import {fileURLToPath} from 'node:url';
import {writeSync} from 'node:fs';
const [scenario,fingerprint,...extra]=process.argv.slice(2);
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||extra.length||!process.send||!/^\w{64}$/.test(fingerprint??''))throw new Error('offline_bootstrap_required');
const ready=()=>process.send?.({type:'offline_ready'});
if(scenario==='init_block'){ready();for(;;){/* External guardian must preempt initialization. */}}
const {AcceptanceRunDirectory}=await import('../src/server/acceptance-run-directory.ts');
const {OFFLINE_SCENARIOS,OFFLINE_PROTOCOL,sourceManifest,persistedWorldFingerprint}=await import('../src/server/acceptance-offline-protocol.ts');
if(!OFFLINE_SCENARIOS.includes(scenario))throw new Error('offline_scenario_required');
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),directory=AcceptanceRunDirectory.inherit(4);
if(sourceManifest(root).sourceFingerprint!==fingerprint)throw new Error('offline_source_changed');
const {createFrontierWorld}=await import('../src/world/formal-seed.ts');
const {WorldStore}=await import('../src/server/store.ts');
const {ValleyRuntime}=await import('../src/server/runtime.ts');
const {AcceptanceEvidenceWriter}=await import('../src/server/acceptance-evidence-writer.ts');
const {bindAcceptanceTermination}=await import('../src/server/acceptance-stop-control.ts');
let store,writer,runtime,unbind,finishing=false;
const lateReplies=[];
let failWrites=false,modelCalls=0,lateIgnored=null;
const finish=async()=>{
 if(finishing)return;finishing=true;
 try{
  runtime?.stop();
  if(lateReplies.length){const before=runtime.world.revision;for(const resolve of lateReplies)resolve(fakeReply());await new Promise(resolve=>setImmediate(resolve));lateIgnored=before===runtime.world.revision;}
  const reloaded=store?.loadForRuntime();
  if(scenario==='reload_mismatch'&&reloaded)reloaded.revision++; // Test-only local copy; never commit or alter storage.
  const loadedWorldFingerprint=reloaded?persistedWorldFingerprint(reloaded):null;
  const runtimeWorldFingerprint=runtime?persistedWorldFingerprint(runtime.world):null;
  const reloadVerified=!!reloaded&&!!runtime&&loadedWorldFingerprint===runtimeWorldFingerprint;
  directory.writeJson('offline-worker-close.json',{schema:1,scenario,realModelExecuted:false,acceptancePassed:null,
   modelCalls,lateIgnored,loadedMinute:reloaded?.minute??null,loadedRevision:reloaded?.revision??null,
   runtimeMinute:runtime?.world.minute??null,runtimeRevision:runtime?.world.revision??null,
   reloadVerified,loadedWorldFingerprint,runtimeWorldFingerprint});
  if(!reloadVerified)process.exitCode=1;
 }finally{unbind?.();writer?.abort();store?.close();directory.close();process.disconnect?.();}
};
const fakeReply=()=>({decision:{intention:'Offline deterministic wait',actions:[{type:'wait',minutes:15}]},
 inputTokens:1,outputTokens:1,latencyMs:0,...(scenario==='cost_unknown'?{}:{acceptanceCostUsd:0})});
try{
 if(scenario==='guard_probe'){
  const fs=await import('node:fs'),net=await import('node:net'),http=await import('node:http'),https=await import('node:https'),dns=await import('node:dns'),dgram=await import('node:dgram');
  const probes=[()=>fetch('https://example.invalid'),()=>net.connect(9,'127.0.0.1'),()=>http.get('http://example.invalid'),
   ()=>https.get('https://example.invalid'),()=>dns.lookup('example.invalid',()=>{}),()=>dgram.createSocket('udp4'),
   ()=>fs.readFileSync('/forbidden-test/.env'),()=>fs.readFileSync('/forbidden-test/runtime/formal.sqlite')];
  const rejected=probes.map(probe=>{try{probe();return false;}catch(error){return /^offline_/.test(error.message);}});
  directory.writeJson('offline-guard-probes.json',{environmentEmpty:Object.keys(process.env).length===0,rejected,allRejected:rejected.every(Boolean)});
 }
 const world=createFrontierWorld(OFFLINE_PROTOCOL.seed);
 store=new WorldStore(directory.reserveDatabase());store.commit(world,null);
 writer=new AcceptanceEvidenceWriter({directory:directory.child('evidence'),sourceFingerprint:fingerprint,worldId:world.id,fromMinute:world.minute,
  io:scenario==='writer_failure'?{writeSync:(...args)=>{if(failWrites)throw new Error('synthetic_write_failure');return writeSync(...args);}}:undefined});
 const fakeModel=async()=>{modelCalls++;if(scenario==='late_reply')return new Promise(resolve=>{lateReplies.push(resolve);});return fakeReply();};
 runtime=new ValleyRuntime(store,[{model:OFFLINE_PROTOCOL.model,key:'OFFLINE-NOT-A-CREDENTIAL'}],fakeModel,{
  mode:'formal',dayMinutes:OFFLINE_PROTOCOL.dayMinutes,modelSlots:OFFLINE_PROTOCOL.modelSlots,
  acceptanceStop:{endGameMinute:OFFLINE_PROTOCOL.endGameMinute,maxWallMs:OFFLINE_PROTOCOL.maxWallMs,maxRequests:OFFLINE_PROTOCOL.maxRequests,
   allowedModels:[OFFLINE_PROTOCOL.model],assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,
    perRequest:0,otherFees:0,validUntilMonotonicMs:performance.now()+60_000})},
  acceptanceEvidence:{writer,sourceFingerprintAfter:()=>sourceManifest(root).sourceFingerprint}});
 unbind=bindAcceptanceTermination(process,()=>{runtime.stopAcceptance('signal');void finish().catch(()=>{process.exitCode=1;});});
 runtime.start();ready();
 if(scenario==='sync_block')for(;;){/* Runtime initialized, now block its event loop. */}
 if(scenario==='crash')process.kill(process.pid,'SIGKILL');
 if(scenario==='signal'){/* Real parent signal terminates this open session. */}
 else{
  await new Promise(resolve=>setImmediate(resolve));
  if(scenario==='writer_failure')failWrites=true;
  if(scenario==='late_reply')runtime.stopAcceptance('manual_stop');
  // Offline test driver only. Initial world/roster/inventory is never rewritten.
  let syntheticWall=Date.now();
  for(let tick=0;tick<10&&runtime.acceptanceStopStatus()?.phase==='running';tick++){
   syntheticWall+=1000;runtime.tick(syntheticWall);await new Promise(resolve=>setImmediate(resolve));
  }
  await finish();
 }
}catch{
 process.exitCode=1;try{await finish();}catch{writer?.abort();try{store?.close();}catch{}directory.close();process.disconnect?.();}
}
