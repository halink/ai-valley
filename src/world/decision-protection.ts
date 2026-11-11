import {regionalDecisionWait} from '../shared/outside-aid.js';
import type {Resident,World} from '../shared/types.js';
import type {DecisionProtection} from '../shared/decision-protection.js';
import {emitLedgerEvent} from './events.js';
import {physiology} from './physiology.js';

export const DECISION_PROTECTION_MINUTES=180;
export const SURVIVAL_FORECAST_MINUTES=60;
export function needHealthDrain(w:World,r:Resident){
 const rules=physiology(w,r);
 return {hunger:r.hunger>rules.hungerDanger?rules.hungerHealthDrain:0,exhaustion:r.energy<rules.energyDanger?rules.energyHealthDrain:0};
}
const capable=(w:World,r:Resident)=>r.status==='alive'&&(r.residency!=='outside'||regionalDecisionWait(w,r))&&r.health>0&&r.canDecide&&r.canExpress;
function record(w:World,r:Resident,phase:'started'|'ended'){
 const state=r.decisionProtection!;
 const reasons={decision:'自主行动已开始',expired:'180游戏分钟期限已到',unavailable:'已无及时自救路径',incapable:'已无法自主行动',recovered:'实际补给或休息后脱离危急'};
 emitLedgerEvent(w,{kind:'system',actors:[r.id],place:{...r.at},roomId:r.inside,roomAt:r.roomAt,...(r.regionalLocation?{regionalLocation:{...r.regionalLocation}}:{}),
  text:phase==='started'?`${r.name}等待有效自主决定时进入紧急决策保护，至第 ${state.expiresAt.toFixed(1)} 游戏分钟为止；仅暂缓饥饿和耗竭的新增健康损失。`
   :`${r.name}的紧急决策保护结束（${state.reason?reasons[state.reason]:''}）；期间暂缓饥饿损失 ${state.prevented.hunger.toFixed(2)}、耗竭损失 ${state.prevented.exhaustion.toFixed(2)}，健康现为 ${r.health.toFixed(2)}。`,
  decisionProtection:{phase,state:structuredClone(state),after:{health:r.health,hunger:r.hunger,energy:r.energy}}});
}
export function endDecisionProtection(w:World,r:Resident,reason:NonNullable<DecisionProtection['reason']>){
 const state=r.decisionProtection;if(!state||state.endedAt!==null)return;
 state.endedAt=w.minute;state.reason=reason;record(w,r,'ended');
}
/** Called only by the runtime's technical-wait path, never by a chosen wait/sleep/journey. */
export function protectedNeedMinutes(w:World,r:Resident,dt:number,canRescue:()=>boolean):number{
 let state=r.decisionProtection;
 if(!capable(w,r)){endDecisionProtection(w,r,'incapable');return 0;}
 if(r.plan||r.activity||r.decisionDue>w.minute)return 0;
 const start=w.minute-dt;
 if(state&&state.endedAt===null&&state.expiresAt<=start){endDecisionProtection(w,r,'expired');return 0;}
 if(state&&state.endedAt!==null&&state.recoveredAt===null)return 0;
 if(!state||state.endedAt!==null){
  const drain=needHealthDrain(w,r),rate=drain.hunger+drain.exhaustion;
  if(rate<=0||r.health>rate*SURVIVAL_FORECAST_MINUTES||!canRescue())return 0;
  state=r.decisionProtection={startedAt:start,expiresAt:start+DECISION_PROTECTION_MINUTES,endedAt:null,reason:null,recoveredAt:null,localDecisionsAtStart:w.metrics.localDecisions??0,regionalDecisionsAtStart:w.metrics.regionalDecisions??0,
   before:{health:r.health,hunger:r.hunger,energy:r.energy},prevented:{hunger:0,exhaustion:0},losses:{hunger:0,exhaustion:0,illnessOrInjury:0,hazard:0}};
  record(w,r,'started');
 }else if(!canRescue()){endDecisionProtection(w,r,'unavailable');return 0;}
 return Math.min(dt,Math.max(0,state.expiresAt-start));
}
export function recordProtectionLoss(r:Resident,source:keyof DecisionProtection['losses'],loss:number){
 if(r.decisionProtection?.endedAt===null)r.decisionProtection.losses[source]+=Math.max(0,loss);
}
/** Only actual nutrition/rest can rearm a later, independent crisis. */
export function noteSurvivalRelief(w:World,r:Resident,before:{hunger:number;energy:number}){
 const state=r.decisionProtection;if(!state||state.recoveredAt!==null||r.health<=0)return;
 const drain=needHealthDrain(w,r);
 if((r.hunger<before.hunger||r.energy>before.energy)&&drain.hunger+drain.exhaustion===0){
  endDecisionProtection(w,r,'recovered');state.recoveredAt=w.minute;
 }
}
export function settleDecisionProtection(w:World,r:Resident){
 if(!capable(w,r))endDecisionProtection(w,r,'incapable');
 else if(r.decisionProtection?.endedAt===null&&w.minute>=r.decisionProtection.expiresAt)endDecisionProtection(w,r,'expired');
}
