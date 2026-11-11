import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AcceptanceStopControl,type AcceptanceClock,type AcceptanceStopOptions} from '../src/server/acceptance-stop-control.js';
import {DEEPSEEK_MODEL,GLM_MODEL} from '../src/server/model-completion.js';
import type {World} from '../src/shared/types.js';
// @ts-expect-error Standalone audited .mjs launcher has no declaration file.
import {parseConfiguredSiliconFlowKey} from '../scripts/run-nine-siliconflow-live.mjs';
class Clock implements AcceptanceClock {value=100;now=()=>this.value;setTimer=()=>1;clearTimer=()=>{};}
function setup(extra:Partial<AcceptanceStopOptions>={}){const clock=new Clock();const control=new AcceptanceStopControl({endGameMinute:540,maxWallMs:180000,maxRequests:9,clock,allowedModels:[DEEPSEEK_MODEL],
 unreceiptedFreePolicy:'siliconflow-deepseek-published-zero',assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:1000}),...extra},()=>{});control.start(480);return {clock,control};}
for(const cost of [null,NaN,Infinity,-1])test(`official-price policy rejects malformed cost ${String(cost)}`,()=>{const f=setup(),request=f.control.reserve(DEEPSEEK_MODEL,480)!;f.control.dispatch(request,480);assert.equal(f.control.settle(request,480,cost),false);assert.equal(f.control.status().reason,'cost_unknown');assert.equal(f.control.status().confirmedCostUsd,null);});
test('official-price policy still rejects any known positive charge',()=>{const f=setup(),request=f.control.reserve(DEEPSEEK_MODEL,480)!;f.control.dispatch(request,480);assert.equal(f.control.settle(request,480,0.01),false);assert.equal(f.control.status().reason,'nonzero_cost');assert.equal(f.control.status().confirmedCostUsd,0.01);});
test('receiptless completion at exact endpoint remains billing-unverified',()=>{const f=setup(),request=f.control.reserve(DEEPSEEK_MODEL,480)!;f.control.dispatch(request,480);assert.equal(f.control.settle(request,480,undefined),true);
 f.control.committed({id:'fixture',minute:540,revision:1,residents:[]} as unknown as World);assert.equal(f.control.status().reason,'game_endpoint');assert.equal(f.control.status().gameScopeComplete,true);assert.equal(f.control.status().controlComplete,false);assert.equal(f.control.status().unknownCostRequests,1);assert.equal(f.control.status().confirmedCostUsd,null);});
test('receiptless response is rejected if official free assessment expired',()=>{const f=setup(),request=f.control.reserve(DEEPSEEK_MODEL,480)!;f.control.dispatch(request,480);f.clock.value=1000;assert.equal(f.control.settle(request,480,undefined),false);assert.equal(f.control.status().reason,'cost_unknown');});
test('receiptless mode cannot target another model',()=>{assert.throws(()=>setup({allowedModels:[GLM_MODEL]}),/invalid_official_free_policy/);});
test('pure configured-key parser does not load env or evaluate values',()=>{const key='SYNTHETIC_NOT_A_REAL_KEY';assert.equal(parseConfiguredSiliconFlowKey('OTHER=ignore\nSILICONFLOW_API_KEY='+key+'\n'),key);assert.equal(parseConfiguredSiliconFlowKey('export SILICONFLOW_API_KEY="'+key+'"'),key);
 for(const text of ['',`SILICONFLOW_API_KEY=${key}\nSILICONFLOW_API_KEY=${key}`,'SILICONFLOW_API_KEY=$(cat anything)','SILICONFLOW_API_KEY=${OTHER}','SILICONFLOW_API_KEY=short','SILICONFLOW_API_KEY="unterminated'])assert.throws(()=>parseConfiguredSiliconFlowKey(text));});
test('live guard accepts only exact approved fetch shape against an in-process fake',()=>{
 const guard=pathToFileURL(resolve('scripts/acceptance-live-guard.mjs')).href;
 const script=`let calls=0;globalThis.fetch=async()=>{calls++;return {};};await import(${JSON.stringify(guard)});const url='https://api.siliconflow.cn/v1/chat/completions';const options={method:'POST',redirect:'error',signal:new AbortController().signal,body:JSON.stringify({model:${JSON.stringify(DEEPSEEK_MODEL)},messages:[{role:'user',content:'synthetic'}],stream:false})};await fetch(url,options);let rejected=0;for(const [target,init]of [[url+'/',options],['https://example.invalid',options],[url,{...options,redirect:'follow'}],[url,{...options,method:'GET'}],[url,{...options,body:JSON.stringify({model:'paid',messages:[],stream:false})}]]){try{await fetch(target,init);}catch{rejected++;}}process.stdout.write(JSON.stringify({calls,rejected,guard:globalThis.__valleyLiveGuard}));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{calls:1,rejected:5,guard:true});
});
