import type {Resident,World} from '../shared/types.js';
import {parseChoice,type ActionChoice} from './affordances.js';
import {decisionChoices,decisionContext} from './decisions.js';
import {planStartError,stepWorld,submitPlan} from '../world/engine.js';
import {formalBerryCommonGround} from '../world/formal-berry-location.js';
import {findPath,same} from '../world/navigation.js';
import {acceptNativeFormalBerryLot} from '../world/food.js';
import {familyPassenger,travellingFamily} from '../shared/family-relocation.js';
import {projectDeveloperFormalBerryDiscovery} from './valley-spirit-formal-berry-discovery.js';
import {formalBerryObservationId,formalBerryPickupPlanId,validateFormalGroundBerryFoodBirth,
 type FormalBerryFixtureEffect,type FormalBerryFixturePickup} from './valley-spirit-formal-berry-authority.js';

const MINUTES=24, MAX_RESIDENTS=32, MARKER='private:fixture:pickup:';
const able=(w:World,r:Resident)=>r.canDecide&&r.canExpress&&!travellingFamily(w,r.id)&&!familyPassenger(w,r.id);

/** Closed developer-only offline chooser. No actor, menu reply, destination or
 * authority comes from the host. Normal care/rest/eating takes priority; a
 * full resident may leave a berry on the ground. This is not a live policy. */
export function planDeveloperFormalBerryPickup(w:World,rows:readonly FormalBerryFixtureEffect[]){
 if(w.clock.paused||!rows.some(e=>e.foodBirth&&!e.pickup))return null;
 const residents=w.residents.filter(r=>!r.plan&&!r.activity&&able(w,r)&&r.decisionDue<=w.minute)
  .sort((a,b)=>a.decisionDue-b.decisionDue||a.id.localeCompare(b.id)).slice(0,MAX_RESIDENTS);
 for(const r of residents){
  const seen=projectDeveloperFormalBerryDiscovery(w,rows,r.id);
  if(!seen.length)continue;
  const context=decisionContext(w,r),native=decisionChoices(context);
  if(!context.formal?.foodCoverage?.lowFood||context.formal.careWithdrawalOnly||
   native.some(c=>c.action.type==='eat'||c.action.type==='frontierHazard'&&['retreat','shelter'].includes(c.action.operation))||
   r.energy<70)continue;
  const options=seen.map((o,index):ActionChoice=>({id:MARKER+(index+1),label:'走到眼前的落地浆果并拾起一份',
   action:{type:'move',to:{...o.at}}}));
  const menu=[...native,...options],selection=options[0]; // deterministic local fixture resident choice
  if(menu.filter(c=>c.id===selection.id).length!==1)continue;
  const selected=seen[0],effect=rows.find(e=>formalBerryObservationId(w.id,r.id,e.receipt.draftId)===selected.observationId);
  if(!effect?.foodBirth||effect.pickup)continue;
  const action=parseChoice(JSON.stringify({choice:selection.id}),menu).actions[0];
  if(action.type!=='move'||!same(action.to,effect.receipt.target))continue;
  return {effect,action,residentId:r.id,observationId:selected.observationId,actorRevision:r.revision};
 }
 return null;
}

/** Mutates only the transaction draft, which must be discarded on null.
 * The resident actually uses native plan submission, pathfinding and movement,
 * and finishes the exact chosen move; this module does not assign coordinates. */
export function completeDeveloperFormalBerryPickup(w:World,rows:readonly FormalBerryFixtureEffect[]){
 const choice=planDeveloperFormalBerryPickup(w,rows);
 if(!choice)return null;
 const {effect,action,actorRevision,observationId,residentId}=choice;
 const food=effect.foodBirth!,where=effect.receipt.target,observedRevision=w.revision,observedAt=w.minute;
 const planId=formalBerryPickupPlanId(observationId,observedRevision),r=w.residents.find(p=>p.id===residentId)!;
 const plan={id:planId,actorId:r.id,actorRevision,createdAt:observedAt,definition:w.activeDefinitions['action/routine'],
  intention:r.intention,actions:[action]};
 const route=findPath(w,r.at,where),site=formalBerryCommonGround(w);
 if(!route||route.length>12||route.some(site.unsafe)||planStartError(w,plan)||!submitPlan(w,plan).ok||
  r.plan?.id!==planId)return null;
 for(let i=0;i<MINUTES;i++){
  if(!able(w,r)||w.clock.paused||w.minute+1>=food.expiresAt)return null;
  if(r.activity?.path.some(formalBerryCommonGround(w).unsafe))return null;
  stepWorld(w,1);
  if(r.lastFailure||r.plan&&r.plan.id!==planId||r.activity&&r.activity.planId!==planId)return null;
  if(r.plan||r.activity)continue;
  const didMove=r.recentActions?.at(-1);
  if(didMove?.type!=='move'||didMove.at!==w.minute||!same(r.at,where)||!able(w,r)||
   !formalBerryCommonGround(w).landing(where)||!validateFormalGroundBerryFoodBirth(w,effect)||
   !projectDeveloperFormalBerryDiscovery(w,[effect],residentId).some(o=>o.observationId===observationId))return null;
  const previousInventory=r.inventory.berry??0;
  if(!acceptNativeFormalBerryLot(w,residentId,food))return null;
  const pickup:FormalBerryFixturePickup={version:1,supplyReceiptId:food.supplyReceiptId,residentId,observationId,planId,observedRevision,observedAt,
   pickedAt:w.minute,committedRevision:w.revision};
  return {effect:{...effect,pickup},pickup,previousInventory};
 }
 return null;
}
