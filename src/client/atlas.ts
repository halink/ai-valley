import type {Season, Tile, Vec, World} from '../shared/types.js';
import {FORMAL_REGIONS} from '../shared/formal-regions.js';
import {materials, palette} from './palette.js';

/** A survey of the actual saved terrain. Each overview pixel covers four tiles. */
export class Atlas {
  private terrain=document.createElement('canvas');
  readonly canvas=document.createElement('canvas');
  private key='';
  constructor() {
    this.canvas.setAttribute('aria-label','山谷全图，点选位置移动镜头，下方可按区域定位');
    this.canvas.setAttribute('role','img');
  }

  show(world: World, season: Season, revision:string, at:Vec) {
    const map=world.map;
    const key=[world.id,revision,season,map.width,map.height].join('/');
    const scale=2;
    if (this.key!==key) {
      this.key=key;
      this.terrain.width=this.canvas.width=Math.ceil(map.width/scale);
      this.terrain.height=this.canvas.height=Math.ceil(map.height/scale);
      const ctx=this.terrain.getContext('2d')!;
      const data=ctx.createImageData(this.terrain.width,this.terrain.height);
      const p=palette[season];
      const pigments:Record<Tile,string>={grass:p.grass,path:p.path,road:materials.rockLight,water:p.water,sand:materials.sand,cliff:materials.cliff,soil:materials.earth,bridge:materials.wood};
      const rgba=new Map(Object.entries(pigments).map(([tile,hex])=>[tile,Number.parseInt(hex.slice(1),16)]));
      for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){
        const i=(y*data.width+x)*4;
        const colour=rgba.get(map.tiles[y*scale*map.width+x*scale])!;
        data.data[i]=colour>>16;data.data[i+1]=colour>>8&255;data.data[i+2]=colour&255;data.data[i+3]=255;
      }
      ctx.putImageData(data,0,0);
    }
    const ctx=this.canvas.getContext('2d')!;
    ctx.drawImage(this.terrain,0,0);
    const p=palette[season];
    const resourceColours={tree:p.leafShade,bush:p.dark,rock:materials.rockShade,spring:p.water};
    for(const r of world.resources) {
      if(r.amount<=0)continue;
      ctx.fillStyle=resourceColours[r.kind];
      ctx.fillRect(Math.floor(r.at.x/scale),Math.floor(r.at.y/scale),r.kind==='tree'?2:1,r.kind==='tree'?2:1);
    }
    for (const b of world.buildings) {
      ctx.fillStyle=materials.woodShade;ctx.fillRect(Math.floor(b.at.x/scale),Math.floor(b.at.y/scale),Math.ceil(b.width/scale),Math.ceil(b.height/scale));
    }
    const centerX=Math.round(at.x/scale), centerY=Math.round(at.y/scale);
    ctx.strokeStyle=materials.ink;ctx.lineWidth=3;ctx.strokeRect(centerX-4.5,centerY-4.5,9,9);
    ctx.strokeStyle=materials.gold;ctx.lineWidth=1;ctx.strokeRect(centerX-4.5,centerY-4.5,9,9);
    return this.canvas;
  }

  tileAt(event:MouseEvent, world:World):Vec {
    const rect=this.canvas.getBoundingClientRect();
    return {
      x:Math.min(world.map.width-1,Math.max(0,Math.floor((event.clientX-rect.left)/rect.width*world.map.width))),
      y:Math.min(world.map.height-1,Math.max(0,Math.floor((event.clientY-rect.top)/rect.height*world.map.height))),
    };
  }
}
export function currentRegion(at:Vec) {
  return FORMAL_REGIONS.find(({bounds:b})=>at.x>=b.x && at.x<b.x+b.width && at.y>=b.y && at.y<b.y+b.height)?.name;
}
