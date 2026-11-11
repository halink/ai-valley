import {activeLandRights} from '../shared/land-rights.js';
import {buildingBlueprints} from '../world/building-blueprints.js';
import {isInfrastructure} from '../world/infrastructure.js';
import type {BuildingKind,FormalOpportunity,Resident,World} from '../shared/types.js';
import type {ConstructionAction} from '../shared/construction.js';
import {constructionReason,knowsConstruction,neededConstructionMaterials,remainingConstructionWork} from '../world/construction.js';
import {constructionNames} from '../world/construction-sites.js';
import {productionParcels} from '../world/production.js';
import {accountBalance} from '../world/economy.js';
import {distance} from '../world/navigation.js';
import {ageYears} from '../world/time.js';

const states={proposed:'等待居民公共表决',planned:'筹备或等待下一阶段',active:'正在分阶段施工',paused:'已停工',abandoned:'保留的未完工部分',completed:'已交付',cancelled:'未开工结束',removed:'已实际拆除'};
export function constructionNotes(w:World,r:Resident):string {
 return (w.construction?.projects??[]).filter(p=>!r.inside&&distance(r.at,p.door)<=8).slice(-3).map(p=>{
  const need=neededConstructionMaterials(p),stage=p.stages[p.stage];
  return `你在${p.name}现场看见：${states[p.status]}，${stage?stage.name+'已做'+Math.floor(stage.worked)+'/'+stage.minutes+'分钟':'各阶段已完成'}；工程可用${accountBalance(w,p.account)}钱，还需木材${need.wood}、石料${need.stone}。采购每木${p.prices.wood}钱、每石${p.prices.stone}钱，施工每实际小时${p.wagePerHour}钱。资助不买产权，钱款未用部分退回原出资人，供料未用部分须到现场取回。`;
 }).join(' ');
}
export function constructionOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!w.construction||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<18)return [];
 const choices:FormalOpportunity[]=[];
 const add=(id:string,label:string,action:ConstructionAction)=>{if(!constructionReason(w,r,action))choices.push({id:'construction.'+id,label,action});};
 for(const p of w.construction.projects.filter(p=>knowsConstruction(w,r,p))){
  const useful=!['completed','removed','cancelled'].includes(p.status)||p.claims.some(l=>l.source===`resident:${r.id}`);
  if(!useful)continue;
  if(r.inside||distance(r.at,p.door)>8){choices.push({id:'construction.visit.'+p.id,label:`去自己已知的${p.name}现场，查看进度、报价或本人申请的回复`,action:{type:'move',to:{...p.door}}});continue;}
  const need=neededConstructionMaterials(p);
  add('fund.'+p.id,`自愿资助${p.name} ${Math.min(5,r.coins)}钱（可填amount 1–1000；未用款结束时返还，不获得产权，不支配别人）`,{type:'construction',operation:'fund',projectId:p.id,amount:Math.min(5,r.coins)});
  for(const item of ['wood','stone'] as const){const quantity=Math.min(3,r.inventory[item]??0,need[item]??0);if(!quantity)continue;
   add('give.'+p.id+item,`自愿为${p.name}送入${quantity}份${item==='wood'?'木材':'石料'}（可填quantity；未用部分保留取回权，已施工消耗不回退）`,{type:'construction',operation:'donateMaterials',projectId:p.id,item,quantity});
   add('supply.'+p.id+item,`按${p.name}每份${p.prices[item]}钱的已见报价交付${quantity}份${item==='wood'?'木材':'石料'}（可填quantity 1–40）`,{type:'construction',operation:'supply',projectId:p.id,item,quantity,quotedPrice:p.prices[item]});
  }
  add('apply.'+p.id,`申请为${p.name}施工：每实际小时${p.wagePerHour}钱，负责人选人后自己仍须最后同意，每次上工由本人决定`,{type:'construction',operation:'apply',projectId:p.id});
  add('withdraw.'+p.id,`撤回自己向${p.name}的施工申请`,{type:'construction',operation:'withdraw',projectId:p.id});
  for(const app of p.applications.filter(a=>a.status==='pending').slice(0,4))for(const operation of ['hire','reject'] as const)add(operation+p.id+app.workerId,
   `${operation==='hire'?'选择':'拒绝'}${w.residents.find(r=>r.id===app.workerId)?.name??'原申请人'}为${p.name}施工${operation==='hire'?`，预存余下${Math.ceil(remainingConstructionWork(p))}分钟的工资，等待其最后确认`:''}`,
   {type:'construction',operation,projectId:p.id,applicantId:app.workerId});
  for(const operation of ['accept','decline'] as const)add(operation+p.id,`${operation==='accept'?'亲自接受':'拒绝'}${p.name}的施工邀请：每实际小时${p.wagePerHour}钱，工资已预存，委托最多十四日，自己决定每次上工`,{type:'construction',operation,projectId:p.id});
  add('work.'+p.id,`亲自为${p.name}施工30分钟（可填minutes 1–120；一次最多做到当前阶段结束，下一阶段须另作决定；本人产权人的劳动不向自己付薪）`,{type:'construction',operation:'work',projectId:p.id,minutes:30,stage:p.stage});
  for(const [operation,label]of [['quit','退出自己的施工委托，保留已挣工资'],['pause','决定暂停施工，保留进度、原料和资金'],['resume','决定从现有实际进度复工'],['cancel','结束本次工程，结清未用资金，保留已施工部分及材料归属'],['collect','亲自领取此处属于本人的未用或回收材料']] as const)add(operation+p.id,`${label}：${p.name}`,{type:'construction',operation,projectId:p.id});
  for(const c of p.workers.filter(c=>['offered','active'].includes(c.status)))add('release.'+p.id+'.'+c.workerId,`结束${w.residents.find(r=>r.id===c.workerId)?.name??'该施工者'}的具体施工委托，已挣工资保留，其他施工者的约定继续`,{type:'construction',operation:'release',projectId:p.id,applicantId:c.workerId});
  add('dismantle.'+p.id,`亲自拆除${p.name}的未完工遗留部分，本次30分钟（可填minutes 1–120，总需120分钟，实际回收一半木石后释放土地）`,{type:'construction',operation:'dismantle',projectId:p.id,minutes:30});
 }
 // Terrain proposals remain individual choices; public voting and actual staged work still follow.
 if(!r.inside&&r.residency==='resident'){
  const terms={scope:'public' as const,wagePerHour:6,prices:{wood:2,stone:2}};
  for(const [direction,dx,dy]of [['east',1,0],['south',0,1],['west',-1,0],['north',0,-1]] as const){
   const at={x:r.at.x+dx,y:r.at.y+dy},end={x:r.at.x+dx*4,y:r.at.y+dy*4};
   add('road.'+direction,`提议在眼前沿${direction==='east'?'东':direction==='west'?'西':direction==='north'?'北':'南'}方向铺4格道路；每格1木2石、20分钟，公共用地与预算须分别表决，分阶段施工才生效。可填name、wagePerHour、prices、x/y/endX/endY`,{type:'construction',operation:'propose',kind:'road',at,end,direction,...terms});
   let length=0;while(length<12&&w.map.tiles[(at.y+dy*length)*w.map.width+at.x+dx*length]==='water')length++;
   if(length){const bridgeEnd={x:at.x+dx*(length-1),y:at.y+dy*(length-1)};
    add('bridge.'+direction,`提议从眼前岸边架设${length}格桥连接另一岸，每格5木2石、60分钟，仍须实际公共表决、供料与施工。可填name、wagePerHour、prices`,{type:'construction',operation:'propose',kind:'bridge',at,end:bridgeEnd,direction,...terms});
    const pier=Math.min(3,length);add('dock.'+direction,`提议在眼前水岸修建${pier}格码头平台，每格6木2石、90分钟，可供实际步行到水边及垂钓；公共用地与预算须另行表决。可填name、wagePerHour、prices`,{type:'construction',operation:'propose',kind:'dock',at,end:{x:at.x+dx*(pier-1),y:at.y+dy*(pier-1)},direction,...terms});
   }
  }
  let offered=false;for(const dx of [-8,-4,2,6])for(const dy of [-8,-4,2,6]){if(offered)continue;const before=choices.length;add('cemetery',`提议扩建3×6格公共墓园，增加6处真实空墓位与通路，需6木12石、360分钟；不覆盖原墓，不自动安葬，须公共表决和分阶段施工。可填name、wagePerHour、prices、x/y`,{type:'construction',operation:'propose',kind:'cemetery',at:{x:r.at.x+dx,y:r.at.y+dy},...terms});if(choices.length>before)offered=true;}
  for(const asset of w.infrastructure?.assets.filter(s=>s.retiredAt===null&&s.condition<95&&distance(r.at,s.access)<=16)??[])add('repairInfrastructure.'+asset.id,`提出对${constructionNames[asset.kind]}的实际修护工程：现场状况${Math.floor(asset.condition)}/100，预算、供料、承包与各次上工仍须居民自行决定`,{type:'construction',operation:'repairInfrastructure',assetId:asset.id,...terms});
 }
 const blueprints=buildingBlueprints(w,r);
 const owned=[...productionParcels(w).filter(p=>p.ownerId===r.id),...activeLandRights(w).filter(p=>p.applicantId===r.id&&p.purpose!=='pasture').map(p=>({...p.at,width:p.width,height:p.height,ownerId:r.id}))];
 const defaults={wagePerHour:6,prices:{wood:2,stone:2}};
 const terms='可另填name、wagePerHour（0–60）、prices（wood/stone每份1–100），未填沿用此明确条件；不能替别人出钱或上工';
 for(const lot of owned){
  const visit={x:lot.x+Math.floor(lot.width/2),y:lot.y+lot.height};
  if(r.inside||distance(r.at,visit)>12){choices.push({id:`construction.inspect.${lot.x}.${lot.y}`,label:'到自己登记的建设用地查看选址',action:{type:'move',to:visit}});continue;}
  for(const {kind,definition,name,def} of blueprints){
   const wide=Number(def.data.width),high=Number(def.data.height);
   const locations=[{x:lot.x,y:lot.y},{x:lot.x+lot.width-wide,y:lot.y+lot.height-high-1}];
   for(const [i,at]of locations.entries())add(`new.${definition}.${lot.x}.${i}`,`在本人用地(${at.x},${at.y})提议建${name}，${wide}×${high}格，分三阶段用${def.cost?.wood}木${def.cost?.stone}石、${def.minutes}分钟；时薪6钱、木石每份2钱。可另填x/y选择眼前合法坐标；${terms}`,
    {type:'construction',operation:'propose',kind,at,scope:'private',definition,name:kind===def.id.slice(9)?undefined:r.name+'的'+name,...defaults});
  }
 }
 for(const b of w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&(b.ownerId===r.id||b.ownerId==='commons')&&distance(r.at,b.door)<=12).slice(0,3)){
  for(const {kind,definition,name} of blueprints)if(kind!==b.kind||definition!==b.definition)add('convert.'+b.id+'.'+definition,`把已经腾空并处理完原用途承诺的${b.name}分三阶段改为${name}，保留同一建筑身份、产权和占地；不得赶走住户或清除设备。${b.ownerId==='commons'?'须另经公共表决。':''}${terms}`,{type:'construction',operation:'convert',buildingId:b.id,kind,definition,...defaults});
  for(const direction of ['north','east','west'] as const)add(`expand.${b.id}.${direction}`,`向${{north:'后院',east:'东侧',west:'西侧'}[direction]}扩建${b.name}两格，保留原入口和住户，三阶段240分钟${['home','lodge'].includes(b.kind)?'，完工增加2床位':''}。${b.ownerId==='commons'?'公共工程须另经居民表决。':''}时薪6钱、木石每份2钱；${terms}`,
   {type:'construction',operation:'expand',buildingId:b.id,direction,...defaults});
 }
 // Public land must be in the actor's actual vicinity. These are proposals, never automatic permits.
 if(!r.inside&&r.residency==='resident'&&w.buildings.some(b=>b.ownerId==='commons'&&r.knownBuildings.includes(b.id)&&distance(r.at,b.door)<=12)){
  for(const {kind,definition,name,def} of blueprints){
   let offered=0;for(const dx of [-8,2])for(const dy of [-8,2]){if(offered)continue;const at={x:r.at.x+dx,y:r.at.y+dy};const before=choices.length;
    add(`public.${definition}`,`在眼前公共候选地(${at.x},${at.y})提议建${name}，须另经居民表决用地、负责人和预算。分三阶段需${def.cost?.wood}木${def.cost?.stone}石、${def.minutes}分钟；时薪6钱、木石每份2钱。可另填x/y；${terms}`,
     {type:'construction',operation:'propose',kind,at,scope:'public',definition,name:kind===def.id.slice(9)?undefined:name,...defaults});if(choices.length>before)offered++;
   }
  }
 }
 return choices;
}
export function constructionChoiceFields(a:ConstructionAction):string[]{
 if(a.operation==='propose'||a.operation==='expand'||a.operation==='convert'||a.operation==='repairInfrastructure')return ['name','wagePerHour','prices',...(a.operation==='propose'?['x','y',...(isInfrastructure(a.kind)&&a.end?['endX','endY']:[])]:[])];
 if(a.operation==='fund')return ['amount'];if(a.operation==='supply'||a.operation==='donateMaterials')return ['quantity'];if(a.operation==='work'||a.operation==='dismantle')return ['minutes'];return [];
}
export function parseConstructionChoice(action:ConstructionAction,data:Record<string,unknown>):ConstructionAction {
 const a=structuredClone(action);
 for(const key of constructionChoiceFields(a)){
  const value=data[key];if(value===undefined)continue;
  if(key==='name'){if(typeof value!=='string'||!value.trim()||value.length>32)throw new Error('invalid_project_name');a.name=value.trim();continue;}
  if(key==='prices'){if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!['wood','stone'].includes(k)||typeof v!=='number'||!Number.isSafeInteger(v)||v<1||v>100))throw new Error('invalid_project_prices');a.prices={...a.prices,...value};continue;}
  const min=['x','y','endX','endY','wagePerHour'].includes(key)?0:1,max=key==='amount'?1000:key==='quantity'?40:key==='minutes'?120:key==='wagePerHour'?60:100000;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new Error('invalid_project_term');
  if(key==='endX'||key==='endY'){if(!a.end)throw new Error('missing_project_end');a.end[key==='endX'?'x':'y']=value;}
  else if(key==='x'||key==='y'){if(!a.at)throw new Error('missing_project_site');a.at[key]=value;}
  else if(key==='amount')a.amount=value;else if(key==='quantity')a.quantity=value;else if(key==='minutes')a.minutes=value;else if(key==='wagePerHour')a.wagePerHour=value;
 }
 return a;
}
