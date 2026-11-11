import type {World} from '../shared/types.js';
import {landPurposeNames} from '../shared/land-rights.js';
import {dateLabel} from './community.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const status={surveyed:'已勘察，未公示',notice:'公示异议期',voting:'独立表决中',approved:'已通过，待本人登记',registered:'有限建设权生效',objected:'异议停止',rejected:'未通过',expired:'期限结束',review:'到期现场保全',cancelled:'本人撤回'};
export function landRightsPanel(w:World){
 const applications=w.landRights?.applications??[];if(!applications.length)return landTransfersPanel(w);
 return `<h3 class="section-label">勘察、公示与有限用地</h3><p>公示至少一日，异议停止原申请；表决通过仍须申请人亲自登记。土地仍是共同土地，不自动赠与材料、永久产权或取水量。到期保留现住户、租约、现场实物与工资账目。</p><div class="duty-list">${applications.slice(-24).reverse().map(a=>`<article class="duty-card"><div class="duty-heading"><b>${esc(w.residents.find(r=>r.id===a.applicantId)?.name??'原申请人')}的${landPurposeNames[a.purpose]}用地</b><span>${status[a.status]}</span></div><p>(${a.at.x}, ${a.at.y}) · ${a.width} × ${a.height} 格 · 入口 (${a.door.x}, ${a.door.y})<br>原约定期限 ${a.days} 日${a.expiresAt!==null?' · 截至'+dateLabel(a.expiresAt):''}</p><p>原勘察保留 ${a.protectedAccess.buildingIds.length} 处建筑、${a.protectedAccess.springIds.length} 处水源和 ${a.protectedAccess.projectIds.length} 处工地的通路；登记和开工仍须重验。</p>${a.postedAt!==null?`<p>${dateLabel(a.postedAt)} 公示 · ${dateLabel(a.noticeUntil!)} 后表决 · ${dateLabel(a.closesAt!)} 截止${a.registerBefore?' · 登记截至'+dateLabel(a.registerBefore):''}<br>${Object.values(a.votes).filter(Boolean).length} 赞成 / ${Object.values(a.votes).filter(v=>!v).length} 反对 · 固定选民 ${a.electorate.length} 人 · 异议 ${a.objections.length}</p>`:''}${a.reason?`<p>${esc(a.reason)}</p>`:''}<small>${a.eventIds.length} 条持久证据 · 勘察、公示、表决不自动施工</small></article>`).join('')}</div>`+landTransfersPanel(w);
}

function landTransfersPanel(w:World){
 const sales=w.landRights?.transfers?.sales??[];if(!sales.length)return '';
 const states={offered:'等待买方独立决定',sold:'已当面交款转移',cancelled:'卖方撤回',declined:'买方拒绝',expired:'报价到期',invalid:'原条件变化，报价失效'};
 const name=(id:string)=>esc(w.residents.find(r=>r.id===id)?.name??id);
 return `<h3 class="section-label">私人空地当面转移</h3><p>只有已有的空闲私人整块地权可报价。双方在原址，买方独立接受才交款转移；不包含建筑、住户、农田、材料或劳动。观察者不能替任何一方同意。</p><div class="duty-list">${sales.slice(-24).reverse().map(s=>`<article class="duty-card"><div class="duty-heading"><b>${name(s.sellerId)} → ${name(s.buyerId)}</b><span>${states[s.status]}</span></div><p>私人地块 #${s.parcelIndex+1} · (${s.parcel.x}, ${s.parcel.y}) · ${s.parcel.width} × ${s.parcel.height} 格<br>固定总价 ${s.price} 钱 · 入口 (${s.access.x}, ${s.access.y})<br>${dateLabel(s.offeredAt)} 报价 · ${dateLabel(s.expiresAt)} 截止${s.endedAt!==null?' · '+dateLabel(s.endedAt)+' 结束':''}</p>${s.reason?`<p>${esc(s.reason)}</p>`:''}<small>${s.eventIds.length} 条持久证据 · 报价不预留产权或预扣款</small></article>`).join('')}</div>`;
}
