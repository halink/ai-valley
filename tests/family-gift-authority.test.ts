import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import type {HouseholdAction} from '../src/shared/household.js';
import type {Resident,World} from '../src/shared/types.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {completeHousehold,householdReason} from '../src/world/household.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createFrontierWorld(5401);w.clock.paused=false;
 const [a,b,child]=w.residents,home=w.buildings.find(p=>p.id===a.homeId)!;
 for(const r of [a,b,child]){r.at={...home.door};r.inside=null;r.roomAt=null;r.health=r.energy=100;r.hunger=0;}
 child.bornAt=w.minute-13*YEAR;child.canDecide=child.canExpress=true;
 // Isolated authority fixture, not a claim that a kit is supplied by gameplay.
 a.inventory.rodKit=b.inventory.rodKit=1;child.inventory.rodKit=0;
 return {w,a,b,child,home};
}
let serial=0;
function choose(w:World,r:Resident,operation:HouseholdAction['operation'],fields:Record<string,unknown>={},finish=true){
 for(let i=0;i<90;i++){
  const menu=decisionChoices(decisionContext(w,r));
  const c=menu.find(c=>c.action.type==='household'&&c.action.operation===operation
   &&(operation!=='create'||c.action.targetId===w.residents.find(p=>p.id!==r.id&&p.id!=='founder-1-3')?.id&&c.action.item==='rodKit')
   &&(operation!=='respond'||c.action.accept===true)
   &&(operation!=='proposeGift'||c.action.targetId==='founder-1-3'&&c.action.item==='rodKit'));
  if(c){
   assert.match(c.id,/^\d+$/);const parsed=parseChoice(JSON.stringify({choice:c.id,...fields}),menu);
   const result=submitPlan(w,{id:'gift-authority:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:parsed.intention,actions:parsed.actions});assert.ok(result.ok,result.error);
   if(finish){stepWorld(w,5);assert.equal(r.lastFailure,null);assert.equal(r.activity,null);}
   return parsed.actions[0] as HouseholdAction;
  }
  stepWorld(w,30);
 }
 assert.fail('No real numbered household choice: '+operation);
}
function ready(){
 const f=fixture(),{w,a,b,child}=f;
 // Keep identities explicit if the source seed changes.
 assert.equal(child.id,'founder-1-3');
 choose(w,a,'create',{name:'共同赠与权限回归',amount:1,quantity:1});
 const p=w.household!.pools.at(-1)!;choose(w,b,'respond');
 choose(w,a,'proposeGift',{amount:1,quantity:2,ownPercent:50});
 const g=w.household!.gifts.at(-1)!;
 assert.equal(g.status,'proposed');assert.equal(child.inventory.rodKit,0);
 assert.equal(householdReason(w,child,{type:'household',operation:'acceptGift',giftId:g.id})!==null,true);
 choose(w,b,'approveGift');assert.equal(g.status,'ready');
 return {...f,p,g};
}
function pending(){const f=ready();const action=choose(f.w,f.child,'acceptGift',{},false);stepWorld(f.w,4.75);assert.equal(f.child.activity!.remaining,.25);return {...f,action};}

for(const loss of ['decide','express','outside'] as const)for(const reverse of [false,true])test(`gift final .25 rechecks ${loss}, recipient ${reverse?'first':'last'}`,()=>{
 const {w,a,b,child,p,g,action}=pending(),money=totalCoins(w),coins=child.coins,approvedAt=g.approvedAt,costs=structuredClone(g.costs);
 if(reverse)w.residents=[child,...w.residents.filter(r=>r!==child)];
 if(loss==='decide')b.canDecide=false;else if(loss==='express')b.canExpress=false;else b.residency='outside';
 const before=structuredClone(w);assert.ok(householdReason(w,child,action));
 assert.equal(decisionChoices(decisionContext(w,child)).some(c=>c.action.type==='household'&&c.action.operation==='acceptGift'),false);
 assert.deepEqual(w,before,'validation and menus must remain read-only');
 stepWorld(w,.25);
 assert.equal(g.status,'expired');assert.equal(g.deliveredAt,null);assert.equal(child.inventory.rodKit,0);assert.equal(child.coins,coins);assert.ok(child.lastFailure);
 assert.deepEqual(p.credits.map(c=>c.inventory.rodKit),[1,1]);assert.deepEqual(p.credits.map(c=>c.coins),[1,1]);assert.equal(accountBalance(w,g.account),0);assert.equal(totalCoins(w),money);
 assert.equal(a.inventory.rodKit,0);assert.equal(b.inventory.rodKit,0,'refund stays in original storage');
 assert.equal(g.approvedAt,approvedAt);assert.deepEqual(g.costs,costs,'do not rewrite past approval or original costs');
 b.canDecide=b.canExpress=true;b.residency='resident';stepWorld(w,.25);
 assert.equal(g.status,'expired');assert.ok(completeHousehold(w,child,action));assert.equal(child.inventory.rodKit,0);
});

test('already-approved adults may leave the storage site; valid consent does not require continued co-presence',()=>{
 const {w,a,b,child,g}=pending();a.at={x:5,y:5};b.at={x:6,y:5};
 stepWorld(w,.25);assert.equal(g.status,'delivered');assert.equal(child.inventory.rodKit,2);assert.equal(child.lastFailure,null);assert.equal(child.plan,null);
});

test('direct completion and a SQLite-restored final step use the same current authority',()=>{
 const f=pending(),{w,b,child,g,action}=f;b.canDecide=false;
 assert.ok(completeHousehold(w,child,action));assert.equal(child.inventory.rodKit,0);
 const store=new WorldStore(':memory:');let loaded:World;
 try{store.commit(w,null);loaded=store.load(true)!;}finally{store.close();}
 const recipient=loaded.residents.find(r=>r.id===child.id)!;
 assert.equal(recipient.activity!.remaining,.25);stepWorld(loaded,.25);
 const saved=loaded.household!.gifts.find(x=>x.id===g.id)!;
 assert.equal(saved.status,'expired');assert.equal(saved.deliveredAt,null);assert.equal(recipient.inventory.rodKit,0);assert.equal(accountBalance(loaded,saved.account),0);
 assert.deepEqual(loaded.household!.pools[0].credits.map(c=>c.inventory.rodKit),[1,1]);
 assert.ok(completeHousehold(loaded,recipient,action));assert.equal(recipient.inventory.rodKit,0);
});

test('a revoked original proposal cannot be substituted with another ready gift',()=>{
 const {w,a,b,child,p,g,action}=pending();
 assert.equal(completeHousehold(w,a,{type:'household',operation:'cancelGift',giftId:g.id}),null);
 assert.equal(completeHousehold(w,a,{type:'household',operation:'proposeGift',poolId:p.id,targetId:child.id,amount:1,quantity:2,item:'rodKit',ownPercent:50}),null);
 const newer=w.household!.gifts.at(-1)!;assert.notEqual(newer.id,g.id);
 assert.equal(completeHousehold(w,b,{type:'household',operation:'approveGift',giftId:newer.id}),null);
 stepWorld(w,.25);assert.equal(g.status,'cancelled');assert.equal(newer.status,'ready');assert.equal(child.inventory.rodKit,0);assert.ok(child.lastFailure);
 assert.ok(completeHousehold(w,child,action));assert.equal(newer.status,'ready');
});

test('loss of a reserved physical kit before the final step returns only the actual remaining owner shares',()=>{
 const {w,child,p,g}=pending();g.segments[0].inventory.rodKit=0;
 stepWorld(w,.25);assert.equal(g.status,'expired');assert.equal(child.inventory.rodKit,0);assert.deepEqual(p.credits.map(c=>c.inventory.rodKit),[0,1]);assert.deepEqual(p.credits.map(c=>c.coins),[1,1]);assert.equal(accountBalance(w,g.account),0);
});
