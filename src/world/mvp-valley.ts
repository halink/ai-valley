import {isWideMvpMap,MVP_HALL,MVP_HOMES,WIDE_MVP_MAP,type MvpGardenLayout} from '../shared/mvp-hamlet.js';
import {actionRoom} from '../shared/rooms.js';
import type {Resource,Tile,Vec,World} from '../shared/types.js';
import {assertMvpPopulation,siteMvpBuilding} from './mvp-hamlet.js';
import {berryApproachPath} from './berry-observation.js';
import {distance,findPath,reachableTiles,same,walkable} from './navigation.js';
import {springApproachPath} from './spring-observation.js';

const sites:Record<string,Vec>={
 [MVP_HALL]:{x:18,y:7},
 [MVP_HOMES.lin]:{x:5,y:6},
 [MVP_HOMES.qiao]:{x:9,y:25},
 [MVP_HOMES.couple]:{x:41,y:12},
};
const bridgeRow=19;
const westLanding={x:29,y:bridgeRow},eastLanding={x:39,y:bridgeRow};
const entrance={x:21,y:33};
const offset=(p:Vec,x:number,y:number)=>({x:p.x+x,y:p.y+y});
const around=(p:Vec)=>[-1,0,1].flatMap(x=>[-1,0,1].map(y=>offset(p,x,y)));

const gardenBeds=[{x:0,y:0},{x:4,y:0},{x:0,y:4},{x:4,y:4}];
const orchard:Record<string,Vec>={
 'mvp-berry-0':{x:4,y:14},'mvp-berry-1':{x:6,y:15},'mvp-berry-2':{x:5,y:17},
 'mvp-berry-3':{x:7,y:17},'mvp-berry-4':{x:8,y:14},
 'mvp-berry-5':{x:12,y:19},'mvp-berry-6':{x:14,y:20},'mvp-berry-7':{x:11,y:22},'mvp-berry-8':{x:13,y:22},
 'mvp-east-berry-0':{x:43,y:22},'mvp-east-berry-1':{x:45,y:24},'mvp-east-berry-2':{x:44,y:26},
};
const groveSites:MvpGardenLayout['trees']=[
 {at:{x:3,y:11},kind:'pine'},{at:{x:3,y:15},kind:'deciduous'},{at:{x:5,y:19},kind:'deciduous'},
 {at:{x:11,y:17},kind:'deciduous'},{at:{x:7,y:31},kind:'deciduous'},
 {at:{x:15,y:3},kind:'pine'},{at:{x:17,y:3},kind:'pine'},{at:{x:19,y:3},kind:'pine'},
 {at:{x:25,y:31},kind:'plum'},{at:{x:27,y:30},kind:'plum'},
 {at:{x:46,y:22},kind:'plum'},{at:{x:46,y:26},kind:'plum'},{at:{x:44,y:29},kind:'deciduous'},
];

function terrain():Tile[]{
 const {width,height}=WIDE_MVP_MAP;
 return Array.from({length:width*height},(_,i)=>{
  const x=i%width,y=Math.floor(i/width);
  if(x===0||x===width-1||y===0||y===height-1)return 'cliff';
  const bank=Math.max(y<24?30:28,31+Math.round(2.7*Math.sin((y-2)*.19)));
  const current=bank+(y>23&&y<31?5:4);
  if(x>=bank&&x<current)return y===bridgeRow?'bridge':'water';
  if(x===bank-1||x===current)return 'sand';
  return 'grass';
 });
}

function paintRoads(w:World):void {
 const {tiles,width}=w.map;
 const cell=(p:Vec)=>p.y*width+p.x;
 const planned=w.map.mvpGarden!==undefined;
 const occupied=new Set([...w.resources.map(r=>r.at),...w.plots.flatMap(p=>planned?around(p.at):[p.at])].map(cell));
 const hall=w.buildings.find(b=>b.id===MVP_HALL)!;
 const lin=w.buildings.find(b=>b.id===MVP_HOMES.lin)!;
 const qiao=w.buildings.find(b=>b.id===MVP_HOMES.qiao)!;
 const family=w.buildings.find(b=>b.id===MVP_HOMES.couple)!;
 const commons={x:hall.door.x,y:hall.door.y+2};
 const fork={x:16,y:22};
 const route=(waypoints:Vec[])=>{
  const points=waypoints.filter(p=>walkable(w,p)&&!occupied.has(cell(p)));
  if(!points.length)return;
  tiles[cell(points[0])]='path';
  for(let i=1;i<points.length;i++){
   const path=findPath(w,points[i-1],points[i],false,Infinity,(_from,to)=>!occupied.has(cell(to)));
   for(const p of path??[])if(tiles[cell(p)]!=='bridge')tiles[cell(p)]='path';
  }
 };
 if(planned){
  const first=w.plots.find(p=>p.id==='mvp-garden-0')!.at;
  const head={x:first.x+2,y:first.y-2},foot={x:head.x,y:first.y+6};
  const well=w.resources.find(r=>r.id==='mvp-spring');
  const spring=w.resources.find(r=>r.id==='mvp-spring-east');
  const junction={x:26,y:18};
  route([entrance,{x:20,y:31},foot,head,commons,hall.door]);
  route([lin.door,{x:10,y:12},{x:13,y:13},{x:15,y:16},head]);
  route([qiao.door,{x:14,y:29},{x:16,y:27},foot]);
  route([head,junction,westLanding,eastLanding,{x:41,y:19},family.door]);
  route([westLanding,{x:27,y:23},{x:25,y:27},{x:23,y:32},entrance]);
  route([eastLanding,{x:40,y:21},{x:41,y:25},{x:42,y:28}]);
  if(well)route([commons,{x:well.at.x-1,y:well.at.y}]);
  if(spring)route([{x:40,y:21},{x:spring.at.x,y:spring.at.y-1}]);
 }else{
  route([entrance,{x:18,y:29},fork,{x:19,y:17},commons,hall.door]);
  route([lin.door,{x:10,y:12},{x:14,y:10},{x:14,y:15},commons]);
  route([qiao.door,{x:12,y:31},{x:15,y:28},fork]);
  route([commons,{x:26,y:16},westLanding,eastLanding,{x:40,y:20},family.door]);
  route([westLanding,{x:27,y:23},{x:26,y:29},{x:24,y:32},entrance]);
  route([eastLanding,{x:40,y:23},{x:43,y:25}]);
 }
 const apron=planned?2:1;
 for(let x=-apron;x<=apron;x++)for(let y=0;y<=apron;y++){
  const p={x:hall.door.x+x,y:hall.door.y+y};
  if(walkable(w,p)&&!occupied.has(cell(p)))tiles[cell(p)]='road';
 }
 for(const plot of w.plots)tiles[cell(plot.at)]='soil';
}

/** Plan real plots and sources together, then place trees outside work and travel areas. */
export function layOutMvpGardens(w:World):void {
 if(w.map.mvpGarden?.version===1)return;
 if(!isWideMvpMap(w.map))throw Error('godot_mvp_garden_needs_wide_valley');
 const {width,height}=w.map;
 const cell=(p:Vec)=>p.y*width+p.x;
 const oldPositions=new Map([...w.resources,...w.plots].map(item=>[item.id,item.at]));
 const oldPlotTiles=new Set(w.plots.map(p=>cell(p.at)));
 const soil=terrain();
 const tiles=w.map.tiles.map((tile,i)=>tile==='road'||tile==='path'||tile==='soil'&&oldPlotTiles.has(i)?soil[i]:tile);
 const plan:MvpGardenLayout={version:1,trees:[]};
 w.map={...w.map,tiles,mvpGarden:plan};
 const managedBeds=gardenBeds.map((_,i)=>w.plots.find(p=>p.id==='mvp-garden-'+i));
 if(managedBeds.some(p=>!p))throw Error('godot_mvp_garden_missing_plot');
 const hall=w.buildings.find(b=>b.id===MVP_HALL)!;
 const pavilion=w.buildings.find(b=>b.id===MVP_HOMES.couple)!;
 const water:Record<string,Vec>={'mvp-spring':offset(hall.door,4,2),'mvp-spring-east':{x:40,y:24}};
 const fixed=[entrance,westLanding,eastLanding,...w.buildings.map(b=>b.door),...w.graves.map(g=>g.at),
  ...w.resources.filter(s=>!orchard[s.id]&&!water[s.id]).map(s=>s.at),...w.plots.filter(p=>!managedBeds.includes(p)).map(p=>p.at)];
 const reserved=new Set(fixed.map(cell));
 for(const building of w.buildings)reserved.add(cell(offset(building.door,0,1)));
 for(let x=-2;x<=2;x++)for(let y=0;y<=2;y++)reserved.add(cell(offset(hall.door,x,y)));
 const dry=(p:Vec)=>walkable(w,p)&&!reserved.has(cell(p))&&['grass','path','road'].includes(tiles[cell(p)]);
 const sites=Array.from({length:width*height},(_,i)=>({x:i%width,y:Math.floor(i/width)}));
 const nearest=(to:Vec,clear:(at:Vec)=>boolean)=>sites.filter(clear).sort((a,b)=>distance(a,to)-distance(b,to)||a.y-b.y||a.x-b.x)[0];
 const bedOrigin=nearest({x:18,y:19},p=>p.x>=13&&p.x<=22&&p.y>=17&&p.y<=24&&
  gardenBeds.every(bed=>around(offset(p,bed.x,bed.y)).every(dry)));
 if(!bedOrigin)throw Error('godot_mvp_garden_unavailable');
 for(const [i,plot] of managedBeds.entries()){
  const bed=gardenBeds[i];
  plot!.at=offset(bedOrigin,bed.x,bed.y);
  for(const p of around(plot!.at))reserved.add(cell(p));
 }
 const occupiedByPeople=new Set(w.residents.filter(r=>!r.inside).map(r=>cell(r.at)));
 const activeRoutes=new Set(w.residents.flatMap(r=>[r.at,...(r.activity?[r.activity.target,...r.activity.path]:[]),
  ...(r.plan?.actions.flatMap(a=>a.type==='move'?[a.to]:[])??[])]).map(cell));
 const wellRim=(at:Vec)=>[[0,-1],[1,0],[0,1],[-1,0]].map(([x,y])=>offset(at,x,y))
  .find(p=>dry(p)&&!activeRoutes.has(cell(p)));
 for(const s of w.resources){
  const wanted=water[s.id]??orchard[s.id];
  if(!wanted)continue;
  const east=s.id==='mvp-spring-east'||s.id.startsWith('mvp-east-');
  const clear=(p:Vec)=>dry(p)&&(east?p.x>pavilion.at.x-4&&p.y>=pavilion.door.y+3:p.x<westLanding.x)
   &&(s.kind!=='spring'||!occupiedByPeople.has(cell(p)))&&(s.id!=='mvp-spring'||wellRim(p)!==undefined);
  const at=clear(wanted)?wanted:nearest(wanted,clear);
  if(!at)throw Error('godot_mvp_garden_source_unavailable');
  s.at={...at};reserved.add(cell(at));
  if(s.id==='mvp-spring'){
   // The dry standing tile is the gathering address. The stone shaft is solid.
   plan.well=wellRim(at)!;
   tiles[cell(plan.well)]='cliff';
  }
 }

 for(const i of activeRoutes)reserved.add(i);
 for(const tree of groveSites){
  if(!dry(tree.at))continue;
  tiles[cell(tree.at)]='cliff';
  plan.trees.push({at:{...tree.at},kind:tree.kind});
 }
 paintRoads(w);

 // If a resident was already doing work, retain its elapsed work and re-route
 // to the same plot or water/fruit source at the new address.
 for(const r of w.residents){
  const a=r.activity;
  if(!a)continue;
  const action=a.action;
  const source=action.type==='gather'?w.resources.find(s=>s.id===action.resourceId):undefined;
  const plot=action.type==='plant'||action.type==='water'||action.type==='harvest'?w.plots.find(p=>p.id===action.plotId):undefined;
  const place=source??plot;
  const before=place&&oldPositions.get(place.id);
  if(!place||!before||same(before,place.at))continue;
  const path=source?.kind==='spring'?springApproachPath(w,r.at,source):source?.kind==='bush'?berryApproachPath(w,r.at,source):findPath(w,r.at,place.at);
  if(path===null)throw Error('godot_mvp_garden_work_unreachable');
  a.target={...place.at};
  if(!path[0]||!a.path[0]||!same(path[0],a.path[0]))a.travelProgress=0;
  a.path=path;
 }
 const reachable=reachableTiles(w);
 for(const p of [...w.buildings.map(b=>b.door),...w.resources.map(r=>r.at),...w.plots.map(p=>p.at),...w.residents.map(r=>r.at)]){
  if(!reachable[cell(p)])throw Error('godot_mvp_garden_unreachable');
 }
}

/** Retain the old world, its occupants and their work. Interior coordinates
 * still belong to the same rooms; only their real door anchors move. */
export function widenMvpValley(w:World):void {
 if(isWideMvpMap(w.map))return;
 assertMvpPopulation(w);
 const buildings=w.buildings;
 const journeys=w.residents.map(r=>{
  const activity=r.activity;
  const work=activity&&actionRoom(w,r,activity);
  return {r,activity,at:{...r.at},room:work?.building.id,end:activity?.path.at(-1)};
 });
 const reserves=[entrance,westLanding,eastLanding,...w.resources.map(r=>r.at),...w.plots.map(p=>p.at),...w.graves.map(g=>g.at),
  ...w.residents.flatMap(r=>[...(!r.inside?[r.at]:[]),...(r.activity?[r.activity.target,...r.activity.path.slice(-1)]:[])])];
 w.map={...w.map,...WIDE_MVP_MAP,tiles:terrain(),entrance:{...entrance},name:'长溪 · 栖谷'};
 const east:Resource[]=[
  {id:'mvp-spring-east',kind:'spring',at:{x:42,y:24},amount:10000,max:10000,regrowthDays:1,lastHarvest:w.minute},
  ...[{x:44,y:7},{x:44,y:25},{x:38,y:27}].map((at,index)=>({id:'mvp-east-berry-'+index,kind:'bush' as const,at,amount:14,max:14,regrowthDays:1,lastHarvest:w.minute})),
 ];
 w.resources.push(...east);
 reserves.push(...east.map(r=>r.at));
 w.buildings=[];
 for(const b of buildings){
  const site=sites[b.id];
  if(!site)throw Error('godot_mvp_unknown_valley_building');
  const placed=siteMvpBuilding(w,{...b,at:site},reserves);
  w.buildings.push(placed);
  reserves.push(placed.door);
 }
 const door=(id:string|null)=>w.buildings.find(b=>b.id===id)?.door;
 const hallDoor=door(MVP_HALL)!;
 w.map.settlement={x:hallDoor.x,y:hallDoor.y+1};
 paintRoads(w);

 for(const {r} of journeys){
  if(r.inside)r.at={...door(r.inside)!};
  if(!r.inside&&!walkable(w,r.at))throw Error('godot_mvp_valley_occupied_tile');
 }
 for(const {r,activity,at,room,end} of journeys){
  if(!activity)continue;
  const observed=activity.action.observedTarget;
  if(observed?.inside&&door(observed.inside))observed.at={...door(observed.inside)!};
  const workDoor=room?door(room):undefined;
  if(workDoor){
   activity.target={...workDoor};
   if(activity.action.type==='cook'&&!activity.action.buildingId)activity.action.buildingId=room;
  }else if(!end&&same(activity.target,at))activity.target={...r.at};
  const to=workDoor??end;
  if(!to||!workDoor&&same(at,r.at)&&activity.path.every(p=>walkable(w,p)))continue;
  const path=findPath(w,r.at,to);
  if(!path)throw Error('godot_mvp_valley_saved_route');
  if(!same(at,r.at)||!path[0]||!activity.path[0]||!same(path[0],activity.path[0]))activity.travelProgress=0;
  activity.path=path;
 }
 const reachable=reachableTiles(w);
 for(const p of [...w.buildings.map(b=>b.door),...w.resources.map(r=>r.at),...w.plots.map(p=>p.at),...w.residents.map(r=>r.at)]){
  if(!reachable[p.y*w.map.width+p.x])throw Error('godot_mvp_valley_unreachable');
 }
}
