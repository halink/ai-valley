// Isolated scenario controllers choose through the real engine. No model, service database,
// or production world is used. Run after npm run build.
import assert from 'node:assert/strict';
import {createIsolationEvidence} from '../build/world/isolation-evidence.js';
import {createWorld} from '../build/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../build/world/engine.js';
import {totalCoins} from '../build/world/economy.js';
import {WorldStore} from '../build/server/store.js';
import {DAY,YEAR} from '../build/world/time.js';
import {outsideCandidate,applyOutsideDecision} from '../build/world/migration.js';
const args=process.argv.slice(2),daily=args.includes('--daily-json');
assert.ok(args.filter(arg=>arg!=='--daily-json').length<=1&&args.every(arg=>arg==='--daily-json'||/^[1-8]$/.test(arg)),'Usage: acceptance-long-run.mjs [1..8 years] [--daily-json]');
const years=Number(args.find(arg=>arg!=='--daily-json')??3);assert.ok(Number.isInteger(years)&&years>=1&&years<=8);
const store=new WorldStore(':memory:');let w=createWorld();w.mode='formal';w.id='isolated-lifecycle-run';w.clock.paused=false;
w.map={width:32,height:24,name:'隔离多年连续运行夹具',entrance:{x:2,y:2},tiles:Array(32*24).fill('grass')};
const [a,b,elder]=w.residents,ids=[a.id,b.id,elder.id],home={...w.buildings[0],ownerId:a.id,kind:'home',at:{x:4,y:5},door:{x:7,y:10},width:6,height:5,capacity:5,residents:ids.slice(),condition:100},house={...home,id:'proof-greenhouse',kind:'greenhouse',at:{x:12,y:6},door:{x:15,y:11},capacity:0,residents:[],ownerId:'commons',definition:'building/greenhouse@1'},inn={...home,id:'proof-inn',kind:'lodge',at:{x:19,y:4},door:{x:22,y:9},capacity:4,residents:[],ownerId:'commons',definition:'building/lodge@1'};
w.buildings=[home,house,inn];w.graves=[];w.plots=[];w.resources=[{id:'berries',kind:'bush',at:{x:8,y:12},amount:40,max:40,regrowthDays:1,lastHarvest:w.minute},{id:'water',kind:'spring',at:{x:12,y:12},amount:40,max:40,regrowthDays:1,lastHarvest:w.minute}];
for(const p of w.residents){p.bornAt=w.minute-(p===elder?120:30)*YEAR;p.at={...home.door};p.inside=null;p.roomAt=null;p.homeId=home.id;p.residency='resident';p.hunger=0;p.energy=p.health=100;p.inventory={berry:6,seed:8,water:12};p.coins=30;p.knownBuildings=w.buildings.map(v=>v.id);p.knownResources=w.resources.map(v=>v.id);p.knownPeople=ids.filter(id=>id!==p.id);p.parents=[];p.guardianIds=[];p.relations=[];p.canDecide=p.canExpress=true;}
let evidence=null;
function advance(){if(evidence){const eating=stepWorldWithFoodEvidence(w,1),row=evidence.sample(w,eating);if(row)console.log(JSON.stringify({type:'daily-evidence',...row}));}else stepWorld(w,1);}
let serial=0,committed=null;const start=performance.now();function queue(p,action){const r=submitPlan(w,{id:'isolated-run:'+ ++serial,actorId:p.id,actorRevision:p.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离验收中的独立假设选择',actions:[action]});assert.ok(r.ok,r.error);}
function run(p,action){queue(p,action);let n=1000;while(p.plan||p.activity){assert.ok(n--);advance();}assert.equal(p.lastFailure,null);}
try{
 stepWorld(w,1);if(daily)evidence=createIsolationEvidence(w);const expected=totalCoins(w),from=w.minute;
 for(const proposal of ['dating','marriage','child']){run(a,{type:'propose',targetId:b.id,proposal});run(b,{type:'respond',proposalId:w.proposals.at(-1).id,accept:true});}
 assert.ok(a.pregnancy);const birthDue=a.pregnancy.dueAt;let nextReport=from+YEAR,priorDay=-1;
 function choice(p,child){const inv=p.inventory,berries=inv.berry??0,gatherSize=(w.minute-p.bornAt)/YEAR<18?3:5;const food=berries?'berry':(inv.meal??0)>0?'meal':(inv.turnip??0)>2?'turnip':null;
  if(!p.knownResources.includes('berries'))return {type:'move',to:{...home.door}};
  if(p.hunger>=55)return food?{type:'eat',item:food}:{type:'gather',resourceId:'berries',quantity:gatherSize};
  if(p.energy<45)return {type:'sleep',minutes:210};
  if(p.id===ids[0]&&p.pregnancy&&p.pregnancy.dueAt-w.minute<=360)return {type:'sleep',minutes:360};
  if(p.id===ids[0]){const day=Math.floor(w.minute/DAY),beds=w.industry.beds.filter(b=>b.buildingId===house.id);
   if(child&&!child.canDecide&&child.hunger>=53&&(inv.turnip??0)>0&&(inv.water??0)>0)return {type:'tendChild',targetId:child.id};
   const ripe=beds.find(b=>b.crop&&b.crop.growth>=Number(w.definitions[b.crop.definition].data.growthDays));if(ripe)return {type:'industry',operation:'harvestHouse',buildingId:house.id,bed:ripe.index};
   if((inv.water??0)<4)return {type:'gather',resourceId:'water',quantity:8};
   const dry=beds.find(b=>b.crop&&b.crop.wateredDay!==day);if(dry)return {type:'industry',operation:'tendHouse',buildingId:house.id,bed:dry.index};
   if((inv.seed??0)<4&&(inv.turnip??0)>=2)return {type:'production',operation:'saveSeed'};
   if((inv.seed??0)>0){const bed=[0,1,2,3].find(n=>!beds.some(b=>b.index===n&&b.crop));if(bed!==undefined)return {type:'industry',operation:'plantHouse',buildingId:house.id,bed,cropId:'crop/turnip@2'};}
  }
  if(berries<2&&w.resources[0].amount>=gatherSize)return {type:'gather',resourceId:'berries',quantity:gatherSize};
  return {type:'wait',minutes:90};
 }
 while(w.minute<from+years*YEAR){const day=Math.floor(w.minute/DAY),child=w.residents.find(p=>p.parents.includes(ids[0]));
  for(const p of w.residents){if(p.status!=='alive'||!p.canDecide||p.plan||p.activity)continue;const action=choice(p,child);if(action.type==='gather'&&(w.resources.find(v=>v.id===action.resourceId)?.amount??0)<action.quantity)queue(p,{type:'wait',minutes:30});else queue(p,action);}
  advance();
  if(day!==priorDay){priorDay=day;for(const p of outsideCandidate(w))assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'隔离夹具选择留在原处',actions:[{type:'stayOutside'}]}).ok);assert.equal(totalCoins(w),expected);assert.ok(w.residents.find(p=>p.id===ids[0]).status==='alive','primary caregiver could not sustain the declared local sources');if(w.minute>birthDue+DAY){assert.ok(child?.status==='alive','childcare failed after the actual birth: '+JSON.stringify({minute:w.minute,due:birthDue,child:child&&{health:child.health,hunger:child.hunger,inside:child.inside,at:child.at},parent:w.residents.find(p=>p.id===ids[0]).lastFailure,events:w.events.slice(-4).map(e=>e.text)}));}}
  if(w.minute>=nextReport){store.commit(w,committed);committed=w.revision;const before=w;w=store.load();assert.equal(w.id,before.id);assert.equal(w.minute,before.minute);assert.equal(totalCoins(w),expected);assert.deepEqual(w.residents.map(p=>p.id),before.residents.map(p=>p.id));assert.equal(w.events.filter(e=>e.kind==='birth').length,1);console.log(JSON.stringify({isolated:true,year:Math.round((w.minute-from)/YEAR),elapsedSeconds:Math.round((performance.now()-start)/1000),life:w.residents.map(p=>({stage:p.lifeStage,status:p.status,health:Math.round(p.health)})),coins:totalCoins(w),births:w.events.filter(e=>e.kind==='birth').length,plans:serial,seedSaved:w.production?.seedSaved??null,restarted:true}));nextReport+=YEAR;}
 }
 const child=w.residents.find(p=>p.parents.includes(ids[0]));assert.ok(child&&child.parents.includes(ids[1]));assert.equal(w.residents.find(p=>p.id===ids[2]).status,'dead');assert.equal(w.residents.find(p=>p.id===ids[2]).deathCause,'oldAge');if(years>=7)assert.equal(child.lifeStage,'child');assert.ok(w.events.some(e=>e.audit?.scope.includes('feed-child')));assert.equal(totalCoins(w),expected);
 if(evidence){const row=evidence.finish(w);if(row)console.log(JSON.stringify({type:'daily-evidence',...row}));}
}finally{store.close();}
