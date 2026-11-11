import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {initializeLongCare,completeLongCare,longCareReason,careWindows,advanceLongCare} from '../src/world/long-care.js';
import {longCareSelfWithdrawal} from '../src/world/long-care-withdrawal.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {YEAR} from '../src/world/time.js';

// Independent review uses only generated worlds and an in-memory database.
function fixture(){
 const w=createWorld(72);w.mode='formal';w.clock.paused=false;
 const [payer,provider,p]=w.residents,home=w.buildings.find(b=>b.id===payer.homeId)!;
 for(const r of w.residents){r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=100;r.hunger=20;r.energy=r.health=100;r.bornAt=w.minute-25*YEAR;r.inventory={meal:20,water:20};r.canDecide=r.canExpress=true;r.refusesCare=false;r.residency='resident';r.knownPeople=w.residents.map(x=>x.id);r.knownBuildings.push(home.id);r.activity=null;r.plan=null;}
 p.bornAt=w.minute-8*YEAR;p.guardianIds=[payer.id];p.homeId=home.id;initializeLongCare(w);stepWorld(w,.001);
 assert.equal(completeLongCare(w,provider,{type:'longCare',operation:'offer',targetId:p.id,fee:3,days:2,startsIn:60,startMinute:480,windowMinutes:120,visitsPerDay:2,condition:'daily'}),null);
 const c=w.longCare!.agreements.at(-1)!;
 assert.equal(completeLongCare(w,payer,{type:'longCare',operation:'accept',agreementId:c.id}),null);
 assert.equal(completeLongCare(w,p,{type:'longCare',operation:'assent',agreementId:c.id}),null);
 w.minute=careWindows(c,c.startDay)[0].start+1;
 return {w,payer,provider,p,c};
}
function submit(w:World,r:Resident,actions:Action[]){return submitPlan(w,{id:`review:${r.id}:${w.revision}:${r.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人停止这一份照护',actions});}
function stop(id:string):Action{return {type:'longCare',operation:'cancel',agreementId:id};}
function alias(id:string):Action{return {type:'promise',operation:'withdraw',promiseId:'longCare:'+id};}
function nearFinish(f:ReturnType<typeof fixture>){assert.equal(submit(f.w,f.provider,[{type:'longCare',operation:'visit',agreementId:f.c.id}]).ok,true);stepWorld(f.w,19.75);assert.equal(f.provider.activity?.remaining,.25);assert.equal(f.c.visits.length,0);}

for(const capable of [false,true])for(const viaAlias of [false,true])test(`withdrawal review: immediate self stop beats last quarter minute (capable=${capable}, alias=${viaAlias})`,()=>{
 const f=fixture();nearFinish(f);f.p.canDecide=capable;const coins=totalCoins(f.w),food=f.provider.inventory.meal;
 assert.equal(submit(f.w,f.p,[(viaAlias?alias:stop)(f.c.id)]).ok,true);
 assert.equal(f.c.status,'cancelled','must settle before the next provider tick');assert.equal(f.c.refunded,12);assert.equal(accountBalance(f.w,f.c.account),0);
 stepWorld(f.w,.25);assert.equal(f.c.paid,0);assert.equal(f.c.visits.length,0);assert.equal(f.provider.inventory.meal,food);assert.equal(totalCoins(f.w),coins);assert.equal(f.payer.coins,100);
});

for(const extra of [{targetId:'someone-else'},{providerId:'someone-else'},{fee:1},{replacementId:'other'},{promiseId:'other'},{operation:'arm'}])test(`withdrawal review: mixed cancel fields rejected ${JSON.stringify(extra)}`,()=>{
 const f=fixture();f.p.canDecide=false;const a={...stop(f.c.id),...extra} as Action;
 assert.equal(longCareSelfWithdrawal(f.w,f.p,a),null);assert.equal(submit(f.w,f.p,[a]).ok,false);assert.equal(f.c.status,'active');assert.equal(f.c.refunded,0);
});

for(const extra of [{agreementId:'other'},{targetId:'someone-else'},{type:'longCare'},{operation:'inspect'}])test(`withdrawal review: mixed alias fields rejected ${JSON.stringify(extra)}`,()=>{
 const f=fixture();f.p.canDecide=false;const a={...alias(f.c.id),...extra} as Action;
 assert.equal(longCareSelfWithdrawal(f.w,f.p,a),null);assert.equal(submit(f.w,f.p,[a]).ok,false);assert.equal(f.c.status,'active');
});

test('withdrawal review: provider and guardian cannot inherit expression-only beneficiary authority',()=>{
 for(const role of ['provider','payer'] as const){const f=fixture(),r=f[role];r.canDecide=false;
 for(const a of [stop(f.c.id),alias(f.c.id)]){assert.equal(longCareSelfWithdrawal(f.w,r,a),null);assert.equal(submit(f.w,r,[a]).ok,false);}assert.equal(f.c.status,'active');}
});

test('withdrawal review: limited beneficiary cannot batch unrelated actions or mutate contract',()=>{
 const f=fixture();f.p.canDecide=false;
 for(const actions of [[{type:'wait',minutes:1},stop(f.c.id)],[stop(f.c.id),{type:'eat',item:'meal'}],[{type:'longCare',operation:'arm',agreementId:f.c.id}],[{type:'longCare',operation:'accept',agreementId:f.c.id}],[stop('not-the-original')]] as Action[][]){assert.equal(submit(f.w,f.p,actions).ok,false);assert.equal(f.c.status,'active');}
});

test('withdrawal review: own other agreement is not cancelled and old cancellation cannot repeat refunds',()=>{
 const f=fixture(),other={...structuredClone(f.c),id:'unrelated-care',beneficiaryId:f.payer.id,account:'escrow:unrelated-care'};f.w.longCare!.agreements.push(other);f.p.canDecide=false;
 assert.equal(submit(f.w,f.p,[stop(other.id)]).ok,false);assert.equal(submit(f.w,f.p,[stop(f.c.id)]).ok,true);
 const coins=totalCoins(f.w);assert.equal(submit(f.w,f.p,[stop(f.c.id)]).ok,false);assert.equal(f.c.refunded,12);assert.equal(totalCoins(f.w),coins);assert.equal(other.status,'active');
});

for(const change of ['expression','outside','dead','ended'] as const)test(`withdrawal review: stale choice revalidates ${change}`,()=>{
 const f=fixture();f.p.canDecide=false;const action=stop(f.c.id);assert.ok(longCareSelfWithdrawal(f.w,f.p,action));
 if(change==='expression')f.p.canExpress=false;else if(change==='outside')f.p.residency='outside';else if(change==='dead')f.p.status='dead';else f.c.status='completed';
 assert.equal(longCareSelfWithdrawal(f.w,f.p,action),null);assert.equal(submit(f.w,f.p,[action]).ok,false);assert.equal(f.c.refunded,0);
});

test('withdrawal review: real remote menu alias targets only its original agreement',()=>{
 const f=fixture();f.p.at={x:1,y:1};f.p.canDecide=false;
 const menu=decisionChoices(decisionContext(f.w,f.p));
 const choice=menu.find(x=>x.action.type==='promise'&&x.action.operation==='withdraw'&&x.action.promiseId==='longCare:'+f.c.id);
 assert.ok(choice,'actual final menu must retain the remote original-promise withdrawal');
 const action=parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];assert.deepEqual(action,alias(f.c.id));
 assert.equal(submit(f.w,f.p,[action]).ok,true);assert.equal(f.c.status,'cancelled');assert.deepEqual(f.p.at,{x:1,y:1});
});

test('withdrawal review: refusal rechecked immediately before completion consumes nothing',()=>{
 const f=fixture();nearFinish(f);f.p.refusesCare=true;const food=f.provider.inventory.meal;
 stepWorld(f.w,.25);assert.equal(f.c.visits.length,0);assert.equal(f.c.paid,0);assert.equal(f.provider.inventory.meal,food);assert.equal(accountBalance(f.w,f.c.account),12);
});

test('withdrawal review: stop persists across reload and does not rearm after capacity recovery',()=>{
 const f=fixture();assert.equal(completeLongCare(f.w,f.provider,{type:'longCare',operation:'arm',agreementId:f.c.id}),null);f.p.canDecide=false;
 assert.equal(submit(f.w,f.p,[stop(f.c.id)]).ok,true);assert.equal(f.c.status,'cancelled');
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,c=w.longCare!.agreements.find(x=>x.id===f.c.id)!,p=w.residents.find(x=>x.id===f.p.id)!,provider=w.residents.find(x=>x.id===f.provider.id)!;
 p.canDecide=p.canExpress=true;assert.equal(c.status,'cancelled');assert.equal(c.armed,false);assert.equal(c.refunded,12);assert.equal(advanceLongCare(w).some(x=>x.actorId===provider.id),false);
 assert.ok(longCareReason(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}));stepWorld(w,30);assert.equal(c.paid,0);assert.equal(c.visits.length,0);
 }finally{store.close();}
});

for(const canDecide of [false,true])test(`withdrawal review: unseen remote settlement does not change stop menu (canDecide=${canDecide})`,()=>{
 const f=fixture();f.p.at={x:1,y:1};f.p.canDecide=canDecide;const ended=structuredClone(f.w),p=ended.residents.find(x=>x.id===f.p.id)!,provider=ended.residents.find(x=>x.id===f.provider.id)!;
 assert.equal(completeLongCare(ended,provider,{type:'longCare',operation:'cancel',agreementId:f.c.id}),null);
 const choices=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r)).filter(x=>x.action.type==='promise'&&x.action.promiseId==='longCare:'+f.c.id||x.action.type==='longCare'&&x.action.agreementId===f.c.id).map(x=>({id:x.id,label:x.label,action:x.action}));
 assert.deepEqual(choices(ended,p),choices(f.w,f.p));assert.ok(choices(ended,p).some(x=>x.action.type==='promise'&&x.action.operation==='withdraw'));
 const before=totalCoins(ended),c=ended.longCare!.agreements.find(x=>x.id===f.c.id)!;
 assert.equal(submit(ended,p,[alias(c.id)]).ok,true);assert.equal(totalCoins(ended),before);assert.equal(c.refunded,12);assert.equal(c.status,'cancelled');assert.ok(c.endKnownBy?.includes(p.id));
});

test('withdrawal review: provider losing capacity during last quarter minute cannot charge',()=>{
 const f=fixture();nearFinish(f);f.provider.canDecide=false;const food=f.provider.inventory.meal;
 stepWorld(f.w,.25);assert.equal(f.c.visits.length,0);assert.equal(f.c.paid,0);assert.equal(f.provider.inventory.meal,food);
});

test('withdrawal review: full-capacity mixed alias cannot fall through and silently cancel',()=>{
 for(const extra of [{agreementId:'another-agreement'},{targetId:'another-person'},{fee:99}]){
  const f=fixture(),action={...alias(f.c.id),...extra} as Action;submit(f.w,f.p,[action]);stepWorld(f.w,2);
  assert.equal(f.c.status,'active','a rejected self-stop must not be reinterpreted by the general promise path');assert.equal(f.c.refunded,0);
 }
});

test('withdrawal review: reloaded pending visit remains stoppable before material debit',()=>{
 const f=fixture();nearFinish(f);f.p.canDecide=false;const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,p=w.residents.find(r=>r.id===f.p.id)!,provider=w.residents.find(r=>r.id===f.provider.id)!,c=w.longCare!.agreements.find(x=>x.id===f.c.id)!;const food=provider.inventory.meal;
 assert.equal(provider.activity?.remaining,.25);assert.equal(submit(w,p,[stop(c.id)]).ok,true);stepWorld(w,.25);
 assert.equal(c.status,'cancelled');assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.equal(provider.inventory.meal,food);assert.equal(c.refunded,12);
 }finally{store.close();}
});

test('withdrawal review: incapable adult beneficiary gets no new adult-care or guardian authority',()=>{
 const f=fixture();f.p.bornAt=f.w.minute-30*YEAR;f.p.canDecide=false;
 for(const a of [{type:'longCare',operation:'offer',targetId:f.payer.id,fee:0,days:1,startsIn:60,startMinute:480,windowMinutes:60,visitsPerDay:1,condition:'daily'},{type:'longCare',operation:'assent',agreementId:f.c.id},{type:'longCare',operation:'approveHandoff',replacementId:'invented'}] as Action[])assert.equal(submit(f.w,f.p,[a]).ok,false);
 assert.equal(submit(f.w,f.p,[stop(f.c.id)]).ok,true);assert.equal(f.c.status,'cancelled');assert.deepEqual(f.p.guardianIds,[f.payer.id]);
});
