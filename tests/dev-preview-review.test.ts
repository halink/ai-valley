import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {testTmpdir,previewTmpdir} from '../scripts/repository-temporary.mjs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPreviewSession} from '../src/server/preview.js';
import {WorldStore} from '../src/server/store.js';

const launcher=await import(new URL('../scripts/dev-preview.mjs',import.meta.url).href);
const web=await import(new URL('../scripts/dev-preview-web.mjs',import.meta.url).href);

test('independent review: environment allowlist drops case variants and inherited properties',()=>{
 const source=Object.assign(Object.create({SystemRoot:'inherited-not-own',VALLEY_DB:'synthetic.db'}),{
  node_options:'--require=synthetic',Node_Options:'synthetic',NODE_EXTRA_CA_CERTS:'synthetic',
  SSL_CERT_FILE:'synthetic',LD_PRELOAD:'synthetic',DYLD_INSERT_LIBRARIES:'synthetic',
  VITE_API_URL:'http://invalid.test',TMP:'synthetic',TEMP:'synthetic',TMPDIR:'synthetic',
  npm_config_script_shell:'synthetic',PATH:'synthetic',windir:'synthetic-bootstrap',SystemRoot:42,
 });
 assert.deepEqual(launcher.previewEnvironment(source),{windir:'synthetic-bootstrap'});
 assert.equal(source.Node_Options,'synthetic');
});

test('independent review: no extra argument is forwarded and entry paths ignore caller cwd',()=>{
 for(const args of [['--'],['--web=1'],['--web','--web'],['--import=synthetic'],['--env-file','synthetic'],['--web','synthetic'],[''],['--help']]){
  assert.throws(()=>launcher.previewLaunch(args,{}));
 }
 for(const args of [[],['--web']]){
  const launch=launcher.previewLaunch(args,{});
  assert.equal(launch.options.cwd,fileURLToPath(new URL('../',import.meta.url)));
  assert.equal(launch.options.shell,false);
  assert.equal(launch.executable,process.execPath);
  assert.ok(isAbsolute(launch.args.at(-1)));
 }
});

test('independent review: runtime initialization failure removes its fresh directory',t=>{
 let created:string|undefined;
 t.mock.method(WorldStore.prototype,'loadForRuntime',function(this:WorldStore){
  const row=(this as unknown as {db:import('node:sqlite').DatabaseSync}).db.prepare('PRAGMA database_list').get() as {file:string};
  created=dirname(row.file);
  assert.equal(dirname(created),previewTmpdir());
  assert.ok(existsSync(row.file));
  throw new Error('synthetic runtime initialization failure');
 });
 assert.throws(()=>createPreviewSession(),/synthetic runtime initialization failure/);
 assert.ok(created,'the failure must occur after a fresh SQLite file is created');
 assert.equal(existsSync(created),false);
});

test('independent review: runtime stop failure still closes SQLite and removes temporary files',t=>{
 const session=createPreviewSession();
 t.after(()=>session.close());
 let closed=false;
 const close=session.store.close.bind(session.store);
 t.mock.method(session.store,'close',()=>{close();closed=true;});
 t.mock.method(session.runtime,'stop',()=>{throw new Error('synthetic stop failure');});
 assert.throws(()=>session.close(),/synthetic stop failure/);
 assert.equal(closed,true);
 assert.equal(existsSync(session.directory),false);
 assert.doesNotThrow(()=>session.close());
});

test('independent review: close failure still removes temporary files',t=>{
 const session=createPreviewSession();
 t.after(()=>session.close());
 const close=session.store.close.bind(session.store);
 t.mock.method(session.store,'close',()=>{close();throw new Error('synthetic close failure');});
 assert.throws(()=>session.close(),/synthetic close failure/);
 assert.equal(existsSync(session.directory),false);
});

test('independent review: cleanup does not follow a symlink or junction to another synthetic directory',t=>{
 const outside=mkdtempSync(join(testTmpdir(),'preview-review-neighbor-'));
 const marker=join(outside,'synthetic.txt');writeFileSync(marker,'synthetic-only');
 const session=createPreviewSession();
 t.after(()=>{session.close();rmSync(outside,{recursive:true,force:true});});
 symlinkSync(outside,join(session.directory,'neighbor'),process.platform==='win32'?'junction':'dir');
 assert.equal(basename(session.database),'preview.sqlite');
 assert.equal(resolve(session.database),join(resolve(session.directory),'preview.sqlite'));
 session.close();
 assert.equal(readFileSync(marker,'utf8'),'synthetic-only');
 assert.equal(existsSync(session.directory),false);
});

test('independent review: web configuration does not import project config or environment files',()=>{
 assert.equal(web.previewWebConfig.configFile,false);
 assert.equal(web.previewWebConfig.envFile,false);
 assert.equal(web.previewWebConfig.server.host,'127.0.0.1');
 assert.equal(web.previewWebConfig.server.port,5173);
 assert.equal(web.previewWebConfig.server.strictPort,true);
 assert.deepEqual(web.previewWebConfig.server.proxy,{'/ai-town/api':'http://127.0.0.1:3413'});
});

test('independent review: preview file policy denies known credentials, archives and runtime outputs',()=>{
 const fs=web.previewWebConfig.server.fs;
 assert.equal(fs.strict,true);
 assert.deepEqual(fs.allow,[web.previewWebConfig.root]);
 for(const pattern of ['**/.env','**/.env.*','**/*.{crt,pem,key,p12}','**/.git/**','**/secrets/**','**/runtime/**','**/output/**','**/*.{sqlite,sqlite3,db}','**/*.{sqlite,sqlite3,db}-*','**/*.log']){
  assert.ok(fs.deny.includes(pattern),`missing preview denial: ${pattern}`);
 }
});

// Compile only the entry's source into a VM with inert injected dependencies.
// This neither imports the real HTTP module nor creates or listens on a server.
import {runInNewContext} from 'node:vm';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
const backendEntry=ts.transpileModule(readFileSync(new URL('../src/server/preview-main.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function inertBackend(constructionFails=false){
 let closes=0,connectionsClosed=0,serverClosed=0,listens=0;
 const processStub=Object.assign(new EventEmitter(),{argv:['node','synthetic-entry'],exitCode:0});
 const server=Object.assign(new EventEmitter(),{
  listen(port:number,host:string){assert.equal(port,3413);assert.equal(host,'127.0.0.1');listens++;},
  closeAllConnections(){connectionsClosed++;},
  close(callback:()=>void){serverClosed++;callback();},
 });
 const preview={runtime:{},store:{},database:'synthetic-only',close(){closes++;}};
 const execute=()=>runInNewContext(backendEntry,{
  exports:{},process:processStub,console:{log(){},error(){}},
  require(name:string){
   if(name==='node:path')return {resolve:()=>'/synthetic-dist'};
   if(name==='./preview.js')return {PREVIEW_PORT:3413,createPreviewSession:()=>preview};
   if(name==='./http.js')return {createObserverServer:()=>{if(constructionFails)throw new Error('synthetic construction failure');return server;}};
   throw new Error(`Unexpected dependency: ${name}`);
  },
 });
 return {execute,processStub,server,counts:()=>({closes,connectionsClosed,serverClosed,listens})};
}

test('independent review: injected observer construction failure closes the preview session',()=>{
 const harness=inertBackend(true);
 assert.throws(harness.execute,/synthetic construction failure/);
 assert.deepEqual(harness.counts(),{closes:1,connectionsClosed:0,serverClosed:0,listens:0});
});

test('independent review: injected listen error cleans session and marks failure',()=>{
 const harness=inertBackend();harness.execute();
 harness.server.emit('error',new Error('synthetic address conflict'));
 assert.equal(harness.counts().closes,1);
 assert.equal(harness.processStub.exitCode,1);
});

test('independent review: injected repeated shutdown signals close connections and session once',()=>{
 const harness=inertBackend();harness.execute();
 harness.processStub.emit('SIGINT');harness.processStub.emit('SIGTERM');
 assert.deepEqual(harness.counts(),{closes:1,connectionsClosed:1,serverClosed:1,listens:1});
});

test('independent review: public directory bypass is disabled and aliases register before normal middleware',()=>{
 assert.equal(web.previewWebConfig.publicDir,false);
 const registered:unknown[]=[];
 const plugin=web.previewWebConfig.plugins.find((entry:{name:string})=>entry.name==='preview-public-assets');
 assert.ok(plugin);
 // A direct registration, rather than a returned post-hook, runs before Vite internals.
 const postHook=plugin.configureServer({middlewares:{use(callback:unknown){registered.push(callback);}}});
 assert.equal(postHook,undefined);
 assert.deepEqual(registered,[web.previewPublicAssets]);
});

test('independent review: only exact fixed public aliases are rewritten and query bytes survive',()=>{
 for(const file of ['favicon.svg','THIRD_PARTY_NOTICES.txt']){
  for(const query of ['', '?v=2', '?raw&x=%2f..%2f&x=a+b?tail']){
   const req={url:`/ai-town/${file}${query}`};let calls=0;
   web.previewPublicAssets(req,{},()=>calls++);
   assert.equal(req.url,`/ai-town/public/${file}${query}`);
   assert.equal(calls,1);
   web.previewPublicAssets(req,{},()=>calls++);
   assert.equal(req.url,`/ai-town/public/${file}${query}`);
   assert.equal(calls,2);
  }
 }
});

test('independent review: unknown, traversal and database paths are never public aliases',()=>{
 for(const url of [undefined,'','/favicon.svg','/ai-town/FAVICON.svg','/ai-town/%66avicon.svg',
  '/ai-town/favicon.svg/extra','/ai-town/favicon.svg#fragment','/ai-town/../favicon.svg',
  '/ai-town/%2e%2e/favicon.svg','/ai-town/public/favicon.svg','/ai-town/public/../runtime/synthetic.sqlite',
  '/ai-town/synthetic.sqlite','/ai-town/runtime/synthetic.db?raw','/ai-town/.env',
  '//ai-town/favicon.svg','http://invalid.test/ai-town/favicon.svg','/ai-town/THIRD_PARTY_NOTICES.txt.bak']){
  const req={url};let calls=0;
  web.previewPublicAssets(req,{},()=>calls++);
  assert.equal(req.url,url);
  assert.equal(calls,1);
 }
});

test('independent review: discarded secret values are never read even through getters',()=>{
 const source:Record<string,unknown>={SystemRoot:'synthetic-bootstrap'};
 let reads=0;
 for(const key of ['DASHSCOPE_API_KEY','VALLEY_DB','NODE_OPTIONS','VITE_SECRET','PATH','HOME']){
  Object.defineProperty(source,key,{enumerable:true,get(){reads++;throw new Error('discarded value must not be read');}});
 }
 assert.deepEqual(launcher.previewEnvironment(source),{SystemRoot:'synthetic-bootstrap'});
 assert.equal(reads,0);
});
