import {initializeLandTransfers,advanceLandTransfers,isLandTransfer,landTransferReason,landTransferTarget,completeLandTransfer,landTransferOpportunities} from './land-transfers.js';
import {retainedOutdoorSites} from '../shared/land-use.js';
import type {FormalOpportunity,Resident,Vec,World} from '../shared/types.js';
import type {LandApplication,LandRightsAction,LandPurpose} from '../shared/land-rights.js';
import {inLand,landOverlap,landPurposeNames,reservedLandRights} from '../shared/land-rights.js';
import {productionParcels} from './production.js';
import {pastureContains} from './pasture.js';
import {distance,findPath,reachableTiles,same,walkable} from './navigation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {ageYears,DAY} from './time.js';
import {buildingBlueprints} from './building-blueprints.js';
import type {ConstructionProject} from '../shared/construction.js';

const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress;
const elector=(w:World,r:Resident)=>r.status==='alive'&&r.residency==='resident'&&ageYears(r.bornAt,w.minute)>=18;
const citizen=(w:World,r:Resident)=>capable(w,r)&&elector(w,r);
const board=(w:World,id:string)=>w.buildings.find(b=>b.id===id&&b.ownerId==='commons'&&b.condition>0);
const applications=(w:World)=>w.landRights?.applications??[];
const open=(a:LandApplication)=>['surveyed','notice','voting','approved'].includes(a.status);
const localBoard=(w:World,r:Resident,a:LandApplication)=>{const b=board(w,a.boardId);return b&&r.knownBuildings.includes(b.id)&&!r.inside&&distance(r.at,b.door)<=8?b:undefined;};
const summary=(a:LandApplication)=>`${landPurposeNames[a.purpose]}建设权，(${a.at.x},${a.at.y}) ${a.width}×${a.height}格、入口(${a.door.x},${a.door.y})，登记后${a.days}日；不授予永久土地所有权、取水量或施工材料`;
function fact(w:World,a:LandApplication,r:Resident|undefined,text:string,place=a.door){const e=emitEvent(w,{kind:'construction',actors:r?[r.id]:[],place:{...place},text});a.eventIds.push(e.id);a.knownStatus??={};for(const id of [...e.witnesses,...(r?[r.id]:[])])a.knownStatus[id]=a.status;return e.id;}
function boardFact(w:World,a:LandApplication,text:string){const b=board(w,a.boardId);if(b)fact(w,a,undefined,text,b.door);else a.eventIds.push(emitLedgerEvent(w,{kind:'construction',actors:[],place:{...a.door},text}).id);}
const pendingFor=(a:LandApplication,r:Resident)=>open(a)||a.status==='registered'||a.status==='review'||['surveyed','notice','voting','approved','registered','review'].includes(a.knownStatus?.[r.id]??'surveyed');
export function initializeLandRights(w:World){if(w.mode!=='formal')return;w.landRights??={nextSerial:1,applications:[]};initializeLandTransfers(w);w.definitions['land/pasture@1']??={id:'land/pasture',version:1,kind:'action',dependencies:[],data:{width:4,height:3,scope:'有限期牧场用地；实际围栏、水槽、草量、运水及护送分别核验'}};w.definitions['land/rights@1']??={id:'land/rights',version:1,kind:'action',dependencies:[],data:{noticeMinutes:DAY,maxDays:28,scope:'现场勘察、至少一日公示、异议、固定选民独立表决及有限期私人建设权；无租售或自动续期'}};}
function candidate(w:World,r:Resident,a:LandRightsAction):LandApplication|null {
 if(!a.at||!Number.isSafeInteger(a.at.x)||!Number.isSafeInteger(a.at.y)||!a.purpose||!Object.hasOwn(landPurposeNames,a.purpose)||!Number.isSafeInteger(a.days)||a.days!<1||a.days!>28)return null;
 if(a.purpose==='pasture'&&(!a.barnId||!r.knownBuildings.includes(a.barnId)))return null;
 const blueprint=a.purpose==='pasture'?{definition:'land/pasture@1',def:{data:{width:4,height:3}}}:buildingBlueprints(w,r).find(b=>b.kind===a.purpose&&b.definition===w.activeDefinitions[`building/${a.purpose}`]);
 if(!blueprint)return null;
 const width=Number(blueprint.def.data.width),height=Number(blueprint.def.data.height);
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||height<2||width>24||height>24)return null;
 const b=w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&b.ownerId==='commons').sort((x,y)=>distance(r.at,x.door)-distance(r.at,y.door))[0];if(!b)return null;
 return {id:'candidate',applicantId:r.id,boardId:b.id,boardDoor:{...b.door},boardName:b.name,at:{...a.at},width,height,door:{x:a.at.x+Math.floor(width/2),y:a.at.y+height},purpose:a.purpose,...(a.purpose==='pasture'?{barnId:a.barnId,pastureId:a.pastureId,springId:w.resources.filter(s=>s.kind==='spring'&&r.knownResources.includes(s.id)).sort((s,t)=>distance(a.at!,s.at)-distance(a.at!,t.at)).find(s=>findPath(w,{x:a.at!.x+Math.floor(width/2),y:a.at!.y+height},s.at,true,80)!==null)?.id}:{}),definition:blueprint.definition,days:a.days!,surveyedAt:w.minute,postedAt:null,noticeUntil:null,closesAt:null,registerBefore:null,registeredAt:null,expiresAt:null,status:'surveyed',electorate:[],votes:{},objections:[],protectedAccess:{buildingIds:w.buildings.map(b=>b.id),springIds:w.resources.filter(s=>s.kind==='spring').map(s=>s.id),projectIds:w.construction?.projects.filter(p=>p.reserved).map(p=>p.id)??[]},eventIds:[],reason:null};
}
/** Empty commons only. All pre-existing uses win; no eviction or taking of private land. */
export function landSiteError(w:World,a:LandApplication,access=false):string|null {
 const {at,width,height}=a;
 if(a.purpose==='pasture'){
  const barn=w.buildings.find(b=>b.id===a.barnId),spring=w.resources.find(s=>s.id===a.springId&&s.kind==='spring');
  if(!barn||barn.kind!=='barn'||barn.condition<=0||!(barn.ownerId==='commons'||barn.ownerId===a.applicantId||barn.residents.includes(a.applicantId)))return '牧场须有实际可用且有使用权的畜舍';
  if(!spring||findPath(w,a.door,spring.at,true,80)===null||findPath(w,a.door,barn.door,false,80)===null)return '须有真实可达的畜舍入口和已勘察供水路线';
  if(a.pastureId){const parent=w.industry?.pastures?.find(p=>p.id===a.pastureId&&p.barnId===barn.id&&p.status!=='retired');if(!parent||parent.ownerId&&parent.ownerId!==a.applicantId||!parent.tiles.some(t=>distance(t,{x:Math.max(at.x,Math.min(at.x+width-1,t.x)),y:Math.max(at.y,Math.min(at.y+height-1,t.y))})===1))return '扩建须与本人可用的原牧场相连，不得占用他人牧场';}
 }

 if(at.x<1||at.y<1||at.x+width>=w.map.width||at.y+height>=w.map.height||!w.definitions[a.definition])return '范围或原图纸已无效';
 if(retainedOutdoorSites(w).some(p=>inLand({...at,width,height},p)))return '原址仍有未葬遗体或封存实物，不能占用';
 if(reservedLandRights(w).some(b=>b.id!==a.id&&landOverlap(a,b)))return '已有登记或保全中的有限用地，不能重复分配';
 if(productionParcels(w).some(p=>landOverlap(a,{at:p,width:p.width,height:p.height}))||Object.values(w.construction?.yards??{}).some(p=>landOverlap(a,{at:p,width:p.width,height:p.height})))return '已有私人地权或建筑院落，不能重新分配';
 if(w.construction?.projects.some(p=>p.reserved&&landOverlap(a,p)))return '已有施工预留，不能重新分配';
 for(let y=at.y;y<at.y+height;y++)for(let x=at.x;x<at.x+width;x++){
  const t={x,y};
  if(w.map.tiles[y*w.map.width+x]!=='grass'||w.resources.some(s=>same(s.at,t))||w.graves.some(g=>distance(g.at,t)<=1)||w.plots.some(p=>same(p.at,t))||pastureContains(w,t))return '包含道路、水源、自然资源、墓位、农田或牧场，不能授予建设权';
  if(w.buildings.some(b=>inLand({...b.at,width:b.width,height:b.height},t)||distance(b.door,t)<=1)||w.residents.some(r=>r.status==='alive'&&r.residency!=='outside'&&!r.inside&&same(r.at,t)))return '已有建筑、出入口或实际在场者，不能占用';
  if(w.infrastructure?.assets.some(s=>s.retiredAt===null&&[...s.tiles.map(t=>t.at),...(s.anchors??[s.access])].some(p=>same(p,t)))||w.construction?.projects.some(p=>p.reserved&&p.terrain?.anchors.some(q=>same(q,t))))return '已有公共通路或工程接入权';
 }
 if(!walkable(w,a.door))return '实际施工入口不可达';
 if(!access)return null;
 // Consider already granted footprints together, although a grant itself never blocks walking.
 const granted=reservedLandRights(w).filter(p=>p.id!==a.id).map(p=>({...p,reserved:true,mode:'new'} as unknown as ConstructionProject));
 const current={...w,construction:{...w.construction!,projects:[...(w.construction?.projects??[]),...granted]}};
 const afterWorld={...current,construction:{...current.construction,projects:[...current.construction.projects,{...a,reserved:true,mode:'new'} as unknown as ConstructionProject]}};
 const before=reachableTiles(current),after=reachableTiles(afterWorld),index=(p:Vec)=>p.y*w.map.width+p.x;
 const reachable=(seen:Uint8Array,p:Vec,adjacent=false)=>!!seen[index(p)]||adjacent&&[{x:p.x-1,y:p.y},{x:p.x+1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1}].some(q=>q.x>=0&&q.y>=0&&q.x<w.map.width&&q.y<w.map.height&&seen[index(q)]);
 const places=[...retainedOutdoorSites(w),w.map.entrance,...w.buildings.map(b=>b.door),...(w.construction?.projects.filter(p=>p.reserved).map(p=>p.door)??[]),...reservedLandRights(w).filter(p=>p.id!==a.id).map(p=>p.door),...w.residents.filter(r=>r.status==='alive'&&r.residency!=='outside'&&!r.inside).map(r=>r.at),...w.plots.map(p=>p.at),...(w.industry?.pastures?.flatMap(p=>p.tiles)??[])];
 const privateAccess=productionParcels(w).flatMap(p=>{const cells:Vec[]=[];for(let y=Math.max(0,p.y);y<Math.min(w.map.height,p.y+p.height);y++)for(let x=Math.max(0,p.x);x<Math.min(w.map.width,p.x+p.width);x++)cells.push({x,y});return cells;});
 if(privateAccess.some(p=>reachable(before,p)&&!reachable(after,p)))return '拟占地会阻断原有私人地块的可达通路';
 if(!reachable(after,a.door)||places.some(p=>reachable(before,p)&&!reachable(after,p))||w.resources.filter(s=>s.kind==='spring').some(s=>reachable(before,s.at,true)&&!reachable(after,s.at,true)))return '拟占地会阻断现住户、相邻地块、工地、牧场或取水通路';
 return null;
}
function passed(a:LandApplication){const ids=[...new Set(a.electorate)],yes=ids.filter(id=>a.votes[id]===true).length,no=ids.filter(id=>a.votes[id]===false).length;return ids.length>=3&&yes>=2&&yes>no&&yes+no>=Math.max(2,Math.ceil(ids.length/2));}
function protectedUse(w:World,a:LandApplication){return !!w.industry?.pastures?.some(p=>p.landRightId===a.id&&p.status!=='retired')||!!w.industry?.pastureProjects?.some(p=>p.landRightId===a.id&&!['completed','removed'].includes(p.status))||w.buildings.some(b=>landOverlap(a,b))||w.construction?.projects.some(p=>landOverlap(a,p)&&(p.stock.length||p.claims.length||!['removed','cancelled'].includes(p.status)&&Object.values(p.incorporated).some(n=>n!>0)));}
export function advanceLandRights(w:World){
 initializeLandRights(w);if(!w.landRights)return;advanceLandTransfers(w);
 for(const a of applications(w)){
  if(a.status==='review'&&!protectedUse(w,a)){a.status='expired';a.reason='已实际清场，有限用地保全结束';}
  if(a.status==='notice'&&w.minute>=a.noticeUntil!){a.status='voting';boardFact(w,a,`用地公示已满一日，开始分别表决：${summary(a)}。`);}
  if(a.status==='voting'){
   const yes=a.electorate.filter(id=>a.votes[id]===true).length,no=a.electorate.filter(id=>a.votes[id]===false).length,majority=Math.max(2,Math.floor(a.electorate.length/2)+1);
   if(w.minute>=a.closesAt!||yes>=majority||no>=majority){a.status=passed(a)?'approved':'rejected';if(a.status==='approved')a.registerBefore=Math.max(a.closesAt!,Math.min(w.minute,a.closesAt!)+DAY);boardFact(w,a,`用地表决${yes}赞成、${no}反对，固定选民${a.electorate.length}人：${a.status==='approved'?'仅批准原具体条款，申请人仍须到现场登记':'未通过'}。`);}
  }
  if(a.status==='surveyed'&&w.minute>=a.surveyedAt+7*DAY||['notice','voting'].includes(a.status)&&w.minute>=a.closesAt!||a.status==='approved'&&w.minute>=(a.registerBefore??a.closesAt!)){a.status='expired';a.reason='勘察或登记期限已过，未授予用地';}
  if(a.status==='registered'&&((a.expiresAt??0)<=w.minute||!w.residents.some(r=>r.id===a.applicantId&&r.status==='alive'&&r.residency==='resident'))){a.status=protectedUse(w,a)?'review':'expired';a.reason='有限用地到期或原申请人无法继续持有；不自动续期或转让';fact(w,a,undefined,`${a.reason}。${a.status==='review'?'现场建筑、现住户、租约、已投入物资与工资原账保留，新增施工停止，等待另行复核':'未投入占地已释放'}。`);}
 }
}
export function landRightsReason(w:World,r:Resident,a:LandRightsAction):string|null {
 if(isLandTransfer(a))return landTransferReason(w,r,a);
 if(w.mode!=='formal'||!capable(w,r))return '本人目前不能处理用地事项';
 if(a.operation==='survey'){
  if(!citizen(w,r)||r.inside)return '须由成年常住居民亲自勘察';
  if(applications(w).some(p=>p.applicantId===r.id&&pendingFor(p,r)&&!(a.purpose==='pasture'&&p.purpose==='pasture'&&p.status==='registered')))return '本人已有待办或有效有限用地，请先处理原安排';
  const p=candidate(w,r,a);if(!p)return '须有已知公告板、有效具体用途和1–28日期限';
  if([p.at,{x:p.at.x+p.width-1,y:p.at.y+p.height-1},p.door].some(t=>distance(r.at,t)>16))return '须亲自看到完整勘察范围';
  return landSiteError(w,p);
 }
 const p=applications(w).find(p=>p.id===a.applicationId);if(!p)return '没有这份真实勘察记录';
 if(a.operation==='register'){
  if(!citizen(w,r)||p.applicantId!==r.id||p.status!=='approved'||!passed(p)||p.objections.length||w.minute>=(p.registerBefore??p.closesAt!))return '尚无有效、无异议的合规议决，或已过登记期限/不足三位成年选民';
  return null;
 }
 if(a.operation==='withdraw')return p.applicantId===r.id&&p.registeredAt===null&&p.status!=='cancelled'&&!r.inside&&distance(r.at,p.boardDoor)<=8?null:'须本人到原公告地址撤回尚未登记的申请';
 if(!localBoard(w,r,p))return '须亲自到原公告板查看并办理，不能远方获知公示或投票';
 if(a.operation==='read')return p.postedAt!==null||p.applicantId===r.id?null:'尚未公开的他人勘察';
 if(a.operation==='post'){
  if(!citizen(w,r)||p.applicantId!==r.id||p.status!=='surveyed'||w.minute>=p.surveyedAt+7*DAY)return '只能公示本人七日内的勘察';
  if(w.residents.filter(s=>elector(w,s)).length<3)return '不足三位成年常住选民，不能新分配共同土地';
  return null;
 }
 if(a.operation==='object')return ['notice','voting','approved'].includes(p.status)&&w.minute<(p.status==='approved'?(p.registerBefore??p.closesAt!):p.closesAt!)&&ageYears(r.bornAt,w.minute)>=6?null:'本次公示已结束或本人无法提出异议';
 if(a.operation==='vote')return citizen(w,r)&&p.status==='voting'&&w.minute>=p.noticeUntil!&&w.minute<p.closesAt!&&p.electorate.includes(r.id)&&!Object.hasOwn(p.votes,r.id)&&typeof a.accept==='boolean'?null:'未满一日公示、本人无未行使的原表决权或表决已结束';
 return '未知用地行动';
}
export function landRightsTarget(w:World,r:Resident,a:LandRightsAction){if(isLandTransfer(a))return landTransferTarget(w,r,a);const error=landRightsReason(w,r,a);if(error)return {target:r.at,duration:0,error};const p=a.operation==='survey'?candidate(w,r,a)!:applications(w).find(p=>p.id===a.applicationId)!;return {target:{...(a.operation==='survey'||a.operation==='register'?p.door:a.operation==='withdraw'?p.boardDoor:board(w,p.boardId)!.door)},duration:a.operation==='survey'?30:a.operation==='post'||a.operation==='register'?10:5};}
export function completeLandRights(w:World,r:Resident,a:LandRightsAction):string|null {
 if(isLandTransfer(a)){initializeLandRights(w);return completeLandTransfer(w,r,a);}
 initializeLandRights(w);const target=landRightsTarget(w,r,a);if(target.error)return target.error;if(r.inside||!same(r.at,target.target))return '须本人实际到达勘察地或原公告板';
 let p=a.operation==='survey'?candidate(w,r,a)!:applications(w).find(p=>p.id===a.applicationId)!;
 if(a.operation==='register'&&w.residents.filter(s=>elector(w,s)).length<3)return '登记时不足三位成年常住选民，不能新分配共同土地';
 if(['survey','register'].includes(a.operation)){const error=landSiteError(w,p,true);if(error)return error;}
 if(a.operation==='survey'){p.id=`land:${w.id}:${w.landRights!.nextSerial++}`;w.landRights!.applications.push(p);fact(w,p,r,`${r.name}实际勘察${summary(p)}。既有通路、取水及他人权利优先；勘察未预留土地。`);}
 else if(a.operation==='post'){p.status='notice';p.postedAt=w.minute;p.noticeUntil=w.minute+DAY;p.closesAt=p.noticeUntil+4*DAY;p.electorate=[...new Set(w.residents.filter(s=>elector(w,s)).map(s=>s.id))];fact(w,p,r,`${r.name}公开用地边界与原勘察：${summary(p)}。至少一日供现场居民提出异议，之后固定成年选民独立表决。`,target.target);}
 else if(a.operation==='object'){p.status='objected';p.reason='实际居民提出异议，原申请停止，不能由多数直接覆盖';const eventId=fact(w,p,r,`${r.name}亲自在公告板提出用地异议：${summary(p)}。原申请停止，须另行商议后重新勘察公示。`,target.target);p.objections.push({personId:r.id,at:w.minute,eventId});}
 else if(a.operation==='vote'){p.votes[r.id]=a.accept!;fact(w,p,r,`${r.name}独立${a.accept?'赞成':'反对'}：${summary(p)}。`,target.target);advanceLandRights(w);}
 else if(a.operation==='register'){p.status='registered';p.registeredAt=w.minute;p.expiresAt=w.minute+p.days*DAY;fact(w,p,r,`${r.name}持原无异议议决亲自登记${summary(p)}。地权现在生效，施工、筹资、供料与劳动仍各自决定。`);}
 else if(a.operation==='read'){p.knownStatus??={};p.knownStatus[r.id]=p.status;fact(w,p,r,`${r.name}亲自查阅原用地公告板，获知记录状态：${p.status}。原期限和条款未改变。`,target.target);}
 else if(a.operation==='withdraw'){p.status='cancelled';p.reason='申请人自行撤回';fact(w,p,r,`${r.name}自行撤回未登记的用地申请。`,target.target);}
 r.revision++;w.revision++;return null;
}
export function landRightsOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!capable(w,r))return [];
 const choices:FormalOpportunity[]=[],add=(id:string,label:string,a:LandRightsAction)=>{const p=applications(w).find(p=>p.id===a.applicationId);const post=a.operation==='post'&&p?.applicantId===r.id&&p.status==='surveyed'&&w.minute<p.surveyedAt+7*DAY&&citizen(w,r)&&!!localBoard(w,r,p);if(post||!landRightsReason(w,r,a))choices.push({id:'land.'+id,label,action:a});};
 for(const p of applications(w)){
  if(p.applicantId===r.id&&pendingFor(p,r)&&!localBoard(w,r,p)){choices.push({id:'land.board.'+p.id,label:`亲自到原${p.boardName}地址查看用地公告，远处进展和屋况未知`,action:{type:'move',to:{...p.boardDoor}}});}
  add('withdraw.'+p.id,`在原公告地址撤回本人尚未登记的${summary(p)}申请；不要求原建筑完好，不改变他人的产权`,{type:'landRights',operation:'withdraw',applicationId:p.id});
  if(localBoard(w,r,p)){
   if(p.knownStatus?.[r.id]!==p.status)add('read.'+p.id,`亲自查阅原公告板的用地记录：${summary(p)}，取得状态证据，原条款不变`,{type:'landRights',operation:'read',applicationId:p.id});
   add('post.'+p.id,`公示本人已勘察的${summary(p)}；公示至少一日，仍未预留用地`,{type:'landRights',operation:'post',applicationId:p.id});
   add('object.'+p.id,`对${summary(p)}提出异议，停止本申请，不能由多数自动覆盖`,{type:'landRights',operation:'object',applicationId:p.id});
   for(const accept of [true,false])add('vote.'+p.id+'.'+accept,`${accept?'赞成':'反对'}${summary(p)}；一人一票，不替他人决定`,{type:'landRights',operation:'vote',applicationId:p.id,accept});
   add('register.'+p.id,`持通过的原条款，亲自到现场登记${summary(p)}；现场失效则不登记`,{type:'landRights',operation:'register',applicationId:p.id});
  }

 }
 if(citizen(w,r)&&!r.inside&&!applications(w).some(p=>p.applicantId===r.id&&pendingFor(p,r))){
  for(const purpose of Object.keys(landPurposeNames).filter(p=>p!=='pasture') as LandPurpose[]){let found=false;for(const dx of [-6,2])for(const dy of [-6,2]){if(found)continue;const before=choices.length;add('survey.'+purpose,`亲自勘察眼前新${landPurposeNames[purpose]}用地，拟申请14日建设权；可填x/y和days 1–28。勘察不取得地权，须公告一日、无异议、独立表决及登记`,{type:'landRights',operation:'survey',purpose,at:{x:r.at.x+dx,y:r.at.y+dy},days:14});found=choices.length>before;}}
 }
 if(citizen(w,r)&&!r.inside){
  for(const barn of w.buildings.filter(b=>b.kind==='barn'&&r.knownBuildings.includes(b.id)&&distance(r.at,b.door)<=16)){
   const parents=[undefined,...(w.industry?.pastures??[]).filter(p=>p.barnId===barn.id&&p.status!=='retired'&&(!p.ownerId||p.ownerId===r.id))];
   for(const parent of parents){let found=false;const sites=parent?parent.tiles.flatMap(t=>[{x:t.x+1,y:t.y},{x:t.x-4,y:t.y},{x:t.x,y:t.y+1},{x:t.x,y:t.y-3}]):[-6,2].flatMap(dx=>[-6,2].map(dy=>({x:r.at.x+dx,y:r.at.y+dy})));
    for(const at of sites){if(found)break;const count=choices.length;add('survey.pasture.'+barn.id+'.'+(parent?.id??'new'),`亲自勘察${parent?'相连扩建分区':'新牧场'}4×3格，拟用14日，保留通路、畜舍与供水路线；公告一日并独立表决后才能登记，围栏水槽另需本人16木4石及135分钟；可填x/y、days`,{type:'landRights',operation:'survey',purpose:'pasture',barnId:barn.id,pastureId:parent?.id,at,days:14});found=choices.length>count;}
   }
  }
 }
 return [...choices,...landTransferOpportunities(w,r)];
}

export function parseLandRightsChoice(a:LandRightsAction,data:Record<string,unknown>):LandRightsAction {const result=structuredClone(a);if(a.operation==='offerParcel'&&data.price!==undefined){if(typeof data.price!=='number'||!Number.isSafeInteger(data.price)||data.price<1||data.price>100000)throw new Error('invalid_land_price');result.price=data.price;}if(a.operation==='survey')for(const key of ['x','y','days'] as const){const value=data[key];if(value===undefined)continue;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<(key==='days'?1:0)||value>(key==='days'?28:100000))throw new Error('invalid_land_terms');if(key==='days')result.days=value;else result.at![key]=value;}return result;}
