import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storybookUIHarness} from './helpers/storybook-ui-dom.js';
test('live shell measures actual drawer and top bounds, deduplicates snapshots, restores desktop and releases viewport',()=>{
 const h=storybookUIHarness(true,'live');
 try{
  h.find('.storybook-ui-shell').rect={left:0,top:0,width:390,height:844};
  h.find('.storybook-ui-top').rect={left:0,top:0,width:390,height:140};
  h.dock.rect={left:0,top:764,width:390,height:80};
  h.find('.storybook-ui-card').rect={left:0,top:600,width:390,height:164};
  h.select();h.measure();let latest=h.viewportCalls.at(-1)!;
  assert.equal(latest.id,h.r.id);assert.equal(latest.area?.y,140);assert.equal(latest.area?.height,460);
  const n=h.viewportCalls.length;h.emit();h.measure();assert.equal(h.viewportCalls.length,n);
  h.find('.storybook-ui-card').rect.top=420;h.find('.storybook-ui-card').rect.height=344;h.find('.storybook-ui-card-toggle').click();
  assert.equal(h.viewportCalls.at(-1)?.area?.height,280);
  h.profile.click();h.panel.rect={left:0,top:300,width:390,height:464};h.measure();assert.equal(h.viewportCalls.at(-1)?.area?.height,160);
  h.escape();h.measure();assert.equal(h.viewportCalls.at(-1)?.area?.height,280);
  h.resize(false);assert.equal(h.viewportCalls.at(-1)?.area,null);
  h.handle.dispose();assert.deepEqual(h.viewportCalls.at(-1),{area:null,id:null});
 }finally{h.cleanup();}
});
test('fully covered mobile map sends explicit zero-area rather than pretending a full-screen camera',()=>{
 const h=storybookUIHarness(true,'live');try{
  h.find('.storybook-ui-shell').rect={left:0,top:0,width:390,height:844};
  h.find('.storybook-ui-top').rect={left:0,top:0,width:390,height:844};h.select();h.measure();
  assert.equal(h.viewportCalls.at(-1)?.area?.width,0);assert.equal(h.viewportCalls.at(-1)?.area?.height,0);
  h.find('.storybook-ui-top').rect.height=140;h.measure();assert.equal(h.viewportCalls.at(-1)?.area?.height,704);
 }finally{h.cleanup();}
});
test('regional travel never exposes stale local coordinates in the resident card',()=>{
 const h=storybookUIHarness(true,'live');try{
  (h.r as any).regionalLocation={regionId:'synthetic-away',at:{x:1,y:1}};
  h.select();h.flush();assert.match(h.find('.storybook-ui-location').textContent,/镇外旅途/);
  assert.doesNotMatch(h.find('.storybook-ui-location').textContent,/地图 20/);
 }finally{h.cleanup();}
});
