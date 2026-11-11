import {beastNames} from '../shared/frontier-hazards.js';
import type {World} from '../shared/types.js';
import {animalNames} from '../world/livestock-life.js';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Fish are recorded by water-area identity, not by individual fish or inferred species. */
export function animalHistoryId(selection:{kind:'animal'|'beast'|'fish';id:string}){
 return selection.kind==='fish'?'shoal:'+selection.id:selection.id;
}
export function animalHistoryButton(id:string,label?:string){
 return `<button data-animal-history="${esc(id)}">${esc(label??(id.startsWith('shoal:')?'水域鱼群记录 · '+id.slice(6):'动物记录 · '+id))}</button>`;
}
export function animalHistoryOverview(w:World,id:string){
 const domestic=w.industry?.animals.find(n=>n.id===id),wild=w.frontierHazards?.beasts.find(n=>n.id===id);
 const fish=id.startsWith('shoal:')?id.slice(6):undefined;
 const key=domestic?'animal/'+id:wild?'beast/'+id:fish&&w.industry?.fishing[fish]?'fish/'+fish:undefined;
 const current=domestic?`当前登记为家畜${animalNames[domestic.kind]}`:wild?`当前登记为${beastNames[wild.species]}`:fish?'按水域留存的鱼群记录':'当前没有个体状态记录，不推断去向或死亡';
 return `<div class="profile-head"><div><h3>${fish?'水域鱼群':'动物'}留存年表</h3><p>${esc(current)}</p></div></div><p class="panel-intro">记录身份：${esc(id)}</p>${key?`<button data-animal-detail="${esc(key)}">查看当前状态</button>`:''}<button data-panel="chronicle">返回山谷年表</button><p class="panel-intro">仅按事件中明确登记的动物身份关联，驯化前后沿用原身份。原文提及不自动算作相关记录；旧记录缺失的经历、亲代、归属和去向不补推断。人物的解释仍标为本人理解，年表记录不等于所有居民已知。</p>${fish?'<p class="panel-intro">这是同一水域的鱼群记录，不是某一条鱼的生平；不从水域总量或今日鱼种推断旧记录的品种、出生或迁移。</p>':''}`;
}
