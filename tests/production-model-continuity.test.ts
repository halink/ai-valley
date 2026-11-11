import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {continuityFixture,pause,reconcileContinuity} from './helpers/production-continuity-fixture.js';
import {SYNTHETIC_NINE_IDS} from '../src/server/production-model-process-rehearsal.js';

test('real-wall nine-person runtime crosses three price epochs, then retains all budgets after a fourth-launch response crash',{timeout:150000},async t=>{
 const f=continuityFixture(t);let previous:ReturnType<typeof f.read>|undefined;
 for(let epoch=1;epoch<=3;epoch++){
  if(epoch===2){const old=previous!.receipts[0] as any;await pause(Math.max(0,old.deadlineAtMs+50-Date.now()));}
  const result=await f.launch('sustained',epoch===1?'new':'resume');assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.signal,null);
  const data=f.read(),summary=reconcileContinuity(data);assert.equal(summary.finished,epoch);assert.equal(summary.reservedWallMs,epoch*30000);
  const now=data.rehearsals.at(-1)!,receipt=data.receipts.at(-1) as any;
  assert.equal(now.after.residents.length,9);assert.ok(now.requests.length>=9);assert.ok(now.after.minute>now.before.minute);
  assert.ok(now.finishedAtMs>=receipt.deadlineAtMs-6000,'natural launch-anchored admission cutoff, never fresh runtime time');
  assert.ok(now.after.minute-now.before.minute<=36,'normal 20-minute/day clock cannot jump ahead');
  for(const row of now.ticks)assert.ok(row.atMs>=now.startedAtMs&&row.atMs<=now.finishedAtMs);
  if(previous){assert.deepEqual(now.before,previous.world);assert.deepEqual(data.manifest,previous.manifest);
   assert.ok(summary.modelAttempts>reconcileContinuity(previous).modelAttempts);}
  if(epoch===2)assert.ok(receipt.startedAtMs>(data.receipts[0] as any).deadlineAtMs,'actual expired old synthetic price before renewal');
  previous=data;
 }
 const clean=previous!,cleanSummary=reconcileContinuity(clean);
 assert.equal(cleanSummary.epochs,3);assert.equal(cleanSummary.segments,3);assert.equal(cleanSummary.reservedWallMs,90000);
 for(const actor of SYNTHETIC_NINE_IDS)assert.ok(clean.rehearsals.flatMap(r=>r.requests).filter(r=>r.actorId===actor).length>=2,`repeat decisions for ${actor}`);
 assert.ok(clean.world.minute-clean.rehearsals[0].before.minute>=30);
 writeFileSync(join(f.path,'..','reconciliation-clean.json'),JSON.stringify({runPath:f.path,summary:cleanSummary,originalContract:clean.manifest.contract},null,2),{mode:0o600});

 // Corrupt detached copies only: neither these checks nor observations may rewrite the real fixture to manufacture success.
 await t.test('independent reconciliation rejects each altered transcript, report, price chain and audit row',()=>{
  const variants:Array<(d:typeof clean)=>void>=[
   d=>{d.rehearsals[0].requests[0].requestBody+=' ';},
   d=>{d.rehearsals[0].requests[0].responseHash='0'.repeat(64);},
   d=>{d.rehearsals[0].requests[0].actorId='founder-9-9';},
   d=>{d.reports[0].reservedWallMs=0;},
   d=>{d.receipts[1]=(structuredClone(d.receipts[0]));},
   d=>{d.session[1].body+=' ';},
   d=>{d.model.splice(d.model.findIndex(r=>JSON.parse(r.body).type==='response'),1);},
   d=>{d.world.minute=480;},
  ];
  for(const alter of variants){const changed=structuredClone(clean);alter(changed);assert.throws(()=>reconcileContinuity(changed));}
 });

 const failed=await f.launch('sustained_crash_response','resume');assert.equal(failed.code,1);assert.equal(failed.signal,null);
 assert.ok(failed.messages.some(m=>m.type==='synthetic_fault_ready'&&m.point==='sustained_response'));
 const crashed=f.read(),after=reconcileContinuity(crashed,false);
 assert.equal(after.launches,4);assert.equal(after.finished,3);assert.equal(after.reservedWallMs,120000);
 assert.equal(after.modelAttempts,cleanSummary.modelAttempts+10);assert.equal(after.sessionAttempts,after.modelAttempts);
 assert.equal(after.modelCompleted,cleanSummary.modelCompleted+9);assert.equal(after.sessionCompleted,after.modelCompleted);
 assert.equal(after.modelPending?.id,after.modelAttempts);assert.equal(after.sessionPending?.id,after.modelAttempts);
 assert.ok(after.modelPending?.responseHash);assert.equal(after.sessionPending?.responseHash,null);
 assert.deepEqual(crashed.manifest,clean.manifest);assert.deepEqual(crashed.reports,clean.reports);
 assert.ok(crashed.world.minute>clean.world.minute);
 const retry=await f.launch('sustained','resume');assert.equal(retry.code,1);
 assert.equal(retry.messages.some(m=>m.type==='synthetic_launch_reserved'||m.type==='synthetic_watchdog_started'),false);
 const final=f.read(),finalSummary=reconcileContinuity(final,false);assert.deepEqual(finalSummary,after);
 const blocked=retry.messages.find(m=>m.type==='synthetic_process_blocked')?.status;
 assert.equal(blocked.launches,4);assert.equal(blocked.finished,3);assert.equal(blocked.reservedWallMs,120000);assert.ok(blocked.failure);
 writeFileSync(join(f.path,'..','reconciliation-failed.json'),JSON.stringify({runPath:f.path,summary:finalSummary,blocked},null,2),{mode:0o600});
 t.diagnostic(JSON.stringify({evidence:f.path,clean:cleanSummary,failed:finalSummary}));
});
