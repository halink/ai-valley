/** No credentials, real archives or network. Each child installs throwing
 * sentinels before importing an entrypoint; child-process counts exclude the
 * test harness's own spawn. Legacy successful synthetic lifecycles remain in
 * acceptance-live-probe-review.test.ts. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// @ts-expect-error Pure internal .mjs policy has no declaration file.
import {LEGACY_LIVE_PROBE_DISABLED,assertLegacySyntheticScenario} from '../scripts/acceptance-legacy-live-policy.mjs';
const root=new URL('../',import.meta.url);
const zero={credentials:0,pipe:0,spawn:0,network:0,writes:0};
function guardedEntry(entry:string,args:string[],options:{reader?:boolean;environment?:boolean;throwClock?:boolean;legacyBootstrap?:boolean}={}){
 const url=new URL(`scripts/${entry}`,root),path=fileURLToPath(url);
 const script=`
 import fs from 'node:fs';import fsp from 'node:fs/promises';import cp from 'node:child_process';
 import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';
 import http2 from 'node:http2';import dgram from 'node:dgram';import dns from 'node:dns';import dnsPromises from 'node:dns/promises';
 import {syncBuiltinESMExports} from 'node:module';
 const counts=${JSON.stringify(zero)};
 const forbidden=kind=>(...args)=>{counts[kind]++;throw new Error('sentinel_'+kind);};
 for(const [target,keys]of [[cp,['spawn','spawnSync','fork','exec','execSync','execFile','execFileSync']],
 [globalThis,['fetch','WebSocket']],[net,['connect','createConnection']],[net.Socket.prototype,['connect']],
 [net.Server.prototype,['listen']],[tls,['connect']],[http,['request','get']],[https,['request','get']],
 [http2,['connect']],[dgram,['createSocket']],[dgram.Socket.prototype,['send','connect','bind']],
 [dns,Object.keys(dns).filter(k=>k==='lookup'||k==='lookupService'||k.startsWith('resolve'))],
 [dnsPromises,Object.keys(dnsPromises).filter(k=>k==='lookup'||k==='lookupService'||k.startsWith('resolve'))],
 [dns.Resolver.prototype,Object.getOwnPropertyNames(dns.Resolver.prototype).filter(k=>k.startsWith('resolve'))],
 [dnsPromises.Resolver.prototype,Object.getOwnPropertyNames(dnsPromises.Resolver.prototype).filter(k=>k.startsWith('resolve'))]]){
  for(const key of keys)target[key]=forbidden(target===cp?'spawn':'network');
 }
 function checked(path){const value=path instanceof URL?path.pathname:Buffer.isBuffer(path)?path.toString():path;
  if(typeof value==='string'&&value.split(/[\\\\/]/).some(p=>p.startsWith('.env')||['runtime','secrets','.aws','.ssh'].includes(p)||/\\.(key|pem|p12)$/i.test(p)))forbidden('credentials')();}
 for(const[target,keys]of [[fs,['openSync','open','readFileSync','readFile','createReadStream','readdirSync','readdir','statSync','lstatSync','realpathSync','readlinkSync']],
 [fsp,['open','readFile','readdir','stat','lstat','realpath','readlink']]])for(const key of keys){const original=target[key];target[key]=function(path,...args){
  checked(path);if(key==='createReadStream'&&[3,5].includes(args[0]?.fd))forbidden('pipe')();return original.call(this,path,...args);};}
 for(const[target,keys]of [[fs,['mkdirSync','mkdir','writeFileSync','writeFile','createWriteStream']],
 [fsp,['mkdir','writeFile']]])for(const key of keys)target[key]=forbidden('writes');
 if(process.loadEnvFile)process.loadEnvFile=forbidden('credentials');
 syncBuiltinESMExports();
 ${options.legacyBootstrap?"globalThis.__valleyOfflineGuard=true;globalThis.__valleyLiveGuard=true;process.send=()=>true;":''}
 ${options.environment?"process.env.SYNTHETIC_UNEXPECTED='yes';":''}
 ${options.throwClock?"Date.now=()=>{throw new Error('PRIVATE_FAKE_ERROR_NOT_FOR_OUTPUT');};":''}
 ${options.reader?'':`process.argv=[process.execPath,${JSON.stringify(path)},...${JSON.stringify(args)}];`}
 try{const module=await import(${JSON.stringify(url.href)});${options.reader?"module.readConfiguredSiliconFlowKey();":''}}
 catch(error){console.error(error.message);process.exitCode=2;}
 console.log('SAFETY_COUNTS='+JSON.stringify(counts));`;
 const run=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:'/',env:{},encoding:'utf8',timeout:5000});
 assert.equal(run.error,undefined,JSON.stringify(run.error));assert.equal(run.signal,null,run.stderr);
 const line=run.stdout.split('\n').find(value=>value.startsWith('SAFETY_COUNTS='));assert.ok(line,run.stdout+run.stderr);
 assert.deepEqual(JSON.parse(line.slice('SAFETY_COUNTS='.length)),zero,run.stdout+run.stderr);
 return run;
}
const legacyArgs=(output='/tmp/synthetic-legacy-must-not-create')=>['--live-probe','--approved-fictional-data','--price-observed-at',String(Date.now()),'--output',output];
test('old valid CLI is rejected with no credential, pipe, child, network or output writes',()=>{
 const run=guardedEntry('run-nine-siliconflow-live.mjs',legacyArgs());
 assert.equal(run.status,2);assert.equal(run.stderr.trim(),LEGACY_LIVE_PROBE_DISABLED);
});
test('new output directories cannot reset the retired live request budget',()=>{
 for(const output of ['/tmp/synthetic-fresh-run-a','/tmp/synthetic-fresh-run-b']){
  const run=guardedEntry('run-nine-siliconflow-live.mjs',legacyArgs(output));assert.equal(run.status,2);assert.equal(run.stderr.trim(),LEGACY_LIVE_PROBE_DISABLED);
 }
});
test('compatibility credential-reader export cannot read even when called directly',()=>{
 const run=guardedEntry('run-nine-siliconflow-live.mjs',[],{reader:true});assert.equal(run.status,2);assert.equal(run.stderr.trim(),LEGACY_LIVE_PROBE_DISABLED);
});
test('old malformed, stale, future, extra and nonempty-environment errors remain closed and specific',()=>{
 const stale=legacyArgs();stale[3]=String(Date.now()-13*60_000);
 const future=legacyArgs();future[3]=String(Date.now()+60_000);
 const invalidTime=legacyArgs();invalidTime[3]='not-a-time';
 for(const args of [[],['--live-probe'],legacyArgs('relative'),[...legacyArgs(),'--override']]){
  const run=guardedEntry('run-nine-siliconflow-live.mjs',args);assert.equal(run.status,2);assert.equal(run.stderr.trim(),'explicit_live_probe_arguments_required');
 }
 for(const args of [stale,future,invalidTime]){
  const run=guardedEntry('run-nine-siliconflow-live.mjs',args);assert.equal(run.status,2);assert.equal(run.stderr.trim(),'fresh_official_price_check_required');
 }
 const run=guardedEntry('run-nine-siliconflow-live.mjs',legacyArgs(),{environment:true});assert.equal(run.status,2);assert.equal(run.stderr.trim(),'empty_launch_environment_required');
});
test('unexpected internal errors are sanitized without credential or process fallback',()=>{
 const run=guardedEntry('run-nine-siliconflow-live.mjs',legacyArgs(),{throwClock:true});assert.equal(run.status,2);assert.equal(run.stderr.trim(),'live_probe_not_started');
});
for(const scenario of [undefined,'live'])test(`direct guardian ${scenario??'default'} cannot bypass retirement`,()=>{
 const args=['/tmp/synthetic-direct-guardian-must-not-create',String(Date.now()),...(scenario?[scenario]:[])];
 const run=guardedEntry('acceptance-live-guardian.mjs',args,{legacyBootstrap:true});assert.equal(run.status,1);
 const result=JSON.parse(run.stdout.split('\n')[0]);assert.equal(result.type,'live_probe_setup_failed');assert.equal(result.reason,LEGACY_LIVE_PROBE_DISABLED);
 assert.equal(result.actualProviderCostUsd,null);assert.equal(result.acceptancePassed,null);
});
test('direct live worker rejects before importing runtime, inheriting output or reading key pipe',()=>{
 const run=guardedEntry('acceptance-live-worker.mjs',['a'.repeat(64),String(Date.now()),'live'],{legacyBootstrap:true});assert.equal(run.status,2);assert.equal(run.stderr.trim(),LEGACY_LIVE_PROBE_DISABLED);
});
test('synthetic scenarios retain their exact allowlist and cannot run without offline bootstrap',()=>{
 for(const scenario of ['synthetic','stall_headers','init_block','sync_block','http_failure'])assert.doesNotThrow(()=>assertLegacySyntheticScenario(scenario));
 for(const scenario of [undefined,'LIVE','live-http','mock','synthetic-live',''])assert.throws(()=>assertLegacySyntheticScenario(scenario),/live_bootstrap_required/);
 for(const entry of ['acceptance-live-guardian.mjs','acceptance-live-worker.mjs']){
  const run=guardedEntry(entry,['a'.repeat(64),String(Date.now()),'synthetic']);assert.notEqual(run.status,0);
  if(entry.includes('worker'))assert.equal(run.stderr.trim(),'live_bootstrap_required');
  else assert.equal(JSON.parse(run.stdout.split('\n')[0]).type,'live_probe_setup_failed');
 }
});
