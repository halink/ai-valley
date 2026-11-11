// Synthetic-only child; a fixture key arrives through a private pipe.
import {fileURLToPath} from 'node:url';
import {assertLegacySyntheticScenario} from './acceptance-legacy-live-policy.mjs';
const [fingerprint,observedText,scenario,...extra]=process.argv.slice(2),observed=Number(observedText);
assertLegacySyntheticScenario(scenario);
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||extra.length
 ||!process.send||!/^\w{64}$/.test(fingerprint??''))throw new Error('live_bootstrap_required');
if(scenario==='init_block')for(;;){}
const {readPrivatePipe}=await import('./acceptance-private-pipe.mjs');
const {AcceptanceRunDirectory}=await import('../src/server/acceptance-run-directory.ts');
const {sourceManifest,persistedWorldFingerprint}=await import('../src/server/acceptance-offline-protocol.ts');
const {LIVE_PROBE_PROTOCOL:P}=await import('../src/server/acceptance-live-protocol.ts');
const {SiliconFlowLive}=await import('../src/server/acceptance-siliconflow-live.ts');
const {WorldStore}=await import('../src/server/store.ts');
const {ValleyRuntime}=await import('../src/server/runtime.ts');
const {AcceptanceEvidenceWriter}=await import('../src/server/acceptance-evidence-writer.ts');
const {createFrontierWorld}=await import('../src/world/formal-seed.ts');
const {prepareModelDecision,parseModelCompletion}=await import('../src/server/decisions.ts');
const {bindAcceptanceTermination}=await import('../src/server/acceptance-stop-control.ts');
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),directory=AcceptanceRunDirectory.inherit(4);
let store,writer,runtime,transport,unbind,poll,finished=false,failure=null,fixtureContent='',fixtureRequests=0;
const finish=()=>{
 if(finished)return;finished=true;if(poll)clearInterval(poll);
 try{
  // Runtime stop aborts only local requests. Keep exact provider-side cancellation unknown.
  runtime?.stop();transport?.stop();
  const loaded=store?.loadForRuntime(),loadedFingerprint=loaded?persistedWorldFingerprint(loaded):null,
   runtimeFingerprint=runtime?persistedWorldFingerprint(runtime.world):null;
  const reloadVerified=!!loaded&&!!runtime&&loadedFingerprint===runtimeFingerprint;
  const status=transport?.status()??null,control=runtime?.acceptanceStopStatus()??null;
  if(!failure&&status?.reason&&!['manual_stop','signal','request_limit','wall_limit'].includes(status.reason))failure=status.reason;
  const acceptedDecisions=runtime?.world.metrics.successes??0;
  directory.writeJson('live-worker-close.json',{schema:1,executionKind:'mocked-http',scenario,
   transport:status,control,failure,acceptedDecisions,requests:runtime?.world.metrics.requests??0,
   fromMinute:P.fromMinute,throughMinute:runtime?.world.minute??null,reloadVerified,loadedFingerprint,runtimeFingerprint,
   realProviderCostUsd:null,costBasis:P.costBasis,remoteCancellationConfirmed:false,acceptancePassed:null});
  if(failure||!reloadVerified||acceptedDecisions===0)process.exitCode=1;
 }catch{process.exitCode=1;}
 finally{unbind?.();writer?.abort();try{store?.close();}catch{process.exitCode=1;}directory.close();process.disconnect?.();}
};
try{
 if(sourceManifest(root).sourceFingerprint!==fingerprint)throw new Error('source_changed');
 let key=await readPrivatePipe(5);
 const mockFetch=async(url,init)=>{
  fixtureRequests++;
  if(scenario==='stall_headers'||scenario==='sync_block')return new Promise(()=>{});
  const response=new Response(JSON.stringify({id:'fixture-'+fixtureRequests,object:'chat.completion',model:P.model,
   choices:[{message:{role:'assistant',content:fixtureContent},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}}),
   {status:scenario==='http_failure'?429:200,headers:{'content-type':'application/json'}});
  Object.defineProperty(response,'url',{value:url});return response;
 };
 transport=new SiliconFlowLive({enabled:true,key,dataApproved:true,
  priceEvidence:{sourceUrls:[P.pricingUrl,P.policyUrl],observedAtMs:observed,expiresAtMs:observed+P.maxPriceAgeMs,
   model:P.model,inputPricePerMillion:0,outputPricePerMillion:0},
  fetch:mockFetch,persist:event=>{directory.writeJson(`provider-${String(event.sequence).padStart(5,'0')}.json`,event);return true;},
  onStop:reason=>{if(!['manual_stop','signal','request_limit','wall_limit'].includes(reason))failure=reason;
   runtime?.stopAcceptance(reason==='signal'?'signal':'manual_stop');queueMicrotask(finish);}});
 key='';if(!transport.start())throw new Error('transport_gate_failed');
 const world=createFrontierWorld(P.seed),founders=new Set(world.residents.map(r=>r.id));if(founders.size!==9||world.minute!==480)throw new Error('seed_changed');
 store=new WorldStore(directory.reserveDatabase());store.commit(world,null);
 writer=new AcceptanceEvidenceWriter({directory:directory.child('evidence'),sourceFingerprint:fingerprint,worldId:world.id,fromMinute:world.minute});
 runtime=new ValleyRuntime(store,[{model:P.model,key:'LIVE-TRANSPORT-HOLDS-KEY'}],async(_key,context,feedback,model,prepared,execution)=>{
  if(model!==P.model||!founders.has(context.actor.id)||context.foreign||context.outside){failure='fictional_founder_scope_rejected';transport.stop('input_invalid');throw new Error('live_scope_rejected');}
  const started=performance.now();
  try{
   const request=prepared??prepareModelDecision(context,feedback,P.model);
   const wait=request.choices.find(c=>c.action.type==='wait');if(!wait)throw new Error('fixture_choice_missing');fixtureContent=JSON.stringify({choice:wait.id,minutes:15});
   const reply=await transport.complete(request.messages,execution?.signal);if(!reply)throw new Error('live_transport_stopped');
   const result=parseModelCompletion(context,request,reply,performance.now()-started);
   // Keep the old synthetic protocol's unknown cost. A mock reply is not a bill
   // or permission to enable a live transport.
   return result;
  }catch{failure??='decision_invalid';transport.stop('response_invalid');throw new Error('live_probe_decision_failed');}
 },{mode:'formal',dayMinutes:P.dayMinutes,modelSlots:1,
  acceptanceStop:{endGameMinute:P.endGameMinute,maxWallMs:P.maxWallMs,maxRequests:P.maxRequests,allowedModels:[P.model],
   unreceiptedFreePolicy:'siliconflow-deepseek-published-zero',assessPrice:model=>{
    const remaining=observed+P.maxPriceAgeMs-Date.now();return remaining>0?{model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:performance.now()+remaining}:null;
   }},acceptanceEvidence:{writer,sourceFingerprintAfter:()=>sourceManifest(root).sourceFingerprint}});
 unbind=bindAcceptanceTermination(process,()=>{runtime.stopAcceptance('signal');finish();});
 runtime.start();process.send?.({type:'live_probe_ready'});
 if(scenario==='sync_block')for(;;){}
 poll=setInterval(()=>{if(runtime.acceptanceStopStatus()?.phase==='stopped')finish();},100);
 if(scenario==='synthetic'||scenario==='http_failure'){
  let wall=Date.now();for(let i=0;i<100&&!finished&&runtime.acceptanceStopStatus()?.phase==='running';i++){
   await new Promise(resolve=>setImmediate(resolve));wall+=1000;runtime.tick(wall);
  }
  if(!finished)finish();
 }
}catch{failure??='live_probe_setup_failed';process.exitCode=1;finish();}
