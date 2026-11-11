import assert from 'node:assert/strict';
import {test} from 'node:test';
import {childTransportFixture,transportMenu,selectTransport,queueTransport,runTransport,finishTransport,pickUpChild,transportPlan} from './helpers/child-medical-transport-age-consent.js';
import {completeHealth,healthReason} from '../src/world/health.js';
import {rescueAuthority,syncMedicalTransport,passenger} from '../src/world/medical-transport.js';
import {transportPersonalConsent} from '../src/world/medical-transport-consent.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {totalCoins} from '../src/world/economy.js';
import {YEAR} from '../src/world/time.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {parseChoice} from '../src/server/affordances.js';

const has=(f:ReturnType<typeof childTransportFixture>,operation:string)=>transportMenu(f.w,f.child).some(c=>c.action.type==='health'&&c.action.operation===operation);
for(const accepted of [false,true])test(`normal menu: under-six proxy ${accepted?'accepted':'offered'} waits for independent child consent at birthday`,()=>{
 const f=childTransportFixture(accepted),{w,helper,child,guardian,offer,birthday}=f,original=structuredClone(offer),inventory={...helper.inventory},coins=totalCoins(w);
 w.minute=birthday-.25;stepWorld(w,.25);
 assert.equal(offer.status,'awaitingPatient');assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
 assert.equal(rescueAuthority(w,helper,child,f.clinic.id),null);assert.equal(has(f,'acceptRescue'),true);assert.equal(has(f,'declineRescue'),true);assert.equal(has(f,'cancelRescue'),true);
 assert.ok(completeHealth(w,guardian,{type:'health',operation:'acceptRescue',offerId:offer.id}));assert.deepEqual(helper.inventory,inventory);assert.equal(totalCoins(w),coins);
 runTransport(w,child,selectTransport(w,child,'acceptRescue'));assert.equal(offer.status,'accepted');assert.ok(transportPersonalConsent(w,offer,child));assert.equal(offer.respondentId,original.respondentId);assert.equal(offer.createdAt,original.createdAt);assert.equal(offer.expiresAt,original.expiresAt);assert.equal(offer.proxyAcceptedAt,original.proxyAcceptedAt);
 const t=pickUpChild(f);assert.equal(t.basis,'consent');finishTransport(w,helper);assert.equal(t.phase,'delivered');assert.equal(child.inside,f.clinic.id);assert.equal(helper.inventory.cloth,inventory.cloth!-1);assert.equal(helper.inventory.water,inventory.water!-1);assert.equal(totalCoins(w),coins);
});

test('pure birthday guard rejects stale pickup and last-quarter completion before lifecycle sync',()=>{
 const f=childTransportFixture(),{w,helper,child,offer,birthday}=f;
 w.minute=birthday-15;const pickup=selectTransport(w,helper,'rescue',child.id);queueTransport(w,helper,pickup);stepWorld(w,14.75);
 const stock={...helper.inventory},at={...child.at};assert.ok(helper.activity);assert.equal(offer.status,'accepted');
 w.minute=birthday;child.canDecide=child.canExpress=true;assert.equal(rescueAuthority(w,helper,child,f.clinic.id),null);assert.ok(completeHealth(w,helper,helper.activity!.action as never));
 stepWorld(w,.25);assert.equal(w.health!.transports.length,0);assert.deepEqual(helper.inventory,stock);assert.deepEqual(child.at,at);assert.equal(offer.status,'awaitingPatient');
});

for(const reverse of [false,true])test(`started transport stops before the next birthday edge in resident order ${reverse}`,()=>{
 const f=childTransportFixture(),t=pickUpChild(f),{w,helper,child,offer,birthday}=f;const at=structuredClone({at:child.at,inside:child.inside,roomAt:child.roomAt}),stock={...helper.inventory};
 if(reverse)w.residents.reverse();w.minute=birthday-.25;stepWorld(w,.25);
 assert.equal(t.phase,'interrupted');assert.equal(helper.activity,null);assert.equal(passenger(w,child.id),undefined);assert.deepEqual({at:child.at,inside:child.inside,roomAt:child.roomAt},at);assert.deepEqual(helper.inventory,stock);assert.equal(offer.status,'awaitingPatient');assert.equal(offer.personalAcceptedAt,null);
});

for(const operation of ['declineRescue','cancelRescue'] as const)test(`birthday ${operation} is immediate, idempotent, and cannot be overwritten`,()=>{
 const f=childTransportFixture(),{w,child,helper,offer,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;
 const p=queueTransport(w,child,selectTransport(w,child,operation));assert.equal(offer.status,operation==='declineRescue'?'declined':'cancelled');
 const status=offer.status;assert.deepEqual(submitPlan(w,p),{ok:true});assert.ok(completeHealth(w,child,{type:'health',operation:'acceptRescue',offerId:offer.id}));
 child.canDecide=false;syncMedicalTransport(w);assert.equal(offer.status,status);assert.equal(rescueAuthority(w,helper,child,f.clinic.id),null);assert.equal(offer.personalAcceptedAt,null);
});

test('birthday waiting neither clears personal refusal nor renews the original expiry',()=>{
 const f=childTransportFixture(),{w,child,offer,birthday}=f;w.minute=birthday;child.canDecide=child.canExpress=true;syncMedicalTransport(w);
 child.refusesCare=true;assert.equal(has(f,'acceptRescue'),false);assert.ok(completeHealth(w,child,{type:'health',operation:'acceptRescue',offerId:offer.id}));assert.equal(child.refusesCare,true);
 w.minute=offer.expiresAt;syncMedicalTransport(w);assert.equal(offer.status,'expired');assert.equal(has(f,'acceptRescue'),false);assert.equal(offer.personalAcceptedAt,null);
});

for(const capacity of ['neither','expressionOnly'] as const)test(`birthday ${capacity} cannot inherit proxy consent but expression can refuse`,()=>{
 const f=childTransportFixture(),{w,child,offer,birthday}=f;w.minute=birthday;child.lifeStage='child';child.canDecide=false;child.canExpress=capacity==='expressionOnly';syncMedicalTransport(w);
 assert.equal(offer.status,'awaitingPatient');assert.equal(has(f,'acceptRescue'),false);assert.equal(submitPlan(w,transportPlan(w,child,{type:'health',operation:'acceptRescue',offerId:offer.id})).ok,false);
 if(capacity==='expressionOnly'){assert.equal(has(f,'declineRescue'),true);queueTransport(w,child,selectTransport(w,child,'declineRescue'));assert.equal(offer.status,'declined');assert.equal(child.canDecide,false);}
 else{assert.equal(has(f,'declineRescue'),false);child.canDecide=child.canExpress=true;runTransport(w,child,selectTransport(w,child,'acceptRescue'));assert.equal(offer.status,'accepted');}
});

test('own medical passenger can express an immediate stop during unrelated busy wait',()=>{
 const f=childTransportFixture(),{w,child,helper}=f;w.minute=f.birthday;child.lifeStage='child';child.canDecide=child.canExpress=true;runTransport(w,child,selectTransport(w,child,'acceptRescue'));const t=pickUpChild(f);
 queueTransport(w,child,{type:'wait',minutes:15});stepWorld(w,.25);child.canDecide=false;const at={...child.at},stock={...helper.inventory},choices=transportMenu(w,child);
 assert.ok(choices.every(c=>c.action.type==='wait'||c.action.type==='health'&&['declineRescue','cancelRescue'].includes(c.action.operation)));
 queueTransport(w,child,selectTransport(w,child,'cancelRescue'));assert.equal(t.phase,'interrupted');assert.equal(helper.activity,null);assert.deepEqual(child.at,at);assert.deepEqual(helper.inventory,stock);assert.equal(child.canDecide,false);
});

test('SQLite stale pickup cannot replace birthday refusal; exact old records stay unknown until own real choice',()=>{
 const f=childTransportFixture(),{w,child,helper,offer,birthday}=f;delete offer.personalAcceptedAt;delete offer.proxyAcceptedAt;const raw=structuredClone(offer),db=new WorldStore(':memory:');
 try{db.commit(w,null);const winner=db.load()!,stale=db.load()!,p=winner.residents.find(r=>r.id===child.id)!;winner.minute=birthday;p.canDecide=p.canExpress=true;syncMedicalTransport(winner);
  const current=winner.health!.transportOffers[0];assert.equal(current.personalAcceptedAt,undefined);assert.equal(current.proxyAcceptedAt,undefined);assert.equal(current.respondentId,raw.respondentId);assert.equal(current.expiresAt,raw.expiresAt);
  queueTransport(winner,p,selectTransport(winner,p,'declineRescue'));db.commit(winner,w.revision);
  const r=stale.residents.find(r=>r.id===helper.id)!,q=stale.residents.find(r=>r.id===child.id)!;stale.minute=birthday;q.canDecide=q.canExpress=true;assert.ok(healthReason(stale,r,{type:'health',operation:'rescue',targetId:q.id,buildingId:f.clinic.id}));stale.revision++;assert.throws(()=>db.commit(stale,w.revision),/stale_world_revision/);
  const loaded=db.loadForRuntime()!;syncMedicalTransport(loaded);assert.equal(loaded.health!.transportOffers[0].status,'declined');assert.equal(loaded.health!.transportOffers[0].personalAcceptedAt,undefined);assert.equal(loaded.health!.transports.length,0);
 }finally{db.close();}
});

test('legacy proved personal acceptance survives read-only inspection without a fabricated timestamp',()=>{
 const f=childTransportFixture(),{w,child,offer}=f;child.bornAt=offer.createdAt-8*YEAR;child.lifeStage='child';child.canDecide=child.canExpress=true;offer.respondentId=child.id;delete offer.personalAcceptedAt;delete offer.proxyAcceptedAt;
 const before=structuredClone(offer);assert.ok(transportPersonalConsent(w,offer,child));syncMedicalTransport(w);assert.deepEqual(offer,before);assert.equal(rescueAuthority(w,f.helper,child,f.clinic.id)?.basis,'consent');
});

test('offline runtime queues expression-only busy medical passenger for a stop',async()=>{
 const f=childTransportFixture();f.w.minute=f.birthday;f.child.lifeStage='child';f.child.canDecide=f.child.canExpress=true;runTransport(f.w,f.child,selectTransport(f.w,f.child,'acceptRescue'));const t=pickUpChild(f);queueTransport(f.w,f.child,{type:'wait',minutes:15});stepWorld(f.w,.25);f.child.canDecide=false;f.child.decisionDue=f.w.minute;f.helper.decisionDue=f.guardian.decisionDue=Number.MAX_SAFE_INTEGER;
 const db=new WorldStore(':memory:');db.commit(f.w,null);const called:string[]=[];
 const runtime=new ValleyRuntime(db,'synthetic-test-credential',async(_key,c)=>{called.push(c.actor.id);const choices=transportMenu(runtime.world,runtime.world.residents.find(r=>r.id===c.actor.id)!);const stop=choices.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue');return {decision:stop?parseChoice(JSON.stringify({choice:stop.id}),choices):{intention:'等候',actions:[{type:'wait' as const,minutes:10}]},inputTokens:1,outputTokens:1,latencyMs:1};});
 try{runtime.tick();for(let i=0;i<20&&!called.includes(f.child.id);i++)await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));assert.ok(called.includes(f.child.id));assert.equal(runtime.world.health!.transports.find(x=>x.id===t.id)!.phase,'interrupted');assert.equal(runtime.world.residents.find(r=>r.id===f.child.id)!.canDecide,false);}finally{await runtime.stop();db.close();}
});

test('saturated final agenda retains the same birthday offer accept, refusal and cancellation without bypassing journey filters',async()=>{
 const {decisionContext,decisionChoices}=await import('../src/server/decisions.js');
 const f=childTransportFixture();f.w.minute=f.birthday;f.child.canDecide=f.child.canExpress=true;f.child.lifeStage='child';syncMedicalTransport(f.w);
 const c=decisionContext(f.w,f.child),offer=f.offer;
 c.formal!.opportunities.unshift(...Array.from({length:160},(_,i)=>({id:`synthetic.control.${i}`,label:'另一个已知决定',action:{type:'longCare' as const,operation:'cancel' as const,agreementId:'unrelated:'+i}})));
 const choices=decisionChoices(c);for(const operation of ['acceptRescue','declineRescue','cancelRescue'])assert.ok(choices.some(c=>c.action.type==='health'&&c.action.operation===operation&&c.action.offerId===offer.id));
 const row=choices.find(c=>c.action.type==='health'&&c.action.operation==='acceptRescue')!;for(const extra of [{personalAcceptedAt:f.w.minute},{respondentId:f.child.id},{targetId:f.guardian.id}])assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,...extra}),choices));
 c.formal!.familyTravelling=true;assert.equal(decisionChoices(c).some(c=>c.action.type==='health'),false);
 c.formal!.familyTravelling=false;c.formal!.expressiveEvacuationOnly=true;const restricted=decisionChoices(c);assert.ok(restricted.every(c=>c.action.type==='wait'||c.action.type==='health'&&['declineRescue','cancelRescue'].includes(c.action.operation)));
});
