/** CSS-pixel area left unobstructed by observer controls, not a world coordinate. */
export interface ObserverViewArea {x:number;y:number;width:number;height:number;frameWidth:number;frameHeight:number}
export interface ScreenRect {x:number;y:number;width:number;height:number}
/** Largest unoccluded rectangle. Touching edges do not overlap. No usable area means no reframe. */
export function observerViewArea(width:number,height:number,occluders:readonly ScreenRect[]):ObserverViewArea|null {
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
 const blocks=occluders.filter(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0)
 .map(r=>({x:Math.max(0,r.x),y:Math.max(0,r.y),right:Math.min(width,r.x+r.width),bottom:Math.min(height,r.y+r.height)}))
 .filter(r=>r.right>r.x&&r.bottom>r.y);
 const xs=[...new Set([0,width,...blocks.flatMap(r=>[r.x,r.right])])].sort((a,b)=>a-b);
 const ys=[...new Set([0,height,...blocks.flatMap(r=>[r.y,r.bottom])])].sort((a,b)=>a-b);
 let best:ObserverViewArea|null=null;
 for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++)for(let k=0;k<ys.length;k++)for(let l=k+1;l<ys.length;l++){
  const x=xs[i],y=ys[k],w=xs[j]-x,h=ys[l]-y;
  if(w<48||h<48||blocks.some(r=>r.x<xs[j]&&r.right>x&&r.y<ys[l]&&r.bottom>y))continue;
  if(!best||w*h>best.width*best.height)best={x,y,width:w,height:h,frameWidth:width,frameHeight:height};
 }
 return best;
}
/** Phaser centerOn argument; zoom is applied about the full camera centre. */
export function observerCameraCenter(point:{x:number;y:number},area:ObserverViewArea|null,zoom:number):{x:number;y:number}{
 if(!area||!Number.isFinite(zoom)||zoom<=0)return {...point};
 return {x:point.x+(area.frameWidth/2-area.x-area.width/2)/zoom,y:point.y+(area.frameHeight/2-area.y-area.height/2)/zoom};
}
