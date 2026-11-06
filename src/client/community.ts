import type {Resident,World} from '../shared/types.js';
import type {PublicShift} from '../shared/public-duties.js';
import {headcount} from '../shared/demography.js';
import {ageYears,calendar,DAY} from '../world/time.js';

const esc=(text:unknown)=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const seasons={spring:'春',summer:'夏',autumn:'秋',winter:'冬'};
export function dateLabel(minute:number){
 const time=calendar(minute);
 return `第 ${time.year} 年 ${seasons[time.season]}${time.day}日`;
}
function hour(minute:number){
 const time=calendar(minute);
 return `${String(time.hour).padStart(2,'0')}:${String(time.minute).padStart(2,'0')}`;
}
export function chapterLinks(active:'people'|'population'|'places'|'duties'|'market'|'finance'|'employment'|'foreign'|'construction'|'education'|'industry'|'health'|'longCare'|'support'|'infrastructure'|'debt'|'household'){
 const chapters=active==='people'||active==='population'||active==='household'?[['people','居民名册'],['population','人口簿'],['household','共同生活钱物']]:[['places','场所'],['construction','建设'],['education','学堂'],['industry','产业'],['health','照护'],['duties','排班'],['market','经营'],['finance','公共账本']];
 const building=['construction','infrastructure'].includes(active);
 const caring=['health','longCare','support'].includes(active);
 const trading=['market','employment','foreign','debt'].includes(active);
 return `<nav class="community-tabs" aria-label="观察内容">${chapters.map(([key,label])=>`<button data-panel="${key}" aria-current="${active===key||trading&&key==='market'||caring&&key==='health'||building&&key==='construction'?'page':'false'}">${label}</button>`).join('')}</nav>`+
  (building?`<nav class="commerce-tabs" aria-label="建设记录">${[['construction','建筑与工地'],['infrastructure','道路、水岸与墓园']].map(([key,label])=>`<button data-panel="${key}" aria-current="${active===key?'page':'false'}">${label}</button>`).join('')}</nav>`:'')+
  (caring?`<nav class="commerce-tabs" aria-label="照护记录">${[['health','伤病与诊疗'],['longCare','托育与养老'],['support','公共保障']].map(([key,label])=>`<button data-panel="${key}" aria-current="${active===key?'page':'false'}">${label}</button>`).join('')}</nav>`:'')+
  (trading?`<nav class="commerce-tabs" aria-label="经营记录">${[['market','商铺买卖'],['employment','长期雇佣'],['foreign','镇外贸易'],['debt','借款与清算']].map(([key,label])=>`<button data-panel="${key}" aria-current="${active===key?'page':'false'}">${label}</button>`).join('')}</nav>`:'');
}
function personLink(world:World,id:string){
 const person=world.residents.find(p=>p.id===id);
 return person?`<button data-person="${esc(person.id)}">${esc(person.name)}</button>`:'';
}
export function censusPanel(world:World){
 const count=headcount(world);
 const living=world.residents.filter(person=>person.status==='alive'&&person.residency==='resident');
 const young=living.filter(person=>ageYears(person.bornAt,world.minute)<18).length;
 const elders=living.filter(person=>ageYears(person.bornAt,world.minute)>=65).length;
 const expecting=living.filter(person=>person.pregnancy).length;
 const record=world.population;
 const recent=record?.recent.slice().reverse()??[];
 const totals=record?.seasons.at(-1)?.changes??{};
 const road=world.migration?.contacts.filter(person=>person.phase==='travelling'||person.phase==='offered')??[];
 return `${chapterLinks('population')}
 <div class="population-numbers"><span><b>${count.residents}</b>常住居民</span><span><b>${count.visitors}</b>在镇访客</span></div>
 <p class="panel-intro">未满 18 岁 ${young} 人 · 65 岁及以上 ${elders} 人${expecting?' · '+expecting+' 人正在孕育':''}</p>
 <div class="population-flows"><span>本季出生 <b>${totals.birth??0}</b></span><span>定居 <b>${totals.settle??0}</b></span><span>迁出 <b>${totals.depart??0}</b></span><span>离世 <b>${totals.death??0}</b></span></div>
 ${record?`<p class="footnote">本簿自${dateLabel(record.since)}登记，当时常住 ${record.baseline} 人。</p>`:''}
 ${road.length?`<h3 class="section-label">西南驿路</h3><div class="road-notices">${road.map(person=>`<p><b>${esc(person.name)}</b> · ${esc(person.origin)}<br><span>${person.phase==='travelling'?'已自主启程，预计'+hour(person.journey!.arriveAt)+'抵达':person.journey?.blocked?'正在考虑路阻后的去向':'已收到来访消息，正在自行考虑'}</span></p>`).join('')}</div>`:''}
 <h3 class="section-label">人口与家庭纪事</h3>
 ${recent.length?`<div class="timeline">${recent.map(event=>`<article class="timeline-event"><span class="timeline-dot"></span><small>${dateLabel(event.at)} · ${hour(event.at)}</small><p>${esc(event.text)}</p><div class="event-people">${event.actors.map(id=>personLink(world,id)).join('')}</div></article>`).join('')}</div>`:'<p class="panel-intro">这里会记录到访、定居、出生、成家、迁出和离世。</p>'}
 ${record&&record.seasons.length>1?`<h3 class="section-label">历季人口</h3><div class="population-seasons">${record.seasons.slice(-12).reverse().map(period=>`<p><span>第 ${period.year} 年 · ${seasons[period.season]}</span><b>${period.residents} 常住 · ${period.visitors} 访客</b></p>`).join('')}</div>`:''}`;
}
const statuses:Record<PublicShift['status'],string>={open:'待认领',booked:'已接班', 'on-duty':'已到岗',finished:'已结束',unfilled:'空班'};
const roles={kitchen:'公用厨房',care:'社区照护'};
export function dutiesPanel(world:World,open:ReadonlyMap<string,boolean>=new Map()){
 const day=Math.floor(world.minute/DAY);
 const shifts=(world.duties?.shifts??[]).filter(shift=>Math.floor(shift.start/DAY)>=day&&Math.floor(shift.start/DAY)<=day+1);
 const sorted=shifts.slice().sort((a,b)=>a.start-b.start||a.buildingId.localeCompare(b.buildingId));
 return `${chapterLinks('duties')}<p class="panel-intro">今天与明天的班次。居民自行报名，已获公共预算的岗位按实际完成的服务支付报酬。</p>
 <div class="duty-list">${sorted.map(shift=>{
  const building=world.buildings.find(b=>b.id===shift.buildingId);
  const source=world.residents.find(p=>p.id===shift.workerId);
  return `<article class="duty-card"><div class="duty-heading"><b>${roles[shift.role]}</b><span class="duty-status status-${shift.status}">${statuses[shift.status]}</span></div>
   <p>${dateLabel(shift.start)} · ${hour(shift.start)}—${hour(shift.end)}</p>
   <button class="duty-location" data-locate="${esc(shift.buildingId)}">${esc(building?.name??'原场所')}</button>
   <p>${source?personLink(world,source.id):'暂无居民接班'}<span class="duty-served">已服务 ${shift.served} 次</span></p>
   ${shift.assignments.length?`<details data-duty-shift="${esc(shift.id)}" ${open.get(shift.id)?'open':''}><summary>交接经过</summary>${shift.assignments.map(assignment=>`<p>${personLink(world,assignment.residentId)} · ${hour(assignment.acceptedAt)} 接班${assignment.arrivedAt===null?'':'，'+hour(assignment.arrivedAt)+' 到岗'}${assignment.leftAt===null?'':'，'+hour(assignment.leftAt)+' 离岗'}</p>`).join('')}</details>`:''}
   <small>${shift.funding?`每次服务报酬 ${shift.funding.wagePerService}，本班已支付 ${shift.funding.paid}。使用本处实际公共物资。`:(shift.role==='kitchen'?'互助班每份由厨师提供 2 根菜和 1 水。':'互助班每次由照护员提供 1 餐食和 1 水。')}服务需本人到场申请。</small>
  </article>`;
 }).join('')||'<p class="empty">附近公共场所的班表尚待张贴。</p>'}</div>`;
}
export function familyPanel(world:World,person:Resident){
 const children=world.residents.filter(p=>p.parents.includes(person.id)),adopted=world.residents.filter(p=>p.adoptiveParents?.includes(person.id));
 const childIds=new Set(children.map(p=>p.id));
 const grandchildren=world.residents.filter(p=>p.parents.some(id=>childIds.has(id)));
 const row=(name:string,ids:string[])=>ids.length?`<div><span>${name}</span><b>${ids.map(id=>personLink(world,id)).join('、')}</b></div>`:'';
 const pregnancy=person.pregnancy;
 return `<h3 class="section-label">家庭与世代</h3><div class="profile-facts family-facts">
 ${row('出生父母',person.parents)}${row('养亲',person.adoptiveParents??[])}${row('监护人',person.guardianIds)}
 ${row('子女',children.map(p=>p.id))}${row('养子女',adopted.map(p=>p.id))}${row('孙辈',grandchildren.map(p=>p.id))}
 ${pregnancy?`<div><span>孕育</span><b>预计${dateLabel(pregnancy.dueAt)}，另一位家长 ${personLink(world,pregnancy.otherParentId)}</b></div>`:''}
 ${!person.parents.length&&!children.length&&!pregnancy?'<p class="panel-intro">尚无已登记的上下代亲缘。</p>':''}
 </div>`;
}
