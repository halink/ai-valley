import {isDeepStrictEqual} from 'node:util';
import type {World,Resident} from '../shared/types.js';
import type {SeasonalInspectAction,SeenSeasonalPlot} from '../shared/mvp-seasonal.js';
import {MVP_HALL,hasMvpHamlet} from '../shared/mvp-hamlet.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {visibleOwnPlots} from './crop-observation.js';
import {agriculturePlot,plantTarget,validAgricultureAction} from './mvp-agriculture.js';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const point=(v:unknown)=>exact(v,['x','y'])&&Number.isSafeInteger((v as {x:number}).x)&&Number.isSafeInteger((v as {y:number}).y)&&(v as {x:number}).x>=0&&(v as {y:number}).y>=0;
function bad():never {throw Error('mvp_seasonal_knowledge_invalid');}
export function visibleSeasonalPlots(w:World,r:Resident):SeenSeasonalPlot[]{
 if(!w.mvpAgriculture||!w.mvpSoil)return [];
 return visibleOwnPlots(w,r).map(p=>{const a=agriculturePlot(w,p.id);if(!a)throw Error('seasonal_personal_missing_plot');const soil=w.mvpSoil!.plots.find(s=>s.plotId===p.id);return {at:{...p.at},target:plantTarget(w,p),kind:a.instance?.kind??'empty',cultivar:a.instance?.cultivar??null,mature:!!p.crop&&p.crop.growth>=Number(w.definitions[p.crop.definition]?.data.growthDays),soil:soil?BigInt(soil.current.water)<30n*BigInt(w.mvpSoil!.denominator)?'dry':'adequate':null};});
}
/** Shape/time/world binding only. Never rewrite old personal evidence from the
 * current remote field, nor require that the remembered owner still owns it. */
export function validateSeasonalKnowledge(w:World):void {
 for(const r of w.residents??[]){if(!Object.hasOwn(r,'mvpSeasonalKnowledge'))continue;const s=r.mvpSeasonalKnowledge;
  if(!s||!exact(s,['schemaVersion','worldId','observerId','nextSequence','latest','receipts'])||s.schemaVersion!==1||w.mode!=='validation'||!w.mvpAgriculture||s.worldId!==w.id||s.observerId!==r.id||!Number.isSafeInteger(s.nextSequence)||s.nextSequence<1||!object(s.latest)||!object(s.receipts))bad();
  const nums=new Set<number>();for(const [id,k]of Object.entries(s.receipts)){
   const n=Number(id.slice(13));
   if(!/^seasonal-see:[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(n)||n>=s.nextSequence||nums.has(n)||!exact(k,['id','worldId','observerId','observedAt','observerAt','plot'])||k.id!==id||k.worldId!==w.id||k.observerId!==r.id||!Number.isFinite(k.observedAt)||k.observedAt<0||k.observedAt>w.minute||!point(k.observerAt))bad();nums.add(n);
   const p=k.plot;if(!exact(p,['at','target','kind','cultivar','mature','soil'])||!point(p.at)||!['empty','legacy','climate'].includes(p.kind)||!(p.cultivar===null||['spring','summer','winter'].includes(p.cultivar))||typeof p.mature!=='boolean'||!(p.soil===null||p.soil==='dry'||p.soil==='adequate')||!validAgricultureAction({type:'mvpAgriculture',operation:'clear',cultivar:p.cultivar??'spring',target:p.target})||p.target.replace!==false||p.kind==='empty'&&(p.target.instanceId!==null||p.cultivar!==null||p.mature)||p.kind!=='empty'&&p.target.instanceId===null||p.kind==='climate'&&p.cultivar===null||p.kind==='legacy'&&p.cultivar!==null)bad();
  }
  const latest:Record<string,string>={};let lastTime=-1;
  if(nums.size!==s.nextSequence-1)bad();
  for(let n=1;n<s.nextSequence;n++){const k=s.receipts['seasonal-see:'+n];if(!k||k.observedAt<lastTime)bad();lastTime=k.observedAt;latest[k.plot.target.plotId]=k.id;}
  if(JSON.stringify(Object.entries(latest).sort())!==JSON.stringify(Object.entries(s.latest).sort()))bad();
 }
}
/** Called only by the real world's observation step (or its isolated simulation
 * clone), never while constructing a menu. Preserve previous receipts for IDs.
 * No actor revision bump; unchanged field facts do not append once per tick. */
export function captureSeasonalKnowledge(w:World,r:Resident):void {
 if(w.mode!=='validation'||!w.mvpAgriculture)return;
 const plots=visibleSeasonalPlots(w,r);if(!plots.length)return;
 const s=r.mvpSeasonalKnowledge??={schemaVersion:1,worldId:w.id,observerId:r.id,nextSequence:1,latest:{},receipts:{}};
 for(const plot of plots){const last=s.receipts[s.latest[plot.target.plotId]];if(last&&isDeepStrictEqual(last.plot,plot))continue;
  if(!Number.isSafeInteger(s.nextSequence+1))bad();const id='seasonal-see:'+s.nextSequence++;
  s.receipts[id]={id,worldId:w.id,observerId:r.id,observedAt:w.minute,observerAt:{...r.at},plot:structuredClone(plot)};s.latest[plot.target.plotId]=id;
 }
}
export function validSeasonalInspect(a:unknown):a is SeasonalInspectAction {return object(a)&&a.type==='mvpInspect'&&(a.station==='seed'||a.station==='kitchen')&&Object.keys(a).every(k=>['type','station','observedTarget'].includes(k));}
export function seasonalInspectPlace(w:World,r:Resident,a:SeasonalInspectAction){
 if(!validSeasonalInspect(a)||w.mode!=='validation'||!w.mvpAgriculture||!hasMvpHamlet(w)||!r.knownBuildings.includes(MVP_HALL)||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return null;
 const building=w.buildings.find(b=>b.id===MVP_HALL&&b.ownerId==='commons'&&b.condition>0);if(!building)return null;
 const layout=roomLayout(w,building),slot=layout.slots.find(s=>s.key===(a.station==='seed'?'mvp-seed':'kitchen')),from=r.inside===building.id?r.roomAt:layout.entry;
 return slot&&from&&roomPath(layout,from,slot.at)!==null?{building,slot}:null;
}
export function seasonalInspectRoute(w:World,r:Resident,a:SeasonalInspectAction){const p=seasonalInspectPlace(w,r,a);return p?{target:{...p.building.door},duration:1}:{target:{...r.at},duration:0,error:'已知公开观察地址当前无法进入'};}
export function completeSeasonalInspect(w:World,r:Resident,a:SeasonalInspectAction):string|null {const p=seasonalInspectPlace(w,r,a);return !p||r.inside!==p.building.id||r.at.x!==p.building.door.x||r.at.y!==p.building.door.y||r.roomAt?.x!==p.slot.at.x||r.roomAt?.y!==p.slot.at.y||!r.activity||r.activity.remaining>1e-9?'尚未实际到达公开观察工位并完成观察':null;}

/** Existing observation receipts are append-only persistent facts. */
export function assertSeasonalKnowledgeAdvance(previous:World,next:World):void {
 for(const old of previous.residents??[]){const a=old.mvpSeasonalKnowledge;if(!a)continue;const b=next.residents.find(r=>r.id===old.id)?.mvpSeasonalKnowledge;
  if(!b||b.nextSequence<a.nextSequence)throw Error('seasonal_knowledge_dependency_downgrade');
  for(const [id,receipt]of Object.entries(a.receipts))if(!isDeepStrictEqual(b.receipts[id],receipt))throw Error('seasonal_knowledge_receipt_changed');
 }
}
