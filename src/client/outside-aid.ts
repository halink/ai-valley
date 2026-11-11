import type {World} from '../shared/types.js';
import {itemLabels} from '../shared/items.js';
import {dateLabel} from './community.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const journeyNames={travelling:'实际回程中',waiting:'在实际位置等待',delivered:'已在原居地交信',returned:'携原信实际返谷',interrupted:'旅程已中断'};
const statuses={reserved:'原库预留，尚未发出',travelling:'驿路运输途中',arrived:'已到谷口，待本人领取',returning:'原路退运中',returned:'剩余实物已回原库',collected:'本人已实际领取'};
/** Observer-only ledger. Rendering never publishes facts into any person's knowledge. */
export function outsideAidPanel(w:World):string{
 const state=w.outsideAid,notices=state?.notices??[];
 return `<h3 class="section-label">驿路食品求助</h3><p class="panel-intro">求助由既有货运信使或实际来访者自愿带走，商行可自行应答或拒绝。观察到的全程记录不等于居民已获知；送粮不成立照护、入住或监护。</p><div class="duty-list">${[...notices].reverse().map(n=>{
  const journeys=state!.visitorJourneys?.filter(j=>j.noticeId===n.id)??[];
  const deliveries=state!.deliveries.filter(d=>d.noticeId===n.id),closed=n.withdrawnAt!==null?'本人已撤回':n.expiresAt<=w.minute?'联络期已结束':'联络期内';
  const mail=!n.mail?'尚无既有信使带走':n.mail.receivedAt===null?n.mail.carrierKind==='visitor'?`原信由实际访客 ${w.residents.find(r=>r.id===n.mail!.courierId)?.name??n.mail.courierId} 携带，尚未交到商行`:`信使随货运 ${n.mail.courierId} 途中`:`已送达${w.foreignTrade?.merchants.find(m=>m.id===n.mail!.merchantId)?.name??'原商行'} · ${n.mail.reply==='declined'?'对方已婉拒':n.mail.reply==='accepted'?'对方已独立应答':'等待对方独立应答'}`;
  return `<article class="duty-card commerce-card"><div class="duty-heading"><b>${esc(n.requesterName)} · 本人${n.knownPeople}人食品求助</b><span>${closed}</span></div><p>${esc(mail)}</p><small>${dateLabel(n.postedAt)}发布 · ${dateLabel(n.expiresAt)}截止 · 谷口（${n.at.x}, ${n.at.y}）</small>${journeys.map(j=>`<p>${esc(w.residents.find(r=>r.id===j.personId)?.name??j.personId)} · ${journeyNames[j.status]}<br>原居地 ${esc(j.origin)} · 离谷口 ${Number(j.progress.toFixed(1))} / ${j.duration} 分钟路程 · ${j.direction==='return'?'折返方向':'送信方向'}${j.reason?`<br>${esc(j.reason)}`:''}${j.pause?` · 还需${Math.ceil(j.pause.remaining)}分钟`:''}<br>同一人物，原床位不自动恢复，捎信不代表接受援助。</p>`).join('')}${deliveries.map(d=>`<p>${statuses[d.status]}${d.blockedSince!==null?' · 谷口通路受阻':''}<br>原预留 ${d.quantity} ${itemLabels[d.item]} · ${d.status==='collected'?`实际领取 ${d.collectedQuantity??'未记录'} 份`:`本批仍存 ${d.inventory[d.item]??0} 份`}${d.route?.at?` · 货物位置（${d.route.at.x}, ${d.route.at.y}）`:d.status==='travelling'||d.status==='returning'?' · 镇外运输段':''}${d.arrivedAt!==null?`<br>${dateLabel(d.arrivedAt)}实际到站`:''}${d.collectedAt!==null?` · ${dateLabel(d.collectedAt)}实际领取`:''}</p>`).join('')}</article>`;
 }).join('')||'<p class="empty">尚无人发布食品求助。没有信使、没有应答或无实际粮食时，不会自动补货。</p>'}</div>`;
}
