import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ownershipFixture,splitOwnership,queueOwnership,queueOwnershipAction,finishOwnership,ownershipReceipts} from './helpers/food-ownership.js';
import {FOOD_OWNERSHIP_COVERAGE,captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {completeProduction,advanceProduction} from '../src/world/production.js';
import {estateParcels} from '../src/world/estate-custody.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {recordDeath} from '../src/world/life.js';
import {DAY} from '../src/world/time.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {NINE_RESIDENT_PLAN} from '../src/server/nine-resident-acceptance.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';

for(const prepared of [false,true])test(`numbered inherit captures ${prepared?'existing':'newly routed'} physical parcels and existing orchard/animal food only`,()=>{
 const f=ownershipFixture(),{w,heir,parent,tree,animals}=f;
 if(prepared)splitOwnership(w,parent.id);
 const inventory=structuredClone(heir.inventory),treeAt={...tree.at},animalBarn=animals.map(a=>a.barnId);
 queueOwnership(w,heir,parent.id);const observations=finishOwnership(w,heir),receipts=ownershipReceipts(observations);assert.equal(receipts.length,1);
 const r=receipts[0];assert.equal(r.type,'ownership_change');assert.equal(r.action,'production');assert.equal(r.operation,'inherit');assert.equal(r.estatePersonId,parent.id);assert.equal(r.heirId,heir.id);assert.equal(r.shareId,'0');assert.match(r.planId!,/^food-ownership:/);assert.equal(w.events.find(e=>e.id===r.eventId)!.at,r.at);
 const amounts=r.stocks.flatMap(s=>s.amounts),totals=Object.fromEntries(['meal','turnip','fruit','egg','duckEgg','milk'].map(item=>[item,amounts.filter(a=>a.item===item).reduce((n,a)=>n+a.quantity!,0)]));
 assert.deepEqual(totals,{meal:5,turnip:2,fruit:7,egg:2,duckEgg:2,milk:4});assert.equal(r.stocks.length,7);
 assert.ok(r.stocks.every(s=>s.fromOwnerId===parent.id&&s.toOwnerId===heir.id&&!s.ambiguous));assert.ok(amounts.every(a=>a.nutrition===null&&a.lots===null));assert.ok(amounts.every(a=>!['wood','water','seed','wool'].includes(a.item)));
 assert.deepEqual(heir.inventory,inventory);assert.deepEqual(tree.at,treeAt);assert.deepEqual(animals.map(a=>a.barnId),animalBarn);
 assert.ok(observations.every(o=>o.foodOwnershipCoverage===FOOD_OWNERSHIP_COVERAGE));assert.equal(observations.flatMap(o=>o.foodTransfers??[]).length,0);assert.equal(observations.flatMap(o=>o.receipts).length,0);
 for(const stock of r.stocks.filter(s=>s.containerType==='estate-stock'))assert.ok(w.food!.lots[stock.container]);
 const retry=captureDirectEating(w,()=>{w.minute++;assert.ok(completeProduction(w,heir,{type:'production',operation:'inherit',personId:parent.id}));});assert.deepEqual(retry.foodOwnershipChanges,[]);
 const parcel=estateParcels(w).find(p=>p.ownerId===heir.id&&(p.inventory.meal??0)>0)!;
 heir.at={...parcel.location.at};heir.inside=parcel.location.inside;heir.roomAt=parcel.location.roomAt;
 const match=(a:import('../src/shared/types.js').Action)=>a.type==='production'&&a.operation==='collectEstate'&&a.parcelId===parcel.id;
 for(let n=0;!decisionChoices(decisionContext(w,heir)).some(c=>match(c.action));n++){assert.ok(n<120,'ordinary agenda eventually exposes collection');assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodOwnershipChanges,[]);}
 queueOwnershipAction(w,heir,match);
 assert.deepEqual(ownershipReceipts(finishOwnership(w,heir)),[]);assert.equal(heir.inventory.meal,5);
});

test('two numbered heirs receive distinct shares once in the same sweep, without counting share summaries',()=>{
 const {w,heir,other,parent}=ownershipFixture(true);
 queueOwnership(w,heir,parent.id);queueOwnership(w,other,parent.id);const observations=finishOwnership(w,heir);if(other.plan||other.activity)observations.push(...finishOwnership(w,other));
 const r=ownershipReceipts(observations);assert.equal(r.length,2);assert.equal(new Set(r.map(x=>x.eventId)).size,2);assert.equal(new Set(r.map(x=>x.shareId)).size,2);
 const amounts=r.flatMap(x=>x.stocks.flatMap(s=>s.amounts));assert.equal(amounts.filter(a=>a.item==='meal').reduce((n,a)=>n+a.quantity!,0),5);assert.equal(amounts.filter(a=>a.item==='fruit').reduce((n,a)=>n+a.quantity!,0),7);
});

test('unclaimed successor and old missing goodsClaims only record actual later acceptance; SQLite reload does not repeat',()=>{
 const f=ownershipFixture(true);queueOwnership(f.w,f.heir,f.parent.id);const first=ownershipReceipts(finishOwnership(f.w,f.heir));assert.equal(first.length,1);
 recordDeath(f.w,f.other);advanceProduction(f.w);const pending=f.w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt===null)!;assert.equal(pending.heirId,f.heir.id);assert.ok(pending.id.includes('.'));
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load(true)!,revision=w.revision,heir=w.residents.find(r=>r.id===f.heir.id)!;queueOwnership(w,heir,f.parent.id);const next=ownershipReceipts(finishOwnership(w,heir));assert.equal(next.length,1);assert.equal(next[0].shareId,pending.id);assert.notEqual(next[0].shareId,first[0].shareId);assert.ok(next[0].stocks.every(s=>s.fromOwnerId===f.parent.id));store.commit(w,revision);const loaded=store.load(true)!;assert.deepEqual(stepWorldWithFoodEvidence(loaded,1).foodOwnershipChanges,[]);}finally{store.close();}
 const g=ownershipFixture();const shares=splitOwnership(g.w,g.parent.id);delete shares[0].goodsClaims;queueOwnership(g.w,g.heir,g.parent.id);const old=ownershipReceipts(finishOwnership(g.w,g.heir));assert.equal(old.length,1);assert.ok(old[0].stocks.flatMap(s=>s.amounts).every(a=>a.lots===null&&a.nutrition===null));
});

test('the assignment-time quantity excludes earlier spoilage and later natural growth in the same minute',()=>{
 const {w,heir,parent,tree,animals}=ownershipFixture();queueOwnership(w,heir,parent.id);
 while(heir.activity?.remaining!==1)stepWorldWithFoodEvidence(w,1);
 const from=w.minute,treeLedger=w.food!.lots['orchard-stock:'+tree.id].fruit!;
 treeLedger[0].quantity=3;treeLedger.push({...treeLedger[0],quantity:1,expiresAt:from+1});
 tree.fruitProgress=DAY-1;tree.lastMinute=from;tree.lastWateredDay=Math.floor((from+1)/DAY);
 const chicken=animals[0];chicken.progress=DAY-1;chicken.lastMinute=from;
 const ids=[...NINE_RESIDENT_PLAN.residentIds],collector=createNineFoodEvidence(w.id,from),before=snapshotNineFood(w,ids),o=stepWorldWithFoodEvidence(w,1),after=snapshotNineFood(w,ids);collector.sample(before,after,o);
 const receipt=o.foodOwnershipChanges![0],stock=receipt.stocks.find(s=>s.container==='orchard-stock:'+tree.id)!;
 assert.equal(stock.amounts[0].quantity,3);assert.equal(o.foodLosses!.find(r=>r.container===stock.container)!.amount.quantity,1);assert.ok(tree.fruit>3);
 const growth=o.foodFlows!.find(r=>r.action==='fruit_growth'&&r.container===stock.container)!;assert.ok(growth);assert.equal(growth.action==='fruit_growth'?growth.ownerId:null,heir.id);
 const report=collector.finish();assert.equal(report.foodLosses.scopes[o.foodLosses!.findIndex(r=>r.container===stock.container)],'unknown');assert.equal(report.foodFlows.scopes[o.foodFlows!.indexOf(growth)],'unknown');
});

test('enabled capture changes no world state or serialized resident knowledge; failed actions remain empty',()=>{
 const {w,heir,parent}=ownershipFixture();queueOwnership(w,heir,parent.id);const disabled=structuredClone(w),enabled=structuredClone(w);
 for(let n=0;n<24;n++){stepWorld(disabled,1);stepWorldWithFoodEvidence(enabled,1);}assert.deepEqual(enabled,disabled);assert.doesNotMatch(JSON.stringify(enabled),/"foodOwnership(?:Changes|Coverage)"/);
 const f=ownershipFixture();queueOwnership(f.w,f.heir,f.parent.id);while(f.heir.activity?.remaining!==1)stepWorldWithFoodEvidence(f.w,1);f.heir.canExpress=false;
 const o=stepWorldWithFoodEvidence(f.w,1);assert.deepEqual(o.foodOwnershipChanges,[]);assert.ok(f.heir.lastFailure);
});

for(const [source,destination]of [['external','nine'],['nine','external'],['nine','nine'],['external','external']] as const)test(`real numbered inheritance ${source} to ${destination} separates ownership boundary from intake and physical movement`,()=>{
 const ids=[...NINE_RESIDENT_PLAN.residentIds],parentId=source==='nine'?ids[8]:'ownership-parent',heirId=destination==='nine'?ids[0]:'ownership-external-heir';
 const {w,heir,parent}=ownershipFixture(false,{parentId,heirId});
 const collector=createNineFoodEvidence(w.id,w.minute),start=snapshotNineFood(w,ids);queueOwnership(w,heir,parent.id);
 while(heir.plan||heir.activity){const before=snapshotNineFood(w,ids),observation=stepWorldWithFoodEvidence(w,1);collector.sample(before,snapshotNineFood(w,ids),observation);}
 const result=collector.finish(),after=snapshotNineFood(w,ids),inflow=result.foodOwnershipChanges.scopeInflowTotals!,outflow=result.foodOwnershipChanges.scopeOutflowTotals!;
 assert.equal(result.foodOwnershipChanges.receipts.length,1);assert.equal(inflow.units.meal,source==='external'&&destination==='nine'?5:0);assert.equal(outflow.units.meal,source==='nine'&&destination==='external'?5:0);
 assert.equal(after.scopedTotals.meal!-start.scopedTotals.meal!,inflow.units.meal!-outflow.units.meal!);assert.equal(result.foodTransfers.scopeInflowTotals!.units.meal,0);assert.equal(result.foodTransfers.scopeOutflowTotals!.units.meal,0);assert.equal(result.directEating.nineIntakeTotals!.units.meal,0);assert.equal(result.completeFoodLedger,false);assert.equal(result.foodProduction,null);assert.equal(result.foodConsumption,null);
});

test('fractional remaining parcel quantity survives repaired-ledger reload without becoming batch or nutrition proof',()=>{
 const f=ownershipFixture();splitOwnership(f.w,f.parent.id);const parcel=estateParcels(f.w).find(p=>p.inventory.meal)!;parcel.inventory.meal=2.5;delete f.w.food!.lots[parcel.id];initializeFood(f.w);
 assert.equal(f.w.food!.lots[parcel.id].meal![0].quantity,2.5);assert.equal(f.w.production!.inheritances[f.parent.id].shares[0].inventory.meal,5);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load(true)!,heir=w.residents.find(r=>r.id===f.heir.id)!;queueOwnership(w,heir,f.parent.id);const [receipt]=ownershipReceipts(finishOwnership(w,heir)),stock=receipt.stocks.find(s=>s.container===parcel.id)!,amount=stock.amounts.find(a=>a.item==='meal')!;
 assert.equal(amount.quantity,2.5);assert.equal(amount.lots,null);assert.equal(amount.nutrition,null);assert.equal(stock.ambiguous,false);
 }finally{store.close();}
});
