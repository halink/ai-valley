import test from 'node:test';
import assert from 'node:assert/strict';
import {houseHarvestFixture,custodyHarvestFixture,queueHarvest,finishHarvest,harvestReceipts,submitHarvest,harvestChoice} from './helpers/food-flow-harvest.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';

test('independent harvest review: greenhouse landowner is not crop production owner',()=>{
 const f=houseHarvestFixture();f.home.ownerId=f.w.residents[1].id;
 queueHarvest(f);const [flow]=harvestReceipts(finishHarvest(f.w,f.r));
 assert.equal(flow.action,'harvest_house');if(flow.action!=='harvest_house')throw Error('wrong variant');
 assert.equal(flow.ownerId,f.r.id);assert.notEqual(flow.ownerId,f.home.ownerId);
 assert.equal(flow.container,'person:'+f.r.id);
});

test('independent harvest review: old inventory repair never inflates fresh house output',()=>{
 const f=houseHarvestFixture();f.r.inventory.turnip=37;delete f.w.food!.lots['person:'+f.r.id].turnip;
 queueHarvest(f);const [flow]=harvestReceipts(finishHarvest(f.w,f.r));
 assert.equal(flow.outputs[0].quantity,12);assert.equal(f.r.inventory.turnip,49);
 assert.equal(flow.outputs[0].lots!.reduce((n,l)=>n+l.quantity,0),12);
 assert.ok(flow.outputs[0].lots!.every(l=>l.producedAt===flow.at));
 assert.equal(f.w.food!.lots[flow.container].turnip!.reduce((n,l)=>n+l.quantity,0),49);
});

test('independent harvest review: sequential genuine crops on one bed stay distinct and detached',()=>{
 const f=houseHarvestFixture(),observations=[];
 queueHarvest(f);observations.push(...finishHarvest(f.w,f.r));
 submitHarvest(f.w,f.r,harvestChoice(f.w,f.r,'plantHouse',a=>a.type==='industry'&&a.cropId==='crop/turnip@2'&&a.bed===0));observations.push(...finishHarvest(f.w,f.r));
 // Synthetic clock-independent maturation of a genuinely new planted crop, not replay of harvested state.
 f.bed.crop!.growth=100;
 queueHarvest(f);observations.push(...finishHarvest(f.w,f.r));
 const flows=harvestReceipts(observations);assert.equal(flows.length,2);
 assert.equal(flows[0].sourceId,flows[1].sourceId);assert.notEqual(flows[0].eventId,flows[1].eventId);assert.notEqual(flows[0].planId,flows[1].planId);
 assert.ok(flows[1].at>flows[0].at);assert.equal(flows.reduce((n,f)=>n+f.outputs[0].quantity,0),24);
 const before=structuredClone(f.w);flows[0].outputs[0].lots![0].quantity=999;assert.deepEqual(f.w,before);
});

test('independent harvest review: custody maintenance advances work serial without a source addition',()=>{
 const f=custodyHarvestFixture();submitHarvest(f.w,f.r,harvestChoice(f.w,f.r,'custodyWater'));
 assert.deepEqual(harvestReceipts(finishHarvest(f.w,f.r)),[]);assert.equal(f.c.workSerial,1);
 queueHarvest(f);const [flow]=harvestReceipts(finishHarvest(f.w,f.r));
 assert.equal(flow.action,'custody_harvest');if(flow.action!=='custody_harvest')throw Error('wrong variant');
 assert.equal(flow.workSerial,1);assert.equal(flow.container,`custody-stock:${f.c.id}:1`);
 assert.equal(flow.estateOwnerId,f.dead.id);assert.notEqual(flow.estateOwnerId,flow.residentId);assert.notEqual(flow.estateOwnerId,flow.beneficiaryId);
 assert.equal(f.c.workSerial,2);
});

for(const fixture of [houseHarvestFixture,custodyHarvestFixture])test(`independent harvest review: ${fixture.name} exhausted source cannot be counted twice`,()=>{
 const f=fixture();queueHarvest(f);stepWorldWithFoodEvidence(f.w,3);assert.ok(f.r.activity);
 // Another real authority could consume a source while this actor travels/works. Completion must recheck it.
 if('bed' in f)f.bed.crop=null as unknown as typeof f.bed.crop;else f.plot.crop=null;
 assert.deepEqual(harvestReceipts(finishHarvest(f.w,f.r,false)),[]);assert.ok(f.r.lastFailure);
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).foodFlows,[]);
});

test('independent harvest review: observer throws after harvest cannot poison later capture or replay',()=>{
 const f=houseHarvestFixture();queueHarvest(f);const observations=finishHarvest(f.w,f.r),o=observations.find(o=>harvestReceipts([o]).length)!;
 const events:RuntimeFoodEvent[]=[],runtime=new RuntimeFoodEvidence({observe:e=>{events.push(e);if(e.type==='food_step_committed')throw Error('review observer failure');}});
 runtime.start(o.worldId,o.fromMinute);runtime.committed(o,1);
 assert.equal(runtime.status().phase,'failed');assert.equal(events.filter(e=>e.type==='food_step_committed').length,1);
 const before=structuredClone(f.w);assert.deepEqual(captureDirectEating(f.w,()=>{}).foodFlows,[]);assert.deepEqual(f.w,before);
 assert.equal(auditRuntimeFoodEvidence(events,runtime.status()).foodFlows.complete,false);
 assert.deepEqual(harvestReceipts(finishHarvest(f.w,f.r)),[]);
});

for(const fixture of [houseHarvestFixture,custodyHarvestFixture])for(const mode of ['nonfood','zero'] as const)test(`independent harvest review: ${fixture.name} ${mode} physical output is not food production`,()=>{
 const f=fixture(),definition=f.w.definitions['crop/turnip@2'];
 definition.data={...definition.data,...(mode==='nonfood'?{output:'wood'}:{yield:0})};
 queueHarvest(f);const observations=finishHarvest(f.w,f.r);
 assert.deepEqual(harvestReceipts(observations),[]);
 assert.equal('bed' in f?f.bed.crop:f.plot.crop,null);
 if('bed' in f)assert.equal(f.r.inventory.turnip??0,0);
});

 test('independent harvest review: custody receipt rejects impossible collapsed person identities',()=>{
 const f=custodyHarvestFixture();queueHarvest(f);const [receipt]=harvestReceipts(finishHarvest(f.w,f.r));
 assert.equal(receipt.action,'custody_harvest');if(receipt.action!=='custody_harvest')throw Error('wrong variant');
 for(const pair of [['estateOwnerId','residentId'],['estateOwnerId','beneficiaryId'],['beneficiaryId','residentId']] as const){
  const invalid=structuredClone(receipt);invalid[pair[0]]=invalid[pair[1]];
  assert.throws(()=>checkedFoodFlow(invalid),pair.join(' must differ from '));
 }
});

for(const fixture of [houseHarvestFixture,custodyHarvestFixture])test(`independent harvest review: ${fixture.name} malformed legacy output preserves observation-off physics`,()=>{
 const f=fixture();queueHarvest(f);
 // A loaded legacy definition can predate current content validation. Do not let evidence add a new throw.
 f.w.definitions['crop/turnip@2'].data.output='synthetic-unknown-crop-output';
 const disabled=structuredClone(f.w),actor=disabled.residents.find(r=>r.id===f.r.id)!;
 const observations=finishHarvest(f.w,f.r);
 for(let n=0;actor.plan||actor.activity;n++){assert.ok(n<500);stepWorld(disabled,1);}
 assert.equal(actor.lastFailure,null);assert.deepEqual(f.w,disabled);
 assert.deepEqual(harvestReceipts(observations),[]);
 assert.equal('bed' in f?f.bed.crop:f.plot.crop,null);
 const inventory='bed' in f?f.r.inventory:f.w.estates.find(e=>e.personId===f.dead.id)!.parcels!.find(p=>p.id===`custody-stock:${f.c.id}:0`)!.inventory;
 assert.equal((inventory as Record<string,number>)['synthetic-unknown-crop-output'],12);
});
