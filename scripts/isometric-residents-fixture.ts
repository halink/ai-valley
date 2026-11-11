/** In-memory fixtures only, not a saved world or a model run. */
import {createWorld} from '../src/world/seed.js';
import {initializeHealth} from '../src/world/health.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeFerries} from '../src/world/ferry.js';
import {initializeCulture} from '../src/world/culture.js';
import {initializeFamilyRelocation} from '../src/world/family-relocation.js';
import {initializeRooms} from '../src/world/rooms.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {CultureEvent} from '../src/shared/culture.js';
import {roomLayout} from '../src/shared/rooms.js';
export function residentAction(w:World,r:Resident,action:Action){r.activity={action,planId:'synthetic-resident-plan',startedAt:w.minute,remaining:30,path:[],target:{...r.at},definition:'action/routine@1'};}
export function isometricResidentsFixture(){
 const world=createWorld(5401);world.mode='formal';for(const init of [initializeIndustry,initializeHealth,initializeFerries,initializeCulture,initializeFamilyRelocation,initializeRooms])init(world);world.id='synthetic-resident-states';world.minute=720;world.clock.paused=false;
 world.map={width:26,height:20,tiles:Array(520).fill('grass'),name:'Synthetic residents',entrance:{x:0,y:10}};
 const template=world.residents[0];world.residents=[];world.buildings=[];world.resources=[];world.plots=[];world.graves=[];
 world.health!.transports=[];world.health!.cases=[];world.ferries!.trips=[];world.familyRelocation!.agreements=[];world.culture!.events=[];
 const add=(name:string,x:number,y:number)=>{const r:Resident={...structuredClone(template),id:'resident-'+name,name,at:{x,y},inside:null,roomAt:null,regionalLocation:undefined,lifeStage:'adult',status:'alive',residency:'resident',activity:null,plan:null,body:undefined};world.residents.push(r);return r;};
 const idle=add('idle',2,3),walk=add('walk',6,3);residentAction(world,walk,{type:'wait',minutes:15});walk.activity!.path=[{x:7,y:3}];walk.activity!.travelProgress=.5;
 const worker=add('work',10,3);residentAction(world,worker,{type:'cook',quantity:1});
 const baby=add('infant',14,3);baby.lifeStage='infant';
 const ill=add('ill',18,3);world.health!.cases.push({id:'synthetic-case',personId:ill.id,kind:'illness',source:'synthetic',severity:70,stage:'critical',startedAt:0,lastAt:world.minute,resolvedAt:null,treatment:0,capacity:null});
 const rest=add('shore-rest',22,3);residentAction(world,rest,{type:'industry',operation:'shoreRest'});
 const culture=add('culture',2,8);residentAction(world,culture,{type:'culture',operation:'open',eventId:'synthetic-festival'});
 world.culture!.events.push({id:'synthetic-festival',definition:'culture/event@1',kind:'festival',name:'Synthetic festival',hostId:culture.id,subjectId:null,cohostId:null,cohostAccepted:false,buildingId:'absent-venue',at:{...culture.at},createdAt:0,start:600,end:900,capacity:3,knownBy:[],participants:[],status:'planned',openedAt:null,endedAt:null,reason:null,preparation:{required:{},held:{},supplierId:null,worked:0,minutes:1,completedAt:null,clearedAt:null},opening:[],contributions:[],taken:[]} satisfies CultureEvent);
 const hunt=add('hunt',6,8);residentAction(world,hunt,{type:'industry',operation:'hunt',at:{...hunt.at},beastId:'synthetic-beast',toolId:'synthetic-spear'});
 world.industry!.tools.push({id:'synthetic-spear',kind:'spear',ownerId:hunt.id,level:1,durability:10} as NonNullable<World['industry']>['tools'][number]);
 const body=add('body',10,8);body.status='dead';body.deathAt=710;
 const carrier=add('carrier',14,8),patient=add('patient',14,8);residentAction(world,carrier,{type:'health',operation:'rescue',phase:'delivery',transportId:'synthetic-transport',targetId:patient.id,buildingId:'synthetic-home'});
 carrier.activity!.path=[{x:15,y:8}];carrier.activity!.travelProgress=.25;
 world.health!.transports.push({id:'synthetic-transport',carrierId:carrier.id,patientId:patient.id,buildingId:'synthetic-home',bed:0,basis:'consent',offerId:null,phase:'carrying',startedAt:700,endedAt:null,reason:null});
 const bodyCarrier=add('body-carrier',18,8),carriedBody=add('carried-body',18,8);carriedBody.status='dead';carriedBody.body={reservedBy:bodyCarrier.id,carriedBy:bodyCarrier.id,storedAt:null};residentAction(world,bodyCarrier,{type:'bury',targetId:carriedBody.id});bodyCarrier.activity!.cargo={bodyId:carriedBody.id,graveId:'synthetic-grave',pickedUp:true};bodyCarrier.activity!.path=[{x:19,y:8}];bodyCarrier.activity!.travelProgress=.75;
 const sleepPlan=add('unverified-outdoor-sleep',22,8);residentAction(world,sleepPlan,{type:'sleep',minutes:120});sleepPlan.homeId=null;
 const sleeper=add('indoor-sleeper',3,14),home={id:'synthetic-home',kind:'home' as const,name:'Synthetic home',at:{x:2,y:13},width:3,height:2,door:{x:3,y:15},ownerId:sleeper.id,definition:'building/home@1',capacity:1,residents:[sleeper.id],condition:100};world.buildings.push(home);
 const layout=roomLayout(world,home),bed=layout.slots.find(s=>s.kind==='bed')!;sleeper.homeId=home.id;sleeper.inside=home.id;sleeper.roomAt={...bed.at};sleeper.at={...home.door};residentAction(world,sleeper,{type:'sleep',minutes:120});
 sleeper.activity!.room={buildingId:home.id,mode:'work',path:[],target:{...bed.at},progress:0};
 return {world,idle,walk,worker,baby,ill,rest,culture,hunt,body,carrier,patient,bodyCarrier,carriedBody,sleepPlan,sleeper,home,layout};
}
