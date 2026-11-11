import type {Resident,World} from '../shared/types.js';
import {socialSpace} from './relationships.js';
import {canObserve,deathProof} from './knowledge.js';

export const careChildVisible=(w:World,r:Resident,p:Resident)=>canObserve(w,r)&&socialSpace(w,r,p);

/** Each witness needs evidence of their own; an absent guardian is not presumed dead. */
export function childCareGapEvidence(w:World,r:Resident,p:Resident):string[]|null {
 if(!careChildVisible(w,r,p))return null;
 const facts:string[]=[];
 for(const id of p.guardianIds){
  const guardian=w.residents.find(g=>g.id===id);if(!guardian)return null;
  if(guardian.status==='dead'){
   const proof=deathProof(w,r,id);if(!proof)return null;facts.push(`death:${id}:${proof.id}`);
  }else if(!guardian.canDecide||!guardian.canExpress){
   if(!careChildVisible(w,r,guardian))return null;facts.push(`observed-incapacity:${id}:${w.minute}`);
  }else return null;
 }
 return facts.length?facts:['observed-child-with-no-registered-guardian'];
}
