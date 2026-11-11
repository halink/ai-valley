import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const root=resolve('.');
const base=join(root,'output','process-review');mkdirSync(base,{recursive:true});
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
function directory(){return join(mkdtempSync(join(base,'case-')),'run');}
function launch(dir:string,mode='new',scenario='normal',hook?:(message:any,child:ReturnType<typeof spawn>)=>void){
 const child=spawn(process.execPath,['--import',join(root,'scripts/acceptance-offline-guard.mjs'),'--import',join(root,'node_modules/tsx/dist/loader.mjs'),join(root,'scripts/production-model-process-guardian.mjs'),'--offline',mode,dir,scenario],{cwd:root,env:{},stdio:['ignore','pipe','pipe']});
 const messages:any[]=[];let out='',err='';const timer=setTimeout(()=>child.kill('SIGKILL'),40000);
 child.stdout!.on('data',data=>{out+=data;for(;;){const index=out.indexOf('\n');if(index<0)break;const line=out.slice(0,index);out=out.slice(index+1);try{const message=JSON.parse(line);messages.push(message);hook?.(message,child);}catch{}}});
 child.stderr!.on('data',data=>{err+=data;});
 return new Promise<{code:number|null;signal:string|null;messages:any[];err:string}>(resolve=>child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,messages,err});}));
}
function events(dir:string){const db=new DatabaseSync(join(dir,'launch.sqlite'),{readOnly:true});try{return db.prepare('SELECT body FROM synthetic_launch_audit ORDER BY sequence').all().map(r=>JSON.parse(String(r.body)));}finally{db.close();}}
function absent(pid:number){try{process.kill(-pid,0);return false;}catch(e){return (e as NodeJS.ErrnoException).code==='ESRCH';}}
async function waitReport(dir:string){const path=join(dir,'watchdog-1.json');for(let i=0;i<200&&!existsSync(path);i++)await pause(50);assert.ok(existsSync(path),'watchdog must persist its own report after owner death');return read(path);}

test('process review: normal resume preserves global contract and charges each launch',async()=>{
 const dir=directory();const first=await launch(dir);assert.equal(first.code,0,JSON.stringify(first));
 const manifest=read(join(dir,'manifest.json')),one=read(join(dir,'process-1.json'));
 assert.equal(one.reservedWallMs,30000);assert.equal(one.attempts,one.completed);assert.equal(one.realModelExecuted,false);assert.equal(one.actualProviderCostCny,null);
 const second=await launch(dir,'resume');assert.equal(second.code,0,JSON.stringify(second));const two=read(join(dir,'process-2.json'));
 assert.equal(two.originalDeadlineAtMs,manifest.contract.deadlineAtMs);assert.equal(two.reservedWallMs,60000);assert.ok(two.attempts>=one.attempts);
 assert.equal(two.observation.process.cleanupComplete,true);assert.ok(absent(two.observation.identity.pid));
});

test('process review: valid earlier session snapshot cannot roll back a finished launch',async()=>{
 const dir=directory();assert.equal((await launch(dir)).code,0);const old=readFileSync(join(dir,'session.sqlite'));
 assert.equal((await launch(dir,'resume')).code,0);writeFileSync(join(dir,'session.sqlite'),old);
 const result=await launch(dir,'resume');assert.equal(result.code,1);assert.equal(result.messages.some(m=>m.type==='synthetic_launch_reserved'),false);
 assert.equal(events(dir).at(-1).type,'blocked');assert.equal(events(dir).filter(e=>e.type==='reserved').length,2);
});

test('process review: altered completion report blocks before spawning',async()=>{
 const dir=directory();assert.equal((await launch(dir)).code,0);const path=join(dir,'process-1.json'),report=read(path);report.completed++;writeFileSync(path,JSON.stringify(report));
 const result=await launch(dir,'resume');assert.equal(result.code,1);assert.equal(result.messages.some(m=>m.type==='synthetic_watchdog_started'),false);
});

for(const scenario of ['crash_reserved','watchdog_missing','crash_intent','crash_response','crash_ack','crash_seal'])test(`process review: ${scenario} consumes reservation and cannot resume`,async()=>{
 const dir=directory(),result=await launch(dir,'new',scenario);assert.notEqual(result.code,0,JSON.stringify(result));
 const reserved=events(dir).filter(e=>e.type==='reserved');assert.equal(reserved.length,1);assert.equal(reserved[0].receipt.deadlineAtMs-reserved[0].receipt.startedAtMs,30000);
 assert.equal(events(dir).some(e=>e.type==='finished'),false);
 const retry=await launch(dir,'resume');assert.equal(retry.code,1);assert.equal(retry.messages.some(m=>m.type==='synthetic_watchdog_started'),false);assert.equal(events(dir).filter(e=>e.type==='reserved').length,1);
 const identity=result.messages.find(m=>m.type==='synthetic_worker_identity');if(identity)assert.ok(absent(identity.pid),'owned worker group must be absent');
});

test('process review: guardian SIGKILL after blocked worker readiness leaves independent cleanup and permanent pending launch',async()=>{
 const dir=directory();let killed=false;
 const result=await launch(dir,'new','sync_block',(message,child)=>{if(message.type==='synthetic_fault_ready'){killed=true;child.kill('SIGKILL');}});
 assert.ok(killed);assert.equal(result.signal,'SIGKILL');const report=await waitReport(dir);
 assert.equal(report.process.trigger,'parent_disconnect');assert.equal(report.process.exit.observed,true);assert.equal(report.process.exit.signal,'SIGKILL');assert.equal(report.process.cleanupComplete,true);assert.ok(absent(report.identity.pid));
 const before=events(dir);assert.equal(before.at(-1).type,'reserved');const resumed=await launch(dir,'resume');assert.equal(resumed.code,1);assert.equal(events(dir).at(-1).reason,'launch_unresolved_no_retry');
});

test('process review: watchdog SIGKILL is failure, guardian terminates its known blocked worker',async()=>{
 const dir=directory();let watchdogPid=0,killed=false;
 const result=await launch(dir,'new','sync_block',message=>{
  if(message.type==='synthetic_watchdog_started')watchdogPid=message.pid;
  if(message.type==='synthetic_fault_ready'){assert.ok(watchdogPid>1);process.kill(watchdogPid,'SIGKILL');killed=true;}
 });
 assert.ok(killed);assert.equal(result.code,1);assert.equal(existsSync(join(dir,'process-1.json')),false);
 const identity=result.messages.find(m=>m.type==='synthetic_worker_identity');assert.ok(identity);
 if(!absent(identity.pid)){
  // Its actual parent was killed, so PID 1 rather than the guardian owns reaping.
  // A remaining zombie is not executing and must never be called absent/clean.
  const stat=readFileSync(`/proc/${identity.pid}/stat`,'utf8');assert.equal(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0],'Z');
 }
 assert.equal(events(dir).at(-1).type,'blocked');assert.equal((await launch(dir,'resume')).code,1);
});

test('process review: durable seal alone cannot turn a blocked process into clean completion',async()=>{
 const dir=directory(),result=await launch(dir,'new','seal_block');assert.equal(result.code,1,JSON.stringify(result));
 assert.ok(result.messages.some(m=>m.type==='synthetic_fault_ready'&&m.point==='sealed'));
 const report=read(join(dir,'watchdog-1.json'));assert.equal(report.process.trigger,'wall_limit');assert.equal(report.process.exit.signal,'SIGKILL');
 assert.equal(report.process.signals.term,'sent');assert.equal(report.process.signals.kill,'sent');assert.equal(report.process.cleanupComplete,true);assert.ok(absent(report.identity.pid));
 assert.equal(events(dir).some(e=>e.type==='finished'),false);assert.equal(existsSync(join(dir,'process-1.json')),false);
 assert.equal((await launch(dir,'resume')).code,1);
});
