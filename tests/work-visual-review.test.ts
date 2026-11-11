import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {personVisual} from '../src/client/person-pose.js';
import {WorkFeedback} from '../src/client/work-feedback.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import type {Snapshot,World,WorldEvent} from '../src/shared/types.js';
const snapshot=(world:World)=>({world,mapRevision:world.id,serverTime:'review',version:'review',capabilities:{observe:true,submitActions:false}} as unknown as Snapshot);
function fixture(){const w=createWorld(),r=w.residents[0];w.residents=[r];w.clock.paused=false;r.inside=null;r.roomAt=null;r.at={x:10,y:10};r.activity={action:{type:'water',plotId:'field'},planId:'review',startedAt:w.minute,remaining:10,path:[],target:{...r.at},definition:'action/routine@1'};return {w,r};}
test('review: dead and outside residents never acquire a work pose from retained activity',()=>{
 const {w,r}=fixture();r.status='dead';assert.equal(personVisual(w,r).pose,'idle');r.status='alive';r.residency='outside';assert.equal(personVisual(w,r).pose,'idle');
});
test('review: scene removes all four cached frames on disappearance and world replacement',()=>{
 const {w,r}=fixture(),{scene,engine}=residentSceneHarness(),removed:string[]=[];
 engine.textures.remove=(key?:string)=>{if(key)removed.push(key);};
 scene.accept(snapshot(w));w.residents=[];scene.accept(snapshot(w));
 for(let i=0;i<4;i++)assert.ok(removed.includes(`person-${r.id}-${i}`));
 w.residents=[r];scene.accept(snapshot(w));removed.length=0;w.id+='-replacement';scene.accept(snapshot(w));
 for(let i=0;i<4;i++)assert.ok(removed.includes(`person-${r.id}-${i}`));
});
test('review: scene render and snapshot acceptance do not mutate simulation state',()=>{
 const {w}=fixture(),{scene}=residentSceneHarness(),before=structuredClone(w);scene.accept(snapshot(w));
 for(let t=0;t<2000;t+=100)scene.update(t);
 assert.deepEqual(w,before);
});
test('review: malformed and regional completion evidence does not produce a glint',()=>{
 const f=new WorkFeedback(),w={id:'review',minute:10,revision:1,events:[] as WorldEvent[]};f.inspect(w);
 const base:WorldEvent={id:'good',at:11,kind:'action',actors:['r'],witnesses:[],place:{x:1,y:1},text:'review',workCompleted:{residentId:'r',planId:'p',startedAt:10,action:'water'}};
 w.minute=11;w.revision=2;w.events=[
 {...base,id:'no-actor',actors:[]},
 {...base,id:'invalid-place',place:{x:NaN,y:1}},
 {...base,id:'missing-room-position',roomId:'room'},
 {...base,id:'invalid-start',workCompleted:{...base.workCompleted!,startedAt:12}},
 {...base,id:'wrong-kind',kind:'death'},
 {...base,id:'regional',regionalLocation:{routeId:'road',origin:'town',progress:2,duration:10}},
 ];
 assert.deepEqual(f.inspect(w),[]);
});

test('review: nonfinite or fractional work coordinates never reach pixel art',async()=>{
 const {atActionPosition}=await import('../src/client/action-position.js');
 const {personVisual}=await import('../src/client/person-pose.js');
 for(const value of [Infinity,-Infinity,NaN,.5]){
  const w=createWorld(),r=w.residents[0];r.inside=null;r.roomAt=null;r.at={x:value,y:5};
  r.activity={planId:'invalid-point',action:{type:'water',plotId:'p'},startedAt:w.minute,remaining:8,path:[],target:{x:value,y:5},definition:'action/routine@1'};
  assert.equal(atActionPosition(w,r),false);assert.equal(personVisual(w,r).pose,'idle');assert.equal(personVisual(w,r).focus,null);
 }
});
