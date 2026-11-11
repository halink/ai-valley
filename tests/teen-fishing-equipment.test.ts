import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {WorldStore} from '../src/server/store.js';
import type {IndustryAction} from '../src/shared/industry.js';
import type {Resident,World} from '../src/shared/types.js';
import {completeEducation,educationTarget,initializeEducation} from '../src/world/education.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {ageAllowsChoice} from '../src/world/family.js';
import {fishingMinutes,fishingStockAt} from '../src/world/fishing.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {industryTarget} from '../src/world/industry.js';
import {YEAR} from '../src/world/time.js';

const equip:IndustryAction={type:'industry',operation:'equip',tool:'rod'};
function fixture(age=13){
 const w=createFrontierWorld(5401),r=w.residents.find(p=>p.id==='founder-3-2')!;
 w.clock.paused=false;r.bornAt=w.minute-age*YEAR;r.health=r.energy=100;r.hunger=0;
 w.industry!.tools=w.industry!.tools.filter(t=>t.ownerId!==r.id);
 r.inventory.rodKit=1;
 return {w,r};
}
function choice(w:World,r:Resident,operation:'equip'|'fish'){
 const choices=decisionChoices(decisionContext(w,r));
 const c=choices.find(c=>c.action.type==='industry'&&c.action.operation===operation);
 assert.ok(c,`${operation} must reach the actual numbered menu`);
 assert.match(c.id,/^\d+$/);
 return parseChoice(JSON.stringify({choice:c.id}),choices).actions[0] as IndustryAction;
}
function plan(w:World,r:Resident,action:IndustryAction){
 return {id:`teen-fishing:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,
  createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择使用自己的钓具',actions:[action]};
}
function begin(w:World,r:Resident,action:IndustryAction){
 const p=plan(w,r,action),result=submitPlan(w,p);assert.ok(result.ok,result.error);return p;
}
function finish(w:World,r:Resident,success=true){
 let guard=200;while(r.activity||r.plan){assert.ok(guard-->0);stepWorld(w,1);}
 if(success)assert.equal(r.lastFailure,null);else assert.ok(r.lastFailure);
}
function rods(w:World,r:Resident){return w.industry!.tools.filter(t=>t.ownerId===r.id&&t.kind==='rod'&&!t.location);}

for(const age of [13,17])test(`${age}-year-old selects a numbered own-kit equip, works 15 minutes, then separately chooses and completes fishing`,()=>{
 const {w,r}=fixture(age),start={...r.at},openingKit=r.inventory.rodKit;
 assert.equal(industryOpportunities(w,r).some(c=>c.action.type==='industry'&&c.action.operation==='fish'),false);
 const action=choice(w,r,'equip');
 assert.equal(r.plan,null);assert.equal(rods(w,r).length,0);assert.equal(r.inventory.rodKit,openingKit);
 begin(w,r,action);stepWorld(w,14.75);
 assert.equal(rods(w,r).length,0);assert.equal(r.inventory.rodKit,openingKit);
 stepWorld(w,.25);assert.equal(r.lastFailure,null);assert.equal(r.activity,null);
 assert.deepEqual(r.at,start);assert.equal(r.inventory.rodKit,openingKit!-1);assert.equal(rods(w,r).length,1);
 assert.equal(r.plan,null,'equipping must not force a fishing plan');
 const rod=rods(w,r)[0],fish=choice(w,r,'fish'),at=fish.at!,pool=fishingStockAt(w,at)!;
 const stock=pool.amount,inventory=r.inventory[fish.fishSpecies!]??0,durability=rod.durability;
 const minutes=fishingMinutes(w,r,at,rod.level),began=w.minute;
 begin(w,r,fish);stepWorld(w,minutes-1);
 assert.equal(r.inventory[fish.fishSpecies!]??0,inventory);assert.equal(rod.durability,durability);
 finish(w,r);assert.ok(w.minute>began+minutes,'walking is additional to work');
 assert.deepEqual(r.at,at);assert.equal(r.inventory[fish.fishSpecies!],inventory+1);
 assert.equal(pool.amount,stock-1);assert.equal(rod.durability,durability-1);
 assert.equal(w.industry!.fishingExperience![r.id],.5);
});

test('the exact thirteenth birthday opens only the own rod choice, without giving equipment or making a plan',()=>{
 const {w,r}=fixture();r.bornAt+=.25;
 assert.equal(ageAllowsChoice(12.999,equip),false);
 assert.ok(industryTarget(w,r,{...equip}).error);
 assert.equal(submitPlan(w,plan(w,r,{...equip})).ok,false);
 assert.equal(industryOpportunities(w,r).some(c=>c.action.type==='industry'&&c.action.operation==='equip'),false);
 stepWorld(w,.25);assert.equal(industryTarget(w,r,{...equip}).error,undefined);choice(w,r,'equip');
 assert.equal(r.plan,null);assert.equal(rods(w,r).length,0);assert.equal(r.inventory.rodKit,1);
 for(const action of [
  {type:'industry',operation:'equip',tool:'axe'},
  {type:'industry',operation:'equip',tool:'pick'},
  {type:'industry',operation:'equip',tool:'spear'},
  {type:'industry',operation:'craft',recipeId:'rod',minutes:60},
  {type:'industry',operation:'repairTool',tool:'rod'},
  {type:'industry',operation:'upgrade',tool:'rod'},
  {type:'industry',operation:'collectTool',toolId:'not-a-personal-kit'},
  {type:'industry',operation:'hunt'},
  {type:'industry',operation:'mine'},
 ] as IndustryAction[]){
  assert.equal(ageAllowsChoice(13,action),false,action.operation+':'+action.tool);
  assert.match(industryTarget(w,r,{...action}).error!,/年龄或能力/);
 }
 delete w.scenario;assert.match(industryTarget(w,r,{...equip}).error!,/年龄或能力/);
 assert.equal(industryOpportunities(w,r).length,0,'town industry keeps its existing adult gate');
});

test('another resident\'s kit or carried rod and one\'s sealed remote tool cannot replace personal inventory',()=>{
 const {w,r}=fixture(),other=w.residents.find(p=>p.id!==r.id)!;
 r.inventory.rodKit=0;other.inventory.rodKit=2;
 const original=JSON.stringify({inventory:other.inventory,tools:w.industry!.tools});
 assert.match(industryTarget(w,r,{...equip}).error!,/未拆封/);
 assert.equal(industryOpportunities(w,r).some(c=>c.action.type==='industry'&&c.action.operation==='equip'),false);
 w.industry!.tools.push({id:'other-rod',ownerId:other.id,kind:'rod',level:1,durability:30,maxDurability:30});
 w.industry!.tools.push({id:'sealed-own-rod',ownerId:r.id,kind:'rod',level:1,durability:30,maxDurability:30,location:{at:{...r.at},inside:null,roomAt:null}});
 assert.match(industryTarget(w,r,{type:'industry',operation:'fish',at:w.industry!.frontierShore}).error!,/本人可用钓具/);
 begin(w,r,{...equip});finish(w,r,false);
 assert.equal(rods(w,r).length,0);assert.equal(other.inventory.rodKit,2);
 assert.equal(JSON.stringify({inventory:other.inventory,tools:w.industry!.tools.slice(0,-2)}),original);
});

test('a stale numbered choice cannot bypass revision, capability, or material rechecks',()=>{
 for(const failure of ['revision','canDecide','canExpress','kit'] as const){
  const {w,r}=fixture(),action=choice(w,r,'equip'),p=plan(w,r,action);
  if(failure==='revision')r.revision++;
  else if(failure==='kit')r.inventory.rodKit=0;
  else r[failure]=false;
  const result=submitPlan(w,p);
  if(failure==='kit'){assert.ok(result.ok);finish(w,r,false);}else assert.equal(result.ok,false);
  assert.equal(rods(w,r).length,0);assert.equal(r.inventory.rodKit,failure==='kit'?0:1);
 }
});

test('the last quarter minute rechecks the kit and avoids a duplicate if another usable rod now exists',()=>{
 for(const concurrentRod of [false,true]){
  const {w,r}=fixture();begin(w,r,choice(w,r,'equip'));stepWorld(w,14.75);
  if(concurrentRod)w.industry!.tools.push({id:'already-equipped',ownerId:r.id,kind:'rod',level:1,durability:19,maxDurability:30});
  else r.inventory.rodKit=0;
  stepWorld(w,.25);assert.ok(r.lastFailure);
  assert.equal(rods(w,r).length,concurrentRod?1:0);assert.equal(r.inventory.rodKit,concurrentRod?1:0);
 }
});

test('in-memory SQLite reload preserves partial equipment work and replay never consumes another kit',()=>{
 const {w,r}=fixture();r.inventory.rodKit=2;const submitted=begin(w,r,choice(w,r,'equip'));
 stepWorld(w,7.5);const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);const restored=store.load()!,actor=restored.residents.find(p=>p.id===r.id)!;
  assert.equal(actor.activity!.remaining,7.5);assert.equal(actor.inventory.rodKit,2);assert.equal(rods(restored,actor).length,0);
  stepWorld(restored,7.25);assert.equal(rods(restored,actor).length,0);stepWorld(restored,.25);
  assert.equal(actor.lastFailure,null);assert.equal(actor.inventory.rodKit,1);assert.equal(rods(restored,actor).length,1);
  assert.ok(submitPlan(restored,submitted).ok);stepWorld(restored,15);
  assert.equal(actor.inventory.rodKit,1);assert.equal(rods(restored,actor).length,1);assert.equal(actor.plan,null);
  store.commit(restored,w.revision);const final=store.load()!,person=final.residents.find(p=>p.id===r.id)!;
  assert.equal(person.inventory.rodKit,1);assert.equal(rods(final,person).length,1);choice(final,person,'fish');
 }finally{store.close();}
});

test('an independently accepted lesson still blocks overlapping rod equipment and fishing',()=>{
 const {w,r}=fixture(),teacher=w.residents.find(p=>p.id!==r.id&&p.skills.farming>=1)!,hall=w.buildings.find(b=>b.kind==='lodge')!;
 initializeEducation(w);
 teacher.at={...hall.door};teacher.inside=null;teacher.roomAt=null;
 if(!teacher.knownBuildings.includes(hall.id))teacher.knownBuildings.push(hall.id);
 const post={type:'education' as const,operation:'post' as const,buildingId:hall.id,subject:'farming' as const,startsIn:30,windowMinutes:180,capacity:4,fee:0};
 assert.equal(educationTarget(w,teacher,post).error,undefined);assert.equal(completeEducation(w,teacher,post),null);
 const lesson=w.education!.lessons.at(-1)!;r.skills.farming=0;r.at={...hall.door};r.inside=null;r.roomAt=null;
 const enroll={type:'education' as const,operation:'enroll' as const,lessonId:lesson.id};
 assert.equal(educationTarget(w,r,enroll).error,undefined);assert.equal(completeEducation(w,r,enroll),null);
 w.minute=lesson.start-5;
 assert.match(industryTarget(w,r,{...equip}).error!,/课堂/);
 assert.equal(industryOpportunities(w,r).some(c=>c.action.type==='industry'&&c.action.operation==='equip'),false);
 begin(w,r,{...equip});finish(w,r,false);assert.equal(r.inventory.rodKit,1);assert.equal(rods(w,r).length,0);
 w.industry!.tools.push({id:'preexisting-rod',ownerId:r.id,kind:'rod',level:1,durability:30,maxDurability:30});
 r.at={...w.industry!.frontierShore!};
 assert.match(industryTarget(w,r,{type:'industry',operation:'fish',at:{...r.at}}).error!,/课堂/);
 assert.equal(lesson.enrollments[0].status,'enrolled');assert.equal(lesson.enrollments[0].worked,0);
});
