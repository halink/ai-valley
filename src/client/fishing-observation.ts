import {fishSpecies} from '../shared/fish-species.js';
import {fishNames,fishingDefaults} from '../shared/fishing-rules.js';
import type {FishPool} from '../shared/industry.js';
import type {World} from '../shared/types.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** Read the pool's existing binding without registering or repairing old definitions. */
function capacity(w:World,p:FishPool):number|null {
 const definition=w.definitions[p.definition??'ecology/fishing-process@1'];
 if(!definition||definition.id!=='ecology/fishing-process'||definition.kind!=='life')return null;
 const value=Object.hasOwn(definition.data,'capacity')?definition.data.capacity:fishingDefaults.capacity;
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:null;
}

/** Observation only: independent species progress is never summed into a refill promise. */
export function fishingEcologyPanel(w:World):string {
 const pools=Object.entries(w.industry?.fishing??{});
 const cards=pools.flatMap(([key,p])=>{
  const maximum=capacity(w,p),stocks=fishSpecies.flatMap(kind=>p.species?.[kind]?[{kind,stock:p.species[kind]!}]:[]);
  if(maximum!==null&&p.amount===maximum&&stocks.length&&!stocks.some(s=>s.stock.amount===0))return [];
  const habitat=p.habitat==='coast'?'海岸':p.habitat==='lake'?'湖泊':p.habitat==='river'?'河流':'未分类';
  const detail=stocks.length?stocks.map(({kind,stock})=>`${fishNames[kind]} ${esc(stock.amount)} 份 · ${stock.amount===0?'已耗尽，不能自行繁殖':`繁殖累计进度 ${Number.isFinite(stock.progress)?Math.floor(Math.max(0,Math.min(1,stock.progress))*100)+'%':'未知'}`}`).join('<br>'):'旧记录尚未分种，逐种数量和繁殖进度未知。';
  return [`<article class="duty-card"><h3>${habitat}水域 ${esc(key)}</h3><p>实际种群 ${esc(p.amount)}${maximum===null?' · 容量未知':'/'+maximum}</p>${p.amount===0?'<p>本水域已耗尽，不能自行繁殖；只能由符合条件的相连水域迁入，不保证恢复。</p>':''}<p>${detail}</p></article>`];
 });
 return `<h3 class="section-label">水域生态</h3><p class="panel-intro">有限鱼群按水域登记，各品种共享本水域容量。下列为未满、超量、分种耗尽或资料不全的水域；数量减少也可能来自捕食或迁出，不等于捕捞压力。繁殖进度按品种独立累计，仅在有存量、容量有余、适宜季节、真实水面且无当前洪流时增长。累计进度不保证下一次产鱼，观察者不能补鱼。</p><div class="duty-list">${cards.join('')||`<p class="empty">${pools.length?'当前已登记水域均达到各自容量，已登记品种尚有存量；不代表可持续捕捞。':'尚无已登记水域。'}</p>`}</div>`;
}
