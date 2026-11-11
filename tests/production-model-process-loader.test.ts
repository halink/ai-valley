import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {processFixture,ownProcessIdentity} from './helpers/production-process-fixture.js';
import {AcceptanceProcessSupervisor} from '../src/server/acceptance-process-supervisor.js';
import {signalSyntheticProcessGroup} from '../src/server/production-model-process-signals.js';
// @ts-expect-error Fixed internal JavaScript loader has no declaration file.
import {ownSyntheticCompiler} from '../scripts/production-model-process-loader-owner.mjs';
// @ts-expect-error Fixed internal JavaScript loader has no declaration file.
import {syntheticCompilerShutdown} from '../scripts/production-model-process-loader.mjs';

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
 const child=Object.assign(new EventEmitter(),{pid:123,refs:0,ref(){this.refs++;}});
 const spawner={spawn:()=>child},original=spawner.spawn;let stops=0;
 const compiler={initialize(){spawner.spawn();return Promise.resolve();},stop(){stops++;return Promise.resolve();}};
 return {child,spawner,original,compiler,get stops(){return stops;}};
}

test('compiler owner waits for actual close, not stop resolution or exit, and shutdown is single-use',async()=>{
 const f=fixture(),owner=await ownSyntheticCompiler(f.compiler,f.spawner);
 assert.equal(f.spawner.spawn,f.original);
 const done=owner.close();assert.equal(owner.close(),done);let resolved=false;void done.then(()=>{resolved=true;});
 await turn();assert.equal(f.stops,1);assert.equal(f.child.refs,1);assert.equal(resolved,false);
 f.child.emit('exit',0,null);await turn();assert.equal(resolved,false);
 f.child.emit('close',0,null);assert.deepEqual(await done,{pid:123,code:0,signal:null});assert.equal(resolved,true);
});

test('compiler owner accepts its intentional SIGTERM close, not arbitrary signal or exit failure',async()=>{
 for(const [code,signal,valid] of [[null,'SIGTERM',true],[null,'SIGKILL',false],[1,null,false],[null,null,false]] as const){
  const f=fixture(),owner=await ownSyntheticCompiler(f.compiler,f.spawner),done=owner.close();
  f.child.emit('close',code,signal);
  if(valid)await done;else await assert.rejects(done,/not_clean/);
 }
});

test('compiler owner retains premature close and child error as failure',async()=>{
 for(const fault of ['early_close','error'] as const){
  const f=fixture(),owner=await ownSyntheticCompiler(f.compiler,f.spawner);
  if(fault==='early_close')f.child.emit('close',0,null);else f.child.emit('error',Error('fake child error'));
  const done=owner.close();if(fault==='error')f.child.emit('close',0,null);
  await assert.rejects(done,/not_clean/);
 }
});

test('compiler owner rejects missing/multiple child and always restores spawn capture',async()=>{
 for(const mode of ['missing','multiple','throw','reject','invalid_pid'] as const){
  const f=fixture();
  f.compiler.initialize=()=>{
   if(mode==='throw')throw Error('fake initialize failed');
   if(mode==='reject')return Promise.reject(Error('fake initialize rejected'));
   if(mode==='invalid_pid')f.child.pid=0;
   if(mode!=='missing')f.spawner.spawn();if(mode==='multiple')f.spawner.spawn();return Promise.resolve();
  };
  await assert.rejects(ownSyntheticCompiler(f.compiler,f.spawner));assert.equal(f.spawner.spawn,f.original);
 }
});

test('compiler stop failure still waits for the owned close and never becomes success',async()=>{
 const f=fixture();f.compiler.stop=()=>Promise.reject(Error('fake stop failed'));
 const owner=await ownSyntheticCompiler(f.compiler,f.spawner),done=owner.close();let settled=false;
 void done.then(()=>{settled=true;},()=>{settled=true;});await turn();assert.equal(settled,false);
 f.child.emit('close',0,null);await assert.rejects(done,/not_clean/);
});

class Port extends EventEmitter{
 sent:unknown[]=[];refs=0;closed=false;
 postMessage(value:unknown){this.sent.push(value);}
 ref(){this.refs++;}
 close(){this.closed=true;this.emit('close');}
}
test('main thread unregisters before stop, waits for loader close, and deduplicates close',async()=>{
 const port=new Port(),owner=syntheticCompilerShutdown(port);let release!:()=>void;
 const unregister=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const done=owner.close(()=>{calls++;return unregister;});assert.equal(owner.close(()=>assert.fail()),done);
 assert.equal(port.refs,1);assert.deepEqual(port.sent,[]);assert.equal(calls,1);
 release();await turn();assert.deepEqual(port.sent,['stop']);assert.equal(port.closed,false);
 port.emit('message',{type:'closed',pid:123,code:0,signal:null});await done;assert.equal(port.closed,true);
});

test('main thread never accepts premature, malformed, failed, or disconnected acknowledgments',async()=>{
 for(const fault of ['premature','failed','bad_pid','bad_signal','port_close','messageerror','unregister'] as const){
  const port=new Port(),owner=syntheticCompilerShutdown(port);
  if(fault==='premature')port.emit('message',{type:'closed',pid:123,code:0,signal:null});
  const done=owner.close(async()=>{if(fault==='unregister')throw Error('fake unregister failed');});
  const rejected=assert.rejects(done);await turn();
  if(fault==='failed')port.emit('message',{type:'failed'});
  if(fault==='bad_pid')port.emit('message',{type:'closed',pid:null,code:0,signal:null});
  if(fault==='bad_signal')port.emit('message',{type:'closed',pid:123,code:null,signal:'SIGKILL'});
  if(fault==='port_close')port.close();if(fault==='messageerror')port.emit('messageerror');
  await rejected;assert.equal(port.closed,true);
 }
});

test('real loader stops and reaps its compiler before permitting main process exit',()=>{
 const source=`
 import {registerSyntheticCompiler} from './scripts/production-model-process-loader.mjs';
 import {register} from './node_modules/tsx/dist/esm/api/index.mjs';
 import {readFileSync} from 'node:fs';
 const compiler=registerSyntheticCompiler(),unregister=register();
 await import('./src/server/production-model-process-signals.ts');
 const closed=await compiler.close(unregister);
 try{readFileSync('/proc/'+closed.pid+'/stat','utf8');throw Error('compiler not reaped');}catch(error){if(error.code!=='ENOENT')throw error;}
 console.log(JSON.stringify(closed));`;
 const result=spawnSync(process.execPath,['--import',resolve('scripts/acceptance-offline-guard.mjs'),'--input-type=module','--eval',source],
  {cwd:resolve('.'),env:{},encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);const closed=JSON.parse(result.stdout);
 assert.ok(Number.isSafeInteger(closed.pid)&&closed.pid>0);assert.ok(closed.code===0&&closed.signal===null||closed.code===null&&closed.signal==='SIGTERM');
});

test('missing loader acknowledgment holds the leader until the unchanged external deadline kills its group',{timeout:10000},async t=>{
 const source=`
 import {MessageChannel} from 'node:worker_threads';
 import {syntheticCompilerShutdown} from './scripts/production-model-process-loader.mjs';
 const {port1,port2}=new MessageChannel();port2.on('message',()=>{});port2.unref();
 const owner=syntheticCompilerShutdown(port1);process.on('SIGTERM',()=>{});
 console.log('ready-no-ack');await owner.close(async()=>{});throw Error('missing ack accepted');`;
 let child:ChildProcess,identity:ReturnType<typeof ownProcessIdentity>=null,stdout='',stderr='';
 t.after(()=>{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:3000,termGraceMs:150,killWaitMs:1000,pollMs:10});
 const report=await supervisor.start(observe=>{
  child=spawn(process.execPath,['--import',resolve('scripts/acceptance-offline-guard.mjs'),'--input-type=module','--eval',source],
   {cwd:resolve('.'),env:{},detached:true,stdio:['ignore','pipe','pipe']});
  child.stdout!.on('data',data=>{stdout+=String(data);});child.stderr!.on('data',data=>{stderr+=String(data);});
  child.on('spawn',()=>{identity=ownProcessIdentity(child.pid!);observe({type:'spawned'});});
  child.on('exit',(code,signal)=>observe({type:'exit',code,signal}));child.on('error',()=>observe({type:'transport_error'}));
  const group=()=>{try{process.kill(-child.pid!,0);return 'present' as const;}catch(e){return (e as NodeJS.ErrnoException).code==='ESRCH'?'absent' as const:'unknown' as const;}};
  return {groupState:group,signalGroup:signal=>signalSyntheticProcessGroup(identity,signal,group),
   dispose(){child.stdout!.destroy();child.stderr!.destroy();child.unref();}};
 });
 assert.match(stdout,/ready-no-ack/,stderr);assert.equal(report.trigger,'wall_limit');
 assert.deepEqual(report.exit,{observed:true,code:null,signal:'SIGKILL'});assert.equal(report.groupState,'absent');
 assert.equal(report.cleanupComplete,true);assert.deepEqual(report.issues,[]);assert.deepEqual(report.signals,{term:'sent',kill:'sent'});
});

test('normal worker repeatedly resumes with zero issues and no group cleanup signals',{timeout:60000},async t=>{
 const f=processFixture(t);
 for(let i=1;i<=8;i++){
  const result=await f.launch('normal',i===1?'new':'resume').done;assert.equal(result.code,0,result.stderr+JSON.stringify(result.messages));
  const report=JSON.parse(readFileSync(join(f.path,`watchdog-${i}.json`),'utf8')).process;
  assert.deepEqual(report.exit,{observed:true,code:0,signal:null});assert.equal(report.trigger,'child_exit');
  assert.equal(report.groupState,'absent');assert.equal(report.cleanupComplete,true);assert.deepEqual(report.issues,[]);
  assert.deepEqual(report.signals,{term:'not_attempted',kill:'not_attempted'});
  const finished=result.messages.find(m=>m.type==='synthetic_process_finished');assert.equal(finished.finished,i);assert.equal(finished.reservedWallMs,i*30000);
 }
});
