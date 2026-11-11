import {isResidentUpgrade,residentUpgradeReason,residentUpgradeTarget,completeResidentUpgrade,workResidentUpgrade,advanceResidentUpgrades,residentUpgradeOpportunities} from './resident-upgrades.js';
import {currentPremisesLease} from '../shared/premises.js';
import {firstReceipt} from './receipts.js';
import {createHash} from 'node:crypto';import type {BuildingMigrationAction,BuildingUpgrade} from '../shared/building-migration.js';import type {FormalOpportunity,Inventory,Item,Resident,World} from '../shared/types.js';import {itemKeys,itemLabels} from '../shared/items.js';import {ageYears,DAY} from './time.js';import {same,distance} from './navigation.js';import {emitEvent,emitLedgerEvent} from './events.js';import {activeDefinitionError} from './content-schema.js';import {estateStock,estateBuildingLocation} from './estate-custody.js';import {educationConflict} from './education.js';import {employmentConflict} from './employment.js';
export interface BuildingMigrationOffer {id:string;expectedRevision:number;buildingId:string;from:string;to:string;}
function canonical(v:unknown):string{return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);}
const adult=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const building=(w:World,id:string)=>w.buildings.find(b=>b.id===id);
const goods=(b:Inventory)=>Object.values(b).some(n=>n!>0);
const has=(b:Inventory,c:Inventory)=>Object.entries(c).every(([i,n])=>(b[i as Item]??0)>=n!);
const add=(b:Inventory,c:Inventory,sign=1)=>{for(const [i,n]of Object.entries(c))b[i as Item]=(b[i as Item]??0)+sign*n!;};
const stockLabel=(b:Inventory)=>Object.entries(b).filter(([,n])=>n!>0).map(([i,n])=>n+itemLabels[i as Item]).join('、')||'无';
function structural(data:Record<string,unknown>){const {art,name,...shape}=data;return shape;}
function projectConflict(w:World,id:string){return w.construction?.projects.some(p=>p.base?.id===id&&['proposed','planned','active','paused'].includes(p.status));}
export function migrationBuildingBusy(w:World,id:string){return !!w.buildingMigrations?.some(m=>m.buildingId===id&&(m.status==='accepted'||goods(m.stock)));}
/** Registers a concrete compatibility quote, never the occupant's consent or a completed change. */
export function stageBuildingMigration(w:World,p:BuildingMigrationOffer){const request='building-upgrade:'+p.id,receipt=request+':'+createHash('sha256').update(canonical(p)).digest('hex'),saved=firstReceipt(w,request);if(saved)return saved===receipt?{ok:true,duplicate:true}:{ok:false,error:'改版标识已经对应其他条款'};
 const fail=(error:string)=>({ok:false,error});if(w.mode!=='formal'||p.expectedRevision!==w.revision||!/^[-a-zA-Z0-9]+$/.test(p.id))return fail('现行世界版本或请求标识不适用');const b=building(w,p.buildingId),owner=w.residents.find(r=>r.id===b?.ownerId),from=w.definitions[p.from],to=w.definitions[p.to];
 if(!b||b.definition!==p.from||!owner||!adult(w,owner)||b.condition<=0||projectConflict(w,b.id)||w.buildingMigrations?.some(m=>m.buildingId===b.id&&(['offered','accepted'].includes(m.status)||goods(m.stock))))return fail('实际产权、建筑或既有工程不允许提出本次改版');
 if(!from||!to||p.from===p.to||from.id!==to.id||from.kind!=='building'||to.kind!=='building'||activeDefinitionError(w,to)||activeDefinitionError(w,from)||canonical(structural(from.data))!==canonical(structural(to.data))||canonical(from.dependencies)!==canonical(to.dependencies))return fail('本接口只允许原占地、容量、功能与依赖全部保持的实例改版；空间或服务改变须走实际改造工程');
 const charge:Inventory={},refund:Inventory={};for(const item of itemKeys){const diff=(to.cost?.[item]??0)-(from.cost?.[item]??0);if(diff>0)charge[item]=diff;else if(diff<0)refund[item]=-diff;}
 const m:BuildingUpgrade={id:p.id,buildingId:b.id,ownerId:owner.id,from:p.from,to:p.to,offeredAt:w.minute,expiresAt:w.minute+14*DAY,acceptedAt:null,completedAt:null,status:'offered',charge,refund,stock:{},minutes:Math.min(1440,30+Math.abs((to.minutes??0)-(from.minutes??0))),worked:0,lastAt:-1};(w.buildingMigrations??=[]).push(m);w.processed.push(receipt);emitLedgerEvent(w,{kind:'construction',actors:[owner.id],place:b.door,text:`${b.name}出现具体的兼容改版提议；产权人尚未接受，原建筑与服务继续。`});return {ok:true};
}
function targetRecord(w:World,r:Resident,a:BuildingMigrationAction){const m=w.buildingMigrations?.find(m=>m.id===a.migrationId&&m.ownerId===r.id),b=m&&building(w,m.buildingId);return m&&b&&adult(w,r)?{m,b}:null;}
export function buildingMigrationReason(w:World,r:Resident,a:BuildingMigrationAction){if(isResidentUpgrade(w,a))return residentUpgradeReason(w,r,a);const t=targetRecord(w,r,a);if(!t)return '没有本人可以决定的已知建筑改版';const {m,b}=t;
 if(a.operation==='collect')return ['cancelled','expired','completed'].includes(m.status)&&goods(m.stock)?null:'没有留在原址的本人未用材料或实际回收物';
 if(a.operation==='decline')return m.status==='offered'?null:'没有等待本人决定的提议';
 if(a.operation==='cancel')return m.status==='accepted'?null:'没有本人可取消的已接受改版';
 if(currentPremisesLease(w,b.id))return '原址仍有有效租约，不能未经承租人同意改版';
 if(b.ownerId!==r.id||b.definition!==m.from||b.condition<=0||w.minute>=m.expiresAt||projectConflict(w,b.id))return '原产权、版本、场所或有限期限已经变化';
 if(a.operation==='accept')return m.status==='offered'&&has(r.inventory,m.charge)?null:'须当前权利人单独接受，并亲自带足已报价的差额材料';
 if(a.operation==='work'){if(m.status!=='accepted'||m.acceptedAt===null||!Number.isSafeInteger(a.minutes)||a.minutes!<1||a.minutes!>120)return '须本人先明确接受，再选择1至120分钟实际工作';const conflict=educationConflict(w,r.id,w.minute,w.minute+a.minutes!,b.id)??employmentConflict(w,r,w.minute,w.minute+a.minutes!,b.id);return conflict??null;}
 return '未知改版选择';
}
export function buildingMigrationTarget(w:World,r:Resident,a:BuildingMigrationAction){if(isResidentUpgrade(w,a))return residentUpgradeTarget(w,r,a);const error=buildingMigrationReason(w,r,a),t=targetRecord(w,r,a);return error||!t?{target:r.at,duration:0,error:error??'找不到原建筑'}:{target:{...t.b.door},duration:a.operation==='work'?Math.min(a.minutes!,t.m.minutes-t.m.worked):5};}
function fact(w:World,r:Resident,text:string){emitEvent(w,{kind:'construction',actors:[r.id],place:r.at,roomId:null,text});}
export function completeBuildingMigration(w:World,r:Resident,a:BuildingMigrationAction){if(isResidentUpgrade(w,a))return completeResidentUpgrade(w,r,a);if(a.operation==='work')return null;const error=buildingMigrationReason(w,r,a);if(error)return error;const {m,b}=targetRecord(w,r,a)!;if(!same(r.at,b.door)||r.inside)return '须实际来到原建筑门前办理';
 if(a.operation==='accept'){add(r.inventory,m.charge,-1);m.stock={...m.charge};m.acceptedAt=w.minute;m.status='accepted';fact(w,r,`${r.name}在${b.name}前自主接受具体改版，预留本人${stockLabel(m.charge)}，还需实际工作${m.minutes}分钟；原建筑仍在使用。`);}
 else if(a.operation==='decline'){m.status='declined';fact(w,r,`${r.name}婉拒本次具体改版，原建筑与服务照常。`);}
 else if(a.operation==='cancel'){m.status='cancelled';fact(w,r,`${r.name}决定停止改版，原建筑不变，未用材料仍在原址，须本人另行领取。`);}
 else if(a.operation==='collect'){add(r.inventory,m.stock);m.stock={};fact(w,r,`${r.name}亲自取回原址保管的本人改版材料。`);}
 r.revision++;return null;
}
export function workBuildingMigration(w:World,r:Resident,a:BuildingMigrationAction,dt:number){if(isResidentUpgrade(w,a))return workResidentUpgrade(w,r,a,dt);if(a.operation!=='work')return null;const error=buildingMigrationReason(w,r,a);if(error)return error;const {m,b}=targetRecord(w,r,a)!;if(!same(r.at,b.door)||r.inside||r.activity?.action!==a)return '尚未实际到达原建筑外的作业位置';if(m.lastAt>=w.minute)return null;m.lastAt=w.minute;m.worked+=Math.min(dt,r.activity.remaining,m.minutes-m.worked);if(m.worked+1e-8<m.minutes)return null;
 if(!has(m.stock,m.charge))return '原预留的差额材料已经不足';m.worked=m.minutes;m.stock={...m.refund};m.completedAt=w.minute;m.status='completed';b.definition=m.to;r.activity.remaining=0;fact(w,r,`${r.name}实际完成${b.name}的${m.minutes}分钟改版工作，原位置、容量、权利及服务延续，回收${stockLabel(m.refund)}留在原址。`);return null;
}
export function advanceBuildingMigrations(w:World){advanceResidentUpgrades(w);for(const m of w.buildingMigrations??[]){if(m.residentProposal)continue;const b=building(w,m.buildingId),r=w.residents.find(r=>r.id===m.ownerId);if(['accepted','offered'].includes(m.status)&&(m.expiresAt<=w.minute||!b||b.ownerId!==m.ownerId||r?.status!=='alive'||r?.residency==='outside'))m.status=m.expiresAt<=w.minute?'expired':'cancelled';if(b&&r?.status==='dead'&&goods(m.stock)){const stock=estateStock(w,r.id,'building-upgrade:'+m.id,estateBuildingLocation(w,b.id,'原建筑改版余料'))!;add(stock,m.stock);m.stock={};emitLedgerEvent(w,{kind:'construction',actors:[r.id],place:b.door,text:'建筑改版原址余料归还逝者遗产，既有建筑定义与物权不因未完工而改变。'});}}if((w.buildingMigrations?.length??0)>160)w.buildingMigrations=w.buildingMigrations!.filter((m,i,a)=>['offered','accepted'].includes(m.status)||goods(m.stock)||i>=a.length-80);}
export function buildingMigrationOpportunities(w:World,r:Resident):FormalOpportunity[]{const choices:FormalOpportunity[]=residentUpgradeOpportunities(w,r);for(const m of w.buildingMigrations??[]){if(m.residentProposal)continue;if(m.ownerId!==r.id)continue;const b=building(w,m.buildingId);if(!b||!r.knownBuildings.includes(b.id)||m.status==='offered'&&(r.inside!==null||distance(r.at,b.door)>8))continue;
 const add=(operation:BuildingMigrationAction['operation'],label:string,minutes?:number)=>{const action:BuildingMigrationAction={type:'buildingMigration',operation,migrationId:m.id,...(minutes?{minutes}:{})};if(!buildingMigrationReason(w,r,action))choices.push({id:'buildingMigration.'+m.id+'.'+operation,label,action});};
 add('accept',`亲自接受${b.name}的兼容改版：预留本人${stockLabel(m.charge)}，需实际${m.minutes}分钟劳动，预计回收${stockLabel(m.refund)}；占地、容量和服务不变`);add('decline',`明确婉拒${b.name}的这次改版提议，原建筑继续`);add('work',`在原建筑门前实际进行30分钟本人已接受的改版（可填minutes 1–120，累计${m.worked}/${m.minutes}分钟）`,30);add('cancel','本人停止改版；原建筑仍可用，余料留原址');add('collect','亲自到原建筑领取本人尚未取回的改版余料');}return choices;}
