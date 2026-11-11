import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../../src/shared/types.js';
import {createFormalWorld} from '../../src/world/formal-seed.js';
import {initializeCivic} from '../../src/world/civic.js';
import {initializeForeignTrade} from '../../src/world/foreign-trade.js';
import {advancePublicDuties} from '../../src/world/public-duties.js';
import {initializeFood} from '../../src/world/food.js';
import {stepWorldWithFoodEvidence} from '../../src/world/engine.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {YEAR} from '../../src/world/time.js';
import {queueCareAction} from './care-meal-evidence.js';
import {atWorkstation} from './workspaces.js';

export function finishPublicMeal(w:World,r:Resident){
 const rows=[];let remaining=2000;
 while(r.plan||r.activity){assert.ok(remaining-->0,'action must finish');rows.push(...stepWorldWithFoodEvidence(w,.25).publicDutyMeals??[]);}
 return rows;
}
export function publicMealChoice(w:World,r:Resident,predicate:(a:Action)=>boolean,terms:Record<string,unknown>={}){
 for(let i=0;i<100;i++){
  const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>predicate(c.action));
  if(choice)return parseChoice(JSON.stringify({choice:choice.id,...terms}),menu).actions[0];
  // The actual compact final menu rotates every half hour. Advance fixture time before choosing.
  w.minute+=30;
 }
 throw new Error('actual numbered final menu must expose requested public action');
}
export function queuePublicAction(w:World,r:Resident,a:Action){atWorkstation(w,r,a);return queueCareAction(w,r,a);}
export function runPublicAction(w:World,r:Resident,predicate:(a:Action)=>boolean,terms:Record<string,unknown>={}){
 const plan=queuePublicAction(w,r,publicMealChoice(w,r,predicate,terms));assert.deepEqual(finishPublicMeal(w,r),[]);assert.equal(r.lastFailure,null);return plan;
}
/** Synthetic stock/people only. Authority, procurement, booking and attendance use actual numbered menus. */
export function publicMealFixture(role:'kitchen'|'care'='kitchen',funded=false){
 const w=createFormalWorld();w.clock.paused=false;w.minute=0;
 w.residents=w.residents.filter(r=>w.minute-r.bornAt>18*YEAR).slice(0,3);
 const building=w.buildings.find(b=>b.ownerId==='commons'&&b.kind===(role==='care'?'clinic':'lodge'))!;
 w.buildings=[building];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents)Object.assign(r,{at:{...building.door},inside:null,roomAt:null,homeId:null,agency:{focus:"community",goals:[],routines:[],nextSerial:0},coins:500,inventory:{turnip:20,meal:10,water:20},health:70,energy:100,hunger:70,canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,knownBuildings:[building.id]});
 const [provider,beneficiary,other]=w.residents;for(const r of w.residents){r.skills.care=2;r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);}
 initializeCivic(w);initializeForeignTrade(w);advancePublicDuties(w);initializeFood(w);
 if(funded){
  for(let i=0;i<5;i++)runPublicAction(w,other,a=>a.type==='civic'&&a.operation==='donate'&&a.amount===20);
  runPublicAction(w,other,a=>a.type==='civic'&&a.operation==='propose'&&a.measure.kind==='service',
   {wagePerService:3,wageBudget:60,suppliesBudget:40,durationDays:2});
  const proposal=w.civic!.proposals.at(-1)!;assert.deepEqual(proposal.votes,{});
  for(const voter of [other,beneficiary])runPublicAction(w,voter,a=>a.type==='civic'&&a.operation==='vote'&&a.proposalId===proposal.id&&a.accept);
  assert.equal(proposal.status,'approved');const budget=w.civic!.budgets.at(-1)!;
  for(const item of [role==='care'?'meal':'turnip','water'])runPublicAction(w,other,a=>a.type==='civic'&&a.operation==='supply'&&a.budgetId===budget.id&&a.item===item);
 }
 w.minute=Math.floor(w.minute/1440)*1440+(w.minute%1440<600?600:w.minute%1440<900?900:2040);advancePublicDuties(w);
 const shift=w.duties!.shifts.find(s=>s.role===role&&s.start===w.minute)!;assert.equal(!!shift.funding,funded);
 for(const operation of ['claim','attend'])runPublicAction(w,provider,a=>a.type==='publicDuty'&&a.operation===operation&&a.shiftId===shift.id);
 const container=funded?'public:'+building.id:'person:'+provider.id,item=role==='care'?'meal':'turnip';
 initializeFood(w);
 for(const [version,value] of [[90,10],[91,30]] as const)w.definitions['food/life@'+version]={...w.definitions['food/life@1'],version,data:{...w.definitions['food/life@1'].data,nutrition:{meal:value,turnip:value}}};
 const inventory=funded?w.civic!.stores[building.id]:provider.inventory;
 w.food!.lots[container][item]=[{quantity:.25,producedAt:w.minute-20,expiresAt:w.minute+500,definition:'food/life@90'},
  {quantity:inventory[item]!-.25,producedAt:w.minute-10,expiresAt:w.minute+1000,definition:'food/life@91'}];
 beneficiary.hunger=80;beneficiary.health=60;
 return {w,provider,beneficiary,other,shift,building,container,item:item as 'meal'|'turnip',inventory};
}
export function queuePublicMeal(f:ReturnType<typeof publicMealFixture>,r=f.beneficiary){return queuePublicAction(f.w,r,publicMealChoice(f.w,r,a=>a.type==='publicDuty'&&a.operation==='receive'&&a.shiftId===f.shift.id));}
