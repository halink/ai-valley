import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {initializeIndustry,industryTarget} from '../src/world/industry.js';
import {industryRecipe} from '../src/world/industry-definitions.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,type ModelName} from '../src/server/model-completion.js';
import {YEAR} from '../src/world/time.js';
import type {Building,DecisionContext} from '../src/shared/types.js';
import type {CraftBatch} from '../src/shared/industry.js';
import {personalFoodProcessing} from '../src/world/personal-food-processing.js';
import {personalFoodProcessingNote} from '../src/server/personal-food-processing.js';
import {WorldStore} from '../src/server/store.js';

function fixture(){
 const w=createWorld(5401);w.mode='formal';w.scenario='frontier';w.minute=480;
 w.map={width:40,height:36,tiles:Array(40*36).fill('grass'),entrance:{x:1,y:1},name:'合成加工复核'};
 const [r,other]=w.residents;
 for(const p of w.residents){p.at={x:5,y:7};p.inside=null;p.bornAt=w.minute-30*YEAR;p.health=p.energy=100;p.hunger=20;p.inventory={};p.plan=p.activity=null;p.skills={farming:2,building:2,care:2};}
 const home:Building={id:'review-food-home',kind:'home',name:'复核住屋',at:{x:2,y:2},width:6,height:5,door:{x:5,y:7},capacity:4,residents:[r.id],ownerId:r.id,definition:'building/home@1',condition:100};
 w.buildings=[home];w.resources=[];w.plots=[];w.graves=[];
 for(const p of w.residents){p.homeId=home.id;p.knownBuildings=[home.id];p.knownResources=[];}
 initializeIndustry(w);r.inventory={gameMeat:1,water:1,wood:1};decisionContext(w,r);
 return {w,r,other,home};
}
function working(f:ReturnType<typeof fixture>,worked=10){
 const {w,r,home}=f,chosen=industryRecipe(w,'gameMeal')!;
 const batch:CraftBatch={id:'review-own-batch',ownerId:r.id,buildingId:home.id,recipe:structuredClone(chosen.recipe),definition:chosen.definition,input:structuredClone(chosen.recipe.input),actionKey:'review-start',worked,lastAt:w.minute,status:'working',createdAt:w.minute-worked};
 w.industry!.batches.push(batch);r.inventory={};return batch;
}
const prepared=(c:DecisionContext,model:ModelName=GLM_MODEL)=>prepareModelDecision(c,undefined,model);
const text=(c:DecisionContext)=>prepared(c).messages.map(m=>m.content).join('\n');
const craft=(f:ReturnType<typeof fixture>)=>industryOpportunities(f.w,f.r).find(o=>o.action.type==='industry'&&o.action.operation==='craft'&&o.action.recipeId==='gameMeal');

test('processing independent review: 10 and 29 worked minutes change prepared observations with two real meal output',()=>{
 const f=fixture(),batch=working(f),a=text(decisionContext(f.w,f.r));batch.worked=29;const before=structuredClone(f.w),b=text(decisionContext(f.w,f.r));
 assert.notEqual(a,b);assert.match(a,/已实际劳动10分钟/);assert.match(a,/尚需25分钟/);assert.match(b,/已实际劳动29分钟/);assert.match(b,/尚需6分钟/);assert.match(a,/2份餐食|餐食2份|2餐食/);assert.match(b,/2份餐食|餐食2份|2餐食/);assert.deepEqual(f.w,before);assert.equal(f.w.metrics.requests,0);
});

test('processing independent review: continuation needs no replacement input and uses historical recipe snapshot',()=>{
 const f=fixture(),batch=working(f,29);const d=structuredClone(f.w.definitions[batch.definition!]);d.version=2;d.minutes=99;d.data={...d.data,minutes:99,output:{meal:9}};f.w.definitions['recipe/industry/gameMeal@2']=d;f.w.activeDefinitions['recipe/industry/gameMeal']='recipe/industry/gameMeal@2';
 const before=structuredClone(f.w),label=craft(f)?.label;assert.ok(label);assert.match(label,/尚需6分钟/);assert.match(label,/2份餐食|餐食2份|2餐食/);assert.doesNotMatch(label,/9份餐食|99分钟/);assert.deepEqual(f.w,before);
});

test('processing independent review: unknown definitions and food lots stay unknown during repeated observation',()=>{
 const f=fixture(),batch=working(f);delete batch.definition;delete f.w.food;
 const before=structuredClone(f.w);for(let i=0;i<3;i++){assert.ok(craft(f));text(decisionContext(f.w,f.r));}assert.deepEqual(f.w,before);
});

test('processing independent review: others private batches cannot change actor processing facts',()=>{
 const f=fixture(),batch=working(f),a=text(decisionContext(f.w,f.r));const other=structuredClone(batch);other.id='OTHER-SECRET-BATCH';other.ownerId=f.other.id;other.recipe.name='SECRET-RECIPE';other.worked=17;other.input={gameMeat:987};f.w.industry!.batches.unshift(other);
 assert.equal(text(decisionContext(f.w,f.r)),a);
});

test('processing independent review: completed, cancelled, unknown-location and revoked projects are not offered',()=>{
 for(const state of ['completed','cancelled','remote','revoked','unknown'] as const){const f=fixture(),batch=working(f);if(state==='completed'||state==='cancelled')batch.status=state;else if(state==='remote')f.r.at={x:35,y:30};else if(state==='unknown')f.r.knownBuildings=[];else{f.home.ownerId=f.other.id;f.home.residents=[];f.r.homeId=null;}assert.equal(craft(f),undefined,state);}
});

test('processing independent review: progress survives saturated choices and long family notes across prompt families',()=>{
 const f=fixture();working(f,29);const c=decisionContext(f.w,f.r);c.formal!.familyNotes='合成家事'.repeat(9000);for(let i=0;i<160;i++)c.formal!.opportunities.unshift({id:`review.${i}`,label:'合成工作',action:{type:'employment',operation:'work',contractId:`review.${i}`}});
 const before=structuredClone(c);for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){const p=prepared(c,model),s=p.messages.map(m=>m.content).join('\n');assert.match(s,/已实际劳动29分钟/);assert.match(s,/尚需6分钟/);assert.match(s,/2份餐食|餐食2份|2餐食/);assert.ok(p.choices.length<=59);}assert.deepEqual(c,before);
});

test('processing independent review: memory-only save and reload preserve factual prompt',()=>{
 const f=fixture();working(f,29);const a=prepared(decisionContext(f.w,f.r)),store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load(true)!,r=w.residents.find(r=>r.id===f.r.id)!;assert.deepEqual(prepared(decisionContext(w,r)),a);}finally{store.close();}
});


test('processing independent review: missing reservation and invalid progress are not repaired or presented as facts',()=>{
 const f=fixture(),batch=working(f);batch.worked=NaN;delete (batch as Partial<CraftBatch>).input;
 const before=structuredClone(f.w),view=personalFoodProcessing(f.w,f.r);assert.equal(view.current!.worked,null);assert.equal(view.current!.remaining,null);assert.equal(view.current!.reserved,null);assert.deepEqual(f.w,before);
});

test('processing independent review: local permission boundary also applies to non-menu observation',()=>{
 for(const state of ['remote','revoked','unknown','other-room'] as const){const f=fixture();working(f);if(state==='remote')f.r.at={x:35,y:30};else if(state==='unknown')f.r.knownBuildings=[];else if(state==='other-room')f.r.inside='another-room';else{f.home.ownerId=f.other.id;f.home.residents=[];f.r.homeId=null;}assert.equal(personalFoodProcessing(f.w,f.r).current,null,state);}
});

test('processing independent review: raw meat rule is accurate and stale actor or minute views are rejected',()=>{
 const f=fixture(),c=decisionContext(f.w,f.r);assert.match(text(c),/生猎肉不能直接进食，须加工/);assert.ok(!prepared(c).choices.some(o=>o.action.type==='eat'&&o.action.item==='gameMeat'));
 c.minute++;assert.equal(personalFoodProcessingNote(c),'');c.minute--;c.actor.id='other';assert.equal(personalFoodProcessingNote(c),'');
});


test('processing independent review: retired legacy recipe resumes using snapshot without inventing definition',()=>{
 const f=fixture(),batch=working(f,29);batch.recipe.id='retired-personal-game-recipe';delete batch.definition;
 const before=structuredClone(f.w),op=industryOpportunities(f.w,f.r).find(o=>o.action.type==='industry'&&o.action.recipeId===batch.recipe.id);assert.ok(op);assert.match(op.label,/尚需6分钟/);assert.match(op.label,/2份餐食/);assert.deepEqual(f.w,before);
});

test('processing independent review: stale selected continuation never turns into new batch despite sufficient raw stock',()=>{
 for(const state of ['completed','cancelled','missing'] as const){const f=fixture(),batch=working(f,29),op=craft(f)!;assert.equal(op.action.type,'industry');if(op.action.type!=='industry')throw new Error('wrong action');assert.equal(op.action.batchId,batch.id);f.r.inventory={gameMeat:1,water:1,wood:1};if(state==='missing')f.w.industry!.batches=[];else batch.status=state;
 const before=structuredClone(f.w);assert.match(industryTarget(f.w,f.r,structuredClone(op.action),false,f.w.minute,true).error??'',/批次已失效/);assert.deepEqual(f.w,before);}
});
