import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World,Proposal} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {careAuthority,careActionReason,executeSocialAction} from '../src/world/social.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(age=2){
 const w=createWorld(741);w.mode='formal';w.clock.paused=false;w.resources=[];w.plots=[];w.buildings=[];w.residents=w.residents.slice(0,3);w.proposals=[];
 for(const r of w.residents){r.at={...w.map.entrance};r.inside=null;r.roomAt=null;r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.plan=r.activity=null;r.lastFailure=null;r.canDecide=r.canExpress=true;r.refusesCare=false;r.health=80;r.energy=100;r.hunger=40;r.skills.care=2;r.inventory={meal:5,water:5};r.guardianIds=[];r.parents=[];r.adoptiveParents=[];}
 const [provider,child,other]=w.residents;child.bornAt=w.minute-age*YEAR;child.canDecide=false;child.guardianIds=[provider.id];return {w,provider,child,other};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
function choice(w:World,r:Resident,predicate:(a:Action)=>boolean){const rows=menu(w,r),row=rows.find(c=>predicate(c.action));assert.ok(row,'actual final menu row');return parseChoice(JSON.stringify({choice:row.id}),rows).actions[0];}
function submit(w:World,r:Resident,a:Action){return submitPlan(w,{id:`age-review:${r.id}:${r.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'独立核验一次基础照护',actions:[a]});}
function queue(f:ReturnType<typeof fixture>,r=f.provider){const a=choice(f.w,r,a=>a.type==='care'&&a.targetId===f.child.id);assert.equal(submit(f.w,r,a).ok,true);return a as Extract<Action,{type:'care'}>;}
const rights=(f:ReturnType<typeof fixture>)=>structuredClone({guardianIds:f.child.guardianIds,parents:f.child.parents,home:f.child.homeId,inventory:f.child.inventory,coins:f.child.coins});
const receipt=(w:World)=>w.events.filter(e=>e.kind==='care'&&e.audit?.scope?.includes('basic-care'));
function consent(f:ReturnType<typeof fixture>):Proposal{const p:Proposal={id:'review-exact-consent',kind:'care',actorId:f.provider.id,targetId:f.child.id,status:'accepted',createdAt:f.w.minute,expiresAt:f.w.minute+1440,definition:f.w.activeDefinitions['action/routine']};f.w.proposals.push(p);return p;}
const damage:Record<string,(w:World)=>unknown>={null:()=>null,missing:()=>undefined,nan:()=>NaN,infinity:()=>Infinity,negativeInfinity:()=>-Infinity,unsafe:()=>-Number.MAX_SAFE_INTEGER*2,boolean:()=>false,string:()=>'-999999',future:w=>w.minute+1000,child:w=>w.minute-2*YEAR};
for(const [name,value] of Object.entries(damage))for(const elapsed of [0,5,29.75])for(const reverse of [false,true])test(`independent provider age: ${name}, elapsed ${elapsed}, reverse ${reverse}`,()=>{
 const f=fixture(),a=queue(f),before=rights(f);if(elapsed)stepWorld(f.w,elapsed);if(reverse)f.w.residents.reverse();f.provider.bornAt=value(f.w) as number;
 const stock={...f.provider.inventory};assert.ok(careActionReason(f.w,f.provider,a,false));assert.equal(careAuthority(f.w,f.provider,f.child).allowed,false);
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,elapsed===29.75?.25:1).careMeals,[]);assert.deepEqual(f.provider.inventory,stock);assert.deepEqual(rights(f),before);assert.equal(receipt(f.w).length,0);assert.ok(f.provider.lastFailure);assert.equal(f.provider.activity,null);
 f.provider.bornAt=f.w.minute-30*YEAR;stepWorld(f.w,30);assert.deepEqual(f.provider.inventory,stock);assert.equal(receipt(f.w).length,0,'repair must not resume failed work');
});
for(const age of [0,2])test(`independent provider age: valid ${age}-year target still gets one guardian meal`,()=>{const f=fixture(age),before=rights(f);queue(f);const rows=stepWorldWithFoodEvidence(f.w,30).careMeals!;assert.equal(rows.length,1);assert.equal(f.provider.inventory.meal,4);assert.equal(f.provider.inventory.water,4);assert.equal(receipt(f.w)[0].audit?.authority,'guardian');assert.deepEqual(rights(f),before);});
for(const bad of [null,NaN])test(`independent provider age: SQLite old unbound activity with ${bad}`,()=>{
 const f=fixture();queue(f);stepWorld(f.w,29.75);f.provider.bornAt=bad as unknown as number;const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,provider=w.residents.find(r=>r.id===f.provider.id)!;const stock={...provider.inventory};assert.deepEqual(stepWorldWithFoodEvidence(w,.25).careMeals,[]);assert.deepEqual(provider.inventory,stock);assert.equal(provider.activity,null);provider.bornAt=w.minute-30*YEAR;stepWorld(w,30);assert.deepEqual(provider.inventory,stock);assert.equal(receipt(w).length,0);}finally{store.close();}
});
for(const guardianAge of [null,NaN,2,30])test(`independent provider age: timely proxy requires known adulthood ${guardianAge}`,()=>{
 const f=fixture();f.child.health=15;f.child.canDecide=f.child.canExpress=false;f.provider.bornAt=guardianAge===null?null as unknown as number:guardianAge===30?f.w.minute-30*YEAR:guardianAge===2?f.w.minute-2*YEAR:NaN;
 const eligible=guardianAge!==30;assert.equal(careAuthority(f.w,f.other,f.child).allowed,eligible);assert.equal(menu(f.w,f.other).some(c=>c.action.type==='care'&&c.action.targetId===f.child.id),eligible);
 if(eligible){queue(f,f.other);assert.equal(stepWorldWithFoodEvidence(f.w,30).careMeals!.length,1);assert.equal(f.other.inventory.meal,4);assert.equal(f.provider.inventory.meal,5);assert.equal(receipt(f.w)[0].audit?.authority,'emergency');}
});
for(const basis of ['guardian','emergency'] as const)test(`independent provider age: exact withdrawn consent cannot switch to ${basis}`,()=>{
 const f=fixture(),p=consent(f);queue(f);stepWorld(f.w,29.75);f.child.canDecide=false;f.child.canExpress=true;
 const stop=choice(f.w,f.child,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept);assert.equal(submit(f.w,f.child,stop).ok,true);assert.equal(p.status,'declined');
 if(basis==='emergency'){f.child.guardianIds=[];f.child.health=15;f.child.canExpress=false;}
 assert.equal(careAuthority(f.w,f.provider,f.child).allowed,false);const stock={...f.provider.inventory};assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).careMeals,[]);assert.deepEqual(f.provider.inventory,stock);
 f.w.proposals.push({...p,id:'later-consent',status:'accepted'});assert.equal(executeSocialAction(f.w,f.provider,{type:'care',targetId:f.child.id,proposalId:p.id}).ok,false);assert.equal(executeSocialAction(f.w,f.provider,{type:'care',targetId:f.child.id}).ok,false);assert.deepEqual(f.provider.inventory,stock);
});
test('independent provider age: unbound guardian work cannot gain later accepted consent',()=>{const f=fixture();queue(f);stepWorld(f.w,29.75);consent(f);assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).careMeals,[]);assert.equal(f.provider.inventory.meal,5);});
test('independent provider age: revoked guardian work cannot evade a refusal through emergency',()=>{const f=fixture();queue(f);stepWorld(f.w,29.75);f.child.guardianIds=[];f.child.health=15;f.child.refusesCare=true;assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).careMeals,[]);assert.equal(f.provider.inventory.meal,5);});
for(const age of [null,2,17,30])test(`independent provider age: accepted consent never expands caregiver age permission ${age}`,()=>{const f=fixture(30);consent(f);f.provider.bornAt=age===null?null as unknown as number:f.w.minute-age*YEAR;const allowed=age===30;assert.equal(careAuthority(f.w,f.provider,f.child).allowed,allowed);assert.equal(executeSocialAction(f.w,f.provider,{type:'care',targetId:f.child.id,proposalId:f.w.proposals[0].id}).ok,allowed);assert.equal(f.provider.inventory.meal,allowed?4:5);});
for(const beneficiaryAge of [2,30,null])test(`independent provider age: provider loses age while expressive recipient ${beneficiaryAge} keeps stop only`,()=>{
 const f=fixture(beneficiaryAge??2),p=consent(f);queue(f);stepWorld(f.w,29.75);f.provider.bornAt=null as unknown as number;f.child.bornAt=beneficiaryAge===null?null as unknown as number:f.child.bornAt;f.child.canDecide=false;f.child.canExpress=true;
 assert.equal(submit(f.w,f.child,{type:'care',targetId:f.other.id}).ok,false);const stop=choice(f.w,f.child,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept);assert.equal(submit(f.w,f.child,stop).ok,true);assert.equal(p.status,'declined');assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).careMeals,[]);assert.equal(f.provider.inventory.meal,5);
 f.provider.bornAt=f.w.minute-30*YEAR;f.child.health=15;f.child.canExpress=false;stepWorld(f.w,30);assert.equal(f.provider.inventory.meal,5);assert.equal(careAuthority(f.w,f.provider,f.child).allowed,false);
});
for(const basis of ['consent','emergency'] as const)test(`independent provider age: ${basis} work revalidates unknown provider at final quarter`,()=>{
 const f=fixture(30);if(basis==='consent')consent(f);else{f.child.health=15;f.child.canExpress=false;f.child.guardianIds=[];}
 queue(f);stepWorld(f.w,29.75);f.provider.bornAt=null as unknown as number;assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).careMeals,[]);assert.equal(f.provider.inventory.meal,5);assert.equal(f.provider.inventory.water,5);assert.equal(f.provider.activity,null);
});
