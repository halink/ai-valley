import test from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PregnancyPreparationAction} from '../src/shared/pregnancy-preparation.js';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld,createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {initializeFood,advanceFood} from '../src/world/food.js';
import {initializePregnancyPreparation,pregnancyReceiptId,pregnancyOpportunities,pregnancyReason,pregnancyPlace,completePregnancyPreparation} from '../src/world/pregnancy-preparation.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {addHealthCase} from '../src/world/health.js';
import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import type {Snapshot} from '../src/shared/types.js';
import {advanceLife,recordDeath} from '../src/world/life.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {pregnancyPreparationProfile} from '../src/client/pregnancy-preparation.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

type Fields=PregnancyPreparationAction extends infer A?A extends PregnancyPreparationAction?Omit<A,'type'|'receiptId'>:never:never;
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.resources=[];w.plots=[];w.graves=[];
 w.map={...w.map,width:40,height:32,tiles:Array(40*32).fill('grass'),entrance:{x:0,y:12}};
 const [mother,provider,other]=w.residents,b=w.buildings.find(b=>b.kind==='home')!;
 b.at={x:16,y:6};b.width=8;b.height=6;b.door={x:20,y:12};b.ownerId=mother.id;b.capacity=4;b.residents=[mother.id,provider.id];w.buildings=[b];
 for(const r of w.residents){r.status='alive';r.residency='resident';r.canDecide=r.canExpress=true;r.refusesCare=false;r.bornAt=w.minute-30*YEAR;r.homeId=r===other?null:b.id;r.parents=[];r.guardianIds=[];r.inventory={meal:4,water:4};r.health=r.energy=100;r.hunger=0;r.skills.care=2;r.at={...b.door};r.inside=b.id;r.roomAt={x:3,y:5};r.plan=null;r.activity=null;r.knownBuildings=[b.id];}
 mother.roomAt={x:2,y:5};other.at={x:30,y:20};other.inside=null;other.roomAt=null;
 mother.pregnancy={otherParentId:provider.id,conceivedAt:w.minute-100,dueAt:w.minute+1000,definition:'life/basic@1'};
 initializeRooms(w);initializeFood(w);initializePregnancyPreparation(w);return {w,mother,provider,other,b};
}
const action=(w:World,r:Resident,f:Fields):PregnancyPreparationAction=>({type:'pregnancyPreparation',receiptId:pregnancyReceiptId(w,r),...f});
function queue(w:World,r:Resident,a:Action){const p={id:`pregnancy-test:${r.id}:${w.revision}:${w.minute}:${r.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择孕期准备',actions:[a]};const result=submitPlan(w,p);assert.equal(result.ok,true,result.error);return p;}
function finish(w:World,r:Resident){let n=300;while(r.plan||r.activity){assert.ok(n-->0,'action did not finish');stepWorld(w,1);}}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);assert.equal(r.lastFailure,null);}
function choose(w:World,r:Resident,operation:string){const choices=decisionChoices(decisionContext(w,r)),c=choices.find(c=>c.action.type==='pregnancyPreparation'&&c.action.operation===operation);assert.ok(c,operation+' absent');return parseChoice(JSON.stringify({choice:c.id}),choices).actions[0];}
function prepare(f:ReturnType<typeof fixture>,solo=false){const {w,mother,provider,b}=f;run(w,mother,action(w,mother,{operation:'prepare',buildingId:b.id,providerId:solo?null:provider.id}));return w.pregnancyPreparation!.arrangements.at(-1)!;}
function accept(f:ReturnType<typeof fixture>){const c=prepare(f);run(f.w,f.provider,choose(f.w,f.provider,'accept'));return c;}

test('legacy initialization adds no supply, consent, beds, risk or changed pregnancy; nine-person new world stays untouched',()=>{
 for(const w of [fixture().w,createFormalWorld(),createFrontierWorld()]){delete w.pregnancyPreparation;const before=structuredClone({residents:w.residents,buildings:w.buildings,estates:w.estates,minute:w.minute,processed:w.processed});initializePregnancyPreparation(w);initializePregnancyPreparation(w);assert.deepEqual(w.pregnancyPreparation,{arrangements:[],receipts:[]});assert.deepEqual({residents:w.residents,buildings:w.buildings,estates:w.estates,minute:w.minute,processed:w.processed},before);}
});

test('normal menus require separate proposal and provider acceptance, then two real deliveries with original age and separate eating',()=>{
 const f=fixture(),{w,mother,provider,b}=f;const choices=decisionChoices(decisionContext(w,mother));const choice=choices.find(c=>c.action.type==='pregnancyPreparation'&&c.action.operation==='prepare'&&c.action.providerId===provider.id)!;assert.ok(choice);
 const stock=mother.inventory.meal!,hunger=mother.hunger;run(w,mother,parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0]);const c=w.pregnancyPreparation!.arrangements[0];assert.equal(c.acceptedAt,null);assert.equal(c.deliveredMeals,0);assert.equal(mother.inventory.meal,stock);assert.ok(pregnancyReason(w,provider,action(w,provider,{operation:'deliverMeal',arrangementId:c.id})));
 run(w,provider,choose(w,provider,'accept'));const expiry=w.food!.lots['person:'+provider.id].meal![0].expiresAt;
 const delivered=choose(w,provider,'deliverMeal');run(w,provider,delivered);assert.equal(c.deliveredMeals,1);assert.equal(mother.inventory.meal,stock+1);assert.ok(mother.hunger>=hunger);assert.equal(w.food!.lots['person:'+mother.id].meal![0].expiresAt,expiry);
 const after=structuredClone({mother:mother.inventory,provider:provider.inventory,delivered:c.deliveredMeals});assert.equal(completePregnancyPreparation(w,provider,delivered as PregnancyPreparationAction),null);assert.deepEqual({mother:mother.inventory,provider:provider.inventory,delivered:c.deliveredMeals},after);
 run(w,provider,choose(w,provider,'deliverMeal'));assert.equal(c.deliveredMeals,2);assert.ok(!pregnancyOpportunities(w,provider).some(c=>c.action.type==='pregnancyPreparation'&&c.action.operation==='deliverMeal'));
 mother.hunger=60;run(w,mother,{type:'eat',item:'meal'});assert.ok(mother.hunger<60);assert.equal(mother.inventory.meal,stock+1);assert.equal(mother.homeId,b.id);assert.deepEqual(mother.guardianIds,[]);
});

test('solo preparation reuses actual ordinary sleep, records only bed minutes and grants no extra recovery',()=>{
 const f=fixture(),{w,mother}=f,c=prepare(f,true);mother.energy=50;const baseline=structuredClone(w);delete baseline.pregnancyPreparation;
 run(w,mother,{type:'sleep',minutes:60});run(baseline,baseline.residents[0],{type:'sleep',minutes:60});assert.equal(c.restMinutes,60);assert.equal(mother.energy,baseline.residents[0].energy);assert.equal(mother.health,baseline.residents[0].health);assert.equal(c.attendanceMinutes,0);
 assert.match(pregnancyPreparationProfile(w,mother),/实际床旁陪伴 0 分钟/);
});

test('refusal does not create participation, reverse prior gifts or block independent sleep and re-planning',()=>{
 const f=fixture(),{w,mother,provider,b}=f,c=prepare(f);run(w,provider,choose(w,provider,'decline'));assert.equal(c.acceptedAt,null);assert.equal(c.stops[0].personId,provider.id);assert.ok(pregnancyReason(w,provider,action(w,provider,{operation:'deliverMeal',arrangementId:c.id})));
 run(w,mother,{type:'sleep',minutes:5});assert.equal(c.restMinutes,5);run(w,mother,action(w,mother,{operation:'withdraw',arrangementId:c.id}));run(w,mother,action(w,mother,{operation:'prepare',buildingId:b.id,providerId:null}));assert.equal(w.pregnancyPreparation!.arrangements.length,2);
});

test('remote unilateral withdrawal preserves other persons choices and memories, and blocks pending physical delivery',()=>{
 const f=fixture(),{w,mother,provider}=f,c=accept(f);const gift=action(w,provider,{operation:'deliverMeal',arrangementId:c.id});queue(w,provider,gift);stepWorld(w,1);mother.inside=null;mother.roomAt=null;mother.at={x:35,y:25};
 const choices=()=>pregnancyOpportunities(w,provider),before=structuredClone(choices()),memories=structuredClone(provider.memories),stock=provider.inventory.meal;
 run(w,mother,action(w,mother,{operation:'withdraw',arrangementId:c.id}));assert.deepEqual(choices(),before);assert.deepEqual(provider.memories,memories);finish(w,provider);assert.ok(provider.lastFailure);assert.equal(c.deliveredMeals,0);assert.equal(provider.inventory.meal,stock);
 run(w,provider,action(w,provider,{operation:'withdraw',arrangementId:c.id}));assert.equal(c.stops.length,2);
});

test('provider can stop an underway attendance immediately without finishing the hour',()=>{
 const f=fixture(),{w,provider}=f,c=accept(f);queue(w,provider,choose(w,provider,'attend'));stepWorld(w,2);const minutes=c.attendanceMinutes;assert.ok(minutes>0);run(w,provider,action(w,provider,{operation:'withdraw',arrangementId:c.id}));assert.equal(provider.activity,null);stepWorld(w,5);assert.equal(c.attendanceMinutes,minutes);
});

test('sleeping or incapable gestator cannot accept food, while consented non-medical bedside company can accompany voluntary sleep',()=>{
 const f=fixture(),{w,mother,provider}=f,c=accept(f);queue(w,mother,{type:'sleep',minutes:20});stepWorld(w,1);assert.ok(pregnancyReason(w,provider,action(w,provider,{operation:'deliverMeal',arrangementId:c.id})));
 queue(w,provider,choose(w,provider,'attend'));stepWorld(w,3);assert.ok(c.attendanceMinutes>0);mother.canExpress=false;const n=c.attendanceMinutes;stepWorld(w,1);assert.equal(c.attendanceMinutes,n);assert.ok(provider.lastFailure);
});

test('remote provider follows the remembered address and walks actual room steps; intent alone never counts',()=>{
 const f=fixture(),{w,mother,provider,b}=f,c=accept(f);provider.at={x:10,y:12};provider.inside=null;provider.roomAt=null;
 const a=choose(w,provider,'attend');queue(w,provider,a);stepWorld(w,3);assert.equal(c.attendanceMinutes,0);assert.notDeepEqual(provider.at,b.door);finish(w,provider);assert.equal(provider.lastFailure,null);assert.equal(c.attendanceMinutes,60);assert.deepEqual(provider.roomAt,{x:3,y:5});assert.deepEqual(mother.roomAt,{x:2,y:5});
});

test('route interruption and changed site, bed or permission stop work without moving the gestator',()=>{
 for(const change of ['road','rights','bed','condition','pregnancy','refusal'] as const){const f=fixture(),{w,mother,provider,b}=f,c=accept(f),at=structuredClone(mother.at);provider.at={x:10,y:12};provider.inside=null;provider.roomAt=null;queue(w,provider,choose(w,provider,'attend'));stepWorld(w,1);
  if(change==='road')w.map.tiles[12*w.map.width+12]='water';if(change==='rights')b.residents=b.residents.filter(id=>id!==provider.id);if(change==='bed')b.capacity=0;if(change==='condition')b.condition=0;if(change==='pregnancy')mother.pregnancy!.conceivedAt++;if(change==='refusal')mother.refusesCare=true;
  finish(w,provider);assert.ok(provider.lastFailure,change);assert.equal(c.attendanceMinutes,0);assert.deepEqual(mother.at,at);
 }
});

test('true room access and a reachable unoccupied bed are required; matching doorway coordinates are insufficient',()=>{
 const f=fixture(),{w,mother,provider,other,b}=f;
 provider.inside=null;provider.roomAt=null;assert.ok(pregnancyReason(w,mother,action(w,mother,{operation:'prepare',buildingId:b.id,providerId:provider.id})));
 provider.inside=b.id;provider.roomAt={x:3,y:5};other.inside=b.id;other.roomAt={x:2,y:5};assert.ok(pregnancyReason(w,mother,action(w,mother,{operation:'prepare',buildingId:b.id,providerId:null})));
 other.inside=null;other.roomAt=null;b.residents=[provider.id];assert.ok(pregnancyReason(w,mother,action(w,mother,{operation:'prepare',buildingId:b.id,providerId:null})));
});

test('expired food is never recreated or delivered and original limited term never extends',()=>{
 const f=fixture(),{w,provider}=f,c=accept(f);for(const lot of w.food!.lots['person:'+provider.id].meal!)lot.expiresAt=w.minute;const a=action(w,provider,{operation:'deliverMeal',arrangementId:c.id});assert.ok(completePregnancyPreparation(w,provider,a));assert.equal(provider.inventory.meal,0);assert.equal(c.deliveredMeals,0);
 const expiry=c.expiresAt;w.minute=expiry;assert.ok(pregnancyReason(w,provider,action(w,provider,{operation:'attend',arrangementId:c.id})));initializePregnancyPreparation(w);assert.equal(c.expiresAt,expiry);
});

test('same-tick attendance completion is recorded at birth, without changing baseline identity, outcome, parentage or location',()=>{
 const f=fixture(),{w,mother,provider}=f;mother.pregnancy!.dueAt=w.minute+62;const c=accept(f);assert.equal(w.minute,602);queue(w,provider,choose(w,provider,'attend'));stepWorld(w,59);assert.equal(c.attendanceMinutes,59);assert.ok(mother.pregnancy);
 const baseline=structuredClone(w);delete baseline.pregnancyPreparation;stepWorld(w,1);stepWorld(baseline,1);assert.equal(c.attendanceMinutes,60);assert.equal(provider.activity,null);assert.equal(c.birth?.providerPresent,true);assert.equal(c.birth?.atPlannedBed,true);
 const child=w.residents.at(-1)!,other=baseline.residents.at(-1)!;assert.deepEqual({...child,relations:child.relations.map(({evidence,...r})=>r)},{...other,relations:other.relations.map(({evidence,...r})=>r)});assert.equal(mother.health,baseline.residents[0].health);assert.equal(mother.pregnancy,null);assert.equal(w.events.filter(e=>e.kind==='birth').length,1);advanceLife(w,1);assert.equal(w.events.filter(e=>e.kind==='birth').length,1);
 const prep=w.events.find(e=>e.observerOnly&&e.text.includes('出生准备核对'));assert.ok(prep);assert.ok(!mother.memories.some(m=>m.eventId===prep.id));
});

test('absence, changed location, revocation and provider death never delay or penalize a baseline birth',()=>{
 for(const cause of ['absent','location','withdraw','dead'] as const){const f=fixture(),{w,mother,provider}=f,c=accept(f);if(cause==='absent'){provider.inside=null;provider.roomAt=null;provider.at={x:35,y:20};}if(cause==='location'){mother.inside=null;mother.roomAt=null;mother.at={x:30,y:20};}if(cause==='withdraw')run(w,provider,action(w,provider,{operation:'withdraw',arrangementId:c.id}));if(cause==='dead')recordDeath(w,provider);
  w.minute=mother.pregnancy!.dueAt;const health=mother.health,at=structuredClone(mother.at);advanceLife(w,1);assert.equal(mother.health,health);assert.equal(mother.pregnancy,null);assert.equal(c.birth?.providerPresent,false);assert.deepEqual(w.residents.at(-1)!.at,at);assert.equal(w.residents.at(-1)!.parents[1],provider.id);
 }
});

test('save reload preserves evidence, spent portions, food age, pending navigation and receipt idempotency',()=>{
 const f=fixture(),{w,mother,provider}=f,c=accept(f),a=choose(w,provider,'deliverMeal') as PregnancyPreparationAction;run(w,provider,a);const before=mother.inventory.meal,expiry=w.food!.lots['person:'+mother.id].meal![0].expiresAt;
 provider.inside=null;provider.roomAt=null;provider.at={x:10,y:12};queue(w,provider,choose(w,provider,'attend'));stepWorld(w,2);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load(true)!;const p=loaded.residents.find(r=>r.id===provider.id)!;assert.equal(completePregnancyPreparation(loaded,p,a),null);assert.equal(loaded.residents[0].inventory.meal,before);assert.equal(loaded.food!.lots['person:'+mother.id].meal![0].expiresAt,expiry);finish(loaded,p);assert.equal(p.lastFailure,null);const saved=loaded.pregnancyPreparation!.arrangements[0];assert.equal(saved.deliveredMeals,1);assert.equal(saved.attendanceMinutes,60);assert.ok(c.eventIds.every(id=>loaded.events.some(e=>e.id===id)));}finally{store.close();}
});


test('critical illness between the work tick and birth invalidates reported attendance without changing the birth',()=>{
 const f=fixture(),{w,mother,provider}=f;mother.pregnancy!.dueAt=w.minute+62;const c=accept(f);queue(w,provider,choose(w,provider,'attend'));stepWorld(w,59);
 addHealthCase(w,mother,'illness',86,'isolated birth-tick regression');assert.equal(mother.canDecide,true);stepWorld(w,1);assert.equal(c.attendanceMinutes,60);assert.equal(mother.canDecide,false);assert.equal(mother.canExpress,false);assert.equal(c.birth?.providerPresent,false);assert.equal(mother.pregnancy,null);assert.equal(w.residents.at(-1)!.parents[0],mother.id);
});

test('withdrawal cancels an unstarted matching plan without a later stale-receipt failure',()=>{
 const f=fixture(),{w,provider}=f,c=accept(f);queue(w,provider,choose(w,provider,'attend'));assert.equal(provider.activity,null);run(w,provider,action(w,provider,{operation:'withdraw',arrangementId:c.id}));assert.equal(provider.plan,null);stepWorld(w,2);assert.equal(provider.lastFailure,null);assert.equal(c.attendanceMinutes,0);
});

test('medical transport, temporary leases and current competing claims never become a free preparation bed',()=>{
 for(const kind of ['medical','lease','claim'] as const){const f=fixture(),{w,mother,provider,other,b}=f,c=accept(f);
  if(kind==='medical')w.health!.transports.push({id:'incoming',carrierId:provider.id,patientId:other.id,buildingId:b.id,bed:c.bed,basis:'consent',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});
  if(kind==='lease')w.commons!.stays.push({id:'prior-stay',residentId:other.id,buildingId:b.id,bed:c.bed,startedAt:w.minute,expiresAt:w.minute+DAY,endedAt:null,reason:null});
  if(kind==='claim'){w.rooms!.tick=w.minute;w.rooms!.claims.push({buildingId:b.id,key:'bed:'+c.bed,group:other.id,people:[other.id]});}
  assert.equal(pregnancyPlace(w,c),null,kind);assert.ok(pregnancyReason(w,provider,action(w,provider,{operation:'attend',arrangementId:c.id})));assert.equal(mother.homeId,b.id);assert.equal(c.attendanceMinutes,0);
 }
});

test('fresh nine-resident world supports a real solo preparation and ordinary rest without initial grants',()=>{
 const w=createFrontierWorld();w.clock.paused=false;const mother=w.residents.find(p=>p.homeId&&p.canDecide&&ageYearsForTest(p,w)>=18)!;const b=w.buildings.find(b=>b.id===mother.homeId)!;
 mother.pregnancy={otherParentId:w.residents.find(p=>p.id!==mother.id)!.id,conceivedAt:w.minute,dueAt:w.minute+500,definition:'life/basic@1'};mother.at={...b.door};mother.inside=b.id;mother.roomAt={...roomLayout(w,b).entry};initializeRooms(w);initializePregnancyPreparation(w);
 run(w,mother,action(w,mother,{operation:'prepare',buildingId:b.id,providerId:null}));const c=w.pregnancyPreparation!.arrangements[0];run(w,mother,{type:'sleep',minutes:5});assert.equal(c.restMinutes,5);assert.equal(w.residents.length,9);assert.equal(c.deliveredMeals,0);assert.equal(c.attendanceMinutes,0);
});
function ageYearsForTest(r:Resident,w:World){return (w.minute-r.bornAt)/YEAR;}

test('read-only observer escapes names and streamed state includes preparation minutes and terminal facts',()=>{
 const f=fixture(),{w,mother,provider,b}=f;mother.name='<script>unsafe</script>';b.name='<img src=x>';const c=accept(f);
 const snapshot=(world:World):Snapshot=>({world:structuredClone(world),version:'test',serverTime:'isolated',mapRevision:'test-map',capabilities:{active:[],pending:[]}} as Snapshot);
 const before=snapshot(w);run(w,provider,choose(w,provider,'deliverMeal'));const after=snapshot(w),patch=observerFrame(after,before);assert.deepEqual(applyObserverUpdate(before,patch),after);const html=pregnancyPreparationProfile(w,mother);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);assert.match(html,/餐食已交付 1\/2/);assert.equal(c.deliveredMeals,1);
});
