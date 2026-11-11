/** Independent offline review: synthetic worlds and mocked surfaces, not browser rendering. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot,Vec} from '../src/shared/types.js';
import type {ObserverMap} from '../src/client/observer-map.js';
import {buildStorybookPlan,pickStorybookPlan,STORYBOOK_PROTOTYPE_LIMITS} from '../src/client/storybook-render-plan.js';
import {createStorybookObserver} from '../src/client/storybook-observer.js';
import {syntheticManifest,syntheticAtlasPixels,SYNTHETIC_WIDTH,SYNTHETIC_HEIGHT} from '../src/client/storybook-synthetic-atlas.js';
import {projectStorybook} from '../src/client/storybook-geometry.js';
const atlas={manifest:syntheticManifest,width:SYNTHETIC_WIDTH,height:SYNTHETIC_HEIGHT,pixels:syntheticAtlasPixels()};
const bounds={x:20,y:15,width:32,height:32};
const fixture=():Snapshot=>({world:createWorld(5401),serverTime:'review synthetic',version:'review synthetic',capabilities:{active:[],pending:[]}});

test('independent review: bad carrier claims do not draw passenger at old confirmed-looking position',()=>{
 const s=fixture(),r=s.world.residents[0];r.status='dead';r.body={...r.body,carriedBy:'nonexistent'} as typeof r.body;
 const plan=buildStorybookPlan(s,atlas,bounds);
 assert.equal(plan.draws.some(d=>d.selection?.id===r.id),false);
 assert.ok(plan.unknownResidents.some(d=>d.id===r.id&&d.reason.includes('携带者')));
});
test('independent review: malformed relationship ledger fails closed for all resident locations',()=>{
 const s=fixture();s.world.health={transports:null} as any;
 const plan=buildStorybookPlan(s,atlas,bounds);
 assert.equal(plan.draws.filter(d=>d.selection?.kind==='person').length,0);
 assert.equal(plan.unknownResidents.length,s.world.residents.length);
 assert.ok(plan.draws.some(d=>d.selection?.kind==='building'));
});
test('independent review: explicit population budget admits residents before buildings without source mutation',()=>{
 const s=fixture(),template=s.world.residents[0];
 s.world.residents=Array.from({length:200},(_,i)=>({...structuredClone(template),id:`review-${i}`,at:{x:21+i%20,y:16+Math.floor(i/20)}}));
 const before=JSON.stringify(s),plan=buildStorybookPlan(s,atlas,bounds);
 assert.equal(plan.draws.filter(d=>d.selection?.kind==='person').length,STORYBOOK_PROTOTYPE_LIMITS.objects);
 assert.equal(plan.draws.some(d=>d.selection?.kind==='building'),false);
 assert.ok(plan.omittedObjects>=8);assert.ok(plan.notices.some(n=>n.includes('预算省略')));
 assert.equal(JSON.stringify(s),before);
 s.world.residents=Array.from({length:513},(_,i)=>({...template,id:`over-${i}`}));
 assert.throws(()=>buildStorybookPlan(s,atlas,bounds),/record_limit/);
});
test('independent review: fractional motion does not reuse or collapse legacy facing',()=>{
 const s=fixture(),r=s.world.residents[0];r.at={x:30,y:30};
 r.activity={action:{type:'wait',minutes:1},target:{x:29,y:30},path:[{x:29,y:30}],travelProgress:.75,startedAt:0,remaining:1,planId:'review',definition:'action/routine@1'};
 const draw=buildStorybookPlan(s,atlas,bounds).draws.find(d=>d.selection?.id===r.id)!;
 assert.equal(draw.facing,'northwest');assert.deepEqual(draw.position,projectStorybook({x:29.75,y:30.5}));
 r.activity.travelProgress=1.01;
 const fallback=buildStorybookPlan(s,atlas,bounds).draws.find(d=>d.selection?.id===r.id)!;
 assert.equal(fallback.assetId,'marker');assert.equal(fallback.facing,null);assert.deepEqual(fallback.position,projectStorybook({x:30.5,y:30.5}));
});
test('independent review: a transparent front frame reveals a different opaque object behind',()=>{
 const plan=buildStorybookPlan(fixture(),atlas,bounds),base=plan.draws.find(d=>d.selection?.kind==='person')!;
 const pixels=new Uint8ClampedArray(atlas.pixels.length),frontFrame={rect:{x:32,y:16,width:32,height:48},foot:{x:16,y:48}};
 // Same geometry, different source frame. Back opaque, front transparent at one exact sample.
 const x=16,y=30;pixels[((base.frame.rect.y+y)*atlas.width+base.frame.rect.x+x)*4+3]=255;
 const front={...base,key:'review-front',assetId:'resident-route',frame:frontFrame,selection:{kind:'building' as const,id:'review-front'}};
 const point={x:base.topLeft.x+x+.25,y:base.topLeft.y+y+.25};
 assert.equal(pickStorybookPlan({...plan,draws:[base,front]},{...atlas,pixels},point,{origin:{x:0,y:0},zoom:1})?.selection?.id,base.selection!.id);
 pixels[((frontFrame.rect.y+y)*atlas.width+frontFrame.rect.x+x)*4+3]=1;
 assert.equal(pickStorybookPlan({...plan,draws:[base,front]},{...atlas,pixels},point,{origin:{x:0,y:0},zoom:1})?.selection?.id,'review-front');
});
test('independent review: world switch resets requested window; disposed callbacks cannot repopulate stale plan',()=>{
 let snapshot=fixture(),listener:((s:Snapshot|null,c:boolean)=>void)|undefined,pick:((at:Vec)=>void)|undefined;
 let disposed=0,unsubscribed=0,selected=0;
 const observer={currentSnapshot:()=>snapshot,currentRoom:()=>null,currentTile:()=>({x:35,y:30}),subscribe:(fn:typeof listener)=>{listener=fn;return()=>{unsubscribed++;};},subscribeRoom:()=>()=>{unsubscribed++;},select:()=>{selected++;}} as unknown as ObserverMap;
 const handle=createStorybookObserver(observer,atlas,{present:()=>{},subscribePick:fn=>{pick=fn;return()=>{unsubscribed++;};},dispose:()=>{disposed++;}});
 handle.setWindow({x:0,y:0,width:1,height:1});handle.activate();assert.equal(handle.plan!.bounds.width,1);
 snapshot=fixture();snapshot.world.id='review-different-world';listener!(snapshot,true);assert.equal(handle.plan!.bounds.width,24);
 handle.dispose();listener!(snapshot,true);pick!({x:0,y:0});handle.activate();
 assert.equal(handle.plan,null);assert.equal(disposed,1);assert.equal(unsubscribed,3);assert.equal(selected,0);
});
