import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Server} from 'node:http';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {startFormalServer} from '../src/server/formal-startup.js';
import {readProductionModelPolicy,requireDisabledProductionModelPolicy,type ProductionModelPolicy} from '../src/server/production-model-policy.js';
import type {ModelConnection} from '../src/server/model-completion.js';

function fixture(t:TestContext){
 const root=mkdtempSync(join(testTmpdir(),'formal-entry-review-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 let requests=0;
 t.mock.method(globalThis,'fetch',()=>{requests++;throw new Error('review_network_forbidden');});
 t.after(()=>assert.equal(requests,0));
 return {port:0,database:join(root,'save','world.sqlite'),root,dayMinutes:20,providers:[] as ModelConnection[],productionModelPolicy:readProductionModelPolicy({})};
}
function listenStub(t:TestContext,beforeReady=()=>{}){
 t.mock.method(Server.prototype,'listen',function(this:Server,...args:unknown[]){
  queueMicrotask(()=>{beforeReady();(args.at(-1) as ()=>void)();});return this;
 });
}
function health(running:Awaited<ReturnType<typeof startFormalServer>>){
 let body='';running.server.emit('request',{method:'GET',url:'/ai-town/api/health',headers:{}},
  {setHeader(){},writeHead(code:number){assert.equal(code,200);},end(value:string){body=value;}});
 return JSON.parse(body);
}

test('review: opaque proxy and prototype policies fail without inspecting their fields',async t=>{
 const options=fixture(t),policy=options.productionModelPolicy;let inspected=0;
 t.mock.method(Server.prototype,'listen',()=>{throw new Error('unexpected_listen');});
 const proxy=new Proxy(policy,{get(){inspected++;throw new Error('unexpected_policy_read');},getPrototypeOf(){inspected++;throw new Error('unexpected_prototype_read');}});
 const revoked=Proxy.revocable(policy,{});revoked.revoke();
 for(const candidate of [proxy,revoked.proxy,Object.create(policy),Object.freeze({...policy}),false,0,'disabled']){
  await assert.rejects(startFormalServer({...options,productionModelPolicy:candidate as ProductionModelPolicy}),/formal_model_policy_untrusted/);
 }
 assert.equal(inspected,0);assert.equal(existsSync(join(options.root,'save')),false);
 assert.equal(requireDisabledProductionModelPolicy(policy),policy);
});

test('review: caller-owned empty array methods cannot inject providers',async t=>{
 const options=fixture(t);let invoked=0;
 Object.defineProperties(options.providers,{
  filter:{get(){invoked++;throw new Error('caller_filter_used');}},
  [Symbol.iterator]:{get(){invoked++;throw new Error('caller_iterator_used');}}
 });
 listenStub(t);
 const running=await startFormalServer(options);t.after(()=>running.close());
 running.runtime.tick(Date.now()+60_000);
 assert.equal(invoked,0);assert.equal(running.runtime.world.metrics.configured,false);
 assert.equal(running.runtime.world.clock.paused,true);assert.equal(health(running).ready,false);
});

test('review: asynchronous replacement of the policy cannot alter health or enable execution',async t=>{
 const options=fixture(t),original=options.productionModelPolicy;
 listenStub(t,()=>{options.productionModelPolicy={...original,liveExecutionEnabled:true} as unknown as ProductionModelPolicy;});
 const running=await startFormalServer(options);t.after(()=>running.close());
 assert.deepEqual(health(running).modelExecution,original);
 assert.equal(running.runtime.world.metrics.configured,false);
 assert.throws(()=>Object.defineProperty(original,'liveExecutionEnabled',{value:true}),TypeError);
});

test('review: reopening a synthetic save cannot restore stale configured status',async t=>{
 const options=fixture(t);listenStub(t);
 const first=await startFormalServer(options);
 try{
  first.runtime.world.metrics.configured=true;
  first.runtime.world.clock.paused=false;
  first.store.commit(first.runtime.world,first.runtime.world.revision,{events:[],processed:[]});
 }finally{await first.close();}
 const reopened=await startFormalServer(options);t.after(()=>reopened.close());
 reopened.runtime.tick(Date.now()+60_000);
 assert.equal(reopened.runtime.world.metrics.configured,false);
 assert.equal(reopened.runtime.world.clock.paused,true);
 assert.equal(health(reopened).modelExecution.liveExecutionEnabled,false);
});
