import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld,createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {recordDeath} from '../src/world/life.js';
import {YEAR} from '../src/world/time.js';
import {initializeFunerary,completeFunerary} from '../src/world/funerary.js';
import {initializeProduction,completeProduction} from '../src/world/production.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeLastWishes,completeLastWish,lastWishReason,advanceLastWishes,giftBlocker} from '../src/world/last-wishes.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';

import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitLedgerEvent} from '../src/world/events.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {LastWishAction} from '../src/shared/last-wishes.js';
function fixture(formal=false){
 const w=formal?createFrontierWorld():createWorld();w.mode='formal';w.clock.paused=false;
 const [owner,witness,recipient]=w.residents,lodge=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 for(const p of w.residents){p.at={...lodge.door};p.inside=null;p.roomAt=null;p.bornAt=w.minute-30*YEAR;p.coins=100;p.inventory={meal:30,water:30};p.hunger=0;p.health=p.energy=100;p.knownPeople=w.residents.map(p=>p.id);p.knownBuildings=w.buildings.map(b=>b.id);p.parents=[];p.adoptiveParents=[];p.relations=[];p.canDecide=p.canExpress=true;}
 recipient.parents=[owner.id];initializeEconomy(w);initializeProduction(w);initializeFunerary(w);stepWorld(w,.001);return {w,owner,witness,recipient,lodge};
}
function act(w:World,r:Resident,a:Omit<LastWishAction,'type'>){assert.equal(completeLastWish(w,r,{type:'lastWish',...a}),null);}
function will(f:ReturnType<typeof fixture>,amount=80,graveId?:string){const {w,owner,witness,recipient,lodge}=f;act(w,owner,{operation:'declare',buildingId:lodge.id,witnessId:witness.id,...(amount?{beneficiaryId:recipient.id}:{}),amount,text:'记得春天 <花开>',graveId});const c=w.lastWishes!.records.at(-1)!;act(w,witness,{operation:'witness',wishId:c.id});return c;}
function run(w:World,r:Resident,a:Action){const s=submitPlan(w,{id:`wish:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择身后安排',actions:[a]});assert.equal(s.ok,true,s.error);let guard=6000;while(r.plan||r.activity){assert.ok(guard--,'plan finished');stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function choose(w:World,r:Resident,op:LastWishAction['operation'],data:Record<string,unknown>={}){const choices=decisionChoices(decisionContext(w,r)),c=choices.find(c=>c.action.type==='lastWish'&&c.action.operation===op);assert.ok(c,op);return parseChoice(JSON.stringify({choice:c.id,...(c.action.type==='lastWish'&&c.action.operation==='declare'&&c.action.beneficiaryId?{amount:1}:{}),...data}),choices).actions[0];}
function died(f:ReturnType<typeof fixture>,c:ReturnType<typeof will>){recordDeath(f.w,f.owner);act(f.w,f.recipient,{operation:'read',wishId:c.id});}

test('old and new initialization create no intent, goods, authority, graves or retrospective consent',()=>{
 for(const w of [fixture().w,createFormalWorld()]){delete w.lastWishes;const before=JSON.stringify({residents:w.residents,estates:w.estates,graves:w.graves,minute:w.minute,processed:w.processed});initializeLastWishes(w);initializeLastWishes(w);assert.deepEqual(w.lastWishes,{records:[],nextSerial:1});assert.equal(JSON.stringify({residents:w.residents,estates:w.estates,graves:w.graves,minute:w.minute,processed:w.processed}),before);}
});
test('normal final choices require personal text, independent witness, read, heir consent and beneficiary acceptance',()=>{
 const f=fixture(),{w,owner,witness,recipient}=f,money=totalCoins(w),graves=structuredClone(w.graves);
 run(w,owner,choose(w,owner,'declare',{text:'我希望安静地长眠'}));const c=w.lastWishes!.records[0];assert.equal(c.status,'draft');assert.deepEqual(w.graves,graves);assert.equal(totalCoins(w),money);
 const choices=decisionChoices(decisionContext(w,witness));assert.ok(choices.some(c=>c.action.type==='lastWish'&&c.action.operation==='declineWitness'));run(w,witness,choose(w,witness,'witness'));assert.equal(c.status,'active');assert.equal(c.gift.amount,0);
 recordDeath(w,owner);run(w,recipient,choose(w,recipient,'read'));assert.ok(Object.hasOwn(c.readers,recipient.id));assert.equal(recipient.coins,100);assert.equal(totalCoins(w),money);
});
test('cash gifts execute only after heirs consent and beneficiary acceptance, are capped and conserve every coin',()=>{
 const f=fixture(),{w,owner,recipient}=f,c=will(f),money=totalCoins(w),goods=structuredClone(owner.inventory);died(f,c);
 assert.match(lastWishReason(w,recipient,{type:'lastWish',operation:'acceptGift',wishId:c.id})!,/独立/);
 run(w,recipient,choose(w,recipient,'approveGift'));run(w,recipient,choose(w,recipient,'acceptGift'));
 assert.equal(c.gift.amount,25);assert.equal(c.gift.status,'paid');assert.match(c.gift.reason!,/部分/);assert.equal(recipient.coins,125);assert.equal(w.estates[0].coins,75);assert.deepEqual(w.estates[0].inventory,goods);assert.equal(totalCoins(w),money);
 assert.ok(completeLastWish(w,recipient,{type:'lastWish',operation:'acceptGift',wishId:c.id}));assert.equal(totalCoins(w),money);
 const home=w.buildings.find(b=>b.id===owner.homeId)!;recipient.at={...home.door};assert.equal(completeProduction(w,recipient,{type:'production',operation:'inherit',personId:owner.id}),null);assert.equal(totalCoins(w),money);assert.equal(recipient.coins,200);
});
test('every current heir independently consents; beneficiary consent cannot replace another heir, and refusal preserves original inheritance',()=>{
 const f=fixture(),{w,owner,witness,recipient}=f;witness.parents=[owner.id];const c=will(f);died(f,c);act(w,recipient,{operation:'approveGift',wishId:c.id});assert.match(giftBlocker(w,c)!,/每位/);
 act(w,witness,{operation:'read',wishId:c.id});act(w,witness,{operation:'approveGift',wishId:c.id});assert.equal(giftBlocker(w,c),null);act(w,witness,{operation:'refuseGift',wishId:c.id});assert.equal(c.gift.status,'declined');assert.equal(w.estates[0].coins,100);assert.ok(completeLastWish(w,recipient,{type:'lastWish',operation:'acceptGift',wishId:c.id}));
});
test('unborn and minor heirs always block gifts, without blocking ordinary protected inheritance preparation',()=>{
 for(const unborn of [false,true]){const f=fixture(),{w,witness,owner,recipient}=f,c=will(f);died(f,c);act(w,recipient,{operation:'approveGift',wishId:c.id});if(unborn)w.estates[0].heirs.push('unborn:mother:1');else {witness.parents=[owner.id];witness.bornAt=w.minute-8*YEAR;w.estates[0].heirs.push(witness.id);}assert.match(giftBlocker(w,c)!,/受保护/);assert.equal(w.estates[0].coins,100);assert.ok(completeLastWish(w,recipient,{type:'lastWish',operation:'acceptGift',wishId:c.id}));}
});
test('inheritance can proceed before gift consent or acceptance and closes the wish without holding family assets hostage',()=>{
 const f=fixture(),{w,owner,recipient}=f,c=will(f);died(f,c);recipient.at={...w.buildings.find(b=>b.id===owner.homeId)!.door};assert.equal(completeProduction(w,recipient,{type:'production',operation:'inherit',personId:owner.id}),null);assert.equal(c.gift.status,'unfulfilled');assert.equal(c.gift.amount,0);assert.equal(recipient.coins,200);assert.ok(w.events.find(e=>c.eventIds.includes(e.id)&&e.observerOnly));
});
test('no cash is promised into existence and shared assets, prepaid contracts and debts remain prior claims',()=>{
 const f=fixture(),{w,recipient}=f,c=will(f);died(f,c);act(w,recipient,{operation:'approveGift',wishId:c.id});w.estates[0].coins=3;assert.match(giftBlocker(w,c)!,/不足/);w.estates[0].coins=100;
 w.economy!.businesses.push({id:'pending-business',ownerId:f.owner.id,closedAt:null} as never);assert.match(giftBlocker(w,c)!,/经营/);w.economy!.businesses.pop();
 w.debt={loans:[{id:'unpaid',borrowerId:f.owner.id,status:'active',outstanding:10}] as never,totals:{}} as never;assert.ok(giftBlocker(w,c));assert.equal(recipient.coins,100);
});
test('the original owner can revoke; a declined or expired draft never activates and a new witnessed version replaces only their prior will',()=>{
 const f=fixture(),{w,owner,witness,lodge}=f,c=will(f);act(w,owner,{operation:'revoke',wishId:c.id});assert.equal(c.status,'revoked');const d=will(f,0);assert.equal(d.status,'active');
 act(w,owner,{operation:'declare',buildingId:lodge.id,witnessId:witness.id,amount:0,text:'新墓志'});const draft=w.lastWishes!.records.at(-1)!;act(w,witness,{operation:'declineWitness',wishId:draft.id});assert.equal(d.status,'active');assert.equal(draft.status,'declined');
 act(w,owner,{operation:'declare',buildingId:lodge.id,witnessId:witness.id,amount:0,text:'另一版本'});const expired=w.lastWishes!.records.at(-1)!;w.minute+=61;advanceLastWishes(w);assert.equal(expired.status,'expired');assert.ok(completeLastWish(w,witness,{type:'lastWish',operation:'witness',wishId:expired.id}));
 const latest=will(f,0);assert.equal(latest.status,'active');assert.equal(d.status,'superseded');
});
test('witnessing rejects absent, sleeping, incapable, underage and deceased signers without inventing consent',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.owner.at={x:1,y:1};},(f:ReturnType<typeof fixture>)=>{f.owner.canExpress=false;},(f:ReturnType<typeof fixture>)=>{f.witness.bornAt=f.w.minute-17*YEAR;},(f:ReturnType<typeof fixture>)=>{recordDeath(f.w,f.owner); }]){const f=fixture(),{w,owner,witness,lodge}=f;act(w,owner,{operation:'declare',buildingId:lodge.id,witnessId:witness.id,amount:0,text:'本人的话'});const c=w.lastWishes!.records[0];change(f);assert.ok(completeLastWish(w,witness,{type:'lastWish',operation:'witness',wishId:c.id}));assert.equal(c.signedAt,null);}
});
test('wills never broadcast remote deaths or private terms; witnessing is not death knowledge and reading is physical',()=>{
 const f=fixture(),{w,owner,witness,recipient,lodge}=f,c=will(f);witness.at={x:1,y:1};recipient.at={x:2,y:1};recordDeath(w,owner);
 for(const r of [witness,recipient]){assert.ok(lastWishReason(w,r,{type:'lastWish',operation:'read',wishId:c.id}));assert.equal(decisionChoices(decisionContext(w,r)).some(ch=>ch.action.type==='lastWish'&&['read','acceptGift'].includes(ch.action.operation)),false);}
 recipient.at={...owner.at};assert.equal(completeFunerary(w,recipient,{type:'funerary',operation:'verify',targetId:owner.id}),null);act(w,recipient,{operation:'read',wishId:c.id});recipient.at={x:1,y:1};assert.ok(completeLastWish(w,recipient,{type:'lastWish',operation:'read',wishId:c.id}));
});
test('normal parsing rejects invented beneficiaries, signatures, authority, amounts and missing personal words',()=>{
 const {w,owner}=fixture(),choices=decisionChoices(decisionContext(w,owner)),c=choices.find(c=>c.action.type==='lastWish'&&c.action.operation==='declare'&&c.action.beneficiaryId)!;assert.ok(c);
 for(const data of [{},{text:'好',amount:201},{text:'好',amount:0},{text:'好',amount:1,witnessed:true},{text:'好',amount:1,beneficiaryId:'someone'},{text:'好',amount:1,approvals:['all']}])assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,...data}),choices));
 assert.equal((parseChoice(JSON.stringify({choice:c.id,text:'原话',amount:37}),choices).actions[0] as LastWishAction).amount,37);
});
test('known burial wishes require actual body transport and free grave; no automatic action occurs at death',()=>{
 const f=fixture(),{w,owner,witness}=f,c=will(f,0);recordDeath(w,owner);assert.equal(w.graves.some(g=>g.personId===owner.id),false);assert.equal(witness.plan,null);act(w,witness,{operation:'read',wishId:c.id});
 const choices=decisionChoices(decisionContext(w,witness)),a=choices.find(ch=>ch.action.type==='bury'&&ch.action.wishId===c.id)!.action;assert.ok(a);run(w,witness,a);
 const g=w.graves.find(g=>g.personId===owner.id)!;assert.equal(g.epitaph,c.epitaph);assert.equal(c.burial?.followed,true);assert.equal(owner.body!.carriedBy,null);assert.equal(w.graves.filter(g=>g.personId===owner.id).length,1);
});
test('an exact grave is not reserved while alive and occupancy blocks execution rather than overwriting another identity',()=>{
 const f=fixture(),{w,owner,witness,lodge}=f;const g=w.graves[0];g.at={x:lodge.door.x+5,y:lodge.door.y};const c=will(f,0,g.id);assert.equal(g.reservedBy??null,null);assert.equal(g.personId,null);recordDeath(w,owner);act(w,witness,{operation:'read',wishId:c.id});g.personId='earlier-person';
 const a:Action={type:'bury',targetId:owner.id,wishId:c.id};assert.equal(submitPlan(w,{id:'occupied-wish',actorId:witness.id,actorRevision:witness.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自愿尝试',actions:[a]}).ok,true);stepWorld(w,1);assert.match(witness.lastFailure!,/空墓位/);assert.equal(g.personId,'earlier-person');assert.equal(c.burial,undefined);
});
test('ordinary burial remains separate from last-wish knowledge or obedience',()=>{
 const f=fixture(),{w,owner,witness}=f,c=will(f,0);recordDeath(w,owner);run(w,witness,{type:'bury',targetId:owner.id});assert.equal(c.burial?.followed,false);assert.equal(Object.hasOwn(c.readers,witness.id),false);assert.equal(w.graves.find(g=>g.personId===owner.id)!.epitaph,undefined);
});
test('all signatures, refusal, partial cash outcomes and evidence survive save/reload and event trimming',()=>{
 const f=fixture(),{w,recipient}=f,c=will(f);died(f,c);act(w,recipient,{operation:'approveGift',wishId:c.id});act(w,recipient,{operation:'acceptGift',wishId:c.id});const expected=structuredClone(w.lastWishes);
 for(let i=0;i<300;i++){w.minute++;emitLedgerEvent(w,{kind:'action',actors:[],place:{x:1,y:1},text:'isolated padding'});}for(const id of c.eventIds)assert.ok(workingEvents(w).some(e=>e.id===id));
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();assert.deepEqual(restored.lastWishes,expected);assert.ok(completeLastWish(restored,restored.residents.find(p=>p.id===recipient.id)!,{type:'lastWish',operation:'acceptGift',wishId:c.id}));assert.equal(totalCoins(restored),totalCoins(w));
});

test('formal nine-resident seed can use the same ordinary menu without models or runtime files',()=>{
 const {w,owner,witness}=fixture(true);run(w,owner,choose(w,owner,'declare',{text:'愿保留共同生活的记忆'}));run(w,witness,choose(w,witness,'witness'));assert.equal(w.lastWishes!.records[0].status,'active');assert.equal(w.residents.length,9);assert.ok(w.graves.every(g=>!g.personId));
});

test('a non-witness heir reads the exact named recipient and burial terms before independently approving',()=>{
 const f=fixture(),{w,owner,witness,recipient,lodge}=f;const heir=structuredClone(recipient);heir.id='independent-heir';heir.name='独立继承人';heir.parents=[owner.id];w.residents.push(heir);const c=will(f);recordDeath(w,owner);act(w,heir,{operation:'read',wishId:c.id});assert.ok(heir.memories.some(m=>m.text.includes('给'+recipient.name+'现金最多80钱')&&m.text.includes(c.epitaph)));const a=decisionChoices(decisionContext(w,heir)).find(ch=>ch.action.type==='lastWish'&&ch.action.operation==='approveGift');assert.ok(a);assert.ok(a.label.includes(recipient.name));assert.ok(c.readHeirs?.[heir.id]?.includes(heir.id));
});
test('unseen capacity, outstanding obligations and cash changes do not alter a personally read acceptance choice',()=>{
 const f=fixture(),{w,owner,witness,recipient}=f;witness.parents=[owner.id];const c=will(f);died(f,c);act(w,witness,{operation:'read',wishId:c.id});act(w,witness,{operation:'approveGift',wishId:c.id});act(w,recipient,{operation:'approveGift',wishId:c.id});witness.at={x:1,y:1};
 const labels=()=>decisionChoices(decisionContext(w,recipient)).filter(ch=>ch.action.type==='lastWish'&&['acceptGift','declineGift'].includes(ch.action.operation)).map(ch=>ch.label).sort(),before=labels();assert.equal(before.length,2);witness.canExpress=false;w.estates[0].coins=0;assert.deepEqual(labels(),before);assert.ok(completeLastWish(w,recipient,{type:'lastWish',operation:'acceptGift',wishId:c.id}));assert.equal(c.gift.amount,0);
});
test('stale acceptance walks to the known registry before finding changed conditions; a save mid-walk keeps the same authority',()=>{
 const f=fixture(),{w,owner,recipient,lodge}=f,c=will(f);died(f,c);act(w,recipient,{operation:'approveGift',wishId:c.id});const a=choose(w,recipient,'acceptGift');recipient.at={x:lodge.door.x+5,y:lodge.door.y};w.estates[0].coins=0;
 assert.equal(submitPlan(w,{id:'walk-stale-will',actorId:recipient.id,actorRevision:recipient.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'去原处尝试',actions:[a]}).ok,true);stepWorld(w,1);assert.equal(recipient.lastFailure,null);assert.ok(recipient.activity);const store=new WorldStore(':memory:');store.commit(w,null);const copy=store.load(true)!;store.close();const r=copy.residents.find(p=>p.id===recipient.id)!;let guard=1000;while(r.plan||r.activity){assert.ok(guard--);stepWorld(copy,1);}assert.match(r.lastFailure!,/不足/);assert.deepEqual(r.at,lodge.door);assert.equal(copy.lastWishes!.records[0].gift.amount,0);
});
test('a late ordinary inheritance or heir withdrawal prevents an underway acceptance without repeated payment',()=>{
 for(const inherit of [false,true]){const f=fixture(),{w,owner,witness,recipient}=f;witness.parents=[owner.id];const c=will(f);died(f,c);act(w,witness,{operation:'read',wishId:c.id});act(w,witness,{operation:'approveGift',wishId:c.id});act(w,recipient,{operation:'approveGift',wishId:c.id});const a=choose(w,recipient,'acceptGift');assert.equal(submitPlan(w,{id:'late-will-'+inherit,actorId:recipient.id,actorRevision:recipient.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人接受',actions:[a]}).ok,true);stepWorld(w,1);
 if(inherit){witness.at={...w.buildings.find(b=>b.id===owner.homeId)!.door};assert.equal(completeProduction(w,witness,{type:'production',operation:'inherit',personId:owner.id}),null);}else act(w,witness,{operation:'refuseGift',wishId:c.id});let guard=100;while(recipient.activity||recipient.plan){assert.ok(guard--);stepWorld(w,1);}assert.ok(recipient.lastFailure);assert.equal(c.gift.amount,0);assert.equal(recipient.coins,100);}
});
test('missing all graves leaves the body and will unfulfilled, without creating capacity or assigning a carrier',()=>{
 const f=fixture(),{w,owner,witness}=f,c=will(f,0);recordDeath(w,owner);act(w,witness,{operation:'read',wishId:c.id});w.graves=[];assert.equal(submitPlan(w,{id:'no-graves',actorId:witness.id,actorRevision:witness.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自愿安葬',actions:[{type:'bury',targetId:owner.id,wishId:c.id}]}).ok,true);stepWorld(w,1);assert.match(witness.lastFailure!,/空墓位/);assert.equal(c.burial,undefined);assert.equal(w.graves.length,0);assert.equal(owner.body!.carriedBy,null);assert.equal(witness.plan,null);
});

test('a known distant body retains both wish-bound and ordinary burial choices in the final menu',()=>{
 const f=fixture(),{w,owner,witness,lodge}=f,c=will(f,0);owner.at={x:1,y:1};witness.at={...owner.at};recordDeath(w,owner);witness.at={...lodge.door};act(w,witness,{operation:'read',wishId:c.id});
 const choices=decisionChoices(decisionContext(w,witness)).filter(ch=>ch.action.type==='bury'&&ch.action.targetId===owner.id);assert.ok(choices.some(ch=>ch.action.type==='bury'&&ch.action.wishId===c.id));assert.ok(choices.some(ch=>ch.action.type==='bury'&&!ch.action.wishId));assert.ok(choices.find(ch=>ch.action.type==='bury'&&!ch.action.wishId)!.label.includes('不采用'));
});

test('a normal heir refusal is immediate and local even while another person is about to finish accepting',()=>{
 const f=fixture(),{w,owner,witness,recipient}=f;witness.parents=[owner.id];const c=will(f);died(f,c);act(w,witness,{operation:'read',wishId:c.id});act(w,witness,{operation:'approveGift',wishId:c.id});act(w,recipient,{operation:'approveGift',wishId:c.id});
 const accept=choose(w,recipient,'acceptGift');assert.equal(submitPlan(w,{id:'before-immediate-refusal',actorId:recipient.id,actorRevision:recipient.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人接受',actions:[accept]}).ok,true);stepWorld(w,9);witness.at={x:1,y:1};const refusal=choose(w,witness,'refuseGift'),position={...witness.at};
 const plan={id:'immediate-refusal',actorId:witness.id,actorRevision:witness.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人现在停止同意',actions:[refusal]};assert.equal(submitPlan(w,{...plan,id:'mixed-refusal',actions:[refusal,{type:'wait',minutes:1}]}).ok,false);assert.equal(submitPlan(w,plan).ok,true);assert.equal(c.gift.status,'declined');assert.deepEqual(witness.at,position);stepWorld(w,1);assert.equal(recipient.coins,100);assert.ok(recipient.lastFailure);
});
test('a distant independently chosen refusal cannot reveal or overwrite the other persons earlier refusal',()=>{
 const f=fixture(),{w,owner,witness,recipient}=f;witness.parents=[owner.id];const c=will(f);died(f,c);act(w,witness,{operation:'read',wishId:c.id});witness.at={x:1,y:1};const before=decisionChoices(decisionContext(w,witness)).filter(ch=>ch.action.type==='lastWish'&&ch.action.operation==='refuseGift').map(ch=>ch.label);act(w,recipient,{operation:'declineGift',wishId:c.id});const first=structuredClone(c.gift);const after=decisionChoices(decisionContext(w,witness)).filter(ch=>ch.action.type==='lastWish'&&ch.action.operation==='refuseGift').map(ch=>ch.label);assert.deepEqual(after,before);assert.equal(after.length,1);run(w,witness,choose(w,witness,'refuseGift'));assert.deepEqual(c.gift,first);assert.notEqual(c.stops?.[witness.id],undefined);
});

test('immediate refusal removes only matching queued wish work and preserves unrelated active body transport and later work',()=>{
 const f=fixture(),{w,owner,witness}=f;witness.parents=[owner.id];const c=will(f);recordDeath(w,owner);act(w,witness,{operation:'read',wishId:c.id});
 const other=structuredClone(f.recipient);other.id='unrelated-deceased';other.name='另一位居民';other.parents=[];other.inventory={};other.coins=0;w.residents.push(other);witness.knownPeople.push(other.id);recordDeath(w,other);
 const plan={id:'unrelated-body-and-wish',actorId:witness.id,actorRevision:witness.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'分别完成实际搬运和阅读',actions:[{type:'bury',targetId:other.id},{type:'lastWish',operation:'read',wishId:c.id},{type:'wait',minutes:5}] as Action[]};assert.equal(submitPlan(w,plan).ok,true);let guard=1000;while(!witness.activity?.cargo?.pickedUp){assert.ok(guard--);stepWorld(w,1);}const activity=witness.activity,graveId=activity!.cargo!.graveId;
 const refusal=choose(w,witness,'refuseGift');assert.equal(submitPlan(w,{id:'refuse-during-other-transport',actorId:witness.id,actorRevision:witness.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'只停止本人的遗赠同意',actions:[refusal]}).ok,true);assert.equal(witness.activity,activity);assert.equal(other.body!.carriedBy,witness.id);assert.equal(w.graves.find(g=>g.id===graveId)!.reservedBy,witness.id);assert.deepEqual(witness.plan!.actions,[{type:'wait',minutes:5}]);
 while(witness.plan||witness.activity){assert.ok(guard--);stepWorld(w,1);}assert.equal(witness.lastFailure,null);assert.equal(w.graves.find(g=>g.id===graveId)!.personId,other.id);assert.equal(other.body!.carriedBy,null);assert.equal(witness.recentActions!.at(-1)!.type,'wait');
});
