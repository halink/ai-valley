import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {careAuthority,executeSocialAction} from '../src/world/social.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import {roomLayout} from '../src/shared/rooms.js';
import {initializeRooms} from '../src/world/rooms.js';

// Independent isolated fixtures; no live saves, model calls or network.
function fixture(age=30){
 const w=createWorld(721);w.mode='formal';w.clock.paused=false;w.resources=[];w.plots=[];w.buildings=[];w.residents=w.residents.slice(0,3);w.proposals=[];
 for(const r of w.residents){r.at={...w.map.entrance};r.inside=null;r.roomAt=null;r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.plan=r.activity=null;r.lastFailure=null;r.canDecide=r.canExpress=true;r.refusesCare=false;r.health=80;r.energy=100;r.hunger=40;r.skills.care=2;r.inventory={meal:5,water:5};r.guardianIds=[];r.parents=[];r.adoptiveParents=[];}
 const [helper,patient,former]=w.residents;patient.bornAt=w.minute-age*YEAR;patient.health=19;patient.canDecide=patient.canExpress=false;patient.guardianIds=[former.id];
 return {w,helper,patient,former};
}
const action=(p:Resident):Action=>({type:'care',targetId:p.id});
function selected(w:World,r:Resident,p:Resident){const menu=decisionChoices(decisionContext(w,r)),row=menu.find(c=>c.action.type==='care'&&c.action.targetId===p.id);assert.ok(row,'actual final menu must expose emergency basic care');return {menu,row,a:parseChoice(JSON.stringify({choice:row.id}),menu).actions[0]};}
function queue(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`independent-care:${r.id}:${r.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自愿以自有粮水提供一次基础急救',actions:[a]});assert.equal(result.ok,true,result.error);}
function finish(w:World,r:Resident){let n=100;while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,1);}}
const receipts=(w:World)=>w.events.filter(e=>e.kind==='care'&&e.audit?.scope?.includes('basic-care'));

test('independent care review: adult with present childhood guardian completes real menu and spends own supplies once',()=>{
 const {w,helper,patient,former}=fixture(),rights=structuredClone({guardians:patient.guardianIds,parents:patient.parents,home:patient.homeId,coins:patient.coins,inventory:patient.inventory}),formerInventory={...former.inventory};
 assert.equal(careAuthority(w,helper,patient).basis,'emergency');queue(w,helper,selected(w,helper,patient).a);finish(w,helper);
 assert.equal(helper.lastFailure,null);assert.equal(helper.inventory.meal,4);assert.equal(helper.inventory.water,4);assert.ok(patient.health>20);assert.equal(receipts(w).length,1);assert.equal(receipts(w)[0].audit?.authority,'emergency');
 assert.deepEqual({guardians:patient.guardianIds,parents:patient.parents,home:patient.homeId,coins:patient.coins,inventory:patient.inventory},rights);assert.deepEqual(former.inventory,formerInventory);assert.equal(w.proposals.length,0);
 assert.equal(executeSocialAction(w,helper,action(patient)).ok,false);assert.equal(helper.inventory.meal,4);
});

test('independent care review: adulthood cutoff retains child timely guardian and infant direct guardian',()=>{
 for(const age of [5,17,18,65]){const {w,helper,patient,former}=fixture(age);assert.equal(careAuthority(w,helper,patient).allowed,age>=18,String(age));assert.equal(careAuthority(w,former,patient).basis,age<6?'guardian':age>=18?'emergency':undefined,String(age));}
 const {w,helper,patient,former}=fixture(17);former.at.x+=20;assert.equal(careAuthority(w,helper,patient).basis,'emergency');
});

test('independent care review: historical guardian is not an adult consent or noncritical-care mandate',()=>{
 for(const change of ['capable','noncritical','refused','declined'] as const){const {w,helper,patient,former}=fixture();if(change==='capable')patient.canDecide=patient.canExpress=true;if(change==='noncritical')patient.health=21;if(change==='refused')patient.refusesCare=true;
 if(change==='declined')for(const actor of [helper,former])w.proposals.push({id:`declined:${actor.id}`,kind:'care',actorId:actor.id,targetId:patient.id,status:'declined',createdAt:w.minute,expiresAt:w.minute+100,definition:w.activeDefinitions['action/routine']});
 for(const actor of [helper,former]){assert.equal(careAuthority(w,actor,patient).allowed,false,change);const inventory={...actor.inventory};assert.equal(executeSocialAction(w,actor,action(patient)).ok,false,change);assert.deepEqual(actor.inventory,inventory);}}
});

test('independent care review: partial recovery preserves existing basic-care capacity boundary',()=>{
 for(const [decide,express] of [[false,false],[false,true],[true,false],[true,true]]){const {w,helper,patient}=fixture();patient.canDecide=decide;patient.canExpress=express;assert.equal(careAuthority(w,helper,patient).allowed,!(decide&&express));}
});

for(const change of ['refusal','recovery','health','separation','provider','water','skill','decline'] as const)test(`independent care review: completion rechecks ${change} after work begins`,()=>{
 const {w,helper,patient}=fixture();queue(w,helper,selected(w,helper,patient).a);stepWorld(w,1);assert.ok(helper.activity);helper.activity.remaining=1;
 if(change==='refusal')patient.refusesCare=true;if(change==='recovery')patient.canDecide=patient.canExpress=true;if(change==='health')patient.health=21;if(change==='separation')patient.at.x+=20;if(change==='provider')helper.canDecide=false;if(change==='water')helper.inventory.water=0;if(change==='skill')helper.skills.care=0;
 if(change==='decline')w.proposals.push({id:'stopped-midway',kind:'care',actorId:helper.id,targetId:patient.id,status:'declined',createdAt:w.minute,expiresAt:w.minute+100,definition:w.activeDefinitions['action/routine']});
 const before={...helper.inventory};stepWorld(w,1);assert.deepEqual(helper.inventory,before);assert.equal(receipts(w).length,0);
});

test('independent care review: reload preserves historical IDs but never grants forged consent',()=>{
 const f=fixture();queue(f.w,f.helper,selected(f.w,f.helper,f.patient).a);stepWorld(f.w,1);assert.ok(f.helper.activity);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,helper=w.residents.find(r=>r.id===f.helper.id)!,patient=w.residents.find(r=>r.id===f.patient.id)!;assert.deepEqual(patient.guardianIds,[f.former.id]);finish(w,helper);assert.equal(helper.inventory.meal,4);assert.equal(receipts(w).length,1);
 patient.health=19;const before={...helper.inventory};for(const proposalId of ['invented',null])assert.equal(executeSocialAction(w,helper,{type:'care',targetId:patient.id,proposalId} as unknown as Action).ok,false);assert.deepEqual(helper.inventory,before);
 }finally{store.close();}
});

test('independent care review: model cannot inject guardian or emergency authority into menu selection',()=>{
 const {w,helper,patient}=fixture(),{menu,row}=selected(w,helper,patient);for(const extra of [{authority:'guardian'},{authority:'emergency'},{proposalId:'forged'},{targetId:helper.id},{guardianIds:[helper.id]}])assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,...extra}),menu));
});

test('independent care review: persisted work cannot use old emergency state after full recovery',()=>{
 const f=fixture();queue(f.w,f.helper,selected(f.w,f.helper,f.patient).a);stepWorld(f.w,1);assert.ok(f.helper.activity);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,helper=w.residents.find(r=>r.id===f.helper.id)!,patient=w.residents.find(r=>r.id===f.patient.id)!;patient.canDecide=patient.canExpress=true;finish(w,helper);assert.equal(helper.inventory.meal,5);assert.equal(helper.inventory.water,5);assert.equal(receipts(w).length,0);assert.ok(helper.lastFailure);
 }finally{store.close();}
});

test('independent care review: accepted adult care still requires its own exact consent binding',()=>{
 const {w,helper,patient}=fixture();patient.canDecide=patient.canExpress=true;patient.health=60;
 w.proposals.push({id:'own-consent',kind:'care',actorId:helper.id,targetId:patient.id,status:'accepted',createdAt:w.minute,expiresAt:w.minute+100,definition:w.activeDefinitions['action/routine']});
 assert.equal(executeSocialAction(w,helper,action(patient)).ok,false);assert.equal(helper.inventory.meal,5);const {a}=selected(w,helper,patient);assert.equal((a as Extract<Action,{type:'care'}>).proposalId,'own-consent');queue(w,helper,a);finish(w,helper);assert.equal(helper.inventory.meal,4);assert.equal(w.proposals[0].status,'expired');assert.equal(receipts(w)[0].audit?.authority,'consent');
});

for(const permitted of [true,false])test(`independent care review: historical guardian does not bypass indoor space permission (${permitted})`,()=>{
 const {w,helper,patient,former}=fixture(),building=structuredClone(createWorld(721).buildings.find(b=>b.kind==='lodge')!);building.ownerId=permitted?'commons':former.id;building.residents=[];w.buildings=[building];initializeRooms(w);
 const entry=roomLayout(w,building).entry;for(const r of [helper,patient,former]){r.inside=building.id;r.at={...building.door};r.roomAt={...entry};}
 assert.equal(careAuthority(w,helper,patient).allowed,permitted);const before={...helper.inventory};
 if(permitted){queue(w,helper,selected(w,helper,patient).a);finish(w,helper);assert.equal(helper.lastFailure,null);assert.equal(helper.inventory.meal,4);assert.equal(helper.inside,building.id);assert.equal(patient.inside,building.id);}
 else{assert.equal(executeSocialAction(w,helper,action(patient)).ok,false);assert.deepEqual(helper.inventory,before);}
});
