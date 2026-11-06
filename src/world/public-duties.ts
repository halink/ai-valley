import {roomLayout} from '../shared/rooms.js';
import {foodTransaction} from './food.js';
import {educationConflict} from './education.js';
import type {Building, Resident, Vec, World} from '../shared/types.js';
import type {DutyAssignment, DutyRole, PublicDutyAction, PublicShift} from '../shared/public-duties.js';
import {closeShiftFunding,fundPublicShift,hasPublicServiceSupplies,payPublicService} from './civic.js';
import {emitEvent} from './events.js';
import {distance, findPath, same} from './navigation.js';
import {ageYears, DAY} from './time.js';
import {employmentConflict} from './employment.js';

export const dutyNames: Record<DutyRole,string> = {kitchen:'公厨', care:'照护'};
const serviceMinutes: Record<DutyRole,number> = {kitchen:20, care:30};
const graceMinutes = 15;
const reportBefore = 45;
const startHours = [10, 15];

function placeFor(w:World, shift:PublicShift): Building | undefined {
  const kind = shift.role === 'care' ? 'clinic' : 'lodge';
  return w.buildings.find(b=>b.id === shift.buildingId && b.kind === kind && b.ownerId === 'commons' && b.condition>0);
}
function currentAssignment(shift:PublicShift) {
  return shift.assignments.at(-1);
}
function competent(person:Resident) {
  return person.status==='alive' && person.residency!=='outside' && person.canDecide && person.canExpress;
}
function mayWork(w:World, person:Resident, role:DutyRole) {
  return competent(person) && ageYears(person.bornAt,w.minute)>=18 && person.health>=45 && person.energy>=10
    && (role!=='care' || person.skills.care>=1);
}
export function hasDutySupplies(person:Resident, role:DutyRole) {
  const inv=person.inventory;
  return (inv.water??0)>=1 && (role==='care' ? (inv.meal??0)>=1 : (inv.turnip??0)>=2);
}
export function hasDutyMaterials(w:World,person:Resident,shift:PublicShift){return shift.funding?hasPublicServiceSupplies(w,shift):hasDutySupplies(person,shift.role);}
function staffed(w:World, shift:PublicShift, place:Building) {
  const worker=w.residents.find(p=>p.id===shift.workerId);
  if(!worker || !mayWork(w,worker,shift.role) || !same(worker.at,place.door) || worker.inside!==place.id) return undefined;
  if(w.rooms){const slot=roomLayout(w,place).slots.find(s=>s.key===(shift.role==='care'?'care':'kitchen'));if(!slot||!worker.roomAt||!same(slot.at,worker.roomAt))return undefined;}
  const action=worker.activity?.action;
  if(action && !(action.type==='wait' || action.type==='publicDuty' && ['attend','stay','withdraw'].includes(action.operation))) return undefined;
  return worker;
}
function announce(w:World,shift:PublicShift,text:string,actors:string[]=[]) {
  const place=w.buildings.find(b=>b.id===shift.buildingId);
  if(place)emitEvent(w,{kind:'duty',actors,place:{...place.door},text});
}
function release(w:World, shift:PublicShift, outcome:NonNullable<DutyAssignment['outcome']>) {
  const assignment=currentAssignment(shift);
  if(assignment){assignment.leftAt=w.minute;assignment.outcome=outcome;}
  shift.workerId=null;
  shift.clientId=null;
  shift.status='open';
}
function publishDay(w:World,day:number) {
  for(const place of w.buildings){
    if(place.ownerId!=='commons'||place.condition<=0||!['clinic','lodge'].includes(place.kind))continue;
    const role:DutyRole=place.kind==='clinic'?'care':'kitchen';
    for(const hour of startHours){
      const start=day*DAY+hour*60,end=start+90;
      if(end<=w.minute)continue;
      const id=`shift:${place.id}:${day}:${hour}`;
      w.duties!.shifts.push({id,role,buildingId:place.id,start,end,workerId:null,status:'open',assignments:[],declinedBy:[],served:0,clientId:null});
    }
  }
}

/** Publish real windows at public facilities. Time can expose a vacancy, but can never assign a worker. */
export function advancePublicDuties(w:World):void {
  if(w.mode!=='formal')return;
  const day=Math.floor(w.minute/DAY);
  const duties=w.duties??={publishedThroughDay:day-1,shifts:[]};
  if(duties.publishedThroughDay<day+1){
    for(const old of duties.shifts)if(old.end<=w.minute)closeShiftFunding(w,old);
    duties.shifts=duties.shifts.filter(s=>s.end>=(day-2)*DAY);
    for(let d=Math.max(day,duties.publishedThroughDay+1);d<=day+1;d++)publishDay(w,d);
    duties.publishedThroughDay=day+1;
  }
  for(const shift of duties.shifts){
    if(shift.status==='finished'||shift.status==='unfilled'){closeShiftFunding(w,shift);continue;}
    fundPublicShift(w,shift);
    if(w.minute>=shift.end){
      const last=currentAssignment(shift);
      if(last&&last.leftAt===null){last.leftAt=w.minute;last.outcome=last.arrivedAt===null?'absent':'finished';}
      shift.status=shift.assignments.some(a=>a.arrivedAt!==null)?'finished':'unfilled';
      shift.clientId=null;
      closeShiftFunding(w,shift);
      const name=w.buildings.find(b=>b.id===shift.buildingId)?.name??'本处';
      announce(w,shift,`${name}的${dutyNames[shift.role]}班次结束，${shift.status==='unfilled'?'无人到岗':`实际服务 ${shift.served} 人次`}。`);
      continue;
    }
    if(shift.status==='booked'){
      const assignment=currentAssignment(shift);
      if(assignment && w.minute>=Math.max(shift.start,assignment.acceptedAt)+graceMinutes){
        release(w,shift,'absent');
        announce(w,shift,`约定的报到时间已过，${dutyNames[shift.role]}班重新开放代班。`);
      }
    }else if(shift.status==='on-duty'){
      const place=placeFor(w,shift);
      if(!place||!staffed(w,shift,place)){
        release(w,shift,'left');
        announce(w,shift,`${dutyNames[shift.role]}岗位现在空缺，等候愿意接班的人。`);
      }else if(shift.clientId){
        const client=w.residents.find(r=>r.id===shift.clientId);
        const action=client?.activity?.action;
        if(!client || !competent(client) || !same(client.at,place.door) ||
           action?.type!=='publicDuty'||action.operation!=='receive'||action.shiftId!==shift.id)shift.clientId=null;
      }
    }
  }
}

function overlap(a:PublicShift,b:PublicShift) {return a.start<b.end&&b.start<a.end;}
/** Action eligibility at the board and on the spot is shared by the model and the executor. */
export function dutyReason(w:World,r:Resident,a:PublicDutyAction):string|null {
  const shift=w.duties?.shifts.find(s=>s.id===a.shiftId);
  if(w.mode!=='formal'||!shift||!competent(r))return '该公共班次或行动人当前不可用';
  const place=placeFor(w,shift);
  if(!place||w.minute>shift.end||shift.status==='finished'||shift.status==='unfilled')return '班次已结束或用房不可用';
  const owns=shift.workerId===r.id;
  switch(a.operation){
    case 'claim':
    case 'reschedule':{
      const education=educationConflict(w,r.id,shift.start,shift.end,shift.buildingId);if(education)return education;
      const employment=employmentConflict(w,r,shift.start,shift.end,shift.buildingId);
      if(employment)return employment;
      if(!mayWork(w,r,shift.role)||!hasDutyMaterials(w,r,shift))return shift.funding?'本班需要相应能力、已到位的公共物资和工资':'本班需要具备相应能力和自愿提供的实际物资';
      if(shift.status!=='open')return '本班已有认领人';
      if(shift.end-w.minute<serviceMinutes[shift.role]+2)return '剩余时段已不足以接班';
      if(a.operation==='reschedule'){
        const from=w.duties!.shifts.find(s=>s.id===a.fromShiftId);
        if(!from||from.id===shift.id||from.workerId!==r.id||from.status!=='booked'||from.buildingId!==shift.buildingId)return '找不到本人可在此处改期的原班';
      }
      const commitments=w.duties!.shifts.filter(s=>s.workerId===r.id&&['booked','on-duty'].includes(s.status)
        &&!(a.operation==='reschedule'&&s.id===a.fromShiftId));
      if(commitments.some(s=>overlap(s,shift)))return '本人已认领相重叠的班次';
      for(const other of commitments){
        const otherPlace=placeFor(w,other);
        if(!otherPlace)continue;
        const journey=findPath(w,otherPlace.door,place.door);
        const gap=other.end<=shift.start?shift.start-other.end:other.start-shift.end;
        if(journey===null||gap<journey.length)return '两个班次之间不足以实际走到下一个岗位';
      }
      return null;
    }
    case 'decline':return !owns&&shift.status==='open'&&!shift.declinedBy.includes(r.id)&&mayWork(w,r,shift.role)?null:'本班当前没有可拒绝的空缺';
    case 'withdraw':return owns&&['booked','on-duty'].includes(shift.status)?null:'只能辞去本人当前认领的班次';
    case 'attend':
      if(shift.status!=='booked'||!owns||!mayWork(w,r,shift.role)||!hasDutyMaterials(w,r,shift))return '报到需要本人的有效班次、能力和实际物资';
      if(w.minute<shift.start-reportBefore)return '距离开班尚早';
      return null;
    case 'stay':return shift.status==='on-duty'&&owns&&mayWork(w,r,shift.role)?null:'本人当前没有在场值守';
    case 'receive':{
      if(shift.status!=='on-duty'||owns||w.minute<shift.start)return '没有在岗的服务者';
      if(shift.clientId && shift.clientId!==r.id)return '这处工位正在服务另一位居民';
      const provider=staffed(w,shift,place);
      if(!provider||!hasDutyMaterials(w,provider,shift))return '当班人或本次需要的材料尚未就绪';
      if(shift.role==='care'&&(r.refusesCare||r.health>=100&&r.hunger<=0))return '当前不适用本次基础照护';
      if(shift.role==='kitchen'&&r.hunger<=0)return '当前没有用餐需要';
      return null;
    }
  }
}

export function dutyTarget(w:World,r:Resident,a:PublicDutyAction):{target:Vec;duration:number;error?:string} {
  const error=dutyReason(w,r,a);
  if(error)return {target:r.at,duration:0,error};
  const shift=w.duties!.shifts.find(s=>s.id===a.shiftId)!;
  const place=placeFor(w,shift)!;
  if(shift.workerId!==r.id&&distance(r.at,place.door)>8)return {target:r.at,duration:0,error:'请先到本地公告板查看班次'};
  let duration=1;
  if(a.operation==='receive')duration=serviceMinutes[shift.role];
  if(a.operation==='stay')duration=Math.min(15,shift.end-w.minute);
  if(w.minute+distance(r.at,place.door)+duration-1>shift.end)return {target:r.at,duration:0,error:'路程与工作时间超过本班时段'};
  return {target:{...place.door},duration};
}

/** Called for each unit of work after navigation. Losing materials, the worker or the seat stops service. */
export function dutyWorkError(w:World,r:Resident,a:PublicDutyAction):string|null {
  const error=dutyReason(w,r,a);
  if(error)return error;
  const shift=w.duties!.shifts.find(s=>s.id===a.shiftId)!;
  const place=placeFor(w,shift)!;
  if(!same(r.at,place.door))return '须亲自抵达公告板或工位';
  if(a.operation==='attend'||a.operation==='stay'||a.operation==='receive'||a.operation==='withdraw'&&shift.status==='on-duty')r.inside=place.id;
  if(a.operation==='attend'&&w.minute<shift.start&&r.activity){
    r.activity.remaining=Math.max(1,shift.start-w.minute+1);
  }
  if(a.operation==='receive'){
    // Personal consent is the resident's own model plan. Claim the single seat only upon arrival.
    if(w.minute+(r.activity?.remaining??serviceMinutes[shift.role])-1>shift.end)return '剩余时段不足以完成服务';
    if(shift.role==='kitchen'&&w.residents.some(p=>p.id!==r.id&&p.inside===place.id&&p.activity?.action.type==='cook'))return '厨房的工位正在被使用';
    shift.clientId=r.id;
  }
  return null;
}

function completeDutyAtomic(w:World,r:Resident,a:PublicDutyAction):string|null {
  const error=dutyReason(w,r,a);
  if(error)return error;
  const shift=w.duties!.shifts.find(s=>s.id===a.shiftId)!;
  const place=placeFor(w,shift)!;
  if(!same(r.at,place.door))return '须实际抵达岗位地点';
  const name=`${place.name}的${dutyNames[shift.role]}班`;
  switch(a.operation){
    case 'claim':
    case 'reschedule':{
      if(a.operation==='reschedule'){
        const from=w.duties!.shifts.find(s=>s.id===a.fromShiftId)!;
        release(w,from,'rescheduled');
      }
      const replacement=shift.assignments.length>0;
      shift.assignments.push({residentId:r.id,acceptedAt:w.minute,arrivedAt:null,leftAt:null});
      shift.status='booked';shift.workerId=r.id;
      announce(w,shift,`${r.name}${a.operation==='reschedule'?'改班并认领':replacement?'自愿接替':'自愿认领'}了${name}。`,[r.id]);
      return null;
    }
    case 'decline':
      shift.declinedBy.push(r.id);
      return null;
    case 'withdraw':
      release(w,shift,'withdrew');
      announce(w,shift,`${r.name}辞去${name}，其余居民可自行报名代班。`,[r.id]);
      return null;
    case 'attend':
      if(w.minute<shift.start)return '本班尚未开始';
      shift.status='on-duty';currentAssignment(shift)!.arrivedAt=w.minute;r.inside=place.id;
      announce(w,shift,`${r.name}到了${place.name}，开始${dutyNames[shift.role]}值班。`,[r.id]);
      return null;
    case 'stay':return null;
    case 'receive':{
      const provider=staffed(w,shift,place);
      if(shift.clientId!==r.id||!provider||r.inside!==place.id)return '没有持续在场的当班人和服务席位';
      const isCare=shift.role==='care';
      const ingredient=isCare?'meal':'turnip';
      if(shift.funding){
        if(!payPublicService(w,shift,provider))return '本次公共物资或已预留工资不再可用';
      }else{
        provider.inventory.water=(provider.inventory.water??0)-1;
        provider.inventory[ingredient]=(provider.inventory[ingredient]??0)-(isCare?1:2);
      }
      provider.revision++;
      r.hunger=Math.max(0,r.hunger-(isCare?20:42));
      if(isCare){
        r.health=Math.min(100,r.health+8);
        provider.skills.care+=0.02;
      }
      shift.served++;shift.clientId=null;
      const source=shift.funding?'已经采购到场的公共':'自己的';
      const description=(isCare?`提供了一次基础照护，使用${source} 1 份餐食和 1 份水`:`做了一份热餐，使用${source} 2 份芜菁和 1 份水`)+(shift.funding?`，实际领到 ${shift.funding.wagePerService} 钱工资`:'');
      emitEvent(w,{kind:isCare?'care':'duty',actors:[provider.id,r.id],place:{...place.door},
        text:`${r.name}主动来到${place.name}，${provider.name}为其${description}。`,
        ...(isCare?{audit:{rule:'public-care@1',authority:'consent',evidence:r.activity?.planId??shift.id,
          scope:['food','basic-care'],resources:{meal:1,water:1},providerId:provider.id,termination:'已完成此次本人请求的照护'}}:{})});
      return null;
    }
  }
}

/** The commons have one cooking workstation. Its attending duty and an already-started
 * private cooking action both retain their place until they finish or leave. */
export function publicKitchenReason(w:World,r:Resident,buildingId:string):string|null {
  const building=w.buildings.find(b=>b.id===buildingId&&b.ownerId==='commons'&&b.kind==='lodge');
  if(!building)return null;
  const classroom=educationConflict(w,r.id,w.minute,w.minute+20,buildingId);if(classroom)return classroom;
  const duty=w.duties?.shifts.find(s=>s.buildingId===buildingId&&s.role==='kitchen'&&s.status==='on-duty'
    &&w.minute>=s.start&&w.minute<s.end&&staffed(w,s,building));
  if(duty)return '公厨工位正由已到岗的值班人使用，须先等班次结束或交还工位';
  const busy=w.residents.some(other=>other.id!==r.id&&other.status==='alive'&&other.residency!=='outside'
    &&same(other.at,building.door)&&other.activity?.action.type==='cook'&&other.activity.path.length===0);
  return busy?'这处公共厨房已有居民在实际烹饪，请等工位空出':null;
}

export function completeDuty(w:World,r:Resident,a:PublicDutyAction):string|null{return foodTransaction(w,()=>completeDutyAtomic(w,r,a));}
