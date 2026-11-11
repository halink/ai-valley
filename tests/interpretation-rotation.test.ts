import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,modelLimits} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';
import type {Resident,World} from '../src/shared/types.js';
import {socialOpportunities,socialReason,completeSocial} from '../src/world/social-life.js';
import {interpretationEvidenceNote} from '../src/server/dialogue-evidence.js';
import {emitEvent} from '../src/world/events.js';
import {quoteDialogue} from '../src/shared/dialogue-evidence.js';

const models=[GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const;
const prepare=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
const interpretations=(rows:ActionChoice[])=>rows.filter(c=>c.action.type==='social'&&c.action.operation==='interpret');
function seed(){const w=createFrontierWorld(5401);w.clock.paused=false;stepWorld(w,1);return w;}
let serial=0;
function submit(w:World,r:Resident,p:ReturnType<typeof prepare>,row:ActionChoice,fields:Record<string,unknown>={}){
 assert.match(row.id,/^\d+$/);assert.ok(p.messages[0].content.includes(row.id+'. '+row.label));
 const decision=parseChoice(JSON.stringify({choice:row.id,...fields}),p.choices);
 return submitPlan(w,{id:'interpretation-rotation:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision});
}
function finish(w:World,r:Resident){let n=200;while(r.plan||r.activity){assert.ok(n--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function choose(w:World,r:Resident,match:(c:ActionChoice)=>boolean,fields:Record<string,unknown>={}){const p=prepare(w,r),row=p.choices.find(match);assert.ok(row,'actual final numbered choice exists');assert.equal(submit(w,r,p,row,fields).ok,true);finish(w,r);}
function say(w:World,text:string,tone:'neutral'|'friendly'|'hostile'='neutral'){const [r,listener]=w.residents;choose(w,r,c=>c.action.type==='talk'&&c.action.targetId===listener.id&&c.action.tone===tone,{text});return [...w.events].reverse().find(e=>e.kind==='conversation'&&e.actors[0]===r.id)!;}
function hear(w:World,count:number){const [speaker,listener]=w.residents;return Array.from({length:count},(_,i)=>emitEvent(w,{kind:'conversation',actors:[speaker.id,listener.id],place:{...speaker.at},text:`实际听见第${i}句`,speechText:`实际听见第${i}句的独立结尾`,speechTone:'neutral'}));}

test('formal seed5401 six real numbered speeches during wait30: retained first line returns, interprets once and reloads',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('offline only');});
 const w=seed(),[speaker,listener]=w.residents,p=prepare(w,listener),wait=p.choices.find(c=>c.action.type==='wait')!;
 const before=structuredClone(listener.relations);assert.equal(submit(w,listener,p,wait,{minutes:30}).ok,true);stepWorld(w,1);
 const events=[];for(let i=0;i<6;i++){assert.ok(listener.plan||listener.activity,'listener still executing wait');events.push(say(w,'背景'.repeat(110)+`第${i}句：我不答应。`,i%2?'hostile':'friendly'));}
 finish(w,listener);const first=events[0];assert.ok(listener.memories.some(m=>m.eventId===first.id));assert.ok(!listener.memories.slice(-5).some(m=>m.eventId===first.id));
 for(const relation of listener.relations){const old=before.find(r=>r.targetId===relation.targetId)!;assert.deepEqual([relation.affection,relation.trust,relation.conflict],[old.affection,old.trust,old.conflict]);}
 const seen=new Set<string>();let available=false;
 for(let i=0;i<12;i++){
  const context=decisionContext(w,listener),snapshot=structuredClone(w);
  for(const model of models){const current=prepareModelDecision(context,undefined,model);for(const row of interpretations(current.choices))if(row.action.type==='social'){
   const eventId=row.action.eventId!;seen.add(eventId);const event=events.find(e=>e.id===eventId);if(event)assert.ok(current.messages[0].content.includes(quoteDialogue(event.speechText!)));
   if(row.action.eventId===first.id)available=true;
  }assert.ok(current.inputBytes<=modelLimits[model].inputBytes);}
  assert.deepEqual(w,snapshot);if(available)break;
  choose(w,listener,c=>c.action.type==='wait',{minutes:30});
 }
 assert.ok(available,'first retained utterance must become an actual final interpretation choice');
 choose(w,listener,c=>c.action.type==='social'&&c.action.operation==='interpret'&&c.action.eventId===first.id&&c.action.targetId===speaker.id,{text:'我听见末尾明确拒绝，不替对方同意',affection:1,trust:-2,conflict:1});
 const relation=listener.relations.find(r=>r.targetId===speaker.id)!;assert.equal(relation.lastInterpretation!.sourceEventId,first.id);assert.equal(w.social!.totals.interpretations,1);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!,r=loaded.residents.find(p=>p.id===listener.id)!;
  assert.equal(r.relations.find(q=>q.targetId===speaker.id)!.lastInterpretation!.sourceEventId,first.id);
  assert.ok(socialReason(loaded,r,{type:'social',operation:'interpret',eventId:first.id,targetId:speaker.id,text:'重复',affection:1,trust:1,conflict:1}));
  for(let i=0;i<12;i++){loaded.minute+=30;assert.ok(!interpretations(prepare(loaded,r).choices).some(c=>c.action.type==='social'&&c.action.eventId===first.id&&c.action.targetId===speaker.id));}
 }finally{store.close();}
 assert.equal(w.metrics.requests,0);
});

test('all 80 retained records rotate with full evidence beyond the old 18-record prompt window, with no age TTL',()=>{
 const w=seed(),listener=w.residents[1];listener.memories=[];const events=hear(w,80),seen=new Set<string>();
 w.minute+=100_000;const start=w.minute;
 for(let i=0;i<80;i++){
  w.minute=start+30*i;const before=structuredClone(w),context=decisionContext(w,listener),p=prepareModelDecision(context,undefined,GLM_MODEL),rows=interpretations(p.choices);
  assert.ok(rows.length<=10);assert.ok(new Set(rows.map(c=>c.action.type==='social'&&c.action.eventId)).size<=5);
  for(const row of rows)if(row.action.type==='social'){
   const id=row.action.eventId!,event=events.find(e=>e.id===id)!;seen.add(id);assert.ok(p.messages[0].content.includes(quoteDialogue(event.speechText!)));
  }
  assert.deepEqual(w,before);
 }
 assert.deepEqual(seen,new Set(events.map(e=>e.id)));
 assert.equal(listener.memories.length,80);assert.equal(w.social!.totals.interpretations,0);
});

test('81st actual delivery forgets the first; stale numbered interpretation cannot execute or revive archived text',()=>{
 const w=seed(),[speaker,listener]=w.residents;listener.memories=[];const events=hear(w,80),first=events[0];
 let p=prepare(w,listener),row=interpretations(p.choices).find(c=>c.action.type==='social'&&c.action.eventId===first.id);
 for(let i=0;!row&&i<80;i++){w.minute+=30;p=prepare(w,listener);row=interpretations(p.choices).find(c=>c.action.type==='social'&&c.action.eventId===first.id);}
 assert.ok(row);assert.ok(listener.memories.some(m=>m.eventId===first.id));
 emitEvent(w,{kind:'action',actors:[listener.id],place:{...listener.at},text:'第81条亲身经历'});
 assert.ok(!listener.memories.some(m=>m.eventId===first.id));const before=structuredClone(listener.relations),count=w.social!.totals.interpretations;
 const result=submit(w,listener,p,row,{text:'不应形成此看法',affection:5,trust:5,conflict:5});
 if(result.ok){let n=20;while(listener.plan||listener.activity){assert.ok(n--);stepWorld(w,1);}assert.ok(listener.lastFailure);}
 assert.deepEqual(listener.relations,before);assert.equal(w.social!.totals.interpretations,count);
 assert.ok(!decisionContext(w,listener).memories.some(m=>m.eventId===first.id));
 for(let i=0;i<80;i++){w.minute+=30;assert.ok(!socialOpportunities(w,listener).some(c=>c.action.type==='social'&&c.action.eventId===first.id));}
 assert.equal(listener.relations.find(r=>r.targetId===speaker.id)!.lastInterpretation,undefined);
});

test('retained duplicate delivery uses one whole latest own record, never splices global or older tone and words',()=>{
 const w=seed(),[speaker,listener]=w.residents;listener.memories=[];const event=hear(w,1)[0],memory=listener.memories[0];
 event.actors.push(speaker.id,speaker.id);listener.memories.push({...memory,text:'旧档重复传来的节录',speechText:undefined,speechTone:undefined});
 const before=structuredClone(w),c=decisionContext(w,listener),p=prepareModelDecision(c,undefined,GLM_MODEL),rows=interpretations(p.choices);
 assert.equal(rows.length,1);assert.equal(c.memories.length,1);assert.match(interpretationEvidenceNote(c,p.choices),/原话完整记录未知|发言语气未记录/);assert.ok(!p.messages[0].content.includes(event.speechText!));
 assert.deepEqual(w,before);assert.equal(completeSocial(w,listener,{type:'social',operation:'interpret',eventId:event.id,targetId:speaker.id,text:'我只依据自己保留的节录',affection:0,trust:0,conflict:0}),null);
 assert.equal(interpretations(prepare(w,listener).choices).length,0);
});

test('a prepared old-memory menu remains immutable after new arrivals, but stale lost ability or target cannot authorize execution',()=>{
 for(const change of ['canDecide','canExpress','targetMissing','forget','receipt'] as const){
  const w=seed(),[speaker,listener]=w.residents;listener.memories=[];const event=hear(w,1)[0],context=decisionContext(w,listener),p=prepareModelDecision(context,undefined,GLM_MODEL),row=interpretations(p.choices)[0];assert.ok(row);
  if(change==='canDecide'||change==='canExpress')listener[change]=false;
  else if(change==='targetMissing')w.residents=w.residents.filter(r=>r.id!==speaker.id);
  else if(change==='forget')listener.memories=[];
  else w.processed.push(`interpret:${listener.id}:${event.id}:${speaker.id}`);
  const before=structuredClone(listener.relations),count=w.social!.totals.interpretations;const result=submit(w,listener,p,row,{text:'不应执行',affection:1,trust:1,conflict:1});
  if(result.ok){let n=20;while(listener.plan||listener.activity){assert.ok(n--);stepWorld(w,1);}assert.ok(listener.lastFailure);}
  assert.deepEqual(listener.relations,before);assert.equal(w.social!.totals.interpretations,count);
  assert.deepEqual(prepareModelDecision(context,undefined,GLM_MODEL),p);
 }
});

test('future delivery time or future event time cannot become present interpretation knowledge',()=>{
 for(const future of ['delivery','event'] as const){
  const w=seed(),[speaker,listener]=w.residents;listener.memories=[];const event=hear(w,1)[0];
  if(future==='delivery')listener.memories[0].receivedAt=w.minute+10;else event.at=w.minute+10;
  assert.equal(interpretations(prepare(w,listener).choices).length,0);assert.ok(socialReason(w,listener,{type:'social',operation:'interpret',eventId:event.id,targetId:speaker.id,text:'还未发生',affection:0,trust:0,conflict:0}));
  w.minute+=10;assert.equal(interpretations(prepare(w,listener).choices).length,1);
 }
});

test('restriction-only menus cannot restore interpretation opportunities even when remembered speech remains',()=>{
 const w=seed(),listener=w.residents[1];listener.memories=[];hear(w,6);
 for(const flag of ['aboard','passenger','familyTravelling','careWithdrawalOnly','expressiveEvacuationOnly'] as const){const c=decisionContext(w,listener);c.formal![flag]=true;assert.equal(interpretations(prepareModelDecision(c,undefined,GLM_MODEL).choices).length,0,flag);}
});
