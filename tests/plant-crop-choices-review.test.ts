import assert from 'node:assert/strict';
import {test} from 'node:test';
import {plantCropChoice,restorePlantCropChoice} from '../src/server/plant-crop-choices.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeProduction} from '../src/world/production.js';
import type {DecisionContext} from '../src/shared/types.js';

const plant=(plotId:string,cropId:string):ActionChoice=>({id:`production.plantCrop.${plotId}`,label:`Plant ${plotId} ${cropId}`,action:{type:'production',operation:'plantCrop',plotId,cropId}});
const key=(c:ActionChoice)=>JSON.stringify(c.action);
const reflection=(i:number):ActionChoice=>({id:`reflection.${i}`,label:'Revise goal',action:{type:'agency',operation:'reflect',focus:'family'}});
const move=(i:number):ActionChoice=>({id:`move.${i}`,label:`Move ${i}`,action:{type:'move',to:{x:i,y:0}}});
function context(){
 const w=createFrontierWorld(5423),r=w.residents.find(r=>r.id==='founder-2-1')!;initializeProduction(w);w.minute=1080;
 const p=w.plots.find(p=>p.ownerId===r.id)!;Object.assign(r,{at:{...p.at},inside:null,roomAt:null,plan:null,activity:null,inventory:{seed:3,water:2,turnip:3},agency:undefined});
 return decisionContext(w,r);
}

test('independent review: full plot/crop identities rotate once, ignoring duplicate IDs and input ordering',()=>{
 const c=context(),candidates=[plant('p2','crop/a@2'),plant('p1','crop/b@2'),plant('p1','crop/a@2'),plant('p2','crop/b@2')];
 const all=[...candidates,structuredClone(candidates[0]),move(1)],snapshot=structuredClone(all),seen=new Set<string>();
 for(let i=0;i<12;i++){
  c.minute=1080+30*i;const selected=plantCropChoice(c,all)!;seen.add(key(selected));
  assert.deepEqual(plantCropChoice(c,[...all].reverse())?.action,selected.action);
  assert.deepEqual(plantCropChoice({...c,minute:c.minute+29.99},all)?.action,selected.action);
 }
 assert.equal(seen.size,4);assert.deepEqual(all,snapshot);
 assert.equal(plantCropChoice(c,[move(0)]),undefined);
});

test('independent review: selected variety is restored despite a different same-ID crop being visible',()=>{
 const first=plant('same','crop/a@2'),selected=plant('same','crop/b@2'),before=[first,...Array.from({length:55},(_,i)=>move(i))];
 const after=restorePlantCropChoice(selected,before,56);assert.equal(after.length,57);assert.deepEqual(after.slice(0,56),before);assert.equal(after[56],selected);
 const equivalent={...selected,id:'different-legacy-id'};const visible=[equivalent,...before];
 assert.equal(restorePlantCropChoice(selected,visible,56),visible);
 assert.equal(restorePlantCropChoice(undefined,before,56),before);
});

test('independent review: restoration changes only the last surplus reflection and adds no more than one',()=>{
 const selected=plant('p','crop/a@2');
 for(const length of [0,55,56,59])for(const count of [0,1,2,4]){
  if(count>length)continue;
  const before=[...Array.from({length:length-count},(_,i)=>move(i)),...Array.from({length:count},(_,i)=>reflection(i))],snapshot=structuredClone(before);
  const after=restorePlantCropChoice(selected,before,56),replaces=length>=56&&count>1;
  assert.equal(after.length,length+(replaces?0:1));assert.deepEqual(before,snapshot);
  for(let i=0;i<before.length;i++)if(!replaces||i!==length-1)assert.equal(after[i],before[i]);
  assert.equal(after.at(-1),selected);assert.equal(after.filter(c=>c.action.type==='agency').length,count-(replaces?1:0));
 }
});

test('independent review: saturated menu preserves emergency, refusals, rest, water, cooking and numbered live stops',()=>{
 const c=context();c.actor.hunger=90;
 const critical:ActionChoice[]=[{id:'wait',label:'Rest',action:{type:'wait',minutes:15}},{id:'eat',label:'Eat',action:{type:'eat',item:'meal'}},{id:'refuse',label:'Refuse',action:{type:'respond',proposalId:'incoming',accept:false}},{id:'emergency',label:'Emergency food',action:{type:'emergencyCare',operation:'rescueMeal'}},{id:'waterSource.one',label:'Known water one',action:{type:'move',to:{x:1,y:1}}},{id:'waterSource.two',label:'Known water two',action:{type:'move',to:{x:2,y:2}}},{id:'cook.review',label:'Kitchen',action:{type:'cook',quantity:1,buildingId:'kitchen'}}];
 const controls:ActionChoice[]=Array.from({length:10},(_,i)=>({id:`disarm.${i}`,label:`Stop ${i}`,action:{type:'agency',operation:'disarm',routineId:String(i)}}));
 c.formal!.frontier=true;
 controls.push(...Array.from({length:60},(_,i):ActionChoice=>({id:`draw.${i}`,label:`Design ${i}`,action:{type:'design',operation:'draw',buildingId:String(i),kind:'building'}})));
 const baseline=focusedChoices(c,[...critical,...controls]),p=plant('review-plot','crop/review@2'),after=focusedChoices(c,[...critical,...controls,p]);
 assert.equal(baseline.length,59);assert.equal(after.length,60);assert.deepEqual(after.slice(0,baseline.length),baseline);
 for(const row of critical)assert.ok(after.includes(row),row.id);
 const stop:ActionChoice={id:'care.stop.review',label:'Immediate stop',action:{type:'respond',proposalId:'own-care',accept:false}};
 c.formal!.opportunities=[...critical,...controls,p,stop];const final=decisionChoices(c);
 assert.ok(final.some(c=>c.action.type==='wait'));assert.equal(final.filter(c=>c.action.type==='cook').length,1);
 for(const row of [...critical.filter(c=>c.action.type!=='wait'&&c.action.type!=='cook'),p,stop])assert.ok(final.some(x=>key(x)===key(row)),row.id);
 const selected=final.find(row=>key(row)===key(p))!;assert.deepEqual(parseChoice(JSON.stringify({choice:selected.id}),final).actions,[p.action]);
});

test('independent review: age and journey gates do not recover raw planting and retain allowed stops',()=>{
 const original=context();assert.ok(buildChoices(original).some(c=>c.action.type==='production'&&c.action.operation==='plantCrop'));
 for(const restriction of ['careWithdrawalOnly','expressiveEvacuationOnly','aboard','passenger','familyTravelling','minor','unknown'] as const){
  const c=structuredClone(original),stop:ActionChoice={id:'care.stop.review',label:'Stop current care',action:{type:'respond',proposalId:'own-care',accept:false}};c.formal!.opportunities.push(stop);
  if(restriction==='minor')c.formal!.age=17;else if(restriction==='unknown'){c.formal!.unknownAgeSelfCare=[];c.formal!.knownAge=null;}else c.formal![restriction]=true;
  const before=structuredClone(c),all=buildChoices(c),menu=decisionChoices(c);assert.equal(plantCropChoice(c,all),undefined,restriction);
  assert.ok(!menu.some(c=>c.action.type==='production'&&c.action.operation==='plantCrop'),restriction);
  assert.ok(menu.some(c=>key(c)===key(stop)),restriction);assert.deepEqual(c,before);
 }
 const c=context(),all=[move(1),move(2)];assert.deepEqual(focusedChoices(c,all),all);
 for(const flag of ['passenger','aboard'] as const){const copy=structuredClone(c);copy.formal![flag]=true;assert.equal(focusedChoices(copy,all),all);}
 const informal=structuredClone(c);delete informal.formal;assert.equal(focusedChoices(informal,all),all);
});
