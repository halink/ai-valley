import {estateGoods,estateParcels,ownedEstateParcels} from '../src/world/estate-custody.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Item,Resident,World} from '../src/shared/types.js';
import type {ForeignAction,ForeignMerchant} from '../src/shared/foreign-trade.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {initializeEconomy,totalCoins,accountBalance} from '../src/world/economy.js';
import {initializeCivic} from '../src/world/civic.js';
import {advanceForeignTrade,applyForeignDecision,completeForeignTrade,foreignCandidates,foreignDecisionContext,foreignReason,hasForeignAssets,initializeForeignTrade} from '../src/world/foreign-trade.js';
import {foreignChoiceFields,foreignNotes,foreignOpportunities,parseForeignChoice} from '../src/server/foreign-opportunities.js';
import {decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {recordDeath} from '../src/world/life.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {DAY} from '../src/world/time.js';

function fixture(){
 const w=createFormalWorld();w.clock.paused=false;
 const r=w.residents[0];r.coins=600;r.inventory={wood:40,stone:40,seed:20,turnip:40,water:40};r.at={...w.map.entrance};r.inside=null;
 initializeEconomy(w);initializeCivic(w);initializeForeignTrade(w);
 return {w,r,m:w.foreignTrade!.merchants[0],coins:totalCoins(w)};
}
function act(w:World,r:Resident,a:Omit<ForeignAction,'type'>){
 const action:ForeignAction={type:'foreignTrade',...a};
 assert.equal(completeForeignTrade(w,r,action),null,JSON.stringify(action));
}
function to(w:World,minute:number){w.minute=minute;advanceForeignTrade(w);}
function inventory(w:World,item:Item){
 return w.residents.reduce((sum,r)=>sum+(r.inventory[item]??0),0)+w.estates.reduce((sum,e)=>sum+(e.inventory[item]??0),0)+estateParcels(w).reduce((sum,p)=>sum+(p.inventory[item]??0),0)+w.foreignTrade!.merchants.reduce((sum,m)=>sum+(m.person.inventory[item]??0),0)
  +w.foreignTrade!.offers.filter(o=>o.item===item).reduce((sum,o)=>sum+o.stock,0)+w.foreignTrade!.shipments.filter(s=>s.item===item).reduce((sum,s)=>sum+s.goods,0);
}
function sale(w:World,m:ForeignMerchant,quantity=4,price=3){
 act(w,m.person,{operation:'post',merchantId:m.id,side:'import',item:'wood',quantity,price});const o=w.foreignTrade!.offers.at(-1)!;to(w,o.noticeAt);return o;
}
function accept(w:World,r:Resident,offerId:string,quantity:number){
 const o=w.foreignTrade!.offers.find(o=>o.id===offerId)!,rate=w.civic!.salesTax?.basisPoints??0;
 act(w,r,{operation:'accept',offerId,quantity,quotedPrice:o.price,maximumLevyBasisPoints:rate});return w.foreignTrade!.shipments.at(-1)!;
}

test('foreign capital and reserves initialize once without inventing any commercial choice or changing population',()=>{
 const w=createFormalWorld();initializeEconomy(w);const before=totalCoins(w),population=w.residents.length;
 initializeForeignTrade(w);assert.equal(totalCoins(w),before+1200);assert.equal(w.economy!.externalCoins,1200);
 assert.equal(w.residents.length,population);assert.equal(w.foreignTrade!.offers.length,0);
 initializeForeignTrade(w);w.minute+=DAY;advanceForeignTrade(w);
 assert.equal(totalCoins(w),before+1200);assert.equal(w.foreignTrade!.offers.length,0);assert.ok(w.foreignTrade!.merchants.every(m=>m.work===null));
 assert.equal(w.foreignTrade!.merchants[2].resources.stone.amount,600);
});

test('a merchant chooses own arbitrary price and quantity; posted real goods travel and are collected in person',()=>{
 const {w,r,m,coins}=fixture(),goods=inventory(w,'wood'),mine=r.inventory.wood!;
 const o=sale(w,m,4,7);assert.equal(o.price,7);assert.equal(o.stock,4);
 const s=accept(w,r,o.id,2),money=r.coins;
 assert.equal(o.remaining,2);assert.equal(s.status,'inTransit');assert.equal(r.inventory.wood,mine);
 assert.equal(accountBalance(w,s.escrowAccount),14);assert.ok(hasForeignAssets(w,r.id));
 to(w,s.arrivesAt!-1);assert.equal(s.status,'inTransit');assert.equal(m.person.coins,400);
 to(w,s.arrivesAt!);assert.equal(s.status,'arrived');assert.equal(m.person.coins,414);assert.equal(r.inventory.wood,mine);
 r.at={x:w.map.entrance.x+20,y:w.map.entrance.y};assert.ok(completeForeignTrade(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id}));
 r.at={...w.map.entrance};act(w,r,{operation:'collect',shipmentId:s.id});
 assert.equal(r.inventory.wood,mine+2);assert.equal(r.coins,money);assert.equal(s.status,'completed');
 assert.ok(completeForeignTrade(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id}));
 assert.equal(totalCoins(w),coins);assert.equal(inventory(w,'wood'),goods);
});

test('a residents export proposal needs delivered mail and the merchants own acceptance before local dispatch',()=>{
 const {w,r,m,coins}=fixture(),goods=inventory(w,'stone'),money=r.coins;
 act(w,r,{operation:'propose',merchantId:m.id,side:'export',item:'stone',quantity:3,price:9,maximumLevyBasisPoints:0});
 const o=w.foreignTrade!.offers.at(-1)!;
 assert.equal(o.stock,3);assert.equal(w.foreignTrade!.shipments.length,0);
 assert.ok(foreignReason(w,m.person,{type:'foreignTrade',operation:'accept',offerId:o.id}));
 to(w,o.noticeAt);act(w,m.person,{operation:'accept',offerId:o.id});
 const s=w.foreignTrade!.shipments.at(-1)!;assert.equal(s.status,'ready');assert.equal(m.person.coins,373);assert.equal(r.coins,money);
 assert.ok(foreignReason(w,r,{type:'foreignTrade',operation:'dispatch',shipmentId:s.id}));
 to(w,s.readyAt);act(w,r,{operation:'dispatch',shipmentId:s.id});
 assert.equal(r.coins,money);to(w,s.arrivesAt!);assert.equal(r.coins,money+27);assert.equal(s.status,'completed');
 const bank=r.coins;advanceForeignTrade(w);assert.equal(r.coins,bank);assert.equal(totalCoins(w),coins);assert.equal(inventory(w,'stone'),goods);
});

test('refusal preserves identity and goods; distant cancelled exports wait at the station rather than teleporting to the owner',()=>{
 const {w,r,m,coins}=fixture();const old=r.inventory.stone!;
 act(w,r,{operation:'propose',merchantId:m.id,side:'export',item:'stone',quantity:4,price:5,maximumLevyBasisPoints:0});
 const o=w.foreignTrade!.offers.at(-1)!;r.at={x:w.map.entrance.x+30,y:w.map.entrance.y};
 to(w,o.noticeAt);const rev=m.person.revision;
 assert.ok(applyForeignDecision(w,m.id,rev,{intention:'我不需要这批石料',actions:[{type:'foreignTrade',operation:'reject',offerId:o.id}]}).ok);
 assert.equal(o.status,'rejected');assert.equal(r.inventory.stone,old-4);const parcel=w.foreignTrade!.shipments.at(-1)!;
 assert.equal(parcel.status,'arrived');assert.ok(parcel.returned);
 assert.ok(m.person.memories.some(memory=>memory.text.includes('婉拒')));
 r.at={...w.map.entrance};assert.ok(foreignReason(w,r,{type:'foreignTrade',operation:'collect',shipmentId:parcel.id}));
 to(w,parcel.readyAt);act(w,r,{operation:'collect',shipmentId:parcel.id});assert.equal(r.inventory.stone,old);assert.equal(totalCoins(w),coins);
});

test('a delivered proposal wakes the merchant once and never defeats their own subsequent wait choice',()=>{
 const {w,r,m}=fixture();act(w,r,{operation:'propose',merchantId:m.id,side:'import',item:'wood',quantity:2,price:3,maximumLevyBasisPoints:0});
 const o=w.foreignTrade!.offers.at(-1)!;to(w,o.noticeAt);assert.ok(foreignCandidates(w).includes(m.person));
 assert.ok(applyForeignDecision(w,m.id,m.person.revision,{intention:'先考虑一下',actions:[{type:'foreignTrade',operation:'wait',minutes:360}]}).ok);
 to(w,w.minute+1);assert.ok(!foreignCandidates(w).includes(m.person));assert.equal(m.person.decisionDue,o.noticeAt+360);
});

test('twenty small foreign invoices pay five-percent cumulative tax only on delivery, with unused reservations refunded',()=>{
 const {w,r,m,coins}=fixture();m.person.inventory.wood=40;
 w.civic!.salesTax={basisPoints:500,expiresAt:w.minute+28*DAY,proposalId:'tax-5'};
 const o=sale(w,m,20,1),opening=r.coins;
 for(let i=0;i<20;i++){
  const s=accept(w,r,o.id,1);assert.equal(s.maxTax,1);assert.equal(accountBalance(w,s.escrowAccount),2);
  to(w,s.arrivesAt!);act(w,r,{operation:'collect',shipmentId:s.id});
 }
 assert.equal(w.economy!.treasury,1);assert.equal(r.coins,opening-21);assert.equal(m.person.coins,420);assert.equal(totalCoins(w),coins);
});

test('signed tax caps reject a late rate rise, while an accepted shipment keeps its own terms across policy replacement and restart',()=>{
 const {w,r,m,coins}=fixture();w.civic!.salesTax={basisPoints:500,expiresAt:w.minute+DAY,proposalId:'old'};
 const o=sale(w,m,2,20),stale:ForeignAction={type:'foreignTrade',operation:'accept',offerId:o.id,quantity:1,quotedPrice:20,maximumLevyBasisPoints:500};
 w.civic!.salesTax={basisPoints:1000,expiresAt:w.minute+DAY,proposalId:'new'};
 assert.ok(completeForeignTrade(w,r,stale));w.civic!.salesTax={basisPoints:500,expiresAt:w.minute+DAY,proposalId:'old'};
 act(w,r,stale);const s=w.foreignTrade!.shipments.at(-1)!;w.civic!.salesTax={basisPoints:1500,expiresAt:w.minute+DAY,proposalId:'latest'};
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();
 to(restored,s.arrivesAt!);const saved=restored.foreignTrade!.shipments.at(-1)!;
 assert.equal(saved.actualTax,1);assert.equal(restored.economy!.treasury,1);assert.equal(totalCoins(restored),coins);
});

test('blocked routes retain escrow and cargo; return takes actual time and cancels without charging tax',()=>{
 const {w,r,m,coins}=fixture(),goods=inventory(w,'wood'),opening=r.coins;
 w.civic!.salesTax={basisPoints:1000,expiresAt:w.minute+DAY,proposalId:'tax'};
 const o=sale(w,m,2,10),s=accept(w,r,o.id,2);const index=w.map.entrance.y*w.map.width+w.map.entrance.x,original=w.map.tiles[index];
 w.map.tiles[index]='water';to(w,s.arrivesAt!);assert.equal(s.status,'inTransit');assert.ok(s.blockedSince!==null);assert.equal(m.person.coins,400);assert.equal(w.economy!.treasury,0);
 act(w,m.person,{operation:'cancelShipment',shipmentId:s.id});assert.equal(s.status,'returning');assert.ok(r.coins<opening);
 w.map.tiles[index]=original;to(w,s.arrivesAt!);assert.equal(s.status,'cancelled');assert.equal(r.coins,opening);assert.equal(w.economy!.treasury,0);assert.equal(inventory(w,'wood'),goods);assert.equal(totalCoins(w),coins);
});

test('merchant prepaid purchase offers cannot overbook real cash or duplicate sale proceeds',()=>{
 const {w,r,m,coins}=fixture();const goods=inventory(w,'stone');
 act(w,m.person,{operation:'post',merchantId:m.id,side:'export',item:'stone',quantity:10,price:30});
 const o=w.foreignTrade!.offers.at(-1)!;assert.equal(m.person.coins,100);
 assert.ok(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'post',merchantId:m.id,side:'export',item:'wood',quantity:10,price:30}));
 to(w,o.noticeAt);const s=accept(w,r,o.id,10);assert.equal(o.status,'accepted');
 assert.ok(completeForeignTrade(w,r,{type:'foreignTrade',operation:'accept',offerId:o.id,quantity:1,quotedPrice:o.price,maximumLevyBasisPoints:0}));
 act(w,r,{operation:'dispatch',shipmentId:s.id});to(w,s.arrivesAt!);assert.equal(totalCoins(w),coins);assert.equal(inventory(w,'stone'),goods);
});

test('resident death protects pending imports and undelivered exports instead of losing cargo or paying a dead pocket',()=>{
 const {w,r,m,coins}=fixture(),goods=inventory(w,'wood');
 const o=sale(w,m,2,5),s=accept(w,r,o.id,2);recordDeath(w,r);assert.ok(hasForeignAssets(w,r.id));
 to(w,s.arrivesAt!);assert.equal(s.status,'completed');assert.ok(!hasForeignAssets(w,r.id));
 assert.equal(totalCoins(w),coins);assert.equal(inventory(w,'wood'),goods);assert.equal(r.coins,0);assert.ok(estateGoods(w,r.id).wood!>=2&&w.estates.find(e=>e.personId===r.id)!.parcels!.some(p=>p.location.at.x===w.foreignTrade!.station.x&&p.location.at.y===w.foreignTrade!.station.y));
 const next=fixture(),stock=inventory(next.w,'stone');
 act(next.w,next.r,{operation:'propose',merchantId:next.m.id,side:'export',item:'stone',quantity:3,price:5,maximumLevyBasisPoints:0});
 const offer=next.w.foreignTrade!.offers.at(-1)!;to(next.w,offer.noticeAt);act(next.w,next.m.person,{operation:'accept',offerId:offer.id});
 const pending=next.w.foreignTrade!.shipments.at(-1)!;recordDeath(next.w,next.r);advanceForeignTrade(next.w);
 assert.equal(pending.status,'cancelled');assert.equal(next.m.person.coins,400);assert.equal(inventory(next.w,'stone'),stock);assert.equal(totalCoins(next.w),next.coins);
});

test('outside production consumes finite reserves or actual inputs and needs elapsed labour, with no automatic restocking',()=>{
 const {w,m,coins}=fixture(),opening=m.person.inventory.turnip!,seeds=m.person.inventory.seed!;
 act(w,m.person,{operation:'produce',recipe:'growRoots',quantity:2});assert.equal(m.person.inventory.seed,seeds-2);assert.equal(m.person.inventory.turnip,opening);
 assert.ok(!foreignCandidates(w).includes(m.person));to(w,m.work!.finishesAt-1);assert.equal(m.person.inventory.turnip,opening);
 to(w,m.work!.finishesAt);assert.equal(m.person.inventory.turnip,opening+24);assert.equal(m.work,null);
 m.resources.stone.amount=2;assert.ok(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'produce',recipe:'quarryStone',quantity:3}));
 act(w,m.person,{operation:'produce',recipe:'quarryStone',quantity:2});to(w,m.work!.finishesAt);assert.equal(m.resources.stone.amount,0);
 to(w,w.minute+40*DAY);assert.equal(m.resources.stone.amount,0);assert.equal(totalCoins(w),coins);
});

test('foreign prompts expose own stocks and actual mail only, while strict parsing cannot rewrite identity or signed quote caps',()=>{
 const {w,r,m}=fixture();const context=foreignDecisionContext(w,m.person);
 assert.deepEqual(context.people,[]);assert.equal(context.actor.coins,m.person.coins);assert.ok(context.foreign);
 const choice=decisionChoices(context).find(c=>c.action.type==='foreignTrade'&&c.action.operation==='post'&&c.action.side==='import')!;assert.ok(choice);
 const parsed=parseChoice(JSON.stringify({choice:choice.id,quantity:2,price:7}),[choice]);assert.equal((parsed.actions[0] as ForeignAction).price,7);
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,quantity:2,price:7,merchantId:'stolen'}),[choice]));
 assert.deepEqual(foreignChoiceFields({type:'foreignTrade',operation:'accept',offerId:'x'}),[]);
 assert.throws(()=>parseForeignChoice({type:'foreignTrade',operation:'post'},{quantity:Infinity,price:2}));
 r.at={x:w.map.entrance.x+20,y:w.map.entrance.y};assert.equal(foreignNotes(w,r),'');assert.ok(!foreignOpportunities(w,r).some(c=>c.action.type==='foreignTrade'));
});

test('the actual action engine requires walking and handling time before an external quote can reserve resident goods',()=>{
 const {w,r,m}=fixture();const station=w.foreignTrade!.station;r.at={x:station.x,y:station.y+2};const before=r.inventory.stone!;
 const action:ForeignAction={type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'stone',quantity:2,price:4,maximumLevyBasisPoints:0};
 assert.ok(submitPlan(w,{id:'foreign-through-engine',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'试着向外地出售石料',actions:[action]}).ok);
 stepWorld(w,1);assert.equal(r.inventory.stone,before);stepWorld(w,10);assert.equal(r.lastFailure,null);assert.equal(r.inventory.stone,before-2);assert.deepEqual(r.at,station);
});

test('merchant shipment authority and quote knowledge wait for each actual confirmation letter',()=>{
 const {w,r,m}=fixture();const o=sale(w,m,4,3);
 const first=accept(w,r,o.id,1);
 assert.equal(first.merchantNoticeAt,w.minute+m.routeMinutes);
 assert.ok(foreignReason(w,m.person,{type:'foreignTrade',operation:'cancelShipment',shipmentId:first.id}));
 let context=foreignDecisionContext(w,m.person);
 assert.ok(!context.foreign!.choices.some(c=>c.action.type==='foreignTrade'&&c.action.shipmentId===first.id));
 assert.ok(context.foreign!.notice.includes('出售4木材'));
 to(w,w.minute+10);const second=accept(w,r,o.id,1);
 to(w,first.merchantNoticeAt!);
 context=foreignDecisionContext(w,m.person);assert.ok(context.foreign!.notice.includes('出售3木材'));
 assert.ok(context.foreign!.choices.some(c=>c.action.type==='foreignTrade'&&c.action.shipmentId===first.id));
 assert.ok(!context.foreign!.choices.some(c=>c.action.type==='foreignTrade'&&c.action.shipmentId===second.id));
 to(w,second.merchantNoticeAt!);assert.ok(foreignDecisionContext(w,m.person).foreign!.notice.includes('出售2木材'));
 assert.ok(m.person.memories.some(memory=>memory.text.includes('实际收到了')));
});

test('actual delivery time records a delayed arrival rather than the original promised estimate',()=>{
 const {w,r,m}=fixture();const o=sale(w,m,2,3),s=accept(w,r,o.id,2),estimate=s.arrivesAt!;
 const index=w.map.entrance.y*w.map.width+w.map.entrance.x,original=w.map.tiles[index];w.map.tiles[index]='water';
 to(w,estimate);assert.equal(s.deliveryAt,undefined);assert.equal(s.status,'inTransit');
 w.map.tiles[index]=original;to(w,estimate+45);
 assert.equal(s.deliveryAt,estimate+45);assert.equal(s.arrivesAt,estimate);assert.equal(s.status,'arrived');
});

test('a resident cancellation or death before mail arrival cannot create merchant memories of unseen events',()=>{
 for(const death of [false,true]){
  const {w,r,m}=fixture();act(w,r,{operation:'propose',merchantId:m.id,side:'export',item:'stone',quantity:2,price:4,maximumLevyBasisPoints:0});
  const o=w.foreignTrade!.offers.at(-1)!,before=structuredClone(m.person.memories);
  if(death){recordDeath(w,r);advanceForeignTrade(w);}else act(w,r,{operation:'cancelOffer',offerId:o.id});
  assert.deepEqual(m.person.memories,before);assert.ok(o.status!=='open');
 }
});

test('withdrawing an apparently open quote before its acceptance letter arrives never cancels an already bound shipment',()=>{
 const {w,r,m,coins}=fixture();const o=sale(w,m,1,3),s=accept(w,r,o.id,1);
 assert.equal(o.status,'accepted');
 assert.ok(foreignDecisionContext(w,m.person).foreign!.choices.some(c=>c.action.type==='foreignTrade'&&c.action.operation==='cancelOffer'&&c.action.offerId===o.id));
 act(w,m.person,{operation:'cancelOffer',offerId:o.id});assert.equal(s.status,'inTransit');assert.equal(o.status,'accepted');
 to(w,s.arrivesAt!);assert.equal(s.status,'arrived');assert.equal(totalCoins(w),coins);
});

import {parseForeignReply} from '../src/server/decisions.js';
test('a short merchant reply still binds only the exact listed choice and validates all independently chosen amounts',()=>{const {w,m}=fixture(),choices=decisionChoices(foreignDecisionContext(w,m.person)),post=choices.find(c=>c.action.type==='foreignTrade'&&c.action.operation==='post')!,d=parseForeignReply(`${post.id},2,7`,choices);assert.equal((d.actions[0] as ForeignAction).price,7);assert.equal((d.actions[0] as ForeignAction).quantity,2);assert.throws(()=>parseForeignReply(`${post.id},2,7,9`,choices));assert.throws(()=>parseForeignReply(`${post.id},41,7`,choices));assert.throws(()=>parseForeignReply(`${post.id}`,choices));assert.throws(()=>parseForeignReply(`我考虑 ${post.id},2,7`,choices));});
