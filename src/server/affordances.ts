import {knownLandChoice} from './known-land-choices.js';
import {isSocialAppointmentStop} from '../shared/social-appointments.js';
import {socialToneChoices} from './social-tone-choices.js';
import {barterTerms,validBarterTerms} from '../shared/barter.js';
import {isPersonalFoodGiftStop} from '../shared/personal-food-gifts.js';
import {directFoodChoices} from './direct-food-choices.js';
import {isRescueDecision} from '../shared/health.js';
import {isLastWishWithdrawal} from '../shared/last-wishes.js';
import {isPregnancyWithdrawal} from '../shared/pregnancy-preparation.js';
import {isWaterSupportWithdrawal} from '../shared/water-support.js';
import {parseLandRightsChoice} from '../world/land-rights.js';
import {premisesFields,parsePremisesChoice} from './premises-opportunities.js';
import {parseDesignChoice} from './design-opportunities.js';
import {itemLabels} from '../shared/items.js';
import {educationChoiceFields,parseEducationChoice} from './education-opportunities.js';
import type {Action, DecisionContext, Item, ModelDecision, Vec} from '../shared/types.js';
import {ageAllowsChoice} from '../world/family.js';
import {DAY} from '../world/time.js';
import {economyChoiceFields,parseEconomyChoice} from './economy-opportunities.js';
import {civicChoiceFields,parseCivicChoice} from './civic-opportunities.js';
import {employmentChoiceFields,parseEmploymentChoice} from './employment-opportunities.js';
import {foreignChoiceFields,parseForeignChoice} from './foreign-opportunities.js';
import {constructionChoiceFields,parseConstructionChoice} from './construction-opportunities.js';

export interface ActionChoice {id:string;label:string;action:Action;chooseDuration?:boolean;}
const itemNames=itemLabels;
const resourceNames={tree:'木材',rock:'石料',bush:'浆果',spring:'清水'};
const manhattan=(a:Vec,b:Vec)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const count=(c:DecisionContext,item:Item)=>c.actor.inventory[item]??0;
/**
 * Enumerates a compact action vocabulary, not a policy: physiology never ranks the choices.
 * Only supplied observations/known locations are used. Paths and permissions are revalidated
 * by the authoritative engine. Capacity limits are per category, preventing a forest from
 * crowding food, rest, conversation or discovery out of a compact prompt.
 * This phase-two vocabulary is explicitly bound to routine/crop/meal version 1.
 */
export function buildChoices(c:DecisionContext):ActionChoice[]{
 if(c.formal?.careWithdrawalOnly)return [{id:'wait.care-expression',label:'暂不停止这一次照护，15分钟后仍可表达撤回；不授予新的同意或其他行动权限',action:{type:'wait',minutes:15}},...c.formal.opportunities.filter(c=>c.id.startsWith('care.stop.')||c.action.type==='health'&&['cancelRescue','declineRescue'].includes(c.action.operation))];
 if(c.formal?.expressiveEvacuationOnly)return [{id:'wait.ground-expression',label:'暂不表示停止，稍后仍可表达拒绝；不授权任何其他行动',action:{type:'wait',minutes:15}},...c.formal.opportunities.filter(c=>c.action.type==='health'&&['cancelRescue','declineRescue'].includes(c.action.operation))];
 if(c.formal?.familyTravelling)return [{id:'wait.family-travel',label:'继续本人已接受的家庭同行15分钟，保留随时撤回的权利',action:{type:'wait',minutes:15}},...c.formal.opportunities.filter(c=>c.action.type==='familyRelocation'&&c.action.operation==='withdraw'||isWaterSupportWithdrawal(c.action)||isPregnancyWithdrawal(c.action)||isLastWishWithdrawal(c.action)||isSocialAppointmentStop(c.action)||isPersonalFoodGiftStop(c.action))];
 if(c.formal?.passenger)return [{id:'wait.transport',label:'作为乘员暂时等待15分钟，保留随时停止护送的权利',action:{type:'wait',minutes:15}},...c.formal.opportunities.filter(c=>c.action.type==='health'&&c.action.operation==='cancelRescue'||isWaterSupportWithdrawal(c.action)||isPregnancyWithdrawal(c.action)||isLastWishWithdrawal(c.action)||isSocialAppointmentStop(c.action)||isPersonalFoodGiftStop(c.action))];
 if(c.foreign)return c.foreign.choices;
 if(c.outside)return c.outside.choices;
 if(c.formal?.unknownAgeSelfCare){
  const own=c.formal.unknownAgeSelfCare.filter(choice=>!c.formal!.aboard||['wait','eat'].includes(choice.action.type));
  return [...own,...c.formal.opportunities.filter(choice=>ageAllowsChoice(0,choice.action))];
 }
 const categories:ActionChoice[][]=[];
 const group=()=>{const result:ActionChoice[]=[];categories.push(result);return result;};
 const add=(g:ActionChoice[],id:string,label:string,action:Action)=>g.push({id,label,action});
 const rest=group();
 const home=c.buildings.find(b=>b.id===c.actor.homeId&&(!b.observed||b.observed.condition>0&&b.observed.ownResidence!==false));
 if(c.formal){
  rest.push({id:'wait.duration',label:'原地停留（填写本人决定的 minutes，1–720分钟）',action:{type:'wait',minutes:0},chooseDuration:true});
  if(home&&home.observed?.ownBed!==false&&c.formal.hasBed!==false){
   const distance=manhattan(home.door,c.actor.at);
   rest.push({id:'sleep.duration',label:`${home.observed?'到自己的床上睡觉':'按登记住处尝试回自己的床睡觉，屋况和床位尚待核实'}${distance?`（距家至少${distance}格，路程另计）`:''}，填写本人决定的 minutes（1–720分钟）`,action:{type:'sleep',minutes:0},chooseDuration:true});
  }
 }else{
  add(rest,'wait.15','原地停留15分钟',{type:'wait',minutes:15});
  add(rest,'wait.60','原地停留60分钟',{type:'wait',minutes:60});
  if(home&&home.observed?.ownBed!==false){const label=home.observed?'回自己的床睡':'按登记住处尝试回自己的床睡（屋况和床位尚待核实）';add(rest,'sleep.120',label+'2小时',{type:'sleep',minutes:120});add(rest,'sleep.360',label+'6小时',{type:'sleep',minutes:360});}
 }
 const food=group();
 // Cap and rotate the COMPLETE own-food list before category compaction.
 // With at most four eat rows, the following cook row fits within the basic
 // 32 slots even when every other basic category is full (31 preceding rows).
 food.push(...directFoodChoices(c));
 const kitchen=home??c.buildings.find(b=>b.kind==='lodge'&&(!b.observed||b.observed.condition>0)&&b.ownerId==='commons');
 if(kitchen&&count(c,'turnip')>=2&&count(c,'water')>=1)add(food,'cook.1',`${kitchen.observed?`去${kitchen.name}的厨房`:`按已知地址尝试去${kitchen.name}的厨房，屋况与工位须核实，`}做1份餐食（2芜菁、1水）`,{type:'cook',quantity:1,buildingId:kitchen.id});
 const gathering=group();
 const nearestResources=[...c.resources].filter(r=>r.amount>0&&!r.waterBlocked&&(!c.formal||c.formal.age>=18||r.kind==='bush'||r.kind==='spring')).sort((a,b)=>manhattan(a.at,c.actor.at)-manhattan(b.at,c.actor.at)||a.id.localeCompare(b.id));
 // Formal berry and spring candidates retain alternate known sources separately.
 // Validation worlds keep their original small vocabulary.
 for(const kind of ['tree','rock','bush','spring'] as const){if(c.formal&&(kind==='bush'||kind==='spring'))continue;const r=nearestResources.find(r=>r.kind===kind);if(!r)continue;const quantity=Math.min(3,Math.floor(r.amount));if(quantity<1)continue;add(gathering,`gather.${r.id}`,`去(${r.at.x},${r.at.y})采集${quantity}份${resourceNames[kind]}`,{type:'gather',resourceId:r.id,quantity});}
 const farming=group();
 const plots=[...c.plots].filter(p=>p.ownerId===c.actor.id).sort((a,b)=>manhattan(a.at,c.actor.at)-manhattan(b.at,c.actor.at)||a.id.localeCompare(b.id));
 const empty=plots.find(p=>!p.crop),dry=plots.find(p=>p.crop?.definition==='crop/turnip@1'&&p.crop.wateredDay!==Math.floor(c.minute/DAY)&&(p.observed?p.observed.atMinute===c.minute&&p.observed.stage==='growing':p.crop.growth<4)),ripe=plots.find(p=>p.crop?.definition==='crop/turnip@1'&&(p.observed?p.observed.atMinute===c.minute&&p.observed.stage==='mature':p.crop.growth>=4));
 if(!c.formal?.productiveFarming&&empty&&count(c,'seed')>=1&&['spring','autumn'].includes(c.season))add(farming,`plant.${empty.id}`,`在自己看见的田(${empty.at.x},${empty.at.y})播种（1种子）`,{type:'plant',plotId:empty.id});
 if(dry&&(!c.formal?.productiveFarming||dry.crop?.definition==='crop/turnip@1')&&count(c,'water')>=1)add(farming,`water.${dry.id}`,`给自己看见的田(${dry.at.x},${dry.at.y})浇水（1水）`,{type:'water',plotId:dry.id});
 if(ripe)add(farming,`harvest.${ripe.id}`,`收获自己看见的成熟芜菁(${ripe.at.x},${ripe.at.y})`,{type:'harvest',plotId:ripe.id});
 const travel=group();
 const address=c.buildings.find(b=>b.id===c.actor.homeId);
 if(address&&manhattan(address.door,c.actor.at)>0)add(travel,'move.home',`回到登记住处门外(${address.door.x},${address.door.y})查看`,{type:'move',to:{...address.door}});
 const field=knownLandChoice(c);if(field)travel.push(field);
 for(const b of [...c.buildings].filter(b=>b.ownerId==='commons').sort((a,b)=>manhattan(a.door,c.actor.at)-manhattan(b.door,c.actor.at)).slice(0,2))if(manhattan(b.door,c.actor.at)>0)add(travel,`move.${b.id}`,`去${b.name}门外(${b.door.x},${b.door.y})`,{type:'move',to:{...b.door}});
 const exploration=group();
 // A direction is an intention to discover; no unseen resource or person is asserted to exist there.
 for(const [id,name,dx,dy] of [['east','东',6,0],['south','南',0,6],['west','西',-6,0],['north','北',0,-6]] as const){const to={x:c.actor.at.x+dx,y:c.actor.at.y+dy};if(to.x<0||to.y<0||to.x>=c.bounds.width||to.y>=c.bounds.height)continue;add(exploration,`explore.${id}`,`向${name}探索6格（路线须可达）`,{type:'move',to});}
 const social=group();
 const peers=[...c.people].filter(p=>p.id!==c.actor.id&&p.status==='alive'&&p.interactionEligible!==false&&manhattan(p.at,c.actor.at)<=12).sort((a,b)=>manhattan(a.at,c.actor.at)-manhattan(b.at,c.actor.at)||a.id.localeCompare(b.id)).slice(0,3);
 social.push(...socialToneChoices(c));
 const trade=group();
 for(const peer of peers)if(c.actor.barterEligible!==false&&!c.offers.some(o=>o.actorId===c.actor.id&&o.targetId===peer.id&&o.status==='open'&&o.expiresAt>c.minute))add(trade,`offer.${peer.id}`,`向${peer.name}提出交换（填写give、want物品数量，须对方另行接受）`,{type:'offer',targetId:peer.id,give:{},want:{}});
 for(const offer of c.offers.filter(o=>c.actor.barterEligible!==false&&o.targetId===c.actor.id&&o.status==='open'&&validBarterTerms(o)&&o.expiresAt>c.minute&&peers.some(p=>p.id===o.actorId&&p.barterEligible!==false)&&Object.entries(o.want).every(([item,n])=>count(c,item as Item)>=(n??0))).slice(0,2)){
  const format=(bag:typeof offer.give)=>Object.entries(bag).map(([item,n])=>`${n}${itemNames[item as Item]}`).join('、');
  add(trade,`accept.${offer.id}`,`接受${c.people.find(p=>p.id===offer.actorId)?.name??'对方'}的现有报价：交付${format(offer.want)}，换得${format(offer.give)}`,{type:'accept',offerId:offer.id,offerTerms:barterTerms(offer)});
 }
 // Round-robin the categories, rather than giving the first populated category all prompt space.
 const choices:ActionChoice[]=[];for(let i=0;choices.length<32;i++){let found=false;for(const g of categories){if(g[i]){choices.push(g[i]);found=true;if(choices.length===32)break;}}if(!found)break;}
 // Preserve the whole basic menu even when several people bring proposals on the same day.
 if(c.formal?.aboard)return [...choices.filter(c=>['wait','eat','talk'].includes(c.action.type)),...c.formal.opportunities.filter(c=>c.action.type==='ferry'||isRescueDecision(c.action)||isWaterSupportWithdrawal(c.action)||isPregnancyWithdrawal(c.action)||isLastWishWithdrawal(c.action)||isSocialAppointmentStop(c.action)||isPersonalFoodGiftStop(c.action))].filter(choice=>ageAllowsChoice(c.formal!.age,choice.action));
 return c.formal ? [...choices,...c.formal.opportunities].filter(choice=>ageAllowsChoice(c.formal!.age,choice.action)) : choices;
}

/** Rejects invalid model output. No random action, wait, speech or other fallback is supplied. */
export function parseChoice(raw:string,choices:ActionChoice[],maxSteps=1):ModelDecision{
 const body=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 const value:unknown=JSON.parse(body);
 if(value&&typeof value==='object'&&Object.hasOwn(value,'steps')){
  const steps=(value as {steps:unknown}).steps;
  if(maxSteps<=1||Object.keys(value).length!==1||!Array.isArray(steps)||steps.length<1||steps.length>maxSteps)throw new Error('invalid_plan_steps');
  const decisions=steps.map(step=>parseSelection(step,choices));
  return {intention:decisions.map(decision=>decision.intention).join(' → ').slice(0,160),actions:decisions.flatMap(decision=>decision.actions)};
 }
 return parseSelection(value,choices);
}

function parseSelection(value:unknown,choices:ActionChoice[]):ModelDecision{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_choice');
 const data=value as Record<string,unknown>;
 if(typeof data.choice==='number'&&Number.isInteger(data.choice)&&data.choice>=0)data.choice=String(data.choice);
 if(typeof data.choice!=='string'||data.intention!==undefined&&(typeof data.intention!=='string'||data.intention.length>160))throw new Error('invalid_choice');
 // Explicitly reject competing action bodies: only the enumerated choice carries execution authority.
 const choice=choices.find(c=>c.id===data.choice);if(!choice)throw new Error('unknown_choice');
 const fields=choice.action.type==='socialAppointment'?(choice.action.operation==='offer'?['startsIn','windowMinutes']:choice.action.operation==='wait'?['minutes']:[]):choice.action.type==='personalFoodGift'&&choice.action.operation==='offer'?['quantity']:choice.action.type==='lastWish'&&choice.action.operation==='declare'?['amount']:choice.action.type==='landRights'?(choice.action.operation==='survey'?['x','y','days']:choice.action.operation==='offerParcel'?['price']:[]):choice.action.type==='premises'?(choice.action.operation==='offer'?[...premisesFields]:[]):choice.action.type==='design'&&choice.action.operation==='draw'?['drawing']:choice.action.type==='ferry'?(choice.action.operation==='post'?['fare','departIn']:choice.action.operation==='build'?['minutes']:[]):choice.action.type==='buildingMigration'&&choice.action.operation==='work'?['minutes']:choice.action.type==='culture'?(choice.action.operation==='propose'?['name','startsIn','windowMinutes','capacity']:['prepare','attend'].includes(choice.action.operation)?['minutes']:choice.action.operation==='supply'?['quantity']:[]):choice.action.type==='social'?(choice.action.operation==='start'?['minutes']:choice.action.operation==='interpret'?['affection','trust','conflict']:[]):choice.action.type==='household'?(choice.action.operation==='create'?['name','amount','quantity']:choice.action.operation==='proposeGift'?['amount','quantity','ownPercent']:['deposit','withdraw'].includes(choice.action.operation)?['amount','quantity']:[]):choice.action.type==='debt'?(choice.action.operation==='lend'?['principal','repayment','days']:['repay','forgive'].includes(choice.action.operation)?['amount']:[]):choice.action.type==='agency'&&choice.action.operation==='arm'?['threshold','days','uses','cooldown']:choice.action.type==='longCare'&&choice.action.operation==='offer'?['fee','days','startsIn','startMinute','windowMinutes','visitsPerDay']:choice.action.type==='health'&&choice.action.operation==='offer'?['fee','startsIn']:choice.action.type==='industry'?choice.action.operation==='craft'?['minutes']:[]:choice.action.type==='education'?educationChoiceFields(choice.action):choice.action.type==='construction'?constructionChoiceFields(choice.action):choice.action.type==='economy'?economyChoiceFields(choice.action):choice.action.type==='civic'?civicChoiceFields(choice.action):choice.action.type==='employment'?employmentChoiceFields(choice.action):choice.action.type==='foreignTrade'?foreignChoiceFields(choice.action):[];
 const chooseDuration=choice.chooseDuration&&(choice.action.type==='sleep'||choice.action.type==='wait');
 const allowed=choice.action.type==='offer'?['choice','intention','text','give','want']:['choice','intention','text',...fields,...(chooseDuration?['minutes']:[])];
 if(Object.keys(data).some(k=>!allowed.includes(k)))throw new Error('unexpected_choice_field');
 const action=choice.action.type==='landRights'?parseLandRightsChoice(choice.action,data):choice.action.type==='premises'?parsePremisesChoice(choice.action,data):choice.action.type==='design'?parseDesignChoice(choice.action,data):choice.action.type==='education'?parseEducationChoice(choice.action,data):choice.action.type==='construction'?parseConstructionChoice(choice.action,data):choice.action.type==='economy'?parseEconomyChoice(choice.action,data):choice.action.type==='civic'?parseCivicChoice(choice.action,data):choice.action.type==='employment'?parseEmploymentChoice(choice.action,data):choice.action.type==='foreignTrade'?parseForeignChoice(choice.action,data):structuredClone(choice.action);
 if(action.type==='socialAppointment'){const limits={startsIn:[30,2880],windowMinutes:[15,120],minutes:[1,120]};for(const k of fields as Array<keyof typeof limits>){const n=data[k],range=limits[k];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<range[0]||n>range[1])throw new Error('invalid_social_appointment_terms');Object.assign(action,{[k]:n});}}
 if(action.type==='personalFoodGift'&&action.operation==='offer'&&data.quantity!==undefined){if(typeof data.quantity!=='number'||!Number.isSafeInteger(data.quantity)||data.quantity<1||data.quantity>(action.ageTerms?.maxQuantity??3))throw new Error('invalid_personal_food_gift_quantity');action.quantity=data.quantity;}
 if(chooseDuration&&(action.type==='sleep'||action.type==='wait')){
  const minutes=data.minutes;
  if(typeof minutes!=='number'||!Number.isSafeInteger(minutes)||minutes<1||minutes>720)throw new Error('invalid_rest_duration');
  action.minutes=minutes;
 }
 if(action.type==='culture'){if(action.operation==='propose'){if(typeof data.name!=='string'||!data.name.trim()||data.name.length>40)throw new Error('invalid_culture_name');action.name=data.name.trim();const limits={startsIn:[30,20160],windowMinutes:[30,240],capacity:[2,54]};for(const key of Object.keys(limits) as Array<keyof typeof limits>){const n=data[key];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<limits[key][0]||n>limits[key][1])throw new Error('invalid_culture_terms');action[key]=n;}}if(['prepare','attend'].includes(action.operation)){if(typeof data.minutes!=='number'||!Number.isSafeInteger(data.minutes)||data.minutes<1||data.minutes>120)throw new Error('invalid_culture_duration');action.minutes=data.minutes;}if(action.operation==='supply'){if(typeof data.quantity!=='number'||!Number.isSafeInteger(data.quantity)||data.quantity<1||data.quantity>20)throw new Error('invalid_culture_stock');action.quantity=data.quantity;}if(['open','speak'].includes(action.operation)){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>240)throw new Error('invalid_culture_speech');action.text=data.text.trim();}}
 if(action.type==='social'){if(['start','speak','interpret'].includes(action.operation)){const max=action.operation==='start'?80:240;if(typeof data.text!=='string'||!data.text.trim()||data.text.length>max)throw new Error('invalid_social_text');action.text=data.text.trim();}if(action.operation==='start'){if(typeof data.minutes!=='number'||!Number.isSafeInteger(data.minutes)||data.minutes<30||data.minutes>180)throw new Error('invalid_meeting_duration');action.minutes=data.minutes;}if(action.operation==='interpret')for(const key of ['affection','trust','conflict'] as const){const n=data[key];if(typeof n!=='number'||!Number.isSafeInteger(n)||n< -5||n>5)throw new Error('invalid_personal_interpretation');action[key]=n;}}
 if(action.type==='household'&&['create','deposit','withdraw','proposeGift'].includes(action.operation)){if(typeof data.amount!=='number'||!Number.isSafeInteger(data.amount)||data.amount<0||data.amount>200||typeof data.quantity!=='number'||!Number.isSafeInteger(data.quantity)||data.quantity<0||data.quantity>20||data.quantity>0&&!action.item||data.amount===0&&data.quantity===0)throw new Error('invalid_household_assets');action.amount=data.amount;action.quantity=data.quantity;if(action.operation==='proposeGift'){if(typeof data.ownPercent!=='number'||!Number.isSafeInteger(data.ownPercent)||data.ownPercent<0||data.ownPercent>100)throw new Error('invalid_household_cost_share');action.ownPercent=data.ownPercent;}if(action.operation==='create'){if(typeof data.name!=='string'||!data.name.trim()||data.name.length>30)throw new Error('invalid_household_name');action.name=data.name.trim();}}
 if(action.type==='debt'){if(action.operation==='lend'){const limits={principal:[1,500],repayment:[1,1000],days:[1,28]};for(const key of Object.keys(limits) as Array<keyof typeof limits>){const n=data[key];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<limits[key][0]||n>limits[key][1])throw new Error('invalid_loan_terms');action[key]=n;}if(action.repayment!<action.principal!)throw new Error('invalid_loan_total');}else if(action.operation==='repay'||action.operation==='forgive'){if(typeof data.amount!=='number'||!Number.isSafeInteger(data.amount)||data.amount<1||data.amount>1000)throw new Error('invalid_debt_amount');action.amount=data.amount;}}
 if(action.type==='agency'){if(action.operation==='reflect'||action.operation==='conclude'){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>240)throw new Error('invalid_personal_goal');action.text=data.text.trim();}else if(action.operation==='arm'){const limits={threshold:[1,95],days:[1,7],uses:[1,14],cooldown:[60,1440]};for(const key of Object.keys(limits) as Array<keyof typeof limits>){const n=data[key];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<limits[key][0]||n>limits[key][1])throw new Error('invalid_personal_routine');action[key]=n;}}}
 if(action.type==='longCare'&&action.operation==='offer'){const limits={fee:[0,20],days:[1,28],startsIn:[30,10080],startMinute:[360,600],windowMinutes:[60,120],visitsPerDay:[1,3]};for(const field of Object.keys(limits) as Array<keyof typeof limits>)if(data[field]!==undefined){const n=data[field];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<limits[field][0]||n>limits[field][1])throw new Error('invalid_long_care_terms');action[field]=n;}}
 if(action.type==='health'&&action.operation==='offer'){for(const field of ['fee','startsIn'] as const)if(data[field]!==undefined){const n=data[field];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<(field==='fee'?0:30)||n>(field==='fee'?30:2880))throw new Error('invalid_medical_terms');action[field]=n;}}
 if(action.type==='ferry'){const limits={fare:[0,20],departIn:[30,720],minutes:[1,120]};for(const k of Object.keys(limits) as Array<keyof typeof limits>)if(fields.includes(k)&&data[k]!==undefined){const n=data[k],b=limits[k];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<b[0]||n>b[1])throw new Error('invalid_ferry_terms');action[k]=n;}}
 if(action.type==='buildingMigration'&&action.operation==='work'&&data.minutes!==undefined){if(typeof data.minutes!=='number'||!Number.isSafeInteger(data.minutes)||data.minutes<1||data.minutes>120)throw new Error('invalid_migration_minutes');action.minutes=data.minutes;}
 if(action.type==='industry'&&action.operation==='craft'&&data.minutes!==undefined){if(typeof data.minutes!=='number'||!Number.isSafeInteger(data.minutes)||data.minutes<1||data.minutes>120)throw new Error('invalid_craft_minutes');action.minutes=data.minutes;}
 if(action.type==='lastWish'&&action.operation==='declare'){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>80)throw new Error('invalid_last_wish_text');action.text=data.text.trim();if(action.beneficiaryId){if(typeof data.amount!=='number'||!Number.isSafeInteger(data.amount)||data.amount<1||data.amount>200)throw new Error('invalid_last_wish_amount');action.amount=data.amount;}else if(data.amount!==undefined&&data.amount!==0)throw new Error('invalid_last_wish_amount');}
 if(action.type==='funerary'&&['visit','epitaph'].includes(action.operation)){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>(action.operation==='epitaph'?80:240))throw new Error('invalid_memorial_text');action.text=data.text.trim();}
 if(action.type==='talk'){
  if(typeof data.text!=='string'||!data.text.trim()||data.text.length>240)throw new Error('invalid_choice_speech');
  action.text=data.text.trim();
 }
 // Non-talk text is discarded, never converted into speech, memory, or a claimed private reason.
 if(action.type==='offer'){
  const bag=(value:unknown):value is Extract<Action,{type:'offer'}>['give']=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0&&Object.keys(value).length<=7&&Object.entries(value).every(([item,n])=>Object.hasOwn(itemNames,item)&&typeof n==='number'&&Number.isInteger(n)&&n>0&&n<=100);
  if(!bag(data.give)||!bag(data.want))throw new Error('invalid_choice_trade');
  action.give={...data.give};action.want={...data.want};
 }
 const stated=typeof data.intention==='string'?data.intention.trim():'';
 const description=chooseDuration&&(action.type==='sleep'||action.type==='wait')?`${action.type==='sleep'?'到自己的床上睡':'原地停留'}${action.minutes}分钟`:decisionDescription(action,choice.label);
 return {intention:stated&&stated!=='简短中文打算'?stated:description,actions:[action]};
}

function decisionDescription(action:Action,fallback:string):string {
 if(action.type==='landRights'&&action.operation==='offerParcel')return `本人向指定在场买方提出私人地块 #${action.parcelIndex!+1} 的整块固定总价 ${action.price} 钱，一日内等待其独立决定`;
 if(action.type==='industry')return action.operation==='hunt'?'本人决定带猎矛去尝试打猎':`本人决定进行${action.operation}生产安排`;
 if(action.type==='education')return ({post:'发布本人授课条件',enroll:'本人自主报名课堂',sponsor:'本人自愿代付学费',withdrawSponsor:'撤回未接受的代付',withdraw:'本人退出课堂',cancel:'本人取消教学',teach:'本人实际授课',study:'本人实际学习'})[action.operation];
 if(action.type==='construction'){
  if(action.operation==='propose'||action.operation==='expand')return `提出${action.operation==='expand'?'扩建':'分阶段建造'}${action.name??'工程'}${action.at?`，选址(${action.at.x},${action.at.y})`:''}，施工时薪 ${action.wagePerHour} 钱`;
  if(action.operation==='fund')return `自愿向已知工程投入 ${action.amount} 钱`;
  if(action.operation==='work'||action.operation==='dismantle')return `亲自${action.operation==='work'?'施工':'拆除未完工部分'} ${action.minutes} 分钟`;
  if(action.operation==='supply'||action.operation==='donateMaterials')return `${action.operation==='supply'?'按报价出售':'自愿提供'} ${action.quantity} 份${action.item==='wood'?'木材':'石料'}给工程`;
 }
 if(action.type==='foreignTrade'){
  const item=action.item?itemNames[action.item]:'货物';
  if(action.operation==='post'||action.operation==='propose'){
   const side=action.operation==='post'?(action.side==='import'?'向小镇出售':'向小镇收购'):(action.side==='import'?'从镇外买入':'向镇外出售');
   return `提出${side} ${action.quantity} 份${item}的报价，每份 ${action.price} 钱`;
  }
  if(action.operation==='produce'){
   const names={drawWater:'取水',gatherWood:'采伐',quarryStone:'采石',saveSeed:'留种',cook:'烹饪',growRoots:'温棚种植',fiber:'整理纤维',fodder:'配制饲料',feedLivestock:'喂养原库活畜',waterLivestock:'为原库活畜供水'};
   return `安排 ${action.quantity} 份${action.recipe?names[action.recipe]:'货物'}生产`;
  }
  if(action.operation==='wait')return `保持现有经营安排，${action.minutes} 分钟后再考虑`;
  if(action.operation==='accept')return action.quantity?`接受已知报价，成交 ${action.quantity} 份货物`:fallback;
 }
 if(action.type==='employment'){
  if((action.operation==='post'||action.operation==='renew')&&action.terms){
   const role=action.terms.role==='cook'?'餐食制作':'留种加工';
   return `${action.operation==='renew'?'提出续约':'招聘'}${role}，足班日薪 ${action.terms.wage} 钱，每天 ${action.terms.durationMinutes} 分钟，聘期 ${action.terms.days} 日`;
  }
  if(action.operation==='work')return `按自己接受的聘约工作 ${action.minutes} 分钟`;
 }
 if(action.type==='economy'){
  const item=action.item?itemNames[action.item]:'货物';
  switch(action.operation){
   case 'open':return action.name?'开设'+action.name:'开设自己的小铺';
   case 'fund':return `向自己的商铺投入 ${action.amount} 钱`;
   case 'withdraw':return `从自己的商铺领回 ${action.amount} 钱`;
   case 'stock':return `把 ${action.quantity} 份${item}送入自己的商铺`;
   case 'retrieve':return `从自己的商铺领回 ${action.quantity} 份${item}`;
   case 'list':return `以每份 ${action.price} 钱出售 ${action.quantity} 份${item}`;
   case 'order':return `预存货款，以每份 ${action.price} 钱收购 ${action.quantity} 份${item}`;
   case 'buy':return `购买 ${action.quantity} 份${item}，含税最高 ${action.maxTotal} 钱，至少接受 ${action.minimumQuantity??action.quantity} 份`;
   case 'fulfill':return `交付 ${action.quantity} 份${item}，最低到手 ${action.minTotal} 钱，至少接受 ${action.minimumQuantity??action.quantity} 份`;
  }
 }
 if(action.type==='civic'){
  if(action.operation==='donate')return `自愿向公共金库捐 ${action.amount} 钱`;
  if(action.operation==='deliverReserve')return '将独立携运的镇外公粮实际送至原共屋桌台，不重复领取货款';
  if(action.operation==='supplyReserve')return `按已通过储备采购单亲自交付${action.quantity}份口粮`;
  if(action.operation==='openReserve')return `按已通过储备议案到场启用${action.quantity}份未承诺公粮`;
  if(action.operation==='supply')return `按公共采购单交付 ${action.quantity} 份${itemNames[action.item]}`;
  if(action.operation==='propose'){const m=action.measure;
   if(m.kind==='foodReserve')return `提出公共储备议案，累计入库至多${m.quantity}份${itemNames[m.item]}，每份${m.unitPrice}钱、采购总额${m.suppliesBudget}钱，个人24小时合计${m.dailyNutrition}营养，授权${m.durationDays}日`;
   if(m.kind==='fixtureRemoval')return `提出具体公共设备拆卸议案，总报酬${m.wage}钱按实际工时支付，授权${m.durationDays}日，回收物归公共库存`;
   if(m.kind==='salesTax')return `提出 ${m.basisPoints/100}% 成交税议案，有效 ${m.durationDays} 日`;
   if(m.kind==='careSupport')return `提出具体照护保障预存${m.amount}钱，约定${m.durationDays}日，实际完成才付费`;
   if(m.kind==='pension')return `提出每日${m.amountPerDay}钱的有限生活保障，共${m.durationDays}日，须本人自行接受`;
   if(m.kind==='education')return `提出本场课堂助学预算 ${m.amount} 钱，${m.durationDays} 日内有效`;
   if(m.kind==='construction')return `提出公共建设与管理议案，金库拨款 ${m.amount} 钱，授权 ${m.durationDays} 日`;
   return m.kind==='service'?`提出公共服务预算，工资 ${m.wageBudget}、采购 ${m.suppliesBudget} 钱，每次服务报酬 ${m.wagePerService} 钱`:
    `提出公共修缮预算，报酬 ${m.wage}、采购 ${m.suppliesBudget} 钱`;
  }
 }
 return fallback;
}
