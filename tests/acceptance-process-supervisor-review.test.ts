import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AcceptanceProcessSupervisor,type SupervisorClock,type SupervisedProcessEvent,type ProcessGroupState} from '../src/server/acceptance-process-supervisor.js';
class ReviewClock implements SupervisorClock {
 value=0;serial=0;active=new Map<number,()=>void>();history=new Map<number,()=>void>();
 now=()=>this.value;
 setTimer=(fn:()=>void,_ms:number)=>{const id=++this.serial;this.active.set(id,fn);this.history.set(id,fn);return id;};
 clearTimer=(id:unknown)=>{this.active.delete(id as number);};
 fire(id:number){this.active.delete(id);this.history.get(id)!();}
}
function setup(){
 const clock=new ReviewClock();let group:ProcessGroupState='present';let emit!:(e:SupervisedProcessEvent)=>void;const signals:string[]=[];
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,clock});
 const done=supervisor.start(observe=>{emit=observe;return {groupState:()=>group,signalGroup:signal=>{signals.push(signal);return 'sent';},dispose(){}};});
 emit({type:'spawned'});return {clock,supervisor,done,emit,signals,absent:()=>{group='absent';}};
}
test('review: replayed cleared callback does not orphan a newer timer',async()=>{
 const f=setup();assert.equal(f.clock.active.size,1);
 // Timer 1 was cleared by start's post-launch tick. Its callback was already queued.
 f.clock.fire(1);f.absent();f.emit({type:'exit',code:0,signal:null});await f.done;
 assert.equal(f.clock.active.size,0,'settlement must clear all live timers');
});
test('review: deferred callback after settlement cannot mutate settled status',async()=>{
 const f=setup();f.absent();f.emit({type:'exit',code:0,signal:null});const report=await f.done;
 for(const fn of f.clock.history.values())fn();
 assert.deepEqual(f.supervisor.status(),report);assert.deepEqual(f.signals,[]);
});
test('review: reentrant interruption cannot settle before signal result is recorded',async()=>{
 const clock=new ReviewClock();let supervisor!:AcceptanceProcessSupervisor;let group:ProcessGroupState='present';let emit!:(e:SupervisedProcessEvent)=>void;
 supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,clock});
 const done=supervisor.start(observe=>{emit=observe;return {groupState:()=>group,signalGroup:signal=>{
  if(signal==='SIGTERM')supervisor.interrupt('SIGTERM');
  else {group='absent';emit({type:'exit',code:null,signal:'SIGKILL'});}
  return 'sent';
 },dispose(){}};});
 supervisor.interrupt('SIGINT');const report=await done;
 assert.equal(report.signals.term,'sent');assert.deepEqual(supervisor.status(),report);
});
test('review: synchronous scheduler callback never launches after early settlement',async()=>{
 let launched=0,calls=0;const clock:SupervisorClock={now:()=>0,clearTimer(){},setTimer(fn){if(++calls===1)fn();else throw new Error('scheduler_failed');return 1;}};
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,clock});
 const report=await supervisor.start(()=>{launched++;return {groupState:()=> 'present',signalGroup:()=> 'sent',dispose(){}};});
 assert.equal(report.phase,'settled');assert.equal(launched,0,'a settled supervisor must not create an unowned child');
});
test('review: probe and dispose failures remain unknown without exposing exceptions',async()=>{
 const clock=new ReviewClock();let emit!:(e:SupervisedProcessEvent)=>void;
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,clock});
 const done=supervisor.start(observe=>{emit=observe;return {groupState(){throw new Error('PRIVATE');},signalGroup:()=> 'not_found',dispose(){throw new Error('PRIVATE');}};});
 emit({type:'exit',code:0,signal:null});clock.value=1000;clock.fire(clock.serial);const r=await done;
 assert.equal(r.cleanupComplete,false);assert.equal(r.outcome,'exited_zero');assert.ok(r.issues.includes('probe_failed'));assert.ok(r.issues.includes('dispose_failed'));assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('review: delayed parent signal cannot extend the absolute final deadline',()=>{
 const f=setup();f.clock.value=500;f.supervisor.interrupt('SIGINT');
 assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);
 assert.equal(f.supervisor.status().phase,'settled');
 assert.equal(f.supervisor.status().parentSignal,'SIGINT');
});
test('review: delayed transport error cannot extend the absolute final deadline',()=>{
 const f=setup();f.clock.value=500;f.emit({type:'transport_error'});
 assert.deepEqual(f.signals,['SIGTERM','SIGKILL']);
 assert.equal(f.supervisor.status().phase,'settled');
});
test('review: overdue reentrant stop drains observed OS exit before final settlement',async()=>{
 const clock=new ReviewClock();let group:ProcessGroupState='present';let emit!:(e:SupervisedProcessEvent)=>void;
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,clock});
 const done=supervisor.start(observe=>{emit=observe;return {groupState:()=>group,signalGroup:signal=>{
  if(signal==='SIGTERM')supervisor.interrupt('SIGTERM');
  else {group='absent';emit({type:'exit',code:null,signal:'SIGKILL'});}
  return 'sent';
 },dispose(){}};});
 clock.value=500;supervisor.interrupt('SIGINT');const report=await done;
 assert.equal(report.exit.observed,true);assert.equal(report.exit.signal,'SIGKILL');
 assert.equal(report.cleanupComplete,true);assert.deepEqual(supervisor.status(),report);
});
test('review: disposal callbacks and mutated returned snapshots cannot rewrite terminal facts',async()=>{
 const clock=new ReviewClock();let emit!:(e:SupervisedProcessEvent)=>void;let disposals=0;
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:30,clock});
 const done=supervisor.start(observe=>{emit=observe;return {groupState:()=> 'absent',signalGroup:()=> 'not_found',dispose(){
  disposals++;emit({type:'exit',code:44,signal:null});emit({type:'transport_error'});supervisor.interrupt('SIGTERM');
 }};});
 emit({type:'exit',code:0,signal:null});const report=await done;const terminal=supervisor.status();
 assert.equal(report.exit.code,0);assert.equal(report.parentSignal,null);assert.equal(disposals,1);
 report.signals.term='sent';report.exit.code=55;report.issues.push('timer_failed');
 emit({type:'spawn_failed'});emit({type:'exit',code:null,signal:'SIGKILL'});clock.value=1000;
 for(const callback of clock.history.values())callback();
 assert.deepEqual(supervisor.status(),terminal);assert.equal(clock.active.size,0);assert.equal(disposals,1);
 assert.equal(terminal.remoteCancellationConfirmed,false);assert.equal(terminal.confirmedCostUsd,null);
});

for(const cleanup of ['already_absent','term_sent','gone_before_term'] as const)test(`review: successful leader exit preserves ${cleanup} descendant cleanup facts`,async()=>{
 const {SyntheticSupervisorClock}=await import('./helpers/acceptance-supervisor-fixture.js');
 const clock=new SyntheticSupervisorClock();let group:ProcessGroupState=cleanup==='already_absent'?'absent':'present',disposed=0;
 let emit!:(event:SupervisedProcessEvent)=>void;
 const signals:Array<{signal:string;at:number}>=[];
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:1500,termGraceMs:120,killWaitMs:220,pollMs:10,clock});
 const done=supervisor.start(observe=>{emit=observe;return {groupState:()=>group,
  signalGroup(signal){
   signals.push({signal,at:clock.now()});
   if(cleanup==='gone_before_term'){group='absent';return 'not_found';}
   return 'sent';
  },dispose(){disposed++;}};});
 emit({type:'spawned'});clock.advanceTo(100);emit({type:'exit',code:0,signal:null});
 if(cleanup==='term_sent'){
  assert.equal(supervisor.status().phase,'term_wait');assert.equal(supervisor.status().groupState,'present');
  assert.equal(supervisor.status().cleanupComplete,false,'zero leader exit and successful TERM do not prove group absence');
  group='absent';assert.equal(clock.advanceToNextTimer(),true);assert.equal(clock.now(),110);
 }
 const report=await done;
 assert.deepEqual(report.exit,{observed:true,code:0,signal:null});assert.equal(report.outcome,'exited_zero');
 assert.equal(report.trigger,'child_exit');assert.equal(report.parentSignal,null);assert.equal(report.deadlineObserved,false);
 assert.equal(report.groupState,'absent');assert.equal(report.cleanupComplete,true);assert.deepEqual(report.issues,[]);
 assert.deepEqual(report.signals,{term:cleanup==='already_absent'?'not_attempted':cleanup==='term_sent'?'sent':'not_found',kill:'not_attempted'});
 assert.deepEqual(signals,cleanup==='already_absent'?[]:[{signal:'SIGTERM',at:100}]);
 assert.equal(report.elapsedMs,cleanup==='term_sent'?110:100);
 assert.equal(disposed,1);assert.equal(clock.advanceToNextTimer(),false);
 assert.equal(report.remoteCancellationConfirmed,false);assert.equal(report.confirmedCostUsd,null);assert.equal(report.acceptancePassed,null);
 clock.advanceTo(2000);assert.deepEqual(supervisor.status(),report);
});

test('review: synthetic next-timer advance respects cancellation and does not invent a timer',async()=>{
 const {SyntheticSupervisorClock}=await import('./helpers/acceptance-supervisor-fixture.js');
 const clock=new SyntheticSupervisorClock(),observed:number[]=[];
 const canceled=clock.setTimer(()=>assert.fail('canceled timer fired'),5);
 clock.setTimer(()=>observed.push(clock.now()),30);
 clock.setTimer(()=>observed.push(clock.now()),10);
 clock.clearTimer(canceled);
 assert.equal(clock.advanceToNextTimer(),true);assert.equal(clock.now(),10);
 assert.deepEqual(observed,[10]);
 assert.equal(clock.advanceToNextTimer(),true);assert.equal(clock.now(),30);
 assert.deepEqual(observed,[10,30]);
 assert.equal(clock.advanceToNextTimer(),false);assert.equal(clock.now(),30);
});

for(const nextGroup of ['absent','present','unknown'] as const)test(`review: post-exit next poll preserves ${nextGroup} group facts`,async()=>{
 const {SyntheticSupervisorClock}=await import('./helpers/acceptance-supervisor-fixture.js');
 const clock=new SyntheticSupervisorClock();let group:ProcessGroupState='present',disposed=0;
 let emit!:(event:SupervisedProcessEvent)=>void;
 const signals:Array<{signal:string;at:number}>=[];
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:1500,termGraceMs:120,killWaitMs:220,pollMs:10,clock});
 const done=supervisor.start(observe=>{emit=observe;return {groupState:()=>group,
  signalGroup(signal){signals.push({signal,at:clock.now()});return 'sent';},dispose(){disposed++;}};});
 emit({type:'spawned'});clock.advanceTo(1500);clock.advanceTo(1620);
 emit({type:'exit',code:null,signal:'SIGKILL'});
 assert.equal(supervisor.status().phase,'kill_wait');assert.equal(supervisor.status().groupState,'present');
 group=nextGroup;
 clock.advanceTo(1620);assert.equal(supervisor.status().phase,'kill_wait','same-time advance cannot replace the next poll');
 assert.equal(clock.advanceToNextTimer(),true);assert.equal(clock.now(),1630);
 if(nextGroup==='absent')assert.equal(supervisor.status().phase,'settled');
 else {
  assert.equal(supervisor.status().phase,'kill_wait');assert.equal(supervisor.status().cleanupComplete,false);
  for(let i=0;i<30&&supervisor.status().phase!=='settled';i++)assert.equal(clock.advanceToNextTimer(),true);
 }
 const report=await done;
 assert.equal(report.elapsedMs,nextGroup==='absent'?1630:1840);
 assert.equal(report.groupState,nextGroup);assert.equal(report.cleanupComplete,nextGroup==='absent');
 assert.equal(report.exit.signal,'SIGKILL');assert.equal(report.outcome,'signaled');
 if(nextGroup!=='absent')assert.ok(report.issues.includes('group_unconfirmed'));
 if(nextGroup==='unknown')assert.ok(report.issues.includes('probe_failed'));
 assert.deepEqual(signals,[{signal:'SIGTERM',at:1500},{signal:'SIGKILL',at:1620}]);
 assert.equal(disposed,1);assert.equal(clock.advanceToNextTimer(),false);
 clock.advanceTo(2000);assert.deepEqual(supervisor.status(),report);
});
