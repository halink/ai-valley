import type {Resident,World} from '../shared/types.js';
import type {ResidentFoodCoverage,SettlementFoodCoverage} from '../shared/food-coverage.js';
import {chapterLinks} from './community.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// Round down: a value just below two days must not appear to meet that threshold.
const days=(n:number)=>(Math.floor(n*100)/100).toFixed(2);
const amount=(n:number)=>n.toFixed(2);
function status(c:ResidentFoodCoverage):string {
 if(c.accessBlocked==='medicalTransport')return '护送中，不能独立进食';
 if(c.needsCare)return '需要实际照护者，不能独立取食';
 return c.lowFood?'已核实估计不足两天':'已核实估计至少两天';
}
function details(c:ResidentFoodCoverage):string {
 const blocked=c.needsCare||c.accessBlocked==='medicalTransport';
 return `<p><strong>${esc(status(c))}</strong>${blocked?'':` · 约 ${days(c.days)} 天`}</p>
  ${blocked?'<p>这里的零值只表示无法计入自主取食余量，不表示本人没有食品。照护和结束护送仍须实际执行。</p>':`<dl class="food-facts"><div><dt>个人日常需求</dt><dd>${amount(c.dailyNeed)} 营养点 / 日</dd></div><div><dt>合计现物营养</dt><dd>${amount(c.reachableNutrition)} 点，其中随身 ${amount(c.carriedNutrition)} 点</dd></div><div><dt>按个人到期窗口折减</dt><dd>${amount(c.usableNutrition)} 营养点</dd></div><div><dt>估计取货来源</dt><dd>${c.sourceLabel?esc(c.sourceLabel):'只计随身食品'}${c.collectionMinutes===null?'':`，取货约 ${Math.ceil(c.collectionMinutes)} 游戏分钟`}</dd></div></dl>`}
  ${c.unknownExpiry?'<p>另有保质期未登记的食品，未计入估计。</p>':''}`;
}

/** Server-derived metadata is rendered only; it never updates resident knowledge. */
export function foodCoveragePanel(w:World,report?:SettlementFoodCoverage):string {
 if(w.mode!=='formal')return '<p class="empty">粮食余量估计仅用于正式世界。</p>';
 const links=chapterLinks('food');
 if(!report)return links+'<p class="empty">当前快照尚未提供粮食估计，不能把缺失记录当成零库存。</p>';
 const care=report.residents.filter(r=>r.needsCare||r.accessBlocked).length;
 const low=report.residents.filter(r=>!r.needsCare&&!r.accessBlocked&&r.lowFood).length;
 return `${links}<p class="panel-intro">当前 ${report.residents.length} 位在镇生活者（包括访客）。逐人核对随身食物和至多一处可独立领取的现物，不是逐顿计划或生存保证。</p>
  <h3 class="section-label">社区去重现物 · 不代表共同所有</h3>
  <div class="population-numbers"><span><b>${amount(report.uniqueNutrition)}</b>去重现物营养点</span><span><b>${days(report.stockDays)}</b>集体日需当量</span></div>
  <p class="panel-intro">只对下列个人估计涉及的实际批次和份额取并集，不是全世界库存，也不是个人天数相加。集体日需 ${amount(report.dailyNeed)} 营养点；社区当量未按个人到期窗口折减，不表示人人可取得，不授予分享权，也不保证及时吃到。</p>
  <h3 class="section-label">个人保守估计</h3>
  <p class="panel-intro">可独立取食者中 ${low} 人不足两天；另有 ${care} 人须照护或结束护送。低估计不等于没有其他求生选择。</p>
  <div class="duty-list food-observation">${report.residents.map(c=>{
   const r=w.residents.find(r=>r.id===c.residentId);
   return `<article class="duty-card"><button data-person="${esc(c.residentId)}">${esc(r?.name??c.residentId)}</button>${details(c)}<small>查看人物档案可核对实际活动、健康和决策保护；这里列出的取货只是估计，不表示已选择、已抵达或已领取。</small></article>`;
  }).join('')||'<p class="empty">当前没有在镇生活者。</p>'}</div>
  <p class="footnote">不计尚未采集、未来产出、未成交购物、他人私粮和未同意援助。路线、权限、保质期、竞争和照护在实际执行时仍会重新核验。营养估计不会预测当前身体能否撑到取货，也不会替居民安排补给。</p>`;
}

export function residentFoodProfile(w:World,r:Resident,report?:SettlementFoodCoverage):string {
 if(w.mode!=='formal'||r.status!=='alive'||r.residency==='outside')return '';
 const coverage=report?.residents.find(c=>c.residentId===r.id);
 return `<h3 class="section-label">个人口粮 · 保守估计</h3><div class="duty-card food-observation">${coverage?details(coverage):'<p>当前快照尚未提供个人粮食估计。</p>'}<small>随身食品加至多一处取货，已核对个人消费窗口；不是及时进食或生存保证。</small><button data-panel="food">查看粮食余量与统计边界</button></div>`;
}
