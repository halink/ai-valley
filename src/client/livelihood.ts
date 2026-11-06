import {itemLabels} from '../shared/items.js';
import type {Inventory,World} from '../shared/types.js';
import type {CivicMeasure} from '../shared/civic.js';
import {chapterLinks,dateLabel} from './community.js';
import {calendar} from '../world/time.js';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const items:Record<string,string>=itemLabels;
const bag=(inventory:Inventory)=>Object.entries(inventory).filter(([,n])=>n!>0).map(([item,n])=>`${items[item]??item} ${n}`).join(' · ')||'暂无存货';
const person=(w:World,id:string)=>`<button data-person="${esc(id)}">${esc(w.residents.find(r=>r.id===id)?.name??'原持有人')}</button>`;
const place=(w:World,id:string)=>`<button data-locate="${esc(id)}">${esc(w.buildings.find(b=>b.id===id)?.name??'原场所')}</button>`;
function time(at:number){const t=calendar(at);return `${dateLabel(at)} ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`;}
const prices=(p:Inventory)=>Object.entries(p).map(([item,n])=>`${items[item]??item}每份 ${n} 钱`).join('、');
function measure(w:World,m:CivicMeasure){
 if(m.kind==='fixtureRemoval')return `公共设备 ${esc(m.stationId)} 拆卸，工资上限 ${m.wage} 钱按实际工时支付，授权 ${m.durationDays} 日；回收物留公共库存`;
 if(m.kind==='careSupport')return `具体托育与长期照护保障 ${m.amount} 钱，约定服务 ${m.durationDays} 日，按实际完成结算`;
 if(m.kind==='pension')return `${esc(w.residents.find(r=>r.id===m.beneficiaryId)?.name??'指定居民')}生活保障，每日${m.amountPerDay}钱，持续${m.durationDays}日，须本人自行接受`;
 if(m.kind==='education'){const l=w.education?.lessons.find(l=>l.id===m.lessonId);return `课堂助学预算 ${m.amount} 钱 · ${w.residents.find(r=>r.id===l?.teacherId)?.name??'原教师'}授课，期限 ${m.durationDays} 日`;}
 if(m.kind==='construction'){const p=w.construction?.projects.find(p=>p.id===m.projectId);return `${p?.name??'原公共工程'} · 选址 (${p?.at.x??'?'},${p?.at.y??'?'}) · 拨款 ${m.amount} 钱，管理期限 ${m.durationDays} 日`;}
 if(m.kind==='salesTax')return `成交税 ${(m.basisPoints/100).toFixed(m.basisPoints%100?1:0)}%，有效 ${m.durationDays} 日`;
 const building=w.buildings.find(b=>b.id===m.buildingId)?.name??'公共用房';
 return m.kind==='service'?`${building}每次完成服务报酬 ${m.wagePerService}，工资预算 ${m.wageBudget}、采购预算 ${m.suppliesBudget}，有效 ${m.durationDays} 日${m.prices?'；采购价 '+prices(m.prices):''}`:
  `${building}修缮报酬 ${m.wage}，材料采购预算 ${m.suppliesBudget}，有效 ${m.durationDays} 日${m.prices?'；采购价 '+prices(m.prices):''}`;
}
function account(w:World,id:string){
 if(id==='treasury')return '公共金库';
 if(id.startsWith('resident:')||id.startsWith('estate:')){const name=w.residents.find(r=>r.id===id.slice(id.indexOf(':')+1))?.name??'居民';return name+(id.startsWith('estate:')?'的遗产':'');}
 if(id.startsWith('business:'))return w.economy?.businesses.find(b=>b.id===id.slice(9))?.name??'原商铺';
 if(id.startsWith('foreign:'))return w.foreignTrade?.merchants.find(m=>m.id===id.slice(8))?.name??'外地商号';
 if(id.startsWith('escrow:')){
  const project=w.construction?.projects.find(p=>p.account===id||p.workers.some(c=>c.account===id));if(project)return project.name+(project.account===id?'工程资金':'施工工资预存');
  const contract=w.employment?.contracts.find(c=>c.account===id);
  if(contract)return (w.residents.find(r=>r.id===contract.workerId)?.name??'受雇者')+'聘约工资';
  const offer=w.employment?.posts.find(p=>p.offer?.account===id);
  if(offer)return '待接受的录用工资';
  const cargo=w.foreignTrade?.shipments.find(s=>s.escrowAccount===id);
  if(cargo)return (cargo.side==='import'?'进口':'出口')+items[cargo.item]+'货款';
  const quotation=w.foreignTrade?.offers.find(o=>o.escrowAccount===id);
  if(quotation)return '外贸报价预留款';
  const budget=w.civic?.budgets.find(b=>b.wageAccount===id||b.supplyAccount===id);
  if(budget)return (w.buildings.find(b=>b.id===budget.buildingId)?.name??'公共用房')+(budget.wageAccount===id?'工资预算':'采购预算');
  const shift=w.duties?.shifts.find(s=>s.funding?.wageAccount===id);
  if(shift)return (w.buildings.find(b=>b.id===shift.buildingId)?.name??'公共用房')+'班次工资';
  const order=w.economy?.listings.find(l=>l.escrowId===id);
  if(order)return (w.economy?.businesses.find(b=>b.id===order.businessId)?.name??'商铺')+'收购货款';
  return '原预留款';
 }
 return '结算账户';
}
export function marketPanel(w:World){
 const economy=w.economy;
 if(!economy)return `${chapterLinks('market')}<p class="empty">经营记录尚未开始。</p>`;
 const businesses=economy.businesses.filter(b=>b.closedAt===null);
 const listings=economy.listings.filter(l=>l.status==='open'&&l.expiresAt>w.minute);
 return `${chapterLinks('market')}<p class="panel-intro">居民用自己的货物开张、定价和交易。每笔成交都实际交付货物与钱款。</p>
 <div class="population-numbers"><span><b>${businesses.length}</b>正在经营</span><span><b>${listings.filter(l=>l.side==='sale').reduce((n,l)=>n+l.quantity,0)}</b>在售货物</span></div>
 <h3 class="section-label">商铺与摊位</h3>
 <div class="duty-list">${businesses.map(b=>`<article class="duty-card economy-card"><div class="duty-heading"><b>${esc(b.name)}</b><span>${b.coins} 钱</span></div><p>经营者 ${person(w,b.ownerId)} · ${place(w,b.buildingId)}</p><p>自有库存 ${esc(bag(b.inventory))}</p><p>累计售出 ${b.sales} 份 · 营业收入 ${b.revenue}</p>
 ${listings.filter(l=>l.businessId===b.id).map(l=>`<div class="market-row"><span>${l.side==='purchase'?'收购':'出售'} ${items[l.item]} <b>× ${l.quantity}</b></span><span>${l.price} 钱 / 份</span></div>`).join('')||'<small>尚未挂牌出售商品。</small>'}</article>`).join('')||'<p class="empty">尚无居民决定开张。生产与经营的选择由他们自己作出。</p>'}</div>
 <h3 class="section-label">土地与生产</h3><div class="population-flows"><span>耕地 <b>${w.plots.length}</b></span><span>已种植 <b>${w.plots.filter(p=>p.crop).length}</b></span><span>原料与食物 <b>${Object.values(w.residents.reduce<Inventory>((acc,r)=>{if(r.status==='alive'&&r.residency!=='outside')for(const [key,n] of Object.entries(r.inventory))acc[key as keyof Inventory]=(acc[key as keyof Inventory]??0)+n!;return acc;},{})).reduce((a,b)=>a+b,0)}</b> 份</span></div>
 <p class="footnote">根菜可以食用、烹饪或留种。春秋、夏季、冬季有各自适种的根菜；生长依赖实际播种、浇水和时间。</p>`;
}
export function financePanel(w:World){
 const e=w.economy,c=w.civic;
 if(!e||!c)return `${chapterLinks('finance')}<p class="empty">公共账本尚未建立。</p>`;
 const publicAccounts=new Set([...c.budgets.flatMap(b=>[b.wageAccount,b.supplyAccount]),...(w.duties?.shifts.flatMap(s=>s.funding?[s.funding.wageAccount]:[])??[])]);
 const reserved=[...publicAccounts].reduce((sum,id)=>sum+(e.escrows[id.slice(7)]??0),0);
 const proposals=c.proposals.slice(-12).reverse();
 const labels={open:'表决中',approved:'已通过',rejected:'未通过',unfunded:'资金不足'};
 return `${chapterLinks('finance')}<div class="population-numbers"><span><b>${e.treasury}</b>金库可用钱款</span><span><b>${reserved}</b>公共预留钱款</span></div>
 <p class="panel-intro">${c.salesTax&&c.salesTax.expiresAt>w.minute?`现行成交税 ${c.salesTax.basisPoints/100}%，至${dateLabel(c.salesTax.expiresAt)}。`:'目前没有生效的成交税。'}公共支出由居民提案、分别表态并筹集实际资金。</p>
 <div class="population-flows"><span>捐款 <b>${c.totals.donations}</b></span><span>工资 <b>${c.totals.wages}</b></span><span>采购 <b>${c.totals.procurement}</b></span><span>修缮 <b>${c.totals.repairs}</b></span></div>
 <h3 class="section-label">议事与表决</h3><div class="duty-list">${proposals.map(p=>{const yes=Object.values(p.votes).filter(Boolean).length,no=Object.values(p.votes).filter(v=>!v).length;return `<article class="duty-card"><div class="duty-heading"><b>${p.measure.kind==='salesTax'?'税收议案':p.measure.kind==='service'?'公共服务预算':p.measure.kind==='construction'?'公共建设议案':p.measure.kind==='education'?'课堂助学议案':'公共修缮预算'}</b><span>${labels[p.status]}</span></div><p>${person(w,p.proposerId)} 提出</p><p>${esc(measure(w,p.measure))}</p>${p.executionError?`<p>未执行：${esc(p.executionError)}</p>`:''}<div class="population-flows"><span>赞成 ${yes}</span><span>反对 ${no}</span><span>未表态 ${p.electorate.length-yes-no}</span></div><small>截至${time(p.closesAt)} · 登记 ${p.electorate.length} 位有表决权的居民</small></article>`;}).join('')||'<p class="empty">尚无居民提出公共议案。</p>'}</div>
 <h3 class="section-label">获准预算</h3><div class="duty-list">${c.budgets.slice(-12).reverse().map(b=>`<article class="duty-card"><div class="duty-heading"><b>${b.kind==='service'?'公共服务':'修缮'}</b><span>${b.status==='active'?'执行中':b.status==='completed'?'已完成':'已到期'}</span></div><p>${place(w,b.buildingId)}</p><p>工资已付 ${b.paidWages} / ${b.wageLimit}<br>采购已付 ${b.spentSupplies} / ${b.suppliesLimit}</p><p>${esc(prices(b.prices))}</p><small>有效至${time(b.expiresAt)}。${b.kind==='service'?'每次完成服务支付 '+b.wage+' 钱。':'完成修缮支付 '+b.wage+' 钱。'}</small></article>`).join('')||'<p class="panel-intro">通过表决并有足额钱款后，预算才会执行。</p>'}</div>
 <h3 class="section-label">公共物资</h3><div class="duty-list">${Object.entries(c.stores).filter(([,stock])=>Object.values(stock).some(n=>n>0)).map(([id,stock])=>`<article class="duty-card"><p>${place(w,id)}</p><small>${esc(bag(stock))}</small></article>`).join('')||'<p class="panel-intro">尚未有居民交付公共采购物资。</p>'}</div>
 <h3 class="section-label">最近收支</h3><div class="money-ledger">${e.ledger.slice(-30).reverse().map(entry=>`<article><small>${time(entry.at)}</small><p><span>${esc(account(w,entry.from))} → ${esc(account(w,entry.to))}</span><b>${entry.amount}</b></p><small>${esc(entry.reason)}</small></article>`).join('')||'<p class="panel-intro">尚无钱款流转。</p>'}</div>`;
}
