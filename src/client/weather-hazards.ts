import {disasterHistoryButton,disasterPhaseNames} from './disaster-history.js';
import {disasterNames} from '../shared/frontier-hazards.js';
import type {Vec,World} from '../shared/types.js';
import {frontierShelterOccupants} from '../world/frontier-hazards.js';
import {dateLabel} from './community.js';

const esc=(text:unknown)=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const locate=(at:Vec,label:string)=>`<button data-tile="${at.x},${at.y}">${label}</button>`;
const phases=disasterPhaseNames;

/** Observer-only: never initialize state, infer damage causes, or offer simulation controls. */
export function weatherHazardsPanel(w:World){
 const state=w.frontierHazards,weather=state?.weather;
 const active=state?.disasters.filter(d=>d.phase!=='ended')??[];
 const records=w.events.filter(e=>e.hazardFact).slice(-16).reverse();
 const shelters=w.buildings.filter(b=>b.condition>=35&&(b.ownerId==='commons'||b.residents.length>0));
 const springs=w.resources.filter(s=>s.kind==='spring'&&s.floodDamage);
 const damaged=w.buildings.filter(b=>b.condition<100);
 const transport=(w.infrastructure?.assets??[]).filter(a=>a.retiredAt===null&&a.condition<100&&['road','bridge','dock'].includes(a.kind));
 return `<h3 class="section-label">天气灾害与实际影响</h3>
 <p class="panel-intro">天气灾害新预警：${weather?.enabled?'已启用':'未启用'}。已记录险情、损害和修护继续保留。这里只读观察，不替居民选择撤离或启用风险。</p>
 ${weather?`<p class="panel-intro">累计模拟雨量 ${weather.rainfall.toFixed(1)} · 当前模拟径流 ${weather.runoff.toFixed(1)} · 模拟阵风 ${weather.wind.toFixed(1)} · 连续强风 ${Math.floor(weather.strongWindMinutes)} 分钟。不是实测天气、真实海拔或完整流域水文。</p>`:''}
 <div class="duty-list">${active.map(d=>`<article class="duty-card danger-card"><b>${disasterNames[d.kind]} · ${phases[d.phase]}</b><p>${d.footprint?`已记录影响 ${d.footprint.length} 格`:`距中心 ${d.radius} 格范围`} · 强度 ${Math.round(d.intensity)}%<br>编号 ${esc(d.id)} · ${d.weatherEvidence?'有本次模拟天气证据':'原有记录，未补造天气证据'}</p>${d.weatherEvidence?`<p>预警时模拟雨量 ${d.weatherEvidence.rainfall.toFixed(1)} · 径流 ${d.weatherEvidence.runoff.toFixed(1)} · 阵风 ${d.weatherEvidence.wind.toFixed(1)}</p>`:''}${locate(d.at,'查看受影响地带')}${disasterHistoryButton(d.id)}</article>`).join('')||'<p class="empty">当前没有灾害预警或正在发生的灾害。</p>'}</div>
 <h3 class="section-label">建筑容量与遮蔽</h3><p class="panel-intro">占用含实际在场者及既有住宿、迁居和医疗预留，去重计数，不是新增床位。是否可避险仍取决于本人使用权、已知地点、实际路线与当前洪水；这里不保证能安全抵达。</p>
 <div class="duty-list">${shelters.map(b=>`<article class="duty-card"><b>${esc(b.name)}</b><p>占用及既有预留 ${frontierShelterOccupants(w,b).size} / 容量 ${b.capacity} · 状况 ${Math.floor(b.condition)}%</p>${locate(b.door,'查看建筑')}</article>`).join('')||'<p class="empty">没有列出的完好共用或居住建筑。</p>'}</div>
 <h3 class="section-label">水源与设施现状</h3><p class="panel-intro">设施受损不自动归因于灾害，下方带灾害编号的实际记录才是因果证据。清泉不补水；道路、桥梁和码头仍须原公共工程授权、材料和劳动。</p>
 <div class="duty-list">${springs.map(s=>`<article class="duty-card"><b>泉水 · ${s.floodDamage!.clearedAt===null?'淤塞，停止安全取水':'已实际清理'}</b><p>灾害 ${esc(s.floodDamage!.disasterId)} · 现有 ${s.amount} / ${s.max} 份${s.floodDamage!.clearedAt!==null?` · ${dateLabel(s.floodDamage!.clearedAt)}清理`:''}</p>${locate(s.at,'查看水源')}${disasterHistoryButton(s.floodDamage!.disasterId)}</article>`).join('')}${damaged.map(b=>`<article class="duty-card"><b>${esc(b.name)} · 状况 ${Math.floor(b.condition)}%</b><p>后续修护需要居民带着材料到场。</p>${locate(b.door,'查看受损建筑')}</article>`).join('')}${transport.map(a=>`<article class="duty-card"><b>${esc(a.name)} · 状况 ${a.condition.toFixed(1)}%</b><p>沿用公共工程修护流程。</p>${locate(a.access,'查看受损通路')}</article>`).join('')||'<p class="empty">暂无列出的水源损害或受损设施。</p>'}</div>
 <h3 class="section-label">已登记灾害的历史入口</h3><p class="panel-intro">也可在山谷年表中从任一带灾害编号的记录打开事件链；这里的快照与近期记录不是完整历史。</p><div class="duty-list">${(state?.disasters??[]).filter(d=>d.phase==='ended').slice(-12).reverse().map(d=>`<article class="duty-card"><b>${disasterNames[d.kind]} · 已消退</b><p>编号 ${esc(d.id)}</p>${disasterHistoryButton(d.id)}</article>`).join('')||'<p class="empty">当前快照没有列出的已消退灾害；不表示从未发生。</p>'}</div>
 <h3 class="section-label">近期有依据的灾害记录</h3><div class="memory-list">${records.map(e=>`<article><small>${dateLabel(e.at)} · ${phases[e.hazardFact!.phase]} · 灾害 ${esc(e.hazardFact!.disasterId)}</small><p>${esc(e.text)}</p>${e.hazardFact!.targetId?`<p>对象 ${esc(e.hazardFact!.targetId)}</p>`:''}${e.hazardFact!.before!==undefined&&e.hazardFact!.after!==undefined?`<p>记录值 ${e.hazardFact!.before} → ${e.hazardFact!.after}</p>`:''}${locate(e.place,'查看事发地')}${disasterHistoryButton(e.hazardFact!.disasterId)}</article>`).join('')||'<p class="empty">暂无带灾害编号的实际记录；不推断旧记录的因果。</p>'}</div>`;
}
