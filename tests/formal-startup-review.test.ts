import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,existsSync,openSync,closeSync,linkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync,spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {acquireRuntimeOwnership} from '../src/server/runtime-lock.js';
import {startFormalServer} from '../src/server/formal-startup.js';

const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const lockModule=new URL('../src/server/runtime-lock.ts',import.meta.url).href;
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(t:{after:(fn:()=>void|Promise<void>)=>void}){
 const dir=mkdtempSync(join(testTmpdir(),'formal-review-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;
}
function env(dir:string){return {HOME:dir,TMPDIR:dir,TMP:dir,TEMP:dir};}
function contender(dir:string,database:string){
 return spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',
  `import {acquireRuntimeOwnership} from ${JSON.stringify(lockModule)};const o=acquireRuntimeOwnership(${JSON.stringify(database)});o.release();`],
 {cwd:dir,env:env(dir),encoding:'utf8',timeout:10000});
}
function lockedChild(dir:string,database:string){
 const child=spawn(process.execPath,['--import',loader,'--input-type=module','-e',
  `import {acquireRuntimeOwnership} from ${JSON.stringify(lockModule)};const o=acquireRuntimeOwnership(${JSON.stringify(database)});console.log('owned');setInterval(()=>o.assertOwned(),1000);`],
 {cwd:dir,env:env(dir),stdio:['ignore','pipe','pipe']});
 const done=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 const ready=new Promise<void>((resolve,reject)=>{
  let output='',errors='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('lock child timeout: '+errors));},10000);
  child.stderr.on('data',data=>{errors+=String(data);});
  child.stdout.on('data',data=>{output+=String(data);if(output.includes('owned')){clearTimeout(timer);resolve();}});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',()=>{clearTimeout(timer);reject(new Error(errors));});
 });
 return {child,done,ready};
}
async function stop(p:{child:ChildProcess;done:Promise<void>}){if(p.child.exitCode===null&&p.child.signalCode===null)p.child.kill('SIGKILL');await p.done;}

test('review: repeated same-process refusals never drop the cross-process lock',t=>{
 const dir=fixture(t),db=join(dir,'world.sqlite'),owner=acquireRuntimeOwnership(db);t.after(()=>owner.release());
 for(let n=0;n<8;n++)assert.throws(()=>acquireRuntimeOwnership(db),/runtime_already_owned/);
 const result=contender(dir,db);assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/runtime_already_owned/);
 assert.equal(existsSync(db),false);assert.equal(statSync(owner.lockPath).size,0);
});

test('review: a killed lock-only owner leaves the exact same empty inode reusable',async t=>{
 const dir=fixture(t),db=join(dir,'world.sqlite'),first=lockedChild(dir,db);t.after(()=>stop(first));await first.ready;
 const before=statSync(db+'.runtime-lock');assert.equal(contender(dir,db).status,1);
 await stop(first);assert.equal(contender(dir,db).status,0);
 const after=statSync(db+'.runtime-lock');assert.equal(after.ino,before.ino);assert.equal(after.size,0);assert.equal(existsSync(db),false);
});

test('review: rejected hardlink/symlink paths preserve targets and retain the existing owner',t=>{
 const dir=fixture(t),db=join(dir,'world.sqlite'),owner=acquireRuntimeOwnership(db);t.after(()=>owner.release());
 const alias=join(dir,'alias.sqlite.runtime-lock');linkSync(owner.lockPath,alias);
 assert.throws(()=>acquireRuntimeOwnership(join(dir,'alias.sqlite')),/unsafe_runtime_file/);
 // Remove only this test-created alias, restoring the owner's expected nlink.
 rmSync(alias);symlinkSync(owner.lockPath,alias);
 assert.throws(()=>acquireRuntimeOwnership(join(dir,'alias.sqlite')),/unsafe_runtime_file/);
 assert.equal(statSync(owner.lockPath).size,0);owner.assertOwned();
 const result=contender(dir,db);assert.equal(result.status,1,result.stderr);
});

test('review: held ownership rejects formal startup without changing any synthetic save bytes',async t=>{
 const dir=fixture(t),db=join(dir,'world.sqlite');
 const first=await startFormalServer({port:0,database:db,root:dir,dayMinutes:20,providers:[]});t.after(()=>first.close());
 const files=['','-wal','-shm'].filter(suffix=>existsSync(db+suffix));
 const before=files.map(suffix=>digest(db+suffix)),revision=first.runtime.world.revision;
 await assert.rejects(startFormalServer({port:0,database:db,root:dir,dayMinutes:20,providers:[]}),/runtime_already_owned/);
 assert.deepEqual(files.map(suffix=>digest(db+suffix)),before);assert.equal(first.runtime.world.revision,revision);
 assert.equal(contender(dir,db).status,1);await first.close();assert.equal(contender(dir,db).status,0);
});

test('review: corrupt world startup failure preserves bytes and releases ownership',async t=>{
 const dir=fixture(t),db=join(dir,'world.sqlite');writeFileSync(db,'not a SQLite database: synthetic review fixture');const before=digest(db);
 const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const address=reservation.address();assert.ok(address&&typeof address!=='string');const port=address.port;
 await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 for(let n=0;n<2;n++){
  await assert.rejects(startFormalServer({port,database:db,root:dir,dayMinutes:20,providers:[]}));
  assert.equal(digest(db),before);assert.equal(contender(dir,db).status,0);
  const rebound=createServer();await new Promise<void>((resolve,reject)=>{rebound.once('error',reject);rebound.listen(port,'127.0.0.1',resolve);});
  await new Promise<void>(resolve=>rebound.close(()=>resolve()));
 }
});

// Characterization of a POSIX process-lock limitation, not a security guarantee.
// No production path may open/close the ownership inode outside the owner.
test('review boundary: unrelated raw close can release POSIX ownership without changing the inode',t=>{
 const dir=fixture(t),db=join(dir,'world.sqlite'),owner=acquireRuntimeOwnership(db);t.after(()=>owner.release());
 assert.equal(contender(dir,db).status,1);
 const extra=openSync(owner.lockPath,'r');closeSync(extra);
 owner.assertOwned(); // Path integrity is not a kernel-lock verification.
 const result=contender(dir,db);assert.equal(result.status,0,result.stderr);
});


test('review: stale-looking or reused PID metadata never authorizes lock deletion',t=>{
 const dir=fixture(t);
 for(const pid of [0,process.pid,2147483647]){
  const db=join(dir,`pid-${pid}.sqlite`),lock=db+'.runtime-lock';
  const metadata=JSON.stringify({pid,started:0});writeFileSync(lock,metadata);const inode=statSync(lock).ino;
  const result=contender(dir,db);assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/unknown_runtime_lock/);
  assert.equal(readFileSync(lock,'utf8'),metadata);assert.equal(statSync(lock).ino,inode);assert.equal(existsSync(db),false);
 }
});

test('review: SQLite sidecar filenames cannot be selected as independent worlds',async t=>{
 const dir=fixture(t),db=join(dir,'world.sqlite'),owner=acquireRuntimeOwnership(db);t.after(()=>owner.release());
 for(const suffix of ['-journal','-wal','-shm','-JOURNAL','-Wal','-ShM']){
  const sidecar=db+suffix;writeFileSync(sidecar,'');
  let started:Awaited<ReturnType<typeof startFormalServer>>|undefined;
  try{
   await assert.rejects(async()=>{started=await startFormalServer({port:0,database:sidecar,root:dir,dayMinutes:20,providers:[]});},/invalid_runtime_database/);
   assert.equal(statSync(sidecar).size,0);
  }finally{await started?.close();}
 }
});
