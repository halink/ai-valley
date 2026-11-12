import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Server} from 'node:http';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {startFormalServer} from '../src/server/formal-startup.js';
import {readProductionModelPolicy,PRODUCTION_MODEL_CANDIDATE as P,type ProductionModelPolicy} from '../src/server/production-model-policy.js';
import type {ModelConnection} from '../src/server/model-completion.js';

function fixture(t:TestContext){
 const directory=mkdtempSync(join(testTmpdir(),'formal-model-entry-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',()=>{throw new Error('test_network_forbidden');});
 return {directory,options:{port:0,database:join(directory,'untouched','world.sqlite'),root:directory,dayMinutes:20,providers:[] as ModelConnection[]}};
}
function socketForbidden(t:TestContext){
 let touches=0;t.mock.method(Server.prototype,'listen',function(){touches++;throw new Error('test_socket_touched');});
 return ()=>touches;
}

test('formal entry rejects raw providers before a socket, credential, or save is touched',async t=>{
 const {directory,options}=fixture(t),touches=socketForbidden(t);let credentials=0;
 const provider={model:P.model,get key():string{credentials++;throw new Error('test_credential_touched');}};
 for(const productionModelPolicy of [undefined,readProductionModelPolicy({}),readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only'})]){
  await assert.rejects(startFormalServer({...options,providers:[provider],productionModelPolicy}),/formal_model_providers_disabled/);
 }
 assert.equal(touches(),0);assert.equal(credentials,0);assert.equal(existsSync(join(directory,'untouched')),false);
});

test('formal entry rejects copied, forged, or accessor policies before external effects',async t=>{
 const {directory,options}=fixture(t),touches=socketForbidden(t),known=readProductionModelPolicy({});let inspected=0;
 const accessor=Object.defineProperty({},'liveExecutionEnabled',{get(){inspected++;throw new Error('test_policy_accessor_touched');}});
 for(const policy of [{...known},JSON.parse(JSON.stringify(known)),{...known,liveExecutionEnabled:true},accessor,null]){
  await assert.rejects(startFormalServer({...options,productionModelPolicy:policy as ProductionModelPolicy}),/formal_model_policy_untrusted/);
 }
 assert.equal(inspected,0);assert.equal(touches(),0);assert.equal(existsSync(join(directory,'untouched')),false);
});

test('formal entry rejects array-like provider input without calling its iterator',async t=>{
 const {directory,options}=fixture(t),touches=socketForbidden(t);let iterated=0;
 const providers={length:0,*[Symbol.iterator](){iterated++;yield {model:P.model,key:'SYNTHETIC-NOT-A-CREDENTIAL'};}};
 await assert.rejects(startFormalServer({...options,providers:providers as unknown as ModelConnection[]}),/formal_model_providers_disabled/);
 assert.equal(iterated,0);assert.equal(touches(),0);assert.equal(existsSync(join(directory,'untouched')),false);
});

test('formal startup never reuses a caller-owned provider array after asynchronous admission',async t=>{
 const {options}=fixture(t);let credentials=0;
 t.mock.method(Server.prototype,'listen',function(this:Server,...args:unknown[]){
  const listening=args.at(-1) as ()=>void;
  queueMicrotask(()=>{options.providers.push({model:P.model,get key():string{credentials++;throw new Error('test_credential_touched');}});listening();});return this;
 });
 const running=await startFormalServer(options);t.after(()=>running.close());
 assert.equal(credentials,0);assert.equal(running.runtime.world.metrics.configured,false);assert.equal(running.runtime.world.clock.paused,true);
 let body='';running.server.emit('request',{method:'GET',url:'/ai-town/api/health',headers:{}},
  {setHeader(){},writeHead(status:number){assert.equal(status,200);},end(value:string){body=value;}});
 const health=JSON.parse(body);assert.equal(health.ok,true);assert.equal(health.ready,false);
 assert.equal(health.modelExecution.state,'no-model');assert.equal(health.modelExecution.liveExecutionEnabled,false);
 assert.equal(health.modelExecution.actualProviderCostCny,null);
});

test('formal startup exposes only the exact frozen policy accepted before startup',async t=>{
 const {options}=fixture(t),policy=readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only',VALLEY_MODEL_PROVIDER:P.provider,VALLEY_MODEL_ID:P.model});
 assert.equal(Object.isFrozen(policy),true);
 t.mock.method(Server.prototype,'listen',function(this:Server,...args:unknown[]){queueMicrotask(args.at(-1) as ()=>void);return this;});
 const running=await startFormalServer({...options,productionModelPolicy:policy});t.after(()=>running.close());
 let body='';running.server.emit('request',{method:'GET',url:'/ai-town/api/health',headers:{}},
  {setHeader(){},writeHead(){},end(value:string){body=value;}});
 assert.deepEqual(JSON.parse(body).modelExecution,policy);assert.equal(running.runtime.world.metrics.configured,false);
});
