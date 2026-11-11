import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {initializeEconomy} from '../src/world/economy.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents){Object.assign(r,{at:{x:10,y:10},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:0,knownBuildings:[],knownResources:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null});}
 const [giver,recipient,other]=w.residents;giver.inventory={turnip:3,wood:5};initializeFood(w);return {w,giver,recipient,other};
}
function menu(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
function gifts(w:World,r:Resident){return menu(w,r).filter(c=>(c.action as {type:string}).type==='personalFoodGift');}
function choice(w:World,r:Resident,operation:string,fields:Record<string,unknown>={}){const choices=menu(w,r),c=choices.find(c=>{const a=c.action as unknown as Record<string,unknown>;return a.type==='personalFoodGift'&&a.operation===operation&&Object.entries(fields).every(([k,v])=>k==='quantity'||a[k]===v);});assert.ok(c,`missing ${operation} choice for ${r.id}`);return parseChoice(JSON.stringify({choice:c.id,...('quantity' in fields?{quantity:fields.quantity}:{})}),choices).actions[0];}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`personal-gift:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择食物赠与',actions:[a]});}
function finish(w:World,r:Resident){let n=200;while(r.plan||r.activity){assert.ok(n--,'action must terminate');stepWorld(w,1);}}
function rejected(w:World,r:Resident,a:Action){const result=queue(w,r,a);if(result.ok){finish(w,r);assert.ok(r.lastFailure,'invalid action must fail at execution');}}
function run(w:World,r:Resident,a:Action){const result=queue(w,r,a);assert.equal(result.ok,true,JSON.stringify(result));finish(w,r);assert.equal(r.lastFailure,null);}

function record(w:World){return w.personalFoodGifts!.gifts.at(-1)!;}
function offered(f:ReturnType<typeof fixture>,quantity=1){run(f.w,f.giver,choice(f.w,f.giver,'offer',{recipientId:f.recipient.id,item:'turnip',quantity}));return record(f.w);}
function accepted(f:ReturnType<typeof fixture>,quantity=1){const g=offered(f,quantity);run(f.w,f.recipient,choice(f.w,f.recipient,'accept',{giftId:g.id}));return g;}


test('review: immutable terms and acceptance place reject mutation independently',()=>{
 for(const field of ['quantity','item','expiresAt','giverId','location','acceptedAt','eventIds']){
  const f=fixture(),g=accepted(f),a=choice(f.w,f.giver,'deliver',{giftId:g.id});
  if(field==='quantity')g.quantity=2;if(field==='item')g.item='meal';if(field==='expiresAt')g.expiresAt++;if(field==='giverId')g.giverId=f.other.id;if(field==='location')g.location.at.x++;if(field==='acceptedAt')g.acceptedAt!++;if(field==='eventIds')g.eventIds=[];
  rejected(f.w,f.giver,a);assert.equal(f.recipient.inventory.turnip??0,0,field);
 }
});
test('review: recipient withdrawal before final work tick is immediately effective',()=>{
 const f=fixture(),g=accepted(f);f.giver.at={x:7,y:10};assert.equal(queue(f.w,f.giver,choice(f.w,f.giver,'deliver',{giftId:g.id})).ok,true);
 let n=20;do {stepWorld(f.w,1);assert.ok(n--);}while(f.giver.activity?.path.length);
 assert.ok(f.giver.activity);assert.equal(f.recipient.inventory.turnip??0,0);
 assert.equal(queue(f.w,f.recipient,choice(f.w,f.recipient,'decline',{giftId:g.id})).ok,true);assert.equal(g.status,'declined');finish(f.w,f.giver);assert.equal(f.recipient.inventory.turnip??0,0);
});
test('review: missing optional state in an old save initializes without gifts or transfers',()=>{
 const f=fixture();delete f.w.personalFoodGifts;const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!;stepWorld(w,1);assert.equal(w.personalFoodGifts!.gifts.length,0);assert.equal(w.residents[0].inventory.turnip,3);}finally{store.close();}
});
test('review: delivery cannot replay after SQLite reload even with a newly numbered plan',()=>{
 const f=fixture(),g=accepted(f),a=choice(f.w,f.giver,'deliver',{giftId:g.id});run(f.w,f.giver,a);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,giver=w.residents.find(r=>r.id===f.giver.id)!,recipient=w.residents.find(r=>r.id===f.recipient.id)!;rejected(w,giver,structuredClone(a));assert.equal(recipient.inventory.turnip,1);assert.equal(giver.inventory.turnip,2);}finally{store.close();}
});
test('review: malformed action extension and missing fields cannot change inventory',()=>{
 for(const key of ['quantity','recipientId','item','receiptId','operation']){const f=fixture(),a=choice(f.w,f.giver,'offer',{recipientId:f.recipient.id,item:'turnip'}) as unknown as Record<string,unknown>;delete a[key];rejected(f.w,f.giver,a as Action);assert.equal(f.recipient.inventory.turnip??0,0);assert.equal(f.w.personalFoodGifts?.gifts.length??0,0);}
 const f=fixture(),a=choice(f.w,f.giver,'offer',{recipientId:f.recipient.id,item:'turnip'});rejected(f.w,f.giver,{...a,autoEat:true} as unknown as Action);assert.equal(f.w.personalFoodGifts?.gifts.length??0,0);
});
test('review: outsider receives no gift event memory or participant opportunity',()=>{
 const f=fixture();f.other.at={x:30,y:10};const before=structuredClone(f.other.memories),g=accepted(f);run(f.w,f.giver,choice(f.w,f.giver,'deliver',{giftId:g.id}));assert.deepEqual(f.other.memories,before);assert.equal(gifts(f.w,f.other).length,0);assert.ok(g.eventIds.every(id=>!f.w.events.find(e=>e.id===id)!.witnesses.includes(f.other.id)));
});
test('review: acceptance proof must identify recipient as an actor, not merely a witness',()=>{
 const f=fixture(),g=accepted(f);const proof=f.w.events.find(e=>e.audit?.rule==='personal-food-gift/accept@2')!;proof.actors=[f.giver.id];const a={type:'personalFoodGift',operation:'deliver',giftId:g.id} as Action;rejected(f.w,f.giver,a);assert.equal(f.recipient.inventory.turnip??0,0);
});

import {roomLayout} from '../src/shared/rooms.js';
import {initializeRooms} from '../src/world/rooms.js';
function indoor(){const f=fixture();initializeRooms(f.w);const b=structuredClone(createWorld().buildings.find(b=>b.kind==='home')!);Object.assign(b,{id:'review-home',door:{x:10,y:10},at:{x:9,y:6},width:4,height:3,ownerId:f.recipient.id,residents:[f.giver.id,f.recipient.id]});f.w.buildings=[b];const entry=roomLayout(f.w,b).entry;for(const r of [f.giver,f.recipient]){r.inside=b.id;r.roomAt={...entry};}return {...f,b};}
test('review: indoor handoff uses real accepted room and rejects revoked access',()=>{
 for(const revoke of [false,true]){const f=indoor(),g=accepted(f);f.giver.inside=null;f.giver.roomAt=null;f.giver.at={x:6,y:10};assert.equal(queue(f.w,f.giver,choice(f.w,f.giver,'deliver',{giftId:g.id})).ok,true);stepWorld(f.w,1);if(revoke)f.b.residents=[f.recipient.id];finish(f.w,f.giver);assert.equal(f.recipient.inventory.turnip??0,revoke?0:1,JSON.stringify({failure:f.giver.lastFailure,at:f.giver.at,inside:f.giver.inside,roomAt:f.giver.roomAt,door:f.b.door}));if(!revoke){assert.equal(f.giver.inside,f.b.id);assert.deepEqual(f.giver.roomAt,g.location.roomAt);}}
});
test('review: new room obstruction cannot be crossed on a saved delivery path',()=>{
 const f=indoor();for(const r of [f.giver,f.recipient])r.roomAt={x:4,y:9};const g=accepted(f);f.giver.roomAt={x:8,y:11};assert.equal(queue(f.w,f.giver,choice(f.w,f.giver,'deliver',{giftId:g.id})).ok,true);stepWorld(f.w,1);const next=f.giver.activity!.room!.path[0];assert.ok(next);f.other.status='dead';f.other.inside=f.b.id;f.other.roomAt={...next};f.other.body={storedAt:f.b.id,carriedBy:null} as Resident['body'];finish(f.w,f.giver);assert.equal(f.recipient.inventory.turnip??0,0);assert.notDeepEqual(f.giver.roomAt,next);
});

import {completePersonalFoodGift} from '../src/world/personal-food-gifts.js';
test('review: direct completion without actual work cannot offer or transfer',()=>{
 const f=fixture(),offer=choice(f.w,f.giver,'offer',{recipientId:f.recipient.id,item:'turnip'});assert.ok(offer.type==='personalFoodGift');assert.ok(completePersonalFoodGift(f.w,f.giver,offer));assert.equal(f.w.personalFoodGifts?.gifts.length??0,0);const g=accepted(f),delivery=choice(f.w,f.giver,'deliver',{giftId:g.id});assert.ok(delivery.type==='personalFoodGift');assert.ok(completePersonalFoodGift(f.w,f.giver,delivery));assert.equal(f.recipient.inventory.turnip??0,0);
});
test('review: nonfinite carried stock and recipient capacity fail closed',()=>{
 for(const bad of [NaN,Infinity,-Infinity]){const f=fixture(),g=accepted(f),a=choice(f.w,f.giver,'deliver',{giftId:g.id});f.recipient.inventory.turnip=bad;rejected(f.w,f.giver,a);assert.notEqual(g.status,'delivered');assert.equal(f.giver.inventory.turnip,3);}
});

test('review: remote decline cannot reveal an unknown free offer slot',()=>{
 const f=fixture();offered(f);offered(f);const g=offered(f);f.giver.at={x:25,y:10};f.other.at={x:25,y:10};
 const actions=()=>gifts(f.w,f.giver).map(c=>c.action);
 const before=structuredClone(actions());assert.equal(before.some(a=>a.type==='personalFoodGift'&&a.operation==='offer'),false);
 assert.equal(queue(f.w,f.recipient,choice(f.w,f.recipient,'decline',{giftId:g.id})).ok,true);
 assert.deepEqual(actions(),before,'remote cancellation must not free a visibly known offer slot');
});
test('review: negative recipient inventory cannot absorb a gift',()=>{
 const f=fixture(),g=accepted(f),a=choice(f.w,f.giver,'deliver',{giftId:g.id});f.recipient.inventory.turnip=-1;
 rejected(f.w,f.giver,a);assert.notEqual(g.status,'delivered');assert.equal(f.giver.inventory.turnip,3);
});
test('review: withdrawal at the last quarter-minute of handoff prevents transfer',()=>{
 const f=fixture(),g=accepted(f);assert.equal(queue(f.w,f.giver,choice(f.w,f.giver,'deliver',{giftId:g.id})).ok,true);
 stepWorld(f.w,.25);stepWorld(f.w,.25);stepWorld(f.w,.25);
 assert.ok(f.giver.activity);assert.equal(f.giver.activity.foodGiftWork?.minutes,.75);assert.equal(f.recipient.inventory.turnip??0,0);
 assert.equal(queue(f.w,f.recipient,choice(f.w,f.recipient,'decline',{giftId:g.id})).ok,true);assert.equal(g.status,'declined');stepWorld(f.w,.25);assert.equal(f.recipient.inventory.turnip??0,0);assert.equal(f.giver.inventory.turnip,3);
});

import {focusedChoices} from '../src/server/agency-opportunities.js';
test('review: gift insertion preserves existing non-reflection menu choices and ordering',()=>{
 const f=fixture(),context=decisionContext(f.w,f.giver),base=menu(f.w,f.giver).filter(c=>c.action.type!=='personalFoodGift'),gift=gifts(f.w,f.giver)[0];assert.ok(gift);
 const talk=base.find(c=>c.action.type==='talk');assert.ok(talk);
 const crowded=[...base,...Array.from({length:80},(_,i)=>({...talk,id:'review-talk-'+i}))];
 const baseline=focusedChoices(context,crowded),withGift=focusedChoices(context,[gift,...crowded]);
 const ordinary=(list:typeof baseline)=>list.filter(c=>c.action.type!=='personalFoodGift'&&!(c.action.type==='agency'&&c.action.operation==='reflect'));
 assert.deepEqual(ordinary(withGift),ordinary(baseline));assert.ok(withGift.length<=56);
});
