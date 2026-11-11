import assert from 'node:assert/strict';
import {test} from 'node:test';
import {knownLandChoice,restoreKnownLandChoice} from '../src/server/known-land-choices.js';
import {decisionChoices,decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {buildChoices,type ActionChoice} from '../src/server/affordances.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {createWorld} from '../src/world/seed.js';
import {YEAR} from '../src/world/time.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import type {DecisionContext} from '../src/shared/types.js';

function fixture(){
 const w=createWorld(),r=w.residents[0];w.mode='formal';w.minute=480;
 w.map={width:60,height:60,tiles:Array(3600).fill('grass'),entrance:{x:0,y:0},name:'Independent synthetic review'};
 w.residents=[r];w.resources=[];w.buildings=[];w.graves=[];w.events=[];w.offers=[];w.proposals=[];
 Object.assign(r,{at:{x:5,y:20},inside:null,roomAt:null,homeId:null,inventory:{water:2,meal:2},knownBuildings:[],knownResources:[],knownPeople:[],memories:[],hunger:20,energy:100,health:100,plan:null,activity:null,agency:undefined,bornAt:w.minute-30*YEAR});
 w.plots=[{id:'p-a',at:{x:25,y:20},ownerId:r.id,crop:null},{id:'p-b',at:{x:30,y:20},ownerId:r.id,crop:null}];
 return {w,r,c:decisionContext(w,r)};
}
const destination=(c:DecisionContext)=>knownLandChoice(c)?.action;

test('complete identity does not collapse reused IDs at different addresses and duplicate input adds no weight',()=>{
 const {c}=fixture();c.knownLand=[{id:'shared',at:{x:20,y:20}},{id:'shared',at:{x:30,y:20}}];
 const before=structuredClone(c),seen=new Set<string>();
 for(let i=0;i<4;i++){c.minute=i*30;seen.add(JSON.stringify(destination(c)));const duplicated=structuredClone(c);duplicated.knownLand.push(...duplicated.knownLand);assert.deepEqual(destination(duplicated),destination(c));}
 assert.equal(seen.size,2);assert.deepEqual(c.knownLand,before.knownLand);
});
test('invalid minute and invalid actor address never fabricate a destination',()=>{
 for(const minute of [NaN,Infinity,-1]){const {c}=fixture();c.minute=minute;assert.equal(destination(c),undefined);}
 for(const at of [{x:NaN,y:2},{x:-1,y:2},{x:60,y:2},{x:1.5,y:2}]){const {c}=fixture();c.actor.at=at;assert.equal(destination(c),undefined);}
});
test('exclusion uses current location before rotation across a long complete cycle',()=>{
 const {c}=fixture();c.knownLand.unshift({id:'current',at:{...c.actor.at}},{id:'bad',at:{x:-1,y:0}});
 const seen=new Set<string>();for(let i=0;i<40;i++){c.minute=30*i;seen.add(JSON.stringify(destination(c)));}
 assert.equal(seen.size,2);
});
test('restoration changes only a surplus reflection and never the sole reflection or protected non-reflection',()=>{
 const {c}=fixture(),field=knownLandChoice(c)!;
 const reflect=(id:string):ActionChoice=>({id,label:id,action:{type:'agency',operation:'reflect',focus:'daily',text:'synthetic'}});
 const protectedRows:ActionChoice[]=[{id:'wait',label:'wait',action:{type:'wait',minutes:1}},{id:'stop',label:'stop',action:{type:'health',operation:'cancelRescue',offerId:'synthetic'}}];
 const original=[...protectedRows,reflect('r1'),reflect('r2')],before=structuredClone(original);
 assert.deepEqual(restoreKnownLandChoice(field,original,4),[...protectedRows,original[2],field]);assert.deepEqual(original,before);
 const sole=[...protectedRows,reflect('only')];assert.deepEqual(restoreKnownLandChoice(field,sole,3),[...sole,field]);
 assert.deepEqual(restoreKnownLandChoice(field,[...sole,field],3),[...sole,field]);
});
test('dead and outside titles are excluded and no permission is restored from an empty pre-filtered menu',()=>{
 for(const change of [{status:'dead'},{residency:'outside'},{canDecide:false},{canExpress:false}]){
  const {w,r}=fixture();Object.assign(r,change);const c=decisionContext(w,r);assert.deepEqual(c.knownLand,[]);assert.equal(knownLandChoice(c),undefined);
 }
 const {c}=fixture();assert.ok(knownLandChoice(c));assert.deepEqual(focusedChoices(c,[]),[]);
});
test('actual decision preparation neither mutates source world nor reveals remote crop fields',()=>{
 const {w,r}=fixture();const before=structuredClone(w);const ready=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);assert.deepEqual(w,before);
 w.plots[0].crop={definition:'crop/turnip@1',planted:-999,growth:999,wateredDay:999,lastGrowthDay:999};
 assert.deepEqual(prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),ready);
});
test('field recovery respects each pre-existing movement filter and does not re-synthesize a removed source row',()=>{
 for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','familyTravelling','passenger','aboard'] as const){
  const {c}=fixture();c.formal![flag]=true;assert.ok(!decisionChoices(c).some(x=>x.label.includes('已知的田地')));
 }
 const {c}=fixture(),all=buildChoices(c),field=knownLandChoice(c)!;
 const removed=all.filter(x=>x.id!==field.id);assert.ok(!focusedChoices(c,removed).some(x=>x.id===field.id));
});
