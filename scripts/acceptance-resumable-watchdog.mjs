// Independent worker reaper. The guardian keeps stdin open; EOF (including a
// guardian SIGKILL) triggers bounded TERM/KILL even if the worker blocks JS.
import {readFileSync,openSync,writeSync,fsyncSync,closeSync,constants} from 'node:fs';
const safeSend=value=>{if(process.connected)try{process.send?.(value,()=>{});}catch{}};
const [pidText,startTicks,record,...extra]=process.argv.slice(2),pid=Number(pidText);
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||extra.length||!Number.isSafeInteger(pid)||pid<=1
 ||!/^\d+$/.test(startTicks)||!/^watchdog-[0-9a-f-]{36}\.json$/.test(record??''))throw new Error('watchdog_bootstrap_required');
const identity=()=>{try{const raw=readFileSync(`/proc/${pid}/stat`,'utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');return {state:fields[0],start:fields[19]};}catch{return null;}};
const group=()=>{try{process.kill(-pid,0);return 'present';}catch(error){return error.code==='ESRCH'?'absent':'unknown';}};
let finished=false,stopping=false,reason='worker_exit',term='not_attempted',kill='not_attempted',phaseTimer,deadline,poll;
const send=signal=>{
 const current=identity();if(!current)return group()==='absent'?'not_found':'unknown';
 if(current.start!==startTicks)return 'identity_changed';
 try{process.kill(-pid,signal);return 'sent';}catch(error){return error.code==='ESRCH'?'not_found':'unknown';}
};
function finish(){
 if(finished)return;finished=true;clearTimeout(deadline);clearTimeout(phaseTimer);clearInterval(poll);
 const current=identity(),groupState=group(),result={schema:1,type:'resumable_watchdog',reason,signals:{term,kill},groupState,
  workerState:current?.start===startTicks?current.state:current?'identity_changed':'absent',cleanupComplete:groupState==='absent',
  realModelExecuted:false,actualProviderCostCny:null,acceptancePassed:null};
 let fd;try{fd=openSync(`/proc/self/fd/4/${record}`,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  const bytes=Buffer.from(JSON.stringify(result)+'\n');let offset=0;while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset);if(n<=0)throw new Error();offset+=n;}
  fsyncSync(fd);fsyncSync(4);
 }catch{}finally{if(fd!==undefined)closeSync(fd);}
 try{safeSend({...result,type:'resumable_watchdog_result'});}catch{}
 process.stdin.pause();process.stdin.destroy();if(process.connected)process.disconnect?.();if(!result.cleanupComplete)process.exitCode=1;
}
function stop(why){
 if(finished||stopping)return;stopping=true;reason=why;term=send('SIGTERM');
 if(group()==='absent'){finish();return;}
 phaseTimer=setTimeout(()=>{kill=send('SIGKILL');if(group()==='absent')finish();else phaseTimer=setTimeout(finish,1500);},1500);
}
process.on('SIGTERM',()=>stop('watchdog_signal'));process.on('SIGINT',()=>stop('watchdog_signal'));
process.stdin.once('end',()=>stop('guardian_disconnect'));process.stdin.once('error',()=>stop('guardian_pipe_failed'));process.stdin.resume();
deadline=setTimeout(()=>stop('independent_wall_limit'),33_000);
poll=setInterval(()=>{if(group()==='absent')finish();else{const current=identity();if(current&&current.start!==startTicks){reason='identity_changed';finish();}}},50);
const initial=identity();if(initial?.start!==startTicks){reason='identity_unconfirmed';finish();}
else safeSend({type:'resumable_watchdog_ready'});
