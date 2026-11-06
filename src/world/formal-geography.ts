import type {BuildingKind, Resource, Tile, Vec, World} from '../shared/types.js';
import {FORMAL_HEIGHT as height, FORMAL_WIDTH as width} from '../shared/formal-regions.js';

type CivicKind = Exclude<BuildingKind, 'home'>;
interface CivicSite {kind:CivicKind; at:Vec; name:string; id?:string; ownerId?:string}
interface Geography {
  map: World['map'];
  homeSites: Vec[];
  buildSites: Vec[];
  civicSites: CivicSite[];
  plots: Vec[][];
  graveSites: Vec[];
  resources: Resource[];
}

const entrance = {x:2, y:404};
const point = (x:number, y:number):Vec => ({x,y});
const square = (n:number) => n*n;
const index = (x:number,y:number) => y*width+x;
const inside = (x:number,y:number) => x>=0 && y>=0 && x<width && y<height;
function noise(x:number,y:number,seed:number) {
  let n = Math.imul(x+51,374761393) ^ Math.imul(y+83,668265263) ^ seed;
  n = Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}

// The lake feeds one continuous river. Bank width follows the gradient toward the open estuary.
function terrain() {
  const tiles = new Array<Tile>(width*height);
  const north = Array.from({length:width},(_,x)=>12+7*Math.sin(x/21)+4*Math.cos(x/11));
  const coast = Array.from({length:width},(_,x)=>413+12*Math.cos((x-540)/36)-5*Math.sin(x/11));
  for(let y=0;y<height;y++) {
    const river = 438 + 12*Math.sin((y-111)/33) + 9*Math.cos(y/19) + Math.max(0,160-y)*.53;
    const riverWidth = 4.7 + Math.max(0,y-325)*.14;
    const grid = y*width;
    const brook = 128+33*Math.sin(y/67);
    const lakeY = square((y-66)/39);
    for(let x=0;x<width;x++) {
      let tile:Tile = 'grass';
      const northernEdge = y<north[x] || x<3 || x>width-4;
      const ridge = y<130 && square((x-145)/126)+square((y-7)/56)<1.05+.1*Math.sin(x/14);
      const quarry = y<144 && square((x-545)/53)+square((y-103)/15)<1+.1*Math.cos(x/8);
      const terraces = x>465 && square((x-565)/77)+square((y-193)/13)<1+.25*Math.sin(x/13);
      if(northernEdge||ridge||quarry||terraces) tile='cliff';

      const lake = square((x-503)/65)+lakeY + .055*Math.cos(x/8+y/15);
      const riverDistance = Math.abs(x-river);
      const delta = y>337 && Math.abs(x-(river+(y-337)*.64))<2+(y-337)*.045;
      const farmBrook = y>140 && y<328 && Math.abs(x-brook)<1.7+Math.sin(y/20)*.6;
      const pool = square((x-106)/11)+square((y-149)/8);
      const atSea = x>318 && y>coast[x]+Math.max(0,386-x)*1.1;
      const shore = x>310 && y>coast[x]-11+Math.max(0,386-x)*1.1;
      if(lake<1 || (y>=68 && riverDistance<riverWidth) || delta || atSea || farmBrook || pool<1) tile='water';
      else if(lake<1.14 || (y>68 && riverDistance<riverWidth+2) || shore || pool<1.35) tile='sand';
      tiles[grid+x]=tile;
    }
  }
  return tiles;
}

function naturalStocks(seed:number,add:(kind:Resource['kind'],x:number,y:number)=>void) {
  // Sparse stocks on open ground, deeper groves in the woods and mineral beds in the quarry.
  for(let cellY=0;cellY<height;cellY+=8) for(let cellX=0;cellX<width;cellX+=8) {
    const x=cellX+1+Math.floor(noise(cellX,cellY,seed)*6);
    const y=cellY+1+Math.floor(noise(cellX,cellY,seed+1)*6);
    const wooded=(x<324 && (y<144 || y>335));
    const rocky=y<145 && x>405 || x>505 && y>164 && y<215;
    const wave=Math.sin(x/38+y/28)+Math.cos(x/21-y/42);
    const probability=wooded?.54+(wave*.12):rocky?.4:.095+Math.max(0,wave)*.095;
    if(noise(x,y,seed+2)>probability)continue;
    const pick=noise(x,y,seed+3);
    const kind=rocky&&pick<.75?'rock':pick<.16?'bush':'tree';
    add(kind,x,y);
    if(wooded&&wave>0){add(kind,x+2,y-1);if(pick>.58)add(kind,x-1,y+2);}
  }
  for(const [x,y] of [[162,78],[487,96],[155,240],[499,242],[98,389],[522,396]])add('spring',x,y);
}

function stock(kind:Resource['kind'],x:number,y:number,max={tree:9,rock:8,bush:8,spring:600}[kind]):Resource {
  const regrowthDays={tree:28,rock:0,bush:4,spring:1}[kind];
  return {id:`${kind}-${x}-${y}`,kind,at:point(x,y),amount:max,max,regrowthDays,lastHarvest:0};
}

export function createFormalGeography(seed=4107):Geography {
  const tiles=terrain();
  // Reservations keep future private worksites, front doors and the cemetery clear at settlement.
  const reserved = new Uint8Array(width*height);
  const homeSites:Vec[]=[], buildSites:Vec[]=[], plots:Vec[][]=[], graveSites:Vec[]=[];
  const civicSites:CivicSite[]=[], resources:Resource[]=[];
  function mark(x:number,y:number,w:number,h:number,tile?:Tile) {
    for(let row=y;row<y+h;row++) for(let col=x;col<x+w;col++) {
      if(!inside(col,row)) continue;
      const i=index(col,row);
      reserved[i]=1;
      if(tile) tiles[i]=tile;
    }
  }
  function lay(x:number,y:number) {
    if(!inside(x,y)) return;
    const i=index(x,y);
    tiles[i]=tiles[i]==='water'||tiles[i]==='bridge'?'bridge':'path';
  }
  // A connected four-way corridor at each step, including on both banks of a diagonal crossing.
  function trail(points:Vec[],radius=1) {
    let {x,y}=points[0];
    const stamp=()=>{for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++)lay(x+i,y+j);};
    stamp();
    for(const to of points.slice(1)) {
      const dx=Math.abs(to.x-x),dy=Math.abs(to.y-y);
      const sx=Math.sign(to.x-x),sy=Math.sign(to.y-y);
      let error=dx-dy;
      while(x!==to.x||y!==to.y) {
        const twice=error*2;
        if(twice>-dy){error-=dy;x+=sx;stamp();}
        if(twice<dx){error+=dx;y+=sy;stamp();}
      }
    }
  }
  function road(...coords:[number,number][]) {trail(coords.map(([x,y])=>point(x,y)));}
  function addResource(kind:Resource['kind'],x:number,y:number) {
    if(!inside(x,y)) return;
    const i=index(x,y);
    if(reserved[i] || tiles[i]!=='grass') return;
    reserved[i]=1;
    resources.push(stock(kind,x,y));
  }

  // The public routes follow distinct landforms: forest switchbacks, upland shore, field lane, tidal banks.
  road([0,404],[26,404],[49,391],[71,399],[96,394],[122,374],[164,365],[190,340],[214,326],[234,297],[265,284]);
  road([158,238],[176,244],[209,246],[236,235],[252,242],[265,242]);
  road([158,238],[149,215],[142,191],[153,166],[173,146],[170,127],[153,112],[149,96],[164,78]);
  road([164,78],[184,67],[214,79],[233,66],[258,71]);
  road([304,198],[307,176],[335,153],[360,148],[383,133],[410,128],[442,108],[475,101],[491,94],[520,117],[548,121]);
  road([392,242],[411,235],[432,232],[456,232],[476,240],[493,244],[508,241]);
  road([508,241],[532,248],[555,236],[579,245]);
  road([508,241],[509,263],[520,283],[526,306],[535,325],[524,351],[540,370],[535,389],[526,399]);
  road([382,284],[390,317],[405,340],[397,366],[410,386],[443,395],[468,391],[490,401],[510,401],[526,399]);
  road([149,215],[133,215],[113,210],[97,216],[87,240],[95,258],[119,268],[139,256],[158,238]);

  // Back lanes between neighbourhoods stay outside private expansion parcels.
  for(const x of [265,303,348,392]) road([x,198],[x,284]);
  const streets=['白桦','赤杨','莓溪','榛木','钟庭','柳岸','南坡','枫田','松影'];
  for(let row=0;row<3;row++) {
    const laneY=[198,242,284][row];
    road([265,laneY],[392,laneY]);
    for(let col=0;col<3;col++) {
      const hub=[283,326,370][col];
      const group=row*3+col;
      const shifts=[group%2,1,group%3];
      for(let slot=0;slot<3;slot++) {
        const x=hub-16+12*slot, y=laneY-7-shifts[slot];
        const id=homeSites.length;
        homeSites.push(point(x,y));
        mark(x-1,y-1,8,7,'grass');
        trail([point(x+3,y+5),point(x+3,laneY)],0);
        const lot=point(x,y-10);
        buildSites.push(lot);
        mark(lot.x,lot.y,9,7,'grass');
        const familyPlots:Vec[]=[];
        for(const dx of [0,2]) for(const dy of [0,2])familyPlots.push(point(x+dx,laneY+4+dy));
        // Each household holds two real crop plots on the western alluvial benches as well.
        const farmX=151+(id%9)*3, farmY=223+Math.floor(id/9)*5;
        familyPlots.push(point(farmX,farmY),point(farmX+1,farmY+1));
        for(const p of familyPlots)mark(p.x,p.y,1,1,'soil');
        plots.push(familyPlots);
      }
      // Shared rooms can offer care after a resident takes that responsibility. A house alone provides no staff.
      const kind = group%3===1?'clinic':'lodge';
      const site=point(hub-3,laneY+9);
      civicSites.push({kind,at:site,name:streets[group]+(kind==='clinic'?'照护所':'邻舍')});
      mark(site.x-1,site.y-1,10,9,'grass');
      const door=point(site.x+(kind==='clinic'?3:4),site.y+(kind==='clinic'?5:6));
      // Reach the front entrance from the side without drawing a street under the building.
      trail([door,point(hub+8,door.y),point(hub+8,laneY+8),point(hub+6,laneY+8),point(hub+6,laneY)],0);
      addResource('spring',hub-2,laneY+2);
      for(const dx of [-13,-6,0,7,13])addResource('bush',hub+dx,laneY+8);
      for(const dx of [-13,12]){addResource('tree',hub+dx,laneY+12);addResource('rock',hub+dx,laneY+16);}
    }
  }
  const addCivic=(kind:CivicKind,name:string,x:number,y:number,w:number,h:number,streetY:number)=>{
    civicSites.push({kind,name,at:point(x,y)});
    mark(x-1,y-1,w+2,h+2,'grass');
    trail([point(x+Math.floor(w/2),y+h),point(x+Math.floor(w/2),streetY)],0);
  };
  addCivic('workshop','东桥共用工坊',413,222,7,5,234);
  addCivic('greenhouse','西田育苗棚',164,248,7,5,255);
  road([167,255],[158,253],[158,238]);

  // Paths between the grave rows connect directly to the eastern footpath.
  mark(496,224,26,14,'grass');
  road([508,241],[508,236],[496,236]);
  for(let row=0;row<3;row++) {
    for(let col=0;col<8;col++)graveSites.push(point(497+col*3,225+row*3));
    trail([point(496,226+row*3),point(520,226+row*3)],0);
  }
  trail([point(496,226),point(496,236)],0);

  naturalStocks(seed,addResource);
  return {map:{width,height,tiles,name:'溪岚谷',entrance:{...entrance}},homeSites,civicSites,buildSites,plots,graveSites,resources};
}

const frontierSettlement=point(418,236);

/** Three households share a small west-bank clearing. The full watershed stays in its natural state. */
export function createFrontierGeography(seed:number):Geography & {pasture:Vec[];fishingShore:Vec;wellId:string} {
  const tiles=terrain();
  const reserved=new Uint8Array(width*height);
  const resources:Resource[]=[];
  const homeSites=[point(412,225),point(420,224),point(425,234)];
  const buildSites=[point(397,216),point(416,214),point(397,252)];
  const civicSites:CivicSite[]=[
    {kind:'lodge',at:point(405,235),name:'河谷共屋',id:'frontier-hall'},
    {kind:'barn',at:point(414,235),name:'柳岸畜舍',id:'frontier-barn',ownerId:'founder-1-1'},
  ];

  function reserve(x:number,y:number,w:number,h:number,tile?:Tile):Vec[] {
    const cells:Vec[]=[];
    for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){
      const i=index(col,row);
      if(!inside(col,row)||tiles[i]==='water'||tiles[i]==='cliff')throw new Error('Frontier footprint must remain on its own bank');
      reserved[i]=1;
      if(tile)tiles[i]=tile;
      cells.push(point(col,row));
    }
    return cells;
  }
  function path(from:Vec,to:Vec){
    if(from.x!==to.x&&from.y!==to.y)throw new Error('Frontier footpaths need cardinal waypoints');
    reserve(Math.min(from.x,to.x),Math.min(from.y,to.y),Math.abs(to.x-from.x)+1,Math.abs(to.y-from.y)+1,'path');
  }
  function addResource(kind:Resource['kind'],x:number,y:number,max?:number){
    const i=index(x,y);
    if(!inside(x,y)||reserved[i]||tiles[i]!=='grass')return;
    reserved[i]=1;
    resources.push(stock(kind,x,y,max));
  }

  for(const home of homeSites)reserve(home.x,home.y,6,5);
  reserve(405,235,8,6);
  reserve(414,235,7,5);
  for(const lot of buildSites)reserve(lot.x,lot.y,9,7);
  const plots=[reserve(403,228,3,2,'soil'),reserve(416,247,3,2,'soil'),reserve(423,244,3,2,'soil')];
  const pasture=reserve(416,242,6,3);
  const fishingShore=point(433,241);
  const graveSites=[393,396,399].flatMap(x=>[243,246].map(y=>point(x,y)));
  for(const grave of graveSites)reserve(grave.x,grave.y,1,1);

  path(point(403,231),point(432,231));
  path(point(415,230),point(415,231));
  path(point(423,229),point(423,231));
  path(point(432,231),point(432,241));
  path(point(428,239),point(432,239));
  reserve(fishingShore.x,fishingShore.y,1,1); // Leave the walkable sand at the natural fishing shore.
  path(point(403,231),point(403,241));
  path(point(403,241),point(409,241));
  path(point(413,231),point(413,240));
  path(point(413,240),point(417,240));
  const gate=point(3,404);
  path(gate,point(14,404));

  const well=stock('spring',419,233,180);
  reserve(well.at.x,well.at.y,1,1);
  resources.push(well);
  for(const [x,y] of [[410,232],[419,232],[427,232],[430,242],[422,249],[409,246],[403,239],[400,233]])addResource('bush',x,y,6);
  for(const [x,y] of [[391,228],[393,232],[395,235],[397,229],[399,235],[401,226],[405,223]])addResource('tree',x,y);
  for(const [x,y] of [[397,236],[401,232],[411,248],[426,250]])addResource('rock',x,y);
  naturalStocks(seed,addResource);

  return {map:{width,height,tiles,name:'溪岚谷',entrance:gate,settlement:{...frontierSettlement}},
    homeSites,civicSites,buildSites,plots,graveSites,resources,pasture,fishingShore,wellId:well.id};
}
