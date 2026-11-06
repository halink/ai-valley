import type {World} from '../shared/types.js';
import {fishSchoolView,fishingKey,waterAtShore} from '../world/fishing.js';
import {cropYieldAt,soilFertility} from '../world/frontier-nutrients.js';
import {itemLabels} from '../shared/items.js';
import {calendar,DAY} from '../world/time.js';
import {dateLabel} from './community.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

export function ecologyPanel(w:World):string {
 const industry=w.industry,nutrients=w.production?.nutrients,shore=industry?.frontierShore;
 const people=w.residents.filter(resident=>resident.status==='alive'&&resident.residency!=='outside');
 const carried=(item:keyof typeof itemLabels)=>people.reduce((total,resident)=>total+(resident.inventory[item]??0),0);
 const water=shore&&waterAtShore(w,shore),school=water&&fishSchoolView(w,fishingKey(water));
 const herds=industry?.animals.filter(animal=>animal.status==='alive')??[];
 const pasture=industry?.pastures?.reduce((total,pasture)=>total+pasture.forage,0)??0;
 const freshWater=w.resources.find(resource=>resource.kind==='spring'&&w.map.settlement&&Math.abs(resource.at.x-w.map.settlement.x)+Math.abs(resource.at.y-w.map.settlement.y)<12);
 const fields=[...w.plots].sort((a,b)=>Number(!!b.crop)-Number(!!a.crop)||soilFertility(w,a.id)-soilFertility(w,b.id));
 const ecologicalFacts=w.events.filter(event=>['production','hazard','trade','construction'].includes(event.kind)).slice(-10).reverse();
 const designCount=w.designs?.records.length??0;
 return `<p class="panel-intro">村民从同一片山谷取得食物、饲料、清水和建材。下面列的是当前存量与实际发生的变化。</p>
 <div class="flow-observer">
 <article class="duty-card"><b>草料、牲畜与土地</b><p>牧草 ${Math.floor(pasture)} 份 · 活畜 ${herds.length} 只 · 居民随身饲料 ${carried('fodder')} 份</p>
 <p>动物进食后留下的畜粪可由居民收集制成堆肥。实际施肥 ${nutrients?.fertilized??0} 次，已从农地收获 ${nutrients?.harvested??0} 份作物。</p>
 <p>地上畜粪 ${nutrients?.heaps.reduce((sum,pile)=>sum+pile.units,0)??0} 份 · 随身畜粪 ${carried('manure')} 份 · 随身堆肥 ${carried('compost')} 份</p>
 <button data-panel="wild">查看牧场与动物</button></article>
 <article class="duty-card"><b>河水、鱼群与村里的餐食</b><p>此刻${w.weather==='rain'?'下雨，露天田地可得到雨水':'晴朗，田地需要实际取水浇灌'}。${freshWater?`就近水源剩 ${Math.floor(freshWater.amount)} 份。`:''}</p>
 <p>${school?`村边水域有 ${school.amount} 份鱼群存量。`:''}累计钓获 ${industry?.totals.fish??0} 份 · 居民随身鲜鱼 ${carried('fish')} 份 · 随身餐食 ${carried('meal')} 份</p>
 ${school?`<button data-tile="${school.at.x},${school.at.y}">查看鱼群位置</button>`:''} ${freshWater?`<button data-tile="${freshWater.at.x},${freshWater.at.y}">查看取水点</button>`:''}</article>
 <article class="duty-card"><b>从图纸到实物</b><p>${designCount?`居民完成了 ${designCount} 份设计。可以分别追踪图纸、实际工具与工地。`:'居民可以在有条件时自行起草图纸。材料、劳动和场地由后续实际行动落实。'}</p>
 <button data-panel="designs">查看居民图纸</button> <button data-panel="market">查看实际交易</button></article>
 </div>
 <h3 class="section-label">农地现况</h3>
 <div class="duty-list">${fields.slice(0,12).map(plot=>{
  const crop=plot.crop,def=crop?w.definitions[crop.definition]:undefined;
  const orchard=industry?.trees.some(tree=>tree.plotId===plot.id&&tree.status!=='cut');
  const owner=w.residents.find(resident=>resident.id===plot.ownerId);
  const watered=w.weather==='rain'||crop?.wateredDay===Math.floor(w.minute/DAY);
  return `<article class="duty-card"><b>${esc(owner?.name??'未登记耕作者')}的田地</b><p>肥力 ${soilFertility(w,plot.id)}/100 · ${crop&&def?`${esc(def.data.name)} · ${watered?'今日已得水':'今日未浇灌'} · 当前预计收成 ${cropYieldAt(w,plot,Number(def.data.yield))} 份`:orchard?'已有果树':'目前休耕'}</p>
  <button data-tile="${plot.at.x},${plot.at.y}">查看田地</button></article>`;
 }).join('')||'<p class="empty">没有已登记的田地。</p>'}</div>
 ${(nutrients?.heaps.length??0)?`<h3 class="section-label">饲养地留下的物资</h3><div class="duty-list">${nutrients!.heaps.slice(0,10).map(pile=>`<article class="duty-card"><b>${pile.units} 份畜粪</b> <button data-tile="${pile.at.x},${pile.at.y}">定位堆放处</button></article>`).join('')}</div>`:''}
 <h3 class="section-label">最近的生计变化</h3>
 <div class="memory-list">${ecologicalFacts.map(event=>{
  const at=calendar(event.at);
  return `<article><small>${dateLabel(event.at)} ${String(at.hour).padStart(2,'0')}:${String(at.minute).padStart(2,'0')}</small><p>${esc(event.text)}</p><button data-tile="${event.place.x},${event.place.y}">查看发生地点</button> ${event.designId?'<button data-panel="designs">查阅图纸</button>':''}</article>`;
 }).join('')||'<p class="empty">还没有生计记录。</p>'}</div>`;
}
