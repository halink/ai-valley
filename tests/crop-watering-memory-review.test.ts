import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {DAY} from '../src/world/time.js';
import type {ContentDefinition} from '../src/shared/types.js';

function fixture(){
 const w=createWorld();w.clock.paused=false;w.minute=2*DAY+480;w.weather='sun';
 w.map={width:50,height:50,tiles:Array(2500).fill('grass'),entrance:{x:0,y:0},name:'synthetic watering review'};
 w.resources=[];w.buildings=[];w.events=[];
 const [r,witness,remote]=w.residents;
 for(const [i,person] of w.residents.entries())Object.assign(person,{at:i===2?{x:40,y:40}:{x:20+i,y:20},inside:null,roomAt:null,homeId:null,inventory:{water:3,seed:4},hunger:0,energy:100,health:100,plan:null,activity:null,memories:[]});
 const d:ContentDefinition={id:'crop/review-fiber',version:1,kind:'recipe',dependencies:[],data:{name:'旧版纤维作物',growthDays:5,seasons:['spring'],output:'fiber',yield:8}};
 w.definitions[d.id+'@1']=d;w.activeDefinitions[d.id]=d.id+'@1';
 const p={id:'review-field',at:{...r.at},ownerId:r.id,crop:{definition:d.id+'@1',planted:0,growth:1,wateredDay:-1,lastGrowthDay:2}};w.plots=[p];
 const submit=(count=1)=>{const result=submitPlan(w,{id:`watering-review-${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:'action/routine@1',intention:'隔离审查：本人浇水',actions:Array.from({length:count},()=>({type:'water' as const,plotId:p.id}))});assert.equal(result.ok,true,result.error);};
 const events=()=>w.events.filter(e=>e.text.includes('浇了水'));
 return {w,r,witness,remote,d,p,submit,events};
}

test('watering review: bound version names reach only actor and actual witnesses without rewriting old memories',()=>{
 const {w,r,witness,remote,d,p,submit,events}=fixture();
 w.definitions[d.id+'@2']={...d,version:2,data:{...d.data,name:'新版根菜'}};w.activeDefinitions[d.id]=d.id+'@2';
 const old={eventId:'historical-wrong-label',receivedAt:1,source:'self' as const,text:'旧记录为田里的芜菁浇了水。'};r.memories.push(old);
 submit();stepWorld(w,12);assert.equal(events().length,1);const event=events()[0];
 assert.equal(event.text,`${r.name}为田里的旧版纤维作物浇了水。`);
 assert.deepEqual(event.witnesses,[r.id,witness.id]);assert.deepEqual(event.actors,[r.id]);assert.equal(event.kind,'action');
 for(const [person,source] of [[r,'self'],[witness,'witness']] as const){const memory=person.memories.find(m=>m.eventId===event.id)!;assert.equal(memory.text,event.text);assert.equal(memory.source,source);assert.equal(memory.receivedAt,event.at);}
 assert.ok(!remote.memories.some(m=>m.eventId===event.id));assert.deepEqual(r.memories.find(m=>m.eventId===old.eventId),old);
 assert.deepEqual(r.inventory,{water:2,seed:4});assert.equal(p.crop.wateredDay,2);assert.equal(p.crop.growth,1);assert.equal(p.crop.definition,d.id+'@1');
});

test('watering review: completion resolves the current bound crop rather than caching start or active metadata',()=>{
 const {w,r,d,p,submit,events}=fixture();submit();stepWorld(w,1);assert.ok(r.activity);assert.equal(events().length,0);
 w.definitions['crop/replacement@1']={...d,id:'crop/replacement',data:{...d.data,name:'  后栽药草  '}};
 p.crop.definition='crop/replacement@1';stepWorld(w,12);
 assert.equal(events()[0].text,`${r.name}为田里的后栽药草浇了水。`);assert.equal(r.inventory.water,2);
});

test('watering review: malformed or absent names never invent turnips or stringify unknown metadata',()=>{
 for(const name of [undefined,null,0,false,{},[],['芜菁'],'',' \t\n ']){
  const {w,r,d,p,submit,events}=fixture();d.data.name=name;submit();stepWorld(w,12);
  assert.equal(events()[0].text,`${r.name}为田里的作物浇了水。`);assert.equal(r.inventory.water,2);assert.equal(p.crop.wateredDay,2);
 }
 const {w,r,p,submit,events}=fixture();p.crop.definition='crop/missing@999';submit();stepWorld(w,12);
 assert.equal(events()[0].text,`${r.name}为田里的作物浇了水。`);assert.equal(r.inventory.water,2);
});

test('watering review: failed start or changed completion prerequisites produce no watering event or memory',()=>{
 for(const when of ['start','pending'])for(const change of ['water','crop','owner']){
  const {w,r,p,submit,events}=fixture();submit();if(when==='pending'){stepWorld(w,1);assert.ok(r.activity);}
  if(change==='water')r.inventory.water=0;
  if(change==='crop')w.plots[0].crop=null;
  if(change==='owner')p.ownerId='someone-else';
  const water=r.inventory.water;stepWorld(w,12);
  assert.equal(events().length,0,`${when}/${change}`);assert.equal(r.inventory.water,water);assert.ok(r.lastFailure);assert.equal(r.plan,null);
  assert.ok(w.residents.every(person=>!person.memories.some(m=>m.text.includes('浇了水'))));
  if(w.plots[0].crop)assert.equal(w.plots[0].crop.wateredDay,-1);
 }
});

test('watering review: repeated same-day chosen watering preserves existing cost and completion count',()=>{
 const {w,r,p,submit,events}=fixture();submit(2);stepWorld(w,20);
 assert.equal(events().length,2);assert.equal(new Set(events().map(e=>e.id)).size,2);assert.equal(r.inventory.water,1);assert.equal(p.crop.wateredDay,2);assert.equal(p.crop.growth,1);
});
