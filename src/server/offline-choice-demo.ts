import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {createMvpSession} from './godot-mvp.js';
import {createSeasonalMemoryTransport,startOfflineSeasonalModel} from './godot-mvp-seasonal-model.js';
import {seasonalModelContext} from './seasonal-model-context.js';
import {prepareModelDecision} from './decisions.js';
import {modelRequestPayload} from './model-completion.js';
import {modelDigest,seasonalModelPolicy} from './seasonal-model-ledger.js';
import {WorldStore} from './store.js';
import {assertGodotWebExport,serveGodotWeb} from './godot-web.js';
import {stepWorld,submitPlan} from '../world/engine.js';
import {preservationStation} from '../world/mvp-preservation.js';
import {PRESERVATION_COST,PRESERVATION_LIFE,PRESERVATION_WORK} from '../shared/mvp-preservation.js';
import {AGRICULTURE_WORK_MINUTES} from '../world/mvp-agriculture.js';
import {AGRICULTURE_MEAL_RECIPE} from '../shared/mvp-meals.js';
import type {Resident,World,Action} from '../shared/types.js';

export const OFFLINE_CHOICE_DEMO_PATH='/ai-town/api/seasonal-model/demo';
const maxTicks=150;
const modes=['cook','preserve','invalid'] as const;
type Branch=typeof modes[number];
const keys=['springRoot','fruit','water','wood','meal','preserve'] as const;
type Stock=Record<typeof keys[number],number>;
const stock=(r:Resident)=>Object.fromEntries(keys.map(k=>[k,r.inventory[k]??0])) as Stock;
const actor=(w:World,id:string)=>w.residents.find(r=>r.id===id)!;
const diff=(a:Stock,b:Stock)=>Object.fromEntries(keys.map(k=>[k,b[k]-a[k]])) as Stock;
const ruleCosts={
 cook:{items:{springRoot:AGRICULTURE_MEAL_RECIPE.roots,water:AGRICULTURE_MEAL_RECIPE.water},durationMinutes:AGRICULTURE_WORK_MINUTES.cook},
 preserve:{items:{...PRESERVATION_COST.preserve},durationMinutes:PRESERVATION_WORK.preserve},
};
const actionMatches=(a:Action,id:Branch)=>id==='cook'?a.type==='mvpAgriculture'&&a.operation==='cook'&&a.cultivar==='spring':
 id==='preserve'&&a.type==='mvpPreservation'&&a.operation==='preserve';
function fixture(){
 const w=createMvpSession().world;
 const r=w.residents[0],station=preservationStation(w,r);
 assert.ok(station);assert.equal(w.schemaVersion,1);
 // Explicit generated demonstration inputs; never load user/archive state.
 Object.assign(r,{at:{...station.building.door},inside:station.building.id,roomAt:{...station.at},hunger:15,energy:95,
  inventory:{wood:7,stone:6,fruit:2,water:2,springRoot:2}});
 function assign(person:Resident,action:Action){
  const result=submitPlan(w,{id:'demo-fixture:'+person.id,actorId:person.id,actorRevision:person.revision,createdAt:w.minute,
   definition:w.activeDefinitions['action/routine'],intention:'离线演示准备',actions:[action]});
  assert.equal(result.ok,true,result.error);
 }
 for(const other of w.residents.slice(1))assign(other,{type:'wait',minutes:720});
 assign(r,{type:'mvpPreservation',operation:'install'});
 for(let i=0;!w.mvpPreservation!.installed&&i<maxTicks;i++)stepWorld(w,1);
 assert.ok(w.mvpPreservation!.installed,'fixture actual station work did not complete');
 assert.equal(r.inventory.stone,0);
 assert.equal(r.plan,null);assert.equal(r.activity,null);
 assert.deepEqual(stock(r),{springRoot:2,fruit:2,water:2,wood:1,meal:0,preserve:0});
 return {w,r};
}
function readBranch(path:string){
 const store=new WorldStore(path,{allowMvpClimate:true,seasonalModel:true});
 try{const w=store.load();assert.ok(w);return {w,ledger:store.seasonalLedger(w)};}
 finally{store.close();}
}
export async function runOfflineChoiceDemo(){
 const {w,r}=fixture(),context=seasonalModelContext(w,r);
 const prepared=prepareModelDecision(context,undefined,seasonalModelPolicy.model);
 const published=(['cook','preserve'] as const).map(id=>{
  const choice=prepared.choices.find(c=>actionMatches(c.action,id));
  assert.ok(choice,'target option not permitted in real menu: '+id);
  return {id,choice,public:{id,label:choice.label,ruleCosts:ruleCosts[id]}};
 });
 const exactPayload=modelRequestPayload(seasonalModelPolicy.model,prepared.messages,0.25);
 const dir=mkdtempSync(join(tmpdir(),'valley-offline-choice-'));
 const before=stock(r), startMinute=w.minute;
 const evidence=(branch:Branch,final:World)=>{
  if(branch==='invalid')return {kind:'choice-rejected' as const,minute:final.minute,quantity:0};
  if(branch==='cook'){
   const e=final.events.slice(w.events.length).find(e=>e.actors.length===1&&e.actors[0]===r.id&&e.mvpMeal?.kind==='cooked');
   assert.ok(e&&e.mvpMeal?.kind==='cooked'&&e.mvpMeal.cultivar==='spring'&&e.agriculture);
   assert.equal(final.mvpAgriculture?.receipts[e.agriculture.executionId]?.eventId,e.id);
   return {kind:'cooked' as const,minute:e.at,quantity:e.mvpMeal.meal};
  }
  const a=final.mvpPreservation!.accounts[r.id],newLots=a.lots.filter(l=>l.producedAt>startMinute);
  assert.equal(newLots.length,1);
  const lot=newLots[0],receipt=final.mvpPreservation!.receipts[lot.id];
  assert.ok(receipt&&receipt.actorId===r.id&&receipt.operation==='preserve');
  assert.ok(final.events.slice(w.events.length).some(e=>e.id===receipt.eventId&&e.actors.length===1&&e.actors[0]===r.id));
  assert.equal(lot.quantity,2);assert.equal(lot.expiresAt,lot.producedAt+PRESERVATION_LIFE);
  return {kind:'preserved' as const,minute:receipt.at,quantity:lot.quantity,expiresAt:lot.expiresAt};
 };
 try {
  const branches=[];
  for(const id of modes){
   const database=join(dir,id+'.sqlite');
   const startStore=new WorldStore(database,{allowMvpClimate:true,seasonalModel:true});
   try{startStore.commit(w,null);}finally{startStore.close();}
   const baseline=readBranch(database);
   assert.deepEqual(baseline.w,w);assert.equal(baseline.ledger,null);
   const memory=createSeasonalMemoryTransport();
   let handle=await startOfflineSeasonalModel({mode:'offline-seasonal',database,transport:memory.transport});
   const statusBefore=handle.status();
   assert.equal(statusBefore.requests,0);
   try{
    const pending=handle.pump();void pending.catch(()=>{});
    for(let i=0;i<10&&memory.requests().length===0;i++)await yieldTurn();
    const call=memory.requests()[0];assert.ok(call);
    assert.equal(memory.requests().length,1);assert.equal(call.actorId,r.id);assert.equal(call.payload,exactPayload);
    const choiceId=id==='invalid'?999:Number(published.find(x=>x.id===id)!.choice.id);
    memory.reply(0,{content:JSON.stringify({choice:choiceId}),finish:'stop'});
    const terminal=await pending;
    assert.equal(terminal.requests,1);assert.equal(terminal.accepted,id==='invalid'?0:1);
   }finally{await handle.close();}
   const accepted=readBranch(database),request=accepted.ledger!.requests[0],selected=actor(accepted.w,r.id);
   assert.equal(accepted.ledger!.requests.length,1);
   assert.equal(request.state,id==='invalid'?'rejected':'accepted');
   assert.equal(accepted.w.minute,startMinute);assert.deepEqual(stock(selected),before);
   if(id==='invalid')assert.ok(!selected.plan&&!selected.activity);
   else assert.ok(selected.plan?.id===request.id+':plan'&&selected.plan.actions.length===1&&actionMatches(selected.plan.actions[0],id));
   // Restart with a new memory capability. Work consumes game time, but must
   // not dispatch a duplicate request or apply another choice while settling.
   const resumed=createSeasonalMemoryTransport();
   handle=await startOfflineSeasonalModel({mode:'offline-seasonal',database,transport:resumed.transport});
   try{
    if(id!=='invalid'){
     for(let i=0;i<maxTicks;i++){
      const tick=await handle.pump();
      assert.equal(tick.minute,startMinute+i+1);
      assert.equal(tick.requests,1);
      const phase=tick.phases[0];
      if(phase==='deciding')break;
     }
    }
    assert.equal(resumed.requests().length,0);
   }finally{await handle.close();}
   const final=readBranch(database),after=stock(actor(final.w,r.id)),changes=diff(before,after),result=evidence(id,final.w);
   assert.deepEqual(final.ledger,accepted.ledger);
   assert.equal(memory.requests().length,1);
   const wanted=id==='cook'?[-2,0,-1,0,1,0]:id==='preserve'?[0,-2,-1,-1,0,2]:[0,0,0,0,0,0];
   assert.deepEqual(Object.values(changes),wanted);
   if(id==='invalid')assert.deepEqual(final.w,accepted.w);
   else{assert.ok(final.w.minute>=startMinute+ruleCosts[id].durationMinutes);assert.equal(result.minute,final.w.minute);}
   const readonly=await startOfflineSeasonalModel({mode:'offline-seasonal',database});
   try{assert.equal((await readonly.pump()).minute,final.w.minute);}
   finally{await readonly.close();}
   assert.deepEqual(readBranch(database),final,'read-only reopening changed terminal state');
   branches.push({choiceId:id,state:id==='invalid'?'rejected' as const:'completed' as const,startMinute,endMinute:final.w.minute,before:stock(r),after,changes,evidence:result});
  }
  return {schemaVersion:1 as const,driver:'synthetic-model-decisions' as const,label:'离线合成居民选择演示（非真实模型）',
   realModelCalls:0 as const,fixture:{source:'generated-fixture' as const,initialWorldDigest:modelDigest(JSON.stringify(w)),actor:r.name,startMinute,stock:before},
   choices:published.map(x=>x.public),branches};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
export async function startOfflineChoiceDemoServer(options:{port:number;webRoot?:string}){
 if(!Number.isInteger(options.port)||options.port<0||options.port>65535)throw Error('offline_choice_demo_invalid_port');
 const web=options.webRoot===undefined?undefined:assertGodotWebExport(options.webRoot);
 // Runs once, prior to binding. Requests only read a bounded serialized value.
 const result=await runOfflineChoiceDemo(),body=JSON.stringify(result);
 const server=createServer((request,response)=>{
  if(web&&serveGodotWeb(request,response,web))return;
  response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  if(request.method==='GET'&&request.url===OFFLINE_CHOICE_DEMO_PATH){response.end(body);return;}
  response.writeHead(404);response.end('{}');
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 return {server,result};
}
