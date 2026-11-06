import type {FormalOpportunity,Resident,World} from '../shared/types.js';import type {FuneraryAction} from '../shared/funerary.js';import {funeraryReason,deathEvidence,knownBodyLocation} from '../world/funerary.js';import {coLocated} from '../world/proximity.js';
export function funeraryOpportunities(w:World,r:Resident){const result:FormalOpportunity[]=[];const add=(id:string,label:string,action:FuneraryAction)=>{if(!funeraryReason(w,r,action))result.push({id:'funerary.'+id,label,action});};
 for(const b of w.buildings.filter(b=>b.kind==='lodge'&&b.ownerId==='commons'&&r.knownBuildings.includes(b.id))){
  for(const p of w.residents.filter(p=>!!deathEvidence(w,r,p.id)))add('register.'+p.id+'.'+b.id,`亲自去${b.name}提交已核实的${p.name}死亡证明；不自动通知远处的人`,{type:'funerary',operation:'registerDeath',targetId:p.id,buildingId:b.id});
  if(!r.inside&&Math.abs(r.at.x-b.door.x)+Math.abs(r.at.y-b.door.y)<=8)for(const c of w.funerary?.certificates?.filter(c=>c.buildingId===b.id)??[])add('read.'+c.personId,`实际查阅${b.name}关于${w.residents.find(p=>p.id===c.personId)?.name??'原居民'}的死亡登记，取得公共文书证据而非亲见遗体`,{type:'funerary',operation:'readDeathRecord',targetId:c.personId,buildingId:b.id});
 }
 for(const p of w.residents.filter(p=>p.id!==r.id&&(!!deathEvidence(w,r,p.id)||w.funerary?.notices.some(n=>n.recipientId===r.id&&n.personId===p.id)||p.status==='dead'&&coLocated(w,r,p,10))).slice(0,8)){
  add('verify.'+p.id,`根据本人实际掌握的线索，亲自前往核实${p.name}的情况；听说不等于已确认死亡，旧地点也可能已经变化`,{type:'funerary',operation:'verify',targetId:p.id});
  for(const b of w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&['clinic','lodge'].includes(b.kind)).slice(0,4))add('store.'+p.id+'.'+b.id,`亲自接出${p.name}的遗体，沿真实路线送到${b.name}的实际暂存位置；不需要空墓位，也不代表已安葬`,{type:'funerary',operation:'store',targetId:p.id,buildingId:b.id});
  for(const to of w.residents.filter(to=>to.id!==r.id&&to.status==='alive'&&coLocated(w,r,to,2)).slice(0,3))add('notify.'+p.id+'.'+to.id,`亲自告诉${to.name}自己已核实的${p.name}死亡消息与最后知道的安置地点；对方得到消息而非自动取得死亡证据`,{type:'funerary',operation:'notify',targetId:p.id,recipientId:to.id});
 }
 for(const g of w.graves.filter(g=>g.personId).sort((a,b)=>Math.abs(a.at.x-r.at.x)+Math.abs(a.at.y-r.at.y)-Math.abs(b.at.x-r.at.x)-Math.abs(b.at.y-r.at.y)).slice(0,3)){const p=w.residents.find(p=>p.id===g.personId),visible=!r.inside&&Math.abs(r.at.x-g.at.x)+Math.abs(r.at.y-g.at.y)<=12;if(!visible&&!r.knownPeople.includes(g.personId!))continue;
  add('maintain.'+g.id,`用本人1石料、1清水和60分钟亲自修护${p?.name??'这位居民'}的墓位；纪念身份不会随外观损耗消失`,{type:'funerary',operation:'maintain',graveId:g.id});
  const visit:FuneraryAction={type:'funerary',operation:'visit',graveId:g.id,text:'来看看过去的人'};if(!funeraryReason(w,r,visit))result.push({id:'funerary.visit.'+g.id,label:`亲自到${p?.name??'这位居民'}墓前停留30分钟，填写text（1–240字）表达自己的想法`,action:visit});
  const epitaph:FuneraryAction={type:'funerary',operation:'epitaph',graveId:g.id,text:'记得我们相处的日子'};if(!funeraryReason(w,r,epitaph))result.push({id:'funerary.epitaph.'+g.id,label:`亲自为${p?.name??'亲人'}撰写墓志，填写text（1–80字）；不更改其真实生平`,action:epitaph});
 }return result;
}
