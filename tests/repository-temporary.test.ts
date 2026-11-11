import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {testTmpdir,previewTmpdir} from '../scripts/repository-temporary.mjs';
import {checkedFixtureRoot} from './helpers/acceptance-supervisor-fixture.js';

const repository=resolve(fileURLToPath(new URL('../',import.meta.url)));
function temporary(t:TestContext,prefix='repository-path-review-'){
 const root=mkdtempSync(join(testTmpdir(),prefix));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;
}
async function syntheticRepository(t:TestContext){
 const root=temporary(t),scripts=join(root,'scripts');mkdirSync(scripts);
 const helper=join(scripts,'repository-temporary.mjs');copyFileSync(new URL('../scripts/repository-temporary.mjs',import.meta.url),helper);
 return {root,helper,module:await import(pathToFileURL(helper).href)};
}
test('fixed temporary roots stay in ignored repo locations and fixtures stay unique',t=>{
 assert.equal(testTmpdir(),join(repository,'output','test-tmp'));
 assert.equal(previewTmpdir(),join(repository,'runtime','dev-preview'));
 const first=temporary(t),second=temporary(t);assert.notEqual(first,second);
 assert.equal(dirname(first),testTmpdir());assert.equal(dirname(second),testTmpdir());
 writeFileSync(join(second,'synthetic.txt'),'untouched');rmSync(first,{recursive:true});
 assert.equal(readFileSync(join(second,'synthetic.txt'),'utf8'),'untouched');
});
test('temporary locations ignore caller cwd and hostile environment overrides',async t=>{
 const f=await syntheticRepository(t);
 const child=spawnSync(process.execPath,['--input-type=module','-e',
  `import {testTmpdir,previewTmpdir} from ${JSON.stringify(pathToFileURL(f.helper).href)};console.log(JSON.stringify([testTmpdir(),previewTmpdir()]));`],{
  cwd:dirname(repository),env:{TMPDIR:'/not-a-real-temp',TMP:'/not-a-real-temp',TEMP:'/not-a-real-temp'},encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout),[join(f.root,'output','test-tmp'),join(f.root,'runtime','dev-preview')]);
});
for(const [parent,leaf,method] of [['output','test-tmp','testTmpdir'],['runtime','dev-preview','previewTmpdir']] as const){
 for(const level of ['parent','leaf'] as const)test(`temporary ${method} rejects a ${level} symlink without touching its target`,async t=>{
  const f=await syntheticRepository(t),outside=temporary(t),marker=join(outside,'synthetic.txt');writeFileSync(marker,'untouched');
  if(level==='leaf')mkdirSync(join(f.root,parent));
  symlinkSync(outside,join(f.root,parent,...(level==='leaf'?[leaf]:[])),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>f.module[method](),/unsafe_repository_temporary_directory/);
  assert.equal(readFileSync(marker,'utf8'),'untouched');assert.equal(existsSync(join(outside,leaf)),false);
 });
 test(`temporary ${method} rejects an existing file`,async t=>{
  const f=await syntheticRepository(t);writeFileSync(join(f.root,parent),'synthetic-file');
  assert.throws(()=>f.module[method](),/unsafe_repository_temporary_directory/);
  assert.equal(readFileSync(join(f.root,parent),'utf8'),'synthetic-file');
 });
}
test('supervisor accepts only real, correctly named direct children of the test root',t=>{
 const root=temporary(t,'valley-supervisor-fixture-');assert.doesNotThrow(()=>checkedFixtureRoot(root));
 assert.throws(()=>checkedFixtureRoot(testTmpdir()),/synthetic_fixture_root_required/);
 assert.throws(()=>checkedFixtureRoot(temporary(t,'wrong-prefix-')),/synthetic_fixture_root_required/);
 const nested=join(temporary(t),basename(root));mkdirSync(nested);
 assert.throws(()=>checkedFixtureRoot(nested),/synthetic_fixture_root_required/);
 const alias=join(testTmpdir(),`${basename(root)}-link`);symlinkSync(root,alias,'dir');t.after(()=>rmSync(alias,{force:true}));
 assert.throws(()=>checkedFixtureRoot(alias),/synthetic_fixture_root_required/);
 assert.throws(()=>checkedFixtureRoot(join(repository,'runtime',basename(root))));
});

async function syntheticRunner(t:TestContext,source?:string){
 const f=await syntheticRepository(t);
 copyFileSync(new URL('../scripts/test.mjs',import.meta.url),join(f.root,'scripts','test.mjs'));
 if(source!==undefined){
  mkdirSync(join(f.root,'tests'));
  writeFileSync(join(f.root,'tests','synthetic.test.ts'),source);
  const loader=join(f.root,'node_modules','tsx','dist');mkdirSync(loader,{recursive:true});
  writeFileSync(join(loader,'loader.mjs'),`import ${JSON.stringify(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url).href)};`);
 }
 const run=spawnSync(process.execPath,[join(f.root,'scripts','test.mjs'),'--test-concurrency=1'],{
  cwd:repository,env:{},encoding:'utf8',timeout:15000});
 return {...f,run};
}
test('test launcher contains tool temp/home and forwards options before test files',async t=>{
 const f=await syntheticRunner(t,`import {tmpdir} from 'node:os';console.log('RUNNER_INFO='+JSON.stringify({cwd:process.cwd(),tmp:tmpdir(),home:process.env.HOME}));`);
 assert.equal(f.run.status,0,f.run.stderr+f.run.stdout);
 const match=f.run.stdout.match(/RUNNER_INFO=(.+)/);assert.ok(match,f.run.stdout);
 const info=JSON.parse(match[1]);assert.equal(info.cwd,f.root);
 assert.equal(dirname(info.tmp),join(f.root,'output','test-tmp'));
 assert.equal(info.home,join(info.tmp,'home'));
 assert.equal(existsSync(info.tmp),false);
 assert.deepEqual(readdirSync(join(f.root,'output','test-tmp')),[]);
});
test('test launcher preserves failure and removes its tools after a failing test',async t=>{
 const f=await syntheticRunner(t,`throw new Error('synthetic failure');`);
 assert.notEqual(f.run.status,0);assert.equal(f.run.error,undefined);
 assert.deepEqual(readdirSync(join(f.root,'output','test-tmp')),[]);
});
test('test launcher cleans its tools when setup fails before spawning',async t=>{
 const f=await syntheticRunner(t);
 assert.notEqual(f.run.status,0);assert.equal(f.run.error,undefined);
 assert.deepEqual(readdirSync(join(f.root,'output','test-tmp')),[]);
});
