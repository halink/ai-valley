// Trusted-code defense in depth. Allows only exact SiliconFlow POST fetch and
// otherwise denies network plus credential/existing-world path reads. Not an OS sandbox.
import fs from 'node:fs';import fsp from 'node:fs/promises';import net from 'node:net';import tls from 'node:tls';
import http from 'node:http';import https from 'node:https';import http2 from 'node:http2';import dgram from 'node:dgram';
import dns from 'node:dns';import dnsPromises from 'node:dns/promises';import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';import {assertOfflineSourceTree} from './acceptance-offline-preflight.mjs';
assertOfflineSourceTree(fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''));
const endpoint='https://api.siliconflow.cn/v1/chat/completions',model='deepseek-ai/DeepSeek-R1-0528-Qwen3-8B';
// Native fetch needs its own internal DNS/TCP implementation. Patching all net
// constructors would also break the only authorized request. Instead expose a
// narrow fetch gate and block public alternate network entrypoints.
const nativeFetch=globalThis.fetch;
Object.defineProperty(globalThis,'fetch',{writable:false,configurable:false,value:(url,init)=>{
 if(url!==endpoint||init?.method!=='POST'||init?.redirect!=='error'||!(init.signal instanceof AbortSignal)||typeof init.body!=='string')throw new Error('live_endpoint_forbidden');
 let body;try{body=JSON.parse(init.body);}catch{throw new Error('live_body_forbidden');}
 if(body.model!==model||body.stream!==false||!Array.isArray(body.messages)||Buffer.byteLength(init.body)>64_000)throw new Error('live_model_forbidden');
 return nativeFetch(url,init);
}});
const denied=()=>{throw new Error('live_alternate_network_forbidden');};
for(const[target,keys]of [[globalThis,['WebSocket']],[net,['connect','createConnection']],[net.Server.prototype,['listen']],
 [http,['request','get']],[https,['request','get']],[http2,['connect']],[dgram,['createSocket']]])for(const key of keys)Object.defineProperty(target,key,{value:denied,writable:false,configurable:false});
// Do not claim a hostile-code sandbox: native fetch internals still use lower
// level network APIs. The frozen exact endpoint gate is for reviewed local code.
function checked(path){if(typeof path==='number')return;const text=path instanceof URL?decodeURIComponent(path.pathname):Buffer.isBuffer(path)?path.toString():path;
 if(typeof text==='string'&&text.split(/[\\/]/).some(p=>['runtime','secrets','.git','.aws','.ssh'].includes(p)||p.startsWith('.env')||/\.(key|pem|p12)$/i.test(p)))throw new Error('live_credentials_or_save_forbidden');}
for(const[target,keys]of [[fs,['openSync','open','readFileSync','readFile','createReadStream','readdirSync','readdir','statSync','lstatSync','realpathSync','readlinkSync']],
 [fsp,['open','readFile','readdir','stat','lstat','realpath','readlink']]])for(const key of keys){const original=target[key];target[key]=function(path,...args){checked(path);return original.call(this,path,...args);};}
if(process.loadEnvFile)process.loadEnvFile=()=>{throw new Error('live_credentials_or_save_forbidden');};
syncBuiltinESMExports();Object.defineProperty(globalThis,'__valleyLiveGuard',{value:true,writable:false,configurable:false});
