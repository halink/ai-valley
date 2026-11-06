import {estateGoods,estateParcels,ownedEstateParcels} from '../src/world/estate-custody.js';
import {atWorkstation} from './helpers/workspaces.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Resident,World} from '../src/shared/types.js';
import type {EmploymentAction,EmploymentContract,EmploymentTerms} from '../src/shared/employment.js';
import {createWorld} from '../src/world/seed.js';
import {initializeEmployment,advanceEmployment,employmentReason,employmentTarget,completeEmployment,employmentWorkError,employmentConflict,employmentDeadline,hasEmploymentAssets} from '../src/world/employment.js';
import {employmentOpportunities,employmentNotes,parseEmploymentChoice} from '../src/server/employment-opportunities.js';
import {advanceEconomy,completeEconomy,accountBalance,moveCoins,totalCoins} from '../src/world/economy.js';
import {recordDeath} from '../src/world/life.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

const terms:EmploymentTerms={role:'cook',wage:6,startMinute:600,durationMinutes:60,days:2};
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 const [owner,worker,other]=w.residents;
 const home=w.buildings.find(b=>b.ownerId===owner.id)!;
 for(const p of w.residents){p.bornAt=w.minute-25*YEAR;p.at={...home.door};p.inside=null;p.coins=100;p.health=100;p.energy=100;p.hunger=10;p.knownBuildings.push(home.id);}
 initializeEmployment(w);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:home.id,name:'本人经营的食铺'}),null);
 const b=w.economy!.businesses[0];
 assert.ok(moveCoins(w,`resident:${owner.id}`,`business:${b.id}`,60,'测试既有资金投入','fixture-capital'));
 b.inventory={turnip:24,water:12};
 stepWorld(w,.001);
 return {w,owner,worker,other,home,b};
}
function act(w:World,r:Resident,action:Omit<EmploymentAction,'type'>){
 const a:EmploymentAction={type:'employment',...action};const target=employmentTarget(w,r,a);
 assert.equal(target.error,undefined);r.at={...target.target};
 assert.equal(completeEmployment(w,r,a),null);
}
function recruit(f:ReturnType<typeof fixture>,t=terms){
 const {w,owner,worker,b}=f;
 act(w,owner,{operation:'post',businessId:b.id,terms:t});
 const p=w.employment!.posts.at(-1)!;
 act(w,worker,{operation:'apply',postId:p.id});
 act(w,owner,{operation:'select',postId:p.id,applicantId:worker.id});
 act(w,worker,{operation:'accept',postId:p.id});
 return {p,c:w.employment!.contracts.at(-1)!};
}
function work(w:World,r:Resident,c:EmploymentContract,minutes:number){
 const action:EmploymentAction={type:'employment',operation:'work',contractId:c.id,minutes};atWorkstation(w,r,action);
 assert.ok(submitPlan(w,{id:`work-test:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人的明确工作安排',actions:[action]}).ok);
 stepWorld(w,minutes);assert.equal(r.lastFailure,null);
}

test('long-term recruitment needs an application, employer selection, prepaid salary and independent final acceptance',()=>{
 const f=fixture(),{w,owner,worker,other,b}=f;const money=totalCoins(w);
 act(w,owner,{operation:'post',businessId:b.id,terms});const p=w.employment!.posts[0];
 assert.equal(w.employment!.contracts.length,0);assert.equal(p.offer,null);
 act(w,worker,{operation:'apply',postId:p.id});act(w,other,{operation:'apply',postId:p.id});
 assert.equal(p.applications.length,2);assert.equal(w.employment!.contracts.length,0);
 assert.ok(employmentReason(w,worker,{type:'employment',operation:'select',postId:p.id,applicantId:other.id}));
 act(w,owner,{operation:'select',postId:p.id,applicantId:other.id});
 assert.equal(p.offer!.workerId,other.id);assert.equal(accountBalance(w,p.offer!.account),12);assert.equal(b.coins,48);
 assert.equal(w.employment!.contracts.length,0);assert.ok(employmentReason(w,worker,{type:'employment',operation:'accept',postId:p.id}));
 act(w,other,{operation:'accept',postId:p.id});
 assert.equal(w.employment!.contracts[0].workerId,other.id);assert.equal(w.employment!.contracts[0].startDay,Math.floor(w.minute/DAY)+1);
 assert.equal(totalCoins(w),money);assert.equal(worker.plan,null);assert.equal(other.plan,null);
});

test('an applicant can refuse selection and an insolvent employer cannot promise wages',()=>{
 const {w,owner,worker,b}=fixture();act(w,owner,{operation:'post',businessId:b.id,terms});const p=w.employment!.posts[0];
 act(w,worker,{operation:'apply',postId:p.id});
 const start=b.coins;b.coins=0;
 assert.ok(employmentReason(w,owner,{type:'employment',operation:'select',postId:p.id,applicantId:worker.id}));assert.equal(p.offer,null);
 b.coins=start;act(w,owner,{operation:'select',postId:p.id,applicantId:worker.id});act(w,worker,{operation:'decline',postId:p.id});
 assert.equal(b.coins,start);assert.equal(w.employment!.contracts.length,0);assert.equal(p.applications[0].status,'declined');
});

test('arrival and real materials produce goods and proportional salary; empty attendance cannot mint pay',()=>{
 const f=fixture(),{w,worker,b,home}=f,{c}=recruit(f);const before=worker.coins,money=totalCoins(w);
 w.minute=c.startDay*DAY+terms.startMinute;worker.at={...home.door};
 work(w,worker,c,30);
 assert.equal(c.attendance[0].worked,30);assert.equal(c.paid,3);assert.equal(worker.coins,before+3);
 assert.equal(b.inventory.meal,1);assert.equal(c.batch?.progress,10);assert.equal(b.inventory.turnip,20);assert.equal(totalCoins(w),money);
 work(w,worker,c,30);assert.equal(c.paid,6);assert.equal(b.inventory.meal,3);assert.equal(c.batch,null);
 assert.ok(employmentReason(w,worker,{type:'employment',operation:'work',contractId:c.id,minutes:1}));
 w.minute=(c.startDay+1)*DAY+terms.startMinute;b.inventory={};
 assert.ok(submitPlan(w,{id:'empty-store',actorId:worker.id,actorRevision:worker.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'去上班',actions:[{type:'employment',operation:'work',contractId:c.id,minutes:30}]}).ok);
 stepWorld(w,1);assert.match(worker.lastFailure!,/材料/);assert.equal(c.paid,6);assert.equal(totalCoins(w),money);
});

test('fractional working ticks are replay-safe and do not append a permanent receipt per simulation tick',()=>{
 const f=fixture(),{w,worker}=f,{c}=recruit(f);w.minute=c.startDay*DAY+terms.startMinute;
 const before=w.processed.length;
 worker.activity={planId:'fractional-work',action:{type:'employment',operation:'work',contractId:c.id,minutes:30},startedAt:w.minute,remaining:30,path:[],target:{...worker.at},definition:'action/routine@1'};
 for(let i=0;i<300;i++){
  w.minute+=.1;assert.equal(employmentWorkError(w,worker,worker.activity.action as EmploymentAction,.1),null);
  assert.equal(employmentWorkError(w,worker,worker.activity.action as EmploymentAction,.1),null);
 }
 assert.ok(Math.abs(c.attendance[0].worked-30)<1e-7);assert.equal(c.paid,3);
 assert.equal(w.processed.length-before,3,'only the three actual coin transfers need permanent receipts');
});

test('quitting keeps earned wages and returns future wages and unfinished physical ingredients',()=>{
 const f=fixture(),{w,worker,b}=f,{c}=recruit(f),money=totalCoins(w);
 w.minute=c.startDay*DAY+terms.startMinute;work(w,worker,c,10);assert.equal(c.paid,1);assert.equal(b.inventory.turnip,22);
 act(w,worker,{operation:'quit',contractId:c.id});
 assert.equal(c.status,'quit');assert.equal(c.refunded,11);assert.equal(b.coins,59);assert.equal(b.inventory.turnip,24);assert.equal(c.batch,null);
 advanceEmployment(w);assert.equal(b.coins,59);assert.equal(totalCoins(w),money);
});

test('business closure and employer death refund the actual owner or protected estate without stranded shop balances',()=>{
 const f=fixture(),{w,owner,worker,b}=f,{c}=recruit(f);w.minute=c.startDay*DAY+terms.startMinute;work(w,worker,c,10);
 const money=totalCoins(w);recordDeath(w,owner);assert.ok(hasEmploymentAssets(w,owner.id));
 advanceEconomy(w);advanceEmployment(w);
 const estate=w.estates.find(e=>e.personId===owner.id)!;
 assert.equal(c.status,'ended');assert.equal(b.coins,0);assert.equal(c.batch,null);
 assert.equal(estateGoods(w,owner.id).turnip,(owner.inventory.turnip??0)+24);assert.ok(estate.parcels?.some(p=>p.inventory.turnip===2&&p.location.inside===b.buildingId));assert.equal(totalCoins(w),money);
 assert.equal(hasEmploymentAssets(w,owner.id),false);
 const stored=estate.coins;advanceEmployment(w);assert.equal(estate.coins,stored);
});

test('worker death retains previously paid wages in their own estate and refunds unworked salary',()=>{
 const f=fixture(),{w,worker,b}=f,{c}=recruit(f);w.minute=c.startDay*DAY+terms.startMinute;const ownMoney=worker.coins;
 work(w,worker,c,10);recordDeath(w,worker);advanceEmployment(w);
 assert.equal(c.paid,1);assert.equal(w.estates.find(e=>e.personId===worker.id)!.coins,ownMoney+1);assert.equal(b.coins,59);
 assert.equal(c.status,'ended');
});

test('payroll and partially finished batches survive restart; each later shift still needs a new personal plan',()=>{
 const f=fixture(),{w,worker,b}=f,{c}=recruit(f);w.minute=c.startDay*DAY+terms.startMinute;work(w,worker,c,30);
 const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;store.close();
 const employee=saved.residents.find(r=>r.id===worker.id)!,contract=saved.employment!.contracts[0];
 saved.minute=(contract.startDay+1)*DAY+terms.startMinute;advanceEmployment(saved);
 assert.equal(employee.plan,null);assert.equal(employee.activity,null);assert.equal(contract.paid,3);
 work(saved,employee,contract,30);assert.equal(contract.paid,6);assert.equal(contract.attendance.length,2);
 assert.equal(saved.economy!.businesses.find(shop=>shop.id===b.id)!.inventory.meal,3);
 saved.minute=contract.endDay*DAY;advanceEmployment(saved);assert.equal(contract.status,'completed');assert.equal(contract.refunded,6);
});

test('public work and private work cannot overlap and recruitment is not visible from a distant shop',()=>{
 const f=fixture(),{w,worker,other,owner,home,b}=f,{c,p}=recruit(f);
 const start=c.startDay*DAY+terms.startMinute;
 assert.ok(employmentConflict(w,worker,start,start+20,home.id));
 assert.equal(employmentConflict(w,worker,start+60,start+80,home.id),null);
 other.at={x:home.door.x+20,y:home.door.y};
 act(w,owner,{operation:'post',businessId:b.id,terms:{...terms,role:'seedkeeper',startMinute:720}});
 assert.ok(!employmentOpportunities(w,other).some(o=>o.action.type==='employment'&&o.action.operation==='apply'));
 assert.equal(p.status,'filled');
});

test('an applicant learns selection only at the known shop and can choose a return visit without knowing the result',()=>{
 const {w,owner,worker,b,home}=fixture();act(w,owner,{operation:'post',businessId:b.id,terms});const p=w.employment!.posts[0];
 act(w,worker,{operation:'apply',postId:p.id});worker.at={x:home.door.x+20,y:home.door.y};
 act(w,owner,{operation:'select',postId:p.id,applicantId:worker.id});
 assert.ok(!employmentNotes(w,worker).includes('录用邀请'));assert.equal(employmentDeadline(w,worker.id),Infinity);
 let menu=employmentOpportunities(w,worker);
 assert.ok(!menu.some(c=>c.action.type==='employment'&&['accept','decline'].includes(c.action.operation)));
 assert.ok(menu.some(c=>c.label.includes('查看招聘回复')));
 worker.at={...home.door};advanceEmployment(w);menu=employmentOpportunities(w,worker);
 assert.ok(menu.some(c=>c.action.type==='employment'&&c.action.operation==='accept'));assert.ok(menu.some(c=>c.action.type==='employment'&&c.action.operation==='decline'));
 assert.equal(employmentDeadline(w,worker.id),p.offer!.expiresAt);
});

test('renewal uses new independently accepted terms and never silently extends or changes the old contract',()=>{
 const f=fixture(),{w,owner,worker}=f,{c}=recruit(f);const original={...c.terms};
 const changed=parseEmploymentChoice({type:'employment',operation:'renew',contractId:c.id,terms:{...c.terms}},{wage:9,days:3,startMinute:720,durationMinutes:90});
 act(w,owner,changed);const p=w.employment!.posts.at(-1)!;
 assert.deepEqual(c.terms,original);assert.equal(p.terms.wage,9);assert.equal(w.employment!.contracts.length,1);
 act(w,worker,{operation:'apply',postId:p.id});act(w,owner,{operation:'select',postId:p.id,applicantId:worker.id});act(w,worker,{operation:'accept',postId:p.id});
 const renewed=w.employment!.contracts.at(-1)!;assert.equal(renewed.startDay,c.endDay);assert.equal(renewed.terms.wage,9);assert.deepEqual(c.terms,original);
 assert.throws(()=>parseEmploymentChoice(changed,{wage:-1}));assert.throws(()=>parseEmploymentChoice(changed,{startMinute:1200,durationMinutes:240}));
});

test('seed processing is productive paid labour and public shifts already promised block overlapping acceptance',()=>{
 const f=fixture(),{w,worker,b,home}=f;
 const {c}=recruit(f,{...terms,role:'seedkeeper'});
 w.minute=c.startDay*DAY+terms.startMinute;work(w,worker,c,30);
 assert.equal(b.inventory.seed,4);assert.equal(b.inventory.turnip,22);assert.equal(c.paid,3);
 const second=fixture();
 act(second.w,second.owner,{operation:'post',businessId:second.b.id,terms});const p=second.w.employment!.posts[0];
 act(second.w,second.worker,{operation:'apply',postId:p.id});
 const start=(Math.floor(second.w.minute/DAY)+1)*DAY+600;
 second.w.duties={publishedThroughDay:3,shifts:[{id:'already-promised',buildingId:home.id,role:'kitchen',start,end:start+90,workerId:second.worker.id,status:'booked',assignments:[],declinedBy:[],served:0,clientId:null}]};
 act(second.w,second.owner,{operation:'select',postId:p.id,applicantId:second.worker.id});
 assert.match(employmentReason(second.w,second.worker,{type:'employment',operation:'accept',postId:p.id})!,/公共班次/);
 assert.equal(second.w.employment!.contracts.length,0);
});

test('an unanswered expiring offer returns its prepayment without inventing a refusal',()=>{
 const {w,owner,worker,b}=fixture();act(w,owner,{operation:'post',businessId:b.id,terms});const p=w.employment!.posts[0];
 act(w,worker,{operation:'apply',postId:p.id});const cash=b.coins;
 act(w,owner,{operation:'select',postId:p.id,applicantId:worker.id});w.minute=p.offer!.expiresAt;
 advanceEmployment(w);assert.equal(b.coins,cash);assert.equal(p.applications[0].status,'expired');assert.equal(w.employment!.contracts.length,0);
});
test('each industrial employment role requires its actual station and turns only prepaid shop inputs into the signed output',async()=>{
 const {recipes}=await import('../src/world/industry-content.js');
 const roles={carpenter:'plank',smith:'bar',miller:'bread',dairyworker:'cheese',weaver:'cloth',preserver:'preserve',herbalist:'medicine'} as const;
 for(const [role,id]of Object.entries(roles)){
  const f=fixture(),{w,owner,worker,b,home}=f,recipe=recipes.find(r=>r.id===id)!;home.kind='workshop';worker.skills={farming:2,building:2,care:2};b.inventory={...recipe.input};
  const t:EmploymentTerms={...terms,role:role as keyof typeof roles,durationMinutes:120};
  if(recipe.station){assert.ok(employmentReason(w,owner,{type:'employment',operation:'post',businessId:b.id,terms:t}));w.industry!.stations.push({id:'fixture-signed-machine',buildingId:home.id,kind:recipe.station,installedAt:w.minute});}
  const {c}=recruit(f,t);assert.deepEqual(c.recipe,recipe);const money=totalCoins(w);w.minute=c.startDay*DAY+t.startMinute;work(w,worker,c,recipe.minutes);assert.deepEqual(Object.fromEntries(Object.entries(b.inventory).filter(([,n])=>n!>0)),recipe.output);assert.equal(c.attendance[0].worked,recipe.minutes);assert.equal(c.paid,Math.floor(t.wage*recipe.minutes/t.durationMinutes));assert.equal(totalCoins(w),money);
 }
});
test('an industrial employer may hire a qualified worker but cannot count an unqualified person or missing machinery as production',async()=>{
 const f=fixture(),{w,owner,worker,b,home}=f;home.kind='workshop';owner.skills.building=0;worker.skills.building=0;w.industry!.stations.push({id:'actual-forge',buildingId:home.id,kind:'forge',installedAt:w.minute});act(w,owner,{operation:'post',businessId:b.id,terms:{...terms,role:'smith'}});const p=w.employment!.posts.at(-1)!;assert.ok(employmentReason(w,worker,{type:'employment',operation:'apply',postId:p.id}));worker.skills.building=1;act(w,worker,{operation:'apply',postId:p.id});act(w,owner,{operation:'select',postId:p.id,applicantId:worker.id});act(w,worker,{operation:'accept',postId:p.id});const c=w.employment!.contracts.at(-1)!;w.minute=c.startDay*DAY+terms.startMinute;w.industry!.stations=[];assert.ok(employmentReason(w,worker,{type:'employment',operation:'work',contractId:c.id,minutes:30}));assert.equal(c.attendance.length,0);assert.equal(c.paid,0);
});
