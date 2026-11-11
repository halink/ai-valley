import type {Resident,World} from '../shared/types.js';
import {dateLabel} from './community.js';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const statuses={proposed:'待各方分别确认',accepted:'已确认，待实际集合',travelling:'沿实际道路同行',paused:'在实际位置暂停',arrived:'已到门口，待逐人登记',completed:'全部分别登记完成',cancelled:'已拒绝或撤回',expired:'原期限已到'};
export function familyRelocationProfile(w:World,r:Resident){
 const records=w.familyRelocation?.agreements.filter(c=>c.requiredSignerIds.includes(r.id)||c.members.some(m=>m.personId===r.id)).slice(-6).reverse()??[];
 if(!records.length)return '';
 const name=(id:string)=>esc(w.residents.find(p=>p.id===id)?.name??id);
 return `<h3 class="section-label">家庭迁居与逐人到达</h3>${records.map(c=>`<article class="duty-card"><p>${esc(w.buildings.find(b=>b.id===c.buildingId)?.name??c.buildingId)} · ${statuses[c.status]}${c.revocations?.length?' · 已有撤回记录，消息是否送达另记':''}<br>${dateLabel(c.createdAt)}提出 · 独立签署 ${c.signatures.length}/${c.requiredSignerIds.length}</p><small>${c.members.map(m=>`${name(m.personId)}：第${m.bed+1}床，${m.arrivedAt===null?'保留原住宿、尚未登记':dateLabel(m.arrivedAt)+'实际登记'}${m.caregiverId?'；'+name(m.caregiverId)+'负责护送、粮水及同住照护':''}`).join('<br>')}<br>每人约定${c.rationsPerPerson}份自有餐食及清水。${esc(c.reason??'收养与入住分别接受，产权、亲缘与个人财产不转移。')}</small></article>`).join('')}`;
}
