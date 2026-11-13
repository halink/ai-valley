import assert from 'node:assert/strict';
import {test} from 'node:test';

import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceFrontierHazards,initializeFrontierHazards,woundWildBeast} from '../src/world/frontier-hazards.js';
import {createWildBeast} from '../src/world/frontier-wildlife.js';
import {initializePredatorEcology,predatorHabitatCondition,reviewPredatorEcology} from '../src/world/predator-ecology.js';
import {DAY,YEAR} from '../src/world/time.js';
import {distance} from '../src/world/navigation.js';
import {WorldStore} from '../src/server/store.js';

function fixture(kind:'wolf'|'fox'='wolf',paired=true){
 const w=createFrontierWorld(),s=w.frontierHazards!;
 w.map={width:40,height:25,tiles:Array(1000).fill('grass'),name:'isolated predator test',entrance:{x:0,y:0},settlement:{x:30,y:20}};
 w.buildings=[];w.residents=[];w.plots=[];w.resources=[
  {id:'cover-a',kind:'tree',at:{x:5,y:7},amount:20,max:20,regrowthDays:20,lastHarvest:0},
  {id:'cover-b',kind:'tree',at:{x:20,y:7},amount:20,max:20,regrowthDays:20,lastHarvest:0},
  {id:'water',kind:'spring',at:{x:10,y:15},amount:50,max:50,regrowthDays:20,lastHarvest:0},
 ];
 w.industry!.animals=[];w.industry!.mines=[];w.industry!.pastures=[];
 if(w.construction)w.construction.projects=[];w.clock.paused=false;w.events=[];w.minute=480;
 s.beasts=s.beasts.filter(b=>b.species===kind);s.shore=null;s.disasters=[];s.nextDisasterAt=1e12;
 const [mother,sire]=s.beasts;
 const a={id:'test:a',species:kind,at:{x:6,y:10},capacity:3,registered:paired?2:1,born:0,deaths:0,arrived:0,departed:0};
 const b={...a,id:'test:b',at:{x:20,y:10},registered:paired?0:1};
 s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats:[a,b]};
 s.foodPatches=[{id:'food:a',kind:'smallGame',at:{x:7,y:10},amount:12,capacity:12,progress:0},
  {id:'food:b',kind:'smallGame',at:{x:21,y:10},amount:12,capacity:12,progress:0}];
 for(const n of s.beasts){Object.assign(n,{health:100,hunger:20,thirst:20,energy:90,bornAt:w.minute-YEAR,
  at:{...(n===mother||paired?a.at:b.at)},den:{...(n===mother||paired?a.at:b.at)},habitatId:n===mother||paired?a.id:b.id,
  nextMoveAt:1e12,nextMigrationAt:1e12,cooldownUntil:1e12});delete n.alert;delete n.migration;}
 sire.at.x++;mother.sex='female';sire.sex='male';
 return {w,s,mother,sire,a,b};
}
function tick(f:ReturnType<typeof fixture>,minute=f.w.minute+60,elapsed=1){f.w.minute=minute;advanceFrontierHazards(f.w,elapsed);}
function review(f:ReturnType<typeof fixture>,minute=f.w.minute+60){f.w.minute=minute;reviewPredatorEcology(f.w,f.s,createWildBeast);}
function conserved(f:ReturnType<typeof fixture>){
 for(const h of f.s.predatorEcology!.habitats)assert.equal(h.registered+h.born+h.arrived-h.departed-h.deaths,
  f.s.beasts.filter(n=>n.status==='alive'&&n.habitatId===h.id).length);
}

test('only new worlds seed a finite opposite-sex pair for each predator, with no duplicate hydration',()=>{
 const w=createFrontierWorld(),s=w.frontierHazards!;
 for(const kind of ['wolf','fox'])assert.deepEqual(s.beasts.filter(b=>b.species===kind).map(b=>b.sex).sort(),['female','male']);
 const ids=s.beasts.map(b=>b.id);initializeFrontierHazards(w);initializeFrontierHazards(w);
 assert.deepEqual(s.beasts.map(b=>b.id),ids);
 assert.equal(s.predatorEcology!.habitats.length,4);
 assert.ok(s.predatorEcology!.habitats.every(h=>predatorHabitatCondition(w,h).suitable));
});

for(const kind of ['wolf','fox'] as const)test(`${kind} conception, birth and parent nutrition require real conditions and preserve population accounting`,()=>{
 const f=fixture(kind);review(f);const pregnancy=f.mother.pregnancy;
 assert.ok(pregnancy);assert.equal(pregnancy.sireId,f.sire.id);
 const bornBefore=f.s.beasts.length;tick(f,pregnancy.dueAt);
 const baby=f.s.beasts.find(n=>n.motherId===f.mother.id)!;
 assert.ok(baby);assert.equal(f.s.beasts.length,bornBefore+1);assert.equal(baby.sireId,f.sire.id);
 assert.equal(baby.bornAt,f.w.minute);assert.equal(f.a.born,1);assert.equal(f.mother.pregnancy,undefined);
 assert.ok(f.mother.hunger>39);conserved(f);
 const hunger=f.mother.hunger;baby.hunger=45;baby.nextMoveAt=f.w.minute;baby.thirst=20;
 tick(f,f.w.minute+1);assert.ok(f.mother.hunger>hunger+15);assert.ok(baby.hunger<30);
 assert.ok(f.w.events.some(e=>e.animalIds?.includes(baby.id)&&e.animalIds.includes(f.mother.id)&&e.animalIds.includes(f.sire.id)));
 const state=JSON.stringify(f.s);advanceFrontierHazards(f.w,1);assert.equal(JSON.stringify(f.s),state,'same-minute replay is inert');
});

const rejections:Record<string,(f:ReturnType<typeof fixture>)=>void>={
 'same sex':f=>{f.sire.sex='female';},
 'juvenile mate':f=>{f.sire.bornAt=f.w.minute;},
 'dead mate':f=>{woundWildBeast(f.w,f.sire.id,100);},
 'sick mother':f=>{f.mother.disease={since:f.w.minute,severity:30,cause:'stress'};},
 'hungry mother':f=>{f.mother.hunger=80;},
 'thirsty mother':f=>{f.mother.thirst=90;},
 'winter':f=>{f.w.minute=90*DAY;},
 'full den':f=>{f.a.capacity=2;},
 'food exhausted':f=>{for(const p of f.s.foodPatches)p.amount=0;},
 'water exhausted':f=>{f.w.resources.find(r=>r.kind==='spring')!.amount=0;},
 'cover destroyed':f=>{for(const r of f.w.resources.filter(r=>r.kind==='tree'))r.amount=0;},
 'mate across barrier':f=>{f.sire.at={x:8,y:10};for(let y=0;y<25;y++)f.w.map.tiles[y*40+7]='water';},
 'active flood':f=>{f.s.disasters.push({id:'flood',kind:'flashFlood',at:{...f.a.at},radius:2,phase:'active',warningAt:0,startsAt:0,endsAt:1e9,intensity:20,warned:[],exposure:{}});},
};
for(const [reason,change] of Object.entries(rejections))test(`predator conception rejects ${reason}`,()=>{
 const f=fixture();change(f);review(f);assert.equal(f.mother.pregnancy,undefined);assert.equal(f.a.born,0);
});

test('pregnancy reserves the last slot, and unsuitable births end rather than remaining indefinitely overdue',()=>{
 const f=fixture();const second={...f.mother,id:'second-mother',at:{x:6,y:11},pregnancy:undefined};
 f.s.beasts.push(second);f.a.registered++;f.a.capacity=4;review(f);
 assert.equal(f.s.beasts.filter(b=>b.pregnancy).length,1);
 const due=f.mother.pregnancy!.dueAt;
 f.w.resources.find(r=>r.kind==='spring')!.amount=0;
 review(f,due);assert.ok(f.mother.pregnancy);assert.equal(f.a.born,0);
 review(f,due+DAY);assert.equal(f.mother.pregnancy,undefined);assert.equal(f.a.born,0);conserved(f);
 assert.ok(f.w.events.some(e=>e.text.includes('孕育')&&e.text.includes('终止')));
});

test('a surviving pregnancy can deliver after sire death, but the dead mother cannot produce young',()=>{
 const f=fixture();review(f);woundWildBeast(f.w,f.sire.id,100);tick(f,f.mother.pregnancy!.dueAt);
 assert.equal(f.a.born,1);conserved(f);
 const g=fixture();review(g);const due=g.mother.pregnancy!.dueAt;woundWildBeast(g.w,g.mother.id,100);tick(g,due);
 assert.equal(g.a.born,0);assert.equal(g.mother.pregnancy,undefined);conserved(g);
});

test('existing opposite-sex individuals meet through finite tile-by-tile migration with no new identities',()=>{
 const f=fixture('fox',false),ids=f.s.beasts.map(b=>b.id);f.mother.nextMigrationAt=0;f.mother.nextMoveAt=f.w.minute;
 review(f);assert.ok(f.mother.migration);assert.equal(f.a.departed,0);const start={...f.mother.at};
 tick(f,f.w.minute+1);assert.equal(distance(start,f.mother.at),1);assert.equal(f.mother.habitatId,f.a.id);
 for(let i=0;i<30&&f.mother.migration;i++){const previous={...f.mother.at};tick(f,f.w.minute+8);assert.ok(distance(previous,f.mother.at)<=1);}
 assert.equal(f.mother.migration,undefined);assert.equal(f.mother.habitatId,f.b.id);
 assert.deepEqual(f.s.beasts.map(b=>b.id),ids);assert.equal(f.a.departed,1);assert.equal(f.b.arrived,1);conserved(f);
 review(f);assert.ok(f.mother.pregnancy);
 assert.ok(f.w.events.some(e=>e.text.includes('沿用原个体身份')&&e.animalIds?.includes(f.mother.id)));
});

for(const change of ['barrier','food','water','cover','space'] as const)test(`migration stops safely when destination ${change} changes`,()=>{
 const f=fixture('wolf',false);f.mother.nextMigrationAt=0;f.mother.nextMoveAt=f.w.minute;review(f);assert.ok(f.mother.migration);
 tick(f,f.w.minute+1);const position={...f.mother.at};
 if(change==='barrier')for(let y=0;y<25;y++)f.w.map.tiles[y*40+13]='water';
 if(change==='food')for(const p of f.s.foodPatches)p.amount=0;
 if(change==='water')f.w.resources.find(r=>r.kind==='spring')!.amount=0;
 if(change==='cover')for(const r of f.w.resources.filter(r=>r.kind==='tree'))r.amount=0;
 if(change==='space')f.b.capacity=1;
 tick(f,f.w.minute+8);assert.equal(f.mother.migration,undefined);assert.deepEqual(f.mother.at,position);
 assert.equal(f.mother.habitatId,f.a.id);assert.equal(f.a.departed,0);assert.equal(f.b.arrived,0);conserved(f);
});

test('migration at its destination counts once, and an in-progress move survives a real store round-trip',()=>{
 const f=fixture('fox',false);f.mother.nextMigrationAt=0;f.mother.nextMoveAt=f.w.minute;review(f);tick(f,f.w.minute+1);
 const store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const saved=store.load()!;assert.ok(saved);
  const mother=saved.frontierHazards!.beasts.find(b=>b.id===f.mother.id)!;
  assert.deepEqual(mother.migration,f.mother.migration);assert.deepEqual(mother.at,f.mother.at);
  mother.at={...f.b.at};mother.nextMoveAt=saved.minute;saved.minute++;advanceFrontierHazards(saved,1);
  assert.equal(mother.migration,undefined);assert.equal(saved.frontierHazards!.predatorEcology!.habitats[1].arrived,1);
  advanceFrontierHazards(saved,1);assert.equal(saved.frontierHazards!.predatorEcology!.habitats[1].arrived,1);
 }finally{store.close();}
});

test('disease mortality during migration clears reservations, and healthy feeding does not erase disease damage',()=>{
 const f=fixture('wolf',false);f.mother.nextMigrationAt=0;f.mother.nextMoveAt=f.w.minute;review(f);
 f.mother.disease={since:f.w.minute,severity:100,cause:'stress'};f.mother.health=.001;
 tick(f,f.w.minute+1);assert.equal(f.mother.status,'dead');assert.equal(f.mother.deathCause,'disease');
 assert.equal(f.mother.migration,undefined);assert.equal(f.a.deaths,1);conserved(f);
 tick(f,f.w.minute+60);assert.equal(f.a.deaths,1);
 const g=fixture();g.mother.disease={since:g.w.minute,severity:50,cause:'stress'};g.mother.health=80;
 tick(g,g.w.minute+60,60);assert.ok(g.mother.health<80);
});

test('sustained contact causes wildlife disease only across reachable ground and recovery is recorded',()=>{
 const f=fixture();f.sire.disease={since:f.w.minute,severity:70,cause:'stress'};f.mother.diseaseExposure=2*DAY-1;
 tick(f,f.w.minute+1);assert.equal(f.mother.disease?.sourceId,f.sire.id);
 const g=fixture();g.sire.at={x:8,y:10};for(let y=0;y<25;y++)g.w.map.tiles[y*40+7]='water';
 g.sire.disease={since:g.w.minute,severity:70,cause:'stress'};g.mother.diseaseExposure=2*DAY-1;
 tick(g,g.w.minute+1);assert.equal(g.mother.disease,undefined);
 f.mother.disease!.severity=.0001;tick(f,f.w.minute+1);assert.equal(f.mother.disease,undefined);
 assert.ok(f.w.events.some(e=>e.animalIds?.includes(f.mother.id)&&e.text.includes('疾病已恢复')));
});

test('extinct predators and depleted small-game pools stay extinct across seasons and old-save upgrades',()=>{
 const f=fixture();for(const b of f.s.beasts)woundWildBeast(f.w,b.id,100);
 for(const p of f.s.foodPatches){p.amount=0;p.progress=99;}
 for(let season=1;season<=5;season++){tick(f,season*28*DAY);initializeFrontierHazards(f.w);}
 assert.equal(f.s.beasts.filter(b=>b.status==='alive').length,0);
 assert.ok(f.s.foodPatches.every(p=>p.amount===0&&p.progress===0));conserved(f);
 const restored=JSON.parse(JSON.stringify(f.w));delete restored.frontierHazards.predatorEcology;delete restored.frontierHazards.ecologyVersion;
 const ids=restored.frontierHazards.beasts.filter((b:{species:string})=>b.species==='wolf').map((b:{id:string})=>b.id);
 initializeFrontierHazards(restored);initializeFrontierHazards(restored);
 assert.ok(restored.frontierHazards.predatorEcology,'the upgrade really executed');
 assert.deepEqual(restored.frontierHazards.beasts.filter((b:{species:string})=>b.species==='wolf').map((b:{id:string})=>b.id),ids);
 assert.equal(restored.frontierHazards.beasts.filter((b:{species:string,status:string})=>['wolf','fox'].includes(b.species)&&b.status==='alive').length,0);
});

test('mixed disease and deprivation record the actual fatal damage rather than guessing from co-occurrence',()=>{
 const f=fixture();f.mother.hunger=100;f.mother.health=.02;
 f.mother.disease={since:f.w.minute,severity:1,cause:'stress'};tick(f,f.w.minute+1);
 assert.equal(f.mother.deathCause,'starvation');conserved(f);
 const g=fixture();g.mother.thirst=100;g.mother.health=.02;
 g.mother.disease={since:g.w.minute,severity:1,cause:'stress'};tick(g,g.w.minute+1);
 assert.equal(g.mother.deathCause,'thirst');conserved(g);
});

test('metadata upgrade preserves legacy identity, alert, pregnancy, depleted food and absence of males',()=>{
 const f=fixture();f.s.beasts=[f.mother];delete f.s.predatorEcology;
 f.mother.alert={residentId:'old-target',attackAt:700};f.mother.pregnancy={dueAt:9000,sireId:'historical-sire'};
 f.s.foodPatches[0].amount=0;const before={at:{...f.mother.at},id:f.mother.id,alert:{...f.mother.alert},pregnancy:{...f.mother.pregnancy}};
 initializePredatorEcology(f.w,f.s,createWildBeast);initializePredatorEcology(f.w,f.s,createWildBeast);
 assert.equal(f.s.beasts.length,1);assert.equal(f.s.beasts[0].sex,'female');assert.equal(f.s.foodPatches[0].amount,0);
 for(const key of ['at','id','alert','pregnancy'] as const)assert.deepEqual(f.mother[key],before[key]);
});

test('natural ten-day wildlife progression produces finite offspring and migrations while needs keep running',()=>{
 const w=createFrontierWorld(),s=w.frontierHazards!;w.clock.paused=false;w.residents=[];w.industry!.animals=[];s.nextDisasterAt=1e12;
 const isPredator=(species:string)=>species==='wolf'||species==='fox';
 const original=s.beasts.filter(b=>isPredator(b.species)).map(b=>b.id);
 for(let minute=0;minute<10*DAY;minute++){
  const positions=new Map(s.beasts.filter(b=>isPredator(b.species)&&b.status==='alive').map(b=>[b.id,{...b.at}]));
  w.minute++;advanceFrontierHazards(w,1);
  for(const b of s.beasts.filter(b=>isPredator(b.species))){const previous=positions.get(b.id);if(previous)assert.ok(distance(previous,b.at)<=1);}
 }
 const habitats=s.predatorEcology!.habitats;
 assert.ok(habitats.some(h=>h.born>0),'ordinary movement and needs still allow a real pregnancy to reach birth');
 assert.ok(habitats.some(h=>h.arrived>0));
 assert.equal(original.length+habitats.reduce((n,h)=>n+h.born-h.deaths,0),s.beasts.filter(b=>isPredator(b.species)&&b.status==='alive').length);
 for(const id of original)assert.ok(s.beasts.some(b=>b.id===id),'dead and living founders retain their identities');
 for(const h of habitats)assert.equal(h.registered+h.born+h.arrived-h.departed-h.deaths,s.beasts.filter(b=>b.status==='alive'&&b.habitatId===h.id).length);
});
