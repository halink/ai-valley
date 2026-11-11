import assert from 'node:assert/strict';
import {test} from 'node:test';
import {foodCoveragePanel,residentFoodProfile} from '../src/client/food-observation.js';
import {chapterLinks} from '../src/client/community.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {observerFrame} from '../src/server/observer-feed.js';
import {decisionContext,prompt} from '../src/server/decisions.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import type {Snapshot} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeCommons} from '../src/world/commons.js';
import {initializeFood} from '../src/world/food.js';
import {settlementFoodCoverage} from '../src/world/food-coverage.js';
import {initializeRooms} from '../src/world/rooms.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.resources=[];
 for(const r of w.residents){r.inventory={meal:1};r.bornAt=w.minute-30*YEAR;r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';}
 initializeFood(w);return w;
}
function snapshot(w=fixture()):Snapshot{return {world:w,foodCoverage:settlementFoodCoverage(w),mapRevision:'food-test',serverTime:'test',version:'test',capabilities:{active:[],pending:[]}};}

test('food panel and personal profile reuse coverage and leave world and resident knowledge unchanged',()=>{
 const w=fixture(),r=w.residents[0],before=structuredClone(w),report=settlementFoodCoverage(w);
 const html=foodCoveragePanel(w,report),profile=residentFoodProfile(w,r,report);
 assert.match(html,/社区去重现物/);assert.match(html,/至多一处/);assert.match(html,/未按个人到期窗口折减/);assert.match(html,/不是全世界库存/);assert.match(html,/不是个人天数相加/);assert.match(html,/不是逐顿计划或生存保证/);
 assert.match(html,/126.00/);assert.match(profile,/42.00/);assert.match(profile,/不足两天/);
 assert.match(profile,/data-panel="food"/);assert.match(chapterLinks('places'),/data-panel="food"/);
 assert.doesNotMatch(html+profile,/data-command|data-action|<input|<form/);
 assert.deepEqual(w,before);assert.deepEqual(report,settlementFoodCoverage(w));
});

test('the panel uses the real union of overlapping commons entitlements instead of adding personal estimates',()=>{
 const w=fixture();w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};w.plots=[];w.graves=[];
 const b=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;b.at={x:12,y:6};b.width=b.height=4;b.door={x:14,y:10};b.residents=[];w.buildings=[b];
 for(const r of w.residents){r.at={...b.door};r.inside=null;r.roomAt=null;r.knownBuildings=[b.id];r.inventory={};r.homeId=null;}
 initializeCivic(w);initializeRooms(w);initializeCommons(w);w.civic!.stores[b.id]={turnip:1};w.economy!.treasuryStock={turnip:1};initializeFood(w);
 const before=structuredClone(w),report=settlementFoodCoverage(w),html=foodCoveragePanel(w,report);
 assert.equal(report.residents.reduce((n,r)=>n+r.reachableNutrition,0),60);assert.equal(report.uniqueNutrition,20);
 assert.match(html,/<b>20.00<\/b>去重现物营养点/);assert.doesNotMatch(html,/<b>60.00<\/b>去重/);assert.match(html,/开拓公约/);
 assert.deepEqual(w,before);
});

test('care, medical transport, unknown expiry, absent data and departed people are not false survival claims',()=>{
 const w=fixture(),r=w.residents[0];r.bornAt=w.minute-YEAR;r.canDecide=false;
 let report=settlementFoodCoverage(w),html=foodCoveragePanel(w,report);assert.match(html,/需要实际照护者/);assert.match(html,/不表示本人没有食品/);
 r.bornAt=w.minute-30*YEAR;r.canDecide=true;
 delete w.food!.lots['person:'+r.id];report=settlementFoodCoverage(w);assert.match(residentFoodProfile(w,r,report),/保质期未登记/);
 report.residents[0].accessBlocked='medicalTransport';assert.match(foodCoveragePanel(w,report),/护送中，不能独立进食/);
 assert.match(foodCoveragePanel(w),/不能把缺失记录当成零库存/);
 r.status='dead';assert.equal(residentFoodProfile(w,r,report),'');r.status='alive';r.residency='outside';assert.equal(residentFoodProfile(w,r,report),'');
 report=settlementFoodCoverage(w);assert.equal(report.residents.length,2);
 w.residents=[];report=settlementFoodCoverage(w);assert.match(foodCoveragePanel(w,report),/当前没有在镇生活者/);assert.doesNotMatch(foodCoveragePanel(w,report),/NaN|Infinity/);
});

test('food observation escapes all names and source labels and floors near-threshold estimates',()=>{
 const w=fixture(),r=w.residents[0];r.name='<img src=x onerror=alert(1)>';const report=settlementFoodCoverage(w),c=report.residents[0];
 c.days=1.9999;c.sourceLabel='<script>bad</script>';c.collectionMinutes=2.3;
 const html=foodCoveragePanel(w,report);assert.match(html,/1.99 天/);assert.match(html,/约 3 游戏分钟/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script|约 2.00 天/);
});

test('runtime snapshot publishes food estimates only as observer metadata without altering decisions or saves',()=>{
 const store=new WorldStore(':memory:');
 try{
  const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'}),w=runtime.world,r=w.residents[0];
  const originalPrompt=prompt(decisionContext(w,r)),before=structuredClone(w),stored=store.load();
  const snap=runtime.snapshot();assert.deepEqual(snap.foodCoverage,settlementFoodCoverage(w));assert.equal(snap.foodCoverage!.residents.length,9);
  assert.equal(Object.hasOwn(w,'foodCoverage'),false);assert.equal(Object.hasOwn(snap.world,'foodCoverage'),false);assert.deepEqual(w,before);assert.deepEqual(store.load(),stored);
  assert.deepEqual(prompt(decisionContext(w,r)),originalPrompt,'community totals never enter an individual model prompt');
 }finally{store.close();}
});

test('snapshot baselines and deltas preserve, change and clear observer food metadata across reconnect',()=>{
 const first=snapshot(),initial=observerFrame(first);assert.deepEqual(applyObserverUpdate(first,initial),first);
 const next=structuredClone(first);next.world.revision++;next.world.minute+=1;
 const unchanged=observerFrame(next,first);assert.equal(Object.hasOwn(unchanged,'foodCoverage'),false);assert.deepEqual(applyObserverUpdate(first,unchanged),next);
 next.world.minute+=DAY;next.world.revision++;next.foodCoverage=settlementFoodCoverage(next.world);
 const changed=observerFrame(next,first),combined=applyObserverUpdate(first,changed)!;
 assert.deepEqual(combined,next);assert.equal(foodCoveragePanel(combined.world,combined.foodCoverage),foodCoveragePanel(next.world,next.foodCoverage));
 assert.deepEqual(applyObserverUpdate(first,observerFrame(next)),next);
 const without=structuredClone(next);without.world.revision++;delete without.foodCoverage;
 const cleared=observerFrame(without,next);assert.equal(cleared.foodCoverage,null);assert.deepEqual(applyObserverUpdate(next,cleared),without);
 assert.equal(applyObserverUpdate({...first,world:{...first.world,revision:first.world.revision-1}},changed),null);
 assert.deepEqual(applyObserverUpdate(next,observerFrame(first)),next,'older frames do not restore old estimates');
});
