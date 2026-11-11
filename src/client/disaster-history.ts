import {disasterNames} from '../shared/frontier-hazards.js';
import type {World,WorldEvent} from '../shared/types.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const disasterPhaseNames={warning:'预警',active:'发生',ended:'消退',damage:'实际损害',injury:'实际伤害',retreat:'实际撤离',shelter:'实际进入遮蔽',repair:'实际修护'} as const;

export function disasterHistoryButton(id:string){
 return `<button data-disaster-history="${esc(id)}">查阅这次灾害的留存事件链</button>`;
}

/** A recorded identity is the only link. Neither proximity nor current damage supplies one. */
export function disasterEventDetails(event:WorldEvent){
 const fact=event.hazardFact;if(!fact)return '';
 const value=(n:number|undefined)=>typeof n==='number'&&Number.isFinite(n)?esc(n):'未知（未记录）';
 return `<div class="disaster-fact"><p>灾害 ${esc(fact.disasterId)} · ${esc(disasterPhaseNames[fact.phase]??'阶段未知')}<br>对象：${fact.targetId?esc(fact.targetId):'未记录具体对象'}</p>${fact.before!==undefined||fact.after!==undefined?`<p>本条记录值 ${value(fact.before)} → ${value(fact.after)}（单位与含义以原文为准）</p>`:''}${disasterHistoryButton(fact.disasterId)}</div>`;
}

export function disasterHistoryOverview(world:World,id:string){
 const current=world.frontierHazards?.disasters.find(d=>d.id===id);
 return `<button data-panel="wild">返回野外与灾害观察</button><h3 class="section-label disaster-history-title">灾害事件链 · ${esc(id)}</h3><p class="panel-intro">仅从持久年表查阅带有同一灾害编号的原始记录，包含实际留存的预警、发生、损害、伤害、撤离、遮蔽、消退与修护。按入账顺序从新到旧分页，日期以各条原记录为准；同一编号不表示每一步都已发生或已完整收录。</p><p class="panel-intro">缺失的阶段、对象与数值保持未知，不能当作零损害、全员安全或全部修复。不按相邻时间、同一地点或当前设施状况补造因果。筛选只缩小当前查阅范围，有新记录时由你选择“回到最新”。</p><p>${current?`当前快照：${esc(disasterNames[current.kind])} · ${esc(disasterPhaseNames[current.phase])}。此状态不是新的历史记录。`:'当前快照中没有这次灾害，当前状态未知；已留存历史仍可查阅。'}</p>`;
}
