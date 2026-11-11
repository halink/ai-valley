/** Shared integer-pixel primitives for read-only isometric art. */
import type {Vec} from '../shared/types.js';
import type {PixelMark} from './work-art.js';
export type Ink=string|((x:number,y:number)=>string);
export class Pixels {
 marks:PixelMark[]=[];
 rect(color:string,x:number,y:number,width=1,height=1){x=Math.round(x);y=Math.round(y);width=Math.round(width);height=Math.round(height);if(width>0&&height>0)this.marks.push({color,x,y,width,height});}
 line(color:string,a:Vec,b:Vec,size=1){const steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y),1);for(let i=0;i<=steps;i++)this.rect(color,a.x+(b.x-a.x)*i/steps,a.y+(b.y-a.y)*i/steps,size,size);}
 oval(color:string,cx:number,cy:number,rx:number,ry:number){for(let y=-ry;y<=ry;y++){const half=Math.floor(rx*Math.sqrt(Math.max(0,1-(y/ry)**2)));this.rect(color,cx-half,cy+y,half*2+1);}}
 polygon(points:Vec[],ink:Ink,edge?:string){
  const low=Math.floor(Math.min(...points.map(p=>p.y))),high=Math.ceil(Math.max(...points.map(p=>p.y)));
  for(let y=low;y<high;y++){
   const cuts:number[]=[];
   for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a.y<=y+.5&&b.y>y+.5)||(b.y<=y+.5&&a.y>y+.5))cuts.push(a.x+(y+.5-a.y)*(b.x-a.x)/(b.y-a.y));}
   cuts.sort((a,b)=>a-b);
   for(let i=0;i+1<cuts.length;i+=2){let start=Math.ceil(cuts[i]-.5),last='';for(let x=start;x<cuts[i+1]-.5;x++){
    const color=typeof ink==='string'?ink:ink(x,y);if(last&&color!==last){this.rect(last,start,y,x-start);start=x;}last=color;
   }if(last)this.rect(last,start,y,Math.ceil(cuts[i+1]-.5)-start);}
  }
  if(edge)points.forEach((p,i)=>this.line(edge,p,points[(i+1)%points.length]));
 }
}
