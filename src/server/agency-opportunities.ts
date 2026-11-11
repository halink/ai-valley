import {restoreHarvestMeal} from './harvest-food-choices.js';
import {knownLandChoice,restoreKnownLandChoice,sameKnownLandChoice} from './known-land-choices.js';
import {isFoodSourceSharingChoice} from './food-source-clues.js';
import {plantCropChoice,restorePlantCropChoice} from './plant-crop-choices.js';
import {isWaterSourceChoice,MAX_WATER_SOURCE_CHOICES} from './water-source-opportunities.js';
import {cookingChoices,MAX_DIRECT_EAT_CHOICES} from './direct-food-choices.js';
import {directWaterChoice} from './direct-water-choices.js';
import {isHouseholdFoodOption} from '../world/household.js';
import type {DecisionContext,FormalOpportunity,Resident,World} from '../shared/types.js';import type {AgencyAction,Focus} from '../shared/agency.js';import {focusNames} from '../shared/agency.js';import {agencyReason} from '../world/agency.js';import {itemKeys,itemLabels,goods} from '../shared/items.js';import type {ActionChoice} from './affordances.js';
export function agencyOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const result:FormalOpportunity[]=[],add=(id:string,label:string,a:AgencyAction)=>{if(!agencyReason(w,r,a))result.push({id:'agency.'+id,label,action:a});};
 for(const focus of Object.keys(focusNames) as Focus[])add('reflect.'+focus,`写本人目标并关注${focusNames[focus]}；填text，可随时改变`,{type:'agency',operation:'reflect',focus,text:'本人准备考虑新的目标'});
 add('conclude','回顾并结束自己的当前目标，填写text（1–240字）表达自己的理解，不会自动完成任何工程或关系',{type:'agency',operation:'conclude',text:'我对过去的目标有了自己的看法'});
 for(const a of [...itemKeys.filter(i=>goods[i].food>0).map(item=>({type:'eat' as const,item})),...[120,360].map(minutes=>({type:'sleep' as const,minutes}))])add('arm.'+(a.type==='eat'?a.item:a.minutes),`本人预先决定${a.type==='eat'?'饥饿达到指定值时吃1份自有'+itemLabels[a.item]:'体力低于指定值时回自己的床睡'+a.minutes+'分钟'}；填写threshold 1–95、days 1–7、uses 1–14、cooldown 60–1440。仅空闲且不占用已接受的工作、学习、照护或活动窗口时按本人条件行动，失败停止，不替换资源或住处`,{type:'agency',operation:'arm',routineAction:a,threshold:50,days:1,uses:1,cooldown:120});
 for(const p of r.agency?.routines??[])add('disarm.'+p.id,'撤销本人先前接受的'+(p.action.type==='eat'?'进食':'睡眠')+'后续分支，保留已经实际发生的行为',{type:'agency',operation:'disarm',routineId:p.id});
 return result;
}
function domain(c:ActionChoice):Focus {
 const a=c.action;
 if(c.id.startsWith('foodSource.'))return 'farming';
 if(a.type==='personalFoodGift')return 'social';
 if(a.type==='commons'||a.type==='waterSupply')return 'daily';
 if(a.type==='outsideAid'||a.type==='emergencyCare')return 'care';
 if(['eat','sleep','wait','cook'].includes(a.type))return 'daily';
 if(['plant','water','harvest','gather','production'].includes(a.type))return 'farming';
 if(a.type==='design')return a.operation==='draw'&&a.kind==='building'?'construction':'industry';
 if(a.type==='industry')return 'industry';if(['businessRelocation','premises','debt','foreignTrade','economy','employment','offer','accept'].includes(a.type))return 'trade';
 if(a.type==='landRights'||a.type==='construction'||a.type==='buildingMigration'||a.type==='build')return 'construction';if(a.type==='civic'||a.type==='publicDuty')return 'community';
 if(['adultPresence','longCare','health','care'].includes(a.type))return 'care';if(a.type==='education'||a.type==='learn')return 'learning';
 if(a.type==='bury'||a.type==='funerary'||a.type==='lastWish')return 'funerary';if(a.type==='culture'||a.type==='social'||a.type==='talk')return 'social';
 if(a.type==='regionSurvey')return 'exploration';
 if(a.type==='ferry')return a.operation==='build'||a.operation==='repair'?'construction':'exploration';if(['move','leave','travelToValley','stayOutside'].includes(a.type))return 'exploration';return 'family';
}
function expiringOpportunity(c:ActionChoice){const a=c.action;return c.id.startsWith('frontier.livestock.')||a.type==='frontierHazard'&&a.operation!=='repair'||a.type==='publicDuty'&&['receive','reschedule','attend','stay','resign'].includes(a.operation)||a.type==='health'&&['treat','receive','cancelRescue'].includes(a.operation)||a.type==='education'&&['teach','study'].includes(a.operation)||a.type==='employment'&&a.operation==='work'||a.type==='longCare'&&a.operation==='visit'||a.type==='ferry'&&['board','depart','disembark'].includes(a.operation);}
function control(c:ActionChoice){const a=c.action;if(['respond','homeReply','familyConsent','separate','accept'].includes(a.type))return true;
 return 'operation' in a&&['revokeAssist','acceptVessel','declineVessel','cancelVessel','review','custodyAccept','custodyReview','custodyObject','custodyEnd','respond','approveGift','acceptGift','declineGift','cancelGift','consent','accept','assent','decline','cancel','withdraw','withdrawSponsor','cancelRescue','declineRescue','acceptRescue','receiveHandoff','approveHandoff','declineHandoff','acceptSupport','declineSupport','reject','cancelOffer','cancelShipment','resign','disarm'].includes(a.operation);
}
function foodAcquisition(context:DecisionContext,c:ActionChoice){
 const a=c.action;
 if(a.type==='move'&&c.id.startsWith('foodSource.inspect.'))return true;
 if(a.type==='commons'&&['takeFood','inspectFood'].includes(a.operation))return true;
 if(a.type==='outsideAid'&&a.operation==='collect')return true;
 if(a.type==='production'&&a.operation==='emergencyEstateRation')return true;
 if(a.type==='economy')return ['retrieve','buy'].includes(a.operation)&&!!a.item&&goods[a.item].food>0;
 if(a.type==='gather')return context.resources.some(r=>r.id===a.resourceId&&r.kind==='bush');
 return a.type==='cook'||a.type==='publicDuty'&&a.operation==='receive';
}
function waterCare(c:ActionChoice){return c.action.type==='waterSupply'&&['authorizeAssist','assistDrink','serveChild'].includes(c.action.operation);}
/** Retaining a supply presentation must not purchase its slot with an
 * already selected safety action, refusal, withdrawal or consent pair. */
function mayYieldToWater(context:DecisionContext,c:ActionChoice,priority:ReadonlySet<ActionChoice>){
 const a=c.action;
 if(priority.has(c)||control(c)||foodAcquisition(context,c)||waterCare(c))return false;
 if('operation'in a&&(/^(stop|cancel|decline|refuse|reject|withdraw|revoke|disarm|object)/.test(a.operation)||a.operation==='vote'))return false;
 if(['sleep','wait','eat','health','longCare','emergencyCare','care','tendChild','adultPresence','frontierHazard','ferry','outsideAid','publicDuty','production','culture','household','familyRelocation','lastWish'].includes(a.type))return false;
 if(a.type==='industry'&&['shoreRest','harvestFruit','harvestHouse','collectAnimal','fish','feedAnimal','waterAnimal'].includes(a.operation)||a.type==='foreignTrade'&&a.operation==='collect'||a.type==='economy'&&['retrieve','buy','close'].includes(a.operation))return false;
 // One personal goal entry remains even if it is the only ordinary candidate.
 return a.type!=='agency'||a.operation==='arm';
}
/** Bounded overview and optional self-selected focus. Rotation changes visibility, never the resident's action. */
export function focusedChoices(context:DecisionContext,all:ActionChoice[]):ActionChoice[]{
 if(!context.formal||context.formal.passenger||context.formal.aboard)return all;
 const planting=plantCropChoice(context,all);
 // Recover only the address choice surviving buildChoices' age and journey
 // gates. Remove it from the agenda so that rotation cannot crop it again.
 const address=knownLandChoice(context),field=address?all.find(choice=>sameKnownLandChoice(choice,address)):undefined;
 if(field)all=all.filter(choice=>!sameKnownLandChoice(choice,field));
 // A kitchen must not disappear behind a saturated agenda, or suffer a
 // second same-clock rotation. Its one selected slot is restored last.
 all=all.filter(c=>!isFoodSourceSharingChoice(c)&&c.action.type!=='socialAppointment');
 // New public import templates cannot reshuffle existing duty/survival domains.
 const publicImports=all.filter(c=>c.action.type==='civic'&&c.action.operation==='propose'&&c.action.measure.kind==='foodReserve'&&c.action.measure.foreignProcurement);
 all=all.filter(c=>!publicImports.includes(c));
 const cooking=cookingChoices(context,all);all=all.filter(c=>c.action.type!=='cook');
 // Complete the original agenda and supply rotation before retaining a
 // self-drink, so its new visibility cannot suppress an existing care choice.
 // Household food slots are already fairly rotated by complete candidate identity.
 // New supply templates bypass the second domain rotation, which could alias
 // the item rotation. Withdrawals retain their existing control priority even
 // when a completely full menu has no replaceable reflection slot.
 const waterSources=all.filter(isWaterSourceChoice).slice(0,MAX_WATER_SOURCE_CHOICES);
 all=all.filter(c=>!isWaterSourceChoice(c));
 const householdFood=all.filter(isHouseholdFoodOption);all=all.filter(c=>!isHouseholdFoodOption(c)||c.action.type==='household'&&c.action.operation==='withdraw');
 const gifts=all.filter(c=>c.action.type==='personalFoodGift');all=all.filter(c=>c.action.type!=='personalFoodGift');
 const water=all.filter(c=>c.action.type==='waterSupply'&&!control(c));all=all.filter(c=>c.action.type!=='waterSupply'||control(c));
 const directWater=directWaterChoice(context,water);
 const focus=context.actor.agency?.focus,result:ActionChoice[]=[],seen=new Set<ActionChoice>(),limit=56;
 const add=(c:ActionChoice)=>{if(result.length<limit&&!seen.has(c)){result.push(c);seen.add(c);}};
 const group=(choices:ActionChoice[])=>{const groups=new Map<Focus,ActionChoice[]>();for(const c of choices){const d=domain(c),values=groups.get(d)??[];values.push(c);groups.set(d,values);}return [...groups.values()];};
 const rotate=(choices:ActionChoice[],n:number,minutes=30)=>{const offset=Math.floor(context.minute/minutes)%Math.max(1,choices.length);for(let i=0;i<Math.min(n,choices.length);i++)add(choices[(offset+i)%choices.length]);};
 const round=(groups:ActionChoice[][],budget:number)=>{let used=0;for(let i=0;used<budget;i++){let found=false;for(const items of groups){if(i>=items.length)continue;found=true;const before=result.length;const offset=Math.floor(context.minute/30)%items.length;add(items[(offset+i)%items.length]);used+=result.length-before;if(used>=budget||result.length===limit)return;}if(!found)return;}};
 // Reserve bounded self-care choices before any potentially large list of
 // appointments. These remain choices, not an automatically selected rescue.
 all.filter(c=>['sleep','wait'].includes(c.action.type)).slice(0,2).forEach(add);
 // A legal borrowed bed can be the only reachable bed even while the actor
 // still holds a registered home. Preserve that distinct choice under load.
 rotate(all.filter(c=>c.action.type==='sleep'&&!!c.action.buildingId),1);
 rotate(all.filter(c=>c.action.type==='industry'&&c.action.operation==='shoreRest'),1);
 // The complete own-food vocabulary was already fairly rotated before the
 // basic 32-row cap. Retain every selected eat row without a second crop.
 all.filter(c=>c.action.type==='eat').slice(0,MAX_DIRECT_EAT_CHOICES).forEach(add);
 rotate(all.filter(c=>c.action.type==='commons'&&c.action.operation==='borrowBed'),1);
 all.filter(c=>c.id.startsWith('visit.')).slice(0,3).forEach(add);
 // Preserve at most two current guardian evacuation choices under a crowded
 // agenda. A retained option never submits a plan or selects it for the actor.
 const evacuation=all.filter(c=>c.action.type==='health'&&c.action.operation==='rescue'&&!!c.action.evacuationDangerId);
 rotate(evacuation,2);all=all.filter(c=>!evacuation.includes(c)||seen.has(c));
 // A validated minor's emergency ration already means no available personal
 // food or known commons food; do not wait for severe hunger to expose it.
 if(context.actor.hunger>=80||context.formal.foodCoverage?.lowFood||all.some(c=>c.action.type==='production'&&c.action.operation==='emergencyEstateRation')){
  const foodGroups=new Map<string,ActionChoice[]>();
  for(const c of all.filter(c=>foodAcquisition(context,c))){const a=c.action,key=a.type+('operation' in a?'.'+a.operation:'');const values=foodGroups.get(key)??[];values.push(c);foodGroups.set(key,values);}
  round([...foodGroups.values()],8);
 }
 // One most-urgent individual and one rotating alternative per care operation
 // keep late arrivals selectable without letting a large herd fill the prompt.
 for(const op of ['feedAnimal','waterAnimal']){
  const care=all.filter(c=>c.action.type==='industry'&&c.action.operation===op);
  if(care[0])add(care[0]);rotate(care.slice(1),1);
 }
 // One local verification and one already verified stay remain choices under load.
 for(const op of ['verify','stay'])rotate(all.filter(c=>c.action.type==='adultPresence'&&c.action.operation===op),1);
 // Finite child-care choices must remain reachable beside a large ordinary agenda.
 for(const op of ['rescueMeal','feed','offer','review','requestHelp','postHelp','sendHelp','readHelp','visitHelp','withdrawHelp'])rotate(all.filter(c=>c.action.type==='emergencyCare'&&c.action.operation===op),1);
 // A new care category must not crowd out the existing independent estate-preservation offer.
 const custody=all.filter(c=>c.action.type==='production'&&c.action.operation==='custodyOffer');
 if(custody[0])add(custody[0]);rotate(custody.slice(1),1);
 // Keep one complete personal transport response together, including birthday
 // re-consent. More offers rotate; silence never counts as acceptance.
 const rescueReplies=all.filter(c=>c.action.type==='health'&&c.action.operation==='acceptRescue');
 const rescueReply=rescueReplies[Math.floor(context.minute/30)%Math.max(1,rescueReplies.length)];
 if(rescueReply?.action.type==='health'){const offerId=rescueReply.action.offerId;all.filter(c=>c.action.type==='health'&&c.action.offerId===offerId&&['acceptRescue','declineRescue','cancelRescue'].includes(c.action.operation)).forEach(add);}
 // A separately consented care handoff must retain both the yes and no choices.
 const handoff=all.find(c=>c.action.type==='longCare'&&c.action.operation==='approveHandoff');
 if(handoff?.action.type==='longCare'){const id=handoff.action.replacementId;all.filter(c=>c.action.type==='longCare'&&c.action.replacementId===id&&['approveHandoff','declineHandoff'].includes(c.action.operation)).forEach(add);}
 else rotate(all.filter(c=>c.action.type==='longCare'&&c.action.operation==='declineHandoff'),1);
 // Preserve the exact selected survival and urgent-care groups. Drinking is
 // restored only after later control/consent selection, never ahead of it.
 const waterPriority=new Set(result);
 // Keep one bounded last-wish workflow and its separate refusal alongside ordinary choices.
 rotate(all.filter(c=>c.action.type==='lastWish'&&c.action.operation==='declare'),1);
 rotate(all.filter(c=>c.action.type==='lastWish'&&['read','revoke'].includes(c.action.operation)),1);
 for(const pair of [['witness','declineWitness'],['approveGift','refuseGift'],['acceptGift','declineGift']]){const offers=all.filter(c=>c.action.type==='lastWish'&&pair.includes(c.action.operation)),selected=offers[Math.floor(context.minute/30)%Math.max(1,offers.length)];if(selected?.action.type==='lastWish'){const wishId=selected.action.wishId;offers.filter(c=>c.action.type==='lastWish'&&c.action.wishId===wishId).forEach(add);}}
 const burials=all.filter(c=>c.action.type==='bury'&&!!c.action.wishId),burial=burials[Math.floor(context.minute/30)%Math.max(1,burials.length)];if(burial?.action.type==='bury'){const targetId=burial.action.targetId;all.filter(c=>c.action.type==='bury'&&c.action.targetId===targetId&&c.id.startsWith('lastWish.')).forEach(add);}
 // Land replies stay paired and objections remain available beside consent.
 const landVotes=all.filter(c=>c.action.type==='landRights'&&c.action.operation==='vote');
 const landVote=landVotes[Math.floor(context.minute/30)%Math.max(1,landVotes.length)];
 if(landVote?.action.type==='landRights'){const applicationId=landVote.action.applicationId;landVotes.filter(c=>c.action.type==='landRights'&&c.action.applicationId===applicationId).forEach(add);}
 for(const operation of ['object','read','post','register','survey'])rotate(all.filter(c=>c.action.type==='landRights'&&c.action.operation===operation),1);
 const regionVotes=all.filter(c=>c.action.type==='regionSurvey'&&c.action.operation==='vote');
 const regionVote=regionVotes[Math.floor(context.minute/30)%Math.max(1,regionVotes.length)];
 if(regionVote?.action.type==='regionSurvey'&&'surveyId'in regionVote.action){const id=regionVote.action.surveyId;regionVotes.filter(c=>c.action.type==='regionSurvey'&&'surveyId'in c.action&&c.action.surveyId===id).forEach(add);}
 for(const operation of ['object','read','post','open','survey'])rotate(all.filter(c=>c.action.type==='regionSurvey'&&c.action.operation===operation),1);
 rotate(all.filter(c=>c.id.startsWith('regionSurvey.board.')||c.id.startsWith('regionSurvey.return.')),2);
 rotate(all.filter(c=>c.action.type==='economy'&&c.action.operation==='open'),2);
 rotate(all.filter(c=>c.id.startsWith('businessRelocation.')),3);
 for(const operation of ['offer','accept','decline','surrender','collect'])rotate(all.filter(c=>c.action.type==='premises'&&c.action.operation===operation),1);
 // A crowd of expiring commitments must not consume the slots reserved above.
 round(group(all.filter(c=>expiringOpportunity(c)&&!seen.has(c))),8);
 const controls=all.filter(c=>control(c)&&!seen.has(c));if(controls.length<=24)controls.forEach(add);else round(group(controls),24);
 // Keep a way to revise the resident's own focus even under a full agenda.
 rotate(all.filter(c=>c.action.type==='agency'&&['reflect','conclude'].includes(c.action.operation)&&!seen.has(c)),1);
 if(context.formal.frontier)for(const op of ['hunt','fish','tameAnimal','shoreRest','collectAnimal']){
  all.filter(c=>c.action.type==='industry'&&c.action.operation===op).slice(0,2).forEach(add);
 }
 if(context.formal.frontier){
  const fieldWork=all.find(c=>c.id==='industry.huntingTrail'||c.id==='industry.equip.spear');
  const cookGame=all.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal');
  if(fieldWork)add(fieldWork);if(cookGame)add(cookGame);
  const spear=all.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='spear');
  if(spear&&!fieldWork&&!context.actor.inventory.spearKit&&!all.some(c=>c.action.type==='industry'&&c.action.operation==='hunt'))add(spear);
  for(const opportunity of all.filter(c=>c.action.type==='production'&&['collectManure','fertilize'].includes(c.action.operation)).slice(0,2))add(opportunity);
  const compost=all.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='compost');
  if(compost)add(compost);
 }
 if(context.formal.frontier){
  const designs=all.filter(c=>c.action.type==='design');
  designs.filter(c=>c.action.type==='design'&&c.action.operation==='draw').forEach(add);
  rotate(designs.filter(c=>c.action.type==='design'&&c.action.operation!=='draw'),3);
  rotate(all.filter(c=>c.action.type==='construction'&&c.action.definition?.startsWith('building/resident-')),2);
 }
 rotate(all.filter(c=>c.action.type==='agency'&&['reflect','conclude','disarm'].includes(c.action.operation)),12);
 if(focus)rotate(all.filter(c=>domain(c)===focus&&!seen.has(c)&&c.action.type!=='agency'),20);
 const ordinary=all.filter(c=>!seen.has(c)&&(!focus||domain(c)!==focus));if(focus){for(const options of group(ordinary))rotate(options,2);}else round(group(ordinary),limit-result.length);
 // Preserve the original two supply selections and rotation, including any
 // already visible assisted/child drinking or personal assistance permission.
 for(let i=0;i<Math.min(2,water.length);i++){const c=water[(Math.floor(context.minute/30)+i)%water.length];if(result.length<limit){result.push(c);continue;}const reflections=result.map((c,index)=>({c,index})).filter(({c})=>c.action.type==='agency'&&c.action.operation==='reflect');if(reflections.length>1)result[reflections.at(-1)!.index]=c;}
 if(directWater&&!result.includes(directWater)){
  const supplied=result.map((c,index)=>({c,index})).filter(({c})=>water.includes(c));
  // At the two-row supply cap, only an ordinary supply choice may give way.
  // If both are care, retain them instead of inventing a third water slot.
  if(supplied.length>=2){const replacement=supplied.filter(({c})=>!waterCare(c)).at(-1);if(replacement)result[replacement.index]=directWater;}
  else if(result.length<limit)result.push(directWater);
  else{
   const reflections=result.map((c,index)=>({c,index})).filter(({c})=>c.action.type==='agency'&&c.action.operation==='reflect');
   const replacement=reflections.length>1?reflections.at(-1)!.index:result.map((c,index)=>({c,index})).filter(({c})=>mayYieldToWater(context,c,waterPriority)).at(-1)?.index??-1;
   if(replacement>=0)result[replacement]=directWater;
  }
 }
 // A fully protected agenda stays closed to an added drink. Neither the
 // 56-row ordinary cap, two supply rows nor an existing safety choice relaxes.
 // Add bounded gift choices without reshuffling existing relationships or trading.
 // Immediate stops are independently restored by decisionChoices.
 for(const op of ['offer','accept','deliver']){const candidates=gifts.filter(c=>c.action.type==='personalFoodGift'&&c.action.operation===op);if(!candidates.length)continue;const c=candidates[Math.floor(context.minute/30)%candidates.length];if(result.length<limit){result.push(c);continue;}const reflections=result.map((c,index)=>({c,index})).filter(({c})=>c.action.type==='agency'&&c.action.operation==='reflect');if(reflections.length>1)result[reflections.at(-1)!.index]=c;}
 // Existing eating, care, refusals, travel and other non-reflection choices keep
 // their positions. Use spare space or surplus goal reflections, never a new cap.
 for(const c of householdFood){if(result.includes(c))continue;if(result.length<limit){result.push(c);continue;}const reflections=result.map((c,index)=>({c,index})).filter(({c})=>c.action.type==='agency'&&c.action.operation==='reflect');if(reflections.length>1)result[reflections.at(-1)!.index]=c;}
 // Source rotation already happened once. Do not rotate again by focus or
 // domain, and never trade away care, refusals, stops, food or rest for water.
 // Usually spare slots/surplus reflections suffice; a completely saturated
 // agenda gets at most two additive source slots (56 + 2, before live stops).
 for(const c of waterSources){
  if(result.length<limit){result.push(c);continue;}
  const reflections=result.map((choice,index)=>({choice,index})).filter(({choice})=>choice.action.type==='agency'&&choice.action.operation==='reflect');
  if(reflections.length>1)result[reflections.at(-1)!.index]=c;else result.push(c);
 }
 // Never pay for cooking visibility by removing a refusal, emergency, water,
 // direct meal, or other non-reflection choice. At complete saturation this
 // adds only one row (56 ordinary + 2 water + 1 cooking, before live stops).
 for(const c of cooking){
  if(result.length<limit){result.push(c);continue;}
  const reflections=result.map((choice,index)=>({choice,index})).filter(({choice})=>choice.action.type==='agency'&&choice.action.operation==='reflect');
  if(reflections.length>1)result[reflections.at(-1)!.index]=c;else result.push(c);
 }
 // Offer a new import template only beside its visible original local template.
 // Spend spare space or surplus reflections, not an existing service/food choice.
 const imports=publicImports.filter(c=>{
  const a=c.action;if(a.type!=='civic'||a.operation!=='propose'||a.measure.kind!=='foodReserve')return false;
  const measure=a.measure;return result.some(x=>{const b=x.action;return b.type==='civic'&&b.operation==='propose'&&b.measure.kind==='foodReserve'&&b.measure.item===measure.item&&b.measure.buildingId===measure.buildingId;});
 });
 // Hold a merchant throughout a complete community rotation. A second t % 3
 // would permanently alias when the local template only appears every 3n ticks.
 const communityCycle=Math.max(1,all.filter(c=>domain(c)==='community').length);
 if(imports.length){const choice=imports[Math.floor(context.minute/(30*communityCycle))%imports.length];if(result.length<limit)result.push(choice);else{const reflections=result.map((c,index)=>({c,index})).filter(({c})=>c.action.type==='agency'&&c.action.operation==='reflect');if(reflections.length>1)result[reflections.at(-1)!.index]=choice;}}
 // Planting is restored after the ordinary overview without replacing any
 // non-reflection choice. Complete saturation adds at most one planting
 // row: 56 ordinary + 2 water + 1 cooking + 1 planting, before live stops.
 // The selected field uses spare space or a surplus reflection. Only a
 // fully saturated menu grows by one; existing non-reflection rows stay put.
 return restoreHarvestMeal(context,all,restoreKnownLandChoice(field,restorePlantCropChoice(planting,result,limit),limit),limit);
}
