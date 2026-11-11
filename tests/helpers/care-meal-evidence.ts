import assert from 'node:assert/strict';
import {createWorld} from '../../src/world/seed.js';
import type {Action,Plan,Resident,Tile,World} from '../../src/shared/types.js';
import {decisionContext,decisionChoices} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import type {CareMealReceipt} from '../../src/world/food-consumption-evidence.js';
import {YEAR} from '../../src/world/time.js';

export function careFixture(){
 const w=createWorld(414);w.mode='formal';w.clock.paused=false;
 w.map={name:'Offline ordinary care evidence',width:24,height:18,tiles:Array<Tile>(432).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents)Object.assign(r,{at:{x:11,y:8},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,status:'alive',residency:'resident',health:100,energy:100,hunger:0,canDecide:true,canExpress:true,refusesCare:false,inventory:{water:9,meal:10},skills:{farming:1,building:1,care:2},knownBuildings:[],knownResources:[],guardianIds:[],plan:null,activity:null,lastFailure:null,decisionDue:w.minute});
 const [provider,beneficiary,other]=w.residents;beneficiary.hunger=80;other.at={x:1,y:16};
 for(const r of w.residents)r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);
 stepWorld(w,1);return {w,provider,beneficiary,other};
}
let serial=0;
export const carePlan=(w:World,r:Resident,actions:Action[]):Plan=>({id:'care-evidence:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Offline physical care evidence',actions});
export function careChoice(w:World,r:Resident,predicate:(a:Action)=>boolean){
 const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>predicate(c.action));assert.ok(choice,'actual final menu has the action');
 return parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0];
}
export function queueCareAction(w:World,r:Resident,action:Action){const plan=carePlan(w,r,[action]);assert.equal(submitPlan(w,plan).ok,true);return plan;}
export function finishCareAction(w:World,r:Resident){
 const receipts:CareMealReceipt[]=[];let left=1000;
 while(r.plan||r.activity){assert.ok(left-->0);receipts.push(...stepWorldWithFoodEvidence(w,.25).careMeals!);}
 return receipts;
}
export function acceptedCare(f:ReturnType<typeof careFixture>,provider=f.provider){
 const {w,beneficiary}=f;
 queueCareAction(w,provider,careChoice(w,provider,a=>a.type==='propose'&&a.proposal==='care'&&a.targetId===beneficiary.id));
 assert.deepEqual(finishCareAction(w,provider),[]);
 const proposal=w.proposals.at(-1)!;
 queueCareAction(w,beneficiary,careChoice(w,beneficiary,a=>a.type==='respond'&&a.proposalId===proposal.id&&a.accept));
 assert.deepEqual(finishCareAction(w,beneficiary),[]);assert.equal(proposal.status,'accepted');return proposal;
}
export function queueOrdinaryCare(f:ReturnType<typeof careFixture>,provider=f.provider){
 return queueCareAction(f.w,provider,careChoice(f.w,provider,a=>a.type==='care'&&a.targetId===f.beneficiary.id));
}
export function originalCareLots(f:ReturnType<typeof careFixture>){
 const {w,provider}=f;
 for(const [version,value]of [[90,10],[91,30]] as const)w.definitions['food/life@'+version]={...w.definitions['food/life@1'],version,data:{...w.definitions['food/life@1'].data,nutrition:{meal:value}}};
 w.food!.lots['person:'+provider.id].meal=[{quantity:.25,producedAt:w.minute-20,expiresAt:w.minute+500,definition:'food/life@90'},
  {quantity:9.75,producedAt:w.minute-10,expiresAt:w.minute+1000,definition:'food/life@91'}];
}
