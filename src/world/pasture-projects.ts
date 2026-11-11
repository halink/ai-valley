import type {FormalOpportunity,Inventory,Resident,Vec,World} from '../shared/types.js';
import type {IndustryAction,Pasture,PastureProject} from '../shared/industry.js';
import {pastureFenceCondition,pastureFenceRules as fenceRules} from '../shared/pasture-fence.js';
import {landSiteError} from './land-rights.js';
import {distance,findPath,same} from './navigation.js';
import {ageYears,DAY} from './time.js';
import {emitEvent} from './events.js';

export const pastureOperations=new Set<IndustryAction['operation']>(['planPasture','workPasture','cancelPasture','clearPasture','repairFence','installTrough','fillTrough','drainTrough','restPasture','openPasture','retirePasture']);
const has=(r:Resident,c:Inventory)=>Object.entries(c).every(([i,n])=>(r.inventory[i as keyof Inventory]??0)>=n!);
const take=(r:Resident,c:Inventory)=>{for(const [i,n]of Object.entries(c))r.inventory[i as keyof Inventory]=(r.inventory[i as keyof Inventory]??0)-n!;};
const fact=(w:World,r:Resident,text:string)=>emitEvent(w,{kind:'production',actors:[r.id],place:{...r.at},text});
const gate=(p:Pasture)=>p.gate?.outside??p.tiles[0];
const occupied=(w:World,p:Pasture)=>!!w.industry?.animals.some(n=>n.status==='alive'&&(n.pastureId===p.id||!n.inside&&n.at&&p.tiles.some(t=>same(t,n.at!))));
const owned=(w:World,r:Resident,p:Pasture)=>p.ownerId===r.id||!p.ownerId&&w.buildings.some(b=>b.id===p.barnId&&(b.ownerId===r.id||b.ownerId==='commons'&&b.residents.includes(r.id)));
export function pastureAdmissionError(w:World,p:Pasture):string|null {
 if(p.status&&p.status!=='open')return '牧场正在休牧、已到期或已撤销，不能新放入牲畜';
 if(p.fenced&&pastureFenceCondition(p)<=0)return '牧场围栏已损坏，须本人实际修护后才能新放入牲畜';
 if(p.landRightId&&!w.landRights?.applications.some(a=>a.id===p.landRightId&&a.status==='registered'&&(a.expiresAt??0)>w.minute))return '牧场的有限用地已失效，只保留照料与迁出';
 return null;
}
function workSiteError(w:World,p:PastureProject,access=false){
 const right=w.landRights?.applications.find(a=>a.id===p.landRightId);
 if(!right||right.applicantId!==p.ownerId||right.purpose!=='pasture'||right.status!=='registered'||(right.expiresAt??0)<=w.minute||p.expiresAt<=w.minute)return '施工期限或原牧场用地已失效，保留投入，不能继续施工';
 // The project's own physical fence must not invalidate its original survey.
 const check={...w,industry:{...w.industry!,pastureProjects:w.industry!.pastureProjects?.filter(q=>q.id!==p.id)}};
 return landSiteError(check,right,access);
}
export function pastureTarget(w:World,r:Resident,a:IndustryAction):{target:Vec;duration:number;error?:string}{
 const fail=(error:string)=>({target:r.at,duration:0,error});
 if(!w.industry||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<18)return fail('须由能自行决定且实际在地的成年人处理牧场');
 if(['planPasture','workPasture'].includes(a.operation)&&r.residency!=='resident')return fail('新增牧场施工须由成年常住居民本人处理');
 const project=w.industry.pastureProjects?.find(p=>p.id===a.projectId),yard=w.industry.pastures?.find(p=>p.id===a.pastureId);
 let target:Vec,duration=10;
 if(a.operation==='planPasture'){
  const right=w.landRights?.applications.find(p=>p.id===a.landRightId);
  if(!right||right.purpose!=='pasture'||right.applicantId!==r.id||right.status!=='registered'||(right.expiresAt??0)<=w.minute)return fail('需要本人已登记且有效的具体牧场用地');
  if(w.industry.pastures?.some(p=>p.landRightId===right.id&&p.status!=='retired')||w.industry.pastureProjects?.some(p=>p.landRightId===right.id&&p.status!=='removed'))return fail('原地已有牧场或未清理的工程，不能重复占用或重复施工');
  const error=landSiteError(w,right,true);if(error)return fail(error);target=right.door;
 }else if(['workPasture','cancelPasture','clearPasture'].includes(a.operation)){
  if(!project||project.ownerId!==r.id||['completed','removed'].includes(project.status))return fail('没有本人待处理的真实牧场工程');target=project.door;
  if(a.operation==='workPasture'){
   if(project.status!=='building'||a.stage!==project.stage)return fail('原施工阶段已经改变或工程已经停止，请重新决定');
   const error=workSiteError(w,project);if(error)return fail(error);
   const stage=project.stages[project.stage];if(!stage||!stage.paid&&!has(r,stage.cost))return fail('本人没有本阶段所需真实木石材料');
   if(!Number.isSafeInteger(a.minutes)||a.minutes!<1||a.minutes!>120)return fail('单次施工须为1–120分钟');duration=Math.max(.001,Math.min(a.minutes!,stage.minutes-stage.worked));
  }else if(a.operation==='cancelPasture'){if(project.status==='cancelled')return fail('此工程已经停止');}
  else {if(project.status==='building')return fail('须先停止工程再亲自清理');if(w.industry.animals.some(n=>n.status==='alive'&&!n.inside&&n.at&&n.at.x>=project.at.x&&n.at.x<project.at.x+project.width&&n.at.y>=project.at.y&&n.at.y<project.at.y+project.height))return fail('须先将实际在场牲畜迁出');duration=60;}
 }else{
  if(!yard||yard.status==='retired')return fail('没有尚存的实际牧场');target=gate(yard);
  if(!r.knownBuildings.includes(yard.barnId)||distance(r.at,target)>16)return fail('须亲自接近已知牧场查看设施');
  if(a.operation==='fillTrough'){
   if(yard.status==='expired'&&!occupied(w,yard))return fail('已到期且没有在场牲畜，不再向空场补水');
   if(!yard.trough||(r.inventory.water??0)<1||yard.trough.water>yard.trough.capacity-1)return fail('须有可盛一份水的真实水槽和本人实有清水');target=yard.trough.at;duration=10;
  }else{
   if(!owned(w,r,yard))return fail('只有牧场责任人能改变设施和放牧安排');
   if(a.operation==='repairFence'){
    if(!yard.fenced||!yard.gate||!yard.fence)return fail('没有已登记磨损的实际围栏，不能凭空新增设施');
    const repair=yard.fence.repair;
    if(a.fenceRepairId&&repair?.id!==a.fenceRepairId)return fail('原围栏修护批次已结束或改变，请重新决定');
    if(!repair&&(pastureFenceCondition(yard)>fenceRules.repairBelow||!has(r,{wood:fenceRules.repairWood})))return fail('围栏须损耗至70%以下且本人持有4木材，才能开始修护');
    if(!Number.isSafeInteger(a.minutes)||a.minutes!<1||a.minutes!>120)return fail('单次修护须为1–120分钟');
    duration=Math.max(.001,Math.min(a.minutes!,repair?repair.minutes-repair.worked:fenceRules.repairMinutes));
   }else if(a.operation==='drainTrough'){if(!yard.trough||yard.trough.water<=0)return fail('水槽没有实际余水可排空');target=yard.trough.at;duration=10;
   }else if(a.operation==='installTrough'){
    if(yard.trough||pastureAdmissionError(w,yard)||!has(r,{wood:2,stone:4}))return fail('须有效牧场、尚未安装水槽及本人2木4石');duration=45;
   }else if(a.operation==='restPasture'||a.operation==='retirePasture'){
    if(occupied(w,yard))return fail('须先亲自护送所有实际在场牲畜离开，不能自动迁移');
    if(a.operation==='retirePasture'&&(yard.trough?.water??0)>0)return fail('须先实际排空余水，不能凭空清除');
    if(a.operation==='restPasture'&&yard.status==='resting')return fail('牧场已经休牧');duration=a.operation==='retirePasture'?60:10;
   }else if(a.operation==='openPasture'){
    if(yard.status!=='resting'||pastureAdmissionError(w,{...yard,status:'open'}))return fail('只有仍持有效用地的休牧场能重新开放');
   }else return fail('未知牧场行动');
  }
 }
 return findPath(w,r.at,target)===null?fail('实际牧场工作路线不可达'):{target:{...target},duration};
}
export function workPasture(w:World,r:Resident,a:IndustryAction,dt:number):string|null {
 if(a.operation!=='workPasture'&&a.operation!=='repairFence')return null;
 const target=pastureTarget(w,r,a);if(target.error)return target.error;
 if(r.inside||!same(r.at,target.target)||r.activity?.action!==a)return '须本人实际到场执行已接受的牧场施工';
 if(!Number.isFinite(dt)||dt<=0)return '实际牧场劳动时间须为正数';
 if(a.operation==='repairFence'){
  const p=w.industry!.pastures!.find(p=>p.id===a.pastureId)!,f=p.fence!;
  if(!f.repair){
   take(r,{wood:fenceRules.repairWood});f.woodUsed+=fenceRules.repairWood;
   f.repair={id:'pasture-repair:'+w.industry!.nextSerial++,worked:0,minutes:fenceRules.repairMinutes,wood:fenceRules.repairWood,restore:fenceRules.repairRestore,lastAt:-1};
   fact(w,r,`${r.name}把本人${fenceRules.repairWood}木材实际投入牧场围栏修护，需在入口累计劳动${fenceRules.repairMinutes}分钟；中断后材料和工时留在原处。`);
  }
  const repair=f.repair;a.fenceRepairId=repair.id;
  if(repair.lastAt>=w.minute)return null;
  repair.worked+=Math.min(dt,repair.minutes-repair.worked,r.activity.remaining);repair.lastAt=w.minute;return null;
 }
 const p=w.industry!.pastureProjects!.find(p=>p.id===a.projectId)!,stage=p.stages[p.stage];
 if(p.lastAt>=w.minute)return null;
 if(!stage.paid){take(r,stage.cost);for(const [i,n]of Object.entries(stage.cost))p.incorporated[i as keyof Inventory]=(p.incorporated[i as keyof Inventory]??0)+n!;stage.paid=true;}
 stage.worked+=Math.min(dt,stage.minutes-stage.worked,r.activity.remaining);p.lastAt=w.minute;
 return null;
}
export function completePasture(w:World,r:Resident,a:IndustryAction):string|null {
 const target=pastureTarget(w,r,a);if(target.error)return target.error;
 if(r.inside||!same(r.at,target.target))return '须本人实际到达牧场入口或水槽';
 if(a.operation==='planPasture'){
  const right=w.landRights!.applications.find(p=>p.id===a.landRightId)!;
  const p:PastureProject={id:'pasture-project:'+w.industry!.nextSerial++,ownerId:r.id,landRightId:right.id,barnId:right.barnId!,parentId:right.pastureId,springId:right.springId!,at:{...right.at},width:right.width,height:right.height,door:{...right.door},createdAt:w.minute,expiresAt:Math.min(right.expiresAt!,w.minute+7*DAY),status:'building',stage:0,stages:[{name:'现场整理',minutes:30,worked:0,cost:{},paid:false},{name:'围栏与可通行门',minutes:60,worked:0,cost:{wood:14},paid:false},{name:'实际水槽',minutes:45,worked:0,cost:{wood:2,stone:4},paid:false}],incorporated:{},lastAt:-1,fenceBuilt:false};
  (w.industry!.pastureProjects??=[]).push(p);fact(w,r,`${r.name}安排本人牧场施工，7日内分阶段亲自做135分钟、投入16木4石；不自动供料、雇人或生出草水。`);
 }else if(['workPasture','cancelPasture','clearPasture'].includes(a.operation)){
  const p=w.industry!.pastureProjects!.find(p=>p.id===a.projectId)!;
  if(a.operation==='cancelPasture'){p.status='cancelled';fact(w,r,`${r.name}停止牧场施工，实际围栏与原投入仍留在现场。`);}
  else if(a.operation==='clearPasture'){
   for(const [i,n]of Object.entries(p.incorporated))r.inventory[i as keyof Inventory]=(r.inventory[i as keyof Inventory]??0)+Math.floor(n!*.5);p.status='removed';p.fenceBuilt=false;fact(w,r,`${r.name}亲自清理已停止牧场工程，回收实际投入木石的一半，剩余为施工损耗。`);
  }else{
   const stage=p.stages[p.stage];if(stage.worked<stage.minutes)return null;
   const error=workSiteError(w,p,true);if(error)return error;
   if(p.stage===1)p.fenceBuilt=true;p.stage++;
   if(p.stage===p.stages.length){
    const tiles=Array.from({length:p.width*p.height},(_,i)=>({x:p.at.x+i%p.width,y:p.at.y+Math.floor(i/p.width)}));
    const inside={x:p.door.x,y:p.door.y-1};
    (w.industry!.pastures??=[]).push({id:'pasture:'+w.industry!.nextSerial++,barnId:p.barnId,ownerId:p.ownerId,parentId:p.parentId,landRightId:p.landRightId,springId:p.springId,tiles,capacity:tiles.length*4,forage:0,lastMinute:w.minute,expiresAt:w.landRights!.applications.find(a=>a.id===p.landRightId)!.expiresAt!,gate:{inside,outside:{...p.door}},fenced:true,fence:{condition:100,lastMinute:w.minute,woodUsed:0,repairs:0},status:'open',trough:{at:{...inside},capacity:8,water:0,delivered:0,consumed:0}});
    p.status='completed';fact(w,r,`${r.name}完成牧场，实际围栏留一入口，8份容量的水槽仍为空；草地从零逐渐恢复，畜舍栏位没有增加。`);
   }else fact(w,r,`${r.name}完成牧场${stage.name}，下一阶段须重新决定。`);
  }
 }else{
  const p=w.industry!.pastures!.find(p=>p.id===a.pastureId)!;
  if(a.operation==='repairFence'){
   const f=p.fence!,repair=f.repair;
   if(!repair||a.fenceRepairId!==repair.id)return '没有本人实际开始的围栏修护批次';
   if(repair.worked>=repair.minutes){
    f.condition=Math.min(100,f.condition+repair.restore);f.repairs++;delete f.repair;
    fact(w,r,`${r.name}在原牧场入口完成${repair.minutes}分钟围栏修护，使用已投入的${repair.wood}木材，恢复至${f.condition.toFixed(1)}%；原草水、牲畜位置和用地期限不变。`);
   }
  }else if(a.operation==='fillTrough'){take(r,{water:1});p.trough!.water++;p.trough!.delivered++;fact(w,r,`${r.name}亲自向牧场水槽送达本人1份清水；未被牲畜实际喝下前不算照料。`);}
  else if(a.operation==='drainTrough'){p.trough!.drained=(p.trough!.drained??0)+p.trough!.water;p.trough!.water=0;fact(w,r,`${r.name}亲自排空水槽余水，记录为排放损耗，不产生可饮水或返还库存。`);}
  else if(a.operation==='installTrough'){take(r,{wood:2,stone:4});p.trough={at:{...(p.gate?.inside??p.tiles[0])},water:0,capacity:8,delivered:0,consumed:0};fact(w,r,`${r.name}用本人2木4石安装8份容量的空水槽。`);}
  else if(a.operation==='restPasture'){p.status='resting';fact(w,r,`${r.name}让已迁空的牧场休牧，保留当时草量、设施和用地期限。`);}
  else if(a.operation==='openPasture'){p.status='open';fact(w,r,`${r.name}在原有效用地期限内重新开放休牧场，不重置草水。`);}
  else {p.status='retired';p.fenced=false;fact(w,r,`${r.name}亲自撤去空牧场围栏，草地按剩余草量恢复；没有新物资或自动续约。`);}
 }
 r.revision++;w.revision++;return null;
}
export function advancePastureProjects(w:World){
 for(const p of w.industry?.pastureProjects??[])if(p.status==='building'&&(p.expiresAt<=w.minute||!w.residents.some(r=>r.id===p.ownerId&&r.status==='alive'&&r.residency==='resident')||!w.landRights?.applications.some(a=>a.id===p.landRightId&&a.status==='registered'&&(a.expiresAt??0)>w.minute)))p.status='expired';
 for(const p of w.industry?.pastures??[])if(p.landRightId&&!['expired','retired'].includes(p.status??'open')&&(!w.landRights?.applications.some(a=>a.id===p.landRightId&&a.status==='registered'&&(a.expiresAt??0)>w.minute)))p.status='expired';
}
export function pastureOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const out:FormalOpportunity[]=[],add=(id:string,label:string,a:IndustryAction)=>{if(!pastureTarget(w,r,a).error)out.push({id:'industry.pasture.'+id,label,action:a});};
 for(const right of w.landRights?.applications??[])if(right.purpose==='pasture'&&right.applicantId===r.id&&(right.knownStatus?.[r.id]??right.status)==='registered'){
  if(distance(r.at,right.door)>16||r.inside){out.push({id:'industry.pasture.visit.'+right.id,label:'到本人已登记的牧场用地查看入口、供水路线和施工条件',action:{type:'move',to:{...right.door}}});continue;}
  add('plan.'+right.id,'在本人有效牧场用地安排实际施工：7日内亲自分阶段135分钟、16木4石，围栏、水槽和草量分别计量',{type:'industry',operation:'planPasture',landRightId:right.id});
 }
 for(const p of w.industry?.pastureProjects??[])if(p.ownerId===r.id&&!['completed','removed'].includes(p.status)){
  if(distance(r.at,p.door)>16||r.inside){out.push({id:'industry.pasture.project.'+p.id,label:'亲自到本人的牧场工程查看进度或清理遗留物',action:{type:'move',to:{...p.door}}});continue;}
  add('work.'+p.id,`本人施工30分钟：${p.stages[p.stage]?.name??'已完工'}，不自动跨阶段或召集别人`,{type:'industry',operation:'workPasture',projectId:p.id,stage:p.stage,minutes:30});
  add('cancel.'+p.id,'停止本人牧场工程，保留已投入材料与实际围栏',{type:'industry',operation:'cancelPasture',projectId:p.id});
  add('clear.'+p.id,'本人花60分钟清理已停止的牧场工程，回收实际投入木石的一半',{type:'industry',operation:'clearPasture',projectId:p.id});
 }
 for(const p of w.industry?.pastures??[]){
  // Never leak a remote fence's current damage or repair progress into a resident's menu.
  if(owned(w,r,p)&&p.status!=='retired'&&r.knownBuildings.includes(p.barnId)&&!r.inside&&distance(r.at,gate(p))<=16){
   const repair=p.fence?.repair;
   add('repair.'+p.id,`本人到原入口修护围栏30分钟：现状${pastureFenceCondition(p).toFixed(1)}%，${repair?'原批次已投入'+repair.wood+'木、实际劳动'+repair.worked.toFixed(1)+'/'+repair.minutes+'分钟，继续余下工时':'需本人4木材、累计60分钟，完成恢复最多40%'}；不续用地、不移动动物`,{type:'industry',operation:'repairFence',pastureId:p.id,fenceRepairId:repair?.id,minutes:30});
  }
  for(const [operation,label]of [['installTrough','本人花45分钟、2木4石安装空水槽'],['fillTrough','亲自把本人1份水送入实际水槽，水用完需再送'],['drainTrough','本人花10分钟实际排空水槽余水，记为排放损耗，不返还库存'],['restPasture','在动物已实际迁出后让本牧场休牧'],['openPasture','在原有效期限内重新开放休牧场'],['retirePasture','在所有动物已迁出、槽水已实际排空后花60分钟撤栏，保留剩余草量记录']] as const)add(operation+p.id,label,{type:'industry',operation,pastureId:p.id});
 }
 return out;
}
