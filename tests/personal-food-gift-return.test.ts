import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,decisionChoices,prompt} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {actionLabel} from '../src/client/resident-status.js';
import {walkable} from '../src/world/navigation.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,Resident,World} from '../src/shared/types.js';

const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
const operation=(op:string)=>(a:Action)=>a.type==='personalFoodGift'&&a.operation===op;
function choose(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 const rows=menu(w,r),row=rows.find(c=>predicate(c.action));assert.ok(row,'required numbered choice');
 assert.ok(prompt(decisionContext(w,r),rows).some(m=>m.content.includes(row.id+'. '+row.label)));
 return parseChoice(JSON.stringify({choice:row.id,...fields}),rows).actions[0];
}
function queue(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`gift-return:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择返回原交接点，仍可放弃',actions:[a]});assert.equal(result.ok,true,result.error);}
function finish(w:World,r:Resident){let left=500;while(r.plan||r.activity){assert.ok(left--);stepWorld(w,.25);}assert.equal(r.lastFailure,null);}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);}
function fixture(){
 const w=createFrontierWorld(5401);w.clock.paused=false;
 const [giver,,recipient]=w.residents,home=w.buildings.find(b=>b.id===recipient.homeId)!;
 // Explicit contact staging only. Original nine people, map, food, bodies,
 // property, dates and lots remain untouched. Subsequent motion is real.
 const point=[{x:home.door.x+2,y:home.door.y},{x:home.door.x-2,y:home.door.y},{x:home.door.x,y:home.door.y+2}]
  .find(at=>walkable(w,at)&&walkable(w,{x:(at.x+home.door.x)/2,y:(at.y+home.door.y)/2}));
 assert.ok(point);giver.at={...point};recipient.at={...point};giver.inside=recipient.inside=null;giver.roomAt=recipient.roomAt=null;
 run(w,giver,choose(w,giver,a=>a.type==='personalFoodGift'&&a.operation==='offer'&&a.recipientId===recipient.id&&a.item==='turnip'));
 const gift=w.personalFoodGifts!.gifts.at(-1)!;run(w,recipient,choose(w,recipient,operation('accept')));
 run(w,recipient,choose(w,recipient,a=>a.type==='move'&&a.to.x===home.door.x&&a.to.y===home.door.y));
 return {w,giver,recipient,gift};
}
const physical=(w:World)=>({people:w.residents.map(r=>({id:r.id,inventory:r.inventory,homeId:r.homeId,parents:r.parents,guardians:r.guardianIds,health:r.health})),lots:w.food!.lots});

test('return gap: accepted recipient has a precise voluntary return choice after choosing a different destination',()=>{
 const {w,recipient,gift}=fixture(),rows=menu(w,recipient),before=structuredClone(w);
 assert.match(decisionContext(w,recipient).formal!.personalFoodGiftNotes!,/本人此刻不在原约点/);
 assert.ok(!rows.some(c=>c.action.type==='move'&&c.action.to.x===gift.location.at.x&&c.action.to.y===gift.location.at.y),'ordinary movement does not name this two-cell-offset original point');
 const action=choose(w,recipient,operation('return'));assert.deepEqual(w,before,'context and menu are read-only');
 assert.equal(actionLabel(action),'自主返回赠粮交接点');
 const row=rows.find(c=>operation('return')(c.action))!;
 assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,to:{x:1,y:1}}),rows));
 const stock=structuredClone(physical(w)),terms=structuredClone(gift);queue(w,recipient,action);stepWorld(w,.25);
 assert.notDeepEqual(recipient.at,gift.location.at,'no teleport');finish(w,recipient);
 assert.deepEqual(recipient.at,gift.location.at);assert.equal(recipient.inside,null);assert.deepEqual(physical(w),stock);
 assert.deepEqual(gift,terms,'return changes neither gift status, receipts nor terms');
 assert.equal(menu(w,recipient).some(c=>operation('return')(c.action)),false,'already there: no repeated return');
 assert.ok(menu(w,recipient).some(c=>operation('decline')(c.action)));assert.ok(menu(w,recipient).some(c=>c.action.type==='move'));
 assert.equal(recipient.plan,null);assert.equal(recipient.activity,null,'no automatic waiting');
});

test('return: seed5401 separate return, donor delivery and recipient meal survive mid-route SQLite reload',()=>{
 const f=fixture(),terms=structuredClone(f.gift),original=structuredClone(physical(f.w));
 queue(f.w,f.recipient,choose(f.w,f.recipient,operation('return')));stepWorld(f.w,.25);
 const store=new WorldStore(':memory:');let w:World;try{store.commit(f.w,null);w=store.load(true)!;}finally{store.close();}
 const giver=w.residents.find(r=>r.id===f.giver.id)!,recipient=w.residents.find(r=>r.id===f.recipient.id)!;
 assert.deepEqual(recipient.activity,f.recipient.activity);finish(w,recipient);assert.deepEqual(physical(w),original);
 const gift=w.personalFoodGifts!.gifts.find(g=>g.id===terms.id)!;assert.deepEqual(gift,terms);
 const before=giver.inventory.turnip!+recipient.inventory.turnip!,recipientBefore=recipient.inventory.turnip!;
 run(w,giver,choose(w,giver,operation('deliver')));assert.equal(gift.status,'delivered');assert.equal(recipient.inventory.turnip,recipientBefore+1);
 assert.equal(giver.inventory.turnip!+recipient.inventory.turnip!,before);assert.equal(gift.expiresAt,terms.expiresAt);
 run(w,recipient,choose(w,recipient,a=>a.type==='eat'&&a.item==='turnip'));
 assert.equal(giver.inventory.turnip!+recipient.inventory.turnip!,before-1);assert.equal(w.metrics.requests,0);
});

test('return: equal-clock control leaves every original choice and inactive default world behavior intact',()=>{
 const {w,recipient}=fixture(),context=decisionContext(w,recipient),before=structuredClone(w),legacy=structuredClone(context);
 legacy.formal!.opportunities=legacy.formal!.opportunities.filter(c=>!operation('return')(c.action));
 const semantic=(rows:ReturnType<typeof menu>)=>rows.map(({id,...c})=>JSON.stringify(c)).sort();
 assert.deepEqual(semantic(menu(w,recipient).filter(c=>!operation('return')(c.action))),semantic(decisionChoices(legacy)));
 assert.deepEqual(w,before);
 const untouched=createFrontierWorld(5401);for(const r of untouched.residents)assert.equal(menu(untouched,r).some(c=>operation('return')(c.action)),false);
 const left=structuredClone(w),right=structuredClone(w);for(let i=0;i<20;i++){menu(right,right.residents.find(r=>r.id===recipient.id)!);stepWorld(left,1);stepWorld(right,1);}assert.deepEqual(right,left,'unselected return has no physical effect');
});

test('return: same checkpoint and donor choice can complete a formerly missed handoff, without predicting resident choices',t=>{
 const f=fixture(),start=f.w.minute,reports=[];
 for(const mode of ['return','stay-away'] as const){
  const w=structuredClone(f.w),giver=w.residents.find(r=>r.id===f.giver.id)!,recipient=w.residents.find(r=>r.id===f.recipient.id)!;
  const initial=structuredClone(physical(w)),deadline=f.gift.expiresAt,danger=Object.fromEntries(w.residents.map(r=>[r.id,0]));
  const chosen:Action[]=[];const select=(r:Resident,a:Action)=>{chosen.push(a);queue(w,r,a);};
  select(recipient,mode==='return'?choose(w,recipient,operation('return')):choose(w,recipient,a=>a.type==='wait',{minutes:10}));
  const meals=[];
  for(let i=0;i<40;i++){
   if(i===20)select(giver,choose(w,giver,operation('deliver')));
   const result=stepWorldWithFoodEvidence(w,.25);meals.push(...result.receipts);
   for(const r of w.residents)if(r.status==='alive'&&r.hunger>95)danger[r.id]+=.25;
  }
  const gift=w.personalFoodGifts!.gifts.find(g=>g.id===f.gift.id)!;
  assert.equal(w.minute,start+10);assert.equal(gift.expiresAt,deadline);assert.equal(meals.length,0);
  assert.equal(gift.status,mode==='return'?'delivered':'accepted');
  assert.equal(recipient.inventory.turnip,f.recipient.inventory.turnip!+(mode==='return'?1:0));
  assert.equal(giver.inventory.turnip!+recipient.inventory.turnip!,f.giver.inventory.turnip!+f.recipient.inventory.turnip!);
  assert.equal(Boolean(giver.lastFailure),mode==='stay-away');
  reports.push({mode,seed:5401,start,end:w.minute,chosen,giftStatus:gift.status,donorFailure:giver.lastFailure,meals,danger,initial,
   final:physical(w),bodies:w.residents.map(r=>({id:r.id,hunger:r.hunger,energy:r.energy,health:r.health,status:r.status}))});
 }
 t.diagnostic(JSON.stringify({kind:'explicit-choice-capability-control-not-ai-or-survival-benefit',reports}));
});

test('return: donor old work is never interrupted, and returning alone expires without food',()=>{
 const {w,giver,recipient,gift}=fixture(),original=structuredClone(physical(w)),deadline=gift.expiresAt;
 queue(w,giver,choose(w,giver,a=>a.type==='wait',{minutes:120}));stepWorld(w,.25);
 const activity=structuredClone(giver.activity),due=giver.decisionDue,memories=structuredClone(giver.memories);
 run(w,recipient,choose(w,recipient,operation('return')));
 assert.equal(giver.activity!.planId,activity!.planId);assert.ok(giver.activity!.remaining>110);
 assert.equal(giver.decisionDue,due);assert.deepEqual(giver.memories,memories);
 assert.deepEqual(physical(w),original);assert.equal(gift.status,'accepted');
 stepWorld(w,deadline-w.minute);assert.equal(gift.status,'expired');assert.equal(gift.expiresAt,deadline);
 assert.deepEqual(w.residents.map(r=>r.inventory),original.people.map(r=>r.inventory),'no gift, meal or reserve from a return alone');
});
