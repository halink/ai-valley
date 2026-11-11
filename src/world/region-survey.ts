import type {FormalOpportunity,Resident,Tile,Vec,World} from '../shared/types.js';
import type {RegionSurvey,RegionSurveyAction} from '../shared/region-survey.js';
import {REGION_DEPTH,REGION_HALF_SPAN} from '../shared/region-survey.js';
import {goods,itemKeys} from '../shared/items.js';
import {ageYears,DAY} from './time.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {openRegion,type RegionPlan} from './region-extension.js';
import {inheritReceiptHistory} from './receipts.js';

const surveys=(w:World)=>w.regionSurveys?.surveys??[];
const capable=(r:Resident)=>r.status==='alive'&&r.health>0&&r.residency!=='outside'&&r.canDecide&&r.canExpress;
const elector=(w:World,r:Resident)=>r.status==='alive'&&r.residency==='resident'&&ageYears(r.bornAt,w.minute)>=18;
const adult=(w:World,r:Resident)=>capable(r)&&elector(w,r);
const active=(s:RegionSurvey)=>['surveyed','notice','voting','approved'].includes(s.status);
const pendingFor=(s:RegionSurvey,r:Resident)=>active(s)||['surveyed','notice','voting','approved'].includes(s.knownStatus[r.id]??'surveyed');
const board=(w:World,s:RegionSurvey)=>w.buildings.find(b=>b.id===s.boardId&&b.ownerId==='commons'&&b.condition>0&&same(b.door,s.boardDoor));
const atBoard=(w:World,r:Resident,s:RegionSurvey)=>!!board(w,s)&&r.knownBuildings.includes(s.boardId)&&!r.inside&&distance(r.at,s.boardDoor)<=8;
const tool=(w:World,r:Resident,id:string)=>w.industry?.tools.find(t=>t.id===id&&t.ownerId===r.id&&t.kind==='axe'&&!t.location&&t.durability>=1);
function carriedFood(w:World,r:Resident){return itemKeys.find(i=>goods[i].food>0&&(r.inventory[i]??0)>=1&&(w.food?.lots['person:'+r.id]?.[i]??[]).filter(l=>l.expiresAt>w.minute+120).reduce((n,l)=>n+l.quantity,0)>=1);}
function supplyError(w:World,r:Resident,id:string){return !tool(w,r,id)?'须携带本人现有且耐久不少于1的斧具，不能使用封存或他人工具':!carriedFood(w,r)||(r.inventory.water??0)<2?'须携带至少一份保质期超过两小时的自有食品及两份清水；不会自动进食或补给':null;}
export function initializeRegionSurveys(w:World){if(w.mode==='formal')w.regionSurveys??={nextSerial:1,surveys:[]};}
function boundaryError(w:World,edge:string,at:Vec,width=w.map.width,height=w.map.height):string|null {
 if(width!==w.map.width||height!==w.map.height)return '原地图边界已经改变，须重新勘察和取得同意';
 if(!Number.isSafeInteger(at.x)||!Number.isSafeInteger(at.y)||!['east','south'].includes(edge)||edge==='east'&&(at.x!==width-1||at.y<3||at.y>=height-3)||edge==='south'&&(at.y!==height-1||at.x<3||at.x>=width-3))return '须在现有东侧或南侧实际边界勘察完整七格入口';
 const nw=width+(edge==='east'?REGION_DEPTH:0),nh=height+(edge==='south'?REGION_DEPTH:0);
 if(nw>2048||nh>2048||nw*nh>1048576)return '本地图已到有限区域接入尺寸上限';
 if(!walkable(w,at)||findPath(w,w.map.entrance,at)===null)return '原入口与谷口没有实际可达通路';
 return null;
}
function summary(s:RegionSurvey){return `${s.edge==='east'?'东':'南'}侧边界(${s.at.x},${s.at.y})外八格深、七格宽的空草地入口；不登记自然库存、道路或桥梁，不授予土地、施工、取水或经营权`;}
function fact(w:World,s:RegionSurvey,r:Resident|undefined,text:string,place=s.at){
 const e=emitEvent(w,{kind:'construction',actors:r?[r.id]:[],place:{...place},text});s.eventIds.push(e.id);
 for(const id of [...e.witnesses,...(r?[r.id]:[])])s.knownStatus[id]=s.status;
}
function boardFact(w:World,s:RegionSurvey,text:string){if(board(w,s))fact(w,s,undefined,text,s.boardDoor);else s.eventIds.push(emitLedgerEvent(w,{kind:'construction',actors:[],place:{...s.at},text}).id);}
const passed=(s:RegionSurvey)=>{const ids=[...new Set(s.electorate)],yes=ids.filter(id=>s.votes[id]===true).length;return ids.length>=3&&yes>=Math.max(2,Math.floor(ids.length/2)+1);};
export function advanceRegionSurveys(w:World){
 initializeRegionSurveys(w);
 for(const s of surveys(w)){
  if(!active(s))continue;
  if(!board(w,s)||w.minute>=s.expiresAt||s.mapWidth!==w.map.width||s.mapHeight!==w.map.height||!w.residents.some(r=>r.id===s.applicantId&&elector(w,r))){s.status='expired';s.reason='原公告板、期限、边界或申请人常住资格已经改变；原记录保留，未开通新区域';boardFact(w,s,s.reason);continue;}
  if(s.status==='notice'&&w.minute>=s.noticeUntil!){s.status='voting';boardFact(w,s,'边界公示已满一日，固定选民可分别赞成或反对；任何现场异议停止本案。');}
  if(s.status==='voting'){
   const no=s.electorate.filter(id=>s.votes[id]===false).length;
   if(passed(s)||no>=Math.ceil(s.electorate.length/2)||w.minute>=s.closesAt!){s.status=passed(s)?'approved':'rejected';boardFact(w,s,`边界接入表决${s.status==='approved'?'通过，申请人仍须自行返回原边界办理':'未通过'}。${summary(s)}。`);}
  }
 }
}
export function regionSurveyReason(w:World,r:Resident,a:RegionSurveyAction):string|null {
 if(w.mode!=='formal'||!capable(r)||ageYears(r.bornAt,w.minute)<6)return '本人目前不能办理边界事项';
 if(a.operation==='survey'){
  if(!adult(w,r)||r.inside||distance(r.at,a.at)>8)return '须成年常住居民亲自到边界附近勘察';
  if(surveys(w).some(s=>s.applicantId===r.id&&pendingFor(s,r)))return '本人已有未完边界申请';
  if(!w.buildings.some(b=>b.ownerId==='commons'&&b.condition>0&&r.knownBuildings.includes(b.id)))return '须先知道实际公共公告板地址';
  return boundaryError(w,a.edge,a.at)??supplyError(w,r,a.toolId);
 }
 const s=surveys(w).find(s=>s.id===a.surveyId);if(!s)return '没有这份真实边界勘察';
 if(a.operation==='withdraw')return s.applicantId===r.id&&active(s)&&atBoard(w,r,s)?null:'须本人到原公告板撤回尚未开通的申请';
 if(a.operation==='open'){
  if(!adult(w,r)||s.applicantId!==r.id||s.knownStatus[r.id]!=='approved'||r.inside||!same(r.at,s.at))return '须本人实际读到通过结果，再自主返回原边界核验接入';
  if(s.status!=='approved'||!passed(s)||s.objections.length||w.minute>=s.expiresAt||w.residents.filter(p=>elector(w,p)).length<3)return '同意已失效、有异议、过期或不足三位成年常住选民';
  if(!board(w,s))return '原公共公告板已经失效，不能沿用原接入授权';
  return boundaryError(w,s.edge,s.at,s.mapWidth,s.mapHeight)??supplyError(w,r,a.toolId);
 }
 const inspectLostBoard=a.operation==='read'&&s.applicantId===r.id&&!active(s)&&!board(w,s)&&!r.inside&&distance(r.at,s.boardDoor)<=8;
 if(!atBoard(w,r,s)&&!inspectLostBoard)return '须亲自到原公共公告板读取与办理，不能远处获知议决';
 if(a.operation==='read')return s.postedAt!==null||s.applicantId===r.id?null:'他人尚未公开的勘察不能读取';
 if(!active(s)||w.minute>=s.expiresAt)return '原边界申请已经结束';
 if(a.operation==='post')return adult(w,r)&&s.applicantId===r.id&&s.status==='surveyed'&&w.residents.filter(p=>elector(w,p)).length>=3?boundaryError(w,s.edge,s.at,s.mapWidth,s.mapHeight):'须本人公示有效勘察，并有至少三位成年常住选民';
 if(a.operation==='object')return s.postedAt!==null?null:'尚未公开，不能提出公示异议';
 if(a.operation==='vote')return adult(w,r)&&s.status==='voting'&&w.minute>=s.noticeUntil!&&w.minute<s.closesAt!&&s.electorate.includes(r.id)&&!Object.hasOwn(s.votes,r.id)&&typeof a.accept==='boolean'?null:'本人没有尚未行使的当前表决权，或尚未满一日公示';
 return '未知边界行动';
}
export function regionSurveyTarget(w:World,r:Resident,a:RegionSurveyAction){
 const error=regionSurveyReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 const s=a.operation==='survey'?null:surveys(w).find(s=>s.id===a.surveyId)!;
 return {target:{...(a.operation==='survey'?a.at:a.operation==='open'?s!.at:s!.boardDoor)},duration:a.operation==='survey'?30:a.operation==='open'?15:5};
}
/** Only declared geometry is copied back. Hypothetical actions never enter the real town. */
function openSurvey(w:World,r:Resident,s:RegionSurvey):string|null {
 const width=w.map.width+(s.edge==='east'?REGION_DEPTH:0),height=w.map.height+(s.edge==='south'?REGION_DEPTH:0),tiles=Array<Tile>(width*height).fill('cliff');
 for(let y=0;y<w.map.height;y++)for(let x=0;x<w.map.width;x++)tiles[y*width+x]=w.map.tiles[y*w.map.width+x];
 for(let depth=1;depth<=REGION_DEPTH;depth++)for(let across=-REGION_HALF_SPAN;across<=REGION_HALF_SPAN;across++){
  const x=s.at.x+(s.edge==='east'?depth:across),y=s.at.y+(s.edge==='south'?depth:across);tiles[y*width+x]='grass';
 }
 const candidate=structuredClone(w);inheritReceiptHistory(w,candidate);
 const actor=candidate.residents.find(p=>p.id===r.id)!;actor.plan=null;actor.activity=null;
 // No other pending hypothetical project may recursively open more geography.
 for(const p of candidate.residents)if(p.id!==r.id){p.plan=null;p.activity=null;}
 const p:RegionPlan={id:s.id,name:`${r.name}勘察的${s.edge==='east'?'东':'南'}侧入口`,expectedRevision:w.revision,width,height,tiles,access:s.access,sources:[],fish:[],proof:{actorId:r.id,steps:[{kind:'act',actions:[{type:'move',to:{...s.access}}]}],required:{water:2},maxMinutes:30}};
 const result=openRegion(candidate,p);if(!result.ok)return result.error??'原接入证明失败';
 w.map=candidate.map;w.regions=candidate.regions;w.waterSupply=candidate.waterSupply;
 for(const receipt of candidate.processed.slice(w.processed.length))w.processed.push(receipt);
 return null;
}
export function completeRegionSurvey(w:World,r:Resident,a:RegionSurveyAction):string|null {
 const route=regionSurveyTarget(w,r,a);if(route.error)return route.error;
 if(r.inside||!same(r.at,route.target))return '须本人实际到达原边界或公告板并完成工作';
 initializeRegionSurveys(w);
 let s:RegionSurvey;
 if(a.operation==='survey'){
  const b=w.buildings.filter(b=>b.ownerId==='commons'&&b.condition>0&&r.knownBuildings.includes(b.id)).sort((a,b)=>distance(r.at,a.door)-distance(r.at,b.door))[0];
  s={id:`survey-${w.regionSurveys!.nextSerial++}`,applicantId:r.id,edge:a.edge,at:{...a.at},access:{x:a.at.x+(a.edge==='east'?1:0),y:a.at.y+(a.edge==='south'?1:0)},mapWidth:w.map.width,mapHeight:w.map.height,boardId:b.id,boardDoor:{...b.door},boardName:b.name,surveyedAt:w.minute,postedAt:null,noticeUntil:null,closesAt:null,expiresAt:w.minute+7*DAY,status:'surveyed',electorate:[],votes:{},objections:[],eventIds:[],knownStatus:{},supplies:{foodItem:carriedFood(w,r)!,water:2,toolId:a.toolId},openedAt:null,reason:null};
  tool(w,r,a.toolId)!.durability--;w.regionSurveys!.surveys.push(s);fact(w,s,r,`${r.name}实际花30分钟勘察并以原斧具作边界标记，耗1耐久；记录当时随身食品与清水。${summary(s)}。勘察没有开图、预留土地或保证后续供给。`);return null;
 }
 s=surveys(w).find(s=>s.id===a.surveyId)!;
 if(a.operation==='post'){s.status='notice';s.postedAt=w.minute;s.noticeUntil=w.minute+DAY;s.closesAt=w.minute+5*DAY;s.expiresAt=w.minute+7*DAY;s.electorate=w.residents.filter(p=>elector(w,p)).map(p=>p.id);fact(w,s,r,`${r.name}公开边界勘察，至少一日异议期后按固定选民过半且至少两人赞成。${summary(s)}。`,s.boardDoor);}
 else if(a.operation==='read'){s.knownStatus[r.id]=s.status;fact(w,s,r,board(w,s)?`${r.name}在原公告板读到边界记录：${s.status}。${summary(s)}。`:`${r.name}亲自到原公告地址核实公告板已经失效，原申请不能继续；已投入的时间和工具耐久保留。`,s.boardDoor);}
 else if(a.operation==='object'){s.status='objected';s.objections.push(r.id);s.reason='现场异议停止本案，不由多数覆盖';fact(w,s,r,`${r.name}对边界申请提出异议，原接入申请停止。`,s.boardDoor);}
 else if(a.operation==='withdraw'){s.status='cancelled';s.reason='申请人自行撤回，已耗时间及工具耐久不退回';fact(w,s,r,`${r.name}撤回尚未开通的边界申请。`,r.at);}
 else if(a.operation==='vote'){s.votes[r.id]=a.accept;fact(w,s,r,`${r.name}独立${a.accept?'赞成':'反对'}原边界接入；不承诺劳动、材料或授予土地。`,s.boardDoor);advanceRegionSurveys(w);}
 else if(a.operation==='open'){
  const error=openSurvey(w,r,s);if(error)return error;
  tool(w,r,a.toolId)!.durability--;s.status='opened';s.openedAt=w.minute;fact(w,s,r,`${r.name}返回原边界花15分钟登记接入并耗原斧具1耐久，真实通路通过隔离核验。${summary(s)}。本人仍在旧边界，前往新地及申请用地都须另行决定。`);
 }
 return null;
}
export function regionSurveyOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!capable(r))return [];
 const out:FormalOpportunity[]=[],add=(a:RegionSurveyAction,label:string)=>{if(!regionSurveyReason(w,r,a)){const s='surveyId'in a?surveys(w).find(s=>s.id===a.surveyId):undefined;out.push({id:`regionSurvey.${a.operation}.${'surveyId'in a?a.surveyId:a.edge}${a.operation==='vote'?'.'+a.accept:''}`,label:s?`${label}；${w.residents.find(p=>p.id===s.applicantId)?.name??s.applicantId}的${s.id}：${summary(s)}`:label,action:a});}};
 const axe=w.industry?.tools.find(t=>t.ownerId===r.id&&t.kind==='axe'&&!t.location&&t.durability>=1);
 if(axe&&!r.inside)for(const edge of ['east','south'] as const){const at=edge==='east'?{x:w.map.width-1,y:r.at.y}:{x:r.at.x,y:w.map.height-1};if(distance(r.at,at)<=8)add({type:'regionSurvey',operation:'survey',edge,at,toolId:axe.id},`亲自到${edge==='east'?'东':'南'}边界(${at.x},${at.y})勘察30分钟，耗原斧具1耐久；须带一份食品、两份清水，不开图、不授予用地`);}
 for(const s of surveys(w)){
  if(s.applicantId===r.id&&pendingFor(s,r)){
   add({type:'regionSurvey',operation:'withdraw',surveyId:s.id},'本人撤回未开通边界申请，不返还已经耗用的时间与耐久');
   if(!atBoard(w,r,s))out.push({id:`regionSurvey.board.${s.id}`,label:`前往本人原边界申请公告板${s.boardName}(${s.boardDoor.x},${s.boardDoor.y})查看，远处不知当前结果`,action:{type:'move',to:{...s.boardDoor}}});
  }
  add({type:'regionSurvey',operation:'post',surveyId:s.id},'在原公告板公示本人有限边界勘察，至少一日异议期，固定成年常住选民独立表决');
  add({type:'regionSurvey',operation:'read',surveyId:s.id},'实际阅读原边界公告，确认目前记录；不自动同意或前往');
  add({type:'regionSurvey',operation:'object',surveyId:s.id},'对已公示边界接入提出异议并停止本案');
  for(const accept of [false,true])add({type:'regionSurvey',operation:'vote',surveyId:s.id,accept},`${accept?'赞成':'反对'}本次有限边界接入，不承诺自己劳动、供给或土地`);
  if(adult(w,r)&&s.applicantId===r.id&&s.knownStatus[r.id]==='approved'&&w.minute<s.expiresAt&&(!same(r.at,s.at)||r.inside))out.push({id:`regionSurvey.return.${s.id}`,label:`按本人已读的${s.id}记录，返回原边界(${s.at.x},${s.at.y})核验；远处不知道授权、通路及供给是否仍有效，不自动接入`,action:{type:'move',to:{...s.at}}});
  if(axe)add({type:'regionSurvey',operation:'open',surveyId:s.id,toolId:axe.id},`本人返回原边界(${s.at.x},${s.at.y})花15分钟登记接入，耗原斧具1耐久；不产生物资、用地权或自动跨界`);
 }
 return out;
}
