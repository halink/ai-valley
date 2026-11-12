import {crateLocation} from '../world/livestock-cargo.js';
import type {World} from '../shared/types.js';
import {toolKits} from '../shared/industry.js';
import {ecologyButton} from './animal-observation.js';
import {fishingEcologyPanel} from './fishing-observation.js';
import {chapterLinks,dateLabel} from './community.js';import {itemLabels} from '../shared/items.js';import {stationNames} from '../world/industry-content.js';import {animalNames} from '../world/industry.js';import {DAY} from '../world/time.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const stock=(bag:object)=>Object.entries(bag).filter(([,n])=>n>0).map(([i,n])=>`${esc(itemLabels[i as keyof typeof itemLabels]??i)} ${n}`).join('、')||'无';
const card=(title:string,body:string)=>`<article class="duty-card"><h3>${title}</h3>${body}</article>`;
export function industryPanel(w:World){
 const s=w.industry;if(!s)return `${chapterLinks('industry')}<p class="empty">产业记录尚未登记。</p>`;
 const name=(id:string)=>esc(w.residents.find(r=>r.id===id)?.name??'原居民');
 const person=(id:string)=>`<button data-person="${esc(id)}">${name(id)}</button>`;
 const place=(id:string)=>{const b=w.buildings.find(b=>b.id===id);return b?`<button data-enter="${esc(id)}">看看${esc(b.name)}</button>`:'原场所已不可用';};
 const tile=(at:{x:number;y:number})=>`<button data-tile="${at.x},${at.y}">地图定位</button>`;
 const batches=s.batches.filter(b=>b.status==='working');
 return `${chapterLinks('industry')}<p class="panel-intro">果树、动物、加工批次和工具都有自己的记录。居民选择种什么、照料谁、生产什么；这里展示实际进度。</p>
 <div class="population-flows"><span>在制批次 <b>${batches.length}</b></span><span>活畜 <b>${s.animals.filter(n=>n.status==='alive').length}</b></span><span>果树 <b>${s.trees.filter(t=>t.status!=='cut').length}</b></span></div>
 <h3 class="section-label">加工与工位</h3><div class="duty-list">${batches.map(b=>card(esc(b.recipe.name),`<p>${person(b.ownerId)} · 投入${stock(b.input)}<br>实际工作 ${Math.floor(b.worked)} / ${b.recipe.minutes} 分钟</p><progress value="${b.worked}" max="${b.recipe.minutes}" aria-label="加工进度"></progress>${place(b.buildingId)}`)).join('')||'<p class="empty">没有正在制作的批次。</p>'}
 ${s.stations.map(a=>card(stationNames[a.kind],`<p>${dateLabel(a.installedAt)}安装 · 使用时仍需实际原料与劳动。</p>${place(a.buildingId)}`)).join('')}</div>
 <h3 class="section-label">果园</h3><div class="duty-list">${s.trees.filter(t=>t.status!=='cut').map(t=>card(t.status==='mature'?'成熟果树':'成长中的果树',`<p>${person(t.ownerId)} · 实际成长 ${(t.growth/DAY).toFixed(1)} / 28 日<br>成熟水果 ${t.fruit} 份 · ${t.lastWateredDay===Math.floor(w.minute/DAY)||w.weather==='rain'?'今日有水':'今日尚未浇水'}</p>${tile(t.at)}`)).join('')||'<p class="empty">尚无人种下果树。</p>'}</div>
 <h3 class="section-label">活畜运输笼</h3><p class="panel-intro">每只动物从源头开始成长和饥渴，报价、运输、继承保留原身份；笼中也会因缺乏照料而死亡。</p><div class="duty-list">${(s.livestockCargo??[]).filter(c=>c.status!=='released').slice(-40).map(c=>{const l=c.status==='dead'?c.deathLocation:crateLocation(w,c);return card(`${animalNames[c.kind]} · ${c.sex==='female'?'雌':'雄'} · ${c.status==='dead'?'已离世':'运输笼中'}`,`<p>${esc(c.id)} · ${Math.floor(((c.deathAt??w.minute)-c.bornAt)/DAY)}日龄<br>饥饿 ${Math.round(c.hunger)} · 口渴 ${Math.round(c.thirst)} · 健康 ${Math.round(c.health)}<br>${esc(l?.label??'原处保管')}</p>${l?.at?l.inside?place(l.inside):tile(l.at):''}`);}).join('')||'<p class="empty">没有未安置的活畜运输笼记录。</p>'}</div>
 <h3 class="section-label">畜舍与动物</h3><div class="duty-list">${s.animals.slice(-80).map(n=>card(`${animalNames[n.kind]} · ${n.sex==='female'?'雌':'雄'} · ${esc(n.id.split(':').at(-1))}`,`<p>${person(n.ownerId)} · ${n.status==='dead'?'已离世':Math.floor((w.minute-n.bornAt)/DAY)+'日龄'}<br>饥饿 ${Math.round(n.hunger)} · 口渴 ${Math.round(n.thirst)} · 健康 ${Math.round(n.health)}<br>待收产物 ${n.product} 份${n.pregnancy?' · 孕育中':''}${n.carrierId?' · 由'+name(n.carrierId)+'沿途护送':''}</p>${ecologyButton({kind:'animal',id:n.id})}`)).join('')||'<p class="empty">尚无居民购入和安置动物。</p>'}</div>
 <h3 class="section-label">温室</h3><div class="duty-list">${s.beds.filter(b=>b.crop).map(b=>card(`种植床 ${b.index+1}`,`<p>${person(b.crop!.ownerId)} · ${esc(w.definitions[b.crop!.definition]?.data.name??'作物')}<br>成长 ${b.crop!.growth.toFixed(1)} / ${Number(w.definitions[b.crop!.definition]?.data.growthDays??0)} 日</p>${place(b.buildingId)}`)).join('')||'<p class="empty">温室尚无在种作物。</p>'}</div>
 ${fishingEcologyPanel(w)}
 <h3 class="section-label">公共设备处置授权</h3><div class="duty-list">${(s.removals??[]).map(p=>card(`${stationNames[p.station]} · ${p.status==='active'?'授权中':p.status==='completed'?'已拆卸':'已到期'}`,`<p>${place(p.buildingId)} · 本次实际拆卸 ${p.worked.toFixed(1)}/${p.minutes.toFixed(1)} 分钟<br>实际支付 ${p.paid}/${p.wage} 钱；回收材料归公共库存，既有服务和他人权利须先处理。</p>`)).join('')||'<p class="empty">尚无居民表决通过的公共设备拆卸授权。</p>'}</div>
 <h3 class="section-label">工具与矿脉</h3><div class="duty-list">${s.tools.map(t=>card(`${itemLabels[toolKits[t.kind]]} · ${t.level}级`,`<p>${person(t.ownerId)} · 耐用 ${t.durability}/${t.maxDurability}${t.durability===0?' · 已损坏，须实际维修':''}${t.location?' · 封存在原址，尚未随身携带':''}</p>${t.location?.regional?`<p>镇外${esc(t.location.regional.origin)}原路，离谷口${t.location.regional.progress}/${t.location.regional.duration}分钟路程；尚无运回安排。</p>`:t.location?(t.location.inside?place(t.location.inside):tile(t.location.at)):''}`)).join('')}${s.mines.filter(m=>m.depth>0||Object.keys(m.exploredBy).length).map(m=>card(`第 ${m.depth+1} 层矿口`,`<p>本层余量 ${m.remaining[m.depth]} · 地下存量有限，开拓需要真实支护与工具。</p>${tile(m.at)}`)).join('')||'<p class="empty">尚未有工具与深入开采记录。</p>'}</div>
 <h3 class="section-label">食品保鲜</h3><p class="panel-intro">食品从实际入库时开始老化；交易、寄存和继承保留原来的保质时间。只有完成加工才产生新食品。</p><p>已腐败损耗：${stock(w.food?.spoiled??{})}</p>`;
}
