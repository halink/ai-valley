import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ObserverNavigation} from '../src/client/observer-navigation.js';
import {createObserverMap} from '../src/client/observer-map.js';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot,World} from '../src/shared/types.js';
import {residentSceneHarness} from './helpers/resident-scene.js';

function snapshot(world:World):Snapshot{return {world,mapRevision:'review',serverTime:'review',version:'review',capabilities:{active:[],pending:[]}};}
function freeze(value:unknown){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}}

test('navigation copies follow state for each reader and listener without mutating frozen world',()=>{
 const w=createWorld(),nav=new ObserverNavigation(),before=JSON.stringify(w);freeze(w);
 nav.subscribeFollow(state=>{if(state)state.name='listener mutation';});
 let received='';nav.subscribeFollow(state=>{received=state?.name??'';});
 nav.startFollowing(w,w.residents[0].id);nav.publishFollow();
 assert.equal(received,w.residents[0].name);
 nav.followState!.personId='reader mutation';
 assert.equal(nav.followState!.personId,w.residents[0].id);
 assert.equal(JSON.stringify(w),before);
});

test('failed initial subscriptions are removed, unsubscribe works, and invalid room is not committed',()=>{
 const w=createWorld(),nav=new ObserverNavigation();let calls=0;
 assert.throws(()=>nav.subscribeRoom(()=>{calls++;throw Error('initial room');}),/initial room/);
 assert.throws(()=>nav.subscribeFollow(()=>{calls++;throw Error('initial follow');}),/initial follow/);
 nav.recordRoom(w,w.buildings[0].id);nav.startFollowing(w,w.residents[0].id);nav.publishFollow();assert.equal(calls,2);
 assert.throws(()=>nav.recordRoom(w,'absent'),/observer_room_unavailable/);assert.equal(nav.roomId,w.buildings[0].id);
 const off=nav.subscribeRoom(()=>calls++);off();off();nav.recordRoom(w,null);assert.equal(calls,3);
});

test('adapter copies coordinates and selections and cancels follow before selection',()=>{
 const nav=new ObserverNavigation(),tile={x:2,y:3},events:string[]=[];
 const map=createObserverMap({currentSnapshot:()=>null,subscribe:()=>()=>{}},nav,{
  currentTile:()=>tile,stopFollowing:()=>events.push('stop'),setFollowResolver:()=>{},cover:()=>{},
  frame:at=>{at.x=99;},
 },{select:value=>{events.push('select');if(value)value.id='changed';},isFullMapTarget:()=>false});
 map.currentTile().x=99;assert.equal(tile.x,2);map.frame(tile);assert.equal(tile.x,2);
 const value={kind:'person' as const,id:'original'};map.select(value);assert.equal(value.id,'original');assert.deepEqual(events,['stop','select']);
});

test('real scene routes a prepared room before follow and publishes no duplicate unchanged follow',()=>{
 const w=createWorld(),r=w.residents[0],b=w.buildings[0],{scene,camera}=residentSceneHarness();scene.accept(snapshot(w));
 const events:string[]=[];scene.navigation.subscribeRoom(id=>{if(id){assert.equal(camera.zoom>0,true);events.push('room');}});
 scene.navigation.subscribeFollow(state=>{if(state)events.push('follow');});
 r.inside=b.id;scene.focusPerson(r.id);assert.deepEqual(events,['room','follow']);assert.equal(scene.navigation.roomId,b.id);
 scene.accept(snapshot(w));assert.deepEqual(events,['room','follow']);
 scene.exitRoom();assert.equal(scene.navigation.roomId,null);assert.equal(scene.followState,null);
});

test('resolver removal revalidates real 2D room immediately and dead residents cannot be revived by resolver',()=>{
 const w=createWorld(),r=w.residents[0],b=w.buildings[0],{scene}=residentSceneHarness();scene.accept(snapshot(w));r.inside=b.id;
 scene.setObserverFollowResolver(()=>({roomId:null,roomName:null,precise:true}));scene.focusPerson(r.id);
 assert.equal(scene.navigation.roomId,null);scene.setObserverFollowResolver(null);assert.equal(scene.navigation.roomId,b.id);assert.equal(scene.followState?.precise,false);
 scene.setObserverFollowResolver(()=>({roomId:null,roomName:null,precise:true}));r.status='dead';scene.accept(snapshot(w));assert.equal(scene.followState?.reason,'dead');
 r.status='alive';scene.setObserverFollowResolver(null);assert.equal(scene.followState?.status,'stopped');
});

test('new world preserves legacy follow-clear then room-clear order without leaking old navigation',()=>{
 const w=createWorld(),r=w.residents[0],{scene}=residentSceneHarness();scene.accept(snapshot(w));r.inside=w.buildings[0].id;scene.focusPerson(r.id);
 const events:string[]=[];scene.navigation.subscribeRoom(id=>{if(id===null)events.push('room');});scene.navigation.subscribeFollow(state=>{if(state===null)events.push('follow');});
 const next=structuredClone(w);next.id='review-new-world';scene.accept(snapshot(next));assert.deepEqual(events,['follow','room']);assert.equal(scene.navigation.roomId,null);assert.equal(scene.followState,null);
});
