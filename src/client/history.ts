import {disasterEventDetails} from './disaster-history.js';
import {animalHistoryButton} from './animal-history.js';
import {waterEventDetails} from './water-history.js';
import {protectionEventDetails} from './resident-status.js';
import type {Biography,HistoryPage,HistoryQuery} from '../shared/history.js';import {eventKinds} from '../shared/history.js';import type {Resident,World,WorldEvent} from '../shared/types.js';import {calendar,knownAgeYears,YEAR} from '../world/time.js';import {dateLabel} from './community.js';
export class HistoryReader {
 private worldId='';private scope:HistoryQuery={};private filters:HistoryQuery={};private scopeKey='';
 private pages=new Map<number,HistoryPage>();private cursors:Array<string|undefined>=[undefined];
 private generation=0;private abort?:AbortController;private latestWorld?:World;private active=false;
 private headRevision?:number;private newestMatch=0;private retryHead=false;
 index=0;loading=false;error:string|null=null;news=false;
 // A successful explicit page change starts a new reading position; observer updates do not.
 positionRevision=0;
 constructor(private baseURL:string,private changed:()=>void,private fetcher:typeof fetch=fetch.bind(globalThis)){}
 get page(){return this.pages.get(this.index);}get query():HistoryQuery{return {...this.filters,...this.scope,limit:60};}get fixed(){return this.scope;}
 private clearReading(){this.index=0;this.cursors=[undefined];this.pages.clear();this.headRevision=undefined;this.newestMatch=0;this.news=false;this.error=null;this.retryHead=false;this.positionRevision++;}
 configure(worldId:string,scope:HistoryQuery={}):Promise<void>{
  const key=JSON.stringify([worldId,scope]);if(this.scopeKey===key)return Promise.resolve();
  if(this.latestWorld?.id!==worldId)this.latestWorld=undefined;
  this.scopeKey=key;this.worldId=worldId;this.scope={...scope};this.filters={};this.clearReading();return this.load(0,true);
 }
 setFilters(filters:HistoryQuery){this.filters={...filters};this.clearReading();return this.load(0,true);}
 private async load(index:number,replaceHead=false){
  this.abort?.abort();const token=++this.generation,controller=new AbortController();this.abort=controller;
  this.loading=true;this.error=null;this.retryHead=replaceHead;this.changed();
  const worldId=this.worldId,q=this.query,url=new URL('history/page',this.baseURL),keys:Record<string,string>={personId:'person',animalId:'animal',disasterId:'disaster',kind:'kind',conversationId:'conversation',q:'q',from:'from',to:'to',limit:'limit',populationOnly:'population',waterOnly:'water'};
  for(const [key,value]of Object.entries(q))if(value!==undefined&&key!=='cursor')url.searchParams.set(keys[key],(key==='populationOnly'||key==='waterOnly')?(value?'1':'0'):String(value));
  const cursor=replaceHead?undefined:this.cursors[index];if(cursor)url.searchParams.set('cursor',cursor);
  try{
   const response=await this.fetcher(url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('archive_http_'+response.status);
   const page=await response.json() as HistoryPage;if(token!==this.generation)return;
   if(page.worldId!==worldId||!Array.isArray(page.events))throw new Error('archive_world_changed');
   // Keep the entire old reading session until the replacement head has really arrived.
   if(replaceHead){this.pages.clear();this.cursors=[undefined];this.headRevision=page.observedRevision;this.news=false;}
   this.pages.set(index,page);if(page.nextCursor)this.cursors[index+1]=page.nextCursor;else this.cursors.length=index+1;
   this.index=index;this.positionRevision++;
   // Page zero has no bounded cursor. Evicting it would silently fetch a different head on Back.
   while(this.pages.size>5){const oldest=[...this.pages.keys()].find(i=>i!==0&&i!==this.index)!;this.pages.delete(oldest);}
  }catch(error){if(token!==this.generation||controller.signal.aborted)return;this.error='这一页记录暂时无法读取，可以重试或回到最新。';}
  finally{if(token===this.generation){this.loading=false;if(this.latestWorld)this.observe(this.latestWorld,this.active);this.changed();}}
 }
 older(){if(this.loading||!this.page?.nextCursor)return Promise.resolve();const next=this.index+1;this.index=next;if(this.pages.has(next)){this.error=null;this.positionRevision++;this.changed();return Promise.resolve();}return this.load(next);}
 newer(){if(this.loading||this.index===0)return Promise.resolve();this.index--;if(this.pages.has(this.index)){this.error=null;this.positionRevision++;this.changed();return Promise.resolve();}return this.load(this.index);}
 latest(){return this.load(0,true);}
 retry(){return this.load(this.retryHead?0:this.index,this.retryHead);}
 observe(world:World,active:boolean){
  this.latestWorld=world;this.active=active;
  if(this.worldId&&world.id!==this.worldId){
   this.abort?.abort();this.generation++;this.worldId='';this.scopeKey='';this.scope={};this.filters={};this.clearReading();this.loading=false;
   if(active)this.changed();return;
  }
  if(world.id!==this.worldId)return;
  const q=this.query,prefix=world.id+':event:';
  for(const event of world.events){
   if(!event.id.startsWith(prefix)||!matches(event,q))continue;
   const revision=Number(event.id.slice(prefix.length));if(Number.isSafeInteger(revision)&&revision>this.newestMatch)this.newestMatch=revision;
  }
  // Remember arrivals even during a request or while another panel is open. No fetching or clock changes.
  if(active&&this.headRevision!==undefined&&this.newestMatch>this.headRevision&&!this.news){this.news=true;this.changed();}
 }
 deactivate(){this.active=false;}
 destroy(){this.deactivate();this.abort?.abort();this.generation++;}
}
function matches(e:WorldEvent,q:HistoryQuery){return (!q.personId||e.actors.includes(q.personId))&&(!q.animalId||!!e.animalIds?.includes(q.animalId))&&(!q.disasterId||e.hazardFact?.disasterId===q.disasterId)&&(!q.kind||e.kind===q.kind)&&(!q.conversationId||e.conversationId===q.conversationId)&&(!q.q||e.text.toLowerCase().includes(q.q.toLowerCase()))&&(q.from===undefined||e.at>=q.from)&&(q.to===undefined||e.at<q.to)&&(!q.populationOnly||!!e.populationChange)&&(!q.waterOnly||e.waterSupply?.version===1);}
export class BiographyReader {
 private key='';private token=0;private abort?:AbortController;data:Biography|null=null;loading=false;error:string|null=null;
 constructor(private baseURL:string,private changed:()=>void,private fetcher:typeof fetch=fetch.bind(globalThis)){}
 configure(w:World,r:Resident,force=false){const key=w.id+JSON.stringify([w.events.filter(e=>e.actors.includes(r.id)).at(-1)?.id,r.id,r.status,r.residency,r.deathAt,r.homeId,r.parents,r.adoptiveParents,r.guardianIds,r.relations.filter(t=>t.partner).map(t=>[t.targetId,t.partner])]);if(this.key===key&&!force)return Promise.resolve();this.key=key;return this.load(w.id,r.id);}
 private async load(worldId:string,id:string){this.abort?.abort();const token=++this.token,controller=new AbortController();this.abort=controller;this.data=null;this.loading=true;this.error=null;this.changed();try{const response=await this.fetcher(new URL('people/'+encodeURIComponent(id)+'/biography',this.baseURL),{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('biography_unavailable');const data=await response.json() as Biography;if(token!==this.token)return;if(data.worldId!==worldId||data.person.id!==id)throw new Error('biography_world_changed');this.data=data;}catch(error){if(token!==this.token||controller.signal.aborted)return;this.error='这份生平暂时无法读取。';}finally{if(token===this.token){this.loading=false;this.changed();}}}
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const historyKindNames:Record<WorldEvent['kind'],string>={production:'生产',education:'学习传承',duty:'公共岗位',arrival:'到来',action:'生活记事',conversation:'交谈',relationship:'关系与理解',birth:'出生',death:'离世',burial:'安置与纪念',departure:'迁出',construction:'建设',trade:'钱物往来',system:'世界登记',care:'照护',hazard:'野外与灾情'};
function dateTime(at:number){const t=calendar(at);return `${dateLabel(at)} ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`;}
export function archiveControls(id:string,reader:HistoryReader,w:World){const query=reader.query,fixed=reader.fixed,currentYear=calendar(w.minute).year,year=query.from===undefined?'':String(Math.floor(query.from/YEAR)+1),years=[...new Set([...Array.from({length:Math.min(200,currentYear)},(_,i)=>currentYear-i),1,...(year?[Number(year)]:[])])].sort((a,b)=>b-a);
 return `<form class="archive-filters" data-history-filters="${esc(id)}">${fixed.q===undefined?`<label>原文搜索<input name="q" type="search" value="${esc(query.q??'')}" maxlength="100" placeholder="按记录原文查找"></label>`:''}${fixed.kind===undefined?`<label>记录类别<select name="kind"><option value="">全部类别</option>${eventKinds.map(k=>`<option value="${k}" ${query.kind===k?'selected':''}>${historyKindNames[k]}</option>`).join('')}</select></label>`:''}${fixed.personId===undefined&&fixed.q===undefined&&fixed.conversationId===undefined?`<label>相关人物<select name="person"><option value="">所有人物</option>${w.residents.map(p=>`<option value="${esc(p.id)}" ${query.personId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}<label>年份<select name="year"><option value="">全部年份</option>${years.map(y=>`<option value="${y}" ${year===String(y)?'selected':''}>第${y}年</option>`).join('')}</select></label>${fixed.personId?`<label class="archive-check"><input type="checkbox" name="population" ${query.populationOnly?'checked':''}>只看人口与亲缘变更</label>`:''}${fixed.waterOnly===undefined&&fixed.animalId===undefined&&fixed.disasterId===undefined?`<label class="archive-check"><input type="checkbox" name="water" ${query.waterOnly?'checked':''}>只看有实物快照的供水记录</label>`:''}<button type="submit">查阅</button></form>${query.waterOnly?'<p class="panel-intro">仅筛选接通后留有完成快照的供水行动。早期文字记录仍可取消筛选后按原文查找，不补造缺失的水量与来源。</p>':''}<div class="archive-pages"><button data-history="${esc(id)}" data-history-action="newer" ${reader.index===0||reader.loading?'disabled':''}>较新一页</button><span>第${reader.index+1}页${reader.loading?' · 正在读取':''}</span><button data-history="${esc(id)}" data-history-action="older" ${!reader.page?.hasMore||reader.loading?'disabled':''}>更早一页</button><button data-history="${esc(id)}" data-history-action="latest" ${reader.loading?'disabled':''}>${reader.news?'有新记录 · ':''}回到最新</button></div>${reader.error?`<p class="empty">${esc(reader.error)} <button data-history="${esc(id)}" data-history-action="retry">重试这一页</button></p>`:''}${!reader.page&&reader.loading?'<p class="empty">正在从年表读取这一页记录…</p>':''}`;
}
export function archiveTimeline(events:WorldEvent[],w:World){return events.length?`<div class="timeline">${events.map(e=>`<article class="timeline-event kind-${e.kind}" data-history-event="${esc(e.id)}"><span class="timeline-dot"></span><small>${dateTime(e.at)} · ${e.interpretation?'人物自己的理解':e.observerOnly?'已发生事实的年表记载':historyKindNames[e.kind]}</small><p>${esc(e.text)}</p>${protectionEventDetails(e)}${waterEventDetails(e)}${disasterEventDetails(e)}${e.actors.length?`<div class="event-people">${[...new Set(e.actors)].map(id=>{const r=w.residents.find(p=>p.id===id),name=r?.name??w.foreignTrade?.merchants.find(m=>m.id===id)?.person.name??'相关人物';return r?`<button data-biography="${esc(id)}">${esc(name)}</button>`:`<span>${esc(name)}</span>`;}).join('')}</div>`:''}${e.animalIds?.length?`<div class="event-people">${[...new Set(e.animalIds)].map(id=>animalHistoryButton(id)).join('')}</div>`:''}${e.conversationId?`<button class="archive-thread" data-thread="${esc(e.conversationId)}">连续阅读这一场交谈</button>`:''}</article>`).join('')}</div>`:'<p class="empty">这一页没有符合条件的留存记录。</p>';}
export function biographyOverview(data:Biography|null,w:World,loading:boolean,error:string|null){if(!data)return `<p class="empty">${loading?'正在查阅留存的人物资料…':esc(error??'暂无这份人物资料。')}</p>`;const p=data.person,person=(id:string)=>`<button data-biography="${esc(id)}">${esc(w.residents.find(p=>p.id===id)?.name??'登记家人')}</button>`,rows=(name:string,ids:string[])=>ids.length?`<div><span>${name}</span><b>${ids.map(person).join('、')}</b></div>`:'';return `<div class="profile-head"><div><h3>${esc(p.name)}的生平</h3><p>${p.status==='dead'?'已故':p.residency==='outside'?'镇外生活':p.residency==='visitor'?'在镇访客':'山谷居民'} · 身份持续保留</p></div></div><button data-person="${esc(p.id)}">看看现在的人物档案</button><div class="profile-facts"><div><span>登记出生</span><b>${knownAgeYears(p.bornAt,p.deathAt??w.minute)===null?'登记出生未知（年龄未知）':p.bornAt<0?'开局前约'+Math.ceil(-p.bornAt/YEAR)+'年（登记资料）':dateTime(p.bornAt)}</b></div>${p.deathAt===null?'':`<div><span>离世记录</span><b>${dateTime(p.deathAt)} · ${p.deathCause==='oldAge'?'自然衰老':p.deathCause==='accident'?esc(p.deathDetail??'意外'):'健康原因'}</b></div>`}${rows('出生父母',p.parents)}${rows('养亲',p.adoptiveParents)}${rows('监护关系',p.guardianIds)}<div><span>年表中的相关记录</span><b>${data.recordCount}条</b></div>${data.firstRecordAt===null?'':`<div><span>最早留存记录</span><b>${dateTime(data.firstRecordAt)}</b></div>`}</div><h3 class="section-label">交往、成家与分开</h3>${data.partners.map(t=>`<article class="duty-card"><p>${person(t.personId)} · ${t.kind==='married'?'登记过婚姻':t.kind==='dating'?'登记过交往':'早期伴侣类型未在年表登记'}${t.endReason==='death'?' · 因一方离世而结束':t.endedAt===null?' · 尚无已登记的分开记录':' · 已分开'}<br>${t.startedAt===null?'交往开始日期未收录':'确认交往 '+dateTime(t.startedAt)}${t.marriedAt!==undefined&&t.marriedAt!==null?'<br>确认婚姻 '+dateTime(t.marriedAt):''}${t.endedAt===null?'':`<br>${t.endReason==='death'?'离世结束':'分开'} `+dateTime(t.endedAt)}</p></article>`).join('')||'<p class="empty">没有已登记的交往或婚姻记录。</p>'}<h3 class="section-label">留存年表</h3><p class="panel-intro">从实际记录查阅这个人的经历；开局以前的资料与后来发生的记录分别保留。文字提及按原文检索姓名，不推断谁在现场。</p>`;}
