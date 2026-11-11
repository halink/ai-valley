import {disasterHistoryOverview} from './disaster-history.js';
import {captureArchivePosition} from './archive-position.js';
import {PanelPositions} from './panel-positions.js';
import {culturePanel,wordsTabs} from './culture.js';
import {meetingsSummary,interpretationsProfile} from './social-life.js';
import {LazyModule} from './lazy-module.js';
import {residentFollowText} from './resident-follow.js';
import {animalHistoryOverview} from './animal-history.js';
import {rememberWaterDetails} from './water-history.js';
import {residentActivity,residentStatusProfile,protectionSummary,worldClockStatus} from './resident-status.js';
import {HistoryReader,BiographyReader,archiveControls,archiveTimeline,biographyOverview} from './history.js';
import type {HistoryQuery} from '../shared/history.js';
import {estateProfile} from './estate-custody.js';
import {animalInspector,ecologyButton,ecologySummary,parseEcologyKey,type EcologySelection} from './animal-observation.js';
import {itemLabels} from '../shared/items.js';
import Phaser from 'phaser';
import type {Building, Resident, Snapshot, WorldEvent, Vec} from '../shared/types.js';
import {calendar,daylight,daylightLabels,knownAgeYears,YEAR} from '../world/time.js';
import {ValleyScene} from './scene.js';
import {ObserverNavigation} from './observer-navigation.js';
import './styles.css';
import './isometric-observer.css';
import {mountIsometricObserver} from './isometric-observer.js';
import {createObserverMap,type ObserverSelection} from './observer-map.js';
import {FORMAL_REGIONS} from '../shared/formal-regions.js';
import {applyObserverUpdate} from '../shared/observer.js';
import {Atlas,currentRegion} from './atlas.js';
import {censusPanel,dutiesPanel,familyPanel,chapterLinks} from './community.js';
import {constructionPanel,projectSummary} from './construction.js';
import {palette,residentColors} from './palette.js';
const favicon=document.createElement('link');favicon.rel='icon';favicon.href='/ai-town/favicon.svg';document.head.append(favicon);

const icons:Record<string,string>={moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',leaf:'<path d="M19 4C10 3 4 7 5 14c7 3 13-1 14-10Z"/><path d="m5 20 9-11M8 14l-1-4m5 0 4 1"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5"/>',chat:'<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/>',network:'<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10 8-4 7m8-7 4 7M8 18h8"/>',book:'<path d="M12 6C8 3 5 4 2 5v14c4-1 7 0 10 2m0-15c4-3 7-2 10-1v14c-4-1-7 0-10 2V6Z"/>',house:'<path d="m2 11 10-8 10 8M5 9v12h14V9M10 21v-7h4v7"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',rain:'<path d="M5 14a4 4 0 0 1-1-8 6 6 0 0 1 12-1 4 4 0 0 1 3 9H5M7 17l-1 3m6-3-1 3m6-3-1 3"/>',focus:'<circle cx="12" cy="12" r="5"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>'};
icons.atlas='<path d="m2 5 6-2 8 3 6-2v15l-6 2-8-3-6 2V5Z"/><path d="M8 3v15m8-12v15"/>';
const icon=(name:string)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]??icons.leaf}</svg>`;
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]!));
function ageLabel(bornAt:unknown,minute:unknown){const age=knownAgeYears(bornAt,minute);return age===null?'年龄未知':`${Math.floor(age)} 岁`;}
const names={spring:'春',summer:'夏',autumn:'秋',winter:'冬'};
const items:Record<string,string>=itemLabels;
const kinds:Record<string,string>={home:'住宅',lodge:'公共旅舍',workshop:'工坊',clinic:'诊所',school:'学校',barn:'畜舍',greenhouse:'温室',store:'商铺'};
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
 <div id="canvas" aria-label="山谷地图，可拖动和缩放"></div>
 <header class="topbar">
  <button class="brand" data-action="home" aria-label="回到山谷中央"><span class="brand-mark">${icon('leaf')}</span><span><b>栖谷</b><small>A LIVING VALLEY</small></span></button>
  <div class="calendar" id="calendar"><span class="season-symbol">✿</span><span><b>春 · 第 1 日</b><small>第一年，清晨</small></span><i>${icon('sun')}</i></div>
  <button class="sample-badge" data-panel="about"><span></span><b id="world-edition">山谷</b>${icon('info')}</button>
 </header>
 <div class="observer-hud" id="observer-hud">
  <div class="world-state" id="world-state" role="status"><span class="status-dot"></span><span>正在连接山谷…</span></div>
  <div class="room-banner hidden" id="room-banner"></div>
 </div>
 <div class="opening" id="opening"><span class="opening-leaf">${icon('leaf')}</span><h1>生活正在发生</h1><p>等一会儿，让山谷醒来。</p></div>
 <aside id="selection" class="selection hidden" aria-label="选中对象"></aside>
 <div class="map-controls" aria-label="镜头控制"><button data-action="home" title="回到村落" aria-label="回到村落">${icon('focus')}</button><button class="hidden" id="atlas-shortcut" data-panel="atlas" aria-label="查看全图" title="山谷全图">${icon('atlas')}</button><span></span><button data-action="zoomout" aria-label="缩小地图">${icon('minus')}</button><button data-action="zoomin" aria-label="放大地图">${icon('plus')}</button></div>
 <p class="map-hint">拖动漫游 · 滚轮缩放 · 点击地图对象查看状态</p>
 <nav class="dock" aria-label="观察入口">
  ${[['people','people','居民'],['relations','network','关系'],['conversations','chat','交谈'],['places','house','场所'],['wild','leaf','野外'],['chronicle','book','年表']].map(([p,i,n])=>`<button data-panel="${p}" aria-label="查看${n}"${p==='wild'?' id="wild-shortcut" class="hidden"':''}>${icon(i)}<span>${n}</span></button>`).join('')}
 </nav>
 <div class="observer-note"><span></span>居民自主决定，你只需观看</div>
 <section class="panel hidden" id="panel" aria-modal="false" aria-labelledby="panel-title"><div class="panel-header"><div><span class="eyebrow" id="panel-kicker"></span><h2 id="panel-title"></h2></div><button class="icon-button" data-action="closepanel" aria-label="关闭面板">${icon('close')}</button></div><div id="panel-tools" class="panel-tools hidden"></div><div class="panel-body" id="panel-body"></div></section>
`;
const navigation=new ObserverNavigation();
const scene=new ValleyScene(navigation);
// Only the separately injected development entry imports this existing renderer.
export {scene as observerScene};
const atlas=new Atlas();
new Phaser.Game({type:Phaser.AUTO,parent:'canvas',backgroundColor:palette.spring.grass,pixelArt:true,roundPixels:true,antialias:false,scale:{mode:Phaser.Scale.RESIZE,width:window.innerWidth,height:window.innerHeight},scene:[scene],render:{powerPreference:'low-power'},audio:{noAudio:true}});
let snapshot:Snapshot|null=null,activePanel:string|null=null,selection:ObserverSelection=null,connected=false;
// Both views consume this one client feed. The optional view starts inactive.
const mapListeners=new Set<(snapshot:Snapshot|null,connected:boolean)=>void>();
export const observerMap=createObserverMap({
 currentSnapshot(){return snapshot;},
 subscribe(listener){mapListeners.add(listener);try{listener(snapshot,connected);}catch(error){mapListeners.delete(listener);throw error;}return ()=>{mapListeners.delete(listener);};},
},navigation,{
 currentTile(){return scene.cameraTile();},
 stopFollowing(){scene.stopFollowing();},
 setFollowResolver(resolver){scene.setObserverFollowResolver(resolver);},
 frame(at){scene.watchTile(at);},
 cover(covered){scene.resetWorkFeedback();if(scene.game){if(covered)scene.game.loop.sleep();else scene.game.loop.wake();}},
},{
 select(value){selection=value;renderSelection();},
 isFullMapTarget(target){return target===atlas.canvas;},
});
const conversationOpen=new Map<string,boolean>();
const dutyOpen=new Map<string,boolean>();
let archiveRenderQueued=false,threadId='',disasterArchiveId='',animalArchiveId='',biographyScope:'related'|'mentions'='related';
const archiveChanged=()=>{if(archiveRenderQueued)return;archiveRenderQueued=true;queueMicrotask(()=>{archiveRenderQueued=false;if(activePanel)renderPanel(true);});};
const apiURL=new URL('/ai-town/api/',window.location.origin);
const archives={disasterHistory:new HistoryReader(apiURL.href,archiveChanged),animalHistory:new HistoryReader(apiURL.href,archiveChanged),chronicle:new HistoryReader(apiURL.href,archiveChanged),conversations:new HistoryReader(apiURL.href,archiveChanged),thread:new HistoryReader(apiURL.href,archiveChanged),biography:new HistoryReader(apiURL.href,archiveChanged)};
const biographies=new BiographyReader(apiURL.href,archiveChanged);
const panelPositions=new PanelPositions();
function observeArchives(){if(!snapshot)return;for(const [name,reader] of Object.entries(archives))reader.observe(snapshot.world,activePanel===name);}

let searchName='', peopleScope='local', relationId='', relationPage=0, activeTools='';
// Keep the map, connection state, basic lists and archive error handling independent of this chunk.
const optionalPanels=new Set(['food','market','household','debt','finance','employment','infrastructure','cemetery','longCare','support','health','industry','ecology','designs','education','foreign','wild','person']);
const panelRenderers=new LazyModule(()=>import('./panel-renderers.js'),()=>{if(activePanel&&optionalPanels.has(activePanel))renderPanel(true);});

const el=(id:string)=>document.getElementById(id)!;
function timeText(at:number){const t=calendar(at);return `${names[t.season]} ${t.day} 日 ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`;}
function fullDate(at:number){const t=calendar(at);return `第 ${t.year} 年 · ${names[t.season]} ${t.day} 日`;}
function personName(id:string){return snapshot?.world.residents.find(p=>p.id===id)?.name??id;}
function avatar(r:Resident,size=''){const colors=residentColors(r.appearance);return `<span class="avatar ${size}" style="--hair:${colors.hair};--shirt:${colors.shirt};--skin:${colors.skin}"><i></i><b></b><em></em></span>`;}
function activity(r:Resident){return snapshot?residentActivity(snapshot.world,r).label:'';}
function updateStatus(){
 const world=snapshot?.world;
 let text='正在连接山谷…',status='';
 if(world && !connected){text='连接中断，画面保留在上次记录';status='is-paused';}
 else if(world?.clock.paused){
  status='is-paused';const clock=worldClockStatus(world);text=`${clock.label} · ${clock.detail}`;
  if(world.mode==='formal' && world.metrics.configured){
   const founders=world.residents.filter(person=>person.id.startsWith('founder-'));
   const ready=founders.filter(person=>person.lastDecisionAt>=0).length;
   if(ready<founders.length)text=`${clock.label} · ${clock.detail} · 开局决定 ${ready} / ${founders.length} · ${world.metrics.inFlight.length?'居民正在思考':world.metrics.lastError?'等待模型重试':'正在排队'}`;
  }
 }else if(world){text='山谷持续运行';status='is-live';}
 el('world-state').className=`world-state ${status}`;
 el('world-state').innerHTML=`<span class="status-dot"></span><span>${esc(text)}</span>`;
 for(const listener of mapListeners)listener(snapshot,connected);
}
function receive(next:Snapshot){
 if(snapshot&&next.world.id===snapshot.world.id&&next.world.revision<snapshot.world.revision)return;
 if(snapshot&&next.world.id!==snapshot.world.id){selection=null;detailId=null;closePanel();panelPositions.clear();}
 snapshot=next;connected=true;el('opening').classList.add('hidden');scene.accept(next);
 const formal=next.world.mode==='formal';
 const frontier=next.world.scenario==='frontier';
 el('world-edition').textContent=frontier?'开拓聚落':formal?'正式世界':'世界样章';
 el('atlas-shortcut').classList.toggle('hidden',!formal);
 el('wild-shortcut').classList.toggle('hidden',!frontier);
 el('wild-shortcut').classList.toggle('warning',!!next.world.frontierHazards?.disasters.some(d=>d.phase!=='ended')||!!next.world.frontierHazards?.beasts.some(b=>b.alert?.residentId||b.alert?.animalId));
 const t=calendar(next.world.minute),{phase}=daylight(next.world.minute),period=daylightLabels[phase];
 el('calendar').innerHTML=`<span class="season-symbol">${{spring:'✿',summer:'☀',autumn:'❦',winter:'❄'}[t.season]}</span><span><b>${names[t.season]} · 第 ${t.day} 日</b><small>第 ${t.year} 年，${period} ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}</small></span><i>${icon(next.world.weather==='rain'?'rain':phase==='night'?'moon':'sun')}</i>`;
 el('calendar').title=`现实 ${next.world.clock.realMinutesPerDay} 分钟 · 游戏一天`;
 updateStatus();renderSelection();observeArchives();if(activePanel)renderPanel(true);
}
scene.onSelection=(s)=>{selection=s;renderSelection();};
scene.onFollow=()=>{renderSelection();};
function followNotice(id:string){const state=scene.followState;return state?.personId===id?`<p class="follow-status" role="status">${esc(residentFollowText(state))}</p>`:'';}
function followButton(id:string){return scene.followState?.personId===id&&scene.followState.status==='following'?'<button data-action="stopfollow">停止跟随</button>':`<button data-follow="${esc(id)}">跟随镜头 ${icon('focus')}</button>`;}
scene.onRoom=(b)=>{el('room-banner').classList.toggle('hidden',!b);el('room-banner').innerHTML=b?`<span><b>${esc(b.name)}</b><small>${snapshot?.world.rooms?'室内活动 · 缺失位置仅作示意':'室内样章 · 人物位置仅作示意'}</small></span><button data-action="exitroom">返回山谷 ${icon('arrow')}</button>`:'';};
function renderSelection(){
 const target=el('selection');if(!snapshot||!selection){target.classList.add('hidden');return;}target.classList.remove('hidden');
 if(selection.kind==='animal'||selection.kind==='beast'||selection.kind==='fish'){
  const summary=ecologySummary(snapshot.world,selection);
  if(!summary){target.classList.add('hidden');return;}
  target.innerHTML=`<button class="selection-close" data-action="closeselection" aria-label="取消选择">${icon('close')}</button><div class="selection-title"><span class="place-icon">${icon('leaf')}</span><div><h3>${esc(summary.name)}</h3><span>${esc(summary.subtitle)}</span></div></div><p>${esc(summary.state)}</p><div class="selection-actions">${ecologyButton(selection)}</div>`;return;
 }
 if(selection.kind==='person'){
  const r=snapshot.world.residents.find(p=>p.id===selection!.id);if(!r){const state=scene.followState;if(state?.personId===selection.id){target.innerHTML=`<button class="selection-close" data-action="closeselection" aria-label="取消选择">${icon('close')}</button><h3>${esc(state.name)}</h3>${followNotice(state.personId)}<div class="selection-actions">${followButton(state.personId)}<button data-panel="chronicle">查阅年表 ${icon('arrow')}</button></div>`;}else target.classList.add('hidden');return;}
  target.innerHTML=`<button class="selection-close" data-action="closeselection" aria-label="取消选择">${icon('close')}</button><div class="selection-title">${avatar(r)}<div><h3>${esc(r.name)}</h3><span>${esc(activity(r))} · ${ageLabel(r.bornAt,snapshot.world.minute)}</span></div></div><p>${esc(r.intention||'还没有表达新的打算。')}</p>${followNotice(r.id)}<div class="selection-actions">${followButton(r.id)}<button data-person="${esc(r.id)}">人物档案 ${icon('arrow')}</button></div>`;
 }else{
  if(selection.kind==='project'){
   const p=snapshot.world.construction?.projects.find(p=>p.id===selection!.id);if(!p){target.classList.add('hidden');return;}
   target.innerHTML=`<button class="selection-close" data-action="closeselection" aria-label="取消选择">${icon('close')}</button><h3>${esc(p.name)}</h3>${projectSummary(snapshot.world,p)}<div class="selection-actions"><button data-panel="construction">查看建设进程 ${icon('arrow')}</button></div>`;return;
  }
  const b=snapshot.world.buildings.find(b=>b.id===selection!.id);if(!b){target.classList.add('hidden');return;}
  target.innerHTML=`<button class="selection-close" data-action="closeselection" aria-label="取消选择">${icon('close')}</button><div class="selection-title"><span class="place-icon">${icon('house')}</span><div><h3>${esc(b.name)}</h3><span>${kinds[b.kind]} · ${b.residents.length}/${b.capacity} 人居住</span></div></div><p>${b.ownerId==='commons'?'社区共有的场所':`${esc(personName(b.ownerId))} 的产权`}。${b.residents.length?b.residents.map(id=>esc(personName(id))).join('、')+'住在这里。':'目前没有住户。'}</p><div class="selection-actions"><button data-enter="${esc(b.id)}">看看室内 ${icon('arrow')}</button></div>`;
 }
}
const panelNames:Record<string,[string,string]>={disasterHistory:['同一编号的留存事实','灾害事件链'],food:['只读营养估计','粮食余量'],animal:['生灵观察','个体档案'],animalHistory:['留下的足迹','动物年表'],ecology:['山谷的相互依存','生计脉络'],designs:['构想与实物','居民图纸'],biography:['留下的足迹','人物生平'],thread:['一次相遇','连续阅读交谈'],culture:['乡间的日子','节庆、婚礼与追思'],household:['家庭与同住','共同生活钱物'],debt:['借款与承诺','借贷和遗产清算'],people:['PEOPLE OF THE VALLEY','山谷居民'],relations:['TIES & CONNECTIONS','人物关系'],conversations:['WORDS IN THE AIR','沿途交谈'],places:['PLACES & LIVELIHOODS','生活场所'],chronicle:['THE VALLEY REMEMBERS','山谷年表'],about:['A LIVING VALLEY','关于这座山谷'],atlas:['','山谷全图'],person:['A LIFE, UNFOLDING','人物档案'],population:['','人口与家庭'],duties:['','公共排班'],market:['','山谷经营'],finance:['','公共账本'],employment:['','长期雇佣'],foreign:['','镇外贸易'],construction:['','建设进程'],education:['','课堂与技能'],industry:['','产业与物产'],wild:['','野外与生计'],health:['','伤病与照护'],longCare:['','托育与养老'],support:['','公共生活保障'],cemetery:['','墓园与安置'],infrastructure:['','道路、水岸与墓园']};
let detailId:string|null=null;
let animalDetail:EcologySelection|null=null;
function openPanel(name:string){panelPositions.save(el('panel-body'));for(const reader of Object.values(archives))reader.deactivate();activePanel=name;observeArchives();el('panel').classList.remove('hidden');document.querySelectorAll('.dock button').forEach(b=>b.classList.toggle('active',(b as HTMLElement).dataset.panel===(['animal','animalHistory','disasterHistory'].includes(name)?'wild':['culture','thread'].includes(name)?'conversations':['population','household','biography'].includes(name)?'people':['food','duties','market','finance','employment','foreign','construction','education','industry','health','longCare','support','cemetery','infrastructure','debt','ecology','designs'].includes(name)?'places':name)));renderPanel(false,true);el('panel').querySelector<HTMLButtonElement>('[data-action="closepanel"]')?.focus({preventScroll:true});}
function renderPanel(keepScroll=false,entry=false){
 if(!activePanel)return;const [kicker,title]=panelNames[activePanel]??panelNames.people;el('panel-kicker').textContent=kicker;el('panel-title').textContent=title;
 const body=el('panel-body'),position=captureArchivePosition(body);
 const reader=archives[activePanel as keyof typeof archives];
 if(keepScroll&&body.contains(document.activeElement)&&document.activeElement?.closest('form[data-history-filters]'))return;
 const restoreWaterDetails=rememberWaterDetails(body);
 body.querySelectorAll<HTMLDetailsElement>('details[data-duty-shift]').forEach(details=>dutyOpen.set(details.dataset.dutyShift!,details.open));
 if(!snapshot){body.innerHTML='<div class="empty"><p>正在连接世界记录。</p></div>';return;}
 const w=snapshot.world;
 const identity=activePanel==='biography'?[detailId,biographyScope]:activePanel==='person'?detailId:activePanel==='thread'?threadId:activePanel==='disasterHistory'?disasterArchiveId:activePanel==='animalHistory'?animalArchiveId:activePanel==='animal'?animalDetail:activePanel==='people'?[searchName,peopleScope]:activePanel==='relations'?[relationId,relationPage]:null;
 const viewKey=JSON.stringify([w.id,activePanel,identity]);
 const finishPosition=(ready=true)=>panelPositions.restore(body,{key:viewKey,revision:reader?.positionRevision??0},{entry,keep:keepScroll,ready:ready&&!reader?.loading&&!(activePanel==='biography'&&biographies.loading)},position);
 renderTools(w);
 if(optionalPanels.has(activePanel)&&!panelRenderers.value){
  void panelRenderers.request();
  body.innerHTML=panelRenderers.status==='error'
   ?'<div class="empty" role="alert"><p>观察面板加载失败，地图仍可继续浏览。</p><button data-action="retry-panels">重试加载</button><p>若重试仍失败，请刷新页面获取最新版本。</p></div>'
   :'<div class="empty" role="status"><p>正在加载观察面板…</p></div>';
  finishPosition(false);return;
 }
 const panels=panelRenderers.value;
 if(activePanel==='atlas'){
  const at=scene.cameraTile(), map=atlas.show(w,calendar(w.minute).season,snapshot.mapRevision??w.id,at);
  body.innerHTML=`<p class="panel-intro">镜头位于${esc(currentRegion(at)??w.map.name)} · ${at.x}, ${at.y}</p><div class="atlas-frame"></div><p class="footnote">点图移动镜头 · ${w.map.width} × ${w.map.height} 格</p><div class="atlas-links">${FORMAL_REGIONS.map(r=>`<button data-region="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>`;
  body.querySelector('.atlas-frame')!.append(map);
 }
 else if(activePanel==='food')body.innerHTML=panels!.foodCoveragePanel(w,snapshot.foodCoverage);
 else if(activePanel==='population')body.innerHTML=censusPanel(w);
 else if(activePanel==='duties')body.innerHTML=dutiesPanel(w,dutyOpen);
 else if(activePanel==='market')body.innerHTML=panels!.marketPanel(w);
 else if(activePanel==='culture')body.innerHTML=culturePanel(w);
 else if(activePanel==='household')body.innerHTML=panels!.householdPanel(w);
 else if(activePanel==='debt')body.innerHTML=panels!.debtPanel(w);
 else if(activePanel==='finance')body.innerHTML=panels!.financePanel(w);
 else if(activePanel==='employment')body.innerHTML=panels!.employmentPanel(w);
 else if(activePanel==='infrastructure')body.innerHTML=panels!.infrastructurePanel(w);
 else if(activePanel==='cemetery')body.innerHTML=panels!.funeraryPanel(w);
 else if(activePanel==='longCare')body.innerHTML=panels!.longCarePanel(w);
 else if(activePanel==='support')body.innerHTML=panels!.supportPanel(w);
 else if(activePanel==='health')body.innerHTML=panels!.healthPanel(w);
 else if(activePanel==='industry')body.innerHTML=panels!.industryPanel(w);
 else if(activePanel==='ecology')body.innerHTML=panels!.ecologyPanel(w);
 else if(activePanel==='designs')body.innerHTML=panels!.designsPanel(w);
 else if(activePanel==='education')body.innerHTML=panels!.educationPanel(w);
 else if(activePanel==='construction')body.innerHTML=constructionPanel(w);
 else if(activePanel==='foreign')body.innerHTML=panels!.foreignPanel(w);
 else if(activePanel==='people'){
  const people=w.residents.filter(person=>{
   if(searchName&&!person.name.includes(searchName))return false;
   if(peopleScope==='all')return true;
   if(peopleScope==='departed')return person.status==='dead'||person.residency==='outside';
   if(person.status!=='alive'||person.residency==='outside')return false;
   return peopleScope==='local'||person.residency===peopleScope;
  });
  body.innerHTML=`${w.mode==='formal'?chapterLinks('people'):''}<p class="panel-intro">${people.length} 位${peopleScope==='departed'?'已离开或逝去的人物':'生活者'}</p><div class="people-list">${people.map(r=>`<button class="person-card" data-person="${esc(r.id)}">${avatar(r)}<span class="person-card-text"><b>${esc(r.name)}<small>${ageLabel(r.bornAt,r.deathAt??w.minute)}</small></b><em>${esc(activity(r))}</em>${protectionSummary(w,r)?`<small class="protection-summary">${esc(protectionSummary(w,r))}</small>`:''}<span>${esc(r.intention||'新的生活尚待展开。')}</span></span>${icon('arrow')}</button>`).join('')}</div>`;
 }
 else if(activePanel==='person'){
  const r=w.residents.find(p=>p.id===detailId);body.innerHTML=r?personDetail(r):'<div class="empty">这份人物记录暂不可用。</div>';
 }
 else if(activePanel==='relations')body.innerHTML=relations();
 else if(activePanel==='conversations'){
  body.querySelectorAll<HTMLDetailsElement>('details[data-conversation]').forEach(d=>conversationOpen.set(d.dataset.conversation!,d.open));
  const reader=archives.conversations;void reader.configure(w.id,{kind:'conversation'});reader.observe(w,true);
  body.innerHTML=wordsTabs('conversations')+meetingsSummary(w)+archiveControls('conversations',reader,w)+(reader.page?conversations([...reader.page.events].reverse()):'');
 }
 else if(activePanel==='chronicle'){
  const reader=archives.chronicle;void reader.configure(w.id);reader.observe(w,true);
  body.innerHTML=`<p class="panel-intro">只记录已经发生的事。可按年份、人物和原文查阅完整留存年表；每页记录保持不变，有新记录时由你选择“回到最新”。</p>`+archiveControls('chronicle',reader,w)+(reader.page?archiveTimeline(reader.page.events,w):'');
 }
 else if(activePanel==='thread'){
  const reader=archives.thread;void reader.configure(w.id,{kind:'conversation',conversationId:threadId});reader.observe(w,true);
  body.innerHTML='<button data-panel="conversations">返回所有交谈</button><p class="panel-intro">每页从上往下连续阅读；点“更早一页”继续查阅这场交谈的前文。</p>'+archiveControls('thread',reader,w)+(reader.page?`<div class="conversation-lines">${[...reader.page.events].reverse().map(e=>`<article data-history-event="${esc(e.id)}"><small>${fullDate(e.at)} · ${timeText(e.at).split('日 ')[1]}</small><p>${esc(e.text)}</p></article>`).join('')}</div>`:'');
 }
 else if(activePanel==='biography'){
  const r=w.residents.find(p=>p.id===detailId);
  if(!r)body.innerHTML='<p class="empty">这份人物记录暂不可用。</p>';
  else {const reader=archives.biography;void biographies.configure(w,r);void reader.configure(w.id,biographyScope==='related'?{personId:r.id}:{q:r.name});reader.observe(w,true);
   body.innerHTML=biographyOverview(biographies.data,w,biographies.loading,biographies.error)+`<div class="chapter-links"><button data-bio-scope="related" aria-pressed="${biographyScope==='related'}">本人相关记录</button><button data-bio-scope="mentions" aria-pressed="${biographyScope==='mentions'}">原文提及姓名</button>${biographies.error?'<button data-bio-retry="true">重试人物资料</button>':''}</div>`+archiveControls('biography',reader,w)+(reader.page?archiveTimeline(reader.page.events,w):'');
  }
 }
 else if(activePanel==='disasterHistory'&&disasterArchiveId){
  const reader=archives.disasterHistory;void reader.configure(w.id,{disasterId:disasterArchiveId});reader.observe(w,true);
  body.innerHTML=disasterHistoryOverview(w,disasterArchiveId)+archiveControls('disasterHistory',reader,w)+(reader.page?archiveTimeline(reader.page.events,w):'');
 }
 else if(activePanel==='animalHistory'&&animalArchiveId){
  const reader=archives.animalHistory;void reader.configure(w.id,{animalId:animalArchiveId});reader.observe(w,true);
  body.innerHTML=animalHistoryOverview(w,animalArchiveId)+archiveControls('animalHistory',reader,w)+(reader.page?archiveTimeline(reader.page.events,w):'');
 }
 else if(activePanel==='wild')body.innerHTML=panels!.wildernessPanel(w);
 else if(activePanel==='animal'&&animalDetail)body.innerHTML=animalInspector(w,animalDetail);
 else if(activePanel==='places')body.innerHTML=`${w.mode==='formal'?chapterLinks('places'):''}<p class="panel-intro">生产、经营和照料需要居民亲自到场。</p>${w.scenario==='frontier'?'<div class="chapter-links"><button data-panel="ecology">生计脉络</button><button data-panel="designs">居民图纸</button></div>':''}<div class="places-list">${w.buildings.map(b=>`<article class="place-card"><span class="place-icon">${icon(b.kind==='home'?'house':'leaf')}</span><div><small>${kinds[b.kind]}</small><h3>${esc(b.name)}</h3><p>${b.ownerId==='commons'?'社区共有':esc(personName(b.ownerId))+' 所有'} · ${b.residents.length}/${b.capacity} 人居住</p><div class="place-actions"><button data-locate="${esc(b.id)}">地图定位</button><button data-enter="${esc(b.id)}">${w.rooms?'看看室内':'查看室内样章'} ${icon('arrow')}</button></div></div></article>`).join('')}</div><h3 class="section-label">墓园</h3><button data-panel="cemetery">墓园、暂存与纪念记录</button><p class="panel-intro">${w.graves.filter(g=>g.personId).length} 座纪念，${w.graves.filter(g=>!g.personId).length} 处空余墓位。</p>${w.graves.filter(g=>g.personId).map(g=>`<div class="memorial">${icon('leaf')}<span><b>${esc(personName(g.personId!))}</b><small>${g.buriedAt===null?'尚未安葬':fullDate(g.buriedAt)+' 安葬'}</small></span></div>`).join('')}`;
 else if(activePanel==='about')body.innerHTML=`<div class="notice"><b>自行生活的山谷</b><p>${w.scenario==='frontier'?'开拓聚落由九人起步，靠田地、牧场和河岸逐步生活。':'人口随实际出生、死亡和迁居变化。'}室外地图 ${w.map.width} × ${w.map.height} 格，共 ${(w.map.width*w.map.height).toLocaleString('zh-CN')} 格。${w.mode==='formal'?'可在全图中前往七个地区。':''}</p></div><h3 class="section-label">这个版本可以观察</h3><ul class="capabilities">${snapshot.capabilities.active.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><h3 class="section-label">持续观察</h3><ul class="capabilities pending">${snapshot.capabilities.pending.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p class="footnote">室内的床、厨房、课桌和工位对应人物实际到场与劳动。观察页面只提供查看功能，观看人数不改变世界时间。<br>版本 ${esc(snapshot.version)}</p>`;
 if(keepScroll&&!entry)restoreWaterDetails();
 finishPosition();
}
function renderTools(w:Snapshot['world']){
 const root=el('panel-tools'), large=w.residents.length>10;
 const kind=large&&(activePanel==='people'||activePanel==='relations')?activePanel:'';
 const key=kind==='relations'?kind+w.residents.map(r=>r.id+r.name).join('|'):kind;
 if(key===activeTools)return;
 activeTools=key;root.classList.toggle('hidden',!kind);
 if(kind==='people'){
  root.innerHTML='<label>姓名 <input type="search" autocomplete="off" placeholder="查找居民"></label><label>名册 <select aria-label="人口类别"><option value="local">在镇所有人</option><option value="resident">常住居民</option><option value="visitor">在镇访客</option><option value="departed">迁出与纪念</option><option value="all">全部人物</option></select></label>';
  const scope=root.querySelector('select')!;scope.value=peopleScope;
  scope.addEventListener('change',()=>{peopleScope=scope.value;renderPanel();});
  const input=root.querySelector('input')!;input.value=searchName;
  input.addEventListener('input',()=>{searchName=input.value.trim();renderPanel();});
 } else if(kind==='relations'){
  if(!w.residents.some(r=>r.id===relationId))relationId=w.residents.find(r=>r.relations.length)?.id??w.residents[0].id;
  root.innerHTML=`<label>以谁为中心 <select aria-label="关系图中心居民">${w.residents.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>`;
  const select=root.querySelector('select')!;select.value=relationId;
  select.addEventListener('change',()=>{relationId=select.value;relationPage=0;renderPanel();});
 }else root.replaceChildren();
}
function meter(label:string,value:number,color:string){return `<div class="need"><span>${label}</span><i><b style="width:${Math.max(0,Math.min(100,value))}%;background:${color}"></b></i><em>${Math.round(value)}</em></div>`;}
function personDetail(r:Resident){
 const w=snapshot!.world,home=w.buildings.find(b=>b.id===r.homeId);
 const {residentFoodProfile,agencyProfile,bodyProfile,healthProfile,emergencyCareProfile,adoptionProfile,familyRelocationProfile,householdProfile}=panelRenderers.value!;
 return `<div class="profile-head">${avatar(r,'large')}<div><h3>${esc(r.name)}</h3><p>${ageLabel(r.bornAt,r.deathAt??w.minute)} · ${r.status==='dead'?'已故':r.residency==='outside'?'镇外生活':r.residency==='visitor'?'暂居访客':'山谷居民'}</p><span>${r.traits.map(esc).join(' · ')}</span></div></div><button data-biography="${esc(r.id)}">查阅完整生平与年表</button><button class="primary-light" data-follow="${esc(r.id)}">${icon('focus')} 在地图上跟随</button><div class="intention"><small>现在的打算</small><p>${esc(r.intention||'尚未表达新的打算。')}</p><span>${esc(activity(r))}</span></div><h3 class="section-label">日常状态</h3>${meter('饥饿',r.hunger,'var(--bevel)')}${meter('体力',r.energy,'var(--leaf)')}${meter('健康',r.health,'var(--pond)')}<div class="profile-facts"><div><span>住处</span><b>${home?esc(home.name):'尚未安顿'}</b></div><div><span>身上物品</span><b>${Object.entries(r.inventory).filter(([,n])=>n!>0).map(([item,n])=>`${items[item]??item} ${n}`).join(' · ')||'暂无'}</b></div><div><span>钱款</span><b>${r.coins}</b></div></div>${residentStatusProfile(w,r)}${residentFoodProfile(w,r,snapshot!.foodCoverage)}${agencyProfile(r)}${bodyProfile(w,r)}${estateProfile(w,r)}${healthProfile(w,r)}${familyPanel(w,r)}${emergencyCareProfile(w,r)}${adoptionProfile(w,r)}${familyRelocationProfile(w,r)}${householdProfile(w,r)}<h3 class="section-label">技能</h3><div class="profile-facts">${Object.entries({...r.skills,...(w.industry?.fishingExperience?.[r.id]===undefined?{}:{fishing:w.industry.fishingExperience[r.id]})}).map(([k,n])=>`<div><span>${({farming:'农事',building:'建造',care:'照护',fishing:'捕鱼'} as Record<string,string>)[k]??esc(k)}</span><b>${n.toFixed(2)}</b></div>`).join('')}</div><h3 class="section-label">人与人之间</h3>${r.relations.length?r.relations.map(rel=>`<button class="relation-row" data-person="${esc(rel.targetId)}"><b>${esc(personName(rel.targetId))}</b><span>${[rel.kin?({parent:'父母',child:'子女',sibling:'手足'}[rel.kin]):'',rel.adoptive?({parent:'养亲',child:'养子女',sibling:'收养手足'}[rel.adoptive]):'',rel.partner?(rel.partner==='married'?'伴侣':'恋人'):'',`好感 ${rel.affection}`,`信任 ${rel.trust}`,rel.conflict?`矛盾 ${rel.conflict}`:''].filter(Boolean).join(' · ')}</span>${icon('arrow')}</button>`).join(''):'<p class="panel-intro">新的关系尚待日常相处形成。</p>'}${interpretationsProfile(w,r)}<h3 class="section-label">亲历与获知</h3><div class="memory-list">${r.memories.slice(-12).reverse().map(m=>`<article><small>${timeText(m.receivedAt)} · ${{self:'亲身经历',witness:'在场见证',heard:'获知消息'}[m.source]}</small><p>${esc(m.text)}</p></article>`).join('')||'<p class="panel-intro">还没有新的记录。</p>'}</div>`;
}
function relations(){
 const all=snapshot!.world.residents, focus=all.length>10?all.find(r=>r.id===relationId):undefined;
 const neighbours=focus?all.filter(r=>r.id!==focus.id&&(focus.relations.some(link=>link.targetId===r.id)||r.relations.some(link=>link.targetId===focus.id))):[];
 const pageSize=6, pages=Math.max(1,Math.ceil(neighbours.length/pageSize));
 relationPage=Math.min(relationPage,pages-1);
 const list=focus?neighbours.slice(relationPage*pageSize,(relationPage+1)*pageSize):all;
 const n=list.length,cx=210,cy=190,radius=n<4?118:135;
 const points=list.map((r,i)=>({r,x:cx+Math.cos(-Math.PI/2+i*Math.PI*2/n)*radius,y:cy+Math.sin(-Math.PI/2+i*Math.PI*2/n)*radius}));
 if(focus)points.push({r:focus,x:cx,y:cy});
 let links='';for(const p of points)for(const rel of p.r.relations){const t=points.find(p=>p.r.id===rel.targetId);if(!t||t===p||(focus&&p.r!==focus&&t.r!==focus))continue;const col=rel.kin||rel.adoptive?'var(--wood)':rel.conflict>25?'var(--anger)':rel.partner||rel.affection>45?'var(--heart)':'var(--leaf)';const dx=t.x-p.x,dy=t.y-p.y,d=Math.hypot(dx,dy),sx=p.x+dx/d*31,sy=p.y+dy/d*31,ex=t.x-dx/d*37,ey=t.y-dy/d*37;const mx=(p.x+t.x)/2-dy*.05,my=(p.y+t.y)/2+dx*.05;links+=`<path d="M${sx},${sy} Q${mx},${my} ${ex},${ey}" fill="none" stroke="${col}" stroke-width="${rel.kin||rel.adoptive||rel.partner?2:1.3}" marker-end="url(#arrowhead)" opacity=".8"/><title>${esc(p.r.name)} → ${esc(t.r.name)}：好感 ${rel.affection}，信任 ${rel.trust}，矛盾 ${rel.conflict}</title>`;}
 return `<p class="panel-intro">${focus?`${esc(focus.name)} 和 ${neighbours.length} 位居民有已记录的关系。`:''}箭头指向关系的另一方。</p>${focus&&pages>1?`<div class="graph-pages"><button data-relation-page="-1" ${relationPage===0?'disabled':''}>上一页</button><span>${relationPage+1} / ${pages}</span><button data-relation-page="1" ${relationPage===pages-1?'disabled':''}>下一页</button></div>`:''}<div class="relation-graph"><svg viewBox="0 0 420 390" role="img" aria-label="居民人物关系图"><defs><marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="var(--wood-dark)"/></marker></defs><circle cx="210" cy="190" r="130" fill="none" stroke="var(--line)" stroke-dasharray="2 8"/>${links}${points.map(({r,x,y})=>`<g class="graph-person" data-person="${esc(r.id)}" tabindex="0" role="button" aria-label="查看${esc(r.name)}"><circle cx="${x}" cy="${y}" r="27" fill="var(--light)" stroke="var(--slat)"/><circle cx="${x}" cy="${y-5}" r="9" fill="${residentColors(r.appearance).skin}"/><path d="M${x-14} ${y+17}v-9a14 9 0 0 1 28 0v9" fill="${residentColors(r.appearance).shirt}"/><path d="M${x-9} ${y-7}v-4a9 6 0 0 1 18 0v4" fill="${residentColors(r.appearance).hair}"/><text x="${x}" y="${y+44}" text-anchor="middle">${esc(r.name)}</text></g>`).join('')}</svg></div><div class="relation-legend"><span><i style="background:var(--wood)"></i>亲缘</span><span><i style="background:var(--leaf)"></i>友谊 / 信任</span><span><i style="background:var(--heart)"></i>好感 / 伴侣</span><span><i style="background:var(--anger)"></i>矛盾</span></div><p class="footnote">颜色突出当前关系的一面。点击人物可以查看各方向的数值与经历；没有发生的关系不会被补写。</p>`;
}
function conversations(events:WorldEvent[]){
 if(!events.length)return `<div class="empty">${icon('chat')}<h3>还没有交谈记录</h3><p>当居民相遇并决定开口，<br>他们的话会按会话整理在这里。</p></div>`;
 const groups=new Map<string,WorldEvent[]>();for(const e of events){const key=e.conversationId??`${e.actors.slice().sort().join('-')}-${Math.floor(e.at/60)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(e);}
 return `<p class="panel-intro">每一次相遇，单独成篇。从上往下读完一场交谈。</p><div class="conversations">${[...groups.entries()].reverse().map(([id,entries])=>{const participants=[...new Set(entries.flatMap(e=>e.actors))];return `<details class="conversation" data-conversation="${esc(id)}" ${(conversationOpen.get(id)??id===[...groups.keys()].at(-1))?'open':''}><summary><span class="conversation-icon">${icon('chat')}</span><span><b>${participants.map(id=>esc(personName(id))).join('、')}</b><small>${fullDate(entries[0].at)} · 本页 ${entries.length} 条记录</small></span><em>⌄</em></summary><div class="conversation-lines">${entries.map(e=>`<article data-history-event="${esc(e.id)}"><small>${timeText(e.at).split('日 ')[1]}</small><p>${esc(e.text)}</p></article>`).join('')}${entries.some(e=>e.conversationId)?`<button data-thread="${esc(id)}">查阅这场交谈的完整记录</button>`:''}</div></details>`;}).join('')}</div>`;
}
function closePanel(){panelPositions.save(el('panel-body'));panelPositions.deactivate();for(const reader of Object.values(archives))reader.deactivate();const returnTo=['animal','animalHistory','disasterHistory'].includes(activePanel??'')?'wild':['culture','thread'].includes(activePanel??'')?'conversations':['person','population','household','biography'].includes(activePanel??'')?'people':['duties','market','finance','employment','foreign','construction','education','industry','health','longCare','support','cemetery','infrastructure','debt','ecology','designs'].includes(activePanel??'')?'places':activePanel;activePanel=null;el('panel').classList.add('hidden');document.querySelectorAll('.dock button').forEach(b=>b.classList.remove('active'));if(returnTo)document.querySelector<HTMLButtonElement>(`[data-panel="${returnTo}"]`)?.focus({preventScroll:true});}
el('panel-body').addEventListener('scroll',()=>panelPositions.scrolled(el('panel-body')));
for(const type of ['wheel','touchstart','pointerdown'])el('panel-body').addEventListener(type,()=>panelPositions.interacted());
document.addEventListener('click',e=>{
 const button=(e.target as Element).closest<HTMLElement>('[data-action],[data-panel],[data-person],[data-biography],[data-thread],[data-history],[data-bio-scope],[data-bio-retry],[data-follow],[data-project],[data-locate],[data-enter],[data-tile],[data-region],[data-relation-page],[data-animal-detail],[data-animal-map],[data-animal-history],[data-disaster-history]');if(!button)return;
 if(button.dataset.disasterHistory){disasterArchiveId=button.dataset.disasterHistory;openPanel('disasterHistory');return;}
 if(button.dataset.animalHistory){scene.stopFollowing();animalArchiveId=button.dataset.animalHistory;openPanel('animalHistory');return;}
 if(button.dataset.animalDetail){scene.stopFollowing();animalDetail=parseEcologyKey(button.dataset.animalDetail);if(animalDetail)openPanel('animal');return;}
 if(button.dataset.animalMap){const subject=parseEcologyKey(button.dataset.animalMap);if(subject){scene.focusEcology(subject);selection=subject;closePanel();renderSelection();}return;}
 if(button.dataset.region){
  const region=FORMAL_REGIONS.find(r=>r.id===button.dataset.region);
  if(region){scene.watchTile(region.id==='village'&&snapshot?.world.map.settlement?snapshot.world.map.settlement:region.landmark);selection=null;renderSelection();closePanel();}return;
 }
 if(button.dataset.relationPage){relationPage+=Number(button.dataset.relationPage);renderPanel();return;}
 if(button.dataset.panel){openPanel(button.dataset.panel);return;}
 if(button.dataset.biography){if(scene.followState?.personId!==button.dataset.biography)scene.stopFollowing();detailId=button.dataset.biography;biographyScope='related';openPanel('biography');return;}
 if(button.dataset.thread){threadId=button.dataset.thread;openPanel('thread');return;}
 if(button.dataset.bioScope){biographyScope=button.dataset.bioScope==='mentions'?'mentions':'related';renderPanel();return;}
 if(button.dataset.bioRetry){const r=snapshot?.world.residents.find(p=>p.id===detailId);if(r&&snapshot)void biographies.configure(snapshot.world,r,true);return;}
 if(button.dataset.history){const reader=archives[button.dataset.history as keyof typeof archives],action=button.dataset.historyAction;if(reader&&['older','newer','latest','retry'].includes(action??''))void reader[action as 'older'|'newer'|'latest'|'retry']();return;}
 if(button.dataset.person){if(scene.followState?.personId!==button.dataset.person)scene.stopFollowing();detailId=button.dataset.person;openPanel('person');return;}
 if(button.dataset.follow){scene.focusPerson(button.dataset.follow);selection={kind:'person',id:button.dataset.follow};closePanel();renderSelection();return;}
 if(button.dataset.tile){const [x,y]=button.dataset.tile.split(',').map(Number);if(Number.isFinite(x)&&Number.isFinite(y)){scene.watchTile({x,y});closePanel();}return;}
 if(button.dataset.project){const p=snapshot?.world.construction?.projects.find(p=>p.id===button.dataset.project);if(p){scene.watchTile({x:p.at.x+p.width/2,y:p.at.y+p.height/2});selection={kind:'project',id:p.id};closePanel();renderSelection();}return;}
 if(button.dataset.locate){scene.focusBuilding(button.dataset.locate);selection={kind:'building',id:button.dataset.locate};closePanel();renderSelection();return;}
 if(button.dataset.enter){scene.enterRoom(button.dataset.enter);closePanel();selection=null;renderSelection();return;}
 switch(button.dataset.action){case'retry-panels':void panelRenderers.request(true);renderPanel();break;case'stopfollow':scene.stopFollowing();renderSelection();break;case'trade-station':if(snapshot?.world.foreignTrade){scene.watchTile(snapshot.world.foreignTrade.station);closePanel();}break;case'home':scene.home();break;case'zoomin':scene.zoom(.25);break;case'zoomout':scene.zoom(-.25);break;case'closepanel':closePanel();break;case'closeselection':selection=null;scene.clearSelection();renderSelection();break;case'exitroom':scene.exitRoom();break;}
});
document.addEventListener('submit',e=>{
 const form=(e.target as Element).closest<HTMLFormElement>('form[data-history-filters]');if(!form)return;e.preventDefault();if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
 const reader=archives[form.dataset.historyFilters as keyof typeof archives];if(!reader)return;
 const values=new FormData(form),filters:HistoryQuery={};const q=String(values.get('q')??'').trim(),kind=String(values.get('kind')??''),person=String(values.get('person')??''),year=Number(values.get('year'));
 if(q)filters.q=q;if(kind)filters.kind=kind as WorldEvent['kind'];if(person)filters.personId=person;if(year>0){filters.from=(year-1)*YEAR;filters.to=year*YEAR;}if(values.has('population'))filters.populationOnly=true;if(values.has('water'))filters.waterOnly=true;
 (document.activeElement as HTMLElement)?.blur();void reader.setFilters(filters);
});
atlas.canvas.addEventListener('click',e=>{
 if(!snapshot)return;
 scene.watchTile(atlas.tileAt(e,snapshot.world));selection=null;renderSelection();closePanel();
});
document.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)&&el('panel-body').contains(e.target as Node))panelPositions.interacted();if(e.key==='Escape'){closePanel();selection=null;scene.clearSelection();renderSelection();scene.exitRoom();}if((e.key==='Enter'||e.key===' ')&&(e.target as HTMLElement).matches('.graph-person')){e.preventDefault();(e.target as HTMLElement).dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
let stream:EventSource|null=null;
let reconnecting=false;
async function connect(){
 if(reconnecting)return;
 reconnecting=true;
 stream?.close();
 try{
  const response=await fetch(new URL('world',apiURL),{signal:AbortSignal.timeout(20000),cache:'no-store'});
  if(!response.ok)throw Error('World unavailable');
  receive(await response.json() as Snapshot);
 }catch{
  connected=false;scene.resetWorkFeedback();updateStatus();
  el('opening').innerHTML='<h1>正在连接山谷</h1><p>世界记录准备好后，地图会自动打开。</p>';
 }
 const source=new EventSource(new URL('events',apiURL));
 stream=source;reconnecting=false;
 source.addEventListener('update',event=>{
  if(source!==stream)return;
  try{
   const next=snapshot&&applyObserverUpdate(snapshot,JSON.parse((event as MessageEvent).data));
   if(next){receive(next);return;}
  }catch{}
  source.close();stream=null;connected=false;scene.resetWorkFeedback();updateStatus();
  window.setTimeout(()=>void connect(),1000);
 });
 source.onopen=()=>{connected=true;updateStatus();};
 source.onerror=()=>{connected=false;scene.resetWorkFeedback();updateStatus();};
}
void connect();
// Optional presentation must never prevent the original client from connecting.
try{mountIsometricObserver(observerMap);}catch(error){console.warn('Optional isometric observer unavailable; original 2D retained',error);}
