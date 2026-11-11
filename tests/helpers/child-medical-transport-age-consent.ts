import assert from 'node:assert/strict';
import type {Action,Plan,Resident,Tile,World} from '../../src/shared/types.js';
import type {HealthAction} from '../../src/shared/health.js';
import {createWorld} from '../../src/world/seed.js';
import {initializeHealth,addHealthCase} from '../../src/world/health.js';
import {initializeFrontierHazards} from '../../src/world/frontier-hazards.js';
import {passenger} from '../../src/world/medical-transport.js';
import {decisionContext,decisionChoices} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import {YEAR} from '../../src/world/time.js';

export function childTransportFixture(accepted=true){
 const w=createWorld(824);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';w.resources=[];w.plots=[];w.graves=[];
 w.map={name:'六岁医疗护送同意隔离世界',width:32,height:18,tiles:Array<Tile>(576).fill('grass'),entrance:{x:1,y:8},settlement:{x:8,y:8}};
 const clinic={...w.buildings.find(b=>b.kind==='lodge')!,at:{x:18,y:5},width:4,height:3,door:{x:19,y:8},ownerId:'commons',condition:100,residents:[],capacity:4};w.buildings=[clinic];w.residents=w.residents.slice(0,3);
 const [helper,child,guardian]=w.residents,birthday=w.minute+80;
 for(const r of w.residents)Object.assign(r,{bornAt:w.minute-30*YEAR,lifeStage:'adult',status:'alive',residency:'resident',canDecide:true,canExpress:true,refusesCare:false,at:{x:10,y:8},inside:null,roomAt:null,homeId:null,health:100,energy:100,hunger:0,coins:100,inventory:{cloth:8,medicine:8,water:30,meal:30},knownBuildings:[clinic.id],knownPeople:w.residents.map(p=>p.id),guardianIds:[],plan:null,activity:null,lastFailure:null});
 helper.skills.care=guardian.skills.care=2;child.bornAt=birthday-6*YEAR;child.lifeStage='infant';child.guardianIds=[guardian.id];child.canDecide=child.canExpress=false;child.health=60;
 initializeHealth(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];addHealthCase(w,child,'injury',30,'隔离生日医疗护送伤情');
 runTransport(w,helper,selectTransport(w,helper,'rescueOffer',child.id));const offer=w.health!.transportOffers.at(-1)!;
 if(accepted)runTransport(w,guardian,selectTransport(w,guardian,'acceptRescue'));
 return {w,helper,child,guardian,clinic,offer,birthday};
}
export const transportMenu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
export function selectTransport(w:World,r:Resident,operation:HealthAction['operation'],targetId?:string){const choices=transportMenu(w,r),row=choices.find(c=>c.action.type==='health'&&c.action.operation===operation&&(!targetId||c.action.targetId===targetId));assert.ok(row,`${operation} must appear through final numbered menu`);return parseChoice(JSON.stringify({choice:row.id}),choices).actions[0] as HealthAction;}
let serial=0;
export const transportPlan=(w:World,r:Resident,a:Action):Plan=>({id:'child-medical:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择具体护送或独立拒绝',actions:[a]});
export function queueTransport(w:World,r:Resident,a:Action){const p=transportPlan(w,r,a),result=submitPlan(w,p);assert.equal(result.ok,true,result.error);return p;}
export function finishTransport(w:World,r:Resident){let guard=1000;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,.25);}}
export function runTransport(w:World,r:Resident,a:Action){const p=queueTransport(w,r,a);finishTransport(w,r);assert.equal(r.lastFailure,null);return p;}
export function pickUpChild(f:ReturnType<typeof childTransportFixture>){queueTransport(f.w,f.helper,selectTransport(f.w,f.helper,'rescue',f.child.id));let guard=300;while(!passenger(f.w,f.child.id)&&(f.helper.plan||f.helper.activity)){assert.ok(guard--);stepWorld(f.w,.25);}assert.ok(passenger(f.w,f.child.id),f.helper.lastFailure??'no pickup');return passenger(f.w,f.child.id)!;}
