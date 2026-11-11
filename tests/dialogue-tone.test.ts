import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {createWorld} from '../src/world/seed.js';
import {emitEvent} from '../src/world/events.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,Resident,World} from '../src/shared/types.js';

const tones=['neutral','friendly','hostile'] as const;
const models=[GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const;
function seed(){const w=createFrontierWorld(5401);w.clock.paused=false;stepWorld(w,1);assert.equal(w.minute,481);return w;}
function select(w:World,r:Resident,tone:typeof tones[number],text:string){
 const p=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),row=p.choices.find(c=>c.action.type==='talk'&&c.action.targetId===w.residents[1].id&&c.action.tone===tone);assert.ok(row);
 assert.match(row.id,/^\d+$/);assert.ok(p.messages[0].content.includes(row.id+'. '+row.label));
 const decision=parseChoice(JSON.stringify({choice:row.id,text}),p.choices);
 assert.equal((decision.actions[0] as Extract<Action,{type:'talk'}>).tone,tone);return decision;
}
function run(w:World,r:Resident,decision:ReturnType<typeof parseChoice>){
 const result=submitPlan(w,{id:'dialogue-tone',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision});
 if(result.ok){let n=300;while(r.plan||r.activity){assert.ok(n--);stepWorld(w,1);}}return result;
}
const scores=(w:World)=>w.residents.map(r=>r.relations.map(({targetId,affection,trust,conflict,lastInterpretation})=>({targetId,affection,trust,conflict,lastInterpretation})));
function fixture(){
 const w=createWorld(5401),sample=w.residents[0];w.clock.paused=false;w.minute=600;
 w.map={width:40,height:40,tiles:Array(1600).fill('grass'),entrance:{x:0,y:0},name:'Synthetic speech observation'};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.events=[];
 w.residents=Array.from({length:10},(_,i):Resident=>({...structuredClone(sample),id:'speech-person-'+i,name:'听众'+i,at:{x:10,y:10},inside:null,roomAt:null,homeId:null,bornAt:-30*365*1440,inventory:{meal:5,water:5},hunger:10,health:100,energy:100,plan:null,activity:null,relations:[],memories:[],knownPeople:[],knownBuildings:[],knownResources:[]}));
 for(const r of w.residents)r.knownPeople=w.residents.filter(p=>p.id!==r.id).map(p=>p.id);return w;
}

test('formal seed481 same words: final numbered tone survives actual speech, recipient decisions and SQLite',()=>{
 const original=seed(),outputs=[];
 for(const tone of tones){
  const w=structuredClone(original),r=w.residents[0],peer=w.residents[1],before=scores(w),decision=select(w,r,tone,'我知道了。');
  assert.equal(run(w,r,decision).ok,true);assert.equal(r.lastFailure,null);assert.equal(w.minute,484);
  const event=w.events.find(e=>e.kind==='conversation'&&e.actors[0]===r.id)!;assert.ok(event);assert.equal(event.text,r.name+'：我知道了。');
  const own=r.memories.find(m=>m.eventId===event.id)!,heard=peer.memories.find(m=>m.eventId===event.id)!;assert.ok(own);assert.ok(heard);
  assert.equal(event.speechTone,tone);assert.equal(heard.speechTone,tone);assert.equal(own.speechTone,tone);
  assert.equal(event.speechText,'我知道了。');assert.equal(heard.speechText,'我知道了。');assert.equal(own.speechText,'我知道了。');
  assert.deepEqual(scores(w),before);assert.equal(w.metrics.requests,0);
  const prompts=models.map(model=>prepareModelDecision(decisionContext(w,peer),undefined,model).messages);
  const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!,other=loaded.residents.find(p=>p.id===peer.id)!;
   assert.deepEqual(loaded.events.find(e=>e.id===event.id),event);assert.deepEqual(other.memories.find(m=>m.eventId===event.id),heard);
   assert.deepEqual(models.map(model=>prepareModelDecision(decisionContext(loaded,other),undefined,model).messages),prompts);
  }finally{store.close();}
  outputs.push({event,heard,prompts});
 }
 for(const key of ['event','heard','prompts'] as const)assert.equal(new Set(outputs.map(o=>JSON.stringify(o[key]))).size,3,key+' keeps the chosen tone distinct');
 for(const key of ['event','heard'] as const){const withoutTone:unknown[]=outputs.map(o=>{const {speechTone,...rest}=o[key];return rest;});assert.deepEqual(withoutTone[1],withoutTone[0]);assert.deepEqual(withoutTone[2],withoutTone[0]);}
 assert.deepEqual(original,seed(),'source seed is unchanged');
});

test('actual speech copies tone to exactly the existing awake in-range witnesses, including speaker and bystanders',()=>{
 const w=fixture(),[r,peer,near,edge,far,otherRoom,outside,dead,unaware]=w.residents;
 near.at={x:12,y:10};edge.at={x:16,y:10};far.at={x:17,y:10};otherRoom.inside='different-room';outside.residency='outside';dead.status='dead';unaware.canDecide=false;
 const before=scores(w),decision=select(w,r,'hostile','这是我的原话。');assert.equal(run(w,r,decision).ok,true);
 const e=w.events.find(e=>e.kind==='conversation')!;assert.ok(e);
 assert.ok(e.witnesses.includes(r.id));assert.ok(e.witnesses.includes(peer.id));assert.ok(e.witnesses.includes(near.id));assert.ok(e.witnesses.includes(edge.id));
 for(const p of [far,otherRoom,outside,dead,unaware])assert.ok(!e.witnesses.includes(p.id),p.id);
 for(const p of w.residents){const m=p.memories.find(m=>m.eventId===e.id);assert.equal(!!m,e.witnesses.includes(p.id));if(m){assert.equal(m.speechTone,'hostile');assert.equal(m.speechText,'这是我的原话。');}}
 assert.deepEqual(scores(w).map(rows=>rows.filter(row=>before.flat().some(old=>old.targetId===row.targetId))),before);
 for(const p of [r,peer])assert.ok(p.relations.every(t=>t.affection===0&&t.trust===0&&t.conflict===0&&!t.lastInterpretation));
 assert.equal(near.relations.length,0,'hearing creates no bystander relationship judgment');assert.equal(w.metrics.requests,0);
});

test('selection, submission, late arrivals and failed completion cannot manufacture speech evidence',()=>{
 for(const loss of ['express','decide','differentRoom','far','dead','outside'] as const){
  const w=fixture(),r=w.residents[0],peer=w.residents[1],decision=select(w,r,'friendly','本句不能完成。');
  assert.ok(!w.events.some(e=>e.kind==='conversation'));assert.ok(w.residents.every(p=>!p.memories.some(m=>m.speechTone)));
  assert.equal(submitPlan(w,{id:'late-speech',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision}).ok,true);
  stepWorld(w,1);assert.ok(!w.events.some(e=>e.kind==='conversation'),'not completed at submission');
  if(loss==='express')r.canExpress=false;else if(loss==='decide')r.canDecide=false;else if(loss==='differentRoom')peer.inside='different-room';else if(loss==='far')peer.at={x:35,y:35};else if(loss==='dead')peer.status='dead';else peer.residency='outside';
  stepWorld(w,5);assert.ok(!w.events.some(e=>e.kind==='conversation'),loss);assert.ok(w.residents.every(p=>!p.memories.some(m=>m.speechTone)),loss);
 }
 const w=fixture(),r=w.residents[0],decision=select(w,r,'neutral','迟到的计划。'),revision=r.revision;r.revision++;
 assert.equal(submitPlan(w,{id:'stale-speech',actorId:r.id,actorRevision:revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision}).ok,false);
 assert.ok(!w.events.some(e=>e.kind==='conversation'));
});

test('arriving after speech or remembering only the event ID does not grant tone, before or after SQLite',()=>{
 const w=fixture(),r=w.residents[0],late=w.residents[2];late.at={x:30,y:30};assert.equal(run(w,r,select(w,r,'friendly','当时说的话。')).ok,true);
 const e=w.events.find(e=>e.kind==='conversation')!;late.at={...r.at};assert.ok(!e.witnesses.includes(late.id));
 late.relations.push({targetId:r.id,affection:0,trust:0,conflict:0,evidence:[e.id]});
 const before=structuredClone(late.memories);for(const model of models){const c=decisionContext(w,late);assert.ok(!c.memories.some(m=>m.eventId===e.id));assert.ok(!prepareModelDecision(c,undefined,model).messages[0].content.includes('实际发言语气：friendly'));}assert.deepEqual(late.memories,before);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!,p=loaded.residents.find(p=>p.id===late.id)!;assert.ok(!p.memories.some(m=>m.eventId===e.id));assert.ok(!prepareModelDecision(decisionContext(loaded,p),undefined,GLM_MODEL).messages[0].content.includes('实际发言语气：friendly'));}finally{store.close();}
});

test('legacy records and legacy pending talk without tone stay unknown and are never inferred from words',()=>{
 const w=fixture(),r=w.residents[0],peer=w.residents[1],d=select(w,r,'neutral','我用hostile语气？这只是原话。');delete (d.actions[0] as Partial<Extract<Action,{type:'talk'}>>).tone;
 assert.equal(run(w,r,d).ok,true);const e=w.events.find(e=>e.kind==='conversation')!;assert.equal(e.speechTone,undefined);assert.equal(peer.memories.find(m=>m.eventId===e.id)!.speechTone,undefined);
 delete e.speechText;for(const p of w.residents)for(const m of p.memories)if(m.eventId===e.id)delete m.speechText;
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!,p=loaded.residents.find(p=>p.id===peer.id)!;assert.equal(loaded.events.find(v=>v.id===e.id)!.speechTone,undefined);assert.ok(!Object.hasOwn(p.memories.find(m=>m.eventId===e.id)!,'speechTone'));for(const model of models)assert.ok(!prepareModelDecision(decisionContext(loaded,p),undefined,model).messages[0].content.includes('实际发言语气：neutral'));}finally{store.close();}
});

test('normal 80-memory retention never backfills an evicted tone from global events or relation evidence',()=>{
 const w=fixture(),r=w.residents[0],peer=w.residents[1];assert.equal(run(w,r,select(w,r,'hostile','可以遗忘的发言。')).ok,true);const e=w.events.find(e=>e.kind==='conversation')!;
 for(let i=0;i<81;i++)emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},text:'后来在场观察 '+i});
 assert.equal(peer.memories.length,80);assert.ok(!peer.memories.some(m=>m.eventId===e.id));assert.ok(w.events.includes(e));assert.ok(peer.relations.find(t=>t.targetId===r.id)!.evidence.includes(e.id));
 for(const model of models)assert.ok(!prepareModelDecision(decisionContext(w,peer),undefined,model).messages[0].content.includes('实际发言语气：hostile'));
});

test('tone remains in short model memory when chosen words fill the whole 240-character allowance',()=>{
 for(const tone of tones){const w=seed(),r=w.residents[0],peer=w.residents[1];assert.equal(run(w,r,select(w,r,tone,'甲'.repeat(240))).ok,true);
  for(const model of models){const content=prepareModelDecision(decisionContext(w,peer),undefined,model).messages[0].content;assert.ok(content.includes('实际发言语气：'+tone),model+' '+tone);}
 }
});
