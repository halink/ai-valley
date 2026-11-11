import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PersonalFoodGiftAction} from '../src/shared/personal-food-gifts.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
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

test('independent: deleting the frozen minor terms after birthday cannot widen the same choice',()=>{
 const f=fixture(17,30);f.giver.bornAt=f.w.minute-18*YEAR+.25;
 const old=choose(f.w,f.giver,'offer');assert.ok(old.operation==='offer');const revision=f.giver.revision;
 stepWorld(f.w,.25);assert.equal(f.giver.revision,revision);
 delete old.ageTerms;old.quantity=3;reject(f.w,f.giver,old);
 assert.equal(f.w.personalFoodGifts?.gifts.length??0,0);assert.equal(f.giver.inventory.turnip,3);
});
test('independent: one-portion old choice remains usable after birthday without widening',()=>{
 const f=fixture(17,30);f.giver.bornAt=f.w.minute-18*YEAR+.25;
 const old=choose(f.w,f.giver,'offer');assert.ok(old.operation==='offer');stepWorld(f.w,.25);run(f.w,f.giver,old);
 run(f.w,f.recipient,choose(f.w,f.recipient,'accept'));run(f.w,f.giver,choose(f.w,f.giver,'deliver'));
 assert.equal(f.recipient.inventory.turnip,1);assert.equal(f.w.personalFoodGifts!.gifts[0].ageTerms!.maxQuantity,1);
});
test('independent: legacy adult v1 survives save before acceptance and never gains child recipient authority',()=>{
 for(const child of [false,true]){const f=fixture(30,30),a=choose(f.w,f.giver,'offer',3);assert.ok(a.operation==='offer');delete a.ageTerms;a.receiptId=personalFoodGiftReceiptId(f.w,f.giver,1);run(f.w,f.giver,a);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,giver=w.residents[0],recipient=w.residents[1],g=w.personalFoodGifts!.gifts[0];assert.equal(g.ageTerms,undefined);assert.ok(w.events.some(e=>e.audit?.rule==='personal-food-gift/offer@1'));
 if(child){recipient.bornAt=w.minute-6*YEAR;assert.equal(giftChoices(w,recipient).length,0);reject(w,recipient,{type:'personalFoodGift',operation:'accept',giftId:g.id});assert.equal(recipient.inventory.turnip??0,0);}else{run(w,recipient,choose(w,recipient,'accept'));run(w,giver,choose(w,giver,'deliver'));assert.equal(recipient.inventory.turnip,3);assert.ok(w.events.some(e=>e.audit?.rule==='personal-food-gift/accept@1'));}}finally{store.close();}}
});
test('independent: accepted v2 audit authority and participant ordering cannot be downgraded',()=>{
 for(const mutation of ['rule','authority','actors','scope']){const f=fixture(),g=accept(f),a=choose(f.w,f.giver,'deliver'),e=f.w.events.find(e=>e.audit?.rule==='personal-food-gift/accept@2')!;
 if(mutation==='rule')e.audit!.rule='personal-food-gift/accept@1';if(mutation==='authority')e.audit!.authority='independent-adult-personal-food';if(mutation==='actors')e.actors.reverse();if(mutation==='scope')e.audit!.scope.push('feeding');reject(f.w,f.giver,a);assert.equal(f.recipient.inventory.turnip??0,0);assert.notEqual(g.status,'delivered');}
});
test('independent: child cannot exchange recipient role for cancel, deliver or offer',()=>{
 const f=fixture(),g=accept(f);for(const operation of ['cancel','deliver'] as const){reject(f.w,f.recipient,{type:'personalFoodGift',operation,giftId:g.id});assert.equal(g.status,'accepted');}
 f.recipient.inventory.turnip=1;assert.equal(giftChoices(f.w,f.recipient).some(c=>c.action.type==='personalFoodGift'&&c.action.operation==='offer'),false);
 run(f.w,f.recipient,choose(f.w,f.recipient,'decline'));assert.equal(g.status,'declined');
});
test('independent: saturated transport menus preserve child immediate decline without new gift powers',()=>{
 for(const transport of ['aboard','passenger','familyTravelling'] as const){const f=fixture(),g=accept(f),context=decisionContext(f.w,f.recipient);assert.ok(context.formal);context.formal[transport]=true;
 const original=context.formal.opportunities;context.formal.opportunities=[...Array.from({length:120},(_,n)=>({id:'review-noise-'+n,label:'等待',action:{type:'wait' as const,minutes:1}})),...original];
 const rows=decisionChoices(context),row=rows.find(c=>c.action.type==='personalFoodGift'&&c.action.operation==='decline');assert.ok(row,transport);assert.equal(rows.some(c=>c.action.type==='personalFoodGift'&&['offer','accept','deliver'].includes(c.action.operation)),false);
 const action=parseChoice(JSON.stringify({choice:row.id}),rows).actions[0];run(f.w,f.recipient,action);assert.equal(g.status,'declined');assert.equal(f.giver.inventory.turnip,3);}
});
test('independent: unknown age cannot use either party stop and cannot infer a birth date',()=>{
 for(const role of ['giver','recipient'] as const){const f=fixture(),g=accept(f);f[role].bornAt=NaN;assert.equal(giftChoices(f.w,f[role]).length,0);reject(f.w,f[role],{type:'personalFoodGift',operation:role==='giver'?'cancel':'decline',giftId:g.id});assert.ok(Number.isNaN(f[role].bornAt));assert.equal(g.status,'accepted');assert.equal(f.recipient.inventory.turnip??0,0);}
});
test('independent: emptied giver stock does not pre-empt child acceptance but prevents handoff',()=>{
 const f=fixture(),g=offer(f);f.giver.inventory.turnip=0;run(f.w,f.recipient,choose(f.w,f.recipient,'accept'));assert.equal(g.status,'accepted');reject(f.w,f.giver,choose(f.w,f.giver,'deliver'));assert.equal(f.recipient.inventory.turnip??0,0);
});
test('independent: replayed offer receipt and delivered action stay consumed after reload',()=>{
 const f=fixture(),a=choose(f.w,f.giver,'offer');run(f.w,f.giver,a);run(f.w,f.recipient,choose(f.w,f.recipient,'accept'));const d=choose(f.w,f.giver,'deliver');run(f.w,f.giver,d);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,giver=w.residents[0];reject(w,giver,a);reject(w,giver,d);assert.equal(w.personalFoodGifts!.gifts.length,1);assert.equal(giver.inventory.turnip,2);assert.equal(w.residents[1].inventory.turnip,1);}finally{store.close();}
});
test('independent: actual boarded child can immediately decline at final handoff quarter',()=>{
 const f=fixture(),g=accept(f);assert.equal(queue(f.w,f.giver,choose(f.w,f.giver,'deliver')).ok,true);for(let n=0;n<3;n++)stepWorld(f.w,.25);
 f.w.ferries={boats:[{id:'review-boat',definition:'ferry/rules@1',ownerId:f.other.id,at:{...f.recipient.at},dockId:null,condition:100,tripId:'review-teen-ship'}],builds:[],trips:[{id:'review-teen-ship',boatId:'review-boat',operatorId:f.other.id,sourceId:'none',destinationId:'none',headingId:'none',fare:0,departAt:0,expiresAt:99999999,capacity:3,phase:'docked',seats:[],aboard:[f.recipient.id],pilotId:null,path:[],progress:0,returned:false,arrivedAt:0,reason:null}],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0}};
 const context=decisionContext(f.w,f.recipient);assert.equal(context.formal?.aboard,true);assert.equal(queue(f.w,f.recipient,choose(f.w,f.recipient,'decline')).ok,true);
 assert.equal(g.status,'declined');assert.equal(f.recipient.inventory.turnip??0,0);assert.equal(f.giver.inventory.turnip,3);assert.equal(f.giver.activity!.foodGiftWork!.minutes,.75);
});
