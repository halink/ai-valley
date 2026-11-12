// Synthetic-only fixed launcher. Caller provides fabricated artifact paths and
// an open report descriptor; no arbitrary worker, shell, credentials or network.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function launchSyntheticAccountProcess(options,{scenario='normal',reportDescriptor,onMessage=()=>{}}={}){
 if(options?.contract?.executionKind!=='synthetic-production-candidate'||!Number.isSafeInteger(reportDescriptor)||reportDescriptor<0)throw Error('synthetic_account_launch_invalid');
 options=structuredClone(options);
 const guard=fileURLToPath(new URL('./acceptance-offline-guard.mjs',import.meta.url));
 const watchdog=fileURLToPath(new URL('./production-model-account-watchdog.mjs',import.meta.url));
 const startedMonotonicNs=process.hrtime.bigint().toString();
 const child=spawn(process.execPath,['--import',guard,watchdog],{cwd:'/',env:{},detached:true,shell:false,stdio:['ignore','ignore','ignore','ipc',reportDescriptor]});
 child.on('message',onMessage);
 child.once('spawn',()=>child.send({options,scenario,startedMonotonicNs},()=>{}));
 return child;
}
