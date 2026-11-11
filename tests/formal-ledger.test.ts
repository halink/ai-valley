import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {Plan,World,WorldEvent} from '../src/shared/types.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {submitPlan} from '../src/world/engine.js';

function withDatabase(action:(path:string)=>void) {
 const dir=mkdtempSync(join(testTmpdir(),'valley-ledger-'));
 try{action(join(dir,'world.sqlite'));}finally{rmSync(dir,{recursive:true,force:true});}
}
function checkpoint(db:DatabaseSync) {
 const row=db.prepare('SELECT state FROM worlds').get() as {state:Uint8Array};
 return JSON.parse(gunzipSync(row.state).toString());
}
function fact(world:World,id:string,at:number,kind:WorldEvent['kind']='action'):WorldEvent {
 return {id,at,kind,place:world.residents[0].at,actors:[world.residents[1].id,world.residents[0].id],witnesses:[world.residents[0].id],text:id};
}

test('old formal checkpoints migrate once, preserve idempotency, witnesses, conversation continuity and public history',()=>withDatabase(file=>{
 const world=createFormalWorld();
 world.minute=4000;
 const old=fact(world,'past',1200);
 const death=fact(world,'witnessed-death',1300,'death');
 const conversation=fact(world,'recent-before-observer-window',world.minute-40,'conversation');
 world.residents[0].memories.push({eventId:death.id,receivedAt:death.at,source:'witness',text:'曾亲眼见证'});
 world.events.push(old,death,conversation,...Array.from({length:225},(_,i)=>fact(world,'new-'+i,world.minute-25+i/10)));
 world.processed.push('plan:accepted-long-ago','migration:durable-marker');
 let store=new WorldStore(file);
 store.commit(world,null);
 store.close();
 const sql=new DatabaseSync(file);
 const state=checkpoint(sql);
 delete state.ledgerVersion;state.events=world.events;state.processed=world.processed;
 sql.prepare('UPDATE worlds SET state=?').run(gzipSync(JSON.stringify(state)));
 sql.exec('DELETE FROM receipts');
 sql.close();
 store=new WorldStore(file);
 const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 assert.ok(runtime.world.events.some(e=>e.id===death.id));
 assert.ok(runtime.world.events.some(e=>e.id===conversation.id));
 assert.ok(!runtime.world.events.some(e=>e.id===old.id));
 assert.deepEqual(runtime.snapshot().world.events.map(e=>e.id),world.events.slice(-180).map(e=>e.id));
 assert.ok(store.history(world.id,old.at+1).some(e=>e.id===old.id));
 store.close();
 const migrated=new DatabaseSync(file);
 const saved=checkpoint(migrated);
 assert.equal(saved.ledgerVersion,1);
 assert.equal(saved.events,undefined);assert.equal(saved.processed,undefined);
 migrated.close();
 store=new WorldStore(file);
 const restarted=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 const full=store.load()!;
 assert.deepEqual(full.events,world.events);
 assert.deepEqual(full.processed,world.processed);
 assert.ok(restarted.world.events.some(e=>e.id===death.id));
 assert.ok(restarted.world.events.some(e=>e.id===conversation.id));
 const plan:Plan={id:'accepted-long-ago',actorId:world.residents[0].id,actorRevision:-1,createdAt:12,definition:'action/routine@1',intention:'test',actions:[{type:'wait',minutes:5}]};
 assert.deepEqual(submitPlan(restarted.world,plan),{ok:true});
 assert.equal(restarted.world.residents[0].plan,null);
 store.close();
}));

test('aborted formal checkpoint rolls back appended history and receipts before a safe retry',()=>withDatabase(file=>{
 const store=new WorldStore(file),world=createFormalWorld(),sql=new DatabaseSync(file);
 store.commit(world,null);
 const previous=world.revision++;
 const fresh=fact(world,'test-atomic-append',world.minute+5);
 const appended={events:[fresh],processed:['plan:transaction']};
 world.events.push(fresh);world.processed.push(...appended.processed);
 sql.exec("CREATE TRIGGER fail_state BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT,'interrupted_commit'); END");
 assert.throws(()=>store.commit(world,previous,appended),/interrupted_commit/);
 assert.equal(store.load()!.revision,previous);
 assert.equal(store.history(world.id,Infinity).some(e=>e.id===fresh.id),false);
 assert.equal(store.load()!.processed.includes('plan:transaction'),false);
 sql.exec('DROP TRIGGER fail_state');
 store.commit(world,previous,appended);
 assert.deepEqual(store.load()!.events.at(-1),fresh);
 assert.deepEqual(store.load()!.processed,['plan:transaction']);
 world.revision++;world.events.at(-1)!.text='rewritten';
 assert.throws(()=>store.commit(world,previous+1),/event_id_conflict/);
 sql.close();store.close();
}));
