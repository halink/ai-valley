import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {PrototypeDrawing} from '../src/shared/prototypes.js';
import {parseDrawing} from '../src/shared/designs.js';
import {prototypeSpec} from '../src/shared/prototypes.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {completeDesign,designTarget} from '../src/world/resident-designs.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {buildChoices,parseChoice} from '../src/server/affordances.js';
import {designOpportunities} from '../src/server/design-opportunities.js';
import {WorldStore} from '../src/server/store.js';
import {designsPanel} from '../src/client/designs.js';
import {DAY} from '../src/world/time.js';

const drawing:PrototypeDrawing={kind:'prototype',name:'晴日挂鱼架',purpose:'用自己组合的架子晾干鲜鱼',frame:'wood',mesh:'fiber',cover:'none',processes:['hang','airDry'],batchSize:2,trialMinutes:180};
function fixture(){
 const w=createFrontierWorld();w.clock.paused=false;
 const r=w.residents.find(r=>r.skills.building>=1)!;
 const reader=w.residents.find(p=>p.id!==r.id&&p.bornAt<w.minute-18*112*DAY)!;
 r.inventory={...r.inventory,wood:20,plank:20,fiber:20,cloth:20,fish:20};reader.skills.building=1;
 reader.inventory={...reader.inventory,wood:20,fiber:20,fish:6};
 stepWorld(w,1);return {w,r,reader};
}
let serial=0;
function start(w:World,r:Resident,action:Action){
 assert.deepEqual(submitPlan(w,{id:'prototype-fixture:'+serial++,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离原型试验',actions:[action]}),{ok:true});
}
function finish(w:World,r:Resident){let n=2000;while((r.plan||r.activity)&&n-->0)stepWorld(w,1);assert.ok(n>0);assert.equal(r.lastFailure,null);}
function run(w:World,r:Resident,a:Action){start(w,r,a);finish(w,r);}
function select(w:World,r:Resident,predicate:(a:Action)=>boolean,fields:Record<string,unknown>={},live=false){
 let menu=live?decisionChoices(decisionContext(w,r)):buildChoices(decisionContext(w,r));
 for(let waits=0;live&&!menu.some(c=>predicate(c.action))&&waits<8;waits++){
  assert.ok(buildChoices(decisionContext(w,r)).some(c=>predicate(c.action)),'choice must already be eligible');
  const wait=menu.find(c=>c.action.type==='wait')!;run(w,r,parseChoice(JSON.stringify({choice:wait.id,minutes:30}),menu).actions[0]);
  menu=decisionChoices(decisionContext(w,r));
 }
 const c=menu.find(c=>predicate(c.action));assert.ok(c,menu.map(c=>c.label).join('\n'));
 return parseChoice(JSON.stringify({choice:c.id,...fields}),menu).actions[0];
}
function draw(w:World,r:Resident,d:PrototypeDrawing=drawing,live=false){run(w,r,select(w,r,a=>a.type==='design'&&a.operation==='draw'&&a.kind==='prototype',{drawing:d},live));return w.designs!.records.at(-1)!;}
function assemble(w:World,r:Resident,live=false){run(w,r,select(w,r,a=>a.type==='design'&&a.operation==='assemble',{},live));return w.designs!.prototypes!.at(-1)!;}
function testAction(w:World,r:Resident,live=false){return select(w,r,a=>a.type==='design'&&a.operation==='trial',{},live);}

test('prototype parser admits finite components/processes, not declared output, skill or executable effects',()=>{
 assert.deepEqual(parseDrawing('prototype',drawing),drawing);
 for(const patch of [{output:{driedFish:99}},{processes:['spawn']},{processes:['airDry','hang']},{frame:'gold'},{batchSize:0},{trialMinutes:Infinity},{cover:'cloth'},{frame:['plank']},{mesh:['cloth']},{cover:['none']},{frame:{toString:()=> 'plank'}}])assert.equal(parseDrawing('prototype',{...drawing,...patch}),null);
 assert.equal(prototypeSpec(drawing).capacity,2);
 assert.equal(prototypeSpec({...drawing,frame:'plank',mesh:'cloth'}).capacity,5);
});

test('normal resident menus: design, physical assembly, measured trial, publish, study, reproduce and eat',()=>{
 const {w,r,reader}=fixture();const initial=r.inventory.wood!,d=draw(w,r,drawing,true);
 assert.equal(r.inventory.wood,initial);assert.equal(w.designs?.prototypes,undefined);
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 assert.match(designTarget(w,r,{type:'design',operation:'publish',buildingId:hall.id,designId:d.id}).error??'',/实际|实物/);
 const p=assemble(w,r,true);assert.equal(p.worked,90);assert.equal(p.status,'ready');assert.equal(r.inventory.wood,initial-4);
 const beforeFish=r.inventory.fish!;run(w,r,testAction(w,r,true));
 const t=w.designs!.trials![0];assert.equal(t.status,'succeeded');assert.equal(t.worked,180);assert.ok(t.sunMinutes>=120);
 assert.deepEqual(t.input,{fish:2});assert.deepEqual(t.output,{driedFish:1});assert.equal(r.inventory.fish,beforeFish-2);assert.equal(p.durability,3);
 assert.equal(t.sourceLots.reduce((n,l)=>n+l.quantity,0),2);assert.equal(r.inventory.driedFish,1);
 const rawExpiry=t.sourceLots[0].expiresAt;
 assert.ok(w.food!.lots['person:'+r.id]!.driedFish![0].expiresAt>rawExpiry);
 assert.ok(!buildChoices(decisionContext(w,reader)).some(c=>c.action.type==='design'&&c.action.operation==='assemble'));
 run(w,r,select(w,r,a=>a.type==='design'&&a.operation==='publish',{},true));
 assert.ok(!buildChoices(decisionContext(w,reader)).some(c=>c.action.type==='design'&&c.action.operation==='assemble'));
 run(w,reader,select(w,reader,a=>a.type==='design'&&a.operation==='study',{},true));assert.deepEqual(d.learnedBy,[reader.id]);
 const copy=assemble(w,reader,true);assert.equal(copy.designId,d.id);assert.equal(copy.madeBy,reader.id);assert.equal(copy.ownerId,reader.id);
 // A second physical attempt can fail after daylight ends. Knowledge guarantees the process, not its outcome.
 run(w,reader,testAction(w,reader,true));assert.equal(w.designs!.trials!.length,2);
 run(w,r,select(w,r,a=>a.type==='eat'&&a.item==='driedFish'));assert.equal(r.inventory.driedFish,0);
 const panel=designsPanel(w);assert.match(panel,/组合原型/);assert.match(panel,/实际试用及失败记录/);assert.match(panel,/输入批次/);
 assert.ok(w.events.filter(e=>e.designId===d.id).length>=10);
});

test('assembly commits only at actual workstation, resumes through serialization and spends materials once',()=>{
 const {w,r}=fixture();draw(w,r);run(w,r,{type:'move',to:{...r.at}});const before=r.inventory.wood!;
 const action=select(w,r,a=>a.type==='design'&&a.operation==='assemble');start(w,r,action);
 // The resident must walk from the door back to the real desk before consuming components.
 stepWorld(w,1);assert.equal(w.designs!.prototypes?.length??0,0);assert.equal(r.inventory.wood,before);
 while(!w.designs!.prototypes?.length)stepWorld(w,1);
 const p=w.designs!.prototypes![0];assert.equal(r.inventory.wood,before-4);assert.equal(p.worked,1);
 r.canExpress=false;stepWorld(w,1);assert.match(r.lastFailure??'',/无法/);assert.equal(p.worked,1);
 r.canExpress=true;
 const saved=structuredClone(w);const resumed=saved.residents.find(p=>p.id===r.id)!;
 const a=select(saved,resumed,a=>a.type==='design'&&a.operation==='assemble');assert.equal(a.type==='design'&&a.operation==='assemble'&&a.prototypeId,p.id);
 run(saved,resumed,a);assert.equal(resumed.inventory.wood,before-4);assert.equal(saved.designs!.prototypes![0].worked,90);
 assert.equal(saved.designs!.prototypes!.length,1);
});

test('trial interrupted by loss of use rights retains consumed inputs, real elapsed work and fails stale raw fish on resumption',()=>{
 const {w,r}=fixture();draw(w,r);assemble(w,r);const a=testAction(w,r);
 assert.equal(a.type,'design');if(a.type!=='design'||a.operation!=='trial')return;
 const b=w.buildings.find(b=>b.id===a.buildingId)!;start(w,r,a);
 while(!w.designs!.trials?.length)stepWorld(w,1);
 const t=w.designs!.trials![0],fish=r.inventory.fish!;assert.equal(t.worked,1);
 const owner=b.ownerId,residents=[...b.residents];b.ownerId='unrelated-owner';b.residents=[];stepWorld(w,1);
 assert.match(r.lastFailure??'',/使用权/);assert.equal(t.worked,1);assert.equal(t.status,'working');assert.equal(r.inventory.fish,fish);
 b.ownerId=owner;b.residents=residents;
 // An isolated interrupted state resumes after the original raw-food deadline, without refreshing it.
 w.minute=t.expiresAt;const oldSun=t.sunMinutes;
 run(w,r,testAction(w,r));assert.equal(t.status,'failed');assert.match(t.reason??'',/期限/);assert.equal(r.inventory.driedFish??0,0);assert.ok(t.sunMinutes>=oldSun);
 assert.equal(w.designs!.trials!.length,1);assert.equal(t.expiresAt,Math.min(...t.sourceLots.map(l=>l.expiresAt)));
});

test('rain, overload and insufficient daytime are measured failures with consumed fish, time and wear',()=>{
 for(const variant of ['rain','overload','short'] as const){
  const {w,r}=fixture();draw(w,r,{...drawing,batchSize:variant==='overload'?4:2,trialMinutes:variant==='short'?60:180});const p=assemble(w,r);const fish=r.inventory.fish!;
  if(variant==='rain')w.weather='rain';
  run(w,r,testAction(w,r));const t=w.designs!.trials![0];
  assert.equal(t.status,'failed',variant);assert.equal(r.inventory.driedFish??0,0);assert.equal(r.inventory.fish,fish-(variant==='overload'?4:2));assert.equal(p.durability,variant==='overload'?2:3);
  assert.match(t.reason??'',variant==='rain'?/雨水/:variant==='overload'?/承重/:/不足/);
  if(variant==='rain')assert.equal(t.rainMinutes,180);
  assert.ok(!buildChoices(decisionContext(w,r)).some(c=>c.action.type==='design'&&c.action.operation==='publish'));
 }
});

test('a cloth cover only reduces recorded rain exposure and never manufactures sunshine',()=>{
 const {w,r}=fixture();draw(w,r,{...drawing,cover:'cloth',processes:['hang','shelter','airDry']});assemble(w,r);w.weather='rain';
 run(w,r,testAction(w,r));const t=w.designs!.trials![0];assert.equal(t.rainMinutes,180);assert.equal(t.sunMinutes,0);assert.equal(t.status,'failed');assert.equal(r.inventory.driedFish??0,0);
});

test('abandonment preserves failed work and stock provenance without refunds or duplicate payouts',()=>{
 const {w,r}=fixture();draw(w,r);const p=assemble(w,r);start(w,r,testAction(w,r));while(!w.designs!.trials?.length)stepWorld(w,1);
 r.canExpress=false;stepWorld(w,1);r.canExpress=true;
 const before=structuredClone(r.inventory),a=select(w,r,a=>a.type==='design'&&a.operation==='abandonPrototype');start(w,r,a);
 while(r.activity?.remaining!==1)stepWorld(w,1);
 const activity=r.activity!;stepWorld(w,1);const inventory=structuredClone(r.inventory),events=w.events.length;
 assert.equal(p.status,'discarded');assert.equal(w.designs!.trials![0].status,'abandoned');assert.deepEqual(r.inventory,before);
 r.activity=activity;assert.equal(completeDesign(w,r,activity.action as Extract<Action,{type:'design'}>),null);assert.deepEqual(r.inventory,inventory);assert.equal(w.events.length,events);r.activity=null;
});

test('unskilled, foreign-owner and fabricated-result requests fail, and persisted old designs remain unchanged',()=>{
 const {w,r,reader}=fixture();const a={type:'design' as const,operation:'draw' as const,kind:'prototype' as const,buildingId:r.homeId!,drawing};
 r.skills.building=0;assert.match(designTarget(w,r,a).error??'',/技能/);r.skills.building=1;
 const d=draw(w,r),p=assemble(w,r);
 assert.ok(designTarget(w,reader,{type:'design',operation:'trial',designId:d.id,prototypeId:p.id,buildingId:reader.homeId!,input:'fish'}).error);
 assert.ok(designTarget(w,r,{type:'design',operation:'trial',designId:d.id,prototypeId:p.id,buildingId:r.homeId!,input:'wood'}).error);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!;assert.deepEqual(loaded.designs,w.designs);assert.deepEqual(loaded.food,w.food);}finally{store.close();}
 const old={nextSerial:5,records:[]};w.designs=old;initializeFood(w);assert.deepEqual(w.designs,old);
});


test('unfinished older prototypes stay actionable and older assets rotate instead of disappearing',()=>{
 const {w,r}=fixture(),d=draw(w,r);start(w,r,select(w,r,a=>a.type==='design'&&a.operation==='assemble'));
 while(!w.designs!.prototypes?.length)stepWorld(w,1);
 r.canExpress=false;stepWorld(w,1);r.canExpress=true;
 const original=w.designs!.prototypes![0];
 // Model a save with later drawings and many physical assets, without performing unauthorized work.
 for(let i=0;i<6;i++)w.designs!.records.push({...structuredClone(d),id:'later-design:'+i,name:'后续图纸'+i});
 let menu=designOpportunities(w,r);
 assert.ok(menu.some(c=>c.action.type==='design'&&c.action.operation==='assemble'&&c.action.prototypeId===original.id));
 assert.ok(menu.some(c=>c.action.type==='design'&&c.action.operation==='abandonPrototype'&&c.action.prototypeId===original.id));
 run(w,r,select(w,r,a=>a.type==='design'&&a.operation==='assemble'&&a.prototypeId===original.id));
 for(let i=0;i<6;i++)w.designs!.prototypes!.push({...structuredClone(original),id:'additional-asset:'+i});
 const expected=w.designs!.prototypes!.map(p=>p.id),seen=new Set<string>();
 for(let i=0;i<60;i++){
  menu=designOpportunities(w,r);
  for(const c of menu)if(c.action.type==='design'&&c.action.operation==='trial')seen.add(c.action.prototypeId);
  if(expected.every(id=>seen.has(id)))break;
  run(w,r,{type:'wait',minutes:30});
 }
 assert.deepEqual([...seen].sort(),expected.sort());
});

test('night-only trials cannot publish or produce food, and old food definitions accept new dried-fish lots additively',()=>{
 const {w,r}=fixture();draw(w,r,{...drawing,trialMinutes:60});assemble(w,r);
 w.minute=Math.floor(w.minute/DAY)*DAY+22*60;run(w,r,testAction(w,r));
 const t=w.designs!.trials![0];assert.equal(t.sunMinutes,0);assert.equal(t.nightMinutes,60);assert.equal(t.status,'failed');
 const old=w.definitions['food/life@1'],before=structuredClone(old);
 delete (old.data.days as Record<string,number>).driedFish;
 delete (old.data.nutrition as Record<string,number>).driedFish;
 const legacy=structuredClone(old);r.inventory.driedFish=1;initializeFood(w);
 assert.deepEqual(w.definitions['food/life@1'],legacy);assert.equal(w.food!.lots['person:'+r.id]!.driedFish![0].definition,'food/life/dried-fish@1');
 assert.ok(before.data.days);
});

test('actual covered mixed-weather trial produces only reduced yield, with every available fish species explicitly selectable',()=>{
 const {w,r}=fixture();draw(w,r,{...drawing,cover:'cloth',processes:['hang','shelter','airDry']});assemble(w,r);
 r.inventory.carp=2;r.inventory.cod=2;r.inventory.crucian=2;
 const choices=designOpportunities(w,r).filter(c=>c.action.type==='design'&&c.action.operation==='trial');
 for(const input of ['fish','carp','cod','crucian'])assert.ok(choices.some(c=>c.action.type==='design'&&c.action.operation==='trial'&&c.action.input===input));
 assert.ok(choices.some(c=>c.action.type==='design'&&c.action.operation==='trial'&&c.action.input==='carp'&&c.label.includes('鲜河鲤')));
 const a=select(w,r,a=>a.type==='design'&&a.operation==='trial'&&a.input==='carp');w.weather='rain';start(w,r,a);
 while((w.designs!.trials?.[0]?.worked??0)<60)stepWorld(w,1);
 w.weather='sun';finish(w,r);
 const t=w.designs!.trials![0];assert.equal(t.rainMinutes,60);assert.equal(t.sunMinutes,120);assert.equal(t.status,'succeeded');assert.deepEqual(t.input,{carp:2});assert.deepEqual(t.output,{driedFish:1});assert.equal(r.inventory.carp,0);
});


test('loss of original workspace does not trap all future assembly: unilateral abandonment preserves original material in place',()=>{
 const {w,r}=fixture();const d=draw(w,r);start(w,r,select(w,r,a=>a.type==='design'&&a.operation==='assemble'));
 while(!w.designs!.prototypes?.length)stepWorld(w,1);
 const p=w.designs!.prototypes![0],original=p.buildingId,materials=structuredClone(p.materials),stock=structuredClone(r.inventory);
 const site=w.buildings.find(b=>b.id===original)!;site.condition=0;stepWorld(w,1);assert.match(r.lastFailure??'',/使用权/);
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 if(!r.knownBuildings.includes(hall.id))r.knownBuildings.push(hall.id);
 run(w,r,{type:'move',to:{...hall.door}});
 run(w,r,select(w,r,a=>a.type==='design'&&a.operation==='abandonPrototype'&&a.prototypeId===p.id));
 assert.equal(p.status,'discarded');assert.equal(p.buildingId,original);assert.deepEqual(p.materials,materials);assert.deepEqual(r.inventory,stock);assert.equal(site.condition,0);
 assert.ok(buildChoices(decisionContext(w,r)).some(c=>c.action.type==='design'&&c.action.operation==='assemble'&&c.action.designId===d.id&&!c.action.prototypeId));
});


test('revoked intact trial site permits only its owner to abandon continuation, preserving original-site attribution',()=>{
 const {w,r,reader}=fixture();const d=draw(w,r);const p=assemble(w,r);start(w,r,testAction(w,r));while(!w.designs!.trials?.length)stepWorld(w,1);
 const t=w.designs!.trials![0],original=t.buildingId,source=structuredClone(t.sourceLots),worked=t.worked;
 const b=w.buildings.find(b=>b.id===original)!;b.ownerId='other-owner';b.residents=[];stepWorld(w,1);
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 if(!r.knownBuildings.includes(hall.id))r.knownBuildings.push(hall.id);
 if(!reader.knownBuildings.includes(hall.id))reader.knownBuildings.push(hall.id);
 d.learnedBy.push(reader.id);
 assert.match(designTarget(w,reader,{type:'design',operation:'abandonPrototype',buildingId:hall.id,designId:d.id,prototypeId:p.id}).error??'',/没有这件/);
 run(w,r,{type:'move',to:{...hall.door}});
 run(w,r,select(w,r,a=>a.type==='design'&&a.operation==='abandonPrototype'&&a.prototypeId===p.id));
 assert.equal(t.status,'abandoned');assert.equal(t.buildingId,original);assert.deepEqual(t.sourceLots,source);assert.equal(t.worked,worked);assert.deepEqual(t.output,{});assert.equal(b.condition,100);assert.equal(b.ownerId,'other-owner');
 const event=w.events.find(e=>e.designId===d.id&&e.text.includes('以下为原址记录'));assert.ok(event);assert.ok(event.text.includes(b.name));assert.deepEqual(event.place,hall.door);
});

test('legacy missing-site trial can be abandoned through the normal menu after reload without reconstructing rights or stock',()=>{
 const {w,r,reader}=fixture(),d=draw(w,r),p=assemble(w,r);
 start(w,r,testAction(w,r));while(!w.designs!.trials?.length)stepWorld(w,1);
 r.canExpress=false;stepWorld(w,1);r.canExpress=true;
 const originalTrial=structuredClone(w.designs!.trials![0]),originalAsset=structuredClone(p),original=originalTrial.buildingId;
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 if(!r.knownBuildings.includes(hall.id))r.knownBuildings.push(hall.id);
 if(!reader.knownBuildings.includes(hall.id))reader.knownBuildings.push(hall.id);
 d.learnedBy.push(reader.id);
 run(w,r,{type:'move',to:{...hall.door}});
 // A legacy save retains an interrupted trial but no longer has its referenced building row.
 w.buildings=w.buildings.filter(b=>b.id!==original);
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);const loaded=store.load()!,owner=loaded.residents.find(v=>v.id===r.id)!,other=loaded.residents.find(v=>v.id===reader.id)!;
  const revision=loaded.revision,buildings=structuredClone(loaded.buildings),stock=structuredClone(owner.inventory);
  const missingAction={type:'design' as const,operation:'trial' as const,buildingId:original,designId:d.id,prototypeId:p.id,input:'fish' as const,trialId:originalTrial.id};
  assert.match(designTarget(loaded,owner,missingAction).error??'',/使用权/);
  assert.ok(!buildChoices(decisionContext(loaded,owner)).some(c=>c.action.type==='design'&&c.action.operation==='trial'&&c.action.prototypeId===p.id));
  const wrongOwner={type:'design' as const,operation:'abandonPrototype' as const,buildingId:hall.id,designId:d.id,prototypeId:p.id};
  assert.match(designTarget(loaded,other,wrongOwner).error??'',/没有这件/);
  run(loaded,owner,select(loaded,owner,a=>a.type==='design'&&a.operation==='abandonPrototype'&&a.prototypeId===p.id,{},true));
  const t=loaded.designs!.trials![0],asset=loaded.designs!.prototypes![0];
  assert.equal(t.status,'abandoned');assert.equal(asset.status,'discarded');
  assert.deepEqual({...asset,status:originalAsset.status,durability:originalAsset.durability},originalAsset);
  assert.deepEqual({...t,status:originalTrial.status,endedAt:originalTrial.endedAt,reason:originalTrial.reason,durabilityAfter:originalTrial.durabilityAfter},originalTrial);
  assert.deepEqual(t.output,{});assert.deepEqual(owner.inventory,stock);assert.deepEqual(loaded.buildings,buildings);
  assert.ok(!loaded.buildings.some(b=>b.id===original));
  const event=loaded.events.find(e=>e.designId===d.id&&e.text.includes('以下为原址记录'));assert.ok(event);assert.ok(event.text.includes(original));assert.deepEqual(event.place,hall.door);
  assert.ok(!buildChoices(decisionContext(loaded,owner)).some(c=>c.action.type==='design'&&c.action.operation==='abandonPrototype'&&c.action.prototypeId===p.id));
  store.commit(loaded,revision);const reloaded=store.load()!;
  assert.deepEqual(reloaded.designs,loaded.designs);assert.deepEqual(reloaded.buildings,buildings);
  assert.ok(!reloaded.buildings.some(b=>b.id===original));
 }finally{store.close();}
});
