import {regionSurveyPanel} from './region-survey.js';
import {landRightsPanel} from './land-rights.js';
import {ferryPanel} from './ferry.js';
import type {World} from '../shared/types.js';
import type {ConstructionProject} from '../shared/construction.js';
import {chapterLinks,dateLabel} from './community.js';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const status={proposed:'待公共表决',planned:'筹备施工',active:'分阶段施工',paused:'停工保留',abandoned:'未完工遗留',completed:'已交付',cancelled:'未开工结束',removed:'已拆除'};
const names={home:'住宅',lodge:'旅舍',workshop:'工坊',clinic:'照护所',school:'校舍',barn:'畜舍',greenhouse:'温室',store:'店铺',road:'道路',bridge:'桥梁',dock:'码头',cemetery:'墓园扩建'};
const coins=(w:World,id:string)=>w.economy?.escrows[id.slice(7)]??0;
const person=(w:World,id:string)=>`<button data-person="${esc(id)}">${esc(w.residents.find(r=>r.id===id)?.name??'原居民')}</button>`;
const source=(w:World,id:string)=>id==='treasury'?'公共金库':person(w,id.replace(/^resident:/,''));
const minutes=(n:number)=>Math.floor(n*10)/10;
const material=(p:ConstructionProject,item:string)=>p.stock.filter(l=>l.item===item).reduce((n,l)=>n+l.quantity,0);
export function projectSummary(w:World,p:ConstructionProject){
 const s=p.stages[p.stage],short=s?`${s.name} · ${minutes(s.worked)} / ${s.minutes} 分钟`:'全部阶段已完成';
 return `<span class="duty-status">${status[p.status]}</span><p>${esc(short)}。${p.reason?esc(p.reason)+'。':''}${p.ownerId==='commons'?'公共产权':esc(w.residents.find(r=>r.id===p.ownerId)?.name??'原居民')+'所有'} · ${names[p.kind]}${p.mode==='conversion'?'用途改造':p.mode==='expansion'?'扩建':''}</p>`;
}
export function constructionPanel(w:World){
 const upgrades=(w.buildingMigrations??[]).slice(-24);
 const state=w.construction,projects=state?.projects??[],active=projects.filter(p=>!['completed','cancelled','removed'].includes(p.status)),history=projects.filter(p=>['completed','cancelled','removed'].includes(p.status)).slice(-12).reverse();
 const card=(p:ConstructionProject)=>{
  const stage=p.stages[p.stage],missing=stage&&stage.startedAt===null?Object.entries(stage.materials).filter(([item,n])=>material(p,item)<n!).map(([item,n])=>`${item==='wood'?'木材':'石料'} ${n!-material(p,item)}`).join('、'):'';
  const workers=p.workers.filter(c=>c.status==='active'||c.status==='offered');
  const held=workers.reduce((sum,c)=>sum+coins(w,c.account),0);
  return `<article class="duty-card project-card"><div class="duty-heading"><b>${esc(p.name)}</b><span>${status[p.status]}</span></div>
   <p>${names[p.kind]} · ${p.mode==='terrain'?'地形与公共通路工程':p.mode==='conversion'?'用途改造':p.mode==='expansion'?'扩建':'新建'} ${p.width} × ${p.height} 格 · (${p.at.x}, ${p.at.y})<br>产权：${p.ownerId==='commons'?'社区共有':person(w,p.ownerId)} · 负责人：${person(w,p.managerId)}</p>
   <ol class="project-stages">${p.stages.map((s,i)=>`<li class="${s.finishedAt!==null?'done':i===p.stage?'current':''}"><div><b>${esc(s.name)}</b><span>${minutes(s.worked)} / ${s.minutes} 分钟</span></div><progress value="${s.worked}" max="${s.minutes}" aria-label="${esc(s.name)}进度"></progress><small>木材 ${s.materials.wood??0} · 石料 ${s.materials.stone??0} · ${s.finishedAt!==null?'已完工':s.startedAt!==null?'材料已投入':'尚未投入材料'}</small></li>`).join('')}</ol>
   ${p.reason?`<p class="project-wait">${esc(p.reason)}</p>`:missing?`<p class="project-wait">本阶段还缺 ${missing}，当前不能施工。</p>`:p.status==='planned'||p.status==='active'?'<p class="project-wait">材料已就绪，下一次开工仍等居民自行决定。</p>':''}
   <div class="contract-terms"><span>现场木 / 石<b>${material(p,'wood')} / ${material(p,'stone')}</b></span><span>可用工程款<b>${coins(w,p.account)} 钱</b></span><span>预存工资<b>${held} 钱</b></span></div>
   <p>报价：木材 ${p.prices.wood} 钱 / 份 · 石料 ${p.prices.stone} 钱 / 份<br>施工 ${p.wagePerHour} 钱 / 小时 · 已支付工资 ${p.spentWages} 钱、货款 ${p.spentSupplies} 钱</p>
   ${p.grants.length?`<p class="project-funders">${p.grants.map(g=>`${source(w,g.source)}：投入 ${g.amount}，未用 ${g.remaining}，已退 ${g.refunded}`).join('<br>')}</p>`:'<small>尚无资金投入。产权人也可以自行供料、自行施工。</small>'}
   <p>${workers.length?workers.map(c=>`${person(w,c.workerId)} · ${c.status==='offered'?'已获邀请，待本人接受':'已独立接受'} · 已做 ${minutes(c.worked)} 分钟、实得 ${c.paid} 钱`).join('<br>'):'暂无有效施工委托'}${p.applications.some(a=>a.status==='pending')?`<br>待处理申请：${p.applications.filter(a=>a.status==='pending').map(a=>person(w,a.workerId)).join('、')}`:''}</p>
   ${p.labor.length?`<small>实际施工：${p.labor.map(l=>`${esc(w.residents.find(r=>r.id===l.workerId)?.name??'原施工者')} ${minutes(l.minutes)} 分钟`).join(' · ')}</small>`:''}
   ${p.claims.length?`<small>待领实物：${p.claims.map(l=>`${l.source==='treasury'?'公共所有':esc(w.residents.find(r=>r.id===l.source.slice(9))?.name??'原所有人')}的${l.item==='wood'?'木材':'石料'} ${l.quantity}`).join(' · ')}</small>`:''}
   <small>${dateLabel(p.createdAt)} 提议${p.ownerId==='commons'?p.authorizedUntil!==null?' · 公共授权至'+dateLabel(p.authorizedUntil):' · 尚未取得公共用地授权':''}</small>
   <div class="place-actions"><button data-project="${esc(p.id)}">查看工地</button>${p.buildingId?`<button data-locate="${esc(p.buildingId)}">查看原址建筑</button>`:''}</div></article>`;
 };
 return `${chapterLinks('construction')}${regionSurveyPanel(w)}${landRightsPanel(w)}<p class="panel-intro">用途、选址、出资和施工由居民分别决定。材料与劳动逐阶段投入，完工才启用新增空间。这里仅供观察。</p>
 <div class="population-flows"><span>进行与遗留 <b>${active.length}</b></span><span>新建交付 <b>${state?.totals.completed??0}</b></span><span>扩建交付 <b>${state?.totals.expanded??0}</b></span></div>
 <div class="duty-list">${active.map(card).join('')||'<p class="empty">居民还没有提出建设工程。房屋不会按预设时间自动出现。</p>'}</div>${upgrades.length?`<h3 class="section-label">建筑兼容改版</h3><div class="duty-list">${upgrades.map(m=>{const b=w.buildings.find(b=>b.id===m.buildingId),p=m.residentProposal;return `<article class="duty-card"><h3>${esc(b?.name??'原建筑')}${p?' · 居民屋面提议':''}</h3>${p?`<p>提议人：${person(w,p.proposerId)} · ${p.roof==='wood'?'木面':'石板'}屋面<br>报价：木材 ${m.charge.wood??0}、石料 ${m.charge.stone??0}；已实际投入：木材 ${p.consumed.wood??0}、石料 ${p.consumed.stone??0}<br>期限：${dateLabel(m.expiresAt)}。占地、容量、屋况、储物、工位与原约不变。</p><p>${p.parties.map(s=>`${person(w,s.residentId)}（${esc(s.roles.join('、'))}）：${s.acceptedAt!==null?'已独立同意':s.reviewedAt!==null?'已读，尚未同意':'尚未阅读'}`).join('<br>')}</p>${p.reason?`<p>${esc(p.reason)}</p>`:''}`:''}<p>${({offered:'等待本人决定',accepted:'已接受，施工中',declined:'本人已婉拒',cancelled:'已停止',expired:'已到期',completed:'实际完成'} as const)[m.status]} · 实际 ${m.worked.toFixed(1)}/${m.minutes} 分钟<br>原址保留：木材 ${m.stock.wood??0}、石料 ${m.stock.stone??0}</p>${b?`<button data-locate="${esc(b.id)}">查看原建筑</button>`:''}</article>`;}).join('')}</div>`:''}${ferryPanel(w)}${history.length?`<h3 class="section-label">近期工程记录</h3><div class="duty-list">${history.map(card).join('')}</div>`:''}`;
}
