import type {Building,FormalOpportunity,Resident,World} from '../shared/types.js';
import type {PublicDutyAction,PublicShift} from '../shared/public-duties.js';
import {distance} from '../world/navigation.js';
import {dutyNames,dutyReason} from '../world/public-duties.js';
import {visibleStreetDirectory} from '../world/street-directory.js';

function hours(minute:number): string {
  const time=Math.floor(minute%1440);
  return String(Math.floor(time/60)).padStart(2,'0')+':'+String(time%60).padStart(2,'0');
}
function windowName(shift:PublicShift, now:number) {
  const day=Math.floor(shift.start/1440)-Math.floor(now/1440);
  return `${day===1?'明天':'今天'} ${hours(shift.start)}–${hours(shift.end)}`;
}

/** Roster decisions use one's own commitment or the actual board at a visible facility.
 * A sign at home can give directions, but never shares private stock or unobserved vacancies. */
export function dutyOpportunities(w:World,r:Resident):FormalOpportunity[]{
  if(w.mode!=='formal'||!w.duties||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return [];
  const own:FormalOpportunity[]=[],visits:FormalOpportunity[]=[],services:FormalOpportunity[]=[];
  const signups:FormalOpportunity[]=[],declines:FormalOpportunity[]=[];
  const places=new Map(w.buildings.map(b=>[b.id,b]));
  const openShifts=w.duties.shifts.filter(s=>s.end>w.minute&&s.status!=='unfilled'&&s.status!=='finished');
  const booked=openShifts.filter(s=>s.workerId===r.id);
  const nearby=(place:Building)=>distance(r.at,place.door)<=8 && (r.inside===null||r.inside===place.id);
  function add(to:FormalOpportunity[],shift:PublicShift,operation:PublicDutyAction['operation'],label:string,fromShiftId?:string){
    const action:PublicDutyAction={type:'publicDuty',operation,shiftId:shift.id,...(fromShiftId?{fromShiftId}:{})};
    if(!dutyReason(w,r,action))to.push({id:`duty.${operation}.${shift.id}${fromShiftId?'.'+fromShiftId:''}`,label,action});
  }
  for(const shift of booked){
    const place=places.get(shift.buildingId);if(!place)continue;
    const name=`${place.name} ${windowName(shift,w.minute)} ${dutyNames[shift.role]}`;
    add(own,shift,'attend',`按自己的预约到${name}报到，${shift.funding?'使用本处公共物资，每次完成服务领 '+shift.funding.wagePerService+' 钱':'备好本人供给'}`);
    add(own,shift,'stay',`在${name}继续值守 15 分钟，接受在场居民的请求`);
    add(own,shift,'withdraw',`到公告板辞去自己的${name}班，其他人可自行接班`);
  }
  const visible=openShifts.filter(s=>{const p=places.get(s.buildingId);return p && nearby(p);})
    .sort((a,b)=>a.start-b.start||distance(places.get(a.buildingId)!.door,r.at)-distance(places.get(b.buildingId)!.door,r.at));
  for(const shift of visible){
    const place=places.get(shift.buildingId)!;
    const common=`${place.name} ${windowName(shift,w.minute)} ${dutyNames[shift.role]}`;
    const cost=shift.funding?`公共物资已到位，每次完成服务领 ${shift.funding.wagePerService} 钱，空岗不付薪`:shift.role==='kitchen'?'每份热餐自愿供 2 芜菁和 1 水':'每次基础照护自愿供 1 餐食和 1 水';
    if(shift.status==='on-duty' && shift.workerId!==r.id){
      add(services,shift,'receive',`本人到${place.name}${shift.role==='kitchen'?'吃热餐（20 分钟）':'接受值班者的一次饭水和基础照护（30 分钟）'}`);
    }
    if(shift.status!=='open'||shift.declinedBy.includes(r.id))continue;
    for(const old of booked.filter(s=>s.buildingId===shift.buildingId&&s.status==='booked')){
      add(own,shift,'reschedule',`将本人${windowName(old,w.minute)}的班改至${common}（${cost}）`,old.id);
    }
    add(signups,shift,'claim',`${shift.assignments.length?'自愿接替空出的':'自愿认领'}${common}班；${cost}，到时亲自报到`);
    add(declines,shift,'decline',`本次不报名${common}班`);
  }
  const knownId=visibleStreetDirectory(w,r)?.hall.id;
  const known=w.buildings.filter(b=>b.ownerId==='commons' && (b.kind==='clinic'||b.kind==='lodge') && b.condition>0
    && (r.knownBuildings.includes(b.id)||knownId===b.id)).sort((a,b)=>distance(r.at,a.door)-distance(r.at,b.door));
  if(known[0]&&!nearby(known[0])){
    const place=known[0];
    visits.push({id:`duty.board.${place.id}`,label:`到${place.name}门口看公开班表与服务时间`,action:{type:'move',to:{...place.door}}});
  }
  // Keep alternatives to any one booking visible even at a busy notice board.
  return [...own.slice(0,5),...services.slice(0,2),...signups.slice(0,3),...declines.slice(0,1),...visits];
}

