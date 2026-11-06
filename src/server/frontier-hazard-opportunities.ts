import type {FrontierHazardAction} from '../shared/frontier-hazards.js';
import type {IndustryAction} from '../shared/industry.js';
import type {FormalOpportunity,Resident,Vec,World} from '../shared/types.js';
import {frontierHazardTarget,seenFrontierDangers,usableFrontierShelter,type SeenFrontierDanger} from '../world/frontier-hazards.js';
import {industryTarget} from '../world/industry.js';
import {animalNames} from '../world/livestock-life.js';
import {distance,findPath,walkable} from '../world/navigation.js';

function retreatPoint(w:World,r:Resident,dangers:SeenFrontierDanger[]):Vec|null{
 const offsets=[[12,0],[0,12],[-12,0],[0,-12],[10,10],[10,-10],[-10,10],[-10,-10],[20,0],[0,20],[-20,0],[0,-20]];
 const candidates=offsets.map(([x,y])=>({x:r.at.x+x,y:r.at.y+y}))
  .filter(at=>walkable(w,at)&&dangers.every(d=>distance(at,d.at)>d.radius+2));
 for(const at of candidates){
  const path=findPath(w,r.at,at,false,24);
  if(path&&dangers.every(d=>distance(r.at,d.at)<=d.radius||path.every(step=>distance(step,d.at)>d.radius)))return at;
 }
 return null;
}

export function frontierHazardNotes(w:World,r:Resident):string {
 return seenFrontierDangers(w,r).slice(0,3).map(d=>{
  const at=`（${d.at.x}，${d.at.y}）`;
  const threatened=d.animalId&&w.industry?.animals.find(animal=>animal.id===d.animalId);
  if(threatened)return `你看到${d.label}${at}正在逼近户外的${animalNames[threatened.kind]}。牲畜进畜舍后可避开野兽。`;
  if(d.phase==='nearby')return `你在附近察觉到${d.label}${at}，逼近野兽可能招致袭击。`;
  if(d.phase==='warning')return `你察觉到附近${d.label}的征兆${at}，危险集中在约 ${d.radius} 格范围内。`;
  return `你察觉到附近${d.label}的实际危险${at}。留在危险区可能受伤，伤重时可能致死。`;
 }).join(' ');
}

export function frontierHazardOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!w.frontierHazards||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return [];
 const choices:FormalOpportunity[]=[];
 const offer=(id:string,label:string,action:FrontierHazardAction)=>{
  if(!frontierHazardTarget(w,r,action).error)choices.push({id:`frontier.${id}`,label,action});
 };
 const dangers=seenFrontierDangers(w,r);
 for(const d of dangers){
  const animal=d.animalId&&w.industry?.animals.find(n=>n.id===d.animalId&&n.ownerId===r.id&&n.status==='alive'&&n.at&&distance(n.at,r.at)<=10);
  if(!animal)continue;
  const action:IndustryAction={type:'industry',operation:'moveAnimal',animalId:animal.id,buildingId:animal.barnId};
  if(!industryTarget(w,r,action).error)choices.push({id:`frontier.livestock.${animal.id}`,label:`实际把受${d.label}威胁的${animalNames[animal.kind]}带回畜舍`,action});
 }
 const danger=dangers[0];
 if(danger){
  const shelter=w.buildings.filter(b=>b.id!==r.inside&&distance(r.at,b.door)<=32&&usableFrontierShelter(w,r,b,danger.id))
   .sort((a,b)=>distance(r.at,a.door)-distance(r.at,b.door)).find(b=>findPath(w,r.at,b.door,false,48)!==null);
  if(shelter)offer('shelter',`暂避${danger.label}，沿路到${shelter.name}内遮蔽`,{type:'frontierHazard',operation:'shelter',dangerId:danger.id,buildingId:shelter.id});
  if(!r.inside){
   const at=retreatPoint(w,r,dangers);
   if(at)offer('retreat',`避开${danger.label}，撤到附近（${at.x}，${at.y}）`,{type:'frontierHazard',operation:'retreat',dangerId:danger.id,to:at});
  }
 }
 for(const building of w.buildings.filter(b=>b.condition<=90&&r.knownBuildings.includes(b.id)&&(b.ownerId===r.id||b.ownerId==='commons'))
  .sort((a,b)=>a.condition-b.condition||distance(a.door,r.at)-distance(b.door,r.at)).slice(0,2)){
  offer(`repair.${building.id}`,`到${building.name}修缮损坏（自备 2 木料、1 石料，约 34 游戏分钟）`,{type:'frontierHazard',operation:'repair',buildingId:building.id});
 }
 return choices;
}
