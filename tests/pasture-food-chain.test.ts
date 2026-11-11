import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {pastureFenceBlocks} from '../src/shared/pasture-fence.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {advanceIndustry,industryTarget} from '../src/world/industry.js';
import {pastureAdmissionError} from '../src/world/pasture-projects.js';
import {PastureFoodChain,animalChoice} from './helpers/pasture-food-chain.js';

test('synthetic built pasture: natural fence failure, numbered care, one milk batch and SQLite transfer without replay',t=>{
 const dir=mkdtempSync(join(testTmpdir(),'valley-pasture-food-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const f=new PastureFoodChain(join(dir,'synthetic.sqlite')).build().seedAnimalsAndAdmit();
 f.reload();const originalId=f.goat.id;
 assert.equal(pastureAdmissionError(f.world,f.pasture),null);assert.equal(pastureFenceBlocks(f.pasture),true);
 f.breakFence().reload();
 assert.equal(pastureFenceBlocks(f.pasture),false);assert.match(pastureAdmissionError(f.world,f.pasture)!,/围栏已损坏/);
 const newcomerBefore=structuredClone(f.newcomer);
 assert.ok(!f.menu().some(c=>c.action.type==='industry'&&c.action.operation==='moveAnimal'&&c.action.animalId===f.newcomerId&&c.action.pastureId===f.pasture.id));
 assert.match(industryTarget(f.world,f.owner,{type:'industry',operation:'moveAnimal',animalId:f.newcomerId,buildingId:f.barnId,pastureId:f.pasture.id,at:{...f.pasture.tiles[0]}}).error!,/可用的放牧位置/);
 assert.deepEqual(f.newcomer,newcomerBefore);assert.equal(f.goat.pastureId,f.pasture.id);
 assert.equal(f.world.events.filter(e=>e.text.includes('围栏因实际风雨磨损')).length,1);

 const inventory=structuredClone(f.owner.inventory),needs={hunger:f.goat.hunger,thirst:f.goat.thirst};
 f.industry('feedAnimal',f.goatId);assert.equal(f.owner.inventory.fodder,inventory.fodder!-1);assert.ok(f.goat.hunger<needs.hunger-40);
 assert.equal(f.goat.product,0);assert.equal(f.goat.progress,1440-120,'feeding alone cannot produce through thirst');
 f.industry('waterAnimal',f.goatId);assert.equal(f.owner.inventory.water,inventory.water!-1);assert.ok(f.goat.thirst<needs.thirst-40);
 assert.equal(f.goat.product,0);assert.equal(f.pasture.trough!.delivered,0,'direct care is not trough delivery');
 f.industry('fillTrough',f.pasture.id);assert.equal(f.owner.inventory.water,inventory.water!-2);assert.equal(f.pasture.trough!.delivered,1);
 assert.equal(f.goat.product,0);f.reload();
 let remaining=150;
 while(f.goat.product===0){assert.ok(remaining-->0,'actual animal progress must reach one interval');f.tick();}
 assert.equal(f.goat.product,1);assert.equal(f.goat.id,originalId);assert.equal(f.goat.pastureId,f.pasture.id);
 const trough=f.pasture.trough!;
 assert.ok(trough.consumed>0);assert.ok(trough.water>=0&&trough.water<1);
 assert.ok(Math.abs(trough.delivered-trough.consumed-trough.water)<1e-9);
 assert.equal(f.owner.inventory.fodder,inventory.fodder!-1);assert.equal(f.owner.inventory.water,inventory.water!-2);
 const receipts=f.flows.filter(r=>r.action==='animal_product');assert.equal(receipts.length,1);
 const receipt=receipts[0];assert.equal(receipt.sourceId,originalId);assert.equal(receipt.species,'goat');
 assert.equal(receipt.container,'animal-stock:'+originalId);assert.equal(receipt.residentId,null);assert.equal(receipt.planId,null);
 assert.deepEqual(receipt.outputs.map(o=>[o.item,o.quantity]),[['milk',1]]);
 const lot=structuredClone(f.world.food!.lots[receipt.container].milk!);
 assert.deepEqual(receipt.outputs[0].lots!.map(({nutrition,...l})=>l),lot);
 assert.equal(lot[0].producedAt,receipt.at);assert.equal(f.world.industry!.totals.animalProducts,0);

 f.reload();assert.deepEqual(captureDirectEating(f.world,()=>advanceIndustry(f.world)).foodFlows,[]);
 const flowCount=f.flows.length;f.industry('collectAnimal',f.goatId);
 assert.equal(f.owner.inventory.milk,1);assert.equal(f.goat.product,0);assert.equal(f.world.industry!.totals.animalProducts,1);
 assert.deepEqual(f.world.food!.lots['person:'+f.ownerId].milk,lot);assert.equal(f.world.food!.lots[receipt.container],undefined);
 assert.equal(f.flows.length,flowCount,'collection transfers the existing batch, never a second production receipt');
 f.reload();const afterCollection=structuredClone(f.owner.inventory);
 assert.ok(!animalChoice(f.menu(),'collectAnimal',originalId));
 assert.match(industryTarget(f.world,f.owner,{type:'industry',operation:'collectAnimal',animalId:originalId}).error!,/没有实际可收集/);
 assert.deepEqual(captureDirectEating(f.world,()=>advanceIndustry(f.world)).foodFlows,[]);f.tick(10);
 assert.deepEqual(f.owner.inventory,afterCollection);assert.equal(f.goat.product,0);assert.equal(f.flows.length,flowCount);
 assert.deepEqual(f.world.food!.lots['person:'+f.ownerId].milk,lot);assert.equal(f.pasture.fence!.condition,0);
 assert.equal(f.pasture.fence!.repairs,0);assert.equal(f.world.metrics.requests,0);
 for(const s of f.selections)if(s.action.type==='industry'||s.action.type==='landRights')assert.ok(s.choiceId,'domain actions must use final numbered choices');
 for(const operation of ['feedAnimal','waterAnimal','fillTrough','collectAnimal'])assert.equal(f.selections.filter(s=>s.action.type==='industry'&&s.action.operation===operation).length,1);
});

test('synthetic broken pasture: observing and waiting do not choose, spend, repair, feed, water or collect for residents',()=>{
 const f=new PastureFoodChain().build().seedAnimalsAndAdmit().breakFence();
 assert.ok(animalChoice(f.menu(),'feedAnimal',f.goatId));assert.ok(animalChoice(f.menu(),'waterAnimal',f.goatId));
 assert.ok(f.menu().some(c=>c.action.type==='industry'&&c.action.operation==='fillTrough'));
 const inventories=f.world.residents.map(r=>structuredClone(r.inventory)),eventCount=f.world.events.length,
  selections=f.selections.length,progress=f.goat.progress,health=f.goat.health;
 for(let i=0;i<4;i++){f.menu();f.tick(30);}
 assert.deepEqual(f.world.residents.map(r=>r.inventory),inventories);assert.equal(f.selections.length,selections);
 assert.ok(f.world.residents.every(r=>r.plan===null&&r.activity===null));
 assert.equal(f.pasture.fence!.condition,0);assert.equal(f.pasture.fence!.repair,undefined);assert.equal(f.pasture.fence!.woodUsed,0);
 assert.deepEqual([f.pasture.trough!.water,f.pasture.trough!.delivered,f.pasture.trough!.consumed],[0,0,0]);
 assert.equal(f.goat.lastCaredAt,undefined);assert.equal(f.goat.product,0);assert.equal(f.goat.progress,progress);
 assert.ok(f.goat.health<=health);assert.equal(f.goat.pastureId,f.pasture.id);assert.equal(f.newcomer.pastureId,undefined);
 assert.equal(f.flows.length,0);assert.equal(f.world.industry!.totals.animalProducts,0);assert.equal(f.world.metrics.requests,0);
 assert.ok(!f.world.events.slice(eventCount).some(e=>/自愿.*(?:饲料|清水)|亲自向牧场水槽|围栏修护|实际收集/.test(e.text)));
});
