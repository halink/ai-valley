import assert from 'node:assert/strict';
import type {Action,Inventory,Resident,World} from '../../src/shared/types.js';
import type {LongCareMealReceipt} from '../../src/world/food-consumption-evidence.js';
import {stepWorldWithFoodEvidence} from '../../src/world/engine.js';
import {careWindows} from '../../src/world/long-care.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {YEAR} from '../../src/world/time.js';
import {careFixture,careChoice,queueCareAction,originalCareLots} from './care-meal-evidence.js';

export function finishLongCare(w:World,r:Resident){
 const receipts:LongCareMealReceipt[]=[];let left=1000;
 while(r.plan||r.activity){assert.ok(left-->0);receipts.push(...stepWorldWithFoodEvidence(w,.25).longCareMeals!);}
 return receipts;
}
export function longCareChoice(w:World,r:Resident,predicate:(a:Action)=>boolean,terms:Record<string,unknown>={}){
 const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>predicate(c.action));assert.ok(choice,'actual final menu has long-care action');
 return parseChoice(JSON.stringify({choice:choice.id,...terms}),menu).actions[0];
}
/** Real final-menu offer, acceptance and required child assent; no fabricated active contract. */
export function longCareFixture(age=30,materials?:Inventory){
 const f=careFixture();f.beneficiary.health=60;f.beneficiary.bornAt=f.w.minute-age*YEAR;
 f.other.at={...f.provider.at};for(const r of f.w.residents)r.coins=100;
 if(age<18)f.beneficiary.guardianIds=[f.other.id];
 if(materials){
  f.w.definitions['care/long@90']={...f.w.definitions['care/long@1'],version:90,data:{...f.w.definitions['care/long@1'].data,materials,healthGain:7}};
  f.w.activeDefinitions['care/long']='care/long@90';
  Object.assign(f.provider.inventory,{meal:10,turnip:10,water:9});
 }
 queueCareAction(f.w,f.provider,longCareChoice(f.w,f.provider,a=>a.type==='longCare'&&a.operation==='offer'&&a.targetId===f.beneficiary.id&&a.condition==='daily',
  {fee:3,days:2,startsIn:60,startMinute:480,windowMinutes:120,visitsPerDay:2}));
 assert.deepEqual(finishLongCare(f.w,f.provider),[]);
 const c=f.w.longCare!.agreements.at(-1)!,signer=age<18?f.other:f.beneficiary;
 queueCareAction(f.w,signer,careChoice(f.w,signer,a=>a.type==='longCare'&&a.operation==='accept'&&a.agreementId===c.id));
 assert.deepEqual(finishLongCare(f.w,signer),[]);
 if(c.status==='awaitingChild'){
  queueCareAction(f.w,f.beneficiary,careChoice(f.w,f.beneficiary,a=>a.type==='longCare'&&a.operation==='assent'&&a.agreementId===c.id));
  assert.deepEqual(finishLongCare(f.w,f.beneficiary),[]);
 }
 assert.equal(c.status,'active');f.w.minute=careWindows(c,c.startDay)[0].start+1;
 originalCareLots(f);f.beneficiary.hunger=80;f.other.at={x:1,y:16};
 return {...f,c};
}
export function queueLongCare(f:ReturnType<typeof longCareFixture>){
 return queueCareAction(f.w,f.provider,careChoice(f.w,f.provider,a=>a.type==='longCare'&&a.operation==='visit'&&a.agreementId===f.c.id));
}
