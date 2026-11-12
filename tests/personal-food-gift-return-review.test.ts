import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {roomLayout} from '../src/shared/rooms.js';
import {personalFoodGiftReason,personalFoodGiftTarget} from '../src/world/personal-food-gifts.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:40,height:20,tiles:Array(800).fill('grass'),entrance:{x:0,y:10}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents){Object.assign(r,{at:{x:10,y:10},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-30*YEAR,health:100,energy:100,hunger:0,knownBuildings:[],knownResources:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null});}
 const [giver,recipient,other]=w.residents;giver.inventory={turnip:3,wood:5};initializeFood(w);return {w,giver,recipient,other};
}
function menu(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
function gifts(w:World,r:Resident){return menu(w,r).filter(c=>(c.action as {type:string}).type==='personalFoodGift');}
function choice(w:World,r:Resident,operation:string,fields:Record<string,unknown>={}){const choices=menu(w,r),c=choices.find(c=>{const a=c.action as unknown as Record<string,unknown>;return a.type==='personalFoodGift'&&a.operation===operation&&Object.entries(fields).every(([k,v])=>k==='quantity'||a[k]===v);});assert.ok(c,`missing ${operation} choice for ${r.id}`);return parseChoice(JSON.stringify({choice:c.id,...('quantity' in fields?{quantity:fields.quantity}:{})}),choices).actions[0];}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`personal-gift:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择食物赠与',actions:[a]});}
function finish(w:World,r:Resident){let n=800;while(r.plan||r.activity){assert.ok(n--,'action must terminate');stepWorld(w,.25);}}
function rejected(w:World,r:Resident,a:Action){const result=queue(w,r,a);if(result.ok){finish(w,r);assert.ok(r.lastFailure,'invalid action must fail at execution');}}
function run(w:World,r:Resident,a:Action){const result=queue(w,r,a);assert.equal(result.ok,true,JSON.stringify(result));finish(w,r);assert.equal(r.lastFailure,null);}

function record(w:World){return w.personalFoodGifts!.gifts.at(-1)!;}
function offered(f:ReturnType<typeof fixture>,quantity=1){run(f.w,f.giver,choice(f.w,f.giver,'offer',{recipientId:f.recipient.id,item:'turnip',quantity}));return record(f.w);}
function accepted(f:ReturnType<typeof fixture>,quantity=1){const g=offered(f,quantity);run(f.w,f.recipient,choice(f.w,f.recipient,'accept',{giftId:g.id}));return g;}



const isReturn=(a:Action)=>a.type==='personalFoodGift'&&a.operation==='return';
function away(f:ReturnType<typeof fixture>){const g=accepted(f);f.recipient.at={x:14,y:10};return g;}
function roomFixture(){
 const f=fixture(),template=structuredClone(createWorld().buildings[0]);
 const b={...template,id:'return-home',kind:'home' as const,at:{x:8,y:5},door:{x:10,y:10},width:4,height:4,capacity:4,condition:100,ownerId:f.recipient.id,residents:[f.recipient.id,f.giver.id]};
 f.w.buildings=[b];f.w.rooms={tick:-1,claims:[],beds:{}};
 const origin={...roomLayout(f.w,b).entry,x:roomLayout(f.w,b).entry.x+2};
 for(const p of [f.giver,f.recipient]){p.at={...b.door};p.inside=b.id;p.roomAt={...origin};}
 const g=accepted(f);return {...f,b,g,origin};
}
function completionCount(w:World){return w.events.filter(e=>e.kind==='action'&&e.text.includes('自行返回本人已接受赠粮')).length;}

test('return review: exact indoor point, including departure from another owned room',()=>{
 for(const otherRoom of [false,true]){
  const f=roomFixture(),{w,recipient,b,g,origin}=f;
  if(otherRoom){const second={...structuredClone(b),id:'second-home',at:{x:15,y:5},door:{x:17,y:10}};w.buildings.push(second);recipient.at={...second.door};recipient.inside=second.id;recipient.roomAt={...roomLayout(w,second).entry,x:roomLayout(w,second).entry.x+1};}
  else recipient.roomAt={...roomLayout(w,b).entry};
  const before=structuredClone(g),a=choice(w,recipient,'return');assert.equal(queue(w,recipient,a).ok,true);stepWorld(w,.25);
  assert.notDeepEqual(recipient.roomAt,origin);finish(w,recipient);assert.equal(recipient.lastFailure,null);assert.equal(recipient.inside,b.id);assert.deepEqual(recipient.roomAt,origin);assert.deepEqual(g,before);assert.equal(completionCount(w),1);
 }
});

test('return review: outdoor road invalidation and final quarter-minute capacity loss stop completion',()=>{
 for(const mode of ['road','capacity','expiry']){
  const f=fixture(),g=away(f),{w,recipient}=f;assert.equal(queue(w,recipient,choice(w,recipient,'return')).ok,true);stepWorld(w,.25);
  if(mode==='road'){const next=recipient.activity!.path[0];w.map.tiles[next.y*w.map.width+next.x]='water';}
  else {let n=100;while((recipient.activity?.remaining??0)>.25||recipient.activity?.path.length){assert.ok(n--);stepWorld(w,.25);}if(mode==='capacity')recipient.canExpress=false;else w.minute=g.expiresAt-.25;}
  finish(w,recipient);assert.ok(recipient.lastFailure,mode);assert.equal(completionCount(w),0,mode);assert.equal(recipient.inventory.turnip??0,0);assert.notEqual(g.status,'delivered');
 }
});

test('return review: indoor permission, door and path loss are rechecked after commitment',()=>{
 for(const mode of ['permission','door','path','final-permission']){
  const f=roomFixture(),{w,recipient,b,other}=f;recipient.roomAt={...roomLayout(w,b).entry};assert.equal(queue(w,recipient,choice(w,recipient,'return')).ok,true);stepWorld(w,.25);
  if(mode==='final-permission'){let n=100;while((recipient.activity?.remaining??0)>.25||recipient.activity?.room?.path.length){assert.ok(n--);stepWorld(w,.25);}}
  if(mode==='permission'||mode==='final-permission'){b.ownerId=other.id;b.residents=[];}else if(mode==='door')b.door.x++;else {other.status='dead';other.inside=b.id;other.roomAt={...recipient.activity!.room!.path[0]};other.body={storedAt:b.id} as typeof other.body;}
  finish(w,recipient);assert.ok(recipient.lastFailure,mode);assert.equal(completionCount(w),0,mode);
 }
});

test('return review: donor remote withdrawal or death changes neither return choice nor remembered terms',()=>{
 for(const mode of ['cancel','death']){
  const f=fixture(),g=away(f),{w,giver,recipient}=f;giver.at={x:30,y:10};const rows=menu(w,recipient).filter(c=>isReturn(c.action));
  if(mode==='cancel')run(w,giver,choice(w,giver,'cancel'));else giver.status='dead';
  assert.deepEqual(menu(w,recipient).filter(c=>isReturn(c.action)),rows);const before=structuredClone(g),donorMemory=structuredClone(giver.memories),due=giver.decisionDue;
  run(w,recipient,choice(w,recipient,'return'));assert.deepEqual(g,before);assert.deepEqual(giver.memories,donorMemory);assert.equal(giver.decisionDue,due);assert.equal(g.knownStatus[recipient.id],'accepted');
  const event=w.events.find(e=>e.kind==='action'&&e.text.includes('自行返回本人已接受赠粮'))!;assert.deepEqual(event.actors,[recipient.id]);assert.deepEqual(event.witnesses,[recipient.id]);assert.equal(recipient.inventory.turnip??0,0);
 }
});

test('return review: six-year-old accepted recipient may return; wrong party, unknown age and injected destination fail',()=>{
 const f=fixture();f.recipient.bornAt=f.w.minute-6*YEAR;const g=away(f),a=choice(f.w,f.recipient,'return');
 assert.equal(personalFoodGiftTarget(f.w,f.recipient,a as any).adjacent,false);
 assert.ok(personalFoodGiftReason(f.w,f.giver,a as any));assert.ok(personalFoodGiftReason(f.w,f.other,a as any));assert.ok(personalFoodGiftReason(f.w,f.recipient,{...a,to:{x:1,y:1}} as any));
 const birth=f.recipient.bornAt;f.recipient.bornAt=NaN;assert.ok(personalFoodGiftReason(f.w,f.recipient,a as any));f.recipient.bornAt=birth;
 run(f.w,f.recipient,a);assert.deepEqual(f.recipient.at,g.location.at);assert.equal(g.status,'accepted');
});

test('return review: saturated agenda preserves all previous options and adds only one bounded return',()=>{
 const f=fixture();away(f);const context=decisionContext(f.w,f.recipient);
 for(let i=0;i<180;i++)context.formal!.opportunities.push({id:'review-reflect.'+i,label:'review reflection '+i,action:{type:'agency',operation:'reflect'} as Action});
 const legacy=structuredClone(context);legacy.formal!.opportunities=legacy.formal!.opportunities.filter(c=>!isReturn(c.action));
 const semantic=(rows:ReturnType<typeof menu>)=>rows.map(({id,...c})=>JSON.stringify(c)).sort();const before=decisionChoices(legacy),after=decisionChoices(context);
 assert.ok(before.length>=50,'fixture fills agenda');assert.deepEqual(semantic(after.filter(c=>!isReturn(c.action))),semantic(before));assert.equal(after.filter(c=>isReturn(c.action)).length,1);
});

test('return review: arrival beside donor does not notify, wake or restart their chosen waiting',()=>{
 const f=fixture(),g=away(f),{w,giver,recipient}=f;
 run(w,recipient,choice(w,recipient,'return'));
 const event=w.events.find(e=>e.kind==='action'&&e.text.includes('自行返回本人已接受赠粮'))!;
 assert.deepEqual(event.witnesses,[recipient.id]);assert.equal(giver.memories.some(m=>m.eventId===event.id),false);
 recipient.at={x:14,y:10};assert.equal(queue(w,giver,{type:'wait',minutes:60}).ok,true);stepWorld(w,.25);
 const originalAction=structuredClone(giver.activity!.action),due=giver.decisionDue,memories=structuredClone(giver.memories),terms=structuredClone(g);
 run(w,recipient,choice(w,recipient,'return'));
 assert.deepEqual(giver.activity!.action,originalAction);assert.ok(giver.activity!.remaining>40);assert.equal(giver.decisionDue,due);assert.deepEqual(giver.memories,memories);assert.deepEqual(g,terms);
});

for(const change of ['condition','ownership','door'] as const)test(`return review: distant original-room ${change} cannot disclose itself by removing the remembered return choice`,()=>{
 const f=roomFixture();f.recipient.at={x:30,y:10};f.recipient.inside=null;f.recipient.roomAt=null;
 const remembered=menu(f.w,f.recipient).filter(c=>isReturn(c.action));assert.equal(remembered.length,1);
 const w=structuredClone(f.w),recipient=w.residents.find(r=>r.id===f.recipient.id)!,b=w.buildings.find(b=>b.id===f.b.id)!;
 if(change==='condition')b.condition=0;
 else if(change==='ownership'){b.ownerId=f.other.id;b.residents=[];}
 else b.door.x++;
 assert.deepEqual(menu(w,recipient).filter(c=>isReturn(c.action)),remembered,'remote destination facts must not change the witnessed-address menu');
 const gift=structuredClone(w.personalFoodGifts!.gifts[0]),at={...recipient.at};
 rejected(w,recipient,remembered[0].action);
 assert.deepEqual(recipient.at,at,'execution must reject stale destination authority before moving');
 assert.deepEqual(w.personalFoodGifts!.gifts[0],gift);assert.equal(completionCount(w),0);
});

test('return review: three stable accepted addresses rotate one complete identity without additional rows',()=>{
 const f=fixture();for(let i=0;i<3;i++)accepted(f);f.recipient.at={x:14,y:10};
 const ids=f.w.personalFoodGifts!.gifts.map(g=>g.id).sort((a,b)=>('personalFoodGift.return.'+a).localeCompare('personalFoodGift.return.'+b));
 const observed=[];for(const minute of [630,660,690]){f.w.minute=minute;const rows=menu(f.w,f.recipient).filter(c=>isReturn(c.action));assert.equal(rows.length,1);const a=rows[0].action;assert.ok(a.type==='personalFoodGift'&&a.operation==='return');assert.equal(a.giftId,ids[Math.floor(minute/30)%ids.length]);observed.push(a.giftId);}
 assert.equal(new Set(observed).size,3);
});

test('return review: recipient independently withdrawing during a busy return immediately stops that return',()=>{
 const f=fixture(),g=away(f),{w,recipient}=f;assert.equal(queue(w,recipient,choice(w,recipient,'return')).ok,true);stepWorld(w,.25);assert.ok(recipient.activity);assert.notDeepEqual(recipient.at,g.location.at);
 const at={...recipient.at};assert.equal(queue(w,recipient,choice(w,recipient,'decline')).ok,true);
 assert.equal(g.status,'declined');assert.equal(g.knownStatus[recipient.id],'declined');assert.equal(recipient.activity,null);assert.equal(recipient.plan,null);
 stepWorld(w,.25);assert.deepEqual(recipient.at,at);assert.equal(completionCount(w),0);assert.equal(menu(w,recipient).some(c=>isReturn(c.action)),false);
});
