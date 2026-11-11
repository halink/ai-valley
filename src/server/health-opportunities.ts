import {adultEvacuationDanger} from '../world/adult-emergency-evacuation.js';
import {healthDefinition} from '../world/process-definitions.js';
import {guardianEvacuationDanger,guardianGroundRoute,guardianGroundPatientReason} from '../world/guardian-evacuation.js';
import {canInspectBuilding} from '../world/building-knowledge.js';
import {bindFerryContact,passenger} from '../world/medical-transport.js';
import type {FormalOpportunity,Resident,World} from '../shared/types.js';import type {HealthAction} from '../shared/health.js';import {healthReason,activeCases} from '../world/health.js';import {coLocated} from '../world/proximity.js';
export function healthOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const rules=healthDefinition(w).rules,choices:FormalOpportunity[]=[];const add=(id:string,label:string,action:HealthAction)=>{bindFerryContact(w,action);if(!healthReason(w,r,action,'menu'))choices.push({id:'health.'+id,label,action});};
 const carried=passenger(w,r.id);if(carried){add('stopTransport.'+carried.id,'本人明确停止正在进行的护送，保留在实际当前位置，再另作安排',{type:'health',operation:'cancelRescue',transportId:carried.id});return choices;}
 add('selfTreat',`自主用本人${rules.medicine}药剂、${rules.water}清水和${rules.selfMinutes}分钟处理自己的伤病，之后仍需康复`,{type:'health',operation:'selfTreat'});
 for(const o of w.health?.transportOffers??[]){if(o.respondentId===r.id||o.patientId===r.id){add('acceptRescue.'+o.id,`自行接受${w.residents.find(p=>p.id===o.carrierId)?.name??'对方'}护送${w.residents.find(p=>p.id===o.patientId)?.name??'患者'}到${w.buildings.find(b=>b.id===o.buildingId)?.name??'接收场所'}的具体安排`,{type:'health',operation:'acceptRescue',offerId:o.id});add('declineRescue.'+o.id,'婉拒这份护送提议',{type:'health',operation:'declineRescue',offerId:o.id});}if([o.carrierId,o.respondentId,o.patientId].includes(r.id)&&['offered','accepted','awaitingPatient'].includes(o.status))add('cancelRescue.'+o.id,'撤回本人尚未执行的护送安排',{type:'health',operation:'cancelRescue',offerId:o.id});}
 for(const t of w.health?.transports??[])if(t.phase==='carrying'&&t.carrierId===r.id)add('stopTransport.'+t.id,'停止本人正在执行的护送，患者留在实际位置',{type:'health',operation:'cancelRescue',transportId:t.id});
 const patients=w.residents.filter(p=>p.id!==r.id&&p.status==='alive'&&coLocated(w,r,p,12)&&activeCases(w,p.id).length);
 const rescuePatients=w.residents.filter(p=>p.id!==r.id&&p.status==='alive'&&coLocated(w,r,p,12)&&(p.health<45||activeCases(w,p.id).some(c=>c.severity>=20)));
 // Disaster departure is separate from treatment. Non-severe cases retain
 // bounded ground evacuation, but do not acquire new bed or medical authority.
 // Keep rescuePatients unchanged: it also controls stabilization choices.
 for(const p of w.residents){
  const danger=guardianEvacuationDanger(w,r,p);if(!danger)continue;
  for(const b of p.health>=45&&!activeCases(w,p.id).length?w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&['clinic','lodge'].includes(b.kind)&&(canInspectBuilding(w,r,b)||r.inside!==null&&r.inside===p.inside)):[]){
   if(!canInspectBuilding(w,r,b)){
    add(`guardianEvacuation.${p.id}.${b.id}`,`本人作为当前监护人，可自愿用本人1布料、1清水和实际步行，将眼前受灾的${p.name}接出房间，按本人已知地址尝试前往${b.name}；不保证安全空床，不远程预占，到场核验权利、屋况与床位，失败留在实际位置另作决定`,{type:'health',operation:'rescue',targetId:p.id,buildingId:b.id,evacuationDangerId:danger.id,evacuationDestination:'known-address'});
    continue;
   }
   add(`guardianEvacuation.${p.id}.${b.id}`,`本人作为当前监护人，可自愿用本人1布料、1清水与实际时间，将眼前受当前灾害威胁的${p.name}护送到${b.name}的安全空床；尊重孩子拒绝，接出前重新确认原危险与监护职责`,{type:'health',operation:'rescue',targetId:p.id,buildingId:b.id,evacuationDangerId:danger.id});
  }
  // Ground evacuation is independently selectable; it never reserves a bed.
  // Indoors we authorize only the real exit and a bounded search after emerging.
  if(guardianGroundPatientReason(w,p))continue;
  const ground=r.inside?null:guardianGroundRoute(w,r,p.at);
  if(r.inside||ground)add(`guardianGround.${p.id}`,r.inside?`本人作为当前监护人，自愿用本人1布料、1清水接出${p.name}，逐格出门后现场寻找最多8步内可见干地；不保证门外安全，无可达干地则停在实际门口。途中重验伤情，只临时撤险，不授权医疗、住房或后续照护，孩子仍可拒绝或停止`:`本人作为当前监护人，自愿用本人1布料、1清水将眼前受灾的${p.name}逐格护送到附近干地（${ground!.to.x}，${ground!.to.y}），最多8步，途中重验伤情与风险；只临时撤险，不占床、不授权医疗或住房，孩子仍可拒绝或停止`,{type:'health',operation:'rescue',targetId:p.id,evacuationDangerId:danger.id,evacuationDestination:'safe-ground',...(r.inside?{evacuationExitId:r.inside}:{evacuationGround:ground!.to})});
 }
 // This separate emergency choice never adds adults to medical permissions.
 for(const p of w.residents){
  const danger=adultEvacuationDanger(w,r,p);if(!danger)continue;
  const ground=r.inside?null:guardianGroundRoute(w,r,p.at);
  if(r.inside||ground)add(`adultGround.${p.id}`,`自愿用本人1布料、1清水，将现场不能自行决定且未拒绝的成年${p.name}${r.inside?'先逐格接出灾屋，到真实门口才寻找八步内干地':'逐格撤到附近干地（'+ground!.to.x+'，'+ground!.to.y+'）'}；最多8个实际户外步，只撤离实际迫近危险，不授权药物、床位、财产、住房或长期照护；本人恢复决定能力或表示停止即终止，危险变化重新核验`,{type:'health',operation:'rescue',targetId:p.id,evacuationAuthority:'incapacitated-adult',evacuationDangerId:danger.id,evacuationDestination:'safe-ground',...(r.inside?{evacuationExitId:r.inside}:{evacuationGround:ground!.to})});
 }
 for(const p of rescuePatients.slice(0,3)){add('stabilize.'+p.id,`自愿亲自用本人1药剂、1水为${p.name}作30分钟有限基本稳定处理，须当前监护职责或严格紧急权限；能力恢复、拒绝或及时代理出现会终止例外`,{type:'health',operation:'stabilize',targetId:p.id});for(const b of w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&['clinic','lodge'].includes(b.kind)).slice(0,3)){add(`rescueOffer.${p.id}.${b.id}`,`向${p.name}或可及时决定的监护人提出护送到${b.name}，等待另行接受`,{type:'health',operation:'rescueOffer',targetId:p.id,buildingId:b.id});add(`rescue.${p.id}.${b.id}`,`自愿用本人布料、清水与实际时间，亲自接出并护送${p.name}到${b.name}的接收床位，屋况、床位与风险仍须现场核验；须具体同意、监护职责或当前有限紧急权限`,{type:'health',operation:'rescue',targetId:p.id,buildingId:b.id});}}
 for(const p of patients.slice(0,3))for(const b of w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&['clinic','lodge'].includes(b.kind)).slice(0,3))add(`offer.${p.id}.${b.id}`,`向${p.name}提出在${b.name}就诊，预留本人${rules.medicine}药剂和${rules.water}清水；填写fee 0–30钱、startsIn 30–2880分钟，患者必须另行接受；实际共同治疗${rules.appointmentMinutes}分钟才获得完整报酬`,{type:'health',operation:'offer',targetId:p.id,buildingId:b.id,fee:0,startsIn:60});
 for(const c of w.health?.appointments??[]){
  if(c.patientId===r.id&&c.status==='offered'){add('accept.'+c.id,`自行接受${w.residents.find(p=>p.id===c.doctorId)?.name??'医生'}提出的诊疗：${c.fee}钱，${Math.max(0,Math.round(c.start-w.minute))}分钟后开始，预存费用只按实际共同诊疗支付`,{type:'health',operation:'accept',appointmentId:c.id});add('decline.'+c.id,'婉拒这份诊疗邀请',{type:'health',operation:'decline',appointmentId:c.id});}
  if(c.status==='accepted'&&(c.doctorId===r.id||c.patientId===r.id)){add('attend.'+c.id,c.doctorId===r.id?`亲自前往预约诊疗位置，为自己已接受的患者实际治疗${c.minutes}分钟`:`亲自前往预约位置接受本人已同意的${c.minutes}分钟诊疗`,{type:'health',operation:c.doctorId===r.id?'treat':'receive',appointmentId:c.id,minutes:c.minutes});add('cancel.'+c.id,'终止本人这次诊疗预约，未发生的费用退回',{type:'health',operation:'cancel',appointmentId:c.id});}
 }return choices;
}
export function healthNotes(w:World,r:Resident){const cases=activeCases(w,r.id);return cases.length?'你自己正经历'+cases.map(c=>`${c.kind==='injury'?'损伤':'生病'}（${c.stage==='critical'?'危重':c.stage==='recovering'?'康复中':'症状持续'}，行动${c.severity>=50?'明显受限':c.severity>=20?'放缓':'正常'}）`).join('、')+'。':'';}
