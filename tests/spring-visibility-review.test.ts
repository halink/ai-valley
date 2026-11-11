import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resource} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {canInspectSpring,canContactSpring} from '../src/world/spring-observation.js';
import {visibleOwnPlots} from '../src/world/crop-observation.js';
import {initializeWaterSupply,completeWaterSupply,waterReceiptId,waterSupplyReason} from '../src/world/water-supply.js';
import {initializeFrontierHazards,frontierHazardTarget,completeFrontierHazard} from '../src/world/frontier-hazards.js';
import {frontierHazardOpportunities} from '../src/server/frontier-hazard-opportunities.js';
import {planStartError,submitPlan,stepWorld} from '../src/world/engine.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {initializeIndustry} from '../src/world/industry.js';
import {findPath} from '../src/world/navigation.js';
import {parseChoice} from '../src/server/affordances.js';
import {YEAR} from '../src/world/time.js';
function fixture(){
 const w=createWorld(73),r=w.residents[0];w.mode='formal';w.scenario='frontier';w.minute=600;w.clock.paused=false;
 w.map={width:40,height:40,tiles:Array(1600).fill('grass'),entrance:{x:0,y:0},settlement:{x:20,y:20},name:'Review fixture'};
 w.residents=[r];w.buildings=[];w.plots=[];w.resources=[];w.events=[];w.graves=[];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,knownBuildings:[],knownPeople:[],knownResources:['review-spring'],inventory:{wood:4,stone:4},memories:[],activity:null,plan:null,lastFailure:null,hunger:0,energy:100,health:100,bornAt:w.minute-30*YEAR});
 const s:Resource={id:'review-spring',kind:'spring',at:{x:24,y:20},amount:9,max:9,regrowthDays:0,lastHarvest:0};w.resources=[s];
 initializeWaterSupply(w);const v={id:'review-bucket',ownerId:r.id,buildingId:null,capacity:6 as const,amount:0,quality:'safe' as const,createdAt:w.minute};w.waterSupply!.vessels.push(v);
 initializeFrontierHazards(w);w.frontierHazards!.beasts=[];w.frontierHazards!.disasters=[];
 const fill=()=>({type:'waterSupply' as const,operation:'fillSpring' as const,sourceId:s.id,vesselId:v.id,quantity:1,receiptId:waterReceiptId(w,r)});
 const clear={type:'frontierHazard' as const,operation:'clearSpring' as const,sourceId:s.id,damageId:'review-damage'};
 return {w,r,s,v,fill,clear};
}
function plan(f:ReturnType<typeof fixture>,a:Action){return {id:'review-plan',actorId:f.r.id,actorRevision:f.r.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'Inspect spring',actions:[a]};}

test('review: exact Manhattan boundary and diagonal corners; non-spring Euclidean range remains unchanged',()=>{
 const {w,r,s}=fixture();s.at={x:26,y:26};assert.equal(canInspectSpring(w,r,s),true);
 s.at={x:27,y:26};assert.equal(canInspectSpring(w,r,s),false);
 s.at={x:28,y:28};assert.equal(canInspectSpring(w,r,s),false);
 const bush:Resource={...s,id:'review-bush',kind:'bush'};w.resources.push(bush);r.knownResources.push(bush.id);
 assert.deepEqual(decisionContext(w,r).resources.map(s=>s.id),[bush.id]);
 s.at={x:21,y:21};w.map.tiles[20*40+21]='cliff';assert.equal(canInspectSpring(w,r,s),false);
});

test('review: opaque resource and reserved structure hide all spring stock and cleanup state from final prompts',()=>{
 for(const blocker of ['tree','rock','project'] as const){
  const f=fixture(),{w,r,s}=f;
  if(blocker==='project')w.construction={projects:[{id:'review-project',name:'Review wall',reserved:true,mode:'new',at:{x:22,y:20},width:1,height:1,door:{x:22,y:21},status:'completed',claims:[],stages:[],stage:0,stock:[],incorporated:{},prices:{wood:1,stone:1},account:'review-account',wagePerHour:0}],knownProjects:{},yards:{},nextSerial:1,totals:{completed:0,expanded:0,labor:0,wages:0,procurement:0,demolished:0}} as unknown as NonNullable<typeof w.construction>;
  else w.resources.push({...s,id:'occluder',kind:blocker,at:{x:22,y:20},amount:1});
  const context=structuredClone(decisionContext(w,r)),prepared=prepareModelDecision(context,undefined,GLM_MODEL);
  for(const amount of [0,1,7])for(const blocked of [false,true]){
   s.amount=amount;s.floodDamage=blocked?{disasterId:'review-damage',at:600,clearedAt:null}:undefined;
   assert.deepEqual(decisionContext(w,r),context,blocker);
   assert.deepEqual(prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),prepared,blocker);
   assert.ok(!frontierHazardOpportunities(w,r).some(c=>c.action.type==='frontierHazard'&&c.action.operation==='clearSpring'));
   assert.match(waterSupplyReason(w,r,f.fill())!,/实际看到/);
   assert.match(frontierHazardTarget(w,r,f.clear).error!,/实地核实/);
  }
 }
});

test('review: direct bucket and cleanup completions recheck visibility without spending or recording',()=>{
 const f=fixture(),{w,r,s,v}=f;r.at={x:23,y:20};
 assert.equal(waterSupplyReason(w,r,f.fill()),null);
 r.roomAt={x:1,y:1};const snapshot=()=>({inventory:{...r.inventory},amount:s.amount,bucket:v.amount,receipts:w.waterSupply!.receipts.length,events:w.events.length});
 const before=snapshot();assert.ok(completeWaterSupply(w,r,f.fill()));assert.deepEqual(snapshot(),before);
 s.floodDamage={disasterId:'review-damage',at:600,clearedAt:null};assert.ok(completeFrontierHazard(w,r,f.clear));assert.equal(s.floodDamage.clearedAt,null);assert.deepEqual(snapshot(),before);
});

test('review: transparent water blocks actual contact for all transfer paths, and impassable route remains distinct from sight',()=>{
 const f=fixture(),{w,r,s,v}=f;r.at={x:23,y:20};w.map.tiles[20*40+24]='water';
 assert.equal(canInspectSpring(w,r,s),true);assert.equal(canContactSpring(w,r,s),false);
 assert.ok(completeWaterSupply(w,r,f.fill()));assert.equal(v.amount,0);
 const a:Action={type:'gather',resourceId:s.id,quantity:1};assert.equal(submitPlan(w,plan(f,a)).ok,true);
 for(let i=0;i<20&&(r.plan||r.activity);i++)stepWorld(w,1);
 assert.ok(r.lastFailure);assert.equal(s.amount,9);assert.equal(r.inventory.water??0,0);
 s.floodDamage={disasterId:'review-damage',at:w.minute,clearedAt:null};assert.ok(completeFrontierHazard(w,r,f.clear));assert.equal(s.floodDamage.clearedAt,null);assert.equal(r.inventory.wood,4);
 // A full transparent barrier separates an otherwise usable spring from the actor.
 s.floodDamage=undefined;w.map.tiles[20*40+24]='grass';r.at={x:20,y:20};for(let y=0;y<40;y++)w.map.tiles[y*40+22]='water';
 assert.equal(canInspectSpring(w,r,s),true);assert.match(planStartError(w,plan(f,f.fill()))!,/可达/);assert.equal(s.amount,9);assert.equal(v.amount,0);
});

test('review: crop extraction preserves eight-step range, own-title requirement, and shared occlusion',()=>{
 const {w,r,s}=fixture();const p={id:'review-plot',ownerId:r.id,at:{x:28,y:20},crop:null};w.plots=[p];
 assert.deepEqual(visibleOwnPlots(w,r),[p]);p.at.x=29;assert.deepEqual(visibleOwnPlots(w,r),[]);
 p.at.x=24;s.at={...p.at};assert.deepEqual(visibleOwnPlots(w,r),[p]);
 w.map.tiles[20*40+22]='cliff';assert.deepEqual(visibleOwnPlots(w,r),[]);assert.equal(canInspectSpring(w,r,s),false);
 w.map.tiles[20*40+22]='grass';p.ownerId='other';assert.deepEqual(visibleOwnPlots(w,r),[]);assert.equal(canInspectSpring(w,r,s),true);
});

test('review: a visible fence edge cannot be used for bucket filling or cleanup; actual gate contact works',()=>{
 const f=fixture(),{w,r,s,v}=f;r.at={x:23,y:20};
 const p={id:'review-pasture',fenced:true,status:'active',tiles:[{...s.at}],gate:{inside:{...s.at},outside:{x:25,y:20}}};
 w.industry={pastures:[p],pastureProjects:[],mines:[]} as unknown as NonNullable<typeof w.industry>;
 assert.equal(canInspectSpring(w,r,s),true);assert.equal(canContactSpring(w,r,s),false);
 assert.ok(completeWaterSupply(w,r,f.fill()));assert.equal(s.amount,9);assert.equal(v.amount,0);
 s.floodDamage={disasterId:'review-damage',at:600,clearedAt:null};assert.ok(completeFrontierHazard(w,r,f.clear));assert.equal(s.floodDamage.clearedAt,null);assert.equal(r.inventory.wood,4);
 p.gate.outside={...r.at};assert.equal(canContactSpring(w,r,s),true);assert.equal(completeFrontierHazard(w,r,f.clear),null);assert.equal(r.inventory.wood,3);assert.equal(s.amount,9);
 assert.equal(completeWaterSupply(w,r,f.fill()),null);assert.equal(s.amount,8);assert.equal(v.amount,1);
});

test('review: two residents do not share spring sight or stock observations across a house',()=>{
 const {w,r,s}=fixture(),other=structuredClone(r);other.id='review-observer-behind-house';other.name='隔屋观察者';other.at={x:24,y:24};w.residents.push(other);
 w.buildings=[{...createWorld(73).buildings[0],id:'review-sight-house',at:{x:23,y:22},width:3,height:1,door:{x:23,y:23}}];
 assert.equal(canInspectSpring(w,r,s),true);assert.equal(canInspectSpring(w,other,s),false);
 const visibleBefore=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),hiddenBefore=prepareModelDecision(decisionContext(w,other),undefined,GLM_MODEL);
 const hiddenContext=structuredClone(decisionContext(w,other));
 s.amount=1;
 const visibleAfter=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),hiddenAfter=prepareModelDecision(decisionContext(w,other),undefined,GLM_MODEL);
 assert.notDeepEqual(visibleAfter.messages,visibleBefore.messages);assert.notDeepEqual(visibleAfter.choices,visibleBefore.choices);
 assert.deepEqual(decisionContext(w,other),hiddenContext);assert.deepEqual(hiddenAfter,hiddenBefore);
 assert.equal(decisionContext(w,r).resources.find(x=>x.id===s.id)?.amount,1);
 assert.ok(!decisionContext(w,other).resources.some(x=>x.id===s.id));
});


for(const operation of ['gather','fillSpring','clearSpring'] as const)test('review: final '+operation+' routes around a closed adjacent fence edge to a reachable real gate',()=>{
  const f=fixture(),{w,r,s,v}=f;r.at={x:23,y:20};initializeIndustry(w);
  w.industry!.pastures=[{id:'review-routing-pasture',barnId:'none',forage:0,capacity:1,lastMinute:w.minute,fenced:true,status:'open',tiles:[{...s.at}],gate:{inside:{...s.at},outside:{x:25,y:20}}}];
  if(operation==='clearSpring')s.floodDamage={disasterId:'review-damage',at:w.minute,clearedAt:null};
  assert.equal(canInspectSpring(w,r,s),true);assert.equal(canContactSpring(w,r,s),false);
  assert.ok(findPath(w,r.at,s.at,false), 'source is genuinely reachable through gate');
  const prepared=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),choice=prepared.choices.find(c=>operation==='gather'?c.action.type==='gather'&&c.action.resourceId===s.id:operation==='fillSpring'?c.action.type==='waterSupply'&&c.action.operation==='fillSpring':c.action.type==='frontierHazard'&&c.action.operation==='clearSpring');
  assert.ok(choice,operation+' exists in final menu');
  const action=parseChoice(JSON.stringify({choice:choice.id}),prepared.choices).actions[0];
  assert.equal(submitPlan(w,plan(f,action)).ok,true);
  for(let tick=0;tick<200&&(r.plan||r.activity);tick++)stepWorld(w,1);
  assert.equal(r.lastFailure,null,operation+' must use the reachable gate, not fail on the closed adjacent edge');
  if(operation==='gather')assert.equal(r.inventory.water,3);
  else if(operation==='fillSpring')assert.equal(v.amount,3);
  else assert.notEqual(s.floodDamage!.clearedAt,null);
});

for(const operation of ['gather','fillSpring','clearSpring'] as const)test('review: '+operation+' cannot complete if its legal gate closes during work',()=>{
 const f=fixture(),{w,r,s,v}=f;r.at={x:23,y:20};initializeIndustry(w);
 const pasture={id:'review-closing-gate',barnId:'none',forage:0,capacity:1,lastMinute:w.minute,fenced:true,status:'open' as const,tiles:[{...s.at}],gate:{inside:{...s.at},outside:{...r.at}}};w.industry!.pastures=[pasture];
 if(operation==='clearSpring')s.floodDamage={disasterId:'review-damage',at:w.minute,clearedAt:null};
 const prepared=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),choice=prepared.choices.find(c=>operation==='gather'?c.action.type==='gather'&&c.action.resourceId===s.id:operation==='fillSpring'?c.action.type==='waterSupply'&&c.action.operation==='fillSpring':c.action.type==='frontierHazard'&&c.action.operation==='clearSpring');
 assert.ok(choice);const action=parseChoice(JSON.stringify({choice:choice.id}),prepared.choices).actions[0];
 assert.equal(submitPlan(w,plan(f,action)).ok,true);stepWorld(w,1);assert.ok(r.activity);assert.equal(r.activity.path.length,0);
 pasture.gate.outside={x:25,y:20};assert.equal(canContactSpring(w,r,s),false);
 for(let tick=0;tick<200&&(r.plan||r.activity);tick++)stepWorld(w,1);
 assert.ok(r.lastFailure);assert.equal(s.amount,9);assert.equal(v.amount,0);assert.equal(r.inventory.water??0,0);assert.equal(r.inventory.wood,4);assert.equal(r.inventory.stone,4);assert.equal(w.waterSupply!.receipts.length,0);
 if(operation==='clearSpring')assert.equal(s.floodDamage!.clearedAt,null);
});
