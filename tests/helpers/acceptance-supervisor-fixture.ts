/** TEST ONLY: a closed set of synthetic programs, never a configurable runner. */
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {basename,join} from 'node:path';
import {testTmpdir} from '../../scripts/repository-temporary.mjs';
import {realpathSync,lstatSync} from 'node:fs';
import type {SupervisedProcess,SupervisedProcessEvent,SupervisorClock} from '../../src/server/acceptance-process-supervisor.js';
export const syntheticScenarios=['exit_zero','exit_nonzero','self_signal','init_block','sync_block','ignore_term',
 'graceful','seal_block','crash','orphan','hold_pipe','unsafe_path','never_ready'] as const;
export type SyntheticScenario=typeof syntheticScenarios[number];
export const fixturePath=fileURLToPath(new URL('../fixtures/acceptance-process-fixture.mjs',import.meta.url));
export const fixtureLoader=fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url));
export function checkedFixtureRoot(root:string){
 if(process.platform!=='linux'||!basename(root).startsWith('valley-supervisor-fixture-')||realpathSync(root)!==root
  ||!lstatSync(root).isDirectory()||root!==join(testTmpdir(),basename(root)))throw new Error('synthetic_fixture_root_required');
}
export function launchSyntheticProcess(root:string,scenario:SyntheticScenario,observe:(event:SupervisedProcessEvent)=>void,
 ready?:(message:unknown)=>void,onStarted?:(pid:number)=>void):SupervisedProcess{
 checkedFixtureRoot(root);
 if(!syntheticScenarios.includes(scenario))throw new Error('synthetic_scenario_required');
 // No PATH, credentials, NODE_OPTIONS, extra arguments, executable override or shell.
 const child=spawn(process.execPath,['--import',fixtureLoader,fixturePath,'child',scenario,root],{
  cwd:root,env:{},detached:true,stdio:['ignore',scenario==='hold_pipe'?'pipe':'ignore','ignore','ipc']});
 let spawned=false,failed=false,gone=false;
 const onSpawn=()=>{spawned=true;onStarted?.(child.pid!);observe({type:'spawned'});};
 const onError=()=>{if(!spawned&&!child.pid){failed=true;observe({type:'spawn_failed'});}else observe({type:'transport_error'});};
 const onExit=(code:number|null,signal:NodeJS.Signals|null)=>observe({type:'exit',code,signal});
 const onMessage=(message:unknown)=>ready?.(message);
 child.on('spawn',onSpawn);child.on('error',onError);child.on('exit',onExit);child.on('message',onMessage);
 const group=()=>{
  if(gone||failed)return 'absent' as const;
  if(!child.pid)return 'unknown' as const;
  try{process.kill(-child.pid,0);return 'present' as const;}
  catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){gone=true;return 'absent' as const;}return 'unknown' as const;}
 };
 return {groupState:group,signalGroup(signal){
  if(gone||failed)return 'not_found';if(!child.pid)return 'unknown';
  try{process.kill(-child.pid,signal);return 'sent';}
  catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){gone=true;return 'not_found';}return 'unknown';}
 },dispose(){
  child.off('spawn',onSpawn);child.off('exit',onExit);child.off('message',onMessage);child.off('error',onError);
  // Avoid unhandled late transport errors; they cannot change the settled report.
  child.on('error',()=>{});if(child.connected)child.disconnect();child.stdout?.destroy();child.unref();
 }};
}
/** Test driver time, deliberately independent of process/bootstrap wall time.
 * Production still starts its absolute clock before launch and never waits for ready. */
export class SyntheticSupervisorClock implements SupervisorClock{
 private value=0;private serial=0;private timers=new Map<number,{at:number;callback:()=>void}>();
 now=()=>this.value;
 setTimer=(callback:()=>void,ms:number)=>{const id=++this.serial;this.timers.set(id,{at:this.value+ms,callback});return id;};
 clearTimer=(id:unknown)=>{this.timers.delete(id as number);};
 advanceTo(to:number){
  if(!Number.isSafeInteger(to)||to<this.value)throw new Error('invalid_synthetic_time');
  this.value=to;
  for(let i=0;i<100;i++){
   const due=[...this.timers].filter(([,timer])=>timer.at<=to);
   if(!due.length)return;
   for(const [id,timer] of due){if(!this.timers.delete(id))continue;timer.callback();}
  }
  throw new Error('synthetic_timer_loop');
 }
 advanceToNextTimer(){
  if(!this.timers.size)return false;
  this.advanceTo(Math.min(...[...this.timers.values()].map(timer=>timer.at)));return true;
 }
}
export function spawnSyntheticGuardian(root:string,scenario:SyntheticScenario,options:{wall?:number;grace?:number;wait?:number;owner?:boolean;clock?:'manual'|'system';deferExitProbe?:boolean}={}):ChildProcess{
 checkedFixtureRoot(root);if(!syntheticScenarios.includes(scenario))throw new Error('synthetic_scenario_required');
 return spawn(process.execPath,['--import',fixtureLoader,fixturePath,options.owner?'owner':'guardian',scenario,root,
  String(options.wall??2000),String(options.grace??150),String(options.wait??300),options.clock??'manual',options.deferExitProbe?'defer_exit_probe':'normal'],{
  cwd:root,env:{},stdio:['pipe','pipe','pipe']});
}
