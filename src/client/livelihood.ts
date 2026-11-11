import {businessRelocationPanel} from './business-relocation.js';
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
 if(m.kind==='foodReserve')return `${m.foreignProcurement?`镇外采购经办人 ${w.residents.find(r=>r.id===m.foreignProcurement!.handlerId)?.name??'原经办人'}，指定商人 ${w.foreignTrade?.merchants.find(x=>x.id===m.foreignProcurement!.merchantId)?.name??'原商人'}；单价含既有陆运，不另付运费，税也计入预算；货物归公共，另送原共屋，携运者先交付再离谷，未成交到期/失能退运退款，已购货到期送原公共库、死亡原位保全。`:''}${w.buildings.find(b=>b.id===m.buildingId)?.name??'共屋'}公共储备 ${items[m.item]??m.item}，累计入库上限 ${m.quantity} 份，收购单价 ${m.unitPrice} 钱，采购预算 ${m.suppliesBudget} 钱；个人滚动24小时营养上限 ${m.dailyNutrition}，期限 ${m.durationDays} 日`;
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
  const reserve=w.civic?.reserves?.find(r=>r.supplyAccount===id);
  if(reserve)return (w.buildings.find(b=>b.id===reserve.buildingId)?.name??'共屋')+'储备粮采购预留款';
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
 return `${chapterLinks('market')}<p class="panel-intro">居民用自己的货物开张、定价和交易。买方自行填写数量及含税最高总支出，供货方填写最低到手总额；只有事前同意最低数量才可部分成交。每笔成交都实际交付货物与钱款。</p>
 <div class="population-numbers"><span><b>${businesses.length}</b>正在经营</span><span><b>${listings.filter(l=>l.side==='sale').reduce((n,l)=>n+l.quantity,0)}</b>在售货物</span></div>
 <h3 class="section-label">商铺与摊位</h3>
 <div class="duty-list">${businesses.map(b=>`<article class="duty-card economy-card"><div class="duty-heading"><b>${esc(b.name)}</b><span>${b.coins} 钱</span></div><p>经营者 ${person(w,b.ownerId)} · ${place(w,b.buildingId)}</p><p>自有库存 ${esc(bag(b.inventory))}</p><p>累计售出 ${b.sales} 份 · 营业收入 ${b.revenue}</p>
 ${listings.filter(l=>l.businessId===b.id).map(l=>`<div class="market-row"><span>${l.side==='purchase'?'收购':'出售'} ${items[l.item]} <b>× ${l.quantity}</b></span><span>${l.price} 钱 / 份</span></div>`).join('')||'<small>尚未挂牌出售商品。</small>'}</article>`).join('')||'<p class="empty">尚无居民决定开张。生产与经营的选择由他们自己作出。</p>'}</div>
 ${businessRelocationPanel(w)}
 <h3 class="section-label">最近实际成交</h3><div class="duty-list">${(economy.trades??[]).slice(-12).reverse().map(t=>`<article class="duty-card"><div class="duty-heading"><b>${t.operation==='buy'?'购买':'供货'} ${esc(items[t.item])} × ${t.quantity}</b><span>${time(t.at)}</span></div><p>${person(w,t.actorId)} · ${place(w,t.buildingId)}</p><p>原拟 ${t.requestedQuantity} 份 · 最低接受 ${t.minimumQuantity} 份${t.quantity<t.requestedQuantity?' · 按事前同意部分成交':''}<br>实际单价 ${t.unitPrice} 钱 · 货款 ${t.gross} 钱 · ${t.operation==='buy'?'买方':'商铺'}另付公共附加款 ${t.levy} 钱<br>${t.operation==='buy'?`本人最高总支出 ${t.maxTotal} 钱 · 实付 ${t.gross+t.levy} 钱`:`本人最低到手 ${t.minTotal} 钱 · 实收 ${t.gross} 钱`}</p></article>`).join('')||'<p class="panel-intro">尚无新版逐笔成交记录；旧成交仍保留在历史事件和收支账本。</p>'}</div>
 <h3 class="section-label">土地与生产</h3><div class="population-flows"><span>耕地 <b>${w.plots.length}</b></span><span>已种植 <b>${w.plots.filter(p=>p.crop).length}</b></span><span>原料与食物 <b>${Object.values(w.residents.reduce<Inventory>((acc,r)=>{if(r.status==='alive'&&r.residency!=='outside')for(const [key,n] of Object.entries(r.inventory))acc[key as keyof Inventory]=(acc[key as keyof Inventory]??0)+n!;return acc;},{})).reduce((a,b)=>a+b,0)}</b> 份</span></div>
 <p class="footnote">根菜可以食用、烹饪或留种。春秋、夏季、冬季有各自适种的根菜；生长依赖实际播种、浇水和时间。</p>`;
}
export function financePanel(w:World){
 const e=w.economy,c=w.civic;
 if(!e||!c)return `${chapterLinks('finance')}<p class="empty">公共账本尚未建立。</p>`;
 const publicAccounts=new Set([...(w.foreignTrade?.offers.filter(o=>o.publicReserveId&&o.escrowAccount).map(o=>o.escrowAccount!)??[]),...(w.foreignTrade?.shipments.filter(s=>s.publicReserveId).map(s=>s.escrowAccount)??[]),...c.budgets.flatMap(b=>[b.wageAccount,b.supplyAccount]),...(c.reserves?.map(r=>r.supplyAccount)??[]),...(w.duties?.shifts.flatMap(s=>s.funding?[s.funding.wageAccount]:[])??[])]);
 const reserved=[...publicAccounts].reduce((sum,id)=>sum+(e.escrows[id.slice(7)]??0),0);
 const proposals=c.proposals.slice(-12).reverse();
 const labels={open:'表决中',approved:'已通过',rejected:'未通过',unfunded:'未能执行'};
 return `${chapterLinks('finance')}<div class="population-numbers"><span><b>${e.treasury}</b>金库可用钱款</span><span><b>${reserved}</b>公共预留钱款</span></div>
 <p class="panel-intro">${c.salesTax&&c.salesTax.expiresAt>w.minute?`现行成交税 ${c.salesTax.basisPoints/100}%，至${dateLabel(c.salesTax.expiresAt)}。`:'目前没有生效的成交税。'}公共支出由居民提案、分别表态并筹集实际资金。</p>
 <div class="population-flows"><span>捐款 <b>${c.totals.donations}</b></span><span>工资 <b>${c.totals.wages}</b></span><span>采购 <b>${c.totals.procurement}</b></span><span>修缮 <b>${c.totals.repairs}</b></span></div>
 <h3 class="section-label">议事与表决</h3><div class="duty-list">${proposals.map(p=>{const yes=Object.values(p.votes).filter(Boolean).length,no=Object.values(p.votes).filter(v=>!v).length;return `<article class="duty-card"><div class="duty-heading"><b>${p.measure.kind==='foodReserve'?'公共储备粮议案':p.measure.kind==='salesTax'?'税收议案':p.measure.kind==='service'?'公共服务预算':p.measure.kind==='construction'?'公共建设议案':p.measure.kind==='education'?'课堂助学议案':'公共修缮预算'}</b><span>${labels[p.status]}</span></div><p>${person(w,p.proposerId)} 提出</p><p>${esc(measure(w,p.measure))}</p>${p.executionError?`<p>未执行：${esc(p.executionError)}</p>`:''}<div class="population-flows"><span>赞成 ${yes}</span><span>反对 ${no}</span><span>未表态 ${p.electorate.length-yes-no}</span></div><small>截至${time(p.closesAt)} · 登记 ${p.electorate.length} 位有表决权的居民</small></article>`;}).join('')||'<p class="empty">尚无居民提出公共议案。</p>'}</div>
 <h3 class="section-label">获准预算</h3><div class="duty-list">${c.budgets.slice(-12).reverse().map(b=>`<article class="duty-card"><div class="duty-heading"><b>${b.kind==='service'?'公共服务':'修缮'}</b><span>${b.status==='active'?'执行中':b.status==='completed'?'已完成':'已到期'}</span></div><p>${place(w,b.buildingId)}</p><p>工资已付 ${b.paidWages} / ${b.wageLimit}<br>采购已付 ${b.spentSupplies} / ${b.suppliesLimit}</p><p>${esc(prices(b.prices))}</p><small>有效至${time(b.expiresAt)}。${b.kind==='service'?'每次完成服务支付 '+b.wage+' 钱。':'完成修缮支付 '+b.wage+' 钱。'}</small></article>`).join('')||'<p class="panel-intro">通过表决并有足额钱款后，预算才会执行。</p>'}</div>
 <h3 class="section-label">公共储备粮</h3><p class="panel-intro">独立货架与一般公共物资分开列示，不重复计数。领取后须另行进食；个人滚动24小时额度与各处共屋公约、其他储备共用，换地点或换议案不会清零。</p><div class="duty-list">${(c.reserves??[]).slice(-12).reverse().map(r=>{
  const lots=w.food?.lots[`public-reserve:${r.id}`]?.[r.item]??[];
  const receipts=w.commons?.receipts.filter(receipt=>receipt.reserveId===r.id&&receipt.operation==='takeFood')??[];
  const remaining=e.escrows[r.supplyAccount.slice(7)]??0;
  const outside=r.foreignProcurement,orders=w.foreignTrade?.shipments.filter(s=>s.publicReserveId===r.id)??[],offers=w.foreignTrade?.offers.filter(o=>o.publicReserveId===r.id&&o.status==='open')??[];
  const committedCash=[...orders.map(s=>s.escrowAccount),...offers.flatMap(o=>o.escrowAccount?[o.escrowAccount]:[])].reduce((n,id)=>n+(e.escrows[id.slice(7)]??0),0);
  return `<article class="duty-card"><div class="duty-heading"><b>${esc(items[r.item]??r.item)}储备</b><span>${r.status==='active'&&r.expiresAt>w.minute?'执行中':'已到期'}</span></div><p>${place(w,r.buildingId)}</p><p>实际货架库存 ${esc(bag(r.inventory))}</p><p>累计入库 ${r.stocked} / ${r.quantityLimit} 份（本地收购 ${r.purchased-(outside?.acquired??0)} · 镇外实际交付 ${outside?.delivered??0} · 既有公粮转入 ${r.opened}）<br>累计领走 ${r.withdrawn} 份；腐败不恢复入库额度</p><p>收购单价 ${r.unitPrice} 钱 / 份 · 采购已付 ${r.spent} / ${r.suppliesLimit} 钱<br>尚余预留款 ${remaining} 钱 · 已退金库 ${r.refunded} 钱</p>${outside?`<p>镇外经办 ${person(w,outside.handlerId)} · 指定商人 ${esc(w.foreignTrade?.merchants.find(m=>m.id===outside.merchantId)?.name??outside.merchantId)}<br>报价/运输占款 ${committedCash} 钱 · 已购 ${outside.acquired} 份 · 已送原址 ${outside.delivered} 份</p><p>独立公共货单（不计作货架或私人食物）：${orders.filter(s=>s.goods>0).map(s=>`${s.goods}份 · ${s.publicCarrier?`${s.publicCarrier.sealed?'原位封存':'随经办携运'}（${s.publicCarrier.at.x},${s.publicCarrier.at.y}）`:s.status==='arrived'?'实际到站待携运':s.status==='returning'?'实际退运中':'运输中'} · ${(w.food?.lots['shipment:'+s.id]?.[s.item]??[]).map(l=>`原批次${l.quantity}份至${time(l.expiresAt)}`).join('、')}`).join('；')||'无现存货物'}</p>`:''}<p>个人滚动24小时营养上限 ${r.dailyNutrition}</p><small>${time(r.startsAt)} 至 ${time(r.expiresAt)}；到期余粮原地转回一般公共库存。</small>${lots.length?`<p>现存食品原批次到期：${lots.map(l=>`${l.quantity} 份 · ${time(l.expiresAt)}`).join('；')}</p>`:''}
  <details><summary>入库记录（${r.receipts.length}）</summary>${r.receipts.slice(-12).reverse().map(receipt=>`<p>${time(receipt.at)} · ${person(w,receipt.personId)} · ${receipt.operation==='supplyReserve'?'自有食品供货':receipt.operation==='deliverReserve'?'镇外公粮实际交付':'既有公粮转入'} ${receipt.quantity} 份 · ${receipt.coins} 钱</p>`).join('')||'<p>尚无实际入库。</p>'}</details>
  <details><summary>领取记录（${receipts.length}）</summary>${receipts.slice(-12).reverse().map(receipt=>`<p>${time(receipt.at)} · ${person(w,receipt.residentId)} · ${esc(bag(receipt.inventory))} · 营养 ${receipt.nutrition}</p>`).join('')||'<p>尚无实际领取。</p>'}</details></article>`;
 }).join('')||'<p class="panel-intro">尚无获准的有限储备粮议案。</p>'}</div>
 <h3 class="section-label">公共物资</h3><div class="duty-list">${Object.entries(c.stores).filter(([,stock])=>Object.values(stock).some(n=>n>0)).map(([id,stock])=>`<article class="duty-card"><p>${place(w,id)}</p><small>${esc(bag(stock))}</small></article>`).join('')||'<p class="panel-intro">尚未有居民交付公共采购物资。</p>'}</div>
 <h3 class="section-label">最近收支</h3><div class="money-ledger">${e.ledger.slice(-30).reverse().map(entry=>`<article><small>${time(entry.at)}</small><p><span>${esc(account(w,entry.from))} → ${esc(account(w,entry.to))}</span><b>${entry.amount}</b></p><small>${esc(entry.reason)}</small></article>`).join('')||'<p class="panel-intro">尚无钱款流转。</p>'}</div>`;
}
