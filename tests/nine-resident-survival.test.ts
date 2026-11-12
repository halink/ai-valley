import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {SURVIVAL_CONTRACT,MEAL_CHANNELS,evaluateSurvivalRecords,survivalSnapshot,type SurvivalHeader,type SurvivalRecord,type SurvivalStep,type SurvivalClose} from './helpers/nine-resident-survival.js';
import {runNineResidentMenuStress} from './helpers/nine-resident-menu-stress.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {persistedWorldFingerprint} from '../src/server/acceptance-offline-protocol.js';

// Unit evaluator data, not a simulation or a claim that this trajectory occurred.
function fixture(){
 const from=480,end=from+21600;
 const header:SurvivalHeader={type:'header',schema:1,executionKind:'offline-scripted-survival-observation',worldId:'synthetic-unit',seed:5401,
  fromMinute:from,endMinute:end,contract:SURVIVAL_CONTRACT,initialFingerprint:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),helperSha256:'c'.repeat(64),
  initial:{at:from,people:Array.from({length:9},(_,i)=>({id:'resident-'+i,name:'合成'+i,status:'alive',health:100,hunger:20,hungerPerMinute:.038}))}};
 const close:SurvivalClose={type:'close',at:end,exception:null,reloaded:true,
  actionCoverage:Object.fromEntries(['exactEndpoint','defaultNine','allNineAte','allNineSlept','share','heardAddressVisit','plant','water','harvest','saveSeed','replant'].map(k=>[k,true])),
  supportCoverage:Object.fromEntries(['giftOffered','giftAccepted','giftDelivered','giftNextEatLinked','commonsInspected','commonsTaken','explorationBackoffUsed'].map(k=>[k,true]))};
 return {header,close};
}
function* records(change?:(row:SurvivalStep,index:number)=>void):Generator<SurvivalRecord>{
 const {header,close}=fixture();yield header;
 for(let i=1;i<=21600;i++){
  const at=header.fromMinute+i;
  const row:SurvivalStep={type:'step',snapshot:{at,people:structuredClone(header.initial.people)},
   food:{worldId:header.worldId,fromMinute:at-1,toMinute:at,receipts:[],...Object.fromEntries(MEAL_CHANNELS.filter(k=>k!=='receipts').map(k=>[k,[]]))}};
  if(i%360===0)for(const p of header.initial.people)row.food.receipts.push({at,residentId:p.id,eventId:`meal:${p.id}:${i}`,planId:`plan:${p.id}:${i}`,container:'person:'+p.id,item:'turnip',quantity:1,nutrition:16,hungerRelief:16});
  change?.(row,i);yield row;
 }
 yield close;
}

test('v1 contract is frozen, deterministic and independent of the old alive-only gate',()=>{
 assert.ok(Object.isFrozen(SURVIVAL_CONTRACT));assert.equal(SURVIVAL_CONTRACT.days,15);
 const a=evaluateSurvivalRecords(records()),b=evaluateSurvivalRecords(records());assert.deepEqual(a,b);
 assert.equal(a.syntheticLongTermSurvivalPassed,true);assert.equal(a.realModelExecuted,false);assert.equal(a.modelAutonomyAcceptancePassed,null);
 assert.equal(a.residents.length,9);assert.equal(a.residents[0].food.nutrition,960);assert.equal(a.residents[0].food.maximumMealGapMinutes,360);
 assert.equal(a.completeFoodLedger,false);assert.equal(a.grossHealthDamage,null);
});

test('all alive with temporary severe health loss and late hunger relief fails, per resident',()=>{
 const r=evaluateSurvivalRecords(records((row,i)=>{
  if(i>=100&&i<=300){row.snapshot.people[2].health=40.497;row.snapshot.people[2].hunger=99;}
 }));
 assert.ok(r.residents.every(p=>p.final.status==='alive'&&p.final.health===100));assert.equal(r.syntheticLongTermSurvivalPassed,false);
 const p=r.residents[2];assert.equal(p.minimumHealth,40.497);assert.equal(p.dangerousHungerMinutes,201);assert.equal(p.longestSustainedHungerMinutes,201);
 assert.ok(p.failures.some(f=>f.code==='health_below_floor'));assert.ok(p.failures.some(f=>f.code==='sustained_hunger'));
 assert.ok(r.residents[0].failures.length===0);
});

test('missing channels remain unknown, never zero food or a pass',()=>{
 const r=evaluateSurvivalRecords(records((row,i)=>{if(i===700)delete row.food.careMeals;}));
 assert.equal(r.gates.coverage,false);assert.equal(r.gates.food,false);
 assert.equal(r.gates.survival,true);assert.equal(r.gates.health,true);assert.equal(r.gates.hunger,true);
 for(const p of r.residents){assert.equal(p.food.nutrition,null);assert.equal(p.food.maximumMealGapMinutes,null);assert.ok(p.failures.some(f=>f.code==='meal_channel_incomplete:careMeals'));}
});

test('missing behavioral coverage does not relabel fully observed healthy survivors as failed health or food',()=>{
 function* missingSupport(){for(const row of records()){if(row.type==='close')row.supportCoverage.commonsTaken=false;yield row;}}
 const r=evaluateSurvivalRecords(missingSupport());
 assert.deepEqual(r.gates,{coverage:false,survival:true,health:true,hunger:true,food:true});
 assert.equal(r.syntheticLongTermSurvivalPassed,false);assert.ok(r.failures.some(f=>f.code==='support_not_covered:commonsTaken'));
});

test('unknown initial physiology remains explicit even when every later sample has the standard rate',()=>{
 function* unknownInitial(){for(const row of records()){const copy=structuredClone(row);if(copy.type==='header')copy.initial.people[0].hungerPerMinute=null;yield copy;}}
 const r=evaluateSurvivalRecords(unknownInitial());
 assert.equal(r.residents[0].initial.hungerPerMinute,null);assert.equal(r.residents[0].final.hungerPerMinute,.038);
 assert.equal(r.gates.coverage,false);assert.equal(r.gates.food,false);assert.equal(r.gates.health,true);
 assert.equal(r.intakeEvidenceComplete,false);assert.ok(r.failures.some(f=>f.code==='unsupported_or_unknown_initial_physiology'&&f.residentId==='resident-0'));
});

test('persistent unknown physiology records a bounded first diagnostic without concealing the failed coverage',()=>{
 const r=evaluateSurvivalRecords(records(row=>{row.snapshot.people[0].hungerPerMinute=null;}));
 assert.equal(r.syntheticLongTermSurvivalPassed,false);assert.equal(r.intakeEvidenceComplete,false);
 const failures=r.failures.filter(f=>f.code==='unsupported_or_unknown_physiology'&&f.residentId==='resident-0');
 assert.equal(failures.length,1);assert.equal(failures[0].at,481);assert.equal(r.residents[0].final.hungerPerMinute,null);
});

test('insufficient individual food cannot be masked by other residents intake or final health',()=>{
 const r=evaluateSurvivalRecords(records(row=>{row.food.receipts=row.food.receipts.filter(m=>m.residentId!=='resident-8');}));
 const p=r.residents[8];assert.equal(p.food.nutrition,0);assert.equal(p.food.maximumMealGapMinutes,21600);
 for(const code of ['nutrition_below_demand','terminal_nutrition_below_demand','meal_gap'])assert.ok(p.failures.some(f=>f.code===code));
 assert.equal(r.residents[0].failures.length,0);assert.equal(r.syntheticLongTermSurvivalPassed,false);
});

test('truncated and historical evidence do not acquire continuous coverage',()=>{
 const {header}=fixture();const partial=evaluateSurvivalRecords([header]);
 assert.equal(partial.syntheticLongTermSurvivalPassed,false);assert.equal(partial.residents[0].dangerousHungerMinutes,null);
 assert.equal(partial.residents[0].food.nutrition,null);assert.ok(partial.failures.some(f=>f.code==='missing_close'));
 const historical=evaluateSurvivalRecords([{scriptedSurvivalPassed:true,final:header.initial.people} as unknown as SurvivalRecord]);
 assert.equal(historical.syntheticLongTermSurvivalPassed,false);assert.ok(historical.failures.some(f=>f.code==='missing_header'));
});

test('frozen hunger after death is not counted as further living hunger exposure',()=>{
 const r=evaluateSurvivalRecords(records((row,i)=>{if(i>=100){row.snapshot.people[0].status='dead';row.snapshot.people[0].health=0;row.snapshot.people[0].hunger=100;}}));
 assert.equal(r.residents[0].dangerousHungerMinutes,1);assert.equal(r.residents[0].longestSustainedHungerMinutes,1);
 assert.equal(r.gates.survival,false);assert.equal(r.syntheticLongTermSurvivalPassed,false);
});

test('observer is non-mutating and enabled evidence preserves one-day v4 decisions and world result',t=>{
 const world=createFrontierWorld(5401),fingerprint=persistedWorldFingerprint(world);
 survivalSnapshot(world);assert.equal(persistedWorldFingerprint(world),fingerprint);
 const plain=runNineResidentMenuStress({days:1}),observed=runNineResidentMenuStress({days:1,survivalEvidence:true});
 t.diagnostic('Unobserved comparison: '+plain.directory);t.diagnostic('Observed comparison: '+observed.directory);
 const scrub=(r:typeof plain)=>{const copy=structuredClone(r);delete (copy as Partial<typeof plain>).directory;delete copy.options.survivalEvidence;return copy;};
 assert.deepEqual(scrub(plain),scrub(observed));
 assert.equal(readFileSync(join(plain.directory,'trace.json'),'utf8'),readFileSync(join(observed.directory,'trace.json'),'utf8'));
 assert.deepEqual(readFileSync(join(plain.directory,'decisions.jsonl.gz')),readFileSync(join(observed.directory,'decisions.jsonl.gz')));
 const lines=gunzipSync(readFileSync(join(observed.directory,'survival-evidence.jsonl.gz'))).toString('utf8').trim().split('\n').map(line=>JSON.parse(line) as SurvivalRecord);
 const verdict=evaluateSurvivalRecords(lines);assert.deepEqual(verdict,JSON.parse(readFileSync(join(observed.directory,'survival-verdict.json'),'utf8')));
 assert.equal(verdict.syntheticLongTermSurvivalPassed,false);assert.ok(verdict.failures.some(f=>f.code==='fifteen_days_required'));
 assert.ok(lines.some(row=>row.type==='step'&&row.food.toMinute-row.food.fromMinute===.25),'fractional sharing step is separately observed');
});
