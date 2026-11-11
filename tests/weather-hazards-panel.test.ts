import assert from 'node:assert/strict';
import {test} from 'node:test';
import {weatherHazardsPanel} from '../src/client/weather-hazards.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';

test('weather observer is read-only and does not initialize missing state or enable hazards',()=>{
 const w=createWorld();delete w.frontierHazards;
 const before=JSON.stringify(w),html=weatherHazardsPanel(w);
 assert.equal(JSON.stringify(w),before);assert.match(html,/新预警：未启用/);assert.doesNotMatch(html,/data-action|data-command|input|select/);
});

test('weather observer escapes records and does not invent legacy weather evidence',()=>{
 const w=createWorld();w.mode='formal';w.scenario='frontier';w.map.settlement={x:35,y:32};initializeFrontierHazards(w);
 w.frontierHazards!.disasters=[{id:'<danger>',kind:'flashFlood',at:{x:3,y:3},radius:5,phase:'warning',warningAt:0,startsAt:90,endsAt:180,intensity:20,warned:[],exposure:{}}];
 w.events.push({id:'e',at:w.minute,kind:'hazard',actors:[],witnesses:[],place:{x:3,y:3},text:'<script>unsafe</script>',hazardFact:{disasterId:'<danger>',phase:'damage',targetId:'<target>',before:100,after:80}});
 const before=JSON.stringify(w),html=weatherHazardsPanel(w);
 assert.equal(JSON.stringify(w),before);assert.match(html,/未补造天气证据/);assert.match(html,/&lt;danger&gt;/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;target&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/100 → 80/);
});

test('weather observer shows recorded footprint and blocked versus cleared springs without refilling',()=>{
 const w=createWorld();w.mode='formal';w.scenario='frontier';w.map.settlement={x:35,y:32};initializeFrontierHazards(w);
 w.frontierHazards!.disasters=[{id:'f',kind:'flashFlood',at:{x:3,y:3},radius:5,footprint:[{x:3,y:3},{x:3,y:4}],phase:'active',warningAt:0,startsAt:90,endsAt:180,intensity:20,warned:[],exposure:{}}];
 w.resources.push({id:'spring:test',kind:'spring',at:{x:4,y:3},amount:2,max:20,regrowthDays:1,lastHarvest:0,floodDamage:{disasterId:'f',at:90,clearedAt:null}});
 const before=JSON.stringify(w);let html=weatherHazardsPanel(w);
 assert.equal(JSON.stringify(w),before);assert.match(html,/已记录影响 2 格/);assert.match(html,/淤塞，停止安全取水/);assert.match(html,/现有 2 \/ 20 份/);
 w.resources.at(-1)!.floodDamage!.clearedAt=w.minute;html=weatherHazardsPanel(w);assert.match(html,/已实际清理/);assert.match(html,/现有 2 \/ 20 份/);
});

test('weather observer reports finite occupied capacity and escaped building names without allocating shelter',()=>{
 const w=createWorld(),b=w.buildings[0],r=w.residents[0];
 b.name='<unsafe building>';b.ownerId='commons';b.condition=100;b.capacity=1;b.residents=[r.id];r.inside=b.id;
 const before=JSON.stringify(w),html=weatherHazardsPanel(w);
 assert.equal(JSON.stringify(w),before);assert.match(html,/&lt;unsafe building&gt;/);assert.match(html,/占用及既有预留 1 \/ 容量 1/);assert.match(html,/不保证能安全抵达/);
});
