import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LazyModule} from '../src/client/lazy-module.js';

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}

test('optional modules stay idle until requested, share one in-flight load and cache success',async()=>{
 const pending=deferred<{label:string}>();let calls=0,changes=0;
 const module=new LazyModule(()=>{calls++;return pending.promise;},()=>changes++);
 await settle();assert.equal(calls,0);assert.equal(module.status,'idle');
 const first=module.request();assert.equal(module.status,'loading');
 assert.equal(module.request(),first);assert.equal(module.request(true),first);
 await settle();assert.equal(calls,1);assert.equal(changes,0);
 const value={label:'ready'};pending.resolve(value);await first;
 assert.equal(module.value,value);assert.equal(module.status,'ready');assert.equal(changes,1);
 await module.request();await module.request(true);assert.equal(calls,1);assert.equal(changes,1);
});

test('failed loads are handled and remain failed through repeated updates until an explicit retry',async()=>{
 const first=deferred<{label:string}>(),second=deferred<{label:string}>();let calls=0,changes=0;
 const module=new LazyModule(()=>++calls===1?first.promise:second.promise,()=>changes++);
 const load=module.request();first.reject(new Error('chunk unavailable'));await load;
 assert.equal(module.status,'error');assert.equal(module.value,null);assert.equal(changes,1);
 for(let i=0;i<5;i++)await module.request();assert.equal(calls,1);
 const retry=module.request(true);assert.equal(module.status,'loading');assert.equal(module.request(true),retry);
 second.resolve({label:'recovered'});await retry;
 assert.equal(calls,2);assert.equal(module.status,'ready');assert.equal(changes,2);
});

test('synchronous importer failures also become a retryable loading error',async()=>{
 const module=new LazyModule(()=>{throw new Error('loader failed');},()=>{});
 await module.request();assert.equal(module.status,'error');assert.equal(module.value,null);
});
