/** Synthetic composition only. Never open, advance, or write a saved world. */
import {createWorld} from '../src/world/seed.js';
import type {Action,Resident,Tile} from '../src/shared/types.js';
export function isometricStudyFixture(){
 const world=createWorld(5401);world.id='synthetic-isometric-art-study';world.map={width:13,height:12,tiles:Array<Tile>(13*12).fill('grass'),name:'合成等距美术样板',entrance:{x:0,y:6}};
 world.events=[];world.graves=[];world.buildings=[];world.resources=[];world.plots=[];world.clock.paused=true;world.clock.reason='合成静态美术样板，不是运行世界';
 const tile=(x:number,y:number,kind:Tile)=>world.map.tiles[y*13+x]=kind;
 for(let y=0;y<12;y++)for(let x=0;x<13;x++){if(x>=10-(y>7?1:0))tile(x,y,'water');else if(y===6||x===5&&y<7)tile(x,y,'path');}
 world.buildings=[{id:'study-home',kind:'home',name:'样板木屋',at:{x:2,y:2},width:3,height:2,door:{x:3,y:4},ownerId:'commons',definition:'building/home@1',capacity:1,residents:[],condition:100}];
 world.resources=[[1,1],[6,1],[1,8],[0,10],[7,11],[8,3]].map(([x,y],i)=>({id:'study-tree-'+i,kind:'tree',at:{x,y},amount:20,max:20,regrowthDays:8,lastHarvest:0}));
 for(let y=7;y<10;y++)for(let x=5;x<8;x++){tile(x,y,'soil');world.plots.push({id:`study-plot-${x}-${y}`,at:{x,y},ownerId:'commons',crop:x===5&&y===9?null:{definition:'crop/turnip@1',planted:0,growth:((x+y)%3+1)*4/3,wateredDay:y===8?0:-1,lastGrowthDay:0}});}
 const [farmer,fisher,logger]=world.residents.slice(0,3);
 const place=(r:Resident,at:{x:number;y:number},action:Action,target=at)=>{
  r.at=at;r.inside=null;r.roomAt=null;r.regionalLocation=undefined;r.residency='resident';r.status='alive';r.lifeStage='adult';
  r.activity={action,planId:'synthetic-study',startedAt:world.minute,remaining:30,path:[],target,definition:'action/routine@1'};
 };
 place(farmer,{x:6,y:8},{type:'water',plotId:'study-plot-6-8'});
 place(fisher,{x:9,y:5},{type:'industry',operation:'fish',at:{x:9,y:5}});
 place(logger,{x:1,y:9},{type:'gather',resourceId:'study-tree-2',quantity:1},{x:1,y:8});
 world.residents=[farmer,fisher,logger];
 return {world,bounds:{x:0,y:0,width:13,height:12}};
}
/** Display-only phase sheet. Copy the synthetic paused source; never advance or unpause that source. */
export function isometricStudyAnimationFixture(source=isometricStudyFixture()){
 const copy=structuredClone(source);copy.world.clock.paused=false;
 copy.world.clock.reason='离线人工动作样板：仅开启显示相位，不推进模拟或更改原暂停夹具';return copy;
}
