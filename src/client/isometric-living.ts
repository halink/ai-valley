/** Read-only living-world art. No simulation helpers that initialise or repair records. */
import type {Grave,Vec} from '../shared/types.js';
import type {WildBeast} from '../shared/frontier-hazards.js';
import {beastNames} from '../shared/frontier-hazards.js';
import type {Livestock,FishPool} from '../shared/industry.js';
import {animalActivities,type AnimalActivity} from '../shared/animal-behavior.js';
import {fishNames} from '../shared/fishing-rules.js';
import type {FishSpecies} from '../shared/fish-species.js';
import {Pixels} from './isometric-pixels.js';
import {materials as m} from './palette.js';
import {projectIsometric} from './isometric-projection.js';
import type {PixelMark} from './work-art.js';

export const LIVING_MARK_LIMIT=256;
const livestockNames={chicken:'鸡',goat:'山羊',sheep:'绵羊',duck:'家鸭',cow:'牛'} as const;
const center=(at:Vec)=>projectIsometric({x:at.x+.5,y:at.y+.5});
const point=(at:Vec|undefined):at is Vec=>!!at&&Number.isInteger(at.x)&&Number.isInteger(at.y);
export type GraveState='empty'|'reserved'|'buried';
/** An assigned person is not a burial. Missing/conflicting dates stay explicit. */
export function graveState(g:Grave,minute:number):GraveState|null {
 if(g.personId!==null&&!(typeof g.personId==='string'&&g.personId.length))return null;
 if(g.buriedAt===null)return g.personId||g.reservedBy?'reserved':'empty';
 return g.personId&&Number.isFinite(g.buriedAt)&&g.buriedAt>=0&&g.buriedAt<=minute?'buried':null;
}
export function graveLabel(g:Grave,minute:number):string {
 const state=graveState(g,minute);
 return state==='buried'?'已安葬 · '+g.personId:state==='reserved'?(g.personId?'已登记待葬 · '+g.personId:'预留 · '+g.reservedBy):state==='empty'?'空墓位 · 尚无安葬':'墓位记录不完整或互相冲突 · 不绘制墓碑';
}
export function graveMarks(g:Grave,minute:number):PixelMark[]|null {
 const state=graveState(g,minute);if(!state)return null;
 const c=new Pixels(),p=center(g.at),corners=[[.16,.16],[.84,.16],[.84,.84],[.16,.84]].map(([x,y])=>projectIsometric({x:g.at.x+x,y:g.at.y+y}));
 // A low stone boundary denotes a registered slot, never an invented mound.
 c.polygon(corners,state==='buried'?m.earth:state==='reserved'?m.earthLight:m.earthShade,m.rockShade);
 c.line(m.rockLight,corners[2],corners[3]);
 if(state==='reserved'){c.rect(m.woodShade,p.x-1,p.y-8,2,7);c.rect(m.woodLight,p.x,p.y-7,5,3);}
 if(state==='buried'){
  c.rect(m.rockInk,p.x-5,p.y-15,10,14);c.rect(m.rock,p.x-4,p.y-16,8,14);c.rect(m.rockLight,p.x-3,p.y-17,6,2);
  c.rect(m.rockShade,p.x-2,p.y-11,4);c.rect(m.rockShade,p.x-2,p.y-8,4);
  // Wear is shown only when condition is recorded; no flowers or inscriptions are invented.
  if(Number.isFinite(g.condition)&&g.condition!<40)c.rect(m.rockInk,p.x+1,p.y-14,1,5);
 }
 return c.marks;
}

type Creature='boar'|'wolf'|'deer'|'hare'|'fox'|'wildDuck'|'chicken'|'goat'|'sheep'|'duck'|'cow';
const coat:Record<Creature,[string,string,string]>={
 boar:['#433332','#775247','#a0775c'],wolf:['#38424b','#7e8b91','#b5babb'],deer:['#63402c','#b57c43','#e0b577'],
 hare:['#705846','#b69c75','#e2cf9d'],fox:['#6e3424','#c56432','#f1b66b'],wildDuck:['#303c3c','#735f46','#b3a681'],
 chicken:['#8e643a','#e7cc8a','#fff1c0'],goat:['#584d41','#b49e7c','#e1cdb0'],sheep:['#655a4a','#d1c9b2','#f4edce'],
 duck:['#70623e','#e1d5a2','#fff0c4'],cow:['#524134','#cbb795','#f0e4c6'],
};
/** In-place pose only: targets orient the body, but never move its recorded anchor. */
function creatureMarks(kind:Creature,at:Vec,activity:AnimalActivity|undefined,elapsed:number):PixelMark[] {
 const recorded=activity&&Object.hasOwn(animalActivities,activity.kind)?activity:undefined;
 const c=new Pixels(),p=center(at),[ink,body,light]=coat[kind],target=recorded?.target;
 const delta=point(target)?{x:target.x-at.x,y:target.y-at.y}:null;
 const heading=delta?projectIsometric(delta):null,face=heading&&heading.x<0?-1:1;
 const kindOfActivity=recorded?.kind,resting=kindOfActivity==='rest',distance=delta?Math.abs(delta.x)+Math.abs(delta.y):Infinity;
 const lowering=(kindOfActivity==='forage'||kindOfActivity==='drink')&&distance<=1;
 const travelling=!!delta&&distance>0&&kindOfActivity!=='rest'&&kindOfActivity!=='shelter';
 const frame=Math.floor(Math.max(0,Number.isFinite(elapsed)?elapsed:0)/(kindOfActivity==='flee'?160:260))%4;
 const step=travelling?[0,1,0,-1][frame]:0,headDown=lowering?3+(frame===2?1:0):0;
 const rect=(color:string,x:number,y:number,width=1,height=1)=>c.rect(color,p.x+(face===1?x:-x-width+1),p.y+y,width,height);
 const oval=(color:string,x:number,y:number,rx:number,ry:number)=>c.oval(color,p.x+x*face,p.y+y,rx,ry);
 oval('#365347',0,0,kind==='cow'?13:kind==='hare'?7:10,2);
 if(kind==='chicken'||kind==='duck'||kind==='wildDuck'){
  const duck=kind!=='chicken',low=resting?2:0;
  if(!resting){rect('#b07329',-3,-3+step,2,3-step);rect('#e5a43e',3,-3-step,2,3+step);}
  oval(ink,-1,-7+low,duck?8:6,5);oval(body,-2,-8+low,duck?7:5,4);oval(light,-3,-9+low,4,2);
  rect(ink,5,-13+low+headDown,5,7);rect(kind==='wildDuck'?'#2e7651':body,5,-13+low+headDown,4,6);
  rect(m.ink,7,-11+low+headDown);rect('#dfa33c',9,-9+low+headDown,4,2);
  if(kind==='chicken')rect('#ad4235',5,-15+low+headDown,4,2);
  rect(light,-9,-10+low,3,3);rect(ink,-3,-7+low,5,1);
 }else if(kind==='hare'){
  const low=resting?2:0;oval(ink,-2,-5+low,6,5);oval(body,-3,-6+low,5,4);oval(light,-4,-7+low,3,2);
  oval(ink,4,-8+low+headDown,4,4);oval(body,4,-9+low+headDown,3,3);
  rect(ink,2,-19+low+headDown,2,9);rect(light,3,-18+low+headDown,1,6);rect(ink,6,-18+low+headDown,2,8);
  rect(m.ink,6,-10+low+headDown);oval(light,-8,-5+low,2,2);rect(body,2,-2+step,6,2);rect(light,-4,-1-step,4,2);
 }else{
  const large=kind==='cow',tall=kind==='deer',wide=large?11:kind==='boar'?10:9,low=resting?4:0,leg=tall?8:large?6:5;
  for(const [x,phase] of [[-6,1],[5,-1]]){rect(ink,x,-leg+low,3,Math.max(1,leg-low+phase*step));rect(ink,x+3,-leg+low-1,2,Math.max(1,leg-low-phase*step));}
  oval(ink,0,-leg-4+low,wide,5);oval(body,-1,-leg-5+low,wide-1,4);oval(light,-3,-leg-7+low,Math.max(3,wide-4),2);
  const hy=-leg-9+low+headDown,hx=wide-1;
  if(tall)rect(body,hx-2,hy-5,4,9);
  oval(ink,hx,hy,4,4);oval(body,hx,hy-1,3,3);rect(body,hx+2,hy,4,2);rect(m.ink,hx+1,hy-1);
  rect(ink,hx-2,hy-6,2,4);rect(light,hx+1,hy-5,2,3);
  if(kind==='wolf'||kind==='fox'){
   rect(body,-wide-3,-leg-3+low,5,3);rect(kind==='fox'?light:ink,-wide-5,-leg-4+low,3,3);
   rect(light,hx+2,hy+1,4,2);rect(ink,hx+5,hy);
  }
  if(kind==='boar'){rect(ink,-4,-leg-10+low,9,2);rect('#d4bb93',hx+4,hy+2,2,2);}
  // Horns/antlers are not inferred from sex or age. Species silhouettes suffice.
  if(kind==='goat'){rect(light,hx,hy+3,2,4);rect(ink,hx-1,hy-8,1,3);}
  if(kind==='cow'){rect('#746456',-4,-leg-7+low,5,4);rect('#746456',4,-leg-6+low,4,4);rect('#c49279',hx+2,hy+1,4,2);}
  if(kind==='sheep')for(const x of [-6,-1,4]){oval(light,x,-leg-7+low,3,2);rect(body,x,-leg-3+low,2,2);}
  if(kind==='deer')rect(light,-wide+1,-leg-5+low,3,3);
 }
 return c.marks;
}
function activityLabel(activity:AnimalActivity|undefined){return activity?Object.hasOwn(animalActivities,activity.kind)?animalActivities[activity.kind]:'未支持的活动':'活动未记录';}
export function beastLabel(b:WildBeast){return `${beastNames[b.species]??b.species} · ${activityLabel(b.activity)} · 姿态示意，不表示行为结算`;}
export function livestockLabel(a:Livestock){return `${livestockNames[a.kind]??a.kind} · ${activityLabel(a.activity)} · 姿态示意，不表示产物形成`;}
export const beastArtSupported=(b:WildBeast)=>Object.hasOwn(beastNames,b.species);
export const livestockArtSupported=(a:Livestock)=>Object.hasOwn(livestockNames,a.kind);
export function beastMarks(b:WildBeast,elapsed:number):PixelMark[]|null {
 return beastArtSupported(b)?creatureMarks(b.species==='duck'?'wildDuck':b.species,b.at,b.activity,elapsed):null;
}
export function livestockMarks(a:Livestock,elapsed:number):PixelMark[]|null {
 return a.at&&livestockArtSupported(a)?creatureMarks(a.kind,a.at,a.activity,elapsed):null;
}

const fishColors:Record<FishSpecies,[string,string]>={perch:['#b8b66c','#526e50'],carp:['#d5a252','#81573c'],catfish:['#899baf','#425776'],bream:['#c9cfb9','#829793'],snapper:['#df9990','#985568'],cod:['#aebdb3','#617a84'],crucian:['#dfcc83','#a58c48']};
export interface FishComposition {stocks:Array<{kind:FishSpecies;amount:number}>;reason:string|null;}
export function fishComposition(pool:FishPool):FishComposition {
 if(!Number.isFinite(pool.amount)||pool.amount<0)return {stocks:[],reason:'鱼群总量无有效记录'};
 if(!pool.species)return {stocks:[],reason:pool.amount>0?'仅有水域总量，未登记鱼种':null};
 const stocks:FishComposition['stocks']=[];let total=0;
 for(const [kind,stock] of Object.entries(pool.species)){
  if(!stock||!Number.isFinite(stock.amount)||stock.amount<0)return {stocks:[],reason:'鱼种存量记录无效'};
  total+=stock.amount;if(!stock.amount)continue;
  if(!Object.hasOwn(fishColors,kind))return {stocks:[],reason:'未支持的已登记鱼种：'+kind};
  stocks.push({kind:kind as FishSpecies,amount:stock.amount});
 }
 if(Math.abs(total-pool.amount)>1e-8)return {stocks:[],reason:'分种份量与水域总量不一致，不补造鱼群'};
 stocks.sort((a,b)=>a.kind.localeCompare(b.kind));return {stocks,reason:null};
}
export function fishLabel(pool:FishPool):string {
 const composition=fishComposition(pool),activity=pool.shoal?.activity;
 return `${pool.amount}份 · ${composition.reason??(composition.stocks.map(s=>`${fishNames[s.kind]} ${s.amount}份`).join('、')||'已耗尽')} · ${activity==='resting'?'休息':activity==='evadingFlood'?'躲避洪流':activity==='feeding'?'觅食':'活动未记录'} · 每种一个示意符，共用已记录鱼群位置，不是逐条个体`;
}
/** One glyph per registered positive species, not per fish. All share the original pool ID. */
export function fishMarks(pool:FishPool,elapsed:number,composition=fishComposition(pool)):PixelMark[]|null {
 if(composition.reason||!point(pool.shoal?.at))return null;
 const c=new Pixels(),p=center(pool.shoal.at),active=pool.shoal.activity==='feeding'||pool.shoal.activity==='evadingFlood',phase=!active?0:Math.floor(Math.max(0,Number.isFinite(elapsed)?elapsed:0)/300)%2;
 // Small water lines delimit the shared shoal anchor; an empty pool has no fish silhouette.
 c.rect('#82c2cf',p.x-4,p.y-5,7);c.rect('#347f9a',p.x-5,p.y+4,10);
 const offsets=[[-7,-2],[3,-2],[-2,1],[-9,1],[7,1],[-5,4],[3,4]];
 composition.stocks.forEach((stock,i)=>{
  const [dx,dy]=offsets[i],[light,shade]=fishColors[stock.kind],x=p.x+dx,y=p.y+dy;
  c.rect(shade,x-2,y,5);c.rect(light,x-1,y-1,3);c.rect(shade,x+3,y+phase-1,2,2);c.rect('#244c63',x-2,y);
  if(stock.kind==='catfish')c.rect(shade,x-4,y+1,2);
 });return c.marks;
}
