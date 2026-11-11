import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,statSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {basename,dirname} from 'node:path';
import {previewTmpdir} from '../scripts/repository-temporary.mjs';
import {createPreviewSession,PREVIEW_PORT,rejectPreviewModel} from '../src/server/preview.js';

const launcher=await import(new URL('../scripts/dev-preview.mjs',import.meta.url).href);
const web=await import(new URL('../scripts/dev-preview-web.mjs',import.meta.url).href);
const poisoned={NODE_OPTIONS:'--import /not-a-real-preload.mjs',NODE_PATH:'/not-a-real-module-path',
 VALLEY_DB:'runtime/formal.sqlite',VALLEY_KEY_FILE:'/not-a-real-key.json',VALLEY_DASHSCOPE_KEY_FILE:'/not-a-real-key',
 DASHSCOPE_API_KEY:'synthetic-only',SILICONFLOW_API_KEY:'synthetic-only',VITE_PRIVATE:'synthetic-only',
 PORT:'3412',HOME:'/not-a-real-home',TMPDIR:'/not-a-real-temp',HTTP_PROXY:'http://invalid.test',PATH:'/not-a-real-bin',
 npm_config_node_options:'--env-file=/not-a-real-env',SystemRoot:'synthetic-system-root'};

test('preview launch discards credential, environment loader and formal database configuration',()=>{
 const launch=launcher.previewLaunch([],poisoned);
 assert.deepEqual(launch.options.env,{SystemRoot:'synthetic-system-root'});
 assert.equal(launch.executable,process.execPath);assert.equal(launch.options.shell,false);
 assert.equal(basename(launch.args.at(-1)),'preview-main.ts');
 assert.equal(launch.args.includes('--watch'),false);
 assert.equal(PREVIEW_PORT,3413);
 const child=spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.env))'],{env:launch.options.env,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),launch.options.env);
});

test('preview refuses overrides instead of opening an existing save or environment file',()=>{
 for(const args of [['--db','runtime/formal.sqlite'],['--env-file=.env'],['--port=3412'],['--web','--host=0.0.0.0']]){
  assert.throws(()=>launcher.previewLaunch(args,poisoned),/not supported/);
 }
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/dev-preview.mjs',import.meta.url)),'--db','runtime/formal.sqlite'],{env:{},encoding:'utf8'});
 assert.equal(child.status,1);assert.match(child.stderr,/not supported/);assert.equal(child.stdout,'');
});

test('preview web configuration disables env/config loading and never proxies to the formal port',()=>{
 const config=web.previewWebConfig;
 assert.equal(config.configFile,false);assert.equal(config.envFile,false);
 assert.equal(config.server.host,'127.0.0.1');assert.equal(config.server.strictPort,true);
 assert.deepEqual(config.server.proxy,{'/ai-town/api':'http://127.0.0.1:3413'});
 const launch=launcher.previewLaunch(['--web'],poisoned);
 assert.equal(basename(launch.args.at(-1)),'dev-preview-web.mjs');
 assert.deepEqual(launch.options.env,{SystemRoot:'synthetic-system-root'});
});

test('preview sessions use separate new SQLite worlds, no network or clock, and clean up only their own files',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Network forbidden');});
 const first=createPreviewSession(),second=createPreviewSession();
 t.after(()=>{first.close();second.close();});
 assert.notEqual(first.database,second.database);
 for(const session of [first,second]){
  assert.equal(dirname(session.directory),previewTmpdir());
  assert.ok(existsSync(session.database));assert.equal(basename(session.database),'preview.sqlite');
  assert.equal(session.runtime.world.metrics.configured,false);
  assert.equal(session.runtime.world.clock.paused,true);
  assert.equal(session.runtime.world.residents.length,9);
  assert.equal(session.store.loadForRuntime()!.minute,session.runtime.world.minute);
  if(process.platform!=='win32'){
   assert.equal(statSync(session.directory).mode&0o777,0o700);
   assert.equal(statSync(session.database).mode&0o777,0o600);
  }
 }
 const before=first.runtime.world.minute;
 first.runtime.tick(Date.now()+60000);
 assert.equal(first.runtime.world.minute,before);assert.equal(calls,0);
 await assert.rejects(rejectPreviewModel(),/disabled/);
 first.close();first.close();assert.equal(existsSync(first.directory),false);
 assert.ok(existsSync(second.database));assert.equal(calls,0);
});

test('default development scripts target the isolated entry, leaving formal startup explicit',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts.dev,'node scripts/dev-preview.mjs');
 assert.equal(pkg.scripts['dev:web'],'node scripts/dev-preview.mjs --web');
 assert.equal(pkg.scripts['dev:formal'],'tsx watch src/server/main.ts');
 assert.equal(pkg.scripts.start,'node build/server/main.js');
 assert.equal(pkg.engines.node,'>=22.13.0');
});
