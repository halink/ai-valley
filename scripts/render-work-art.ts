/** Offline, synthetic art sheet. No browser, world store, server or model connection. */
import {writeFileSync} from 'node:fs';
import {createWorld} from '../src/world/seed.js';
import {workPicture} from '../src/client/work-art.js';
import type {PersonFacing,WorkPose} from '../src/client/person-pose.js';
const r=createWorld().residents[0];
const poses:WorkPose[]=['chop','pick','sow','water','harvest','fish','mine','fetch'];
const facings:PersonFacing[]=['east','south','west','north'];
const offsets={east:{x:1,y:0},south:{x:0,y:1},west:{x:-1,y:0},north:{x:0,y:-1}};
const body:string[]=[];
for(let row=0;row<poses.length;row++){
 const pose=poses[row],y=row*144+34;
 body.push(`<text x="12" y="${y+64}" fill="#693127" font-family="sans-serif" font-size="16">${pose}</text>`);
 for(let col=0;col<8;col++){
  const facing=col<4?'east':facings[col-4],frame=col<4?col:2;
  const focus=['sow','water','harvest'].includes(pose)?{x:0,y:0}:offsets[facing];
  const picture=workPicture(r,pose,frame,facing,focus),x=105+col*136;
  body.push(`<g transform="translate(${x} ${y}) scale(2)"><rect width="64" height="64" fill="#78a044"/>`);
  for(const p of picture.marks)body.push(`<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="${p.color}"/>`);
  body.push('</g>');
 }
}
writeFileSync(process.argv[2]??'/tmp/ai-valley-work-actions.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1190" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#f0d9ac"/><text x="105" y="23" fill="#693127" font-family="sans-serif" font-size="15">Phases: prepare / reach / work / recover · Direction study: east / south / west / north · Synthetic static art, not game QA</text>${body.join('')}</svg>`);
