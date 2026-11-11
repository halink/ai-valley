import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../../src/shared/types.js';
import {careFixture,careChoice,queueCareAction} from './care-meal-evidence.js';
import {longCareChoice,finishLongCare} from './long-care-meal-evidence.js';
import {DAY,YEAR} from '../../src/world/time.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';

/** All contract creation, guardian signature and later choices use the final menu. */
export function birthdayCareFixture(accept=true,withHome=false){
 const f=careFixture();const {w,provider,beneficiary,other}=f;
 if(withHome){const home={id:'care-birthday-home',kind:'home' as const,name:'合成照护住所',at:{x:10,y:5},width:3,height:3,door:{x:11,y:8},ownerId:other.id,definition:'building/home@1',capacity:6,residents:[beneficiary.id,other.id],condition:100};w.buildings.push(home);for(const r of w.residents){r.homeId=home.id;r.knownBuildings=[home.id];}}
 const firstDay=Math.floor((w.minute+61)/DAY)+1,birthday=firstDay*DAY+501;
 beneficiary.bornAt=birthday-6*YEAR;beneficiary.guardianIds=[other.id];beneficiary.lifeStage='infant';
 beneficiary.canDecide=false;beneficiary.canExpress=false;beneficiary.decisionDue=Number.MAX_SAFE_INTEGER;
 beneficiary.lastDecisionAt=beneficiary.bornAt;beneficiary.health=100;beneficiary.hunger=20;
 other.at={...provider.at};for(const r of w.residents)r.coins=100;
 queueCareAction(w,provider,longCareChoice(w,provider,a=>a.type==='longCare'&&a.operation==='offer'&&a.targetId===beneficiary.id&&a.condition==='daily',
  {fee:3,days:2,startsIn:60,startMinute:480,windowMinutes:120,visitsPerDay:2}));finishLongCare(w,provider);
 const c=w.longCare!.agreements.at(-1)!;
 if(accept){queueCareAction(w,other,careChoice(w,other,a=>a.type==='longCare'&&a.operation==='accept'&&a.agreementId===c.id));finishLongCare(w,other);}
 assert.equal(c.status,accept?'active':'offered');assert.equal(c.childAssent,false);assert.equal(c.childAssentedAt,null);
 assert.equal(c.startDay,firstDay);w.minute=firstDay*DAY+481;
 return {...f,c,birthday};
}
export function careMenu(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
export function selectCare(w:World,r:Resident,id:string,operation:string){
 return careChoice(w,r,a=>a.type==='longCare'&&a.operation===operation&&a.agreementId===id);
}
export function hasCare(w:World,r:Resident,id:string,operation:string){
 return careMenu(w,r).some(c=>c.action.type==='longCare'&&c.action.operation===operation&&c.action.agreementId===id);
}
export function chooseCare(w:World,r:Resident,id:string,operation:string){return queueCareAction(w,r,selectCare(w,r,id,operation));}
export function careAction(id:string,operation:'visit'|'assent'|'accept'|'arm'|'cancel'):Action{return {type:'longCare',operation,agreementId:id};}
