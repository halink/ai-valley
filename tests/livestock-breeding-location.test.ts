import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import type {IndustryAction,Livestock,Pasture} from '../src/shared/industry.js';
import type {World,Resident} from '../src/shared/types.js';
import {WorldStore} from '../src/server/store.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {advanceIndustry,completeIndustry,industryTarget,initializeIndustry} from '../src/world/industry.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {createWorld} from '../src/world/seed.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(5480);w.mode='formal';w.clock.paused=false;w.minute=600;w.weather='sun';
 w.map={...w.map,width:36,height:24,tiles:Array(36*24).fill('grass'),entrance:{x:1,y:1}};
 w.resources=[];w.plots=[];w.graves=[];
 const owner=w.residents[0],template=w.buildings[0];
 const barn={...template,id:'breeding-barn',kind:'barn' as const,ownerId:owner.id,at:{x:2,y:2},width:8,height:5,door:{x:6,y:7},condition:100,residents:[],definition:'building/barn@1'};
 w.buildings=[barn];
 for(const r of w.residents){r.at={x:12,y:10};r.inside=null;r.roomAt=null;r.homeId=null;r.bornAt=w.minute-25*YEAR;r.canDecide=r.canExpress=true;r.health=r.energy=100;r.hunger=0;r.inventory={meal:20,water:20,fodder:20};r.plan=null;r.activity=null;r.knownBuildings=[barn.id];r.knownResources=[];}
 initializeIndustry(w);
 const yard=(id:string,x:number):Pasture=>({id,barnId:barn.id,tiles:Array.from({length:15},(_,i)=>({x:x+i%5,y:10+Math.floor(i/5)})),forage:30,capacity:60,lastMinute:w.minute});
 const first=yard('breeding-first-yard',12),second=yard('breeding-second-yard',22);
 const mother:Livestock={id:'breeding-mother',ownerId:owner.id,definition:'industry/processes@1',kind:'chicken',sex:'female',bornAt:w.minute-60*DAY,barnId:barn.id,pastureId:first.id,at:{x:12,y:10},inside:null,pen:0,hunger:20,thirst:20,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute,energy:85};
 const sire:Livestock={...mother,id:'breeding-sire',sex:'male',at:{x:16,y:12},pen:1};
 w.industry!.animals=[mother,sire];w.industry!.pastures=[first,second];
 return {w,owner,barn,mother,sire,first,second};
}
type Fixture=ReturnType<typeof fixture>;
function action(f:Fixture,partnerId=f.sire.id):IndustryAction{return {type:'industry',operation:'breedAnimal',animalId:f.mother.id,partnerId};}
function indoors(f:Fixture,n:Livestock){delete n.at;delete n.inside;delete n.roomAt;delete n.pastureId;}
function menuChoice(f:Fixture){
 for(let i=0;i<12;i++){
  const menu=decisionChoices(decisionContext(f.w,f.owner)),choice=menu.find(c=>c.action.type==='industry'&&c.action.operation==='breedAnimal'&&c.action.animalId===f.mother.id);
  if(choice)return {menu,choice};stepWorld(f.w,30);
 }
 assert.fail('same-location legal breeding must be selectable through the final numbered menu');
}
function submit(w:World,r:Resident,a:IndustryAction){assert.ok(submitPlan(w,{id:`breeding-test:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'离线本人选择同处繁育',actions:[a]}).ok);}
function finish(w:World,r:Resident){let guard=300;while(r.plan||r.activity){assert.ok(guard-->0);stepWorld(w,1);}}
function choose(f:Fixture){const {menu,choice}=menuChoice(f),a=parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0] as IndustryAction;submit(f.w,f.owner,a);finish(f.w,f.owner);assert.equal(f.owner.lastFailure,null);return a;}
function refuses(f:Fixture){
 const a=action(f),pregnancy=f.mother.pregnancy;
 assert.match(industryTarget(f.w,f.owner,a).error??'',/实际.*(?:同处|同舍|同一|牧场|护送)|同.*(?:畜舍|牧场)/);
 assert.ok(!industryOpportunities(f.w,f.owner).some(c=>c.action.type==='industry'&&c.action.operation==='breedAnimal'&&c.action.animalId===f.mother.id));
 assert.ok(completeIndustry(f.w,f.owner,a));assert.equal(f.mother.pregnancy,pregnancy);
}

for(const separation of ['different-pasture','inside-outside','out-of-yard','missing-yard','in-transit','different-interior'] as const)test(`same registered barn cannot authorize breeding when the sire is ${separation}`,()=>{
 const f=fixture();
 if(separation==='different-pasture'){f.sire.pastureId=f.second.id;f.sire.at={...f.second.tiles[0]};}
 if(separation==='inside-outside')indoors(f,f.sire);
 if(separation==='out-of-yard')f.sire.at={x:20,y:10};
 if(separation==='missing-yard')f.w.industry!.pastures=[];
 if(separation==='in-transit'){f.sire.carrierId=f.w.residents[1].id;f.sire.destinationId=f.barn.id;}
 if(separation==='different-interior'){indoors(f,f.mother);f.owner.at={...f.barn.door};f.sire.inside='another-barn';f.sire.at={...f.barn.door};}
 refuses(f);
});

test('a divided pasture cannot borrow a route outside its own footprint to establish new pregnancy',()=>{
 const f=fixture();for(let y=10;y<=12;y++)f.w.map.tiles[y*f.w.map.width+14]='cliff';refuses(f);
});

test('same actual connected pasture retains its existing 30-minute husbandry abstraction, without inventing contact movement',()=>{
 const f=fixture(),start=f.w.minute;const a=choose(f);
 assert.equal(a.partnerId,f.sire.id);assert.ok(f.w.minute>=start+30);assert.equal(f.mother.pregnancy?.sireId,f.sire.id);
 assert.equal(f.mother.pregnancy?.dueAt,f.w.minute+7*DAY);assert.equal(f.w.metrics.requests,0);
 assert.equal(f.w.industry!.animals.length,2);assert.equal(f.w.events.filter(e=>e.animalIds?.includes(f.mother.id)&&e.text.includes('繁育')).length,1);
});

for(const explicit of [false,true])test(`same actual barn retains legitimate breeding with ${explicit?'explicit indoor':'legacy implicit pen'} location`,()=>{
 const f=fixture();for(const n of [f.mother,f.sire]){indoors(f,n);if(explicit){n.at={...f.barn.door};n.inside=f.barn.id;}}
 f.owner.at={...f.barn.door};choose(f);assert.equal(f.mother.pregnancy?.sireId,f.sire.id);assert.equal(f.owner.inside,f.barn.id);
});

test('an invalid first male does not hide a later eligible same-location partner from the numbered menu',()=>{
 const f=fixture(),valid={...f.sire,id:'breeding-later-sire',at:{...f.sire.at!},pen:2};
 f.sire.pastureId=f.second.id;f.sire.at={...f.second.tiles[0]};f.w.industry!.animals.push(valid);
 const a=choose(f);assert.equal(a.partnerId,valid.id);assert.equal(f.mother.pregnancy?.sireId,valid.id);
});

test('an accepted partner is never silently replaced when location changes before completion',()=>{
 const f=fixture(),valid={...f.sire,id:'breeding-alternate',at:{...f.sire.at!},pen:2};f.w.industry!.animals.push(valid);
 const {menu,choice}=menuChoice(f),a=parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0] as IndustryAction;
 assert.equal(a.partnerId,f.sire.id);f.sire.pastureId=f.second.id;f.sire.at={...f.second.tiles[0]};
 assert.ok(completeIndustry(f.w,f.owner,a));assert.equal(f.mother.pregnancy,null);assert.equal(a.partnerId,f.sire.id);
});

test('separately pastured animals become eligible only after their owner actually escorts both into the same barn',()=>{
 const f=fixture();f.sire.pastureId=f.second.id;f.sire.at={...f.second.tiles[0]};refuses(f);
 for(const n of [f.sire,f.mother]){
  let selected=false;
  for(let attempt=0;attempt<12&&!selected;attempt++){
   const menu=decisionChoices(decisionContext(f.w,f.owner)),choice=menu.find(c=>c.action.type==='industry'&&c.action.operation==='moveAnimal'&&c.action.animalId===n.id&&c.action.buildingId===f.barn.id&&!c.action.pastureId);
   if(!choice){stepWorld(f.w,30);continue;}
   submit(f.w,f.owner,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0] as IndustryAction);finish(f.w,f.owner);assert.equal(f.owner.lastFailure,null);selected=true;
  }
  assert.ok(selected);assert.equal(n.at,undefined);assert.equal(n.carrierId,null);assert.equal(n.barnId,f.barn.id);
  if(n===f.sire)refuses(f);
 }
 choose(f);assert.equal(f.mother.pregnancy?.sireId,f.sire.id);assert.equal(f.w.metrics.requests,0);
 assert.equal(f.w.events.filter(e=>e.text.includes('沿实际路线把自有')).length,2);
});

test('SQLite-restored last quarter-minute breeding rechecks the selected sire location and cannot establish pregnancy remotely',t=>{
 const f=fixture();indoors(f,f.mother);indoors(f,f.sire);f.owner.at={...f.barn.door};
 const {menu,choice}=menuChoice(f),a=parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0] as IndustryAction;submit(f.w,f.owner,a);
 let guard=100;while(!f.owner.activity||f.owner.activity.path.length||f.owner.activity.room?.path.length||f.owner.activity.remaining===30){assert.ok(guard-->0);stepWorld(f.w,1);}
 while(f.owner.activity!.remaining>1)stepWorld(f.w,1);stepWorld(f.w,.75);assert.equal(f.owner.activity!.remaining,.25);
 const dir=mkdtempSync(join(testTmpdir(),'breeding-location-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'synthetic.sqlite'),store=new WorldStore(path);try{store.commit(f.w,null);}finally{store.close();}
 const reopened=new WorldStore(path);try{
  const w=reopened.loadForRuntime()!,owner=w.residents.find(r=>r.id===f.owner.id)!,sire=w.industry!.animals.find(n=>n.id===f.sire.id)!,mother=w.industry!.animals.find(n=>n.id===f.mother.id)!;
  sire.at={...f.second.tiles[0]};sire.inside=null;sire.pastureId=f.second.id;
  const original=JSON.stringify(mother.pregnancy);stepWorld(w,.25);assert.equal(JSON.stringify(mother.pregnancy),original);assert.ok(owner.lastFailure);
  assert.ok(!w.events.some(e=>e.animalIds?.includes(mother.id)&&e.text.includes('决定让')&&e.text.includes('繁育')));
 }finally{reopened.close();}
});

test('an existing pregnancy retains its original sire and due time after relocation, sire death and SQLite reload',()=>{
 const f=fixture();choose(f);const pregnancy=structuredClone(f.mother.pregnancy!);
 f.sire.status='dead';f.mother.pastureId=f.second.id;f.mother.at={...f.second.tiles[0]};
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,mother=w.industry!.animals.find(n=>n.id===f.mother.id)!;
  assert.deepEqual(mother.pregnancy,pregnancy);w.minute=pregnancy.dueAt;for(const yard of w.industry!.pastures!)yard.lastMinute=w.minute;
  for(const n of w.industry!.animals)n.lastMinute=w.minute;mother.hunger=mother.thirst=20;advanceIndustry(w);
  const baby=w.industry!.animals.find(n=>n.motherId===mother.id)!;assert.ok(baby);assert.equal(baby.sireId,pregnancy.sireId);assert.equal(baby.bornAt,pregnancy.dueAt);
  advanceIndustry(w);assert.equal(w.industry!.animals.filter(n=>n.motherId===mother.id).length,1);
 }finally{store.close();}
});
