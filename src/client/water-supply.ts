import {waterSupportPanel} from './water-support.js';
import type {World} from '../shared/types.js';
const esc=(text:unknown)=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function waterSupplyPanel(w:World){
 const s=w.waterSupply;if(!s)return '';
 const name=(id:string)=>esc(w.residents.find(r=>r.id===id)?.name??'原持有人');
 return `<h3 class="section-label">安全水供给 · 第一阶段</h3><p class="panel-intro">尚未启用居民口渴、脱水或饮水健康加成。木桶容量6份；河岸原水须到有权使用的厨房煮沸。旧清水库存及原用途保留。公共饮水仅来自本人实际捐赠，每人滚动24小时最多2份。</p><div class="duty-list">${s.vessels.map(v=>`<article class="duty-card"><b>${v.buildingId?esc(w.buildings.find(b=>b.id===v.buildingId)?.name??'原共屋')+'桌台公共水桶':name(v.ownerId)+'的随身水桶'}</b><p>${v.quality==='safe'?'安全水':'未净化原水，不能饮用'} ${v.amount} / ${v.capacity}份${v.donatedBy?'<br>实际捐赠人：'+name(v.donatedBy):''}</p>${v.buildingId&&w.buildings.find(b=>b.id===v.buildingId)?`<button data-tile="${w.buildings.find(b=>b.id===v.buildingId)!.door.x},${w.buildings.find(b=>b.id===v.buildingId)!.door.y}">查看储水地点</button>`:''}</article>`).join('')||'<p class="empty">尚无人制作或捐赠水桶，没有自动配发或补水。</p>'}${s.surfaceSources.map(p=>`<article class="duty-card"><b>已踏查淡水岸</b><p>有限原水 ${p.amount} / ${p.initial}份；登记不等于取水，无自动恢复。</p><button data-tile="${p.at.x},${p.at.y}">查看取水岸边</button></article>`).join('')}</div><p class="panel-intro">已记录${s.receipts.filter(p=>!!p.recipientId).reduce((n,p)=>n+p.quantity,0)}份实际饮用；全部供水回执${s.receipts.length}条。已离世或离谷者的桶仍保留原归属，不自动划给公共库存。</p>${waterSupportPanel(w)}`;
}
