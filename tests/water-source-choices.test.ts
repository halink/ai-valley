import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Resource,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {waterSourceOpportunities} from '../src/server/water-source-opportunities.js';
import {canInspectSpring} from '../src/world/spring-observation.js';
import {findPath} from '../src/world/navigation.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
const visits=(s:Resource)=>(a:Action)=>a.type==='move'&&a.to.x===s.at.x&&a.to.y===s.at.y;
const gathers=(s:Resource)=>(a:Action)=>a.type==='gather'&&a.resourceId===s.id;
function select(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,number>={}){
 const p=prepared(w,r),choice=p.choices.find(c=>predicate(c.action));assert.ok(choice,'actual final menu contains selected action');
 assert.ok(p.messages[0].content.includes(choice.id+'. '+choice.label));
 const decision=parseChoice(JSON.stringify({choice:choice.id,...fields}),p.choices);
 assert.equal(submitPlan(w,{id:`water-choice:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision}).ok,true);
 return decision.actions[0];
}
function finish(w:World,r:Resident){let budget=500;while(r.activity||r.plan){assert.ok(budget--,'bounded activity');stepWorld(w,1);}}
function act(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,number>={}){
 select(w,r,predicate,fields);finish(w,r);assert.equal(r.lastFailure,null);
}
function eventually(w:World,r:Resident,predicate:(a:Action)=>boolean){
 for(let i=0;i<40;i++){
  if(prepared(w,r).choices.some(c=>predicate(c.action))){act(w,r,predicate);return;}
  act(w,r,a=>a.type==='wait',{minutes:30});
 }
 assert.fail('ordinary scripted menu selection never appeared');
}
function fixture(){
 const w=createWorld(5401),r=w.residents[0];w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={width:50,height:50,tiles:Array(2500).fill('grass'),entrance:{x:0,y:0},name:'Synthetic water source choices'};
 w.residents=[r];w.buildings=[];w.graves=[];w.events=[];w.resources=[];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,knownBuildings:[],knownPeople:[],knownResources:[],inventory:{water:0},memories:[],activity:null,plan:null,lastFailure:null,hunger:20,energy:100,health:100,bornAt:w.minute-30*YEAR});
 w.plots=[{id:'growing-field',ownerId:r.id,at:{x:19,y:20},crop:{definition:'crop/turnip@1',growth:1,planted:0,wateredDay:-1,lastGrowthDay:0}}];
 const spring=(id:string,x:number,y:number)=>{const s:Resource={id,kind:'spring',at:{x,y},amount:9,max:9,regrowthDays:0,lastHarvest:0};w.resources.push(s);r.knownResources.push(id);return s;};
 return {w,r,spring};
}

test('seed 5401: normal cooking and farming reach zero-water dry crop; final source direction never needs agenda waiting',t=>{
 const w=createFrontierWorld(5401),r=w.residents.find(r=>r.name==='苏庭')!;w.clock.paused=false;stepWorld(w,1);
 eventually(w,r,a=>a.type==='cook');eventually(w,r,a=>a.type==='cook');
 const plots=w.plots.filter(p=>p.ownerId===r.id),first=[...plots].sort((a,b)=>Math.abs(a.at.x-r.at.x)+Math.abs(a.at.y-r.at.y)-Math.abs(b.at.x-r.at.x)-Math.abs(b.at.y-r.at.y)||a.id.localeCompare(b.id))[0];
 eventually(w,r,a=>a.type==='move'&&a.to.x===first.at.x&&a.to.y===first.at.y);
 for(let i=0;i<3;i++)eventually(w,r,a=>a.type==='production'&&a.operation==='plantCrop'&&a.cropId==='crop/turnip@2');
 for(let i=0;i<2;i++)eventually(w,r,a=>a.type==='water');
 assert.equal(r.inventory.water,0);const dry=plots.find(p=>p.crop!.wateredDay!==Math.floor(w.minute/DAY))!;assert.ok(dry);
 assert.ok(decisionContext(w,r).plots.some(p=>p.id===dry.id&&p.observed?.stage==='growing'&&p.observed.wateredToday===false));
 const source=w.resources.find(s=>s.kind==='spring'&&r.knownResources.includes(s.id))!,start=w.minute;
 assert.equal(canInspectSpring(w,r,source),false);
 for(let i=0;i<4;i++){
  const p=prepared(w,r);assert.ok(p.choices.some(c=>visits(source)(c.action)),`source immediately at ${w.minute}`);
  assert.ok(!p.choices.some(c=>c.action.type==='water'));assert.match(p.messages[0].content,/今日未浇水/);
  act(w,r,a=>a.type==='wait',{minutes:30});assert.equal(r.inventory.water,0);assert.equal(dry.crop!.wateredDay,-1);
 }
 assert.equal(w.minute-start,120);const before=source.amount;
 act(w,r,visits(source));assert.equal(r.inventory.water,0);assert.equal(source.amount,before);
 act(w,r,gathers(source));assert.equal(r.inventory.water,3);assert.equal(source.amount,before-3);
 eventually(w,r,a=>a.type==='move'&&plots.some(p=>a.to.x===p.at.x&&a.to.y===p.at.y));
 eventually(w,r,a=>a.type==='water'&&a.plotId===dry.id);
 assert.equal(r.inventory.water,2);assert.equal(dry.crop!.wateredDay,Math.floor(w.minute/DAY));assert.equal(w.residents.filter(p=>p.status==='alive').length,9);
 t.diagnostic(`Normal menu chain: zero water at ${start}, dry crop ${dry.id}, 120-minute wait probes, irrigated at ${w.minute}; no model or fixture rewrites.`);
});

test('cliff-enclosed nearest known spring keeps a reachable farther source in actual menu and execution',()=>{
 const {w,r,spring}=fixture(),near=spring('enclosed',22,20),far=spring('reachable',20,25);
 for(const [x,y] of [[21,20],[23,20],[22,19],[22,21]])w.map.tiles[y*50+x]='cliff';
 assert.equal(findPath(w,r.at,near.at,true),null);assert.ok(findPath(w,r.at,far.at,true));
 assert.equal(canInspectSpring(w,r,near),false);assert.ok(prepared(w,r).choices.some(c=>visits(near)(c.action)));
 act(w,r,gathers(far));assert.equal(r.inventory.water,3);assert.equal(far.amount,6);assert.equal(near.amount,9);
});

test('more than two known sources rotate once with bounded coverage under every focus',()=>{
 const {w,r,spring}=fixture();const sources=Array.from({length:9},(_,i)=>spring(`known-${i}`,33+i,20));
 for(const focus of [undefined,'farming','social','care','exploration'] as const){
  r.agency=focus?{focus,goals:[],routines:[],nextSerial:1}:undefined;
  const seen=new Set<string>();
  for(let t=0;t<8;t++){
   w.minute=600+t*30;const raw=waterSourceOpportunities(w,r),p=prepared(w,r);
   assert.equal(raw.length,2);assert.ok(p.choices.length<=58);assert.ok(raw.every(choice=>p.choices.some(c=>JSON.stringify(c.action)===JSON.stringify(choice.action))));
   for(const s of sources)if(p.choices.some(c=>visits(s)(c.action)))seen.add(s.id);
   assert.ok(seen.has(sources[0].id));
  }
  assert.equal(seen.size,9,focus);
 }
});

test('visible quantity and blockage changes are local; hidden quantity and unknown address changes are invisible',()=>{
 const {w,r,spring}=fixture(),near=spring('visible',24,20),far=spring('hidden',35,20),unknown=spring('unknown',40,35);r.knownResources.pop();
 const before=prepared(w,r);
 for(const amount of [0,1,180]){
  far.amount=amount;far.lastHarvest=999;far.floodDamage={disasterId:'hidden',at:1,clearedAt:null};unknown.at.x++;unknown.amount=amount;
  assert.deepEqual(prepared(w,r),before);
 }
 near.amount=1;assert.equal(prepared(w,r).choices.find(c=>gathers(near)(c.action))!.action.type,'gather');
 const selected=prepared(w,r).choices.find(c=>gathers(near)(c.action))!.action;assert.equal(selected.type==='gather'&&selected.quantity,1);
 near.amount=0;assert.ok(!prepared(w,r).choices.some(c=>gathers(near)(c.action)));
});

test('alternate final choices race only for finite source water and remain valid through memory-store reload',()=>{
 const {w,r,spring}=fixture();spring('nearest',24,20);const far=spring('alternate',20,24);far.amount=3;
 const other=structuredClone(r);other.id='second-collector';other.name='另一人';w.residents.push(other);
 select(w,r,gathers(far));select(w,other,gathers(far));
 const store=new WorldStore(':memory:');store.commit(w,null);const loaded=store.load()!;store.close();
 for(const actor of loaded.residents)finish(loaded,actor);
 assert.equal(loaded.resources.find(s=>s.id===far.id)!.amount,0);assert.equal(loaded.residents.reduce((n,p)=>n+(p.inventory.water??0),0),3);
 assert.equal(loaded.residents.filter(p=>p.lastFailure===null).length,1);assert.equal(loaded.plots[0].crop!.wateredDay,-1);
});

test('source candidates do not bypass transport, expression-only or age restrictions',()=>{
 const {w,r,spring}=fixture();spring('known',35,20);
 for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','familyTravelling','passenger','aboard'] as const){
  const c=decisionContext(w,r);c.formal![flag]=true;
  const p=prepareModelDecision(c,undefined,GLM_MODEL);assert.ok(!p.choices.some(c=>c.action.type==='move'||c.action.type==='gather'),flag);
 }
 const c=decisionContext(w,r);c.formal!.age=5;assert.ok(!prepareModelDecision(c,undefined,GLM_MODEL).choices.some(c=>c.action.type==='move'||c.action.type==='gather'));
});

test('source snapshots are detached and JSON reload needs no new stored knowledge fields',()=>{
 const {w,r,spring}=fixture(),s=spring('known',35,20),context=decisionContext(w,r),p=prepareModelDecision(context,undefined,GLM_MODEL);
 s.at.x++;s.amount=0;r.knownResources=[];
 assert.deepEqual(prepareModelDecision(context,undefined,GLM_MODEL),p);
 const old=JSON.parse(JSON.stringify(w)) as World;old.residents[0].knownResources=[s.id];
 assert.ok(prepared(old,old.residents[0]).choices.some(c=>visits(s)(c.action)));assert.equal(old.residents[0].inventory.water,0);
});

test('full 56-slot agenda adds exactly two source slots beside one field direction and keeps independent live stops',()=>{
 const {w,r,spring}=fixture(),near=spring('remote-near',33,20),far=spring('remote-far',35,20),c=decisionContext(w,r);
 const sources=waterSourceOpportunities(w,r);assert.equal(sources.length,2);
 c.formal!.opportunities=Array.from({length:100},(_,i)=>({id:`synthetic-control-${i}`,label:`撤销独立分支 ${i}`,action:{type:'agency' as const,operation:'disarm' as const,routineId:`routine-${i}`}}));
 const field=(a:Action)=>a.type==='move'&&c.knownLand.some(p=>p.at.x===a.to.x&&p.at.y===a.to.y);
 const baseline=prepareModelDecision(c,undefined,GLM_MODEL);assert.equal(baseline.choices.filter(row=>!field(row.action)).length,56);assert.equal(baseline.choices.filter(row=>field(row.action)).length,1);assert.equal(baseline.choices.length,57);assert.ok(!baseline.choices.some(c=>c.action.type==='agency'&&c.action.operation==='reflect'));
 c.formal!.opportunities.push(...sources);
 const p=prepareModelDecision(c,undefined,GLM_MODEL);assert.equal(p.choices.length,baseline.choices.length+2);assert.equal(p.choices.filter(row=>field(row.action)).length,1);assert.equal(p.choices.length,59);
 for(const choice of baseline.choices)assert.ok(p.choices.some(c=>c.label===choice.label&&JSON.stringify(c.action)===JSON.stringify(choice.action)));
 assert.ok(p.choices.some(c=>visits(near)(c.action)));assert.ok(p.choices.some(c=>visits(far)(c.action)));
 c.formal!.opportunities.push({id:'care.stop.synthetic',label:'立即停止本人照护',action:{type:'respond',proposalId:'own-care',accept:false}});
 const stopped=prepareModelDecision(c,undefined,GLM_MODEL);assert.ok(stopped.choices.some(c=>c.action.type==='respond'&&c.action.proposalId==='own-care'&&!c.action.accept));
 assert.ok(stopped.choices.some(c=>visits(near)(c.action)));assert.ok(stopped.choices.some(c=>visits(far)(c.action)));assert.ok(stopped.choices.length<=60);
});
