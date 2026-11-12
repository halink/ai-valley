import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {berryApproachPath} from '../src/world/berry-observation.js';
import {initializeFood} from '../src/world/food.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {visibleBerryObservationNote,MAX_VISIBLE_BERRY_OBSERVATIONS} from '../src/server/visible-berry-observation.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL,modelLimits} from '../src/server/model-completion.js';
import type {Resource,World,Resident} from '../src/shared/types.js';
function fixture(){
 const w=createWorld(5401),r=w.residents[0];w.mode='formal';w.clock.paused=false;
 w.map={width:80,height:64,tiles:Array(80*64).fill('grass'),entrance:{x:1,y:1},name:'independent berry review'};
 w.buildings=[];w.plots=[];w.graves=[];w.residents=[r];
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{},knownBuildings:[],knownResources:['berry'],knownPeople:[],hunger:90,health:100,energy:100,memories:[]});
 const patch:Resource={id:'berry',kind:'bush',at:{x:22,y:20},amount:.5,max:12,regrowthDays:4,lastHarvest:w.minute};w.resources=[patch];initializeFood(w);
 return {w,r,patch};
}
test('independent: current context is detached; hidden berry changes do not alter final messages',()=>{
 const cases:Record<string,(w:World,r:Resident)=>void>={indoor:(_w,r)=>{r.inside='room';},unknown:(_w,r)=>{r.knownResources=[];},far:w=>{w.resources[0].at={x:40,y:20};},blocked:w=>{w.map.tiles[20*80+21]='cliff';}};
 for(const [name,setup] of Object.entries(cases)){
  const {w,r,patch}=fixture();setup(w,r);const c=decisionContext(w,r);assert.equal(c.resources.length,0,name);
  const before=prepareModelDecision(c,undefined,GLM_MODEL);patch.amount=12;
  assert.deepEqual(prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),before,name);
 }
 const {w,r,patch}=fixture(),c=decisionContext(w,r),before=structuredClone(c);
 patch.amount=12;patch.at.x=25;assert.deepEqual(c,before);
});
test('independent: projection cannot reveal excluded resources or regrowth machinery and does not mutate',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);const before=structuredClone(c),note=visibleBerryObservationNote(c,[]);
 assert.ok(note);assert.deepEqual(c,before);
 c.resources[0].max=987654321;c.resources[0].lastHarvest=876543210;c.resources[0].regrowthDays=765432109;
 assert.equal(visibleBerryObservationNote(c,[]),note);
 c.resources[0].kind='spring';assert.equal(visibleBerryObservationNote(c,[]),'');
 c.resources=[];assert.equal(visibleBerryObservationNote(c,[{id:'1',label:'unknown target',action:{type:'gather',resourceId:'missing',quantity:3}}]),'');
});
test('independent: invalid current quantity is unknown, never converted to empty or numeric stock',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);c.resources[0].amount=0;const empty=visibleBerryObservationNote(c,[]);
 for(const value of [undefined,null,NaN,Infinity,-1]){
  c.resources[0].amount=value as number;const note=visibleBerryObservationNote(c,[]);
  assert.notEqual(note,empty);assert.match(note,/未知/);assert.doesNotMatch(note,/NaN|Infinity|null|undefined/);
 }
});
test('independent: bounded deterministic list prioritizes gather targets and then distance/id',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r),base=c.resources[0];
 c.resources=Array.from({length:7},(_,i)=>({...base,id:`b${i}`,at:{x:21+i,y:20},amount:i+1}));
 const target=c.resources[6],choices=[{id:'1',label:'gather target',action:{type:'gather' as const,resourceId:target.id,quantity:3}}];
 const note=visibleBerryObservationNote(c,choices);assert.equal(MAX_VISIBLE_BERRY_OBSERVATIONS,4);
 for(const i of [6,0,1,2])assert.ok(note.includes(`(${21+i},20)`),`included b${i}`);
 for(const i of [3,4,5])assert.ok(!note.includes(`(${21+i},20)`),`omitted b${i}`);
 assert.ok(note.indexOf('(27,20)')<note.indexOf('(21,20)'));assert.match(note,/未展开|省略/);
 c.resources.reverse();assert.equal(visibleBerryObservationNote(c,choices),note);
 // Equal distance positions differ so an ID tie-break can be observed without exposing IDs.
 c.resources=[{...base,id:'z',at:{x:19,y:20}},{...base,id:'a',at:{x:21,y:20}}];
 const tied=visibleBerryObservationNote(c,[]);assert.ok(tied.indexOf('(21,20)')<tied.indexOf('(19,20)'));
});
test('independent: final input preserves observation and numbered choices under family-note pressure',()=>{
 for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){
  const {w,r}=fixture(),c=decisionContext(w,r);const baseline=prepareModelDecision(c,undefined,model);
  c.formal!.familyNotes='综'.repeat(40000);
  // Large inventory text forces trimming of family notes without itself exhausting the hard budget.
  (c.actor.inventory as Record<string,number>)['x'.repeat(modelLimits[model].inputBytes-10000)]=1;
  const result=prepareModelDecision(c,undefined,model),note=visibleBerryObservationNote(c,result.choices);
  assert.ok(result.messages[0].content.includes(note));assert.deepEqual(result.choices,baseline.choices);
  assert.ok(result.inputBytes<=modelLimits[model].inputBytes);
  for(const choice of result.choices)assert.ok(result.messages[0].content.includes(`${choice.id}. ${choice.label}`));
  (c.actor.inventory as Record<string,number>)['y'.repeat(modelLimits[model].inputBytes)]=1;
  assert.throws(()=>prepareModelDecision(c,undefined,model),/model_context_limit/);
 }
});

test('independent: visible but unreachable berries remain observations, not possessed food or promises',()=>{
 const {w,r,patch}=fixture();patch.amount=12;patch.at={x:24,y:20};
 for(let y=0;y<64;y++)w.map.tiles[y*80+22]='water';
 const c=decisionContext(w,r);assert.equal(c.resources.length,1);assert.equal(berryApproachPath(w,r.at,patch),null);
 const before=structuredClone(c),note=visibleBerryObservationNote(c,[]);
 assert.match(note,/看见不等于能接触/);assert.match(note,/不计入本人已有口粮/);assert.deepEqual(c,before);
 const prepared=prepareModelDecision(c,undefined,GLM_MODEL);
 patch.amount=0;r.at={x:60,y:20};
 assert.deepEqual(prepareModelDecision(c,undefined,GLM_MODEL),prepared,'reusing an old snapshot cannot refresh remote world stock');
 assert.equal(visibleBerryObservationNote(decisionContext(w,r),[]),'');
});
