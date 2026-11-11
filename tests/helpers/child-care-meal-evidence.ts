import assert from 'node:assert/strict';
import type {Item,Resident,World} from '../../src/shared/types.js';
import type {ChildCareMealReceipt} from '../../src/world/food-consumption-evidence.js';
import {stepWorldWithFoodEvidence} from '../../src/world/engine.js';
import {YEAR} from '../../src/world/time.js';
import {careFixture,careChoice,queueCareAction} from './care-meal-evidence.js';

export function childCareFixture(food:'meal'|'turnip'='meal'){
 const f=careFixture();f.beneficiary.bornAt=f.w.minute-3*YEAR;
 f.beneficiary.guardianIds=[f.provider.id];f.beneficiary.hunger=80;
 if(food==='turnip'){
  f.provider.inventory.meal=0;f.provider.inventory.turnip=10;
  f.w.food!.lots['person:'+f.provider.id]={turnip:[{quantity:10,producedAt:f.w.minute-10,expiresAt:f.w.minute+1000,definition:'food/life@1'}]};
 }
 return f;
}
export function queueChildCare(f:ReturnType<typeof childCareFixture>,provider=f.provider){
 return queueCareAction(f.w,provider,careChoice(f.w,provider,a=>a.type==='tendChild'&&a.targetId===f.beneficiary.id));
}
export function finishChildCare(w:World,r:Resident){
 const receipts:ChildCareMealReceipt[]=[];let left=1000;
 while(r.plan||r.activity){assert.ok(left-->0);receipts.push(...stepWorldWithFoodEvidence(w,.25).childCareMeals!);}
 return receipts;
}
export function originalChildLots(f:ReturnType<typeof childCareFixture>,food:Item='meal'){
 for(const [version,value] of [[90,10],[91,30]] as const)f.w.definitions['food/life@'+version]={...f.w.definitions['food/life@1'],version,data:{...f.w.definitions['food/life@1'].data,nutrition:{[food]:value}}};
 f.w.food!.lots['person:'+f.provider.id][food]=[{quantity:.25,producedAt:f.w.minute-20,expiresAt:f.w.minute+500,definition:'food/life@90'},
 {quantity:9.75,producedAt:f.w.minute-10,expiresAt:f.w.minute+1000,definition:'food/life@91'}];
}
