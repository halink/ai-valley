import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan,planStartError} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR,knownAgeYears} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';

let serial=0;
function fixture(){
 const w=createWorld(5721);w.mode='formal';w.clock.paused=false;w.map.tiles.fill('grass');w.resources=[];w.buildings=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);
 const [a,b,c]=w.residents;
 for(const p of w.residents)Object.assign(p,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,inventory:{wood:6,stone:6},health:100,energy:100,hunger:0,status:'alive',residency:'resident',canDecide:true,canExpress:true,plan:null,activity:null,knownPeople:w.residents.map(r=>r.id),knownBuildings:[],knownResources:[]});
 return {w,a,b,c};
}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:'trade-review:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Independent synthetic barter review',actions:[a]});}
function finish(w:World,r:Resident){let budget=100;while(r.plan||r.activity){assert.ok(budget-->0);stepWorld(w,.25);}}
function offer(f:ReturnType<typeof fixture>){assert.equal(queue(f.w,f.a,{type:'offer',targetId:f.b.id,give:{wood:2},want:{stone:1}}).ok,true);finish(f.w,f.a);assert.equal(f.a.lastFailure,null);return f.w.offers.at(-1)!;}
function accept(w:World,r:Resident,id:string){const choices=decisionChoices(decisionContext(w,r)),row=choices.find(c=>c.action.type==='accept'&&c.action.offerId===id);assert.ok(row);return parseChoice(JSON.stringify({choice:row.id}),choices).actions[0];}
const stock=(w:World)=>w.residents.map(r=>structuredClone(r.inventory));
const trades=(w:World)=>w.events.filter(e=>e.kind==='trade').length;

for(const mutation of ['actor','recipient','give','want','expiry','definition'] as const)test(`trade review: same-ID ${mutation} replacement cannot rewrite selected acceptance`,()=>{
 const f=fixture(),o=offer(f),action=accept(f.w,f.b,o.id),original=structuredClone(o);
 assert.equal(queue(f.w,f.b,action).ok,true);stepWorld(f.w,2.75);assert.equal(f.b.activity?.remaining,.25);
 if(mutation==='actor')o.actorId=f.c.id;
 if(mutation==='recipient')o.targetId=f.c.id;
 if(mutation==='give')o.give={stone:2};
 if(mutation==='want')o.want={wood:1};
 if(mutation==='expiry')o.expiresAt++;
 if(mutation==='definition')o.definition='action/routine@999';
 const before=stock(f.w),events=trades(f.w),changed=structuredClone(o);stepWorld(f.w,.25);
 assert.ok(f.b.lastFailure);assert.deepEqual(stock(f.w),before);assert.deepEqual(o,changed);assert.equal(trades(f.w),events);assert.notDeepEqual(o,original);
});

test('trade review: two acceptors compete for real author stock, not duplicated promised goods',()=>{
 const f=fixture();f.a.inventory={wood:2};const first=offer(f);
 assert.equal(queue(f.w,f.a,{type:'offer',targetId:f.c.id,give:{wood:2},want:{stone:1}}).ok,true);finish(f.w,f.a);const second=f.w.offers.at(-1)!;
 assert.equal(queue(f.w,f.b,accept(f.w,f.b,first.id)).ok,true);assert.equal(queue(f.w,f.c,accept(f.w,f.c,second.id)).ok,true);finish(f.w,f.b);finish(f.w,f.c);
 assert.equal(first.status,'accepted');assert.equal(second.status,'open');assert.ok(f.c.lastFailure);assert.equal(f.a.inventory.wood??0,0);assert.equal(f.b.inventory.wood,8);assert.equal(f.c.inventory.wood,6);assert.equal(f.a.inventory.stone,1);
});

for(const who of ['author','acceptor'] as const)for(const bad of [null,NaN,Infinity] as const)test(`trade review: ${who} ${String(bad)} blocks saved pending acceptance`,()=>{
 const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,accept(f.w,f.b,o.id)).ok,true);stepWorld(f.w,2.75);
 (who==='author'?f.a:f.b).bornAt=bad as unknown as number;const original=structuredClone(o),before=stock(f.w);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load(true)!,r=w.residents.find(p=>p.id===f.b.id)!;stepWorld(w,.25);assert.ok(r.lastFailure);assert.deepEqual(stock(w),before);assert.deepEqual(w.offers.find(p=>p.id===o.id),original);assert.equal(trades(w),1);}finally{store.close();}
});

test('trade review: exact birthday at final quarter-minute grants no early authority',()=>{
 const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,accept(f.w,f.b,o.id)).ok,true);stepWorld(f.w,2.75);
 const birthday=f.w.minute+.25;f.a.bornAt=birthday-18*YEAR;assert.ok(knownAgeYears(f.a.bornAt,f.w.minute)!<18);stepWorld(f.w,.25);
 assert.equal(f.w.minute,birthday);assert.equal(knownAgeYears(f.a.bornAt,f.w.minute),18);assert.equal(o.status,'open');assert.ok(f.b.lastFailure);
 stepWorld(f.w,.25);assert.equal(o.status,'open');assert.equal(queue(f.w,f.b,accept(f.w,f.b,o.id)).ok,true);finish(f.w,f.b);assert.equal(o.status,'accepted');
});

for(const who of ['author','acceptor'] as const)test(`trade review: ${who} death before registration cannot transfer property`,()=>{
 const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,accept(f.w,f.b,o.id)).ok,true);stepWorld(f.w,2.75);(who==='author'?f.a:f.b).status='dead';const before=stock(f.w);stepWorld(f.w,.25);assert.notEqual(o.status,'accepted');assert.deepEqual(stock(f.w),before);assert.equal(trades(f.w),1);
});

test('trade review: offer to a minor remains a nonbinding proposal, never an automatic transfer',()=>{
 const f=fixture();f.b.bornAt=f.w.minute-12*YEAR;const before=stock(f.w),o=offer(f);assert.equal(o.status,'open');assert.deepEqual(stock(f.w),before);assert.equal(queue(f.w,f.b,{type:'accept',offerId:o.id}).ok,false);
});

for(const mutation of ['price','author'] as const)test(`trade review: late selected menu ${mutation} change is rejected before queueing`,()=>{
 const f=fixture(),o=offer(f),action=accept(f.w,f.b,o.id);if(mutation==='price')o.want={stone:2};else o.actorId=f.c.id;
 const before=stock(f.w),events=trades(f.w);assert.equal(queue(f.w,f.b,action).ok,false);assert.equal(f.b.plan,null);assert.deepEqual(stock(f.w),before);assert.equal(trades(f.w),events);assert.equal(o.status,'open');
});

for(const who of ['author','acceptor'] as const)test(`trade review: just-before-birthday ${who} is still unauthorized at completion`,()=>{
 const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,accept(f.w,f.b,o.id)).ok,true);stepWorld(f.w,2.75);
 const completion=f.w.minute+.25,birthday=completion+.125;(who==='author'?f.a:f.b).bornAt=birthday-18*YEAR;const before=stock(f.w);stepWorld(f.w,.25);
 assert.ok(f.b.lastFailure);assert.equal(o.status,'open');assert.deepEqual(stock(f.w),before);
});

for(const phase of ['queued','active'] as const)test(`trade review: legacy ${phase} acceptance without evidence cannot acquire consent on reload`,()=>{
 const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,accept(f.w,f.b,o.id)).ok,true);if(phase==='active')stepWorld(f.w,2.75);
 const action=phase==='active'?f.b.activity!.action:f.b.plan!.actions[0];assert.equal(action.type,'accept');if(action.type==='accept')delete action.offerTerms;
 const before=stock(f.w),original=structuredClone(o),store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load(true)!,b=w.residents.find(p=>p.id===f.b.id)!;stepWorld(w,.25);assert.ok(b.lastFailure);assert.deepEqual(stock(w),before);assert.deepEqual(w.offers[0],original);}finally{store.close();}
});

for(const malformed of [null,[],{},'wood', {wood:-1},{wood:NaN},{wood:Infinity},{wood:101},{toString:1}])test(`trade review: malformed offer bag ${JSON.stringify(malformed)} cannot settle`,()=>{
 const f=fixture(),o=offer(f);Object.assign(o,{give:malformed});const before=stock(f.w);
 assert.equal(decisionChoices(decisionContext(f.w,f.b)).some(c=>c.action.type==='accept'),false);
 assert.equal(queue(f.w,f.b,{type:'accept',offerId:o.id}).ok,true);finish(f.w,f.b);assert.ok(f.b.lastFailure);assert.deepEqual(stock(f.w),before);assert.equal(o.status,'open');
});

for(const capability of ['canDecide','canExpress'] as const)test(`trade review: proposal author loses ${capability} in final quarter`,()=>{
 const f=fixture();assert.equal(queue(f.w,f.a,{type:'offer',targetId:f.b.id,give:{wood:1},want:{stone:1}}).ok,true);stepWorld(f.w,2.75);f.a[capability]=false;const before=stock(f.w);stepWorld(f.w,.25);assert.ok(f.a.lastFailure);assert.equal(f.w.offers.length,0);assert.deepEqual(stock(f.w),before);assert.equal(trades(f.w),0);
});

test('trade review: actual birthday fresh decision passes normal runtime preflight without inventing earlier work',()=>{
 const f=fixture(),o=offer(f);f.b.bornAt=f.w.minute-18*YEAR;const action=accept(f.w,f.b,o.id),plan={id:'birthday-preflight',actorId:f.b.id,actorRevision:f.b.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'Fresh birthday choice',actions:[action]};
 const before=structuredClone(f.w);assert.equal(planStartError(f.w,plan),null);assert.deepEqual(f.w,before);assert.equal(submitPlan(f.w,plan).ok,true);finish(f.w,f.b);assert.equal(o.status,'accepted');
});

for(const field of ['id','actorId','targetId','definition','expiresAt'] as const)test(`trade review: missing ${field} cannot mint matching evidence from malformed saved offer`,()=>{
 const f=fixture(),o=offer(f);Reflect.deleteProperty(o,field);const before=stock(f.w);
 assert.equal(decisionChoices(decisionContext(f.w,f.b)).some(c=>c.action.type==='accept'),false);
 // A direct API submission does not get to turn matching malformed values into proof.
 assert.equal(queue(f.w,f.b,{type:'accept',offerId:o.id}).ok,true);finish(f.w,f.b);assert.ok(f.b.lastFailure);assert.deepEqual(stock(f.w),before);assert.notEqual(o.status,'accepted');assert.equal(trades(f.w),1);
});
