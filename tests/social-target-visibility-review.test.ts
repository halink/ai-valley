import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {canSeeOutdoorPoint} from '../src/world/outdoor-observation.js';
import {findPath,walkable} from '../src/world/navigation.js';
import {relationshipMemories} from '../src/server/relationship-memory.js';
import {canSeeSocialTarget,canContactSocialTarget} from '../src/world/social-observation.js';
import {initializeIndustry} from '../src/world/industry.js';
import {emitEvent} from '../src/world/events.js';
import {WorldStore} from '../src/server/store.js';
import type {World,Resident} from '../src/shared/types.js';

function fixture(){
 const w=createWorld(5401);w.mode='formal';w.resources=[];w.buildings=[];w.map.tiles.fill('grass');
 const [a,b]=w.residents;w.residents=[a,b];for(const p of [a,b]){p.inside=null;p.roomAt=null;p.activity=null;p.plan=null;p.inventory={water:3,turnip:3};}
 a.at={x:20,y:20};b.at={x:23,y:20};a.knownPeople=[b.id];b.knownPeople=[a.id];
 decisionContext(w,a);
 w.offers=[{id:'review-offer',actorId:b.id,targetId:a.id,give:{turnip:1},want:{water:1},expiresAt:w.minute+100,status:'open',definition:'trade/barter@1'}];
 return {w,a,b};
}
function direct(w:World,a:Resident,b:Resident){return decisionChoices(decisionContext(w,a)).filter(({action:x})=>x.type==='talk'&&x.targetId===b.id||x.type==='offer'&&x.targetId===b.id||x.type==='accept'&&x.offerId==='review-offer');}
function blocked(w:World,a:Resident,b:Resident){assert.deepEqual(direct(w,a,b),[]);}

test('social visibility independent review: visible known reachable target has all tones and barter',()=>{
 const {w,a,b}=fixture(),before=structuredClone(w),rows=direct(w,a,b);
 assert.deepEqual(rows.filter(c=>c.action.type==='talk').map(c=>c.action.type==='talk'&&c.action.tone).sort(),['friendly','hostile','neutral']);
 assert.ok(rows.some(c=>c.action.type==='offer'));assert.ok(rows.some(c=>c.action.type==='accept'));assert.deepEqual(w,before);
});

test('social visibility independent review: transparent full water divide is not a reachable face-to-face target',()=>{
 const {w,a,b}=fixture();for(let y=0;y<w.map.height;y++)w.map.tiles[y*w.map.width+21]='water';
 assert.equal(canSeeOutdoorPoint(w,a,b.at,10),true);assert.equal(findPath(w,a.at,b.at,true),null);blocked(w,a,b);
});

test('social visibility independent review: opaque diagonal corner cannot become visible via short detour',()=>{
 const {w,a,b}=fixture();b.at={x:21,y:21};w.map.tiles[20*w.map.width+21]='cliff';
 assert.equal(canSeeOutdoorPoint(w,a,b.at,10),false);assert.ok(findPath(w,a.at,b.at,true));blocked(w,a,b);
});

test('social visibility independent review: unknown or invalid presence cannot gain barter merely from proximity',()=>{
 for(const kind of ['unknown','target-room-remnant','actor-room-remnant'] as const){const {w,a,b}=fixture();if(kind==='unknown')a.knownPeople=[];if(kind==='target-room-remnant')b.roomAt={x:3,y:5};if(kind==='actor-room-remnant')a.roomAt={x:3,y:5};blocked(w,a,b);}
});

test('social visibility independent review: closed fence adjacency does not count as contact when gate unreachable',()=>{
 const {w,a,b}=fixture();b.at={x:21,y:20};
 // A single-cell fenced project, gate below it, with all alternative approaches blocked.
 initializeIndustry(w);w.industry!.pastureProjects=[{id:'review-fence',at:{...b.at},width:1,height:1,door:{x:21,y:21},fenceBuilt:true,status:'building'} as NonNullable<NonNullable<World['industry']>['pastureProjects']>[number]];
 for(const q of [{x:21,y:21},{x:22,y:20},{x:21,y:19}])w.map.tiles[q.y*w.map.width+q.x]='water';
 assert.equal(canSeeOutdoorPoint(w,a,b.at,10),true);assert.equal(walkable(w,b.at,a.at),false);
 assert.deepEqual(findPath(w,a.at,b.at,true),[],'generic adjacency shortcut deliberately exposes the dangerous counterexample');blocked(w,a,b);
});

test('social visibility independent review: hidden speaker remains an audible witness event without precise target',()=>{
 const {w,a,b}=fixture();w.map.tiles[20*w.map.width+21]='cliff';
 const before=structuredClone(a.relations),event=emitEvent(w,{kind:'conversation',actors:[b.id],place:{...b.at},text:'合成听觉测试',speechText:'我在这里',speechTone:'neutral'});
 assert.ok(event.witnesses.includes(a.id));assert.ok(a.memories.some(m=>m.eventId===event.id));assert.deepEqual(a.relations,before);blocked(w,a,b);
});

test('social visibility independent review: memory SQLite reload and repeated menus do not resurrect hidden targets',()=>{
 const {w,a,b}=fixture();w.map.tiles[20*w.map.width+21]='cliff';const store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(p=>p.id===a.id)!,peer=loaded.residents.find(p=>p.id===b.id)!;decisionContext(loaded,actor);const before=structuredClone(loaded);for(let i=0;i<4;i++)blocked(loaded,actor,peer);assert.deepEqual(loaded,before);}finally{store.close();}
});

function indoor(){
 const f=fixture(),{w,a,b}=f;
 const building={id:'review-room',kind:'home' as const,name:'Synthetic room',at:{x:30,y:30},width:6,height:5,door:{x:33,y:35},ownerId:a.id,definition:'building/home@1',capacity:2,residents:[a.id,b.id],condition:100};
 w.buildings=[building];w.rooms={tick:-1,claims:[],beds:{}};
 for(const p of [a,b]){p.inside=building.id;p.at={...building.door};p.homeId=building.id;}
 a.roomAt={x:4,y:9};b.roomAt={x:5,y:9};return {...f,building};
}

test('social visibility independent review: real indoor contact is available',()=>{
 const {w,a,b}=indoor();assert.equal(direct(w,a,b).filter(c=>c.action.type==='talk').length,3);
});

test('social visibility independent review: indoor missing coordinates and wrong doorway never become entry positions',()=>{
 for(const kind of ['missing-actor','missing-target','wrong-door'] as const){const {w,a,b}=indoor();if(kind==='missing-actor')a.roomAt=null;if(kind==='missing-target')b.roomAt=null;if(kind==='wrong-door')b.at={x:20,y:20};blocked(w,a,b);}
});

test('social visibility independent review: room obstacle prevents sight although walking around remains possible',()=>{
 const {w,a,b}=indoor();a.roomAt={x:5,y:6};b.roomAt={x:10,y:6};blocked(w,a,b);
});

test('social visibility independent review: separate interiors at the same outdoor door are never face-to-face',()=>{
 const {w,a,b,building}=indoor();w.buildings.push({...building,id:'review-second-room'});b.inside='review-second-room';blocked(w,a,b);
});

test('social visibility independent review: indoor diagonal furniture corner is not a sight corridor',()=>{
 const {w,a,b}=indoor();a.roomAt={x:5,y:6};b.roomAt={x:6,y:5};blocked(w,a,b);
});

test('social visibility independent review: interior ownership and resident access must cover both people',()=>{
 for(const kind of ['actor-denied','target-denied','damaged'] as const){const {w,a,b,building}=indoor();if(kind==='actor-denied'){building.ownerId=b.id;building.residents=[b.id];}if(kind==='target-denied')building.residents=[a.id];if(kind==='damaged')building.condition=0;blocked(w,a,b);}
});

test('social visibility independent review: legal open-gate approach remains available from outside fenced edge',()=>{
 const {w,a,b}=fixture();b.at={x:21,y:20};initializeIndustry(w);
 w.industry!.pastureProjects=[{id:'review-open-gate',at:{...b.at},width:1,height:1,door:{x:21,y:21},fenceBuilt:true,status:'building'} as NonNullable<NonNullable<World['industry']>['pastureProjects']>[number]];
 assert.equal(walkable(w,b.at,a.at),false);assert.ok(findPath(w,a.at,{x:21,y:21}));assert.equal(walkable(w,b.at,{x:21,y:21}),true);
 assert.equal(direct(w,a,b).filter(c=>c.action.type==='talk').length,3,'a legal visible approach through the gate exists');
});


test('social visibility independent review: clear indoor five-tile view recalls own relationship without expanding close contact',()=>{
 const {w,a,b}=indoor();a.roomAt={x:4,y:9};b.roomAt={x:9,y:9};
 a.relations=[{targetId:b.id,affection:10,trust:20,conflict:0,evidence:[]}];
 const before=structuredClone(w);assert.equal(canSeeSocialTarget(w,a,b),true);assert.equal(canContactSocialTarget(w,a,b),false);
 assert.equal(direct(w,a,b).filter(c=>c.action.type==='talk').length,3);assert.ok(direct(w,a,b).some(c=>c.action.type==='offer'));assert.ok(direct(w,a,b).some(c=>c.action.type==='accept'));
 assert.equal(relationshipMemories(w,a).people.find(p=>p.targetId===b.id)?.trust,20,'a permitted visible identity recalls personal views, not bodily observations');assert.deepEqual(w,before);
 a.roomAt={x:5,y:6};b.roomAt={x:10,y:6};assert.equal(canSeeSocialTarget(w,a,b),false);blocked(w,a,b);
});
