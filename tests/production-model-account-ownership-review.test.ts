import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,readdirSync,renameSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {acquireProductionModelAccountOwnership as acquire,reconcileProductionModelAccountOwnership as reconcile} from '../src/server/production-model-account-ownership.js';
function fixture(t:{after:(fn:()=>void)=>void}){const dir=mkdtempSync(join(testTmpdir(),'account-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {registryDirectory:dir,accountScope:'synthetic-review',runId:'run-1'};}
test('review: registry with group read permission is rejected',t=>{
 const o=fixture(t);chmodSync(o.registryDirectory,0o750);assert.throws(()=>acquire(o),/private_directory_required/);
});
test('review: abandoned reservation survives rejected reconciliation and a new run ID',t=>{
 const o=fixture(t);acquire(o).abandon();
 assert.throws(()=>reconcile({...o,runId:'not-owner',resolution:'provider-confirmed-completed',evidenceReference:'sha256:'+'b'.repeat(64)}),/run_mismatch/);
 assert.throws(()=>acquire({...o,runId:'run-2'}),/unresolved_run/);
});
test('review: replacing registry inode prevents clean release',t=>{
 const o=fixture(t),owner=acquire(o);t.after(()=>owner.abandon());
 const db=join(o.registryDirectory,readdirSync(o.registryDirectory).find(x=>x.endsWith('.sqlite'))!);
 const bytes=readFileSync(db);renameSync(db,db+'.retained');writeFileSync(db,bytes,{mode:0o600});
 assert.throws(()=>owner.assertOwned(),/runtime_database_changed|registry_changed/);
 assert.throws(()=>owner.closeClean(),/runtime_database_changed|registry_changed/);
});
test('review: scope protection is intentionally not global across independent registries',t=>{
 const a=fixture(t),b=fixture(t),one=acquire(a),two=acquire(b);
 try{one.assertOwned();two.assertOwned();}finally{one.abandon();two.abandon();}
});
test('review: clean completion is caller attestation, not provider evidence',t=>{
 const o=fixture(t);acquire(o).closeClean();
 const next=acquire({...o,runId:'run-2'});next.abandon();
 assert.throws(()=>acquire({...o,runId:'run-3'}),/unresolved_run/);
});
