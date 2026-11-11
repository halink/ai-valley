import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createWorld} from '../src/world/seed.js';
import {personPose,personVisual,personAnimationFrame,personOriginY,type WorkPose,type PersonFacing} from '../src/client/person-pose.js';
import {workPicture} from '../src/client/work-art.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import type {Action,Resident,Snapshot,World} from '../src/shared/types.js';

function fixture(){const w=createWorld(),r=w.residents[0];w.clock.paused=false;r.inside=null;r.roomAt=null;r.at={x:10,y:10};return {w,r};}
function act(w:World,r:Resident,action:Action,target={...r.at}){r.activity={action,planId:'visual-test',startedAt:w.minute,remaining:30,path:[],target,definition:'action/routine@1'};}
const poses:WorkPose[]=['chop','pick','sow','water','harvest','fish','mine','fetch'];
const facings:PersonFacing[]=['north','east','south','west'];
const focus={north:{x:0,y:-1},east:{x:1,y:0},south:{x:0,y:1},west:{x:-1,y:0}};
function raster(picture:ReturnType<typeof workPicture>){
 const pixels=new Uint32Array(picture.width*picture.height);
 for(const p of picture.marks)for(let y=p.y;y<p.y+p.height;y++)for(let x=p.x;x<p.x+p.width;x++){
  assert.ok(x>=0&&x<picture.width&&y>=0&&y<picture.height,`clipped pixel ${x},${y}`);
  pixels[y*picture.width+x]=parseInt(p.color.slice(1),16)+0xff000000;
 }
 return Buffer.from(pixels.buffer);
}

test('each work action has four bounded integer-pixel frames in all four target directions',()=>{
 const {r}=fixture();
 for(const stage of ['adult','child','teen','elder'] as const)for(const pose of poses)for(const facing of facings){r.lifeStage=stage;const frames=[];
  for(let frame=0;frame<4;frame++){const picture=workPicture(r,pose,frame,facing,focus[facing]);assert.deepEqual(picture.anchor,{x:32,y:44});
   for(const mark of picture.marks){assert.ok(/^#[\da-f]{6}$/i.test(mark.color));for(const n of [mark.x,mark.y,mark.width,mark.height])assert.ok(Number.isInteger(n));assert.ok(mark.width>0&&mark.height>0);}
   frames.push(raster(picture).toString('base64'));
  }
  assert.equal(new Set(frames).size,4,pose+' '+facing+' must have distinct readable phases');
 }
});

test('static work contact sheet pixel contract preserves silhouettes and empty-hand outcomes',()=>{
 const {r}=fixture(),hash=createHash('sha256');
 for(const pose of poses)for(const facing of facings)for(let phase=0;phase<4;phase++)hash.update(raster(workPicture(r,pose,phase,facing,focus[facing])));
 assert.equal(hash.digest('hex'),'671f9867521eaccfa4130747eed62e0fa436424db88e429d9963f1d9b8f07758');
 const {w}=fixture(),before=structuredClone(w);for(const pose of poses)workPicture(w.residents[0],pose,2,'east',focus.east);assert.deepEqual(w,before);
});

test('actual actions select distinct work art and true target directions',()=>{
 const {w,r}=fixture();
 for(const [kind,pose] of [['tree','chop'],['bush','pick'],['rock','mine'],['spring','fetch']] as const){
  const target={x:9,y:10};w.resources=[{id:'resource',kind,at:target,amount:5,max:5,lastHarvest:0,regrowthDays:1}];act(w,r,{type:'gather',resourceId:'resource',quantity:1},target);
  assert.deepEqual(personVisual(w,r),{pose,facing:'west',focus:{x:-1,y:0}});
 }
 for(const [action,pose] of [[{type:'plant',plotId:'p'},'sow'],[{type:'water',plotId:'p'},'water'],[{type:'harvest',plotId:'p'},'harvest'],[{type:'production',operation:'plantCrop',plotId:'p'},'sow'],[{type:'industry',operation:'cutTree',treeId:'t'},'chop'],[{type:'industry',operation:'plantTree',plotId:'p'},'sow'],[{type:'industry',operation:'harvestFruit',treeId:'t'},'pick'],[{type:'industry',operation:'tendTree',treeId:'t'},'water']] as Array<[Action,string]>){act(w,r,action);assert.equal(personPose(w,r),pose);}
 w.map.tiles[r.at.y*w.map.width+r.at.x-1]='water';act(w,r,{type:'industry',operation:'fish',at:{...r.at}});assert.equal(personVisual(w,r).facing,'west');
 r.activity!.path=[{x:11,y:10}];assert.equal(personPose(w,r),'idle');r.activity!.path=[];r.at={x:12,y:10};assert.equal(personPose(w,r),'idle');
});

test('animation timing has a patient float without invented bite or harvest frames',()=>{
 const fish={pose:'fish' as const,facing:'east' as const,focus:focus.east};
 assert.deepEqual(Array.from({length:8},(_,n)=>personAnimationFrame(fish,n*420)),[0,1,2,2,2,2,3,3]);
 assert.equal(personOriginY('fish'),44/64);assert.equal(personOriginY('idle'),1);
 assert.equal(personAnimationFrame(fish,NaN),0);
});

function snapshot(w:World):Snapshot{return {world:w,mapRevision:w.id,serverTime:'test',version:'test',capabilities:{observe:true,submitActions:false}} as unknown as Snapshot;}
test('actual scene freezes work phase on pause and resumes without resetting or catching up',()=>{
 const {w,r}=fixture();act(w,r,{type:'water',plotId:'p'});const {scene}=residentSceneHarness();scene.accept(snapshot(w));
 const internal=scene as unknown as {actors:Map<string,{texture:string;origin:{x:number;y:number}}>};
 for(let time=0;time<=600;time+=100)scene.update(time);
 const sprite=internal.actors.get(r.id)!,frame=sprite.texture;assert.ok(frame.endsWith('-2'));assert.equal(sprite.origin.y,44/64);
 w.clock.paused=true;scene.accept(snapshot(w));assert.equal(sprite.texture,frame);
 scene.update(10000);scene.update(20000);assert.equal(sprite.texture,frame);
 w.clock.paused=false;scene.accept(snapshot(w));scene.update(20100);assert.equal(sprite.texture,frame);
 scene.update(20200);assert.ok(sprite.texture.endsWith('-3'));
 r.activity=null;scene.accept(snapshot(w));assert.equal(sprite.origin.y,1);assert.ok(sprite.texture.endsWith('-0'));
});
