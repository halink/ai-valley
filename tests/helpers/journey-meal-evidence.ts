import assert from 'node:assert/strict';
import {createWorld} from '../../src/world/seed.js';
import {initializeMigration,applyOutsideDecision,outsideDecisionContext} from '../../src/world/migration.js';
import {initializeForeignTrade} from '../../src/world/foreign-trade.js';
import {initializeOutsideAid,completeOutsideAid} from '../../src/world/outside-aid.js';
import {initializeFood} from '../../src/world/food.js';
import {stepWorld} from '../../src/world/engine.js';
import {decisionChoices} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import type {Resident,World} from '../../src/shared/types.js';
import {YEAR} from '../../src/world/time.js';
import {finishChosenVisit} from './visitor-journeys.js';

export function journeyMealFixture(mail=false,returning=false){
 const w=createWorld(414);w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:20,height:12,tiles:Array(240).fill('grass'),entrance:{x:0,y:6}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,1);
 const child=w.residents[0];Object.assign(child,{at:{...w.map.entrance},inside:null,roomAt:null,homeId:null,inventory:{},parents:[],guardianIds:[],bornAt:w.minute-10*YEAR,hunger:70,energy:100,health:100,canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,knownBuildings:[],knownResources:[],decisionDue:Number.MAX_SAFE_INTEGER,lastDecisionAt:w.minute});
 initializeForeignTrade(w);initializeOutsideAid(w);initializeMigration(w);initializeFood(w);
 const c=w.migration!.contacts[0],r=c.person!;
 if(returning){w.residents.push(r);delete c.person;}
 assert.equal(applyOutsideDecision(w,r.id,r.revision,{intention:'Offline chosen journey',actions:[{type:'travelToValley'}]}).ok,true);
 if(mail){finishChosenVisit(w,r);assert.equal(completeOutsideAid(w,child,{type:'outsideAid',operation:'post'}),null);
  assert.equal(completeOutsideAid(w,r,{type:'outsideAid',operation:'carryMail',noticeId:w.outsideAid!.notices[0].id}),null);
 }else stepWorld(w,c.journey!.staged!.stageRemaining);
 r.hunger=80;const j=mail?w.outsideAid!.visitorJourneys![0]:c.journey!.staged!;
 return {w,r,c,j,mail};
}
export function chooseJourneyMeal(w:World,r:Resident,mail:boolean){
 const choices=decisionChoices(outsideDecisionContext(w,r));
 const choice=choices.find(c=>mail?c.action.type==='outsideAid'&&c.action.operation==='eatMail'&&c.action.item==='meal':c.action.type==='visitorJourney'&&c.action.operation==='eat'&&c.action.item==='meal');
 assert.ok(choice,'actual final numbered menu includes the meal');const decision=parseChoice(JSON.stringify({choice:choice.id}),choices);
 assert.equal(applyOutsideDecision(w,r.id,r.revision,decision).ok,true);return decision;
}
export function originalJourneyLots(w:World,r:Resident){
 r.inventory.meal=3;
 for(const [version,value] of [[90,10],[91,30]])w.definitions['food/life@'+version]={...w.definitions['food/life@1'],version,data:{...w.definitions['food/life@1'].data,nutrition:{meal:value}}};
 w.food!.lots['person:'+r.id].meal=[{quantity:.25,producedAt:w.minute-20,expiresAt:w.minute+500,definition:'food/life@90'},{quantity:2.75,producedAt:w.minute-10,expiresAt:w.minute+1000,definition:'food/life@91'}];
}
export function journeyPerson(w:World,id:string){return w.residents.find(r=>r.id===id)??w.migration!.contacts.find(c=>c.id===id)!.person!;}
