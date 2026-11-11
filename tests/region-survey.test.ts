import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {RegionSurvey,RegionSurveyAction} from '../src/shared/region-survey.js';
import {createWorld} from '../src/world/seed.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeFood} from '../src/world/food.js';
import {initializeRegionSurveys,advanceRegionSurveys,regionSurveyReason,regionSurveyTarget,completeRegionSurvey,regionSurveyOpportunities} from '../src/world/region-survey.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {DAY,YEAR} from '../src/world/time.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {regionSurveyPanel} from '../src/client/region-survey.js';
import {productionParcels} from '../src/world/production.js';
import {constructionLand} from '../src/world/construction-sites.js';
import {totalCoins} from '../src/world/economy.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={width:32,height:32,tiles:Array(1024).fill('grass'),name:'试验谷',entrance:{x:2,y:2}};w.plots=[];w.graves=[];w.resources=[];
 const b={...w.buildings[0],id:'board',name:'公共会馆',ownerId:'commons',kind:'lodge' as const,at:{x:18,y:8},width:4,height:4,door:{x:20,y:12},residents:[]};w.buildings=[b];
 w.definitions['land/start@1'].data.parcels=[];
 for(const r of w.residents){r.at={x:28,y:16};r.inside=null;r.roomAt=null;r.status='alive';r.residency='resident';r.bornAt=w.minute-25*YEAR;r.health=r.energy=100;r.hunger=0;r.inventory={meal:10,water:20};r.canDecide=r.canExpress=true;r.knownBuildings=[b.id];r.knownResources=[];r.plan=r.activity=null;r.homeId=null;}
 initializeIndustry(w);initializeFood(w);initializeRegionSurveys(w);
 const r=w.residents[0];w.industry!.tools.push({id:'survey-axe',ownerId:r.id,kind:'axe',level:1,durability:10,maxDurability:10});return {w,r,b,axe:w.industry!.tools[0]};
}
function run(w:World,r:Resident,a:Action,expect=true){const p={id:`survey-plan:${w.revision}:${r.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定办理有限边界',actions:[a]};assert.equal(submitPlan(w,p).ok,true);let guard=200;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}if(expect)assert.equal(r.lastFailure,null);return p;}
function choose(w:World,r:Resident,operation:string,accept?:boolean){const all=decisionChoices(decisionContext(w,r));const c=all.find(c=>c.action.type==='regionSurvey'&&c.action.operation===operation&&(accept===undefined||c.action.operation==='vote'&&c.action.accept===accept));assert.ok(c,all.map(c=>c.label).join('\n'));return parseChoice(JSON.stringify({choice:c.id}),all).actions[0] as RegionSurveyAction;}
function survey(f:ReturnType<typeof fixture>){run(f.w,f.r,choose(f.w,f.r,'survey'));return f.w.regionSurveys!.surveys[0];}
function prepare(f:ReturnType<typeof fixture>){const s=survey(f);run(f.w,f.r,{type:'move',to:{...f.b.door}});run(f.w,f.r,choose(f.w,f.r,'post'));f.w.minute=s.noticeUntil!;advanceRegionSurveys(f.w);return s;}
function approve(f:ReturnType<typeof fixture>){const s=prepare(f);for(const r of f.w.residents){run(f.w,r,{type:'move',to:{...f.b.door}});run(f.w,r,choose(f.w,r,'vote',true));if(s.status==='approved')break;}assert.equal(s.status,'approved');run(f.w,f.r,choose(f.w,f.r,'read'));return s;}

function opening(f:ReturnType<typeof fixture>){const menu=decisionChoices(decisionContext(f.w,f.r)),s=f.w.regionSurveys!.surveys[0];const c=menu.find(c=>c.action.type==='move'&&c.action.to.x===s.at.x&&c.action.to.y===s.at.y&&c.label.includes('按本人已读'));assert.ok(c);run(f.w,f.r,parseChoice(JSON.stringify({choice:c.id}),menu).actions[0]);return choose(f.w,f.r,'open');}

test('normal menu, physical survey, public votes and return open empty geography without teleport or gifts',()=>{
 const f=fixture(),{w,r,axe}=f,oldMap=structuredClone(w.map),s=approve(f),money=totalCoins(w),stock=structuredClone(r.inventory),resources=structuredClone(w.resources),parcels=structuredClone(productionParcels(w));
 assert.equal(w.map.width,32);assert.equal(axe.durability,9);const before=w.minute;
 run(w,r,opening(f));
 assert.ok(w.minute>=before+15);assert.deepEqual(r.at,s.at);assert.equal(w.map.width,40);assert.equal(s.status,'opened');assert.equal(axe.durability,8);
 assert.deepEqual(r.inventory,stock);assert.equal(totalCoins(w),money);assert.deepEqual(w.resources,resources);assert.deepEqual(productionParcels(w),parcels);assert.equal(constructionLand(w,s.access),false);
 for(let y=0;y<32;y++)assert.deepEqual(w.map.tiles.slice(y*40,y*40+32),oldMap.tiles.slice(y*32,y*32+32));
 assert.equal(w.map.tiles[s.access.y*40+s.access.x],'grass');assert.equal(w.map.tiles[39],'cliff');assert.deepEqual(w.regions![0].sourceIds,[]);assert.deepEqual(w.regions![0].fishKeys,[]);
 assert.match(regionSurveyPanel(w),/已接入/);assert.match(regionSurveyPanel(w),/无新增资源/);
 run(w,r,{type:'move',to:s.access});assert.deepEqual(r.at,s.access);
});

test('survey does not open, reserve or invent supply; depleted, sealed and borrowed axes cannot qualify',()=>{
 const f=fixture(),a:RegionSurveyAction={type:'regionSurvey',operation:'survey',edge:'east',at:{x:31,y:16},toolId:f.axe.id};
 for(const kind of ['broken','sealed','other','food','water','expiry'] as const){const copy=structuredClone(f.w),r=copy.residents[0],axe=copy.industry!.tools[0];if(kind==='broken')axe.durability=0;if(kind==='sealed')axe.location={at:{x:3,y:3},inside:null,roomAt:null};if(kind==='other')axe.ownerId=copy.residents[1].id;if(kind==='food')r.inventory.meal=0;if(kind==='water')r.inventory.water=1;if(kind==='expiry')copy.food!.lots['person:'+r.id].meal!.forEach(l=>l.expiresAt=copy.minute+30);assert.ok(regionSurveyReason(copy,r,a),kind);assert.equal(copy.map.width,32);}
 survey(f);assert.equal(f.w.map.width,32);assert.equal(f.axe.durability,9);assert.deepEqual(f.w.regions,undefined);assert.equal(f.w.landRights?.applications.length??0,0);
});

test('stale survey targets, remote boundaries, minors and visitors cannot initiate',()=>{
 const f=fixture(),a:RegionSurveyAction={type:'regionSurvey',operation:'survey',edge:'east',at:{x:31,y:16},toolId:f.axe.id};
 for(const mode of ['remote','minor','visitor','inside','blocked'] as const){const w=structuredClone(f.w),r=w.residents[0];if(mode==='remote')r.at={x:1,y:1};if(mode==='minor')r.bornAt=w.minute-12*YEAR;if(mode==='visitor')r.residency='visitor';if(mode==='inside')r.inside='board';if(mode==='blocked')w.map.tiles[16*32+31]='water';assert.ok(regionSurveyTarget(w,r,a).error,mode);}
 const before=structuredClone(f.w);assert.ok(completeRegionSurvey(f.w,f.r,a));assert.deepEqual(f.w,before);
});

test('one vote, early vote, duplicate voter and too few current electors never authorize opening',()=>{
 const f=fixture(),s=survey(f);run(f.w,f.r,{type:'move',to:f.b.door});run(f.w,f.r,choose(f.w,f.r,'post'));
 assert.ok(regionSurveyReason(f.w,f.r,{type:'regionSurvey',operation:'vote',surveyId:s.id,accept:true}));f.w.minute=s.noticeUntil!;advanceRegionSurveys(f.w);
 run(f.w,f.r,choose(f.w,f.r,'vote',true));assert.equal(s.status,'voting');assert.ok(regionSurveyReason(f.w,f.r,{type:'regionSurvey',operation:'vote',surveyId:s.id,accept:true}));assert.ok(regionSurveyReason(f.w,f.r,{type:'regionSurvey',operation:'open',surveyId:s.id,toolId:f.axe.id}));
 const g=fixture(),t=approve(g);opening(g);for(const p of g.w.residents.slice(2))p.residency='visitor';assert.match(regionSurveyReason(g.w,g.r,{type:'regionSurvey',operation:'open',surveyId:t.id,toolId:g.axe.id})!,/三位/);
});

test('public menus keep refusal and child/visitor objection, which stops even an approved request',()=>{
 const f=fixture(),s=prepare(f),v=f.w.residents[1];run(f.w,v,{type:'move',to:f.b.door});choose(f.w,v,'vote',false);choose(f.w,v,'vote',true);
 for(const p of f.w.residents){p.at={...f.b.door};if(p!==v){run(f.w,p,choose(f.w,p,'vote',true));if(s.status==='approved')break;}}
 assert.equal(s.status,'approved');v.bornAt=f.w.minute-9*YEAR;v.residency='visitor';run(f.w,v,choose(f.w,v,'object'));assert.equal(s.status,'objected');assert.ok(!regionSurveyOpportunities(f.w,f.r).some(o=>o.action.type==='regionSurvey'&&o.action.operation==='open'));
});

test('reading is local and remembered approval must be learned before returning; no public record leaks unpublished surveys',()=>{
 const f=fixture(),s=survey(f),v=f.w.residents[1];v.at={...f.b.door};assert.equal(regionSurveyOpportunities(f.w,v).filter(c=>c.action.type==='regionSurvey').length,0);
 run(f.w,f.r,{type:'move',to:f.b.door});run(f.w,f.r,choose(f.w,f.r,'post'));f.w.minute=s.noticeUntil!;advanceRegionSurveys(f.w);f.r.at={x:31,y:16};
 for(const r of f.w.residents.slice(1)){r.at={...f.b.door};run(f.w,r,choose(f.w,r,'vote',true));if(s.status==='approved')break;}
 assert.equal(s.status,'approved');assert.notEqual(s.knownStatus[f.r.id],'approved');assert.match(regionSurveyReason(f.w,f.r,{type:'regionSurvey',operation:'open',surveyId:s.id,toolId:f.axe.id})!,/读到/);assert.ok(!regionSurveyOpportunities(f.w,f.r).some(c=>c.action.type==='regionSurvey'&&c.action.operation==='read'));
});

test('mid-work objection, changed terrain, missing supplies and death stop without committing geography',()=>{
 for(const mode of ['object','terrain','supply','tool','death','board'] as const){const f=fixture(),s=approve(f),a=opening(f);const p={id:'interrupted',actorId:f.r.id,actorRevision:f.r.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'本人去边界',actions:[a]};assert.ok(submitPlan(f.w,p).ok);stepWorld(f.w,1);
  if(mode==='object'){s.status='objected';s.objections.push(f.w.residents[1].id);}if(mode==='terrain')f.w.map.tiles[s.at.y*32+s.at.x]='water';if(mode==='supply')f.r.inventory.water=0;if(mode==='tool')f.axe.durability=0;if(mode==='death')f.r.health=0;if(mode==='board')f.b.ownerId=f.w.residents[1].id;
  for(let i=0;i<50&&(f.r.plan||f.r.activity);i++)stepWorld(f.w,1);
  assert.equal(f.w.map.width,32,mode);assert.notEqual(s.status,'opened',mode);assert.equal(f.axe.durability,mode==='tool'?0:9,mode);
 }
});

test('expiry and concurrent geometry preserve original grants and do not silently rebase approval',()=>{
 const f=fixture(),s=approve(f),a=opening(f);f.w.minute=s.expiresAt;advanceRegionSurveys(f.w);assert.equal(s.status,'expired');assert.ok(completeRegionSurvey(f.w,f.r,a));
 const g=fixture(),t=approve(g),b=opening(g);g.w.map.width=33;advanceRegionSurveys(g.w);assert.equal(t.status,'expired');assert.ok(completeRegionSurvey(g.w,g.r,b));assert.equal(g.w.regions,undefined);
});

test('restart retains work and votes, commits only once, and old worlds initialize empty without opening',()=>{
 const f=fixture(),s=approve(f),a=opening(f),p={id:'restart-open',actorId:f.r.id,actorRevision:f.r.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'本人返回边界',actions:[a]};assert.ok(submitPlan(f.w,p).ok);stepWorld(f.w,1);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load(true)!,r=w.residents[0];let guard=100;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}assert.equal(w.map.width,40);assert.equal(w.regionSurveys!.surveys[0].status,'opened');assert.deepEqual(submitPlan(w,p),{ok:true});assert.equal(r.plan,null);assert.ok(completeRegionSurvey(w,r,a));assert.equal(w.regions!.length,1);assert.equal(w.industry!.tools[0].durability,8);store.commit(w,f.w.revision);const loaded=store.load(true)!;assert.deepEqual(loaded.regionSurveys,w.regionSurveys);assert.equal(loaded.regions!.length,1);}finally{store.close();}
 const legacy=fixture().w;delete legacy.regionSurveys;const old=structuredClone(legacy.map),inventory=structuredClone(legacy.residents[0].inventory);initializeRegionSurveys(legacy);assert.deepEqual(legacy.regionSurveys,{nextSerial:1,surveys:[]});assert.deepEqual(legacy.map,old);assert.deepEqual(legacy.residents[0].inventory,inventory);
});

test('survey evidence survives the bounded event window and model fields cannot replace approved geometry',()=>{
 const f=fixture(),s=survey(f),ids=[...s.eventIds];f.w.minute+=DAY;for(let i=0;i<200;i++)f.w.events.push({id:'later'+i,at:f.w.minute,kind:'system',actors:[],place:{x:1,y:1},text:'later',witnesses:[]});assert.ok(ids.every(id=>workingEvents(f.w).some(e=>e.id===id)));
 const g=fixture(),menu=decisionChoices(decisionContext(g.w,g.r)),c=menu.find(c=>c.action.type==='regionSurvey')!;assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,tiles:['grass'],actorId:g.r.id}),menu));
});

 test('unseen rejection keeps the remembered board route and does not unlock a replacement survey',()=>{
 const f=fixture(),s=prepare(f);f.r.at={x:31,y:16};const v=f.w.residents[1];v.at={...f.b.door};run(f.w,v,choose(f.w,v,'object'));assert.notEqual(s.knownStatus[f.r.id],'objected');
 const options=regionSurveyOpportunities(f.w,f.r);assert.ok(options.some(c=>c.id==='regionSurvey.board.'+s.id));assert.ok(!options.some(c=>c.action.type==='regionSurvey'&&c.action.operation==='survey'));
 run(f.w,f.r,{type:'move',to:f.b.door});run(f.w,f.r,choose(f.w,f.r,'read'));assert.equal(s.knownStatus[f.r.id],'objected');
 run(f.w,f.r,{type:'move',to:{x:31,y:16}});assert.ok(regionSurveyOpportunities(f.w,f.r).some(c=>c.action.type==='regionSurvey'&&c.action.operation==='survey'));
});

test('a lost public board invalidates the original notice and repairs cannot revive prior votes',()=>{
 for(const change of ['destroy','owner','door'] as const){const f=fixture(),s=survey(f);run(f.w,f.r,{type:'move',to:f.b.door});run(f.w,f.r,choose(f.w,f.r,'post'));
  if(change==='destroy')f.b.condition=0;if(change==='owner')f.b.ownerId=f.w.residents[1].id;if(change==='door')f.b.door={x:21,y:12};
  f.w.minute=s.noticeUntil!;advanceRegionSurveys(f.w);assert.equal(s.status,'expired',change);f.b.condition=100;f.b.ownerId='commons';f.b.door={...s.boardDoor};
  assert.ok(regionSurveyReason(f.w,f.r,{type:'regionSurvey',operation:'vote',surveyId:s.id,accept:true}));assert.equal(f.w.map.width,32);
 }
});

test('public labels identify the specific applicant, boundary and limited consent scope',()=>{
 const f=fixture(),s=prepare(f),v=f.w.residents[1];v.at={...f.b.door};const c=choose(f.w,v,'vote',true);assert.equal(c.operation,'vote');
 const options=regionSurveyOpportunities(f.w,v).filter(c=>c.action.type==='regionSurvey'&&['read','object','vote'].includes(c.action.operation));
 for(const o of options){assert.ok(o.label.includes(f.r.name));assert.ok(o.label.includes(s.id));assert.ok(o.label.includes('(31,16)'));assert.match(o.label,/不授予土地/);}
});

test('applicant can inspect a lost board at its remembered address without reviving authority or becoming permanently blocked',()=>{
 for(const change of ['destroy','owner','door','remove'] as const){const f=fixture(),s=prepare(f);f.r.at={x:31,y:16};
  if(change==='destroy')f.b.condition=0;if(change==='owner')f.b.ownerId=f.w.residents[1].id;if(change==='door')f.b.door={x:21,y:12};if(change==='remove')f.w.buildings=[];advanceRegionSurveys(f.w);
  assert.equal(s.status,'expired');assert.notEqual(s.knownStatus[f.r.id],'expired');assert.ok(regionSurveyOpportunities(f.w,f.r).some(c=>c.id==='regionSurvey.board.'+s.id));
  assert.ok(regionSurveyReason(f.w,f.r,{type:'regionSurvey',operation:'read',surveyId:s.id}));run(f.w,f.r,{type:'move',to:s.boardDoor});run(f.w,f.r,choose(f.w,f.r,'read'));assert.equal(s.knownStatus[f.r.id],'expired');
  assert.ok(!regionSurveyOpportunities(f.w,f.r).some(c=>c.id==='regionSurvey.board.'+s.id));assert.ok(regionSurveyReason(f.w,f.r,{type:'regionSurvey',operation:'post',surveyId:s.id}));
  const other={...f.b,id:'new-board',ownerId:'commons',condition:100,at:{x:8,y:8},door:{x:10,y:12}};f.w.buildings.push(other);f.r.knownBuildings.push(other.id);run(f.w,f.r,{type:'move',to:s.at});assert.ok(regionSurveyOpportunities(f.w,f.r).some(c=>c.action.type==='regionSurvey'&&c.action.operation==='survey'));
 }
});

test('remembered approval offers physical return rather than remote live authorization after an unseen objection',()=>{
 const f=fixture(),s=approve(f);f.r.at={x:27,y:16};const before=regionSurveyOpportunities(f.w,f.r).find(c=>c.id==='regionSurvey.return.'+s.id);assert.ok(before);assert.ok(!regionSurveyOpportunities(f.w,f.r).some(c=>c.action.type==='regionSurvey'&&c.action.operation==='open'));
 const v=f.w.residents[1];v.at={...f.b.door};run(f.w,v,choose(f.w,v,'object'));assert.equal(s.knownStatus[f.r.id],'approved');const after=regionSurveyOpportunities(f.w,f.r).find(c=>c.id===before.id);assert.deepEqual(after,before);
 run(f.w,f.r,after!.action);assert.deepEqual(f.r.at,s.at);assert.ok(!regionSurveyOpportunities(f.w,f.r).some(c=>c.action.type==='regionSurvey'&&c.action.operation==='open'));assert.equal(f.w.map.width,32);
});

test('south-boundary normal choices append only southern geometry and keep the actual old coordinate',()=>{
 const f=fixture();f.r.at={x:16,y:28};const original=structuredClone(f.w.map),s=approve(f);assert.equal(s.edge,'south');run(f.w,f.r,opening(f));
 assert.equal(f.w.map.width,32);assert.equal(f.w.map.height,40);assert.deepEqual(f.w.map.tiles.slice(0,32*32),original.tiles);assert.deepEqual(f.r.at,{x:16,y:31});assert.deepEqual(s.access,{x:16,y:32});assert.equal(f.w.map.tiles[32*32+16],'grass');assert.equal(f.w.map.tiles[32*32],'cliff');
});
