import type {DecisionContext,FormalOpportunity,ModelDecision,Resident,World} from '../shared/types.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {ordinaryVisitorJourney,visitorStageMinutes,type VisitorJourney,type VisitorJourneyAction} from '../shared/visitor-journey.js';
import {calendar,ageYears,DAY} from './time.js';
import {emitLedgerEvent} from './events.js';
import {advanceFood,foodTransaction,foodValue} from './food.js';
import {journeyMealInputs,recordJourneyMeal,type JourneyMealReceipt} from './food-consumption-evidence.js';
import {journeySupplyNote} from './visitor-guidance.js';
import {physiology} from './physiology.js';
import {recordDeath} from './life.js';
import {advanceHealth,movementRate} from './health.js';
import {copyForSimulation} from './simulation-copy.js';
import {endDecisionProtection,needHealthDrain,noteSurvivalRelief,protectedNeedMinutes,recordProtectionLoss,settleDecisionProtection,SURVIVAL_FORECAST_MINUTES} from './decision-protection.js';

export const visitorJourneyCapable=(w:World,r:Resident)=>r.status==='alive'&&r.health>0&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const nextStage=(w:World,r:Resident,j:VisitorJourney)=>{const remaining=j.direction==='valley'?j.progress:j.duration-j.progress,rate=movementRate(w,r);return remaining>0?Math.min(visitorStageMinutes(j.duration),rate>0?remaining/rate:visitorStageMinutes(j.duration)):j.direction==='valley'?30:0;};
const person=(w:World,id:string)=>w.residents.find(r=>r.id===id)??w.migration?.contacts.find(c=>c.id===id)?.person;
export function visitorJourneyLocation(r:Resident,j:VisitorJourney){r.at={x:-1,y:-1};r.inside=null;r.roomAt=null;r.regionalLocation={routeId:j.routeId??j.id,origin:j.origin,progress:j.progress,duration:j.duration};}
function fact(w:World,r:Resident,j:VisitorJourney,text:string){
 const e=emitLedgerEvent(w,{kind:'action',actors:[r.id],place:{...r.at},regionalLocation:{...r.regionalLocation!},text});j.eventIds.push(e.id);
 if(r.status==='alive'&&r.canDecide&&r.canExpress){r.memories.push({eventId:e.id,receivedAt:w.minute,source:'self',text});if(r.memories.length>80)r.memories.splice(0,r.memories.length-80);}
 return e;
}
/** A menu read never creates, dates or replenishes food. An unknown or expired lot is not edible here. */
export function visitorJourneyFood(w:World,r:Resident,item:VisitorJourneyAction['item']):boolean {
 if(!item||!Object.hasOwn(goods,item)||goods[item].food<=0||(r.inventory[item]??0)<1)return false;
 const lots=w.food?.lots['person:'+r.id]?.[item]??[];
 // Refuse an out-of-date ledger until normal expiry has removed its earliest lots.
 if(lots.some(l=>!Number.isFinite(l.expiresAt)||l.expiresAt<=w.minute))return false;
 return lots.reduce((n,l)=>n+(Number.isFinite(l.quantity)&&l.quantity>0?l.quantity:0),0)>=1;
}
export function startVisitorJourney(w:World,r:Resident,origin:string,duration:number,family?:VisitorJourney['family']):VisitorJourney {
 const j:VisitorJourney={id:`visit:${r.id}:${w.minute}:${r.revision}`,origin,duration,progress:duration,direction:'valley',status:'travelling',stageRemaining:visitorStageMinutes(duration),updatedAt:w.minute,needsAt:w.minute,reason:null,eventIds:[],...(family?{family,routeId:family.id}: {})};
 visitorJourneyLocation(r,j);r.plan=null;r.activity=null;r.decisionDue=w.minute+j.stageRemaining;
 endDecisionProtection(w,r,'decision');fact(w,r,j,`${r.name}自行从${origin}开始${family?'已分别同意的成人亲属同行':'单人来访'}，全程${duration}分钟；本次仅走${j.stageRemaining}分钟，之后${family?'双方须分别另选才续同行，本人也可选择离队':'本人另选继续'}、进食、休息或原路返回。没有接待或床位承诺。`);return j;
}
export function visitorJourneyCandidate(w:World,r:Resident):boolean {
 const j=ordinaryVisitorJourney(w,r);return visitorJourneyCapable(w,r)&&!!j&&j.status==='waiting'&&!j.pause&&r.decisionDue<=w.minute;
}
export function visitorJourneyContext(w:World,r:Resident):DecisionContext {
 const j=ordinaryVisitorJourney(w,r);if(!j)throw new Error('outside_opportunity_expired');
 const remaining=j.direction==='valley'?j.progress:j.duration-j.progress,stage=nextStage(w,r,j);
 const choices:FormalOpportunity[]=[{id:'visit.continue.'+j.id,label:remaining>0?`本人再走${stage}分钟，沿已选方向${j.direction==='valley'?'前往谷口':'返回原居地'}；这一段后另选`:'本人留在谷口外等30分钟，再实际查路，不承诺入口已通',action:{type:'visitorJourney',operation:'continue',journeyId:j.id,minutes:stage}}];
 if(j.direction==='valley')choices.push({id:'visit.return.'+j.id,label:`取消来访，从实际位置原路返回${j.origin}，至少${j.duration-j.progress}分钟路程；本次至多走${visitorStageMinutes(j.duration)}分钟`,action:{type:'visitorJourney',operation:'turnBack',journeyId:j.id}});
 choices.push({id:'visit.rest.'+j.id,label:'本人停步坐下休息30分钟，不是床位；完成后另行决定',action:{type:'visitorJourney',operation:'rest',journeyId:j.id}});
 for(const item of itemKeys)if(visitorJourneyFood(w,r,item))choices.push({id:'visit.eat.'+j.id+'.'+item,label:`本人停步5分钟吃随身1份${itemLabels[item]}；完成时仍须有原批次食品，吃完另选`,action:{type:'visitorJourney',operation:'eat',journeyId:j.id,item}});
 return {outside:{origin:j.origin,notice:`你在${j.origin}与谷口之间的实际驿路上，离谷口${j.progress}/${j.duration}分钟，当前${j.direction==='valley'?'前往山谷':'返回原居地'}至少还有${remaining}分钟基准路程，实际耗时还受本人伤病影响。${j.reason??'只推进本人已选的一段，不自动续程。'}${journeySupplyNote(w,r,remaining===0&&j.direction==='valley'?30:remaining)}`,choices},actor:{id:r.id,name:r.name,traits:r.traits,hunger:r.hunger,energy:r.energy,health:r.health,inventory:{...r.inventory},skills:{...r.skills},intention:r.intention,at:{...r.at},homeId:r.homeId,lastFailure:r.lastFailure},minute:w.minute,season:calendar(w.minute).season,weather:w.weather,bounds:{width:w.map.width,height:w.map.height},people:[],buildings:[],resources:[],plots:[],offers:[],proposals:[],knownLand:[],memories:r.memories.slice(-8)};
}
export function applyVisitorJourneyDecision(w:World,r:Resident,revision:number,d:ModelDecision):{ok:boolean;error?:string} {
 const j=ordinaryVisitorJourney(w,r),a=d.actions[0];
 if(!j||!visitorJourneyCandidate(w,r)||r.revision!==revision||d.actions.length!==1||a?.type!=='visitorJourney'||a.journeyId!==j.id)return {ok:false,error:'本人实际旅程或本段独立选择已经变化'};
 if(!['continue','turnBack','eat','rest'].includes(a.operation)||a.operation==='turnBack'&&j.direction!=='valley')return {ok:false,error:'当前没有这项驿路选择'};
 if(a.operation==='continue'&&(!Number.isFinite(a.minutes)||a.minutes!<=0||a.minutes!>(j.direction==='valley'&&j.progress===0?30:visitorStageMinutes(j.duration))))return {ok:false,error:'继续行走的本人已选时长无效或超过本段上限'};
 if(a.operation==='eat'&&!visitorJourneyFood(w,r,a.item))return {ok:false,error:'本人没有已核实且仍可食用的一份原随身食品'};
 endDecisionProtection(w,r,'decision');j.updatedAt=w.minute;j.reason=null;
 r.intention=d.intention.slice(0,160);r.lastDecisionAt=w.minute;r.lastFailure=null;r.revision++;
 const c=w.migration!.contacts.find(c=>c.id===r.id)!;c.lastDecisionAt=w.minute;c.phase='travelling';c.journey!.blocked=false;
 if(a.operation==='eat'||a.operation==='rest'){
  j.pause={kind:a.operation,item:a.item,remaining:a.operation==='eat'?5:30};j.status='waiting';j.stageRemaining=0;r.decisionDue=w.minute+j.pause.remaining;
  j.reason=a.operation==='eat'?'本人停步吃随身食品':'本人原地坐下休息';fact(w,r,j,`${r.name}${j.reason}，实际花费${j.pause.remaining}分钟，完成后不自动继续赶路。`);
 }else{
  if(a.operation==='turnBack')j.direction='home';
  j.status='travelling';j.stageRemaining=a.operation==='continue'?a.minutes!:nextStage(w,r,j);
  r.decisionDue=w.minute+j.stageRemaining;c.journey!.nextCheckAt=r.decisionDue;
  fact(w,r,j,`${r.name}自行选择${a.operation==='turnBack'?'原路折返':'继续已选方向'}，本次${j.stageRemaining}分钟；离谷口仍为${j.progress}/${j.duration}分钟，不瞬间移动。`);
 }
 return {ok:true};
}
export function waitVisitorJourney(w:World,r:Resident,j:VisitorJourney,reason:string){
 j.status='waiting';j.stageRemaining=0;j.reason=reason;r.decisionDue=w.minute;r.revision++;
 const c=w.migration!.contacts.find(c=>c.id===r.id)!;c.phase='offered';c.offeredAt=w.minute;
 return fact(w,r,j,`${r.name}${reason}。`);
}
/** Only consumes the currently authorized stage. Leftover time never buys another stage. */
export function advanceVisitorJourney(w:World,r:Resident,enter:()=>void):void {
 const j=ordinaryVisitorJourney(w,r);if(!j)return;
 const elapsed=Math.max(0,w.minute-j.updatedAt);j.updatedAt=w.minute;
 if(r.status==='alive'&&r.health<=0)recordDeath(w,r);
 if(r.status!=='alive'){
  delete j.pause;j.status='interrupted';j.reason='本人在实际驿路原址离世，旅程中断';const c=w.migration!.contacts.find(c=>c.id===r.id)!;c.phase='home';c.futureAt=Number.MAX_SAFE_INTEGER;
  endDecisionProtection(w,r,'incapable');fact(w,r,j,`${r.name}${j.reason}，不新增访客或搬回遗体和物资。`);return;
 }
 settleDecisionProtection(w,r);
 if(!visitorJourneyCapable(w,r)){if(j.status!=='waiting'||j.pause){delete j.pause;waitVisitorJourney(w,r,j,'暂时失去自主行动能力，停在实际位置，恢复后须本人重新决定');}return;}
 if(j.status!=='travelling')return;
 const spent=Math.min(elapsed,j.stageRemaining),remaining=j.direction==='valley'?j.progress:j.duration-j.progress,walked=Math.min(remaining,spent*movementRate(w,r));j.stageRemaining=Math.max(0,j.stageRemaining-spent);
 j.progress=Math.max(0,Math.min(j.duration,j.progress+(j.direction==='valley'?-walked:walked)));
 // Fractional runtime ticks must agree with the endpoint tolerance used below.
 if(j.progress<=1e-9)j.progress=0;else if(j.duration-j.progress<=1e-9)j.progress=j.duration;
 if(remaining>0&&walked>=remaining-1e-9)j.stageRemaining=0;visitorJourneyLocation(r,j);
 if(j.stageRemaining>1e-9)return;
 if(j.direction==='valley'&&j.progress<=1e-9){
  enter();if(r.residency!=='outside')return;
  waitVisitorJourney(w,r,j,'到达谷口外遇到实际路阻，可自行选择等待30分钟再查路或原路返回');return;
 }
 if(j.direction==='home'&&j.progress>=j.duration-1e-9){
  const c=w.migration!.contacts.find(c=>c.id===r.id)!;j.status='returned';j.reason='已实际走回原居地';c.phase='home';c.futureAt=w.minute+14*DAY;r.decisionDue=c.futureAt;r.revision++;
  fact(w,r,j,`${r.name}已实际沿原路返回${j.origin}，本次来访结束；身份、物资和原保质期保持，不登记一次未发生的入谷。`);c.journey=null;return;
 }
 waitVisitorJourney(w,r,j,'已走完本人选择的这一段，等待本人决定继续、进食、休息或返回');
}
/** Engine-owned body time also applies to first visitors who are not on the town register. */
export function advanceVisitorJourneyNeeds(w:World,technicalWait=false):void {
 for(const c of w.migration?.contacts??[]){
  const r=person(w,c.id),j=r&&ordinaryVisitorJourney(w,r);if(!r||!j||r.status!=='alive')continue;
  if(r.health<=0){recordDeath(w,r);continue;}
  const elapsed=Math.max(0,w.minute-j.needsAt);j.needsAt=w.minute;if(!elapsed)continue;
  const before={hunger:r.hunger,energy:r.energy},hadChoice=!!j.pause||!!j.family?.ready||j.status==='travelling',rules=physiology(w,r),pause=j.pause;
  if(pause&&visitorJourneyCapable(w,r)){
   const spent=Math.min(elapsed,pause.remaining);pause.remaining-=spent;
   if(pause.kind==='rest')r.energy=Math.min(100,r.energy+spent*4/30);
   if(pause.remaining<=1e-9){
    let meal:Omit<JourneyMealReceipt,'eventId'>|undefined;
    if(pause.kind==='eat'&&visitorJourneyFood(w,r,pause.item)){
     const item=pause.item!,container='person:'+r.id,inputs=journeyMealInputs(w,r,item),hungerBefore=r.hunger,nutrition=foodValue(w,container,item);
     foodTransaction(w,()=>{r.inventory[item]!-=1;});r.hunger=Math.max(0,r.hunger-nutrition);j.reason=`吃完本人一份${itemLabels[item]}，等待本人另选`;
     if(inputs)meal={action:'visitorJourney',operation:'eat',at:w.minute,providerId:r.id,beneficiaryId:r.id,journeyId:j.id,container,inputs,hungerBefore,hungerAfter:r.hunger,hungerRelief:hungerBefore-r.hunger};
    }else j.reason=pause.kind==='rest'?'完成原地休息，等待本人另选':'原批次食品已不足或腐败，没有进食，等待本人另选';
    delete j.pause;const event=waitVisitorJourney(w,r,j,j.reason);
    if(meal)recordJourneyMeal(w,{...meal,action:'visitorJourney',operation:'eat',eventId:event.id});
   }
  }
  r.hunger=Math.min(100,r.hunger+rules.hungerPerMinute*elapsed);r.energy=Math.max(0,r.energy-rules.energyPerMinute*elapsed);
  const protectedMinutes=technicalWait&&!hadChoice?protectedNeedMinutes(w,r,elapsed,()=>hasTimelyVisitorJourneyRescue(w,r)):0;
  const drain=needHealthDrain(w,r);for(const source of ['hunger','exhaustion'] as const){const loss=Math.min(r.health,drain[source]*(elapsed-protectedMinutes));r.health-=loss;recordProtectionLoss(r,source,loss);if(r.decisionProtection?.endedAt===null)r.decisionProtection.prevented[source]+=drain[source]*protectedMinutes;}
  noteSurvivalRelief(w,r,before);if(r.health<=0)recordDeath(w,r);
 }
}
/** Hypothetical self-care only, never an autonomous decision in the real world. */
export function hasTimelyVisitorJourneyRescue(world:World,resident:Resident):boolean {
 if(!visitorJourneyCandidate(world,resident))return false;
 const rules=physiology({...world,definitions:{...world.definitions}},resident);
 if(resident.hunger>rules.hungerDanger&&!itemKeys.some(item=>visitorJourneyFood(world,resident,item)))return false;
 const w=copyForSimulation(world),r=person(w,resident.id)!;delete r.decisionProtection;const before={hunger:r.hunger,energy:r.energy};
 for(let minute=0;minute<SURVIVAL_FORECAST_MINUTES;minute++){
  const j=ordinaryVisitorJourney(w,r);if(!j||!visitorJourneyCapable(w,r))return false;
  if(!j.pause){const item=itemKeys.find(item=>visitorJourneyFood(w,r,item)),a:VisitorJourneyAction={type:'visitorJourney',journeyId:j.id,operation:needHealthDrain(w,r).hunger>0&&item?'eat':'rest',item};if(!applyVisitorJourneyDecision(w,r,r.revision,{intention:'检验实际自救可达性',actions:[a]}).ok)return false;}
  w.minute++;advanceFood(w);advanceVisitorJourneyNeeds(w);advanceHealth(w,1);
  if(!visitorJourneyCapable(w,r))return false;const drain=needHealthDrain(w,r);if(drain.hunger+drain.exhaustion===0&&(r.hunger<before.hunger||r.energy>before.energy))return true;
 }
 return false;
}
