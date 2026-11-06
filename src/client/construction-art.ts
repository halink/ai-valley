import type {ConstructionProject} from '../shared/construction.js';
import {materials as m} from './palette.js';

/** Stakes, masonry and scaffolding describe real stages, using the existing pixel palette. */
export function constructionArt(p:ConstructionProject):HTMLCanvasElement {
 const canvas=document.createElement('canvas');canvas.width=p.width*16;canvas.height=p.height*16+24;
 const c=canvas.getContext('2d')!;c.imageSmoothingEnabled=false;c.translate(0,24);
 const fill=(color:string,x:number,y:number,w:number,h:number)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
 if(p.mode==='terrain'){for(const t of p.terrain?.tiles??[]){const x=(t.at.x-p.at.x)*16,y=(t.at.y-p.at.y)*16;fill(m.postDark,x+2,y+3,3,11);fill(m.postLight,x+2,y+3,2,8);fill(m.gold,x+5,y+4,8,3);if(p.stages[1].startedAt!==null){fill(m.rockShade,x+6,y+10,8,5);fill(m.rockLight,x+7,y+10,6,2);}}return canvas;}
 const phase=p.stages[2].startedAt!==null?3:p.stages[1].startedAt!==null?2:p.stages[0].startedAt!==null?1:0;
 for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
  const gx=p.at.x+x,gy=p.at.y+y;
  // An extension never paints over the occupied original house.
  if(p.base&&gx>=p.base.at.x&&gx<p.base.at.x+p.base.width&&gy>=p.base.at.y&&gy<p.base.at.y+p.base.height)continue;
  const px=x*16,py=y*16,edge=x===0||y===0||x===p.width-1||y===p.height-1;
  fill(m.earth,px,py,16,16);fill(m.earthShade,px+3,py+4,3,1);fill(m.earthLight,px+9,py+11,2,1);
 }
 // Raise walls and posts above the packed-earth floor after painting all the ground.
 for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
  const gx=p.at.x+x,gy=p.at.y+y;
  if(p.base&&gx>=p.base.at.x&&gx<p.base.at.x+p.base.width&&gy>=p.base.at.y&&gy<p.base.at.y+p.base.height)continue;
  const px=x*16,py=y*16,side=x===0||x===p.width-1,end=y===0||y===p.height-1;
  if(phase===0){
   if(end)fill(m.woodLight,px,py+6,16,1);if(side)fill(m.woodLight,px+7,py,1,16);
   if((end&&x%2===0)||(side&&y%2===0)){fill(m.postDark,px+6,py-2,3,16);fill(m.postLight,px+6,py-2,1,13);}continue;
  }
  if(end){fill(m.cliffShade,px,py+4,16,11);fill(m.cliffFace,px+1,py+4,7,3);fill(m.cliffLight,px+9,py+4,6,3);fill(m.cliffFace,px+2,py+9,11,4);}
  else if(side){fill(m.cliffShade,px+4,py,8,16);fill(m.cliffFace,px+5,py+1,6,6);fill(m.cliffLight,px+5,py+9,6,6);}
  if(phase>=2){
   if(end){fill(m.woodShade,px,py-16,16,4);fill(m.woodLight,px,py-16,16,1);}
   if((end&&(x%2===0||x===p.width-1))||(side&&(y%2===0||y===p.height-1))){fill(m.woodShade,px+5,py-18,5,32);fill(m.wood,px+5,py-18,3,30);fill(m.woodLight,px+5,py-18,1,29);}
  }
  if(phase===3&&y<2&&x%3!==2){fill(m.woodShade,px,py-16,16,14);fill(m.wood,px,py-16,16,10);fill(m.woodLight,px+1,py-16,1,10);fill(m.woodLight,px+8,py-16,1,10);}
 }
 return canvas;
}
