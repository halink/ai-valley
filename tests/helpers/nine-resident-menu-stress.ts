/** Test-only scripted choices. No model, credential, service or production hook.
 * The policy receives only the resident's actual context and final numbered menu.
 * World-reading diagnostics never feed decisions. An unsuccessful run is evidence,
 * not permission to replenish stock or change the default initial conditions. */
import assert from 'node:assert/strict';
import {appendFileSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {testTmpdir} from '../../scripts/repository-temporary.mjs';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {decisionContext,prepareModelDecision,parseModelCompletion} from '../../src/server/decisions.js';
import {GLM_MODEL} from '../../src/server/model-completion.js';
import {WorldStore} from '../../src/server/store.js';
import {persistedWorldFingerprint,sourceManifest} from '../../src/server/acceptance-offline-protocol.js';
import {DAY} from '../../src/world/time.js';
import {snapshotNineFood,createNineFoodEvidence} from './nine-food-accounting.js';
import type {ActionChoice} from '../../src/server/affordances.js';
import type {Action,DecisionContext,Resident,World} from '../../src/shared/types.js';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {isWaterSourceChoice} from '../../src/server/water-source-opportunities.js';
import {createSurvivalEvaluator,SURVIVAL_CONTRACT,survivalSnapshot,survivalFood,type SurvivalRecord} from './nine-resident-survival.js';

export const MENU_STRESS_POLICIES={v2:'visible-needs-and-farming-v2',v3:'visible-needs-farming-and-retreat-v3',v4:'visible-needs-gifts-and-feedback-v4',v5:'visible-gift-meeting-v5'} as const;
type PolicyVersion=keyof typeof MENU_STRESS_POLICIES;
// Experimental policies remain opt-in until explicitly promoted.
export const DEFAULT_MENU_STRESS_POLICY='v4' as const satisfies PolicyVersion;
export const MENU_STRESS_POLICY=MENU_STRESS_POLICIES[DEFAULT_MENU_STRESS_POLICY];
type ExplorationAttempt={from:DecisionContext['actor']['at'];to:DecisionContext['actor']['at'];at:number};
type Sighting={id:string;name:string;at:DecisionContext['actor']['at'];inside:string|null|undefined;status:'alive'|'dead';roomAt?:DecisionContext['actor']['at']|null;atMinute:number;talkDistance?:number};
type MeetingInput={giftId:string;stopChoiceId:string;expiresAt:number;status:string;offerEventId?:string;giverName?:string;giver?:Sighting;candidateChoiceIds:string[]};
type PolicyMemory={lastShare:number;lastField:number;visits:Record<string,number>;explorations:number;primaryFieldId?:string;needsWater?:boolean;
 lastExploration?:ExplorationAttempt;blockedExploration?:Record<string,number>;lastExplorationFeedback?:ExplorationAttempt&{noticedAt:number;until:number;failure:string};
 giftOfferAt?:Record<string,number>;giftHoldUntil?:number;commonsInspectAt?:Record<string,number>;
 meetingSightings?:Record<string,Sighting>;selectedGiftAccepts?:Record<string,boolean>;meetingAttempts?:Record<string,string[]>;
 meetingInputs?:MeetingInput[];meetingSelection?:{giftId:string;choiceId:string;knownGiver:Sighting}|null};
type Selection={choice:ActionChoice;reason:string;fields?:{minutes:number}};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const memory=():PolicyMemory=>({lastShare:-Infinity,lastField:-Infinity,visits:{},explorations:0});
const explorationKey=(from:DecisionContext['actor']['at'],to:DecisionContext['actor']['at'])=>JSON.stringify([from.x,from.y,to.x,to.y]);
const personallyOffered=(c:DecisionContext,row:ActionChoice)=>!!c.formal?.opportunities.some(o=>same(o.action,row.action));
const witnessedNeed=(c:DecisionContext,id:string)=>c.people.some(p=>p.id===id&&p.bodyObservation?.atMinute===c.minute
 &&p.bodyObservation.signs.some(s=>s==='hunger'||s==='weakness'));
export const V4_POLICY_LIMITS={giftRecipientCooldown:120,giftHold:15,giftWaitStep:5,explorationBackoff:240,commonsInspectCooldown:240} as const;
export const V5_POLICY_LIMITS={knownPositionAge:120,attemptsPerGift:3,maxDirectMoveDistance:12,urgentFoodHunger:70} as const;
const manhattan=(a:DecisionContext['actor']['at'],b:DecisionContext['actor']['at'])=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const meetingAttemptKey=(c:DecisionContext,row:ActionChoice)=>hash({from:c.actor.at,action:row.action});

/** Only personal memories and personal sightings bind a live stop to a donor.
 * No gift table, private inventory, map lookup or generated target is available. */
function meetingInputs(c:DecisionContext,rows:readonly ActionChoice[],m:PolicyMemory):MeetingInput[]{
 const stops=rows.filter(row=>row.action.type==='personalFoodGift'&&row.action.operation==='decline'&&personallyOffered(c,row));
 return stops.map(row=>{
  assert.equal(row.action.type,'personalFoodGift');
  const action=row.action as Extract<Action,{type:'personalFoodGift'}> & {giftId:string};
  const parsed=/^立即拒绝或撤回本人接受的(\d+)份(.+)赠粮；原截止(\d+(?:\.\d+)?)，不需对方同意$/.exec(row.label);
  const out:MeetingInput={giftId:action.giftId,stopChoiceId:row.id,expiresAt:parsed?Number(parsed[3]):0,status:'unrecognized-personal-stop',candidateChoiceIds:[]};
  if(!parsed||!Number.isFinite(out.expiresAt)||out.expiresAt<=c.minute)return out;
  if(m.selectedGiftAccepts?.[out.giftId]){out.status='already-selected-accept';return out;}
  if(c.formal?.opportunities.some(o=>o.action.type==='personalFoodGift'&&o.action.operation==='accept'&&o.action.giftId===out.giftId)){
   out.status='accept-present-in-personal-context';return out;
  }
  if(stops.filter(other=>other.label===row.label).length!==1){out.status='ambiguous-live-stops';return out;}
  const suffix=`向${c.actor.name}提出赠送${parsed[1]}份自有${parsed[2]}，固定截止${parsed[3]}分钟；不扣货、不预留，对方须独立接受，之后送出者另选亲自交付。`;
  const memories=c.memories.filter(v=>v.source==='self'&&v.receivedAt===out.expiresAt-120&&v.receivedAt<=c.minute&&v.text.endsWith(suffix));
  if(memories.length!==1){out.status='missing-or-ambiguous-personal-offer-memory';return out;}
  out.offerEventId=memories[0].eventId;out.giverName=memories[0].text.slice(0,-suffix.length);
  const seen=Object.values(m.meetingSightings??{}).filter(p=>p.name===out.giverName&&p.id!==c.actor.id);
  if(!out.giverName||seen.length!==1){out.status='unknown-or-ambiguous-giver-identity';return out;}
  out.giver=structuredClone(seen[0]);const giver=out.giver;
  if(giver.status!=='alive'||giver.inside===undefined||!Number.isSafeInteger(giver.at.x)||!Number.isSafeInteger(giver.at.y)){out.status='known-unavailable-giver-or-unknown-place';return out;}
  if(giver.atMinute>c.minute||c.minute-giver.atMinute>V5_POLICY_LIMITS.knownPositionAge){out.status='stale-or-future-giver-position';return out;}
  if(giver.atMinute===c.minute&&giver.talkDistance!==undefined&&giver.talkDistance<=2){out.status='already-near-without-accept';return out;}
  const attempts=m.meetingAttempts?.[out.giftId]??[];
  if(attempts.length>=V5_POLICY_LIMITS.attemptsPerGift){out.status='meeting-attempt-cap';return out;}
  const distance=manhattan(c.actor.at,giver.at);
  const candidates=rows.filter(choice=>{
   if(attempts.includes(meetingAttemptKey(c,choice)))return false;
   const a=choice.action;
   if(a.type==='move')return manhattan(a.to,giver.at)<distance&&manhattan(c.actor.at,a.to)<=V5_POLICY_LIMITS.maxDirectMoveDistance
    &&manhattan(c.actor.at,a.to)<out.expiresAt-c.minute
    &&(m.blockedExploration?.[explorationKey(c.actor.at,a.to)]??0)<=c.minute;
   return distance<=V5_POLICY_LIMITS.maxDirectMoveDistance&&distance<out.expiresAt-c.minute&&giver.inside!==null
    &&c.buildings.some(b=>b.id===giver.inside&&b.ownerId==='commons')
    &&a.type==='commons'&&a.operation==='inspectFood'&&a.buildingId===giver.inside&&personallyOffered(c,choice);
  }).sort((a,b)=>{
   const score=(row:ActionChoice)=>row.action.type==='move'?manhattan(row.action.to,giver.at):0;
   return score(a)-score(b)||Number(a.id)-Number(b.id);
  });
  out.candidateChoiceIds=candidates.map(v=>v.id);out.status=candidates.length?'meeting-menu-available':'no-legal-nonrepeated-meeting-step';return out;
 });
}

function learnExplorationFailure(c:DecisionContext,m:PolicyMemory){
 const prior=m.lastExploration;if(!prior||c.minute<=prior.at)return;
 if(c.actor.lastFailure&&/目标目前没有可达路线|原路线出现阻挡/.test(c.actor.lastFailure)
  &&!c.actor.recentActions?.some(a=>a.type==='move'&&a.at>prior.at)){
  const until=c.minute+V4_POLICY_LIMITS.explorationBackoff;
  (m.blockedExploration??={})[explorationKey(prior.from,prior.to)]=until;
  m.lastExplorationFeedback={...prior,noticedAt:c.minute,until,failure:c.actor.lastFailure};
 }
 delete m.lastExploration;
}
const supportInput=(c:DecisionContext,rows:readonly ActionChoice[],m:PolicyMemory)=>({
 witnessedGiftOfferChoiceIds:rows.filter(row=>row.action.type==='personalFoodGift'&&row.action.operation==='offer'
  &&personallyOffered(c,row)&&witnessedNeed(c,row.action.recipientId)).map(r=>r.id),
 acceptChoiceIds:rows.filter(r=>r.action.type==='personalFoodGift'&&r.action.operation==='accept'&&personallyOffered(c,r)).map(r=>r.id),
 deliverChoiceIds:rows.filter(r=>r.action.type==='personalFoodGift'&&r.action.operation==='deliver'&&personallyOffered(c,r)).map(r=>r.id),
 commonsInspectChoiceIds:rows.filter(r=>r.action.type==='commons'&&r.action.operation==='inspectFood'&&personallyOffered(c,r)).map(r=>r.id),
 commonsTakeChoiceIds:rows.filter(r=>r.action.type==='commons'&&r.action.operation==='takeFood'&&personallyOffered(c,r)).map(r=>r.id),
 blockedExplorationChoiceIds:rows.filter(r=>r.action.type==='move'&&r.label.includes('探索6格')
  &&(m.blockedExploration?.[explorationKey(c.actor.at,r.action.to)]??0)>c.minute).map(r=>r.id),
 lastExplorationFeedback:m.lastExplorationFeedback?structuredClone(m.lastExplorationFeedback):null
});

/** Structured personal opportunities are the danger evidence. Text alone never
 * invents a destination, nor does a row absent from this personal context. */
export function personalRetreatChoices(c:DecisionContext,rows:readonly ActionChoice[]){
 return rows.filter(row=>row.action.type==='frontierHazard'&&row.action.operation==='retreat'
  &&c.formal?.opportunities.some(o=>same(o.action,row.action)));
}
const dangerInput=(c:DecisionContext,rows:readonly ActionChoice[])=>({
 personalRetreats:(c.formal?.opportunities??[]).filter(o=>o.action.type==='frontierHazard'&&o.action.operation==='retreat'),
 finalRetreatChoiceIds:rows.filter(r=>r.action.type==='frontierHazard'&&r.action.operation==='retreat').map(r=>r.id),
 eligibleRetreatChoiceIds:personalRetreatChoices(c,rows).map(r=>r.id)
});
// Observer-only resource diagnostics. These snapshots never enter the policy.
const resourceState=(w:World,ids:readonly string[])=>({at:w.minute,
 stock:snapshotNineFood(w,ids),sources:w.resources.filter(r=>r.kind==='bush'||r.kind==='spring').map(r=>({id:r.id,kind:r.kind,amount:r.amount,max:r.max})),
 plots:w.plots.filter(p=>ids.includes(p.ownerId)).map(p=>({id:p.id,ownerId:p.ownerId,crop:p.crop?{...p.crop}:null})),
 hazardTotals:w.frontierHazards?{...w.frontierHazards.totals}:null
});

/** Exported for independent tests. No World, store, resource lookup or completion
 * helper is available here. The returned row always belongs to this exact menu. */
export function chooseVisibleMenu(c:DecisionContext,rows:readonly ActionChoice[],m:PolicyMemory,waitOnly=false,policy:PolicyVersion=DEFAULT_MENU_STRESS_POLICY):Selection|null {
 const pick=(predicate:(a:Action,row:ActionChoice)=>boolean,reason:string,fields?:{minutes:number})=>{
  const choice=rows.find(row=>predicate(row.action,row));return choice?{choice,reason,...(fields?{fields}:{})}:null;
 };
 const wait=()=>pick(a=>a.type==='wait','chosen bounded wait',{minutes:30});
 if(waitOnly)return wait();
 const supportPolicy=policy==='v4'||policy==='v5';
 if(supportPolicy)learnExplorationFailure(c,m);
 if(policy==='v5'){
  for(const p of c.people)(m.meetingSightings??={})[p.id]={id:p.id,name:p.name,status:p.status,at:{...p.at},inside:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,atMinute:c.minute,talkDistance:p.talkDistance};
  m.meetingInputs=meetingInputs(c,rows,m);m.meetingSelection=null;
 }
 if(policy!=='v2'){
  const retreat=personalRetreatChoices(c,rows)[0];
  if(retreat)return {choice:retreat,reason:'prioritize a personally known legal retreat'};
 }
 // A script-owned intention based on known title/address, never remote crop state.
 m.primaryFieldId??=[...c.knownLand].sort((a,b)=>
  Math.abs(a.at.x-c.actor.at.x)+Math.abs(a.at.y-c.actor.at.y)-Math.abs(b.at.x-c.actor.at.x)-Math.abs(b.at.y-c.actor.at.y)||a.id.localeCompare(b.id))[0]?.id;
 const edible=rows.filter(row=>row.action.type==='eat').sort((a,b)=>{
  const expires=(row:ActionChoice)=>{const action=row.action;return action.type==='eat'?c.formal?.personalFoodFreshness?.items.find(i=>i.item===action.item)?.earliest?.expiresAt??Infinity:Infinity;};
  return expires(a)-expires(b)||a.id.localeCompare(b.id);
 });
 if(c.actor.hunger>=30&&edible[0]){if(supportPolicy)m.giftHoldUntil=0;return {choice:edible[0],reason:'eat carried food, earliest known expiry first'};}
 if(policy==='v5'&&c.actor.energy<=45){
  const rate=c.formal?.sleepRecoveryPerHour??13.2;
  const minutes=Math.min(240,Math.max(30,Math.ceil((85-c.actor.energy)*60/Math.max(1,rate))));
  const sleep=pick(a=>a.type==='sleep','restore urgently needed energy before a gift handoff or meeting',{minutes});if(sleep)return sleep;
 }
 if(policy==='v5'&&c.actor.hunger>=V5_POLICY_LIMITS.urgentFoodHunger&&m.meetingInputs?.some(v=>v.status==='meeting-menu-available')){
  const food=pick(a=>a.type==='gather'&&c.resources.some(r=>r.id===a.resourceId&&r.kind==='bush'&&r.amount>0)
   ||a.type==='harvest'||a.type==='commons'&&a.operation==='takeFood','prioritize a known food action before a gift meeting');if(food)return food;
 }
 if(supportPolicy){
  const deliver=pick((a,row)=>a.type==='personalFoodGift'&&a.operation==='deliver'&&personallyOffered(c,row),'try to deliver a personally accepted gift');
  if(deliver){m.giftHoldUntil=0;return deliver;}
  if(c.actor.hunger>=30||!edible.length){
   const accept=pick((a,row)=>a.type==='personalFoodGift'&&a.operation==='accept'&&personallyOffered(c,row),'independently accept an offered personal food gift');
   if(accept){m.giftHoldUntil=c.minute+V4_POLICY_LIMITS.giftHold;
    if(policy==='v5'&&accept.choice.action.type==='personalFoodGift'&&accept.choice.action.operation==='accept')(m.selectedGiftAccepts??={})[accept.choice.action.giftId]=true;return accept;}
  }
  if((m.giftHoldUntil??0)>c.minute){
   const minutes=Math.floor(Math.min(V4_POLICY_LIMITS.giftWaitStep,m.giftHoldUntil!-c.minute));
   const hold=pick(a=>a.type==='wait','voluntarily wait briefly for the personal gift handoff',
    {minutes});if(minutes>=1&&hold)return hold;
  }
  if(c.actor.hunger<50&&c.actor.energy>45){
   const offer=pick((a,row)=>a.type==='personalFoodGift'&&a.operation==='offer'&&personallyOffered(c,row)
    &&witnessedNeed(c,a.recipientId)&&(c.actor.inventory[a.item]??0)>=a.quantity+1
    &&c.minute-(m.giftOfferAt?.[a.recipientId]??-Infinity)>=V4_POLICY_LIMITS.giftRecipientCooldown,'offer carried food for personally witnessed hunger or weakness');
   if(offer){const a=offer.choice.action;if(a.type==='personalFoodGift'&&a.operation==='offer')(m.giftOfferAt??={})[a.recipientId]=c.minute;
    m.giftHoldUntil=c.minute+V4_POLICY_LIMITS.giftHold;return offer;}
  }
 }
 if(c.actor.energy<=45){
  const rate=c.formal?.sleepRecoveryPerHour??13.2;
  const minutes=Math.min(240,Math.max(30,Math.ceil((85-c.actor.energy)*60/Math.max(1,rate))));
  const sleep=pick(a=>a.type==='sleep','restore energy before another journey',{minutes});if(sleep)return sleep;
 }
 if(policy==='v5'){
  const meeting=m.meetingInputs?.find(v=>v.status==='meeting-menu-available');
  if(meeting){
   const choice=rows.find(v=>v.id===meeting.candidateChoiceIds[0])!;
   (m.meetingAttempts??={})[meeting.giftId]??=[];m.meetingAttempts[meeting.giftId].push(meetingAttemptKey(c,choice));
   m.meetingSelection={giftId:meeting.giftId,choiceId:choice.id,knownGiver:structuredClone(meeting.giver!)};
   if(choice.action.type==='move'&&choice.label.includes('探索6格'))m.lastExploration={from:{...c.actor.at},to:{...choice.action.to},at:c.minute};
   return {choice,reason:'try a legal meeting step toward a personally known food giver'};
  }
 }
 const heard=pick((a,row)=>a.type==='move'&&row.label.includes('当面告知的旧地址')&&(m.visits[hash(a)]??-Infinity)<c.minute-240,'independently inspect a heard address');
 if(heard&&c.actor.hunger<70&&c.actor.energy>45){m.visits[hash(heard.choice.action)]=c.minute;return heard;}
 if(c.minute-m.lastShare>=240&&c.actor.hunger<50&&c.actor.energy>55){
  const share=pick(a=>a.type==='shareFoodSource','explicitly share a first-hand address');if(share){m.lastShare=c.minute;return share;}
 }
 const harvest=pick(a=>a.type==='harvest','harvest an actually visible mature owned field');if(harvest)return harvest;
 const water=pick(a=>a.type==='water','water an actually visible owned crop');if(water&&c.weather!=='rain')return water;
 const needsWater=c.plots.some(p=>p.id===m.primaryFieldId&&p.crop&&p.observed?.stage==='growing'&&p.observed.wateredToday===false)&&c.weather!=='rain';
 if((c.actor.inventory.water??0)>0)m.needsWater=false;
 else if(needsWater)m.needsWater=true;
 if(m.needsWater){
  const draw=pick(a=>a.type==='gather'&&c.resources.some(r=>r.id===a.resourceId&&r.kind==='spring'),'draw observed irrigation water');if(draw)return draw;
  const visit=pick(a=>a.type==='move'&&!!c.formal?.opportunities.some(o=>isWaterSourceChoice(o)&&same(o.action,a)),'inspect a known water address');if(visit)return visit;
 }
 if((c.actor.inventory.seed??0)<2&&(c.actor.inventory.turnip??0)>=2){
  const seed=pick(a=>a.type==='production'&&a.operation==='saveSeed','convert one owned root into seed');if(seed)return seed;
 }
 if(c.actor.hunger<65&&c.actor.energy>45){
  const plant=pick(a=>a.type==='production'&&a.operation==='plantCrop'&&a.plotId===m.primaryFieldId&&a.cropId==='crop/turnip@2','plant the chosen owned food field');if(plant)return plant;
 }
 const coverage=c.formal?.foodCoverage;
 const needsFood=!edible.length||(coverage?.carriedNutrition??0)<(coverage?.dailyNeed??54.72)*.75;
 if(needsFood){
  const gather=pick(a=>a.type==='gather'&&c.resources.some(r=>r.id===a.resourceId&&r.kind==='bush'),'gather an actually observed finite berry source');if(gather)return gather;
  const take=pick((a,row)=>a.type==='commons'&&a.operation==='takeFood'&&(!supportPolicy||personallyOffered(c,row)),'collect an actually offered public portion');if(take)return take;
  if(supportPolicy){
   const inspectCommons=pick((a,row)=>a.type==='commons'&&a.operation==='inspectFood'&&personallyOffered(c,row)
    &&c.minute-(m.commonsInspectAt?.[a.buildingId]??-Infinity)>=V4_POLICY_LIMITS.commonsInspectCooldown,'inspect personally known commons food before assuming a portion exists');
   if(inspectCommons){const a=inspectCommons.choice.action;if(a.type==='commons'&&a.operation==='inspectFood')(m.commonsInspectAt??={})[a.buildingId]=c.minute;return inspectCommons;}
  }
  const inspect=pick((a,row)=>a.type==='move'&&row.label.includes('浆果地点')&&(m.visits[hash(a)]??-Infinity)<c.minute-240,'inspect a remembered berry address');
  if(inspect){m.visits[hash(inspect.choice.action)]=c.minute;return inspect;}
 }
 if(c.knownLand.length&&c.minute-m.lastField>=180&&c.actor.energy>45&&c.actor.hunger<65){
  const field=c.knownLand.find(p=>p.id===m.primaryFieldId);
  const walk=pick((a,row)=>a.type==='move'&&row.label.includes('自己已知的田地')&&!!field&&same(a.to,field.at),'visit own known land without remote crop knowledge');
  if(walk){m.lastField=c.minute;return walk;}
 }
 if(needsFood&&c.actor.energy>45){
  const explore=rows.filter(row=>row.action.type==='move'&&row.label.includes('探索6格'));
  if(supportPolicy){
   const allowed=explore.filter(row=>row.action.type==='move'&&(m.blockedExploration?.[explorationKey(c.actor.at,row.action.to)]??0)<=c.minute);
   if(allowed.length){const choice=allowed[m.explorations++%allowed.length];
    if(choice.action.type==='move')m.lastExploration={from:{...c.actor.at},to:{...choice.action.to},at:c.minute};
    return {choice,reason:allowed.length<explore.length?'explore while avoiding a personally failed endpoint':'explore without assuming unseen food'};
   }
   if(explore.length)return pick(a=>a.type==='wait','wait after all displayed exploration directions recently failed',{minutes:30});
  }
  if(explore.length)return {choice:explore[m.explorations++%explore.length],reason:'explore without assuming unseen food'};
 }
 return wait();
}

const body=(r:Resident)=>({id:r.id,status:r.status,residency:r.residency,at:{...r.at},inside:r.inside,roomAt:r.roomAt,
 canDecide:r.canDecide,canExpress:r.canExpress,
 hunger:r.hunger,energy:r.energy,health:r.health,inventory:{...r.inventory},lastFailure:r.lastFailure,
 planId:r.activity?.planId??r.plan?.id??null,activity:r.activity?.action.type??null,remaining:r.activity?.remaining??null,
 deathAt:r.deathAt,deathCause:r.deathCause??null});
type Trace={sequence:number;actorId:string;selectedAt:number;menuHash:string;promptHash:string;choiceId:string;label:string;reason:string;
 action:Action;meeting:{inputs:MeetingInput[];selected:PolicyMemory['meetingSelection']};danger:ReturnType<typeof dangerInput>;support:ReturnType<typeof supportInput>;completionEvents?:World['events'];accepted:boolean;rejection:string|null;startedAt:number|null;completedAt:number|null;failure:string|null;before:ReturnType<typeof body>;after:ReturnType<typeof body>|null};
type Gift=NonNullable<World['personalFoodGifts']>['gifts'][number];
type GiftDeliveryObservation={gift:Gift;fromMinute:number;throughMinute:number;giverBefore:ReturnType<typeof body>|null;giverAfter:ReturnType<typeof body>|null;
 recipientBefore:ReturnType<typeof body>|null;recipientAfter:ReturnType<typeof body>|null;deliveryReceiptPresent:boolean};

export function runNineResidentMenuStress(options:{days:number;reload?:boolean;waitOnly?:boolean;maxDecisions?:number;policy?:PolicyVersion;survivalEvidence?:boolean}) {
 assert.ok(Number.isInteger(options.days)&&options.days>=1&&options.days<=35,'bounded synthetic days required');
 const directory=mkdtempSync(join(testTmpdir(),'nine-menu-stress-')),database=join(directory,'synthetic.sqlite');
 // Concatenated gzip members bound retained menu evidence without dropping rows.
 const journal=join(directory,'decisions.jsonl.gz'),checkpoints:unknown[]=[],trace:Trace[]=[],daily:unknown[]=[],issues:unknown[]=[],deaths:unknown[]=[];
 const record=(value:unknown)=>appendFileSync(journal,gzipSync(JSON.stringify(value)+'\n'));
 let world=createFrontierWorld(5401),storedRevision:number|null=null;
 const initialFingerprint=persistedWorldFingerprint(world),founderIds=world.residents.map(r=>r.id),from=world.minute,end=from+options.days*DAY;
 const initialResources=resourceState(world,founderIds),policy=options.policy??DEFAULT_MENU_STRESS_POLICY,decisionBudget=options.maxDecisions??30000;
 const source=sourceManifest(fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''));
 const helperSource=readFileSync(fileURLToPath(import.meta.url));
 const manifest={schema:4,executionKind:'offline-scripted-final-menu',policy:options.waitOnly?'wait-only-negative-control':MENU_STRESS_POLICIES[policy],decisionBudget,v4PolicyLimits:V4_POLICY_LIMITS,v5PolicyLimits:V5_POLICY_LIMITS,
  options,seed:5401,fromMinute:from,endMinute:end,initialFingerprint,sourceFingerprint:source.sourceFingerprint,
  helperSha256:createHash('sha256').update(helperSource).digest('hex'),
  node:process.version,realModelExecuted:false,modelAutonomyAcceptancePassed:null,technicalWaitMinutes:null};
 writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
 writeFileSync(join(directory,'controller-source.ts'),helperSource);
 const survival=options.survivalEvidence?createSurvivalEvaluator():null,survivalLines:string[]=[];
 const flushSurvival=()=>{if(survivalLines.length){appendFileSync(join(directory,'survival-evidence.jsonl.gz'),gzipSync(survivalLines.join('')));survivalLines.length=0;}};
 const observeSurvival=(row:SurvivalRecord)=>{if(survival){survival.accept(row);survivalLines.push(JSON.stringify(row)+'\n');if(survivalLines.length>=256)flushSurvival();}};
 if(survival){
  writeFileSync(join(directory,'survival-evaluator-source.ts'),readFileSync(new URL('./nine-resident-survival.ts',import.meta.url)));
  observeSurvival({type:'header',schema:1,executionKind:'offline-scripted-survival-observation',worldId:world.id,seed:5401,
   fromMinute:from,endMinute:end,contract:SURVIVAL_CONTRACT,initialFingerprint,sourceFingerprint:source.sourceFingerprint,helperSha256:manifest.helperSha256,initial:survivalSnapshot(world)});
 }
 const observedStep=(minutes:number)=>{const observation=stepWorldWithFoodEvidence(world,minutes);
  if(survival)observeSurvival({type:'step',snapshot:survivalSnapshot(world),food:survivalFood(observation)});return observation;};
 const memories=new Map(founderIds.map(id=>[id,memory()])),pending=new Map<string,Trace>();
 const lastInputs=new Map<string,{context:DecisionContext;choices:ActionChoice[]}>(),firstProblems=new Set<string>();
 const giftDeliveryObservations:GiftDeliveryObservation[]=[],observedGiftDeliveries=new Set<string>();
 const food=createNineFoodEvidence(world.id,from),timings=Object.fromEntries(founderIds.map(id=>[id,{walk:0,sleep:0,work:0,chosenWait:0,queuedPlan:0,idle:0}]));
 let nextDay=DAY,coverageMinutes=0,exception:string|null=null,shareReload=false,cropReload=false,eatReload=false;
 const reloaded=new Set<string>();
 function reload(stage:string){
  if(options.reload===false||reloaded.has(stage))return;
  const prior=persistedWorldFingerprint(world),store=new WorldStore(database);
  try{store.commit(world,storedRevision);storedRevision=world.revision;}finally{store.close();}
  const next=new WorldStore(database);let restored;try{restored=next.load()!;}finally{next.close();}
  assert.equal(persistedWorldFingerprint(restored),prior,'exact persisted synthetic state after close/reopen');
  world=restored;reloaded.add(stage);checkpoints.push({stage,at:world.minute,fingerprint:prior,pending:[...pending.values()].map(t=>t.sequence)});
 }
 function problem(r:Resident,kind:string,before:ReturnType<typeof body>){
  const key=r.id+':'+kind;if(firstProblems.has(key))return;firstProblems.add(key);
  const input=lastInputs.get(r.id),recent=trace.filter(t=>t.actorId===r.id).slice(-12);
  const diagnosis={kind,at:world.minute,before,after:body(r),recent,context:input?.context??null,choices:input?.choices??null,
   lastDecisionInputAt:input?.context.minute??null,lastDecisionInputAgeMinutes:input?world.minute-input.context.minute:null,
   lastDecisionDanger:input?dangerInput(input.context,input.choices):null,
   recentWitnessedEvents:world.events.filter(e=>e.actors.includes(r.id)||e.witnesses?.includes(r.id)).slice(-16),
   interpretation:kind==='death'?'Death cause is the stored engine cause; preceding decisions and effects are separate evidence.':'Observed state transition, not a complete gross-damage attribution.'};
  writeFileSync(join(directory,`first-${r.id}-${kind}.json`),JSON.stringify(diagnosis,null,2));
  issues.push({actorId:r.id,kind,at:world.minute,evidence:`first-${r.id}-${kind}.json`});
  if(kind==='death')deaths.push({actorId:r.id,at:world.minute,recordedCause:r.deathCause??null,
   relatedDeathEvents:world.events.filter(e=>e.kind==='death'&&e.at===world.minute&&e.actors.includes(r.id)),
   before,after:body(r),lastDecisionInputAt:diagnosis.lastDecisionInputAt,lastDecisionInputAgeMinutes:diagnosis.lastDecisionInputAgeMinutes,
   lastDecisionDanger:diagnosis.lastDecisionDanger,retreats:trace.filter(t=>t.actorId===r.id&&t.action.type==='frontierHazard'&&t.action.operation==='retreat').map(t=>({sequence:t.sequence,selectedAt:t.selectedAt,completedAt:t.completedAt,failure:t.failure})),
   interpretation:'Recorded engine cause and observed context age, not a counterfactual attribution to the policy.'});
 }
 try{
  world.clock.paused=false; // Same explicit start as the existing synthetic menu chain.
  while(world.minute<end){
   for(const id of founderIds){
    const r=world.residents.find(p=>p.id===id)!;
    if(r.status!=='alive'||!r.canDecide||!r.canExpress||r.plan||r.activity)continue;
    assert.ok(trace.length<decisionBudget,'synthetic decision budget exhausted');
    const context=decisionContext(world,r),prepared=prepareModelDecision(context,undefined,GLM_MODEL);
    lastInputs.set(id,{context:structuredClone(context),choices:structuredClone(prepared.choices)});
    const selected=chooseVisibleMenu(context,prepared.choices,memories.get(id)!,options.waitOnly,policy);
    if(!selected){problem(r,'no-menu-choice',body(r));continue;}
    assert.ok(prepared.choices.includes(selected.choice));assert.match(selected.choice.id,/^\d+$/);
    assert.ok(prepared.messages.some(m=>m.content.includes(selected.choice.id+'. '+selected.choice.label)));
    const raw=JSON.stringify({choice:selected.choice.id,...selected.fields});
    const parsed=parseModelCompletion(context,prepared,{content:raw,finish:'stop',usage:{prompt_tokens:0,completion_tokens:0}},0);
    assert.equal(parsed.decision.actions.length,1);
    const entry:Trace={sequence:trace.length+1,actorId:id,selectedAt:world.minute,menuHash:hash(prepared.choices),promptHash:hash(prepared.messages),
     choiceId:selected.choice.id,label:selected.choice.label,reason:selected.reason,action:parsed.decision.actions[0],meeting:{inputs:structuredClone(memories.get(id)!.meetingInputs??[]),selected:structuredClone(memories.get(id)!.meetingSelection??null)},danger:dangerInput(context,prepared.choices),support:supportInput(context,prepared.choices,memories.get(id)!),accepted:false,rejection:null,
     startedAt:null,completedAt:null,failure:null,before:body(r),after:null};
    const accepted=submitPlan(world,{id:`menu-stress:${entry.sequence}`,actorId:id,actorRevision:r.revision,createdAt:world.minute,
     definition:world.activeDefinitions['action/routine'],...parsed.decision});
    entry.accepted=accepted.ok;entry.rejection=accepted.ok?null:accepted.error??'plan rejected';trace.push(entry);
    record({type:'selected',...entry,context,choices:prepared.choices,raw});
    if(!prepared.choices.some(c=>c.action.type==='eat')&&context.actor.hunger>=30)problem(r,'no-carried-meal',entry.before);
    if(accepted.ok)pending.set(id,entry);else problem(r,'submission-rejected',entry.before);
   }
   const before=new Map(founderIds.map(id=>{const r=world.residents.find(p=>p.id===id)!;return [id,body(r)];}));
   const stockBefore=snapshotNineFood(world,founderIds);
   // A fractional first share step is a real interruption point, not a work edit.
   const dt=Math.min(1,end-world.minute);
   for(const r of world.residents.filter(r=>founderIds.includes(r.id)&&r.status==='alive')){
    const a=r.activity;const kind=a?.path.length||a?.room?.path.length?'walk':a?.action.type==='sleep'?'sleep':a?.action.type==='wait'?'chosenWait':a?'work':r.plan?'queuedPlan':'idle';timings[r.id][kind]+=dt;
   }
   let observation;
   if(!shareReload&&[...pending.values()].some(t=>t.action.type==='shareFoodSource')){
    const first=observedStep(.25);
    for(const [id,entry]of pending){const active=world.residents.find(r=>r.id===id)?.activity;if(active?.planId===`menu-stress:${entry.sequence}`&&entry.startedAt===null)entry.startedAt=active.startedAt;}
    if(world.residents.some(r=>r.activity?.foodSourceShareWork)){shareReload=true;reload('in-flight-sharing');}
    const second=observedStep(.75);
    assert.equal(first.toMinute,second.fromMinute);assert.equal(first.worldId,second.worldId);
    // The existing accounting helper requires consecutive one-minute envelopes.
    // Preserve every actual substep receipt and coverage marker, without rerunning
    // an action or changing its fractional work to satisfy that contract.
    observation={...first,toMinute:second.toMinute};
    for(const key of Object.keys(first) as Array<keyof typeof first>){
     const left=first[key],right=second[key];
     if(Array.isArray(left)){assert.ok(Array.isArray(right));Object.assign(observation,{[key]:[...left,...right]});}
     else if(!['fromMinute','toMinute'].includes(key))assert.deepEqual(left,right);
    }
   }else observation=observedStep(dt);
   coverageMinutes+=observation.toMinute-observation.fromMinute;
   food.sample(stockBefore,snapshotNineFood(world,founderIds),observation);
   // Test-owned observations, after the real engine step. Never used by a policy.
   for(const gift of world.personalFoodGifts?.gifts??[]){
    if(gift.status!=='delivered'||observedGiftDeliveries.has(gift.id))continue;observedGiftDeliveries.add(gift.id);
    const giver=world.residents.find(p=>p.id===gift.giverId),recipient=world.residents.find(p=>p.id===gift.recipientId);
    giftDeliveryObservations.push({gift:structuredClone(gift),fromMinute:observation.fromMinute,throughMinute:observation.toMinute,
     giverBefore:before.get(gift.giverId)??null,giverAfter:giver?body(giver):null,recipientBefore:before.get(gift.recipientId)??null,recipientAfter:recipient?body(recipient):null,
     deliveryReceiptPresent:world.processed.includes('personal-food-gift:delivery:'+gift.id)});
   }
   for(const id of founderIds){
    const r=world.residents.find(p=>p.id===id)!,prior=before.get(id)!,entry=pending.get(id);
    if(entry&&r.activity?.planId===`menu-stress:${entry.sequence}`&&entry.startedAt===null)entry.startedAt=r.activity.startedAt;
    if(entry&&!r.plan&&!r.activity){entry.completedAt=world.minute;
     const actualCompletion=r.recentActions?.some(a=>a.at===world.minute&&a.type===entry.action.type);
     entry.failure=r.lastFailure??(actualCompletion?null:r.status==='dead'?'actor died before completion':'action ended without completion evidence');entry.after=body(r);pending.delete(id);
     if(['frontierHazard','personalFoodGift','commons'].includes(entry.action.type))entry.completionEvents=world.events.filter(e=>e.at===world.minute&&e.actors.includes(id));
     record({type:'finished',...entry});if(entry.failure)problem(r,'action-failed',prior);}
    if(r.health<prior.health-1e-9)problem(r,'health-decline',prior);
    if(r.hunger>=95&&prior.hunger<95)problem(r,'critical-hunger',prior);
    if(r.energy<=2&&prior.energy>2)problem(r,'critical-energy',prior);
    if(r.status==='alive'&&(prior.canDecide&&!r.canDecide||prior.canExpress&&!r.canExpress))problem(r,'capability-loss',prior);
    if(r.status==='dead'&&prior.status!=='dead')problem(r,'death',prior);
   }
   if(!cropReload&&world.minute>=DAY*2&&world.plots.some(p=>p.crop&&p.crop.growth>0)){cropReload=true;reload('growing-crop');}
   if(!eatReload&&observation.foodFlows?.some(f=>f.action==='harvest')){eatReload=true;reload('harvest-before-next-decision');}
   if(world.minute>=nextDay){
    daily.push({at:world.minute,people:world.residents.filter(r=>founderIds.includes(r.id)).map(body),stock:snapshotNineFood(world,founderIds),resources:resourceState(world,founderIds)});
    nextDay+=DAY;
   }
  }
  reload('endpoint');
 }catch(error){exception=error instanceof Error?error.stack??error.message:String(error);}
 const evidence=food.finish(),finished=trace.filter(t=>t.accepted&&t.completedAt!==null&&t.failure===null),final=world.residents.filter(r=>founderIds.includes(r.id)).map(body);
 const count=(type:Action['type'])=>finished.filter(t=>t.action.type===type).length;
 const retreats=trace.filter(t=>t.action.type==='frontierHazard'&&t.action.operation==='retreat');
 const giftDiagnostics=(world.personalFoodGifts?.gifts??[]).map(gift=>{
  const offer=finished.find(t=>t.actorId===gift.giverId&&t.action.type==='personalFoodGift'&&t.action.operation==='offer'&&t.action.receiptId===gift.receiptId);
  const accept=finished.find(t=>t.actorId===gift.recipientId&&t.action.type==='personalFoodGift'&&t.action.operation==='accept'&&t.action.giftId===gift.id);
  const deliver=finished.find(t=>t.actorId===gift.giverId&&t.action.type==='personalFoodGift'&&t.action.operation==='deliver'&&t.action.giftId===gift.id);
  const observed=giftDeliveryObservations.find(o=>o.gift.id===gift.id)??null;
  const laterEat=gift.status==='delivered'?finished.find(t=>t.actorId===gift.recipientId&&t.selectedAt>=gift.endedAt!
   &&t.action.type==='eat'&&t.action.item===gift.item):undefined;
  const receipt=laterEat?evidence.directEating.receipts.find(r=>r.planId==='menu-stress:'+laterEat.sequence)??null:null;
  const nextChoice=gift.status==='delivered'?trace.find(t=>t.actorId===gift.recipientId&&t.selectedAt>=gift.endedAt!):undefined;
  const otherDelivery=observed&&laterEat&&giftDeliveryObservations.some(o=>o.gift.id!==gift.id&&o.gift.recipientId===gift.recipientId&&o.gift.item===gift.item
   &&o.gift.endedAt!>=gift.endedAt!&&o.gift.endedAt!<=laterEat.completedAt!);
  const spoiled=observed&&laterEat&&evidence.foodLosses.receipts.some(r=>r.container==='person:'+gift.recipientId&&r.amount.item===gift.item
   &&r.at>gift.endedAt!&&r.at<=laterEat.completedAt!);
  const zeroStockNextEatLink=!!(offer&&accept&&deliver&&observed?.deliveryReceiptPresent&&receipt&&nextChoice===laterEat
   &&gift.quantity===1&&(observed.recipientBefore?.inventory[gift.item]??0)===0&&observed.recipientAfter?.inventory[gift.item]===1
   &&(observed.giverBefore?.inventory[gift.item]??0)-(observed.giverAfter?.inventory[gift.item]??0)===1
   &&laterEat!.before.inventory[gift.item]===1&&!otherDelivery&&!spoiled);
  return {gift:structuredClone(gift),offerSequence:offer?.sequence??null,acceptSequence:accept?.sequence??null,deliverSequence:deliver?.sequence??null,
   observed,laterSameItemEating:receipt,zeroStockNextEatLink,
   interpretation:'Offer and acceptance do not transfer food. The optional link is a zero-stock delivery followed by the recipient next choice to eat, not lot-level identity or a complete transfer ledger.'};
 });
 const meetingAttempts=trace.filter(t=>t.meeting.selected);
 const meetingChains=giftDiagnostics.map(g=>{
  const attempts=meetingAttempts.filter(t=>t.meeting.selected!.giftId===g.gift.id&&t.actorId===g.gift.recipientId);
  const accept=g.acceptSequence?trace.find(t=>t.sequence===g.acceptSequence):null;
  const completedBeforeAccept=attempts.filter(t=>t.accepted&&t.completedAt!==null&&!t.failure&&accept&&t.completedAt<=accept.selectedAt);
  return {giftId:g.gift.id,offerSequence:g.offerSequence,meetingSequences:attempts.map(t=>t.sequence),completedBeforeAccept:completedBeforeAccept.map(t=>t.sequence),
   acceptSequence:g.acceptSequence,deliverSequence:g.deliverSequence,zeroStockNextEatLink:g.zeroStockNextEatLink,
   orderedChain:!!(g.offerSequence&&completedBeforeAccept.length&&g.acceptSequence&&g.deliverSequence&&g.zeroStockNextEatLink),
   interpretation:'An observed chronological chain, not proof that this meeting action alone caused acceptance or that a specific gifted lot was eaten.'};
 });
 const meetingCoverage={personalOfferSeen:trace.some(t=>t.meeting.inputs.some(v=>v.offerEventId)),meetingSelected:meetingAttempts.length>0,
  meetingCompleted:meetingAttempts.some(t=>t.accepted&&t.completedAt!==null&&!t.failure),orderedGiftMealChain:meetingChains.some(g=>g.orderedChain)};
 const supportCoverage={giftOffered:giftDiagnostics.some(g=>g.offerSequence!==null),giftAccepted:giftDiagnostics.some(g=>g.acceptSequence!==null),
  giftDelivered:giftDiagnostics.some(g=>g.deliverSequence!==null&&g.observed?.deliveryReceiptPresent),giftNextEatLinked:giftDiagnostics.some(g=>g.zeroStockNextEatLink),
  commonsInspected:finished.some(t=>t.action.type==='commons'&&t.action.operation==='inspectFood'),
  commonsTaken:finished.some(t=>t.action.type==='commons'&&t.action.operation==='takeFood'),
  explorationBackoffUsed:trace.some(t=>['explore while avoiding a personally failed endpoint','wait after all displayed exploration directions recently failed'].includes(t.reason))};
 const retreatDiagnostics={eligibleDecisions:trace.filter(t=>t.danger.eligibleRetreatChoiceIds.length).length,
  selected:retreats.length,completed:retreats.filter(t=>t.accepted&&t.completedAt!==null&&!t.failure).length,
  failed:retreats.filter(t=>!t.accepted||t.failure).length,pending:retreats.filter(t=>t.accepted&&t.completedAt===null).length,
  unchosenEligibleDecisions:trace.filter(t=>t.danger.eligibleRetreatChoiceIds.length&&!t.danger.eligibleRetreatChoiceIds.includes(t.choiceId)).length,
  outcomes:retreats.map(t=>({sequence:t.sequence,actorId:t.actorId,selectedAt:t.selectedAt,completedAt:t.completedAt,accepted:t.accepted,failure:t.failure,
   elapsed:t.completedAt===null?null:t.completedAt-t.selectedAt,netEnergyChange:t.after?t.after.energy-t.before.energy:null,
   netHungerChange:t.after?t.after.hunger-t.before.hunger:null,netHealthChange:t.after?t.after.health-t.before.health:null}))};
 const counts=Object.fromEntries(founderIds.map(id=>[id,{selected:trace.filter(t=>t.actorId===id).length,
  completed:finished.filter(t=>t.actorId===id).length,failed:trace.filter(t=>t.actorId===id&&(!t.accepted||t.failure)).length,
  eaten:evidence.directEating.receipts.filter(r=>r.residentId===id).reduce((n,r)=>n+r.quantity,0),
  nutrition:evidence.directEating.receipts.filter(r=>r.residentId===id).reduce((n,r)=>n+r.nutrition,0),
  completedSleeps:finished.filter(t=>t.actorId===id&&t.action.type==='sleep').length,
  netSleepEnergyGain:finished.filter(t=>t.actorId===id&&t.action.type==='sleep').reduce((n,t)=>n+(t.after!.energy-t.before.energy),0),
  sampledPreStepStateMinutes:timings[id],issues:issues.filter((v:any)=>v.actorId===id)}]));
 const gates={exactEndpoint:world.minute===end,defaultNine:world.residents.length===9&&same(world.residents.map(r=>r.id),founderIds),
  allNineAte:founderIds.every(id=>counts[id].eaten>0),allNineSlept:founderIds.every(id=>counts[id].completedSleeps>0),
  share:count('shareFoodSource')>0,heardAddressVisit:finished.some(t=>t.reason==='independently inspect a heard address'),
  plant:finished.some(t=>t.action.type==='production'&&t.action.operation==='plantCrop'),water:count('water')>0,harvest:count('harvest')>0,
  saveSeed:finished.some(t=>t.action.type==='production'&&t.action.operation==='saveSeed'),
  replant:finished.some(t=>{const a=t.action;return a.type==='production'&&a.operation==='plantCrop'&&finished.some(h=>h.action.type==='harvest'&&h.action.plotId===a.plotId&&h.completedAt!<t.selectedAt);}),
  reloaded:checkpoints.length>0,nineAlive:final.every(r=>r.status==='alive')};
 const actionCoveragePassed=exception===null&&Object.entries(gates).filter(([k])=>k!=='nineAlive'&&k!=='reloaded').every(([,v])=>v);
 const report={...manifest,directory,throughMinute:world.minute,coverageMinutes,exception,gates,
  scriptedSurvivalPassed:exception===null&&actionCoveragePassed&&gates.nineAlive,actionCoveragePassed,
  realModelExecuted:false,modelAutonomyAcceptancePassed:null,completeFoodLedger:false,
  limitations:['All choices are scripted, not autonomous model decisions.','Direct engine advancement does not exercise runtime admission, network latency or technical waiting.',
   'Net health/energy changes do not prove a complete gross-damage ledger.','Finite resources, legal-menu gaps and policy mistakes may kill residents; no inventory or initial-world repair is performed.',
   'sampledPreStepStateMinutes classifies each interval by the state before advancement, not exact activity durations. queuedPlan separates plans not yet observed as active.',
   'startedAt=null means the start was not sampled, including actions completed in a single step; completion receipts remain independent evidence.',
   'Reloads are within-process SQLite close/reopen checks, not process-crash recovery. Controller memory remains in this process.',
   'v3 prioritizes a current personal-context retreat only when the same action is in the final menu; it does not interrupt existing actions or guarantee safety.',
   'v5 matches unique personal offer memories to live stops and uses at most three existing menu steps toward a current or at most 120-minute-old personal sighting. Old locations, indoor visits and completion do not guarantee a meeting.',
   'v4 adds personally witnessed finite gift offers, independent acceptance, attempted delivery, own failed-exploration feedback and commons inspection. None guarantees food or safety.',
   'Gift delivery observations compare the real engine step and stored receipt; a later same-item meal alone does not prove the original gifted lot was eaten.',
   'This bounded policy omits medical treatment, trade, household pools and seasonal crop switching; v2/v3 omit gift provisioning. Unchosen legal options remain in the journal.'],
  decisions:trace.length,completed:finished.length,pending:pending.size,counts,issues,checkpoints,daily,final,evidence,
  retreatDiagnostics,deaths,resources:{initial:initialResources,final:resourceState(world,founderIds)},giftDiagnostics,
  meetingCoverage,meetingCoveragePassed:exception===null&&Object.values(meetingCoverage).every(Boolean),meetingChains,
  meetingDiagnostics:{selected:meetingAttempts.length,completed:meetingAttempts.filter(t=>t.accepted&&t.completedAt!==null&&!t.failure).length,
   failed:meetingAttempts.filter(t=>!t.accepted||t.failure).length,pending:meetingAttempts.filter(t=>t.accepted&&t.completedAt===null).length,
   inputStatusCounts:trace.flatMap(t=>t.meeting.inputs).reduce((out:Record<string,number>,v)=>{out[v.status]=(out[v.status]??0)+1;return out;},{})},
  supportCoverage,supportCoveragePassed:exception===null&&Object.values(supportCoverage).every(Boolean),
  explorationDiagnostics:{failedAttempts:trace.filter(t=>t.label.includes('探索6格')&&(!t.accepted||t.failure)).length,
   backoffSelections:trace.filter(t=>['explore while avoiding a personally failed endpoint','wait after all displayed exploration directions recently failed'].includes(t.reason)).length,
   learnedFailures:[...new Map(trace.filter(t=>t.support.lastExplorationFeedback).map(t=>{const f=t.support.lastExplorationFeedback!;return [hash(f),f];})).values()]}};
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));
 writeFileSync(join(directory,'trace.json'),JSON.stringify(trace,null,2));
 if(survival){
  observeSurvival({type:'close',at:world.minute,exception,actionCoverage:gates,supportCoverage,reloaded:gates.reloaded});flushSurvival();
  writeFileSync(join(directory,'survival-verdict.json'),JSON.stringify(survival.finish(),null,2));
 }
 return report;
}
