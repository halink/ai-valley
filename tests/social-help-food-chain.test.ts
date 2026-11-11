import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,DecisionContext,Inventory,Item,Resident,World} from '../src/shared/types.js';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext,prompt} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {foodContainers,initializeFood} from '../src/world/food.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {applyForeignDecision,foreignDecisionContext,initializeForeignTrade} from '../src/world/foreign-trade.js';
import {applyOutsideDecision,initializeMigration,outsideDecisionContext} from '../src/world/migration.js';
import {initializeRooms} from '../src/world/rooms.js';
import {YEAR} from '../src/world/time.js';

/** A single synthetic world. After setup, only numbered choices and real ticks move people or goods. */
function fixture(){
 const w=createWorld(5401);w.mode='formal';w.clock.paused=false;w.minute=600;w.weather='sun';
 w.map={name:'离线求助与赠粮链',width:40,height:24,tiles:Array(960).fill('grass'),entrance:{x:0,y:10}};
 w.buildings=[];w.plots=[];w.graves=[];w.events=[];w.residents=w.residents.slice(0,3);
 w.resources=[{id:'chain-berries',kind:'bush',at:{x:5,y:10},amount:12,max:12,regrowthDays:0,lastHarvest:0}];
 const [teen,child,trader]=w.residents;
 for(const r of w.residents)Object.assign(r,{
  at:{x:20,y:10},inside:null,roomAt:null,homeId:null,inventory:{},parents:[],adoptiveParents:[],guardianIds:[],relations:[],
  bornAt:w.minute-30*YEAR,hunger:25,energy:100,health:100,canDecide:true,canExpress:true,status:'alive',residency:'resident',
  activity:null,plan:null,lastFailure:null,knownBuildings:[],knownResources:[],knownPeople:[],memories:[],coins:0,
 });
 teen.bornAt=w.minute-14*YEAR;teen.at={x:20,y:16};
 child.bornAt=w.minute-7*YEAR;child.hunger=60;
 trader.at={...w.map.entrance};trader.inventory.wood=10;
 initializeForeignTrade(w);initializeMigration(w);
 w.foreignTrade!.knownStationIds.push(child.id,teen.id,trader.id);
 initializeRooms(w);initializeEconomy(w);initializeFood(w);stepWorld(w,.25);
 const merchantId=w.foreignTrade!.merchants[0].id;
 const contact=w.migration!.contacts.find(c=>c.origin===w.foreignTrade!.merchants[0].origin)!;
 // Mail, rather than the unrelated ordinary road notice, makes this existing adult eligible.
 contact.phase='home';contact.futureAt=w.minute+10000;
 const visitorId=contact.id;
 return {
  w,
  get child(){return this.w.residents.find(r=>r.id===child.id)!;},
  get teen(){return this.w.residents.find(r=>r.id===teen.id)!;},
  get trader(){return this.w.residents.find(r=>r.id===trader.id)!;},
  get merchant(){return this.w.foreignTrade!.merchants.find(m=>m.id===merchantId)!;},
  get contact(){return this.w.migration!.contacts.find(c=>c.id===visitorId)!;},
  get visitor(){return this.contact.person??this.w.residents.find(r=>r.id===visitorId)!;},
  get notice(){return this.w.emergencyCare!.helpNotices![0];},
  get source(){return this.w.resources.find(r=>r.id==='chain-berries')!;},
  get gift(){return this.w.personalFoodGifts!.gifts[0];},
 };
}
type Fixture=ReturnType<typeof fixture>;
type Match=(a:Action)=>boolean;
const help=(operation:string):Match=>a=>a.type==='emergencyCare'&&a.operation===operation;
const gift=(operation:string):Match=>a=>a.type==='personalFoodGift'&&a.operation===operation;

function selected(context:DecisionContext,match:Match,fields:Record<string,unknown>={}){
 const choices=decisionChoices(context),row=choices.find(c=>match(c.action));
 assert.ok(choices.every((c,i)=>c.id===String(i+1)),'use the final contiguous numbered menu');
 assert.ok(row,`missing choice for ${context.actor.id}: ${choices.map(c=>c.label).join(' / ')}`);
 assert.ok(prompt(context,choices).some(m=>m.content.includes(row.id+'. '+row.label)),'selected row reaches the actual model prompt');
 return parseChoice(JSON.stringify({choice:row.id,...fields}),choices);
}
function queue(w:World,r:Resident,match:Match,fields:Record<string,unknown>={}){
 const result=submitPlan(w,{
  id:`social-chain:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],...selected(decisionContext(w,r),match,fields),
 });
 assert.equal(result.ok,true,result.error);
}
function finish(w:World,r:Resident){
 let budget=600;
 while(r.plan||r.activity){assert.ok(budget--,'a chosen local action must finish within 150 minutes');stepWorld(w,.25);}
 assert.equal(r.lastFailure,null);
}
function run(w:World,r:Resident,match:Match,fields:Record<string,unknown>={}){queue(w,r,match,fields);finish(w,r);}
function outside(f:Fixture,match:Match){
 const result=applyOutsideDecision(f.w,f.visitor.id,f.visitor.revision,selected(outsideDecisionContext(f.w,f.visitor),match));
 assert.equal(result.ok,true,result.error);
}
function advanceTo(w:World,minute:number){assert.ok(minute>=w.minute);if(minute>w.minute)stepWorld(w,minute-w.minute);}

/** Count physical containers once, including regional people, reserved freight and the finite patch. */
function stock(w:World){
 const result:Inventory={};
 for(const bag of foodContainers(w).values())for(const [item,n] of Object.entries(bag))if(n)result[item as Item]=(result[item as Item]??0)+n;
 for(const source of w.resources)if(source.kind==='bush')result.berry=(result.berry??0)+source.amount;
 return result;
}
const population=(w:World)=>[...w.residents.map(r=>r.id),...w.migration!.contacts.flatMap(c=>c.person?[c.id]:[])].sort();
const wealth=(w:World)=>totalCoins(w)+w.migration!.contacts.reduce((sum,c)=>sum+(c.person?.coins??0),0);
function rights(w:World){
 const people=[...w.residents,...w.migration!.contacts.flatMap(c=>c.person?[c.person]:[])];
 return people.map(r=>({id:r.id,homeId:r.homeId,parents:[...r.parents],adoptiveParents:[...(r.adoptiveParents??[])],guardianIds:[...r.guardianIds]}))
  .sort((a,b)=>a.id.localeCompare(b.id));
}
function reload(f:Fixture,enabled:boolean){
 if(!enabled)return;
 const before={stock:stock(f.w),population:population(f.w),rights:rights(f.w)};
 const store=new WorldStore(':memory:');
 // Materialize receipts with the working event set so the restored world owns
 // its history after this short-lived in-memory store is closed.
 try{store.commit(f.w,null);f.w=store.load(true)!;}finally{store.close();}
 assert.deepEqual({stock:stock(f.w),population:population(f.w),rights:rights(f.w)},before);
}

for(const resume of [false,true])test(`social chain: child mail, staged visit, firsthand clue and teen gift${resume?' survive SQLite checkpoints':''}`,t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('this regression must remain offline');});
 const f=fixture(),initialStock=stock(f.w),initialPeople=population(f.w),initialRights=rights(f.w),initialWealth=wealth(f.w);
 const conserved=()=>{
  assert.deepEqual(stock(f.w),initialStock,'messages, travel, gathering and gifts do not create inventory');
  assert.deepEqual(population(f.w),initialPeople,'arrival reuses the existing regional person');
  assert.deepEqual(rights(f.w),initialRights,'no stage grants a home, parenthood or guardianship');
  assert.equal(wealth(f.w),initialWealth);
  assert.equal(f.w.emergencyCare!.agreements.length,0,'mail, a clue and a gift never become a care agreement');
 };

 // Recording, posting and entrusting are three separate choices by the seven-year-old.
 run(f.w,f.child,help('requestHelp'));
 const originalLocation=structuredClone(f.notice.location),deadline=f.notice.expiresAt;
 assert.equal(f.notice.reporterId,f.child.id);assert.equal(f.notice.postedAt,null);assert.equal(f.notice.outbound,undefined);
 run(f.w,f.child,help('postHelp'));assert.deepEqual(f.child.at,f.w.map.entrance);assert.equal(f.notice.outbound,undefined);
 run(f.w,f.child,help('sendHelp'));assert.equal(f.notice.outbound!.attempts.length,0);conserved();
 assert.equal(f.contact.journey,null);

 // A real accepted export transports the paper, not a direct mail-completion helper.
 run(f.w,f.trader,a=>a.type==='foreignTrade'&&a.operation==='propose'&&a.merchantId===f.merchant.id&&a.side==='export'&&a.item==='wood',{quantity:1,price:1});
 const offer=f.w.foreignTrade!.offers.at(-1)!;advanceTo(f.w,offer.noticeAt);
 const accepted=applyForeignDecision(f.w,f.merchant.id,f.merchant.person.revision,
  selected(foreignDecisionContext(f.w,f.merchant.person),a=>a.type==='foreignTrade'&&a.operation==='accept'&&a.offerId===offer.id));
 assert.equal(accepted.ok,true,accepted.error);
 const shipment=f.w.foreignTrade!.shipments.at(-1)!;advanceTo(f.w,shipment.readyAt);
 run(f.w,f.trader,a=>a.type==='foreignTrade'&&a.operation==='dispatch'&&a.shipmentId===shipment.id);
 assert.equal(f.notice.outbound!.attempts[0].status,'carried');assert.equal(f.contact.journey,null);conserved();
 reload(f,resume);advanceTo(f.w,shipment.arrivesAt!);
 assert.equal(f.notice.outbound!.attempts[0].status,'delivered');
 assert.equal(f.notice.outbound!.attempts[0].shipmentId,shipment.id);
 assert.equal(f.notice.outbound!.attempts[0].recipientId,f.visitor.id);
 assert.ok(f.notice.outbound!.attempts[0].arrivedAt!>f.notice.outbound!.attempts[0].pickedAt);
 assert.equal(f.visitor.knownPeople.includes(f.child.id),false);assert.equal(f.visitor.deathKnowledge?.[f.child.id],undefined);
 assert.equal(f.contact.journey,null,'receipt does not choose to travel');conserved();

 // The delivered old address does not reveal the child's current location or private state.
 const remote=structuredClone(f.w),remoteChild=remote.residents.find(r=>r.id===f.child.id)!;
 remoteChild.at={x:39,y:23};remoteChild.status='dead';remoteChild.guardianIds=[f.trader.id];remoteChild.refusesCare=true;
 assert.deepEqual(outsideDecisionContext(remote,remote.migration!.contacts.find(c=>c.id===f.visitor.id)!.person!),outsideDecisionContext(f.w,f.visitor));

 outside(f,help('travelHelp'));
 const firstStage=f.contact.journey!.staged!;
 assert.ok(firstStage.stageRemaining<firstStage.duration);
 stepWorld(f.w,firstStage.stageRemaining);assert.equal(firstStage.status,'waiting');assert.equal(f.visitor.residency,'outside');
 const stopped=firstStage.progress;stepWorld(f.w,3);assert.equal(firstStage.progress,stopped,'waiting never continues a journey');
 reload(f,resume);
 let stages=0;
 while(f.visitor.residency==='outside'){
  assert.ok(stages++<8,'bounded explicit journey');
  outside(f,a=>a.type==='visitorJourney'&&a.operation==='continue');
  stepWorld(f.w,f.contact.journey!.staged!.stageRemaining);
 }
 assert.ok(stages>=1);assert.equal(f.visitor.residency,'visitor');assert.equal(f.contact.person,undefined);conserved();
 assert.equal(f.notice.readers.find(r=>r.personId===f.visitor.id)!.visitAt,null,'arrival does not choose a local visit');
 run(f.w,f.visitor,help('visitHelp'));
 assert.deepEqual(f.notice.location,originalLocation);assert.equal(f.notice.expiresAt,deadline);
 assert.ok(f.visitor.at.x>=19,'the visitor follows the old address, not the child now at the gate');
 assert.ok(f.visitor.memories.some(m=>m.text.includes('没有找到可合法接触')));
 const sight=structuredClone(f.visitor.foodSourceKnowledge!.seen[f.source.id]);assert.ok(sight);
 assert.equal(f.teen.foodSourceKnowledge?.seen[f.source.id],undefined);

 // The visitor saw the patch while walking. The teen hears only after independently meeting them.
 run(f.w,f.teen,a=>a.type==='move'&&a.to.x===20&&a.to.y===10);
 run(f.w,f.visitor,a=>a.type==='shareFoodSource'&&a.targetId===f.teen.id);
 assert.equal(f.teen.foodSourceKnowledge!.heard.length,1);assert.equal(f.teen.foodSourceKnowledge!.seen[f.source.id],undefined);
 assert.equal(f.teen.knownResources.includes(f.source.id),false);assert.equal(f.teen.plan,null);assert.equal(f.teen.activity,null);
 const clue=f.teen.foodSourceKnowledge!.heard[0];
 assert.deepEqual({resourceId:clue.resourceId,at:clue.at,observedAt:clue.observedAt},sight);
 assert.equal(clue.speakerId,f.visitor.id);assert.equal(f.teen.memories.find(m=>m.eventId===clue.eventId)!.source,'heard');
 assert.equal(decisionChoices(decisionContext(f.w,f.teen)).some(c=>c.action.type==='gather'&&c.action.resourceId===f.source.id),false);
 const hidden=structuredClone(f.w);hidden.resources=[];
 assert.deepEqual(decisionContext(hidden,hidden.residents.find(r=>r.id===f.teen.id)!),decisionContext(f.w,f.teen),'unseen deletion cannot rewrite the heard address or expose current stock');
 conserved();reload(f,resume);
 run(f.w,f.teen,a=>a.type==='move'&&Math.abs(a.to.x-sight.at.x)+Math.abs(a.to.y-sight.at.y)<=1);
 assert.ok(f.teen.foodSourceKnowledge!.seen[f.source.id]);assert.equal(f.teen.inventory.berry??0,0);assert.equal(f.source.amount,12);
 run(f.w,f.teen,a=>a.type==='gather'&&a.resourceId===f.source.id);
 const harvested=f.teen.inventory.berry!;assert.ok(harvested>1);assert.equal(f.source.amount,12-harvested);conserved();
 const originalLot=structuredClone(f.w.food!.lots['person:'+f.teen.id].berry![0]);

 // Offering and accepting transfer nothing; the child can decline, and only the teen can deliver.
 run(f.w,f.teen,a=>a.type==='move'&&a.to.x===0&&a.to.y===10);
 run(f.w,f.teen,a=>a.type==='personalFoodGift'&&a.operation==='offer'&&a.recipientId===f.child.id&&a.item==='berry');
 assert.equal(f.gift.quantity,1);assert.equal(f.gift.ageTerms!.maxQuantity,1);assert.equal(f.gift.status,'offered');
 assert.equal(f.teen.inventory.berry,harvested);assert.equal(f.child.inventory.berry??0,0);
 stepWorld(f.w,2);assert.equal(f.gift.status,'offered','elapsed time is not acceptance');
 assert.ok(decisionChoices(decisionContext(f.w,f.child)).some(c=>gift('decline')(c.action)));
 run(f.w,f.child,gift('accept'));assert.equal(f.gift.status,'accepted');assert.equal(f.child.inventory.berry??0,0);conserved();
 const giftId=f.gift.id,giftDeadline=f.gift.expiresAt;reload(f,resume);
 assert.equal(f.gift.id,giftId);assert.equal(f.gift.expiresAt,giftDeadline);
 const hunger=f.child.hunger,health=f.child.health;
 queue(f.w,f.teen,gift('deliver'));stepWorld(f.w,.75);
 assert.equal(f.gift.status,'accepted');assert.equal(f.child.inventory.berry??0,0,'delivery requires its actual work');
 finish(f.w,f.teen);
 assert.equal(f.gift.status,'delivered');assert.equal(f.teen.inventory.berry,harvested-1);assert.equal(f.child.inventory.berry,1);
 assert.deepEqual(f.w.food!.lots['person:'+f.child.id].berry,[{...originalLot,quantity:1}]);
 assert.equal(f.child.health,health);assert.ok(f.child.hunger>=hunger,'receiving food is not feeding');conserved();
 assert.equal(decisionChoices(decisionContext(f.w,f.teen)).some(c=>gift('deliver')(c.action)),false);

 const beforeEating=f.child.hunger;
 run(f.w,f.child,a=>a.type==='eat'&&a.item==='berry');
 assert.equal(f.child.inventory.berry,0);assert.ok(f.child.hunger<beforeEating);
 const consumed={...initialStock,berry:initialStock.berry!-1};assert.deepEqual(stock(f.w),consumed);
 reload(f,resume);stepWorld(f.w,2);
 assert.deepEqual(stock(f.w),consumed,'reload and later ticks cannot repeat a transfer or meal');
 assert.deepEqual(population(f.w),initialPeople);assert.deepEqual(rights(f.w),initialRights);assert.equal(wealth(f.w),initialWealth);
 assert.equal(f.notice.outbound!.attempts.length,1);assert.equal(f.notice.readers.filter(r=>r.personId===f.visitor.id).length,1);
 assert.equal(f.teen.foodSourceKnowledge!.heard.length,1);assert.equal(f.w.personalFoodGifts!.gifts.length,1);
 assert.equal(f.w.emergencyCare!.agreements.length,0);assert.deepEqual(f.child.guardianIds,[]);assert.equal(f.w.metrics.requests,0);
});
