import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Plan,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {productiveCrops,initializeProduction} from '../src/world/production.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {emitEvent} from '../src/world/events.js';
import {DAY} from '../src/world/time.js';
import {WorldStore} from '../src/server/store.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';

function fixture(definition='crop/flax@1'){
 const w=createWorld(),r=w.residents[0];w.clock.paused=false;w.minute=DAY+480;w.weather='sun';
 w.map={width:48,height:48,tiles:Array(48*48).fill('grass'),entrance:{x:1,y:1},name:'合成浇水记忆回归'};
 w.residents=[r];w.resources=[];w.buildings=[];w.graves=[];w.events=[];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{water:2,seed:3,fiber:4},knownBuildings:[],knownResources:[],knownPeople:[],memories:[],hunger:20,energy:100,health:100,plan:null,activity:null});
 for(const d of productiveCrops)w.definitions[`${d.id}@${d.version}`]=structuredClone(d);
 w.plots=[{id:'watered-field',ownerId:r.id,at:{...r.at},crop:{definition,planted:0,growth:1,wateredDay:-1,lastGrowthDay:1}}];
 return {w,r,p:w.plots[0]};
}
function planFor(w:World,r:Resident):Plan{return {id:`watering:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'给眼前田里的作物浇水',actions:[{type:'water',plotId:w.plots[0].id}]};}
function finish(w:World,r:Resident){for(let i=0;i<40&&(r.plan||r.activity);i++)stepWorld(w,1);assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(r.lastFailure,null);}
function water(w:World,r:Resident){const plan=planFor(w,r);assert.equal(submitPlan(w,plan).ok,true);finish(w,r);return plan;}
function wateringEvent(w:World){const events=w.events.filter(e=>e.text.includes('浇了水'));assert.equal(events.length,1);return events[0];}

test('watering events and self memories name each actual bound crop, including flax instead of turnip',()=>{
 const crops=[['crop/turnip@1','作物'],...productiveCrops.map(d=>[`${d.id}@${d.version}`,d.data.name as string])];
 for(const [definition,name] of crops){
  const {w,r,p}=fixture(definition),before=structuredClone(p.crop),skills=structuredClone(r.skills);
  water(w,r);const event=wateringEvent(w);
  assert.equal(event.text,`${r.name}为田里的${name}浇了水。`,definition);
  assert.deepEqual(r.memories.filter(m=>m.eventId===event.id),[{eventId:event.id,receivedAt:w.minute,source:'self',text:event.text}]);
  assert.deepEqual(r.inventory,{water:1,seed:3,fiber:4});assert.deepEqual(r.skills,skills);
  assert.deepEqual(p.crop,{...before,wateredDay:Math.floor(w.minute/DAY)});
  assert.equal(event.at,w.minute);assert.equal(event.kind,'action');assert.deepEqual(event.actors,[r.id]);
  assert.doesNotMatch(event.text,/crop\/|growthDays|seasons|yield|fiber|definition/);
 }
});

test('an extension uses its planted name, while missing names or definitions stay generic without output inference',()=>{
 for(const variant of ['named','unnamed','missing'] as const){
  const {w,r,p}=fixture('crop/synthetic-herb@1');
  if(variant!=='missing')w.definitions[p.crop!.definition]={id:'crop/synthetic-herb',version:1,kind:'recipe',dependencies:[],cost:{seed:2},data:{...(variant==='named'?{name:'  试验药草  '}:{}),growthDays:7,seasons:['spring'],yield:9,output:'herb'}};
  water(w,r);assert.equal(wateringEvent(w).text,`${r.name}为田里的${variant==='named'?'试验药草':'作物'}浇了水。`);
  assert.equal(r.inventory.water,1);assert.equal(p.crop!.definition,'crop/synthetic-herb@1');
 }
});

test('the real formal numbered watering choice produces correct Chinese event and final decision memory',()=>{
 const {w,r,p}=fixture();w.mode='formal';initializeProduction(w);
 const ready=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
 const choice=ready.choices.find(c=>c.action.type==='water'&&c.action.plotId===p.id);assert.ok(choice);
 assert.ok(ready.messages[0].content.includes(choice.id+'. '+choice.label));
 const selected=parseChoice(JSON.stringify({choice:choice.id}),ready.choices),plan={...planFor(w,r),intention:selected.intention,actions:selected.actions};
 assert.equal(submitPlan(w,plan).ok,true);finish(w,r);
 const text=wateringEvent(w).text;assert.equal(text,`${r.name}为田里的纤维作物浇了水。`);
 const after=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
 assert.ok(after.messages[0].content.includes(text));assert.doesNotMatch(after.messages[0].content,/为田里的芜菁浇了水/);
 assert.equal(r.inventory.water,1);assert.equal(p.crop!.growth,1);
});

test('legacy unnamed and named crops resume through SQLite without rewriting history or duplicating water on replay',()=>{
 for(const [definition,name] of [['crop/turnip@1','作物'],['crop/flax@1','纤维作物']]){
  const {w,r}=fixture(definition);
  const old=emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},text:`${r.name}为田里的芜菁浇了水。`});
  const oldMemory=structuredClone(r.memories[0]),plan=planFor(w,r);
  assert.equal(submitPlan(w,plan).ok,true);stepWorld(w,2);assert.ok(r.activity);assert.equal(r.inventory.water,2);
  const store=new WorldStore(':memory:');try{
   store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents[0];loaded.clock.paused=false;
   finish(loaded,actor);const fresh=loaded.events.filter(e=>e.id!==old.id&&e.text.includes('浇了水'));
   assert.equal(fresh.length,1);assert.equal(fresh[0].text,`${actor.name}为田里的${name}浇了水。`);
   assert.deepEqual(loaded.events.find(e=>e.id===old.id),old);assert.deepEqual(actor.memories.find(m=>m.eventId===old.id),oldMemory);
   assert.equal(actor.inventory.water,1);assert.equal(loaded.plots[0].crop!.definition,definition);
   store.commit(loaded,w.revision);const again=store.load(true)!,resumed=again.residents[0];again.clock.paused=false;
   const before=structuredClone(again);assert.equal(submitPlan(again,plan).ok,true);assert.deepEqual(again,before);
   assert.equal(resumed.inventory.water,1);assert.equal(again.events.filter(e=>e.text.includes('浇了水')).length,2);
  }finally{store.close();}
 }
});

test('changing only a display name changes only narration, not any simulation state or resource result',()=>{
 const original=fixture().w,changed=structuredClone(original);
 changed.definitions['crop/flax@1'].data.name='另一个合成作物名称';
 for(const w of [original,changed])water(w,w.residents[0]);
 assert.notEqual(wateringEvent(original).text,wateringEvent(changed).text);
 function withoutNarration(w:World){
  const copy=structuredClone(w);delete copy.definitions['crop/flax@1'].data.name;
  for(const e of copy.events)e.text='';for(const r of copy.residents)for(const m of r.memories)m.text='';
  return copy;
 }
 assert.deepEqual(withoutNarration(original),withoutNarration(changed));
});
