import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeSocial} from '../src/world/social-life.js';
import {roomLayout} from '../src/shared/rooms.js';
import {emitEvent} from '../src/world/events.js';
import {YEAR} from '../src/world/time.js';

type Source={resourceId:string;at:{x:number;y:number};observedAt:number};
type Share={type:'shareFoodSource';targetId:string;source:Source;receiptId:string};
type Knowledge={seen:Record<string,Source>;heard:Array<Source&{speakerId:string;speakerName:string;receivedAt:number;eventId:string}>;shared:Array<{receiptId:string;targetId:string;resourceId:string;eventId:string}>};
const knowledge=(r:Resident)=>(r as Resident&{foodSourceKnowledge?:Knowledge}).foodSourceKnowledge;
const shares=(a:Action):a is Action&Share=>(a.type as string)==='shareFoodSource';
const prepare=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
let serial=0;
function fixture(){
 const w=createWorld(5401);w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={width:80,height:80,tiles:Array(6400).fill('grass'),entrance:{x:0,y:0},name:'离线浆果口述'};
 w.residents=w.residents.slice(0,3);w.resources=[{id:'test-berries',kind:'bush',at:{x:20,y:20},amount:9,max:9,regrowthDays:0,lastHarvest:0}];w.buildings=[];w.plots=[];w.graves=[];w.events=[];
 const [a,b,c]=w.residents;
 for(const [i,r] of w.residents.entries())Object.assign(r,{at:i===0?{x:19,y:20}:{x:40+i,y:40},inside:null,roomAt:null,homeId:null,knownResources:[],knownBuildings:[],knownPeople:w.residents.filter(p=>p!==r).map(p=>p.id),inventory:{meal:5,water:5},memories:[],relations:[],plan:null,activity:null,lastFailure:null,bornAt:w.minute-25*YEAR,canDecide:true,canExpress:true,hunger:20,energy:100,health:100});
 initializeRooms(w);initializeIndustry(w);initializeSocial(w);for(const r of w.residents)decisionContext(w,r);
 return {w,a,b,c,source:w.resources[0]};
}
function sleepingRoom(w:World,sleeper:Resident,companion?:Resident){
 const house={...createWorld(5401).buildings[0],id:'sleep-food-test',residents:[sleeper.id,...(companion?[companion.id]:[])],ownerId:sleeper.id};w.buildings=[house];initializeRooms(w);
 const layout=roomLayout(w,house),bed=layout.slots.find(s=>s.kind==='bed')!;assert.ok(bed);
 sleeper.at={...house.door};sleeper.inside=house.id;sleeper.roomAt={...bed.at};sleeper.homeId=house.id;sleeper.energy=20;
 sleeper.activity={planId:'sleep',action:{type:'sleep',minutes:60},startedAt:w.minute,remaining:60,path:[],target:sleeper.at,definition:'action/routine@1'};
 if(companion){companion.at={...house.door};companion.inside=house.id;companion.roomAt={...bed.at};companion.homeId=house.id;}
}
function observed(){const f=fixture();stepWorld(f.w,1);assert.ok(knowledge(f.a)?.seen[f.source.id],'real observation records first-hand proof');f.a.at={x:40,y:40};f.b.at={x:41,y:40};f.c.at={x:40,y:41};return f;}
function selected(w:World,r:Resident,match:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 const p=prepare(w,r),row=p.choices.find(c=>match(c.action));assert.ok(row,'actual final numbered choice exists');assert.match(row.id,/^\d+$/);assert.ok(p.messages.some(m=>m.content.includes(row.id+'. '+row.label)));
 return parseChoice(JSON.stringify({choice:row.id,...fields}),p.choices);
}
function queue(w:World,r:Resident,d:ReturnType<typeof selected>){return submitPlan(w,{id:'food-source-test:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d});}
function finish(w:World,r:Resident){let n=500;while(r.plan||r.activity){assert.ok(n--,'finite completion');stepWorld(w,.25);}}
function choose(w:World,r:Resident,match:(a:Action)=>boolean,fields:Record<string,unknown>={}){const d=selected(w,r,match,fields);assert.equal(queue(w,r,d).ok,true);finish(w,r);assert.equal(r.lastFailure,null);return d;}
function share(w:World,a:Resident,b:Resident){
 // One bounded candidate may rotate among multiple legal listeners.
 for(let n=0;n<24;n++){if(prepare(w,a).choices.some(c=>shares(c.action)&&c.action.targetId===b.id))return choose(w,a,x=>shares(x)&&x.targetId===b.id);w.minute+=30;}
 assert.fail('requested actual listener must rotate into the final menu');
}
const visits=(p:{x:number;y:number})=>(a:Action)=>a.type==='move'&&Math.abs(a.to.x-p.x)+Math.abs(a.to.y-p.y)<=1;
function reject(w:World,r:Resident,d:ReturnType<typeof selected>){const result=queue(w,r,d);if(result.ok){finish(w,r);assert.ok(r.lastFailure,'late invalid choice fails');}}

test('food sources: final numbered share, independent inspect, gather, then eat are four separate physical decisions',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('offline only');});
 const {w,a,b,c,source}=observed(),proof=structuredClone(knowledge(a)!.seen[source.id]),stock=structuredClone(w.residents.map(r=>r.inventory));
 share(w,a,b);assert.deepEqual(w.residents.map(r=>r.inventory),stock);assert.equal(source.amount,9);assert.ok(!b.knownResources.includes(source.id));assert.equal(knowledge(b)?.heard.length,1);assert.equal(knowledge(c)?.heard.length??0,0);
 const heard=knowledge(b)!.heard[0];assert.deepEqual({resourceId:heard.resourceId,at:heard.at,observedAt:heard.observedAt},proof);assert.equal(heard.speakerId,a.id);assert.equal(heard.speakerName,a.name);assert.ok(heard.eventId);assert.ok(heard.receivedAt>=proof.observedAt);
 assert.ok(!prepare(w,b).choices.some(c=>c.action.type==='gather'&&c.action.resourceId===source.id));assert.equal(b.plan,null);
 choose(w,b,visits(proof.at));assert.ok(b.knownResources.includes(source.id));assert.ok(knowledge(b)?.seen[source.id]);assert.deepEqual(b.inventory,stock[1]);assert.equal(source.amount,9);
 choose(w,b,x=>x.type==='gather'&&x.resourceId===source.id);assert.ok((b.inventory.berry??0)>0);const berries=b.inventory.berry!;assert.equal(source.amount,9-berries);
 choose(w,b,x=>x.type==='eat'&&x.item==='berry');assert.ok(b.inventory.berry!<berries);assert.equal(w.metrics.requests,0);
});

for(const change of ['empty','deleted','moved'] as const)test(`food sources: ${change} current resource does not rewrite historical address or create food`,()=>{
 const {w,a,b,source}=observed(),proof=structuredClone(knowledge(a)!.seen[source.id]);
 if(change==='empty')source.amount=0;if(change==='deleted')w.resources=[];if(change==='moved')source.at={x:65,y:65};
 const stock=structuredClone(w.residents.map(r=>r.inventory));share(w,a,b);assert.deepEqual(knowledge(b)!.heard[0].at,proof.at);assert.equal(knowledge(b)!.heard[0].observedAt,proof.observedAt);
 assert.ok(prepare(w,b).choices.some(c=>visits(proof.at)(c.action)));choose(w,b,visits(proof.at));assert.deepEqual(w.residents.map(r=>r.inventory),stock);
 assert.ok(!prepare(w,b).choices.some(c=>c.action.type==='gather'&&c.action.resourceId===source.id));assert.deepEqual(knowledge(a)!.seen[source.id],proof);
});

test('food sources: first actual observation is immutable and old known IDs are not proof',()=>{
 const {w,a,b,source}=fixture();a.at={x:40,y:40};a.knownResources=[source.id];stepWorld(w,1);assert.equal(knowledge(a)?.seen[source.id],undefined);assert.ok(!prepare(w,a).choices.some(c=>shares(c.action)));
 a.at={x:19,y:20};stepWorld(w,1);const first=structuredClone(knowledge(a)?.seen[source.id]);assert.ok(first);w.minute+=30;source.at={x:21,y:20};stepWorld(w,1);assert.deepEqual(knowledge(a)!.seen[source.id],first);assert.equal(knowledge(b)?.seen[source.id],undefined);
});

for(const hidden of ['cliff','far','sleep','inside'] as const)test(`food sources: ${hidden} is not first-hand outdoor observation`,()=>{
 const {w,a,source}=fixture();source.at={x:23,y:20};if(hidden==='cliff')w.map.tiles[20*80+21]='cliff';if(hidden==='far')source.at={x:27,y:20};if(hidden==='sleep')sleepingRoom(w,a);if(hidden==='inside'){a.inside='missing-room';a.roomAt={x:2,y:5};}
 stepWorld(w,.25);assert.equal(knowledge(a)?.seen[source.id],undefined);assert.ok(!prepare(w,a).choices.some(c=>shares(c.action)));
});

test('food sources: hearsay cannot be retransmitted and ordinary free speech never parses food knowledge',()=>{
 const {w,a,b,c,source}=observed();share(w,a,b);assert.ok(!prepare(w,b).choices.some(c=>shares(c.action)));
 const heard=knowledge(b)!.heard[0];const fake={type:'shareFoodSource',targetId:c.id,source:{resourceId:heard.resourceId,at:{...heard.at},observedAt:heard.observedAt},receiptId:'forged-hearsay'} as unknown as Action;
 reject(w,b,{intention:'试图转述',actions:[fake]});assert.equal(knowledge(c)?.heard.length??0,0);
 choose(w,b,x=>x.type==='talk'&&x.targetId===c.id&&x.tone==='neutral',{text:`我听说 ${source.id} 在 20,20，有九份浆果。`});assert.equal(knowledge(c)?.heard.length??0,0);assert.ok(!c.knownResources.includes(source.id));assert.ok(w.events.some(e=>e.speechText?.includes('有九份浆果')));
});

test('food sources: short-memory eviction and SQLite working reload preserve receipts and reject old choice with a new plan ID',()=>{
 const {w,a,b,source}=observed(),old=share(w,a,b);const heard=structuredClone(knowledge(b)!.heard),shared=structuredClone(knowledge(a)!.shared);
 for(let n=0;n<90;n++)emitEvent(w,{kind:'action',actors:[a.id,b.id],place:{...a.at},text:'无关的后来经历 '+n});assert.ok(!b.memories.some(m=>m.eventId===heard[0].eventId));
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!,aa=loaded.residents.find(r=>r.id===a.id)!,bb=loaded.residents.find(r=>r.id===b.id)!;
 assert.deepEqual(knowledge(bb)!.heard,heard);assert.deepEqual(knowledge(aa)!.shared,shared);assert.ok(prepare(loaded,bb).choices.some(c=>visits(heard[0].at)(c.action)));reject(loaded,aa,old);
 assert.deepEqual(knowledge(bb)!.heard,heard);assert.deepEqual(knowledge(aa)!.shared,shared);assert.ok(!bb.knownResources.includes(source.id));
 }finally{store.close();}
});

for(const boundary of ['walked-away','sleep','too-young','no-expression','no-decision','water-barrier','outside','private-room'] as const)test(`food sources: stale share fails at ${boundary} without chasing or transferring anything`,()=>{
 const {w,a,b,c,source}=observed();c.at={x:60,y:60};const old=selected(w,a,x=>shares(x)&&x.targetId===b.id),start={...a.at},stock=structuredClone(w.residents.map(r=>r.inventory));
 assert.equal(queue(w,a,old).ok,true);stepWorld(w,.25);assert.ok(a.plan||a.activity,'one-minute share cannot finish in .25 minute');
 if(boundary==='walked-away')b.at={x:45,y:40};if(boundary==='sleep')sleepingRoom(w,b,a);
 if(boundary==='too-young')b.bornAt=w.minute-5*YEAR;if(boundary==='no-expression')b.canExpress=false;if(boundary==='no-decision')b.canDecide=false;if(boundary==='outside')b.residency='outside';
 if(boundary==='water-barrier'){b.at={x:42,y:40};for(let y=0;y<80;y++)w.map.tiles[y*80+41]='water';}
 if(boundary==='private-room'){const house={...createWorld(5401).buildings[0],id:'private-food-test',residents:[c.id],ownerId:c.id};w.buildings=[house];initializeRooms(w);const entry=roomLayout(w,house).entry;for(const r of [a,b]){r.at={...house.door};r.inside=house.id;r.roomAt={...entry};}}
 finish(w,a);assert.ok(a.lastFailure);if(boundary!=='private-room'&&boundary!=='sleep')assert.deepEqual(a.at,start);assert.equal(knowledge(b)?.heard.length??0,0);assert.equal(knowledge(a)?.shared.length??0,0);assert.deepEqual(w.residents.map(r=>r.inventory),stock);assert.equal(source.amount,9);
});

test('food sources: final menus are read-only, bounded and rotate without removing survival or free-talk choices',()=>{
 const {w,a,b,c,source}=observed();
 // Populate independent real observations, not invented seen records.
 for(let n=0;n<8;n++)w.resources.push({...source,id:'extra-berry-'+n,at:{x:20+n%3,y:21+Math.floor(n/3)}});
 a.at={x:20,y:20};stepWorld(w,1);a.at={x:40,y:40};share(w,a,b);a.at={x:41,y:41};
 const seen=new Set<string>();for(let n=0;n<24;n++){
  w.minute+=30;const before=structuredClone(w);
  for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){const p=prepareModelDecision(decisionContext(w,a),undefined,model),rows=p.choices.filter(c=>shares(c.action));assert.ok(rows.length<=1);for(const row of rows)if(shares(row.action))seen.add(row.action.source.resourceId+':'+row.action.targetId);
   assert.ok(p.choices.length<=80);for(const type of ['eat','wait','move','talk'])assert.ok(p.choices.some(c=>c.action.type===type),type);
  }assert.deepEqual(w,before);
 }assert.ok(seen.size>2,'bounded sharing candidates rotate across actual sources/listeners');assert.equal(knowledge(c)?.heard.length??0,0);
});

test('food sources: six-year-old can share, but completion needs the full one minute without travel',()=>{
 const {w,a,b,c}=observed();c.at={x:60,y:60};a.bornAt=w.minute-6*YEAR;b.bornAt=w.minute-6*YEAR;
 const start={...a.at},d=selected(w,a,x=>shares(x)&&x.targetId===b.id);assert.equal(queue(w,a,d).ok,true);
 for(let n=0;n<3;n++){stepWorld(w,.25);assert.equal(knowledge(b)?.heard.length??0,0);assert.deepEqual(a.at,start);}
 stepWorld(w,.25);assert.equal(knowledge(b)?.heard.length,1);assert.deepEqual(a.at,start);assert.equal(a.lastFailure,null);
});

test('food sources: repeated heard addresses rotate one independent inspection row, with hidden stock absent from prompts',()=>{
 const {w,a,b,c,source}=fixture();c.at={x:60,y:60};for(let n=1;n<=4;n++)w.resources.push({...source,id:'clue-'+n,at:{x:20+n,y:20}});
 stepWorld(w,1);a.at={x:40,y:40};b.at={x:41,y:40};for(let n=0;n<5;n++)share(w,a,b);assert.equal(knowledge(b)!.heard.length,5);
 const seen=new Set<string>();for(let n=0;n<10;n++){
  w.minute+=30;const p=prepare(w,b),rows=p.choices.filter(c=>c.action.type==='move'&&knowledge(b)!.heard.some(h=>visits(h.at)(c.action)));
  assert.equal(rows.length,1);const move=rows[0].action;if(move.type==='move')seen.add(move.to.x+','+move.to.y);
  const stock=w.resources.map(r=>r.amount);w.resources.forEach(r=>r.amount=0);assert.deepEqual(prepare(w,b),p);w.resources.forEach((r,i)=>r.amount=stock[i]);
 }assert.equal(seen.size,5);assert.equal(b.knownResources.length,0);assert.equal(b.plan,null);
});

test('food sources: saturated final context keeps both bounded categories plus survival, refusal and stop',()=>{
 const {w,a,b,c,source}=observed();c.at={x:60,y:60};share(w,a,b);
 // Listener independently sees another patch, so sharing and hearing coexist.
 w.resources.push({...source,id:'own-second-patch',at:{x:60,y:60}});b.at={x:59,y:60};stepWorld(w,1);b.at={x:41,y:40};
 const context=decisionContext(w,b);for(let n=0;n<160;n++){
  context.formal!.opportunities.push({id:'food-crowd-work-'+n,label:'Crowded work '+n,action:{type:'employment',operation:'work',contractId:'work-'+n}});
  context.formal!.opportunities.push({id:'food-crowd-no-'+n,label:'Crowded refusal '+n,action:{type:'respond',proposalId:'no-'+n,accept:false}});
 }
 context.formal!.opportunities.push({id:'care.stop.food-source',label:'Stop current care',action:{type:'health',operation:'cancelRescue',transportId:'synthetic'}});
 const before=structuredClone(context),worldBefore=structuredClone(w);
 for(const model of [GLM_MODEL,QWEN_MODEL,DEEPSEEK_MODEL] as const){const p=prepareModelDecision(context,undefined,model);
  assert.ok(p.choices.length>=56,'actual saturated final menu');assert.ok(p.choices.length<=81,'80 normal rows plus one live stop');
  assert.equal(p.choices.filter(c=>shares(c.action)).length,1);assert.equal(p.choices.filter(c=>visits(source.at)(c.action)).length,1);
  for(const type of ['eat','wait','talk'])assert.ok(p.choices.some(c=>c.action.type===type),type);assert.ok(p.choices.some(c=>c.action.type==='respond'&&!c.action.accept));assert.ok(p.choices.some(c=>c.label==='Stop current care'));
 }assert.deepEqual(context,before);assert.deepEqual(w,worldBefore);
});
