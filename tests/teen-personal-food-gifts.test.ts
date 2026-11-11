import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PersonalFoodGiftAction} from '../src/shared/personal-food-gifts.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFood} from '../src/world/food.js';
import {initializeEconomy} from '../src/world/economy.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {ageAllowsChoice} from '../src/world/family.js';
import {personalFoodGiftReceiptId} from '../src/world/personal-food-gifts.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(giverAge=13,recipientAge=6){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents)Object.assign(r,{at:{x:10,y:10},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:0,knownBuildings:[],knownResources:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null});
 const [giver,recipient,other]=w.residents;giver.bornAt=w.minute-giverAge*YEAR;recipient.bornAt=w.minute-recipientAge*YEAR;other.at={x:30,y:10};giver.inventory={turnip:3,wood:5};initializeFood(w);return {w,giver,recipient,other};
}
function menu(w:World,r:Resident){const rows=decisionChoices(decisionContext(w,r));assert.ok(rows.every((c,i)=>c.id===String(i+1)));return rows;}
function giftChoices(w:World,r:Resident){return menu(w,r).filter(c=>c.action.type==='personalFoodGift');}
function choose(w:World,r:Resident,operation:string,quantity?:number){const rows=menu(w,r),row=rows.find(c=>c.action.type==='personalFoodGift'&&c.action.operation===operation);assert.ok(row,`missing ${operation} for ${r.id}`);return parseChoice(JSON.stringify({choice:row.id,...(quantity===undefined?{}:{quantity})}),rows).actions[0] as PersonalFoodGiftAction;}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`teen-gift:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立赠送或接受自有食品',actions:[a]});}
function finish(w:World,r:Resident){let left=200;while(r.plan||r.activity){assert.ok(left--);stepWorld(w,1);}}
function run(w:World,r:Resident,a:Action){const result=queue(w,r,a);assert.equal(result.ok,true,result.error);finish(w,r);assert.equal(r.lastFailure,null);}
function reject(w:World,r:Resident,a:Action){const result=queue(w,r,a);if(result.ok){finish(w,r);assert.ok(r.lastFailure);}}
function offer(f:ReturnType<typeof fixture>){run(f.w,f.giver,choose(f.w,f.giver,'offer'));return f.w.personalFoodGifts!.gifts.at(-1)!;}
function accept(f:ReturnType<typeof fixture>){const g=offer(f);run(f.w,f.recipient,choose(f.w,f.recipient,'accept'));return g;}

test('teen: real final numbered menus independently offer, accept, walk, deliver and eat one original portion',()=>{
 const f=fixture(),{w,giver,recipient}=f,lot=structuredClone(w.food!.lots['person:'+giver.id]!.turnip![0]),g=offer(f);
 assert.equal(g.ageTerms?.maxQuantity,1);assert.equal(g.expiresAt-g.offeredAt,120);assert.equal(giver.inventory.turnip,3);assert.equal(recipient.inventory.turnip??0,0);
 assert.ok(w.events.some(e=>e.audit?.rule==='personal-food-gift/offer@2'));
 run(w,recipient,choose(w,recipient,'accept'));assert.equal(g.status,'accepted');assert.equal(recipient.inventory.turnip??0,0);
 giver.at={x:1,y:10};const health=recipient.health,hunger=recipient.hunger;assert.equal(queue(w,giver,choose(w,giver,'deliver')).ok,true);stepWorld(w,1);assert.ok(giver.activity?.path.length);assert.equal(recipient.inventory.turnip??0,0);finish(w,giver);
 assert.equal(g.status,'delivered');assert.equal(giver.inventory.turnip,2);assert.equal(recipient.inventory.turnip,1);assert.equal(recipient.health,health);assert.ok(recipient.hunger>=hunger);
 assert.deepEqual(w.food!.lots['person:'+recipient.id]!.turnip,[{...lot,quantity:1}]);assert.deepEqual(recipient.guardianIds,[]);
 recipient.hunger=70;const rows=menu(w,recipient),eat=rows.find(c=>c.action.type==='eat'&&c.action.item==='turnip');assert.ok(eat);run(w,recipient,parseChoice(JSON.stringify({choice:eat.id}),rows).actions[0]);assert.equal(recipient.inventory.turnip??0,0);assert.ok(recipient.hunger<70);
});

test('teen: one-portion cap applies to either minor, adults retain three portions',()=>{
 for(const [from,to,limit] of [[13,6,1],[17,30,1],[30,6,1],[30,17,1],[18,18,3]]){const f=fixture(from,to);const a=choose(f.w,f.giver,'offer');assert.ok(a.operation==='offer');assert.equal(a.ageTerms?.maxQuantity,limit);if(limit===1){assert.throws(()=>choose(f.w,f.giver,'offer',2));reject(f.w,f.giver,{...a,quantity:2});assert.equal(f.w.personalFoodGifts?.gifts.length??0,0);}else{run(f.w,f.giver,choose(f.w,f.giver,'offer',3));run(f.w,f.recipient,choose(f.w,f.recipient,'accept'));run(f.w,f.giver,choose(f.w,f.giver,'deliver'));assert.equal(f.recipient.inventory.turnip,3);}}
});

test('teen: strict six and thirteen birthday boundaries expose no premature authority',()=>{
 for(const boundary of ['giver','recipient'] as const){const f=fixture(),r=f[boundary],min=boundary==='giver'?13:6;r.bornAt=f.w.minute-min*YEAR+.25;assert.equal(giftChoices(f.w,f.giver).some(c=>c.action.type==='personalFoodGift'&&c.action.operation==='offer'),false);f.w.minute+=.25;assert.equal(choose(f.w,f.giver,'offer').operation,'offer');}
 for(const operation of ['offer','deliver','cancel','accept','decline'] as const){const a=(operation==='offer'?{type:'personalFoodGift',operation,recipientId:'x',item:'turnip',quantity:1,receiptId:'x'}:{type:'personalFoodGift',operation,giftId:'x'}) as Action;assert.equal(ageAllowsChoice(6,a),operation==='accept'||operation==='decline');}
});

test('teen: unknown, nonfinite and future birth timestamps fail closed for both parties',()=>{
 for(const role of ['giver','recipient'] as const)for(const date of [undefined,null,NaN,Infinity,-Infinity,601,Number.MAX_SAFE_INTEGER+1]){const f=fixture();f[role].bornAt=date as number;const before=f[role].bornAt;assert.equal(giftChoices(f.w,f.giver).length,0);assert.equal(f[role].bornAt,before);}
});

test('teen: eighteenth birthday does not widen a saved choice or existing accepted gift',()=>{
 for(const role of ['giver','recipient'] as const){const f=fixture(30,30);f[role].bornAt=f.w.minute-18*YEAR+.25;const old=choose(f.w,f.giver,'offer');assert.ok(old.operation==='offer');f.w.minute+=.25;assert.equal((choose(f.w,f.giver,'offer') as Extract<PersonalFoodGiftAction,{operation:'offer'}>).ageTerms?.maxQuantity,3);reject(f.w,f.giver,{...old,quantity:2});assert.equal(f.w.personalFoodGifts?.gifts.length??0,0);}
 const f=fixture(17,17);f.giver.bornAt=f.w.minute-18*YEAR+4;f.recipient.bornAt=f.w.minute-18*YEAR+4;const g=accept(f),terms=structuredClone(g.ageTerms),deadline=g.expiresAt;stepWorld(f.w,4);run(f.w,f.giver,choose(f.w,f.giver,'deliver'));assert.equal(g.quantity,1);assert.deepEqual(g.ageTerms,terms);assert.equal(g.expiresAt,deadline);assert.equal(f.recipient.inventory.turnip,1);
});

test('teen: birthday in the last quarter of offering retains selected one-portion limit',()=>{
 const f=fixture(17,30);f.giver.bornAt=f.w.minute-18*YEAR+.75;assert.equal(queue(f.w,f.giver,choose(f.w,f.giver,'offer')).ok,true);for(let n=0;n<4;n++)stepWorld(f.w,.25);const g=f.w.personalFoodGifts!.gifts[0];assert.ok(g);assert.equal(g.ageTerms?.maxQuantity,1);run(f.w,f.recipient,choose(f.w,f.recipient,'accept'));run(f.w,f.giver,choose(f.w,f.giver,'deliver'));assert.equal(f.recipient.inventory.turnip,1);
});

test('teen: changed birth identity, capacity, expression and age terms cannot be reused',()=>{
 for(const change of ['giverBirth','recipientBirth','giverCapacity','recipientCapacity','recipientExpression','cap','version','selectedAt','extra','missingBirth']){const f=fixture(),a=choose(f.w,f.giver,'offer');assert.ok(a.operation==='offer');if(change==='giverBirth')f.giver.bornAt--;if(change==='recipientBirth')f.recipient.bornAt--;if(change==='giverCapacity')f.giver.canDecide=false;if(change==='recipientCapacity')f.recipient.canDecide=false;if(change==='recipientExpression')f.recipient.canExpress=false;if(change==='cap')a.ageTerms!.maxQuantity=3;if(change==='version')(a.ageTerms as unknown as {version:number}).version=1;if(change==='selectedAt')a.ageTerms!.decidedAt=f.w.minute+1;if(change==='extra')Object.assign(a.ageTerms!,{proxy:f.other.id});if(change==='missingBirth')delete (a.ageTerms as unknown as Record<string,unknown>).recipientBornAt;reject(f.w,f.giver,a);assert.equal(f.w.personalFoodGifts?.gifts.length??0,0,change);assert.equal(f.giver.inventory.turnip,3);}
});

test('teen: persisted immutable terms reject deletion, widening, swapping and rebinding',()=>{
 for(const change of ['delete','cap','giverBirth','recipientBirth','selectedAt','quantity']){const f=fixture(),g=accept(f),a=choose(f.w,f.giver,'deliver');if(change==='delete')delete g.ageTerms;if(change==='cap')g.ageTerms!.maxQuantity=3;if(change==='giverBirth')g.ageTerms!.giverBornAt=g.ageTerms!.recipientBornAt;if(change==='recipientBirth')g.ageTerms!.recipientBornAt=g.ageTerms!.giverBornAt;if(change==='selectedAt')g.ageTerms!.decidedAt--;if(change==='quantity')g.quantity=2;reject(f.w,f.giver,a);assert.equal(f.recipient.inventory.turnip??0,0,change);assert.equal(f.giver.inventory.turnip,3);}
});

test('teen: original adult-only action and v1 evidence never gain minor authority',()=>{
 const minor=fixture(),a=choose(minor.w,minor.giver,'offer');assert.ok(a.operation==='offer');delete a.ageTerms;reject(minor.w,minor.giver,a);assert.equal(minor.w.personalFoodGifts?.gifts.length??0,0);
 const f=fixture(30,30),legacy=choose(f.w,f.giver,'offer',3);assert.ok(legacy.operation==='offer');delete legacy.ageTerms;legacy.receiptId=personalFoodGiftReceiptId(f.w,f.giver,1);run(f.w,f.giver,legacy);const g=f.w.personalFoodGifts!.gifts[0];assert.equal(g.ageTerms,undefined);assert.ok(f.w.events.some(e=>e.audit?.rule==='personal-food-gift/offer@1'));run(f.w,f.recipient,choose(f.w,f.recipient,'accept'));assert.ok(f.w.events.some(e=>e.audit?.rule==='personal-food-gift/accept@1'));
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,giver=w.residents[0],recipient=w.residents[1];run(w,giver,choose(w,giver,'deliver'));assert.equal(recipient.inventory.turnip,3);}finally{store.close();}
 const delivery=choose(f.w,f.giver,'deliver');f.recipient.bornAt=f.w.minute-18*YEAR+.25;reject(f.w,f.giver,delivery);stepWorld(f.w,1);reject(f.w,f.giver,delivery);assert.equal(f.recipient.inventory.turnip??0,0,'new adulthood does not make a historically minor v1 agreement valid');
});

test('teen: independent child decline wins at last quarter minute and busy giver can stop',()=>{
 for(const stopBy of ['recipient','giver'] as const){const f=fixture(),g=accept(f);assert.equal(queue(f.w,f.giver,choose(f.w,f.giver,'deliver')).ok,true);for(let n=0;n<3;n++)stepWorld(f.w,.25);assert.equal(f.giver.activity?.foodGiftWork?.minutes,.75);assert.equal(queue(f.w,f[stopBy],choose(f.w,f[stopBy],stopBy==='giver'?'cancel':'decline')).ok,true);stepWorld(f.w,.25);assert.equal(g.status,stopBy==='giver'?'cancelled':'declined');assert.equal(f.recipient.inventory.turnip??0,0);assert.equal(f.giver.inventory.turnip,3);}
});

test('teen: no passive acceptance, guardian proxy, public-stock donation or trade permission',()=>{
 const f=fixture();f.recipient.guardianIds=[f.other.id];const g=offer(f);stepWorld(f.w,3);assert.equal(g.status,'offered');reject(f.w,f.other,{type:'personalFoodGift',operation:'accept',giftId:g.id});assert.equal(g.status,'offered');f.giver.inventory={};initializeEconomy(f.w);f.w.economy!.treasuryStock={turnip:100};assert.equal(giftChoices(f.w,f.giver).some(c=>c.action.type==='personalFoodGift'&&c.action.operation==='offer'),false);assert.equal(f.w.economy!.treasuryStock.turnip,100);
 for(const a of [{type:'offer',targetId:f.recipient.id},{type:'commons',operation:'donateFood'},{type:'care',targetId:f.recipient.id},{type:'tendChild',childId:f.recipient.id}] as Action[])assert.equal(ageAllowsChoice(13,a),false);
});

test('teen: inventory consumption, spoilage, road block and absent or incapable recipient stop actual delivery',()=>{
 for(const change of ['eaten','spoiled','blocked','absent','incapable','silent','unknownAge','dead','outside']){const f=fixture(),g=accept(f);f.giver.at={x:1,y:10};assert.equal(queue(f.w,f.giver,choose(f.w,f.giver,'deliver')).ok,true);stepWorld(f.w,1);
 if(change==='eaten')f.giver.inventory.turnip=0;if(change==='spoiled')for(const lot of f.w.food!.lots['person:'+f.giver.id]!.turnip!)lot.expiresAt=f.w.minute;
 if(change==='blocked')for(let y=0;y<f.w.map.height;y++)f.w.map.tiles[y*f.w.map.width+5]='water';if(change==='absent')f.recipient.at={x:30,y:10};if(change==='incapable')f.recipient.canDecide=false;if(change==='silent')f.recipient.canExpress=false;if(change==='unknownAge')f.recipient.bornAt=NaN;if(change==='dead')f.recipient.status='dead';if(change==='outside')f.recipient.residency='outside';finish(f.w,f.giver);assert.notEqual(g.status,'delivered',change);assert.equal(f.recipient.inventory.turnip??0,0,change);assert.deepEqual(f.recipient.guardianIds,[]);}
});

test('teen: remote withdrawal and birth-date change reveal no remote facts or new location',()=>{
 for(const change of ['decline','birth']){const f=fixture(),g=accept(f);f.giver.at={x:1,y:10};const before=giftChoices(f.w,f.giver),memories=structuredClone(f.giver.memories);if(change==='decline')run(f.w,f.recipient,choose(f.w,f.recipient,'decline'));else f.recipient.bornAt=NaN;assert.deepEqual(giftChoices(f.w,f.giver),before);assert.deepEqual(f.giver.memories,memories);assert.equal(queue(f.w,f.giver,choose(f.w,f.giver,'deliver')).ok,true);stepWorld(f.w,1);assert.deepEqual(f.giver.activity!.target,g.location.at);finish(f.w,f.giver);assert.notEqual(g.status,'delivered');}
});

test('teen: SQLite reload mid-route preserves bounded terms, deadline and exactly one delivery',()=>{
 const f=fixture(),g=accept(f);f.giver.at={x:1,y:10};const delivery=choose(f.w,f.giver,'deliver');assert.equal(queue(f.w,f.giver,delivery).ok,true);stepWorld(f.w,1);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,giver=w.residents[0],recipient=w.residents[1],loaded=w.personalFoodGifts!.gifts[0];assert.deepEqual(loaded.ageTerms,g.ageTerms);assert.equal(loaded.expiresAt,g.expiresAt);assert.deepEqual(giver.activity,f.giver.activity);finish(w,giver);assert.equal(recipient.inventory.turnip,1);reject(w,giver,delivery);assert.equal(recipient.inventory.turnip,1);assert.equal(giver.inventory.turnip,2);}finally{store.close();}
});

test('teen: crowded final menus preserve eat, wait, gift response and immediate withdrawal without mutation',()=>{
 const f=fixture(),g=offer(f);f.recipient.inventory={turnip:1};for(let n=0;n<60;n++){const r=structuredClone(f.other);r.id='teen-crowd-'+n;r.at={...f.giver.at};f.w.residents.push(r);}f.recipient.hunger=80;
 const rows=menu(f.w,f.recipient);assert.ok(rows.some(c=>c.action.type==='eat'));assert.ok(rows.some(c=>c.action.type==='wait'));assert.ok(rows.some(c=>c.action.type==='personalFoodGift'&&c.action.operation==='accept'));assert.ok(rows.some(c=>c.action.type==='personalFoodGift'&&c.action.operation==='decline'));const before=structuredClone(f.w);menu(f.w,f.recipient);assert.deepEqual(f.w,before);run(f.w,f.recipient,choose(f.w,f.recipient,'decline'));assert.equal(g.status,'declined');
});
