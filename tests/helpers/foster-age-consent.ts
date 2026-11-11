import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../../src/shared/types.js';
import {careFixture,carePlan} from './care-meal-evidence.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import {YEAR} from '../../src/world/time.js';

export function fosterFixture(age?:number){
 const {w,provider:volunteer,beneficiary:child,other:guardian}=careFixture();
 const birthday=w.minute+30;
 Object.assign(child,{bornAt:age===undefined?birthday-6*YEAR:w.minute-age*YEAR,guardianIds:[guardian.id],parents:[guardian.id],
  lifeStage:age===undefined||age<6?'infant':'child',hunger:0,canDecide:age!==undefined&&age>=6,canExpress:age!==undefined&&age>=6,
  decisionDue:age===undefined||age<6?Number.MAX_SAFE_INTEGER:w.minute});
 child.lastDecisionAt=child.bornAt;guardian.at={...volunteer.at};
 return {w,volunteer,child,guardian,birthday};
}
export const fosterMenu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
export function selectFoster(w:World,r:Resident,type:'fosterChild'|'familyConsent',accept=true){
 const choices=fosterMenu(w,r),choice=choices.find(c=>c.action.type===type&&(c.action.type!=='familyConsent'||c.action.accept===accept));
 assert.ok(choice,'real numbered menu includes '+type+' '+accept);assert.match(choice.id,/^\d+$/);
 return parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0];
}
export function queueFoster(w:World,r:Resident,action:Action){const plan=carePlan(w,r,[action]);assert.equal(submitPlan(w,plan).ok,true);return plan;}
export function finishFoster(w:World,r:Resident){let limit=100;while(r.plan||r.activity){assert.ok(limit-->0);stepWorld(w,.25);}assert.equal(r.lastFailure,null);}
export function chooseFoster(w:World,r:Resident,type:'fosterChild'|'familyConsent',accept=true){const plan=queueFoster(w,r,selectFoster(w,r,type,accept));finishFoster(w,r);return plan;}
export function proposeFoster(f:ReturnType<typeof fosterFixture>){chooseFoster(f.w,f.volunteer,'fosterChild');assert.ok(f.child.guardianOffer);return f.child.guardianOffer;}
