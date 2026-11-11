import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {decisionContext,decisionChoices,prepareModelDecision} from '../src/server/decisions.js';
import {buildChoices,parseChoice,type ActionChoice} from '../src/server/affordances.js';
import {focusedChoices} from '../src/server/agency-opportunities.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {focusNames} from '../src/shared/agency.js';
import type {DecisionContext} from '../src/shared/types.js';
import {YEAR} from '../src/world/time.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';

function fixture(){
 const w=createWorld(),r=w.residents[0];w.mode='formal';w.minute=480;w.weather='sun';w.clock.paused=false;
 w.map={width:60,height:60,tiles:Array(3600).fill('grass'),entrance:{x:0,y:0},name:'Synthetic known-field review'};
 w.residents=[r];w.resources=[];w.buildings=[];w.graves=[];w.events=[];w.offers=[];w.proposals=[];
 Object.assign(r,{at:{x:5,y:20},inside:null,roomAt:null,homeId:null,inventory:{water:2,meal:2},knownBuildings:[],knownResources:[],knownPeople:[],memories:[],hunger:20,energy:100,health:100,plan:null,activity:null,agency:undefined,bornAt:w.minute-30*YEAR});
 w.plots=Array.from({length:4},(_,i)=>({id:`known-field-${i}`,at:{x:20+i*3,y:20},ownerId:r.id,crop:{definition:'crop/turnip@1',planted:0,growth:1,wateredDay:-1,lastGrowthDay:0}}));
 return {w,r};
}
const fieldRows=(c:DecisionContext,rows:ActionChoice[])=>rows.filter(row=>row.action.type==='move'&&c.knownLand.some(p=>p.at.x===(row.action as Extract<typeof row.action,{type:'move'}>).to.x&&p.at.y===(row.action as Extract<typeof row.action,{type:'move'}>).to.y));
function crowd(c:DecisionContext){
 c.formal!.opportunities.push(...Array.from({length:80},(_,i):ActionChoice=>({id:`review-draw-${i}`,label:`Synthetic drawing ${i}`,action:{type:'design',operation:'draw',kind:'building',buildingId:String(i)}})));
 c.formal!.frontier=true;
}

test('known fields rotate through every owned address, once per window and independent of source order',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r),seen=new Set<string>();
 for(let i=0;i<c.knownLand.length;i++){
  c.minute=480+30*i;const before=structuredClone(c),rows=fieldRows(c,buildChoices(c));assert.equal(rows.length,1);
  seen.add(JSON.stringify(rows[0].action));
  const shuffled=structuredClone(c);shuffled.knownLand.reverse();shuffled.minute+=29.99;
  assert.deepEqual(fieldRows(shuffled,buildChoices(shuffled)),rows);assert.deepEqual(c,before);
 }
 assert.equal(seen.size,c.knownLand.length,'the nearest field must not starve the other owned addresses');
});

test('a saturated final menu exposes the selected field under every focus without displacing existing choices',()=>{
 const {w,r}=fixture(),original=decisionContext(w,r);crowd(original);
 for(const focus of [null,...Object.keys(focusNames)] as Array<keyof typeof focusNames|null>){
  const c=structuredClone(original);c.actor.agency=focus?{focus,goals:[],routines:[],nextSerial:1}:undefined;
  const seen=new Set<string>();
  for(let i=0;i<c.knownLand.length;i++){
   c.minute=480+30*i;const all=buildChoices(c),source=fieldRows(c,all);assert.equal(source.length,1);
   const baseline=focusedChoices(c,all.filter(row=>!source.includes(row))),after=focusedChoices(c,all);
   assert.equal(baseline.length,56);assert.equal(after.length,57,'complete saturation permits only one added field choice');
   assert.deepEqual(after.slice(0,56),baseline,'survival, emergency, refusal and all other ordinary rows keep their places');
   assert.ok(after.includes(source[0]));
   const ready=prepareModelDecision(c,undefined,GLM_MODEL),row=fieldRows(c,ready.choices)[0];assert.ok(row,`missing field for ${focus}`);
   assert.deepEqual(ready.choices.map(row=>row.id),ready.choices.map((_,i)=>String(i+1)));
   assert.ok(ready.messages[0].content.includes(row.id+'. '+row.label));
   assert.deepEqual(parseChoice(JSON.stringify({choice:row.id}),ready.choices).actions,[row.action]);seen.add(JSON.stringify(row.action));
  }
  assert.equal(seen.size,c.knownLand.length,`fair final exposure under ${focus}`);
 }
});

test('field restoration cannot revive age, capacity or journey-ineligible actions',()=>{
 const {w,r}=fixture(),original=decisionContext(w,r);assert.equal(fieldRows(original,decisionChoices(original)).length,1);
 for(const flag of ['careWithdrawalOnly','expressiveEvacuationOnly','aboard','passenger','familyTravelling'] as const){
  const c=structuredClone(original);c.formal![flag]=true;assert.equal(fieldRows(c,decisionChoices(c)).length,0,flag);
 }
 for(const age of [0,5]){const c=structuredClone(original);c.formal!.age=age;assert.equal(fieldRows(c,decisionChoices(c)).length,0);}
 const child=structuredClone(original);child.formal!.age=6;assert.equal(fieldRows(child,decisionChoices(child)).length,1,'existing six-year-old movement permission is unchanged');
 const unknown=structuredClone(original);unknown.formal!.knownAge=null;unknown.formal!.unknownAgeSelfCare=[];assert.equal(fieldRows(unknown,decisionChoices(unknown)).length,0);
 for(const flag of ['canDecide','canExpress'] as const){r[flag]=false;const c=decisionContext(w,r);assert.ok(!decisionChoices(c).some(row=>row.label.includes('已知的田地')),flag);r[flag]=true;}
});

test('field eligibility is recomputed for present position, title changes and invalid remembered coordinates',()=>{
 const {w,r}=fixture();r.at={...w.plots[0].at};w.plots[1].ownerId='other';w.plots[2].at={x:-1,y:20};
 const c=decisionContext(w,r);c.knownLand.push({id:'invalid-fraction',at:{x:2.5,y:3}},{id:'invalid-bounds',at:{x:60,y:20}});
 for(let i=0;i<6;i++){
  c.minute=480+30*i;const rows=fieldRows(c,decisionChoices(c));assert.equal(rows.length,1);assert.deepEqual(rows[0].action,{type:'move',to:w.plots[3].at});
 }
 w.plots[3].ownerId='other';const removed=decisionContext(w,r);assert.equal(fieldRows(removed,decisionChoices(removed)).length,0);
 r.at={x:5,y:20};w.plots[1].ownerId=r.id;const restored=decisionContext(w,r),seen=new Set<string>();
 for(let i=0;i<2;i++){restored.minute=480+i*30;fieldRows(restored,decisionChoices(restored)).forEach(row=>seen.add(JSON.stringify(row.action)));}
 assert.equal(seen.size,2,'new ownership and leaving a current field re-enter the eligible cycle');
});

test('remote crop and blocked-route changes cannot choose a field or leak into the prepared input',()=>{
 const {w,r}=fixture(),before=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
 assert.ok(!before.choices.some(row=>['water','plant','harvest'].includes(row.action.type)));
 for(const p of w.plots){p.crop!.growth=9;p.crop!.wateredDay=0;w.map.tiles[p.at.y*60+p.at.x]='cliff';}
 const after=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
 assert.deepEqual(after,before,'known address, not hidden growth, water status or path success, selects the destination');
 assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(w.metrics.requests,0);
});

test('numbered field navigation physically arrives before a separately selected watering action',()=>{
 const {w,r}=fixture();w.plots=w.plots.slice(0,1);const plot=w.plots[0],c=decisionContext(w,r);crowd(c);
 const ready=prepareModelDecision(c,undefined,GLM_MODEL),row=fieldRows(c,ready.choices)[0];assert.ok(row);
 assert.ok(!ready.choices.some(row=>row.action.type==='water'));const start={...r.at};
 const selected=parseChoice(JSON.stringify({choice:row.id}),ready.choices);
 const submit=(id:string,actions:typeof selected.actions)=>submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Explicit synthetic field test',actions});
 assert.equal(submit('field-walk',selected.actions).ok,true);assert.deepEqual(r.at,start);assert.equal(plot.crop!.wateredDay,-1);
 stepWorld(w,.25);assert.notDeepEqual(r.at,plot.at);assert.equal(plot.crop!.wateredDay,-1);
 for(let i=0;i<100&&(r.plan||r.activity);i++)stepWorld(w,1);
 assert.deepEqual(r.at,plot.at);assert.equal(r.lastFailure,null);assert.equal(plot.crop!.wateredDay,-1);assert.equal(r.inventory.water,2);
 const arrival=prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL),water=arrival.choices.find(row=>row.action.type==='water'&&row.action.plotId===plot.id);assert.ok(water);
 assert.equal(submit('field-water',parseChoice(JSON.stringify({choice:water.id}),arrival.choices).actions).ok,true);
 for(let i=0;i<40&&(r.plan||r.activity);i++)stepWorld(w,1);
 assert.equal(plot.crop!.wateredDay,Math.floor(w.minute/1440));assert.equal(r.inventory.water,1);assert.equal(r.lastFailure,null);assert.equal(w.metrics.requests,0);
});


test('fully stacked ordinary extensions have an exact 84-row synthetic upper-bound fixture',()=>{
 const {w,r}=fixture(),c=decisionContext(w,r);c.formal!.opportunities=[];crowd(c);
 c.people=Array.from({length:3},(_,i)=>({id:'visible-peer-'+i,name:'Synthetic peer '+i,status:'alive',at:{x:6+i,y:20},intention:'',relation:null}));
 c.formal!.opportunities.push(
  ...Array.from({length:2},(_,i):ActionChoice=>({id:'waterSource.bound.'+i,label:'Known water '+i,action:{type:'move',to:{x:40+i,y:20}}})),
  {id:'cook.bound',label:'Synthetic kitchen',action:{type:'cook',quantity:1}},
  {id:'production.plantCrop.bound',label:'Synthetic legal crop',action:{type:'production',operation:'plantCrop',plotId:'visible-field',cropId:'crop/turnip@1'}},
  ...Array.from({length:10},(_,i):ActionChoice=>({id:'interpret.bound.'+i,label:'Synthetic interpretation '+i,action:{type:'social',operation:'interpret',eventId:'event-'+Math.floor(i/2),targetId:'peer-'+i%2}})),
  ...Array.from({length:2},(_,i):ActionChoice=>({id:'foodSource.heard.bound.'+i,label:'Synthetic historical clue '+i,action:{type:'move',to:{x:45+i,y:20}}})),
  ...(['accept','decline'] as const).map(operation=>({id:'socialAppointment.'+operation,label:'Synthetic appointment '+operation,action:{type:'socialAppointment' as const,operation,appointmentId:'bound-appointment'}})),
 );
 const ordinary=decisionChoices(c);assert.equal(ordinary.length,84);
 assert.equal(fieldRows(c,ordinary).length,1);assert.equal(ordinary.filter(row=>row.action.type==='talk').length,9);
 assert.equal(ordinary.filter(row=>row.action.type==='social'&&row.action.operation==='interpret').length,10);
 const controls:ActionChoice[]=[
  {id:'care.stop.bound',label:'Stop own care',action:{type:'respond',proposalId:'own-care',accept:false}},
  {id:'personalFoodGift.stop.bound',label:'Stop own gift',action:{type:'personalFoodGift',operation:'decline',giftId:'own-gift'}},
  {id:'health.bound.cancel',label:'Cancel own rescue',action:{type:'health',operation:'cancelRescue',offerId:'own-rescue'}},
 ];
 c.formal!.opportunities.push(...controls);
 const final=decisionChoices(c);assert.ok(final.length<=84+controls.length);
 for(const control of controls)assert.ok(final.some(row=>JSON.stringify(row.action)===JSON.stringify(control.action)),control.id);
 assert.equal(fieldRows(c,final).length,1);
});


test('a selected field walk stops at a new obstruction or lost expression without watering remotely',()=>{
 for(const change of ['path','expression'] as const){
  const {w,r}=fixture();w.plots=w.plots.slice(0,1);const plot=w.plots[0],c=decisionContext(w,r),menu=decisionChoices(c),row=fieldRows(c,menu)[0];assert.ok(row);
  assert.equal(submitPlan(w,{id:'interrupted-field-'+change,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...parseChoice(JSON.stringify({choice:row.id}),menu)}).ok,true);
  stepWorld(w,.25);const next=r.activity?.path[0];assert.ok(next);const before={...r.at};
  if(change==='path')w.map.tiles[next.y*w.map.width+next.x]='cliff';else r.canExpress=false;
  stepWorld(w,1);assert.deepEqual(r.at,before);assert.equal(r.activity,null);assert.equal(r.plan,null);assert.ok(r.lastFailure);
  assert.notDeepEqual(r.at,plot.at);assert.equal(plot.crop!.wateredDay,-1);assert.equal(r.inventory.water,2);
  assert.ok(!decisionChoices(decisionContext(w,r)).some(row=>row.action.type==='water'));
 }
});

test('an old field direction grants no farming right if the title changes before arrival',()=>{
 const {w,r}=fixture();w.plots=w.plots.slice(0,1);const plot=w.plots[0],c=decisionContext(w,r),menu=decisionChoices(c),row=fieldRows(c,menu)[0];assert.ok(row);
 plot.ownerId='different-owner';
 assert.equal(submitPlan(w,{id:'changed-field-title',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...parseChoice(JSON.stringify({choice:row.id}),menu)}).ok,true);
 for(let i=0;i<100&&(r.plan||r.activity);i++)stepWorld(w,1);
 assert.deepEqual(r.at,plot.at);assert.equal(plot.crop!.wateredDay,-1);assert.equal(r.inventory.water,2);
 const arrival=decisionContext(w,r);assert.deepEqual(arrival.knownLand,[]);assert.deepEqual(arrival.plots,[]);
 assert.ok(!decisionChoices(arrival).some(row=>['water','plant','harvest'].includes(row.action.type)));
});

test('fresh on-disk SQLite and a new process preserve the same field cycle without new stored fields',t=>{
 const {w,r}=fixture(),directory=mkdtempSync(join(testTmpdir(),'known-land-reload-')),path=join(directory,'synthetic.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const store=new WorldStore(path);try{store.commit(w,null);}finally{store.close();}
 const expected=[];
 for(let i=0;i<w.plots.length;i++){const c=decisionContext(w,r);c.minute=480+30*i;expected.push(decisionChoices(c));}
 const root=fileURLToPath(new URL('../',import.meta.url)),source=`
  import {WorldStore} from './src/server/store.ts';
  import {decisionContext,decisionChoices} from './src/server/decisions.ts';
  const store=new WorldStore(process.argv[1]);
  try{
   const world=store.load();if(!world)throw new Error('missing synthetic world');
   const rows=[];for(let i=0;i<world.plots.length;i++){const context=decisionContext(world,world.residents[0]);context.minute=480+30*i;rows.push(decisionChoices(context));}
   if(world.metrics.requests!==0)throw new Error('unexpected model request');
   process.stdout.write(JSON.stringify(rows));
  }finally{store.close();}
 `;
 const child=spawnSync(process.execPath,['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),'--input-type=module','-e',source,path],{
  cwd:root,encoding:'utf8',timeout:20000,env:{HOME:directory,TMPDIR:directory,TMP:directory,TEMP:directory,TSX_DISABLE_CACHE:'1'},
 });
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout),JSON.parse(JSON.stringify(expected)));
 assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(w.metrics.requests,0);
});
