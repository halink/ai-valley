import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {ageAllowsAction} from '../src/world/family.js';
import {industryTarget} from '../src/world/industry.js';
import {ageYears,DAY,YEAR,gameMinutesFromWall,FORMAL_DAY_MINUTES} from '../src/world/time.js';
import {ageMortalityDue,recordDeath} from '../src/world/life.js';

function born(bornAt:number,step=.25){
 const w=createFrontierWorld(5401);w.clock.paused=false;
 const [parent,other]=w.residents;
 w.minute=bornAt-step;
 for(const r of w.residents){r.hunger=0;r.health=r.energy=100;r.plan=null;r.activity=null;}
 parent.pregnancy={otherParentId:other.id,conceivedAt:w.minute-100,dueAt:bornAt,definition:'life/basic@1'};
 const count=w.residents.length;stepWorld(w,step);
 assert.equal(w.residents.length,count+1);
 const child=w.residents.at(-1)!;
 assert.equal(child.bornAt,bornAt);assert.equal(child.canDecide,false);assert.equal(child.canExpress,false);
 assert.ok(w.events.some(e=>e.kind==='birth'&&e.actors.includes(child.id)));
 return {w,child,parent};
}
function reload(w:World){const store=new WorldStore(':memory:');try{store.commit(w,null);return store.load()!;}finally{store.close();}}
function jump(w:World,child:Resident,minute:number){
 w.minute=minute;child.hunger=0;child.health=child.energy=100;
 // Time is placed near a later birthday, not simulated without food for years.
 // Only the child's real engine steps and recorded birth date are under test.
 w.residents=[child];w.migration=undefined;w.frontierHazards=undefined;
 w.industry!.trees=[];w.industry!.animals=[];
}
function select(w:World,r:Resident,predicate:(a:Action)=>boolean){
 const choices=decisionChoices(decisionContext(w,r)),choice=choices.find(c=>predicate(c.action));
 assert.ok(choice,'permission must reach the actual numbered menu');
 return parseChoice(JSON.stringify({choice:choice.id,...(choice.action.type==='wait'?{minutes:1}:{})}),choices).actions[0];
}
function run(w:World,r:Resident,action:Action,minutes:number){
 const result=submitPlan(w,{id:`fractional-age:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'独立选择生日后的行动',actions:[action]});
 assert.ok(result.ok,result.error);stepWorld(w,minutes);assert.equal(r.lastFailure,null);
}

for(const [years,birthMinute] of [[6,121440.001],[13,512.002],[18,1291264.008]] as const){
 for(const dt of [.25,gameMinutesFromWall(1000,FORMAL_DAY_MINUTES)])test(`real fractional birth reaches ${years} at its birthday with ${dt} minute steps and SQLite`,()=>{
  let {w,child}=born(birthMinute,dt);
  const birthday=child.bornAt+years*YEAR;
  assert.ok((birthday-child.bornAt)/YEAR<years,'fixture exposes subtraction rounding');
  // First activate six-year-old before testing later milestones, using engine-owned capabilities.
  if(years>6){jump(w,child,child.bornAt+6*YEAR-.25);stepWorld(w,.25);assert.equal(child.canDecide,true);}
  jump(w,child,birthday-dt-.25);stepWorld(w,dt);
  assert.ok(w.minute<birthday);assert.ok(ageYears(child.bornAt,w.minute)<years);
  assert.equal(child.lifeStage,years===6?'infant':years===13?'child':'teen');
  assert.ok(child.guardianIds.length);
  if(years===6){assert.equal(child.canDecide,false);assert.equal(ageAllowsAction(w,child,{type:'wait',minutes:1}),false);}
  if(years===13){child.inventory.rodKit=1;assert.ok(industryTarget(w,child,{type:'industry',operation:'equip',tool:'rod'}).error);}
  if(years===18){child.inventory.axeKit=1;assert.equal(ageAllowsAction(w,child,{type:'build',kind:'home',at:child.at}),false);}
  const birth=child.bornAt;w=reload(w);child=w.residents.find(r=>r.id===child.id)!;assert.equal(child.bornAt,birth);
  stepWorld(w,birthday-w.minute);assert.equal(w.minute,birthday);assert.equal(ageYears(child.bornAt,w.minute),years);
  assert.equal(child.lifeStage,years===6?'child':years===13?'teen':'adult');
  assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
  assert.equal(decisionContext(w,child).formal!.age,years);
  const transitions=()=>w.events.filter(e=>e.actors[0]===child.id&&e.text.includes('进入')&&e.at===birthday);
  assert.equal(transitions().length,1);
  if(years===6){assert.equal(child.decisionDue,birthday);run(w,child,select(w,child,a=>a.type==='wait'),.25);}
  if(years===13){
   const equip={type:'industry',operation:'equip',tool:'rod'} as const;
   assert.equal(industryTarget(w,child,equip).error,undefined);
   assert.ok(industryOpportunities(w,child).some(c=>c.action.type==='industry'&&c.action.operation==='equip'&&c.action.tool==='rod'));
   run(w,child,select(w,child,a=>a.type==='industry'&&a.operation==='equip'&&a.tool==='rod'),14.75);
   assert.equal(w.industry!.tools.some(t=>t.ownerId===child.id&&t.kind==='rod'),false);
   stepWorld(w,.25);assert.ok(w.industry!.tools.some(t=>t.ownerId===child.id&&t.kind==='rod'));assert.equal(child.inventory.rodKit,0);
  }
  if(years===18){
   assert.deepEqual(child.guardianIds,[]);assert.equal(ageAllowsAction(w,child,{type:'build',kind:'home',at:child.at}),true);
   run(w,child,select(w,child,a=>a.type==='industry'&&a.operation==='equip'&&a.tool==='axe'),15);
   assert.ok(w.industry!.tools.some(t=>t.ownerId===child.id&&t.kind==='axe'));assert.equal(child.inventory.axeKit,0);
  }
  w=reload(w);child=w.residents.find(r=>r.id===child.id)!;stepWorld(w,.25);
  assert.equal(transitions().length,1,'reload and another step cannot duplicate the transition');
  if(years===18){assert.deepEqual(child.guardianIds,[]);assert.equal(w.events.filter(e=>e.populationChange==='adult'&&e.actors[0]===child.id).length,1);}
 });
}

test('birthday comparison does not move the world clock or daily mortality/death ledger boundaries',()=>{
 const {w,child}=born(121440.001),birthday=child.bornAt+6*YEAR;
 jump(w,child,birthday-.25);const before=w.minute;w.clock.paused=true;stepWorld(w,.25);
 assert.equal(w.minute,before);assert.equal(child.canDecide,false);
 w.clock.paused=false;stepWorld(w,.25);assert.equal(w.minute,birthday);
 assert.equal(ageMortalityDue(w.seed,child,DAY-.25,DAY),false);
 const deathAt=w.minute;assert.equal(recordDeath(w,child),true);assert.equal(recordDeath(w,child),false);
 const saved=reload(w),dead=saved.residents[0];stepWorld(saved,.25);
 assert.equal(dead.deathAt,deathAt);assert.equal(saved.estates.filter(e=>e.personId===child.id).length,1);
 assert.equal(saved.events.filter(e=>e.kind==='death'&&e.actors[0]===child.id).length,1);
});

test('invalid stored birth dates cannot reach adult engine or industry permissions despite stale capabilities',()=>{
 const {w,child}=born(121440.001);child.canDecide=child.canExpress=true;child.inventory={axeKit:1};
 const build:Action={type:'build',kind:'home',at:{...child.at}};
 for(const value of [NaN,Infinity,-Infinity,null,undefined,'0',-Number.MAX_VALUE,w.minute+1]){
  child.bornAt=value as number;
  assert.equal(ageAllowsAction(w,child,build),false,String(value));
  assert.ok(industryTarget(w,child,{type:'industry',operation:'equip',tool:'axe'}).error,String(value));
  assert.deepEqual(industryOpportunities(w,child),[],String(value));
  assert.equal(decisionContext(w,child).formal!.age,0,String(value));
 }
});
