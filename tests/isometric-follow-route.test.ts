/** Real main follow branch + ValleyScene/ResidentFollow methods, with CPU DOM/render spies only. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {isometricResidentsFixture} from '../scripts/isometric-residents-fixture.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import type {World,Snapshot} from '../src/shared/types.js';
const snap=(world:World):Snapshot=>({world,serverTime:'synthetic-route',version:'integration',capabilities:{active:[],pending:[]}});
function setup(world:World){const real=residentSceneHarness(),h=observerPreviewHarness({x:13,y:10},real.scene);h.accept(snap(world));return {...real,h};}
function clickFollow(v:ReturnType<typeof setup>,id:string){
 const button=new ObserverElement();button.dataset.follow=id;v.h.document.emit('click',{target:button});
 const source=readFileSync(new URL('../src/client/main.ts',import.meta.url),'utf8'),branch=source.slice(source.indexOf(' if(button.dataset.follow)'),source.indexOf(' if(button.dataset.tile)'));
 const context={button,scene:v.scene,selection:null,closePanel(){},renderSelection(){}};runInNewContext('(function(){'+branch+'})()',context);return context.selection;
}
test('coverage route: real follow click and later snapshots keep verified carrier positions with stale patient coordinates',()=>{
 for(const patch of [{at:{x:-1,y:-1}},{at:{x:NaN,y:NaN}},{inside:'missing-old-room',roomAt:null}]){
  const f=isometricResidentsFixture();Object.assign(f.patient,patch);const v=setup(f.world);v.h.toggle();clickFollow(v,f.patient.id);
  assert.equal(v.scene.followState?.status,'following');assert.equal(v.h.canvas.hidden,false);assert.match(v.h.tray.querySelector('.preview-hit').textContent,/正在跟随/);
  assert.ok(Number.isFinite(v.camera.center.x)&&Number.isFinite(v.camera.center.y),'covered 2D camera never follows stale NaN sprites');
  assert.ok(Math.abs(v.h.model.centerPoint!.x-14.75)<1e-9);
  const next=structuredClone(f.world);next.revision++;const carrier=next.residents.find(r=>r.id===f.carrier.id)!;carrier.at={x:15,y:8};carrier.activity!.path=[{x:16,y:8}];carrier.activity!.travelProgress=.5;v.h.accept(snap(next));
  assert.equal(v.scene.followState?.status,'following');assert.ok(Math.abs(v.h.model.centerPoint!.x-16)<1e-9);assert.ok(Math.abs(v.h.model.centerPoint!.y-8.5)<1e-9);v.h.dispose();
 }
});

test('coverage route: ordinary 2D, explicit handback and disposal retain original follow rejection',()=>{
 for(const exit of ['ordinary','toggle','dispose'] as const){
  const f=isometricResidentsFixture();f.patient.at={x:-1,y:-1};const v=setup(f.world);
  if(exit!=='ordinary'){v.h.toggle();clickFollow(v,f.patient.id);assert.equal(v.scene.followState?.status,'following');if(exit==='toggle')v.h.toggle('2d');else v.h.dispose();}
  clickFollow(v,f.patient.id);assert.equal(v.scene.followState?.status,'stopped');assert.equal(v.scene.followState?.reason,'position-unavailable');if(exit!=='dispose')v.h.dispose();
 }
});

test('coverage route: handback restores ordinary 2D coordinates without writing the verified carrier anchor into the world',()=>{
 const f=isometricResidentsFixture();f.patient.at={x:1,y:1};const before=structuredClone(f.world),v=setup(f.world);v.h.toggle();clickFollow(v,f.patient.id);
 assert.ok(Math.abs(v.h.model.centerPoint!.x-14.75)<1e-9);v.h.toggle('2d');assert.equal(v.scene.followState?.status,'following');assert.deepEqual(v.camera.center,{x:24,y:31});assert.deepEqual(f.world,before);v.h.dispose();
});

test('coverage route: lost evidence stops active following and never silently resumes on later recovery',()=>{
 for(const mutate of [
  (w:World,id:string,carrier:string)=>{w.residents.find(r=>r.id===carrier)!.activity=null;},
  (w:World,id:string,carrier:string)=>{w.residents.find(r=>r.id===carrier)!.regionalLocation={origin:'outside',progress:1,duration:10} as NonNullable<World['residents'][number]['regionalLocation']>;},
  (w:World,id:string)=>{w.residents.find(r=>r.id===id)!.status='dead';},
  (w:World,id:string)=>{w.residents.find(r=>r.id===id)!.residency='outside';},
  (w:World,id:string)=>{w.residents.find(r=>r.id===id)!.regionalLocation={origin:'outside',progress:1,duration:10} as NonNullable<World['residents'][number]['regionalLocation']>;},
  (w:World,id:string)=>{w.residents=w.residents.filter(r=>r.id!==id);},
 ]){
  const f=isometricResidentsFixture();f.patient.at={x:1,y:1};const v=setup(f.world);v.h.toggle();clickFollow(v,f.patient.id);assert.equal(v.scene.followState?.status,'following');
  const invalid=structuredClone(f.world);invalid.revision++;mutate(invalid,f.patient.id,f.carrier.id);v.h.accept(snap(invalid));assert.equal(v.scene.followState?.status,'stopped');
  const recovered=structuredClone(f.world);recovered.revision+=2;v.h.accept(snap(recovered));assert.equal(v.scene.followState?.status,'stopped');v.h.dispose();
 }
});

test('coverage route: regional carriers stop following even when the patient retains a valid old room',()=>{
 for(const inside of ['synthetic-home','missing-old-room',null]){
  const f=isometricResidentsFixture();f.patient.inside=inside;f.patient.roomAt={x:3,y:5};const v=setup(f.world);v.h.toggle();clickFollow(v,f.patient.id);
  assert.equal(v.scene.followState?.status,'following');
  const next=structuredClone(f.world);next.revision++;next.residents.find(r=>r.id===f.carrier.id)!.regionalLocation={origin:'outside',progress:1,duration:10} as NonNullable<World['residents'][number]['regionalLocation']>;v.h.accept(snap(next));
  assert.equal(v.scene.followState?.status,'stopped','a hidden carrier must never route the patient to a stale personal room');assert.equal(v.scene.followState?.reason,'outside');
  const recovered=structuredClone(f.world);recovered.revision+=2;v.h.accept(snap(recovered));assert.equal(v.scene.followState?.status,'stopped');v.h.dispose();
 }
});

test('coverage route: a genuine indoor resident keeps the original verified room routing',()=>{
 const f=isometricResidentsFixture(),v=setup(f.world);v.h.toggle();clickFollow(v,f.sleeper.id);
 assert.equal(v.scene.followState?.status,'following');assert.equal(v.h.model.roomId,f.home.id);assert.equal(v.h.canvas.hidden,false);
 const next=structuredClone(f.world);next.revision++;v.h.accept(snap(next));assert.equal(v.scene.followState?.status,'following');assert.equal(v.h.model.roomId,f.home.id);assert.equal(v.h.canvas.hidden,false);v.h.dispose();
});

test('coverage route: world replacement clears identity and renderer errors revoke the temporary resolver',()=>{
 const f=isometricResidentsFixture();f.patient.at={x:-1,y:-1};const v=setup(f.world);v.h.toggle();clickFollow(v,f.patient.id);
 const replaced=structuredClone(f.world);replaced.id='new-synthetic-world';v.h.accept(snap(replaced));assert.equal(Boolean(v.scene.followState),false);
 clickFollow(v,f.patient.id);assert.equal(v.scene.followState?.status,'following');
 const invalid=structuredClone(replaced);invalid.revision++;invalid.buildings[0].door.x=NaN;v.h.accept(snap(invalid));assert.equal(v.h.canvas.hidden,true);assert.ok(v.h.warnings.length>0);
 const fixed=structuredClone(replaced);fixed.revision+=2;v.h.accept(snap(fixed));clickFollow(v,f.patient.id);assert.equal(v.scene.followState?.status,'stopped');assert.equal(v.scene.followState?.reason,'position-unavailable');v.h.dispose();
});
