import {isFoodSourceSharingChoice} from '../src/server/food-source-clues.js';
import {MAX_INTERPRETATION_MEMORIES,MAX_INTERPRETATION_TARGETS} from '../src/shared/interpretation-memory.js';
import {MAX_TALK_CHOICES,MAX_TALK_TARGETS} from '../src/server/social-tone-choices.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {householdOpportunities,completeHousehold,advanceHousehold,initializeHousehold,isHouseholdFoodOption} from '../src/world/household.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {parseChoice,buildChoices,type ActionChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {foodTransaction} from '../src/world/food.js';
import {WorldStore} from '../src/server/store.js';
import {goods,itemKeys} from '../src/shared/items.js';
import type {Item,Resident,World} from '../src/shared/types.js';
import type {HouseholdAction} from '../src/shared/household.js';

function fixture(){
 const w=createFrontierWorld(5401);w.clock.paused=false;initializeHousehold(w);
 assert.equal(w.residents.length,9);const [a,b,child]=w.residents,home=w.buildings.find(p=>p.id===a.homeId)!;
 return {w,a,b,child,home};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
const household=(c:ActionChoice):c is ActionChoice&{action:HouseholdAction}=>c.action.type==='household';
const assets=new Set(['create','deposit','withdraw','proposeGift']);
function matches(c:ActionChoice,operation:HouseholdAction['operation'],item?:Item,targetId?:string){return household(c)&&c.action.operation===operation&&(operation!=='respond'||c.action.accept===true)&&(item===undefined||c.action.item===item)&&(!targetId||c.action.targetId===targetId);}
function visible(w:World,r:Resident,operation:HouseholdAction['operation'],item?:Item,targetId?:string){return menu(w,r).find(c=>matches(c,operation,item,targetId));}
function findRotating(w:World,r:Resident,operation:HouseholdAction['operation'],item?:Item,targetId?:string,windows=90){
 for(let i=0;i<windows;i++){
  const c=visible(w,r,operation,item,targetId);if(c)return c;
  stepWorld(w,30);
 }
 assert.fail(`no ${operation}/${item}/${targetId} in actual decision menu within ${windows} windows`);
}
let serial=0;
function queue(w:World,r:Resident,c:ActionChoice,fields:Record<string,unknown>={}){
 const choices=menu(w,r),current=choices.find(x=>JSON.stringify(x.action)===JSON.stringify(c.action));assert.ok(current,'choice is currently available');
 const d=parseChoice(JSON.stringify({choice:current.id,...fields}),choices);
 const result=submitPlan(w,{id:`family-food:${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:d.intention,actions:d.actions});assert.ok(result.ok,JSON.stringify(result));
 return d.actions[0];
}
function finish(w:World,r:Resident){for(let i=0;i<500&&(r.plan||r.activity);i++)stepWorld(w,1);assert.equal(r.plan,null);assert.equal(r.activity,null);}
function choose(w:World,r:Resident,c:ActionChoice,fields:Record<string,unknown>={}){const a=queue(w,r,c,fields);finish(w,r);assert.equal(r.lastFailure,null);return a;}
function open(f:ReturnType<typeof fixture>,item:Item='turnip',quantity=1){
 const {w,a,b}=f;
 choose(w,a,findRotating(w,a,'create',item,b.id),{name:'分别出资的家庭食物',amount:0,quantity});
 const p=w.household!.pools.at(-1)!;assert.equal(p.status,'offered');assert.equal(p.credits.length,1);
 choose(w,b,findRotating(w,b,'respond'),{ });assert.equal(p.status,'open');return p;
}

test('formal nine-person seed exposes every carried food for creation without changing inventory or choosing for residents',()=>{
 const {w,a,b}=fixture();menu(w,a);assert.equal(a.inventory.turnip,5);const seen=new Set<Item>();
 for(let n=0;n<12;n++){
  w.minute=480+30*n;const before=structuredClone(w),context=decisionContext(w,a),all=buildChoices(context),rows=decisionChoices(context);
  for(const c of rows)if(matches(c,'create',undefined,b.id)&&household(c)&&c.action.item)seen.add(c.action.item);
  assert.deepEqual(w,before,'menu generation is read-only');assert.ok(rows.filter(c=>c.action.type!=='socialAppointment').length<=56,'the original household menu budget is unchanged');
  const appointments=rows.filter(c=>c.action.type==='socialAppointment');assert.ok(appointments.length<=2);
  assert.ok(appointments.every(c=>all.some(source=>source.label===c.label&&JSON.stringify(source.action)===JSON.stringify(c.action))),'new appointment rows must already be authorized in the original menu');
 }
 for(const item of ['berry','turnip','meal'] as const)assert.ok(seen.has(item),`${item} must not stay behind wood and stone`);
});

test('formal seed carried root vegetables remain depositable even beside earlier stock and cash',()=>{
 const f=fixture(),{w,a,b,home}=f;
 assert.equal(completeHousehold(w,a,{type:'household',operation:'create',targetId:b.id,buildingId:home.id,name:'合成审计共同池',amount:1,quantity:0}),null);
 b.at={...home.door};assert.equal(completeHousehold(w,b,{type:'household',operation:'respond',poolId:w.household!.pools[0].id,accept:true}),null);
 const seen=new Set<Item>();for(let n=0;n<12;n++){w.minute=480+30*n;for(const c of menu(w,a))if(matches(c,'deposit')&&household(c)&&c.action.item)seen.add(c.action.item);}
 assert.equal(a.inventory.turnip,5);for(const item of ['berry','turnip','meal'] as const)assert.ok(seen.has(item),`deposit ${item} must be selectable`);
});

for(const item of ['turnip','berry','meal'] as const)test(`formal seed ${item} is created, withdrawn, deposited and gifted through separate parsed choices and actual arrival`,()=>{
 const f=fixture(),{w,a,b,child,home}=f,childBefore=child.inventory[item]!,parents=child.parents.slice(),guardians=child.guardianIds.slice();
 const expiry=w.food!.lots['person:'+a.id][item]![0].expiresAt;
 const p=open(f,item);
 assert.equal(p.credits[0].inventory[item],1);assert.equal(p.credits[1].inventory[item],1);
 choose(w,a,findRotating(w,a,'withdraw',item),{amount:0,quantity:1});assert.equal(p.credits[0].inventory[item],0);
 choose(w,a,findRotating(w,a,'deposit',item),{amount:0,quantity:1});assert.equal(p.credits[0].inventory[item],1);
 assert.equal(w.food!.lots['family-stock:'+p.id+':'+a.id][item]![0].expiresAt,expiry);
 const c=findRotating(w,a,'proposeGift',item,child.id),choices=menu(w,a),same=choices.find(x=>JSON.stringify(x.action)===JSON.stringify(c.action))!;
 assert.throws(()=>parseChoice(JSON.stringify({choice:same.id,amount:0,quantity:2,ownPercent:50,item:'wood'}),choices));
 assert.throws(()=>parseChoice(JSON.stringify({choice:same.id,amount:0,quantity:2,ownPercent:50,targetId:b.id}),choices));
 choose(w,a,c,{amount:0,quantity:2,ownPercent:50});const g=w.household!.gifts.at(-1)!;
 assert.equal(g.status,'proposed');assert.equal(child.inventory[item],childBefore);assert.equal(p.credits[1].inventory[item],1);
 assert.ok(!visible(w,child,'acceptGift'),'child cannot collect before the other adult agrees');
 assert.ok(completeHousehold(w,a,{type:'household',operation:'approveGift',giftId:g.id}),'proposer cannot impersonate other adult');
 choose(w,b,findRotating(w,b,'approveGift'));assert.equal(g.status,'ready');assert.equal(child.inventory[item],childBefore);
 assert.deepEqual(g.costs.map(c=>c.inventory[item]),[1,1]);assert.equal(w.food!.lots['family-gift:'+g.id+':'+a.id][item]![0].expiresAt,expiry);
 const beforeAt={...child.at},accept=findRotating(w,child,'acceptGift');queue(w,child,accept);assert.deepEqual(child.at,beforeAt);assert.equal(child.inventory[item],childBefore);
 stepWorld(w,1);assert.equal(child.inventory[item],childBefore,'one step does not deliver the goods');finish(w,child);
 assert.equal(child.lastFailure,null);assert.equal(g.status,'delivered');assert.deepEqual(child.at,home.door);assert.equal(child.inventory[item],childBefore+2);
 assert.deepEqual(child.parents,parents);assert.deepEqual(child.guardianIds,guardians);assert.equal(w.debt!.loans.length,0);
 assert.equal(w.food!.lots['person:'+child.id][item]!.reduce((n,l)=>n+l.quantity,0),childBefore+2);
 assert.ok(w.food!.lots['person:'+child.id][item]!.every(l=>l.expiresAt===expiry));
 assert.ok(completeHousehold(w,child,{type:'household',operation:'acceptGift',giftId:g.id}),'completed receipt cannot pay twice');
 assert.equal(w.residents.filter(r=>r.status==='alive').length,9,'short offline rule path only, not model survival acceptance');
});

function offered(f:ReturnType<typeof fixture>){const p=open(f);choose(f.w,f.a,findRotating(f.w,f.a,'proposeGift','turnip',f.child.id),{amount:0,quantity:2,ownPercent:50});return {p,g:f.w.household!.gifts.at(-1)!};}
function ready(f:ReturnType<typeof fixture>){const result=offered(f);choose(f.w,f.b,findRotating(f.w,f.b,'approveGift'));return result;}

test('a pending approval rechecks each real share after a competing withdrawal, without spending or accepting for anyone',()=>{
 const f=fixture(),{w,a,b,child}=f,{p,g}=offered(f),before=child.inventory.turnip;
 const approval=findRotating(w,b,'approveGift');queue(w,b,approval);
 queue(w,a,findRotating(w,a,'withdraw','turnip'),{amount:0,quantity:1});finish(w,a);finish(w,b);
 assert.equal(g.status,'proposed');assert.ok(b.lastFailure);assert.equal(p.credits[0].inventory.turnip,0);assert.equal(p.credits[1].inventory.turnip,1);assert.deepEqual(g.segments,[]);assert.equal(child.inventory.turnip,before);
 assert.ok(!visible(w,child,'acceptGift'));
 choose(w,a,findRotating(w,a,'deposit','turnip'),{amount:0,quantity:1});choose(w,b,findRotating(w,b,'approveGift'));assert.equal(g.status,'ready');
});

test('a selected deposit rechecks depleted personal root vegetables at completion',()=>{
 const f=fixture(),{w,a}=f,p=open(f),before=p.credits[0].inventory.turnip;
 queue(w,a,findRotating(w,a,'deposit','turnip'),{amount:0,quantity:1});
 foodTransaction(w,()=>{a.inventory.turnip=0;});finish(w,a);assert.ok(a.lastFailure);assert.equal(p.credits[0].inventory.turnip,before);assert.equal(a.inventory.turnip,0);
});

test('expiration during child travel returns only surviving batches to their original owners',()=>{
 const f=fixture(),{w,a,b,child}=f,{p,g}=ready(f),before=child.inventory.turnip;
 const old=w.food!.lots['family-gift:'+g.id+':'+a.id].turnip![0],fresh=w.food!.lots['family-gift:'+g.id+':'+b.id].turnip![0];
 const freshExpiry=fresh.expiresAt;old.expiresAt=w.minute+1; // Synthetic spoilage injection while acceptance is in flight.
 queue(w,child,findRotating(w,child,'acceptGift'));finish(w,child);advanceHousehold(w);
 assert.equal(g.status,'expired');assert.ok(child.lastFailure);assert.equal(child.inventory.turnip,before);
 assert.equal(p.credits[0].inventory.turnip??0,0);assert.equal(p.credits[1].inventory.turnip,1);
 assert.equal(w.food!.lots['family-stock:'+p.id+':'+b.id].turnip![0].expiresAt,freshExpiry);
 assert.equal(w.food!.lots['family-stock:'+p.id+':'+a.id]?.turnip?.length??0,0);
});

test('gift deadline during actual acceptance cannot create a late delivery or renew the consent',()=>{
 const f=fixture(),{w,child}=f,{p,g}=ready(f),before=child.inventory.turnip;
 const expiry=g.expiresAt;w.minute=expiry-2;
 queue(w,child,findRotating(w,child,'acceptGift'));finish(w,child);
 assert.equal(g.status,'expired');assert.equal(g.expiresAt,expiry);assert.equal(g.deliveredAt,null);assert.equal(child.inventory.turnip,before);assert.deepEqual(p.credits.map(c=>c.inventory.turnip),[1,1]);
});

test('ready root gift, original food ages and deterministic menu survive in-memory reload without double delivery',()=>{
 const f=fixture(),{w,a,b,child}=f,{g}=ready(f),before=child.inventory.turnip;
 const expiry=w.food!.lots['family-gift:'+g.id+':'+a.id].turnip![0].expiresAt;
 const store=new WorldStore(':memory:');let saved:World;try{store.commit(w,null);saved=store.load(true)!;}finally{store.close();}
 const resident=(r:Resident)=>saved.residents.find(p=>p.id===r.id)!;
 for(const r of [a,b,child])assert.deepEqual(householdOpportunities(saved,resident(r)),householdOpportunities(w,r));
 assert.equal(saved.food!.lots['family-gift:'+g.id+':'+a.id].turnip![0].expiresAt,expiry);
 choose(saved,resident(child),findRotating(saved,resident(child),'acceptGift'));
 assert.equal(resident(child).inventory.turnip,before!+2);assert.equal(saved.household!.gifts.find(x=>x.id===g.id)!.status,'delivered');
 assert.ok(completeHousehold(saved,resident(child),{type:'household',operation:'acceptGift',giftId:g.id}));assert.equal(resident(child).inventory.turnip,before!+2);
});

test('every edible type and late recipient participates in bounded stable candidate rotation while materials and cash remain available',()=>{
 const f=fixture(),{w,a,b,home}=f,foods=itemKeys.filter(i=>goods[i].food>0);
 foodTransaction(w,()=>{for(const r of [a,b])for(const item of foods)r.inventory[item]=4;});
 for(const r of w.residents){r.at={...home.door};a.knownPeople=[...new Set([...a.knownPeople,r.id])];}a.knownPeople=a.knownPeople.filter(id=>id!==a.id);
 const created=new Set<Item>();for(let n=0;n<foods.length;n++){w.minute=480+n*30;for(const c of householdOpportunities(w,a))if(matches(c,'create',undefined,b.id)&&household(c)&&c.action.item)created.add(c.action.item);}
 for(const item of foods)assert.ok(created.has(item),'create '+item);
 assert.equal(completeHousehold(w,a,{type:'household',operation:'create',targetId:b.id,buildingId:home.id,name:'扩展合成库存',amount:1,quantity:0}),null);
 const p=w.household!.pools[0];assert.equal(completeHousehold(w,b,{type:'household',operation:'respond',poolId:p.id,accept:true}),null);
 for(const r of [a,b])for(const item of [...foods,'wood','stone'] as Item[])assert.equal(completeHousehold(w,r,{type:'household',operation:'deposit',poolId:p.id,item,amount:0,quantity:1}),null);
 const seen=new Set<string>(),cash=new Set<string>(),nonfood=new Set<string>();
 const windows=foods.length*a.knownPeople.length;
 for(let n=0;n<windows;n++){
  w.minute=480+n*30;const rows=householdOpportunities(w,a);
  const before=structuredClone(rows);w.residents.reverse();w.household!.pools.reverse();assert.deepEqual(householdOpportunities(w,a),before,'source array order cannot bias which candidate is shown');
  for(const operation of ['create','deposit','withdraw','proposeGift'] as const){const selected=rows.filter(c=>matches(c,operation));assert.ok(selected.length<=({create:3,deposit:4,withdraw:4,proposeGift:9}[operation]));}
  for(const c of rows)if(household(c)&&assets.has(c.action.operation)){const x=c.action;if(x.item&&goods[x.item].food>0)seen.add([x.operation,x.item,x.targetId??''].join(':'));else if(x.item)nonfood.add(x.operation+':'+x.item);else cash.add(x.operation);}
 }
 for(const item of foods){for(const operation of ['deposit','withdraw'])assert.ok(seen.has(`${operation}:${item}:`),`${operation} ${item}`);for(const id of a.knownPeople)assert.ok(seen.has(`proposeGift:${item}:${id}`),`gift ${item} to later ${id}`);}
 for(const operation of ['deposit','withdraw','proposeGift']){assert.ok(cash.has(operation));for(const item of ['wood','stone'])assert.ok(nonfood.has(operation+':'+item));}
});

test('crowded formal seed menus retain non-reflection priorities while household foods use only spare or surplus reflection slots',()=>{
 const f=fixture(),{w,a}=f;open(f);
 const seen=new Set<Item>();
 for(let i=0;i<12;i++){
  w.minute=600+i*30;const c=decisionContext(w,a);
  const appointments:ActionChoice[]=Array.from({length:100},(_,n)=>({id:'food-review-class-'+n,label:'合成已承诺课堂',action:{type:'education',operation:'teach',lessonId:'synthetic-class-'+n,minutes:30}}));
  const replies:ActionChoice[]=Array.from({length:80},(_,n)=>({id:'food-review-response-'+n,label:'合成同意或拒绝',action:{type:'respond',proposalId:'synthetic-proposal-'+Math.floor(n/2),accept:n%2===0}}));
  c.formal!.opportunities=[...appointments,...replies,...c.formal!.opportunities];
  const all=buildChoices(c),baseline=focusedChoices(c,all.filter(x=>!isHouseholdFoodOption(x)||x.action.type==='household'&&x.action.operation==='withdraw')),withFood=focusedChoices(c,all);
  const retained=(rows:ActionChoice[])=>rows.filter(x=>!isHouseholdFoodOption(x)&&!(x.action.type==='agency'&&x.action.operation==='reflect'));
  assert.deepEqual(retained(withFood),retained(baseline),'no existing care, refusal, water, gift, trade or basic choice is displaced');
  assert.ok(withFood.length<=56);assert.ok(withFood.some(x=>x.action.type==='agency'&&x.action.operation==='reflect'));
  for(const type of ['eat','wait','sleep'])assert.ok(withFood.some(x=>x.action.type===type));
  const final=decisionChoices(c);
  // Household insertion still uses only the original 56 slots above. Final
  // speech, retained-memory, firsthand food-clue and appointment completion are separate
  // bounded additions, never an increase to household food slots.
  const extra=MAX_TALK_CHOICES+MAX_INTERPRETATION_MEMORIES*MAX_INTERPRETATION_TARGETS+2+2;
  assert.ok(final.length<=withFood.length+extra);
  const key=(row:ActionChoice)=>{const {observedTarget,...action}=row.action;return JSON.stringify({label:row.label,action,chooseDuration:row.chooseDuration});};
  const beforeKeys=new Set(withFood.map(key)),finalKeys=new Set(final.map(key));
  for(const row of withFood.filter(row=>!(row.action.type==='agency'&&row.action.operation==='reflect')))assert.ok(finalKeys.has(key(row)),`final speech restoration preserves ${row.id}`);
  const added=final.filter(row=>!beforeKeys.has(key(row)));assert.ok(added.length<=extra);
  const allKeys=new Set(all.map(key)),sharingKeys=new Set(all.filter(isFoodSourceSharingChoice).map(key));
  const heardKeys=new Set(all.filter(row=>row.id.startsWith('foodSource.heard.')).map(key));
  assert.ok(added.every(row=>row.action.type==='talk'||allKeys.has(key(row))&&(row.action.type==='social'&&row.action.operation==='interpret'||sharingKeys.has(key(row))||row.action.type==='socialAppointment')),'only missing speech or already-authorized memory, bounded food-clue and appointment choices may be added');
  assert.ok(final.filter(row=>row.action.type==='socialAppointment').length<=2);
  assert.ok(added.filter(row=>sharingKeys.has(key(row))).length<=2);
  assert.ok(final.filter(row=>row.action.type==='shareFoodSource').length<=1);
  assert.ok(final.filter(row=>heardKeys.has(key(row))).length<=1);
  const groups=new Map<string,string[]>();for(const row of final)if(row.action.type==='talk')groups.set(row.action.targetId,[...(groups.get(row.action.targetId)??[]),row.action.tone]);
  assert.ok(groups.size<=MAX_TALK_TARGETS);for(const values of groups.values())assert.deepEqual(values.sort(),['friendly','hostile','neutral']);
  assert.ok(final.some(row=>row.action.type==='agency'&&row.action.operation==='reflect'),'retain a way to revise the goal');
  for(const x of final)if(matches(x,'deposit')&&household(x)&&x.action.item)seen.add(x.action.item);
 }
 for(const item of ['berry','turnip','meal'] as const)assert.ok(seen.has(item),`saturated menu deposit ${item}`);
});
