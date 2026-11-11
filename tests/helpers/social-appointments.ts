import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../../src/shared/types.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {createWorld} from '../../src/world/seed.js';
import {decisionContext,prepareModelDecision} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {GLM_MODEL} from '../../src/server/model-completion.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import {YEAR} from '../../src/world/time.js';
let serial=0;
export const menu=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
export const rows=(w:World,r:Resident)=>menu(w,r).choices.filter(c=>c.action.type==='socialAppointment');
export function select(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){const p=menu(w,r),c=p.choices.find(c=>predicate(c.action));assert.ok(c,'required final numbered choice');assert.match(c.id,/^\d+$/);assert.ok(p.messages[0].content.includes(c.id+'. '+c.label));return parseChoice(JSON.stringify({choice:c.id,...fields}),p.choices);}
export function choice(w:World,r:Resident,operation:string,fields:Record<string,unknown>={}){return select(w,r,a=>a.type==='socialAppointment'&&a.operation===operation,fields);}
export function queue(w:World,r:Resident,d:ReturnType<typeof parseChoice>){return submitPlan(w,{id:'appointment-test:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d});}
export function finish(w:World,r:Resident){let budget=400;while(r.activity||r.plan){assert.ok(budget--,'bounded action completion');stepWorld(w,1);}}
export function run(w:World,r:Resident,d:ReturnType<typeof parseChoice>){assert.equal(queue(w,r,d).ok,true);finish(w,r);assert.equal(r.lastFailure,null);}
export const record=(w:World)=>w.socialAppointments!.records.at(-1)!;
export function seed(){const w=createFrontierWorld(5401);w.clock.paused=false;stepWorld(w,1);return {w,r:w.residents[0],peer:w.residents[1]};}
export function fixture(){const w=createWorld(5401);w.mode='formal';w.clock.paused=false;w.minute=600;w.map={...w.map,width:40,height:30,tiles:Array(1200).fill('grass'),entrance:{x:0,y:0}};w.buildings=w.buildings.filter(b=>b.kind==='lodge');Object.assign(w.buildings[0],{at:{x:25,y:15},door:{x:25,y:14},width:3,height:3});w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);for(const r of w.residents)Object.assign(r,{at:{x:10,y:14},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:0,inventory:{berry:6,water:3},knownBuildings:[w.buildings[0].id],knownResources:[],activity:null,plan:null,relations:[],memories:[],canDecide:true,canExpress:true,status:'alive',residency:'resident'});w.residents[2].at={x:35,y:25};return {w,r:w.residents[0],peer:w.residents[1],third:w.residents[2]};}
export function offered(f:ReturnType<typeof fixture>|ReturnType<typeof seed>,startsIn=60,windowMinutes=90){run(f.w,f.r,choice(f.w,f.r,'offer',{startsIn,windowMinutes}));return record(f.w);}
export function accepted(f:ReturnType<typeof fixture>|ReturnType<typeof seed>,startsIn=60,windowMinutes=90){const c=offered(f,startsIn,windowMinutes);const peer=f.w.residents.find(r=>r.id===c.personId)!;run(f.w,peer,choice(f.w,peer,'accept'));return c;}
