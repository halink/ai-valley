import assert from 'node:assert/strict';
import type {Resident,World} from '../../src/shared/types.js';
import type {EmergencyCareMealReceipt} from '../../src/world/food-consumption-evidence.js';
import {stepWorldWithFoodEvidence} from '../../src/world/engine.js';
import {YEAR} from '../../src/world/time.js';
import {careFixture,careChoice,queueCareAction,originalCareLots} from './care-meal-evidence.js';
export {originalCareLots};
export function finishEmergencyCare(w:World,r:Resident){
 const rows:EmergencyCareMealReceipt[]=[];let left=1000;
 while(r.plan||r.activity){assert.ok(left-->0);rows.push(...stepWorldWithFoodEvidence(w,.25).emergencyCareMeals!);}
 return rows;
}
export function emergencyCareFixture(age=10,rescue=false){
 const f=careFixture();f.beneficiary.bornAt=f.w.minute-age*YEAR;f.other.at={...f.provider.at};
 for(const r of f.w.residents){r.parents=[];r.adoptiveParents=[];r.relations=[];}
 f.beneficiary.guardianIds=[];
 if(rescue){f.beneficiary.health=18;f.beneficiary.canDecide=false;}
 originalCareLots(f);return f;
}
export function offerEmergencyCare(f:ReturnType<typeof emergencyCareFixture>){
 queueCareAction(f.w,f.provider,careChoice(f.w,f.provider,a=>a.type==='emergencyCare'&&a.operation==='offer'&&a.childId===f.beneficiary.id&&a.reviewerId===f.other.id));
 assert.deepEqual(finishEmergencyCare(f.w,f.provider),[]);return f.w.emergencyCare!.agreements.at(-1)!;
}
export function activeEmergencyCare(age=10){
 const f=emergencyCareFixture(age),c=offerEmergencyCare(f);
 queueCareAction(f.w,f.other,careChoice(f.w,f.other,a=>a.type==='emergencyCare'&&a.operation==='review'&&a.agreementId===c.id));
 assert.deepEqual(finishEmergencyCare(f.w,f.other),[]);
 if(age>=6){assert.equal(c.status,'offered');queueCareAction(f.w,f.beneficiary,careChoice(f.w,f.beneficiary,a=>a.type==='emergencyCare'&&a.operation==='accept'&&a.agreementId===c.id));assert.deepEqual(finishEmergencyCare(f.w,f.beneficiary),[]);}
 assert.equal(c.status,'active');return {...f,c};
}
export function queueEmergencyCare(f:ReturnType<typeof emergencyCareFixture>,operation:'feed'|'rescueMeal'='feed',provider=f.provider){
 return queueCareAction(f.w,provider,careChoice(f.w,provider,a=>a.type==='emergencyCare'&&a.operation===operation&&(operation==='rescueMeal'?a.childId===f.beneficiary.id:a.agreementId===f.w.emergencyCare!.agreements.at(-1)!.id)));
}
