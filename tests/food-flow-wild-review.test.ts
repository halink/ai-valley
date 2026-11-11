import test from 'node:test';
import assert from 'node:assert/strict';
import {wildFlowFixture,flowMenuAction,queueWildFlow,finishWildFlows,prepareHunt} from './helpers/food-flow-wild.js';
import {fishingKey,waterAtShore} from '../src/world/fishing.js';
import {initializeFood} from '../src/world/food.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE,type FoodFlowReceipt} from '../src/world/food-consumption-evidence.js';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';

test('review: a cross-sector catch identifies adjacent water, never the resident shore sector',()=>{
 const {w,fisher:r,pool}=wildFlowFixture(),shore={x:31,y:16},water={x:32,y:16};
 for(let y=13;y<=19;y++)for(let x=28;x<=35;x++)w.map.tiles[y*w.map.width+x]='grass';
 w.map.tiles[water.y*w.map.width+water.x]='water';
 const actual=structuredClone(pool);actual.habitat='lake';actual.species!.perch=structuredClone(actual.species!.carp!);delete actual.species!.carp;actual.shoal={anchor:{...water},at:{...water},nextMoveAt:w.minute+1000,activity:'feeding'};
 w.industry!.fishing[fishingKey(water)]=actual;r.at=shore;r.inside=null;r.roomAt=null;
 assert.deepEqual(waterAtShore(w,shore),water);assert.notEqual(fishingKey(shore),fishingKey(water));
 const a=flowMenuAction(w,r,'fish');assert.deepEqual(a.at,shore);const stock=actual.amount;
 queueWildFlow(w,r,a);const rows=finishWildFlows(w,[r]);assert.equal(rows.length,1);
 const receipt=rows[0];assert.equal(receipt.action,'fish');assert.equal(receipt.type,'source_added');
 if(receipt.type!=='source_added')throw Error();assert.equal(receipt.sourceId,'shoal:1,0');
 assert.equal(actual.amount,stock-1);assert.deepEqual(w.events.find(e=>e.id===receipt.eventId)!.animalIds,['shoal:1,0']);
});

test('review: old same-species stock and lots are not included in the fresh catch receipt',()=>{
 const {w,fisher:r}=wildFlowFixture(),a=flowMenuAction(w,r,'fish'),species=a.fishSpecies!,container='person:'+r.id;
 r.inventory[species]=7;initializeFood(w);const old=structuredClone(w.food!.lots[container][species]);
 queueWildFlow(w,r,a);const rows=finishWildFlows(w,[r]);assert.equal(rows.length,1);
 assert.equal(r.inventory[species],8);assert.equal(rows[0].outputs[0].quantity,1);
 assert.equal(rows[0].outputs[0].lots!.reduce((n,l)=>n+l.quantity,0),1);
 assert.deepEqual(w.food!.lots[container][species]![0],old![0]);
});

test('review: failed capture clears invocation registration before the next successful engine invocation',()=>{
 const {w,hunter:r,beast}=wildFlowFixture();prepareHunt(w,r,beast);beast.health=30;
 assert.throws(()=>captureDirectEating(w,()=>{throw Error('synthetic abort');}),/synthetic abort/);
 queueWildFlow(w,r,flowMenuAction(w,r,'hunt',beast.id));const rows=finishWildFlows(w,[r]);
 assert.equal(rows.length,1);assert.equal(rows[0].outputs[0].quantity,5);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
});

test('review: legacy known daily receipts survive while coverage and totals stay unknown',()=>{
 const {w}=wildFlowFixture(),daily=createIsolationEvidence(w),from=w.minute;
 const old:FoodFlowReceipt={type:'source_added',action:'gather_berry',at:from+1,residentId:'r',eventId:'old-event',planId:'old-plan',container:'person:r',definition:'action/routine@1',sourceId:'berry-1',outputs:[{item:'berry',quantity:1,nutrition:null,lots:null}]};
 w.minute++;daily.sample(w,{worldId:w.id,fromMinute:from,toMinute:w.minute,receipts:[],foodFlows:[old]});
 w.minute++;daily.sample(w,{worldId:w.id,fromMinute:from+1,toMinute:w.minute,receipts:[],foodFlows:[],foodFlowCoverage:FOOD_FLOW_COVERAGE});
 const row=daily.finish(w)!;assert.deepEqual(row.foodFlows.receipts,[old]);assert.equal(row.foodFlows.totals,null);
 assert.equal(row.foodFlows.observedMinutes,1);assert.equal(row.foodFlows.unobservedMinutes,1);
});

test('review: wild flow schema rejects hidden arrays, extra species on legacy actions and wrong source shape',()=>{
 const f={type:'source_added',action:'fish',at:481,residentId:'r',eventId:'event',planId:'plan',container:'person:r',definition:'ecology/fishing-process@1',sourceId:'shoal:1,0',species:'perch',outputs:[{item:'perch',quantity:1,nutrition:null,lots:null}]};
 assert.deepEqual(checkedFoodFlow(f),f);
 for(const mutate of [(v:any)=>v.action='gather_berry',(v:any)=>v.sourceId='1,0',(v:any)=>v.outputs.extra='private',(v:any)=>delete v.outputs[0]]){
  const bad=structuredClone(f);mutate(bad);assert.throws(()=>checkedFoodFlow(bad));
 }
});

 test('review: all six actual prey species retain their identity and fixed raw-meat yields',()=>{
 for(const [species,yieldCount] of Object.entries({boar:5,wolf:2,deer:6,hare:1,fox:2,duck:1})){
  const {w,hunter:r,beast}=wildFlowFixture();beast.species=species as typeof beast.species;beast.health=1;prepareHunt(w,r,beast);
  queueWildFlow(w,r,flowMenuAction(w,r,'hunt',beast.id));const rows=finishWildFlows(w,[r]);assert.equal(rows.length,1);
  const row=rows[0];assert.equal(row.action,'hunt');if(row.action!=='hunt')throw Error();
  assert.equal(row.species,species);assert.equal(row.sourceId,beast.id);assert.equal(row.outputs[0].quantity,yieldCount);
  assert.equal(row.outputs[0].item,'gameMeat');assert.equal(r.inventory.gameMeat,yieldCount);assert.equal(beast.status,'dead');
  assert.deepEqual(checkedFoodFlow(row),row);
 }
});

test('review: hunt schema rejects fractional, oversized and another species kill yields',()=>{
 const f={type:'source_added',action:'hunt',at:481,residentId:'r',eventId:'event',planId:'plan',container:'person:r',definition:'industry/process@1',sourceId:'beast-1',species:'deer',outputs:[{item:'gameMeat',quantity:6,nutrition:null,lots:null}]};
 assert.deepEqual(checkedFoodFlow(f),f);
 for(const quantity of [.5,999,5,1]){const bad=structuredClone(f);bad.outputs[0].quantity=quantity;assert.throws(()=>checkedFoodFlow(bad));}
 const wrongSpecies=structuredClone(f);wrongSpecies.species='hare';assert.throws(()=>checkedFoodFlow(wrongSpecies));
});
