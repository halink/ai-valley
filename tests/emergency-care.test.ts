import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {initializeEmergencyCare,emergencyCareOpportunities,emergencyCareReason,completeEmergencyCare,advanceEmergencyCare} from '../src/world/emergency-care.js';
import {initializeFood,foodContainers} from '../src/world/food.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {recordDeath} from '../src/world/life.js';
import {executeSocialAction} from '../src/world/social.js';
import {familyOpportunities} from '../src/world/family.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {WorldStore} from '../src/server/store.js';

import {DAY,YEAR} from '../src/world/time.js';
import type {EmergencyCareAction} from '../src/shared/emergency-care.js';
import type {World,Resident,Action} from '../src/shared/types.js';

function setup(age=2,w=createWorld()){
 w.mode='formal';w.clock.paused=false;w.resources=[];
 const [provider,reviewer,child]=w.residents;
 for(const r of w.residents){r.at={...w.map.entrance};r.inside=null;r.roomAt=null;r.inventory={meal:8,water:8};r.hunger=30;r.energy=r.health=100;r.bornAt=w.minute-30*YEAR;r.parents=[];r.adoptiveParents=[];r.guardianIds=[];r.relations=[];r.canDecide=r.canExpress=true;r.residency='resident';r.plan=r.activity=null;}
 child.bornAt=w.minute-age*YEAR;child.hunger=75;child.inventory={};
 if(age<6)child.canDecide=child.canExpress=false;
 initializeRooms(w);initializeEconomy(w);initializeForeignTrade(w);initializeEmergencyCare(w);initializeFood(w);stepWorld(w,.001);
 return {w,provider,reviewer,child};
}
function choice(w:World,r:Resident,operation:EmergencyCareAction['operation'],reviewerId?:string){
 const row=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='emergencyCare'&&c.action.operation===operation&&(!reviewerId||c.action.reviewerId===reviewerId));assert.ok(row,`${r.id}: missing ${operation}: ${JSON.stringify(w.emergencyCare?.agreements.map(c=>({status:c.status,id:c.id,provider:c.providerId,reviewer:c.reviewerId,reason:emergencyCareReason(w,r,{type:'emergencyCare',operation,agreementId:c.id})})))}`);return row.action as EmergencyCareAction;
}
function run(w:World,r:Resident,action:Action){
 const plan={id:`emergency-care:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择限时照护',actions:[action]};assert.ok(submitPlan(w,plan).ok);
 let ticks=400;while(r.plan||r.activity){assert.ok(ticks-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);return plan;
}
function activate(f:ReturnType<typeof setup>){const {w,provider,reviewer,child}=f;run(w,provider,choice(w,provider,'offer'));const c=w.emergencyCare!.agreements[0];assert.equal(c.status,'offered');if(child.canDecide&&child.canExpress)run(w,child,choice(w,child,'accept'));const actualReviewer=w.residents.find(r=>r.id===c.reviewerId)!;run(w,actualReviewer,choice(w,actualReviewer,'review'));assert.equal(c.status,'active');return c;}
const stock=(w:World,item:'meal'|'water')=>[...foodContainers(w).values()].reduce((n,b)=>n+(b[item]??0),0);

test('ordinary menus separately offer, review and physically feed an unguarded infant without acquiring any rights',()=>{
 const f=setup(),{w,provider,reviewer,child}=f,before=JSON.stringify(w),rights=JSON.stringify([child.parents,child.guardianIds,child.homeId,w.buildings,w.plots]),coins=totalCoins(w),meals=stock(w,'meal'),water=stock(w,'water');
 emergencyCareOpportunities(w,provider);assert.equal(JSON.stringify(w),before);
 const c=activate(f);assert.equal(c.acceptedAt,null);assert.equal(c.reviewedAt!==null,true);assert.equal(c.meals,0);
 const action=choice(w,provider,'feed'),time=w.minute,plan=run(w,provider,action);assert.ok(w.minute-time>=20);assert.equal(c.meals,1);assert.equal(c.receipts.length,1);assert.equal(stock(w,'meal'),meals-1);assert.equal(stock(w,'water'),water-1);assert.ok(child.hunger<40);
 assert.equal(JSON.stringify([child.parents,child.guardianIds,child.homeId,w.buildings,w.plots]),rights);assert.equal(totalCoins(w),coins);assert.equal(w.proposals.length,0);
 const saved=JSON.stringify(w);assert.ok(submitPlan(w,plan).ok);assert.equal(JSON.stringify(w),saved);assert.ok(completeEmergencyCare(w,provider,action));assert.equal(c.meals,1);
 assert.equal(c.evidence.length,2);assert.equal(c.evidence[1].personId,reviewer.id);
});
test('capable child independently assents and can refuse pending or active care',()=>{
 const f=setup(9),{w,provider,reviewer,child}=f;run(w,provider,choice(w,provider,'offer'));const c=w.emergencyCare!.agreements[0];run(w,reviewer,choice(w,reviewer,'review'));assert.equal(c.status,'offered');assert.ok(emergencyCareReason(w,provider,{type:'emergencyCare',operation:'feed',agreementId:c.id,step:0}));
 run(w,child,choice(w,child,'accept'));assert.equal(c.status,'active');run(w,child,choice(w,child,'withdraw'));assert.equal(c.status,'withdrawn');assert.equal(c.receipts.length,0);assert.deepEqual(child.guardianIds,[]);
});
test('review cannot be self-authorized, delegated to a child or completed by a conflicted or absent adult',()=>{
 for(const cause of ['self','child','partner','absent','incapable'] as const){const f=setup(),{w,provider,reviewer,child}=f;const a=choice(w,provider,'offer');
  if(cause==='self')a.reviewerId=provider.id;if(cause==='child')a.reviewerId=child.id;if(cause==='partner')provider.relations.push({targetId:reviewer.id,partner:'married',affection:0,trust:0,conflict:0,evidence:[]});if(cause==='absent')reviewer.at.x+=20;if(cause==='incapable')reviewer.canDecide=false;
  assert.ok(completeEmergencyCare(w,provider,a),cause);assert.equal(w.emergencyCare!.agreements.length,0);
 }
 const f=setup(),a=choice(f.w,f.provider,'offer');run(f.w,f.provider,a);const c=f.w.emergencyCare!.agreements[0];assert.ok(completeEmergencyCare(f.w,f.provider,{type:'emergencyCare',operation:'review',agreementId:c.id}));
});
test('unknown parental death is not a care mandate, both witnesses need real evidence',()=>{
 const f=setup(),{w,provider,reviewer,child}=f,guardian={...structuredClone(provider),id:'guardian',name:'原监护人'};w.residents.push(guardian);child.guardianIds=[guardian.id];guardian.at.x+=30;recordDeath(w,guardian);
 assert.equal(emergencyCareOpportunities(w,provider).some(x=>x.action.type==='emergencyCare'&&x.action.operation==='offer'),false);
 // The witnesses see a separate local death, not a fabricated remote-status notice.
 const g={...structuredClone(provider),id:'guardian-two',name:'另一监护人'};w.residents.push(g);child.guardianIds=[g.id];recordDeath(w,g);const c=activate(f);assert.ok(c.evidence.every(e=>e.facts.some(s=>s.startsWith('death:guardian-two:'))));
 assert.equal(c.reviewerId,reviewer.id);
});
test('guardian recovery, child sixth birthday, incapacity or refusal ends original permission',()=>{
 for(const cause of ['guardian','birthday','refusal','capacity'] as const){const f=setup(cause==='capacity'?8:2),{w,provider,child}=f;
  let guardian:Resident|undefined;if(cause==='guardian'){guardian={...structuredClone(provider),id:'incapacitated-guardian',canDecide:false};w.residents.push(guardian);child.guardianIds=[guardian.id];}
  const c=activate(f);if(guardian)guardian.canDecide=true;if(cause==='birthday'){
   child.bornAt=w.minute-6*YEAR;
   // Reverse subtraction from a fractional clock need not land on the stored
   // birthday. This case intends to test that birthday, not its previous float.
   w.minute=child.bornAt+6*YEAR;
  }if(cause==='refusal')child.refusesCare=true;if(cause==='capacity')child.canExpress=false;advanceEmergencyCare(w);
  assert.equal(c.status,'invalid',cause);assert.ok(completeEmergencyCare(w,provider,{type:'emergencyCare',operation:'feed',agreementId:c.id,step:0}));assert.equal(c.meals,0);
 }
});
test('fixed expiry and per-meal serial survive storage restart; queued late care consumes nothing',()=>{
 const f=setup(),c=activate(f);const store=new WorldStore(':memory:');store.commit(f.w,null);const w=store.load()!;store.close();const provider=w.residents.find(r=>r.id===f.provider.id)!,child=w.residents.find(r=>r.id===f.child.id)!;
 assert.equal(w.emergencyCare!.agreements[0].expiresAt,c.expiresAt);w.minute=c.expiresAt-5;const before=provider.inventory.meal;const action=choice(w,provider,'feed');assert.ok(submitPlan(w,{id:'late-care',actorId:provider.id,actorRevision:provider.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'照护',actions:[action]}).ok);stepWorld(w,25);
 assert.equal(w.emergencyCare!.agreements[0].status,'expired');assert.equal(provider.inventory.meal,before);assert.deepEqual(child.guardianIds,[]);
});
test('missing supplies, stale food, separation and forbidden rooms fail atomically at completion',()=>{
 for(const cause of ['water','food','stale','moved','room','provider'] as const){const f=setup(),{w,provider,child}=f,c=activate(f),a=choice(w,provider,'feed');
  if(cause==='water')provider.inventory.water=0;if(cause==='food')provider.inventory.meal=0;if(cause==='stale')w.food!.lots[`person:${provider.id}`]!.meal!.forEach(l=>l.expiresAt=w.minute);if(cause==='moved')child.at.x+=10;if(cause==='provider')provider.canDecide=false;
  if(cause==='room'){const b=w.buildings.find(b=>b.ownerId!==provider.id&&b.ownerId!=='commons')!;provider.inside=child.inside=b.id;provider.roomAt=child.roomAt={...roomLayout(w,b).entry};}
  const inv=JSON.stringify(provider.inventory),hunger=child.hunger;assert.ok(completeEmergencyCare(w,provider,a),cause);assert.equal(JSON.stringify(provider.inventory),inv);assert.equal(child.hunger,hunger);assert.equal(c.meals,0);
 }
});
test('one immediate meal needs fresh severe danger, no timely proxy, real food and no child refusal',()=>{
 const f=setup(),{w,provider,child}=f;child.health=19;const a=choice(w,provider,'rescueMeal');run(w,provider,a);assert.equal(w.emergencyCare!.agreements.length,0);assert.equal(provider.inventory.meal,7);assert.deepEqual(child.guardianIds,[]);
 child.hunger=80;child.health=80;assert.ok(completeEmergencyCare(w,provider,a));child.health=19;child.refusesCare=true;assert.ok(completeEmergencyCare(w,provider,a));child.refusesCare=false;child.guardianIds=[f.reviewer.id];assert.ok(completeEmergencyCare(w,provider,a));
});
test('old and fresh foster routes cannot turn unguarded care into permanent guardianship',()=>{
 for(const age of [2,10]){const {w,provider,child}=setup(age);assert.equal(familyOpportunities(w,provider).some(x=>x.action.type==='fosterChild'),false);assert.equal(executeSocialAction(w,provider,{type:'fosterChild',targetId:child.id}).ok,false);
  child.guardianOffer={volunteerId:provider.id,guardianApproved:true,childApproved:age<6,expiresAt:w.minute+DAY};assert.equal(executeSocialAction(w,child,{type:'familyConsent',targetId:child.id,accept:true}).ok,false);assert.deepEqual(child.guardianIds,[]);
 }
});
test('normal final menus in a nine-founder world execute care without adding stock, money or population',()=>{
 const f=setup(9,createFrontierWorld()),{w,provider,child}=f,count=w.residents.length,money=totalCoins(w),before=stock(w,'meal');assert.equal(emergencyCareReason(w,provider,{type:'emergencyCare',operation:'offer',childId:child.id,reviewerId:f.reviewer.id,step:w.emergencyCare!.nextSerial}),null,JSON.stringify([provider,child,f.reviewer].map(p=>({id:p.id,health:p.health,energy:p.energy,at:p.at,inside:p.inside,guardian:p.guardianIds,canDecide:p.canDecide,canExpress:p.canExpress,inventory:p.inventory,relations:p.relations}))));activate(f);run(w,provider,choice(w,provider,'feed'));assert.equal(w.residents.length,count);assert.equal(totalCoins(w),money);assert.equal(stock(w,'meal'),before-1);assert.deepEqual(child.guardianIds,[]);
});
test('model cannot inject signatures, cash, duration or another child into a selected care option',()=>{
 const {w,provider}=setup(),row=decisionChoices(decisionContext(w,provider)).find(c=>c.action.type==='emergencyCare'&&c.action.operation==='offer')!;assert.ok(row);assert.equal(parseChoice(JSON.stringify({choice:row.id}),[row]).actions[0].type,'emergencyCare');for(const fields of [{accepted:true},{days:90},{amount:100},{childId:'other'}])assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,...fields}),[row]));
});
test('remote invalidation preserves remembered inspection and withdrawal instead of announcing unseen state',()=>{
 const f=setup(),{w,provider,child}=f,c=activate(f);provider.at.x+=30;const before=emergencyCareOpportunities(w,provider);child.refusesCare=true;advanceEmergencyCare(w);assert.equal(c.status,'invalid');assert.deepEqual(emergencyCareOpportunities(w,provider),before);
});

test('review independence follows biological and adoptive ancestry, not just optional relation labels',()=>{
 for(const cause of ['siblings','adoptive','ancestor'] as const){const {w,provider,reviewer,child}=setup();
  if(cause==='siblings'){provider.parents=['same-parent'];reviewer.parents=['same-parent'];}
  if(cause==='adoptive'){provider.parents=['same-parent'];reviewer.adoptiveParents=['same-parent'];}
  if(cause==='ancestor'){provider.parents=['middle'];w.residents.push({...structuredClone(child),id:'middle',parents:[reviewer.id]});}
  assert.ok(emergencyCareReason(w,provider,{type:'emergencyCare',operation:'offer',childId:child.id,reviewerId:reviewer.id,step:1}));
 }
});
test('seeing a child does not disclose a remote reviewer withdrawal or unobserved recovery',()=>{
 const f=setup(),{w,provider,reviewer,child}=f,c=activate(f);reviewer.at.x+=30;run(w,reviewer,choice(w,reviewer,'withdraw'));
 const memories=provider.memories.length;run(w,provider,{type:'emergencyCare',operation:'inspect',agreementId:c.id});
 const text=provider.memories.slice(memories).map(m=>m.text).join(' ');assert.ok(!text.includes(c.reason!));assert.ok(!c.endKnownBy.includes(provider.id));assert.ok(text.includes('不代答'));
});
test('all four meals are separately chosen, stop at the exact limit and preserve already consumed goods',()=>{
 const f=setup(),{w,provider,child}=f,c=activate(f),before=provider.inventory.meal!;
 for(let i=0;i<4;i++){child.hunger=80;run(w,provider,choice(w,provider,'feed'));}
 assert.equal(c.status,'completed');assert.equal(c.receipts.length,4);assert.equal(provider.inventory.meal,before-4);child.hunger=80;assert.ok(completeEmergencyCare(w,provider,{type:'emergencyCare',operation:'feed',agreementId:c.id,step:4}));assert.equal(provider.inventory.meal,before-4);
});

test('an unseen remote withdrawal does not remove a locally remembered feeding choice or disclose its source',()=>{
 const f=setup(),{w,provider,reviewer}=f,c=activate(f);reviewer.at.x+=30;const before=emergencyCareOpportunities(w,provider);run(w,reviewer,choice(w,reviewer,'withdraw'));assert.deepEqual(emergencyCareOpportunities(w,provider),before);const a=choice(w,provider,'feed'),inventory={...provider.inventory};assert.ok(completeEmergencyCare(w,provider,a));assert.deepEqual(provider.inventory,inventory);
});

test('lawful shared-room care remains in its real room and cannot switch the agreement child',()=>{
 const f=setup(8),{w,provider,reviewer,child}=f,b=w.buildings.find(b=>b.ownerId==='commons'&&b.kind==='lodge')!;
 for(const r of [provider,reviewer,child]){r.at={...b.door};r.inside=b.id;r.roomAt={...roomLayout(w,b).entry};}
 const c=activate(f),a=choice(w,provider,'feed'),before={...provider.inventory};
 assert.ok(completeEmergencyCare(w,provider,{...a,childId:reviewer.id}));assert.ok(completeEmergencyCare(w,provider,{type:'emergencyCare',operation:'rescueMeal',childId:child.id,agreementId:c.id}));assert.deepEqual(provider.inventory,before);
 run(w,provider,a);assert.equal(provider.inside,b.id);assert.equal(child.inside,b.id);assert.equal(c.meals,1);
});
test('old-save initialization adds only an empty care ledger and is idempotent',()=>{
 const {w}=setup();delete w.emergencyCare;const before=structuredClone(w);initializeEmergencyCare(w);assert.deepEqual(w.emergencyCare,{nextSerial:1,agreements:[]});const once=JSON.stringify(w);initializeEmergencyCare(w);assert.equal(JSON.stringify(w),once);delete w.emergencyCare;assert.deepEqual(w,before);
});

test('a remote guardian recovery stops permission without announcing the unseen recovery during a child visit',()=>{
 const f=setup(),{w,provider,child}=f,guardian={...structuredClone(provider),id:'recovering-guardian',canDecide:false};w.residents.push(guardian);child.guardianIds=[guardian.id];const c=activate(f);guardian.at.x+=30;
 const choices=emergencyCareOpportunities(w,provider);guardian.canDecide=true;advanceEmergencyCare(w);assert.equal(c.status,'invalid');assert.deepEqual(emergencyCareOpportunities(w,provider),choices);
 const memories=provider.memories.length;run(w,provider,{type:'emergencyCare',operation:'inspect',agreementId:c.id});assert.ok(!provider.memories.slice(memories).some(m=>m.text.includes('恢复')));assert.ok(!c.endKnownBy.includes(provider.id));assert.equal(c.meals,0);
});

test('remote withdrawal cannot silently unlock a replacement offer with another nearby reviewer',()=>{
 const f=setup(),{w,provider,reviewer,child}=f;activate(f);reviewer.at.x+=30;w.residents.push({...structuredClone(provider),id:'replacement-reviewer',name:'另一位复核人',inventory:{},plan:null,activity:null});const before=emergencyCareOpportunities(w,provider);run(w,reviewer,choice(w,reviewer,'withdraw'));assert.deepEqual(emergencyCareOpportunities(w,provider),before);assert.equal(child.guardianIds.length,0);
});
