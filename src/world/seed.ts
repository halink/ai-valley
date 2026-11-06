import type { Building, BuildingKind, Resident, Resource, Tile, World } from '../shared/types.js';
import { startingDefinitions } from './starting-content.js';
import { YEAR } from './time.js';

export function createWorld(seed=4107):World {
 const width=80,height=64,tiles:Tile[]=Array(width*height).fill('grass');
 const set=(x:number,y:number,t:Tile)=>{if(x>=0&&y>=0&&x<width&&y<height)tiles[y*width+x]=t;};
 const get=(x:number,y:number)=>tiles[y*width+x];
 const hash=(x:number,y:number)=>{let n=(x*374761393+y*668265263+seed)|0;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(y<3+Math.floor(Math.sin(x/6)*1.5)||x<2||x>77)set(x,y,'cliff');
  const lake=((x-61)/11)**2+((y-11)/7.5)**2;
  const river=56+Math.sin(y/5.8)*2;
  if(lake<1+0.08*Math.sin(x*1.7+y)||y>14&&Math.abs(x-river)<2.2)set(x,y,'water');
  else if(lake<1.2||y>16&&Math.abs(x-river)<3.2)set(x,y,'sand');
  if(y>58+Math.sin(x/7)*1.5&&x>44)set(x,y,'sand');
 }
 const road=(x0:number,y0:number,x1:number,y1:number)=>{
  let x=x0,y=y0;while(true){for(const [dx,dy] of [[0,0],[1,0],[0,1]]){const t=get(x+dx,y+dy);set(x+dx,y+dy,t==='water'?'bridge':'path');}if(x===x1&&y===y1)break;if(x!==x1)x+=Math.sign(x1-x);else y+=Math.sign(y1-y);}
 };
 road(34,12,34,63);road(12,29,70,29);road(26,26,47,26);road(28,36,34,36);road(34,40,48,40);road(66,29,66,39);road(13,29,13,44);road(27,25,27,29);road(37,25,37,29);road(46,28,46,29);
 const building=(id:string,kind:BuildingKind,name:string,x:number,y:number,w:number,h:number,ownerId:string,residents:string[],capacity:number):Building=>({id,kind,name,at:{x,y},width:w,height:h,door:{x:x+Math.floor(w/2),y:y+h},ownerId,definition:`building/${kind}@1`,capacity,residents,condition:100});
 const buildings:Building[]=[
  building('home-lin','home','榛木小屋',24,20,6,5,'lin',['lin'],2),
  building('home-qiao','home','蓝窗小屋',34,20,6,5,'qiao',['qiao'],2),
  building('home-shen','home','石榴小屋',25,31,6,5,'shen',['shen'],2),
  building('lodge','lodge','溪畔会馆',42,22,8,6,'commons',[],4),
  building('workshop','workshop','共用工坊',44,35,7,5,'commons',[],0),
 ];
 for(const b of buildings)for(let y=b.at.y;y<b.at.y+b.height;y++)for(let x=b.at.x;x<b.at.x+b.width;x++)set(x,y,'grass');
 const plots:World['plots']=[];
 for(let y=33;y<=38;y+=2)for(let x=16;x<=22;x+=2){set(x,y,'soil');plots.push({id:`plot-${x}-${y}`,at:{x,y},ownerId:x<20?'lin':'qiao',crop:null});}
 const occupied=(x:number,y:number)=>buildings.some(b=>x>=b.at.x-1&&x<=b.at.x+b.width&&y>=b.at.y-1&&y<=b.at.y+b.height+1)||plots.some(p=>Math.abs(p.at.x-x)<=1&&Math.abs(p.at.y-y)<=1);
 const resources:Resource[]=[];
 for(let y=5;y<57;y++)for(let x=4;x<76;x++){
  if(get(x,y)!=='grass'||occupied(x,y)||x>62&&y>30&&y<42)continue;
  const outer=x<11||y<17||x>68||y>47,noise=hash(x,y);
  if(outer&&noise<0.12||!outer&&noise<0.012){resources.push({id:`tree-${x}-${y}`,kind:'tree',at:{x,y},amount:8,max:8,regrowthDays:28,lastHarvest:0});}
  else if(noise>0.975){resources.push({id:`rock-${x}-${y}`,kind:'rock',at:{x,y},amount:6,max:6,regrowthDays:0,lastHarvest:0});}
  else if(noise>0.94&&noise<0.965){resources.push({id:`bush-${x}-${y}`,kind:'bush',at:{x,y},amount:5,max:5,regrowthDays:4,lastHarvest:0});}
 }
 for(const [x,y]of [[21,27],[31,28],[39,32],[17,40]])resources.push({id:`berry-${x}-${y}`,kind:'bush',at:{x,y},amount:6,max:6,regrowthDays:4,lastHarvest:0});
 resources.push({id:'spring',kind:'spring',at:{x:51,y:28},amount:10000,max:10000,regrowthDays:1,lastHarvest:0});
 const makePerson=(id:string,name:string,age:number,x:number,y:number,hair:number,shirt:number,traits:string[],skills:Resident['skills']):Resident=>({
  id,name,appearance:{hair,shirt,skin:0xe7b88a},at:{x,y},inside:null,bornAt:480-age*YEAR,status:'alive',residency:'resident',homeId:`home-${id}`,traits,hunger:22,energy:90,health:100,inventory:{berry:6,seed:5,water:3,wood:4,stone:2},coins:30,skills,
  relations:[],memories:[],knownPeople:['lin','qiao','shen'].filter(p=>p!==id),knownResources:resources.filter(r=>Math.hypot(r.at.x-x,r.at.y-y)<18).map(r=>r.id),knownBuildings:buildings.map(b=>b.id),plan:null,activity:null,intention:'正在观察新居周围',revision:0,decisionDue:480,lastDecisionAt:-1,lastFailure:null,parents:[],guardianIds:[],pregnancy:null,canDecide:true,canExpress:true,refusesCare:false,deathAt:null,
 });
 const defs=startingDefinitions([{ownerId:'lin',x:10,y:32,width:14,height:15},{ownerId:'qiao',x:39,y:33,width:14,height:15},{ownerId:'shen',x:21,y:31,width:12,height:16}]);
 const world:World={schemaVersion:1,id:`valley-validation-${seed}`,revision:0,seed,mode:'validation',minute:480,lastWallAt:0,clock:{paused:true,reason:'正在等待首次自主决定',realMinutesPerDay:120},weather:'sun',map:{width,height,tiles,name:'溪岚谷',entrance:{x:34,y:62}},buildings,resources,plots,
  graves:Array.from({length:8},(_,i)=>({id:`grave-${i+1}`,at:{x:64+(i%4)*2,y:34+Math.floor(i/4)*3},personId:null,buriedAt:null})),
  residents:[makePerson('lin','林禾',24,27,27,0x53362f,0xb95e43,['喜欢亲手种植','谨慎使用储粮','对新邻居好奇'],{farming:2,building:0,care:0}),makePerson('qiao','乔笙',39,37,27,0x3a2c2b,0x4c8194,['重视独立生活','善于修理','愿意倾听'],{farming:0,building:2,care:0}),makePerson('shen','沈秋',63,31,36,0xa5a08b,0x867c49,['珍惜安静与友谊','喜欢烹饪','熟悉简单照护'],{farming:1,building:0,care:2})],events:[],offers:[],proposals:[],estates:[],processed:[],definitions:defs,activeDefinitions:Object.fromEntries(Object.keys(defs).map(k=>[k.split('@')[0],k])),metrics:{requests:0,successes:0,failures:0,inputTokens:0,outputTokens:0,lastLatencyMs:0,lastError:null,inFlight:[],model:'THUDM/GLM-Z1-9B-0414',configured:false}};
 return world;
}
