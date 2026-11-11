import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {visibleOwnPlots,cropObservation} from '../src/world/crop-observation.js';
import {cropObservationNote,MAX_CROP_OBSERVATIONS} from '../src/server/crop-observation.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {productionOpportunities} from '../src/server/production-opportunities.js';
import {initializeProduction} from '../src/world/production.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {DAY} from '../src/world/time.js';
function fixture(){
 const w=createWorld(),r=w.residents[0];w.minute=DAY+480;w.weather='sun';
 w.map={width:60,height:60,tiles:Array(3600).fill('grass'),entrance:{x:0,y:0},name:'review synthetic'};
 w.residents=[r];w.resources=[];w.buildings=[];w.graves=[];w.events=[];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{water:0},knownBuildings:[],knownResources:[],knownPeople:[],memories:[],hunger:20,energy:100,health:100,activity:null});
 w.plots=[{id:'review-field',at:{x:22,y:20},ownerId:r.id,crop:{definition:'crop/turnip@1',planted:0,growth:1,wateredDay:-1,lastGrowthDay:0}}];
 return {w,r,p:w.plots[0]};
}
const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);

test('review: hidden crop mutations cannot affect real final model input',()=>{
 const cases:Record<string,(w:World,r:Resident)=>void>={
  indoor:(_w,r)=>{r.inside='unobserved-room';},outside:(_w,r)=>{r.residency='outside';},
  roomCoordinate:(_w,r)=>{r.roomAt={x:1,y:1};},noDecision:(_w,r)=>{r.canDecide=false;},
  dead:(_w,r)=>{r.status='dead';},offMap:(_w,r)=>{r.at={x:-1,y:20};},
  far:(w)=>{w.plots[0].at={x:29,y:20};},otherOwner:w=>{w.plots[0].ownerId='someone-else';},
  sleeping:(_w,r)=>{r.activity={planId:'sleep',action:{type:'sleep',minutes:60},startedAt:0,remaining:60,path:[],target:{...r.at},definition:'action/routine@1'};},
  aboard:w=>{w.ferries={trips:[{aboard:[w.residents[0].id]}]} as World['ferries'];},
  blocked:w=>{w.map.tiles[20*60+21]='cliff';},
 };
 for(const [name,setup] of Object.entries(cases)){
  const {w,r,p}=fixture();setup(w,r);assert.equal(visibleOwnPlots(w,r).length,0,name);
  const before=prepared(w,r);p.crop!.wateredDay=Math.floor(w.minute/DAY);p.crop!.growth=4;
  assert.deepEqual(prepared(w,r).messages,before.messages,name);
 }
});

test('review: diagonal sight cannot pass either solid corner flank',()=>{
 for(const [x,y] of [[21,20],[20,21],[22,21],[21,22]]){
  const {w,r,p}=fixture();p.at={x:22,y:22};w.map.tiles[y*60+x]='cliff';
  assert.deepEqual(visibleOwnPlots(w,r),[],`corner ${x},${y}`);
 }
});

test('review: eight-tile Manhattan boundary and normal ground movement remain observable',()=>{
 const {w,r,p}=fixture();p.at={x:24,y:24};assert.equal(visibleOwnPlots(w,r).length,1);
 p.at={x:25,y:24};assert.equal(visibleOwnPlots(w,r).length,0);
 p.at={x:22,y:20};r.activity={planId:'walk-to-bed',action:{type:'sleep',minutes:60},startedAt:0,remaining:60,path:[{x:21,y:20}],target:{x:30,y:20},definition:'action/routine@1'};
 assert.equal(visibleOwnPlots(w,r).length,1);
});

test('review: snapshot is detached and serializing final prompt omits raw crop internals',()=>{
 const {w,r,p}=fixture();const c=decisionContext(w,r),before=structuredClone(c);
 p.crop!.growth=4;p.crop!.wateredDay=1;p.at.x=25;
 assert.deepEqual(c,before);
 const text=prepareModelDecision(c,undefined,GLM_MODEL).messages[0].content;
 for(const hidden of ['crop/turnip@1','wateredDay','lastGrowthDay','planted'])assert.ok(!text.includes(hidden),hidden);
 assert.match(text,/今日未浇水/);assert.ok(!prepared(w,r).choices.some(c=>c.action.type==='water'));
});

test('review: fixed definition controls maturity and active definition cannot rewrite an existing field',()=>{
 const {w,r,p}=fixture();w.mode='formal';initializeProduction(w);
 w.definitions['crop/review@1']={id:'crop/review',version:1,kind:'recipe',dependencies:[],data:{growthDays:6,seasons:['winter'],name:'DO_NOT_SERIALIZE',yield:18}};
 w.definitions['crop/review@2']={...w.definitions['crop/review@1'],version:2,data:{growthDays:1,seasons:['spring'],name:'CHANGED',yield:2}};
 w.activeDefinitions['crop/review']='crop/review@2';p.crop!.definition='crop/review@1';p.crop!.growth=5;
 assert.equal(cropObservation(w,p).stage,'growing');assert.equal(cropObservation(w,p).inSeason,false);
 assert.match(cropObservationNote(decisionContext(w,r),[]),/当前季节不适合生长/);
 p.crop!.growth=6;const note=cropObservationNote(decisionContext(w,r),[]);
 assert.match(note,/已成熟/);assert.doesNotMatch(note,/当前季节不适合生长|DO_NOT_SERIALIZE|CHANGED/);
 w.mode='formal';assert.ok(productionOpportunities(w,r).some(c=>c.action.type==='harvest'&&c.action.plotId===p.id));
});

test('review: observation is bounded, stable and includes targeted plots without family-note capacity',()=>{
 const {w,r,p}=fixture();w.plots=[];
 for(let i=0;i<12;i++)w.plots.push({...structuredClone(p),id:`p${i}`,at:{x:20+i%4,y:21+Math.floor(i/4)}});
 const c=decisionContext(w,r),target=c.plots[c.plots.length-1];
 const choices=[{id:'chosen',label:'review',action:{type:'water' as const,plotId:target.id}}];
 const note=cropObservationNote(c,choices);
 assert.equal((note.match(/本人田\(/g)??[]).length,MAX_CROP_OBSERVATIONS);
 assert.ok(note.includes(`本人田(${target.at.x},${target.at.y})`));assert.equal(cropObservationNote(c,choices),note);
 c.formal={age:30,opportunities:[],familyNotes:'x'.repeat(40000)};
 assert.match(prepareModelDecision(c,undefined,GLM_MODEL).messages[0].content,/亲眼看到的田况/);
 c.minute++;assert.equal(cropObservationNote(c,choices),'');
});

test('review: raining is not a watering record, and day labels use absolute days',()=>{
 const {w,r,p}=fixture();w.minute=57*DAY+480;w.weather='rain';p.crop!.wateredDay=1;
 const note=cropObservationNote(decisionContext(w,r),[]);
 assert.match(note,/今日未浇水/);assert.match(note,/眼前正在下雨/);assert.match(note,/未来天气未知/);
 p.crop!.wateredDay=57;assert.equal(cropObservation(w,p).wateredToday,true);
});

test('review: multiple crop definitions cannot starve the default crop watering candidate',()=>{
 const {w,r,p}=fixture();r.inventory.water=1;const q=structuredClone(p);q.id='nearer-other-crop';q.at.x=21;q.crop!.definition='crop/review@1';
 w.definitions['crop/review@1']={id:'crop/review',version:1,kind:'recipe',dependencies:[],data:{growthDays:6,seasons:['spring']}};w.plots.unshift(q);
 assert.ok(prepared(w,r).choices.some(c=>c.action.type==='water'&&c.action.plotId===p.id));
});

test('review: production menu respects the same blocked-field visibility with water available',()=>{
 for(const mode of ['indoor','outside','sleeping','aboard','wall']){
  const {w,r,p}=fixture();w.mode='formal';initializeProduction(w);r.inventory={water:2};
  p.crop!.definition='crop/turnip-summer@1';
  // Synthetic fixed recipe avoids relying on installed production crop names.
  w.definitions[p.crop!.definition]={id:'crop/turnip-summer',version:1,kind:'recipe',dependencies:[],data:{growthDays:6,seasons:['spring'],yield:12}};
  if(mode==='indoor')r.inside='room';if(mode==='outside')r.residency='outside';
  if(mode==='sleeping')r.activity={planId:'sleep',action:{type:'sleep',minutes:60},startedAt:0,remaining:60,path:[],target:{...r.at},definition:'action/routine@1'};
  if(mode==='aboard')w.ferries={trips:[{aboard:[r.id]}]} as World['ferries'];
  if(mode==='wall')w.map.tiles[20*60+21]='cliff';
  const before=productionOpportunities(w,r);p.crop!.growth=6;p.crop!.wateredDay=1;
  assert.deepEqual(productionOpportunities(w,r),before,mode);
  assert.ok(!before.some(c=>'plotId'in c.action&&c.action.plotId===p.id),mode);
 }
});


test('review: real formal final messages hide blocked crop changes and orchard planting candidates',()=>{
 const {w,r,p}=fixture();w.mode='formal';initializeForeignTrade(w);initializeIndustry(w);initializeProduction(w);
 r.inventory={water:2,sapling:1,seed:2};
 const treeChoice=()=>prepared(w,r).choices.some(c=>c.action.type==='industry'&&c.action.operation==='plantTree'&&c.action.plotId===p.id);
 p.crop=null;assert.equal(treeChoice(),true,'positive control: visible empty plot offers planting');
 w.map.tiles[20*60+21]='cliff';assert.equal(treeChoice(),false);
 const empty=prepared(w,r);p.crop={definition:'crop/turnip@1',planted:0,growth:1,wateredDay:-1,lastGrowthDay:0};
 const dry=prepared(w,r);p.crop.growth=4;p.crop.wateredDay=1;const mature=prepared(w,r);
 assert.deepEqual(empty.messages,dry.messages);assert.deepEqual(dry.messages,mature.messages);
 assert.deepEqual(empty.choices,mature.choices);
});
