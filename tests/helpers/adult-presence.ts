import assert from 'node:assert/strict';
import type {Action,Resident,Tile,World} from '../../src/shared/types.js';
import {createWorld} from '../../src/world/seed.js';
import {initializeHealth} from '../../src/world/health.js';
import {initializeFrontierHazards} from '../../src/world/frontier-hazards.js';
import {initializeRooms} from '../../src/world/rooms.js';
import {decisionContext,decisionChoices} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import {WorldStore} from '../../src/server/store.js';
import {YEAR} from '../../src/world/time.js';
export function presenceFixture(){
 const w=createWorld(271);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';
 w.map={name:'非侵入式在场隔离世界',width:24,height:18,tiles:Array<Tile>(432).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents){Object.assign(r,{at:{x:11,y:8},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,status:'alive',residency:'resident',health:100,energy:100,hunger:0,canDecide:true,canExpress:true,refusesCare:false,inventory:{water:9,cloth:3,medicine:2,meal:10},knownBuildings:[],knownResources:[],guardianIds:[],plan:null,activity:null,lastFailure:null});}
 const [actor,patient,remote]=w.residents;patient.name='待接续成人';patient.canDecide=patient.canExpress=false;patient.hunger=80;remote.at={x:1,y:16};
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 w.frontierHazards!.disasters=[{id:'presence-flood',kind:'flashFlood',at:{...patient.at},radius:2,phase:'active',warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:[{...patient.at}]}];
 return {w,actor,patient,remote};
}
export function submitPresence(w:World,r:Resident,a:Action){return submitPlan(w,{id:`presence-test:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自主选择真实在场',actions:[a]});}
export function runPresence(w:World,r:Resident,a:Action){const result=submitPresence(w,r,a);assert.equal(result.ok,true,result.error);let budget=1500;while(r.activity||r.plan){assert.ok(budget-->0);stepWorld(w,.25);}assert.equal(r.lastFailure,null);}
export function presenceMenu(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
export function choosePresence(w:World,r:Resident,operation:'verify'|'stay'|'stop'){
 const menu=presenceMenu(w,r),choice=menu.find(c=>c.action.type==='adultPresence'&&c.action.operation===operation);assert.ok(choice,`missing ${operation}`);return parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];
}
export function evacuatePresence(f:ReturnType<typeof presenceFixture>){const menu=presenceMenu(f.w,f.actor),choice=menu.find(c=>c.action.type==='health'&&c.action.operation==='rescue'&&c.action.evacuationAuthority==='incapacitated-adult');assert.ok(choice);runPresence(f.w,f.actor,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);const t=f.w.health!.transports[0];assert.equal(t.phase,'delivered');assert.ok(t.arrivalEventId);return t;}
export function verifyPresence(f:ReturnType<typeof presenceFixture>){evacuatePresence(f);runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));return f.w.adultPresence!.records[0];}
export function reloadPresence(f:ReturnType<typeof presenceFixture>){const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!;return {w,actor:w.residents.find(r=>r.id===f.actor.id)!,patient:w.residents.find(r=>r.id===f.patient.id)!,remote:w.residents.find(r=>r.id===f.remote.id)!};}finally{store.close();}}
