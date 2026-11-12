import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {IndustryAction,Livestock,Pasture} from '../src/shared/industry.js';
import type {Vec} from '../src/shared/types.js';
import {initializeIndustry} from '../src/world/industry.js';
import {distance,same,walkable} from '../src/world/navigation.js';
import {advancePastures} from '../src/world/pasture.js';
import {createWorld} from '../src/world/seed.js';
import {DAY} from '../src/world/time.js';

// These independent tests isolate the pasture tick. Full-world stepping,
// numbered delivery and SQLite continuation are covered by the primary suite.
function fixture(){
 const w=createWorld(5449),person=structuredClone(w.residents[0]);
 w.mode='formal';w.minute=600;w.weather='sun';w.residents=[];w.resources=[];w.plots=[];w.graves=[];
 w.map={...w.map,width:20,height:16,tiles:Array(20*16).fill('grass'),entrance:{x:1,y:1}};
 w.buildings=[{...w.buildings[0],id:'review-barn',kind:'barn',definition:'building/barn@1',at:{x:1,y:1},width:4,height:2,door:{x:3,y:3},residents:[]}];
 initializeIndustry(w);
 const yard:Pasture={id:'review-yard',barnId:'review-barn',tiles:Array.from({length:24},(_,i)=>({x:3+i%6,y:5+Math.floor(i/6)})),forage:50,capacity:96,lastMinute:w.minute,
  trough:{at:{x:8,y:6},water:1,capacity:8,delivered:1,consumed:0}};
 const goat:Livestock={id:'review-goat',ownerId:person.id,kind:'goat',sex:'female',bornAt:-30*DAY,barnId:yard.barnId,pastureId:yard.id,at:{x:3,y:6},inside:null,pen:0,hunger:30,thirst:80,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute,energy:85};
 w.industry!.pastures=[yard];w.industry!.animals=[goat];
 return {w,person,yard,goat};
}
type Fixture=ReturnType<typeof fixture>;
function advance(f:Fixture,minutes=1){
 for(let minute=0;minute<minutes;minute++){
  const before={...f.goat.at!};f.w.minute++;advancePastures(f.w);
  assert.ok(distance(before,f.goat.at!)<=1,'no teleporting between pasture cells');
  assert.ok(f.yard.tiles.some(t=>same(t,f.goat.at!)),'all autonomous steps stay in this yard');
  if(!same(before,f.goat.at!))assert.ok(walkable(f.w,f.goat.at!,before),'each actual step remains physically walkable');
  assert.ok(!f.w.industry!.animals.some(n=>n!==f.goat&&n.status==='alive'&&!n.inside&&n.at&&same(n.at,f.goat.at!)),'no animal overlap');
  assert.ok(f.yard.trough!.water>=0);assert.ok(Math.abs(f.yard.trough!.water+f.yard.trough!.consumed-f.yard.trough!.delivered)<1e-9);
 }
}
function untilDrink(f:Fixture,limit=150){
 const before=f.yard.trough!.water;
 for(let i=0;i<limit&&f.yard.trough!.water===before;i++)advance(f);
 assert.ok(f.yard.trough!.water<before,'an available contact cell must eventually be reached');
 assert.ok(distance(f.goat.at!,f.yard.trough!.at)<=1);assert.ok(f.goat.thirst<80);
}
function restingAnimal(f:Fixture,id:string,at:Vec){
 const animal:Livestock={...f.goat,id,at:{...at},pen:f.w.industry!.animals.length,thirst:0,energy:0,activity:{kind:'rest',reason:'Independent synthetic obstruction'}};
 f.w.industry!.animals.push(animal);return animal;
}
function reserve(f:Fixture,at:Vec,animalId='other-animal'){
 const action:IndustryAction={type:'industry',operation:'moveAnimal',pastureId:f.yard.id,animalId,at:{...at}};
 f.person.activity={action,planId:'review-transfer',startedAt:f.w.minute,remaining:99,path:[],target:{...at},definition:'action/routine@1'};
 f.w.residents=[f.person];return action;
}

test('independent water review: a reserved delivery cell is avoided without altering the resident action',()=>{
 const f=fixture(),reserved={x:4,y:6};reserve(f,reserved);
 const action=structuredClone(f.person.activity);
 for(let i=0;i<150&&f.yard.trough!.consumed===0;i++){advance(f);assert.notDeepEqual(f.goat.at,reserved);}
 assert.ok(f.yard.trough!.consumed>0);assert.deepEqual(f.person.activity,action);
 assert.equal(f.w.metrics.requests,0);
});

test('independent water review: every occupied contact cell blocks drinking until a real vacancy appears',()=>{
 const f=fixture();
 const occupants=[{x:7,y:6},{x:8,y:5},{x:8,y:7}].map((at,i)=>restingAnimal(f,'contact-'+i,at));
 restingAnimal(f,'trough-occupant',f.yard.trough!.at);
 advance(f,90);assert.equal(f.yard.trough!.water,1);assert.equal(f.goat.thirst,80);assert.equal(f.goat.lastCaredAt,undefined);
 occupants[0].inside=f.yard.barnId;
 untilDrink(f);assert.deepEqual(f.goat.at,{x:7,y:6});assert.notDeepEqual(f.goat.at,f.yard.trough!.at);
});

test('independent water review: a newly reserved contact tile reroutes to a different contact without stealing water',()=>{
 const f=fixture();f.goat.at={x:6,y:6};advance(f);assert.deepEqual(f.goat.at,{x:6,y:6});
 assert.equal(f.goat.activity?.kind,'drink');assert.equal(f.yard.trough!.water,1);
 // A destination is reserved after the first search, before the next movement
 // boundary. No animal, resource, position or clock is reset.
 reserve(f,{x:7,y:6});
 untilDrink(f);assert.notDeepEqual(f.goat.at,{x:7,y:6});assert.ok(distance(f.goat.at!,f.yard.trough!.at)<=1);
});

test('independent water review: diagonal proximity, movement cadence and first contact remain distinct',()=>{
 const f=fixture();f.goat.at={x:7,y:5};advance(f,14);
 assert.deepEqual(f.goat.at,{x:7,y:5});assert.equal(f.yard.trough!.water,1);assert.equal(f.goat.thirst,80);
 advance(f);assert.equal(distance(f.goat.at!,f.yard.trough!.at),1);assert.equal(f.yard.trough!.water,1);
 advance(f);assert.ok(Math.abs(f.yard.trough!.water-.97)<1e-9);assert.equal(f.goat.lastCaredAt,616);
 const once=JSON.stringify(f.w.industry);advancePastures(f.w);assert.equal(JSON.stringify(f.w.industry),once);
});

test('independent water review: contact across another actual fence is not enough to drink',()=>{
 const f=fixture();f.goat.at={x:7,y:6};
 // A legacy inconsistent overlap is deliberate defensive coverage. It is not
 // presented as a pasture that the normal land-registration flow can create.
 f.w.industry!.pastures!.push({id:'overlap',barnId:f.yard.barnId,tiles:[{x:8,y:6}],forage:0,capacity:0,lastMinute:f.w.minute,
  fenced:true,gate:{inside:{x:8,y:6},outside:{x:8,y:7}},fence:{condition:100,lastMinute:f.w.minute,woodUsed:0,repairs:0}});
 assert.equal(walkable(f.w,f.yard.trough!.at,f.goat.at),false);
 advance(f,1);assert.equal(f.yard.trough!.water,1);assert.equal(f.goat.thirst,80);assert.equal(f.goat.lastCaredAt,undefined);
});

test('independent water review: a neighboring yard and an unregistered animal cannot use the wrong trough',()=>{
 const f=fixture();f.goat.at={x:8,y:6};f.yard.trough!.water=0;f.yard.trough!.delivered=0;
 const foreign:Pasture={...f.yard,id:'foreign-yard',tiles:[{x:9,y:6},{x:10,y:6}],trough:{at:{x:9,y:6},water:2,capacity:8,delivered:2,consumed:0}};
 f.w.industry!.pastures!.push(foreign);advance(f,30);
 assert.equal(f.goat.thirst,80);assert.equal(foreign.trough!.water,2);assert.equal(foreign.trough!.consumed,0);
 f.yard.trough!.water=1;f.yard.trough!.delivered=1;f.goat.at={x:7,y:6};delete f.goat.pastureId;
 advance(f,10);assert.equal(f.yard.trough!.water,1);assert.equal(f.goat.thirst,80);
});

test('independent water review: route updates when an actual rock appears and disappears',()=>{
 const f=fixture();f.yard.tiles=Array.from({length:6},(_,i)=>({x:3+i,y:6}));
 const rock={id:'route-rock',kind:'rock' as const,at:{x:5,y:6},amount:1,max:1,regrowthDays:0,lastHarvest:0};f.w.resources=[rock];
 advance(f,45);assert.ok(f.goat.at!.x<5);assert.equal(f.yard.trough!.water,1);assert.equal(f.goat.thirst,80);
 rock.amount=0;untilDrink(f);assert.equal(rock.amount,0);
});

test('independent water review: interaction suppresses autonomous drinking and departure from a contact cell',()=>{
 const f=fixture();f.goat.at={x:7,y:6};reserve(f,f.goat.at,f.goat.id);
 const before={...f.goat.at};advance(f,30);assert.deepEqual(f.goat.at,before);assert.equal(f.yard.trough!.water,1);assert.equal(f.goat.thirst,80);
 f.person.activity=null;advance(f);assert.ok(f.yard.trough!.water<1);assert.ok(f.goat.thirst<80);
});

test('independent water review: night and expired status retain drinking, while retired status stops it',()=>{
 const f=fixture();f.w.minute=22*60;f.yard.lastMinute=f.w.minute;f.goat.at={x:7,y:6};f.yard.status='expired';
 advance(f);assert.equal(f.goat.activity?.kind,'drink');assert.ok(f.yard.trough!.water<1);
 f.yard.status='retired';const water=f.yard.trough!.water,goat=structuredClone(f.goat);advance(f,30);
 assert.equal(f.yard.trough!.water,water);assert.deepEqual(f.goat,goat);
});
