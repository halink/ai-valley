import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {LandApplication,LandRightsAction} from '../src/shared/land-rights.js';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {initializeLandRights,advanceLandRights,landRightsReason,landRightsTarget,completeLandRights,landRightsOpportunities,landSiteError} from '../src/world/land-rights.js';
import {initializeConstruction,constructionReason,completeConstruction,advanceConstruction} from '../src/world/construction.js';
import {constructionLand} from '../src/world/construction-sites.js';
import {initializeProduction,productionParcels} from '../src/world/production.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {totalCoins} from '../src/world/economy.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';

import {walkable} from '../src/world/navigation.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:48,height:40,tiles:Array(48*40).fill('grass'),entrance:{x:1,y:1}};w.resources=[];w.plots=[];w.graves=[];
 const [owner,voter,other]=w.residents;
 const source=w.buildings.find(b=>b.ownerId===owner.id)!;
 const hall={...source,id:'land-board',name:'公示会馆',kind:'lodge' as const,at:{x:30,y:5},width:8,height:6,door:{x:34,y:11},ownerId:'commons',definition:'building/lodge@1',residents:[]};w.buildings=[hall];
 w.definitions['land/start@1'].data.parcels=[];
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={x:8,y:24};r.inside=null;r.roomAt=null;r.homeId=null;r.residency='resident';r.canDecide=r.canExpress=true;r.coins=200;r.inventory={wood:60,stone:60,meal:40,water:40};r.health=r.energy=100;r.hunger=0;r.knownBuildings=[hall.id];r.plan=null;r.activity=null;}
 initializeProduction(w);initializeConstruction(w);initializeLandRights(w);initializeForeignTrade(w);
 return {w,owner,voter,other,hall};
}
function act(w:World,r:Resident,a:LandRightsAction){const t=landRightsTarget(w,r,a);assert.equal(t.error,undefined);r.at={...t.target};r.inside=null;assert.equal(completeLandRights(w,r,a),null);return w.landRights!.applications.at(-1)!;}
function survey(f:ReturnType<typeof fixture>,days=2){return act(f.w,f.owner,{type:'landRights',operation:'survey',purpose:'home',at:{x:6,y:18},days});}
function post(f:ReturnType<typeof fixture>,p:LandApplication){f.owner.at={...f.hall.door};act(f.w,f.owner,{type:'landRights',operation:'post',applicationId:p.id});}
function approve(f:ReturnType<typeof fixture>,p:LandApplication){post(f,p);f.w.minute=p.noticeUntil!;advanceLandRights(f.w);for(const r of f.w.residents){r.at={...f.hall.door};act(f.w,r,{type:'landRights',operation:'vote',applicationId:p.id,accept:true});if(p.status==='approved')break;}assert.equal(p.status,'approved');}
function grant(f:ReturnType<typeof fixture>){const p=survey(f);approve(f,p);act(f.w,f.owner,{type:'landRights',operation:'register',applicationId:p.id});return p;}
function choose(w:World,r:Resident,predicate:(a:Action)=>boolean,extra:Record<string,unknown>={}){const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>predicate(c.action));assert.ok(choice,menu.map(c=>c.id).join(','));return parseChoice(JSON.stringify({choice:choice.id,...extra}),menu).actions[0];}
function run(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:'land-test:'+w.revision,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择勘察与用地',actions:[a]});assert.equal(result.ok,true,JSON.stringify(result));let guard=300;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}

test('normal final menu and physical actions reach a finite right then genuine construction without gifts',()=>{
 const f=fixture(),{w,owner,hall}=f,coins=totalCoins(w),inventory=structuredClone(owner.inventory),parcels=productionParcels(w);
 run(w,owner,choose(w,owner,a=>a.type==='landRights'&&a.operation==='survey'&&a.purpose==='home',{x:6,y:18,days:2}));const p=w.landRights!.applications[0];
 assert.equal(p.status,'surveyed');assert.equal(constructionLand(w,p.at),false);assert.deepEqual(productionParcels(w),parcels);
 owner.at={...hall.door};run(w,owner,choose(w,owner,a=>a.type==='landRights'&&a.operation==='post'));
 assert.equal(p.status,'notice');assert.equal(landRightsOpportunities(w,owner).some(c=>c.action.type==='landRights'&&c.action.operation==='vote'),false);
 w.minute=p.noticeUntil!;advanceLandRights(w);
 for(const r of w.residents){r.at={...hall.door};const menu=decisionChoices(decisionContext(w,r));assert.ok(menu.some(c=>c.action.type==='landRights'&&c.action.operation==='vote'&&c.action.accept===false));assert.ok(menu.some(c=>c.action.type==='landRights'&&c.action.operation==='object'));run(w,r,choose(w,r,a=>a.type==='landRights'&&a.operation==='vote'&&a.accept===true));if(p.status==='approved')break;}
 owner.at={...hall.door};run(w,owner,choose(w,owner,a=>a.type==='landRights'&&a.operation==='register'));
 assert.equal(p.status,'registered');assert.equal(p.expiresAt,p.registeredAt!+2*DAY);assert.equal(walkable(w,p.at),true);assert.equal(constructionLand(w,p.at),true);assert.equal(totalCoins(w),coins);assert.equal(owner.inventory.wood,inventory.wood);assert.equal(owner.inventory.stone,inventory.stone);
 const a=choose(w,owner,a=>a.type==='construction'&&a.operation==='propose'&&a.kind==='home');run(w,owner,a);assert.equal(w.construction!.projects[0].landRightId,p.id);assert.equal(w.construction!.projects[0].reserved,true);assert.equal(walkable(w,p.at),false);assert.equal(w.buildings.length,1);

});

test('public notice is at least a game day, distinct voters cannot be forged or replayed, and survey has no reservation',()=>{
 const f=fixture(),p=survey(f);post(f,p);const {w,owner}=f;
 assert.equal(p.noticeUntil!-p.postedAt!,DAY);w.minute=p.noticeUntil!-.1;advanceLandRights(w);
 assert.match(landRightsReason(w,owner,{type:'landRights',operation:'vote',applicationId:p.id,accept:true})!,/未满/);
 w.minute=p.noticeUntil!;advanceLandRights(w);act(w,owner,{type:'landRights',operation:'vote',applicationId:p.id,accept:true});
 assert.equal(Object.keys(p.votes).length,1);assert.notEqual(p.status,'approved');assert.ok(completeLandRights(w,owner,{type:'landRights',operation:'vote',applicationId:p.id,accept:true}));
 const menu=decisionChoices(decisionContext(w,f.voter));const vote=menu.find(c=>c.action.type==='landRights'&&c.action.operation==='vote');if(vote)assert.throws(()=>parseChoice(JSON.stringify({choice:vote.id,accept:true,ownerId:owner.id}),menu));
 assert.equal(constructionLand(w,p.at),false);
});

test('minor or visitor objection stops even approved unregistered grants; not overridden by majority',()=>{
 for(const afterVote of [false,true]){const f=fixture(),p=survey(f);if(afterVote)approve(f,p);else post(f,p);const child=f.other;child.bornAt=f.w.minute-9*YEAR;child.residency='visitor';child.at={...f.hall.door};
 act(f.w,child,{type:'landRights',operation:'object',applicationId:p.id});assert.equal(p.status,'objected');assert.equal(p.objections.length,1);assert.ok(landRightsReason(f.w,f.owner,{type:'landRights',operation:'register',applicationId:p.id}));f.w.minute+=DAY;advanceLandRights(f.w);assert.equal(p.status,'objected');assert.equal(constructionLand(f.w,p.at),false);}
});

test('too few electors, remote board, altered site and duplicate grants cannot allocate commons',()=>{
 const f=fixture(),p=survey(f);f.owner.at={x:2,y:2};assert.match(landRightsReason(f.w,f.owner,{type:'landRights',operation:'post',applicationId:p.id})!,/公告板/);
 f.owner.at={...f.hall.door};for(const r of f.w.residents.slice(2))r.residency='visitor';assert.match(landRightsReason(f.w,f.owner,{type:'landRights',operation:'post',applicationId:p.id})!,/三位/);
 for(const r of f.w.residents)r.residency='resident';approve(f,p);f.w.plots.push({id:'later-crop',ownerId:f.voter.id,at:{...p.at},crop:null});f.owner.at={...p.door};assert.match(completeLandRights(f.w,f.owner,{type:'landRights',operation:'register',applicationId:p.id})!,/农田/);assert.equal(p.registeredAt,null);
 f.w.plots=[];act(f.w,f.owner,{type:'landRights',operation:'register',applicationId:p.id});assert.ok(completeLandRights(f.w,f.owner,{type:'landRights',operation:'register',applicationId:p.id}));f.voter.at={...p.door};assert.match(landRightsReason(f.w,f.voter,{type:'landRights',operation:'survey',purpose:'home',at:p.at,days:3})!,/重复/);
});

test('roads, springs, existing homes, private title and reserved construction are never expropriated',()=>{
 const mutations:Array<(f:ReturnType<typeof fixture>,p:LandApplication)=>void>=[
 (f,p)=>{f.w.map.tiles[p.at.y*f.w.map.width+p.at.x]='path';},
 (f,p)=>{f.w.resources.push({id:'water',kind:'spring',at:p.at,amount:0,max:10,regrowthDays:1,lastHarvest:0});},
 (f,p)=>{f.w.buildings.push({...f.hall,id:'occupied-home',at:p.at,door:p.door,ownerId:f.voter.id,residents:[f.voter.id]});},
 (f,p)=>{f.w.definitions['land/start@1'].data.parcels=[{...p.at,width:2,height:2,ownerId:f.voter.id}];},
 (f,p)=>{f.w.construction!.projects.push({...p,id:'other-project',mode:'new',reserved:true,claims:[]} as never);}
 ];
 for(const mutate of mutations){const f=fixture(),p=survey(f);mutate(f,p);assert.ok(landSiteError(f.w,p,true));assert.equal(p.status,'surveyed');}
});

test('a grass bottleneck preserving current water and resident access cannot be granted',()=>{
 const f=fixture(),p=survey(f);const {w}=f;for(let y=0;y<w.map.height;y++)if(y<p.at.y||y>=p.at.y+p.height)w.map.tiles[y*w.map.width+8]='water';w.map.entrance={x:1,y:20};
 assert.match(landSiteError(w,p,true)!,/通路/);
});

test('expiry releases unbuilt plans and funds without enabling stale work, but protects actual materials and wages',()=>{
 for(const supplied of [false,true]){const f=fixture(),p=grant(f),{w,owner}=f;owner.at={...p.door};const a={type:'construction',operation:'propose',kind:'home',at:p.at,scope:'private',wagePerHour:6,prices:{wood:2,stone:2}} as const;assert.equal(completeConstruction(w,owner,a),null);const site=w.construction!.projects[0],coins=totalCoins(w);
 assert.equal(completeConstruction(w,owner,{type:'construction',operation:'fund',projectId:site.id,amount:50}),null);
 if(supplied)assert.equal(completeConstruction(w,owner,{type:'construction',operation:'donateMaterials',projectId:site.id,item:'wood',quantity:4}),null);
 w.minute=p.expiresAt!;advanceLandRights(w);advanceConstruction(w);assert.equal(totalCoins(w),coins);assert.equal(owner.coins,200);assert.equal(p.status,supplied?'review':'expired');assert.equal(site.status,supplied?'paused':'cancelled');assert.ok(constructionReason(w,owner,{type:'construction',operation:'work',projectId:site.id,minutes:5}));assert.ok(constructionReason(w,owner,{type:'construction',operation:'resume',projectId:site.id}));assert.equal(site.stock.reduce((n,l)=>n+l.quantity,0),supplied?4:0);
 }
});

test('completed home and resident remain on expiry; permanent yard cannot revive expired rights',()=>{
 const f=fixture(),p=grant(f),{w,owner}=f;const b={...f.hall,id:'finite-house',ownerId:owner.id,kind:'home' as const,at:{...p.at},width:p.width,height:p.height,door:{...p.door},residents:[f.voter.id],definition:p.definition};w.buildings.push(b);f.voter.homeId=b.id;w.construction!.yards[b.id]={...b.at,width:b.width,height:b.height};
 const before=structuredClone(b);w.minute=p.expiresAt!;advanceLandRights(w);assert.equal(p.status,'review');assert.deepEqual(b,before);assert.equal(f.voter.homeId,b.id);owner.at={...p.door};assert.match(constructionReason(w,owner,{type:'construction',operation:'expand',buildingId:b.id,direction:'north',wagePerHour:6,prices:{wood:2,stone:2}})!,/到期/);
});

test('SQLite working reload preserves notice deadlines, votes, expiry and event evidence without duplicate rights',()=>{
 const f=fixture(),p=survey(f);post(f,p);const store=new WorldStore(':memory:');store.commit(f.w,null);const saved=store.load()!;store.close();const s=saved.landRights!.applications[0];assert.equal(s.noticeUntil,p.noticeUntil);assert.equal(s.postedAt,p.postedAt);assert.deepEqual(s.eventIds,p.eventIds);saved.minute=s.noticeUntil!;advanceLandRights(saved);assert.equal(s.status,'voting');assert.equal(saved.landRights!.applications.length,1);assert.equal(s.registeredAt,null);
 const old=fixture().w;delete old.landRights;const before={minute:old.minute,residents:structuredClone(old.residents),parcels:productionParcels(old),coins:totalCoins(old)};initializeLandRights(old);assert.deepEqual(old.landRights!.applications,[]);assert.equal(old.minute,before.minute);assert.deepEqual(old.residents,before.residents);assert.deepEqual(productionParcels(old),before.parcels);assert.equal(totalCoins(old),before.coins);
});

test('a formal nine-person world exposes an actual local survey choice without mutating startup assets',()=>{
 const w=createFormalWorld(),owner=w.residents[0];w.clock.paused=false;stepWorld(w,0);initializeForeignTrade(w);owner.at={x:320,y:160};owner.inside=null;owner.roomAt=null;owner.health=owner.energy=100;owner.hunger=0;owner.knownBuildings=w.buildings.filter(b=>b.ownerId==='commons').map(b=>b.id);
 let a:Action|undefined;for(let y=150;y<300&&!a;y+=8)for(let x=240;x<400&&!a;x+=8){owner.at={x,y};a=landRightsOpportunities(w,owner).find(c=>c.action.type==='landRights'&&c.action.operation==='survey')?.action;}
 assert.ok(a);const coins=totalCoins(w),people=w.residents.length,plots=w.plots.length;run(w,owner,a);assert.equal(w.landRights!.applications.length,1);assert.equal(w.landRights!.applications[0].registeredAt,null);assert.equal(w.residents.length,people);assert.equal(w.plots.length,plots);assert.equal(totalCoins(w),coins);
});

test('real paid work pauses at expiry, retains earned wages through reload, and physical cleanup releases the preserved site',()=>{
 const f=fixture(),p=grant(f),{w,owner,voter}=f;owner.at={...p.door};assert.equal(completeConstruction(w,owner,{type:'construction',operation:'propose',kind:'home',at:p.at,scope:'private',wagePerHour:6,prices:{wood:2,stone:2}}),null);const site=w.construction!.projects[0];
 for(const item of ['wood','stone'] as const)assert.equal(completeConstruction(w,owner,{type:'construction',operation:'donateMaterials',projectId:site.id,item,quantity:site.stages.reduce((n,s)=>n+(s.materials[item]??0),0)}),null);
 assert.equal(completeConstruction(w,owner,{type:'construction',operation:'fund',projectId:site.id,amount:60}),null);voter.at={...site.door};assert.equal(completeConstruction(w,voter,{type:'construction',operation:'apply',projectId:site.id}),null);assert.equal(completeConstruction(w,owner,{type:'construction',operation:'hire',projectId:site.id,applicantId:voter.id}),null);assert.equal(completeConstruction(w,voter,{type:'construction',operation:'accept',projectId:site.id}),null);
 run(w,voter,{type:'construction',operation:'work',projectId:site.id,minutes:20,stage:0});assert.equal(site.workers[0].paid,2);assert.equal(voter.coins,202);const money=totalCoins(w),incorporated=structuredClone(site.incorporated),progress=site.stages[0].worked;
 w.minute=p.expiresAt!;advanceLandRights(w);advanceConstruction(w);assert.equal(p.status,'review');assert.equal(site.status,'paused');assert.equal(site.workers[0].status,'released');assert.equal(site.workers[0].paid,2);assert.equal(site.workers[0].refunded,34);assert.equal(totalCoins(w),money);assert.deepEqual(site.incorporated,incorporated);assert.equal(site.stages[0].worked,progress);
 const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;store.close();const sp=saved.landRights!.applications[0],ss=saved.construction!.projects[0],so=saved.residents.find(r=>r.id===owner.id)!;advanceLandRights(saved);advanceConstruction(saved);assert.equal(totalCoins(saved),money);assert.equal(ss.workers[0].paid,2);
 so.at={...ss.door};assert.equal(completeConstruction(saved,so,{type:'construction',operation:'cancel',projectId:ss.id}),null);assert.equal(ss.status,'abandoned');assert.equal(completeConstruction(saved,so,{type:'construction',operation:'collect',projectId:ss.id}),null);
 so.health=so.energy=100;run(saved,so,{type:'construction',operation:'dismantle',projectId:ss.id,minutes:120});assert.equal(ss.status,'removed');assert.equal(sp.status,'review');assert.equal(completeConstruction(saved,so,{type:'construction',operation:'collect',projectId:ss.id}),null);advanceLandRights(saved);assert.equal(sp.status,'expired');assert.equal(constructionLand(saved,sp.at),false);assert.equal(totalCoins(saved),money);
});

test('in-flight registration survives SQLite restart but new occupancy at arrival prevents any right',()=>{
 for(const blocked of [false,true]){const f=fixture(),p=survey(f);approve(f,p);const {w,owner}=f;owner.at={...f.hall.door};const a=choose(w,owner,a=>a.type==='landRights'&&a.operation==='register');assert.equal(submitPlan(w,{id:'register-restart',actorId:owner.id,actorRevision:owner.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'亲自登记原议决',actions:[a]}).ok,true);stepWorld(w,1);assert.ok(owner.activity?.path.length);
 const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;store.close();const r=saved.residents.find(r=>r.id===owner.id)!,s=saved.landRights!.applications[0];if(blocked)saved.plots.push({id:'new-occupied-field',at:{...s.at},ownerId:f.voter.id,crop:null});let guard=300;while(r.plan||r.activity){assert.ok(guard--);stepWorld(saved,1);}assert.equal(s.status,blocked?'approved':'registered');assert.equal(s.registeredAt!==null,!blocked);assert.equal(saved.landRights!.applications.length,1);if(blocked)assert.match(r.lastFailure!,/农田/);else assert.equal(r.lastFailure,null);
 }
});

test('a four-elector quorum passed only at the voting deadline has a durable one-day registration window',()=>{
 const f=fixture();f.w.residents.push({...structuredClone(f.other),id:'fourth-voter',name:'第四位选民'});const p=survey(f);post(f,p);f.w.minute=p.noticeUntil!;advanceLandRights(f.w);
 for(const r of [f.owner,f.voter]){r.at={...f.hall.door};act(f.w,r,{type:'landRights',operation:'vote',applicationId:p.id,accept:true});}assert.equal(p.status,'voting');f.w.minute=p.closesAt!;advanceLandRights(f.w);assert.equal(p.status,'approved');assert.equal(p.registerBefore,p.closesAt!+DAY);
 const saved=structuredClone(f.w);saved.minute=p.closesAt!+20;const r=saved.residents.find(r=>r.id===f.owner.id)!;r.at={...p.door};assert.equal(completeLandRights(saved,r,{type:'landRights',operation:'register',applicationId:p.id}),null);assert.equal(saved.landRights!.applications[0].status,'registered');
 f.w.minute=p.registerBefore!;advanceLandRights(f.w);assert.equal(p.status,'expired');
});

test('an otherwise empty private parcel behind a grass bottleneck retains access',()=>{
 const f=fixture(),p=survey(f),{w}=f;w.map.entrance={x:1,y:30};f.hall.at={x:30,y:28};f.hall.door={x:34,y:34};for(const r of w.residents)r.at={x:9,y:30};w.construction!.yards={};w.definitions['land/start@1'].data.parcels=[{x:20,y:10,width:2,height:2,ownerId:f.voter.id}];for(let x=0;x<w.map.width;x++)if(x<6||x>11)w.map.tiles[20*w.map.width+x]='cliff';assert.match(landSiteError(w,p,true)!,/私人地块/);
});

test('distant land changes do not remove board choices, and unseen objections do not unlock new surveys',()=>{
 const f=fixture(),p=survey(f),{w,owner,other,hall}=f;owner.at={...hall.door};const ids=()=>landRightsOpportunities(w,owner).map(c=>c.id);const before=ids();w.plots.push({id:'distant-change',ownerId:other.id,at:p.at,crop:null});assert.deepEqual(ids(),before);post(f,p);w.plots=[];
 owner.at={...p.door};other.at={...hall.door};const remote=ids();act(w,other,{type:'landRights',operation:'object',applicationId:p.id});assert.deepEqual(ids(),remote);assert.notEqual(p.knownStatus?.[owner.id],'objected');owner.at={...hall.door};act(w,owner,{type:'landRights',operation:'read',applicationId:p.id});assert.equal(p.knownStatus?.[owner.id],'objected');owner.at={...p.door};assert.ok(landRightsOpportunities(w,owner).some(c=>c.action.type==='landRights'&&c.action.operation==='survey'));
});

test('automatic public tally remains at the board and cannot be witnessed at the distant land',()=>{
 const f=fixture(),p=survey(f);post(f,p);f.owner.at={...p.door};f.w.minute=p.noticeUntil!;advanceLandRights(f.w);const e=f.w.events.at(-1)!;assert.deepEqual(e.place,f.hall.door);assert.equal(e.witnesses.includes(f.owner.id),false);assert.equal(p.knownStatus?.[f.owner.id],'notice');
});

test('unburied remains and separate original estate stores retain their physical ground and approach',()=>{
 const f=fixture(),p=survey(f);f.other.status='dead';f.other.at={x:p.at.x+2,y:p.at.y+2};assert.match(landSiteError(f.w,p,true)!,/遗体/);f.other.at={x:2,y:2};f.w.estates.push({personId:f.other.id,inventory:{wood:10},coins:0,heirs:[],status:'protected',location:{at:{...p.at},inside:null,roomAt:null}} as never);assert.match(landSiteError(f.w,p,true)!,/封存/);
});

test('unknown distant board damage and distant deaths do not rewrite location or post menus',()=>{
 const f=fixture(),{w,owner,hall}=f;const initial=landRightsOpportunities(w,owner).map(c=>c.id);hall.condition=0;assert.deepEqual(landRightsOpportunities(w,owner).map(c=>c.id),initial);hall.condition=100;const p=survey(f);const travel=landRightsOpportunities(w,owner).map(c=>c.id);hall.condition=0;assert.deepEqual(landRightsOpportunities(w,owner).map(c=>c.id),travel);hall.condition=100;
 owner.at={...hall.door};const posted=landRightsOpportunities(w,owner).map(c=>c.id);f.other.status='dead';f.other.at={x:47,y:39};assert.deepEqual(landRightsOpportunities(w,owner).map(c=>c.id),posted);assert.match(completeLandRights(w,owner,{type:'landRights',operation:'post',applicationId:p.id})!,/三位/);
});

test('independently stored tools and cancelled-project material claims keep their ground',()=>{
 const f=fixture(),p=survey(f);f.w.industry={tools:[{id:'estate-tool',ownerId:f.other.id,kind:'axe',level:1,durability:10,maxDurability:10,location:{at:{...p.at},inside:null,roomAt:null}}]} as unknown as NonNullable<World['industry']>;assert.match(landSiteError(f.w,p,true)!,/封存/);f.w.industry!.tools=[];
 f.w.construction!.projects.push({id:'cancelled',at:{x:35,y:25},width:3,height:3,door:{...p.at},reserved:false,status:'cancelled',claims:[{source:'resident:'+f.other.id,item:'wood',quantity:4}]} as never);assert.match(landSiteError(f.w,p,true)!,/封存/);
});

test('a nearer private clinic is never selected as a public board and a ruined original board cannot trap an expired applicant',()=>{
 const f=fixture(),{w,owner,hall}=f;const clinic={...hall,id:'private-clinic',kind:'clinic' as const,ownerId:f.voter.id,at:{x:1,y:27},door:{x:5,y:32}};w.buildings.push(clinic);owner.knownBuildings.push(clinic.id);const p=survey(f);assert.equal(p.boardId,hall.id);hall.condition=0;w.minute=p.surveyedAt+7*DAY;advanceLandRights(w);assert.equal(p.status,'expired');owner.at={...p.boardDoor};const a=choose(w,owner,a=>a.type==='landRights'&&a.operation==='withdraw');run(w,owner,a);assert.equal(p.status,'cancelled');owner.at={x:8,y:24};assert.ok(landRightsOpportunities(w,owner).some(c=>c.action.type==='landRights'&&c.action.operation==='survey'));
});
