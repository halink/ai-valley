import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer,Server} from 'node:net';
import {createHash} from 'node:crypto';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {startFormalServer} from '../src/server/formal-startup.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';

const ownedProcesses=new Map<string,Array<{child:ChildProcess;done:Promise<unknown>}>>();
const entry=fileURLToPath(new URL('./helpers/formal-startup-process.ts',import.meta.url));
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const fingerprint=(path:string)=>['','-wal','-journal'].map(suffix=>existsSync(path+suffix)?createHash('sha256').update(readFileSync(path+suffix)).digest('hex'):null);
function launch(database:string,cwd:string,port=0){
 // Explicit clean environment: never inherit credentials, .env loading, preload
 // flags, proxies, or the user's save path. Every database is synthetic.
 const child=spawn(process.execPath,['--import',loader,entry],{cwd,env:{VALLEY_SYNTHETIC_STARTUP_TEST:'enabled',PORT:String(port),VALLEY_DB:database,HOME:cwd,TMPDIR:cwd,TMP:cwd,TEMP:cwd},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});
 const done=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const started=new Promise<number>((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Startup timed out: '+stderr));},10000);
  child.stdout.on('data',()=>{const match=stdout.match(/Valley observer listening on 127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`Startup exited ${code??signal}: ${stderr}`));});
 });
 started.catch(()=>{});
 const launched={child,done,started,stderr:()=>stderr};
 for(const [directory,children] of ownedProcesses)if(database.startsWith(directory+'/'))children.push(launched);
 return launched;
}
async function stop(process:{child:ChildProcess;done:Promise<unknown>},signal:NodeJS.Signals='SIGTERM'){
 if(process.child.exitCode===null&&process.child.signalCode===null)process.child.kill(signal);
 await process.done;
}
function fixture(t:{after:(fn:()=>void|Promise<void>)=>void}){const directory=mkdtempSync(join(testTmpdir(),'formal-startup-'));const children:Array<{child:ChildProcess;done:Promise<unknown>}>=[];ownedProcesses.set(directory,children);t.after(async()=>{for(const child of children)await stop(child);ownedProcesses.delete(directory);rmSync(directory,{recursive:true,force:true});});return directory;}
async function health(port:number){return await (await fetch(`http://127.0.0.1:${port}/ai-town/api/health`)).json() as {revision:number;modelConfigured:boolean;clockPaused:boolean};}

test('an occupied port rejects before creating any world directory or touching an existing save',async t=>{
 const directory=fixture(t),occupied=createServer();await new Promise<void>(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>occupied.close(()=>resolve())));
 const address=occupied.address();assert.ok(address&&typeof address!=='string');
 const fresh=join(directory,'never-created','world.sqlite');
 await assert.rejects(startFormalServer({port:address.port,database:fresh,root:directory,dayMinutes:20,providers:[]}),/EADDRINUSE/);
 assert.equal(existsSync(join(directory,'never-created')),false);
 const database=join(directory,'existing.sqlite'),store=new WorldStore(database),runtime=new ValleyRuntime(store,[],undefined,{mode:'formal'});runtime.stop();store.close();
 const before=fingerprint(database),child=launch(database,directory,address.port);
 assert.equal((await child.done).code,1);assert.match(child.stderr(),/EADDRINUSE/);
 assert.deepEqual(fingerprint(database),before);assert.equal(existsSync(database+'.runtime-lock'),false);
});

test('same save with a different port/cwd cannot migrate or stale the running formal process',async t=>{
 const directory=fixture(t),database=join(directory,'world.sqlite'),elsewhere=join(directory,'elsewhere');mkdirSync(elsewhere);
 const first=launch(database,directory);t.after(()=>stop(first));const port=await first.started;
 const prior=await health(port),before=fingerprint(database);
 const duplicate=launch(database,elsewhere);assert.equal((await duplicate.done).code,1);assert.match(duplicate.stderr(),/runtime_already_owned/);
 assert.deepEqual(await health(port),prior);assert.deepEqual(fingerprint(database),before);
 assert.equal(prior.modelConfigured,false);assert.equal(prior.clockPaused,true);
 await stop(first);assert.equal(first.stderr().includes('stale_world_revision'),false);
 const restart=launch(database,elsewhere);t.after(()=>stop(restart));const next=await health(await restart.started);
 assert.ok(next.revision>prior.revision);
});

test('SIGKILL releases ownership without deleting a stale file or trusting any PID',async t=>{
 const directory=fixture(t),database=join(directory,'world.sqlite');const first=launch(database,directory);t.after(()=>stop(first));
 const prior=await health(await first.started);await stop(first,'SIGKILL');
 assert.equal(existsSync(database+'.runtime-lock'),true);assert.equal(readFileSync(database+'.runtime-lock').length,0);
 const restarted=launch(database,directory);t.after(()=>stop(restarted));assert.ok((await health(await restarted.started)).revision>prior.revision);
});

test('independent saves and ports run concurrently and a failed world load releases its port and ownership',async t=>{
 const directory=fixture(t),one=launch(join(directory,'one.sqlite'),directory),two=launch(join(directory,'two.sqlite'),directory);
 t.after(()=>stop(one));t.after(()=>stop(two));const ports=await Promise.all([one.started,two.started]);assert.notEqual(...ports as [number,number]);
 assert.equal((await health(ports[0])).modelConfigured,false);assert.equal((await health(ports[1])).modelConfigured,false);
 const invalid=join(directory,'wrong-mode.sqlite'),store=new WorldStore(invalid);const world=new ValleyRuntime(store,[],undefined,{mode:'validation'});world.stop();store.close();
 const failed=launch(invalid,directory);assert.equal((await failed.done).code,1);assert.match(failed.stderr(),/world_mode_mismatch/);
 const retry=launch(invalid,directory);assert.equal((await retry.done).code,1);assert.match(retry.stderr(),/world_mode_mismatch/);assert.doesNotMatch(retry.stderr(),/runtime_already_owned/);
});


test('other network bind failures and invalid settings do not touch the save',async t=>{
 const directory=fixture(t),database=join(directory,'untouched','world.sqlite');
 t.mock.method(Server.prototype,'listen',function(this:Server){
  queueMicrotask(()=>this.emit('error',Object.assign(new Error('synthetic EACCES'),{code:'EACCES'})));return this;
 });
 await assert.rejects(startFormalServer({port:12345,database,root:directory,dayMinutes:20,providers:[]}),/EACCES/);
 for(const port of [-1,65536,NaN,1.5])await assert.rejects(startFormalServer({port,database,root:directory,dayMinutes:20,providers:[]}),/Invalid observer port/);
 await assert.rejects(startFormalServer({port:0,database,root:directory,dayMinutes:0,providers:[]}),/Invalid world clock/);
 assert.equal(existsSync(join(directory,'untouched')),false);
});

test('simultaneous fresh-process contenders elect exactly one owner before any world migration',async t=>{
 const directory=fixture(t),database=join(directory,'world.sqlite');
 const contenders=Array.from({length:4},()=>launch(database,directory));
 const results=await Promise.all(contenders.map(async contender=>{try{return {contender,port:await contender.started};}catch{return {contender,port:null};}}));
 const winners=results.filter(result=>result.port!==null);assert.equal(winners.length,1);
 for(const loser of results.filter(result=>result.port===null)){assert.equal((await loser.contender.done).code,1);assert.match(loser.contender.stderr(),/runtime_already_owned/);}
 const running=await health(winners[0].port!);assert.equal(running.modelConfigured,false);assert.equal(running.clockPaused,true);
});
