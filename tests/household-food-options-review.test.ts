import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {completeHousehold,householdOpportunities,householdReason,initializeHousehold,isHouseholdFoodOption} from '../src/world/household.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {buildChoices,type ActionChoice} from '../src/server/affordances.js';
import type {HouseholdAction} from '../src/shared/household.js';

function fixture(){
 const w=createFrontierWorld(5401);initializeHousehold(w);
 const [a,b,child]=w.residents,home=w.buildings.find(x=>x.id===a.homeId)!;
 assert.equal(w.residents.length,9);
 assert.equal(completeHousehold(w,a,{type:'household',operation:'create',targetId:b.id,buildingId:home.id,name:'审查共同储物',amount:1,quantity:0}),null);
 b.at={...home.door};
 const p=w.household!.pools.at(-1)!;
 assert.equal(completeHousehold(w,b,{type:'household',operation:'respond',poolId:p.id,accept:true}),null);
 return {w,a,b,child,p};
}

test('review: validate before rotation, fractional stock and a partner credit cannot become own withdrawal',()=>{
 const {w,a,p}=fixture();
 a.inventory={wood:2,berry:.5,meal:2,turnip:2};
 p.credits[0].inventory={berry:.5,meal:2,turnip:2};
 p.credits[1].inventory={bread:4};
 const seen=new Set<string>();
 for(let i=0;i<20;i++){
  w.minute=480+i*30;
  const rows=householdOpportunities(w,a);
  for(const row of rows){
   assert.equal(householdReason(w,a,row.action as HouseholdAction),null);
   if(row.action.type==='household'&&['deposit','withdraw'].includes(row.action.operation)){
    assert.notEqual(row.action.item,'berry');
    assert.notEqual(row.action.item,'bread');
    seen.add(row.action.operation+':'+row.action.item);
   }
  }
 }
 for(const op of ['deposit','withdraw'])for(const item of ['meal','turnip'])assert.ok(seen.has(op+':'+item));
});

test('review: complete pool/recipient/item identities rotate, including later known recipients',()=>{
 const {w,a,p}=fixture();
 a.knownPeople=w.residents.map(x=>x.id);
 for(const r of w.residents){r.at={...p.at};r.inside=null;}
 p.credits[0].inventory={berry:2,turnip:2,meal:2};
 // Synthetic second pool tests selection only, not economic execution or seed survival.
 const second=structuredClone(p);second.id='family-pool:review-second';w.household!.pools.push(second);
 const expected=new Set<string>();
 for(const pool of [p,second])for(const recipient of w.residents)for(const item of ['berry','turnip','meal'] as const){
  const action:HouseholdAction={type:'household',operation:'proposeGift',poolId:pool.id,targetId:recipient.id,amount:0,item,quantity:1,ownPercent:50};
  if(!householdReason(w,a,action))expected.add(`${pool.id}/${recipient.id}/${item}`);
 }
 assert.ok(expected.size>6);
 const seen=new Set<string>();
 for(let i=0;i<expected.size;i++){
  w.minute=480+i*30;
  for(const row of householdOpportunities(w,a))if(row.action.type==='household'&&row.action.operation==='proposeGift'&&isHouseholdFoodOption(row))seen.add(`${row.action.poolId}/${row.action.targetId}/${row.action.item}`);
 }
 assert.deepEqual(seen,expected);
});

const food:ActionChoice={id:'household.deposit.review.turnip',label:'根菜',action:{type:'household',operation:'deposit',poolId:'review',amount:0,item:'turnip',quantity:1}};
function crowded(reflections:number):ActionChoice[]{
 return [...Array.from({length:56-reflections},(_,i)=>({id:'review.move.'+i,label:'移动',action:{type:'move' as const,to:{x:i,y:0}}})),...Array.from({length:reflections},(_,i)=>({id:'review.reflect.'+i,label:'反思',action:{type:'agency' as const,operation:'reflect' as const,focus:'family' as const}}))];
}

test('review: household insertion replaces surplus reflections only, without rotating existing choices',()=>{
 const {w,a}=fixture(),context=decisionContext(w,a),all=crowded(12);
 for(let i=0;i<8;i++){
  context.minute=480+i*30;
  const before=focusedChoices(context,all),after=focusedChoices(context,[...all,food]);
  assert.equal(after.length,56);assert.ok(after.includes(food));
  for(let j=0;j<before.length;j++)if(after[j]!==before[j]){const action=before[j].action;assert.ok(action.type==='agency'&&action.operation==='reflect');}
  assert.ok(after.filter(c=>c.action.type==='agency'&&c.action.operation==='reflect').length>=1);
 }
});

test('review boundary: fully occupied menu with one reflection has no replaceable household food slot',()=>{
 const {w,a}=fixture(),context=decisionContext(w,a),all=crowded(1);
 for(let i=0;i<8;i++){
  context.minute=480+i*30;
  assert.deepEqual(focusedChoices(context,[...all,food]),focusedChoices(context,all));
 }
});

test('review: partner-only food exposes a zero-percent proposal without spending or consenting for anyone',()=>{
 const {w,a,child,p}=fixture();a.knownPeople.push(child.id);child.at={...p.at};child.inside=null;
 p.credits[0].inventory={};p.credits[1].inventory={turnip:2};
 const legal:HouseholdAction={type:'household',operation:'proposeGift',poolId:p.id,targetId:child.id,amount:0,item:'turnip',quantity:1,ownPercent:0};
 assert.equal(householdReason(w,a,legal),null);
 assert.ok(householdReason(w,a,{...legal,ownPercent:50}));
 const before=structuredClone(p),seen:HouseholdAction[]=[];
 for(let i=0;i<12;i++){
  w.minute=480+i*30;
  for(const c of householdOpportunities(w,a))if(c.action.type==='household'&&c.action.operation==='proposeGift'&&c.action.item==='turnip'&&c.action.targetId===child.id)seen.push(c.action);
 }
 assert.ok(seen.length>0,'partner-only stock must yield a modifiable legal proposal');
 for(const action of seen){assert.equal(action.ownPercent,0);assert.equal(householdReason(w,a,action),null);}
 assert.deepEqual(p,before);assert.equal(w.household!.gifts.length,0);
});


test('review: ordinary formal nine-person seed retains root vegetables and all starter foods in the final create menu',()=>{
 const w=createFrontierWorld(5401),a=w.residents[0],seen=new Set<string>();initializeHousehold(w);
 assert.equal(w.residents.length,9);
 for(let i=0;i<12;i++){
  w.minute=480+i*30;
  const context=decisionContext(w,a),choices=decisionChoices(context),all=buildChoices(context);
  const appointments=choices.filter(c=>c.action.type==='socialAppointment');
  assert.ok(choices.filter(c=>c.action.type!=='socialAppointment').length<=56,'the original household menu budget is unchanged');
  assert.ok(appointments.length<=2);
  assert.ok(appointments.every(c=>all.some(source=>source.label===c.label&&JSON.stringify(source.action)===JSON.stringify(c.action))),'only the separately authorized bounded appointment group may be appended');
  for(const c of choices)if(c.action.type==='household'&&c.action.operation==='create'&&c.action.item)seen.add(c.action.item);
 }
 for(const item of ['berry','turnip','meal'])assert.ok(seen.has(item),item);
});

test('review regression: food withdrawal keeps the existing withdrawal control priority under saturation',()=>{
 const {w,a}=fixture(),context=decisionContext(w,a),all=crowded(1);
 const withdraw:ActionChoice={...food,id:'household.withdraw.review.turnip',action:{type:'household',operation:'withdraw',poolId:'review',amount:0,item:'turnip',quantity:1}};
 const material:ActionChoice={...withdraw,id:'household.withdraw.review.wood',action:{...withdraw.action,item:'wood'} as HouseholdAction};
 for(let i=0;i<8;i++){
  context.minute=480+i*30;
  // Same operation, pool and quantity: cash/material withdrawals still pass
  // through the original control-first route rather than spare-slot insertion.
  assert.ok(focusedChoices(context,[...all,material]).includes(material));
  assert.ok(focusedChoices(context,[...all,withdraw]).includes(withdraw),'food withdrawal must not lose the existing control priority');
 }
});
