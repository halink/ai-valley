import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {initializeFood} from '../src/world/food.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {harvestMealEvidence,harvestMealRelevant,restoreHarvestMeal} from '../src/server/harvest-food-choices.js';
import {DAY,YEAR} from '../src/world/time.js';
import {captureDirectEating,directEatingOriginalInputs} from '../src/world/food-consumption-evidence.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {TestContext} from 'node:test';

function observeForecastCopies(t:TestContext){
 const original=globalThis.structuredClone,copies:World[]=[];
 t.mock.method(globalThis,'structuredClone',((value:unknown,options?:StructuredSerializeOptions)=>{
  const copy=original(value,options);
  if(value&&typeof value==='object'&&'residents'in value&&'map'in value&&'minute'in value)copies.push(copy as World);
  return copy;
 }) as typeof structuredClone);
 return copies;
}

function fixture(){
 const w=createFrontierWorld(5401);w.clock.paused=false;stepWorld(w,.001);w.minute=480;
 const r=w.residents.find(r=>r.id==='founder-2-1')!,p=w.plots.find(p=>p.ownerId===r.id)!;
 Object.assign(r,{at:{...p.at},inside:null,roomAt:null,hunger:98,health:2.7,energy:80,inventory:{water:2,seed:3},decisionDue:w.minute,
  agency:{focus:'daily',goals:[],routines:[],nextSerial:1}});
 p.crop={definition:'crop/turnip@2',planted:0,growth:4,wateredDay:-1,lastGrowthDay:0};initializeFood(w);
 return {w,r,p};
}
function twoCrops(){
 const result=fixture(),{w,r,p}=result;r.health=10;p.crop!.definition='crop/turnip@1';
 const other=w.plots.find(plot=>plot.ownerId===r.id&&plot.id!==p.id)!;
 other.crop={definition:'crop/turnip@2',planted:0,growth:4,wateredDay:-1,lastGrowthDay:0};
 return {...result,other};
}
function select(w:World,r:Resident,a:Action,id:string){
 assert.equal(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'离线明确选择',actions:[a]}).ok,true);
 let remaining=120;while(r.plan||r.activity){assert.ok(remaining-->0);stepWorld(w,1);}
 assert.equal(r.lastFailure,null);
}

test('default nine-person final menu retains a timely harvest despite a nonfarming focus, without choosing it',()=>{
 const {w,r,p}=fixture(),before=structuredClone(w),c=decisionContext(w,r),raw=buildChoices(c),menu=decisionChoices(c);
 assert.ok(raw.some(c=>c.action.type==='harvest'&&c.action.plotId===p.id));
 assert.equal(hasTimelySelfRescue(w,r,raw.map(c=>c.action)),true);
 assert.ok(menu.some(c=>c.action.type==='harvest'&&c.action.plotId===p.id),'the available harvest must survive the final focus budget');
 assert.equal(hasTimelySelfRescue(w,r,menu.map(c=>c.action)),true);
 assert.deepEqual(w,before);assert.equal(r.plan,null);assert.equal(r.inventory.turnip,undefined);
 const choice=menu.find(c=>c.action.type==='harvest')!;
 select(w,r,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0],'harvest-explicit');
 assert.equal(r.inventory.turnip,12);assert.ok(r.hunger>98);assert.equal(r.plan,null);
 const meals=decisionChoices(decisionContext(w,r)),eat=meals.find(c=>c.action.type==='eat'&&c.action.item==='turnip')!;
 select(w,r,parseChoice(JSON.stringify({choice:eat.id}),meals).actions[0],'eat-explicit');
 assert.equal(r.inventory.turnip,11);assert.equal(r.status,'alive');assert.ok(r.hunger<95);
});

test('saturated ordinary agenda retains harvest without expanding its budget or replacing existing safety and withdrawal choices',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);
 const extra:ActionChoice[]=[{id:'review-decline',label:'Decline',action:{type:'respond',proposalId:'review',accept:false}},
  {id:'review-emergency',label:'Emergency care',action:{type:'emergencyCare',operation:'rescueMeal'}}];
 extra.push(...Array.from({length:70},(_,i):ActionChoice=>({id:'review-draw-'+i,label:'Ordinary design '+i,action:{type:'design',operation:'draw',buildingId:String(i),kind:'building'}})));
 c.formal!.opportunities.push(...extra);
 const ordinary=structuredClone(c);delete ordinary.formal!.harvestMeals;
 const baseline=decisionChoices(ordinary),menu=decisionChoices(c);
 assert.ok(menu.some(c=>c.action.type==='harvest'));
 assert.ok(menu.some(c=>c.label==='Decline'));assert.ok(menu.some(c=>c.label==='Emergency care'));
 assert.ok(menu.some(c=>c.action.type==='sleep'));assert.ok(menu.some(c=>c.action.type==='wait'));
 assert.equal(menu.length,baseline.length,'harvest replaces an ordinary row, without adding a menu slot');
});

test('synthetic SQLite close and reopen preserves the same independently selectable harvest and original food state',t=>{
 const {w,r}=fixture(),directory=mkdtempSync(join(testTmpdir(),'harvest-food-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=join(directory,'synthetic.sqlite');
 const store=new WorldStore(file);store.commit(w,null);store.close();
 const reopened=new WorldStore(file);t.after(()=>reopened.close());const loaded=reopened.loadForRuntime()!,person=loaded.residents.find(p=>p.id===r.id)!;
 const before=structuredClone(loaded),menu=decisionChoices(decisionContext(loaded,person));
 assert.ok(menu.some(c=>c.action.type==='harvest'));assert.equal(hasTimelySelfRescue(loaded,person,menu.map(c=>c.action)),true);
 assert.deepEqual(loaded,before);assert.equal(person.inventory.turnip,undefined);
 assert.equal(loaded.plots.find(p=>p.ownerId===person.id)!.crop!.growth,4);
});

for(const condition of ['unreachable','too-late','nonfood','spoils','no-nutrition','too-little-nutrition','immature','not-owned'] as const){
 test(`harvest retention proves a real meal, excluding ${condition}`,()=>{
  const {w,r,p}=fixture();
  if(condition==='unreachable'){r.at={x:p.at.x-1,y:p.at.y};w.map.tiles[r.at.y*w.map.width+r.at.x]='grass';w.map.tiles[p.at.y*w.map.width+p.at.x]='water';}
  if(condition==='too-late')r.health=.2;
  if(condition==='nonfood'){p.crop!.definition='crop/flax@1';p.crop!.growth=5;}
  if(condition==='spoils')(w.definitions['food/life@1'].data.days as Record<string,number>).turnip=1/DAY;
  if(condition==='no-nutrition'||condition==='too-little-nutrition')(w.definitions['food/life@1'].data.nutrition as Record<string,number>).turnip=condition==='no-nutrition'?0:.1;
  if(condition==='immature')p.crop!.growth=3;
  if(condition==='not-owned')p.ownerId=w.residents[0].id;
  const before=structuredClone(w),c=decisionContext(w,r);
  assert.ok(!c.formal?.harvestMeals?.plots.length,condition);assert.deepEqual(w,before);
 });
}

test('timely candidates use actual completion time then plot identity, independent of candidate ordering',()=>{
 const {w,r,p}=fixture();r.health=10;p.crop!.definition='crop/turnip@1';
 const other=w.plots.find(plot=>plot.ownerId===r.id&&plot.id!==p.id)!;assert.ok(other);
 other.crop={definition:'crop/turnip@2',planted:0,growth:4,wateredDay:-1,lastGrowthDay:0};
 const c=decisionContext(w,r),all=buildChoices(c),evidence=harvestMealEvidence(w,r,c,all)!;
 assert.equal(evidence.plots.length,2);assert.deepEqual(harvestMealEvidence(w,r,c,[...all].reverse()),evidence);
 assert.equal(evidence.plots[0].plotId,p.id);assert.ok(evidence.plots[0].minutes<evidence.plots[1].minutes);
 const rows=all.filter(c=>c.action.type!=='harvest').slice(0,2),withEvidence=structuredClone(c);withEvidence.formal!.harvestMeals=evidence;
 const result=restoreHarvestMeal(withEvidence,all,rows,56);assert.equal(result.at(-1)!.action.type,'harvest');
 assert.deepEqual(result.at(-1)!.action,{type:'harvest',plotId:p.id});
 const tied=structuredClone(withEvidence);tied.formal!.harvestMeals!.plots=evidence.plots.map(p=>({...p,minutes:20})).reverse();
 assert.deepEqual(restoreHarvestMeal(tied,[...all].reverse(),rows,56).at(-1)!.action,{type:'harvest',plotId:[p.id,other.id].sort()[0]});
});

test('a completely protected 56-row agenda stays unchanged rather than trading away any safety or refusal',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r),all=buildChoices(c);
 const protectedRows:ActionChoice[]=Array.from({length:56},(_,i)=>({id:'protected-'+i,label:'Decline '+i,action:{type:'respond',proposalId:String(i),accept:false}}));
 assert.equal(restoreHarvestMeal(c,all,protectedRows,56),protectedRows);
 const oneReflection:ActionChoice={id:'one-reflection',label:'Change goal',action:{type:'agency',operation:'reflect',focus:'daily'}};
 const single=[...protectedRows.slice(0,55),oneReflection];assert.equal(restoreHarvestMeal(c,all,single,56),single);
});

test('retention never restores harvest through age, journey, expression or stale snapshot gates',()=>{
 const {w,r}=fixture(),original=decisionContext(w,r);assert.ok(original.formal!.harvestMeals!.plots.length);
 for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','aboard','passenger','familyTravelling'] as const){
  const c=structuredClone(original);c.formal![flag]=true;assert.ok(!decisionChoices(c).some(c=>c.action.type==='harvest'),flag);
 }
 for(const age of [5,17,null]){
  r.bornAt=age===null?NaN:w.minute-age*YEAR;const c=decisionContext(w,r);
  assert.ok(!c.formal!.harvestMeals?.plots.length);assert.ok(!decisionChoices(c).some(c=>c.action.type==='harvest'));
 }
 const stale=structuredClone(original);stale.minute++;const baseline=structuredClone(stale);delete baseline.formal!.harvestMeals;
 assert.deepEqual(decisionChoices(stale),decisionChoices(baseline));
});

test('a mature original crop stays harvestable across a season boundary without reinterpreting its definition',()=>{
 const {w,r,p}=fixture();w.minute=28*DAY+480;r.decisionDue=w.minute;
 // No elapsed world time is claimed: this is an explicitly mature summer snapshot.
 p.crop!.growth=4;w.activeDefinitions['crop/turnip']='crop/winter-root@1';
 const before=structuredClone(w),c=decisionContext(w,r);assert.equal(c.season,'summer');
 assert.ok(c.formal!.harvestMeals?.plots.some(row=>row.plotId===p.id));assert.deepEqual(w,before);
});

test('a separate imminent care meal cannot turn insufficient harvested nutrition into an independent rescue',()=>{
 const {w,r}=fixture();r.health=10;
 (w.definitions['food/life@1'].data.nutrition as Record<string,number>).turnip=.1;
 const provider=w.residents[0];Object.assign(provider,{at:{x:r.at.x-1,y:r.at.y},inside:null,roomAt:null,inventory:{meal:2,water:2},knownPeople:[r.id],plan:null,activity:null});provider.skills.care=2;
 w.proposals.push({id:'review-care',actorId:provider.id,targetId:r.id,kind:'care',createdAt:w.minute,expiresAt:w.minute+100,status:'accepted',definition:'action/routine@1'});
 initializeFood(w);
 assert.equal(submitPlan(w,{id:'review-provider',actorId:provider.id,actorRevision:provider.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Existing consented care',actions:[{type:'care',targetId:r.id,proposalId:'review-care'}]}).ok,true);
 stepWorld(w,1);assert.equal(provider.activity!.action.type,'care');provider.activity!.remaining=1;
 const before=structuredClone(w),c=decisionContext(w,r);assert.deepEqual(c.formal!.harvestMeals?.plots,[]);assert.deepEqual(w,before);
});

test('a high-nutrition old same-item portion cannot stand in for the new harvested batch',()=>{
 const {w,r}=fixture();r.health=10;r.inventory.turnip=1;initializeFood(w);
 const old={...w.definitions['food/life@1'],version:80,data:{...w.definitions['food/life@1'].data,nutrition:{turnip:20}}};
 w.definitions['food/life@80']=old;w.food!.lots['person:'+r.id].turnip=[{quantity:1,producedAt:w.minute-10,expiresAt:w.minute+100,definition:'food/life@80'}];
 (w.definitions['food/life@1'].data.nutrition as Record<string,number>).turnip=.1;
 const before=structuredClone(w),c=decisionContext(w,r);assert.deepEqual(c.formal!.harvestMeals?.plots,[]);assert.deepEqual(w,before);
 assert.ok(decisionChoices(c).some(c=>c.action.type==='eat'&&c.action.item==='turnip'),'ordinary own eating is unchanged');
});

test('exact consumption evidence follows FIFO expiry during the eating action',()=>{
 const {w,r,p}=fixture();r.health=10;r.inventory.turnip=1;initializeFood(w);
 w.food!.lots['person:'+r.id].turnip=[{quantity:1,producedAt:w.minute-10,expiresAt:w.minute+12,definition:'food/life@1'}];
 const before=structuredClone(w),c=decisionContext(w,r);
 assert.ok(c.formal!.harvestMeals?.plots.some(proof=>proof.plotId===p.id),'the old portion expires before completion, so actual eating uses new harvest');
 assert.deepEqual(w,before);
});

test('a harvested item outside the next four own-food choices is not falsely promised as an immediate meal',()=>{
 const {w,r}=fixture();w.minute=510;r.health=10;r.inventory={water:2,seed:3,berry:1,meal:1,egg:1,milk:1};initializeFood(w);
 const before=structuredClone(w),c=decisionContext(w,r);assert.deepEqual(c.formal!.harvestMeals?.plots,[]);assert.deepEqual(w,before);
});

test('direct meal original-lot proof is transient, exact and detached from both the receipt JSON and its readers',()=>{
 const {w,r}=fixture();r.inventory.turnip=2;initializeFood(w);
 const original=structuredClone(w.food!.lots['person:'+r.id].turnip![0]);
 const observation=captureDirectEating(w,()=>select(w,r,{type:'eat',item:'turnip'},'original-input-test'));
 const receipt=observation.receipts[0],inputs=directEatingOriginalInputs(receipt)!;
 assert.deepEqual(inputs,[{item:'turnip',quantity:1,nutrition:20,lots:[{...original,quantity:1,nutrition:20}]}]);
 inputs[0].lots![0].quantity=99;assert.equal(directEatingOriginalInputs(receipt)![0].lots![0].quantity,1);
 assert.equal(Object.hasOwn(receipt,'inputs'),false);assert.equal(directEatingOriginalInputs(structuredClone(receipt)),undefined);
 assert.ok(!JSON.stringify(w).includes('harvestMeals'));assert.ok(!JSON.stringify(w).includes('directInputs'));
});

for(const change of ['owner','maturity','route'] as const)test(`retained but stale harvest still revalidates ${change} during real execution`,()=>{
 const {w,r,p}=fixture();r.at={x:p.at.x-1,y:p.at.y};w.map.tiles[r.at.y*w.map.width+r.at.x]='grass';
 const c=decisionContext(w,r),menu=decisionChoices(c),choice=menu.find(choice=>choice.action.type==='harvest')!;assert.ok(choice);
 if(change==='owner')p.ownerId=w.residents[0].id;
 if(change==='maturity')p.crop!.growth=0;
 if(change==='route')w.map.tiles[p.at.y*w.map.width+p.at.x]='water';
 const inventory=structuredClone(r.inventory),action=parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];
 assert.equal(submitPlan(w,{id:'stale-'+change,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Explicit stale selection',actions:[action]}).ok,true);
 stepWorld(w,1);assert.ok(r.lastFailure);assert.deepEqual(r.inventory,inventory);assert.equal(r.plan,null);assert.equal(r.activity,null);
});

test('a mature food harvest already in the final menu needs no speculative world copies',t=>{
 const {w,r,p}=fixture();r.agency!.focus='farming';
 const before=structuredClone(w),copies=observeForecastCopies(t),c=decisionContext(w,r),menu=decisionChoices(c);
 assert.ok(menu.some(choice=>choice.action.type==='harvest'&&choice.action.plotId===p.id));
 assert.equal(copies.length,0,'visible harvest must not pay for a speculative world');
 assert.deepEqual(w,before);
});

test('cheap negative harvest checks short-circuit before inspecting plots or building candidates',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);
 Object.defineProperty(c,'plots',{get:()=>{throw new Error('unneeded_candidate_scan');}});
 assert.equal(submitPlan(w,{id:'already-busy',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Existing choice',actions:[{type:'wait',minutes:15}]}).ok,true);
 assert.equal(harvestMealRelevant(w,r,c),false);
 stepWorld(w,1);assert.ok(r.activity);r.plan=null;assert.equal(harvestMealRelevant(w,r,c),false);
 r.activity=null;c.actor.hunger=20;c.formal!.foodCoverage!.lowFood=false;
 assert.equal(harvestMealRelevant(w,r,c),false);
});

for(const condition of ['not-hungry','already-busy','immature','nonfood','not-owned'] as const)test(`no harvest forecast for the cheap negative case ${condition}`,t=>{
 const {w,r,p}=fixture();
 if(condition==='not-hungry'){r.hunger=20;r.inventory.meal=20;initializeFood(w);}
 if(condition==='already-busy')assert.equal(submitPlan(w,{id:'busy',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Existing choice',actions:[{type:'wait',minutes:15}]}).ok,true);
 if(condition==='immature')p.crop!.growth=0;
 if(condition==='nonfood'){p.crop!.definition='crop/flax@1';p.crop!.growth=5;}
 if(condition==='not-owned')p.ownerId=w.residents[0].id;
 const before=structuredClone(w),copies=observeForecastCopies(t),c=decisionContext(w,r);
 if(condition==='not-hungry')assert.equal(c.formal!.foodCoverage!.lowFood,false);
 assert.equal(copies.length,0);assert.equal(c.formal!.harvestMeals,undefined);assert.deepEqual(w,before);
});

for(const visibleValid of [false,true])test(`mixed candidates preserve the eager proof when the visible harvest is ${visibleValid?'valid but slower':'invalid'}`,()=>{
 const {w,r,p,other}=twoCrops();
 if(!visibleValid)w.map.tiles[other.at.y*w.map.width+other.at.x]='water';
 const before=structuredClone(w),c=decisionContext(w,r);delete c.formal!.harvestMeals;
 const all=buildChoices(c),visible=[all.find(choice=>choice.action.type==='harvest'&&choice.action.plotId===other.id)!];assert.ok(visible[0]);
 const eager=harvestMealEvidence(w,r,c,all)!,lazy=harvestMealEvidence(w,r,c,all,visible)!;
 assert.deepEqual(lazy,eager);assert.equal(lazy.plots[0].plotId,p.id);
 c.formal!.harvestMeals=lazy;const result=restoreHarvestMeal(c,all,visible,56);
 if(visibleValid){assert.equal(lazy.plots.length,2);assert.ok(lazy.plots[0].minutes<lazy.plots[1].minutes);assert.equal(result,visible);}
 else {assert.equal(lazy.plots.length,1);assert.deepEqual(result.at(-1)!.action,{type:'harvest',plotId:p.id});}
 assert.deepEqual(w,before);
});

for(const visibleValid of [false,true])test(`the public context entry preserves a mixed menu whose visible harvest is ${visibleValid?'slower but valid':'unreachable'}`,()=>{
 const {w,r,p,other}=twoCrops();r.at={...other.at};w.minute=600;
 if(!visibleValid)w.map.tiles[p.at.y*w.map.width+p.at.x]='water';
 const before=structuredClone(w),c=decisionContext(w,r),ordinary=structuredClone(c);delete ordinary.formal!.harvestMeals;
 const baseline=decisionChoices(ordinary);
 assert.ok(baseline.some(choice=>choice.action.type==='harvest'&&choice.action.plotId===p.id));
 assert.ok(!baseline.some(choice=>choice.action.type==='harvest'&&choice.action.plotId===other.id));
 assert.deepEqual(c.formal!.harvestMeals?.plots.map(proof=>proof.plotId),visibleValid?[other.id,p.id]:[other.id]);
 const menu=decisionChoices(c);
 if(visibleValid)assert.deepEqual(menu,baseline);
 else assert.ok(menu.some(choice=>choice.action.type==='harvest'&&choice.action.plotId===other.id));
 assert.deepEqual(w,before);
});

for(const condition of ['missing','visible','two-with-missing','two-visible','too-late','rounded-hunger','low-food','not-hungry','next-food-menu','saturated'] as const)test(`lazy final menu matches the eager forecast reference for ${condition}`,()=>{
 const {w,r,p,other}=twoCrops();
 if(!condition.startsWith('two-')){other.crop=null;p.crop!.definition='crop/turnip@2';}
 if(condition==='visible'||condition==='two-visible')r.agency!.focus='farming';
 if(condition==='too-late')r.health=.2;
 if(condition==='rounded-hunger'){r.hunger=79.6;r.inventory.meal=20;initializeFood(w);}
 if(condition==='low-food')r.hunger=20;
 if(condition==='not-hungry'){r.hunger=20;r.inventory.meal=20;initializeFood(w);}
 if(condition==='next-food-menu'){w.minute=510;r.inventory={water:2,seed:3,berry:1,meal:1,egg:1,milk:1};initializeFood(w);}
 const before=structuredClone(w),lazy=decisionContext(w,r);
 if(condition==='saturated'){
  // Construct the artificial agenda BEFORE either forecast. Adding options
  // after a snapshot was prepared is not the same input for a differential.
  lazy.formal!.opportunities.push(...Array.from({length:70},(_,i):ActionChoice=>({id:'saturated-'+i,label:'Ordinary draw '+i,action:{type:'design',operation:'draw',buildingId:String(i),kind:'building'}})));
  delete lazy.formal!.harvestMeals;
  const all=buildChoices(lazy),proof=harvestMealEvidence(w,r,lazy,all,decisionChoices(lazy));if(proof)lazy.formal!.harvestMeals=proof;
 }
 const eager=structuredClone(lazy);delete eager.formal!.harvestMeals;
 const proof=harvestMealEvidence(w,r,eager,buildChoices(eager));if(proof)eager.formal!.harvestMeals=proof;
 const actual=decisionChoices(lazy);assert.deepEqual(actual,decisionChoices(eager));assert.deepEqual(w,before);
 if(['missing','two-with-missing','saturated','rounded-hunger','low-food'].includes(condition))assert.ok(lazy.formal!.harvestMeals?.plots.length);
 if(condition==='visible'||condition==='two-visible'){
  assert.equal(lazy.formal!.harvestMeals,undefined);assert.ok(actual.some(c=>c.action.type==='harvest'&&c.action.plotId===p.id));
  if(condition==='two-visible')assert.ok(actual.some(c=>c.action.type==='harvest'&&c.action.plotId===other.id));
 }
});

test('synthetic population evidence isolates skipped forecast work without a wall-clock threshold',t=>{
 const copies=observeForecastCopies(t);
 for(const population of [9,90])for(const visible of [true,false]){
  const {w,r}=twoCrops();
  while(w.residents.length<population){
   const person=structuredClone(w.residents[0]),id='synthetic-load-'+w.residents.length;
   Object.assign(person,{id,name:id,homeId:null,inside:null,roomAt:null,plan:null,activity:null,inventory:{water:2},hunger:20,energy:80,health:90,memories:[],relations:[],knownPeople:[],knownBuildings:[],knownResources:[],decisionDue:w.minute+1000});
   w.residents.push(person);
  }
  initializeFood(w);r.agency!.focus=visible?'farming':'daily';
  const before=structuredClone(w),start=performance.now(),copyStart=copies.length,c=decisionContext(w,r),menu=decisionChoices(c),contextMs=performance.now()-start;
  const actualCopies=copies.slice(copyStart),actualMinutes=actualCopies.reduce((sum,copy)=>sum+copy.minute-w.minute,0);
  assert.equal(actualCopies.length,visible?0:2);assert.ok(actualMinutes<=120);
  delete c.formal!.harvestMeals;const all=buildChoices(c),ordinary=decisionChoices(c);
  const eagerStart=performance.now(),eagerCopyStart=copies.length,eager=harvestMealEvidence(w,r,c,all),eagerMs=performance.now()-eagerStart;
  const eagerCopies=copies.slice(eagerCopyStart);assert.equal(eagerCopies.length,2);
  const lazyStart=performance.now(),lazyCopyStart=copies.length,lazy=harvestMealEvidence(w,r,c,all,ordinary),lazyMs=performance.now()-lazyStart;
  assert.equal(copies.length-lazyCopyStart,visible?0:2);
  if(!visible)assert.deepEqual(lazy,eager);
  if(eager)c.formal!.harvestMeals=eager;assert.deepEqual(menu,decisionChoices(c));assert.deepEqual(w,before);
  t.diagnostic(JSON.stringify({population,visible,contextMs:Number(contextMs.toFixed(2)),actualCopies:actualCopies.length,actualMinutes,eagerForecastMs:Number(eagerMs.toFixed(2)),lazyForecastMs:Number(lazyMs.toFixed(2)),eagerCopies:eagerCopies.length,lazyCopies:copies.length-lazyCopyStart}));
 }
});
