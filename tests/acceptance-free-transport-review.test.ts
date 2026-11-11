import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OfflineFreeCandidateContract,createMemoryFreeTransport,FREE_CANDIDATE_PROPOSAL as P,FREE_CANDIDATE_PROTOCOL_HASH as protocolHash,type FreeContractEvidence,type FreeContractOptions} from '../src/server/acceptance-free-transport.js';
import type {AcceptanceClock} from '../src/server/acceptance-stop-control.js';
class Clock implements AcceptanceClock {
 value=10; timers=new Map<number,()=>void>(); next=0;
 now=()=>this.value;
 setTimer=(fn:()=>void,_ms:number)=>{const id=++this.next;this.timers.set(id,fn);return id;};
 clearTimer=(id:unknown)=>{this.timers.delete(id as number);};
}
const identity={provenance:'synthetic-fixture',protocolHash,provider:P.provider,endpoint:P.endpoint,model:P.model,accountScope:P.accountScope};
function fixtures(){return {
 priceEvidence:{...identity,currency:'USD',observedAtMs:0,validUntilMs:100000,inputPerMillion:0,outputPerMillion:0,reasoningPerMillion:0,perRequest:0,otherFees:0,hardZeroBilling:true,reference:'price-review'},
 dataApproval:{...identity,dataScope:P.dataScope,approvedAtMs:0,validUntilMs:100000,maxRequests:P.maxRequests,maxWallMs:P.maxWallMs,reference:'approval-review'}
};}
function setup(extra:Partial<FreeContractOptions>={}){
 const clock=new Clock(),memory=createMemoryFreeTransport(),events:FreeContractEvidence[]=[];
 const gate=new OfflineFreeCandidateContract({...fixtures(),clock,transport:memory.transport,persist:event=>{events.push(event);return true;},...extra});
 return {clock,memory,events,gate};
}
function validHeaders(requestId=1,totalUsd=0){return {status:200,endpoint:P.endpoint,redirected:false,model:P.model,providerRequestId:'provider-review',receipt:{provenance:'synthetic-fixture',provider:P.provider,endpoint:P.endpoint,model:P.model,accountScope:P.accountScope,requestId,providerRequestId:'provider-review',currency:'USD',allChargesFinal:true,totalUsd,reference:'receipt-review'}};}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
for(const kind of ['forged','proxy','clone'] as const)test(`review rejects ${kind} memory capabilities before dispatch`,()=>{
 const genuine=createMemoryFreeTransport();const transport=kind==='proxy'?new Proxy(genuine.transport,{}):kind==='clone'?{...genuine.transport}:Object.freeze({kind:'in-memory-offline-transport'} as const);
 const {gate}=setup({transport});assert.equal(gate.start(),false);assert.equal(gate.status().reason,'missing_transport');assert.equal(gate.status().transportInvocations,0);
});
for(const field of ['inputPerMillion','outputPerMillion','reasoningPerMillion','perRequest','otherFees'] as const)test(`review rejects nonzero ${field} before dispatch`,()=>{
 const f=fixtures();f.priceEvidence[field]=0.000001;const {gate,memory}=setup(f);assert.equal(gate.start(),false);assert.equal(gate.status().reason,'price_unproven');assert.equal(memory.calls().length,0);
});
for(const field of ['provider','endpoint','model','accountScope','dataScope'] as const)test(`review rejects expanded approval ${field}`,()=>{
 const f=fixtures();const changed={...f,dataApproval:{...f.dataApproval,[field]:f.dataApproval[field]+'-other'}};const {gate}=setup(changed);assert.equal(gate.start(),false);assert.equal(gate.status().reason,'data_unapproved');
});
test('review gate durable acknowledgement precedes every dispatch even during reentry',async()=>{
 let gate!:OfflineFreeCandidateContract,nested:Promise<unknown>|undefined;const memory=createMemoryFreeTransport();let dispatchedInsideGate=-1;
 gate=new OfflineFreeCandidateContract({...fixtures(),clock:new Clock(),transport:memory.transport,persist:event=>{if(event.type==='gate'){nested=gate.execute();dispatchedInsideGate=memory.calls().length;}return true;}});
 gate.start();gate.stop();await nested;assert.equal(dispatchedInsideGate,0,'gate evidence must finish persistence before a dispatch can begin');
});
test('review timer cleanup failure closes gate and cannot return an accepted decision',async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();f.clock.clearTimer=()=>{throw new Error('synthetic cleanup failure');};
 f.memory.resolveHeaders(0,validHeaders());f.memory.resolveBody(0,'{"choice":"wait"}');assert.equal(await result,null);assert.equal(f.gate.status().phase,'stopped');assert.equal(f.gate.status().acceptedDecisions,0);
});
test('review response persistence fails before parsing and keeps real zero unknown',async()=>{
 const f=setup({persist:event=>{if(event.type==='response')throw new Error('synthetic evidence failure');return true;}});assert.equal(f.gate.start(),true);
 const result=f.gate.execute();f.memory.resolveHeaders(0,validHeaders());f.memory.resolveBody(0,'{"choice":"wait"}');assert.equal(await result,null);
 assert.equal(f.gate.status().reason,'evidence_failed');assert.equal(f.gate.status().realProviderCostUsd,null);assert.equal(f.gate.status().acceptedDecisions,0);assert.equal(f.gate.evidence().some(e=>e.type==='body'||e.type==='decision'),false);
});
test('review malformed JSON retains separate model and synthetic receipt evidence first',async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();f.memory.resolveHeaders(0,validHeaders());f.memory.resolveBody(0,'not-json');assert.equal(await result,null);
 assert.equal(f.gate.status().reason,'decision_invalid');assert.equal(f.gate.status().syntheticReceiptTotalUsd,0);assert.equal(f.gate.status().realProviderCostUsd,null);
 assert.deepEqual(f.events.map(e=>e.type),['gate','dispatch_intent','transport_invoked','response','body','stopped']);assert.equal(f.events[3].details.modelMatches,true);
});
test('review request timeout discards late response with no retry or fallback',async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();f.clock.value+=P.requestTimeoutMs;f.clock.timers.get(2)!();assert.equal(await result,null);
 assert.equal(f.gate.status().reason,'request_timeout');assert.equal(f.memory.calls()[0].signal.aborted,true);f.memory.resolveHeaders(0,validHeaders());f.memory.resolveBody(0,'{"choice":"wait"}');await flush();
 assert.equal(await f.gate.execute(),null);assert.equal(f.memory.calls().length,1);assert.equal(f.gate.status().syntheticReceiptTotalUsd,null);assert.equal(f.gate.status().unknownCostRequests,1);assert.equal(f.gate.evidence().some(e=>e.type==='decision'),false);
});
test('review concurrent request permanently closes both calls without second invocation',async()=>{
 const f=setup();f.gate.start();const first=f.gate.execute();assert.equal(await f.gate.execute(),null);assert.equal(await first,null);assert.equal(f.gate.status().reason,'concurrency_violation');assert.equal(f.memory.calls().length,1);
});
test('review nonzero receipt remains known even when model mismatch closes response',async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();f.memory.resolveHeaders(0,{...validHeaders(1,0.25),model:'wrong-model'});assert.equal(await result,null);assert.equal(f.gate.status().reason,'model_mismatch');assert.equal(f.gate.status().syntheticReceiptTotalUsd,0.25);assert.equal(f.gate.status().realProviderCostUsd,null);
});
test('review timer cleanup reentrant stop cannot be followed by decision acceptance',async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();let once=false;
 f.clock.clearTimer=()=>{if(!once){once=true;f.gate.stop('manual_stop');}};
 f.memory.resolveHeaders(0,validHeaders());f.memory.resolveBody(0,'{"choice":"wait"}');assert.equal(await result,null);assert.equal(f.gate.status().acceptedDecisions,0);assert.equal(f.gate.status().phase,'stopped');
});
test('review dispatch evidence failure never invokes memory transport',async()=>{
 const f=setup({persist:event=>{if(event.type==='dispatch_intent')throw new Error('synthetic disk failure');return true;}});f.gate.start();assert.equal(await f.gate.execute(),null);assert.equal(f.memory.calls().length,0);assert.equal(f.gate.status().reason,'evidence_failed');assert.equal(f.gate.status().syntheticReceiptTotalUsd,null);
});
for(const field of ['totalUsd','allChargesFinal','requestId','currency','accountScope'] as const)test(`review unknown receipt ${field} is not synthesized as zero`,async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();const h=validHeaders();const receipt:Record<string,unknown>={...h.receipt};delete receipt[field];f.memory.resolveHeaders(0,{...h,receipt});assert.equal(await result,null);assert.equal(f.gate.status().reason,'cost_unknown');assert.equal(f.gate.status().syntheticReceiptTotalUsd,null);assert.equal(f.gate.status().unknownCostRequests,1);assert.equal(f.gate.status().realProviderCostUsd,null);
});
test('review response accessor is rejected without evaluating getter',async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();let reads=0;const h=validHeaders();Object.defineProperty(h,'model',{enumerable:true,get(){reads++;throw new Error('must not execute');}});f.memory.resolveHeaders(0,h);assert.equal(await result,null);assert.equal(reads,0);assert.equal(f.gate.status().reason,'response_invalid');
});
for(const target of ['headers','body'] as const)test(`review ${target} then getter never runs during promise settlement`,async()=>{
 const f=setup();f.gate.start();const result=f.gate.execute();let reads=0;
 const hostile=Object.defineProperty({},'then',{enumerable:true,get(){reads++;throw new Error('must never assimilate');}});
 if(target==='headers')f.memory.resolveHeaders(0,hostile);
 else {f.memory.resolveHeaders(0,validHeaders());f.memory.resolveBody(0,hostile);}
 assert.equal(await result,null);assert.equal(reads,0);assert.equal(f.gate.status().reason,target==='headers'?'response_invalid':'body_invalid');assert.equal(f.gate.status().acceptedDecisions,0);
});
