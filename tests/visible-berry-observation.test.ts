import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {initializeFood} from '../src/world/food.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import type {Resource} from '../src/shared/types.js';
import {visibleBerryObservationNote} from '../src/server/visible-berry-observation.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(amount:number){
 const w=createWorld(5401),r=w.residents[0];w.mode='formal';w.clock.paused=false;
 w.map={width:80,height:64,tiles:Array(80*64).fill('grass'),entrance:{x:1,y:1},name:'合成现场浆果观察'};
 w.buildings=[];w.plots=[];w.graves=[];w.residents=[r];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{},knownBuildings:[],knownResources:['seen-berry'],knownPeople:[],hunger:90,health:100,energy:100,memories:[]});
 const patch:Resource={id:'seen-berry',kind:'bush',at:{x:22,y:20},amount,max:12,regrowthDays:4,lastHarvest:w.minute};w.resources=[patch];initializeFood(w);
 return {w,r,patch};
}

test('visible berry zero and fractional stock must not collapse to identical final prompts',()=>{
 const {w,r,patch}=fixture(0),first=decisionContext(w,r);patch.amount=.5;const second=decisionContext(w,r);
 assert.equal(first.resources[0].amount,0);assert.equal(second.resources[0].amount,.5);
 for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){
  const a=prepareModelDecision(first,undefined,model),b=prepareModelDecision(second,undefined,model);
  assert.deepEqual(a.choices,b.choices);assert.notEqual(hash(a.messages),hash(b.messages),'observed zero versus partial stock is decision information, not a new action');
 }
});

test('visible berry capped gather quantities must not erase different observed remaining stock',()=>{
 const {w,r,patch}=fixture(3),first=decisionContext(w,r);patch.amount=12;const second=decisionContext(w,r);
 for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){
  const a=prepareModelDecision(first,undefined,model),b=prepareModelDecision(second,undefined,model);
  assert.deepEqual(a.choices,b.choices);assert.ok(a.choices.some(c=>c.action.type==='gather'&&c.action.quantity===3));
  assert.notEqual(hash(a.messages),hash(b.messages),'same three-portion action does not mean the patch has the same visible stock');
 }
});

test('visible berry observation never reads regeneration metadata or mutates its snapshot',()=>{
 const {w,r,patch}=fixture(0),c=decisionContext(w,r),p=prepareModelDecision(c,undefined,GLM_MODEL),before=structuredClone(c),world=structuredClone(w);
 const note=visibleBerryObservationNote(c,p.choices);assert.match(note,/当前看见0份，此刻没有浆果/);assert.match(note,/不预报再生/);
 assert.deepEqual(w,world);assert.deepEqual(c,before);
 for(const resource of c.resources){resource.max=999999;resource.lastHarvest=-987654;resource.regrowthDays=98765;}
 assert.deepEqual(prepareModelDecision(c,undefined,GLM_MODEL).messages,p.messages);
 patch.amount=12;assert.deepEqual(prepareModelDecision(c,undefined,GLM_MODEL).messages,p.messages,'a prepared personal snapshot is not a remote update');
});

test('visible berry formatting during real selected gather and eat does not alter engine outcomes',()=>{
 const {w}=fixture(3),runs=[];
 for(const observe of [false,true]){
  const world=structuredClone(w),r=world.residents[0],receipts=[];
  for(const type of ['gather','eat'] as const){
   const c=decisionContext(world,r),p=prepareModelDecision(c,undefined,GLM_MODEL),row=p.choices.find(row=>type==='gather'?row.action.type==='gather'&&row.action.resourceId==='seen-berry':row.action.type==='eat'&&row.action.item==='berry');assert.ok(row);
   const choice=parseChoice(JSON.stringify({choice:row.id}),p.choices),result=submitPlan(world,{id:'berry-observation:'+type,actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],...choice});assert.equal(result.ok,true);
   let left=50;while(r.plan||r.activity){assert.ok(left--);if(observe){const before=structuredClone(world);prepareModelDecision(decisionContext(world,r),undefined,GLM_MODEL);assert.deepEqual(world,before);}receipts.push(...stepWorldWithFoodEvidence(world,1).receipts);}
   assert.equal(r.lastFailure,null);
  }
  assert.equal(world.resources[0].amount,0);assert.equal(r.inventory.berry,2);assert.equal(receipts.length,1);assert.equal(receipts[0].nutrition,12);
  runs.push({world,receipts});
 }
 assert.deepEqual(runs[0],runs[1]);
});
