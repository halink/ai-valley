import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync,mkdirSync,symlinkSync,writeFileSync,existsSync,renameSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {OFFLINE_PROTOCOL,sourceManifest,type OfflineScenario} from '../src/server/acceptance-offline-protocol.js';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const guard=join(root,'scripts/acceptance-offline-guard.mjs'),loader=join(root,'node_modules/tsx/dist/loader.mjs');
const launcher=join(root,'scripts/run-nine-resident-acceptance.mjs'),guardian=join(root,'scripts/acceptance-offline-guardian.mjs');
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
function fixture(t:TestContext){const parent=mkdtempSync(join(testTmpdir(),'valley-offline-test-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));return {parent,directory:join(parent,'run')};}
function launch(t:TestContext,scenario:OfflineScenario,settings:{publicEntry?:boolean;signal?:boolean;closeOwner?:boolean}={}){
 const paths=fixture(t),lines:any[]=[];
 const child=spawn(process.execPath,settings.publicEntry?[launcher,'--offline','--output',paths.directory]:
  ['--import',guard,'--import',loader,guardian,paths.directory,scenario],{
   cwd:'/',env:settings.publicEntry?{QWEN_API_KEY:'OFFLINE_CANARY_CREDENTIAL',HTTP_PROXY:'https://forbidden.invalid',VALLEY_DATABASE:'/forbidden/runtime/formal.sqlite',
    NODE_OPTIONS:'--no-warnings',VITE_SECRET:'OFFLINE_CANARY_CREDENTIAL'}:{},stdio:['pipe','pipe','pipe']});
 let output='',errors='',pending='';
 child.stdout.on('data',chunk=>{output+=chunk.toString();pending+=chunk.toString();let index;
  while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);let row;try{row=JSON.parse(line);}catch{continue;}lines.push(row);
   if(row.type==='offline_ready'){if(settings.signal)child.kill('SIGTERM');if(settings.closeOwner)child.stdin.end();}
  }
 });
 child.stderr.on('data',chunk=>{errors+=chunk.toString();});child.stdin.on('error',()=>{});
 const done=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 t.after(()=>{child.stdin.destroy();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
 return {...paths,child,lines,done,output:()=>output,errors:()=>errors,result:()=>read(join(paths.directory,'offline-result.json')),
  worker:()=>read(join(paths.directory,'offline-worker-close.json'))};
}
test('public offline entry runs fresh formal nine runtime and exact endpoint with scrubbed environment',async t=>{
 const f=launch(t,'endpoint',{publicEntry:true});const exit=await f.done;assert.equal(exit.code,0,f.errors());
 const r=f.result(),m=read(join(f.directory,'offline-manifest.json')),worker=f.worker();
 assert.equal(r.offlineEndpointVerified,true);assert.equal(r.realModelExecuted,false);assert.equal(r.acceptancePassed,null);assert.equal(r.readyForRealRun,false);
 assert.equal(r.evidence.complete,true);assert.equal(r.evidence.realModelExecuted,null);assert.equal(r.process.realModelExecuted,null);
 assert.equal(r.evidence.toMinute,482.5);assert.equal(worker.loadedMinute,482.5);assert.equal(worker.runtimeMinute,482.5);assert.ok(worker.modelCalls>0);
 assert.equal(r.reloadVerified,true);assert.equal(worker.loadedWorldFingerprint,worker.runtimeWorldFingerprint);
 assert.equal(r.evidence.acceptanceControl.finalStatus.endpoint.residents.length,9);
 assert.equal(m.plan.primary,'qwen3.8-flash');assert.equal(m.plan.gameMinutes,21600);assert.equal(m.plan.expectedEndMinute,22080);
 assert.equal(m.freeCandidateContract.proposal.modelSlots,1);assert.equal(m.freeCandidateContract.executedByThisEntry,false);
 assert.equal(m.freeCandidateContract.proposal.authorized,false);assert.equal(m.freeCandidateContract.liveTransportAvailable,false);assert.equal(m.freeCandidateContract.realPriceEvidence,null);
 assert.equal(m.initial.residentIds.length,9);assert.equal(m.realRunGate.authorized,false);assert.equal(m.offlineProtocol.endGameMinute,482.5);
 assert.equal(r.sourceFingerprintBefore,r.sourceFingerprintAfter);assert.equal(r.sourceUnchanged,true);
 assert.equal(r.process.exit.observed,true);assert.equal(r.process.cleanupComplete,true);assert.equal(r.process.outcome,'exited_zero');
 assert.equal(r.foodProduction,null);assert.equal(r.foodConsumption,null);assert.equal(r.realProviderCostUsd,null);
 assert.equal(statSync(join(f.directory,'world.sqlite')).mode&0o777,0o600);assert.equal(statSync(f.directory).mode&0o777,0o700);
 const captured=JSON.stringify([r,m,worker,f.output(),f.errors()]);assert.equal(captured.includes('OFFLINE_CANARY_CREDENTIAL'),false);
});
test('entry rejects run/resume/model/budget overrides before creating output',t=>{
 const {directory}=fixture(t);
 for(const args of [['--run','--output',directory],['--offline','--output',directory,'--model','qwen'],['--resume',directory],['--offline','--output','relative']]){
  const result=spawnSync(process.execPath,[launcher,...args],{cwd:'/',env:{},encoding:'utf8'});assert.equal(result.status,2);assert.equal(existsSync(directory),false);
 }
});
test('fresh namespace rejects existing directory/file and every symlink ancestor without changing bytes',t=>{
 const {parent,directory}=fixture(t);mkdirSync(directory);writeFileSync(join(directory,'sentinel'),'unchanged');
 assert.throws(()=>AcceptanceRunDirectory.create(directory),/new_acceptance_directory_required/);assert.equal(readFileSync(join(directory,'sentinel'),'utf8'),'unchanged');
 const file=join(parent,'file');writeFileSync(file,'unchanged');assert.throws(()=>AcceptanceRunDirectory.create(file));assert.equal(readFileSync(file,'utf8'),'unchanged');
 const link=join(parent,'link');symlinkSync(directory,link);assert.throws(()=>AcceptanceRunDirectory.create(link));assert.throws(()=>AcceptanceRunDirectory.create(join(link,'child')));
 assert.equal(existsSync(join(directory,'child')),false);
 for(const path of [join(parent,'runtime','fresh'),join(parent,'.env'),join(parent,'secrets','fresh'),parent+'//fresh',parent+'/../fresh'])assert.throws(()=>AcceptanceRunDirectory.create(path));
});
test('database reservation and writer stay attached to the owned directory after namespace replacement',t=>{
 const {parent,directory}=fixture(t),owned=AcceptanceRunDirectory.create(directory);t.after(()=>owned.close());
 const database=owned.reserveDatabase();assert.throws(()=>owned.reserveDatabase());
 const moved=join(parent,'moved');renameSync(directory,moved);mkdirSync(directory);writeFileSync(join(directory,'world.sqlite'),'unrelated');
 writeFileSync(database,'owned');assert.equal(readFileSync(join(moved,'world.sqlite'),'utf8'),'owned');assert.equal(readFileSync(join(directory,'world.sqlite'),'utf8'),'unrelated');
 const writer=new AcceptanceEvidenceWriter({directory:owned.child('evidence'),sourceFingerprint:'a'.repeat(64),worldId:'synthetic',fromMinute:480});writer.abort();
 assert.equal(existsSync(join(directory,'evidence')),false);assert.equal(readAcceptanceEvidence(owned.child('evidence')).complete,false);
});
test('guard probes reject network families and credential/save paths before any transmission or read',async t=>{
 const f=launch(t,'guard_probe');assert.equal((await f.done).code,0,f.errors());const r=read(join(f.directory,'offline-guard-probes.json'));
 assert.equal(r.environmentEmpty,true);assert.equal(r.allRejected,true);assert.equal(r.rejected.length,8);assert.equal(f.result().acceptancePassed,null);
});
test('real graceful SIGTERM seals only an interrupted segment, never a successful life acceptance',async t=>{
 const f=launch(t,'signal',{signal:true});await f.done;const r=f.result();
 assert.equal(r.process.trigger,'parent_signal');assert.equal(r.process.parentSignal,'SIGTERM');assert.equal(r.process.cleanupComplete,true);
 assert.equal(r.evidence.complete,true);assert.equal(r.evidence.reason,'signal');assert.equal(r.evidence.acceptanceControl.controlComplete,false);assert.equal(r.offlineEndpointVerified,false);
});
test('runtime event-loop blocking is externally TERM then KILL bounded and remains unsealed',async t=>{
 const f=launch(t,'sync_block',{signal:true});await f.done;const r=f.result();
 assert.equal(r.process.signals.term,'sent');assert.equal(r.process.signals.kill,'sent');assert.equal(r.process.exit.signal,'SIGKILL');assert.equal(r.process.cleanupComplete,true);
 assert.equal(r.evidence.complete,false);assert.equal(r.evidence.directEating.totals,null);assert.equal(existsSync(join(f.directory,'evidence','run-close.json')),false);
});
test('owner pipe EOF independently stops the runtime process and records the cause',async t=>{
 const f=launch(t,'signal',{closeOwner:true});await f.done;const r=f.result();assert.equal(r.process.trigger,'parent_disconnect');assert.equal(r.process.cleanupComplete,true);
 assert.equal(r.evidence.reason,'signal');assert.equal(r.acceptancePassed,null);
});
test('initialization block is governed by actual wall deadline before runtime/evidence startup',{timeout:45_000},async t=>{
 const f=launch(t,'init_block');await f.done;const r=f.result();
 assert.equal(r.process.trigger,'wall_limit');assert.equal(r.process.deadlineObserved,true);assert.equal(r.process.maxWallMs,OFFLINE_PROTOCOL.supervisor.maxWallMs);
 assert.equal(r.process.signals.term,'sent');assert.equal(r.process.exit.observed,true);assert.equal(r.process.cleanupComplete,true);
 assert.equal(r.evidence,null);assert.equal(r.recoveryIssue,'evidence_unavailable');assert.equal(existsSync(join(f.directory,'world.sqlite')),false);
});
test('crash recovery is read-only, keeps unknown totals, and rerun cannot reuse output',async t=>{
 const f=launch(t,'crash');await f.done;const r=f.result();assert.equal(r.process.exit.signal,'SIGKILL');assert.equal(r.evidence.complete,false);
 const path=join(f.directory,'evidence'),bytes=()=>readdirSync(path).sort().map(name=>[name,readFileSync(join(path,name),'base64')]);
 const before=bytes();const recovered=readAcceptanceEvidence(path);assert.deepEqual(bytes(),before);assert.equal(recovered.directEating.totals,null);assert.equal(recovered.toMinute,null);
 assert.throws(()=>AcceptanceRunDirectory.create(f.directory));assert.equal(recovered.acceptancePassed,null);
});
for(const scenario of ['writer_failure','cost_unknown','late_reply','reload_mismatch'] as const)test(`${scenario} cannot upgrade an incomplete or stopped run`,async t=>{
 const f=launch(t,scenario);await f.done;const r=f.result();assert.equal(r.offlineEndpointVerified,false);assert.equal(r.realModelExecuted,false);assert.equal(r.acceptancePassed,null);
 if(scenario==='writer_failure'){assert.equal(r.evidence.complete,false);assert.equal(r.evidence.directEating.totals,null);assert.equal(existsSync(join(f.directory,'evidence','run-close.json')),false);}
 if(scenario==='cost_unknown'){assert.equal(r.evidence.reason,'cost_unknown');assert.equal(r.evidence.acceptanceControl.confirmedCostUsd,null);}
 if(scenario==='late_reply'){assert.equal(f.worker().lateIgnored,true);assert.ok(f.worker().modelCalls>0);assert.equal(r.evidence.reason,'manual_stop');assert.equal(r.evidence.acceptanceControl.confirmedCostUsd,null);}
 if(scenario==='reload_mismatch'){assert.equal(r.evidence.complete,true);assert.equal(r.reloadVerified,false);assert.equal(r.process.outcome,'exited_nonzero');}
});
test('source fingerprint repeats and contains code/config only, including entry and guards',()=>{
 const first=sourceManifest(root),second=sourceManifest(root);assert.deepEqual(first,second);
 assert.ok(first.sourceFiles.some(file=>file.path==='scripts/run-nine-resident-acceptance.mjs'));assert.ok(first.sourceFiles.some(file=>file.path==='scripts/acceptance-offline-guard.mjs'));
 assert.ok(first.sourceFiles.every(file=>!file.path.split('/').some(p=>p==='runtime'||p.startsWith('.env')||p==='.git')));
});
test('source preflight rejects source symlinks before executing any application imports',t=>{
 const {parent}=fixture(t),source=join(parent,'source');mkdirSync(source);mkdirSync(join(source,'src'));mkdirSync(join(source,'scripts'));
 for(const name of ['package.json','package-lock.json','tsconfig.json','tsconfig.server.json'])writeFileSync(join(source,name),'{}');
 const sentinel=join(parent,'unread-secret');writeFileSync(sentinel,'must not be loaded as application code');symlinkSync(sentinel,join(source,'src','model.ts'));
 const probe=`import {assertOfflineSourceTree} from ${JSON.stringify(join(root,'scripts/acceptance-offline-preflight.mjs'))};try{assertOfflineSourceTree(${JSON.stringify(source)});process.exitCode=1}catch{console.log('rejected_before_import')}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',probe],{env:{},encoding:'utf8'});
 assert.equal(result.status,0);assert.equal(result.stdout.trim(),'rejected_before_import');assert.equal(result.stdout.includes('must not'),false);
});
