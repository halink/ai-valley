import type {World} from '../shared/types.js';
import {chapterLinks,dateLabel} from './community.js';
import {subjects} from '../world/education.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const person=(w:World,id:string)=>`<button data-person="${esc(id)}">${esc(w.residents.find(r=>r.id===id)?.name??'原居民')}</button>`;
const time=(n:number)=>`${dateLabel(n)} ${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(Math.floor(n)%60).padStart(2,'0')}`;
const coins=(w:World,id:string)=>w.economy?.escrows[id.slice(7)]??0;
export function educationPanel(w:World){
 const state=w.education,lessons=state?.lessons??[],courses=[...lessons.filter(l=>l.status==='scheduled'),...lessons.filter(l=>l.status!=='scheduled').slice(-8).reverse()];
 return `${chapterLinks('education')}<p class="panel-intro">老师自主发布课堂，学生分别报名。只有师生同时在教学桌参与的时间才产生技能和报酬，缺席不会补出进度。</p>
 <div class="population-flows"><span>课堂 <b>${state?.totals.lessons??0}</b></span><span>完成学习 <b>${state?.totals.completed??0}</b></span><span>已付学费 <b>${state?.totals.paid??0}</b></span></div>
 <div class="duty-list">${courses.map(l=>`<article class="duty-card education-card"><div class="duty-heading"><b>${subjects[l.subject]}课堂</b><span>${l.status==='scheduled'?(w.minute<l.start?'等待开课':'课堂窗口内'):l.status==='finished'?'已结束':'已取消'}</span></div>
 <p>教师：${person(w,l.teacherId)}<br>${time(l.start)}—${time(l.end)}<br>同时 ${l.capacity} 席 · 完整 ${l.minutes} 分钟学费 ${l.fee} 钱 · 本场最多增长 ${l.gain} 级</p>
 <p>示范材料：${Object.entries(l.materials).map(([i,n])=>`${({seed:'种子',water:'清水',wood:'木材',stone:'石料',meal:'餐食'} as Record<string,string>)[i]??i} ${n}`).join('、')} · ${l.materialsUsed?'已实际投入':'尚未投入'}<br>教师实际授课 ${Math.floor(l.taught)} 分钟</p>
 ${l.reason||l.pauseReason?`<p class="project-wait">${esc(l.reason??l.pauseReason)}</p>`:''}
 ${l.funding?`<p>公共助学：预留 ${l.funding.allocated} 钱，可用 ${coins(w,l.funding.account)} 钱，已退金库 ${l.funding.refunded} 钱。</p>`:''}
 ${l.enrollments.map(e=>`<div class="education-pupil">${person(w,e.learnerId)} <span>${({enrolled:'已自主报名',completed:'已完成学习',withdrawn:'本人退出',ended:'已结束'} as const)[e.status]}</span><progress value="${e.worked}" max="${l.minutes}" aria-label="${esc(w.residents.find(r=>r.id===e.learnerId)?.name)}学习进度"></progress><small>共同学习 ${Math.floor(e.worked*10)/10} 分钟 · 技能 +${e.gained.toFixed(2)} · 已付 ${e.paid} 钱 · 已退 ${e.refunded} 钱<br>${e.payer==='treasury'?'公共助学':e.payer===e.learnerId?'本人自费':esc(w.residents.find(r=>r.id===e.payer)?.name)+'代付'}</small></div>`).join('')||'<p>尚无学生报名。</p>'}
 ${l.offers.filter(o=>o.status==='offered').map(o=>`<p>${person(w,o.payerId)}愿为${person(w,o.learnerId)}代付 ${o.amount} 钱，等待学习者自行接受。</p>`).join('')}
 <div class="place-actions"><button data-locate="${esc(l.buildingId)}">地图定位</button><button data-enter="${esc(l.buildingId)}">看看课堂</button></div></article>`).join('')||'<p class="empty">尚无居民发布课程。学校和共用房间不会自动产出学习进度。</p>'}</div>`;
}
