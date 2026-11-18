import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMvpSession, chooseMvpAction} from '../build/server/godot-mvp.js';
import {WorldStore} from '../build/server/store.js';
import {stepWorld, submitPlan} from '../build/world/engine.js';
import {canContactSpring} from '../build/world/spring-observation.js';

globalThis.fetch=()=>{throw Error('network must not run in this local check');};
const person=(w,id)=>w.residents.find(r=>r.id===id);
const stock=(w,id)=>w.resources.find(s=>s.id===id);
function plan(w,r,id,action){
 assert.equal(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'synthetic gather contention',actions:[action]}).ok,true);
}
function fixture(){
 const w=createMvpSession().world;
 const [winner,loser,...others]=w.residents,spring=w.resources.find(s=>s.kind==='spring');
 const contact=[{x:spring.at.x-1,y:spring.at.y},{x:spring.at.x+1,y:spring.at.y},{x:spring.at.x,y:spring.at.y-1},{x:spring.at.x,y:spring.at.y+1}]
  .find(at=>canContactSpring(w,{...winner,at,inside:null,roomAt:null},spring));
 assert.ok(contact);
 for(const r of [winner,loser]){
  Object.assign(r,{at:{...contact},inside:null,roomAt:null,inventory:{},hunger:10,energy:95,knownResources:[spring.id]});
  w.mvpDrinking.thirst[r.id]=60;
 }
 spring.amount=1;
 const gather={type:'gather',quantity:1,resourceId:spring.id};
 plan(w,winner,'winner',gather);
 for(const r of others)plan(w,r,'waiting:'+r.id,{type:'wait',minutes:30});
 const actorIds=[winner.id,loser.id];
 // Perform seven actual quarter-minute ticks; one remains before settlement.
 for(let i=0;i<7;i++)stepWorld(w,.25);
 assert.equal(winner.activity.remaining,.25);
 assert.equal(spring.amount,1);
 assert.deepEqual(chooseMvpAction(w,loser).action,gather);
 return {w,gather,actorIds};
}
function winnerSettled(w,gather,[winner,loser]){
 assert.equal(stock(w,gather.resourceId).amount,0);
 assert.equal(person(w,winner).inventory.water,1);
 assert.equal(person(w,loser).inventory.water??0,0);
 assert.equal(person(w,loser).activity,null);
 assert.equal(person(w,loser).plan,null);
}
{
 const {w,gather,actorIds}=fixture(),dir=mkdtempSync(join(tmpdir(),'mvp-gather-'));
 try{
  const path=join(dir,'rules.db');
  let store=new WorldStore(path,{allowMvpClimate:true});
  store.commit(w,null);store.close();
  store=new WorldStore(path,{allowMvpClimate:true});
  const s=createMvpSession({world:store.loadForRuntime(),persistent:true,commit:(draft,rev)=>store.commit(draft,rev)});
  s.advance(1);
  assert.equal(s.snapshot().mvp.fault,null);
  assert.equal(s.world.minute,w.minute+1);
  winnerSettled(s.world,gather,actorIds);
  assert.equal(person(s.world,actorIds[1]).decisionDue,s.world.minute);
  store.close();
  store=new WorldStore(path,{allowMvpClimate:true});
  const recovered=store.loadForRuntime();winnerSettled(recovered,gather,actorIds);
  const continued=createMvpSession({world:recovered,persistent:true,commit:(draft,rev)=>store.commit(draft,rev)});
  continued.advance(1);
  assert.equal(continued.world.minute,w.minute+2);
  assert.equal(continued.snapshot().mvp.fault,null);
  assert.equal(continued.snapshot().mvp.decisions[actorIds[1]],1);
  assert.equal(stock(continued.world,gather.resourceId).amount,0);
  assert.equal(person(continued.world,actorIds[0]).inventory.water??0,1);
  store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
}
{
 const {w,gather,actorIds}=fixture(),actionFailures=[];
 plan(w,person(w,actorIds[1]),'eligible-new-start',gather);
 stepWorld(w,.25,{actionFailures});winnerSettled(w,gather,actorIds);
 assert.deepEqual(actionFailures,[{actorId:actorIds[1],planId:'eligible-new-start',actionType:'gather',
  code:'resource_stock_depleted_before_gather',resourceId:gather.resourceId,quantity:1,available:0}]);
}
for(const kind of ['old-pending','missing','unknown','bad-quantity','bad-kind','negative','not-finite']){
 const {w,gather,actorIds}=fixture(),loser=person(w,actorIds[1]);
 const a={...gather},source=stock(w,gather.resourceId);
 // Keep the first winner only where its legitimate depletion is the test.
 if(kind!=='old-pending'){
  const winner=person(w,actorIds[0]);winner.plan=null;winner.activity=null;
  plan(w,winner,'unrelated-idle',{type:'wait',minutes:30});
 }
 if(kind==='missing')a.resourceId='missing';
 if(kind==='unknown')loser.knownResources=[];
 if(kind==='bad-quantity')a.quantity=0;
 if(kind==='bad-kind')source.kind='corrupt';
 if(kind==='negative')source.amount=-1;
 if(kind==='not-finite')source.amount=NaN;
 plan(w,loser,'preexisting-pending',a);
 const raw=structuredClone(w),actionFailures=[];
 stepWorld(raw,.25,{actionFailures});
 assert.equal(actionFailures.length,kind==='old-pending'?1:0,kind);
 const s=createMvpSession({world:w});s.advance(1);
 assert.equal(s.world.minute,w.minute,kind);
 assert.match(s.snapshot().mvp.fault??'',new RegExp('MVP action failed for '+loser.id+':'),kind);
 assert.equal(person(s.world,loser.id).inventory.water??0,0,kind);
}
if(process.argv[2]){
 const path=process.argv[2],bytes=readFileSync(path);
 const c=JSON.parse(bytes);
 assert.equal(c.minute,108655);assert.equal(c.status,'fault');
 const w=structuredClone(c.world);
 w.clock={...w.clock,paused:false,reason:null};
 const id='mvp-supply-tree-2',before=stock(w,id),lin=person(w,'lin'),yan=person(w,'yan');
 assert.equal(before.amount,1);assert.equal(lin.activity.remaining,1);assert.equal(yan.activity,null);
 assert.deepEqual(chooseMvpAction(w,yan).action,{type:'gather',resourceId:id,quantity:1});
 const s=createMvpSession({world:w});s.advance(1);
 assert.equal(s.world.minute,108656);assert.equal(s.snapshot().mvp.fault,null);
 assert.equal(stock(s.world,id).amount,0);
 assert.equal(person(s.world,'lin').inventory.wood,(lin.inventory.wood??0)+1);
 assert.equal(person(s.world,'yan').inventory.wood??0,yan.inventory.wood??0);
 assert.equal(person(s.world,'yan').decisionDue,108656);
 assert.ok(s.world.events.some(e=>e.at===108656&&e.actors.includes('lin')&&e.text.includes('采集了 1 份木材')));
 s.advance(1);assert.equal(s.world.minute,108657);assert.equal(s.snapshot().mvp.decisions.yan,2);
 assert.deepEqual(readFileSync(path),bytes);
 console.log('detached original day75: rightful +1 wood, loser +0, next decision, file unchanged');
}
console.log('gather contention, fractional advancement, persistence and fail-stop negatives passed');
