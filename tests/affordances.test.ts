import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildChoices,parseChoice} from '../src/server/affordances.js';
import {decisionContext} from '../src/server/decisions.js';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld} from '../src/world/formal-seed.js';

const context=()=>{const w=createWorld();return decisionContext(w,w.residents[0]);};

test('choices preserve food/rest/social/discovery under a forest full of resource observations',()=>{
 const c=context();c.resources=Array.from({length:200},(_,i)=>({id:`tree-${i}`,kind:'tree' as const,at:{x:20+i%10,y:20},amount:8,max:8,regrowthDays:28,lastHarvest:0}));
 c.people=[{id:'peer',name:'邻居',status:'alive',at:{x:c.actor.at.x+1,y:c.actor.at.y},intention:'自己的事情',relation:null}];
 const before=structuredClone(c),choices=buildChoices(c);assert.ok(choices.length<=32);assert.equal(choices.filter(c=>c.action.type==='gather').length,1);
 for(const type of ['eat','sleep','wait','talk','move'])assert.ok(choices.some(c=>c.action.type===type));
 assert.deepEqual(c,before);assert.equal(new Set(choices.map(c=>c.id)).size,choices.length);
});

test('affordances do not claim unseen fields are ripe or invent food or other people',()=>{
 const c=context();c.actor.inventory={};c.plots=[];c.people=[];c.resources=[];c.offers=[];
 const choices=buildChoices(c);assert.ok(choices.some(c=>c.id.startsWith('move.plot-')));
 assert.equal(choices.some(c=>['eat','plant','water','harvest','gather','talk','accept'].includes(c.action.type)),false);
});

test('only observed own plots and real inventory authorize farming choices',()=>{
 const c=context(),plot={id:'known-plot',at:{...c.actor.at},ownerId:c.actor.id,crop:null};c.plots=[plot];c.actor.inventory={seed:1,water:1};
 assert.ok(buildChoices(c).some(c=>c.action.type==='plant'));
 c.season='winter';assert.equal(buildChoices(c).some(c=>c.action.type==='plant'),false);
 c.plots=[{...plot,crop:{definition:'crop/turnip@1',planted:0,growth:4,wateredDay:0,lastGrowthDay:0}}];
 assert.ok(buildChoices(c).some(c=>c.action.type==='harvest'));
 c.plots[0].ownerId='other';assert.equal(buildChoices(c).some(c=>['plant','water','harvest'].includes(c.action.type)),false);
});

test('returning an actual offered choice cannot inject an arbitrary action or silent fallback',()=>{
 const choices=buildChoices(context()),choice=choices.find(c=>c.action.type==='eat')!;
 const result=parseChoice(JSON.stringify({choice:choice.id,intention:'我想吃点东西'}),choices);
 assert.deepEqual(result.actions,[choice.action]);assert.notEqual(result.actions[0],choice.action);
 for(const raw of ['not-json','{}',JSON.stringify({choice:'invented',intention:'test'}),JSON.stringify({choice:choice.id,intention:'test',actions:[{type:'leave'}]})])assert.throws(()=>parseChoice(raw,choices));
});

test('speech is model-authored and confined to the chosen visible person and tone',()=>{
 const c=context();c.people=[{id:'peer',name:'邻居',status:'alive',at:{x:c.actor.at.x+1,y:c.actor.at.y},intention:'自己的事情',relation:null}];
 const choices=buildChoices(c),choice=choices.find(c=>c.id==='talk.peer.friendly')!;
 assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,intention:'打个招呼'}),choices));
 const d=parseChoice(JSON.stringify({choice:choice.id,intention:'打个招呼',text:'今天过得怎么样？'}),choices);
 assert.deepEqual(d.actions,[{type:'talk',targetId:'peer',tone:'friendly',text:'今天过得怎么样？'}]);assert.equal((choice.action as {text:string}).text,'');
});

test('inventory, beds and bilateral offers are checked without assuming peer consent',()=>{
 const c=context();c.buildings=[];c.actor.inventory={turnip:2,water:1};
 assert.equal(buildChoices(c).some(c=>c.action.type==='sleep'||c.action.type==='cook'),false);
 c.people=[{id:'peer',name:'邻居',status:'alive',at:{x:c.actor.at.x+1,y:c.actor.at.y},intention:'自己的事情',relation:null}];
 c.offers=[{id:'quote',actorId:'peer',targetId:c.actor.id,give:{wood:2},want:{turnip:1},expiresAt:c.minute+10,status:'open',definition:'action/routine@1'}];
 assert.ok(buildChoices(c).some(c=>c.action.type==='accept'));
 c.offers[0].targetId='another';assert.equal(buildChoices(c).some(c=>c.action.type==='accept'),false);
});

test('offer terms must be model authored nonempty real-item quantities and remain a proposal',()=>{
 const c=context();c.people=[{id:'peer',name:'邻居',status:'alive',at:{x:c.actor.at.x+1,y:c.actor.at.y},intention:'自己的事情',relation:null}];
 const choices=buildChoices(c),choice=choices.find(c=>c.id==='offer.peer')!;assert.ok(choice);
 const base={choice:choice.id,intention:'提出交换我的木材与对方的浆果'};
 for(const terms of [{},{give:{},want:{berry:1}},{give:{wood:1},want:{}},{give:{wood:-1},want:{berry:1}},{give:{money:1},want:{berry:1}},{give:{wood:1.5},want:{berry:1}},{give:{wood:1},want:{berry:101}},{give:{wood:1},want:{berry:1},targetId:'other'}])assert.throws(()=>parseChoice(JSON.stringify({...base,...terms}),choices));
 const decision=parseChoice(JSON.stringify({...base,give:{wood:2},want:{berry:1}}),choices);
 assert.deepEqual(decision.actions,[{type:'offer',targetId:'peer',give:{wood:2},want:{berry:1}}]);assert.deepEqual((choice.action as {give:object}).give,{});
 c.offers=[{id:'pending',actorId:c.actor.id,targetId:'peer',give:{wood:2},want:{berry:1},expiresAt:c.minute+60,status:'open',definition:'action/routine@1'}];
 assert.equal(buildChoices(c).some(c=>c.id==='offer.peer'),false);
});

test('numeric model choice is accepted only when its exact string ID was supplied',()=>{
 const choices=buildChoices(context()).map((choice,i)=>({...choice,id:String(i+1)}));
 const result=parseChoice(JSON.stringify({choice:1,intention:'暂时停留'}),choices);assert.deepEqual(result.actions,[choices[0].action]);
 assert.throws(()=>parseChoice(JSON.stringify({choice:1.5,intention:'暂时停留'}),choices));
 assert.throws(()=>parseChoice(JSON.stringify({choice:999,intention:'暂时停留'}),choices));
});


test('optional intention describes the explicit selected action and never supplies a default choice',()=>{
 const choices=buildChoices(context()),selected=choices.find(c=>c.action.type==='gather')!;
 for(const intention of [undefined,'简短中文打算','']){
  const decision=parseChoice(JSON.stringify({choice:selected.id,intention}),choices);
  assert.equal(decision.intention,selected.label);assert.deepEqual(decision.actions,[selected.action]);
 }
 assert.throws(()=>parseChoice(JSON.stringify({intention:'简短中文打算'}),choices));
 assert.throws(()=>parseChoice(JSON.stringify({choice:'not-offered'}),choices));
 assert.throws(()=>parseChoice(JSON.stringify({choice:selected.id,intention:{invented:'reason'}}),choices));
});

test('extraneous non-talk text cannot become an utterance, intent, or a second action',()=>{
 const choices=buildChoices(context()),selected=choices.find(c=>c.action.type==='gather')!;
 const decision=parseChoice(JSON.stringify({choice:selected.id,intention:'简短中文打算',text:'需要木料建造储藏室以确保粮食安全。'}),choices);
 assert.deepEqual(decision,{intention:selected.label,actions:[selected.action]});
 assert.equal(JSON.stringify(decision).includes('储藏室'),false);assert.equal(decision.actions.some(a=>a.type==='talk'),false);
 assert.throws(()=>parseChoice(JSON.stringify({choice:selected.id,text:'ignored',targetId:'injected'}),choices));
});

test('formal residents author their own sleep or wait duration regardless of hour or current energy',()=>{
 const world=createFormalWorld(),actor=world.residents[0];
 world.minute=720;actor.energy=100;
 const choices=buildChoices(decisionContext(world,actor));
 for(const type of ['sleep','wait'] as const){
  const offered=choices.filter(c=>c.action.type===type);
  assert.equal(offered.length,1);
  const choice=offered[0].id;
  for(const minutes of [undefined,0,12.5,721])assert.throws(()=>parseChoice(JSON.stringify({choice,minutes}),choices),/invalid_rest_duration/);
  for(const minutes of [1,22,360,720])assert.deepEqual(parseChoice(JSON.stringify({choice,minutes}),choices).actions,[{type,minutes}]);
 }
});

test('each step of a short resident-authored itinerary must still be a valid offered choice',()=>{
 const world=createFormalWorld();
 const choices=buildChoices(decisionContext(world,world.residents[0]));
 const wait=choices.find(c=>c.action.type==='wait')!,move=choices.find(c=>c.action.type==='move')!;
 const steps=[{choice:wait.id,minutes:9},{choice:move.id}];
 assert.deepEqual(parseChoice(JSON.stringify({steps}),choices,3).actions,[{type:'wait',minutes:9},move.action]);
 assert.throws(()=>parseChoice(JSON.stringify({steps}),choices),/invalid_plan_steps/);
 assert.throws(()=>parseChoice(JSON.stringify({steps:[...steps,...steps]}),choices,3),/invalid_plan_steps/);
 assert.throws(()=>parseChoice(JSON.stringify({steps:[steps[0],{choice:'unknown'}]}),choices,3),/unknown_choice/);
});
