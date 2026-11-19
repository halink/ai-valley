import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMvpSession} from '../build/server/godot-mvp.js';
import {mvpMealObservation} from '../build/server/mvp-meal-observation.js';
import {WorldStore} from '../build/server/store.js';
import {agricultureStation} from '../build/world/mvp-agriculture.js';
import {submitPlan} from '../build/world/engine.js';
import {seasonalModelContext} from '../build/server/seasonal-model-context.js';
import {decisionContext,prepareModelDecision} from '../build/server/decisions.js';
import {GLM_MODEL} from '../build/server/model-completion.js';

globalThis.fetch=()=>{throw Error('network unavailable by design');};
function submit(w,r,id,actions){
 assert.equal(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'synthetic completed meal evidence',actions}).ok,true);
}
function fixture(){
 const w=createMvpSession().world,[r,...others]=w.residents,station=agricultureStation(w,r,'cook');
 const cooked={type:'mvpAgriculture',operation:'cook',cultivar:'spring'};
 assert.ok(station);
 Object.assign(r,{at:structuredClone(station.building.door),inside:station.building.id,roomAt:structuredClone(station.at),inventory:{springRoot:2,water:2},hunger:20,energy:95});
 for(const p of others)submit(w,p,'stay:'+p.id,[{type:'wait',minutes:120}]);
 submit(w,r,'actual-cook-and-eat',[cooked,{type:'eat',item:'meal'}]);
 return {w,id:r.id,otherId:others[0].id};
}
const {w,id,otherId}=fixture();
assert.deepEqual(mvpMealObservation(w).residents[id],{cooked:null,ate:null});
const dir=mkdtempSync(join(tmpdir(),'mvp-meal-observation-'));
try{
 const path=join(dir,'game.sqlite');let store=new WorldStore(path,{allowMvpClimate:true});store.commit(w,null);
 let s=createMvpSession({world:store.loadForRuntime(),persistent:true,commit:(draft,rev)=>store.commit(draft,rev)});
 const person=()=>s.world.residents.find(r=>r.id===id), view=()=>s.snapshot().mvp.mealObservation.residents[id];
 for(let i=0;!view().cooked&&i<100;i++)s.advance(1);
 assert.equal(s.snapshot().mvp.fault,null);
 assert.deepEqual(person().inventory,{springRoot:0,water:1,meal:1});
 const cooked=view().cooked;assert.deepEqual(cooked,{schemaVersion:1,kind:'cooked',cultivar:'spring',roots:2,water:1,meal:1,at:s.world.minute});
 assert.equal(view().ate,null);
 store.close();store=new WorldStore(path,{allowMvpClimate:true});
 s=createMvpSession({world:store.loadForRuntime(),persistent:true,commit:(draft,rev)=>store.commit(draft,rev)});
 assert.deepEqual(view(),{cooked,ate:null});
 for(let i=0;!view().ate&&i<20;i++)s.advance(1);
 const ate=view().ate;assert.deepEqual(ate,{schemaVersion:1,kind:'ate',meal:1,at:s.world.minute});
 assert.deepEqual(person().inventory,{springRoot:0,water:1,meal:0});
 assert.ok(person().hunger<20);
 store.close();store=new WorldStore(path,{allowMvpClimate:true});
 const reloaded=store.loadForRuntime();store.close();
 assert.deepEqual(mvpMealObservation(reloaded).residents[id],{cooked,ate});
 assert.deepEqual(mvpMealObservation(reloaded).residents[otherId],{cooked:null,ate:null});

 // The observer layer does not upgrade old facts or alter an existing text memory.
 const old=structuredClone(reloaded);
 for(const event of old.events)delete event.mvpMeal;
 assert.deepEqual(old.residents,reloaded.residents);
 const args=[undefined,GLM_MODEL];
 for(const makeContext of [decisionContext,seasonalModelContext]){
  const messagesA=prepareModelDecision(makeContext(old,old.residents[1]),...args).messages;
  const messagesB=prepareModelDecision(makeContext(reloaded,reloaded.residents[1]),...args).messages;
  assert.deepEqual(messagesA,messagesB,'observer detail escaped into model prompt');
 }
 assert.deepEqual(mvpMealObservation(old).residents[id],{cooked:null,ate:null});
 const damaged=structuredClone(reloaded);
 for(const event of damaged.events)if(event.mvpMeal){
  if(event.mvpMeal.kind==='ate')event.mvpMeal.schemaVersion=99;
  else event.mvpMeal.roots=500;
 }
 const unchanged=JSON.stringify(damaged);
 assert.deepEqual(mvpMealObservation(damaged).residents[id],{cooked:null,ate:null});
 assert.equal(JSON.stringify(damaged),unchanged);
 const oldTime=structuredClone(reloaded);
 for(const event of oldTime.events)if(event.mvpMeal?.kind==='ate')event.at=oldTime.minute+1;
 assert.equal(mvpMealObservation(oldTime).residents[id].ate,null);
 const beyondWindow=structuredClone(reloaded);
 const event=beyondWindow.events.at(-1);
 for(let i=0;i<512;i++)beyondWindow.events.push({...event,id:'old-window-test:'+i,mvpMeal:undefined});
 assert.deepEqual(mvpMealObservation(beyondWindow).residents[id],{cooked:null,ate:null});
 const compatibility=createMvpSession({world:damaged});compatibility.advance(1);
 assert.equal(compatibility.world.minute,damaged.minute+1);
 assert.equal(compatibility.snapshot().mvp.fault,null);
 assert.deepEqual(compatibility.snapshot().mvp.mealObservation.residents[id],{cooked:null,ate:null});
}finally{rmSync(dir,{force:true,recursive:true});}
for(const stage of ['cooked','ate']){
 const {w,id}=fixture();let rejectedDraft;
 const s=createMvpSession({world:w,commit:(draft)=>{
  if(draft.events.some(e=>e.mvpMeal?.kind===stage)){rejectedDraft=draft;throw Error('intentional commit fail');}
 }});
 // Adoption already performed on the fixture before attaching the callback.
 for(let i=0;!s.snapshot().mvp.fault&&i<120;i++)s.advance(1);
 assert.ok(rejectedDraft);
 assert.equal(s.world.minute,rejectedDraft.minute-1);
 assert.equal(s.snapshot().mvp.mealObservation.residents[id][stage],null);
 const bag=s.world.residents.find(r=>r.id===id).inventory;
 assert.equal(bag.meal??0,stage==='cooked'?0:1);
 assert.equal(bag.springRoot,stage==='cooked'?2:0);
}
console.log('meal observation: real cook/eat debit plus SQLite restart, old/unknown data, and commit rollback');
