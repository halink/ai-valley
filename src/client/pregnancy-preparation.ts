import type {Resident,World} from '../shared/types.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function pregnancyPreparationProfile(w:World,r:Resident){
 const plans=(w.pregnancyPreparation?.arrangements??[]).filter(c=>c.gestatorId===r.id||c.providerId===r.id).slice(-6).reverse();
 if(!plans.length)return r.pregnancy?'<p class="panel-intro">尚无孕期准备约定。普通自愿进食、睡眠及原有出生规则保持不变。</p>':'';
 const name=(id:string|null)=>id?esc(w.residents.find(p=>p.id===id)?.name??'原人物'):'未指定';
 return `<h3 class="section-label">有限孕期准备</h3><p class="panel-intro">只用本人已有住房和床位；最多24小时、两份实际餐食。提供者分别同意，再自愿到场。不增加孕产风险，不保证接产，不授予医疗或监护权。</p>${plans.map(c=>`<article class="duty-card"><b>${name(c.gestatorId)} · ${esc(w.buildings.find(b=>b.id===c.buildingId)?.name??'原住所')}</b><p>原选床位 ${c.bed+1} · 提供者 ${name(c.providerId)}<br>${c.birth?'本次孕育已结束':c.stops.some(s=>s.personId===c.gestatorId)?'孕育者已撤回':c.expiresAt<=w.minute?'固定期限已届满':'原期限内，现场资格另验'} · ${c.providerId===null?'未提出照护请求':c.stops.some(s=>s.personId===c.providerId)?'提供者已停止参与':c.acceptedAt===null?'等待提供者独立接受':'提供者已接受，是否到场另记'}<br>餐食已交付 ${c.deliveredMeals}/2 份（进食另选） · 原床自愿睡眠 ${Math.floor(c.restMinutes)} 分钟 · 实际床旁陪伴 ${Math.floor(c.attendanceMinutes)} 分钟</p>${c.birth?`<p>出生核对：${c.birth.atPlannedBed?'在原选床位':'不在原选床位'}；${c.birth.providerPresent?'有有效约定且实际床旁陪伴':'无有效约定的实际床旁陪伴'}。孩子的位置、身份与原出生规则不改变。</p>`:''}</article>`).join('')}`;
}
