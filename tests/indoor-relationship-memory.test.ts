import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {emitEvent} from '../src/world/events.js';
import {canSeeSocialTarget,canApproachSocialTarget,canContactSocialTarget} from '../src/world/social-observation.js';
import {canObserveBody} from '../src/world/body-observation.js';
import {roomLayout} from '../src/shared/rooms.js';
import {distance} from '../src/world/navigation.js';
import {WorldStore} from '../src/server/store.js';
import type {Resident,World} from '../src/shared/types.js';

const models=[GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const;
const interpretation='饭后的这段亲身经历让我愿意逐步相信她';
const prepare=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
function queue(w:World,r:Resident,match:(c:ActionChoice)=>boolean,fields:Record<string,unknown>={}){
 const p=prepare(w,r),c=p.choices.find(match);assert.ok(c,'actual final numbered choice must exist');assert.match(c.id,/^\d+$/);
 assert.ok(p.messages[0].content.includes(c.id+'. '+c.label));
 const d=parseChoice(JSON.stringify({choice:c.id,...fields}),p.choices);
 assert.equal(submitPlan(w,{id:`indoor-memory:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d}).ok,true);
}
function finish(w:World,r:Resident){
 let budget=2400;while(r.plan||r.activity){assert.ok(budget-->0,'the real action must finish');stepWorld(w,.25);}
 assert.equal(r.lastFailure,null);
}
function run(w:World,r:Resident,match:(c:ActionChoice)=>boolean,fields:Record<string,unknown>={}){queue(w,r,match,fields);finish(w,r);}
function experienced(){
 const w=createFrontierWorld(5401),[a,b]=w.residents;w.clock.paused=false;stepWorld(w,.25);
 const original=structuredClone(a.relations.find(r=>r.targetId===b.id)!);
 run(w,b,c=>c.action.type==='talk'&&c.action.targetId===a.id&&c.action.tone==='neutral',{text:'今晚饭后我会收好自己用过的碗。'});
 const event=[...w.events].reverse().find(e=>e.kind==='conversation'&&e.actors.includes(a.id)&&e.actors.includes(b.id))!;
 const relation=a.relations.find(r=>r.targetId===b.id)!;
 assert.deepEqual([relation.affection,relation.trust,relation.conflict],[original.affection,original.trust,original.conflict],'speech does not choose the listener\'s view');
 run(w,a,c=>c.action.type==='social'&&c.action.operation==='interpret'&&c.action.eventId===event.id&&c.action.targetId===b.id,{text:interpretation,affection:2,trust:4,conflict:1});
 assert.deepEqual([relation.affection,relation.trust,relation.conflict],[2,4,1]);assert.ok(relation.lastInterpretation);
 assert.equal(relation.lastInterpretation.at%1,.25,'a real quarter-minute engine tick is a valid interpretation time');
 return {w,a,b,relation};
}
function turnOver(w:World,a:Resident){
 for(let i=0;i<90;i++)emitEvent(w,{kind:'action',actors:[a.id],place:{...a.at},witnesses:[a.id],text:`本人整理今天的日常记录 ${i}`});
 assert.ok(!a.memories.some(m=>m.text.includes(interpretation)));
}
function indoors(busy=false){
 const f=experienced(),{w,a,b}=f;
 run(w,a,c=>c.action.type==='sleep'&&c.chooseDuration===true,{minutes:5});
 queue(w,b,c=>c.action.type==='cook');
 if(busy){let budget=400;while(!b.activity||b.inside!==a.inside||b.roomAt?.x!==8||b.roomAt?.y!==4||b.activity.path.length||b.activity.room?.path.length){assert.ok(budget-->0);stepWorld(w,.25);}assert.equal(b.activity.action.type,'cook');assert.ok(b.activity.remaining>0);}
 else finish(w,b);
 const home=w.buildings.find(p=>p.id===a.homeId)!;
 assert.equal(a.inside,home.id);assert.equal(b.inside,home.id);
 assert.deepEqual(a.roomAt,roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at);
 assert.deepEqual(b.roomAt,roomLayout(w,home).slots.find(s=>s.key==='kitchen')!.at);
 assert.equal(distance(a.roomAt!,b.roomAt!),7);turnOver(w,a);
 assert.ok(!a.memories.some(m=>m.eventId===f.relation.lastInterpretation!.sourceEventId||m.eventId===f.relation.lastInterpretation!.recordEventId));
 return f;
}

test('seed5401 numbered talk, independent interpretation, actual bed and kitchen retain personal views at seven tiles after memory eviction',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No network or model calls');});
 const {w,a,b,relation}=indoors(),c=decisionContext(w,a),before=structuredClone(w);
 assert.equal(canSeeSocialTarget(w,a,b),true);assert.equal(canApproachSocialTarget(w,a,b),true);
 assert.equal(canObserveBody(w,a,b),false);assert.equal(canContactSocialTarget(w,a,b),false);
 assert.equal(c.people.find(p=>p.id===b.id)?.talkEligible,true);assert.equal(c.people.find(p=>p.id===b.id)?.bodyObservation,undefined);
 for(const model of models){
  const p=prepareModelDecision(c,undefined,model),without=structuredClone(c);delete without.relationshipMemories;
  assert.deepEqual(p.choices.filter(c=>c.action.type==='talk'&&c.action.targetId===b.id).map(c=>c.action.type==='talk'&&c.action.tone).sort(),['friendly','hostile','neutral']);
  assert.match(p.messages[0].content,/饭后的这段亲身经历让我愿意逐步相信她/);
  assert.match(p.messages[0].content,/本人好感2，信任4，矛盾1/);assert.ok(p.messages[0].content.includes(`第${relation.lastInterpretation!.at}游戏分钟`));
  assert.deepEqual(p.choices,prepareModelDecision(without,undefined,model).choices,'personal memory changes input, not available actions');
  assert.ok(!prepareModelDecision(without,undefined,model).messages[0].content.includes(interpretation),'neither short memory nor family notes supplies the missing view');
 }
 assert.deepEqual(w,before);assert.equal(w.metrics.requests,0);assert.equal(a.plan,null);assert.equal(a.activity,null);
 const scores=[relation.affection,relation.trust,relation.conflict],peerBefore=structuredClone(b.relations);
 run(w,a,c=>c.action.type==='talk'&&c.action.targetId===b.id&&c.action.tone==='neutral',{text:'我走近后想再问一句今天的安排。'});
 assert.ok(distance(a.roomAt!,b.roomAt!)<=2);assert.equal(canContactSocialTarget(w,a,b),true);
 assert.ok(w.events.some(e=>e.kind==='conversation'&&e.speechText==='我走近后想再问一句今天的安排。'));
 assert.deepEqual([relation.affection,relation.trust,relation.conflict],scores);
 assert.deepEqual(b.relations.map(r=>[r.targetId,r.affection,r.trust,r.conflict,r.lastInterpretation]),peerBefore.map(r=>[r.targetId,r.affection,r.trust,r.conflict,r.lastInterpretation]));
});

test('actual quarter-minute interpretation keeps its exact known time in all final prompts before moving indoors',()=>{
 const {w,a,relation}=experienced(),before=structuredClone(w);
 for(const model of models){const c=decisionContext(w,a);assert.equal(c.relationshipMemories!.people.find(p=>p.targetId===relation.targetId)?.interpretation?.at,relation.lastInterpretation!.at);assert.ok(prepareModelDecision(c,undefined,model).messages[0].content.includes(`第${relation.lastInterpretation!.at}游戏分钟`));}
 assert.deepEqual(w,before);
});

test('busy cooking and waiting do not hide an awake resident\'s own remembered view or reveal distant bodily signs',()=>{
 const {w,a,b}=indoors(true);queue(w,a,c=>c.action.type==='wait'&&c.chooseDuration===true,{minutes:1});stepWorld(w,.25);
 assert.equal(a.activity?.action.type,'wait');assert.equal(b.activity?.action.type,'cook');
 const c=decisionContext(w,a),before=structuredClone(w),p=prepareModelDecision(c,undefined,GLM_MODEL);
 assert.ok(c.relationshipMemories!.people.some(r=>r.targetId===b.id));assert.match(p.messages[0].content,/饭后的这段亲身经历让我愿意逐步相信她/);
 assert.equal(c.people.find(p=>p.id===b.id)?.bodyObservation,undefined);assert.equal(canObserveBody(w,a,b),false);assert.deepEqual(w,before);
 finish(w,a);finish(w,b);
 queue(w,a,c=>c.action.type==='sleep'&&c.chooseDuration===true,{minutes:1});stepWorld(w,.25);
 assert.equal(a.activity?.action.type,'sleep');assert.equal(canSeeSocialTarget(w,a,b),false);
 assert.equal(decisionContext(w,a).relationshipMemories!.people.length,0,'sleeping does not grant a live view');
 finish(w,a);assert.ok(decisionContext(w,a).relationshipMemories!.people.some(r=>r.targetId===b.id));
});

test('same-room seven-tile personal views and fractional timestamps survive memory-only SQLite reload',()=>{
 const {w,a,b}=indoors(),expected=prepare(w,a),store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(r=>r.id===a.id)!,peer=loaded.residents.find(r=>r.id===b.id)!;
  const before=structuredClone(loaded);assert.equal(canSeeSocialTarget(loaded,actor,peer),true);assert.equal(canObserveBody(loaded,actor,peer),false);
  assert.match(prepare(loaded,actor).messages[0].content,/饭后的这段亲身经历让我愿意逐步相信她/);assert.deepEqual(prepare(loaded,actor),expected);assert.deepEqual(loaded,before);
 }finally{store.close();}
});
