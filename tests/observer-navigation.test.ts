/** CPU-only contract tests. No Phaser, DOM, transport, model or saved world. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {ObserverNavigation} from '../src/client/observer-navigation.js';
import {createObserverMap,type ObserverRendererPort,type ObserverSelection} from '../src/client/observer-map.js';
import type {ResidentFollowState} from '../src/client/resident-follow.js';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import type {Snapshot,Vec,World} from '../src/shared/types.js';
import {residentSceneHarness} from './helpers/resident-scene.js';

const snap=(world:World):Snapshot=>({world,serverTime:'synthetic-navigation',version:'offline',capabilities:{active:[],pending:[]}});
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
function fixture(){const {world}=isometricStudyFixture();return {world,resident:world.residents[0],building:world.buildings[0]};}

test('renderer-neutral adapter uses the original source and a non-Phaser renderer port',()=>{
 const {world,resident,building}=fixture(),before=structuredClone(world),navigation=new ObserverNavigation();freeze(world);
 let snapshot:Snapshot|null=null,connected=false,at:Vec={x:7,y:8};const listeners=new Set<(s:Snapshot|null,c:boolean)=>void>();
 const calls:string[]=[],covers:boolean[]=[],selections:ObserverSelection[]=[];
 const renderer:ObserverRendererPort={
  currentTile:()=>at,
  stopFollowing(){calls.push('stop');navigation.clearFollowing();navigation.publishFollow();},
  setFollowResolver(resolver){navigation.setFollowResolver(resolver);if(!resolver&&snapshot){navigation.observeFollowing(snapshot.world);navigation.publishFollow();}},
  frame(next){calls.push('frame');renderer.stopFollowing();at=next;navigation.recordRoom(world,null);},
  cover(value){covers.push(value);},
 };
 const target={} as EventTarget;
 const map=createObserverMap({currentSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);listener(snapshot,connected);return ()=>{listeners.delete(listener);};}},navigation,renderer,{select(value){calls.push('select');selections.push(value);},isFullMapTarget:value=>value===target});
 const seen:Array<[Snapshot|null,boolean]>=[],rooms:Array<string|null>=[],follows:Array<ResidentFollowState|null>=[];
 const off=[map.subscribe((s,c)=>seen.push([s,c])),map.subscribeRoom(id=>rooms.push(id)),map.subscribeFollow(state=>follows.push(state))];
 assert.deepEqual(seen,[[null,false]]);assert.deepEqual(rooms,[null]);assert.deepEqual(follows,[null]);
 snapshot=snap(world);connected=true;for(const listener of listeners)listener(snapshot,connected);
 assert.equal(map.currentSnapshot(),snapshot);assert.equal(seen.at(-1)![0],snapshot);
 connected=false;for(const listener of listeners)listener(snapshot,connected);
 assert.equal(seen.at(-1)![0],snapshot);assert.equal(seen.at(-1)![1],false);
 navigation.recordRoom(world,building.id);assert.equal(map.currentRoom(),building.id);assert.equal(rooms.at(-1),building.id);
 navigation.startFollowing(world,resident.id);navigation.publishFollow();assert.equal(map.currentFollow()?.personId,resident.id);
 map.currentFollow()!.personId='not-a-world-id';assert.equal(map.currentFollow()?.personId,resident.id);
 map.currentTile().x=99;assert.deepEqual(at,{x:7,y:8});
 const requested={x:12,y:13};map.frame(requested);requested.x=99;assert.deepEqual(map.currentTile(),{x:12,y:13});assert.equal(map.currentRoom(),null);assert.equal(map.currentFollow(),null);
 const selected:ObserverSelection={kind:'person',id:resident.id};map.select(selected);selected.id='changed';assert.equal(selections.at(-1)?.id,resident.id);assert.deepEqual(calls.slice(-2),['stop','select']);
 map.cover(true);map.cover(false);assert.deepEqual(covers,[true,false]);assert.equal(map.isFullMapTarget(target),true);assert.equal(map.isFullMapTarget(null),false);
 off.forEach(unsubscribe=>{unsubscribe();unsubscribe();});const counts=[seen.length,rooms.length,follows.length];
 navigation.recordRoom(world,null);navigation.startFollowing(world,resident.id);navigation.publishFollow();for(const listener of listeners)listener(snapshot,connected);
 assert.deepEqual([seen.length,rooms.length,follows.length],counts);assert.deepEqual(world,before);
});

test('navigation preserves precise/unknown room facts and stopped identity until explicit follow',()=>{
 const {world,resident,building}=fixture(),navigation=new ObserverNavigation();resident.inside=building.id;resident.roomAt=null;
 navigation.startFollowing(world,resident.id);assert.equal(navigation.followState?.roomId,building.id);assert.equal(navigation.followState?.precise,false);
 navigation.recordRoom(world,building.id);assert.throws(()=>navigation.recordRoom(world,'missing-room'),/observer_room_unavailable/);assert.equal(navigation.roomId,building.id);
 resident.status='dead';navigation.observeFollowing(world);assert.equal(navigation.followState?.reason,'dead');
 resident.status='alive';navigation.observeFollowing(world);assert.equal(navigation.followState?.status,'stopped');
 navigation.startFollowing(world,resident.id);assert.equal(navigation.followState?.status,'following');
 const next=structuredClone(world);next.id='different-world';navigation.observeFollowing(next);assert.equal(navigation.followState,null);
});

test('navigation subscriptions do not leak on failed immediate delivery or share writable follow records',()=>{
 const {world,resident}=fixture(),navigation=new ObserverNavigation();let failures=0;
 const fail=()=>{failures++;throw new Error('synthetic listener failure');};
 assert.throws(()=>navigation.subscribeRoom(fail));assert.throws(()=>navigation.subscribeFollow(fail));
 navigation.recordRoom(world,null);navigation.startFollowing(world,resident.id);navigation.publishFollow();assert.equal(failures,2);
 navigation.subscribeFollow(state=>{if(state)state.personId='mutated-listener-copy';});
 const records:Array<ResidentFollowState|null>=[];navigation.subscribeFollow(state=>records.push(state));
 assert.equal(records.at(-1)?.personId,resident.id);assert.equal(navigation.followState?.personId,resident.id);
 resident.name='New recorded name';navigation.observeFollowing(world);navigation.publishFollow();assert.equal(records.at(-1)?.personId,resident.id);
});

test('legacy scene shares logical navigation while its pixel camera stays behind the port',()=>{
 const {world,resident,building}=fixture(),h=residentSceneHarness(),navigation=h.scene.navigation,rooms:Array<string|null>=[],follows:Array<ResidentFollowState|null>=[];
 h.scene.accept(snap(world));navigation.subscribeRoom(id=>rooms.push(id));navigation.subscribeFollow(state=>follows.push(state));
 h.scene.focusPerson(resident.id);assert.equal(navigation.followState?.personId,resident.id);
 resident.inside=building.id;resident.roomAt={x:2,y:3};h.scene.accept(snap(world));
 assert.equal(navigation.roomId,building.id);assert.equal(rooms.at(-1),building.id);assert.equal(follows.at(-1)?.roomId,building.id);assert.deepEqual(h.scene.cameraTile(),building.door);
 const resolver=()=>({roomId:null,roomName:null,precise:true});h.scene.setObserverFollowResolver(resolver);assert.equal(navigation.followResolver,resolver);
 h.scene.setObserverFollowResolver(null);assert.equal(navigation.followResolver,null);assert.equal(navigation.roomId,building.id);
 h.scene.watchTile({x:10,y:11});assert.equal(navigation.roomId,null);assert.equal(navigation.followState,null);assert.deepEqual(h.scene.cameraTile(),{x:10,y:11});
 h.scene.focusPerson(resident.id);const next=structuredClone(world);next.id='replacement';h.scene.accept(snap(next));assert.equal(navigation.roomId,null);assert.equal(navigation.followState,null);
});

test('observer contracts contain no old scene, browser or write transport dependency',()=>{
 for(const file of ['observer-map.ts','observer-navigation.ts']){
  const source=readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"](?:phaser['"]|\.\/scene\.js['"]|[^'"]*\/(?:server|scripts)\/)|\b(?:fetch|EventSource|WebSocket|XMLHttpRequest|submitPlan|stepWorld|localStorage)\b|process\.env/);
 }
 assert.doesNotMatch(readFileSync(new URL('../src/client/isometric-preview.ts',import.meta.url),'utf8'),/import\(['"]\.\/scene\.js['"]\)/);
 const main=readFileSync(new URL('../src/client/main.ts',import.meta.url),'utf8');
 assert.match(main,/const navigation=new ObserverNavigation\(\)/);assert.match(main,/new ValleyScene\(navigation\)/);assert.match(main,/createObserverMap\(/);
 assert.equal((main.match(/new EventSource\(/g)??[]).length,1);assert.equal((main.match(/fetch\(new URL\('world'/g)??[]).length,1);
});
