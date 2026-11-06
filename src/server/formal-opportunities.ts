import {deathProof} from '../world/knowledge.js';
import type {Action, FormalOpportunity, Proposal, Resident, World} from '../shared/types.js';
import {distance,findPath} from '../world/navigation.js';
import {careAuthority,eligiblePair} from '../world/social.js';
import {visibleStreetDirectory} from '../world/street-directory.js';
import {ageYears} from '../world/time.js';
import {canDepart, settlementDirections} from '../world/migration.js';
import {homeMoveAllowed} from '../world/family.js';

const labels:Record<Proposal['kind'],string> = {dating:'交往',marriage:'结婚',child:'共同育儿',care:'这一次照护'};
const open = (world:World,p:Proposal) => p.status==='open' && p.expiresAt>world.minute;

function canAgree(world:World,from:Resident,to:Resident,kind:Proposal['kind']) {
  if(kind==='care') return !to.refusesCare && to.canExpress && to.canDecide;
  if(eligiblePair(world,from,to)!==null) return false;
  const pair=from.relations.find(r=>r.targetId===to.id)?.partner;
  if(kind==='child') {
    const home=world.buildings.find(b=>b.id===from.homeId);
    return from.health>=65 && to.health>=65 && !from.pregnancy && !to.pregnancy && !!home && home.residents.length<home.capacity;
  }
  const reciprocal=to.relations.find(r=>r.targetId===from.id)?.partner;
  const alreadyAttached=[from,to].some((person,i)=>person.relations.some(r=>r.partner&&r.targetId!==[to,from][i].id));
  if(alreadyAttached) return false;
  return kind==='marriage' ? pair==='dating'&&reciprocal==='dating' : !pair&&!reciprocal;
}

/** Only facts already known to the actor, or locally visible, may identify a possible interaction. */
export function formalOpportunities(world:World,actor:Resident,seen:Resident[]):FormalOpportunity[] {
  if(world.mode!=='formal'||actor.status!=='alive'||actor.residency==='outside'||!actor.canExpress||!actor.canDecide)return [];
  const adults=ageYears(actor.bornAt,world.minute)>=18;
  const contacts=seen.filter(p=>!actor.inside&&!p.inside&&actor.knownPeople.includes(p.id)&&distance(actor.at,p.at)<=2);
  const present=contacts.filter(p=>p.status==='alive');
  const topics:FormalOpportunity[][]=[];
  const category=()=>{const entries:FormalOpportunity[]=[];topics.push(entries);return entries;};
  const add=(g:FormalOpportunity[],id:string,label:string,action:Action)=>g.push({id,label,action});

  // A reply always includes refusal. A person can also withdraw their own pending offer.
  const replies=category();
  for(const p of world.proposals.filter(p=>open(world,p)&&(p.actorId===actor.id||p.targetId===actor.id))){
    if(p.actorId===actor.id) {
      add(replies,`withdraw.${p.id}`,`撤回我对${world.residents.find(r=>r.id===p.targetId)?.name}的${labels[p.kind]}提议`,{type:'respond',proposalId:p.id,accept:false});
      continue;
    }
    const from=present.find(r=>r.id===p.actorId&&r.canDecide&&r.canExpress);
    if(!from)continue;
    add(replies,`decline.${p.id}`,`当面拒绝${from.name}提出的${labels[p.kind]}`,{type:'respond',proposalId:p.id,accept:false});
    if(canAgree(world,from,actor,p.kind))add(replies,`agree.${p.id}`,`当面同意${from.name}提出的${labels[p.kind]}`,{type:'respond',proposalId:p.id,accept:true});
  }
  const care=category(),romance=category(),parenthood=category(),burials=category();
  const propose=(g:FormalOpportunity[],kind:Proposal['kind'],other:Resident,label:string)=>{
    if(!world.proposals.some(p=>open(world,p)&&p.kind===kind&&p.actorId===actor.id&&p.targetId===other.id))
      add(g,`propose.${kind}.${other.id}`,label,{type:'propose',proposal:kind,targetId:other.id});
  };
  const helper=actor.skills.care>=1 && (actor.inventory.meal??0)>=1 && (actor.inventory.water??0)>=1;
  for(const other of present){
    if(helper&&(other.health<95||other.hunger>25)&&!other.refusesCare){
      if(careAuthority(world,actor,other).allowed)add(care,`care.${other.id}`,`用自己的一份饭和水照料${other.name}`,{type:'care',targetId:other.id});
      else if(canAgree(world,actor,other,'care'))propose(care,'care',other,`询问${other.name}是否愿意接受我的一次照护`);
    }
    if(!adults)continue;
    const partner=actor.relations.find(r=>r.targetId===other.id)?.partner;
    if(canAgree(world,actor,other,'dating'))propose(romance,'dating',other,`向${other.name}提议交往，等待对方决定`);
    if(canAgree(world,actor,other,'marriage'))propose(romance,'marriage',other,`向${other.name}提议结婚，等待对方决定`);
    if(partner&&canAgree(world,actor,other,'child'))propose(parenthood,'child',other,`向${other.name}提议由自己孕育孩子、共同照料，等待对方决定`);
  }
  for(const relation of actor.relations.filter(r=>r.partner)){
    const other=world.residents.find(p=>p.id===relation.targetId);
    if(adults&&other&&other.status==='alive')add(romance,`separate.${other.id}`,`结束自己与${other.name}的伴侣关系`,{type:'separate',targetId:other.id});
  }
  if(adults)for(const dead of contacts.filter(p=>p.status==='dead')){
    if(world.graves.some(g=>g.personId===dead.id))continue;
    const witnessed=!!deathProof(world,actor,dead.id);
    if(witnessed&&world.graves.some(g=>!g.personId&&findPath(world,dead.at,g.at,true)!==null))
      add(burials,`bury.${dead.id}`,`护送${dead.name}的遗体前往空墓位并安葬`,{type:'bury',targetId:dead.id});
  }
  const localDirections=category();
  const directory=visibleStreetDirectory(world,actor);
  const water=world.resources.filter(r=>r.kind==='spring'&&(actor.knownResources.includes(r.id)||directory?.water.id===r.id))
    .sort((a,b)=>distance(actor.at,a.at)-distance(actor.at,b.at))[0];
  if(water&&(actor.inside||distance(actor.at,water.at)>7)){
    add(localDirections,'move.known-spring',`走到已知的取水点（${water.at.x},${water.at.y}）看看`,{type:'move',to:{...water.at}});
  }
  if(directory&&!actor.knownBuildings.includes(directory.hall.id)){
    add(localDirections,'move.street-hall',`沿门前街牌指引去${directory.hall.name}（${directory.hall.door.x},${directory.hall.door.y}）`,{type:'move',to:{...directory.hall.door}});
  }
  const housing=category();
  housing.push(...settlementDirections(world,actor));
  if(adults){
    const knownHousing=world.buildings.filter(b=>actor.knownBuildings.includes(b.id)&&(b.id!==actor.homeId||actor.residency==='visitor')&&(b.kind==='lodge'||b.kind==='home')&&(b.ownerId==='commons'||b.ownerId===actor.id));
    for(const b of knownHousing.filter(b=>(b.residents.includes(actor.id)||b.residents.length<b.capacity)&&homeMoveAllowed(world,actor,b.id)&&distance(actor.at,b.door)<=10)){
      add(housing,`settle.${b.id}`,`到${b.name}的空床登记居住`,{type:'settle',buildingId:b.id});
    }
    if(!canDepart(world,actor))add(housing,'leave.valley','走到谷口，自愿迁出山谷并保留财产和亲缘',{type:'leave'});
  }
  // Keep each kind visible, including paired answers. Basic food and rest have a separate allowance.
  const choices:FormalOpportunity[]=[];
  for(let round=0;choices.length<16;round++){
    const column=topics.flatMap(group=>group[round]?[group[round]]:[]);
    if(!column.length)break;
    choices.push(...column.slice(0,16-choices.length));
  }
  return choices;
}
