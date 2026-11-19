import type {Resource,Vec,World} from '../shared/types.js';
import type {MvpResources} from '../shared/mvp-resources.js';
import {goods} from '../shared/items.js';
import {hasMvpHamlet} from '../shared/mvp-hamlet.js';
import {physiology} from './physiology.js';
import {distance,reachableTiles,same,walkable} from './navigation.js';
import {emitEvent} from './events.js';
import {minuteToClimateUs} from './mvp-climate.js';
const DAY=1440;

interface FruitRenewalSample {
 readonly sourceId:string;
 readonly sourceAt:Readonly<Vec>;
 readonly amountBefore:number;
 readonly amountAfter:number;
 readonly naturallyRenewed:number;
 readonly atUs:string;
}
export interface MvpFruitRenewalWitness extends FruitRenewalSample {
 readonly worldId:string;
 readonly worldRevision:number;
}
const renewalCapture=new WeakMap<World,FruitRenewalSample[]>();
const natural=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const supportedRenewalHead=(w:World)=>w.mode==='validation'&&!Object.hasOwn(w,'simulationOnly')&&
 /^godot-mvp-[A-Za-z0-9_-]{1,180}$/.test(w.id)&&natural(w.revision)&&hasMvpHamlet(w)&&!!w.mvpResources;
function noteNativeFruitRenewal(w:World,r:Resource,before:number,gain:number):void {
 const samples=renewalCapture.get(w);
 if(!samples||r.kind!=='bush'||r.foodItem!=='fruit'||!/^mvp-supply-fruit-[0-9]+$/.test(r.id)||
  w.mvpResources?.addedResourceIds.filter(id=>id===r.id).length!==1||w.resources.filter(source=>source.id===r.id).length!==1||
  !natural(before)||!natural(r.amount)||!natural(gain)||gain===0||r.amount-before!==gain||
  !natural(r.at.x)||!natural(r.at.y)||r.at.x>=w.map.width||r.at.y>=w.map.height)return;
 samples.push(Object.freeze({sourceId:r.id,sourceAt:Object.freeze({x:r.at.x,y:r.at.y}),amountBefore:before,amountAfter:r.amount,
  naturallyRenewed:gain,atUs:minuteToClimateUs(w.minute)}));
}

/** Private scoped capture for one real step. Samples are staged only after the
 * final draft revision is known; the session must deliver only after commit. */
export function captureMvpFruitRenewalStep(w:World,step:()=>void):()=>readonly MvpFruitRenewalWitness[] {
 if(!supportedRenewalHead(w)||renewalCapture.has(w)){step();return ()=>[];}
 const worldId=w.id,previousRevision=w.revision,start=w.minute;
 const samples:FruitRenewalSample[]=[];
 renewalCapture.set(w,samples);
 try{step();}finally{renewalCapture.delete(w);}
 return ()=>{
  if(!samples.length||w.id!==worldId||!supportedRenewalHead(w)||w.minute!==start+1||
   w.revision<=previousRevision||w.mvpResources!.lastMinute!==w.minute||!w.mvpClimate||
   w.mvpClimate.lastMinute!==w.minute)return [];
  const atUs=minuteToClimateUs(w.minute);
  if(w.mvpClimate.lastUs!==atUs||samples.some(sample=>sample.atUs!==atUs))return [];
  const worldRevision=w.revision;
  return Object.freeze(samples.map(sample=>Object.freeze({...sample,worldId,worldRevision})));
 };
}
export function mvpResourceItem(w:World,r:Resource):'berry'|'fruit'|'water'|'wood'|'stone'{
 return r.kind==='bush'?(w.mvpResources&&r.foodItem==='fruit'?'fruit':'berry'):r.kind==='spring'?'water':r.kind==='tree'?'wood':'stone';
}
/** Safety 1.2 / assumed accessible utilisation .8. These are design margins,
 * not measured survival probabilities. Empty plots contribute no food. */
export function mvpResourceBudget(w:World){
 const people=w.residents.filter(r=>r.status==='alive'&&r.residency!=='outside'),n=people.length;
 const foodNeedPerDay=people.reduce((a,r)=>a+physiology(w,r).hungerPerMinute*DAY,0);
 const daily={berry:Math.ceil(foodNeedPerDay*1.2/.8*.6/goods.berry.food),fruit:Math.ceil(foodNeedPerDay*1.2/.8*.4/goods.fruit.food),water:Math.ceil(n*(2+2+1)*1.2/.8),wood:n*12/28,stone:0};
 const initial={berryTarget:Math.ceil(daily.berry*6*1.25),fruit:Math.ceil(daily.fruit*6*1.25),water:Math.ceil(n*(2+2+1)*6*1.25),wood:n*12,stone:n*6,plots:n*2};
 return {population:n,foodNeedPerDay,waterNeedPerDay:n*5,daily,initial};
}
export function validateMvpResources(w:World):void{
 const s=w.mvpResources;if(s===undefined)return;
 if(!hasMvpHamlet(w)||s.version!==1||!Number.isFinite(s.lastMinute)||s.lastMinute>w.minute||s.lastMinute<s.adoptedAt||!Number.isFinite(s.adoptedAt)||s.adoptedAt<0||!Number.isSafeInteger(s.population)||s.population<1||!s.daily||!s.initial||!s.renewal||!Array.isArray(s.addedResourceIds)||!Array.isArray(s.addedPlotIds))throw Error('godot_mvp_invalid_resource_budget');
 if([...Object.values(s.daily),...Object.values(s.initial),s.foodNeedPerDay,s.waterNeedPerDay].some(n=>!Number.isFinite(n)||n<0))throw Error('godot_mvp_invalid_resource_budget');
 for(const [id,p]of Object.entries(s.renewal)){
  const r=w.resources.find(r=>r.id===id);
  if(!r||!Number.isFinite(p.perDay)||p.perDay<0||!Number.isFinite(p.progress)||p.progress<0||p.progress>=1||!Number.isFinite(r.amount)||r.amount<0||r.amount>r.max||!Number.isFinite(r.max)||r.max<=0||r.foodItem!==undefined&&(r.kind!=='bush'||r.foodItem!=='fruit'))throw Error('godot_mvp_invalid_resource_renewal');
 }
 if(s.addedResourceIds.some(id=>!w.resources.some(r=>r.id===id))||s.addedPlotIds.some(id=>!w.plots.some(p=>p.id===id)))throw Error('godot_mvp_missing_resource_addition');
}
function safeSite(w:World,preferred:Vec,field=false):Vec{
 const before=reachableTiles(w),width=w.map.width;
 const protectedPoints=[w.map.entrance,...w.residents.flatMap(r=>[r.at,...(r.activity?[r.activity.target,...r.activity.path]:[]),...(r.plan?.actions.flatMap(a=>a.type==='move'?[a.to]:[])??[])])];
 const candidates:Vec[]=[];
 for(let y=2;y<w.map.height-2;y++)for(let x=2;x<width-2;x++){
  const at={x,y};if(w.map.tiles[y*width+x]!=='grass'||!before[y*width+x])continue;
  if(protectedPoints.some(p=>distance(p,at)<=1)||w.resources.some(r=>distance(r.at,at)<(field?3:2))||w.plots.some(p=>Math.max(Math.abs(p.at.x-x),Math.abs(p.at.y-y))<(field?4:3))||w.map.mvpGarden?.trees.some(t=>distance(t.at,at)<2))continue;
  if(w.buildings.some(b=>x>=b.at.x-2&&x<=b.at.x+b.width+1&&y>=b.at.y-2&&y<=b.at.y+b.height+1))continue;
  if(field&&[-1,0,1].some(dx=>[-1,0,1].some(dy=>w.map.tiles[(y+dy)*width+x+dx]!=='grass'||!walkable(w,{x:x+dx,y:y+dy}))))continue;
  candidates.push(at);
 }
 candidates.sort((a,b)=>distance(a,preferred)-distance(b,preferred)||a.y-b.y||a.x-b.x);
 for(const at of candidates){
  // Model the worst case solid resource: do not sever any previously reachable
  // cell (except the new source itself), not merely the residents' current route.
  const trial={...w,resources:[...w.resources,{id:'placement-probe',kind:'rock' as const,at,amount:1,max:1,regrowthDays:0,lastHarvest:w.minute}]};
  const after=reachableTiles(trial);
  if(before.every((v,i)=>!v||i===at.y*width+at.x||!!after[i]))return at;
 }
 throw Error('godot_mvp_resource_space_unavailable');
}
/** One atomic addition. Existing stocks, crop state, ownership and positions
 * are retained. A fresh, disposable world alone uses the smaller water budget. */
export function adoptMvpResources(w:World,fresh=false):boolean{
 if(!hasMvpHamlet(w)||w.map.mvpGarden?.version!==1)return false;
 validateMvpResources(w);if(w.mvpResources)return false;
 const next=structuredClone(w),budget=mvpResourceBudget(next);
 if(!budget.population)throw Error('godot_mvp_resource_population_empty');
 const s:MvpResources={version:1,adoptedAt:w.minute,lastMinute:w.minute,...budget,renewal:{},addedResourceIds:[],addedPlotIds:[]};
 // Allocate extra empty beds first; their walkable footprint takes precedence.
 for(const r of next.residents.filter(r=>r.status==='alive'&&r.residency!=='outside')){
  const owned=next.plots.filter(p=>p.ownerId===r.id),base=owned[0]?.at??r.at;
  for(let i=owned.length;i<2;i++){
   const id=`mvp-garden-extra-${r.id}-${i}`;
   if(next.plots.some(p=>p.id===id))throw Error('godot_mvp_plot_id_collision');
   const at=safeSite(next,{x:base.x,y:base.y+8},true);
   next.plots.push({id,ownerId:r.id,at,crop:null});s.addedPlotIds.push(id);
  }
 }
 const add=(kind:Resource['kind'],total:number,size:number,zone:Vec,fruit=false)=>{
  for(let index=0,left=total;left>0;index++,left-=size){
   const id=`mvp-supply-${fruit?'fruit':kind}-${index}`;
   if(next.resources.some(r=>r.id===id))throw Error('godot_mvp_resource_id_collision');
   const preferred=fruit?[{x:16,y:15},{x:25,y:29},{x:39,y:7},{x:42,y:28},{x:6,y:23}][index%5]!:{x:zone.x+(index%3)*4,y:zone.y+Math.floor(index/3)*5};
   const at=safeSite(next,preferred),amount=Math.min(size,left);
   next.resources.push({id,kind,at,amount,max:amount,regrowthDays:0,lastHarvest:w.minute,...(fruit?{foodItem:'fruit' as const}:{})});s.addedResourceIds.push(id);
  }
 };
 // Only explicit new finite sites are introduced. Old depleted bushes are not refilled.
 const existingBerryCapacity=next.resources.filter(r=>r.kind==='bush').reduce((a,r)=>a+r.max,0);
 add('bush',Math.max(0,budget.initial.berryTarget-existingBerryCapacity),12,{x:6,y:22});
 add('bush',budget.initial.fruit,12,{x:18,y:29},true);
 add('tree',budget.initial.wood,6,{x:3,y:3});
 add('rock',budget.initial.stone,4,{x:40,y:3});
 if(fresh){const springs=next.resources.filter(r=>r.kind==='spring');springs.forEach((r,i)=>{r.amount=r.max=Math.floor(budget.initial.water/springs.length)+(i<budget.initial.water%springs.length?1:0);});}
 next.mvpResources=s;
 for(const item of ['berry','fruit','water','wood','stone'] as const){
  const sources=next.resources.filter(r=>mvpResourceItem(next,r)===item),capacity=sources.reduce((n,r)=>n+r.max,0);
  for(const r of sources){const perDay=capacity?budget.daily[item]*r.max/capacity:0;s.renewal[r.id]={perDay,progress:0};r.regrowthDays=perDay?r.max/perDay:0;}
 }
 validateMvpResources(next);
 w.resources=next.resources;w.plots=next.plots;w.mvpResources=s;
 emitEvent(w,{kind:'system',actors:[],place:{...w.map.entrance},text:`山谷资源扩充：新增${s.addedResourceIds.length}处有限资源和${s.addedPlotIds.length}块空田；原存量与作物保留。按${budget.population}人需求配置独立自然恢复预算，采集不重置恢复计时；石料不可再生。`});
 return true;
}
/** Fractional credit is saved, physical additions remain whole units. Full
 * sites discard excess growth; stock is never topped up by loading a save. */
export function advanceMvpResources(w:World):void{
 const s=w.mvpResources;if(!s||!hasMvpHamlet(w))return;
 const elapsed=w.minute-s.lastMinute;if(elapsed<=0)return;s.lastMinute=w.minute;
 for(const r of w.resources){
  const p=s.renewal[r.id];if(!p||p.perDay<=0)continue;
  const solid=r.kind==='tree'||r.kind==='rock';
  const occupied=solid&&r.amount===0&&(w.residents.some(actor=>same(actor.at,r.at)||actor.activity&&[actor.activity.target,...actor.activity.path].some(at=>same(at,r.at)))||w.plots.some(plot=>same(plot.at,r.at))||w.buildings.some(b=>r.at.x>=b.at.x&&r.at.x<b.at.x+b.width&&r.at.y>=b.at.y&&r.at.y<b.at.y+b.height));
  if(r.amount>=r.max||occupied){p.progress=0;continue;}
  p.progress+=elapsed*p.perDay/DAY;
  const units=Math.floor(p.progress+1e-10),rest=Math.max(0,p.progress-units);
  const before=r.amount,gain=Math.min(units,r.max-before);r.amount+=gain;p.progress=r.amount>=r.max?0:rest;
  // Observe the actual credited units before any other stock operation can be mistaken for renewal.
  if(gain>0&&renewalCapture.has(w))try{noteNativeFruitRenewal(w,r,before,gain);}catch{/* observation cannot alter renewal */}
 }
}
