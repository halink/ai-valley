import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import type {Resident,World,WorldEvent} from '../src/shared/types.js';
import type {WaterSupplyAction,WaterVessel} from '../src/shared/water-supply.js';
import type {HistoryPage} from '../src/shared/history.js';
import {createWorld} from '../src/world/seed.js';
import {initializeWaterSupply,completeWaterSupply,waterReceiptId,waterDrunkToday} from '../src/world/water-supply.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeHealth} from '../src/world/health.js';
import {roomLayout} from '../src/shared/rooms.js';
import {YEAR} from '../src/world/time.js';
import {emitEvent} from '../src/world/events.js';
import {WorldStore} from '../src/server/store.js';
import {historyKey,normalizeHistory,parseHistoryQuery,HistoryQueryError} from '../src/server/history-query.js';
import {HistoryReader,archiveControls,archiveTimeline} from '../src/client/history.js';
import {waterEventDetails,rememberWaterDetails} from '../src/client/water-history.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';

type Fields=WaterSupplyAction extends infer A?A extends WaterSupplyAction?Omit<A,'type'|'receiptId'>:never:never;
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.events=[];
 w.map={...w.map,width:40,height:32,tiles:Array(40*32).fill('grass'),entrance:{x:0,y:12}};w.plots=[];w.graves=[];
 const hall=w.buildings.find(b=>b.kind==='lodge')!;hall.at={x:16,y:6};hall.width=8;hall.height=6;hall.door={x:20,y:12};hall.residents=[];w.buildings=[hall];
 const spring={id:'history-spring',kind:'spring' as const,at:{x:10,y:12},amount:12,max:12,regrowthDays:0,lastHarvest:0};w.resources=[spring];
 for(const r of w.residents){r.at={x:12,y:12};r.inside=null;r.roomAt=null;r.homeId=null;r.parents=[];r.guardianIds=[];r.inventory={wood:20,water:3};r.bornAt=w.minute-30*YEAR;r.health=r.energy=100;r.hunger=0;r.knownBuildings=[hall.id];r.knownResources=[spring.id];r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.activity=null;r.plan=null;r.skills.care=2;}
 initializeCivic(w);initializeRooms(w);initializeWaterSupply(w);initializeHealth(w);
 const [r,other,child]=w.residents;child.bornAt=w.minute-10*YEAR;
 return {w,r,other,child,hall,spring};
}
const action=(w:World,r:Resident,fields:Fields):WaterSupplyAction=>({type:'waterSupply',receiptId:waterReceiptId(w,r),...fields});
function complete(w:World,r:Resident,fields:Fields){assert.equal(completeWaterSupply(w,r,action(w,r,fields)),null);const e=w.events.at(-1)!;assert.ok(e.waterSupply);return e;}
function slot(f:ReturnType<typeof fixture>,r=f.r,key='table'){r.at={...f.hall.door};r.inside=f.hall.id;r.roomAt={...roomLayout(f.w,f.hall).slots.find(s=>s.key===key)!.at};}
function bucket(f:ReturnType<typeof fixture>,r=f.r,amount=0,quality:WaterVessel['quality']='safe'){const v:WaterVessel={id:'history-vessel:'+f.w.waterSupply!.vessels.length,ownerId:r.id,buildingId:null,capacity:6,amount,quality,createdAt:f.w.minute};f.w.waterSupply!.vessels.push(v);return v;}

test('completed raw-water chain snapshots construction, finite extraction, boiling fuel and transfers without inventing drinking',()=>{
 const f=fixture(),{w,r,hall}=f;slot(f);const craft=complete(w,r,{operation:'craft',buildingId:hall.id}).waterSupply!;
 assert.deepEqual(craft.inventory,[{personId:r.id,item:'wood',before:20,after:18}]);assert.equal(craft.vessels[0].before,null);assert.equal(craft.vessels[0].after!.amount,0);
 const v=w.waterSupply!.vessels[0],at={x:8,y:16};w.map.tiles[at.y*w.map.width+at.x]='water';r.inside=null;r.roomAt=null;r.at={x:9,y:16};
 const survey=complete(w,r,{operation:'survey',at}).waterSupply!;assert.deepEqual(survey.source,{id:'surface:8,16',kind:'surface',before:null,after:24});assert.equal(survey.quantity,0);assert.equal(survey.recipientId,undefined);
 const fill=complete(w,r,{operation:'fillSurface',sourceId:survey.source!.id,vesselId:v.id,quantity:3}).waterSupply!;assert.equal(fill.source!.before,24);assert.equal(fill.source!.after,21);assert.equal(fill.vessels[0].after!.quality,'raw');
 slot(f,r,'kitchen');const boiled=complete(w,r,{operation:'boil',buildingId:hall.id,vesselId:v.id}).waterSupply!;assert.deepEqual([boiled.vessels[0].before!.amount,boiled.vessels[0].after!.amount],[3,3]);assert.deepEqual([boiled.vessels[0].before!.quality,boiled.vessels[0].after!.quality],['raw','safe']);assert.deepEqual(boiled.inventory,[{personId:r.id,item:'wood',before:18,after:17}]);assert.equal(boiled.recipientId,undefined);
 const decanted=complete(w,r,{operation:'decant',vesselId:v.id}).waterSupply!;assert.deepEqual(decanted.inventory,[{personId:r.id,item:'water',before:3,after:6}]);assert.equal(decanted.vessels[0].after!.amount,0);
 const loaded=complete(w,r,{operation:'load',vesselId:v.id,quantity:2}).waterSupply!;assert.deepEqual(loaded.inventory,[{personId:r.id,item:'water',before:6,after:4}]);assert.equal(waterDrunkToday(w,r.id),0);
 const drank=complete(w,r,{operation:'drink',vesselId:v.id}).waterSupply!;assert.equal(drank.recipientId,r.id);assert.equal(drank.quantity,1);assert.equal(drank.vessels[0].after!.amount,1);
 assert.equal(fill.vessels[0].after!.quality,'raw');assert.equal(craft.vessels[0].after!.amount,0,'old records cannot point at the mutable vessel');assert.equal(waterDrunkToday(w,r.id),1);assert.equal('thirst'in r,false);assert.equal(r.health,100);
});

test('normal autonomous menu and engine completion write the same spring and drink facts, not proposed plans',()=>{
 const f=fixture(),{w,r,spring}=f,v=bucket(f);r.at={x:11,y:12};
 for(const operation of ['fillSpring','drink'] as const){
  let choices=decisionChoices(decisionContext(w,r)),choice=choices.find(c=>c.action.type==='waterSupply'&&c.action.operation===operation);
  for(let sample=0;!choice&&sample<16;sample++){w.minute+=30;choices=decisionChoices(decisionContext(w,r));choice=choices.find(c=>c.action.type==='waterSupply'&&c.action.operation===operation);}
  assert.ok(choice,operation+' appears in the rotating normal decision menu');
  const parsed=parseChoice(JSON.stringify({choice:choice.id}),choices),before=w.events.filter(e=>e.waterSupply).length;
  assert.equal(submitPlan(w,{id:'water-history-plan:'+operation,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...parsed}).ok,true);
  assert.equal(w.events.filter(e=>e.waterSupply).length,before);let ticks=200;while(r.plan||r.activity){assert.ok(ticks--);stepWorld(w,1);}assert.equal(r.lastFailure,null);
 }
 const facts=w.events.filter(e=>e.waterSupply).map(e=>e.waterSupply!);assert.equal(facts.length,2);assert.equal(facts[0].source!.before,12);assert.equal(facts[0].source!.after,spring.amount);assert.equal(facts[1].vessels[0].after!.amount,v.amount);assert.equal(facts[1].recipientId,r.id);
});

test('public donation and later refills record both actual containers without attributing refilled water to the original donor',()=>{
 const f=fixture(),{w,r,other,hall}=f,publicBucket=bucket(f,r,2),supply=bucket(f,other,3);slot(f);
 const donation=complete(w,r,{operation:'donate',vesselId:publicBucket.id,buildingId:hall.id}).waterSupply!;
 assert.equal(donation.vessels[0].before!.ownerId,r.id);assert.equal(donation.vessels[0].after!.ownerId,'commons');assert.equal(donation.quantity,2);assert.equal(donation.recipientId,undefined);
 slot(f,other);const refill=complete(w,other,{operation:'refillPublic',vesselId:supply.id,publicVesselId:publicBucket.id,buildingId:hall.id,quantity:3}).waterSupply!;
 assert.equal(refill.actorId,other.id);assert.equal(refill.vessels.length,2);assert.deepEqual(refill.vessels.map(v=>[v.before!.amount,v.after!.amount]),[[3,0],[2,5]]);assert.equal(donation.vessels[0].after!.amount,2);
 const drink=complete(w,other,{operation:'drinkPublic',vesselId:publicBucket.id,buildingId:hall.id}).waterSupply!;assert.equal(drink.recipientId,other.id);assert.equal(drink.vessels[0].before!.ownerId,'commons');assert.equal(drink.vessels[0].after!.amount,4);assert.equal(waterDrunkToday(w,r.id),0);
});

test('guardian and explicitly authorized adult assistance identify the actual drinker, not the provider',()=>{
 const f=fixture(),{w,r,other,child}=f,v=bucket(f,r,4);child.bornAt=w.minute-3*YEAR;child.guardianIds=[r.id];child.canDecide=false;
 const childEvent=complete(w,r,{operation:'serveChild',vesselId:v.id,targetId:child.id});assert.equal(childEvent.waterSupply!.recipientId,child.id);assert.equal(childEvent.waterSupply!.actorId,r.id);
 const auth=complete(w,other,{operation:'authorizeAssist',targetId:r.id}).waterSupply!;assert.equal(auth.quantity,0);assert.equal(auth.recipientId,undefined);assert.equal(auth.authorizationId,auth.receiptId);
 w.health!.cases.push({id:'history-limited-mobility',personId:other.id,kind:'injury',source:'isolated-test',severity:30,stage:'acute',startedAt:w.minute,lastAt:w.minute,resolvedAt:null,treatment:0,capacity:null});
 const assisted=complete(w,r,{operation:'assistDrink',vesselId:v.id,authorizationId:auth.receiptId});assert.equal(assisted.waterSupply!.recipientId,other.id);assert.equal(assisted.waterSupply!.authorizationId,assisted.audit!.evidence);assert.equal(assisted.waterSupply!.vessels[0].before!.amount-assisted.waterSupply!.vessels[0].after!.amount,1);
 const stopped=complete(w,other,{operation:'revokeAssist',authorizationId:auth.receiptId}).waterSupply!;assert.equal(stopped.quantity,0);assert.equal(stopped.vessels.length,0);assert.equal(stopped.authorizationId,auth.receiptId);assert.equal(waterDrunkToday(w,r.id),0);
});

test('gift offers and stops transfer nothing, acceptance snapshots original ownership and water without classifying it as consumption',()=>{
 const f=fixture(),{w,r,child}=f,v=bucket(f,r,4);
 const offer=complete(w,r,{operation:'offerVessel',targetId:child.id,vesselId:v.id}).waterSupply!;assert.equal(offer.giftId,offer.receiptId);assert.equal(offer.quantity,0);assert.deepEqual(offer.vessels[0].before,offer.vessels[0].after);
 const accepted=complete(w,child,{operation:'acceptVessel',giftId:offer.receiptId}).waterSupply!;assert.equal(accepted.quantity,4);assert.equal(accepted.recipientId,undefined);assert.equal(accepted.counterpartyId,r.id);assert.equal(accepted.vessels[0].id,v.id);assert.equal(accepted.vessels[0].before!.ownerId,r.id);assert.equal(accepted.vessels[0].after!.ownerId,child.id);assert.equal(accepted.vessels[0].after!.amount,4);assert.equal(waterDrunkToday(w,child.id),0);
 for(const stop of ['cancelVessel','declineVessel'] as const){const empty=bucket(f),proposal=complete(w,r,{operation:'offerVessel',targetId:child.id,vesselId:empty.id}).waterSupply!;const stopped=complete(w,stop==='cancelVessel'?r:child,{operation:stop,giftId:proposal.receiptId}).waterSupply!;assert.equal(stopped.quantity,0);assert.deepEqual(stopped.vessels[0].before,stopped.vessels[0].after);assert.equal(stopped.giftId,proposal.receiptId);}
});

test('failed actions and receipt retries add no snapshots, and legacy receipts are never retroactively promoted to new facts',()=>{
 const f=fixture(),{w,r}=f,v=bucket(f,r,1),a=action(w,r,{operation:'drink',vesselId:v.id});assert.equal(completeWaterSupply(w,r,a),null);
 const snapshot=JSON.stringify(w);assert.equal(completeWaterSupply(w,r,a),null);assert.equal(JSON.stringify(w),snapshot);
 assert.ok(completeWaterSupply(w,r,action(w,r,{operation:'drink',vesselId:v.id})));assert.equal(JSON.stringify(w),snapshot);
 const legacy=JSON.parse(snapshot) as World;delete legacy.events.at(-1)!.waterSupply;const before=JSON.stringify(legacy);initializeWaterSupply(legacy);assert.equal(completeWaterSupply(legacy,legacy.residents[0],a),null);assert.equal(JSON.stringify(legacy),before);
});

test('structured history filter ignores matching prose, binds pagination to scope and preserves default legacy cursor keys',()=>{
 const f=fixture(),{w,r,other}=f,v=bucket(f,r,2);complete(w,r,{operation:'drink',vesselId:v.id});complete(w,r,{operation:'drink',vesselId:v.id});
 emitEvent(w,{kind:'action',actors:[other.id],place:{...other.at},text:'供水阶段实际饮用1份安全水，仅早期文字记录'});
 const store=new WorldStore(':memory:');try{store.commit(w,null);const before=JSON.stringify(w),query=parseHistoryQuery(new URLSearchParams('water=1&limit=1')),head=store.historyPage(w.id,query);assert.equal(head.events.length,1);assert.ok(head.events[0].waterSupply);assert.ok(head.hasMore);const tail=store.historyPage(w.id,{...query,cursor:head.nextCursor!});assert.equal(tail.events.length,1);assert.notEqual(tail.events[0].id,head.events[0].id);assert.equal(tail.hasMore,false);assert.throws(()=>store.historyPage(w.id,{cursor:head.nextCursor!}),HistoryQueryError);assert.equal(store.historyPage(w.id,{waterOnly:true,personId:other.id}).events.length,0);assert.equal(store.historyPage(w.id,{waterOnly:true,kind:'care'}).events.length,0);assert.equal(store.historyPage(w.id,{waterOnly:true,to:600}).events.length,0);assert.equal(store.historyPage(w.id,{q:'早期文字'}).events.length,1);assert.equal(JSON.stringify(w),before);
  const q=normalizeHistory({personId:r.id});assert.equal(historyKey(q),createHash('sha256').update(JSON.stringify([q.personId,q.kind,q.conversationId,q.q,q.from,q.to,q.populationOnly])).digest('base64url'));
 }finally{store.close();}
 for(const query of ['water=true','water=1&water=0','water=','water=2'])assert.throws(()=>parseHistoryQuery(new URLSearchParams(query)),HistoryQueryError);assert.throws(()=>normalizeHistory({waterOnly:'1'} as never),HistoryQueryError);
});

test('durable archive retains old water snapshots after the recent window, ownership changes and restart',()=>{
 const f=fixture(),{w,r,other}=f,v=bucket(f,r,1),event=complete(w,r,{operation:'drink',vesselId:v.id}),historical=structuredClone(event),dir=mkdtempSync(join(testTmpdir(),'water-history-test-')),path=join(dir,'synthetic.sqlite');let store=new WorldStore(path);
 try{store.commit(w,null);const previous=w.revision;w.minute+=100;r.memories=[];for(const p of w.residents)p.memories=[];v.ownerId=other.id;v.amount=6;
  for(let i=0;i<200;i++)emitEvent(w,{kind:'system',actors:[],place:{x:0,y:0},text:'later unrelated fact '+i});
  store.commit(w,previous);store.close();store=new WorldStore(path);const restored=store.loadForRuntime()!;assert.ok(!restored.events.some(e=>e.id===event.id));assert.deepEqual(store.historyPage(w.id,{waterOnly:true}).events,[historical]);assert.equal(restored.waterSupply!.vessels[0].ownerId,other.id);assert.equal(restored.waterSupply!.vessels[0].amount,6);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('water history presentation uses event snapshots only, escapes identifiers and labels legacy facts as lacking snapshots',()=>{
 const f=fixture(),{w,r}=f,v=bucket(f,r,2);v.id='<script>bucket</script>';const e=complete(w,r,{operation:'drink',vesselId:v.id}),before=waterEventDetails(e);v.amount=6;v.ownerId='someone-else';assert.equal(waterEventDetails(e),before);assert.match(before,/实际饮用 1份/);assert.match(before,/2 \/ 6份/);assert.match(before,/1 \/ 6份/);assert.match(before,/&lt;script&gt;/);assert.ok(!before.includes('<script>'));assert.match(before,/尚未启用口渴/);assert.match(archiveTimeline([e],w),/这次供水的实物记录/);
 const legacy={...e};delete legacy.waterSupply;assert.equal(waterEventDetails(legacy),'');assert.ok(!archiveTimeline([legacy],w).includes('这次供水的实物记录'));
});

test('reader transmits water scope and notices only matching new facts while keeping an older page stable',async()=>{
 const f=fixture(),{w,r}=f,v=bucket(f,r,2),event=complete(w,r,{operation:'drink',vesselId:v.id});const urls:URL[]=[];
 const fetcher=(async(input:URL)=>{urls.push(new URL(input));return new Response(JSON.stringify({worldId:w.id,events:[event],hasMore:urls.length===1,nextCursor:urls.length===1?'older':null,observedRevision:w.revision} satisfies HistoryPage),{headers:{'content-type':'application/json'}});}) as typeof fetch;
 const reader=new HistoryReader('http://localhost/api/',()=>{},fetcher);try{await reader.configure(w.id,{waterOnly:true});assert.equal(urls[0].searchParams.get('water'),'1');await reader.older();assert.equal(reader.index,1);emitEvent(w,{kind:'action',actors:[r.id],place:r.at,text:'仅谈到饮水，不是完成事实'});reader.observe(w,true);assert.equal(reader.news,false);complete(w,r,{operation:'drink',vesselId:v.id});reader.observe(w,true);assert.equal(reader.news,true);assert.equal(reader.page!.events[0].id,event.id);assert.match(archiveControls('chronicle',reader,w),/早期文字记录/);assert.ok(!archiveControls('chronicle',reader,w).includes('name="water"'),'fixed scope has no editable duplicate');
 }finally{reader.destroy();}
});

test('opened water details survive panel replacement without opening unrelated events or undoing a manual close',()=>{
 let details=[{dataset:{waterEvent:'same'},open:true},{dataset:{waterEvent:'closed'},open:false}];
 const root={querySelectorAll:()=>details} as unknown as ParentNode;let restore=rememberWaterDetails(root);
 details=[{dataset:{waterEvent:'same'},open:false},{dataset:{waterEvent:'closed'},open:false},{dataset:{waterEvent:'new'},open:false}];restore();assert.deepEqual(details.map(d=>d.open),[true,false,false]);
 details[0].open=false;restore=rememberWaterDetails(root);details=[{dataset:{waterEvent:'same'},open:false}];restore();assert.equal(details[0].open,false);
});
