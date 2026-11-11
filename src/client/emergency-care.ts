import type {ChildHelpNotice} from '../shared/emergency-care.js';
import type {Resident,World} from '../shared/types.js';
import {dateLabel} from './community.js';
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function emergencyCareProfile(w:World,r:Resident){
 const rows=(w.emergencyCare?.agreements??[]).filter(c=>[c.childId,c.providerId,c.reviewerId,...c.guardianIds].includes(r.id));const notices=childHelpProfile(w,r);if(!rows.length)return notices;
 const name=(id:string)=>`<button data-person="${esc(id)}">${esc(w.residents.find(p=>p.id===id)?.name??'原当事人')}</button>`;
 return `<h3 class="section-label">有限儿童照护</h3>${rows.slice(-6).reverse().map(c=>`<article class="duty-card"><p>${name(c.providerId)}帮助${name(c.childId)}，${name(c.reviewerId)}独立复核<br>${{offered:'待独立复核或孩子同意',active:'有限约定有效',withdrawn:'当事人撤回或异议',expired:'固定期限届满',invalid:'原条件已改变',completed:'四次喂养额度已用尽'}[c.status]} · ${dateLabel(c.createdAt)}起24小时<br>孩子独立同意：${c.acceptedAt===null?'未登记（幼儿不代填同意）':'已实际接受'}；独立复核：${c.reviewedAt===null?'尚未完成':'已到场完成'}<br>实际喂养 ${c.meals}/${c.mealLimit} 次，已消耗 ${c.receipts.reduce((n,x)=>n+(x.resources.meal??0)+(x.resources.turnip??0),0)} 份自有食品、${c.receipts.reduce((n,x)=>n+(x.resources.water??0),0)} 份清水。${c.reason?'<br>'+esc(c.reason):''}</p><small>不改变父母、监护、住处或产权；无公共金库权限。失去条件不自动通知远处居民。未完成的照护仍是实际缺口。</small></article>`).join('')}${notices}`;
}

function outboundHistory(n:ChildHelpNotice){
 if(!n.outbound)return '<br>未另行交托镇外捎信';
 const attempts=n.outbound.attempts;
 return `<br>实际交托：${dateLabel(n.outbound.requestedAt)}${attempts.length?attempts.map(a=>`<br>货运 ${esc(a.shipmentId)} → ${esc(a.origin)}：${{carried:'信在实际出谷途中，尚未送达',delivered:'已向实际在场人物送达',unreceived:'已到原居地，但没有可核实接信人，原信留在该处',returned:'未送达，已随原货运实际退回谷口'}[a.status]}（接信使：${dateLabel(a.pickedAt)}${a.arrivedAt===null?'':'；到站：'+dateLabel(a.arrivedAt)}${a.returnedAt===null?'':'；退回：'+dateLabel(a.returnedAt)}）`).join(''):'<br>尚无实际经过的既有货运，未出信'}${n.readers.filter(k=>k.outsideReceipt).map(k=>`<br>镇外收信：${dateLabel(k.readAt)} · ${k.reply?(k.reply.choice==='visit'?'本人已选择分段来访，未承诺照护':'本人婉拒专程来访')+'（'+dateLabel(k.reply.at)+'）':'尚未独立答复'}`).join('')}`;
}

/** Historical messages are observer facts. This view never changes anyone's knowledge. */
export function childHelpProfile(w:World,r:Resident){
 const notices=(w.emergencyCare?.helpNotices??[]).filter(n=>n.childId===r.id||n.reporterId===r.id||n.readers.some(k=>k.personId===r.id));
 if(!notices.length)return '';
 return `<h3 class="section-label">儿童照护求助记录</h3>${notices.slice(-6).reverse().map(n=>`<article class="duty-card"><p>${esc(n.reporterName)}记录了${esc(n.childName)}的求助<br>${n.withdrawnAt!==null?'原消息已撤回':w.minute>=n.expiresAt?'原24小时期限已到':n.postedAt===null?'原报告人持有，尚未张贴':'已实际张贴在谷口'}<br>原观察：${dateLabel(n.createdAt)} · 截止：${dateLabel(n.expiresAt)}<br>原址（${n.location.at.x}, ${n.location.at.y}）${n.location.inside?'室内':'室外'}，不是孩子的实时位置${outboundHistory(n)}<br>实际读到记录 ${n.readers.filter(k=>k.personId!==n.reporterId).length} 人 · 已按原址探访 ${n.readers.filter(k=>k.visitAt!==null).length} 人</p><small>求助、阅读和探访均不成立照护、入屋、住房或监护权限。访客可不回应；到场后仍须另行核实、同意与实际喂养。</small></article>`).join('')}`;
}
