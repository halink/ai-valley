import {employmentRoles} from '../world/employment.js';
import {itemLabels} from '../shared/items.js';
import type {World} from '../shared/types.js';
import {chapterLinks,dateLabel} from './community.js';
import {calendar,DAY} from '../world/time.js';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const person=(w:World,id:string)=>`<button data-person="${esc(id)}">${esc(w.residents.find(r=>r.id===id)?.name??'原当事人')}</button>`;
const place=(w:World,id:string)=>`<button data-locate="${esc(id)}">${esc(w.buildings.find(b=>b.id===id)?.name??'原场所')}</button>`;
const time=(minute:number)=>{const c=calendar(minute);return String(c.hour).padStart(2,'0')+':'+String(c.minute).padStart(2,'0');};
const dateTime=(minute:number)=>`${dateLabel(minute)} ${time(minute)}`;
const roles=employmentRoles;
const statuses={active:'履约中',completed:'到期结束',quit:'本人辞职',dismissed:'雇主结束',ended:'已结清'};

export function employmentPanel(w:World):string {
 const state=w.employment;
 if(!state)return `${chapterLinks('employment')}<p class="empty">聘约记录尚未建立。</p>`;
 const current=state.contracts.filter(c=>c.status==='active');
 const posts=state.posts.filter(p=>p.status==='open'||p.status==='offered');
 const today=Math.floor(w.minute/DAY);
 return `${chapterLinks('employment')}<p class="panel-intro">店主选择具体雇员，应聘者最后确认。工作、辞职和续约分别由本人决定。</p>
 <div class="population-numbers"><span><b>${current.length}</b>有效聘约</span><span><b>${state.totals.paid}</b>累计实付工资</span></div>
 <h3 class="section-label">正在招聘</h3><div class="duty-list">${posts.map(p=>{
  const business=w.economy?.businesses.find(b=>b.id===p.businessId);
  const applicants=p.applications.filter(a=>a.status==='pending'||a.status==='selected');
  return `<article class="duty-card commerce-card"><div class="duty-heading"><b>${esc(business?.name??'原商铺')} · ${roles[p.terms.role]}</b><span>${p.status==='offered'?'待应聘者确认':'接受申请'}</span></div>
  <p>店主 ${person(w,p.employerId)} · ${place(w,p.buildingId)}</p>
  <div class="contract-terms"><span><b>${p.terms.wage} 钱 / 班</b>${p.terms.durationMinutes} 分钟足班工资</span><span><b>${p.terms.days} 日</b>每日 ${time(p.terms.startMinute)}—${time(p.terms.startMinute+p.terms.durationMinutes)}</span></div>
  <p>申请人 ${applicants.map(a=>person(w,a.residentId)).join('、')||'暂无'}</p>
  ${p.offer?`<p>店主选择了 ${person(w,p.offer.workerId)}，全期工资已预留，${p.offer.notifiedAt===undefined?'等待本人到店查看':'本人已获知，尚待答复'}。可在${dateTime(p.offer.expiresAt)}前确认。</p>`:''}
  <small>${p.renewalOf?'这是一份新的续约提议。':''}招聘截至${dateTime(p.expiresAt)}。</small></article>`;
 }).join('')||'<p class="empty">尚无开放的私人招聘。谁开店、何时招人，由居民自己决定。</p>'}</div>
 <h3 class="section-label">长期聘约</h3><div class="duty-list">${[...current,...state.contracts.filter(c=>c.status!=='active').slice(-8).reverse()].map(c=>{
  const business=w.economy?.businesses.find(b=>b.id===c.businessId),day=c.attendance.find(d=>d.day===today);
  return `<article class="duty-card commerce-card"><div class="duty-heading"><b>${roles[c.terms.role]}</b><span>${statuses[c.status]}</span></div>
   <p>${person(w,c.workerId)} 受雇于 ${esc(business?.name??'原商铺')}<br>雇主 ${person(w,c.employerId)} · ${place(w,c.buildingId)}</p>
   <div class="contract-terms"><span><b>${c.terms.wage} 钱 / 班</b>足班 ${c.terms.durationMinutes} 分钟</span><span><b>${c.terms.days} 日聘期</b>${time(c.terms.startMinute)}—${time(c.terms.startMinute+c.terms.durationMinutes)}</span></div>
   <p>${dateLabel(c.startDay*DAY)}至${dateLabel(c.endDay*DAY-1)}<br>已付 ${c.paid} · 原预存 ${c.reserved} · 已退回 ${c.refunded}</p>
   ${day?`<p>今天实际工作 ${Math.round(day.worked)} 分钟，领薪 ${day.paid}，完成 ${day.produced} 批加工。</p>`:''}
   ${c.reason?`<p>${esc(c.reason)}</p>`:''}
   <small>原料和成品归商铺。按实际工作分钟累计计薪，不足整钱的部分按日取整；缺料、缺勤时不虚记劳动。</small>
  </article>`;
 }).join('')||'<p class="panel-intro">双方完成招聘确认后，聘期、实际工时和工资会记录在这里。</p>'}</div>`;
}

export function foreignPanel(w:World):string {
 const trade=w.foreignTrade;
 if(!trade)return `${chapterLinks('foreign')}<p class="empty">镇外商路尚未登记。</p>`;
 const names:Record<string,string>=itemLabels;
 const stock=(inventory:Record<string,number|undefined>)=>Object.entries(inventory).filter(([,n])=>(n??0)>0).map(([key,n])=>`${names[key]??key} ${n}`).join(' · ')||'暂无货物';
 const offers=trade.offers.filter(o=>o.status==='open'&&o.noticeAt<=w.minute&&o.expiresAt>w.minute);
 const active=trade.shipments.filter(s=>!['completed','cancelled'].includes(s.status));
 const history=trade.shipments.filter(s=>['completed','cancelled'].includes(s.status)).slice(-10).reverse();
 const stateNames={ready:'等待发运',inTransit:'运输途中',returning:'退运途中',arrived:'抵达待提货',completed:'交付完成',cancelled:'已结清撤单'};
 const merchant=(id:string)=>trade.merchants.find(m=>m.id===id);
 return `${chapterLinks('foreign')}<p class="panel-intro">外地商人分别决定报价与接单。居民自行协商买卖，货物按实际运输和交接结算。</p>
 <button class="duty-location" data-action="trade-station">查看西南林道交接点</button>
 <div class="population-numbers"><span><b>${trade.totals.imports}</b>累计进口货物</span><span><b>${trade.totals.exports}</b>累计出口货物</span></div>
 <h3 class="section-label">外地商号</h3><div class="duty-list">${trade.merchants.map(m=>`<article class="duty-card commerce-card"><div class="duty-heading"><b>${esc(m.name)}</b><span>${esc(m.origin)}</span></div>
 <p>经营者 ${esc(m.person.name)} · 单程 ${m.routeMinutes} 分钟<br>自有钱款 ${m.person.coins} · ${esc(stock(m.person.inventory))}</p>
 <p>${esc(m.person.intention||'正在自行考虑经营安排')}</p>
 ${m.work?`<small>已选择的生产正在进行，预计${dateTime(m.work.finishesAt)}完成。</small>`:''}</article>`).join('')}</div>
 <h3 class="section-label">公开报价与协商</h3><div class="duty-list">${offers.slice(-20).reverse().map(o=>`<article class="duty-card commerce-card"><div class="duty-heading"><b>${o.side==='import'?'向小镇出售':'向小镇收购'}${names[o.item]}</b><span>${o.price} 钱 / 份</span></div>
 <p>${esc(merchant(o.merchantId)?.name??'原商号')} · ${o.remaining} 份${o.residentId?' · 与 '+person(w,o.residentId)+' 协商':''}</p>
 <small>${o.initiatedBy==='merchant'?'外地商人提出，等居民自己选择':'居民提出，等外地商人独立回复'}。截至${dateTime(o.expiresAt)}。</small></article>`).join('')||'<p class="empty">目前没有可用的外贸报价。商人可以选择生产、等待或不做这笔买卖。</p>'}</div>
 <h3 class="section-label">运输与交接</h3><div class="duty-list">${[...active,...history].map(s=>`<article class="duty-card commerce-card"><div class="duty-heading"><b>${s.side==='import'?'进口':'出口'} ${names[s.item]} × ${s.quantity}</b><span class="shipment-status">${stateNames[s.status]}</span></div>
 <p>${person(w,s.residentId)} ↔ ${esc(merchant(s.merchantId)?.name??'原商号')}<br>约定货款 ${s.gross} · ${s.actualTax===null?'已约定税费上限 '+s.maxTax:'实际税费 '+s.actualTax}</p>
 <p>指定交接处（${s.stationAt?.x??trade.station.x}, ${s.stationAt?.y??trade.station.y}）${s.route?.at?` · 货物实际在（${s.route.at.x}, ${s.route.at.y}）<br><button data-tile="${s.route.at.x},${s.route.at.y}">看看这批货物</button>`:s.route&&s.route.phase!=='done'?' · 正在镇外运输段':''}</p>
 ${s.deliveryAt!==undefined?`<small>${s.returned?'实际退回':'实际抵达'} ${dateTime(s.deliveryAt)}</small>`:s.arrivesAt!==null?`<small>预计抵达 ${dateTime(s.arrivesAt)}</small>`:''}
 ${s.blockedSince!==null?'<p>交接路段目前受阻，等待通路恢复或双方决定退运。</p>':''}
 ${s.collectedAt!==null?`<small>交接于${dateTime(s.collectedAt)}</small>`:''}</article>`).join('')||'<p class="panel-intro">双方确认并实际交货后，运输记录会出现在这里。</p>'}</div>
 <p class="footnote">商号的钱货和镇外原料分别记账，报价由模型产生。观察者不能下单、派人或修改合同。</p>`;
}
