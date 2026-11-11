import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {AcceptanceProcessSupervisor,type SupervisorClock,type SupervisedProcessEvent,type ProcessGroupState,
 type ProcessSignalResult,type AcceptanceProcessReport} from '../src/server/acceptance-process-supervisor.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {spawnSyntheticGuardian,type SyntheticScenario} from './helpers/acceptance-supervisor-fixture.js';
class Clock implements SupervisorClock{
 value=100;serial=0;timers=new Map<number,{at:number;callback:()=>void}>();now=()=>this.value;
 setTimer=(callback:()=>void,ms:number)=>{const id=++this.serial;this.timers.set(id,{at:this.value+ms,callback});return id;};
 clearTimer=(id:unknown)=>{this.timers.delete(id as number);};
 advance(ms:number){this.value+=ms;for(let i=0;i<100;i++){
  const pending=[...this.timers].filter(([,t])=>t.at<=this.value);if(!pending.length)return;
  for(const [id,t] of pending){this.timers.delete(id);t.callback();}
 }throw new Error('timer_loop');}
}
function controlled(options:{signal?:(signal:string)=>ProcessSignalResult;clock?:Clock}={}){
 const clock=options.clock??new Clock(),signals:string[]=[];let group:ProcessGroupState='present',disposed=0;
 let emit!:(event:SupervisedProcessEvent)=>void;
 const controller=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,pollMs:5,clock});
 const done=controller.start(observe=>{emit=observe;return {groupState:()=>group,signalGroup:signal=>{
  signals.push(signal);return options.signal?.(signal)??'sent';},dispose:()=>{disposed++;}};});
 emit({type:'spawned'});
 return {clock,controller,done,signals,emit,setGroup:(state:ProcessGroupState)=>{group=state;},disposed:()=>disposed};
}
test('absolute clock starts before launch and never waits for readiness',async()=>{
 const f=controlled();f.clock.advance(99);assert.deepEqual(f.signals,[]);f.clock.advance(1);
 assert.deepEqual(f.signals,['SIGTERM']);f.clock.advance(19);assert.equal(f.controller.status().phase,'term_wait');
 f.clock.advance(1);assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);f.clock.advance(30);const r=await f.done;
 assert.equal(r.elapsedMs,150);assert.equal(r.trigger,'wall_limit');assert.equal(r.outcome,'unknown');assert.equal(r.cleanupComplete,false);
 assert.equal(r.exit.observed,false);assert.equal(f.clock.timers.size,0);assert.equal(f.disposed(),1);
 assert.equal(r.remoteCancellationConfirmed,false);assert.equal(r.confirmedCostUsd,null);assert.equal(r.acceptancePassed,null);
});
test('delayed timer cannot reset either absolute grace or final wait deadline',async()=>{
 const f=controlled();f.clock.advance(500);const r=await f.done;assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);
 assert.equal(r.phase,'settled');assert.equal(r.elapsedMs,500);assert.equal(f.clock.timers.size,0);assert.equal(r.cleanupComplete,false);
});
test('actual exit code and cleanup, not sent signal, determine process outcome',async()=>{
 const f=controlled();f.clock.advance(100);f.setGroup('absent');f.emit({type:'exit',code:0,signal:null});const r=await f.done;
 assert.equal(r.trigger,'wall_limit');assert.equal(r.outcome,'exited_zero');assert.equal(r.cleanupComplete,true);
 assert.deepEqual(f.signals,['SIGTERM']);assert.equal(r.acceptancePassed,null);
});
test('process exit retains nonzero or signal facts without inventing an acceptance result',async()=>{
 for(const event of [{type:'exit',code:7,signal:null},{type:'exit',code:null,signal:'SIGKILL'}] as const){
  const f=controlled();f.setGroup('absent');f.emit(event);const r=await f.done;
  assert.deepEqual(r.exit,{observed:true,code:event.code,signal:event.signal});assert.equal(r.trigger,'child_exit');assert.deepEqual(f.signals,[]);
 }
});
test('successful leader exit does not leave a descendant process group running',async()=>{
 const f=controlled();f.emit({type:'exit',code:0,signal:null});assert.deepEqual(f.signals,['SIGTERM']);
 f.clock.advance(20);assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);f.setGroup('absent');f.clock.advance(5);const r=await f.done;
 assert.equal(r.outcome,'exited_zero');assert.equal(r.trigger,'child_exit');assert.equal(r.cleanupComplete,true);
});
test('absent process group without observed child exit stays unknown and bounded',async()=>{
 const f=controlled();f.setGroup('absent');f.clock.advance(150);const r=await f.done;
 assert.equal(r.outcome,'unknown');assert.equal(r.cleanupComplete,false);assert.ok(r.issues.includes('exit_unobserved'));
});
test('parent signal preserves first trigger and repeated interruption expedites KILL once',async()=>{
 const f=controlled();f.controller.interrupt('SIGINT');f.controller.interrupt('SIGTERM');f.controller.interrupt('SIGTERM');
 assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);f.clock.advance(30);const r=await f.done;
 assert.equal(r.trigger,'parent_signal');assert.equal(r.parentSignal,'SIGINT');assert.equal(r.elapsedMs,30);
});
test('transport errors and denied signals stay unknown instead of implying kill success',async()=>{
 const f=controlled({signal:()=>{throw new Error('PRIVATE_SIGNAL_FAILURE');}});f.emit({type:'transport_error'});f.clock.advance(50);const r=await f.done;
 assert.equal(r.trigger,'transport_error');assert.equal(r.signals.kill,'unknown');assert.equal(r.cleanupComplete,false);
 assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('invalid clock causes immediate TERM then KILL without waiting on an unusable timer',async()=>{
 const f=controlled();f.clock.value=NaN;f.controller.interrupt('SIGINT');const r=await f.done;
 assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);assert.equal(r.elapsedMs,null);assert.equal(r.trigger,'clock_invalid');
 assert.equal(r.cleanupComplete,false);assert.equal(f.clock.timers.size,0);
});
test('timer failure after launch is bounded, fail closed and does not leak raw exception',async()=>{
 const f=controlled();f.clock.setTimer=()=>{throw new Error('PRIVATE_TIMER_FAILURE');};f.controller.interrupt('SIGINT');const r=await f.done;
 assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);assert.ok(r.issues.includes('timer_failed'));assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('launch exception never promises that an unknown partial launch was stopped',async()=>{
 const clock=new Clock(),controller=new AcceptanceProcessSupervisor({maxWallMs:10,termGraceMs:10,killWaitMs:10,clock});
 const r=await controller.start(()=>{throw new Error('PRIVATE_LAUNCH');});assert.equal(r.trigger,'launch_failed');
 assert.equal(r.outcome,'unknown');assert.equal(r.cleanupComplete,false);assert.equal(clock.timers.size,0);
});
test('OS spawn failure is distinct from observed exit and synchronous callback order is supported',async()=>{
 const clock=new Clock(),controller=new AcceptanceProcessSupervisor({maxWallMs:10,termGraceMs:10,killWaitMs:10,clock});
 const r=await controller.start(observe=>{observe({type:'spawn_failed'});return {groupState:()=> 'absent',signalGroup:()=> 'not_found',dispose(){}};});
 assert.equal(r.outcome,'not_started');assert.equal(r.exit.observed,false);assert.equal(r.cleanupComplete,true);
});
test('synchronous exit during TERM records returned signal result before settling',async()=>{
 const clock=new Clock(),controller=new AcceptanceProcessSupervisor({maxWallMs:10,termGraceMs:10,killWaitMs:10,clock});
 let group:ProcessGroupState='present';controller.start(observe=>({groupState:()=>group,signalGroup(){
  group='absent';observe({type:'exit',code:0,signal:null});return 'sent';},dispose(){}}));
 clock.advance(10);const r=await controller.done;assert.equal(r.signals.term,'sent');assert.equal(r.signals.kill,'not_attempted');
});
test('replayed exit, parent signal and old timers cannot alter settled report or reuse controller',async()=>{
 const f=controlled();f.setGroup('absent');f.emit({type:'exit',code:0,signal:null});const r=await f.done,before=JSON.stringify(f.controller.status());
 r.exit.code=99;r.issues.push('probe_failed');f.emit({type:'exit',code:22,signal:null});f.controller.interrupt('SIGINT');f.clock.advance(1000);
 assert.equal(JSON.stringify(f.controller.status()),before);assert.deepEqual(f.signals,[]);
 assert.throws(()=>f.controller.start(()=>{throw new Error('must not relaunch');}),/single_use/);
});
test('reentrant process probe cannot overwrite a settled group result or rearm a timer',async()=>{
 const clock=new Clock(),controller=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,clock});
 let first=true,emit!:(event:SupervisedProcessEvent)=>void;
 controller.start(observe=>{emit=observe;return {groupState(){
  if(first){first=false;controller.interrupt('SIGINT');return 'present';}return 'absent';
 },signalGroup:()=> 'sent',dispose(){}};});
 emit({type:'exit',code:0,signal:null});const report=await controller.done;
 assert.equal(report.groupState,'absent');assert.equal(report.cleanupComplete,true);assert.deepEqual(controller.status(),report);
 assert.equal(clock.timers.size,0);
});

type FixtureResult={report:AcceptanceProcessReport;ready:Array<{stage:string;pid:number;descendantPid?:number;environmentKeys:string[];refused?:number}>;
 root:string;code:number|null;signal:string|null;statuses:AcceptanceProcessReport[]};
const processState=(pid:number)=>{try{return readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[0];}catch{return null;}};
async function runFixture(t:TestContext,scenario:SyntheticScenario,options:{wall?:number;signal?:'SIGINT'|'SIGTERM'|'SIGKILL';owner?:boolean;clock?:'manual'|'system';deferExitProbe?:boolean}={}):Promise<FixtureResult>{
 const root=mkdtempSync(join(testTmpdir(),'valley-supervisor-fixture-'));
 const wall=options.wall??1500,grace=120,wait=220,clock=options.clock??'manual',began=performance.now();
 const child=spawnSyntheticGuardian(root,scenario,{wall,grace,wait,owner:options.owner,clock,deferExitProbe:options.deferExitProbe});
 let stdout='',stderr='',lineBuffer='',report:AcceptanceProcessReport|undefined;
 const ready:FixtureResult['ready']=[],statuses:AcceptanceProcessReport[]=[];
 let sent=false,termReceived=false,advanced=-1,guardianPid:number|undefined,workerPid:number|undefined,closed=false;
 let guardianStartedMs:number|undefined,readyMs:number|undefined,poll:ReturnType<typeof setInterval>|undefined;
 const advance=(to:number)=>{if(to<=advanced)return;advanced=to;child.stdin!.write(JSON.stringify({kind:'advance',to})+'\n');};
 const orphan=scenario==='orphan'||scenario==='hold_pipe';
 const drive=(status:AcceptanceProcessReport)=>{
  statuses.push(status);
  if(clock!=='manual'||options.signal)return;
  if(status.phase==='term_wait'&&(scenario!=='ignore_term'||termReceived))advance(status.elapsedMs!+grace);
  if(status.phase==='kill_wait'&&orphan&&!poll){
   // Wait for an OS observation of the actual descendant death, not a guessed
   // sleep after kill(). Zombies still remain a conservative group unknown.
   poll=setInterval(()=>{
    const state=processState(ready[0].descendantPid!);
    if(state===null||state==='Z'){clearInterval(poll);advance(status.elapsedMs!+wait);}
   },5);
  }
 };
 const cleanup=()=>{
  // Pipe closure is not evidence that the detached worker group disappeared.
  if(workerPid&&report?.groupState!=='absent')try{process.kill(-workerPid,'SIGKILL');}catch{}
  if(closed)return;
  if(guardianPid)try{process.kill(guardianPid,'SIGKILL');}catch{}
  child.kill('SIGKILL');
 };
 t.after(()=>{cleanup();rmSync(root,{recursive:true,force:true});});
 child.stdin!.on('error',()=>{}); // An intentionally killed owner closes stdin.
 child.stdout!.on('data',(chunk:Buffer)=>{stdout+=chunk.toString();lineBuffer+=chunk.toString();let end:number;
  while((end=lineBuffer.indexOf('\n'))>=0){const line=lineBuffer.slice(0,end);lineBuffer=lineBuffer.slice(end+1);if(!line)continue;
   const message=JSON.parse(line);
   if(message.kind==='guardian'){guardianPid=message.pid;guardianStartedMs=performance.now()-began;}
   else if(message.kind==='spawned')workerPid=message.pid;
   else if(message.kind==='ready'){
    ready.push(message.message);readyMs=message.wallElapsedMs;
    if(options.signal&&!sent){sent=true;child.kill(options.signal);}
    else if(clock==='manual'&&['init_block','sync_block','ignore_term','seal_block'].includes(scenario))advance(wall);
   }else if(message.kind==='term_received'){termReceived=true;drive(message.report);}
   else if(message.kind==='result')report=message.report;
   else if(message.kind==='status'||message.kind==='event')drive(message.report);
  }
 });child.stderr!.on('data',chunk=>{stderr+=chunk.toString();});
 // A test watchdog is not the supervisor's deadline. It fails missing protocol
 // progress and cleans up the owned group; it never turns a timeout into a pass.
 let watchdogFired=false;
 const timer=setTimeout(()=>{watchdogFired=true;cleanup();},12000);
 let result:{code:number|null;signal:string|null};
 try{result=await new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{
  child.on('error',reject);child.on('close',(code,signal)=>{closed=true;resolve({code,signal});});
 });}finally{clearTimeout(timer);clearInterval(poll);}
 t.diagnostic(JSON.stringify({clock,guardianBootstrapMs:guardianStartedMs,workerReadyMs:readyMs,totalWallMs:performance.now()-began,supervisorElapsedMs:report?.elapsedMs,watchdogFired}));
 assert.ok(report,`Missing supervisor report: ${stdout}\n${stderr}`);
 assert.equal(watchdogFired,false,`Fixture watchdog fired after report: ${stdout}\n${stderr}`);
 if(scenario==='ignore_term')assert.equal(termReceived,true,'the child must actually receive and ignore TERM before KILL');
 assert.equal(report.phase,'settled');return {report,ready,statuses,root,...result};
}
const bytes=(directory:string)=>readdirSync(directory).sort().map(name=>[name,readFileSync(join(directory,name),'hex')]);
for(const scenario of ['exit_zero','exit_nonzero','self_signal'] as const)test(`real synthetic ${scenario} preserves actual exit`,{timeout:15000},async t=>{
 const f=await runFixture(t,scenario);assert.equal(f.report.trigger,'child_exit');assert.equal(f.report.cleanupComplete,true);
 assert.equal(f.report.outcome,scenario==='exit_zero'?'exited_zero':scenario==='exit_nonzero'?'exited_nonzero':'signaled');
 assert.equal(f.report.exit.code,scenario==='exit_zero'?0:scenario==='exit_nonzero'?7:null);
 assert.equal(f.ready.length,1);assert.ok(f.ready.every(message=>message.environmentKeys.length===0));
});
for(const scenario of ['init_block','sync_block','ignore_term','seal_block'] as const)test(`injected deadline kills real synthetic ${scenario}`,{timeout:15000},async t=>{
 const f=await runFixture(t,scenario);assert.equal(f.ready.length,1);assert.equal(f.report.trigger,'wall_limit');
 assert.equal(f.report.exit.signal,'SIGKILL');assert.equal(f.report.signals.term,'sent');assert.equal(f.report.signals.kill,'sent');
 assert.equal(f.report.cleanupComplete,true);assert.ok(f.report.elapsedMs!>=1620&&f.report.elapsedMs!<=1840);
 assert.ok(f.statuses.some(status=>status.phase==='term_wait'&&status.elapsedMs===1500&&status.signals.kill==='not_attempted'));
 assert.ok(f.statuses.some(status=>status.phase==='kill_wait'&&status.elapsedMs===1620&&status.signals.kill==='sent'));
 if(scenario==='seal_block')assert.equal(f.ready[0].stage,'seal_fsync');
 const directory=join(f.root,'evidence');
 if(scenario==='init_block')assert.equal(existsSync(directory),false);
 else {const before=bytes(directory),report=readAcceptanceEvidence(directory);
  // All seal bytes may be readable even though seal fsync never returned. A
  // consistent logical segment does not establish graceful process completion
  // or storage durability. Keep the independent OS interruption authoritative.
  assert.equal(report.complete,scenario==='seal_block');assert.equal(existsSync(join(directory,'run-close.json')),scenario==='seal_block');
  assert.equal(report.acceptanceControl.interruptedRequests,null);assert.equal(report.acceptanceControl.confirmedCostUsd,null);
  assert.equal(report.acceptanceControl.remoteCancellationConfirmed,false);assert.equal(report.acceptancePassed,null);assert.deepEqual(bytes(directory),before);
 }
});
test('real wall deadline includes startup and never requires a ready event',{timeout:15000},async t=>{
 const f=await runFixture(t,'never_ready',{clock:'system'});
 assert.equal(f.ready.length,0);assert.equal(f.report.trigger,'wall_limit');assert.equal(f.report.maxWallMs,1500);
 assert.equal(f.report.deadlineObserved,true);assert.equal(f.report.spawnObserved,true);assert.equal(f.report.signals.term,'sent');
 assert.ok(f.report.elapsedMs!>=1500);
 // OS scheduling can defer timer callbacks and exit delivery. Exact absolute
 // boundaries are asserted with the injected clock, not a host-speed upper bound.
 if(f.report.exit.observed)assert.ok(['SIGTERM','SIGKILL'].includes(f.report.exit.signal!));
 else {assert.equal(f.report.outcome,'unknown');assert.equal(f.report.cleanupComplete,false);}
});
for(const signal of ['SIGINT','SIGTERM'] as const)test(`parent ${signal} requests graceful local stop without acceptance claims`,{timeout:15000},async t=>{
 const f=await runFixture(t,'graceful',{signal,wall:10000});assert.equal(f.report.trigger,'parent_signal');assert.equal(f.report.parentSignal,signal);
 assert.equal(f.code,signal==='SIGINT'?130:143);assert.equal(f.report.outcome,'exited_zero');assert.equal(f.report.cleanupComplete,true);
 assert.equal(f.report.signals.kill,'not_attempted');const directory=join(f.root,'evidence'),before=bytes(directory),report=readAcceptanceEvidence(directory);
 assert.equal(report.complete,true);assert.equal(report.reason,'signal');assert.equal(report.acceptanceControl.verified,false);
 assert.equal(report.acceptancePassed,null);assert.deepEqual(bytes(directory),before);
});
test('unexpected synthetic crash leaves valid prefix read-only and never resumes an old writer', {timeout:15000},async t=>{
 const f=await runFixture(t,'crash');assert.equal(f.report.outcome,'exited_nonzero');const directory=join(f.root,'evidence'),before=bytes(directory);
 const report=readAcceptanceEvidence(directory);assert.equal(report.complete,false);assert.equal(report.acceptanceControl.finalStatus,null);
 assert.throws(()=>new AcceptanceEvidenceWriter({directory,sourceFingerprint:'9'.repeat(64),worldId:'synthetic',fromMinute:480}),/new_directory_required/);
 const next=new AcceptanceEvidenceWriter({directory:join(f.root,'next'),sourceFingerprint:'9'.repeat(64),worldId:'synthetic',fromMinute:480,previousRunId:report.runId});
 next.abort();assert.equal(readAcceptanceEvidence(join(f.root,'next')).previousRunId,report.runId);assert.deepEqual(bytes(directory),before);
});
for(const scenario of ['orphan','hold_pipe'] as const)test(`orphan cleanup is bounded even when ${scenario} keeps process resources`,{timeout:15000},async t=>{
 const f=await runFixture(t,scenario);assert.equal(f.report.outcome,'exited_zero');assert.equal(f.report.signals.term,'sent');assert.equal(f.report.signals.kill,'sent');
 const pid=f.ready[0].descendantPid!;let state:string|null=null;try{state=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[0];}catch{}
 assert.ok(state===null||state==='Z','the owned descendant must no longer be executing');
 // A zombie awaiting the container's init reaper is still a group member. Do not
 // report disappearance merely because SIGKILL was sent or leader exit was zero.
 if(f.report.groupState!=='absent'){assert.equal(f.report.cleanupComplete,false);assert.ok(f.report.issues.includes('group_unconfirmed'));}
});
test('independent guardian handles abrupt owner SIGKILL by pipe EOF and kills a blocked child', {timeout:15000},async t=>{
 const f=await runFixture(t,'sync_block',{owner:true,signal:'SIGKILL',wall:10000});assert.equal(f.signal,'SIGKILL');
 assert.equal(f.report.trigger,'parent_disconnect');assert.equal(f.report.exit.signal,'SIGKILL');assert.equal(f.report.cleanupComplete,true);
 assert.equal(f.report.signals.term,'sent');assert.equal(f.report.signals.kill,'sent');
});
for(const owner of [false,true])test(`manual fixture resumes group observation after exit with ${owner?'dead owner':'live driver'}`,{timeout:15000},async t=>{
 const f=await runFixture(t,'sync_block',{deferExitProbe:true,...(owner?{owner:true,signal:'SIGKILL' as const,wall:10000}:{})});
 const killAt=owner?120:1620;
 assert.ok(f.statuses.some(status=>status.phase==='kill_wait'&&status.elapsedMs===killAt&&status.exit.observed&&status.groupState==='present'));
 assert.equal(f.report.exit.signal,'SIGKILL');assert.equal(f.report.cleanupComplete,true);
 assert.equal(f.report.elapsedMs,killAt+10,'settlement must run the pending poll, not invent a same-time group observation');
 assert.equal(f.report.signals.term,'sent');assert.equal(f.report.signals.kill,'sent');
 if(owner){assert.equal(f.signal,'SIGKILL');assert.equal(f.report.trigger,'parent_disconnect');}
 else {
  assert.ok(f.statuses.some(status=>status.phase==='term_wait'&&status.elapsedMs===1500&&status.signals.kill==='not_attempted'));
  assert.ok(f.statuses.some(status=>status.phase==='kill_wait'&&status.elapsedMs===1620&&status.signals.kill==='sent'));
 }
});
test('subprocess rejects restricted and symlink paths without creating an evidence run', {timeout:15000},async t=>{
 const f=await runFixture(t,'unsafe_path');assert.equal(f.ready[0].refused,3);assert.equal(f.report.outcome,'exited_zero');
 assert.equal(existsSync(join(f.root,'runtime')),false);assert.deepEqual(readdirSync(join(f.root,'safe')),[]);
});
