import type {World} from '../shared/types.js';
import {dateLabel} from './community.js';
import {stationNames} from '../world/industry-content.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const status={offered:'待承租人独立确认',active:'有限租期内',declined:'承租人拒绝',withdrawn:'产权人撤回报价',expired:'期限届满',ended:'提前结束'};
export function premisesPanel(w:World):string {
 const leases=w.economy?.leases??[];
 return `<h3 class="section-label">住宅与经营场所租约</h3><p class="panel-intro">产权、商铺库存和雇员工资分别保留。租金按已过租期支付；押金不用于自动扣损。工位只在约定时段可用，实物仍须亲自到原址取回。</p><div class="duty-list">${[...leases.filter(l=>['active','offered'].includes(l.status)),...leases.filter(l=>!['active','offered'].includes(l.status)).slice(-8).reverse()].map(l=>{
 const site=w.buildings.find(b=>b.id===l.buildingId),name=(id:string)=>esc(w.residents.find(r=>r.id===id)?.name??id),station=l.terms.station==='bed'?'住宅第1张床':l.terms.station==='table'?'桌台':l.terms.station==='kitchen'?'厨房':stationNames[l.terms.station];
 return `<article class="duty-card commerce-card"><div class="duty-heading"><b>${esc(site?.name??l.buildingId)}</b><span>${status[l.status]}</span></div><p>产权人 ${name(l.ownerId)} · 承租人 ${name(l.tenantId)}</p><p>${esc(station)} · ${l.terms.station==='bed'?'全天；不改永久住处，不含厨房或经营':`每天${time(l.terms.startMinute)}—${time(l.terms.startMinute+l.terms.durationMinutes)}`}<br>${l.terms.days}日 · 日租${l.terms.rentPerDay}钱 · 押金${l.terms.deposit}钱</p><p>${l.acceptedAt===null?`报价截至${dateLabel(l.offerExpiresAt)}`:`${dateLabel(l.acceptedAt)}至${dateLabel(l.endsAt!)}，原到期分钟${l.endsAt}`}</p><p>实际预存${l.prepaid} · 已付租金${l.paid} · 已退回${l.refunded} · 尚存预留${w.economy!.escrows[l.account.slice(7)]??0}</p>${l.reason?`<p>${esc(l.reason)}</p>`:''}</article>`;
 }).join('')||'<p class="empty">尚无场所租约；没有自动出租或自动签约。</p>'}</div>`;
}
