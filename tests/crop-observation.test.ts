import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {createWorld} from '../src/world/seed.js';
import {parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {initializeProduction} from '../src/world/production.js';
import type {Resident,World} from '../src/shared/types.js';
import {cropObservationNote,MAX_CROP_OBSERVATIONS} from '../src/server/crop-observation.js';
import {QWEN_MODEL,DEEPSEEK_MODEL,modelLimits} from '../src/server/model-completion.js';
import {DAY} from '../src/world/time.js';

function fixture(){
 const w=createWorld(),r=w.residents[0];w.clock.paused=false;w.minute=DAY+480;w.weather='sun';
 w.map={width:80,height:64,tiles:Array(80*64).fill('grass'),entrance:{x:1,y:1},name:'合成农业观察回归'};
 w.residents=[r];w.resources=[];w.buildings=[];w.graves=[];w.events=[];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{water:0},knownBuildings:[],knownResources:[],knownPeople:[],memories:[],hunger:20,energy:100,health:100});
 w.plots=[{id:'own-visible',ownerId:r.id,at:{x:21,y:20},crop:{definition:'crop/turnip@1',planted:0,growth:1,wateredDay:-1,lastGrowthDay:1}}];
 return {w,r,p:w.plots[0]};
}

test('real zero-water contexts distinguish today’s watering in final model input without adding an unavailable action',()=>{
 const {w,r,p}=fixture(),before=structuredClone(w),dryContext=structuredClone(decisionContext(w,r)),dry=prepareModelDecision(dryContext,undefined,GLM_MODEL);
 assert.deepEqual(w,before,'observing/preparing must be read-only');
 p.crop!.wateredDay=Math.floor(w.minute/DAY);
 const wetContext=decisionContext(w,r),wet=prepareModelDecision(wetContext,undefined,GLM_MODEL);
 assert.notDeepEqual(dryContext.plots,wetContext.plots);
 assert.deepEqual(dry.choices,wet.choices);
 assert.ok(!dry.choices.some(c=>c.action.type==='water'));
 assert.notEqual(dry.messages[0].content,wet.messages[0].content);
 assert.match(dry.messages[0].content,/今日未浇水/);
 assert.match(wet.messages[0].content,/今日已浇水/);
 assert.match(dry.messages[0].content,/不会自动/);
});


const prepare=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
function select(w:World,r:Resident,prepared:ReturnType<typeof prepare>,choice:ActionChoice,minutes?:number){
 assert.ok(prepared.messages[0].content.includes(choice.id+'. '+choice.label));
 const d=parseChoice(JSON.stringify({choice:choice.id,...(minutes===undefined?{}:{minutes})}),prepared.choices);
 const plan={id:`crop-test:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:d.intention,actions:d.actions};
 assert.equal(submitPlan(w,plan).ok,true);return plan;
}
function finish(w:World,r:Resident){for(let i=0;i<300&&(r.plan||r.activity);i++)stepWorld(w,1);assert.equal(r.plan,null);assert.equal(r.activity,null);}

test('formal productive zero-water decisions also preserve crop facts independently of the missing watering menu',()=>{
 const {w,r,p}=fixture();w.mode='formal';initializeProduction(w);p.crop!.definition='crop/turnip@2';
 const dry=prepare(w,r);p.crop!.wateredDay=Math.floor(w.minute/DAY);const wet=prepare(w,r);
 assert.deepEqual(dry.choices,wet.choices);assert.ok(!dry.choices.some(c=>c.action.type==='water'));
 assert.notDeepEqual(dry.messages,wet.messages);assert.match(dry.messages[0].content,/今日未浇水/);assert.match(wet.messages[0].content,/今日已浇水/);
 assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(r.inventory.water,0);
});

test('observations are snapshots, not live aliases or hidden raw growth in the prompt',()=>{
 const {w,r,p}=fixture(),c=decisionContext(w,r),messages=prepare(w,r).messages;
 p.crop!.growth=987.125;p.crop!.wateredDay=1;p.crop!.planted=1234567;p.at.x++;
 assert.equal(c.plots[0].crop!.growth,1);assert.equal(c.plots[0].at.x,21);
 assert.deepEqual(prepareModelDecision(c,undefined,GLM_MODEL).messages,messages);
 assert.doesNotMatch(JSON.stringify(messages),/growth|wateredDay|lastGrowthDay|definition|planted/);
});

test('independent explicit wait, gather and water choices are the only path to carried water and irrigation',()=>{
 const {w,r,p}=fixture();
 w.resources=[{id:'spring-crop',kind:'spring',at:{x:20,y:22},amount:12,max:12,regrowthDays:0,lastHarvest:0}];r.knownResources=['spring-crop'];
 let prepared=prepare(w,r);assert.match(prepared.messages[0].content,/用水条件尚未具备/);
 const waiting=prepared.choices.find(c=>c.action.type==='wait')!;select(w,r,prepared,waiting);finish(w,r);
 assert.equal(p.crop!.wateredDay,-1);assert.equal(p.crop!.growth,1);assert.equal(r.inventory.water,0);assert.equal(w.resources[0].amount,12);
 prepared=prepare(w,r);select(w,r,prepared,prepared.choices.find(c=>c.action.type==='gather')!);finish(w,r);
 assert.equal(r.inventory.water,3);assert.equal(w.resources[0].amount,9);assert.equal(p.crop!.wateredDay,-1);
 prepared=prepare(w,r);select(w,r,prepared,prepared.choices.find(c=>c.action.type==='water')!);finish(w,r);
 assert.equal(r.lastFailure,null);assert.equal(r.inventory.water,2);assert.equal(p.crop!.wateredDay,Math.floor(w.minute/DAY));assert.equal(p.crop!.growth,1);
 assert.match(prepare(w,r).messages[0].content,/今日已浇水/);assert.ok(!prepare(w,r).choices.some(c=>c.action.type==='water'));
});

test('growth advances only at a real day boundary and the observation reopens today’s watering independently',()=>{
 for(const wet of [false,true]){
  const {w,r,p}=fixture();w.minute=2*DAY-1;p.crop!.wateredDay=wet?1:-1;w.weather='sun';
  assert.match(prepare(w,r).messages[0].content,wet?/今日已浇水/:/今日未浇水/);
  stepWorld(w,1);assert.equal(w.minute,2*DAY);assert.equal(p.crop!.growth,wet?2:1);
  assert.equal(decisionContext(w,r).plots[0].observed!.wateredToday,false);
  assert.match(prepare(w,r).messages[0].content,/第2880分钟亲眼看到/);
  assert.equal(r.plan,null);assert.equal(r.inventory.water,0);
 }
});

test('rain is current water evidence, never a watering record, seed-based forecast, or guaranteed growth',()=>{
 const {w,r,p}=fixture();w.weather='rain';const a=prepare(w,r);
 assert.match(a.messages[0].content,/今日未浇水/);assert.match(a.messages[0].content,/眼前正在下雨/);
 assert.doesNotMatch(a.messages[0].content,/用水条件尚未具备/);
 w.seed+=91;assert.deepEqual(prepare(w,r).messages,a.messages,'future weather schedule cannot affect the prompt');
 w.minute=2*DAY-1;stepWorld(w,1);assert.equal(p.crop!.growth,2,'actual previous rain, not forecast, grows the crop');
 assert.equal(p.crop!.wateredDay,-1);assert.equal(decisionContext(w,r).plots[0].observed!.wateredToday,false);
});

test('the planted definition fixes maturity and season even after the active crop definition changes',()=>{
 const {w,r,p}=fixture();w.mode='formal';initializeProduction(w);r.inventory={water:1};
 p.crop!.definition='crop/winter-root@1';p.crop!.growth=4;
 w.activeDefinitions['crop/winter-root']='crop/turnip@1';
 let result=prepare(w,r);assert.match(result.messages[0].content,/作物未成熟/);assert.match(result.messages[0].content,/当前季节不适合生长/);
 assert.ok(result.choices.some(c=>c.action.type==='water'));assert.ok(!result.choices.some(c=>c.action.type==='harvest'));
 p.crop!.growth=6;result=prepare(w,r);
 assert.match(result.messages[0].content,/作物已成熟/);assert.doesNotMatch(result.messages[0].content,/当前季节不适合生长/);
 assert.ok(result.choices.some(c=>c.action.type==='harvest'));assert.ok(!result.choices.some(c=>c.action.type==='water'));
 select(w,r,result,result.choices.find(c=>c.action.type==='harvest')!);finish(w,r);
 assert.equal(r.lastFailure,null);assert.equal(p.crop,null);assert.equal(r.inventory.turnip,18);
 assert.match(prepare(w,r).messages[0].content,/未种田间作物/);
});

test('a non-default crop cannot hide a later legal routine watering choice',()=>{
 const {w,r,p}=fixture();w.mode='formal';initializeProduction(w);r.inventory={water:2};
 w.plots.unshift({...structuredClone(p),id:'near-other',at:{...r.at},crop:{...p.crop!,definition:'crop/flax@1'}});
 const result=prepare(w,r),waters=result.choices.filter(c=>c.action.type==='water');
 assert.ok(waters.some(c=>c.action.type==='water'&&c.action.plotId===p.id));
 assert.ok(waters.some(c=>c.action.type==='water'&&c.action.plotId==='near-other'));
});

test('selected irrigation survives an in-memory reload and replay cannot spend water twice',()=>{
 const {w,r,p}=fixture();r.inventory.water=1;const prepared=prepare(w,r),plan=select(w,r,prepared,prepared.choices.find(c=>c.action.type==='water')!);
 stepWorld(w,2);assert.ok(r.activity);assert.equal(p.crop!.wateredDay,-1);
 const store=new WorldStore(':memory:');try{
  store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents[0];loaded.clock.paused=false;
  finish(loaded,actor);assert.equal(actor.lastFailure,null);assert.equal(actor.inventory.water,0);
  assert.equal(loaded.plots[0].crop!.wateredDay,Math.floor(loaded.minute/DAY));
  assert.match(prepare(loaded,actor).messages[0].content,/今日已浇水/);
  assert.equal(submitPlan(loaded,plan).ok,true);assert.equal(actor.inventory.water,0);assert.equal(actor.plan,null);
  assert.equal(loaded.events.filter(e=>e.text.includes('浇了水')).length,1);
 }finally{store.close();}
});

test('stale observed ownership and stock do not authorize irrigation at execution',()=>{
 for(const changed of ['owner','water','crop'] as const){
  const {w,r,p}=fixture();r.inventory.water=1;const prepared=prepare(w,r);
  select(w,r,prepared,prepared.choices.find(c=>c.action.type==='water')!);stepWorld(w,2);
  if(changed==='owner')p.ownerId='other';else if(changed==='water')r.inventory.water=0;else p.crop=null;
  finish(w,r);assert.ok(r.lastFailure);assert.equal(r.inventory.water,changed==='water'?0:1);
  assert.equal(p.crop?.wateredDay??-1,-1);assert.ok(!w.events.some(e=>e.text.includes('浇了水')));
 }
});

test('large agendas and family notes cannot suppress bounded crop facts or exceed supported input budgets',()=>{
 const {w,r,p}=fixture();w.mode='formal';r.agency={focus:'social',goals:[],routines:[],nextSerial:1};
 w.plots=Array.from({length:60},(_,i)=>({...structuredClone(p),id:'field-'+String(i).padStart(3,'0'),at:{x:20+i%6,y:20+Math.floor(i/6)%3}}));
 for(let turn=0;turn<60;turn++){
  w.minute=DAY+480+turn*30;const c=decisionContext(w,r);
  c.formal!.familyNotes='很长的家庭记录。'.repeat(5000);
  c.formal!.opportunities.push(...Array.from({length:100},(_,i):ActionChoice=>({id:'lesson-'+i,label:'已约课程',action:{type:'education',operation:'study',lessonId:'lesson-'+i,minutes:30}})));
  for(const model of [QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL] as const){
   const ready=prepareModelDecision(c,undefined,model),note=cropObservationNote(c,ready.choices);
   assert.ok(ready.choices.length<=56);assert.ok(ready.inputBytes<modelLimits[model].inputBytes);
   assert.ok((note.match(/本人田\(/g)??[]).length<=MAX_CROP_OBSERVATIONS);assert.match(ready.messages[0].content,/今日未浇水/);
   assert.match(note,/其他可见田况未在本次摘要列完/);assert.ok(Buffer.byteLength(note)<5000);
  }
  const before=prepare(w,r).messages;w.plots.reverse();assert.deepEqual(prepare(w,r).messages,before);
 }
});
