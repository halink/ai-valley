import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {YEAR} from '../src/world/time.js';
import {initializeIndustry,industryTarget,completeIndustry} from '../src/world/industry.js';
import {ageAllowsChoice} from '../src/world/family.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import type {World,Resident} from '../src/shared/types.js';
import type {IndustryAction} from '../src/shared/industry.js';

const equip=():IndustryAction=>({type:'industry',operation:'equip',tool:'rod'});
function fixture(age=13,scenario:World['scenario']| 'town'='frontier'){
 const w=createWorld(5401);w.scenario=scenario==='town'?undefined:scenario;w.mode='formal';w.clock.paused=false;
 w.map.tiles.fill('grass');w.buildings=[];w.resources=[];w.plots=[];
 const [r,other]=w.residents;w.residents=[r,other];
 for(const p of w.residents){p.at={x:20,y:20};p.inside=null;p.roomAt=null;p.plan=null;p.activity=null;p.bornAt=w.minute-age*YEAR;p.health=p.energy=100;p.hunger=0;p.canDecide=p.canExpress=true;p.inventory={rodKit:1};}
 initializeIndustry(w);w.industry!.tools=[];return {w,r,other};
}
function rows(w:World,r:Resident){return decisionChoices(decisionContext(w,r)).filter(c=>c.action.type==='industry'&&c.action.operation==='equip');}
function start(w:World,r:Resident,action=equip()){
 const result=submitPlan(w,{id:`review-equip:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'合成审查：本人选择装备自有钓具',actions:[action]});assert.ok(result.ok,JSON.stringify(result));
}

test('independent teen equipment review: exact birthday and town boundary agree at menu and execution',()=>{
 for(const age of [12,13,17,18])for(const scenario of ['frontier','town'] as const){const {w,r}=fixture(age,scenario),allowed=age>=18||scenario==='frontier'&&age>=13;
  assert.equal(!industryTarget(w,r,equip()).error,allowed);assert.equal(industryOpportunities(w,r).some(c=>c.id==='industry.equip.rod'),allowed);assert.equal(rows(w,r).some(c=>c.action.type==='industry'&&c.action.tool==='rod'),allowed);
 }
 const {w,r}=fixture();r.bornAt+=.25;assert.ok(industryTarget(w,r,equip()).error);w.minute+=.25;assert.equal(industryTarget(w,r,equip()).error,undefined);
});

test('independent teen equipment review: final numbered choice requires selected fifteen minutes and never auto-fishes',()=>{
 const {w,r}=fixture(),menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>c.action.type==='industry'&&c.action.operation==='equip'&&c.action.tool==='rod');assert.ok(choice);
 const selected=parseChoice(JSON.stringify({choice:choice.id}),menu);start(w,r,selected.actions[0] as IndustryAction);
 stepWorld(w,14.75);assert.equal(w.industry!.tools.length,0);assert.equal(r.inventory.rodKit,1);
 stepWorld(w,.25);assert.equal(r.lastFailure,null);assert.equal(w.industry!.tools.length,1);assert.equal(r.inventory.rodKit,0);assert.equal(w.industry!.tools[0].ownerId,r.id);assert.equal(w.industry!.tools[0].kind,'rod');assert.equal(r.inventory.fish??0,0);assert.equal(r.inventory.perch??0,0);assert.equal(r.plan,null);assert.equal(rows(w,r).length,0);
});

test('independent teen equipment review: forged kinds and adult operations remain forbidden',()=>{
 const {w,r}=fixture();r.inventory.pickKit=1;r.inventory.axeKit=1;
 for(const action of [{...equip(),tool:'pick'},{...equip(),tool:'axe'},{...equip(),tool:'spear'},{...equip(),tool:'__proto__'},{...equip(),operation:'repairTool'},{...equip(),operation:'upgrade'},{...equip(),operation:'collectTool'},{...equip(),operation:'craft'}] as IndustryAction[]){assert.equal(ageAllowsChoice(13,action),false);assert.ok(industryTarget(w,r,action).error);if(action.operation!=='craft')assert.ok(completeIndustry(w,r,action));}
 assert.equal(w.industry!.tools.length,0);assert.equal(r.inventory.rodKit,1);
});

test('independent teen equipment review: other people kits and rods confer no personal equipment',()=>{
 const {w,r,other}=fixture();r.inventory={};w.industry!.tools.push({id:'other-rod',ownerId:other.id,kind:'rod',level:1,durability:30,maxDurability:30});
 assert.equal(rows(w,r).length,0);assert.ok(completeIndustry(w,r,{...equip(),toolId:'other-rod'}));assert.equal(other.inventory.rodKit,1);assert.equal(w.industry!.tools.length,1);assert.equal(w.industry!.tools[0].ownerId,other.id);
});

test('independent teen equipment review: stale inventory or capability loss aborts before completion',()=>{
 for(const loss of ['kit','decide','express'] as const){const {w,r}=fixture();start(w,r);stepWorld(w,14.75);if(loss==='kit')r.inventory.rodKit=0;if(loss==='decide')r.canDecide=false;if(loss==='express')r.canExpress=false;stepWorld(w,.25);assert.equal(w.industry!.tools.length,0);assert.equal(r.inventory.rodKit,loss==='kit'?0:1);}
});

test('independent teen equipment review: existing usable rod wins race without consuming another kit',()=>{
 const {w,r}=fixture();start(w,r);stepWorld(w,14.75);w.industry!.tools.push({id:'arrived-rod',ownerId:r.id,kind:'rod',level:1,durability:30,maxDurability:30});stepWorld(w,.25);assert.equal(w.industry!.tools.length,1);assert.equal(r.inventory.rodKit,1);assert.ok(r.lastFailure);
});

test('independent teen equipment review: accepted public shift blocks menu and stale completion',()=>{
 const {w,r}=fixture();const action=equip();assert.equal(industryTarget(w,r,action).error,undefined);
 w.duties={...w.duties,shifts:[{workerId:r.id,status:'booked',start:w.minute,end:w.minute+60}]} as World['duties'];
 assert.match(industryTarget(w,r,action).error!,/班次/);assert.equal(rows(w,r).length,0);assert.ok(completeIndustry(w,r,action));assert.equal(r.inventory.rodKit,1);assert.equal(w.industry!.tools.length,0);
});

test('independent teen equipment review: in-memory SQLite reload preserves partial work and duplicate receipt',()=>{
 const {w,r}=fixture();start(w,r);stepWorld(w,7);const action=structuredClone(r.activity!.action) as IndustryAction,activity=structuredClone(r.activity!);const store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(p=>p.id===r.id)!;stepWorld(loaded,7.75);assert.equal(loaded.industry!.tools.length,0);stepWorld(loaded,.25);assert.equal(loaded.industry!.tools.length,1);assert.equal(actor.inventory.rodKit,0);
  // Replay the identical completion identity, even with another available kit.
  actor.inventory.rodKit=1;actor.activity=activity;assert.equal(completeIndustry(loaded,actor,action),null);assert.equal(actor.inventory.rodKit,1);assert.equal(loaded.industry!.tools.length,1);
 }finally{store.close();}
});

test('independent teen equipment review: stale numbered action cannot bypass changed actor revision',()=>{
 const {w,r}=fixture(),menu=decisionChoices(decisionContext(w,r)),choice=rows(w,r)[0];assert.ok(choice);
 const selected=parseChoice(JSON.stringify({choice:choice.id}),menu),revision=r.revision;r.revision++;
 const result=submitPlan(w,{id:'review-stale-revision',actorId:r.id,actorRevision:revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'过期菜单不可越过版本检查',actions:selected.actions});
 assert.equal(result.ok,false);assert.equal(r.inventory.rodKit,1);assert.equal(w.industry!.tools.length,0);
});
