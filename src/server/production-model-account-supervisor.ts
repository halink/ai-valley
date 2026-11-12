/** Disconnected trusted-process policy, NOT a production launcher. main does not
 * import this module. launch must be a trusted OS-process adapter, never IPC data.
 * Durable completion is checked here, not accepted as a caller boolean. */
import {lstatSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {AcceptanceProcessSupervisor,type AcceptanceProcessOptions,type AcceptanceProcessReport,type SupervisedProcess,type SupervisedProcessEvent} from './acceptance-process-supervisor.js';
import {acquireProductionModelAccountOwnership,type AccountOwnershipOptions} from './production-model-account-ownership.js';
import {acquireRuntimeOwnership} from './runtime-lock.js';
import {WorldStore} from './store.js';
import {persistedWorldFingerprint} from './acceptance-offline-protocol.js';
import {ProductionModelJournal,modelEvidenceHash,productionCandidateContract,productionGatedCandidateContract,type ProductionCandidateContract} from './production-model-journal.js';

type Options={account:AccountOwnershipOptions;worldPath:string;journalPath:string;contract:ProductionCandidateContract;process:AcceptanceProcessOptions};
const identity=(path:string)=>{
 const s=lstatSync(path);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('model_supervisor_unsafe_file');
 return `${s.dev}:${s.ino}`;
};
export type ModelAccountSupervisionReport={process:AcceptanceProcessReport;account:'clean'|'unresolved';durableCompletionVerified:boolean;
 reason:'clean'|'process_not_clean'|'durable_completion_failed';readyForProduction:false;realModelExecuted:null;actualProviderCostCny:null};

export class ProductionModelAccountSupervisor{
 private readonly options:Options;private supervisor:AcceptanceProcessSupervisor;private started=false;
 constructor(options:Options){
  const c=options.contract,canonical=c.executionKind==='gated-production-http-candidate'
   ?productionGatedCandidateContract({...c,admissionHash:c.admissionHash!}):productionCandidateContract(c);
  if(modelEvidenceHash(c)!==modelEvidenceHash(canonical)||options.account.runId!==c.runId
   ||options.worldPath===options.journalPath||![options.worldPath,options.journalPath].every(p=>isAbsolute(p)&&resolve(p)===p)
   ||options.process.maxWallMs>30000)throw Error('model_supervisor_contract_invalid');
  this.options={...structuredClone({account:options.account,worldPath:options.worldPath,journalPath:options.journalPath,contract:options.contract}),process:{...options.process}};
  // Preserve the injected trusted clock's functions; snapshots of artifact
  // identity and contract below cannot be changed by mutating caller options.
  this.options.process={...options.process};
  this.supervisor=new AcceptanceProcessSupervisor(options.process);
 }
 interrupt(reason:'SIGINT'|'SIGTERM'|'parent_disconnect'){this.supervisor.interrupt(reason);}
 async start(launch:(observe:(event:SupervisedProcessEvent)=>void)=>SupervisedProcess):Promise<ModelAccountSupervisionReport>{
  if(this.started)throw Error('model_supervisor_single_use');this.started=true;
  const started=performance.now();
  const o=this.options;
  if(Date.now()<o.contract.createdAtMs||Date.now()>=o.contract.deadlineAtMs)throw Error('model_supervisor_expired');
  const worldIdentity=identity(o.worldPath),journalIdentity=identity(o.journalPath);
  const account=acquireProductionModelAccountOwnership(o.account);
  let clean=false;
  try{
   const verifyArtifacts=(onVerified:()=>void)=>{
    account.assertOwned();
    // Hold both path-anchored locks through verification AND account release.
    const worldLock=acquireRuntimeOwnership(o.worldPath);
    try{
     const journalLock=acquireRuntimeOwnership(o.journalPath);
     try{
      if(identity(worldLock.database)!==worldIdentity||identity(journalLock.database)!==journalIdentity)throw Error('artifact_replaced');
      const store=new WorldStore(worldLock.database);
      try{
       const world=store.loadForRuntime();
       if(!world||world.id!==o.contract.worldId||world.mode!=='formal'||!world.clock.paused||world.metrics.inFlight.length)throw Error('world_not_closed');
       const db=new DatabaseSync(journalLock.database);
       try{
        const journal=new ProductionModelJournal(db,o.contract,{create:false,worldFingerprint:persistedWorldFingerprint(world)}),s=journal.status();
        if(s.pending||s.failure||s.runtimeStop||s.attempts!==s.completed)throw Error('journal_not_closed');

       }finally{db.close();}
      }finally{store.close();}
      worldLock.assertOwned();journalLock.assertOwned();account.assertOwned();
      onVerified();
     }finally{journalLock.release();}
    }finally{worldLock.release();}
   };
   // Refuse old pending/mismatched state before a child can dispatch anything.
   verifyArtifacts(()=>{});
   account.assertOwned();
   const remaining=Math.floor(Math.min(o.process.maxWallMs-(performance.now()-started),o.contract.deadlineAtMs-Date.now()));
   if(Date.now()<o.contract.createdAtMs||!Number.isSafeInteger(remaining)||remaining<1)throw Error('model_supervisor_expired');
   this.supervisor=new AcceptanceProcessSupervisor({...o.process,maxWallMs:remaining});
   const report=await this.supervisor.start(launch);
   const result=(reason:ModelAccountSupervisionReport['reason']):ModelAccountSupervisionReport=>({process:report,
    account:clean?'clean':'unresolved',durableCompletionVerified:clean,reason,readyForProduction:false,realModelExecuted:null,actualProviderCostCny:null});
   if(!report.cleanupComplete||report.outcome!=='exited_zero'||report.trigger!=='child_exit'||report.issues.length)return result('process_not_clean');
   try{verifyArtifacts(()=>{account.closeClean();clean=true;});
   }catch{return result('durable_completion_failed');}
   return result('clean');
  }finally{if(!clean)account.abandon();}
 }
}
