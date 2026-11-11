import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signalSyntheticProcessGroup} from '../src/server/production-model-process-signals.js';
import {AcceptanceProcessSupervisor,type ProcessGroupState,type SupervisedProcessEvent} from '../src/server/acceptance-process-supervisor.js';
import {SyntheticSupervisorClock} from './helpers/acceptance-supervisor-fixture.js';

const identity={pid:12345,startTicks:'6789'};
const errno=(code:string)=>Object.assign(new Error('synthetic stat or signal failure'),{code});
const stat=(ticks=identity.startTicks)=>`${identity.pid} (synthetic worker (test)) ${['S',...Array(18).fill('0'),ticks].join(' ')}`;

for(const signal of ['SIGTERM','SIGKILL'] as const){
 test(`process signal: ${signal} is sent only after matching the owned identity`,()=>{
  const sent:unknown[]=[];
  const result=signalSyntheticProcessGroup(identity,signal,()=> 'present',{
   readStat(pid){assert.equal(pid,identity.pid);return stat();},killGroup:(pid,value)=>{sent.push([pid,value]);}
  });
  assert.equal(result,'sent');assert.deepEqual(sent,[[identity.pid,signal]]);
 });
 for(const state of ['absent','present','unknown'] as const)test(`process signal: ${signal} rechecks group ${state} after leader ENOENT`,()=>{
  let probes=0;
  const result=signalSyntheticProcessGroup(identity,signal,()=>++probes===1?'present':state,{
   readStat(){throw errno('ENOENT');},killGroup(){assert.fail('missing leader identity cannot authorize a signal');}
  });
  assert.equal(result,state==='absent'?'not_found':'unknown');assert.equal(probes,2);
 });
}

test('process signal: confirmed absence needs no identity or signal',()=>{
 assert.equal(signalSyntheticProcessGroup(null,'SIGTERM',()=> 'absent',{
  readStat(){assert.fail('already absent');},killGroup(){assert.fail('already absent');}
 }),'not_found');
});

test('process signal: unknown or changed identity never authorizes a signal',()=>{
 for(const current of [null,identity])assert.equal(signalSyntheticProcessGroup(current,'SIGTERM',()=> 'present',{
  readStat:()=>stat('6790'),killGroup(){assert.fail('unknown or reused PID');}
 }),'unknown');
});

for(const code of ['EACCES','EIO','ESRCH'])test(`process signal: stat ${code} stays unknown even if group later disappears`,()=>{
 let probes=0;
 assert.equal(signalSyntheticProcessGroup(identity,'SIGTERM',()=>++probes===1?'present':'absent',{
  readStat(){throw errno(code);},killGroup(){assert.fail('failed identity read');}
 }),'unknown');
 assert.equal(probes,1);
});

for(const code of ['ESRCH','EPERM'])test(`process signal: actual group signal ${code} keeps its result`,()=>{
 assert.equal(signalSyntheticProcessGroup(identity,'SIGTERM',()=> 'present',{
  readStat:()=>stat(),killGroup(){throw errno(code);}
 }),code==='ESRCH'?'not_found':'unknown');
});

test('process signal: leader disappearing between group probe and stat does not poison a clean OS exit',async()=>{
 const clock=new SyntheticSupervisorClock();let group:ProcessGroupState='present',probes=0;
 let observe!:(event:SupervisedProcessEvent)=>void;
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:20,clock});
 const probe=()=>{probes++;return group;};
 const done=supervisor.start(emit=>{observe=emit;return {groupState:probe,
  signalGroup:signal=>signalSyntheticProcessGroup(identity,signal,probe,{
   readStat(){group='absent';throw errno('ENOENT');},killGroup(){assert.fail('group already disappeared');}
  }),dispose(){}};
 });
 observe({type:'spawned'});observe({type:'exit',code:0,signal:null});
 const report=await done;
 assert.equal(report.trigger,'child_exit');assert.equal(report.outcome,'exited_zero');
 assert.deepEqual(report.exit,{observed:true,code:0,signal:null});
 assert.equal(report.cleanupComplete,true);assert.equal(report.groupState,'absent');assert.deepEqual(report.issues,[]);
 assert.deepEqual(report.signals,{term:'not_found',kill:'not_attempted'});assert.equal(probes,4);
 assert.equal(report.realModelExecuted,null);assert.equal(report.acceptancePassed,null);
});

test('process signal: leader ENOENT with a remaining group still leaves signal_failed after later absence',async()=>{
 const clock=new SyntheticSupervisorClock();let group:ProcessGroupState='present';
 let observe!:(event:SupervisedProcessEvent)=>void;
 const supervisor=new AcceptanceProcessSupervisor({maxWallMs:100,termGraceMs:20,killWaitMs:20,pollMs:5,clock});
 const done=supervisor.start(emit=>{observe=emit;return {groupState:()=>group,
  signalGroup:signal=>signalSyntheticProcessGroup(identity,signal,()=>group,{
   readStat(){throw errno('ENOENT');},killGroup(){assert.fail('leaderless descendants cannot be identified');}
  }),dispose(){}};
 });
 observe({type:'spawned'});observe({type:'exit',code:0,signal:null});
 assert.equal(supervisor.status().cleanupComplete,false);assert.equal(supervisor.status().groupState,'present');
 group='absent';clock.advanceTo(5);const report=await done;
 assert.equal(report.cleanupComplete,true);assert.deepEqual(report.issues,['signal_failed']);
 assert.equal(report.signals.term,'unknown');assert.equal(report.acceptancePassed,null);
});
