import assert from 'node:assert/strict';
import type {Action,Resident,Tile,World} from '../../src/shared/types.js';
import type {HealthAction} from '../../src/shared/health.js';
import type {FrontierDisaster} from '../../src/shared/frontier-hazards.js';
import type {ProductionAction} from '../../src/shared/production.js';
import {createWorld} from '../../src/world/seed.js';
import {initializeHealth} from '../../src/world/health.js';
import {initializeFrontierHazards} from '../../src/world/frontier-hazards.js';
import {floodFootprint} from '../../src/world/weather-hazards.js';
import {initializeForeignTrade} from '../../src/world/foreign-trade.js';
import {initializeRooms} from '../../src/world/rooms.js';
import {initializeProduction} from '../../src/world/production.js';
import {initializeIndustry} from '../../src/world/industry.js';
import {initializeEconomy} from '../../src/world/economy.js';
import {initializeFood} from '../../src/world/food.js';
import {recordDeath} from '../../src/world/life.js';
import {decisionContext,decisionChoices} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorld,submitPlan} from '../../src/world/engine.js';
import {YEAR,DAY} from '../../src/world/time.js';

export const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
export function choose(w:World,r:Resident,predicate:(a:Action)=>boolean){const choices=menu(w,r),row=choices.find(c=>predicate(c.action));assert.ok(row,'actual final numbered menu contains the requested action');return parseChoice(JSON.stringify({choice:row.id}),choices).actions[0];}
let serial=0;
export function queue(w:World,r:Resident,action:Action){const plan={id:`residual-age:${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Offline age authority check through actual menu and engine',actions:[action]};const result=submitPlan(w,plan);assert.equal(result.ok,true,result.error);return plan;}
export function finish(w:World,r:Resident,success=true){let remaining=1200;while(r.plan||r.activity){assert.ok(remaining-->0,'bounded actual action');stepWorld(w,.25);}if(success)assert.equal(r.lastFailure,null);}
export function run(w:World,r:Resident,predicate:(a:Action)=>boolean){const plan=queue(w,r,choose(w,r,predicate));finish(w,r);return plan;}
export const operation=(type:string,op:string)=>(a:Action)=>a.type===type&&'operation' in a&&a.operation===op;
export const guardianRescue=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&!!a.evacuationDangerId&&a.evacuationAuthority!=='incapacitated-adult';
export function damage(w:World,r:Resident,value:unknown){r.bornAt=(value==='future'?w.minute+10*YEAR:value) as number;}
export const invalidDates=[['null',null],['missing',undefined],['NaN',NaN],['Infinity',Infinity],['string','bad'],['future','future'],['unsafe',Number.MAX_SAFE_INTEGER+1]] as const;

export function evacuationFixture(){
 const w=createWorld(71);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';
 w.map={name:'健康幼儿有限灾害护送隔离验收',width:24,height:16,tiles:Array<Tile>(384).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 for(let y=0;y<w.map.height;y++)w.map.tiles[y*w.map.width+12]='water';
 const b={...w.buildings.find(b=>b.kind==='lodge')!,at:{x:4,y:4},width:4,height:4,door:{x:5,y:8},capacity:1,condition:100,ownerId:'commons',residents:[]};
 w.buildings=[b];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);w.residents.push({...structuredClone(w.residents[1]),id:'second-child',name:'另一位幼儿'});
 for(const r of w.residents){r.at={x:11,y:8};r.inside=null;r.roomAt=null;r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:3,medicine:2,meal:10};r.knownBuildings=[b.id];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;}
 const [guardian,child,other,secondChild]=w.residents;child.bornAt=w.minute-2*YEAR;child.guardianIds=[guardian.id];child.canDecide=child.canExpress=false;secondChild.at=other.at={x:1,y:14};
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d:FrontierDisaster={id:'observed-bank-flood',kind:'flashFlood',at:{x:12,y:8},radius:7,phase:'active',warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:floodFootprint(w,{x:12,y:8})};w.frontierHazards!.disasters=[d];
 return {w,guardian,child,other,secondChild,b,d};
}

export function helpFixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);
 const [reporter,child,other]=w.residents;
 for(const r of w.residents)Object.assign(r,{at:{x:20,y:10},inside:null,roomAt:null,homeId:null,inventory:{},parents:[],adoptiveParents:[],guardianIds:[],relations:[],bornAt:w.minute-30*YEAR,hunger:25,energy:100,health:100,canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,knownBuildings:[],knownResources:[],knownPeople:[],memories:[]});
 child.bornAt=w.minute-2*YEAR;child.canDecide=child.canExpress=false;child.hunger=70;other.at={x:35,y:15};
 initializeForeignTrade(w);w.foreignTrade!.knownStationIds.push(reporter.id,other.id,child.id);
 initializeRooms(w);initializeEconomy(w);initializeFood(w);stepWorld(w,.001);
 return {w,reporter,child,other};
}

export function custodyFixture(w=createWorld()){w.mode='formal';w.clock.paused=false;w.resources=[];
 const [dead,child,provider]=w.residents;
 const reviewer=w.residents[3]??{...structuredClone(provider),id:'reviewer',name:'独立复核人',homeId:null},buyer=w.residents[4]??{...structuredClone(provider),id:'buyer',name:'购买人',homeId:null};if(!w.residents.includes(reviewer))w.residents.push(reviewer,buyer);
 const home=w.buildings.find(b=>b.id===dead.homeId)!;
 for(const r of w.residents){r.at={...home.door};r.inside=null;r.roomAt=null;r.inventory={water:8,fodder:8,wood:8,stone:8,meal:5};r.coins=40;r.hunger=20;r.energy=r.health=100;r.bornAt=w.minute-30*YEAR;r.knownPeople=w.residents.map(p=>p.id);r.knownBuildings=w.buildings.map(b=>b.id);r.parents=[];r.adoptiveParents=[];r.guardianIds=[];r.relations=[];r.canDecide=r.canExpress=true;}
 child.bornAt=w.minute-10*YEAR;child.parents=[dead.id];child.homeId=home.id;home.residents.push(child.id);home.condition=70;
 w.plots=[{id:'protected-field',at:{x:27,y:27},ownerId:dead.id,crop:{definition:'crop/turnip@2',planted:w.minute-5*DAY,growth:4,wateredDay:-1,lastGrowthDay:Math.floor(w.minute/DAY)}}];
 initializeEconomy(w);initializeForeignTrade(w);initializeProduction(w);initializeIndustry(w);initializeRooms(w);initializeFood(w);recordDeath(w,dead);
 return {w,dead,child,provider,reviewer,buyer,home,plot:w.plots[0]};
}

export function offerCustody(f:ReturnType<typeof custodyFixture>){
 const {w,provider,reviewer}=f;
 run(w,provider,a=>operation('production','custodyOffer')(a)&&(a as ProductionAction).reviewerId===reviewer.id);
 return w.production!.protectedCustody!.mandates[0];
}
export function activateCustody(f:ReturnType<typeof custodyFixture>){
 const {w,child,provider,reviewer}=f;const c=offerCustody(f);
 if(child.bornAt<=w.minute-6*YEAR)run(w,child,operation('production','custodyAccept'));
 for(const id of c.guardianIds)run(w,w.residents.find(r=>r.id===id)!,operation('production','custodyAccept'));
 run(w,reviewer,operation('production','custodyReview'));assert.equal(c.status,'active');return c;
}
