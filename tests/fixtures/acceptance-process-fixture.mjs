// Closed synthetic subprocess fixture. Never import server/main, config, stores,
// model transports or user archives. It is not an acceptance execution command.
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {mkdirSync,symlinkSync,fsyncSync,writeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const [role,scenario,root,wall='2000',grace='150',wait='300',clockMode='manual',probeMode='normal']=process.argv.slice(2);
const fixture=fileURLToPath(import.meta.url);
const loader=fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url));
globalThis.fetch=async()=>{throw new Error('synthetic_network_forbidden');};
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(role==='owner'){
 const {checkedFixtureRoot}=await import('../helpers/acceptance-supervisor-fixture.ts');checkedFixtureRoot(root);
 const guardian=spawn(process.execPath,['--import',loader,fixture,'guardian',scenario,root,wall,grace,wait,clockMode,probeMode],{
  cwd:root,env:{},stdio:['pipe','inherit','inherit']});
 // The independent guardian holds its own deadline and sees EOF if this owner
 // dies, including SIGKILL. It never relies on the blocked worker's event loop.
 guardian.on('exit',()=>process.exit());
 process.stdin.pipe(guardian.stdin);
 process.on('SIGINT',()=>guardian.kill('SIGINT'));process.on('SIGTERM',()=>guardian.kill('SIGTERM'));
}else if(role==='guardian'){
 const {AcceptanceProcessSupervisor}=await import('../../src/server/acceptance-process-supervisor.ts');
 const {launchSyntheticProcess,SyntheticSupervisorClock}=await import('../helpers/acceptance-supervisor-fixture.ts');
 if(!['manual','system'].includes(clockMode))throw new Error('synthetic_clock_required');
 if(!['normal','defer_exit_probe'].includes(probeMode)||probeMode==='defer_exit_probe'&&clockMode!=='manual')throw new Error('synthetic_probe_required');
 const clock=clockMode==='manual'?new SyntheticSupervisorClock():undefined;
 const started=performance.now();
 const controller=new AcceptanceProcessSupervisor({maxWallMs:Number(wall),termGraceMs:Number(grace),killWaitMs:Number(wait),pollMs:10,clock});
 const status=()=>output({kind:'status',report:controller.status()});
 const interrupt=reason=>{controller.interrupt(reason);status();};
 const onInt=()=>interrupt('SIGINT'),onTerm=()=>interrupt('SIGTERM'),onEOF=()=>{
  interrupt('parent_disconnect');
  // The owner is gone, so the fixture itself drives the injected grace clock.
  // The real OS exit still has to arrive before cleanup can be reported.
  if(clock&&controller.status().phase==='term_wait'){clock.advanceTo(clock.now()+Number(grace));status();}
 };
 let input='';
 const onData=chunk=>{
  input+=chunk.toString();let end;
  while((end=input.indexOf('\n'))>=0){
   const message=JSON.parse(input.slice(0,end));input=input.slice(end+1);
   if(!clock||message.kind!=='advance'||message.to>Number(wall)+Number(grace)+Number(wait))throw new Error('synthetic_command_required');
   clock.advanceTo(message.to);status();
  }
 };
 process.stdin.on('data',onData);
 process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);process.stdin.on('end',onEOF);process.stdin.resume();
 output({kind:'guardian',pid:process.pid});
 let deferredExitProbe=false,groupPoll;
 const result=await controller.start(observe=>{
  const port=launchSyntheticProcess(root,scenario,event=>{
   if(event.type==='exit'&&probeMode==='defer_exit_probe')deferredExitProbe=true;
   observe(event);output({kind:'event',event,report:controller.status()});
   if(clock&&event.type==='exit'&&controller.status().phase!=='settled'&&!groupPoll){
    // OS exit and group disappearance are separate observations. Manual time
    // must resume its pending poll when the real group is gone, even if the
    // owner has died and can no longer send clock commands. This is test-only
    // synchronization, not a production deadline or a fabricated exit/absence.
    groupPoll=setInterval(()=>{
     if(controller.status().phase==='settled'){clearInterval(groupPoll);return;}
     if(port.groupState()!=='absent')return;
     clearInterval(groupPoll);clock.advanceToNextTimer();status();
    },5);
   }
  },message=>output({kind:message.kind==='term_received'?'term_received':'ready',message,report:controller.status(),
   wallElapsedMs:performance.now()-started}),pid=>output({kind:'spawned',pid}));
  return {...port,groupState(){
   // Deterministically replay a conservative group observation at actual OS
   // exit. Never fabricate absence or an exit; later probes use the real group.
   if(deferredExitProbe){deferredExitProbe=false;return 'present';}
   return port.groupState();
  }};
 });
 clearInterval(groupPoll);
 process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);process.stdin.off('end',onEOF);process.stdin.off('data',onData);process.stdin.destroy();
 output({kind:'result',report:result});
 // Do not wait for inherited stdout/IPC EOF or an unconfirmed child forever.
 process.exitCode=result.trigger==='parent_signal'?(result.parentSignal==='SIGINT'?130:143):0;
}else if(role==='descendant'){
 // Same process group, deliberately ignores TERM and holds inherited pipes.
 process.on('SIGTERM',()=>{});process.send?.({kind:'descendant_ready',pid:process.pid});setInterval(()=>{},1000);
}else if(role==='child'){
 const allowed=['exit_zero','exit_nonzero','self_signal','init_block','sync_block','ignore_term','graceful','seal_block','crash','orphan','hold_pipe','unsafe_path','never_ready'];
 if(!allowed.includes(scenario))throw new Error('synthetic_scenario_required');
 const tell=extra=>new Promise((resolve,reject)=>process.send(
  {kind:'child_ready',pid:process.pid,environmentKeys:Object.keys(process.env),...extra},error=>error?reject(error):resolve()));
 const block=stage=>{let announced=false;while(true){if(!announced){announced=true;void tell({stage});}}};
 if(scenario==='never_ready'){setInterval(()=>{},1000);}
 else if(scenario==='init_block'){process.on('SIGTERM',()=>{});block('before_import');}
 if(scenario==='exit_zero'||scenario==='exit_nonzero'){await tell({stage:'exit'});process.exit(scenario==='exit_zero'?0:7);}
 if(scenario==='self_signal'){await tell({stage:'signal'});process.kill(process.pid,'SIGUSR2');}
 else if(scenario==='orphan'||scenario==='hold_pipe'){
  const descendant=spawn(process.execPath,[fixture,'descendant',scenario,root],{
   cwd:root,env:{},stdio:['ignore',scenario==='hold_pipe'?'inherit':'ignore','ignore','ipc']});
  descendant.on('message',async message=>{await tell({stage:'orphan',descendantPid:message.pid});process.exit(0);});
 }else if(!['exit_zero','exit_nonzero','never_ready'].includes(scenario)){
  const {AcceptanceEvidenceWriter}=await import('../../src/server/acceptance-evidence-writer.ts');
  const {DecisionWaitEvidence}=await import('../../src/server/decision-wait-evidence.ts');
  const {RuntimeFoodEvidence}=await import('../../src/server/runtime-food-evidence.ts');
  Date.now=()=>1700000000000;const fingerprint='9'.repeat(64);
  if(scenario==='unsafe_path'){
   const target=join(root,'safe');mkdirSync(target);symlinkSync(target,join(root,'alias'));
   let refused=0;for(const directory of [join(root,'runtime','new'),join(root,'alias','new'),`${root}/../unsafe`]){
    try{new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'synthetic',fromMinute:480});}catch{refused++;}
   }
   await tell({stage:'unsafe_path',refused});process.exit(refused===3?0:9);
  }
  let sealFd=-1;
  const writer=new AcceptanceEvidenceWriter({directory:join(root,'evidence'),sourceFingerprint:fingerprint,worldId:'synthetic',fromMinute:480,
   ...(scenario==='seal_block'?{io:{
    writeSync(fd,buffer,offset,length,position){
     if(buffer.toString('utf8').includes('"type":"acceptance_evidence_close"'))sealFd=fd;
     return writeSync(fd,buffer,offset,length,position);
    },fsyncSync:fd=>{if(fd===sealFd)block('seal_fsync');fsyncSync(fd);}}}:{})});
  const waiting=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>100});
  const eating=new RuntimeFoodEvidence({observe:writer.observeDirectEating});waiting.start(480);eating.start('synthetic',480);
  const close=()=>{waiting.stop(480);eating.stop('synthetic',480);
   writer.close({reason:'signal',sourceFingerprintAfter:fingerprint,statuses:{decisionWaiting:waiting.status(),directEating:eating.status()}});};
  if(scenario==='graceful')process.on('SIGTERM',()=>{close();process.exit(0);});
  else process.on('SIGTERM',()=>{if(scenario==='ignore_term')process.send({kind:'term_received'});});
  if(!['seal_block','sync_block'].includes(scenario))await tell({stage:'writer_open'});
  if(scenario==='crash')process.exit(11);
  if(scenario==='sync_block')block('writer_open');
  if(scenario==='seal_block')close();
  setInterval(()=>{},1000);
 }
}else throw new Error('synthetic_role_required');
