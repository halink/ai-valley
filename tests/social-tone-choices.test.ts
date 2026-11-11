import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {createWorld} from '../src/world/seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {restoreSocialToneChoices} from '../src/server/social-tone-choices.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {focusNames} from '../src/shared/agency.js';
import type {Action,DecisionContext,Resident,World} from '../src/shared/types.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

const tones=['friendly','hostile','neutral'];
const prepared=(c:DecisionContext)=>prepareModelDecision(c,undefined,GLM_MODEL);
const talks=(rows:ActionChoice[],id?:string)=>rows.filter(c=>c.action.type==='talk'&&(!id||c.action.targetId===id));
function completeGroups(rows:ActionChoice[]){
 const groups=new Map<string,string[]>();
 for(const c of talks(rows))if(c.action.type==='talk')groups.set(c.action.targetId,[...(groups.get(c.action.targetId)??[]),c.action.tone]);
 for(const [id,values] of groups)assert.deepEqual(values.sort(),tones,id);
 return groups;
}
let serial=0;
function select(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 const p=prepared(decisionContext(w,r)),choice=p.choices.find(c=>predicate(c.action));assert.ok(choice,'actual final numbered choice');
 assert.match(choice.id,/^\d+$/);assert.ok(p.messages[0].content.includes(choice.id+'. '+choice.label));
 return parseChoice(JSON.stringify({choice:choice.id,...fields}),p.choices);
}
function run(w:World,r:Resident,decision:ReturnType<typeof parseChoice>){
 const result=submitPlan(w,{id:'social-tone:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision});
 if(result.ok){let budget=200;while(r.plan||r.activity){assert.ok(budget--);stepWorld(w,1);}}
 return result;
}
function seed(){const w=createFrontierWorld(5401);w.clock.paused=false;stepWorld(w,1);return {w,r:w.residents[0],peer:w.residents[1]};}
function fixture(count=8){
 const w=createWorld(5401),r=w.residents[0],sample=w.residents[1];w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={width:40,height:40,tiles:Array(1600).fill('grass'),entrance:{x:0,y:0},name:'Synthetic conversation tests'};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.events=[];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,inventory:{meal:3,water:3},hunger:20,health:100,energy:100,plan:null,activity:null,knownBuildings:[],knownResources:[],relations:[],memories:[]});
 const peers=Array.from({length:count},(_,i):Resident=>({...structuredClone(sample),id:`peer-${i}`,name:`对象${i}`,at:{x:20+i%3,y:21+Math.floor(i/3)},inside:null,roomAt:null,homeId:null,knownBuildings:[],knownResources:[],relations:[],memories:[],bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:20,plan:null,activity:null}));
 w.residents=[r,...peers];for(const p of w.residents)p.knownPeople=w.residents.filter(q=>q!==p).map(q=>q.id);
 decisionContext(w,r);return {w,r,peers};
}
function crowd(c:DecisionContext){
 for(let i=0;i<160;i++){
  c.formal!.opportunities.push({id:`tone-work-${i}`,label:`Synthetic work ${i}`,action:{type:'employment',operation:'work',contractId:`work-${i}`}});
  c.formal!.opportunities.push({id:`tone-no-${i}`,label:`Synthetic refusal ${i}`,action:{type:'respond',proposalId:`reply-${i}`,accept:false}});
 }
 c.formal!.opportunities.push({id:'care.stop.tone',label:'Stop current care',action:{type:'health',operation:'cancelRescue',transportId:'synthetic'}});
}

for(const tone of ['neutral','friendly','hostile'] as const)test(`unmodified formal seed5401 minute481: spouse ${tone} is numbered, parsed, explicitly spoken and persisted`,()=>{
 const {w,r,peer}=seed();assert.equal(w.minute,481);const before=structuredClone(w),p=prepared(decisionContext(w,r));
 assert.deepEqual(talks(p.choices,peer.id).map(c=>c.action.type==='talk'&&c.action.tone).sort(),tones);
 const text=`本人选择${tone}说出这句话。`,d=select(w,r,a=>a.type==='talk'&&a.targetId===peer.id&&a.tone===tone,{text});
 assert.deepEqual(w,before);const relation=structuredClone(r.relations.find(t=>t.targetId===peer.id)!);
 assert.equal(run(w,r,d).ok,true);assert.equal(r.lastFailure,null);assert.equal(w.events.filter(e=>e.kind==='conversation'&&e.text.includes(text)).length,1);
 const after=r.relations.find(t=>t.targetId===peer.id)!;assert.equal(after.affection,relation.affection);assert.equal(after.trust,relation.trust);assert.equal(after.conflict,relation.conflict);assert.equal(after.evidence.length,relation.evidence.length+1);
 assert.equal(w.metrics.requests,0);const store=new WorldStore(':memory:');try{store.commit(w,null);assert.equal(store.load()!.events.filter(e=>e.kind==='conversation'&&e.text.includes(text)).length,1);}finally{store.close();}
});

test('every present selected target has all tones under every focus and stable fair rotation reaches later peers',()=>{
 const {w,r,peers}=fixture();
 for(const focus of [undefined,...Object.keys(focusNames)] as Array<keyof typeof focusNames|undefined>){
  const c=decisionContext(w,r);c.actor.agency=focus?{focus,goals:[],routines:[],nextSerial:1}:undefined;crowd(c);const seen=new Set<string>();
  for(let i=0;i<peers.length;i++){
   c.minute=600+i*30;const before=structuredClone(c),p=prepared(c),groups=completeGroups(p.choices);
   assert.ok(groups.size>=1&&groups.size<=3);for(const id of groups.keys())seen.add(id);assert.ok(groups.has(peers[0].id),'nearest remains available');
   assert.ok(p.choices.length<=69,'at most59 baseline +9 tones +1 live stop');assert.equal(new Set(p.choices.map(c=>c.id)).size,p.choices.length);
   assert.ok(p.choices.some(c=>c.action.type==='wait'));assert.ok(p.choices.some(c=>c.action.type==='eat'));assert.ok(p.choices.some(c=>c.action.type==='respond'&&!c.action.accept));assert.ok(p.choices.some(c=>c.label==='Stop current care'));
   assert.deepEqual(c,before);
  }
  assert.equal(seen.size,peers.length,focus);
 }
});

test('social restoration preserves baseline non-reflection actions and complete groups after both caps',()=>{
 const {w,r}=fixture(3),c=decisionContext(w,r);crowd(c);c.actor.hunger=99;
 const all=buildChoices(c),baseline=focusedChoices(c,all),after=restoreSocialToneChoices(c,baseline);
 for(const row of baseline.filter(c=>!(c.action.type==='agency'&&c.action.operation==='reflect')))assert.ok(after.includes(row),row.id);
 assert.equal(completeGroups(after).size,3);
});

test('ordinary numbered waits rotate peers but neither menu building nor time passing creates speech or changes bonds',()=>{
 const {w,r,peers}=fixture(),before=structuredClone(w.residents.map(p=>p.relations)),seen=new Set<string>();
 for(let i=0;i<peers.length;i++){
  for(const id of completeGroups(prepared(decisionContext(w,r)).choices).keys())seen.add(id);
  assert.equal(run(w,r,select(w,r,a=>a.type==='wait',{minutes:30})).ok,true);
 }
 assert.equal(seen.size,peers.length);assert.deepEqual(w.residents.map(p=>p.relations),before);assert.ok(!w.events.some(e=>e.kind==='conversation'));assert.equal(w.metrics.requests,0);
});

test('incapacity, age, transport restrictions and invisible unknown departed or dead people never gain talk options',()=>{
 for(const change of ['canDecide','canExpress','dead','outside','young'] as const){const {w,r}=fixture();if(change==='canDecide'||change==='canExpress')r[change]=false;else if(change==='dead')r.status='dead';else if(change==='outside')r.residency='outside';else r.bornAt=w.minute-4*YEAR;assert.equal(talks(prepared(decisionContext(w,r)).choices).length,0,change);}
 for(const flag of ['passenger','familyTravelling','careWithdrawalOnly','expressiveEvacuationOnly'] as const){const {w,r}=fixture(),c=decisionContext(w,r);c.formal![flag]=true;assert.equal(talks(prepared(c).choices).length,0,flag);}
 const {w,r,peers}=fixture(5);peers[0].inside='private-room';peers[1].residency='outside';peers[2].status='dead';peers[3].at={x:39,y:39};r.knownPeople=r.knownPeople.filter(id=>id!==peers[4].id);
 assert.equal(talks(prepared(decisionContext(w,r)).choices).length,0);
});

test('stale numbered speech loses authority when actor ability or physical contact changes',()=>{
 for(const change of ['decide','express','depart','room','targetDead'] as const){
  const {w,r,peers}=fixture(1),peer=peers[0],d=select(w,r,a=>a.type==='talk'&&a.tone==='neutral',{text:'不应被说出'});
  if(change==='decide')r.canDecide=false;else if(change==='express')r.canExpress=false;else if(change==='depart')peer.residency='outside';else if(change==='room')peer.inside='closed';else peer.status='dead';
  const result=run(w,r,d);assert.ok(!result.ok||r.lastFailure,change);assert.ok(!w.events.some(e=>e.kind==='conversation'));assert.equal(r.relations.length,0);
 }
});

test('indoor nearest person uses observed room coordinates rather than shared outdoor doorway',()=>{
 const {w,r}=seed(),home=w.buildings.find(b=>b.id===r.homeId)!,peers=w.residents.slice(1,6);
 home.residents=[...new Set([...home.residents,r.id,...peers.map(p=>p.id)])];
 r.inside=home.id;r.roomAt={x:5,y:9};r.at={...home.door};r.knownPeople=peers.map(p=>p.id);
 peers.forEach((p,i)=>{p.inside=home.id;p.at={...home.door};p.roomAt={x:5+i,y:5};});
 const nearest=peers.at(-1)!;nearest.roomAt={x:5,y:10};
 for(let i=0;i<10;i++){
  const c=decisionContext(w,r);c.minute=600+30*i;const groups=completeGroups(prepared(c).choices);
  assert.ok(groups.has(nearest.id));assert.equal(c.people.find(p=>p.id===nearest.id)!.talkDistance,1);
 }
});
