import {waterSourceOpportunities} from './water-source-opportunities.js';
import {knownLastWish} from '../world/last-wishes.js';
import {socialPresence} from '../world/relationships.js';
import {canApproachSocialTarget} from '../world/social-observation.js';
import {coLocated} from '../world/proximity.js';
import {deathProof} from '../world/knowledge.js';
import type {Action, FormalOpportunity, Proposal, Resident, World} from '../shared/types.js';
import {distance,findPath} from '../world/navigation.js';
import {careAuthority,proposalEligibility} from '../world/social.js';
import {visibleStreetDirectory} from '../world/street-directory.js';
import {ageYears} from '../world/time.js';
import {canDepart, settlementDirections} from '../world/migration.js';
import {homeMoveAllowed} from '../world/family.js';
import {canInspectBuilding} from '../world/building-knowledge.js';

const labels:Record<Proposal['kind'],string> = {dating:'交往',marriage:'结婚',child:'共同育儿',care:'这一次照护'};
const open = (world:World,p:Proposal) => p.status==='open' && p.expiresAt>world.minute;

const canAgree=(world:World,from:Resident,to:Resident,kind:Proposal['kind'])=>proposalEligibility(world,from,to,kind)===null;

/** Only facts already known to the actor, or locally visible, may identify a possible interaction. */
export function formalOpportunities(world:World,actor:Resident,seen:Resident[]):FormalOpportunity[] {
  if(world.mode!=='formal'||actor.status!=='alive'||actor.residency==='outside'||!actor.canExpress||!actor.canDecide)return [];
  const adults=ageYears(actor.bornAt,world.minute)>=18;
  const contacts=seen.filter(p=>actor.knownPeople.includes(p.id)&&coLocated(world,actor,p));
  const present=contacts.filter(p=>p.status==='alive'&&canApproachSocialTarget(world,actor,p));
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
    const from=present.find(r=>r.id===p.actorId&&r.canDecide&&r.canExpress&&socialPresence(world,actor,r));
    if(!from)continue;
    add(replies,`decline.${p.id}`,`当面拒绝${from.name}提出的${labels[p.kind]}`,{type:'respond',proposalId:p.id,accept:false});
    if(canAgree(world,from,actor,p.kind))add(replies,`agree.${p.id}`,`当面同意${from.name}提出的${labels[p.kind]}`,{type:'respond',proposalId:p.id,accept:true});
  }
  const care=category(),romance=category(),parenthood=category(),burials=category();
  const propose=(g:FormalOpportunity[],kind:Proposal['kind'],other:Resident,label:string)=>{
    if(socialPresence(world,actor,other)&&!world.proposals.some(p=>open(world,p)&&p.kind===kind&&p.actorId===actor.id&&p.targetId===other.id))
      add(g,`propose.${kind}.${other.id}`,label,{type:'propose',proposal:kind,targetId:other.id});
  };
  const helper=actor.skills.care>=1 && (actor.inventory.meal??0)>=1 && (actor.inventory.water??0)>=1;
  for(const other of present){
    if(helper&&(other.health<95||other.hunger>25)&&!other.refusesCare){
      const authority=careAuthority(world,actor,other);
      if(authority.allowed)add(care,`care.${other.id}`,`用自己的一份饭和水照料${other.name}`,{type:'care',targetId:other.id,...(authority.basis==='consent'?{proposalId:authority.evidence}:{})});
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
      add(burials,`bury.${dead.id}`,`护送${dead.name}的遗体前往空墓位并安葬${knownLastWish(world,actor,dead.id)?'；这是本人另行选择的普通安葬，不采用已读文书的指定墓位或墓志':''}`,{type:'bury',targetId:dead.id});
  }
  const localDirections=category();
  const directory=visibleStreetDirectory(world,actor);
  if(directory&&!actor.knownBuildings.includes(directory.hall.id)){
    add(localDirections,'move.street-hall',`沿门前街牌指引去${directory.hall.name}（${directory.hall.door.x},${directory.hall.door.y}）`,{type:'move',to:{...directory.hall.door}});
  }
  const housing=category();
  housing.push(...settlementDirections(world,actor));
  if(adults){
    const knownHousing=world.buildings.filter(b=>actor.knownBuildings.includes(b.id)&&(b.id!==actor.homeId||actor.residency==='visitor')&&(b.kind==='lodge'||b.kind==='home')&&(b.ownerId==='commons'||b.ownerId===actor.id));
    for(const b of knownHousing.filter(b=>canInspectBuilding(world,actor,b)&&(b.residents.includes(actor.id)||b.residents.length<b.capacity)&&homeMoveAllowed(world,actor,b.id))){
      add(housing,`settle.${b.id}`,`到${b.name}的空床登记居住`,{type:'settle',buildingId:b.id});
    }
    if(!canDepart(world,actor))add(housing,actor.residency==='visitor'?'visit.return':'leave.valley',`沿归路走到谷口（${world.map.entrance.x},${world.map.entrance.y}），自愿${actor.residency==='visitor'?'结束来访，沿西南林道离开':'迁出山谷'}并保留财产和亲缘`,{type:'leave'});
  }
  // Keep each kind visible, including paired answers. Basic food and rest have a separate allowance.
  const choices:FormalOpportunity[]=[];
  for(let round=0;choices.length<16;round++){
    const column=topics.flatMap(group=>group[round]?[group[round]]:[]);
    if(!column.length)break;
    choices.push(...column.slice(0,16-choices.length));
  }
  // Source candidates have their own bounded allowance and must not undergo
  // another topic rotation, which could permanently alias their source rotation.
  return [...choices,...waterSourceOpportunities(world,actor)];
}
