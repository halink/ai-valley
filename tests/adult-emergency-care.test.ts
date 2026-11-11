import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Plan,Resident,Tile,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {careAuthority,executeSocialAction} from '../src/world/social.js';
import {advanceLife} from '../src/world/life.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(419);w.mode='formal';w.clock.paused=false;
 w.map={name:'成人紧急基础照护隔离世界',width:24,height:18,tiles:Array<Tile>(432).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents)Object.assign(r,{at:{x:11,y:8},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,lifeStage:'adult',status:'alive',residency:'resident',health:100,energy:100,hunger:0,canDecide:true,canExpress:true,refusesCare:false,inventory:{water:9,meal:10},skills:{farming:1,building:1,care:2},knownBuildings:[],knownResources:[],guardianIds:[],plan:null,activity:null,lastFailure:null,decisionDue:w.minute});
 const [helper,patient,formerGuardian]=w.residents;
 patient.health=19;patient.hunger=60;patient.canDecide=false;patient.canExpress=false;patient.guardianIds=[formerGuardian.id];
 for(const r of w.residents)r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);
 return {w,helper,patient,formerGuardian};
}
let serial=0;
const plan=(w:World,r:Resident,actions:Action[]):Plan=>({id:'adult-emergency-care:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'实际到场的一次基础照护',actions});
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
function choose(w:World,r:Resident,predicate:(a:Action)=>boolean){const choices=menu(w,r),choice=choices.find(c=>predicate(c.action));assert.ok(choice,'the final resident menu must offer the actual authorized action');return parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0];}
const isCare=(id:string)=>(a:Action)=>a.type==='care'&&a.targetId===id;
const careFacts=(w:World)=>w.events.filter(e=>e.kind==='care'&&e.audit?.scope.includes('basic-care'));
function finish(w:World,r:Resident){let limit=300;while(r.activity||r.plan){assert.ok(limit-->0,'actual work must finish');stepWorld(w,.25);}assert.equal(r.lastFailure,null);}
function run(w:World,r:Resident,a:Action){const result=submitPlan(w,plan(w,r,[a]));assert.equal(result.ok,true,result.error);finish(w,r);}
function reload(w:World):World{const store=new WorldStore(':memory:');try{store.commit(w,null);return store.load()!;}finally{store.close();}}

test('adult emergency care: real final menu executes one episode despite a present childhood guardian',()=>{
 for(const formerIsHelper of [false,true]){
  const {w,helper,patient,formerGuardian}=fixture(),actor=formerIsHelper?formerGuardian:helper;
  const authority=careAuthority(w,actor,patient);assert.equal(authority.basis,'emergency');
  const action=choose(w,actor,isCare(patient.id));assert.equal(action.type,'care');assert.equal('proposalId'in action,false);
  const before={stock:{...actor.inventory},patientStock:{...patient.inventory},coins:patient.coins,guardians:[...patient.guardianIds],parents:[...patient.parents]};
  assert.equal(planStartError(w,plan(w,actor,[action])),null);
  run(w,actor,action);
  assert.equal(actor.inventory.meal,before.stock.meal!-1);assert.equal(actor.inventory.water,before.stock.water!-1);
  assert.equal(patient.health,27);assert.ok(patient.hunger<60);assert.deepEqual(patient.inventory,before.patientStock);assert.equal(patient.coins,before.coins);
  assert.deepEqual(patient.guardianIds,before.guardians);assert.deepEqual(patient.parents,before.parents);assert.equal(patient.homeId,null);
  assert.equal(patient.canDecide,false);assert.equal(patient.canExpress,false);assert.equal(w.proposals.length,0);
  const facts=careFacts(w);assert.equal(facts.length,1);assert.equal(facts[0].audit!.authority,'emergency');assert.deepEqual(facts[0].audit!.resources,{meal:1,water:1});assert.deepEqual(facts[0].audit!.scope,['basic-care']);
  assert.equal(executeSocialAction(w,actor,action).ok,false,'the completed episode cannot extend beyond the emergency window');
  assert.ok(!menu(w,actor).some(c=>isCare(patient.id)(c.action)));assert.equal(careFacts(w).length,1);
  assert.notEqual(w.frontierHazards?.weather?.enabled,true);
 }
});

test('adult emergency care: historical guardians are not adult proxies at the eighteenth birthday or in old adult saves',()=>{
 for(const age of [18-1/YEAR,18,30,65]){
  const {w,helper,patient,formerGuardian}=fixture();patient.bornAt=w.minute-age*YEAR;if(age>=65)patient.lifeStage='elder';
  assert.equal(careAuthority(w,helper,patient).allowed,age>=18,`actual age ${age}, regardless of saved lifeStage`);
  if(age>=18){advanceLife(w,.25);assert.deepEqual(patient.guardianIds,[formerGuardian.id]);assert.equal(careAuthority(w,helper,patient).basis,'emergency');}
 }
 const {w,patient}=fixture();patient.bornAt=w.minute-18*YEAR+.25;patient.lifeStage='teen';w.minute+=.25;advanceLife(w,.25);
 assert.deepEqual(patient.guardianIds,[],'ordinary coming-of-age cleanup is preserved; authority must not depend on that one-time transition');
});

test('adult emergency care: current child guardians still block stranger emergency care and keep only existing infant authority',()=>{
 for(const age of [2,5.99,6,13,18-1/YEAR]){
  const {w,helper,patient,formerGuardian}=fixture();patient.bornAt=w.minute-age*YEAR;
  assert.equal(careAuthority(w,helper,patient).allowed,false);
  assert.ok(!menu(w,helper).some(c=>isCare(patient.id)(c.action)));
  assert.equal(careAuthority(w,formerGuardian,patient).basis,age<6?'guardian':undefined);
  formerGuardian.at={x:1,y:16};assert.equal(careAuthority(w,helper,patient).basis,'emergency');
 }
});

test('adult emergency care: historical relation does not widen the unchanged health threshold',()=>{
 for(const historical of [false,true])for(const health of [19,20,20.001,40,95]){
  const {w,helper,patient}=fixture();patient.health=health;if(!historical)patient.guardianIds=[];
  assert.equal(careAuthority(w,helper,patient).allowed,health<=20);
  assert.equal(menu(w,helper).some(c=>isCare(patient.id)(c.action)),health<=20);
  if(health>20){const stock={...helper.inventory};assert.equal(executeSocialAction(w,helper,{type:'care',targetId:patient.id}).ok,false);assert.deepEqual(helper.inventory,stock);}
 }
});

test('adult emergency care: full capacity retains a separate proposal and personal acceptance, never a guardian substitute',()=>{
 const {w,helper,patient,formerGuardian}=fixture();patient.canDecide=true;patient.canExpress=true;
 assert.ok(!menu(w,helper).some(c=>isCare(patient.id)(c.action)));
 run(w,helper,choose(w,helper,a=>a.type==='propose'&&a.proposal==='care'&&a.targetId===patient.id));
 const p=w.proposals.at(-1)!;
 assert.equal(executeSocialAction(w,formerGuardian,{type:'respond',proposalId:p.id,accept:true}).ok,false);
 assert.equal(p.status,'open');assert.ok(!menu(w,formerGuardian).some(c=>c.action.type==='respond'&&c.action.proposalId===p.id&&c.action.accept));
 run(w,patient,choose(w,patient,a=>a.type==='respond'&&a.proposalId===p.id&&a.accept));
 const action=choose(w,helper,isCare(patient.id));assert.equal(action.type==='care'&&action.proposalId,p.id);
 run(w,helper,action);assert.equal(p.status,'expired');assert.equal(careFacts(w)[0].audit!.authority,'consent');
});

test('adult emergency care: expression alone never creates new agreement or overrides a valid refusal',()=>{
 for(const refusal of ['none','global','specific'] as const){
  const {w,helper,patient}=fixture();patient.canExpress=true;
  if(refusal==='global')patient.refusesCare=true;
  if(refusal==='specific')w.proposals.push({id:'personal-stop',actorId:helper.id,targetId:patient.id,kind:'care',createdAt:w.minute-1,expiresAt:w.minute+200,status:'declined',definition:w.activeDefinitions['action/routine']});
  assert.equal(careAuthority(w,helper,patient).allowed,refusal==='none');
  assert.equal(menu(w,helper).some(c=>isCare(patient.id)(c.action)),refusal==='none');
  assert.ok(!menu(w,helper).some(c=>c.action.type==='propose'&&c.action.proposal==='care'&&c.action.targetId===patient.id));
  if(refusal!=='none'){const stock={...helper.inventory};assert.equal(executeSocialAction(w,helper,{type:'care',targetId:patient.id}).ok,false);assert.deepEqual(helper.inventory,stock);}
 }
});

test('adult emergency care: queued work rechecks refusal, restored capacity and lost urgency before consumption',()=>{
 for(const change of ['refusal','capacity','urgency'] as const){
  const {w,helper,patient}=fixture(),action=choose(w,helper,isCare(patient.id));
  assert.equal(submitPlan(w,plan(w,helper,[action])).ok,true);stepWorld(w,29.75);assert.ok(helper.activity);
  const stock={...helper.inventory};
  if(change==='refusal')patient.refusesCare=true;
  if(change==='capacity'){patient.canDecide=true;patient.canExpress=true;}
  if(change==='urgency')patient.health=20.001;
  stepWorld(w,.25);assert.equal(helper.activity,null);assert.ok(helper.lastFailure);assert.deepEqual(helper.inventory,stock);assert.equal(careFacts(w).length,0);
 }
});

test('adult emergency care: SQLite preserves historical identity and revalidates queued work, not new consent',()=>{
 for(const change of ['none','refusal','capacity','urgency','unbound-consent'] as const){
  const original=fixture(),action=choose(original.w,original.helper,isCare(original.patient.id));
  assert.equal(submitPlan(original.w,plan(original.w,original.helper,[action])).ok,true);stepWorld(original.w,.25);
  if(change==='refusal')original.patient.refusesCare=true;
  if(change==='capacity'){original.patient.canDecide=true;original.patient.canExpress=true;}
  if(change==='urgency')original.patient.health=40;
  if(change==='unbound-consent')original.w.proposals.push({id:'cannot-adopt-this-consent',actorId:original.helper.id,targetId:original.patient.id,kind:'care',createdAt:original.w.minute-1,expiresAt:original.w.minute+200,status:'accepted',definition:original.w.activeDefinitions['action/routine']});
  const w=reload(original.w),helper=w.residents.find(r=>r.id===original.helper.id)!,patient=w.residents.find(r=>r.id===original.patient.id)!,stock={...helper.inventory};
  assert.deepEqual(patient.guardianIds,[original.formerGuardian.id]);stepWorld(w,35);
  assert.equal(careFacts(w).length,change==='none'?1:0);
  if(change==='none'){assert.equal(helper.inventory.meal,stock.meal!-1);assert.equal(helper.inventory.water,stock.water!-1);assert.equal(patient.health,27);}
  else{assert.deepEqual(helper.inventory,stock);assert.ok(helper.lastFailure);}
  assert.deepEqual(patient.guardianIds,[original.formerGuardian.id]);assert.notEqual(w.frontierHazards?.weather?.enabled,true);
 }
});
