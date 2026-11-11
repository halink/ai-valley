// Reproducible in-memory benchmark. No model, network, credentials or save file.
// Run: node --import tsx scripts/benchmark-survival.mjs [samples=7] [warmup=2]
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {availableParallelism,cpus} from 'node:os';
import {survivalBenchmarkWorld,survivalScenarios} from '../tests/fixtures/survival-performance.ts';
import {stepWorld,hasTimelySelfRescue} from '../src/world/engine.ts';
import {copyForSimulation} from '../src/world/simulation-copy.ts';
import {decisionContext,decisionChoices} from '../src/server/decisions.ts';

const samples=Number(process.argv[2]??7),warmup=Number(process.argv[3]??2);
assert.ok(Number.isSafeInteger(samples)&&samples>=3&&samples<=20,'samples must be 3–20');
assert.ok(Number.isSafeInteger(warmup)&&warmup>=1&&warmup<=10,'warmup must be 1–10');
const round=n=>Math.round(n*100)/100;
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {min:round(sorted[0]),median:round(sorted[Math.floor(sorted.length/2)]),p95:round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]),max:round(sorted.at(-1))};};
const result={isolated:true,node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,availableParallelism:availableParallelism(),seed:5401,samples,warmup,gameMinutesPerTick:1.2,cases:[]};
for(const scenario of survivalScenarios){
 const world=survivalBenchmarkWorld(scenario),baseline=copyForSimulation(world);
 const initialMenus=world.residents.map(r=>decisionChoices(decisionContext(world,r)).map(c=>c.action));
 const clientCanRescue=hasTimelySelfRescue(world,world.residents[0],initialMenus[0]);
 assert.equal(clientCanRescue,!['no-food-source','service-leaves'].includes(scenario),scenario+' eligibility');
 const tickTimes=[],menuTimes=[],menuCounts=[],baselineTimes=[];
 for(let i=0;i<warmup+samples;i++){
  let menuMs=0,menus=0;
  const started=performance.now();
  stepWorld(world,1.2,{decisionChoices:(w,r)=>{const before=performance.now();const menu=decisionChoices(decisionContext(w,r)).map(c=>c.action);menuMs+=performance.now()-before;menus++;return menu;}});
  const elapsed=performance.now()-started;
  const baselineStart=performance.now();stepWorld(baseline,1.2);const withoutProtection=performance.now()-baselineStart;
  if(i>=warmup){tickTimes.push(elapsed);menuTimes.push(menuMs);menuCounts.push(menus);baselineTimes.push(withoutProtection);}
 }
 // Compare copying alone, outside the full-tick measurement. Both results
 // are independent mutable worlds and must exactly preserve all source data.
 const originalCopies=[],optimizedCopies=[];
 for(let i=0;i<samples;i++){
  let before=performance.now();const ordinary=structuredClone(world);originalCopies.push(performance.now()-before);
  before=performance.now();const optimized=copyForSimulation(world);optimizedCopies.push(performance.now()-before);
  assert.deepEqual(optimized,ordinary);
 }
 assert.equal(world.residents.filter(r=>r.status==='alive').length,9,scenario+' live population');
 const held=world.residents.filter(r=>r.decisionProtection?.endedAt===null).length;
 assert.equal(held,scenario==='service-stays'?1:scenario==='service-leaves'||scenario==='no-food-source'?0:9,scenario+' protection count');
 result.cases.push({scenario,mapTiles:world.map.tiles.length,residents:world.residents.length,initialClientCanRescue:clientCanRescue,protectedResidents:held,
  fullTickMs:stats(tickTimes),menuBuildMs:stats(menuTimes),menuCounts,unprotectedTickMs:stats(baselineTimes),
  ordinaryDeepCopyMs:stats(originalCopies),simulationCopyMs:stats(optimizedCopies)});
}
console.log(JSON.stringify(result,null,2));
