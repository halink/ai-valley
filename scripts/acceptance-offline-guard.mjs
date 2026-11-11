// Defense in depth for trusted offline code, not a hostile-code/OS sandbox.
// Preloaded before tsx and runtime. Never inspect credential values or files.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {assertOfflineSourceTree} from './acceptance-offline-preflight.mjs';
assertOfflineSourceTree(fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''));
const denied=()=>{throw new Error('offline_network_forbidden');};
for(const [target,keys] of [[globalThis,['fetch','WebSocket']],[net,['connect','createConnection']],[net.Socket.prototype,['connect']],
 [net.Server.prototype,['listen']],[tls,['connect']],[http,['request','get']],[https,['request','get']],[http2,['connect']],
 [dgram,['createSocket']],[dgram.Socket.prototype,['send','connect','bind']],
 [dns,['lookup','lookupService',...Object.keys(dns).filter(k=>k.startsWith('resolve'))]],
 [dnsPromises,Object.keys(dnsPromises).filter(k=>k==='lookup'||k==='lookupService'||k.startsWith('resolve'))],
 [dns.Resolver.prototype,Object.getOwnPropertyNames(dns.Resolver.prototype).filter(k=>k.startsWith('resolve'))],
 [dnsPromises.Resolver.prototype,Object.getOwnPropertyNames(dnsPromises.Resolver.prototype).filter(k=>k.startsWith('resolve'))]]){
 for(const key of keys)Object.defineProperty(target,key,{value:denied,writable:false,configurable:false});
}
function checked(path){
 if(typeof path==='number')return;
 const text=path instanceof URL?decodeURIComponent(path.pathname):Buffer.isBuffer(path)?path.toString():path;
 if(typeof text==='string'&&text.split(/[\\/]/).some(p=>['runtime','secrets','.git','.aws','.ssh'].includes(p)||p.startsWith('.env')||/\.(key|pem|p12)$/i.test(p)))
  throw new Error('offline_credentials_or_save_forbidden');
}
for(const [target,keys] of [[fs,['openSync','open','readFileSync','readFile','createReadStream','readdirSync','readdir','statSync','lstatSync','realpathSync','readlinkSync']],
 [fsp,['open','readFile','readdir','stat','lstat','realpath','readlink']]]){
 for(const key of keys){const original=target[key];target[key]=function(path,...args){checked(path);return original.call(this,path,...args);};}
}
if(process.loadEnvFile)process.loadEnvFile=()=>{throw new Error('offline_credentials_or_save_forbidden');};
syncBuiltinESMExports();
Object.defineProperty(globalThis,'__valleyOfflineGuard',{value:true,writable:false,configurable:false});
