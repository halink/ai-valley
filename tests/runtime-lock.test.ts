import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,symlinkSync,linkSync,mkdirSync,statSync,readdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {acquireRuntimeOwnership} from '../src/server/runtime-lock.js';

const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const moduleUrl=new URL('../src/server/runtime-lock.ts',import.meta.url).href;
function fixture(t:{after:(fn:()=>void)=>void}){const dir=mkdtempSync(join(testTmpdir(),'runtime-lock-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function contender(database:string){return spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',
 `import {acquireRuntimeOwnership} from ${JSON.stringify(moduleUrl)}; const owner=acquireRuntimeOwnership(${JSON.stringify(database)}); owner.release();`],
 {env:{HOME:dirname(database),TMPDIR:dirname(database),TMP:dirname(database),TEMP:dirname(database)},encoding:'utf8',timeout:10000});}

test('lock is a permanent empty file and an exclusive OS lock, not a PID or timeout lease',t=>{
 const dir=fixture(t),database=join(dir,'world.sqlite');const owner=acquireRuntimeOwnership(database);
 t.after(()=>owner.release());
 assert.equal(existsSync(database),false);assert.equal(statSync(owner.lockPath).size,0);
 assert.deepEqual(readdirSync(dir),['world.sqlite.runtime-lock']);
 assert.throws(()=>acquireRuntimeOwnership(resolve(dir,'.','world.sqlite')),/runtime_already_owned/);
 const rejected=contender(database);assert.equal(rejected.status,1,rejected.stderr);assert.match(rejected.stderr,/runtime_already_owned/);
 owner.assertOwned();owner.release();owner.release();
 assert.equal(statSync(owner.lockPath).size,0);assert.equal(contender(database).status,0);
 assert.throws(()=>owner.assertOwned(),/released/);
});

test('unknown lock contents and preexisting recovery files are left untouched',t=>{
 const dir=fixture(t),database=join(dir,'world.sqlite'),lock=database+'.runtime-lock';
 const unknown=JSON.stringify({pid:process.pid,started:0});writeFileSync(lock,unknown);
 assert.throws(()=>acquireRuntimeOwnership(database),/unknown_runtime_lock/);
 assert.equal(readFileSync(lock,'utf8'),unknown);assert.equal(existsSync(database),false);
 const other=join(dir,'other.sqlite');writeFileSync(other+'.runtime-lock','');
 writeFileSync(other+'.runtime-lock-journal','unknown journal');
 assert.throws(()=>acquireRuntimeOwnership(other),/unknown_runtime_lock/);
 assert.equal(readFileSync(other+'.runtime-lock-journal','utf8'),'unknown journal');
});

test('symlink ancestors, database/lock/sidecars and hardlink aliases are refused without changing targets',t=>{
 const dir=fixture(t),real=join(dir,'real');mkdirSync(real);const victim=join(real,'victim');writeFileSync(victim,'untouched');
 const linked=join(dir,'linked');symlinkSync(real,linked,'dir');
 assert.throws(()=>acquireRuntimeOwnership(join(linked,'world.sqlite')));
 for(const suffix of ['', '.runtime-lock','-wal','-shm','-journal']){
  const database=join(dir,'case'+suffix.replace(/\W/g,'')+'.sqlite');
  symlinkSync(victim,database+suffix);
  assert.throws(()=>acquireRuntimeOwnership(database));assert.equal(readFileSync(victim,'utf8'),'untouched');
 }
 for(const suffix of ['', '.runtime-lock']){
  const database=join(dir,'hard'+suffix.replace(/\W/g,'')+'.sqlite');linkSync(victim,database+suffix);
  assert.throws(()=>acquireRuntimeOwnership(database),/unsafe_runtime_file/);
 }
 assert.equal(readFileSync(victim,'utf8'),'untouched');
});

test('a lock cannot itself be selected as a world database',t=>{
 const dir=fixture(t),database=join(dir,'world.sqlite'),owner=acquireRuntimeOwnership(database);t.after(()=>owner.release());
 for(const suffix of ['', '-journal','-wal','-shm'])assert.throws(()=>acquireRuntimeOwnership(owner.lockPath+suffix),/invalid_runtime_database/);
 assert.equal(statSync(owner.lockPath).size,0);assert.equal(contender(database).status,1);
});
