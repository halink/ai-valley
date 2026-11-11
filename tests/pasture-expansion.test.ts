import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {LandApplication,LandRightsAction} from '../src/shared/land-rights.js';
import type {IndustryAction,Livestock} from '../src/shared/industry.js';
import {createWorld} from '../src/world/seed.js';
import {initializeProduction} from '../src/world/production.js';
import {initializeConstruction} from '../src/world/construction.js';
import {initializeIndustry,industryTarget,completeIndustry,barnCapacity,industryAssets,inheritIndustry} from '../src/world/industry.js';
import {initializeLandRights,landRightsTarget,completeLandRights,advanceLandRights,landSiteError,landRightsOpportunities} from '../src/world/land-rights.js';
import {pastureTarget,pastureAdmissionError,advancePastureProjects} from '../src/world/pasture-projects.js';
import {advancePastures,pastureContains} from '../src/world/pasture.js';
import {findPath,walkable,same} from '../src/world/navigation.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:48,height:40,tiles:Array(48*40).fill('grass'),entrance:{x:1,y:1}};w.resources=[];w.plots=[];w.graves=[];
 const [owner,other]=w.residents,source=w.buildings.find(b=>b.ownerId===owner.id)!;
 const hall={...source,id:'pasture-board',name:'牧场公告板',kind:'lodge' as const,at:{x:30,y:4},width:8,height:6,door:{x:34,y:10},ownerId:'commons',definition:'building/lodge@1',residents:[]};
 const barn={...source,id:'test-barn',name:'本人的畜舍',kind:'barn' as const,at:{x:4,y:4},width:6,height:4,door:{x:7,y:8},ownerId:owner.id,definition:'building/barn@1',residents:[]};
 w.buildings=[hall,barn];w.definitions['land/start@1'].data.parcels=[];
 const spring={id:'test-spring',kind:'spring' as const,at:{x:15,y:12},amount:30,max:30,regrowthDays:1,lastHarvest:0};w.resources=[spring as World['resources'][number]];
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={x:10,y:18};r.inside=null;r.roomAt=null;r.homeId=null;r.residency='resident';r.canDecide=r.canExpress=true;r.coins=200;r.inventory={wood:60,stone:60,meal:40,water:40};r.health=r.energy=100;r.hunger=0;r.knownBuildings=[hall.id,barn.id];r.knownResources=[spring.id];r.plan=null;r.activity=null;}
 initializeProduction(w);initializeConstruction(w);initializeLandRights(w);initializeIndustry(w);
 return {w,owner,other,hall,barn,spring};
}
function act(w:World,r:Resident,a:LandRightsAction){const t=landRightsTarget(w,r,a);assert.equal(t.error,undefined);r.at={...t.target};r.inside=null;assert.equal(completeLandRights(w,r,a),null);return w.landRights!.applications.at(-1)!;}
function grant(f:ReturnType<typeof fixture>,at={x:12,y:18},pastureId?:string){
 const {w,owner,hall,barn}=f;owner.at={x:at.x,y:at.y+4};
 const p=act(w,owner,{type:'landRights',operation:'survey',purpose:'pasture',barnId:barn.id,pastureId,at,days:14});
 owner.at={...hall.door};act(w,owner,{type:'landRights',operation:'post',applicationId:p.id});w.minute=p.noticeUntil!;advanceLandRights(w);
 for(const r of w.residents){r.at={...hall.door};act(w,r,{type:'landRights',operation:'vote',applicationId:p.id,accept:true});if(p.status==='approved')break;}
 act(w,owner,{type:'landRights',operation:'register',applicationId:p.id});return p;
}
function run(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:'pasture-test:'+w.revision,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定牧场行动',actions:[a]});assert.equal(result.ok,true,JSON.stringify(result));let guard=600;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function build(f:ReturnType<typeof fixture>,right:LandApplication){
 const {w,owner}=f;const menu=decisionChoices(decisionContext(w,owner)),plan=menu.find(c=>c.action.type==='industry'&&c.action.operation==='planPasture'&&c.action.landRightId===right.id);assert.ok(plan,'planning must reach the normal model menu');run(w,owner,parseChoice(JSON.stringify({choice:plan.id}),menu).actions[0]);const p=w.industry!.pastureProjects!.at(-1)!;
 for(let i=0;i<10&&p.status==='building';i++){const choices=decisionChoices(decisionContext(w,owner)),work=choices.find(c=>c.action.type==='industry'&&c.action.operation==='workPasture'&&c.action.projectId===p.id);assert.ok(work,'each actual construction stage must reach the normal model menu');run(w,owner,parseChoice(JSON.stringify({choice:work.id}),choices).actions[0]);}
 assert.equal(p.status,'completed');return w.industry!.pastures!.at(-1)!;
}
function animal(f:ReturnType<typeof fixture>,p:NonNullable<World['industry']>['pastures'] extends (infer T)[]|undefined?T:never,id='test-goat'){
 const n:Livestock={id,ownerId:f.owner.id,kind:'goat' as const,sex:'female' as const,bornAt:f.w.minute-50*DAY,barnId:f.barn.id,pastureId:p.id,at:{...p.tiles[0]},inside:null,hunger:30,thirst:80,health:100,status:'alive' as const,deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:f.w.minute,energy:85};f.w.industry!.animals.push(n);return n;
}

test('normal menu survey, notice, vote, registration and actual staged work deliver an empty finite fenced paddock',()=>{
 const f=fixture(),{w,owner,barn}=f;
 const menu=decisionChoices(decisionContext(w,owner)),choice=menu.find(c=>c.action.type==='landRights'&&c.action.purpose==='pasture');assert.ok(choice);
 const edited=parseChoice(JSON.stringify({choice:choice.id,x:12,y:18,days:14}),menu).actions[0];assert.equal(edited.type,'landRights');
 const right=grant(f),wood=owner.inventory.wood!,stone=owner.inventory.stone!,water=owner.inventory.water!,capacity=barnCapacity(barn),start=w.minute;
 const p=build(f,right);assert.ok(w.minute>=start+145);assert.equal(owner.inventory.wood,wood-16);assert.equal(owner.inventory.stone,stone-4);assert.equal(owner.inventory.water,water);
 assert.equal(p.forage,0);assert.equal(p.trough!.water,0);assert.equal(p.trough!.delivered,0);assert.equal(p.capacity,48);assert.equal(barnCapacity(barn),capacity);assert.equal(p.expiresAt,right.expiresAt);
 assert.equal(walkable(w,p.tiles[0],{x:p.tiles[0].x-1,y:p.tiles[0].y}),false);assert.equal(walkable(w,p.gate!.inside,p.gate!.outside),true);
 const route=findPath(w,barn.door,p.tiles[0]);assert.ok(route?.some(t=>same(t,p.gate!.inside)),'animal route must enter through the actual gate');
 assert.ok(pastureContains(w,p.tiles[0]));assert.ok(w.residents.every(r=>r.activity===null&&r.plan===null));
});

test('no notice bypass, no material creation, and physical work survives interruption without double payment',()=>{
 const f=fixture(),{w,owner,barn}=f;owner.at={x:12,y:22};const right=act(w,owner,{type:'landRights',operation:'survey',purpose:'pasture',barnId:barn.id,at:{x:12,y:18},days:14});
 assert.match(pastureTarget(w,owner,{type:'industry',operation:'planPasture',landRightId:right.id}).error!,/登记/);
 owner.at={...f.hall.door};act(w,owner,{type:'landRights',operation:'withdraw',applicationId:right.id});
 const good=grant(f);run(w,owner,{type:'industry',operation:'planPasture',landRightId:good.id});const project=w.industry!.pastureProjects![0];run(w,owner,{type:'industry',operation:'workPasture',projectId:project.id,stage:0,minutes:30});
 const action:IndustryAction={type:'industry',operation:'workPasture',projectId:project.id,stage:1,minutes:30};owner.inventory.wood=0;assert.match(industryTarget(w,owner,action).error!,/材料/);assert.equal(project.stages[1].worked,0);
 owner.inventory.wood=20;const submitted=submitPlan(w,{id:'interrupted',actorId:owner.id,actorRevision:owner.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人施工',actions:[action]});assert.equal(submitted.ok,true);stepWorld(w,10);assert.equal(project.stages[1].worked,10);assert.equal(owner.inventory.wood,6);
 owner.activity=null;owner.plan=null;run(w,owner,{...action,minutes:30});assert.equal(project.stages[1].worked,40);assert.equal(owner.inventory.wood,6);assert.equal(project.stage,1);
 run(w,owner,{...action,minutes:30});assert.equal(project.stage,2);assert.equal(owner.inventory.wood,6);
});

test('only delivered water is drunk, blocked routes and an empty trough cannot supply animals',()=>{
 const f=fixture(),p=build(f,grant(f)),n=animal(f,p),water=f.owner.inventory.water!;
 n.at={...p.trough!.at};f.owner.at={...p.gate!.outside};const thirst=n.thirst;run(f.w,f.owner,{type:'industry',operation:'fillTrough',pastureId:p.id});assert.equal(f.owner.inventory.water,water-1);assert.equal(p.trough!.delivered,1);
 f.w.minute+=10;advancePastures(f.w);assert.ok(n.thirst<thirst);assert.ok(p.trough!.water<1);assert.ok(Math.abs(p.trough!.water+p.trough!.consumed-p.trough!.delivered)<1e-9);
 p.trough!.water=0;const empty=n.thirst;f.w.minute+=10;advancePastures(f.w);assert.equal(n.thirst,empty);
 p.trough!.water=1;p.trough!.delivered++;n.at={...p.tiles[0]};n.thirst=80;
 for(let x=p.tiles[0].x;x<p.tiles[0].x+4;x++)f.w.map.tiles[(p.tiles[0].y+1)*f.w.map.width+x]='cliff';
 f.w.minute+=15;advancePastures(f.w);assert.equal(n.thirst,80);assert.equal(p.trough!.water,1);
});

test('expiry retains animals and assets but stops new admission, and empty fields can rotate then retire',()=>{
 const f=fixture(),right=grant(f),p=build(f,right),n=animal(f,p);
 assert.match(pastureTarget(f.w,f.owner,{type:'industry',operation:'restPasture',pastureId:p.id}).error!,/离开|迁出/);
 f.w.minute=right.expiresAt!;advanceLandRights(f.w);advancePastureProjects(f.w);assert.equal(right.status,'review');assert.equal(p.status,'expired');assert.ok(pastureAdmissionError(f.w,p));assert.equal(n.pastureId,p.id);assert.ok(findPath(f.w,n.at!,f.barn.door));
 n.status='dead';f.owner.at={...p.gate!.outside};run(f.w,f.owner,{type:'industry',operation:'retirePasture',pastureId:p.id});assert.equal(p.status,'retired');assert.equal(pastureContains(f.w,p.tiles[0]),false);advanceLandRights(f.w);assert.equal(right.status,'expired');
});

test('expansion is a distinct adjacent paddock with separate water and terms; a disconnected or foreign proposal fails',()=>{
 const f=fixture(),p=build(f,grant(f));const second=grant(f,{x:16,y:18},p.id),q=build(f,second);
 assert.equal(q.parentId,p.id);assert.notEqual(q.landRightId,p.landRightId);assert.equal(p.tiles.length,12);assert.equal(q.tiles.length,12);assert.equal(q.trough!.water,0);
 f.owner.at={x:22,y:20};const invalid:LandRightsAction={type:'landRights',operation:'survey',purpose:'pasture',barnId:f.barn.id,pastureId:p.id,at:{x:24,y:18},days:14};assert.match(landRightsTarget(f.w,f.owner,invalid).error!,/相连/);
 const stolen={...second,id:'fake',applicantId:f.other.id};assert.match(landSiteError(f.w,stolen)!,/使用权|本人/);
 f.owner.at={...q.gate!.outside};run(f.w,f.owner,{type:'industry',operation:'restPasture',pastureId:q.id});assert.equal(q.status,'resting');assert.ok(pastureAdmissionError(f.w,q));run(f.w,f.owner,{type:'industry',operation:'openPasture',pastureId:q.id});assert.equal(q.status,'open');
});

test('late routes, retained property and old snapshots never silently create facilities',()=>{
 const f=fixture();f.owner.knownBuildings=[f.hall.id];assert.ok(landRightsTarget(f.w,f.owner,{type:'landRights',operation:'survey',purpose:'pasture',barnId:f.barn.id,at:{x:12,y:18},days:14}).error,'a hidden barn cannot be used by forging its ID');f.owner.knownBuildings.push(f.barn.id);const right=grant(f);const inventory=structuredClone(f.owner.inventory);
 f.w.map.tiles[right.door.y*f.w.map.width+right.door.x]='cliff';assert.ok(pastureTarget(f.w,f.owner,{type:'industry',operation:'planPasture',landRightId:right.id}).error);assert.deepEqual(f.owner.inventory,inventory);
 f.w.map.tiles[right.door.y*f.w.map.width+right.door.x]='grass';
 f.w.industry!.pastures=[{id:'old',barnId:f.barn.id,tiles:[{x:20,y:25}],capacity:4,forage:3,lastMinute:f.w.minute}];initializeIndustry(f.w);assert.equal(f.w.industry!.pastures[0].trough,undefined);assert.equal(f.w.industry!.pastures[0].fenced,undefined);
 f.w.estates.push({personId:f.other.id,inventory:{wood:5},location:{at:right.at,inside:null,roomAt:null}} as never);assert.match(landSiteError(f.w,right,true)!,/封存/);
});

test('the model can choose and physically escort the same animal through a built gate, then deliver water',()=>{
 const f=fixture(),p=build(f,grant(f)),n=animal(f,p);delete n.pastureId;delete n.at;n.inside=f.barn.id;f.owner.at={...f.barn.door};f.owner.inside=null;
 const choices=decisionChoices(decisionContext(f.w,f.owner)),move=choices.find(c=>c.action.type==='industry'&&c.action.operation==='moveAnimal'&&c.action.pastureId===p.id&&c.action.animalId===n.id);assert.ok(move);
 run(f.w,f.owner,parseChoice(JSON.stringify({choice:move.id}),choices).actions[0]);assert.equal(n.pastureId,p.id);assert.equal(n.carrierId,null);assert.ok(n.at&&p.tiles.some(t=>same(t,n.at!)));
 const drinking=decisionChoices(decisionContext(f.w,f.owner)),fill=drinking.find(c=>c.action.type==='industry'&&c.action.operation==='fillTrough'&&c.action.pastureId===p.id);assert.ok(fill);
 const water=f.owner.inventory.water!;run(f.w,f.owner,fill.action);assert.equal(f.owner.inventory.water,water-1);assert.equal(p.trough!.delivered,1);
 run(f.w,f.owner,{type:'industry',operation:'moveAnimal',animalId:n.id,buildingId:f.barn.id});assert.equal(n.pastureId,undefined);assert.equal(n.at,undefined);assert.equal(f.owner.inside,f.barn.id);
});

test('in-flight fence construction reloads, expires without material reset, and real cleanup preserves recovery',()=>{
 const f=fixture(),right=grant(f),{w,owner}=f;run(w,owner,{type:'industry',operation:'planPasture',landRightId:right.id});const p=w.industry!.pastureProjects![0];run(w,owner,{type:'industry',operation:'workPasture',projectId:p.id,stage:0,minutes:30});
 const action:IndustryAction={type:'industry',operation:'workPasture',projectId:p.id,stage:1,minutes:30};run(w,owner,action);assert.equal(p.stages[1].worked,30);assert.equal(p.incorporated.wood,14);
 const restored=JSON.parse(JSON.stringify(w)) as World,r=restored.residents.find(r=>r.id===owner.id)!,q=restored.industry!.pastureProjects![0],stock=r.inventory.wood!;
 run(restored,r,action);assert.equal(q.fenceBuilt,true);assert.equal(q.stage,2);assert.equal(r.inventory.wood,stock);
 restored.minute=q.expiresAt;advancePastureProjects(restored);assert.equal(q.status,'expired');assert.match(industryTarget(restored,r,{type:'industry',operation:'workPasture',projectId:q.id,stage:2,minutes:30}).error!,/停止/);
 run(restored,r,{type:'industry',operation:'clearPasture',projectId:q.id});assert.equal(q.status,'removed');assert.equal(q.fenceBuilt,false);assert.equal(r.inventory.wood,stock+7);assert.equal(pastureContains(restored,q.at),false);
});

test('expired empty troughs can be physically drained and retired without reclaiming spent water',()=>{
 const f=fixture(),right=grant(f),p=build(f,right);p.trough!.water=.25;p.trough!.delivered=1;p.trough!.consumed=.75;
 f.w.minute=right.expiresAt!;advanceLandRights(f.w);advancePastureProjects(f.w);f.owner.at={...p.gate!.outside};
 assert.match(pastureTarget(f.w,f.owner,{type:'industry',operation:'retirePasture',pastureId:p.id}).error!,/排空/);assert.match(pastureTarget(f.w,f.owner,{type:'industry',operation:'fillTrough',pastureId:p.id}).error!,/空场/);
 const water=f.owner.inventory.water!;run(f.w,f.owner,{type:'industry',operation:'drainTrough',pastureId:p.id});assert.equal(p.trough!.water,0);assert.equal(p.trough!.drained,.25);assert.equal(f.owner.inventory.water,water);
 run(f.w,f.owner,{type:'industry',operation:'retirePasture',pastureId:p.id});advanceLandRights(f.w);assert.equal(p.status,'retired');assert.equal(right.status,'expired');assert.equal(p.trough!.consumed+(p.trough!.drained??0),p.trough!.delivered);
});

test('estate asset succession permits physical cleanup, but never transfers an expired grazing right',()=>{
 const f=fixture(),right=grant(f),p=build(f,right);f.owner.status='dead';advanceLandRights(f.w);advancePastureProjects(f.w);assert.equal(right.status,'review');assert.equal(p.status,'expired');
 const ids=industryAssets(f.w,f.owner.id);assert.ok(ids.includes(p.id));assert.ok(!ids.includes(f.w.industry!.pastureProjects![0].id),'completed project history is not a separate inherited asset');inheritIndustry(f.w,f.owner.id,f.other.id,ids);assert.equal(p.ownerId,f.other.id);assert.equal(right.applicantId,f.owner.id);assert.ok(pastureAdmissionError(f.w,p));
 f.other.at={...p.gate!.outside};run(f.w,f.other,{type:'industry',operation:'retirePasture',pastureId:p.id});advanceLandRights(f.w);assert.equal(right.status,'expired');
});


test('a returned visiting owner may clean retained facilities but cannot revive new pasture construction',()=>{
 const f=fixture(),right=grant(f),p=build(f,right);f.owner.residency='visitor';advanceLandRights(f.w);advancePastureProjects(f.w);f.owner.at={...p.gate!.outside};assert.equal(p.status,'expired');
 assert.match(pastureTarget(f.w,f.owner,{type:'industry',operation:'planPasture',landRightId:right.id}).error!,/常住/);
 run(f.w,f.owner,{type:'industry',operation:'retirePasture',pastureId:p.id});advanceLandRights(f.w);assert.equal(p.status,'retired');assert.equal(right.status,'expired');
});
