import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {actionRoom,roomLayout} from '../src/shared/rooms.js';
import {atActionPosition,actionFocus} from '../src/client/action-position.js';
import {residentActivity,actionLabel} from '../src/client/resident-status.js';
import type {Action,Resident,World} from '../src/shared/types.js';

function act(w:World,r:Resident,action:Action){
 r.inside=null;r.roomAt=null;
 r.activity={action,planId:'visual-test',startedAt:w.minute,remaining:10,path:[],target:{...r.at},definition:w.activeDefinitions['action/routine']};
}
test('gather uses real adjacent work positions, not a destination or diagonal guess',()=>{
 const w=createWorld(),r=w.residents[0];act(w,r,{type:'gather',resourceId:'test-tree',quantity:1});
 r.activity!.target={x:r.at.x+1,y:r.at.y};
 assert.equal(atActionPosition(w,r),true);assert.equal(residentActivity(w,r).kind,'active');
 assert.deepEqual(actionFocus(w,r),r.activity!.target);
 r.activity!.target.y++;assert.equal(atActionPosition(w,r),false);assert.equal(actionFocus(w,r),null);
 r.activity!.target={...r.at};assert.equal(atActionPosition(w,r),true);
 r.activity!.path=[{...r.at}];assert.equal(atActionPosition(w,r),false);
});
test('orchard and field work must reach the actual tile and remain read-only',()=>{
 const w=createWorld(),r=w.residents[0];
 for(const action of [{type:'industry',operation:'cutTree'},{type:'industry',operation:'plantTree'},{type:'industry',operation:'harvestFruit'},{type:'production',operation:'plantCrop'},{type:'water',plotId:'test'}] as Action[]){
  act(w,r,action);const before=structuredClone(w);
  assert.equal(atActionPosition(w,r),true);assert.deepEqual(actionFocus(w,r),r.at);assert.deepEqual(w,before);
  r.activity!.target.x++;assert.equal(atActionPosition(w,r),false);assert.equal(residentActivity(w,r).kind,'travelling');
 }
 assert.equal(actionLabel({type:'industry',operation:'cutTree'}),'砍伐果树');
 assert.equal(actionLabel({type:'production',operation:'plantCrop'}),'播种作物');
});
test('room workstation, pending room path, exit and unknown room position stay distinct',()=>{
 const w=createWorld(),r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 w.rooms={tick:w.minute,claims:[],beds:{}};act(w,r,{type:'cook',quantity:1});
 r.at={...home.door};r.activity!.target={...home.door};
 assert.equal(atActionPosition(w,r),false);
 r.inside=home.id;r.roomAt=roomLayout(w,home).entry;assert.equal(atActionPosition(w,r),false);
 const target=actionRoom(w,r,r.activity!)!.target;r.roomAt={...target};
 const before=structuredClone(w);assert.equal(atActionPosition(w,r),true);assert.deepEqual(actionFocus(w,r),target);assert.deepEqual(w,before);
 r.activity!.room={buildingId:home.id,mode:'work',target:{...target},path:[{...target}],progress:0};
 assert.equal(atActionPosition(w,r),false);r.activity!.room.path=[];r.activity!.room.mode='exit';assert.equal(atActionPosition(w,r),false);
 delete r.activity!.room;r.roomAt=null;assert.equal(atActionPosition(w,r),false);assert.equal(actionFocus(w,r),null);
});
test('fishing stays on shore and focuses on authoritative adjacent water',()=>{
 const w=createWorld(),r=w.residents[0];r.at={x:10,y:10};act(w,r,{type:'industry',operation:'fish',at:{...r.at}});
 for(const p of [{x:10,y:10},{x:9,y:10},{x:10,y:9},{x:10,y:11}])w.map.tiles[p.y*w.map.width+p.x]='grass';
 w.map.tiles[10*w.map.width+11]='water';
 const before=structuredClone(w);assert.equal(atActionPosition(w,r),true);assert.deepEqual(actionFocus(w,r),{x:11,y:10});assert.deepEqual(w,before);
 r.at.x--;assert.equal(atActionPosition(w,r),false);assert.equal(actionFocus(w,r),null);
 r.at.x++;w.map.tiles[10*w.map.width+11]='grass';assert.equal(actionFocus(w,r),null);
});
