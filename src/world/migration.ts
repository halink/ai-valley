import {physiologyDefinition,physiology} from './physiology.js';
import type {Building, DecisionContext, FormalOpportunity, ModelDecision, Resident, World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {ageMortalityDue} from './life.js';
import {distance, findPath, walkable} from './navigation.js';
import {ageYears, calendar, DAY, YEAR} from './time.js';

/** A person first enters the town register at the gate. Afterwards that same resident record is canonical. */
interface RoadContact {
  familyId?:string;familyConsentUntil?:number;
  id:string;
  name:string;
  origin:string;
  person?:Resident;
  phase:'home'|'offered'|'travelling'|'inTown';
  offeredAt:number|null;
  lastDecisionAt:number|null;
  lastChoice:'stay'|'travel'|null;
  futureAt:number;
  journey:{leftAt:number;arriveAt:number;nextCheckAt:number;blocked:boolean}|null;
}
export interface MigrationState {
  contacts:RoadContact[];
  nextPostAt:number;
  nextSerial:number;
  lastSeason:number;
  lastLifeAt:number;
}

const postInterval=(w:World)=>(w.scenario==='frontier'?5:2)*DAY;
const reconsiderAfter=14*DAY;
const seasonLength=28*DAY;
const stations=[
  {name:'西岭驿',minutes:24},
  {name:'苇塘渡',minutes:65},
  {name:'长桥集',minutes:115},
];
const surnames=Array.from('唐任柳江傅魏谷邵柯余孟杜裴石宁桑郁贺季卢');
const firstNames=['苇','桥','荷','岭','溪','枫','棠','川','弦','葵','棣','苓','棉','筠','禹','奚','槐','姜','澄'];
const dispositions=['常留意土地与水源，愿不愿搬家要看亲身感受','熟悉修补木器，对陌生环境保持谨慎','珍惜邻里互助，也喜欢独自在路上旅行','对学校与照护感兴趣，希望自己选择住处','喜欢耕作，往往先访一访才考虑久住','关心自己的手艺有没有用武之地，也留恋原来的家'];
const positionKey=(seed:number, serial:number)=>((Math.imul(seed+607,48271)^Math.imul(serial+11,2654435761))>>>0);

function createContact(w:World,serial:number):RoadContact{
  const hash=positionKey(w.seed,serial);
  const origin=stations[serial%stations.length].name;
  const id=`regional-${w.seed}-${serial+1}`;
  const name=surnames[(w.seed+serial*7)%surnames.length]+firstNames[(w.seed+serial*5+Math.floor(serial/surnames.length))%firstNames.length];
  const person:Resident={physiologyDefinition:physiologyDefinition(w).definition,
    id,name,at:{...w.map.entrance},inside:null,homeId:null,residency:'outside',status:'alive',
    appearance:{hair:[0x483430,0x453031,0x554443][hash%3],skin:[0xf0bc94,0xd69d70,0xe6b589][(hash>>>4)%3],shirt:[0x427c8d,0x885b7d,0xac7140,0x557443][(hash>>>7)%4]},
    bornAt:w.minute-(21+(hash%30))*YEAR-(hash%112)*DAY,traits:[dispositions[serial%dispositions.length]],
    hunger:18+hash%13,energy:80+hash%14,health:89+hash%9,
    inventory:{meal:2+(hash%3),water:3,berry:5+(hash%3),seed:2},coins:12+(hash%16),
    skills:{farming:(hash>>>5)%4,building:(hash>>>8)%3,care:(hash>>>10)%3},
    knownBuildings:[],knownPeople:[],knownResources:[],relations:[],memories:[],intention:'',
    plan:null,activity:null,decisionDue:w.minute,lastDecisionAt:-1,lastFailure:null,revision:0,
    parents:[],guardianIds:[],pregnancy:null,canDecide:true,canExpress:true,refusesCare:false,deathAt:null,
  };
  return {id,name,origin,person,phase:'home',offeredAt:null,lastDecisionAt:null,lastChoice:null,futureAt:w.minute,journey:null};
}

/** A regional household is a finite source of existing people, not a travel or settlement decision. */
function createRegionalFamily(w:World,serial:number):RoadContact[]{const a=createContact(w,serial),b=createContact(w,serial+1);a.familyId=b.familyId='regional-family:'+a.id;b.origin=a.origin;for(const [own,other]of [[a,b],[b,a]]){own.person!.knownPeople.push(other.id);own.person!.relations.push({targetId:other.id,kin:'sibling',affection:0,trust:0,conflict:0,evidence:[]});}return [a,b];}
function travelCompanion(w:World,c:RoadContact){return c.familyId&&!c.journey?w.migration?.contacts.find(t=>t.id!==c.id&&t.familyId===c.familyId&&t.origin===c.origin&&t.phase==='offered'&&!t.journey&&availableTraveller(w,t)):undefined;}
function personFor(w:World,contact:RoadContact):Resident|undefined{
  return contact.person ?? w.residents.find(r=>r.id===contact.id);
}
function availableTraveller(w:World,contact:RoadContact):Resident|undefined{
  const p=personFor(w,contact);
  return p?.status==='alive'&&p.residency==='outside'&&p.canDecide&&p.canExpress&&ageYears(p.bornAt,w.minute)>=18?p:undefined;
}
function newReturnContact(w:World,person:Resident):RoadContact {
  return {id:person.id,name:person.name,origin:stations[0].name,phase:'home',offeredAt:null,
    lastDecisionAt:null,lastChoice:null,futureAt:w.minute+postInterval(w),journey:null};
}

/** Older worlds can join the regional post on their current date; never backfill imaginary visits. */
export function initializeMigration(w:World):void {
  if(w.mode!=='formal'||w.migration)return;
  const contacts=[0,1,2].map(index=>createContact(w,index));
  for(const p of w.residents.filter(p=>p.residency==='outside'&&p.status==='alive')){
    contacts.push(newReturnContact(w,p));
    // Previous versions kept a bed occupied after departure. Its independent legal owner stays recorded.
    const previous=w.buildings.find(b=>b.id===p.homeId);
    if(previous) previous.residents=previous.residents.filter(id=>id!==p.id);
    p.homeId=null;
  }
  if(w.scenario!=='frontier'){contacts[0].phase='offered';contacts[0].offeredAt=w.minute;}
  w.migration={contacts,nextSerial:3,nextPostAt:w.minute+postInterval(w),lastSeason:Math.floor(w.minute/seasonLength),lastLifeAt:w.minute};
}

/** Moving out relinquishes the bed, not title to the house or relations to the people in it. */
export function recordDeparture(w:World,person:Resident):void{
  if(w.mode!=='formal')return;
  initializeMigration(w);
  const contacts=w.migration!.contacts;
  let contact=contacts.find(r=>r.id===person.id);
  if(!contact){contact=newReturnContact(w,person);contacts.push(contact);}
  contact.phase='home';contact.futureAt=w.minute+postInterval(w);contact.journey=null;
  const home=w.buildings.find(b=>b.id===person.homeId);
  if(home)home.residents=home.residents.filter(id=>id!==person.id);
  person.homeId=null;
}

export function canDepart(w:World,person:Resident):string|null{
  if(ageYears(person.bornAt,w.minute)<18)return '儿童独立离镇需要有效监护与实际同行安排';
  if(w.mode!=='formal')return null;
  if(person.pregnancy)return '孕育期间需要先落实镇外接产与同行照护，当前不能独自启程';
  const dependents=w.residents.filter(child=>child.status==='alive'&&child.residency!=='outside'&&ageYears(child.bornAt,w.minute)<18&&child.guardianIds.includes(person.id));
  for(const child of dependents){
    const available=child.guardianIds.some(id=>{
      const other=w.residents.find(p=>p.id===id);
      return other&&other.id!==person.id&&other.status==='alive'&&other.residency!=='outside'&&other.canDecide&&other.canExpress&&ageYears(other.bornAt,w.minute)>=18&&(!child.homeId||other.homeId===child.homeId);
    });
    if(!available)return `${child.name}仍由本人独自监护，须先交接给在镇监护人`;
  }
  return null;
}

export function outsideCandidate(w:World):Resident[]{
  const candidates:Resident[]=[];
  for(const c of w.migration?.contacts??[]){
    if(c.phase!=='offered')continue;
    const p=availableTraveller(w,c);
    if(p&&(!c.familyConsentUntil||p.decisionDue<=w.minute))candidates.push(p);
  }
  return candidates;
}
function stationDuration(w:World,origin:string){return (stations.find(station=>station.name===origin)?.minutes??65)+(w.scenario==='frontier'?180:0);}

export function outsideDecisionContext(w:World,person:Resident):DecisionContext{
  const contact=w.migration!.contacts.find(c=>c.id===person.id&&c.phase==='offered');
  if(!contact)throw new Error('outside_opportunity_expired');
  const returning=!contact.person;
  const choices:FormalOpportunity[]=[
    {id:'stay.outside',label:contact.journey?.blocked?'原路返回居地，结束这一次旅程':'留在原居地，婉拒本次来访',action:{type:'stayOutside'}},
    {id:'travel.valley',label:contact.journey?.blocked?'留在路口等待下次查路，再试着入谷':`从${contact.origin}沿西南林道${returning?'重访':'访问'}山谷，抵达后自己决定去留`,action:{type:'travelToValley'}},
  ];
  const relative=travelCompanion(w,contact);if(relative)choices.push({id:'travel.family.'+relative.id,label:`我愿意与亲属${relative.name}一同沿原路线探访，双方独立同意才会启程；各自抵达后自己选择住宿和去留`,action:{type:'travelWithFamily',partnerId:relative.id}});
  const notice=`你现在 ${Math.floor(ageYears(person.bornAt,w.minute))} 岁。`+(contact.journey?.blocked
    ?'你在谷口遇到路阻，眼前暂时不能通行。'
    :`你在${contact.origin}读到本次驿路公示。西南林道通往${w.map.name}，路程约${stationDuration(w,contact.origin)}分钟。可自行探访，在当地打听住处和工作；公示没有承诺床位、收入或居民同意。`);
  return {
    actor:{id:person.id,name:person.name,traits:person.traits,hunger:person.hunger,energy:person.energy,health:person.health,inventory:{...person.inventory},skills:{...person.skills},intention:person.intention,at:{...person.at},homeId:person.homeId,lastFailure:person.lastFailure},
    outside:{origin:contact.origin,notice,choices},minute:w.minute,season:calendar(w.minute).season,weather:w.weather,bounds:{width:w.map.width,height:w.map.height},
    buildings:[],resources:[],people:[],plots:[],offers:[],proposals:[],knownLand:[],memories:person.memories.slice(-3),
  };
}

export function applyOutsideDecision(w:World,id:string,revision:number,decision:ModelDecision):{ok:boolean;error?:string}{
  const c=w.migration?.contacts.find(contact=>contact.id===id&&contact.phase==='offered');
  const person=c&&availableTraveller(w,c);
  const action=decision.actions[0];
  if(!c||!person||person.revision!==revision)
    return {ok:false,error:'外部人物或驿路机会已经变化'};
  if(decision.actions.length!==1||!(action?.type==='travelToValley'||action?.type==='stayOutside'||action?.type==='travelWithFamily'))return {ok:false,error:'请选择本人当前可以决定的驿路事项'};
  const relative=travelCompanion(w,c);if(action.type==='travelWithFamily'&&relative?.id!==action.partnerId)return {ok:false,error:'亲属或本次具体同行机会已变化'};
  c.lastChoice=action.type==='stayOutside'?'stay':'travel';c.lastDecisionAt=w.minute;
  person.intention=decision.intention.slice(0,160);person.lastDecisionAt=w.minute;person.revision++;
  if(action.type==='travelWithFamily'){const other=personFor(w,relative!)!;if((relative!.familyConsentUntil??0)>w.minute){const arrival=w.minute+stationDuration(w,c.origin);for(const member of [c,relative!]){member.phase='travelling';delete member.familyConsentUntil;member.journey={leftAt:w.minute,arriveAt:arrival,nextCheckAt:arrival,blocked:false};}other.revision++;}else{c.familyConsentUntil=w.minute+120;person.decisionDue=w.minute+30;}w.revision++;return {ok:true};}
  delete c.familyConsentUntil;if(relative?.familyConsentUntil){delete relative.familyConsentUntil;const other=personFor(w,relative);if(other){other.decisionDue=w.minute;other.revision++;}}
  if(action.type==='stayOutside'){
    c.phase='home';c.futureAt=w.minute+reconsiderAfter;c.journey=null;
  }else{
    c.phase='travelling';
    const arrival=w.minute+stationDuration(w,c.origin);
    c.journey=c.journey?{...c.journey,nextCheckAt:w.minute+30,blocked:false}:{leftAt:w.minute,arriveAt:arrival,nextCheckAt:arrival,blocked:false};
  }
  w.revision++;
  return {ok:true};
}

function publicInn(w:World):Building|undefined{
  let nearest:Building|undefined;
  for(const b of w.buildings)if(b.kind==='lodge'&&b.ownerId==='commons'&&(!nearest||distance(b.door,w.map.entrance)<distance(nearest.door,w.map.entrance)))nearest=b;
  return nearest;
}
function passableEntry(w:World,inn:Building|undefined):boolean{
  const gate=w.map.entrance;
  if(!walkable(w,gate))return false;
  if(inn)return findPath(w,gate,inn.door)!==null;
  return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>walkable(w,{x:gate.x+dx,y:gate.y+dy}));
}

function tryEntry(w:World,c:RoadContact){
  const person=personFor(w,c);
  if(!person||person.status!=='alive'||person.residency!=='outside'){c.phase=person?.residency==='outside'?'home':'inTown';c.journey=null;return;}
  const inn=publicInn(w);
  if(!passableEntry(w,inn)){
    c.journey!.blocked=true;c.phase='offered';c.offeredAt=w.minute;person.revision++;
    return;
  }
  const firstVisit=Boolean(c.person);
  person.at={...w.map.entrance};person.inside=null;person.homeId=null;person.residency='visitor';
  person.decisionDue=w.minute;person.plan=null;person.activity=null;person.lastFailure=null;person.revision++;
  if(inn&&!person.knownBuildings.includes(inn.id))person.knownBuildings.push(inn.id);
  if(firstVisit)w.residents.push(person);
  delete c.person;c.phase='inTown';c.journey=null;
  emitEvent(w,{kind:'arrival',populationChange:'visit',actors:[person.id],place:{...person.at},
    text:`${person.name}从${c.origin}沿西南林道${firstVisit?'来到':'重返'}溪岚谷，目前是访客。${inn?'谷口路牌标有'+inn.name+'的地址。':''}`});
}

/** Publication creates a chance to learn about the road. Only an accepted individual decision starts travel. */
export function advanceMigration(w:World):void{
  if(w.mode!=='formal'||w.clock.paused)return;
  initializeMigration(w);
  const state=w.migration!;
  const before=state.lastLifeAt??w.minute;
  if(Math.floor(before/DAY)!==Math.floor(w.minute/DAY)){
    for(const c of state.contacts){
      const p=c.person;
      if(p?.status==='alive'&&ageMortalityDue(w.seed,p,before,w.minute,physiology(w,p))){
        p.status='dead';p.deathAt=w.minute;p.deathCause='oldAge';p.canDecide=false;p.canExpress=false;p.revision++;
        c.phase='home';c.journey=null;
      }
    }
  }
  state.lastLifeAt=w.minute;
  for(const c of state.contacts){
    if(c.phase==='travelling'&&c.journey&&c.journey.nextCheckAt<=w.minute)tryEntry(w,c);
    if(c.phase!=='offered')continue;
    const p=personFor(w,c);
    if(p?.status==='alive'&&p.residency==='outside')continue;
    c.phase=p&&p.residency!=='outside'?'inTown':'home';
    c.offeredAt=null;c.journey=null;delete c.familyConsentUntil;
  }
  if(w.minute<state.nextPostAt)return;
  state.nextPostAt=w.minute+postInterval(w);
  const season=Math.floor(w.minute/seasonLength);
  // One new regional acquaintance at each seasonal fair, independent of beds, deaths and the town census.
  if(season>state.lastSeason){
    if(season%2===0){state.contacts.push(...createRegionalFamily(w,state.nextSerial));state.nextSerial+=2;}else state.contacts.push(createContact(w,state.nextSerial++));
    state.lastSeason=season;
  }
  // A temporary incapacity can suspend a traveller's own decision without blocking the post.
  if(state.contacts.some(c=>c.phase==='offered'&&availableTraveller(w,c)))return;
  const eligible=state.contacts.filter(c=>c.phase==='home'&&c.futureAt<=w.minute&&availableTraveller(w,c))
    .sort((a,b)=>a.futureAt-b.futureAt||a.id.localeCompare(b.id));
  if(eligible[0]){const first=eligible[0];for(const c of first.familyId?eligible.filter(c=>c.familyId===first.familyId):[first]){c.phase='offered';c.offeredAt=w.minute;const p=personFor(w,c);if(p)p.decisionDue=w.minute;}}
}

export function settlementDirections(w:World,person:Resident):FormalOpportunity[]{
  if(person.residency!=='visitor'||person.status!=='alive'||!person.canDecide||!person.canExpress)return [];
  const lodging=w.buildings.filter(b=>b.kind==='lodge'&&b.ownerId==='commons'&&person.knownBuildings.includes(b.id))
    .sort((a,b)=>distance(a.door,person.at)-distance(b.door,person.at))[0];
  if(!lodging)return [];
  if(distance(lodging.door,person.at)>8)return [{id:'visit.inn',label:`沿已知路线去${lodging.name}了解住宿，到场再看是否有床`,action:{type:'move',to:{...lodging.door}}}];
  if(!person.homeId && lodging.residents.length<lodging.capacity)return [{id:'visit.lodge',label:`在${lodging.name}借用一张空床短住，保留访客身份`,action:{type:'lodge',buildingId:lodging.id}}];
  return [];
}
