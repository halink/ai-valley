import {isWorkPose,type PersonPose,type PersonFacing} from './person-pose.js';
import {workPicture} from './work-art.js';
import {roomPicture} from './rooms-art.js';
import type { Building, Resident, Season, Tile, World } from '../shared/types.js';
import type { AnimalKind } from '../shared/industry.js';
import type { WildBeast } from '../shared/frontier-hazards.js';

import { materials, nearestSample, palette, residentColors } from './palette.js';
export { palette } from './palette.js';

export const TILE = 16;
export function cargoCart(){const {canvas,ctx:c}=surface(22,24);rect(c,materials.woodShade,2,20,18,2);rect(c,materials.woodShade,2,7,17,12);rect(c,materials.wood,3,8,15,8);for(const x of [5,14])rect(c,materials.woodLight,x,8,2,11);rect(c,materials.rootLight,4,5,13,3);rect(c,materials.rootLight,5,4,11,1);rect(c,materials.ink,3,20,4,4);rect(c,materials.ink,14,20,4,4);rect(c,materials.rock,4,21,2,2);rect(c,materials.rock,15,21,2,2);return canvas;}
export function hash(x: number, y: number, salt = 0) {
  let value = Math.imul(x + 37, 374761393) ^ Math.imul(y + 113, 668265263) ^ salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function surface(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}
type Ink = CanvasRenderingContext2D;
type Ramp = typeof palette[Season];
function rect(c: Ink, colour: string, x: number, y: number, w: number, h: number) {
  c.fillStyle = colour;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function oval(c: Ink, x: number, y: number, rx: number, ry: number, colour: string) {
  for (let row = -ry; row <= ry; row++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (row / ry) ** 2)));
    rect(c, colour, x - half, y + row, half * 2 + 1, 1);
  }
}
// Small, hard-edged blade clusters follow patches larger than a tile so the turf reads continuously.
function meadow(c: Ink, x: number, y: number, p: Ramp, seed: number, winter: boolean) {
  const px = x * TILE, py = y * TILE;
  const patch = Math.sin(x * .64 + Math.sin(y * .38)) + Math.cos(y * .48 - x * .17);
  const density = winter ? 2 : patch > .35 ? 10 : patch < -.8 ? 3 : 6;
  for (let n = 0; n < density; n++) {
    const dx = Math.floor(hash(x * 17 + n, y, seed) * 15), dy = Math.floor(hash(x, y * 17 + n, seed + 1) * 14);
    const choice = hash(x + n, y - n, seed + 9);
    if (winter) {
      if (choice < .22) { rect(c, p.dark, px + dx, py + dy + 1, 3, 1); rect(c, p.accent, px + dx + 2, py + dy, 2, 1); }
    } else if (choice < .24) {
      rect(c, p.accent, px + dx, py + dy + 2, 4, 1); rect(c, p.dark, px + dx + 1, py + dy + 1, 1, 2);
      rect(c, p.light, px + dx, py + dy, 1, 2); rect(c, p.light, px + dx + 2, py + dy - 1, 1, 2);
    } else {
      rect(c, choice > .7 ? p.light : p.accent, px + dx, py + dy, 2, 1);
      if (choice > .9) rect(c, p.light, px + dx + 1, py + dy - 1, 2, 1);
    }
  }
  if (!winter && patch > .75 && hash(x, y, seed + 54) > .86) {
    const bloom = (dx: number, dy: number) => {
      rect(c, p.dark, px + dx, py + dy + 1, 1, 3); rect(c, p.light, px + dx - 1, py + dy + 2, 1, 1);
      rect(c, p.flower, px + dx - 1, py + dy, 3, 1); rect(c, p.flower, px + dx, py + dy - 1, 1, 3);
      rect(c, materials.gold, px + dx, py + dy, 1, 1);
    };
    bloom(4, 7); bloom(10, 10);
  }
}
function earth(c: Ink, px: number, py: number, p: Ramp, sandy: boolean) {
  for (let n = 0; n < 14; n++) {
    const x = Math.floor(hash(px + n, py, 67) * 15), y = Math.floor(hash(px, py + n, 68) * 15);
    const light = n % 3 !== 0;
    rect(c, light ? (sandy ? materials.sandLight : p.pathLight) : (sandy ? materials.sandShade : p.pathShade), px + x, py + y, n % 4 ? 1 : 3, 1);
  }
}
function tilled(c: Ink, px: number, py: number, wet = false) {
  const loam = wet ? materials.wetEarth : materials.earth;
  rect(c, materials.earthShade, px + 1, py + 1, 14, 13); rect(c, loam, px + 2, py + 1, 12, 12);
  for (let row = 0; row < 3; row++) {
    const x = px + 2 + row % 2, y = py + 3 + row * 4;
    rect(c, materials.furrow, x, y + 1, 4, 1); rect(c, materials.earthShade, x + 4, y, 6, 1);
    rect(c, wet ? materials.earth : materials.earthLight, x + 2, y - 1, 6, 1);
  }
}
function bridge(c: Ink, px: number, py: number, outerTop: boolean, outerBottom: boolean) {
  rect(c, materials.barkShade, px, py, 16, 16);
  for (let n = 0; n < 3; n++) {
    const x = px + n * 5;
    rect(c, materials.wood, x, py + 1, 4, 14); rect(c, materials.woodLight, x, py + 1, 1, 12);
    rect(c, materials.woodShade, x + 2, py + 4 + n, 1, 5);
  }
  if (outerTop) { rect(c, materials.postDark, px, py, 16, 3); rect(c, materials.postLight, px, py, 16, 1); }
  if (outerBottom) { rect(c, materials.postDark, px, py + 13, 16, 3); rect(c, materials.postLight, px, py + 13, 16, 1); }
}
function cliff(c: Ink, x: number, y: number, p: Ramp, hasTurf: boolean) {
  const px = x * TILE, py = y * TILE;
  const ledge = 4 + Math.floor(hash(x, y, 88) * 3);
  rect(c, materials.cliffFace, px, py, 16, ledge); rect(c, materials.cliffLight, px + 1, py + 1, 10, 1);
  rect(c, materials.cliffShade, px, py + ledge, 16, 2); rect(c, materials.cliffInk, px + 10, py + ledge + 2, 3, 3);
  rect(c, materials.cliffShade, px + 6, py + ledge + 5, 4, 2); rect(c, materials.cliffFace, px + 1, py + 11, 5, 3);
  if (hasTurf) { rect(c, p.dark, px, py, 16, 2); rect(c, p.grass, px + 1, py, 9, 1); }
}
function fringe(c: Ink, px: number, py: number, p: Ramp, side: number, bank: boolean) {
  // Along-edge coordinates are global, including over tile joins. Depth never costs a walkable tile.
  for (let u = 0; u < TILE; u++) {
    const along = (side % 2 ? py : px) + u;
    const depth = 1 + Math.round((Math.sin(along * .54) + 1) * .6 + (Math.sin(along * .19) + 1) * .75);
    for (let d = 0; d <= depth; d++) {
      const x = px + (side === 1 ? 15 - d : side === 3 ? d : u);
      const y = py + (side === 0 ? d : side === 2 ? 15 - d : u);
      const colour = bank ? (d === depth ? p.deep : d === depth - 1 ? p.bank : p.pathShade)
        : d === depth ? (u % 5 === 0 ? p.bank : p.dark) : u % 6 < 2 ? p.accent : p.grass;
      rect(c, colour, x, y, 1, 1);
    }
  }
}
export function groundChunk(world: World, season: Season, left: number, top: number, size: number) {
  const { width, height, tiles } = world.map;
  const right = Math.min(left + size, width), bottom = Math.min(top + size, height);
  const {canvas, ctx: c} = surface((right - left) * TILE, (bottom - top) * TILE);
  c.translate(-left * TILE, -top * TILE);
  // Grass and earth marks may extend a pixel beyond a tile. Paint the same
  // neighbours and in the same order on both sides of every chunk boundary.
  const startX = Math.max(0, left - 1), startY = Math.max(0, top - 1);
  const endX = Math.min(width, right + 1), endY = Math.min(height, bottom + 1);
  const p = palette[season], winter = season === 'winter';
  const at = (x: number, y: number): Tile | undefined => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : undefined;
  const base: Record<Tile, string> = { grass: p.grass, path: p.path, road:materials.rockLight, sand: winter ? p.path : materials.sand, water: p.water, cliff: materials.cliff, soil: p.grass, bridge: p.deep };
  for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
    const tile = tiles[y * width + x], px = x * TILE, py = y * TILE;
    rect(c, base[tile], px, py, TILE, TILE);
    switch (tile) {
      case 'grass': meadow(c, x, y, p, world.seed, winter); break;
      case 'road': {rect(c,materials.rockShade,px,py,16,16);for(let row=0;row<4;row++)for(let col=0;col<3;col++)rect(c,(row+col)%2?materials.rock:materials.rockLight,px+col*6-(row%2?2:0),py+row*4,5,3);break;}
      case 'path': case 'sand': earth(c, px, py, p, tile === 'sand' && !winter); break;
      case 'soil': tilled(c, px, py); break;
      case 'cliff': cliff(c, x, y, p, at(x, y - 1) !== 'cliff'); break;
      case 'bridge': bridge(c, px, py, at(x, y - 1) !== 'bridge', at(x, y + 1) !== 'bridge'); break;
      case 'water': {
        const wave = hash(x, y, 20);
        if (wave > .28) { rect(c, p.deep, px + 2, py + 9, 5, 1); rect(c, p.deep, px + 6, py + 8, 6, 1); }
        if (wave > .66) { rect(c, p.foam, px + 3, py + 4, 4, 1); rect(c, p.foam, px + 7, py + 3, 3, 1); }
        break;
      }
    }
  }
  for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
    const tile = at(x, y);
    if (tile !== 'path' && tile !== 'sand' && tile !== 'water') continue;
    const neighbours = [at(x, y - 1), at(x + 1, y), at(x, y + 1), at(x - 1, y)];
    neighbours.forEach((adjacent, side) => {
      if (!adjacent) return;
      const bank = tile === 'water';
      if (bank ? adjacent !== 'water' && adjacent !== 'bridge' : adjacent === 'grass') fringe(c, x * TILE, y * TILE, p, side, bank);
    });
  }
  return canvas;
}
function branch(c: Ink, start: readonly number[], end: readonly number[], colour: string, width = 1) {
  const dx = end[0] - start[0], dy = end[1] - start[1], steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 0; i <= steps; i++) rect(c, colour, start[0] + dx * i / steps, start[1] + dy * i / steps, width, width);
}
export function tree(season: Season, variant = 0, stump = false) {
  const { canvas, ctx: c } = surface(40, 52), p = palette[season];
  oval(c, 22, 47, 14, 3, p.dark);
  if (stump) {
    rect(c, materials.barkShade, 14, 37, 12, 11); oval(c, 20, 37, 6, 3, materials.barkLight);
    rect(c, materials.wood, 16, 37, 6, 1); rect(c, materials.bark, 16, 40, 2, 6);
    return canvas;
  }
  const winter = season === 'winter';
  branch(c, [18, 47], [20, 19], materials.barkShade, 5);
  branch(c, [18, 45], [21, 23], materials.bark, 2); branch(c, [18, 42], [20, 25], materials.barkLight);
  branch(c, [16, 48], [20, 42], materials.barkShade, 2); branch(c, [25, 47], [21, 41], materials.barkShade, 2);
  if (variant % 3 === 0) {
    for (const [cy, rx, height] of [[3, 7, 13], [10, 11, 16], [18, 15, 16], [26, 18, 15]]) {
      for (let y = 0; y < height; y++) {
        const half = Math.floor(rx * y / height);
        const notch = y % 5 === 0 && y > 2 ? 2 : 0;
        rect(c, p.pineInk, 20 - half + notch, cy + y, Math.max(1, half * 2 + 1 - notch), 1);
        if (half < 2) continue;
        rect(c, p.pine, 21 - half + notch, cy + y, Math.max(1, half * 2 - 3 - notch), 1);
        if (y % 4 < 2) rect(c, p.pineLight, 21 - half + notch, cy + y, Math.max(1, half - 1), 1);
        if (winter && y % 6 < 2) rect(c, p.grass, 20 - half + notch, cy + y, Math.max(2, half + 2), 1);
      }
    }
  } else if (winter) {
    const limbs = [[20,32,11,22],[11,22,6,20],[11,22,10,13],[20,25,26,18],[26,18,33,13],[26,18,25,9],[22,24,19,14],[19,14,20,5],[19,14,14,10]];
    for (const [x1,y1,x2,y2] of limbs) {
      branch(c, [x1,y1], [x2,y2], materials.barkShade, 2); branch(c, [x1,y1-1], [x2,y2-1], materials.barkLight);
      if (Math.abs(x1-x2)>3) branch(c, [x1,y1-2], [x2,y2-2], p.dark);
    }
    rect(c,p.grass,11,20,4,1); rect(c,p.grass,26,15,4,1);
  } else {
    const blossom = variant % 3 === 2 && (season === 'spring' || season === 'autumn');
    const body = blossom ? p.blossom : p.leaf, sun = blossom ? p.blossomLight : p.leafLight, shade = blossom ? p.blossomShade : p.leafShade;
    const lobes = [[20,10,9,9],[12,17,8,8],[27,17,9,9],[8,24,7,8],[19,24,11,12],[31,26,7,8],[15,31,10,7],[25,32,9,7]];
    for (const [x,y,rx,ry] of lobes) oval(c,x,y,rx,ry,p.leafInk);
    for (const [x,y,rx,ry] of lobes) {
      oval(c,x,y-1,rx-1,ry-1,shade); oval(c,x-1,y-2,rx-2,ry-3,body);
      for(let j=0;j<4;j++) {
        const dx = Math.floor(hash(x+j,variant,11) * (rx-2)), dy = Math.floor(hash(y,j,33) * (ry-2));
        rect(c,sun,x-dx-1,y-dy-1,3,1); rect(c,sun,x-dx+1,y-dy-2,2,1);
      }
    }
  }
  return canvas;
}
export function resource(kind: string, season: Season, available = true) {
  const {canvas,ctx:c} = surface(24,24), p=palette[season];
  oval(c,12,20,10,2,p.dark);
  if (kind === 'rock') {
    oval(c,12,16,9,5,materials.rockInk); oval(c,11,14,8,6,materials.rockShade);
    oval(c,10,13,6,5,materials.rock); rect(c,materials.rockLight,6,10,7,2); rect(c,materials.rockLight,5,12,3,2);
    rect(c,materials.rockShade,13,13,2,2); rect(c,materials.rockInk,14,15,4,1);
  } else if (kind === 'spring') {
    oval(c,12,15,11,7,materials.rockShade); oval(c,12,13,10,6,materials.rockLight);
    oval(c,12,12,8,4,p.deep); oval(c,12,12,6,3,p.water); rect(c,p.foam,7,11,4,1);
    rect(c,materials.rock,1,16,6,3); rect(c,materials.rock,16,16,6,3);
  } else {
    for(const [x,y,rx,ry] of [[7,15,6,5],[15,15,7,6],[11,10,5,5]]) oval(c,x,y,rx,ry,p.leafInk);
    for(const [x,y,rx,ry] of [[7,14,5,4],[15,14,6,5],[11,9,4,4]]) {
      oval(c,x,y,rx,ry,p.leaf); rect(c,p.leafLight,x-rx+1,y-2,4,1); rect(c,p.leafLight,x-rx+2,y-3,3,1);
    }
    if (available) for(const [x,y] of [[6,12],[14,10],[16,16],[9,18]]) {
      rect(c,materials.berryDark,x,y,3,3); rect(c,materials.berry,x,y,2,2); rect(c,materials.berryLight,x,y,1,1);
    }
    if(season==='winter') {rect(c,p.grass,6,8,7,1); rect(c,p.grass,15,11,5,1);}
  }
  return canvas;
}
export {buildingExterior as house} from './buildings.js';
export function person(r: Resident, frame = 0, pose:PersonPose='idle',facing:PersonFacing='south',focus:{x:number;y:number}|null=null) {
  if(r.status==='dead')return wrappedBody();
  if(isWorkPose(pose)){const picture=workPicture(r,pose,frame,facing,focus),{canvas,ctx}=surface(picture.width,picture.height);for(const p of picture.marks)rect(ctx,p.color,p.x,p.y,p.width,p.height);return canvas;}
  const {canvas,ctx:c} = surface(18,28), {hair,shirt,skin} = residentColors(r.appearance);
  if(pose==='sleep'||pose==='carried'){rect(c,materials.woodShade,0,20,18,6);rect(c,materials.rootLight,0,18,7,6);rect(c,hair,2,17,5,6);rect(c,skin,4,18,4,4);rect(c,pose==='carried'?materials.rockLight:shirt,8,17,10,7);rect(c,materials.ink,5,20,2,1);return canvas;}
  if(pose==='shoreRest'){
    rect(c,materials.woodShade,2,23,15,3);rect(c,materials.rockShade,7,21,9,4);
    rect(c,shirt,4,15,9,8);rect(c,skin,6,10,7,6);rect(c,hair,5,8,9,4);
    rect(c,materials.ink,11,12,1,1);rect(c,skin,12,17,3,4);return canvas;
  }
  const shade = (hex: string, factor: number) => {
    const base = Number.parseInt(hex.slice(1),16);
    const levels = [16,8,0].map(shift=>Math.min(255,Math.round((base >> shift & 255)*factor)).toString(16).padStart(2,'0'));
    return nearestSample('#'+levels.join(''));
  };
  rect(c,materials.rockShade,5,20,8,5);
  rect(c,materials.rockInk,5+frame%2,24,3,2); rect(c,materials.rockInk,10-frame%2,24,3,2);
  rect(c,shirt,4,12,10,10); rect(c,shade(shirt,1.25),5,13,2,6); rect(c,shade(shirt,.68),11,14,3,8);
  rect(c,skin,3,14+frame%2,2,6); rect(c,skin,14,14-frame%2,2,6);
  rect(c,hair,4,2,10,9); rect(c,skin,5,5,8,8); rect(c,hair,4,2,10,4); rect(c,hair,4,5,2,4); rect(c,hair,12,4,2,5);
  rect(c,materials.ink,7,8,1,2); rect(c,materials.ink,11,8,1,2); rect(c,shade(skin,.78),9,11,2,1); rect(c,shade(hair,1.3),5,3,5,1);
  if(pose==='work'){rect(c,skin,13,12-frame*2,3,6);rect(c,materials.woodShade,14,8-frame*3,2,10);rect(c,materials.rockLight,12,6-frame*3,6,3);}
  if(pose==='hunt'){
    const y=16-2*frame;
    rect(c,materials.woodShade,4,y,12,2);rect(c,materials.woodLight,6,y,9,1);
    rect(c,materials.rockShade,14,y-1,4,3);rect(c,materials.rockLight,16,y,2,1);
    rect(c,skin,12,y+1,2,2);
  }
  if(pose==='ill'){rect(c,materials.rootLight,4,12,10,3);rect(c,materials.woodShade,8,10,3,1);}
  if(pose==='celebrate'){rect(c,skin,2,10-frame*2,2,8);rect(c,skin,14,8+frame*2,2,9);rect(c,materials.gold,7,0,2,2);}
  if(r.lifeStage==='elder'){rect(c,materials.rockLight,4,2,10,4);rect(c,materials.woodShade,15,18,1,8);}
  if(r.lifeStage==='infant'){c.clearRect(0,0,18,28);rect(c,materials.woodShade,4,17,10,9);rect(c,materials.rootLight,5,17,8,8);rect(c,skin,6,13,6,5);rect(c,hair,6,13,6,2);rect(c,materials.ink,7,16,1,1);rect(c,materials.ink,10,16,1,1);}
  else if(r.lifeStage==='child'||r.lifeStage==='teen'){const copy=document.createElement('canvas');copy.width=18;copy.height=28;copy.getContext('2d')!.drawImage(canvas,0,0);c.clearRect(0,0,18,28);const h=r.lifeStage==='child'?19:24,ww=r.lifeStage==='child'?14:16;c.drawImage(copy,0,0,18,28,Math.floor((18-ww)/2),28-h,ww,h);}
  return canvas;
}
export function farmSoil(watered:boolean) {
  const {canvas,ctx}=surface(16,16);tilled(ctx,0,0,watered);return canvas;
}
export function crop(progress: number, watered: boolean, output='turnip') {
  const {canvas,ctx:c}=surface(16,20); tilled(c,0,5,watered);
  const stage=Math.min(3,Math.floor(progress*3));
  rect(c,materials.seedlingShade,7,10-stage*2,2,8); rect(c,materials.seedling,3,9-stage*2,5,3); rect(c,materials.seedlingLight,8,8-stage*2,5,3);
  if(stage>0)rect(c,materials.seedlingShade,5,7,7,4);
  if(stage>=2&&output==='grain'){for(const x of [4,8,12]){rect(c,materials.gold,x,3,1,12);for(const y of [3,6,9])rect(c,materials.woodLight,x-1,y,3,2);}return canvas;}
  if(stage>=2&&output==='fiber'){for(const x of [4,8,12]){rect(c,materials.seedling,x,5,1,12);rect(c,palette.spring.foam,x-2,4,5,3);}return canvas;}
  if(stage>=2){rect(c,materials.rootShade,5,11,7,6);rect(c,materials.root,5,11,6,4);rect(c,materials.rootLight,5,11,5,1);rect(c,materials.root,7,17,2,2);}
  return canvas;
}
export function grave(occupied: boolean, condition=100) {
  const {canvas,ctx:c}=surface(18,24);
  if(occupied){rect(c,materials.rockInk,4,6,11,15);rect(c,materials.rock,5,5,9,14);rect(c,materials.rockLight,6,4,7,3);rect(c,materials.rockShade,7,10,5,1);rect(c,materials.rockShade,7,13,5,1);rect(c,materials.gold,2,20,3,2);}
  else {rect(c,materials.rock,3,18,11,3);rect(c,materials.rockLight,4,18,9,1);}
  if(occupied&&condition<75){rect(c,materials.rockShade,5,7,1,8);rect(c,palette.spring.leafShade,4,18,4,3);}
  if(occupied&&condition<50){rect(c,palette.spring.leafShade,2,17,2,5);rect(c,palette.spring.leaf,13,16,2,6);rect(c,materials.ink,9,8,1,5);}
  if(occupied&&condition<25){for(const x of [2,5,12,15]){rect(c,palette.spring.leafShade,x,18,1,5);rect(c,palette.spring.leaf,x-1,19,3,2);}}
  return canvas;
}
/** Interior visual sample; authoritative interiors/furniture are a later content contract. */
export function interior(b:Building,world?:World){
 if(world?.rooms)return roomPicture(world,b);
 const {canvas,ctx:c}=surface(256,208);rect(c,'#240b20',0,0,256,208);rect(c,'#48210c',8,6,240,190);const forestHome=b.id==='home-lin';rect(c,forestHome?'#8adb72':'#c9a56f',12,10,232,44);
 for(let y=14;y<50;y+=8){rect(c,forestHome?'#68a656':'#a85d25',12,y,232,1);rect(c,forestHome?'#8adb72':'#f6d89c',12,y+1,232,1);}
 rect(c,'#612f05',12,50,232,6);rect(c,'#dd722c',12,56,232,136);
 for(let y=56;y<192;y+=12){rect(c,'#8e3f20',12,y,232,1);for(let x=12+(y%24?0:24);x<244;x+=48)rect(c,'#8e3f20',x,y,1,12);rect(c,'#ffae59',13,y+1,230,1);}
 rect(c,'#612f05',10,10,5,183);rect(c,'#612f05',240,10,5,183);rect(c,'#f6d89c',113,188,30,7);
 // Windows
 for(const x of[48,180]){rect(c,'#612f05',x-3,14,31,31);rect(c,'#f6d89c',x-1,15,27,28);rect(c,'#1177b5',x+2,17,21,23);rect(c,'#68d0ed',x+4,19,10,10);rect(c,'#8e3f20',x+12,16,2,26);rect(c,'#8e3f20',x+1,28,24,2);rect(c,'#f6d89c',x-4,13,5,32);rect(c,'#f6d89c',x+25,13,5,32);}
 // Rug, table, stools.
 rect(c,'#612f05',85,93,86,54);rect(c,'#641d34',88,96,80,48);rect(c,'#ffc966',91,99,74,2);rect(c,'#ffc966',91,140,74,2);
 const table=(x:number,y:number)=>{rect(c,'#48210c',x+3,y+16,3,12);rect(c,'#48210c',x+34,y+16,3,12);rect(c,'#48210c',x,y,42,22);rect(c,'#d37434',x+1,y+1,40,17);rect(c,'#ffae59',x+2,y+2,38,2);rect(c,'#a85d25',x+20,y+3,1,14);};table(106,108);
 rect(c,'#f6d89c',116,112,9,6);rect(c,'#3e993e',118,112,4,3);rect(c,'#f6d89c',135,112,6,7);
 for(const [x,y]of[[92,111],[151,111]]){rect(c,'#612f05',x,y,10,16);rect(c,'#d37434',x,y,10,9);rect(c,'#ffae59',x,y,10,2);}
 const bed=(x:number,y:number)=>{rect(c,'#48210c',x-2,y-4,30,5);rect(c,'#612f05',x-2,y,3,44);rect(c,'#612f05',x+25,y,3,44);rect(c,'#f6d89c',x+1,y+1,23,38);rect(c,'#f6d89c',x+3,y+3,19,9);rect(c,'#1177b5',x+1,y+15,23,24);rect(c,'#68d0ed',x+2,y+16,21,3);rect(c,'#612f05',x-2,y+39,30,4);};
 const shelf=(x:number,y:number)=>{rect(c,'#48210c',x,y,39,33);rect(c,'#d37434',x+2,y+2,35,28);for(let row=0;row<2;row++){for(let k=0;k<6;k++)rect(c,['#3e993e','#7f2515','#466584','#c9a56f'][k%4],x+4+k*5,y+4+row*14,4,10);rect(c,'#ffae59',x+1,y+15+row*14,37,2);}};
 if(b.kind==='home'||b.kind==='lodge'||b.kind==='clinic'){bed(25,64);bed(202,64);if(b.kind==='lodge'){bed(25,133);bed(202,133);}}
 if(b.kind==='school'){shelf(22,59);shelf(192,59);table(36,145);table(175,145);}
 if(b.kind==='workshop'){shelf(22,58);rect(c,'#534b4b',184,68,44,20);rect(c,'#8a848a',190,63,30,10);rect(c,'#aaa194',186,60,36,4);rect(c,'#48210c',184,86,6,23);rect(c,'#48210c',222,86,6,23);}
 if(b.kind==='store'){shelf(22,59);shelf(193,59);shelf(22,140);shelf(193,140);}
 // Hearth and books make the shared shelter legible as a living space.
 rect(c,'#534b4b',106,28,46,38);rect(c,'#8a848a',109,29,40,30);rect(c,'#2e272a',117,41,23,19);rect(c,'#d37434',122,50,13,10);rect(c,'#ffc966',127,48,5,11);rect(c,'#c9a56f',104,27,50,4);
 if(b.kind==='home'||b.kind==='lodge')shelf(180,149);
 return canvas;
}

export function orchard(season:Season,mature:boolean,fruit:boolean){const canvas=tree(season,0,!mature),c=canvas.getContext('2d')!;if(!mature){c.clearRect(0,0,canvas.width,canvas.height);rect(c,materials.woodShade,Math.floor(canvas.width/2)-1,canvas.height-18,3,18);oval(c,Math.floor(canvas.width/2),canvas.height-20,10,8,palette[season].leaf);}else if(fruit){for(const [x,y]of [[20,23],[35,18],[28,34],[42,30]]){rect(c,materials.rootShade,x,y,4,4);rect(c,materials.rootLight,x,y,3,2);}}return canvas;}

export function wrappedBody(){const {canvas,ctx:c}=surface(28,14);rect(c,materials.woodShade,1,4,26,9);rect(c,materials.rockLight,2,3,24,9);rect(c,materials.rootLight,3,3,22,2);rect(c,materials.rockShade,10,4,1,8);rect(c,materials.rockShade,20,5,1,6);rect(c,materials.ink,5,5,1,1);return canvas;}
function duck(wild:boolean){
 const {canvas,ctx:c}=surface(28,23),body=wild?'#9b7855':'#fff1c2',wing=wild?'#659195':'#e0b98a',head=wild?'#427765':'#fff4cd';
 rect(c,'#493643',4,12,18,7);rect(c,body,5,11,16,6);rect(c,wing,8,12,10,3);
 rect(c,'#493643',18,6,8,8);rect(c,head,19,5,6,8);rect(c,'#ffb753',24,10,4,2);
 rect(c,'#352836',23,7,1,2);rect(c,'#d88849',10,18,2,3);rect(c,'#d88849',17,18,2,3);
 return canvas;
}
export function animal(kind:AnimalKind){
 if(kind==='duck')return duck(false);
 const cow=kind==='cow',chicken=kind==='chicken',goat=kind==='goat';
 const {canvas,ctx:c}=surface(cow?32:24,24),w=canvas.width,coat=chicken?materials.rootLight:goat?materials.woodLight:'#eee2c0';
 rect(c,materials.ink,3,9,w-6,11);rect(c,coat,4,8,w-8,10);rect(c,coat,w-9,5,7,9);
 rect(c,materials.ink,w-5,7,1,2);rect(c,materials.woodShade,5,18,3,4);rect(c,materials.woodShade,w-9,18,3,4);
 if(chicken){rect(c,materials.rootShade,16,3,5,3);rect(c,materials.gold,21,8,3,2);}
 else if(goat||cow){rect(c,materials.woodShade,w-8,2,2,4);rect(c,materials.woodShade,w-4,2,2,4);}
 if(cow){rect(c,'#4b3a36',7,9,6,5);rect(c,'#4b3a36',17,12,5,6);rect(c,'#dea894',26,12,5,4);}
 if(kind==='sheep')for(const x of [5,10,15])rect(c,'#fff2d1',x,7,4,3);
 return canvas;
}

export function wildAnimal(species:WildBeast['species'],alert:boolean){
 if(species==='duck')return duck(true);
 const {canvas,ctx:c}=surface(34,31);
 const coat=species==='wolf'?'#656976':species==='fox'?'#b65b37':species==='hare'?'#947b64':'#8b5f44';
 const light=species==='wolf'?'#9699ab':species==='fox'?'#e29c60':species==='hare'?'#d2aa86':'#c19466';
 if(species==='hare'){
  rect(c,'#413238',8,17,15,10);rect(c,coat,9,16,12,9);rect(c,light,17,14,7,8);
  rect(c,coat,18,7,2,9);rect(c,coat,22,6,2,10);rect(c,'#332637',21,16,1,2);
  rect(c,'#efe1bd',6,20,4,4);rect(c,'#4e3e39',10,24,5,3);
 }else if(species==='deer'){
  rect(c,'#483432',5,14,23,8);rect(c,coat,6,13,21,7);rect(c,light,20,9,7,10);
  rect(c,coat,24,6,8,7);rect(c,'#3e302e',30,9,2,2);rect(c,light,26,3,2,5);
  rect(c,'#4c3937',8,20,2,9);rect(c,'#4c3937',23,20,2,9);rect(c,'#f2daba',5,14,4,3);
  for(const x of [11,15,19])rect(c,light,x,14,2,2);
 }else{
  rect(c,'#342d35',5,16,21,8);rect(c,coat,6,15,18,7);rect(c,light,9,15,11,2);
  rect(c,coat,21,14,7,7);rect(c,light,26,17,5,4);rect(c,'#332a30',31,17,2,2);
  rect(c,'#3e3432',8,22,3,5);rect(c,'#3e3432',21,22,3,5);rect(c,'#28243a',26,15,1,2);
  if(species==='boar'){rect(c,'#4d352b',6,13,12,3);rect(c,coat,21,12,4,4);rect(c,'#e7ceaa',27,20,2,2);}
  else{
   rect(c,coat,2,17,6,5);rect(c,species==='fox'?'#f4dfb9':coat,0,16,4,4);
   rect(c,light,22,10,2,5);rect(c,light,26,11,2,4);
  }
 }
 if(alert){rect(c,'#553431',23,0,5,8);rect(c,'#ffce66',25,1,1,4);rect(c,'#ffce66',25,6,1,1);}
 return canvas;
}

export function fishShoal(count:number,frame:number,feeding:boolean){
 const {canvas,ctx:c}=surface(30,22),shadow='#204b69',scales=feeding?'#99d7cb':'#6eb7c1';
 c.globalAlpha=.8;
 for(const [i,[x,y]] of [[6,9],[15,15],[21,7]].slice(0,count).entries()){
  const yy=y+((frame+i)%2);
  rect(c,shadow,x-3,yy-1,9,4);rect(c,scales,x-2,yy-1,6,2);
  rect(c,scales,x+4,yy-2,2,1);rect(c,scales,x+4,yy+1,2,1);rect(c,'#e1f2ce',x-2,yy,1,1);
 }
 c.globalAlpha=feeding?.9:.55;
 rect(c,'#a7e4db',frame?3:5,5,frame?10:7,1);
 rect(c,'#93d9e1',frame?12:15,20,frame?13:8,1);
 c.globalAlpha=1;
 return canvas;
}

export function pastureTile(edge:number,grazed:boolean,water:number|null=null){
 const {canvas,ctx:c}=surface(16,16);
 rect(c,grazed?'#aa9349':'#75884b',0,0,16,16);
 for(const [x,y] of [[2,3],[5,10],[10,5],[13,12]]){
  rect(c,grazed?'#c7ab63':'#a9a85f',x,y,2,2);rect(c,grazed?'#8e713e':'#566b3f',x+2,y+1,1,2);
 }
 const rail='#93673f',highlight='#d9ad6a';
 if(edge&1){rect(c,rail,0,0,16,2);rect(c,highlight,2,0,2,3);}
 if(edge&2){rect(c,rail,14,0,2,16);rect(c,highlight,14,3,2,2);}
 if(edge&4){rect(c,rail,0,14,16,2);rect(c,highlight,12,13,2,3);}
 if(edge&8){rect(c,rail,0,0,2,16);rect(c,highlight,0,11,2,2);}
 if(water!==null){rect(c,'#665c4c',4,5,9,6);rect(c,water>0?'#679daa':'#3e4139',5,6,7,3);rect(c,'#b3a386',4,10,9,1);}
 return canvas;
}

export function fishingSign(){
 const {canvas,ctx:c}=surface(16,21);
 rect(c,'#553a33',7,9,3,12);rect(c,'#bf8c55',1,1,14,12);rect(c,'#e9bd77',2,2,12,9);
 rect(c,'#467f84',5,5,6,3);rect(c,'#467f84',4,6,2,1);rect(c,'#467f84',10,4,2,5);rect(c,'#293e47',6,5,1,1);
 return canvas;
}

export function publicWorkSign(kind:string,closed:boolean){const {canvas,ctx:c}=surface(28,28);if(closed){rect(c,materials.woodShade,2,12,24,5);rect(c,materials.rootShade,3,12,22,2);rect(c,materials.gold,6,13,4,3);rect(c,materials.gold,16,13,4,3);rect(c,materials.woodShade,4,17,3,10);rect(c,materials.woodShade,21,17,3,10);}else{rect(c,materials.woodShade,12,7,3,20);rect(c,materials.woodLight,11,2,15,10);rect(c,materials.wood,12,3,13,8);if(kind==='cemetery'){rect(c,materials.rootLight,17,4,2,6);rect(c,materials.rootLight,15,6,6,2);}else {rect(c,materials.ink,15,6,7,2);rect(c,materials.ink,20,4,2,6);}}return canvas;}

export function sharedChest(){const {canvas,ctx:c}=surface(18,16);rect(c,materials.woodShade,1,4,16,11);rect(c,materials.wood,2,5,14,8);rect(c,materials.woodLight,2,3,14,4);rect(c,materials.woodShade,2,7,14,1);rect(c,materials.gold,8,6,3,5);rect(c,materials.ink,9,8,1,2);return canvas;}

export function eventBunting(kind:string){const {canvas,ctx:c}=surface(64,26);rect(c,materials.woodShade,0,2,64,1);const color=kind==='wedding'?palette.spring.blossom:kind==='memorial'?palette.spring.foam:materials.gold;for(let x=4;x<60;x+=10)for(let y=3;y<12;y++)rect(c,color,x+Math.floor((y-3)/2),y,Math.max(1,8-(y-3)),1);if(kind==='memorial'){rect(c,palette.spring.leafShade,25,12,14,10);rect(c,materials.rootLight,30,11,4,6);}return canvas;}

export function ferryBoat(damaged=false){const {canvas,ctx:c}=surface(44,26);rect(c,materials.woodShade,4,17,36,4);rect(c,materials.woodShade,9,21,27,3);rect(c,materials.wood,5,13,35,7);rect(c,materials.woodLight,6,13,32,2);rect(c,materials.woodShade,12,14,20,4);rect(c,materials.woodLight,14,15,14,2);rect(c,materials.woodShade,20,4,2,14);rect(c,damaged?materials.rockShade:palette.spring.foam,22,5,11,8);rect(c,materials.woodLight,33,10,3,2);return canvas;}

export function livestockCrate(){const {canvas,ctx:c}=surface(20,18);rect(c,materials.woodShade,1,5,18,12);rect(c,materials.wood,2,7,16,9);rect(c,materials.woodLight,2,4,16,3);for(const x of [5,9,13])rect(c,materials.ink,x,8,2,6);rect(c,materials.gold,17,9,2,4);return canvas;}
