import type {Action,Resident,World,Item} from '../shared/types.js';
import {PRESERVATION_COST} from '../shared/mvp-preservation.js';
import {calendar,DAY} from '../world/time.js';
import {distance,findPath} from '../world/navigation.js';
import {berryApproachPath} from '../world/berry-observation.js';
import {springApproachPath} from '../world/spring-observation.js';
import {mvpResourceItem} from '../world/mvp-resources.js';
import {mvpNutritionBuffer} from './mvp-nutrition-buffer.js';
/** Deliberately small rule-demo policy, not a finite-knowledge model forecast.
 * At most one attempted installation/canning work order per person/day. Inputs
 * are gathered only up to that one order's bill, not an entire winter's needs.
 * Failed work attempts retain their persisted daily budget debit. */
export function preservationPreparation(w:World,r:Resident):{action:Action;reason:string}|null {
 const s=w.mvpPreservation;if(!s)return null;
 const season=calendar(w.minute).season;if(season!=='autumn'&&season!=='winter')return null;
 if(Object.values(s.attempts).some(a=>a.actorId===r.id&&Math.floor(a.at/DAY)===Math.floor(w.minute/DAY)))return null;
 const operation=s.installed?'preserve':'install';
 // One volunteer rule avoids four actors stockpiling a single communal station's
 // materials. This is a driver preference only; anyone may legally install it.
 if(operation==='install'&&w.residents.filter(p=>p.status==='alive'&&p.residency!=='outside'&&p.canDecide&&p.canExpress).sort((a,b)=>a.id.localeCompare(b.id))[0]?.id!==r.id)return null;
 if(operation==='preserve'){
  const a=s.accounts[r.id],buffer=mvpNutritionBuffer(w,r),end=(Math.floor(w.minute/(112*DAY))+1)*112*DAY+6*DAY;
  const scenarioTarget=1.2*buffer.dailyDemand*(end-w.minute)/DAY+2*buffer.dailyDemand;
  // A conditional no-future-supply scenario, never a promise of first harvest.
  if(a.lots.filter(l=>l.expiresAt>end).reduce((n,l)=>n+l.quantity*26,0)>=scenarioTarget)return null;
 }
 const needs:Partial<Record<Item,number>>={...PRESERVATION_COST[operation],...(operation==='preserve'?{water:2}:{})};
 for(const [key,needed]of Object.entries(needs)){
  const item=key as Item,missing=Math.max(0,needed-(r.inventory[item]??0));if(!missing)continue;
  const sources=w.resources.filter(x=>mvpResourceItem(w,x)===item&&x.amount>=1&&r.knownResources.includes(x.id)).sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at));
  for(const source of sources){const path=source.kind==='bush'?berryApproachPath(w,r.at,source):source.kind==='spring'?springApproachPath(w,r.at,source):findPath(w,r.at,source.at,true);if(path===null)continue;return {action:{type:'gather',resourceId:source.id,quantity:Math.min(3,Math.floor(source.amount),Math.ceil(missing))},reason:'基本生活、耕作和当前社交后，只采集一次罐藏工作单的本人材料缺口，不按整个冬季目标扫空资源'};}
  return null;
 }
 return {action:{type:'mvpPreservation',operation},reason:operation==='install'?'用本人6木6石、120分钟实际安装共用罐藏工位；今日仅一张可选工作单':'用本人2果1水1木、60分钟实际制成两份可保存56日的罐藏；保留饮水，非冬储充分保证'};
}
