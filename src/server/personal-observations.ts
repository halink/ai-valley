import type {Resident,World} from '../shared/types.js';
import {knownAgeYears,calendar,DAY} from '../world/time.js';
import {observeBody} from '../world/body-observation.js';
import {bodySignLabels} from '../shared/body-observation.js';

function timeLabel(minute:number):string{
  const date=calendar(minute);
  const season={spring:'春',summer:'夏',autumn:'秋',winter:'冬'}[date.season];
  return `${season}${date.day}日 ${String(date.hour).padStart(2,'0')}:${String(date.minute).padStart(2,'0')}`;
}

/** Personal commitments survive conversation turnover. Remote bodies and other people's stock remain unobserved. */
export function personalObservations(w:World,actor:Resident):string{
  const relationships=actor.relations.filter(link=>link.kin||link.adoptive||link.partner).map(link=>{
    const name=w.residents.find(p=>p.id===link.targetId)?.name??'家人';
    const role=link.partner==='married'?'配偶':link.partner==='dating'?'恋人':link.adoptive==='parent'?'养亲':link.adoptive==='child'?'养子女':link.adoptive==='sibling'?'收养手足':link.kin==='parent'?'父母':link.kin==='child'?'子女':'手足';
    return role+' '+name;
  }).slice(0,12);
  const notes:string[]=[];
  if(relationships.length)notes.push('你记得的亲属与伴侣有'+relationships.join('、')+'。');
  if(actor.pregnancy){
    const parent=w.residents.find(p=>p.id===actor.pregnancy!.otherParentId);
    const days=Math.max(0,Math.ceil((actor.pregnancy.dueAt-w.minute)/DAY));
    notes.push(`你本人正在孕育，已与${parent?.name??'另一位家长'}共同确认安排，距预计出生约 ${days} 个游戏日。`);
  }
  for(const child of w.residents.filter(person=>person.guardianIds.includes(actor.id))){
    const age=knownAgeYears(child.bornAt,w.minute);
    if(age!==null&&age>=18)continue;
    const home=child.homeId&&actor.knownBuildings.includes(child.homeId)?w.buildings.find(b=>b.id===child.homeId):undefined;
    const registration=`你登记监护${child.name}（${age===null?'年龄未知':Math.floor(age)+'岁'}）${home?'，登记住处是'+home.name:''}。`;
    const observation=observeBody(w,actor,child);
    if(observation){
      notes.push(registration+'近身所见：'+observation.signs.map(s=>bodySignLabels[s]).join('；')+'。'+
       (age!==null&&age<6?'幼儿喂养需要使用照护者自己的餐食或芜菁以及清水。':''));
    }else notes.push(registration+'没有可据此确认的当前身体需要；不能从登记或亲属关系推断远处情况。');
  }
  for(const shift of w.duties?.shifts??[]){
    if(shift.workerId!==actor.id||shift.end<=w.minute||shift.status==='finished'||shift.status==='unfilled')continue;
    const place=w.buildings.find(building=>building.id===shift.buildingId);
    const ingredient=shift.role==='care'?'meal':'turnip';
    const needed=shift.role==='care'?1:2;
    const foodMissing=Math.max(0,needed-(actor.inventory[ingredient]??0));
    const waterMissing=Math.max(0,1-(actor.inventory.water??0));
    const supplies=shift.funding?`此班使用现场公共物资，每次实际完成服务领取 ${shift.funding.wagePerService} 钱，尚待本人到场确认物资。`:foodMissing||waterMissing?`你自己的库存还缺 ${foodMissing} 份${ingredient==='meal'?'餐食':'芜菁'}和 ${waterMissing} 份水。`:'你已带齐至少一次服务所需的自有饭食和水。';
    notes.push(`你自愿认领了${place?.name??'已登记用房'}的${shift.role==='care'?'照护':'公厨'}班，${timeLabel(shift.start)}至${timeLabel(shift.end)}，${shift.status==='on-duty'?'已经在岗':'尚待本人报到'}。${supplies}`);
  }
  return notes.join(' ');
}
