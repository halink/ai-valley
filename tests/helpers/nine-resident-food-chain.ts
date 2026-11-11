import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {decisionContext,decisionChoices} from '../../src/server/decisions.js';
import {parseChoice,type ActionChoice} from '../../src/server/affordances.js';
import {WorldStore} from '../../src/server/store.js';
import {DAY,ageYears} from '../../src/world/time.js';
import {totalCoins,accountBalance} from '../../src/world/economy.js';
import {snapshotNineFood,createNineFoodEvidence,type NineFoodSnapshot} from './nine-food-accounting.js';
import {reserveContainer} from '../../src/world/public-food-reserves.js';
import {roomLayout} from '../../src/shared/rooms.js';
import type {Action,Resident} from '../../src/shared/types.js';
import type {DirectEatingReceipt} from '../../src/world/food-consumption-evidence.js';

/** Scripted menu selections only. Never a model-autonomy or population-survival verdict. */
export function runNineResidentFoodChain(databasePath:string){
 assert.ok(databasePath!==':memory:'&&!existsSync(databasePath),'requires a fresh synthetic SQLite path');
 let world=createFrontierWorld(5401);
 const founderIds=world.residents.map(r=>r.id),initialMinute=world.minute;
 const initialPeople=world.residents.map(r=>({id:r.id,inventory:structuredClone(r.inventory),bornAt:r.bornAt,homeId:r.homeId}));
 const ownership=()=>world.buildings.map(b=>({id:b.id,ownerId:b.ownerId,residents:b.residents}));
 const initialOwnership=structuredClone(ownership());
 const trace:Array<{actorId:string;purpose:string;selectedAt:number;completedAt:number|null;choiceId:string;label:string;action:Action;failure:string|null}>=[];
 const meals:DirectEatingReceipt[]=[],growth:Array<{at:number;day:number;previousWeather:string;wateredDay:number;before:number;after:number}>=[];
 const checkpoints:Array<{stage:string;at:number;turnip:number;seed:number;coins:number;physical:NineFoodSnapshot}>=[];
 const evidence=createNineFoodEvidence(world.id,world.minute),reservedActors=new Set<string>();
 const pending=new Map<string,number>();
 let storedRevision:number|null=null;
 const person=(id:string)=>world.residents.find(r=>r.id===id)!;
 const farmerId='founder-1-1',childId='founder-1-3';
 let plotId:string|undefined;
 const physical=(item:'turnip'|'seed')=>{const total=snapshotNineFood(world,founderIds).scopedTotals[item];assert.notEqual(total,null,'unknown physical '+item);return total!;};
 const menu=(r:Resident)=>decisionChoices(decisionContext(world,r));
 function select(r:Resident,c:ActionChoice,choices:ActionChoice[],purpose:string,fields:Record<string,number|string>={}){
  assert.equal(r.plan,null);assert.equal(r.activity,null);
  const decision=parseChoice(JSON.stringify({choice:c.id,...fields}),choices);
  assert.equal(decision.actions.length,1);
  const entry={actorId:r.id,purpose,selectedAt:world.minute,completedAt:null,choiceId:c.id,label:c.label,action:structuredClone(decision.actions[0]),failure:null};
  const index=trace.push(entry)-1;
  const result=submitPlan(world,{id:`offline-food-chain:${index}`,actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'离线脚本选择：'+purpose,actions:decision.actions});
  assert.equal(result.ok,true,JSON.stringify(result));pending.set(r.id,index);
 }
 function support(exclude?:string){
  for(const r of world.residents){
   if(r.id===exclude||reservedActors.has(r.id)||r.status!=='alive'||r.plan||r.activity)continue;
   if(r.hunger<35&&r.energy>35)continue;
   const choices=menu(r);
   if(r.hunger>=35){
    const edible=choices.filter(c=>c.action.type==='eat').sort((a,b)=>{
     const expires=(c:ActionChoice)=>c.action.type==='eat'?Math.min(...(world.food?.lots['person:'+r.id]?.[c.action.item]??[]).map(l=>l.expiresAt)):Infinity;
     return expires(a)-expires(b);
    });
    if(edible[0]){select(r,edible[0],choices,'scripted upkeep: eat');continue;}
    const gather=choices.find(c=>{const a=c.action;return a.type==='gather'&&world.resources.find(s=>s.id===a.resourceId)?.kind==='bush';});
    const inspect=choices.find(c=>c.action.type==='move'&&c.label.includes('浆果地点'));
    if(gather??inspect){select(r,(gather??inspect)!,choices,'scripted upkeep: forage');continue;}
   }
   if(r.energy<=35){const sleep=choices.find(c=>c.action.type==='sleep');if(sleep)select(r,sleep,choices,'scripted upkeep: sleep',{minutes:360});}
  }
 }
 function tick(exclude?:string){
  if(Math.floor(world.minute)%15===0)support(exclude);
  const plot=world.plots.find(p=>p.id===plotId),before=plot?.crop?{growth:plot.crop.growth,wateredDay:plot.crop.wateredDay}:null;
  const day=Math.floor(world.minute/DAY),weather=world.weather;
  const stockBefore=snapshotNineFood(world,founderIds),observation=stepWorldWithFoodEvidence(world,1);
  evidence.sample(stockBefore,snapshotNineFood(world,founderIds),observation);
  meals.push(...structuredClone(observation.receipts));
  if(before&&day!==Math.floor(world.minute/DAY)&&plot?.crop){
   const expected=before.wateredDay===day||weather==='rain'?Math.min(4,before.growth+1):before.growth;
   assert.equal(plot.crop.growth,expected);
   growth.push({at:world.minute,day,previousWeather:weather,wateredDay:before.wateredDay,before:before.growth,after:plot.crop.growth});
  }
  for(const [id,index]of pending){const r=person(id);if(!r.plan&&!r.activity){trace[index].completedAt=world.minute;trace[index].failure=r.lastFailure;pending.delete(id);}}
  assert.equal(world.frontierHazards!.weather!.enabled,false);
 }
 function idle(id:string){let remaining=1500;while(person(id).plan||person(id).activity){assert.ok(remaining-->0,'activity timeout');tick(id);}}
 function act(id:string,predicate:(a:Action,c:ActionChoice)=>boolean,purpose:string,fields:Record<string,number|string>={}){
  idle(id);
  for(let attempt=0;attempt<40;attempt++){
   const r=person(id);assert.equal(r.status,'alive',id+' is not alive');
   const choices=menu(r),choice=choices.find(c=>predicate(c.action,c));
   if(choice){select(r,choice,choices,purpose,fields);const index=pending.get(id)!;idle(id);assert.equal(trace[index].failure,null,JSON.stringify(trace[index]));return trace[index];}
   const wait=choices.find(c=>c.action.type==='wait')!;assert.ok(wait,'no wait choice');select(r,wait,choices,'wait for rotating menu',{minutes:30});idle(id);
  }
  throw new Error('No normal menu choice: '+purpose+' at '+world.minute+' '+JSON.stringify(menu(person(id))));
 }
 function checkpoint(stage:string){checkpoints.push({stage,at:world.minute,turnip:physical('turnip'),seed:physical('seed'),coins:totalCoins(world),physical:snapshotNineFood(world,founderIds)});}
 function reload(stage:string){
  // This path belongs to this newly created synthetic run, never a live save.
  const store=new WorldStore(databasePath);store.commit(world,storedRevision);storedRevision=world.revision;store.close();
  const next=new WorldStore(databasePath);const restored=next.load()!;next.close();
  assert.deepEqual(restored,world);world=restored;checkpoint(stage);
 }
 world.clock.paused=false;tick(); // Let the same engine initialize formal systems, no fixture rewrites.
 checkpoint('initialized');const initialTurnip=physical('turnip'),initialSeed=physical('seed'),initialCoins=totalCoins(world);
 assert.equal(world.residents.length,9);assert.equal(world.frontierHazards!.weather!.enabled,false);
 const distance=(p:{at:{x:number;y:number}})=>Math.abs(p.at.x-person(farmerId).at.x)+Math.abs(p.at.y-person(farmerId).at.y);
 const field=world.plots.filter(p=>p.ownerId===farmerId).sort((a,b)=>distance(a)-distance(b)||a.id.localeCompare(b.id))[0];plotId=field.id;
 if(Math.hypot(person(farmerId).at.x-field.at.x,person(farmerId).at.y-field.at.y)>8)
  act(farmerId,a=>a.type==='move'&&a.to.x===field.at.x&&a.to.y===field.at.y,'walk to owned field');
 const planted=act(farmerId,a=>a.type==='production'&&a.operation==='plantCrop'&&a.cropId==='crop/turnip@2'&&a.plotId===plotId,'plant first crop');
 assert.equal(world.plots.find(p=>p.id===plotId)!.crop!.growth,0);
 const irrigations=[];
 for(let day=0;day<4;day++){
  while(Math.floor(world.minute/DAY)<day)tick();
  // Rain is measured at the ordinary midnight boundary, never assigned by this harness.
  if(world.weather!=='rain'){
   idle(farmerId);
   if(person(farmerId).inside||Math.hypot(person(farmerId).at.x-field.at.x,person(farmerId).at.y-field.at.y)>8)
    act(farmerId,a=>a.type==='move'&&a.to.x===field.at.x&&a.to.y===field.at.y,'return to field for daily irrigation');
   const waterBefore=person(farmerId).inventory.water??0;
   if(waterBefore<1)act(farmerId,a=>a.type==='gather'&&world.resources.find(s=>s.id===a.resourceId)?.kind==='spring','draw irrigation water');
   const actualBefore=person(farmerId).inventory.water??0;
   const watered=act(farmerId,a=>a.type==='water'&&a.plotId===plotId,'daily irrigation');
   assert.equal(person(farmerId).inventory.water,actualBefore-1);irrigations.push({day,at:watered.completedAt,usedWater:1});
  }
  while(Math.floor(world.minute/DAY)===day)tick();
  if(day===1)reload('mid-growth SQLite close and reopen');
 }
 idle(farmerId);
 // Sleep/upkeep can leave the farmer indoors: use a real menu walk back.
 if(person(farmerId).inside||Math.hypot(person(farmerId).at.x-field.at.x,person(farmerId).at.y-field.at.y)>8)
  act(farmerId,a=>a.type==='move'&&a.to.x===field.at.x&&a.to.y===field.at.y,'return to mature field');
 const preHarvest=person(farmerId).inventory.turnip??0;
 assert.equal(preHarvest,0,'old roots must be gone so the harvest batch is unambiguous');
 const harvested=act(farmerId,a=>a.type==='harvest'&&a.plotId===plotId,'harvest mature crop');
 const harvestQuantity=person(farmerId).inventory.turnip!;
 assert.equal(harvestQuantity,12);
 const harvestBatch=structuredClone(world.food!.lots['person:'+farmerId].turnip!);
 assert.equal(harvestBatch.length,1);assert.equal(harvestBatch[0].producedAt,harvested.completedAt);
 checkpoint('harvest');
 const beforeSeed=person(farmerId).inventory.seed!;
 const savedSeed=act(farmerId,a=>a.type==='production'&&a.operation==='saveSeed','save harvested root as seed');
 assert.equal(person(farmerId).inventory.seed,beforeSeed+2);assert.equal(person(farmerId).inventory.turnip,harvestQuantity-1);
 const replanted=act(farmerId,a=>a.type==='production'&&a.operation==='plantCrop'&&a.cropId==='crop/turnip@2'&&a.plotId===plotId,'replant same field');
 assert.equal(person(farmerId).inventory.seed,beforeSeed+1);assert.equal(world.plots.find(p=>p.id===plotId)!.crop!.growth,0);
 const hall=world.buildings.find(b=>b.id==='frontier-hall')!;
 const walkHall=(id:string)=>act(id,a=>a.type==='move'&&a.to.x===hall.door.x&&a.to.y===hall.door.y,'walk to public hall');
 walkHall(farmerId);
 act(farmerId,a=>a.type==='civic'&&a.operation==='donate','fund finite public reserve',{amount:6});
 act(farmerId,a=>a.type==='civic'&&a.operation==='propose'&&a.measure.kind==='foodReserve'&&a.measure.item==='turnip','propose public reserve',{quantity:3,unitPrice:2,suppliesBudget:6,dailyNutrition:40,durationDays:2});
 const proposal=world.civic!.proposals.at(-1)!;assert.deepEqual(proposal.votes,{});
 const voters=world.residents.filter(r=>ageYears(r.bornAt,world.minute)>=18).map(r=>r.id);
 for(const id of voters){if(proposal.status!=='open')break;if(id!==farmerId)walkHall(id);act(id,a=>a.type==='civic'&&a.operation==='vote'&&a.proposalId===proposal.id&&a.accept,'independent scripted yes vote');}
 assert.equal(proposal.status,'approved');assert.equal(new Set(Object.keys(proposal.votes)).size,4);
 const reserve=world.civic!.reserves!.at(-1)!;
 assert.equal(accountBalance(world,reserve.supplyAccount),6);
 const table=roomLayout(world,hall).slots.find(s=>s.key==='table')!.at;
 const delivered=act(farmerId,a=>a.type==='civic'&&a.operation==='supplyReserve'&&a.reserveId===reserve.id,'deliver harvested batch to table',{quantity:3});
 assert.equal(person(farmerId).inside,hall.id);assert.deepEqual(person(farmerId).roomAt,table);assert.equal(reserve.inventory.turnip,3);assert.equal(reserve.spent,6);
 const reserveLots=structuredClone(world.food!.lots[reserveContainer(reserve.id)].turnip!);
 assert.deepEqual(reserveLots,[{...harvestBatch[0],quantity:3}]);
 checkpoint('delivered');reload('reserve SQLite close and reopen');
 const restoredReserve=world.civic!.reserves!.find(p=>p.id===reserve.id)!;
 walkHall(childId);const child=person(childId);assert.ok(ageYears(child.bornAt,world.minute)>=6&&ageYears(child.bornAt,world.minute)<18);
 assert.equal(child.inventory.turnip??0,0);
 const beforeTake=physical('turnip'),hunger=child.hunger;
 const taken=act(childId,a=>a.type==='commons'&&a.operation==='takeFood'&&a.reserveId===reserve.id,'child collects at public table');
 assert.equal(child.inside,hall.id);assert.deepEqual(child.roomAt,table);assert.equal(child.inventory.turnip,1);assert.ok(child.hunger>hunger,'pickup is not eating');
 assert.equal(restoredReserve.inventory.turnip,2);assert.equal(restoredReserve.withdrawn,1);assert.equal(physical('turnip'),beforeTake);
 assert.deepEqual(world.food!.lots['person:'+childId].turnip,[{...harvestBatch[0],quantity:1}]);
 const beforeEat=physical('turnip'),beforeHunger=child.hunger;
 const eaten=act(childId,a=>a.type==='eat'&&a.item==='turnip','child independently eats collected root');
 assert.equal(child.inventory.turnip,0);assert.equal(physical('turnip'),beforeEat-1);assert.ok(child.hunger<beforeHunger);
 const childReceipt=meals.find(r=>r.residentId===childId&&r.at===eaten.completedAt&&r.item==='turnip');assert.ok(childReceipt);assert.equal(childReceipt.planId,`offline-food-chain:${trace.indexOf(eaten)}`);assert.equal(childReceipt.quantity,1);assert.equal(childReceipt.nutrition,20);
 // Exercise the formerly invisible family-stock -> family-gift -> child path.
 // Every meeting, contribution, approval, collection and meal is a normal menu
 // action; temporarily reserving actors only stops the harness choosing upkeep.
 const partnerId='founder-1-2',home=world.buildings.find(b=>b.id===person(farmerId).homeId)!;
 for(const id of [farmerId,partnerId,childId])reservedActors.add(id);
 for(const id of [farmerId,partnerId,childId])act(id,a=>a.type==='move'&&a.to.x===home.door.x&&a.to.y===home.door.y,'walk home for family gift');
 act(farmerId,a=>a.type==='household'&&a.operation==='create'&&a.targetId===partnerId&&a.item==='turnip','offer family pool with own coin',{amount:1,quantity:0,name:'离线家庭储物'});
 const poolId=world.household!.pools.at(-1)!.id;
 act(partnerId,a=>a.type==='household'&&a.operation==='respond'&&a.poolId===poolId&&a.accept===true,'partner independently accepts family pool');
 const beforeDeposit=physical('turnip');
 act(farmerId,a=>a.type==='household'&&a.operation==='deposit'&&a.poolId===poolId&&a.item==='turnip','deposit harvested roots in own family share',{amount:0,quantity:2});
 assert.equal(physical('turnip'),beforeDeposit);checkpoint('family stock');
 act(farmerId,a=>a.type==='household'&&a.operation==='proposeGift'&&a.poolId===poolId&&a.targetId===childId&&a.item==='turnip','propose two-root family gift',{amount:0,quantity:2,ownPercent:100});
 const giftId=world.household!.gifts.at(-1)!.id;
 act(partnerId,a=>a.type==='household'&&a.operation==='approveGift'&&a.giftId===giftId,'partner independently approves exact family gift');
 assert.equal(physical('turnip'),beforeDeposit);
 const giftContainer='family-gift:'+giftId+':'+farmerId;
 assert.deepEqual(world.food!.lots[giftContainer].turnip,[{...harvestBatch[0],quantity:2}]);
 reload('family gift SQLite close and reopen');
 const beforeGiftHunger=person(childId).hunger;
 const giftTaken=act(childId,a=>a.type==='household'&&a.operation==='acceptGift'&&a.giftId===giftId,'child independently accepts family gift');
 assert.equal(physical('turnip'),beforeDeposit);assert.equal(person(childId).inventory.turnip,2);assert.ok(person(childId).hunger>beforeGiftHunger);
 const beforeGiftEat=physical('turnip'),giftEatHunger=person(childId).hunger;
 const giftEaten=act(childId,a=>a.type==='eat'&&a.item==='turnip','child independently eats gifted root');
 assert.equal(physical('turnip'),beforeGiftEat-1);assert.equal(person(childId).inventory.turnip,1);assert.ok(person(childId).hunger<giftEatHunger);
 const giftReceipt=meals.find(r=>r.residentId===childId&&r.at===giftEaten.completedAt&&r.item==='turnip');assert.ok(giftReceipt);
 assert.equal(giftReceipt.planId,`offline-food-chain:${trace.indexOf(giftEaten)}`);
 const observed=evidence.finish();
 const rootsEaten=meals.filter(r=>founderIds.includes(r.residentId)&&r.item==='turnip').reduce((sum,r)=>sum+r.quantity,0);
 assert.equal(observed.directEating.nineIntakeTotals!.units.turnip,rootsEaten,'fixed-nine intake is separate from provider stock debits');
 for(const slice of [observed.journeyMeals,observed.familyJourneyMeals,observed.publicDutyMeals,observed.emergencyCareMeals]){assert.deepEqual(slice.receipts,[]);assert.equal(slice.nineIntakeTotals!.completedServings,0);}
 assert.equal(observed.foodConsumption,null);
 assert.equal(observed.foodLosses.scopedTotals!.inputs.units.turnip,0,'scoped spoilage, never the external/global cumulative counter');
 for(const slice of [observed.careMeals,observed.childCareMeals,observed.longCareMeals,observed.journeyMeals,observed.familyJourneyMeals,observed.publicDutyMeals,observed.emergencyCareMeals])assert.equal(slice.scopedTotals!.inputs.units.turnip,0,'no other covered root debit in this scripted trace');
 const seedFlows=observed.foodFlows.receipts.filter(f=>f.action==='saveSeed');assert.equal(seedFlows.length,1);
 const seedFlow=seedFlows[0];assert.equal(seedFlow.type,'processed');if(seedFlow.type!=='processed')throw Error('Expected seed conversion');
 assert.equal(seedFlow.residentId,farmerId);assert.equal(seedFlow.at,savedSeed.completedAt);assert.equal(seedFlow.planId,`offline-food-chain:${trace.indexOf(savedSeed)}`);
 assert.deepEqual(seedFlow.inputs,[{item:'turnip',quantity:1,nutrition:20,lots:[{...harvestBatch[0],quantity:1,nutrition:20}]}]);
 assert.deepEqual(seedFlow.outputs,[{item:'seed',quantity:2,nutrition:0,lots:[]}]);
 assert.equal(observed.foodFlows.scopedTotals!.inputs.units.turnip,1);assert.equal(observed.foodFlows.scopedTotals!.outputs.units.seed,2);
 assert.equal(observed.foodFlows.nineIntakeTotals,null,'saving seed is not food intake');
 assert.equal(physical('turnip'),initialTurnip+harvestQuantity-seedFlow.inputs[0].quantity-rootsEaten);
 assert.equal(person(farmerId).inventory.water,initialPeople.find(r=>r.id===farmerId)!.inventory.water!-irrigations.length);
 assert.equal(physical('seed'),initialSeed-1+2-1);assert.equal(totalCoins(world),initialCoins);
 assert.deepEqual(world.residents.map(r=>r.id),founderIds);assert.deepEqual(ownership(),initialOwnership);
 reload('completed SQLite close and reopen');
 const scopedHarvest=observed.foodFlows.receipts.filter((r,i)=>observed.foodFlows.scopes[i]==='nine-and-public'&&r.action==='harvest').flatMap(r=>r.outputs).filter(a=>a.item==='turnip').reduce((n,a)=>n+a.quantity,0);
 assert.equal(scopedHarvest,harvestQuantity);
 assert.equal(observed.foodLosses.scopedTotals!.inputs.units.turnip,0);
 for(const slice of [observed.directEating,observed.foodFlows,observed.foodLosses,observed.careMeals,observed.childCareMeals,observed.longCareMeals,observed.journeyMeals,observed.familyJourneyMeals,observed.publicDutyMeals,observed.emergencyCareMeals]){assert.equal(slice.unobservedMinutes,0);assert.equal(slice.observedMinutes,world.minute-initialMinute);assert.ok(slice.scopedTotals);}
 return {schema:1,executionKind:'offline-scripted-normal-menu',scriptedRulesChainPassed:true,realModelExecuted:false,modelAutonomyAcceptancePassed:null,populationSurvivalAcceptancePassed:null,
  seed:5401,mode:world.mode,scenario:world.scenario,initialMinute,endMinute:world.minute,elapsedGameMinutes:world.minute-initialMinute,
  weatherHazardsEnabled:world.frontierHazards!.weather!.enabled,initialPeople,farmerId,childId,plotId,plantedAt:planted.completedAt,harvestedAt:harvested.completedAt,replantedAt:replanted.completedAt,
  harvestQuantity,harvestBatch,irrigations,growth,proposal:structuredClone(proposal),deliveredAt:delivered.completedAt,reserveLots,takenAt:taken.completedAt,eatenAt:eaten.completedAt,childReceipt,
  conservation:{initialTurnip,harvestQuantity,rootsSavedForSeed:1,rootsEaten,spoiledRoots:0,finalTurnip:physical('turnip'),initialSeed,finalSeed:physical('seed'),initialCoins,finalCoins:totalCoins(world)},
  accountingScope:{founderIds,inventoryDebitBoundary:'fixed-nine-and-public',intakeBoundary:'fixed-nine-only',publicPhysicalStoresIncluded:true,foreignTradeAndAidUntilCollection:'external',treasuryStockIncluded:false,completeFoodLedger:false,foodProduction:null,foodConsumption:null},
  familyGift:{poolId,giftId,giftContainer,takenAt:giftTaken.completedAt,eatenAt:giftEaten.completedAt,receipt:giftReceipt,quantity:2,remainingInChild:1},
  conversions:[{action:'plantCrop',at:planted.completedAt,inputs:{seed:1},outputs:{}},{action:'saveSeed',at:savedSeed.completedAt,inputs:{turnip:1},outputs:{seed:2}},{action:'plantCrop',at:replanted.completedAt,inputs:{seed:1},outputs:{}}],evidence:observed,
  actionCounts:{selected:trace.length,completed:trace.filter(t=>t.completedAt!==null).length,pending:trace.filter(t=>t.completedAt===null).length,failed:trace.filter(t=>t.failure!==null).length},
  farmerWater:{initial:initialPeople.find(r=>r.id===farmerId)!.inventory.water,irrigationUsed:irrigations.length,final:person(farmerId).inventory.water},
  checkpoints,finalResidents:world.residents.map(r=>({id:r.id,status:r.status,health:r.health,hunger:r.hunger,energy:r.energy})),trace,meals,
  limitations:['Selections, upkeep and yes votes are scripted, not model decisions.','One crop cycle and two child receipts do not prove nine-person or cross-season sustainability.','Physical custody is not edible/reachable stock. Fixed founder IDs and public stock are separated from external trade and aid cargo.','Each observed evidence slice is partial. Unfinished employment reservations/refunds, non-food processing and boundary transfers are not covered by foodFlows; no complete food, nutrition or gross-damage ledger is claimed.','Direct saveSeed above is independently observed as processing, never food source addition or intake; its conversions entry is a cross-check, not a second receipt. plantCrop remains a separately checked, unobserved conversion.']};
}
