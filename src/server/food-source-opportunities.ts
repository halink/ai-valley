import type {FormalOpportunity,Resident,Resource,World} from '../shared/types.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {ageAllowsChoice} from '../world/family.js';
import {movementRate} from '../world/health.js';
import {distance,findPath,reachableTilesFrom} from '../world/navigation.js';
import {berryApproachPath,berryContactEdge,canInspectBerry} from '../world/berry-observation.js';
import {ageYears} from '../world/time.js';

/** A remembered patch is an address, never a remote stock or a reserved meal.
 * Keep one nearest reachable option and one rotating alternative per category. */
export function foodSourceOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||!ageAllowsChoice(ageYears(r.bornAt,w.minute),{type:'move',to:r.at}))return [];
 // Legacy health defaults may be registered by movementRate. Queries must not
 // modify the authoritative definition map while constructing a menu.
 if(!(movementRate({...w,definitions:{...w.definitions}},r)>0))return [];
 if(r.inside){
  const b=w.buildings.find(b=>b.id===r.inside);if(!b)return [];
  const layout=roomLayout(w,b);if(roomPath(layout,r.roomAt??layout.entry,layout.entry)===null)return [];
 }
 const known=new Set(r.knownResources),patches=w.resources.filter(p=>p.kind==='bush'&&known.has(p.id))
  .sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at)||a.id.localeCompare(b.id));
 const visible=(p:Resource)=>canInspectBerry(w,r,p);
 const result:FormalOpportunity[]=[];
 // One failed search activates a per-query connectivity map. A long list of
 // disconnected remembered patches must not each flood the same whole map.
 let reachable:Uint8Array|undefined;
 const canApproach=(p:Resource,inspect:boolean)=>distance(r.at,p.at)<=1&&(inspect||berryContactEdge(w,r.at,p))||[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{
  const x=p.at.x+dx,y=p.at.y+dy;return x>=0&&y>=0&&x<w.map.width&&y<w.map.height&&!!reachable![y*w.map.width+x]&&(inspect||berryContactEdge(w,{x,y},p));
 });
 const select=(candidates:Resource[],inspect:boolean)=>{
  const option=(p:Resource):FormalOpportunity|null=>{
   // Gathering stops beside the patch. Inspecting uses the same real standing
   // tile, so a patch on an impassable tile does not require walking onto it.
   if(reachable&&!canApproach(p,inspect))return null;
   const path=inspect?findPath(w,r.at,p.at,true):berryApproachPath(w,r.at,p);if(path===null){reachable??=reachableTilesFrom(w,r.at);return null;}
   if(inspect)return {id:'foodSource.inspect.'+p.id,label:`去自己记得的浆果地点（${p.at.x},${p.at.y}）旁查看；当前余量和是否再生未知，到场后另行决定是否采集，路况仍会变化`,action:{type:'move',to:{...(path.at(-1)??r.at)}}};
   const quantity=Math.min(3,Math.floor(p.amount));
   return {id:'foodSource.gather.'+p.id,label:`去（${p.at.x},${p.at.y}）采集眼前${quantity}份浆果（劳动${quantity*3}分钟，路程另计）；采后另选进食，余量到场重验`,action:{type:'gather',resourceId:p.id,quantity}};
  };
  let first=-1;
  for(let i=0;i<candidates.length;i++){const choice=option(candidates[i]);if(choice){result.push(choice);first=i;break;}}
  if(first<0)return;
  const remaining=candidates.slice(first+1),offset=Math.floor(w.minute/30)%Math.max(1,remaining.length);
  for(let i=0;i<remaining.length;i++){const choice=option(remaining[(offset+i)%remaining.length]);if(choice){result.push(choice);break;}}
 };
 select(patches.filter(p=>visible(p)&&p.amount>=1),false);
 // Do not inspect amount, last harvest, capacity or future regrowth here.
 select(patches.filter(p=>!visible(p)),true);
 return result;
}
