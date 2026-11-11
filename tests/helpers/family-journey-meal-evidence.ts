import assert from 'node:assert/strict';
import {createWorld} from '../../src/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {decisionContext,decisionChoices} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {YEAR} from '../../src/world/time.js';
import type {Resident,World} from '../../src/shared/types.js';
import type {FamilyRelocationAction} from '../../src/shared/family-relocation.js';

export function familyJourneyMealFixture(includeAdult=false,longRoute=false){
 const w=createWorld(415);w.mode='formal';w.clock.paused=false;
 const [parent,owner,child]=w.residents;w.residents=[parent,owner,child];
 const width=longRoute?200:24;
 w.map={width,height:18,name:'Synthetic family meal fixture',entrance:{x:2,y:15},tiles:Array(width*18).fill('grass')};
 const old={...w.buildings[0],at:{x:2,y:3},door:{x:5,y:8},capacity:4,residents:[parent.id,child.id]};
 const home={...w.buildings[1],at:{x:longRoute?174:14,y:3},door:{x:longRoute?177:17,y:8},capacity:4,residents:[owner.id]};
 const hall={...w.buildings[3],at:{x:6,y:10},width:5,height:4,door:{x:8,y:14},capacity:4};
 w.buildings=[old,home,hall];w.resources=[];w.plots=[];w.graves=[];
 for(const p of w.residents)Object.assign(p,{at:{x:4,y:9},inside:null,roomAt:null,bornAt:w.minute-30*YEAR,homeId:p===owner?home.id:old.id,inventory:{meal:40,water:40},hunger:70,energy:100,health:100,canDecide:true,canExpress:true,knownBuildings:w.buildings.map(b=>b.id),knownPeople:w.residents.map(p=>p.id),plan:null,activity:null,decisionDue:Number.MAX_SAFE_INTEGER});
 Object.assign(child,{bornAt:w.minute-9*YEAR,parents:[parent.id],guardianIds:includeAdult?[parent.id,owner.id]:[parent.id],inventory:{}});
 stepWorld(w,1);return {w,parent,owner,child,old,home,hall,includeAdult};
}
export type FamilyJourneyFixture=ReturnType<typeof familyJourneyMealFixture>;
let serial=0;
export function chooseFamilyJourney(w:World,r:Resident,operation:FamilyRelocationAction['operation'],predicate:(action:FamilyRelocationAction)=>boolean=()=>true){
 const choices=decisionChoices(decisionContext(w,r));
 const choice=choices.find(c=>c.action.type==='familyRelocation'&&c.action.operation===operation&&predicate(c.action));
 assert.ok(choice,`final numbered menu has ${operation} at ${w.minute}`);
 const decision=parseChoice(JSON.stringify({choice:choice.id}),choices);
 const plan={id:'family-meal-test:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision};
 assert.equal(submitPlan(w,plan).ok,true);return plan;
}
export function finishFamilyJourneyChoice(w:World,r:Resident){
 const rows=[] as NonNullable<ReturnType<typeof stepWorldWithFoodEvidence>['familyJourneyMeals']>;
 for(let n=0;(r.plan||r.activity)&&n<100;n++)rows.push(...stepWorldWithFoodEvidence(w,.2).familyJourneyMeals!);
 assert.equal(r.lastFailure,null);assert.equal(r.plan,null);assert.equal(r.activity,null);return rows;
}
export function acceptFamilyJourney(f:FamilyJourneyFixture){
 chooseFamilyJourney(f.w,f.parent,'propose',a=>a.operation==='propose'&&a.buildingId===f.home.id&&a.memberIds.length===(f.includeAdult?3:2));
 assert.deepEqual(finishFamilyJourneyChoice(f.w,f.parent),[]);
 const c=f.w.familyRelocation!.agreements.at(-1)!;
 for(const id of c.requiredSignerIds.filter(id=>id!==f.parent.id)){const r=f.w.residents.find(p=>p.id===id)!;chooseFamilyJourney(f.w,r,'accept');assert.deepEqual(finishFamilyJourneyChoice(f.w,r),[]);}
 assert.equal(c.status,'accepted');stepWorld(f.w,Math.max(0,c.departAfter-f.w.minute));return c;
}
export function departFamilyJourney(f:FamilyJourneyFixture){
 const c=acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');return {c,rows:finishFamilyJourneyChoice(f.w,f.parent)};
}
export function originalFamilyJourneyLots(f:FamilyJourneyFixture){
 for(const [version,value] of [[90,10],[91,30]])f.w.definitions['food/life@'+version]={...f.w.definitions['food/life@1'],version,data:{...f.w.definitions['food/life@1'].data,nutrition:{meal:value}}};
 f.w.food!.lots['person:'+f.parent.id].meal=[{quantity:.25,producedAt:f.w.minute-20,expiresAt:f.w.minute+500,definition:'food/life@90'},{quantity:39.75,producedAt:f.w.minute-10,expiresAt:f.w.minute+1000,definition:'food/life@91'}];
}
