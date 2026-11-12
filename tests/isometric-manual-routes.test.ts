import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import {isometricObserverRoute} from '../scripts/isometric-observer-route.js';
const route=isometricObserverRoute(),area={x:8,y:140,width:374,height:280,frameWidth:390,frameHeight:844};
test('manual fallback destinations remain 2D across panel changes and never revive the previous resident',()=>{
 for(const attrs of [{region:'forest'},{project:'synthetic-project'},{panel:'atlas'},{action:'trade-station'}]){
  const h=observerPreviewHarness();try{
   h.accept(route.snapshots[0]);h.toggle();h.viewArea(area,route.personId);
   const button=new ObserverElement();Object.assign(button.dataset,attrs);h.document.emit('click',{target:button});
   assert.equal(h.canvas.hidden,true);const before=h.frames.length;
   h.viewArea({...area,height:300},route.personId);h.window.emit('resize');
   assert.equal(h.canvas.hidden,true);assert.equal(h.frames.length,before);assert.equal(h.follow.state,null);
  }finally{h.dispose();}
 }
});
test('explicit animal location, home and full-map entry are retained instead of stale resident framing',()=>{
 for(const action of ['animal','home','atlas'] as const){
  const h=observerPreviewHarness();try{
   h.accept(route.snapshots[0]);h.toggle();h.viewArea(area,route.personId);
   const button=new ObserverElement();
   if(action==='animal')button.dataset.animalMap='animal/'+route.snapshots[0].world.industry!.animals[0].id;
   if(action==='home')button.dataset.action='home';
   h.document.emit('click',{target:action==='atlas'?h.atlas:button});
   const camera=structuredClone(h.model.camera),active=!h.canvas.hidden;
   h.viewArea({...area,height:300},route.personId);h.model.rebuild();
   assert.deepEqual(h.model.camera,camera,action);assert.equal(!h.canvas.hidden,active);assert.equal(h.follow.state,null);
  }finally{h.dispose();}
 }
});
