import type {World} from '../shared/types.js';
import {dateLabel} from './community.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const names={surveyed:'已勘察，未公示',notice:'一日公示异议期',voting:'独立表决中',approved:'通过，待本人返回边界',opened:'已接入，须另选前往与用地',objected:'异议停止',rejected:'未通过',expired:'原申请失效',cancelled:'本人撤回'};
export function regionSurveyPanel(w:World){
 const surveys=w.regionSurveys?.surveys??[];if(!surveys.length)return '';
 return `<h3 class="section-label">边界勘察与有限区域接入</h3><p>仅接入八格深、七格宽的空草地入口，外围是不可通行的地形边界。无新增资源、道路、桥梁、用地权或自动迁移。食品与清水是勘察当时的随身准备，不是未来供给保证。</p><div class="duty-list">${surveys.slice(-24).reverse().map(s=>`<article class="duty-card"><div class="duty-heading"><b>${esc(w.residents.find(r=>r.id===s.applicantId)?.name??s.applicantId)}的${s.edge==='east'?'东':'南'}边界勘察</b><span>${names[s.status]}</span></div><p>原边界 (${s.at.x}, ${s.at.y}) · 新入口 (${s.access.x}, ${s.access.y})<br>${dateLabel(s.surveyedAt)} 勘察 · ${dateLabel(s.expiresAt)} 原申请到期${s.openedAt!==null?' · '+dateLabel(s.openedAt)+' 接入':''}</p><p>固定选民 ${s.electorate.length} 人 · ${Object.values(s.votes).filter(Boolean).length} 赞成 / ${Object.values(s.votes).filter(v=>!v).length} 反对 · 异议 ${s.objections.length} 人${s.noticeUntil!==null?' · '+dateLabel(s.noticeUntil)+' 后表决':''}</p>${s.reason?`<p>${esc(s.reason)}</p>`:''}<small>${s.eventIds.length} 条持久事实。各次勘察与接入分别耗原斧具1耐久；土地建设权另行公示登记。</small></article>`).join('')}</div>`;
}
