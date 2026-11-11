import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {industryTarget} from '../src/world/industry.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFood,foodValue,advanceFood} from '../src/world/food.js';
import {personalFoodFreshness} from '../src/world/personal-food-freshness.js';
import {personalFoodFreshnessNote,MAX_PERSONAL_FOOD_ITEMS} from '../src/server/personal-food-freshness.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import type {DecisionContext} from '../src/shared/types.js';
import {WorldStore} from '../src/server/store.js';
import {goods,itemKeys} from '../src/shared/items.js';
import {YEAR} from '../src/world/time.js';
import type {FoodLot} from '../src/shared/food.js';

function fixture(){
 const w=createWorld(5401);w.mode='formal';w.minute=480;w.resources=[];
 for(const r of w.residents){r.inventory={};r.bornAt=w.minute-30*YEAR;r.hunger=20;r.energy=r.health=100;r.plan=r.activity=null;}
 const r=w.residents[0];r.inventory={berry:5,turnip:3};initializeFood(w);decisionContext(w,r);
 return {w,r,ledger:w.food!.lots['person:'+r.id]};
}
const prepared=(c:DecisionContext)=>prepareModelDecision(c,undefined,GLM_MODEL);
const lot=(quantity:number,expiresAt:number,definition='food/life@1',producedAt=0):FoodLot=>({quantity,expiresAt,definition,producedAt});

test('freshness independent review: equal coverage with opposite expiry changes only observation, not numbered actions',()=>{
 const {w,r,ledger}=fixture();ledger.berry=[lot(5,540)];ledger.turnip=[lot(3,1080)];
 const ca=decisionContext(w,r),a=prepared(ca);ledger.berry=[lot(5,1080)];ledger.turnip=[lot(3,540)];
 const before=structuredClone(w),cb=decisionContext(w,r),b=prepared(cb);
 assert.equal(ca.formal!.foodCoverage!.days,cb.formal!.foodCoverage!.days);assert.deepEqual(a.choices,b.choices);assert.notDeepEqual(a.messages,b.messages);assert.deepEqual(w,before);
 assert.match(a.messages[0].content,/浆果：持有5份.*第540游戏分钟/);assert.match(b.messages[0].content,/根菜：持有3份.*第540游戏分钟/);
});

test('freshness independent review: fractional old nutrition is summed across physical batches and inventory caps stale lots',()=>{
 const {w,r,ledger}=fixture();r.inventory={berry:1};w.definitions['review/old@1']={id:'review/old',version:1,kind:'life',dependencies:[],data:{nutrition:{berry:4}}};
 w.definitions['review/old@2']={id:'review/old',version:2,kind:'life',dependencies:[],data:{nutrition:{berry:32}}};
 ledger.berry=[lot(.5,600,'review/old@1'),lot(90,900,'review/old@2')];const before=structuredClone(w),row=personalFoodFreshness(w,r).items[0];
 assert.equal(row.quantity,1);assert.deepEqual(row.earliest,{expiresAt:600,quantity:.5,nutrition:2});assert.deepEqual(row.later,{quantity:.5,nutrition:16});assert.equal(foodValue(w,'person:'+r.id,'berry'),18);assert.deepEqual(w,before);
 ledger.berry[1].expiresAt=600;assert.deepEqual(personalFoodFreshness(w,r).items[0].earliest,{expiresAt:600,quantity:1,nutrition:18});
});

test('freshness independent review: expired, invalid, future-produced and untracked quantities remain distinct',()=>{
 const {w,r,ledger}=fixture();r.inventory={berry:5};ledger.berry=[lot(1,480),lot(1,900,'food/life@1',700),lot(1,NaN),lot(1,900)];
 const before=structuredClone(w),row=personalFoodFreshness(w,r).items[0];assert.equal(row.expiredQuantity,1);assert.equal(row.unknownQuantity,3);assert.equal(row.earliest!.quantity,1);assert.deepEqual(w,before);
 delete w.food!.lots['person:'+r.id];const note=personalFoodFreshnessNote(decisionContext(w,r),[]);assert.match(note,/时效未知5份/);assert.equal(w.food!.lots['person:'+r.id],undefined);
});

test('freshness independent review: invalid date between valid batches cannot hide the true earliest date',()=>{
 const {w,r,ledger}=fixture();r.inventory={berry:3};ledger.berry=[lot(1,1000,'food/life@1',0),lot(1,NaN,'food/life@1',1),lot(1,600,'food/life@1',2)];
 const row=personalFoodFreshness(w,r).items[0];assert.equal(row.unknownQuantity,1);assert.equal(row.earliest!.expiresAt,600);assert.equal(row.earliest!.quantity,1);assert.equal(row.later.quantity,1);
});

test('freshness independent review: private, public and unrelated lots cannot affect personal view; missing food state stays missing',()=>{
 const {w,r}=fixture(),before=personalFoodFreshness(w,r);w.food!.lots['person:'+w.residents[1].id]={berry:[lot(999,123456789)]};w.food!.lots['public:commons']={berry:[lot(888,987654321)]};w.residents[1].inventory={berry:999};
 assert.deepEqual(personalFoodFreshness(w,r),before);assert.doesNotMatch(JSON.stringify(before),/123456789|987654321|public:/);
 delete w.food;const snapshot=structuredClone(w),view=personalFoodFreshness(w,r);assert.equal(view.items.reduce((s,r)=>s+r.unknownQuantity,0),8);assert.deepEqual(w,snapshot);
});

test('freshness independent review: note bounds every current eat food under saturation and rejects stale views',()=>{
 const {w,r,ledger}=fixture(),foods=itemKeys.filter(i=>goods[i].food>0);r.inventory={};
 for(const [i,item]of foods.entries()){r.inventory[item]=3;ledger[item]=Array.from({length:300},(_,n)=>lot(.01,1000+i+n));}
 const c=decisionContext(w,r);for(let i=0;i<160;i++)c.formal!.opportunities.push({id:`review.${i}`,label:'Synthetic work',action:{type:'employment',operation:'work',contractId:`review.${i}`}});
 const before=structuredClone(c),p=prepared(c),note=personalFoodFreshnessNote(c,p.choices);
 assert.equal((note.match(/：持有/g)??[]).length,MAX_PERSONAL_FOOD_ITEMS);assert.match(note,new RegExp(`另有${foods.length-MAX_PERSONAL_FOOD_ITEMS}种`));assert.ok(note.length<5000);assert.ok(p.choices.length<=59);
 for(const choice of p.choices)if(choice.action.type==='eat')assert.ok(note.includes(`${goods[choice.action.item].name}：持有`));assert.deepEqual(c,before);
 c.minute++;assert.equal(personalFoodFreshnessNote(c,p.choices),'');c.minute--;c.formal!.personalFoodFreshness!.residentId='another';assert.equal(personalFoodFreshnessNote(c,p.choices),'');
});

test('freshness independent review: observations survive memory-only reload without repairing unknown batches',()=>{
 const {w,r,ledger}=fixture();ledger.berry=[lot(2,900)];delete ledger.turnip;const original=prepared(decisionContext(w,r)),store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(a=>a.id===r.id)!;assert.deepEqual(prepared(decisionContext(loaded,actor)),original);assert.deepEqual(loaded.food,w.food);}finally{store.close();}
});

test('freshness independent review: observation never performs expiry; normal aging still destroys actual stock',()=>{
 const {w,r,ledger}=fixture();ledger.berry=[lot(5,w.minute)];const before=structuredClone(w),row=personalFoodFreshness(w,r).items.find(i=>i.item==='berry')!;assert.equal(row.expiredQuantity,5);assert.deepEqual(w,before);
 advanceFood(w);assert.equal(r.inventory.berry,0);assert.equal(w.food!.spoiled.berry,5);assert.ok(!personalFoodFreshness(w,r).items.some(i=>i.item==='berry'));assert.equal(w.metrics.requests,0);
});


test('freshness independent review: facts survive family-note trimming for each supported prompt model',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);c.formal!.familyNotes='合成家事记录'.repeat(9000);
 for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){
  const p=prepareModelDecision(c,undefined,model),note=personalFoodFreshnessNote(c,p.choices);assert.ok(p.messages[0].content.includes(note));assert.match(note,/浆果：持有5份/);assert.match(note,/根菜：持有3份/);
 }
});

test('freshness independent review: zero old nutrition is retained and invalid nutrition never becomes a positive claim',()=>{
 const {w,r,ledger}=fixture();r.inventory={berry:2};w.definitions['review/zero@1']={id:'review/zero',version:1,kind:'life',dependencies:[],data:{nutrition:{berry:0}}};
 ledger.berry=[lot(1,900,'review/zero@1'),lot(1,900,'food/life@1')];assert.equal(personalFoodFreshness(w,r).items[0].earliest!.nutrition,12);
 w.definitions['review/zero@1'].data.nutrition={berry:-2};assert.equal(personalFoodFreshness(w,r).items[0].earliest!.nutrition,null);
 assert.match(personalFoodFreshnessNote(decisionContext(w,r),[]),/营养未能确认/);
});


test('freshness independent review: nearby frontier barn menus never repair unknown batches, execution validation still can',()=>{
 for(const missing of ['partial','all'] as const){
  const w=createFrontierWorld(5401),r=w.residents[0],barn=w.buildings.find(b=>b.kind==='barn')!;assert.ok(barn);r.at={...barn.door};r.inside=null;r.knownBuildings.push(barn.id);barn.ownerId=r.id;r.bornAt=w.minute-30*YEAR;
  r.inventory={berry:5,turnip:3};initializeFood(w);decisionContext(w,r);
  if(missing==='all')delete w.food;else delete w.food!.lots['person:'+r.id];
  const before=structuredClone(w);industryOpportunities(w,r);assert.deepEqual(w,before);
  for(let i=0;i<3;i++){const p=prepared(decisionContext(w,r));assert.match(p.messages[0].content,/时效未知5份/);assert.match(p.messages[0].content,/时效未知3份/);assert.deepEqual(w,before);}
  const action={type:'industry',operation:'placeAnimal',buildingId:barn.id,kind:'chicken'} as const;
  industryTarget(w,r,{...action},false,w.minute,true);assert.deepEqual(w,before);
  industryTarget(w,r,{...action});assert.ok(w.food!.lots['person:'+r.id].berry!.length,'ordinary execution-side validation retains existing initialization');
 }
});
