import {initializeLastWishes,advanceLastWishes} from './last-wishes.js';
import {initializeRelationships,rememberPartnerDeathNotice,socialPresence} from './relationships.js';
import {deathProof,canObserve,retainDeathKnowledge} from './knowledge.js';
import type {Activity,Resident,Vec,World} from '../shared/types.js';import type {FuneraryAction} from '../shared/funerary.js';import {DAY,ageYears} from './time.js';import {coLocated} from './proximity.js';import {distance,same,findPath} from './navigation.js';import {roomLayout} from '../shared/rooms.js';import {emitEvent} from './events.js';
const person=(w:World,id?:string)=>w.residents.find(p=>p.id===id);
const adult=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
export function initializeFunerary(w:World){if(w.mode!=='formal')return;initializeLastWishes(w);initializeRelationships(w);if(!w.funerary?.certificates)retainDeathKnowledge(w);w.funerary??={notices:[],nextSerial:1,lastMinute:w.minute,totals:{stored:0,notified:0,maintained:0,visits:0}};w.funerary.certificates??=[];for(const g of w.graves){g.condition??=100;g.lastMaintainedAt??=w.minute;}w.definitions['funerary/rules@1']??={id:'funerary/rules',version:1,kind:'action',dependencies:[],data:{temporaryBays:2,pickupMinutes:20,maintenanceMinutes:60,conditionLossPerDay:.4}};}
export function deathEvidence(w:World,r:Resident,id:string){return deathProof(w,r,id,true);}
export function knownBodyLocation(w:World,r:Resident,id:string):{at:Vec;inside:string|null}|null{const p=person(w,id);if(p&&canObserve(w,r)&&coLocated(w,r,p,10))return {at:{...p.at},inside:p.inside};
 const fact=[...r.memories].reverse().map(m=>({m,e:w.events.find(e=>e.id===m.eventId)})).find(({m,e})=>m.source!=='heard'&&(e?.kind==='death'&&e.actors[0]===id||e?.bodyLocation?.personId===id));
 const durable=r.deathKnowledge?.[id]?.location;
 const report=[...(w.funerary?.notices??[])].reverse().find(n=>n.recipientId===r.id&&n.personId===id);
 if(report&&report.deliveredAt>Math.max(fact?.m.receivedAt??-1,durable?.atMinute??-1))return {at:{...report.claimedAt},inside:report.claimedRoomId};
 if(durable&&durable.atMinute>=(fact?.m.receivedAt??-1))return {at:{...durable.at},inside:durable.roomId};
 return fact?.e?{at:{...(fact.e.bodyLocation?.at??fact.e.place)},inside:fact.e.bodyLocation?.roomId??fact.e.roomId??null}:null;
}
export function bodyBayAvailable(w:World,id:string,slot:number,bodyId:string){const b=w.buildings.find(b=>b.id===id);return !!b&&['clinic','lodge'].includes(b.kind)&&Number.isSafeInteger(slot)&&slot>=0&&slot<2&&!w.residents.some(p=>p.id!==bodyId&&p.body?.storedAt===id&&p.body.storageSlot===slot)&&!w.residents.some(r=>r.activity?.cargo?.bodyId!==bodyId&&r.activity?.cargo?.storageId===id&&r.activity.cargo.storageSlot===slot);}
export function bodyBay(w:World,id:string,bodyId:string):number|null{for(let i=0;i<2;i++)if(bodyBayAvailable(w,id,i,bodyId))return i;return null;}
export function funeraryReason(w:World,r:Resident,a:FuneraryAction):string|null{
 if(!w.funerary||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return '本人当前不能处理身后事务';
 if(a.operation==='registerDeath'||a.operation==='readDeathRecord'){
  const b=w.buildings.find(b=>b.id===a.buildingId),certificate=w.funerary.certificates?.find(c=>c.personId===a.targetId);
  if(!b||b.kind!=='lodge'||b.ownerId!=='commons'||b.condition<=0||!r.knownBuildings.includes(b.id))return '需要已知且实际可用的公共会馆告示处';
  if(a.operation==='registerDeath')return adult(w,r)&&!certificate&&!!deathEvidence(w,r,a.targetId!)?null:'需要本人亲自核实且尚未登记的死亡证据';
  return certificate?.buildingId===b.id&&!deathProof(w,r,a.targetId!)?null:'本处没有本人尚未读取的实际死亡登记';
 }
 if(['maintain','epitaph','visit'].includes(a.operation)){const g=w.graves.find(g=>g.id===a.graveId);if(!g?.personId)return '没有这处已安葬的真实墓位';if(a.operation==='maintain')return adult(w,r)&&(r.inventory.stone??0)>=1&&(r.inventory.water??0)>=1&&(g.condition??100)<100?null:'修墓需要本人1石料、1清水及实际损耗';if(a.operation==='epitaph'){const p=person(w,g.personId);return p&&adult(w,r)&&r.relations.some(t=>t.targetId===p.id&&(t.kin||t.adoptive||t.partner||t.pastPartnerships?.some(p=>p.reason==='death')))&&typeof a.text==='string'&&a.text.trim().length>0&&a.text.length<=80?null:'亲属或伴侣可以亲自撰写1–80字墓志';}return typeof a.text==='string'&&a.text.trim().length>0&&a.text.length<=240?null:'探墓时请表达本人1–240字的想法';}
 const p=person(w,a.targetId);if(!p)return '没有这项消息指向的人物';
 if(a.operation==='verify')return knownBodyLocation(w,r,p.id)||coLocated(w,r,p,10)?null:'本人尚无实际观察或收到的具体寻找线索';
 if(p.status!=='dead')return '尚无与这项身后事务相符的人物与事实';
 const evidence=deathEvidence(w,r,p.id);if(!evidence)return '需要本人亲自发现或核实的死亡证据，听说不等于已经确认';
 if(a.operation==='notify'){const to=person(w,a.recipientId);return to&&to.id!==r.id&&to.status==='alive'&&socialPresence(w,r,to)&&!w.funerary.notices.some(n=>n.reporterId===r.id&&n.recipientId===to.id&&n.personId===p.id)?null:'请亲自向身边的人送达自己已核实、尚未告知的消息';}
 if(a.operation==='store'){if(!adult(w,r)||w.graves.some(g=>g.personId===p.id)||p.body?.reservedBy&&p.body.reservedBy!==r.id)return '遗体已安葬或已有另一项实际搬运安排';const b=w.buildings.find(b=>b.id===a.buildingId);if(!b||!r.knownBuildings.includes(b.id)||!['clinic','lodge'].includes(b.kind)||b.condition<=0||b.ownerId!=='commons'&&b.ownerId!==r.id||p.body?.storedAt===b.id)return '没有已知、有使用权且不同于原暂存处的安置场所';const cargo=r.activity?.cargo;if(cargo?.pickedUp&&cargo.storageId===b.id)return null;return bodyBay(w,b.id,p.id)!==null?null:'本处两处实际暂存位置已满';}
 return '没有这项身后事务';
}
export function funeraryTarget(w:World,r:Resident,a:FuneraryAction):{target:Vec;duration:number;adjacent?:boolean;cargo?:Activity['cargo'];error?:string}{const error=funeraryReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 if(a.operation==='registerDeath'||a.operation==='readDeathRecord')return {target:w.buildings.find(b=>b.id===a.buildingId)!.door,duration:10};
 if(['maintain','epitaph','visit'].includes(a.operation)){const g=w.graves.find(g=>g.id===a.graveId)!;return {target:g.at,adjacent:true,duration:a.operation==='maintain'?60:30};}
 if(a.operation==='notify')return {target:r.at,duration:3};const p=person(w,a.targetId)!,known=knownBodyLocation(w,r,p.id)??{at:p.at,inside:p.inside};
 return {target:{...known.at},adjacent:!known.inside,duration:a.operation==='store'?20:5,...(a.operation==='store'?{cargo:{bodyId:p.id,pickedUp:false,pickupRemaining:20,storageId:a.buildingId!,storageSlot:bodyBay(w,a.buildingId!,p.id)!}}:{})};
}
export function completeFunerary(w:World,r:Resident,a:FuneraryAction):string|null{const error=funeraryReason(w,r,a);if(error)return error;const state=w.funerary!;
 if(a.operation==='registerDeath'||a.operation==='readDeathRecord'){
  const b=w.buildings.find(b=>b.id===a.buildingId)!;if(r.inside||!same(r.at,b.door))return '须本人实际到达公共告示处';
  const p=person(w,a.targetId)!;
  if(a.operation==='registerDeath'){
   const proof=deathEvidence(w,r,p.id)!,location=r.deathKnowledge?.[p.id]?.location??{at:{...(proof.bodyLocation?.at??proof.place)},roomId:proof.bodyLocation?.roomId??proof.roomId??null,atMinute:proof.at,eventId:proof.id};
   const e=emitEvent(w,{kind:'burial',actors:[r.id,p.id],place:{...r.at},text:`${r.name}亲自向${b.name}提交了已核实的${p.name}死亡证明。登记可供后来到访者实际查阅，不会自动通知全镇。`});
   (state.certificates??=[]).push({personId:p.id,registrarId:r.id,buildingId:b.id,proofEventId:proof.id,registrationEventId:e.id,registeredAt:w.minute,location:structuredClone(location)});
  }else {
   const c=state.certificates!.find(c=>c.personId===p.id)!;
   r.deathKnowledge??={};r.deathKnowledge[p.id]={eventId:c.registrationEventId,source:'document',confirmedAt:w.minute,location:structuredClone(c.location)};
   if(!r.knownPeople.includes(p.id))r.knownPeople.push(p.id);
   emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},text:`${r.name}实际查阅了${b.name}关于${p.name}的死亡登记，取得公共文书证据；不代表亲自见过遗体或知道其最新位置。`});
  }return null;
 }
 if(['maintain','epitaph','visit'].includes(a.operation)){const g=w.graves.find(g=>g.id===a.graveId)!;if(r.inside||distance(r.at,g.at)>1)return '须亲自到达墓位';const p=person(w,g.personId!)!;if(a.operation==='maintain'){r.inventory.stone!--;r.inventory.water!--;g.condition=Math.min(100,(g.condition??0)+30);g.lastMaintainedAt=w.minute;state.totals.maintained++;}else if(a.operation==='epitaph')g.epitaph=a.text!.trim();else state.totals.visits++;emitEvent(w,{kind:'burial',actors:[r.id,p.id],place:{...r.at},text:a.operation==='maintain'?`${r.name}实际用本人石料和清水修护了${p.name}的墓位，纪念身份仍保留。`:a.operation==='epitaph'?`${r.name}为${p.name}写下墓志：“${a.text!.trim()}”`:`${r.name}来到${p.name}的墓前：“${a.text!.trim()}”`});return null;}
 const p=person(w,a.targetId)!;
 if(a.operation==='verify'){if(!coLocated(w,r,p,2))return '这条线索指向的地方没有可亲自确认的遗体，仍需寻找';if(p.status==='dead')emitEvent(w,{kind:'death',actors:[p.id,r.id],place:{...p.at},witnesses:[r.id],text:`${r.name}亲自到达并核实了${p.name}的死亡。`});else emitEvent(w,{kind:'action',actors:[r.id,p.id],place:{...p.at},text:`${r.name}亲自见到${p.name}仍在世，先前关于死亡的消息不符。`});return null;}
 if(a.operation==='notify'){const evidence=deathEvidence(w,r,p.id)!,to=person(w,a.recipientId)!,known=knownBodyLocation(w,r,p.id)!;const e=emitEvent(w,{kind:'burial',actors:[r.id,to.id,p.id],place:{...r.at},witnesses:[r.id,to.id],text:`${r.name}亲自将自己核实的${p.name}死亡消息及最后知道的安置地点告知${to.name}；接收者获得的是消息，仍可亲自核实。`});const m=to.memories.find(m=>m.eventId===e.id);if(m)m.source='heard';state.notices.push({id:'death-notice:'+state.nextSerial++,reporterId:r.id,recipientId:to.id,personId:p.id,sourceEventId:evidence.id,eventId:e.id,deliveredAt:w.minute,claimedAt:{...known.at},claimedRoomId:known.inside});rememberPartnerDeathNotice(w,to,p.id,e.id,evidence.id);state.totals.notified++;return null;}
 const cargo=r.activity?.cargo,b=w.buildings.find(b=>b.id===a.buildingId);if(!cargo?.pickedUp||cargo.bodyId!==p.id||cargo.storageId!==b?.id||p.body?.carriedBy!==r.id||!b||r.inside!==b.id)return '尚未实际把遗体送入所选暂存场所';const slot=roomLayout(w,b).slots.find(s=>s.key==='bodyBay:'+cargo.storageSlot);if(!slot||!r.roomAt||distance(r.roomAt,slot.at)>1)return '尚未实际送到暂存位置';p.at={...b.door};p.inside=b.id;p.roomAt={...slot.at};p.body.carriedBy=null;p.body.reservedBy=null;p.body.storedAt=b.id;p.body.storageSlot=cargo.storageSlot;state.totals.stored++;emitEvent(w,{kind:'burial',bodyLocation:{personId:p.id,at:{...p.at},roomId:p.inside,roomAt:p.roomAt?{...p.roomAt}:null},actors:[r.id,p.id],place:{...r.at},text:`${r.name}亲自将${p.name}的遗体安置在${b.name}第${cargo.storageSlot!+1}处暂存位置，身份与后续安葬责任继续保留；尚未占用墓位。`});return null;
}
export function advanceFunerary(w:World){initializeFunerary(w);advanceLastWishes(w);const state=w.funerary;if(!state)return;const dt=Math.max(0,w.minute-state.lastMinute);state.lastMinute=w.minute;for(const g of w.graves)if(g.personId)g.condition=Math.max(0,(g.condition??100)-dt*.4/DAY);if(state.notices.length>240)state.notices=state.notices.slice(-120);}
