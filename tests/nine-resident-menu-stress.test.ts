import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {decisionContext,prepareModelDecision,parseModelCompletion} from '../src/server/decisions.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {persistedWorldFingerprint} from '../src/server/acceptance-offline-protocol.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {DecisionWaitEvent} from '../src/server/decision-wait-evidence.js';
import {chooseVisibleMenu,personalRetreatChoices,runNineResidentMenuStress,V4_POLICY_LIMITS,V5_POLICY_LIMITS,DEFAULT_MENU_STRESS_POLICY,MENU_STRESS_POLICY,MENU_STRESS_POLICIES} from './helpers/nine-resident-menu-stress.js';
import type {DecisionContext,FormalOpportunity} from '../src/shared/types.js';

const memory=()=>({lastShare:-Infinity,lastField:-Infinity,visits:{},explorations:0});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function noNetwork(t:TestContext){
 // An explicitly preloaded offline guard already denies fetch non-configurably.
 if(!(globalThis as {__valleyOfflineGuard?:boolean}).__valleyOfflineGuard)t.mock.method(globalThis,'fetch',()=>{throw new Error('offline menu stress forbids network');});
}

test('menu stress policy consumes only supplied final choices and never mutates the decision context',()=>{
 const w=createFrontierWorld(5401),context=decisionContext(w,w.residents[0]);
 const prepared=prepareModelDecision(context,undefined,GLM_MODEL),before=structuredClone({context,rows:prepared.choices});
 const selected=chooseVisibleMenu(context,prepared.choices,memory());assert.ok(selected);
 assert.ok(prepared.choices.includes(selected.choice));assert.match(selected.choice.id,/^\d+$/);
 assert.deepEqual({context,rows:prepared.choices},before);
 const absent=chooseVisibleMenu(context,[],memory());assert.equal(absent,null,'no fabricated fallback action');
 const wait=chooseVisibleMenu(context,prepared.choices,memory(),true)!;
 assert.equal(wait.choice.action.type,'wait');
 const parsed=parseModelCompletion(context,prepared,{content:JSON.stringify({choice:wait.choice.id,...wait.fields}),finish:'stop'},0);
 assert.deepEqual(parsed.decision.actions,[{type:'wait',minutes:30}]);
});

test('menu stress policy does not let repeated forage selections starve available sleep',()=>{
 const w=createFrontierWorld(5401),context=decisionContext(w,w.residents[0]);
 // A policy-input counterexample, not a modified default simulation run.
 context.actor.hunger=60;context.actor.energy=30;
 const rows=prepareModelDecision(context,undefined,GLM_MODEL).choices.filter(c=>c.action.type!=='eat');
 const selected=chooseVisibleMenu(context,rows,memory());assert.equal(selected?.choice.action.type,'sleep');
 assert.ok(selected!.fields!.minutes>=1&&selected!.fields!.minutes<=720);
});

test('v3 prioritizes the current personal retreat over food and sleep without changing v2 or the input',()=>{
 const w=createFrontierWorld(5401),context=decisionContext(w,w.residents[0]);
 // Isolated policy-input counterexample, not an edited default simulation world.
 context.actor.hunger=99;context.actor.energy=1;
 context.formal!.opportunities.push({id:'frontier.retreat',label:'避开本人察觉的野猪，撤到附近',
  action:{type:'frontierHazard',operation:'retreat',dangerId:'policy-input-danger',to:{x:context.actor.at.x+12,y:context.actor.at.y}}});
 context.formal!.familyNotes='你在附近察觉到野猪，逼近野兽可能招致袭击。';
 const prepared=prepareModelDecision(context,undefined,GLM_MODEL),before=structuredClone({context,rows:prepared.choices});
 const selected=chooseVisibleMenu(context,prepared.choices,memory())!;
 assert.equal(selected.choice.action.type,'frontierHazard');
 assert.ok(personalRetreatChoices(context,prepared.choices).includes(selected.choice));
 const parsed=parseModelCompletion(context,prepared,{content:JSON.stringify({choice:selected.choice.id}),finish:'stop'},0);
 assert.deepEqual(parsed.decision.actions,[selected.choice.action]);
 assert.equal(chooseVisibleMenu(context,prepared.choices,memory(),false,'v2')!.choice.action.type,'eat');
 assert.equal(chooseVisibleMenu(context,prepared.choices,memory(),true)!.choice.action.type,'wait');
 assert.deepEqual({context,rows:prepared.choices},before);
 const noRetreat=prepared.choices.filter(r=>r.action.type!=='frontierHazard');
 assert.equal(personalRetreatChoices(context,noRetreat).length,0);
 assert.notEqual(chooseVisibleMenu(context,noRetreat,memory())?.choice.action.type,'frontierHazard');
 context.formal!.opportunities=context.formal!.opportunities.filter(o=>o.action.type!=='frontierHazard');
 assert.equal(personalRetreatChoices(context,prepared.choices).length,0,'final row or warning text alone cannot invent personal evidence');
 assert.notEqual(chooseVisibleMenu(context,prepared.choices,memory())?.choice.action.type,'frontierHazard');
});

function policyInput(){
 const w=createFrontierWorld(5401),c=decisionContext(w,w.residents[0]);
 // Synthetic personal-input counterexamples only. No simulation initial state is edited.
 c.actor.hunger=10;c.actor.energy=80;c.actor.inventory={turnip:3};c.actor.recentActions=[];c.actor.lastFailure=null;
 c.people=[];c.resources=[];c.buildings=[];c.knownLand=[];c.plots=[];c.formal!.opportunities=[];
 return c;
}
const finalRows=(c:DecisionContext)=>prepareModelDecision(c,undefined,GLM_MODEL).choices;

test('v4 gifts require current personal signs, a reserve and separate menu choices; holds are bounded',()=>{
 const c=policyInput(),target={id:'policy-recipient',name:'可见人物',at:{...c.actor.at},intention:'',status:'alive' as const,relation:null,
  bodyObservation:{atMinute:c.minute,signs:['hunger' as const]}};
 c.people=[target];
 const offer:FormalOpportunity={id:'personalFoodGift.offer.input',label:'向在场人物提出1份本人食物赠送',
  action:{type:'personalFoodGift',operation:'offer',recipientId:target.id,item:'turnip',quantity:1,receiptId:'policy-input-offer'}};
 c.formal!.opportunities=[offer];const rows=finalRows(c),before=structuredClone({c,rows}),m=memory();
 const selected=chooseVisibleMenu(c,rows,m)!;assert.deepEqual(selected.choice.action,offer.action);
 assert.equal(chooseVisibleMenu(c,rows,memory(),false,'v3')!.choice.action.type==='personalFoodGift',false);
 assert.deepEqual({c,rows},before);
 const stale=structuredClone(c);stale.people[0].bodyObservation!.atMinute--;assert.notDeepEqual(chooseVisibleMenu(stale,finalRows(stale),memory())?.choice.action,offer.action);
 const unseen=structuredClone(c);delete unseen.people[0].bodyObservation;assert.notDeepEqual(chooseVisibleMenu(unseen,finalRows(unseen),memory())?.choice.action,offer.action);
 const noReserve=structuredClone(c);noReserve.actor.inventory.turnip=1;assert.notDeepEqual(chooseVisibleMenu(noReserve,finalRows(noReserve),memory())?.choice.action,offer.action);
 c.minute++;const hold=chooseVisibleMenu(c,finalRows(c),m)!;assert.equal(hold.choice.action.type,'wait');assert.equal(hold.fields?.minutes,5);
 const deliver:FormalOpportunity={id:'personalFoodGift.deliver.input',label:'本人尝试交付原赠食',action:{type:'personalFoodGift',operation:'deliver',giftId:'policy-gift'}};
 c.formal!.opportunities=[deliver];assert.deepEqual(chooseVisibleMenu(c,finalRows(c),m)!.choice.action,deliver.action);
 c.formal!.opportunities=[offer];c.people[0].bodyObservation!.atMinute=c.minute;
 assert.notDeepEqual(chooseVisibleMenu(c,finalRows(c),m)?.choice.action,offer.action,'recipient cooldown is not reset by the handoff');
 const recipient=policyInput();recipient.actor.id=target.id;recipient.actor.inventory={};recipient.actor.hunger=90;
 const accept:FormalOpportunity={id:'personalFoodGift.accept.input',label:'本人独立接受原赠食，尚未收到食物',action:{type:'personalFoodGift',operation:'accept',giftId:'policy-gift'}};
 recipient.formal!.opportunities=[accept];const rm=memory(),acceptRows=finalRows(recipient);
 assert.deepEqual(chooseVisibleMenu(recipient,acceptRows,rm)!.choice.action,accept.action);assert.deepEqual(recipient.actor.inventory,{});
 recipient.minute+=V4_POLICY_LIMITS.giftHold-.5;recipient.formal!.opportunities=[];
 const fractional=chooseVisibleMenu(recipient,finalRows(recipient),rm)!;
 assert.notEqual(fractional.reason,'voluntarily wait briefly for the personal gift handoff','sub-minute remainder cannot create an illegal fractional wait');
 if(fractional.fields)assert.ok(Number.isSafeInteger(fractional.fields.minutes));
 recipient.minute+=.5;
 assert.notEqual(chooseVisibleMenu(recipient,finalRows(recipient),rm)?.reason,'voluntarily wait briefly for the personal gift handoff');
 const absent=policyInput();assert.notEqual(chooseVisibleMenu(absent,acceptRows,memory())?.choice.action.type,'personalFoodGift','a final row alone cannot create personal knowledge');
});

test('v4 remembers only its own failed exploration and backs off without a world map',()=>{
 const c=policyInput();c.actor.inventory={};c.actor.hunger=60;
 const rows=finalRows(c),direction=rows.find(r=>r.action.type==='move'&&r.label.includes('探索6格'))!;
 assert.ok(direction);const only=rows.filter(r=>r===direction||r.action.type==='wait'),m=memory();
 assert.deepEqual(chooseVisibleMenu(c,only,m)!.choice.action,direction.action);
 c.minute++;c.actor.lastFailure='目标目前没有可达路线';
 const next=finalRows(c),sameDirection=next.find(r=>JSON.stringify(r.action)===JSON.stringify(direction.action))!;
 const nextOnly=next.filter(r=>r===sameDirection||r.action.type==='wait');
 const blocked=chooseVisibleMenu(c,nextOnly,m)!;assert.equal(blocked.choice.action.type,'wait');assert.match(blocked.reason,/recently failed/);
 assert.deepEqual(chooseVisibleMenu(c,nextOnly,memory(),false,'v3')!.choice.action,direction.action);
 c.actor.lastFailure=null;const alternate=chooseVisibleMenu(c,finalRows(c),m)!;
 assert.notDeepEqual(alternate.choice.action,direction.action);assert.match(alternate.reason,/personally failed/);
 c.minute+=V4_POLICY_LIMITS.explorationBackoff+1;
 assert.deepEqual(chooseVisibleMenu(c,finalRows(c).filter(r=>JSON.stringify(r.action)===JSON.stringify(direction.action)||r.action.type==='wait'),m)!.choice.action,direction.action);
});

test('v4 inspects known commons without inventing stock and takes only a personally offered menu portion',()=>{
 const c=policyInput();c.actor.inventory={};c.actor.hunger=60;
 const inspect:FormalOpportunity={id:'commons.inspectFood.input',label:'按本人已知地址核实公食，不领取',action:{type:'commons',operation:'inspectFood',buildingId:'known-hall',receiptId:'policy-commons'}};
 c.formal!.opportunities=[inspect];const m=memory();assert.deepEqual(chooseVisibleMenu(c,finalRows(c),m)!.choice.action,inspect.action);
 c.minute++;assert.notDeepEqual(chooseVisibleMenu(c,finalRows(c),m)?.choice.action,inspect.action);
 const take:FormalOpportunity={id:'commons.takeFood.input',label:'实际菜单允许领取1份根菜',action:{type:'commons',operation:'takeFood',buildingId:'known-hall',item:'turnip',receiptId:'policy-commons'}};
 c.formal!.opportunities=[take];const rows=finalRows(c);assert.deepEqual(chooseVisibleMenu(c,rows,m)!.choice.action,take.action);
 c.formal!.opportunities=[];assert.notDeepEqual(chooseVisibleMenu(c,rows,memory())?.choice.action,take.action);
});


function meetingInput(){
 const c=policyInput();c.actor.inventory={};c.actor.hunger=80;c.memories=[];
 const giver={id:'policy-giver',name:'本人亲见的赠者',at:{x:c.actor.at.x+7,y:c.actor.at.y},inside:null,roomAt:null,
  intention:'',status:'alive' as const,relation:null,talkDistance:7};c.people=[giver];
 const expires=c.minute+100,giftId='policy-meeting-gift';
 const stop:FormalOpportunity={id:'personalFoodGift.stop.'+giftId,label:`立即拒绝或撤回本人接受的1份根菜赠粮；原截止${expires}，不需对方同意`,
  action:{type:'personalFoodGift',operation:'decline',giftId}};
 c.formal!.opportunities=[stop];c.memories=[{eventId:'policy-personal-offer',receivedAt:expires-120,source:'self',
  text:`${giver.name}向${c.actor.name}提出赠送1份自有根菜，固定截止${expires}分钟；不扣货、不预留，对方须独立接受，之后送出者另选亲自交付。`}];
 return {c,giver,stop,giftId};
}

const chooseV5=(c:DecisionContext,rows:ReturnType<typeof finalRows>,m:ReturnType<typeof memory>)=>chooseVisibleMenu(c,rows,m,false,'v5');

test('default policy remains v4 and v5 requires an explicit opt-in',t=>{
 noNetwork(t);assert.equal(DEFAULT_MENU_STRESS_POLICY,'v4');assert.equal(MENU_STRESS_POLICY,MENU_STRESS_POLICIES.v4);
 const {c}=meetingInput(),rows=finalRows(c),defaultMemory=memory(),v4Memory=memory();
 const selected=chooseVisibleMenu(c,rows,defaultMemory);
 assert.deepEqual(selected,chooseVisibleMenu(c,rows,v4Memory,false,'v4'));assert.deepEqual(defaultMemory,v4Memory);
 assert.doesNotMatch(selected!.reason,/legal meeting step/);
 assert.match(chooseV5(c,rows,memory())!.reason,/legal meeting step/,'v5 meeting is available only by explicit selection');
 const baseline=runNineResidentMenuStress({days:1,maxDecisions:0});
 const candidate=runNineResidentMenuStress({days:1,maxDecisions:0,policy:'v5'});
 t.diagnostic('Retained default-v4 routing evidence: '+baseline.directory);
 t.diagnostic('Retained explicit-v5 routing evidence: '+candidate.directory);
 for(const [r,policy] of [[baseline,MENU_STRESS_POLICIES.v4],[candidate,MENU_STRESS_POLICIES.v5]] as const){
  assert.equal(r.policy,policy);assert.equal(JSON.parse(readFileSync(join(r.directory,'manifest.json'),'utf8')).policy,policy);
  assert.equal(r.decisions,0);assert.equal(r.throughMinute,r.fromMinute);assert.match(r.exception??'',/decision budget exhausted/);
  assert.equal(r.initialFingerprint,persistedWorldFingerprint(createFrontierWorld(5401)));assert.equal(r.scriptedSurvivalPassed,false);
 }
});

test('v5 uniquely binds a personal offer to a known giver and selects only a bounded final-menu meeting step',()=>{
 const {c,giftId}=meetingInput(),rows=finalRows(c),before=structuredClone({c,rows}),m:any=memory();
 const selected=chooseV5(c,rows,m)!;assert.match(selected.reason,/legal meeting step/);
 assert.equal(selected.choice.action.type,'move');assert.ok(rows.includes(selected.choice));
 const parsed=parseModelCompletion(c,prepareModelDecision(c,undefined,GLM_MODEL),{content:JSON.stringify({choice:selected.choice.id}),finish:'stop'},0);
 assert.deepEqual(parsed.decision.actions,[selected.choice.action]);assert.deepEqual({c,rows},before);assert.deepEqual(c.actor.inventory,{});
 assert.equal(m.meetingSelection.giftId,giftId);assert.equal(m.meetingAttempts[giftId].length,1);
 assert.doesNotMatch(chooseVisibleMenu(c,rows,memory(),false,'v4')!.reason,/meeting/);
 const restricted=rows.filter(r=>r===selected.choice||r.action.type==='wait'||r.action.type==='personalFoodGift');
 c.minute++;assert.doesNotMatch(chooseV5(c,restricted,m)!.reason,/legal meeting step/,'same gift/from/action is not repeated');
 const capped:any=memory();capped.meetingAttempts={[giftId]:['a','b','c']};assert.equal(V5_POLICY_LIMITS.attemptsPerGift,3);
 assert.doesNotMatch(chooseV5(c,rows,capped)!.reason,/legal meeting step/);assert.equal(capped.meetingInputs[0].status,'meeting-attempt-cap');
});

test('v5 closes identity, stale-position and already-accepted gaps without reading a gift table',()=>{
 for(const change of ['no-memory','heard-memory','duplicate-memory','duplicate-name','duplicate-stop','expired','known-dead','unknown-space'] as const){
  const {c,stop}=meetingInput();
  if(change==='no-memory')c.memories=[];
  if(change==='heard-memory')c.memories[0].source='heard';
  if(change==='duplicate-memory')c.memories.push({...c.memories[0],eventId:'another-event'});
  if(change==='duplicate-name')c.people.push({...c.people[0],id:'other-person'});
  if(change==='duplicate-stop')c.formal!.opportunities.push({...stop,id:stop.id+'2',action:{type:'personalFoodGift',operation:'decline',giftId:'second-gift'}});
  if(change==='expired')c.minute+=100;
  if(change==='known-dead')c.people[0].status='dead';
  if(change==='unknown-space')delete c.people[0].inside;
  assert.doesNotMatch(chooseV5(c,finalRows(c),memory())!.reason,/legal meeting step/,change);
 }
 const {c,giver,giftId}=meetingInput();c.people=[];const m:any=memory();
 m.meetingSightings={[giver.id]:{...giver,atMinute:c.minute-121}};
 assert.doesNotMatch(chooseV5(c,finalRows(c),m)!.reason,/legal meeting step/);assert.equal(m.meetingInputs[0].status,'stale-or-future-giver-position');
 c.people=[giver];m.selectedGiftAccepts={[giftId]:true};chooseV5(c,finalRows(c),m);assert.equal(m.meetingInputs[0].status,'already-selected-accept');
 const accept:FormalOpportunity={id:'personalFoodGift.accept.'+giftId,label:'本人接受已知提议',action:{type:'personalFoodGift',operation:'accept',giftId}};
 c.formal!.opportunities.push(accept);const omitted=finalRows(c).filter(r=>r.action.type!=='personalFoodGift'||r.action.operation!=='accept'),fresh:any=memory();
 assert.doesNotMatch(chooseV5(c,omitted,fresh)!.reason,/legal meeting step/);assert.equal(fresh.meetingInputs[0].status,'accept-present-in-personal-context');
 const accepting:any=memory();assert.equal(chooseV5(c,finalRows(c),accepting)!.choice.action.type,'personalFoodGift');assert.equal(accepting.selectedGiftAccepts[giftId],true);
});

test('v5 preserves urgent priorities and needs an existing legal public-room opportunity',()=>{
 const {c,giver}=meetingInput();c.actor.inventory={berry:1};assert.equal(chooseV5(c,finalRows(c),memory())!.choice.action.type,'eat');
 c.actor.inventory={};c.actor.energy=1;c.buildings=[{id:c.actor.homeId!,kind:'home',name:'本人登记住处',door:{...c.actor.at}}];
 const sleepy:any=memory();sleepy.giftHoldUntil=c.minute+15;assert.equal(chooseV5(c,finalRows(c),sleepy)!.choice.action.type,'sleep');
 c.actor.energy=80;c.formal!.opportunities.push({id:'frontier.retreat',label:'本人合法撤离',action:{type:'frontierHazard',operation:'retreat',dangerId:'policy-danger',to:{x:c.actor.at.x+1,y:c.actor.at.y}}});
 assert.equal(chooseV5(c,finalRows(c),memory())!.choice.action.type,'frontierHazard');c.formal!.opportunities.pop();
 c.formal!.opportunities.push({id:'policy.harvest',label:'本人可见粮食收获',action:{type:'harvest',plotId:'policy-field'}});
 const hungry:any=memory();hungry.giftHoldUntil=c.minute+15;
 assert.equal(chooseV5(c,finalRows(c),hungry)!.choice.action.type,'harvest');c.formal!.opportunities.pop();
 c.people=[{...giver,at:{...c.actor.at},inside:'known-public-room',roomAt:{x:8,y:8},talkDistance:6}];
 c.buildings=[{id:'known-public-room',kind:'lodge',name:'已知共屋',door:{...c.actor.at},ownerId:'commons'}];
 assert.doesNotMatch(chooseV5(c,finalRows(c),memory())!.reason,/legal meeting step/);
 c.formal!.opportunities.push({id:'commons.inspectFood.policy',label:'合法共屋室内核实',action:{type:'commons',operation:'inspectFood',buildingId:'known-public-room',receiptId:'policy-inspect'}});
 const selected=chooseV5(c,finalRows(c),memory())!;assert.match(selected.reason,/legal meeting step/);assert.equal(selected.choice.action.type,'commons');
});

test('a bounded controller failure still leaves a reproducible non-passing report',t=>{
 noNetwork(t);const r=runNineResidentMenuStress({days:1,maxDecisions:0});
 t.diagnostic('Retained bounded-failure evidence: '+r.directory);
 assert.match(r.exception??'',/decision budget exhausted/);
 assert.equal(r.gates.exactEndpoint,false);assert.equal(r.scriptedSurvivalPassed,false);
 assert.equal(r.initialFingerprint,persistedWorldFingerprint(createFrontierWorld(5401)));
 assert.equal(existsSync(join(r.directory,'report.json')),true);
 assert.equal(existsSync(join(r.directory,'manifest.json')),true);
});

test('the same numbered controller enters the existing real runtime through its fake-model seam',async t=>{
 noNetwork(t);t.mock.timers.enable({apis:['setInterval']});let wall=1_700_000_000_000;t.mock.method(Date,'now',()=>wall);
 const store=new WorldStore(':memory:');store.commit(createFrontierWorld(5401),null);
 const events:DecisionWaitEvent[]=[],memories=new Map<string,ReturnType<typeof memory>>();let calls=0;
 const runtime=new ValleyRuntime(store,'OFFLINE-MENU-STRESS-NOT-A-CREDENTIAL',async(_key,c,feedback,model,prepared)=>{
  calls++;const request=prepared??prepareModelDecision(c,feedback,model??GLM_MODEL);
  const m=memories.get(c.actor.id)??memory();memories.set(c.actor.id,m);
  const selected=chooseVisibleMenu(c,request.choices,m);assert.ok(selected);
  return parseModelCompletion(c,request,{content:JSON.stringify({choice:selected.choice.id,...selected.fields}),finish:'stop',usage:{prompt_tokens:0,completion_tokens:0}},0);
 },{decisionWaitEvidence:{observe:e=>events.push(e)}});
 try{
  runtime.start();for(let i=0;i<35;i++){await flush();runtime.tick(wall+=1000);}await flush();
  assert.ok(calls>=9);assert.ok(events.some(e=>e.type==='wait_finished'&&e.reason==='accepted'));
  assert.equal(runtime.world.residents.length,9);assert.ok(runtime.world.residents.some(r=>r.activity||r.recentActions?.length));
  assert.equal(runtime.world.metrics.failures,0);
 }finally{runtime.stop();store.close();}
});

test('default nine residents report actual five-day effects without requiring a successful survival outcome',t=>{
 noNetwork(t);const r=runNineResidentMenuStress({days:5});
 assert.equal(r.policy,MENU_STRESS_POLICIES.v4,'omitted policy must remain the v4 baseline');
 t.diagnostic('Retained synthetic evidence: '+r.directory);
 assert.equal(r.exception,null,r.exception??'');assert.equal(r.gates.exactEndpoint,true);
 assert.equal(r.initialFingerprint,persistedWorldFingerprint(createFrontierWorld(5401)));
 assert.equal(r.realModelExecuted,false);assert.equal(r.modelAutonomyAcceptancePassed,null);assert.equal(r.technicalWaitMinutes,null);
 assert.equal(r.coverageMinutes,5*1440);assert.equal(r.gates.defaultNine,true);
 assert.equal(r.actionCoveragePassed,r.exception===null&&Object.entries(r.gates).filter(([k])=>k!=='nineAlive'&&k!=='reloaded').every(([,v])=>v));
 assert.equal(r.decisionBudget,30000);assert.ok(r.decisions<r.decisionBudget);
 assert.equal(r.retreatDiagnostics.unchosenEligibleDecisions,0);
 assert.equal(r.scriptedSurvivalPassed,r.exception===null&&r.actionCoveragePassed&&r.gates.nineAlive);
 assert.equal(r.supportCoveragePassed,r.exception===null&&Object.values(r.supportCoverage).every(Boolean));
 assert.equal(r.meetingCoveragePassed,r.exception===null&&Object.values(r.meetingCoverage).every(Boolean));
 for(const chain of r.meetingChains.filter(c=>c.orderedChain)){assert.ok(chain.completedBeforeAccept.length);assert.ok(chain.acceptSequence&&chain.deliverSequence&&chain.zeroStockNextEatLink);}
 // Coverage gaps are reported, not repaired or silently rebranded as success.
 assert.ok(r.checkpoints.some((c:any)=>c.stage==='endpoint'));
 const trace=JSON.parse(readFileSync(join(r.directory,'trace.json'),'utf8')) as any[];
 const completed=trace.filter(t=>t.accepted&&t.completedAt!==null&&!t.failure);
 for(const retreat of completed.filter(t=>t.action.type==='frontierHazard'&&t.action.operation==='retreat')){
  assert.ok(retreat.danger.eligibleRetreatChoiceIds.includes(retreat.choiceId));
  assert.deepEqual(retreat.after.at,retreat.action.to,'retreat requires actual arrival');
  assert.ok(retreat.completionEvents.some((e:any)=>e.actors.includes(retreat.actorId)&&e.text.includes('自行撤离')));
 }
 for(const receipt of r.evidence.directEating.receipts){
  const action=completed.find(t=>'menu-stress:'+t.sequence===receipt.planId);
  assert.ok(action);assert.equal(action.actorId,receipt.residentId);assert.equal(action.action.type,'eat');assert.equal(action.action.item,receipt.item);
  assert.equal(action.completedAt,receipt.at);assert.equal(receipt.quantity,1);
 }
 for(const receipt of r.evidence.foodFlows.receipts.filter(f=>f.action==='harvest'||f.action==='saveSeed')){
  assert.ok(completed.some(t=>'menu-stress:'+t.sequence===receipt.planId&&t.completedAt===receipt.at));
 }
 for(const gift of r.giftDiagnostics){
  if(gift.gift.status==='delivered'){
   assert.ok(gift.offerSequence);assert.ok(gift.acceptSequence);assert.ok(gift.deliverSequence);assert.ok(gift.observed?.deliveryReceiptPresent);
   assert.ok(completed.some(t=>t.sequence===gift.deliverSequence&&t.actorId===gift.gift.giverId));
  }
  if(gift.zeroStockNextEatLink){assert.ok(gift.laterSameItemEating);assert.equal(gift.laterSameItemEating.residentId,gift.gift.recipientId);assert.equal(gift.laterSameItemEating.item,gift.gift.item);}
 }
 assert.equal(existsSync(join(r.directory,'decisions.jsonl.gz')),true);
 assert.equal(existsSync(join(r.directory,'report.json')),true);
});

test('wait-only negative control preserves each death and causal menu evidence instead of reporting a pass',t=>{
 noNetwork(t);const r=runNineResidentMenuStress({days:4,waitOnly:true});
 t.diagnostic('Retained negative-control evidence: '+r.directory);
 assert.equal(r.exception,null,r.exception??'');assert.equal(r.gates.exactEndpoint,true);
 assert.equal(r.initialFingerprint,persistedWorldFingerprint(createFrontierWorld(5401)));
 assert.equal(r.scriptedSurvivalPassed,false);assert.equal(r.actionCoveragePassed,false);
 assert.equal(r.final.filter(p=>p.status==='dead').length,9);
 assert.equal(r.evidence.directEating.receipts.length,0);
 for(const p of r.final.filter(p=>p.status==='dead')){
  const file=join(r.directory,`first-${p.id}-death.json`);assert.equal(existsSync(file),true);
  const d=JSON.parse(readFileSync(file,'utf8'));assert.equal(d.after.id,p.id);assert.equal(d.after.status,'dead');
  assert.ok(d.recent.length);assert.ok(d.recent.every((a:any)=>a.action.type==='wait'));
  assert.ok(d.choices.some((a:any)=>a.action.type==='eat'),'food was offered but the negative policy chose wait');
 }
});
