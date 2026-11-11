import {prototypePanelDetails} from './prototypes.js';
import type {World} from '../shared/types.js';
import {itemLabels} from '../shared/items.js';
import {dateLabel} from './community.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const toolNames={axe:'斧具',pick:'镐具',rod:'钓具',spear:'猎矛'};
const buildingNames={home:'住宅',lodge:'公共旅舍',workshop:'工坊',clinic:'诊所',school:'学校',barn:'畜舍',greenhouse:'温室',store:'商铺'};
const stock=(materials:object)=>Object.entries(materials).filter(([,amount])=>amount>0).map(([key,amount])=>`${amount} 份${itemLabels[key as keyof typeof itemLabels]??esc(key)}`).join('、');

export function designsPanel(w:World):string {
 const records=w.designs?.records??[];
 return `<p class="panel-intro">图纸由居民自己起草。图纸公开、工具制成和建筑完工都有各自的记录。</p>
 <button data-panel="ecology">回到生计脉络</button> <button data-panel="construction">查看实际工地</button>
 <h3 class="section-label">居民留下的图纸 · ${records.length}</h3>
 <div class="duty-list">${[...records].reverse().slice(0,40).map(design=>{
  const author=w.residents.find(resident=>resident.id===design.authorId),spec=design.spec;
  const tools=spec.kind==='tool'?w.industry?.tools.filter(tool=>tool.designId===design.id)??[]:[];
  const buildings=spec.kind==='building'?w.buildings.filter(building=>building.definition===spec.definition):[];
  const projects=spec.kind==='building'?w.construction?.projects.filter(project=>project.definition===spec.definition&&['proposed','planned','active','paused'].includes(project.status))??[]:[];
  const place=design.publication&&w.buildings.find(building=>building.id===design.publication!.buildingId);
  return `<article class="duty-card design-card"><small>${dateLabel(design.createdAt)} · ${spec.kind==='prototype'?'组合原型图纸':spec.kind==='tool'?'器物图纸':'建筑图纸'}</small>
   <h3>${esc(design.name)}</h3><p>${esc(design.purpose)}</p>
   <p>${spec.kind==='prototype'?`便携晾鱼原型 · 承重 ${spec.capacity} 份 · 计划投入 ${spec.batchSize} 份鲜鱼`:spec.kind==='tool'?`${toolNames[spec.tool]} · 预计耐用 ${spec.durability} · 等级 ${spec.level}`:`${buildingNames[spec.template]} · ${spec.width} × ${spec.height} 格 · 容量 ${spec.capacity}`}</p>
   <p>材料 ${stock(spec.materials)} · 劳动约 ${spec.minutes} 游戏分钟</p>
   <p>${design.publication?`已公开 · ${design.learnedBy.length} 位居民已登记学习`:'私人图纸'} · ${spec.kind==='prototype'?`已试作 ${w.designs?.prototypes?.filter(p=>p.designId===design.id).length??0} 件`:spec.kind==='tool'?`已制成 ${tools.length} 件`:`已有 ${projects.length} 项待议或在建，${buildings.length} 座已建成`}</p>
   ${spec.kind==='prototype'?prototypePanelDetails(w,design):''}
   <div class="place-actions">${author?`<button data-person="${esc(author.id)}">${esc(author.name)}的档案</button>`:''}
   ${place?`<button data-locate="${esc(place.id)}">图纸公开地点</button>`:''}
   ${projects.slice(0,4).map(project=>`<button data-project="${esc(project.id)}">定位工地</button>`).join('')}
   ${buildings.slice(0,4).map(building=>`<button data-locate="${esc(building.id)}">定位${esc(building.name)}</button>`).join('')}</div>
  </article>`;
 }).join('')||'<p class="empty">居民还没有完成图纸。</p>'}</div>`;
}
