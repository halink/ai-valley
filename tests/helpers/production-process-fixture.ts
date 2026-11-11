import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {TestContext} from 'node:test';
import {testTmpdir} from '../../scripts/repository-temporary.mjs';
export function ownProcessIdentity(pid:number){try{const raw=readFileSync(`/proc/${pid}/stat`,'utf8'),v=raw.slice(raw.lastIndexOf(')')+2).split(' ');return {pid,startTicks:v[19],state:v[0]};}catch{return null;}}
export function processFixture(t:TestContext){
 const base=mkdtempSync(join(testTmpdir(),'price-process-')),path=join(base,'run'),children:Array<{child:ChildProcess;identities:Map<number,string>}> =[];
 t.after(async()=>{for(const {child,identities} of children){
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  for(const [pid,ticks] of identities){const current=ownProcessIdentity(pid);if(current?.startTicks===ticks&&current.state!=='Z')try{process.kill(pid,'SIGKILL');}catch{}}
 }rmSync(base,{recursive:true,force:true});});
 return {path,launch(scenario='normal',mode:'new'|'resume'='new'){
  const child=spawn(process.execPath,['--import',resolve('scripts/acceptance-offline-guard.mjs'),'--import',resolve('node_modules/tsx/dist/loader.mjs'),
   resolve('scripts/production-model-process-guardian.mjs'),'--offline',mode,path,scenario],{cwd:process.cwd(),env:{},shell:false,stdio:['ignore','pipe','pipe']});
  const messages:any[]=[],identities=new Map<number,string>();children.push({child,identities});let stdout='',stderr='';
  child.stdout!.on('data',chunk=>{stdout+=String(chunk);for(;;){const at=stdout.indexOf('\n');if(at<0)break;const line=stdout.slice(0,at);stdout=stdout.slice(at+1);
   try{const value=JSON.parse(line);messages.push(value);if(['synthetic_watchdog_started','synthetic_worker_identity'].includes(value.type)&&Number.isSafeInteger(value.pid)){
    const current=ownProcessIdentity(value.pid);if(current)identities.set(value.pid,current.startTicks);
   }}catch{}}});child.stderr!.on('data',chunk=>{stderr+=String(chunk);});
  const done=new Promise<{code:number|null;signal:NodeJS.Signals|null;messages:any[];stderr:string}>(resolve=>{child.once('error',e=>resolve({code:null,signal:null,messages,stderr:stderr+String(e)}));child.once('exit',(code,signal)=>resolve({code,signal,messages,stderr}));});
  return {child,messages,done,async waitFor(type:string,maxMs=15000){const end=performance.now()+maxMs;while(performance.now()<end){const m=messages.find(m=>m.type===type);if(m)return m;
   if(child.exitCode!==null||child.signalCode!==null)throw Error(`child exited before ${type}: ${stderr} ${JSON.stringify(messages)}`);
   await new Promise(r=>setTimeout(r,10));}throw Error(`missing ${type}`);}};
 }};
}
