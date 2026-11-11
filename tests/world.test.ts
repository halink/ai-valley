import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {emitEvent} from '../src/world/events.js';
import {findPath,walkable} from '../src/world/navigation.js';
import {recordDeath} from '../src/world/life.js';
import type {Action,Resident,World} from '../src/shared/types.js';

function plan(w:World,r:Resident,actions:Action[],id=`p-${w.revision}-${r.id}`){return submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:'action/routine@1',intention:'隔离验证：按本人选择执行',actions});}
function fresh(){const w=createWorld();w.clock.paused=false;return w;}

test('seed public roads connect all real doors and cemetery across river',()=>{
 const w=fresh();assert.equal(w.residents.length,3);assert.equal(w.mode,'validation');
 for(const b of w.buildings){assert.equal(walkable(w,b.door),true,`${b.id} door`);assert.notEqual(findPath(w,w.map.entrance,b.door),null,`${b.id} route`);}
 for(const g of w.graves)assert.notEqual(findPath(w,w.map.entrance,g.at,true),null);
 assert.ok(w.resources.some(r=>r.kind==='spring'&&findPath(w,w.map.entrance,r.at,true)!==null));
});

test('without AI intent no gathering, construction, movement or speech occurs',()=>{
 const w=fresh(),before=w.residents.map(r=>({at:{...r.at},inventory:{...r.inventory}}));
 stepWorld(w,60);
 w.residents.forEach((r,i)=>{assert.deepEqual(r.at,before[i].at);assert.deepEqual(r.inventory,before[i].inventory);assert.equal(r.plan,null);});
 assert.equal(w.events.filter(e=>e.kind==='conversation'||e.kind==='construction').length,0);
 assert.ok(w.residents[0].hunger>22);
});

test('fractional world ticks move physically and do not walk through obstacles',()=>{
 const w=fresh(),r=w.residents[0];const destination={x:34,y:29};const path=findPath(w,r.at,destination)!;
 assert.ok(path.length>3);assert.ok(plan(w,r,[{type:'move',to:destination}]).ok);
 const at={...r.at};stepWorld(w,0.2);assert.deepEqual(r.at,at);
 for(let i=0;i<100;i++)stepWorld(w,0.2);
 assert.deepEqual(r.at,destination);assert.equal(r.plan,null);
 assert.ok(path.every(p=>walkable(w,p)));
});

test('resource conservation and duplicate plan submission do not double harvest',()=>{
 const w=fresh(),r=w.residents[0],resource=w.resources.find(v=>v.id==='berry-21-27')!;
 const before=r.inventory.berry!,stock=resource.amount;
 assert.ok(plan(w,r,[{type:'gather',resourceId:resource.id,quantity:2}],'same-plan').ok);
 stepWorld(w,80);
 assert.equal(r.inventory.berry,before+2);assert.equal(resource.amount,stock-2);
 assert.ok(plan(w,r,[{type:'gather',resourceId:resource.id,quantity:2}],'same-plan').ok);
 stepWorld(w,40);
 assert.equal(r.inventory.berry,before+2);assert.equal(resource.amount,stock-2);
});

test('arrival revalidates resources, cancels remaining plan and invents no alternative work',()=>{
 const w=fresh(),r=w.residents[0],resource=w.resources.find(v=>v.id==='berry-21-27')!;
 const before={...r.inventory};assert.ok(plan(w,r,[{type:'gather',resourceId:resource.id,quantity:3},{type:'eat',item:'berry'}]).ok);
 stepWorld(w,1);resource.amount=0;stepWorld(w,80);
 assert.deepEqual(r.inventory,before);assert.equal(r.plan,null);assert.match(r.lastFailure!,/资源/);
});

test('valid trade requires separate acceptance and exact transfer; late acceptance cannot repeat',()=>{
 const w=fresh(),a=w.residents[0],b=w.residents[1];a.at={x:32,y:29};b.at={x:33,y:29};a.inventory={wood:5};b.inventory={berry:6};
 assert.ok(plan(w,a,[{type:'offer',targetId:b.id,give:{wood:2},want:{berry:3}}]).ok);stepWorld(w,4);
 assert.deepEqual(a.inventory,{wood:5});assert.deepEqual(b.inventory,{berry:6});
 const offer=w.offers[0];assert.ok(offer);assert.equal(offer.status,'open');
 assert.ok(plan(w,b,[{type:'accept',offerId:offer.id}]).ok);stepWorld(w,4);
 assert.deepEqual(a.inventory,{wood:3,berry:3});assert.deepEqual(b.inventory,{berry:3,wood:2});assert.equal(offer.status,'accepted');
 assert.ok(plan(w,b,[{type:'accept',offerId:offer.id}]).ok);stepWorld(w,4);
 assert.deepEqual(a.inventory,{wood:3,berry:3});assert.deepEqual(b.inventory,{berry:3,wood:2});assert.match(b.lastFailure!,/失效/);
});

test('remote facts do not become memories; actual witness learns later on arrival',()=>{
 const w=fresh(),dead=w.residents[0],remote=w.residents[1];dead.at={x:15,y:29};remote.at={x:45,y:29};
 recordDeath(w,dead);
 assert.equal(remote.memories.some(m=>w.events.some(e=>e.id===m.eventId&&e.kind==='death')),false);
 remote.at={x:16,y:29};stepWorld(w,0.2);
 assert.ok(remote.memories.some(m=>w.events.some(e=>e.id===m.eventId&&e.kind==='death'&&e.actors.includes(dead.id))));
 assert.equal(dead.plan,null);assert.equal(dead.status,'dead');
});

test('blocked route cancels the plan at real position without teleporting',()=>{
 const w=fresh(),r=w.residents[0];assert.ok(plan(w,r,[{type:'move',to:{x:34,y:29}}]).ok);stepWorld(w,1);
 const current={...r.at},next=r.activity!.path[0];w.map.tiles[next.y*w.map.width+next.x]='water';stepWorld(w,1);
 assert.deepEqual(r.at,current);assert.equal(r.plan,null);assert.match(r.lastFailure!,/阻挡/);
});

test('technical hold freezes every world-time process including offers and physiology',()=>{
 const w=fresh(),r=w.residents[0];assert.ok(plan(w,r,[{type:'sleep',minutes:120}]).ok);stepWorld(w,2);
 w.clock.paused=true;w.clock.reason='隔离模型超时验证';const before=structuredClone(w);
 stepWorld(w,1440*10);assert.deepEqual(w,before);
});

test('stale model plan and unknown definition cannot mutate actor',()=>{
 const w=fresh(),r=w.residents[0],revision=r.revision;r.revision++;
 const before=structuredClone(r);assert.equal(submitPlan(w,{id:'stale',actorId:r.id,actorRevision:revision,createdAt:w.minute,definition:'action/routine@1',intention:'stale',actions:[{type:'eat',item:'berry'}]}).ok,false);assert.deepEqual(r,before);
 assert.equal(submitPlan(w,{id:'bad-version',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:'action/routine@99',intention:'bad',actions:[{type:'eat',item:'berry'}]}).ok,false);
});

test('conversation is one actual utterance, grouped, and does not fabricate reply or agreement',()=>{
 const w=fresh(),a=w.residents[0],b=w.residents[1];a.at={x:32,y:29};b.at={x:33,y:29};
 plan(w,a,[{type:'talk',targetId:b.id,text:'今天想去看看菜地。',tone:'friendly'}]);stepWorld(w,4);
 const events=w.events.filter(e=>e.kind==='conversation');assert.equal(events.length,1);assert.ok(events[0].text.startsWith(`${a.name}：`));assert.ok(events[0].conversationId);assert.equal(b.plan,null);assert.equal(w.proposals.length,0);assert.equal(b.relations[0].partner,undefined);
});

test('crop needs real seed and watering; unwat​​ered crop pauses instead of fabricating yield',()=>{
 const w=fresh(),r=w.residents[0],plot=w.plots.find(p=>p.ownerId===r.id)!;r.at={...plot.at};w.weather='sun';
 plan(w,r,[{type:'plant',plotId:plot.id}]);stepWorld(w,16);assert.ok(plot.crop);assert.equal(r.inventory.seed,4);
 w.residents=[];w.minute=1439;stepWorld(w,1);assert.equal(plot.crop!.growth,0);
 plot.crop!.wateredDay=1;w.minute=2879;w.weather='sun';stepWorld(w,1);assert.equal(plot.crop!.growth,1);assert.equal(r.inventory.turnip,undefined);
});

test('accepted routine retains recipe version when active content changes before work begins',()=>{
 const w=fresh(),r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;r.at={...home.door};r.inventory={turnip:4,water:2};
 assert.ok(plan(w,r,[{type:'wait',minutes:2},{type:'cook',quantity:1}]).ok);
 w.definitions['recipe/meal@2']={...structuredClone(w.definitions['recipe/meal@1']),version:2,cost:{turnip:4,water:2},minutes:80};w.activeDefinitions['recipe/meal']='recipe/meal@2';
 stepWorld(w,24);assert.equal(r.inventory.turnip,2);assert.equal(r.inventory.water,1);assert.equal(r.inventory.meal,1);assert.equal(r.plan,null);
});

test('revoked residence stops sleep without using a bed through stale homeId',()=>{
 const w=fresh(),r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;r.at={...home.door};r.energy=10;
 plan(w,r,[{type:'sleep',minutes:100}]);stepWorld(w,5);const energy=r.energy;assert.ok(energy>10,'valid ordinary residence permits actual sleep before revocation');home.residents=[];stepWorld(w,1);
 assert.equal(r.activity,null);assert.equal(r.inside,null);assert.ok(r.energy<energy);assert.equal(r.homeId,home.id,'stale registration does not restore revoked rights');assert.equal(r.lastFailure,'原住处的床位使用权已经失效');
});

test('zero health stops an already selected action before any final labor or consumption',()=>{
 const w=fresh(),r=w.residents[0];plan(w,r,[{type:'eat',item:'berry'}]);stepWorld(w,4);const food=r.inventory.berry;r.health=0;
 stepWorld(w,1);assert.equal(r.status,'dead');assert.equal(r.plan,null);assert.equal(w.events.filter(e=>e.kind==='action'&&e.text.includes('吃了')).length,0);
 assert.equal(w.estates.find(e=>e.personId===r.id)!.inventory.berry,food);
});

test('isolated construction conserves materials and rejects public-road occupation',()=>{
 const w=fresh(),r=w.residents[0];r.at={x:19,y:45};r.inventory={wood:24,stone:12};
 w.resources=w.resources.filter(v=>!(v.at.x>=16&&v.at.x<22&&v.at.y>=40&&v.at.y<45));
 const before=w.buildings.length;plan(w,r,[{type:'build',kind:'home',at:{x:16,y:40}}]);stepWorld(w,361);
 assert.equal(w.buildings.length,before+1);assert.deepEqual(r.inventory,{wood:0,stone:0});assert.equal(w.buildings.at(-1)!.definition,'building/home@1');
 r.inventory={wood:24,stone:12};plan(w,r,[{type:'build',kind:'home',at:{x:10,y:32}}]);stepWorld(w,450);
 assert.equal(w.buildings.length,before+1);assert.deepEqual(r.inventory,{wood:24,stone:12});assert.ok(r.lastFailure);
});
