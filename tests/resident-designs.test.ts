import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {constructionReason} from '../src/world/construction.js';
import {productionParcels} from '../src/world/production.js';
import {distance,findPath,same,walkable} from '../src/world/navigation.js';

function fixture(){
 const store=new WorldStore(':memory:');
 store.commit(createFrontierWorld(),null);
 const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 runtime.world.clock.paused=false;
 return {world:runtime.world,store,runtime};
}
function run(w:World,r:Resident,action:Action){
 const plan={id:'design-fixture:'+w.revision+':'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'验收的隔离决策',actions:[action]};
 assert.deepEqual(submitPlan(w,plan),{ok:true});
 let timeout=1000;
 while((r.plan||r.activity)&&timeout-->0)stepWorld(w,1);
 assert.ok(timeout>0);
 assert.equal(r.lastFailure,null);
}
function choose(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={}){
 const choices=decisionChoices(decisionContext(w,r)),c=choices.find(row=>predicate(row.action));
 assert.ok(c,choices.map(row=>row.label).join('\n'));
 const decision=parseChoice(JSON.stringify({choice:c.id,...fields}),choices);
 run(w,r,decision.actions[0]);
 return decision.actions[0];
}

test('a resident can design, publish and teach a tool from the live menu; only actual fabrication and use change inventory',()=>{
 const {world:w,store,runtime}=fixture(),[author,reader]=w.residents;
 try{
  const prior=store.load()!.revision;
  reader.inventory.plank=4;reader.inventory.bar=2;
  const costBefore=structuredClone(reader.inventory),toolsBefore=w.industry!.tools.length;
  const menu=decisionChoices(decisionContext(w,author)),draft=menu.find(c=>c.action.type==='design'&&c.action.operation==='draw'&&c.action.kind==='tool')!;
  const drawing={name:'紧箍斧',purpose:'更耐用地砍木',tool:'axe',frame:'plank',fitting:'bar',reinforcement:1};
  assert.throws(()=>parseChoice(JSON.stringify({choice:draft.id,drawing:{...drawing,script:'spawn()'}}),menu),/invalid_resident_drawing/);
  assert.throws(()=>parseChoice(JSON.stringify({choice:draft.id,drawing:{...drawing,fitting:'water'}}),menu),/invalid_resident_drawing/);
  run(w,author,parseChoice(JSON.stringify({choice:draft.id,drawing}),menu).actions[0]);
  const d=w.designs!.records[0];assert.equal(d.name,drawing.name);assert.equal(d.publication,null);
  assert.equal(w.industry!.tools.length,toolsBefore);
  const fabricate=(a:Action)=>a.type==='design'&&a.operation==='fabricate'&&a.designId===d.id;
  assert.ok(!decisionChoices(decisionContext(w,reader)).some(c=>fabricate(c.action)));
  choose(w,author,a=>a.type==='design'&&a.operation==='publish'&&a.designId===d.id);
  assert.equal(w.designs!.records[0].publication?.buildingId,'frontier-hall');
  assert.ok(!decisionChoices(decisionContext(w,reader)).some(c=>fabricate(c.action)));
  choose(w,reader,a=>a.type==='design'&&a.operation==='study'&&a.designId===d.id);
  assert.deepEqual(d.learnedBy,[reader.id]);
  const work=choose(w,reader,fabricate);
  const tool=w.industry!.tools.find(t=>t.designId===d.id)!;
  assert.equal(tool.ownerId,reader.id);assert.equal(tool.kind,'axe');assert.equal(tool.level,2);assert.ok(tool.durability>30);
  assert.equal(reader.inventory.plank,costBefore.plank!-4);assert.equal(reader.inventory.bar,costBefore.bar!-2);
  assert.equal(w.industry!.tools.length,toolsBefore+1);
  assert.equal(reader.inside,work.type==='design'&&'buildingId' in work?work.buildingId:undefined);
  run(w,reader,{type:'move',to:{...reader.at}});
  const tree=w.resources.filter(resource=>resource.kind==='tree'&&resource.amount>0)
   .sort((a,b)=>distance(reader.at,a.at)-distance(reader.at,b.at)).find(resource=>findPath(w,reader.at,resource.at,true)!==null);
  assert.ok(tree);
  const path=findPath(w,reader.at,tree.at,true)!;
  if(path.length)run(w,reader,{type:'move',to:path.at(-1)!});
  const durability=tool.durability;
  choose(w,reader,a=>a.type==='gather'&&w.resources.find(resource=>resource.id===a.resourceId)?.kind==='tree');
  assert.equal(tool.durability,durability-1);
  assert.equal(w.events.filter(e=>e.designId===d.id).length,4);
  store.commit(w,prior);
  assert.deepEqual(store.load()!.designs,w.designs);
  assert.deepEqual(store.load()!.industry!.tools.find(t=>t.id===tool.id),tool);
 }finally{runtime.stop();store.close();}
});

test('a model-designed greenhouse follows land, supply and work rules and becomes a functional room',()=>{
 const {world:w,store,runtime}=fixture(),[author,other]=w.residents;
 try{
  author.inventory.wood=60;author.inventory.stone=60;
  choose(w,author,a=>a.type==='design'&&a.operation==='draw'&&a.kind==='building',
   {drawing:{name:'石脚暖屋',purpose:'冬天培育作物',template:'greenhouse',width:4,height:4,roof:'slate',structure:'masonry'}});
  const d=w.designs!.records[0];
  assert.equal(d.spec.kind,'building');
  if(d.spec.kind!=='building')return;
  const definition=d.spec.definition,pre=w.buildings.length;
  assert.deepEqual(w.definitions[definition].data.art,{roof:'slate'});
  assert.equal(w.buildings.length,pre);
  assert.equal(w.construction!.projects.length,0);
  const parcel=productionParcels(w).find(p=>p.ownerId===author.id)!;
  const lot={x:parcel.x+Math.floor(parcel.width/2),y:parcel.y+parcel.height};
  assert.ok(walkable(w,lot));
  choose(w,author,a=>a.type==='move'&&same(a.to,lot));
  assert.match(constructionReason(w,other,{type:'construction',operation:'propose',kind:'greenhouse',scope:'private',
   definition,at:{x:parcel.x,y:parcel.y},wagePerHour:0,prices:{wood:2,stone:2}})??'',/尚未亲自查阅/);
  choose(w,author,a=>a.type==='construction'&&a.operation==='propose'&&a.definition===definition&&a.scope==='private');
  const project=w.construction!.projects[0];
  assert.equal(project.definition,definition);assert.equal(project.width,4);assert.equal(project.height,4);
  assert.equal(w.buildings.length,pre);
  for(const item of ['wood','stone'] as const)
   choose(w,author,a=>a.type==='construction'&&a.operation==='donateMaterials'&&a.projectId===project.id&&a.item===item,{quantity:d.spec.materials[item]});
  let steps=10;
  while(project.status!=='completed'&&steps-->0)
   choose(w,author,a=>a.type==='construction'&&a.operation==='work'&&a.projectId===project.id,{minutes:120});
  assert.equal(project.status,'completed');
  assert.deepEqual(project.incorporated,d.spec.materials);
  const room=w.buildings.find(b=>b.id===project.buildingId)!;
  assert.equal(room.definition,definition);assert.equal(room.kind,'greenhouse');
  assert.equal(w.buildings.length,pre+1);
  const bed=choose(w,author,a=>a.type==='industry'&&a.operation==='plantHouse'&&a.buildingId===room.id);
  assert.ok(w.industry!.beds.some(b=>b.buildingId===room.id&&b.crop?.ownerId===author.id&&bed.type==='industry'&&b.index===bed.bed));
 }finally{runtime.stop();store.close();}
});
