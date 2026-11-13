import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {physiologyDefaults,laterLifePhysiologyDefaults,laterLifeSleepFactor} from '../src/shared/physiology.js';
import {physiology,initializePhysiology} from '../src/world/physiology.js';
import {registerDefinition} from '../src/world/content.js';
import {activeDefinitionError} from '../src/world/content-schema.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {roomLayout,residentBed} from '../src/shared/rooms.js';
import {initializeLongCare,completeLongCare,longCareReason,advanceLongCare} from '../src/world/long-care.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';

import {WorldStore} from '../src/server/store.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {LongCareAction} from '../src/shared/long-care.js';

function fixture(age=75){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 const [from,to,p]=w.residents,home=w.buildings.find(b=>b.id===from.homeId)!;
 for(const r of w.residents){r.at={...home.door};r.inside=null;r.roomAt=null;r.coins=100;r.hunger=10;r.energy=80;r.health=100;r.bornAt=w.minute-30*YEAR;r.inventory={meal:20,water:20};r.knownPeople=w.residents.map(r=>r.id);r.knownBuildings.push(home.id);}
 p.bornAt=w.minute-age*YEAR;p.homeId=home.id;p.guardianIds=age<18?[from.id]:[];if(!home.residents.includes(p.id))home.residents.push(p.id);
 initializeLongCare(w);stepWorld(w,.001);return {w,from,to,p,home};
}
function act(w:World,r:Resident,a:Omit<LongCareAction,'type'>){assert.equal(completeLongCare(w,r,{type:'longCare',...a}),null);r.revision++;}
function offered(f:ReturnType<typeof fixture>,provider:Resident){
 const {w,p,from}=f;act(w,provider,{operation:'offer',targetId:p.id,fee:2,days:2,startsIn:60,startMinute:480,windowMinutes:120,visitsPerDay:1,condition:'daily'});
 const c=w.longCare!.agreements.at(-1)!;act(w,p.guardianIds.length?from:p,{operation:'accept',agreementId:c.id});
 if(c.status==='awaitingChild')act(w,p,{operation:'assent',agreementId:c.id});return c;
}
function handoff(age=75){const f=fixture(age),old=offered(f,f.from),next=offered(f,f.to);act(f.w,f.from,{operation:'handoff',agreementId:old.id,replacementId:next.id});return {...f,old,next,h:f.w.longCare!.handoffs.at(-1)!};}
function run(w:World,r:Resident,action:Action,minutes=1){assert.ok(submitPlan(w,{id:`later-life:${w.revision}:${r.id}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择有限安排',actions:[action]}).ok);stepWorld(w,minutes);assert.equal(r.lastFailure,null);}
function choose(w:World,r:Resident,operation:LongCareAction['operation']){const choices=decisionChoices(decisionContext(w,r)),c=choices.find(c=>c.action.type==='longCare'&&c.action.operation===operation);assert.ok(c,operation);const action=parseChoice(JSON.stringify({choice:c.id}),choices).actions[0];return {choices,c,action};}
function candidate(w:World,r:Resident){initializePhysiology(w);assert.ok(registerDefinition(w,{id:'life/physiology',version:2,kind:'life',dependencies:[],data:{...laterLifePhysiologyDefaults}}).ok);r.physiologyDefinition='life/physiology@2';}

test('later-life recovery is a bounded candidate; old saves, active aliases and new seeds retain prior physiology',()=>{
 const {w,p}=fixture();delete p.physiologyDefinition;initializePhysiology(w);assert.equal(p.physiologyDefinition,'life/physiology@1');assert.equal(physiology(w,p).sleepEnergy,.22);
 const before=structuredClone(w.activeDefinitions);candidate(w,p);assert.deepEqual(w.activeDefinitions,before);
 // Reverse-subtracting a fractional clock can place the stored birthday just
 // after now. Continuous recovery differs by rounding only, not a life stage.
 for(const age of [18,65,75,85,200]){p.bornAt=w.minute-age*YEAR;assert.ok(Math.abs(physiology(w,p).sleepEnergy-.22*laterLifeSleepFactor(age,laterLifePhysiologyDefaults))<1e-12);}
 assert.equal(laterLifeSleepFactor(75,laterLifePhysiologyDefaults),.875);assert.equal(laterLifeSleepFactor(200,laterLifePhysiologyDefaults),.75);
 const fresh=createFormalWorld();initializePhysiology(fresh);assert.ok(fresh.residents.every(r=>r.physiologyDefinition==='life/physiology@1'));assert.equal(fresh.activeDefinitions['life/physiology']??'life/physiology@1','life/physiology@1');
 const restored=JSON.parse(JSON.stringify(w)) as World;initializePhysiology(restored);assert.equal(restored.residents[2].physiologyDefinition,'life/physiology@2');assert.equal(physiology(restored,restored.residents[2]).sleepEnergy,.165);
});

test('candidate physiology rejects excessive recovery loss and preserves mortality, hunger, medical recovery and capability rules',()=>{
 const {w,p}=fixture(),before=physiology(w,p);candidate(w,p);const after=physiology(w,p);
 for(const key of Object.keys(physiologyDefaults) as (keyof typeof physiologyDefaults)[])if(!['sleepEnergy','laterLifeSleepLoss'].includes(key))assert.equal(after[key],before[key],key);
 assert.equal(p.canDecide,true);assert.equal(p.canExpress,true);const d=w.definitions['life/physiology@2'];assert.equal(activeDefinitionError(w,d),null);
 for(const data of [{laterLifeSleepLoss:.26},{laterLifeSleepLoss:-.1},{laterLifeSleepYears:0},{laterLifeSleepLoss:NaN}])assert.ok(activeDefinitionError(w,{...d,data:{...d.data,...data}}));
});

test('actual bed sleep matches model-context recovery; rest and pauses preserve energy rules',()=>{
 const {w,from:r}=fixture();r.bornAt=w.minute-75*YEAR;candidate(w,r);r.energy=20;
 const home=w.buildings.find(b=>b.id===r.homeId)!,bed=residentBed(w,r,home)!;r.inside=home.id;r.at={...home.door};r.roomAt={...roomLayout(w,home).slots.find(s=>s.key===`bed:${bed}`)!.at};
 const shown=decisionContext(w,r).formal!.sleepRecoveryPerHour!;assert.ok(Math.abs(shown-11.55)<1e-8);const before=r.energy;
 run(w,r,{type:'sleep',minutes:61},60);assert.ok(Math.abs(r.energy-before-shown)<.001);assert.equal(r.canDecide,true);stepWorld(w,1);
 const energy=r.energy;run(w,r,{type:'wait',minutes:10},10);assert.ok(r.energy<energy);
 w.clock.paused=true;const unchanged=JSON.stringify(w);stepWorld(w,60);assert.equal(JSON.stringify(w),unchanged);
});

test('elder can separately approve a handoff through the normal menu; only actual final confirmation refunds the original contract',()=>{
 const {w,from,to,p,old,next,h}=handoff(),money=totalCoins(w),stock=structuredClone([from.inventory,to.inventory,p.inventory]),rights=structuredClone([p.homeId,p.guardianIds,p.parents]);
 assert.ok(longCareReason(w,to,{type:'longCare',operation:'receiveHandoff',replacementId:h.id}));
 const {choices,c,action}=choose(w,p,'approveHandoff');assert.ok(choices.some(c=>c.action.type==='longCare'&&c.action.operation==='declineHandoff'));
 assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,acceptedAt:w.minute}),choices));
 run(w,p,action);assert.notEqual(h.approvals![0].acceptedAt,null);assert.equal(old.status,'active');assert.equal(old.refunded,0);
 const confirm=choose(w,to,'receiveHandoff').action;run(w,to,confirm);assert.equal(h.status,'completed');assert.equal(old.status,'cancelled');assert.equal(old.refunded,4);assert.equal(next.status,'active');assert.equal(accountBalance(w,next.account),4);
 assert.deepEqual([from.inventory,to.inventory,p.inventory],stock);assert.deepEqual([p.homeId,p.guardianIds,p.parents],rights);assert.equal(totalCoins(w),money);
 assert.ok(completeLongCare(w,to,confirm as LongCareAction));assert.equal(w.longCare!.totals.handoffs,1);assert.equal(old.refunded,4);assert.equal(p.canDecide,true);
});

test('beneficiary rejection or approval withdrawal retains both agreements and every escrow balance',()=>{
 for(const approved of [false,true]){const {w,p,to,old,next,h}=handoff(),money=totalCoins(w);if(approved)act(w,p,{operation:'approveHandoff',replacementId:h.id});run(w,p,choose(w,p,'declineHandoff').action);assert.equal(h.status,'declined');assert.equal(old.status,'active');assert.equal(next.status,'active');assert.equal(old.refunded,0);assert.equal(accountBalance(w,old.account),4);assert.equal(accountBalance(w,next.account),4);assert.equal(totalCoins(w),money);assert.ok(longCareReason(w,to,{type:'longCare',operation:'receiveHandoff',replacementId:h.id}));}
});

test('handoff for a capable minor requires both current guardian and child, through their normal age-filtered choices',()=>{
 const {w,from,to,p,h,old}=handoff(8);assert.deepEqual(h.approvals!.map(a=>a.role),['guardian','beneficiary']);run(w,from,choose(w,from,'approveHandoff').action);
 assert.ok(longCareReason(w,to,{type:'longCare',operation:'receiveHandoff',replacementId:h.id}));run(w,p,choose(w,p,'approveHandoff').action);run(w,to,choose(w,to,'receiveHandoff').action);assert.equal(old.status,'cancelled');assert.deepEqual(p.guardianIds,[from.id]);
});

test('expired, changed guardian, new refusal, incapacity, changed contract or absent party invalidate approval and completion without resource grants',()=>{
 const changes=[(f:ReturnType<typeof handoff>)=>{f.w.minute=f.h.expiresAt;},f=>{f.p.guardianIds=[];},f=>{f.p.refusesCare=true;},f=>{f.to.canDecide=false;},f=>{f.old.status='cancelled';},f=>{f.next.endDay=Math.floor(f.w.minute/DAY);},f=>{f.from.at={x:2,y:2};},f=>{f.to.at={x:2,y:2};}] satisfies ((f:ReturnType<typeof handoff>)=>void)[];
 for(const change of changes){const f=handoff(8),{w,from,p,to,h,old,next}=f;act(w,from,{operation:'approveHandoff',replacementId:h.id});act(w,p,{operation:'approveHandoff',replacementId:h.id});change(f);const money=totalCoins(w);assert.ok(completeLongCare(w,to,{type:'longCare',operation:'receiveHandoff',replacementId:h.id}));assert.equal(h.status,'offered');assert.equal(old.refunded,0);assert.equal(accountBalance(w,next.account),4);assert.equal(totalCoins(w),money);}
});

test('an infant handoff still requires a separate guardian action even when that guardian proposed the handoff',()=>{
 const {w,from,to,p,old,next,h}=handoff(2);assert.equal(h.approvals!.length,1);assert.equal(h.approvals![0].residentId,from.id);assert.ok(longCareReason(w,to,{type:'longCare',operation:'receiveHandoff',replacementId:h.id}));act(w,from,{operation:'approveHandoff',replacementId:h.id});act(w,to,{operation:'receiveHandoff',replacementId:h.id});assert.equal(h.status,'completed');assert.equal(p.homeId,old.addressId);assert.equal(next.visits.length,0);
});

test('a pending old save gains no implied handoff consent and restores approvals durably without replaying the refund',()=>{
 const f=handoff(),{w,p,to,h,old}=f;delete h.approvals;const store=new WorldStore(':memory:');store.commit(w,null);let saved=store.load()!;const revision=saved.revision;initializeLongCare(saved);const restored=saved.longCare!.handoffs[0],recipient=saved.residents.find(r=>r.id===p.id)!,caregiver=saved.residents.find(r=>r.id===to.id)!;
 assert.equal(restored.approvals![0].acceptedAt,null);assert.ok(longCareReason(saved,caregiver,{type:'longCare',operation:'receiveHandoff',replacementId:h.id}));act(saved,recipient,{operation:'approveHandoff',replacementId:h.id});saved.revision++;store.commit(saved,revision);saved=store.load()!;initializeLongCare(saved);
 assert.notEqual(saved.longCare!.handoffs[0].approvals![0].acceptedAt,null);const rev=saved.revision;act(saved,saved.residents.find(r=>r.id===to.id)!,{operation:'receiveHandoff',replacementId:h.id});const total=totalCoins(saved);saved.revision++;store.commit(saved,rev);saved=store.load()!;initializeLongCare(saved);advanceLongCare(saved);assert.equal(totalCoins(saved),total);assert.equal(saved.longCare!.agreements.find(c=>c.id===old.id)!.refunded,4);assert.equal(saved.longCare!.totals.handoffs,1);store.close();
});

test('pending handoffs are bounded per original contract and expire without ending it',()=>{
 const {w,from,p,old,next,h}=handoff();assert.ok(completeLongCare(w,from,{type:'longCare',operation:'handoff',agreementId:old.id,replacementId:next.id}));p.name='<script>unsafe</script>';h.reason='<b>reason</b>';
 const before=JSON.stringify(w);assert.equal(JSON.stringify(w),before);w.minute=h.expiresAt;advanceLongCare(w);assert.equal(h.status,'expired');assert.equal(old.status,'active');assert.equal(old.refunded,0);
});
