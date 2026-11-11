import {initializeWildlifePopulation,recordWildlifeExit,reviewWildlifePopulation} from './wildlife-population.js';
import {disasterContains} from '../shared/frontier-hazards.js';
import {fishNames} from '../shared/fishing-rules.js';
import {beastNames,type FrontierHazardState,type WildBeast,type WildFoodPatch} from '../shared/frontier-hazards.js';
import type {Livestock} from '../shared/industry.js';
import type {Resident,Vec,World} from '../shared/types.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {aboardFerry} from './ferry.js';
import {canObserve} from './knowledge.js';
import {animalNames,recordLivestockDeath} from './livestock-life.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {calendar,DAY,YEAR} from './time.js';
import type {AnimalActivity} from '../shared/animal-behavior.js';
import {availableWildFishAt,fishingKey,waterAtShore,wildFishAt} from './fishing.js';
import {advancePredatorDisease,initializePredatorEcology,isPredator,predatorFoodPatch,recordPredatorDeath,reviewPredatorEcology,stepPredatorMigration} from './predator-ecology.js';

const directions:Vec[]=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
const neighbors=(at:Vec)=>directions.map(d=>({x:at.x+d.x,y:at.y+d.y}));
type Species=WildBeast['species'];
interface SpeciesRules {
 startHunger:number;hungerMinutes:number;forageRelief:number;patch:WildFoodPatch['kind'];capacity:number;
 starvingRaid:number;raidRange:number;years:number;nocturnal:boolean;population:number;
 prey:Species[];danger:number;speed:number;
}
const animalRules:Record<Species,SpeciesRules>={
 boar:{startHunger:30,hungerMinutes:45,forageRelief:24,patch:'roots',capacity:6,starvingRaid:86,raidRange:32,years:8,nocturnal:false,population:2,prey:[],danger:26,speed:8},
 wolf:{startHunger:44,hungerMinutes:42,forageRelief:37,patch:'smallGame',capacity:5,starvingRaid:68,raidRange:50,years:6,nocturnal:true,population:1,prey:['deer','hare','duck'],danger:30,speed:8},
 deer:{startHunger:28,hungerMinutes:55,forageRelief:25,patch:'browse',capacity:22,starvingRaid:Infinity,raidRange:0,years:12,nocturnal:false,population:3,prey:[],danger:0,speed:8},
 hare:{startHunger:32,hungerMinutes:56,forageRelief:21,patch:'seeds',capacity:22,starvingRaid:Infinity,raidRange:0,years:5,nocturnal:true,population:4,prey:[],danger:0,speed:6},
 fox:{startHunger:39,hungerMinutes:61,forageRelief:34,patch:'smallGame',capacity:6,starvingRaid:75,raidRange:24,years:7,nocturnal:true,population:1,prey:['hare','duck'],danger:0,speed:7},
 duck:{startHunger:26,hungerMinutes:64,forageRelief:25,patch:'seeds',capacity:12,starvingRaid:Infinity,raidRange:0,years:7,nocturnal:false,population:2,prey:[],danger:0,speed:8},
};
const species=Object.keys(animalRules) as Species[];
const bound=(value:number)=>Math.max(0,Math.min(100,value));
export const wildlifeThreatensPeople=(animal:WildBeast)=>animalRules[animal.species].danger>0;
type Threats={warn:(person:Resident,text:string,at:Vec,radius:number,beastId:string)=>void;injure:(person:Resident,damage:number,source:string)=>void;notify:(person:Resident,text:string)=>void};

export function createWildBeast(w:World,species:WildBeast['species'],id:string,den:Vec):WildBeast {
 return {id,species,at:{...den},den:{...den},nextMoveAt:w.minute+5,cooldownUntil:w.minute+25,
  health:100,hunger:animalRules[species].startHunger,thirst:20,energy:85,bornAt:w.minute-YEAR,status:'alive',
  activity:{kind:'roam',reason:'熟悉领地',target:{...den}}};
}

function habitat(w:World,state:FrontierHazardState,kind:Species):Vec {
 const {woodland,shore}=state;
 const [x,y]=({boar:[-12,15],wolf:[-8,-8],deer:[-8,20],hare:[7,18],fox:[-1,17],duck:[0,8]} as const)[kind];
 const anchor=kind==='duck'&&shore?shore:woodland;
 return {x:Math.max(1,Math.min(w.map.width-2,anchor.x+x)),y:Math.max(1,Math.min(w.map.height-2,anchor.y+y))};
}

function landNear(w:World,anchor:Vec,accept:(at:Vec)=>boolean){
 for(let gap=0;gap<=8;gap++)for(let dy=-gap;dy<=gap;dy++){
  const dx=gap-Math.abs(dy);
  for(const x of dx?[anchor.x-dx,anchor.x+dx]:[anchor.x]){
   const at={x,y:anchor.y+dy};if(walkable(w,at)&&accept(at))return at;
  }
 }
 return null;
}

function registerHabitat(w:World,state:FrontierHazardState,kind:Species,fresh=false):void {
 const id='habitat:'+kind;
 if(state.foodPatches.some(p=>p.id===id))return;
 const anchor=kind==='boar'||kind==='wolf'?state.beasts.find(b=>b.species===kind)?.den??habitat(w,state,kind):habitat(w,state,kind);
 const at=landNear(w,{x:anchor.x+1,y:anchor.y},cell=>!state.foodPatches.some(p=>same(p.at,cell)));
 if(!at)return;
 const rules=animalRules[kind];
 state.foodPatches.push({id,kind:rules.patch,at,amount:rules.patch==='smallGame'&&!fresh?0:rules.capacity,capacity:rules.capacity,progress:0});
}

/** Add habitat and wildlife once. Old individuals, alerts, depleted food and casualties survive upgrades. */
export function initializeWildlife(w:World,state:FrontierHazardState,fresh=false):void {
 state.nextBeastSerial??=1;
 state.totals.livestockAttacks??=0;state.totals.livestockKilled??=0;state.totals.wildlifeDeaths??=0;state.totals.hunted??=0;
 for(const beast of state.beasts){
  beast.health??=100;beast.hunger??=animalRules[beast.species].startHunger;beast.bornAt??=w.minute-YEAR;beast.status??='alive';
  beast.thirst??=20;beast.energy??=85;beast.sex??='female';
  if(alive(beast))beast.activity??={kind:'roam',reason:'熟悉领地',target:{...beast.den}};
 }
 state.foodPatches??=[];
 if(state.ecologyVersion===1){
  if(!state.foodPatches.length)for(const kind of species)registerHabitat(w,state,kind,fresh);
  initializePredatorEcology(w,state,createWildBeast,fresh);initializeWildlifePopulation(w,state);
  return;
 }
 for(const kind of species){
  const existing=state.beasts.filter(b=>b.species===kind);
  for(let i=existing.length;i<animalRules[kind].population;i++){
   if(!fresh)break;
   const den=landNear(w,habitat(w,state,kind),at=>!state.beasts.some(b=>same(b.den,at)));
   if(!den)break;
   const beast=createWildBeast(w,kind,`beast:${kind}:founding-${i+1}`,den);
   beast.sex=i%2?'male':'female';beast.hunger=bound(beast.hunger+i*4);beast.nextMoveAt+=i%4;
   state.beasts.push(beast);
  }
  registerHabitat(w,state,kind,fresh);
 }
 state.ecologyVersion=1;
 initializePredatorEcology(w,state,createWildBeast,fresh);initializeWildlifePopulation(w,state);
}

const alive=(beast:WildBeast)=>beast.status!=='dead';
const exposedResident=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&!r.inside&&!aboardFerry(w,r.id);
const exposedAnimal=(n:Livestock):n is Livestock&{at:Vec}=>n.status==='alive'&&!!n.at&&!n.inside&&!n.carrierId;
function reach(w:World,from:Vec,to:Vec,radius:number):boolean {
 const gap=distance(from,to);
 if(gap>radius)return false;
 return gap===0||gap===1&&walkable(w,to,from)||gap>1&&findPath(w,from,to,false,radius)!==null;
}

export function wildlifeVisible(w:World,r:Resident,beast:WildBeast):boolean {
 return alive(beast)&&exposedResident(w,r)&&canObserve(w,r)&&distance(r.at,beast.at)<=10&&reach(w,r.at,beast.at,12);
}

function markWildDeath(w:World,beast:WildBeast,cause:NonNullable<WildBeast['deathCause']>){
 if(!alive(beast))return;
 recordWildlifeExit(w,beast,'deaths');
 beast.status='dead';beast.health=0;beast.deathCause=cause;beast.deathAt=w.minute;
 recordPredatorDeath(w,beast);
 delete beast.alert;delete beast.path;delete beast.activity;delete beast.pregnancy;
 w.frontierHazards!.totals.wildlifeDeaths++;
 if(cause==='hunted'){w.frontierHazards!.totals.hunted++;return;}
 if(cause==='predation')return;
 const reason={oldAge:'衰老',thirst:'长期缺水',starvation:'长期觅食不足',disease:'野生动物疾病'}[cause];
 emitEvent(w,{kind:'hazard',actors:[],animalIds:[beast.id],place:{...beast.at},text:`一只${beastNames[beast.species]}因${reason}死亡。`});
}

export function woundWildBeast(w:World,id:string,damage:number):{species:WildBeast['species'];killed:boolean}|null {
 const beast=w.frontierHazards?.beasts.find(b=>b.id===id&&alive(b));
 if(!beast||!Number.isFinite(damage)||damage<=0)return null;
 beast.health=Math.max(0,(beast.health??100)-damage);
 if(beast.health===0)markWildDeath(w,beast,'hunted');
 return {species:beast.species,killed:beast.status==='dead'};
}

export function alarmWildBeast(w:World,id:string,hunter:Resident):void {
 const beast=w.frontierHazards?.beasts.find(b=>b.id===id&&alive(b));
 if(!beast||!exposedResident(w,hunter)||!reach(w,beast.at,hunter.at,3))return;
 if(!wildlifeThreatensPeople(beast)){evade(w,beast,hunter.at,'遭到居民攻击',hunter.id);return;}
 const attackAt=beast.alert?.residentId===hunter.id?Math.min(beast.alert.attackAt,w.minute+14):w.minute+14;
 beast.alert={residentId:hunter.id,attackAt};beast.nextMoveAt=Math.min(beast.nextMoveAt,w.minute+3);
 activity(beast,'defend','受伤后的反扑',hunter.at,hunter.id);
 emitEvent(w,{kind:'hazard',actors:[hunter.id],animalIds:[beast.id],place:{...hunter.at},text:`受伤的${beastNames[beast.species]}正向${hunter.name}反扑。`});
}

function foodPatch(state:FrontierHazardState,beast:WildBeast):WildFoodPatch|undefined {
 return state.foodPatches.find(p=>p.id==='habitat:'+beast.species);
}

function feed(beast:WildBeast,relief:number){beast.hunger=Math.max(0,beast.hunger-relief);}

function targetForAlert(w:World,beast:WildBeast):Resident|Livestock|WildBeast|undefined {
 if(beast.alert?.residentId)return w.residents.find(r=>r.id===beast.alert!.residentId&&exposedResident(w,r)&&distance(beast.at,r.at)<=7);
 if(beast.alert?.animalId)return w.industry?.animals.find(n=>n.id===beast.alert!.animalId&&exposedAnimal(n)&&distance(beast.at,n.at)<=8);
 if(beast.alert?.preyId)return w.frontierHazards?.beasts.find(n=>n.id===beast.alert!.preyId&&alive(n)&&distance(beast.at,n.at)<=9);
}

function threatenedPasture(w:World,beast:WildBeast,animal:Livestock&{at:Vec},notify:Threats['notify']){
 beast.alert={animalId:animal.id,attackAt:w.minute+66};
 activity(beast,'raid','饥饿，准备捕食露天牲畜',animal.at,animal.id);
 const text=`${beastNames[beast.species]}正在靠近放在户外的${animalNames[animal.kind]}，可把活畜带进畜舍避险。`;
 const event=emitEvent(w,{kind:'hazard',actors:[],animalIds:[beast.id,animal.id],place:{...animal.at},text});
 const owner=w.residents.find(r=>r.id===animal.ownerId&&r.canExpress&&event.witnesses.includes(r.id));
 if(owner&&!(owner.activity?.action.type==='industry'&&owner.activity.action.animalId===animal.id&&owner.activity.action.operation==='moveAnimal'))notify(owner,text);
}

function strike(w:World,beast:WildBeast,target:Resident|Livestock|WildBeast,threats:Threats){
 const label=beastNames[beast.species],source=`${label}袭击`;
 if('species' in target){
  const damage=target.species==='deer'?46:100;
  target.health=bound(target.health-damage);
  if(!target.health){markWildDeath(w,target,'predation');feed(beast,target.species==='deer'?66:44);}
  else evade(w,target,beast.at,'被捕食者追击',beast.id);
  emitEvent(w,{kind:'hazard',actors:[],animalIds:[beast.id,target.id],place:{...target.at},
   text:`${label}${target.health?'咬伤':'捕食'}了一只${beastNames[target.species]}。`});
  return;
 }
 if('canExpress' in target){
  threats.injure(target,animalRules[beast.species].danger+(target.energy<20?10:0),source);
  return;
 }
 const totals=w.frontierHazards!.totals;
 const poultry=target.kind==='chicken'||target.kind==='duck';
 const damage=beast.species==='wolf'?(poultry?64:48):38;
 totals.livestockAttacks++;
 target.health=Math.max(0,target.health-damage);
 if(target.health===0&&recordLivestockDeath(w,target,source)){
  totals.livestockKilled++;feed(beast,poultry?48:70);
  return;
 }
 emitEvent(w,{kind:'hazard',actors:[target.ownerId],animalIds:[beast.id,target.id],place:{...target.at!},roomId:null,text:`一只${animalNames[target.kind]}遭${label}袭击受伤。`});
}

function activity(beast:WildBeast,kind:AnimalActivity['kind'],reason:string,target?:Vec,targetId?:string){
 beast.activity={kind,reason,...(target?{target:{...target}}:{}),...(targetId?{targetId}:{})};
}

function moveToward(w:World,beast:WildBeast,to:Vec,steps:number):boolean {
 if(!beast.path||!same(beast.path.to,to)||!beast.path.steps.length||
  distance(beast.at,beast.path.steps[0])!==1||!walkable(w,beast.path.steps[0],beast.at)){
  const path=findPath(w,beast.at,to,false,steps);
  if(!path?.length){delete beast.path;return false;}
  beast.path={to:{...to},steps:path};
 }
 beast.at=beast.path.steps.shift()!;
 return true;
}

function evade(w:World,beast:WildBeast,threat:Vec,reason:string,targetId?:string){
 const away=neighbors(beast.at).filter(at=>walkable(w,at,beast.at)&&distance(at,threat)>distance(beast.at,threat))
  .sort((a,b)=>distance(a,beast.den)-distance(b,beast.den));
 activity(beast,'flee',reason,away[0]??beast.den,targetId);
 delete beast.path;
 if(away[0])beast.at=away[0];
}

function patrol(w:World,beast:WildBeast){
 activity(beast,'roam','巡查领地',beast.den);
 if(distance(beast.at,beast.den)>9&&moveToward(w,beast,beast.den,72))return;
 delete beast.path;
 const cells=neighbors(beast.at).filter(at=>distance(at,beast.den)<=9&&walkable(w,at,beast.at));
 if(cells.length){
  const seed=Math.imul(w.seed+beast.den.x+Math.floor(w.minute/9),1103515245)>>>8;
  beast.at={...cells[seed%cells.length]};
 }
}

const berryDanger=(w:World,at:Vec)=>w.frontierHazards!.disasters.some(d=>d.phase==='active'&&disasterContains(d,at));

/** Deer only: actual nearby berries may supplement an unavailable browse patch. */
function seekDeerBerries(w:World,beast:WildBeast,targetId?:string):boolean {
 const sources=w.resources.filter(r=>r.kind==='bush'&&r.amount>=1&&!berryDanger(w,r.at)&&
  (targetId?r.id===targetId:distance(beast.at,r.at)<=9))
  .sort((a,b)=>distance(beast.at,a.at)-distance(beast.at,b.at)||a.id.localeCompare(b.id));
 for(const source of sources){
  // Recheck the whole bounded route, including obstacles or disasters ahead of a cached step.
  const path=findPath(w,beast.at,source.at,false,12,(_from,to)=>!berryDanger(w,to));
  if(!path?.length)continue;
  beast.path={to:{...source.at},steps:path};
  beast.at=beast.path.steps.shift()!;
  activity(beast,'forage','原食源不足，前往附近实际浆果',source.at,source.id);
  return true;
 }
 return false;
}

function forage(w:World,state:FrontierHazardState,beast:WildBeast):boolean {
 if(beast.hunger<38)return false;
 const patch=isPredator(beast)?predatorFoodPatch(w,beast):foodPatch(state,beast);
 // Keep a still-valid land-food journey until contact instead of switching back at every tile.
 const continuingSeeds=beast.species==='duck'&&patch&&patch.amount>=1&&beast.activity?.kind==='forage'&&beast.activity.targetId===patch.id;
 if(beast.species==='duck'&&!continuingSeeds){
  const caught=wildFishAt(w,beast.at);
  if(caught){
   feed(beast,42);activity(beast,'forage',`捕食了可触及的实际鱼群：${fishNames[caught]}`,beast.at);
   const water=waterAtShore(w,beast.at)!;
   emitEvent(w,{kind:'hazard',actors:[],animalIds:[beast.id,'shoal:'+fishingKey(water)],place:{...beast.at},
    text:`一只野鸭吃到一份可触及的${fishNames[caught]}，水域同种鱼群实际减少。`});
   return true;
  }
  const shore=state.shore;
  if(shore&&availableWildFishAt(w,shore)&&moveToward(w,beast,shore,20)){
   activity(beast,'forage','寻找河岸可以触及的鱼群',shore);return true;
  }
 }
 if(beast.species==='boar'||beast.species==='deer'){
  const berries=w.resources.find(resource=>resource.kind==='bush'&&resource.amount>=1&&(beast.species!=='deer'||!berryDanger(w,resource.at))&&distance(beast.at,resource.at)<=1&&reach(w,beast.at,resource.at,1));
  if(berries){berries.amount--;berries.lastHarvest=w.minute;feed(beast,19);activity(beast,'forage','吃到可触及的浆果',berries.at,berries.id);return true;}
  if(beast.hunger>=68){
   const crop=w.plots.find(plot=>plot.crop&&plot.crop.growth>=.5&&reach(w,beast.at,plot.at,1));
   if(crop?.crop){
    crop.crop.growth=Math.max(0,crop.crop.growth-.5);feed(beast,19);activity(beast,'forage','饥饿，啃食附近田地的作物',crop.at,crop.id);
    emitEvent(w,{kind:'hazard',actors:[],animalIds:[beast.id],place:{...crop.at},text:`一只${beastNames[beast.species]}啃食了田里的作物，作物长势减退。`});
    return true;
   }
  }
 }
 if(beast.species==='deer'&&beast.activity?.kind==='forage'&&beast.activity.targetId&&beast.activity.targetId!==patch?.id){
  if(seekDeerBerries(w,beast,beast.activity.targetId))return true;
  delete beast.path;
 }
 if(patch&&patch.amount>=1){
  activity(beast,'forage','饥饿，寻找已知食源',patch.at,patch.id);
  if(reach(w,beast.at,patch.at,1)){
   patch.amount--;feed(beast,animalRules[beast.species].forageRelief);return true;
  }
  if(moveToward(w,beast,patch.at,72))return true;
 }
 return beast.species==='deer'&&seekDeerBerries(w,beast);
}

function seekWater(w:World,state:FrontierHazardState,beast:WildBeast):boolean {
 if((beast.thirst??0)<56)return false;
 const springs=w.resources.filter(r=>r.kind==='spring'&&r.floodDamage?.clearedAt!==null&&r.amount>=1&&distance(beast.at,r.at)<=70);
 const nearBank=state.shore&&distance(beast.at,state.shore)<=65&&!state.disasters.some(d=>d.kind==='flashFlood'&&d.phase==='active'&&disasterContains(d,state.shore!))?state.shore:null;
 const sources=[...springs.map(spring=>({at:spring.at,spring})),...(nearBank?[{at:nearBank,spring:undefined}]:[])]
  .sort((a,b)=>distance(beast.at,a.at)-distance(beast.at,b.at));
 for(const source of sources){
  if(reach(w,beast.at,source.at,1)){
   if(source.spring){source.spring.amount--;source.spring.lastHarvest=w.minute;}
   beast.thirst=bound((beast.thirst??0)-46);
   activity(beast,'drink','在可到达的清水处饮水',source.at,source.spring?.id);
   return true;
  }
  if(moveToward(w,beast,source.at,80)){
   activity(beast,'drink','口渴，前往可到达的清水处',source.at,source.spring?.id);
   return true;
  }
 }
 return false;
}

function initiatePredation(w:World,state:FrontierHazardState,beast:WildBeast,rules:SpeciesRules):boolean {
 if(!rules.prey.length||beast.hunger<38)return false;
 const prey=state.beasts.filter(n=>alive(n)&&rules.prey.includes(n.species)&&distance(beast.at,n.at)<=12)
  .sort((a,b)=>distance(beast.at,a.at)-distance(beast.at,b.at));
 for(const target of prey){
  if(reach(w,beast.at,target.at,5)){
   beast.alert={preyId:target.id,attackAt:w.minute+11};
   activity(beast,'hunt','饥饿，伏击可触及的猎物',target.at,target.id);
   return true;
  }
  if(moveToward(w,beast,target.at,15)){
   activity(beast,'hunt','饥饿，循实际位置接近猎物',target.at,target.id);
   return true;
  }
 }
 return false;
}

function stepWildBeast(w:World,state:FrontierHazardState,beast:WildBeast,minutes:number,threats:Threats){
 const now=w.minute,rules=animalRules[beast.species];
 const resting=beast.activity?.kind==='rest';
 beast.hunger=bound(beast.hunger+minutes/rules.hungerMinutes*(resting ? .66 : 1));
 beast.thirst=bound((beast.thirst??20)+minutes/(w.weather==='rain'?117:82));
 beast.energy=bound((beast.energy??85)+minutes*(resting ? .12 : beast.activity?.kind==='hunt'||beast.activity?.kind==='flee' ? -.071 : -.03));
 const beforeDisease=beast.health;
 advancePredatorDisease(w,beast,minutes);
 const diseaseKilled=beforeDisease>0&&beast.health<=0;
 if(beast.hunger>=86||beast.thirst>=95)beast.health=bound(beast.health-minutes*.039);
 else if(!beast.disease&&beast.hunger<38&&beast.thirst<65)beast.health=bound(beast.health+minutes*.014);
 if(beast.health<=0||now-beast.bornAt>=rules.years*YEAR){markWildDeath(w,beast,beast.health<=0?(diseaseKilled?'disease':beast.thirst>=95?'thirst':'starvation'):'oldAge');return;}

 const disaster=state.disasters.find(d=>d.phase==='active'&&disasterContains(d,beast.at));
 if(disaster&&now>=beast.nextMoveAt){
  delete beast.alert;
  beast.nextMoveAt=now+4;
  evade(w,beast,disaster.at,'避开已发生的灾害',disaster.id);
  return;
 }
 if(stepPredatorMigration(w,beast))return;
 const target=targetForAlert(w,beast);
 if(beast.alert){
  if(!target){delete beast.alert;beast.cooldownUntil=now+24;}
  else if(now>=beast.alert.attackAt){
   if(target.at&&reach(w,beast.at,target.at,2))strike(w,beast,target,threats);
   delete beast.alert;beast.cooldownUntil=now+38;
  }else if(now>=beast.nextMoveAt){
   beast.nextMoveAt=now+3;if(target.at&&distance(beast.at,target.at)>1)moveToward(w,beast,target.at,10);
   if(target.at)activity(beast,'species' in target?'hunt':'canExpress' in target?'defend':'raid',
    'species' in target?'追踪可触及的猎物':'canExpress' in target?'对近身威胁警戒':'接近露天牲畜',target.at,target.id);
  }
  return;
 }
 if(now<beast.nextMoveAt)return;
 const hour=calendar(now).hour;
 const night=hour>=18||hour<6,active=beast.species==='boar'||rules.nocturnal===night||beast.hunger>=84;
 beast.nextMoveAt=now+(active?rules.speed:14);
 const predator=state.beasts.find(other=>other.id!==beast.id&&alive(other)&&animalRules[other.species].prey.includes(beast.species)&&reach(w,beast.at,other.at,4));
 const bait=beast.species==='duck'&&!predator&&beast.hunger>=24&&w.residents.find(r=>exposedResident(w,r)&&
  (r.inventory.fodder??0)>0&&r.activity?.action.type==='industry'&&r.activity.action.operation==='tameAnimal'&&
  r.activity.action.beastId===beast.id&&!r.activity.path.length&&reach(w,beast.at,r.at,5));
 if(bait){
  activity(beast,'forage','被附近居民带来的实际饲料吸引',bait.at,bait.id);
  if(!reach(w,beast.at,bait.at,1))moveToward(w,beast,bait.at,6);
  return;
 }
 const person=rules.danger===0&&w.residents.find(r=>exposedResident(w,r)&&reach(w,beast.at,r.at,3));
 if((predator||person)&&beast.energy>=12){
  const threat=predator||person;
  if(threat){evade(w,beast,threat.at,predator?'察觉到近处的捕食者':'远离靠近的居民',threat.id);beast.nextMoveAt=now+3;return;}
 }
 if(seekWater(w,state,beast))return;
 if((isPredator(beast)||beast.motherId)&&now-beast.bornAt<7*DAY){
  const mother=state.beasts.find(b=>b.id===beast.motherId&&b.species===beast.species&&b.sex==='female'&&alive(b));
  if(beast.species!=='duck'&&mother&&reach(w,beast.at,mother.at,1)&&beast.hunger>=38&&mother.hunger<60&&!mother.disease){
   // Nursing transfers the mother's existing nutrition, which she must replace by eating actual food.
   mother.hunger=bound(mother.hunger+16);mother.energy=bound((mother.energy??0)-2);feed(beast,20);
   activity(beast,'forage','从近处亲代获得营养，亲代饥饿实际增加',mother.at,mother.id);
  }else if(beast.species==='duck'&&forage(w,state,beast))return;
  else if(mother&&moveToward(w,beast,mother.at,24))activity(beast,'roam','跟随存活的亲代',mother.at,mother.id);
  else if(!forage(w,state,beast))activity(beast,'rest','幼崽在附近等待食物',beast.at);
  return;
 }
 if(beast.hunger<80&&(!active||beast.energy<25||resting&&beast.energy<61)){
  if(distance(beast.at,beast.den)>2&&moveToward(w,beast,beast.den,72))activity(beast,'rest','回到藏身处休息',beast.den);
  else activity(beast,'rest',beast.energy<61?'补充体力':'按昼夜作息休息',beast.at);
  return;
 }

 if(now>=beast.cooldownUntil){
  const person=rules.danger>0&&w.residents.find(r=>exposedResident(w,r)&&reach(w,beast.at,r.at,3));
  if(person){
   const label=beastNames[beast.species];
   beast.alert={residentId:person.id,attackAt:now+34};
   activity(beast,'defend','附近出现可能的威胁',person.at,person.id);
   if(canObserve(w,person))threats.warn(person,`${person.name}在户外近距离遇见${label}。${label}已经警戒，附近仍有撤离时间。`,beast.at,6,beast.id);
   else emitLedgerEvent(w,{kind:'hazard',actors:[],animalIds:[beast.id],place:{...beast.at},text:`${label}正在接近一个无法及时察觉的户外人物。`});
   return;
  }
  if(initiatePredation(w,state,beast,rules))return;
  if(beast.hunger>=rules.starvingRaid){
   const candidates=(w.industry?.animals??[]).filter(exposedAnimal).filter(n=>(beast.species==='wolf'||n.kind==='chicken'||n.kind==='duck')&&distance(beast.den,n.at)<=rules.raidRange)
    .sort((a,b)=>distance(beast.at,a.at)-distance(beast.at,b.at)||a.id.localeCompare(b.id));
   for(const animal of candidates.slice(0,3)){
    if(reach(w,beast.at,animal.at,4)){threatenedPasture(w,beast,animal,threats.notify);return;}
    if(moveToward(w,beast,animal.at,rules.raidRange+8)){
     activity(beast,'raid','领地食源不足，寻找露天牲畜',animal.at,animal.id);beast.nextMoveAt=now+5;return;
    }
   }
  }
 }
 if(!forage(w,state,beast))patrol(w,beast);
}

/** Current lists stay bounded; registered population totals and persisted events retain the earlier facts. */
function pruneWildlifeHistory(state:FrontierHazardState){
 const dead=state.beasts.filter(b=>b.status==='dead'),latestDeath=new Set<WildBeast>();
 for(const kind of species){const lost=dead.slice().reverse().find(b=>b.species===kind);if(lost)latestDeath.add(lost);}
 const old=dead.slice(0,-12).filter(b=>!latestDeath.has(b)&&!isPredator(b));
 if(old.length)state.beasts=state.beasts.filter(b=>!old.includes(b));
}

export function advanceWildlife(w:World,minutes:number,threats:Threats){
 const state=w.frontierHazards!;
 initializeWildlife(w,state);
 if(state.lastWildlifeAt!==undefined){
  if(w.minute<=state.lastWildlifeAt)return;
  minutes=Math.min(minutes,w.minute-state.lastWildlifeAt);
 }
 state.lastWildlifeAt=w.minute;
 const season=calendar(w.minute).season;
 for(const patch of state.foodPatches){
  if(patch.kind==='smallGame'&&patch.amount<=0){patch.amount=0;patch.progress=0;continue;}
  if(patch.amount>=patch.capacity){patch.progress=0;continue;}
  const plantGrowth=patch.kind==='browse'||patch.kind==='seeds'?5:1;
  patch.progress+=minutes/DAY*plantGrowth*({spring:.68,summer:.85,autumn:.58,winter:.26}[season]);
  const recovered=Math.min(patch.capacity-patch.amount,Math.floor(patch.progress));
  patch.amount+=recovered;patch.progress-=recovered;
 }
 for(const beast of state.beasts)if(alive(beast))stepWildBeast(w,state,beast,minutes,threats);
 reviewWildlifePopulation(w,state,createWildBeast);
 reviewPredatorEcology(w,state,createWildBeast);
 pruneWildlifeHistory(state);
}
