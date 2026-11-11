import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeProduction} from '../src/world/production.js';
import {decisionContext,decisionChoices,prepareModelDecision} from '../src/server/decisions.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {focusNames} from '../src/shared/agency.js';
import type {DecisionContext} from '../src/shared/types.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';

const planting=(row:ActionChoice)=>row.action.type==='production'&&row.action.operation==='plantCrop';
const identity=(row:ActionChoice)=>row.action.type==='production'?JSON.stringify([row.action.plotId,row.action.cropId]):'';
function fixture(){
 const w=createFrontierWorld(5419),r=w.residents.find(r=>r.id==='founder-2-1')!;
 initializeProduction(w);w.minute=1000.8;w.clock.paused=false;
 const p=w.plots.find(p=>p.ownerId===r.id)!;
 Object.assign(r,{at:{...p.at},inside:null,roomAt:null,plan:null,activity:null,inventory:{seed:2,water:2,turnip:3,meal:1},agency:undefined});
 return {w,r,p};
}
function crowd(c:DecisionContext){
 for(let i=0;i<160;i++){
  c.formal!.opportunities.push({id:`plant-work.${i}`,label:'Synthetic scheduled work',action:{type:'employment',operation:'work',contractId:`plant-contract.${i}`}});
  c.formal!.opportunities.push({id:`plant-reply.${i}`,label:'Synthetic independent reply',action:{type:'respond',proposalId:`plant-proposal.${i}`,accept:false}});
 }
}

test('legal crops remain selectable throughout a complete saturated rotation, with or without a chosen focus',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);crowd(c);
 const raw=c.formal!.opportunities.filter(planting);assert.equal(raw.length,3);
 assert.equal(new Set(raw.map(row=>row.id)).size,1,'legacy opportunity IDs collide across crop varieties');
 for(const focus of [null,...Object.keys(focusNames)] as Array<keyof typeof focusNames|null>){
  c.actor.agency=focus?{focus,goals:[],routines:[],nextSerial:1}:undefined;
  const seen=new Set<string>();
  for(let window=0;window<raw.length;window++){
   c.minute=1020+window*30;const before=structuredClone(c),all=buildChoices(c),focused=focusedChoices(c,all),ready=prepareModelDecision(c,undefined,GLM_MODEL);
   assert.ok(focused.length<=60,'56 ordinary + 2 water sources + 1 cooking + at most 1 restored crop');
   assert.ok(ready.choices.some(planting),`missing planting at ${c.minute}, focus ${focus}`);
   for(const row of ready.choices.filter(planting)){
    seen.add(identity(row));assert.ok(raw.some(candidate=>identity(candidate)===identity(row)));
    assert.ok(ready.messages[0].content.includes(row.id+'. '+row.label));
    assert.deepEqual(parseChoice(JSON.stringify({choice:row.id}),ready.choices).actions,[row.action]);
   }
   assert.deepEqual(c,before,'preparing a menu neither authorizes nor executes anything');
  }
  assert.deepEqual([...seen].sort(),raw.map(identity).sort(),`complete crop cycle for ${focus}`);
 }
 assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(r.inventory.seed,2);assert.equal(w.metrics.requests,0);
});

test('restoration cannot resurrect planting filtered out by age, transport or expression-only restrictions',()=>{
 const {w,r}=fixture(),original=decisionContext(w,r);assert.ok(original.formal!.opportunities.some(planting));
 for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','aboard','passenger','familyTravelling'] as const){
  const c=structuredClone(original);c.formal![flag]=true;
  assert.ok(!buildChoices(c).some(planting),flag);assert.ok(!decisionChoices(c).some(planting),flag);
 }
 for(const age of [4,12,17]){const c=structuredClone(original);c.formal!.age=age;assert.ok(!decisionChoices(c).some(planting));}
 const unknown=structuredClone(original);unknown.formal!.unknownAgeSelfCare=[];unknown.formal!.knownAge=null;
 assert.ok(!decisionChoices(unknown).some(planting));
});

test('missing seeds, title, visible land or seasonal recipes never create planting candidates',()=>{
 for(const change of ['seed','title','crop','season','inside'] as const){
  const {w,r}=fixture();
  if(change==='seed')r.inventory.seed=0;
  if(change==='title')for(const p of w.plots.filter(p=>p.ownerId===r.id))p.ownerId='someone-else';
  if(change==='crop')for(const p of w.plots.filter(p=>p.ownerId===r.id))p.crop={definition:'crop/turnip@2',planted:w.minute,growth:0,wateredDay:-1,lastGrowthDay:0};
  if(change==='season')for(const d of Object.values(w.definitions).filter(d=>d.id.startsWith('crop/')))d.data.seasons=[];
  if(change==='inside')r.inside=r.homeId;
  const c=decisionContext(w,r);assert.ok(!c.formal!.opportunities.some(planting),change);assert.ok(!decisionChoices(c).some(planting),change);
 }
});

test('a restored numbered choice plants only the selected actual crop after explicit execution, without auto-watering',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);crowd(c);c.minute=w.minute=1080;
 const menu=decisionChoices(c),row=menu.find(planting);assert.ok(row);
 const a=parseChoice(JSON.stringify({choice:row.id}),menu).actions[0];assert.equal(a.type,'production');
 if(a.type!=='production')assert.fail('wrong action');
 const plot=w.plots.find(p=>p.id===a.plotId)!;assert.equal(plot.crop,null);assert.equal(r.inventory.seed,2);
 const result=submitPlan(w,{id:'plant-menu-explicit',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Explicit offline planting choice',actions:[a]});
 assert.equal(result.ok,true);
 for(let i=0;i<80&&(r.plan||r.activity);i++)stepWorld(w,1);
 assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(r.lastFailure,null);
 const grown=w.plots.find(p=>p.id===a.plotId)!.crop;assert.ok(grown);
 assert.equal(grown.definition,a.cropId);assert.equal(grown.wateredDay,-1);assert.equal(grown.growth,0);
 assert.equal(r.inventory.seed,1);assert.equal(r.inventory.water,2);assert.equal(w.metrics.requests,0);
});

test('a formerly visible planting action still revalidates changed seeds, title, occupancy and season',()=>{
 for(const change of ['seed','title','crop','season'] as const){
  const {w,r}=fixture(),menu=decisionChoices(decisionContext(w,r)),row=menu.find(planting);assert.ok(row);
  const a=parseChoice(JSON.stringify({choice:row.id}),menu).actions[0];if(a.type!=='production')assert.fail('wrong action');
  const plot=w.plots.find(p=>p.id===a.plotId)!;
  if(change==='seed')r.inventory.seed=0;
  if(change==='title')plot.ownerId='someone-else';
  if(change==='crop')plot.crop={definition:'crop/turnip@2',planted:w.minute,growth:0,wateredDay:-1,lastGrowthDay:0};
  if(change==='season')w.definitions[a.cropId!].data.seasons=[];
  const inventory=structuredClone(r.inventory),crop=structuredClone(plot.crop);
  const result=submitPlan(w,{id:`plant-menu-stale-${change}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Stale offline planting choice',actions:[a]});
  if(result.ok)for(let i=0;i<80&&(r.plan||r.activity);i++)stepWorld(w,1);
  assert.ok(!result.ok||r.lastFailure,change);assert.deepEqual(r.inventory,inventory);assert.deepEqual(plot.crop,crop);
 }
});
