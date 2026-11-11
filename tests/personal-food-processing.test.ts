import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {personalFoodProcessing} from '../src/world/personal-food-processing.js';
import {personalFoodProcessingNote} from '../src/server/personal-food-processing.js';
import {initializeFood,advanceFood} from '../src/world/food.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import type {Resident,World} from '../src/shared/types.js';
import type {CraftBatch} from '../src/shared/industry.js';

function fixture(){
 const w=createFrontierWorld(5401),r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 w.clock.paused=false;r.at={...home.door};r.inside=null;r.roomAt=null;r.hunger=20;r.energy=100;
 // Explicit synthetic processing stock, not the natural nine-resident opening.
 r.inventory={gameMeat:1,water:1,wood:1};initializeFood(w);decisionContext(w,r);
 return {w,r,home};
}
const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
function submit(w:World,r:Resident,choice:ActionChoice,choices:ActionChoice[],minutes?:number){
 const parsed=parseChoice(JSON.stringify({choice:choice.id,...(minutes===undefined?{}:{minutes})}),choices);
 const result=submitPlan(w,{id:`processing:${r.id}:${w.minute}:${r.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:parsed.intention,actions:parsed.actions});
 assert.equal(result.ok,true,JSON.stringify(result));return parsed.actions[0];
}
function finish(w:World,r:Resident){for(let n=0;r.plan||r.activity;n++){assert.ok(n<500);stepWorld(w,1);}}
function choose(w:World,r:Resident,type:'craft'|'wait',minutes:number){
 for(let n=0;n<40;n++){
  const p=prepared(w,r),choice=p.choices.find(c=>type==='wait'?c.action.type==='wait':c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal');
  if(choice){const a=submit(w,r,choice,p.choices,minutes);finish(w,r);assert.equal(r.lastFailure,null);return a;}
  const wait=p.choices.find(c=>c.action.type==='wait')!;assert.ok(wait);submit(w,r,wait,p.choices,30);finish(w,r);
 }
 throw new Error('No normal numbered processing choice');
}
function started(minutes=10){const f=fixture();choose(f.w,f.r,'craft',minutes);return {...f,batch:f.w.industry!.batches.find(b=>b.ownerId===f.r.id)!};}

test('seed5401 actual numbered new work consumes one input set and exposes current work outside menu truncation',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No network or model calls');});
 const {w,r,home}=fixture(),newChoice=industryOpportunities(w,r).find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal')!;
 assert.match(newChoice.label,/新开工/);assert.match(newChoice.label,/1份木材、1份清水、1份生猎肉/);assert.match(newChoice.label,/35分钟.*2份餐食/);
 const before=structuredClone(w);prepared(w,r);assert.deepEqual(w,before);
 choose(w,r,'craft',10);const batch=w.industry!.batches.find(b=>b.ownerId===r.id)!;
 assert.equal(batch.worked,10);assert.equal(batch.status,'working');assert.equal(r.inventory.gameMeat,0);assert.equal(r.inventory.water,0);assert.equal(r.inventory.wood,0);assert.equal(r.inventory.meal??0,0);
 assert.equal(batch.buildingId,home.id);assert.deepEqual(batch.input,{gameMeat:1,water:1,wood:1});
 const p=prepared(w,r);assert.match(p.messages[0].content,/已实际劳动10分钟.*尚需25分钟/);assert.match(p.messages[0].content,/产出2份餐食，尚未入库/);
 assert.equal(w.metrics.requests,0);
});

test('equal stock and world minute with 10 versus 29 work generate distinguishable final prompts',()=>{
 const {w,r,batch}=started(),a=decisionContext(w,r),pa=prepared(w,r);batch.worked=29;const b=decisionContext(w,r),pb=prepared(w,r);
 assert.deepEqual(a.actor,b.actor);assert.equal(a.minute,b.minute);assert.match(pa.messages[0].content,/尚需25分钟/);assert.match(pb.messages[0].content,/尚需6分钟/);assert.notDeepEqual(pa.messages,pb.messages);
 const stripped=(c:typeof a)=>{delete c.formal!.personalFoodProcessing;c.formal!.opportunities=c.formal!.opportunities.filter(o=>o.action.type!=='industry'||o.action.operation!=='craft');return c;};
 assert.deepEqual(stripped(structuredClone(a)),stripped(structuredClone(b)));
});

test('wait interruption retains ten work minutes and old inputs, reload then actual numbered continuation completes exactly two meals',()=>{
 const {w,r,batch}=started();choose(w,r,'wait',10);assert.equal(batch.worked,10);assert.equal(batch.status,'working');
 const snapshot=prepared(w,r),store=new WorldStore(':memory:');let loaded:World;
 try{store.commit(w,null);loaded=store.load(true)!;}finally{store.close();}
 const actor=loaded.residents.find(p=>p.id===r.id)!,restored=loaded.industry!.batches.find(b=>b.id===batch.id)!;
 assert.deepEqual(prepared(loaded,actor),snapshot);choose(loaded,actor,'craft',19);
 assert.equal(restored.worked,29);assert.equal(actor.inventory.meal??0,0);assert.match(prepared(loaded,actor).messages[0].content,/尚需6分钟/);
 choose(loaded,actor,'craft',60);assert.equal(restored.worked,35);assert.equal(restored.status,'completed');assert.equal(actor.inventory.meal,2);
 assert.equal(actor.inventory.gameMeat,0);assert.equal(actor.inventory.wood,0);assert.equal(actor.inventory.water,0);assert.equal(loaded.industry!.totals.crafted,1);
 assert.equal(personalFoodProcessing(loaded,actor).current,null);assert.equal(actor.plan,null);assert.equal(actor.activity,null);
});

test('continuation loses current use rights during work without creating output, refunding inputs or erasing work',()=>{
 const {w,r,home,batch}=started(),p=prepared(w,r),choice=p.choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft')!;
 assert.ok(choice);submit(w,r,choice,p.choices,20);home.ownerId=w.residents[3].id;home.residents=[];finish(w,r);
 assert.ok(r.lastFailure);assert.equal(batch.worked,10);assert.equal(batch.status,'working');assert.equal(r.inventory.meal??0,0);assert.equal(r.inventory.gameMeat,0);
 assert.equal(personalFoodProcessing(w,r).current,null);home.ownerId=r.id;home.residents=[r.id];
 choose(w,r,'craft',25);assert.equal(batch.status,'completed');assert.equal(r.inventory.meal,2);
});

test('spoilage after displayed continuation cancels the original batch and stale choice cannot consume a replacement input set',()=>{
 const {w,r,batch}=started(),p=prepared(w,r),choice=p.choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft')!;assert.ok(choice);
 const lot=w.food!.lots['craft:'+batch.id].gameMeat![0];lot.expiresAt=w.minute;advanceFood(w);assert.equal(batch.status,'cancelled');
 // A later genuine replacement inventory must not turn an old resume into new work.
 r.inventory.gameMeat=1;initializeFood(w);const before={...r.inventory};submit(w,r,choice,p.choices,25);finish(w,r);
 assert.ok(r.lastFailure);assert.deepEqual(r.inventory,before);assert.equal(w.industry!.batches.length,1);assert.equal(r.inventory.meal??0,0);assert.equal(w.food!.spoiled.gameMeat,1);
});

test('new work displayed before material competition fails without adding a batch',()=>{
 const {w,r}=fixture(),p=prepared(w,r),choice=p.choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal')!;assert.ok(choice);
 r.inventory.wood=0;submit(w,r,choice,p.choices,35);finish(w,r);assert.ok(r.lastFailure);assert.equal(w.industry!.batches.length,0);assert.equal(r.inventory.meal??0,0);
});

test('unknown work/input/output fields are reported as unknown without refreshing or mutating physical evidence',()=>{
 for(const missing of ['worked','input','output','minutes'] as const){const {w,r,batch}=started();
  if(missing==='input')delete (batch as Partial<CraftBatch>).input;
  else if(missing==='worked')delete (batch as Partial<CraftBatch>).worked;
  else delete (batch.recipe as unknown as Record<string,unknown>)[missing];
  const before=structuredClone(w),c=decisionContext(w,r),note=personalFoodProcessingNote(c);
  assert.match(note,/未知|记录缺失，未确认/);assert.doesNotMatch(note,/NaN|undefined/);assert.deepEqual(w,before);
 }
});

test('view is a detached snapshot and does not promise cooked output freshness or a nutritional gain',()=>{
 const {w,r,batch}=started(),c=decisionContext(w,r),p=prepareModelDecision(c,undefined,GLM_MODEL);batch.worked=29;batch.recipe.output.meal=9;
 assert.deepEqual(prepareModelDecision(c,undefined,GLM_MODEL),p);
 const note=personalFoodProcessingNote(c);assert.match(note,/生猎肉不能直接进食，须加工/);assert.match(note,/餐食可直接进食/);assert.match(note,/不推算其批次保质期或营养/);assert.doesNotMatch(note,/84|保质期3日/);
});
