import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDecision,decisionContext,decisionChoices,callModel,DecisionError,prompt} from '../src/server/decisions.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {completeAgency} from '../src/world/agency.js';
import {createWorld} from '../src/world/seed.js';
test('accepts finite individual plans, rejects unsupported control and invalid quantities',()=>{
 assert.equal(parseDecision('```json\n{"intention":"休息片刻","actions":[{"type":"wait","minutes":30}]}\n```').actions.length,1);
 for(const action of [{type:'give_everybody_food'},{type:'wait',minutes:NaN},{type:'gather',resourceId:'tree',quantity:-1},{type:'talk',targetId:'p',text:'hi',tone:'obey'},{type:'propose',targetId:'p',proposal:'child'}]){
  assert.throws(()=>parseDecision(JSON.stringify({intention:'test',actions:[action]})));
 }
 assert.throws(()=>parseDecision('{"intention":"all", "actions":[]}'));
 assert.throws(()=>parseDecision('{"intention":"all", "action":{"type":"wait","minutes":10}}'));
});
test('model receives observed people/resources rather than hidden global state',()=>{
 const world=createWorld();const a=world.residents[0],b=world.residents[1];
 b.at={x:79,y:63};b.status='dead';a.knownPeople.push(b.id);
 const context=decisionContext(world,a);
 assert.ok(!context.people.some(p=>p.id===b.id));
 assert.ok(context.resources.every(r=>Math.hypot(r.at.x-a.at.x,r.at.y-a.at.y)<=12));
 assert.ok(context.plots.every(p=>p.ownerId===a.id||Math.hypot(p.at.x-a.at.x,p.at.y-a.at.y)<=8));
});

test('nearby people do not reveal unspoken plans or an unobserved death fact',()=>{
 const w=createWorld();const a=w.residents[0],b=w.residents[1];
 b.at={x:a.at.x+8,y:a.at.y};b.intention='秘密计划向远方的人求婚';
 assert.ok(!JSON.stringify(decisionContext(w,a)).includes('秘密计划'));
 b.status='dead';assert.ok(!decisionContext(w,a).people.some(p=>p.id===b.id));
});

test('a caregiver can observe a hungry dependent before having feeding supplies, but cannot read distant hunger',async()=>{
 const {createFormalWorld}=await import('../src/world/formal-seed.js');
 const {YEAR}=await import('../src/world/time.js');
 const w=createFormalWorld(),[parent,,child]=w.residents;
 child.bornAt=w.minute-2*YEAR;child.hunger=92;child.health=68;child.at={...parent.at};child.inside=parent.inside;
 parent.inventory={};parent.pregnancy={otherParentId:w.residents[1].id,conceivedAt:w.minute,dueAt:w.minute+1440,definition:'life/basic@1'};
 const nearby=decisionContext(w,parent);
 assert.match(nearby.formal!.familyNotes!,/有明显饥饿迹象/);
 assert.doesNotMatch(nearby.formal!.familyNotes!,/92\/100|68\/100/);
 assert.match(nearby.formal!.familyNotes!,/正在孕育/);
 child.at={x:parent.at.x+40,y:parent.at.y+20};child.hunger=37;
 const far=decisionContext(w,parent);
 assert.equal(far.formal!.familyNotes!.includes('37/100'),false);
 assert.match(far.formal!.familyNotes!,/不能从登记或亲属关系推断远处情况/);
});

test('own promised shifts remain in model context even when distant and lacking supplies',async()=>{
 const {createFormalWorld}=await import('../src/world/formal-seed.js');
 const {advancePublicDuties}=await import('../src/world/public-duties.js');
 const w=createFormalWorld(),p=w.residents[0];
 advancePublicDuties(w);
 const shift=w.duties!.shifts[0];
 shift.status='booked';shift.workerId=p.id;
 shift.assignments.push({residentId:p.id,acceptedAt:w.minute,arrivedAt:null,leftAt:null});
 p.inventory={};
 p.at={x:20,y:390};
 const c=decisionContext(w,p);
 assert.match(c.formal!.familyNotes!,/自愿认领/);
 assert.match(c.formal!.familyNotes!,/尚待本人报到/);
 assert.match(c.formal!.familyNotes!,/库存还缺/);
});

test('a model goal requires the resident’s own words and the retry explains the missing field',async t=>{
 const w=createFormalWorld(),context=decisionContext(w,w.residents[0]);
 const goal=decisionChoices(context).find(c=>c.action.type==='agency'&&c.action.operation==='reflect')!;
 let reply:{choice:string;text?:string}={choice:goal.id};let message='';
 t.mock.method(globalThis,'fetch',async(_url:string,options:RequestInit)=>{
  message=JSON.parse(String(options.body)).messages[0].content;
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply)}}]});
 });
 let feedback:string|undefined;
 await assert.rejects(callModel('test',context),error=>{
  assert.ok(error instanceof DecisionError);feedback=error.feedback;
  return error.message==='invalid_decision'&&Boolean(feedback?.includes('text'));
 });
 assert.match(message,/写目标或回顾目标，必须返回/);
 const text='我想去河边看看';reply={choice:goal.id,text};
 const result=await callModel('test',context,feedback);
 assert.match(message,/上一份回复未能执行/);
 assert.equal(result.decision.actions[0].type,'agency');
 assert.equal('text' in result.decision.actions[0]&&result.decision.actions[0].text,text);
});

test('formal decision prompts use each person’s own completed rest, and present the same choices in a different order',()=>{
 const w=createFormalWorld(),[actor,peer]=w.residents;
 actor.recentActions=[{type:'sleep',at:w.minute-15,minutes:43,energy:84},{type:'wait',at:w.minute-2,minutes:7,energy:83}];
 peer.recentActions=[{type:'sleep',at:w.minute-12,minutes:41,energy:78}];
 const c=decisionContext(w,actor);c.plots=[];
 const choices=decisionChoices(c);
 // Change only the presentation seed, not into a visible target (self-talk is illegal).
 const another=decisionChoices({...c,actor:{...c.actor,id:'presentation-order-probe'}});
 assert.notDeepEqual(choices.map(c=>c.label),another.map(c=>c.label));
 assert.deepEqual(choices.map(c=>c.label).sort(),another.map(c=>c.label).sort());
 const message=prompt(c,choices)[0].content;
 assert.match(message,/15分钟前睡了43分钟，当时体力84\/100；2分钟前原地停留了7分钟/);
 assert.match(message,/每小时约恢复13\.2点体力/);
 assert.doesNotMatch(message,/睡了41分钟/);
});

test('a resident can change a goal but repeating the existing one cannot consume another world action',async t=>{
 const w=createFormalWorld(),actor=w.residents[0];
 const original={type:'agency' as const,operation:'reflect' as const,focus:'farming' as const,text:'照看自己种下的果树'};
 assert.equal(completeAgency(w,actor,original),null);
 const events=w.events.length;
 assert.match(completeAgency(w,actor,original)!,/已经生效/);
 assert.equal(w.events.length,events);
 assert.equal(actor.agency!.goals.length,1);
 const c=decisionContext(w,actor);
 const option=decisionChoices(c).find(c=>c.action.type==='agency'&&c.action.operation==='reflect'&&c.action.focus==='farming')!;
 let text=original.text;
 t.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({choice:option.id,text})}}]}));
 await assert.rejects(callModel('test',c),e=>e instanceof DecisionError&&Boolean(e.feedback?.includes('已生效')));
 text='观察水渠，再决定是否扩大果园';
 const reply=await callModel('test',c);
 assert.deepEqual(reply.decision.actions,[{...original,text}]);
});
