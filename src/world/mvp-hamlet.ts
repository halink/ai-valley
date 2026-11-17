import {hasMvpHamlet,MVP_HALL,MVP_HOMES,MVP_RESIDENTS} from '../shared/mvp-hamlet.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import type {Building,Resource,Tile,Vec,World} from '../shared/types.js';
import {adoptMvpDrinking} from './mvp-drinking.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {initialResident} from './seed.js';

const homes=[
 {id:MVP_HOMES.lin,name:'草木居',at:{x:4,y:4},width:5,height:4,residents:['lin']},
 {id:MVP_HOMES.qiao,name:'青瓦斋',at:{x:3,y:14},width:5,height:4,residents:['qiao']},
 {id:MVP_HOMES.couple,name:'梅窗小筑',at:{x:21,y:4},width:5,height:5,residents:['yan','tang']},
];
const footprint=(b:Building,p:Vec)=>p.x>=b.at.x&&p.x<b.at.x+b.width&&p.y>=b.at.y&&p.y<b.at.y+b.height;
const contains=(points:Vec[],p:Vec)=>points.some(point=>same(point,p));

export function assertMvpPopulation(w:World):void {
 const expanded=hasMvpHamlet(w);
 const people=expanded?MVP_RESIDENTS:MVP_RESIDENTS.slice(0,2);
 const roomIds=expanded?[MVP_HALL,...homes.map(h=>h.id)]:[MVP_HALL];
 if(w.residents.length!==people.length||people.some(id=>!w.residents.some(r=>r.id===id))
  ||w.buildings.length!==roomIds.length||roomIds.some(id=>!w.buildings.some(b=>b.id===id)))throw Error('godot_mvp_save_mismatch');
 if(!expanded)return;
 const hall=w.buildings.find(b=>b.id===MVP_HALL)!;
 if(hall.kind!=='lodge'||hall.capacity!==0||hall.ownerId!=='commons'||hall.residents.length)throw Error('godot_mvp_invalid_hamlet');
 for(const home of homes){
  const b=w.buildings.find(b=>b.id===home.id)!;
  const family=home.residents.map(id=>w.residents.find(r=>r.id===id)!);
  const occupants=family.filter(r=>r.status==='alive');
  if(b.kind!=='home'||b.capacity!==home.residents.length||b.residents.length!==occupants.length
   ||family.some(r=>r.homeId!==b.id)||occupants.some(r=>!b.residents.includes(r.id)))throw Error('godot_mvp_invalid_hamlet');
 }
}

export function siteMvpBuilding(w:World,building:Building,reserved:Vec[]):Building {
 const sites=Array.from({length:w.map.width*w.map.height},(_,index)=>({x:index%w.map.width,y:Math.floor(index/w.map.width)}))
  .sort((a,b)=>distance(a,building.at)-distance(b,building.at)||a.y-b.y||a.x-b.x);
 for(const at of sites){
  const door={x:at.x+Math.floor(building.width/2),y:at.y+building.height};
  const b={...building,at,door};
  if(!walkable(w,door)||reserved.some(p=>footprint(b,p))||w.buildings.some(old=>same(old.door,door)))continue;
  const ground=Array.from({length:b.width*b.height},(_,i)=>({x:at.x+i%b.width,y:at.y+Math.floor(i/b.width)}));
  if(ground.some(p=>!walkable(w,p)))continue;
  const candidate={...w,buildings:[...w.buildings,b]};
  if([door,...reserved].some(p=>walkable(w,p)&&findPath(candidate,w.map.entrance,p)===null))continue;
  return b;
 }
 throw Error('godot_mvp_hamlet_site_unavailable');
}

function siteHouse(w:World,spec:typeof homes[number]):Building {
 // Preserve outdoor actors, current destinations, food sources and plantings
 // in a migrated save. Try the designed site first, then a nearby clear plot.
 const reserved=[w.map.entrance,...w.buildings.map(b=>b.door),...w.resources.map(r=>r.at),...w.plots.map(p=>p.at),
  ...w.residents.flatMap(r=>[r.at,...(r.activity?[r.activity.target,...r.activity.path.slice(-1)]:[])])];
 return siteMvpBuilding(w,{...spec,door:spec.at,kind:'home',ownerId:spec.residents[0],capacity:spec.residents.length,definition:'building/home@1',condition:100,
  residents:spec.residents.filter(id=>w.residents.find(r=>r.id===id)?.status!=='dead')},reserved);
}

function paintMap(w:World):void {
 const {width,height}=w.map;
 const tiles:Tile[]=Array.from({length:width*height},(_,i)=>{
  const x=i%width,y=Math.floor(i/width);
  const shore=27+Math.round(1+.9*Math.cos((y-10)*.31));
  if(x===0||x===width-1||y===0||y===height-1)return 'cliff';
  if(x>=shore)return 'water';
  if(x>=shore-1||x===26&&y<7)return 'sand';
  return 'grass';
 });
 w.map={...w.map,tiles,name:'溪湾 · 栖谷'};
 const hall=w.buildings.find(b=>b.id===MVP_HALL)!;
 const square={x:hall.door.x,y:hall.door.y+2};
 const reserved=w.resources.map(r=>r.at);
 const route=(points:Vec[])=>{
  for(let i=1;i<points.length;i++){
   const track=findPath(w,points[i-1],points[i]);
   for(const p of track??[])if(!contains(reserved,p))tiles[p.y*width+p.x]='path';
  }
 };
 route([w.map.entrance,{x:14,y:20},{x:16,y:17},square,hall.door]);
 for(const home of w.buildings.filter(b=>b.id!==MVP_HALL)){
  const side=home.door.x<square.x?-1:1;
  route([home.door,{x:square.x+side*5,y:home.door.y+1},square]);
  if(findPath(w,home.door,square)!==null)route([home.door,square]);
 }
 const spring=w.resources.find(r=>r.kind==='spring');
 if(spring)route([square,{x:20,y:15},{x:spring.at.x-1,y:spring.at.y}]);
 for(const x of [-1,0,1])for(const y of [0,1]){
  const p={x:hall.door.x+x,y:hall.door.y+y};
  if(walkable(w,p))tiles[p.y*width+p.x]='road';
 }
 for(const plot of w.plots)tiles[plot.at.y*width+plot.at.x]='soil';
}

/** Upgrade the two-person courtyard in place. The old hall's door and room
 * grid stay valid for its current occupants and any underway cooking/meal. */
export function expandMvpHamlet(w:World):void {
 assertMvpPopulation(w);
 if(hasMvpHamlet(w))return;
 const hall=w.buildings.find(b=>b.id===MVP_HALL)!;
 for(const spec of homes)w.buildings.push(siteHouse(w,spec));
 hall.name='山居灶堂';
 hall.residents=[];
 hall.capacity=0;
 if(w.rooms)delete w.rooms.beds[hall.id];

 const pairHome=w.buildings.find(b=>b.id===MVP_HOMES.couple)!;
 const yan=initialResident('yan','许砚',32,{...pairHome.door},{hair:0x393936,shirt:0x526963,skin:0xd6a783},['做事稳当','喜欢修整木器','同苏棠共同生活'],{farming:1,building:2,care:0},w.minute);
 const tang=initialResident('tang','苏棠',29,{...pairHome.door},{hair:0x383036,shirt:0xa06c70,skin:0xe7ba9b},['爱收拾住处','喜欢种菜和泡茶','同许砚共同生活'],{farming:2,building:0,care:1},w.minute);
 yan.relations=[{targetId:tang.id,partner:'married',affection:27,trust:34,conflict:0,evidence:[]}];
 tang.relations=[{targetId:yan.id,partner:'married',affection:29,trust:32,conflict:0,evidence:[]}];
 for(const [index,r] of [yan,tang].entries()){
  const entry=roomLayout(w,pairHome).entry;
  r.inside=pairHome.id;
  r.roomAt={x:entry.x+(index===0?-1:1),y:entry.y-2};
  r.knownPeople=[index===0?tang.id:yan.id];
  r.inventory={berry:3,water:1,seed:2};
  r.intention='在梅窗小筑安顿下来';
 }
 w.residents.push(yan,tang);
 for(const [i,r] of [yan,tang].entries()){
  const points=[{x:i===0?18:24,y:i===0?20:18},{x:13+i*3,y:19},{x:12+i*3,y:16}];
  const at=points.find(p=>walkable(w,p)&&!contains([...w.resources,...w.plots].map(o=>o.at),p));
  if(!at)throw Error('godot_mvp_hamlet_garden_unavailable');
  w.plots.push({id:'mvp-garden-'+(i+2),at,ownerId:r.id,crop:null});
 }
 const seeds=[{x:10,y:3},{x:24,y:19},{x:23,y:3},{x:7,y:11},{x:12,y:20}];
 const supplies:Resource[]=seeds.map((at,i)=>({id:'mvp-berry-'+(i+4),kind:'bush',at,amount:18,max:18,regrowthDays:1,lastHarvest:w.minute}));
 for(const bush of supplies)if(walkable(w,bush.at)&&!contains([...w.resources,...w.plots].map(o=>o.at),bush.at))w.resources.push(bush);
 for(const spec of homes)for(const id of spec.residents){
  const r=w.residents.find(p=>p.id===id)!;
  r.homeId=spec.id;
  r.knownBuildings=[...new Set([...r.knownBuildings,spec.id,hall.id])];
  if(id==='yan'||id==='tang')r.knownResources=w.resources.map(s=>s.id);
 }
 paintMap(w);
 for(const resident of w.residents.slice(0,2)){
  const activity=resident.activity;
  if(!activity)continue;
  const sleeping=activity.action.type==='sleep'&&!activity.action.buildingId;
  const destination=sleeping?w.buildings.find(b=>b.id===resident.homeId)!.door:activity.path.at(-1);
  if(!destination||!sleeping&&activity.path.every(p=>walkable(w,p)))continue;
  const path=findPath(w,resident.at,destination);
  if(!path)throw Error('godot_mvp_hamlet_saved_journey_unreachable');
  if(!path[0]||!activity.path[0]||!same(path[0],activity.path[0]))activity.travelProgress=0;
  activity.path=path;
  if(sleeping){
   activity.target={...destination};
   delete activity.mvpBed;
   delete activity.room;
  }
 }
 adoptMvpDrinking(w);
 for(const b of w.buildings)if(findPath(w,w.map.entrance,b.door)===null)throw Error('godot_mvp_hamlet_door_unreachable');
 for(const r of w.residents){
  if(!r.inside)continue;
  const room=roomLayout(w,w.buildings.find(b=>b.id===r.inside)!);
  if(!r.roomAt||roomPath(room,r.roomAt,room.entry)===null)throw Error('godot_mvp_hamlet_room_unreachable');
 }
 assertMvpPopulation(w);
}
