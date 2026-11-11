/** Source/normal-flow geometry checks, not a native browser layout or touch test. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {observerPreviewHarness} from './helpers/observer-preview-dom.js';
import {isometricObserverRoute} from '../scripts/isometric-observer-route.js';
const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const css=source('src/client/isometric-observer.css');
const block=(selector:string)=>{const line=css.split('\n').find(line=>line.startsWith(selector+'{'));assert.ok(line,selector);return line.slice(selector.length+1,line.indexOf('}'));};

test('formal HUD layout: status, room banner and observer controls share one vertical flow',()=>{
 const main=source('src/client/main.ts'),observer=source('src/client/isometric-observer.ts');
 assert.match(main,/<div class="observer-hud" id="observer-hud">\s*<div class="world-state" id="world-state"[^\n]+\n\s*<div class="room-banner hidden" id="room-banner"><\/div>\s*<\/div>/);
 assert.match(observer,/getElementById\('observer-hud'\)!\.append\(tray\)/);
 const hud=block('.observer-hud');for(const declaration of ['display:flex','flex-direction:column','gap:8px','align-items:flex-start','overflow-y:auto'])assert.ok(hud.includes(declaration),declaration);
 const children=block('.observer-hud > .world-state,.observer-hud > .room-banner,.observer-hud > .isometric-observer');
 for(const declaration of ['position:static','top:auto','left:auto','bottom:auto','transform:none','flex:none','margin:0','max-width:100%'])assert.ok(children.includes(declaration),declaration);
 assert.doesNotMatch(children,/display:none|visibility:hidden|opacity:0/);
 assert.doesNotMatch(block('.isometric-observer'),/position:fixed|top:|left:/);
 assert.doesNotMatch(css,/\.isometric-observer\{[^}]*\btop:\s*(?:106|112)px/);
});

test('formal HUD layout: desktop, mobile, wrapped status and short-screen boundaries cannot overlap flow children',()=>{
 // Use the actual CSS anchors/gap and declared non-shrinking border-box flow.
 // Heights represent independent text wrapping cases; a browser still owns font shaping.
 const gap=Number(block('.observer-hud').match(/gap:(\d+)px/)![1]);
 assert.match(css,/@media\(max-width:700px\)\{\.observer-hud\{--hud-top:80px;--hud-left:16px;--hud-right:16px\}/);
 assert.match(css,/@media\(max-height:600px\)\{\.observer-hud\{--hud-top:79px;--hud-bottom:88px\}/);
 assert.match(css,/max-height:max\(0px,calc\(100dvh - var\(--hud-top\) - var\(--hud-bottom\)\)\)/);
 assert.match(source('src/client/styles.css'),/\*\{box-sizing:border-box\}/);
 for(const fixture of [
  {name:'desktop default',width:1280,height:800,top:94,left:28,bottom:100,heights:[29.6,0,47]},
  {name:'desktop room',width:1280,height:800,top:94,left:28,bottom:100,heights:[29.6,66,47]},
  {name:'phone room',width:390,height:844,top:80,left:16,bottom:100,heights:[42,72,80]},
  {name:'long disconnected status',width:320,height:568,top:79,left:16,bottom:88,heights:[128,96,240]},
  {name:'short landscape',width:844,height:390,top:79,left:20,bottom:88,heights:[50,68,160]},
 ]){
  const children=fixture.heights.filter(height=>height>0),positions:Array<{top:number;bottom:number}>=[];let cursor=fixture.top;
  for(const height of children){positions.push({top:cursor,bottom:cursor+height});cursor+=height+gap;}
  for(let i=1;i<positions.length;i++)assert.ok(positions[i].top>=positions[i-1].bottom+gap,fixture.name);
  assert.ok(Math.min(480,fixture.width-2*fixture.left)+2*fixture.left<=fixture.width,fixture.name);
  const viewportBottom=fixture.height-fixture.bottom,contentBottom=positions.at(-1)!.bottom;
  assert.ok(Math.min(contentBottom,viewportBottom)<=viewportBottom,fixture.name);
  // Overflow scrolls within the HUD instead of shrinking cards over earlier status/room text.
  if(contentBottom>viewportBottom)assert.ok(block('.observer-hud').includes('overflow-y:auto'),fixture.name);
 }
});

test('formal HUD controls: home reset is disabled in 2D and enabled only while the isometric view is active',()=>{
 const h=observerPreviewHarness(),reset=h.tray.querySelector('[data-reset]');reset.attrs.set('data-reset','');
 assert.equal(reset.disabled,true);h.accept(isometricObserverRoute().snapshots[0]);assert.equal(reset.disabled,true);
 h.tray.emit('click',{target:reset});assert.equal(h.frames.length,0);
 h.handle.activate();assert.equal(reset.disabled,false);h.tray.emit('click',{target:reset});assert.ok(h.frames.length>0);
 h.handle.deactivate();assert.equal(reset.disabled,true);h.dispose();
});

test('formal HUD layout: long mobile status retains the external world-edition badge reservation',()=>{
 const mobile=css.slice(css.indexOf('@media(max-width:700px)'),css.indexOf('@media(max-height:600px)'));
 assert.match(mobile,/\.observer-hud > \.world-state\{max-width:min\(100%,calc\(100vw - 125px\)\)\}/);
 assert.ok(css.indexOf(mobile)>css.indexOf('.observer-hud > .world-state,'),'same-specificity mobile rule wins after shared max-width');
 assert.match(source('src/client/styles.css'),/\.sample-badge\{position:fixed;right:16px;top:80px;font-size:9px;padding:5px 8px;gap:5px\}/);
 // Preserve the original mobile 125px exclusion: 16px HUD left, 16px badge right,
 // and a 93px badge reservation. This checks allocated boxes, not font rasterization.
 for(const width of [320,390,480,600,700]){
  const hudWidth=Math.min(480,width-32),statusWidth=Math.min(hudWidth,width-125),statusRight=16+statusWidth;
  for(const badgeWidth of [80,93])assert.ok(statusRight<=width-16-badgeWidth,JSON.stringify({width,statusRight,badgeWidth}));
  assert.ok(statusWidth<=hudWidth,'status cannot overflow the capped desktop-sized HUD');
  if(width===390)assert.equal(statusRight,281,'long status stays left of the reserved badge box');
 }
 assert.ok(block('.observer-hud > .world-state,.observer-hud > .room-banner,.observer-hud > .isometric-observer').includes('overflow-wrap:anywhere'));
 assert.doesNotMatch(mobile,/world-state\{[^}]*display:none|world-state\{[^}]*visibility:hidden|world-state\{[^}]*opacity:0/);
});
