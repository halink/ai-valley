import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {parseChoice,type ActionChoice} from '../../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {WorldStore} from '../../src/server/store.js';
import type {IndustryAction,Livestock} from '../../src/shared/industry.js';
import type {Action,Resident,World} from '../../src/shared/types.js';
import {initializeConstruction} from '../../src/world/construction.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import type {FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
import {initializeFood} from '../../src/world/food.js';
import {initializeIndustry} from '../../src/world/industry.js';
import {initializeLandRights} from '../../src/world/land-rights.js';
import {initializeProduction} from '../../src/world/production.js';
import {createWorld} from '../../src/world/seed.js';
import {DAY,YEAR} from '../../src/world/time.js';

export interface PastureSelection {
 actorId:string;purpose:string;choiceId:string|null;action:Action;selectedAt:number;completedAt:number|null;
}

/** A small synthetic world, not the formal nine founders or a model-driven run.
 * Only the fixture supplies land, a barn, materials and adult animals. The right,
 * completed pasture, trough water and milk must be created by production rules.
 */
export class PastureFoodChain {
 world:World;
 readonly ownerId='lin';
 readonly barnId='synthetic-food-barn';
 readonly boardId='synthetic-food-board';
 readonly goatId='synthetic-existing-goat';
 readonly newcomerId='synthetic-newcomer-goat';
 readonly selections:PastureSelection[]=[];
 readonly flows:FoodFlowReceipt[]=[];
 private savedRevision:number|null=null;
 private pastureId='';
 constructor(private readonly databasePath?:string){
  if(databasePath)assert.ok(databasePath!==':memory:'&&!existsSync(databasePath),'requires a fresh synthetic SQLite path');
  const w=this.world=createWorld(5401);w.mode='formal';w.clock.paused=false;w.minute=600;
  w.map={...w.map,width:48,height:40,tiles:Array(48*40).fill('grass'),entrance:{x:1,y:1}};
  w.resources=[{id:'synthetic-spring',kind:'spring',at:{x:15,y:12},amount:30,max:30,regrowthDays:1,lastHarvest:0}];
  w.plots=[];w.graves=[];w.definitions['land/start@1'].data.parcels=[];
  const source=w.buildings[0];
  w.buildings=[
   {...source,id:this.boardId,name:'合成公示板',kind:'lodge',at:{x:30,y:4},width:8,height:6,door:{x:34,y:10},ownerId:'commons',definition:'building/lodge@1',residents:[]},
   {...source,id:this.barnId,name:'合成畜舍',kind:'barn',at:{x:4,y:4},width:6,height:4,door:{x:7,y:8},ownerId:this.ownerId,definition:'building/barn@1',residents:[]},
  ];
  for(const r of w.residents){
   r.bornAt=w.minute-25*YEAR;r.at={x:10,y:18};r.inside=null;r.roomAt=null;r.homeId=null;
   r.residency='resident';r.canDecide=r.canExpress=true;r.coins=200;
   r.inventory={wood:60,stone:60,meal:40,water:40,fodder:4};r.health=r.energy=100;r.hunger=0;
   r.knownBuildings=[this.boardId,this.barnId];r.knownResources=['synthetic-spring'];r.plan=null;r.activity=null;
  }
  initializeProduction(w);initializeConstruction(w);initializeLandRights(w);initializeIndustry(w);initializeFood(w);
 }
 get owner(){return this.world.residents.find(r=>r.id===this.ownerId)!;}
 get barn(){return this.world.buildings.find(b=>b.id===this.barnId)!;}
 get board(){return this.world.buildings.find(b=>b.id===this.boardId)!;}
 get pasture(){const p=this.world.industry!.pastures!.find(p=>p.id===this.pastureId);assert.ok(p);return p;}
 get goat(){return this.world.industry!.animals.find(a=>a.id===this.goatId)!;}
 get newcomer(){return this.world.industry!.animals.find(a=>a.id===this.newcomerId)!;}
 menu(r=this.owner){return decisionChoices(decisionContext(this.world,r));}
 tick(minutes=1){
  const observation=stepWorldWithFoodEvidence(this.world,minutes);
  this.flows.push(...observation.foodFlows!);return observation;
 }
 finish(r=this.owner){
  let limit=800;
  while(r.plan||r.activity){assert.ok(limit-->0,'accepted action must finish');this.tick();}
  assert.equal(r.lastFailure,null);
  const pending=[...this.selections].reverse().find(s=>s.actorId===r.id&&s.completedAt===null);
  if(pending)pending.completedAt=this.world.minute;
 }
 private submit(r:Resident,action:Action,purpose:string,choiceId:string|null){
  assert.equal(r.plan,null);assert.equal(r.activity,null);
  this.selections.push({actorId:r.id,purpose,choiceId,action:structuredClone(action),selectedAt:this.world.minute,completedAt:null});
  const result=submitPlan(this.world,{id:'offline-pasture-food:'+this.selections.length,actorId:r.id,actorRevision:r.revision,
   createdAt:this.world.minute,definition:this.world.activeDefinitions['action/routine'],intention:'离线脚本选择：'+purpose,actions:[action]});
  assert.equal(result.ok,true,JSON.stringify(result));
 }
 /** Every domain action is selected and parsed from the actual final menu.
  * A wait can expose an ordinarily rotating option; no opportunity is injected.
  */
 select(predicate:(a:Action)=>boolean,purpose:string,r=this.owner,fields:Record<string,number>={},finish=true){
  for(let attempt=0;attempt<12;attempt++){
   const choices=this.menu(r),choice=choices.find(c=>predicate(c.action));
   if(choice){
    const decision=parseChoice(JSON.stringify({choice:choice.id,...fields}),choices);
    assert.equal(decision.actions.length,1);this.submit(r,decision.actions[0],purpose,choice.id);
    if(finish)this.finish(r);return choice;
   }
   const wait=choices.find(c=>c.action.type==='wait');assert.ok(wait,'ordinary wait choice');
   this.submit(r,parseChoice(JSON.stringify({choice:wait.id,minutes:30}),choices).actions[0],'wait for rotating menu',wait.id);this.finish(r);
  }
  assert.fail('No final numbered menu choice: '+purpose+'; '+JSON.stringify(this.menu(r).map(c=>c.action)));
 }
 industry(operation:IndustryAction['operation'],targetId:string,purpose=operation,finish=true){
  return this.select(a=>a.type==='industry'&&a.operation===operation&&(a.animalId===targetId||a.pastureId===targetId),purpose,this.owner,{},finish);
 }
 /** Navigational scaffolding is an explicit engine move, not teleportation. */
 walk(r:Resident,to:{x:number;y:number}){this.submit(r,{type:'move',to:{...to}},'walk to known site',null);this.finish(r);}
 build(){
  const w=this.world,opening=structuredClone(this.owner.inventory);
  assert.equal(w.landRights!.applications.length,0);assert.equal(w.industry!.pastures?.length??0,0);
  this.select(a=>a.type==='landRights'&&a.operation==='survey'&&a.purpose==='pasture','survey actual site',this.owner,{x:12,y:18,days:14});
  const right=w.landRights!.applications.at(-1)!;assert.equal(right.status,'surveyed');
  this.walk(this.owner,this.board.door);
  this.select(a=>a.type==='landRights'&&a.operation==='post'&&a.applicationId===right.id,'post full-day notice');
  assert.equal(right.noticeUntil!-right.postedAt!,DAY);
  this.tick(right.noticeUntil!-w.minute);assert.equal(right.status,'voting');
  for(const r of w.residents){
   if(right.status==='approved')break;
   this.walk(r,this.board.door);
   this.select(a=>a.type==='landRights'&&a.operation==='vote'&&a.applicationId===right.id&&a.accept===true,'scripted individual vote',r);
  }
  assert.equal(right.status,'approved');assert.equal(right.electorate.length,3);assert.equal(Object.keys(right.votes).length,2);
  this.select(a=>a.type==='landRights'&&a.operation==='register'&&a.applicationId===right.id,'register approved right');
  assert.equal(right.status,'registered');assert.ok(right.registeredAt!>=right.noticeUntil!);
  this.select(a=>a.type==='industry'&&a.operation==='planPasture'&&a.landRightId===right.id,'plan actual pasture');
  const project=w.industry!.pastureProjects!.at(-1)!;
  for(let i=0;i<8&&project.status==='building';i++)this.select(a=>a.type==='industry'&&a.operation==='workPasture'&&a.projectId===project.id,'work one construction stage');
  assert.equal(project.status,'completed');assert.deepEqual(project.stages.map(s=>[s.worked,s.paid]),[[30,true],[60,true],[45,true]]);
  assert.deepEqual(project.incorporated,{wood:16,stone:4});
  this.pastureId=w.industry!.pastures!.at(-1)!.id;
  const p=this.pasture;
  assert.equal(p.landRightId,right.id);assert.equal(p.forage,0);assert.equal(p.trough!.water,0);assert.equal(p.trough!.delivered,0);assert.equal(p.trough!.consumed,0);
  assert.equal(p.fence!.condition,100);assert.equal(this.owner.inventory.wood,opening.wood!-16);assert.equal(this.owner.inventory.stone,opening.stone!-4);
  assert.equal(this.owner.inventory.water,opening.water);assert.equal(this.owner.inventory.fodder,opening.fodder);
  assert.equal(w.industry!.animals.length,0);assert.equal(this.flows.length,0);
  return this;
 }
 seedAnimalsAndAdmit(){
  const w=this.world;
  // Synthetic adult identity and near-threshold progress, not a purchase/birth or
  // a simulated full lactation interval. High needs prevent production before care.
  const animal=(id:string,sex:'female'|'male',pen:number):Livestock=>({
   definition:'industry/processes@1',id,ownerId:this.ownerId,kind:'goat',sex,bornAt:w.minute-50*DAY,
   barnId:this.barnId,pen,hunger:80,thirst:90,health:100,status:'alive',deathAt:null,
   product:0,progress:DAY-120,pregnancy:null,lastMinute:w.minute,energy:85,
  });
  w.industry!.animals.push(animal(this.goatId,'female',0),animal(this.newcomerId,'male',1));
  this.walk(this.owner,this.barn.door);
  this.select(a=>a.type==='industry'&&a.operation==='moveAnimal'&&a.animalId===this.goatId&&a.pastureId===this.pasture.id,'escort same goat through real gate');
  assert.equal(this.goat.pastureId,this.pasture.id);assert.equal(this.goat.carrierId,null);assert.equal(this.goat.product,0);
  assert.ok(this.goat.at&&this.pasture.tiles.some(t=>t.x===this.goat.at!.x&&t.y===this.goat.at!.y));
  assert.equal(this.newcomer.pastureId,undefined);return this;
 }
 breakFence(){
  const p=this.pasture;
  // The test's sole durability override. The ordinary engine must cross zero.
  p.fence!.condition=.001;p.fence!.lastMinute=this.world.minute;
  assert.equal(p.fence!.condition,.001);this.tick();assert.equal(p.fence!.condition,0);
  assert.equal(p.fence!.repairs,0);assert.equal(p.fence!.woodUsed,0);return this;
 }
 reload(){
  assert.ok(this.databasePath,'SQLite persistence needs the test-owned fresh path');
  const before=JSON.parse(JSON.stringify(this.world)) as World;
  const store=new WorldStore(this.databasePath);
  try{store.commit(this.world,this.savedRevision);this.savedRevision=this.world.revision;}finally{store.close();}
  const reopened=new WorldStore(this.databasePath);
  try{this.world=reopened.load()!;assert.ok(this.world);assert.deepEqual(this.world,before);}finally{reopened.close();}
  return this;
 }
}

export function animalChoice(choices:ActionChoice[],operation:IndustryAction['operation'],animalId:string){
 return choices.find(c=>c.action.type==='industry'&&c.action.operation===operation&&c.action.animalId===animalId);
}
