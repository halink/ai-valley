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

test('personal gift final menu exposes own food offer to a nearby capable adult',()=>{
 const {w,giver,recipient}=fixture();const a=choice(w,giver,'offer',{recipientId:recipient.id,item:'turnip'});assert.equal(a.type,'personalFoodGift');
});
test('personal gift final menus are read-only and never expose another owner food',()=>{
 const {w,giver,recipient}=fixture();menu(w,giver);menu(w,recipient);const before=structuredClone(w);assert.ok(gifts(w,giver).length);assert.equal(gifts(w,recipient).length,0);menu(w,giver);assert.deepEqual(w,before);
});
test('personal gift offers exclude under-six, incapable people and absent residents',()=>{
 const {w,giver,recipient,other}=fixture();recipient.bornAt=w.minute-5*YEAR;other.canDecide=false;
 assert.equal(gifts(w,giver).length,0);recipient.bornAt=w.minute-30*YEAR;recipient.residency='outside';assert.equal(gifts(w,giver).length,0);
 recipient.residency='visitor';assert.ok(gifts(w,giver).some(c=>(c.action as unknown as {recipientId:string}).recipientId===recipient.id));
});

function record(w:World){return w.personalFoodGifts!.gifts.at(-1)!;}
function offered(f:ReturnType<typeof fixture>,quantity=1){run(f.w,f.giver,choice(f.w,f.giver,'offer',{recipientId:f.recipient.id,item:'turnip',quantity}));return record(f.w);}
function accepted(f:ReturnType<typeof fixture>,quantity=1){const g=offered(f,quantity);run(f.w,f.recipient,choice(f.w,f.recipient,'accept',{giftId:g.id}));return g;}

test('offer, recipient acceptance and giver delivery are three independent choices; original food lots survive intact',()=>{
 const f=fixture(),{w,giver,recipient}=f,lot=structuredClone(w.food!.lots['person:'+giver.id]!.turnip![0]),g=offered(f,2);
 assert.equal(g.expiresAt-g.offeredAt,120);assert.equal(giver.inventory.turnip,3);assert.equal(recipient.inventory.turnip??0,0);assert.deepEqual(w.food!.lots['person:'+giver.id]!.turnip,[lot]);
 run(w,recipient,choice(w,recipient,'accept',{giftId:g.id}));assert.equal(g.status,'accepted');assert.equal(giver.inventory.turnip,3);assert.equal(recipient.inventory.turnip??0,0);
 const health=recipient.health,hunger=recipient.hunger;run(w,giver,choice(w,giver,'deliver',{giftId:g.id}));assert.equal(g.status,'delivered');assert.equal(giver.inventory.turnip,1);assert.equal(recipient.inventory.turnip,2);assert.equal(recipient.health,health);assert.ok(recipient.hunger>=hunger,'gift is not eating');
 assert.deepEqual(w.food!.lots['person:'+recipient.id]!.turnip,[{...lot,quantity:2}]);assert.deepEqual(w.food!.lots['person:'+giver.id]!.turnip,[{...lot,quantity:1}]);
 assert.equal(gifts(w,giver).some(c=>(c.action as unknown as {operation:string;giftId:string}).operation==='deliver'&&(c.action as unknown as {giftId:string}).giftId===g.id),false);
});

test('recipient later chooses the existing eat action independently',()=>{
 const f=fixture(),{w,giver,recipient}=f,g=accepted(f);run(w,giver,choice(w,giver,'deliver',{giftId:g.id}));recipient.hunger=70;
 const choices=menu(w,recipient),eat=choices.find(c=>c.action.type==='eat'&&c.action.item==='turnip');assert.ok(eat);run(w,recipient,parseChoice(JSON.stringify({choice:eat.id}),choices).actions[0]);assert.equal(recipient.inventory.turnip??0,0);assert.ok(recipient.hunger<70);assert.equal(g.status,'delivered');
});

test('giver walks back to frozen accepted location; no inventory changes before arrival',()=>{
 const f=fixture(),{w,giver,recipient}=f,g=accepted(f);giver.at={x:1,y:10};const original=structuredClone(recipient.at);assert.equal(queue(w,giver,choice(w,giver,'deliver',{giftId:g.id})).ok,true);stepWorld(w,1);
 assert.ok(giver.activity);assert.equal(giver.inventory.turnip,3);assert.equal(recipient.inventory.turnip??0,0);assert.deepEqual(recipient.at,original);finish(w,giver);assert.equal(g.status,'delivered');assert.equal(recipient.inventory.turnip,1);
});

test('recipient independently declines an offer, and either participant can cancel acceptance',()=>{
 for(const operation of ['decline','giverCancel','recipientCancel']){const f=fixture(),{w,giver,recipient}=f,g=operation==='decline'?offered(f):accepted(f);const actor=operation==='giverCancel'?giver:recipient;run(w,actor,choice(w,actor,operation==='giverCancel'?'cancel':'decline',{giftId:g.id}));assert.equal(g.status,operation==='giverCancel'?'cancelled':'declined');assert.equal(giver.inventory.turnip,3);assert.equal(recipient.inventory.turnip??0,0);}
});

test('busy delivering giver can immediately cancel with a single independent choice',()=>{
 const f=fixture(),{w,giver,recipient}=f,g=accepted(f);giver.at={x:1,y:10};assert.equal(queue(w,giver,choice(w,giver,'deliver',{giftId:g.id})).ok,true);stepWorld(w,1);assert.ok(giver.activity);assert.equal(queue(w,giver,choice(w,giver,'cancel',{giftId:g.id})).ok,true);assert.equal(g.status,'cancelled');assert.equal(giver.activity,null);assert.equal(giver.inventory.turnip,3);assert.equal(recipient.inventory.turnip??0,0);
});

test('offer and accepted promise expire without giving or reserving food',()=>{
 for(const accept of [false,true]){const f=fixture(),{w,giver,recipient}=f,g=accept?accepted(f):offered(f);w.minute=g.expiresAt;stepWorld(w,1);assert.equal(g.status,'expired');assert.equal(giver.inventory.turnip,3);assert.equal(recipient.inventory.turnip??0,0);assert.equal(gifts(w,recipient).some(c=>(c.action as unknown as {operation:string}).operation==='accept'),false);}
});

test('competing consumption and spoilage prevent delivery without replacing the food',()=>{
 for(const cause of ['eaten','spoiled']){const f=fixture(),{w,giver,recipient}=f,g=accepted(f,3);if(cause==='eaten')run(w,giver,{type:'eat',item:'turnip'});else {for(const l of w.food!.lots['person:'+giver.id]!.turnip!)l.expiresAt=w.minute;stepWorld(w,1);}
 const a={type:'personalFoodGift',operation:'deliver',giftId:g.id} as Action;const result=queue(w,giver,a);if(result.ok)finish(w,giver);assert.notEqual(g.status,'delivered');assert.equal(recipient.inventory.turnip??0,0);assert.ok((giver.inventory.turnip??0)<3);}
});

test('malformed quantities, non-food, unknown identities and forged public stock are rejected',()=>{
 for(const fields of [{quantity:0},{quantity:-1},{quantity:1.5},{quantity:4},{quantity:NaN},{quantity:Infinity},{item:'wood'},{item:'not-food'},{recipientId:'unknown-person'},{recipientId:'lin'}]){const {w,giver,recipient}=fixture();const base=choice(w,giver,'offer',{recipientId:recipient.id,item:'turnip',quantity:1});const before=structuredClone(giver.inventory);rejected(w,giver,{...base,...fields} as Action);assert.equal(w.personalFoodGifts?.gifts.length??0,0);assert.deepEqual(giver.inventory,before);}
 const {w,giver,recipient}=fixture();const a=choice(w,giver,'offer',{recipientId:recipient.id,item:'turnip',quantity:1});giver.inventory={};initializeEconomy(w);w.economy!.treasuryStock={turnip:100};rejected(w,giver,a);assert.equal(w.personalFoodGifts?.gifts.length??0,0);assert.equal(recipient.inventory.turnip??0,0);
});

test('saved offer actions cannot bypass age, capacity, distance or outside status',()=>{
 for(const change of ['minorGiver','minorRecipient','incapableGiver','incapableRecipient','silentRecipient','outside','far']){const {w,giver,recipient}=fixture(),a=choice(w,giver,'offer',{recipientId:recipient.id,item:'turnip',quantity:1});if(change==='minorGiver')giver.bornAt=w.minute-12*YEAR;if(change==='minorRecipient')recipient.bornAt=w.minute-12*YEAR;if(change==='incapableGiver')giver.canDecide=false;if(change==='incapableRecipient')recipient.canDecide=false;if(change==='silentRecipient')recipient.canExpress=false;if(change==='outside')recipient.residency='outside';if(change==='far')recipient.at={x:30,y:10};rejected(w,giver,a);assert.equal(w.personalFoodGifts?.gifts.length??0,0);assert.equal(giver.inventory.turnip,3);}
});

test('recipient movement never retargets walking giver or transfers food remotely',()=>{
 const f=fixture(),{w,giver,recipient}=f,g=accepted(f);giver.at={x:1,y:10};assert.equal(queue(w,giver,choice(w,giver,'deliver',{giftId:g.id})).ok,true);stepWorld(w,1);const target=structuredClone(giver.activity!.target);recipient.at={x:30,y:10};finish(w,giver);assert.notEqual(g.status,'delivered');assert.equal(recipient.inventory.turnip??0,0);assert.equal(giver.inventory.turnip,3);assert.ok(giver.at.x<20);assert.deepEqual(target,{x:10,y:10});
});

test('route loss during delivery cannot teleport food across an impassable map',()=>{
 const f=fixture(),{w,giver,recipient}=f,g=accepted(f);giver.at={x:1,y:10};assert.equal(queue(w,giver,choice(w,giver,'deliver',{giftId:g.id})).ok,true);stepWorld(w,1);for(let y=0;y<w.map.height;y++)w.map.tiles[y*w.map.width+5]='water';finish(w,giver);assert.notEqual(g.status,'delivered');assert.equal(recipient.inventory.turnip??0,0);assert.equal(giver.inventory.turnip,3);
});

test('remote cancellation does not alter the other participant known menu or memories',()=>{
 const f=fixture(),{w,giver,recipient}=f,g=accepted(f);giver.at={x:1,y:10};const before=gifts(w,giver),memories=structuredClone(giver.memories);assert.equal(queue(w,recipient,choice(w,recipient,'decline',{giftId:g.id})).ok,true);assert.equal(g.status,'declined');assert.deepEqual(gifts(w,giver),before);assert.deepEqual(giver.memories,memories);assert.equal(giver.inventory.turnip,3);
});

test('memory-store reload during walking preserves deadline, route and exactly one transfer',()=>{
 const f=fixture(),g=accepted(f),{w,giver}=f;giver.at={x:1,y:10};assert.equal(queue(w,giver,choice(w,giver,'deliver',{giftId:g.id})).ok,true);stepWorld(w,1);const store=new WorldStore(':memory:');try {store.commit(w,null);const loaded=store.load()!,r=loaded.residents.find(r=>r.id===giver.id)!,to=loaded.residents.find(r=>r.id===f.recipient.id)!;assert.equal(record(loaded).expiresAt,g.expiresAt);assert.deepEqual(r.activity,giver.activity);finish(loaded,r);assert.equal(record(loaded).status,'delivered');assert.equal(to.inventory.turnip,1);assert.equal(r.inventory.turnip,2);const events=record(loaded).eventIds.slice();stepWorld(loaded,5);assert.equal(to.inventory.turnip,1);assert.deepEqual(record(loaded).eventIds,events);}finally{store.close();}
});

test('crowded final menus preserve self-care and bounded personally owned food gifts',()=>{
 const {w,giver}=fixture();for(let n=0;n<35;n++){const r=structuredClone(w.residents[1]);r.id='crowded-'+n;r.name='Nearby '+n;w.residents.push(r);}giver.hunger=80;const choices=menu(w,giver);assert.ok(choices.some(c=>c.action.type==='eat'));assert.ok(choices.some(c=>(c.action as {type:string}).type==='personalFoodGift'));assert.ok(choices.some(c=>c.action.type==='wait'));assert.ok(gifts(w,giver).every(c=>{const a=c.action as unknown as {item:string;quantity:number};return a.item==='turnip'&&a.quantity>=1&&a.quantity<=3;}));
});

test('no offer or acceptance is invented by time passing or old care ties',()=>{
 const {w,giver,recipient}=fixture();recipient.guardianIds=[giver.id];recipient.hunger=90;const stock=structuredClone(giver.inventory);stepWorld(w,5);assert.equal(w.personalFoodGifts?.gifts.length??0,0);assert.deepEqual(giver.inventory,stock);assert.equal(recipient.inventory.turnip??0,0);
});

test('recipient must actually meet giver to accept; another actor cannot accept the saved offer',()=>{
 for(const failure of ['far','thirdParty','incapable']){const f=fixture(),{w,giver,recipient,other}=f,g=offered(f),a=choice(w,recipient,'accept',{giftId:g.id});if(failure==='far')giver.at={x:30,y:10};if(failure==='incapable')recipient.canDecide=false;rejected(w,failure==='thirdParty'?other:recipient,a);assert.equal(g.status,'offered');assert.equal(recipient.inventory.turnip??0,0);}
});

test('cancellation cannot be hidden in a longer plan or performed by an unrelated actor',()=>{
 const f=fixture(),{w,giver,other}=f,g=accepted(f),a=choice(w,giver,'cancel',{giftId:g.id});assert.equal(queue(w,other,a).ok,false);
 const result=submitPlan(w,{id:'invalid-cancel-bundle',actorId:giver.id,actorRevision:giver.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'invalid bundled cancellation',actions:[a,{type:'wait',minutes:5}]});assert.equal(result.ok,false);assert.equal(g.status,'accepted');
});

test('delivery failure on recipient incapacity or death never feeds them or creates authority',()=>{
 for(const cause of ['incapacity','death','outside']){const f=fixture(),{w,giver,recipient}=f,g=accepted(f);giver.at={x:1,y:10};assert.equal(queue(w,giver,choice(w,giver,'deliver',{giftId:g.id})).ok,true);stepWorld(w,1);if(cause==='incapacity')recipient.canDecide=false;if(cause==='death')recipient.status='dead';if(cause==='outside')recipient.residency='outside';finish(w,giver);assert.notEqual(g.status,'delivered');assert.equal(recipient.inventory.turnip??0,0);assert.equal(giver.inventory.turnip,3);assert.deepEqual(recipient.guardianIds,[]);}
});
