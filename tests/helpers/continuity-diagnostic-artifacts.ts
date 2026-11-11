/** Write newly constructed, sanitized JSON only. Never copy run/output files. */
import {lstatSync,mkdtempSync,realpathSync,writeFileSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {sanitizeSyntheticDiagnostic} from '../../src/server/production-model-process-diagnostics.js';
const count=(n:unknown,max:number)=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max?n as number:null;
const pick=(s:unknown,allowed:readonly string[])=>typeof s==='string'&&allowed.includes(s)?s:null;
export function continuityInvocationDiagnostic(input:{code:unknown;signal:unknown;scenario:unknown;mode:unknown;startedAtMs:number;finishedAtMs:number;messages:any[]}){
 const messages=input.messages,blocked=messages.find(m=>m?.type==='synthetic_process_blocked'),status=blocked?.status??messages.find(m=>m?.type==='synthetic_process_finished');
 return {schema:1,kind:'synthetic-continuity-invocation-diagnostic',exitCode:count(input.code,255),signal:pick(input.signal,['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGBUS','SIGHUP','SIGPIPE']),
  scenario:pick(input.scenario,['normal','sustained','sustained_crash_response','late_headers','crash_response']),mode:pick(input.mode,['new','resume']),
  elapsedMs:count(input.finishedAtMs-input.startedAtMs,1_000_000_000),reserved:messages.some(m=>m?.type==='synthetic_launch_reserved'),
  workerReady:messages.some(m=>m?.type==='synthetic_worker_ready'),workerFinished:messages.some(m=>m?.type==='synthetic_worker_finished'),blocked:!!blocked,
  launches:count(status?.launches,720),finished:count(status?.finished,720),reservedWallMs:count(status?.reservedWallMs,21_600_000),
  // These are the launch ledger's latest COMPLETED counts, not the failed worker's counts.
  launchLedgerAttempts:count(status?.attempts,20000),launchLedgerCompleted:count(status?.completed,20000),
  workerDiagnostics:messages.filter(m=>m?.type==='synthetic_worker_diagnostic').slice(0,3).map(m=>sanitizeSyntheticDiagnostic(m.diagnostic)),
  guardianDiagnostic:blocked?.diagnostic?sanitizeSyntheticDiagnostic(blocked.diagnostic):null,
  realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,readyForProduction:false,acceptancePassed:null};
}
export function continuityDiagnosticArtifacts(root:string,configured=process.env.VALLEY_CONTINUITY_DIAGNOSTICS){
 if(configured===undefined)return null;
 // CI creates this exact private root with mktemp. Refuse alternate paths,
 // symlinks, other output directories and insecure/pre-existing file targets.
 if(dirname(configured)!==join(root,'output')||!/^continuity-ci-[A-Za-z0-9]{6}$/.test(basename(configured))||realpathSync(configured)!==configured)throw Error('invalid_synthetic_diagnostic_directory');
 const st=lstatSync(configured);if(!st.isDirectory()||st.uid!==process.getuid?.()||(st.mode&0o777)!==0o700)throw Error('invalid_synthetic_diagnostic_directory');
 const path=mkdtempSync(join(configured,'case-'));
 return (invocation:number,input:Parameters<typeof continuityInvocationDiagnostic>[0])=>{
  if(count(invocation,100)===null||invocation<1)throw Error('invalid_synthetic_diagnostic_invocation');
  writeFileSync(join(path,`invocation-${invocation}.json`),JSON.stringify(continuityInvocationDiagnostic(input),null,2),{mode:0o600,flag:'wx'});
 };
}
