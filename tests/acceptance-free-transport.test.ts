import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {FREE_CANDIDATE_PROPOSAL as P,FREE_CANDIDATE_PROTOCOL_HASH as H,OFFLINE_PROBE,
 createMemoryFreeTransport,OfflineFreeCandidateContract,type FreeContractOptions,type FreeContractEvidence,
 type SyntheticPriceEvidence,type SyntheticDataApproval,type MemoryResponseMetadata,type SyntheticReceipt} from '../src/server/acceptance-free-transport.js';
import {NINE_RESIDENT_PLAN} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.js';
import type {AcceptanceClock} from '../src/server/acceptance-stop-control.js';
class Clock implements AcceptanceClock{
 value=100;next=0;timers=new Map<number,{at:number;fn:()=>void}>();now=()=>this.value;
 setTimer=(fn:()=>void,ms:number)=>{const id=++this.next;this.timers.set(id,{at:this.value+ms,fn});return id;};
 clearTimer=(id:unknown)=>{this.timers.delete(id as number);};
 advance(ms:number,fire=true){this.value+=ms;if(fire)for(const [id,t]of [...this.timers])if(t.at<=this.value){this.timers.delete(id);t.fn();}}
}
function price(overrides:Partial<SyntheticPriceEvidence>={}):SyntheticPriceEvidence{return {provenance:'synthetic-fixture',protocolHash:H,
 provider:P.provider,endpoint:P.endpoint,model:P.model,accountScope:P.accountScope,currency:'USD',observedAtMs:0,validUntilMs:100_000,
 inputPerMillion:0,outputPerMillion:0,reasoningPerMillion:0,perRequest:0,otherFees:0,hardZeroBilling:true,reference:'fixture-price',...overrides};}
function approval(overrides:Partial<SyntheticDataApproval>={}):SyntheticDataApproval{return {provenance:'synthetic-fixture',protocolHash:H,
 provider:P.provider,endpoint:P.endpoint,model:P.model,accountScope:P.accountScope,dataScope:P.dataScope,approvedAtMs:0,validUntilMs:100_000,
 maxRequests:P.maxRequests,maxWallMs:P.maxWallMs,reference:'fixture-approval',...overrides};}
function receipt(requestId=1,overrides:Partial<SyntheticReceipt>={}):SyntheticReceipt{return {provenance:'synthetic-fixture',requestId,
 providerRequestId:`fixture-${requestId}`,provider:P.provider,endpoint:P.endpoint,model:P.model,accountScope:P.accountScope,currency:'USD',allChargesFinal:true,totalUsd:0,reference:'fixture-bill',...overrides};}
function response(requestId=1,overrides:Partial<MemoryResponseMetadata>={}):MemoryResponseMetadata{return {status:200,endpoint:P.endpoint,
 redirected:false,model:P.model,providerRequestId:`fixture-${requestId}`,receipt:receipt(requestId),...overrides};}
function fixture(overrides:Partial<FreeContractOptions>={}){
 const clock=new Clock(),fake=createMemoryFreeTransport(),rows:FreeContractEvidence[]=[];
 const gate=new OfflineFreeCandidateContract({transport:fake.transport,clock,priceEvidence:price(),dataApproval:approval(),persist:event=>{rows.push(event);return true;},...overrides});
 return {clock,fake,rows,gate};
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('new candidate protocol is separate from unchanged Qwen plan and does not authorize any real run',()=>{
 assert.equal(P.modelSlots,1);assert.equal(P.endpoint,'https://api.siliconflow.cn/v1/chat/completions');assert.equal(P.maxRequests,24);
 assert.equal(P.retries,0);assert.equal(P.fallback,null);assert.equal(P.authorized,false);assert.equal(P.readyForRealRun,false);
 assert.equal(NINE_RESIDENT_PLAN.primary,'qwen3.8-flash');assert.equal(NINE_RESIDENT_PLAN.modelSlots,16);assert.equal(NINE_RESIDENT_PLAN.gameMinutes,21600);
 assert.notEqual(P.protocol,NINE_RESIDENT_PLAN.protocol);assert.ok(Object.isFrozen(P));
});
test('default construction and unbranded custom send functions cannot dispatch',async()=>{
 const empty=new OfflineFreeCandidateContract();assert.equal(empty.start(),false);assert.equal(await empty.execute(),null);assert.equal(empty.status().transportInvocations,0);
 const f=fixture({transport:{kind:'in-memory-offline-transport',send:()=>{throw new Error('must not run');}} as any});
 assert.equal(f.gate.start(),false);assert.equal(f.gate.status().reason,'missing_transport');assert.equal(f.fake.calls().length,0);
});
test('missing, paid, stale, unknown or wrong-identity price proof rejects before dispatch',async()=>{
 for(const p of [undefined,null,{},price({model:'qwen3.8-flash'}),price({provider:'other'}),price({endpoint:P.endpoint+'/'}),price({accountScope:'real-account'}),
  price({protocolHash:'bad'}),price({observedAtMs:101}),price({validUntilMs:100}),price({reasoningPerMillion:1}),price({perRequest:0.01}),price({otherFees:NaN}),
  {...price(),hardZeroBilling:false},{...price(),provenance:'provider-verified'},{...price(),accessToken:'DO-NOT-CAPTURE'}]){
  const f=fixture({priceEvidence:p});assert.equal(f.gate.start(),false);assert.equal(await f.gate.execute(),null);assert.equal(f.fake.calls().length,0);assert.equal(f.gate.status().reason,'price_unproven');
  assert.equal(JSON.stringify(f.gate.evidence()).includes('DO-NOT-CAPTURE'),false);
 }
});
test('data approval must bind exact synthetic scope, provider, endpoint, model and ceilings',async()=>{
 for(const a of [undefined,null,{},approval({dataScope:'all-game-state'}),approval({model:'THUDM/GLM-Z1-9B-0414'}),approval({endpoint:'https://example.invalid'}),
  approval({provider:'other'}),approval({maxRequests:25}),approval({maxWallMs:60_000}),approval({validUntilMs:100}),approval({approvedAtMs:101}),
  {...approval(),provenance:'real-user-approval'}]){
  const f=fixture({dataApproval:a});assert.equal(f.gate.start(),false);assert.equal(await f.gate.execute(),null);assert.equal(f.fake.calls().length,0);assert.equal(f.gate.status().reason,'data_unapproved');
 }
});
test('missing or asynchronous evidence acknowledgement refuses before transport',async()=>{
 for(const persist of [undefined,(()=>undefined),async()=>true,()=>{throw new Error('private-secret');}]){
  const f=fixture({persist:persist as any});assert.equal(f.gate.start(),false);assert.equal(f.fake.calls().length,0);
  assert.equal(f.gate.status().evidencePersisted,false);assert.equal(JSON.stringify(f.gate.evidence()).includes('private-secret'),false);
 }
});
test('complete synthetic receipt and independent model evidence precede any decision parsing',async()=>{
 const f=fixture();assert.equal(f.gate.start(),true);const result=f.gate.execute();assert.equal(f.fake.calls().length,1);
 const sent=f.fake.calls()[0];assert.equal(sent.body,OFFLINE_PROBE);assert.equal(sent.redirect,'error');assert.equal(sent.model,P.model);assert.equal(sent.endpoint,P.endpoint);
 f.fake.resolveHeaders(0,response());await flush();assert.deepEqual(f.rows.map(r=>r.type),['gate','dispatch_intent','transport_invoked','response']);
 assert.equal(f.rows.at(-1)!.details.costUsd,0);assert.equal(f.rows.at(-1)!.details.realProviderCostUsd,null);
 f.fake.resolveBody(0,'{"choice":"wait"}');assert.deepEqual(await result,{choice:'wait'});
 assert.deepEqual(f.rows.map(r=>r.type),['gate','dispatch_intent','transport_invoked','response','body','decision']);
 assert.equal(f.gate.status().acceptedDecisions,1);assert.equal(f.gate.status().realProviderCostUsd,null);assert.equal(f.gate.status().acceptancePassed,null);f.gate.stop();
});
test('all 24 request slots are bounded with no automatic retry, discovery or fallback',async()=>{
 const f=fixture();f.gate.start();
 for(let i=0;i<P.maxRequests;i++){const result=f.gate.execute();f.fake.resolveHeaders(i,response(i+1));f.fake.resolveBody(i,'{"choice":"wait"}');assert.deepEqual(await result,{choice:'wait'});}
 assert.equal(await f.gate.execute(),null);assert.equal(f.gate.status().reason,'request_limit');assert.equal(f.fake.calls().length,24);assert.equal(f.gate.status().acceptedDecisions,24);
 assert.equal(await f.gate.execute(),null);assert.equal(f.fake.calls().length,24);
});
test('a second concurrent call stops the entire gate without queuing another dispatch',async()=>{
 const f=fixture();f.gate.start();const first=f.gate.execute();assert.equal(await f.gate.execute(),null);assert.equal(await first,null);
 assert.equal(f.fake.calls().length,1);assert.equal(f.gate.status().reason,'concurrency_violation');assert.equal(f.fake.calls()[0].signal.aborted,true);assert.equal(f.gate.status().unknownCostRequests,1);
});
test('one memory transport capability cannot be reused in another session',()=>{
 const fake=createMemoryFreeTransport(),a=fixture({transport:fake.transport}),b=fixture({transport:fake.transport});
 assert.equal(a.gate.start(),true);a.gate.stop();assert.equal(b.gate.start(),false);assert.equal(b.gate.status().reason,'transport_already_used');
});
test('token usage, missing receipt, nonfinal receipt and receipt identity mismatch never imply zero',async()=>{
 for(const bill of [null,{usage:{prompt_tokens:5,completion_tokens:2}},receipt(2),receipt(1,{providerRequestId:'wrong'}),receipt(1,{model:'alias'}),
  receipt(1,{currency:'CNY' as 'USD'}),receipt(1,{totalUsd:NaN}),{...receipt(),allChargesFinal:false},{...receipt(),provenance:'provider-receipt'}]){
  const f=fixture();f.gate.start();const result=f.gate.execute();f.fake.resolveHeaders(0,response(1,{receipt:bill}));f.fake.resolveBody(0,'{"choice":"wait"}');
  assert.equal(await result,null);assert.equal(f.gate.status().reason,'cost_unknown');assert.equal(f.gate.status().syntheticReceiptTotalUsd,null);assert.equal(f.gate.status().unknownCostRequests,1);
  assert.equal(f.gate.evidence().some(e=>e.type==='decision'),false);assert.equal(f.fake.calls().length,1);
 }
});
test('nonzero receipt is preserved and terminal, not erased on failure',async()=>{
 const f=fixture();f.gate.start();const result=f.gate.execute();f.fake.resolveHeaders(0,response(1,{receipt:receipt(1,{totalUsd:0.02})}));
 assert.equal(await result,null);assert.equal(f.gate.status().reason,'nonzero_cost');assert.equal(f.gate.status().syntheticReceiptTotalUsd,0.02);
 assert.equal(f.gate.evidence().find(e=>e.type==='response')!.details.costUsd,0.02);assert.equal(f.gate.status().realProviderCostUsd,null);
});
test('wrong response model or endpoint, redirect, throttling and HTTP failure preserve billing without parsing',async()=>{
 for(const [overrides,reason]of [[{model:'another-model'},'model_mismatch'],[{model:null},'model_mismatch'],[{endpoint:P.endpoint+'/'},'redirect_rejected'],
  [{redirected:true},'redirect_rejected'],[{status:302},'redirect_rejected'],[{status:429},'rate_limited'],[{status:401},'http_failed'],[{status:500},'http_failed']] as const){
  const f=fixture();f.gate.start();const result=f.gate.execute();f.fake.resolveHeaders(0,response(1,overrides));f.fake.resolveBody(0,'not-json');
  assert.equal(await result,null);assert.equal(f.gate.status().reason,reason);assert.equal(f.gate.evidence().some(e=>e.type==='body'),false);
  assert.equal(f.gate.evidence().find(e=>e.type==='response')!.details.costUsd,0);assert.equal(f.gate.status().realProviderCostUsd,null);assert.equal(f.fake.calls().length,1);
 }
});
test('malformed metadata and accessor properties are rejected without invoking getters',async()=>{
 let getters=0;const accessor={...response()};Object.defineProperty(accessor,'model',{get(){getters++;throw new Error('secret');},enumerable:true});
 for(const meta of [{...response(),extra:'DO-NOT-CAPTURE'},accessor,{...response(),status:NaN},null]){
  const f=fixture();f.gate.start();const result=f.gate.execute();f.fake.resolveHeaders(0,meta);assert.equal(await result,null);
  assert.equal(f.gate.status().reason,'response_invalid');assert.equal(f.gate.status().acceptedDecisions,0);assert.equal(JSON.stringify(f.gate.evidence()).includes('DO-NOT-CAPTURE'),false);
 }assert.equal(getters,0);
});
test('invalid, oversized and nonstring body cannot erase valid receipt or manufacture decision',async()=>{
 for(const [body,reason]of [['not JSON','decision_invalid'],['{"choice":"eat"}','decision_invalid'],['{"choice":"wait","extra":true}','decision_invalid'],
  ['x'.repeat(P.maxResponseBytes+1),'body_invalid'],[null,'body_invalid']] as const){
  const f=fixture();f.gate.start();const result=f.gate.execute();f.fake.resolveHeaders(0,response());f.fake.resolveBody(0,body);assert.equal(await result,null);
  assert.equal(f.gate.status().reason,reason);assert.equal(f.gate.status().syntheticReceiptTotalUsd,0);assert.equal(f.gate.status().unknownCostRequests,0);
  assert.equal(f.gate.evidence().find(e=>e.type==='response')!.details.costStatus,'synthetic-final-receipt');assert.equal(f.gate.status().acceptedDecisions,0);
 }
});
test('unresolved headers time out; a late reply neither parses nor changes frozen terminal evidence',async()=>{
 const f=fixture();f.gate.start();const result=f.gate.execute();f.clock.advance(P.requestTimeoutMs);assert.equal(await result,null);
 assert.equal(f.gate.status().reason,'request_timeout');assert.equal(f.gate.status().syntheticReceiptTotalUsd,null);assert.equal(f.fake.calls()[0].signal.aborted,true);
 const status=f.gate.status(),events=f.gate.evidence();f.fake.resolveHeaders(0,response());f.fake.resolveBody(0,'{"choice":"wait"}');await flush();
 assert.deepEqual(f.gate.status(),status);assert.deepEqual(f.gate.evidence(),events);assert.equal(status.remoteCancellationConfirmed,false);
});
test('stalled body remains bounded after metadata and never loses the receipt',async()=>{
 const f=fixture();f.gate.start();const result=f.gate.execute();f.fake.resolveHeaders(0,response());await flush();f.clock.advance(P.requestTimeoutMs);
 assert.equal(await result,null);assert.equal(f.gate.status().reason,'request_timeout');assert.equal(f.gate.status().syntheticReceiptTotalUsd,0);
 assert.equal(f.gate.status().realProviderCostUsd,null);assert.equal(f.gate.status().remoteCancellationConfirmed,false);
});
test('delayed timer delivery cannot admit a reply at the request deadline',async()=>{
 const f=fixture();f.gate.start();const result=f.gate.execute();f.clock.advance(P.requestTimeoutMs,false);f.fake.resolveHeaders(0,response());f.fake.resolveBody(0,'{"choice":"wait"}');
 assert.equal(await result,null);assert.equal(f.gate.status().reason,'request_timeout');assert.equal(f.gate.status().acceptedDecisions,0);
});
test('absolute wall deadline applies while idle and on delayed callbacks',async()=>{
 for(const fire of [true,false]){const f=fixture();f.gate.start();f.clock.advance(P.maxWallMs,fire);assert.equal(await f.gate.execute(),null);
  assert.equal(f.gate.status().reason,'wall_limit');assert.equal(f.fake.calls().length,0);assert.equal(f.gate.status().syntheticReceiptTotalUsd,null);}
});
test('expired price/approval and rollback are checked again before dispatch',async()=>{
 for(const [overrides,reason,advance]of [[{priceEvidence:price({validUntilMs:110})},'price_unproven',10],
  [{dataApproval:approval({validUntilMs:110})},'data_unapproved',10],[{},'clock_invalid',-1]] as const){
  const f=fixture(overrides);f.gate.start();f.clock.advance(advance,false);assert.equal(await f.gate.execute(),null);assert.equal(f.fake.calls().length,0);assert.equal(f.gate.status().reason,reason);
 }
});
test('abort before dispatch or during headers/body causes no retry and resolves the waiting caller',async()=>{
 for(const stage of ['before','headers','body']){const controller=new AbortController(),f=fixture({signal:controller.signal});
  if(stage==='before')controller.abort();assert.equal(f.gate.start(),stage!=='before');
  const result=f.gate.execute();if(stage==='body'){f.fake.resolveHeaders(0,response());await flush();}controller.abort();assert.equal(await result,null);
  assert.equal(f.gate.status().reason,'signal');assert.equal(f.fake.calls().length,stage==='before'?0:1);assert.equal(f.gate.status().acceptedDecisions,0);
 }
});
test('transport/header/body failure closes once and does not leak arbitrary error messages',async()=>{
 for(const stage of ['headers','body']){const f=fixture();f.gate.start();const result=f.gate.execute();
  if(stage==='headers')f.fake.rejectHeaders(0);else{f.fake.resolveHeaders(0,response());await flush();f.fake.rejectBody(0);}
  assert.equal(await result,null);assert.equal(f.gate.status().reason,'transport_failed');assert.equal(await f.gate.execute(),null);assert.equal(f.fake.calls().length,1);
 }
});
test('failure to persist intent suppresses dispatch; response/body/decision failures suppress acceptance',async()=>{
 for(const failType of ['dispatch_intent','transport_invoked','response','body','decision'] as const){
  const f=fixture({persist:event=>{if(event.type===failType)throw new Error('disk-failure');return true;}});f.gate.start();const result=f.gate.execute();
  if(f.fake.calls().length){f.fake.resolveHeaders(0,response());f.fake.resolveBody(0,'{"choice":"wait"}');}
  assert.equal(await result,null);assert.equal(f.gate.status().reason,'evidence_failed');assert.equal(f.gate.status().evidencePersisted,false);assert.equal(f.gate.status().acceptedDecisions,0);
  assert.equal(f.fake.calls().length,failType==='dispatch_intent'?0:1);
 }
});
test('synchronous evidence sink reentry or stop cannot dispatch another request or accept a stopped decision',async()=>{
 for(const type of ['dispatch_intent','response','decision'] as const){let gate!:OfflineFreeCandidateContract;
  const f=fixture({persist:event=>{if(event.type===type)gate.stop();return true;}});gate=f.gate;gate.start();const result=gate.execute();
  if(f.fake.calls().length){f.fake.resolveHeaders(0,response());f.fake.resolveBody(0,'{"choice":"wait"}');}
  assert.equal(await result,null);assert.equal(gate.status().reason,'manual_stop');assert.equal(gate.status().acceptedDecisions,0);assert.equal(f.fake.calls().length,type==='dispatch_intent'?0:1);
 }
});
test('mutating caller proofs after start cannot widen scope or postpone expiry',async()=>{
 const p=price({validUntilMs:110}),a=approval({validUntilMs:110}),f=fixture({priceEvidence:p,dataApproval:a});assert.equal(f.gate.start(),true);
 p.validUntilMs=999999;a.validUntilMs=999999;f.clock.advance(10,false);assert.equal(await f.gate.execute(),null);assert.equal(f.fake.calls().length,0);
});
test('separate durable files preserve dispatch and response even when decision JSON is damaged',async t=>{
 const parent=mkdtempSync(join(testTmpdir(),'valley-free-contract-')),dir=AcceptanceRunDirectory.create(join(parent,'run'));
 t.after(()=>{dir.close();rmSync(parent,{recursive:true,force:true});});
 const f=fixture({persist:event=>{dir.writeJson(`transport-${String(event.sequence).padStart(4,'0')}.json`,event);return true;}});
 f.gate.start();const result=f.gate.execute();f.fake.resolveHeaders(0,response());f.fake.resolveBody(0,'damaged-body');assert.equal(await result,null);
 const rows=f.gate.evidence();for(const event of rows)assert.deepEqual(dir.readJson(`transport-${String(event.sequence).padStart(4,'0')}.json`),event);
 assert.equal(rows[1].type,'dispatch_intent');assert.equal(rows[3].type,'response');assert.equal(rows[3].details.costUsd,0);
 assert.equal(rows.at(-1)!.details.reason,'decision_invalid');assert.equal(rows.some(e=>e.type==='decision'),false);
 assert.equal(JSON.stringify(rows).includes('damaged-body'),false);
});
