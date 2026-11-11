import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {BusinessRelocationAction} from '../src/shared/business-relocation.js';
import type {EmploymentAction,EmploymentTerms} from '../src/shared/employment.js';
import {businessRelocationReason,completeBusinessRelocation,advanceBusinessRelocations} from '../src/world/business-relocation.js';
import {completeEconomy,economyReason,moveCoins,totalCoins} from '../src/world/economy.js';
import {initializeEmployment,employmentTarget,completeEmployment,employmentReason} from '../src/world/employment.js';
import {businessRelocationOpportunities} from '../src/server/business-relocation-opportunities.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';

const terms:EmploymentTerms={role:'seedkeeper',wage:6,startMinute:600,durationMinutes:60,days:3};
function fixture(hire=true){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 const [owner,worker,other]=w.residents,old=w.buildings.find(b=>b.ownerId===owner.id)!;
 const dest={...structuredClone(w.buildings.find(b=>b.id==='workshop')!),id:'relocation-destination',ownerId:owner.id,residents:[]};
 w.buildings=w.buildings.filter(b=>b.id!=='workshop');w.buildings.push(dest);
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...old.door};r.inside=null;r.roomAt=null;r.coins=100;r.hunger=0;r.energy=100;r.health=100;r.knownBuildings.push(dest.id);}
 initializeEmployment(w);assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:old.id}),null);
 const b=w.economy!.businesses[0];assert.ok(moveCoins(w,`resident:${owner.id}`,`business:${b.id}`,60,'test capital','relocation-capital'));
 const employment=(r:Resident,a:Omit<EmploymentAction,'type'>)=>{const action:EmploymentAction={type:'employment',...a};const t=employmentTarget(w,r,action);assert.equal(t.error,undefined);r.at={...t.target};assert.equal(completeEmployment(w,r,action),null);};
 if(hire){employment(owner,{operation:'post',businessId:b.id,terms});const p=w.employment!.posts[0];employment(worker,{operation:'apply',postId:p.id});employment(owner,{operation:'select',postId:p.id,applicantId:worker.id});employment(worker,{operation:'accept',postId:p.id});}
 stepWorld(w,.001);
 const c=w.employment!.contracts[0];
 const propose=()=>{owner.at={...old.door};assert.equal(completeBusinessRelocation(w,owner,{type:'businessRelocation',operation:'propose',businessId:b.id,fromBuildingId:old.id,toBuildingId:dest.id}),null);return w.economy!.relocations!.at(-1)!;};
 return {w,owner,worker,other,old,dest,b,c,employment,propose};
}
function action(operation:BusinessRelocationAction['operation'],relocationId:string,contractId?:string):BusinessRelocationAction{return {type:'businessRelocation',operation,relocationId,...(contractId?{contractId}:{})};}
function consent(f:ReturnType<typeof fixture>,id:string){f.worker.at={...f.old.door};assert.equal(completeBusinessRelocation(f.w,f.worker,action('review',id,f.c.id)),null);f.worker.at={...f.dest.door};assert.equal(completeBusinessRelocation(f.w,f.worker,action('accept',id,f.c.id)),null);}
function run(w:World,r:Resident,a:Action){assert.equal(submitPlan(w,{id:`relocation-test:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'亲自处理迁址',actions:[a]}).ok,true);for(let i=0;i<300&&(r.plan||r.activity);i++)stepWorld(w,1);assert.equal(r.lastFailure,null);assert.equal(r.plan,null);}

test('proposal freezes new commitments while existing orders and employment retain their original site',()=>{
 const f=fixture(),{w,owner,worker,b,c}=f;b.inventory={turnip:4};
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'list',businessId:b.id,item:'turnip',quantity:2,price:2}),null);
 const l=w.economy!.listings[0],m=f.propose();
 for(const operation of ['stock','list','order'] as const)assert.match(economyReason(w,owner,{type:'economy',operation,businessId:b.id,item:'turnip',quantity:1,price:1,maximumLevyBasisPoints:0})!,/迁址/);
 assert.match(employmentReason(w,owner,{type:'employment',operation:'post',businessId:b.id,terms})!,/迁址/);
 assert.equal(c.buildingId,f.old.id);assert.equal(b.buildingId,f.old.id);
 assert.equal(economyReason(w,worker,{type:'economy',operation:'buy',listingId:l.id,businessId:b.id,quantity:1,maxTotal:2}),null);
 assert.match(businessRelocationReason(w,owner,action('begin',m.id))!,/报价/);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'cancel',businessId:b.id,listingId:l.id}),null);
 assert.match(businessRelocationReason(w,owner,action('begin',m.id))!,/员工/);
});

test('worker must review old site and independently consent at the exact new door',()=>{
 const f=fixture(),m=f.propose(),{w,worker,other,c}=f;
 worker.knownBuildings=worker.knownBuildings.filter(id=>id!==f.dest.id);
 assert.ok(businessRelocationReason(w,worker,action('accept',m.id,c.id)));
 assert.ok(completeBusinessRelocation(w,other,action('review',m.id,c.id)));
 assert.equal(completeBusinessRelocation(w,worker,action('review',m.id,c.id)),null);assert.ok(worker.knownBuildings.includes(f.dest.id));
 assert.ok(completeBusinessRelocation(w,worker,action('accept',m.id,c.id)));
 worker.at={x:f.dest.door.x+1,y:f.dest.door.y};assert.ok(completeBusinessRelocation(w,worker,action('accept',m.id,c.id)));
 worker.at={...f.dest.door};assert.equal(completeBusinessRelocation(w,worker,action('accept',m.id,c.id)),null);
 assert.equal(c.buildingId,f.old.id);assert.deepEqual(c.terms,terms);
});

test('stale original terms and destination ownership invalidate previously accepted consent',()=>{
 for(const change of ['terms','owner'] as const){const f=fixture(),m=f.propose();consent(f,m.id);
 if(change==='terms')f.c.terms.wage++;else f.dest.ownerId=f.other.id;
 assert.ok(businessRelocationReason(f.w,f.owner,action('begin',m.id)));assert.equal(m.status,'preparing');assert.equal(f.c.buildingId,f.old.id);}
});

test('pending work or physical batch blocks begin; revocation ends moving without undoing carried goods',()=>{
 const f=fixture(),m=f.propose();consent(f,m.id);f.c.batch={inventory:{turnip:1},progress:5,minutes:15,output:{seed:2}};
 assert.match(businessRelocationReason(f.w,f.owner,action('begin',m.id))!,/原料/);f.c.batch=null;
 f.worker.activity={planId:'work-pending',action:{type:'employment',operation:'work',contractId:f.c.id,minutes:15},startedAt:f.w.minute,remaining:15,path:[],target:{...f.old.door},definition:'action/routine@1'};
 assert.match(businessRelocationReason(f.w,f.owner,action('begin',m.id))!,/行动/);f.worker.activity=null;
 assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);
 assert.match(employmentReason(f.w,f.worker,{type:'employment',operation:'work',contractId:f.c.id,minutes:15})!,/暂停/);
 const inv=structuredClone(f.owner.inventory);assert.equal(completeBusinessRelocation(f.w,f.worker,action('revoke',m.id,f.c.id)),null);assert.equal(m.status,'preparing');assert.deepEqual(f.owner.inventory,inv);assert.equal(f.c.buildingId,f.old.id);
});

test('real engine retrieval and walking change only the business and consented contract location',()=>{
 const f=fixture(),{w,owner,worker,b,c,old,dest}=f;b.inventory={wood:3};const m=f.propose();consent(f,m.id);
 worker.at={...old.door};
 const contract=structuredClone(c),workerAt={...worker.at},money=totalCoins(w),deed=dest.ownerId;
 assert.equal(completeBusinessRelocation(w,owner,action('begin',m.id)),null);
 assert.ok(completeBusinessRelocation(w,owner,action('finish',m.id)));
 run(w,owner,{type:'economy',operation:'retrieve',businessId:b.id,item:'wood',quantity:3});assert.equal(b.inventory.wood??0,0);assert.deepEqual(owner.at,old.door);
 assert.ok(completeBusinessRelocation(w,owner,action('finish',m.id)));
 run(w,owner,action('finish',m.id));assert.deepEqual(owner.at,dest.door);assert.equal(m.status,'completed');assert.equal(b.buildingId,dest.id);assert.equal(c.buildingId,dest.id);
 assert.deepEqual({...c,buildingId:old.id},contract);assert.deepEqual(worker.at,workerAt);assert.equal(dest.ownerId,deed);assert.equal(totalCoins(w),money);assert.equal(b.inventory.wood??0,0);
 run(w,owner,{type:'economy',operation:'stock',businessId:b.id,item:'wood',quantity:3});assert.equal(b.inventory.wood,3);
});

test('a second business cannot reserve an already reserved destination',()=>{
 const f=fixture(false);const m=f.propose();const second={...structuredClone(f.old),id:'second-site',kind:'store' as const,residents:[]};f.w.buildings.push(second);f.owner.knownBuildings.push(second.id);
 f.w.economy!.businesses.push({...structuredClone(f.b),id:'second-business',buildingId:second.id});f.owner.at={...second.door};
 assert.match(businessRelocationReason(f.w,f.owner,{type:'businessRelocation',operation:'propose',businessId:'second-business',fromBuildingId:second.id,toBuildingId:f.dest.id})!,/另一份/);assert.equal(m.status,'preparing');
});

test('completion replay survives SQLite reload and cannot replace the decision with altered terms',()=>{
 const f=fixture(false),m=f.propose();f.owner.plan={id:'durable-relocation',actorId:f.owner.id,actorRevision:f.owner.revision,createdAt:f.w.minute,definition:'action/routine@1',intention:'搬迁',actions:[]};
 const a=action('begin',m.id);assert.equal(completeBusinessRelocation(f.w,f.owner,a),null);const rev=f.w.revision;assert.equal(completeBusinessRelocation(f.w,f.owner,a),null);assert.equal(f.w.revision,rev);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const saved=store.load()!,owner=saved.residents.find(r=>r.id===f.owner.id)!;
 assert.equal(completeBusinessRelocation(saved,owner,a),null);assert.equal(saved.revision,rev);assert.match(completeBusinessRelocation(saved,owner,action('cancel',m.id))!,/重放/);assert.equal(saved.economy!.relocations![0].status,'moving');}finally{store.close();}
});

test('cancellation, expiry and owner death preserve contract identity and physical inventory',()=>{
 for(const mode of ['cancel','expire','death'] as const){const f=fixture(),m=f.propose(),snapshot=structuredClone(f.c),inventory=structuredClone(f.b.inventory),money=totalCoins(f.w);
 if(mode==='cancel')assert.equal(completeBusinessRelocation(f.w,f.owner,action('cancel',m.id)),null);else{if(mode==='expire')f.w.minute=m.expiresAt;else f.owner.status='dead';advanceBusinessRelocations(f.w);}
 assert.equal(m.status,'cancelled');assert.deepEqual(f.c,snapshot);assert.deepEqual(f.b.inventory,inventory);assert.equal(totalCoins(f.w),money);advanceBusinessRelocations(f.w);assert.equal(m.status,'cancelled');}
});

test('final model menu exposes relocation actions and parser rejects destination substitution',()=>{
 const f=fixture();const choices=decisionChoices(decisionContext(f.w,f.owner)),propose=choices.find(c=>c.action.type==='businessRelocation'&&c.action.operation==='propose');assert.ok(propose);
 const parsed=parseChoice(JSON.stringify({choice:propose.id}),choices);assert.deepEqual(parsed.actions[0],propose.action);
 assert.throws(()=>parseChoice(JSON.stringify({choice:propose.id,toBuildingId:f.old.id}),choices),/unexpected_choice_field/);
 const m=f.propose();assert.ok(businessRelocationOpportunities(f.w,f.worker).some(c=>c.action.type==='businessRelocation'&&c.action.operation==='review'));
 consent(f,m.id);const offers=businessRelocationOpportunities(f.w,f.worker);assert.ok(offers.some(c=>c.action.type==='businessRelocation'&&c.action.operation==='revoke'));
});

test('mismatched business selectors cannot bypass a bound employment relocation freeze',()=>{
 const f=fixture(),m=f.propose();consent(f,m.id);assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);
 for(const operation of ['work','renew'] as const){const actor=operation==='work'?f.worker:f.owner;
 assert.ok(employmentReason(f.w,actor,{type:'employment',operation,contractId:f.c.id,businessId:'not-this-business',terms,minutes:15}));}
 assert.ok(employmentReason(f.w,f.worker,{type:'employment',operation:'accept',postId:f.c.postId,businessId:'not-this-business'}));
 assert.ok(employmentReason(f.w,f.worker,{type:'employment',operation:'work',contractId:f.c.id,postId:f.c.postId,minutes:15}));
 assert.equal(f.c.buildingId,f.old.id);assert.equal(f.c.paid,0);
});

test('finish revalidates late employee terms, consent and destination rights without partial relocation',()=>{
 for(const change of ['terms','rights','consent'] as const){const f=fixture(),m=f.propose();consent(f,m.id);assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);
 if(change==='terms')f.c.endDay++;else if(change==='rights')f.dest.condition=0;else m.employees[0].acceptedAt=null;
 f.owner.at={...f.dest.door};assert.ok(completeBusinessRelocation(f.w,f.owner,action('finish',m.id)));assert.equal(f.b.buildingId,f.old.id);assert.equal(f.c.buildingId,f.old.id);assert.deepEqual(m.transferredContractIds,[]);}
});

test('food carried through real relocation retains original production and expiry dates',async()=>{
 const {initializeFood}=await import('../src/world/food.js');const f=fixture(false);f.b.inventory={meal:2};initializeFood(f.w);
 const lot=structuredClone(f.w.food!.lots['business:'+f.b.id].meal![0]),m=f.propose();assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);
 run(f.w,f.owner,{type:'economy',operation:'retrieve',businessId:f.b.id,item:'meal',quantity:2});assert.deepEqual(f.w.food!.lots['person:'+f.owner.id].meal![0],lot);
 run(f.w,f.owner,action('finish',m.id));run(f.w,f.owner,{type:'economy',operation:'stock',businessId:f.b.id,item:'meal',quantity:2});
 assert.deepEqual(f.w.food!.lots['business:'+f.b.id].meal![0],lot);assert.equal(f.b.inventory.meal,2);
});

test('leased destination keeps its deed, rent, deposit and escrow unchanged through registration',async()=>{
 const {completePremises}=await import('../src/world/premises.js');const f=fixture(false),{w,owner,other,dest}=f;dest.ownerId=other.id;other.at={...dest.door};owner.at={...dest.door};
 assert.equal(completePremises(w,other,{type:'premises',operation:'offer',buildingId:dest.id,tenantId:owner.id,terms:{days:4,rentPerDay:2,deposit:3,station:'table',startMinute:540,durationMinutes:360}}),null);
 const lease=w.economy!.leases!.at(-1)!;assert.equal(completePremises(w,owner,{type:'premises',operation:'accept',leaseId:lease.id}),null);
 const snapshot=structuredClone(lease),money=totalCoins(w),coins=owner.coins,capital=f.b.coins,m=f.propose();assert.equal(m.destinationLeaseId,lease.id);
 assert.equal(completeBusinessRelocation(w,owner,action('begin',m.id)),null);owner.at={...dest.door};assert.equal(completeBusinessRelocation(w,owner,action('finish',m.id)),null);
 assert.deepEqual(lease,snapshot);assert.equal(dest.ownerId,other.id);assert.equal(owner.coins,coins);assert.equal(f.b.coins,capital);assert.equal(totalCoins(w),money);
});

test('earned wages and attendance survive relocation without extending the original contract',async()=>{
 const {atWorkstation}=await import('./helpers/workspaces.js');const f=fixture(),{w,worker,c,b}=f;w.minute=c.startDay*DAY+terms.startMinute;b.inventory={turnip:1};
 const work:EmploymentAction={type:'employment',operation:'work',contractId:c.id,minutes:15};atWorkstation(w,worker,work);run(w,worker,work);assert.ok(c.paid>0);assert.equal(c.batch,null);
 const snapshot=structuredClone(c),earned=worker.coins,m=f.propose();worker.inside=null;worker.roomAt=null;consent(f,m.id);assert.equal(completeBusinessRelocation(w,f.owner,action('begin',m.id)),null);
 run(w,f.owner,{type:'economy',operation:'retrieve',businessId:b.id,item:'seed',quantity:2});run(w,f.owner,action('finish',m.id));
 assert.deepEqual({...c,buildingId:f.old.id},snapshot);assert.equal(worker.coins,earned);assert.equal(c.endDay,snapshot.endDay);
});

test('a worker who dies during moving is never silently transferred under prior consent',()=>{
 const f=fixture(),m=f.propose();consent(f,m.id);assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);f.worker.status='dead';f.owner.at={...f.dest.door};
 assert.ok(completeBusinessRelocation(f.w,f.owner,action('finish',m.id)));assert.equal(f.c.buildingId,f.old.id);assert.equal(f.b.buildingId,f.old.id);assert.deepEqual(m.transferredContractIds,[]);
});

test('an expired or replaced destination lease invalidates the original proposal',async()=>{
 const {completePremises}=await import('../src/world/premises.js');
 for(const change of ['expiry','replacement'] as const){const f=fixture(false),{w,owner,other,dest}=f;dest.ownerId=other.id;other.at={...dest.door};owner.at={...dest.door};
 assert.equal(completePremises(w,other,{type:'premises',operation:'offer',buildingId:dest.id,tenantId:owner.id,terms:{days:4,rentPerDay:1,deposit:0,station:'table',startMinute:540,durationMinutes:360}}),null);
 const l=w.economy!.leases!.at(-1)!;assert.equal(completePremises(w,owner,{type:'premises',operation:'accept',leaseId:l.id}),null);const m=f.propose();assert.equal(completeBusinessRelocation(w,owner,action('begin',m.id)),null);
 if(change==='expiry')l.endsAt=w.minute;else l.id+='-replacement';owner.at={...dest.door};assert.ok(completeBusinessRelocation(w,owner,action('finish',m.id)));assert.equal(f.b.buildingId,f.old.id);}
});

test('stale site-bound work fails after finish instead of using old authorization at the new site',()=>{
 const f=fixture(),m=f.propose(),stale:EmploymentAction={type:'employment',operation:'work',contractId:f.c.id,buildingId:f.old.id,minutes:15};consent(f,m.id);assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);f.owner.at={...f.dest.door};assert.equal(completeBusinessRelocation(f.w,f.owner,action('finish',m.id)),null);
 assert.match(employmentReason(f.w,f.worker,stale)!,/地点已改变/);assert.equal(f.c.paid,0);assert.deepEqual(f.c.attendance,[]);
});

test('observer relocation panel is escaped, read-only and explains independent consent and unpaid pause',async()=>{
 const {businessRelocationPanel}=await import('../src/client/business-relocation.js');const f=fixture(),m=f.propose();f.b.name='<script>alert(1)</script>';f.worker.name='<img src=x onerror=alert(1)>';const snapshot=JSON.stringify(f.w);
 const html=businessRelocationPanel(f.w);assert.equal(JSON.stringify(f.w),snapshot);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/未工作不计薪/);assert.match(html,/原聘期不延长/);assert.match(html,/尚未在旧址阅读/);
 consent(f,m.id);assert.match(businessRelocationPanel(f.w),/已在新址独立同意/);assert.ok(!html.includes('<button'));
});

test('old prepaid purchase orders still settle at source while preparing and refund only their unspent remainder',async()=>{
 const {accountBalance}=await import('../src/world/economy.js');const f=fixture(),{w,owner,other,b}=f;
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'order',businessId:b.id,item:'wood',quantity:4,price:2,maximumLevyBasisPoints:0}),null);
 const l=w.economy!.listings.at(-1)!,m=f.propose(),money=totalCoins(w),capital=b.coins;other.inventory.wood=4;
 assert.equal(completeEconomy(w,other,{type:'economy',operation:'fulfill',listingId:l.id,buildingId:f.old.id,item:'wood',quantity:2,minTotal:4}),null);
 assert.equal(b.inventory.wood,2);assert.equal(l.quantity,2);assert.equal(accountBalance(w,l.escrowId!),4);assert.equal(w.economy!.trades!.at(-1)!.buildingId,f.old.id);assert.equal(b.coins,capital);
 assert.match(businessRelocationReason(w,owner,action('begin',m.id))!,/报价/);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'cancel',listingId:l.id}),null);assert.equal(accountBalance(w,l.escrowId!),0);assert.equal(b.coins,capital+4);assert.equal(totalCoins(w),money);
});

test('pending recruitment refunds its original wage reserve before moving',()=>{
 const f=fixture(false),{w,owner,worker,b}=f;f.employment(owner,{operation:'post',businessId:b.id,terms});const p=w.employment!.posts[0];
 f.employment(worker,{operation:'apply',postId:p.id});f.employment(owner,{operation:'select',postId:p.id,applicantId:worker.id});const m=f.propose(),capital=b.coins;
 assert.ok(employmentReason(w,worker,{type:'employment',operation:'accept',postId:p.id}));assert.match(businessRelocationReason(w,owner,action('begin',m.id))!,/招聘/);
 f.employment(owner,{operation:'cancelPost',postId:p.id});assert.equal(p.offer,null);assert.equal(b.coins,capital+terms.wage*terms.days);assert.equal(completeBusinessRelocation(w,owner,action('begin',m.id)),null);
});

test('a still-signed worker actually earns wages and produces at the old site during preparation',async()=>{
 const {atWorkstation}=await import('./helpers/workspaces.js');const f=fixture(),m=f.propose(),{w,worker,c,b}=f;w.minute=c.startDay*DAY+terms.startMinute;b.inventory={turnip:1};
 const work:EmploymentAction={type:'employment',operation:'work',contractId:c.id,buildingId:f.old.id,minutes:15};atWorkstation(w,worker,work);run(w,worker,work);
 assert.ok(c.paid>0);assert.equal(b.inventory.seed,2);assert.equal(c.buildingId,f.old.id);assert.equal(b.buildingId,f.old.id);assert.equal(m.status,'preparing');
});

test('food that expires on the real walk cannot be refreshed or restocked by relocation',async()=>{
 const {initializeFood}=await import('../src/world/food.js');const f=fixture(false);f.owner.inventory={};f.b.inventory={meal:2};initializeFood(f.w);
 f.w.food!.lots['business:'+f.b.id].meal![0].expiresAt=f.w.minute+8;
 const m=f.propose();assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);
 run(f.w,f.owner,{type:'economy',operation:'retrieve',businessId:f.b.id,item:'meal',quantity:2});assert.equal(f.owner.inventory.meal,2);
 run(f.w,f.owner,action('finish',m.id));assert.equal(f.owner.inventory.meal??0,0);assert.equal(f.b.inventory.meal??0,0);assert.equal(f.w.food!.spoiled.meal,2);
 assert.ok(economyReason(f.w,f.owner,{type:'economy',operation:'stock',businessId:f.b.id,item:'meal',quantity:2}));
});

test('mid-move SQLite reload preserves carried stock and original consent before final registration',()=>{
 const f=fixture(),m=f.propose();f.b.inventory={wood:3};consent(f,m.id);assert.equal(completeBusinessRelocation(f.w,f.owner,action('begin',m.id)),null);
 run(f.w,f.owner,{type:'economy',operation:'retrieve',businessId:f.b.id,item:'wood',quantity:3});const carried=f.owner.inventory.wood,money=totalCoins(f.w),contract=structuredClone(f.c),store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,owner=w.residents.find(r=>r.id===f.owner.id)!,b=w.economy!.businesses.find(b=>b.id===f.b.id)!;
 assert.equal(owner.inventory.wood,carried);assert.equal(b.inventory.wood??0,0);assert.equal(b.buildingId,f.old.id);run(w,owner,action('finish',m.id));
 assert.equal(owner.inventory.wood,carried);assert.equal(b.inventory.wood??0,0);assert.equal(b.buildingId,f.dest.id);assert.deepEqual({...w.employment!.contracts[0],buildingId:f.old.id},contract);assert.equal(totalCoins(w),money);
 }finally{store.close();}
});

test('bounded record retention keeps old active moves and durable replay still protects pruned terminal moves',()=>{
 const f=fixture(false),m=f.propose(),original=m.id,begin=action('begin',original);f.owner.plan={id:'retained-action',actorId:f.owner.id,actorRevision:f.owner.revision,createdAt:f.w.minute,definition:'action/routine@1',intention:'开始搬迁',actions:[]};
 assert.equal(completeBusinessRelocation(f.w,f.owner,begin),null);
 const oldActive={...structuredClone(m),id:'old-active'};m.status='cancelled';m.endedAt=f.w.minute;
 f.w.economy!.relocations=[m,oldActive,...Array.from({length:240},(_,i)=>({...structuredClone(m),id:'history-'+i}))];
 advanceBusinessRelocations(f.w);assert.ok(f.w.economy!.relocations.some(x=>x.id==='old-active'));assert.ok(!f.w.economy!.relocations.some(x=>x.id===original));assert.equal(f.w.economy!.relocations.length,121);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,owner=w.residents.find(r=>r.id===f.owner.id)!;const snapshot=JSON.stringify(w.economy);
 assert.equal(completeBusinessRelocation(w,owner,begin),null);assert.equal(JSON.stringify(w.economy),snapshot);assert.match(completeBusinessRelocation(w,owner,action('finish',original))!,/重放/);
 }finally{store.close();}
});

test('full-engine death while moving refunds payroll and preserves source and carried estate stock separately',async()=>{
 const {recordDeath}=await import('../src/world/life.js');const {accountBalance}=await import('../src/world/economy.js');
 const f=fixture(),{w,owner,b,c}=f;b.inventory={wood:5};const m=f.propose();consent(f,m.id);assert.equal(completeBusinessRelocation(w,owner,action('begin',m.id)),null);
 run(w,owner,{type:'economy',operation:'retrieve',businessId:b.id,item:'wood',quantity:2});run(w,owner,{type:'move',to:f.dest.door});const personal=structuredClone(owner.inventory),money=totalCoins(w);
 recordDeath(w,owner);stepWorld(w,1);const estate=w.estates.find(e=>e.personId===owner.id)!;
 assert.equal(m.status,'cancelled');assert.equal(c.status,'ended');assert.equal(c.refunded,c.reserved-c.paid);assert.equal(accountBalance(w,c.account),0);assert.equal(b.closedAt!==null,true);assert.equal(b.inventory.wood??0,0);assert.equal(b.buildingId,f.old.id);
 assert.equal(estate.inventory.wood,personal.wood);assert.deepEqual(estate.location!.at,f.dest.door);assert.ok(estate.parcels?.some(p=>p.inventory.wood===3&&p.location.at.x===f.old.door.x&&p.location.at.y===f.old.door.y));assert.equal(totalCoins(w),money);
 const protectedCoins=estate.coins;stepWorld(w,1);assert.equal(estate.coins,protectedCoins);assert.equal(totalCoins(w),money);
});
