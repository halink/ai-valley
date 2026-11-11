import type {ResidentDesign} from '../shared/designs.js';
import type {World} from '../shared/types.js';
import {itemLabels} from '../shared/items.js';
import {calendar} from '../world/time.js';
import {dateLabel} from './community.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const when=(minute:number)=>{const t=calendar(minute);return `${dateLabel(minute)} ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`;};
const stock=(bag:object)=>Object.entries(bag).map(([i,n])=>`${n}份${itemLabels[i as keyof typeof itemLabels]??esc(i)}`).join('、')||'无';
export function prototypePanelDetails(w:World,d:ResidentDesign):string {
 if(d.spec.kind!=='prototype')return '';
 const assets=w.designs?.prototypes?.filter(p=>p.designId===d.id)??[],trials=w.designs?.trials?.filter(t=>t.designId===d.id)??[];
 const names={assembling:'制作未完成',ready:'已制成',spent:'耐用耗尽',discarded:'本人已放弃',working:'试用未结束',succeeded:'取得实际产出',failed:'试用失败',abandoned:'本人中止试用'};
 return `<p>部件：${d.spec.frame==='wood'?'原木':'木板'}支架、${d.spec.mesh==='fiber'?'纤维':'布'}挂网${d.spec.cover==='cloth'?'、布遮盖':''}；工序：悬挂${d.spec.cover==='cloth'?'、遮雨':''}、空气干燥。试用照看 ${d.spec.trialMinutes} 分钟，只有晴天白昼计入干燥。</p>
 ${assets.slice(-4).map(p=>`<p>${esc(w.residents.find(r=>r.id===p.madeBy)?.name??p.madeBy)}制作 · ${names[p.status]} · 已投入 ${stock(p.materials)} · 实做 ${p.worked} 分钟 · 耐用 ${p.durability}</p>`).join('')}
 <details><summary>实际试用及失败记录 · ${trials.length}</summary>${trials.slice(-12).reverse().map(t=>`<article><b>${names[t.status]}</b> · ${dateLabel(t.startedAt)}<p>${esc(w.residents.find(r=>r.id===t.actorId)?.name??t.actorId)} · ${esc(w.buildings.find(b=>b.id===t.buildingId)?.name??t.buildingId)}门外；实际投入 ${stock(t.input)}，产出 ${stock(t.output)}。</p><p>照看 ${t.worked} 分钟，晴天白昼 ${t.sunMinutes}，雨中 ${t.rainMinutes}，其他时段 ${t.nightMinutes}；耐用 ${t.durabilityBefore} → ${t.durabilityAfter??'尚未结算'}。${esc(t.reason??(t.status==='working'?'原料已投入，尚无结论':'结论仅适用于本次记录的条件'))}</p><p>输入批次 ${t.sourceLots.length} 批；过程 ${esc(t.definition)}。</p>${t.sourceLots.map(l=>`<p>${l.quantity}份 · 原生产 ${when(l.producedAt)} · 原到期 ${when(l.expiresAt)} · ${esc(l.definition)}</p>`).join('')}</article>`).join('')||'<p>尚无实际试用，图纸文字不代表有效。</p>'}</details>`;
}
