import {disasterContains} from '../shared/frontier-hazards.js';
import {pastureEdgeOpen,pastureEdgeChecker} from '../shared/pasture-access.js';
import type {Vec, World} from '../shared/types.js';

export const distance = (a:Vec,b:Vec) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export const same = (a:Vec,b:Vec) => a.x===b.x && a.y===b.y;

function inBounds({width,height}:World['map'],{x,y}:Vec) {
  return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<width&&y<height;
}
function solidResource(resource:World['resources'][number]) {
  return (resource.kind==='tree'||resource.kind==='rock') && resource.amount>0;
}
export function walkable(world:World,p:Vec,from?:Vec,checkFence=true):boolean {
  if(!inBounds(world.map,p)||checkFence&&from&&distance(from,p)===1&&!pastureEdgeOpen(world,from,p))return false;
  const tile=world.map.tiles[p.y*world.map.width+p.x];
  if(tile==='water'||tile==='cliff')return false;
  if(world.frontierHazards?.disasters.some(d=>d.kind==='flashFlood'&&d.phase==='active'&&d.footprint&&disasterContains(d,p)&&(!from||!disasterContains(d,from))))return false;
  if(world.infrastructure?.assets.some(a=>a.retiredAt===null&&a.condition<=0&&['bridge','dock'].includes(a.kind)&&a.tiles.some(t=>same(t.at,p))&&(!from||!a.tiles.some(t=>same(t.at,from)))))return false;
  if(world.buildings.some(b=>p.x>=b.at.x&&p.x<b.at.x+b.width&&p.y>=b.at.y&&p.y<b.at.y+b.height))return false;
  if(world.construction?.projects.some(b=>b.reserved&&b.mode!=='terrain'&&p.x>=b.at.x&&p.x<b.at.x+b.width&&p.y>=b.at.y&&p.y<b.at.y+b.height))return false;
  if(world.industry?.mines.some(m=>same(m.at,p)))return false;
  return !world.resources.some(r=>solidResource(r)&&same(r.at,p));
}

// This index has the lifetime of one search. Gathering, growth and construction can all change
// traversability within a single world tick, including while evaluating an uncommitted building.
function obstacleIndex(world:World,start?:Vec) {
  const {width,height}=world.map;
  const blocked=new Uint8Array(width*height);
  for(const d of world.frontierHazards?.disasters??[])if(d.kind==='flashFlood'&&d.phase==='active'&&d.footprint&&(!start||!disasterContains(d,start)))for(const p of d.footprint)blocked[p.y*width+p.x]=1;
  for(const mine of world.industry?.mines??[])blocked[mine.at.y*width+mine.at.x]=1;
  for(const asset of world.infrastructure?.assets??[])if(asset.retiredAt===null&&asset.condition<=0&&['bridge','dock'].includes(asset.kind)&&(!start||!asset.tiles.some(t=>same(t.at,start))))for(const t of asset.tiles)blocked[t.at.y*width+t.at.x]=1;
  for(const resource of world.resources) {
    if(solidResource(resource))blocked[resource.at.y*width+resource.at.x]=1;
  }
  for(const b of [...world.buildings,...(world.construction?.projects.filter(p=>p.reserved&&p.mode!=='terrain')??[])]) {
    for(let y=Math.max(0,b.at.y);y<Math.min(height,b.at.y+b.height);y++){
      blocked.fill(1,y*width+Math.max(0,b.at.x),y*width+Math.min(width,b.at.x+b.width));
    }
  }
  return blocked;
}
const dx=[1,-1,0,0];
const dy=[0,0,1,-1];

/** One flood answers a whole construction proposal's access checks without one search per doorway. */
export function reachableTiles(world:World):Uint8Array {
 const {width,height,tiles,entrance}=world.map,blocked=obstacleIndex(world),seen=new Uint8Array(width*height);
 if(!inBounds(world.map,entrance)||!walkable(world,entrance))return seen;
 const queue=new Uint32Array(width*height),edgeOpen=pastureEdgeChecker(world);let head=0,tail=0;
 const first=entrance.y*width+entrance.x;queue[tail++]=first;seen[first]=1;
 while(head<tail){const index=queue[head++],x=index%width,y=Math.floor(index/width);
  for(let i=0;i<4;i++){const nx=x+dx[i],ny=y+dy[i];if(nx<0||ny<0||nx>=width||ny>=height)continue;
   const next=ny*width+nx;if(seen[next]||blocked[next]||tiles[next]==='water'||tiles[next]==='cliff'||!edgeOpen({x,y},{x:nx,y:ny}))continue;
   seen[next]=1;queue[tail++]=next;
  }
 }
 return seen;
}

/** Unweighted connectivity from an actor's real starting tile. Unlike the
 * construction/entrance query, someone already inside a flood may leave it,
 * and an occupied starting tile does not prevent stepping out. Match findPath
 * transitions, including overlapping flood boundaries and pasture gates. */
export function reachableTilesFrom(world:World,start:Vec):Uint8Array {
 const {width,height,tiles}=world.map,seen=new Uint8Array(width*height);
 if(!inBounds(world.map,start))return seen;
 const blocked=obstacleIndex(world,start),edgeOpen=pastureEdgeChecker(world);
 const floods=(world.frontierHazards?.disasters??[]).filter(d=>d.kind==='flashFlood'&&d.phase==='active'&&d.footprint).map(d=>new Set(d.footprint!.map(p=>p.y*width+p.x)));
 const queue=new Uint32Array(width*height);let head=0,tail=0;
 const first=start.y*width+start.x;queue[tail++]=first;seen[first]=1;
 while(head<tail){const index=queue[head++],x=index%width,y=Math.floor(index/width);
  for(let i=0;i<4;i++){const nx=x+dx[i],ny=y+dy[i];if(nx<0||ny<0||nx>=width||ny>=height)continue;
   const next=ny*width+nx;if(seen[next]||blocked[next]||tiles[next]==='water'||tiles[next]==='cliff'||!edgeOpen({x,y},{x:nx,y:ny})||floods.some(f=>f.has(next)&&!f.has(index)))continue;
   seen[next]=1;queue[tail++]=next;
  }
 }
 return seen;
}

/** A* over four-way unit steps. Integer cost buckets avoid a heap for this Manhattan grid. */
export function findPath(world:World,start:Vec,end:Vec,adjacent=false,maximumSteps=Infinity,canStep?:(from:Vec,to:Vec)=>boolean):Vec[]|null {
  const {map}=world;
  if(!inBounds(map,start)||!inBounds(map,end))return null;
  const reach=adjacent?1:0;
  const initialDistance=distance(start,end);
  if(initialDistance<=reach)return [];
  if(initialDistance-reach>maximumSteps)return null;
  if(!adjacent&&!walkable(world,end,start,false))return null;
  const blocked=obstacleIndex(world,start),edgeOpen=pastureEdgeChecker(world);
  const floods=(world.frontierHazards?.disasters??[]).filter(d=>d.kind==='flashFlood'&&d.phase==='active'&&d.footprint).map(d=>new Set(d.footprint!.map(p=>p.y*map.width+p.x)));
  const {width,height,tiles}=map;
  const startIndex=start.y*width+start.x;
  // Zero is unvisited; other values are path length plus one.
  const costs=new Uint32Array(width*height);
  const directions=new Uint8Array(width*height);
  // Bounded searches measure actual walking steps even where paved roads are faster.
  const scaled=maximumSteps===Infinity&&map.tiles.includes('road'),heuristic=scaled?3:1;
  const pending:number[][]=[];
  costs[startIndex]=1;
  pending[initialDistance*heuristic]=[startIndex];
  for(let estimate=initialDistance*heuristic;estimate<pending.length;estimate++) {
    const bucket=pending[estimate];
    if(!bucket)continue;
    while(bucket.length) {
      const current=bucket.pop()!;
      const x=current%width,y=Math.floor(current/width);
      const remaining=Math.abs(end.x-x)+Math.abs(end.y-y);
      if(costs[current]-1+remaining*heuristic!==estimate)continue; // a shorter approach has since been queued
      if(remaining<=reach) {
        const path:Vec[]=[];
        let step=current;
        while(step!==startIndex){
          path.push({x:step%width,y:Math.floor(step/width)});
          const direction=directions[step];
          step-=dx[direction]+dy[direction]*width;
        }
        return path.reverse();
      }
      for(let dir=0;dir<4;dir++){
        const nx=x+dx[dir],ny=y+dy[dir];
        if(nx<0||ny<0||nx>=width||ny>=height)continue;
        const next=ny*width+nx;
        const cost=costs[current]+(scaled?(tiles[next]==='road'?3:4):1);
        if((costs[next]&&costs[next]<=cost)||blocked[next]||tiles[next]==='water'||tiles[next]==='cliff'||!edgeOpen({x,y},{x:nx,y:ny})||floods.some(f=>f.has(next)&&!f.has(current))||canStep&&!canStep({x,y},{x:nx,y:ny}))continue;
        const remaining=Math.abs(end.x-nx)+Math.abs(end.y-ny);
        if(cost-1+Math.max(0,remaining-reach)>maximumSteps)continue;
        costs[next]=cost;
        directions[next]=dir;
        const score=cost-1+remaining*heuristic;
        (pending[score]??=[]).push(next);
      }
    }
  }
  return null;
}
