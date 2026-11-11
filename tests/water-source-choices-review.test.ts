import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Resource,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {parseChoice} from '../src/server/affordances.js';
import {findPath} from '../src/world/navigation.js';
import {canInspectSpring} from '../src/world/spring-observation.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {focusNames} from '../src/shared/agency.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(5401),r=w.residents[0];w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={width:50,height:50,tiles:Array(2500).fill('grass'),entrance:{x:0,y:0},name:'Independent water review'};
 w.residents=[r];w.buildings=[];w.resources=[];w.events=[];w.graves=[];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,knownBuildings:[],knownPeople:[],knownResources:[],inventory:{water:0},memories:[],activity:null,plan:null,lastFailure:null,hunger:20,energy:100,health:100,bornAt:w.minute-30*YEAR});
 w.plots=[{id:'review-growing',ownerId:r.id,at:{x:19,y:20},crop:{definition:'crop/turnip@1',planted:0,growth:1,wateredDay:-1,lastGrowthDay:0}}];
 const spring=(id:string,x:number,y:number)=>{const s:Resource={id,kind:'spring',at:{x,y},amount:9,max:9,regrowthDays:0,lastHarvest:0};w.resources.push(s);r.knownResources.push(id);return s;};
 return {w,r,spring};
}
const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
const matches=(s:Resource)=>(a:Action)=>a.type==='gather'&&a.resourceId===s.id||a.type==='move'&&a.to.x===s.at.x&&a.to.y===s.at.y;
function choose(w:World,r:Resident,s:Resource){const p=prepared(w,r),c=p.choices.find(c=>matches(s)(c.action));assert.ok(c,'reachable known water source stays in final menu');assert.ok(p.messages[0].content.includes(c.id+'. '+c.label));return parseChoice(JSON.stringify({choice:c.id}),p.choices).actions[0];}
function execute(w:World,r:Resident,a:Action){assert.equal(submitPlan(w,{id:`review-${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Independently select one action',actions:[a]}).ok,true);let budget=300;while(r.activity||r.plan){assert.ok(budget--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}

test('independent review: dry observed crop retains known remote water choice at every minute for 120 minutes',()=>{
 const {w,r,spring}=fixture(),s=spring('known-remote',35,20);const snapshot=()=>structuredClone({residents:w.residents,resources:w.resources,plots:w.plots,events:w.events});const before=snapshot();
 for(let minute=600;minute<=720;minute++){w.minute=minute;choose(w,r,s);assert.ok(prepared(w,r).choices.length<=58);}
 assert.deepEqual(snapshot(),before,'constructing choices never changes residents, plans, water or crops');
});

test('independent review: disconnected nearest address cannot suppress a reachable farther known spring',()=>{
 const {w,r,spring}=fixture(),near=spring('near-unreachable',22,20),far=spring('far-reachable',20,35);
 for(let y=0;y<50;y++)w.map.tiles[y*50+21]='water';
 assert.equal(findPath(w,r.at,near.at,false),null);assert.ok(findPath(w,r.at,far.at,false));
 for(let minute=600;minute<=720;minute+=30){w.minute=minute;choose(w,r,far);}
});

test('independent review: visible nearest across transparent barrier cannot suppress reachable visible collection',()=>{
 const {w,r,spring}=fixture(),near=spring('visible-unreachable',22,20),far=spring('visible-reachable',20,24);
 for(let y=0;y<50;y++)w.map.tiles[y*50+21]='water';
 assert.equal(canInspectSpring(w,r,near),true);assert.equal(canInspectSpring(w,r,far),true);
 const a=choose(w,r,far);assert.equal(a.type,'gather');
 execute(w,r,a);assert.equal(r.inventory.water,3);assert.equal(far.amount,6);assert.equal(near.amount,9);assert.equal(w.plots[0].crop!.wateredDay,-1);
});

test('independent review: hidden known stock, flood state and unknown remote locations do not affect final context or prompt',()=>{
 const {w,r,spring}=fixture(),s=spring('known-hidden',35,20);const unknown=spring('unknown-secret',40,30);r.knownResources.pop();
 const context=structuredClone(decisionContext(w,r)),p=prepared(w,r);
 for(const amount of [0,1,500])for(const blocked of [false,true]){
  s.amount=amount;s.max=amount+5;s.lastHarvest=444;s.floodDamage=blocked?{disasterId:'unseen-flood',at:500,clearedAt:null}:undefined;
  unknown.at={x:40+amount%3,y:35};unknown.amount=amount;
  assert.deepEqual(decisionContext(w,r),context);assert.deepEqual(prepared(w,r),p);
 }
 assert.ok(!JSON.stringify(p).includes('unknown-secret'));
});

test('independent review: visiting remains separate from gathering and watering',()=>{
 const {w,r,spring}=fixture(),s=spring('address-only',33,20);const a=choose(w,r,s);assert.equal(a.type,'move');
 execute(w,r,a);assert.equal(r.inventory.water,0);assert.equal(s.amount,9);assert.equal(w.plots[0].crop!.wateredDay,-1);
 const gather=choose(w,r,s);assert.equal(gather.type,'gather');execute(w,r,gather);
 assert.equal(r.inventory.water,3);assert.equal(s.amount,6);assert.equal(w.plots[0].crop!.wateredDay,-1);
});

test('independent review: inaccessible source tile does not suppress reachable alternate gathering',()=>{
 const {w,r,spring}=fixture(),s=spring('water-tile',21,20),far=spring('normal-ground',20,24);w.map.tiles[20*50+21]='water';
 assert.equal(canInspectSpring(w,r,s),true);assert.equal(findPath(w,r.at,s.at,false),null);
 choose(w,r,far);
});

test('independent review: saturated ordinary menus keep all existing non-reflection choices beside bounded water choices',()=>{
 const {w,r,spring}=fixture(),s=spring('known-remote',35,20),c=decisionContext(w,r);
 for(let i=0;i<160;i++){
  c.formal!.opportunities.push({id:`review-control-${i}`,label:'Stop synthetic commitment',action:{type:'agency',operation:'disarm',routineId:`routine-${i}`}});
  c.formal!.opportunities.push({id:`review-work-${i}`,label:'Attend synthetic commitment',action:{type:'employment',operation:'work',contractId:`contract-${i}`}});
 }
 for(const focus of Object.keys(focusNames) as Array<keyof typeof focusNames>){
  c.actor.agency={focus,goals:[],routines:[],nextSerial:1};
  for(let minute=600;minute<=720;minute+=30){
   c.minute=minute;c.plots.forEach(p=>{if(p.observed)p.observed.atMinute=minute;});
   const baseline=structuredClone(c);baseline.formal!.opportunities=baseline.formal!.opportunities.filter(o=>!matches(s)(o.action));
   const before=prepareModelDecision(baseline,undefined,GLM_MODEL).choices,after=prepareModelDecision(c,undefined,GLM_MODEL).choices;
   for(const choice of before.filter(c=>!(c.action.type==='agency'&&c.action.operation==='reflect')))assert.ok(after.some(c=>c.label===choice.label&&JSON.stringify(c.action)===JSON.stringify(choice.action)),`preserve ${choice.label} with focus ${focus}`);
   assert.ok(after.some(c=>matches(s)(c.action)),focus);assert.ok(after.length<=58);assert.equal(new Set(after.map(c=>c.id)).size,after.length);
  }
 }
});

test('independent review: actual seed 5401 Su Ting sees a water source during each 30-minute agenda period',()=>{
 const w=createFrontierWorld(5401),r=w.residents.find(r=>r.name==='苏庭');assert.ok(r);
 r.inventory.water=0;const plot=w.plots.find(p=>p.ownerId===r.id)!;r.at={...plot.at};plot.crop={definition:'crop/turnip@1',planted:0,growth:1,wateredDay:-1,lastGrowthDay:0};
 const known=w.resources.filter(s=>s.kind==='spring'&&r.knownResources.includes(s.id));assert.ok(known.length);
 const start=w.minute;
 for(let minute=start;minute<=start+120;minute+=30){
  w.minute=minute;const c=decisionContext(w,r);assert.ok(c.plots.some(p=>p.observed?.stage==='growing'&&p.observed.wateredToday===false),'fixture really observes own dry growing crop');
  const p=prepareModelDecision(c,undefined,GLM_MODEL);assert.ok(p.choices.some(c=>known.some(s=>matches(s)(c.action))),`minute ${minute}`);
 }
});

test('independent review: many hidden addresses all receive the rotating alternative without aliasing final focus',()=>{
 const {w,r,spring}=fixture(),sources=Array.from({length:9},(_,i)=>spring(`review-many-${i}`,34+i,20));
 for(const focus of ['daily','farming','exploration'] as const){
  r.agency={focus,goals:[],routines:[],nextSerial:1};const seen=new Set<string>();
  for(let step=0;step<8;step++){
   w.minute=600+30*step;const p=prepared(w,r),offered=sources.filter(s=>p.choices.some(c=>matches(s)(c.action)));
   assert.equal(offered.length,2);assert.ok(offered.includes(sources[0]));for(const s of offered)seen.add(s.id);
  }
  assert.equal(seen.size,sources.length,focus);
 }
});
