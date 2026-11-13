import {test} from 'node:test';

import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import type {Snapshot} from '../src/shared/types.js';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {OutsideAidAction} from '../src/shared/outside-aid.js';
import {createWorld} from '../src/world/seed.js';
import {initializeForeignTrade,completeForeignTrade,advanceForeignTrade,foreignDecisionContext,applyForeignDecision} from '../src/world/foreign-trade.js';
import {initializeOutsideAid,completeOutsideAid,outsideAidReason,advanceOutsideAid,outsideAidOpportunities} from '../src/world/outside-aid.js';
import {initializeFood,advanceFood,foodContainers} from '../src/world/food.js';
import {decisionChoices,decisionContext,parseForeignReply} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {totalCoins} from '../src/world/economy.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:20,height:12,tiles:Array(20*12).fill('grass'),entrance:{x:0,y:6}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,2);
 for(const r of w.residents){r.at={...w.map.entrance};r.inside=null;r.roomAt=null;r.homeId=null;r.inventory={};r.parents=[];r.guardianIds=[];r.bornAt=w.minute-30*YEAR;r.hunger=25;r.energy=r.health=100;r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.plan=null;r.activity=null;r.knownBuildings=[];r.knownResources=[];}
 const [child,adult]=w.residents;child.bornAt=w.minute-10*YEAR;adult.inventory.wood=4;
 initializeForeignTrade(w);initializeOutsideAid(w);initializeFood(w);
 return {w,child,adult,m:w.foreignTrade!.merchants[0]};
}
function act(w:World,r:Resident,operation:OutsideAidAction['operation'],fields:Omit<OutsideAidAction,'type'|'operation'>={}){assert.equal(completeOutsideAid(w,r,{type:'outsideAid',operation,...fields}),null);}
function queue(w:World,r:Resident,a:Action){assert.equal(submitPlan(w,{id:`aid-test:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自主选择',actions:[a]}).ok,true);}
function finish(w:World,r:Resident){let cap=200;while(r.activity||r.plan){assert.ok(cap--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function courier(f:ReturnType<typeof fixture>){const {w,adult,m}=f;
 assert.equal(completeForeignTrade(w,adult,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'wood',quantity:1,price:1,maximumLevyBasisPoints:0}),null);
 const offer=w.foreignTrade!.offers.at(-1)!;w.minute=offer.noticeAt;advanceForeignTrade(w);
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:offer.id}),null);
 const s=w.foreignTrade!.shipments.at(-1)!;w.minute=s.readyAt;
 assert.equal(completeForeignTrade(w,adult,{type:'foreignTrade',operation:'dispatch',shipmentId:s.id}),null);return s;
}
function deliveredNotice(f:ReturnType<typeof fixture>){const s=courier(f);act(f.w,f.child,'post');advanceForeignTrade(f.w);const n=f.w.outsideAid!.notices[0];assert.equal(n.mail?.courierId,s.id);f.w.minute=s.arrivesAt!;advanceForeignTrade(f.w);assert.equal(n.mail!.receivedAt,f.w.minute);return n;}
function accepted(f:ReturnType<typeof fixture>,quantity=2){const n=deliveredNotice(f);act(f.w,f.m.person,'accept',{noticeId:n.id,item:'turnip',quantity});return f.w.outsideAid!.deliveries[0];}
const stock=(w:World)=>[...foodContainers(w).values()].reduce((sum,b)=>sum+(b.turnip??0),0)+(w.food?.spoiled.turnip??0);

test('normal child and merchant menus complete physical mail, independent response, real travel and collection without guardianship',()=>{
 const f=fixture(),{w,child,m}=f,s=courier(f),coins=totalCoins(w),inventory=stock(w),population=w.residents.length;
 // An already accepted courier continues even if no local adult remains available.
 f.adult.canDecide=false;f.adult.canExpress=false;
 const request=decisionChoices(decisionContext(w,child)).find(c=>c.action.type==='outsideAid'&&c.action.operation==='post')!;assert.ok(request);
 queue(w,child,parseChoice(JSON.stringify({choice:request.id}),[request]).actions[0]);finish(w,child);
 const n=w.outsideAid!.notices[0];assert.equal(JSON.stringify(n.mail),'null','a courier that has already passed cannot retroactively collect a later notice');
 // A second existing outward trip passes after the request was posted.
 f.adult.canDecide=f.adult.canExpress=true;const second=courier(f);f.adult.canDecide=f.adult.canExpress=false;advanceForeignTrade(w);assert.equal(n.mail?.courierId,second.id);
 assert.equal(n.mail?.receivedAt,null);assert.equal(m.person.inventory.turnip,36);assert.ok(!decisionChoices(foreignDecisionContext(w,m.person)).some(c=>c.action.type==='outsideAid'));
 w.minute=second.arrivesAt!-1;advanceForeignTrade(w);assert.equal(n.mail!.receivedAt,null);
 w.minute=second.arrivesAt!;advanceForeignTrade(w);const choices=decisionChoices(foreignDecisionContext(w,m.person));
 const accept=choices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='accept'&&c.action.item==='turnip'&&c.action.quantity===2)!;assert.ok(accept);
 const lot={...w.food!.lots['person:'+m.id]!.turnip![0]};assert.ok(applyForeignDecision(w,m.id,m.person.revision,parseForeignReply(accept.id,choices)).ok);
 const d=w.outsideAid!.deliveries[0];assert.equal(d.status,'reserved');assert.equal(m.person.inventory.turnip,34);assert.equal(child.inventory.turnip,undefined);
 assert.equal(w.food!.lots['aid:'+d.id]!.turnip![0].expiresAt,lot.expiresAt);assert.equal(stock(w),inventory);
 const dispatchChoices=decisionChoices(foreignDecisionContext(w,m.person)),dispatch=dispatchChoices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='dispatch')!;
 assert.ok(applyForeignDecision(w,m.id,m.person.revision,parseForeignReply(dispatch.id,dispatchChoices)).ok);
 const due=d.arrivesAt!;w.minute=due-1;advanceOutsideAid(w);assert.equal(d.status,'travelling');assert.equal(child.inventory.turnip,undefined);
 w.minute=due;advanceOutsideAid(w);assert.equal(d.status,'arrived');assert.equal(child.inventory.turnip,undefined);
 const collect=decisionChoices(decisionContext(w,child)).find(c=>c.action.type==='outsideAid'&&c.action.operation==='collect')!;assert.ok(collect);
 queue(w,child,collect.action);finish(w,child);assert.equal(d.status,'collected');assert.equal(child.inventory.turnip,2);assert.equal(w.food!.lots['person:'+child.id]!.turnip![0].expiresAt,lot.expiresAt);
 assert.deepEqual(child.guardianIds,[]);assert.equal(child.homeId,null);assert.equal(child.residency,'resident');assert.equal(w.residents.length,population);assert.equal(totalCoins(w),coins);assert.equal(stock(w),inventory);
 assert.ok(outsideAidReason(w,child,collect.action as OutsideAidAction));assert.equal(s.status,'completed');
});

test('no passing courier, empty village, refusal and missing stock leave real gaps without new people or supplies',()=>{
 const f=fixture(),{w,child,m}=f;act(w,child,'post');const n=w.outsideAid!.notices[0],before=stock(w),people=w.residents.length;
 w.minute+=DAY;advanceOutsideAid(w);assert.equal(n.mail,null);assert.equal(w.outsideAid!.deliveries.length,0);assert.ok(outsideAidReason(w,m.person,{type:'outsideAid',operation:'accept',noticeId:n.id,item:'turnip',quantity:1}));
 w.residents=[];advanceOutsideAid(w);assert.equal(w.residents.length,0);assert.equal(w.outsideAid!.deliveries.length,0);assert.equal(stock(w),before);
 const g=fixture(),notice=deliveredNotice(g);g.m.person.inventory.turnip=0;
 assert.match(outsideAidReason(g.w,g.m.person,{type:'outsideAid',operation:'accept',noticeId:notice.id,item:'turnip',quantity:1})!,/原库/);
 act(g.w,g.m.person,'decline',{noticeId:notice.id});assert.equal(notice.mail!.reply,'declined');assert.equal(g.w.outsideAid!.deliveries.length,0);assert.ok(!g.child.memories.some(m=>m.text.includes('独立婉拒')));assert.equal(g.w.residents.length,people);
});

test('gate blockage delays actual cargo, keeps original expiry and cannot expose remote responses to the requester',()=>{
 const f=fixture(),{w,child,m}=f,d=accepted(f);act(w,m.person,'dispatch',{deliveryId:d.id});const gate=w.foreignTrade!.station,index=gate.y*w.map.width+gate.x;
 child.at={x:15,y:6};const before=JSON.stringify(outsideAidOpportunities(w,child));w.map.tiles[index]='water';w.minute=d.arrivesAt!;advanceOutsideAid(w);
 assert.equal(d.status,'travelling');assert.notEqual(d.blockedSince,null);assert.equal(d.route!.at,null);assert.equal(child.inventory.turnip,undefined);
 assert.equal(JSON.stringify(outsideAidOpportunities(w,child)),before);assert.ok(w.events.some(e=>e.text.includes('实际谷口通路受阻')));
 w.map.tiles[index]='grass';w.minute++;advanceOutsideAid(w);assert.equal(d.status,'arrived');assert.equal(d.route!.at!.x,gate.x);assert.equal(d.blockedSince,null);
 assert.ok(outsideAidReason(w,child,{type:'outsideAid',operation:'collect',deliveryId:d.id}));child.at={...gate};
 const action:OutsideAidAction={type:'outsideAid',operation:'collect',deliveryId:d.id};assert.equal(outsideAidReason(w,child,action),null);
 child.health=5;child.hunger=100;assert.equal(hasTimelySelfRescue(w,child,[action]),true,'only already delivered, collectible goods can enter self-rescue');
});

test('an independent change of mind before dispatch returns only the reserved stock and is replay safe across restart',()=>{
 const f=fixture(),d=accepted(f),{w,m}=f,original=stock(w),expires=w.food!.lots['aid:'+d.id]!.turnip![0].expiresAt;
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();initializeOutsideAid(restored);const merchant=restored.foreignTrade!.merchants.find(x=>x.id===m.id)!;
 act(restored,merchant.person,'cancel',{deliveryId:d.id});assert.equal(restored.outsideAid!.deliveries[0].status,'returned');assert.equal(stock(restored),original);assert.equal(merchant.person.inventory.turnip,36);assert.equal(restored.food!.lots['person:'+m.id]!.turnip![0].expiresAt,expires);
 assert.ok(completeOutsideAid(restored,merchant.person,{type:'outsideAid',operation:'cancel',deliveryId:d.id}));assert.equal(merchant.person.inventory.turnip,36);
});

test('local withdrawal never informs the remote merchant instantaneously; late cargo physically returns without teleportation',()=>{
 const f=fixture(),n=deliveredNotice(f),{w,child,m}=f;act(w,child,'withdraw',{noticeId:n.id});
 assert.equal(outsideAidReason(w,m.person,{type:'outsideAid',operation:'accept',noticeId:n.id,item:'turnip',quantity:2}),null,'merchant still holds the original paper');
 act(w,m.person,'accept',{noticeId:n.id,item:'turnip',quantity:2});const d=w.outsideAid!.deliveries[0];act(w,m.person,'dispatch',{deliveryId:d.id});const start=m.person.inventory.turnip;
 w.minute=d.arrivesAt!;advanceOutsideAid(w);assert.equal(d.status,'returning');assert.equal(child.inventory.turnip,undefined);assert.equal(m.person.inventory.turnip,start);
 w.minute=d.arrivesAt!-1;advanceOutsideAid(w);assert.equal(d.status,'returning');w.minute++;advanceOutsideAid(w);assert.equal(d.status,'returned');assert.equal(m.person.inventory.turnip,36);
});

test('reserved and travelling food can spoil without replacement, and request deadlines cannot reset on reload',()=>{
 const f=fixture(),d=accepted(f),{w,m,child}=f,original=stock(w);w.food!.lots['aid:'+d.id]!.turnip![0].expiresAt=w.minute+1;w.minute++;advanceFood(w);
 assert.equal(d.inventory.turnip,0);assert.match(outsideAidReason(w,m.person,{type:'outsideAid',operation:'dispatch',deliveryId:d.id})!,/损耗/);act(w,m.person,'cancel',{deliveryId:d.id});assert.equal(m.person.inventory.turnip,34);assert.equal(stock(w),original);
 const g=fixture(),cargo=accepted(g);act(g.w,g.m.person,'dispatch',{deliveryId:cargo.id});g.w.food!.lots['aid:'+cargo.id]!.turnip![0].expiresAt=g.w.minute+1;g.w.minute=cargo.arrivesAt!;advanceFood(g.w);advanceOutsideAid(g.w);assert.equal(cargo.status,'arrived');assert.equal(cargo.inventory.turnip,0);assert.ok(outsideAidReason(g.w,g.child,{type:'outsideAid',operation:'collect',deliveryId:cargo.id}));
 const restored=JSON.parse(JSON.stringify(g.w)) as World,expiry=restored.outsideAid!.notices[0].expiresAt;initializeOutsideAid(restored);assert.equal(restored.outsideAid!.notices[0].expiresAt,expiry);restored.minute=expiry;advanceOutsideAid(restored);assert.equal(restored.outsideAid!.deliveries[0].status,'returning');assert.equal(child.inventory.turnip,undefined);
});

test('an export courier that turns back returns the undelivered paper at the real gate, not to the merchant',()=>{
 const f=fixture(),s=courier(f),{w,child,adult,m}=f;act(w,child,'post');advanceForeignTrade(w);const n=w.outsideAid!.notices[0];assert.equal(n.mail?.courierId,s.id);
 w.minute+=10;assert.equal(completeForeignTrade(w,adult,{type:'foreignTrade',operation:'cancelShipment',shipmentId:s.id}),null);assert.equal(n.mail!.receivedAt,null);
 w.minute=s.arrivesAt!;advanceForeignTrade(w);assert.equal(n.mail,null);assert.ok(!m.person.memories.some(m=>m.text.includes('实际收到由货运')));assert.ok(w.events.some(e=>e.text.includes('原信退回交接点')));
});

test('old-save initialization preserves existing people, property, stocks, time, and all aid evidence survives working-history trimming',()=>{
 const f=fixture(),{w}=f;delete w.outsideAid;const before=JSON.stringify(w);initializeOutsideAid(w);const {outsideAid,...rest}=w;assert.equal(JSON.stringify(rest),before);assert.deepEqual(outsideAid,{notices:[],deliveries:[],nextSerial:1});
 const d=accepted(f),n=w.outsideAid!.notices[0];act(w,f.m.person,'cancel',{deliveryId:d.id});const ids=[...n.eventIds,...d.eventIds];w.minute+=100;
 for(let i=0;i<220;i++)emitLedgerEvent(w,{kind:'system',actors:[],place:w.map.entrance,text:'unrelated '+i});
 const retained=workingEvents(w);assert.ok(ids.every(id=>retained.some(e=>e.id===id)));const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();assert.deepEqual(restored.outsideAid,w.outsideAid);
});

test('observer updates preserve actual public aid stages',()=>{
 const f=fixture(),{w}=f;f.child.name='<img src=x onerror=alert(1)>';const d=accepted(f);
 const snapshot=(world:World):Snapshot=>({world,mapRevision:'test',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}});
 const previous=snapshot(structuredClone(w)),before=JSON.stringify(w);assert.equal(JSON.stringify(w),before);
 act(w,f.m.person,'dispatch',{deliveryId:d.id});const current=snapshot(structuredClone(w)),frame=observerFrame(current,previous),merged=applyObserverUpdate(previous,frame)!;
 assert.equal(merged.world.outsideAid!.deliveries[0].status,'travelling');
 w.minute=d.arrivesAt!;advanceOutsideAid(w);act(w,f.child,'collect',{deliveryId:d.id});assert.equal(d.collectedQuantity,2);
});

test('food-shortfall guidance avoids unrelated distant requests and delivered food remains selectable under menu pressure',()=>{
 const f=fixture(),{w,child,m}=f;w.foreignTrade!.knownStationIds.push(child.id);child.at={x:15,y:6};child.inventory.turnip=20;initializeFood(w);
 let context=decisionContext(w,child);assert.equal(context.formal!.foodCoverage!.lowFood,false);assert.ok(!context.formal!.opportunities.some(c=>c.action.type==='outsideAid'&&c.action.operation==='post'));
 child.inventory={};initializeFood(w);context=decisionContext(w,child);assert.equal(context.formal!.foodCoverage!.lowFood,true);assert.ok(context.formal!.opportunities.some(c=>c.action.type==='outsideAid'&&c.action.operation==='post'));
 child.at={...w.map.entrance};const d=accepted(f);act(w,m.person,'dispatch',{deliveryId:d.id});w.minute=d.arrivesAt!;advanceOutsideAid(w);child.hunger=100;context=decisionContext(w,child);
 for(let i=0;i<100;i++)context.formal!.opportunities.push({id:'pending:'+i,label:'独立拒绝既有提议',action:{type:'respond',proposalId:'pending:'+i,accept:false}});
 const menu=decisionChoices(context);assert.ok(menu.length<=56);assert.ok(menu.some(c=>c.action.type==='outsideAid'&&c.action.operation==='collect'));
});
