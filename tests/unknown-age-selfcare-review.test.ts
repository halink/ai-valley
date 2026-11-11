import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {ageAllowsAction} from '../src/world/family.js';
import {submitPlan,stepWorld,hasTimelySelfRescue} from '../src/world/engine.js';
import {residentBed,roomLayout} from '../src/shared/rooms.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';

function fixture(birth:unknown=undefined){
 const w=createFrontierWorld();w.frontierHazards=undefined;w.scenario=undefined;w.clock.paused=false;
 for(const p of w.residents){p.lastDecisionAt=w.minute;p.decisionDue=w.minute+1000;p.hunger=10;p.energy=90;p.health=100;}
 const r=w.residents[0];r.bornAt=birth as number;r.canDecide=r.canExpress=true;r.inventory={meal:2};r.hunger=80;
 const b=w.buildings.find(b=>b.id===r.homeId)!;const bed=residentBed(w,r,b);assert.notEqual(bed,null);
 r.at={...b.door};r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:'+bed)!.at};
 return {w,r,b};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r)).map(c=>c.action);
function choose(w:World,r:Resident,action:Action){return submitPlan(w,{id:'review:'+w.minute+':'+r.revision,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人有限自理',actions:[action]});}

for(const [name,birth] of [['missing',undefined],['null',null],['NaN',NaN],['infinite',Infinity],['negative infinite',-Infinity],['numeric string','0'],['boolean',false],['object',{}],['unsafe',Number.MAX_SAFE_INTEGER+1]] as const){
 test(`review selfcare: ${name} grants own food and real bed, not new rights`,()=>{
  const {w,r}=fixture(birth);menu(w,r);const before=structuredClone(w),actions=menu(w,r);
  assert.ok(actions.some(a=>a.type==='eat'));assert.ok(actions.some(a=>a.type==='sleep'));assert.ok(actions.some(a=>a.type==='wait'));
  assert.ok(actions.every(a=>['eat','sleep','wait','move'].includes(a.type)),JSON.stringify(actions));
  assert.deepEqual(w,before,'menu must not repair records or mutate assets');
  assert.equal(ageAllowsAction(w,r,{type:'eat',item:'meal'}),true);
  assert.equal(choose(w,r,{type:'eat',item:'meal'}).ok,true);stepWorld(w,5.25);
  assert.equal(r.inventory.meal,1);assert.ok(r.hunger<80);assert.deepEqual(r.bornAt,birth);
 });
}
for(const age of [0,5,6-1e-8,6,18])test(`review selfcare: known ${age} preserves six-year boundary`,()=>{
 const {w,r}=fixture();r.bornAt=w.minute-age*YEAR;
 assert.equal(ageAllowsAction(w,r,{type:'eat',item:'meal'}),age>=6);
 assert.equal(choose(w,r,{type:'eat',item:'meal'}).ok,age>=6);
});
for(const action of [{type:'cook',quantity:1},{type:'gather',resourceId:'x',quantity:1},{type:'industry',operation:'shoreRest'},{type:'commons',operation:'takeFood',buildingId:'x'},{type:'agency',operation:'reflect',text:'x'},{type:'production',operation:'emergencyEstateRation',estateId:'x'},{type:'waterSupply',operation:'drinkPublic',buildingId:'x'}] as Action[]){
 test(`review selfcare: unknown does not gain ${action.type} authority`,()=>{const {w,r}=fixture();assert.equal(ageAllowsAction(w,r,action),false);assert.equal(choose(w,r,action).ok,false);});
}
for(const change of ['infant','no expression','no decision','outside','food removed'] as const)test(`review selfcare: live ${change} cancels pending meal without nutrition`,()=>{
 const {w,r}=fixture();assert.equal(choose(w,r,{type:'eat',item:'meal'}).ok,true);stepWorld(w,4.75);assert.ok(r.activity);
 if(change==='infant')r.bornAt=w.minute;
 if(change==='no expression')r.canExpress=false;
 if(change==='no decision')r.canDecide=false;
 if(change==='outside')r.residency='outside';
 if(change==='food removed')r.inventory={};
 const hunger=r.hunger,stock={...r.inventory};stepWorld(w,.25);
 assert.deepEqual(r.inventory,stock);assert.ok(r.hunger>=hunger);assert.equal(r.activity,null);assert.equal(r.plan,null);
});
for(const change of ['infant','no expression','lost residence','destroyed bed','forgotten home'] as const)test(`review selfcare: ${change} ends sleep before energy recovery`,()=>{
 const {w,r,b}=fixture();r.energy=20;assert.equal(choose(w,r,{type:'sleep',minutes:30}).ok,true);stepWorld(w,.25);assert.ok(r.activity);
 if(change==='infant')r.bornAt=w.minute;
 if(change==='no expression')r.canExpress=false;
 if(change==='lost residence')b.residents=b.residents.filter(id=>id!==r.id);
 if(change==='destroyed bed')b.capacity=0;
 if(change==='forgotten home')r.knownBuildings=r.knownBuildings.filter(id=>id!==b.id);
 const baseline=structuredClone(w),other=baseline.residents.find(p=>p.id===r.id)!;other.activity=null;other.plan=null;stepWorld(baseline,.25);stepWorld(w,.25);assert.ok(r.energy<=other.energy);assert.equal(r.activity,null);
});
for(const invalid of ['no food','no expression','infant'] as const)test(`review selfcare: rescue forecast rejects ${invalid} even with injected meal choice`,()=>{
 const {w,r}=fixture();r.hunger=98;r.health=1;r.energy=80;
 if(invalid==='no food')r.inventory={};if(invalid==='no expression')r.canExpress=false;if(invalid==='infant')r.bornAt=w.minute;
 const before=structuredClone(w);assert.equal(hasTimelySelfRescue(w,r,[{type:'eat',item:'meal'}]),false);assert.deepEqual(w,before);
});
test('review selfcare: capable unknown own meal rescue is real and read-only',()=>{
 const {w,r}=fixture();r.hunger=98;r.health=1;r.energy=80;const actions=menu(w,r),before=structuredClone(w);
 assert.equal(hasTimelySelfRescue(w,r,actions),true);assert.deepEqual(w,before);
});
test('review selfcare: future birth becoming a known infant before meal completion cancels it',()=>{
 const {w,r}=fixture();r.bornAt=w.minute+2;assert.equal(choose(w,r,{type:'eat',item:'meal'}).ok,true);stepWorld(w,5.25);assert.equal(r.inventory.meal,2);assert.ok(r.hunger>=80);assert.equal(r.activity,null);
});

test('review selfcare: unknown can move on an actual path and obeys a newly blocked next step',()=>{
 const {w,r}=fixture();r.inside=null;r.roomAt=null;r.at={x:2,y:2};w.map.tiles=w.map.tiles.map(()=> 'grass');
 assert.equal(choose(w,r,{type:'move',to:{x:7,y:2}}).ok,true);stepWorld(w,.25);assert.ok(r.activity);
 const next=r.activity.path[0];assert.ok(next);w.map.tiles[next.y*w.map.width+next.x]='cliff';const at={...r.at};
 stepWorld(w,2);assert.deepEqual(r.at,at);assert.equal(r.activity,null);
});
test('review selfcare: unknown completes ordinary short movement',()=>{
 const {w,r}=fixture();r.inside=null;r.roomAt=null;r.at={x:2,y:2};w.map.tiles=w.map.tiles.map(()=> 'grass');
 assert.equal(choose(w,r,{type:'move',to:{x:4,y:2}}).ok,true);stepWorld(w,10);assert.deepEqual(r.at,{x:4,y:2});assert.equal(r.activity,null);
});
test('review selfcare: queued selfcare must recheck expression before it starts',()=>{
 const {w,r}=fixture();assert.equal(choose(w,r,{type:'eat',item:'meal'}).ok,true);r.canExpress=false;stepWorld(w,6);assert.equal(r.inventory.meal,2);assert.equal(r.activity,null);assert.equal(r.plan,null);
});
test('review selfcare: real own bed restores energy without creating rights or inventory',()=>{
 const {w,r,b}=fixture();r.energy=20;const residents=[...b.residents],inventory={...r.inventory};
 assert.equal(choose(w,r,{type:'sleep',minutes:10}).ok,true);stepWorld(w,10.25);assert.ok(r.energy>20);assert.deepEqual(b.residents,residents);assert.deepEqual(r.inventory,inventory);
});

for(const kind of ['commons','residential'] as const)test(`review selfcare: existing ${kind} bed is usable but expiry stops sleep`,()=>{
 const {w,r,b}=fixture();const other=w.buildings.find(p=>p.kind==='home'&&p.id!==b.id)!;
 other.residents=[];other.capacity=1;other.condition=100;r.homeId=null;r.knownBuildings.push(other.id);
 if(kind==='commons'){
  other.kind='lodge';other.ownerId='commons';w.commons??={version:1,adoptedAt:w.minute,stays:[],receipts:[]};w.commons.stays.push({id:'review-stay',residentId:r.id,buildingId:other.id,bed:0,startedAt:w.minute,expiresAt:w.minute+3,endedAt:null,reason:null});
 }else{
  (w.economy!.leases??=[]).push({id:'review-lease',buildingId:other.id,ownerId:other.ownerId!,tenantId:r.id,terms:{station:'bed',days:1,rentPerDay:0,deposit:0,startMinute:0,durationMinutes:1440},offeredAt:w.minute,offerExpiresAt:w.minute+10,acceptedAt:w.minute,endsAt:w.minute+3,status:'active',endedAt:null,reason:null,account:'review',prepaid:0,paid:0,refunded:0});
 }
 r.at={...other.door};r.inside=other.id;r.roomAt={...roomLayout(w,other).slots.find(s=>s.key==='bed:0')!.at};r.energy=20;
 assert.ok(menu(w,r).some(a=>a.type==='sleep'&&a.buildingId===other.id));
 assert.equal(choose(w,r,{type:'sleep',buildingId:other.id,minutes:30}).ok,true);stepWorld(w,1);assert.ok(r.energy>20);
 stepWorld(w,3);assert.equal(r.activity,null);assert.ok(!menu(w,r).some(a=>a.type==='sleep'&&a.buildingId===other.id));
});
for(const kind of ['missing position','invalid position'] as const)test(`review selfcare: ${kind} cannot produce a room-exit teleport`,()=>{
 const {w,r}=fixture();r.roomAt=kind==='missing position'?null:{x:-20,y:-20};const at={...r.at};
 const action:Action={type:'move',to:{x:at.x+1,y:at.y}};
 assert.equal(ageAllowsAction(w,r,action),false);assert.equal(choose(w,r,action).ok,false);assert.deepEqual(r.at,at);
});
test('review selfcare: future birth within rescue horizon cannot manufacture protection',()=>{
 const {w,r}=fixture();r.bornAt=w.minute+2;r.hunger=98;r.health=1;r.energy=80;menu(w,r);const before=structuredClone(w);
 assert.equal(hasTimelySelfRescue(w,r,[{type:'eat',item:'meal'}]),false);assert.deepEqual(w,before);
});
for(const loss of ['canDecide','canExpress'] as const)test(`review selfcare: cached numbered meal loses ${loss} before submission`,()=>{
 const {w,r}=fixture();const action=menu(w,r).find(a=>a.type==='eat')!;assert.ok(action);r[loss]=false;
 assert.equal(choose(w,r,action).ok,false);assert.equal(hasTimelySelfRescue(w,r,[action]),false);assert.equal(r.inventory.meal,2);
});

test('review selfcare: cached empty room exit cannot teleport from a non-entry position',()=>{
 const {w,r,b}=fixture();assert.equal(choose(w,r,{type:'move',to:{x:b.door.x+1,y:b.door.y}}).ok,true);stepWorld(w,.25);
 assert.equal(r.activity?.room?.mode,'exit');r.activity!.room!.path=[];
 const position=structuredClone({at:r.at,inside:r.inside,roomAt:r.roomAt});stepWorld(w,.25);
 assert.deepEqual({at:r.at,inside:r.inside,roomAt:r.roomAt},position);assert.equal(r.activity,null);
});
test('review selfcare: newly blocked cached room step must stop even when an alternative route exists',()=>{
 const {w,r,b}=fixture();assert.equal(choose(w,r,{type:'move',to:{x:b.door.x+1,y:b.door.y}}).ok,true);stepWorld(w,.25);
 const next=r.activity?.room?.path[0];assert.ok(next);
 const corpse=w.residents[1];corpse.status='dead';corpse.inside=b.id;corpse.roomAt={...next};corpse.body={...corpse.body,storedAt:b.id,carriedBy:null} as Resident['body'];
 const position=structuredClone({at:r.at,inside:r.inside,roomAt:r.roomAt});stepWorld(w,1);
 assert.deepEqual({at:r.at,inside:r.inside,roomAt:r.roomAt},position);assert.equal(r.activity,null);
});

test('review selfcare: a far held bed must not hide the nearby timely held bed from the final menu',()=>{
 const {w,r,b}=fixture();r.homeId=null;r.hunger=10;r.energy=0;r.health=.5;r.inventory={};w.map.tiles=w.map.tiles.map(()=> 'grass');
 const far=w.buildings.find(p=>p.kind==='home'&&p.id!==b.id)!;far.id='aaa-review-far-bed';far.door={x:2,y:2};
 w.commons??={version:1,adoptedAt:w.minute,stays:[],receipts:[]};
 for(const site of [far,b]){
  site.kind='lodge';site.ownerId='commons';site.condition=100;site.capacity=1;site.residents=[];r.knownBuildings.push(site.id);
  w.commons.stays.push({id:'review-held:'+site.id,residentId:r.id,buildingId:site.id,bed:0,startedAt:w.minute,expiresAt:w.minute+1000,endedAt:null,reason:null});
 }
 r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:0')!.at};
 const farSleep:Action={type:'sleep',buildingId:far.id,minutes:60},nearSleep:Action={type:'sleep',buildingId:b.id,minutes:60};
 assert.equal(ageAllowsAction(w,r,farSleep),true,'far bed is legally held and physically reachable');
 assert.equal(hasTimelySelfRescue(w,r,[farSleep]),false,'far bed is not timely');
 assert.equal(hasTimelySelfRescue(w,r,[nearSleep]),true,'near bed can prevent exhaustion damage');
 const actions=menu(w,r);assert.ok(actions.some(a=>a.type==='sleep'&&a.buildingId===b.id),'final menu must include nearby existing bed');
 assert.equal(hasTimelySelfRescue(w,r,actions),true,'final menu must retain the timely rescue');
});
