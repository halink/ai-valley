import type {World} from '../shared/types.js';
import type {EmploymentRole} from '../shared/employment.js';
import {dateLabel} from './community.js';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const roles:Record<EmploymentRole,string>={cook:'烹饪',seedkeeper:'留种',carpenter:'木作',smith:'锻造',miller:'磨坊',dairyworker:'乳品',weaver:'纺织',preserver:'罐藏',herbalist:'草药加工'};
const statuses={preparing:'准备与独立确认',moving:'暂停工作、实际搬运',completed:'已登记新址',cancelled:'已撤回或中止'};

/** Observation only: never issues resident actions or changes simulation state. */
export function businessRelocationPanel(w:World):string {
 const moves=w.economy?.relocations??[];
 const person=(id:string)=>esc(w.residents.find(r=>r.id===id)?.name??id);
 const place=(id:string)=>esc(w.buildings.find(b=>b.id===id)?.name??id);
 const records=[...moves.filter(m=>['preparing','moving'].includes(m.status)),...moves.filter(m=>!['preparing','moving'].includes(m.status)).slice(-8).reverse()];
 return `<h3 class="section-label">经营迁址</h3><p class="panel-intro">先在原址处理已有订单与招聘，再由员工分别确认新工位和原聘约。搬运停工期间未工作不计薪，原聘期不延长；不转移产权、租约或公共补贴。</p><div class="duty-list">${records.map(m=>`<article class="duty-card commerce-card"><div class="duty-heading"><b>${esc(w.economy?.businesses.find(b=>b.id===m.businessId)?.name??m.businessId)}</b><span>${esc(statuses[m.status])}</span></div>
 <p>经营者 ${person(m.ownerId)}<br>原址 ${place(m.fromBuildingId)} → 新址 ${place(m.toBuildingId)}</p><p>${esc(dateLabel(m.proposedAt))}提出 · ${esc(dateLabel(m.expiresAt))}到期${m.endedAt===null?'':` · ${esc(dateLabel(m.endedAt))}结束`}</p>
 ${m.employees.map(e=>{const t=e.terms;return `<p><b>${person(e.workerId)}</b> · ${e.acceptedAt!==null?'已在新址独立同意':e.declinedAt!==null?'已拒绝或撤回同意':e.reviewedAt!==null?'已在旧址阅读，尚未同意':'尚未在旧址阅读'}<br>原聘约 ${esc(e.contractId)}：${esc(roles[t.role]??t.role)}，每天${esc(time(t.startMinute))}—${esc(time(t.startMinute+t.durationMinutes))}，足班${esc(t.wage)}钱；不足班按实作分钟比例取整<br>原起止日 ${esc(e.startDay)}—${esc(e.endDay)}（世界日序）；拟在新址沿用相同报酬、时段和结束日，另含上述停工条款${m.transferredContractIds.includes(e.contractId)?'<br>已登记新址；保留原合同、工资账户和累计出勤':''}</p>`;}).join('')||'<p>提议时没有在聘员工；登记前仍须复核现有聘约。</p>'}
 ${m.reason?`<p>${esc(m.reason)}</p>`:''}<small>原址库存须先领取并实际携带；原址清空后才能登记，新址另行入库。中止不移动任何剩余实物，食品继续按原批次变质。</small></article>`).join('')||'<p class="empty">尚无迁址记录；旧存档不会补造迁址或员工同意。</p>'}</div>`;
}
