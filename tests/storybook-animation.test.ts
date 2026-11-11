/** Synthetic CPU contracts, including actual engine transitions. No live model or browser. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {StorybookAnimationPlayer, type StorybookPlayback} from '../src/client/storybook-animation.js';
import {parseStorybookAnimationBundle} from '../src/client/storybook-animation-assets.js';
import {isometricResidentsFixture, residentAction} from '../scripts/isometric-residents-fixture.js';
import {animationFixture, animationPin, freezeAnimationFixture} from './helpers/storybook-animation-fixture.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld, submitPlan} from '../src/world/engine.js';
import type {World} from '../src/shared/types.js';
const controls = (nowMs:number, patch:Partial<StorybookPlayback> = {}):StorybookPlayback => ({nowMs,connected:true,visible:true,reducedMotion:false,...patch});
function fixture() {
  const f=isometricResidentsFixture(), metadata=animationFixture(f.world.residents.map(r=>r.id));
  const bundle=parseStorybookAnimationBundle(metadata.atlas, metadata.animation, animationPin), player=new StorybookAnimationPlayer(bundle);
  player.accept(f.world);const record=(time:number,id=f.walk.id,patch:Partial<StorybookPlayback>={})=>player.sample(controls(time,patch)).records.find(r=>r.id===id)!;
  return {...f,player,record,bundle};
}
function advance(w:World) {w.minute+=.25;w.revision++;}
test('four world directions select four authored cels and preserve recorded fraction at every display time',()=>{
  for (const [dx,dy,facing] of [[0,-1,'north'],[1,0,'east'],[0,1,'south'],[-1,0,'west']] as const) {
    const f=fixture();f.walk.activity!.path=[{x:6+dx,y:3+dy},{x:6+dx*2,y:3+dy*2}];f.player.accept(f.world);
    const first=f.record(0), second=f.record(100), third=f.record(200);
    assert.equal(first.direction,facing);assert.equal(first.artwork?.frameIndex,0);assert.equal(second.artwork?.frameIndex,1);assert.equal(third.artwork?.frameIndex,2);
    assert.deepEqual(third.anchor,{x:6+dx*.5,y:3+dy*.5});assert.deepEqual(first.anchor,third.anchor);
  }
});
test('pause, disconnect, hidden and reduced motion freeze the current frame, never reset or catch up',()=>{
  for(const flag of ['paused','disconnected','hidden','reduced-motion'] as const){
    const f=fixture();f.record(0);const current=f.record(100);assert.equal(current.artwork?.frameIndex,1);
    const patch=flag==='disconnected'?{connected:false}:flag==='hidden'?{visible:false}:flag==='reduced-motion'?{reducedMotion:true}:{};
    if(flag==='paused'){f.world.clock.paused=true;f.player.accept(f.world);}
    const frozen=f.player.sample(controls(200,patch));assert.ok(frozen.freezeReasons.includes(flag));
    assert.equal(frozen.records.find(r=>r.id===f.walk.id)!.elapsedMs,current.elapsedMs);
    assert.equal(f.record(100000,f.walk.id,patch).elapsedMs,current.elapsedMs);
    if(flag==='paused'){f.world.clock.paused=false;f.player.accept(f.world);}
    assert.equal(f.record(100100).elapsedMs,current.elapsedMs);assert.equal(f.record(100200).elapsedMs,200);
  }
});
test('large display gaps do not replay missed animation and invalid/nonmonotonic time cannot advance phase',()=>{
  const f=fixture();f.record(0);f.record(100);
  const gap=f.player.sample(controls(10000));assert.ok(gap.freezeReasons.includes('long-gap'));assert.equal(gap.records.find(r=>r.id===f.walk.id)!.elapsedMs,100);
  for(const t of [-1,9999,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>f.record(t),/animation_clock/);
  assert.equal(f.record(10100).elapsedMs,200);
});
test('stopping changes clip immediately, retains only observed facing and distinguishes chosen wait from decision wait',()=>{
  const f=fixture();f.record(0);f.record(100);f.walk.at={x:7,y:3};residentAction(f.world,f.walk,{type:'wait',minutes:10});advance(f.world);f.player.accept(f.world);
  const idle=f.record(200);assert.equal(idle.clip,'idle');assert.equal(idle.direction,'east');assert.equal(idle.artwork?.frameIndex,0);assert.equal(idle.elapsedMs,0);assert.equal(idle.activity?.kind,'voluntary-wait');
  for(let t=300;t<=5200;t+=100)f.record(t);assert.equal(f.record(5200).artwork?.frameIndex,1);
  f.walk.activity=null;f.walk.plan=null;f.walk.decisionDue=f.world.minute;advance(f.world);f.player.accept(f.world);
  const waiting=f.record(5300);assert.equal(waiting.activity?.kind,'decision-wait');assert.equal(waiting.clip,'idle');assert.equal(waiting.elapsedMs,0);
  assert.equal(f.record(5400).elapsedMs,0);
});
test('a newer world snapshot with no actual movement stops limbs; progress resumes without moving past the saved first step',()=>{
  const f=fixture();f.record(0);f.record(100);advance(f.world);f.player.accept(f.world);
  assert.equal(f.record(200).elapsedMs,100);assert.match(f.record(300).reason!,/未记录步行进展/);
  f.player.accept(f.world);assert.equal(f.record(400).elapsedMs,100);
  f.walk.activity!.travelProgress=.75;advance(f.world);f.player.accept(f.world);const moved=f.record(500);
  assert.equal(moved.elapsedMs,200);assert.deepEqual(moved.anchor,{x:6.75,y:3});
});
test('unknown facing, absent bindings and absent optional pick do not invent a generic resident',()=>{
  const f=fixture();const idle=f.record(0,f.idle.id);assert.equal(idle.kind,'fallback');assert.equal(idle.direction,null);assert.match(idle.reason!,/朝向/);
  const metadata=animationFixture([]),unbound=new StorybookAnimationPlayer(parseStorybookAnimationBundle(metadata.atlas,metadata.animation,animationPin));unbound.accept(f.world);
  assert.match(unbound.sample(controls(0)).records.find(r=>r.id===f.walk.id)!.reason!,/身份或动作/);
  const staticOnly=new StorybookAnimationPlayer(parseStorybookAnimationBundle(metadata.atlas,null,animationPin));staticOnly.accept(f.world);assert.equal(staticOnly.sample(controls(0)).records.find(r=>r.id===f.walk.id)!.kind,'fallback');
});
test('unsupported illness, death, sleep, carrying and work never become healthy idle or ordinary walk',()=>{
  const f=fixture();const records=f.player.sample(controls(0)).records;
  for(const person of [f.worker,f.baby,f.ill,f.body,f.patient,f.carriedBody,f.carrier,f.bodyCarrier,f.hunt,f.culture,f.rest])assert.equal(records.find(r=>r.id===person.id)!.kind,'fallback',person.id);
  assert.equal(records.find(r=>r.id===f.sleeper.id)!.kind,'hidden');
  f.world.health!.cases.push({...f.world.health!.cases[0],personId:f.walk.id,severity:1,stage:'active' as any});advance(f.world);f.player.accept(f.world);assert.match(f.record(100).reason!,/伤病/);
});
test('blocked, missing, diagonal and corrupt routes fall back without speculative motion or destinations',()=>{
  for(const patch of [
    (f:ReturnType<typeof fixture>)=>{f.world.map.tiles[3*26+7]='water';},
    (f:ReturnType<typeof fixture>)=>{f.walk.activity!.path=[{x:7,y:4}];},
    (f:ReturnType<typeof fixture>)=>{f.walk.activity!.travelProgress=1.1;},
    (f:ReturnType<typeof fixture>)=>{delete (f.walk.activity as any).path;},
    (f:ReturnType<typeof fixture>)=>{f.walk.activity!.startedAt=f.world.minute+1;},
    (f:ReturnType<typeof fixture>)=>{f.walk.activity!.remaining=0;},
  ]){const f=fixture();patch(f);f.player.accept(f.world);const out=f.record(0);assert.equal(out.kind,'fallback');assert.equal(out.artwork,null);}
});
test('room walks use validated real layout; space changes discard previous heading and use no doorway fallback',()=>{
  const f=fixture();residentAction(f.world,f.sleeper,{type:'wait',minutes:10});f.sleeper.roomAt={x:3,y:5};f.sleeper.activity!.room={buildingId:f.home.id,mode:'work',target:{x:4,y:5},path:[{x:4,y:5}],progress:.5};
  const space={roomId:f.home.id,bounds:{x:0,y:0,width:f.layout.width,height:f.layout.height}};f.player.accept(f.world,space);
  const out=f.record(0,f.sleeper.id);assert.equal(out.clip,'walk');assert.deepEqual(out.anchor,{x:3.5,y:5});assert.equal(out.direction,'east');assert.equal(out.spaceId,f.home.id);
  f.sleeper.roomAt=null;advance(f.world);f.player.accept(f.world,space);const missing=f.record(100,f.sleeper.id);assert.equal(missing.kind,'fallback');assert.equal(missing.anchor,null);
});
test('stale snapshots reject atomically; new worlds/reset cannot retain old phase or facing',()=>{
  const f=fixture();f.record(0);f.record(100);const old=structuredClone(f.world);advance(f.world);f.walk.activity!.travelProgress=.75;f.player.accept(f.world);
  assert.throws(()=>f.player.accept(old),/stale_snapshot/);assert.deepEqual(f.record(200).anchor,{x:6.75,y:3});
  f.world.id='new-synthetic-world';f.walk.activity=null;f.walk.plan=null;f.player.accept(f.world);assert.equal(f.record(0).direction,null);
  f.player.reset();assert.equal(f.player.sample(controls(0)).records.length,0);
});
test('accepted metadata and snapshots detach from later writes; output is frozen and neither engine nor assets are modified',()=>{
  const f=fixture(),before=structuredClone(f.world);freezeAnimationFixture(f.world);f.player.accept(f.world);const out=f.record(0);assert.ok(Object.isFrozen(out.anchor));assert.ok(Object.isFrozen(out.artwork?.frame));assert.deepEqual(f.world,before);
  const mutable=structuredClone(before);f.player.accept(mutable);mutable.residents.find(r=>r.id===f.walk.id)!.at={x:20,y:19};assert.deepEqual(f.record(100).anchor,{x:6.5,y:3});
});
function engineFixture(){
  const world=createWorld(5401),r=world.residents[0];world.clock.paused=false;world.residents=[r];world.buildings=[];world.resources=[{id:'synthetic-berries',kind:'bush',at:{x:24,y:20},amount:5,max:5,regrowthDays:0,lastHarvest:0}];world.events=[];world.graves=[];
  world.map={width:40,height:40,tiles:Array(1600).fill('grass'),entrance:{x:0,y:0},name:'Synthetic animation route'};
  Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,knownResources:['synthetic-berries'],knownBuildings:[],knownPeople:[],memories:[],hunger:0,energy:100,health:100,plan:null,activity:null});
  const f=animationFixture([r.id]),player=new StorybookAnimationPlayer(parseStorybookAnimationBundle(f.atlas,f.animation,animationPin));
  const start=()=>assert.equal(submitPlan(world,{id:'synthetic-animation-plan-'+world.revision,actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:'action/routine@1',intention:'Scripted synthetic animation regression, not autonomous behavior',actions:[{type:'gather',resourceId:'synthetic-berries',quantity:1}]}).ok,true);
  return {world,r,player,start};
}
test('actual synthetic engine route plays walk then on-site pick, stops at real completion and never produces its own outcomes',()=>{
  const f=engineFixture();f.start();let walked=0,picked=0,time=0;
  for(let step=0;step<100&&(f.r.plan||f.r.activity);step++){
    stepWorld(f.world,.25);const before=structuredClone(f.world);f.player.accept(f.world);const record=f.player.sample(controls(time+=100)).records[0];
    if(record.clip==='walk'){walked++;assert.equal(record.direction,'east');}
    if(record.clip==='pick'){picked++;assert.equal(record.activity?.kind,'active');assert.equal(f.r.activity?.path.length,0);assert.equal(Math.abs(f.r.at.x-f.world.resources[0].at.x)+Math.abs(f.r.at.y-f.world.resources[0].at.y),1);}
    assert.deepEqual(f.world,before);
  }
  assert.ok(walked>0);assert.ok(picked>0);assert.equal(f.r.lastFailure,null);assert.ok(f.world.events.some(e=>e.workCompleted?.action==='gather'));
  f.player.accept(f.world);assert.notEqual(f.player.sample(controls(time+100)).records[0].clip,'pick');
});
test('resource depletion and wrong-target records immediately stop picking without inventing successful food or work',()=>{
  const f=engineFixture();f.r.at={x:23,y:20};f.start();stepWorld(f.world,.25);f.player.accept(f.world);assert.equal(f.player.sample(controls(0)).records[0].clip,'pick');
  f.world.resources[0].amount=0;advance(f.world);f.player.accept(f.world);const depleted=f.player.sample(controls(100)).records[0];assert.equal(depleted.kind,'fallback');assert.equal(depleted.artwork,null);
  f.world.resources[0].amount=5;f.r.activity!.target={x:22,y:20};advance(f.world);f.player.accept(f.world);assert.equal(f.player.sample(controls(200)).records[0].kind,'fallback');
  assert.equal(f.world.events.some(e=>e.workCompleted),false);
});
test('animation remains unconnected to default views, feed, static observer and production atlas',()=>{
  for(const file of ['main.ts','scene.ts','isometric-observer.ts','observer-map.ts','storybook-observer.ts','storybook-phaser.ts','storybook-synthetic-atlas.ts'])assert.doesNotMatch(readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8'),/storybook-animation/);
  for(const file of ['storybook-animation.ts','storybook-animation-assets.ts'])assert.doesNotMatch(readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8'),/\b(?:fetch|EventSource|WebSocket|XMLHttpRequest|stepWorld|submitPlan|setTimeout|setInterval)\s*\(|(?:Date|performance)\.now\s*\(|process\.env/);
});
