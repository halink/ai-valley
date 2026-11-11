import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action} from '../src/shared/types.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld} from '../src/world/engine.js';
import {advanceHousehold,completeHousehold} from '../src/world/household.js';
import {approveSupplyKit,carriedSupplyRods,chooseSupply,findSupplyChoice,finishSupply,physicalSupplyKitCount,proposeSupplyKit,queueSupply,supplyFixture,supplyMenu,type SupplyFixture} from './helpers/teen-fishing-supply.js';

const receive=(id:string)=>(a:Action)=>a.type==='household'&&a.operation==='acceptGift'&&a.giftId===id;
function ready(){const f=supplyFixture('birth-then-synthetic-13'),{p,g}=proposeSupplyKit(f);approveSupplyKit(f,g.id);return {f,p,g};}
function lastReceivingQuarter(f:SupplyFixture,id:string){
 queueSupply(f,f.teen,findSupplyChoice(f.w,f.teen,receive(id),'independent review receiver'));
 let ticks=200;
 while(!(f.teen.activity&&f.teen.activity.path.length===0&&f.teen.activity.remaining<=.25)){
  assert.ok(ticks-->0,'bounded physical collection');stepWorld(f.w,.25);
  assert.equal(f.teen.inventory.rodKit??0,0);
 }
 assert.deepEqual(f.teen.at,f.home.door);assert.equal(f.teen.activity.remaining,.25);
}
function noGiftUse(f:SupplyFixture){assert.equal(f.teen.inventory.rodKit??0,0);assert.equal(carriedSupplyRods(f.w,f.teen).length,0);assert.equal(f.w.industry!.totals.fish,0);assert.equal(physicalSupplyKitCount(f.w),1);}

for(const stop of ['declineGift','cancelGift'] as const)test(`independent supply review: ${stop} returns the actual crafted kit only to its original contributor`,()=>{
 const {f,p,g}=ready(),credits=structuredClone(p.credits);
 const actor=stop==='declineGift'?f.teen:f.a;
 chooseSupply(f,actor,a=>a.type==='household'&&a.operation===stop&&a.giftId===g.id,'independent rejection or cancellation');
 assert.equal(g.status,stop==='declineGift'?'declined':'cancelled');assert.equal(g.deliveredAt,null);
 assert.equal(p.credits.find(c=>c.ownerId===f.a.id)!.inventory.rodKit,1);
 assert.deepEqual(p.credits.find(c=>c.ownerId===f.b.id),credits.find(c=>c.ownerId===f.b.id));
 assert.deepEqual(g.segments.map(c=>c.inventory),[{},{}]);
 assert.ok(completeHousehold(f.w,f.teen,{type:'household',operation:'acceptGift',giftId:g.id}));
 noGiftUse(f);assert.equal(f.a.inventory.wood,5);assert.equal(f.a.inventory.fiber,1);
});

test('independent supply review: competing proposals cannot reserve the one crafted kit twice',()=>{
 const f=supplyFixture('birth-then-synthetic-13'),{p,g:first}=proposeSupplyKit(f);
 chooseSupply(f,f.teen,a=>a.type==='move'&&a.to.x===f.home.door.x&&a.to.y===f.home.door.y,'receiver returns within proposal hearing distance');
 chooseSupply(f,f.a,a=>a.type==='household'&&a.operation==='proposeGift'&&a.poolId===p.id&&a.targetId===f.teen.id&&a.item==='rodKit','second proposal for same kit',{amount:0,quantity:1,ownPercent:100});
 const second=f.w.household!.gifts.at(-1)!;assert.notEqual(first.id,second.id);
 approveSupplyKit(f,first.id);
 assert.ok(completeHousehold(f.w,f.b,{type:'household',operation:'approveGift',giftId:second.id}));
 assert.equal(second.status,'proposed');assert.deepEqual(second.segments,[]);
 assert.equal(first.segments[0].inventory.rodKit,1);noGiftUse(f);
});

for(const capability of ['canDecide','canExpress'] as const)test(`independent supply review: recipient ${capability} loss at collection completion prevents delivery`,()=>{
 const {f,g}=ready();lastReceivingQuarter(f,g.id);f.teen[capability]=false;
 stepWorld(f.w,.25);finishSupply(f.w,f.teen,false);
 assert.equal(g.status,'ready');assert.equal(g.deliveredAt,null);noGiftUse(f);
});

test('independent supply review: numbered receive choice cannot be rewritten to another recipient or gift',()=>{
 const {f,g}=ready(),menu=supplyMenu(f.w,f.teen),row=menu.find(c=>receive(g.id)(c.action));assert.ok(row);
 for(const fields of [{targetId:f.a.id},{giftId:'forged-gift'},{operation:'approveGift'},{item:'rodKit',quantity:20}]){
  assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,...fields}),menu));
 }
 assert.equal(g.status,'ready');noGiftUse(f);
});

test('independent supply review: donor incapacity detected before collection returns reserved kit',()=>{
 const {f,p,g}=ready();f.b.canDecide=false;advanceHousehold(f.w);
 assert.equal(g.status,'expired');assert.equal(p.credits[0].inventory.rodKit,1);
 assert.ok(completeHousehold(f.w,f.teen,{type:'household',operation:'acceptGift',giftId:g.id}));noGiftUse(f);
});

test('independent supply review: donor incapacity in the last collection quarter blocks delivery and returns the original kit',()=>{
 // Regression for the independently reproduced former completion-order gap.
 const {f,p,g}=ready();lastReceivingQuarter(f,g.id);f.b.canDecide=false;
 stepWorld(f.w,.25);
 assert.equal(f.b.canDecide,false);assert.equal(g.status,'expired');assert.equal(g.deliveredAt,null);
 assert.ok(f.teen.lastFailure);assert.equal(f.teen.inventory.rodKit??0,0);
 assert.equal(p.credits[0].inventory.rodKit,1);assert.deepEqual(g.segments.map(c=>c.inventory),[{},{}]);
 noGiftUse(f);
 f.b.canDecide=true;advanceHousehold(f.w);
 assert.equal(g.status,'expired');assert.ok(completeHousehold(f.w,f.teen,{type:'household',operation:'acceptGift',giftId:g.id}));
 noGiftUse(f);
});
