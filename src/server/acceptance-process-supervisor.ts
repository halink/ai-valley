/** External-process policy, not a runner. No model, database, environment, path,
 * shell command or global signal listener is opened by importing this module.
 * The only concrete adapter in this repository is a synthetic test fixture. */
export type SupervisorClock={now:()=>number;setTimer:(callback:()=>void,ms:number)=>unknown;clearTimer:(timer:unknown)=>void};
export type ProcessGroupState='present'|'absent'|'unknown';
export type ProcessSignalResult='sent'|'not_found'|'unknown';
export type SupervisedProcessEvent={type:'spawned'}|{type:'spawn_failed'}|{type:'transport_error'}
 |{type:'exit';code:number|null;signal:string|null};
/** Trusted adapter contract: own a fresh, isolated process group; never accept
 * caller-supplied PIDs. Methods must be nonblocking. exit means an OS child-exit
 * event, not a child IPC message, stdout line, successful kill(), or pipe close.
 * dispose removes listeners/unrefs handles; it must not wait for pipe EOF. */
export type SupervisedProcess={signalGroup:(signal:'SIGTERM'|'SIGKILL')=>ProcessSignalResult;
 groupState:()=>ProcessGroupState;dispose:()=>void};
export type SupervisorTrigger='child_exit'|'wall_limit'|'parent_signal'|'parent_disconnect'|'launch_failed'
 |'transport_error'|'clock_invalid'|'timer_failed';
export type SupervisorIssue='launch_failed'|'transport_error'|'clock_invalid'|'timer_failed'|'signal_failed'
 |'probe_failed'|'dispose_failed'|'exit_unobserved'|'group_unconfirmed';
export type AcceptanceProcessReport={schema:1;phase:'idle'|'running'|'term_wait'|'kill_wait'|'settled';
 trigger:SupervisorTrigger|null;parentSignal:'SIGINT'|'SIGTERM'|null;elapsedMs:number|null;maxWallMs:number;
 termGraceMs:number;killWaitMs:number;deadlineObserved:boolean;spawnObserved:boolean;
 exit:{observed:boolean;code:number|null;signal:string|null};
 outcome:'exited_zero'|'exited_nonzero'|'signaled'|'not_started'|'unknown';
 signals:{term:ProcessSignalResult|'not_attempted';kill:ProcessSignalResult|'not_attempted'};
 groupState:ProcessGroupState;cleanupComplete:boolean;issues:SupervisorIssue[];
 remoteCancellationConfirmed:false;confirmedCostUsd:null;realModelExecuted:null;acceptancePassed:null};
export type AcceptanceProcessOptions={maxWallMs:number;termGraceMs:number;killWaitMs:number;pollMs?:number;clock?:SupervisorClock};
const systemClock:SupervisorClock={now:()=>performance.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),
 clearTimer:id=>clearTimeout(id as ReturnType<typeof setTimeout>)};
const duration=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<=2_147_483_647;
const stamp=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

/** Starts the absolute budget BEFORE launching the child. Child initialization,
 * imports, synchronous loops, writes and shutdown are all external to this event
 * loop. This is not a real-time OS guarantee: the supervisor, adapter and clock
 * must themselves remain responsive. A launch callback that blocks this process
 * cannot be preempted here. No child readiness/heartbeat resets the deadline. */
export class AcceptanceProcessSupervisor{
 private readonly clock:SupervisorClock;private readonly options:Required<Omit<AcceptanceProcessOptions,'clock'>>;
 private phase:AcceptanceProcessReport['phase']='idle';private trigger:SupervisorTrigger|null=null;
 private parentSignal:'SIGINT'|'SIGTERM'|null=null;private first:number|null=null;private last:number|null=null;
 private elapsed:number|null=null;private until=0;private timer:unknown;private armed=false;private timerGeneration=0;
 private port:SupervisedProcess|null=null;private launching=false;private adapterBusy=false;private draining=false;private settlementPending=false;private queued:Array<()=>void>=[];
 private spawned=false;private spawnFailed=false;private exit:AcceptanceProcessReport['exit']={observed:false,code:null,signal:null};
 private term:AcceptanceProcessReport['signals']['term']='not_attempted';private kill:AcceptanceProcessReport['signals']['kill']='not_attempted';
 private group:ProcessGroupState='unknown';private deadline=false;private issues=new Set<SupervisorIssue>();
 private resolve!:(report:AcceptanceProcessReport)=>void;readonly done:Promise<AcceptanceProcessReport>;
 constructor(options:AcceptanceProcessOptions){
  const pollMs=options.pollMs??25;
  if(!duration(options.maxWallMs)||!duration(options.termGraceMs)||!duration(options.killWaitMs)||!duration(pollMs))
   throw new Error('invalid_acceptance_process_options');
  this.options={maxWallMs:options.maxWallMs,termGraceMs:options.termGraceMs,killWaitMs:options.killWaitMs,pollMs};
  this.clock=options.clock??systemClock;this.done=new Promise(resolve=>{this.resolve=resolve;});
 }
 start(launch:(observe:(event:SupervisedProcessEvent)=>void)=>SupervisedProcess){
  if(this.phase!=='idle')throw new Error('acceptance_process_supervisor_is_single_use');
  this.phase='running';
  if(!this.readTime()){this.trigger='clock_invalid';this.finish();return this.done;}
  this.first=this.last;this.elapsed=0;this.until=this.first!+this.options.maxWallMs;
  // Arm before launch. The launch callback may start only a nonblocking spawn.
  if(!this.arm(this.options.maxWallMs)){this.trigger='timer_failed';this.finish();return this.done;}
  this.launching=true;
  try{this.port=launch(event=>{if(this.launching||this.adapterBusy)this.queued.push(()=>this.observe(event));else this.observe(event);});}
  catch{this.issues.add('launch_failed');this.trigger='launch_failed';this.launching=false;this.finish();return this.done;}
  this.launching=false;
  this.drain();
  this.tick();
  return this.done;
 }
 /** Caller explicitly binds/unbinds its signal/pipe source. No process.exit(). */
 interrupt(reason:'SIGINT'|'SIGTERM'|'parent_disconnect'){
  if(this.phase==='idle'||this.phase==='settled')return;
  if(this.launching||this.adapterBusy){this.queued.push(()=>this.interrupt(reason));return;}
  if(reason!=='parent_disconnect')this.parentSignal??=reason;
  if(!this.readTime()){this.emergency('clock_invalid');return;}
  if(this.phase==='running')this.stop(reason==='parent_disconnect'?'parent_disconnect':'parent_signal');
  else if(this.phase==='term_wait')this.escalate();
 }
 status():AcceptanceProcessReport{
  const outcome=this.exit.observed?(this.exit.signal!==null?'signaled':this.exit.code===0?'exited_zero':
   this.exit.code!==null?'exited_nonzero':'unknown'):this.spawnFailed?'not_started':'unknown';
  return {schema:1,phase:this.phase,trigger:this.trigger,parentSignal:this.parentSignal,elapsedMs:this.elapsed,
   maxWallMs:this.options.maxWallMs,termGraceMs:this.options.termGraceMs,killWaitMs:this.options.killWaitMs,
   deadlineObserved:this.deadline,spawnObserved:this.spawned,exit:{...this.exit},outcome,
   signals:{term:this.term,kill:this.kill},groupState:this.group,
   cleanupComplete:this.phase==='settled'&&this.group==='absent'&&(this.exit.observed||this.spawnFailed),issues:[...this.issues],
   remoteCancellationConfirmed:false,confirmedCostUsd:null,realModelExecuted:null,acceptancePassed:null};
 }
 private readTime(){
  let now:number;try{now=this.clock.now();}catch{now=NaN;}
  if(!stamp(now)||this.last!==null&&now<this.last){this.elapsed=null;this.issues.add('clock_invalid');return false;}
  this.last=now;this.elapsed=this.first===null?0:now-this.first;
  if(this.first!==null&&this.elapsed>=this.options.maxWallMs)this.deadline=true;
  return true;
 }
 private probe(){
  if(this.spawnFailed){this.group='absent';return;}
  this.adapterBusy=true;
  try{const value=this.port?.groupState();this.group=value==='present'||value==='absent'?value:'unknown';}
  catch{this.group='unknown';}
  if(this.group==='unknown')this.issues.add('probe_failed');
  this.adapterBusy=false;this.drain();
 }
 private send(signal:'SIGTERM'|'SIGKILL'){
  if(this.phase==='settled')return;
  if(signal==='SIGTERM'?this.term!=='not_attempted':this.kill!=='not_attempted')return;
  let result:ProcessSignalResult='unknown';this.adapterBusy=true;
  try{const value=this.port?.signalGroup(signal);if(value==='sent'||value==='not_found')result=value;}catch{}
  if(result==='unknown')this.issues.add('signal_failed');
  if(signal==='SIGTERM')this.term=result;else this.kill=result;
  this.adapterBusy=false;this.drain();
 }
 private drain(){
  if(this.draining||this.launching||this.adapterBusy)return;
  this.draining=true;
  try{while(this.queued.length&&this.phase!=='settled')this.queued.shift()!();}finally{this.draining=false;}
  if(this.settlementPending)this.finish();
 }
 private observe(event:SupervisedProcessEvent){
  if(this.phase==='settled')return;
  if(event.type==='spawned'){this.spawned=true;return;}
  if(event.type==='spawn_failed'){
   // A failed spawn is authoritative only before an actual spawn or exit.
   if(this.spawned||this.exit.observed){this.issues.add('transport_error');this.stop('transport_error');return;}
   this.spawnFailed=true;this.group='absent';this.trigger??='launch_failed';this.issues.add('launch_failed');this.readTime();this.finish();return;
  }
  if(event.type==='transport_error'){this.issues.add('transport_error');this.stop('transport_error');return;}
  if(this.exit.observed)return; // duplicate/replayed exit must not replace OS facts
  if(!(event.code===null||Number.isSafeInteger(event.code)&&event.code>=0)||
   !(event.signal===null||/^SIG[A-Z0-9]+$/.test(event.signal))||event.code!==null&&event.signal!==null){
   this.issues.add('transport_error');this.stop('transport_error');return;
  }
  this.exit={observed:true,code:event.code,signal:event.signal};
  if(!this.readTime()){this.emergency('clock_invalid');return;}
  this.probe();
  if(this.phase==='running'){
   this.trigger??=this.deadline?'wall_limit':'child_exit';
   if(this.group==='absent'){this.finish();return;}
   this.stop(this.trigger); // descendants can outlive a successful group leader
  }else if(this.group==='absent')this.finish();
 }
 private clear(){
  ++this.timerGeneration;
  if(!this.armed)return;this.armed=false;
  try{this.clock.clearTimer(this.timer);}catch{this.issues.add('timer_failed');}
 }
 private arm(ms:number){
  this.clear();const generation=++this.timerGeneration;let scheduling=true,synchronous=false;
  try{
   const timer=this.clock.setTimer(()=>{
    if(generation!==this.timerGeneration||this.phase==='settled')return;
    if(scheduling){synchronous=true;return;}
    ++this.timerGeneration;this.armed=false;this.tick();
   },Math.max(1,Math.ceil(ms)));
   scheduling=false;
   // An inline callback is not a usable asynchronous deadline source. Reject it
   // before launching anything, rather than recurse or lose a nested timer.
   if(synchronous){++this.timerGeneration;try{this.clock.clearTimer(timer);}catch{}
    this.issues.add('timer_failed');return false;}
   this.timer=timer;this.armed=true;return true;
  }catch{++this.timerGeneration;this.issues.add('timer_failed');return false;}
 }
 private stop(trigger:SupervisorTrigger){
  if(this.phase==='settled')return;
  if(this.phase!=='running')return;
  this.trigger??=trigger;
  if(!this.readTime()){this.emergency('clock_invalid');return;}
  this.phase='term_wait';this.until=Math.min(this.last!,this.first!+this.options.maxWallMs)+this.options.termGraceMs;this.send('SIGTERM');
  this.tick();
 }
 private escalate(){
  if(this.phase==='settled')return;
  this.phase='kill_wait';this.until=Math.min(this.until,this.last!)+this.options.killWaitMs;this.send('SIGKILL');this.tick();
 }
 private tick(){
  if(this.phase==='settled'||this.phase==='idle')return;
  if(!this.readTime()){this.emergency('clock_invalid');return;}
  if(this.phase==='running'){
   if(this.last!>=this.until){this.stop('wall_limit');return;}
   if(!this.arm(this.until-this.last!))this.emergency('timer_failed');return;
  }
  this.probe();
  if(this.isSettled())return;
  if(this.exit.observed&&this.group==='absent'){this.finish();return;}
  if(this.last!>=this.until){
   if(this.phase==='term_wait')this.escalate();else this.finish();
   return;
  }
  if(!this.arm(Math.min(this.options.pollMs,this.until-this.last!)))this.emergency('timer_failed');
 }
 private emergency(trigger:'clock_invalid'|'timer_failed'){
  this.trigger??=trigger;this.issues.add(trigger);this.send('SIGTERM');
  if(this.phase==='settled')return;
  this.send('SIGKILL');if(this.isSettled())return;this.probe();this.finish();
 }
 private isSettled(){return this.phase==='settled';}
 private finish(){
  if(this.phase==='settled')return;
  // Synchronous adapter callbacks have already delivered these observations.
  // Drain that finite queue before sealing the snapshot, even at the deadline.
  // Do not wait for any future OS event or asynchronous callback after it.
  if(this.draining&&this.queued.length){this.settlementPending=true;return;}
  this.clear();
  if(!this.exit.observed&&!this.spawnFailed)this.issues.add('exit_unobserved');
  if(this.group!=='absent')this.issues.add('group_unconfirmed');
  this.phase='settled';this.queued=[];
  try{this.port?.dispose();}catch{this.issues.add('dispose_failed');}
  this.resolve(this.status());
 }
}
