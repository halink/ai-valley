import assert from 'node:assert/strict';
import {test} from 'node:test';
import {careFixture,acceptedCare,careChoice,carePlan,queueOrdinaryCare,finishCareAction,originalCareLots} from './helpers/care-meal-evidence.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {careActionReason,careAuthority,executeSocialAction} from '../src/world/social.js';
import {planStartError,stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';

const invalid=[['null',null],['NaN',NaN],['missing',undefined],['infinite',Infinity],['string','unknown'],['future','future'],['unsafe',-Number.MAX_SAFE_INTEGER-1]] as const;
function damage(w:World,p:Resident,value:unknown){p.bornAt=(value==='future'?w.minute+YEAR:value) as number;}
function fixture(basis:'guardian'|'consent'|'emergency'='guardian'){
 const f=careFixture(),{w,provider,beneficiary}=f;
 if(basis==='consent')acceptedCare(f);
 else {beneficiary.bornAt=w.minute-2*YEAR;beneficiary.canDecide=beneficiary.canExpress=false;beneficiary.guardianIds=basis==='guardian'?[provider.id]:[];if(basis==='emergency')beneficiary.health=15;}
 originalCareLots(f);return f;
}
const careTo=(id:string)=>(a:Action)=>a.type==='care'&&a.targetId===id;
const hasCare=(w:World,p:Resident,id:string)=>decisionChoices(decisionContext(w,p)).some(c=>careTo(id)(c.action));
const physical=(w:World,p:Resident)=>structuredClone({inventory:p.inventory,lots:w.food!.lots['person:'+p.id],proposals:w.proposals,care:w.events.filter(e=>e.audit?.scope.includes('basic-care'))});

for(const value of [null,NaN,'future'])for(const phase of ['queued','last-quarter'] as const)test(`red reproduction: guardian provider ${String(value)} after ${phase} cannot spend`,()=>{
 const f=fixture(),{w,provider}=f;queueOrdinaryCare(f);if(phase==='last-quarter')stepWorld(w,29.75);damage(w,provider,value);
 const before=physical(w,provider);assert.deepEqual(finishCareAction(w,provider),[]);assert.deepEqual(physical(w,provider),before);assert.ok(provider.lastFailure);
});

for(const basis of ['guardian','consent','emergency'] as const)for(const phase of ['queued','travel','last-quarter'] as const)test(`${basis} provider known adulthood is checked at ${phase}, both resident orders and invalid dates`,()=>{
 for(const reverse of [false,true])for(const [,value] of invalid){
  const f=fixture(basis),{w,provider,beneficiary}=f;
  const action=careChoice(w,provider,careTo(beneficiary.id));
  if(phase==='travel')provider.at={x:3,y:8};
  const plan=carePlan(w,provider,[action]);assert.equal(submitPlan(w,plan).ok,true);
  if(phase!=='queued')stepWorld(w,phase==='last-quarter'?29.75:.25);
  if(phase==='travel')assert.ok(provider.activity!.path.length);
  damage(w,provider,value);if(reverse)w.residents.reverse();
  const before=physical(w,provider),at={...provider.at},birth=provider.bornAt;
  assert.ok(careActionReason(w,provider,action as Extract<Action,{type:'care'}>,false));
  assert.equal(careAuthority(w,provider,beneficiary).allowed,false);assert.equal(hasCare(w,provider,beneficiary.id),false);
  assert.equal(executeSocialAction(w,provider,action).ok,false,'direct completion must recheck adult identity');
  assert.deepEqual(stepWorldWithFoodEvidence(w,.25).careMeals,[]);
  assert.equal(provider.activity,null);assert.equal(provider.plan,null);assert.ok(provider.lastFailure);
  assert.deepEqual(physical(w,provider),before);assert.deepEqual(provider.at,at);assert.ok(Object.is(provider.bornAt,birth));
 }
});

for(const basis of ['guardian','consent','emergency'] as const)test(`${basis} stale final choice cannot start once provider loses known adulthood`,()=>{
 const {w,provider,beneficiary}=fixture(basis),action=careChoice(w,provider,careTo(beneficiary.id));damage(w,provider,null);
 const plan=carePlan(w,provider,[action]),before=physical(w,provider);assert.ok(planStartError(w,plan));assert.equal(submitPlan(w,plan).ok,false);assert.deepEqual(physical(w,provider),before);
});

for(const stage of ['queued','last-quarter'] as const)for(const basis of ['guardian','consent','emergency'] as const)test(`SQLite ${basis} ${stage} legacy care stops without changing original records`,()=>{
 const f=fixture(basis),{w,provider,beneficiary}=f;queueOrdinaryCare(f);if(stage==='last-quarter')stepWorld(w,29.75);damage(w,provider,NaN);
 const before=physical(w,provider),rights=structuredClone({guardians:beneficiary.guardianIds,home:beneficiary.homeId,parents:beneficiary.parents}),store=new WorldStore(':memory:');
 try {store.commit(w,null);const loaded=store.loadForRuntime()!,p=loaded.residents.find(r=>r.id===provider.id)!,b=loaded.residents.find(r=>r.id===beneficiary.id)!;
  assert.equal(p.bornAt,null);assert.deepEqual(finishCareAction(loaded,p),[]);assert.ok(p.lastFailure);assert.deepEqual(physical(loaded,p),before);
  assert.deepEqual({guardians:b.guardianIds,home:b.homeId,parents:b.parents},rights);assert.equal(p.bornAt,null);
  const stable=physical(loaded,p);assert.deepEqual(stepWorldWithFoodEvidence(loaded,.25).careMeals,[]);assert.deepEqual(physical(loaded,p),stable);
 } finally {store.close();}
});

for(const targetAge of [0,2])test(`known adult still gives one guardian meal to valid age ${targetAge}`,()=>{
 const f=fixture(),{w,provider,beneficiary}=f;beneficiary.bornAt=w.minute-targetAge*YEAR;const before={...provider.inventory};queueOrdinaryCare(f);const receipts=finishCareAction(w,provider);
 assert.equal(receipts.length,1);assert.equal(receipts[0].authority,'guardian');assert.equal(receipts[0].inputs[0].nutrition,25);assert.equal(provider.inventory.meal,before.meal!-1);assert.equal(provider.inventory.water,before.water!-1);
});

for(const value of [null,NaN,'future',0,8,17])test(`unqualified historical guardian ${String(value)} cannot block a different adult's strict emergency care`,()=>{
 const f=fixture('emergency'),{w,provider,beneficiary,other}=f;beneficiary.guardianIds=[other.id];other.at={...beneficiary.at};
 if(typeof value==='number'&&Number.isFinite(value))other.bornAt=w.minute-value*YEAR;else damage(w,other,value);
 const birth=other.bornAt,guardians=[...beneficiary.guardianIds];assert.equal(careAuthority(w,provider,beneficiary).basis,'emergency');
 queueOrdinaryCare(f);const receipts=finishCareAction(w,provider);assert.equal(receipts.length,1);assert.equal(receipts[0].authority,'emergency');assert.ok(Object.is(other.bornAt,birth));assert.deepEqual(beneficiary.guardianIds,guardians);
});

test('a valid adult proxy still blocks emergency, and actual incapacity or absence alone makes that strict branch available',()=>{
 const f=fixture('emergency'),{w,provider,beneficiary,other}=f;beneficiary.guardianIds=[other.id];other.at={...beneficiary.at};
 assert.equal(careAuthority(w,provider,beneficiary).allowed,false);assert.equal(hasCare(w,provider,beneficiary.id),false);
 other.canDecide=false;assert.equal(careAuthority(w,provider,beneficiary).basis,'emergency');other.canDecide=true;other.at={x:1,y:16};assert.equal(careAuthority(w,provider,beneficiary).basis,'emergency');
 beneficiary.health=21;assert.equal(careAuthority(w,provider,beneficiary).allowed,false);beneficiary.health=15;beneficiary.canDecide=beneficiary.canExpress=true;assert.equal(careAuthority(w,provider,beneficiary).allowed,false);
});

for(const who of ['provider','beneficiary'] as const)test(`unknown ${who} keeps the actual immediate care withdrawal and cannot replace it with a guardian or emergency basis`,()=>{
 const f=fixture('consent'),{w,provider,beneficiary}=f,p=w.proposals.find(p=>p.kind==='care'&&p.status==='accepted')!;
 queueOrdinaryCare(f);stepWorld(w,29.75);const selected=structuredClone(provider.activity!.action),person=f[who];damage(w,person,null);if(who==='beneficiary')person.canDecide=false;
 person.canExpress=true;const stop=careChoice(w,person,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept),plan=carePlan(w,person,[stop]);
 const before=structuredClone(provider.inventory);assert.equal(submitPlan(w,plan).ok,true);assert.equal(p.status,'declined');assert.deepEqual(submitPlan(w,plan),{ok:true});
 provider.bornAt=w.minute-30*YEAR;beneficiary.bornAt=w.minute-2*YEAR;beneficiary.guardianIds=[provider.id];beneficiary.health=15;beneficiary.canDecide=beneficiary.canExpress=false;
 assert.equal(careAuthority(w,provider,beneficiary).allowed,false);assert.equal(executeSocialAction(w,provider,selected).ok,false);assert.equal(executeSocialAction(w,provider,{type:'care',targetId:beneficiary.id}).ok,false);
 assert.deepEqual(stepWorldWithFoodEvidence(w,.25).careMeals,[]);assert.deepEqual(provider.inventory,before);assert.equal(p.status,'declined');
});

test('unknown beneficiary retains real personal consent and a separately selected strict emergency, never an infant exemption',()=>{
 const f=fixture('consent');damage(f.w,f.beneficiary,null);queueOrdinaryCare(f);assert.equal(finishCareAction(f.w,f.provider)[0].authority,'consent');
 const e=fixture('emergency');damage(e.w,e.beneficiary,null);queueOrdinaryCare(e);assert.equal(finishCareAction(e.w,e.provider)[0].authority,'emergency');
});

for(const age of [0,8,17])test(`known ${age}-year-old provider gains no care authority, including emergency`,()=>{
 for(const basis of ['guardian','consent','emergency'] as const){const f=fixture(basis),{w,provider,beneficiary}=f;provider.bornAt=w.minute-age*YEAR;
  const before=physical(w,provider);assert.equal(careAuthority(w,provider,beneficiary).allowed,false);assert.equal(hasCare(w,provider,beneficiary.id),false);
  assert.equal(executeSocialAction(w,provider,{type:'care',targetId:beneficiary.id,...(basis==='consent'?{proposalId:w.proposals.find(p=>p.kind==='care')!.id}:{})}).ok,false);assert.deepEqual(physical(w,provider),before);
 }
});
