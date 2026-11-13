import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Resident,World} from '../src/shared/types.js';
import type {VisitorJourneyAction} from '../src/shared/visitor-journey.js';
import {createWorld} from '../src/world/seed.js';
import {initializeMigration,advanceMigration,outsideDecisionContext,outsideCandidate,applyOutsideDecision} from '../src/world/migration.js';
import {initializeFood} from '../src/world/food.js';
import {addHealthCase,movementRate} from '../src/world/health.js';
import {stepWorld} from '../src/world/engine.js';
import {DAY,YEAR} from '../src/world/time.js';
import {decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore,workingEvents} from '../src/server/store.js';

import {regionalDecisionWait} from '../src/shared/outside-aid.js';
import {hasTimelyVisitorJourneyRescue} from '../src/world/visitor-journey.js';

function fixture(start=true,frontier=false){
 const w=createWorld();w.mode='formal';w.clock.paused=false;if(frontier)w.scenario='frontier';
 w.map={...w.map,width:20,height:12,tiles:Array(240).fill('grass'),entrance:{x:0,y:6}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 initializeMigration(w);for(const c of w.migration!.contacts){c.phase='home';c.futureAt=Number.MAX_SAFE_INTEGER;}
 for(const r of w.residents){r.inventory={};r.decisionDue=Number.MAX_SAFE_INTEGER;r.lastDecisionAt=w.minute;}
 w.minute=56*DAY+480;advanceMigration(w);const [ca,cb]=w.migration!.contacts.filter(c=>c.familyId),a=ca.person!,b=cb.person!;initializeFood(w);
 if(start){go(w,a,b);go(w,b,a);}
 return {w,a,b,ca,cb};
}
function go(w:World,r:Resident,other:Resident){const result=applyOutsideDecision(w,r.id,r.revision,{intention:'本人愿意成人亲属同行，途中各自决定',actions:[{type:'travelWithFamily',partnerId:other.id}]});assert.ok(result.ok,result.error);}
function choose(w:World,r:Resident,operation:VisitorJourneyAction['operation'],item?:VisitorJourneyAction['item']){
 const choices=decisionChoices(outsideDecisionContext(w,r)),choice=choices.find(c=>c.action.type==='visitorJourney'&&c.action.operation===operation&&(item===undefined||c.action.item===item));assert.ok(choice,operation);
 const result=applyOutsideDecision(w,r.id,r.revision,parseChoice(JSON.stringify({choice:choice.id}),choices));assert.ok(result.ok,result.error);
}
function wait(f:ReturnType<typeof fixture>){stepWorld(f.w,f.ca.journey!.staged!.stageRemaining);assert.equal(f.ca.journey!.staged!.status,'waiting');assert.equal(f.cb.journey!.staged!.status,'waiting');}

test('new adult pairs share a real route and only independently chosen finite stages, not an arrival timer',()=>{
 const f=fixture(),{w,a,b,ca,cb}=f,count=w.residents.length,stock=[{...a.inventory},{...b.inventory}],ja=ca.journey!.staged!,jb=cb.journey!.staged!;
 assert.equal(ja.family!.companionId,b.id);assert.equal(jb.family!.companionId,a.id);assert.equal(a.regionalLocation!.routeId,b.regionalLocation!.routeId);assert.deepEqual(a.at,{x:-1,y:-1});assert.deepEqual(b.at,a.at);
 w.minute+=500;advanceMigration(w);assert.equal(ja.progress,ja.duration/2);assert.equal(jb.progress,ja.progress);assert.equal(w.residents.length,count);assert.deepEqual([a.inventory,b.inventory],stock);
 choose(w,a,'continue');const at=ja.progress;stepWorld(w,3);assert.equal(ja.progress,at);assert.equal(jb.progress,at);assert.equal(ja.status,'waiting');assert.equal(outsideCandidate(w).includes(a),false);assert.equal(outsideCandidate(w).includes(b),true);
 choose(w,b,'continue');assert.equal(ja.status,'travelling');assert.equal(jb.status,'travelling');stepWorld(w,ja.stageRemaining);assert.equal(a.residency,'visitor');assert.equal(b.residency,'visitor');assert.equal(ca.person,undefined);assert.equal(cb.person,undefined);assert.equal(w.residents.length,count+2);assert.equal(a.homeId,null);assert.equal(b.homeId,null);assert.equal(w.residents.find(r=>r.id===a.id),a);
});

test('both adults use the slower current movement rate without extending either chosen stage',()=>{
 const f=fixture(),{w,a,b,ca,cb}=f;addHealthCase(w,a,'injury',60,'已存在的腿伤');const ja=ca.journey!.staged!,jb=cb.journey!.staged!,minutes=ja.stageRemaining;assert.equal(movementRate(w,a),.5);stepWorld(w,minutes);assert.equal(ja.progress,ja.duration-minutes*.5);assert.equal(jb.progress,ja.progress);assert.equal(ja.status,'waiting');assert.equal(jb.status,'waiting');
 choose(w,a,'continue');choose(w,b,'continue');const at=ja.progress;stepWorld(w,1);assert.equal(ja.progress,at-.5);assert.equal(jb.progress,ja.progress);
});

test('pending consent expires independently and cannot be resurrected by the other adults late reply',()=>{
 const f=fixture();wait(f);const {w,a,b,ca,cb}=f,ja=ca.journey!.staged!,at=ja.progress;choose(w,a,'continue');const stale=a.revision;assert.equal(regionalDecisionWait(w,a),false);stepWorld(w,30);assert.equal(ja.family!.ready,undefined);assert.ok(a.revision>stale);choose(w,b,'continue');assert.equal(ja.status,'waiting');assert.equal(cb.journey!.staged!.status,'waiting');assert.equal(ja.progress,at);choose(w,a,'continue');assert.equal(ja.status,'travelling');
});

test('each adult eats only their own original finite lots and own sitting rest never drags the other',()=>{
 const f=fixture();wait(f);const {w,a,b,ca,cb}=f,ja=ca.journey!.staged!,jb=cb.journey!.staged!,at=ja.progress,food=a.inventory.meal!,otherFood=b.inventory.meal!,lot=structuredClone(w.food!.lots['person:'+a.id].meal![0]);a.hunger=80;b.hunger=80;a.energy=10;b.energy=20;
 choose(w,a,'eat','meal');choose(w,b,'rest');stepWorld(w,5);assert.equal(a.inventory.meal,food-1);assert.equal(b.inventory.meal,otherFood);assert.ok(a.hunger<80);assert.ok(b.hunger>80);assert.equal(ja.pause,undefined);assert.ok(jb.pause);assert.equal(ja.progress,at);assert.equal(jb.progress,at);assert.equal(w.food!.lots['person:'+a.id].meal![0].expiresAt,lot.expiresAt);
 choose(w,a,'continue');stepWorld(w,25);assert.equal(jb.pause,undefined);assert.equal(ja.status,'waiting');assert.ok(b.energy>20);assert.equal(ja.progress,at);choose(w,b,'continue');assert.equal(ja.status,'travelling');
});

test('expired food cannot be shared, refreshed or eaten by a pending old choice',()=>{
 const f=fixture();wait(f);const {w,a,b,ca}=f;for(const lots of Object.values(w.food!.lots['person:'+a.id]))for(const lot of lots??[])lot.expiresAt=w.minute+3;const otherFood={...b.inventory};a.hunger=80;choose(w,a,'eat','meal');stepWorld(w,5);assert.equal(a.inventory.meal,0);assert.ok(a.hunger>80);assert.deepEqual(b.inventory,otherFood);assert.match(ca.journey!.staged!.reason!,/腐败/);assert.equal(outsideDecisionContext(w,a).outside!.choices.some(c=>c.action.type==='visitorJourney'&&c.action.operation==='eat'),false);
});

test('incapacity stops both at their actual common location, and recovery needs two new decisions',()=>{
 const f=fixture(),{w,a,b,ca,cb}=f;stepWorld(w,2);const at=ca.journey!.staged!.progress;a.canDecide=false;stepWorld(w,4);assert.equal(ca.journey!.staged!.progress,at);assert.equal(cb.journey!.staged!.progress,at);assert.equal(cb.journey!.staged!.status,'waiting');assert.equal(outsideDecisionContext(w,b).outside!.choices.some(c=>c.action.type==='visitorJourney'&&c.action.operation==='continue'),false);a.canDecide=true;stepWorld(w,10);assert.equal(ca.journey!.staged!.progress,at);choose(w,a,'continue');assert.equal(cb.journey!.staged!.status,'waiting');choose(w,b,'continue');stepWorld(w,1);assert.equal(ca.journey!.staged!.progress,at-1);assert.equal(cb.journey!.staged!.progress,at-1);
});

test('an adult can explicitly leave an incapacitated companion in place without inventing a care handoff',()=>{
 const f=fixture(),{w,a,b,ca,cb}=f;stepWorld(w,2);a.canExpress=false;stepWorld(w,1);const at=ca.journey!.staged!.progress,inventory={...a.inventory},home=a.homeId;choose(w,b,'continueAlone');assert.equal(cb.journey!.staged!.family,undefined);assert.equal(ca.journey!.staged!.family,undefined);stepWorld(w,1);assert.equal(ca.journey!.staged!.progress,at);assert.equal(cb.journey!.staged!.progress,at-1);assert.deepEqual(a.inventory,inventory);assert.equal(a.homeId,home);assert.deepEqual(a.guardianIds,[]);assert.ok(b.memories.some(m=>m.text.includes('没有自动照护、接班或救援')));
});

test('turning back separates only the adult who chose it and walks the real distance while the others meal finishes',()=>{
 const f=fixture();wait(f);const {w,a,b,ca,cb}=f,ja=ca.journey!.staged!,jb=cb.journey!.staged!,at=ja.progress,food=b.inventory.meal!;choose(w,b,'eat','meal');choose(w,a,'turnBack');assert.equal(jb.family,undefined);assert.ok(jb.pause);stepWorld(w,5);assert.equal(b.inventory.meal,food-1);assert.equal(jb.progress,at);assert.equal(ja.progress,at+5);stepWorld(w,ja.stageRemaining);assert.equal(ca.phase,'home');assert.equal(ca.journey,null);assert.equal(a.regionalLocation!.progress,ja.duration);assert.equal(cb.phase,'offered');assert.equal(b.residency,'outside');
});

test('a death leaves the companion, body and original estate at the common route location without town witnesses or duplication',()=>{
 const f=fixture(),{w,a,b,ca,cb}=f;stepWorld(w,2);const at=ca.journey!.staged!.progress,route=a.regionalLocation!.routeId,stock={...a.inventory},town=w.residents.map(r=>JSON.stringify(r.memories));Object.assign(a,{hunger:100,energy:0,health:.001});stepWorld(w,1);assert.equal(a.status,'dead');assert.equal(ca.journey!.staged!.status,'interrupted');assert.ok(!w.events.some(e=>e.text.includes(a.name+'眼前亲属已离世')));assert.equal(cb.journey!.staged!.progress,at);assert.equal(cb.journey!.staged!.status,'waiting');const estate=w.estates.find(e=>e.personId===a.id)!;assert.equal(estate.location!.regional!.progress,at);assert.equal(estate.location!.regional!.routeId,route);assert.deepEqual(estate.inventory,stock);assert.deepEqual(w.residents.map(r=>JSON.stringify(r.memories)),town);assert.match(outsideDecisionContext(w,b).outside!.notice,/已在共同驿路原址离世/);choose(w,b,'continueAlone');assert.ok(b.memories.some(m=>m.text.includes('遗体及已封存财产仍在原址')));stepWorld(w,1);assert.equal(a.regionalLocation!.progress,at);assert.equal(a.regionalLocation!.routeId,route);assert.equal(w.estates.filter(e=>e.personId===a.id).length,1);assert.equal(w.residents.some(r=>r.id===a.id),false);
});

test('a blocked gate stays blocked until both independently choose a complete retry, including fractional ticks',()=>{
 const f=fixture(),{w,a,b,ca,cb}=f;w.map.tiles[w.map.entrance.y*w.map.width]='water';wait(f);choose(w,a,'continue');choose(w,b,'continue');stepWorld(w,ca.journey!.staged!.stageRemaining);assert.equal(ca.journey!.staged!.progress,0);assert.equal(cb.journey!.staged!.progress,0);w.map.tiles[w.map.entrance.y*w.map.width]='grass';stepWorld(w,30);assert.equal(a.residency,'outside');choose(w,a,'continue');choose(w,b,'continue');stepWorld(w,29.9);assert.equal(a.residency,'outside');assert.equal(b.residency,'outside');stepWorld(w,.1);assert.equal(a.residency,'visitor');assert.equal(b.residency,'visitor');
});

test('saving a partly walked stage and a single consent preserves distance, finite consent and no duplicate meal',()=>{
 const f=fixture();stepWorld(f.w,3);const store=new WorldStore(':memory:');try{store.commit(f.w,null);let w=store.load()!,base=w.revision,ca=w.migration!.contacts.find(c=>c.id===f.a.id)!,cb=w.migration!.contacts.find(c=>c.id===f.b.id)!,a=ca.person!,b=cb.person!,ja=ca.journey!.staged!;assert.equal(ja.progress,f.ca.journey!.staged!.progress);advanceMigration(w);assert.equal(ja.progress,f.ca.journey!.staged!.progress);stepWorld(w,ja.stageRemaining);choose(w,a,'continue');const expires=ja.family!.ready!.expiresAt;choose(w,b,'eat','meal');stepWorld(w,2);const food=b.inventory.meal!;store.commit(w,base);w=store.load()!;ca=w.migration!.contacts.find(c=>c.id===a.id)!;cb=w.migration!.contacts.find(c=>c.id===b.id)!;a=ca.person!;b=cb.person!;assert.equal(ca.journey!.staged!.family!.ready!.expiresAt,expires);w.clock.paused=true;const before=JSON.stringify(w);stepWorld(w,100);assert.equal(JSON.stringify(w),before);w.clock.paused=false;stepWorld(w,3);assert.equal(b.inventory.meal,food-1);assert.equal(ca.journey!.staged!.status,'waiting');assert.equal(cb.journey!.staged!.pause,undefined);assert.ok(workingEvents(w).some(e=>e.text.includes('本人同意再同行')));}finally{store.close();}
});

test('pregnancy and child care block either signer and are rechecked after the first consent',()=>{
 for(const role of ['first','second','outside-child','town-child'] as const){const f=fixture(false),{w,a,b}=f;if(role!=='first')go(w,a,b);if(role==='first'||role==='second')a.pregnancy={otherParentId:b.id,conceivedAt:w.minute,dueAt:w.minute+DAY,definition:'life/basic@1'};else{const child=structuredClone(w.residents[0]);Object.assign(child,{id:'dependent',name:'需要照护的孩子',status:'alive',residency:role==='outside-child'?'outside':'resident',bornAt:w.minute-5*YEAR,guardianIds:[a.id],homeId:null});w.residents.push(child);}const r=role==='first'?a:b,other=r===a?b:a,before=JSON.stringify(w);const result=applyOutsideDecision(w,r.id,r.revision,{intention:'当前不具备照护条件',actions:[{type:'travelWithFamily',partnerId:other.id}]});assert.equal(result.ok,false,role);assert.match(result.error!,/孕育|照护|监护/);assert.equal(JSON.stringify(w),before);}
});

test('stale and malformed replies cannot split a party, add a third adult or change the chosen time',()=>{
 const f=fixture();wait(f);const {w,a,ca}=f,j=ca.journey!.staged!;for(const minutes of [undefined,0,-1,13,NaN,Infinity]){const before=JSON.stringify(w);assert.equal(applyOutsideDecision(w,a.id,a.revision,{intention:'非法离队',actions:[{type:'visitorJourney',operation:'continueAlone',journeyId:j.id,minutes}]}).ok,false);assert.equal(JSON.stringify(w),before);}const revision=a.revision;choose(w,a,'rest');const before=JSON.stringify(w);assert.equal(applyOutsideDecision(w,a.id,revision,{intention:'旧回复不能带走亲属',actions:[{type:'visitorJourney',operation:'turnBack',journeyId:j.id}]}).ok,false);assert.equal(JSON.stringify(w),before);
});

test('normal menus preserve joint consent and expose no distant lodging',()=>{
 const f=fixture();wait(f);const {w,a,b}=f;choose(w,a,'continue');b.name=f.cb.name='<svg onload=bad>';const before=JSON.stringify(w),context=outsideDecisionContext(w,b);assert.deepEqual(context.buildings,[]);assert.deepEqual(context.people,[]);assert.match(context.outside!.notice,/已同意下一段/);assert.equal(JSON.stringify(w),before);
});

test('a stopped family member retains actual timely self rescue, but consenting to wait is not technical protection',()=>{
 const f=fixture();wait(f);const {w,a,b}=f;Object.assign(a,{hunger:98,energy:80,health:1});assert.equal(hasTimelyVisitorJourneyRescue(w,a),true);stepWorld(w,1,{decisionChoices:()=>[]});assert.equal(a.health,1);choose(w,a,'continue');assert.equal(regionalDecisionWait(w,a),false);const health=a.health;stepWorld(w,1,{decisionChoices:()=>[]});assert.ok(a.health<health);assert.equal(b.residency,'outside');
});

test('legacy adult family timer journeys remain unchanged without inventing intermediate choices or past supplies',()=>{
 const f=fixture(false),{w,a,b,ca,cb}=f;for(const c of [ca,cb]){c.phase='travelling';c.journey={leftAt:w.minute,arriveAt:w.minute+24,nextCheckAt:w.minute+24,blocked:false};}const snapshot=JSON.stringify([ca.journey,cb.journey]);w.minute+=23;advanceMigration(w);assert.equal(JSON.stringify([ca.journey,cb.journey]),snapshot);assert.equal(a.regionalLocation,undefined);w.minute++;advanceMigration(w);assert.equal(a.residency,'visitor');assert.equal(b.residency,'visitor');
});

test('incapacity revokes a pending joint consent immediately instead of trapping the willing adult in a hidden wait',()=>{
 const f=fixture();wait(f);choose(f.w,f.a,'continue');f.b.canDecide=false;stepWorld(f.w,1);assert.equal(f.ca.journey!.staged!.family!.ready,undefined);assert.equal(outsideCandidate(f.w).includes(f.a),true);choose(f.w,f.a,'rest');assert.ok(f.ca.journey!.staged!.pause);
});

test('longer frontier pairs have exactly one body clock, no automatic supply or continuation and finite stages',()=>{
 for(const returning of [false,true]){const f=fixture(false,true),{w,a,b,ca,cb}=f;if(returning){w.residents.push(a,b);delete ca.person;delete cb.person;}go(w,a,b);go(w,b,a);const ja=ca.journey!.staged!,jb=cb.journey!.staged!,before=[a.hunger,b.hunger,a.energy,b.energy],stock=[{...a.inventory},{...b.inventory}];assert.equal(ja.duration,204);stepWorld(w,30);assert.equal(ja.progress,174);assert.equal(jb.progress,174);assert.equal(ja.status,'waiting');const changes=[a.hunger-before[0],b.hunger-before[1],before[2]-a.energy,before[3]-b.energy];assert.ok(changes.every(n=>n>0&&n<10));assert.deepEqual([a.inventory,b.inventory],stock);choose(w,a,'continue');choose(w,b,'continue');stepWorld(w,30);assert.equal(ja.progress,144);assert.equal(jb.progress,144);assert.equal(w.residents.filter(r=>r.id===a.id||r.id===b.id).length,returning?2:0);}
});
