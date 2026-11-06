import {animalActivities,type AnimalActivity} from '../shared/animal-behavior.js';
import {beastNames} from '../shared/frontier-hazards.js';
import type {Livestock} from '../shared/industry.js';
import {roomLayout} from '../shared/rooms.js';
import type {Building,Vec,World} from '../shared/types.js';
import {fishSchoolView,type FishSchoolView} from '../world/fishing.js';
import {animalNames} from '../world/livestock-life.js';
import {DAY} from '../world/time.js';
import {dateLabel} from './community.js';

export type EcologySelection={kind:'animal'|'beast'|'fish';id:string};
export const ecologyKey=(selection:EcologySelection)=>selection.kind+'/'+selection.id;
export function parseEcologyKey(value:string):EcologySelection|null {
 const sep=value.indexOf('/'),kind=value.slice(0,sep),id=value.slice(sep+1);
 return sep>0&&id&&(kind==='animal'||kind==='beast'||kind==='fish')?{kind,id}:null;
}
export function resolveEcologySelection(w:World,selection:EcologySelection):EcologySelection{
 return selection.kind==='beast'&&!w.frontierHazards?.beasts.some(n=>n.id===selection.id)&&
  w.industry?.animals.some(n=>n.id===selection.id)?{kind:'animal',id:selection.id}:selection;
}

export const habitatLabels={lake:'湖泊',river:'河流',coast:'海岸'} as const;
export const shoalActivities={feeding:'在水中觅食',resting:'在水中休息',evadingFlood:'躲避洪流'} as const;
const wildDeath={hunted:'被狩猎',starvation:'饥饿',oldAge:'衰老',thirst:'脱水',predation:'遭捕食'} as const;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function ecologyButton(selection:EcologySelection,label='查看状态'){
 return `<button data-animal-detail="${esc(ecologyKey(selection))}">${esc(label)}</button>`;
}

export interface AnimalLocation {at:Vec;roomId:string|null;roomPoint?:Vec;}
export function barnAnimalPoint(w:World,b:Building,n:Livestock):Vec|null {
 if(n.at){
  return n.inside===b.id&&n.roomAt?{x:n.roomAt.x*16+8,y:n.roomAt.y*16+16}:null;
 }
 if(n.barnId!==b.id)return null;
 const pen=roomLayout(w,b).slots.find(slot=>slot.key==='pen:'+(n.pen??0));
 return pen?{x:pen.at.x*16+8,y:pen.at.y*16}:null;
}

export function ecologyLocation(w:World,selection:EcologySelection):AnimalLocation|null {
 selection=resolveEcologySelection(w,selection);
 if(selection.kind==='fish'){const school=fishSchoolView(w,selection.id);return school?{at:school.at,roomId:null}:null;}
 if(selection.kind==='beast'){const beast=w.frontierHazards?.beasts.find(b=>b.id===selection.id);return beast?{at:beast.at,roomId:null}:null;}
 const animal=w.industry?.animals.find(n=>n.id===selection.id);
 if(!animal)return null;
 const roomId=animal.at?animal.inside??null:animal.barnId;
 const room=roomId&&w.buildings.find(b=>b.id===roomId);
 const at=animal.at??(room?room.door:null);
 if(!at)return null;
 return {at,roomId:room?room.id:null,roomPoint:room?barnAnimalPoint(w,room,animal)??undefined:undefined};
}

function activityText(activity:AnimalActivity|undefined,fallback:string){
 return activity?animalActivities[activity.kind]:fallback;
}

export function ecologySummary(w:World,selection:EcologySelection):{name:string;subtitle:string;state:string}|null {
 selection=resolveEcologySelection(w,selection);
 if(selection.kind==='fish'){
  const s=fishSchoolView(w,selection.id);
  return s?{name:s.species?`${s.species}鱼群`:`${habitatLabels[s.habitat]}鱼群`,subtitle:`野生鱼群 · ${s.amount}/${s.capacity} 份`,
   state:s.amount?shoalActivities[s.activity]:'水域暂无鱼群，等待自然恢复'}:null;
 }
 if(selection.kind==='beast'){
  const b=w.frontierHazards?.beasts.find(n=>n.id===selection.id);
  return b?{name:beastNames[b.species],subtitle:`野生个体 · ${b.status==='alive'?'存活':'已死亡'}`,
   state:b.status==='dead'?(b.deathCause?wildDeath[b.deathCause]:'已死亡'):activityText(b.activity,b.alert?'警戒':'在领地活动')}:null;
 }
 const n=w.industry?.animals.find(n=>n.id===selection.id);
 return n?{name:animalNames[n.kind],subtitle:`家畜 · ${n.sex==='female'?'雌':'雄'} · ${n.status==='alive'?'存活':'已死亡'}`,
  state:n.status==='dead'?(n.deathDetail??'已死亡'):activityText(n.activity,n.carrierId?'被护送':n.pastureId?'在牧场':!n.at||n.inside?'在畜舍':'在户外')}:null;
}

function need(label:string,value:number|undefined,color:string){
 if(value===undefined)return '';
 const n=Math.max(0,Math.min(100,Math.round(value)));
 return `<div class="animal-need"><span>${label}</span><span class="animal-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}"><i style="width:${n}%;background:${color}"></i></span><b>${n}</b></div>`;
}

function facts(entries:Array<[string,string]>){
 return `<dl class="animal-facts">${entries.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
}

function fishDetails(s:FishSchoolView){
 return facts([['水域',habitatLabels[s.habitat]],['鱼群储量',`${s.amount} / ${s.capacity} 份`],['可见鱼种',s.species??'当前无活跃鱼种'],
  ['活动时间',s.hours],['恢复进度',s.amount>=s.capacity?'已达容量':`下一份 ${Math.round(Math.max(0,s.recovery)*100)}%`]]);
}

export function animalInspector(w:World,selection:EcologySelection):string {
 selection=resolveEcologySelection(w,selection);
 const summary=ecologySummary(w,selection);
 if(!summary)return '<p class="empty">此个体当前没有可观察的记录。</p>';
 const {name,subtitle,state}=summary,location=ecologyLocation(w,selection);
 const room=location?.roomId?w.buildings.find(b=>b.id===location.roomId):undefined;
 const place=room?room.name:location?`地图 ${location.at.x}, ${location.at.y}`:'位置无记录';
 const header=`<div class="profile-head"><div><h3>${esc(name)}</h3><p>${esc(subtitle)} · ${esc(place)}</p></div></div>`;
 const map=location?`<button class="primary-light" data-animal-map="${esc(ecologyKey(selection))}">在地图上定位</button>`:'';
 const status=(reason?:string)=>`<div class="intention"><small>当前行为</small><p>${esc(state)}</p>${reason?`<span>${esc(reason)}</span>`:''}</div>`;
 let body:string;
 if(selection.kind==='fish'){
  const school=fishSchoolView(w,selection.id)!;
  body=status(!school.amount?'这片水域仍保留恢复进度。':school.activity==='evadingFlood'?'附近洪水改变鱼群的移动方向。':school.activity==='resting'?'当前时段、水域或天气使鱼群活动减少。':'鱼群随光照、天气与河岸水形移动，捕捞与捕食会消耗此处的储量。')+fishDetails(school);
 }else{
  const wild=selection.kind==='beast'?w.frontierHazards?.beasts.find(n=>n.id===selection.id):undefined;
  const domestic=selection.kind==='animal'?w.industry?.animals.find(n=>n.id===selection.id):undefined;
  const n=wild??domestic!;
  const entries:Array<[string,string]>=[['年龄',`${Math.max(0,Math.floor(((n.deathAt??w.minute)-n.bornAt)/DAY))} 天`]];
  if(domestic){
   entries.push(['照料人',w.residents.find(r=>r.id===domestic.ownerId)?.name??'暂无登记']);
   if(n.status==='alive')entries.push(['待收产物',`${domestic.product} 份`],['繁育',domestic.pregnancy?`孕育中 · 预计${dateLabel(domestic.pregnancy.dueAt)}`:'暂无孕育记录']);
  }else if(wild?.sex)entries.push(['性别',wild.sex==='female'?'雌':'雄']);
  if(n.deathAt!==undefined&&n.deathAt!==null)entries.push(['死亡记录',dateLabel(n.deathAt)]);
  const target=n.activity?.target;
  if(n.status==='alive'&&target)entries.push(['目标位置',`${target.x}, ${target.y}`]);
  body=status(n.status==='alive'?n.activity?.reason:undefined)+`<h3 class="section-label">身体状态</h3><div class="animal-needs">${need('健康',n.health,'var(--leaf)')}${need('饥饿',n.hunger,'var(--bevel)')}${need('口渴',n.thirst,'var(--pond)')}${need('体力',n.energy,'var(--gold)')}</div>`+facts(entries);
 }
 const id=selection.kind==='fish'?'shoal:'+selection.id:selection.id;
 const records=w.events.filter(e=>e.animalIds?.includes(id)).slice(-8).reverse();
 return header+map+body+`<h3 class="section-label">近期记录</h3><div class="memory-list">${records.map(e=>`<article><small>${dateLabel(e.at)}</small><p>${esc(e.text)}</p></article>`).join('')||'<p class="empty">此处还没有近期事件记录。</p>'}</div>`;
}
