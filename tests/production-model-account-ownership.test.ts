import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {acquireProductionModelAccountOwnership as acquire,reconcileProductionModelAccountOwnership as reconcile} from '../src/server/production-model-account-ownership.js';
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const moduleUrl=new URL('../src/server/production-model-account-ownership.ts',import.meta.url).href;
function fixture(t:{after:(fn:()=>void)=>void}){const dir=mkdtempSync(join(testTmpdir(),'model-account-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {registryDirectory:dir,accountScope:'synthetic-account',runId:'run-one'};}
function child(options:ReturnType<typeof fixture>,mode:'clean'|'crash'='clean'){
 return spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',`import {acquireProductionModelAccountOwnership as acquire} from ${JSON.stringify(moduleUrl)};
 const owner=acquire(${JSON.stringify(options)}); ${mode==='clean'?'owner.closeClean();':"process.kill(process.pid,'SIGKILL');"}`],{encoding:'utf8',timeout:10000});
}
test('account registry excludes second process and distinct run IDs until clean close',t=>{
 const o=fixture(t),owner=acquire(o);t.after(()=>owner.abandon());owner.assertOwned();
 assert.throws(()=>acquire({...o,runId:'second-world'}),/runtime_already_owned/);
 const result=child({...o,runId:'second-world'});assert.equal(result.status,1);assert.match(result.stderr,/runtime_already_owned/);
 owner.closeClean();assert.throws(()=>owner.assertOwned(),/closed/);
 assert.equal(child({...o,runId:'second-world'}).status,0);
 assert.throws(()=>acquire(o),/UNIQUE constraint/);
});
test('SIGKILL leaves durable unknown reservation and no automatic restart or retry',t=>{
 const o=fixture(t);assert.equal(child(o,'crash').signal,'SIGKILL');
 const restarted=child({...o,runId:'after-crash'});assert.equal(restarted.status,1);assert.match(restarted.stderr,/model_account_unresolved_run/);
 assert.throws(()=>acquire(o),/model_account_unresolved_run/);
});
test('abandon needs explicit matching disposition, never consumes or retries old run',t=>{
 const o=fixture(t),owner=acquire(o);owner.abandon();owner.abandon();
 assert.throws(()=>acquire({...o,runId:'next'}),/unresolved/);
 const proof={resolution:'provider-confirmed-not-executed' as const,evidenceReference:'sha256:'+'a'.repeat(64)};
 assert.throws(()=>reconcile({...o,...proof,runId:'wrong'}),/run_mismatch/);
 assert.throws(()=>reconcile({...o,...proof,evidenceReference:'untrusted arbitrary plaintext'}),/reconciliation_invalid/);
 reconcile({...o,...proof});assert.throws(()=>acquire(o),/UNIQUE constraint/);
 const next=acquire({...o,runId:'next'});next.closeClean();
});
test('reconciliation cannot bypass live ownership and unrelated accounts have separate gates',t=>{
 const o=fixture(t),owner=acquire(o);t.after(()=>owner.abandon());
 assert.throws(()=>reconcile({...o,resolution:'provider-confirmed-completed',evidenceReference:'sha256:'+'b'.repeat(64)}),/runtime_already_owned/);
 const other=acquire({...o,accountScope:'another-account'});other.closeClean();
});
test('noncanonical paths and symlink ancestor are refused',t=>{
 const o=fixture(t);assert.throws(()=>acquire({...o,registryDirectory:o.registryDirectory+'/../elsewhere'}),/scope_invalid/);
 const real=join(o.registryDirectory,'real'),alias=join(o.registryDirectory,'alias');mkdirSync(real);symlinkSync(real,alias);
 assert.throws(()=>acquire({...o,registryDirectory:alias}));
 assert.throws(()=>acquire({...o,accountScope:'../../key'}),/scope_invalid/);
});
