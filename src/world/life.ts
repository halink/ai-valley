import {advancePublicCarrier} from './public-food-procurement.js';
import {recordPreparedBirth} from './pregnancy-preparation.js';
import {closePartnershipsOnDeath,spousesAtDeath} from './relationships.js';
import {physiology,physiologyDefinition} from './physiology.js';
import {physiologyDefaults,type PhysiologyRules} from '../shared/physiology.js';
import {healthDefaults} from '../shared/process-definitions.js';
import {estateLocation} from './estate-custody.js';
import {foodTransaction} from './food.js';
import type {Resident, World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {ageYears,knownAgeYears, DAY} from './time.js';
import {resolveInheritanceBirth} from './production.js';

/** Immediate world fact and estate protection; does not notify distant residents or appoint successors. */
function recordDeathAtomic(w:World,person:Resident,cause:NonNullable<Resident['deathCause']>,detail?:string):boolean {
 if(person.status==='dead')return false;
 const sealedLocation={...estateLocation(person.at,person.inside,person.roomAt??null,person.regionalLocation?'镇外实际路程原址封存，尚无回谷运输':'逝者随身物品原址封存'),...(person.regionalLocation?{regional:{...person.regionalLocation}}:{})};
 for(const t of w.industry?.tools??[])if(t.ownerId===person.id&&!t.location)t.location=structuredClone(sealedLocation);
 person.body={reservedBy:null,carriedBy:null,storedAt:null};person.deathCause=cause;
 if(cause==='accident'&&detail?.trim())person.deathDetail=detail.trim().slice(0,80);
 person.status='dead';person.deathAt=w.minute;person.plan=null;person.activity=null;person.revision++;
 // Public cargo is not an estate: seal its real position before any corpse movement.
 for(const s of w.foreignTrade?.shipments??[])if(s.residentId===person.id&&s.publicReserveId&&s.publicCarrier)advancePublicCarrier(w,s);
 person.canDecide=false;person.canExpress=false;person.intention='已逝';
 const heirs=w.residents.filter(p=>(p.parents.includes(person.id)||p.adoptiveParents?.includes(person.id))).map(p=>p.id);
 // Expected children retain a claim reference before identity creation; birth replaces it with the child's identity.
 for(const p of w.residents)if(p.pregnancy?.otherParentId===person.id)heirs.push(`unborn:${p.id}:${p.pregnancy.conceivedAt}`);
 if(!w.estates.some(e=>e.personId===person.id)){
  w.estates.push({spouseIds:spousesAtDeath(person),location:structuredClone(sealedLocation),parcels:[],personId:person.id,inventory:{...person.inventory},coins:person.coins,status:'protected',heirs});
  person.inventory={};person.coins=0;
 }
 for(const p of w.proposals)if(p.status==='open'&&(p.actorId===person.id||p.targetId===person.id))p.status='expired';
 for(const offer of w.offers)if(offer.status==='open'&&(offer.actorId===person.id||offer.targetId===person.id))offer.status='expired';
 // Death ends bed occupancy while homeId continues to identify the last registered home.
 for(const building of w.buildings)building.residents=building.residents.filter(id=>id!==person.id);
 delete person.guardianOffer;delete person.homeInvitation;
 // A gestator's own death terminates this physical pregnancy, without inventing a second living character.
 if(person.pregnancy){
  const unresolved=`unborn:${person.id}:${person.pregnancy.conceivedAt}`;
  for(const estate of w.estates)estate.heirs=estate.heirs.filter(id=>id!==unresolved);
  resolveInheritanceBirth(w,unresolved,null);
  person.pregnancy=null;
 }
 const end=cause==='oldAge'?'因自然衰老离世':cause==='accident'?`因${person.deathDetail??'意外'}离世`:'去世';
 emitEvent(w,{kind:'death',populationChange:person.residency==='outside'?undefined:'death',witnesses:person.residency==='outside'?[]:undefined,actors:[person.id],place:{...person.at},text:`${person.name}${person.regionalLocation?`在镇外往${person.regionalLocation.origin}的原路上（离谷口${person.regionalLocation.progress}/${person.regionalLocation.duration}分钟路程）`:person.residency==='outside'?'在镇外':''}${end}了。遗体留在原处，个人遗产已保全，安葬与后续处置尚待在世人物实际办理。`});
 closePartnershipsOnDeath(w,person);
 return true;
}

function birth(w:World,parent:Resident){
 const pregnancy=parent.pregnancy;if(!pregnancy)return;
 const legacyIdentity=`child:${parent.id}:${pregnancy.conceivedAt}`;
 const identity=`child-${identityHash(w.seed,parent.id+':'+pregnancy.conceivedAt).toString(36)}-${Math.floor(pregnancy.conceivedAt).toString(36)}`;
 if(w.residents.some(p=>p.id===identity||p.id===legacyIdentity)){parent.pregnancy=null;return;}
 const other=w.residents.find(p=>p.id===pregnancy.otherParentId);
 const child:Resident={
  physiologyDefinition:physiologyDefinition(w).definition,id:identity,name:childName(w,parent,identity),appearance:{...parent.appearance},at:{...parent.at},inside:parent.inside,roomAt:parent.roomAt?{...parent.roomAt}:null,
  bornAt:w.minute,status:'alive',residency:parent.residency,homeId:parent.residency==='outside'?null:parent.homeId,traits:['正在形成自己的喜好'],lifeStage:'infant',
  hunger:15,energy:80,health:85,inventory:{},coins:0,skills:{farming:0,building:0,care:0},
  relations:[],memories:[],knownPeople:[parent.id,...(other&&other.residency!=='outside'?[other.id]:[])],knownResources:[],knownBuildings:[],
  plan:null,activity:null,intention:'新生儿，需要实际照料',revision:0,decisionDue:Number.MAX_SAFE_INTEGER,lastDecisionAt:w.minute,lastFailure:null,
  parents:[parent.id,pregnancy.otherParentId],guardianIds:[parent.id,...(other?.status==='alive'?[other.id]:[])],pregnancy:null,
  canDecide:false,canExpress:false,refusesCare:false,deathAt:null,
 };
 recordPreparedBirth(w,parent,identity);
 w.residents.push(child);
 for(const p of [parent,other].filter((p):p is Resident=>!!p)){
  p.relations.push({targetId:identity,affection:0,trust:0,conflict:0,kin:'child',evidence:[]});
  child.relations.push({targetId:p.id,affection:0,trust:0,conflict:0,kin:'parent',evidence:[]});
 }
 const home=w.buildings.find(b=>b.id===child.homeId);if(home&&!home.residents.includes(identity))home.residents.push(identity);
 // Birth itself is never blocked by a full house; overcrowding remains a real care/housing problem.
 for(const estate of w.estates)estate.heirs=estate.heirs.map(id=>id===`unborn:${parent.id}:${pregnancy.conceivedAt}`?identity:id);
 resolveInheritanceBirth(w,`unborn:${parent.id}:${pregnancy.conceivedAt}`,identity);
 parent.pregnancy=null;
 for(const sibling of w.residents.filter(p=>p.id!==child.id&&[...p.parents,...(p.adoptiveParents??[])].some(id=>child.parents.includes(id)))){
  const biological=sibling.parents.some(id=>child.parents.includes(id));
  child.relations.push({targetId:sibling.id,affection:0,trust:0,conflict:0,...(biological?{kin:'sibling' as const}:{adoptive:'sibling' as const}),evidence:[]});
  sibling.relations.push({targetId:child.id,affection:0,trust:0,conflict:0,...(biological?{kin:'sibling' as const}:{adoptive:'sibling' as const}),evidence:[]});
 }
 const event=emitEvent(w,{kind:'birth',populationChange:child.residency==='outside'?undefined:'birth',witnesses:child.residency==='outside'?[]:undefined,actors:[parent.id,identity],place:{...parent.at},text:`${parent.name}的孩子${child.name}出生了。新的身份和亲缘已经登记，实际照料仍需要有人承担。`});
 for(const relative of w.residents)for(const tie of relative.relations)if(tie.targetId===child.id||relative===child)tie.evidence.push(event.id);
}

function identityHash(seed:number,identity:string):number {
 let value=seed>>>0;
 for(const character of identity)value=Math.imul(value^character.charCodeAt(0),16777619)>>>0;
 value^=value>>>16;value=Math.imul(value,0x85ebca6b)>>>0;value^=value>>>13;
 return value>>>0;
}
function childName(w:World,parent:Resident,identity:string):string {
 const first=['沐','知','景','禾','星','望','清','安','小','远','思','云','宁','溪','初','书'];
 const second=['禾','宁','雨','川','言','夏','月','竹','澄','庭','林','音','晨','白','棠','舟'];
 const hash=identityHash(w.seed,identity),surname=Array.from(parent.name)[0]??'谷';
 for(let offset=0;offset<256;offset++){
  const name=surname+first[(hash+offset)%16]+second[(Math.floor(hash/16)+Math.floor(offset/16))%16];
  if(!w.residents.some(p=>p.name===name))return name;
 }
 return surname+'宁'+w.residents.length;
}
export function lifeStage(age:number):NonNullable<Resident['lifeStage']> {
 if(age<6)return 'infant';
 if(age<13)return 'child';
 if(age<18)return 'teen';
 if(age<65)return 'adult';
 return 'elder';
}
const stageNames={infant:'婴幼儿',child:'儿童',teen:'青少年',adult:'成年',elder:'老年'};

/** Natural sleep is infant physiology. Feeding still consumes the supplies of an actual caregiver. */
export function infantRest(w:World,person:Resident,minutes:number):void {
 const age=knownAgeYears(person.bornAt,w.minute);
 if(person.status!=='alive'||person.residency==='outside'||age===null||age>=6)return;
 const hour=(w.minute%DAY)/60;
 if(hour<8||hour>=19||person.energy<25)person.energy=Math.min(100,person.energy+minutes*physiology(w,person).infantRest);
}

/** Daily age-related mortality is deterministic under replay, with no scheduled death dates. */
export function ageMortalityDue(seed:number,person:Resident,from:number,to:number,rules:PhysiologyRules=physiologyDefaults):boolean {
 if(person.status!=='alive')return false;
 for(let day=Math.floor(from/DAY)+1;day<=Math.floor(to/DAY);day++){
  const age=ageYears(person.bornAt,day*DAY);
  if(age<rules.elderYears)continue;
  const yearlyHazard=rules.yearlyHazard*Math.pow(2,(age-rules.elderYears)/rules.hazardDoublingYears);
  const dailyRisk=1-Math.exp(-yearlyHazard/112);
  const draw=identityHash(seed,person.id+':natural-life:'+day)/4294967296;
  if(draw<dailyRisk)return true;
 }
 return false;
}

export function naturalDeath(w:World,person:Resident,from:number,to:number):boolean {
 if(w.mode!=='formal'||!ageMortalityDue(w.seed,person,from,to,physiology(w,person)))return false;
 return recordDeath(w,person,'oldAge');
}

function activateChild(w:World,p:Resident,age:number,prior:Resident['lifeStage']){
 if(age<6||p.canDecide||p.canExpress)return;
 // Existing missed transitions still have their original birth timestamp as their last decision.
 const awaitingFirstDecision=(p.id.startsWith('child-')||p.id.startsWith('child:'))&&p.lastDecisionAt===p.bornAt;
 if(prior!=='infant'&&p.decisionDue!==Number.MAX_SAFE_INTEGER&&!awaitingFirstDecision)return;
 const cases=w.health?.cases.filter(c=>c.personId===p.id&&c.stage!=='resolved')??[];
 if(cases.some(c=>c.capacity))return;
 const critical=cases.find(c=>{
  const rules=c.rules??healthDefaults;
  return c.severity>=rules.criticalSeverity||p.health<=rules.criticalHealth;
 });
 if(critical)critical.capacity={decide:true,express:true};
 else{p.canDecide=true;p.canExpress=true;}
 p.decisionDue=w.minute;p.lastDecisionAt=-1;p.revision++;
 if(!critical)p.intention='想要自己探索眼前的生活';
}

/** Engine owns baseline physiology and advances world.minute before calling this function. */
export function advanceLife(w:World,minutes:number):void {
 if(!Number.isFinite(minutes)||minutes<=0||w.clock.paused)return;
 const from=w.minute-minutes;
 for(const p of [...w.residents]){
  if(p.status!=='alive')continue;
  if(p.health<=0){recordDeath(w,p);continue;}
  if(naturalDeath(w,p,from,w.minute))continue;
  if(p.pregnancy&&p.pregnancy.dueAt<=w.minute)birth(w,p);
  if(p.guardianOffer&&p.guardianOffer.expiresAt<=w.minute)delete p.guardianOffer;
  if(p.homeInvitation&&p.homeInvitation.expiresAt<=w.minute)delete p.homeInvitation;
  const age=knownAgeYears(p.bornAt,w.minute);
  // A missing/invalid birth record is not a new infant stage or a birthday.
  // Preserve existing capabilities and history; age-independent expiry stays live.
  if(age===null)continue;
  const next=lifeStage(age);
  const prior=p.lifeStage??lifeStage(ageYears(p.bornAt,from));
  p.lifeStage=next;
  infantRest(w,p,minutes);
  activateChild(w,p,age,prior);
  if(next!==prior){
   if(age>=18){p.guardianIds=[];delete p.guardianOffer;}
   emitEvent(w,{kind:'action',populationChange:next==='adult'&&p.residency!=='outside'?'adult':undefined,
    witnesses:p.residency==='outside'?[]:undefined,actors:[p.id],place:{...p.at},text:`${p.name}进入${stageNames[next]}阶段，接下来的生活由其能力与自己的选择展开。`});
  }
 }
 for(const p of w.proposals)if(p.status==='open'&&p.expiresAt<=w.minute)p.status='expired';
}

export function recordDeath(w:World,person:Resident,cause:NonNullable<Resident['deathCause']>='illHealth',detail?:string):boolean{return foodTransaction(w,()=>recordDeathAtomic(w,person,cause,detail));}
