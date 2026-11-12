import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents){Object.assign(r,{at:{x:10,y:10},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:0,knownBuildings:[],knownResources:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null});}
 const [giver,recipient,other]=w.residents;giver.inventory={turnip:3,wood:5};initializeFood(w);return {w,giver,recipient,other};
}
function menu(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
function choice(w:World,r:Resident,operation:string,fields:Record<string,unknown>={}){const choices=menu(w,r),c=choices.find(c=>{const a=c.action as unknown as Record<string,unknown>;return a.type==='personalFoodGift'&&a.operation===operation&&Object.entries(fields).every(([k,v])=>k==='quantity'||a[k]===v);});assert.ok(c,`missing ${operation} choice for ${r.id}`);return parseChoice(JSON.stringify({choice:c.id,...('quantity' in fields?{quantity:fields.quantity}:{})}),choices).actions[0];}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`personal-gift:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择食物赠与',actions:[a]});}
function finish(w:World,r:Resident){let n=200;while(r.plan||r.activity){assert.ok(n--,'action must terminate');stepWorld(w,1);}}
function run(w:World,r:Resident,a:Action){const result=queue(w,r,a);assert.equal(result.ok,true,JSON.stringify(result));finish(w,r);assert.equal(r.lastFailure,null);}

function record(w:World){return w.personalFoodGifts!.gifts.at(-1)!;}
function offered(f:ReturnType<typeof fixture>,quantity=1){run(f.w,f.giver,choice(f.w,f.giver,'offer',{recipientId:f.recipient.id,item:'turnip',quantity}));return record(f.w);}
function accepted(f:ReturnType<typeof fixture>,quantity=1){const g=offered(f,quantity);run(f.w,f.recipient,choice(f.w,f.recipient,'accept',{giftId:g.id}));return g;}


import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {personalFoodGiftNotes,personalFoodGiftOpportunities,MAX_PERSONAL_FOOD_GIFT_NOTES} from '../src/world/personal-food-gifts.js';

test('handoff independent review: accepted facts survive lost episodic memories, are read-only and do not alter choices',()=>{
 const f=fixture(),g=accepted(f);f.recipient.memories=[];f.giver.memories=[];
 const before=structuredClone(f.w),note=personalFoodGiftNotes(f.w,f.recipient),context=decisionContext(f.w,f.recipient);
 assert.ok(note.includes(g.id));assert.ok(note.includes(String(g.expiresAt)));assert.match(note,/10,10/);assert.match(note,/尚未|不等于|未收/);assert.match(note,/离开/);assert.match(note,/等候|等待|停留/);assert.match(note,/撤回|拒绝/);
 assert.equal(context.formal!.personalFoodGiftNotes,note);const withNote=decisionChoices(context);delete context.formal!.personalFoodGiftNotes;assert.deepEqual(decisionChoices(context),withNote);assert.deepEqual(f.w,before);
});

test('handoff independent review: hidden remote withdrawal remains unknown to the other participant',()=>{
 const f=fixture(),g=accepted(f);f.giver.at={x:30,y:10};
 const before=personalFoodGiftNotes(f.w,f.giver);run(f.w,f.recipient,choice(f.w,f.recipient,'decline',{giftId:g.id}));
 assert.equal(g.status,'declined');assert.equal(g.knownStatus[f.giver.id],'accepted');assert.equal(personalFoodGiftNotes(f.w,f.giver),before);
 assert.equal(personalFoodGiftNotes(f.w,f.recipient),'');
});

test('handoff independent review: remote private facts cannot change recipient or giver summary',()=>{
 for(const role of ['giver','recipient'] as const){
  const f=fixture();accepted(f);const actor=f[role],other=role==='giver'?f.recipient:f.giver;other.at={x:30,y:10};
  const note=personalFoodGiftNotes(f.w,actor);Object.assign(other,{at:{x:38,y:19},inside:'secret-room',roomAt:{x:97,y:96},inventory:{turnip:98765},health:0,status:'dead',residency:'outside',name:'REMOTE_SECRET_NAME',canDecide:false,canExpress:false});
  const g=record(f.w);g.status='cancelled';g.endedAt=12345;g.reason='REMOTE_SECRET_REASON';
  assert.equal(personalFoodGiftNotes(f.w,actor),note);assert.doesNotMatch(note,/98765|REMOTE_SECRET|12345/);
 }
});

test('handoff independent review: offered knowledge does not disclose later acceptance coordinates',()=>{
 const f=fixture(),g=accepted(f);g.knownStatus[f.giver.id]='offered';
 const note=personalFoodGiftNotes(f.w,f.giver);assert.ok(note.includes(g.id));assert.doesNotMatch(note,/\(10,10\)|（10,10）/);assert.doesNotMatch(note,/本人已接受|本人最后获知.*已接受/);
});

test('handoff independent review: unrelated, ended, expired and unverifiable records are not presented',()=>{
 const f=fixture(),g=accepted(f);g.knownStatus[f.other.id]='accepted';assert.equal(personalFoodGiftNotes(f.w,f.other),'');
 const original=structuredClone(g);for(const status of ['delivered','cancelled','declined','expired','invalid'] as const){g.knownStatus[f.recipient.id]=status;assert.equal(personalFoodGiftNotes(f.w,f.recipient),'');}
 Object.assign(g,structuredClone(original));f.w.minute=g.expiresAt;const before=structuredClone(f.w);assert.equal(personalFoodGiftNotes(f.w,f.recipient),'');assert.deepEqual(f.w,before);
 f.w.minute=g.expiresAt-1;for(const field of ['quantity','location','eventIds'] as const){Object.assign(g,structuredClone(original));if(field==='quantity')g.quantity=3;if(field==='location')g.location.at.x++;if(field==='eventIds')g.eventIds=[];assert.equal(personalFoodGiftNotes(f.w,f.recipient),'',field);}
});

test('handoff independent review: own departure changes only own place observation, never enforces waiting',()=>{
 const f=fixture(),g=accepted(f),atPlace=personalFoodGiftNotes(f.w,f.recipient),giverNote=personalFoodGiftNotes(f.w,f.giver);
 const move:Action={type:'move',to:{x:10,y:14}};run(f.w,f.recipient,move);const departed=personalFoodGiftNotes(f.w,f.recipient);
 assert.notEqual(departed,atPlace);assert.ok(departed.includes(g.id));assert.match(departed,/离开|不在/);assert.equal(personalFoodGiftNotes(f.w,f.giver).replace(/尚余[0-9.]+分钟/g,'尚余时间'),giverNote.replace(/尚余[0-9.]+分钟/g,'尚余时间'));
 assert.deepEqual(f.recipient.at,{x:10,y:14});assert.equal(g.status,'accepted');assert.equal(f.recipient.inventory.turnip??0,0);
});

test('handoff independent review: missing old-save state stays missing and memory-only reload preserves notes',()=>{
 const f=fixture();delete f.w.personalFoodGifts;const empty=structuredClone(f.w);assert.equal(personalFoodGiftNotes(f.w,f.recipient),'');assert.deepEqual(f.w,empty);
 accepted(f);const before=personalFoodGiftNotes(f.w,f.recipient),store=new WorldStore(':memory:');try{store.commit(f.w,null);const loaded=store.load(true)!;assert.equal(personalFoodGiftNotes(loaded,loaded.residents.find(r=>r.id===f.recipient.id)!),before);}finally{store.close();}
});

test('handoff independent review: all supported final prompts preserve summary despite long family notes',()=>{
 const f=fixture();accepted(f);const c=decisionContext(f.w,f.recipient),note=personalFoodGiftNotes(f.w,f.recipient);c.formal!.familyNotes='合成家事记录'.repeat(9000);
 for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){const p=prepareModelDecision(c,undefined,model);assert.ok(p.messages[0].content.includes(note));const without=structuredClone(c);delete without.formal!.personalFoodGiftNotes;assert.deepEqual(p.choices,decisionChoices(without));}
});

test('handoff independent review: recipient saturation is bounded, deterministic and accepted-first',()=>{
 const f=fixture();f.w.residents.push({...structuredClone(f.giver),id:'review-additional-giver',name:'审查供方'});const donors=f.w.residents.filter(r=>r.id!==f.recipient.id);for(const r of donors)r.inventory={turnip:3};initializeFood(f.w);
 const made=[];for(const donor of donors){for(let n=0;n<3;n++){const a=personalFoodGiftOpportunities(f.w,donor).find(c=>c.action.type==='personalFoodGift'&&c.action.operation==='offer'&&c.action.recipientId===f.recipient.id&&c.action.item==='turnip')!.action;run(f.w,donor,a);made.push(record(f.w));}}
 assert.ok(made.length>MAX_PERSONAL_FOOD_GIFT_NOTES);const newest=made.at(-1)!;run(f.w,f.recipient,{type:'personalFoodGift',operation:'accept',giftId:newest.id});
 const before=structuredClone(f.w),note=personalFoodGiftNotes(f.w,f.recipient);assert.ok(note.includes(newest.id));assert.equal(made.filter(g=>note.includes(g.id+'：')).length,MAX_PERSONAL_FOOD_GIFT_NOTES);assert.match(note,/另有/);assert.ok(note.length<6000);assert.equal(personalFoodGiftNotes(f.w,f.recipient),note);assert.deepEqual(f.w,before);
});

import {roomLayout} from '../src/shared/rooms.js';
import {initializeRooms} from '../src/world/rooms.js';
import {personalFoodGiftReceiptId} from '../src/world/personal-food-gifts.js';
test('handoff independent review: indoor note distinguishes the historical room point from current doorway position',()=>{
 const f=fixture();initializeRooms(f.w);const b=structuredClone(createWorld().buildings.find(b=>b.kind==='home')!);Object.assign(b,{id:'review-handoff-home',door:{x:10,y:10},at:{x:9,y:6},width:4,height:3,ownerId:f.recipient.id,residents:[f.giver.id,f.recipient.id]});f.w.buildings=[b];const entry=roomLayout(f.w,b).entry;for(const r of [f.giver,f.recipient]){r.inside=b.id;r.roomAt={...entry};}
 accepted(f);const note=personalFoodGiftNotes(f.w,f.recipient);assert.ok(note.includes(b.id));assert.ok(note.includes(`室内原点(${entry.x},${entry.y})`));assert.match(note,/本人此刻在原约点/);
 f.recipient.inside=null;f.recipient.roomAt=null;const left=personalFoodGiftNotes(f.w,f.recipient);assert.match(left,/本人此刻不在原约点/);assert.ok(left.includes(`室内原点(${entry.x},${entry.y})`));
});

test('handoff independent review: valid adult-only v1 record still describes accepted handoff without upgrading authority',()=>{
 const f=fixture();run(f.w,f.giver,{type:'personalFoodGift',operation:'offer',recipientId:f.recipient.id,item:'turnip',quantity:1,receiptId:personalFoodGiftReceiptId(f.w,f.giver,1)});const g=record(f.w);assert.equal(g.ageTerms,undefined);run(f.w,f.recipient,{type:'personalFoodGift',operation:'accept',giftId:g.id});
 const before=structuredClone(f.w),note=personalFoodGiftNotes(f.w,f.recipient);assert.ok(note.includes(g.id));assert.match(note,/已接受/);assert.equal(g.ageTerms,undefined);assert.deepEqual(f.w,before);
});
