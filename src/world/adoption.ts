import type {FormalOpportunity,Resident,World} from '../shared/types.js';import type {AdoptionAction,AdoptionAgreement} from '../shared/adoption.js';import {knownAgeYears,DAY} from './time.js';import {coLocated} from './proximity.js';import {same} from './navigation.js';import {deathProof} from './knowledge.js';import {emitEvent} from './events.js';
const person=(w:World,id?:string)=>w.residents.find(r=>r.id===id);
const capable=(p:Resident|undefined):p is Resident=>!!p&&p.status==='alive'&&p.residency!=='outside'&&p.canDecide&&p.canExpress;
const adult=(w:World,p:Resident|undefined):p is Resident=>capable(p)&&(knownAgeYears(p.bornAt,w.minute)??-1)>=18;
const agreement=(w:World,id?:string)=>w.adoption?.agreements.find(c=>c.id===id);
export function initializeAdoption(w:World){if(w.mode!=='formal')return;w.adoption??={agreements:[],nextSerial:1};w.definitions['family/adoption@1']??={id:'family/adoption',version:1,kind:'action',dependencies:[],data:{days:7,childAssentAge:6,adultAge:18,preserveBirthParents:true,moveHome:false,mergeAssets:false,guardianRule:'全部现有监护人分别同意；已核实死亡者不再要求新签署。孩子有能力时独立同意。公共会馆实际登记后生效。'}};}
function eligibleChild(w:World,p:Resident|undefined):p is Resident{const age=p&&knownAgeYears(p.bornAt,w.minute);return !!p&&p.status==='alive'&&p.residency!=='outside'&&age!==null&&age!==undefined&&age<18;}
function parentIds(r:Resident){return [...r.parents,...(r.adoptiveParents??[])];}
function ancestor(w:World,r:Resident,id:string,seen=new Set<string>()):boolean {if(seen.has(r.id))return false;seen.add(r.id);return parentIds(r).includes(id)||parentIds(r).some(p=>{const a=person(w,p);return !!a&&ancestor(w,a,id,seen);});}
function childAssented(w:World,c:AdoptionAgreement){
 const at=c.childAssentedAt,child=person(w,c.childId),age=knownAgeYears(child?.bornAt,at);
 if(typeof at!=='number'||!Number.isFinite(at)||!(at>=c.createdAt&&at<c.expiresAt&&at<=w.minute)||age===null||age<6||age>=18)return false;
 // Signature events are retained by the working-history and SQLite loaders.
 // A changed timestamp cannot mature into consent merely as the clock passes.
 return c.signatures.some(s=>s.personId===c.childId&&s.at===at&&w.events.some(e=>e.id===s.eventId&&e.at===at&&e.kind==='relationship'&&e.actors[0]===c.childId&&e.actors.includes(c.adopterId)));
}
function ready(w:World,c:AdoptionAgreement){const p=person(w,c.childId);return eligibleChild(w,p)&&c.guardianIds.every(id=>c.signatures.some(s=>s.personId===id))&&(knownAgeYears(p.bornAt,w.minute)!<6||capable(p)&&childAssented(w,c));}
function currentAuthority(w:World,c:AdoptionAgreement){const child=person(w,c.childId)!;return child.guardianIds.every(id=>id===c.adopterId||c.guardianIds.includes(id)||!!deathProof(w,person(w,c.adopterId)!,id));}
export function adoptionReason(w:World,r:Resident,a:AdoptionAction):string|null {
 if(w.mode!=='formal'||!w.adoption||!capable(r))return '本人目前不能决定收养安排';
 if(a.operation==='propose'){
  const child=person(w,a.childId);if(!adult(w,r)||!eligibleChild(w,child)||child.id===r.id||!r.knownPeople.includes(child.id)||!coLocated(w,r,child,2)||parentIds(child).includes(r.id)||ancestor(w,r,child.id))return '需要相识且实际在场的未成年孩子、成年收养人，不能重复或颠倒既有亲缘';
  if(knownAgeYears(child.bornAt,w.minute)!>=6&&!capable(child))return '具有独立同意年龄的孩子目前无法作出这项长期决定';
  if(w.adoption.agreements.some(c=>c.childId===child.id&&c.status==='pending'&&c.expiresAt>w.minute))return '孩子已有一项尚待各人决定的收养提议';
  for(const id of child.guardianIds){if(id===r.id)continue;const g=person(w,id);if(g?.status==='dead'){if(!deathProof(w,r,id))return '不能凭内部状态认定监护人不在，需要本人已经核实的失去监护事实';}else if(!adult(w,g)||!coLocated(w,r,g,2)||!coLocated(w,child,g,2))return '所有现有监护人须能分别作决定，并实际在场参与这项永久安排';}
  if(!child.guardianIds.length&&parentIds(child).some(id=>!deathProof(w,r,id)))return '尚无可以核实原监护关系的资料';
  return null;
 }
 const c=agreement(w,a.adoptionId),child=c&&person(w,c.childId),adopter=c&&person(w,c.adopterId),childAge=child&&knownAgeYears(child.bornAt,w.minute),adopterAge=adopter&&knownAgeYears(adopter.bornAt,w.minute);
 if(!c||c.status!=='pending'||c.expiresAt<=w.minute||!child||child.status!=='alive'||child.residency==='outside'||childAge!==null&&childAge!==undefined&&childAge>=18||!capable(adopter)||adopterAge!==null&&adopterAge!==undefined&&adopterAge<18)return '这项待决定的收养安排已经不适用';
 // Unknown age pauses positive authorization, not a party's existing right
 // to reject or withdraw the pending proposal. Neither reads nor failed
 // actions rewrite its original signatures, identity or deadline.
 if(a.operation==='withdraw')return [c.adopterId,c.childId,...c.guardianIds].includes(r.id)?null:'本人不是这项收养安排的当事人';
 if(!(a.operation==='consent'&&a.accept===false)&&(!eligibleChild(w,child)||!adult(w,adopter)))return '需要可核实的未成年年龄与成年收养人，暂不能新增同意或登记';
 if(a.operation==='consent'){
  if(typeof a.accept!=='boolean'||!([c.childId,...c.guardianIds].includes(r.id))||!coLocated(w,r,adopter,2)||!coLocated(w,r,child,2))return '须由相关监护人或孩子本人实际到场，分别同意或拒绝';
  if(a.accept&&r.id!==child.id&&!adult(w,r))return '监护人的新同意需要可核实的成年年龄与决定能力';
  return a.accept&&(r.id===c.childId?childAssented(w,c):c.signatures.some(s=>s.personId===r.id))?'本人已经签署，可以另行撤回':null;
 }
 if(a.operation==='register'){
  const b=w.buildings.find(b=>b.id===a.buildingId);if(r.id!==c.adopterId||!b||b.kind!=='lodge'||b.ownerId!=='commons'||b.condition<=0||!r.knownBuildings.includes(b.id)||!ready(w,c)||!currentAuthority(w,c))return '需要全部独立同意、仍适用的监护安排与本人已知的公共会馆登记处';return null;
 }return '没有这项收养安排';
}
export function adoptionTarget(w:World,r:Resident,a:AdoptionAction){const error=adoptionReason(w,r,a);return error?{target:r.at,duration:0,error}:{target:a.operation==='register'?{...w.buildings.find(b=>b.id===a.buildingId)!.door}:{...r.at},duration:a.operation==='register'?15:5};}
function tie(r:Resident,id:string,role:'parent'|'child'|'sibling',evidence:string){let t=r.relations.find(t=>t.targetId===id);if(!t){t={targetId:id,affection:0,trust:0,conflict:0,evidence:[]};r.relations.push(t);}t.adoptive=role;if(!t.evidence.includes(evidence))t.evidence.push(evidence);}
export function completeAdoption(w:World,r:Resident,a:AdoptionAction):string|null {
 const error=adoptionReason(w,r,a);if(error)return error;const s=w.adoption!;
 if(a.operation==='propose'){
  const child=person(w,a.childId)!,e=emitEvent(w,{kind:'relationship',actors:[r.id,child.id],place:{...r.at},text:`${r.name}亲自提出收养${child.name}，原身份、父母、财产与住处保持连续，等待有关监护人和孩子分别决定。`});
  s.agreements.push({id:'adoption:'+s.nextSerial++,definition:'family/adoption@1',adopterId:r.id,childId:child.id,guardianIds:child.guardianIds.filter(id=>id!==r.id&&person(w,id)?.status!=='dead'),signatures:[{personId:r.id,at:w.minute,eventId:e.id}],childAssentedAt:null,createdAt:w.minute,expiresAt:w.minute+7*DAY,status:'pending',registeredAt:null,buildingId:null,registrationEventId:null,reason:null});
 }else {
  const c=agreement(w,a.adoptionId)!,child=person(w,c.childId)!,adopter=person(w,c.adopterId)!;
  if(a.operation==='consent'||a.operation==='withdraw'){
   const yes=a.operation==='consent'&&a.accept,e=emitEvent(w,{kind:'relationship',actors:[r.id,adopter.id,child.id],place:{...r.at},text:`${r.name}亲自${yes?'同意':'拒绝或撤回'}了${adopter.name}收养${child.name}的这项安排，尚未实际登记。`});
   if(!yes){c.status=a.operation==='withdraw'?'withdrawn':'declined';c.reason='有关当事人自主拒绝或撤回';}else {if(r.id===child.id)c.childAssentedAt=w.minute;c.signatures.push({personId:r.id,at:w.minute,eventId:e.id});}
  }else {
   const b=w.buildings.find(b=>b.id===a.buildingId)!;if(r.inside||!same(r.at,b.door))return '须收养人本人把已接受的具体文书实际送到公共登记处';
   const e=emitEvent(w,{kind:'relationship',actors:[r.id,child.id],place:{...r.at},populationChange:'adoption',text:`${r.name}亲自到${b.name}登记了各方已经独立接受的收养，成为${child.name}的养亲及监护人。孩子的身份、出生亲缘、经历、个人财产和实际住处均未重置；同住与照护另行安排。`});
   child.adoptiveParents??=[];child.adoptiveParents.push(r.id);if(!child.guardianIds.includes(r.id))child.guardianIds.push(r.id);
   tie(child,r.id,'parent',e.id);tie(r,child.id,'child',e.id);
   for(const sibling of w.residents.filter(p=>p.id!==child.id&&parentIds(p).includes(r.id))){tie(child,sibling.id,'sibling',e.id);tie(sibling,child.id,'sibling',e.id);}
   c.status='registered';c.registeredAt=w.minute;c.buildingId=b.id;c.registrationEventId=e.id;child.revision++;
  }
 }r.revision++;return null;
}
export function advanceAdoption(w:World){initializeAdoption(w);for(const c of w.adoption?.agreements??[]){const child=person(w,c.childId),age=child&&knownAgeYears(child.bornAt,w.minute);if(c.status==='pending'&&(c.expiresAt<=w.minute||!child||child.status!=='alive'||child.residency==='outside'||age!==null&&age!==undefined&&age>=18||person(w,c.adopterId)?.status!=='alive')){c.status='expired';c.reason='待签署期限结束或有关人物已无法完成这项永久安排';}}if(w.adoption&&w.adoption.agreements.length>160)w.adoption.agreements=w.adoption.agreements.filter((c,i)=>c.status==='registered'||c.status==='pending'||i>=w.adoption!.agreements.length-80);}
export function adoptionOpportunities(w:World,r:Resident):FormalOpportunity[]{const result:FormalOpportunity[]=[],add=(id:string,label:string,a:AdoptionAction)=>{if(!adoptionReason(w,r,a))result.push({id:'adoption.'+id,label,action:a});};
 for(const child of w.residents.filter(p=>coLocated(w,r,p,2)))add('propose.'+child.id,`向在场家人提出收养${child.name}，原父母、身份、经历、住处和个人财产保留；必须各方分别同意后再实际登记`,{type:'adoption',operation:'propose',childId:child.id});
 for(const c of w.adoption?.agreements.filter(c=>c.status==='pending')??[]){
  for(const accept of [true,false])add('consent.'+c.id+'.'+accept,`${accept?'本人同意':'本人拒绝'}${person(w,c.adopterId)?.name}收养${person(w,c.childId)?.name}的具体安排；这不等于代替另一人同意`,{type:'adoption',operation:'consent',adoptionId:c.id,accept});
  add('withdraw.'+c.id,'本人撤回这项尚未登记的收养安排',{type:'adoption',operation:'withdraw',adoptionId:c.id});
  for(const b of w.buildings.filter(b=>b.kind==='lodge'&&b.ownerId==='commons'))add('register.'+c.id+'.'+b.id,`把各方已签署的收养文书亲自送到${b.name}登记，增加养亲与监护记录，不替孩子搬家或处分财产`,{type:'adoption',operation:'register',adoptionId:c.id,buildingId:b.id});
 }return result;
}
