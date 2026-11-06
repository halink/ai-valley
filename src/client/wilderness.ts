import {beastNames,disasterNames} from '../shared/frontier-hazards.js';
import type {Vec,World} from '../shared/types.js';
import {fishSchoolView,fishingKey,waterAtShore,type FishSchoolView} from '../world/fishing.js';
import {animalNames} from '../world/industry.js';
import {dateLabel} from './community.js';
import {ecologyButton,ecologySummary,habitatLabels,shoalActivities} from './animal-observation.js';

const esc=(text:unknown)=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const locate=(at:Vec,label:string)=>`<button data-tile="${at.x},${at.y}">${label}</button>`;

export function wildernessPanel(w:World){
 const industry=w.industry,hazards=w.frontierHazards,shore=industry?.frontierShore;
 const animals=industry?.animals.filter(animal=>animal.status==='alive')??[];
 const beasts=hazards?.beasts.filter(beast=>beast.status==='alive')??[];
 const active=hazards?.disasters.filter(disaster=>disaster.phase!=='ended')??[];
 const near=w.map.settlement;
 const water=shore?waterAtShore(w,shore):undefined,localSchool=water?fishingKey(water):null;
 const schools=Object.keys(industry?.fishing??{}).map(key=>fishSchoolView(w,key)).filter((school):school is FishSchoolView=>!!school);
 const nearbySchools=schools.filter(s=>s.amount>0||s.id===localSchool).sort((a,b)=>{
  if(a.id===localSchool||b.id===localSchool)return a.id===localSchool?-1:1;
  const at=near??w.map.entrance;
  return Math.hypot(a.at.x-at.x,a.at.y-at.y)-Math.hypot(b.at.x-at.x,b.at.y-at.y);
 }).slice(0,6);
 const well=w.resources.filter(resource=>resource.kind==='spring').sort((a,b)=>near?Math.hypot(a.at.x-near.x,a.at.y-near.y)-Math.hypot(b.at.x-near.x,b.at.y-near.y):0)[0];
 const recent=w.events.filter(event=>event.kind==='hazard').slice(-8).reverse();
 const damaged=w.buildings.filter(building=>building.condition<100);
 return `<div class="chapter-links"><button data-panel="ecology">查看生计脉络</button>${localSchool&&schools.some(s=>s.id===localSchool)?ecologyButton({kind:'fish',id:localSchool},'村边鱼群'):''}</div>
 <div class="population-flows"><span>活畜 <b>${animals.length}</b></span><span>野生动物 <b>${beasts.length}</b></span><span>鱼群 <b>${schools.filter(s=>s.amount>0).length}</b></span><span>当前险情 <b>${active.length+beasts.filter(beast=>beast.alert?.residentId||beast.alert?.animalId).length}</b></span></div>
 <h3 class="section-label">牧场与畜舍</h3><div class="duty-list">${(industry?.pastures??[]).map(pasture=>{
  const barn=w.buildings.find(building=>building.id===pasture.barnId);
  return `<article class="duty-card"><b>${esc(barn?.name??'牧场')}</b><p>${pasture.tiles.length} 格草地 · 草料 ${Math.floor(pasture.forage)} / ${pasture.capacity} · 露天放牧 ${animals.filter(animal=>animal.pastureId===pasture.id&&!animal.inside).length} 只</p>${pasture.tiles[0]?locate(pasture.tiles[0],'查看牧场'):''}</article>`;
 }).join('')}${animals.map(animal=>{
  const subject={kind:'animal' as const,id:animal.id},summary=ecologySummary(w,subject)!;
  return `<article class="duty-card"><b>${summary.name} · ${animal.sex==='female'?'雌':'雄'}</b><p>${esc(summary.state)} · 饥饿 ${Math.round(animal.hunger)} · 口渴 ${Math.round(animal.thirst)} · 健康 ${Math.round(animal.health)}</p>${ecologyButton(subject)}</article>`;
 }).join('')||'<p class="empty">目前没有活畜。</p>'}</div>
 <h3 class="section-label">鱼群与取水</h3><p class="panel-intro">展示聚落附近的鱼群。地图上可点水纹查看其他水域。居民累计钓获 ${industry?.totals.fish??0} 份。</p>
 <div class="duty-list">${nearbySchools.map(s=>`<article class="duty-card"><b>${s.id===localSchool?'村边水域':habitatLabels[s.habitat]} · ${s.species??'鱼群'}</b><p>储量 ${s.amount} / ${s.capacity} · ${s.amount?shoalActivities[s.activity]:'等待自然恢复'}</p>${ecologyButton({kind:'fish',id:s.id})}</article>`).join('')||'<p class="empty">附近暂未观察到鱼群。</p>'}${well?`<article class="duty-card"><b>就近水源</b><p>可取用 ${Math.floor(well.amount)} / ${well.max} 份水</p>${locate(well.at,'查看水源')}</article>`:''}</div>
 <h3 class="section-label">野生动物与狩猎</h3>
 <p class="panel-intro">已猎获 ${hazards?.totals.hunted??0} 只 · 取得猎肉 ${industry?.totals.gameMeat??0} 份 · 牲畜遭袭 ${hazards?.totals.livestockAttacks??0} 次 · 遇袭死亡 ${hazards?.totals.livestockKilled??0} 只</p>
 <div class="duty-list">${beasts.map(beast=>{
  const subject={kind:'beast' as const,id:beast.id},summary=ecologySummary(w,subject)!;
  return `<article class="duty-card ${beast.alert?.residentId||beast.alert?.animalId?'danger-card':''}"><b>${summary.name}</b><p>${esc(summary.state)} · 饥饿 ${Math.round(beast.hunger)} · 健康 ${Math.round(beast.health)} · ${beast.at.x}, ${beast.at.y}</p>${ecologyButton(subject)}</article>`;
 }).join('')||'<p class="empty">目前没有活动的野生动物。</p>'}${(hazards?.foodPatches??[]).slice(0,12).map(patch=>`<article class="duty-card"><b>${{roots:'林地根茎',smallGame:'小型猎物栖地',browse:'可采食枝叶',seeds:'野生籽实'}[patch.kind]}</b><p>当前食源 ${patch.amount} / ${patch.capacity} · 随季节恢复</p>${locate(patch.at,'查看食源位置')}</article>`).join('')}</div>
 <h3 class="section-label">最近死亡的动物</h3><div class="duty-list">${[
  ...(hazards?.beasts.filter(n=>n.status==='dead').map(n=>({name:beastNames[n.species],at:n.deathAt??0,subject:{kind:'beast' as const,id:n.id}}))??[]),
  ...(industry?.animals.filter(n=>n.status==='dead').map(n=>({name:animalNames[n.kind],at:n.deathAt??0,subject:{kind:'animal' as const,id:n.id}}))??[]),
 ].sort((a,b)=>b.at-a.at).slice(0,5).map(record=>`<article class="duty-card"><b>${record.name}</b><p>${dateLabel(record.at)}</p>${ecologyButton(record.subject,'查看死亡记录')}</article>`).join('')||'<p class="empty">暂无死亡记录。</p>'}</div>
 <h3 class="section-label">灾害与受损建筑</h3><div class="duty-list">${active.map(disaster=>`<article class="duty-card danger-card"><b>${disasterNames[disaster.kind]} · ${disaster.phase==='warning'?'预警':'正在发生'}</b><p>影响周围 ${disaster.radius} 格 · 强度 ${Math.round(disaster.intensity)}%</p>${locate(disaster.at,'查看受影响地带')}</article>`).join('')||'<p class="empty">当前没有灾害预警。</p>'}${damaged.map(building=>`<article class="duty-card"><b>${esc(building.name)} · 状况 ${Math.floor(building.condition)}%</b><p>后续修护需要居民带着材料到场。</p>${locate(building.door,'查看受损建筑')}</article>`).join('')}</div>
 <h3 class="section-label">最近的野外记录</h3><div class="memory-list">${recent.map(event=>`<article><small>${dateLabel(event.at)}</small><p>${esc(event.text)}</p>${locate(event.place,'查看事发地')}</article>`).join('')||'<p class="empty">还没有野外记录。</p>'}</div>`;
}
