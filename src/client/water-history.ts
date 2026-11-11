import type {WorldEvent} from '../shared/types.js';
import type {WaterVesselSnapshot} from '../shared/water-history.js';
import {waterOperationNames} from '../shared/water-history.js';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function vessel(v:WaterVesselSnapshot|null){return v?`${esc(v.amount)} / ${esc(v.capacity)}份${v.quality==='raw'?'原水':'安全水'}；持有人 ${esc(v.ownerId)}；${v.buildingId?'存放场所 '+esc(v.buildingId):'随身携带'}`:'未有此桶';}
export function waterEventDetails(e:WorldEvent){
 const f=e.waterSupply;if(f?.version!==1)return '';
 const outcome=f.recipientId?`实际饮用 ${esc(f.quantity)}份，饮用人 ${esc(f.recipientId)}`:f.operation==='boil'?`净化 ${esc(f.quantity)}份，未增加水量`:['fillSpring','fillSurface','load','decant','donate','refillPublic','acceptVessel'].includes(f.operation)?`实际转移 ${esc(f.quantity)}份水，不计饮用`:f.operation==='craft'?'实际制作1只空桶，未生成水、不计饮用':f.operation==='survey'?'仅登记有限原水点，未抽取、未净化、不计饮用':'仅记录本人提议、授权或停止意愿，未转移水或桶、不计饮用';
 return `<details class="water-history" data-water-event="${esc(e.id)}"><summary>这次供水的实物记录 · ${esc(waterOperationNames[f.operation])}</summary><p>${outcome}<br>完成回执：${esc(f.receiptId)}</p>${f.vessels.map(v=>`<p>水桶 ${esc(v.id)}<br>完成前：${vessel(v.before)}<br>完成后：${vessel(v.after)}</p>`).join('')}${f.source?`<p>${f.source.kind==='spring'?'同一泉水库存':'有限原水登记'} ${esc(f.source.id)}：${f.source.before===null?'此前未登记':esc(f.source.before)+'份'} → ${f.source.after===null?'未登记':esc(f.source.after)+'份'}${f.operation==='survey'?'；登记不等于抽取或生成水':''}</p>`:''}${f.inventory.map(v=>`<p>本人${v.item==='water'?'旧清水':'木材'}库存：${esc(v.before)} → ${esc(v.after)}份</p>`).join('')}${f.authorizationId?`<p>原授权记录：${esc(f.authorizationId)}</p>`:''}${f.giftId?`<p>原赠桶提议：${esc(f.giftId)}</p>`:''}<p class="footnote">仅记录本次完成前后，不推断整桶水的最初来源或完整供水保障。尚未启用口渴、脱水或饮水健康加成。</p></details>`;
}

/** Preserve the reader's expansion choices through observer-driven panel replacement. */
export function rememberWaterDetails(root:ParentNode){
 const opened=new Set([...root.querySelectorAll<HTMLDetailsElement>('details[data-water-event]')].filter(d=>d.open).map(d=>d.dataset.waterEvent));
 return ()=>{for(const details of root.querySelectorAll<HTMLDetailsElement>('details[data-water-event]'))details.open=opened.has(details.dataset.waterEvent);};
}
