import {initializeConstruction} from '../src/world/construction.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action, Resident, World} from '../src/shared/types.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {buildChoices,parseChoice} from '../src/server/affordances.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {recordDeath} from '../src/world/life.js';
import {findPath} from '../src/world/navigation.js';

function choices(w:World,p:Resident) { return buildChoices(decisionContext(w,p)); }
function enact(w:World,p:Resident,match:(action:Action)=>boolean,minutes:number) {
  const menu=decisionChoices(decisionContext(w,p));
  const choice=menu.find(c=>match(c.action));
  assert.ok(choice,'action must be in the real model menu');
  const answer=parseChoice(JSON.stringify({choice:choice.id}),menu);
  assert.ok(submitPlan(w,{id:'isolation-'+p.id+'-'+w.revision,actorId:p.id,actorRevision:p.revision,
    createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...answer}).ok);
  w.clock.paused=false;stepWorld(w,minutes);
  assert.equal(p.lastFailure,null);
}

test('formal model choices require distinct, present, eligible adult decisions to begin pregnancy',()=>{
  const w=createFormalWorld(),[parent,partner,child]=w.residents;
  assert.ok(choices(w,child).every(c=>!['propose','separate','leave','settle','build'].includes(c.action.type)));
  assert.equal(choices(w,parent).some(c=>c.action.type==='propose'&&c.action.targetId===child.id),false);
  const base=buildChoices({...decisionContext(w,parent),formal:undefined}).filter(c=>c.action.type!=='sleep'&&c.action.type!=='wait');
  const expanded=choices(w,parent).filter(c=>c.action.type!=='sleep'&&c.action.type!=='wait');
  assert.deepEqual(expanded.slice(0,base.length),base);
  enact(w,parent,a=>a.type==='propose'&&a.proposal==='child'&&a.targetId===partner.id,4);
  assert.equal(parent.pregnancy,null);
  assert.ok(choices(w,partner).some(c=>c.action.type==='respond'&&!c.action.accept));
  enact(w,partner,a=>a.type==='respond'&&a.accept,4);
  assert.equal(w.residents.find(resident=>resident.id===parent.id)?.pregnancy?.otherParentId,partner.id);
  assert.ok(choices(w,parent).every(c=>c.action.type!=='propose'||c.action.proposal!=='child'));
});

test('settling uses actual local capacity; only observed death and actual supplies authorize care and burial',()=>{
  const w=createFormalWorld(),a=w.residents[0],helper=w.residents.find(r=>r.name==='阮颂')!;
  helper.at={...a.at};helper.inside=null;helper.knownPeople.push(a.id);a.knownPeople.push(helper.id);
  helper.skills.care=2;a.health=70;
  assert.equal(choices(w,helper).some(c=>c.action.type==='care'&&c.action.targetId===a.id),false);
  enact(w,helper,action=>action.type==='propose'&&action.proposal==='care'&&action.targetId===a.id,4);
  enact(w,a,action=>action.type==='respond'&&action.accept,4);
  const meals=helper.inventory.meal!;
  enact(w,helper,action=>action.type==='care'&&action.targetId===a.id,31);
  assert.equal(helper.inventory.meal,meals-1);
  recordDeath(w,a);
  assert.ok(choices(w,helper).some(c=>c.action.type==='bury'&&c.action.targetId===a.id));
  helper.memories=helper.memories.filter(m=>m.source==='heard');
  assert.ok(choices(w,helper).some(c=>c.action.type==='bury'),'verified death knowledge persists beyond recent conversation memory');
  const lodge=w.buildings.find(b=>b.kind==='lodge')!;
  helper.at={...lodge.door};helper.knownBuildings.push(lodge.id);helper.inside=null;
  lodge.capacity=lodge.residents.length;
  assert.equal(choices(w,helper).some(c=>c.action.type==='settle'&&c.action.buildingId===lodge.id),false);
  lodge.capacity++;
  enact(w,helper,action=>action.type==='settle'&&action.buildingId===lodge.id,16);
  assert.equal(helper.homeId,lodge.id);
  helper.at={...w.map.entrance};helper.inside=null;
  enact(w,helper,action=>action.type==='leave',2);
  assert.equal(helper.residency,'outside');
});

test('formal construction is an explicit staged proposal, with no instant house or automatic expenditure',()=>{
  const w=createFormalWorld(),owner=w.residents[0],other=w.residents[1];initializeConstruction(w);
  const parcel=(w.definitions['land/start@1'].data.parcels as {x:number;y:number}[])[0];
  owner.at={x:parcel.x+3,y:parcel.y+5};owner.inside=null;owner.inventory.wood=0;owner.inventory.stone=0;other.at={...owner.at};other.inside=null;
  const houses=w.buildings.length;
  assert.equal(choices(w,owner).some(c=>c.action.type==='build'),false);
  assert.equal(choices(w,other).some(c=>c.action.type==='construction'&&c.action.operation==='propose'&&c.action.scope==='private'),false);
  enact(w,owner,action=>action.type==='construction'&&action.operation==='propose'&&action.kind==='home',10);
  assert.equal(w.buildings.length,houses);assert.equal(w.construction!.projects.length,1);assert.equal(w.construction!.projects[0].stages[0].worked,0);
  assert.equal(owner.inventory.wood,0);assert.equal(owner.inventory.stone,0);
});

test('co-residents may independently start dating, then consider marriage; siblings cannot',()=>{
  const w=createFormalWorld(),a=w.residents.find(p=>p.name==='白荻')!,b=w.residents.find(p=>p.name==='樊桥')!;
  const sister=w.residents.find(p=>p.name==='秦果')!,brother=w.residents.find(p=>p.name==='秦杉')!;
  assert.equal(choices(w,sister).some(c=>c.action.type==='propose'&&c.action.proposal==='dating'&&c.action.targetId===brother.id),false);
  assert.equal(choices(w,a).some(c=>c.action.type==='propose'&&c.action.proposal==='marriage'&&c.action.targetId===b.id),false);
  enact(w,a,action=>action.type==='propose'&&action.proposal==='dating'&&action.targetId===b.id,4);
  enact(w,b,action=>action.type==='respond'&&action.accept,4);
  enact(w,b,action=>action.type==='propose'&&action.proposal==='marriage'&&action.targetId===a.id,4);
  enact(w,a,action=>action.type==='respond'&&action.accept,4);
  assert.equal(a.relations.find(r=>r.targetId===b.id)?.partner,'married');
});
