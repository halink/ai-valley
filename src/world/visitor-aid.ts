import type {DecisionContext,FormalOpportunity,ModelDecision,Resident,World} from '../shared/types.js';
import {regionalDecisionWait,type OutsideAidAction,type VisitorAidJourney} from '../shared/outside-aid.js';
import {canDepart,recordDeparture,knownStationDuration,stationDuration,passableEntry} from './migration.js';
import {initializeOutsideAid,receiveAidMail} from './outside-aid-mail.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {journeySupplyNote,observeGateDirections} from './visitor-guidance.js';
import {physiology} from './physiology.js';
import {copyForSimulation} from './simulation-copy.js';
import {protectedNeedMinutes,needHealthDrain,recordProtectionLoss,endDecisionProtection,SURVIVAL_FORECAST_MINUTES} from './decision-protection.js';
import {advanceHealth} from './health.js';
import {recordDeath,advanceLife} from './life.js';
import {foodTransaction,foodValue,advanceFood} from './food.js';
import {journeyMealInputs,recordJourneyMeal,type JourneyMealReceipt} from './food-consumption-evidence.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {ageYears,calendar} from './time.js';
import {distance,same,walkable} from './navigation.js';
const capable=(w:World,r:Resident)=>r.status==='alive'&&r.health>0&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const journey=(w:World,r:Resident,id?:string)=>w.outsideAid?.visitorJourneys?.find(j=>j.personId===r.id&&(id?j.id===id:['travelling','waiting'].includes(j.status)));
const contact=(w:World,r:Resident)=>w.migration?.contacts.find(c=>c.id===r.id&&!c.person);
const recipient=(w:World,origin:string)=>w.foreignTrade?.merchants.find(m=>m.origin===origin);
const selfMemory=(r:Resident,id:string,text:string,minute:number)=>{r.memories.push({eventId:id,receivedAt:minute,source:'self',text});if(r.memories.length>80)r.memories.shift();};
function remoteFact(w:World,j:VisitorAidJourney,r:Resident,text:string){const e=emitLedgerEvent(w,{kind:'care',actors:[r.id],place:{...r.at},regionalLocation:r.regionalLocation?{...r.regionalLocation}:undefined,text});j.eventIds.push(e.id);if(r.status==='alive'&&r.canDecide)selfMemory(r,e.id,text,w.minute);return e;}
export function visitorAidReason(w:World,r:Resident,a:OutsideAidAction):string|null{
 if(w.mode!=='formal'||!w.foreignTrade)return '当前没有可核实的正式驿路';
 if(!capable(w,r))return '须由能自主决定与表达的成年访客本人选择捎信';
 const c=contact(w,r);if(!c)return '没有本人实际入谷及原居地的既有记录';
 if(a.operation==='carryMail'){
  if(r.residency!=='visitor'||c.phase!=='inTown'||r.inside||distance(r.at,w.map.entrance)>8)return '须是已经实际入谷并在谷口附近的原访客';
  const error=canDepart(w,r);if(error)return error;
  const n=w.outsideAid?.notices.find(n=>n.id===a.noticeId);
  if(!n||n.mail||n.withdrawnAt!==null||n.expiresAt<=w.minute)return '谷口没有这份仍有效、尚未捎走的原信';
  return knownStationDuration(w,c.origin)!==null&&recipient(w,c.origin)?null:'本人原居地没有可核实的既有接收商行，不能假定异地相连';
 }
 const j=journey(w,r,a.journeyId);
 if(c.phase!=='carryingMail'||r.residency!=='outside'||!j||!['travelling','waiting'].includes(j.status))return '本人没有这段仍可改变决定的实际捎信回程';
 if(a.operation==='eatMail')return a.item&&Object.hasOwn(goods,a.item)&&goods[a.item].food>0&&(r.inventory[a.item]??0)>=1?null:'本人没有这份实际随身食品';
 if(a.operation==='restMail')return null;
 if(a.operation==='continueMail')return null;
 if(a.operation==='returnMail')return j.direction==='outbound'?null:'已经在按本人决定折返谷口';
 return '未知捎信选择';
}
export function completeVisitorAid(w:World,r:Resident,a:OutsideAidAction):string|null{
 const error=visitorAidReason(w,r,a);if(error)return error;
 const c=contact(w,r)!;
 if(a.operation==='carryMail'){
  const gate=w.map.entrance;if(r.inside||!same(r.at,gate)||!walkable(w,gate))return '须本人实际到达仍可通行的谷口交接点';
  endDecisionProtection(w,r,'decision');
  initializeOutsideAid(w);const state=w.outsideAid!,n=state.notices.find(n=>n.id===a.noticeId)!,m=recipient(w,c.origin)!,duration=stationDuration(w,c.origin),id=`aid-visitor:${w.id}:${state.nextSerial++}`;
  const j:VisitorAidJourney={id,personId:r.id,merchantId:m.id,noticeId:n.id,origin:c.origin,duration,progress:0,direction:'outbound',status:'travelling',reason:null,leftAt:w.minute,needsAt:w.minute,updatedAt:w.minute,endedAt:null,eventIds:[]};
  (state.visitorJourneys??=[]).push(j);n.mail={carrierKind:'visitor',journeyId:id,courierId:r.id,merchantId:m.id,pickedAt:w.minute,receivedAt:null,reply:null};
  recordDeparture(w,r);c.phase='carryingMail';c.journey=null;r.residency='outside';r.inside=null;r.roomAt=null;r.decisionDue=w.minute+Math.min(30,duration/2);r.revision++;
  const e=emitEvent(w,{kind:'departure',populationChange:'endVisit',actors:[r.id],place:gate,roomId:null,text:`${r.name}亲自接过求助 ${n.id}，独立选择结束本次访问并沿原路返回${c.origin}，约${duration}分钟后向${m.name}交信；原登记床位依离镇规则释放，产权和亲缘不变。这不是商行同意送粮，更不成立照护或监护。`});
  n.eventIds.push(e.id);j.eventIds.push(e.id);selfMemory(r,e.id,e.text,w.minute);r.regionalLocation={routeId:j.id,origin:j.origin,progress:0,duration:j.duration};r.at={x:-1,y:-1};return null;
 }
 endDecisionProtection(w,r,'decision');
 const j=journey(w,r,a.journeyId)!;j.updatedAt=w.minute;j.status='travelling';j.reason=null;delete j.pause;
 if(a.operation==='eatMail'||a.operation==='restMail'){
  j.status='waiting';j.pause={kind:a.operation==='eatMail'?'eat':'rest',item:a.item,remaining:a.operation==='eatMail'?5:30};j.reason=a.operation==='eatMail'?'本人选择停步吃随身食品':'本人选择原地坐下休息，不代表有床位';r.decisionDue=w.minute+j.pause.remaining;r.revision++;
  remoteFact(w,j,r,`${r.name}${j.reason}，实际花费${j.pause.remaining}分钟，期间不推进路程，完成后另行决定。`);return null;
 }
 if(a.operation==='returnMail')j.direction='return';
 const remaining=j.direction==='outbound'?j.duration-j.progress:j.progress;
 r.decisionDue=w.minute+Math.max(1,Math.min(30,remaining/2));r.revision++;
 remoteFact(w,j,r,a.operation==='returnMail'?`${r.name}自行取消继续送信，从实际已走${j.progress}分钟的位置原路折返；回到谷口至少还需${j.progress}分钟，信没有送达商行，也不会瞬间退回。`:`${r.name}自行决定继续${j.direction==='outbound'?'向原居地送信':'折返谷口'}，按当前实际位置前进，不重新起算已走路程。`);
 return null;
}
export function visitorAidOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const c=contact(w,r);if(!c)return [];
 const choices:FormalOpportunity[]=[];
 for(const n of w.outsideAid?.notices??[]){const action:OutsideAidAction={type:'outsideAid',operation:'carryMail',noticeId:n.id};if(visitorAidReason(w,r,action))continue;
  choices.push({id:'aid.carry.'+n.id,label:`亲自到谷口接过${n.requesterName}的一人食品求助，结束本次访问并沿本人原路${stationDuration(w,c.origin)}分钟回${c.origin}，交给当地既有商行自行决定；可途中折返，原登记床位随离镇释放。${journeySupplyNote(w,r,stationDuration(w,c.origin))}`,action});
 }
 return choices.slice(0,4);
}
export function visitorAidCandidate(w:World,r:Resident):boolean{return capable(w,r)&&r.residency==='outside'&&contact(w,r)?.phase==='carryingMail'&&!!journey(w,r)&&!journey(w,r)!.pause&&r.decisionDue<=w.minute;}
export function visitorAidContext(w:World,r:Resident):DecisionContext{
 const j=journey(w,r);if(!j)throw new Error('outside_opportunity_expired');
 const remaining=j.direction==='outbound'?j.duration-j.progress:j.progress,choices:FormalOpportunity[]=[{id:'aid.continue.'+j.id,label:`继续本人已选${j.direction==='outbound'?'送信回程':'折返'}，不瞬间到达；${j.status==='waiting'?'再次实际检查原阻碍':'当前旅程仍按原决定推进'}`,action:{type:'outsideAid',operation:'continueMail',journeyId:j.id}}];
 if(j.direction==='outbound')choices.push({id:'aid.return.'+j.id,label:`取消继续送信，携原信从实际位置折返谷口，至少${j.progress}分钟；不承诺原床位`,action:{type:'outsideAid',operation:'returnMail',journeyId:j.id}});
 choices.push({id:'aid.rest.'+j.id,label:'原地停步坐下休息30分钟，按实际休息缓解疲劳，仍会饥饿；不是床位或住宿',action:{type:'outsideAid',operation:'restMail',journeyId:j.id}});
 for(const item of itemKeys)if(goods[item].food>0&&(r.inventory[item]??0)>=1)choices.push({id:'aid.eat.'+j.id+'.'+item,label:`停步5分钟吃本人随身1份${itemLabels[item]}，不产生新补给，吃完另行决定`,action:{type:'outsideAid',operation:'eatMail',journeyId:j.id,item}});
 return {outside:{origin:j.origin,notice:`你亲自接过的求助信随你在路上。已走离谷口${j.progress}/${j.duration}分钟路程，当前${j.direction==='outbound'?'向原居地送信':'折返谷口'}还需约${remaining}分钟。${j.reason??'沿既定回程前进；没有额外接待、食物或床位承诺。'}${journeySupplyNote(w,r,remaining)}`,choices},actor:{id:r.id,name:r.name,traits:r.traits,hunger:r.hunger,energy:r.energy,health:r.health,inventory:{...r.inventory},skills:{...r.skills},intention:r.intention,at:{...r.at},homeId:r.homeId,lastFailure:r.lastFailure},bounds:{width:w.map.width,height:w.map.height},minute:w.minute,season:calendar(w.minute).season,weather:w.weather,people:[],buildings:[],resources:[],plots:[],offers:[],proposals:[],knownLand:[],memories:r.memories.slice(-8)};
}
export function applyVisitorAidDecision(w:World,r:Resident,revision:number,d:ModelDecision):{ok:boolean;error?:string}{
 if(r.revision!==revision||!capable(w,r)||d.actions.length!==1||d.actions[0].type!=='outsideAid'||!['continueMail','returnMail','eatMail','restMail'].includes(d.actions[0].operation))return {ok:false,error:'本人捎信旅程或独立选择已变化'};
 const error=completeVisitorAid(w,r,d.actions[0]);if(error)return {ok:false,error};r.intention=d.intention.slice(0,160);r.lastDecisionAt=w.minute;r.lastFailure=null;return {ok:true};
}
/** Engine-owned body time also applies while this finite regional journey is paused. */
export function advanceVisitorAidNeeds(w:World,technicalWait=false){
 for(const j of w.outsideAid?.visitorJourneys??[]){
  if(!['travelling','waiting'].includes(j.status))continue;
  const r=w.residents.find(r=>r.id===j.personId);if(!r||r.status!=='alive'||r.residency!=='outside')continue;
  if(r.health<=0){recordDeath(w,r);continue;}
  const elapsed=Math.max(0,w.minute-(j.needsAt??j.updatedAt));j.needsAt=w.minute;if(!elapsed)continue;
  const rules=physiology(w,r),pause=j.pause,hadChoice=!!j.pause||j.status==='travelling';
  if(pause&&r.canDecide&&r.canExpress){
   const worked=Math.min(elapsed,pause.remaining);pause.remaining-=worked;
   // Same modest 4 energy / 30 minute sitting-rest scale as existing outdoor rest, not a bed.
   if(pause.kind==='rest')r.energy=Math.min(100,r.energy+worked*4/30);
   if(pause.remaining<=0){
    let meal:Omit<JourneyMealReceipt,'eventId'>|undefined;
    if(pause.kind==='eat'&&pause.item&&(r.inventory[pause.item]??0)>=1){
     const item=pause.item,container='person:'+r.id,inputs=journeyMealInputs(w,r,item),hungerBefore=r.hunger,nutrition=foodValue(w,container,item);
     foodTransaction(w,()=>{r.inventory[item]!-=1;});r.hunger=Math.max(0,r.hunger-nutrition);j.reason=`已停步吃完本人一份${itemLabels[item]}，等待本人重新选择行程`;
     if(inputs)meal={action:'visitorAid',operation:'eatMail',at:w.minute,providerId:r.id,beneficiaryId:r.id,journeyId:j.id,container,inputs,hungerBefore,hungerAfter:r.hunger,hungerRelief:hungerBefore-r.hunger};
    }
    else j.reason=pause.kind==='rest'?'原地坐下休息已完成，等待本人重新选择行程':'原随身食品已不足或腐败，未进食；等待本人重新选择';
    delete j.pause;r.decisionDue=w.minute;r.revision++;const event=remoteFact(w,j,r,`${r.name}${j.reason}。`);
    if(meal)recordJourneyMeal(w,{...meal,action:'visitorAid',operation:'eatMail',eventId:event.id});
   }
  }
  r.hunger=Math.min(100,r.hunger+rules.hungerPerMinute*elapsed);r.energy=Math.max(0,r.energy-rules.energyPerMinute*elapsed);
  const protectedMinutes=technicalWait&&!hadChoice&&regionalDecisionWait(w,r)?protectedNeedMinutes(w,r,elapsed,()=>hasTimelyVisitorAidRescue(w,r)):0;
  const drain=needHealthDrain(w,r);for(const source of ['hunger','exhaustion'] as const){const loss=Math.min(r.health,drain[source]*(elapsed-protectedMinutes));r.health-=loss;recordProtectionLoss(r,source,loss);if(r.decisionProtection?.endedAt===null)r.decisionProtection.prevented[source]+=drain[source]*protectedMinutes;}
  if(r.health<=0)recordDeath(w,r);
 }
}
/** Forecast only real self-carried food / sitting rest; never invent regional shops or aid. */
export function hasTimelyVisitorAidRescue(world:World,resident:Resident):boolean{
 if(!capable(world,resident)||!regionalDecisionWait(world,resident))return false;
 const candidates=visitorAidContext(world,resident).outside!.choices.map(c=>c.action).filter((a):a is OutsideAidAction=>a.type==='outsideAid'&&['eatMail','restMail'].includes(a.operation));
 if(!candidates.length)return false;
 const rules=physiology({...world,definitions:{...world.definitions}},resident);
 if(resident.hunger>rules.hungerDanger&&!candidates.some(a=>a.operation==='eatMail'))return false;
 for(const action of candidates){
  const w=copyForSimulation(world);w.clock.paused=false;const r=w.residents.find(r=>r.id===resident.id)!;delete r.decisionProtection;const before={hunger:r.hunger,energy:r.energy};
  if(completeVisitorAid(w,r,action))continue;
  for(let minute=0;minute<SURVIVAL_FORECAST_MINUTES;minute++){
   w.minute++;advanceFood(w);advanceVisitorAidNeeds(w);advanceHealth(w,1);advanceLife(w,1);
   if(!capable(w,r))break;const drain=needHealthDrain(w,r);
   if(drain.hunger+drain.exhaustion===0&&(r.hunger<before.hunger||r.energy>before.energy))return true;
   const j=journey(w,r)!;if(!j.pause){const item=itemKeys.find(item=>goods[item].food>0&&(r.inventory[item]??0)>=1);const next:OutsideAidAction=drain.hunger>0&&item?{type:'outsideAid',operation:'eatMail',journeyId:j.id,item}:{type:'outsideAid',operation:'restMail',journeyId:j.id};if(completeVisitorAid(w,r,next))break;}
  }
 }
 return false;
}
export function advanceVisitorAid(w:World){
 if(w.clock.paused)return;
 for(const j of w.outsideAid?.visitorJourneys??[]){
  if(!['travelling','waiting'].includes(j.status))continue;
  const r=w.residents.find(r=>r.id===j.personId),c=r&&contact(w,r),n=w.outsideAid!.notices.find(n=>n.id===j.noticeId);if(!r||!c||!n)continue;
  const elapsed=Math.max(0,w.minute-j.updatedAt);j.updatedAt=w.minute;
  if(r.status==='alive'&&r.health<=0)recordDeath(w,r);
  if(r.status!=='alive'){delete j.pause;j.status='interrupted';j.reason='捎信人在实际途中死亡，原信未交付';j.endedAt=w.minute;c.phase='home';remoteFact(w,j,r,`${r.name}的捎信回程在距谷口${j.progress}分钟的实际位置中断：${j.reason}，不补造另一个送信人。`);continue;}
  if(!r.canDecide||!r.canExpress){if(j.status!=='waiting'||j.pause){delete j.pause;j.status='waiting';j.reason='本人当前无法继续自主行动，停在实际位置';r.revision++;remoteFact(w,j,r,`${r.name}的捎信回程暂停：${j.reason}。`);}continue;}
  if(j.status==='waiting')continue;
  j.progress=Math.max(0,Math.min(j.duration,j.progress+(j.direction==='outbound'?elapsed:-elapsed)));r.regionalLocation={routeId:j.id,origin:j.origin,progress:j.progress,duration:j.duration};r.at={x:-1,y:-1};
  if(j.direction==='outbound'&&j.progress>=j.duration){
   const m=w.foreignTrade?.merchants.find(m=>m.id===j.merchantId&&m.origin===j.origin&&m.person.status==='alive');
   if(!m){j.status='waiting';j.reason='已实际到原居地，但原接收商行当前无法接信';r.decisionDue=w.minute;r.revision++;remoteFact(w,j,r,`${r.name}${j.reason}，可另行决定等待或携信原路返回。`);continue;}
   if(n.mail?.journeyId!==j.id||n.mail.courierId!==r.id){j.status='interrupted';j.reason='原信保管记录不再匹配';j.endedAt=w.minute;c.phase='home';continue;}
   receiveAidMail(w,n,`访客${r.name}本人`,r);j.status='delivered';j.endedAt=w.minute;c.phase='home';r.decisionDue=c.futureAt;r.intention='已实际回到原居地并交付求助信';
  }else if(j.direction==='return'&&j.progress<=0){
   if(!passableEntry(w)){j.status='waiting';j.reason='已走回谷口外侧，但入口实际受阻';r.decisionDue=w.minute;r.revision++;remoteFact(w,j,r,`${r.name}${j.reason}，本人和原信仍在镇外，不瞬间入谷。`);continue;}
   if(n.mail?.journeyId===j.id&&n.mail.receivedAt===null)n.mail=null;
   j.status='returned';j.endedAt=w.minute;c.phase='inTown';r.residency='visitor';delete r.regionalLocation;r.at={...w.map.entrance};r.inside=null;r.roomAt=null;r.homeId=null;r.plan=null;r.activity=null;r.decisionDue=w.minute;r.revision++;observeGateDirections(w,r);
   const e=emitEvent(w,{kind:'arrival',populationChange:'visit',actors:[r.id],place:r.at,roomId:null,text:`${r.name}携未交付的求助 ${n.id} 实际折返谷口，原信回到交接点；仍是同一位访客，需要另行决定住宿，不恢复已释放床位，不新增身份或物资。`});j.eventIds.push(e.id);n.eventIds.push(e.id);
  }
 }
}
