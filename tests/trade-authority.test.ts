import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 w.map={name:'独立交换权限测试',width:16,height:12,tiles:Array(192).fill('grass'),entrance:{x:1,y:1}};
 w.resources=[];w.buildings=[];w.plots=[];w.graves=[];
 for(const [i,r] of w.residents.entries())Object.assign(r,{bornAt:w.minute-30*YEAR,lifeStage:'adult',at:{x:6+i,y:6},inside:null,roomAt:null,homeId:null,inventory:i===0?{wood:6}:{stone:6},health:100,energy:100,hunger:0,canDecide:true,canExpress:true,knownBuildings:[],knownResources:[],knownPeople:w.residents.map(p=>p.id),plan:null,activity:null,lastFailure:null});
 const [a,b,c]=w.residents;return {w,a,b,c};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
function choose(w:World,r:Resident,type:'offer'|'accept',id:string){
 const choices=menu(w,r),choice=choices.find(c=>c.action.type===type&&(c.action.type==='offer'?c.action.targetId===id:c.action.type==='accept'&&c.action.offerId===id));
 assert.ok(choice,`final numbered ${type} choice for ${r.id}`);assert.match(choice.id,/^\d+$/);
 return parseChoice(JSON.stringify({choice:choice.id,...(type==='offer'?{give:{wood:2},want:{stone:3}}:{})}),choices).actions[0];
}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`trade-test:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:'action/routine@1',intention:'本人另行选择普通物物交换',actions:[a]});}
function finish(w:World,r:Resident){let left=120;while(r.plan||r.activity){assert.ok(left-->0);stepWorld(w,.25);}}
function offer(f:ReturnType<typeof fixture>){assert.equal(queue(f.w,f.a,choose(f.w,f.a,'offer',f.b.id)).ok,true);finish(f.w,f.a);assert.equal(f.a.lastFailure,null);assert.equal(f.w.offers.length,1);return f.w.offers[0];}
const assets=(w:World)=>structuredClone(w.residents.map(r=>({id:r.id,inventory:r.inventory,coins:r.coins,homeId:r.homeId,parents:r.parents,guardians:r.guardianIds})));
const badDates:Array<[string,(w:World)=>unknown]>=[['null',()=>null],['NaN',()=>NaN],['future',w=>w.minute+YEAR]];

for(const who of ['a','b'] as const)for(const [name,bad] of badDates)for(const phase of ['queued','final quarter'] as const)test(`barter accept ${who} ${name} at ${phase} preserves original offer and both owners`,()=>{
 const f=fixture(),o=offer(f),original=structuredClone(o),action=choose(f.w,f.b,'accept',o.id);
 assert.equal(queue(f.w,f.b,action).ok,true);
 if(phase==='final quarter'){stepWorld(f.w,2.75);assert.equal(f.b.activity?.remaining,.25);}
 const stock=assets(f.w),birth=f[who].bornAt;f[who].bornAt=bad(f.w) as number;
 const snapshot=structuredClone(f.w);assert.equal(menu(f.w,f.b).some(c=>c.action.type==='accept'&&c.action.offerId===o.id),false);assert.deepEqual(f.w,snapshot);
 stepWorld(f.w,.25);assert.ok(f.b.lastFailure);assert.equal(f.b.activity,null);assert.equal(f.b.plan,null);assert.deepEqual(o,original);assert.deepEqual(assets(f.w),stock);
 assert.equal(f.w.events.filter(e=>e.kind==='trade').length,1);f[who].bornAt=birth;stepWorld(f.w,1);assert.deepEqual(o,original);assert.deepEqual(assets(f.w),stock);
 assert.equal(queue(f.w,f.b,choose(f.w,f.b,'accept',o.id)).ok,true);finish(f.w,f.b);assert.equal(f.b.lastFailure,null);assert.equal(o.status,'accepted');assert.deepEqual(f.a.inventory,{wood:4,stone:3});assert.deepEqual(f.b.inventory,{stone:3,wood:2});
});

for(const [name,bad] of badDates)for(const phase of ['queued','final quarter'] as const)test(`barter proposal ${name} at ${phase} grants no authority or inventory`,()=>{
 const f=fixture(),birth=f.a.bornAt;assert.equal(queue(f.w,f.a,choose(f.w,f.a,'offer',f.b.id)).ok,true);
 if(phase==='final quarter'){stepWorld(f.w,2.75);assert.equal(f.a.activity?.remaining,.25);}
 const stock=assets(f.w);f.a.bornAt=bad(f.w) as number;stepWorld(f.w,.25);assert.ok(f.a.lastFailure);assert.equal(f.a.activity,null);assert.equal(f.a.plan,null);assert.equal(f.w.offers.length,0);assert.deepEqual(assets(f.w),stock);
 f.a.bornAt=birth;stepWorld(f.w,1);assert.equal(f.w.offers.length,0);assert.deepEqual(assets(f.w),stock);
});

for(const who of ['a','b'] as const)for(const capability of ['canDecide','canExpress'] as const)test(`barter ${who} losing ${capability} before settlement stops exact original acceptance`,()=>{
 const f=fixture(),o=offer(f),original=structuredClone(o);assert.equal(queue(f.w,f.b,choose(f.w,f.b,'accept',o.id)).ok,true);stepWorld(f.w,2.75);const stock=assets(f.w);f[who][capability]=false;
 stepWorld(f.w,.25);assert.ok(f.b.lastFailure);assert.deepEqual(assets(f.w),stock);assert.deepEqual(o,original);f[who][capability]=true;stepWorld(f.w,1);assert.deepEqual(assets(f.w),stock);
});

for(const who of ['a','b'] as const)for(const [name,bad] of badDates)test(`barter SQLite ${who} ${name} does not repair age or resume acceptance`,()=>{
 const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,choose(f.w,f.b,'accept',o.id)).ok,true);stepWorld(f.w,2.75);f[who].bornAt=bad(f.w) as number;
 const stock=assets(f.w),terms=structuredClone(o),store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load(true)!,b=w.residents.find(p=>p.id===f.b.id)!,badPerson=w.residents.find(p=>p.id===f[who].id)!;assert.equal(badPerson.bornAt,name==='NaN'?null:f[who].bornAt);stepWorld(w,.25);assert.ok(b.lastFailure);assert.deepEqual(assets(w),stock);assert.deepEqual(w.offers[0],terms);badPerson.bornAt=w.minute-30*YEAR;stepWorld(w,1);assert.deepEqual(w.offers[0],terms);assert.deepEqual(assets(w),stock);}finally{store.close();}
});

test('barter known eighteenth birthday allows only a fresh actual adult choice',()=>{
 const f=fixture(),o=offer(f),birthday=f.w.minute+.25;f.b.bornAt=birthday-18*YEAR;f.b.lifeStage='teen';
 assert.equal(menu(f.w,f.b).some(c=>c.action.type==='accept'),false);assert.equal(queue(f.w,f.b,{type:'accept',offerId:o.id}).ok,false);
 stepWorld(f.w,.25);assert.equal(f.w.minute,birthday);assert.equal(o.status,'open');assert.equal(f.b.plan,null);assert.equal(queue(f.w,f.b,choose(f.w,f.b,'accept',o.id)).ok,true);finish(f.w,f.b);assert.equal(o.status,'accepted');
});

test('barter minors keep original actor restrictions and proposals never authorize their recipient',()=>{
 for(const age of [0,5,6,12,13,17]){const f=fixture();f.a.bornAt=f.w.minute-age*YEAR;assert.equal(menu(f.w,f.a).some(c=>c.action.type==='offer'||c.action.type==='accept'),false);assert.equal(queue(f.w,f.a,{type:'offer',targetId:f.b.id,give:{wood:2},want:{stone:3}}).ok,false);}
 const f=fixture();f.b.bornAt=f.w.minute-13*YEAR;const stock=assets(f.w),o=offer(f);assert.deepEqual(assets(f.w),stock);assert.equal(o.status,'open');assert.equal(queue(f.w,f.b,{type:'accept',offerId:o.id}).ok,false);assert.equal(menu(f.w,f.b).some(c=>c.action.type==='accept'),false);
});

for(const who of ['a','b'] as const)test(`barter ${who} invalid while waiting before an accepted queued step never resumes on recovery`,()=>{
 const f=fixture(),o=offer(f),action=choose(f.w,f.b,'accept',o.id),birth=f[who].bornAt;
 assert.equal(submitPlan(f.w,{id:`wait-before-trade:${who}`,actorId:f.b.id,actorRevision:f.b.revision,createdAt:f.w.minute,definition:'action/routine@1',intention:'先等候再按原报价交换',actions:[{type:'wait',minutes:10},action]}).ok,true);
 stepWorld(f.w,.25);assert.equal(f.b.activity?.action.type,'wait');const original=structuredClone(o),stock=assets(f.w);f[who].bornAt=null as unknown as number;
 stepWorld(f.w,.25);assert.ok(f.b.lastFailure);assert.equal(f.b.plan,null);assert.equal(f.b.activity,null);f[who].bornAt=birth;stepWorld(f.w,12);assert.deepEqual(o,original);assert.deepEqual(assets(f.w),stock);
});

for(const who of ['a','b'] as const)test(`barter ${who} invalid while approaching stops at actual position and keeps saved terms`,()=>{
 const f=fixture(),o=offer(f);f.b.at={x:11,y:6};const action=choose(f.w,f.b,'accept',o.id);assert.equal(queue(f.w,f.b,action).ok,true);stepWorld(f.w,1);assert.ok(f.b.activity?.path.length);
 const at={...f.b.at},original=structuredClone(o),stock=assets(f.w);f[who].bornAt=NaN;stepWorld(f.w,.25);assert.ok(f.b.lastFailure);assert.deepEqual(f.b.at,at);assert.deepEqual(o,original);assert.deepEqual(assets(f.w),stock);
});

test('barter legacy pending acceptance without selected terms fails safely, preserving legal open proposal',()=>{
 const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,choose(f.w,f.b,'accept',o.id)).ok,true);stepWorld(f.w,2.75);
 assert.equal(f.b.activity?.action.type,'accept');if(f.b.activity?.action.type==='accept')delete f.b.activity.action.offerTerms;
 const original=structuredClone(o),stock=assets(f.w),store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load(true)!,b=w.residents.find(p=>p.id===f.b.id)!;stepWorld(w,.25);assert.ok(b.lastFailure);assert.deepEqual(assets(w),stock);assert.deepEqual(w.offers[0],original);
  assert.equal(queue(w,b,choose(w,b,'accept',o.id)).ok,true);finish(w,b);assert.equal(w.offers[0].status,'accepted');}finally{store.close();}
});

test('barter rejection cannot consume another resident offer or reopen already accepted terms',()=>{
 const f=fixture(),o=offer(f),stock=assets(f.w);assert.equal(queue(f.w,f.c,{type:'accept',offerId:o.id}).ok,true);finish(f.w,f.c);assert.ok(f.c.lastFailure);assert.deepEqual(assets(f.w),stock);assert.equal(o.status,'open');
 const action=choose(f.w,f.b,'accept',o.id);assert.equal(queue(f.w,f.b,action).ok,true);finish(f.w,f.b);assert.equal(o.status,'accepted');const after=assets(f.w);assert.equal(queue(f.w,f.b,action).ok,true);finish(f.w,f.b);assert.ok(f.b.lastFailure);assert.deepEqual(assets(f.w),after);assert.equal(f.w.events.filter(e=>e.kind==='trade').length,2);
});

test('barter depleted stock at final instant never deducts either side partially',()=>{
 for(const who of ['a','b'] as const){const f=fixture(),o=offer(f);assert.equal(queue(f.w,f.b,choose(f.w,f.b,'accept',o.id)).ok,true);stepWorld(f.w,2.75);f[who].inventory={};const stock=assets(f.w),original=structuredClone(o);stepWorld(f.w,.25);assert.ok(f.b.lastFailure);assert.deepEqual(assets(f.w),stock);assert.deepEqual(o,original);}
});

test('barter valid saved acceptance transfers original food lots once without altering expiry or other owners',()=>{
 const f=fixture();f.a.inventory={berry:6};f.b.inventory={water:6};const choices=menu(f.w,f.a),row=choices.find(c=>c.action.type==='offer'&&c.action.targetId===f.b.id)!;assert.ok(row);
 const proposal=parseChoice(JSON.stringify({choice:row.id,give:{berry:2},want:{water:3}}),choices).actions[0];assert.equal(queue(f.w,f.a,proposal).ok,true);finish(f.w,f.a);const o=f.w.offers[0],terms=structuredClone(o);
 assert.equal(queue(f.w,f.b,choose(f.w,f.b,'accept',o.id)).ok,true);stepWorld(f.w,2.75);const berryExpiry=f.w.food!.lots['person:'+f.a.id].berry![0].expiresAt,other=structuredClone(f.c.inventory),store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load(true)!,a=w.residents.find(p=>p.id===f.a.id)!,b=w.residents.find(p=>p.id===f.b.id)!,revision=w.revision;stepWorld(w,.25);assert.equal(b.lastFailure,null);assert.deepEqual(a.inventory,{berry:4,water:3});assert.deepEqual(b.inventory,{water:3,berry:2});assert.deepEqual(w.residents.find(p=>p.id===f.c.id)!.inventory,other);assert.deepEqual(w.offers[0],{...terms,status:'accepted'});
  const berries=w.food!.lots['person:'+b.id].berry!;assert.equal(berries.reduce((n,l)=>n+l.quantity,0),2);assert.ok(berries.every(l=>l.expiresAt===berryExpiry));assert.equal(w.events.filter(e=>e.kind==='trade').length,2);
  store.commit(w,revision);const reopened=store.load(true)!,stock=assets(reopened);stepWorld(reopened,1);assert.deepEqual(assets(reopened),stock);assert.equal(reopened.events.filter(e=>e.kind==='trade').length,2);
 }finally{store.close();}
});
