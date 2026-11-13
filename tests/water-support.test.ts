import {healthDefaults} from '../src/shared/process-definitions.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {WaterSupplyAction,WaterVessel} from '../src/shared/water-supply.js';
import {createWorld} from '../src/world/seed.js';
import {roomLayout} from '../src/shared/rooms.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeHealth} from '../src/world/health.js';
import {initializeWaterSupply,completeWaterSupply,waterReceiptId,waterSupplyReason,waterDrunkToday} from '../src/world/water-supply.js';
import {assistedWaterNeed} from '../src/world/water-support.js';
import {waterSupplyOpportunities} from '../src/server/water-supply-opportunities.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';

import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

type Fields=WaterSupplyAction extends infer A?A extends WaterSupplyAction?Omit<A,'type'|'receiptId'>:never:never;
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.map={...w.map,width:40,height:32,tiles:Array(40*32).fill('grass'),entrance:{x:0,y:12}};w.resources=[];w.plots=[];w.graves=[];
 const hall=w.buildings.find(b=>b.kind==='lodge')!;hall.at={x:16,y:6};hall.width=8;hall.height=6;hall.door={x:20,y:12};hall.residents=[];w.buildings=[hall];
 for(const r of w.residents){r.at={x:12,y:12};r.inside=null;r.roomAt=null;r.homeId=null;r.parents=[];r.guardianIds=[];r.inventory={wood:20,water:3};r.bornAt=w.minute-30*YEAR;r.health=r.energy=100;r.hunger=0;r.knownBuildings=[hall.id];r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.activity=null;r.plan=null;r.skills.care=2;}
 initializeCivic(w);initializeRooms(w);initializeWaterSupply(w);initializeHealth(w);
 const [provider,adult,child]=w.residents;child.bornAt=w.minute-10*YEAR;child.skills.care=0;
 const bucket:WaterVessel={id:'support-bucket',ownerId:provider.id,buildingId:null,capacity:6,amount:4,quality:'safe',createdAt:w.minute};w.waterSupply!.vessels.push(bucket);
 return {w,provider,adult,child,bucket,hall};
}
const action=(w:World,r:Resident,fields:Fields):WaterSupplyAction=>({type:'waterSupply',receiptId:waterReceiptId(w,r),...fields});
function queue(w:World,r:Resident,a:Action){const p={id:`support:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择有限供水安排',actions:[a]};assert.equal(submitPlan(w,p).ok,true);return p;}
function finish(w:World,r:Resident){let ticks=100;while(r.plan||r.activity){assert.ok(ticks--);stepWorld(w,1);}}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);assert.equal(r.lastFailure,null);}
function atRoom(f:ReturnType<typeof fixture>,r:Resident,at={x:8,y:8}){r.at={...f.hall.door};r.inside=f.hall.id;r.roomAt={...at};}
function authorize(f:ReturnType<typeof fixture>){const {w,adult,provider}=f;assert.equal(completeWaterSupply(w,adult,action(w,adult,{operation:'authorizeAssist',targetId:provider.id})),null);return w.waterSupply!.assistance!.at(-1)!;}
function injury(f:ReturnType<typeof fixture>,severity=30){const {w,adult}=f;w.health!.cases.push({id:'limited-mobility',personId:adult.id,kind:'injury',source:'isolated-test',severity,stage:'acute',startedAt:w.minute,lastAt:w.minute,resolvedAt:null,treatment:0,capacity:null});}
function gift(f:ReturnType<typeof fixture>){const {w,provider,child,bucket}=f;assert.equal(completeWaterSupply(w,provider,action(w,provider,{operation:'offerVessel',targetId:child.id,vesselId:bucket.id})),null);return w.waterSupply!.gifts!.at(-1)!;}

test('legacy adoption adds no gifts, assistance, supplies or authority from old care records',()=>{
 const f=fixture(),{w,adult,provider,bucket}=f;delete w.waterSupply!.assistance;delete w.waterSupply!.gifts;w.proposals.push({id:'old-care',actorId:provider.id,targetId:adult.id,kind:'care',createdAt:w.minute,status:'accepted',expiresAt:w.minute+DAY,definition:w.activeDefinitions['action/routine']});adult.guardianIds=[provider.id];adult.canDecide=false;adult.health=10;
 const amount=bucket.amount,inventory=structuredClone(provider.inventory);initializeWaterSupply(w);initializeWaterSupply(w);assert.deepEqual(w.waterSupply!.assistance,[]);assert.deepEqual(w.waterSupply!.gifts,[]);
 assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:'old-care',vesselId:bucket.id}))!,/明确饮水授权/);assert.equal(bucket.amount,amount);assert.deepEqual(provider.inventory,inventory);assert.equal('thirst'in adult,false);
});

test('normal menus authorize named limited assistance, then actual moderate-mobility care consumes one provider unit',()=>{
 const f=fixture(),{w,adult,provider,bucket}=f;const choices=waterSupplyOpportunities(w,adult),choice=choices.find(c=>c.action.type==='waterSupply'&&c.action.operation==='authorizeAssist'&&c.action.targetId===provider.id)!;assert.ok(choice);
 run(w,adult,parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0]);const c=w.waterSupply!.assistance![0];assert.equal(c.beneficiaryId,adult.id);assert.equal(c.providerId,provider.id);assert.equal(c.expiresAt-c.createdAt,DAY);assert.equal(c.used,0);assert.equal(bucket.amount,4);assert.equal(waterDrunkToday(w,adult.id),0);
 injury(f);const health=adult.health,canDecide=adult.canDecide;const aid=waterSupplyOpportunities(w,provider).find(x=>x.action.type==='waterSupply'&&x.action.operation==='assistDrink')!;assert.ok(aid);run(w,provider,parseChoice(JSON.stringify({choice:aid.id}),[aid]).actions[0]);
 assert.equal(bucket.amount,3);assert.equal(c.used,1);assert.equal(waterDrunkToday(w,adult.id),1);assert.equal(adult.health,health);assert.equal(adult.canDecide,canDecide);assert.deepEqual(adult.guardianIds,[]);assert.ok(w.events.some(e=>e.audit?.evidence===c.id&&e.audit.resources.water===1));
});

test('loss of decision capacity cannot create or use an authorization, and refusal never becomes an emergency bypass',()=>{
 const f=fixture(),{w,adult,provider,bucket}=f;adult.canDecide=false;assert.match(completeWaterSupply(w,adult,action(w,adult,{operation:'authorizeAssist',targetId:provider.id}))!,/独立/);adult.canDecide=true;const c=authorize(f);
 const aid=()=>action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id});assert.match(completeWaterSupply(w,provider,aid())!,/行动受限/);injury(f);adult.canDecide=false;assert.match(completeWaterSupply(w,provider,aid())!,/完整决定/);adult.canDecide=true;
 adult.refusesCare=true;assert.match(completeWaterSupply(w,provider,aid())!,/拒绝/);adult.refusesCare=false;adult.canExpress=false;assert.match(completeWaterSupply(w,provider,aid())!,/配合/);adult.canExpress=true;adult.health=20;assert.match(completeWaterSupply(w,provider,aid())!,/危急/);assert.equal(bucket.amount,4);
});

test('severe thresholds are case-specific and sleeping recipients cannot be fed under a saved authorization',()=>{
 const f=fixture(),{w,adult,provider,bucket}=f,c=authorize(f);injury(f,30);const aid=()=>action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id});
 w.health!.cases[0].severity=50;assert.match(completeWaterSupply(w,provider,aid())!,/重症/);w.health!.cases[0].severity=30;w.health!.cases[0].rules={...healthDefaults,severeSeverity:25};assert.match(assistedWaterNeed(w,adult)!,/重症/);delete w.health!.cases[0].rules;
 const next=structuredClone(w.definitions['health/rules@1']);next.version=2;next.data.severeSeverity=25;w.definitions['health/rules@2']=next;w.health!.cases[0].definition='health/rules@2';assert.match(assistedWaterNeed(w,adult)!,/重症/);delete w.health!.cases[0].definition;
 adult.activity={planId:'asleep',action:{type:'sleep',minutes:10},startedAt:w.minute,remaining:10,path:[],target:{...adult.at},definition:w.activeDefinitions['action/routine']};assert.match(completeWaterSupply(w,provider,aid())!,/清醒/);assert.equal(bucket.amount,4);
});

test('revocation, refusal or expiry during five-minute assistance spends nothing and never resets authority on reload',()=>{
 for(const change of ['revoke','refusal','expiry'] as const){
  const f=fixture(),{w,adult,provider,bucket}=f,c=authorize(f);injury(f);if(change==='expiry')w.minute=c.expiresAt-3;
  queue(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}));stepWorld(w,1);
  if(change==='revoke')assert.equal(completeWaterSupply(w,adult,action(w,adult,{operation:'revokeAssist',authorizationId:c.id})),null);if(change==='refusal')adult.refusesCare=true;finish(w,provider);assert.ok(provider.lastFailure);assert.equal(bucket.amount,4);assert.equal(c.used,0);
  const restored=JSON.parse(JSON.stringify(w)) as World;initializeWaterSupply(restored);assert.deepEqual(restored.waterSupply!.assistance,w.waterSupply!.assistance);
 }
});

test('personal, public and assisted drinks share recipient daily limit, while authorization and gifts count as no drinking',()=>{
 const f=fixture(),{w,adult,provider,bucket}=f,c=authorize(f);injury(f);const personal={...bucket,id:'adult-bucket',ownerId:adult.id,amount:2};w.waterSupply!.vessels.push(personal);
 assert.equal(completeWaterSupply(w,adult,action(w,adult,{operation:'drink',vesselId:personal.id})),null);assert.equal(completeWaterSupply(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id})),null);assert.equal(waterDrunkToday(w,adult.id),2);
 assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}))!,/24小时/);assert.equal(bucket.amount,3);assert.equal(c.used,1);
});

test('both people must have real room coordinates, room rights and an unblocked physical path',()=>{
 const f=fixture(),{w,adult,provider,bucket,hall}=f,c=authorize(f);injury(f);const aid=()=>action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id});
 atRoom(f,provider);adult.at={...hall.door};assert.match(completeWaterSupply(w,provider,aid())!,/地点/);atRoom(f,adult);adult.roomAt=null;assert.match(completeWaterSupply(w,provider,aid())!,/地点/);
 atRoom(f,provider,{x:6,y:7});atRoom(f,adult,{x:7,y:7});assert.match(completeWaterSupply(w,provider,aid())!,/地点/);atRoom(f,provider);atRoom(f,adult);hall.ownerId=provider.id;assert.match(completeWaterSupply(w,provider,aid())!,/地点/);
 for(const p of [provider,adult]){p.inside=null;p.roomAt=null;}provider.at={x:12,y:12};adult.at={x:14,y:12};w.map.tiles[12*w.map.width+13]='cliff';assert.match(completeWaterSupply(w,provider,aid())!,/地点/);assert.equal(bucket.amount,4);
});

test('wrong provider, exhausted water, changed vessel rights and restored mobility reject assisted consumption',()=>{
 const f=fixture(),{w,adult,provider,child,bucket}=f,c=authorize(f);injury(f);child.bornAt=w.minute-30*YEAR;child.skills.care=2;
 assert.match(completeWaterSupply(w,child,action(w,child,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}))!,/指定/);bucket.amount=0;assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}))!,/安全水/);bucket.amount=4;bucket.ownerId=adult.id;assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}))!,/安全水/);bucket.ownerId=provider.id;w.health!.cases[0].severity=0;assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}))!,/行动受限/);assert.equal(bucket.amount,4);
});

test('a six-year-old independently accepts a real gifted bucket through the normal menu, then loads and drinks own stock',()=>{
 const f=fixture(),{w,provider,child,bucket}=f;child.bornAt=w.minute-6*YEAR;bucket.amount=0;const parentInventory=structuredClone(provider.inventory),childInventory=structuredClone(child.inventory),g=gift(f);assert.equal(bucket.ownerId,provider.id);assert.equal(waterDrunkToday(w,child.id),0);
 const menu=decisionChoices(decisionContext(w,child)),accept=menu.find(c=>c.action.type==='waterSupply'&&c.action.operation==='acceptVessel'),decline=menu.find(c=>c.action.type==='waterSupply'&&c.action.operation==='declineVessel');assert.ok(accept);assert.ok(decline);run(w,child,parseChoice(JSON.stringify({choice:accept.id}),menu).actions[0]);assert.equal(g.status,'accepted');assert.equal(bucket.ownerId,child.id);assert.equal(bucket.id,'support-bucket');assert.equal(bucket.capacity,6);assert.equal(w.waterSupply!.vessels.length,1);assert.deepEqual(provider.inventory,parentInventory);assert.deepEqual(child.inventory,childInventory);assert.deepEqual(child.guardianIds,[]);assert.equal(waterDrunkToday(w,child.id),0);
 run(w,child,action(w,child,{operation:'load',vesselId:bucket.id,quantity:2}));run(w,child,action(w,child,{operation:'drink',vesselId:bucket.id}));assert.equal(child.inventory.water,1);assert.equal(bucket.amount,1);assert.equal(waterDrunkToday(w,child.id),1);
});

test('filled bucket gift conserves its exact water and never counts transfer as drinking',()=>{
 const f=fixture(),{w,provider,child,bucket}=f,g=gift(f),a=action(w,child,{operation:'acceptVessel',giftId:g.id});assert.equal(completeWaterSupply(w,child,a),null);assert.equal(bucket.amount,4);assert.equal(bucket.ownerId,child.id);assert.equal(waterDrunkToday(w,child.id),0);assert.equal(waterDrunkToday(w,provider.id),0);
 const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;store.close();initializeWaterSupply(saved);assert.equal(completeWaterSupply(saved,saved.residents[2],a),null);assert.equal(saved.waterSupply!.vessels.length,1);assert.equal(saved.waterSupply!.vessels[0].amount,4);assert.equal(saved.waterSupply!.gifts![0].status,'accepted');
});

test('changed quantity/quality/ownership, departure, death, birthday and carrying limit stop an offered gift',()=>{
 for(const change of ['quantity','raw','owner','outside','dead','birthday','full'] as const){
  const f=fixture(),{w,provider,child,bucket}=f,g=gift(f);if(change==='quantity')bucket.amount--;if(change==='raw')bucket.quality='raw';if(change==='owner')bucket.ownerId=child.id;if(change==='outside')provider.residency='outside';if(change==='dead')provider.status='dead';if(change==='birthday')child.bornAt=w.minute-18*YEAR;if(change==='full')for(let i=0;i<8;i++)w.waterSupply!.vessels.push({...bucket,id:'child-bucket:'+i,ownerId:child.id});
  const before=JSON.stringify(w.waterSupply!.vessels);assert.ok(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id})));assert.equal(JSON.stringify(w.waterSupply!.vessels),before);assert.equal(g.status,'offered');
 }
});

test('gift rejection and cancellation need no proximity or retained stock; expiry and competing acceptance cannot transfer twice',()=>{
 for(const operation of ['declineVessel','cancelVessel'] as const){const f=fixture(),{w,provider,child,bucket}=f,g=gift(f);child.at={x:1,y:1};bucket.amount=2;const r=operation==='declineVessel'?child:provider;assert.equal(completeWaterSupply(w,r,action(w,r,{operation,giftId:g.id})),null);assert.equal(bucket.ownerId,provider.id);assert.equal(bucket.amount,2);assert.ok(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id})));}
 const f=fixture(),{w,provider,child,bucket}=f,g=gift(f);queue(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id}));stepWorld(w,1);assert.equal(completeWaterSupply(w,provider,action(w,provider,{operation:'cancelVessel',giftId:g.id})),null);finish(w,child);assert.ok(child.lastFailure);assert.equal(bucket.ownerId,provider.id);
 const newer=gift(f);w.minute=newer.expiresAt;assert.match(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:newer.id}))!,/有效/);assert.equal(bucket.ownerId,provider.id);
});

test('gift handoff cannot cross a blocked route or missing indoor location, and strangers cannot seize a pending bucket',()=>{
 const f=fixture(),{w,provider,child,adult,bucket}=f,g=gift(f);child.at={x:14,y:12};w.map.tiles[12*w.map.width+13]='cliff';assert.match(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id}))!,/现场|在场/);atRoom(f,provider);atRoom(f,child);child.roomAt=null;assert.ok(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id})));adult.bornAt=w.minute-10*YEAR;assert.ok(completeWaterSupply(w,adult,action(w,adult,{operation:'acceptVessel',giftId:g.id})));assert.equal(bucket.ownerId,provider.id);
});

test('public or raw filled vessels cannot be offered and duplicate outstanding offers preserve donor choice',()=>{
 const f=fixture(),{w,provider,child,bucket}=f;bucket.ownerId='commons';bucket.buildingId=f.hall.id;assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'offerVessel',targetId:child.id,vesselId:bucket.id}))!,/本人携带/);bucket.ownerId=provider.id;bucket.buildingId=null;bucket.quality='raw';assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'offerVessel',targetId:child.id,vesselId:bucket.id}))!,/安全水/);bucket.quality='safe';gift(f);assert.match(completeWaterSupply(w,provider,action(w,provider,{operation:'offerVessel',targetId:child.id,vesselId:bucket.id}))!,/提议/);assert.equal(w.waterSupply!.gifts!.length,1);
});

test('permission withdrawal and actual ownership delivery remain separate',()=>{
 const f=fixture(),{w,adult,provider,child}=f;adult.name='<script>x</script>';authorize(f);gift(f);const c=w.waterSupply!.assistance![0];completeWaterSupply(w,adult,action(w,adult,{operation:'revokeAssist',authorizationId:c.id}));const g=w.waterSupply!.gifts![0];completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id}));assert.equal(waterDrunkToday(w,provider.id),0);
});

test('normal submitted revocation is immediate before another actors pending assistance can complete',()=>{
 const f=fixture(),{w,adult,provider,bucket}=f,c=authorize(f);injury(f);queue(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}));stepWorld(w,1);const minute=w.minute;
 const choices=decisionChoices(decisionContext(w,adult)),revoke=choices.find(x=>x.action.type==='waterSupply'&&x.action.operation==='revokeAssist')!;assert.ok(revoke);const parsed=parseChoice(JSON.stringify({choice:revoke.id}),choices);const plan={id:'immediate-revoke',actorId:adult.id,actorRevision:adult.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...parsed};assert.equal(submitPlan(w,plan).ok,true);
 assert.equal(c.revokedAt,minute);assert.equal(w.minute,minute);assert.equal(adult.activity,null);assert.equal(adult.plan,null);finish(w,provider);assert.ok(provider.lastFailure);assert.equal(bucket.amount,4);assert.equal(c.used,0);assert.equal(submitPlan(w,plan).ok,true);assert.equal(w.waterSupply!.receipts.filter(p=>p.operation==='revokeAssist').length,1);
});

test('normal submitted gift cancellation stops pending acceptance before transfer and mixed withdrawal plans are rejected',()=>{
 const f=fixture(),{w,provider,child,bucket}=f,g=gift(f);queue(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id}));stepWorld(w,1);const cancel=action(w,provider,{operation:'cancelVessel',giftId:g.id}),base={id:'cancel-gift',actorId:provider.id,actorRevision:provider.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'撤回赠桶'};
 const before=JSON.stringify(w);assert.equal(submitPlan(w,{...base,actions:[cancel,{type:'wait',minutes:1}]}).ok,false);assert.equal(JSON.stringify(w),before);
 assert.equal(submitPlan(w,{...base,actions:[cancel]}).ok,true);assert.equal(g.status,'cancelled');assert.equal(provider.activity,null);finish(w,child);assert.ok(child.lastFailure);assert.equal(bucket.ownerId,provider.id);assert.equal(bucket.amount,4);
});

function heldFerry(f:ReturnType<typeof fixture>,personId:string){const {w,provider}=f;w.ferries={boats:[{id:'boat',ownerId:provider.id,definition:'transport/ferry@1',at:{...provider.at},dockId:null,condition:100,tripId:'held-trip'}],builds:[],trips:[{id:'held-trip',boatId:'boat',operatorId:provider.id,sourceId:'source',destinationId:'destination',headingId:'destination',fare:0,departAt:w.minute,expiresAt:w.minute+100,capacity:3,phase:'held',seats:[],aboard:[personId],pilotId:provider.id,path:[],progress:0,returned:false,arrivedAt:null,reason:null}],nextSerial:0,totals:{built:0,voyages:0,fares:0,refunds:0}};}

test('aboard adults can submit immediate revocation without disembarking or moving any supply',()=>{
 const f=fixture(),{w,adult,provider,bucket}=f,c=authorize(f);heldFerry(f,adult.id);const original=structuredClone(w.ferries),menu=decisionChoices(decisionContext(w,adult)),choice=menu.find(c=>c.action.type==='waterSupply'&&c.action.operation==='revokeAssist');assert.ok(choice);
 run(w,adult,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);assert.equal(c.revokedAt,w.minute);assert.deepEqual(w.ferries,original);assert.equal(bucket.amount,4);assert.equal(bucket.ownerId,provider.id);
});

test('a capable escorted child can decline a gift normally without ending the escort or receiving the bucket',()=>{
 const f=fixture(),{w,child,provider,bucket,hall}=f,g=gift(f);w.health!.transports.push({id:'child-transport',carrierId:provider.id,patientId:child.id,buildingId:hall.id,bed:0,basis:'guardian',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});const original=structuredClone(w.health!.transports),menu=decisionChoices(decisionContext(w,child)),choice=menu.find(c=>c.action.type==='waterSupply'&&c.action.operation==='declineVessel');assert.ok(choice);assert.ok(!menu.some(c=>c.action.type==='waterSupply'&&c.action.operation==='acceptVessel'));
 run(w,child,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);assert.equal(g.status,'declined');assert.deepEqual(w.health!.transports,original);assert.equal(bucket.ownerId,provider.id);
});

test('boarding during previously chosen assistance invalidates its stale action without spending a unit',()=>{
 const f=fixture(),{w,provider,bucket}=f,c=authorize(f);injury(f);queue(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id}));stepWorld(w,1);heldFerry(f,provider.id);finish(w,provider);assert.ok(provider.lastFailure);assert.equal(c.used,0);assert.equal(bucket.amount,4);
});

test('remote assistance withdrawal does not remove the other persons own stop choice or overwrite the first stop',()=>{
 for(const firstBeneficiary of [true,false]){
  const f=fixture(),{w,adult,provider,bucket}=f,c=authorize(f);adult.at={x:1,y:1};const first=firstBeneficiary?adult:provider,other=firstBeneficiary?provider:adult;
  const controls=()=>decisionChoices(decisionContext(w,other)).filter(x=>x.action.type==='waterSupply'&&x.action.operation==='revokeAssist');
  const before=controls(),memories=structuredClone(other.memories);assert.equal(before.length,1);
  run(w,first,action(w,first,{operation:'revokeAssist',authorizationId:c.id}));const ended=c.revokedAt;assert.deepEqual(controls(),before);assert.deepEqual(other.memories,memories);
  w.minute++;run(w,other,parseChoice(JSON.stringify({choice:before[0].id}),controls()).actions[0]);assert.equal(c.revokedAt,ended);assert.equal(c.revokedBy,first.id);assert.deepEqual(c.stops?.map(s=>s.personId),[first.id,other.id]);assert.deepEqual(controls(),[]);assert.equal(c.used,0);assert.equal(bucket.amount,4);
  adult.at={...provider.at};injury(f);assert.ok(completeWaterSupply(w,provider,action(w,provider,{operation:'assistDrink',authorizationId:c.id,vesselId:bucket.id})));
 }
});

test('remote gift cancellation and refusal preserve each persons own decision menu and the first effective end',()=>{
 for(const firstDonor of [true,false]){
  const f=fixture(),{w,provider,child,bucket}=f,g=gift(f);child.at={x:1,y:1};const first=firstDonor?provider:child,other=firstDonor?child:provider,operation=firstDonor?'declineVessel':'cancelVessel';
  const controls=()=>decisionChoices(decisionContext(w,other)).filter(x=>x.action.type==='waterSupply'&&x.action.operation===operation);
  const before=controls(),memories=structuredClone(other.memories);assert.equal(before.length,1);
  run(w,first,action(w,first,{operation:firstDonor?'cancelVessel':'declineVessel',giftId:g.id}));const ended=g.endedAt,status=g.status;assert.deepEqual(controls(),before);assert.deepEqual(other.memories,memories);
  w.minute++;run(w,other,parseChoice(JSON.stringify({choice:before[0].id}),controls()).actions[0]);assert.equal(g.endedAt,ended);assert.equal(g.status,status);assert.deepEqual(g.stops?.map(s=>s.personId),[first.id,other.id]);assert.deepEqual(controls(),[]);assert.equal(bucket.ownerId,provider.id);assert.equal(bucket.amount,4);
  child.at={...provider.at};assert.ok(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id})));assert.equal(waterDrunkToday(w,child.id),0);
 }
});

test('legacy stop records do not reenable the original stoppers controls or infer the other persons decision',()=>{
 const f=fixture(),{w,adult,provider,child}=f,c=authorize(f),g=gift(f);c.revokedAt=w.minute;c.revokedBy=adult.id;g.status='cancelled';g.endedAt=w.minute;
 const restored=JSON.parse(JSON.stringify(w)) as World;initializeWaterSupply(restored);
 const op=(r:Resident,fields:Fields)=>waterSupplyReason(restored,r,action(restored,r,fields));
 assert.ok(op(restored.residents.find(p=>p.id===adult.id)!,{operation:'revokeAssist',authorizationId:c.id}));assert.equal(op(restored.residents.find(p=>p.id===provider.id)!,{operation:'revokeAssist',authorizationId:c.id}),null);
 assert.ok(op(restored.residents.find(p=>p.id===provider.id)!,{operation:'cancelVessel',giftId:g.id}));assert.equal(op(restored.residents.find(p=>p.id===child.id)!,{operation:'declineVessel',giftId:g.id}),null);
 assert.equal(restored.waterSupply!.assistance![0].stops,undefined);assert.equal(restored.waterSupply!.gifts![0].stops,undefined);
});

test('a distant recipients refusal cannot reveal itself by enabling the donors next gift offer',()=>{
 const f=fixture(),{w,provider,adult,child,bucket}=f,g=gift(f);child.at={x:1,y:1};adult.bornAt=w.minute-12*YEAR;
 const offers=()=>waterSupplyOpportunities(w,provider).filter(x=>x.action.type==='waterSupply'&&x.action.operation==='offerVessel');assert.deepEqual(offers(),[]);
 run(w,child,action(w,child,{operation:'declineVessel',giftId:g.id}));assert.deepEqual(offers(),[]);assert.equal(bucket.ownerId,provider.id);
 run(w,provider,action(w,provider,{operation:'cancelVessel',giftId:g.id}));const choice=offers().find(x=>x.action.type==='waterSupply'&&x.action.operation==='offerVessel'&&x.action.targetId===adult.id)!;assert.ok(choice);run(w,provider,choice.action);assert.equal(g.status,'declined');assert.equal(w.waterSupply!.gifts!.length,2);assert.equal(bucket.ownerId,provider.id);assert.equal(bucket.amount,4);
});

test('sleeping parties cannot authorize or accept delivery even in a legacy sleep activity without a bed coordinate',()=>{
 const f=fixture(),{w,provider,adult,child,bucket}=f,g=gift(f);
 const sleep=(p:Resident)=>{p.activity={planId:'legacy-sleep',action:{type:'sleep',minutes:10},startedAt:w.minute,remaining:10,path:[],target:{...p.at},definition:w.activeDefinitions['action/routine']};};
 sleep(provider);assert.ok(completeWaterSupply(w,adult,action(w,adult,{operation:'authorizeAssist',targetId:provider.id})));assert.ok(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id})));provider.activity=null;sleep(child);
 assert.ok(completeWaterSupply(w,child,action(w,child,{operation:'acceptVessel',giftId:g.id})));assert.equal(bucket.ownerId,provider.id);assert.equal(bucket.amount,4);assert.equal(g.status,'offered');assert.deepEqual(w.waterSupply!.assistance,[]);
});
