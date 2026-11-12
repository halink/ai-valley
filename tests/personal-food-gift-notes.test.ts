import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL,DEEPSEEK_MODEL,modelLimits} from '../src/server/model-completion.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {personalFoodGiftNotes} from '../src/world/personal-food-gifts.js';
import {walkable} from '../src/world/navigation.js';
import type {Action,Resident,World} from '../src/shared/types.js';

const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
function choose(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 const p=prepared(w,r),row=p.choices.find(c=>predicate(c.action));assert.ok(row,'required final numbered choice');
 return parseChoice(JSON.stringify({choice:row.id,...fields}),p.choices).actions[0];
}
function queue(w:World,r:Resident,action:Action){
 const result=submitPlan(w,{id:`handoff-notes:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,
  createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'离线合成夹具本人明确选择',actions:[action]});
 assert.equal(result.ok,true,result.error);
}
function finish(w:World,r:Resident){let left=100;while(r.plan||r.activity){assert.ok(left--);stepWorldWithFoodEvidence(w,1);}assert.equal(r.lastFailure,null);}
function fixture(){
 const w=createFrontierWorld(5401);w.clock.paused=false;
 const giver=w.residents[0],recipient=w.residents[2];
 // Explicit isolated contact staging only. Original map, nine people, food,
 // bodies, dates, deadlines and lots are never replenished or rewritten.
 let at:{x:number;y:number}|undefined;
 for(let y=10;y<w.map.height-10&&!at;y++)for(let x=10;x<w.map.width-10&&!at;x++){
  if(w.residents.every(p=>Math.abs(p.at.x-x)+Math.abs(p.at.y-y)>30)
   &&Array.from({length:11},(_,i)=>({x:x+i-3,y})).every(p=>walkable(w,p)))at={x,y};
 }
 assert.ok(at);giver.at={...at};recipient.at={...at};giver.inside=recipient.inside=null;giver.roomAt=recipient.roomAt=null;
 queue(w,giver,choose(w,giver,a=>a.type==='personalFoodGift'&&a.operation==='offer'&&a.recipientId===recipient.id&&a.item==='turnip'));finish(w,giver);
 const gift=w.personalFoodGifts!.gifts.at(-1)!;
 queue(w,recipient,choose(w,recipient,a=>a.type==='personalFoodGift'&&a.operation==='accept'&&a.giftId===gift.id));finish(w,recipient);
 giver.at={x:at.x-2,y:at.y};return {w,giver,recipient,gift};
}
const body=(w:World)=>w.residents.map(r=>({id:r.id,hunger:r.hunger,energy:r.energy,health:r.health,status:r.status,inventory:structuredClone(r.inventory)}));

test('handoff notes: unchanged opening has identical messages and choices when optional field is omitted',()=>{
 const w=createFrontierWorld(5401),r=w.residents[2],context=decisionContext(w,r),a=prepareModelDecision(context,undefined,GLM_MODEL);
 assert.equal(context.formal!.personalFoodGiftNotes,'');delete context.formal!.personalFoodGiftNotes;
 assert.deepEqual(prepareModelDecision(context,undefined,GLM_MODEL),a);assert.equal(w.metrics.requests,0);
});

test('handoff notes: real seed5401 independent offer and acceptance persist exact terms without demanding a choice',()=>{
 const {w,giver,recipient,gift}=fixture();recipient.memories=[];
 const note=personalFoodGiftNotes(w,recipient),before=structuredClone(w),p=prepared(w,recipient);
 assert.match(note,/原截止第\d+游戏分钟/);assert.ok(note.includes(`(${gift.location.at.x},${gift.location.at.y})`));
 assert.match(note,/本人此刻在原约点/);assert.match(note,/1分钟近身办理/);assert.match(note,/不会自动中断/);
 assert.ok(p.messages[0].content.includes(note));assert.deepEqual(w,before);
 const legacy=decisionContext(w,recipient);delete legacy.formal!.personalFoodGiftNotes;const without=prepareModelDecision(legacy,undefined,GLM_MODEL);
 assert.ok(!without.messages[0].content.includes(`(${gift.location.at.x},${gift.location.at.y})`),'without the new note the remembered exact handoff point is missing');
 assert.deepEqual(p.choices,without.choices);assert.ok(p.inputBytes>without.inputBytes);
 assert.ok(p.choices.some(c=>c.action.type==='move'));assert.ok(p.choices.some(c=>c.action.type==='wait'));
 assert.ok(p.choices.some(c=>c.action.type==='personalFoodGift'&&c.action.operation==='decline'));
 assert.equal(giver.inventory.turnip,5);assert.equal(recipient.inventory.turnip,5);assert.equal(gift.status,'accepted');
});

test('handoff notes: same-seed voluntary wait versus leave demonstrates the stated crossing-window condition',t=>{
 const f=fixture(),start=f.w.minute,reports=[];
 for(const mode of ['wait','leave'] as const){
  const w=structuredClone(f.w),giver=w.residents.find(r=>r.id===f.giver.id)!,recipient=w.residents.find(r=>r.id===f.recipient.id)!;
  const initial=body(w),p=prepared(w,recipient),deadline=w.personalFoodGifts!.gifts[0].expiresAt;
  assert.match(p.messages[0].content,/离开原点会使实际交付无法完成/);
  const action=mode==='wait'?choose(w,recipient,a=>a.type==='wait',{minutes:6}):choose(w,recipient,a=>a.type==='move'&&a.to.x===recipient.at.x+6&&a.to.y===recipient.at.y);
  queue(w,recipient,action);queue(w,giver,choose(w,giver,a=>a.type==='personalFoodGift'&&a.operation==='deliver'));
  const meals=[],danger=Object.fromEntries(w.residents.map(r=>[r.id,0]));
  for(let i=0;i<6;i++){
   const observed=stepWorldWithFoodEvidence(w,1);meals.push(...observed.receipts);
   for(const r of w.residents)if(r.status==='alive'&&r.hunger>95)danger[r.id]++;
  }
  const gift=w.personalFoodGifts!.gifts[0];assert.equal(gift.expiresAt,deadline);assert.equal(w.minute,start+6);
  assert.equal(gift.status,mode==='wait'?'delivered':'accepted');assert.equal(recipient.inventory.turnip,mode==='wait'?6:5);
  assert.equal(giver.inventory.turnip,mode==='wait'?4:5);assert.equal(giver.inventory.turnip!+recipient.inventory.turnip!,10);
  assert.equal(meals.length,0,'delivered food is not an automatic meal');
  assert.ok(recipient.hunger>initial.find(r=>r.id===recipient.id)!.hunger,'waiting does not suppress hunger');
  assert.ok(recipient.energy<=initial.find(r=>r.id===recipient.id)!.energy,'waiting is not sleep');
  assert.equal(Boolean(giver.lastFailure),mode==='leave');
  const handoffFinal=body(w);let laterIndependentMeal:unknown=null;
  if(mode==='wait'){
   queue(w,recipient,choose(w,recipient,a=>a.type==='eat'&&a.item==='turnip'));
   const receipts=[];let left=20;while(recipient.plan||recipient.activity){assert.ok(left--);receipts.push(...stepWorldWithFoodEvidence(w,1).receipts);}
   assert.equal(receipts.length,1);assert.equal(receipts[0].residentId,recipient.id);assert.equal(receipts[0].nutrition,20);
   laterIndependentMeal={at:w.minute,receipts,final:body(w)};
   // Five original roots existed: this independent meal cannot identify which lot was eaten.
  }
  reports.push({mode,throughHandoffMinute:start+6,giftStatus:gift.status,donorFailure:giver.lastFailure,danger,initial,final:handoffFinal,laterIndependentMeal});
 }
 t.diagnostic(JSON.stringify({kind:'scripted-choice-demonstration-not-model-effect',seed:5401,reports}));
});

test('handoff notes: waiting cannot interrupt donor old work, extend deadline or guarantee transfer',()=>{
 const {w,giver,recipient,gift}=fixture(),deadline=gift.expiresAt,before=body(w);
 queue(w,giver,choose(w,giver,a=>a.type==='wait',{minutes:120}));
 queue(w,recipient,choose(w,recipient,a=>a.type==='wait',{minutes:6}));
 const donorPlan=structuredClone(giver.plan);
 assert.match(personalFoodGiftNotes(w,recipient),/忙闲、库存和远方变化未知/);
 assert.deepEqual(giver.plan,donorPlan);for(let i=0;i<6;i++)stepWorldWithFoodEvidence(w,1);
 assert.ok(giver.activity);assert.equal(gift.status,'accepted');assert.equal(gift.expiresAt,deadline);
 assert.equal(recipient.inventory.turnip,before.find(p=>p.id===recipient.id)!.inventory.turnip);
 queue(w,recipient,choose(w,recipient,a=>a.type==='personalFoodGift'&&a.operation==='decline'));
 assert.equal(gift.status,'declined');assert.equal(personalFoodGiftNotes(w,recipient),'');assert.ok(giver.activity);
});

test('handoff notes: a known accepted marker without its acceptance receipt never invents a handoff',()=>{
 const {w,recipient,gift}=fixture();gift.acceptedAt=null;
 assert.equal(personalFoodGiftNotes(w,recipient),'');
});

test('handoff notes: actual serialized budget trims general notes first and retains the hard limit',()=>{
 const {w,recipient}=fixture(),context=decisionContext(w,recipient);context.memories=[];context.formal!.familyNotes='';
 context.formal!.opportunities=context.formal!.opportunities.filter(c=>c.action.type!=='social'||c.action.operation!=='interpret');
 const base=prepareModelDecision(context,undefined,DEEPSEEK_MODEL);context.actor.traits.push('x'.repeat(35000-base.inputBytes));
 context.formal!.familyNotes='甲'.repeat(6000);
 const p=prepareModelDecision(context,undefined,DEEPSEEK_MODEL);
 assert.ok(p.inputBytes<=modelLimits[DEEPSEEK_MODEL].inputBytes);assert.ok(p.messages[0].content.includes(context.formal!.personalFoodGiftNotes!));
 assert.match(p.messages[0].content,/家庭等综合记录已省略部分；本人赠粮交接记录未再裁剪/);assert.deepEqual(p.choices,base.choices);
 context.actor.traits.push('x'.repeat(50000));assert.throws(()=>prepareModelDecision(context,undefined,DEEPSEEK_MODEL),/model_context_limit/);
});
