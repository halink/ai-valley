import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {IndustryAction,Livestock,Pasture} from '../src/shared/industry.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {industryTarget,initializeIndustry} from '../src/world/industry.js';
import {livestockShareBreedingPlace} from '../src/world/livestock-life.js';
import {findPath,same,walkable} from '../src/world/navigation.js';
import {createWorld} from '../src/world/seed.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(5491);w.mode='formal';w.clock.paused=false;w.minute=600;w.weather='sun';
 w.map={...w.map,width:40,height:28,tiles:Array(40*28).fill('grass'),entrance:{x:1,y:1}};
 w.resources=[];w.plots=[];w.graves=[];
 const owner=w.residents[0];w.residents=[owner];
 const barn={...w.buildings[0],id:'review-breeding-barn',kind:'barn' as const,definition:'building/barn@1',at:{x:2,y:2},width:6,height:4,door:{x:5,y:6},condition:100,residents:[],ownerId:owner.id};
 w.buildings=[barn];Object.assign(owner,{at:{x:10,y:13},inside:null,roomAt:null,homeId:null,bornAt:w.minute-25*YEAR,health:100,energy:100,hunger:0,inventory:{meal:20,water:20,fodder:20},plan:null,activity:null,knownBuildings:[barn.id],knownResources:[]});
 initializeIndustry(w);
 const yard:Pasture={id:'review-breeding-yard',barnId:barn.id,tiles:Array.from({length:24},(_,i)=>({x:10+i%6,y:12+Math.floor(i/6)})),forage:40,capacity:96,lastMinute:w.minute};
 const mother:Livestock={id:'review-mother',ownerId:owner.id,definition:'industry/processes@1',kind:'goat',sex:'female',bornAt:w.minute-70*DAY,barnId:barn.id,pastureId:yard.id,at:{x:10,y:13},inside:null,pen:0,hunger:20,thirst:20,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute,energy:85};
 const sire:Livestock={...mother,id:'review-selected-sire',sex:'male',at:{x:15,y:14},pen:1};
 w.industry!.animals=[mother,sire];w.industry!.pastures=[yard];
 return {w,owner,barn,yard,mother,sire};
}
type Fixture=ReturnType<typeof fixture>;
function action(f:Fixture):IndustryAction{return {type:'industry',operation:'breedAnimal',animalId:f.mother.id,partnerId:f.sire.id};}
function indoors(f:Fixture,n:Livestock){delete n.at;delete n.pastureId;delete n.inside;delete n.roomAt;}
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const breeding=(f:Fixture)=>industryOpportunities(f.w,f.owner).filter(c=>c.action.type==='industry'&&c.action.operation==='breedAnimal'&&c.action.animalId===f.mother.id);

test('independent breeding review: a pasture location with unknown coordinates is not an implicit barn pen',()=>{
 const f=fixture();delete f.mother.at;delete f.sire.at;f.sire.pastureId='another-registered-pasture';
 assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
 assert.ok(industryTarget(f.w,f.owner,action(f)).error);assert.equal(breeding(f).length,0);
});

test('independent breeding review: separated same-yard animals use the existing enclosure abstraction without movement or mutation',()=>{
 const f=fixture();const before=JSON.stringify(f.w);freeze(f.w);
 assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),true);
 assert.equal(JSON.stringify(f.w),before);assert.deepEqual(f.mother.at,{x:10,y:13});assert.deepEqual(f.sire.at,{x:15,y:14});
});

test('independent breeding review: a winding in-yard connection survives roads and duplicate tiles but not a real barrier',()=>{
 const f=fixture();
 f.yard.tiles=[{x:10,y:12},{x:10,y:13},{x:10,y:14},...Array.from({length:6},(_,i)=>({x:10+i,y:15})),{x:15,y:14},{x:15,y:13},{x:15,y:12}];
 f.mother.at={x:10,y:12};f.sire.at={x:15,y:12};f.yard.tiles.push({...f.yard.tiles[0]});
 for(const at of f.yard.tiles)f.w.map.tiles[at.y*f.w.map.width+at.x]='road';
 assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),true);
 f.w.map.tiles[15*f.w.map.width+12]='cliff';assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
 f.w.map.tiles[15*f.w.map.width+12]='road';assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),true);
});

test('independent breeding review: legacy barn pens remain compatible but contradictory interiors and transfer destinations do not',()=>{
 const f=fixture();indoors(f,f.mother);indoors(f,f.sire);
 assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),true);
 f.sire.inside='somewhere-else';assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
 f.sire.inside=f.barn.id;f.sire.at={x:f.barn.door.x+1,y:f.barn.door.y};assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
 f.sire.at={...f.barn.door};assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),true);
 f.sire.destinationId=f.barn.id;assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
});

test('independent breeding review: retained expired pastures differ from retired places and unusable endpoints',()=>{
 const f=fixture();f.yard.status='expired';assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),true);
 f.yard.status='retired';assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
 f.yard.status='open';f.w.map.tiles[f.sire.at!.y*f.w.map.width+f.sire.at!.x]='water';assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
 f.w.map.tiles[f.sire.at!.y*f.w.map.width+f.sire.at!.x]='grass';f.barn.condition=0;assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
});

test('independent breeding review: unknown barns and someone else’s male do not appear as breeding partners',()=>{
 const f=fixture();f.owner.knownBuildings=[];assert.equal(breeding(f).length,0);
 f.owner.knownBuildings=[f.barn.id];f.sire.ownerId='another-owner';assert.equal(breeding(f).length,0);
 const later:Livestock={...f.sire,id:'owned-later-sire',ownerId:f.owner.id,at:{...f.sire.at!},pen:2};f.w.industry!.animals.push(later);
 const choices=breeding(f);assert.equal(choices.length,1);
 const selected=choices[0].action as IndustryAction;assert.equal(selected.partnerId,later.id);
 assert.ok(!JSON.stringify(choices).includes(f.sire.id));assert.equal(f.mother.pregnancy,null);
});

for(const interruption of ['death','transfer'] as const)test(`independent breeding review: real completion after selected male ${interruption} fails instead of substituting a living alternative`,()=>{
 const f=fixture();indoors(f,f.mother);indoors(f,f.sire);f.owner.at={...f.barn.door};
 const other:Livestock={...f.sire,id:'not-selected-sire',pen:2};f.w.industry!.animals.push(other);
 const selected=breeding(f)[0].action as IndustryAction;assert.equal(selected.partnerId,f.sire.id);
 assert.ok(submitPlan(f.w,{id:'review-'+interruption,actorId:f.owner.id,actorRevision:f.owner.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'Synthetic selected-pair review',actions:[selected]}).ok);
 let guard=120;
 while(!f.owner.activity||f.owner.activity.remaining>1){assert.ok(guard-->0);stepWorld(f.w,1);}
 if(interruption==='death'){f.sire.status='dead';f.sire.deathAt=f.w.minute;}else f.sire.destinationId=f.barn.id;
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,owner=w.residents.find(n=>n.id===f.owner.id)!,mother=w.industry!.animals.find(n=>n.id===f.mother.id)!;
  assert.equal((owner.activity!.action as IndustryAction).partnerId,f.sire.id);stepWorld(w,1);
  assert.equal(mother.pregnancy,null);assert.ok(owner.lastFailure);assert.equal(w.metrics.requests,0);
  assert.ok(!w.events.some(e=>e.animalIds?.includes(mother.id)&&e.text.includes('决定让')&&e.text.includes('繁育')));
 }finally{store.close();}
});

test('independent breeding review: an old pregnancy survives location rejection and births once through real fractional ticks after reload',()=>{
 const f=fixture();f.mother.pregnancy={sireId:'historical-sire-no-longer-in-world',dueAt:f.w.minute+.5};
 f.sire.destinationId=f.barn.id;assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),false);
 const original=structuredClone(f.mother.pregnancy),store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,mother=w.industry!.animals.find(n=>n.id===f.mother.id)!;
  stepWorld(w,.25);assert.deepEqual(mother.pregnancy,original);assert.equal(w.industry!.animals.length,2);
  stepWorld(w,.25);const babies=w.industry!.animals.filter(n=>n.motherId===mother.id);assert.equal(babies.length,1);
  assert.equal(babies[0].sireId,original.sireId);assert.equal(babies[0].bornAt,original.dueAt);assert.equal(mother.pregnancy,null);
  stepWorld(w,.25);assert.equal(w.industry!.animals.filter(n=>n.motherId===mother.id).length,1);
  assert.equal(w.metrics.requests,0);
 }finally{store.close();}
});

test('independent breeding review: same-minute terrain changes invalidate both a new menu and a previously selected action',()=>{
 const f=fixture(),minute=f.w.minute,selected=breeding(f)[0].action as IndustryAction;
 assert.equal(industryTarget(f.w,f.owner,selected).error,undefined);
 for(let y=12;y<=15;y++)f.w.map.tiles[y*f.w.map.width+12]='cliff';
 assert.equal(breeding(f).length,0);assert.ok(industryTarget(f.w,f.owner,selected).error);
 for(let y=12;y<=15;y++)f.w.map.tiles[y*f.w.map.width+12]='grass';
 assert.equal(breeding(f).length,1);assert.equal(industryTarget(f.w,f.owner,selected).error,undefined);
 const rock={id:'same-minute-endpoint-rock',kind:'rock' as const,at:{...f.sire.at!},amount:1,max:1,regrowthDays:0,lastHarvest:0};f.w.resources.push(rock);
 assert.equal(breeding(f).length,0);assert.ok(industryTarget(f.w,f.owner,selected).error);
 rock.amount=0;assert.equal(breeding(f).length,1);assert.equal(industryTarget(f.w,f.owner,selected).error,undefined);
 assert.equal(f.w.minute,minute);assert.equal(selected.partnerId,f.sire.id);assert.equal(f.mother.pregnancy,null);
});

test('independent breeding review: same-minute movement and transfer changes affect new choices without replacing the accepted partner',()=>{
 const f=fixture(),other:Livestock={...f.sire,id:'same-minute-alternate',at:{x:14,y:14},pen:2};f.w.industry!.animals.push(other);
 const selected=breeding(f)[0].action as IndustryAction,minute=f.w.minute,original={...f.sire.at!};assert.equal(selected.partnerId,f.sire.id);
 f.sire.at={x:20,y:13};assert.equal((breeding(f)[0].action as IndustryAction).partnerId,other.id);assert.ok(industryTarget(f.w,f.owner,selected).error);
 f.sire.at=original;assert.equal((breeding(f)[0].action as IndustryAction).partnerId,f.sire.id);assert.equal(industryTarget(f.w,f.owner,selected).error,undefined);
 f.sire.carrierId='synthetic-carrier';assert.equal((breeding(f)[0].action as IndustryAction).partnerId,other.id);assert.ok(industryTarget(f.w,f.owner,selected).error);
 f.sire.carrierId=null;f.mother.destinationId=f.barn.id;assert.equal(breeding(f).length,0);assert.ok(industryTarget(f.w,f.owner,selected).error);
 f.mother.destinationId=null;assert.equal(breeding(f).length,1);assert.equal(industryTarget(f.w,f.owner,selected).error,undefined);
 assert.equal(selected.partnerId,f.sire.id);assert.equal(f.w.minute,minute);assert.equal(f.mother.pregnancy,null);
});

test('independent breeding review: same-minute pasture retirement and barn failure cannot reuse an earlier location match',()=>{
 const f=fixture(),selected=breeding(f)[0].action as IndustryAction,minute=f.w.minute;
 f.yard.status='retired';assert.equal(breeding(f).length,0);assert.ok(industryTarget(f.w,f.owner,selected).error);
 f.yard.status='expired';assert.equal(breeding(f).length,1);assert.equal(industryTarget(f.w,f.owner,selected).error,undefined);
 f.barn.condition=0;assert.equal(breeding(f).length,0);assert.ok(industryTarget(f.w,f.owner,selected).error);
 f.barn.condition=100;assert.equal(breeding(f).length,1);assert.equal(industryTarget(f.w,f.owner,selected).error,undefined);
 assert.equal(f.w.minute,minute);
});

test('independent breeding review: local breadth-first connectivity matches bounded navigation over varied small pasture terrain',()=>{
 const f=fixture();let random=713;
 for(let sample=0;sample<80;sample++){
  for(const at of f.yard.tiles){random=(Math.imul(random,1664525)+1013904223)>>>0;f.w.map.tiles[at.y*f.w.map.width+at.x]=random%7===0?'cliff':random%7===1?'water':random%7===2?'road':'grass';}
  const cells=new Set(f.yard.tiles.map(at=>at.x+','+at.y));
  const expected=walkable(f.w,f.mother.at!)&&walkable(f.w,f.sire.at!)&&findPath(f.w,f.mother.at!,f.sire.at!,false,cells.size-1,(_from,to)=>f.yard.tiles.some(at=>same(at,to)))!==null;
  assert.equal(livestockShareBreedingPlace(f.w,f.mother,f.sire),expected,'sample '+sample);
 }
});
