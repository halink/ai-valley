import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.js';
const root=resolve(import.meta.dirname,'..');
const guard=join(root,'scripts/acceptance-offline-guard.mjs');
const loader=join(root,'node_modules/tsx/dist/loader.mjs');
const guardian=join(root,'scripts/acceptance-offline-guardian.mjs');
function temp(t:any){const dir=mkdtempSync(join(testTmpdir(),'valley-offline-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('independent offline: reject occupied targets, linked ancestors and reserved save components without mutation',t=>{
 const dir=temp(t),existing=join(dir,'occupied');mkdirSync(existing);writeFileSync(join(existing,'sentinel'),'unchanged');
 assert.throws(()=>AcceptanceRunDirectory.create(existing));
 const file=join(dir,'file');writeFileSync(file,'unchanged');assert.throws(()=>AcceptanceRunDirectory.create(file));
 symlinkSync(existing,join(dir,'linked'));assert.throws(()=>AcceptanceRunDirectory.create(join(dir,'linked','new')));
 assert.throws(()=>AcceptanceRunDirectory.create(join(dir,'runtime','new')));
 assert.equal(readFileSync(file,'utf8'),'unchanged');assert.equal(readFileSync(join(existing,'sentinel'),'utf8'),'unchanged');assert.equal(existsSync(join(existing,'new')),false);
});

test('independent offline: directory capability rejects leaf traversal and duplicate database reservation',t=>{
 const dir=temp(t),owned=AcceptanceRunDirectory.create(join(dir,'owned'));t.after(()=>owned.close());
 for(const leaf of ['../escape','nested/file','.env','runtime','secrets'])assert.throws(()=>owned.path(leaf));
 owned.reserveDatabase();assert.throws(()=>owned.reserveDatabase());
 owned.close();assert.throws(()=>owned.writeJson('after-close.json',{}));
});

test('independent offline: guard denies native and promise transports before resolving targets',()=>{
 const probe=`
 const fs=await import('node:fs/promises'),tls=await import('node:tls'),http2=await import('node:http2'),dns=await import('node:dns/promises');
 const checks=[()=>tls.connect({host:'example.invalid',port:443}),()=>http2.connect('https://example.invalid'),()=>dns.resolve4('example.invalid'),()=>fs.open('/synthetic-only/.env')];
 const result=[];for(const check of checks){try{await check();result.push(false)}catch(e){result.push(e.message.startsWith('offline_'))}};
 console.log(JSON.stringify(result));`;
 const result=spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',probe],{env:{},encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),[true,true,true,true]);
});

test('independent offline: public CLI refuses real run and resume switches before output creation',t=>{
 const dir=temp(t),output=join(dir,'never-created');
 for(const flag of ['--run','--resume']){
  const result=spawnSync(process.execPath,[join(root,'scripts/run-nine-resident-acceptance.mjs'),flag,'--output',output],{env:{},encoding:'utf8',timeout:10000});
  assert.equal(result.status,2);assert.equal(existsSync(output),false);
 }
});

async function runGuardian(output:string,scenario:string){
 const child=spawn(process.execPath,['--import',guard,'--import',loader,guardian,output,scenario],{env:{},cwd:'/',stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
 try{const code=await new Promise<number|null>((res,rej)=>{child.once('error',rej);child.once('exit',res);});return {code,stdout,stderr};}
 finally{clearTimeout(timer);child.stdin.destroy();}
}

test('independent offline: endpoint has separate fake-only verdict and exact persisted reload',async t=>{
 const dir=temp(t),output=join(dir,'endpoint');const run=await runGuardian(output,'endpoint');assert.equal(run.code,0,run.stdout+run.stderr);
 const result=JSON.parse(readFileSync(join(output,'offline-result.json'),'utf8'));
 const close=JSON.parse(readFileSync(join(output,'offline-worker-close.json'),'utf8'));
 assert.equal(result.offlineEndpointVerified,true);assert.equal(result.realModelExecuted,false);assert.equal(result.acceptancePassed,null);
 assert.equal(result.process.cleanupComplete,true);assert.equal(result.process.realModelExecuted,null);assert.equal(result.evidence.realModelExecuted,null);
 assert.equal(close.loadedMinute,482.5);assert.equal(close.runtimeMinute,482.5);assert.ok(close.modelCalls>0);
 assert.equal(result.reloadVerified,true);assert.equal(close.reloadVerified,true);
 assert.equal(close.loadedRevision,close.runtimeRevision);assert.equal(close.loadedWorldFingerprint,close.runtimeWorldFingerprint);
});

test('independent offline: killed worker recovery remains incomplete with no fabricated terminal state',async t=>{
 const dir=temp(t),output=join(dir,'crash');const run=await runGuardian(output,'crash');assert.equal(run.code,0,run.stdout+run.stderr);
 const result=JSON.parse(readFileSync(join(output,'offline-result.json'),'utf8'));
 assert.equal(result.offlineEndpointVerified,false);assert.equal(result.realModelExecuted,false);assert.equal(result.acceptancePassed,null);
 assert.equal(result.process.outcome,'signaled');assert.equal(result.process.cleanupComplete,true);
 assert.equal(result.evidence.complete,false);assert.equal(result.evidence.acceptanceControl.finalStatus,null);
 assert.equal(existsSync(join(output,'evidence','run-close.json')),false);
 assert.equal(existsSync(join(output,'offline-worker-close.json')),false);
});


test('independent offline: reload mismatch cannot promote sealed endpoint evidence to verified persistence',async t=>{
 const dir=temp(t),output=join(dir,'reload-mismatch');await runGuardian(output,'reload_mismatch');
 const result=JSON.parse(readFileSync(join(output,'offline-result.json'),'utf8'));
 assert.equal(result.process.outcome,'exited_nonzero');assert.equal(result.process.cleanupComplete,true);
 assert.equal(result.reloadVerified,false);assert.equal(result.workerClose.reloadVerified,false);
 assert.notEqual(result.workerClose.loadedWorldFingerprint,result.workerClose.runtimeWorldFingerprint);
 assert.equal(result.evidence.complete,true);assert.equal(result.evidence.toMinute,482.5);
 assert.equal(result.offlineEndpointVerified,false);assert.equal(result.realModelExecuted,false);assert.equal(result.acceptancePassed,null);
});
